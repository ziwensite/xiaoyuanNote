# VSCode 外壳差距分析

> 只读调研 + 设计分析，不含实施代码。现状结论均标注代码落点；拿不准的放在第 8 节。
> 参考：`docs/sidebar-panel-dock-plan.md`（S0–S5）、`docs/specs/sidebar-dock-s2/`（已落地的双 Dock）、`docs/v5-ui-spec.md`。

---

## 0. 结论速览

1. **SoloMD 现在不是“两栏”，而是四栏**：文件树列（`Sidebar.vue`）+ 左 Dock + 编辑器 + 右 Dock。VSCode 的“活动栏 + 主侧栏 + 次侧栏”只覆盖了后三者中的一部分。
2. **真正要动结构的是三件事**：把文件树并入侧栏、把两条 rail 收成一条全局活动栏、把 `side` 模型换成 `primary/secondary` 模型。其余（面包屑、Zen、居中、活动栏底部槽位）都是增量 UI。
3. **底部 Panel 与 22px 状态栏不建议照搬**；`StatsPill` 已经是有意的替代品。
4. **S3（拖拽）应暂缓**：它依赖最终的活动栏/侧栏形态；先做外壳合并，再按新模型收窄 S3。S4 与“文件树并入 + 窄屏单抽屉”合并。
5. **新装首启建议主侧栏展开（Files 激活），次侧栏收起**；理由见 §5。

---

## 1. VSCode 外壳的组成拆解

