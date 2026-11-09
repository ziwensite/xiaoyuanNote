/**
 * M0 — calendar data model (events + tasks) on top of the existing Markdown
 * index.
 *
 * Design contract (see `docs/calendar-pane-plan.md` §3):
 *
 *   - Events are ordinary `.md` notes with `type: event` frontmatter. The
 *     frontmatter holds the structured fields (iCal-shaped); the body is the
 *     event description and is never rewritten by this module.
 *   - Tasks stay in note bodies as `- [ ]` lines. Their calendar metadata is
 *     the optional inline syntax parsed by `lib/tasks.ts`.
 *   - "Now" and bucketing are wall-clock based: an event at 09:00 belongs to
 *     the 09:00 day in its own `tzid`, regardless of where the device is.
 *     `wallTimeToUtc` is the only place where a wall time becomes an instant.
 *
 * Everything here is pure (no Tauri calls) so it can be unit-tested with
 * `node --test` and reused by the pane in M1.
 */
import { dumpFrontmatter, patchFrontmatter, splitFrontmatter } from './frontmatter';
import { compareTasks, parseTaskMeta, type TaskPriority } from './tasks';

export type EventStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
export type CalendarSource = 'local' | 'caldav' | 'graph';

/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm[:ss][Z|±HH:mm]`. */
export type CalendarWallTime = string;

export interface CalendarAlarm {
  /** iCal `TRIGGER`: `-PT15M`, `09:00`, or an absolute ISO timestamp. */
  trigger: string;
  /** iCal `ACTION`; defaults to `DISPLAY`. */
  action: string;
}

export interface CalendarEvent {
  kind: 'event';
  uid: string;
  summary: string;
  /** Verbatim note body. */
  description: string;
  /**
   * Editor "notes" field, stored as iCal `description:` frontmatter. Optional
   * so events that only carry a body stay valid; the body is never rewritten.
   */
  notes?: string | null;
  dtstart: CalendarWallTime;
  dtend: CalendarWallTime | null;
  tzid: string | null;
  allDay: boolean;
  status: EventStatus;
  categories: string[];
  location: string | null;
  rrule: string | null;
  exdate: CalendarWallTime[];
  /** Set on an exception instance: the master event's UID. */
  seriesUid: string | null;
  /** Set on an exception instance: the original start it replaces. */
  recurrenceId: CalendarWallTime | null;
  alarms: CalendarAlarm[];
  relatedNote: string | null;
  source: CalendarSource;
  remoteHref: string | null;
  etag: string | null;
  sequence: number;
  path: string;
  mtime: number;
}

export interface CalendarTask {
  kind: 'task';
  uid: string | null;
  title: string;
  done: boolean;
  /** `YYYY-MM-DD`, or null. */
  due: string | null;
  priority: TaskPriority;
  reminders: string[];
  rrule: string | null;
  path: string;
  line: number;
  mtime: number;
}

export interface CalendarOccurrence {
  kind: 'event';
  eventUid: string;
  path: string;
  summary: string;
  allDay: boolean;
  /** Start in the event's own wall clock. */
  start: CalendarWallTime;
  /** End in the event's own wall clock; null for timed events without DTEND. */
  end: CalendarWallTime | null;
  /** UTC instant for sorting/notifications; null for floating times. */
  startUtc: string | null;
  endUtc: string | null;
  source: CalendarEvent;
}

export interface CalendarDay {
  /** `YYYY-MM-DD`, local wall date. */
  date: string;
  events: CalendarOccurrence[];
  tasks: CalendarTask[];
}

export interface CalendarIndex {
  /** One bucket per date in the requested window, including empty days. */
  days: CalendarDay[];
  /** Tasks with no due date (they never land on the grid). */
  undatedTasks: CalendarTask[];
}

/** Minimal shape shared with `stores/workspaceIndex.ts::IndexEntry`. */
export interface CalendarEntry {
  path: string;
  name?: string;
  stem?: string;
  mtime?: number;
  title?: string | null;
  summary?: string;
  frontmatter: Record<string, unknown> | null;
  tasks?: Array<{ line: number; text: string; done: boolean }>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;

const MANAGED_EVENT_KEYS = [
  'type',
  'uid',
  'dtstamp',
  'dtstart',
  'dtend',
  'tzid',
  'all_day',
  'summary',
  'description',
  'location',
  'status',
  'categories',
  'rrule',
  'exdate',
  'series_uid',
  'recurrence_id',
  'alarms',
  'related_note',
  'source',
  'remote_href',
  'etag',
  'sequence',
] as const;

// ---------------------------------------------------------------------------
// Small date helpers (wall-clock, no timezone conversion)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` + `n` days (UTC arithmetic so DST never shifts the date). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Shift by whole months, keeping the day-of-month (clamped to the target
 * month's length). Used by both month navigators so they cannot disagree.
 */
export function shiftMonth(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  // 0 = Monday … 6 = Sunday, matching iCal BYDAY order.
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

interface WallParts {
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
}

function wallParts(value: CalendarWallTime): WallParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    hasTime: m[4] !== undefined,
  };
}

