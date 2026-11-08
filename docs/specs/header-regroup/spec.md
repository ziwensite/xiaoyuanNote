# 顶部 header 三段化 — 方案分析（只读，未改源码）

状态：待用户拍板。本文只做现状核实与方案对比，不含实施代码。
范围：`App.vue` 外壳 + `Toolbar.vue` + `PaneHost/PaneTabBar` + `SidebarDock`。
基线：V1（文件树并入主侧栏）已提交 `0bf37456`。

---

## 0. 结论先行

| 项 | 结论 |
| --- | --- |
| **推荐** | 先做 **V1.1 热修**（macOS 交通灯 inset 无条件生效，约 3 行 CSS）；结构改动采用**方案二**（header 就是编辑区头部，两侧栏各自置顶），三段只做**视觉分区**，不把侧栏标签 Teleport 进 header。 |
| **不推荐现在做方案三** | 左/右栏标签进 header 会把 `SidebarDock` 的 `dock-tabs`（只在 ≥2 面板时出现、位于面板主体顶部）搬走，而路线图 **V3 会把 `#header-tabs` 整个退役**、把编辑器标签移到 36px 组头。方案三是“先建再拆”，且会与 V3 直接冲突。 |
| **必须现在修的既有缺陷** | V1 之后 header 横跨整窗宽，但 macOS 只在小侧栏收起时留 80px；`showFileTree` 默认为 true ⇒ 交通灯压在 header 左端控件上。见 §3.1。 |
| **可立即确认的收益** | 搜索图标可与右栏改用同一个 `searchOpen`/`toggleGlobalSearch`（本就是同一入口），移除不损失可达性，见 §4。 |

---

## 1. 现状核实（全部有代码依据）

### 1.1 顶部有几层

