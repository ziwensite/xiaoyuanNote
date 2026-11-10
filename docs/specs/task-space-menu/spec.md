# 任务行空格唤出建议菜单 — 规格

状态：已实施（批次 5）
仓库根：`f:\我的资料库\T----同步盘\T----test\xiaoyuanNote`
前端根：`app/`

## 1. 背景与目标

批次 3 交付的是「在任务行末尾输入空格 → 静默把自然语言日期改写成 token」（`app/src/lib/cm-task-date.ts`）。用户要的是参考实现里那种**空格唤出的建议菜单**：由人挑一个候选，挑之前不动正文。

目标：

1. 任务行内输入空格 → 弹出建议菜单；普通正文段落、标题、代码围栏内不弹。
2. 候选只来自本仓库既有的解析器与 token 规范，落盘一律是 token（`📅 2026-11-11`），不写自然语言明文。
3. 选择之前、Esc、继续打字、点外部，都**不改动该行任何字节**。
4. 输入法组字期间不唤出、不拦截空格。
5. 关掉批次 3 的静默改写，改由菜单承担；另留一个显式行命令（命令面板 + 默认快捷键）兜底。

## 2. 参考实现调研结论

参考：`F:\我的资料库\T----同步盘\T----test\xiaoyuanTaskNote\app\src\components\MarkdownEditor.vue`（Milkdown/Crepe + textarea 源码模式）与 `F:\我的资料库\T----同步盘\T----test\Obsidian-WiKi\.obsidian\plugins\xiaoyuanTasksCalendar\src\editor\TaskSuggester.ts` + `taskProperties.ts`。

| 维度 | 参考实现 |
|------|----------|
| 触发 | 不是按键拦截，而是「输入/选区变化后同步状态」：光标前 **两个连续空格** → 属性总菜单；**一个空格 + 行尾半成品标记**（`📅 ⏳ 🛫 ✅ ❌ ➕ 🔁 🔺⏫🔼🔽⏬ 🆔 ⛔`）→ 对应子菜单。插件版同样是「两个空格或空任务体」开总菜单。 |
| 候选 | 固定表 `OBS_ITEMS`，用 `presentObsidianKinds(line)` 剔除行上**已存在的类别**；日期 8–11 个固定 chip；时间 `仅日期 / 09:00 / …`；重复 6 个 chip；优先级 5 行。 |
| 过滤 | 用标记之后的已输入文本 `query` 对标签/值做 `includes`；值后又有空格即判定「值已结束」，关掉子菜单（否则 `🔁 every week ` 会一直过滤规则表）。 |
| 键盘 | 捕获阶段 `keydown`：`Escape` 关闭；开着时 `ArrowUp/Down` 循环、`Enter` 确认；其它单字符键关闭并放行；`isComposing` 完全不动。 |
| 取消 | `closeMenu()` 只置 `open=false`；**此前已写入的空格/临时标记/ISO 日期不回滚**（`chooseKind` 把两个空格换成「空格+标记」，`pickDate` 直接写正文）。 |

值得照搬：空格作为显式手势；按类别分组；剔除已存在的类别；`isComposing` 早退；方向键循环 + 回车确认 + Esc 关闭；继续打字即关闭。

不能照搬：状态驱动（我们要按键时静默关闭，不靠文档重算）；**选择前就写字节**；`applyMarkerChoice` 式整行重排/合并空格/拼字符串；词别名 `due:`/`截止` 的隐式改写；`@due()`/`@remind()` 私有语法。

## 3. 关键决策

1. **以菜单为准，关掉静默改写**：删除 `cm-task-date.ts` 及 `Editor.vue` 的引用，不再有「打了个『明天』就被改掉」。
2. **空格不拦截**：空格由人正常输入，菜单只弹不改；接受才写 token。
3. **显式行命令兜底**：`Task: Apply Date Tokens on This Line`，命令面板 + 默认 `Mod+Alt+Shift+D`，把当前行的日期短语落成 token（复用 `naturalDateChanges`，不新增解析逻辑）。
4. **不做过滤**：菜单在空格处打开，继续打字即关闭，因此没有 `query`；候选是固定表。
5. **不新增 i18n key**：菜单文案在 `task-suggest.ts` 内用 `zh`/`en` 两栏生成（其余 locale 回落到 en，与仓库「先英文落地」的既有做法一致），避免 14 个 locale 文件同步改动。

