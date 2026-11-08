# 日历详细视图：B 弹窗方案（调研结论）

状态：调研完成，等待批准（**未改任何源码**）
已定形态：**B 弹窗 / 浮层**。不与笔记并排，只做联动。
日常主用：**月视图 + 任务列表**；日/周为次要可切换视图，**不做默认**。
原"打开日历撑宽到 400"作废；侧栏只留迷你月。

---

## 1. A / C 的后续升级路径（一句话）

弹窗里的视图组件按"只依赖 width + focusDate"的方式抽成共享组件后，**A（编辑区虚拟标签）只需要在 `PaneContent.vue` 加一个分支把同一组件挂上去，C（分屏）只需要 A 的虚拟标签 + 一次 `tiles.splitPane`**，视图与 M2 编辑/拖拽逻辑不需要重写。

---

## 2. B 的前置：基座查实

**已有可复用基座：`app/src/ui/DsModal.vue`**（另有 `ui/DsPopover.vue`，B 不需要）。

已具备：

- `modelValue` / `title` / `width` / `teleport` / `closeOnBackdrop`（`DsModal.vue` L4-20）
- Esc 关闭并 `preventDefault/stopPropagation`（L44-49）
- 焦点陷阱 + 打开时自动聚焦首个输入控件 / 关闭后归还焦点（L74-95）
- `<Teleport to="body">`、`role="dialog"`、`aria-modal`（L103-137）
- 面板 `max-width/max-height: 100%`，按容器而非 `100vw` 测量（L158-175），窄屏不会溢出
- 已被 AboutDialog / CreateTypeDialog / MoveToDialog / MarkdownHelp / FileTree / FileChangedDialog 使用

需要补的缺口（小）：

1. `width` 默认 480px，日历传 `min(94vw, 980px)`。
2. `.ds-modal__body` 是 `overflow-y: auto` 的滚动区（L217-223），日历需要"撑满高度、内部两栏各自滚动"。
   - 最小做法：调用方传 `class="calendar-dialog"`（`DsModal` 用 `inheritAttrs:false` 把 class 落到 `.ds-modal` 上），在调用方 scoped CSS 用 `:global(.calendar-dialog) .ds-modal__panel { height: ... }` + `:deep(.ds-modal__body) { flex:1; overflow:hidden; padding:0 }`。
   - 若嫌 `:deep` 别扭，给 `DsModal` 加一个 `fill?: boolean` prop（约 0.25 人日），不改其他调用方。
3. 日历内部拖拽（M2）与焦点陷阱并存：拖拽用 pointer 事件、不依赖焦点，Esc 关闭弹窗与编辑器快捷键不会冲突（`DsModal` 已在捕获阶段拦截 Esc）。

**结论：B 无隐藏前置，不需要新基座，只做上述 1–2 处适配。**

---

## 3. 900px 宽下的默认布局

弹窗：`width = min(94vw, 980px)`，在 900px 窗口下实际约 **846px**；面板内左右两栏。

```
┌───────────────────────────────────────────────────────────────┐
│  日历                                        [月|日|周]   ×    │ 56px 头部
├──────────────────────────────┬────────────────────────────────┤
│  2026 年 11 月     ‹ 今天 ›   │  逾期 (3)                      │
│  一 二 三 四 五 六 日         │   ☐ 交报告           11-02     │
│  ... 6 行月网格               │  今天 (2)                      │
│  每格约 48×44                 │   ☐ 买牛奶                     │
│  日号 + ≤3 个事件点           │  本周 (4)                      │
│  今天实心 / 焦点日描边        │   ☐ ...                        │
│                               │  以后 (5)                      │
│                               │  未排期 (7)                    │
│  ~360px 固定                  │  自适应，独立滚动               │
└───────────────────────────────────────────────────────────────┘
```

