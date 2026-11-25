/**
 * Host half of the cross-session kanban board.
 *
 * One JSON file holds the board. The browser reads and changes it through an
 * owner-only exact route, and agents through the `kanban` tool. Session events
 * move cards on their own: a first human message creates the Session's card,
 * edits start development, a finished editing turn waits for local
 * verification, a created PR enters PR·CI, and GitHub polling follows CI,
 * Greptile, and merges.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  addPrs, BoardError, BoardStore, cardForSession, COLUMNS, COLUMN_LABELS, createCard, findCard, GATES, moveCard,
  OPERATIONS, parsePrUrl, presentBoard, UNCHANGED,
} from './board.js'
import { advanceFromPrs, startGitHubPolling } from './github.js'

export const name = 'kanban'
export const inject = ['connection', 'tools']

const ROUTE = '/api/kanban/board'
const DEFAULT_FILE = join(homedir(), '.dsh', 'kanban', 'board.json')
const DEFAULT_DISTRO = 'Ubuntu-22.04'
const AUTO_TITLE_LENGTH = 60
/** Built-in file-editing tools; an edit made through a shell command is not detected. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'edit', 'write'])
const PR_URL_GLOBAL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g
const ISSUE_ID = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/
const LINEAR_URL = /https:\/\/linear\.app\/[^\s"'()<>]+\/issue\/[A-Z0-9]+-\d+[^\s"'()<>]*/

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function textOf(content) {
  return Array.isArray(content)
    ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
    : ''
}

function provisionalTitle(text) {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line === '') return '未命名会话'
  return line.length > AUTO_TITLE_LENGTH ? `${line.slice(0, AUTO_TITLE_LENGTH)}…` : line
}

function parseArgs(raw) {
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? value : {}
  } catch (_notJson) {
    return {}
  }
}

/**
 * PR URLs a tool result reports as newly created. `gh pr create` prints the
 * URL; a command hidden in an encoded script counts when the URL stands alone
 * on a line. Other mentions (listing or viewing PRs) are ignored.
 */
export function createdPrUrls(call, resultText) {
  const args = call?.rawArgs ?? ''
  const explicit = /\bpr\s+create\b/.test(args) || /Creating pull request for/.test(resultText)
  if (explicit) return [...new Set(resultText.match(PR_URL_GLOBAL) ?? [])]
  if (/base64/.test(args)) {
    return [...new Set(resultText.split(/\r?\n/).map(line => line.trim()).filter(line => parsePrUrl(line) !== undefined))]
  }
  return []
}

/** Linear issue created by a tool call, as `{ issue, issueUrl? }`, or undefined. */
export function createdIssue(call, resultText) {
  if (call === undefined || !/linear/i.test(call.name) || !/save_issue/.test(call.name)) return undefined
  if (typeof call.args.id === 'string' && call.args.id !== '') return undefined
  const id = /"identifier"\s*:\s*"([A-Z][A-Z0-9]{1,9}-\d+)"/.exec(resultText)?.[1] ?? ISSUE_ID.exec(resultText)?.[1]
  if (id === undefined) return undefined
  const url = LINEAR_URL.exec(resultText)?.[0]
  return url === undefined ? { issue: id } : { issue: id, issueUrl: url }
}

function describeCard(card) {
  const extra = [
    card.project && `project ${card.project}`,
    card.issue && `issue ${card.issue}`,
    card.sessions.length > 0 && `sessions ${card.sessions.join(',')}`,
    ...card.prs.map(pr => `PR ${pr.url}${pr.state ? ` ${pr.state}` : ''}${pr.checks ? ` checks:${pr.checks}` : ''}${pr.score !== undefined ? ` greptile:${pr.score}/5${pr.scoreStale ? '(stale)' : ''}` : ''}`),
    GATES.filter(gate => card.gates[gate] === 'auto').map(gate => `${gate}_gate:auto`).join(' '),
  ].filter(Boolean).join(', ')
  const lines = [`[${COLUMN_LABELS[card.column]}] ${card.id} ${card.title}${extra ? ` (${extra})` : ''}`]
  if (card.status) lines.push(`    status: ${card.status}${card.waiting ? ' (waiting for user)' : ''}`)
  if (card.note) lines.push(`    note: ${card.note}`)
  return lines.join('\n')
}

