# 三列外壳（Three-column shell）规格

状态：已交付（2026-11-09，实现提交 `0e40bbae` 等；2026-11-11 归档）。本文件为 Trae 阶段历史记录，保留原始决策不重写。
基线：`374a6101`、`31827030`（当前工作树未提交）
约束：**不 push、不改版本号**。两条路只留一条：删除"一行切三段"的工具栏实现，改成三列。

---

## 1. 目标结构

### Windows（44px 菜单行 + 52px 列头行）

```
┌ 44px 顶行：品牌 44 │ 菜单 7 项 │ 搜索框（弹性） │ 导出 32 │ 左toggle 32 │ 右toggle 32 │ ─ □ × 138 ┐
├ 左列（宽 = 左面板宽） ───────┬ 中列（编辑器，最小 360） ─────────┬ 右列（宽 = 右面板宽） ──────┤
│ 左列 52px 表头：图标标签条 │ 中列 52px 表头：编辑器标签 +    │ 右列 52px 表头：图标标签条 │
│                            │ 视图模式 + ⋯                    │                            │
├────────────────────────────┼────────────────────────────────┼────────────────────────────┤
│ 左面板正文（树/大纲/…）    │ 编辑器（TileRoot / 分屏）       │ 右面板正文（大纲/Agent/…） │
└────────────────────────────┴────────────────────────────────┴────────────────────────────┘
```

### macOS（只有一层 52px，即三列表头行）

```
┌ 52px 单行（三列表头；交通灯浮在最左可见列的 80px 内） ───────────────────────────────────────┐
│ 左列头：[80 inset][左toggle][左标签条] │ 中列头：[编辑器标签][模式][⋯][搜索][导出][右toggle] │ 右列头：右标签条 │
├───────────────────────────────────────┼────────────────────────────────────────────────────┼─────────────────┤
│ 左面板正文                            │ 编辑器（TileRoot / 分屏）                          │ 右面板正文      │
└───────────────────────────────────────┴────────────────────────────────────────────────────┴─────────────────┘
```

- Windows 才有菜单行；mac 菜单在系统全局菜单栏，**不套用 Windows 的两行结构**。
- 左右列的 52px 表头在列内，宽度与列**同一个 DOM 元素**，不存在两处数值同步。
- 中列 `#header-tabs` 保持原挂载点，PaneHost 不改；编辑器分屏仍在 `.content` 内。

---

## 2. 唯一的宽度来源

**唯一来源：`settings.sidebarDock.width[side]`（存储值）+ 当前侧活动 pane。**

- `natural(side) = effectiveDockWidth(storedWidth[side], activePaneId(side))`
  - `agent` 为活动 pane 且存储宽 ≤ 292 时取 472（沿用现有自动加宽）。
- `columns = shellColumnWidths({ shellWidth, left: naturalLeft|null, right: naturalRight|null })`
  - `null` = 该侧不显示（收起 / 平板抽屉 / 手机 / 无 pane）。
- 左/右列把 `columns.left/right` 作为 `aside` 的 `width` 与 `flex-basis`；表头和正文都在这个 `aside` 内，因此天然同宽。
- 拖拽：`SidebarDock` 的 resize handle 以**当前显示宽**为起点，`settings.setDockWidth` 实时写入；`aside` 宽度在同一个帧内变化，表头/正文不会出现中间态错位。
- `shellWidth` 由 `.shell` 的 `ResizeObserver` 提供，**不是** `window.innerWidth`（避免安全区内边距/缩放误差）。
- 被窗口挤压后的显示宽 **不回写** 存储值：窗口恢复后回到用户设定宽度。

---

## 3. 中列最小宽与收缩规则

常量（`app/src/lib/shell-columns.ts`）：

- `MIDDLE_MIN_WIDTH = 360`
- `SIDE_MIN_WIDTH = 212`（与 settings 的 MIN 一致）
- `SIDE_LAYOUT_FLOOR = 120`（极端窗口下的显示下限）

规则：

1. 两侧都不显示：`middle = shellWidth`。
2. 只显示一侧：`side = min(natural, max(0, shellWidth - 360))`；`middle = shellWidth - side`。
3. 两侧都显示：
   - `avail = max(0, shellWidth - 360)`。
   - `naturalL + naturalR <= avail`：原样。
   - `avail >= 424`：先各给 212，剩余 `avail-424` 按两侧"超出 212 的部分"成比例分配：
     `L = 212 + (naturalL-212) * (avail-424)/((naturalL-212)+(naturalR-212))`，R 同理。
   - `424 > avail >= 240`：先各给 120，剩余按"超出 120 的部分"成比例分配。
   - `avail < 240`：按 natural 比例分完 `avail`（仅 601px 附近可能出现）。
   - `middle = shellWidth - L - R`，取整后仍 ≥ 360。