/** Canonical, zone-less wall string used for comparisons. */
export function canonicalWall(value: CalendarWallTime): string | null {
  const p = wallParts(value);
  if (!p) return null;
  if (!p.hasTime) return `${p.date}T00:00:00`;
  return `${p.date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

function dateTimeFromDateParts(p: WallParts, date: string): string {
  return p.hasTime
    ? `${date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : date;
}

function timeMinutesBetween(start: CalendarWallTime, end: CalendarWallTime): number {
  const a = wallParts(start);
  const b = wallParts(end);
  if (!a || !b) return 0;
  return (b.hour * 60 + b.minute) - (a.hour * 60 + a.minute);
}

/** Accept string or a `Date` produced by js-yaml's timestamp schema. */
export function normalizeWallTime(value: unknown): CalendarWallTime | null {
  if (typeof value === 'string') {
    const v = value.trim();
    if (!DATE_ONLY.test(v) && !DATE_TIME.test(v)) return null;
    return v;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // js-yaml parses an unquoted `2026-11-07T09:00:00` as UTC; keep those
    // components so the round-trip is lossless for the common case.
    const iso = value.toISOString();
    // A bare `2026-11-07` scalar becomes UTC midnight — treat it as a date so
    // an unquoted all-day event is not misread as 00:00 on that day.
    if (iso.slice(11, 19) === '00:00:00' && iso.endsWith('.000Z')) {
      return iso.slice(0, 10);
    }
    return iso.slice(0, 19) + (iso.endsWith('.000Z') ? '' : 'Z');
  }
  return null;
}

// -------------------------------------------------------------------------
// Timezone conversion (only used for instants/reminders, never for bucketing)
// -------------------------------------------------------------------------

function offsetMsAt(tzid: string, utcMs: number): number | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(
      fmt
        .formatToParts(new Date(utcMs))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - utcMs;
  } catch {
    return null;
  }
}

/**
 * Convert a wall time to an absolute UTC instant.
 *
 * - Explicit `Z`/offset input is already an instant → normalized.
 * - Naive time + `tzid` → resolved in that zone (DST-aware via `Intl`).
 * - Naive/floating time without a zone → interpreted in the device's local
 *   zone, which is what a user typing "09:00" means.
 */
export function wallTimeToUtc(
  value: CalendarWallTime,
  tzid?: string | null,
): string | null {
  const p = wallParts(value);
  if (!p) return null;

  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : new Date(ts).toISOString();
  }

  if (!tzid) {
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second).toISOString();
  }

  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const first = offsetMsAt(tzid, naive);
  if (first === null) return null;
  const guess = naive - first;
  const second = offsetMsAt(tzid, guess);
  if (second === null) return null;
  return new Date(naive - second).toISOString();
}

// -------------------------------------------------------------------------
// RRULE (the subset the pane needs; full RFC 5545 expansion is a non-goal)
// -------------------------------------------------------------------------

export interface ByDaySpec {
  /** 0 = Monday … 6 = Sunday, matching `dayOfWeek`. */
  day: number;
  /** `2` for `2TU`, `-1` for `-1FR`, `null` for a plain `TU`. */
  ordinal: number | null;
}

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: string | null;
  /** Weekdays with ordinals removed; kept for callers that only need the set. */
  byDay: number[] | null;
  /** BYDAY tokens as written, including month/year ordinals such as `2TU`. */
  byDaySpecs: ByDaySpec[] | null;
  byMonthDay: number[] | null;
  byMonth: number[] | null;
  /** 1-based (or negative from the end) selectors inside each period. */
  bySetPos: number[] | null;
  wkst: number;
  /**
   * Parts of the rule this parser could not honour. Expansion still runs on
   * the supported subset, but the UI must show these: silently computing a
   * different date is worse than admitting the rule is only partly read.
   */
  unsupported: string[];
}

const WEEKDAYS: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

const SUPPORTED_RRULE_KEYS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'WKST',
]);

const BYDAY_TOKEN = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

/** Accept the compact RFC 5545 `YYYYMMDD[THHMMSSZ]` form as well. */
function normalizeUntil(raw: string): string | null {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
  const compactTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (compactTime) {
    return `${compactTime[1]}-${compactTime[2]}-${compactTime[3]}T${compactTime[4]}:${compactTime[5]}:${compactTime[6]}${compactTime[7] ?? ''}`;
  }
  return DATE_ONLY.test(raw) || DATE_TIME.test(raw) ? raw : null;
}

export interface RRuleExplanation {
  rule: RecurrenceRule | null;
  /** Tokens dropped by the parser; empty when the rule is fully understood. */
  unsupported: string[];
}

