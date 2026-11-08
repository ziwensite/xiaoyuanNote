# V1 变更对照：文件树并入主侧栏

> 只读调研 + 变更对照，不含实施代码，不改源码。
> 前提决策（已确认）：**D2 文件树并入侧栏**；**D3 新装首启主侧栏展开（文件树激活）、次侧栏收起**；**D5/D6 不做底部 Panel、不做全宽状态栏**；**D10 快捷键只对齐高频少数**。
> 现状结论均给代码落点；拿不准的单列在第 7 节。参考 `docs/vscode-shell-gap-analysis.md`、`docs/sidebar-panel-dock-plan.md`、`docs/specs/sidebar-dock-s2/spec.md`。

---

## 1. 改前 / 改后布局对照

### 1.1 改前：四条横向区域

```
┌ 标题栏 / 菜单（Windows 44px；macOS 用原生菜单）───────────────────────────────┐
├───────────────┬───────────┬──────────────────────────────┬─────────────────────┤
│ ① 文件树列      │ ② 左 Dock  │ ③ 编辑器 Editor               │ ④ 右 Dock           │
│ Sidebar.vue    │ 32 / 292  │ .content（flex: 1）           │ 32 / 292            │
│ 260px          │ 含 32 rail │ 分栏比例 20–80%               │ 含 32 rail          │
│ 180–600        │ 240–560   │                              │ 240–560（Agent 472） │
│ 自带拖柄        │ 自带拖柄    │                              │ 自带拖柄             │
└───────────────┴───────────┴──────────────────────────────┴─────────────────────┘
```

代码依据：[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2182-L2240) 的 `.shell` 顺序是 `Sidebar`（`.left-stack`）→ `.main-col` → `.workspace`（左 `SidebarDock` → `.content` → 右 `SidebarDock`）；`.shell` 为横向 flex（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2472-L2477)）。

各列的宽度 / 折叠形态：

| 区域 | 默认宽度 | 拖拽边界 | 折叠后的形态 | 依据 |
|---|---|---|---|---|
| ① 文件树列 | `fileTreeWidth` = 260 | 180–600 | **整列卸载**：`v-if="settings.showFileTree && !isNarrow"`；工具栏出现一个“显示侧栏”按钮 | [settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L766-L767)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1566-L1572)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L193-L212)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2183-L2190)、[Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L890-L898) |
| ② 左 Dock | 292（含 32 rail） | 240–560，且 `min(w, 45vw)` | **32px rail**（`collapsed: { left: true }` 默认收起） | [sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L35-L38)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L104-L117) |
| ③ 编辑器 | 剩余宽度 | 分栏比例 20–80 | — | [settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L916-L919) |
| ④ 右 Dock | 292（Agent 时 472） | 240–560，且 `min(w, 45vw)` | 32px rail（默认收起） | [SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L102-L108) |

两个容易忽略的现状事实：

1. **两条 rail 一直存在**：`hasLeftDock` 用“该侧是否分到过面板”判断，不看面板是否可见（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L1829-L1846)），而左 Dock 默认分到 Outline，所以左 32px rail 始终挂载——即使文件树列也在旁边。
2. **“未收起但没有可渲染面板”会留下 292px 空体**：`showBody` 为 false 时只是不画 body，宽度仍按 `sidebarDock.width` 给（[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L72-L75)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L110-L117)）。V1 迁移必须避免把“文件树隐藏”翻译成这种状态。

### 1.2 改后：三条横向区域

```
┌ 标题栏 / 菜单 ─────────────────────────────────────────────────────────────────┐
├───────┬───────────────────────────┬────────────────────────────┬────────────────┤
│ 左    │  ← ① 文件树列并入这里 →      │ 编辑器 Editor               │ 右 Dock         │
│ Dock  │  Files 容器（内容 260）      │ .content（flex: 1）         │ 32 / 292        │
│ rail  │  搜索 / 今天·收件箱·最近     │                            │ （不变）         │
│ 32px  │  FileTree / 标签 / SavedViews│                            │                │
│       │  底部：同步 + 设置            │                            │                │
│       │  （原 180–600 的拖拽边界）    │                            │                │
└───────┴───────────────────────────┴────────────────────────────┴────────────────┘
        ↑ 消失的是“独立的文件树列”；它的内容整体搬进左 Dock 的 body
```

