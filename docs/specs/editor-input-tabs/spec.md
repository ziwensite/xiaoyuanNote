# 编辑区 IEditorInput 化：多类型标签方案

状态：**P0–P4 已交付 + P4 安全加固**（2026-11-11，虚拟标签基座 + 日历/设置/搜索结果/网页标签）；**P5 子 webview 实验已评估并否决，网页标签引擎固定为 iframe**；人工回归待做。逐项状态见 `tasks.md`。
目标：让日历、设置、搜索结果、网页像普通文件一样成为编辑区标签，而不是弹窗/覆盖层。
参照 VS Code 的 `IEditorInput` + `EditorResolverService` + `IEditorSerializer` 三件套，但按本项目现有结构落地，不照抄命名。

---

## 0. 结论摘要

1. **类型设计**：`Tab` 记录保持扁平、只做**追加字段**（`kind` / `input` / `title`），新增运行期判别联合 `TabInput` 与 `EDITOR_KINDS` 注册表。文件标签的字段与代码路径逐字节不动，虚拟标签复用 `ephemeral` 语义（`isDirty` 恒为 false）。
2. **第一期范围**：日历 → 设置 → 全局搜索结果，网页标签单独排期。顺序按「改动面由小到大、依赖由少到多」排。
3. **网页标签建议路线**：第一期用 **iframe + 明确的降级卡片 + 系统浏览器兜底**，不做 Tauri 子 webview。子 webview 的层级/坐标代价远高于收益，放到后续独立实验，默认引擎仍为 iframe。
4. **风险最高的两处**：
   - 文件标签既有行为回归（脏标记 / 保存 / 会话恢复 / 关闭确认 / 右键菜单）；
   - 网页标签的层级与坐标同步（子 webview 方案），以及 iframe 的反嵌与快捷键失效。

---

## 1. 现状盘点

### 1.1 数据模型

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| `Tab` 是**纯文件文档模型**：`content` / `savedContent` / `encoding` / `language` / `hadBom` / `lineEnding` / `cursor` | `app/src/types.ts#L21-L46` | 虚拟文档没有这些语义，但下游大量代码直接读这些字段 |
| 全应用**只有一份扁平 `tabs.tabs`**，不区分 pane | `app/src/stores/tabs.ts#L226-L245` | 每个 pane 的标签条都渲染全量列表；虚拟标签天然全局可见 |
| 分屏树 `TileLeaf.activeTabId` 只存 id | `app/src/types.ts#L59-L73` | 拆分/恢复只关心 id，不关心文档类型，天然兼容虚拟标签 |
| 标签 id 生成 `tab-<ts>-<n>` | `app/src/stores/tabs.ts#L47-L48` | 可直接复用 |

### 1.2 渲染与分发

| 环节 | 位置 | 现状 |
| --- | --- | --- |
| 分屏宿主 | `app/src/components/PaneHost.vue#L23-L27`、`#L59-L72` | 从 `tabs.tabs` 取 `activeTab`，把 `Tabs` 全量传给标签条，正文交给 `PaneContent` |
| 单 pane 时标签条上移 | `PaneHost.vue#L27` `tabsInHeader` + `Teleport to="#header-tabs"` | 虚拟标签自动继承该行为，无需改 |
| 正文分发 | `app/src/components/PaneContent.vue#L34-L47` | **只按 `tab.language` + `settings.viewMode`** 决定 Editor / Preview，没有类型抽象 |
| 滚动同步、光标恢复、视图切换锚点 | `PaneContent.vue#L242-L597` | 全部围绕文件/预览，虚拟标签需要 early-return，避免空转 |
| 标签条 | `app/src/components/PaneTabBar.vue` | 标题 `displayTabTitle`、脏点 `tabs.isDirty`、右键菜单（含大量文件专属项）、拖拽排序、拖入分屏、全部标签下拉 |

### 1.3 会话恢复 / 持久化

| 事实 | 位置 |
| --- | --- |
| 按工作区分桶 `solomd.tabs.v1::<folder>`（主窗口无后缀；辅助窗口再加 `::win::<label>`） | `app/src/stores/tabs.ts#L12-L45`、`#L105-L108` |
| 持久化整份 `Tab[]`（**含正文**） | `tabs.ts#L613-L620`、`#L637-L646` |
| 加载时补 CRLF 归一、`restoreSession` 开关、旧全局桶迁移 | `tabs.ts#L128-L176` |
| 分屏树 `solomd.tiles.v1` + `validate()` 修正悬空 `activeTabId` | `app/src/stores/tiles.ts#L272-L300` |
| 工作区切换：脏标签随人走，其余取新工作区桶 | `tabs.ts#L651-L705` |

### 1.4 脏标记与关闭确认

| 事实 | 位置 |
| --- | --- |
| `isDirty` 两处重复实现：`ephemeral && !filePath → false`，否则 `content !== savedContent` | `tabs.ts#L110-L113`、`#L237-L243` |
| 关闭前拦截：`closeTabSafe` 里**又直接比较一次** `content !== savedContent` | `app/src/composables/useFiles.ts#L1046-L1070`（比较在 L1055） |
| 批量关闭统一走 `closeTabSafe` | `PaneTabBar.vue#L121-L126` |
| 关闭时写入「可重开」栈（只记 path/content/language） | `tabs.ts#L439-L475` |
| 退出确认依赖脏标签集合 | 由 `useFiles` 的未保存对话框与窗口关闭流程消费 |

### 1.5 快捷键