/**
 * Parse `FREQ=…` plus the subset of RRULE parts the calendar can expand.
 *
 * Anything outside the subset is recorded in `unsupported` and the rest of the
 * rule still expands — a partial result with a visible warning beats both a
 * silent downgrade and refusing to show the series at all.
 */
export function explainRRule(value: string | null): RRuleExplanation {
  const unsupported: string[] = [];
  if (!value) return { rule: null, unsupported };

  const parts: Record<string, string> = {};
  for (const chunk of value.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      unsupported.push(trimmed.toUpperCase());
      continue;
    }
    const key = trimmed.slice(0, eq).trim().toUpperCase();
    const val = trimmed.slice(eq + 1).trim().toUpperCase();
    if (!SUPPORTED_RRULE_KEYS.has(key)) {
      unsupported.push(val ? `${key}=${val}` : key);
      continue;
    }
    parts[key] = val;
  }

  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    unsupported.push(freq ? `FREQ=${freq}` : 'FREQ');
    return { rule: null, unsupported };
  }

  let interval = 1;
  if (parts.INTERVAL) {
    const n = Number(parts.INTERVAL);
    if (!Number.isInteger(n) || n < 1) unsupported.push(`INTERVAL=${parts.INTERVAL}`);
    else interval = n;
  }

  let count: number | null = null;
  if (parts.COUNT) {
    const n = Number(parts.COUNT);
    if (!Number.isInteger(n) || n < 1) unsupported.push(`COUNT=${parts.COUNT}`);
    else count = n;
  }

  let until: string | null = null;
  if (parts.UNTIL) {
    until = normalizeUntil(parts.UNTIL);
    if (!until) unsupported.push(`UNTIL=${parts.UNTIL}`);
  }

  const specs: ByDaySpec[] = [];
  if (parts.BYDAY) {
    for (const token of parts.BYDAY.split(',').map((t) => t.trim()).filter(Boolean)) {
      const m = BYDAY_TOKEN.exec(token);
      if (!m) {
        unsupported.push(`BYDAY=${token}`);
        continue;
      }
      let ordinal = m[1] ? Number(m[1]) : null;
      if (ordinal !== null && (ordinal === 0 || Math.abs(ordinal) > 53)) {
        unsupported.push(`BYDAY=${token}`);
        ordinal = null;
      }
      if (ordinal !== null && (freq === 'DAILY' || freq === 'WEEKLY')) {
        // Nth-weekday only means something inside a month or a year. Drop the
        // ordinal, keep the weekday, and tell the user we did.
        unsupported.push(`BYDAY=${token}`);
        ordinal = null;
      }
      specs.push({ day: WEEKDAYS[m[2]], ordinal });
    }
  }

  const byMonthDay: number[] = [];
  if (parts.BYMONTHDAY) {
    for (const token of parts.BYMONTHDAY.split(',').map((t) => t.trim()).filter(Boolean)) {
      const n = Number(token);
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 31) {
        unsupported.push(`BYMONTHDAY=${token}`);
      } else {
        byMonthDay.push(n);
      }
    }
  }

  const byMonth: number[] = [];
  if (parts.BYMONTH) {
    for (const token of parts.BYMONTH.split(',').map((t) => t.trim()).filter(Boolean)) {
      const n = Number(token);
      if (!Number.isInteger(n) || n < 1 || n > 12) unsupported.push(`BYMONTH=${token}`);
      else byMonth.push(n);
    }
  }

  let bySetPos: number[] | null = null;
  if (parts.BYSETPOS) {
    const values: number[] = [];
    for (const token of parts.BYSETPOS.split(',').map((t) => t.trim()).filter(Boolean)) {
      const n = Number(token);
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 366) {
        unsupported.push(`BYSETPOS=${token}`);
      } else {
        values.push(n);
      }
    }
    // RFC 5545: BYSETPOS needs another BY* rule to select from, and a daily
    // period has at most one candidate.
    if (!specs.length && !byMonthDay.length && !byMonth.length) {
      unsupported.push(`BYSETPOS=${parts.BYSETPOS}`);
    } else if (freq === 'DAILY') {
      unsupported.push(`BYSETPOS=${parts.BYSETPOS}`);
    } else {
      bySetPos = values.length ? values : null;
    }
  }

  const byDaySpecs = specs.length ? specs : null;
  const byDay = specs.length ? [...new Set(specs.map((s) => s.day))] : null;

  let wkst = 0;
  if (parts.WKST) {
    const w = WEEKDAYS[parts.WKST];
    if (w === undefined) unsupported.push(`WKST=${parts.WKST}`);
    else wkst = w;
  }

  if (byDaySpecs && byMonthDay.length && freq === 'MONTHLY') {
    // BYDAY + BYMONTHDAY is legal but rare; the intersection we compute is
    // right only for plain weekdays, so warn about the combination.
    unsupported.push('BYDAY+BYMONTHDAY');
  }

  return {
    rule: {
      freq,
      interval,
      count,
      until,
      byDay,
      byDaySpecs,
      byMonthDay: byMonthDay.length ? byMonthDay : null,
      byMonth: byMonth.length ? byMonth : null,
      bySetPos,
      wkst,
      unsupported,
    },
    unsupported,
  };
}

