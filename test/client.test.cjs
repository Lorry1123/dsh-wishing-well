// Render smoke test for dsh-wishing-well/client.js with a minimal fake React (no DOM).
// Usage: node test/client.test.cjs
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
// Values built inside the vm context carry that realm's prototypes, so deep
// comparisons use the prototype-agnostic legacy deepEqual.
const assert = { ...require('node:assert/strict'), deepEqual: require('node:assert').deepEqual }

const FRAGMENT = Symbol('Fragment')
let stateOverrides = []
const React = {
  Fragment: FRAGMENT,
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.flat(Infinity) } }),
  useState: (init) => {
    const override = stateOverrides.length > 0 ? stateOverrides.shift() : undefined
    return [override !== undefined ? override : (typeof init === 'function' ? init() : init), () => {}]
  },
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: () => ({ current: null }),
  useId: (() => { let n = 0; return () => `:r${n++}:` })(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) return node.map(render).filter(n => n !== null)
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { type: node.type, props: { ...node.props, children: render(node.props.children) } }
}
function text(node) {
  if (node === null || node === undefined) return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node !== 'object') return String(node)
  return text(node.props.children)
}
function find(node, predicate, out = []) {
  if (Array.isArray(node)) { node.forEach(n => find(n, predicate, out)); return out }
  if (node && typeof node === 'object') {
    if (predicate(node)) out.push(node)
    find(node.props.children, predicate, out)
  }
  return out
}
const buttons = (tree, label) => find(tree, n => n.type === 'button' && text(n) === label)

// Load the module through a fake module loader and browser globals.
const notifications = []
class FakeNotification {
  constructor(title, options) { this.title = title; this.options = options; notifications.push(this) }
  close() {}
}
FakeNotification.permission = 'granted'
let factoryModule
// The plugin's own store polls the Host route; this stands in for the Host answer.
let hostBoard = { revision: 0, version: '0:a', cards: [] }
const focusHandlers = []
const sandbox = {
  window: {
    __ModuleLoader__: { load: ({ id, factory }) => { factoryModule = { id, exports: factory(n => { assert.equal(n, 'react'); return React }) } } },
    addEventListener: (type, fn) => { if (type === 'focus') focusHandlers.push(fn) },
    removeEventListener() {},
    focus() {},
  },
  fetch: async () => ({ status: 200, json: async () => ({ ok: true, board: hostBoard }) }),
  document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, baseURI: 'http://127.0.0.1/', visibilityState: 'visible' },
  Notification: FakeNotification,
  console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Array, Symbol, Promise, Number, String, Set, Map, RegExp, Error,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8'), sandbox, { filename: 'client.js' })
assert.equal(factoryModule.id, '@local/dsh-wishing-well')
const plugin = factoryModule.exports
assert.deepEqual([...plugin.inject], ['slots', 'uiWorkspace', 'sessions', 'contextMenus'])

