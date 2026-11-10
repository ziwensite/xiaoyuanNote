# 任务清单 — 任务行空格唤出建议菜单

对应规格：`docs/specs/task-space-menu/spec.md`

## - [x] T1. `app/src/lib/task-date-phrases.ts` 增加 `parseDatePhrase`

- 新增导出（只包装既有 `matchPhrase`，不改任何现有函数）：

  ```ts
  export function parseDatePhrase(phrase: string, today: string): { date?: string; time?: string } | null
  ```

验证：既有 `task-date-phrases` 相关用例不变。

## - [x] T2. 新增 `app/src/lib/task-suggest.ts`

- 类型 `TaskSuggestGroup` / `TaskSuggestion`（`from`/`to`/`insert` 为行内偏移与落盘 token）。
- `taskSuggestions(line, caret, today, lang)`：
  - 任务行正则 `^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\][ \t])`，任意状态字符；`caret < bodyStart` 返回 `null`。
  - 扫描已有 `📅/⏳/🛫`、优先级 emoji、`🔁` 规则。
  - 五组候选（date / field / priority / status / repeat），替换规则见规格 §4.1 表。
  - 插入位置：日期避开 `🔁`（插到其前）；重复/优先级插到日期 token 之前。
  - 日期值走 `parseDatePhrase`，解析失败的行不出现。
  - 文案用内置 `zh`/`en` 表（`lang !== 'zh'` 用 en）。

## - [x] T3. 新增 `app/src/lib/task-suggest.test.ts`

`node:test` + `node:assert/strict`，覆盖：

- 普通段落 / 标题 / `>` 非任务行 → `null`；光标在 `]` 上 → `null`。
- `[ ] [x] [/] [-] [?]` 五种状态都返回候选。
- 「明天」→ `insert === '📅 2026-11-11'`，`from === to === caret`。
- 已有 `📅` → 选中项覆盖该 token（区间覆盖到该 token 末尾）。
- `🔁` 在光标前 → 日期插到 `🔁` 之前。
- `⏳` / `🛫` 字段行 → 今天；同字段已存在则覆盖。
- 优先级：追加 / 覆盖；`⏺` → `insert === ''` 且区间覆盖旧 emoji。
- 状态：覆盖 `statusAt` 单字符；当前状态项不出现。
- 重复：覆盖 `🔁` 规则文本；无规则时插到日期 token 之前。
- `lang: 'en'` 时标签为英文。
- `parseDatePhrase` 覆盖 `今天` / `下周三` / `月末` / `2026-11-30` / `next monday` / `15:00` / 非短语 → `null`。

验证：`pnpm test`。

## - [x] T4. 新增 `app/src/lib/cm-task-suggest.ts`

- `taskSuggestExtension({ today, lang })` = `Prec.highest(keymap.of([...]))` + `EditorView.domEventHandlers` + `ViewPlugin`。
- `Space`：非组字、光标不选中时判定；命中则先 `dispatch` 空格再开菜单，否则返回 `false`。
- `ArrowDown/ArrowUp/Enter/Escape`：仅菜单存在时接管，其余返回 `false`。
- `ViewPlugin.update`：`docChanged || selectionSet || viewportChanged` → 关闭（不改字节）。
- `blur` / `compositionstart` / `scrollDOM.scroll` / `window.resize` → 关闭。
- DOM：`document.body > div.task-suggest`，`role=listbox`，分组标题 + `role=option` 行，`coordsAtPos` 固定定位 + 视口翻转/夹取，`max-height: 320px`。
- 接受：单次 `dispatch`（含 selection），`userEvent: 'input.complete'`；`WeakMap<EditorView, Runtime>`；`destroy()` 清理。

## - [x] T5. 停用静默改写

- 删除 `app/src/lib/cm-task-date.ts`。
- `app/src/components/Editor.vue:97` import 换成 `taskSuggestExtension`；`:4437` 换成 `taskSuggestExtension({ today: () => localDateKey(new Date()), lang: () => settings.language })`，启用条件不变。

## - [x] T6. 显式行命令 `applyDateTokens`

- `app/src/lib/editor-commands.ts`：联合/三个集合加 `'applyDateTokens'`；新增 `MultiTextEdit` 与 `dateTokenEdits(doc, from, today)`（整行 → `naturalDateChanges` → 绝对偏移，升序）。
- `app/src/components/Editor.vue:4968` `onEditorCommand`：CM 与 plain 两条路径各加提前返回分支。
- `app/src/composables/useShortcuts.ts`：`'task.applyDateTokens': () => editorCommand('applyDateTokens')`。
- `app/src/lib/keybindings.ts`：paragraph 组加 `task.applyDateTokens`，默认 `['Mod+Alt+Shift+D']`。
- `app/src/composables/useCommands.ts`：`task.fromSelection` 后加调色板条目（`solomd:editor-command`）。
- 单测 `dateTokenEdits`：任务行末尾「明天」→ 两段 change（删短语 + 写 token）/ 单段；非任务行 → `null`；无短语 → `null`。

## - [x] T7. 样式

- `app/src/styles/menus.css`：surface 列表加 `.task-suggest`；rows 与 hover/`:active` 列表加 `.task-suggest__row`；新增 `.task-suggest__group`、`.task-suggest__row--active`、`.task-suggest__detail`（全部带 `:root:not(#_)` 前缀）。

## - [x] T8. 验证与提交

- `pnpm test`（810 passed, 0 failed）、`pnpm build`（通过）。无 Rust 改动，不跑 `cargo test`。
- 人工检查清单（需真机目视）：弹窗定位/翻转、IME 组字不弹、Esc 与继续打字后该行字节不变、方向键循环、回车落 token。
- 单独提交，不 push，不改版本号。
