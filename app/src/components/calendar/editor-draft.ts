import type { CalendarAlarm, CalendarEvent } from '../../lib/calendar';

/** Form state for the event composer; lives outside the SFC so both files share it. */
export interface EditorDraft {
  mode: 'new' | 'edit';
  path: string | null;
  /** File text when the editor opened / the drag started, for conflict checks. */
  snapshot: string;
  source: CalendarEvent | null;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  title: string;
  location: string;
  notes: string;
  status: CalendarEvent['status'];
  /** Exclusive day span of an all-day event. */
  spanDays: number;
  recurring: boolean;
  /**
   * Recurring edits only: `series` rewrites the master note, `single` writes a
   * detached exception note (same `series_uid`, original `recurrence_id`).
   * Non-recurring edits always use `single`.
   */
  scope: 'single' | 'series';
  /** Master UID when `source` is one of its occurrences. */
  seriesUid: string | null;
  /** The occurrence start this exception replaces (canonical wall time). */
  recurrenceId: string | null;
  /** RRULE parts the parser could not honour; shown as a visible warning. */
  ruleUnsupported: string[];
  /**
   * VALARM entries, edited as triggers. Copied (not referenced) from the
   * source event so cancelling the editor cannot mutate the rendered event;
   * `action` rides along so an imported `EMAIL`/`AUDIO` alarm is not silently
   * downgraded to `DISPLAY` when the user edits something else.
   */
  alarms: CalendarAlarm[];
}
