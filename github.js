/**
 * GitHub state of the pull requests on board cards, read with the user's
 * logged-in `gh` (inside WSL on Windows), and the column moves it implies.
 */
import { execFile } from 'node:child_process'
import { moveCard, parsePrUrl, prKey, UNCHANGED } from './board.js'

const TICK_MS = 60 * 1000
const PENDING_INTERVAL_MS = 2 * 60 * 1000
const SETTLED_INTERVAL_MS = 5 * 60 * 1000
const MAX_PER_TICK = 20
const COMMAND_TIMEOUT_MS = 3 * 60 * 1000
const FAILING_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const FAILING_STATES = new Set(['FAILURE', 'ERROR'])
const PENDING_STATES = new Set(['PENDING', 'EXPECTED'])
const PROTECTED_BRANCHES = new Set(['main', 'master'])
/** Columns from which a PR's progress may move a card forward. */
const BEFORE_PR = new Set(['todo', 'plan', 'dev', 'verify'])

/**
 * Fold `statusCheckRollup` into one state.
 * @param checks - `{ s: status, c: conclusion, t: state }` items from gh.
 * @returns 'failing', 'pending', 'passing', or 'none'.
 */
export function summarizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'none'
  if (checks.some(check => FAILING_CONCLUSIONS.has(check.c) || FAILING_STATES.has(check.t))) return 'failing'
  if (checks.some(check => (check.s !== undefined && check.s !== null && check.s !== '' && check.s !== 'COMPLETED') || PENDING_STATES.has(check.t))) {
    return 'pending'
  }
  return 'passing'
}

/**
 * Read the score and reviewed commit from a Greptile summary comment.
 * @param body - the comment containing `<!-- greptile_summary -->`.
 * @param head - the PR's current head commit.
 * @returns `{ score, scoreCommit, scoreStale }`, or {} when the body carries no score.
 */
export function parseGreptile(body, head) {
  if (typeof body !== 'string') return {}
  const score = /Confidence Score:\s*(\d)\s*\/\s*5/i.exec(body)
  if (score === null) return {}
  const commit = /Last reviewed commit:[^\n]*?\/commit\/([0-9a-f]{7,40})/i.exec(body)
  const scoreCommit = commit?.[1]
  return {
    score: Number(score[1]),
    ...(scoreCommit === undefined ? {} : { scoreCommit }),
    scoreStale: scoreCommit !== undefined && typeof head === 'string' && !head.startsWith(scoreCommit),
  }
}

/** Fold one gh answer into the stored PR fields. */
export function prStateOf(info) {
  return {
    state: info.state,
    base: info.base,
    head: info.head,
    checks: summarizeChecks(info.checks),
    ...(info.mergedAt ? { mergedAt: info.mergedAt } : {}),
    ...parseGreptile(info.greptile, info.head),
  }
}

/**
 * Move cards forward from their PRs: an open PR puts an earlier card in PR·CI;
 * once every PR is settled and one merged, the card goes to Staging, or to
 * shipped when a PR merged into the production branch directly.
 * @returns whether the card moved.
 */
export function advanceFromPrs(card, now) {
  if (card.prs.length === 0) return false
  const settled = card.prs.every(pr => pr.state === 'MERGED' || pr.state === 'CLOSED')
  const merged = card.prs.filter(pr => pr.state === 'MERGED')
  if (settled && merged.length > 0 && (BEFORE_PR.has(card.column) || card.column === 'pr')) {
    return moveCard(card, merged.some(pr => PROTECTED_BRANCHES.has(pr.base)) ? 'done' : 'staging', now)
  }
  if (!settled && BEFORE_PR.has(card.column) && card.column !== 'todo') return moveCard(card, 'pr', now)
  return false
}

/** Bash script printing one JSON line per PR. URLs are validated before they reach it. */
function viewScript(urls) {
  const jq = '{url,state,base:.baseRefName,mergedAt,head:.headRefOid,'
    + 'checks:[.statusCheckRollup[]?|{s:.status,c:.conclusion,t:.state}],'
    + 'greptile:([.comments[]?|select(.body|contains("greptile_summary"))|.body]|last)}|tojson'
  return urls.map(url => `gh pr view '${url}' --json url,state,baseRefName,mergedAt,headRefOid,statusCheckRollup,comments --jq '${jq}' `
    + `|| echo '{"url":"${url}","error":true}'`).join('\n')
}

/**
 * Run gh for the given PR URLs.
 * @param options - `{ distro }`: the WSL distribution on Windows; undefined uses the default one.
 * @returns parsed answers; a PR gh could not read carries `error: true`.
 */
export function fetchPrs(urls, { distro }) {
  const script = viewScript(urls)
  const [command, args] = process.platform === 'win32'
    ? ['wsl.exe', [...(distro === undefined ? [] : ['-d', distro]), '--', 'bash', '-lc', `echo ${Buffer.from(script).toString('base64')} | base64 -d | bash`]]
    : ['bash', ['-lc', script]]
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      // wsl.exe reports noise on stderr and a nonzero exit even when gh succeeded, so the output decides.
      const answers = String(stdout ?? '').split('\n').filter(line => line.startsWith('{')).flatMap((line) => {
        try { return [JSON.parse(line)] } catch (_partialLine) { return [] }
      })
      if (answers.length === 0 && error) reject(error)
      else resolve(answers)
    })
  })
}

/**
 * Poll due PRs once a minute and write their state back to the board.
 * @returns a disposer stopping the timer.
 */
export function startGitHubPolling({ store, logger, distro, fetch = fetchPrs, onChange = () => {} }) {
  let busy = false
  let lastError = ''
  const due = (pr, now) => {
    if (pr.state === 'MERGED' || pr.state === 'CLOSED') return false
    const interval = pr.checks === 'pending' || pr.checks === undefined ? PENDING_INTERVAL_MS : SETTLED_INTERVAL_MS
    return pr.polledAt === undefined || now - Date.parse(pr.polledAt) >= interval
  }
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const board = await store.read()
      const now = Date.now()
      const urls = [...new Set(board.cards.flatMap(card => card.prs.filter(pr => due(pr, now)).map(pr => pr.url)))].slice(0, MAX_PER_TICK)
      if (urls.length === 0) return
      const answers = await fetch(urls, { distro })
      const byKey = new Map()
      for (const answer of answers) {
        const parsed = parsePrUrl(answer.url)
        if (parsed !== undefined && answer.error !== true) byKey.set(parsed.key, prStateOf(answer))
      }
      const polledAt = new Date().toISOString()
      const changed = await store.mutate((draft) => {
        let any = false
        for (const card of draft.cards) {
          let touched = false
          for (const pr of card.prs) {
            if (!urls.includes(pr.url)) continue
            const state = byKey.get(prKey(pr))
            Object.assign(pr, state ?? {}, { polledAt })
            touched = true
          }
          if (touched) {
            any = true
            advanceFromPrs(card, polledAt)
          }
        }
        return any ? true : UNCHANGED
      })
      if (changed !== UNCHANGED) onChange()
      lastError = ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== lastError) logger.warn('kanban: GitHub polling failed', error)
      lastError = message
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void tick() }, TICK_MS)
  return { tick, dispose: () => clearInterval(timer) }
}