/** Parse a raw `FREQ=…` string; null means nothing could be expanded. */
export function parseRRule(rule: string | null): RecurrenceRule | null {
  return explainRRule(rule).rule;
}

/** Non-empty when the rule is only partly understood — the UI must show it. */
export function rruleWarningTokens(rule: string | null): string[] {
  return explainRRule(rule).unsupported;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const max = daysInMonth(year, month);
  if (day > max) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// -------------------------------------------------------------------------
// Event parsing
// --------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  }
  const s = str(value);
  return s ? s.split(',').map((v) => v.trim()).filter(Boolean) : [];
}

function wallList(value: unknown): CalendarWallTime[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => normalizeWallTime(v))
      .filter((v): v is string => v !== null);
  }
  const s = str(value);
  if (!s) return [];
  return s
    .split(',')
    .map((v) => normalizeWallTime(v))
    .filter((v): v is string => v !== null);
}

function parseAlarms(value: unknown): CalendarAlarm[] {
  if (!Array.isArray(value)) return [];
  const out: CalendarAlarm[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      out.push({ trigger: item, action: 'DISPLAY' });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const trigger = str(obj.trigger);
      if (!trigger) continue;
      out.push({ trigger, action: str(obj.action) ?? 'DISPLAY' });
    }
  }
  return out;
}

function statusOf(value: unknown): EventStatus {
  const s = str(value)?.toUpperCase();
  return s === 'TENTATIVE' || s === 'CANCELLED' ? s : 'CONFIRMED';
}

function sourceOf(value: unknown): CalendarSource {
  const s = str(value)?.toLowerCase();
  return s === 'caldav' || s === 'graph' ? s : 'local';
}

function fnv1a(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable local UID for a note that has no explicit `uid:` yet. */
export function localUidForPath(path: string): string {
  return `local-${fnv1a(path)}`;
}

interface ParseEventOptions {
  path: string;
  body?: string;
  mtime?: number;
  fallbackTitle?: string | null;
}

/**
 * Build a `CalendarEvent` from parsed frontmatter.
 *
 * Tolerant by design: missing optional fields get defaults; a missing/invalid
 * `dtstart`, a non-event `type`, or malformed alarms simply degrade or return
 * null instead of throwing.
 */
export function eventFromFrontmatter(
  fm: Record<string, unknown> | null,
  opts: ParseEventOptions,
): CalendarEvent | null {
  if (!fm) return null;
  if (String(fm.type ?? '').toLowerCase() !== 'event') return null;

  const start = normalizeWallTime(fm.dtstart ?? fm.start);
  if (!start) return null;

  const allDay = bool(fm.all_day) || isDateOnly(start);
  let end = normalizeWallTime(fm.dtend ?? fm.end);
  if (allDay) {
    if (end && !isDateOnly(end)) end = end.slice(0, 10);
    if (!end) end = addDays(start.slice(0, 10), 1);
  }

  const fallback = opts.fallbackTitle ?? null;
  const summary = str(fm.summary) ?? str(fm.title) ?? fallback ?? '';

  return {
    kind: 'event',
    uid: str(fm.uid) ?? localUidForPath(opts.path),
    summary,
    description: opts.body ?? '',
    notes: str(fm.description),
    dtstart: start,
    dtend: end,
    tzid: str(fm.tzid) ?? str(fm.timezone),
    allDay,
    status: statusOf(fm.status),
    categories: stringList(fm.categories),
    location: str(fm.location),
    rrule: str(fm.rrule),
    exdate: wallList(fm.exdate),
    seriesUid: str(fm.series_uid),
    recurrenceId: normalizeWallTime(fm.recurrence_id),
    alarms: parseAlarms(fm.alarms),
    relatedNote: str(fm.related_note),
    source: sourceOf(fm.source),
    remoteHref: str(fm.remote_href),
    etag: str(fm.etag),
    sequence: num(fm.sequence),
    path: opts.path,
    mtime: opts.mtime ?? 0,
  };
}

/** Parse a note's full text; the body is preserved verbatim. */
export function parseCalendarEvent(
  path: string,
  text: string,
  mtime = 0,
  fallbackTitle?: string | null,
): CalendarEvent | null {
  const { data, body } = splitFrontmatter(text);
  const bare = path.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');
  return eventFromFrontmatter(data, {
    path,
    body,
    mtime,
    fallbackTitle: fallbackTitle ?? bare,
  });
}

/** Project an index entry (frontmatter only — no note body available). */
export function calendarEventFromEntry(entry: CalendarEntry): CalendarEvent | null {
  return eventFromFrontmatter(entry.frontmatter, {
    path: entry.path,
    mtime: entry.mtime ?? 0,
    fallbackTitle: entry.title ?? entry.name ?? entry.stem ?? null,
  });
}

export function calendarTasksFromEntry(entry: CalendarEntry): CalendarTask[] {
  const tasks = entry.tasks ?? [];
  return tasks.map((t) => {
    const meta = parseTaskMeta(t.text);
    return {
      kind: 'task',
      uid: meta.uid ?? null,
      title: meta.title,
      done: t.done,
      due: meta.due,
      priority: meta.priority,
      reminders: meta.reminders ?? [],
      rrule: meta.rrule ?? null,
      path: entry.path,
      line: t.line,
      mtime: entry.mtime ?? 0,
    };
  });
}

// -------------------------------------------------------------------------
// Recurrence expansion
// --------------------------------------------------------------------------

function occurrenceOf(
  event: CalendarEvent,
  start: CalendarWallTime,
): CalendarOccurrence {
  let end: CalendarWallTime | null = null;
  if (event.dtend) {
    if (event.allDay) {
      const days = Math.max(1, daysBetween(event.dtstart.slice(0, 10), event.dtend.slice(0, 10)));
      end = addDays(start.slice(0, 10), days);
    } else {
      const minutes = Math.max(0, timeMinutesBetween(event.dtstart, event.dtend));
      const p = wallParts(start);
      if (p) {
        // UTC arithmetic keeps wall-clock + duration independent of the
        // device's own timezone.
        const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute + minutes, p.second));
        end = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      }
    }
  }

  return {
    kind: 'event',
    eventUid: event.uid,
    path: event.path,
    summary: event.summary,
    allDay: event.allDay,
    start,
    end,
    startUtc: wallTimeToUtc(start, event.tzid),
    endUtc: end ? wallTimeToUtc(end, event.tzid) : null,
    source: event,
  };
}

