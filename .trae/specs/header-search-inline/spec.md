# 顶部标题行内联搜索 Spec

## Why

Windows 的 44px 标题行现在显示「文档名 — SoloMD」，而编辑器标签页已经能识别当前文档，这段文字是纯冗余。把这一行改成可直接输入的搜索框，并把散落的全局搜索入口收敛到一处，能让「最顶部」同时承担窗口拖动与全文检索，减少三个并存入口。

## What Changes

- Windows：`titlebar__title`（`<span aria-hidden>`，内容为「文档名 — SoloMD」）替换为内联搜索框；文档名显示消失。
- 其他桌面平台（macOS / Linux）：header 左段原来的「面板名 caption」替换为同一个搜索框，位置在顶部行已有的两个面板 toggle 之后（macOS 的 80px 交通灯 inset 已由 `.toolbar` 的 `padding-left` 保证）。
- 删除 header 右侧的搜索图标按钮；删除左侧 dock 内嵌 `Sidebar` 的「搜索」行（仅桌面 embedded；手机 `variant="phone"` 保留）；从 pane 注册表删除 `search` 面板（旧持久化数据由 `sanitizeSidebarDock` 自动丢弃未知 id）。
- 搜索源不重写：复用 `useGlobalSearch().search()` 与 `GlobalSearch.vue` 的打开命中行为（`files.openPath` + `solomd:outline-goto`）。
- **BREAKING（视觉）**：文档名不再显示在窗口内；`search` 面板从 dock 的 `+` 列表与右键菜单消失。
- 新增共享入口状态 `app/src/lib/header-search.ts`（响应式 prefill + focus 请求），供 TagsPanel 的 `#tag` 预填与命令/快捷键调用。
- 新增 i18n 键（15 个语言）：`header.searchLabel`、`header.searchClear`；其余文案复用现有 `search.*`。
- **不改变**：`applyWindowTitle`（`document.title` + 非 macOS 的 `setTitle`）保持原样，系统窗口标题仍随活动文档更新；只删可见文本。

## Impact

- 受影响能力：全局搜索入口、顶部标题行、dock 面板注册表、iPhone/手机搜索屏、命令面板与 View 菜单的搜索命令。
- 受影响代码：`app/src/components/HeaderSearchBox.vue`（新）、`app/src/lib/header-search.ts`（新）、`Toolbar.vue`、`App.vue`、`Sidebar.vue`、`SidebarPaneBody.vue`、`panes/sidebar-panes.ts`、`lib/sidebar-dock.ts`（仅测试/迁移断言）、`composables/useShortcuts.ts`、`composables/useCommands.ts`、15 个 `i18n/*.ts`、`lib/sidebar-dock.test.ts`、`lib/header-search.test.ts`（新）。

## 关键决策（必须写进代码注释）

### D1 入口落点

- 收起/展开：顶部行左右各一个 toggle（已完成于第一段），不新增。
- `+`：留在标签条末尾（已完成），不新增。
- 搜索：**唯一可见入口是标题行搜索框**。header 搜索图标删除；左侧 dock 的「搜索」行（桌面 embedded）删除；dock 的 `search` pane 从注册表删除。⌘⇧F、View › Search in Folder、命令面板 `search.global` 全部映射到「聚焦搜索框」，只有 `header-search.ts` 一个状态源，不出现第二套面板开关。
- 语义检索（RAG）：⌘⇧F 不再分支到 RAG 弹窗；新增命令 `search.semantic` 派发 `solomd:open-rag-search`，App 监听后打开现有 `RagSearch`。⌘⇧F 的注释写明“聚焦框，不开右栏面板”。

### D2 窗口标题与可见文本是两回事

- `App.vue` 的 `applyWindowTitle` 继续写 `document.title`，非 macOS 继续 `getCurrentWindow().setTitle()`；任务栏悬停 / Alt-Tab 仍读它。
- 只删除 `Toolbar.vue` 里 `titlebar__title` 的可见 span；同时更新 `applyWindowTitle` 上方“macOS 在应用内 toolbar 显示文档名”的过时注释。

### D3 拖拽区

- 搜索框外层容器带 `data-no-drag`；`onTitleBarMouseDown` 的交互目标选择器已包含 `input`，双保险。
- 聚焦时窗口不拖动；失焦/关闭下拉后拖拽恢复（不改变 capture 逻辑）。

