# 许愿池 · Wishing Well

DeepSeek Harness（DSH）的跨会话看板插件。每个会话对应一张卡片，卡片随开发、PR、CI、Greptile 评审和合并状态自动推进；需要你处理的卡片会高亮并发系统通知。agent 通过 `kanban` 工具汇报进度。

## 阶段

| 列 id | 名称 | 含义 |
|---|---|---|
| `todo` | 许愿池 | 还没开工的想法 |
| `plan` | 方案 | 会话已开始，方案讨论中 |
| `dev` | 开发中 | 已开始改文件 |
| `verify` | 待验收 | 等你本地验证 |
| `pr` | PR·CI | PR 已创建，跟踪 CI 与 review |
| `staging` | Staging | PR 已合并，等 staging 部署与测试 |
| `release` | 待上线 | staging 通过，等你安排上线 |
| `done` | 已上线 | 完成 |

## 功能

- **看板页**：左侧导航里的整页看板，支持拖动、编辑、删除卡片；导航图标上显示等你处理的数量。
- **会话行标签**：会话列表每一行显示所在阶段，悬停可看当前状态。
- **会话右键菜单**：把会话加入许愿池、移动到其他阶段，或移出许愿池。
- **系统通知**：卡片开始需要你处理时（待验收、CI 失败、Greptile ≤3 分、可以合并、agent 等你回复、Staging 超过 6 小时无进展等）弹浏览器通知，点击通知打开对应会话。
- **审批门禁**：每张卡有三道门禁——方案 review（`plan`）、本地验收（`local`）、合并前检查（`merge`），可分别设为 `human`（人工）或 `auto`（交给 agent）。门禁只记录你的指示，不额外授予任何权限。

## 自动推进规则

由 Host 侧监听会话事件完成（子 agent 会话不参与）：

1. 会话收到第一条人工消息 → 在 `plan` 新建卡片，标题跟随会话标题。
2. 首次用文件编辑工具（`Edit`、`Write` 等）改文件 → `plan` → `dev`。通过 shell 命令改文件不会被识别。
3. 改过文件的回合结束，且本地验收门禁为 `human`、没有未关闭的 PR → `dev` → `verify`；下一回合开始时回到 `dev`。
4. 工具输出里出现 `gh pr create` 创建的 PR 链接 → 挂到卡片上并进入 `pr`。
5. 通过 Linear `save_issue` 新建的 issue → 写入卡片的 issue 字段，并从 `plan` 进入 `dev`。
6. 所有 PR 都已合并或关闭且至少一个合并 → 进入 `staging`；若合并到 `main`/`master` 则直接进入 `done`。
7. 新回合开始时清除上一回合留下的“等你回复”标记。

### GitHub 轮询

用本机已登录的 `gh` 读取 PR 状态、CI（`statusCheckRollup`）以及 Greptile summary 评论中的 `Confidence Score` 和 `Last reviewed commit`。Windows 上通过 `wsl.exe -d <发行版>` 在 WSL 里运行 `gh`。每分钟检查一次，CI 进行中的 PR 每 2 分钟、其余每 5 分钟查询一次，每次最多 20 个 PR。Greptile 评分对应的不是当前 head 时标记为过期。

## `kanban` 工具

agent 可调用的工具，`action` 取值：

- `list`：列出卡片，可按 `column`、`project`、`session` 过滤；默认不含 `done`，需加 `include_done`。
- `add`：新建卡片（默认进 `todo`，并关联当前会话）。
- `update`：更新卡片，不传 `id` 时更新当前会话的卡片。可设置 `column`、`status`、`waiting`、`project`、`issue`、`pr`、`source`、`note` 以及三道门禁。
- `remove`：删除卡片，并停止对其关联会话的自动跟踪。
- `link`：把当前会话关联到已有卡片（同一需求换会话继续时用）。

完整参数说明见 [index.js](index.js) 里的 `TOOL_DESCRIPTION` 和 `TOOL_PARAMETERS`。

## 安装

插件以本地包的形式放进 DSH profile。以 profile `desktop` 为例，在 `~/.dsh/profiles/desktop/package.json` 中加入：

```json
{
  "dependencies": {
    "@local/dsh-wishing-well": "link:/path/to/dsh-wishing-well"
  },
  "dsh": {
    "profile": {
      "bundles": ["@local/dsh-wishing-well"]
    }
  }
}
```

`bundles` 是追加到已有列表，不是替换。随后在 profile 目录执行 `pnpm install` 并重启 DSH。bundle 通过 [cordis.patch.yml](cordis.patch.yml) 挂载 Host 插件 `kanban`。

要求 DSH 版本 `>=0.2.2-rc.5 <0.3.0`（见 [package.json](package.json) 的 `engines.dsh`）。

### 配置

Host 插件 `kanban` 接受两项可选配置：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `file` | `~/.dsh/kanban/board.json` | 看板数据文件 |
| `wslDistro` | `Ubuntu-22.04` | Windows 上运行 `gh` 的 WSL 发行版 |

## 数据

整个看板存成一个 JSON 文件，由 Host 进程独占写入，每次修改先写临时文件再原子替换。浏览器通过仅限所有者访问的路由 `/api/kanban/board`（`GET` 读取，`POST` 执行操作）读写，每 4 秒轮询一次。

## 文件结构

| 文件 | 作用 |
|---|---|
| [index.js](index.js) | Host 侧入口：看板路由、`kanban` 工具、会话事件自动跟踪 |
| [board.js](board.js) | 看板模型、持久化、共享操作、“需要你处理”的判定 |
| [github.js](github.js) | 通过 `gh` 轮询 PR、CI、Greptile 状态并推进卡片 |
| [client.js](client.js) | Web 端：看板页、会话行标签、右键菜单、通知 |
| [locale/](locale) | 插件名称与描述（中 / 英） |

## 测试

```sh
pnpm test
```

依次运行 Host 侧测试 `test/host.test.mjs` 和 Web 端测试 `test/client.test.cjs`。

其他脚本：

- `node test/gh-live.mjs <pr-url> [...]`：用真实 `gh` 只读查询指定 PR，核对解析结果。
- `test/menu-icons-preview.cjs`、`test/nav-count-preview.cjs`、`test/row-layout.cjs`：生成 HTML 预览页，配合无头浏览器截图或测量布局，用法见各文件开头注释。