const TOOL_DESCRIPTION = `Cross-session kanban board of the user's work items. Columns (id 中文): todo 许愿池 → plan 方案 → dev 开发中 → verify 待验收 → pr PR·CI → staging Staging → release 待上线 → done 已上线.
Tracked automatically, do not duplicate: a session's first message creates its card in plan; the first file edit moves plan → dev; with local_gate human, a turn that edited files moves dev → verify and the next turn moves it back to dev; \`gh pr create\` attaches the PR and moves the card to pr; CI, Greptile and merge state are polled from GitHub; merging every PR moves it to staging.
Your part — update without id targets this session's card:
- Whenever you stop to wait for the user, set waiting=true with a short status (e.g. "方案等你 review"); keep status current at milestones.
- Move plan → dev when the plan is approved: by the user, or after adversarial subagent review when plan_gate is auto.
- When the user grants autonomy, set the gates: plan_gate=auto (subagents review the plan), local_gate=auto (no local verification before the PR), merge_gate=auto (merge once CI and review pass). The gates record the user's instruction; they do not grant permissions by themselves.
- Attach PRs the board missed (other repositories) with pr.
- After merge, report staging deploy and independent test progress in status; move to release once the staging test passes; after the production deploy and regression test, move to done.
- If this session continues an existing card (same requirement or Linear issue), call link with that card's id.
Add other cards only when the user asks. list omits done cards unless column is "done" or include_done is true.`

const GATE_PARAM = { type: 'string', enum: ['human', 'auto'] }
const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'link'], description: 'Operation to perform.' },
    id: { type: 'string', description: 'Card id; update/remove default to this session\'s card; required by link.' },
    title: { type: 'string', description: 'Card title; required by add.' },
    column: { type: 'string', enum: COLUMNS, description: 'Target column for add/update, or a list filter. add defaults to todo.' },
    status: { type: 'string', description: 'Short current-progress phrase shown on the card; cleared when the card changes column.' },
    waiting: { type: 'boolean', description: 'true when you stopped and the user must act; cleared by the next turn.' },
    project: { type: 'string', description: 'Project or repository name; also a list filter.' },
    issue: { type: 'string', description: 'Linear issue identifier such as ENG-123.' },
    issue_url: { type: 'string', description: 'Linear issue URL.' },
    pr: { type: 'string', description: 'GitHub pull request URL to attach.' },
    remove_pr: { type: 'string', description: 'GitHub pull request URL to detach.' },
    source: { type: 'string', description: 'Requirement source URL to add (Notion page, Slack thread, Claude artifact).' },
    note: { type: 'string', description: 'Short free-form note.' },
    plan_gate: { ...GATE_PARAM, description: 'human: the user reviews the plan; auto: adversarial subagent review suffices.' },
    local_gate: { ...GATE_PARAM, description: 'human: the user verifies locally before the PR; auto: skip local verification.' },
    merge_gate: { ...GATE_PARAM, description: 'human: the user checks before merging; auto: merge once CI and review pass.' },
    session: { type: 'string', description: 'add: "current" (default) links this session, "none" leaves it unlinked. list: "current" or a session id filters by session.' },
    include_done: { type: 'boolean', description: 'list only: include done cards.' },
  },
  required: ['action'],
  additionalProperties: false,
}

/** Map tool arguments onto the shared operation input. Empty strings clear text fields. */
function toolFields(input) {
  const fields = {}
  for (const field of ['title', 'column', 'status', 'waiting', 'project', 'issue', 'note']) {
    if (input[field] !== undefined) fields[field] = input[field]
  }
  if (input.issue_url !== undefined) fields.issueUrl = input.issue_url
  if (input.pr !== undefined) fields.addPr = input.pr
  if (input.remove_pr !== undefined) fields.removePr = input.remove_pr
  if (input.source !== undefined) fields.addSource = input.source
  const gates = {}
  for (const gate of GATES) if (input[`${gate}_gate`] !== undefined) gates[gate] = input[`${gate}_gate`]
  if (Object.keys(gates).length > 0) fields.gates = gates
  return fields
}

/**
 * Mount the board route, the `kanban` tool, automatic Session tracking, and GitHub polling.
 * @param ctx - Host plugin context injecting `connection` and `tools`.
 * @param config - optional `{ file, wslDistro }`.
 */