| 事实 | 位置 |
| --- | --- |
| 顺序切换（下一个/上一个标签） | `app/src/composables/useShortcuts.ts#L89-L93` |
| MRU 切换 `Ctrl+Tab` / `Ctrl+Shift+Tab` | `useShortcuts.ts#L102-L106` + `tabs.ts#L504-L550` |
| 关闭当前标签 | `useShortcuts.ts#L125-L127` |

两者都只操作 `tabs.tabs` 的 id，因此**虚拟标签加入列表后自动可用，不需要改快捷键代码**。

### 1.6 已有的「中心区覆盖层」先例

`BasesView` / `InboxView` / `TypeLensView` / `ViewNoteList` 直接替换整个 `.content`（`app/src/App.vue#L2398-L2405`），互斥靠 `solomd:leave-center-overlay` 事件（`App.vue#L1739-L1744`、`#L1757`），而该事件由任意标签激活时派发（`tabs.ts#L264-L266`、`#L293-L295`、`#L326-L328`、`#L479-L481`）。

结论：这批覆盖层是「全编辑区替换」，**不适合**作为多类型标签的基座；新方案应走 `PaneContent` 内部按 tab 分发，才能同时满足拆分与多标签。

### 1.7 三个待迁移入口的现状

| 类型 | 当前形态 | 关键位置 |
| --- | --- | --- |
| 日历 | 侧栏迷你月 + `DsModal` 弹窗包 `CalendarWorkspace` | `CalendarPanel.vue#L273-L276`、`CalendarDialog.vue#L25-L73`、`App.vue#L2579-L2580`、`stores/calendar.ts#L44-L92` |
| 设置 | `DsModal` 弹窗（`props.open` 驱动），带 `initialSection` 深链 | `SettingsPanel.vue#L291`、`#L954`、`App.vue#L205-L235`、`#L2545-L2551` |
| 全局搜索 | 桌面是标题行内联搜索框，手机是全屏页；两者都直接 `openPath` 打开文件，没有「结果页」 | `HeaderSearchBox.vue#L189-L201`、`GlobalSearch.vue#L103-L116` |

---

## 2. 目标模型

### 2.1 为什么不把 `Tab` 直接改成判别联合

`Tab` 的 `content` / `savedContent` / `filePath` 被编辑区、保存、外部改动、会话恢复、右键菜单、拖拽等至少十几处直接读写。直接改成 union 会强迫所有调用方做窄化，任何一个遗漏都会变成运行时 `undefined`，而且很难用类型检查一次性发现（很多访问是可选链）。

因此采用**两段式**：

- **持久化/存储层**：`Tab` 仍是扁平记录，追加 `kind` / `input` / `title`；缺省 `kind` 视为 `'file'`，老数据零迁移。
- **解析/渲染层**：新增 `TabInput` 判别联合，由 `resolveTabInput(tab)` 生成；`PaneContent`、标签条标题、右键菜单、关闭逻辑统一走这层。VS Code 的 `IEditorInput` 对应 `TabInput`，`EditorResolverService` 对应 `EDITOR_KINDS`，`IEditorSerializer` 对应注册表的 `serialize/deserialize`。

这样文件标签的既有路径**一行不改**，虚拟标签只走新分支。

### 2.2 `Tab` 记录的追加字段

`app/src/types.ts`：

```ts
export type TabKind = 'file' | 'calendar' | 'settings' | 'search' | 'web';

export interface Tab {
  // …现有字段全部保留，语义不变…
  /** 缺省 / undefined = 普通文件标签（兼容已落盘的老数据） */
  kind?: TabKind;
  /** 仅虚拟标签使用：kind 的参数，注册表负责序列化/反序列化 */
  input?: unknown;
  /** 仅虚拟标签使用：用户可改写的标题（如网页标签的页面名）；缺省由注册表派生 */
  title?: string;
}
```

约定：

- 虚拟标签仍填 `fileName`（= 初始标题）与 `content: '' / savedContent: ''`，让所有「必须有字符串」的旧代码安全；`ephemeral: true` 保证不会弹保存。
- `filePath` 恒为 `undefined`，外部改动、文件监听、另存为等路径天然跳过。
- `language: 'plaintext'`，`encoding: 'UTF-8'`，`hadBom: false`，`lineEnding: 'lf'`——只为满足类型，不参与渲染。

### 2.3 `TabInput` 联合类型（运行期解析结果）

新增 `app/src/lib/editor-input.ts`：

```ts
export interface CalendarTabArgs { date: string; view: CalendarView }
export interface SettingsTabArgs { section?: SettingsCategory }
export interface SearchTabArgs   { query: string }
export interface WebTabArgs      { url: string }

export type TabInput =
  /** 文件不复制正文：正文权威仍在 Tab 记录里，这里只带 id */
  | { kind: 'file'; tabId: string }
  | { kind: 'calendar'; tabId: string; args: CalendarTabArgs }
  | { kind: 'settings'; tabId: string; args: SettingsTabArgs }
  | { kind: 'search';   tabId: string; args: SearchTabArgs }
  | { kind: 'web';      tabId: string; args: WebTabArgs };

export function isFileTab(tab: Tab): boolean {
  return (tab.kind ?? 'file') === 'file';
}

export function resolveTabInput(tab: Tab): TabInput {
  const kind = tab.kind ?? 'file';
  if (kind === 'file') return { kind: 'file', tabId: tab.id };
  const def = EDITOR_KINDS[kind];
  const args = def.deserialize(tab.input);
  // 反序列化失败 → 退回文件语义的空标签，避免整块界面崩掉
  if (!args) return { kind: 'file', tabId: tab.id };
  return { kind, tabId: tab.id, args } as TabInput;
}
```

