# 侧栏外壳改造 · 第二段：同侧多区域（上下分区）

状态：**第一批（规格 + 数据层）与第二批（UI 代码）均已交付**；真机目视核对待执行（2026-11-11）。
修订（2026-11-12）：D3 / D4 / D5 的「`files` 区域锁定」已废止，改为**所有面板平等**，详见 §7；下文相应条目已同步。
上游：`docs/specs/sidebar-shell-stage1/spec.md` §6「第二段预告」。
命名：本目录是「外壳 stage1」的续作，与旧 Dock 序列 `docs/specs/sidebar-dock-s2/`（平铺 `panes[]` 模型）无关。

硬约束：不 push、不改版本号、不改 git 历史、不新增依赖、不改 Rust。

## 1. 目标与范围

第一段把两侧改成「一个 `<aside>` 里一条图标标签条 + 一个面板体」，并在数据模型里预留了 `groups[]`。第二段让同一侧可以有**多个上下堆叠的区域**，每个区域有自己的标签条、激活面板与高度。

第一批交付**规格 + 纯函数 + 单测**，即所有可以在无 GUI 环境下验证的契约：

- `SidebarDockGroup.height`：区域高度；
- 拆分 / 合并 / 调高三个纯函数；
- `sanitizeSidebarDock` 对旧 blob 的兼容与清洗；
- `files` 与其它面板平等的数据契约（2026-11-12 修订；原「锁定规则」见 §7）；
- 跨区域拖拽删除空组时的高度归并。

第二批交付 UI（多条 strip、splitter、菜单动作、15 语言 i18n、store / App 接线），见 §4 与 `tasks.md`；这部分的视觉效果只能靠真机目视确认，当前全部标注「未测」。

## 2. 关键决策

| 编号 | 决策 |
|---|---|
| D1 | `height` 是**相对权重**（默认 1），不是像素。窗口缩放时各区域按权重分，避免存储绝对高度在小窗口溢出。渲染用 `flex: <height> 1 0%`。范围 `[0.25, 4]`，两位小数。 |
| D2 | **不新增迁移标记、不改持久化键**。字段可选；旧 blob 无 `height` 视为 1，`sanitizeSidebarDock` 幂等兜底。第一段承诺「第二段不再迁移 schema」，这里兑现。 |
| D3 | **面板平等**（2026-11-12 修订，取代原「files 区域锁定」）：`files` 是普通面板，可拖到任一侧/区域、可隐藏、可关闭、可从 `+` 与 View › Panels 加回；`sanitizeSidebarDock` 不再把它钉到 `groups.left[0]`，也不再强制 `visible.files = true`。`PRIMARY_PANE_ID` / `PRIMARY_SIDE` 只保留作默认布局与 V1 迁移标识。 |
| D4 | **拆分** `appendToNewRegion(state, side, paneId)`：把任意已实现 pane（含 `files`）从所在区域摘出，在 `side` 末尾新建区域；空源区域折叠。拖标签到列主体触发拆分，拖到标签条则走 `moveDockTab` 插入/合并。未知 / pending pane 返回原 state。 |
| D5 | **合并** `mergeDockGroups(side, groupIndex)`：把 `groupIndex + 1` 的 panes 追加到 `groupIndex` 之后并删除前者；权重相加后 clamp；`active` 优先保留目标区域的激活项，无效时回退来源区域，再回退首个 pane。含 `files` 的区域不再被拒绝。 |
| D6 | `moveDockTab` 删除空区域时，把被删区域的权重归并给相邻区域，避免总权重丢失导致剩余区域被意外压缩。 |
| D7 | 纯函数一律返回**新 state**，失败/非法输入返回原 `state` 引用，便于 store 判断是否 persist。 |

## 3. 数据契约（第一批已实现）

文件：`app/src/lib/sidebar-dock.ts`

```ts
interface SidebarDockGroup { panes: SidebarPaneId[]; active: SidebarPaneId | null; height?: number }
const DOCK_GROUP_DEFAULT_HEIGHT = 1;
const DOCK_GROUP_MIN_HEIGHT = 0.25;
const DOCK_GROUP_MAX_HEIGHT = 4;
function clampGroupHeight(value: unknown): number;
function appendToNewRegion(state, side, paneId): SidebarDockState;
function primaryPaneSide(state): SidebarSide;
function mergeDockGroups(state, side, groupIndex): SidebarDockState;
function setDockGroupHeight(state, side, groupIndex, height): SidebarDockState;
```

`sanitizeSidebarDock` 新增规则：

1. 遍历所有 group，`height` 为有限数时 clamp，否则保持缺省（不写入字段，保持旧对象形状）；
2. `height` 对所有区域一视同仁（2026-11-12 起不再删除含 `files` 区域的权重）；
3. 去重 / 未知 id / 追加新 pane / 激活项校验 / 宽度 clamp 沿用第一段逻辑；
4. 对同一 blob 重复调用结果一致（迁移幂等）。

`DockGroupView` 增加可选 `height?: number`，供第二批 `App.vue dockGroupsFor` 透传给组件；本批不改变渲染行为。

