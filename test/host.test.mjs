// Host test for dsh-wishing-well with a fake Cordis context (no DSH runtime, no gh).
// Usage: node test/host.test.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attentionOf, presentBoard } from '../board.js'
import { advanceFromPrs, parseGreptile, prStateOf, startGitHubPolling, summarizeChecks } from '../github.js'
import { apply, createdIssue, createdPrUrls, inject, name } from '../index.js'

assert.equal(name, 'kanban')
assert.deepEqual(inject, ['connection', 'tools'])
const dir = await mkdtemp(join(tmpdir(), 'kanban-test-'))
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

// ---------- github.js pure functions ----------
assert.equal(summarizeChecks([]), 'none')
assert.equal(summarizeChecks([{ s: 'COMPLETED', c: 'SUCCESS' }, { s: 'COMPLETED', c: 'SKIPPED' }]), 'passing')
assert.equal(summarizeChecks([{ s: 'IN_PROGRESS', c: '' }, { s: 'COMPLETED', c: 'SUCCESS' }]), 'pending')
assert.equal(summarizeChecks([{ s: 'IN_PROGRESS' }, { s: 'COMPLETED', c: 'FAILURE' }]), 'failing')
assert.equal(summarizeChecks([{ t: 'PENDING' }]), 'pending')
assert.equal(summarizeChecks([{ t: 'ERROR' }]), 'failing')
const greptileBody = '<!-- greptile_summary -->\n<h2><a href="x">r</a>Confidence Score: 4/5</h2>\n...\n<sub>Reviews (1) · Last reviewed commit: ["ENG-7996 Label..."](https://github.com/acme/web-app/commit/0123456789abcdef0123456789abcdef01234567) · [Reviewed by Greptile](https://x)</sub>'
assert.deepEqual(parseGreptile(greptileBody, '0123456789abcdef0123456789abcdef01234567'), { score: 4, scoreCommit: '0123456789abcdef0123456789abcdef01234567', scoreStale: false })
assert.equal(parseGreptile(greptileBody, 'fedcba9876543210fedcba9876543210fedcba98').scoreStale, true)
assert.deepEqual(parseGreptile('no score here', 'abc'), {})
assert.deepEqual(parseGreptile(undefined, 'abc'), {})

// ---------- PR / issue detection from tool calls ----------
const prText = 'Creating pull request for user/eng-1 into develop in acme/api-server\n\nhttps://github.com/acme/api-server/pull/42\n'
assert.deepEqual(createdPrUrls({ rawArgs: '{"command":"gh pr list"}' }, 'https://github.com/a/b/pull/1'), [])
assert.deepEqual(createdPrUrls({ rawArgs: '{"command":"gh pr view 1 --json url --jq .url"}' }, 'https://github.com/a/b/pull/1\n'), [])
assert.deepEqual(createdPrUrls({ rawArgs: '{"command":"gh pr create --fill"}' }, 'https://github.com/a/b/pull/7\n'), ['https://github.com/a/b/pull/7'])
assert.deepEqual(createdPrUrls(undefined, prText), ['https://github.com/acme/api-server/pull/42'])
assert.deepEqual(createdPrUrls({ rawArgs: '{"command":"echo eA== | base64 -d | bash"}' }, 'pushed\nhttps://github.com/a/b/pull/9\n'), ['https://github.com/a/b/pull/9'])
assert.deepEqual(createdPrUrls({ rawArgs: '{"command":"echo eA== | base64 -d | bash"}' }, 'see https://github.com/a/b/pull/9 for details'), [])
const linearCall = { name: 'mcp__linear__save_issue', args: { title: 'x', team: 'ENG' } }
assert.deepEqual(createdIssue(linearCall, '{"id":"uuid","identifier":"ENG-8123","url":"https://linear.app/acme/issue/ENG-8123/x"}'), { issue: 'ENG-8123', issueUrl: 'https://linear.app/acme/issue/ENG-8123/x' })
assert.equal(createdIssue({ ...linearCall, args: { id: 'ENG-1', title: 'edit' } }, '"identifier":"ENG-1"'), undefined)
assert.equal(createdIssue({ name: 'Read', args: {} }, 'ENG-1'), undefined)

