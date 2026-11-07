# 日历 + 任务：标准口径与交互惯例核对（设计评审版）

> **范围**：只做标准与产品文档核对，不含实现方案与产品代码。
>
> **核验等级**（全文统一使用）：
> - **A** = 标准原文 / 官方 API 文档
> - **B** = 官方产品帮助文档（描述用户可见行为）
> - **C** = 产品观察或社区资料（非官方）
> - **D** = 推测，**必须实机核对后才能进设计**
>
> **核对日期**：2026-11-07

---

## 0. 结论先行

1. **事件与任务必须是两种组件，不能用"带截止时间的事件"近似任务。** VTODO 的 `STATUS` / `PERCENT-COMPLETE` / `PRIORITY` / `DUE` 语义在 VEVENT 上无处安放；Graph 侧同样是两套资源（`event` / `todoTask`）。
2. **"不支持就无法互通"的 iCal 字段只有 8 组**：`UID`、`DTSTAMP`、`DTSTART`、`DTEND` 或 `DURATION`、`SUMMARY`、`RRULE`/`EXDATE`/`RECURRENCE-ID`、`VALARM` 的 `ACTION`+`TRIGGER`、VTODO 的 `DUE`/`STATUS`/`COMPLETED`。其余字段可以"读入原样保留、不解释"。
3. **全天事件的结束时间是"非包含"的**：单日全天事件是 `DTSTART;VALUE=DATE:20261107` + `DTEND;VALUE=DATE:20261108`。这是跨产品最容易错一天的位置。
4. **时区有三种形态**（UTC / 带 `TZID` 的本地时间 / 浮动时间），必须原样保留。Graph 没有"浮动时间"概念，`start`/`end` 必须带 `timeZone`。
5. **重复事件不是"一个对象"，而是 series master + exception 的集合**；单次例外用 `RECURRENCE-ID` 指向**原始**开始时间，而不是改后的时间。
6. **CalDAV 增量同步优先用 `sync-token`（RFC 6578）**；`ctag` **不在 RFC 4791 正文里**，是 Apple/CalConnect 的扩展约定，只能做"集合是否变化"的粗判。
7. **冲突用 ETag + `If-Match`，失败返回 412**。客户端必须能"412 → 重拉 → 字段级合并"，不能盲目覆盖。
8. **Graph 的 `timeZone` 默认是 Windows 时区名**（如 `China Standard Time`），与 IANA 名称需要映射；Graph 的 recurrence 是结构化模型而非 RRULE，**双向转换有损**。
9. **交互上真正跨产品一致的只有 6 条**（见 3.1）；分歧集中在默认视图、周起始日、颜色归属、任务是否占时间块。
10. **对笔记应用的硬约束**：`UID` 与同步状态（ETag / sync-token / 远端 id）**不能存在笔记正文里**，必须有 sidecar 索引；否则一次 Markdown 重排就会破坏同步身份。

---

## 1. iCal / RFC 5545 字段口径

### 1.1 组件边界（先定模型，再定字段）

| 结构 | 规范事实 | 对建模的含义 |
|---|---|---|
| `VCALENDAR` | 顶层容器，一个 `.ics` 流一个 | CalDAV 中一个资源 = 一个 `VCALENDAR` |
| `VEVENT` | 不可嵌套于其他组件（§3.6.1） | 事件 = 独立对象 |
| `VTODO` | 不可嵌套（§3.6.2） | 任务 = 独立对象，**不是**事件的子类型 |
| `VALARM` | **只能**出现在 `VEVENT` / `VTODO` 内，可多个且互相独立（§3.6.6） | 提醒是事件的从属子结构，不是独立实体 |
| `RECURRENCE-ID` | 与 `UID` + `SEQUENCE` 联合定位"重复集合中的某一次"（§3.8.4.4） | 例外实例是**同一 UID 下的另一个组件** |
| `RELATED-TO` | 可把 VEVENT / VTODO / VJOURNAL 互相关联（§3.6.1、§3.6.2） | 标准里唯一的"任务挂事件"手段，但语义弱，不要当外键用 |

**CalDAV 的额外约束**：同一 calendar collection 内 `UID` 必须唯一（RFC 4791 第 4 章，calendar object resource 要求）。也就是说"UID 唯一性"是集合级属性，不是文件级。

### 1.2 VEVENT 核心字段

