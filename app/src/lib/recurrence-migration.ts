/**
 * Batch 4 — translate a legacy `🔁 FREQ=…` rule into Obsidian Tasks' natural
 * language.
 *
 * This module is deliberately conservative: a rule is only translated when the
 * exact same schedule can be written as a phrase this project (and Tasks)
 * understands. `COUNT=`, `UNTIL=`, `BYSETPOS`, `WKST`, hourly/minutely
 * frequencies and incompatible part combinations are reported instead of being
 * approximated — a silently different schedule is worse than an untouched line.
 *
 * The translation is verified by round-trip: the produced phrase is fed back
 * through `compileNaturalRecurrence` and must compile to the same canonical
 * rule. That makes "can be expressed" a fact about the compiler rather than a
 * hand-maintained list.
 *
 * Rewriting is byte-for-byte outside the rule text: the `🔁` token, its
 * whitespace, the rest of the line and the line ending are untouched.
 */

import { compileNaturalRecurrence } from './tasks';

export type LegacyUnsupportedReason = 'unknown-key' | 'frequency' | 'combination' | 'malformed';

export interface LegacyTranslation {
  /** The natural-language phrase, or null when there is no equivalent. */
  natural: string | null;
  /** Why the rule cannot be translated; absent when `natural` is set. */
  reason?: LegacyUnsupportedReason;
}

const DOW_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DOW_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const SUPPORTED_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTH', 'BYMONTHDAY']);
const FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

interface DaySpec {
  ordinal: number | null;
  code: string;
}