export function apply(ctx, config) {
  const store = new BoardStore(typeof config?.file === 'string' && config.file !== '' ? config.file : DEFAULT_FILE)
  /** Sessions currently inside a turn. */
  const running = new Set()
  /** Per-Session state of the open turn: whether it edited files, and its tool calls by id. */
  const turns = new Map()
  const warn = (message, error) => { ctx.logger.warn(message, error) }

  const poller = startGitHubPolling({
    store,
    logger: ctx.logger,
    distro: typeof config?.wslDistro === 'string' && config.wslDistro !== '' ? config.wslDistro : DEFAULT_DISTRO,
    // YAML config cannot carry a function, so only an in-process test supplies this.
    ...(typeof config?.fetchPrs === 'function' ? { fetch: config.fetchPrs } : {}),
  })
  ctx.effect(() => () => poller.dispose(), 'kanban: GitHub polling')
  /** Read a newly attached PR soon instead of at the next scheduled poll. */
  const pollSoon = () => { setTimeout(() => { void poller.tick() }, 1000) }

  const route = async (request) => {
    try {
      if (request.method === 'GET') return json({ ok: true, board: presentBoard(await store.read(), running) })
      const body = await request.json()
      const operation = Object.hasOwn(OPERATIONS, body?.op) ? OPERATIONS[body.op] : undefined
      if (operation === undefined) throw new BoardError('invalid_input', `unknown op ${String(body?.op)}`)
      const value = await store.mutate(draft => operation(draft, body.args ?? {}))
      if (body.op === 'update' && (body.args?.prs !== undefined || body.args?.addPr !== undefined)) pollSoon()
      return json({ ok: true, value, board: presentBoard(store.board, running) })
    } catch (error) {
      if (error instanceof BoardError) return json({ ok: false, error: { code: error.code, message: error.message } }, 400)
      warn('kanban: board request failed', error)
      return json({ ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }, 500)
    }
  }
  ctx.effect(
    () => ctx.connection.fetch.register({ path: ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: route }),
    'kanban: board route',
  )

  /** Apply `change` to the cards of one Session; the change returns whether it altered a card. */
  const forSession = (sessionId, change) => store.mutate((draft) => {
    let any = false
    for (const card of draft.cards) if (card.sessions.includes(sessionId) && change(card, draft)) any = true
    return any ? true : UNCHANGED
  })

  const onHumanMessage = (session, text) => store.mutate((draft) => {
    if (draft.dismissed.includes(session.id) || draft.cards.some(card => card.sessions.includes(session.id))) return UNCHANGED
    const known = ctx.get('sessionTitle')?.get(session)?.title
    const card = createCard(draft, {
      title: typeof known === 'string' && known !== '' ? known : provisionalTitle(text),
      column: 'plan',
      autoCreated: true,
    })
    card.sessions.push(session.id)
    return true
  })
  const onTitle = (session, title) => forSession(session.id, (card) => {
    if (card.autoTitle !== true || card.title === title) return false
    card.title = title
    return true
  })
  const onTurnStart = (session) => {
    const now = new Date().toISOString()
    return forSession(session.id, (card) => {
      let changed = false
      // A new turn means the user answered or the agent resumed: nothing waits
      // anymore, and the status that described the wait is out of date.
      if (card.waiting === true) {
        delete card.waiting
        delete card.status
        changed = true
      }
      if (card.column === 'verify') changed = moveCard(card, 'dev', now) || changed
      return changed
    })
  }
  /**
   * Record on the card that `turn` edited files. The mark is stored with the
   * board, not in memory, so a plugin reload or Host restart in the middle of
   * the turn still lets the turn's end act on it.
   */
  const onEdit = (session, turn) => {
    const now = new Date().toISOString()
    return forSession(session.id, (card) => {
      let changed = false
      if (card.editedTurn !== turn) {
        card.editedTurn = turn
        changed = true
      }
      return (card.column === 'plan' && moveCard(card, 'dev', now)) || changed
    })
  }
  /** At the end of a turn that edited files, wait for local verification when that gate is human. */
  const onTurnEnd = (session, turn) => {
    const now = new Date().toISOString()
    return forSession(session.id, (card) => {
      if (card.editedTurn === undefined || card.editedTurn !== turn) return false
      delete card.editedTurn
      const hasOpenPr = card.prs.some(pr => pr.state !== 'MERGED' && pr.state !== 'CLOSED')
      if (card.column === 'plan') moveCard(card, 'dev', now)
      if (card.column === 'dev' && !hasOpenPr && card.gates.local === 'human') {
        // The status the agent left this turn describes what to verify; keep it.
        const status = card.status
        moveCard(card, 'verify', now)
        if (status !== undefined) card.status = status
      }
      return true
    })
  }
  const onCreatedPrs = (session, urls) => forSession(session.id, (card) => {
    const added = addPrs(card, urls.map(parsePrUrl).filter(Boolean))
    if (added) {
      advanceFromPrs(card, new Date().toISOString())
      pollSoon()
    }
    return added
  })
  const onCreatedIssue = (session, issue) => forSession(session.id, (card) => {
    if (card.issue !== undefined) return false
    card.issue = issue.issue
    if (issue.issueUrl !== undefined) card.issueUrl = issue.issueUrl
    delete card.autoCreated
    // Creating the issue is where development starts in this workflow.
    if (card.column === 'plan') moveCard(card, 'dev', new Date().toISOString())
    return true
  })

  ctx.on('session/event', (session, event) => {
    if (session?.header?.origin === 'subagent' || typeof session?.id !== 'string') return undefined
    const id = session.id
    let work
    switch (event?.type) {
      case 'turn/start':
        running.add(id)
        turns.set(id, { edited: false, calls: new Map() })
        work = onTurnStart(session)
        break
      case 'user/message':
        if (event.data?.source?.kind === 'user') work = onHumanMessage(session, textOf(event.data.content))
        break
      case 'session/title':
        if (typeof event.data?.title === 'string' && event.data.title !== '') work = onTitle(session, event.data.title)
        break
      case 'tool/call': {
        // A turn that began before this plugin loaded has no record yet.
        let turn = turns.get(id)
        if (turn === undefined) {
          turn = { edited: false, calls: new Map() }
          turns.set(id, turn)
          running.add(id)
        }
        const call = { name: String(event.data?.name ?? ''), rawArgs: String(event.data?.arguments ?? '') }
        call.args = parseArgs(call.rawArgs)
        turn.calls.set(event.data?.callId, call)
        if (EDIT_TOOLS.has(call.name) && !turn.edited && Number.isSafeInteger(event.data?.turn)) {
          turn.edited = true
          work = onEdit(session, event.data.turn)
        }
        break
      }
      case 'tool/result': {
        const message = event.data?.message
        if (message?.isError === true) break
        const call = turns.get(id)?.calls.get(message?.toolCallId)
        const text = textOf(message?.content)
        const urls = createdPrUrls(call, text)
        const issue = createdIssue(call, text)
        const jobs = []
        if (urls.length > 0) jobs.push(onCreatedPrs(session, urls))
        if (issue !== undefined) jobs.push(onCreatedIssue(session, issue))
        if (jobs.length > 0) work = Promise.all(jobs)
        break
      }
      case 'turn/end':
        running.delete(id)
        turns.delete(id)
        if (Number.isSafeInteger(event.data?.turn)) work = onTurnEnd(session, event.data.turn)
        break
      default:
        break
    }
    return work?.catch((error) => { warn(`kanban: automatic tracking of session ${id} failed`, error) })
  })
  ctx.on('session/disposed', (session) => {
    running.delete(session?.id)
    turns.delete(session?.id)
  })

  ctx.tools.register({
    name: 'kanban',
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: args => args?.action === 'list',
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const input = args ?? {}
      const currentId = exec.agent?.session?.id
      const requireCurrent = () => {
        if (typeof currentId !== 'string') throw new BoardError('invalid_input', 'the calling session is unknown')
        return currentId
      }
      const targetId = (draft) => {
        if (typeof input.id === 'string' && input.id !== '') return input.id
        const card = cardForSession(draft.cards, requireCurrent())
        if (card === undefined) throw new BoardError('not_found', 'this session has no card; pass id, or add one')
        return card.id
      }
      switch (input.action) {
        case 'list': {
          const board = await store.read()
          const sessionFilter = input.session === 'current' ? requireCurrent() : input.session
          const column = input.column
          if (column !== undefined && !COLUMNS.includes(column)) throw new BoardError('invalid_input', 'unknown column')
          const cards = board.cards.filter(card => (column !== undefined ? card.column === column : input.include_done === true || card.column !== 'done')
            && (sessionFilter === undefined || card.sessions.includes(sessionFilter))
            && (typeof input.project !== 'string' || input.project === '' || (card.project ?? '').toLowerCase() === input.project.toLowerCase()))
          return { cards, text: cards.length === 0 ? 'No matching cards.' : cards.map(describeCard).join('\n') }
        }
        case 'add': {
          const sessions = input.session === 'none' ? [] : [input.session === undefined || input.session === 'current' ? requireCurrent() : input.session]
          const { card } = await store.mutate(draft => OPERATIONS.add(draft, { ...toolFields(input), sessions }))
          if (card.prs.length > 0) pollSoon()
          return { card, text: `Added ${describeCard(card)}` }
        }
        case 'update': {
          const { card } = await store.mutate(draft => OPERATIONS.update(draft, { id: targetId(draft), ...toolFields(input) }))
          if (input.pr !== undefined) pollSoon()
          return { card, text: `Updated ${describeCard(card)}` }
        }
        case 'remove': {
          const result = await store.mutate(draft => OPERATIONS.remove(draft, { id: targetId(draft) }))
          return { ...result, text: `Removed ${result.removed} ${result.title}` }
        }
        case 'link': {
          const { card } = await store.mutate((draft) => {
            findCard(draft.cards, input.id)
            return OPERATIONS.link(draft, { id: input.id, sessionId: requireCurrent() })
          })
          return { card, text: `Linked this session to ${describeCard(card)}` }
        }
        default:
          throw new BoardError('invalid_input', 'action must be list, add, update, remove, or link')
      }
    },
  })
}
