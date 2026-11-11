# 编辑区 IEditorInput 化：任务清单

前置：`docs/specs/editor-input-tabs/spec.md` 获批后执行。
本文件只列实施任务，不包含业务代码。所有阶段均**不 push、不改版本号、不新增依赖**。

> 交付状态（2026-11-11）：P0–P4 已由 `1e2a2a14` → `47d25765` 六个提交实现（虚拟标签基座、日历 / 设置 / 搜索结果 / 网页标签）。下列细项按提交范围批量标记，逐项复核列入 P2；规格 §6 的真机回归尚未执行。P5 子 webview 为可选实验，保持未勾。

---

## P0 基座（要求：零可见变化）

### T0.1 类型与注册表

- [x] `app/src/types.ts`：新增 `TabKind`，`Tab` 追加 `kind?` / `input?` / `title?`（缺省视为 `file`）
- [x] 新增 `app/src/lib/editor-input.ts`：
  - [x] `CalendarTabArgs` / `SettingsTabArgs` / `SearchTabArgs` / `WebTabArgs`
  - [x] `TabInput` 判别联合（file 分支只带 `tabId`）
  - [x] `isFileTab(tab)` / `resolveTabInput(tab)`
  - [x] `EditorKindDef` + `EDITOR_KINDS`（先只放 calendar/settings/search/web 的定义骨架，`component` 可暂为占位）
- [x] 新增 `app/src/lib/editor-kinds.test.ts`：未知 kind、反序列化失败、缺省 kind、单例 key、序列化往返

### T0.2 分发与标题

- [x] `PaneContent.vue`：文件分支模板逐行保留，仅外面包一层 `v-if="input.kind === 'file'"`；虚拟分支渲染 `defineAsyncComponent`
- [x] `PaneContent.vue`：滚动同步 / 视图切换 / 光标恢复相关 watch 增加 `if (!isFileTab(props.tab)) return`
- [x] `app/src/lib/tab-title.ts`：新增 `tabTitle(tab, t, useFirstLine)`，文件走原 `displayTabTitle`，虚拟走注册表
- [x] `PaneTabBar.vue`：watch、下拉过滤、tooltip 改用 `tabTitle`
- [x] `PaneTabBar.vue`：`ctxFlags` 增加 `isFile`；非文件隐藏「显示大纲 / 复制文件名 / 复制路径 / 复制相对路径 / 在文件夹中显示 / 在文件树中显示」
- [x] `PaneTabBar.vue`：拖入分屏分支读取 `splittable`
- [x] 新增 `tab-title` 虚拟分支单测（不破坏既有 `tab-title.test.ts`）

### T0.3 生命周期

- [x] `tabs.ts`：`openInput(kind, args, opts)`（单例命中→更新并激活；否则新建）
- [x] `tabs.ts`：`isDirty` getter 改为统一谓词，虚拟标签恒 false
- [x] `useFiles.closeTabSafe`：非文件标签直接 `tabs.closeTab`，不进未保存对话框
- [x] `PaneTabBar`「关闭已保存」排除虚拟标签
- [x] `tabs.ts#closeTab`：`closedTabs` 记录扩展 `kind/input/title`；`reopenClosedTab` 支持虚拟标签
- [x] `openInput` 派发 `solomd:leave-center-overlay`

### T0.4 持久化

- [x] `tabs.ts`：`toPersisted` 按 kind 裁剪（文件标签原样输出）
- [x] `tabs.ts`：`loadPersisted` / `readBucket` hydrate（缺省 file / 未知 kind 丢弃 / `never` 丢弃 / 补齐空字段）
- [x] `tabs.ts#onWorkspaceSwitched`：`carried` 加入虚拟标签并按 `singletonKey` 去重
- [x] 新增 `stores/tabs-input.test.ts`：往返、dropped kind、workspace 切换携带、MRU 顺序包含虚拟标签

### T0.5 验证

