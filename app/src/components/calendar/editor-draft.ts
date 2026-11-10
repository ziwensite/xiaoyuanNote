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
  /**
   * Tags, edited as free text (`work, home`) and written to the line as
   * `#work #home`. The event note no longer keeps a `categories` copy (D1 = B).
   */
  tags: string;
  location: string;
  notes: string;
  status: CalendarEvent['status'];
  /** Exclusive day span of an all-day event. */
  spanDays: number;
  recurring: boolean;
  /**
   * Recurring edits only: `series` rewrites the master note, `single` writes a
   * detached exception note (same `series_uid`, original `recurrence_id`),
   * `after` splits the series at this occurrence — the master is capped there
   * and a new series starts with the edited values.
   * Non-recurring edits always use `single`.
   */
  scope: 'single' | 'series' | 'after';
  /** Master UID when `source` is one of its occurrences. */
  seriesUid: string | null;
  /**
   * The `🆔` of the line this note points at, or null for a legacy note. A
   * legacy note gets one on first save (T4.4: upgrade only on an active edit).
   */
  entryUid: string | null;
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