- 左栏月视图固定 **360px**：内边距 12–16px 后每格约 **48px × 44px**。仍**不放事件标题**，只放日号（11px）+ 最多 3 个 2px 圆点；工具提示给明细。>3 条仍 3 点。
- 右栏任务列表占剩余约 **420–460px**，按 **逾期 / 今天 / 本周 / 以后 / 未排期** 五组；组内按 `compareTasks` 顺序；标题栏可吸顶。
- 组定义：逾期 `< 今天`；今天 `= 今天`；本周 `今天+1 … 本周日`；以后 `> 本周日`；未排期 `due = null`。完成态任务默认不出现（与 `TasksPanel` 的 `open` 过滤一致），可加"显示已完成"开关。
- 头部视图切换：`月 | 日 | 周` 段控件，**默认月**；切到日/周时左栏替换为全宽视图，任务列表仍保留在右栏（日/周只占左栏时宽度不足，因此切到日/周时改为**单栏铺满 + 顶部返回月视图**），这是唯一需要明确的分支：
  - 月视图 = 左月 + 右任务（默认）
  - 日/周视图 = 全宽时间网格，任务列表收起（头部有"任务"按钮可切回）；宽 <420 时周自动降级为月，宽 <320 时日降级为议程（复用 `resolveCalendarViewMode`）。
- 高度：弹窗约 `min(84vh, 640px)`；月网格 6×44 + 头部 ≈ 330px，剩余给任务列表滚动。

---

## 4. 联动机制（具体到字段与调用）

**新增 `app/src/stores/calendar.ts`**（Pinia），单一事实源：

```ts
state: {
  focusDate: string;      // localDateKey(new Date()) 初始化，'YYYY-MM-DD'
  view: 'month' | 'day' | 'week';   // 默认 'month'
  dialogOpen: boolean;
}
actions: {
  setFocusDate(date: string)     // 两侧唯一写入口
  shiftMonth(±1)                 // 内部 addDays(focusDate, ±1) 并保持日号
  setView(v)
  openDialog(date?: string)      // 可选带入日期；设置 dialogOpen
  closeDialog()
}
```

- **月份一致**：迷你月与弹窗都不各自持有 cursor，全部 `computed(() => monthGridRange(store.focusDate))`；任一处的"上一月/下一月"或点日期都只调 `setFocusDate`，两处天然同月同日。
- **持久化**：`focusDate` / `view` 写 `localStorage`，键 `solomd.calendar.v1::<folder>`（与 `tabs.ts` 的 per-workspace bucket 同构，按工作区独立；不做跨设备同步）。`dialogOpen` 不持久化。
- **侧栏迷你月**（292px）：只读月网格，点一天 = `setFocusDate` + `openDialog()`（点击即打开详细视图，符合"主用月"）。
- **任务点击跳笔记并定位行**：复用 `TasksPanel.vue` L73-84 既有路径：
  1. `closeDialog()`（让编辑区可见）
  2. `await files.openPath(task.path, { bypassNewWindow: true })`
  3. `setTimeout(120ms)` 后 `window.dispatchEvent(new CustomEvent('solomd:outline-goto', { detail: { line: task.line, paneId: tiles.focusedPaneId } }))`
  - 复选框点击 `@click.stop` → `useTasks.toggle(task)`（已实现：打开 tab 走 `saveTab`，否则 `read_file → write_file`，行号失效只警告不写）。
- **事件点击**：`files.openPath(event.path, { bypassNewWindow: true })`，事件笔记无行号，打开即定位文首（与 M1 `openEvent` 同）。
- 焦点日期在弹窗内的作用：月网格高亮当天/焦点日；切到日/周时以 `focusDate` 为锚；任务列表本身是绝对分组，不随焦点日过滤（避免"选了某天列表就空了"的困惑）。

---

## 5. 移动端 / 窄屏退化

