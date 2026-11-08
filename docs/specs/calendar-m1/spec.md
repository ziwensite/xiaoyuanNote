# M1 规格：日历只读视图

任务：把已在 M0 落地的日历数据模型接入右侧栏，提供**只读**的议程 / 日 / 周 / 月视图，
点击事件或任务跳回对应笔记。不做新建、编辑、拖拽、勾选（M2）。不改 Rust、不加依赖。

---

## 1. 与设计稿的差异（先说明，不静默改设计）

设计稿 `docs/calendar-pane-plan.md` §7 写于 S1/S2 之前，按 `App.vue` 8 处硬编码描述；
当前外壳已改为 Dock + 单一注册表。本轮适配如下：

| # | 设计稿 | 现状适配 | 理由 |
| --- | --- | --- | --- |
| 1 | `App.vue` 增 `defineAsyncComponent`、`visibleRsPanes`、两处渲染块 | 只在 `SidebarPaneBody.vue` 增一个 async 分支；`App.vue` 只增 `dockPaneVisible.calendar` 与右键菜单一行 | 渲染已由注册表驱动，不再有两处模板 |
| 2 | 新增 `showCalendarPanel` 设置项 | 不新增布尔开关，复用 `sidebarDock.panes[].visible` | S2 已把可见性收敛进 dock 状态，再加一个布尔会产生第二事实源 |
| 3 | `app-menu.ts` / `useCommands.ts` 增命令 | **本轮不做** | 用户范围只要求 `+` 清单与右键菜单；命令面板/菜单栏入口留到外壳收尾 |
| 4 | `PanelHeader` 画标题 | 新面板**不画标题**，标题由 Dock 标签头承担 | S2 的 D4 已落地；`PanelHeader` 只放导航按钮与关闭 |
| 5 | 4 个新图标（calendar/bell/repeat/clock） | 只加 `calendar` | M1 不用 bell/repeat/clock；不提前加死资源 |
| 6 | 议程分组 `今天/明天/本周/以后/未排期` | 增加 `逾期` 分组（位于最前） | 设计稿强调逾期用 `--danger`，但按日期分桶会把 `due < 今天` 的任务挤出窗口；不单独分组就永远看不到逾期 |

### 1.1 新装默认展示：默认**关闭**

注册表原先预留 `defaultVisible: true, defaultActive: true, pending: true`。本轮改为
`defaultVisible: false`（删除 `defaultActive`），理由：

- 现有新装预设由 `defaultSidebarDock()` 决定（`active.right = 'outline'`，右侧默认折叠）。
  `defaultActive` 从未被读取，保留它只会继续制造"文档说有、代码没做"的假契约。
- 新面板在既有安装里通过 `sanitizeSidebarDock` 的补全路径进入；若默认可见，所有老用户
  升级后右侧栏会凭空多出一个只读标签。改默认值属于可见行为变化，用户已要求"不要顺手改"。
- M1 是只读视图，价值密度低于编辑；让用户从 `+` 清单主动打开更符合预期。

### 1.2 M0 索引与跨天展示的冲突

`buildCalendarIndex`（M0）按契约只把事件放在**开始日**（全天事件不展开 DTEND）。
M1 的日/周/月网格需要跨天落位。处理：**不改 M0 函数**，新增
`lib/calendar-view.ts::buildCalendarView`，在窗口前多取 `CALENDAR_LOOKBACK_DAYS = 31`
天的发生实例，再按覆盖日展开。M0 的 `buildCalendarIndex` 保持原语义与测试。

---

## 2. 数据与纯逻辑

### 2.1 新建 `app/src/lib/calendar-view.ts`（纯函数，无 Vue / Tauri）

复用 `lib/calendar.ts` 的 `calendarEventFromEntry`、`calendarTasksFromEntry`、
`expandOccurrences`、`addDays`、`dayOfWeek`、`canonicalWall`；复用 `lib/tasks.ts` 的
`isOverdue`。

