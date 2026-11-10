/**
 * Natural-language dates typed straight onto a task line ("明天", "下周三",
 * "next monday", "15:00-16:00") → the standard tokens the rest of the app
 * reads (`📅`, `⏳`, `🛫`, `⏰`).
 *
 * This is a *parser*, not a text rewriter: it returns the exact ranges to
 * change, so the caller replaces only the phrase that was understood and the
 * rest of the line — indentation, extra spaces, unknown tokens — stays byte for
 * byte as it was. The keyword in front (`截止`, `计划`, `开始` / `due`,
 * `scheduled`, `start`) chooses the field and is left in the title.
 *
 * Only phrases at the end of what has been typed so far are considered, which
 * is what someone finishing a task line actually produces and what keeps prose
 * like "明天见" from being rewritten mid-sentence.
 */

export type TaskDateField = 'due' | 'scheduled' | 'start';

export interface TaskDateChange {
  /** Offsets inside the line prefix handed to `naturalDateChanges`. */
  from: number;
  to: number;
  insert: string;
}

const WEEKDAY_CN: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
};

const WEEKDAY_EN: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
};

const pad = (n: number) => String(n).padStart(2, '0');

function toKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function keyOf(ms: number): string {
  const date = new Date(ms);
  return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(key: string, n: number): string {
  const { y, m, d } = parts(key);
  return keyOf(Date.UTC(y, m - 1, d) + n * 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(key: string): number {
  const { y, m, d } = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function startOfWeek(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift by whole months, clamping the day like `calendar.ts::shiftMonth`. */
function shiftMonth(key: string, delta: number): string {
  const { y, m, d } = parts(key);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return toKey(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

function monthEnd(key: string, delta = 0): string {
  const { y, m } = parts(key);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return toKey(ny, nm, lastDayOfMonth(ny, nm));
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (d > lastDayOfMonth(y, m)) return null;
  return toKey(y, m, d);
}

function timeToken(hour: string, minute?: string): string | null {
  const h = Number(hour);
  const min = Number(minute ?? '0');
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

interface Phrase {
  start: number;
  end: number;
  /** `YYYY-MM-DD` when the phrase carries a date. */
  date?: string;
  /** `HH:mm` when the phrase carries a time. */
  time?: string;
}

/** The character before a phrase must end a word: space, punctuation or start. */
function bounded(text: string, start: number): boolean {
  if (start === 0) return true;
  return /[\s，,。;；、]/u.test(text[start - 1]);
}

const DATE_MARKERS: Record<TaskDateField, string> = {
  due: '📅',
  scheduled: '⏳',
  start: '🛫',
};

const FIELD_TOKENS: Record<TaskDateField, RegExp> = {
  due: /📅\s*\d{4}-\d{2}-\d{2}/u,
  scheduled: /⏳\s*\d{4}-\d{2}-\d{2}/u,
  start: /🛫\s*\d{4}-\d{2}-\d{2}/u,
};

const REMINDER = /⏰\s*(-?P[A-Za-z0-9]+|[0-9]{1,2}:[0-9]{2}|\d{4}-\d{2}-\d{2}T[0-9:]+Z?)/u;

function matchPhrase(text: string, today: string): Phrase | null {
  const at = (m: RegExpExecArray, extra: Partial<Phrase> = {}): Phrase | null => {
    const start = m.index;
    if (!bounded(text, start)) return null;
    return { start, end: start + m[0].length, ...extra };
  };

  // Time ranges first: "15:00-16:00" must not be read as something else.
  let m = /(\d{1,2}):(\d{2})\s*[-~—–至到]\s*(\d{1,2}):(\d{2})$/u.exec(text);
  if (m) {
    const time = timeToken(m[1], m[2]);
    if (time) return at(m, { time });
  }
  m = /(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)\s*[-~to至到]+\s*(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)$/iu.exec(text);
  if (m) {
    let hour = Number(m[1]);
    const isPm = /pm/iu.test(m[0]);
    if (isPm && hour < 12) hour += 12;
    const time = timeToken(String(hour), m[2]);
    if (time) return at(m, { time });
  }
  m = /(\d{1,2}):(\d{2})$/u.exec(text);
  if (m) {
    const time = timeToken(m[1], m[2]);
    if (time) return at(m, { time });
  }

  // Chinese dates, longest spellings first.
  m = /(?:大后天)$/u.exec(text);
  if (m) return at(m, { date: addDays(today, 3) });
  m = /(?:后天)$/u.exec(text);
  if (m) return at(m, { date: addDays(today, 2) });
  m = /(?:明天|明日)$/u.exec(text);
  if (m) return at(m, { date: addDays(today, 1) });
  m = /(?:今天|今日)$/u.exec(text);
  if (m) return at(m, { date: today });

  m = /下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])$/u.exec(text);
  if (m) return at(m, { date: addDays(startOfWeek(today), 7 + WEEKDAY_CN[m[1]]) });

  m = /(?:本|这)(?:周|星期|礼拜)([一二三四五六日天])$/u.exec(text);
  if (m) return at(m, { date: addDays(startOfWeek(today), WEEKDAY_CN[m[1]]) });

  m = /(?:周|星期|礼拜)([一二三四五六日天])$/u.exec(text);
  if (m) {
    const diff = (WEEKDAY_CN[m[1]] - weekdayIndex(today) + 7) % 7;
    return at(m, { date: addDays(today, diff) });
  }

  m = /下(?:个)?月(?:底|末)$/u.exec(text);
  if (m) return at(m, { date: monthEnd(today, 1) });
  m = /(?:月)(?:底|末)$/u.exec(text);
  if (m) return at(m, { date: monthEnd(today) });
  m = /下(?:个)?月$/u.exec(text);
  if (m) return at(m, { date: shiftMonth(today, 1) });
  m = /下(?:个)?月(\d{1,2})[日号]$/u.exec(text);
  if (m) {
    const next = parts(shiftMonth(today, 1));
    const date = validDate(next.y, next.m, Number(m[1]));
    if (date) return at(m, { date });
  }

  m = /(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (m) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) return at(m, { date });
  }

  m = /(\d{1,2})月(\d{1,2})[日号]$/u.exec(text);
  if (m) {
    const date = validDate(parts(today).y, Number(m[1]), Number(m[2]));
    if (date) return at(m, { date });
  }

  m = /(\d{1,2})[日号]$/u.exec(text);
  if (m) {
    const { y, m: month } = parts(today);
    const date = validDate(y, month, Number(m[1]));
    if (date) return at(m, { date });
  }

  // English.
  m = /\bday after tomorrow$/iu.exec(text);
  if (m) return at(m, { date: addDays(today, 2) });
  m = /\btomorrow$/iu.exec(text);
  if (m) return at(m, { date: addDays(today, 1) });
  m = /\btoday$/iu.exec(text);
  if (m) return at(m, { date: today });
  m = /\bin\s+(\d+)\s+days?$/iu.exec(text);
  if (m) return at(m, { date: addDays(today, Number(m[1])) });
  m = /\bin\s+(\d+)\s+weeks?$/iu.exec(text);
  if (m) return at(m, { date: addDays(today, Number(m[1]) * 7) });
  m = /\bnext\s+week$/iu.exec(text);
  if (m) return at(m, { date: addDays(today, 7) });
  m = /\bnext\s+month$/iu.exec(text);
  if (m) return at(m, { date: shiftMonth(today, 1) });
  m = /\bnext\s+year$/iu.exec(text);
  if (m) return at(m, { date: shiftMonth(today, 12) });
  m = /\b(?:end of (?:the )?month|month end|eom)$/iu.exec(text);
  if (m) return at(m, { date: monthEnd(today) });
  m = /\bnext\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)$/iu.exec(
    text,
  );
  if (m) return at(m, { date: addDays(startOfWeek(today), 7 + WEEKDAY_EN[m[1].toLowerCase()]) });
  m = /\bthis\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)$/iu.exec(
    text,
  );
  if (m) return at(m, { date: addDays(startOfWeek(today), WEEKDAY_EN[m[1].toLowerCase()]) });

  return null;
}

function fieldBefore(text: string, start: number): TaskDateField {
  const before = text.slice(0, start).replace(/[ \t]+$/u, '');
  if (/(?:截止|到期|due|deadline)$/iu.test(before)) return 'due';
  if (/(?:计划|安排|scheduled)$/iu.test(before)) return 'scheduled';
  if (/(?:开始|start)$/iu.test(before)) return 'start';
  return 'due';
}

/**
 * Changes that turn the trailing natural-language date on a task line into the
 * canonical token(s).
 *
 * `prefix` is the line from its start up to the caret. Returns null when the
 * prefix is not a task, or does not end with a phrase we understand — in which
 * case nothing at all should be written.
 */
export function naturalDateChanges(prefix: string, today: string): TaskDateChange[] | null {
  if (!/^\s*[-*+][ \t]+\[[^\]\n]\][ \t]/u.test(prefix)) return null;
  const trimmed = prefix.replace(/[ \t]+$/u, '');
  const phrase = matchPhrase(trimmed, today);
  if (!phrase) return null;

  const changes: TaskDateChange[] = [{ from: phrase.start, to: phrase.end, insert: '' }];

  if (!phrase.date && phrase.time) {
    const existing = REMINDER.exec(trimmed);
    if (existing) {
      changes.push({
        from: existing.index,
        to: existing.index + existing[0].length,
        insert: `⏰ ${phrase.time}`,
      });
    } else {
      changes[0].insert = `⏰ ${phrase.time}`;
    }
    return changes;
  }
  if (!phrase.date) return null;

  const field = fieldBefore(trimmed, phrase.start);
  const token = `${DATE_MARKERS[field]} ${phrase.date}`;
  const existing = FIELD_TOKENS[field].exec(trimmed);
  if (existing && existing.index < phrase.start) {
    changes.push({
      from: existing.index,
      to: existing.index + existing[0].length,
      insert: token,
    });
    return changes;
  }

  // Keep `🔁` ahead of the dates even when the rule was written after the text.
  const rule = trimmed.search(/🔁/u);
  if (rule >= 0 && rule < phrase.start) {
    changes.push({ from: rule, to: rule, insert: `${token} ` });
  } else {
    changes[0].insert = token;
  }
  return changes;
}
