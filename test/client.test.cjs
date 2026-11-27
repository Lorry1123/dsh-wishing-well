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
    const override = stateOverrides.shift()
    const value = override?.value !== undefined ? override.value : (typeof init === 'function' ? init() : init)
    return [value, next => {
      if (!override) return
      const current = override.value !== undefined ? override.value : value
      override.value = typeof next === 'function' ? next(current) : next
    }]
  },
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: () => ({ current: null }),
  useId: (() => { let n = 0; return () => `:r${n++}:` })(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
function render(node, state = {}) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) return node.map(child => render(child, state)).filter(n => n !== null)
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    stateOverrides = [...(state[node.type.name] || [])]
    let result
    try { result = node.type(node.props) } finally { stateOverrides = [] }
    return render(result, state)
  }
  return { type: node.type, props: { ...node.props, children: render(node.props.children, state) } }
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
assert.deepEqual([...plugin.inject].sort(), ['contextMenus', 'locale', 'sessions', 'slots', 'uiWorkspace'])

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
  card({ id: 'k-3', title: '等你合并的卡', column: 'pr', sessions: ['s-release-secondary', 's-release-main', 's-gone'],
    issue: 'ENG-42', issueUrl: 'https://linear.app/acme/issue/ENG-42', attention: '可以合并，等你检查', gates: { ...gates, merge: 'auto' }, updatedAt: iso(3000),
    note: '合并前复核回归结果', sources: ['https://www.notion.so/team/release'],
    prs: [
      { url: 'https://github.com/acme/web-app/pull/42', repo: 'acme/web-app', number: 42, state: 'OPEN', checks: 'passing', score: 4 },
      { url: 'https://github.com/acme/api-server/pull/7', repo: 'acme/api-server', number: 7, state: 'OPEN', checks: 'failing', score: 3, scoreStale: true },
    ] }),
  card({ id: 'k-4', title: '正式版 1.0', column: 'done', sessions: ['s-1'], updatedAt: iso(1), doneAt: iso(1) }),
]
const projectCards = [
  card({ id: 'p-right', title: '第二个同名目录的卡', column: 'plan', sessions: ['s-dir-right'] }),
  card({ id: 'p-right-done', title: '目录项目已发布的卡', column: 'done', sessions: ['s-dir-right'], doneAt: iso(2) }),
  card({ id: 'p-left', title: '第一个同名目录的卡', column: 'dev', sessions: ['s-dir-left', 's-dir-left-alias'], attention: '检查目录项目' }),
  card({ id: 'p-conflict', title: '关联目录冲突', column: 'todo', sessions: ['s-dir-left', 's-dir-right'] }),
  card({ id: 'p-unavailable', title: '一个关联会话不可用', column: 'pr', sessions: ['s-dir-left', 's-archived'] }),
  card({ id: 'p-no-cwd', title: '关联会话没有目录', column: 'dev', sessions: ['s-no-cwd'] }),
  card({ id: 'p-none', title: '没有关联会话', column: 'todo', project: '  ' }),
  card({ id: 'p-name-verify', title: '显式项目的待验收卡', column: 'verify', project: '  Zebra  ', sessions: ['s-dir-left', 's-dir-right'], attention: '本地验收' }),
  card({ id: 'p-name-pr', title: '显式项目的待合并卡', column: 'pr', project: 'zEBRA', sessions: ['s-gone'], attention: '检查合并' }),
  card({ id: 'p-name-dev', title: '显式项目的开发卡', column: 'dev', project: 'Zebra', sessions: ['s-dir-right'] }),
  card({ id: 'p-name-done', title: '显式项目已发布的卡', column: 'done', project: 'zebra', doneAt: iso(1) }),
]
let snapshot = { status: 'ready', cards, version: '3:a', error: '' }
const listeners = new Set()
const fakeStore = {
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  getSnapshot: () => snapshot,
  mutate: async (op, args) => { calls.mutate.push([op, args]); return { ok: true } },
}
const sessionsSnapshot = {
  ids: ['s-1', 's-release-main', 's-release-secondary', 's-dir-left', 's-dir-left-alias', 's-dir-right', 's-no-cwd'],
  byId: {
    's-1': { title: '导出会话', cwd: '\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\workspace\\api-server' },
    's-release-main': { title: '发布主会话', cwd: '/workspace/release' },
    's-release-secondary': { title: '发布补充会话', cwd: '/workspace/release' },
    's-dir-left': { title: '第一目录会话', cwd: '/workspace/first/shared/' },
    's-dir-left-alias': { title: '第一目录补充会话', cwd: '/workspace//first/shared' },
    's-dir-right': { title: '第二目录会话', cwd: '/workspace/second/shared' },
    's-archived': { title: '列表不再包含的会话', cwd: '/workspace/first/shared' },
    's-no-cwd': { title: '无目录会话' },
  },
}
const menuIcons = {}
const menuContributions = []
const localeSnapshot = { active: 'zh' }
const dictionaries = new Map()
const ctx = {
  effect: (fn) => { effects.push(fn()) },
  sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
  locale: {
    register: (namespace, dictionary) => { dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace) },
    bind: namespace => (key, params) => {
      const template = dictionaries.get(namespace)?.[localeSnapshot.active]?.[key]
      assert.equal(typeof template, 'string', `missing translation for ${namespace}.${key}`)
      return template.replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match)
    },
    subscribe: () => () => {},
    getSnapshot: () => localeSnapshot,
  },
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
// Placement among the built-in Session contributions of ui-workspace and
// ui-open-in-app, sorted the way the menu registry sorts: order, then id.
const builtIn = [
  { id: 'session.pin', order: 100 }, { id: 'session.rename', order: 200 }, { id: 'session.fork', order: 300 },
  { id: 'session.id', order: 450, separatorBefore: true }, { id: 'open-in-app.openWith', order: 500 },
  { id: 'session.archive', order: 600, separatorBefore: true },
]
const sorted = [...builtIn, { id: menuContributions[0].id, order: menuContributions[0].order }]
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(c => c.id)
assert.deepEqual(sorted, ['session.pin', 'session.rename', 'session.fork', 'kanban', 'session.id', 'open-in-app.openWith', 'session.archive'])
assert.deepEqual(Object.keys(menuIcons).sort(), [
  ...['business', 'idle', 'ready', 'success', 'warn'].flatMap(t => [`kanban.stage.${t}`, `kanban.stage.${t}.next`]),
  'kanban.menu.add', 'kanban.menu.move', 'kanban.menu.remove',
].sort())
// Menu glyphs follow the host icon spec: 16px viewBox, stroke width 1, currentColor.
for (const key of ['kanban.menu.add', 'kanban.menu.move', 'kanban.menu.remove']) {
  const svg = menuIcons[key]({ icon: { key } })
  assert.equal(svg.type, 'svg')
  assert.equal(svg.props.viewBox, '0 0 16 16')
  assert.equal(svg.props.strokeWidth, 1)
  assert.equal(svg.props.stroke, 'currentColor')
}
assert.equal(registered['sidebar.panellist'].def.label, '许愿池')
const withStore = name => ({ ...registered[name].def.inject(), store: fakeStore })
const pageProps = withStore('main')