`file` 分支刻意只带 `tabId`：文件标签的标题、正文、脏标记仍来自 `Tab`，避免两套真相。

### 2.4 kind 注册表

```ts
export interface EditorKindDef<T extends TabInput = TabInput> {
  kind: T['kind'];
  /** Icons.vue 的图标名 */
  icon: string;
  /** 标签标题。虚拟标签必须实现；文件标签不使用 */
  title(tab: Tab, t: TranslateFn): string;
  tooltip?(tab: Tab, t: TranslateFn): string;
  /** 正文组件（异步）。file 为 undefined，由 PaneContent 原有分支处理 */
  component?: () => Promise<Component>;
  /** 单例：settings 全局唯一；false 表示可多开 */
  singleton: false | ((args: T extends { args: infer A } ? A : never) => string);
  /** 是否允许被拖入分屏 / 在分屏中复制 */
  splittable: boolean;
  /** 是否允许关闭（设置也允许关，只是不能再关到 0 个 tab） */
  closable: boolean;
  /** 会话恢复策略：never=不落盘；workspace=跟工作区桶一起存 */
  persist: 'never' | 'workspace';
  /** 脏标记，虚拟文档恒 false */
  dirty(tab: Tab): boolean;
  serialize(input: T extends { args: infer A } ? A : never): unknown;
  deserialize(json: unknown): (T extends { args: infer A } ? A : never) | null;
  /** 激活时同步外部状态（如日历把 args.date 写进 calendar store） */
  onActivate?(tab: Tab): void;
}

export const EDITOR_KINDS: Record<Exclude<TabKind, 'file'>, EditorKindDef> = {
  calendar: {
    kind: 'calendar',
    icon: 'calendar',
    title: (tab, t) => t('editorTab.calendar', { date: (tab.input as CalendarTabArgs).date }),
    component: () => import('../components/tabs/CalendarTab.vue'),
    singleton: () => 'calendar',          // 见 §8 待确认
    splittable: true,
    closable: true,
    persist: 'workspace',
    dirty: () => false,
    serialize: (a) => ({ date: a.date, view: a.view }),
    deserialize: (j) => validCalendarArgs(j),
    onActivate: (tab) => useCalendarStore().setFocusDate((tab.input as CalendarTabArgs).date),
  },
  settings: {
    kind: 'settings',
    icon: 'settings',
    title: (_tab, t) => t('editorTab.settings'),
    component: () => import('../components/tabs/SettingsTab.vue'),
    singleton: () => 'settings',
    splittable: false,
    closable: true,
    persist: 'never',
    dirty: () => false,
    serialize: (a) => ({ section: a.section ?? null }),
    deserialize: (j) => ({ section: readSection(j) }),
  },
  search: {
    kind: 'search',
    icon: 'search',
    title: (tab, t) => t('editorTab.search', { query: (tab.input as SearchTabArgs).query }),
    component: () => import('../components/tabs/SearchResultsTab.vue'),
    singleton: () => 'search',
    splittable: false,
    closable: true,
    persist: 'never',
    dirty: () => false,
    serialize: (a) => ({ query: a.query }),
    deserialize: (j) => ({ query: readQuery(j) }),
  },
  web: {
    kind: 'web',
    icon: 'globe',
    title: (tab, t) => tab.title || hostOf((tab.input as WebTabArgs).url) || t('editorTab.web'),
    component: () => import('../components/tabs/WebTab.vue'),
    singleton: false,                      // 同一 URL 去重，不同 URL 可多开
    splittable: true,
    closable: true,
    persist: 'workspace',
    dirty: () => false,
    serialize: (a) => ({ url: a.url }),
    deserialize: (j) => ({ url: normalizeUrl(String((j as any)?.url ?? '')) }),
  },
};
```

### 2.5 打开 / 聚焦 / 单例

新增 store action（`app/src/stores/tabs.ts`）：

```ts
openInput(kind: Exclude<TabKind,'file'>, args: unknown, opts?: { title?: string }): string
```

流程：

1. 取 `EDITOR_KINDS[kind]`；`serialize(args)` 得到落盘形状。
2. 单例：按 `singleton(args)` 算出 key，在 `tabs.tabs` 中找 `kind === kind` 且 `input` 等价的标签 → 命中则**更新 `input` 并激活**（不新建）。
3. 非单例：按 `serialize` 后的 JSON 去重（网页标签同 URL 只开一个），命中则激活。
4. 新建 `Tab`：`ephemeral: true`、`kind`、`input`、`title`、空的文件字段。
5. `this.activeId = id`；`recordMruVisit(id)`；`window.dispatchEvent('solomd:leave-center-overlay')`。
6. 调用方负责 `tiles.setActiveTab(tiles.focusedPaneId, id)`（沿用现有「先建后聚焦」惯例）。

### 2.6 正文分发（`PaneContent.vue`）

```vue
<div class="pane-content" …>
  <template v-if="input.kind === 'file'">
    <!-- 现有 Editor / Preview / divider 模板整块不动 -->
  </template>
  <component
    v-else
    :is="kindComponent"
    :key="tab.id"
    :tab="tab"
    :input="input"
  />
</div>
```

- `kindComponent` 来自注册表的 `component()`，用 `defineAsyncComponent` + `shallowRef` 缓存，避免每次渲染重新 `import()`。
- 文件分支的 `watch`（滚动同步、视图切换、`bindScrollSync`）增加 `if (!isFileTab(props.tab)) return;` 的 early-return；虚拟标签不进入这些 DOM 查询。
- 虚拟标签不渲染 `.pane--editor` / `.pane--preview`，`StatsPill`、字数统计等依赖 `activeTab.content` 的地方自然读到空串（`App.vue#L2404` 的 `StatsPill` 需要在虚拟标签时隐藏，见 §6.9）。

