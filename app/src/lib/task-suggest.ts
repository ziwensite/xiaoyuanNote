/**
 * The space-triggered suggestion menu for a task line (batches 5–8).
 *
 * Two levels:
 *
 *   L0 — one icon per marker the line can still carry, most used first:
 *        status, `📅`, priority, `⏳`, `🛫`, `🔁`, `➕`, `✅`, `❌`, then the
 *        task editor. Icons only: the value of a marker belongs to L1. Markers
 *        the line already has are dropped, except status and priority — the
 *        status icon carries the current character and priority shows the value
 *        already set (or `⏫`), never the whole ladder.
 *   L1 — the values of that one marker: the other status characters, the date
 *        chips, the rule catalogue, or the five priorities plus `⏺` to clear.
 *        Last row is always the task editor, so every level can reach it.
 *
 * The opening stage is inferred from the line: a bare marker right before the
 * caret (`📅 ` / `🔁 ` / `⏫ `) opens its L1 directly, anything else needs the
 * two-space trigger to open L0 (see `cm-task-suggest.ts`).
 *
 * This module is the pure half: it reads one line plus a caret and returns the
 * rows — replacement ranges for a write, the request for a submenu, or the edit
 * row. Nothing changes the document until a row is chosen, and a chosen row goes
 * back through `writeTaskLine` in `task-line.ts`: canonical order, one space
 * between tokens, and the status ↔ `✅`/`❌` link applied.
 *
 * Differences from the reference plugin, by design:
 *   - no `@due()` / `due:` / `截止` aliases are ever written;
 *   - no query filtering (typing closes the menu, so every keystroke is
 *     accounted for by the editor);
 *   - `✅` / `❌` do not flip the checkbox — completion has to go through the
 *     task store so a recurring task's next occurrence is scheduled.
 */

import { parseDatePhrase } from './task-date-phrases';
import {
  TASK_CLEAR_PRIORITY,
  TASK_DATE_FIELDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_LINE_RE,
  parseTaskLine,
  type TaskDateField,
  type TaskDateLink,
} from './task-line';

export type TaskSuggestStage = 'marker' | 'status' | 'date' | 'recurrence' | 'priority';

export type TaskSuggestField = TaskDateField;

/** Which level to show; omitted means "decide from the line" (see above). */
export interface TaskSuggestRequest {
  stage: TaskSuggestStage;
  field?: TaskSuggestField;
}

/** A row that writes the token and closes the menu. */
export interface TaskSuggestWrite {
  kind: 'write';
  label: string;
  detail?: string;
  /** Replacement range, offsets inside the line. */
  from: number;
  to: number;
  insert: string;
  /** The side of the status ↔ date link this write changes, if any. */
  link?: keyof TaskDateLink;
}

/** A row that opens the next level; it writes nothing. */
export interface TaskSuggestMore {
  kind: 'more';
  label: string;
  detail?: string;
  stage: 'status' | 'date' | 'recurrence' | 'priority';
  field?: TaskSuggestField;
}

/** The last row of every level: hand the whole line to the task editor. */
export interface TaskSuggestEdit {
  kind: 'edit';
  label: string;
}

export type TaskSuggestRow = TaskSuggestWrite | TaskSuggestMore | TaskSuggestEdit;

export interface TaskSuggestMenu {
  stage: TaskSuggestStage;
  field?: TaskSuggestField;
  /** Heading for the value stages (`📅 截止`); L0 has none. */
  title?: string;
  rows: TaskSuggestRow[];
}

const ISO = '\\d{4}-\\d{2}-\\d{2}';

/** `📅 2026-11-11` for that one field. */
const TOKEN: Record<TaskSuggestField, RegExp> = Object.fromEntries(
  TASK_DATE_FIELDS.map((f) => [f.field, new RegExp(`${f.marker}\\s*${ISO}`, 'u')]),
) as Record<TaskSuggestField, RegExp>;

const ANY_DATE_TOKEN = new RegExp(`(?:${TASK_DATE_FIELDS.map((f) => f.marker).join('|')})\\s*${ISO}`, 'u');