## 4. 设计

### 4.1 新增 `app/src/lib/task-suggest.ts`（纯函数）

```ts
export type TaskSuggestGroup = 'date' | 'field' | 'priority' | 'status' | 'repeat';

export interface TaskSuggestion {
  group: TaskSuggestGroup;
  label: string;                 // 如 "明天" / "Tomorrow"
  detail?: string;               // 如 "2026-11-11"、"—"
  from: number;                  // 行内偏移，替换区间
  to: number;
  insert: string;                // 落盘内容，一律 token
}

export function taskSuggestions(
  line: string,                  // 不含 \r，不含 \n
  caret: number,                 // 行内偏移
  today: string,                 // YYYY-MM-DD
  lang: 'zh' | 'en' | string,
): TaskSuggestion[] | null;      // null = 不是任务行或光标在复选框里
```

- 任务行判定（与批次 3 一致的正则思路，任意状态字符）：
  `/^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\][ \t])/u`
  - `statusAt = m[1].length`，`bodyStart = m[0].length`；`caret < bodyStart` → `null`（含光标停在 `]` 上）。
- 已存在 token 的扫描（都在 `line` 上，`bodyStart` 之后）：
  - 日期：`📅|⏳|🛫` + `\s*YYYY-MM-DD`（沿用 `tasks.ts` 的 `DATE` 写法）。
  - 优先级：`🔺|⏫|🔼|🔽|⏬|⏺`。
  - 重复：复用 `tasks.ts` 的 `RECURRENCE_TOKEN` 形状（`🔁\s*规则文本`，到下一个已知 token 为界）；在本文件内以同形状常量声明，不导出 `tasks.ts` 的私有常量。
- 候选与替换规则：

| 组 | 行 | `insert` | 替换区间 |
|----|----|----------|----------|
| date | 今天 / 明天 / 后天 / 下周一 / 下周三 / 下周五 / 下周 / 下个月 / 月末（en 对应词） | `📅 <resolved>` | 已有 `📅` → 覆盖它；否则插入 |
| field | `📅 截止` / `⏳ 计划` / `🛫 开始` | `<marker> <today>` | 同字段 token 已存在 → 覆盖它 |
| priority | `🔺 最高` `⏫ 较高` `🔼 中等` `🔽 较低` `⏬ 最低` `⏺ 无` | 对应 emoji（`⏺` 为 `''`） | 已有优先级 → 覆盖；`⏺` 只删除 |
| status | `[ ] 未开始` `[/] 进行中` `[x] 完成` `[-] 已取消` `[?] 待定` | 单个状态字符 | 覆盖 `statusAt` 处那一个字符；当前状态那一行不出现 |
| repeat | `🔁 every day` / `every week` / `every 2 weeks` / `every month` / `every year` / `every weekday` | 同上 | 已有规则 → 覆盖 `🔁` 到规则末尾；否则插入 |

- 日期值由新增的 `parseDatePhrase`（见 4.2）解析得到，**不拼字符串**；解析失败的行直接不出现（不会静默退化成 `today`）。
- 插入位置：
  - 日期：若 `🔁` 在 `caret` 之前 → 插到 `🔁` 之前（沿用批次 3「`🔁` 排在日期前」）；否则插到 `caret`。
  - 重复：若已有日期 token → 插到第一个日期 token 之前；否则插到 `caret`。
  - 优先级：若有 `🔁` 或日期 token → 插到第一个之前；否则插到 `caret`。
  - 状态：固定覆盖 `statusAt`。