// ---------- mount with a fake context ----------
function mount(file, fetchPrs = async () => []) {
  const mounted = { route: undefined, tool: undefined, warnings: [], listeners: {}, effects: [] }
  const ctx = {
    effect: (fn) => { mounted.effects.push(fn()) },
    logger: { warn: (...args) => mounted.warnings.push(args) },
    connection: { fetch: { register: (route) => { mounted.route = route; return async () => {} } } },
    tools: { register: (tool) => { mounted.tool = tool; return () => {} } },
    on: (event, listener) => { mounted.listeners[event] = listener },
    get: name => (name === 'sessionTitle' ? { get: () => undefined } : undefined),
  }
  apply(ctx, { file, fetchPrs })
  mounted.emit = (session, type, data) => mounted.listeners['session/event'](session, { type, data })
  mounted.board = async () => (await (await mounted.route.fetch(new Request('http://x/api/kanban/board'))).json()).board
  mounted.call = async (op, args) => {
    const response = await mounted.route.fetch(new Request('http://x/api/kanban/board', { method: 'POST', body: JSON.stringify({ op, args }) }))
    return { status: response.status, body: await response.json() }
  }
  mounted.run = (args, sessionId) => mounted.tool.execute(args, { signal: new AbortController().signal, agent: { session: { id: sessionId } } })
  mounted.dispose = () => { for (const effect of mounted.effects) if (typeof effect === 'function') effect() }
  return mounted
}
const human = text => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

// ---------- automatic lifecycle from Session events ----------
const file = join(dir, 'board.json')
const prAnswers = new Map()
const k = mount(file, async urls => urls.map(url => prAnswers.get(url) ?? { url, error: true }))
const S = { id: 'sess-A', header: {} }
await k.emit(S, 'turn/start', { turn: 1 })
await k.emit(S, 'user/message', human('  帮我做一个导出 CSV 的功能，\n需求见 Notion  '))
let board = await k.board()
assert.equal(board.cards.length, 1)
let card = board.cards[0]
assert.equal(card.column, 'plan')
assert.equal(card.title, '帮我做一个导出 CSV 的功能， 需求见 Notion')
assert.deepEqual(card.sessions, ['sess-A'])
assert.deepEqual(card.gates, { plan: 'human', local: 'human', merge: 'human' })
assert.equal(card.running, true)
// A second message does not create another card; a generated title replaces the provisional one.
await k.emit(S, 'user/message', human('补充一点'))
await k.emit(S, 'session/title', { title: '导出 CSV', source: { kind: 'provider' } })
board = await k.board()
assert.equal(board.cards.length, 1)
assert.equal(board.cards[0].title, '导出 CSV')
// Injected (non-human) messages and subagent sessions are ignored.
await k.emit({ id: 'sess-sub', header: { origin: 'subagent' } }, 'user/message', human('child'))
await k.emit({ id: 'sess-cron', header: {} }, 'user/message', { source: { kind: 'schedule' }, content: [{ type: 'text', text: 'cron' }] })
assert.equal((await k.board()).cards.length, 1)
// The agent reports the plan waiting for review: attention, then the next turn clears it.
await k.run({ action: 'update', status: '方案等你 review', waiting: true }, 'sess-A')
await k.emit(S, 'turn/end', { turn: 1, reason: 'completed' })
board = await k.board()
assert.equal(board.cards[0].attention, '方案等你 review')
assert.equal(board.cards[0].running, false)
await k.emit(S, 'turn/start', { turn: 2 })
board = await k.board()
assert.equal(board.cards[0].waiting, undefined)
assert.equal(board.cards[0].status, undefined)
assert.equal(board.cards[0].attention, undefined)
// The first Edit moves plan -> dev; the editing turn's end moves dev -> verify.
await k.emit(S, 'tool/call', { turn: 2, step: 1, callId: 'c1', name: 'Edit', arguments: '{}' })
assert.equal((await k.board()).cards[0].column, 'dev')
await k.emit(S, 'turn/end', { turn: 2, reason: 'completed' })
board = await k.board()
assert.equal(board.cards[0].column, 'verify')
assert.equal(board.cards[0].attention, '等你本地验收')
// The user's next turn sends it back to dev; a turn without edits leaves it in dev.
await k.emit(S, 'turn/start', { turn: 3 })
assert.equal((await k.board()).cards[0].column, 'dev')
await k.emit(S, 'turn/end', { turn: 3, reason: 'completed' })
assert.equal((await k.board()).cards[0].column, 'dev')
// Creating the Linear issue records it.
await k.emit(S, 'turn/start', { turn: 4 })
await k.emit(S, 'tool/call', { turn: 4, step: 1, callId: 'c2', name: 'mcp__linear__save_issue', arguments: '{"title":"导出","team":"ENG"}' })
await k.emit(S, 'tool/result', { turn: 4, step: 1, message: { toolCallId: 'c2', content: [{ type: 'text', text: '{"identifier":"ENG-8123","url":"https://linear.app/acme/issue/ENG-8123/x"}' }] } })
board = await k.board()
assert.equal(board.cards[0].issue, 'ENG-8123')
assert.equal(board.cards[0].issueUrl, 'https://linear.app/acme/issue/ENG-8123/x')
// gh pr create attaches the PR and moves the card to pr; the poll fills CI and Greptile state.
const prUrl = 'https://github.com/acme/api-server/pull/42'
prAnswers.set(prUrl, { url: prUrl, state: 'OPEN', base: 'develop', head: 'abc1234def', checks: [{ s: 'IN_PROGRESS' }] })
await k.emit(S, 'tool/call', { turn: 4, step: 2, callId: 'c3', name: 'pwsh', arguments: '{"command":"gh pr create --fill"}' })
await k.emit(S, 'tool/result', { turn: 4, step: 2, message: { toolCallId: 'c3', content: [{ type: 'text', text: `${prUrl}\n` }] } })
board = await k.board()
assert.equal(board.cards[0].column, 'pr')
assert.equal(board.cards[0].prs.length, 1)
await new Promise(resolve => setTimeout(resolve, 1200))
board = await k.board()
assert.equal(board.cards[0].prs[0].checks, 'pending')
assert.equal(board.cards[0].attention, undefined, 'running session and pending CI need nobody')
// Editing turns with an open PR stay in pr (review fixes); finished turn with passing CI waits for the merge check.
await k.emit(S, 'tool/call', { turn: 4, step: 3, callId: 'c4', name: 'Write', arguments: '{}' })
await k.emit(S, 'turn/end', { turn: 4, reason: 'completed' })
assert.equal((await k.board()).cards[0].column, 'pr')
const cardId = board.cards[0].id

