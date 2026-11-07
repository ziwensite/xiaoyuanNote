# 侧栏面板容器（Dock + 活动栏 + 标签页）设计方案

> 版本基线：5.0.13；本文只做设计与论证，不含实现代码。
> 相关文档：[v5-ui-spec.md](v5-ui-spec.md)、[calendar-pane-plan.md](calendar-pane-plan.md)。
> 目标：把「一个可左右切换的竖排面板栈」改造成「左右两个独立的、标签式、可拖拽移动的面板容器」，为日历/任务面板以及后续更多面板留出扩展位。

---

## 0. 结论速览

| # | 结论 | 说明 |
|---|---|---|
| C1 | 现阶段所谓「左右侧栏」不是文件树栏，而是编辑器两侧的同一个面板栈 | `App.vue` 只有一份 `visibleRsPanes`，按 `settings.outlineSide` 二选一渲染成左/右两块（L2375-2433 / L2442-2500）。改造对象就是这个栈。文件树栏（`Sidebar.vue`）本次不并入。 |
| C2 | 新模型 = 两个独立 Dock，每个 Dock = 活动栏（Rail）+ 标签头（Tabs）+ 面板体（Body），同一时刻只显示 1 个面板 | 与用户确认的目标形态一致。 |
| C3 | 状态收敛到一份 `sidebarDock` 结构与一个 pane 注册表 | 新增面板从「改 8 处」降为「注册表 1 条 + i18n + 图标」，`App.vue` 里不再出现任何 pane 专属模板。 |
| C4 | 拖拽用原生 Pointer Events，不引三方库 | 仓库已有两处成熟先例（`PaneTabBar.vue`、`FileTree.vue`）；Tauri WebView2 的原生文件拖放会吞掉 HTML5 DnD（`App.vue` L2137-2143 注释）。 |
| C5 | 持久化沿用 `solomd.settings.v1`，用一个一次性迁移标记 `v510SidebarDockMigrated` | 与仓库现有迁移约定一致（`settings.ts` L969 / L978 / L996 / L1004 / L1013 / L1017 / L1021）。不新增 schema 版本号。 |
| C6 | 迁移后，「只开一侧」的老习惯保持为一个 Dock 有内容、另一侧空 | 迁移时把老栈里的全部可见面板落到 `outlineSide` 对应的一侧；另一侧不分配任何面板。 |

**需要拍板的决策点**（详见 §2.8、§3.7、§4.4、§5.1）：

| 编号 | 决策 | 推荐 |
|---|---|---|
| D1 | 左侧 Dock 的边界：只接管编辑器左侧的面板栈，还是把文件树/收藏视图也并进来 | **只接管面板栈**；文件树与收藏视图保持现状，第二阶段再评估 |
| D2 | 活动栏图标显示范围：只显示可见面板，还是显示该侧全部面板 | **可见面板 + 末尾「+」选择器**（更安静，符合现有极简风格） |
| D3 | 旧字段是否双写 | **只读不写（冻结）**；S2 把 3 个读方（`useAppMenu` 的 `panes`、`SettingsPanel` 的 2 个勾选框、App 内的门控）改为读 `sidebarDock`，旧 toggle action 退化为新 action 的别名 |
| D4 | 标签页是否保留面板自带的 `PanelHeader` | **保留**，避免改动 10 个面板组件；只有「可见面板 ≥ 2」时才出现标签头 |
| D5 | 数字快捷键 | **默认不绑数字**；`Mod+1..6` 已被标题占用、`Mod+Alt+7/8/9` 已被列表样式占用（`keybindings.ts` L197-214）。提供命令面板入口 + `Mod+Alt+ArrowUp/Down` 循环 |
| D6 | 新安装是否预设左侧 Dock 面板 | **不预设**：全部归右侧、左侧首次由用户主动创建（拖拽或 picker），保证 5.0 首启视觉不变 |

---

## 1. 现状梳理

### 1.1 DOM 结构（`app/src/App.vue`）

```
.shell                                            L2330
├─ .workspace__scrim（窄屏抽屉遮罩）              L2333-2344
├─ .phone-screen（手机 home/search，窄屏）         L2346-2356
├─ Sidebar.left-stack（桌面文件树栏）             L2357-2365   ← 不在本次改造范围
└─ .main-col                                      L2366
   ├─ Toolbar                                     L2367-2372
   └─ .workspace                                  L2374
      ├─ aside.side-sidebar--left                 L2375-2433   ← 面板栈（outlineSide=left）
      ├─ .content（编辑器 / 视图）                L2434-2441
      └─ aside.side-sidebar--right                L2442-2500   ← 面板栈（outlineSide=right）
```

两个 `<aside>` 内部结构**逐行重复**，唯一差异是：

| 差异 | 左块 | 右块 |
|---|---|---|
| 渲染条件 | `showRightSidebar && settings.outlineSide === 'left'`（L2376） | `showRightSidebar && settings.outlineSide !== 'left'`（L2443） |
| class | `side-sidebar--left` | `side-sidebar--right` |
| resize 把手 | `side-sidebar__resize--right`（L2381） | `side-sidebar__resize--left`（L2448） |

其余 11 个面板的 `v-if` 分支、`RsSplitter`、`rs-pane-grip`、拖拽事件、`paneStyle()` 完全一样（L2382-2432 对 L2449-2499）。

### 1.2 面板注册与可见性

`visibleRsPanes`（L2101-2133）是唯一的注册点：

- 11 个 id：`search / outline / backlinks / relationships / tags / tasks / neighborhood / types / history / inspector / agent`；
- 顺序来自 `settings.rsPaneOrder`（L2124-2126），未知 id 追加到尾部（L2127-2129），保证滚动升级不炸老布局；
- 是否可见来自 11 个 computed（L1824-1884），但**可见性来源并不同质**：

| 面板 | 判定 | 门控来源 | 备注 |
|---|---|---|---|
| search | `searchOpen` | 会话级（L228、L1884） | 不持久化（PR #50） |
| outline | `activeTab.showOutline && language==='markdown'` | **按 tab**（L1825） | 没有落到 settings 的真实开关 |
| backlinks / relationships / neighborhood / inspector | `settings.showX && markdown && currentFolder` | settings + 文档 + 工作区 | L1827-1876 |
| tags / tasks / types | `settings.showX && currentFolder` | settings + 工作区 | L1839-1857 |
| history | `autoGitEnabled && settings.showHistoryPanel && markdown && folder` | settings + Git + 文档 | L1858-1867 |
| agent | `!IS_APP_STORE_BUILD && settings.showAgentPanel` | settings + 构建类型 | L1880 |

这套「开关 × 文档类型 × 工作区 × 构建类型」的门控必须原样保留，否则会出现「按钮亮着但画不出东西」的历史 bug（L2030-2035 注释）。

顶部还会再做一次汇总：

- `rightSidebarHasRenderablePane`（L2036-2049）——11 个可见 computed 的 OR；
- `showRightSidebar`（L2051-2057）——`!rightSidebarHidden && hasRenderable`；
- `setRightSidebarShell`（L2064-2076）——把「能否打开」与「打开时兜底启用 Outline」回灌给 settings store，避免出现死按钮（Issue #209）；
- `narrowDrawer`（L2084-2092）——窄屏只允许右侧面板做抽屉。

### 1.3 开关与布局的存储位置（`app/src/stores/settings.ts`）

