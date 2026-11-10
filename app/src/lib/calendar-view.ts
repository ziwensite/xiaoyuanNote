/**
 * M1 — read-only calendar view projection.
 *
 * `lib/calendar.ts` (M0) owns the data model and deliberately keeps all-day
 * events on their start date only. The grids need the opposite: an event that
 * spans several days must land on every day it covers. This module adds that
 * projection (plus overlap columns and agenda bucketing) without changing the
 * M0 contract, and stays free of Vue/Tauri so it can be unit-tested.
 */
import {
  addDays,
  buildCalendarMaterial,
  canonicalWall,
  dayOfWeek,
  expandOccurrences,
  type CalendarEntry,
  type CalendarOccurrence,
  type CalendarTask,
  type CalendarWindow,
} from './calendar';
import { isOverdue } from './tasks';

export type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month';

/**
 * Content width (dock width minus the 32 px rail) needed for each view.
 *
 * - `< 320` → agenda only. The right dock's default content width is 260.
 * - `320` → day grid (24 hour rows, one column).
 * - `360` → month grid: 7 columns, ~48 px each, enough for `MM-DD` + one chip.
 * - `420` → week grid: 7 columns, ~60 px each, above the design's 44 px floor.
 */
export const CALENDAR_VIEW_MIN_WIDTH: Record<CalendarViewMode, number> = {
  agenda: 0,
  day: 320,
  week: 420,
  month: 360,
};

/** Occurrences may start before the window; expand this far back. */
export const CALENDAR_LOOKBACK_DAYS = 31;

export function supportsCalendarView(mode: CalendarViewMode, width: number): boolean {
  return width >= CALENDAR_VIEW_MIN_WIDTH[mode];
}

/**
 * Keep the requested mode when it fits, otherwise fall back to the largest
 * one that does. Week → month → day → agenda; month → day → agenda.
 */
export function resolveCalendarViewMode(
  mode: CalendarViewMode,
  width: number,
): CalendarViewMode {
  if (supportsCalendarView(mode, width)) return mode;
  if (mode === 'week') {
    if (supportsCalendarView('month', width)) return 'month';
    if (supportsCalendarView('day', width)) return 'day';
    return 'agenda';
  }
  if (mode === 'month') {
    return supportsCalendarView('day', width) ? 'day' : 'agenda';
  }
  return 'agenda';
}

export interface CalendarTimedBlock {
  occurrence: CalendarOccurrence;
  /** Minutes from the day's 00:00, clamped to [0, 1440]. */
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
}

export interface CalendarViewDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** All-day occurrences, plus the non-start days of a multi-day event. */
  allDay: CalendarOccurrence[];
  /** Timed blocks that start on this day, already assigned overlap columns. */
  timed: CalendarTimedBlock[];
  tasks: CalendarTask[];
}

export interface CalendarViewData {
  days: CalendarViewDay[];
  undatedTasks: CalendarTask[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /T(\d{2}):(\d{2})/;

function dateOf(value: string): string {
  const m = DATE_RE.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : value.slice(0, 10);
}

function minutesOf(value: string): number | null {
  const m = TIME_RE.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function daysBetweenDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

function addMinutesWall(value: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return value;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]) + minutes, Number(m[6] ?? 0)),
  );
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * End of an occurrence, tolerating M0's zero-duration result for an event that
 * crosses midnight: there `timeMinutesBetween` subtracts time-of-day only, so
 * `occ.end` collapses onto `occ.start`. Fall back to the source event's
 * `dtstart`/`dtend` span, which keeps the real overnight duration.
 */
function effectiveEnd(occ: CalendarOccurrence): string | null {
  if (occ.end && canonicalWall(occ.end) !== canonicalWall(occ.start)) return occ.end;
  const src = occ.source;
  if (!src.dtend) return occ.end ?? null;

  if (src.allDay) {
    const days = Math.max(
      1,
      daysBetweenDates(src.dtstart.slice(0, 10), src.dtend.slice(0, 10)),
    );
    return addDays(occ.start.slice(0, 10), days);
  }

  const startMinute = minutesOf(src.dtstart) ?? 0;
  const endMinute = minutesOf(src.dtend) ?? 0;
  const dayDiff = daysBetweenDates(src.dtstart.slice(0, 10), src.dtend.slice(0, 10));
  const duration = dayDiff * 1440 + endMinute - startMinute;
  if (duration <= 0) return occ.end ?? null;
  return addMinutesWall(occ.start, duration);
}

/**
 * Every wall date an occurrence covers.
 *
 * All-day `DTEND` is exclusive; a timed occurrence ending at `00:00` does not
 * occupy the next day either.
 */