```ts
export type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month';

export const CALENDAR_VIEW_MIN_WIDTH: Record<CalendarViewMode, number> = {
  agenda: 0, day: 320, week: 420, month: 360,
};
export function supportsCalendarView(mode, width): boolean;
export function resolveCalendarViewMode(mode, width): CalendarViewMode; // 不支持则降级

export interface CalendarTimedBlock {
  occurrence: CalendarOccurrence;
  startMinutes: number;   // 相对当日 00:00，[0, 1440]
  endMinutes: number;
  column: number;
  columns: number;
}
export interface CalendarViewDay {
  date: string;           // YYYY-MM-DD
  allDay: CalendarOccurrence[];   // 全天 / 跨天（非开始日）
  timed: CalendarTimedBlock[];    // 当日可见的定时块，已分列
  tasks: CalendarTask[];
}
export interface CalendarViewData {
  days: CalendarViewDay[];
  undatedTasks: CalendarTask[];
}

export function occurrenceDays(occ: CalendarOccurrence): string[];
export function buildCalendarView(entries: CalendarEntry[], window: CalendarWindow): CalendarViewData;
export function monthGridRange(cursor: string): string[];   // 42 天，周一起
export function weekRange(cursor: string): string[];        // 7 天，周一起
export function isCalendarTaskOverdue(task: CalendarTask, today: string): boolean;

export type AgendaGroupKey = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'undated';
export interface AgendaDay { date: string; occurrences: CalendarOccurrence[]; tasks: CalendarTask[]; }
export interface AgendaGroup { key: AgendaGroupKey; days: AgendaDay[]; undatedTasks: CalendarTask[]; }
export function buildAgendaGroups(view: CalendarViewData, today: string): AgendaGroup[];
```

规则（全部可单测）：

- **全天事件**：`DTEND` 排他，覆盖 `[start, end)`；缺 `end` 时由 M0 补 `start + 1`。
- **定时事件**：同日开始即覆盖当日；跨午夜按 `end` 的日期与时刻判断，`00:00` 结束不占次日。
- **多日事件落位**：每一天都进入该日 bucket；议程只在 `max(开始日, 窗口首日)` 锚点出现一次。
- **重叠分列**：只对「当日开始的定时事件」分列；贪心簇分配最小列数，非重叠事件复用列 0。
- **窗口前置**：`buildCalendarView` 用 `addDays(from, -31)` 作展开起点，避免跨天事件从窗口外丢失。
- **宽度**：`<320px` 只保留议程；`320–359` 议程/日；`360–419` 再开放月；`>=420` 再开放周。
  请求的视图在变窄后不支持时：周 → 月（>=360）→ 日（>=320）→ 议程；月 → 日 → 议程。
- **逾期**：`!done && due !== null && due < today`（复用 `isOverdue`）。
- **无日期任务**：只进 `undatedTasks` 与 `undated` 分组，不进入任何日期 bucket。

### 2.2 新建 `app/src/components/CalendarPanel.vue`

- 根 `.calendar-panel.rp`；`PanelHeader` **不传 `title`**，slot 放 ‹ / 今天 / ›，`@close` 照旧。
- `SegControl` 只渲染当前宽度支持的视图（`supportsCalendarView`），默认 `agenda`。
- 宽度：`ResizeObserver` 读根元素内容宽度；变化时重新计算 `resolveCalendarViewMode`。
  **不注册全局监听、不建定时器**；`ResizeObserver` 在 `onBeforeUnmount` 断开。
- 数据：`useWorkspaceIndexStore().entries` → `buildCalendarView` 的 `computed`；无 folder
  时显示 `calendar.openFolder`。
- 窗口：议程 `cursor-7 … cursor+32`；日 `cursor…+1`；周 `weekRange`；月 `monthGridRange`。
- 交互：导航 ‹/› 按视图步进（日 ±1、周 ±7、月 ±1 月、议程 ±7 天）；「今天」回到今天。
- 事件行：`--accent` 2px 竖条 + 时间 + 标题；全天显示 `calendar.allDay`。
- 任务行：复选框样式（只读）+ 标题 + 日期 chip；逾期 chip 用 `--danger`；完成删除线 + `--text-3`。
- 点击事件：`files.openPath(path, { bypassNewWindow: true })`。
- 点击任务：同上，再按 `TasksPanel.vue` 的 120ms `solomd:outline-goto` 跳到行。
- 月视图：7×6 网格，每格最多 3 条，超出 `calendar.more`；点格子 → 议程定位到该日。
- 周视图：7 列，每列日期头 + 最多 3 条 + `+N`；点列头 → 切到日视图。
- 日视图：顶部全天泳道 + 24 小时行；定时块按分列结果绝对定位。
- 样式只用 token；不写 hex / 阴影；数字 `font-variant-numeric: tabular-nums`。