| 数据 | 类型声明 | 默认值 | 备注 |
|---|---|---|---|
| `outlineSide: 'left' \| 'right'` | L85 | L666 `'right'` | 决定**整个栈**渲染在哪一侧；现在这是「只开一侧」的唯一表达 |
| `showBacklinks` | L204 | L734 `true` | |
| `showTagsPanel` | L213 | L740 `true` | |
| `showTasksPanel` | L215 | L741 `false` | |
| `showNeighborhood` | L218 | L742 `false` | |
| `showTypesPanel` | L221 | L743 `false` | |
| `showAgentPanel` | L223 | L744 `true` | App Store 构建不渲染 |
| `showHistoryPanel` | L261 | L762 `true` | 还受 `autoGitEnabled` 门控 |
| `showInspector` | L264 | L763 `false` | |
| `showViewsPanel` | L111 | L674 `false` | 属于左侧文件树栏（`Sidebar.vue` L403-404），**不在本次栈内** |
| `rightSidebarHidden` | L118 | L681 `true` | 整个栈的总开关；5.0 首次安装默认收起 |
| `sideSidebarWidth` | L240 | L752 `260` | 左右共用同一个宽度；Agent 可见时逻辑上抬到 440（App L2227-2233） |
| `rightSidebarPaneHeights` | L269 | L764 `{}` | 竖排分栏高度 |
| `rsPaneOrder` | L474 | L836 11 项默认序 | 竖排顺序 |
| `_rsPanesBeforeHide` | L548 | L863 `null` | 仅会话态，`persist()` 会剔除（L1072-1078） |

相关 action：

- `toggleRightSidebar()`（L1272-1329）：按「屏幕上是否真的可见」决定隐藏/恢复，隐藏时快照各开关，恢复时保底打开 `backlinks+tags` 并要求 shell 兜底；
- `hideRightSidebarFromPane()` / `ensureRightSidebarVisible()`（L1333-1353）；
- 各 pane 的 `toggleXxx()`（L1448-1490、L1554-1560）；
- `setSideSidebarWidth()`（L1496-1500）；
- `setRightSidebarPaneHeight()` / `resetRightSidebarLayout()` / `clearRightSidebarPaneHeights()`（L1565-1591）；
- `moveRsPane()`（L1808-1819）；
- `setOutlineSide()`（L1244-1246）。

> 注意：`solomd.tiles.v1` 是**编辑器中间区域的分栏树**，只存 `{ root, focusedPaneId }`（`stores/tiles.ts` L5、L272-274），与侧栏无关，本次不需要迁移它。

### 1.4 现有交互

| 行为 | 位置 | 现状 |
|---|---|---|
| 右键面板区切换器 | L240-243、L2522-2572 | 自绘 `sidebar-ctx` 清单，逐项手写 |
| 切换后协调显隐 | `rsPaneSnapshot` L245-256、`ctxToggle` L259-279 | 关闭最后一个面板 → 自动隐藏整栈；打开时若被总开关隐藏 → 恢复 |
| 竖排拖拽排序 | L2135-2178 | Pointer Events：4px 阈值、`elementFromPoint` 找 `[data-rs-pane]`、`moveRsPane` |
| 分栏拖拽 | `RsSplitter.vue` + `setRightSidebarPaneHeight` | 只在相邻面板之间 |
| 宽度拖拽 | `onSidebarResize` L2235-2258 | 左右共用 `sideSidebarWidth` |
| 溢出 | 无 | 竖排时靠 `flex` 压缩，没有溢出菜单 |
| 窄屏 | `narrowDrawer` L2084-2092；CSS L2797-2865 | 只允许一个右抽屉，宽度 `min(86vw,320px)` |

### 1.5 现有「加一个面板」的 8 处集成点

`docs/calendar-pane-plan.md` L237-244 已列出，逐条核对无误：

| # | 文件 | 要改什么 |
|---|---|---|
| 1 | `components/XxxPanel.vue`（新增） | 新面板本身 |
| 2 | `App.vue` | `defineAsyncComponent`（L22-31）、`visibleRsPanes`（L2109-2133）、**左右两处**渲染块（L2399-2430 / L2466-2497）、`rsPaneSnapshot`+`noPanesVisible`（L245-272）、右键菜单（L2530-2569） |
| 3 | `stores/settings.ts` | 类型、默认值、toggle、`rsPaneOrder` 默认数组（L836）、持久化 |
| 4 | `lib/app-menu.ts` | `panes` 子菜单（L407-424）+ `MenuContext.panes`（L85） |
| 5 | `composables/useCommands.ts` | `view.toggleXxxPanel`（L220-238） |
| 6 | `lib/app-menu.test.ts` | `ctx().state.panes`（L44-52）、`PALETTE_MENU_IDS`（L73-94） |
| 7 | `i18n/en.ts` + 其余 14 个 locale | `rsPane.*` / `menubar.paneX` / `cmd.view.*` |
| 8 | `components/Icons.vue` | 新图标（当前集合缺 backlinks / relationships / neighborhood / history / inspector / calendar，agent 可复用 `sparkle`/`cpu`） |

另有第 9 处：`composables/useAppMenu.ts` L48-61 把开关映射成 `MenuContext.panes`。注意这份列表里有 **`savedViews`**（对应 `settings.showViewsPanel`，属于左侧文件树栏）而**没有 `search`**，与 Dock 的 11 个面板不是同一集合；标签模型落地后这里只应把 10 个 Dock 面板改读 `sidebarDock`，`savedViews` 继续读 `showViewsPanel`。

### 1.6 测试面（本次改造的直接影响）

| 测试 | 断言 | 影响 |
|---|---|---|
| `lib/app-menu.test.ts` L44-52 | `ctx().state.panes` 必须含 11 个键 | 注册表化后 `panes` 若由注册表生成，需要同步形状；新增日历面板要加键 |
| 同上 L73-94 | `PALETTE_MENU_IDS` 白名单 | 新增/重命名命令必须登记 |
| 同上 L143-L150 | 必需菜单 id 列表 | 保持 `view.resetSidebarPanes` 等 id 不变最稳 |
| 同上 L153-175 | 「每个菜单 id 都有人 dispatch」 | 生成式菜单用的是既有 id，不会失败；**不要**引入未实现的 id |
| 同上 L177-183 | 15 个 locale 文案齐全（`strictT`） | 新菜单项/新键必须补齐 15 份 |
| 同上 L283-304 | `panes` 子菜单含 `toggleOutline`/`toggleInspector`，最后一项是 `view.resetSidebarPanes` | 用注册表生成时需保持「重置」在末尾 |
| `composables/*.test.ts`、`stores/*.test.ts` | 不涉及 App 结构 | 无影响 |
| 组件级测试 | 仓库**没有** Vue 组件测试（`scripts/run-tests.sh` 只跑 `src/**/*.test.ts` + node:test） | UI 交互只能靠纯函数测试 + 手工验收矩阵 |

---

## 2. 目标结构

### 2.1 概念模型

```
Dock(side)                      一侧的容器
├─ Rail（活动栏）               32px 竖条：该侧可见面板的图标 + 「+」选择器 + 折叠把手
├─ Tabs（标签头）               32px 横条，仅当该侧可见面板 ≥ 2 时出现
└─ Body（面板体）               只渲染 active 面板，占满剩余空间
   └─ 面板自带 PanelHeader     原样保留（决定 D4）

Pane                           面板的元数据（注册表定义）
DockState                      布局状态：每个面板在哪一侧、顺序、是否可见、谁是 active、该侧是否收起、宽度
```

三个状态维度必须分开，避免又把门控耦合进布局：

