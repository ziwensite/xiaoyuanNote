# 面板头部、菜单视口夹取与日历头部调整

## Context

侧边栏面板头部各有一个 X 关闭按钮，和 dock 标签/右键菜单的关闭入口重复；用户要求统一由右键菜单承担「关闭 / 收起」。同时，当前各处菜单的定位逻辑是各写各的（有的只 clamp 不翻转，有的完全不夹取，例如 `App.vue` 的面板管理菜单直接使用鼠标坐标），窄窗口/靠右/靠底时会溢出屏幕。最后，侧边栏日历的年月标题独占一行，浪费纵向空间，且「打开日详情」误用了 external 箭头图标。

目标：
1. 面板头部不再有 X；每个面板的右键菜单都有「关闭」和「收起」，且关闭后仍能从 `+` / 面板清单恢复。
2. 所有右键菜单、下拉、浮层共用一套定位函数：靠右左翻、靠底上翻、两边都放不下时贴边并允许内部滚动。
3. 日历年月标题进入第一行，external 换成 calendar 图标，不挤压现有 prev/today/next。

## 1. 共享定位模块（新增）

新增 `app/src/lib/menu-position.ts`，纯函数为主，供所有浮层复用：

```ts
export interface Box { left: number; top: number; width: number; height: number }
export interface MenuMetrics { width: number; height: number; cssMaxHeight: number }
export interface PlaceOptions { gap?: number; pad?: number; preferX?: 'right' | 'left'; preferY?: 'below' | 'above'; viewport?: Box }
export interface Placement { left: number; top: number; maxHeight?: number; maxWidth?: number; flippedX: boolean; flippedY: boolean }

export function viewportBox(): Box;          // visualViewport（含 offset）优先，回退 innerWidth/innerHeight
export function measureMenu(el: HTMLElement): MenuMetrics; // rect.width + scrollHeight + computed max-height
export function placeMenu(anchor: Box, menu: MenuMetrics, opts?: PlaceOptions): Placement;
export function placeMenuFromPoint(x: number, y: number, menu: MenuMetrics, opts?: PlaceOptions): Placement;
export function placeMenuFromRect(r: Box | DOMRect, menu: MenuMetrics, opts?: PlaceOptions): Placement;
export function placeFloating(el: HTMLElement, anchor: Box | { x: number; y: number }, opts?: PlaceOptions): Placement;
```

规则：
- 默认 `pad = 8`、`gap = 4`；全部按 `position: fixed` 的视口坐标计算，不使用 `screen.*`；`viewportBox()` 用 `visualViewport` 的 `offsetLeft/offsetTop/width/height` 回退 `innerWidth/innerHeight`，天然覆盖多显示器（窗口客户区）、任务栏贴边、移动端缩放。
- 纵向：优先锚点下方；`menu.height` 用 `scrollHeight`（自然高度）判断。下方不够且上方够 → 上翻；两边都不够 → 取空间大的一侧贴边，返回 `maxHeight = max(avail, 0)`，但**只有当 `avail` 小于元素自身 CSS `max-height` 时才返回**，避免把菜单撑得比组件原本的 cap 更高。`top` 最终 clamp 在 `[pad, vh - pad - min(height, avail)]`。
- 横向：优先 `preferX`（默认 `right`，即锚点左缘起排；`align='end'` 传 `preferX:'left'`）。右侧不够 → 左翻（右缘对齐）；左侧也不够 → clamp 到 `[pad, vw - pad - width]`。
- 菜单比视口还宽/高：返回 `maxWidth` / `maxHeight`，调用方写入内联样式，实现贴边 + 内部滚动。

新增 `app/src/lib/menu-position.test.ts`（`node:test` + `node:assert/strict`，参照 `context-menus.test.ts`），覆盖：右下角双击翻左上、左上角不动、超宽超高返回 maxWidth/maxHeight、锚点靠底上翻、恰好等于可用空间不翻转、组件 CSS max-height 更小时不被覆盖、320px 窄视口。

## 2. 接入所有菜单（按类替换，不逐处重写逻辑）

统一模式：保留各组件「何时显示」的逻辑，只把坐标计算换成 `placeMenuFromPoint` / `placeMenuFromRect` / `placeFloating`，并应用返回的 `left/top/maxHeight`（必要时 `maxWidth`）。

- 鼠标点类（右键菜单）：`components/ContextMenu.vue`、`components/EditorContextMenu.vue`、`components/FileTree.vue`（`openCtxAt`）、`components/SpellcheckMenu.vue`、`components/StatsPill.vue`、`components/PomodoroPill.vue`、`components/ViewsPanel.vue`、`components/TypesPanel.vue`、`components/TabBar.vue`、`components/PaneTabBar.vue`。
- 按钮锚点类（下拉/弹出）：`ui/DsDropdown.vue`、`ui/DsPopover.vue`、`components/sidebar/DockTabStrip.vue`（`»` 菜单改为测量实际宽高，去掉硬编码 200）、`components/FileTree.vue`（`anchorPop` 排序/筛选/工作区）、`components/Sidebar.vue`（最近文件）、`components/HeaderSearchBox.vue`、`components/TypeCustomizePopover.vue`。
- `components/Toolbar.vue`：保留现有 `align` 语义，渲染后测量菜单并把 `positionMenuFromButton` + `keepMenuOnScreen` 合并为一次 `placeMenuFromRect`；`right` 锚定换算为 `left/top` 或由结果反推 `right`；`menubar__menu` 子菜单复用同一函数。
- `App.vue` 的 `.sidebar-ctx` 面板管理菜单（恢复入口）：加 `ref`，打开后 `nextTick` 调用 `placeFloating`，把结果写回 `x/y` 并设 `maxHeight`；CSS `.sidebar-ctx` 补 `max-height: min(70vh, 520px); overflow-y: auto` 兜底。
- `components/CommandPalette.vue`：当前居中（`padding-top: 14vh` + `max-height: min(480px, 64vh)`）理论不溢出，仅把 `max-height` 改为 `min(480px, calc(100vh - 14vh - 24px))`，短窗口也不越界。