| 字段 | 规范要求（§3.6.1） | 语义要点 | 互通级别 |
|---|---|---|---|
| `UID` | **REQUIRED**，≤255 octets，全局唯一、持久不变 | 跨系统身份的唯一锚点；改 UID = 新建对象 | **必须** |
| `DTSTAMP` | **REQUIRED**，必须是 UTC | 组件创建/修订时间戳，用于调度与去重 | **必须** |
| `DTSTART` | 无 `METHOD` 时 REQUIRED；单次 | 含起始边界；重复事件的"第一个实例" | **必须** |
| `DTEND` / `DURATION` | 二选一，**不可同时出现** | `DTEND` = 非包含结束；`DURATION` = 正的时长 | **必须**（至少其一可解析） |
| `SUMMARY` | OPTIONAL | 标题；纯文本，不是 HTML | **必须**（否则列表无内容可显示） |
| `SEQUENCE` | OPTIONAL，整数 | 修订序号；调度冲突判定的依据之一 | 建议支持 |
| `STATUS` | OPTIONAL：`TENTATIVE`/`CONFIRMED`/`CANCELLED` | 事件状态；取消 ≠ 删除 | 建议支持 |
| `TRANSP` | OPTIONAL：`OPAQUE`/`TRANSPARENT` | 是否占用忙碌时间 | 常见 |
| `CLASS` | OPTIONAL：`PUBLIC`/`PRIVATE`/`CONFIDENTIAL` | 可见性/私密性 | 常见 |
| `RRULE` | OPTIONAL，SHOULD 只出现一次 | 重复规则 | **必须**（否则重复事件全丢） |
| `EXDATE` / `RDATE` | OPTIONAL，可多次 | 排除/追加实例 | 建议支持 |
| `RECURRENCE-ID` | OPTIONAL | 单次例外定位 | **必须**（否则"改某一次"无法表达） |
| `VALARM` | OPTIONAL，可多个 | 提醒 | **必须**（至少能读写一条） |
| `CATEGORIES` | OPTIONAL，可多次，逗号分隔 TEXT | 分类是**文本标签**，不是外键 | 常见 |
| `LOCATION` / `DESCRIPTION` / `URL` | OPTIONAL | 描述是纯文本，不保证 HTML | 常见 |
| `ORGANIZER` / `ATTENDEE` | OPTIONAL | 会议语义，依赖 CalDAV 调度（RFC 6638） | 低优先 |
| `ATTACH` | OPTIONAL，可多次 | 附件；`VALUE=BINARY` 与 URL 两种 | 低优先 |

### 1.3 VTODO 核心字段

| 字段 | 规范要求（§3.6.2） | 语义要点 | 互通级别 |
|---|---|---|---|
| `UID` | **REQUIRED** | 同事件 | **必须** |
| `DTSTAMP` | **REQUIRED**，UTC | 同事件 | **必须** |
| `DUE` / `DURATION` | 二选一；用 `DURATION` 时**必须**同时有 `DTSTART` | 截止时间 | **必须**（或 `DTSTART`+`DURATION`） |
| `DTSTART` | OPTIONAL | 任务是"开始时间"，不是截止时间 | 常见 |
| `COMPLETED` | OPTIONAL，必须是 UTC date-time | 完成时刻 | **必须**（否则完成态无法表达） |
| `PERCENT-COMPLETE` | OPTIONAL，0–100 | 进度 | 常见（Graph 无对应） |
| `STATUS` | OPTIONAL：`NEEDS-ACTION` / `COMPLETED` / `IN-PROCESS` / `CANCELLED` | 任务状态机 | **必须** |
| `PRIORITY` | OPTIONAL，0–9，**0 = 未定义，1 = 最高，9 = 最低** | 与 Graph 三档 importance 不对等 | 常见 |
| `RRULE` | OPTIONAL | 重复任务 | 建议支持 |
| `CATEGORIES` | OPTIONAL | 同事件 | 常见 |

**两条容易误读的语义（原文级）**：

- **`DUE` 是"含当天"的截止**：RFC 5545 §3.6.2 示例中 `DUE;VALUE=DATE:20070501` 的注释是"在 2007-05-01 午夜该任务被视为逾期"。即 DATE 类型的 `DUE` 表示"当天结束前完成"，与 `DTEND` 的"非包含"**方向相反**。
- **既无 `DTSTART` 也无 `DUE` 的 VTODO 不是"无日期任务"**：规范说它"与随后的每一个日历日期关联，直到完成"。很多客户端会把它渲染成"每天都出现"，如果按"无日期"处理就会与外部客户端表现不一致。

### 1.4 时间模型（最容易出错的四个点）

| 形态 | 写法 | 语义 | 坑 |
|---|---|---|---|
| UTC | `DTSTART:20261107T010000Z` | 绝对时刻 | 展示时按用户时区换算 |
| 带时区 | `DTSTART;TZID=Asia/Shanghai:20261107T090000` | 本地墙钟 + 时区规则 | **必须**在同流中提供 `VTIMEZONE`（§3.6.5）；否则接收方只能猜 |
| 浮动 | `DTSTART:20261107T090000`（无 `Z`、无 `TZID`） | "当地 9 点"，跟随设备时区 | Graph 无法表达；跨时区同步会被"钉死"成某个绝对时刻 |
| 全天 | `DTSTART;VALUE=DATE:20261107` | 日期，无时间无时区 | 有 `DTSTART` 无 `DTEND`/`DURATION` 时**默认 1 天**；DATE 型 `DURATION` 只能是天/周（`P1D`、`P2W`），不能是 `PT1H` |

补充：RFC 7809（CalDAV "Time Zones by Reference"）允许服务端以引用方式提供时区、客户端不必回传完整 `VTIMEZONE`。这是可选优化，不是互通前提。

### 1.5 RRULE：建议支持的子集与"不要碰"的部分

规范：§3.3.10。`FREQ` 必填；`UNTIL` 与 `COUNT` **互斥**；`COUNT` **包含 `DTSTART` 本身**；`WKST` 默认 `MO`。

