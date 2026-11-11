# 任务清单 — 右键菜单按上下文拆分

对应规格：`docs/specs/context-aware-menus/spec.md`

## - [x] T1. 新建纯逻辑模块 `app/src/lib/context-menus.ts`

- 定义 `CtxActionId`、`CtxEntry`、`CtxSep`、`CtxNode`。
- 实现 5 个 builder：
  - `buildPanelMenu(ctx)` → 关闭 / 隐藏 / 移左 / 移右 / 管理 / 折叠
  - `buildDockTabMenu(ctx)` → 打开 / 隐藏 / 移左 / 移右 / 管理
  - `buildToolbarActionsMenu(kind, ctx)` → left | right | export | more 四套
  - `buildTabStripMenu(ctx)` → 新建 / 打开文件 / 打开文件夹 / 重新打开标签
  - `buildColumnEdgeMenu(ctx)` → 折叠/展开 + 该侧显示开关
- 所有 label 用传入 `t`，key 只引用既有命名空间 + 新增 `panelMenu.*`。

验证：`npx tsc --noEmit`（或 build）无类型错误。

## - [x] T2. 新增 `app/src/lib/context-menus.test.ts`

- 每个 builder 的 id 序列精确断言。
- 不同上下文集合互不相同（`new Set(allIds).size` 与逐对 diff）。
- `files` pinned → hide/move disabled；当前侧移动项 disabled。
- 勾选态随 state 变化。
- 15 语言 `strictT` 构建新 key 不抛错。
- 新增动作 id 均在可派发集合内。

验证：`pnpm test` 中该文件全绿。

## - [x] T3. 新增 `app/src/components/ui/ContextMenu.vue`

- `.ctx-menu` + `.ctx-item`，`role=menu/menuitem`。
- 屏幕边界翻转、Esc、点击外部、blur/resize/scroll 关闭。
- 键盘：首项聚焦、ArrowUp/Down/Home/End、Enter/Space。

## - [x] T4. i18n 15 语言新增 `panelMenu`

文件：`en zh es de nl it ko fr ru ja uk pt sv pl tr`。
键：`close`、`hide`、`open`、`moveToLeft`、`moveToRight`、`manage`。

验证：`context-menus.test.ts` 的 15 语言用例。

## - [x] T5. `SidebarDock.vue` 接线

- emits：`paneContext`、`edgeContext`。
- `.dock-group` 右键 → 读 `[data-rs-pane]` 后 emit。
- `.side-sidebar__resize` 右键 → emit `edgeContext`。
- 列头空白右键 → `emit('manage', $event)`（目标在 `.dock-tab` 内则忽略）。

## - [x] T6. `DockTabStrip.vue` 接线

- emits `tabContext`；`.dock-tab[data-dock-tab]` 右键 `prevent.stop`。
- `+` 右键 → `emit('manage', $event)`。

## - [x] T7. `App.vue` 渲染与派发

- `panelCtx` 状态 + 3 个 open 函数。
- `<ContextMenu>` + `onPanelCtxPick`，复用 `onPaneClose`、`settings.hideDockPane`、`settings.moveDockTab`、`settings.setActiveDockPane`、`settings.setDockCollapsed`、`openSidebarCtx`。
- 两个 `<Toolbar>` 加 `@menu-action="dispatchMenuAction"`。

## - [x] T8. `Toolbar.vue` 四个动作区菜单 + 标签条空白

- `tbCtx` 状态；左右开关 / 导出 / `⋯` 加右键（`data-tb-ctx`）。
- `#header-tabs` 右键（`.tab` 内忽略）。
- 新增 `menu-action` emit → App 派发。

## - [x] T9. 真实窗口验证

- dev bridge 对 8 处 `dispatchEvent('contextmenu')`，抓取菜单项文本。
- 输出对照表；暗色主题再取一次。

## - [x] T10. 全量检查

- `cd app && pnpm test`（真实 pass/fail 数）。
- `cd app && pnpm build`（真实耗时）。
- 说明未改 `app-menu.test.ts` 的原因；不提交。