// ---------- attention rules ----------
const running = new Set()
const base = { id: 'x', sessions: ['s'], prs: [], gates: { plan: 'human', local: 'human', merge: 'human' }, updatedAt: new Date().toISOString() }
const at = (card, now = Date.now(), r = running) => attentionOf({ ...base, ...card }, { now, running: r })
assert.equal(at({ column: 'pr', prs: [{ checks: 'passing', state: 'OPEN' }] }), '可以合并，等你检查')
assert.equal(at({ column: 'pr', prs: [{ checks: 'passing', state: 'OPEN' }], gates: { ...base.gates, merge: 'auto' } }), undefined)
assert.equal(at({ column: 'pr', prs: [{ checks: 'passing', state: 'OPEN', score: 4, scoreStale: true }] }), undefined, 'stale review is not ready')
assert.equal(at({ column: 'pr', prs: [{ checks: 'passing', state: 'OPEN', score: 3 }] }), 'Greptile 3/5，需要处理')
assert.equal(at({ column: 'pr', prs: [{ checks: 'failing', state: 'OPEN' }] }), 'CI 失败')
assert.equal(at({ column: 'pr', prs: [{ checks: 'failing', state: 'OPEN' }] }, Date.now(), new Set(['s'])), undefined, 'someone is fixing it')
assert.equal(at({ column: 'pr', prs: [{ checks: 'pending', state: 'OPEN' }] }), undefined)
assert.equal(at({ column: 'release' }), '等你安排上线')
assert.equal(at({ column: 'staging', updatedAt: new Date(Date.now() - 7 * 3600e3).toISOString() }), 'Staging 超过 6 小时无进展')
assert.equal(at({ column: 'staging' }), undefined)
const p1 = presentBoard({ revision: 1, cards: [{ ...base, column: 'pr', prs: [{ checks: 'pending', state: 'OPEN' }] }] }, new Set())
const p2 = presentBoard({ revision: 1, cards: [{ ...base, column: 'pr', prs: [{ checks: 'pending', state: 'OPEN' }] }] }, new Set(['s']))
assert.notEqual(p1.version, p2.version, 'running state changes the version without a new revision')

// ---------- polling transitions ----------
const now = new Date().toISOString()
const prCard = (prs, column = 'pr') => ({ column, prs, sessions: [], updatedAt: now })
let c = prCard([{ state: 'MERGED', base: 'develop' }, { state: 'OPEN', base: 'develop' }])
assert.equal(advanceFromPrs(c, now), false)
c = prCard([{ state: 'MERGED', base: 'develop' }, { state: 'CLOSED', base: 'develop' }])
assert.equal(advanceFromPrs(c, now), true)
assert.equal(c.column, 'staging')
c = prCard([{ state: 'MERGED', base: 'main' }])
advanceFromPrs(c, now)
assert.equal(c.column, 'done')
c = prCard([{ state: 'OPEN' }], 'verify')
advanceFromPrs(c, now)
assert.equal(c.column, 'pr')
c = prCard([{ state: 'MERGED', base: 'develop' }], 'release')
assert.equal(advanceFromPrs(c, now), false, 'later columns never move back')
assert.equal(prStateOf({ state: 'OPEN', checks: [] }).checks, 'none')

