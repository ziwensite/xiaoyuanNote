/**
 * M1 tests — read-only view projection.
 *
 * Pure logic only (no Vue): width degradation, multi-day placement, overlap
 * columns, agenda buckets and overdue.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_VIEW_MIN_WIDTH,
  buildAgendaGroups,
  buildCalendarView,
  isCalendarTaskOverdue,
  layoutTimed,
  monthGridRange,
  occurrenceDays,
  resolveCalendarViewMode,
  supportsCalendarView,
  weekRange,
} from './calendar-view';
import { eventFromFrontmatter, expandOccurrences, type CalendarEntry } from './calendar';
import type { CalendarOccurrence } from './calendar';

const entry = (
  frontmatter: Record<string, unknown> | null,
  tasks: Array<{ line: number; text: string; done: boolean }> = [],
  path = 'Calendar/event.md',
): CalendarEntry => ({ path, frontmatter, tasks, mtime: 0 });

function eventFm(fields: Record<string, unknown>) {
  return { type: 'event', uid: 'evt-1', ...fields };
}

function occurrence(start: string, end: string | null, summary = 'event'): CalendarOccurrence {
  const ev = eventFromFrontmatter(
    eventFm({ uid: summary, dtstart: start, dtend: end ?? undefined, summary }),
    { path: `Calendar/${summary}.md` },
  );
  assert.ok(ev, `event ${summary} should parse`);
  const [occ] = expandOccurrences(ev, '2026-10-01', '2026-12-31');
  assert.ok(occ, `event ${summary} should expand`);
  return occ;
}

function task(due: string | null, done = false, title = 'task') {
  return {
    kind: 'task' as const,
    uid: null,
    title,
    done,
    due,
    priority: null,
    reminders: [],
    rrule: null,
    path: 'Note.md',
    line: 1,
    mtime: 0,
  };
}

// ── Width degradation ─────────────────────────────────────────────────────

test('width thresholds: 319 / 320 / 359 / 360 / 419 / 420', () => {
  assert.equal(CALENDAR_VIEW_MIN_WIDTH.agenda, 0);
  assert.equal(supportsCalendarView('agenda', 0), true);
  assert.equal(supportsCalendarView('day', 319), false);
  assert.equal(supportsCalendarView('day', 320), true);
  assert.equal(supportsCalendarView('month', 359), false);
  assert.equal(supportsCalendarView('month', 360), true);
  assert.equal(supportsCalendarView('week', 419), false);
  assert.equal(supportsCalendarView('week', 420), true);

  assert.equal(resolveCalendarViewMode('agenda', 319), 'agenda');
  assert.equal(resolveCalendarViewMode('day', 319), 'agenda');
  assert.equal(resolveCalendarViewMode('day', 320), 'day');
  assert.equal(resolveCalendarViewMode('day', 359), 'day');
  assert.equal(resolveCalendarViewMode('day', 360), 'day');
  assert.equal(resolveCalendarViewMode('month', 359), 'day');
  assert.equal(resolveCalendarViewMode('month', 360), 'month');
  assert.equal(resolveCalendarViewMode('week', 319), 'agenda');
  assert.equal(resolveCalendarViewMode('week', 359), 'day');
  assert.equal(resolveCalendarViewMode('week', 360), 'month');
  assert.equal(resolveCalendarViewMode('week', 419), 'month');
  assert.equal(resolveCalendarViewMode('week', 420), 'week');
});

// ── Day coverage ──────────────────────────────────────────────────────────

test('all-day DTEND is exclusive and never creates the end day', () => {
  const occ = occurrence('2026-11-07', '2026-11-09');
  assert.equal(occ.allDay, true);
  assert.deepEqual(occurrenceDays(occ), ['2026-11-07', '2026-11-08']);
});

test('timed occurrence covers the next day only when it ends after midnight', () => {
  const midnight = occurrence('2026-11-07T22:00:00', '2026-11-08T01:00:00');
  assert.deepEqual(occurrenceDays(midnight), ['2026-11-07', '2026-11-08']);

  const exactlyMidnight = occurrence('2026-11-07T09:00:00', '2026-11-08T00:00:00');
  assert.deepEqual(occurrenceDays(exactlyMidnight), ['2026-11-07']);

  const sameDay = occurrence('2026-11-07T09:00:00', '2026-11-07T17:00:00');
  assert.deepEqual(occurrenceDays(sameDay), ['2026-11-07']);

  const openEnded = occurrence('2026-11-07T09:00:00', null);
  assert.deepEqual(occurrenceDays(openEnded), ['2026-11-07']);
});

// ── Multi-day projection ──────────────────────────────────────────────────

test('multi-day events land on every covered day; timed blocks stay on the start day', () => {
  const view = buildCalendarView(
    [
      entry(eventFm({ uid: 'all', dtstart: '2026-11-07', dtend: '2026-11-09', summary: 'Trip' })),
      entry(
        eventFm({
          uid: 'night',
          dtstart: '2026-11-07T22:00:00',
          dtend: '2026-11-08T01:00:00',
          summary: 'Night shift',
        }),
      ),
    ],
    { from: '2026-11-07', to: '2026-11-10' },
  );

  assert.deepEqual(view.days.map((day) => day.date), [
    '2026-11-07',
    '2026-11-08',
    '2026-11-09',
  ]);

  assert.deepEqual(view.days[0].allDay.map((o) => o.summary), ['Trip']);
  assert.deepEqual(view.days[0].timed.map((b) => b.occurrence.summary), ['Night shift']);
  assert.equal(view.days[0].timed[0].endMinutes, 1440);

  // Continuation days carry the event in the all-day lane, not as a block.
  assert.deepEqual(view.days[1].allDay.map((o) => o.summary).sort(), ['Night shift', 'Trip']);
  assert.deepEqual(view.days[1].timed, []);
  // Nov 9 is the exclusive DTEND, so the trip has already ended by then.
  assert.deepEqual(view.days[2].allDay, []);
});

test('an event running into the window from before it is still shown', () => {
  const view = buildCalendarView(
    [entry(eventFm({ uid: 'long', dtstart: '2026-10-20', dtend: '2026-11-30', summary: 'Long' }))],
    { from: '2026-11-01', to: '2026-11-03' },
  );
  assert.deepEqual(view.days.map((day) => day.allDay.map((o) => o.summary)), [['Long'], ['Long']]);
});

// ── Overlap columns ───────────────────────────────────────────────────────

test('two overlapping timed events split into two columns', () => {
  const blocks = layoutTimed([
    occurrence('2026-11-07T09:00:00', '2026-11-07T10:00:00', 'A'),
    occurrence('2026-11-07T09:30:00', '2026-11-07T10:30:00', 'B'),
  ]);
  assert.deepEqual(blocks.map((b) => [b.occurrence.summary, b.column, b.columns]), [
    ['A', 0, 2],
    ['B', 1, 2],
  ]);
});

test('three overlapping events use three columns', () => {
  const blocks = layoutTimed([
    occurrence('2026-11-07T09:00:00', '2026-11-07T10:00:00', 'A'),
    occurrence('2026-11-07T09:15:00', '2026-11-07T10:15:00', 'B'),
    occurrence('2026-11-07T09:30:00', '2026-11-07T10:30:00', 'C'),
  ]);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.column), [0, 1, 2]);
  assert.deepEqual(blocks.map((b) => b.columns), [3, 3, 3]);
});

test('non-overlapping events reuse column 0 and keep full width', () => {
  const blocks = layoutTimed([
    occurrence('2026-11-07T09:00:00', '2026-11-07T10:00:00', 'A'),
    occurrence('2026-11-07T11:00:00', '2026-11-07T12:00:00', 'B'),
  ]);
  assert.deepEqual(blocks.map((b) => [b.column, b.columns]), [
    [0, 1],
    [0, 1],
  ]);
});

test('touching intervals may share a column', () => {
  const blocks = layoutTimed([
    occurrence('2026-11-07T09:00:00', '2026-11-07T10:00:00', 'A'),
    occurrence('2026-11-07T10:00:00', '2026-11-07T11:00:00', 'B'),
  ]);
  assert.deepEqual(blocks.map((b) => [b.column, b.columns]), [
    [0, 1],
    [0, 1],
  ]);
});

// ── Overdue / undated / agenda ─────────────────────────────────────────────

test('overdue is due strictly before today and never for completed tasks', () => {
  assert.equal(isCalendarTaskOverdue(task('2026-11-07'), '2026-11-08'), true);
  assert.equal(isCalendarTaskOverdue(task('2026-11-08'), '2026-11-08'), false);
  assert.equal(isCalendarTaskOverdue(task('2026-11-09'), '2026-11-08'), false);
  assert.equal(isCalendarTaskOverdue(task('2026-11-07', true), '2026-11-08'), false);
  assert.equal(isCalendarTaskOverdue(task(null), '2026-11-08'), false);
});

test('undated tasks only appear in the undated bucket', () => {
  const view = buildCalendarView(
    [
      entry(
        {},
        [
          { line: 1, text: 'no date', done: false },
          { line: 2, text: 'due today 📅 2026-11-08', done: false },
        ],
        'Note.md',
      ),
    ],
    { from: '2026-11-08', to: '2026-11-11' },
  );

  assert.deepEqual(view.days.flatMap((day) => day.tasks.map((t) => t.title)), ['due today']);
  assert.deepEqual(view.undatedTasks.map((t) => t.title), ['no date']);

  const groups = buildAgendaGroups(view, '2026-11-08');
  assert.deepEqual(groups.map((g) => g.key), ['today', 'undated']);
  assert.deepEqual(groups.at(-1)!.undatedTasks.map((t) => t.title), ['no date']);
  // The undated task is not also sitting on a dated group.
  assert.equal(
    groups.flatMap((g) => g.days.flatMap((d) => d.tasks.map((t) => t.title))).includes('no date'),
    false,
  );
});

test('agenda buckets: overdue / today / tomorrow / thisWeek / later', () => {
  const view = buildCalendarView(
    [
      entry(
        {},
        [
          { line: 1, text: 'late 📅 2026-11-02', done: false },
          { line: 2, text: 'now 📅 2026-11-04', done: false },
          { line: 3, text: 'next 📅 2026-11-05', done: false },
          { line: 4, text: 'week 📅 2026-11-07', done: false },
          { line: 5, text: 'later 📅 2026-11-20', done: false },
        ],
        'Note.md',
      ),
    ],
    { from: '2026-11-01', to: '2026-12-01' },
  );

  // 2026-11-04 is a Wednesday, so Nov 7 still falls inside "this week".
  const groups = buildAgendaGroups(view, '2026-11-04');
  assert.deepEqual(groups.map((g) => g.key), [
    'overdue',
    'today',
    'tomorrow',
    'thisWeek',
    'later',
  ]);
  for (const [index, title] of ['late', 'now', 'next', 'week', 'later'].entries()) {
    assert.deepEqual(
      groups[index].days.flatMap((d) => d.tasks.map((t) => t.title)),
      [title],
    );
  }
});

test('a multi-day occurrence is anchored once: start day, or the window first day', () => {
  const fm = eventFm({ uid: 'trip', dtstart: '2026-11-07', dtend: '2026-11-09', summary: 'Trip' });

  const inside = buildAgendaGroups(
    buildCalendarView([entry(fm)], { from: '2026-11-01', to: '2026-11-10' }),
    '2026-11-08',
  );
  const allOccurrences = inside.flatMap((g) => g.days.flatMap((d) => d.occurrences));
  assert.equal(allOccurrences.length, 1);
  assert.equal(inside[0].key, 'overdue');

  const midWindow = buildAgendaGroups(
    buildCalendarView([entry(fm)], { from: '2026-11-08', to: '2026-11-10' }),
    '2026-11-08',
  );
  assert.deepEqual(midWindow.map((g) => g.key), ['today']);
  assert.equal(midWindow[0].days[0].occurrences.length, 1);
});

// ── Grid ranges ───────────────────────────────────────────────────────────

test('weekRange starts on Monday and spans 7 days', () => {
  const week = weekRange('2026-11-08');
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-11-02');
  assert.equal(week[6], '2026-11-08');
});

test('monthGridRange is a fixed 42-day grid starting on Monday', () => {
  const grid = monthGridRange('2026-11-08');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-10-26');
  assert.equal(grid[41], '2026-12-06');
  // 2026-11-01 is a Sunday, so the grid starts six days earlier.
  assert.equal(grid.indexOf('2026-11-01'), 6);
});
