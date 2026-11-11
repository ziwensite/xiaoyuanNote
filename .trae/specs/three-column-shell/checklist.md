# Checklist — 三列外壳

- [x] `shellColumnWidths` 为纯函数；中列最小 360，两侧先保底 212、再按超出比例收缩；显示宽不回写存储值。
- [x] 左/右列各自是一个 `<aside>`：52px 表头 + 正文同宽；列宽只来自 `columns`，没有第二处宽度同步。
- [x] `.shell__column { flex: 0 0 auto }`，中列 `flex: 1` 吃掉剩余宽度。
- [x] 收起某侧时整列 `v-if` 卸载，不留残线；对应 toggle 仍在顶行/中列头且可聚焦。
- [x] 平板：左列改抽屉（`overlay` 32px 条），右列仍是列。
- [x] 手机（≤600）：无列，无左抽屉，右抽屉 overlay。
- [x] mac 交通灯 80px：左列可见时由左列头承担；左列不可见时由中列头承担（`macInset` prop）。
- [x] `DockTabStrip` 列内 `width:100%`，`ResizeObserver` 读自身 `clientWidth`，`»` 随列宽每帧重算；删除了窗口级 cap。
- [x] `SidebarDock` 拖拽起点用显示宽，拖拽中每次 `mousemove` 写 `settings.setDockWidth`。
- [x] Windows 44px 行：导出 + 左/右 toggle 位于 `.win-controls` 左侧，`data-no-drag` 排除拖窗。
- [x] 52px 表头不再放导出/toggle；`⋯` 在编辑器表头（模式切换之后）。
- [x] 导出菜单 Teleport 位于组件根级（单份），Windows 顶行与 mac 中列头共用。
- [x] 手机导航条行为保持不变（返回、标题、预览、导出、More）。
- [x] `pnpm build`（`vue-tsc --noEmit && vite build`）通过：built in 25.03s。
- [x] `pnpm test`：702 pass / 0 fail（8094ms）。

> 归档注记：以上为 2026-11-09 Trae 阶段的历史验收数字，保留不改。2026-11-11 复测基线：978 tests / 978 pass / 0 fail，`pnpm build` 29.94s，`cargo test --lib` 259、`--bin SoloMD` 267 全过。
