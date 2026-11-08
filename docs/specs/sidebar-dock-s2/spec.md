# S2 — 标签模型 + 双 Dock + 一次性迁移

> 上游设计：[docs/sidebar-panel-dock-plan.md](../../sidebar-panel-dock-plan.md) §2–§4、§6.1「S2」。
> S1 产物：`app/src/panes/sidebar-panes.ts`、`components/sidebar/SidebarDock.vue`、`SidebarPaneBody.vue`。
> 本阶段是**可见行为变更**（与 S1 的零行为重构区分）。

## 1. 用户已拍板的决策（覆盖 plan 中冲突项）

| 编号 | 决策 | 与 plan 的差异 |
|---|---|---|
| D2/标签模型 | 每个 Dock = 活动栏（Rail，32px）+ 标签头（Tabs，可见面板 ≥2 时）+ 面板体（只渲染 active） | 与 plan §2.1 一致 |
| D4 | 有标签头后，**去掉面板自带的重复标题文字**，保留右上角操作按钮（含 × 与面板功能按钮） | plan D4 原写「保留 PanelHeader 不动」；以用户决策为准 |
| D6 | 新安装：左侧 Dock 预设 **Outlined（大纲）**（文件树仍在 `Sidebar.vue`），右侧预设 **Calendar（默认激活，未实现）+ Agent** | plan D6 原写「全部归右侧、左侧零面板」；以用户决策为准 |
| 迁移 | 沿用 `solomd.settings.v1`，新增 `v510SidebarDockMigrated`；老栈所有面板按 `outlineSide` 落到同一侧，另一侧为空 | 与 plan §4.2 一致 |
| S2 范围 | 不做拖拽（S3）、不做溢出/键盘/窄屏完善（S4）；但数据结构保留 `panes[]` 顺序 + `side` 供 S3 使用 | 与用户要求一致 |

## 2. 数据模型

新增 `app/src/lib/sidebar-dock.ts`（纯函数、无 Vue/store/组件依赖）：

```ts
export type SidebarSide = 'left' | 'right';
export interface SidebarDockPaneState { id: SidebarPaneId; side: SidebarSide; visible: boolean }
export interface SidebarDockState {
  panes: SidebarDockPaneState[];                 // 数组顺序 = 每侧内顺序（S3 拖拽直接复用）
  active: Record<SidebarSide, SidebarPaneId | null>;
  collapsed: Record<SidebarSide, boolean>;
  width: Record<SidebarSide, number>;            // 含 32px 活动栏
}
export const SIDEBAR_RAIL_WIDTH = 32;
export const DEFAULT_DOCK_WIDTH = 292;           // 260 内容 + 32 活动栏
```

`settings.ts` 新增：
- `sidebarDock: SidebarDockState`
- `v510SidebarDockMigrated: boolean`（defaults 中即 `true`，老 blob 走迁移后写 `true`）

注册表 `panes/sidebar-panes.ts` 扩充（仍为纯元数据）：`icon`、`titleKey`、`defaultOrder`、`settingKey?`、`available(ctx)`。默认值按 D6 改为：

| pane | defaultSide | defaultVisible | 备注 |
|---|---|---|---|
| outline | left | true | `visibility:'tab'`，实际渲染仍由 `tab.showOutline` 派生 |
| calendar | right | true + defaultActive | `pending:true`，无组件、不进任何可见列表 |
| agent | right | true | App Store 构建 `available=false` |
| search | right | false | 会话级 |
| backlinks / relationships / tags / tasks / neighborhood / types / history / inspector | right | false | 新安装不预设；老用户由迁移保留原可见性 |

## 3. 迁移算法（`load()` 内调用纯函数）

```
sidebarDock = migrateSidebarDock(parsed, defaultSidebarDock())
v510SidebarDockMigrated = true
```

分支：
1. `parsed.sidebarDock` 存在且结构合法 → `sanitize`（幂等，不依赖标记）。
2. 标记为 `true` 但数据损坏/缺失 → 返回默认布局，不回读老开关。
3. 否则按老 blob 迁移：`legacySide = parsed.outlineSide==='left'?'left':'right'`；`rsPaneOrder` 过滤未知 id、补齐缺失 id；每项 `side=legacySide`，setting 类 `visible=!!parsed[settingKey]`，tab/session 类用 `defaultVisible`；`active[legacySide]` = 该侧第一个可见 setting 面板，否则 `outline`，再否则 `null`；`collapsed[legacySide]=parsed.rightSidebarHidden===true`，另一侧 `true`；`width[legacySide]=clamp(sideSidebarWidth+32,240,560)`，另一侧 292。
4. 首次安装（无 blob）：`defaults()` 直接给出 D6 布局，无需迁移分支；`load()` 仍写标记避免重跑。