| 维度 | 含义 | 存哪 |
|---|---|---|
| **assigned** | 这个面板属于哪一侧、排第几 | `sidebarDock`（持久化） |
| **visible** | 用户在 Dock 里是否开启它 | search=会话；outline=当前 tab；其余=`sidebarDock.panes[].visible` |
| **available** | 当前上下文能否画出来（markdown / 工作区 / autoGit / 构建类型） | 注册表 `available(ctx)`，纯函数 |

渲染条件 = `visible && available`；Dock 是否展开 = 该侧存在任一 `visible && available` 且 `!collapsed[side]`。

### 2.2 数据模型（设计稿）

```ts
export type SidebarSide = 'left' | 'right';
export type SidebarPaneId =
  | 'search' | 'outline' | 'backlinks' | 'relationships' | 'tags' | 'tasks'
  | 'neighborhood' | 'types' | 'history' | 'inspector' | 'agent'
  | 'calendar';                       // 预留

export interface SidebarDockPane {
  id: SidebarPaneId;
  side: SidebarSide;
  /** 仅 visibility==='setting' 的面板使用；tab/session 面板由运行时派生 */
  visible: boolean;
}

export interface SidebarDockState {
  /** 顺序 = 数组顺序；同类面板在同一侧内相邻 */
  panes: SidebarDockPane[];
  /** 每侧当前激活的面板；null 表示该侧没有激活项 */
  active: Record<SidebarSide, SidebarPaneId | null>;
  /** 用户手动收起（与「没有可渲染面板」区分开） */
  collapsed: Record<SidebarSide, boolean>;
  /** 每侧宽度（含活动栏）；right 默认 292，left 默认 292 */
  width: Record<SidebarSide, number>;
}
```

`settings` 新增两个字段：

```ts
sidebarDock: SidebarDockState;
v510SidebarDockMigrated: boolean;
```

不复用 `Map` / 嵌套对象，原因：需要保序、需要容错清洗、需要按侧切片。扁平数组 + `side` 字段是最省心的形态。

### 2.3 面板注册表（收敛的核心）

新增 `app/src/panes/sidebar-panes.ts`：

```ts
export interface SidebarPaneDef {
  id: SidebarPaneId;
  icon: string;                     // Icons.vue 的名字
  titleKey: string;                 // 复用 rsPane.*，新面板新增
  menuId?: string;                  // 例如 view.toggleAgentPanel（保持既有 id）
  menuLabelKey?: string;            // menubar.paneX
  commandId?: string;               // useCommands 的 id
  defaultSide: SidebarSide;
  defaultVisible: boolean;
  defaultOrder: number;
  visibility: 'setting' | 'tab' | 'session';
  settingKey?: 'showBacklinks' | 'showTagsPanel' | 'showTasksPanel'
    | 'showNeighborhood' | 'showTypesPanel' | 'showHistoryPanel'
    | 'showInspector' | 'showAgentPanel';
  available: (ctx: PaneAvailabilityCtx) => boolean;   // markdown/folder/autoGit/appStore
  feature?: 'agent' | 'calendar';   // 构建类型/实验开关
}
```

面板顺序、默认侧、i18n、菜单、命令、可用性全部集中在这里；`App.vue`、`app-menu.ts`、`useCommands.ts` 都改为遍历注册表。

**为什么这样能把 8 处降成 1–2 处**：新增面板只改

1. `panes/sidebar-panes.ts` 加一条（含 icon/titleKey/menu/command/available）；
2. `i18n/en.ts` + 14 个 locale 加 2–3 个键（若复用 `rsPane.*` 命名且已有则更少）；
3. 若图标集合缺失，`Icons.vue` 补 1 个。

`App.vue` 零改动（模板只剩两条 `<SidebarDock>`），`app-menu.ts` / `useCommands.ts` / `SettingsPanel.vue` 零改动。

### 2.4 组件划分（建议）

| 组件 | 职责 | 复用 |
|---|---|---|
| `components/sidebar/SidebarDocks.vue` | 可选：左右两块的外层；也可以直接在 `App.vue` 放两个 `SidebarDock` | — |
| `components/sidebar/SidebarDock.vue` | 一侧容器：计算可见列表、渲染 Rail/Tabs/Body、宽度与 resize、折叠 | `side-sidebar` CSS、`onSidebarResize` |
| `components/sidebar/SidebarPaneRail.vue` | 活动栏图标、active 态、拖拽源、`+` 选择器、折叠把手 | `Icons.vue` |
| `components/sidebar/SidebarPaneTabs.vue` | 标签头、横向滚动、溢出 chevron、拖拽源/落点 | `PaneTabBar.vue` 的 overflow 模式（L334-368） |
| `components/sidebar/SidebarPaneBody.vue` | **唯一的**面板→组件映射 switch（props/events 都在这） | 现有 11 个面板组件 |
| `components/sidebar/SidebarPanePicker.vue` | 共享的「面板清单」菜单：勾选、移到左/右、上/下移、隐藏 | 替换自绘 `sidebar-ctx`（L2522-2572） |
| `composables/useSidebarDockDrag.ts` | Pointer 拖拽控制器：阈值、命中测试、落点索引、自动滚动、Esc 取消 | 复用 `PaneTabBar.vue` L242-332 |
| `composables/useSidebarSearch.ts` | 把 `searchOpen` / `searchPrefill` 从 `App.vue` 提到模块级 | 解耦面板体与 App |
| `stores/settings.ts` | `sidebarDock` 状态 + 纯函数 action | 既有 store |

`SidebarPaneBody.vue` 是唯一允许出现 `v-if="id === 'outline'"` 的地方；内部通过 `hostContext`（`outlineLine`、`onOutlineGoto`、`onFilterTag`、`openSettingsAt`、`searchPrefill`）拿到 App 级回调，避免 prop 逐层穿透。

注册表**不包含** `savedViews`：它是左侧文件树栏里的收藏视图面板（`Sidebar.vue` L403-404），既不在两侧 Dock 里，也不参与拖拽；菜单里的 `savedViews` 勾选项继续走 `settings.showViewsPanel`。

### 2.5 `App.vue` 改造后的样子（结构级）

```
.workspace
├─ <SidebarDock side="left"  :context="paneContext" />
├─ .content ...
└─ <SidebarDock side="right" :context="paneContext" />
```

- 删除：`visibleRsPanes`、`rsPaneSnapshot`、`ctxToggle`、`paneStyle`、`draggingPaneId/dragOverPaneId/startPaneReorder`、`sidebarCtx` 菜单块、`sideSidebarStyle` 的双份使用。
- 保留：`rightSidebarHasRenderablePane` 的等价逻辑移到 Dock/注册表（按侧计算）。
- 保留：`setRightSidebarShell` 的精神——「打开时若无可渲染项，兜底启用 Outline 或明确失败」，改成每侧 `setSidebarShell(side, { visible, ensureRenderable })`。

### 2.6 状态职责划分

| 状态 | 归属 | 持久化 |
|---|---|---|
| `panes[].side` / `panes[].visible`(setting 类) / 顺序 / `active` / `collapsed` / `width` | settings store | 是 |
| `searchOpen`、`outline` 的 tab 级开关 | 各自现有来源 | 否（保持现状） |
| 拖拽中的 `draggingId`、`dragOverSide`、`dropIndex`、ghost 位置 | `useSidebarDockDrag` 局部（或 tiles 风格的 store 瞬态） | 否 |
| pane picker 打开状态、菜单坐标 | 组件局部 | 否 |
| 窄屏抽屉里临时显示的「非本侧」面板 | Dock 局部 `mobilePreviewId` | 否，且**不写回** `panes[].side` |

