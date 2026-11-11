# 侧边栏日历：联网节假日 + 农历 + ISO 周数

## Context

侧边栏月视图目前只有日号和任务密度点。本次要补三样信息：法定节假日标记、农历/传统节日、ISO 周数。
其中节假日数据每年由国务院办公厅调整，固定录入会过期，因此改成「联网获取 + 本地缓存 + 内置表兜底」，
并吸收最新约束：**不做定时轮询**，改为条件请求（ETag / Last-Modified）+ 事件驱动检查。

数据源：**NateScarlet/holiday-cn**（MIT，免 key，每年一份静态 JSON，由国务院通知整理，持续维护）。
URL 模板作为常量：`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json`。
返回 `{ year, days: [{ name, date: "YYYY-MM-DD", isOffDay }] }`，`isOffDay: true` = 放假，`false` = 调休补班；
按 `name + isOffDay` 把连续日期合并成区间再展示。请求只带年份，不携带任何用户数据；不新增 Rust crate
（`reqwest` / `chrono` / `serde` / `tempfile` 均已在 Cargo.toml）。

## 实现步骤

### 1. 纯函数模块（先测后接界面）

- 新建 `app/src/lib/lunar.ts` + `lunar.test.ts`
  - 内置 1900–2100 的 20 bit/年 `LUNAR_INFO`（201 项），实现 `lunarYearDays` / `leapMonth` / `leapDays` /
    `monthDays` / `solarToLunar`（基准 1900-01-31 = 正月初一，UTC 日差，无近似）。
  - `festivalOf(date)`：春节、元宵、龙抬头、端午、七夕、中元、中秋、重阳、腊八、除夕（次日为正月初一）；
    清明用 20/21 世纪系数公式（`Y = 年份后两位`，C = 5.59 / 4.81）。
  - 闰月以 `leapPrefix` 标记；日名用中文（初一…三十），所有语言下保持一致。
  - 测试锚点：2025-01-29 春节、2025 闰六月、2026-02-17 春节、2026-09-25 中秋、2025-04-04 / 2026-04-05 清明、
    1900 与 2100 边界。
- 新建 `app/src/lib/iso-week.ts` + `iso-week.test.ts`
  - `isoWeek(date) -> { year, week }`：周一为一周首日，含 1 月 4 日的那周为 W1（Thursday 算法）。
  - 测试：2024-12-30 → 2025-W01、2021-01-03 → 2020-W53、2026-01-01 → 2026-W01。
- 新建 `app/src/lib/holidays.ts` + `holidays.test.ts`
  - 内置 `CN_HOLIDAYS: Record<number, { off: {start,end,nameKey}[]; work: string[] }>`，覆盖 2024–2026；
    增删年份只加/删一条记录。
  - `mergeHolidayYears(builtin, cached)`：按年份覆盖，联网年优先，缺年回退内置。
  - `holidayIndex(years) -> Map<'YYYY-MM-DD', { kind: 'off'|'work', name, source }>`。
  - `holidayNameKey(raw)`：把接口中文名（元旦/春节/清明节/劳动节/端午节/中秋节/国庆节）映射到 i18n key，
    未知名称原样返回。
  - 测试：范围展开、覆盖优先级、补班优先于放假、缺年回退、未知名称。

### 2. Rust 侧：缓存 + 条件请求

- 新建 `app/src-tauri/src/holidays.rs`，在 `lib.rs` 声明 `pub mod holidays;` 并注册命令。
- 缓存文件 `<app_data_dir>/holidays-cache.json`（`portable::app_data_dir`）：
  ```json
  { "version": 1,
    "years": { "2026": { "fetchedAt": "...", "lastCheckedAt": "...", "source": "holiday-cn",
                         "etag": "...", "lastModified": "...",
                         "days": [{ "date": "2026-01-01", "name": "元旦", "off": true }] } },
    "backoff": { "failures": 0, "nextAttemptAt": null } }
  ```
  年份键 + 拉取时间 + 原始数据类型（`source`）；`fetchedAt` 是数据变化时间，`lastCheckedAt` 是最近一次
  成功检查（含 304）时间，TTL 用后者。
- 命令：
  - `holidays_cached() -> snapshot`（只读缓存，同步、立即返回）。
  - `holidays_refresh(years: Vec<u32>, force: bool) -> RefreshResult`
    `{ outcome: "current"|"updated"|"failed"|"skipped", updatedYears, checkedAt, snapshot }`。
- 条件请求：每个年份带 `If-None-Match` / `If-Modified-Since`；304 只更新 `lastCheckedAt`（及响应头缓存值），
  不解析、不写 `days`；源站不返回校验头时退化为普通 GET（低频，由 TTL 控制），在报告中说明。