### 2.7 标签条适配（`PaneTabBar.vue`）

只改「取标题」和「菜单可见性」两处：

| 位置 | 现状 | 改法 |
| --- | --- | --- |
| L370 watch 标题 | `displayTabTitle(x, …)` | 新增 `tabTitle(tab, t, useFirstLine)`，虚拟标签走注册表 |
| L377 下拉过滤 | 只搜 `fileName` / `filePath` | 加入 `tabTitle` 与 `input` 可读字段（如 URL） |
| L87-L107 `ctxFlags`（`hasSaved` 在 L97） | 直接读 `content === savedContent` / `filePath` / `language` | 增加 `isFile`；非文件时隐藏「显示大纲 / 复制路径 / 在文件夹中显示 / 文件树定位」，且不计入 `hasSaved` |
| L223 `closeSaved` 过滤 | `content === savedContent && !pinned` | 加 `isFileTab`，否则虚拟标签（空串 === 空串）会被「关闭所有已保存」静默关掉 |
| 关闭按钮 | `files.closeTabSafe` | 保持调用不变，由 `closeTabSafe` 内部区分（见 §2.8） |
| 固定图标 | 只按 `pinned` | 虚拟标签也可固定，无需改 |

拖拽排序、拖入分屏、中间键拖动、`»` 全部标签列表都基于 id，不需要改；只在 `onPointerUp` 的 split 分支加 `registry.splittable` 判断。

### 2.8 脏标记、关闭与退出确认

统一收敛到一个谓词，消除三处重复：

```ts
// tabs.ts
isDirty(id) {
  const t = …;
  if (!t) return false;
  if (!isFileTab(t)) return false;          // 虚拟文档恒为 false
  if (t.ephemeral && !t.filePath) return false;
  return t.content !== t.savedContent;
}
```

- `useFiles.closeTabSafe`（L1046）开头加：`if (!isFileTab(tab)) { tabs.closeTab(tab.id); return; }`，不再进入未保存对话框。
- 批量关闭「关闭已保存」需排除虚拟标签（否则它们会被 `content === savedContent` 命中而意外关闭）。
- 退出确认、窗口关闭、工作区切换的「脏标签」集合因此自动跳过虚拟标签。
- `closedTabs` 记录扩展为 `{ kind?, input?, title? }`，`reopenClosedTab` 对虚拟标签走 `openInput`；不扩展也能工作，只是虚拟标签无法重开（第一期可接受，建议顺手扩展）。

### 2.9 持久化形状

`persist()` 仍写一份数组，但每条按 kind 裁剪：

```ts
function toPersisted(t: Tab) {
  if (isFileTab(t)) return t;                       // 文件标签逐字节保持原样
  return { id: t.id, kind: t.kind, title: t.title, input: EDITOR_KINDS[t.kind!].serialize(t.input),
           fileName: t.fileName, pinned: t.pinned, ephemeral: true };
}
```

`loadPersisted` / `readBucket` 在返回前做 hydrate：

1. 缺 `kind` → `'file'`；
2. `kind` 不在注册表 → 丢弃该标签（不阻塞整份会话）；
3. 注册表 `deserialize` 失败 → 丢弃；
4. `persist: 'never'` 的 kind（settings / search）→ 丢弃；
5. 补齐虚拟标签的空文件字段。

`tiles.validate` 仍按 id 校验，无需改。

---

## 3. 第一期迁移范围与排序

排序原则：**依赖少、改动面小、可独立验证**先做；设置因为要拆 `DsModal` 壳，排在日历之后；搜索结果需要新增结果视图，排第三；网页放最后。

### 3.1 日历（P1）

**改动面**

| 文件 | 改动 |
| --- | --- |
| `stores/calendar.ts` | `dialogOpen/openDialog/closeDialog` 改为「是否存在日历标签」的派生值，或保留但只服务旧入口；`focusDate` / `view` 仍是唯一状态源 |
| `components/tabs/CalendarTab.vue`（新） | 壳组件：挂 `CalendarWorkspace`，容器宽度用 `ResizeObserver` 得到 `is-narrow`，替代现在的 `window.innerWidth < 720` |
| `components/CalendarPanel.vue#L273-L276` | `openSelectedDay()` → `tabs.openInput('calendar', { date: focusDate, view })` + 聚焦当前 pane |
| `components/CalendarDialog.vue` | 停用并删除 `App.vue` 的挂载（保留文件到 P1 验收通过后再删） |
| `App.vue#L2579-L2580` | 移除 `<CalendarDialog />` |
| `composables/useCommands.ts#L238` | `view.openCalendar` 改打开标签 |
| i18n 15 个语言文件 | `editorTab.calendar` |

**关键点**

- 日历标签是「一个标签、参数可更新」还是「每天一个标签」，见 §8 决策 D1；推荐单例。
- 侧栏迷你月只负责设置 `focusDate` + 打开/聚焦标签；关闭标签**不清空** `calendar.focusDate`，迷你月继续可用。
- `CalendarWorkspace` 内部已有的任务勾选、拖拽改期、事件编辑全部保留，因为它们只依赖 store 与宽度。
- 窄屏（手机）下编辑区标签仍可用，但宽度更窄；`CalendarWorkspace` 的降级规则（<420 周→月、<320 日→议程）必须由**容器宽度**驱动，不能再用窗口宽度。

**验收**