不动的浮层：`DsTooltip`、`SelectionBubble`（编辑器内联气泡，不属于菜单）。

## 3. 面板头部去 X + 右键菜单补齐

- `components/panel/PanelHeader.vue`：删除末尾 `<button v-if="closable">`，删除 `closable` prop 与默认值；保留 `defineEmits<{ close: [] }>();`（不赋值，避免 `noUnusedLocals`），让 10 个现有 `@close` 绑定继续合法、不产生 Vue 警告（成为 no-op）。
- `components/AgentPanel.vue`：删除头部内联 X；同时移除该组件 `close` emit 与 `SidebarPaneBody.vue` 对 agent 的 `@close`（它无其它 close 触发点）。
- `styles/panels.css`：`.rp-head` 的 `padding: 0 8px 0 12px` 改为 `0 12px`，去掉 X 后左右留白对齐；`gap` 与 `.rp-title { flex: 1 1 auto; min-width: 0 }` 保持不变。
- `lib/context-menus.ts`：`buildDockTabMenu` 在 `panel.hide` 之后加 `entry('column.collapse', t('sidebarDock.collapse'))`，复用现有 i18n key（15 个语言包无需改动）。`buildPanelMenu` 已有 close / hide / collapse。
- `App.vue onPanelCtxPick`：`kind === 'pane' | 'tab'` 的 switch 缺 `column.collapse` 分支（现在是死项），补 `case 'column.collapse': settings.setDockCollapsed(c.side, true); break;`。
- 恢复入口：`+` 按钮与列头空白右键仍走 `openSidebarCtx` 面板清单；`files` 面板虽被 FileTree 的 `contextmenu.stopPropagation` 吞掉 pane 菜单，但 dock 标签右键可到达 close/collapse，`+`/清单可恢复。
- 更新 `lib/context-menus.test.ts`：`buildDockTabMenu` 期望数组加 `column.collapse`；增加「pane 菜单与 tab 菜单都同时包含 `panel.close` 与 `column.collapse`」断言。

## 4. 日历头部

`components/CalendarPanel.vue`：
- `<PanelHeader :title="monthTitle" ...>`，年月进入第一行；删除 `.calendar-mini__title` 元素及对应 CSS。
- 「打开日详情」`<Icons name="external">` → `<Icons name="calendar">`（`Icons.vue:264` 已有）。
- 保持 prev / today / next 与新图标按钮原样；`.rp-title` 的 `flex: 1 1 auto; min-width: 0; ellipsis` 会让标题先收缩，按钮 `flex: 0 0 auto` 不被挤压；在 212px 最小列宽下长英文月份走省略号。不单独改字号，保持面板标题一致性。

## 5. 验证与提交

- `app/` 下执行 `pnpm test`（重点：`menu-position.test.ts`、`context-menus.test.ts`）。
- `app/` 下执行 `pnpm build`（`vue-tsc --noEmit` 兜住 props/emit/未用变量）。
- 单独提交一个 commit，不 push、不改版本号；不提交 `.trae/` 与 `docs/specs/` 未跟踪目录。

## 文件清单

- 新增：`app/src/lib/menu-position.ts`、`app/src/lib/menu-position.test.ts`
- P0：`app/src/components/panel/PanelHeader.vue`、`app/src/App.vue`、`app/src/lib/context-menus.ts`、`app/src/styles/panels.css`
- P1：`ContextMenu.vue`、`DsDropdown.vue`、`DsPopover.vue`、`Toolbar.vue`、`DockTabStrip.vue`、`FileTree.vue`
- P2：`EditorContextMenu.vue`、`TabBar.vue`、`PaneTabBar.vue`、`ViewsPanel.vue`、`Sidebar.vue`、`PomodoroPill.vue`、`StatsPill.vue`、`SpellcheckMenu.vue`、`TypesPanel.vue`、`TypeCustomizePopover.vue`、`HeaderSearchBox.vue`、`AgentPanel.vue`、`SidebarPaneBody.vue`、`CalendarPanel.vue`、`CommandPalette.vue`、`context-menus.test.ts`

## 风险点

- `Toolbar` 原 `right` 锚定改 `left/top` 时，需保留 `.dropdown__menu { left: 0 }` 的覆盖（右锚定时 `left: auto`）。
- `PaneTabBar` / `TabBar` 的菜单若 CSS 写死 `right: 0`，改坐标时同步删除，避免双重定位。
- `measureMenu` 可能因 `v-if` / 字体回流拿到 0 宽高：用一次 `requestAnimationFrame` 重试再定位。
- `sidebar-ctx` 回写坐标会触发重渲染，赋值前与旧值比较，避免循环。