- 触发：`window.innerWidth < 720`（复用现有 `isNarrowViewport` 语义）。
- `DsModal`：`width = 100%`，去圆角/外边距（`class` 落在 `.ds-modal` 上，覆盖 `padding`）。
- 排布：**上下堆叠**——月视图在上（6 行 × 36px ≈ 250px，固定不滚动），任务列表在下（`flex:1` 独立滚动）。
- 任务列表**默认展开**（用户主用任务），不做"默认收起"；仅在高度 < 480px 时提供折叠按钮，避免月视图被挤没。
- 日/周视图：窄屏全宽仍按 `resolveCalendarViewMode` 降级（周 <420 → 月；日 <320 → 议程）。
- 键盘：移动端无 Esc，关闭依赖头部 ×（`DsModal` 已提供）；不需要额外手势。

---

## 6. 改动面（实施阶段）

| 文件 | 改动 |
| --- | --- |
| 新增 `app/src/stores/calendar.ts` | `focusDate` / `view` / `dialogOpen` + 按工作区持久化 |
| 新增 `app/src/components/calendar/CalendarWorkspace.vue` | 共享视图：月/日/周 + 月左/任务右布局；只认 width + store；M2 编辑/拖拽也放这里 |
| 新增 `app/src/components/calendar/CalendarTaskGroups.vue`（可并入） | 逾期/今天/本周/以后/未排期分组 + 勾选 + 跳转 |
| 新增 `app/src/components/CalendarDialog.vue` | `DsModal` 薄壳：900px 布局、窄屏堆叠、Esc/关闭 |
| `app/src/App.vue` | 挂载 `CalendarDialog`；菜单/命令入口调 `openDialog` |
| `app/src/components/CalendarPanel.vue` | 改为迷你月（侧栏），删除侧栏内日/周/议程与编辑入口 |
| `app/src/lib/calendar-view.ts` | 复用 `monthGridRange` / `resolveCalendarViewMode` / `buildCalendarView`；可能新增纯函数 `groupTasksByDue(tasks, today)`（含单测） |
| i18n 15 语言 | 弹窗标题、视图切换、任务分组、迷你月、空态 |
| 不改 | Rust、`buildCalendarIndex` 语义、`writeCalendarEvent` / `patchFrontmatter` |

原 M2 七项（新建、编辑、15 分钟吸附、下缘改时长、CANCELLED 删除、任务勾选、冲突重读）**要求不变，只把宿主从侧栏换成弹窗**。

---

## 7. 落地顺序与粗成本

1. **S1** `stores/calendar.ts` + 纯函数 `groupTasksByDue` + 单测（0.5–1 人日）
2. **S2** 侧栏迷你月（替换现有 `CalendarPanel` 的详细视图）（1–1.5）
3. **S3** `CalendarDialog` + 月视图 + 任务分组（只读）（2–3）
4. **S4** 焦点联动 + 跳笔记定位 + i18n（0.5–1）→ **此时只读版可用（约 4–5 人日）**
5. **S5** 弹窗内 M2 编辑与拖拽（4–6）→ 总 8–12 人日

---

## 8. 风险

- `DsModal` body 默认滚动，不改成 fill 会出现"两栏各自滚动 + 外层再滚"的双滚动条。
- 日/周全宽与任务列表并排时左栏过窄，必须二选一（月=双栏，日/周=单栏）。
- `solomd:outline-goto` 需要正确的 `paneId` 与 120ms 延迟，弹窗关闭后立即派发可能落空。
- 焦点陷阱开启时，月网格/任务行若大量用 `tabindex` 会拖慢 Tab 循环；只让格子和复选框可聚焦。
- 按工作区持久化时，切换工作区焦点日期会各自独立（预期，但需接受）。

---

## 9. 需确认

1. 默认 900px 下左月 **360** / 右任务自适应，是否接受？
2. 迷你月单击 = 选中并打开弹窗（推荐）？
3. 日/周是否接受"单栏铺满、任务列表收起"？
4. 任务列表默认只显示未完成，是否足够？
