/**
 * M2 — pure edit helpers for the calendar dialog.
 *
 * All arithmetic is wall-clock (the model's contract): no UTC conversion, no
 * timezone lookups. All-day events move by whole dates; timed events keep their
 * duration across midnight and across days. Nothing here touches disk — the
 * component decides when to read and when to write.
 */
import { addDays, type CalendarEvent } from './calendar';
import { normalizeDiskText } from './external-change';

/** Drag/resize grain. */
export const SNAP_MINUTES = 15;

/** Nearest quarter hour (unclamped — drag deltas may be negative). */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * Nearest quarter hour inside a day. 14 → 15, 15 → 15, 16 → 15; 1440 stays
 * 1440 so a drag to the bottom edge is representable (it means next midnight).
 */
export function snapToQuarter(minutes: number, min = 0, max = 1440): number {
  return Math.min(max, Math.max(min, snapMinutes(minutes)));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Minutes since 00:00 of the wall time's own date, or null for a date value. */
export function wallMinutes(value: string): number | null {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Wall time at `date` + `minutes`; values past midnight roll into the next date. */
export function wallAt(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440);
  const rem = minutes - dayOffset * 1440;
  return `${addDays(date, dayOffset)}T${pad(Math.floor(rem / 60))}:${pad(rem % 60)}:00`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Whole-day span of an all-day event (DTEND is exclusive). */
export function allDaySpanDays(event: CalendarEvent): number {
  if (!event.dtend) return 1;
  return Math.max(1, daysBetween(event.dtstart.slice(0, 10), event.dtend.slice(0, 10)));
}

/**
 * Duration of the event in minutes. A timed event without DTEND gets the
 * calendar's default block (45 min); zero/negative spans are raised to the
 * 15-minute minimum so dragging can never produce an invisible block.
 */
export function eventDurationMinutes(event: CalendarEvent): number {
  if (event.allDay) return allDaySpanDays(event) * 1440;
  if (!event.dtend) return 45;
  const startDate = event.dtstart.slice(0, 10);
  const endDate = event.dtend.slice(0, 10);
  const start = wallMinutes(event.dtstart) ?? 0;
  const end = wallMinutes(event.dtend) ?? 0;
  const total = daysBetween(startDate, endDate) * 1440 + end - start;
  return Math.max(SNAP_MINUTES, total);
}

export interface EventTimes {
  dtstart: string;
  dtend: string | null;
}

/**
 * Move an occurrence to `targetDate`, shifted by `deltaMinutes` (already in
 * wall-clock minutes; this function snaps it to the quarter hour).
 *
 * - Timed: time-of-day and duration are kept; midnight crossings roll the end
 *   into the following date.
 * - All-day: only the date changes; the exclusive day span is preserved.
 */
export function moveOccurrence(
  event: CalendarEvent,
  occurrenceStart: string,
  targetDate: string,
  deltaMinutes: number,
): EventTimes {
  if (event.allDay) {
    return {
      dtstart: targetDate,
      dtend: event.dtend ? addDays(targetDate, allDaySpanDays(event)) : null,
    };
  }
  const start = wallMinutes(occurrenceStart) ?? 0;
  const nextStart = start + snapMinutes(deltaMinutes);
  const dtstart = wallAt(targetDate, nextStart);
  const duration = eventDurationMinutes(event);
  return { dtstart, dtend: wallAt(targetDate, nextStart + duration) };
}

/**
 * New end after dragging the lower edge by `deltaMinutes`.
 *
 * The start never moves; the end snaps to the quarter hour and can never be
 * closer than one grain to the start. All-day events are not resizable by
 * dragging (their editor owns the dates).
 */
export function resizeOccurrence(
  event: CalendarEvent,
  occurrenceStart: string,
  deltaMinutes: number,
): EventTimes | null {
  if (event.allDay) return null;
  const startDate = occurrenceStart.slice(0, 10);
  const start = wallMinutes(occurrenceStart) ?? 0;
  const duration = eventDurationMinutes(event);
  const nextDuration = Math.max(
    SNAP_MINUTES,
    snapMinutes(duration + deltaMinutes),
  );
  return {
    dtstart: occurrenceStart,
    dtend: wallAt(startDate, start + nextDuration),
  };
}

/** Copy an event with new start/end (everything else, including the body, untouched). */
export function applyEventTimes(event: CalendarEvent, times: EventTimes): CalendarEvent {
  return { ...event, dtstart: times.dtstart, dtend: times.dtend, allDay: event.allDay };
}

export type CalendarWriteDecision = 'write' | 'conflict';

/**
 * Should the edit overwrite the file we just re-read?
 *
 * `snapshot` is the file's text when the edit started (or when the drag
 * started), `disk` is what is there right now, `next` is what we are about to
 * write. Disk equal to either means nobody else changed it in between; anything
 * else is an outside change and the caller must ask the user.
 */
export function planCalendarWrite(
  disk: string,
  snapshot: string,
  next: string,
): CalendarWriteDecision {
  const d = normalizeDiskText(disk);
  if (d === normalizeDiskText(snapshot)) return 'write';
  if (d === normalizeDiskText(next)) return 'write';
  return 'conflict';
}