### D4 键盘语义

- ↑ / ↓：在扁平命中列表内移动选中项（钳制，不循环）；无结果时不动。
- Enter：打开当前选中命中（`files.openPath` + 下一 tick 派发 `solomd:outline-goto`）。
- Esc：第一下收起下拉（保留输入文本、保留焦点）；第二下清空输入并失焦，焦点还原给编辑器（`focusActiveEditorSoon()` 或等价现有 helper）。
- IME：`isComposing || keyCode === 229` 时直接返回（与 QuickSwitcher / CommandPalette 一致）。
- ⌘⇧F：聚焦并全选输入框内容（不打开右栏、不打开面板）。

### D5 下拉层级与裁剪

- 结果下拉 `Teleport to body`，`position: fixed`，锚定在输入框正下方，`z-index` 使用与 `.dropdown__menu` 同一层（`--z-pop` 级别），高于编辑器、header 与两侧 dock，不被 `overflow:hidden` 裁剪。
- 宽度 = 输入框宽度，最小 360px；左右按视口钳制；窗口 resize / 滚动时重算。
- 窄屏（`isNarrow`，含手机）不渲染搜索框：手机保留现有全屏 `GlobalSearch` 搜索屏（`PhoneTabBar` 的搜索按钮 + `phone.view === 'search'`），桌面窄窗口沿用现有 `toolbar--narrow` 规则隐藏。

### D6 空间分配

- Windows 44px 标题行：`BrandMark(44px) | menubar | 搜索框(flex, max 420px, min 180px) | win-controls`。搜索框不挤压 menubar 与窗口按钮。
- 非 Windows header：左段 = toggle + 搜索框（`flex: 0 1 320px; min-width: 160px`），中间 `#header-tabs` 与视图切换按现有 `header-segments` 规则收缩，右侧动作区固定。
- macOS：左段整体从 80px（`MAC_TRAFFIC_INSET`）之后开始，搜索框永远在交通灯右侧。

### D7 状态反馈

- 无工作区：显示 `search.openFolder`，不请求搜索。
- 空输入（聚焦中）：显示 `search.typeToSearch`。
- 搜索中：输入框尾部 `…` 指示（与 `GlobalSearch.vue` 一致）。
- 无结果：`search.noMatches`。
- 输入被新键入打断：`doSearch` 用递增序号丢弃过期结果（只有最新一次 `search()` 的返回值生效），避免旧结果覆盖新结果。
- 命中数：下拉底部 `search.hitCount`；`isNarrow` 时不显示键盘提示。

## ADDED Requirements

### Requirement: 标题行内联搜索

系统 SHALL 在窗口最顶部一行提供唯一的内联搜索输入框，键入时动态展示文件夹内全文命中，并支持纯键盘完成「选择 → 打开 → 收起」。

#### Scenario: 键入并打开命中

- **WHEN** 用户点击标题行搜索框并输入关键词
- **THEN** 220ms 防抖后展示按文件分组的命中，↑↓ 移动选中，Enter 打开该行并定位到行号
- **AND** 整个过程窗口不发生拖动，编辑器内容不被遮挡

#### Scenario: 空/无结果/打断

- **WHEN** 输入为空、无命中，或连续键入导致前一次请求晚到
- **THEN** 分别显示提示文案/`search.noMatches`，且过期结果不会覆盖最新结果

### Requirement: 旧搜索入口收敛

系统 SHALL 只保留一个可见的全局搜索入口。

#### Scenario: 通过快捷键与菜单进入

- **WHEN** 用户按 ⌘⇧F、选择 View › Search in Folder 或命令面板里的搜索命令
- **THEN** 焦点落到标题行搜索框，右栏不出现重复的 search 面板

## REMOVED Requirements

### Requirement: `search` dock 面板

**Reason**：与标题行搜索框功能重复，且是第三套入口。
**Migration**：持久化里的 `search` id 由 `sanitizeSidebarDock` 按未知 id 丢弃；用户无需手工处理。手机搜索屏不受影响。

### Requirement: 标题行可见文档名

**Reason**：编辑器标签页已显示文档名，顶部行改为搜索框。
**Migration**：系统窗口标题（`document.title` / `setTitle`）保持不变，任务栏与 Alt-Tab 仍可区分窗口。