- 迷你月点任意日期 → 编辑区打开/聚焦日历标签，月视图落在该日期；视图切换（月/日/周）与标签参数同步。
- 拆分视图下日历标签可拖入新 pane；两个 pane 共享 `focusDate`（预期，见 §6.1）。
- 关闭日历标签后侧栏迷你月、任务面板、提醒均正常。
- 重启恢复会话：日历标签按 `solomd.calendar.v1::<folder>` 的 `focusDate/view` 恢复。

### 3.2 设置（P2）

**改动面**

| 文件 | 改动 |
| --- | --- |
| `components/SettingsPanel.vue#L954` | 把 `<DsModal>` 壳拆出来：新增 `variant: 'dialog' \| 'tab'` prop；`tab` 时渲染普通容器，不挂焦点陷阱、不改 `document` Esc 监听 |
| `components/tabs/SettingsTab.vue`（新） | 透传 `initialSection`，监听 props 变化 → `activeCategory` |
| `App.vue#L225-L235` | `openSettingsAt`：桌面 → `openInput('settings', { section })`；手机/平板覆盖层 → 保留 `settingsOpen` |
| `App.vue#L2545-L2551` | `SettingsPanel` 仅手机/覆盖层挂载 |
| i18n | `editorTab.settings`、关闭确认文案复用 |

**关键点**

- `SettingsPanel` 有 3400+ 行、内部大量 `props.open` 判断（L291、L654-L690）。`variant='tab'` 时 `open` 恒为 true，且**不注册** window 级 Esc/⌘F 捕获（否则会和编辑器抢占）。
- 单例：再次调用 `openSettingsAt('integrations')` 只更新参数并激活既有标签，不新开第二个。
- `splittable: false`：设置页不应同时出现在两个 pane（两份表单绑定同一 store，容易互相覆盖）。
- 设置标签 `persist: 'never'`：重启不自动打开设置，避免每次启动多一个标签。
- 深链事件 `solomd:open-settings`（监听注册在 `App.vue#L1758`）走同一个 `openSettingsAt`，行为不变。
- 手机/平板保留弹窗：编辑区在手机上是全屏页，标签语义弱；这里属于**产品决策 D2**。

**验收**

- 工具栏齿轮、命令面板、菜单、`solomd:open-settings` 四处入口都能打开/聚焦设置标签，并落到指定分类。
- 设置标签内搜索、录制快捷键、主题预览等原有交互全部可用；按 Esc 不误关整个应用或编辑器。
- 关闭设置标签回到之前的标签；再次打开只有一个设置标签。
- 手机/平板行为与现在一致。

### 3.3 全局搜索结果（P3）

**改动面**

| 文件 | 改动 |
| --- | --- |
| `lib/search-results.ts`（新） | 纯函数 `groupHits(hits)` + `flattenGroups`，附单测；现在 `GlobalSearch.vue#L86-L93` 与 `HeaderSearchBox` 各写一份 |
| `components/tabs/SearchResultsTab.vue`（新） | 查询框 + 分组结果 + ↑↓/↵/Esc；点击命中 → `files.openPath` + 120ms 后 `solomd:outline-goto` |
| `HeaderSearchBox.vue` | 下拉底部新增「在编辑区打开全部结果」；快捷键建议 `⌘⇧↵`（不改变现有 Enter 行为） |
| `GlobalSearch.vue` | 复用 `groupHits`，行为不变 |
| i18n | `editorTab.search`、按钮与空态 |

**关键点**

- 结果标签是**只读虚拟文档**：不写文件、不参与脏标记、`persist: 'never'`（查询词过期即无意义）。
- 单例：再次搜索只更新 `query` 并重新查，不堆标签。
- 点击命中**不关闭**结果标签（VS Code 行为），文件在新标签/既有标签中打开并定位到行。
- 搜索本身仍由 `useGlobalSearch` 提供，不新增依赖、不新增索引。

**验收**

- 桌面标题行搜索 → 「在编辑区打开全部结果」→ 新标签列出分组命中；↑↓ 选择、↵ 打开文件并定位到行。
- 再次搜索同一入口复用同一标签并刷新结果。
- 结果标签参与 `Ctrl+Tab` 顺序与 MRU 切换。
- 手机全屏搜索行为完全不变。

### 3.4 网页标签（P4，详见 §4）

| 文件 | 改动 |
| --- | --- |
| `components/tabs/WebTab.vue`（新） | 地址栏 + 刷新 + 「用系统浏览器打开」+ iframe + 阻塞兜底卡片 |
| `lib/web-tab.ts`（新） | URL 规范化（仅 https）、host 提取、反嵌黑名单、每 host 偏好（`solomd.webTabs.v1`） |
| 命令面板 / 菜单 | 「打开网页…」URL 输入（复用现有 `DsModal` 或 `imageUrlDialog` 的输入形态） |
| i18n | `editorTab.web`、被反嵌提示、外部打开按钮 |

---

## 4. 网页标签：iframe vs Tauri 子 webview

### 4.1 方案 A：DOM `<iframe>`

**能做什么**

- 纯前端，无 Rust、无新依赖；布局、圆角、边框、层级全部跟随 DOM，拆分/拖拽/滚动天然正确。
- 适合允许被嵌入的站点（文档站、维基、部分博客、内部系统）。

**限制（必须写进用户可见文案）**

