# 日历 B 弹窗方案：任务清单

前置：`docs/specs/calendar-ui-forms/spec.md` 获批后执行。本轮只完成调研，未改源码。

## 调研（已完成）

- [x] 确认浮层基座：`app/src/ui/DsModal.vue`（Esc / 焦点陷阱 / Teleport / role="dialog" / max-height）
- [x] 确认缺口：`width` 需传大值；body 需改 fill 布局（`:deep` 或新增 `fill` prop）
- [x] 确认任务数据与勾选：`useTasks` / `parseTaskMeta` / `localDateKey` / `isOverdue`
- [x] 确认跳转定位：`TasksPanel.vue` 的 `openPath` + 120ms `solomd:outline-goto`
- [x] 确认视图纯逻辑：`resolveCalendarViewMode` / `monthGridRange` / `buildCalendarView`
- [x] 给出 900px 双栏布局、窄屏堆叠、焦点状态与持久化方案
- [x] 给出 A / C 的后续升级路径（一行）

## 实施

### S1 状态与纯逻辑

- [x] 新增 `app/src/stores/calendar.ts`：`focusDate` / `view` / `dialogOpen`；`setFocusDate` / `shiftMonth` / `setView` / `openDialog` / `closeDialog`
- [x] 按工作区持久化 `focusDate` / `view`（`solomd.calendar.v1::<folder>`），`dialogOpen` 不落盘
- [x] `calendar-view.ts` 新增 `groupTasksByDue(tasks, today)`：逾期 / 今天 / 本周 / 以后 / 未排期
- [x] 单测：分组边界（今天、本周日、本周日+1、due=null、已完成过滤）；`shiftMonth` 跨年；持久化往返

### S2 侧栏迷你月

- [x] 重写 `app/src/components/CalendarPanel.vue`：只保留迷你月（292px，日号 + ≤3 点，今天/焦点日状态）
- [x] 点日期 → `setFocusDate` + `openDialog`；上一月/下一月/今天
- [x] 移除侧栏内议程/日/周/月详细视图与编辑入口（代码保留在 git 历史）

### S3 弹窗骨架（只读）

- [x] 新增 `app/src/components/CalendarDialog.vue`：`DsModal` + `min(94vw, 980px)` + fill 布局
- [x] 新增 `app/src/components/calendar/CalendarWorkspace.vue`：900px 下左月 360px / 右任务自适应；日/周切为单栏铺满
- [x] 新增任务分组列表：逾期/今天/本周/以后/未排期，组头吸顶，独立滚动
- [x] 月网格：48×44 格，日号 + ≤3 点，今天实心 / 焦点日描边，点击设焦点日
- [x] `App.vue` 挂载 + 菜单/命令入口

### S4 联动与文案

- [x] 任务行：勾选 `useTasks.toggle`；点击 `closeDialog` → `openPath` → 120ms `outline-goto`（`paneId: tiles.focusedPaneId`）
- [x] 事件点击：打开事件编辑器；编辑器内提供「打开笔记」
- [x] 窄屏（<720）：`width: 100%`，月在上、任务在下，任务列表默认展开
- [x] i18n 15 语言：弹窗标题、视图切换、任务分组、迷你月、空态、编辑器与 toast

### S5 弹窗内 M2（原要求不变）

- [x] 新建事件：点月格 = 当天全天；日后按小时行；新建即写文件
- [x] 从编辑器选中文本建任务：命令面板「Task: Create from Selection」→ 在笔记末尾追加 `- [ ] <选中> 📅 <今天>`，原文不替换
- [x] 编辑事件：标题/时间/全天/地点/备注；`writeCalendarEvent` / `patchFrontmatter`，正文逐字节不动
- [x] 拖拽改期：15 分钟吸附；跨天保留时长；松手才写盘
- [x] 下缘改时长；删除 = `status: CANCELLED`（不删文件，提示可撤销）
- [x] 冲突：写回前重读，外部改动不静默覆盖，交用户决定
- [x] 单测：14/15/16 吸附边界、跨天起止、resize 不被吸附破坏、写回不动正文、外部改动检测

### 验证

- [x] `pnpm test`（635 tests / 635 pass）
- [x] `pnpm build`（vue-tsc + vite 均通过）
- [ ] 手测：开关弹窗 / 重启恢复 / 侧栏与弹窗月份一致 / 任务勾选与跳转 / 窄屏
- [x] 提交（不 push、不改版本号），汇报实测 vs 代码推断
