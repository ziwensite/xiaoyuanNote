/**
 * M3 — turn calendar events and tasks into a flat reminder schedule.
 *
 * This module is deliberately **pure**: it does the date work that the rest of
 * the calendar already knows how to do (RRULE expansion via
 * `expandOccurrences`, wall→instant via `wallTimeToUtc`) and produces absolute
 * UTC instants. The Rust side only sleeps until those instants, sends the
 * system notification and records that it fired. Keeping the expansion here
 * means there is exactly one implementation of recurrence and timezone
 * handling — duplicating it in Rust would drift the first time a rule or a
 * DST boundary changed.
 *
 * Time semantics (locked down here, covered by tests):
 *
 *   - Timed event: trigger is relative to `startUtc` (the event's own `tzid`
 *     when present, otherwise the device zone). `-PT15M` = 15 minutes before.
 *   - All-day event: its start instant is midnight (event `tzid` or device
 *     zone). Relative triggers count from that midnight; a clock trigger
 *     (`09:00`) means 09:00 on that same day.
 *   - Task due date: there is no clock component in `due`, so the reference
 *     instant is **09:00 device-local** on the due date (`TASK_DUE_HOUR`).
 *     A clock trigger replaces that time; a relative trigger (`-PT1H`) offsets
 *     from 09:00. Tasks without `due` or without `⏰` produce no reminder.
 *   - An alarm that cannot be resolved (bad duration, unparsable timestamp)
 *     produces no reminder. It is not silently moved to another time.
 *
 * **The app must be running for a reminder to fire.** The schedule is pushed
 * to the Rust loop, which dies with the process; nothing wakes a quit app.
 */
import {
  addDays,
  buildCalendarMaterial,
  expandOccurrences,
  localDateKey,
  isDateOnly,
  wallTimeToUtc,
  type CalendarEntry,
  type CalendarEvent,
  type CalendarOccurrence,
  type CalendarTask,
} from './calendar';

/** How far ahead the schedule is computed. Refreshed before it runs out. */
export const HORIZON_DAYS = 7;

/** Reference hour for date-only task due dates (device local). */
export const TASK_DUE_HOUR = 9;

/** A reminder that the Rust loop can sleep on. */
export interface ReminderItem {
  /** Stable across recomputes: source identity + fire instant. */
  id: string;
  /** Absolute UTC instant, ISO-8601 with `Z`. */
  fireAt: string;
  title: string;
  body: string;
  /** Source note, so the UI can open it when the notification is clicked. */
  path: string;
  kind: 'event' | 'task';
}

