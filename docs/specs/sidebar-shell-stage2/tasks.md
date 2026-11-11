# 第二段任务清单：同侧多区域

对应规格：`docs/specs/sidebar-shell-stage2/spec.md`。
状态：两批均已交付（代码层，2026-11-11）；UI 视觉核对待真机执行。
所有批次均不 push、不改版本号、不新增依赖、不改 Rust。

## 第一批 · 规格与数据层（2026-11-11 完成）

- [x] T1 写 `spec.md` / `tasks.md`，明确与旧 `sidebar-dock-s2` 无关、`height` 为相对权重、files 区域锁定。
- [x] T2 `app/src/lib/sidebar-dock.ts`：`SidebarDockGroup.height?`、`DOCK_GROUP_*` 常量、`clampGroupHeight()`、`cloneGroup` 保留字段、`DockGroupView.height?`。
- [x] T3 `sanitizeSidebarDock`：按组 clamp/缺省、`files` 主区域清除 `height`、重复调用幂等；旧 blob 形状不变。
- [x] T4 新增 `splitDockGroup` / `mergeDockGroups` / `setDockGroupHeight` 三个纯函数，失败返回原 state（D4/D5/D7）。
- [x] T5 `moveDockTab` 删除空区域时把权重归并给相邻区域（D6）。
- [x] T6 `app/src/lib/sidebar-dock.test.ts` 新增 9 例：迁移幂等、clamp、拆分、合并、files 锁定、非法输入、跨区域拖拽、空组权重归并。
- [x] T7 2026-11-11 实测 `pnpm test` 990 / 990 pass / 0 fail、`pnpm build` 28.28s 成功；单独 commit（不 push、不改版本号）。

## 第二批 · UI（2026-11-11 完成代码，待真机目视）

- [x] U1 `settings.ts` 新增 `splitDockRegion` / `mergeDockRegions` / `setDockRegionHeight` 三个 action 并 `persist()`。
- [x] U2 `App.vue dockGroupsFor` 透传 `group.height`；`SidebarDock.vue` 用权重渲染多个 body 的 flex。
- [x] U3 `DockTabStrip.vue` 按 group 输出多条 strip（当前扁平成一条），每条独立的 `+` / 溢出菜单。
- [x] U4 两处 `data-dock-group="0"` 改为真实索引；拖放 `over.group` 落到正确区域。
- [x] U5 区域 splitter + 高度写回；files 区域不显示 splitter；标签右键菜单加拆分/合并，`lib/context-menus.ts` 与 15 语言补键。
- [x] U6 `docs/regression-checklist.md` 扩展 N9–N12（多区域渲染、拖拽落区、高度持久化、files 锁定），真机 GUI 填 PASS/FAIL。

## 人工目视核对（本环境无法验证）

以下 5 项已落到 `docs/regression-checklist.md` 的 N9–N12 与 P 组第 5 行，当前全部「未测」；需真机 GUI 逐项填 PASS/FAIL。

1. 同侧两个区域上下堆叠，标签条各自独立、`+` 各自可用。
2. 拖动 splitter 改变高度，重启后保持。
3. 跨区域拖标签落到正确区域，源区域空后自动消失且高度不跳变。
4. `files` 所在区域无拆分/合并/调高入口。
5. 窄屏 / 平板抽屉 / Mac 交通灯 / Agent 自动加宽 472 无回归。