### 2.7 显示判定（替换现有 4 个判定）

```
hasVisible(side)   = panes.filter(side && visible && available).length > 0
dockOpen(side)     = hasVisible(side) && !collapsed[side]
railMounted(side)  = panes.filter(side).length > 0        // 有关联面板才出现活动栏
bodyMounted(side)  = dockOpen(side)
edgeDropMounted(side) = dragging && panes.filter(side).length === 0   // 拖拽期间的临时投放条
```

- 无任何关联面板的一侧 → 完全不渲染（首次安装时左侧不出现多余竖条）。
- 有关联面板但全部不可渲染 → 只留活动栏 + `+`，不展开面板体（避免死按钮）。

### 2.8 范围边界（D1，待确认）

| 方案 | 内容 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐）** | Dock 只管现有 11 个编辑器侧面板（+日历/任务） | 风险最小、迁移简单、改完后文件树交互完全不变 | 「左侧面板」与文件树栏是两列，窄桌面可能同时占 260+292 |
| B | 把文件树 `Sidebar.vue` 与 `ViewsPanel` 也变成左侧 Dock 的标签 | 真正「每侧都有标签」，更像 VS Code | 文件树是复杂自定义布局（搜索/导航/页脚/树），拆成面板体工作量大；`showFileTree` 语义要重定义；风险高 |

建议先做 A，B 作为后续独立阶段（见 §6 S5）。A 也满足用户目标：**每侧都有多个面板以标签页存在、只显示一个**。

---

## 3. 交互细则

### 3.1 尺寸与视觉（全部走 `tokens.css`）

| 元素 | 规格 |
|---|---|
| 活动栏 | 宽 `32px`，背景 `--bg`，外缘 `border-{left,right}: var(--bd-hair)`；图标 18px，`--text-3`；hover `--fill-1`；active `--accent-text` + 左侧 2px `--accent` 指示条（右栏镜像） |
| 标签头 | 高 `32px`，背景 `--bg`，底边 `--bd-hair`；tab 高 `24px`、圆角 `--r-md`、字号 `12.5px`；active `--fill-1` + `--text` + `font-weight:540`；inactive `--text-2`（与 `PaneTabBar.vue` L726-732 一致） |
| 面板体 | 占满剩余；面板自带 `PanelHeader`（36px）不变 |
| 宽度 | right/left 默认 `292px`（= 260 内容 + 32 活动栏）；Agent 面板 active 且宽度未手动调过时 `472px`；最小 `240px`，最大 `min(560px, 45vw)` |
| 过渡 | 宽度 `220ms`（与 v5 spec「sidebar width 220ms」一致）、面板切换 `--dur-fast`、拖拽 ghost `--dur-fast` |
| 分隔 | 沿用 `.side-sidebar--left/--right` 的 `border`，`--bd-hair` |

> 迁移注意：老用户 `sideSidebarWidth=260` 代表**内容宽度**，迁移后需 `+32`（即 292），否则内容区会凭空窄 32px。

### 3.2 活动栏 vs 标签页的角色

- **活动栏**：稳定入口，不随面板体展开/收起而消失；显示该侧「可见面板」，末尾固定一个 `+`（打开 pane picker）。点击图标 = 激活该面板并展开面板体；点击 active 图标 = 无操作（折叠请用面板体右上角 / 活动栏底部的折叠把手），避免误触。
- **标签头**：仅在可见面板 ≥ 2 时出现，横向列出该侧可见面板，用于快速切换、展示顺序、作为拖拽手柄；末尾一个 `chevron-down`，打开该侧完整清单（含隐藏面板）。
- 两者共享同一份 `panes` 数组顺序与 `active`，不产生第二份状态。
- 理由：窄侧栏里纯横排标签最多放 3–4 个；活动栏提供不滚动的常驻入口，标签头提供「当前这侧都开了什么」的可读视图。

### 3.3 激活、关闭、全关

| 事件 | 行为 |
|---|---|
| 点击面板的 × / 中键 | `hidePane(id)`：`visible=false`；若它是 active，激活同侧相邻项（右→左，再左→右）；若该侧再无可见项 → `collapsed[side]=true`（等价老行为「关掉最后一个就收起整栈」，但**不再清空/快照开关**） |
| 点击活动栏 active 图标 | 无操作 |
| 点击折叠把手 / 工具栏总开关 / 命令 | `collapsed[side] = !collapsed[side]`；恢复时保留 active 与可见集合 |
| 该侧无任何可渲染项 | 面板体不渲染，只留 32px 活动栏 + `+`；点击 `+` 打开选择器 |
| 该侧无任何关联面板 | 整侧不渲染 |
| 左侧首次创建 | 左侧默认零关联面板（D6）。两种入口：把某面板拖到窗口左缘的投放条；或在 pane picker 里选「移到左侧」。创建后左侧才有活动栏与标签头 |
| 全关后再打开 | 活动栏 `+` → 选择任一面板 → `visible=true`、`active=id`、`collapsed=false`，不需要任何「快照恢复」逻辑 |

删除 `_rsPanesBeforeHide`、`hideRightSidebarFromPane`、`ensureRightSidebarVisible`：收起不再改变可见集合，快照机制失去存在意义（这是本次改造顺带修掉的一处复杂度）。

### 3.4 标签/图标溢出

| 场景 | 处理 |
|---|---|
| 标签头超过可用宽度 | 横向 `overflow-x:auto` + 隐藏滚动条 + 两端渐隐遮罩（`mask-image`）+ 右侧 `chevron-down`。直接复用 `PaneTabBar.vue` 的 `tabsOverflow` + `ResizeObserver` 方案（L334-368） |
| 活动栏超过高度 | 纵向滚动 + 上下渐隐；底部折叠把手之下再放 `+`，始终可达 |
| 溢出菜单内容 | 该侧全部面板（可见打勾、隐藏置灰），项内可「显示/隐藏」「移到另一侧」 |

### 3.5 拖拽（核心交互）

**实现方式**：原生 Pointer Events（理由见 §5.1）。

| 规则 | 细节 |
|---|---|
| 拖拽源 | 活动栏图标、标签头 tab。面板自带的 `rs-pane-grip`：**不保留**，随竖排布局一起退役 |
| 启动阈值 | 鼠标 4px（与 `PaneTabBar.vue` L240、`FileTree.vue` L1070 一致）；触屏长按 300ms 或 8px，二者取先到 |
| 阻止原生手势 | 活动栏图标 `touch-action: none`；标签头沿用 `touch-action: pan-x`（保证溢出条仍可横向滑动，`PaneTabBar.vue` L718-724 的血泪注释） |
| ghost | `<Teleport to="body">` 的 `position:fixed` 副本（图标+名称），`pointer-events:none`，`opacity:.9`，`--sh-2`，`--r-md` |
| 同侧排序落点 | tab 左右半区决定 before/after；活动栏按 y 中点决定 before/after；落点处显示 2px `--accent` 插入线（不要用整块 `accent-soft` 背景，竖排时代的高亮块已显重） |
| 跨侧判定 | 命中 `[data-dock-side]` 的最近祖先；若与源侧不同 → 目标活动栏整体描边 `inset 0 0 0 2px var(--accent)`，并在目标位置画插入线；松手即 `movePane(id, side, index)` |
| 目标侧已收起 | 拖到窗口内缘 24px 热区时，浮出「放到左侧/右侧」提示条；松手后 `side` 改写、`visible=true`、`active=id`、`collapsed=false` |
| 目标侧不存在（零面板、连活动栏都没有） | **跨侧拖拽仍然必须可用**：拖拽期间在窗口内缘 24px 处临时挂载「放到左侧/右侧」投放条，松手后为该侧创建 Dock（`visible=true`、`active=id`、`collapsed=false`）。不允许出现「老用户永远无法把面板拖到另一侧」的情况 |
| 自动滚动 | ghost 进入滚动容器上下/左右 24px 内，每帧滚动 8px（`requestAnimationFrame`） |
| 取消 | Esc、`pointercancel`、落在无效区 → 无变更并结束 |
| 防误触 | 拖拽结束后一次性抑制紧随其后的 `click`（复用 `PaneTabBar.vue` 的 `suppressClick`，L244-246） |
| 持久化 | 松手才写 `settings.sidebarDock`；拖拽过程只改瞬态 |

