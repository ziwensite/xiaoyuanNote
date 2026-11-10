/**
 * Task metadata — priority and due date — parsed out of a task's text.
 *
 * The Rust index finds `- [ ]` lines and hands the text over verbatim
 * (`workspace_index::extract_tasks`); everything about what that text *means*
 * lives here, so the syntax is defined once instead of in two languages that
 * drift.
 *
 * Two spellings are accepted for each field, on purpose:
 *
 *   - The Obsidian Tasks emoji (`⏫ 🔼 🔽`, `📅 2026-09-10`), so a vault that
 *     already uses them keeps working when it is opened here.
 *   - A plain-ASCII form (`!!!`, `[#A]`, `due:2026-09-10`) for everyone who is
 *     not going to reach for an emoji picker mid-sentence.
 *
 * Anything not recognised is left in the text. A parser that silently eats
 * words it does not understand is worse than one that shows them.
 */

export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest' | null;

/** Obsidian Tasks' status types. Only "done" changes how a click is written. */
export type TaskStatusType =
  | 'todo'
  | 'in_progress'
  | 'on_hold'
  | 'done'
  | 'cancelled'
  | 'non_task';

export interface TaskStatusRule {
  type: TaskStatusType;
  /** The symbol a click writes next. */
  next: string;
}

/**
 * Obsidian Tasks' default status table: `[ ]` is TODO, `[x]`/`[X]` are DONE,
 * and every other symbol is an *unknown* status that Tasks reports as type TODO
 * and toggles to `x`. Keeping the default here is what makes `[/]` or `[-]`
 * lines behave the same in both apps.
 */
const DEFAULT_STATUS_RULES: Record<string, TaskStatusRule> = {
  ' ': { type: 'todo', next: 'x' },
  x: { type: 'done', next: ' ' },
  X: { type: 'done', next: ' ' },
};

export function taskStatusRule(symbol: string): TaskStatusRule {
  return DEFAULT_STATUS_RULES[symbol] ?? { type: 'todo', next: 'x' };
}

export type TaskRecurrenceKind = 'natural' | 'legacy' | 'unsupported';

/**
 * How a task repeats, as written on the line.
 *
 * Obsidian Tasks spells recurrence in English ("every week"); this project used
 * to write a raw iCal `FREQ=…` there. Both are read, but only the natural form
 * is ever written — see `completeRecurringTaskLine`, which copies the existing
 * `🔁` text verbatim instead of re-serialising a rule.
 */
export interface TaskRecurrence {
  /** The rule as written after `🔁`, trimmed. */
  text: string;
  /**
   * `natural` — compiled to a rule we can expand.
   * `legacy` — an old `FREQ=…` rule; kept verbatim, never rewritten.
   * `unsupported` — text we cannot compile, kept in the title and flagged.
   */
  kind: TaskRecurrenceKind;
  /** `when done`: the next occurrence counts from the completion date. */
  whenDone: boolean;
}

/** `🏁 keep` (default) or `🏁 delete`. */
export type TaskRecurrenceAction = 'keep' | 'delete';

export interface TaskMeta {
  /** Display text, with the tokens this module consumed removed. */
  title: string;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, or null. */
  due: string | null;
  /** `⏳` scheduled date, `YYYY-MM-DD`. Absent when the line has none. */
  scheduled?: string;
  /** `🛫` start date, `YYYY-MM-DD`. Absent when the line has none. */
  start?: string;
  /** `➕` created date, `YYYY-MM-DD`. Absent when the line has none. */
  created?: string;
  /** `✅` done date, `YYYY-MM-DD`. Absent when the line has none. */
  completed?: string;
  /** `❌` cancelled date, `YYYY-MM-DD`. Absent when the line has none. */
  cancelled?: string;
  /** `#tags` mentioned in the task (kept in `title` as well). */
  tags: string[];
  /**
   * Stable identity for calendar interoperability (iCal `VTODO` `UID`).
   * Only present when the line carries an explicit `🆔 …` token; callers that
   * need one (reminders, sync) inject it once and then rely on it.
   */
  uid?: string;
  /** iCal `VALARM` triggers, e.g. `-PT15M` or `09:00`. Absent when none. */
  reminders?: string[];
  /** Raw iCal `RRULE` value (e.g. `FREQ=WEEKLY;BYDAY=FR`). Absent when none. */
  rrule?: string;
  /** How the `🔁` text on the line reads; absent when the line has none. */
  recurrence?: TaskRecurrence;
  /** `🏁` completion action; absent when the line has none. */
  recurrenceAction?: TaskRecurrenceAction;
}

