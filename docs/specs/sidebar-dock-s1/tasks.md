# S1 任务清单：SidebarDock 零行为重构

按顺序执行；每一步都可独立回滚。全部完成后统一提交（不 push、不改版本号）。

## T0 基线与差异留档（已完成）

- [x] `pnpm test` 记录 `585 / 585 / fail 0`
- [x] `pnpm build` 记录 0 类型错误
- [x] 比对两段模板，确认仅 4 处差异（v-if、根 class、resize class、resize side 参数）
- [x] 确认两个 `<aside>` DOM 位置不同，必须保留两个挂载点

## T1 新建 `app/src/panes/sidebar-panes.ts`

- [x] 定义 `SidebarPaneId` / `ImplementedSidebarPaneId` / `SidebarPaneVisibility` / `SidebarPaneDef`
- [x] `SIDEBAR_PANE_DEFS` 顺序严格等于现状 `known`：search, outline, backlinks, relationships, tags, tasks, neighborhood, types, history, inspector, agent, calendar(pending)
- [x] `IMPLEMENTED_SIDEBAR_PANE_IDS` 过滤 `pending`
- [x] `outline.defaultSide = 'left'`，`calendar = right/defaultVisible/defaultActive/pending`（仅预留）
- [x] 不写 `titleKey` / `icon`（避免新 i18n 文案）

## T2 新建 `app/src/components/sidebar/SidebarPaneBody.vue`

- [x] 迁入 11 个面板分支，props/emits 逐字保留（见 spec §4.2 表）
- [x] 8 个 `defineAsyncComponent` 与 3 个静态导入迁入本文件
- [x] `outline` 不接 `@close`；`agent` 的 `open-settings` 默认 `integrations`
- [x] props：`id` / `searchPrefill` / `outlineLine`

## T3 新建 `app/src/components/sidebar/SidebarDock.vue`

- [x] `<aside class="side-sidebar side-sidebar--{side}">` + 内联 `{width, flexBasis}`
- [x] resize 把手 class 与方向按 `side` 决定，逻辑同现状
- [x] `v-for` + `RsSplitter` + `.rs-pane-host`（`data-rs-pane`、动态 class 顺序不变）+ `.rs-pane-grip`
- [x] 迁入 `paneStyle` / `startPaneReorder` / `draggingPaneId` / `dragOverPaneId` / `onSidebarResize`
- [x] 迁入对应 scoped CSS：`.side-sidebar*`、`.side-sidebar__resize*`、
      `.app--narrow .side-sidebar__resize`、`.rs-pane-host*`、`.rs-pane-grip*`
- [x] 事件转发：`contextmenu`、`closePane`、`filterTag`、`outlineGoto`、`openSettings`

## T4 修改 `app/src/App.vue`

- [x] 两段 `<aside>` → 两个 `<SidebarDock>`，`v-if` / `side` / DOM 位置不变
- [x] 新增 `sideSidebarWidth` computed（原 440 规则），`:width` 传入
- [x] 新增 `onPaneClose(id)`（search 走 `searchOpen=false`，其余走 `ctxToggle(toggle)`）
- [x] `visibleRsPanes` 的 `known` 改用 `IMPLEMENTED_SIDEBAR_PANE_IDS`，排序/追加/过滤逻辑不动
- [x] 删除迁走的 imports 与函数；**保留** `GlobalSearch` 导入
- [x] 保留 `ctxToggle` / `openSidebarCtx` / 右键菜单 / relayout watch / `.app--narrow .side-sidebar*`

## T5 验证

- [x] `pnpm test` → `585 / 585 / fail 0`
- [x] `pnpm build` → 0 类型错误（`✓ built in 20.97s`）
- [x] 确认 `app-menu.test.ts` 未改一行断言仍通过
- [x] 尝试 `pnpm dev`：1420 被占用，改用 `--port 1430` 启动成功（`ready in 673 ms`）；未做目视验证
- [x] 按 spec §7 输出人工核对清单，标注「未执行（无 GUI）」

## T6 提交

- [x] `git add` 三个新源码文件、`App.vue`、`docs/sidebar-panel-dock-plan.md`、本 spec/tasks
- [x] commit message：纯结构重构、行为不变（无新功能、无迁移标记）
- [x] 不 push、不改 `package.json` 版本号