export interface ReminderBuildOptions {
  /** Horizon in days (defaults to `HORIZON_DAYS`). */
  horizonDays?: number;
  /** Drop anything firing before this instant (defaults to `nowMs`). */
  notBeforeMs?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * ISO-8601 duration → milliseconds. Supports the subset alarms use:
 * `P[nW][nD][T[nH][nM][nS]]`, with an optional leading `-`.
 */
export function parseAlarmDuration(value: string): number | null {
  const m = /^(-)?P(?:(-?\d+)W)?(?:(-?\d+)D)?(?:T(?:(-?\d+)H)?(?:(-?\d+)M)?(?:(-?\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const weeks = Number(m[2] ?? 0);
  const days = Number(m[3] ?? 0);
  const hours = Number(m[4] ?? 0);
  const minutes = Number(m[5] ?? 0);
  const seconds = Number(m[6] ?? 0);
  if (![weeks, days, hours, minutes, seconds].every(Number.isFinite)) return null;
  // `P` and `PT` parse to zero everywhere above; ISO-8601 wants a component.
  if ([m[2], m[3], m[4], m[5], m[6]].every((part) => part === undefined)) return null;
  return sign * (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000;
}

const CLOCK_TRIGGER = /^(\d{1,2}):(\d{2})$/;
const ABSOLUTE_TRIGGER = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * Resolve one alarm trigger against an occurrence.
 *
 * @param startUtc    occurrence start as an absolute instant
 * @param wallDate    occurrence date (`YYYY-MM-DD`) for clock triggers
 * @param tzid        event zone, or null for the device zone
 * @param trigger     `-PT15M`, `09:00`, or an absolute ISO timestamp
 */
export function alarmFireAt(
  startUtc: string,
  wallDate: string,
  tzid: string | null,
  trigger: string,
): string | null {
  const t = trigger.trim();
  if (ABSOLUTE_TRIGGER.test(t)) {
    const ts = Date.parse(t);
    return Number.isNaN(ts) ? null : new Date(ts).toISOString();
  }
  const clock = CLOCK_TRIGGER.exec(t);
  if (clock) {
    const hh = Number(clock[1]);
    const mm = Number(clock[2]);
    if (hh > 23 || mm > 59) return null;
    const wall = `${wallDate}T${pad(hh)}:${pad(mm)}:00`;
    return wallTimeToUtc(wall, tzid);
  }
  const delta = parseAlarmDuration(t);
  if (delta === null) return null;
  const base = Date.parse(startUtc);
  if (Number.isNaN(base)) return null;
  return new Date(base + delta).toISOString();
}

/**
 * Is this string a trigger the scheduler can resolve?
 *
 * Used by the editor to refuse a typo instead of saving an alarm that will
 * never fire. Keep it aligned with `alarmFireAt` — both read the same three
 * shapes, and `calendar-reminders.test.ts` asserts they agree.
 */
export function isValidAlarmTrigger(trigger: string): boolean {
  const t = trigger.trim();
  if (!t) return false;
  if (ABSOLUTE_TRIGGER.test(t)) return !Number.isNaN(Date.parse(t));
  const clock = CLOCK_TRIGGER.exec(t);
  if (clock) return Number(clock[1]) <= 23 && Number(clock[2]) <= 59;
  return parseAlarmDuration(t) !== null;
}

/** A task's date-only due date becomes 09:00 device-local. */
export function taskDueBaseUtc(due: string): string | null {
  if (isDateOnly(due) === false) return null;
  return wallTimeToUtc(`${due}T${pad(TASK_DUE_HOUR)}:00:00`, null);
}

function eventBody(occ: CalendarOccurrence): string {
  const date = occ.start.slice(0, 10);
  const time = occ.allDay ? '' : occ.start.slice(11, 16);
  const location = occ.source.location;
  const when = time ? `${date} ${time}` : date;
  return location ? `${when} · ${location}` : when;
}

function eventReminders(
  event: CalendarEvent,
  from: string,
  to: string,
  overrides: CalendarEvent[],
): ReminderItem[] {
  if (event.status === 'CANCELLED') return [];
  if (!event.alarms.length) return [];
  const out: ReminderItem[] = [];
  for (const occ of expandOccurrences(event, from, to, overrides)) {
    const startUtc = occ.startUtc ?? wallTimeToUtc(occ.start, event.tzid);
    if (!startUtc) continue;
    const tzid = event.tzid;
    const title = occ.summary || event.summary || event.path.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');
    for (const alarm of event.alarms) {
      const fireAt = alarmFireAt(startUtc, occ.start.slice(0, 10), tzid, alarm.trigger);
      if (!fireAt) continue;
      out.push({
        id: `event:${occ.eventUid}:${fireAt}`,
        fireAt,
        title,
        body: eventBody(occ),
        path: occ.path,
        kind: 'event',
      });
    }
  }
  return out;
}

function taskReminders(task: CalendarTask): ReminderItem[] {
  if (task.done || !task.due || !task.reminders.length) return [];
  const baseUtc = taskDueBaseUtc(task.due);
  if (!baseUtc) return [];
  const out: ReminderItem[] = [];
  for (const trigger of task.reminders) {
    const fireAt = alarmFireAt(baseUtc, task.due, null, trigger);
    if (!fireAt) continue;
    const identity = task.uid ?? task.path;
    out.push({
      id: `task:${identity}:${task.due}:${fireAt}`,
      fireAt,
      title: task.title || task.path.replace(/^.*[\\/]/, '').replace(/\.md$/i, ''),
      body: task.due,
      path: task.path,
      kind: 'task',
    });
  }
  return out;
}

/**
 * Build the full reminder list for the next `horizonDays`.
 *
 * `nowMs` is injectable so tests can pin the clock. Returning a sorted, de-duplicated
 * list keeps the Rust side dumb: it only has to find the earliest pending item.
 */
export function buildReminderSchedule(
  entries: CalendarEntry[],
  nowMs: number = Date.now(),
  options: ReminderBuildOptions = {},
): ReminderItem[] {
  const horizonDays = options.horizonDays ?? HORIZON_DAYS;
  const notBeforeMs = options.notBeforeMs ?? nowMs;
  const today = localDateKey(new Date(nowMs));
  // Expand one day early so relative alarms that already fired today are
  // visible (and can be filtered by `notBeforeMs` instead of disappearing).
  const from = addDays(today, -1);
  const to = addDays(today, horizonDays + 2);

  const { events, tasks } = buildCalendarMaterial(entries);
  const overrides = events.filter((e) => e.seriesUid !== null && e.recurrenceId !== null);

  const items: ReminderItem[] = [];
  for (const event of events) items.push(...eventReminders(event, from, to, overrides));
  for (const task of tasks) items.push(...taskReminders(task));

  const cutoff = notBeforeMs;
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const ts = Date.parse(item.fireAt);
      if (Number.isNaN(ts) || ts < cutoff) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt));
}