| 部件 | 在 VSCode 里解决什么问题 | 关键机制 |
|---|---|---|
| **Activity Bar（活动栏）** | 全局“入口条”：不占正文宽度地列出所有视图容器（Explorer/Search/SCM/Run/Extensions），并承载账号、设置、远程等全局入口 | 固定 48px 竖条；一个图标 = 一个 View Container；图标可带 badge；底部槽位放 Settings/Accounts；可移到左或右（跟随主侧栏） |
| **Primary Side Bar（主侧栏）** | 放“当前主容器”的内容（默认 Explorer）。它是“我正在浏览/操作什么”的常驻区域 | 一次显示一个容器；宽可拖；可整体收起；可移到右侧（连同活动栏）；Ctrl+B 切换 |
| **Secondary Side Bar（次侧栏 / Auxiliary Bar）** | 放“辅助但不想占主侧栏”的内容（Copilot Chat、Outline、Comments 等），避免和主容器抢位置 | 默认收起；一条容器；位置与主侧栏相对；有独立宽度；标题栏有开关 |
| **Panel（底部面板）** | 放“输出型/瞬时型”内容：Terminal、Output、Problems、Debug Console、Ports | 贴在底部、可拖高；可移到左/右；可最大化；有自己的标签栏；Ctrl+` / Ctrl+J |
| **Editor Group / Tabs** | 放文档本身；标签是“打开的工作集”，分栏是“同时看两份” | 组内标签可拖拽重排/拆分；溢出用 chevron；组头有面包屑与编辑器动作 |
| **Breadcrumbs（面包屑）** | 在编辑器组头显示当前符号/文件路径，提供“向上跳”的点击路径 | 24px 行；可开关；与符号导航联动 |
| **Status Bar（状态栏）** | 全宽 22px 的“全局状态 + 快捷动作”：分支、错误、行列、编码、语言、反馈 | 全局常驻；左右分区；点击即命令 |
| **Command Palette / Quick Open** | 一个入口覆盖“执行命令”和“跳转文件/符号”，减少对菜单与鼠标的依赖 | `Ctrl+Shift+P`（`>` 命令）/ `Ctrl+P`（文件）/ `@` 符号 / `:` 行号；最近使用排序；可绑定快捷键 |
| **Zen Mode** | 临时把“所有外壳”藏掉，只留编辑器；写作/演示时用 | `Ctrl+K Z`；隐藏活动栏/侧栏/面板/状态栏/面包屑；Esc 退出；不改持久布局 |
| **Centered Layout** | 把编辑器组在窗口里居中收窄，减少超宽屏上的横向扫视 | 作用于编辑器组布局，不是“限行宽”；可开关 |
| **Custom Layout** | 把“活动栏位置、侧栏位置、面板位置、各区域显隐”作为一套预设保存/切换 | 预设列表 + 自定义；持久化；命令可切换 |

一句话：VSCode 的外壳是 **“入口（活动栏）— 主工作侧栏 — 正文（编辑器）— 辅助侧栏 — 底部输出面板 — 全局状态条”** 的固定分工，而不是“左右两个对称容器”。

---

## 2. SoloMD 现状对照

### 2.1 对照表

| VSCode 部件 | 状态 | 代码落点 | 核实到的实际行为 |
|---|---|---|---|
| **Activity Bar** | 部分 | `app/src/components/sidebar/SidebarDock.vue`（`.dock-rail` L160–190；`showTabs` L72、`showBody` L73）；`app/src/lib/sidebar-dock.ts`（`SIDEBAR_RAIL_WIDTH = 32` L35） | **每条 Dock 自带一条 32px rail**，不是全局一条。图标只列“可见且可用”的面板（`renderable`），另有 `+`（复用右键面板清单）和折叠按钮；**没有底部槽位**；该侧没有关联面板时整条 rail 不渲染（`hasLeftDock/hasRightDock`，`App.vue` L2199–2226）。设置齿轮在文件树侧栏的 footer（`Sidebar.vue` ≈L400–445），不在 rail 上。 |
| **Primary Side Bar** | 部分 | `App.vue` L2172–2190 的 `Sidebar.vue`（`class="left-stack"` L2184）；`app/src/stores/settings.ts`（`showFileTree: !isMobile()` L682、`fileTreeWidth: 260` L767） | 真正承担“主侧栏”角色的是**独立的一列** `Sidebar.vue`：搜索入口（Quick Switcher）、Today/Inbox/Recent、FileTree、Tags、SyncStatusPill、设置按钮。它 260px 起、可拖宽、可整体隐藏，**但不属于任何 Dock，也没有活动栏图标**。左侧 Dock 默认只有 Outline，实际上更像“次侧栏”。 |
| **Secondary Side Bar** | 部分 | `SidebarDock.vue`（右实例，`App.vue` L2224–2226）；`settings.ts` 的 `toggleRightSidebar` / `sidebarDock.collapsed`；快捷键 `Mod+Alt+B`（`keybindings.ts` L254） | 右侧 Dock 能放 10 个面板（Search/Backlinks/…/Agent），同侧多面板时出现标签头；默认 `collapsed: { left: true, right: true }`（`sidebar-dock.ts` L70）；没有“secondary/辅助”这个命名与单容器语义，和左 Dock 完全对称。 |
| **Panel（底部）** | 缺失 | `App.vue` L2155–2226 的 `.shell` 只有左右横向分区 | 没有底部区域；没有 Terminal/Output/Problems 概念；`GithubConflictPanel` 是 History 面板的内嵌内容（`HistoryPanel.vue` L163），不是全局 Panel。 |
| **Editor Group / Tabs** | 已有（近似） | `app/src/components/TileRoot.vue`、`PaneHost.vue`、`PaneTabBar.vue`、`app/src/stores/tiles.ts` | 二叉分栏树（`direction + children + ratio`），焦点面板；标签可重排、拖拽分栏、溢出 chevron、固定/关闭菜单。单面板时标签 **Teleport 到全局 52px 头部的 `#header-tabs`**（`PaneHost.vue` L59、`Toolbar.vue` L903）；分栏时每个面板各自 40px 标签条。 |
| **Breadcrumbs** | 缺失 | 全局搜索无 `breadcrumb` 组件；Neighborhood 面板内部有导航栈，但不是编辑器路径条 | 编辑器组头没有“文件路径/符号层级 + 点击跳转”的行。 |
| **Status Bar** | 部分（非典型） | `app/src/components/StatsPill.vue`（组件头注释明确写着“replaces the status bar”）；挂载在 `App.vue` L2222 | 只有右下角浮动的胶囊：行列/选区/字数 + Pomodoro 等；**不是全宽 22px 状态栏**；SyncStatusPill 在文件树 footer。 |
| **Command Palette / Quick Open** | 部分 | `app/src/components/CommandPalette.vue`（fuzzy + i18n，L1–55）；`QuickSwitcher.vue`；`app/src/composables/useCommands.ts`（实测 **65** 条命令） | 两个独立入口：命令面板 `Mod+Shift+K`（`keybindings.ts` L231），文件切换 `Mod+P`（L232）。命令面板支持中英标题匹配与动作提示，但**没有 VSCode 的 `>` / `@` / `:` 前缀统一入口**；`Mod+Shift+P` 被绑定为“循环 编辑/分栏/预览”（L250）。`keybindings.ts` L473–475 明确写着这是“与 VSCode 命令面板的习惯冲突”。 |
| **Zen Mode** | 缺失（有近似） | Reading 模式：`App.vue` L2140（`ReadingView` 替换整个 shell）；Slideshow：`app/src/main.ts` L15–26（独立窗口）；`toolbarHidden`（`settings.ts` L700、L1446） | 阅读模式是“换一个渲染器”，不是“隐藏外壳保留编辑器”；Slideshow 是独立窗口；`toolbarHidden` 只隐藏工具栏按钮（保留标题栏）；Focus/Typewriter 只影响正文排版。**没有临时 Zen 状态**。 |
| **Centered Layout** | 部分 | `settings.ts` L735 `limitEditorWidth: true`；`Editor.vue` L6284 `cm-host--limit-width`；`previewMaxWidth/previewFitWidth` L731–732 | 已实现“把**编辑列**居中收窄到可读宽度”（默认开），以及预览限宽；不是 VSCode 那种“编辑器组整体居中”的布局开关，也没有独立命令/菜单项。 |
| **Custom Layout** | 缺失 | 仅有零散持久化：`sidebarDock`（`settings.ts` L877）、`outlineSide`、`showFileTree`、`fileTreeWidth` | 没有预设（Default/Focus/Reading/Two-column）、没有“活动栏在左/右、面板在底/侧”的整套布局对象；`outlineSide` 在 S2 后语义已变成“把所有面板移到该侧”（`settings.ts` ≈L1282）。 |

