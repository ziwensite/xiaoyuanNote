/**
 * Focus-date / view preference shared by the sidebar mini month and the full
 * calendar dialog. Kept pure so the store stays a thin Pinia wrapper and the
 * format can be unit-tested.
 */
import { localDateKey } from './calendar';

export type CalendarEditorView = 'month' | 'day' | 'week';

export const CALENDAR_EDITOR_VIEWS: readonly CalendarEditorView[] = ['day', 'week', 'month'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarPrefs {
  focusDate: string;
  view: CalendarEditorView;
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

export function isCalendarEditorView(value: unknown): value is CalendarEditorView {
  return value === 'month' || value === 'day' || value === 'week';
}

/** Parse a stored bucket; invalid values fall back instead of throwing. */
export function parseCalendarPrefs(raw: string | null, today = localDateKey(new Date())): CalendarPrefs {
  if (!raw) return { focusDate: today, view: 'month' };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    return {
      focusDate: isCalendarDate(parsed?.focusDate) ? parsed.focusDate : today,
      view: isCalendarEditorView(parsed?.view) ? parsed.view : 'month',
    };
  } catch {
    return { focusDate: today, view: 'month' };
  }
}

export function serializeCalendarPrefs(prefs: CalendarPrefs): string {
  return JSON.stringify({ focusDate: prefs.focusDate, view: prefs.view });
}