**索引语义**：拖拽排序写入的是「该侧全量关联面板」的顺序（含隐藏项），这样「隐藏再显示」不会丢失位置（沿用现有 `rsPaneOrder` 的设计意图，L2169-2171 注释）。

### 3.6 双击 / 中键 / 右键

| 手势 | 行为 | 理由 |
|---|---|---|
| 单击 tab / 图标 | 激活 | — |
| 双击 tab | 无操作 | 避免切换面板时误触 |
| 双击标签头空白 | 折叠 / 展开该侧面板体 | 类似窗口标题栏双击最大化，可预期 |
| 双击宽度把手 | 宽度复位到默认（292 / 472） | 常用的小工具动作 |
| `Alt` + 双击 tab | 移到另一侧（ghost 反馈 + toast 可撤销? 不做撤销，仅提示） | 给熟练用户的快捷方式 |
| 中键 tab / 图标 | 隐藏该面板（等同 ×） | 与编辑器标签页「中键关闭」一致（`PaneTabBar.vue` L249 注释） |
| 右键 tab / 图标 | 面板操作菜单：移到左/右、上移/下移、隐藏、在命令面板中查找 | 拖拽的键盘可达替代 |
| 右键标签头/活动栏空白 | 完整 pane picker（勾选显示/隐藏、选择侧） | 收敛旧的 `sidebar-ctx` |

### 3.7 键盘可达性与无障碍

| 要求 | 方案 |
|---|---|
| 语义 | 标签头 `role="tablist"`，tab `role="tab"` + `aria-selected` + `aria-controls`；活动栏 `role="toolbar"` + `aria-orientation="vertical"`；面板体 `role="tabpanel"` |
| 焦点 | 标签头 roving tabindex：`←/→` 移动并激活、`Home/End` 首尾、`Enter/Space` 确认；活动栏 `↑/↓` |
| 拖拽的键盘替代 | 右键菜单里的「移到左侧 / 移到右侧 / 上移 / 下移」，以及命令面板命令 `view.movePaneLeft` / `view.movePaneRight` |
| 焦点样式 | 统一 `outline: 2px solid var(--accent)` + `outline-offset: 2px`，`focus-visible` 才显示 |
| 快捷键 | `Mod+Alt+ArrowUp/Down` = 在当前聚焦的 Dock 内循环切换（空闲）；`Mod+Alt+Shift+ArrowLeft/Right` = 把 active 面板移到另一侧；命令面板 `view.focusPane:<id>` 覆盖全部面板 |
| 数字键 | **默认不绑**：`Mod+1..6` 是标题（`keybindings.ts` L197-202），`Mod+Alt+7/8/9` 是列表样式（L209-211）。若要数字切换，只能用 `Mod+Alt+1..6`，且需在 `lib/keybindings.ts` 里跑冲突检测（`hasConflict`）后才可上线 |
| 屏幕阅读器 | tab 的 `aria-label` 用 `rsPane.*` 文案；拖拽 ghost `aria-hidden="true"`；落点变更通过 `aria-live="polite"` 播报「已移到右侧第 2 位」 |

### 3.8 多栏宽度与挤压

现在最多可出现 4 列：文件树 260 + 左 Dock 292 + 编辑器 + 右 Dock 292。规则：

1. 每侧宽度独立持久化；拖动把手只改本侧。
2. 编辑器 **最小可用宽度 360px**。当 `innerWidth - 文件树(260/0) - 左宽 - 右宽 < 360` 时：
   - 若两侧都展开：把「最近未被交互」的一侧临时折叠到活动栏（`runtimeCollapsed`，**不写盘**）；
   - 恢复宽度后自动展开；
   - 若仍不够，强制折叠左侧（文件树优先保内容）。
3. 宽度下限 240，上限 `min(560, 45vw)`；Agent active 的兜底宽度按本侧计算（不再是「可见即 440」）。
4. 宽度变化后照旧派发 `solomd:relayout`（沿用 L2183-2189），让 CodeMirror 重新 measure。

### 3.9 窄屏 / 平板 / 移动端降级

判定沿用 `useViewport.ts`：`NARROW_BREAKPOINT_PX = 600`（L29），`isTabletOverlay` 覆盖 601–1023px 且 `pointer: coarse`（L97-99），两者互斥（L95）。

| 能力 | 桌面 | 平板浮层（601–1023 / coarse） | 窄屏（≤600 / 手机 UA） |
|---|---|---|---|
| Dock 形态 | 常驻两列 | 左 Dock 浮层覆盖编辑器、右 Dock 常驻 | **单抽屉**（沿用 `narrowDrawer` 的浮层，L2084-2092） |
| 活动栏 | 32px 常驻 | 32px，但触控目标放大到 44px | 不渲染；改为抽屉头部「当前面板 + ⌄」下拉 |
| 标签头 | 有（≥2 时） | 有，可横滑 | 不渲染；下拉里列出全部面板 |
| 拖拽排序 | 支持 | 支持（长按） | 关闭 |
| 跨侧拖拽 | 支持 | 关闭（触控误触高，且左 Dock 是浮层） | 关闭 |
| 跨侧移动入口 | 拖拽 + 右键菜单 | 仅右键菜单 | 仅右键菜单 |
| 宽度 | 独立持久化 | 320 浮层 | `min(86vw, 320px)`（沿用 L2815） |
| 全关 | 收起为活动栏 | 收起为活动栏 | 抽屉关闭 |

窄屏单抽屉的合并规则（关键，不能改持久化的 side）：

- 抽屉一次性列出左右两侧的全部关联面板（左侧在前）；
- 点击某个非本侧的面板 → `mobilePreviewId=id`，临时在抽屉里渲染它，**不修改** `panes[].side`；
- 关闭抽屉只清 `mobilePreviewId`，恢复原 active；
- 这样桌面端重开永远回到用户原来的左右布局。

平板浮层：左 Dock 复用现有 `isTabletOverlay` 的 scrim 逻辑（L2339-2344），点击空白收起；面板体宽度取 `min(360px, 70vw)`。

触控细节：`touch-action` 与长按阈值；抽屉打开时 Esc/返回手势关闭；Android 返回键映射到 `closeNarrowDrawer`（现有流程不变）。

---

## 4. 持久化与迁移

### 4.1 存储位置

