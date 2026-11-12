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
4. ~~`files` 所在区域无拆分/合并/调高入口~~ → 2026-11-12 修订后改为「`files` 区域与其它区域一样可拆分/合并/调高」，见下方第三批与 `spec.md` §7、回归清单 N5/N11/N13。
5. 窄屏 / 平板抽屉 / Mac 交通灯 / Agent 自动加宽 472 无回归。

## 第三批 · 修订：`files` 面板平等化（2026-11-12）

用户确认「所有面板都平等」（两侧都有标签条 / `+` / toggle，入口不再依赖把文件树钉在左列）。详见 `spec.md` §7。

- [x] V1 数据层：`isMovablePane` 放开 `files`；`sanitizeSidebarDock` 去掉 pin / `height` 删除 / `visible.files = true` 强制；`moveDockTab` 去掉左列 clamp 与权重继承特判；删除 `isLockedGroup`，`mergeDockGroups` / `setDockGroupHeight` 不再拒绝 `files` 区域；`moveAllPanesToSide` 真正移动全部面板。
- [x] V2 `appendToNewRegion` 取代 `splitDockGroup`；新增 `primaryPaneSide()`。
- [x] V3 store：`toggleFileTree` / `syncLegacySwitches` / `load()` 让 `showFileTree` 成为派生镜像并跟随 `files` 所在侧；`toggleDockPane` / `hideDockPane` / `movePaneToSide` 放开 `files`；`splitDockRegionFromDrag` 展开目标列。
- [x] V4 UI：`App.vue dockPaneVisible.files` 读实际开关；菜单取消 `panePinned`；`+` 与 View › Panels / 命令面板新增文件树开关；`SidebarDock` 所有区域可 splitter / 调高；`DockTabStrip` 去掉插入位置 clamp；跨侧拆分时目标列也高亮。
- [x] V5 15 语言：菜单项 / tooltip / 命令面板文案改为「文件树」中性表述；`toast.outlineMovedToSecondary` 作为 V1 历史迁移提示保留原措辞。
- [x] V6 单测：`sidebar-dock.test.ts` / `context-menus.test.ts` 把「files 被 pin」断言改写为平等行为断言；`app-menu.test.ts` / `context-menus.test.ts` 补 `panes.files` 与命令白名单。
- [ ] V7 真机验证：`pnpm test` / `pnpm build` / GUI 按回归清单 N5、N11、N12、N13 逐项填 PASS/FAIL（本机 `node_modules` 损坏，需在正常环境执行）。