### 2.2 需要先记住的四个数字/事实

- 面板注册表共 **12** 项，其中 `calendar` 是 `pending`（无组件、`available: false`），实际可渲染 **11** 个（`app/src/panes/sidebar-panes.ts` L23–35、L80–210）。
- 左侧默认只有 **Outline**；其余 10 个都在右侧（`defaultSide: 'right'`）。
- 面板的三种可见性来源：`setting`（Dock 里存）、`tab`（`tab.showOutline`）、`session`（`searchOpen`）（`sidebar-panes.ts` L41、`visibility` 字段）。
- 窄屏不是“响应式三栏”，而是 **≤600px 切手机壳**（`useViewport.ts` L29–35），平板 601–1023 + 触屏才用浮层（L97–99）。S4 的“窄屏”实际是两套降级。

---

## 3. 结构性冲突（最重要）

### 3.1 先把“现在有几列”说清

`App.vue` L2155–2226 的实际横向顺序：

```
[文件树列 Sidebar 260px] [左 Dock(32 或 292)] [编辑器 .content] [右 Dock(32 或 292)]
```

而 VSCode 的横向顺序是：

```
[Activity Bar 48] [Primary Side Bar] [Editor Group] [Secondary Side Bar(可选)]
```

**差一个“文件树列”，且活动栏附着在侧栏上而不是独立。** 这是所有结构冲突的根。

### 3.2 必须动结构的项

