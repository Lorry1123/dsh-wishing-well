/**
 * Board model, persistence, and the operations shared by the browser route,
 * the agent tool, Session tracking, and GitHub polling.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const COLUMNS = ['todo', 'plan', 'dev', 'verify', 'pr', 'staging', 'release', 'done']
export const COLUMN_LABELS = {
  todo: '许愿池', plan: '方案', dev: '开发中', verify: '待验收', pr: 'PR·CI', staging: 'Staging', release: '待上线', done: '已上线',
}
/** Human checkpoints a card can hand to the agent: plan review, local verification, pre-merge check. */
export const GATES = ['plan', 'local', 'merge']
const GATE_VALUES = ['human', 'auto']
const LEGACY_COLUMNS = { review: 'pr', ready: 'release' }
const TEXT_LIMITS = { title: 200, project: 80, note: 2000, status: 120, issue: 40, url: 500 }
const DISMISSED_LIMIT = 1000
const STALE_MS = 6 * 60 * 60 * 1000
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/
/** Returned by a change that leaves the board as it was, so nothing is written. */
export const UNCHANGED = Symbol('unchanged')

/** Expected input or lookup failure, reported to the caller instead of logged. */
export class BoardError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BoardError'
    this.code = code
  }
}

/**
 * Parse a GitHub pull request URL.
 * @returns `{ url, repo, number, key }`, or undefined for anything else.
 */
export function parsePrUrl(value) {
  const match = typeof value === 'string' ? PR_URL.exec(value.trim()) : null
  if (match === null) return undefined
  const repo = `${match[1]}/${match[2]}`
  const number = Number(match[3])
  return { url: `https://github.com/${repo}/pull/${number}`, repo, number, key: `${repo.toLowerCase()}#${number}` }
}

export function prKey(pr) {
  return `${pr.repo.toLowerCase()}#${pr.number}`
}

function defaultGates() {
  return { plan: 'human', local: 'human', merge: 'human' }
}

function strings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item !== '') : []
}

/** Upgrade one stored card to the current shape, or drop it when unusable. */
function normalizeCard(raw) {
  if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.title !== 'string') return undefined
  const column = LEGACY_COLUMNS[raw.column] ?? raw.column
  if (!COLUMNS.includes(column)) return undefined
  const { sessionId, ...rest } = raw
  const sessions = strings(raw.sessions)
  if (sessions.length === 0 && typeof sessionId === 'string' && sessionId !== '') sessions.push(sessionId)
  const gates = defaultGates()
  for (const gate of GATES) if (GATE_VALUES.includes(raw.gates?.[gate])) gates[gate] = raw.gates[gate]
  const prs = Array.isArray(raw.prs)
    ? raw.prs.filter(pr => pr !== null && typeof pr === 'object' && parsePrUrl(pr.url) !== undefined)
    : []
  if (prs.length === 0 && typeof raw.pr === 'string') {
    const parsed = parsePrUrl(raw.pr)
    if (parsed !== undefined) prs.push({ url: parsed.url, repo: parsed.repo, number: parsed.number })
  }
  const card = { ...rest, column, sessions, prs, sources: strings(raw.sources), gates }
  delete card.pr
  if (!isDueDate(card.dueDate)) delete card.dueDate
  card.movedAt ??= card.updatedAt ?? card.createdAt
  return card
}

/** Serialized, atomically persisted access to one board file. */
export class BoardStore {
  constructor(file) {
    this.file = file
    this.board = undefined
    this.queue = Promise.resolve()
  }