一句话：**四栏变三栏。消失的是 ① 那一列（`.left-stack`）；不是删掉文件树，而是把它变成左 Dock 里的 `Files` 容器。** 原来 ① 的 260px 内容宽度正好由 `DEFAULT_DOCK_WIDTH = 292 = 260 + 32` 复现（[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L35-L36)）——S2 的常量本来就是按“内容 + rail”设计的，V1 是把它用满。

改后各区域的形态：

| 区域 | 改后默认宽度 | 拖拽边界 | 折叠后的形态 | 与改前的差异 |
|---|---|---|---|---|
| 左 Dock（含 Files 容器） | 292（内容 260） | 建议 **212–560**（见 §1.3） | **32px rail 保留** | ⌘B 不再把整列变没，会留下 rail；这是最明显的手感变化 |
| 编辑器 | 剩余宽度 | 分栏 20–80 | — | 不变 |
| 右 Dock | 292（Agent 472） | 240–560 | 32px rail | 不变 |

Files 容器内部保持原 `Sidebar.vue` 的信息架构：52px 顶部 inset（折叠按钮）、搜索入口、今天/收件箱/最近、`FileTree embedded`、标签 chips、Saved Views、底部同步与设置（[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L231-L465)）。容器化时需要去掉它自己的“外层宽度 + 拖柄”（[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L469-L484)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L835-L858)），否则会出现两个拖柄和两套宽度源。

### 1.3 宽度边界：240 还是 212

- 现状：文件树内容最小 180（[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1566-L1572)），Dock 整体最小 240（[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L37)）。
- 合并后宽度只有一套（Dock 整体宽 = 内容 + 32）。若保留 `MIN_DOCK_WIDTH = 240`，老用户把树拖到 180 时，升级后会被抬到 240，**凭空变宽 28px**。
- 建议把最小整体宽改为 **212**（180 内容 + 32 rail），最大仍 560。这样“拖到最窄”的旧状态可原样迁移。

---

## 2. 受影响交互清单

每条都是“改前 → 改后”。代码落点写在依据列。

