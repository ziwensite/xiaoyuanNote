/**
 * The space-triggered suggestion menu for a task line (batch 6).
 *
 * Two levels, following the reference plugin's task suggester:
 *
 *   L0 — the property markers a task can carry (priorities, `🔁`, the six date
 *        fields, the status characters). Markers the line already has are
 *        dropped, so the list only offers what is missing.
 *   L1 — the values of one marker: the date chips for a date field, the rule
 *        catalogue for `🔁`. Picking here writes the token.
 *
 * The other half of the reference's "smart" behaviour is the opening stage: if
 * the caret sits right after a marker (`📅 ` / `🔁 `), the value menu opens
 * directly instead of making the user walk through L0. That is what keeps the
 * common path two keystrokes long while the top level stays short.
 *
 * This module is the pure half: it reads one line plus a caret and returns the
 * rows — replacement ranges for a write, or the request for a submenu. Nothing
 * changes the document until a row is chosen.
 *
 * Differences from the reference, by design:
 *   - no `@due()` / `due:` / `截止` aliases are ever written, and the marker
 *     suffix is never re-serialized: each write replaces exactly its own range;
 *   - no query filtering (typing closes the menu, so every keystroke is
 *     accounted for by the editor);
 *   - `✅` / `❌` do not flip the checkbox — completion has to go through the
 *     task store so a recurring task's next occurrence is scheduled.
 */

import { parseDatePhrase } from './task-date-phrases';

export type TaskSuggestStage = 'marker' | 'date' | 'recurrence';

/** The six date-carrying markers the parser understands. */
export type TaskSuggestField = 'created' | 'start' | 'scheduled' | 'due' | 'completed' | 'cancelled';

export type TaskSuggestGroup = 'priority' | 'recurrence' | 'date' | 'status';

/** Which stage to show; omitted means "decide from the line" (see above). */
export interface TaskSuggestRequest {
  stage: TaskSuggestStage;
  field?: TaskSuggestField;
}

/** A row that writes the token and closes the menu. */
export interface TaskSuggestWrite {
  kind: 'write';
  group: TaskSuggestGroup;
  label: string;
  detail?: string;
  /** Replacement range, offsets inside the line. */
  from: number;
  to: number;
  insert: string;
}

/** A row that opens the next level; it writes nothing. */
export interface TaskSuggestMore {
  kind: 'more';
  group: TaskSuggestGroup;
  label: string;
  stage: 'date' | 'recurrence';
  field?: TaskSuggestField;
}

export type TaskSuggestRow = TaskSuggestWrite | TaskSuggestMore;

export interface TaskSuggestMenu {
  stage: TaskSuggestStage;
  field?: TaskSuggestField;
  /** Heading for the value stages (`📅 截止`); the marker stage groups instead. */
  title?: string;
  rows: TaskSuggestRow[];
}

/** A checkbox on a bullet, ordered or quoted line, with any status character. */
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\][ \t])/u;

interface FieldSpec {
  field: TaskSuggestField;
  marker: string;
  zh: string;
  en: string;
}

/** Canonical marker order, as in the reference's `PROPERTY_EMOJI_ORDER`. */
const FIELDS: FieldSpec[] = [
  { field: 'created', marker: '➕', zh: '创建', en: 'Created' },
  { field: 'start', marker: '🛫', zh: '开始', en: 'Start' },
  { field: 'scheduled', marker: '⏳', zh: '计划', en: 'Scheduled' },
  { field: 'due', marker: '📅', zh: '截止', en: 'Due' },
  { field: 'completed', marker: '✅', zh: '完成', en: 'Done' },
  { field: 'cancelled', marker: '❌', zh: '取消', en: 'Cancelled' },
];

const ISO = '\\d{4}-\\d{2}-\\d{2}';

/** `📅 2026-11-11` for that one field. */
const TOKEN: Record<TaskSuggestField, RegExp> = Object.fromEntries(
  FIELDS.map((f) => [f.field, new RegExp(`${f.marker}\\s*${ISO}`, 'u')]),
) as Record<TaskSuggestField, RegExp>;

const ANY_DATE_TOKEN = new RegExp(`(?:${FIELDS.map((f) => f.marker).join('|')})\\s*${ISO}`, 'u');

interface PrioritySpec {
  emoji: string;
  zh: string;
  en: string;
}

/** Highest first; `⏺` clears, which the reference has no equivalent for. */
const PRIORITIES: PrioritySpec[] = [
  { emoji: '🔺', zh: '最高', en: 'Highest' },
  { emoji: '⏫', zh: '较高', en: 'High' },
  { emoji: '🔼', zh: '中等', en: 'Medium' },
  { emoji: '🔽', zh: '较低', en: 'Low' },
  { emoji: '⏬', zh: '最低', en: 'Lowest' },
  { emoji: '⏺', zh: '无', en: 'None' },
];

const PRIORITY_TOKEN = /🔺|⏫|🔼|🔽|⏬|⏺/u;

interface StatusSpec {
  char: string;
  zh: string;
  en: string;
}

const STATUSES: StatusSpec[] = [
  { char: ' ', zh: '未开始', en: 'To do' },
  { char: '/', zh: '进行中', en: 'In progress' },
  { char: 'x', zh: '完成', en: 'Done' },
  { char: '-', zh: '已取消', en: 'Cancelled' },
  { char: '?', zh: '待定', en: 'Question' },
];

/**
 * `🔁` plus its rule text, ending at the next token this app understands.
 * Same shape as `RECURRENCE_TOKEN` in `tasks.ts` (which is private there).
 */