  /** Read the board once and serve later reads from memory; this process is its only writer. */
  async read() {
    if (this.board !== undefined) return this.board
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      this.board = {
        revision: Number.isSafeInteger(parsed?.revision) ? parsed.revision : 0,
        cards: Array.isArray(parsed?.cards) ? parsed.cards.map(normalizeCard).filter(Boolean) : [],
        dismissed: strings(parsed?.dismissed),
      }
    } catch (error) {
      // A missing file is an empty board; a corrupt one must not be overwritten.
      if (error?.code !== 'ENOENT') throw error
      this.board = { revision: 0, cards: [], dismissed: [] }
    }
    return this.board
  }

  /**
   * Apply one change after every earlier one and persist it before answering.
   * @param change - receives a draft `{ cards, dismissed }`, edits it in place, and
   *   returns the result, or UNCHANGED to skip the write.
   * @returns the change's result.
   */
  mutate(change) {
    const run = this.queue.then(async () => {
      const current = await this.read()
      const draft = { cards: structuredClone(current.cards), dismissed: [...current.dismissed] }
      const result = change(draft)
      if (result === UNCHANGED) return UNCHANGED
      const next = { revision: current.revision + 1, cards: draft.cards, dismissed: draft.dismissed.slice(-DISMISSED_LIMIT) }
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await rename(temp, this.file)
      this.board = next
      return result
    })
    this.queue = run.catch(() => {})
    return run
  }
}

/**
 * Normalize one optional text field: undefined leaves it unchanged, '' clears it.
 * @returns the trimmed text, '' to clear, or undefined when absent.
 */
function textField(input, field, { required = false, limit = TEXT_LIMITS[field] } = {}) {
  const value = input[field]
  if (value === undefined || value === null) {
    if (required) throw new BoardError('invalid_input', `${field} is required`)
    return undefined
  }
  if (typeof value !== 'string') throw new BoardError('invalid_input', `${field} must be a string`)
  const text = value.trim()
  if (required && text === '') throw new BoardError('invalid_input', `${field} must not be empty`)
  if (text.length > limit) throw new BoardError('invalid_input', `${field} exceeds ${limit} characters`)
  return text
}

function isDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function columnField(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (!COLUMNS.includes(value)) throw new BoardError('invalid_input', `column must be one of ${COLUMNS.join(', ')}`)
  return value
}

function urlField(value, field) {
  if (typeof value !== 'string' || !/^https?:\/\/\S+$/.test(value.trim()) || value.length > TEXT_LIMITS.url) {
    throw new BoardError('invalid_input', `${field} must be an http(s) URL`)
  }
  return value.trim()
}

function prField(value) {
  const parsed = parsePrUrl(value)
  if (parsed === undefined) throw new BoardError('invalid_input', `not a GitHub pull request URL: ${String(value)}`)
  return parsed
}

function setOptional(card, field, value) {
  if (value === undefined) return
  if (value === '') delete card[field]
  else card[field] = value
}

export function findCard(cards, id) {
  if (typeof id !== 'string' || id === '') throw new BoardError('invalid_input', 'id is required')
  const card = cards.find(other => other.id === id)
  if (card === undefined) throw new BoardError('not_found', `no card with id ${id}`)
  return card
}

/** The card a Session is tracked by: its latest unfinished card, else its latest card. */
export function cardForSession(cards, sessionId) {
  let best
  for (const card of cards) {
    if (!card.sessions.includes(sessionId)) continue
    const open = card.column !== 'done'
    if (best === undefined || (open !== (best.column !== 'done') ? open : card.updatedAt > best.updatedAt)) best = card
  }
  return best
}

function newId(cards) {
  for (;;) {
    const id = `k-${randomUUID().slice(0, 6)}`
    if (!cards.some(card => card.id === id)) return id
  }
}

/**
 * Move a card to another column. Leaving a column ends whatever the card was
 * waiting for there, so the waiting flag and the agent's status text reset.
 */
export function moveCard(card, column, now) {
  if (card.column === column) return false
  card.column = column
  card.movedAt = now
  card.updatedAt = now
  delete card.waiting
  delete card.status
  if (column === 'done') card.doneAt = now
  else delete card.doneAt
  return true
}

/** Reorder a card to the end of its column, or before another card of that column. */
function place(cards, card, beforeId) {
  cards.splice(cards.indexOf(card), 1)
  const before = typeof beforeId === 'string' ? cards.findIndex(other => other.id === beforeId && other.column === card.column) : -1
  if (before >= 0) cards.splice(before, 0, card)
  else cards.push(card)
}

function undismiss(draft, sessionId) {
  draft.dismissed = draft.dismissed.filter(id => id !== sessionId)
}

function dismiss(draft, sessionId) {
  if (!draft.dismissed.includes(sessionId)) draft.dismissed.push(sessionId)
}

