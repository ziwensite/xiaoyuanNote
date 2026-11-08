/**
 * Month-cell density — one shared answer for the sidebar mini month and the
 * dialog's month grid so the two can never disagree about a day.
 *
 * A cell shows at most one mark, chosen in this order (documented because
 * "which one wins" is the easy part to get subtly wrong):
 *
 *   1. any unfinished task  → hollow accent ring (`open`)
 *   2. all tasks finished   → solid green dot (`done`)
 *   3. a note on that day   → solid grey dot (`note`)
 *   4. nothing              → no mark (`none`)
 *
 * "A note on that day" means the daily note file for that date exists, or the
 * day carries at least one event occurrence (an event is an ordinary note).
 * Numbers never live in the cell — they go in the tooltip only.
 *
 * Pure module: no Vue, no Tauri, so `node --test` covers the priority rule and
 * the daily-note lookup directly.
 */
import type { CalendarViewDay } from './calendar-view';
import { formatDailyFilename } from './daily-notes';
import { joinInFolder } from './import-plan';
import { pathKey } from './path-key';

export type DayMarkState = 'none' | 'note' | 'open' | 'done';

export interface CalendarDayDensity {
  state: DayMarkState;
  /** Tasks due that day. */
  total: number;
  done: number;
  todo: number;
  /** Event occurrences shown on that day. */
  events: number;
  hasNote: boolean;
}

function wallDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Derive the single mark for one day.
 *
 * Priority: open tasks → done tasks → note → none. A day that has both finished
 * and unfinished tasks shows the ring; a day with finished tasks and a note
 * shows the green dot; a note-only day shows grey.
 */
export function dayDensity(day: CalendarViewDay, hasDailyNote: boolean): CalendarDayDensity {
  const total = day.tasks.length;
  const done = day.tasks.filter((task) => task.done).length;
  const todo = total - done;
  const events = day.allDay.length + day.timed.length;
  const hasNote = hasDailyNote || events > 0;

  let state: DayMarkState = 'none';
  if (todo > 0) state = 'open';
  else if (total > 0) state = 'done';
  else if (hasNote) state = 'note';

  return { state, total, done, todo, events, hasNote };
}

export interface DailyNoteFileRef {
  path: string;
}

/**
 * Dates in `dates` that already have a daily note on disk.
 *
 * Daily notes are resolved exactly like `useDailyNotes` does: the configured
 * folder under the workspace, plus the configured filename format. The index
 * gives us the file list, so this stays a pure lookup.
 */
export function dailyNoteDates(
  files: readonly DailyNoteFileRef[],
  dates: readonly string[],
  workspaceFolder: string | null,
  dailyFolder: string,
  format: string,
): Set<string> {
  const out = new Set<string>();
  if (!workspaceFolder) return out;
  const known = new Set(files.map((file) => pathKey(file.path)));
  const folder = joinInFolder(workspaceFolder, (dailyFolder || 'Daily').trim());
  const nameFormat = (format || 'YYYY-MM-DD.md').trim();
  for (const date of dates) {
    const filename = formatDailyFilename(wallDate(date), nameFormat);
    if (known.has(pathKey(joinInFolder(folder, filename)))) out.add(date);
  }
  return out;
}