function exdateKeys(event: CalendarEvent): Set<string> {
  const out = new Set<string>();
  for (const x of event.exdate) {
    const canonical = canonicalWall(x);
    if (canonical) out.add(canonical);
  }
  return out;
}

/** Monday-based week start shifted to the rule's `WKST`. */
function weekStartOn(date: string, wkst: number): string {
  return addDays(date, -((dayOfWeek(date) - wkst + 7) % 7));
}

/** `1` = first, `-1` = last weekday of the month. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): string | null {
  const last = daysInMonth(year, month);
  if (ordinal > 0) {
    const first = `${year}-${pad(month)}-01`;
    const delta = (weekday - dayOfWeek(first) + 7) % 7;
    return validDate(year, month, 1 + delta + (ordinal - 1) * 7);
  }
  const end = `${year}-${pad(month)}-${pad(last)}`;
  const delta = (dayOfWeek(end) - weekday + 7) % 7;
  return validDate(year, month, last - delta + (ordinal + 1) * 7);
}

function weekdaysInMonth(year: number, month: number, weekday: number): string[] {
  const last = daysInMonth(year, month);
  const out: string[] = [];
  for (let day = 1; day <= last; day++) {
    const date = validDate(year, month, day);
    if (date && dayOfWeek(date) === weekday) out.push(date);
  }
  return out;
}

/** `BYMONTHDAY` days, where a negative value counts back from the month's end. */
function monthDaysFor(year: number, month: number, values: number[]): string[] {
  const last = daysInMonth(year, month);
  const out: string[] = [];
  for (const n of values) {
    const day = n > 0 ? n : last + n + 1;
    const date = validDate(year, month, day);
    if (date) out.push(date);
  }
  return out;
}

/** `BYDAY` ordinal counted across the whole year (YEARLY without BYMONTH). */
function nthWeekdayOfYear(year: number, weekday: number, ordinal: number): string | null {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  if (ordinal > 0) {
    const delta = (weekday - dayOfWeek(first) + 7) % 7;
    const date = addDays(first, delta + (ordinal - 1) * 7);
    return date.slice(0, 4) === String(year) ? date : null;
  }
  const delta = (dayOfWeek(last) - weekday + 7) % 7;
  const date = addDays(last, -delta + (ordinal + 1) * 7);
  return date.slice(0, 4) === String(year) ? date : null;
}

function weekdaysInYear(year: number, weekday: number): string[] {
  const first = `${year}-01-01`;
  const start = addDays(first, (weekday - dayOfWeek(first) + 7) % 7);
  const out: string[] = [];
  for (let d = start; d.slice(0, 4) === String(year); d = addDays(d, 7)) out.push(d);
  return out;
}

