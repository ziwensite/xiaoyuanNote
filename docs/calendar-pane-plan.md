# 日历 + 任务内置 pane 设计方案

> 决策前提：**不做插件系统**。日历作为内置、可开关的右侧栏 pane，沿用现有 pane 机制。
> 本文只做设计与论证，不含实现代码。
> 相关现状：[docs/v5-ui-spec.md](v5-ui-spec.md)、[docs/roadmap.md](roadmap.md)。

---

## 1. 现状核实（先确认能复用什么）

| 能力 | 现状 | 结论 |
|---|---|---|
| 待办解析 | Rust：`workspace_index::extract_tasks` 扫 `- [ ] / - [x]`，跳过 frontmatter 与 fenced code；结果在 `IndexEntry.tasks`（`workspace_index.rs` L33-L45、L1159-L1200） | **直接复用** |
| 待办语义 | 前端 `lib/tasks.ts`：优先级 `⏫🔼🔽` / `[#A]` / `!!`，日期 `📅 YYYY-MM-DD` / `due:`；`localDateKey`、`isOverdue`、`compareTasks`、`toggleTaskLine` | **直接复用并扩展** |
| `list_tasks` | 只存在于 **MCP sidecar**（`mcp-server/src/tools.rs` L559-L593）；App 内 `agent_tools` 的 11 个工具里**没有**它（`agent_tools.rs` L134-L145） | pane **不走 MCP**，走本地索引；`list_tasks` 仅在将来做 MCP 对等时复用解析逻辑 |
| frontmatter 日期 | `workspace_index` 已把 frontmatter 解析为 JSON（`IndexEntry.frontmatter`）；`lib/bases.ts` 能识别 ISO 日期列并做 `before/after/on/inLast` 过滤 | **直接复用** |
| 面板框架 | `PanelHeader`（36px，`rp-head`/`rp-title`/`rp-icon-btn`）、`SegControl`、`panels.css` 的 `rp-body/rp-row/rp-check/rp-empty/rp-btn` | **直接复用** |
| 面板注册 | `App.vue` `visibleRsPanes` + 左右两处 `v-if`；`settings.showXxx` / `rsPaneOrder`；`ctxToggle` 协调显隐 | **按清单扩展** |
| 定时器 | `recipe_runner::spawn_cron_loop`（L1637-L1697）：单 tokio 循环，≤60s 醒一次，只跑 `schedule` recipe（每次触发=一次模型调用） | **可复用骨架，不复用语义**（提醒不应变成模型调用） |
| 通知 | 只有 `stores/pomodoro.ts::fireNotification`（L140-L152）用 Web Notification API；`Cargo.toml` **没有** `tauri-plugin-notification` | MVP 复用 Web Notification；系统级通知需新增依赖（决策点） |
| 日历/CalDAV | 全仓无实现；无 `rrule`/`ical`/`caldav` 依赖 | 需新建（纯前端视图 + 少量 Rust 调度） |

**结论**：M0–M2（模型 + 只读视图 + 编辑）**不需要改 Rust**。M3 提醒才需要新增调度模块。

---

## 2. 数据落点论证（必须先拍板）

### 2.1 三个候选