const RECURRENCE_TOKEN =
  /🔁\s*[\s\S]*?(?=\s*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⏰|🏁|#)\s*|$)/u;

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

const GROUP_LABELS: Record<TaskSuggestGroup, { zh: string; en: string }> = {
  priority: { zh: '优先级', en: 'Priority' },
  recurrence: { zh: '重复', en: 'Repeat' },
  date: { zh: '日期', en: 'Date' },
  status: { zh: '状态', en: 'Status' },
};

const isZh = (lang: string) => lang.toLowerCase().startsWith('zh');
const pick = (zh: string, en: string, lang: string) => (isZh(lang) ? zh : en);

/** Heading for a group; the popup calls this instead of keeping its own table. */
export function taskSuggestGroupLabel(group: TaskSuggestGroup, lang: string): string {
  return pick(GROUP_LABELS[group].zh, GROUP_LABELS[group].en, lang);
}

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
  const m = /(📅|⏳|🛫|➕|✅|❌|🔁)\s*$/u.exec(tail);
  if (!m) return { stage: 'marker' };
  if (m.index > 0 && !/\s/u.test(tail[m.index - 1])) return { stage: 'marker' };
  if (m[1] === '🔁') return { stage: 'recurrence' };
  const field = FIELDS.find((f) => f.marker === m[1]);
  return field ? { stage: 'date', field: field.field } : { stage: 'marker' };
}

interface LineInfo {
  statusAt: number;
  bodyStart: number;
  status: string;
}

function readLine(line: string, caret: number): LineInfo | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const bodyStart = m[0].length;
  if (caret < bodyStart || caret > line.length) return null;
  return { statusAt: m[1].length, bodyStart, status: m[2] };
}

function markerMenu(line: string, info: LineInfo, caret: number, lang: string): TaskSuggestMenu {
  const { bodyStart, statusAt, status } = info;
  const body = line.slice(bodyStart);
  const rows: TaskSuggestRow[] = [];

  // Priorities: at most one per task, so the level already set is not offered.
  const priorityAt = find(PRIORITY_TOKEN, line, bodyStart);
  const priorityWidth =
    priorityAt >= 0 ? (PRIORITY_TOKEN.exec(line.slice(priorityAt))?.[0].length ?? 1) : 0;
  const currentPriority = priorityAt >= 0 ? line.slice(priorityAt, priorityAt + priorityWidth) : '';

  const rule = RECURRENCE_TOKEN.exec(body);
  const ruleAt = rule ? bodyStart + rule.index : -1;
  const firstDateAt = find(ANY_DATE_TOKEN, line, bodyStart);
  const anchors = [ruleAt, firstDateAt].filter((n) => n >= 0);
  const priorityAt2 = anchors.length ? Math.min(...anchors) : caret;
  const priorityRange =
    priorityAt >= 0 ? { from: priorityAt, to: priorityAt + priorityWidth } : { from: priorityAt2, to: priorityAt2 };

  for (const p of PRIORITIES) {
    if (p.emoji === currentPriority) continue;
    rows.push({
      kind: 'write',
      group: 'priority',
      label: `${p.emoji} ${pick(p.zh, p.en, lang)}`,
      ...priorityRange,
      insert: p.emoji === '⏺' ? '' : p.emoji,
    });
  }

  // Recurrence next, then the date fields — the reference's marker order.
  if (!rule) {
    rows.push({
      kind: 'more',
      group: 'recurrence',
      label: `🔁 ${pick('重复', 'Repeat', lang)}`,
      stage: 'recurrence',
    });
  }

  for (const f of FIELDS) {
    // A field that already carries a date is hidden: the value menu is reached
    // again by typing its marker, which is what the reference does too.
    if (TOKEN[f.field].test(body)) continue;
    rows.push({
      kind: 'more',
      group: 'date',
      label: `${f.marker} ${pick(f.zh, f.en, lang)}`,
      stage: 'date',
      field: f.field,
    });
  }

  for (const s of STATUSES) {
    if (s.char.toLowerCase() === status.toLowerCase()) continue;
    rows.push({
      kind: 'write',
      group: 'status',
      label: `[${s.char}] ${pick(s.zh, s.en, lang)}`,
      from: statusAt,
      to: statusAt + 1,
      insert: s.char,
    });
  }

  return { stage: 'marker', rows };
}

function dateMenu(
  line: string,
  info: LineInfo,
  caret: number,
  today: string,
  lang: string,
  field: TaskSuggestField,
): TaskSuggestMenu {
  const spec = FIELDS.find((f) => f.field === field)!;
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
  for (const chip of DATE_CHIPS) {
    const parsed = parseDatePhrase(chip.phrase, today);
    if (!parsed?.date) continue;
    rows.push({
      kind: 'write',
      group: 'date',
      label: pick(chip.zh, chip.en, lang),
      detail: parsed.date,
      ...range,
      insert: `${spec.marker} ${parsed.date}`,
    });
  }

  return {
    stage: 'date',
    field,
    title: `${spec.marker} ${pick(spec.zh, spec.en, lang)}`,
    rows,
  };
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
    group: 'recurrence',
    label: pick(chip.zh, chip.en, lang),
    detail: chip.rule,
    ...range,
    insert: `🔁 ${chip.rule}`,
  }));

  return { stage: 'recurrence', title: `🔁 ${pick('重复', 'Repeat', lang)}`, rows };
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
  if (req.stage === 'date' && req.field) return dateMenu(line, info, caret, today, lang, req.field);
  if (req.stage === 'recurrence') return repeatMenu(line, info, caret, lang);
  return markerMenu(line, info, caret, lang);
}
