# 侧栏外壳改造 · 第二段：同侧多区域（上下分区）

状态：**第一批（规格 + 数据层）与第二批（UI 代码）均已交付**；真机目视核对待执行（2026-11-11）。
上游：`docs/specs/sidebar-shell-stage1/spec.md` §6「第二段预告」。
命名：本目录是「外壳 stage1」的续作，与旧 Dock 序列 `docs/specs/sidebar-dock-s2/`（平铺 `panes[]` 模型）无关。

硬约束：不 push、不改版本号、不改 git 历史、不新增依赖、不改 Rust。

## 1. 目标与范围

第一段把两侧改成「一个 `<aside>` 里一条图标标签条 + 一个面板体」，并在数据模型里预留了 `groups[]`。第二段让同一侧可以有**多个上下堆叠的区域**，每个区域有自己的标签条、激活面板与高度。

第一批交付**规格 + 纯函数 + 单测**，即所有可以在无 GUI 环境下验证的契约：

- `SidebarDockGroup.height`：区域高度；
- 拆分 / 合并 / 调高三个纯函数；
- `sanitizeSidebarDock` 对旧 blob 的兼容与清洗；
- `files` 所在区域的锁定规则；
- 跨区域拖拽删除空组时的高度归并。

第二批交付 UI（多条 strip、splitter、菜单动作、15 语言 i18n、store / App 接线），见 §4 与 `tasks.md`；这部分的视觉效果只能靠真机目视确认，当前全部标注「未测」。

## 2. 关键决策

| 编号 | 决策 |
|---|---|
| D1 | `height` 是**相对权重**（默认 1），不是像素。窗口缩放时各区域按权重分，避免存储绝对高度在小窗口溢出。渲染用 `flex: <height> 1 0%`。范围 `[0.25, 4]`，两位小数。 |
| D2 | **不新增迁移标记、不改持久化键**。字段可选；旧 blob 无 `height` 视为 1，`sanitizeSidebarDock` 幂等兜底。第一段承诺「第二段不再迁移 schema」，这里兑现。 |
| D3 | **files 区域锁定**：`files` 永远在 `groups.left[0]`；该区域不可拆分、不可作为合并的来源或目标、不可调高，高度恒等于默认权重。锁定是 pane 级锁定的自然延伸（第一段已锁 pane）。 |
| D4 | **拆分** `splitDockGroup(side, groupIndex, paneId)`：从源区域抽出一个可移动 pane，新建区域插在其后；两边平分源权重；源区域至少保留 1 个 pane（否则拒绝）；新区域 `active = paneId`。files 区域、未知 pane、单标签区域一律返回原 state。 |
| D5 | **合并** `mergeDockGroups(side, groupIndex)`：把 `groupIndex + 1` 的 panes 追加到 `groupIndex` 之后并删除前者；权重相加后 clamp；`active` 优先保留目标区域的激活项，无效时回退来源区域，再回退首个 pane。含 files 的任一侧参与则拒绝。 |
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
function splitDockGroup(state, side, groupIndex, paneId): SidebarDockState;
function mergeDockGroups(state, side, groupIndex): SidebarDockState;
function setDockGroupHeight(state, side, groupIndex, height): SidebarDockState;
```

`sanitizeSidebarDock` 新增规则：

1. 遍历所有 group，`height` 为有限数时 clamp，否则保持缺省（不写入字段，保持旧对象形状）；
2. 含 `files` 的主区域删除 `height`，即永远按默认权重渲染；
3. 去重 / 未知 id / 追加新 pane / 激活项校验 / 宽度 clamp 沿用第一段逻辑；
4. 对同一 blob 重复调用结果一致（迁移幂等）。

`DockGroupView` 增加可选 `height?: number`，供第二批 `App.vue dockGroupsFor` 透传给组件；本批不改变渲染行为。

## 4. UI 契约（第二批，已交付）

| 项 | 要求 |
|---|---|
| 标签条 | `DockTabStrip.vue` 按 group 输出**多条** strip（当前 `:90-104` 把全部 group 扁平成一条）；每条带自己的 `+` 与溢出菜单。 |
| 拖放命中 | `SidebarDock.vue:288` 与 `DockTabStrip.vue:342` 的 `data-dock-group="0"` 改为真实 group 索引；`DockDropTarget.group` 已在类型层就绪。 |
| 高度 | 区域之间加 splitter，`settings.setDockRegionHeight(side, index, height)` 写回持久化；files 区域不显示 splitter。 |
| 动作入口 | 标签右键菜单加「拆分到新区域」「与下/上一区域合并」，复用 `lib/context-menus.ts` 的 builder 与既有命令派发；15 语言补键。 |
| store | `settings.ts` 新增三个 action 包装纯函数并 `persist()`。 |
| `files` | 第一区域不显示拆分/合并/高度调整入口；拆分后仍固定 `left[0]`。 |

## 5. 验收

- `pnpm test`：新增 9 例覆盖 D2–D7（迁移幂等、clamp、拆分/合并、files 锁定、跨区域拖拽、空组权重归并）；全量全绿。
- `pnpm build`（含 `vue-tsc --noEmit`）通过。
- GUI：`docs/regression-checklist.md` 已扩展 N9–N12 并在 P 组留签署行；本环境无法起 Tauri GUI，视觉项目前全部标注「未测」。

## 6. 明确不做

- 区域嵌套、每区域独立宽度、跨侧移动整个区域（已有 `moveDockTab` 逐标签跨侧）；
- 持久化绝对像素高度；
- 复活已停用的 `rightSidebarPaneHeights` / `RsSplitter.vue` 死代码；
- 修改 `LS_KEY` 或新增 `v513` 迁移标记。
