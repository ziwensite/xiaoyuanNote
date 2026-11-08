import type { CalendarEvent } from '../../lib/calendar';

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
  /** RRULE parts the parser could not honour; shown as a visible warning. */
  ruleUnsupported: string[];
}