| 平台 | 层数 | 依据 |
| --- | --- | --- |
| Windows（frameless，`decorations:false`） | **2 层**：44px 标题栏 + 52px header | [App.vue L2156-L2164](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2156-L2164) 先渲染 `variant="titlebar"`；[App.vue L2192-L2198](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2192-L2198) 才在 `.main-col` 渲染默认 header。高度来自 [tokens.css L53-L54](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/styles/tokens.css#L53-L54)（`--header-h: 52px`、`--win-titlebar-h: 44px`），标题栏高度在 [Toolbar.vue L1548](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1548)。 |
| macOS / Linux / iPad | **1 层**：52px header | [chrome.ts L18-L20](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/chrome.ts#L18-L20)：`winTitleBar` 仅在 Windows 桌面或预览时为 true。macOS 为 `titleBarStyle: Overlay`，交通灯浮在这条 header 上（[chrome.ts L3-L13](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/chrome.ts#L3-L13) 的注释）。 |
| 手机（`isNarrow`） | 1 层 header（导航栏形态）+ 底部 `PhoneTabBar` | 同一 `Toolbar` 组件加 `toolbar--narrow`；[App.vue L2190](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2190) 的 `PhoneTabBar`。 |

`Toolbar.vue` 一个组件三种 `variant`：`titlebar`（Windows 44px，菜单 + 窗口按钮）、默认（52px header）、`narrow`（手机导航栏）。`isTitlebar` 判断在 [Toolbar.vue L47](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L47)。

### 1.2 header 里到底有哪些控件（桌面、非窄屏、从左到右）

根节点 [Toolbar.vue L870-L882](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L870-L882)：

| 顺序 | 控件 | 依据 |
| --- | --- | --- |
| ① 侧栏按钮 `icon-btn toolbar__sidebar-btn` | **仅 `!settings.showFileTree` 时出现**（`v-else-if`） | [L890-L898](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L890-L898) |
| ② `#header-tabs` 空容器 | 编辑器标签条（单面板时由 `PaneHost` Teleport 进来） | [L900-L903](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L900-L903) |
| ③ 4 档视图模式 `seg` | 仅当前标签是 markdown 且 `!toolbarHidden` | [L905-L923](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L905-L923) |
| ④ `toolbar__actions` | 手机预览切换（仅窄屏）、**搜索**（仅非窄屏）、导出下拉、右栏开关（仅非窄屏）、More 下拉 | [L925-L1045](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L925-L1045) |

注意：**左栏面板标签不在 header**，右栏面板标签也不在 header。它们在各自 `SidebarDock` 的 `dock-main` 顶部：

- [SidebarDock.vue L194-L209](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L194-L209)：`<div v-if="showTabs" class="dock-tabs" role="tablist">`。
- [SidebarDock.vue L73](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L73)：`showTabs = renderable.length >= 2`。也就是说**只有一个面板时根本不显示标签**——组件头注释明确写了原因：[L9-L10](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L9-L10) “with one pane the tab label would just repeat the panel content”。
- 侧栏折叠后只剩 32px rail（`SIDEBAR_RAIL_WIDTH`，[sidebar-dock.ts L35](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L35)），此时没有任何标签可搬。

这条事实直接决定方案三的成本：V1 的默认左栏只有 `files` 一个面板，所以“左侧段放左栏面板标签”在默认状态下**只有一个不可切换的“文件”字样**，与现有设计取舍相反。

### 1.3 编辑器标签栏在哪、什么时候进 header

- [PaneHost.vue L25-L27](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneHost.vue#L25-L27)：`tabsInHeader = tiles.root.type === 'leaf'`。
- [PaneHost.vue L59-L65](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneHost.vue#L59-L65)：`<Teleport to="#header-tabs" :disabled="!tabsInHeader" defer>`。
- 分屏时 `Teleport` 被禁用，每个 pane 自己渲染 40px 标签条（[PaneTabBar.vue L666-L670](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L666-L670)）。

所以“编辑器标签在顶部 header”只对**单面板**成立；分屏后 header 里那一行变成纯拖拽空白。

### 1.4 “4 个显示模式”是什么

[Toolbar.vue L300-L311](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L300-L311)：

```ts
const segModes = [
  { mode: 'liveEdit', label: 'header.segLive' },
  { mode: 'edit',     label: 'header.segSource' },
  { mode: 'split',    label: 'header.segSplit' },
  { mode: 'preview',  label: 'header.segPreview' },
];
```

文案在 [zh.ts L159-L164](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/i18n/zh.ts#L159-L164)：实时 / 源码 / 分栏 / 预览。**`reading` 不在这个段控件里**，只能从 View 菜单或命令面板进入（`settings.viewMode === 'reading'` 会把整个 shell 换成 `ReadingView`，[App.vue L2150](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2150)）。

### 1.5 搜索图标与右栏搜索是不是同一个入口

**是同一个 store 动作，不是同一个 DOM 入口。**

- header 搜索按钮只 `$emit('open-search')`：[Toolbar.vue L936-L944](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L936-L944)。
- App 两处（Windows 标题栏与 header）都接到 `toggleGlobalSearch()`：[App.vue L2163](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2163)、[App.vue L2197](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2197)。
- `toggleGlobalSearch` / `openGlobalSearchPane` 都写同一个 `searchOpen` 并 `settings.focusDockPane('search')`：[App.vue L245-L272](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L245-L272)。

即：工具栏图标和右栏搜索面板是**同一状态的两个触发器**，删除图标不会留下两份互相打架的搜索状态。

### 1.6 关键尺寸常量（现状）

| 常量 | 值 | 位置 |
| --- | --- | --- |
| header 高 | 52px | [tokens.css L53](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/styles/tokens.css#L53) |
| Windows 标题栏高 | 44px | [tokens.css L54](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/styles/tokens.css#L54) |
| header 内边距 / 间距 | `padding: 0 10px 0 12px`，`gap: 6px` | [Toolbar.vue L1357-L1370](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1357-L1370) |
| `#header-tabs` 弹性 | `flex: 1 1 auto; min-width: 0` | [Toolbar.vue L1382-L1388](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1382-L1388) |
| actions | `flex-shrink: 0` | [Toolbar.vue L1389-L1394](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1389-L1394) |
| 单个 tab | `flex: 0 0 auto; max-width: 220px` | [PaneTabBar.vue L702-L714](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L702-L714) |
| header 里 tabs 的滚动 | `flex: 0 1 auto; min-width: 0; overflow-x: auto` | [PaneTabBar.vue L679-L692](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L679-L692) |
| header 里 filler 最小宽 | 24px（用于拖拽空白） | [PaneTabBar.vue L693-L700](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L693-L700) |
| 侧栏默认宽 / 最小宽 / rail | 292 / 212 / 32 | [sidebar-dock.ts L35-L39](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/sidebar-dock.ts#L35-L39) |
| 侧栏宽度上限 | `min(width, 45vw)` | [SidebarDock.vue L111-L118](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L111-L118) |

---

## 2. 三方案对比

### 2.1 方案一：编辑器相关（标签 + 4 模式）移到编辑区头部；搜索图标删掉；其余留最顶

**改后长什么样**

- 第一行 52px 变成“应用栏”：左 = 侧栏按钮（或左栏活动面板标题），中 = 空白/窗口拖拽区，右 = 导出、右栏开关、More（搜索移除）。
- 编辑区顶部新增第二个 40px 行：编辑器标签 + 4 档视图模式 +（可选）面包屑。
- 单面板时不再 Teleport，`#header-tabs` 退役——这就是路线图 V3 的内容。

**代价**

- 新增一条 40px 横向带 ⇒ 竖向可用空间少 40px；所有截图/居中布局/`limitEditorWidth` 需要复核。
- 分屏时会出现“两行标签条”（外层编辑区头 + 每个 pane 的组头），需要决定分屏下外层标签条是否隐藏。
- 拖拽命中区改变：标签从 52px 头部挪到 40px 带，拖拽/分栏手感要重新测（原有 `startDragging` 只挂在 header 与 Windows 标题栏上）。

### 2.2 方案二：直接把这一行改成编辑区头部，两个侧栏各自置顶

**改后长什么样**

- 顶部 52px = 编辑器标签（居中偏左）+ 4 模式 + 右侧动作；左侧栏的 rail 与它的面板标签条仍贴着左栏自身顶部（现状不变），右栏同理。
- 视觉上 header 明确“属于编辑区”，两侧栏各自拥有自己的头。

**代价**

- 几乎为零的结构改动：只需删掉 header 里的“侧栏按钮”位置语义（或保留在 actions 里）、把 `sidebarDock` 的 active 标题作为左侧参照即可。
- 仍然不解决“编辑器标签和应用工具栏混在一起”的根因（V3 的动机），属于**中等收益、低风险**的过渡。

### 2.3 方案三（用户倾向）：头部切三段 —— 左段左栏标签 / 中段编辑区 / 右段右栏标签

**改后长什么样**

- 52px header 变成 `grid`：左段宽度跟随左栏（rail 32 + 标签区），中段吃掉剩余宽度，右段跟随右栏。
- 左段渲染 `files` / 其它左栏面板的标签；右段渲染 `outline` / `search` / `tag` / `agent` 等右栏面板标签；中段 = 编辑器标签 + 4 模式。
- 两侧栏各自的 `dock-tabs` 不再渲染（或只保留在抽屉模式）。

**代价（逐项）**

| 代价 | 说明 / 依据 |
| --- | --- |
| 需要给 `SidebarDock` 增加 `placement="header"` 的标签 Teleport | 现有 `dock-tabs` 是 `dock-main` 内的一行（[L194-L209](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L194-L209)），要拆成 rail（留在侧栏）+ tabs（送进 header）两处，且 `showTabs` 的 ≥2 条件要在 header 侧重新定义。 |
| 折叠态无内容可放 | 折叠后只有 32px rail，左段/右段没有标签；header 三段会退化成“空-中-空”，需要额外规则。 |
| 单面板时出现“伪标签” | 默认左栏 = 1 个面板，`showTabs=false`；若 header 段强制显示，会违背 [L9-L10](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L9-L10) 的既有取舍（标签重复面板内容）。 |
| 三段宽度耦合侧栏宽度 | 侧栏宽度来自 `settings.sidebarDock.width`，且被 `min(w, 45vw)` 限制；header 需要订阅同一状态，窗口缩放时还要与 ResizeObserver 同步。 |
| 与 V3 冲突 | 路线图明确 V3 “标签从全局头部移到编辑器组头 36px；`#header-tabs` 退役”（[docs/vscode-shell-gap-analysis.md L182](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/docs/vscode-shell-gap-analysis.md#L182)）。方案三先投资 header Teleport，V3 再拆掉。 |
| 无障碍语义 | 三种不同类型的 `role="tab"`（面板切换 / 文档切换 / 视图模式 radio）挤在同一 `role="tablist"` 区域会产生歧义，需要三个独立容器 + 各自 aria-label。 |

### 2.4 三段宽度分配规则（仅方案三需要，给结论）

按“对齐侧栏”的自然规则：

```
grid-template-columns:
  clamp(rail, leftDockWidth, 45vw)     /* 左段 */
  minmax(0, 1fr)                        /* 中段 */
  clamp(rail, rightDockWidth, 45vw);    /* 右段 */
```

| 场景 | 分配 | 谁先让位 |
| --- | --- | --- |
| ≥ 1280px（默认 292 + 292） | 292 / 余量 / 292；中段 ≈ 616+ | 不挤压 |
| 1024–1280 | 侧段保持 292，中段 440–616 | 中段标签横向滚动 |
| 900–1024 | 侧段 `min(w, 45vw)`，中段开始 < 420 | 先隐藏 4 模式（收进 More），再让侧段降到 212 |
| < 900 | 不再对齐侧栏 | 三段退化为“视觉分组”，左右段不占固定宽 |
| < 600（手机） | 三段取消 | 手机导航栏（现状） |

- **最小宽**：左段/右段 `max(rail + 标签, 110px)`；中段可用最小宽度见 §3.3。
- **溢出**：左右段的标签 `overflow-x: auto` + 两端渐隐，**不压缩**；编辑器标签保持现有横向滚动 + 24px filler + `⌄` 溢出列表（[PaneTabBar.vue L526-L530](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L526-L530)）。
- **窗口变窄时让位顺序**：① 中段标签先滚动 → ② 4 模式收进 More → ③ 侧段缩到 212 → ④ 侧段变“仅图标/仅活动标签” → ⑤ 三段退化为分组。

### 2.5 视觉层级：两类标签必须能区分

现状两类标签的形态本来就不同，可以沿用：

| | 侧栏面板标签（`dock-tab`） | 编辑器标签（`tab`） |
| --- | --- | --- |
| 形状 | 纯文字按钮，无边框 | 胶囊（`border-radius` + 悬停填充） |
| 激活态 | 见 [SidebarDock.vue L310-L333](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/sidebar/SidebarDock.vue#L310-L333)（底边/背景） | 填充 + 高亮文字（[PaneTabBar.vue L702-L715](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L702-L715)） |
| 附加信息 | 无 | 未保存圆点、关闭按钮、固定📌 |

如果真做方案三，还需要补三条硬规则，否则用户分不清：

1. **分隔线**：段与段之间 1px 竖向 hairline（`var(--bd-hair)` 派生），中段左右各一条；不要靠底色区分（三层同底色时无效）。
2. **字号/字重差**：侧栏标签 12px / 500、编辑器标签保持 13px / 450 胶囊；两者不要用同一种激活样式。
3. **分组 aria**：三个独立 `role="tablist"` + aria-label（左侧面板 / 文档 / 右侧面板）；视图模式仍是 `role="radiogroup"`（[Toolbar.vue L909-L910](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L909-L910)），不要塞进 tablist。

### 2.6 手机 / 窄屏 / 平板抽屉的降级

| 模式 | 现有行为 | 三段在其中的样子 |
| --- | --- | --- |
| 手机 `<600`（`isNarrow`） | 返回 + 标题 + 预览切换 + 导出 + More；`.toolbar__tabs { display:none }`（[Toolbar.vue L1445-L1447](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1445-L1447)），底部 `PhoneTabBar` | 三段**整体不适用**；左段=返回，中段=笔记标题，右段=图标，正好是现有布局，不需要改 |
| 平板抽屉（`isTabletOverlay`） | 两个 Dock 以 overlay 浮层出现（[App.vue L2207](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2207)），不占编辑区宽度 | 侧栏不占位 ⇒ 左右段**不能按侧栏宽度对齐**；退化为“仅显示当前活动面板标题”，点击即打开对应抽屉 |
| 手机右栏抽屉 | 仅右栏可抽屉（[App.vue L2045-L2053](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2045-L2053) 注释说明手机上不做左抽屉） | 右段只保留右栏开关图标，不放标签 |

---

## 3. 三个已知风险 —— 结论

### 3.1 macOS 交通灯：**现在就有重叠，必须无条件留 inset**

事实链：

1. macOS 是 `titleBarStyle: Overlay`，交通灯浮在我们自己画的 52px header 上（[chrome.ts L3-L13](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/chrome.ts#L3-L13)）。
2. 唯一预留写在 [Toolbar.vue L1371-L1375](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1371-L1375)：

   ```css
   .toolbar--mac.toolbar--lead { padding-left: 80px; }
   ```

   而 `toolbar--lead` 的条件是 `!settings.showFileTree`（[Toolbar.vue L876](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L876)）。
3. 但 V1 之后 header 在 `.main-col` 内、横跨整窗宽，左栏在 header **下方**（[App.vue L2192-L2206](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2192-L2206)）；`showFileTree` 与左栏折叠态互为镜像（[settings.ts L1402-L1407](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/stores/settings.ts#L1402-L1407)），默认 `true`。

**结论**：

- 只要左栏是展开态（默认），macOS 的 header 只有 12px 左内边距，交通灯（约 x≈20–72）会压住左端控件。**这是 V1 引入的可见回归。**
- 修复方向：mac 下**无条件**预留，与 `showFileTree` 解耦；把 `80px` 提成常量（`lib/chrome.ts` 目前只导出三个布尔值，见 [chrome.ts L18-L20](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/chrome.ts#L18-L20)，没有几何常量）。
- 方案三的左段会**从 x=0 开始**，所以左段必须先吃掉这段 inset：`padding-left: 80px`（或左段自身 `padding-left`），否则左栏第一个标签会被压住。
- 80px 是现有经验值；精确右边界（绿灯/全屏按钮）随 macOS 版本变化，且全屏时交通灯隐藏。**需在真机量一次**（见 §7 不确定项）。

### 3.2 窗口拖拽区：**不要给新段加 `data-tauri-drag-region`，只靠现有 capture 逻辑**

现状两套机制并存：

- 显式拖拽：`@mousedown.capture="onTitleBarMouseDown"`（[Toolbar.vue L880](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L880)，Windows 标题栏也有 [L777](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L777)）→ `startDragging()`（[L109-L114](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L109-L114)）。**这是可靠路径**，注释说明 `data-tauri-drag-region` 在统一标题栏后失效（[L90-L98](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L90-L98)）。
- 排除表：`button, input, select, textarea, a, [role="tab"], [contenteditable="true"], .dropdown__menu, [data-no-drag]`（[L99-L107](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L99-L107)）。`[role="tab"]` 是因为标签是 `div`，不排除就会把点击吞成拖窗（注释里有 Windows VM 的实测记录）。
- 另一套：`PaneTabBar` 在 header placement 上加了 `data-tauri-drag-region`（[PaneTabBar.vue L480-L484](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L480-L484)）——与显式拖拽重复。

**结论与划分规则**：

1. 三段容器**不要**加 `data-tauri-drag-region`；空白段保持普通 `div`，靠 capture handler 拖窗。
2. 任何新做的“可点但非原生控件”的标签（例如用 `div` 做面板标签）必须带 `role="tab"` 或 `[data-no-drag]`，否则点不动、只会拖窗。
3. **不要**给段容器设 `pointer-events: none` 来“让空白更好拖”——会让 handler 收不到 `mousedown`，出现“拖不动”死角。
4. 拖拽死角的唯一来源是：视觉上像按钮、但既不在排除表里、也不冒泡到 `.toolbar` 的元素。三个段的实体内容都用 `<button role="tab">` 最稳妥（`button` 已在排除表）。
5. 建议顺手把 `PaneTabBar` 的 `data-tauri-drag-region` 去掉，统一到 capture handler（一行改动，但属于 V3 范围，不在本次热修里）。

### 3.3 中间段挤压：**最小可用宽度 ≈ 470px，低于该值滚动 + 收起 4 模式**

按现状实测口径（CSS 推导，非浏览器实测）：

| 组成 | 估算宽 | 依据 |
| --- | --- | --- |
| 1 个标签 | ≤ 220（实际标题短时约 100–160） | [PaneTabBar.vue L702-L708](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L702-L708) |
| 溢出 `⌄` 按钮 | ≈ 28 | [PaneTabBar.vue L526-L530](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L526-L530) |
| 4 模式 seg | ≈ 190–210（4 × 约 46–52） | [Toolbar.vue L905-L923](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L905-L923) |
| 段间分隔 + gap | ≈ 20 | `.toolbar` gap 6（[L1362](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1362)） |

**结论**：

- 中段 < **470px** 时不建议继续压缩标签；此时应：① 标签条保持 `overflow-x: auto`（现有行为，[PaneTabBar.vue L679-L691](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/PaneTabBar.vue#L679-L691)）；② 把 4 模式收进 More 菜单——**已有现成入口**：[Toolbar.vue L1058-L1067](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1058-L1067)（窄屏）与 [L1110](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L1110)（markdown）；③ 绝不把“标签最小宽度”压到 0，否则会出现只能看到半个标签的毛边。
- 中段 < **260px** 时，标签退化为“当前文档标题 + `⌄`”，与手机导航栏一致。

---

## 4. 删除工具栏搜索图标后的可达路径（全部）

| 路径 | 是否存在 | 依据 |
| --- | --- | --- |
| 快捷键 `Mod+Shift+F`（默认） | ✅ | [keybindings.ts L233](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L233) |
| Typora 预设 `Mod+Alt+F` | ✅ | [keybindings.ts L602](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/keybindings.ts#L602) |
| 菜单 `search.global`（View/编辑类菜单，显示快捷键） | ✅ | [app-menu.ts L357](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/app-menu.ts#L357) |
| 命令面板 `search.global` | ✅ | [useCommands.ts L269-L271](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/composables/useCommands.ts#L269-L271) |
| 右栏搜索面板（rail 图标 / `focusDockPane('search')`） | ✅ | [App.vue L245-L272](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L245-L272) |
| 手机全屏搜索 `GlobalSearch.vue` | ✅（仅手机） | [App.vue L2189](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2189) |
| 工具栏图标 | ❌（拟删除） | [Toolbar.vue L936-L944](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L936-L944) |

**结论**：删除不会导致功能不可达；**但会降低“可发现性”**——工具栏是唯一“无需记快捷键、无需打开右栏”的常驻可见入口。菜单里虽然有，但要展开菜单。

**建议**：如果要做分段，把搜索图标挪到**右段**（与右栏开关相邻），而不是彻底删除；或者仅在右栏已展开时隐藏它（右栏里已有搜索面板）。

---

## 5. 与路线图的关系（V2 / V3）

来自 [docs/vscode-shell-gap-analysis.md §6 L173-L185](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/docs/vscode-shell-gap-analysis.md#L173-L185)：

| 批次 | 内容 | 与本次关系 |
| --- | --- | --- |
| **V1**（已提交） | 文件树并入左 Dock、`v511FileTreeMerged` | 已完成；本次分析基于它 |
| **V2** | `layout` 对象 + 单活动栏；右 rail → 次侧栏 header | 会重写左右栏的面板模型与标签渲染 ⇒ **方案三若先做，V2 会再改一次** |
| **V3** | 编辑器标签从全局头部移到组头 36px；`#header-tabs` 退役 | 与方案一/二同向；与方案三（把侧栏标签塞进全局头）**方向相反** |
| **V4** | 拖拽 S3′ | 依赖 V2 + V3 |
| **V5** | 溢出/键盘/窄屏/清理 | 三段降级规则最终会并入 V5 |

**判断**：

- 方案三 = “全局 header 作为三栏的公共头部”，它**延长** `#header-tabs` 的寿命，而 V3 的验收标准就是把它退役。两者不能共存。
- 因此方案三不应作为 V1 之后的第一批，除非你决定**取消 V3**、把 V2+V3 合并成“统一三栏头部”——那是 3–4 人日的结构性改动，且要重做窄屏矩阵。
- 建议插入位置：
  1. **V1.1（现在，热修）**：macOS inset、陈旧注释（[App.vue L2151-L2155](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/App.vue#L2151-L2155) 仍写“sidebar runs full height beside main-col”，已与 V1 后布局不符；[chrome.ts L7-L9](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/lib/chrome.ts#L7-L9) 同理）。
  2. **方案二作为 V3 的前置视觉整理**（可选，低成本）：header 明确标为编辑区头部、两侧栏各自置顶，不改 Teleport。
  3. **方案一/三放到 V3**，与“标签归位”一起做；方案三若仍想做，排在 V2 之后、V4 之前，并接受 V3 验收标准变更。

---

## 6. 推荐方案 + 需要拍板的点

### 推荐（按优先级）

1. **P0 · V1.1 热修（与方案无关，建议无条件做）**
   - mac 下 header 无条件预留 `80px`（去掉 `toolbar--lead` 条件），抽常量到 `lib/chrome.ts`。
   - 修正 `App.vue` / `chrome.ts` 三处与 V1 后布局不符的注释。
2. **P1 · 方案二**（若你希望“顶部看起来是三段”而不动 Teleport）
   - 左段：侧栏开关 + 当前左栏活动面板标题（`rsPane.files` 等既有 key，无新文案）；`showFileTree=true` 时它只是静态标题，点击打开/聚焦左栏。
   - 中段：现有 `#header-tabs` + 4 模式，保持唯一可编辑区归属。
   - 右段：搜索 + 导出 + 右栏开关 + More。
   - 视觉：两条竖向 hairline + 侧栏标题 12px 无胶囊，与编辑器胶囊标签区分。
3. **P2 · 方案三**：仅在你决定“取消/合并 V3”时做；否则不做。

### 需要你拍板的点

| # | 决策 | 选项 | 我的建议 |
| --- | --- | --- | --- |
| D1 | 侧栏面板标签是否真的进 header | A 进（方案三）/ B 不进，只做三段视觉（方案二） | **B** |
| D2 | 编辑器标签是否离开全局 header | A 留在 header（现状）/ B 移到编辑区 40px 头（方案一，= V3） | 现在 **A**，V3 时 **B** |
| D3 | 搜索图标 | A 保留在右段 / B 彻底删除 / C 仅右栏展开时隐藏 | **A 或 C** |
| D4 | 是否接受 V1.1 热修立即插入 | 是/否 | **是**（这是回归修复，不是新功能） |
| D5 | 4 模式收进 More 的阈值 | 中段 < 470px / < 420px / 不收起 | **< 470px** |
| D6 | 侧栏折叠时左/右段显示什么 | 仅图标 / 仅 rail 宽占位 / 中段吃掉宽度 | **中段吃掉宽度**（折叠 = 不给头部留空） |

---

## 7. 不确定项（需要实测，不要当成结论）

1. **macOS 交通灯精确右边界**：80px 是现有代码的经验值；不同 macOS 版本/全屏状态下按钮位置有差异。做方案三前必须在真机量一次（建议在 52px header 上截图并量像素）。
2. **4 模式 `seg` 的实际像素宽**：190–210px 是由 padding/字号推导，未在浏览器实测；建议用 devtools 量一次再定断点。
3. **侧栏 `45vw` 上限与 header 对齐的一致性**：`SidebarDock` 用的是 `min(w, 45vw)` 内联样式，header 若用 `grid` 复制同一算式，两者在不同 DPI/缩放下的取整可能差 1px，会出现错位 1px 的竖线。
4. **分屏下的方案三**：`tiles.root.type !== 'leaf'` 时中段是空拖拽区，左/右段的标签仍在——是否要改成“分屏时三段全部退化为 pane 头”，未在代码里找到既有约定。
5. **`data-tauri-drag-region` 的实际行为**：代码注释（[L90-L98](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L90-L98)）说它在 macOS 不可靠，但部署端的 Tauri 版本是否有变化，未验证。
6. **`toolbarHidden`（`toolbar--minimal`）语义**：`settings.toolbarHidden` 会把 seg 和 actions 全部隐藏（[L877](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L877)、[L906](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L906)、[L925](file:///f:/我的资料库/T----同步盘/T----test/xiaoyuanNote/app/src/components/Toolbar.vue#L925)），三段化后 left/right 段是否也隐藏没有既有说明；按“隐藏工具栏”的语义应当全隐藏，但需要你确认。

---

## 8. 新增 i18n key（只列 key，未改语言文件）

若 D1 选 B（三段视觉分区），需要：

| key | 用途 | 备注 |
| --- | --- | --- |
| `header.leftPanels` | 左段 `aria-label`（“左侧面板”） | 仅无障碍文案 |
| `header.rightPanels` | 右段 `aria-label`（“右侧面板”） | 仅无障碍文案 |
| `header.editorArea` | 中段 `aria-label`（“文档标签”） | 仅无障碍文案 |
| `header.panelHint` | 左段标题可点击时的 tooltip（“打开 {name}”） | 若左段标题可点 |

可复用、**不需要新增**的既有 key：`header.showSidebar`、`header.viewModes`、`header.segLive/segSource/segSplit/segPreview`、`header.more`、`sidebarDock.collapse/expand`、`rsPane.*`、`toolbar.searchTooltip`、`toolbar.rightSidebarTooltip`。

若 D1 选 A（方案三），除上表外还需 `header.leftPanelTabs` / `header.rightPanelTabs`（两组 tablist 的 aria-label）。

---

## 9. 验收 / 校验（方案二落地时）

- `pnpm test`、`pnpm build`（含 `vue-tsc`）。
- 手工矩阵：Windows（44+52 两层）/ macOS（交通灯不压控件）/ iPad 抽屉 / 390px 手机；单面板与分屏；标签 1 / 3 / 8 个；`toolbarHidden` 开与关。
- 拖拽校验：点每个标签能切换、空白处能拖窗、双击最大化；mac 全屏进出不重叠。
- 断言“搜索”至少 3 条路径可用（快捷键、菜单、右栏面板）。
