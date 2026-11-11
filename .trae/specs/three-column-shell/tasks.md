# Tasks — 三列外壳

> 仅在 spec.md 批准后执行。每完成一项更新状态。
>
> 归档注记（2026-11-11）：T1–T7 全部完成，本文件为 Trae 阶段历史记录，文中的 702/702 是 2026-11-09 的验收数字；当前基线为 978 tests / 978 pass，见同目录 `checklist.md`。

1. **T1 几何与模型（纯函数 + 单测）** ✅（`pnpm test` 702/702）
   - 新建 `app/src/lib/shell-columns.ts`：`MIDDLE_MIN_WIDTH=360`、`SIDE_MIN_WIDTH=212`、`SIDE_LAYOUT_FLOOR=120`、`shellColumnWidths`。
   - 新建 `app/src/lib/shell-columns.test.ts`（node:test）：单侧/双侧/1024/1280/1440/784/601、总和守恒。
   - `sidebar-dock.ts`：`AGENT_DOCK_WIDTH`、`dockActiveId`、`effectiveDockWidth`；补 `sidebar-dock.test.ts`。
   - 精简 `dock-strip-fit.ts`：删 `dockStripCap` 与 viewport share，改对应测试。
   - 验证：`pnpm test`（此时应仍全绿）。

2. **T2 窗口拖拽抽离** ✅（`lib/window-drag.ts`，Toolbar 已复用）
   - 新建 `app/src/lib/window-drag.ts`，从 Toolbar 抽出交互目标判断、拖动、双击最大化。
   - Toolbar 改用该模块（行为不变）。

3. **T3 标签条改为列内表头** ✅
   - `DockTabStrip.vue`：删 `dockWidth`/cap/viewport，列内 `width:100%`，抽屉上限 320。
   - `SidebarDock.vue`：非 overlay 增加 52px 列头（含 traffic inset）、aside 用传入 width、resize 用显示宽；overlay 保持 32px 条。
   - 表头空白处支持窗口拖动（mac/Windows custom chrome），按钮不触发。

4. **T4 App 三列化** ✅
   - `.shell` 变三列：左列 aside │ `.main-col` │ 右列 aside。
   - 计算 `shellWidth`（ResizeObserver）、`leftNatural/rightNatural`、`leftColumnVisible/rightColumnVisible`、`columns`。
   - 平板左抽屉保留在 workspace；手机右抽屉不变。
   - 收起某侧整列卸载，无残线。

5. **T5 顶行与工具栏归位** ✅
   - Windows titlebar：搜索后新增导出 + 左/右 toggle，位于窗口按钮前。
   - header 桌面：删除左右段；中段 = 标签 + 模式 + `⋯`；mac/Linux 中列头右端放搜索/导出/右 toggle，左端放左 toggle。
   - 导出/More 菜单 Teleport 单份；`toggleDropdown` 支持 anchor。
   - 手机导航条保持原行为。
   - Toolbar 删除 dock props/emits，新增 `macInset`。

6. **T6 边界与对齐复核** ✅（静态核对；目视项见交付报告）
   - 1024/1280/1440 各档宽度；212–560；601/784/≤600；平板；两侧收起。
   - `»` 随列宽实时重算；拖拽中表头/正文同步。
   - mac 80px 归属：左列 / 中列（含平板、两侧收起）。

7. **T7 验证与提交** ✅（`pnpm test` 702/702；`pnpm build` 25.03s；未 push、未改版本号）
   - `pnpm test`、`pnpm build`，记录真实数字。
   - 只提交本次相关文件；不 push、不改版本号。
   - 输出交付报告（结构示意、预算表、最小宽规则、inset 表、老用户变化、核对清单）。