const PRIORITY_RANK: Record<Exclude<TaskPriority, null>, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
};

/** Rank for a task without a priority: after every explicit level. */
const NO_PRIORITY_RANK = 5;

/** `2026-09-10` and nothing else — no `10/09/2026` ambiguity to guess at. */
const DATE = /(\d{4}-\d{2}-\d{2})/;

const DUE_PATTERNS: RegExp[] = [
  new RegExp(`📅\\s*${DATE.source}`, 'u'),
  new RegExp(`\\bdue\\s*:\\s*${DATE.source}`, 'iu'),
];

/** The other Obsidian Tasks date fields, each a single emoji + `YYYY-MM-DD`. */
const SCHEDULED_TOKEN = new RegExp(`⏳\\s*${DATE.source}`, 'u');
const START_TOKEN = new RegExp(`🛫\\s*${DATE.source}`, 'u');
const CREATED_TOKEN = new RegExp(`➕\\s*${DATE.source}`, 'u');
const COMPLETED_TOKEN = new RegExp(`✅\\s*${DATE.source}`, 'u');
const CANCELLED_TOKEN = new RegExp(`❌\\s*${DATE.source}`, 'u');

const EMOJI_PRIORITY: Array<[RegExp, Exclude<TaskPriority, null>]> = [
  [/🔺/u, 'highest'],
  [/⏫/u, 'high'],
  [/🔼/u, 'medium'],
  [/🔽/u, 'low'],
  [/⏬/u, 'lowest'],
];