export function occurrenceDays(occ: CalendarOccurrence): string[] {
  const startDate = dateOf(occ.start);
  const end = effectiveEnd(occ);
  if (!end) return [startDate];
  const endDate = dateOf(end);

  if (occ.allDay) {
    const out: string[] = [];
    for (let d = startDate; d < endDate && out.length < 366; d = addDays(d, 1)) {
      out.push(d);
    }
    return out.length ? out : [startDate];
  }

  if (compareDate(endDate, startDate) <= 0) return [startDate];
  const endTime = minutesOf(end);
  const last = endTime === 0 ? addDays(endDate, -1) : endDate;
  const out: string[] = [];
  for (let d = startDate; d <= last && out.length < 366; d = addDays(d, 1)) {
    out.push(d);
  }
  return out.length ? out : [startDate];
}

/**
 * Assign overlap columns inside each overlap cluster.
 *
 * Touching intervals (`end === next start`) may share a column; the cluster's
 * `columns` value is its maximum concurrency, so a lone event keeps full width.
 */
export function layoutTimed(occurrences: CalendarOccurrence[]): CalendarTimedBlock[] {
  const items = occurrences.map((occ) => {
    const startDate = dateOf(occ.start);
    const start = minutesOf(occ.start) ?? 0;
    const endValue = effectiveEnd(occ);
    let end: number;
    if (endValue && compareDate(dateOf(endValue), startDate) > 0) {
      // Crosses midnight: the start-day block runs to the bottom.
      end = 1440;
    } else {
      end = minutesOf(endValue ?? '') ?? start + 45;
    }
    const startMinutes = Math.min(1440, Math.max(0, start));
    const endMinutes = Math.min(1440, Math.max(startMinutes + 1, end));
    const block: CalendarTimedBlock = {
      occurrence: occ,
      startMinutes,
      endMinutes,
      column: 0,
      columns: 1,
    };
    return block;
  });

  items.sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      a.occurrence.summary.localeCompare(b.occurrence.summary),
  );

  let cluster: CalendarTimedBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columnEnds: number[] = [];
    for (const block of cluster) {
      let column = columnEnds.findIndex((end) => end <= block.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = block.endMinutes;
      block.column = column;
    }
    for (const block of cluster) block.columns = columnEnds.length;
    cluster = [];
  };

  for (const block of items) {
    if (cluster.length && block.startMinutes >= clusterEnd) flush();
    if (!cluster.length) clusterEnd = block.endMinutes;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMinutes);
  }
  if (cluster.length) flush();

  return items;
}