- 继续用 `localStorage` 的 `solomd.settings.v1`（`settings.ts` L12），**不新增 schema 版本号、不换 key**。
- 新增 `sidebarDock`（一个对象，原子写入）+ `v510SidebarDockMigrated`（布尔标记）。
- 标记命名沿用现有约定（`v4AgentPanelMigrated`、`fileTreeDefaultDesktopMigrated`、`v491MobileLayoutMigrated`、`v503SourceModeMigrated`、`v507HighlightLineMigrated`）；按发布版本号取标记（5.1.0 → `v510`），当前基线 5.0.13，若实际发布号不同则同步改名。
- 为什么用布尔标记最稳：现有 blob 没有 schema 版本，且 `load()` 是 `{...defaults(), ...parsed}` 合并（L925）。只有「显式标记位」能区分「用户主动选择的结果」与「老版本的默认值」，也能保证迁移只执行一次、失败重试不会反复改写。现有 7 个迁移全是这个模式（L969-1023）。

### 4.2 迁移算法（`load()` 内，纯函数可单测）

```
migrateSidebarDock(parsed, defaults) ->
  if parsed.sidebarDock 有效:
      return sanitize(parsed.sidebarDock)           // 幂等，不依赖标记
  if parsed.v510SidebarDockMigrated === true:
      return defaults.sidebarDock                   // 标记在但数据坏了 → 回默认，不重跑
  legacySide = parsed.outlineSide === 'left' ? 'left' : 'right'
  legacyOrder = parsed.rsPaneOrder ∪ 已知 id（未知丢弃，缺失追加）
  panes = []
  for id in legacyOrder:
      def = registry[id]
      panes.push({
        id, side: legacySide,
        visible: def.visibility === 'setting' ? !!parsed[def.settingKey] : def.defaultVisible,
      })
  // outline/search 的 visible 由运行时派生，这里只给初值
  active[legacySide] = 第一个 visible 的 setting 类面板 ?? 'outline' ?? 第一个
  active[otherSide] = null
  collapsed[legacySide] = parsed.rightSidebarHidden === true
  collapsed[otherSide] = true                   // 另一侧没有面板，保持「只开一侧」
  width[legacySide] = clamp((parsed.sideSidebarWidth ?? 260) + RAIL_W)
  width[otherSide] = DEFAULT_WIDTH
  return { panes, active, collapsed, width }
```

首次安装（无 `localStorage` blob）：`parsed` 为空对象，迁移函数的输出必须与 `defaults().sidebarDock` 逐字段相等（用单测固定这条），因此不需要专门分支；迁移标记照常写入，避免每次启动重跑。

- `defaultSide`：全部归 `right`（outline/search 也归右）；
- `defaultVisible`：`backlinks=true`、`tags=true`、`agent=true`（App Store 构建运行时不显示）、`history=true`（受 autoGit 门控），其余 false；
- `collapsed.right = true`（对齐现有 `rightSidebarHidden: true`），`collapsed.left = true`；
- `active.right = 'backlinks'`；
- 左侧 0 个关联面板 → 不渲染活动栏 → 首次启动视觉与 5.0 完全一致。

### 4.3 边界与容错

| 情况 | 处理 |
|---|---|
| 未知 id（未来版本降级 / 手改 blob） | 丢弃，不阻塞其余 |
| 同一 id 重复 | 保留第一次 |
| 已知 id 缺失（升级新增面板） | 用注册表 `defaultSide/defaultOrder/defaultVisible` 追加到尾部，**不重置用户已有布局** |
| `side` 非法 | 归 `defaultSide` |
| `active` 指向不可见/不可渲染的面板 | 运行时回退到该侧第一个 `visible && available`；再不行 `null` |
| `width` 非数 / 越界 | `clamp(240, min(560, 45vw))`；渲染时再按窗口夹一次 |
| `panes` 全空 | 视为「用户关掉了所有面板」→ 两侧都不渲染；工具栏总开关打开时先走 picker 或兜底 outline |
| 迁移过程中抛错 | 标记照写，返回默认布局；`load()` 整体仍在 try/catch 内（L921-L1030） |
| JSON 被截断/损坏 | 现有逻辑已回落到默认值；迁移函数接收 `Partial`，全程用 `typeof` 守卫 |
| 移动端升级 | 不特殊处理；窄屏本来就合并单抽屉，桌面侧布局保留 |

### 4.4 迁移后的老字段处置（D3）

| 字段 | 处置 | 原因 |
|---|---|---|
| `outlineSide` | 迁移时读取；迁移后仍保留类型与 `setOutlineSide()`，行为改为「把当前栈全部面板移到该侧」；S4 再决定是否下线该设置项（`SettingsPanel.vue` L1250-1259、i18n `settings.outlineSide*`） | 老用户会在设置里找它；直接删会显得选项消失 |
| `showBacklinks` 等 8 个开关 | 迁移时读取，之后**冻结**（`persist()` 写回原值）；S2 同步把 `useAppMenu.ts` L48-61 与 `SettingsPanel.vue` L1480-1500 改读 `sidebarDock`，旧 toggle action 变成 `toggleDockPane` 的别名 | 保留一份「降级可见」的旧布局；产品代码只有迁移函数读旧值 |
| `rightSidebarHidden` | 迁移时读取，之后冻结 | 同上 |
| `sideSidebarWidth` | 迁移时读取，之后冻结 | 宽度改由 `sidebarDock.width` 管理 |
| `rsPaneOrder` | 迁移时读取，之后冻结 | 顺序改由 `sidebarDock.panes` 管理 |
| `rightSidebarPaneHeights` | 迁移时忽略；相关 action 与命令改为重置新布局；字段保留一个版本后删 | 标签式不再有竖向分栏 |
| `_rsPanesBeforeHide` | 直接删除（类型、默认值、`persist()` 剔除逻辑、`toggleRightSidebar` 分支） | 新模型不需要快照 |
| `solomd.tiles.v1` | **不动** | 编辑器分栏树，与侧栏无关 |

> 不做双写：`persist()` 会把 `this.$state` 整体写入，冻结字段天然保持在加载值。降级回 5.0.x 时看到的是升级前的那套布局，不会出现「新面板丢了」之外的异常。

### 4.5 「只开某一侧」的习惯保持

老版本只有两种形态：栈在左或栈在右（`outlineSide`），并且可以被 `rightSidebarHidden` 整体收起。

- 迁移把**所有**可见面板放到 `outlineSide` 对应侧 → 另一侧 `panes` 为空、`collapsed=true` → 视觉上仍然只有一列。这是最重要的兼容保证。
- 老用户若曾把栈收起（`rightSidebarHidden=true`）：`collapsed[legacySide]=true`，活动栏仍然出现（因为该侧有关联面板），点图标即可展开——比现在「工具栏按钮可能死掉」更可靠。
- 只有当用户主动把面板拖到另一侧，才会出现两列；这是新能力，不是默认行为。

### 4.6 迁移验收用例（必写单测，纯函数）

1. 老 blob：`outlineSide='right'`、`showBacklinks=true`、`showTagsPanel=true`、`showAgentPanel=true`、`rightSidebarHidden=false`、`rsPaneOrder` 自定义序 → 右侧关联全部 12 项、其中 3 项可见，顺序保持，左侧 0 项，`active='backlinks'`，宽度 `260+32`。
2. 同上但 `rightSidebarHidden=true` → `collapsed.right=true`，visible 集合不丢。
3. `outlineSide='left'` → 全部落左侧，右侧空；且运行时允许把面板从左侧拖到「零面板的右侧」（拖拽创建 Dock，不依赖迁移结果）。
4. 所有开关 false 且 `rightSidebarHidden=true` → 两侧不可渲染；活动栏因「有关联面板」仍挂载；`+` 可用。
5. blob 里 `sidebarDock` 已存在但 `panes` 含未知 id + 重复 id → 清洗后保留合法项，不抛错。
6. `v510SidebarDockMigrated=true` 但 `sidebarDock` 缺失 → 回默认布局，不重读老开关。
7. 首次安装（无 blob）→ 右侧关联 12 项、其中 4 项可见，`collapsed.right=true`，左侧无关联面板、无活动栏。
8. `sideSidebarWidth=440` → 迁移为 `472`（440+32），不是 440。
9. 多次 `load()` 幂等：第二次结果与第一次逐字段相等。
10. 移动端 UA + 老 blob → `sidebarDock` 与桌面同构（窄屏渲染差异不进持久化）。

