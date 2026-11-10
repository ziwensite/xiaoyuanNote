# 任务清单 — 统一条目（事件 / 任务）

对应规格：`docs/specs/entry-unification/spec.md`

约定：除 P0 外均为**待开工**；标注 ⏸ 的条目依赖 `spec.md` §9 的拍板项，拍板前不动。

## P0. 文档与样例（本轮）

## - [x] T0.1 写 `spec.md`

- 结论、字段归属表、存储与写入、周期笔记、自动捕获、兼容边界、分期、待拍板、本轮不做。
- 验证：评审。

## - [x] T0.2 写 `tasks.md`

- 与 spec 的 §8 阶段一一对应。
- 验证：与本文件一致。

## - [ ] T0.3 黄金样例（20 条）

- 新增 `docs/specs/entry-unification/fixtures.md`，每条给出：输入行 → 期望 `TaskLineModel` → 期望事件投影（frontmatter 键值）→ 期望 serialized 行。
- 覆盖：无 token、全 token、`⏰`、多标签、`🏁 keep`、`x`/`-`/`/`/`?` 状态、缺分隔符的粘连行、空描述、`🆔`+`⛔`、日期跨年。
- 验证：人工核对；后续阶段直接改写成 `node:test` 用例。
- **实施说明**：不单独维护 `fixtures.md`，这些样例在 T1.3 里直接落成断言，避免文档与实际测试两处漂移。

## P1. 行 ↔ 事件映射

## - [x] T1.1 `app/src/lib/task-line.ts` 把 `⏰` 提升为一等 token（D3：紧跟 `📅`）

- `TaskLineModel` 增加 `reminders: string[]`；`MARKER_CHAR_RE` 加入 `⏰`；`startsToken` 识别 `⏰`。
- 解析：`⏰` 后面的时长/时刻作为其值；裸 `⏰` 保字节进 `extra`；多个提醒保序。
- 序列化：`📅` 之后、优先级之前。
- `TaskEditorDialog` 透传 `reminders`，避免"打开编辑器再保存"丢掉提醒。
- 验证：`task-line.test.ts` 新增 4 条断言（解析/位置/三次写回稳定/粘连修复/裸标记）；`tasks.test.ts` 两处旧期望更新为规范顺序。850 测试通过，build 通过。

## - [x] T1.2 新增 `app/src/lib/entry.ts`

- `entryFromLine(line): Entry | null`、`lineFromEntry(entry): string`（薄封装，内部仍调 `parseTaskLine`/`serializeTaskLine`）。
- `EntryHome`：`{ kind: 'periodic' | 'event', path, line }`；`entry_uid` 的类型与生成规则。
- 不做 frontmatter 投影（D1=B 后事件笔记不存共用字段），只定义 extras 的键集合。
- 验证：`entry.test.ts` — 往返幂等、`entry_uid` 往返、行缺失时 legacy 回退。
- **实施说明**：`EntryHome` 与 uid 生成规则挪到 T3.1，和真正用它写盘的 `resolveEntryHome` 一起落地，避免先留一个没人调用的类型；`ENTRY_UID_KEY`（frontmatter 键名）已在此定义。

## - [x] T1.3 `app/src/lib/entry.test.ts`

- 黄金样例直接落成断言（不再单维护 fixtures.md）。
- 约定：`parse(serialize(parse(x)))` 稳定；`⏰` 三次写回位置不变。
- 验证：`pnpm test`。
- **实施说明**：10 条黄金行 × 往返/三次写回稳定/乱序规范化一次性收敛；另覆盖非任务行、uid 可选、轻/重判定、extras 键表契约。860 测试通过，build 通过。

## P2. 周期笔记引擎

## - [x] T2.1 设置扩展（`app/src/stores/settings.ts`）

- 新增 `periodic: Record<PeriodKind, { folder, format, template }>`、`weekStartsOn`、`captureHeading`。
- 读时把旧 `dailyNotesFolder/Format/Template` 映射成 `periodic.daily`；写时双写一版，旧键保留。
- 验证：旧设置文件载入后日记路径与现在完全一致（单测 + 手测）。
- **实施说明**：`mergePeriodicConfig` 只在 `periodic.daily` 缺失时读旧键，旧键随即被双写同步；`format` 含 `.md`（沿用旧约定，迁移逐字照搬）；`folder` 是字面量不解析 token（否则默认 `Quarterly` 会被 `Q` 换成 `4uarterly`，单测抓到过一次）；`weekStartsOn` 越界回落 1，`captureHeading` 默认 `## 任务`。

## - [x] T2.2 新增 `app/src/lib/periodic-notes.ts`