### 2.3 新建 `app/src/lib/calendar-view.test.ts`

覆盖：宽度阈值 319/320/359/360/419/420 与四种请求视图的降级；全天排他性；跨午夜；
跨天多日展开与议程锚点；重叠 2 列 / 3 列 / 复用列；逾期（昨天、今天、已完成）；
无日期分组；窗口前置；`monthGridRange`/`weekRange` 长度与起点。

---

## 3. 接入点（精确改动）

| 文件 | 改动 |
| --- | --- |
| `app/src/panes/sidebar-panes.ts` | `calendar` 去掉 `pending` / `defaultActive`，`defaultVisible: false`，`available: (ctx) => ctx.hasFolder`；更新注释 |
| `app/src/components/sidebar/SidebarPaneBody.vue` | 新增 `CalendarPanel` async 组件与 `id === 'calendar'` 分支（`@close`） |
| `app/src/App.vue` | `dockPaneVisible` 增 `calendar`；`sidebar-ctx` 菜单在 `agent` 前加一行 `settings.toggleCalendarPanel()` |
| `app/src/stores/settings.ts` | 增 `toggleCalendarPanel()` → `this.toggleDockPane('calendar')`（紧随 `toggleAgentPanel`） |
| `app/src/components/Icons.vue` | 增 `calendar`：`<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>` |
| `app/src/i18n/en.ts` + 其余 14 个 locale | 增顶层 `calendar` 块（见 §4）；`en.ts` 是 `I18n` 类型源 |
| `app/src/lib/app-menu.test.ts` | 把「calendar 必须 pending」改为「calendar 已实现但本轮不进菜单」 |
| `app/src/lib/sidebar-dock.test.ts` | 新装/迁移断言改为 `calendar.visible === false`；locale 测试补 `calendar.*` 键 |

**不改**：`app-menu.ts`、`useCommands.ts`、任何 Rust 文件、`package.json`。

---

## 4. i18n 键（`en.ts` 为类型源）

```ts
calendar: {
  openFolder: 'Open a folder to see the calendar.',
  empty: 'Nothing scheduled.',
  today: 'Today',
  allDay: 'All day',
  undated: 'Unscheduled',
  more: '+{count} more',
  prev: 'Previous',
  next: 'Next',
  view: { agenda: 'Agenda', day: 'Day', week: 'Week', month: 'Month' },
  groups: {
    overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow',
    thisWeek: 'This week', later: 'Later',
  },
},
```

其余 14 个 locale 同步补齐（翻译即可；`zh` 与 `en` 必须完整，其余允许英文兜底但本轮全部写本地语言）。

---

## 5. 验证

```powershell
$env:Path = 'C:\Program Files\nodejs;C:\Users\yl.song\AppData\Roaming\npm;C:\Program Files\Git\bin;' + $env:Path
cd app
pnpm test
pnpm build   # vue-tsc --noEmit && vite build
```

- 记录 `pnpm test` 的 tests / pass / fail 数字。
- `pnpm build` 必须 0 类型错误（含 `I18n` 漏键、`ImplementedSidebarPaneId` 联合类型扩展）。
- 不跑 cargo（本轮不动 Rust），不引入依赖，不 push，不改版本号。
- 完成后一个提交，并在汇报中给出「已实测 / 仅代码推断」两栏的人工目视清单。

---

## 6. 需要批准

请确认：

1. 新装默认**不展示**日历（§1.1）；
2. 本轮**不加**菜单栏 / 命令面板入口（§1 表 #3）；
3. 宽度阈值 `320 / 360 / 420`（§2.1）；
4. 议程新增「逾期」分组（§1 表 #6）。

批准后按 `docs/specs/calendar-m1/tasks.md` 顺序执行。
