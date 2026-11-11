# 右键菜单按上下文拆分 — 规格

状态：已交付（实现提交 `e89585a0`；任务清单 10/10，2026-11-11 归档）
仓库根：`f:\我的资料库\T----同步盘\T----test\xiaoyuanNote`
前端根：`app/`

## 1. 背景与目标

现状：右键行为分散在 6 个组件里，面板类 UI（列头、工具栏动作区、标签条空白、列边界）完全没有菜单；开发构建下右键这些区域只会弹 WebView2 浏览器菜单，生产构建下被 `native-menu-guard.ts` 静默吞掉，表现为「右键毫无反应」。

目标：

1. 每个上下文只出现该上下文成立的项，**不是同一个菜单换标题**。
2. 菜单项全部挂到仓库已有命令（settings 动作 / `dispatchMenuAction` 已有 id），不新造功能。
3. 复用 `styles/menus.css` 的 `.ctx-menu` / `.ctx-item` 视觉，并保留键盘可达、Esc 关闭、点击外部关闭、屏幕边界翻转。
4. 明确保留通用菜单的区域，不留死区。

## 2. 现有右键清单（调研结果）

| # | 触发点 | 实现位置 | 当前菜单 | 现有菜单项 |
|---|--------|----------|----------|------------|
| 1 | 文件树行（文件/文件夹） | `components/FileTree.vue:1877/2147` → `openCtx` → `.ftree__ctx` | 有 | 新建文件、新建文件夹、展开/折叠子树、重命名、移动到…、删除、复制路径、复制相对路径、复制 Git URL、在文件夹中显示 |
| 2 | 文件树空白（根容器） | `FileTree.vue:1859` | 有 | 新建文件、新建文件夹（行级项按 `ctx.node` 条件隐藏） |
| 3 | 编辑器正文（CodeMirror / live blocks） | `Editor.vue:6306/6313` → `EditorContextMenu.vue` | 有 | 复制图片（图片上）、剪切、复制、粘贴、全选 + 拼写建议 / LanguageTool |
| 4 | 编辑器标签（三列外壳） | `PaneTabBar.vue:505` → `.ctx-menu` | 有 | 关闭、关闭左侧/右侧/其他/已保存/全部、固定、显示/隐藏大纲、复制文件名/路径/相对路径、在文件夹/文件树中显示、分屏、关闭窗格 |
| 5 | 编辑器标签（旧 TabBar） | `TabBar.vue:136` → `.tab-menu` | 有 | 关闭系列 + 在文件夹中显示 |
| 6 | 已保存视图行 | `ViewsPanel.vue:191` → `.vpanel__ctx` | 有 | 编辑、复制、删除 |
| 7 | 番茄钟胶囊 | `PomodoroPill.vue:81` | 有 | 开始/暂停/重置等 |
| 8 | 侧栏 `+` 按钮（**左键**） | `DockTabStrip.vue:383` → App `openSidebarCtx` → `.sidebar-ctx` | 有（点击） | 12 个面板显隐勾选 |
| 9 | 面板正文：outline / backlinks / relationships / tags / tasks / neighborhood / types / history / inspector / agent / calendar | 无监听 | **无** | — |
| 10 | 面板列头图标标签（`.dock-tab`） | 无监听 | **无** | — |
| 11 | 面板列头空白（`.side-sidebar__header`） | 无监听 | **无**（`+` 才开） | — |
| 12 | 工具栏右侧动作区图标（导出 / 左右面板开关 / ⋯） | `Toolbar.vue:1072-1129` | **无** | — |
| 13 | 编辑器标签条空白（`#header-tabs`、`.tabs__filler`） | 无监听 | **无** | — |
| 14 | 三栏边界 / 缩放把手（`.side-sidebar__resize`） | `SidebarDock.vue:143` | **无** | — |
| 15 | Windows 标题菜单行、状态栏、阅读视图、预览 | 无监听 | 通用（`native-menu-guard` 抑制） | 无 |

## 3. 上下文分类与建议菜单

### 3.1 内容自管（保留现状，不改造）

文件树、编辑器正文、编辑器标签、旧 TabBar、已保存视图、番茄钟。理由：这些菜单项依赖各自的数据（节点路径、选区、标签列表、视图 slug），已经正确分流。

### 3.2 面板正文（新增，通用面板菜单）

触发：`SidebarDock.vue` 的 `.dock-group` 上 `@contextmenu.prevent`，目标不在 `[data-own-menu]` 内；从 `[data-rs-pane]` 读出 pane id。FileTree 已在行/空白处 `stopPropagation`，因此不会误触。

菜单项（`panelMenu.*`）：

| 项 | 动作（已有） | 为什么只在这里成立 |
|----|--------------|--------------------|
| 关闭面板 | `onPaneClose(id)`（outline 走 `tabs.toggleOutline`，其余 `settings.hideDockPane`） | 关闭语义是面板的，不是文档内容的 |
| 隐藏面板 | `settings.hideDockPane(id)` | 同上；对 `files` 禁用（pinned） |
| 移到左栏 / 移到右栏 | `settings.moveDockTab(id, { side, group: 0, index: 9999 })` | 停靠槽位概念只存在于侧栏；当前侧那一项禁用 |
| 管理面板… | 打开既有 `.sidebar-ctx` 勾选菜单 | 面板清单属于外壳，不属于某一个面板的内容 |
| 折叠此栏 | `settings.setDockCollapsed(side, true)` | 只有身处某一栏内部才谈得上折叠 |