清洗规则：未知 id 丢弃、重复 id 保留第一次、非法 `side` 回 `defaultSide`、缺 id 追加到尾部（用注册表默认）、`width` clamp 240–560、`active` 非法 → `null`（渲染时再回退）。

老字段处置：`outlineSide`/8 个 `showX`/`rightSidebarHidden`/`sideSidebarWidth`/`rsPaneOrder` 迁移后**冻结**（`persist()` 原样写回）；`_rsPanesBeforeHide` 删除；`rightSidebarPaneHeights` 保留字段但停用（S4 再删）。

## 4. 运行时判定

- `visible`：setting 类 = `sidebarDock.panes[].visible`；outline = `tab.showOutline`；search = `searchOpen`。
- `available`：沿用现有门控（markdown / 工作区 / autoGit / App Store），仅拆掉 setting 开关那一项。
- 可渲染列表 = `associated && !pending && visible && available`，按 `panes[]` 顺序。
- 面板体挂载条件 = 可渲染列表非空且 `!collapsed[side]`；否则只留 32px 活动栏。
- 整侧挂载条件 = 该侧存在**非 pending** 关联面板。
- `active` 运行时回退：存储的 active 不在可渲染列表时，取该侧第一个可渲染项，否则 `null`（不写盘）。
- `calendar`（pending）在所有列表、标签头、活动栏、菜单中一律过滤；`available=false`，默认 `defaultActive` 只作为数据预留。

## 5. UI（SidebarDock 重写）

- 活动栏：32px 竖条，背景 `--bg`，外缘 `--bd-hair`；图标取自现有 `Icons.vue` 名称（不新增图标）：search/outline/link/share/tag/task/globe/type/recent/wrench/sparkle。hover `--fill-1`，active `--accent-text` + 内缘 2px `--accent`。
- 标签头：仅可渲染项 ≥2 时出现，高 32px，`overflow-x:auto` + 隐藏滚动条；tab 24px、`--r-md`、12.5px；active `--fill-1`+`--text`+540，inactive `--text-2`。
- 面板体：只挂载 active 面板（`SidebarPaneBody`），保留 `.rs-pane-host` 包装与 `data-rs-pane`。
- 宽度：`width[side]`，拖动把手按侧写入（clamp 240–560，渲染再夹 `min(560px,45vw)`）；active 为 agent 且存储宽度 ≤292 时渲染 472（不写盘）。
- 活动栏底部：`+`（事件冒泡给 App 打开现有 `sidebar-ctx` 清单）+ 折叠/展开按钮。
- 移除 S1 的 `RsSplitter`、`rs-pane-grip`、`paneStyle`、竖向拖拽排序逻辑（S3 另行实现）。
- 样式只用现有 tokens 与既有类名，不引入依赖。
- 窄屏/溢出/键盘：保持现有 CSS 行为，不做 S4 的增强。

## 6. D4 — 9 处 PanelHeader 逐处确认

`PanelHeader` 的 `title` 改为可选；无 title 时不渲染 `.rp-title`，`count` 仍单独显示。

| 组件 | 标题 | 保留项 | 结论 |
|---|---|---|---|
| BacklinksPanel | `backlinks.heading` | count、× | 去标题，保留 count/× |
| HistoryPanel | `history.heading` | count、× | 去标题，保留 count/× |
| NeighborhoodPanel | `neighborhood.heading` | count、× | 去标题，保留 count/× |
| Outline | `toolbar.outline` | ×（内部 `tabs.toggleOutline`） | 去标题，保留 × |
| PropertiesInspector | `inspector.heading` | count、× | 去标题，保留 count/× |
| RelationshipsPanel | `relationships.heading` | × | 去标题，保留 × |
| TagsPanel | `tags.heading` | 昨日/今日等 slot 按钮、× | 去标题，**必须保留 slot** |
| TasksPanel | `tasks.heading` | count、× | 去标题，保留 count/× |
| TypesPanel | `types.heading` | `+` 新建 slot 按钮、× | 去标题，**必须保留 slot** |

## 7. 菜单 / 设置面同步

