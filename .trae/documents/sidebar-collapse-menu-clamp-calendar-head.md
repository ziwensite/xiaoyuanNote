# 侧栏「收起/关闭」、菜单视口夹取、日历头部重排

## Context

三处 UI 问题需要一次改完并单独提交：

1. 每个侧栏面板头部都有一个 X。用户确认「所有面板都不需要 X」，关闭/收起统一由右键菜单承担；并且收起与关闭必须是两个可区分的动作（收起 = 折叠成图标条仍在布局里，可展开；关闭 = 从侧栏移除，可从 `+` / 面板清单重新打开）。
2. 右键菜单与下拉菜单在窗口右缘/下缘会溢出屏幕（例如 Pomodoro 右键菜单直接用 `clientX/Y`、`.sidebar-ctx` 无 max-height）。需要一处公共定位函数统一夹取，而不是逐处打补丁。
3. 日历面板的「2026年11月」在第二行，应提到头部第一行；「打开日详情」目前用 external 箭头，应换成日历图标。

约束：不 push、不改版本号；`pnpm test`、`pnpm build` 必须通过。

---

## 1. 新增共享视口夹取模块

**新文件** `app/src/lib/menu-position.ts`（纯函数，无 Vue / 无 DOM 全局依赖以外的 store）：

```ts
export interface ViewportBox { left; top; right; bottom; }
export function viewportBox(): ViewportBox            // visualViewport 优先，否则 0/0/innerWidth/innerHeight
export interface MenuMetrics { width; height; maxHeight?; maxWidth?; }
export function measureMenu(el: HTMLElement): MenuMetrics  // rect + scrollHeight + computed max-height/max-width
export interface PlaceOptions { pad?: number; gap?: number; }
export interface Placement { left; top; maxHeight?; maxWidth?; }
export function placeMenuFromPoint(x, y, m, opts?): Placement
export function placeMenuFromRect(rect, m, opts?): Placement
export function placeMenu(anchor, m, opts?): Placement
export function placeFloating(el, anchor | {x,y}, opts?): Placement  // 直接写 el.style
```

规则（pad 默认 8，gap 默认 4）：

- 横向：先按传入 x / anchor.left；`x + width > vp.right - pad` 时翻到 `anchor.right - width`（点锚则 `x - width`）；仍越左界则贴 `vp.left + pad`；`width > vp.right - vp.left - 2*pad` 时返回 `maxWidth`。
- 纵向：优先 `anchor.bottom + gap`；放不下翻到 `anchor.top - gap - height`（点锚 `y - height`）；两头都放不下取空间更大的一侧贴边，并只在需要时返回 `maxHeight = 可用高度`；若该值不小于元素 CSS max-height 则不返回（不放大已有上限）。
- 全部使用视口 fixed 坐标；不读 `screen.*`。

**新测试** `app/src/lib/menu-position.test.ts`（node:test + assert/strict）：右下角翻左上、靠底上翻、恰好放下不翻、超宽/超高、CSS max-height 更小时不被覆盖、320px 窄视口。

---

## 2. 面板头去 X，清理 close 链路

- `app/src/components/panel/PanelHeader.vue`：删除末尾 X 按钮、`closable` prop 与 Icons 引用；保留 `defineEmits<{ close: [] }>()` 但不赋值，用于吸收既有 `@close`（随后由第 2 步逐个移除）。
- `app/src/components/AgentPanel.vue`：删除自带 X（约 L494-502）及其 `close` emit；它已有自己的 `header`，不套 PanelHeader，右键菜单由 SidebarDock 的 pane 区域统一提供。
- 各面板组件（`BacklinksPanel`、`RelationshipsPanel`、`TagsPanel`、`TasksPanel`、`NeighborhoodPanel`、`TypesPanel`、`HistoryPanel`、`PropertiesInspector`、`CalendarPanel`）：删除 `<PanelHeader @close="emit('close')">` 里的 `@close`；若组件的 `close` emit 仅此一处使用则一并删除（逐个确认）。
- `app/src/components/sidebar/SidebarPaneBody.vue`：删除全部 `@close="emit('close')"`、`close` emit 与 `props` 不变。
- `app/src/components/sidebar/SidebarDock.vue`：删除 `closePane` emit 与 `@close` 绑定。
- `app/src/App.vue`：删除三处 `@close-pane="onPaneClose"`；`onPaneClose` 保留给右键菜单 `panel.close`。
- `app/src/styles/panels.css`：`.rp-head` padding 由 `0 8px 0 12px` 改为 `0 12px`，去掉为 X 预留的右内边距。