### 3.3 面板列头图标标签（新增）

触发：`DockTabStrip.vue` 每个 `.dock-tab[data-dock-tab]` 的 `@contextmenu.prevent.stop`，emit `tab-context(id, x, y)`。

菜单项：

| 项 | 动作（已有） | 为什么只在这里成立 |
|----|--------------|--------------------|
| 打开「{name}」面板 | `settings.setActiveDockPane(side, id)` | 图标代表一个面板槽位 |
| 隐藏面板 | `settings.hideDockPane(id)` | 同上 |
| 移到左栏 / 移到右栏 | `settings.moveDockTab(...)` | 同上；`files` 两项均禁用 |
| 管理面板… | 既有 `.sidebar-ctx` | 同上 |

`files`（pinned，`isMovablePane` 为 false）时：隐藏、移动全部 disabled。

### 3.4 面板列头空白（复用通用菜单）

触发：`.side-sidebar__header` 的 `@contextmenu.prevent`，目标不在 `.dock-tab` 内 → 走既有 `emit('manage', $event)`，弹出 `.sidebar-ctx` 12 个面板勾选。这是**唯一保留的通用菜单**（与 `+` 按钮同一份）。

### 3.5 工具栏动作区图标（新增，4 个各自不同）

触发：`Toolbar.vue` 的 `data-tb-ctx` 标记 + `@contextmenu.prevent.stop`。

| 图标 | 菜单项 | 依据 |
|------|--------|------|
| 左面板开关 | 显示/隐藏左栏（勾选 `view.toggleFileTree`）、显示/隐藏右栏（勾选 `view.toggleRightSidebar`） | 图标问的是“哪几栏开着” |
| 右面板开关 | 同上两项 | 同上 |
| 导出 `share` | 导出 HTML、Word、PDF（文字）、PDF（图片）、图片；分隔；复制为 Markdown（`export.html/docx/pdfPrint/pdf/image`、`export.copyMd`） | 文档级动作，只有导出入口承载 |
| `⋯` | 专注模式、打字机模式、自动换行、行号（勾选）；分隔；隐藏工具栏（`view.toggleFocusMode/toggleTypewriter/toggleWrap/toggleLineNumbers`、`view.toggleToolbar`） | 编辑器外壳的显示偏好 |

派发：`Toolbar.vue` 新增 `emit('menu-action', id)`，`App.vue` 两个 `<Toolbar>` 都加 `@menu-action="dispatchMenuAction"`。勾选态读 `settings.showFileTree`、`settings.sidebarDock.collapsed.right`、`settings.focusMode`、`settings.typewriterMode`、`settings.wordWrap`、`settings.lineNumbers`、`settings.toolbarHidden`。

### 3.6 编辑器标签条空白（新增）

触发：`Toolbar.vue` 的 `#header-tabs` 容器 `@contextmenu.prevent`，若 `$event.target.closest('.tab')` 存在则忽略（交给 `PaneTabBar`）。

菜单项：新建 Markdown（`file.new`）、打开文件（`file.open`）、打开文件夹（`file.openFolder`）；分隔；重新打开已关闭标签（`tab.reopenClosed`）。理由：指针下没有标签，标签级关闭/固定项不成立。

### 3.7 三栏边界 / 缩放把手（新增，最小集）

触发：`SidebarDock.vue` `.side-sidebar__resize` 的 `@contextmenu.prevent`，emit `edge-context(side, x, y)`。

菜单项：折叠此栏 / 展开此栏（`sidebarDock.collapse/expand`）→ `settings.setDockCollapsed(side, !collapsed)`；分隔；隐藏/显示该侧（`header.hideSidebar/showSidebar`，左栏走 `view.toggleFileTree`，右栏走 `view.toggleRightSidebar`）。理由：把手只在栏边界出现。

### 3.8 仍使用通用行为的区域

- `.side-sidebar__header` 空白 + `+` 按钮 → 既有 `.sidebar-ctx`（唯一通用菜单）。
- Windows 标题菜单行、状态栏、阅读视图、预览正文：不新增自定义菜单，保持 `native-menu-guard` 的现有策略（生产抑制浏览器菜单；dev 保留以便 Inspect）。这一条会写进实现说明，避免“右键无反应”被误判为 bug。

## 4. 实现设计

### 4.1 新文件