| 维度 | (A) 事件写进笔记 frontmatter，日历=索引视图 | (B) 独立 `.solomd/calendar.ics` 为主 | (A') 一事件一笔记（frontmatter）+ `.ics` 仅交换 |
|---|---|---|---|
| 事实源 | `.md`（与现有架构一致） | `.ics`（应用私有） | `.md`（与现有架构一致） |
| 解析/索引 | 复用 `workspace_index`，零新扫描 | 需新增 ICS 解析器 + 索引 + watcher | 复用 `workspace_index` |
| 离线 | 原生支持 | 原生支持 | 原生支持 |
| Git 提交 | 普通 md，行级 diff | 单个大文件，VEVENT 块穿插，冲突难解 | 一文件一事件，冲突面最小 |
| 多设备同步 | 走现有 GitHub/WebDAV/云盘同步，冲突=文件级 | 单文件并发写极易冲突/整文件丢失 | 文件级冲突，可做到「冲突副本」不静默覆盖 |
| 重复事件 | frontmatter 数组可表达，但多事件同文件易冲突 | iCal 原生 RRULE/EXDATE | iCal 原生语义，主事件+例外分文件 |
| 可移植性 | 其他编辑器可读，但 schema 是自定义 | 标准 iCal，可直接导入 Outlook/iOS/Google | md 可读 + 可导出标准 iCal |
| 用户可见性 | 散落在各笔记里，不易发现 | 不可手改，依赖应用 | 独立文件夹，可读可改 |
| 与任务关系 | 任务在同文件正文，天然关联 | 任务在 md、事件在 ics，两套模型 | 任务在正文，事件在事件笔记，`related_note` 关联 |

### 2.2 推荐：**A'（md 为唯一事实源，一事件一笔记；`.ics` 只做导入/导出）**

理由：
1. **符合核心事实源**：应用的一切检索/同步/Git/冲突都建立在 `.md` 文件上；引入 `.ics` 作为主存储等于在架构里再开一条并行链路。
2. **冲突可控**：一事件一文件，两台设备改同一事件才会冲突；而不是一个 `calendar.ics` 里几十个 VEVENT 互相污染。`patchFrontmatter`（`lib/frontmatter.ts`）是**文本级补丁**：只重写被指定的键所占据的行，其余 frontmatter（注释、键序、引号、CRLF）与正文逐字节不变，diff 干净。
3. **互操作不受损**：导出 `.ics` 可完整保留 UID/DTSTART/DTEND/RRULE/EXDATE/VALARM；导入时按 UID 去重。CalDAV/Graph 只在"同步适配层"出现，不改变本地事实源。
4. **零新增索引成本**：事件笔记就是 md，`workspace_index` 已解析 frontmatter；日历 pane 直接投影内存中的 `entries`。

事件笔记默认落在 **`Calendar/`**（可见文件夹，便于用户理解和迁移；不放 `.solomd/`，避免"应用私有数据"与"用户内容"混在一起）。正文即 `DESCRIPTION`，frontmatter 存结构化字段。

### 2.3 冲突 / 离线 / Git / 同步的具体结论

- **离线**：全部本地文件，无网络依赖；导入导出与 CalDAV 都是可选增量。
- **Git**：事件笔记是普通 md，AutoGit 按文件提交；`Calendar/` 不在默认 `.gitignore` 忽略列表（`git_history.rs` L216-L224 只忽略 `.solomd/` 运行时产物）。
- **多设备**：沿用现有同步（GitHub / WebDAV / 云盘），冲突粒度=文件。策略：**UID 去重 + `SEQUENCE`/`LAST-MODIFIED` 比较 + 冲突副本**（生成 `xxx.conflict-<device>.md` 并 toast 提示），**不静默覆盖**。
- **任务**：继续留在原笔记正文；同步/冲突完全走现有笔记链路，不引入第二套。

---

## 3. 数据模型

### 3.1 事件（`type: event` 的 md 笔记）

```yaml
---
type: event
uid: 8f14e45f-ea0c-4d3b-9f46-1a2b3c4d5e6f   # UUID v4，生成后永不变
dtstamp: 2026-11-07T01:30:00Z               # 最后修改时间（UTC）
dtstart: 2026-11-07T09:00:00                # 本地墙钟时间；全天事件写 2026-11-07
dtend: 2026-11-07T10:00:00
tzid: Asia/Shanghai                          # 全天事件省略
all_day: false
summary: 周会
location: 会议室 A
status: CONFIRMED                            # CONFIRMED / TENTATIVE / CANCELLED
categories: [工作]
rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=10"        # 原始 iCal RRULE；无重复则省略
exdate: ["2026-11-14T09:00:00"]              # 例外日期
series_uid: null                             # 例外实例指向主事件 UID
recurrence_id: null                          # 例外实例的原定开始时间
alarms:
  - trigger: -PT15M                          # 相对偏移或绝对时间
    action: DISPLAY
related_note: "[[项目 A]]"                   # 可选：关联笔记
source: local                                # local | caldav | graph（预留）
remote_href: null                            # CalDAV URL / Graph event id（预留）
etag: null                                   # 同步版本（预留）
sequence: 0                                  # iCal SEQUENCE（预留）
---
正文 = 事件备注（映射 DESCRIPTION）
```

设计要点：
- **UID 永不改**：改期只改 `dtstart/dtend`，保证外部系统能对上。
- **时区**：存「本地墙钟 + `tzid`」，编辑时不丢用户输入；渲染用 `Intl` 转换。全天事件用 `YYYY-MM-DD`，`dtend` 按 iCal 语义为**排他**日期（次日）。
- **重复**：主事件持 `rrule`；每次例外（只改这一次）生成独立笔记，带 `series_uid` + `recurrence_id`。删除「此后」= 给主事件加 `UNTIL` 或拆出新主事件（M3 决策）。
- **提醒**：`alarms[].trigger` 直接存 iCal 写法（`-PT15M`、`-PT1H`、绝对 ISO）；调度时由前端展开成绝对时刻推给 Rust。

### 3.2 任务（继续留在正文，向后兼容扩展）

现有行：

```md
- [ ] 交周报 ⏫ 📅 2026-11-10
```

新增**可选**内联 token（老笔记不受影响）：

| token | 含义 | iCal VTODO 映射 |
|---|---|---|
| `🆔 <uuid>` | 稳定 ID（首次设提醒时自动追加） | `UID` |
| `⏰ -PT15M` 或 `⏰ 09:00` | 提醒 | `VALARM` |
| `🔁 FREQ=WEEKLY;BYDAY=FR` | 重复 | `RRULE` |
| `📅`/`due:`（已有） | 截止日 | `DUE` |
| `⏫🔼🔽` / `[#A]` / `!!`（已有） | 优先级 | `PRIORITY`（高=1/中=5/低=9） |
| `[x]`（已有） | 完成 | `STATUS:COMPLETED` + `COMPLETED` |

解析扩展只动 `lib/tasks.ts`，保持「一个语法只定义一次」的现有约定。

### 3.3 iCal 字段映射（预留位已按此落地）

| 本地 frontmatter | iCal | 说明 |
|---|---|---|
| `uid` | `UID` | 必填、全局唯一 |
| `dtstamp` | `DTSTAMP` | UTC |
| `dtstart` + `tzid` | `DTSTART;TZID=…` | 全天：`DTSTART;VALUE=DATE` |
| `dtend` | `DTEND` | 全天为排他日期 |
| `all_day` | `VALUE=DATE` | 派生字段 |
| `summary` | `SUMMARY` | 标题 |
| 正文 | `DESCRIPTION` | 逐字节保留 |
| `location` | `LOCATION` | |
| `categories` | `CATEGORIES` | 逗号分隔 |
| `status` | `STATUS` | CONFIRMED/TENTATIVE/CANCELLED |
| `rrule` | `RRULE` | 原样存取 |
| `exdate` | `EXDATE` | 多个日期 |
| `recurrence_id` + `series_uid` | `RECURRENCE-ID` + 主 UID | 例外实例 |
| `alarms` | `VALARM` | `ACTION:DISPLAY` + `TRIGGER` |
| `related_note` | `RELATED-TO` / `URL` | 自定义扩展 |
| `sequence` | `SEQUENCE` | 同步递增（预留） |
| `source` / `remote_href` / `etag` | —（CalDAV 私有） | 同步元数据（预留） |

### 3.4 Microsoft Graph / iOS / Android 映射（预留）

| 本地 | Graph 事件 | Graph To Do | iOS (EKEvent/Reminder) | Android CalendarContract |
|---|---|---|---|---|
| `summary` | `subject` | `title` | `title` | `TITLE` |
| 正文 | `body.content`（text/HTML） | `body.content` | `notes` | `DESCRIPTION` |
| `dtstart`/`dtend`/`tzid` | `start.dateTime`/`start.timeZone`、`end.*` | `dueDateTime` | `startDate`/`endDate`/`timeZone` | `DTSTART`/`DTEND` + `EVENT_TIMEZONE` |
| `all_day` | `isAllDay` | — | `isAllDay` | `ALL_DAY` |
| `rrule` | `recurrence.pattern` + `range` | `recurrence` | `recurrenceRules` | `RRULE` |
| `exdate` | `recurrence.range` / 例外实例 | — | `exceptionDates` | `RDATE`/`EXDATE` |
| `recurrence_id` | `type=exception/occurrence` + `originalStart` | — | `recurrenceRule` + 例外 | `ORIGINAL_ID` |
| `series_uid` | `seriesMasterId` | — | `calendarItemExternalIdentifier` | — |
| `uid` | `iCalUId` | — | `calendarItemIdentifier` | `UID_2445` |
| `alarms` | `isReminderOn` + `reminderMinutesBeforeStart` | `reminderDateTime` | `alarms` | `HAS_ALARM` + `REMINDERS` |
| `categories` | `categories` | `categories` | — | — |
| `status/showAs` | `showAs`（free/busy） | `status`（completed） | `availability` | `AVAILABILITY`/`STATUS` |
| 优先级 | —（`importance` 仅邮件） | `importance` | `priority` | `PRIORITY` |
| 完成 | — | `completedDateTime` | `completed` | — |
| 同步版本 | `@odata.etag` / `changeKey` | `@odata.etag` | `lastModifiedDate` | `LAST_MODIFIED` |

> 这些字段**不在 v1 全部实现**，但 frontmatter 已按此形状预留，后续接 Graph/CalDAV 不需要改本地模型。

---

## 4. 信息架构与视图

### 4.1 Pane 结构

```
┌ PanelHeader  日历 [今日 N]        ＋  ·  ‹ 今天 ›  ┐
│ SegControl   议程 | 日 | 周 | 月                    │
│ Filter       全部 | 事件 | 任务       仅未完成       │
├────────────────────────────────────────────────────┤
│ 今天 · 11月7日                                      │
│  ▢ 交周报            📅 今天        ⏰ 09:00        │  ← 任务
│  ▉ 09:00 周会        会议室 A                      │  ← 事件
│  ...                                                │
│ 明天 · 11月8日                                      │
│  ...                                                │
└────────────────────────────────────────────────────┘
```

- 默认视图：**议程**（右侧栏窄，议程最可用）；宽度 ≥ 360px 时月视图才展开网格；< 320px 自动降级为议程。
- 实体共存：**任务**（来自 `IndexEntry.tasks`）与**事件**（来自 `frontmatter.type === 'event'`）在同一条时间线上排序；用形状区分，不用新色：
  - 事件：`--accent` 左侧 2px 竖条 + 时间；
  - 任务：`rp-check` 复选框 + 截止日 chip；逾期用 `--danger`；完成用删除线 + `--text-3`（与 `TasksPanel` 完全一致）；
  - 无日期任务归入「未排期」分组，不落网格。
- 分组（议程）：`今天 / 明天 / 本周 / 以后 / 未排期`；每组用 `.rp-section` 小标题（复用 TasksPanel 的按文件分组样式改为按日期）。

### 4.2 日 / 周 / 月

- **日**：00–23 小时行 + 顶部「全天」条；窄栏时事件块只显示时间+标题，点击弹详情。
- **周**：7 列 × 24 行压缩网格；列宽 ≥ 44px 时显示事件块，否则显示「点阵 + 当日数量」，点击列头切到日视图。
- **月**：7×5/6 网格；每格最多 3 条（事件条 + 任务点），更多显示 `+N`；点击某天 → 议程定位到该天。
- 所有视图共用同一 `CalendarDay` 数据投影（`lib/calendar.ts` 纯函数，可单测）。

---

## 5. 关键交互

| 交互 | 设计 |
|---|---|
| 新建事件 | Header `＋`；或点月/日空白格。pane 内联 composer：标题 + 日期 + 时间 + 全天开关 + 「任务/事件」切换；`Enter` 保存，`Esc` 取消；「更多」打开事件笔记做详细编辑。 |
| 新建任务 | composer 切到「任务」→ 在当前打开的笔记末尾插入 `- [ ] … 📅 …`；无打开笔记时提示先选笔记。 |
| 拖拽改期 | Pointer 事件（沿用 pane reorder 的 pointer 模式）；拖到日格/时段松手 → `patchFrontmatter` 只改 `dtstart/dtend`，保持时长与 `tzid`；日/周视图 15 分钟吸附；键盘 `Alt+←/→` 改日期、`Alt+↑/↓` 改时间。 |
| 全天事件 | 顶部「全天」泳道；把定时事件拖入泳道 → `all_day: true`、`dtstart` 变日期、`dtend` 次日；反向拖出恢复时间。 |
| 重复事件 | 编辑器预设：每天 / 每周 / 每工作日 / 每月 / 每年 / 自定义 RRULE。编辑/删除时询问范围：`仅此` / `此后` / `全部`；`仅此` 生成 `recurrence_id` 例外笔记。 |
| 提醒 | chip：`0 / 5 / 15 / 30 / 60 分钟` + 自定义；写入 `alarms`；任务首次设提醒时自动追加 `🆔`，保证跨设备稳定。 |
| 从笔记建任务 | 编辑器选中文本 → 命令面板「从选中文本创建任务」→ 插入 `- [ ] <选中> 📅 <今天>`；另有「创建日程」→ 生成事件笔记并写 `related_note: [[当前笔记]]`。 |
| 任务跳回笔记 | 点击任务行 → `files.openPath` + `solomd:outline-goto`（复用 `TasksPanel.vue` L73-L84 的 120ms 延时方案）。 |
| 事件详情 | 点击事件 → popover：标题/时间/地点/关联笔记/编辑/删除/「仅此或全部」；「关联笔记」可跳转。 |
| 完成 | 任务复选框写回正文（复用 `useTasks.toggle`）；事件用 `status: CANCELLED`，不删文件。 |

---

## 6. 视觉规范（与主体一致）

- **只消费 token**（`app/src/styles/tokens.css`）：
  - 间距 `--sp-1…--sp-4`；圆角 `--r-sm/--r-md`；动效 `--dur-fast`/`--ease`；
  - 颜色 `--bg` / `--bg-elev` / `--bg-hover` / `--bg-active` / `--border` / `--text` / `--text-muted` / `--text-faint` / `--accent` / `--accent-fg` / `--danger`；
  - **禁止新增 hex、阴影、自定义配色**（`tokens.css` 头部规则）。
- **复用组件与类**：`PanelHeader`（`rp-head/rp-title/rp-icon-btn`）、`SegControl`、`Icons`；列表用 `rp-body/rp-list/rp-row/rp-section/rp-check/rp-empty/rp-btn`（`panels.css`）。
- **对齐现有面板**：标题条参考 `AgentPanel.vue` L468-L505（`rp-head` + `rp-chip` + `rp-icon-btn`）；过滤行参考 `TasksPanel.vue` L91-L108；按文件分组样式改为按日期分组时保留 `.rp-section` 的字号/字重。
- **数值对齐**：日期/时间用 `font-variant-numeric: tabular-nums`（与 `TasksPanel__due` 一致）。
- **图标**：`Icons.vue` 目前没有 calendar/bell/repeat/clock，需要在 `M1` 增加 4 个线性 SVG（`plus`、`chevron-left/right`、`check` 已有）。优先级继续用现有三根竖条（`TasksPanel__bars`），不引入 emoji。
- **主题兼容**：所有颜色来自旧主题变量派生，因此在 Nord/Solarized/GitHub/社区 CSS 主题下自动跟随。

---

## 7. Pane 集成改动清单（8 组）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `app/src/components/CalendarPanel.vue`（新增） + `app/src/lib/calendar.ts`（新增） + `app/src/lib/calendar.test.ts` | 视图 + 纯函数投影/分格/RRULE 展开 |
| 2 | `app/src/App.vue` | L25 附近 `defineAsyncComponent`；`visibleRsPanes` 增加 `calendar`；左右两处渲染块（L2382-L2432、L2449-L2500）；`rsPaneSnapshot`（L245-L256）与 `noPanesVisible`（L262-L272）；右侧栏右键菜单（L2550 附近） |
| 3 | `app/src/stores/settings.ts` | `showCalendarPanel`（L215 类型 / L741 默认 / L1467 区域 toggle）；`rsPaneOrder` 默认数组（L836）插入 `calendar`；`persist()` 覆盖 |
| 4 | `app/src/lib/app-menu.ts` | `panes` 子菜单增加 `view.toggleCalendarPanel`（L407-L423） |
| 5 | `app/src/composables/useCommands.ts` | 命令 `view.toggleCalendarPanel`（L228-L231 附近） |
| 6 | `app/src/lib/app-menu.test.ts` | 命令白名单（L85-L89） |
| 7 | `app/src/i18n/en.ts` + 其余 14 个 locale | `calendar.*`、`menubar.paneCalendar`、`cmd.view.toggleCalendarPanel`；`en.ts` 是类型源，漏 key 会被编译拦住 |
| 8 | `app/src/components/Icons.vue` | `calendar` / `bell` / `repeat` / `clock` 4 个图标 |

> Rust 侧在 M0–M2 **零改动**。M3 提醒新增：`app/src-tauri/src/reminders.rs` + `lib.rs` 的 `pub mod`/`manage`/`spawn` + `runner.rs` 的同名声明与 `generate_handler!`（**双注册，勿漏**）。

### 7.1 关闭时零开销

- `App.vue` 用 `defineAsyncComponent`，**pane 未打开时组件代码根本不会被拉取**。
- 日历投影是 `workspaceIndex.entries` 的**内存 computed**，不做额外磁盘扫描；事件读取的是索引里**已经解析好的 frontmatter**。
- 只有 `showCalendarPanel === true` 时才注册键盘/pointer 监听；提醒调度器在 `reminders_sync` 首次推送前保持空列表（每 60s 一次空检查，可忽略）。
- 事件笔记本身就是普通 md，索引成本与多一篇笔记相同；不会在关闭 pane 时额外跑 RRULE 展开。

---

## 8. 分阶段里程碑

| 阶段 | 交付物 | 验收 | 估时 |
|---|---|---|---|
| **M0 模型与解析** | `lib/calendar.ts`：`CalendarEvent` 类型、frontmatter 读写（复用 `patchFrontmatter`）、`buildDayBuckets`、`expandRrule`（固定窗口）；`lib/tasks.ts` 增加 `🆔/⏰/🔁` 可选解析；单测 | `pnpm test`；导入旧笔记不丢字段；往返序列化字节稳定（正文不变） | 2–3 人日 |
| **M1 只读视图** | `CalendarPanel.vue` 议程 + 月网格；全部 8 组注册；i18n + 4 图标 | `pnpm build`；开关 pane、持久化、菜单/命令面板、窄栏不溢出 | 3 人日 |
| **M2 编辑与拖拽** | 内联 composer、事件详情 popover、拖拽改期、全天、任务勾选/跳转、从选中文本建任务 | 手测：拖拽只改 frontmatter；撤销前正文逐字节不变；跨午夜正确 | 4 人日 |
| **M3 重复 + 提醒** | RRULE 预设与「仅此/此后/全部」、`alarms`、Rust `reminders.rs`、Web Notification | `cargo test --lib`；到点通知；重启后不重复/不丢；snooze | 4–5 人日 |
| **M4 互操作** | `.ics` 导入/导出（UID 去重）、字段映射自检；可选 CalDAV **只读** | 导出的 ics 可被 iOS/Outlook/Google 导入；导入不重复 | 5–8 人日 |
| **M5 外部写回（决策后）** | CalDAV / Microsoft Graph 双向同步 | 冲突副本策略、ETag、增量 | 8–15 人日 |

**M0–M3 合计约 13–15 人日**（含 pane 集成），是「可用的内置日历」最小闭环。

---

## 9. 风险与需要拍板的决策点

### 9.1 需要用户拍板

1. **D1 事件落点**：推荐 `Calendar/` 一事件一 md（可见、可移植）；是否接受"事件会出现在普通笔记列表/搜索"（可后续用 `type: event` 过滤，但会改变现有 Bases/TypeLens 语义）。
2. **D2 互操作范围**：v1 只做 `.ics` 导入导出？还是必须首版就 CalDAV 只读/写回？（写回=8–15 人日 + 认证/冲突工程）
3. **D3 通知级别**：MVP 用 Web Notification（**仅应用运行时有效**）；是否首版就引入 `tauri-plugin-notification` 做系统级/后台通知？（多端权限配置）
4. **D4 冲突策略**：接受"文件级最后写入 + 冲突副本 + toast"？还是要求三方合并/CRDT（成本显著上升）。
5. **D5 重复事件例外**：是否支持「此后」拆分（主事件加 `UNTIL` + 新主事件）；还是 v1 只支持「仅此 / 全部」。
6. **D6 任务提醒写回正文**：首次设提醒时自动追加 `🆔`/`⏰` 会修改用户正文（可撤销），是否接受？
7. **D7 移动端**：`recipe_runner` 在 Android 被 `#[cfg(not(target_os = "android"))]` 门控；提醒是否只在桌面端提供？
8. **D8 事件可见性**：`Calendar/` 是否默认在文件树中隐藏（例如仅在日历 pane 呈现）。

### 9.2 主要风险

- **RRULE 复杂度**：`BYDAY/BYSETPOS/COUNT/UNTIL` 组合与 DST 边界。缓解：用成熟 `rrule` npm 库做展开，Rust 只接收已展开的绝对时刻（不写第二套规则引擎）。
- **时区/DST**：本地墙钟 + `tzid`，跨时区设备显示可能不一致；需在 M0 固定「存储本地时间 + tzid，渲染时用 `Intl`」的约定并加测试。
- **窄栏可用性**：右侧栏默认窄，月/周网格信息密度高；缓解：默认议程、按宽度降级、支持拖宽（已有 pane 分栏器）。
- **索引膨胀**：每事件一文件会让目录/索引规模上升；缓解：`Calendar/` 可按年/月子目录；`calendar` pane 只投影 `type: event`。
- **双注册漂移**：M3 若新增命令，必须在 `lib.rs` 与 `runner.rs` 两处 `generate_handler!` 同步；建议在 `docs/regression-checklist.md` 加一条检查。
- **与 MCP 的模型漂移**：MCP 的 `list_tasks` 与 App 内 `IndexEntry.tasks` 是两套实现；本方案不依赖 MCP，但后续若要"任务字段口径一致"，需抽共享解析（建议列为后续技术债）。

---

## 10. 结论

- **可行且低成本**：任务数据、日期解析、面板框架、i18n、持久化都已存在，M0–M2 不需要 Rust。
- **推荐数据模型**：md 为唯一事实源；任务留在正文；事件一事件一笔记（`Calendar/`，frontmatter 结构化）；`.ics` 作为交换格式。
- **最小闭环**：议程 + 月视图 + 新建/拖拽/完成 + 点回笔记（M0–M2，约 9 人日）；再加重复与提醒（M3，约 4–5 人日）。
- **最大不确定性**：外部双向同步（CalDAV/Graph）与系统级通知——这两项应作为独立决策，不阻塞内置日历上线。