---

## 5. 依赖与风险

### 5.1 拖拽实现选型（D5 关联）

`app/package.json` 中**没有** `sortablejs` / `vuedraggable` / `dnd-kit` / `vue-draggable`（已检索 `sortable|draggable|dnd|drag`，无命中）。

| 方案 | 做法 | 优点 | 缺点 / 风险 |
|---|---|---|---|
| **A（推荐）原生 Pointer Events** | 复用 `PaneTabBar.vue` L242-332 的阈值 + `elementFromPoint` + `suppressClick`，`FileTree.vue` L1070 的 4px 阈值 | 零依赖；与仓库现有两处完全同构；不依赖 HTML5 DnD；鼠标/触控一套代码；可精确控制 ghost、跨侧落点、自动滚动 | 需要自己写约 150–220 行（含自动滚动、折叠侧热区、触控长按），且要处理 `touch-action` |
| B 引入 `sortablejs`（或 `vuedraggable`） | 列表拖拽交给库 | 代码少、排序动画现成 | SortableJS 桌面端默认走 HTML5 DnD；本应用 `dragDropEnabled` 需保留原生文件拖入（`App.vue` L2137-2143 注释），会互相吞事件；跨容器 + 折叠侧 + 触控长按仍需额外逻辑；新增 1 个依赖与许可证/体积成本 |
| C `dnd-kit`（Vue 版） | 现代化指针 DnD | 无障碍支持较好 | 生态偏 React；Vue 适配非官方；包体大；与项目轻量原则冲突 |

**结论**：选 A。原生方案的既有先例已经把坑踩过一遍（HTML5 DnD 在 Tauri 里静默失效、`touch-action` 与横向滚动冲突），复制它们的结论比引入新库更省事。

### 5.2 对现有测试的影响

1. `lib/app-menu.test.ts`
   - L44-52：`ctx().state.panes` 的 11 键形状必须保持；若改为「注册表生成」，建议继续由 `useAppMenu.ts` L48-61 组装，避免测试大改。
   - L73-94：新增/改名命令必须进 `PALETTE_MENU_IDS`。
   - L143-150：既有 id（`view.toggleOutline`、`view.toggleInspector`、`view.resetSidebarPanes` 等）**不要改名**，否则要同步白名单。
   - L153-175：任何新菜单 id 必须有 `KEY_ACTIONS` 或 `useCommands` 兜底，否则三平台都失败。
   - L177-183：新菜单文案必须补齐 15 份 locale，否则 `strictT` 抛错。
   - L283-304：`panes` 子菜单顺序/末项断言；如果注册表生成，保持「重置」最后。
   - L294-305：勾选态跟随 `ctx().state.panes`；该 fixture 是**手工构造的**，不受 store 改造影响，但产品侧 `useAppMenu.ts` L48-61 必须改读 `sidebarDock`，否则菜单勾选会变成陈旧值（这是最容易漏的一处）。
   - 菜单里的 `savedViews` 不属于 Dock，继续映射 `settings.showViewsPanel`。
2. `lib/fuzzy-match.test.ts`：纯函数，无影响。
3. `lib/keybindings.test.ts` L11-23：新增的 `Mod+Alt+ArrowUp/Down`、`Mod+Alt+Shift+ArrowLeft/Right` 必须注册成对应 action 的默认值，且不能与既有 alternative 撞车；Windows 下 `interceptedBindings` 对 AltGr 组合敏感，快捷键落地时要真跑一遍。
4. `stores/settings-ai.test.ts` / `stores/settings-theme.test.ts` / `stores/tabs-cursor.test.ts`：不触碰侧栏字段，无影响。
5. `lib/calendar.test.ts`：新增面板时注册表要挂 `calendar`，但不要求改测试。
6. **新增建议测试**（node:test，纯函数，符合现有测试形态）：
   - `lib/sidebar-dock.test.ts`：§4.6 的 10 条迁移/清洗用例 + `movePane/reorderPane/hidePane/nextActive/available` 逻辑；
   - 可选 `lib/i18n-parity.test.ts`：对 15 份 locale 做键集合比对（现有测试只保证菜单文案，新增的非菜单键没有保护）。
7. **无组件测试**：`run-tests.sh` 只跑 `.test.ts`，所以标签拖拽、抽屉、窄屏必须靠 §6.3 的手工验收矩阵；`pnpm build`（`vue-tsc`）是唯一的模板类型防线。

### 5.3 其他实现风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| `outline` 的可见性是 **tab 级** | 标签模型默认「一侧一个 active」，切 tab 时 Outline 可能直接消失（`showOutlinePane` L1825） | 把 outline 定义为 `visibility:'tab'`；Dock 的 active 保持，但 body 渲染条件为 `visible && available`；不可渲染时显示该侧「空态 + 打开大纲」，不要自动跳到别的面板 |
| `search` 是会话级 | 刷新后不该恢复搜索面板 | `visibility:'session'`，不落 `visible`；迁移与持久化都跳过 |
| 门控条件变化导致「空 Dock」 | 关掉工作区后 8 个面板同时不可渲染 | 保留活动栏 + `+` + 空态提示（现有死按钮 #209 的根治版） |
| 4 列挤压 | 文件树 + 双侧 Dock | §3.8 的 360px 编辑器下限 + 运行时折叠（不写盘） |
| Agent 宽度跳变 | 老逻辑「可见即 440」 | 改成「active 且用户未手动设宽」才兜底，避免后台标签把侧栏撑宽 |
| 懒加载 | 11 个面板目前是 `defineAsyncComponent` | 注册表的 `component` 保留异步工厂；只有 active 面板真正挂载（现在的竖排是全部挂载，改成标签后**性能更好**） |
| 卸载状态丢失 | 非 active 面板被 `v-if` 移除会丢内部状态（如 Agent 草稿） | 用 `v-show` 保留已激活过的面板实例？会回到「全挂载」的内存成本。建议：仅保留 `active` 的实例，面板内部若需保状态自行持久化；在验收里明确「切走再切回，滚动位置重置」为预期 |
| 系统级拖拽冲突 | Tauri 原生文件拖入 | 拖拽手柄只在自己的 DOM 上 `preventDefault`；不做全局 `dragover` 拦截 |
| Android/iOS 长按选择文本 | 活动栏长按拖拽会触发文本选择 | `user-select:none` + `-webkit-touch-callout:none` + `contextmenu` 抑制 |
| `RsSplitter` 退役 | 组件与 CSS 还在 | S2 先停用，S4 删除；`rightSidebarPaneHeights` 同批 |

---

## 6. 实施拆分

### 6.1 步骤、验收与工作量