| 场景 | 推荐表达 | 难度 | 备注 |
|---|---|---|---|
| 每天 | `FREQ=DAILY` | 低 | — |
| 每 N 天 | `FREQ=DAILY;INTERVAL=N` | 低 | — |
| 每周固定星期 | `FREQ=WEEKLY;BYDAY=MO,WE,FR` | 低 | 必须同时存 `WKST`，否则 INTERVAL>1 时序列会偏 |
| 每两周 | `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU` | 中 | `WKST` 影响结果 |
| 每月某日 | `FREQ=MONTHLY;BYMONTHDAY=15` | 中 | 31 日在小月无实例，**必须跳过而不是顺延** |
| 每月第 N 个星期几 | `FREQ=MONTHLY;BYDAY=2TH` 或 `BYDAY=TH;BYSETPOS=2` | 中 | 两种写法等价但客户端偏好不同，回写时保持原样 |
| 每年 | `FREQ=YEARLY` / `FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15` | 中 | 2 月 29 日每年重复会"三年不出现" |
| 工作日 | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` | 低 | 不要用 `FREQ=DAILY;BYDAY=...` 混写 |
| 最后一个工作日 | `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` | 高 | `BYSETPOS` 是 Graph 完全无法表达的 |

**不建议自行生成/解释的部分**（读入后原样保留即可）：`BYYEARDAY`、`BYWEEKNO`、`BYSECOND`/`BYMINUTE`/`BYHOUR`、多层 `BYxxx` 组合、`RSCALE`（RFC 7529 扩展）。

RRULE 的四个已知坑：

1. **`UNTIL` 的时区**：`DTSTART` 带 `TZID` 或为 UTC 时，`UNTIL` **必须**写成 UTC；`DTSTART` 为浮动时间时 `UNTIL` 也必须是浮动。写成"本地时间 + Z"会被严格校验的客户端拒绝。
2. **无效日期必须跳过**：规范明确要求"生成的非法日期（如 2 月 30 日）或不存在的本地时间（夏令时跳过的 1:30）必须被忽略且不计入重复集合"。
3. **夏令时缺口**：本地时间落在 DST 跳变缺口时，不要"顺移一小时"自行发明实例。
4. **`RANGE=THISANDFUTURE`**：规范提供了"从这一次起全部改"的参数，但同时提示它对"周一/周三"这类复杂规则不适用，正确做法是"截断旧规则 + 新建两条规则"。**Graph 不支持 `RANGE`**，同步到 Graph 时只能退化为"拆分序列"。

`EXDATE` 的硬约束：值类型与 `TZID` **必须**与被排除实例的 `DTSTART` 一致；写成 `EXDATE:20261107T090000Z` 去排除一个 `TZID=Asia/Shanghai` 的实例是无效的。

### 1.6 VALARM：提醒的合法形态

`ACTION` 与 `TRIGGER` 都是 **REQUIRED**；`ACTION` 决定还缺哪些字段（§3.6.6）。

| ACTION | 额外必需字段 | 说明 |
|---|---|---|
| `DISPLAY` | `DESCRIPTION` | 最通用，跨端兼容最好 |
| `AUDIO` | 可选 `ATTACH` 指向音频 | 桌面端常见，移动端常忽略 |
| `EMAIL` | `DESCRIPTION` + `SUMMARY` + ≥1 `ATTENDEE` | 服务端代发，消费级客户端少支持 |

`TRIGGER` 的三种形式（§3.8.6.3）：

| 形式 | 写法 | 语义 |
|---|---|---|
| 相对开始（默认） | `TRIGGER:-PT15M` | 开始前 15 分钟；正值表示之后 |
| 相对结束 | `TRIGGER;RELATED=END:-PT5M` | 结束前 5 分钟；要求有 `DTEND`，或 `DTSTART`+`DURATION` |
| 绝对时刻 | `TRIGGER;VALUE=DATE-TIME:20261107T010000Z` | **必须 UTC**；`RELATED` 参数在此形态下**非法** |

两个坑：
- **重复提醒**必须 `DURATION` 与 `REPEAT` **成对**出现，缺一则不重复。
- **绝对触发的提醒挂在重复事件上时，只在那一个绝对时刻触发一次**（原文明确），不会"每次实例都响"。

### 1.7 VTODO 的"状态 / 优先级 / 截止"三件套

| 概念 | iCal | Graph `todoTask` | 差异结论 |
|---|---|---|---|
| 状态 | `STATUS`：`NEEDS-ACTION`/`IN-PROCESS`/`COMPLETED`/`CANCELLED` | `status`：`notStarted`/`inProgress`/`completed`/`waitingOnOthers`/`deferred` | 不是一一对应；`CANCELLED` 无对等值，`waitingOnOthers`/`deferred` 无 iCal 标准值 |
| 完成时间 | `COMPLETED`（UTC） | `completedDateTime`（带时区） | 需做时区归一 |
| 进度 | `PERCENT-COMPLETE` 0–100 | 无 | **同步会丢** |
| 优先级 | `PRIORITY` 0–9（1 最高） | `importance`：`low`/`normal`/`high` | 9 档压成 3 档，**有损**；业界常见映射为 1–4→high、5→normal、6–9→low、0→normal（**C，非规范**） |
| 截止 | `DUE`（含当天） | `dueDateTime` | 全天任务在 Graph 侧是"当日 00:00 + 时区"，回写 iCal 时不要丢掉 DATE 语义 |

### 1.8 最小互通字段集（可直接作为验收清单）

**MUST（缺失即判定不互通）**
- 事件：`UID` / `DTSTAMP` / `DTSTART` / (`DTEND` 或 `DURATION`) / `SUMMARY`
- 重复：`RRULE` + `EXDATE` + `RECURRENCE-ID`
- 提醒：`VALARM` 至少一条 `ACTION:DISPLAY` + `TRIGGER:-PTnM`
- 任务：`UID` / `DTSTAMP` / `DUE` / `STATUS` / `COMPLETED`
- 编码层：CRLF 行结束、75 octets 折行、TEXT 转义（`\\` `\;` `\,` `\n`）
- 时区：能保留并回写 `TZID` 与对应 `VTIMEZONE`

**SHOULD（影响体验但可降级）**
- `SEQUENCE`、`LAST-MODIFIED`、`CLASS`、`TRANSP`、`CATEGORIES`、`LOCATION`、`PRIORITY`、`PERCENT-COMPLETE`

**可安全忽略**：`ATTACH`、`ORGANIZER`/`ATTENDEE`（无调度能力时）、`GEO`、`RESOURCES`、`REQUEST-STATUS`、各类 `X-` 属性。

---

## 2. CalDAV 与 Microsoft Graph 对接要点

### 2.1 CalDAV 增量同步与冲突

| 机制 | 规范来源 | 用途 | 关键注意 |
|---|---|---|---|
| `DAV:sync-collection` + `sync-token` | **RFC 6578** | 拉取"自某 token 以来"的新增/修改/删除 | 这是推荐主路径；token 失效时服务端返回 403 + `DAV:valid-sync-token` 前置条件，客户端**必须**降级为全量重同步 |
| `getctag` | **不是 RFC 4791 正文**；CalConnect 的 CTag 扩展 / Apple `http://calendarserver.org/ns/` 命名空间 | 快速判断"这个日历集合有没有变" | 只能回答"变没变"，不能回答"变了什么"；当作 sync-token 不可用时的降级探测 |
| `ETag` | **RFC 4791 §5.3.4**（Calendar Object Resource Entity Tag） | 单资源版本标识 | 资源内容任何变化都必须导致 ETag 变化；客户端不得假设 ETag 可跨集合复用 |
| `If-Match` / `If-None-Match` | RFC 4918（WebDAV）第 10 章 | 乐观并发：条件更新 / 条件创建 | 失败返回 **412**；`If-None-Match: *` 用于"不存在才创建" |
| `calendar-query` REPORT | RFC 4791 §7.8 | 按时间区间、组件类型过滤 | 时间区间查询要用 **UTC 区间**，避免时区边界漏取 |
| `calendar-multiget` REPORT | RFC 4791 §7.9 | 按 href 批量取资源 | 增量时用它替代 N 次 GET |
| `MKCALENDAR` / `PROPFIND(calendar-home-set)` | RFC 4791 §5.3.1 / §6.2.1 | 发现与建集合 | 支持 `supported-calendar-component-set` 探测是否接受 VTODO |
| 调度（邀请/回复） | RFC 6638 | 会议邀请 | 多数消费级 CalDAV 服务不支持；**不要把它列为产品核心能力** |