- 触发与阈值（无定时器、无常驻线程、窗口关闭即停止）：
  - 缓存缺失或年份缺失：启动 / 打开日历时立即检查。
  - 距 `lastCheckedAt` 超过阈值：常规 7 天；每年 **11-20 ~ 12-15** 缩到 1 天。
  - 手动检查 `force = true`，忽略 TTL 与退避，但仍受单飞约束。
- 单飞：`Mutex<bool>` 守卫，已有请求时直接返回缓存并标 `skipped`。
- 失败静默：不回错误弹窗；写 `failures` 与 `nextAttemptAt`（1h → 6h → 24h → 上限 7d），
  退避期内自动触发直接跳过；手动仍可强试。
- 单测（不联网）：JSON 字段映射、304 只更新检查时间、TTL 7d/1d、跨年缺失、退避序列、
  缓存读写往返（`tempfile`）。

### 3. 前端 store 与设置

- 新建 `app/src/stores/holidays.ts`
  - `init()`：读 `holidays_cached`（失败静默），构造成响应式快照。
  - `maybeRefresh(reason: 'startup'|'open'|'manual')`：未开启自动更新时只 `init()`；`manual` 传 `force`。
  - `index`：`mergeHolidayYears(CN_HOLIDAYS, cached)` 后建索引，供日历直接查询。
  - 所有 `invoke` 包 `try/catch`，失败不 toast、不影响渲染；同一实例内记录进行中 Promise。
- `app/src/stores/settings.ts`
  - 新增 `calendarShowHolidays` / `calendarShowLunar` / `calendarShowIsoWeeks` /
    `calendarAutoUpdateHolidays`（默认全 `true`）及 `toggleCalendarXxx()`；`load()` 里把非 boolean 归一为默认值。
- `app/src/components/SettingsPanel.vue`
  - 在 basics 分组加四个开关 + 文案；自动更新开关旁边加「检查更新」按钮，
    通过 `holidays.checkNow()` 显示一行状态：已是最新 / 已更新到 {year} 年 / 检查失败（继续使用缓存）。
- `App.vue`：在既有初始化处调用 `holidays.init()` + `maybeRefresh('startup')`。

### 4. 月视图 UI

- `app/src/components/CalendarPanel.vue`
  - 网格改为 `18px repeat(7, minmax(0,1fr))`；表头首格 `W`（tooltip），每行行首显示 ISO 周数，
    列宽与现有网格对齐；`calendarShowIsoWeeks` 关闭时去掉该列。
  - 日格加一行 10px 小字：有节假日显示节日名（内置/联网优先），否则显示农历日名；
    `calendarShowLunar` 关闭时隐藏该行。
  - 密度点改为绝对定位右上角；左上角新增 4px 角标：实心 = 放假、空心 = 补班；
    `calendarShowHolidays` 关闭时隐藏角标与节日小字。今日实心点、选中底色、悬停不变。
  - `min-height` 28 → 38px；tooltip 追加「放假/补班 + 名称」与「农历 X月X（闰）」。
  - `onMounted` 调 `holidays.maybeRefresh('open')`。
- i18n：`en.ts` 新增键后，15 个词典保持 key 完全一致（`I18n = typeof en`）：
  `settings.calendar{Holidays,Lunar,IsoWeeks,AutoUpdateHolidays}{,Hint}`、
  `settings.calendarCheckNow`、`settings.calendarCheck{Current,Updated,Failed}`、
  `calendar.week.{header,tooltip}`、`calendar.day.{off,work}`、`calendar.lunar.{leapPrefix,tooltip}`、
  `calendar.festival.*`（春节、元宵、清明、劳动节、端午、中秋、国庆、七夕、中元、重阳、腊八、除夕等）。
  日格内节日/农历文字保持中文，tooltip 与设置项全部本地化。

### 5. 验证与提交

- `cd app && pnpm test`、`pnpm build`（vue-tsc + vite）。
- `cd app/src-tauri && cargo test -j 1`（不联网用例）。
- 手动核对：断网启动仍渲染内置 2024–2026；关掉自动更新只读缓存与内置表；
  手动检查三种反馈；缓存文件字段齐全。
- 单独提交 `feat(calendar): show holidays, lunar dates and ISO weeks`；不 push、不改版本号；
  不提交未跟踪的 `.trae/`、`docs/specs/context-aware-menus/`、`docs/specs/sidebar-shell-stage1/`。

## 风险与说明

- jsDelivr 对 GitHub 文件通常返回 ETag，304 路径可走；若某年无数据（404）按「该年无数据」跳过，不计入失败。
- 内置 2026 表为兜底数据，联网成功时以联网年覆盖。
- 农历表覆盖 1900–2100；范围外返回 `null`，UI 不显示农历，不做近似。