4. 结果四舍五入到整数；`middle` 用 `shellWidth - L - R` 保证三列合计恰好等于 `shellWidth`。
5. 用户收起任一侧：该列组件卸载，`middle` 在同一次计算里直接变大，不做宽度过渡动画。

关键档位（两侧都开）：

| 窗口 | 存储左/右 | 可用侧宽 | 显示左 | 显示右 | 中列 |
|---|---|---|---|---|---|
| 1024 | 292 / 292 | 664 | 292 | 292 | 440 |
| 1024 | 560 / 560 | 664 | 332 | 332 | 360 |
| 1280 | 292 / 292 | 920 | 292 | 292 | 696 |
| 1280 | 560 / 560 | 920 | 460 | 460 | 360 |
| 1440 | 560 / 560 | 1080 | 540 | 540 | 360 |
| 784 | 560 / 560 | 424 | 212 | 212 | 360 |
| 601 | 292 / 292 | 241 | ~120 | ~121 | 360 |

- `≤ 600px`：进入手机外壳（抽屉），三列不成立。
- `601–1023px` 且 coarse pointer：平板态，左列改为抽屉，右列仍是列（沿用现状）。

---

## 4. 顶行像素预算

### Windows 44px 行（顺序：品牌 / 菜单 / 搜索 / 导出 / 左toggle / 右toggle / 窗口按钮）

固定项：

| 项 | 宽度 | 说明 |
|---|---|---|
| 品牌 | 44 | 18px 图标 + 内边距 |
| 菜单 7 项 | 中文 ≈308 / 英文 ≈388 | 13px 字号 + 左右 9px |
| 导出 + 2 toggle | 32×3 + 2×2 gap + 12 padding = **110** | `pointer: coarse` 时每个 40 |
| 窗口按钮 | 46×3 = **138** | ─ □ × |
| 搜索框 | `flex: 1 1 0`，上限 420、下限 160 | 外层左右 12px padding |

| 窗口 | 语言 | 固定合计 | 搜索可用 | 结果 |
|---|---|---|---|---|
| 1024 | 中文 | 600 | 424 | 搜索 ≈400，无挤压 |
| 1024 | 英文 | 680 | 344 | 搜索 344，无挤压 |
| 1280 | 中文 | 600 | 680 | 搜索封顶 420，余量 236 |
| 1280 | 英文 | 680 | 600 | 搜索封顶 420，余量 180 |

让位顺序（仅在更窄时触发）：

1. 搜索框 420 → 160（仍常显，不改成图标）。
2. 搜索到 160 后仍不足（< 838 中文 / < 918 英文）：本规格不处理，因为要求的 1024/1280 两档都无需让位。
3. 导出、两个 toggle、菜单、窗口按钮 **不压缩、不隐藏**。

结论：**1024 与 1280 均不需要收起任何入口**，不触发"先停下报我"的条件。

### mac 52px 单行（中列头同时承载应用控件）

中列头固定控件 ≈ 搜索 160 + 导出 32 + 右toggle 32 + 内边距/间距 ≈ 250；左toggle 在左端，约 32+间距。左列默认 292 时中列 = 732，余量 ≈ 450；`<470` 所以模式切换折进 `⋯`，编辑器标签仍有约 400。两侧都开且到 360 下限时，中列只剩约 60–80 给标签/⋯，标签条横向滚动、模式已折进 `⋯`。**不把搜索改成图标**，不砍入口。

---

## 5. mac 交通灯 80px 归属表

| 左列 | 右列 | 最左可见列 | 80px 由谁承担 |
|---|---|---|---|
| 显示 | 任意 | 左列 | 左列表头（`padding-left: 80`） |
| 收起 | 显示 | 中列 | 中列表头（`padding-left: 80`） |
| 收起 | 收起 | 中列 | 中列表头（`padding-left: 80`） |
| 不显示（平板抽屉） | 任意 | 中列 | 中列表头（`padding-left: 80`） |
| 手机 | — | 手机导航条 | 现有 `MAC_TRAFFIC_INSET` 逻辑 |