**推荐的冲突处理流程**（与 ETag 语义对齐）：

1. 本地保存 `baseETag` 与 `basePayload`（上次同步成功时的原始正文）。
2. 写入用 `PUT` + `If-Match: <baseETag>`。
3. 收到 **412** → 立即 `GET` 远端最新，得到 `remotePayload` + 新 `ETag`。
4. 做**字段级三方合并**（base / local / remote）：标题、正文、时间、提醒各自独立判断；只有同字段双方都改才算真冲突。
5. 真冲突时**生成副本**（新 `UID` + "冲突副本"后缀）而不是覆盖；同时递增 `SEQUENCE`。
6. 409/403 区分为"权限/集合不存在"，不要重试成死循环。

**删除的坑**：远端删除不会留下 412，只会从 `sync-token` 的变更列表里以"404 成员"形式出现。本地删除建议先用 tombstone 标记，收到服务器确认后再真正移除，否则离线队列容易复活已删项。

### 2.2 Microsoft Graph `event` 关键字段

| Graph 字段 | 类型/取值 | 语义与坑 | iCal 对应 |
|---|---|---|---|
| `subject` | String | 标题 | `SUMMARY` |
| `body` | `itemBody`（`contentType`: `html`/`text`） | 正文；**HTML 是默认形态** | `DESCRIPTION`（纯文本） |
| `start` / `end` | `dateTimeTimeZone` | `dateTime` 不带偏移，`timeZone` 单独给 | `DTSTART` / `DTEND` |
| `isAllDay` | Boolean | 为 true 时 **start 与 end 必须都是午夜且同一时区** | `VALUE=DATE` |
| `recurrence` | `patternedRecurrence` | 结构化模型，不是 RRULE 字符串 | `RRULE` |
| `isReminderOn` + `reminderMinutesBeforeStart` | Boolean + Int32 | **只有一条、只能相对开始** | 单个 `VALARM` 的 `TRIGGER:-PTnM` |
| `showAs` | `free`/`tentative`/`busy`/`oof`/`workingElsewhere`/`unknown` | 忙碌状态，比 `TRANSP` 更细 | `TRANSP`（free ↔ `TRANSPARENT`） |
| `categories` | String collection | 引用 `outlookCategory.displayName` | `CATEGORIES` |
| `sensitivity` | `normal`/`personal`/`private`/`confidential` | 私密级别 | `CLASS` |
| `location` / `locations` | `location` | 两者联动，改 `location` 会覆盖 `locations` | `LOCATION` |
| `attendees` / `organizer` | 集合 / `recipient` | 会议语义 | `ATTENDEE` / `ORGANIZER` |
| `isCancelled` | Boolean | 取消但未删除 | `STATUS:CANCELLED` |
| `type` | `singleInstance`/`occurrence`/`exception`/`seriesMaster` | **重复模型的核心**：例外是独立 event | 由 `RRULE` + `RECURRENCE-ID` 推断 |
| `seriesMasterId` | String | 指向 master | 同 `UID` |
| `originalStart` | DateTimeOffset（UTC） | **例外的原始开始时间** | `RECURRENCE-ID` 的值 |
| `cancelledOccurrences` | String collection | 仅 master 返回，需 `$select` | `EXDATE` |
| `iCalUId` | String，只读 | 跨日历唯一，但**重复序列的每个实例都不同** | 不能直接当 `UID` 用 |
| `changeKey` | String | 版本号，类似 ETag | — |
| `id` | String | 移动容器后会变；需要稳定标识时用 `Prefer: IdType="ImmutableId"` | — |
| `transactionId` | String | 客户端幂等键，防重试重复创建 | — |

