# V1 规格：文件树并入主侧栏

> 状态：待批准（批准后按 `tasks.md` 执行）
> 依据：`docs/v1-file-tree-merge-comparison.md`（已确认的四条决策）
> 范围：仅本仓库 `app/`，不改 Rust、不改版本号、不加依赖、不 push。

---

## 1. 目标

把现在的四栏

```
[文件树列 Sidebar 260][左 Dock 32/292][编辑器][右 Dock 32/292]
```

收敛为三栏：

```
[左 Dock：rail 32 + Files 容器 260][编辑器][右 Dock 32/292]
```

文件树内容整体进入左 Dock 的 `files` 容器；左 Dock 收起时保留 32px rail。大纲默认放次侧栏（右），但允许用户把它移回左侧与文件树做标签页。

## 2. 已确认的决策

| # | 决策 |
|---|---|
| D1 | 大纲方案 A：默认进次侧栏；保留“移回主侧栏变成标签”的能力；原本 `outlineSide='left'` 的老用户升级时收到一次性提示。 |
| D2 | 主侧栏最小整体宽 **212**（=180 内容 + 32 rail），最大仍 560。 |
| D3 | `⌘⇧E` 不绑定；`⌘J` 不动；`⌘B` 只改语义与文案（收起保留 rail）。 |
| D4 | `files` 不进 Panels / `+` 清单，不能像普通面板那样被关掉。 |
| D5 | 新装首启：主侧栏展开（`files` 激活），次侧栏收起。 |

## 3. 现状代码事实（实施依据）