| # | 冲突 | 为什么必须动结构 | 连带影响 | 量级 |
|---|---|---|---|---|
| **C1** | 文件树是第三列，不是侧栏容器 | 只要它还在 Dock 外面，就永远无法“一个活动栏 + 一个主侧栏”。要么并入，要么承认 SoloMD 是四栏外壳 | **迁移**：`showFileTree`/`fileTreeWidth`/`rightSidebarHidden` 的语义重写；**菜单**：`view.toggleFileTree` 的标题与勾选态；**快捷键**：`Mod+B` 从“文件树”变成“主侧栏”；**设置**：`showFileTree` 项、`explorerDoubleClickFiles` 等仍有效但归属变化；**i18n**：15 份文案里 “File tree / Outline side / right sidebar” 要改口径；**测试**：`sidebar-dock.test.ts` + `app-menu.test.ts` 的结构断言 | 高（3–3.5 人日） |
| **C2** | 两条 rail vs 一条活动栏 | VSCode 的活动栏是全局入口；两条 32px rail 在视觉上像“两个小抽屉”，且右侧 rail 与 VSCode 的 Secondary Side Bar **没有**对应关系（VSCode 次侧栏没有活动栏） | **迁移**：`sidebarDock` 的 `collapsed` 语义（rail 开/侧栏开）要拆成 `primary.collapsed` + `secondary.open`；**菜单/工具栏**：`view.toggleRightSidebar` 的文案与勾选态；**快捷键**：`Mod+Alt+B` 的去留；**i18n**：新增 Activity Bar / Primary / Secondary 概念 | 高（2.5–3 人日） |
| **C3** | `panes[].side` 对称模型 vs `primary/secondary` 角色模型 | 现在“左/右”是同级槽位；VSCode 是“主容器（可多视图）+ 辅助容器（可选）”。不改模型，跨区移动、默认预设、菜单勾选态都会继续按对称逻辑写 | **迁移**：老 S2 blob 的 `side` → 主/次；`outlineSide` 下线或降级为“主侧栏位置”；**菜单**：Panels 子菜单增加“移到主/次侧栏”；**快捷键**：循环焦点/换侧命令；**设置**：`outlineSide` 项；**i18n**：move to primary/secondary | 高（含在 C2 内） |
| **C4** | 标签条在全局 52px 头部（单面板时） | VSCode 的标签属于编辑器组；放在全局头部会让“应用工具栏”和“文档标签”混在一起，也堵死了面包屑与编辑器动作的位置 | **DOM**：`Toolbar.vue` 的 `#header-tabs` 退役；`PaneHost/PaneTabBar` 改为组头常驻 36px；**拖拽**：标签拖拽命中区改变；**窄屏**：头部高度重新分配；**测试**：无组件测试，需手工矩阵 | 中（1.5–2 人日） |
| **C5** | 没有底部 Panel | 如果引入，是**新增区域**：高度、折叠、标签、焦点、快捷键、窄屏都从零开始 | **状态**：`panel.open/height/activeId`；**菜单**：View → Panel、`Ctrl+J`；**设置**：面板位置；**i18n**：15 份；**窄屏**：手机不能有底部面板 | 中高（2–3 人日），但**不建议做**（见 §4） |
| **C6** | 全局布局状态是散的 | `sidebarDock` 只管两块 Dock；`outlineSide`/`showFileTree`/`fileTreeWidth` 在别处。没有“一套 layout 对象”就无法做 Custom Layout / Zen 恢复 / 首启策略 | **新状态**：`layout`（primary/secondary/activityBar/panel 的显隐与尺寸）+ 新迁移标记（建议 `v511LayoutMigrated`）；**所有读取方**：App/Toolbar/menus/settings；**测试**：迁移纯函数 | 中（并入 C1/C2） |

### 3.3 只是补 UI、不用动结构的项

- 面包屑：编辑器组头加一行 24px，读 `tabs.activeTab` 的路径/标题即可（**前提是先做 C4**）。
- Zen Mode：一个 `zen` 布尔 + CSS 隐藏活动栏/侧栏/头部，Esc 退出；不改持久布局。
- 居中布局：已有 `limitEditorWidth`，补一个命令/菜单项即可。
- 活动栏底部槽位：把 Settings/Sync 从 `Sidebar.vue` footer 迁到 rail 底部，纯布局。
- 活动栏图标分组（把 10 个右侧面板收成 4–5 个容器）：纯 UI + 注册表元数据。
- 状态栏：若要加 22px 全宽条，属于新增区域（结构），但同样**不建议**。

### 3.4 一个容易被忽略的连锁

`app-menu.ts` 的 Panels 子菜单是**手写 12 项**（L403–424），`useAppMenu` 的 `panes` 状态也是手写 12 个键（L49–62）。任何“主/次侧栏、移到侧栏、面板位置”的概念都会同时打到：菜单结构、勾选态、`app-menu.test.ts` 的白名单/数量/15 语言断言、以及命令面板的 65 条命令。**这不是文案改动，是结构改动的固定税。**

---

## 4. 不该照搬的部分