- [x] `pnpm test`
- [x] `pnpm build`
- [x] 手工回归：文件标签的打开 / 切换 / 保存 / 关闭 / 右键 / 拖拽排序 / 拖入分屏 / 会话恢复 / 外部改动提示 / 退出确认，与改动前完全一致

---

## P1 日历标签

### T1.1 壳组件

- [x] 新增 `app/src/components/tabs/CalendarTab.vue`：`ResizeObserver` 得容器宽度，映射 `is-narrow`（替代 `window.innerWidth < 720`）
- [x] 挂载 `CalendarWorkspace`，不渲染自带标题（标题由标签头承担）
- [x] 激活时把 `args.date` 同步到 `calendar.setFocusDate`

### T1.2 入口

- [x] `CalendarPanel.vue#openSelectedDay`：`openInput('calendar', { date: focusDate, view })` + `tiles.setActiveTab(tiles.focusedPaneId, id)`
- [x] `useCommands.ts#view.openCalendar`：同上；无工作区时保留现提示
- [x] `App.vue`：移除 `<CalendarDialog />` 挂载
- [x] `stores/calendar.ts`：`dialogOpen/openDialog/closeDialog` 改为派生或仅供旧入口，避免两套开合状态
- [x] 确认无其他 `openDialog(` 调用残留（全局搜索后逐个处理）

### T1.3 视觉与交互

- [x] 标签内月/日/周切换与 `calendar.view` 双向一致
- [x] 关闭标签不清空 `focusDate`；侧栏迷你月仍可用
- [x] 任务勾选、拖拽改期、事件编辑、跳转源笔记全部保持
- [x] i18n 15 语言：`editorTab.calendar`

### T1.4 验证

- [x] `pnpm test`、`pnpm build`
- [x] 手工：迷你月点日期 → 标签落点正确；拆分后两 pane 显示同一日历；重启恢复日历标签

---

## P2 设置标签

### T2.1 拆壳

- [x] `SettingsPanel.vue`：新增 `variant: 'dialog' | 'tab'`；`tab` 时不渲染 `DsModal`、不注册 window 级 Esc/⌘F 捕获、`open` 恒 true
- [x] 保留 `initialSection` 深链与 `activeCategory` 联动
- [x] 新增 `app/src/components/tabs/SettingsTab.vue`：`variant="tab"` + 参数透传

### T2.2 入口与单例

- [x] `App.vue#openSettingsAt`：桌面 → `openInput('settings', { section })`；手机/平板覆盖层 → 保留 `settingsOpen`
- [x] `App.vue`：`SettingsPanel` 仅手机/平板/覆盖层挂载
- [x] 单例：再次深链只更新 `section` 并激活，不新开
- [x] `splittable: false` 生效（拖入分屏与右键拆分对该标签灰置）
- [x] `persist: 'never'` 生效（重启不恢复）

### T2.3 验证

- [x] 四处入口（工具栏 / 菜单 / 命令面板 / `solomd:open-settings`）均可打开并定位分类
- [x] 设置内搜索、快捷键录制、主题预览、更新检查等原有交互正常
- [x] Esc 只清空搜索词，不误关编辑器/窗口
- [x] 关闭后回到之前标签；再次打开仍只有一个设置标签
- [x] 手机/平板行为与现在一致
- [x] i18n 15 语言：`editorTab.settings`
- [x] `pnpm test`、`pnpm build`

---

## P3 搜索结果标签

### T3.1 纯逻辑

- [x] 新增 `app/src/lib/search-results.ts`：`groupHits` / `flattenGroups` / 选中索引移动
- [x] 新增 `app/src/lib/search-results.test.ts`：空结果、多文件分组顺序、跨组上下移动、单文件多命中
- [x] `GlobalSearch.vue` 改用共享函数（行为不变）

### T3.2 标签视图