右列永远不会是最左可见列（中列始终存在）。Windows 无 inset。

### mac 左列 212 的密度结论

- 可用内容宽 = 212 − 80 = 132。
- 标签条几何：溢出态总宽 `62 + 28n`（n = 可见标签数）。
- n=2 → 118 ≤ 132；n=3 → 146 > 132。
- 因此 212px 时显示 **2 个图标 + `»` + `+`**（共 4 个 26px 控件）。
- **结论：可接受**。`files` 固定第一个始终可见；其余面板在 `»`（图标 + 名称）里全部可达，`+` 保留。没有砍入口，不触发报批条件。
- 备选（未实施，若你选它我再改）：mac 下左列最小宽抬到 260 → 内容 180 → 4 图标 + `»` + `+`；或把 toggle/搜索完全移到中列右侧（本规格已是右侧放置，仅在左列密度上不解决 212 的问题）。

---

## 6. 列边界、收起态、抽屉、手机

- 左列 `aside`：`border-right: var(--bd-hair)`；右列：`border-left: var(--bd-hair)`；中列无竖线。
- 每列表头 `height: var(--header-h)` + `border-bottom: var(--bd-hair)`，三条同高，视觉上是一条横线。
- 收起 = 整列卸载：不留 1px 残线，不留空白；对应 toggle 仍在顶行/中列头（唯一重开入口）。
- 拖拽柄：8px 命中区、无可见线，覆盖整列（表头 + 正文），拖表头边缘也能改宽。
- 平板：左列变抽屉（`overlay`，保留 32px 条），右列仍为列；中列头在 mac 承担 80px。
- 手机（≤600）：无列；左抽屉不渲染，右抽屉 `overlay`；顶行是手机导航条。
- 两侧都收起：`.shell` 只剩中列，宽度全给编辑器。

---

## 7. 标签条与列宽联动

- `DockTabStrip` 不再使用 `min(面板宽, 25% 视口)` 的窗口级 cap。
- 列内标签条 `width: 100%; min-width: 0`，`ResizeObserver` 读自身 `clientWidth`。
- `dockStripLayout(tabs.length, measured)` 每次列宽变化（含拖拽中的每一帧）立即重算 `»`。
- 溢出时不再需要"定宽反馈环"：`width: 100%` 已经是确定宽度。
- 抽屉模式仍为 32px 高、上限 320。

---

## 8. 编辑器分屏

- `#header-tabs` 仍是中列头内的唯一挂载点，PaneHost 的 teleport 目标不变。
- `TileRoot`、`BasesView`、`InboxView`、`TypeLensView`、`ViewNoteList` 的 `v-if` 链仍完整保留在 `.content` 内。
- 不改 `solomd.tiles.v1` 的 store 与 PaneHost。

---

## 9. 需要改动的文件与函数

### 新增

1. `app/src/lib/shell-columns.ts`
   - `MIDDLE_MIN_WIDTH = 360`
   - `SIDE_MIN_WIDTH = 212`
   - `SIDE_LAYOUT_FLOOR = 120`
   - `shellColumnWidths(input: { shellWidth: number; left: number | null; right: number | null }): { left: number; right: number; middle: number }`
   - 按第 3 节规则实现；输入非有限/负数按 0 处理。
2. `app/src/lib/shell-columns.test.ts`（`node:test` + `node:assert/strict`）
   - 两侧不显示；单侧封顶；1024/1280/1440 的 292/560 档；784 与 601 的 floor；总宽恒等于窗口；不修改输入。
3. `app/src/lib/window-drag.ts`
   - `isInteractiveChromeTarget(el)`：从 Toolbar 抽出选择器（button/input/select/textarea/a/[role=tab]/[contenteditable]/.dropdown__menu/[data-no-drag]）。
   - `dragWindowFromChrome(e)`：`customTitleBar && button===0 && detail<=1 && !interactive && __TAURI_INTERNALS__` 时 `startDragging()`；返回是否已处理。
   - `toggleMaximizeFromChrome(e)` 同理（双击）。

### 修改

4. `app/src/lib/sidebar-dock.ts`
   - 新增 `AGENT_DOCK_WIDTH = 472`。
   - 新增 `dockActiveId(groups: readonly DockGroupView[]): ImplementedSidebarPaneId | null`：有活动且可渲染则用之，否则首个可渲染。
   - 新增 `effectiveDockWidth(stored: number, activeId: ImplementedSidebarPaneId | null): number`。