function matchesMonthDay(date: string, values: number[]): boolean {
  const day = Number(date.slice(8, 10));
  const last = daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  return values.some((n) => (n > 0 ? n === day : last + n + 1 === day));
}

function monthMatches(date: string, months: number[]): boolean {
  return months.includes(Number(date.slice(5, 7)));
}

function uniqueSorted(dates: string[]): string[] {
  return [...new Set(dates)].sort(compareDate);
}

/**
 * RFC 5545 `BYSETPOS`: pick the nth candidate (negative counts from the end)
 * out of one period's sorted set. No-op when the rule has no `BYSETPOS`.
 */
function applySetPos(dates: string[], setPos: number[] | null): string[] {
  const sorted = uniqueSorted(dates);
  if (!setPos) return sorted;
  const picked = new Set<string>();
  for (const n of setPos) {
    const index = n > 0 ? n - 1 : sorted.length + n;
    if (index >= 0 && index < sorted.length) picked.add(sorted[index]);
  }
  return uniqueSorted([...picked]);
}

function monthlyCandidates(
  rule: RecurrenceRule,
  year: number,
  month: number,
  startDay: number,
): string[] {
  if (rule.byDaySpecs) {
    const out: string[] = [];
    for (const spec of rule.byDaySpecs) {
      if (spec.ordinal !== null) {
        const date = nthWeekdayOfMonth(year, month, spec.day, spec.ordinal);
        if (date) out.push(date);
      } else {
        out.push(...weekdaysInMonth(year, month, spec.day));
      }
    }
    return rule.byMonthDay ? out.filter((d) => matchesMonthDay(d, rule.byMonthDay!)) : out;
  }
  return monthDaysFor(year, month, rule.byMonthDay ?? [startDay]);
}

function yearlyCandidates(rule: RecurrenceRule, year: number, startMonth: number, startDay: number): string[] {
  const out: string[] = [];
  if (rule.byDaySpecs) {
    if (rule.byMonth) {
      for (const month of rule.byMonth) {
        for (const spec of rule.byDaySpecs) {
          if (spec.ordinal !== null) {
            const date = nthWeekdayOfMonth(year, month, spec.day, spec.ordinal);
            if (date) out.push(date);
          } else {
            out.push(...weekdaysInMonth(year, month, spec.day));
          }
        }
      }
    } else {
      for (const spec of rule.byDaySpecs) {
        if (spec.ordinal !== null) {
          const date = nthWeekdayOfYear(year, spec.day, spec.ordinal);
          if (date) out.push(date);
        } else {
          out.push(...weekdaysInYear(year, spec.day));
        }
      }
    }
    return out;
  }
  for (const month of rule.byMonth ?? [startMonth]) {
    out.push(...monthDaysFor(year, month, rule.byMonthDay ?? [startDay]));
  }
  return out;
}

/**
 * Expand one event into occurrences that start inside `[from, to)`.
 *
 * `from`/`to` are `YYYY-MM-DD` wall dates. `overrides` are exception instances
 * (same `seriesUid`, `recurrenceId`); matching master occurrences are skipped
 * so the override is the only one shown.
 *
 * Ordinal `BYDAY` values (`2TU`, `-1FR`) and `BYSETPOS` are honoured. Rule
 * parts `explainRRule` marked unsupported are dropped from the expansion, but
 * the caller is expected to surface them (see `CalendarEditor`'s warning).
 */