function one(nodes, description) {
  assert.equal(nodes.length, 1, `expected one ${description}`)
  return nodes[0]
}
const button = (tree, label) => one(buttons(tree, label), `button ${label}`)
const columnLabels = tree => find(tree, n => n.type === 'section' && n.props['aria-label']).map(n => n.props['aria-label'])
const articles = tree => find(tree, n => n.type === 'article')
const cardTitles = tree => articles(tree).map(n => n.props['aria-label'])
const cardNamed = (tree, title) => one(articles(tree).filter(n => n.props['aria-label'] === title), `card ${title}`)
const containsText = (tree, label) => assert.ok(text(tree).includes(label), `expected text ${label}`)
const openStages = ['许愿池', '方案', '开发中', '待验收', 'PR·CI', 'Staging', '待上线']
const historyButton = (tree, count) => {
  const label = `已上线 ${count}`
  return one(find(tree, n => n.type === 'button' && (text(n) === label || text(n).startsWith(`${label} `))), `button ${label}`)
}
const renderPage = state => render(React.createElement(registered.main.component, pageProps), state)
function boardPage(state = {}) {
  const view = {}, detail = {}, menu = {}
  // BoardPage calls useNow before view, detail and menu. The smoke test only
  // keeps state needed by the handlers it invokes between explicit renders.
  return { view, render: () => renderPage({ BoardPage: [undefined, view, detail, menu], ...state }) }
}