## 4. UI 契约（第二批，已交付）

| 项 | 要求 |
|---|---|
| 标签条 | `DockTabStrip.vue` 按 group 输出**多条** strip（当前 `:90-104` 把全部 group 扁平成一条）；每条带自己的 `+` 与溢出菜单。 |
| 拖放命中 | `SidebarDock.vue:288` 与 `DockTabStrip.vue:342` 的 `data-dock-group="0"` 改为真实 group 索引；`DockDropTarget.group` 已在类型层就绪。 |
| 高度 | 区域之间加 splitter，`settings.setDockRegionHeight(side, index, height)` 写回持久化；所有区域都可显示 splitter 并调高。 |
| 动作入口 | 拆分/合并由拖拽完成（列主体=新建区域，标签条=插入/合并），右键菜单只保留 close / move / manage；`+` 与 View › Panels 含文件树开关；15 语言文案中性化。 |
| store | `settings.ts` 包装纯函数并 `persist()`；`showFileTree` 是派生镜像，⌘B 跟随 `files` 所在侧。 |
| `files` | 与普通面板一致：可拖、可拆、可合并、可调高、可隐藏；不再固定 `left[0]`。 |

## 5. 验收

- `pnpm test`：覆盖 D2–D7（迁移幂等、clamp、拆分/合并、跨区域拖拽、空组权重归并）与 2026-11-12 的 files 平等化用例；全量全绿。
- `pnpm build`（含 `vue-tsc --noEmit`）通过。
- GUI：`docs/regression-checklist.md` 已扩展 N9–N13 并在 P 组留签署行；本环境无法起 Tauri GUI，视觉项目前全部标注「未测」。

## 6. 明确不做

- 区域嵌套、每区域独立宽度、跨侧移动整个区域（已有 `moveDockTab` 逐标签跨侧）；
- 持久化绝对像素高度；
- 复活已停用的 `rightSidebarPaneHeights` / `RsSplitter.vue` 死代码；
- 修改 `LS_KEY` 或新增 `v513` 迁移标记。

## 7. 修订记录：`files` 面板平等化（2026-11-12）

**动机**：第一段把 `files` 钉死在左列，理由是删掉 activity rail 后「折叠后怕找不到回到文件树的入口」。第二段之后两侧都有标签条、`+` 与 header toggle，入口不再依赖钉死；用户确认改为**所有面板完全平等**。

**废止的锁定**（原 D3 / D4 / D5 及第一段 pane 级锁定）：

- `isMovablePane('files') === false`、拖拽起点拒绝 `files`；
- `sanitizeSidebarDock` 把 `files` 从所有区域剔除再 `unshift` 回 `groups.left[0].panes[0]`，删除该区域 `height`，并强制 `visible.files = true`（这是「拖完重启回弹」的根因）；
- `moveDockTab` 左列插入位置 clamp 到 `files` 之后、含 `files` 的空组不继承权重；
- `isLockedGroup` 让含 `files` 的区域不可合并、不可调高、不显示 splitter；
- `context-menus.ts` / `App.vue` 的 `panePinned` 禁用 close / move；`toggleDockPane` / `hideDockPane` / `movePaneToSide` 的 `files` 提前返回；`App.vue dockPaneVisible.files = true` 硬编码；`+` 与 View › Panels 不含文件树。

**新语义**：

- 运行时只认 `visible` 映射；`files` 可拖到任一侧/区域、可拆成独立区域、可隐藏、可关闭，从 `+` / View › Panels / 命令面板加回。
- 拆分统一走 `appendToNewRegion(state, side, paneId)`：拖标签到列主体=在该列底部新建区域（整列高亮），拖到标签条=`moveDockTab` 插入/合并。空源区域折叠；一侧无面板时该列自然不渲染。
- `showFileTree` 改为派生镜像：`visible.files && !collapsed[primaryPaneSide(dock)]`。`toggleFileTree()`（⌘B / View / Settings / 工具栏）跟随 `files` 实际所在侧；若面板被关掉则重新加回并激活。`syncLegacySwitches()` 与 `load()` 都按此重算，不新增迁移标记。
- `PRIMARY_PANE_ID` / `PRIMARY_SIDE` 保留，仅用于注册表默认布局与 V1 一次性迁移；`visibility: 'always'` 保留以免改动迁移分支把老 blob 判成隐藏。
- `mergeFilesPane` / `migrateSidebarDock` 写出的「files 在左」是 V1 默认布局，不是运行时约束。
- 15 语言的 `menubar.toggleFileTree` / `header.leftSidebarTooltip` / `header.showSidebar` / `cmd.view.toggleFileTree` 改为「文件树」类中性表述；`toast.outlineMovedToSecondary` 保留原措辞，因其描述 V1 迁移当时发生的历史事实。

**验收**：回归清单 N5 / N11 / N12 / N13；`sidebar-dock.test.ts` 与 `context-menus.test.ts` 已把「files 被 pin」断言改写为平等行为断言。本机 `node_modules` 损坏，`pnpm test` / `vue-tsc` 需在正常环境执行。