1. `app/src/lib/context-menus.ts`（纯函数，无 Vue/Pinia）
   - `export type CtxActionId`：联合类型，取值为上表已有动作 id（`panel.hide`、`panel.close`、`panel.moveLeft`、`panel.moveRight`、`panel.manage`、`column.collapse`、`column.expand`，以及 `view.*`、`export.*`、`file.*`、`tab.reopenClosed`）。
   - `CtxEntry { id; label; checked?; disabled? }`、`CtxSep { sep: true }`、`CtxNode`。
   - `buildPanelMenu(ctx)`、`buildDockTabMenu(ctx)`、`buildToolbarActionsMenu(kind, ctx)`、`buildTabStripMenu(ctx)`、`buildColumnEdgeMenu(ctx)`，`kind: 'left' | 'right' | 'export' | 'more'`。
   - 所有 `label` 由传入的 `t` 生成，key 只引用既有命名空间 + 新增 `panelMenu.*`。
2. `app/src/lib/context-menus.test.ts`（node:test）
   - 每个 builder 的 id 序列精确断言；不同上下文集合互不相同。
   - `files` pinned 时 hide/move disabled；当前侧移动项 disabled。
   - 勾选态随传入 state 变化。
   - 15 个语言字典逐一 `strictT` 构建，新增 `panelMenu.*` 必须齐备。
   - 断言 builder 产出的动作 id 均在 `DISPATCHABLE`（App.vue 可派发集合）内。
3. `app/src/components/ui/ContextMenu.vue`
   - props `{ x, y, items }`；emit `pick(id)`、`close`。
   - 模板 `.ctx-menu` + `.ctx-item`（`menus.css` 已覆盖视觉），`role="menu"` / `role="menuitem"`。
   - `onMounted` 测量后做左右/上下翻转（同 `EditorContextMenu`），绑定 document `mousedown`/`keydown`（Esc）、window `blur`/`resize`、document `scroll`。
   - 键盘：挂载后聚焦第一项；`ArrowUp/Down/Home/End` 移动焦点；`Enter/Space` 触发。

### 4.2 修改文件

| 文件 | 改动 |
|------|------|
| `app/src/components/sidebar/SidebarDock.vue` | emits 增加 `paneContext(id,x,y)`、`edgeContext(side,x,y)`；`.dock-group` 加 `@contextmenu.prevent`；`.side-sidebar__resize` 加 `@contextmenu.prevent`；列头空白右键转 `manage` |
| `app/src/components/sidebar/DockTabStrip.vue` | emits 增加 `tabContext(id,x,y)`；`.dock-tab` 加 `@contextmenu.prevent.stop`；`+` 按钮加 `@contextmenu.prevent` → `manage` |
| `app/src/App.vue` | 新增 `panelCtx` 状态与 3 个 open 函数；`ContextMenu` 渲染 + `onPanelCtxPick` 派发（复用 `onPaneClose`、`settings.*`、`openSidebarCtx`）；两个 `<Toolbar>` 加 `@menu-action="dispatchMenuAction"` |
| `app/src/components/Toolbar.vue` | 引入 `ContextMenu` 与 builders；`tbCtx` 状态；4 个动作图标 + `#header-tabs` 加右键；新增 `menu-action` emit |
| `app/src/i18n/{en,zh,es,de,nl,it,ko,fr,ru,ja,uk,pt,sv,pl,tr}.ts` | 各加 `panelMenu: { close, hide, open, moveToLeft, moveToRight, manage }` 六条 |
| `app/src/styles/menus.css` | 若 `.ctx-menu` 缺 `max-height`/`overflow` 则补；否则不动 |

不改 `app-menu.ts`、不改 FileTree / EditorContextMenu / PaneTabBar / ViewsPanel / PomodoroPill 的现有菜单内容。

### 4.3 交互一致性

- `contextmenu` 一律 `preventDefault`；面板菜单 `stopPropagation`，避免冒泡到列头/工具栏。
- 新菜单与既有菜单同款：`.ctx-menu` 面板、`.ctx-item` 行、`.ctx-sep` 分隔。
- 边界翻转：`ContextMenu` 内统一实现一次。

## 5. 测试与静态检查

1. `cd app && pnpm test` — 记录 pass/fail 实际数字；新增 `context-menus.test.ts` 计入。
2. `cd app && pnpm build` — 记录实际耗时与结果。
3. `app-menu.test.ts`：本方案不改 `app-menu.ts` 的树，逐条核对无需改断言；在交付说明里写明“未改，因为菜单树未动”，并说明新增断言放在 `context-menus.test.ts`。

## 6. 真实窗口验证（dev bridge）

dev 已运行，不重启。用 `%TEMP%\bridge-eval.mjs` 执行脚本，`dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX, clientY}))` 后读取：

- `.ctx-menu:not(.tablist) .ctx-item` 文本（面板正文 / 列头 / 工具栏 / 标签条空白 / 边界）
- `.editor-ctx .editor-ctx__item` 文本（编辑器正文）
- `PaneTabBar` 的 `.ctx-menu` 文本（编辑器标签）

依次断言 8 个位置，输出每处菜单项文本数组，证明互不相同；覆盖暗色主题一次。窗口 2294×912、dpr 1.5。

## 7. 验收标准

- 8 类上下文各自弹出不同集合，且均在既有动作集合内。
- 面板正文 / 列头 / 工具栏 / 标签条空白 / 边界不再出现“右键无反应”。
- 新增 6 条文案在 15 个语言文件中齐备。
- `pnpm test`、`pnpm build` 通过并给出真实数字。
- 不提交。