- 列结构：[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2182-L2240)：桌面 `Sidebar.left-stack` → `.main-col` → `.workspace`（左 `SidebarDock` / `.content` / 右 `SidebarDock`）。
- 文件树列：[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L231-L465)，宽度/拖柄 L193-212、L835-858，`FileTree embedded` L347。
- Dock：[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L104-L140)（宽度与拖拽）、L60-75（renderable/active/showBody）。
- 注册表：[sidebar-panes.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/panes/sidebar-panes.ts#L80-L214)（12 项，outline 当前 `defaultSide:'left'`）。
- Dock 状态：[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts)（`MIN_DOCK_WIDTH=240`、`defaultSidebarDock`、`sanitizeSidebarDock`、`moveAllPanesToSide`）。
- 持久化/迁移/动作：[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1040-L1063)（v510 迁移）、L1282-1287（`setOutlineSide` 会 `moveAllPanesToSide`）、L1304-1307（`toggleFileTree`）、L1362-1429（dock 动作）、L1566-1572（`setFileTreeWidth`）。
- 现有测试：[sidebar-dock.test.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.test.ts)（含全语言 key 完整性断言）。

## 4. 设计

### 4.1 注册表新增 `files` 容器

在 `sidebar-panes.ts`：

- `SidebarPaneId` 增加 `'files'`；`ImplementedSidebarPaneId` 自动包含。
- 新增可见性类型 `'always'`；`SidebarPaneVisibility = 'setting' | 'tab' | 'session' | 'always'`。`migrateSidebarDock` 对 `always` 取 `true`。
- `files` 定义为 **数组第一项**：

```ts
{
  id: 'files',
  visibility: 'always',
  defaultSide: 'left',
  defaultVisible: true,
  icon: 'folder',
  titleKey: 'rsPane.files',
  available: () => true,
}
```

- 无 `menuKey` → 不进 Panels 菜单；`SidebarDock` 的 `+` 菜单在 `App.vue` 手写，不含它。
- `outline.defaultSide` 从 `'left'` 改为 `'right'`（方案 A）。

### 4.2 状态与迁移（纯函数）

`sidebar-dock.ts`：

- `MIN_DOCK_WIDTH = 212`（注释：180 content + 32 rail）。
- `defaultSidebarDock()`：`files` 左、其余右；`active = { left: 'files', right: 'outline' }`；`collapsed = { left: false, right: true }`；宽度 292。
- `sanitizeSidebarDock()`：最后强制 `files` 的 `side='left'`、`visible=true`（防手改存储把文件树挪走/关掉）。
- `moveAllPanesToSide()`：`files` 永远保持 `side='left'`；若 `files` 原是 active，移动后 `active.left='files'`。
- 新增纯函数：

```ts
export function mergeFilesPane(
  state: SidebarDockState,
  opts: { showFileTree: boolean; fileTreeWidth: number; alreadyMerged: boolean },
): { dock: SidebarDockState; movedToSecondary: SidebarPaneId[] }
```

行为：
1. `alreadyMerged === true`：只净化（`sanitizeSidebarDock`），不重算宽度、不移动；保证重复执行无副作用。
2. 确保 `files` 存在且在左、`visible=true`（缺失时 unshift）。
3. 把左侧除 `files` 以外的面板全部移到右侧，记录到 `movedToSecondary`。
4. `active.left='files'`；`active.right` 优先保留原 `active.right`（若可用），否则 `movedToSecondary` 中的 `outline`，否则 `'outline'`。
5. `collapsed.left = !showFileTree`；`collapsed.right` 不变。
6. `width.left = clampDockWidth(fileTreeWidth + SIDEBAR_RAIL_WIDTH)`；`width.right` 不变。

### 4.3 `settings.ts`

接口/默认值：

- 新增 `v511FileTreeMerged: boolean`、`v511OutlineSideNoticeShown: boolean`。
- `defaults()`：标记均 `true`；`sidebarDock: defaultSidebarDock()`；移动端覆盖 `collapsed.left=true`（与 `showFileTree: !isMobile()` 对齐）。

`load()`（在 v510 迁移之后）：

```ts
if (!parsed.v511FileTreeMerged) {
  const r = mergeFilesPane(merged.sidebarDock, {
    showFileTree: merged.showFileTree,
    fileTreeWidth: merged.fileTreeWidth,
    alreadyMerged: false,
  });
  merged.sidebarDock = r.dock;
  merged.v511FileTreeMerged = true;
  merged.v511OutlineSideNoticeShown = r.movedToSecondary.length === 0;
} else {
  merged.sidebarDock = sanitizeSidebarDock(merged.sidebarDock);
}
```

动作：

- `toggleFileTree()`：翻转 `showFileTree`，同时 `sidebarDock.collapsed.left = !showFileTree`。
- `setDockCollapsed('left', v)` / `toggleDockCollapsed('left')`：镜像 `showFileTree = !v`。
- `showDockPane` / `focusDockPane` / `setActiveDockPane` / `toggleDockPane` 在左侧展开时同步 `showFileTree = true`。
- `setOutlineSide(side)` 收窄为**只移动 outline**：
  ```ts
  this.outlineSide = side;
  this.movePaneToSide('outline', side);
  this.sidebarDock.collapsed[side] = false;
  if (side === 'left') this.showFileTree = true;
  this.persist();
  ```
- `movePaneToSide('files', *)` 直接 return；`toggleDockPane` / `hideDockPane('files')` 直接 return。
- `fileTreeWidth` / `setFileTreeWidth` 保留为旧值（迁移读一次），不再作为运行时宽度源。

### 4.4 渲染

`Sidebar.vue`：
- 新增 `embedded?: boolean`。
- `embedded` 时：根节点加 `sb--embedded`；不渲染 `.sb__inset`（52px 折叠条）与 `.sb__resize`；CSS 设 `width:100%; flex:1 1 auto; border-right:0;`。
- 其余信息架构（搜索、今天/收件箱/最近、FileTree embedded、标签、Saved Views、footer 同步/设置）不变。
- `FileTree.vue` **一行不改**。

`SidebarPaneBody.vue`：
- 导入 `Sidebar`；`id === 'files'` 渲染 `<Sidebar embedded>`。
- 新增 emit `openQuickSwitcher`；转发 `open-settings`、`open-quick-switcher`、`filter-tag`。

`SidebarDock.vue`：
- 新增 emit `openQuickSwitcher` 并转发给 `SidebarPaneBody`。
- 其余不变；左 Dock 宽度由 `sidebarDock.width.left` 驱动（默认 292）。

`App.vue`：
- 删除桌面/平板独立的 `<Sidebar class="left-stack">`；保留手机 `variant="phone"`。
- 左 Dock：`v-if="hasLeftDock && !isNarrow"`，`:overlay="isTabletOverlay"`，绑定 `openQuickSwitcher`。
- `dockPaneVisible` 补 `files: true`。
- 平板浮层：左 Dock 作为抽屉，仅 `isTabletOverlay && !isNarrow && showFileTree` 时绝对定位 `min(86vw,320px)`；收起时回落到 32px rail。保留原 scrim 与 `toggleFileTree()` 关闭逻辑。
- 窄屏：不渲染左 Dock（手机首页仍是 `Sidebar variant="phone"`）；`closeNarrowDrawer()` 去掉对 `showFileTree` 的翻转，避免误关主侧栏。
- 平板/窄屏 CSS 中 `.left-stack` 选择器改为 `.side-sidebar--left`；删除失效的 `.left-stack` 规则。
- `onMounted`：若 `!settings.v511OutlineSideNoticeShown`，`toasts.info(t('toast.outlineMovedToSecondary'))` 后置 `true` 并 persist。

### 4.5 i18n（15 个语言全部补齐）

新增：
- `rsPane.files`（rail tooltip / tab 标签）。
- `toast.outlineMovedToSecondary`（一次性升级提示）。

文案调整（保持既有 key，id 不变）：
- `header.showSidebar`
- `menubar.toggleFileTree`
- `view.toggleFileTree`

语义统一为“主侧栏 / Primary sidebar”，不再写“文件树 / File tree”。

参考：
- en：`Files` / `The file tree now lives in the primary sidebar. Your outline moved to the secondary sidebar — you can move it back from its tab menu.` / `Show primary sidebar` / `Toggle Primary Sidebar` / `View: Toggle Primary Sidebar`
- zh：`文件` / `文件树已并入主侧栏，大纲已移到次侧栏；可从大纲标签菜单把它移回主侧栏。` / `显示主侧栏` / `切换主侧栏` / `视图：显示/隐藏主侧栏`

## 5. 明确不做

- 不动 `FileTree.vue` 内部逻辑（滚动、宽度测量、拖拽落点沿用 `Sidebar` 宿主）。
- 不引入底部 Panel、全宽状态栏。
- 不做 `⌘⇧E` 对齐、不改 `⌘J`。
- 不新增 Panels 菜单项 / `+` 清单项。
- 不改 Rust、不改版本号、不 push。
- 不重构 `SidebarDock` / `Sidebar` 的既有结构。

## 6. 风险与验证

| 风险 | 处理 |
|---|---|
| 文件树被 `setOutlineSide` / `moveAllPanesToSide` 搬走 | 两处都锁定 `files` 在左；单测断言。 |
| 重复迁移把用户改过的宽度重置 | `mergeFilesPane` 的 `alreadyMerged` 分支只净化不重算。 |
| 收起主侧栏后留 292px 空体 | `showFileTree` 与 `collapsed.left` 双向镜像；收起即 rail。 |
| 平板浮层丢失 | 左 Dock 本身作为抽屉，保留 scrim / 自动关闭。 |
| 手机编辑器被左 Dock 盖住 | 窄屏不渲染左 Dock；手机首页不变。 |
| macOS 交通灯位置 | 文件树列的 52px inset 消失后，由 `.main-col` 的 Toolbar 承接；人工目视核对。 |

自动化验证：
- `pnpm test`（新增/更新 `sidebar-dock.test.ts`）。
- `pnpm build`（含 `vue-tsc`）。

人工核对清单：
1. 桌面新装：左 rail + 文件树展开，右侧收起；编辑器占其余宽度。
2. `⌘B`：文件树收起后仍见 32px rail，再按恢复。
3. 拖动左 Dock：最小 212、最大 560；内容不出现双拖柄。
4. 设置里把大纲切到左：文件树与大达成两个标签，**文件树不会消失**；切回右侧正常。
5. 老用户（模拟 `outlineSide='left'` 存储）：升级后大纲在右，出现一次性提示；再次启动不再提示。
6. 平板（601–1023 触屏）：`⌘B` 打开文件树浮层，点 scrim 关闭；关闭后无整列空白。
7. 手机：首页仍是「笔记」；编辑器页无左侧抽屉；右抽屉照旧。
8. 右键 / `+` 菜单无 `files`；文件树不可被关闭。
9. macOS/Windows 标题栏与交通灯不重叠。

## 7. 验收与提交

- 全部测试与构建通过。
- 提交信息说明这是**可见布局变更**（文件树并入主侧栏、大纲默认次侧栏、主侧栏最小宽 212）。
- 不 push、不改版本号。