// The scheduled tick merges the PR and moves the card to staging, recording the Greptile score.
prAnswers.set(prUrl, { url: prUrl, state: 'MERGED', base: 'develop', head: 'abc1234def', mergedAt: now, checks: [{ s: 'COMPLETED', c: 'SUCCESS' }], greptile: '<!-- greptile_summary -->Confidence Score: 5/5 Last reviewed commit: [x](https://github.com/o/r/commit/abc1234)' })
const merged = mount(file, async urls => urls.map(url => prAnswers.get(url)))
// Force the PR due by clearing its poll time through the route.
await merged.call('update', { id: cardId, prs: [prUrl] })
board = await merged.board()
const pr = board.cards.find(other => other.id === cardId).prs[0]
assert.equal(pr.checks, 'pending', 'replacing the list keeps polled state for the same PR')
const poller = startGitHubPolling({ store: { read: async () => ({ cards: [] }), mutate: async () => {} }, logger: { warn() {} }, distro: 'x', fetch: async () => [] })
poller.dispose()
merged.dispose()
k.dispose()

// ---------- tool: link, gates, add, remove, list ----------
const t = mount(join(dir, 'tool.json'))
await t.emit({ id: 'sess-B', header: {} }, 'user/message', human('继续做 ENG-8123'))
board = await t.board()
assert.equal(board.cards.length, 1)
const main = (await t.run({ action: 'add', title: '导出 CSV', column: 'dev', session: 'none', issue: 'ENG-8123' }, 'sess-B')).card
assert.deepEqual(main.sessions, [])
board = await t.board()
assert.equal(board.cards.length, 2)
// link moves sess-B onto the existing card and drops its empty auto card.
let out = await t.run({ action: 'link', id: main.id }, 'sess-B')
assert.deepEqual(out.card.sessions, ['sess-B'])
board = await t.board()
assert.deepEqual(board.cards.map(other => other.id), [main.id])
// update without id targets this session's card; gates and PRs apply.
out = await t.run({ action: 'update', merge_gate: 'auto', local_gate: 'auto', pr: 'https://github.com/acme/web-app/pull/7', source: 'https://www.notion.so/x' }, 'sess-B')
assert.deepEqual(out.card.gates, { plan: 'human', local: 'auto', merge: 'auto' })
assert.equal(out.card.prs[0].repo, 'acme/web-app')
assert.deepEqual(out.card.sources, ['https://www.notion.so/x'])
assert.match(out.text, /merge_gate:auto/)
await assert.rejects(t.run({ action: 'update', pr: 'https://github.com/a/b/issues/1' }, 'sess-B'), /not a GitHub pull request URL/)
await assert.rejects(t.run({ action: 'update', column: 'qa' }, 'sess-B'), /column must be one of/)
await assert.rejects(t.run({ action: 'update', column: 'dev' }, 'sess-nobody'), /this session has no card/)
// With local_gate auto, an editing turn stays in dev.
await t.run({ action: 'update', column: 'dev', remove_pr: 'https://github.com/acme/web-app/pull/7' }, 'sess-B')
await t.emit({ id: 'sess-B', header: {} }, 'turn/start', { turn: 1 })
await t.emit({ id: 'sess-B', header: {} }, 'tool/call', { turn: 1, step: 1, callId: 'e', name: 'Edit', arguments: '{}' })
await t.emit({ id: 'sess-B', header: {} }, 'turn/end', { turn: 1, reason: 'completed' })
assert.equal((await t.board()).cards[0].column, 'dev')
out = await t.run({ action: 'list', session: 'current' }, 'sess-B')
assert.equal(out.cards.length, 1)
// remove dismisses the session: no new card on its next message.
await t.run({ action: 'remove' }, 'sess-B')
await t.emit({ id: 'sess-B', header: {} }, 'user/message', human('again'))
assert.equal((await t.board()).cards.length, 0)
// Explicit add re-enables tracking of that session.
await t.run({ action: 'add', title: 'retrack' }, 'sess-B')
board = await t.board()
assert.deepEqual(board.cards[0].sessions, ['sess-B'])
// Route unlink dismisses the session too.
await t.call('unlink', { id: board.cards[0].id, sessionId: 'sess-B' })
await t.emit({ id: 'sess-B', header: {} }, 'user/message', human('again 2'))
assert.equal((await t.board()).cards.length, 1)
t.dispose()

