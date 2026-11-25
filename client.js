/**
 * Browser half of the kanban board: the left-navigation board page, a column
 * badge and hover line on each Session row, Session-menu actions, and system
 * notifications when a card starts needing the user. Every surface reads one
 * polled snapshot of the Host board route.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-wishing-well',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React
    const h = React.createElement

    const PLUGIN_ID = '@local/dsh-wishing-well'
    const PANEL_ID = 'kanban'
    const ROUTE = 'api/kanban/board'
    const POLL_MS = 4000
    const DONE_VISIBLE = 30
    /** Tone marks whose move it is: amber waits for the user, blue/violet is agent work. */
    const COLUMNS = [
      { id: 'todo', label: '许愿池', short: '许愿', tone: 'idle' },
      { id: 'plan', label: '方案', short: '方案', tone: 'ready' },
      { id: 'dev', label: '开发中', short: '开发', tone: 'business' },
      { id: 'verify', label: '待验收', short: '验收', tone: 'warn' },
      { id: 'pr', label: 'PR·CI', short: 'PR', tone: 'business' },
      { id: 'staging', label: 'Staging', short: 'STG', tone: 'ready' },
      { id: 'release', label: '待上线', short: '待上线', tone: 'warn' },
      { id: 'done', label: '已上线', short: '已上线', tone: 'success' },
    ]
    const COLUMN_BY_ID = Object.fromEntries(COLUMNS.map(column => [column.id, column]))
    const GATES = [
      { id: 'plan', label: '方案 review', auto: 'AI 审方案' },
      { id: 'local', label: '本地验收', auto: '免验收' },
      { id: 'merge', label: '合并前检查', auto: 'AI 合并' },
    ]
    const CHECK_LABELS = { pending: 'CI 运行中', passing: 'CI 通过', failing: 'CI 失败', none: '无 CI' }

    const CSS = `
.dk-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }
.dk-header { display: flex; align-items: center; gap: 10px; padding: 20px 24px 14px; flex-wrap: wrap; }
.dk-title { margin: 0; font-size: 18px; font-weight: 600; }
.dk-subtitle { color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.dk-spacer { flex: 1; }
.dk-notice { color: var(--dsw-alias-label-error); font-size: 12px; }
.dk-select, .dk-input, .dk-textarea { box-sizing: border-box; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
.dk-select { height: 28px; padding: 0 8px; }
.dk-input { width: 100%; height: 28px; padding: 0 8px; }
.dk-textarea { width: 100%; min-height: 48px; padding: 6px 8px; resize: vertical; }
.dk-select:focus-visible, .dk-input:focus-visible, .dk-textarea:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.dk-btn { height: 28px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); cursor: pointer; white-space: nowrap; }
.dk-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dk-btn-on { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); }
.dk-btn:focus-visible, .dk-icon-btn:focus-visible, .dk-link:focus-visible, .dk-menuitem:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dk-btn-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); }
.dk-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.dk-columns { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 0 24px 24px; overflow-x: auto; }
.dk-column { flex: 1 0 210px; max-width: 340px; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-interactive-bg-hover); border-radius: var(--dsw-radius-lg); }
.dk-column-over { box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary); }
.dk-column-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; font-size: 13px; font-weight: 600; }
.dk-count { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dk-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
.dk-tone-idle { color: var(--dsw-alias-state-idle-primary); }
.dk-tone-business { color: var(--dsw-alias-state-business-primary); }
.dk-tone-warn { color: var(--dsw-alias-state-warn-primary); }
.dk-tone-ready { color: var(--dsw-alias-state-done-primary); }
.dk-tone-success { color: var(--dsw-alias-state-success-primary); }
.dk-tone-error { color: var(--dsw-alias-state-error-primary); }
.dk-column-body { flex: 1; min-height: 40px; overflow-y: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.dk-empty { padding: 12px 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; text-align: center; }
.dk-card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 8px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); cursor: grab; }
.dk-card:hover { border-color: var(--dsw-alias-border-l3); }
.dk-card-attention { border-color: var(--dsw-alias-state-warn-primary); box-shadow: inset 3px 0 0 var(--dsw-alias-state-warn-primary); }
.dk-card-attention:hover { border-color: var(--dsw-alias-state-warn-primary); }
.dk-card-dragging { opacity: 0.45; }
.dk-card-drop::before { content: ''; position: absolute; left: 0; right: 0; top: -6px; height: 2px; border-radius: 1px; background: var(--dsw-alias-state-business-primary); }
.dk-drop-end { height: 2px; border-radius: 1px; background: var(--dsw-alias-state-business-primary); }
.dk-attention { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-state-warn-label); }
.dk-running { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-state-business-primary); }
.dk-running .dk-dot { animation: dk-pulse 1.4s ease-in-out infinite; }
@keyframes dk-pulse { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .dk-running .dk-dot { animation: none; } }
.dk-card-title { font-size: 13px; font-weight: 500; line-height: 18px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.dk-card-status { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dk-card-note { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.dk-card-meta { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; font-size: 12px; }
.dk-tag { padding: 0 6px; line-height: 18px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dk-tag-auto { color: var(--dsw-alias-state-done-primary); }
.dk-pr { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.dk-score { font-size: 11px; padding: 0 4px; line-height: 16px; border-radius: var(--dsw-radius-xs); border: 1px solid currentColor; }
.dk-score-stale { opacity: 0.5; }
.dk-link { padding: 0; border: 0; background: none; font: inherit; font-size: 12px; color: var(--dsw-alias-link); cursor: pointer; text-decoration: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dk-link:hover { text-decoration: underline; }
.dk-link:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; text-decoration: none; }
.dk-card-foot { display: flex; align-items: center; gap: 4px; min-height: 22px; }
.dk-time { flex: 1; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dk-actions { display: flex; gap: 2px; opacity: 0; }
.dk-card:hover .dk-actions, .dk-card:focus-within .dk-actions { opacity: 1; }
@media (hover: none) { .dk-actions { opacity: 1; } }
.dk-icon-btn { height: 22px; min-width: 22px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); background: transparent; border: 0; border-radius: var(--dsw-radius-xs); cursor: pointer; white-space: nowrap; }
.dk-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dk-icon-btn:disabled { opacity: 0.35; cursor: default; background: transparent; }
.dk-icon-btn-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.dk-form { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-md); cursor: default; }
.dk-form-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dk-form-row { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.dk-form-gates { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 12px; }
.dk-form-session { display: flex; gap: 6px; align-items: center; font-size: 12px; min-width: 0; }
.dk-more { align-self: center; }
.dk-hint { margin: 0 24px 12px; padding: 10px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); border-radius: var(--dsw-radius-md); }
.dk-badge { flex: none; display: inline-flex; align-items: center; gap: 3px; font-size: 10px; line-height: 14px; padding: 0 4px; border: 1px solid currentColor; border-radius: var(--dsw-radius-xs); white-space: nowrap; }
.dk-badge-attention { color: var(--dsw-alias-state-warn-label); border-color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-tertiary); }
/* Session row stage label. The row offers plugins only a trailing seat inside
   its resting group (time, icons, pin), which it hides while hovered, focused
   from the keyboard, or with its menu open. While the row rests, that group's
   items join the row's own flex line so the label can sit after the status
   cell and before the title; the group's 6px gap moves onto its items. The
   seat's anchor is display: contents, so the label itself is the flex item.
   When the row's class names change, the label simply stays after the time. */
:is(html:not([data-input-modality="keyboard"]) [class*="_sessionRow"], html[data-input-modality="keyboard"] [class*="_sessionRow"]:not(:focus-within)):not(:hover):not([class*="_menuOpen"]) > [class*="_rowResting"]:has(.dk-trail) { display: contents; }
[class*="_sessionRow"]:has(.dk-trail) > [class*="_slot"] { order: -2; }
[class*="_sessionRow"] > [class*="_rowResting"]:has(.dk-trail) > * { flex: none; }
[class*="_sessionRow"] > [class*="_rowResting"]:has(.dk-trail) > * + * { margin-inline-start: 6px; }
[class*="_sessionRow"] > [class*="_rowResting"] .dk-trail { order: -1; flex: none; margin-inline-start: var(--dsh-sidebar-label-gap, 8px); }
.dk-trail { font-weight: 500; }
/* The Session hover card is a dark surface in both themes. */
.dk-hover { display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 18px; min-width: 0; color: var(--dsw-alias-hovercard-label-primary); }
.dk-hover-line { display: flex; gap: 6px; align-items: center; min-width: 0; }
.dk-hover-label { flex: none; white-space: nowrap; }
.dk-hover-text { color: var(--dsw-alias-hovercard-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* Session context menu: a stage dot in each item's icon cell; the item whose
   icon carries the next-step mark is bold. */
.dk-menu-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
[role="menuitem"]:has(.dk-next-mark) { font-weight: 600; }
.dk-nav-icon { position: relative; display: inline-flex; }
/* Waiting count at the icon's top-left, the corner the sparkles leave empty.
   Anchored by its right edge, so a wider "9+" grows leftward and covers no
   more of the icon than a single digit. */
.dk-nav-count { position: absolute; top: -7px; right: calc(100% - 5px); min-width: 13px; height: 13px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: var(--dsw-alias-state-error-primary); color: #fff; font: 600 9px/13px var(--dsw-font-family, sans-serif); font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; pointer-events: none; box-shadow: 0 0 0 1.5px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base)); }
`

    /** Insert the plugin stylesheet, tagged so the module loader can reclaim it on unload. */
    function injectCss(text) {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/board.css`
      tag.textContent = text
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /** Send one request through the desktop shell carrier when present, else the page fetch. */
    async function callHost(method, body) {
      const url = new URL(ROUTE, document.baseURI).href
      const init = body === undefined
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const carrier = globalThis.__DSH_TRANSPORT__ && globalThis.__DSH_TRANSPORT__.fetch
      const response = carrier ? await carrier(url, init) : await fetch(url, { ...init, credentials: 'same-origin' })
      let payload
      try {
        payload = await response.json()
      } catch (_notJson) {
        throw new Error(`看板服务不可用（HTTP ${response.status}）`)
      }
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`)
      return payload
    }

    /**
     * One board snapshot shared by every surface. Polling runs only while some
     * surface is subscribed and the page is visible; a mutation answers with the
     * new board, so the acting surface updates without waiting for a poll.
     */
    function createBoardStore() {
      let snapshot = { status: 'loading', cards: [], version: '', error: '' }
      const listeners = new Set()
      let timer
      let inflight
      const emit = (next) => {
        snapshot = next
        for (const listener of listeners) listener()
      }
      const accept = (board) => {
        if (snapshot.status === 'ready' && snapshot.error === '' && board.version === snapshot.version) return
        emit({ status: 'ready', cards: board.cards, version: board.version, error: '' })
      }
      const fail = (error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (snapshot.error !== message) emit({ ...snapshot, status: snapshot.status === 'ready' ? 'ready' : 'error', error: message })
      }
      const refresh = () => {
        inflight ??= callHost('GET').then(payload => accept(payload.board), fail).finally(() => { inflight = undefined })
        return inflight
      }
      const onFocus = () => { void refresh() }
      const stop = () => {
        clearInterval(timer)
        timer = undefined
        window.removeEventListener('focus', onFocus)
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          if (listeners.size === 1) {
            void refresh()
            timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_MS)
            window.addEventListener('focus', onFocus)
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) stop()
          }
        },
        refresh,
        async mutate(op, args) {
          const payload = await callHost('POST', { op, args })
          accept(payload.board)
          return payload.value
        },
        dispose() {
          stop()
          listeners.clear()
        },
      }
    }

    function useBoard(store) {
      return useSyncExternalStore(store.subscribe, store.getSnapshot)
    }

    /** The card a Session row reflects: its latest unfinished card, else its latest card. */
    function cardForSession(cards, sessionId) {
      let best
      for (const card of cards) {
        if (!card.sessions.includes(sessionId)) continue
        if (best === undefined) { best = card; continue }
        const open = card.column !== 'done'
        const bestOpen = best.column !== 'done'
        if (open !== bestOpen ? open : card.updatedAt > best.updatedAt) best = card
      }
      return best
    }

    function projectFromCwd(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return ''
      const parts = cwd.split(/[\\/]+/).filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : ''
    }

    function prLabel(pr) {
      const name = typeof pr.repo === 'string' ? pr.repo.split('/').pop() : ''
      return name ? `${name}#${pr.number}` : `PR #${pr.number}`
    }

    function hostLabel(url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '')
        if (host.endsWith('notion.so') || host.endsWith('notion.site')) return 'Notion'
        if (host.endsWith('slack.com')) return 'Slack'
        if (host.endsWith('claude.ai')) return 'Claude'
        if (host.endsWith('linear.app')) return 'Linear'
        return host
      } catch (_invalidUrl) {
        return '链接'
      }
    }

    function relativeTime(iso, now) {
      const time = Date.parse(iso)
      if (Number.isNaN(time)) return ''
      const minutes = Math.round((now - time) / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return `${hours} 小时前`
      const days = Math.round(hours / 24)
      if (days < 30) return `${days} 天前`
      return new Date(time).toLocaleDateString('zh-CN')
    }

    function useNow(intervalMs) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
      }, [intervalMs])
      return now
    }

    function lines(text) {
      return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    }

    /** Four-point sparkle with slightly bowed sides. */
    function sparklePath(cx, cy, r) {
      const a = r * 0.18
      return `M${cx} ${cy - r}Q${cx + a} ${cy - a} ${cx + r} ${cy}Q${cx + a} ${cy + a} ${cx} ${cy + r}`
        + `Q${cx - a} ${cy + a} ${cx - r} ${cy}Q${cx - a} ${cy - a} ${cx} ${cy - r}Z`
    }

    /** Colored sparkle cluster: the wish pool. The gradient id is per instance, since the rail can render twice. */
    function PanelIcon({ size, store }) {
      const board = useBoard(store)
      const gradientId = `dk-wish-${React.useId().replace(/[^A-Za-z0-9_-]/g, '')}`
      const waiting = board.cards.filter(card => card.attention).length
      const edge = size || 16
      const sparkle = (cx, cy, r, paint) => h('path', {
        d: sparklePath(cx, cy, r), fill: paint, stroke: paint, strokeWidth: 0.7, strokeLinejoin: 'round',
      })
      return h('span', { className: 'dk-nav-icon' },
        h('svg', { width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('defs', null,
            h('linearGradient', { id: gradientId, x1: 2, y1: 2, x2: 14, y2: 14, gradientUnits: 'userSpaceOnUse' },
              h('stop', { stopColor: '#9b7bf0' }),
              h('stop', { offset: 1, stopColor: '#e06fb4' }))),
          sparkle(6.4, 9.2, 5.3, `url(#${gradientId})`),
          sparkle(12.4, 3.6, 2.7, '#e0a43a'),
          sparkle(12.9, 12.4, 1.7, '#9b7bf0')),
        waiting > 0 && h('span', { className: 'dk-nav-count', title: `${waiting} 项等你处理` }, waiting > 9 ? '9+' : String(waiting)))
    }

    /** Inline form shared by card creation and editing. */
    function CardForm({ initial, sessionLabels, onSubmit, onCancel, onUnlink, submitLabel }) {
      const [title, setTitle] = useState(initial.title || '')
      const [project, setProject] = useState(initial.project || '')
      const [issue, setIssue] = useState(initial.issue || '')
      const [prs, setPrs] = useState((initial.prs || []).map(pr => pr.url).join('\n'))
      const [sources, setSources] = useState((initial.sources || []).join('\n'))
      const [status, setStatus] = useState(initial.status || '')
      const [note, setNote] = useState(initial.note || '')
      const [gates, setGates] = useState(initial.gates || { plan: 'human', local: 'human', merge: 'human' })
      const [busy, setBusy] = useState(false)
      const titleRef = useRef(null)
      useEffect(() => { titleRef.current && titleRef.current.focus() }, [])
      const submit = async () => {
        if (title.trim() === '' || busy) return
        setBusy(true)
        const ok = await onSubmit({ title, project, issue, status, note, gates, prs: lines(prs), sources: lines(sources) })
        if (!ok) setBusy(false)
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'Enter' && (event.target.tagName === 'INPUT' || event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }
      const input = (value, set, placeholder, label, maxLength) => h('input', {
        className: 'dk-input', value, placeholder, maxLength, 'aria-label': label, onChange: e => set(e.target.value),
      })
      return h('div', { className: 'dk-form', onKeyDown, draggable: false, onDragStart: event => event.preventDefault() },
        h('input', { ref: titleRef, className: 'dk-input', placeholder: '标题（必填）', value: title, maxLength: 200, onChange: e => setTitle(e.target.value), 'aria-label': '标题' }),
        input(project, setProject, '项目 / 仓库', '项目', 80),
        input(issue, setIssue, 'Linear issue，如 ENG-123', 'Linear issue', 40),
        input(status, setStatus, '当前状态（一句话）', '当前状态', 120),
        h('textarea', { className: 'dk-textarea', placeholder: 'PR 链接，每行一个', value: prs, onChange: e => setPrs(e.target.value), 'aria-label': 'PR 链接' }),
        h('textarea', { className: 'dk-textarea', placeholder: '需求来源链接（Notion / Slack / Claude），每行一个', value: sources, onChange: e => setSources(e.target.value), 'aria-label': '需求来源' }),
        h('textarea', { className: 'dk-textarea', placeholder: '备注', value: note, maxLength: 2000, onChange: e => setNote(e.target.value), 'aria-label': '备注' }),
        h('div', { className: 'dk-form-gates' },
          GATES.flatMap(gate => [
            h('span', { key: `${gate.id}-label`, className: 'dk-form-label' }, gate.label),
            h('select', {
              key: gate.id,
              className: 'dk-select',
              value: gates[gate.id],
              'aria-label': gate.label,
              onChange: e => setGates({ ...gates, [gate.id]: e.target.value }),
            }, h('option', { value: 'human' }, '人工'), h('option', { value: 'auto' }, 'AI 自己来')),
          ])),
        (sessionLabels || []).map(session => h('div', { key: session.id, className: 'dk-form-session' },
          h('span', { className: 'dk-form-label' }, '会话'),
          h('span', { className: 'dk-hover-text' }, session.label),
          h('button', { type: 'button', className: 'dk-icon-btn', onClick: () => onUnlink(session.id) }, '取消关联'))),
        h('div', { className: 'dk-form-row' },
          h('button', { type: 'button', className: 'dk-btn', onClick: onCancel }, '取消'),
          h('button', { type: 'button', className: 'dk-btn dk-btn-primary', onClick: () => void submit(), disabled: busy || title.trim() === '' }, submitLabel)))
    }

    function PrChip({ pr }) {
      const merged = pr.state === 'MERGED'
      const closed = pr.state === 'CLOSED'
      const tone = merged ? 'success' : closed ? 'idle' : pr.checks === 'failing' ? 'error' : pr.checks === 'passing' ? 'success' : 'idle'
      const state = merged ? '已合并' : closed ? '已关闭' : CHECK_LABELS[pr.checks] || '等待查询'
      return h('span', { className: 'dk-pr' },
        h('span', { className: `dk-dot dk-tone-${tone}`, title: state }),
        h('a', { className: 'dk-link', href: pr.url, target: '_blank', rel: 'noreferrer', title: `${pr.url} · ${state}` }, prLabel(pr)),
        pr.score !== undefined && h('span', {
          className: `dk-score dk-tone-${pr.score >= 4 ? 'success' : 'warn'}${pr.scoreStale ? ' dk-score-stale' : ''}`,
          title: pr.scoreStale ? 'Greptile 分数对应的是旧提交，等待重新 review' : 'Greptile Confidence Score',
        }, `G ${pr.score}/5${pr.scoreStale ? ' 旧' : ''}`))
    }

    function Card(props) {
      const { card, now, sessions, projectName, dragging, dropBefore, onDragStart, onDragEnd, onDragOver, onDrop, onOpenSession, onMove, onEdit, onDelete, onStart } = props
      const [confirming, setConfirming] = useState(false)
      useEffect(() => {
        if (!confirming) return undefined
        const id = setTimeout(() => setConfirming(false), 3000)
        return () => clearTimeout(id)
      }, [confirming])
      const index = COLUMNS.findIndex(column => column.id === card.column)
      const autoGates = GATES.filter(gate => card.gates && card.gates[gate.id] === 'auto')
      return h('article', {
        className: `dk-card${card.attention ? ' dk-card-attention' : ''}${dragging ? ' dk-card-dragging' : ''}${dropBefore ? ' dk-card-drop' : ''}`,
        draggable: true,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
        onDoubleClick: onEdit,
        'aria-label': card.title,
      },
      card.attention && h('div', { className: 'dk-attention' }, h('span', { className: 'dk-dot dk-tone-warn' }), card.attention),
      h('div', { className: 'dk-card-title' }, card.title),
      card.status && card.status !== card.attention && h('div', { className: 'dk-card-status' }, card.status),
      card.note && h('div', { className: 'dk-card-note' }, card.note),
      card.prs.length > 0 && h('div', { className: 'dk-card-meta' }, card.prs.map(pr => h(PrChip, { key: pr.url, pr }))),
      h('div', { className: 'dk-card-meta' },
        projectName && h('span', { className: 'dk-tag', title: projectName }, projectName),
        card.issue && (card.issueUrl
          ? h('a', { className: 'dk-link', href: card.issueUrl, target: '_blank', rel: 'noreferrer' }, card.issue)
          : h('span', { className: 'dk-tag' }, card.issue)),
        sessions.map(session => h('button', {
          key: session.id, type: 'button', className: 'dk-link', disabled: !session.available, title: session.label, onClick: () => onOpenSession(session.id),
        }, `会话 · ${session.label}`)),
        card.sources.map(url => h('a', { key: url, className: 'dk-link', href: url, target: '_blank', rel: 'noreferrer', title: url }, `需求 · ${hostLabel(url)}`)),
        autoGates.map(gate => h('span', { key: gate.id, className: 'dk-tag dk-tag-auto', title: `${gate.label}：AI 自己来` }, gate.auto))),
      h('div', { className: 'dk-card-foot' },
        card.running
          ? h('span', { className: 'dk-running dk-time' }, h('span', { className: 'dk-dot' }), '进行中')
          : h('span', { className: 'dk-time', title: card.updatedAt }, relativeTime(card.updatedAt, now)),
        h('span', { className: 'dk-actions' },
          card.column === 'todo' && card.sessions.length === 0
            && h('button', { type: 'button', className: 'dk-icon-btn', title: '新建会话开工（提示词放进输入框，确认后发送）', onClick: onStart }, '开工'),
          h('button', { type: 'button', className: 'dk-icon-btn', title: '移到上一列', 'aria-label': '移到上一列', disabled: index <= 0, onClick: () => onMove(COLUMNS[index - 1].id) }, '←'),
          h('button', { type: 'button', className: 'dk-icon-btn', title: '移到下一列', 'aria-label': '移到下一列', disabled: index >= COLUMNS.length - 1, onClick: () => onMove(COLUMNS[index + 1].id) }, '→'),
          h('button', { type: 'button', className: 'dk-icon-btn', title: '编辑', onClick: onEdit }, '编辑'),
          h('button', {
            type: 'button',
            className: 'dk-icon-btn dk-icon-btn-danger',
            title: confirming ? '再点一次确认删除（关联的会话不再自动跟踪）' : '删除',
            onClick: () => { if (confirming) onDelete(); else setConfirming(true) },
          }, confirming ? '确认删除' : '删除'))))
    }

    function notificationState() {
      return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    }

    function BoardPage({ store, useSessionList, openSession, startSession }) {
      const board = useBoard(store)
      const sessionList = useSessionList()
      const now = useNow(30000)
      const [projectFilter, setProjectFilter] = useState('')
      const [attentionOnly, setAttentionOnly] = useState(false)
      const [adding, setAdding] = useState(null)
      const [editing, setEditing] = useState(null)
      const [drag, setDrag] = useState(null)
      const [drop, setDrop] = useState(null)
      const [showAllDone, setShowAllDone] = useState(false)
      const [notice, setNotice] = useState('')
      const [permission, setPermission] = useState(notificationState)

      const sessionInfo = (sessionId) => {
        const summary = sessionList && sessionList.byId ? sessionList.byId[sessionId] : undefined
        const available = Boolean(summary) && Array.isArray(sessionList.ids) && sessionList.ids.includes(sessionId)
        const label = available ? ((summary && summary.title) || '未命名会话') : '会话已不可用'
        return { id: sessionId, available, label, cwd: summary && summary.cwd }
      }
      const projectOf = (card) => {
        if (card.project) return card.project
        for (const sessionId of card.sessions) {
          const project = projectFromCwd(sessionInfo(sessionId).cwd)
          if (project) return project
        }
        return ''
      }
      const projects = useMemo(
        () => [...new Set(board.cards.map(projectOf).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        [board.cards, sessionList],
      )
      const waitingCount = board.cards.filter(card => card.attention).length
      const visible = board.cards.filter(card => (projectFilter === '' || projectOf(card) === projectFilter) && (!attentionOnly || card.attention))
      const openCount = board.cards.filter(card => card.column !== 'done').length

      const run = async (op, args) => {
        try {
          const value = await store.mutate(op, args)
          setNotice('')
          return value ?? true
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error))
          return undefined
        }
      }
      const moveTo = (card, column, beforeId) => run('update', { id: card.id, column, beforeId })
      const start = (card) => {
        const prompt = [
          card.title,
          card.note,
          ...card.sources,
          `（看板卡片 ${card.id}：开始前先用 kanban 工具的 link 把这张卡关联到当前会话。）`,
        ].filter(Boolean).join('\n\n')
        startSession(prompt)
      }
      const enableNotifications = async () => {
        if (typeof Notification === 'undefined') return
        setPermission(await Notification.requestPermission())
      }

      const dropTargetFor = (event, column, card) => {
        if (drag === null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        let beforeId = null
        if (card !== undefined) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientY < rect.top + rect.height / 2) beforeId = card.id
          else {
            const columnCards = visible.filter(other => other.column === column)
            const next = columnCards[columnCards.findIndex(other => other.id === card.id) + 1]
            beforeId = next ? next.id : null
          }
          event.stopPropagation()
        }
        if (beforeId === drag) return
        if (!drop || drop.column !== column || drop.beforeId !== beforeId) setDrop({ column, beforeId })
      }
      const finishDrop = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const card = board.cards.find(other => other.id === drag)
        const target = drop
        setDrag(null)
        setDrop(null)
        if (!card || !target) return
        void moveTo(card, target.column, target.beforeId)
      }

      const renderColumn = (column) => {
        let cards = visible.filter(card => card.column === column.id)
        const total = cards.length
        if (column.id === 'done') {
          cards = cards.toSorted((a, b) => (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt))
          if (!showAllDone) cards = cards.slice(0, DONE_VISIBLE)
        }
        const over = drop !== null && drop.column === column.id
        return h('section', {
          key: column.id,
          className: `dk-column${over ? ' dk-column-over' : ''}`,
          'aria-label': column.label,
          onDragOver: event => dropTargetFor(event, column.id, undefined),
          onDrop: finishDrop,
          onDragLeave: (event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && drop && drop.column === column.id) setDrop(null)
          },
        },
        h('div', { className: 'dk-column-head' },
          h('span', { className: `dk-dot dk-tone-${column.tone}` }),
          h('span', null, column.label),
          h('span', { className: 'dk-count' }, total),
          h('span', { className: 'dk-spacer' }),
          h('button', { type: 'button', className: 'dk-icon-btn', title: `在「${column.label}」新建卡片`, 'aria-label': `在「${column.label}」新建卡片`, onClick: () => { setEditing(null); setAdding(column.id) } }, '+')),
        h('div', { className: 'dk-column-body' },
          adding === column.id && h(CardForm, {
            initial: { project: projectFilter },
            submitLabel: '添加',
            onCancel: () => setAdding(null),
            onSubmit: async (fields) => {
              const ok = await run('add', { ...fields, column: column.id })
              if (ok) setAdding(null)
              return Boolean(ok)
            },
          }),
          cards.map((card) => {
            const sessions = card.sessions.map(sessionInfo)
            if (editing === card.id) {
              return h(CardForm, {
                key: card.id,
                initial: card,
                sessionLabels: sessions,
                submitLabel: '保存',
                onCancel: () => setEditing(null),
                onUnlink: async (sessionId) => { await run('unlink', { id: card.id, sessionId }) },
                onSubmit: async (fields) => {
                  const ok = await run('update', { id: card.id, ...fields })
                  if (ok) setEditing(null)
                  return Boolean(ok)
                },
              })
            }
            return h(Card, {
              key: card.id,
              card,
              now,
              sessions,
              projectName: projectOf(card),
              dragging: drag === card.id,
              dropBefore: drop !== null && drop.column === column.id && drop.beforeId === card.id,
              onDragStart: (event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.id)
                setDrag(card.id)
              },
              onDragEnd: () => { setDrag(null); setDrop(null) },
              onDragOver: event => dropTargetFor(event, column.id, card),
              onDrop: finishDrop,
              onOpenSession: (sessionId) => { if (sessionInfo(sessionId).available) openSession(sessionId) },
              onMove: target => void moveTo(card, target, undefined),
              onEdit: () => { setAdding(null); setEditing(card.id) },
              onDelete: () => void run('remove', { id: card.id }),
              onStart: () => start(card),
            })
          }),
          over && drop.beforeId === null && h('div', { className: 'dk-drop-end' }),
          total === 0 && adding !== column.id && h('div', { className: 'dk-empty' }, '暂无卡片'),
          column.id === 'done' && total > DONE_VISIBLE && h('button', {
            type: 'button', className: 'dk-icon-btn dk-more', onClick: () => setShowAllDone(value => !value),
          }, showAllDone ? '只看最近' : `显示全部 ${total} 张`)))
      }

      return h('div', { className: 'dk-page' },
        h('header', { className: 'dk-header' },
          h('h1', { className: 'dk-title' }, '许愿池'),
          board.status === 'ready' && h('span', { className: 'dk-subtitle' }, `${openCount} 项进行中`),
          board.status === 'loading' && h('span', { className: 'dk-subtitle' }, '加载中…'),
          (notice || board.error) && h('span', { className: 'dk-notice', role: 'status' }, notice || board.error),
          h('span', { className: 'dk-spacer' }),
          h('button', {
            type: 'button',
            className: `dk-btn${attentionOnly ? ' dk-btn-on' : ''}`,
            'aria-pressed': attentionOnly,
            onClick: () => setAttentionOnly(value => !value),
          }, h('span', { className: 'dk-dot dk-tone-warn' }), `等我处理 ${waitingCount}`),
          permission === 'default' && h('button', { type: 'button', className: 'dk-btn', onClick: () => void enableNotifications() }, '开启系统通知'),
          permission === 'denied' && h('span', { className: 'dk-subtitle', title: '在系统或浏览器设置里允许通知' }, '系统通知已被禁止'),
          projects.length > 0 && h('select', {
            className: 'dk-select', value: projectFilter, onChange: e => setProjectFilter(e.target.value), 'aria-label': '按项目筛选',
          },
          h('option', { value: '' }, '全部项目'),
          projects.map(name => h('option', { key: name, value: name }, name))),
          h('button', { type: 'button', className: 'dk-btn dk-btn-primary', onClick: () => { setEditing(null); setAdding('todo') } }, '+ 新建卡片')),
        board.status === 'ready' && board.cards.length === 0 && h('p', { className: 'dk-hint' },
          '新会话发出第一条消息后会自动上看板（「方案」列），之后随开发、PR、CI、合并自动推进。需要你处理时卡片高亮，并发系统通知。也可以先在「许愿池」建卡，再点卡片上的「开工」新开会话。'),
        h('div', { className: 'dk-columns' }, COLUMNS.map(renderColumn)))
    }

    /**
     * Stage label of a Session's unshipped card, or null once shipped or
     * untracked. It renders in the row's trailing seat; the stylesheet places
     * it before the title in every row state.
     */
    function RowBadge({ sessionId, store }) {
      const card = cardForSession(useBoard(store).cards, sessionId)
      if (card === undefined || card.column === 'done') return null
      const column = COLUMN_BY_ID[card.column]
      return h('span', {
        className: `dk-badge dk-trail ${card.attention ? 'dk-badge-attention' : `dk-tone-${column.tone}`}`,
        title: `看板：${column.label}${card.attention ? ` · ${card.attention}` : ''} · ${card.title}`,
      }, card.attention ? `! ${column.short}` : column.short)
    }

    function RowHover({ sessionId, store }) {
      const board = useBoard(store)
      const card = cardForSession(board.cards, sessionId)
      if (card === undefined) return null
      const column = COLUMN_BY_ID[card.column]
      const detail = card.attention || card.status
      return h('div', { className: 'dk-hover' },
        h('div', { className: 'dk-hover-line' },
          h('span', { className: `dk-dot dk-tone-${card.attention ? 'warn' : column.tone}` }),
          h('span', { className: 'dk-hover-label' }, `看板 · ${column.label}`),
          detail && h('span', { className: 'dk-hover-text', title: detail }, detail)),
        card.prs.length > 0 && h('div', { className: 'dk-hover-line' },
          h('span', { className: 'dk-hover-text' }, card.prs.map(pr => `${prLabel(pr)} ${pr.state === 'MERGED' ? '已合并' : CHECK_LABELS[pr.checks] || ''}${pr.score !== undefined ? ` G${pr.score}/5` : ''}`).join(' · '))))
    }

    const TONES = [...new Set(COLUMNS.map(column => column.tone))]
    const MENU_FAILURE = '许愿池更新失败，请重试'
    /**
     * The built-in Session menu groups pin/rename/fork (100–300), then
     * copy-id/open-in-app (450–500, opened by a separator), then archive (600).
     * 400 gives the wishing-well actions their own group between the first two
     * without splitting either.
     */
    const MENU_ORDER = 400

    /** Icon of one stage item: a dot in the column's tone, marked when it is the next step. */
    function stageIcon(tone, next) {
      return function StageIcon() {
        return h('span', { className: `dk-menu-dot dk-tone-${tone}${next ? ' dk-next-mark' : ''}` })
      }
    }

    /**
     * Menu glyphs drawn to the host's primitive icon spec: 16px viewBox, stroke
     * width 1, round caps and joins, currentColor.
     */
    const GLYPH = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
    const MENU_GLYPHS = {
      // Three board columns of different heights: move to a stage.
      'kanban.menu.move': () => h('svg', GLYPH,
        h('rect', { x: 2.25, y: 2.25, width: 3, height: 11.5, rx: 1 }),
        h('rect', { x: 6.5, y: 2.25, width: 3, height: 7.5, rx: 1 }),
        h('rect', { x: 10.75, y: 2.25, width: 3, height: 9.5, rx: 1 })),
      'kanban.menu.add': () => h('svg', GLYPH, h('circle', { cx: 8, cy: 8, r: 6.25 }), h('path', { d: 'M8 5v6M5 8h6' })),
      'kanban.menu.remove': () => h('svg', GLYPH, h('circle', { cx: 8, cy: 8, r: 6.25 }), h('path', { d: 'M5 8h6' })),
    }

    /**
     * Session context-menu actions: a submenu of every stage, the next one in
     * bold and the current one disabled, plus removal; an untracked Session
     * gets an add submenu instead, with the plan stage suggested.
     */
    async function sessionMenuActions(store, { sessionId, displayTitle }) {
      if (store.getSnapshot().status !== 'ready') await store.refresh()
      const snapshot = store.getSnapshot()
      // An unreadable board offers nothing rather than a misleading "add".
      if (snapshot.status !== 'ready') return []
      const card = cardForSession(snapshot.cards, sessionId)
      const settle = promise => promise.then(() => undefined)
      const stage = (column, { current = false, next = false, run }) => ({
        id: column.id,
        label: current ? `${column.label}（当前）` : column.label,
        icon: { key: `kanban.stage.${column.tone}${next ? '.next' : ''}` },
        ...(current ? { disabled: true } : { run, failureLabel: MENU_FAILURE }),
      })
      if (card === undefined) {
        return [{
          id: 'add',
          label: '加入许愿池',
          icon: { key: 'kanban.menu.add' },
          separatorBefore: true,
          children: COLUMNS.map(column => stage(column, {
            next: column.id === 'plan',
            run: () => settle(store.mutate('add', { title: displayTitle || '未命名会话', column: column.id, sessions: [sessionId] })),
          })),
        }]
      }
      const index = COLUMNS.findIndex(column => column.id === card.column)
      return [
        {
          id: 'move',
          label: '移动到许愿阶段',
          icon: { key: 'kanban.menu.move' },
          separatorBefore: true,
          children: COLUMNS.map((column, i) => stage(column, {
            current: i === index,
            next: i === index + 1,
            run: () => settle(store.mutate('update', { id: card.id, column: column.id })),
          })),
        },
        { id: 'remove', label: '移除出许愿池', icon: { key: 'kanban.menu.remove' }, failureLabel: MENU_FAILURE, run: () => settle(store.mutate('remove', { id: card.id })) },
      ]
    }

    /**
     * Raise a system notification when a card starts needing the user. The
     * first snapshot only records the current state, so opening the app does
     * not replay old reasons.
     */
    function watchAttention(store, openBoardCard) {
      let known
      const check = () => {
        const snapshot = store.getSnapshot()
        if (snapshot.status !== 'ready') return
        const current = new Map(snapshot.cards.filter(card => card.attention).map(card => [`${card.id}:${card.attention}`, card]))
        if (known !== undefined && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const [key, card] of current) {
            if (known.has(key)) continue
            try {
              const notification = new Notification(`看板 · ${card.attention}`, { body: card.title, tag: key })
              notification.onclick = () => {
                window.focus()
                openBoardCard(card)
                notification.close()
              }
            } catch (error) {
              console.warn('kanban: notification failed', error)
            }
          }
        }
        known = new Set(current.keys())
      }
      return store.subscribe(check)
    }

    return {
      inject: ['slots', 'uiWorkspace', 'sessions', 'contextMenus'],
      apply(ctx) {
        const store = createBoardStore()
        const disposeCss = injectCss(CSS)
        const openSession = (id) => { ctx.uiWorkspace.openSession(id) }
        const stopWatching = watchAttention(store, (card) => {
          const sessionId = card.sessions[card.sessions.length - 1]
          if (sessionId !== undefined) openSession(sessionId)
        })
        ctx.effect(() => () => {
          stopWatching()
          store.dispose()
          disposeCss()
        }, 'kanban: board store, notifications, and stylesheet')

        const sessionList = ctx.sessions.list
        const subscribeSessions = listener => sessionList.subscribe(listener)
        const readSessions = () => sessionList.getSnapshot()
        const useSessionList = () => useSyncExternalStore(subscribeSessions, readSessions)
        const page = {
          store,
          useSessionList,
          openSession,
          startSession: (prompt) => { ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' }) },
        }
        const shared = () => ({ store })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: '许愿池', inject: shared,
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, inject: () => page,
        }, BoardPage))
        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing', id: 'kanban-column', order: 50, inject: shared,
        }, RowBadge))
        ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
          name: 'sidebar.session.row.hover', id: 'kanban-card', order: 20, inject: shared,
        }, RowHover))
        ctx.effect(() => ctx.contextMenus.register({
          id: 'kanban',
          target: 'session',
          order: MENU_ORDER,
          resolve: target => sessionMenuActions(store, target),
        }), 'kanban: session context menu')
        ctx.slots.inject('contextMenu.icon', function* () {
          for (const tone of TONES) {
            yield ctx.slots.register({ name: 'contextMenu.icon', key: `kanban.stage.${tone}` }, stageIcon(tone, false))
            yield ctx.slots.register({ name: 'contextMenu.icon', key: `kanban.stage.${tone}.next` }, stageIcon(tone, true))
          }
          for (const [key, Glyph] of Object.entries(MENU_GLYPHS)) {
            yield ctx.slots.register({ name: 'contextMenu.icon', key }, Glyph)
          }
        })
      },
    }
  },
})
