/**
 * The space-triggered suggestion menu for a task line (batch 5).
 *
 * Typing a space anywhere inside a task line opens a grouped menu of the
 * property values this app can write: date phrases, the three date fields, the
 * five priorities, the status characters and a few recurrence rules. Picking a
 * row inserts the canonical *token* (`📅 2026-11-11`, `⏫`, `-`), never the
 * natural-language text that was displayed in the menu.
 *
 * This module is the pure half: it reads one line plus a caret and returns the
 * exact replacement ranges, so the CodeMirror layer only has to dispatch them.
 * Nothing here (or there) changes the document until a row is chosen — Esc or
 * typing another character leaves the line byte for byte as it was.
 *
 * Existing tokens are *replaced* rather than duplicated: a date pick rewrites
 * the line's `📅`, a priority pick rewrites its priority emoji, and so on.
 * That mirrors how the reference implementation filters its menu by what is
 * already present, without rewriting the whole marker suffix.
 */

import { parseDatePhrase } from './task-date-phrases';

export type TaskSuggestGroup = 'date' | 'field' | 'priority' | 'status' | 'repeat';

export interface TaskSuggestion {
  group: TaskSuggestGroup;
  /** What the row shows — the phrase or the property name. */
  label: string;
  /** Right-aligned hint: the resolved ISO date, or the rule being written. */
  detail?: string;
  /** Replacement range, offsets inside the line. */
  from: number;
  to: number;
  /** What lands in the document — always a token. */
  insert: string;
}

/** A checkbox on a bullet, ordered or quoted line, with any status character. */
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\][ \t])/u;

const ISO = '\\d{4}-\\d{2}-\\d{2}';
const DUE_TOKEN = new RegExp(`📅\\s*${ISO}`, 'u');
const SCHEDULED_TOKEN = new RegExp(`⏳\\s*${ISO}`, 'u');
const START_TOKEN = new RegExp(`🛫\\s*${ISO}`, 'u');
const ANY_DATE_TOKEN = new RegExp(`(?:📅|⏳|🛫)\\s*${ISO}`, 'u');

/** At most one priority per task; `⏺` means "none" and is written as nothing. */
const PRIORITY_TOKEN = /🔺|⏫|🔼|🔽|⏬|⏺/u;

/**
 * `🔁` plus its rule text, ending at the next token this app understands.
 * Same shape as `RECURRENCE_TOKEN` in `tasks.ts` (which is private there).
 */