const registered = {}
const effects = []
const calls = { mutate: [], open: [], start: [] }
const now = Date.now()
const iso = minutes => new Date(now - minutes * 60000).toISOString()
const gates = { plan: 'human', local: 'human', merge: 'human' }
const card = (fields) => ({ sessions: [], prs: [], sources: [], gates, createdAt: iso(5), updatedAt: iso(5), ...fields })
const cards = [
  card({ id: 'k-1', title: '修复登录', column: 'todo', note: '复现步骤见 ENG-1', sources: ['https://www.notion.so/team/login'] }),
  card({ id: 'k-2', title: '导出报表', column: 'dev', sessions: ['s-1'], running: true, status: '写单测中', updatedAt: iso(90) }),
  card({ id: 'k-3', title: '等你合并的卡', column: 'pr', sessions: ['s-gone'], issue: 'ENG-42', issueUrl: 'https://linear.app/acme/issue/ENG-42', attention: '可以合并，等你检查', gates: { ...gates, merge: 'auto' }, updatedAt: iso(3000),
    prs: [
      { url: 'https://github.com/acme/web-app/pull/42', repo: 'acme/web-app', number: 42, state: 'OPEN', checks: 'passing', score: 4 },
      { url: 'https://github.com/acme/api-server/pull/7', repo: 'acme/api-server', number: 7, state: 'OPEN', checks: 'failing', score: 3, scoreStale: true },
    ] }),
  card({ id: 'k-4', title: '已上线', column: 'done', sessions: ['s-1'], updatedAt: iso(1), doneAt: iso(1) }),
]
let snapshot = { status: 'ready', cards, version: '3:a', error: '' }
const listeners = new Set()
const fakeStore = {
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  getSnapshot: () => snapshot,
  mutate: async (op, args) => { calls.mutate.push([op, args]); return { ok: true } },
}
const sessionsSnapshot = { ids: ['s-1'], byId: { 's-1': { title: '导出会话', cwd: '\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\workspace\\api-server' } } }
const menuIcons = {}
const menuContributions = []
const ctx = {
  effect: (fn) => { effects.push(fn()) },
  sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
  uiWorkspace: { openSession: id => calls.open.push(id), startSession: (ws, opts) => calls.start.push([ws, opts]) },
  contextMenus: { register: (contribution) => { menuContributions.push(contribution); return () => {} } },
  slots: {
    // Like ui-slots, a generator callback registers every value it yields.
    inject: (n, fn) => { const result = fn(); if (result && typeof result.next === 'function') for (const _ of result) { /* drain */ } },
    register: (def, component) => {
      if (def.name === 'contextMenu.icon') menuIcons[def.key] = component
      else registered[def.name] = { def, component }
      return () => {}
    },
  },
}
plugin.apply(ctx)
assert.ok([...plugin.inject].includes('contextMenus'))
assert.deepEqual(Object.keys(registered).sort(), ['main', 'sidebar.panellist', 'sidebar.session.row.hover', 'sidebar.session.row.trailing'])
assert.equal(menuContributions.length, 1)
assert.equal(menuContributions[0].target, 'session')
assert.deepEqual(Object.keys(menuIcons).sort(), ['business', 'idle', 'ready', 'success', 'warn'].flatMap(t => [`kanban.stage.${t}`, `kanban.stage.${t}.next`]).sort())
assert.equal(registered['sidebar.panellist'].def.label, '许愿池')
const withStore = name => ({ ...registered[name].def.inject(), store: fakeStore })
const pageProps = withStore('main')

// 1. Board page: eight columns, attention, running, PR chips, gates, sources.
let tree = render(React.createElement(registered.main.component, pageProps))
const all = text(tree)
for (const label of ['许愿池', '方案', '开发中', '待验收', 'PR·CI', 'Staging', '待上线', '已上线', '3 项进行中', '等我处理 1',
  '可以合并，等你检查', '进行中', '写单测中', 'web-app#42', 'G 4/5', 'api-server#7', 'G 3/5 旧', 'ENG-42', 'AI 合并', '需求 · Notion',
  '会话 · 导出会话', '会话 · 会话已不可用', 'api-server', '开工', '2 天前']) {
  assert.ok(all.includes(label), `board page should show ${label}`)
}
const attentionCard = find(tree, n => n.type === 'article' && n.props['aria-label'] === '等你合并的卡')[0]
assert.match(attentionCard.props.className, /dk-card-attention/)
assert.equal(find(tree, n => n.type === 'section').length, 8)
const failingDot = find(attentionCard, n => n.type === 'span' && n.props.title === 'CI 失败')
assert.equal(failingDot.length, 1)
assert.match(failingDot[0].props.className, /dk-tone-error/)
// Start puts the card, its note and sources into a new-session draft that asks for link.
buttons(tree, '开工')[0].props.onClick()
assert.match(calls.start[0][1].prompt, /^修复登录\n\n复现步骤见 ENG-1\n\nhttps:\/\/www\.notion\.so\/team\/login\n\n（看板卡片 k-1：开始前先用 kanban 工具的 link/)
// Session links: available opens, unavailable disabled.
const sessionLinks = find(tree, n => n.type === 'button' && text(n).startsWith('会话 · '))
assert.equal(sessionLinks.find(n => text(n) === '会话 · 会话已不可用').props.disabled, true)
sessionLinks.find(n => text(n) === '会话 · 导出会话').props.onClick()
assert.deepEqual(calls.open, ['s-1'])
// Arrows move between adjacent columns.
const todoCard = find(tree, n => n.type === 'article' && n.props['aria-label'] === '修复登录')[0]
const arrows = find(todoCard, n => n.type === 'button' && (text(n) === '←' || text(n) === '→'))
assert.equal(arrows[0].props.disabled, true)
arrows[1].props.onClick()
assert.deepEqual(calls.mutate.at(-1), ['update', { id: 'k-1', column: 'plan', beforeId: undefined }])
// "等我处理" filter shows only attention cards. Hook order: useNow, projectFilter, attentionOnly.
stateOverrides = [undefined, undefined, true]
tree = render(React.createElement(registered.main.component, pageProps))
assert.deepEqual(find(tree, n => n.type === 'article').map(n => n.props['aria-label']), ['等你合并的卡'])
// Editor on k-3: PR lines, gate selects, session unlink. Hook order adds adding, editing.
stateOverrides = [undefined, undefined, undefined, undefined, 'k-3']
tree = render(React.createElement(registered.main.component, pageProps))
const form = find(tree, n => n.props && n.props.className === 'dk-form')[0]
const areas = find(form, n => n.type === 'textarea').map(n => n.props.value)
assert.equal(areas[0], 'https://github.com/acme/web-app/pull/42\nhttps://github.com/acme/api-server/pull/7')
assert.deepEqual(find(form, n => n.type === 'select').map(n => n.props.value), ['human', 'human', 'auto'])
assert.ok(text(form).includes('取消关联'))
stateOverrides = []
// Empty board onboarding hint.
snapshot = { status: 'ready', cards: [], version: '0:x', error: '' }
assert.ok(text(render(React.createElement(registered.main.component, pageProps))).includes('新会话发出第一条消息后会自动上看板'))
snapshot = { status: 'ready', cards, version: '3:a', error: '' }

