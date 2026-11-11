# 第一段任务清单（批准后执行）

- [x] T1 `lib/sidebar-dock.ts` 重写为 `groups` 模型
  - 导出 `SidebarDockGroup`、新 `SidebarDockState`、`LEGACY_RAIL_WIDTH`、`paneGroup`、`resolveGroupActive`、`moveDockTab`
  - `sanitizeSidebarDock` / `migrateSidebarDock` 同时接受旧 `panes[]` 与 legacy 开关；幂等
  - `files` 固定 `left[0][0]`、`visible=true`
  - 代码注释写明 D1/D2 结论（零宽收起、`+` 落点、无右键入口、`v512` 标记）
- [x] T2 `lib/dock-drag.ts` 新增跨组件拖拽状态
- [x] T3 `stores/settings.ts`
  - `v512DockGroupsMigrated` 字段 + 默认值 + `load()` 写入
  - dock 动作迁移到 groups；新增 `moveDockTab`
  - `syncPrimarySidebar` → `syncLegacySwitches`（`showFileTree` + `outlineSide`）
- [x] T4 `components/sidebar/SidebarDock.vue` 重写
  - 删 rail / 折叠按钮 / `contextmenu`；图标标签条 + 末尾 `+`
  - pointer 拖拽：6px 阈值、命中 `[data-dock-region]`/`[data-dock-tab]`、插入边线、跨侧高亮、click 抑制
  - 每标签 `title` + `aria-label`，`role=tab`/`aria-selected`
- [x] T5 `App.vue`
  - `dockGroupsFor` / `leftDockGroups` / `rightDockGroups`
  - 两处 `SidebarDock` 传 groups，收起时 `v-if` 卸载
  - 删除 `@contextmenu`；`onPaneClose`、`rightSidebarHasRenderablePane` 适配
  - 删除 tablet overlay 的 collapsed 32px 分支
- [x] T6 `Toolbar.vue` 左段：常驻侧栏切换按钮 + 展开时保留 `leftPanelTitle`（不删既有标题样式）
- [x] T7 `lib/sidebar-dock.test.ts` 更新断言 + 新增 groups / moveDockTab / 旧形状升级用例
- [x] T8 运行 `pnpm test`、`pnpm build`，记录真实数字
- [x] T9 提交第一段（单 commit，说明去掉 rail + 图标标签 + 拖拽；不 push、不改版本号）
- [x] T10 汇报：一屏文字示意、被移除入口的新位置、老用户升级变化、人工目视核对清单（标注实测/推断）

## 人工目视核对清单（本环境无法验证）

1. 两侧 32px 活动栏确实消失，面板从窗口边缘直接开始。
2. 标签条纯图标，hover 有 tooltip，Tab 聚焦时读屏能读出面板名。
3. 同侧拖动有插入边线；跨侧拖动时目标侧整条高亮，落下后标签出现在目标侧。
4. `files` 标签拖不动，左侧插入位置永远在它右边。
5. 收起左/右栏后宽度为 0，header 对应按钮可重新打开；`⌘B`/`⌥⌘B` 生效。
6. `+` 在标签条最右端，点开的面板清单勾选态与实际一致。
7. macOS 交通灯不被 header 左段按钮压住（`MAC_TRAFFIC_INSET` 仍生效）。
8. 平板抽屉、窄屏（无左栏）、Agent 自动加宽 472 的行为无回归。

---

## T10 交付报告（2026-11-11 补）

### 结构示意（代码推断，未目视）

```
[顶行 44/52px：左 toggle │ 编辑器标签 / 模式 / ⋯ │ 搜索 │ 导出 │ 右 toggle]
[左列 aside：32px 图标标签条 + 面板正文] │ [中列：编辑器] │ [右列 aside：图标标签条 + 正文]
```

### 被移除入口的新位置

- 两侧 32px 活动栏（rail）删除；收起/展开改由顶行左右两个 toggle（同一 `sidebarDock.collapsed` 状态源）、`⌘B` / `⌥⌘B`、View 菜单、命令面板承担。
- 侧栏级右键菜单删除；面板清单入口收敛到标签条末尾 `+`；关闭/折叠由面板右键菜单承担。
- 折叠态 32px 把手删除；收起为零宽，组件由 `App.vue` 直接 `v-if` 卸载。

### 老用户升级变化

- `migrateSidebarDock` 按形状升级：旧 `panes[]` → 每侧一个 group；legacy 开关走旧逻辑后再转 group；幂等，`v512DockGroupsMigrated` 仅作记录。
- 宽度值域不变（292 / 212 / 560），旧宽度含 32px rail，迁移时 `+32` 保持视觉宽度；`LEGACY_RAIL_WIDTH` 只用于迁移。
- `files` 固定 `left[0][0]` 且不可拖动；`visible` 改为独立映射；设置里的「大纲位置」由 `syncLegacySwitches()` 反向同步。

### 验证（实测）

- `pnpm install --frozen-lockfile --node-linker=hoisted --package-import-method=copy`：成功（本机 isolated 模式的 junction 失效，见 P0）。
- `pnpm test`：978 / 978 pass / 0 fail；`pnpm build`：29.94s 成功。
- `cargo test --lib -j 1`：259 passed；`cargo test --bin SoloMD -j 1`：267 passed。

### 人工目视核对清单（推断，未实测）

上列 8 项均为代码推断，需在真机 GUI 逐项核对；P2 转成回归脚本或可执行人工清单。