const BRACKET_PRIORITY: Array<[RegExp, Exclude<TaskPriority, null>]> = [
  [/\[#A\]/iu, 'high'],
  [/\[#B\]/iu, 'medium'],
  [/\[#C\]/iu, 'low'],
];

/**
 * `!`, `!!`, `!!!` as a standalone token.
 *
 * The word-boundary requirement is what keeps "Ship it!" a plain sentence:
 * the bang there is attached to a word, and only a bang standing on its own is
 * a priority marker.
 */
const BANG_PRIORITY = /(^|\s)(!{1,3})(?=\s|$)/u;

/**
 * Calendar-side metadata, all optional and backward compatible:
 *   - `🆔 <id>` — stable UID for sync; only injected when a reminder is set.
 *   - `⏰ <trigger>` — one or more VALARM triggers (`-PT15M`, `09:00`, or an
 *     absolute ISO timestamp).
 *   - `🔁 <rule>` — Obsidian Tasks' natural-language recurrence
 *     (`every week`, `every 2 months on the 3rd`), or the legacy raw iCal
 *     `FREQ=…` this project used to write. Both are read; only the natural
 *     form is ever written.
 *   - `🏁 keep|delete` — what completing an occurrence does to the old line.
 *
 * Malformed values are left in `title` on purpose, matching the rule that the
 * parser never eats words it does not understand.
 */
const UID_TOKEN = /🆔\s*([A-Za-z0-9_-]{4,})/u;
const REMINDER_TOKEN = /⏰\s*(-?P[A-Za-z0-9]+|[0-9]{1,2}:[0-9]{2}|\d{4}-\d{2}-\d{2}T[0-9:]+Z?)/u;

/**
 * `🔁` plus its rule text, stopping at the next token this module understands.
 *
 * The rule is *not* "everything to the end of the line": Tasks allows the
 * recurrence to sit before the dates (`🔁 every week 📅 2026-11-09`), which is
 * the order this project writes. Group 1 is the whitespace the token owns, so
 * removing the match leaves the rest of the line's spacing intact.
 */
const RECURRENCE_TOKEN =
  /(\s*)🔁\s*([\s\S]*?)(?=\s*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⏰|🏁|#)\s*|$)/u;
const RECURRENCE_ACTION_TOKEN = /🏁\s*(keep|delete)\b/iu;
const LEGACY_RRULE = /^FREQ=[A-Za-z0-9=;,:+-]+$/i;

const WEEKDAY_CODES: Record<string, string> = {
  monday: 'MO',
  mon: 'MO',
  tuesday: 'TU',
  tues: 'TU',
  tue: 'TU',
  wednesday: 'WE',
  weds: 'WE',
  wed: 'WE',
  thursday: 'TH',
  thurs: 'TH',
  thur: 'TH',
  thu: 'TH',
  friday: 'FR',
  fri: 'FR',
  saturday: 'SA',
  sat: 'SA',
  sunday: 'SU',
  sun: 'SU',
};

const MONTH_CODES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: -1,
};

function ordinalValue(token: string): number | null {
  const word = ORDINAL_WORDS[token];
  if (word !== undefined) return word;
  const m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 31 ? n : null;
}

function weekdayCodes(text: string): string[] | null {
  const parts = text
    .replace(/\band\b/gu, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: string[] = [];
  for (const part of parts) {
    const code = WEEKDAY_CODES[part];
    if (!code) return null;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** `the 1st and 15th`, `the last day`, `last`. */
function monthDayList(text: string): number[] | null {
  const parts = text
    .replace(/\bthe\b/gu, ' ')
    .replace(/\band\b/gu, ',')
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (part === 'last' || part === 'last day') {
      out.push(-1);
      continue;
    }
    const n = ordinalValue(part);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** `2nd tuesday` → `2TU`, `last friday` → `-1FR`, `tuesday` → `TU`. */
function weekdaySpec(text: string): string | null {
  const cleaned = text.replace(/\bthe\b/gu, ' ').trim().replace(/\s+/g, ' ');
  const m = /^(?:(first|second|third|fourth|fifth|last|\d{1,2}(?:st|nd|rd|th)?)\s+)?([a-z]+)$/u.exec(
    cleaned,
  );
  if (!m) return null;
  const day = WEEKDAY_CODES[m[2]];
  if (!day) return null;
  if (!m[1]) return day;
  const ordinal = ordinalValue(m[1]);
  if (ordinal === null || ordinal < -1 || ordinal > 5) return null;
  return `${ordinal}${day}`;
}

function buildRule(
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  interval: number | null,
  byDay: string[] | null,
  byMonthDay: number[] | null,
  byMonth: number[] | null,
): string {
  const parts = [`FREQ=${freq}`];
  if (interval && interval > 1) parts.push(`INTERVAL=${interval}`);
  if (byDay?.length) parts.push(`BYDAY=${byDay.join(',')}`);
  if (byMonth?.length) parts.push(`BYMONTH=${byMonth.join(',')}`);
  if (byMonthDay?.length) parts.push(`BYMONTHDAY=${byMonthDay.join(',')}`);
  return parts.join(';');
}

/** `january 5th`, `june`, `the 2nd tuesday`. Month must be first. */
function yearlySpec(text: string): { byDay: string[] | null; byMonthDay: number[] | null; byMonth: number[] } | null {
  const tokens = text
    .replace(/\bthe\b/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const month = MONTH_CODES[tokens[0]];
  if (!month) return null;
  const rest = tokens.slice(1).join(' ');
  if (!rest) return { byDay: null, byMonthDay: null, byMonth: [month] };
  if (rest === 'last day') return { byDay: null, byMonthDay: [-1], byMonth: [month] };
  const day = ordinalValue(rest);
  if (day !== null) return { byDay: null, byMonthDay: [day], byMonth: [month] };
  const spec = weekdaySpec(rest);
  if (spec) return { byDay: [spec], byMonthDay: null, byMonth: [month] };
  return null;
}

/**
 * Compile Obsidian Tasks' natural-language recurrence into an in-memory
 * `FREQ=…` string.
 *
 * Only what Tasks itself can express is accepted — no `COUNT`, no `UNTIL`,
 * because the UI never offers them. Returning null means "we did not
 * understand this"; the caller keeps the text on the line and flags it rather
 * than guessing at a schedule.
 */
export function compileNaturalRecurrence(
  raw: string,
): { rrule: string; whenDone: boolean } | null {
  let text = raw.trim().replace(/[.;]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
  let whenDone = false;
  if (/(?:^|\s)when done$/u.test(text)) {
    whenDone = true;
    text = text.replace(/\s*when done$/u, '').trim();
  }
  const every = /^every\s+(.+)$/u.exec(text);
  if (!every) return null;
  const body = every[1].trim();

  let m = /^(?:(\d+)\s+)?days?$/u.exec(body);
  if (m) return { rrule: buildRule('DAILY', m[1] ? Number(m[1]) : null, null, null, null), whenDone };

  if (/^weekdays?$/u.test(body)) {
    return { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', whenDone };
  }

  m = /^(?:(\d+)\s+)?weeks?(?:\s+on\s+(.+))?$/u.exec(body);
  if (m) {
    const days = m[2] ? weekdayCodes(m[2]) : null;
    if (m[2] && !days) return null;
    return {
      rrule: buildRule('WEEKLY', m[1] ? Number(m[1]) : null, days, null, null),
      whenDone,
    };
  }

  const weekdays = weekdayCodes(body);
  if (weekdays) return { rrule: buildRule('WEEKLY', null, weekdays, null, null), whenDone };

  m = /^(?:(\d+)\s+)?months?(?:\s+on\s+(.+))?$/u.exec(body);
  if (m) {
    const interval = m[1] ? Number(m[1]) : null;
    if (!m[2]) return { rrule: buildRule('MONTHLY', interval, null, null, null), whenDone };
    const days = monthDayList(m[2]);
    if (days) return { rrule: buildRule('MONTHLY', interval, null, days, null), whenDone };
    const spec = weekdaySpec(m[2]);
    if (spec) return { rrule: buildRule('MONTHLY', interval, [spec], null, null), whenDone };
    return null;
  }

  m = /^(?:(\d+)\s+)?years?(?:\s+on\s+(.+))?$/u.exec(body);
  if (m) {
    const interval = m[1] ? Number(m[1]) : null;
    if (!m[2]) return { rrule: buildRule('YEARLY', interval, null, null, null), whenDone };
    const spec = yearlySpec(m[2]);
    if (!spec) return null;
    return {
      rrule: buildRule('YEARLY', interval, spec.byDay, spec.byMonthDay, spec.byMonth),
      whenDone,
    };
  }

  const named = yearlySpec(body);
  if (named) {
    return {
      rrule: buildRule('YEARLY', null, named.byDay, named.byMonthDay, named.byMonth),
      whenDone,
    };
  }
  return null;
}

type OptionalTaskDate = 'scheduled' | 'start' | 'created' | 'completed' | 'cancelled';

const OPTIONAL_DATE_TOKENS: Array<[OptionalTaskDate, RegExp]> = [
  ['scheduled', SCHEDULED_TOKEN],
  ['start', START_TOKEN],
  ['created', CREATED_TOKEN],
  ['completed', COMPLETED_TOKEN],
  ['cancelled', CANCELLED_TOKEN],
];

const TASK_LINE = /^(\s*[-*+]\s+\[[^\]\n]\])(.*)$/u;
const TASK_PARTS = /^(\s*[-*+]\s+)\[([^\]\n])\]([\s\S]*)$/u;

export function parseTaskMeta(text: string): TaskMeta {
  let rest = text;
  let priority: TaskPriority = null;
  let due: string | null = null;
  let uid: string | undefined;
  let rrule: string | undefined;
  let recurrence: TaskRecurrence | undefined;
  let recurrenceAction: TaskRecurrenceAction | undefined;
  const reminders: string[] = [];
  const dates: Partial<Record<OptionalTaskDate, string>> = {};

  const actionMatch = RECURRENCE_ACTION_TOKEN.exec(rest);
  if (actionMatch) {
    recurrenceAction = actionMatch[1].toLowerCase() as TaskRecurrenceAction;
    rest = rest.replace(RECURRENCE_ACTION_TOKEN, ' ');
  }

  for (const pattern of DUE_PATTERNS) {
    const m = pattern.exec(rest);
    if (m) {
      due = m[1];
      rest = rest.replace(pattern, ' ');
      break;
    }
  }

  for (const [field, pattern] of OPTIONAL_DATE_TOKENS) {
    const m = pattern.exec(rest);
    if (!m) continue;
    dates[field] = m[1];
    rest = rest.replace(pattern, ' ');
  }

  for (const [pattern, level] of [...EMOJI_PRIORITY, ...BRACKET_PRIORITY]) {
    if (pattern.test(rest)) {
      priority = level;
      rest = rest.replace(pattern, ' ');
      break;
    }
  }

  if (!priority) {
    const m = BANG_PRIORITY.exec(rest);
    if (m) {
      priority = m[2].length === 3 ? 'high' : m[2].length === 2 ? 'medium' : 'low';
      rest = rest.replace(BANG_PRIORITY, ' ');
    }
  }

  const uidMatch = UID_TOKEN.exec(rest);
  if (uidMatch) {
    uid = uidMatch[1];
    rest = rest.replace(UID_TOKEN, ' ');
  }

  const recurrenceMatch = RECURRENCE_TOKEN.exec(rest);
  if (recurrenceMatch) {
    const written = recurrenceMatch[2].trim().replace(/\s+/g, ' ');
    if (LEGACY_RRULE.test(written)) {
      rrule = written.toUpperCase();
      recurrence = { text: written, kind: 'legacy', whenDone: false };
      rest = rest.replace(RECURRENCE_TOKEN, ' ');
    } else {
      const compiled = compileNaturalRecurrence(written);
      if (compiled) {
        rrule = compiled.rrule;
        recurrence = { text: written, kind: 'natural', whenDone: compiled.whenDone };
        rest = rest.replace(RECURRENCE_TOKEN, ' ');
      } else {
        // Left in the line on purpose: unreadable text is shown, not eaten.
        recurrence = { text: written, kind: 'unsupported', whenDone: false };
      }
    }
  }

  const reminderMatches = [...rest.matchAll(new RegExp(REMINDER_TOKEN.source, 'gu'))];
  if (reminderMatches.length) {
    for (const m of reminderMatches) reminders.push(m[1]);
    rest = rest.replace(new RegExp(REMINDER_TOKEN.source, 'gu'), ' ');
  }

  const tags = [...rest.matchAll(/(?:^|\s)#([\w一-鿿/-]+)/gu)].map((m) => m[1]);

  const meta: TaskMeta = {
    title: rest.replace(/\s{2,}/g, ' ').trim(),
    priority,
    due,
    tags,
    ...dates,
  };
  if (uid) meta.uid = uid;
  if (reminders.length) meta.reminders = reminders;
  if (rrule) meta.rrule = rrule;
  if (recurrence) meta.recurrence = recurrence;
  if (recurrenceAction) meta.recurrenceAction = recurrenceAction;
  return meta;
}

/** `YYYY-MM-DD` for a Date, in local time — `toISOString` would shift the day
 *  for anyone east or west of UTC, which is exactly who reports "it says my
 *  task is overdue and it isn't". */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Due strictly before today. Today itself is due, not overdue. */
export function isOverdue(due: string | null, today: string): boolean {
  return !!due && due < today;
}

export interface SortableTask {
  done: boolean;
  meta: TaskMeta;
}

/**
 * Panel order: unfinished first, then by due date (soonest, undated last),
 * then by priority, then alphabetically so the list does not shuffle between
 * renders.
 */
export function compareTasks(a: SortableTask, b: SortableTask): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const aDue = a.meta.due ?? '￿';
  const bDue = b.meta.due ?? '￿';
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  const aP = a.meta.priority ? PRIORITY_RANK[a.meta.priority] : NO_PRIORITY_RANK;
  const bP = b.meta.priority ? PRIORITY_RANK[b.meta.priority] : NO_PRIORITY_RANK;
  if (aP !== bP) return aP - bP;
  return a.meta.title.localeCompare(b.meta.title);
}

/**
 * Advance the checkbox on one line to the next status symbol.
 *
 * The symbol comes from `taskStatusRule`, not from a hard-coded `x`, so a
 * configured status table can be honoured later without changing callers. With
 * the default table this is exactly `[ ]` ↔ `[x]`; an unknown symbol (e.g.
 * `[/]`) is a TODO like in Obsidian Tasks, and toggles to `x`.
 *
 * Returns null when that line is not a task — the caller must not write the
 * file back in that case, because a mismatch means the index is stale and the
 * line now holds something else entirely.
 */
export function toggleTaskLine(content: string, line1Based: number): string | null {
  const lines = content.split('\n');
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const m = /^(\s*[-*+]\s+\[)([^\]\n])(\]\s+.*)$/u.exec(lines[idx]);
  if (!m) return null;
  lines[idx] = `${m[1]}${taskStatusRule(m[2]).next}${m[3]}`;
  return lines.join('\n');
}

/**
 * Strict trigger shapes for a token we are about to *write*.
 *
 * The parser is lenient (it must never eat text it does not understand), but a
 * new `⏰` should only be added when the scheduler can resolve it. This mirrors
 * `isValidAlarmTrigger` in `calendar-reminders.ts`; it is duplicated rather
 * than imported because `calendar.ts` already imports this module, and a
 * `tasks → calendar-reminders → calendar → tasks` cycle is worse than a dozen
 * lines of regex.
 */
function isWritableTrigger(trigger: string): boolean {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(trigger);
  if (clock) return Number(clock[1]) <= 23 && Number(clock[2]) <= 59;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(trigger)) {
    return !Number.isNaN(Date.parse(trigger));
  }
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    trigger.toUpperCase(),
  );
  if (!m) return false;
  // `P` and `PT` parse to nothing; a duration needs at least one component.
  return [m[2], m[3], m[4], m[5], m[6]].some((part) => part !== undefined);
}

/**
 * Remove every `⏰ <trigger>` together with one adjacent space.
 *
 * The adjacency rule is what keeps `ship it ⏰ 09:00` from becoming
 * `ship it ` (trailing space) or `ship it  ` (double space) — the rest of the
 * line is meant to survive byte for byte.
 */
function stripReminderTokens(body: string): string {
  const scan = new RegExp(REMINDER_TOKEN.source, 'gu');
  let out = body;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(out))) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && /[ \t]/.test(out[start - 1])) {
      out = out.slice(0, start - 1) + out.slice(end);
    } else if (end < out.length && /[ \t]/.test(out[end])) {
      out = out.slice(0, start) + out.slice(end + 1);
    } else {
      out = out.slice(0, start) + out.slice(end);
    }
    scan.lastIndex = start;
  }
  return out;
}

/**
 * Add or remove the reminder token on the task at `line1Based`.
 *
 * `trigger === null` removes every `⏰`. Otherwise the trigger replaces them,
 * and a `🆔` is injected when one is missing so the reminder keeps a stable
 * identity if the note is renamed.
 *
 * Returns the whole document, like `toggleTaskLine`, or null when the line is
 * not a task or the trigger is not writable — the caller must not write the
 * file in that case.
 */
export function setTaskReminder(
  content: string,
  line1Based: number,
  trigger: string | null,
  uid?: string,
): string | null {
  const lines = content.split('\n');
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const line = lines[idx];
  const cr = line.endsWith('\r') ? '\r' : '';
  const m = TASK_LINE.exec(cr ? line.slice(0, -1) : line);
  if (!m) return null;

  let rest = stripReminderTokens(m[2]);
  if (trigger !== null) {
    const value = trigger.trim();
    if (!isWritableTrigger(value)) return null;
    const trailing = /[ \t]*$/.exec(rest)?.[0] ?? '';
    const core = rest.slice(0, rest.length - trailing.length);
    rest = `${core} ⏰ ${value}${trailing}`;
    if (uid && !UID_TOKEN.test(rest)) rest = `${rest} 🆔 ${uid}`;
  }

  lines[idx] = `${m[1]}${rest}${cr}`;
  return lines.join('\n');
}

export interface RecurringCompletion {
  content: string;
  /** 1-based line of the new, open occurrence. */
  line: number;
}

/** The date tokens a recurring task can carry — the ones that move forward. */
export interface RecurringDates {
  due?: string;
  scheduled?: string;
  start?: string;
}

/** The due token as written, so the rewrite can keep `📅` vs `due:` spelling. */
function matchDueToken(body: string): { index: number; token: string; date: string } | null {
  for (const pattern of DUE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('i') ? 'iu' : 'u');
    const m = re.exec(body);
    if (m) return { index: m.index, token: m[0], date: m[1] };
  }
  return null;
}

/** Rewrite one date token in place, leaving every other byte alone. */
function rewriteDateToken(body: string, field: keyof RecurringDates, next: string): string | null {
  if (field === 'due') {
    const match = matchDueToken(body);
    if (!match) return null;
    return (
      body.slice(0, match.index) +
      match.token.replace(match.date, next) +
      body.slice(match.index + match.token.length)
    );
  }
  const pattern = field === 'scheduled' ? SCHEDULED_TOKEN : START_TOKEN;
  const match = pattern.exec(body);
  if (!match) return null;
  return (
    body.slice(0, match.index) +
    match[0].replace(match[1], next) +
    body.slice(match.index + match[0].length)
  );
}

/**
 * Put the `🔁` token in front of the first date token.
 *
 * Obsidian Tasks reads a recurrence best when it stands before the dates, and
 * this project writes it that way. Moving it means removing the token together
 * with the whitespace it owns and re-inserting it; every other character is
 * untouched. A line without dates keeps the rule where it was.
 */
function moveRecurrenceBeforeDates(body: string): string {
  const match = RECURRENCE_TOKEN.exec(body);
  if (!match) return body;
  const ruleText = match[2].trim();
  const rest = body.slice(0, match.index) + body.slice(match.index + match[0].length);
  const firstDate = /(?:📅|⏳|🛫|➕|✅|❌)/u.exec(rest);
  if (!firstDate) return body;
  const head = rest.slice(0, firstDate.index).replace(/\s+$/u, ' ');
  return `${head}🔁 ${ruleText} ${rest.slice(firstDate.index)}`;
}

/**
 * Complete one occurrence of a recurring task: close the old line and add the
 * next occurrence as a new open line.
 *
 * `dates` holds the already-advanced `📅` / `⏳` / `🛫` values (see
 * `nextTaskDates` in `calendar.ts`); every field present is rewritten and the
 * others are left exactly as written. `when done` is handled there, not here —
 * this function only knows where the dates go.
 *
 * The old line keeps every token it had, including `🔁`, because it is the
 * record of what was done. `🏁 delete` removes it instead; `🏁 keep` (the
 * default) keeps it and marks it done. The new line copies the body with its
 * `🆔` dropped so the two lines do not claim the same identity — a fresh one is
 * minted the next time a reminder needs it. Its `🔁` text is copied verbatim:
 * this function never serialises a rule, so a natural-language rule stays
 * natural and a legacy `FREQ=` is never introduced.
 *
 * Returns null when the line is not an open task, a date token cannot be found,
 * or the insert would be out of range — the caller must not write the file then.
 */
export function completeRecurringTaskLine(
  content: string,
  line1Based: number,
  dates: RecurringDates,
  placement: 'below' | 'above',
  action: TaskRecurrenceAction = 'keep',
): RecurringCompletion | null {
  const lines = content.split('\n');
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const line = lines[idx];
  const cr = line.endsWith('\r') ? '\r' : '';
  const m = TASK_PARTS.exec(cr ? line.slice(0, -1) : line);
  if (!m) return null;
  const rule = taskStatusRule(m[2]);
  if (rule.type === 'done') return null;

  let body = m[3];
  for (const field of ['due', 'scheduled', 'start'] as const) {
    const next = dates[field];
    if (!next) continue;
    const rewritten = rewriteDateToken(body, field, next);
    // The index said the token exists; not finding it means the file moved.
    if (rewritten === null) return null;
    body = rewritten;
  }
  body = body.replace(/\s*🆔\s*[A-Za-z0-9_-]{4,}/u, '');
  // A legacy `FREQ=` rule is moved only when it is written, never when it is
  // carried forward: the new line is the old line with its dates replaced.
  if (!/🔁\s*FREQ=/iu.test(body)) body = moveRecurrenceBeforeDates(body);

  let at: number;
  if (action === 'delete') {
    lines.splice(idx, 1, `${m[1]}[ ]${body}${cr}`);
    at = idx;
  } else {
    lines[idx] = `${m[1]}[${rule.next}]${m[3]}${cr}`;
    at = placement === 'above' ? idx : idx + 1;
    lines.splice(at, 0, `${m[1]}[ ]${body}${cr}`);
  }
  return { content: lines.join('\n'), line: at + 1 };
}