| 不照搬 | 理由 |
|---|---|
| **Terminal / Output / Problems / Debug Console（底部 Panel）** | SoloMD 没有进程、编译、诊断流；唯一的“输出”是 Agent 轨迹与同步日志，它们已经有侧栏归宿（Agent/Trace、History）。加底部面板只会长期空着，并吃掉正文高度。 |
| **Activity Bar → Container → View → Viewlet 的嵌套** | 11 个面板两层（图标 → 面板）已经够用；再套一层容器会让“找一个面板”变慢，也让注册表/菜单/i18n 复杂化。建议最多做“扁平分组”（≤5 个图标），不做树。 |
| **多 root workspace / workspace trust / `.code-workspace`** | SoloMD 是单 vault（`workspace.currentFolder`），多根、信任模型、嵌套 `.code-workspace` 对笔记应用是纯负资产。 |
| **SCM 视图容器** | Git 同步在 SoloMD 是后台能力（auto-commit、History、冲突面板）；做成 VSCode 式源代码管理树会把“写作工具”变成“开发工具”。 |
| **任意网格分栏 / 空的 Editor Group** | 现有二叉分栏树已经覆盖“左右/上下看两份”；VSCode 的网格与空组会引入布局代数与焦点规则，收益极低。 |
| **Minimap / overview ruler / problems 装饰** | 散文写作不需要字符级导航图；会持续占用右侧并干扰阅读。 |
| **全宽 22px 状态栏塞满分支/编码/空格/错误** | 信息密度对写作是噪音；`StatsPill` 已经用更低的视觉成本给了行列/字数/Pomodoro。 |
| **“命令面板是唯一入口”** | 笔记是空间化导航（文件树、标签、双链）；命令面板应是加速器，不是主入口。 |
| **Custom Layout 预设一次做全** | 先用 2–3 个真实场景（Default / Focus / Reading）验证，再谈自定义；否则是在为一个还不存在的布局需求造配置。 |

---

## 5. 建议目标形态

### 5.1 一句话

**“单活动栏（左，可随主侧栏移到右）+ 主侧栏（默认展开，承载 Files/Outline/Notes）+ 编辑器组（标签归位、保留分栏）+ 可选次侧栏（默认收起，放 Agent）+ 无底部 Panel + 无全宽状态栏。”**

