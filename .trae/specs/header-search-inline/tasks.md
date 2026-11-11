# Tasks

- [x] Task 1: 新增 `app/src/lib/header-search.ts` 与单测
  - [x] SubTask 1.1: 导出响应式 `headerSearch = { prefill: string, focusSeq: number }` 与 `requestHeaderSearch(term?: string)`；纯函数 `flattenHits(grouped)`、`moveSelection(idx, delta, len)` 便于 Node 单测
  - [x] SubTask 1.2: `app/src/lib/header-search.test.ts` 覆盖选择钳制、扁平化、prefill 触发序号递增

- [x] Task 2: 新增 `app/src/components/HeaderSearchBox.vue`
  - [x] SubTask 2.1: 输入框 + 220ms 防抖 + 递增序号丢弃过期结果，复用 `useGlobalSearch()`
  - [x] SubTask 2.2: 下拉 `Teleport to body` + `position: fixed` 锚定 + resize/scroll 重算 + 高层级 z-index
  - [x] SubTask 2.3: 键盘 ↑↓ / Enter / Esc（两段式）/ IME guard；⌘⇧F 聚焦由外部调用 focus + select
  - [x] SubTask 2.4: 状态文案（无文件夹 / 空输入 / 搜索中 / 无结果 / 命中数）；`data-no-drag`；`aria-label`、`role="combobox"`/`listbox`、`aria-activedescendant`
  - [x] SubTask 2.5: 打开命中走 `files.openPath` + `solomd:outline-goto`（与 `GlobalSearch.vue` 一致），不重写搜索实现

- [x] Task 3: `Toolbar.vue` 接入并删除旧入口
  - [x] SubTask 3.1: titlebar 变体用 `HeaderSearchBox` 替换 `titlebar__title`，删除 `.titlebar__title` 样式；保留 BrandMark/menubar/win-controls 结构
  - [x] SubTask 3.2: header 变体左段用 `HeaderSearchBox` 替换 `toolbar__panel-name` 与 `leftPanelTitle`（删除该 computed），保持 toggle 在 80px 之后
  - [x] SubTask 3.3: 删除右段搜索图标按钮与 `open-search` emit；`isNarrow` 时不渲染搜索框
  - [x] SubTask 3.4: 补 CSS（`flex: 0 1 320px` / titlebar 居中上限 420px / `data-no-drag`）

- [x] Task 4: 收敛旧搜索入口（注册表 / App / Sidebar）
  - [x] SubTask 4.1: `panes/sidebar-panes.ts` 删除 `search` 定义与联合类型成员（保留 `rsPane.search` i18n 键不动）
  - [x] SubTask 4.2: `SidebarPaneBody.vue` 删除 `search` 分支与 `GlobalSearch` import
  - [x] SubTask 4.3: `Sidebar.vue` 对 `embedded` 隐藏 `sb__search-wrap`（`variant="phone"` 保留），`switcherChord` 随之仅在 phone 使用
  - [x] SubTask 4.4: `App.vue` 删除 `searchOpen`/`searchPrefill`/`toggleGlobalSearch`/`openGlobalSearchPane`/`onPaneClose` 的 search 分支/右键菜单 search 行；`onFilterTag` 改为 `requestHeaderSearch('#'+tag)`；手机 overlay 的 `GlobalSearch` 保持
  - [x] SubTask 4.5: 复用现有 `solomd:open-global-search` 事件（命令/菜单）聚焦搜索框；新增监听 `solomd:open-rag-search`

- [x] Task 5: 快捷键与命令面板对齐
  - [x] SubTask 5.1: `useShortcuts.ts` 的 `search.global` 一律走 `hooks.openGlobalSearch`（hook 改为聚焦搜索框），注释写明“聚焦框，不开右栏面板；RAG 走独立命令”
  - [x] SubTask 5.2: `useCommands.ts` 的 `search.global` 继续派发 `solomd:open-global-search`（App 已把它接到搜索框）；新增 `search.semantic` 派发 `solomd:open-rag-search`
  - [x] SubTask 5.3: `app-menu.ts` 的 `search.global` 条目保持不变（命令仍在），确认 `app-menu.test.ts` 断言无需删除

- [x] Task 6: 窗口标题路径确认
  - [x] SubTask 6.1: 不改 `applyWindowTitle` 逻辑；仅更新过时注释（macOS 段“toolbar 显示文档名”）
  - [x] SubTask 6.2: grep 确认 `titlebar__title` / `activeTabDisplayTitle` 无残留读取

- [x] Task 7: i18n 补齐 15 个语言
  - [x] SubTask 7.1: `header.searchLabel`、`header.searchClear` 在 en/zh/ja/ko/de/fr/es/pt/it/pl/nl/tr/sv/uk/ru 全部补齐
  - [x] SubTask 7.2: 复用 `search.placeholder` / `search.typeToSearch` / `search.noMatches` / `search.hitCount` / `search.keyHint` / `search.openFolder`

- [x] Task 8: 测试更新
  - [x] SubTask 8.1: `sidebar-dock.test.ts` 按“search 已移除”更新期望（迁移数量、右栏 pane 集合），不删用例
  - [x] SubTask 8.2: 新增 `header-search.test.ts`；locale 断言补两个新键

- [x] Task 9: 验证与提交
  - [x] SubTask 9.1: `pnpm test`（真实数字，要求全绿）
  - [x] SubTask 9.2: `pnpm build`（vue-tsc + vite）
  - [x] SubTask 9.3: 单独 commit（不 push、不改版本号）

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 4 可与 Task 1–3 并行（不同文件）
- Task 5 依赖 Task 4（移除 search 面板后 hook 才能改语义）
- Task 6、Task 7 可与 Task 1–5 并行
- Task 8 依赖 Task 3、Task 4、Task 7
- Task 9 依赖全部