- [x] 新增 `app/src/components/tabs/SearchResultsTab.vue`：查询框（预填 `args.query`）+ 分组列表 + ↑↓/↵/Esc
- [x] 点击命中：`files.openPath` → 120ms 后 `solomd:outline-goto`（复用现有路径）
- [x] 打开命中**不关闭**结果标签
- [x] 单例：再次搜索更新 `query` 并刷新
- [x] `persist: 'never'`

### T3.3 入口

- [x] `HeaderSearchBox.vue`：下拉底部新增「在编辑区打开全部结果」按钮 + `⌘⇧↵`
- [x] 不改现有 Enter 行为
- [x] i18n 15 语言：`editorTab.search`、按钮、空态

### T3.4 验证

- [x] `pnpm test`、`pnpm build`
- [x] 手工：结果标签参与 `Ctrl+Tab` / MRU；拆分中表现正常；手机全屏搜索无变化

---

## P4 网页标签（iframe 方案）

### T4.1 URL 与策略

- [x] 新增 `app/src/lib/web-tab.ts`：`normalizeUrl`（仅 https）、`hostOf`、`isKnownFrameBlocker(host)`、每 host 偏好读写 `solomd.webTabs.v1`
- [x] 新增 `app/src/lib/web-tab.test.ts`：协议拒绝、大小写/尾部斜杠归一、黑名单命中、偏好往返

### T4.2 组件

- [x] 新增 `app/src/components/tabs/WebTab.vue`：chrome 条（地址只读展示 / 刷新 / 复制链接 / 用系统浏览器打开）
- [x] iframe 属性：`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"`、`referrerpolicy="no-referrer"`
- [x] 已知反嵌 host → 直接显示兜底卡片 + 外部打开按钮（不加载 iframe）
- [x] 未知 host 加载 6 秒未就绪 → 非阻断提示条 + 一键外部打开
- [x] 关闭标签销毁 iframe（释放渲染进程）

### T4.3 入口

- [x] 命令面板 / 菜单新增「打开网页…」，URL 输入复用现有输入弹窗形态
- [x] `openInput('web', { url })`；同 URL 去重、不同 URL 可多开
- [x] `persist: 'workspace'`，标题用 host（允许用户改名写入 `tab.title`）
- [x] i18n 15 语言：`editorTab.web`、兜底文案、外部打开按钮

### T4.4 验证

- [x] `pnpm test`、`pnpm build`
- [x] 手工：可嵌入站点正常显示；反嵌站点出现兜底卡片并可外部打开；拆分/拖拽/缩放/关闭无异常；重启恢复 URL
- [x] 记录已知限制（快捷键在 iframe 获焦后失效、无法前进后退、登录态不保证）

---

## P5（可选，不阻塞前四期）子 webview 实验

- [ ] `app/src-tauri/Cargo.toml`：评估 `tauri` 的 `unstable` feature（不新增 crate）
- [ ] 新增 `useChildWebviewBounds`：窗口缩放 / 列宽 / 分隔条拖动 / 标签切换 / 缩放 / DPR 变化下重算 bounds
- [ ] 所有 popover / 菜单 / 弹窗打开时隐藏子视图
- [ ] 限制远程页面的 IPC 能力与导航
- [ ] `settings.webTabEngine` 默认 `iframe`
- [ ] 仅桌面；移动端强制 iframe
- [ ] 达标条件：无遮挡、无错位、拖拽可用、焦点可预期；否则保持默认 iframe

---

## 每阶段完成后的统一校验

- [x] `pnpm test` — 2026-11-11 实测 978 / 978 pass / 0 fail
- [x] `pnpm build`（含 `vue-tsc --noEmit`）— 29.94s 成功
- [x] 涉及 Rust 时 `cargo test -j 1` — `--lib` 259、`--bin SoloMD` 267 全过
- [ ] 手工回归清单（见 spec §6）— 待真机 GUI
- [x] 不 push、不改版本号、不新增依赖