- 顺序固定为 date → field → priority → status → repeat；`detail` 显示解析出的 ISO 日期（日期/字段行），其余留空。

### 4.2 `app/src/lib/task-date-phrases.ts`：新增一个导出

```ts
/** 解析一个独立的日期/时间短语（菜单候选用它取结构化值）。 */
export function parseDatePhrase(
  phrase: string,
  today: string,
): { date?: string; time?: string } | null {
  const p = matchPhrase(phrase.trim(), today);
  return p ? { date: p.date, time: p.time } : null;
}
```

`matchPhrase` 已有 `bounded()` + `$` 锚点，整串即短语时行为正确；不改动任何既有函数。

### 4.3 新增 `app/src/lib/cm-task-suggest.ts`（CodeMirror 层）

```ts
export interface TaskSuggestOptions {
  today: () => string;
  lang: () => string;
}
export function taskSuggestExtension(opts: TaskSuggestOptions): Extension;
```

组成（全部以 `Prec.highest` 的 keymap + 一个 `ViewPlugin` 实现）：

- **打开**：keymap `Space`：`selection.empty && !view.composing && !event.isComposing` 时用 `taskSuggestions` 判定；命中则 `view.dispatch({changes:{from:head,insert:' '}, selection:{anchor:head+1}, userEvent:'input.type'})`，**dispatch 之后**再建菜单（此时没有运行时，`ViewPlugin.update` 不会误关），返回 `true`；否则返回 `false`（照常输入）。空格因此在 IME 组字期间永远走默认路径。
- **键盘**（仅菜单存在时生效，否则返回 `false`）：`ArrowDown`/`ArrowUp` 循环移动高亮，`Enter` 接受，`Escape` 关闭。`Space` 不拦截。
- **关闭且零字节**：`ViewPlugin.update` 里 `docChanged || selectionSet || viewportChanged` → `close()`；`domEventHandlers` 的 `blur` / `compositionstart` → `close()`；打开期间在 `scrollDOM` 上挂一次性 `scroll` 监听 → `close()`；`window.resize` → `close()`。`close()` 只移除 DOM 与监听，不 dispatch，不改文档。
- **接受**：一次 `dispatch({ changes: {from, to, insert}, selection: {anchor: from+insert.length}, userEvent: 'input.complete' })`，然后 `close()`；撤销一步即可回退。
- **渲染**：`document.body` 下 `div.task-suggest`（`role="listbox"`），分组标题 `.task-suggest__group` + 行 `.task-suggest__row`（`role="option"`，`aria-selected`）。`position: fixed`，用 `view.coordsAtPos(pos)` 定位，底部越界翻到上方，左右夹在视口内；`max-height: 320px; overflow: auto`。编辑器保持焦点（不移动焦点），键位继续由 keymap 接管。
- **鼠标**：`mousedown` → `preventDefault()` 并接受（避免抢焦点）；`mouseenter` 更新高亮。
- 运行时状态放在 `WeakMap<EditorView, Runtime>`（`{el, items, active, pos}`），`ViewPlugin.destroy()` 时清理。

### 4.4 删除静默改写

- 删除 `app/src/lib/cm-task-date.ts`。
- `app/src/components/Editor.vue:97` 的 import 改为 `taskSuggestExtension`；`:4437` 的 `taskDatePhraseExtension(...)` 换成
  `taskSuggestExtension({ today: () => localDateKey(new Date()), lang: () => settings.language })`（位置不变，仍只在 markdown 且非 `windowsImeSafeMode` / `markdownSafeMode` 时启用）。

### 4.5 显式行命令

- `app/src/lib/editor-commands.ts`：
  - `EditorCommand` 联合、`EDITOR_COMMANDS`、`EDITING_COMMANDS`、`MARKDOWN_ONLY_COMMANDS` 各加 `'applyDateTokens'`。
  - 新增纯函数：
    ```ts
    export interface MultiTextEdit {
      changes: { from: number; to: number; insert: string }[]; // 绝对值、可多段
      selFrom: number;
      selTo: number;
    }
    export function dateTokenEdits(
      doc: string, from: number, today: string,
    ): MultiTextEdit | null;  // 取 from 所在的整行，交给 naturalDateChanges；null = 没有可转换的短语
    ```
    映射为绝对偏移后按 `from` 升序；`selFrom = selTo = 行首 + 新行长`。
