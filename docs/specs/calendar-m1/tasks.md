# M1 任务清单：日历只读视图

按顺序执行；每步可独立回滚。全部完成后统一提交（不 push、不改版本号）。

## T0 纯逻辑与单测

- [x] 新建 `app/src/lib/calendar-view.ts`：视图类型、宽度阈值/降级、`occurrenceDays`、
      `buildCalendarView`（31 天前置）、`buildAgendaGroups`、`monthGridRange`、`weekRange`、
      `isCalendarTaskOverdue`
- [x] 新建 `app/src/lib/calendar-view.test.ts`：宽度边界、全天排他、跨午夜、跨天展开、
      议程锚点、重叠分列、逾期、无日期分组、窗口前置、网格范围
- [x] `pnpm test` 只跑新增用例通过

## T1 面板组件

- [x] 新建 `app/src/components/CalendarPanel.vue`
- [x] `PanelHeader` 不传标题，只放 ‹ / 今天 / › + 关闭
- [x] `SegControl` 只列当前宽度支持的视图；默认议程
- [x] 议程 / 日 / 周 / 月四种渲染，全部走 token
- [x] `ResizeObserver` 测宽并在卸载时断开；无定时器、无全局监听
- [x] 事件/任务点击跳回笔记（任务带 120ms 行跳转）

## T2 接入

- [x] `sidebar-panes.ts`：`calendar` 去 `pending`，`defaultVisible: false`，`available: hasFolder`
- [x] `SidebarPaneBody.vue`：async 分支 + `@close`
- [x] `App.vue`：`dockPaneVisible.calendar` + 右键/`+` 菜单一行
- [x] `settings.ts`：`toggleCalendarPanel()`
- [x] `Icons.vue`：`calendar` 图标

## T3 i18n

- [x] `en.ts` 增 `calendar.*`（类型源）
- [x] `zh/ja/ko/de/fr/es/pt/it/pl/nl/tr/sv/uk/ru` 同步补齐
- [x] `sidebar-dock.test.ts` locale 用例补 `calendar.*` 断言

## T4 既有测试适配

- [x] `sidebar-dock.test.ts`：calendar 默认可见由 true 改 false；注释更新
- [x] `app-menu.test.ts`：calendar 不再 `pending`，但仍不进菜单

## T5 验证与提交

- [x] `pnpm test` 记录 tests / pass / fail
- [x] `pnpm build`（`vue-tsc --noEmit && vite build`）0 错误
- [x] 一个提交；汇报「已实测 / 仅代码推断」清单