// 2. Navigation icon shows the waiting count, capped at 9+, and nothing when none waits.
const navIcon = size => render(React.createElement(registered['sidebar.panellist'].component, { ...withStore('sidebar.panellist'), size }))
const countOf = t => find(t, n => n.props.className === 'dk-nav-count').map(text)
tree = navIcon(18)
assert.deepEqual(countOf(tree), ['1'])
assert.equal(find(tree, n => n.type === 'svg')[0].props.width, 18)
snapshot = { ...snapshot, cards: Array.from({ length: 12 }, (_, i) => ({ ...cards[2], id: `w-${i}` })) }
assert.deepEqual(countOf(navIcon(16)), ['9+'])
snapshot = { ...snapshot, cards: Array.from({ length: 9 }, (_, i) => ({ ...cards[2], id: `w-${i}` })) }
assert.deepEqual(countOf(navIcon(16)), ['9'])
snapshot = { ...snapshot, cards: cards.map(c => ({ ...c, attention: undefined })) }
assert.deepEqual(countOf(navIcon(16)), [])
snapshot = { status: 'ready', cards, version: '3:a', error: '' }
// The large sparkle paints with this instance's gradient; two instances never share an id.
const gradientIdOf = t => find(t, n => n.type === 'linearGradient')[0].props.id
const firstId = gradientIdOf(tree)
assert.match(firstId, /^dk-wish-[A-Za-z0-9_-]+$/)
assert.equal(find(tree, n => n.type === 'path')[0].props.fill, `url(#${firstId})`)
const second = render(React.createElement(registered['sidebar.panellist'].component, { ...withStore('sidebar.panellist'), size: 16 }))
assert.notEqual(gradientIdOf(second), firstId)

// 3. Session row labels / hover. s-1 has an open dev card and a done card: the open one wins.
const rowProps = withStore('sidebar.session.row.trailing')
const row = (slot, sessionId) => render(React.createElement(registered[slot].component, { ...rowProps, sessionId }))
tree = row('sidebar.session.row.trailing', 's-1')
assert.equal(text(tree), '开发')
assert.match(tree.props.className, /dk-trail/)
assert.match(tree.props.className, /dk-tone-business/)
tree = row('sidebar.session.row.trailing', 's-gone')
assert.equal(text(tree), '! PR')
assert.match(tree.props.className, /dk-badge-attention/)
assert.equal(row('sidebar.session.row.trailing', 's-none'), null)
// A Session whose only card has shipped shows no label at all.
snapshot = { ...snapshot, cards: cards.filter(c => c.id !== 'k-2') }
assert.equal(row('sidebar.session.row.trailing', 's-1'), null)
assert.equal(text(row('sidebar.session.row.hover', 's-1')).startsWith('看板 · 已上线'), true, 'the hover card still names the shipped stage')
snapshot = { status: 'ready', cards, version: '3:a', error: '' }
tree = row('sidebar.session.row.hover', 's-gone')
assert.ok(text(tree).includes('看板 · PR·CI') && text(tree).includes('可以合并，等你检查') && text(tree).includes('web-app#42 CI 通过 G4/5'))
assert.equal(find(tree, n => n.props && n.props.className === 'dk-hover-label').length, 1)
// Row placement is verified in a real browser by test/row-layout.cjs.

// 4. Menu icons: a tone dot; the next-step variant carries the bold marker.
tree = render(React.createElement(menuIcons['kanban.stage.warn.next'], { icon: { key: 'kanban.stage.warn.next' } }))
assert.match(tree.props.className, /dk-menu-dot dk-tone-warn dk-next-mark/)
tree = render(React.createElement(menuIcons['kanban.stage.idle'], { icon: { key: 'kanban.stage.idle' } }))
assert.equal(tree.props.className, 'dk-menu-dot dk-tone-idle')
const pluginCss = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
assert.match(pluginCss, /\[role="menuitem"\]:has\(\.dk-next-mark\) \{ font-weight: 600; \}/)