- `app/src/components/Editor.vue:4968` 的 `onEditorCommand`：在 CM 分支与 plain 分支各加一个 `applyDateTokens` 提前返回分支（CM 用 `changes: edit.changes`；plain 用 `applyPlainContent` + `selectPlainRange`）。
- `app/src/composables/useShortcuts.ts`：`actions` 表加 `'task.applyDateTokens': () => editorCommand('applyDateTokens')`。
- `app/src/lib/keybindings.ts`：paragraph 组加
  `{ id: 'task.applyDateTokens', label: 'Task: Apply Date Tokens on This Line', category: 'paragraph', defaults: ['Mod+Alt+Shift+D'] }`（该组合当前无默认占用）。
- `app/src/composables/useCommands.ts`：在 `task.fromSelection` 后加同 id 的调色板条目，`run` 派发 `solomd:editor-command`。

### 4.6 样式

`app/src/styles/menus.css`：把 `.task-suggest` 加入 surface 列表（`--bg-pop` / `--r-lg` / `--sh-pop` / `--sp-1`），把 `.task-suggest__row` 加入 rows 与 hover/`:active` 列表，新增：

- `.task-suggest__group` — 11px/600 `--text-3`，上下 4px；
- `.task-suggest__row--active` — `background: var(--fill-1)`（与 `.cm-slash-row--active` 同款）；
- `.task-suggest__detail` — 右对齐、`--text-3`、12px。

所有规则沿用该文件既有的 `:root:not(#_)` 前缀写法。

## 5. 交互与边界

| 场景 | 行为 |
|------|------|
| 空格（任务行、非组字、光标不在选区） | 正常输入空格 + 弹菜单 |
| IME 组字中按空格 | 不唤出，不拦截 |
| 菜单开着继续打字 / 粘贴 / 回车以外的编辑 | 关闭，不改任何字节 |
| `Esc` | 关闭，不改任何字节 |
| 点击菜单外 / 编辑器失焦 / 滚动 / 窗口缩放 | 关闭，不改任何字节 |
| 方向键 | 循环移动高亮（不移动光标） |
| `Enter` | 接受高亮项，写 token，菜单关闭 |
| 普通段落、标题、`>` 引用中的非任务行、围栏代码里的伪复选框 | 不弹（只用行首正则判定，与批次 3 同一取舍） |
| 光标停在 `- [ ]` 的 `]` 上 | 不弹 |
| 选择「⏺ 无」 | 只删除已有优先级 emoji，不留下空 token |
| 同一行再打一个空格 | 重新弹菜单（候选按当前行现状重新生成） |

## 6. 验收

1. `pnpm test` 全绿，且新增用例覆盖 §4.1 的候选/替换/插入位置、`parseDatePhrase`、`dateTokenEdits`。
2. `pnpm build` 通过（本批无 Rust 改动，`cargo test` 不必跑；`mcp-server` 的 `safety::tests::resolve_new_refuses_parent_dir_components` 是既有失败，与本次无关）。
3. 手工（无法单测，需真机目视）：弹窗定位与视口翻转、IME 组字期间不弹、Esc/打字后行的字节完全不变（`git diff` 无可写内容）。
4. 单独提交，不 push，不改版本号。

## 7. 明确不做

- 不引入 `@due()`/`@remind()` 等私有语法，不新增词别名（`due:`/`截止`）的隐式改写。
- 不做候选过滤/搜索输入（继续打字即关闭）。
- 不改日历事件侧模型，不改 `🔁` 的推进语义，不新增依赖。
- 不把菜单项写进 14 个 locale 文件。
