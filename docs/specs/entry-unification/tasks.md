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

## - [ ] T2.1 设置扩展（`app/src/stores/settings.ts`）

- 新增 `periodic: Record<PeriodKind, { folder, format, template }>`、`weekStartsOn`、`captureHeading`。
- 读时把旧 `dailyNotesFolder/Format/Template` 映射成 `periodic.daily`；写时双写一版，旧键保留。
- 验证：旧设置文件载入后日记路径与现在完全一致（单测 + 手测）。

## - [ ] T2.2 新增 `app/src/lib/periodic-notes.ts`

- `periodicPath(kind, date, config, weekStartsOn) → string`（纯函数）。
- token：`YYYY MM DD ddd dddd WW Q`，`[...]` 原样输出。
- 锚点：日=当天；周=当周首日；月=1 日；季=季首月 1 日；年=1 月 1 日。
- 验证：`periodic-notes.test.ts` — 跨年周（2026-12-28 → 2027 W53/W01 视 ISO 规则）、季首、闰年 2 月。

## - [ ] T2.3 `openOrCreate` + 模板变量

- 目录缺失则建；文件缺失则套模板；已有文件绝不覆盖。
- 变量：`{{date}} {{time}} {{title}} {{yesterday}} {{tomorrow}} {{weekStart}} {{weekEnd}} {{monthStart}} {{monthEnd}} {{quarter}} {{year}} {{prev}} {{next}}`。
- 模板读失败 → 建空文件 + 提示，不阻断。
- 验证：手测五类各打开一次；已有文件内容 md5 不变。

## - [ ] T2.4 打开入口

- 顶部/侧栏"打开今天 / 本周 / 本月 / 本季 / 本年"。
- 验证：五个入口各指向 `periodicPath` 的结果。

## P3. 轻量条目落盘（自动捕获第一层）

## - [ ] T3.1 新增 `app/src/lib/entry-writer.ts`

- `resolveEntryHome(entry) → { kind: 'periodic', path }`：D1=B 之后行**始终**落到周期笔记，重量条目另建事件笔记。
- `writeEntry(home, line)`：读 → 定位（`🆔 uid` 命中则替换，否则 `captureHeading` 下插入）→ 哈希 CAS → 一次写。
- 进程内按 path 串行；冲突重试一次后报错。
- 验证：连续 3 次写入行数不变；模拟并发写只成功一次。

## - [ ] T3.2 日历新建条目接 `writeEntry`

- 目标固定为 `today` 的 `daily`（D6：不读配置、不做其他类型）。
- 行由表单字段构造 → `writeTaskLine` → `writeEntry`；重量条目另建事件笔记（只写 extras + `entry_uid`）。
- 验证：新建 `📅 2026-11-20` 的条目，行出现在**今天**的日记里；日历在 20 日显示。

## - [ ] T3.3 `entry-writer.test.ts`

- 落点是创建日而非事件日；重复运行不重复；用户手写无 uid 行不被覆盖；`captureHeading` 缺失时的兜底行为。
- 验证：`pnpm test`。

## P4. 重量条目 join

## - [ ] T4.1 日历按 `entry_uid` 跨文件 join

- 由索引构建 `uid → (path, line1Based)` 映射；事件笔记有 `entry_uid` 时，共用字段取那一行，extras 取事件笔记。
- 找不到对应行 → 回退事件笔记自身 frontmatter（legacy），不做改写。
- 验证：现有 calendar 测试全绿；legacy 笔记渲染不变。

## - [ ] T4.2 事件笔记只写 extras

- 新建重量条目时，事件笔记写 `entry_uid` + 事件专属键；**不写** `summary`/日期/`rrule`/标签。
- 验证：事件笔记里 grep 不到共用字段副本；连续保存两次零 diff。

## - [ ] T4.3 `categories` 由行提供

- 事件编辑器补标签输入，写入回行内 `#tag`（不再写 `categories`）。
- 验证：加 `#work` → 行里出现 `#work`，日历标签随之变化。

## - [ ] T4.4 legacy 静默只读（D7：不加徽标）

- 验证：旧笔记未被改动前字节不变；用户主动编辑时才建行 + 写指针。

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
