# S1 规格：SidebarDock 零行为重构

任务：把 `App.vue` 中两段几乎重复的侧栏 pane 渲染模板收敛为
`SidebarDock` + `SidebarPaneBody` + 一张 pane 注册表。**行为必须与现状逐项一致**，
不引入标签模型、不做拖拽新特性、不写迁移标记。

---

## 1. 已确认决策

### D4（标题去重）— 本阶段不落地，顺延至 S2

D4 要求「去掉面板自带的重复标题，标题统一由标签头承担」。S1 明确不引入标签模型，
因此没有「标签头」来承载标题。若在 S1 删除 `PanelHeader` 的标题，面板会变成无标题裸面板，
属于**可见行为变化**，与「行为完全一致」直接冲突。

结论：S1 保持 `PanelHeader.vue` 与全部 9 处 `<PanelHeader>` 用法原样，
D4 的可见变更（删标题、保留右上角操作按钮）随 S2 的标签头一起落地。
本条需用户批准，否则 S1 无法在全零变更约束下完成。

### D6（新安装预设）— 仅在注册表中预留

注册表记录每个 pane 的默认侧与默认可见/激活状态，满足预设描述：

- 左侧：`file-tree`（既有，非 pane）、`outline`
- 右侧：`calendar`（默认可见 + 默认激活，`pending: true`）、`agent`

`calendar` 标 `pending`：不进入 `IMPLEMENTED_SIDEBAR_PANE_IDS`，不参与
`visibleRsPanes`，不创建组件、不改 `settings.rsPaneOrder` 默认值、不出现任何入口。
日历面板本体不在本阶段。

---

## 2. 现状基线（重构前，已实测）

| 检查 | 基线结果 |
| --- | --- |
| `pnpm test` | tests 585 / pass 585 / fail 0 |
| `pnpm build`（`vue-tsc --noEmit && vite build`） | 0 类型错误，构建成功 |
| `cargo test` | 本轮不跑（不改 Rust） |

`pnpm` 需在 PowerShell 中先注入 PATH：

```powershell
$env:Path = 'C:\Program Files\nodejs;C:\Users\yl.song\AppData\Roaming\npm;C:\Program Files\Git\bin;' + $env:Path
```

---

## 3. 两段模板差异清单（按原样保留，不统一）

左（`App.vue` L2375–2433）与右（L2442–2500）逐行比对后，**仅以下 4 处不同**：

| # | 位置 | 左侧 | 右侧 |
| --- | --- | --- | --- |
| 1 | `v-if` | `showRightSidebar && settings.outlineSide === 'left'` | `showRightSidebar && settings.outlineSide !== 'left'` |
| 2 | 根元素 class | `side-sidebar--left` | `side-sidebar--right` |
| 3 | resize 把手 class | `side-sidebar__resize--right` | `side-sidebar__resize--left` |
| 4 | resize 参数 | `onSidebarResize('left', $event)` | `onSidebarResize('right', $event)` |

其余全部**逐字相同**：`@contextmenu.prevent="openSidebarCtx"`、
`<template v-for="(p, idx) in visibleRsPanes">`、`<RsSplitter v-if="idx > 0">` 的
`:above/:below`、`.rs-pane-host` 的 `data-rs-pane` 与动态 class 顺序、
`:style="paneStyle(p.id)"`、`.rs-pane-grip` 的 `:title` 与 `@pointerdown`、
11 个面板分支及其 props/emits、`sideSidebarStyle` 绑定。

另有一处**非模板差异但必须保留**：两个 `<aside>` 的 DOM 位置不同 —— 左侧在
`.content` 之前、右侧在 `.content` 之后（决定 flex 排列顺序）。收敛后的组件必须在
**同样的两个位置各挂一次**（两个条件实例），不能合并成单个实例。

无宽度、滚动、动画类名方面的差异。

---

## 4. 变更清单（文件级 + 函数级）

### 4.1 新增 `app/src/panes/sidebar-panes.ts`

纯元数据，不 import 任何 Vue 组件（避免循环依赖），不改运行时状态。