- `composables/useAppMenu.ts`：`panes.outline` 继续读 `tabs.activeTab.showOutline`；其余 8 个 Dock 面板改读 `sidebarDock`（helper `isDockPaneVisible`）；`savedViews` 继续读 `settings.showViewsPanel`。
- `lib/app-menu.ts` 的 `MenuContext.panes` 形状**不变**（仍 11 键，不含 search/calendar）；calendar 不进菜单。
- `App.vue`：删除 `visibleRsPanes`/`rsPaneSnapshot`/`ctxToggle` 的快照分支/`sideSidebarWidth`/`outlineSide` 渲染门控；改为两个 `<SidebarDock>` + `dockPanes(side)` computed；右键清单沿用现有 `sidebar-ctx`，勾选态改读 Dock，`+` 复用同一清单。
- `stores/settings.ts`：8 个 `toggleXxx()` 变 `toggleDockPane(id)` 的别名；新增 `toggleDockPane/showDockPane/hideDockPane/setActiveDockPane/setDockCollapsed/toggleDockCollapsed/setDockWidth/movePaneToSide/resetDockLayout`；`toggleRightSidebar` 改为折叠/展开右侧 + `ensureRenderable` 兜底；`hideRightSidebarFromPane`/`ensureRightSidebarVisible` 保留为折叠/展开别名（`Sidebar.vue` 仍在用）；`setOutlineSide` 改为「把全部 Dock 面板移到该侧」。
- **计划外但必需**：`Toolbar.vue` 的 2 处 `!settings.rightSidebarHidden`（按钮 active / aria-pressed / 勾选）改读 `sidebarDock.collapsed.right`；`SettingsPanel.vue` 的 Backlinks/Tags 两个勾选框改读 Dock；`useCommands.ts` 里 `settings.rightSidebarHidden = false` 改为展开右侧 Dock。不改这些会得到陈旧勾选态或死控件。

## 8. i18n（15 份文件）

新增键（其余 13 种语言用英文兜底，zh 提供中文）：
- `rsPane.inspector`（Properties / 属性）
- `rsPane.calendar`（Calendar / 日历）
- `sidebarDock.collapse`（Collapse sidebar / 收起侧栏）
- `sidebarDock.expand`（Expand sidebar / 展开侧栏）

`+` 按钮复用 `menubar.panes`（已存在于 15 份 locale）。

## 9. 测试

新增 `app/src/lib/sidebar-dock.test.ts`（node:test，纯函数）：
1. plan §4.6 的 10 条迁移/清洗用例（老 blob 右/左、hidden、全关、已有 dock 含未知+重复、标记在数据坏、首次安装、440→472、幂等、移动端同构）。
2. per-side 排序、active 回退（含 pending calendar 不成为 active）、hide 后相邻激活。
3. 15 份 locale 均含全部非 pending 面板的 `titleKey` + 新增 `sidebarDock.*` 键。

更新 `app/src/lib/app-menu.test.ts`：
- `panes` fixture 形状保持 11 键（真实反映新结构：菜单不含 search/calendar）。
- 新增断言：`panes` 子菜单覆盖注册表中所有带 `menuId` 的非 pending 面板；末尾仍是 `view.resetSidebarPanes`。

## 10. 校验与行为对照

- `pnpm test`、`pnpm build`（含 `vue-tsc`）全绿；不跑 Rust。
- 迁移前（老用户升级）：
  - 原来右开：右侧 Dock 关联全部面板、可见集合与顺序不变，左侧 32px 活动栏**不出现**（零关联）；宽度 260→292，内容区不缩水。
  - 原来左开：镜像到左侧；右侧不出现。
  - 原来整栈收起：`collapsed[该侧]=true`，活动栏仍在，点图标可展开。
  - 面板标题文字消失，右上角按钮/计数保留；出现标签头的场景需要 ≥2 个可渲染面板。
- 新用户首次启动：
  - 左侧 32px 活动栏（大纲图标，展开后显示大纲），右侧 32px 活动栏（Agent，Calendar 预留不显示）。
  - 两侧面板体默认收起；点活动栏图标展开；`+` 打开面板清单。
  - 日历面板在 M1 落地前不出现在任何列表、不产生空白面板。

## 11. 已知冲突/偏离（实施中未自行决定）

1. plan D6 与用户 D6 冲突 → 按用户（左 outline / 右 calendar+agent）。
2. plan D4 与用户 D4 冲突 → 按用户（去标题、留按钮）。
3. plan D3 只列 3 个旧字段读方，实际还有 `Toolbar.vue`（2 处）与 `useCommands.ts`（1 处）→ 按同一原则一并改读新状态。
4. `setOutlineSide` 旧语义（整栈换侧）在新模型下必须改为「移动全部面板」否则成死控件 → 按 plan §4.4 实施。
5. **单 active 落地补全（必须改两处旧交互）**：
   - `outline` 的可见性仍按 §4 来自 `tab.showOutline`，而 D6 要求新装预设大纲。`settings.showOutline` 默认原为 `false` → 新装默认改为 `true`（新 markdown tab 自带大纲）；老安装沿用已持久化值，旧行为不变。
   - `tabs.toggleOutline` 原调用 `ensureRightSidebarVisible()`；outline 可能被放在左侧，会展开错的一侧 → 改调 `focusDockPane('outline')`（`setShowOutlineAll` 同理）。
   - 新增 `settings.focusDockPane(id)`：只设 active + 展开该侧，不改 `visible`（search 是会话级、outline 是 tab 级）。⌘⇧F / 右键菜单开搜索、`Sidebar.vue` 点标签打开 Tags 均改走它；否则单 active 模型下新开面板不显示。