### 5.2 文字示意图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 标题栏 / 菜单（Windows 44px；macOS 用原生菜单，不重复绘制）                   │
├──────┬───────────────────┬───────────────────────────────────┬───────────────┤
│ 活动 │ 主侧栏 Primary     │ 编辑器组 Editor Group              │ 次侧栏 Secondary│
│ 栏   │ 292px（默认展开）   │ ┌ 组头：标签 36px ──────────────┐ │ 292px（默认收起）│
│ 48px │ ┌ Files │ Outline ┐ │ │ note.md × │ note2.md ×       │ │ ┌ header ────┐ │
│      │ ├─────────────────┤ │ ├───────────────────────────────┤ │ │ Agent     × │ │
│ 📁   │ │ 文件树 / 大纲    │ │ │                               │ │ ├─────────────┤ │
│ 🔍   │ │                 │ │ │      编辑 / 实时 / 预览 / 分屏   │ │ │ 对话 / 轨迹 │ │
│ 🧭   │ │                 │ │ │                               │ │ │             │ │
│ 🗂   │ │                 │ │ │                               │ │ │             │ │
│ ✨   │ └─────────────────┘ │ └───────────────────────────────┘ │ └─────────────┘ │
│      │                   │          [StatsPill]               │                 │
│ ⚙ ⟳  │                   │                                  │                 │
└──────┴───────────────────┴───────────────────────────────────┴───────────────┘
底部：没有 Panel；没有 22px Status Bar
```

说明：
- 活动栏 5 个入口：**Files / Search / Outline / Notes（Tabs：Backlinks·Tags·Tasks·Types·History·Inspector·Relationships·Neighborhood）/ AI（打开次侧栏 Agent）**；底部 **Settings + Sync**。这不是嵌套，只是把 11 个图标收成 5 个高频入口。
- 主侧栏保留 S2 的“同容器多标签”（Files + Outline 可并排），比 VSCode 的“一次一个容器”略宽，但对 11 个面板更实用。
- 次侧栏只有一条 header + 一个面板（默认 Agent），没有 rail；由标题栏按钮 / `Mod+Alt+B` / 活动栏 AI 图标打开。
- Files/Outline/Search 的“可见性”继续用现有三套来源（setting/tab/session），不重写内容组件。
- 活动栏位置跟随主侧栏：老用户 `outlineSide='right'` 迁移后，主侧栏与活动栏都在右侧，**旧版“只开右侧”的肌肉记忆不被破坏**。

### 5.3 新装首启：展开还是收起？

**建议主侧栏展开（Files 激活），次侧栏收起。**

理由：
1. VSCode 默认主侧栏展开；既然要“往 VSCode 靠”，首屏就该给出可用的导航，而不是两条空 rail。
2. 当前 S2 的“两侧都收起”会让首启出现一条只有 `+` 与折叠按钮的 32px 条，既不像 VSCode 也不像笔记应用；文件树本来默认就是展开的（`showFileTree: !isMobile()`，`settings.ts` L682），说明首屏需要导航。
3. “只开一侧”的习惯仍然保住：次侧栏默认收起，主侧栏在左（新装）；老用户迁移时主侧栏落在原来那一侧。
4. 代价可控：主侧栏 292px 在 ≤1024px 窗口自动收起/浮层，复用现有 `fileTreeWidth` 与窄屏规则。

**副作用/需要拍板**：这与上一轮 D6 的“两侧面板体默认收起、左 active=Outline”不同。若坚持“首启只给一条 rail”，那就要接受首屏导航缺失；我不推荐。

---

## 6. 分批路线

前提：S2 已发布。下表按“先定形态、再改结构、最后交互”排序。

| 批次 | 内容 | 验收 | 依赖 | 风险 | 人日 |
|---|---|---|---|---|---|
| **V0 决策冻结** | 确认 §7 的 D1–D16；确定首启策略；确定“不做的清单” | 文档签字 | — | 低 | 0.5 |
| **V1 文件树并入主侧栏** | 新 `files` 容器（Today/Inbox/Recent/FileTree/Tags/SavedViews 作为容器内视图）；删除 `.left-stack`；`showFileTree` → 主侧栏显隐；`Mod+B` 语义；设置/菜单/i18n/测试 | 桌面三档截图（1200/900/390）；老 blob 迁移；`pnpm test` + `build` | V0 | **高** | 3–3.5 |
| **V2 布局模型 + 单活动栏** | `layout` 对象（`primary.position/activeId/tabs/collapsed/width`、`secondary.open/activeId/width`、`activityBar`）；`v511LayoutMigrated`；右 rail → 次侧栏 header；活动栏底部槽位；菜单/快捷键/设置/i18n/测试 | 迁移单测；菜单勾选态；老用户“只开右侧”对照 | V1 | **高** | 2.5–3 |
| **V3 编辑器标签归位** | 标签从全局头部移到编辑器组头 36px；视图切换动作移到组头；`#header-tabs` 退役 | 单面板/分屏/溢出三组截图；拖拽分栏仍可用 | V0（可与 V1/V2 并行，但 App.vue 冲突需排序） | 中 | 1.5–2 |
| **V4 拖拽（S3′）** | 主侧栏内排序；拖到次侧栏（不再“拖出一个新侧栏”）；纯函数命中测试；触屏长按 | 鼠标/触屏 8 条手工用例；刷新保持 | V2 + V3 | **最高** | 2–2.5 |
| **V5 S4′ 溢出/键盘/窄屏/清理** | 组头/活动栏溢出；roving tabindex；循环/换侧快捷键；窄屏“主侧栏抽屉 + 次侧栏浮层”；删除 `RsSplitter`/`sidebar-ctx` 残留；`outlineSide` 设置项处置；i18n 键一致性测试 | 390/768/1200 截图；键盘全流程；15 locale 断言 | V3 + V4 | 中 | 2–2.5 |
| **V6 Zen / 居中 / 面包屑** | Zen 状态 + 命令 + Esc；居中布局命令（复用 `limitEditorWidth`）；面包屑（可选） | Zen 退出后布局不变；命令面板可触发 | V3（面包屑） | 低–中 | 1.5–2 |
| **V7 Custom Layout（可选）** | Default / Focus / Reading 三套预设；序列化；菜单 | 三套预设来回切换不串状态 | V5 | 低 | 1.5–2 |
| **不做** | 底部 Panel、22px 全宽状态栏、多 root workspace、SCM 容器、网格分栏 | — | — | — | 0 |