- `periodicPath(kind, date, config, weekStartsOn) → string`（纯函数）。
- token：`YYYY MM DD ddd dddd WW Q`，`[...]` 原样输出。
- 锚点：日=当天；周=当周首日；月=1 日；季=季首月 1 日；年=1 月 1 日。
- 验证：`periodic-notes.test.ts` — 跨年周（2026-12-28 → 2027 W53/W01 视 ISO 规则）、季首、闰年 2 月。
- **实施说明**：token 解析下沉到 `daily-notes.ts` 的 `formatDailyFilename`（单次左到右扫描 + `[...]`），日记与周期笔记共用一套；`WW` 是 ISO 周，`YYYY` 取锚点日历年，故 2026-01-01 所在周名为 `2025-W01`、2026-12-28 起始周为 `2026-W53`。15 条单测覆盖锚点、周日/周一两种周首、跨年周、季首、闰日、模板变量与配置合并。

## - [x] T2.3 `openOrCreate` + 模板变量

- 目录缺失则建；文件缺失则套模板；已有文件绝不覆盖。
- 变量：`{{date}} {{time}} {{title}} {{yesterday}} {{tomorrow}} {{weekStart}} {{weekEnd}} {{monthStart}} {{monthEnd}} {{quarter}} {{year}} {{prev}} {{next}}`。
- 模板读失败 → 建空文件 + 提示，不阻断。
- 验证：手测五类各打开一次；已有文件内容 md5 不变。
- **实施说明**：`useDailyNotes.openPeriodic(kind, date)` 统一了原 `openDateNote`，SAF 分支一并复用；模板改为"工作区相对路径"（读不到就回退内置默认并 toast），保留 `{{day}} {{week}} {{previous}}` 让既有日记模板输出不变。已有文件仍只 `read_file` 探测后直接打开，不重写。

## - [x] T2.4 打开入口

- 顶部/侧栏"打开今天 / 本周 / 本月 / 本季 / 本年"。
- 验证：五个入口各指向 `periodicPath` 的结果。
- **实施说明**：命令面板新增 `periodic.openWeek/openMonth/openQuarter/openYear`；"今天"仍走 `daily.openToday`，侧栏"今天"未改。五个入口都只调 `openPeriodic(kind, new Date())`，路径由 `periodicPath` 决定。

## P3. 轻量条目落盘（自动捕获第一层）

## - [x] T3.1 新增 `app/src/lib/entry-writer.ts`

- `resolveEntryHome(entry) → { kind: 'periodic', path }`：D1=B 之后行**始终**落到周期笔记，重量条目另建事件笔记。
- `writeEntry(home, line)`：读 → 定位（`🆔 uid` 命中则替换，否则 `captureHeading` 下插入）→ 哈希 CAS → 一次写。
- 进程内按 path 串行；冲突重试一次后报错。
- 验证：连续 3 次写入行数不变；模拟并发写只成功一次。
- **实施说明**：`EntryHome = { kind: 'periodic', path }`；路径解析（`today` 的 `daily`）放在调用方的 composable，库里只保留类型，避免 lib 依赖 settings/workspace。文本变换拆成纯函数 `upsertEntryLine(text, line, {uid, heading})`，I/O 用注入的 `read`/`write`，因此不需要真实仓库就能测。冲突处理为"写前重读，变了就基于新文本重算一次"，不做阻塞式锁；标题缺失或为空 → 追加到最后一行非空行之后。返回值 `created | written | unchanged`。

## - [x] T3.2 日历新建条目接 `writeEntry`

- 目标固定为 `today` 的 `daily`（D6：不读配置、不做其他类型）。
- 行由表单字段构造 → `writeTaskLine` → `writeEntry`；重量条目另建事件笔记（只写 extras + `entry_uid`）。
- 验证：新建 `📅 2026-11-20` 的条目，行出现在**今天**的日记里；日历在 20 日显示。
- **实施说明**：按 spec §8 的 P3 范围，本阶段只接**轻量条目**（全日、无地点、无备注）——这类条目没有事件笔记，行写入 `ensurePeriodic('daily', today)` 返回的日记后由现有 `buildCalendarIndex` 按 `📅` 入桶。重量条目的 extras-only 事件笔记与跨文件 join 同在 P4（T4.1/T4.2）落地，否则本阶段会写出"日历看不见"的事件笔记。行内容 = 描述 + `📅` + `⏰`（来自 alarms，保序）+ `🆔`；`🆔` 与将来事件笔记的 `entry_uid` 同为 uid8。`useDailyNotes` 拆出 `ensurePeriodic`（建而不打开），`openPeriodic` 复用它。写盘沿用 `useTasks` 的约定：有打开的 tab 就改 tab 并静默保存，否则写文件 + `solomd:saved`。

## - [x] T3.3 `entry-writer.test.ts`

- 落点是创建日而非事件日；重复运行不重复；用户手写无 uid 行不被覆盖；`captureHeading` 缺失时的兜底行为。
- 验证：`pnpm test`。
- **实施说明**：13 条用例——标题下插入、标题缺失/为空时追加、同 uid 原位替换、重复写为零改动、CRLF 保持、无 uid 行永不合并、手写行逐字节不动、`created/written/unchanged` 三态、三次写只落一次盘、并发同 uid 只成功一次、不同条目并发都落盘、"写前被他人改动"时重算且保留对方内容。888 测试通过。

