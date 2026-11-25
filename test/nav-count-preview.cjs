// Writes an HTML preview of the navigation icon and its waiting count using the
// plugin's real stylesheet, for a headless-browser screenshot.
// Usage: node test/nav-count-preview.cjs <out.html>
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
const css = /const CSS = `([^`]*)`/.exec(source)?.[1]
if (!css || !css.includes('.dk-nav-count')) throw new Error('plugin CSS with .dk-nav-count not found')
const star = (cx, cy, r) => {
  const a = r * 0.18
  return `M${cx} ${cy - r}Q${cx + a} ${cy - a} ${cx + r} ${cy}Q${cx + a} ${cy + a} ${cx} ${cy + r}Q${cx - a} ${cy + a} ${cx - r} ${cy}Q${cx - a} ${cy - a} ${cx} ${cy - r}Z`
}
let gid = 0
const icon = (size) => {
  const id = `g${gid++}`
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none">
<defs><linearGradient id="${id}" x1="2" y1="2" x2="14" y2="14" gradientUnits="userSpaceOnUse"><stop stop-color="#9b7bf0"/><stop offset="1" stop-color="#e06fb4"/></linearGradient></defs>
<path d="${star(6.4, 9.2, 5.3)}" fill="url(#${id})" stroke="url(#${id})" stroke-width="0.7" stroke-linejoin="round"/>
<path d="${star(12.4, 3.6, 2.7)}" fill="#e0a43a" stroke="#e0a43a" stroke-width="0.7" stroke-linejoin="round"/>
<path d="${star(12.9, 12.4, 1.7)}" fill="#9b7bf0" stroke="#9b7bf0" stroke-width="0.7" stroke-linejoin="round"/></svg>`
}
const nav = (count, size = 16) => `<span class="dk-nav-icon">${icon(size)}${count ? `<span class="dk-nav-count">${count}</span>` : ''}</span>`
const block = (theme) => `<div class="pane ${theme}">
${['', '1', '3', '9+'].map(c => `<div class="row">${nav(c)}<span>许愿池</span></div>`).join('')}
<div class="row sel">${nav('9+')}<span>许愿池（选中）</span></div>
<div class="rail">${nav('3')}</div>
</div>`
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; display: flex; font: 14px "Microsoft YaHei", sans-serif; }
.pane { padding: 12px 14px; width: 210px; }
.light { --dsw-alias-state-error-primary: #e5484d; --dsw-specific-sidebar-fill: #f7f8fa; background: #f7f8fa; color: #1f2329; }
.dark { --dsw-alias-state-error-primary: #e5484d; --dsw-specific-sidebar-fill: #1b1d22; background: #1b1d22; color: #e6e8eb; }
.row { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px; border-radius: 8px; }
.light .sel { background: #e9ebef; } .dark .sel { background: #2d3038; }
.rail { margin-top: 8px; width: 56px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px dashed rgba(127,127,127,.4); border-radius: 8px; overflow: hidden; }
${css}
</style></head><body>${block('light')}${block('dark')}</body></html>`
fs.writeFileSync(process.argv[2], html, 'utf8')
console.log(`wrote ${process.argv[2]}`)