| # | 日常操作 | 改前 | 改后 | 依据 / 备注 |
|---|---|---|---|---|
| 1 | **展开 / 收起文件树**（⌘B、工具栏按钮、设置勾选） | `showFileTree` 一个布尔；false 时整列卸载，窗口里没有侧栏，工具栏出现 `sidebar` 按钮（`toolbar--lead`） | 同一个开关改为“主侧栏显隐”：收起后**保留 32px rail**；工具栏按钮、菜单 id、设置勾选都保留；文案从 “Toggle File Tree” 变成 “Toggle Primary Sidebar” | [settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1304-L1307)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2183-L2190)、[Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L874-L898) |
| 2 | 点「今天 / 收件箱 / 最近」 | 在文件树列顶部 | 在 Files 容器顶部，行为不变（同一个 `Sidebar.vue`） | [Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L76-L139) |
| 3 | 点「全部标签」chips | 仍打开右侧 Tags 面板（`showDockPane('tags')`） | 不变（Tags 仍在右 Dock） | [Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L148-L152) |
| 4 | 文件树的右键 / 新建 / 重命名 / 拖放 / 排序 / 过滤 | `FileTree` 独立列，自带 section 行与工具条 | 同一组件以 `embedded` 模式放进 Files 容器，交互不变；`embedded` 已经有专门样式（无外宽、无边框、滚动交给宿主） | [FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L78-L78)、[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L2569-L2585)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L346-L365) |
| 5 | **切文件树 ↔ 大纲** | 两列并排，同一屏同时可见；大纲在左 Dock / 右 Dock 取决于 `outlineSide` | **不能同屏**：同一侧只有一个 active body。需要 §3 的方案裁决 | [SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L64-L75)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L193-L209) |
| 6 | 拖动侧栏宽度 | 两个拖柄、两个宽度源：文件树 180–600，Dock 240–560 | 一个拖柄、一个宽度源；`fileTreeWidth` 冻结，`sidebarDock.width.left` 生效；边界见 §1.3 | [Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L193-L212)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L119-L140) |
| 7 | 拖动编辑器分栏 / 标签拖拽分屏 | 由 `tiles.ts` + `PaneTabBar` 处理，与侧栏无关 | **不变**：`solomd.tiles.v1` 只存编辑器分栏树与焦点面板；横向坐标会因少一列而整体左移，但命中逻辑不变 | [tiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/tiles.ts#L5-L14) |
| 8 | 双击标题栏 | 最大化 / 还原（自定义标题栏） | **不变**（V1 不动 `#header-tabs`；标签归位是 V3） | [Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L109-L120)、[Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L900-L903) |
| 9 | Dock rail 上的 `+` / 右键菜单 | 弹出面板清单，勾选切换面板 | 不变；**建议 `files` 不进入该清单**（它是容器，不是可勾选面板，否则会出现“勾掉文件树但主侧栏仍在”的歧义） | [SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L173-L181)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L231-L243) |
| 10 | 菜单：视图 › 切换文件树 / 面板子菜单 | `view.toggleFileTree` 是一个菜单项；Panels 子菜单手写 12 项 | id 不变 → 快捷键断言、用户改键都继续有效；只改文案。Panels 子菜单仍 12 项，不新增 `files` | [app-menu.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.ts#L403-L424)、[app-menu.test.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.test.ts#L190-L194) |
| 11 | 打开文件夹 / 新建文件 / Reveal in file tree | 多处 `if (!showFileTree) toggleFileTree()`，强制把文件树列打开 | 效果变成“打开主侧栏”；调用点可不动（仍是同一个 action），但要验证不会在手机/平板把抽屉误开 | [useFiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useFiles.ts#L732-L754)、[useCommands.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useCommands.ts#L176-L180)、[PaneTabBar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L196-L199)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L120-L121) |
| 12 | 窄屏 ≤600（手机壳） | 不渲染桌面侧栏；`Sidebar variant="phone"` 是“笔记”首页；`showFileTree` 在手机壳里无实际作用 | **不变**。V1 的 `showFileTree` 语义变化不能波及 phone 分支（`Sidebar` 在手机上是无条件渲染的） | [App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2170-L2181)、[useViewport.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useViewport.ts#L29-L35) |
| 13 | 平板浮层 601–1023 + 触屏 | `.left-stack` 绝对定位成抽屉，scrim 点一下关闭文件树 | 同一个抽屉改为“主侧栏抽屉”；scrim / 打开文件后自动关（`phoneShowEditor`、折叠屏 watcher）继续调 `toggleFileTree`，效果一致 | [App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2164-L2169)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L1894-L1930)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2492-L2499) |
| 14 | 手机打开文件后自动收起侧栏 | `isNarrowViewport() && showFileTree` → `toggleFileTree()` | 不变（对桌面窄窗仍有效；手机壳本身不渲染侧栏） | [useFiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useFiles.ts#L398-L402) |

### 2.1 快捷键（D10 收敛后的实际结论）

| 键 | 现状 | V1 建议 | 依据 / 冲突 |
|---|---|---|---|
| `⌘B` | `view.toggleFileTree`（文件树） | 保留同一个 action id，语义改为“主侧栏显隐”；用户改键与 writer preset 不受影响 | [keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L253-L254)、[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L549-L552) |
| `⌘⇧B` | writer preset 里与 `⌘B` 交换（粗体 / 文件树） | 机械上继续有效；只是标签语义跟着改 | 同上 |
| `⌘⇧E` | **已被 `file.openExternal` 占用**；Windows 的 AMD 覆盖还把它列为冲突项 | **V1 不新增**。若要按 VSCode 做“聚焦文件容器”，必须先让 `file.openExternal` 改键，属于额外的迁移成本 | [keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L153-L154)、[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L492-L492) |
| `⌘J` | **已被 `editor.aiRewrite` 占用**；且我们没有底部 Panel | **不绑定**（D10 的“若有对应”不成立） | [keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L190-L190) |
| `⌘⇧O` | Toggle Outline | 不变 | [keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L255-L255) |

结论：V1 真正只需要处理 `⌘B` 的语义与文案；`⌘⇧E` / `⌘J` 都不动。这与 D10 “不做整套 VSCode 映射”一致。

---

## 3. 重点：文件树与大纲不能同屏

### 3.1 为什么“同屏”会消失

S2 的 Dock 每侧只有一个 `activeId`，body 只渲染它；多面板时只有一排标签做切换，不是分栏（[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L64-L75)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L193-L209)）。文件树一旦成为左 Dock 的容器，它和大纲就不再是两个并排的列。

### 3.2 三个候选

| 方案 | 做法 | 代价 | 对老用户的影响 | 与 V2 的关系 |
|---|---|---|---|---|
| **A. 大纲默认放次侧栏**（推荐） | `outline` 的 `defaultSide` 改为 `right`；主侧栏只有 Files；次侧栏用标签容纳 Outline + Agent | 次侧栏默认收起 → 首屏看不到大纲，要一次 `⌘⇧O` 或活动栏；次侧栏需要能放两个面板（S2 标签已支持，几乎零新代码）；S2 新装用户的大纲要一次性从左侧移到右侧 | 大多数老用户 `outlineSide='right'`（默认与迁移都来自老值），**几乎无感**；少数只在左侧用大纲的用户会看到大纲移到右侧且默认收起 | 最贴合“主容器 + 辅助容器”的 V2 模型；次侧栏只有一条 header，不被大纲污染 |
| **B. 主侧栏内上下可折叠分区** | Files 与 Outline 做成同一容器里的上下两个分区，各自滚动、可拖分隔线 | 新增纵向分隔 + 高度持久化 + 键盘/无障碍；与“每侧一个 active body”的模型冲突；与 S3 拖拽目标冲突；预计多 2–3 人日 | 保留“边选文件边看大纲”的习惯，连续性最好；但 900px 窗口下两个分区各剩一半高度，长树/长大纲都要滚 | V2 的活动栏语义是“一个图标一个容器”，分区会把它撑成例外 |
| **C. 主侧栏内双视图切换（标签）** | Files 与 Outline 都留在左 Dock，作为两个标签 | 零新机制（S2 已有）；但一次只能看一个，切走就看不到另一个 | 左侧大纲用户保住位置，但失去同屏；右侧大纲用户若默认仍留右侧，则此方案只是“想挪回来”的逃生口 | 与 V2 兼容；可作为 A 的兜底能力 |
| **D. A + C 混合**（事实推荐） | 默认按 A 放次侧栏；同时保留把 Outline 挪回主侧栏做成标签的能力 | 不需要额外代码，C 是现有能力 | 兼顾“不想看到大纲”和“想让它挨着文件树”的两类人 | 与 V2 无冲突；跨区移动本来就要在 V2 定义 |

### 3.3 推荐与理由

**推荐 A（并把 C 作为能力保留，即 D）。**

1. **与 VSCode 的分工一致**：主侧栏 = Explorer（文件），次侧栏 = Outline / Chat。V2 要收成单活动栏时，主侧栏只该有一个“主容器”。
2. **对老用户最稳**：`outlineSide` 的默认是 `right`（[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L680-L680)），S2 迁移也按老值落侧（[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L146-L230)）。把大纲留在右侧，多数人升级后看到的就是“少了一列文件树”，而不是“大纲换了地方”。
3. **成本最低**：不需要新的分栏/分区原语；次侧栏的标签能力 S2 已经交付。
4. **代价可接受**：S2 之后新装的用户（`defaultSide: 'left'` 的 Outline）会经历一次性右移；这可以用迁移标记只做一次，并写进升级说明。
5. **不推荐 B 的理由**：它把“文件树看多久、大纲看多久”变成必须手工调高度的日常操作，且和 V2 的单容器模型打架。只有在“边选文件边看大纲”被确认是核心工作流时才值得做。

---

## 4. 迁移方案

### 4.1 老用户升级后看到什么

| 用户画像 | 升级前 | V1 升级后 | 说明 |
|---|---|---|---|
| **P1（多数）**：文件树在左，大纲在右 | 四栏；左 Dock 只有一条空 rail，右 Dock 可能收起 | 三栏；原来那条空 rail 变成 Files 容器的 rail。文件树宽度不变，大纲仍在右侧、仍按原收起状态 | 视觉上“少了一条 32px 空条”，其它位置不动 |
| **P2**：S2 新装（左 = 文件树 + 大纲，右 = 日历 + Agent） | 文件树列 + 左 Dock（大纲） | Files 占左；大纲按 A 一次性移到右，且次侧栏保持收起；用户需按 `⌘⇧O` 或点活动栏才能看到大纲 | 这是本方案唯一明显“位置变化”的人群 |
| **P3**：`outlineSide='left'` 且右栏关闭 | 文件树列 + 左 Dock 大纲，同屏 | 文件树为主；大纲移到右并收起 → 首屏失去大纲；可手动把大纲挪回主侧栏做成标签（C） | 影响最大的人群，升级说明里要单独点名 |
| **P4**：手机 / 平板 | 手机壳“笔记”首页；平板浮层 | 不变（V1 不碰 phone 壳） | `Sidebar variant="phone"` 无条件渲染 |
| **P5**：V1 之后的新装 | — | 主侧栏展开、Files 激活；次侧栏收起；大纲在次侧栏标签里 | 与 D3 一致 |

### 4.2 已持久化状态怎么处理

| 键 / 状态 | 现状 | V1 处理 |
|---|---|---|
| `showFileTree` | 默认 `!isMobile()`；老安装还有一次强制打开迁移；约 10+ 处写入点 | **保留键名**，语义改为“主侧栏显隐”的镜像；`toggleFileTree` 改为翻转主侧栏；这样所有 `if (!showFileTree)` 调用点无需改。升级时以它为准决定主侧栏开合 |
| `fileTreeWidth` | 260 默认，180–600 | 迁移时一次性算出 `sidebarDock.width.left = clamp(fileTreeWidth + 32)`；之后**冻结**，只作为旧键保留（V2 再清） |
| `sidebarDock.width.left` | 292 默认，240–560 | 迁移时被 `fileTreeWidth + 32` 覆盖一次；之后是唯一宽度源。建议最小宽改 212（见 §1.3） |
| `sidebarDock.collapsed.left` | 默认 `true` | 迁移时重算为 `!showFileTree`；之后随 `toggleFileTree` 同步 |
| `sidebarDock.active.left` | 默认 `'outline'` | 改为 `'files'`（当文件树可见）；否则取该侧第一个可见面板 |
| `sidebarDock.panes` | 11 个已实现 + calendar 预留 | **新增 `files` 条目**（`side: 'left'`，`visible = showFileTree`）；大纲按 A 改到 `right`。注意 `sanitizeSidebarDock` 会给缺失的新面板自动补默认值（[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L114-L118)），所以不能只靠注册表默认，必须在迁移里显式写 `visible`，否则隐藏过文件树的用户会被强制打开 |
| `outlineSide` | S2 后已降级为“把全部面板移到该侧”的开关 | **冻结**。但 `setOutlineSide` 现在会 `moveAllPanesToSide`（[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1282-L1287)），加入 `files` 后会**把文件树也搬走**；V1 必须把它收窄为“只移动 outline”，或在设置里隐藏该项（[SettingsPanel.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/SettingsPanel.vue#L1251-L1260)） |
| `sideSidebarWidth` / `rightSidebarHidden` | S2 已冻结 | 不读、不写 |
| `showViewsPanel` | 文件树列底部 | 不变，仍在 Files 容器里 |
| `solomd.tiles.v1` | 只存编辑器 `root` + `focusedPaneId`（[tiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/tiles.ts#L5-L14)） | **不动**；侧栏列数变化不影响分栏比例与焦点 |

### 4.3 是否需要 `v510SidebarDockMigrated` 之外的新标记

**需要。建议新增一个一次性标记（代号 `v511FileTreeMerged`，最终命名随 V2 一起定）。** 理由：

1. **大纲换侧是一次性动作**：没有标记就会在每次启动时把用户手动挪回主侧栏的大纲又推回右侧。
2. **宽度重算是一次性动作**：`fileTreeWidth → sidebarDock.width.left` 只应发生一次；之后必须尊重用户的拖拽结果。
3. **开合语义要对账**：`showFileTree` 与 `collapsed.left` 在旧数据里可能互相矛盾（例如树关着、大纲开着）。需要一次性的仲裁规则（建议以 `showFileTree` 为准），之后两者保持镜像。
4. **顺序**：V1 迁移必须在 `v510SidebarDockMigrated` 之后执行（先完成 S2 的对称模型折叠，再谈 V1 的 Files 容器）；已有 `sidebarDock` 数据只做 sanitize + 上述一次性补齐，永不回读 legacy 开关。

```text
load():
  1. S2 迁移（v510）→ sidebarDock 成型
  2. V1 迁移（v511，缺失时执行）
       a. 注册表补 files；outline 移到 right
       b. width.left = clamp(fileTreeWidth + 32)
       c. collapsed.left = !showFileTree；active.left = files
       d. 写回 v511 = true
  3. 之后只 sanitize，不再读 showFileTree / fileTreeWidth 作为布局来源
```

（上面是流程说明，不是实施代码。）

---

## 5. 回归风险：最容易出问题的 5 处

| # | 风险点 | 为什么会回归 | 怎么验证 |
|---|---|---|---|
| **R1** | **双拖柄 / 双宽度 / 空体宽度** | `Sidebar.vue` 自带 `--sb-w` 与拖柄（[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L193-L212)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L435-L440)），`SidebarDock` 也有（[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L119-L140)）。不拆掉内层，就会一次拖动改两个数、“越拖越窄/越宽”。反之，若收起时只改 `showFileTree` 不改 `collapsed`，会命中 292px 空体 | 拖到最小/最大各一次，读两个持久化值只应有一个变化；⌘B 收起后只剩 32px rail；`solomd:relayout` 在收起/展开后各触发一次（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2051-L2063)） |
| **R2** | **`showFileTree` 的写入点群** | 至少 10 处“自动打开”路径：`useFiles` 开文件夹 / iOS / Android / SAF（[useFiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useFiles.ts#L732-L754)）、`useCommands` 新建文件（[useCommands.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useCommands.ts#L176-L180)）、`PaneTabBar` reveal（[PaneTabBar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L196-L199)）、`App` 的 Android / SAF / 平板分支（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L120-L121)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L1322-L1325)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L1894-L1896)）。语义一变，任意一处都可能把主侧栏在手机/平板上误开 | 逐条走：开文件夹、新建文件、Reveal、Android/SAF、平板 `?forceTabletOverlay`；每次确认“该开的地方开、手机壳不动” |
| **R3** | **S2 的对称模型与迁移测试** | `migrateSidebarDock`、`moveAllPanesToSide`、`nextActiveAfterHide`、`defaultSidebarDock` 都假定左右是同级槽位（[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L60-L73)）；加 `files`、挪 `outline` 会改变默认值、active 回退顺序与既有断言（`app/src/lib/sidebar-dock.test.ts`） | 三种 fixture 各跑一次：全新、S2 已迁移、pre-S2；单测覆盖：新面板追加、outline 换侧、隐藏树不被强制打开、宽度 clamp |
| **R4** | **手机壳 / 平板浮层 / 折叠屏分支** | `App.vue` 在窄屏不渲染桌面 Sidebar（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2170-L2190)），平板另走绝对定位抽屉（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2492-L2499)），折叠屏 watcher 还会自动开合（[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L1902-L1930)）。把 `showFileTree` 改成主侧栏后，任何一处忘了排除手机分支，都会让“笔记”首页消失或抽屉双开 | 390 宽（手机壳）、768 宽 + 触屏（平板浮层，`?forceTabletOverlay`）、1200 宽（桌面）三档各走一遍开合与打开文件 |
| **R5** | **菜单 / 快捷键 / 设置 / i18n 的语义漂移** | `view.toggleFileTree` 仍是同一个 id，所以**不会编译报错**，但文案、勾选态、writer preset 说明、15 份语言、`app-menu.test.ts` 的 `Ctrl+B`/`Ctrl+Shift+B`/`CmdOrCtrl+Shift+B` 断言（[app-menu.test.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.test.ts#L190-L194)、[app-menu.test.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.test.ts#L245-L245)）都要跟着“文件树 → 主侧栏”改；设置里 `outlineSide` 若仍能搬走全部面板，会变成隐藏地雷（见 §4.2） | `pnpm test`（含 15 语言断言）；逐项检查 en/zh 的 `menubar.toggleFileTree`、`settings.showFileTree`、`settings.outlineSide`；手工点一次菜单与设置 |

补充一个容易漏的点（并入 R1）：`settings` 里 `setOutlineSide` 目前调用 `moveAllPanesToSide`，新增 `files` 后必须收窄，否则设置里切“大纲左侧/右侧”会把文件树也搬走。

---

## 6. 验收方式

### 6.1 我可以自动验证

- `pnpm test`：基线为 S2 交付时的 **600/600**（本次只读任务未复跑）；V1 要新增迁移与宽度纯函数用例。
- `pnpm build`（含 `vue-tsc`）。
- 定向检查：`showFileTree` 的所有写入点、phone 分支是否被 `showFileTree` 影响、`files` 是否出现在 Panels 菜单（预期不出现）。

### 6.2 需要你目视核对（本环境无法看 GUI，以下均标注“需你代核对”）

| # | 场景 | 操作 | 期望 | 谁核对 |
|---|---|---|---|---|
| 1 | 桌面 1200px | 新装 / 清 localStorage 后首启 | 主侧栏展开、Files 激活；只有三栏；次侧栏收起 | **需你代核对** |
| 2 | 桌面 1200px | `⌘B` 收起、再展开 | 收起后只剩 32px rail（不是整列消失）；展开恢复文件树宽度 | **需你代核对** |
| 3 | 桌面 1200px | 拖左 Dock 到最窄 / 最宽 | 最小 ≈212、最大 560；内容不被裁切；编辑器宽度跟随且无横向滚动条 | **需你代核对** |
| 4 | 桌面 900px | Files ↔ 大纲切换（按 §3 采纳方案） | 按 A：大纲在右、默认收起，`⌘⇧O` 可打开；主侧栏不出现第二个 body | **需你代核对** |
| 5 | 桌面 900px | 文件树右键 / 新建 / 重命名 / 拖放 / 排序 / 过滤 | 与升级前一致；菜单不被裁切 | **需你代核对** |
| 6 | 桌面 900px | 打开文件夹、新建文件、Reveal in file tree | 主侧栏自动展开；不出现双份文件树 | **需你代核对** |
| 7 | 桌面 900px | 编辑器分栏（左右 / 上下）、标签拖拽分屏 | 与升级前一致；落点位置因少一列左移但命中正常 | **需你代核对** |
| 8 | 窄窗 390px | 切到手机壳 | “笔记”首页正常；不出现桌面侧栏；打开文件后回编辑器 | **需你代核对** |
| 9 | 768px + 触屏 | `?forceTabletOverlay` 预览浮层 | 主侧栏是抽屉；scrim 点击关闭；不出现双 scrim | **需你代核对** |
| 10 | 老数据 | 用 pre-S2 blob 启动（`outlineSide='right'`、`showFileTree=true`、`fileTreeWidth=260`） | 三栏；文件树 260；大纲仍在右；没有空 rail 残留 | **需你代核对** |
| 11 | 老数据 | 用 S2 新装 blob 启动（`outline` 在左、`active.left='outline'`） | Files 占左；大纲一次性移到右；不会每次启动重复移动 | **需你代核对** |
| 12 | 老数据 | `showFileTree=false` 的 blob | 首启主侧栏收起（只剩 rail）；文件树不被强制打开 | **需你代核对** |

---

## 7. 推测 / 未核实项（不要当作结论）

1. **macOS 的 52px inset**：`Sidebar.vue` 在 macOS 用 `sb--inset` 放红绿灯，嵌进 Dock body 后是否会与 Dock 自己的标签头形成“双 52px 头”，本次没有 macOS 真机/截图，属推断。
2. **`FileTree` 嵌入后滚动宿主**：`scrollHost()` 会向上找第一个 `overflow-y` 元素（[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L1306-L1312)），但 `dock-main` / `rs-pane-host` 的完整溢出样式没有逐条读完，能否正确接管滚动属推断。
3. **`sidebar-dock.test.ts` 的既有断言**：只确认了文件存在，没有逐条读断言；把 outline 换侧或新增 `files` 会影响多少条属推断。
4. **`showFileTree` 的写入点数量**：基于 Grep 的结果（约 10 余处），模板/动态调用可能还有遗漏。
5. **次侧栏同时容纳 Outline + Agent 的实际体验**：S2 标签能力支持，但“大纲与 AI 共用一条次侧栏”是否好用没有真机验证。
6. **P1 / P3 的人群比例**：默认 `outlineSide='right'` 只是代码事实，不能证明多数用户停在该值；没有遥测数据。
7. **测试基线 600**：来自 S2 交付记录，本次未复跑。

---

## 8. 本轮建议拍板的 4 项

| # | 决策 | 推荐 | 理由 |
|---|---|---|---|
| V1-D1 | 大纲同屏方案选 A / B / C？ | **A（大纲默认次侧栏）+ 保留 C 能力** | 见 §3.3；改动最小、最贴 V2、对多数老用户无感 |
| V1-D2 | 主侧栏最小宽度 240 还是 212？ | **212** | 保住老的 180 内容最小宽，避免升级后凭空变宽 28px |
| V1-D3 | `⌘⇧E` 是否现在对齐 VSCode？ | **不对齐** | 已被 `file.openExternal` 占用，改键成本另算；D10 也不要求 |
| V1-D4 | `files` 是否进 Panels 菜单 / rail 的 `+` 清单？ | **不进** | 它是容器，不是可勾选面板；否则出现“面板全关但侧栏仍在”的歧义 |

---

## 9. 代码证据索引

- 外壳顺序与四栏：[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2155-L2240)；`.shell` flex：[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2472-L2477)
- 文件树列的条件渲染：[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2182-L2190)
- `Sidebar.vue` 宽度 / 拖柄 / 内容结构：[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L193-L235)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L258-L465)、[Sidebar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Sidebar.vue#L469-L484)
- Dock 单 active / rail / 宽度 / 拖拽：[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L60-L140)、[SidebarDock.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L143-L214)
- Dock 状态与默认值：[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L16-L73)、sanitize 补面板：[sidebar-dock.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L96-L143)
- 面板注册表（12 项 / calendar 预留 / defaultSide）：[sidebar-panes.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/panes/sidebar-panes.ts#L23-L210)
- 设置默认值与迁移：[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L676-L695)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L766-L767)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L877-L878)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L993-L996)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1040-L1063)
- 设置动作：[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1282-L1287)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1304-L1307)、[settings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1566-L1572)
- 编辑器分栏持久化：[tiles.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/tiles.ts#L5-L14)
- 快捷键：[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L153-L154)、[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L190-L194)、[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L253-L255)、[keybindings.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L549-L552)
- 菜单：[app-menu.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.ts#L403-L424)；勾选态：[useAppMenu.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useAppMenu.ts#L49-L62)
- 工具栏 / 标题栏：[Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L109-L120)、[Toolbar.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L874-L903)
- 窄屏 / 平板：[useViewport.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useViewport.ts#L29-L35)、[useViewport.ts](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useViewport.ts#L92-L99)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2034-L2049)、[App.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2535-L2612)
- 文件树嵌入：[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L78-L78)、[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L1306-L1312)、[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L1853-L1859)、[FileTree.vue](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/FileTree.vue#L2569-L2585)