```ts
export type SidebarPaneId =
  | 'search' | 'outline' | 'backlinks' | 'relationships' | 'tags' | 'tasks'
  | 'neighborhood' | 'types' | 'history' | 'inspector' | 'agent' | 'calendar';

export type ImplementedSidebarPaneId = Exclude<SidebarPaneId, 'calendar'>;

export type SidebarPaneVisibility = 'setting' | 'tab' | 'session';

export interface SidebarPaneDef {
  id: SidebarPaneId;
  /** S1 只读元数据：面板当前可见性的来源。 */
  visibility: SidebarPaneVisibility;
  defaultSide: 'left' | 'right';
  defaultVisible: boolean;
  /** D6：新安装时默认激活的 pane。 */
  defaultActive?: boolean;
  /** 未实现（无组件、无入口）；不进入 IMPLEMENTED_SIDEBAR_PANE_IDS。 */
  pending?: boolean;
}

export const SIDEBAR_PANE_DEFS: readonly SidebarPaneDef[] = [...];
export const IMPLEMENTED_SIDEBAR_PANE_IDS: readonly ImplementedSidebarPaneId[] =
  SIDEBAR_PANE_DEFS.filter((d) => !d.pending).map((d) => d.id as ImplementedSidebarPaneId);
```

`SIDEBAR_PANE_DEFS` 的数组顺序**必须严格等于** `App.vue` 现有 `known` 字面数组
（L2122）的顺序，因为 `visibleRsPanes` 用它兜底排序：

1. `search` — `visibility: 'session'`, `defaultSide: 'right'`, `defaultVisible: false`
2. `outline` — `'tab'`, `'left'`, `true`
3. `backlinks` — `'setting'`, `'right'`, `true`
4. `relationships` — `'setting'`, `'right'`, `false`
5. `tags` — `'setting'`, `'right'`, `true`
6. `tasks` — `'setting'`, `'right'`, `false`
7. `neighborhood` — `'setting'`, `'right'`, `false`
8. `types` — `'setting'`, `'right'`, `false`
9. `history` — `'setting'`, `'right'`, `true`
10. `inspector` — `'setting'`, `'right'`, `false`
11. `agent` — `'setting'`, `'right'`, `true`
12. `calendar` — `pending: true`, `'setting'`, `'right'`, `true`, `defaultActive: true`

`titleKey` / `icon` **本阶段不写入注册表**：S1 不渲染活动栏与标签头，写入会需要新 i18n
文案（本阶段禁止），字段随 S2 一并补充。

### 4.2 新增 `app/src/components/sidebar/SidebarPaneBody.vue`

唯一职责：`id → 组件` 单点映射。

- props：`id: ImplementedSidebarPaneId`、`searchPrefill: string`、`outlineLine: number`
- emits：`close: []`、`filterTag: [tag: string]`、`outlineGoto: [line: number]`、
  `openSettings: [section?: string]`
- 从 `App.vue` 迁入的 11 个分支，逐字保留原有 props / emits 接线：

| id | 组件 | 接线 |
| --- | --- | --- |
| `search` | `GlobalSearch` | `:prefill`，`@close → emit('close')` |
| `outline` | `Outline` | `:cursor-line`，`@goto → emit('outlineGoto', line)`；**无 close 监听**（现状：关闭逻辑在 Outline 内部） |
| `backlinks` | `BacklinksPanel` | `@close → emit('close')` |
| `relationships` | `RelationshipsPanel` | 同上 |
| `tags` | `TagsPanel` | `@close → emit('close')`，`@filter-tag → emit('filterTag', tag)` |
| `tasks` | `TasksPanel` | `@close → emit('close')` |
| `neighborhood` | `NeighborhoodPanel` | 同上 |
| `types` | `TypesPanel` | 同上 |
| `history` | `HistoryPanel` | 同上 |
| `inspector` | `PropertiesInspector` | 同上 |
| `agent` | `AgentPanel` | `@open-settings → emit('openSettings', section ?? 'integrations')`，`@close → emit('close')` |

组件导入（8 个 `defineAsyncComponent` + 3 个静态）从 `App.vue` 迁到本文件：

- 静态：`GlobalSearch`、`Outline`、`BacklinksPanel`
- 异步：`NeighborhoodPanel`、`RelationshipsPanel`、`TagsPanel`、`TasksPanel`、
  `TypesPanel`、`HistoryPanel`、`PropertiesInspector`、`AgentPanel`
- 保持 `defineAsyncComponent(() => import(...))` 形式，懒加载时机不变。

`App.vue` **必须保留** `GlobalSearch` 导入 —— L2354 手机搜索仍在使用。

