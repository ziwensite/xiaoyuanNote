# S2 tasks — 标签模型 + 双 Dock + 一次性迁移

> 对应 [spec.md](./spec.md)。完成后执行 `pnpm test` 与 `pnpm build`，提交时注明「可见行为变更」。

## T1 数据层（纯函数）
- [x] 新增 `app/src/lib/sidebar-dock.ts`：类型常量、`defaultSidebarDock`、`sanitizeSidebarDock`、`migrateSidebarDock`、`isDockPaneVisible`、`sideDockPanes`、`nextActiveAfterHide`。
- [x] 新增 `app/src/lib/sidebar-dock.test.ts`：plan §4.6 十条迁移/清洗用例 + 排序/active 回退/隐藏相邻激活 + 15 locale 键齐断言。

## T2 注册表
- [x] `app/src/panes/sidebar-panes.ts` 补 `icon` / `titleKey` / `defaultOrder` / `settingKey` / `available(ctx)`；按 D6 调整默认侧与默认可见性；calendar 保持 `pending`。

## T3 settings store
- [x] 新增 `sidebarDock` 与 `v510SidebarDockMigrated` 类型/默认值；`load()` 接入迁移并写标记。
- [x] 新增 Dock actions（toggle/show/hide/setActive/setCollapsed/toggleCollapsed/setWidth/movePaneToSide/resetDockLayout）。
- [x] 8 个 `toggleXxx()` 改为 `toggleDockPane` 别名；`toggleRightSidebar` 改折叠语义并保留 `ensureRenderable`；`hideRightSidebarFromPane`/`ensureRightSidebarVisible` 改折叠别名；`setOutlineSide` 改移动全部面板。
- [x] 删除 `_rsPanesBeforeHide` 的类型/默认值/persist 剔除/toggle 分支；`rightSidebarPaneHeights` 保留但停用。
- [x] `resetRightSidebarLayout` / `clearRightSidebarPaneHeights` 改重置 Dock 布局。

## T4 SidebarDock 重写
- [x] 活动栏（图标、active、`+`、折叠/展开）；标签头（≥2 时）；只渲染 active 面板。
- [x] 每侧独立宽度（含 agent 472 兜底）、resize 写新 store；移除 RsSplitter / grip / paneStyle / 竖向拖拽。
- [x] 样式只用现有 tokens 与既有类名。

## T5 PanelHeader（D4）
- [x] `title` 改可选；无 title 不渲染标题，count 仍可显示。
- [x] 9 处用法去掉 `:title`，保留 slot 按钮（Tags / Types）与 ×、count。

## T6 App.vue 接入
- [x] 两个 `<SidebarDock>` 按「该侧有非 pending 关联面板」挂载；删除 `visibleRsPanes`/快照/`ctxToggle` 旧分支/`sideSidebarWidth`/`outlineSide` 渲染门控。
- [x] `show*Pane` 拆成 visible（Dock/tab/session）与 available（上下文门控）；`rightSidebarHasRenderablePane` 按右侧计算。
- [x] 右键 `sidebar-ctx` 勾选态改读 Dock；`+` 复用同一清单；关闭/激活经新 action。
- [x] `solomd:relayout` watch 改挂 Dock 组合。

## T7 菜单 / 设置 / 命令同步
- [x] `useAppMenu.ts` 8 个面板改读 `sidebarDock`，`savedViews` 不变。
- [x] `Toolbar.vue` 2 处、`SettingsPanel.vue` 2 个勾选框、`useCommands.ts` 1 处改读新状态。
- [x] `app-menu.test.ts`：保持 panes 11 键形状，新增注册表覆盖 + calendar 缺席断言。

## T8 i18n
- [x] 15 份 locale 补 `rsPane.inspector`、`rsPane.calendar`、`sidebarDock.collapse`、`sidebarDock.expand`（非 zh 用英文）。

## T9 校验 / 提交
- [x] `pnpm test`（含新增测试）与 `pnpm build`（vue-tsc）全绿。
- [x] 整理迁移前后 / 新装行为对照；无法目视验证的部分明确说明。
- [x] 提交（message 说明可见行为变更，含 spec/tasks），不 push、不改版本号。