1. **反嵌**：站点响应头 `X-Frame-Options: DENY/SAMEORIGIN` 或 CSP `frame-ancestors` 会被浏览器直接拦截。跨域下**无法读取响应头**，`load` 事件在 Chromium 的错误页上仍会触发，`onerror` 不可靠 → **无法可靠检测**，只能黑名单 + 超时 + 用户手动兜底。
2. **混合内容**：Tauri 生产环境是安全上下文（Windows `http://tauri.localhost`、macOS `tauri://localhost`），`http://` 子框架会被浏览器拦截 → **只允许 https**。
3. **登录/第三方 Cookie**：Chromium 的第三方存储分区会让登录态时好时坏；`sandbox` 不给 `allow-same-origin` 会直接失去 Cookie（一定要给，因为它是跨域、不会拿到本应用源）。
4. **弹窗与跳转**：不给 `allow-popups` 时 `target=_blank` 失效；不给 `sandbox` 时页面可 `top.location` 劫持整个应用 → **必须设 sandbox**，且不允许 `allow-top-navigation`。
5. **快捷键失效**：焦点进入跨域 iframe 后，键盘事件不再冒泡到父文档，`⌘S` / `Ctrl+Tab` / `⌘W` 等应用级快捷键全部失效。缓解：顶部 chrome 条 + 「点击页面以交互」遮罩，或接受该限制并在文档中说明。
6. **无法读标题/URL**：跨域拿不到 `document.title` 与内部导航 URL → 标签标题用 host，前进/后退按钮不可实现（只能刷新/回首页）。
7. **CSP 预留**：当前 `app/src-tauri/tauri.conf.json#L28-L29` 的 `csp` 是 `null`，所以 `frame-src` 不限制；未来若收紧 CSP，必须显式放行 `frame-src https:`。

**建议参数**

```html
<iframe
  :src="url"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
  referrerpolicy="no-referrer"
  allow="clipboard-read; clipboard-write"
/>
```

### 4.2 方案 B：Tauri 子 webview（`Window::add_child`）

**能力**：真正独立的 WebView2 / WKWebView 子视图，不受 `X-Frame-Options` 约束，站点能力完整，能拿到标题、前进后退、独立缩放。

**代价**

1. **需要开启 unstable API**：`app/src-tauri/Cargo.toml#L54` 目前 `tauri` 只有 `protocol-asset` / `image-png`，要加 `unstable` feature 才能用 `add_child`。这不是新增 crate，但会引入不稳定的平台 API 面。
2. **层级**：原生子视图**永远盖在所有 HTML 之上**。下拉菜单、右键菜单、toast、`DsModal`、命令面板只要与网页区域重叠，就必须先 `set_visible(false)` 隐藏 webview，否则被盖住。圆角、1px 边框、hover 高亮全部无法实现（原生视图是硬矩形）。
3. **坐标同步**：子视图坐标是**相对窗口**的逻辑像素，必须从 `.pane--web` 的 `getBoundingClientRect()` 换算，并在以下时机重算：窗口缩放、三列拖宽、分屏分隔条拖动（每帧 rAF）、标签切换、应用缩放、全屏切换、设备像素比变化。任何一次漏算都会表现为「网页浮在侧栏上」或「网页比面板小一圈」。
4. **滚动遮挡**：子视图不参与父文档滚动/裁剪；若网页标签放在可滚动容器内，必须同步滚动偏移。
5. **拖拽代价**：拖标签、拖分隔条、拖动侧栏时，要么每帧 `set_bounds`（Windows WebView2 上易掉帧），要么拖拽期间隐藏（视觉上网页消失）。
6. **焦点**：原生 webview 获得键盘焦点后，`useShortcuts` 的 window 监听收不到按键；Tauri 原生菜单快捷键仍生效，但 `Ctrl+Tab` 这类 Web 侧实现会失效，需要另做原生转发。
7. **安全**：远程内容与主窗口同进程，必须确保该 label **没有任何 Tauri capability / 初始化脚本**，并用 `on_navigation` 限制导航；否则等于把 IPC 暴露给任意网页。
8. **平台**：Android / iOS 的 Tauri 2 不支持多 webview，必须整体降级为 iframe 或外部浏览器。

### 4.3 对比

| 维度 | iframe | 子 webview |
| --- | --- | --- |
| 反嵌站点 | 打不开 | 正常 |
| 布局/层级/圆角 | 完全跟随 DOM | 原生矩形，盖住一切 HTML |
| 坐标同步 | 无 | 高成本，多触发点 |
| 拆分/拖拽/缩放 | 天然正确 | 需逐帧同步或隐藏 |
| 快捷键 | 焦点在内时失效 | 焦点在内时也失效（需原生转发） |
| 跨域标题/URL | 不可得 | 可得 |
| Rust 改动 | 无 | 需要 `unstable` feature + 新命令/生命周期 |
| 移动端 | 可用（同样受反嵌限制） | 不可用 |
| 实现风险 | 中（能力边界） | 高（层级+坐标+平台） |

### 4.4 建议与降级

**第一期：iframe + 三级降级，不做子 webview。**

1. **默认**：https 地址用 iframe 打开，顶部固定一条 chrome：地址、刷新、复制链接、「用系统浏览器打开」。
2. **已知反嵌站点**（Google / GitHub / X / Facebook / Instagram / LinkedIn / Notion / 微信公众号等）：不尝试 iframe，直接显示占位卡片 + 「用系统浏览器打开」，并记住该 host 的选择（`solomd.webTabs.v1`）。
3. **未知站点加载 6 秒仍未就绪**（用一个轻量 `load` + 计时判断，配合「页面空白？」提示）：显示非阻断提示条，用户可一键切到系统浏览器；不自动跳转，避免误判。

**第二期（独立实验，不阻塞本方案）**：以 `settings.webTabEngine: 'iframe' | 'webview'` 形式接入子 webview，仅桌面端，验证层级与坐标后再决定是否默认。若实现，坐标同步必须抽成独立 composable（`useChildWebviewBounds`），并强制在所有 popover 打开时隐藏。