### 4.3 新增 `app/src/components/sidebar/SidebarDock.vue`

从 `App.vue` 迁入外壳与交互逻辑，**逻辑逐字搬迁，不改判断**：

- props：`side: 'left' | 'right'`、`panes: readonly { id: ImplementedSidebarPaneId }[]`、
  `width: number`、`searchPrefill: string`、`outlineLine: number`
- emits：`contextmenu: [ev: MouseEvent]`、`closePane: [id]`、`filterTag: [tag]`、
  `outlineGoto: [line]`、`openSettings: [section?: string]`
- 模板：`<aside class="side-sidebar side-sidebar--${side}" :style="{ width: width+'px', flexBasis: width+'px' }" @contextmenu.prevent="emit('contextmenu', $event)">`
  - resize 把手：`side === 'left' ? 'side-sidebar__resize--right' : 'side-sidebar__resize--left'`，
    `@mousedown → onSidebarResize($event)`
  - `v-for` + `RsSplitter` + `.rs-pane-host`（`data-rs-pane`、动态 class 顺序与现状一致）+ `.rs-pane-grip`
  - `.rs-pane-host` 内：`<SidebarPaneBody :id="p.id" ... />`，并把子组件 emits 转发成本组件 emits
- 内部逻辑（自 `App.vue` 迁入，不改实现）：
  - `paneStyle(id)`（L2194–2221，含 `panes.length < 2` 早退、最后一项 `1 1 auto`）
  - `draggingPaneId` / `dragOverPaneId` / `startPaneReorder`（L2144–2178，Pointer Events、
    `elementFromPoint('[data-rs-pane]')`、`settings.moveRsPane`）
  - `onSidebarResize(ev)`（L2235–2258，`delta = side === 'right' ? -dx : dx`，
    `settings.setSideSidebarWidth`）
  - 需要 import `useSettingsStore`、`useI18n`（`rsPane.dragToReorder`）、`RsSplitter`
- 不迁入：`watch(visibleRsPanes → solomd:relayout)`、`sideSidebarStyle` 的 440 自动加宽
  （这两项留在 `App.vue`，因为依赖 App 内的 computed 与全局副作用）。

### 4.4 修改 `app/src/App.vue`

1. L2375–2433 与 L2442–2500 两段 `<aside>` 各替换为一个 `<SidebarDock>`，
   `v-if` 条件、`side` 参数、DOM 位置原样保留：
   - 左：`<SidebarDock v-if="showRightSidebar && settings.outlineSide === 'left'" side="left" ... />`
   - 右：`<SidebarDock v-if="showRightSidebar && settings.outlineSide !== 'left'" side="right" ... />`
2. 新增 `sideSidebarWidth = computed(...)`（原 `sideSidebarStyle` 的 440 逻辑，返回数字），
   以 `:width` 传入。
3. 新增 `onPaneClose(id)`：`search` → `searchOpen = false`；其余按 id 映射到原 `ctxToggle(() => settings.toggleXxx())`
   （mapping: backlinks/relationships/tags/tasks/neighborhood/types/history/inspector/agent）。
   `ctxToggle` 本身（`noPanesVisible` 判定 + `hideRightSidebarFromPane` / `ensureRightSidebarVisible`）**不改**。
4. `visibleRsPanes`（L2105–2133）：`known` 字面数组替换为 `IMPLEMENTED_SIDEBAR_PANE_IDS`；
   `all` 改为 `Record<ImplementedSidebarPaneId, boolean>`；排序/过滤/未知 id 追加逻辑逐字保留。
5. 删除已迁走的 pane 组件导入与 `startPaneReorder`/`paneStyle`/`onSidebarResize`；
   **保留** `GlobalSearch` 导入（手机搜索）与 `RsSplitter` 导入移除（已由 Dock 使用）。
6. 不删除、不改动：`openSidebarCtx` / `sidebarCtx` 右键菜单（L2522–2572，仍无 `inspector` 项）、
   `ctxToggle`、`rsPaneSnapshot`、relayout watch、通知/统计等无关代码。

### 4.5 CSS 迁移边界（scoped 是关键约束）

`<style scoped>` 只给**子组件根元素**打双重 scopeId，子组件内部子孙不继承父 scopeId。