---

## 3. 收起 / 关闭 两件事

### 3.1 菜单项（`app/src/lib/context-menus.ts`）

- `buildPanelMenu`：`panel.close`（关闭面板 → 从侧栏移除）、`panel.moveLeft`、`panel.moveRight`、分隔、`panel.manage`、分隔、`column.collapse`（收起侧栏）。删除 `panel.hide` 项。
- `buildDockTabMenu`：`panel.open`、分隔、`panel.close`、`panel.moveLeft`、`panel.moveRight`、分隔、`panel.manage`、分隔、`column.collapse`。
- `buildColumnEdgeMenu` 不变（收起态显示 `column.expand`）。
- `CtxActionId` 移除 `panel.hide`；pinned 的 `files`：`panel.close` disabled（`hideDockPane` 对 PRIMARY_PANE_ID 直接 return），`column.collapse` 仍可用。
- 同步更新 `app/src/lib/context-menus.test.ts` 的精确 id 数组与 pinned 断言，以及末尾「dockIds」集合。

### 3.2 行为（`app/src/App.vue`）

- `onPaneClose`（改名不必）：`outline` 仍走 `tabs.toggleOutline`；其它 `settings.hideDockPane(id)`。**删除**「该侧无面板时自动 `setDockCollapsed(true)`」——关闭一个面板不应顺带收起整条侧栏，收起由菜单的 `column.collapse` 显式触发。
- `onPanelCtxPick`：`panel.close` → `onPaneClose`；删除 `panel.hide` 分支。

### 3.3 收起态渲染

- `app/src/components/sidebar/SidebarDock.vue`：新增 `collapsed?: boolean` prop。`collapsed` 且非 overlay 时不渲染 header + body，改为 32px 纵向图标条（`flex-direction: column`，全部可见 pane 的图标 + 底部 `+`）：点击 `settings.setActiveDockPane(side, id)`（自动展开），右键 `emit('tabContext', id, side, x, y)`，`+` 与空白 `emit('manage')`，active 高亮；条本身 `background: var(--bg-sidebar)` + 与编辑区之间的 hairline。mac 左侧折叠时 `padding-top: MAC_TRAFFIC_INSET`。
- `app/src/App.vue`：
  - `leftColumnVisible` / `rightColumnVisible` 去掉 `!collapsed` 条件（改名 `leftColumnPresent` / `rightColumnPresent` 更贴切）；窄屏/平板 overlay 分支保持原样。
  - `columns` 传给 `shellColumnWidths` 的该侧宽度改为 `collapsed ? null : naturalWidth`；模板 `:width="collapsed ? 32 : columns.left"`（右侧同理）。
  - `leftTrafficInset` 仅在「左列存在且未折叠」时生效；折叠时 `middleTrafficInset` 为真，rail 用 `padding-top` 让开红绿灯。
  - 桌面左右 `SidebarDock` 传 `:collapsed="settings.sidebarDock.collapsed.left/right"`；窄屏/平板 overlay 的 `v-if` 继续带 `!collapsed`。

---

## 4. 所有右键 / 下拉 / 浮层接入夹取

统一改为第 1 节的函数（teleport 后 `nextTick` 测量；打开时测量一次，resize/scroll 维持现有「关闭」策略）：