**时区口径（重要）**：Graph 的 `dateTimeTimeZone.timeZone` **默认使用 Windows 时区名**（例如 `China Standard Time`），而不是 IANA。`outlookUser: supportedTimeZones` 可以按需返回 Windows 或 IANA 格式（IANA 需显式指定），但事件资源的常见形态仍是 Windows 名。**跨系统必须内置双向映射表**，并且注意历史遗留值 `tzone://Microsoft/Custom`（`originalStartTimeZone` / `originalEndTimeZone` 会出现）。

**Graph 重复模型的表达能力边界**（`patternedRecurrence` = `pattern` + `range`）：

| 能力 | 支持情况 |
|---|---|
| `type`：`daily`/`weekly`/`absoluteMonthly`/`relativeMonthly`/`absoluteYearly`/`relativeYearly` | 支持 |
| `interval` | 支持 |
| `daysOfWeek` + `index`（first…last） | 支持"每月第 N 个星期几" |
| `firstDayOfWeek` | 支持（仅 weekly 必需） |
| `BYSETPOS` 任意位置（如"最后一个工作日"） | **不可表达** |
| `BYWEEKNO` / `BYYEARDAY` / 多小时/分/秒组合 | **不可表达** |
| `UNTIL` 精确到时间点 | `range.type=endDate` 只有日期粒度 |
| `RANGE=THISANDFUTURE`（本次及以后整体平移） | **不支持**，需拆序列 |
| 浮动时间 | **不支持** |

### 2.3 Outlook 任务（To Do）一侧的模型差异

| 维度 | iCal VTODO | Graph `todoTask` | 影响 |
|---|---|---|---|
| 归属 | 所属日历集合 | **必须**属于某个 `todoTaskList` | 需要维护"列表 ↔ 日历/笔记本"的映射 |
| 身份 | `UID` 全局唯一 | `id` 在**移动列表后会变化** | 必须保留 UID↔id 映射，不能拿 id 当主键 |
| 提醒 | `VALARM` 可多条、可相对结束、可绝对 | `isReminderOn` + `reminderDateTime`（**绝对时刻**，单条） | 多提醒/相对提醒会被降级成"一个绝对时间点" |
| 优先级 | `PRIORITY` 0–9 | `importance` 三档 | 有损 |
| 进度 | `PERCENT-COMPLETE` | 无 | 有损，需落库保留 |
| 状态 | 4 值 | 5 值 | 双向映射需定义默认落点 |
| 子项 | 无标准形态（可 `RELATED-TO` 挂子 VTODO） | `checklistItems`（**清单项，不是子任务**） | 语义不同，不能互转 |
| 关联资源 | `URL` / `ATTACH` | `linkedResources` | Graph 更适合"关联回笔记" |
| 重复 | `RRULE` | `recurrence` | 同上，有损 |
| 与会者 | `ATTENDEE` | **无** | 任务不能有与会者 |

### 2.4 字段映射表：事件（本地 → iCal → Graph）