interface RuleParts {
  freq: string;
  interval: number;
  byday: DaySpec[] | null;
  bymonth: number[] | null;
  bymonthday: number[] | null;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function andList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function intList(value: string, min: number, max: number, allowNegativeOne: boolean): number[] | null {
  const out: number[] = [];
  for (const piece of value.split(',')) {
    if (!/^[+-]?\d+$/.test(piece)) return null;
    const n = Number(piece);
    if (n === -1 && allowNegativeOne) {
      out.push(-1);
      continue;
    }
    if (n < min || n > max) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

/** Parse the raw iCal value into parts, or say why it is out of scope. */
function parseRule(raw: string): { parts?: RuleParts; reason?: LegacyUnsupportedReason } {
  const segments = raw.trim().split(';');
  if (!segments.length || segments.some((s) => !s)) return { reason: 'malformed' };

  const values = new Map<string, string>();
  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq <= 0) return { reason: 'malformed' };
    const key = segment.slice(0, eq).toUpperCase();
    if (!SUPPORTED_KEYS.has(key)) return { reason: 'unknown-key' };
    if (values.has(key)) return { reason: 'malformed' };
    values.set(key, segment.slice(eq + 1));
  }

  const freq = values.get('FREQ')?.toUpperCase();
  if (!freq) return { reason: 'malformed' };
  if (!FREQUENCIES.has(freq)) return { reason: 'frequency' };

  let interval = 1;
  const rawInterval = values.get('INTERVAL');
  if (rawInterval !== undefined) {
    if (!/^\d+$/.test(rawInterval) || Number(rawInterval) < 1) return { reason: 'malformed' };
    interval = Number(rawInterval);
  }

  let byday: DaySpec[] | null = null;
  const rawByday = values.get('BYDAY');
  if (rawByday !== undefined) {
    const specs: DaySpec[] = [];
    for (const piece of rawByday.split(',')) {
      const m = /^([+-]?\d{1,2})?([A-Z]{2})$/i.exec(piece);
      if (!m) return { reason: 'malformed' };
      const code = m[2].toUpperCase();
      if (!DOW_CODES.includes(code)) return { reason: 'malformed' };
      const ordinalPart = m[1] ? Number(m[1]) : null;
      // Weekly rules cannot pin "the 2nd Tuesday"; that shape only exists in
      // monthly/yearly rules.
      if (freq === 'WEEKLY' && ordinalPart !== null) return { reason: 'combination' };
      if (specs.some((s) => s.code === code)) return { reason: 'malformed' };
      specs.push({ ordinal: ordinalPart, code });
    }
    if (!specs.length) return { reason: 'malformed' };
    if (freq !== 'WEEKLY' && specs.length > 1) return { reason: 'combination' };
    if (specs.some((s) => s.ordinal !== null && (s.ordinal < -1 || s.ordinal > 5))) {
      return { reason: 'combination' };
    }
    byday = specs;
  }

  let bymonth: number[] | null = null;
  const rawBymonth = values.get('BYMONTH');
  if (rawBymonth !== undefined) {
    bymonth = intList(rawBymonth, 1, 12, false);
    if (!bymonth) return { reason: 'malformed' };
  }

  let bymonthday: number[] | null = null;
  const rawBymonthday = values.get('BYMONTHDAY');
  if (rawBymonthday !== undefined) {
    bymonthday = intList(rawBymonthday, 1, 31, true);
    if (!bymonthday) return { reason: 'malformed' };
  }

  return { parts: { freq, interval, byday, bymonth, bymonthday } };
}

/** The spelling `compileNaturalRecurrence` would produce for these parts. */
function canonical(parts: RuleParts): string {
  const out = [`FREQ=${parts.freq}`];
  if (parts.interval > 1) out.push(`INTERVAL=${parts.interval}`);
  if (parts.byday?.length) out.push(`BYDAY=${parts.byday.map((d) => `${d.ordinal ?? ''}${d.code}`).join(',')}`);
  if (parts.bymonth?.length) out.push(`BYMONTH=${parts.bymonth.join(',')}`);
  if (parts.bymonthday?.length) out.push(`BYMONTHDAY=${parts.bymonthday.join(',')}`);
  return out.join(';');
}

function dayName(spec: DaySpec): string {
  const name = DOW_NAMES[DOW_CODES.indexOf(spec.code)];
  if (spec.ordinal === null) return name;
  if (spec.ordinal === -1) return `last ${name}`;
  return `${ordinal(spec.ordinal)} ${name}`;
}

function monthDayName(day: number): string {
  return day === -1 ? 'last day' : ordinal(day);
}

function buildPhrase(parts: RuleParts): string | null {
  const { freq, interval, byday, bymonth, bymonthday } = parts;
  const every = interval > 1 ? `every ${interval}` : 'every';

  if (freq === 'DAILY') {
    if (byday || bymonth || bymonthday) return null;
    return interval > 1 ? `${every} days` : 'every day';
  }

  if (freq === 'WEEKLY') {
    if (bymonth || bymonthday) return null;
    if (!byday) return interval > 1 ? `${every} weeks` : 'every week';
    // Keep the day order stable so the phrase reads like the calendar week.
    const sorted = [...byday].sort((a, b) => DOW_CODES.indexOf(a.code) - DOW_CODES.indexOf(b.code));
    parts.byday = sorted;
    const weekdaySet =
      interval === 1 &&
      sorted.length === 5 &&
      sorted.every((s, i) => s.code === DOW_CODES[i] && s.ordinal === null);
    if (weekdaySet) return 'every weekday';
    const days = andList(sorted.map(dayName));
    return interval > 1 ? `${every} weeks on ${days}` : `every ${days}`;
  }

  if (freq === 'MONTHLY') {
    if (bymonth) return null;
    if (byday && bymonthday) return null;
    if (bymonthday) {
      const days = `the ${andList(bymonthday.map(monthDayName))}`;
      return interval > 1 ? `${every} months on ${days}` : `every month on ${days}`;
    }
    if (byday) {
      const spec = byday[0];
      if (spec.ordinal === null) {
        // "every month on monday" is not a documented Tasks shape; the 1st
        // Monday of a month is what everyone means, but that is 1MO.
        return null;
      }
      const day = `the ${dayName(spec)}`;
      return interval > 1 ? `${every} months on ${day}` : `every month on ${day}`;
    }
    return interval > 1 ? `${every} months` : 'every month';
  }

  // YEARLY
  if (bymonthday) {
    if (!bymonth || bymonth.length !== 1) return null;
    if (interval > 1) return null;
    if (bymonthday.length !== 1) return null;
    return `every ${MONTH_NAMES[bymonth[0] - 1]} ${monthDayName(bymonthday[0])}`;
  }
  if (byday) {
    // Tasks' documented yearly spellings do not include "the 2nd Tuesday of
    // January"; refuse rather than invent one.
    return null;
  }
  if (!bymonth) return interval > 1 ? `${every} years` : 'every year';
  if (bymonth.length !== 1) return null;
  if (interval > 1) return null;
  return `every ${MONTH_NAMES[bymonth[0] - 1]}`;
}

/**
 * Translate one legacy rule.
 *
 * `natural` is only set when the phrase compiles back to the same canonical
 * rule — the round-trip is the definition of "Tasks can express this".
 */
export function translateLegacyRecurrence(raw: string): LegacyTranslation {
  const parsed = parseRule(raw);
  if (!parsed.parts) return { natural: null, reason: parsed.reason ?? 'malformed' };
  const phrase = buildPhrase(parsed.parts);
  if (!phrase) return { natural: null, reason: 'combination' };
  const compiled = compileNaturalRecurrence(phrase);
  if (!compiled || compiled.rrule !== canonical(parsed.parts)) {
    return { natural: null, reason: 'combination' };
  }
  return { natural: phrase };
}

/** Convenience wrapper: the phrase, or null. */
export function naturalRecurrenceFromLegacy(raw: string): string | null {
  return translateLegacyRecurrence(raw).natural;
}

export interface LegacyLineConversion {
  /** The rule as written, trimmed. */
  rule: string;
  /** Natural-language replacement, or null when it cannot be expressed. */
  natural: string | null;
  reason?: LegacyUnsupportedReason;
  before: string;
  /** The rewritten line, or null when nothing should be written. */
  after: string | null;
}

/** `🔁` plus the rule, stopping at the next token the task parser knows. */
const RULE_TOKEN =
  /🔁[ \t]*([\s\S]*?)(?=\s*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⏰|🏁|#)\s*|$)/u;

/**
 * Convert the `🔁` rule on one line.
 *
 * Everything outside the trimmed rule text is preserved exactly: the `🔁`
 * glyph, the spaces around it (including trailing spaces after the rule), the
 * dates, `🆔`/`⏰`, the indentation and the line ending (the caller keeps CR).
 * Returns null when the line has no recurrence or it is not a legacy `FREQ=`
 * rule.
 */
export function convertLegacyRecurrenceLine(line: string): LegacyLineConversion | null {
  const m = RULE_TOKEN.exec(line);
  if (!m) return null;
  const written = m[1];
  const rule = written.trim();
  if (!/^FREQ=/i.test(rule)) return null;
  const translation = translateLegacyRecurrence(rule);
  if (!translation.natural) {
    return { rule, natural: null, reason: translation.reason, before: line, after: null };
  }
  const writtenStart = m.index + m[0].length - written.length;
  const start = writtenStart + (written.length - written.trimStart().length);
  const next = line.slice(0, start) + translation.natural + line.slice(start + rule.length);
  return { rule, natural: translation.natural, before: line, after: next };
}

export interface RecurrenceConversion {
  /** 1-based line number, front matter included. */
  line: number;
  /** The line as it was when the preview was built, without the CR. */
  before: string;
  after: string;
}

/**
 * Apply conversions to a file's text.
 *
 * A conversion is only applied when the line still reads exactly as the
 * preview showed; a stale index or a concurrent edit is reported, never
 * overwritten. CRLF is preserved per line.
 */
export function applyRecurrenceConversions(
  content: string,
  conversions: RecurrenceConversion[],
): { content: string; applied: number; skipped: number[] } {
  const lines = content.split('\n');
  let applied = 0;
  const skipped: number[] = [];
  for (const conversion of conversions) {
    const index = conversion.line - 1;
    const current = lines[index];
    if (current === undefined) {
      skipped.push(conversion.line);
      continue;
    }
    const cr = current.endsWith('\r') ? '\r' : '';
    const bare = cr ? current.slice(0, -1) : current;
    if (bare !== conversion.before) {
      skipped.push(conversion.line);
      continue;
    }
    lines[index] = conversion.after + cr;
    applied++;
  }
  return { content: lines.join('\n'), applied, skipped };
}