- 迁入 `SidebarDock.vue` 的 `<style scoped>`：
  `.side-sidebar`、`.side-sidebar--left/--right`、`.side-sidebar__resize` 及其
  `--left/--right`/hover、`.rs-pane-host` 全部变体（含 `--driving`/`--drop-target`、
  `--agent` 的 4× 弹性）、`.rs-pane-grip` 全部变体、
  `.app--narrow .side-sidebar__resize { display: none }`（必须迁，否则 App scopeId 命中不到）。
- **保留在 `App.vue`**：`.app--narrow .side-sidebar`、`.app--narrow .side-sidebar--left/--right`
  （命中子组件根元素，双 scopeId 仍有效）、`.content` 及其余与侧栏无关样式。
- 只用既有 `tokens.css` 变量与既有类名；不新增依赖。

---

## 5. 非目标（本阶段明确不做）

- 新标签模型 / 活动栏 / 标签头 / 单活显示
- 跨侧拖拽、S2 的 `sidebarDock` 状态、`v510SidebarDockMigrated` 迁移标记
- `calendar` 组件与任何入口
- `PanelHeader` 标题移除（D4，顺延 S2）
- Rust 代码、i18n 文案、版本号

---

## 6. 验收

| 项 | 判据 |
| --- | --- |
| `pnpm test` | `585 / 585 / fail 0`，与基线一致 |
| `pnpm build` | `vue-tsc` 0 错误，构建成功 |
| `app-menu.test.ts` | 未改任何断言即通过（panes 子菜单、顺序、勾选态） |
| 面板集合 | 仍是 11 个；`calendar` 无任何可见影响 |
| 显示顺序 | `rsPaneOrder` 排序 + 未知 id 追加 + 注册表兜底顺序完全不变 |
| 开关行为 | 设置开关 / Outline tab 开关 / 搜索会话级三类来源不变 |
| 关闭按钮 | `ctxToggle` 的「关到零面板则隐藏整侧栏」行为不变 |
| 右键菜单 | 同一组菜单项、同一顺序、无 `inspector` |
| pane 高度 | 拖动 splitter 后高度、最后一项吸底行为不变 |
| 拖拽排序 | grip 指针拖拽仍生效，`moveRsPane` 落点语义不变 |
| 宽度 | 左右共用宽度、Agent<260 自动 440、拖拽方向不变 |
| 窄屏 | `.app--narrow` 下 resize 把手仍隐藏，左右侧栏定位不变 |

---

## 7. 人工核对清单（GUI 可启动时执行）

1. 打开大纲（右），确认标题、计数、滚动、点击跳转、关闭按钮。
2. 右侧依次开/关：Backlinks、Relationships、Tags、Tasks、Neighborhood、Types、History、Inspector、Agent。
   每开一个确认：标题条、关闭按钮、`⋯` grip 悬停 tooltip、内容区滚动。
3. 同时开 Outline + Backlinks：确认 splitter 出现、上下拖动、高度持久化、最后一项吸底。
4. 按住 grip 上下拖动排序：确认 `--dragging` / `--drop-target` 高亮、松手后顺序变化并在重启后保留。
5. 关闭所有面板：确认整侧栏自动隐藏；再点工具栏搜索/菜单项，确认整侧栏自动恢复（`ensureRightSidebarVisible`）。
6. 右键侧栏空白区：确认菜单项与顺序、勾选态、任一项可切换对应面板。
7. 拖动侧栏左/右边缘改宽：确认方向正确、宽度在重启后保留。
8. 打开 Agent：确认宽度自动 440（当前 <260 时）、聊天区可滚、`open-settings` 打开 Integrations。
9. 把大纲切到左侧（设置 → Outline side = left）：确认左栏位置、宽度把手在右缘、拖拽方向相反。
10. 窄窗口（<600px）：确认 resize 把手隐藏、左右侧栏定位与抽屉行为与重构前一致。
11. 手机布局：确认 `phone-search` 仍正常（`GlobalSearch` 导入仍被 L2354 使用）。
12. 全局搜索：工具栏搜索触发侧栏 search pane，`@close` 仍关闭该 pane 而非整侧栏。

---

## 8. 交付与提交

- 单一提交，message 明确「纯结构重构、行为不变」；不 push、不改版本号。
- 同一提交纳入未跟踪的设计文档 `docs/sidebar-panel-dock-plan.md`（及本 spec/tasks）。
- 报告需包含：差异清单、D4 顺延说明、测试前后数字、dev/server 可验证范围与结论。