// ---------- plugin reload in the middle of an editing turn ----------
// The edit is seen by one plugin instance; the turn end by the next one,
// as when the bundle is reinstalled or the Host restarts mid-turn.
const reloadFile = join(dir, 'reload.json')
const R = { id: 'sess-R', header: {} }
const before = mount(reloadFile)
await before.emit(R, 'user/message', human('做个东西'))
await before.emit(R, 'turn/start', { turn: 3 })
await before.emit(R, 'tool/call', { turn: 3, step: 1, callId: 'r1', name: 'Edit', arguments: '{}' })
await before.run({ action: 'update', status: 'v2 已装好，等你刷新确认', waiting: true }, 'sess-R')
before.dispose()
const after = mount(reloadFile)
// The new instance sees only the rest of the turn, without its turn/start.
await after.emit(R, 'tool/call', { turn: 3, step: 2, callId: 'r2', name: 'pwsh', arguments: '{}' })
await after.emit(R, 'turn/end', { turn: 3, reason: 'completed' })
board = await after.board()
assert.equal(board.cards[0].column, 'verify', 'an edit seen before the reload still sends the card to verification')
assert.equal(board.cards[0].status, 'v2 已装好，等你刷新确认', 'the status written this turn survives the move')
assert.equal(board.cards[0].attention, '等你本地验收')
assert.equal(board.cards[0].editedTurn, undefined)
// A later turn without edits leaves the card where the user's next message put it.
await after.emit(R, 'turn/start', { turn: 4 })
assert.equal((await after.board()).cards[0].column, 'dev')
await after.emit(R, 'turn/end', { turn: 4, reason: 'completed' })
assert.equal((await after.board()).cards[0].column, 'dev')
// A stale edit mark from a turn whose end was never seen does not fire on a later turn.
await after.emit(R, 'tool/call', { turn: 5, step: 1, callId: 'r3', name: 'Write', arguments: '{}' })
after.dispose()
const later = mount(reloadFile)
await later.emit(R, 'turn/start', { turn: 6 })
await later.emit(R, 'turn/end', { turn: 6, reason: 'completed' })
assert.equal((await later.board()).cards[0].column, 'dev')
later.dispose()

// ---------- migration from the first board format ----------
const legacyFile = join(dir, 'legacy.json')
await writeFile(legacyFile, JSON.stringify({
  revision: 4,
  cards: [{ id: 'k-old', title: 'old', column: 'review', sessionId: 'sess-Z', pr: 'https://github.com/o/r/pull/3', createdAt: now, updatedAt: now }],
  dismissed: ['sess-gone'],
}), 'utf8')
const legacy = mount(legacyFile)
board = await legacy.board()
assert.equal(board.cards[0].column, 'pr')
assert.deepEqual(board.cards[0].sessions, ['sess-Z'])
assert.equal(board.cards[0].sessionId, undefined)
assert.equal(board.cards[0].prs[0].url, 'https://github.com/o/r/pull/3')
assert.deepEqual(board.cards[0].gates, { plan: 'human', local: 'human', merge: 'human' })
await legacy.emit({ id: 'sess-gone', header: {} }, 'user/message', human('x'))
assert.equal((await legacy.board()).cards.length, 1)
legacy.dispose()

// ---------- persistence safety ----------
const bulk = mount(join(dir, 'bulk.json'))
await Promise.all(Array.from({ length: 20 }, (_, i) => bulk.call('add', { title: `bulk ${i}` })))
assert.equal(JSON.parse(await readFile(join(dir, 'bulk.json'), 'utf8')).cards.length, 20)
bulk.dispose()
const corruptFile = join(dir, 'corrupt.json')
await writeFile(corruptFile, '{ not json', 'utf8')
const corrupt = mount(corruptFile)
assert.equal((await corrupt.route.fetch(new Request('http://x/api/kanban/board'))).status, 500)
await corrupt.emit({ id: 's', header: {} }, 'user/message', human('x'))
await settle()
assert.equal(await readFile(corruptFile, 'utf8'), '{ not json')
assert.ok(corrupt.warnings.length >= 2)
corrupt.dispose()

await rm(dir, { recursive: true, force: true })
console.log('ALL HOST TESTS PASSED')