export function expandOccurrences(
  event: CalendarEvent,
  from: string,
  to: string,
  overrides: CalendarEvent[] = [],
): CalendarOccurrence[] {
  const startParts = wallParts(event.dtstart);
  if (!startParts) return [];
  const rule = parseRRule(event.rrule);
  const ex = exdateKeys(event);
  const overrideKeys = new Set<string>();
  for (const o of overrides) {
    if (o.seriesUid && o.seriesUid === event.uid && o.recurrenceId) {
      const canonical = canonicalWall(o.recurrenceId);
      if (canonical) overrideKeys.add(canonical);
    }
  }

  const out: CalendarOccurrence[] = [];
  const startDate = event.dtstart.slice(0, 10);
  const until = rule?.until ?? null;
  let produced = 0;
  let iterations = 0;

  const emit = (date: string): boolean => {
    iterations += 1;
    if (iterations > 6000) return false;
    if (compareDate(date, startDate) < 0) return true;
    if (rule?.count !== null && rule?.count !== undefined && produced >= rule.count) return false;

    const wall = dateTimeFromDateParts(startParts, date);
    const canonical = canonicalWall(wall);
    if (!canonical) return true;

    if (until && !afterUntil(date, wall, until)) return false;

    produced += 1;
    if (ex.has(canonical) || overrideKeys.has(canonical)) return true;
    if (compareDate(date, from) >= 0 && compareDate(date, to) < 0) {
      out.push(occurrenceOf(event, wall));
    }
    return compareDate(date, to) < 0;
  };

  /** Emit one period's candidates after applying BYSETPOS. */
  const emitPeriod = (dates: string[]): boolean => {
    for (const date of applySetPos(dates, rule?.bySetPos ?? null)) {
      if (!emit(date)) return false;
    }
    return true;
  };

  if (!rule) {
    emit(startDate);
    return out;
  }

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const startDow = dayOfWeek(startDate);

  if (rule.freq === 'DAILY') {
    const byDay = rule.byDaySpecs ? new Set(rule.byDaySpecs.map((s) => s.day)) : null;
    for (let i = 0; i < 6000; i++) {
      const date = addDays(startDate, i * rule.interval);
      if (rule.byMonth && !monthMatches(date, rule.byMonth)) continue;
      if (byDay && !byDay.has(dayOfWeek(date))) continue;
      if (rule.byMonthDay && !matchesMonthDay(date, rule.byMonthDay)) continue;
      if (!emitPeriod([date])) return out;
    }
    return out;
  }

  if (rule.freq === 'WEEKLY') {
    const weekBase = weekStartOn(startDate, rule.wkst);
    const weekdays = rule.byDaySpecs
      ? [...new Set(rule.byDaySpecs.map((s) => s.day))]
      : [startDow];
    for (let week = 0; week < 600; week++) {
      const base = addDays(weekBase, week * 7 * rule.interval);
      const dates = weekdays
        .map((day) => addDays(base, (day - rule.wkst + 7) % 7))
        .filter((date) => {
          if (rule.byMonth && !monthMatches(date, rule.byMonth)) return false;
          if (rule.byMonthDay && !matchesMonthDay(date, rule.byMonthDay)) return false;
          return true;
        });
      if (!emitPeriod(dates)) return out;
    }
    return out;
  }

  if (rule.freq === 'MONTHLY') {
    for (let i = 0; i < 300; i++) {
      const total = sm - 1 + i * rule.interval;
      const year = sy + Math.floor(total / 12);
      const month = (total % 12) + 1;
      if (rule.byMonth && !rule.byMonth.includes(month)) continue;
      if (!emitPeriod(monthlyCandidates(rule, year, month, sd))) return out;
    }
    return out;
  }

  // YEARLY
  for (let i = 0; i < 200; i++) {
    const year = sy + i * rule.interval;
    if (!emitPeriod(yearlyCandidates(rule, year, sm, sd))) return out;
  }
  return out;
}

function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `true` while the occurrence is at or before UNTIL. */
function afterUntil(date: string, wall: string, until: string): boolean {
  if (isDateOnly(until)) return compareDate(date, until) <= 0;
  const a = canonicalWall(wall);
  const b = canonicalWall(until);
  if (!a || !b) return true;
  return a <= b;
}

// -------------------------------------------------------------------------
// Index projection
// --------------------------------------------------------------------------

export interface CalendarWindow {
  /** Inclusive `YYYY-MM-DD`. */
  from: string;
  /** Exclusive `YYYY-MM-DD`. */
  to: string;
}

/**
 * Build day buckets from index entries.
 *
 * Events are expanded over the window (and exception instances suppress their
 * master occurrence); tasks are placed on their `due` date. All-day events
 * appear only on their start date — the non-inclusive `DTEND` never creates a
 * second day.
 */
export function buildCalendarIndex(
  entries: CalendarEntry[],
  window: CalendarWindow,
): CalendarIndex {
  const events: CalendarEvent[] = [];
  const tasks: CalendarTask[] = [];
  for (const entry of entries) {
    const ev = calendarEventFromEntry(entry);
    if (ev) events.push(ev);
    tasks.push(...calendarTasksFromEntry(entry));
  }

  const overrides = events.filter((e) => e.seriesUid !== null && e.recurrenceId !== null);
  const days: CalendarDay[] = [];
  for (let date = window.from; compareDate(date, window.to) < 0; date = addDays(date, 1)) {
    days.push({ date, events: [], tasks: [] });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const undatedTasks: CalendarTask[] = [];

  for (const event of events) {
    for (const occ of expandOccurrences(event, window.from, window.to, overrides)) {
      const bucket = byDate.get(occ.start.slice(0, 10));
      if (bucket) bucket.events.push(occ);
    }
  }

  for (const task of tasks) {
    if (!task.due) {
      undatedTasks.push(task);
      continue;
    }
    if (compareDate(task.due, window.from) < 0 || compareDate(task.due, window.to) >= 0) {
      continue;
    }
    byDate.get(task.due)?.tasks.push(task);
  }

  for (const day of days) {
    day.events.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      const ak = canonicalWall(a.start) ?? '';
      const bk = canonicalWall(b.start) ?? '';
      if (ak !== bk) return ak < bk ? -1 : 1;
      return a.summary.localeCompare(b.summary);
    });
    day.tasks.sort((a, b) =>
      compareTasks(
        { done: a.done, meta: { ...metaOf(a) } },
        { done: b.done, meta: { ...metaOf(b) } },
      ),
    );
  }

  undatedTasks.sort((a, b) =>
    compareTasks(
      { done: a.done, meta: metaOf(a) },
      { done: b.done, meta: metaOf(b) },
    ),
  );

  return { days, undatedTasks };
}