/** A card created automatically for a Session and never given any content of its own. */
function isDisposableAutoCard(card) {
  return card.autoCreated === true && card.sessions.length === 0 && card.prs.length === 0
    && card.issue === undefined && card.sources.length === 0 && card.note === undefined
}

/** Make `card` the only card tracking `sessionId`, dropping auto-created cards left empty. */
function attachSession(draft, card, sessionId) {
  for (const other of [...draft.cards]) {
    if (other === card || !other.sessions.includes(sessionId)) continue
    other.sessions = other.sessions.filter(id => id !== sessionId)
    if (isDisposableAutoCard(other)) draft.cards.splice(draft.cards.indexOf(other), 1)
  }
  if (!card.sessions.includes(sessionId)) card.sessions.push(sessionId)
  undismiss(draft, sessionId)
}

/** Add PRs to a card, keeping polled state for ones it already has. */
export function addPrs(card, parsedPrs) {
  let added = false
  for (const parsed of parsedPrs) {
    if (card.prs.some(pr => prKey(pr) === parsed.key)) continue
    card.prs.push({ url: parsed.url, repo: parsed.repo, number: parsed.number })
    added = true
  }
  return added
}

function applyGates(card, input) {
  for (const gate of GATES) {
    const value = input.gates?.[gate]
    if (value === undefined) continue
    if (!GATE_VALUES.includes(value)) throw new BoardError('invalid_input', `gate ${gate} must be human or auto`)
    card.gates[gate] = value
  }
}

/** Create one card with every field defaulted. */
export function createCard(draft, fields) {
  const now = new Date().toISOString()
  const card = {
    id: newId(draft.cards),
    title: fields.title,
    column: fields.column ?? 'todo',
    sessions: [],
    prs: [],
    sources: [],
    gates: defaultGates(),
    createdAt: now,
    updatedAt: now,
    movedAt: now,
  }
  if (card.column === 'done') card.doneAt = now
  if (fields.autoCreated === true) {
    card.autoCreated = true
    card.autoTitle = true
  }
  draft.cards.push(card)
  return card
}

export const OPERATIONS = {
  add(draft, input) {
    const card = createCard(draft, { title: textField(input, 'title', { required: true }), column: columnField(input.column, 'todo') })
    applyFields(draft, card, input)
    for (const sessionId of strings(input.sessions)) attachSession(draft, card, sessionId)
    return { card }
  },
  update(draft, input) {
    const card = findCard(draft.cards, input.id)
    const now = new Date().toISOString()
    const column = columnField(input.column, card.column)
    const moved = moveCard(card, column, now)
    applyFields(draft, card, input)
    card.updatedAt = now
    if (moved || input.beforeId !== undefined) place(draft.cards, card, input.beforeId)
    return { card }
  },
  remove(draft, input) {
    const card = findCard(draft.cards, input.id)
    draft.cards.splice(draft.cards.indexOf(card), 1)
    // Removing a Session's card stops automatic tracking of that Session.
    for (const sessionId of card.sessions) dismiss(draft, sessionId)
    return { removed: card.id, title: card.title }
  },
  link(draft, input) {
    const card = findCard(draft.cards, input.id)
    if (typeof input.sessionId !== 'string' || input.sessionId === '') throw new BoardError('invalid_input', 'sessionId is required')
    attachSession(draft, card, input.sessionId)
    card.updatedAt = new Date().toISOString()
    return { card }
  },
  unlink(draft, input) {
    const card = findCard(draft.cards, input.id)
    if (typeof input.sessionId !== 'string' || !card.sessions.includes(input.sessionId)) {
      throw new BoardError('invalid_input', 'the session is not linked to this card')
    }
    card.sessions = card.sessions.filter(id => id !== input.sessionId)
    // An unlinked Session must not be tracked again on its next message.
    dismiss(draft, input.sessionId)
    card.updatedAt = new Date().toISOString()
    return { card }
  },
}