- `components/ContextMenu.vue`：用 `placeMenuFromPoint`，保留 `.ctx-menu` 自身 `max-height` 作为上限。
- `components/EditorContextMenu.vue`：`placeMenuFromPoint`。
- `components/FileTree.vue`：树右键（L781 一带）`placeMenuFromPoint`；`openCtxAt` 的按钮锚点浮层（L545）`placeMenuFromRect`。
- `components/PaneTabBar.vue`：tab 右键 `placeMenuFromPoint`；溢出列表（L395 `tabListPos`）`placeMenuFromRect`。
- `components/Toolbar.vue`：`positionMenuFromButton` + `keepMenuOnScreen`（L400-424）合并为 `placeMenuFromRect`；子菜单 L564-572 用 `placeMenuFromRect`（左右翻转 + 上翻 + max-height）。
- `app/src/ui/DsDropdown.vue`、`app/src/ui/DsPopover.vue`：改用 `placeMenuFromRect`（DsTooltip 不是菜单，不动）。
- `components/StatsPill.vue`：`.stats-pop` 打开后 `placeFloating`，以胶囊 rect 为锚、优先上方，必要时设置 `max-height` 并内部滚动。
- `components/PomodoroPill.vue`：`.pomo-pill__menu` 由原始 `clientX/Y` 改为 `placeMenuFromPoint`。
- `components/SpellcheckMenu.vue`：props x/y → `placeMenuFromPoint`。
- `components/Sidebar.vue`：最近文件浮层（L120-133）改用 `placeMenuFromRect`。
- `components/HeaderSearchBox.vue`：`recomputePosition` 改用 `placeMenuFromRect`（保留 360 最小宽与 maxHeight）。
- `components/TypeCustomizePopover.vue`：`placeMenuFromRect`。
- `components/ViewsPanel.vue` / `TypesPanel.vue`：确认是否自绘菜单；有则同样接入，没有则不改。
- `App.vue` 的 `.sidebar-ctx`（面板清单）：加模板 ref，`nextTick` 后用 `placeFloating` 夹取；CSS 补 `max-height: min(70vh, 520px); overflow-y: auto;`。
- `components/CommandPalette.vue`：仅 CSS，`max-height` 改 `min(480px, calc(100vh - 14vh - 24px))`，避免窄高窗口溢出（保持居中）。

CSS 层面不再为个别菜单新增固定像素宽度/高度；`styles/menus.css` 不动。

---

## 5. 日历面板头部

`app/src/components/CalendarPanel.vue`：

- `<PanelHeader :title="monthTitle">`；slot 内依次 prev / today / next / 打开日详情（`<Icons name="calendar" />`，title/aria 不变）。
- 删除模板中的 `<div class="calendar-mini__title">{{ monthTitle }}</div>` 与 `.calendar-mini__title` CSS；`.calendar-mini` 顶部 padding 保持 `8px 10px 10px`，周数表头与 7 列网格对齐不受影响。
- 头部按钮仍是 24px `.rp-icon-btn` + `.rp-btn--sm`，标题用 `.rp-title`（flex:1）占位，不会挤压 prev/today/next。

---

## 5.1 补充约束（用户确认追加）

- **先补菜单，再删 X**：删除任何面板的 X 之前，确认其右键入口可达。`SidebarDock` 的 `.dock-group` / `.rs-pane-host` 上的 `contextmenu` 覆盖 pane 区域全部面板，`DockTabStrip` 图标与折叠 rail 覆盖 tab 入口；`files` 为 pinned，`panel.close` 置灰但 `column.collapse` 与 `+`（面板清单）始终可用。实现顺序固定为：先改 `context-menus.ts` + 测试 → 再改 `SidebarDock` 右键/折叠 rail → 最后删 `PanelHeader` / `AgentPanel` 的 X。不得出现中间态「无可见关闭入口且菜单为空」。
- **用测试锁住翻转结果**：`menu-position.test.ts` 除断言期望坐标外，再加一个 `assertInside(placement, metrics, viewport, pad)` 辅助函数，对每个用例断言 `left >= pad`、`top >= pad`、`left + width <= right - pad`、`top + height <= bottom - pad`（返回 `maxHeight`/`maxWidth` 时按裁剪后的尺寸断言），不依赖目视。

## 6. 验证

```powershell
cd app
pnpm test
pnpm build
```

- 新增 `menu-position.test.ts` 全绿；`context-menus.test.ts` 更新后全绿。
- 手工检查（dev）：窄窗口右下角右键；Pomodoro/Stats 弹层；左右侧栏收起后仅剩图标条、点击图标展开；面板菜单「关闭面板」与「收起侧栏」文案可区分；关闭后从 `+` 菜单重新打开；日历头第一行显示年月与三个导航按钮。
- 提交信息聚焦「面板关闭/收起分离、菜单视口夹取、日历头部重排」，单独 commit，不 push、不改版本号。
