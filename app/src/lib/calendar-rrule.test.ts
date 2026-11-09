import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  expandOccurrences,
  explainRRule,
  nextTaskDueDate,
  parseRRule,
  type CalendarEvent,
} from './calendar';

function event(dtstart: string, rrule: string): CalendarEvent {
  return {
    kind: 'event',
    uid: 'series-1',
    summary: 'Standup',
    description: '',
    dtstart,
    dtend: null,
    tzid: null,
    allDay: false,
    status: 'CONFIRMED',
    categories: [],
    location: null,
    rrule,
    exdate: [],
    seriesUid: null,
    recurrenceId: null,
    alarms: [],
    relatedNote: null,
    source: 'local',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: '',
    mtime: 0,
  };
}

function dates(dtstart: string, rrule: string, from: string, to: string): string[] {
  return expandOccurrences(event(dtstart, rrule), from, to).map((occ) => occ.start.slice(0, 10));
}

test('BYDAY ordinal: second Tuesday of every month', () => {
  assert.deepEqual(
    dates('2026-01-13T09:00:00', 'FREQ=MONTHLY;BYDAY=2TU', '2026-11-01', '2027-02-01'),
    ['2026-11-10', '2026-12-08', '2027-01-12'],
  );
});

// ---------------------------------------------------------------------------
// nextTaskDueDate — the day a completed recurring task moves to
// ---------------------------------------------------------------------------

test('a daily task crosses month and year boundaries', () => {
  assert.equal(nextTaskDueDate('2026-01-31', 'FREQ=DAILY'), '2026-02-01');
  assert.equal(nextTaskDueDate('2026-12-31', 'FREQ=DAILY'), '2027-01-01');
});

test('a daily task steps onto a leap day and off it', () => {
  assert.equal(nextTaskDueDate('2028-02-28', 'FREQ=DAILY'), '2028-02-29');
  assert.equal(nextTaskDueDate('2028-02-29', 'FREQ=DAILY'), '2028-03-01');
});

test('a yearly task on 29 February waits for the next leap year', () => {
  assert.equal(nextTaskDueDate('2028-02-29', 'FREQ=YEARLY'), '2032-02-29');
});

test('weekly BYDAY and INTERVAL pick the next matching date', () => {
  assert.equal(nextTaskDueDate('2026-11-06', 'FREQ=WEEKLY;BYDAY=FR'), '2026-11-13');
  assert.equal(nextTaskDueDate('2026-11-02', 'FREQ=WEEKLY;INTERVAL=2'), '2026-11-16');
});

test('monthly ordinal BYDAY advances to next month', () => {
  assert.equal(nextTaskDueDate('2026-11-10', 'FREQ=MONTHLY;BYDAY=2TU'), '2026-12-08');
});

test('UNTIL and COUNT end the series instead of inventing a date', () => {
  assert.equal(nextTaskDueDate('2026-11-01', 'FREQ=DAILY;UNTIL=20261101'), null);
  assert.equal(nextTaskDueDate('2026-11-01', 'FREQ=DAILY;COUNT=1'), null);
});

test('an unparsable rule or a non-date due produces nothing', () => {
  assert.equal(nextTaskDueDate('2026-11-01', 'FREQ=FORTNIGHTLY'), null);
  assert.equal(nextTaskDueDate('2026-11-01T09:00', 'FREQ=DAILY'), null);
});

test('BYDAY negative ordinal: last Friday of every month', () => {
  assert.deepEqual(
    dates('2026-01-30T09:00:00', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-11-01', '2027-02-01'),
    ['2026-11-27', '2026-12-25', '2027-01-29'],
  );
});

test('BYDAY ordinal keeps counting across the year boundary', () => {
  assert.deepEqual(
    dates('2026-01-15T09:00:00', 'FREQ=MONTHLY;BYDAY=3TH', '2026-11-01', '2027-03-01'),
    ['2026-11-19', '2026-12-17', '2027-01-21', '2027-02-18'],
  );
});

test('BYSETPOS=1 picks the first weekday of each month', () => {
  assert.deepEqual(
    dates(
      '2026-11-02T09:00:00',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1',
      '2026-11-01',
      '2027-02-01',
    ),
    ['2026-11-02', '2026-12-01', '2027-01-01'],
  );
});

test('BYSETPOS=-1 picks the last weekday of each month', () => {
  assert.deepEqual(
    dates(
      '2026-11-30T09:00:00',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      '2026-11-01',
      '2027-02-01',
    ),
    ['2026-11-30', '2026-12-31', '2027-01-29'],
  );
});

test('fully supported rules report no warning', () => {
  const explained = explainRRule('FREQ=MONTHLY;BYDAY=-1FR;BYSETPOS=1');
  assert.equal(explained.rule?.freq, 'MONTHLY');
  assert.deepEqual(explained.unsupported, []);
  assert.deepEqual(parseRRule('FREQ=MONTHLY;BYDAY=2TU')?.byDay, [1]);
});

test('an unknown rule part is reported instead of silently dropped', () => {
  const explained = explainRRule('FREQ=MONTHLY;BYDAY=2TU;BYHOUR=9');
  assert.deepEqual(explained.unsupported, ['BYHOUR=9']);
  // The supported part still expands, but the caller must show the warning.
  assert.equal(explained.rule?.freq, 'MONTHLY');
  assert.equal(
    expandOccurrences(
      event('2026-01-13T09:00:00', 'FREQ=MONTHLY;BYDAY=2TU;BYHOUR=9'),
      '2026-11-01',
      '2026-12-01',
    ).length,
    1,
  );
});

test('an ordinal on a weekly rule is reported as a lossy downgrade', () => {
  const explained = explainRRule('FREQ=WEEKLY;BYDAY=2TU');
  assert.deepEqual(explained.unsupported, ['BYDAY=2TU']);
  const expanded = expandOccurrences(
    event('2026-11-03T09:00:00', 'FREQ=WEEKLY;BYDAY=2TU'),
    '2026-11-01',
    '2026-11-30',
  ).map((occ) => occ.start.slice(0, 10));
  assert.deepEqual(expanded, ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
});

test('an unsupported FREQ yields no rule and an explicit warning', () => {
  assert.deepEqual(explainRRule('FREQ=HOURLY'), {
    rule: null,
    unsupported: ['FREQ=HOURLY'],
  });
  // M0 behaviour: no FREQ at all still means "not a recurring event".
  assert.equal(parseRRule('BYDAY=MO'), null);
});

test('BYSETPOS without another BY-rule is reported', () => {
  const explained = explainRRule('FREQ=MONTHLY;BYSETPOS=1');
  assert.equal(explained.rule?.bySetPos, null);
  assert.deepEqual(explained.unsupported, ['BYSETPOS=1']);
});