**明确不做**：用系统浏览器作为**唯一**打开方式（会失去「编辑区里的网页标签」这一目标），以及任何绕过反嵌的 hack。

### 4.5 P5 实验结论（2026-11-11）：不实施，保持 iframe

按 §4.4 的达标条件逐条核对后，本轮**不实现**子 webview：

| 项 | 结论 |
| --- | --- |
| `tauri` `unstable` feature | 不启用。把不稳定的平台 API 面引入发布构建，收益仅是「能打开反嵌站点」，而现有三级降级已覆盖该场景。 |
| `useChildWebviewBounds` | 不新增。窗口缩放、列宽、分隔条拖动、标签切换、缩放、DPR 六类时机都要逐帧换算窗口逻辑像素；任一漏算即表现为原生视图盖住侧栏或尺寸错位。 |
| popover 期间隐藏子视图 | 不做。原生子视图永远盖在 HTML 上，菜单 / toast / `DsModal` / 命令面板必须全部接入隐藏生命周期，改动面远超本方案。 |
| 限制远程页面 IPC 与导航 | 不做。远程内容与主窗口同进程，任何遗漏的 capability 都等价于把 IPC 暴露给任意网页；iframe 的 `sandbox` 已提供进程外隔离边界。 |
| `settings.webTabEngine` | **已落地**：默认 `iframe`，`load()` 对任何非 `iframe` 的持久化值收敛回 `iframe`（`stores/settings-web-tab.test.ts` 锁死）。`'webview'` 仅为预留枚举值，无 UI 暴露、无实现分支。 |
| 仅桌面 / 移动端强制 iframe | 由于没有实现分支，全平台一律 iframe（等价于移动端强制 iframe）。 |
| 达标条件：无遮挡、无错位、拖拽可用、焦点可预期 | **无法在本环境验证**：本环境不能启动 Tauri GUI，这四项都是真机目视 / 交互项。按 §4.4「验证层级与坐标后再决定是否默认」的前置条件，实验不满足放行条件。 |

因此 `WebTab.vue` 的 iframe 路线是本方案的最终形态，不是临时占位。P4 同时把安全策略收敛到 `lib/web-tab.ts` 的 `WEB_TAB_SANDBOX` / `WEB_TAB_PERMISSIONS` 两个常量，并在渲染前对持久化的 URL 做二次 `normalizeUrl` 校验。真机若将来要重启实验，先补 `docs/regression-checklist.md` 的层级 / 坐标 / 焦点用例并全部 PASS，再放开 `load()` 的收敛。

---

## 5. 兼容与风险

### 5.1 拆分视图

- 虚拟标签是全局 tab，可被多个 pane 同时显示。日历/网页共享 store 尚可接受；**设置强制不可拆分**（`splittable: false`）。
- `PaneHost` 只按 `activeTabId` 取 tab，无需改；`tiles.splitPane` 会复制 `activeTabId`，因此拆分后两个 pane 同时显示同一虚拟标签——这是既有行为，保持。
- `tiles.validate` 只看 id，不受 kind 影响。

### 5.2 标签拖拽排序 / 拖入分屏

- 排序、中间键拖动、`»` 列表都基于 id，**零改动**。
- 拖入分屏：在 `PaneTabBar.onPointerUp` 的 split 分支加 `if (!EDITOR_KINDS[kind].splittable) return;`（或退回为排序），避免设置页被拖成两半。

### 5.3 会话恢复

- 老数据 `kind` 缺失 → 文件标签，零迁移。
- 未知 kind / 反序列化失败 → 丢弃该条，不影响整份会话。
- `settings` / `search` 不落盘；`calendar` / `web` 跟工作区桶走。
- 工作区切换：虚拟标签必须**显式**加入「随人走」集合（`isDirty(t) || !isFileTab(t)`），否则会被现有 `carried = tabs.filter(isDirty)` 丢掉；同时按 `singletonKey` 去重。
- `solomd.tiles.v1` 里的 `activeTabId` 若指向被丢弃的虚拟标签，`validate()` 会落到第一个标签。

### 5.4 脏标记（虚拟文档恒 false）

- 唯一权威谓词改为 `tabs.isDirty`；`useFiles.closeTabSafe`、批量关闭、「关闭已保存」全部改为调用它或先判 `isFileTab`。
- `ephemeral` 继续保留原语义（欢迎页），虚拟标签叠加 `kind` 判断，二者不冲突。
- `saveActive` / `saveAll` / 自动保存遍历时跳过虚拟标签（它们 `filePath` 为空，现有逻辑多数已跳过，仍需显式判断避免「另存为」弹窗）。

### 5.5 单例（设置只允许一个）

- 单例判定用 `singleton(args)` 返回的 key，而不是 `kind` 本身：设置恒 `'settings'`；日历恒 `'calendar'`（若采用 D1 单例）；网页按规范化 URL 去重。
- 命中单例时更新 `input` 并激活，**不新建**；这样「设置深链到某个分类」是原地切换。
- 单例标签被固定时同样只更新不新建。

### 5.6 退出确认

- 退出确认枚举脏标签，虚拟标签恒不脏 → 不弹保存框。
- 但「关闭窗口时若只剩虚拟标签」不应阻止退出；现有流程天然满足。
- 若虚拟标签内有未提交状态（例如设置里正在录快捷键、网页里正在填表），**不纳入**退出确认（与 VS Code 对 Settings 的处理一致），需在文档中说明。
- 关闭最后一个标签时 `closeTab` 会补一个未命名文件标签（`tabs.ts#L474`）；关闭最后一个虚拟标签同样如此，属于既有行为，保持。

