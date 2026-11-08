# V1 任务清单：文件树并入主侧栏

> 依赖：`spec.md` 获批后执行。按顺序做，每步保持可编译。

## T1 注册表：新增 `files` 容器

- [x] `app/src/panes/sidebar-panes.ts`
  - `SidebarPaneId` 加 `'files'`。
  - `SidebarPaneVisibility` 加 `'always'`。
  - `SIDEBAR_PANE_DEFS` 首位插入 `files`（左、常显、`icon:'folder'`、`titleKey:'rsPane.files'`、无 `menuKey`）。
  - `outline.defaultSide` 改为 `'right'`。
  - `migrateSidebarDock` 的可见性分支支持 `'always'`。
- 验收：`vue-tsc` 能通过；`IMPLEMENTED_SIDEBAR_PANE_IDS` 含 `files`。

## T2 Dock 纯函数与迁移

- [x] `app/src/lib/sidebar-dock.ts`
  - `MIN_DOCK_WIDTH = 212`。
  - `defaultSidebarDock()`：`files` 左、`active.left='files'`、`active.right='outline'`、`collapsed.left=false`、`collapsed.right=true`。
  - `sanitizeSidebarDock()` 强制 `files` 在左且 visible。
  - `moveAllPanesToSide()` 锁定 `files` 在左。
  - 新增 `mergeFilesPane()`（签名与行为见 spec §4.2）。
- 验收：纯函数可单测；`files` 在任何路径都不会到右侧、不会被隐藏。

## T3 settings 迁移与动作

- [x] `app/src/stores/settings.ts`
  - 接口 + 默认值新增 `v511FileTreeMerged`、`v511OutlineSideNoticeShown`。
  - `defaults()` 使用新 dock 默认；移动端 `collapsed.left=true`。
  - `load()` 在 v510 迁移后执行 v511（`mergeFilesPane`，幂等）。
  - `toggleFileTree` 镜像 `collapsed.left`。
  - `setDockCollapsed` / `toggleDockCollapsed` 镜像 `showFileTree`。
  - `showDockPane` / `focusDockPane` / `setActiveDockPane` / `toggleDockPane` 左侧展开时同步 `showFileTree`。
  - `setOutlineSide` 只移动 outline（不再 `moveAllPanesToSide`）。
  - `movePaneToSide` / `toggleDockPane` / `hideDockPane` 保护 `files`。
- 验收：迁移前后状态、重复迁移、文件树不可移动均有单测。

## T4 渲染：Sidebar 嵌入 Dock

- [x] `app/src/components/Sidebar.vue`
  - `embedded?: boolean`；隐藏 inset 与 resize；新增 `.sb--embedded` 样式。
- [x] `app/src/components/sidebar/SidebarPaneBody.vue`
  - `files` → `<Sidebar embedded>`；新增 `openQuickSwitcher` emit。
- [x] `app/src/components/sidebar/SidebarDock.vue`
  - 转发 `openQuickSwitcher`。
- 约束：`FileTree.vue` 零改动。

## T5 App 外壳

- [x] `app/src/App.vue`
  - 删除桌面/平板 `Sidebar.left-stack`；保留手机 `variant="phone"`。
  - 左 Dock `v-if="hasLeftDock && !isNarrow"`、`:overlay="isTabletOverlay"`、绑定 `openQuickSwitcher`。
  - `dockPaneVisible` 加 `files: true`。
  - 平板：左 Dock 作为抽屉；CSS `.side-sidebar--left` 替换 `.left-stack`；收起回落 32px rail。
  - 窄屏：不渲染左 Dock；`closeNarrowDrawer` 不再翻转 `showFileTree`。
  - `onMounted` 发一次性大纲换侧 toast。
- 验收：桌面三栏、平板抽屉、手机布局均无新增空白列。

## T6 i18n 全语言

- [x] 15 个 `app/src/i18n/*.ts`：
  - 新增 `rsPane.files`、`toast.outlineMovedToSecondary`。
  - 调整 `header.showSidebar`、`menubar.toggleFileTree`、`view.toggleFileTree` 的语义文案。
- 验收：现有“每个 locale 每个 pane 都有 titleKey”的测试继续通过，并新增两个 key 的断言。

## T7 单测

- [x] `app/src/lib/sidebar-dock.test.ts`
  - 更新 fresh install 断言（files 左、outline 右、左展开）。
  - 更新最小宽度断言（100 → 212）。
  - 新增：
    - `mergeFilesPane` 迁移前后状态（left 面板搬到 right、files 留在左、宽度=宽度+32、collapsed 跟随 showFileTree）。
    - 第二次以 `alreadyMerged:true` 调用结果不变（幂等）。
    - `moveAllPanesToSide` 后 files 仍在左。
    - `sanitizeSidebarDock` 把被手改到右侧的 files 拉回左并强制 visible。
  - 全语言 key 完整性加入 `rsPane.files` / `toast.outlineMovedToSecondary`。
- 如存在 store 级测试夹具，补一条 `toggleFileTree` ↔ `collapsed.left` 双向镜像断言；没有则不新造测试基建。

## T8 验证与提交

- [x] `pnpm test`
- [x] `pnpm build`（含 `vue-tsc`）
- [ ] 按 spec §6 人工核对（本环境无法目视 GUI，需用户核对）
- [x] 提交：说明可见布局变更；不 push、不改版本号。
