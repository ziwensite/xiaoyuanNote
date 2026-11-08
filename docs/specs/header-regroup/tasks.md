# 顶部 header 重构 — 任务清单（待拍板，尚未开始）

前置：`docs/specs/header-regroup/spec.md` 的 §6 决策点 D1–D6 全部确认后才进入实施。
当前状态：**只读分析完成，源码与语言文件均未改动。**

## 批次 A — V1.1 热修（与方案选择无关，建议立即做）

| ID | 任务 | 文件 | 变更要点 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A1 | macOS 交通灯 inset 无条件生效 | `app/src/components/Toolbar.vue` | `.toolbar--mac.toolbar--lead{padding-left:80px}` 改为 mac 下无条件 `padding-left`；仅改 CSS，不动 DOM | D4 | 待批 |
| A2 | 抽出 inset 常量 | `app/src/lib/chrome.ts` | 新增 `export const MAC_TRAFFIC_INSET = 80`；`Toolbar.vue` 用该常量（`v-bind` 或内联 style） | A1 | 待批 |
| A3 | 修正陈旧注释 | `app/src/App.vue` L2151-2155、`app/src/lib/chrome.ts` L7-9 | 描述改为“V1 后左栏在 header 下方，mac 交通灯始终压 header 左端” | — | 待批 |
| A4 | 校验 | — | `pnpm test`、`pnpm build`；真机 macOS 截图：交通灯右侧与第一个控件间距 ≥ 8px | A1-A3 | 待批 |

## 批次 B — 方案二（三段视觉分区，不动 Teleport）

| ID | 任务 | 文件 | 变更要点 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | header 根节点改为三段 grid | `Toolbar.vue`（模板 L870-L1045） | 外层 `display:grid` + `grid-template-columns: auto minmax(0,1fr) auto`；左/中/右三个 wrapper | D1=B、B 批准 | 待批 |
| B2 | 左段：侧栏开关 + 当前左栏活动面板标题 | `Toolbar.vue`、`SidebarDock` 状态读取 | 复用 `sidebarDock.active.left` + `rsPane.*` 文案；折叠态不占宽（中段吃掉） | B1、D6 | 待批 |
| B3 | 中段：`#header-tabs` + 4 模式 | `Toolbar.vue` | 仅容器位置变化，`PaneHost` Teleport 目标 `#header-tabs` 保持不变 | B1 | 待批 |
| B4 | 右段：搜索 + 导出 + 右栏开关 + More | `Toolbar.vue` | 搜索按钮保留（D3=A）；位置移到右段首位 | B1、D3 | 待批 |
| B5 | 视觉区分 | `Toolbar.vue` CSS | 段间 1px 竖 hairline；侧栏标题 12px/500 非胶囊；编辑器标签沿用胶囊 | B1 | 待批 |
| B6 | 中段挤压规则 | `Toolbar.vue` | 中段 < 470px 时把 seg 移入 More（复用 L1058-L1067 / L1110 现成模板）；标签保持横向滚动 | D5 | 待批 |
| B7 | 三段 aria | `Toolbar.vue` | 三个独立容器 + `header.leftPanels/editorArea/rightPanels` | B1 | 待批 |
| B8 | i18n | `app/src/i18n/*.ts`（15 个语言） | 新增 §8 的 3–4 个 key，全语言补齐；不改既有文案 | B7 | 待批 |
| B9 | 校验 | — | `pnpm test`、`pnpm build`；手工矩阵（Windows/mac/iPad/390px、单面板/分屏、1/3/8 标签、toolbarHidden） | B1-B8 | 待批 |

## 批次 C — 方案三（仅当 D1=A 且取消/合并 V3）

| ID | 任务 | 说明 | 状态 |
| --- | --- | --- | --- |
| C0 | 先更新路线图 | 明确 V3 是否取消、`#header-tabs` 是否保留 | 待批 |
| C1 | `SidebarDock` 增加 header placement | `dock-tabs` 拆成可 Teleport 的组件，`showTabs`（≥2）语义在 header 侧重定义 | 待批 |
| C2 | 三段宽度订阅 `sidebarDock.width` | 与 `min(w,45vw)` 对齐，处理 1px 舍入 | 待批 |
| C3 | 降级矩阵 | 折叠态 / 平板抽屉 / 手机 / 分屏 四种 | 待批 |
| C4 | 三段 tablist 无障碍 | 三个独立 `role="tablist"` + aria-label | 待批 |

## 不做的事（本轮）

- 不改 Rust / `tauri.conf.json`。
- 不引入新依赖。
- 不改版本号、不 push。
- 不在本轮退役 `#header-tabs`（那是 V3）。