### 5.7 外部改动提示

- 外部改动由 `app/src/composables/useFileWatcher.ts` 负责，`syncWatchedPaths` 已按 `tab.filePath` 过滤（`#L33-L42`），虚拟标签 `filePath` 为空，**天然不参与监听**，无需改代码。
- 但 `revalidateOpenTabs` 等全量遍历逻辑需复查：只处理 `filePath` 非空的标签，避免把 `undefined` 当成「未命名草稿」误报。
- `FileChangedDialog`（`App.vue#L2589-L2591`）的 reload/overwrite 路径只对文件标签生效。

### 5.8 中心覆盖层互斥

- `BasesView` / `InboxView` / `TypeLensView` / `ViewNoteList` 仍会整体替换 `.content`。`openInput` 必须与 `tabs.activate` 一样派发 `solomd:leave-center-overlay`，否则打开日历标签时可能仍看到 Bases 视图。
- 反向：从这些覆盖层打开虚拟标签后，覆盖层应关闭（由上述事件保证）。

### 5.9 快捷键与状态栏

- 「下一个标签」/MRU 自动包含虚拟标签，无需改。
- `StatsPill`（`App.vue#L2404`）依赖光标行列，虚拟标签时应隐藏或显示占位（建议隐藏）。
- 网页标签 iframe 获得焦点后窗口级快捷键失效，属于已知限制（§4.1 第 5 条）。

### 5.10 i18n / 样式 / 移动端

- 新增文案必须补齐 15 个语言文件（en、zh、ja、ko、de、es、fr、it、pt、pl、nl、sv、tr、ru、uk），英文为兜底。
- 标签图标沿用 `Icons.vue` 现有图标名，不新增图标资源；虚拟标签的标签样式复用现有 `.tab`，不写新色值。
- 手机/平板：日历/搜索/设置建议保留现有全屏/弹窗形态（D2）；网页标签在移动端可用 iframe，但受同一套反嵌限制。

---

## 6. 分阶段实施计划与验收

| 阶段 | 内容 | 产出 | 验收点 |
| --- | --- | --- | --- |
| **P0 基座（零可见变化）** | `TabKind`/`TabInput`/`EDITOR_KINDS`/`isFileTab`/`resolveTabInput`；`PaneContent` 走 resolver 但文件分支逐行不变；标题、菜单、脏标记、关闭、持久化接入 helpers | 新文件 + 少量 if 分支 | 全部现有测试通过；`pnpm build` 通过；人工对比文件标签的打开/切换/保存/关闭/右键/拖拽无任何差异 |
| **P1 日历** | 日历标签 + 侧栏入口 + 命令面板 + 移除弹窗挂载 | `tabs/CalendarTab.vue` | §3.1 验收 |
| **P2 设置** | `SettingsPanel` 拆壳 + 单例 + 四处入口 | `tabs/SettingsTab.vue` | §3.2 验收 |
| **P3 搜索结果** | 结果标签 + 桌面搜索入口 + 分组纯函数 | `tabs/SearchResultsTab.vue`、`lib/search-results.ts` | §3.3 验收 |
| **P4 网页** | iframe 网页标签 + 黑名单 + 外部打开 | `tabs/WebTab.vue`、`lib/web-tab.ts` | §3.4、§4.4 验收 |
| **P5（可选）** | ~~子 webview 实验~~ → 已评估并否决，见 §4.5 | 评估结论 + `settings.webTabEngine` 默认 `iframe` 与收敛测试 | 引擎恒为 iframe；重启实验须先通过真机层级/坐标/焦点用例 |

**每个阶段的统一验证**

1. `pnpm test` 全量通过（新增纯函数必须有单测：kind 解析、标题、单例 key、序列化往返、未知 kind 丢弃、`isDirty` 恒 false、工作区切换携带虚拟标签）。
2. `pnpm build`（含 `vue-tsc --noEmit`）通过。
3. 涉及 Rust 的阶段（P5）额外 `cargo test -j 1`。
4. 手工回归清单：打开/切换/关闭、拆分与恢复、拖拽排序、拖入分屏、会话恢复、外部改动、退出确认、手机布局、15 语言文案。

---

## 7. 明确不做

- 不把 `tabs.tabs` 拆成 per-pane 列表（超出本次目标，且会牵动全部分屏逻辑）。
- 不给文件标签引入新的文件系统抽象（`content` 仍是权威）。
- 不做网页标签的登录态保证、前进/后退历史、下载管理、开发者工具。
- 不做虚拟标签的未保存状态参与退出确认。
- 不新增第三方依赖；子 webview 只涉及 `tauri` feature，不引入 crate。

---

## 8. 待确认的产品决策

| 编号 | 决策 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | 日历标签是单例还是按日期多开 | 单例（打开新日期只更新参数）/ 每个日期一个标签 | **单例**：避免标签爆炸，且日历 store 已持久化 `focusDate` |
| D2 | 手机/平板是否也改成标签 | 全平台标签 / 桌面标签 + 移动端保留弹窗 | **桌面标签，移动端保留弹窗**：移动端编辑区是全屏页，标签切换成本高 |
| D3 | 搜索结果标签的打开手势 | 复用 Enter / 新增 `⌘⇧↵` 或按钮 | **新增按钮 + `⌘⇧↵`**，不改现有 Enter |
| D4 | 设置标签是否参与会话恢复 | 恢复 / 不恢复 | **不恢复**：启动时不应多一个设置标签 |
| D5 | 网页标签是否持久化 URL | 持久化 / 不持久化 | **持久化**（跟工作区桶），刷新后仍在原网页 |