function sortOccurrences(list: CalendarOccurrence[]): CalendarOccurrence[] {
  return [...list].sort((a, b) => {
    const ak = canonicalWall(a.start) ?? '';
    const bk = canonicalWall(b.start) ?? '';
    if (ak !== bk) return ak < bk ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
}

/**
 * Project index entries into day buckets with correct multi-day placement.
 *
 * Unlike `buildCalendarIndex`, all-day and multi-day occurrences are copied to
 * every covered day. Timed blocks only exist on their start day; later days
 * carry the occurrence in `allDay` (an "ongoing" bar).
 */
export function buildCalendarView(
  entries: CalendarEntry[],
  window: CalendarWindow,
): CalendarViewData {
  const { events, tasks } = buildCalendarMaterial(entries);

  const overrides = events.filter(
    (event) => event.seriesUid !== null && event.recurrenceId !== null,
  );
  const days: CalendarViewDay[] = [];
  for (let date = window.from; compareDate(date, window.to) < 0; date = addDays(date, 1)) {
    days.push({ date, allDay: [], timed: [], tasks: [] });
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  const timedByDate = new Map<string, CalendarOccurrence[]>();
  const undatedTasks: CalendarTask[] = [];

  const expandFrom = addDays(window.from, -CALENDAR_LOOKBACK_DAYS);
  for (const event of events) {
    for (const occ of expandOccurrences(event, expandFrom, window.to, overrides)) {
      const startDate = dateOf(occ.start);
      for (const date of occurrenceDays(occ)) {
        if (compareDate(date, window.from) < 0 || compareDate(date, window.to) >= 0) continue;
        const day = byDate.get(date);
        if (!day) continue;
        if (occ.allDay || date !== startDate) {
          day.allDay.push(occ);
        } else {
          const list = timedByDate.get(date) ?? [];
          list.push(occ);
          timedByDate.set(date, list);
        }
      }
    }
  }

  for (const day of days) {
    day.allDay = sortOccurrences(day.allDay);
    day.timed = layoutTimed(timedByDate.get(day.date) ?? []);
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

  for (const day of days) day.tasks.sort(compareCalendarTasks);
  undatedTasks.sort(compareCalendarTasks);

  return { days, undatedTasks };
}

export function compareCalendarTasks(a: CalendarTask, b: CalendarTask): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  const rank = (priority: CalendarTask['priority'] | null) =>
    priority === 'high' ? 0 : priority === 'medium' ? 1 : priority === 'low' ? 2 : 3;
  if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority);
  return a.title.localeCompare(b.title);
}

/** `YYYY-MM-DD` of the Monday that starts the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, -dayOfWeek(date));
}

/** Seven days, Monday first. */
export function weekRange(cursor: string): string[] {
  const start = weekStart(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** A fixed 6×7 month grid: the 42 days starting on the Monday before the 1st. */
export function monthGridRange(cursor: string): string[] {
  const first = `${cursor.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isCalendarTaskOverdue(task: CalendarTask, today: string): boolean {
  return !task.done && isOverdue(task.due, today);
}

export type AgendaGroupKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'thisWeek'
  | 'later'
  | 'undated';

export interface AgendaDay {
  date: string;
  occurrences: CalendarOccurrence[];
  tasks: CalendarTask[];
}

export interface AgendaGroup {
  key: AgendaGroupKey;
  days: AgendaDay[];
  undatedTasks: CalendarTask[];
}

const AGENDA_ORDER: readonly AgendaGroupKey[] = [
  'overdue',
  'today',
  'tomorrow',
  'thisWeek',
  'later',
  'undated',
];

/** Sunday (dayOfWeek 6) anchors "this week" to the current week's last day. */
function weekEnd(today: string): string {
  return addDays(today, 6 - dayOfWeek(today));
}

function bucketFor(date: string, today: string, end: string): AgendaGroupKey {
  if (compareDate(date, today) < 0) return 'overdue';
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  if (compareDate(date, end) <= 0) return 'thisWeek';
  return 'later';
}

/**
 * Group the view into agenda buckets.
 *
 * A multi-day occurrence appears once, anchored at `max(start, window首日)`,
 * so an event already running when the window opens still shows up.
 */
export function buildAgendaGroups(view: CalendarViewData, today: string): AgendaGroup[] {
  const firstDate = view.days[0]?.date ?? today;
  const end = weekEnd(today);
  const groups = new Map<AgendaGroupKey, AgendaGroup>();
  const ensure = (key: AgendaGroupKey): AgendaGroup => {
    let group = groups.get(key);
    if (!group) {
      group = { key, days: [], undatedTasks: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const day of view.days) {
    const occurrences = [
      ...day.allDay,
      ...day.timed.map((block) => block.occurrence),
    ];
    const anchored = occurrences.filter((occ) => {
      const spanStart = dateOf(occ.start);
      const anchor = compareDate(spanStart, firstDate) < 0 ? firstDate : spanStart;
      return anchor === day.date;
    });
    if (!anchored.length && !day.tasks.length) continue;
    const group = ensure(bucketFor(day.date, today, end));
    group.days.push({
      date: day.date,
      occurrences: sortOccurrences(anchored),
      tasks: day.tasks,
    });
  }

  if (view.undatedTasks.length) {
    ensure('undated').undatedTasks = view.undatedTasks;
  }

  return AGENDA_ORDER.filter((key) => {
    const group = groups.get(key);
    return !!group && (group.days.length > 0 || group.undatedTasks.length > 0);
  }).map((key) => groups.get(key)!);
}

export type TaskDueGroupKey = 'overdue' | 'today' | 'thisWeek' | 'later' | 'undated';

export interface TaskDueGroup {
  key: TaskDueGroupKey;
  tasks: CalendarTask[];
}

const TASK_DUE_ORDER: readonly TaskDueGroupKey[] = [
  'overdue',
  'today',
  'thisWeek',
  'later',
  'undated',
];

/**
 * Due-date buckets for the dialog's task column: overdue / today / this week /
 * later / undated. Always returns all five (empty arrays included) so the
 * column's headings stay put while tasks move between them.
 */
export function groupTasksByDue(
  tasks: readonly CalendarTask[],
  today: string,
  includeDone = false,
): TaskDueGroup[] {
  const end = weekEnd(today);
  const buckets = new Map<TaskDueGroupKey, CalendarTask[]>(
    TASK_DUE_ORDER.map((key) => [key, []]),
  );
  for (const task of tasks) {
    if (task.done && !includeDone) continue;
    const key: TaskDueGroupKey = !task.due
      ? 'undated'
      : compareDate(task.due, today) < 0
        ? 'overdue'
        : task.due === today
          ? 'today'
          : compareDate(task.due, end) <= 0
            ? 'thisWeek'
            : 'later';
    buckets.get(key)!.push(task);
  }
  return TASK_DUE_ORDER.map((key) => ({
    key,
    tasks: buckets.get(key)!.sort(compareCalendarTasks),
  }));
}