// 5. Notifications through the plugin's own store: the first answer is a
// baseline; a newly waiting card notifies once, and repeats do not.
const flush = () => new Promise(resolve => setTimeout(resolve, 10))
const refreshFromHost = async () => { for (const handler of focusHandlers) handler(); await flush() }
;(async () => {
  hostBoard = { revision: 3, version: '3:a', cards }
  await refreshFromHost()
  assert.equal(notifications.length, 0, 'opening the app does not replay existing reasons')
  hostBoard = { revision: 4, version: '4:b', cards: cards.map(c => (c.id === 'k-2' ? { ...c, column: 'verify', attention: '等你本地验收' } : c)) }
  await refreshFromHost()
  hostBoard = { ...hostBoard, version: '4:c' }
  await refreshFromHost()
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].title, '看板 · 等你本地验收')
  assert.equal(notifications[0].options.body, '导出报表')
  notifications[0].onclick()
  assert.deepEqual(calls.open.at(-1), 's-1')

  // 6. Session context menu, resolved from the plugin's own board snapshot.
  const posted = []
  sandbox.fetch = async (_url, init) => {
    if (init && init.method === 'POST') {
      posted.push(JSON.parse(init.body))
      return { status: 200, json: async () => ({ ok: true, value: {}, board: hostBoard }) }
    }
    return { status: 200, json: async () => ({ ok: true, board: hostBoard }) }
  }
  const resolveMenu = target => menuContributions[0].resolve(target, new AbortController().signal)
  // Tracked session in 待验收 (k-2 moved there above): every stage, current disabled, next (PR·CI) marked.
  let actions = await resolveMenu({ sessionId: 's-1', displayTitle: '导出会话' })
  assert.deepEqual(actions.map(a => a.label), ['移到看板阶段', '从看板移除'])
  assert.equal(actions[0].separatorBefore, true)
  const stages = actions[0].children
  assert.deepEqual(stages.map(s => s.label), ['许愿池', '方案', '开发中', '待验收（当前）', 'PR·CI', 'Staging', '待上线', '已上线'])
  assert.equal(stages[3].disabled, true)
  assert.equal(stages[3].run, undefined)
  assert.deepEqual(stages.filter(s => s.icon.key.endsWith('.next')).map(s => s.id), ['pr'])
  assert.equal(stages[4].icon.key, 'kanban.stage.business.next')
  await stages[4].run()
  assert.deepEqual(posted.at(-1), { op: 'update', args: { id: 'k-2', column: 'pr' } })
  await stages[0].run()
  assert.deepEqual(posted.at(-1), { op: 'update', args: { id: 'k-2', column: 'todo' } })
  await actions[1].run()
  assert.deepEqual(posted.at(-1), { op: 'remove', args: { id: 'k-2' } })
  // Untracked session: an add submenu with the plan stage suggested.
  actions = await resolveMenu({ sessionId: 's-new', displayTitle: '新会话' })
  assert.deepEqual(actions.map(a => a.label), ['加入看板'])
  assert.deepEqual(actions[0].children.filter(s => s.icon.key.endsWith('.next')).map(s => s.id), ['plan'])
  assert.ok(actions[0].children.every(s => s.disabled === undefined))
  await actions[0].children[2].run()
  assert.deepEqual(posted.at(-1), { op: 'add', args: { title: '新会话', column: 'dev', sessions: ['s-new'] } })
  // A card in the last column has no next step.
  hostBoard = { ...hostBoard, version: '5:d', cards: hostBoard.cards.map(c => (c.id === 'k-2' ? { ...c, column: 'done' } : c)) }
  await refreshFromHost()
  actions = await resolveMenu({ sessionId: 's-1', displayTitle: '导出会话' })
  assert.equal(actions[0].children.filter(s => s.icon.key.endsWith('.next')).length, 0)
  assert.equal(actions[0].children.at(-1).label, '已上线（当前）')

  // 7. Unload: the store/notification effect and the menu registration both dispose.
  assert.equal(effects.length, 2)
  assert.ok(effects.every(effect => typeof effect === 'function'))
  console.log('ALL CLIENT RENDER TESTS PASSED')
})().catch((error) => { console.error(error); process.exitCode = 1 })
  // Always stop the polling timer, so a failed assertion cannot keep the process alive.
  .finally(() => { for (const effect of effects) if (typeof effect === 'function') effect() })