| 本地字段 | iCal（VEVENT） | Graph `event` | 转换规则 / 坑 |
|---|---|---|---|
| `id`（本地 UUID） | `UID` | `iCalUId` / `id` | **不要**用 Graph `id` 回填 UID；重复实例的 `iCalUId` 每例不同 |
| `title` | `SUMMARY` | `subject` | 纯文本 ↔ 纯文本 |
| `notesMarkdown` | `DESCRIPTION`（纯文本） | `body`（默认 HTML） | Markdown 需降级为纯文本；回写时反向"猜"格式会丢结构，建议保留原始 Markdown 在 sidecar |
| `start` / `end` | `DTSTART` / `DTEND` | `start` / `end` | 结束语义两边都是非包含，可直接对应 |
| `allDay` | `VALUE=DATE` + 次日 `DTEND` | `isAllDay=true` + 同 TZ 午夜 | 同步时按"日期"而非"时刻"比对，避免差一天 |
| `timezoneId` | `TZID` + `VTIMEZONE` | `start.timeZone`（Windows 名） | 需 IANA↔Windows 映射 |
| `rrule` | `RRULE` | `recurrence.pattern` + `.range` | 有损；不可表达时建议**只读保留 + 标记不可写** |
| `exceptions[]` | `RECURRENCE-ID` 组件 + `EXDATE` | `type=exception` + `originalStart` / `cancelledOccurrences` | 例外是独立 event，需按 `seriesMasterId` 归组 |
| `reminders[]` | 多条 `VALARM` | `reminderMinutesBeforeStart`（单条） | 只同步"第一条相对开始的 DISPLAY 提醒" |
| `busy` | `TRANSP` | `showAs` | free↔`TRANSPARENT`，其余↔`OPAQUE`（`oof`/`workingElsewhere` 回写时降级为 `OPAQUE`） |
| `visibility` | `CLASS` | `sensitivity` | `PRIVATE`/`CONFIDENTIAL` 可对应，`PUBLIC`↔`normal` |
| `categories[]` | `CATEGORIES`（逗号分隔 TEXT） | `categories[]` | 注意未分类/空串；Graph 分类是用户级 `outlookCategory` |
| `location` | `LOCATION` | `location.displayName` | 结构化地址在 iCal 用 `X-` 或 `ALTREP`，标准内无对等 |
| `attendees[]` | `ATTENDEE` | `attendees[]` | 需要邮箱与 `CN`；无调度能力时只读 |
| `status` | `STATUS` | `isCancelled` | Graph 无 TENTATIVE，需落到 `showAs=tentative` 或本地保留 |
| `sequence` / `modifiedAt` | `SEQUENCE` / `LAST-MODIFIED` | `changeKey` / `lastModifiedDateTime` | 语义相近但不能互算，各自独立维护 |

### 2.5 字段映射表：任务（本地 → iCal → Graph）

| 本地字段 | iCal（VTODO） | Graph `todoTask` | 转换规则 / 坑 |
|---|---|---|---|
| `id` | `UID` | `id`（列表内） | 移动列表会换 id，必须保留映射 |
| `title` | `SUMMARY` | `title` | — |
| `notes` | `DESCRIPTION` | `body` | 同事件 |
| `startAt` | `DTSTART` | `startDateTime` | 可选 |
| `dueAt` | `DUE` | `dueDateTime` | 全天截止：iCal 用 DATE（含当天），Graph 用当日 00:00 |
| `completedAt` | `COMPLETED`（UTC） | `completedDateTime` | 归一化到 UTC 再写入 |
| `percentComplete` | `PERCENT-COMPLETE` | **无** | 仅本地保留，跨端丢失 |
| `status` | `STATUS` | `status` | `NEEDS-ACTION`↔`notStarted`，`IN-PROCESS`↔`inProgress`，`COMPLETED`↔`completed`；`CANCELLED` 无对等（建议本地保留） |
| `priority` | `PRIORITY` 0–9 | `importance` | 有损三档 |
| `reminderAt` | `VALARM`（相对或绝对） | `isReminderOn` + `reminderDateTime` | 相对提醒需在写入时**算出绝对时刻**，之后不再随后续改期自动跟随（**这是行为差异，需产品决策**） |
| `rrule` | `RRULE` | `recurrence` | 有损 |
| `categories[]` | `CATEGORIES` | `categories[]` | — |
| `checklist[]` | 无标准（`RELATED-TO` 子 VTODO 不通用） | `checklistItems` | **单向**：Graph → 本地 checklist；反向不同步 |
| `linkedNote` | `URL` / `ATTACH` | `linkedResources` | Graph 支持 `application/…` 外部链接，适合挂回笔记 |

### 2.6 有损点汇总（评审时逐条确认取舍）

| # | 丢失方向 | 具体内容 | 建议策略 |
|---|---|---|---|
| L1 | 本地 → Graph | 第 2 条及以后的提醒 | 只同步第一条；其余本地保留 |
| L2 | 本地 → Graph | `TRIGGER;RELATED=END` | 换算成"相对开始"或放弃同步 |
| L3 | 本地 → Graph | `PRIORITY` 0–9、`PERCENT-COMPLETE` | 本地权威，Graph 只写三档 |
| L4 | 本地 → Graph | `BYSETPOS`/`BYWEEKNO`/`RANGE=THISANDFUTURE` | 标记"只读镜像"，禁止从 Graph 回写覆盖 |
| L5 | Graph → 本地 | `showAs=oof`/`workingElsewhere`、`status=deferred`/`waitingOnOthers` | 落到本地扩展枚举，回写时降级 |
| L6 | 双向 | Markdown 正文 ↔ HTML body | 保留 `rawMarkdown`，避免"HTML→Markdown"反复转换漂移 |
| L7 | 双向 | 浮动时间 | Graph 不支持；同步时按"用户当前时区"具体化，并在本地标记"已固定" |

---

## 3. 交互惯例

> 本节"依据"列使用第 0 节的 A/B/C/D 等级。标 C/D 的条目属于**产品观察/推测**，进设计前需实机截图核对，不要当规范引用。

### 3.1 跨产品一致的做法（可以放心照做）

