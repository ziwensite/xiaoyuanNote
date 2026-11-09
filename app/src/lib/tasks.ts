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

export type TaskPriority = 'high' | 'medium' | 'low' | null;

export interface TaskMeta {
  /** Display text, with the tokens this module consumed removed. */
  title: string;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, or null. */
  due: string | null;
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
}

const PRIORITY_RANK: Record<Exclude<TaskPriority, null>, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** `2026-09-10` and nothing else — no `10/09/2026` ambiguity to guess at. */
const DATE = /(\d{4}-\d{2}-\d{2})/;

const DUE_PATTERNS: RegExp[] = [
  new RegExp(`📅\\s*${DATE.source}`, 'u'),
  new RegExp(`\\bdue\\s*:\\s*${DATE.source}`, 'iu'),
];

const EMOJI_PRIORITY: Array<[RegExp, Exclude<TaskPriority, null>]> = [
  [/⏫/u, 'high'],
  [/🔼/u, 'medium'],
  [/🔽/u, 'low'],
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
 *   - `🔁 FREQ=…` — a raw iCal RRULE (no spaces inside it).
 *
 * Malformed values are left in `title` on purpose, matching the rule that the
 * parser never eats words it does not understand.
 */
const UID_TOKEN = /🆔\s*([A-Za-z0-9_-]{4,})/u;
const REMINDER_TOKEN = /⏰\s*(-?P[A-Za-z0-9]+|[0-9]{1,2}:[0-9]{2}|\d{4}-\d{2}-\d{2}T[0-9:]+Z?)/u;
const RRULE_TOKEN = /🔁\s*(FREQ=[A-Za-z0-9=;,:+-]+)/iu;

const TASK_LINE = /^(\s*[-*+]\s+\[[ xX]\])(.*)$/u;

export function parseTaskMeta(text: string): TaskMeta {
  let rest = text;
  let priority: TaskPriority = null;
  let due: string | null = null;
  let uid: string | undefined;
  let rrule: string | undefined;
  const reminders: string[] = [];

  for (const pattern of DUE_PATTERNS) {
    const m = pattern.exec(rest);
    if (m) {
      due = m[1];
      rest = rest.replace(pattern, ' ');
      break;
    }
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

  const rruleMatch = RRULE_TOKEN.exec(rest);
  if (rruleMatch) {
    rrule = rruleMatch[1].toUpperCase();
    rest = rest.replace(RRULE_TOKEN, ' ');
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
  };
  if (uid) meta.uid = uid;
  if (reminders.length) meta.reminders = reminders;
  if (rrule) meta.rrule = rrule;
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
  const aP = a.meta.priority ? PRIORITY_RANK[a.meta.priority] : 3;
  const bP = b.meta.priority ? PRIORITY_RANK[b.meta.priority] : 3;
  if (aP !== bP) return aP - bP;
  return a.meta.title.localeCompare(b.meta.title);
}

/**
 * Flip `[ ]` ↔ `[x]` on one line of a document.
 *
 * Returns null when that line is not a task — the caller must not write the
 * file back in that case, because a mismatch means the index is stale and the
 * line now holds something else entirely.
 */
export function toggleTaskLine(content: string, line1Based: number): string | null {
  const lines = content.split('\n');
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const m = /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/.exec(lines[idx]);
  if (!m) return null;
  lines[idx] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}`;
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