5. `app/src/lib/sidebar-dock.test.ts`
   - 补 `dockActiveId` 回退、`effectiveDockWidth`（agent 472 / 非 agent 原值）。
6. `app/src/lib/dock-strip-fit.ts` + `.test.ts`
   - 删除 `DOCK_STRIP_VIEWPORT_SHARE`、`dockStripCap` 及其测试；保留 `DOCK_TAB_SIZE/GAP/PAD/ADD_W/OVERFLOW_W`、`tabsWidth`、`dockStripLayout`。
7. `app/src/components/sidebar/DockTabStrip.vue`
   - Props 改为 `{ side; groups; maxWidth?; drawer? }`，删除 `dockWidth`。
   - 删除 `viewportW`、`cap`、window resize 监听；`stripStyle = { width: drawer ? undefined : '100%', maxWidth: maxWidth? }`。
   - 保留拖拽、`»`、键盘、Teleport；注释改为"列内表头/抽屉"。
8. `app/src/components/sidebar/SidebarDock.vue`
   - Props 增 `width?: number`（显示宽）、`trafficInset?: number`。
   - 非 `overlay`：`aside` 内先渲染 52px `dock-header`（`DockTabStrip` + `padding-left: trafficInset`），再渲染 groups；`aside` 样式 `width: width px; flex: 0 0 width px; min-width: 0`。
   - `overlay`：保持 32px 条与浮层定位，不渲染列头，不应用 width 样式。
   - resize 起点用 `props.width ?? 存储宽`；`setDockWidth` 实时写入。
   - 表头 `@mousedown.capture`/`@dblclick` 调 `window-drag.ts`（`customTitleBar` 下；标签按钮天然被排除）。
9. `app/src/components/Toolbar.vue`
   - **titlebar**（Windows）：搜索 wrap 之后、`.win-controls` 之前新增 `.titlebar__actions`（`data-no-drag`）：导出图标、左 toggle、右 toggle。导出按钮把 `e.currentTarget` 传给 `toggleDropdown('export', e, anchor)`。
   - **header**：
     - 删除左右两段与 `DockTabStrip`/`leftDockGroups`/`rightDockGroups`/`dockOverlay`/`manage-dock`。
     - 桌面态改为：`[左toggle（仅 !winTitleBar）] [middleSegEl: #header-tabs、seg、More 触发器] [搜索/导出/右toggle（仅 !winTitleBar）]`。
     - `⋯` 触发器只在中段；More 菜单 Teleport 块与导出菜单 Teleport 块移出 actions 容器、放在 header 根级（单份，不复制菜单）。
     - 手机态保留：左侧返回+标题；右侧预览、导出（仅 `!winTitleBar`）、More。
     - `paddingLeft` 仅在 `macTitleBar && !leftColumnExists` 时应用 80；新增 prop `macInset`（App 计算传入）。
     - 导出/More 的 `toggleDropdown` 增加可选 `anchor`；`lastTrigger` 用 anchor。
     - 移除 `isInteractiveTitleBarTarget`/`onTitleBarMouseDown`/`onTitleBarDblClick` 的本地实现，改用 `lib/window-drag.ts`。
   - CSS：删除 `.toolbar__seg--*`、`.toolbar__actions` 的左右段语义；新增 `.toolbar__center { flex:1 1 auto; min-width:0 }`、`.toolbar__app { flex:0 0 auto }`、`.titlebar__actions { display:flex; gap:2px; padding:0 6px }`；保留 32px/40px icon、手机规则。
10. `app/src/App.vue`
    - `shellEl` ref + `ResizeObserver` → `shellWidth`。
    - `leftNatural/rightNatural` = `effectiveDockWidth(存储宽, dockActiveId(groups))`。
    - `leftColumnVisible = hasLeftDock && !collapsed.left && !isNarrow && !isTabletOverlay`
    - `rightColumnVisible = hasRightDock && !collapsed.right && !isNarrow`
    - `columns = shellColumnWidths({ shellWidth, left: leftColumnVisible ? leftNatural : null, right: rightColumnVisible ? rightNatural : null })`
    - 模板 `.shell`：`<SidebarDock v-if=leftColumn … :width=columns.left :traffic-inset=…>` → `.main-col`（Toolbar、TelemetryBanner、workspace）→ `<SidebarDock v-if=rightColumn … :width=columns.right>`。
    - 平板左抽屉仍留在 `.workspace` 内（CSS 定位不变）；手机右抽屉同现状。
    - Toolbar 传 `:mac-inset="macTitleBar && !leftColumnVisible"`；不再传 dock groups/overlay/manage-dock。
    - 保留 scrim、phone screen、`v-show` 逻辑；`.main-col` 仍是中部列。
    - CSS：`.shell { flex-direction: row }`（已是）；`.main-col` flex:1；确认 `aside` 由组件自身设宽，App 不再给窄屏侧栏写 width。
