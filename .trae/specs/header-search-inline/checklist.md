- [x] 标题行（Windows titlebar）不再显示「文档名 — SoloMD」，改为可输入的搜索框
- [x] 非 Windows header 的左段用同一搜索框，且位置在面板 toggle 与 80px mac inset 之后
- [x] header 搜索图标、桌面左侧 dock 的「搜索」行、dock 的 `search` 面板均已移除，只剩一个可见入口
- [x] ⌘⇧F / View › Search in Folder / 命令面板搜索命令都聚焦同一个搜索框，没有第二套面板开关
- [x] `applyWindowTitle` 未被删除或降级：`document.title` 与非 macOS `setTitle` 仍随活动文档更新
- [x] 搜索框及下拉均在 drag region 之外 / 带 `data-no-drag`，聚焦时不拖窗，失焦后恢复
- [x] ↑↓ 选择、Enter 打开、Esc 两段式收起语义实现，且有注释说明 ⌘⇧F 的唯一映射
- [x] 空输入 / 无文件夹 / 搜索中 / 无结果 / 命中数 均有可见反馈；过期结果被序号丢弃
- [x] 下拉 Teleport 到 body、层级高于编辑器与侧栏、不被裁剪；窄屏与手机不渲染搜索框（手机走原搜索屏）
- [x] 新增 `header.searchLabel`、`header.searchClear` 在 15 个语言文件中齐全
- [x] `sidebar-dock.test.ts` 按新事实更新且未删除用例；新增 `header-search.test.ts`
- [x] `pnpm test` 全绿并报告真实数字；`pnpm build`（vue-tsc + vite）通过
- [x] 单独 commit，未 push、未改版本号、未改 git 历史

> 归档注记：本文件为 2026-11-09 Trae 阶段的历史验收清单。2026-11-11 复测基线：978 tests / 978 pass / 0 fail、`pnpm build` 通过；对应实现提交 `e49e2121`。