/** Apply the optional editable fields shared by add and update. */
function applyFields(draft, card, input) {
  const title = textField(input, 'title')
  if (title === '') throw new BoardError('invalid_input', 'title must not be empty')
  if (title !== undefined && title !== card.title) {
    card.title = title
    // An explicit title is someone's choice; Session titles no longer replace it.
    delete card.autoTitle
  }
  for (const field of ['project', 'note', 'status']) setOptional(card, field, textField(input, field))
  const dueDate = textField(input, 'dueDate', { limit: 10 })
  if (dueDate && !isDueDate(dueDate)) throw new BoardError('invalid_input', 'dueDate must be a valid YYYY-MM-DD date')
  setOptional(card, 'dueDate', dueDate)
  const issue = textField(input, 'issue')
  setOptional(card, 'issue', issue)
  if (input.issueUrl !== undefined) setOptional(card, 'issueUrl', input.issueUrl === '' ? '' : urlField(input.issueUrl, 'issueUrl'))
  if (issue === '') delete card.issueUrl
  if (input.waiting !== undefined) {
    if (typeof input.waiting !== 'boolean') throw new BoardError('invalid_input', 'waiting must be a boolean')
    if (input.waiting) card.waiting = true
    else delete card.waiting
  }
  applyGates(card, input)
  if (input.prs !== undefined) {
    const wanted = strings(input.prs).map(prField)
    const kept = card.prs.filter(pr => wanted.some(parsed => parsed.key === prKey(pr)))
    card.prs = kept
    addPrs(card, wanted)
  }
  if (input.addPr !== undefined) addPrs(card, [prField(input.addPr)])
  if (input.removePr !== undefined) {
    const parsed = prField(input.removePr)
    card.prs = card.prs.filter(pr => prKey(pr) !== parsed.key)
  }
  if (input.sources !== undefined) card.sources = strings(input.sources).map(url => urlField(url, 'source'))
  if (input.addSource !== undefined) {
    const url = urlField(input.addSource, 'source')
    if (!card.sources.includes(url)) card.sources.push(url)
  }
  if (card.autoCreated === true && (dueDate || input.note !== undefined || input.issue !== undefined || input.addPr !== undefined || input.prs !== undefined)) {
    // Content given by a person or agent makes the card worth keeping when its Session moves elsewhere.
    delete card.autoCreated
  }
}

function openPrs(card) {
  return card.prs.filter(pr => pr.state !== 'MERGED' && pr.state !== 'CLOSED')
}

/** A PR whose Greptile review, when present, covers its head and scored at least 4. */
function reviewPassed(pr) {
  return pr.score === undefined || (pr.scoreStale !== true && pr.score >= 4)
}

/**
 * Why a card needs the user now, or undefined when it does not.
 * @param card - stored card.
 * @param context - `{ now, running }`: the clock and the ids of Sessions currently in a turn.
 */
export function attentionOf(card, { now, running }) {
  const active = card.sessions.some(id => running.has(id))
  if (card.column === 'verify') return '等你本地验收'
  if (card.column === 'release') return '等你安排上线'
  if (card.column === 'pr' && !active) {
    const open = openPrs(card)
    if (open.some(pr => pr.checks === 'failing')) return 'CI 失败'
    const low = open.find(pr => pr.score !== undefined && pr.scoreStale !== true && pr.score <= 3)
    if (low !== undefined) return `Greptile ${low.score}/5，需要处理`
    if (card.gates.merge === 'human' && open.length > 0
      && open.every(pr => (pr.checks === 'passing' || pr.checks === 'none') && reviewPassed(pr))) return '可以合并，等你检查'
  }
  if (card.waiting === true && !active) return card.status || '等你回复'
  if (card.column === 'staging' && !active && now - Date.parse(card.updatedAt) > STALE_MS) return 'Staging 超过 6 小时无进展'
  return undefined
}

/**
 * Board as served to the browser: stored cards plus derived activity and
 * attention. `version` changes whenever either the stored revision or a
 * derived value changes, because running state and staleness are not stored.
 */
export function presentBoard(board, running, now = Date.now()) {
  const cards = board.cards.map(card => ({
    ...card,
    running: card.sessions.some(id => running.has(id)),
    attention: attentionOf(card, { now, running }),
  }))
  const derived = cards.map(card => `${card.id}:${card.running ? 1 : 0}:${card.attention ?? ''}`).join('|')
  return { revision: board.revision, version: `${board.revision}:${fnv1a(derived)}`, cards }
}

function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
