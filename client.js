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
    const LOCALE_NS = 'wishingWell'
    const COPY = {
      title: ['许愿池', 'Wishing Well'], subtitle: ['跨会话工作台', 'Cross-session workspace'],
      views: ['许愿池视图', 'Wishing Well views'], board: ['看板', 'Board'], projects: ['项目', 'Projects'],
      projectOverview: ['项目总览', 'Projects overview'],
      projectHelp: ['点项目名看完整看板，点待处理数字直达需要你处理的卡片。', 'Open a project to see its board, or select its count to see what needs you.'],
      needYou: ['待我处理', 'Needs me'], needCount: ['待我处理 {count}', 'Needs me {count}'],
      projectNeed: ['{name}：查看 {count} 项待我处理', '{name}: view {count} items that need you'],
      incomplete: ['未完成', 'Open'], incompleteCount: ['{count} 项未完成', '{count} open'],
      breakdown: ['阶段分布 · 未完成', 'Breakdown of open items'], noOpen: ['暂无未完成事项', 'No open items'],
      all: ['全部项目', 'All projects'], noProject: ['未归类', 'Unassigned'], inferred: ['推断', 'Inferred'],
      projectPicker: ['当前项目', 'Current project'], projectField: ['项目归属', 'Project'],
      inferredHelp: ['当前分组由会话目录推断。请填写项目名，或留空归为未归类。', 'This group is inferred from a session folder. Enter a project or leave it unassigned.'],
      jump: ['跳到阶段', 'Jump to stage'], newCard: ['新建愿望', 'New wish'], addAt: ['在「{stage}」新建卡片', 'Add a card in {stage}'],
      loading: ['正在加载看板…', 'Loading the board…'], empty: ['暂无卡片', 'No cards'], clear: ['清除筛选', 'Clear filter'],
      noAttention: ['这个范围里没有待你处理的事项', 'Nothing needs you here'],
      onboarding: ['新会话发出第一条消息后会自动上看板。也可以先新建愿望，再点「开工」填写会话草稿。', 'New sessions appear on the board after their first message. Or add a wish and start a session draft from it.'],
      notify: ['开启系统通知', 'Enable notifications'], notifyDenied: ['系统通知已被禁止', 'Notifications are blocked'],
      showAll: ['显示全部 {count} 张', 'Show all {count} cards'], showRecent: ['只看最近', 'Show recent'],
      more: ['更多操作：{title}', 'More actions: {title}'], detail: ['查看详情', 'View details'], edit: ['编辑', 'Edit'],
      move: ['移到阶段', 'Move to stage'], moveConfirm: ['移动', 'Move'], moved: ['已移到「{stage}」', 'Moved to {stage}'],
      movedHidden: ['已移到「{stage}」；这张卡不再符合当前筛选。', 'Moved to {stage}; the card no longer matches this filter.'],
      start: ['开工', 'Start'], startHint: ['填入新会话草稿，不自动发送', 'Draft a new session without sending'],
      session: ['会话', 'Session'], continueSession: ['继续会话', 'Continue session'],
      untitledSession: ['未命名会话', 'Untitled session'], unavailableSession: ['会话已不可用', 'Session unavailable'],
      linkedWork: ['关联工作', 'Related work'], source: ['需求 · {host}', 'Source · {host}'],
      detach: ['取消关联', 'Unlink'], issue: ['Linear issue', 'Linear issue'],
      current: ['当前状态', 'Current status'], noStatus: ['暂无进展记录', 'No progress recorded'],
      running: ['AI 进行中', 'AI working'], backlog: ['待开工', 'Not started'], details: ['卡片详情', 'Card details'],
      editCard: ['编辑卡片', 'Edit card'], heading: ['标题（必填）', 'Title (required)'], note: ['备注', 'Notes'],
      approval: ['审批设置', 'Checkpoints'], human: ['人工', 'Manual'], auto: ['AI 自己来', 'Agent handles it'],
      planGate: ['方案评审', 'Plan review'], localGate: ['本地验收', 'Local verification'], mergeGate: ['合并前检查', 'Pre-merge check'],
      prs: ['PR 链接，每行一个', 'PR URLs, one per line'], sources: ['需求来源链接，每行一个', 'Source URLs, one per line'],
      save: ['保存', 'Save'], add: ['添加卡片', 'Add card'], cancel: ['取消', 'Cancel'], close: ['关闭', 'Close'],
      remove: ['删除卡片', 'Delete card'], confirmRemove: ['确认删除', 'Confirm deletion'],
      removeHint: ['该卡片和关联会话的自动跟踪将被移除。会话本身不会删除。', 'This removes the card and stops tracking its linked sessions. The sessions themselves are not deleted.'],
      missing: ['卡片已不在看板上', 'The card is no longer on the board'],
      added: ['已添加到「{project}」· {stage}', 'Added to {project} · {stage}'],
      pending: [CHECK_LABELS.pending, 'CI running'], passing: [CHECK_LABELS.passing, 'CI passed'],
      failing: [CHECK_LABELS.failing, 'CI failed'], none: [CHECK_LABELS.none, 'No CI'],
      merged: ['已合并', 'Merged'], closed: ['已关闭', 'Closed'], checking: ['等待查询', 'Awaiting checks'],
      stale: [' 旧', ' stale'], staleHint: ['Greptile 分数对应旧提交，等待复审', 'This Greptile score is for an older commit'],
      dateNow: ['刚刚', 'Just now'], minute: ['{count} 分钟前', '{count}m ago'],
      hour: ['{count} 小时前', '{count}h ago'], day: ['{count} 天前', '{count}d ago'],
      ...Object.fromEntries(COLUMNS.map((stage, index) => [`stage.${stage.id}`, [stage.label, ['Wishes', 'Plan', 'Development', 'Local check', 'PR·CI', 'Staging', 'Ready to ship', 'Shipped'][index]]] )),
    }
    const boardDictionaries = Object.fromEntries(['zh', 'en'].map((lang, index) => [lang,
      Object.fromEntries(Object.entries(COPY).map(([key, labels]) => [key, labels[index]])),
    ]))
    const stageText = (t, id) => t(`stage.${id}`)
    const gateText = (t, gate) => t(`${gate.id}Gate`)

    const CSS = `
.dk-page { --dk-border: var(--dsw-alias-border-l2); --dk-subtle: var(--dsw-alias-label-secondary); --dk-tray: var(--dsw-alias-interactive-bg-hover); --dk-accent: var(--dsw-alias-state-business-primary); height: 100%; min-height: 0; position: relative; display: flex; flex-direction: column; container-type: inline-size; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 14px/1.5 var(--dsw-font-family); }
.dk-page button, .dk-page input, .dk-page textarea, .dk-page select { font-family: inherit; }
.dk-page :is(button, select, input, textarea, summary, a, section):focus-visible { outline: 2px solid var(--dk-accent); outline-offset: 2px; }
.dk-header { flex: none; border-bottom: 1px solid var(--dk-border); padding: 18px 28px 0; }
.dk-mast, .dk-brand, .dk-tabs, .dk-toolbar, .dk-controls, .dk-column-head, .dk-column-name, .dk-card-top, .dk-card-foot, .dk-work-links { display: flex; align-items: center; }
.dk-mast, .dk-toolbar { justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dk-brand { gap: 11px; }
.dk-mark { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: var(--dsw-radius-lg); background: var(--dk-tray); color: var(--dk-accent); }
.dk-title { margin: 0; font-size: 24px; font-weight: 720; line-height: 1.18; }
.dk-subtitle { color: var(--dk-subtle); font-size: 12px; }
.dk-tabs { gap: 20px; margin-top: 16px; }
.dk-tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 0 3px 12px; border: 0; background: none; color: var(--dk-subtle); font-size: 13px; font-weight: 600; cursor: pointer; }
.dk-tab[aria-current=page] { color: var(--dsw-alias-link); }
.dk-tab[aria-current=page]::after { content: ''; position: absolute; inset: auto 0 -1px; height: 2px; border-radius: 2px 2px 0 0; background: var(--dk-accent); }
.dk-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dk-toolbar { flex: none; padding: 14px 28px 10px; }
.dk-controls { gap: 8px; flex-wrap: wrap; min-width: 0; }
.dk-control-wrap { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.dk-control-wrap > svg { position: absolute; inset-inline-start: 9px; pointer-events: none; color: var(--dk-subtle); }
.dk-control-wrap > .dk-select { padding-inline-start: 29px; max-width: min(240px, 65cqw); text-overflow: ellipsis; }
.dk-select, .dk-input, .dk-textarea { box-sizing: border-box; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-sm); }
.dk-select, .dk-input { min-height: 33px; padding: 0 8px; }
.dk-input, .dk-textarea { width: 100%; }
.dk-textarea { min-height: 60px; padding: 7px 8px; resize: vertical; }
.dk-btn, .dk-icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 33px; padding: 0 10px; font: inherit; font-size: 13px; font-weight: 560; color: inherit; background: transparent; border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-sm); cursor: pointer; white-space: nowrap; }
.dk-icon-btn { min-height: 27px; min-width: 27px; padding: 0 5px; border-color: transparent; color: var(--dk-subtle); }
.dk-btn:hover, .dk-icon-btn:hover { background: var(--dk-tray); }
.dk-btn:disabled, .dk-icon-btn:disabled { opacity: .55; cursor: default; }
.dk-btn-on { border-color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.dk-btn-on:hover { background: var(--dsw-alias-state-warn-tertiary); }
.dk-btn-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); }
.dk-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.dk-btn-danger { color: var(--dsw-alias-label-error); }
.dk-notice { margin: 0 28px 8px; font-size: 12px; color: var(--dk-subtle); }
.dk-problem { color: var(--dsw-alias-label-error); }
.dk-columns { flex: 1; min-height: 0; position: relative; display: flex; gap: 12px; padding: 2px 28px 14px; overflow-x: auto; overflow-y: hidden; }
.dk-column { flex: 0 0 clamp(210px, calc((100% - 60px) / 5), 288px); min-height: 0; display: flex; flex-direction: column; background: color-mix(in srgb, var(--dk-tray) 64%, var(--dsw-alias-bg-base)); border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-lg); }
.dk-column-over { outline: 2px dashed var(--dk-accent); outline-offset: -2px; }
.dk-column-head { justify-content: space-between; gap: 6px; padding: 8px 9px 6px 12px; }
.dk-column-name { gap: 7px; white-space: nowrap; font-size: 13px; font-weight: 660; }
.dk-count { display: inline-flex; justify-content: center; min-width: 20px; padding-inline: 4px; border-radius: var(--dsw-radius-xs); background: var(--dk-tray); color: var(--dk-subtle); font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dk-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.dk-tone-idle { color: var(--dsw-alias-state-idle-primary); }
.dk-tone-business { color: var(--dsw-alias-state-business-primary); }
.dk-tone-warn { color: var(--dsw-alias-state-warn-primary); }
.dk-tone-ready { color: var(--dsw-alias-state-done-primary); }
.dk-tone-success { color: var(--dsw-alias-state-success-primary); }
.dk-tone-error { color: var(--dsw-alias-state-error-primary); }
.dk-column-body { flex: 1; min-height: 26px; overflow-y: auto; padding: 2px 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.dk-empty { padding: 12px 5px; border: 1px dashed var(--dk-border); border-radius: var(--dsw-radius-md); color: var(--dk-subtle); font-size: 12px; text-align: center; }
.dk-card { position: relative; flex: none; display: flex; flex-direction: column; min-width: 0; padding: 7px 10px 8px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-md); }
.dk-card:hover, .dk-card:focus-within { border-color: var(--dsw-alias-border-l3); }
.dk-card-top, .dk-card-foot { justify-content: space-between; gap: 5px; }
.dk-card-top { margin-bottom: 3px; }
.dk-card-foot { border-top: 1px solid var(--dk-border); padding-top: 6px; margin-top: 8px; min-width: 0; font-size: 11px; }
.dk-card-menu { position: absolute; z-index: 2; display: grid; gap: 4px; width: 176px; padding: 6px; border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dk-card-menu > button { justify-content: flex-start; border-color: transparent; }
.dk-move-form { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.dk-card-menu > .dk-move-form { display: grid; margin-top: 2px; padding-top: 6px; border-top: 1px solid var(--dk-border); }
.dk-card-menu > .dk-move-form .dk-btn { min-height: 30px; }
.dk-drawer-notice { margin-bottom: 8px; font-size: 12px; }
.dk-muted { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dk-subtle); font-size: 11px; }
.dk-card-dragging { opacity: .45; }
.dk-card-drop::before { content: ''; position: absolute; left: 0; right: 0; top: -6px; height: 2px; border-radius: 1px; background: var(--dk-accent); }
.dk-drop-end { flex: none; height: 2px; background: var(--dk-accent); }
.dk-status-pill { display: inline-flex; gap: 4px; align-items: center; min-width: 0; max-width: 100%; border-radius: var(--dsw-radius-xs); padding: 2px 6px; font-size: 11px; font-weight: 620; }
.dk-status-pill > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dk-status-pill.dk-tone-warn { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.dk-status-pill.dk-tone-error { background: var(--dk-tray); color: var(--dsw-alias-label-error); }
.dk-status-pill.dk-tone-business { background: var(--dk-tray); color: var(--dsw-alias-label-secondary); }
.dk-card-title { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; text-align: start; font-size: 14px; font-weight: 650; line-height: 1.42; overflow-wrap: anywhere; }
.dk-card-title:hover { color: var(--dsw-alias-link); }
.dk-card-title > span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dk-card-status { color: var(--dk-subtle); font-size: 12px; line-height: 19px; margin-top: 5px; min-height: 22px; }
.dk-card-status > .dk-muted { display: block; font-size: inherit; }
.dk-link { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; color: var(--dsw-alias-link); cursor: pointer; text-decoration: none; overflow-wrap: anywhere; text-align: start; }
.dk-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.dk-link:disabled { color: var(--dk-subtle); cursor: default; }
.dk-pr { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; }
.dk-score { font-size: 11px; padding: 0 4px; line-height: 16px; border-radius: var(--dsw-radius-xs); border: 1px solid currentColor; white-space: nowrap; }
.dk-score-stale { opacity: .68; }
.dk-board-empty { margin: 8px 28px; padding: 24px 12px; border: 1px dashed var(--dk-border); border-radius: var(--dsw-radius-md); text-align: center; font-size: 13px; }
.dk-board-empty .dk-btn { margin-top: 10px; }
.dk-projects { overflow: auto; padding: 18px 28px 24px; width: 100%; max-width: 1150px; margin-inline: auto; }
.dk-projects h2 { margin: 0 0 4px; font-size: 22px; }
.dk-projects p { margin: 0 0 15px; }
.dk-project-table { border: 1px solid var(--dk-border); border-radius: var(--dsw-radius-lg); overflow: clip; }
.dk-project-row { display: grid; grid-template-columns: minmax(125px, 1.2fr) minmax(78px, .5fr) minmax(60px, .4fr) minmax(155px, 1.7fr); gap: 10px; align-items: center; padding: 14px 16px; border-top: 1px solid var(--dk-border); min-height: 63px; }
.dk-project-row-head { min-height: 0; padding-block: 9px; background: var(--dk-tray); border-top: 0; color: var(--dk-subtle); font-size: 12px; }
.dk-project-name { display: flex; align-items: center; gap: 9px; min-width: 0; }
.dk-project-name svg { flex: none; }
.dk-project-name .dk-link { color: inherit; font-size: 14px; font-weight: 650; white-space: normal; }
.dk-project-row:not(.dk-project-row-head):focus-within, .dk-project-row:not(.dk-project-row-head):hover { background: var(--dk-tray); }
.dk-project-count { font-size: 16px; font-weight: 690; font-variant-numeric: tabular-nums; }
.dk-project-wait { min-height: 29px; min-width: 40px; color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); border-color: transparent; }
.dk-project-wait:hover { background: var(--dsw-alias-state-warn-tertiary); border-color: var(--dsw-alias-state-warn-primary); }
.dk-phase-bar { height: 5px; margin-bottom: 6px; display: flex; gap: 3px; }
.dk-phase-bar > span { border-radius: 3px; background: currentColor; }
.dk-phase-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--dk-subtle); font-size: 11px; }
.dk-phase-legend > span { white-space: nowrap; }
.dk-phase-legend .dk-dot { width: 5px; height: 5px; margin-inline-end: 4px; vertical-align: 1px; }
.dk-drawer { position: fixed; inset: 0 0 0 auto; margin: 0; width: min(450px, 100%); max-width: none; height: 100%; height: 100dvh; max-height: none; padding: 0; overflow: auto; background: var(--dsw-alias-bg-base); color: inherit; border: 0; border-inline-start: 1px solid var(--dk-border); }
.dk-drawer::backdrop { background: color-mix(in srgb, var(--dsw-alias-bg-base) 56%, transparent); }
.dk-drawer-head { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 20px; color: var(--dk-subtle); border-bottom: 1px solid var(--dk-border); background: var(--dsw-alias-bg-base); }
.dk-drawer-body { padding: 17px 20px 24px; }
.dk-drawer-body h2 { margin: 3px 0 12px; font-size: 22px; line-height: 1.3; overflow-wrap: anywhere; }
.dk-detail-section { margin-top: 17px; padding-top: 12px; border-top: 1px solid var(--dk-border); overflow-wrap: anywhere; }
.dk-detail-section h3 { margin: 0 0 7px; font-size: 13px; }
.dk-detail-text { margin: 6px 0 0; white-space: pre-wrap; color: var(--dk-subtle); font-size: 13px; }
.dk-work-links { gap: 6px 10px; flex-wrap: wrap; }
.dk-gate-list { margin: 0; padding-inline-start: 18px; font-size: 12px; color: var(--dk-subtle); }
.dk-form { display: flex; flex-direction: column; gap: 10px; }
.dk-form > label, .dk-form-gates > label { display: grid; gap: 4px; color: var(--dk-subtle); font-size: 12px; }
.dk-form-gates { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.dk-form-gates .dk-select { min-width: 0; width: 100%; }
.dk-form-row, .dk-form-session { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
.dk-form-session { justify-content: space-between; color: var(--dk-subtle); font-size: 12px; }
.dk-form-row { justify-content: flex-end; }
.dk-more { align-self: center; }
@container (max-width: 690px) {
  .dk-header { padding-inline: 15px; }
  .dk-toolbar, .dk-columns, .dk-projects { padding-inline: 15px; }
  .dk-notice, .dk-board-empty { margin-inline: 15px; }
  .dk-project-row { grid-template-columns: minmax(84px, 1fr) 72px 52px; padding-inline: 10px; }
  .dk-project-row-head > :last-child { display: none; }
  .dk-phase { grid-column: 1 / -1; }
}
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

    function directoryProject(cwd) {
      if (typeof cwd !== 'string') return undefined
      let path = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
      const unc = path.startsWith('//')
      if (!unc && !path.startsWith('/') && !/^[a-z]:\//i.test(path)) return undefined
      path = (unc ? '//' + path.slice(2) : path).replace(/(?!^)\/{2,}/g, '/')
      path = path.replace(/^[a-z]:/i, drive => drive.toUpperCase())
      const parts = path.split('/').filter(Boolean)
      if (parts.length <= (unc ? 2 : path.startsWith('/') ? 0 : 1) || parts.some(part => part === '.' || part === '..')) return undefined
      return { key: `cwd:${path}`, label: parts.at(-1), directory: path }
    }

    /** Infer only from a single, consistent directory across all known linked sessions. */
    function projectFor(card, sessions) {
      const name = typeof card.project === 'string' ? card.project.trim() : ''
      if (name) return { key: `name:${name.toLowerCase()}`, label: name, explicit: name }
      const directories = card.sessions.map(id => directoryProject(sessions.get(id)?.cwd))
      const first = directories[0]
      if (first && directories.every(project => project?.key === first.key)) return first
      return { key: 'none' }
    }

    function countCards(cards) {
      const columns = Object.fromEntries(COLUMNS.map(column => [column.id, 0]))
      let waiting = 0
      for (const card of cards) {
        columns[card.column]++
        if (card.attention) waiting++
      }
      return { columns, waiting, open: cards.length - columns.done }
    }

    function groupProjects(cards, sessions) {
      const groups = new Map(), byCard = new Map()
      for (const card of cards) {
        const project = projectFor(card, sessions)
        let group = groups.get(project.key)
        if (!group) {
          group = { ...project, cards: [] }
          groups.set(project.key, group)
        }
        group.cards.push(card)
        byCard.set(card.id, group)
      }
      for (const group of groups.values()) Object.assign(group, countCards(group.cards))
      const labels = new Map()
      for (const group of groups.values()) {
        const label = group.label?.toLowerCase()
        if (label) labels.set(label, (labels.get(label) ?? 0) + 1)
      }
      for (const group of groups.values()) {
        if (group.directory && labels.get(group.label.toLowerCase()) > 1) group.disambiguate = group.directory
      }
      return { groups, byCard }
    }

    function projectText(t, project) {
      if (!project) return t('all')
      if (project.key === 'none') return t('noProject')
      return project.directory ? `${project.label} · ${t('inferred')}${project.disambiguate ? ` · ${project.disambiguate}` : ''}` : project.label
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

    function relativeTime(iso, now, t, locale) {
      const time = Date.parse(iso)
      if (Number.isNaN(time)) return ''
      const minutes = Math.round((now - time) / 60000)
      if (minutes < 1) return t('dateNow')
      if (minutes < 60) return t('minute', { count: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return t('hour', { count: hours })
      const days = Math.round(hours / 24)
      if (days < 30) return t('day', { count: days })
      return new Date(time).toLocaleDateString(locale)
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

    function Glyph({ name, size = 16 }) {
      const paths = {
        wish: 'M7 1.5Q8 7 13.5 8Q8 9 7 14.5Q6 9 .5 8Q6 7 7 1.5ZM13 1v4m-2-2h4',
        board: 'M2 2.5h12v11H2zM6 2.5v11m4-11v11',
        folder: 'M2 4a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
        plus: 'M8 3v10M3 8h10', close: 'M4 4l8 8m0-8-8 8', more: 'M3 8h.01M8 8h.01M13 8h.01',
        chat: 'M13.5 7.5A5.5 5.5 0 0 1 8 13H2l1.35-2.5A5.5 5.5 0 1 1 13.5 7.5z',
        jump: 'M3 4h10M3 8h7m-7 4h4', history: 'M2.5 8A5.5 5.5 0 1 1 4 12m-2-7v3h3m3-3v3l2 1',
        alert: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-9v3m0 2.5h.01',
        fail: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6 6l4 4m0-4-4 4',
        clock: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-9v3l2 1',
      }
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: name === 'more' ? 2 : 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] }))
    }

    function CardForm({ t, initial, projects, sessions, projectHint, onSubmit, onCancel, onUnlink, creating, draftId }) {
      const makeFields = value => Object.fromEntries(['title', 'project', 'issue', 'issueUrl', 'status', 'note'].map(key => [key, value[key] ?? '']))
      const [base] = useState(() => ({
        ...makeFields(initial),
        prs: (initial.prs ?? []).map(pr => pr.url).join('\n'), sources: (initial.sources ?? []).join('\n'),
        gates: initial.gates ?? { plan: 'human', local: 'human', merge: 'human' },
      }))
      const [fields, setFields] = useState(base)
      const [busy, setBusy] = useState(false)
      const titleRef = useRef(null)
      useEffect(() => { titleRef.current?.focus() }, [])
      const set = (key, value) => setFields(previous => ({ ...previous, [key]: value }))
      const submit = async event => {
        event.preventDefault()
        if (busy || !fields.title.trim()) return
        setBusy(true)
        const changes = {}
        for (const [key, value] of Object.entries(fields)) {
          if (!creating && value === base[key]) continue
          if (key === 'prs' || key === 'sources') changes[key] = lines(value)
          else if (key === 'gates') changes.gates = Object.fromEntries(GATES.filter(gate => creating || value[gate.id] !== base.gates[gate.id]).map(gate => [gate.id, value[gate.id]]))
          else changes[key] = value.trim()
        }
        if (!await onSubmit(changes)) setBusy(false)
      }
      const field = (key, label, maxLength, area = false, extra = {}) => h('label', null, label, h(area ? 'textarea' : 'input', {
        className: area ? 'dk-textarea' : 'dk-input', value: fields[key], maxLength, onChange: event => set(key, event.target.value), ...extra,
      }))
      return h('form', { className: 'dk-form', onSubmit: submit },
        field('title', t('heading'), 200, false, { required: true, ref: titleRef }),
        field('project', t('projectField'), 80, false, { list: draftId }),
        h('datalist', { id: draftId }, projects.filter(project => project.explicit).map(project => h('option', { key: project.key, value: project.explicit }))),
        projectHint && h('p', { className: 'dk-detail-text' }, projectHint),
        field('status', t('current'), 120), field('note', t('note'), 2000, true),
        field('issue', t('issue'), 40), field('issueUrl', `${t('issue')} URL`, 500),
        field('prs', t('prs'), undefined, true), field('sources', t('sources'), undefined, true),
        h('div', { className: 'dk-form-gates' }, GATES.map(gate => h('label', { key: gate.id }, gateText(t, gate),
          h('select', { className: 'dk-select', value: fields.gates[gate.id], onChange: event => set('gates', { ...fields.gates, [gate.id]: event.target.value }) },
            h('option', { value: 'human' }, t('human')), h('option', { value: 'auto' }, t('auto')))))),
        sessions.map(session => h('div', { className: 'dk-form-session', key: session.id },
          h('span', null, session.label), h('button', { type: 'button', className: 'dk-btn', onClick: () => onUnlink(session.id) }, t('detach')))),
        h('div', { className: 'dk-form-row' },
          h('button', { type: 'button', className: 'dk-btn', onClick: onCancel }, t('cancel')),
          h('button', { type: 'submit', className: 'dk-btn dk-btn-primary', disabled: busy || !fields.title.trim() }, t(creating ? 'add' : 'save'))))
    }

    function PrChip({ pr, t }) {
      const merged = pr.state === 'MERGED', closed = pr.state === 'CLOSED'
      const tone = merged ? 'success' : closed ? 'idle' : pr.checks === 'failing' ? 'error' : pr.checks === 'passing' ? 'success' : 'idle'
      const state = t(merged ? 'merged' : closed ? 'closed' : CHECK_LABELS[pr.checks] ? pr.checks : 'checking')
      return h('span', { className: 'dk-pr' },
        h('span', { className: `dk-dot dk-tone-${tone}`, 'aria-hidden': true }),
        h('a', { className: 'dk-link', href: pr.url, target: '_blank', rel: 'noreferrer', title: pr.url }, prLabel(pr)),
        h('span', { className: `dk-subtitle dk-tone-${tone}` }, state),
        pr.score !== undefined && h('span', {
          className: `dk-score dk-tone-${pr.score >= 4 ? 'success' : 'warn'}${pr.scoreStale ? ' dk-score-stale' : ''}`,
          title: pr.scoreStale ? t('staleHint') : 'Greptile Confidence Score',
        }, `G ${pr.score}/5${pr.scoreStale ? t('stale') : ''}`))
    }

    function cardPill(card, t) {
      if (card.column === 'pr' && card.prs.some(pr => pr.state !== 'MERGED' && pr.state !== 'CLOSED' && pr.checks === 'failing')) {
        return { tone: 'error', icon: 'fail', label: t('failing') }
      }
      if (card.attention) return { tone: 'warn', icon: 'alert', label: card.attention }
      if (card.running) return { tone: 'business', icon: 'clock', label: t('running') }
      return null
    }

    function Pill({ pill }) {
      return pill && h('span', { className: `dk-status-pill dk-tone-${pill.tone}`, title: pill.label },
        h(Glyph, { name: pill.icon, size: 13 }), h('span', null, pill.label))
    }

    function Card({ t, locale, card, now, project, showProject, sessions, dragging, dropBefore, menuOpen, onDragStart, onDragEnd, onDragOver, onDrop, onOpenSession, onDetail, onMenu, onStart }) {
      const session = sessions.findLast(item => item.available)
      const pill = cardPill(card, t)
      const canStart = card.column === 'todo' && card.sessions.length === 0
      const time = relativeTime(card.updatedAt, now, t, locale)
      const pr = card.prs[0]
      const context = showProject ? projectText(t, project) : card.issue || (pr ? prLabel(pr) : '')
      return h('article', {
        className: `dk-card${dragging ? ' dk-card-dragging' : ''}${dropBefore ? ' dk-card-drop' : ''}`,
        draggable: true, onDragStart, onDragEnd, onDragOver, onDrop, 'aria-label': card.title,
      },
      h('div', { className: 'dk-card-top' },
        h('span', { className: 'dk-muted', title: context || undefined }, context),
        h('button', { type: 'button', className: 'dk-icon-btn', title: t('more', { title: card.title }), 'aria-label': t('more', { title: card.title }), 'aria-expanded': menuOpen, onClick: onMenu }, h(Glyph, { name: 'more' }))),
      h('button', { type: 'button', className: 'dk-card-title', onClick: onDetail, title: card.title, 'data-dk-card-title': card.id }, h('span', null, card.title)),
      h('div', { className: 'dk-card-status' }, pill ? h(Pill, { pill }) : h('span', { className: 'dk-muted', title: card.status }, card.status || t(card.column === 'todo' ? 'backlog' : 'noStatus'))),
      h('div', { className: 'dk-card-foot' },
        h('span', { className: 'dk-muted', title: card.updatedAt }, showProject && pr ? `${prLabel(pr)} · ${time}` : time),
        canStart ? h('button', { type: 'button', className: 'dk-link', title: t('startHint'), onClick: onStart }, t('start'))
          : session && h('button', { type: 'button', className: 'dk-link', title: session.label, onClick: () => onOpenSession(session.id) }, h(Glyph, { name: 'chat', size: 13 }), t('session'))))
    }

    function StageSelect({ t, column = '', label, columns = COLUMNS, onChange, className = 'dk-select', ...props }) {
      return h('select', { className, value: column, 'aria-label': label, onChange: event => onChange(event.target.value), ...props },
        !column && h('option', { value: '', disabled: true }, label),
        columns.map(stage => h('option', { key: stage.id, value: stage.id }, stageText(t, stage.id))))
    }

    function MoveStage({ t, column, onMove }) {
      const [choice, setChoice] = useState(null)
      const [busy, setBusy] = useState(false)
      const target = choice?.from === column ? choice.to : column
      const submit = async event => {
        event.preventDefault()
        if (busy || target === column) return
        setBusy(true)
        try { await onMove(target) } finally { setBusy(false) }
      }
      return h('form', { className: 'dk-move-form', onSubmit: submit },
        h(StageSelect, { t, column: target, label: t('move'), disabled: busy, onChange: to => setChoice({ from: column, to }) }),
        h('button', { type: 'submit', className: 'dk-btn', disabled: busy || target === column }, t('moveConfirm')))
    }

    function Drawer({ t, title, onClose, children }) {
      const ref = useRef(null)
      useEffect(() => {
        const dialog = ref.current
        if (!dialog?.isConnected) return undefined
        dialog.showModal()
        return () => { if (dialog.open) dialog.close() }
      }, [])
      return h('dialog', { className: 'dk-drawer', ref, 'aria-label': title, onCancel: event => { event.preventDefault(); onClose() } },
        h('div', { className: 'dk-drawer-head' }, title,
          h('button', { type: 'button', className: 'dk-icon-btn', title: t('close'), 'aria-label': t('close'), onClick: onClose }, h(Glyph, { name: 'close' }))),
        h('div', { className: 'dk-drawer-body' }, children))
    }

    function CardDetails({ t, card, project, sessions, onOpenSession, onStart, onMove, onEdit, onRemove }) {
      const [confirm, setConfirm] = useState(false)
      const session = sessions.findLast(item => item.available)
      const pill = cardPill(card, t)
      const work = [
        ...sessions.map(item => h('button', { key: item.id, type: 'button', className: 'dk-link', disabled: !item.available, onClick: () => onOpenSession(item.id) }, `${t('session')} · ${item.label}`)),
        ...card.prs.map(pr => h(PrChip, { key: pr.url, t, pr })),
        card.issue && (card.issueUrl ? h('a', { key: 'issue', className: 'dk-link', href: card.issueUrl, target: '_blank', rel: 'noreferrer' }, card.issue) : h('span', { key: 'issue' }, card.issue)),
        ...card.sources.map(url => h('a', { key: url, className: 'dk-link', href: url, target: '_blank', rel: 'noreferrer', title: url }, t('source', { host: hostLabel(url) }))),
      ].filter(Boolean)
      const section = (key, content) => h('section', { className: 'dk-detail-section' }, h('h3', null, t(key)), content)
      return h(React.Fragment, null,
        h('span', { className: 'dk-subtitle', title: project?.directory }, `${projectText(t, project)} / ${stageText(t, card.column)}`),
        h('h2', null, card.title),
        h('div', { className: 'dk-controls' },
          session && h('button', { type: 'button', className: 'dk-btn dk-btn-primary', onClick: () => onOpenSession(session.id) }, h(Glyph, { name: 'chat' }), t('continueSession')),
          !session && card.column === 'todo' && card.sessions.length === 0 && h('button', { type: 'button', className: 'dk-btn dk-btn-primary', title: t('startHint'), onClick: onStart }, t('start')),
          h(MoveStage, { t, column: card.column, onMove }),
          h('button', { type: 'button', className: 'dk-btn', onClick: onEdit }, t('edit'))),
        section('current', h(React.Fragment, null, h(Pill, { pill }),
          card.attention && pill?.label !== card.attention && h('p', { className: 'dk-detail-text' }, card.attention),
          card.status && card.status !== card.attention && card.status !== pill?.label && h('p', { className: 'dk-detail-text' }, card.status),
          !pill && !card.status && h('p', { className: 'dk-detail-text' }, t('noStatus')))),
        work.length > 0 && section('linkedWork', h('div', { className: 'dk-work-links' }, work)),
        card.note && section('note', h('p', { className: 'dk-detail-text' }, card.note)),
        section('approval', h('ul', { className: 'dk-gate-list' }, GATES.map(gate => h('li', { key: gate.id }, `${gateText(t, gate)} · ${t(card.gates?.[gate.id] === 'auto' ? 'auto' : 'human')}`)))),
        h('section', { className: 'dk-detail-section' },
          confirm && h('p', { className: 'dk-detail-text' }, t('removeHint')),
          h('div', { className: 'dk-controls' },
            h('button', { type: 'button', className: 'dk-btn dk-btn-danger', onClick: () => { if (confirm) void onRemove(); else setConfirm(true) } }, t(confirm ? 'confirmRemove' : 'remove')),
            confirm && h('button', { type: 'button', className: 'dk-btn', onClick: () => setConfirm(false) }, t('cancel')))))
    }

    function notificationState() {
      return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    }

    function ProjectOverview({ t, projects, openProject, empty, returnFocus }) {
      return h('div', { className: 'dk-projects' },
        h('h2', null, t('projectOverview')),
        h('p', { className: 'dk-subtitle' }, t('projectHelp')),
        empty ? h('div', { className: 'dk-empty' }, t('empty')) : h('div', { className: 'dk-project-table', role: 'table', 'aria-label': t('projectOverview') },
          h('div', { className: 'dk-project-row dk-project-row-head', role: 'row' },
            ['projects', 'needYou', 'incomplete', 'breakdown'].map(key => h('span', { key, role: 'columnheader' }, t(key)))),
          projects.map(project => {
            const stages = COLUMNS.filter(column => column.id !== 'done' && project.columns[column.id] > 0)
            const name = project.label ?? t('noProject')
            const returning = returnFocus?.key === project.key
            const returnToCount = returning && returnFocus.priority && project.waiting > 0
            return h('div', { key: project.key, className: 'dk-project-row', role: 'row' },
              h('div', { className: 'dk-project-name', role: 'cell' },
                h(Glyph, { name: 'folder', size: 18 }),
                h('div', { style: { minWidth: 0 } },
                  h('button', { type: 'button', className: 'dk-link', ref: returning && !returnToCount ? returnFocus.ref : undefined, onClick: () => openProject(project, false) }, name),
                  project.directory && h('div', { className: 'dk-muted', title: project.directory }, `${t('inferred')}${project.disambiguate ? ` · ${project.disambiguate}` : ''}`))),
              h('div', { role: 'cell' }, project.waiting ? h('button', {
                type: 'button', className: 'dk-btn dk-project-wait', ref: returnToCount ? returnFocus.ref : undefined,
                'aria-label': t('projectNeed', { name: projectText(t, project), count: project.waiting }), onClick: () => openProject(project, true),
              }, h(Glyph, { name: 'alert', size: 13 }), project.waiting) : h('span', { className: 'dk-subtitle' }, '0')),
              h('div', { className: 'dk-project-count', role: 'cell' }, project.open),
              h('div', { className: 'dk-phase', role: 'cell' }, stages.length === 0 ? h('span', { className: 'dk-subtitle' }, t('noOpen')) :
                h(React.Fragment, null,
                  h('div', { className: 'dk-phase-bar', 'aria-hidden': true }, stages.map(stage => h('span', { key: stage.id, className: `dk-tone-${stage.tone}`, style: { flex: project.columns[stage.id] } }))),
                  h('div', { className: 'dk-phase-legend' }, stages.map(stage => h('span', { key: stage.id },
                    h('i', { className: `dk-dot dk-tone-${stage.tone}`, 'aria-hidden': true }), `${stageText(t, stage.id)} ${project.columns[stage.id]}`))))))
          })))
    }

    function BoardPage({ store, useSessionList, useTranslate, openSession, startSession }) {
      const board = useBoard(store)
      const sessionList = useSessionList()
      const { t, locale } = useTranslate()
      const now = useNow(30000)
      const [view, setView] = useState({ view: 'board', project: '', attention: false, history: false })
      const [detail, setDetail] = useState(null)
      const [menu, setMenu] = useState(null)
      const [drag, setDrag] = useState(null)
      const [drop, setDrop] = useState(null)
      const [showAllDone, setShowAllDone] = useState(false)
      const [notice, setNotice] = useState(null)
      const [permission, setPermission] = useState(notificationState)
      const [jump, setJump] = useState(null)
      const pageRef = useRef(null), columnsRef = useRef(null), menuRef = useRef(null), scopeRef = useRef(null), restoreRef = useRef(null)
      const fromProject = useRef(null), drawerOrigin = useRef(null), newCardButton = useRef(null)
      const draftId = React.useId()
      const setScope = changes => setView(previous => ({ ...previous, ...changes }))
      const newCard = (column, origin) => {
        drawerOrigin.current = origin ?? newCardButton.current
        setMenu(null); setNotice(null); setDetail({ mode: 'new', column })
      }
      const openDetail = (id, mode = 'view', origin) => {
        if (origin) drawerOrigin.current = origin
        setMenu(null); setNotice(null); setDetail({ id, mode })
      }
      const closeDetail = () => { setDetail(null); setNotice(null) }
      const open = id => { drawerOrigin.current = null; setDetail(null); openSession(id) }
      const sessions = useMemo(() => new Map((sessionList?.ids ?? []).map(id => [id, sessionList.byId?.[id]])), [sessionList])
      const { groups, byCard } = useMemo(() => groupProjects(board.cards, sessions), [board.cards, sessions])
      const projects = [...groups.values()].sort((a, b) => b.waiting - a.waiting || Number(a.key === 'none') - Number(b.key === 'none') ||
        b.open - a.open || projectText(t, a).localeCompare(projectText(t, b), locale))
      const project = view.project ? groups.get(view.project) ?? view.selected : undefined
      const scoped = view.project ? groups.get(view.project)?.cards ?? [] : board.cards
      const counts = view.project && groups.has(view.project) ? groups.get(view.project) : countCards(scoped)
      const visible = view.attention ? scoped.filter(card => card.attention) : scoped
      const cardsByColumn = Object.fromEntries(COLUMNS.map(column => [column.id, []]))
      for (const card of visible) cardsByColumn[card.column].push(card)
      const historyOpen = view.attention ? cardsByColumn.done.length > 0 : view.history
      const displayColumns = COLUMNS.filter(column => view.attention ? cardsByColumn[column.id].length > 0 : column.id !== 'done' || historyOpen)
      const mayReorder = !view.project && !view.attention
      const shown = detail?.id ? board.cards.find(card => card.id === detail.id) : undefined
      const menuCard = menu && board.cards.find(card => card.id === menu.id)

      useEffect(() => {
        if (!jump) return
        const scroller = columnsRef.current
        const lane = scroller?.querySelector(`[data-dk-column="${jump.column}"]`)
        if (lane) {
          scroller.scrollTo({ left: Math.max(0, lane.offsetLeft - 12), behavior: 'instant' })
          if (jump.focus) lane.focus({ preventScroll: true })
        } else if (jump.focus) scopeRef.current?.focus()
        setJump(null)
      }, [jump])
      useEffect(() => {
        const origin = drawerOrigin.current
        if (detail || !origin) return
        drawerOrigin.current = null
        const target = origin.isConnected ? origin : scopeRef.current ?? newCardButton.current
        target?.focus({ preventScroll: true })
      }, [detail])
      useEffect(() => {
        if (view.view === 'projects') restoreRef.current?.focus()
      }, [view.view])
      useEffect(() => {
        if (!menu) return undefined
        const close = () => setMenu(null)
        const click = event => { if (!menuRef.current?.contains(event.target) && !menu.anchor?.contains(event.target)) close() }
        const key = event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          close()
          menu.anchor?.focus()
        }
        menuRef.current?.querySelector('button')?.focus()
        document.addEventListener('pointerdown', click)
        document.addEventListener('keydown', key)
        window.addEventListener('resize', close)
        return () => {
          document.removeEventListener('pointerdown', click)
          document.removeEventListener('keydown', key)
          window.removeEventListener('resize', close)
        }
      }, [menu])

      const sessionInfo = id => {
        const summary = sessions.get(id)
        return { id, available: Boolean(summary), label: summary ? summary.title || t('untitledSession') : t('unavailableSession') }
      }
      const run = async (op, args, feedback) => {
        try {
          const value = await store.mutate(op, args)
          setNotice(feedback ? { text: feedback(value) } : null)
          return value ?? true
        } catch (error) {
          setNotice({ text: error instanceof Error ? error.message : String(error), failed: true })
          return undefined
        }
      }
      const moveTo = async (card, column, beforeId) => {
        if (!COLUMN_BY_ID[column] || (column === card.column && beforeId === undefined)) return
        const stillVisible = () => !view.attention || Boolean(store.getSnapshot().cards.find(item => item.id === card.id)?.attention)
        const ok = await run('update', { id: card.id, column, ...(beforeId !== undefined && { beforeId }) },
          () => t(stillVisible() ? 'moved' : 'movedHidden', { stage: stageText(t, column) }))
        if (!ok) return
        if (column === 'done' && !view.attention) setScope({ history: true })
        if (column !== card.column) setJump({ column, focus: Boolean(menu) && !detail })
        setMenu(null)
      }
      const start = card => {
        const prompt = [card.title, card.note, ...card.sources,
          `（看板卡片 ${card.id}：开始前先用 kanban 工具的 link 把这张卡关联到当前会话。）`,
        ].filter(Boolean).join('\n\n')
        drawerOrigin.current = null
        setDetail(null)
        startSession(prompt)
      }
      const openProject = (next, attention) => {
        fromProject.current = { key: next.key, priority: attention }
        setView({ view: 'board', project: next.key, selected: { key: next.key, label: next.label, explicit: next.explicit, directory: next.directory, disambiguate: next.disambiguate }, attention, history: false })
        setMenu(null)
        setShowAllDone(false)
        setNotice(null)
        setJump({ column: COLUMNS.find(column => column.id !== 'done' && (!attention || next.cards.some(card => card.column === column.id && card.attention)))?.id ?? 'done', focus: true })
      }
      const pickProject = event => {
        const key = event.target.value
        const next = groups.get(key)
        fromProject.current = null
        setScope({ project: key, selected: next && { key, label: next.label, explicit: next.explicit, directory: next.directory, disambiguate: next.disambiguate }, history: false })
        setMenu(null)
        setShowAllDone(false)
        setJump({ column: 'todo' })
      }
      const showHistory = () => {
        if (view.attention && historyOpen) { setJump({ column: 'done', focus: true }); return }
        const next = view.attention || !historyOpen
        setScope({ attention: false, history: next })
        if (next) setJump({ column: 'done', focus: true })
      }
      const jumpTo = column => {
        if (column === 'done' && !view.attention) setScope({ history: true })
        setJump({ column, focus: true })
      }
      const toggleAttention = () => {
        const column = view.attention ? 'todo' : COLUMNS.find(stage => scoped.some(card => card.attention && card.column === stage.id))?.id
        setScope({ attention: !view.attention })
        if (column) setJump({ column })
      }
      const showMenu = (event, card) => {
        if (menu?.id === card.id) { setMenu(null); return }
        const anchor = event.currentTarget
        const button = anchor?.getBoundingClientRect(), panel = pageRef.current?.getBoundingClientRect()
        const above = button && panel && panel.bottom - button.bottom < 182
        const left = button && panel ? Math.max(6, Math.min(panel.width - 186, button.right - panel.left - 176)) : 0
        const top = button && panel ? (above ? button.top - panel.top - 4 : button.bottom - panel.top + 4) : 0
        setMenu({ id: card.id, anchor, above, left, top })
      }
      const dropTargetFor = (event, column, card) => {
        if (drag === null) return
        const sorting = mayReorder && column !== 'done'
        if (card) event.stopPropagation()
        if (!sorting && drag.column === column) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        let beforeId = null
        if (card && sorting) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientY < rect.top + rect.height / 2) beforeId = card.id
          else {
            const cards = cardsByColumn[column]
            beforeId = cards[cards.findIndex(other => other.id === card.id) + 1]?.id ?? null
          }
          if (beforeId === drag.id) { setDrop(null); return }
        }
        if (!drop || drop.column !== column || drop.beforeId !== beforeId) setDrop({ column, beforeId })
      }
      const finishDrop = (event, column) => {
        event.preventDefault()
        event.stopPropagation()
        const card = board.cards.find(other => other.id === drag?.id)
        const target = drop?.column === column ? drop : null
        setDrag(null); setDrop(null)
        if (card && target) void moveTo(card, column, mayReorder && column !== 'done' ? target.beforeId : undefined)
      }
      const renderColumn = column => {
        const list = cardsByColumn[column.id]
        const sorted = column.id === 'done' ? list.toSorted((a, b) => (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt)) : list
        const cards = column.id === 'done' && !showAllDone && !view.attention ? sorted.slice(0, DONE_VISIBLE) : sorted
        const label = stageText(t, column.id)
        const over = drop?.column === column.id
        return h('section', {
          key: column.id, tabIndex: -1, 'data-dk-column': column.id, 'aria-label': label, className: `dk-column${over ? ' dk-column-over' : ''}`,
          onDragOver: event => dropTargetFor(event, column.id), onDrop: event => finishDrop(event, column.id),
          onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget) && over) setDrop(null) },
        },
        h('div', { className: 'dk-column-head' },
          h('div', { className: 'dk-column-name' }, h('i', { className: `dk-dot dk-tone-${column.tone}`, 'aria-hidden': true }), label, h('span', { className: 'dk-count' }, list.length)),
          h('button', { type: 'button', className: 'dk-icon-btn', 'aria-label': t('addAt', { stage: label }), title: t('addAt', { stage: label }), onClick: event => newCard(column.id, event?.currentTarget) }, h(Glyph, { name: 'plus', size: 15 }))),
        h('div', { className: 'dk-column-body' },
          cards.map(card => h(Card, {
            key: card.id, t, locale, card, now, project: byCard.get(card.id), showProject: !view.project, sessions: card.sessions.map(sessionInfo),
            dragging: drag?.id === card.id, dropBefore: over && drop.beforeId === card.id, menuOpen: menu?.id === card.id,
            onDragStart: event => {
              setMenu(null)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', card.id)
              setDrag({ id: card.id, column: card.column })
            },
            onDragEnd: () => { setDrag(null); setDrop(null) }, onDragOver: event => dropTargetFor(event, column.id, card),
            onDrop: event => finishDrop(event, column.id), onOpenSession: open, onDetail: event => openDetail(card.id, 'view', event?.currentTarget),
            onMenu: event => showMenu(event, card), onStart: () => start(card),
          })),
          over && drop.beforeId === null && mayReorder && column.id !== 'done' && h('div', { className: 'dk-drop-end' }),
          list.length === 0 && h('div', { className: 'dk-empty' }, t('empty')),
          column.id === 'done' && list.length > DONE_VISIBLE && !view.attention && h('button', {
            type: 'button', className: 'dk-btn dk-more', onClick: () => setShowAllDone(value => !value),
          }, showAllDone ? t('showRecent') : t('showAll', { count: list.length }))))
      }
      const message = (notice || board.error) && h('div', { className: `dk-notice${notice?.failed || !notice ? ' dk-problem' : ''}`, role: 'status' }, notice?.text || board.error)
      const creating = detail?.mode === 'new'
      const editing = detail?.mode === 'edit'
      const newProject = view.view === 'board' ? project : undefined
      const drawer = detail && h(Drawer, { t, title: t(creating ? 'newCard' : editing ? 'editCard' : 'details'), onClose: closeDetail },
        notice && h('div', { className: `dk-drawer-notice${notice.failed ? ' dk-problem' : ''}`, role: 'status' }, notice.text),
        creating || (editing && shown) ? h(React.Fragment, null,
          h('h2', null, creating ? stageText(t, detail.column) : shown.title),
          h(CardForm, {
            key: creating ? `new:${detail.column}` : shown.id, t, creating, projects, draftId,
            initial: creating ? { project: newProject?.explicit } : shown, sessions: creating ? [] : shown.sessions.map(sessionInfo),
            projectHint: creating && newProject?.directory && t('inferredHelp'),
            onCancel: () => { setNotice(null); setDetail(creating ? null : { mode: 'view', id: shown.id }) },
            onUnlink: sessionId => run('unlink', { id: shown.id, sessionId }),
            onSubmit: async fields => {
              if (!creating && Object.keys(fields).length === 0) { openDetail(shown.id); return true }
              const ok = await run(creating ? 'add' : 'update', creating ? { ...fields, column: detail.column } : { ...fields, id: shown.id },
                creating ? () => t('added', { project: fields.project || t('noProject'), stage: stageText(t, detail.column) }) : undefined)
              if (!ok) return false
              if (creating) {
                const addedProject = fields.project ? { key: `name:${fields.project.toLowerCase()}`, label: fields.project, explicit: fields.project } : { key: 'none' }
                setScope({ view: 'board', ...((view.project || view.view === 'projects') && { project: addedProject.key, selected: addedProject }), attention: false, history: detail.column === 'done' || view.history })
                drawerOrigin.current = null
                setJump({ column: detail.column, focus: true })
                setDetail(null)
              } else setDetail({ mode: 'view', id: shown.id })
              return true
            },
          })) : shown ? h(CardDetails, { key: shown.id, t, card: shown, project: byCard.get(shown.id), sessions: shown.sessions.map(sessionInfo),
          onOpenSession: open, onStart: () => start(shown), onMove: column => moveTo(shown, column), onEdit: () => openDetail(shown.id, 'edit'),
          onRemove: async () => { if (await run('remove', { id: shown.id })) setDetail(null) },
        }) : h('p', null, t('missing')))

      return h('div', { className: 'dk-page', ref: pageRef },
        h('header', { className: 'dk-header' },
          h('div', { className: 'dk-mast' },
            h('div', { className: 'dk-brand' }, h('span', { className: 'dk-mark' }, h(Glyph, { name: 'wish', size: 23 })),
              h('div', null, h('div', { className: 'dk-subtitle' }, t('subtitle')), h('h1', { className: 'dk-title' }, t('title')))),
            h('div', { className: 'dk-controls' },
              permission === 'default' && h('button', { type: 'button', className: 'dk-btn', onClick: async () => setPermission(await Notification.requestPermission()) }, t('notify')),
              permission === 'denied' && h('span', { className: 'dk-subtitle' }, t('notifyDenied')),
              h('button', { type: 'button', className: 'dk-btn dk-btn-primary', disabled: board.status !== 'ready', ref: newCardButton, onClick: event => newCard('todo', event?.currentTarget) }, h(Glyph, { name: 'plus', size: 15 }), t('newCard')))),
          h('nav', { className: 'dk-tabs', 'aria-label': t('views') }, ['board', 'projects'].map(tab => h('button', {
            key: tab, type: 'button', className: 'dk-tab', 'aria-current': view.view === tab ? 'page' : undefined,
            onClick: () => { setNotice(null); setMenu(null); setScope({ view: tab }) },
          }, h(Glyph, { name: tab === 'board' ? 'board' : 'folder', size: 15 }), t(tab))))),
        h('div', { className: 'dk-body' },
          !detail && message,
          board.status === 'loading' ? h('div', { className: 'dk-board-empty', role: 'status' }, t('loading')) : board.status === 'error' ? null :
            view.view === 'projects' ? h(ProjectOverview, { t, projects, openProject, empty: projects.length === 0, returnFocus: fromProject.current && { ...fromProject.current, ref: restoreRef } }) :
              h(React.Fragment, null,
                h('div', { className: 'dk-toolbar' },
                  h('div', { className: 'dk-controls' },
                    fromProject.current && h('button', { type: 'button', className: 'dk-link', onClick: () => setScope({ view: 'projects' }) }, `‹ ${t('projectOverview')}`),
                    h('div', { className: 'dk-control-wrap' }, h(Glyph, { name: 'folder', size: 15 }),
                      h('select', { className: 'dk-select', value: view.project, 'aria-label': t('projectPicker'), ref: scopeRef, onChange: pickProject },
                        h('option', { value: '' }, t('all')),
                        project && !groups.has(view.project) && h('option', { value: view.project }, projectText(t, project)),
                        projects.map(item => h('option', { key: item.key, value: item.key }, projectText(t, item))))),
                    h('span', { className: 'dk-subtitle' }, t('incompleteCount', { count: counts.open })),
                    h('button', { type: 'button', className: `dk-btn${view.attention ? ' dk-btn-on' : ''}`, 'aria-pressed': view.attention, onClick: toggleAttention },
                      h(Glyph, { name: 'alert', size: 14 }), t('needCount', { count: counts.waiting }))),
                  h('div', { className: 'dk-controls' },
                    h('div', { className: 'dk-control-wrap' }, h(Glyph, { name: 'jump', size: 15 }),
                      h(StageSelect, { t, label: t('jump'), columns: view.attention ? displayColumns : COLUMNS, disabled: displayColumns.length === 0, onChange: jumpTo })),
                    h('button', { type: 'button', className: 'dk-btn', 'aria-pressed': historyOpen, onClick: showHistory },
                      h(Glyph, { name: 'history', size: 15 }), `${stageText(t, 'done')} ${counts.columns.done} ${historyOpen ? '▾' : '▸'}`))),
                board.cards.length === 0 && h('p', { className: 'dk-board-empty' }, t('onboarding')),
                view.attention && visible.length === 0 ? h('div', { className: 'dk-board-empty' }, h('div', null, t('noAttention')),
                  h('button', { type: 'button', className: 'dk-btn', onClick: toggleAttention }, t('clear')))
                  : h('div', { className: 'dk-columns', ref: columnsRef, onScrollCapture: () => { if (menu) setMenu(null) } }, displayColumns.map(renderColumn)))),
        menuCard && h('div', { className: 'dk-card-menu', ref: menuRef, style: { insetInlineStart: menu.left, top: menu.top, transform: menu.above ? 'translateY(-100%)' : undefined } },
          h('button', { type: 'button', className: 'dk-btn', onClick: () => openDetail(menuCard.id, 'view', menu.anchor) }, t('detail')),
          h('button', { type: 'button', className: 'dk-btn', onClick: () => openDetail(menuCard.id, 'edit', menu.anchor) }, t('edit')),
          h(MoveStage, { t, column: menuCard.column, onMove: column => moveTo(menuCard, column) })),
        drawer)
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
      inject: ['slots', 'uiWorkspace', 'sessions', 'contextMenus', 'locale'],
      apply(ctx) {
        const store = createBoardStore()
        const disposeLocale = ctx.locale.register(LOCALE_NS, boardDictionaries)
        const t = ctx.locale.bind(LOCALE_NS)
        const subscribeLocale = listener => ctx.locale.subscribe(listener)
        const readLocale = () => ctx.locale.getSnapshot()
        const useTranslate = () => ({ t, locale: useSyncExternalStore(subscribeLocale, readLocale).active })
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
          disposeLocale()
        }, 'kanban: board store, notifications, stylesheet, and locale')

        const sessionList = ctx.sessions.list
        const subscribeSessions = listener => sessionList.subscribe(listener)
        const readSessions = () => sessionList.getSnapshot()
        const useSessionList = () => useSyncExternalStore(subscribeSessions, readSessions)
        const page = {
          store,
          useSessionList,
          useTranslate,
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