// 1. Board: seven stages initially, shipped history and attention are opt-in.
const boardPageTest = boardPage()
const initialBoard = boardPageTest.render()
assert.equal(button(initialBoard, '看板').props['aria-current'], 'page')
button(initialBoard, '项目')
containsText(initialBoard, '3 项未完成')
assert.deepEqual(columnLabels(initialBoard), openStages)
const historyToggle = historyButton(initialBoard, 1)
assert.equal(historyToggle.props['aria-pressed'], false)
historyToggle.props.onClick()
const withHistory = boardPageTest.render()
assert.equal(historyButton(withHistory, 1).props['aria-pressed'], true)
assert.deepEqual(columnLabels(withHistory), [...openStages, '已上线'])
cardNamed(withHistory, '正式版 1.0')
assert.deepEqual(cardTitles(initialBoard), ['修复登录', '导出报表', '等你合并的卡'])
button(withHistory, '待我处理 1').props.onClick()
const attentionBoard = boardPageTest.render()
assert.deepEqual(columnLabels(attentionBoard), ['PR·CI'])
assert.deepEqual(cardTitles(attentionBoard), ['等你合并的卡'])
containsText(attentionBoard, '3 项未完成')

// Cards retain compact status, CI failure, the start draft, and the primary session.
const todoCard = cardNamed(initialBoard, '修复登录')
const devCard = cardNamed(initialBoard, '导出报表')
const attentionCard = cardNamed(initialBoard, '等你合并的卡')
for (const label of ['AI 进行中', 'api-server · 推断']) containsText(devCard, label)
containsText(attentionCard, '2 天前')
const failingBadge = one(find(attentionCard, n => n.props.title === 'CI 失败'), 'CI failure indicator')
assert.match(failingBadge.props.className, /dk-tone-error/)
button(todoCard, '开工').props.onClick()
assert.match(calls.start[0][1].prompt, /^修复登录\n\n复现步骤见 ENG-1\n\nhttps:\/\/www\.notion\.so\/team\/login\n\n（看板卡片 k-1：开始前先用 kanban 工具的 link/)
assert.equal(calls.start[0][1].whenDraftExists, 'append')
button(devCard, '会话').props.onClick()
assert.deepEqual(calls.open, ['s-1'])

// Card details keep the underlying work links, scores, approvals and all sessions.
const dialog = tree => one(find(tree, n => n.type === 'dialog'), 'card dialog')
const showDetails = (page, title) => {
  button(cardNamed(page.render(), title), title).props.onClick()
  return dialog(page.render())
}
containsText(showDetails(boardPage(), '导出报表'), '写单测中')
const detailsPage = boardPage()
const detail = showDetails(detailsPage, '等你合并的卡')
for (const label of ['可以合并，等你检查', 'G 4/5', 'G 3/5 旧', '合并前复核回归结果',
  '方案评审 · 人工', '本地验收 · 人工', '合并前检查 · AI 自己来']) containsText(detail, label)