| 步骤 | 内容 | 验收（可独立合入） | 人日 | 风险 |
|---|---|---|---|---|
| **S0 决策** | 确认 D1–D6；确认 §6.2 的取舍 | 文档签字 | 0.5 | 低 |
| **S1 注册表 + 单侧渲染重构（零行为变化）** | 建 `panes/sidebar-panes.ts`、`SidebarPaneBody.vue`、`SidebarDock.vue`（内部仍用**竖排**布局与 `RsSplitter`）、`useSidebarSearch`；`App.vue` 两块重复模板改为两个 `<SidebarDock>`；`app-menu.ts`/`useCommands.ts` 改为遍历注册表 | 桌面端像素级与 5.0.13 一致（截图对比）；`pnpm test` 全绿；`pnpm build` 0 类型错误；`app-menu.test` 未改断言仍通过 | 1.5–2 | 中（模板搬迁易漏事件） |
| **S2 标签模型 + 双 Dock + 持久化迁移** | 新数据结构、活动栏、标签头、active/collapse 语义、宽度独立、`paneStyle`/`RsSplitter`/`rightSidebarPaneHeights`/`_rsPanesBeforeHide` 下线、迁移函数 + 10 条单测、`setOutlineSide` 改语义 | §4.6 单测全过；老 blob 三种形态手工升级验证（只有一侧、两侧、全关）；两列可同时打开；宽度 292/472 正确；i18n 15 份 | 3 | 中高（迁移 + outline 门控） |
| **S3 拖拽排序 + 跨侧移动** | `useSidebarDockDrag`、同侧插入线、跨侧活动栏描边、折叠侧热区、ghost、自动滚动、Esc、`suppressClick`；右键菜单的上/下移、移侧 | 鼠标 + 触屏各 8 条手工用例（§6.3）；拖拽后刷新布局保持；无效落点无副作用 | 2.5–3 | **最高** |
| **S4 溢出、键盘、窄屏、清理** | 标签/活动栏溢出菜单、pane picker、roving tabindex、`Mod+Alt+Arrow` 循环、`aria-live`、窄屏单抽屉合并、平板浮层、`outlineSide` 设置项处置、删除 `RsSplitter`/`sidebar-ctx`/旧 action、i18n + 新图标、i18n 键一致性测试 | 15 份 locale 全绿；窄屏三档（390/768/1200）截图；键盘全流程可完成「切换/隐藏/换侧」；`view.resetSidebarPanes` 仍可用 | 2.5–3 | 中 |
| **S5（可选）文件树 + 收藏视图并入左侧 Dock** | 方案 B：把 `Sidebar.vue` 拆成 `files` 面板 + `views` 面板 | 视 D1 结论 | 2–3 | 高 |

**核心 S1–S4 合计约 9–11 人日**；含 S5 约 12–14 人日（不含 UI 走查与多端真机回归）。

### 6.2 风险最高的一步与建议

**S3 最高**。原因：它同时叠加了 4 个难点——跨两个 DOM 子树命中测试、目标侧可能已折叠/不存在、触控与横向滚动冲突、拖拽期间还要维持焦点/无障碍替代路径。S1/S2 都是静态结构变化，失败也能回退到「无拖拽但可切换」的中间态。

降低风险的做法：
1. S2 先上线「标签切换 + 迁移」，即使 S3 延期，用户也拿到了本次 80% 的价值；
2. S3 只做「同侧排序 + 跨侧移动」两个动作，不做拖拽分栏、不做拖到窗口外浮层；
3. 把命中测试、索引计算写成纯函数（`resolveDropTarget(rects, pointer, side)`），先单测再接触点；
4. 触屏用长按 300ms 启动，桌面鼠标 4px 阈值，二者分开验收。

### 6.3 手工验收矩阵（无组件测试，必须走一遍）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 老用户从 5.0.13 升级（只开右侧、3 个面板） | 右侧仍 3 个面板、顺序不变、左侧不出现；标签头出现，一次只显示 1 个 |
| 2 | 老用户 `outlineSide=left` 升级 | 面板全在左侧，右侧空 |
| 3 | 老用户整栈收起升级 | 活动栏可见，点图标展开，可见集合不丢 |
| 4 | 关闭最后一个面板 | 该侧收起为活动栏；`+` 可恢复；不出现「死按钮」 |
| 5 | 同侧拖拽排序 | 插入线精确；松手后刷新仍保持；隐藏再显示位置不丢 |
| 6 | 把 Outline 拖到另一侧（即使该侧此前**零面板**、没有活动栏） | 边缘投放条出现；跨侧描边反馈；松手后该侧新建 Dock 并展开；源侧 active 顺延 |
| 7 | 拖到已折叠的一侧 | 边缘热区出现「放到右侧」；松手后该侧展开 |
| 8 | 标签溢出（11 个全开） | 横滑可用；chevron 列出全部；键盘可达 |
| 9 | 390px 手机 | 单抽屉；无活动栏；下拉切换；拖拽禁用；桌面侧布局未被改写 |
| 10 | 768px 平板竖屏 | 左 Dock 浮层 + 右侧常驻；点空白收起 |
| 11 | 无工作区文件夹 | 8 个面板不可渲染；活动栏 + 空态提示；不崩 |
| 12 | Agent active → 切到 Tags | 宽度回落到 292（或用户手设值），不再卡在 472 |
| 13 | 编辑器宽度 < 360px | 一侧自动折叠；拉宽窗口自动恢复；不写盘 |
| 14 | 键盘：Tab → 方向键 → Enter | 可完成切换；右键菜单可完成换侧/排序 |
| 15 | `view.resetSidebarPanes` | 顺序/侧/宽度/收起全部回默认；仍出现在菜单与命令面板 |

---

## 7. 附：改动文件清单（预估）

**新增**

- `app/src/panes/sidebar-panes.ts`
- `app/src/components/sidebar/SidebarDock.vue`
- `app/src/components/sidebar/SidebarPaneRail.vue`
- `app/src/components/sidebar/SidebarPaneTabs.vue`
- `app/src/components/sidebar/SidebarPaneBody.vue`
- `app/src/components/sidebar/SidebarPanePicker.vue`
- `app/src/composables/useSidebarDockDrag.ts`
- `app/src/composables/useSidebarSearch.ts`
- `app/src/lib/sidebar-dock.ts`（纯函数：迁移/清洗/重排/激活顺延）
- `app/src/lib/sidebar-dock.test.ts`
- `docs/sidebar-panel-dock-plan.md`（本文）

**修改**

- `app/src/App.vue`：删 11 个 pane 的模板与拖拽/右键代码；只留两个 `<SidebarDock>` + `paneContext`
- `app/src/stores/settings.ts`：新增 `sidebarDock` / 标记；迁移；action；下线 `_rsPanesBeforeHide`、`rightSidebarPaneHeights` 相关
- `app/src/stores/tiles.ts`：仅在需要共享瞬态时加拖拽态（可选）
- `app/src/lib/app-menu.ts` + `app/src/composables/useAppMenu.ts`：`panes` 菜单由注册表生成（保持 id）
- `app/src/composables/useCommands.ts`：pane 命令由注册表生成（保持 id）+ 新增换侧/循环命令
- `app/src/components/SettingsPanel.vue`：`outlineSide` 项改为「面板位置」或下线
- `app/src/components/Icons.vue`：补 5–6 个图标（backlinks / relationships / neighborhood / history / inspector / calendar）
- `app/src/i18n/en.ts` + 其余 14 个 locale
- `app/src/lib/app-menu.test.ts`：白名单/形状同步
- `app/src/styles/tokens.css`：如需新增 `--dock-rail-w`（或直接复用常量）

**不改**

- 11 个面板组件内部（`SidebarPaneBody` 只负责接线）
- `Sidebar.vue` / `ViewsPanel.vue`（D1=A）
- Rust 侧全部
- `solomd.tiles.v1` 结构