**合计：约 14–18 人日**（不含多端真机回归与视觉走查）。

### 6.1 与旧 S3/S4/S5 的关系

- **旧 S5（文件树 + 收藏视图并入左 Dock）从“可选”升级为 V1，并且必须先做。** 否则 V2/V4 会在四栏结构上再改一次。
- **旧 S3（拖拽）→ V4，范围收窄**：取消“拖到空边新建 Dock”“折叠侧热区新建”这类对称模型专属需求；改为“同侧排序 + 移到次侧栏”。原 S3 的 2.5–3 人日可降到 2–2.5，但风险仍最高。
- **旧 S4（溢出/键盘/窄屏/清理）→ V5，范围合并**：`outlineSide` 设置项在 V2 后已无独立意义（应删除或改为“主侧栏位置”）；窄屏从“两个 Dock 各一个抽屉”合并为“主侧栏抽屉 + 次侧栏浮层”；`RsSplitter`/旧右键清单在 V5 清理。
- **旧 S3 不能按原计划马上做**：如果先在双 rail 上做拖拽，V2 统一活动栏时会把命中区、目标侧、折叠热区全部重写。建议把 S3 排到 V2/V3 之后。

### 6.2 风险最高的一步

仍是 **V4（拖拽）**，原因不变：跨子树命中、目标侧可能收起、触屏横向滚动、焦点/无障碍替代路径。V1/V2 是“结构搬迁 + 迁移”，失败可回退到“布局不乱但少功能”的中间态。

---

## 7. 需要用户拍板的决策清单

| # | 决策 | 推荐 | 理由 |
|---|---|---|---|
| **D1** | 单活动栏还是保留双 rail？ | **单活动栏** | 双 rail 在视觉与语义上都不是 VSCode；次侧栏本来就不该有活动栏。 |
| **D2** | 文件树现在并入侧栏，还是保持独立一列？ | **现在并入（V1）** | 否则“像 VSCode”只停留在皮肤层；且后续 V2/V4 要返工。 |
| **D3** | 主侧栏默认展开还是收起？ | **展开（Files 激活）** | 见 §5.3；首屏需要导航，VSCode 也默认展开。 |
| **D4** | 次侧栏默认内容？ | **Agent**，并保留一个容器选择器 | 沿用 D6 的 Agent；次侧栏只有一条，默认给最常用的 AI。 |
| **D5** | 是否引入底部 Panel？ | **不引入** | 没有真实输出型内容；会长期空置并压缩正文。 |
| **D6** | 是否加全宽状态栏？ | **不加**，保留 `StatsPill` | 5.0 的设计决策就是“无状态栏”，写作用户收益低。 |
| **D7** | 标签条是否移到编辑器组头？ | **移**（V3） | VSCode 心智模型；释放全局头部，给面包屑/编辑器动作留位。 |
| **D8** | 主侧栏保留多标签，还是一次一个容器？ | **保留多标签** | 11 个面板 + 现有标签头已经可用；改成单容器会牺牲效率。 |
| **D9** | 活动栏是否跟随主侧栏左右移动？ | **跟随** | 老用户 `outlineSide='right'` 可原样迁移；也符合 VSCode 行为。 |
| **D10** | 快捷键是否对齐 VSCode？ | **最小对齐**：`Ctrl+Shift+P` 给命令面板（把 `view.cycleView` 让位或加别名）；`Ctrl+B` = 主侧栏；`Ctrl+Alt+B` = 次侧栏；`Ctrl+K Z` = Zen | 命令面板是最强的肌肉记忆；其余保持 Typora 预设兼容。需同步 `KEY_ACTIONS`、预设与 15 份文案。 |
| **D11** | 旧 `outlineSide` 设置项？ | **下线**，由 `primary.position` 取代 | S2 后它已经是“移全部面板”，名字会误导。 |
| **D12** | 布局状态用旧 `sidebarDock` 扩展，还是新 `layout` 对象？ | **新 `layout` + `v511LayoutMigrated`**，旧字段冻结 | 主/次/活动栏/面板是不同维度；扩展旧对象会让迁移代码越来越绕。 |
| **D13** | Zen Mode 做不做？ | **做**（V6） | 成本低；比“阅读模式换渲染器”更符合“临时藏外壳”的直觉。 |
| **D14** | 面包屑做不做？ | **V6 可选，默认不做** | 笔记应用里标签+文件树已提供路径感；收益低于成本。 |
| **D15** | Custom Layout 预设做不做？ | **先不做**，V7 可选 | 只有真实场景（Focus/Reading）验证后才值得。 |
| **D16** | 移动端是否也套 VSCode 外壳？ | **不套**，手机继续用 `phone` 壳；桌面模型不强制 | `useViewport.ts` L29–35 已把手机与桌面分开；强行套会破坏现有移动交互。 |