function metaOf(task: CalendarTask) {
  const meta = {
    title: task.title,
    priority: task.priority,
    due: task.due,
    tags: [] as string[],
  };
  return meta;
}

// -------------------------------------------------------------------------
// Serialization (frontmatter only; the body is never touched)
// -------------------------------------------------------------------------

/** iCal-shaped frontmatter for an event; empty/absent values are omitted. */
export function calendarEventFrontmatter(event: CalendarEvent): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    type: 'event',
    uid: event.uid,
    dtstamp: new Date().toISOString(),
    dtstart: event.dtstart,
  };
  if (event.dtend) fm.dtend = event.dtend;
  if (event.tzid) fm.tzid = event.tzid;
  if (event.allDay) fm.all_day = true;
  if (event.summary) fm.summary = event.summary;
  if (event.notes) fm.description = event.notes;
  if (event.location) fm.location = event.location;
  if (event.status !== 'CONFIRMED') fm.status = event.status;
  if (event.categories.length) fm.categories = event.categories;
  if (event.rrule) fm.rrule = event.rrule;
  if (event.exdate.length) fm.exdate = event.exdate;
  if (event.seriesUid) fm.series_uid = event.seriesUid;
  if (event.recurrenceId) fm.recurrence_id = event.recurrenceId;
  if (event.alarms.length) fm.alarms = event.alarms;
  if (event.relatedNote) fm.related_note = event.relatedNote;
  if (event.source !== 'local') fm.source = event.source;
  if (event.remoteHref) fm.remote_href = event.remoteHref;
  if (event.etag) fm.etag = event.etag;
  if (event.sequence) fm.sequence = event.sequence;
  return fm;
}

/**
 * Rewrite an event note's managed frontmatter keys while preserving every
 * other key and the entire body byte-for-byte. Keys that no longer apply are
 * deleted (`patchFrontmatter` treats `undefined` as a delete).
 */
export function writeCalendarEvent(text: string, event: CalendarEvent): string {
  const next = calendarEventFrontmatter(event);
  const patch: Record<string, unknown> = {};
  for (const key of MANAGED_EVENT_KEYS) {
    patch[key] = next[key];
  }
  return patchFrontmatter(text, patch);
}

/** Create a fresh event note (frontmatter + optional body). */
export function createCalendarEvent(
  event: CalendarEvent,
  body = '',
): string {
  const fm = calendarEventFrontmatter(event);
  return `${dumpFrontmatter(fm)}\n\n${body}`;
}

/** `crypto.randomUUID` with a deterministic-enough fallback for older runtimes. */
export function newEventUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export interface ExceptionPatch {
  uid?: string;
  summary?: string;
  notes?: string | null;
  location?: string | null;
  allDay?: boolean;
  dtstart: CalendarWallTime;
  dtend: CalendarWallTime | null;
  status?: EventStatus;
  /** Edited alarms for this occurrence only; omitted keeps the master's. */
  alarms?: CalendarAlarm[];
}

/**
 * Build a detached instance of a recurring event ("this occurrence only").
 *
 * The exception is a normal event note: a new `uid`, no `rrule`, and the two
 * fields that tie it back to the master — `series_uid` and `recurrence_id`
 * (the start of the occurrence it replaces). `expandOccurrences` uses those
 * two keys to drop the master's copy of that occurrence, so without them the
 * calendar would show the same meeting twice. Alarms and other series-wide
 * metadata are inherited.
 */
export function makeExceptionEvent(
  master: CalendarEvent,
  occurrenceStart: CalendarWallTime,
  patch: ExceptionPatch,
): CalendarEvent {
  return {
    ...master,
    uid: patch.uid ?? newEventUid(),
    summary: patch.summary ?? master.summary,
    notes: patch.notes === undefined ? master.notes : patch.notes,
    location: patch.location === undefined ? master.location : patch.location,
    allDay: patch.allDay ?? master.allDay,
    dtstart: patch.dtstart,
    dtend: patch.dtend,
    status: patch.status ?? master.status,
    alarms: patch.alarms ? patch.alarms.map((alarm) => ({ ...alarm })) : master.alarms.map((alarm) => ({ ...alarm })),
    rrule: null,
    exdate: [],
    seriesUid: master.uid,
    recurrenceId: occurrenceStart,
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: '',
    mtime: 0,
    source: 'local',
  };
}