| # | 惯例 | 说明 | 依据 |
|---|---|---|---|
| U1 | 周起始日**可配置**，默认跟随区域 | Outlook 有"将一周的第一天显示为"；Google 有 `weekStart`（0/1/6）；iOS 有"每周起始日" | A/B |
| U2 | 全天事件**独立置顶横条**，不占时间轴 | 五端一致；跨天为一条连续色块 | B/C |
| U3 | **点击空白时间段直接创建** | 网格即入口；创建后默认时长可配 | B |
| U4 | **拖拽移动改期 + 下边缘拖拽改时长** | 事件块整体拖动=改期；抓底边=改时长 | C（五端行为一致，未见文档化） |
| U5 | 新建入口**两处并存**：工具栏主按钮 + 网格点击 | 工具栏按钮带下拉（事件/任务/更多） | B/C |
| U6 | 颜色**属于"日历/分类"这一层**，不是事件本身 | Apple 严格按日历着色；Outlook 按 category；Google 允许事件覆盖日历色 | B |
| U7 | 任务与事件**共用同一条时间轴**，但用"复选框/无实心块"区分 | 任务不画成实心时间块，视觉权重更低 | C |
| U8 | 提醒是**事件级属性**，且有全局默认值 | Outlook 默认"提前 15 分钟"（官方文档写明） | A/B |

### 3.2 存在分歧的做法（需产品决策）

| # | 分歧点 | 各产品做法 | 推荐 | 理由 |
|---|---|---|---|---|
| D1 | **默认视图** | 桌面 Outlook：周视图；Google 网页：周视图；iPhone：月视图（观察）；iPad：分栏（侧栏日历列表 + 主区网格） | **桌面=周视图；平板=左列表+右网格三栏；手机=日程列表（Agenda）** | 视图要匹配屏幕的信息容量；笔记应用常与编辑器同屏，宽度更紧张，周视图+可折叠侧栏最稳 |
| D2 | **周起始日默认值** | Google API 默认 `0`（周日）；Outlook/iOS 默认随区域 | **显式跟随系统区域（中国大陆=周一），并在设置里可改** | 默认值写死周日会在中文环境第一眼就"错"；显式读取 locale 比"猜"可靠 |
| D3 | **颜色归属** | Apple：只能按日历；Outlook：按 category（分类是用户级、可跨日历）；Google：日历色 + 事件可覆盖 | **两层：日历=底色，事件可覆盖** | 笔记场景常需"按项目/笔记本"着色，单层日历色不够；但完全自由取色会失去"颜色=身份"的可读性 |
| D4 | **任务是否占时间块** | Google Tasks 可带时间、在日历中显示但**不占实心块**；Outlook 任务默认只在"我的一天/任务列表"里，不进入时间轴 | **默认不占块；仅当用户显式设置"开始-结束"时画成浅色描边块** | 任务本质是"待办"而非"承诺时间"；占块会误导忙碌判断，也会污染 `TRANSP` 语义 |
| D5 | **修改重复事件的选项** | Google/Outlook：本次 / 本次及以后 / 全部；部分客户端只有"本次 / 全部" | **三选项，顺序：仅本次 → 本次及以后 → 全部** | 三选项能完整映射到 `RECURRENCE-ID` / 拆序列 / 改 master；两选项会逼用户做错选择 |
| D6 | **拖拽重复事件的一次实例** | Google：直接移动并生成例外，不打断；Outlook：弹窗询问 | **直接改 + Toast 提供"撤销"和"改全部"** | 拖拽是高频道操作，弹窗会打断心流；但必须给回退路径，否则误操作成本高 |
| D7 | **快速添加的自然语言输入** | Google：有（历史 Quick add，现为 Gemini 会话式创建）；Apple/经典 Outlook：无 | **支持，但必须先出"解析预览"再确认** | NLP 解析失败率不可忽略，直接落库会产生脏数据；预览还能教育用户可用的语法 |
| D8 | **提醒呈现方式** | 桌面端：系统 Toast + 应用内提醒中心；移动端：本地通知 + 角标 | **系统通知为主，应用内保留"稍后提醒/完成"两个动作** | 笔记应用常被切走，纯应用内提醒等于没有；但"稍后提醒"的状态要能回写（Graph 有 snooze 端点，iCal 无标准） |
| D9 | **全天事件与"日期笔记"的关系** | 无先例（其他产品没有笔记语义） | **全天事件栏同时承担"当日笔记入口"** | 这是本产品相对通用日历的差异化点，且天然落在全天行，不干扰时间轴 |

### 3.3 对"笔记应用内嵌日历 + 任务"的直接结论

1. **任务的源语法定为 Markdown 复选框**（`- [ ]`），日历视图是它的另一种投影；但**完成时间/UID 必须写进 sidecar**，不能靠解析正文推断。
2. **事件不要写进正文**，用引用块/嵌入块呈现；否则用户随手编辑正文就会改坏 `DTSTART`。
3. **周起始日、时区、默认提醒**三项做成"读系统 + 可覆盖"，不要硬编码。
4. **重复事件默认只读**（对 Graph 尤其），编辑前提示"可能降级"，避免把 `BYSETPOS` 写坏。
5. **颜色体系分两层**（日历/笔记本 = 底色，事件 = 可覆盖），与"分类"解耦，避免和 Outlook category 语义打架。
6. **离线优先**：本地先落 `UID` + `dirty` 标记 + `baseETag`，同步层用队列；412 只能走合并流程，不能"最后写入者胜"。

