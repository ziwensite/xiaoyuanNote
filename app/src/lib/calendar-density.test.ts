import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dailyNoteDates, dayDensity } from './calendar-density';
import type { CalendarViewDay } from './calendar-view';
import type { CalendarTask } from './calendar';

function task(done: boolean): CalendarTask {
  return {
    kind: 'task',
    uid: null,
    title: done ? 'done' : 'open',
    done,
    due: '2026-11-08',
    priority: null,
    reminders: [],
    rrule: null,
    path: 'note.md',
    line: 1,
    mtime: 0,
  };
}

function day(partial: Partial<CalendarViewDay>): CalendarViewDay {
  return { date: '2026-11-08', allDay: [], timed: [], tasks: [], ...partial };
}

/** An occurrence only needs to exist for the event count; fields are unused. */
function occurrence(): CalendarViewDay['allDay'][number] {
  return { start: '2026-11-08T09:00:00', allDay: true } as unknown as CalendarViewDay['allDay'][number];
}

test('density: an unfinished task outranks finished tasks and notes', () => {
  const density = dayDensity(day({ tasks: [task(true), task(false)] }), true);
  assert.equal(density.state, 'open');
  assert.equal(density.total, 2);
  assert.equal(density.done, 1);
  assert.equal(density.todo, 1);
});

test('density: all tasks finished beats a note on the same day', () => {
  const density = dayDensity(day({ tasks: [task(true), task(true)] }), true);
  assert.equal(density.state, 'done');
  assert.equal(density.todo, 0);
});

test('density: a note-only day is grey, an empty day has no mark', () => {
  assert.equal(dayDensity(day({}), true).state, 'note');
  assert.equal(dayDensity(day({}), false).state, 'none');
});

test('density: an event counts as a note when no daily note exists', () => {
  const density = dayDensity(day({ allDay: [occurrence()] }), false);
  assert.equal(density.state, 'note');
  assert.equal(density.events, 1);
  assert.equal(density.hasNote, true);
});

test('dailyNoteDates resolves the configured folder and format', () => {
  const files = [
    { path: 'C:\\Notes\\Daily\\2026-11-08.md' },
    { path: 'C:\\Notes\\Journal\\2026-11-08.md' },
    { path: 'C:\\Notes\\Daily\\2026-11-09.md' },
  ];
  const dates = ['2026-11-08', '2026-11-09', '2026-11-10'];
  const found = dailyNoteDates(files, dates, 'C:\\Notes', 'Daily', 'YYYY-MM-DD.md');
  assert.deepEqual([...found].sort(), ['2026-11-08', '2026-11-09']);
});

test('dailyNoteDates returns nothing without a workspace', () => {
  const found = dailyNoteDates(
    [{ path: 'C:\\Notes\\Daily\\2026-11-08.md' }],
    ['2026-11-08'],
    null,
    'Daily',
    'YYYY-MM-DD.md',
  );
  assert.equal(found.size, 0);
});