button(attentionCard, '会话').props.onClick()
assert.equal(calls.open.at(-1), 's-release-main', 'use the latest available session on the card')
button(detail, '会话 · 发布主会话')
assert.equal(button(detail, '会话 · 会话已不可用').props.disabled, true)
button(detail, '继续会话').props.onClick()
assert.equal(calls.open.at(-1), 's-release-main')
button(showDetails(detailsPage, '等你合并的卡'), '会话 · 发布补充会话').props.onClick()
assert.equal(calls.open.at(-1), 's-release-secondary')
for (const [url, label] of [[cards[2].prs[0].url, 'web-app#42'], [cards[2].prs[1].url, 'api-server#7'],
  [cards[2].issueUrl, 'ENG-42'], [cards[2].sources[0], '需求 · Notion']]) {
  const link = one(find(detail, n => n.type === 'a' && n.props.href === url), `detail link ${label}`)
  containsText(link, label)
  assert.equal(find(attentionCard, n => n.type === 'a' && n.props.href === url).length, 0)
}
assert.ok(!text(attentionCard).includes(cards[2].note))
assert.ok(!text(attentionCard).includes('发布补充会话'))
button(showDetails(detailsPage, '等你合并的卡'), '编辑').props.onClick()
const form = one(find(dialog(detailsPage.render()), n => n.type === 'form'), 'card form')
const prField = one(find(form, n => n.type === 'label' && text(n) === 'PR 链接，每行一个'), 'PR URLs field')
assert.equal(one(find(prField, n => n.type === 'textarea'), 'PR URLs textarea').props.value, cards[2].prs.map(pr => pr.url).join('\n'))
assert.deepEqual(find(form, n => n.type === 'select').map(n => n.props.value), ['human', 'human', 'auto'])
assert.equal(buttons(form, '取消关联').length, 3)

// Deadlines use the browser's calendar and do not replace the workflow status.
{
  const clock = { value: new Date(2026, 10, 27, 23, 59).getTime() }
  const view = {}, detailState = {}, formFields = {}
  const page = () => renderPage({ BoardPage: [clock, view, detailState], CardForm: [undefined, formFields] })
  const deadline = '2026-11-30'
  snapshot = { ...snapshot, cards: [
    { ...cards[0], dueDate: deadline },
    { ...cards[1], dueDate: '2026-12-01' },
    { ...cards[2], dueDate: '2026-11-26' },
    { ...cards[3], dueDate: '2026-11-26' },
  ] }
  const assertDue = (tree, title, date, label, tone) => {
    const item = cardNamed(tree, title)
    const time = one(find(item, n => n.type === 'time'), 'deadline label')
    assert.equal(time.props.dateTime, date)
    assert.equal(text(time), `${label}：${date}`)
    assert.equal(item.props.className.match(/dk-due-(soon|overdue)/)?.[1], tone)
  }
  assertDue(page(), '修复登录', deadline, '即将截止', 'soon')
  assertDue(page(), '导出报表', '2026-12-01', '截止', undefined)
  assertDue(page(), '等你合并的卡', '2026-11-26', '已逾期', 'overdue')
  containsText(cardNamed(page(), '等你合并的卡'), 'CI 失败')
  historyButton(page(), 1).props.onClick()
  assertDue(page(), '正式版 1.0', '2026-11-26', '截止', undefined)
  clock.value = new Date(2026, 10, 28, 0, 0).getTime()
  assertDue(page(), '导出报表', '2026-12-01', '即将截止', 'soon')
  clock.value = new Date(2026, 10, 30, 23, 59).getTime()
  assertDue(page(), '修复登录', deadline, '今天截止', 'soon')
  clock.value = new Date(2026, 11, 1, 0, 0).getTime()
  assertDue(page(), '修复登录', deadline, '已逾期', 'overdue')

  const dueInput = drawer => one(find(drawer, n => n.type === 'input' && n.props.type === 'date'), 'date input')
  const cardForm = () => one(find(dialog(page()), n => n.type === 'form'), 'deadline form')
  button(cardNamed(page(), '修复登录'), '修复登录').props.onClick()
  containsText(dialog(page()), `已逾期：${deadline}`)
  button(dialog(page()), '编辑').props.onClick()
  assert.equal(dueInput(cardForm()).props.value, deadline)
  button(cardForm(), '清除截止日期').props.onClick()
  assert.equal(dueInput(cardForm()).props.value, '')
  cardForm().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(calls.mutate.at(-1), ['update', { id: 'k-1', dueDate: '' }])

  button(page(), '新建愿望').props.onClick()
  formFields.value = undefined
  const newForm = cardForm()
  assert.equal(dueInput(newForm).props.value, '')
  one(find(newForm, n => n.type === 'input' && n.props.required), 'title input').props.onChange({ target: { value: '新愿望' } })
  dueInput(newForm).props.onChange({ target: { value: deadline } })
  cardForm().props.onSubmit({ preventDefault() {} })
  assert.equal(calls.mutate.at(-1)[0], 'add')
  assert.equal(calls.mutate.at(-1)[1].dueDate, deadline)
  snapshot = { ...snapshot, cards }
}