## P4. 重量条目 join

## - [x] T4.1 日历按 `entry_uid` 跨文件 join

- 由索引构建 `uid → (path, line1Based)` 映射；事件笔记有 `entry_uid` 时，共用字段取那一行，extras 取事件笔记。
- 找不到对应行 → 回退事件笔记自身 frontmatter（legacy），不做改写。
- 验证：现有 calendar 测试全绿；legacy 笔记渲染不变。
- **实施说明**：新增 `buildEntryLineIndex`（首个命中优先）与 `joinedEvent`，共用字段（描述、`📅`、`🔁`、`#tag`、`⏰`）来自行，时间/地点/备注/系列链接来自笔记。`buildCalendarIndex`、`buildCalendarView`、`buildCalendarReminders` 统一改走 `buildCalendarMaterial`：既做 join，也把"被事件笔记指到的那一行"从任务列表里摘掉，避免重量条目在日历里出现两次。找不到行的指针回退到自身 frontmatter；extras-only 笔记没有 `dtstart`，因此行被删后事件会消失、孤儿行仍作为普通任务显示。`CalendarEvent` 新增可选 `entryUid` 供写回使用。

## - [x] T4.2 事件笔记只写 extras

- 新建重量条目时，事件笔记写 `entry_uid` + 事件专属键；**不写** `summary`/日期/`rrule`/标签。
- 验证：事件笔记里 grep 不到共用字段副本；连续保存两次零 diff。
- **实施说明**：`entryEventFrontmatter` 只输出 `type/uid/entry_uid/all_day/start_time/end_time/tzid/status/description/location/exdate/series_uid/recurrence_id/related_note/同步元数据`；`createEntryEventNote` 用于新建，`writeEntryEventNote` 用于改写并**删除**六类共用键（`summary/dtstart/dtend/rrule/categories/alarms`）。它保留原 `dtstamp` 而不是刷新，所以连续两次相同保存字节一致。新建重量条目先写行（权威、失败时可单独存在）再建指针笔记；写行目标沿用 `writeEntryLine`（有行改行、无行落今天日记）。

## - [x] T4.3 `categories` 由行提供

- 事件编辑器补标签输入，写入回行内 `#tag`（不再写 `categories`）。
- 验证：加 `#work` → 行里出现 `#work`，日历标签随之变化。
- **实施说明**：`EditorDraft` 增加 `tags` 文本（`work, home` 或 `#work #home` 均可解析），编辑器新增输入框，15 个语言补 `calendar.editor.tags/tagsPlaceholder`。保存时 `lineFromCalendarEvent` 把标签写成行内 `#tag`；行侧只改共用字段，`⏫`/`⏳`/`🆔`/状态等任务专属 token 原样保留。`🔁` 文本仍能编译成同一规则时保留自然语言，规则真变了（如系列拆分加 `UNTIL`）才写回 iCal 文本。事件笔记不再出现 `categories`。

## - [x] T4.4 legacy 静默只读（D7：不加徽标）

- 验证：旧笔记未被改动前字节不变；用户主动编辑时才建行 + 写指针。
- **实施说明**：读取路径（join/回退）不写盘，未编辑的旧笔记字节不变。保存旧笔记时按"主动升级"处理：用现有 `uid` 派生 uid8 → 在今天的日记建行（`📅`/`🔁`/`⏰`/标签/`🆔`）→ 事件笔记一次改写为 extras-only 并写入 `entry_uid`，共用键同次删除。例外实例与"此后所有"拆分出的新系列仍按完整 frontmatter 创建（它们的日期/规则是派生结果，不冒充新的创建条目），首次主动编辑时同样走升级。上方注释中提到的"写行失败则终止"保证不会出现有指针无行的笔记。

## P5. 捕获预设

## - [ ] T5.1 捕获配置模型与存储

- 名称、目标（文件 / 文件夹新建 / 周期笔记某类）、插入位置（顶部 / 底部 / 标题之后）、内容模板、变量、自动补 `➕`/`📅`、是否打开。
- 验证：设置读写往返一致。

## - [ ] T5.2 捕获执行器

- 变量：选区、剪贴板、输入框、日期。
- 验证：手测四种变量组合；目标不存在时按模板创建。

## - [ ] T5.3 设置页

- 列表 + 增删改 + 预览插入结果。
- 验证：手测一次新增配置后从命令插入到指定标题下。

## P6. 周期窗口（可选）

## - [ ] T6.1 只读窗口视图

- 按 `periodicPath` 锚点计算窗口，列出范围内行（过滤条件可配），可跳转。
- 验证：周报窗口只列本期未完成行；不写正文。

## 全局验证

- 每阶段结束：`pnpm test`、`pnpm build`。
- 不新增依赖；不改版本号；每阶段单独提交、不 push。