---

## 4. 依据来源清单

| 结论/口径 | 来源 | 等级 |
|---|---|---|
| VEVENT 必填字段、`DTEND` 非包含、DATE 型默认 1 天、多日事件示例 | RFC 5545 §3.6.1 | A |
| VTODO 必填字段、`DUE`/`DURATION` 互斥、无日期任务的"每日关联"语义、逾期示例 | RFC 5545 §3.6.2 | A |
| `DURATION` 与 DATE 类型只能用天/周 | RFC 5545 §3.8.2.5 | A |
| `RECURRENCE-ID` 指向原始开始时间、`RANGE=THISANDFUTURE` | RFC 5545 §3.8.4.4 | A |
| `VALARM` 结构、`ACTION` 约束、`REPEAT`+`DURATION` 成对、绝对触发只响一次 | RFC 5545 §3.6.6 | A |
| `TRIGGER` 三种形态、`RELATED=END`、绝对触发必须 UTC、DATE 事件按用户时区 00:00 触发 | RFC 5545 §3.8.6.3 | A |
| `FREQ` 必填、`UNTIL`/`COUNT` 互斥、`COUNT` 含 DTSTART、`WKST` 默认 MO、非法日期必须跳过 | RFC 5545 §3.3.10 | A |
| ETag 作为日历对象资源版本标识 | RFC 4791 §5.3.4 | A |
| `sync-collection` / `sync-token` 增量同步 | RFC 6578 | A |
| CTag 属于 CalDAV 扩展而非 RFC 4791 正文 | CalConnect 标准索引（"Calendar Collection Entity Tag (CTag) in CalDAV" 列为扩展） | A |
| `event` 字段集合、`isAllDay` 午夜约束、`type`/`originalStart`/`cancelledOccurrences`、`iCalUId` | Microsoft Graph `event` 资源文档 | A |
| `patternedRecurrence` 六种 pattern 与必填项 | Microsoft Graph `patternedRecurrence` / `recurrencePattern` | A |
| `todoTask` 字段（importance/status/reminderDateTime/checklistItems/linkedResources） | Microsoft Graph `todoTask` 资源文档 | A |
| 时区默认 Windows 格式、可按需返回 IANA | Microsoft Graph `outlookUser: supportedTimeZones` | A |
| Outlook 默认提醒"提前 15 分钟"、可改默认提醒 | Microsoft Support: Calendar settings / Change the default reminder time | B |
| Outlook 周起始日可配置 | Microsoft Support: Calendar settings in Outlook on the web | B |
| Outlook 多日历"并排 / 叠加(overlay)" | Microsoft Support: View multiple calendars at the same time in Outlook | B |
| Outlook 任务在日历中的呈现（经典：Daily Task List；新版：My Day 面板） | Microsoft Support: Use My Day with To Do in Outlook | B |
| Windows 邮件与日历支持已于 2024-12-31 终止，新 Outlook 为默认 | Microsoft Support: Outlook for Windows / Windows Mail, Calendar and People | B |
| Google `defaultEventLength` 默认 60；`weekStart` 允许 0/1/6、默认 0 | Google Calendar API Settings 参考 | A |
| Google 任务可在日历中勾选完成、显示于视图顶部 | Google Workspace 培训材料 / 第三方指南 | C |
| Google 会话式创建事件（Gemini 扩展） | Google/9to5Google 报道 | C |
| iOS 可配"默认提醒时间（生日/事件/全天）""新事件默认时长""每周起始日""周视图从今天开始" | Apple Support: Change calendar and event settings on iPhone | B |
| iPad 日历使用侧边栏选择日历 | Apple Support: iCloud for Calendar / iPad 侧栏说明 | B |

---

## 5. 待核实清单（进设计前必须实机确认）

| # | 待确认项 | 当前判断 | 建议核对方式 |
|---|---|---|---|
| V1 | 各产品默认视图（iPhone 月视图？macOS 周视图？） | 推测（D） | 各端截图 |
| V2 | 拖拽吸附粒度（15 / 30 分钟） | 推测（D） | 实机拖拽测量 |
| V3 | Google/Apple 出厂默认提醒时长 | 未在官方文档中找到（D） | 新建账号实机查看 |
| V4 | 周起始日是否真的随 locale 自动切换 | 推测（D，Google API 默认值为周日） | 切换语言/区域后观察 |
| V5 | Apple 日历是否显示"提醒事项" | 推测为"不显示"（D） | iPadOS 26 实机 |
| V6 | 拖拽重复实例是否弹窗（Outlook） | 观察（C） | 实机 |
| V7 | Graph 是否接受 IANA 时区名写入 `start.timeZone` | 文档只说可返回 IANA，写入行为未明确（D） | 用 `Prefer` 头做写入实验 |
| V8 | 目标 CalDAV 服务是否支持 RFC 6578 | 需按服务商确认（D） | `PROPFIND` 探测 `DAV:sync-collection` |
| V9 | Outlook 任务是否可带"时间段"（start+due）并在日历占位 | 部分支持，行为不一（C） | 新 Outlook 实机 |
