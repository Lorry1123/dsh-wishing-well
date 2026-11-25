// Layout check of the Session-row stage label in a real Chromium.
// Builds an HTML page from the installed ui-workspace row CSS and this plugin's
// CSS, with rows in the DOM shape Rows.tsx renders. The page measures itself
// and writes JSON into <pre id="out">; run it with a headless browser's
// --dump-dom. `:hover` is rewritten to a `.fake-hover` class in both
// stylesheets so the hovered state can be measured without a pointer.
// Usage: node test/row-layout.cjs <ui-workspace lib/client.js> <out.html>
const fs = require('node:fs')
const path = require('node:path')

const [workspaceJsPath, outPath] = process.argv.slice(2)
const rowCssRaw = /const css\$1=`([^`]*)`/.exec(fs.readFileSync(workspaceJsPath, 'utf8'))?.[1]
if (!rowCssRaw || !rowCssRaw.includes('_sessionRow')) throw new Error('row CSS not found in ui-workspace bundle')
const pluginCssRaw = /const CSS = `([^`]*)`/.exec(fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8'))?.[1]
if (!pluginCssRaw) throw new Error('plugin CSS not found')
// Headless Chromium reports no hover capability, so the hover-device media
// blocks are forced on (and the touch-only ones off) to match desktop DSH.
const fakeHover = css => css.replaceAll('@media (hover:hover)', '@media all').replaceAll('@media (hover:none)', '@media not all')
  .replaceAll(':hover', '.fake-hover')
const rowCss = fakeHover(rowCssRaw)
const pluginCss = fakeHover(pluginCssRaw)
const cls = name => (new RegExp(`([A-Za-z0-9]+_${name})\\b`).exec(rowCss) || [])[1]
const C = { row: cls('sessionRow'), slot: cls('slot'), title: cls('title'), resting: cls('rowResting'), time: cls('time'), actions: cls('rowActions'), pin: cls('pinIndicator') }

const row = (id, { running = false, label = true, pinned = false, extra = '' } = {}) => `
<div id="${id}" class="${C.row}${extra}" tabindex="0">
  <span class="${C.slot}">${running ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#46f"></span>' : ''}</span>
  <span class="${C.title}">配置 WSL 开发与订阅工作流的一个很长很长的标题</span>
  <span class="${C.resting}">
    <span class="${C.time}">18分钟</span>
    <span data-slot="sidebar.session.row.trailing" style="display:contents">${label ? '<span class="dk-badge dk-trail dk-tone-business">开发</span>' : ''}</span>
    ${pinned ? `<span class="${C.pin}">P</span>` : ''}
  </span>
  <span class="${C.actions}"><button>…</button></span>
</div>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px sans-serif;--dsh-sidebar-label-gap:8px;--dsh-sidebar-paint-inset:4px;--dsh-sidebar-row-padding:12px}
.wrap{width:280px}
${rowCss}
${pluginCss}
</style></head><body><div class="wrap">
${row('idle')}${row('running', { running: true })}${row('pinned', { pinned: true })}${row('plain', { label: false })}${row('hovered', { extra: ' fake-hover' })}${row('menu', { extra: ` ${cls('menuOpen')}` })}
</div><pre id="out"></pre><script>
const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) } }
const out = { classes: ${JSON.stringify(C)} }
for (const id of ['idle', 'running', 'pinned', 'plain', 'hovered', 'menu']) {
  const rowEl = document.getElementById(id)
  out[id] = {
    slot: box(rowEl.querySelector('.${C.slot}')),
    label: box(rowEl.querySelector('.dk-trail')),
    title: box(rowEl.querySelector('.${C.title}')),
    time: box(rowEl.querySelector('.${C.time}')),
    pin: box(rowEl.querySelector('.${C.pin}')),
    restingDisplay: getComputedStyle(rowEl.querySelector('.${C.resting}')).display,
    height: box(rowEl).w && Math.round(rowEl.getBoundingClientRect().height),
  }
}
document.getElementById('out').textContent = 'RESULT' + JSON.stringify(out) + 'END'
</script></body></html>`
fs.writeFileSync(outPath, html, 'utf8')
console.log(`wrote ${outPath}`)
