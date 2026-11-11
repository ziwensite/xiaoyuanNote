# 侧栏外壳改造 · 第一段：去掉活动栏（rail）+ 图标标签条 + 拖拽排序/跨侧拖动

状态：已交付（实现提交 `23aff9c8` 及其后续 shell 提交；2026-11-11 完成文档归档与基线复核）
对应分支：当前工作区分两支提交（本段一个 commit；第二段另起）

## 1. 目标与范围

把两侧侧栏从「32px 活动栏 + 面板本体」改成「面板本体，顶部一条纯图标标签条」。

本段交付：

1. 删除左右两条 32px 活动栏；每侧直接是面板本体。
2. 面板顶部标签条，标签**只有图标**（tooltip + `aria-label`，无文字标签）。
3. 同侧拖动改顺序；跨左右侧拖动（Pointer Events，不引入拖拽库）。
4. 拖动中有插入位置提示，跨侧有可放置反馈。

本段不做（第二段）：

- 同侧多区域（上下分区）、区域间高度调整与持久化。数据模型已预留 `groups[]`，第二段只加 UI 与拆分动作，不再迁移 schema。

硬约束：不 push、不改版本号、不动 git 历史、不删源码、不引入新依赖、不改 Rust。

## 2. 关键决策（会写进代码注释）

### D1 收起与「+」的落点（按用户答复定稿）

- **收起 = 收成零宽**，不再保留窄把手。
- 收起后组件由 `App.vue` 直接卸载（`v-if`），不留 0 宽的可聚焦 DOM；宽度仍存 `width[side]`，重开后与上次一致。
- **收起/展开入口 = 顶部标题行（header）两侧各一个图标**：
  - 左侧：`Toolbar.vue` 左段首个控件，`Icon name="sidebar"`，复用右段 `sidebar-right` 的 `.icon-btn` 样式与 `active` 态；
  - 右侧：复用已存在的 `settings.toggleRightSidebar` 图标按钮（不改位置）。
  - 两个按钮都调用 `settings.toggleDockCollapsed(side)` / `toggleRightSidebar`，与 `⌘B`、`View: Toggle …` 菜单、命令面板**同一状态源**（`sidebarDock.collapsed`），不存在第二套状态。
  - 左段仍保留 `3eaba2a9` 的面板标题（`leftPanelTitle`），按钮 + 标题并存。
  - 按钮必须带 `data-no-drag`（标题行有 `mousedown` capture 拖窗逻辑），且位于 `MAC_TRAFFIC_INSET`（80px）之后——`.toolbar` 的 `padding-left` 已保证这一点，注释里写明。
- **`+` 保留在标签条末尾**：`+` 是该侧未打开面板的唯一入口（`App.vue` 的 `sidebarCtx` 清单）。侧栏级右键菜单取消（`@contextmenu` 移除），不允许第三套入口。
- 收起态下该侧的标签条与 `+` 一并不可见；重开由顶部图标 / `⌘B` / 菜单 / 命令面板完成。

### D2 数据模型

```
SidebarDockState {
  groups: Record<'left' | 'right', SidebarDockGroup[]>
  visible: Record<SidebarPaneId, boolean>
  collapsed: Record<'left' | 'right', boolean>
  width: Record<'left' | 'right', number>
}
SidebarDockGroup { panes: SidebarPaneId[]; active: SidebarPaneId | null }
```

- `groups[side][0]` 第一段的唯一区域；`panes` 数组顺序 = 标签顺序。
- `visible` 从旧的「每个 pane 条目带 visible」改为独立映射；`outline`/`search` 仍由运行时覆盖（tab 字段 / session 标志）。
- `files` 锁定：永远位于 `left` 的 `groups[0].panes[0]`，`visible` 恒 true，拖动源对它禁用，drop 到左侧时插入位置强制 `>= 1`。
- 迁移：`migrateSidebarDock` 按**形状**升级（有 `groups` → 清洗；有旧 `panes[]` → 转成每侧一个 group；有 legacy 开关 → 旧逻辑生成后转 group）。天然幂等；新增 `v512DockGroupsMigrated` 标记仅作记录，不参与正确性（即使标记存在但数据是旧形状，也照常升级，避免降级丢数据）。

### D3 与既有机制的对账

| 既有机制 | 新事实 |
| --- | --- |
| 右键菜单勾选态（`sidebarCtx`） | 保留；入口改为 `+` |
| `app-menu` / 命令面板 `panes.*` | 仍走 `isDockPaneVisible`，签名不变 |
| `focusDockPane(id)` | 按 `paneGroup` 找到所在 group，设置该 group 的 `active` 并展开 |
| 侧栏宽度持久化 | 值域不变（292/212/560），但不再含 32px rail；迁移旧宽度仍 `+32` 以保持视觉宽度（`LEGACY_RAIL_WIDTH` 仅迁移用） |
| Agent 打开时 440/472 宽 | 保留 `SidebarDock.vue` 的 472 自动加宽，不回写 |
| 平板抽屉态 | 组件只在未收起时挂载，抽屉 CSS 的 `--collapsed` 分支删除 |
| 窄屏不渲染左栏 | 不变（`!isNarrow`） |
| `useAppMenu.ts` | 只读 `isDockPaneVisible`，无需改 |
| `SettingsPanel.vue` 的「大纲位置」下拉 | 继续读写 `settings.outlineSide`；该字段现在由 `syncLegacySwitches()` 从 groups 反向同步 |
| `showFileTree` / `rightSidebarHidden` | `showFileTree` 继续作为左栏主开关，由 `collapsed.left` 同步；`rightSidebarHidden` 仅迁移用 |