const actionsPage = boardPage({ MoveStage: [{}], CardDetails: [{}] })
const menuTrigger = tree => one(find(cardNamed(tree, '修复登录'), n => n.type === 'button' && n.props['aria-label'] === '更多操作：修复登录'), 'card menu trigger')
const moveForm = tree => one(find(tree, n => n.type === 'form' && n.props.className === 'dk-move-form'), 'card move form')
const stageSelect = tree => one(find(tree, n => n.type === 'select' && n.props['aria-label'] === '移到阶段'), 'card stage selector')
const closedMenuTrigger = menuTrigger(actionsPage.render())
assert.equal(closedMenuTrigger.props['aria-expanded'], false)
closedMenuTrigger.props.onClick({})
const withMenu = actionsPage.render()
assert.equal(menuTrigger(withMenu).props['aria-expanded'], true)
assert.equal(button(moveForm(withMenu), '移动').props.disabled, true)
button(withMenu, '查看详情').props.onClick()
const todoMove = moveForm(dialog(actionsPage.render()))
assert.equal(stageSelect(todoMove).props.value, 'todo')
assert.equal(button(todoMove, '移动').props.disabled, true)
const beforeMove = calls.mutate.length
stageSelect(todoMove).props.onChange({ target: { value: 'plan' } })
assert.equal(calls.mutate.length, beforeMove, 'selecting a stage must not move the card')
const pendingMove = moveForm(dialog(actionsPage.render()))
assert.equal(stageSelect(pendingMove).props.value, 'plan')
assert.equal(button(pendingMove, '移动').props.disabled, false)
pendingMove.props.onSubmit({ preventDefault() {} })
assert.deepEqual(calls.mutate.slice(beforeMove), [['update', { id: 'k-1', column: 'plan' }]])

const beforeDelete = calls.mutate.length
button(dialog(actionsPage.render()), '删除卡片').props.onClick()
assert.equal(calls.mutate.length, beforeDelete, 'deletion must require a second confirmation')
button(dialog(actionsPage.render()), '确认删除').props.onClick()
assert.deepEqual(calls.mutate.slice(beforeDelete), [['remove', { id: 'k-1' }]])

// Projects overview: waiting-first order and separate actions on the name and count.
snapshot = { ...snapshot, cards: projectCards }
const projectPage = boardPage()
const allProjectsBoard = projectPage.render()
containsText(allProjectsBoard, '9 项未完成')
button(allProjectsBoard, '待我处理 3')
historyButton(allProjectsBoard, 2)
const openProjects = () => {
  button(projectPage.render(), '项目').props.onClick()
  return projectPage.render()
}
const projectRows = tree => find(tree, n => n.props.role === 'row' && find(n, child => child.type === 'button').length > 0)
const projectName = (row, label) => find(row, n => n.type === 'button' && text(n).trim().toLowerCase() === label.toLowerCase())
const projectRow = (overview, label) => one(projectRows(overview).filter(row => projectName(row, label).length > 0), `project row ${label}`)
const projects = openProjects()
assert.equal(button(projects, '项目').props['aria-current'], 'page')
containsText(projects, '项目总览')
assert.equal(projectRows(projects).length, 4)
const namedRow = projectRow(projects, 'Zebra')
assert.equal(projectRows(projects)[0], namedRow)
assert.equal(buttons(projectRows(projects)[1], '1').length, 1)
projectName(namedRow, 'Zebra')[0].props.onClick()
assert.equal(projectPage.view.value.project, 'name:zebra')
const namedBoard = projectPage.render()
containsText(namedBoard, '3 项未完成')
button(namedBoard, '待我处理 2')
assert.deepEqual(columnLabels(namedBoard), openStages)
assert.deepEqual(cardTitles(namedBoard), ['显式项目的开发卡', '显式项目的待验收卡', '显式项目的待合并卡'])
historyButton(namedBoard, 1).props.onClick()
cardNamed(projectPage.render(), '显式项目已发布的卡')

