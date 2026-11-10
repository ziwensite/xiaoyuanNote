/**
 * Period windows (P6 / spec §5.5) — the read-only "this period" view that
 * replaces automatic roll-ups between periodic notes.
 *
 * A window is the inclusive date range of one periodic note, derived from the
 * same anchor `periodicPath` names the note after, so the sidebar list and the
 * note it sits beside can never disagree about where a week, month, quarter or
 * year starts. Nothing here writes or aggregates: the filter only selects
 * lines that already exist, and the periodic note's body is never touched.
 */

import { isoDate } from './daily-notes';
import { periodAnchor, shiftDays, shiftPeriod, type PeriodKind } from './periodic-notes';

export interface PeriodWindow {
  kind: PeriodKind;
  /** The date the periodic note is named after (weekly = week start). */
  anchor: Date;
  /** Inclusive first day of the period, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day of the period, `YYYY-MM-DD`. */
  end: string;
}

export function periodWindow(kind: PeriodKind, date: Date, weekStartsOn = 1): PeriodWindow {
  const anchor = periodAnchor(kind, date, weekStartsOn);
  const last = shiftDays(shiftPeriod(kind, anchor, 1), -1);
  return { kind, anchor, start: isoDate(anchor), end: isoDate(last) };
}

export interface WindowTaskLike {
  done: boolean;
  meta: { due: string | null };
}

/**
 * Unfinished lines whose `📅` falls inside the window.
 *
 * Undated lines belong to no period — they stay in the plain "Open" filter —
 * and completed lines drop out, which is what a weekly review is asking for.
 * Dates compare as `YYYY-MM-DD` strings, so the boundaries are inclusive
 * without any timezone arithmetic.
 */
export function tasksInWindow<T extends WindowTaskLike>(
  tasks: readonly T[],
  window: PeriodWindow,
): T[] {
  return tasks.filter(
    (task) =>
      !task.done && task.meta.due !== null && task.meta.due >= window.start && task.meta.due <= window.end,
  );
}