const RECURRENCE_TOKEN =
  /🔁\s*[\s\S]*?(?=\s*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⏰|🏁|#)\s*|$)/u;

interface DateChoice {
  zh: string;
  en: string;
  /** Fed to `parseDatePhrase`; its `date` is what gets written. */
  phrase: string;
}

const DATE_CHOICES: DateChoice[] = [
  { zh: '今天', en: 'Today', phrase: '今天' },
  { zh: '明天', en: 'Tomorrow', phrase: '明天' },
  { zh: '后天', en: 'In 2 days', phrase: '后天' },
  { zh: '下周一', en: 'Next Monday', phrase: '下周一' },
  { zh: '下周三', en: 'Next Wednesday', phrase: '下周三' },
  { zh: '下周五', en: 'Next Friday', phrase: '下周五' },
  { zh: '下个月', en: 'Next month', phrase: '下个月' },
  { zh: '下个月底', en: 'End of next month', phrase: '下个月底' },
  { zh: '月末', en: 'End of month', phrase: '月末' },
];

interface FieldChoice {
  zh: string;
  en: string;
  marker: string;
  token: RegExp;
}

const FIELD_CHOICES: FieldChoice[] = [
  { zh: '截止', en: 'Due', marker: '📅', token: DUE_TOKEN },
  { zh: '计划', en: 'Scheduled', marker: '⏳', token: SCHEDULED_TOKEN },
  { zh: '开始', en: 'Start', marker: '🛫', token: START_TOKEN },
];

interface PriorityChoice {
  zh: string;
  en: string;
  emoji: string;
}

const PRIORITY_CHOICES: PriorityChoice[] = [
  { zh: '最高', en: 'Highest', emoji: '🔺' },
  { zh: '较高', en: 'High', emoji: '⏫' },
  { zh: '中等', en: 'Medium', emoji: '🔼' },
  { zh: '较低', en: 'Low', emoji: '🔽' },
  { zh: '最低', en: 'Lowest', emoji: '⏬' },
  { zh: '无', en: 'None', emoji: '⏺' },
];

interface StatusChoice {
  zh: string;
  en: string;
  char: string;
}

const STATUS_CHOICES: StatusChoice[] = [
  { zh: '未开始', en: 'To do', char: ' ' },
  { zh: '进行中', en: 'In progress', char: '/' },
  { zh: '完成', en: 'Done', char: 'x' },
  { zh: '已取消', en: 'Cancelled', char: '-' },
  { zh: '待定', en: 'Question', char: '?' },
];

interface RepeatChoice {
  zh: string;
  en: string;
  rule: string;
}

const REPEAT_CHOICES: RepeatChoice[] = [
  { zh: '每天', en: 'Every day', rule: 'every day' },
  { zh: '每周', en: 'Every week', rule: 'every week' },
  { zh: '每两周', en: 'Every 2 weeks', rule: 'every 2 weeks' },
  { zh: '每月', en: 'Every month', rule: 'every month' },
  { zh: '每年', en: 'Every year', rule: 'every year' },
  { zh: '每个工作日', en: 'Every weekday', rule: 'every weekday' },
];

const isZh = (lang: string) => lang.toLowerCase().startsWith('zh');
const pick = (zh: string, en: string, lang: string) => (isZh(lang) ? zh : en);

/** Index of `re` inside the line at or after `from`, or -1. */
function find(re: RegExp, line: string, from: number): number {
  const m = re.exec(line.slice(from));
  return m ? from + m.index : -1;
}

/**
 * Suggestions for the caret, or null when this is not a task line (or the
 * caret sits inside the checkbox itself, where no property belongs).
 */
export function taskSuggestions(
  line: string,
  caret: number,
  today: string,
  lang: string,
): TaskSuggestion[] | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const statusAt = m[1].length;
  const bodyStart = m[0].length;
  if (caret < bodyStart || caret > line.length) return null;

  const status = m[2];
  const priorityAt = find(PRIORITY_TOKEN, line, bodyStart);
  const rule = RECURRENCE_TOKEN.exec(line.slice(bodyStart));
  const ruleAt = rule ? bodyStart + rule.index : -1;
  const ruleEnd = rule ? ruleAt + rule[0].length : -1;
  const firstDateAt = find(ANY_DATE_TOKEN, line, bodyStart);

  /** Where a new token goes: at the caret, unless a token has to stay after it. */
  const dateInsertAt = ruleAt >= 0 && ruleAt < caret ? ruleAt : caret;
  const repeatInsertAt = firstDateAt >= 0 ? firstDateAt : caret;
  const priorityInsertAt = () => {
    const anchors = [ruleAt, firstDateAt].filter((n) => n >= 0);
    return anchors.length ? Math.min(...anchors) : caret;
  };

  const items: TaskSuggestion[] = [];

  // ── Dates: the phrase is parsed, and the ISO date it yields is written. ──
  const dueToken = DUE_TOKEN.exec(line.slice(bodyStart));
  for (const choice of DATE_CHOICES) {
    const parsed = parseDatePhrase(choice.phrase, today);
    if (!parsed?.date) continue;
    const token = `📅 ${parsed.date}`;
    const range = dueToken
      ? { from: bodyStart + dueToken.index, to: bodyStart + dueToken.index + dueToken[0].length }
      : { from: dateInsertAt, to: dateInsertAt };
    items.push({
      group: 'date',
      label: pick(choice.zh, choice.en, lang),
      detail: parsed.date,
      ...range,
      insert: token,
    });
  }

  // ── The three date fields, each with today's date. ──
  for (const choice of FIELD_CHOICES) {
    const token = `${choice.marker} ${today}`;
    const existing = choice.token.exec(line.slice(bodyStart));
    const range = existing
      ? { from: bodyStart + existing.index, to: bodyStart + existing.index + existing[0].length }
      : { from: dateInsertAt, to: dateInsertAt };
    items.push({
      group: 'field',
      label: `${choice.marker} ${pick(choice.zh, choice.en, lang)}`,
      detail: today,
      ...range,
      insert: token,
    });
  }

  // ── Priorities, replacing whatever level the task already has. ──
  const priorityWidth = priorityAt >= 0 ? (PRIORITY_TOKEN.exec(line.slice(priorityAt))?.[0].length ?? 1) : 0;
  const currentPriority = priorityAt >= 0 ? line.slice(priorityAt, priorityAt + priorityWidth) : '';
  const priorityRange =
    priorityAt >= 0
      ? { from: priorityAt, to: priorityAt + priorityWidth }
      : { from: priorityInsertAt(), to: priorityInsertAt() };
  for (const choice of PRIORITY_CHOICES) {
    if (choice.emoji === currentPriority) continue;
    items.push({
      group: 'priority',
      label: `${choice.emoji} ${pick(choice.zh, choice.en, lang)}`,
      ...priorityRange,
      insert: choice.emoji === '⏺' ? '' : choice.emoji,
    });
  }

  // ── Status characters: always the existing checkbox character. ──
  for (const choice of STATUS_CHOICES) {
    if (choice.char.toLowerCase() === status.toLowerCase()) continue;
    items.push({
      group: 'status',
      label: `[${choice.char}] ${pick(choice.zh, choice.en, lang)}`,
      from: statusAt,
      to: statusAt + 1,
      insert: choice.char,
    });
  }

  // ── Recurrence rules, replacing the existing rule text. ──
  for (const choice of REPEAT_CHOICES) {
    const token = `🔁 ${choice.rule}`;
    const range = rule ? { from: ruleAt, to: ruleEnd } : { from: repeatInsertAt, to: repeatInsertAt };
    items.push({
      group: 'repeat',
      label: `🔁 ${pick(choice.zh, choice.en, lang)}`,
      detail: choice.rule,
      ...range,
      insert: token,
    });
  }

  return items;
}