---

## 8. 推测 / 未完全核实项（不要当作结论）

1. **macOS 标题栏与菜单的最终呈现**：代码里同时有 `winTitleBar` / `macTitleBar` 与原生菜单规格（`app/src/lib/chrome.ts`、`useAppMenu`），但本次没有在 macOS 真机上核对“标题栏是否与 Windows 一样高、菜单是否完全原生”。—— 推测：macOS 不绘制 Windows 那条 44px 菜单条。
2. **`SidebarDock` 在窄屏左抽屉的最终视觉**：`App.vue` 在窄屏给 Dock 传 `overlay`，CSS 有抽屉定位；但没有运行态截图确认“左 Dock 抽屉 + 文件树抽屉”是否会同时出现。—— 推测：S4 之后才收敛为单抽屉。
3. **“所有面板可见性”在新建 tab 时的默认**：`showOutline` 默认值在 S2 改成了 `true`（`settings.ts` 默认值区），但老用户 session 恢复路径是否也遵循该默认，未逐条核对恢复代码。—— 推测：恢复的 tab 保留其持久化的 `showOutline`。
4. **`Calendar` 面板的最终归属**：注册表预留 `right + visible`，但次侧栏只有一条容器；未来更可能是“Notes 容器里的一个标签”或“次侧栏默认内容”。—— 推测，需与 `docs/calendar-pane-plan.md` 对齐。
5. **活动栏 5 个分组的边界**：把 8 个右侧面板收进 “Notes” 只是本文件的建议，不是现有代码事实；实际分组需按使用频率再定。
6. **人日估算**：基于现有组件规模与 S1–S2 的实际改动量反推，未包含视觉走查、多端真机、评审与返工。

---

## 9. 代码证据索引（便于复核）

- 外壳骨架：`app/src/App.vue` L2125–2226（`.app` / `.shell` / `.left-stack` / `.main-col` / `.workspace` / 两个 `SidebarDock` / `StatsPill`）
- 窄屏与平板：`app/src/composables/useViewport.ts` L29–35、L97–99；`App.vue` CSS ≈L2535–2615
- Dock 组件：`app/src/components/sidebar/SidebarDock.vue` L72–73、L86、L110、L160–190、L194、L209
- Dock 纯函数模型：`app/src/lib/sidebar-dock.ts` L16–39、L60–73
- 面板注册表：`app/src/panes/sidebar-panes.ts` L23–35、L52–71、L80–210
- 设置默认值/动作：`app/src/stores/settings.ts` L682、L700、L731–735、L767、L877–878、≈L1260–1420、≈L1040–1070（迁移）
- 文件树侧栏：`app/src/components/Sidebar.vue` ≈L231–445（导航卡片 / FileTree / Tags / footer）
- 编辑器分栏与标签：`app/src/stores/tiles.ts`；`app/src/components/TileRoot.vue`；`PaneHost.vue` L59；`PaneTabBar.vue`
- 头部与标签 Teleport：`app/src/components/Toolbar.vue` L42（注释）、L903（`#header-tabs`）
- 菜单：`app/src/lib/app-menu.ts` L403–424（Panels 子菜单）；`app/src/composables/useAppMenu.ts` L49–62
- 命令面板：`app/src/components/CommandPalette.vue` L1–55；`app/src/composables/useCommands.ts` L220–225（实测 65 条）
- 快捷键与 VSCode 冲突说明：`app/src/lib/keybindings.ts` L231–232、L250、L253–255、L473–475
- 状态胶囊：`app/src/components/StatsPill.vue`（组件头注释“replaces the status bar”）
- 阅读/演示：`app/src/App.vue` L2140；`app/src/main.ts` L15–26
- 居中限宽：`app/src/components/Editor.vue` L6284；`settings.ts` L731–735