## 3. 拖拽设计（`SidebarDock.vue` + `lib/dock-drag.ts`）

- `pointerdown`（仅主键）记录起点；位移 ≥ 6px 才进入拖拽，避免与点击冲突。
- 拖动中使用 `document.elementFromPoint` 命中 `[data-dock-region]`（带 `data-dock-side` / `data-dock-group`），再在区域内找 `[data-dock-tab]`。
- 插入位置：命中标签时按指针 x 与标签中点比较（前/后）；命中区域内空白则追加到该 group 末尾。`files` 存在时左侧插入位置强制 `>= 1`。
- 反馈：目标标签显示左右插入边线；区域空白显示容器描边；拖拽中给 aside 加 `is-drag-source` / `is-drop-host`。
- 释放时调用 `settings.moveDockTab(id, { side, group, index })`；同位置 no-op；跨侧展开目标侧。
- `pointerup` 后 1 个宏任务内抑制 `click`，避免拖完顺带切换标签。
- 不使用 HTML5 DnD（Tauri 会被原生文件拖放吞掉）。
- 共享拖拽状态放在 `lib/dock-drag.ts`（`reactive`，仅组件引用，不进单测）。

## 4. 改动清单（精确到文件/函数）

1. `app/src/lib/sidebar-dock.ts`（重写）
   - 导出 `SidebarDockGroup` / 新 `SidebarDockState`；`LEGACY_RAIL_WIDTH` 取代 `SIDEBAR_RAIL_WIDTH`。
   - `defaultSidebarDock()`：`left=[files]`，`right=其余全部（含不可见项）`，`active.right='outline'`。
   - `sanitizeSidebarDock()`：跨 group 去重、丢弃未知 id、补新版本 pane、`files` 归一化到 `left[0][0]`、`visible` 合并、group.active 合法性校验、宽度 clamp。
   - `migrateSidebarDock()`：旧 `panes[]` 与 legacy 开关两条路径统一落到 groups。
   - 新增 `paneGroup()` / `resolveGroupActive()` / `moveDockTab()`；`dockPane()`、`sideDockPanes()`、`isDockPaneVisible()`、`nextActiveAfterHide()`、`moveAllPanesToSide()`、`mergeFilesPane()` 改为 groups 实现，签名尽量不变。
2. `app/src/lib/dock-drag.ts`（新增，~30 行）：跨组件共享的拖拽状态。
3. `app/src/stores/settings.ts`
   - 新增 `v512DockGroupsMigrated`（interface + defaults + load 写入）。
   - 动作改为 groups：`toggleDockPane` / `showDockPane` / `hideDockPane` / `setActiveDockPane` / `focusDockPane` / `movePaneToSide` / `toggleRightSidebar`；新增 `moveDockTab(id, target)`。
   - `syncPrimarySidebar()` → `syncLegacySwitches()`：同步 `showFileTree` 与 `outlineSide`。
4. `app/src/components/sidebar/SidebarDock.vue`（重写）
   - Props 改为 `groups: SidebarDockGroupView[]`；删 `collapsed`。
   - 模板：每 group 一条 `.dock-strip`（图标标签 + 末尾 `+`）+ `.rs-pane-host`；删 `.dock-rail`、折叠按钮、`@contextmenu`。收起零宽后由 App 卸载。
   - 样式：标签 24×24、active 用 `--accent-soft` + 2px inset 竖线；strip 32px 高；拖拽/插入态样式。
5. `app/src/App.vue`
   - `dockViewsFor` → `dockGroupsFor(side)`；`leftDockGroups`/`rightDockGroups`；`hasLeftDock`/`hasRightDock` 按 groups 计算。
   - 两处 `<SidebarDock>` 传 `:groups`，`v-if` 追加 `!collapsed`；删 `@contextmenu`。
   - `renderableOn` 适配 group 扁平化；tablet overlay CSS 删除 `--collapsed` 分支。
6. `app/src/components/Toolbar.vue`
   - 左段首个控件：常驻 `toggleFileTree` 图标（`sidebar`，`.icon-btn` + `active`），`title`/`aria-label` 按 `collapsed.left` 在 `header.showSidebar`/`header.hideSidebar` 间切换，带 `data-no-drag`；展开时其后仍显示 `leftPanelTitle`。
   - 右段现有的右栏切换按钮保持不变（与新左按钮同款交互）。
7. `app/src/lib/sidebar-dock.test.ts`
   - 全部断言迁到 groups（不删用例）；新增：旧 `panes[]` 升级、`groups` 清洗幂等、`files` 不可移动、`moveDockTab` 同侧/跨侧/越界/`files` 夹取、`visible` 合并、宽度迁移。
8. i18n：新增 `toolbar.leftSidebarTooltip`、`sidebarDock.openPanel`（`{name}` 插值，图标标签的 aria-label）、`sidebarDock.addPanel`（`+` 的 tooltip），15 个语言文件全部补齐；标签 tooltip 继续复用 `rsPane.*` 面板名。

## 5. 验证

- `pnpm test`：981 / 981 pass / 0 fail（2026-11-11 P2 实测；P0 基线 978，规格编写时预期 670）。
- `pnpm build`（vue-tsc + vite）：0 错误，29.94s。
- `cargo test --lib -j 1`：259 passed；`cargo test --bin SoloMD -j 1`：267 passed。
- 本环境无法起 Tauri GUI：视觉效果**全部为代码推断**，需人工核对（见任务清单末尾）。

## 6. 第二段预告（不在本段实施）

- `groups[]` 已就绪；第二段新增：区域拆分/合并动作、每条 strip 的额外操作、区域高度持久化（`group.height`）、`files` 区域的锁定规则。