// A new wish inherits an explicit project only while its board is visible.
const projectInput = drawer => {
  const label = one(find(drawer, n => n.type === 'label' && text(n) === '项目归属'), 'project field')
  return one(find(label, n => n.type === 'input'), 'project input')
}
button(projectPage.render(), '新建愿望').props.onClick()
const newInProject = dialog(projectPage.render())
assert.equal(projectInput(newInProject).props.value, 'Zebra')
button(newInProject, '取消').props.onClick()
button(openProjects(), '新建愿望').props.onClick()
const newInOverview = dialog(projectPage.render())
assert.equal(projectInput(newInOverview).props.value, '')
button(newInOverview, '取消').props.onClick()

button(projectRow(openProjects(), 'Zebra'), '2').props.onClick()
const waitingProject = projectPage.render()
containsText(waitingProject, '3 项未完成')
button(waitingProject, '待我处理 2')
assert.deepEqual(columnLabels(waitingProject), ['待验收', 'PR·CI'])
assert.deepEqual(cardTitles(waitingProject), ['显式项目的待验收卡', '显式项目的待合并卡'])

// Equal folder basenames remain distinct; ambiguous, missing or unavailable
// associations cannot be inferred. Select the actual overview rows to test membership.
const folders = projectRows(openProjects()).filter(row => projectName(row, 'shared').length > 0)
assert.equal(folders.length, 2)
for (const row of folders) containsText(row, '推断')
for (const [index, key, title] of [[0, 'cwd:/workspace/first/shared', '第一个同名目录的卡'], [1, 'cwd:/workspace/second/shared', '第二个同名目录的卡']]) {
  const row = projectRows(openProjects()).filter(row => projectName(row, 'shared').length > 0)[index]
  projectName(row, 'shared')[0].props.onClick()
  assert.equal(projectPage.view.value.project, key)
  assert.deepEqual(cardTitles(projectPage.render()), [title])
}
button(projectRow(openProjects(), '未归类'), '未归类').props.onClick()
assert.equal(projectPage.view.value.project, 'none')
assert.deepEqual(cardTitles(projectPage.render()).sort(), ['关联会话没有目录', '关联目录冲突', '没有关联会话', '一个关联会话不可用'].sort())

// Empty board onboarding hint.
snapshot = { status: 'ready', cards: [], version: '0:x', error: '' }
containsText(renderPage(), '新会话发出第一条消息后会自动上看板')
snapshot = { status: 'ready', cards, version: '3:a', error: '' }
let tree

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
  assert.deepEqual(actions.map(a => a.label), ['移动到许愿阶段', '移除出许愿池'])
  assert.deepEqual(actions.map(a => a.icon.key), ['kanban.menu.move', 'kanban.menu.remove'])
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
  assert.deepEqual(actions.map(a => a.label), ['加入许愿池'])
  assert.equal(actions[0].icon.key, 'kanban.menu.add')
  assert.equal(actions[0].separatorBefore, true)
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

  // 7. Unload: the store/notification/locale effect and the menu registration both dispose.
  assert.equal(effects.length, 2)
  assert.ok(effects.every(effect => typeof effect === 'function'))
  assert.equal(dictionaries.size, 1)
})()
  // Always stop the polling timer, so a failed assertion cannot keep the process alive.
  .finally(() => { for (const effect of effects) if (typeof effect === 'function') effect() })
  .then(() => {
    assert.equal(dictionaries.size, 0)
    console.log('ALL CLIENT RENDER TESTS PASSED')
  })
  .catch((error) => { console.error(error); process.exitCode = 1 })
