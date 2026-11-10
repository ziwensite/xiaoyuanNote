import assert from 'node:assert/strict';
import test from 'node:test';

import { periodWindow, tasksInWindow, type WindowTaskLike } from './period-window';
import { periodAnchor, periodicPath, shiftPeriod, type PeriodConfig } from './periodic-notes';
import { isoDate } from './daily-notes';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const DAILY: PeriodConfig = { folder: 'Daily', format: 'YYYY-MM-DD.md', template: '' };
const WEEKLY: PeriodConfig = { folder: 'Weekly', format: 'YYYY-[W]WW.md', template: '' };
const MONTHLY: PeriodConfig = { folder: 'Monthly', format: 'YYYY-MM.md', template: '' };
const QUARTERLY: PeriodConfig = { folder: 'Quarterly', format: 'YYYY-[Q]Q.md', template: '' };
const YEARLY: PeriodConfig = { folder: 'Yearly', format: 'YYYY.md', template: '' };

const CONFIGS: Record<string, PeriodConfig> = {
  daily: DAILY,
  weekly: WEEKLY,
  monthly: MONTHLY,
  quarterly: QUARTERLY,
  yearly: YEARLY,
};

function task(due: string | null, done = false): WindowTaskLike & { id: string } {
  return { id: due ?? 'none', done, meta: { due } };
}

// P6: the window is the date range of one periodic note. These are pure, so
// boundaries are checkable without a workspace or a clock.

test('a daily window is the day itself', () => {
  const w = periodWindow('daily', day(2026, 11, 10));
  assert.equal(w.start, '2026-11-10');
  assert.equal(w.end, '2026-11-10');
  assert.equal(isoDate(w.anchor), '2026-11-10');
});

test('a weekly window runs from the week start to the day before the next', () => {
  // 2026-11-10 is a Tuesday; Monday-start weeks begin 2026-11-09.
  const monday = periodWindow('weekly', day(2026, 11, 10), 1);
  assert.equal(monday.start, '2026-11-09');
  assert.equal(monday.end, '2026-11-15');
  const sunday = periodWindow('weekly', day(2026, 11, 10), 0);
  assert.equal(sunday.start, '2026-11-08');
  assert.equal(sunday.end, '2026-11-14');
});

test('a week that straddles New Year keeps seven days', () => {
  // 2026-12-31 is a Thursday, so the Monday-start week begins 2026-12-28.
  const w = periodWindow('weekly', day(2026, 12, 31), 1);
  assert.equal(w.start, '2026-12-28');
  assert.equal(w.end, '2027-01-03');
});

test('month windows follow the real length of the month', () => {
  assert.deepEqual(
    [periodWindow('monthly', day(2026, 11, 10)).start, periodWindow('monthly', day(2026, 11, 10)).end],
    ['2026-11-01', '2026-11-30'],
  );
  assert.equal(periodWindow('monthly', day(2026, 2, 10)).end, '2026-02-28');
  // 2028 is a leap year: February has a 29th.
  assert.equal(periodWindow('monthly', day(2028, 2, 10)).end, '2028-02-29');
});

test('quarter and year windows span their months', () => {
  const q4 = periodWindow('quarterly', day(2026, 11, 10));
  assert.deepEqual([q4.start, q4.end], ['2026-10-01', '2026-12-31']);
  const q1 = periodWindow('quarterly', day(2026, 1, 1));
  assert.deepEqual([q1.start, q1.end], ['2026-01-01', '2026-03-31']);
  const y = periodWindow('yearly', day(2026, 11, 10));
  assert.deepEqual([y.start, y.end], ['2026-01-01', '2026-12-31']);
});

test('every window anchors on the date its periodic note is named after', () => {
  const d = day(2026, 11, 10);
  for (const kind of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const) {
    const w = periodWindow(kind, d, 1);
    assert.equal(isoDate(w.anchor), isoDate(periodAnchor(kind, d, 1)), kind);
    // Paging a window and opening the note from it must resolve the same file.
    assert.equal(periodicPath(kind, w.anchor, CONFIGS[kind]), periodicPath(kind, d, CONFIGS[kind]), kind);
  }
});

test('paging one period forward from mid-period still lands on an anchor', () => {
  const w = periodWindow('weekly', day(2026, 11, 10), 1);
  const next = periodWindow('weekly', shiftPeriod('weekly', w.anchor, 1), 1);
  assert.deepEqual([next.start, next.end], ['2026-11-16', '2026-11-22']);
  const prev = periodWindow('weekly', shiftPeriod('weekly', w.anchor, -1), 1);
  assert.deepEqual([prev.start, prev.end], ['2026-11-02', '2026-11-08']);
});

test('the filter keeps unfinished lines dated inside the window, boundaries included', () => {
  const w = periodWindow('weekly', day(2026, 11, 10), 1);
  const tasks = [
    task('2026-11-09'), // first day
    task('2026-11-12'),
    task('2026-11-15'), // last day
    task('2026-11-08'), // the day before
    task('2026-11-16'), // the day after
    task('2026-11-12', true), // done
    task(null), // undated: belongs to no period
  ];
  assert.deepEqual(
    tasksInWindow(tasks, w).map((x) => x.id),
    ['2026-11-09', '2026-11-12', '2026-11-15'],
  );
});

test('an empty window stays empty', () => {
  assert.deepEqual(tasksInWindow([], periodWindow('monthly', day(2026, 11, 10))), []);
  assert.deepEqual(
    tasksInWindow([task('2026-10-31'), task('2026-12-01')], periodWindow('monthly', day(2026, 11, 10))),
    [],
  );
});