const PRIORITY_TOKEN = /🔺|⏫|🔼|🔽|⏬|⏺/u;

/**
 * `🔁` plus its rule text, ending at the next token this app understands.
 * Same shape as `RECURRENCE_TOKEN` in `tasks.ts` (which is private there).
 */
const RECURRENCE_TOKEN =
  /🔁\s*[\s\S]*?(?=\s*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⛔|🏁|#)\s*|$)/u;

interface DateChip {
  zh: string;
  en: string;
  phrase: string;
}

/** The reference's fixed shortcuts, every one of them parsed by our parser. */
const DATE_CHIPS: DateChip[] = [
  { zh: '今天', en: 'Today', phrase: '今天' },
  { zh: '明天', en: 'Tomorrow', phrase: '明天' },
  { zh: '后天', en: 'In 2 days', phrase: '后天' },
  { zh: '一周后', en: 'In a week', phrase: '一周后' },
  { zh: '两周后', en: 'In 2 weeks', phrase: '两周后' },
  { zh: '月底', en: 'End of month', phrase: '月底' },
  { zh: '下个月', en: 'Next month', phrase: '下个月' },
  { zh: '明年', en: 'Next year', phrase: '明年' },
];

interface RepeatChip {
  zh: string;
  en: string;
  rule: string;
}

/** Rules `compileNaturalRecurrence` round-trips, so Obsidian can read them back. */
const REPEAT_CHIPS: RepeatChip[] = [
  { zh: '每天', en: 'Every day', rule: 'every day' },
  { zh: '每个工作日', en: 'Every weekday', rule: 'every weekday' },
  { zh: '每周', en: 'Every week', rule: 'every week' },
  { zh: '每两周', en: 'Every 2 weeks', rule: 'every 2 weeks' },
  { zh: '每月', en: 'Every month', rule: 'every month' },
  { zh: '每年', en: 'Every year', rule: 'every year' },
];

const isZh = (lang: string) => lang.toLowerCase().startsWith('zh');
const pick = (zh: string, en: string, lang: string) => (isZh(lang) ? zh : en);

const editRow = (lang: string): TaskSuggestEdit => ({
  kind: 'edit',
  label: pick('任务编辑…', 'Edit task…', lang),
});

/** Index of `re` inside the line at or after `from`, or -1. */
function find(re: RegExp, line: string, from: number): number {
  const m = re.exec(line.slice(from));
  return m ? from + m.index : -1;
}

/** `{ from, to }` of a bare marker at the very end of `tail`, or null. */
function bareMarker(tail: string, marker: string): { from: number; to: number } | null {
  const m = new RegExp(`${marker}\\s*$`, 'u').exec(tail);
  if (!m) return null;
  if (m.index > 0 && !/\s/u.test(tail[m.index - 1])) return null;
  return { from: m.index, to: tail.length };
}

/** Which stage a space opens when no request is given. */
function openingRequest(tail: string): TaskSuggestRequest {
  const priority = /(🔺|⏫|🔼|🔽|⏬|⏺)\s*$/u.exec(tail);
  if (priority && (priority.index === 0 || /\s/u.test(tail[priority.index - 1]))) {
    return { stage: 'priority' };
  }

  const m = /(📅|⏳|🛫|➕|✅|❌|🔁)\s*$/u.exec(tail);
  if (!m) return { stage: 'marker' };
  if (m.index > 0 && !/\s/u.test(tail[m.index - 1])) return { stage: 'marker' };
  if (m[1] === '🔁') return { stage: 'recurrence' };
  const field = TASK_DATE_FIELDS.find((f) => f.marker === m[1]);
  return field ? { stage: 'date', field: field.field } : { stage: 'marker' };
}

interface LineInfo {
  statusAt: number;
  bodyStart: number;
  status: string;
}

function readLine(line: string, caret: number): LineInfo | null {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return null;
  const bodyStart = m[0].length;
  if (caret < bodyStart || caret > line.length) return null;
  return { statusAt: m[1].length, bodyStart, status: m[2] };
}

/**
 * L0 — marker icons, most used first: status, `📅`, priority, `⏳`, `🛫`, `🔁`,
 * `➕`, `✅`, `❌`. A marker the line already carries is hidden (its L1 is
 * reached again by typing the marker); status and priority are the two rows
 * that always stay, showing the value currently in effect.
 */
function markerMenu(line: string, info: LineInfo, lang: string): TaskSuggestMenu {
  const model = parseTaskLine(line)!;
  const { status } = info;
  const rows: TaskSuggestRow[] = [];

  // Status is one row showing the character in effect; the other four live in
  // its L1, the same way priority keeps its ladder out of L0.
  const current = TASK_STATUSES.find((s) => s.char.toLowerCase() === status.toLowerCase());
  rows.push({
    kind: 'more',
    label: `[${status}]`,
    detail: current ? pick(current.zh, current.en, lang) : pick('状态', 'Status', lang),
    stage: 'status',
  });

  const more = (field: TaskDateField) => {
    const spec = TASK_DATE_FIELDS.find((f) => f.field === field)!;
    return {
      kind: 'more' as const,
      label: spec.marker,
      detail: pick(spec.zh, spec.en, lang),
      stage: 'date' as const,
      field,
    };
  };

  if (!model.due) rows.push(more('due'));

  // Priority is one row, not five: it shows what is set (or the ⏫ default) and
  // opens the ladder, exactly like the other markers.
  const priority = TASK_PRIORITIES.find((p) => p.emoji === model.priority);
  rows.push({
    kind: 'more',
    label: model.priority || '⏫',
    detail: priority ? pick(priority.zh, priority.en, lang) : pick('优先级', 'Priority', lang),
    stage: 'priority',
  });

  if (!model.scheduled) rows.push(more('scheduled'));
  if (!model.start) rows.push(more('start'));
  if (!model.recurrence) {
    rows.push({ kind: 'more', label: '🔁', detail: pick('重复', 'Repeat', lang), stage: 'recurrence' });
  }
  if (!model.created) rows.push(more('created'));
  if (!model.completed) rows.push(more('completed'));
  if (!model.cancelled) rows.push(more('cancelled'));

  rows.push(editRow(lang));
  return { stage: 'marker', rows };
}

/** L1 of the status icon: the other characters. Picking one replaces the char. */
function statusMenu(info: LineInfo, lang: string): TaskSuggestMenu {
  const { statusAt, status } = info;
  const rows: TaskSuggestRow[] = TASK_STATUSES.filter(
    (s) => s.char.toLowerCase() !== status.toLowerCase(),
  ).map((s) => ({
    kind: 'write',
    label: `[${s.char}]`,
    detail: pick(s.zh, s.en, lang),
    from: statusAt,
    to: statusAt + 1,
    insert: s.char,
    link: 'status',
  }));
  rows.push(editRow(lang));
  return { stage: 'status', title: `[${status}] ${pick('状态', 'Status', lang)}`, rows };
}

function dateMenu(
  line: string,
  info: LineInfo,
  caret: number,
  today: string,
  lang: string,
  field: TaskSuggestField,
): TaskSuggestMenu {
  const spec = TASK_DATE_FIELDS.find((f) => f.field === field)!;
  const { bodyStart } = info;
  const tail = line.slice(bodyStart, caret);

  const existing = TOKEN[field].exec(line.slice(bodyStart));
  const bare = bareMarker(tail, spec.marker);
  const ruleAt = find(RECURRENCE_TOKEN, line, bodyStart);
  const insertAt = ruleAt >= 0 && ruleAt < caret ? ruleAt : caret;

  let range = { from: insertAt, to: insertAt };
  if (bare) range = { from: bodyStart + bare.from, to: bodyStart + bare.to };
  else if (existing) range = { from: bodyStart + existing.index, to: bodyStart + existing.index + existing[0].length };

  const rows: TaskSuggestRow[] = [];
  // A closing date decides the status too (batch 8), so the write says which
  // side of the link it is.
  const link = field === 'completed' || field === 'cancelled' ? { link: field } : {};
  for (const chip of DATE_CHIPS) {
    const parsed = parseDatePhrase(chip.phrase, today);
    if (!parsed?.date) continue;
    rows.push({
      kind: 'write',
      label: pick(chip.zh, chip.en, lang),
      detail: parsed.date,
      ...range,
      ...link,
      insert: `${spec.marker} ${parsed.date}`,
    });
  }
  rows.push(editRow(lang));

  return { stage: 'date', field, title: `${spec.marker} ${pick(spec.zh, spec.en, lang)}`, rows };
}

function repeatMenu(line: string, info: LineInfo, caret: number, lang: string): TaskSuggestMenu {
  const { bodyStart } = info;
  const tail = line.slice(bodyStart, caret);
  const body = line.slice(bodyStart);

  const rule = RECURRENCE_TOKEN.exec(body);
  const bare = bareMarker(tail, '🔁');
  const firstDateAt = find(ANY_DATE_TOKEN, line, bodyStart);
  const insertAt = firstDateAt >= 0 ? firstDateAt : caret;

  let range = { from: insertAt, to: insertAt };
  if (bare) range = { from: bodyStart + bare.from, to: bodyStart + bare.to };
  else if (rule) range = { from: bodyStart + rule.index, to: bodyStart + rule.index + rule[0].length };

  const rows: TaskSuggestRow[] = REPEAT_CHIPS.map((chip) => ({
    kind: 'write',
    label: pick(chip.zh, chip.en, lang),
    detail: chip.rule,
    ...range,
    insert: `🔁 ${chip.rule}`,
  }));
  rows.push(editRow(lang));

  return { stage: 'recurrence', title: `🔁 ${pick('重复', 'Repeat', lang)}`, rows };
}

function priorityMenu(line: string, info: LineInfo, caret: number, lang: string): TaskSuggestMenu {
  const model = parseTaskLine(line)!;
  const { bodyStart } = info;

  const at = find(PRIORITY_TOKEN, line, bodyStart);
  const width = at >= 0 ? (PRIORITY_TOKEN.exec(line.slice(at))?.[0].length ?? 2) : 0;
  const range = at >= 0 ? { from: at, to: at + width } : { from: caret, to: caret };

  const rows: TaskSuggestRow[] = TASK_PRIORITIES.map((p) => ({
    kind: 'write',
    label: `${p.emoji} ${pick(p.zh, p.en, lang)}`,
    detail: p.emoji === model.priority ? pick('当前', 'Current', lang) : undefined,
    ...range,
    insert: p.emoji,
  }));
  rows.push({
    kind: 'write',
    label: `${TASK_CLEAR_PRIORITY} ${pick('清除', 'Clear', lang)}`,
    ...range,
    insert: '',
  });
  rows.push(editRow(lang));

  return { stage: 'priority', title: pick('优先级', 'Priority', lang), rows };
}

/**
 * The menu for this line and caret, or null when it is not a task line (or the
 * caret sits inside the checkbox, where no property belongs).
 *
 * Without a `request` the stage is inferred: a marker right before the caret
 * opens its values, anything else opens the marker list.
 */
export function taskSuggestions(
  line: string,
  caret: number,
  today: string,
  lang: string,
  request?: TaskSuggestRequest,
): TaskSuggestMenu | null {
  const info = readLine(line, caret);
  if (!info) return null;
  const tail = line.slice(info.bodyStart, caret);

  const req = request ?? openingRequest(tail);
  if (req.stage === 'status') return statusMenu(info, lang);
  if (req.stage === 'date' && req.field) return dateMenu(line, info, caret, today, lang, req.field);
  if (req.stage === 'recurrence') return repeatMenu(line, info, caret, lang);
  if (req.stage === 'priority') return priorityMenu(line, info, caret, lang);
  return markerMenu(line, info, lang);
}