11. 不需要改 i18n：复用 `header.showSidebar/hideSidebar`、`toolbar.rightSidebarTooltip`、`toolbar.exportTooltip`、`header.more`、`header.leftPanels/rightPanels/editorArea`、`sidebarDock.*`。

---

## 10. 老用户可见变化

- Windows：44px 顶行右侧多了导出 + 两个面板 toggle（在 ─ □ × 左边）；菜单与搜索不变。
- Windows：52px 行变成三列各自的表头；左/右面板的图标条回到列内（高度 32 → 52），面板正文净高 +32px（原先 52 全局头 + 32 条 = 84，现为 52 列头）。
- mac：仍只有一层 52px；左/右图标条在各自列头；导出/两个 toggle/搜索都在中列头；交通灯 80px 由最左列头承担。
- 拖面板边缘时表头与正文同步变宽（不再"松手后才对齐"）。
- `⋯` 从行最右移到编辑器表头内、模式切换之后。
- 左列变窄时 `»` 立即重算；不再按窗口宽算一次。
- 无入口被砍：菜单、搜索常显、导出、两个 toggle、左右标签条全部保留。

---

## 11. 目视核对清单

Windows：
1. 44px 行：品牌、7 菜单、搜索、导出、左 toggle、右 toggle、─ □ × 的顺序与间距；1024 时搜索约 400px；1280 时搜索封顶 420 且右侧有余量。
2. 52px 行：左列头标签与左面板左边缘对齐；中列头编辑器标签；右列头标签与右面板右边缘对齐；三者底边同一水平线。
3. 导出/More 下拉从正确按钮下方弹出；Esc 焦点回到触发按钮。
4. 表格 / 大纲 / Agent 正文顶部与同列标签条底边无缝，无 1px 残线。
5. 收起左列：左列消失、中列立即变宽、左 toggle 仍可点击且可聚焦。
6. 收起右列：同上，右 toggle 仍可用。
7. 两侧都收起：中列占满，编辑器标签/模式/⋯正常。
8. 拖动面板边缘：表头与正文一起变宽，无错位；宽度到 212/560 时停住。
9. 1024 且两侧 560：中列 360，两侧 332/332；`»` 随列宽变化。
10. 拖到 ≤600：进入手机导航条，无列。
11. 平板态（`?forceTabletOverlay`）：左抽屉浮起、右列仍为列、中列头承担 80px（mac）。

mac：
12. 只有一层 52px；交通灯左侧/中间列关系；左列存在时左列头从 80px 起算。
13. 左列收起后，中列头从 80px 起算（标签/搜索不被绿灯遮挡）。
14. 左列 212：显示 2 标签 + `»` + `+`；`»` 列表包含全部隐藏面板。
15. 左列头空白处可拖动窗口；点击标签不拖动窗口。
16. 中列头：搜索、导出、右 toggle 在最右；左 toggle 在最左；`⋯` 在模式切换后。
17. 两侧收起：中列头仍承担 80px。
18. 编辑器分屏（tiles 多 pane）：每个 pane 的标签条仍通过 `#header-tabs` 正常显示，不串列。

---

## 12. 验证与交付

- `pnpm test`：node:test，记录通过/失败数与耗时。
- `pnpm build`：`vue-tsc --noEmit && vite build`，记录成功与耗时。
- 不 push、不改版本号；完成后提交一个本地 commit。
- 交付说明包含：结构示意（本文第 1 节）、顶行预算（第 4 节）、中列最小宽与收缩（第 3 节）、inset 归属（第 5 节）、老用户变化（第 10 节）、核对清单（第 11 节）、真实测试数字。

---

## 13. 批准点

请确认以下三个已定决策（不需要我再改代码即可执行）：

1. 中列最小宽 **360**，收缩按"保底 + 超出部分成比例"，显示宽不回写存储值。
2. mac 左列 212 的 **2 图标 + » + +** 密度可接受；不抬高到 260。
3. Windows 44px 行在 1024/1280 均无需收起搜索或砍入口；搜索保持常显。
