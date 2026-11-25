// Writes an HTML mock of the Session context menu: the host's own glyphs
// (pulled from the built frontend's icon table, stroke width 1 = "regular")
// beside this plugin's menu glyphs rendered from client.js, for a
// headless-browser screenshot.
// Usage: node test/menu-icons-preview.cjs <dsh-web-frontend/dist> <out.html>
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const [dist, out] = process.argv.slice(2)
const assets = path.join(dist, 'assets')
const bundle = fs.readdirSync(assets).filter(f => f.endsWith('.js')).map(f => path.join(assets, f))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
const text = fs.readFileSync(bundle, 'utf8')
// A glyph is either `p=>`svg`` or, when the weights differ in shape,
// `p=>p===1.3?`medium svg`:`regular svg``; "regular" (stroke 1) takes the last template.
const native = name => {
  // Glyphs carry their own default render size (most 16, some 20).
  const m = new RegExp(`"${name}":\\{size:(\\d+),svg:([\\w$]+)=>`).exec(text)
  if (!m) throw new Error(`glyph ${name} not found`)
  const [, size, param] = m
  let i = m.index + m[0].length
  const templates = []
  while (text[i] !== '}') {
    const open = text.indexOf('`', i)
    const close = text.indexOf('`', open + 1)
    templates.push(text.slice(open + 1, close))
    i = close + 1
    if (text[i] === ':') i++
  }
  return templates.at(-1).replaceAll('${' + param + '}', '1').replace('<svg ', `<svg width="${size}" height="${size}" `)
}

// Render the plugin's glyph components to static SVG with a tiny createElement.
const toSvg = (node) => {
  if (typeof node !== 'object' || node === null) return ''
  const { children, ...props } = node.props
  const attrs = Object.entries(props).map(([k, v]) => `${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${v}"`).join(' ')
  return `<${node.type} ${attrs}>${children.map(toSvg).join('')}</${node.type}>`
}
const React = { createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.flat() } }), useState: v => [v, () => {}], useEffect() {}, useMemo: f => f(), useRef: () => ({}), useSyncExternalStore: (_, g) => g(), useId: () => 'x' }
const icons = {}
const sandbox = {
  window: { __ModuleLoader__: { load: ({ factory }) => { sandbox.mod = factory(() => React) } }, addEventListener() {}, removeEventListener() {} },
  document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, baseURI: 'http://x/' },
  console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Array, Symbol, Promise, Number, String, Set, Map, RegExp, Error,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8'), sandbox)
sandbox.mod.apply({
  effect() {}, sessions: { list: { subscribe: () => () => {}, getSnapshot: () => ({}) } }, uiWorkspace: {},
  contextMenus: { register: () => () => {} },
  slots: {
    inject: (n, fn) => { const r = fn(); if (r && typeof r.next === 'function') for (const _ of r) { /* drain */ } },
    register: (def, C) => { if (def.name === 'contextMenu.icon') icons[def.key] = C; return () => {} },
  },
})
const plugin = key => toSvg(icons[key]({ icon: { key } }))

const rows = [
  ['pin-outline', '置顶会话'], ['edit-outline', '重命名'], ['branch-outline', '分叉会话'], 'sep',
  [null, '移动到许愿阶段', 'kanban.menu.move', '›'], [null, '移除出许愿池', 'kanban.menu.remove'], 'sep',
  ['copy-outline', '复制 Session ID'], ['right-up-outline', '在应用中打开', null, '›'], 'sep',
  ['archive-outline', '归档会话'], 'sep', [null, '加入许愿池（未加入时）', 'kanban.menu.add', '›'],
]
const menu = theme => `<div class="menu ${theme}">${rows.map(r => r === 'sep' ? '<div class="sep"></div>'
  : `<div class="item"><span class="ic">${r[0] ? native(r[0]) : plugin(r[2])}</span><span class="lb">${r[1]}</span>${r[3] ? `<span class="chev">${r[3]}</span>` : ''}</div>`).join('')}</div>`
fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;display:flex;gap:16px;padding:12px;background:#e9ebef;font:13px "Microsoft YaHei",sans-serif}
.menu{width:200px;padding:4px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.light{background:#fff;color:#1f2329}.dark{background:#26282e;color:#e6e8eb}
.item{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:6px}
.ic{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;opacity:.85}.lb{flex:1}.chev{opacity:.6}
.sep{height:1px;margin:4px 8px;background:currentColor;opacity:.12}
</style>${menu('light')}${menu('dark')}`, 'utf8')
console.log(`wrote ${out}`)
// apply() starts the board poller; nothing here needs it, so do not wait for it.
process.exit(0)
