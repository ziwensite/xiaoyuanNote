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
import { periodicTarget, type PeriodConfig, type PeriodKind } from './periodic-notes';
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

export type NoteFileRef = DailyNoteFileRef;

/**
 * Anchors in `anchors` that already have a periodic note of `kind` on disk.
 *
 * Uses the same configured folder/format as `useDailyNotes.openPeriodic`, so
 * the indicator can never disagree with the note that double-click opens.
 */
export function periodicNoteDates(
  kind: PeriodKind,
  anchors: readonly string[],
  files: readonly NoteFileRef[],
  workspaceFolder: string | null,
  config: PeriodConfig,
  weekStartsOn = 1,
): Set<string> {
  const out = new Set<string>();
  if (!workspaceFolder) return out;
  const known = new Set(files.map((file) => pathKey(file.path)));
  for (const anchor of anchors) {
    const target = periodicTarget(kind, wallDate(anchor), config, weekStartsOn);
    if (!target.filename) continue;
    if (known.has(pathKey(joinInFolder(workspaceFolder, target.path)))) out.add(anchor);
  }
  return out;
}

/**
 * Fold a set of days into one marker for a week / month / quarter.
 *
 * Same priority as a single day: open tasks → all tasks done → note → none.
 * The period note itself counts as a note, just like a daily note does.
 */
export function aggregateDensity(
  days: readonly CalendarViewDay[],
  hasPeriodNote: boolean,
): CalendarDayDensity {
  let total = 0;
  let done = 0;
  let events = 0;
  let hasNote = hasPeriodNote;
  for (const day of days) {
    const d = dayDensity(day, false);
    total += d.total;
    done += d.done;
    events += d.events;
    hasNote = hasNote || d.hasNote;
  }
  const todo = total - done;
  let state: DayMarkState = 'none';
  if (todo > 0) state = 'open';
  else if (total > 0) state = 'done';
  else if (hasNote) state = 'note';
  return { state, total, done, todo, events, hasNote };
}
