/**
 * M3 — "this occurrence only" exception notes.
 *
 * The rule under test: an exception must carry `series_uid` (master UID) and
 * `recurrence_id` (the original occurrence start), otherwise the calendar
 * renders the master occurrence *and* the exception — the same meeting twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarEventFromEntry,
  calendarEventFrontmatter,
  createCalendarEvent,
  makeExceptionEvent,
  type CalendarEntry,
  type CalendarEvent,
} from './calendar';
import { buildCalendarView } from './calendar-view';

function master(): CalendarEvent {
  return {
    kind: 'event',
    uid: 'series-1',
    summary: 'Weekly sync',
    description: '',
    notes: null,
    dtstart: '2026-11-02T09:00:00',
    dtend: '2026-11-02T10:00:00',
    tzid: null,
    allDay: false,
    status: 'CONFIRMED',
    categories: ['work'],
    location: 'Room 3',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    exdate: [],
    seriesUid: null,
    recurrenceId: null,
    alarms: [{ trigger: '-PT15M', action: 'DISPLAY' }],
    relatedNote: null,
    source: 'local',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: 'Calendar/weekly.md',
    mtime: 0,
  };
}

function exception() {
  return makeExceptionEvent(master(), '2026-11-09T09:00:00', {
    summary: 'Weekly sync (moved)',
    dtstart: '2026-11-10T10:00:00',
    dtend: '2026-11-10T11:00:00',
  });
}

function entry(path: string, event: CalendarEvent): CalendarEntry {
  return { path, frontmatter: calendarEventFrontmatter(event), tasks: [], mtime: 0 };
}

/** `CalendarViewDay` splits occurrences into all-day chips and timed blocks. */
function eventsOn(day: { allDay: unknown[]; timed: Array<{ occurrence: unknown }> } | undefined): number {
  if (!day) return 0;
  return day.allDay.length + day.timed.length;
}

test('exception keeps the series link and drops recurrence', () => {
  const exc = exception();
  assert.equal(exc.seriesUid, 'series-1');
  assert.equal(exc.recurrenceId, '2026-11-09T09:00:00');
  assert.equal(exc.rrule, null);
  assert.deepEqual(exc.exdate, []);
  assert.notEqual(exc.uid, 'series-1');
  // Series-wide metadata is inherited.
  assert.equal(exc.alarms.length, 1);
  assert.deepEqual(exc.categories, ['work']);
});

test('exception note frontmatter writes series_uid and recurrence_id', () => {
  const text = createCalendarEvent(exception(), '');
  assert.match(text, /series_uid: series-1/);
  assert.match(text, /recurrence_id: ['"]?2026-11-09T09:00:00/);
  // Round-trip: the parser must see the same pair.
  const parsed = calendarEventFromEntry({
    path: 'Calendar/weekly-2026-11-09.md',
    frontmatter: calendarEventFrontmatter(exception()),
    tasks: [],
    mtime: 0,
  });
  assert.ok(parsed);
  assert.equal(parsed.seriesUid, 'series-1');
  assert.equal(parsed.recurrenceId, '2026-11-09T09:00:00');
  assert.equal(parsed.rrule, null);
});

test('exception replaces the master occurrence instead of doubling it', () => {
  const exc = exception();
  const days = buildCalendarView(
    [entry('Calendar/weekly.md', master()), entry('Calendar/weekly-2026-11-09.md', exc)],
    { from: '2026-11-01', to: '2026-11-16' },
  ).days;
  const nov9 = days.find((d) => d.date === '2026-11-09');
  const nov10 = days.find((d) => d.date === '2026-11-10');
  assert.equal(eventsOn(nov9), 0, 'master occurrence must be suppressed');
  assert.equal(eventsOn(nov10), 1, 'exception must be shown once');
  assert.equal(nov10?.timed[0].occurrence.summary, 'Weekly sync (moved)');
});

test('without series_uid/recurrence_id the occurrence is shown twice', () => {
  const exc = exception();
  const naked: CalendarEvent = {
    ...exc,
    uid: 'detached-1',
    seriesUid: null,
    recurrenceId: null,
  };
  const days = buildCalendarView(
    [entry('Calendar/weekly.md', master()), entry('Calendar/detached.md', naked)],
    { from: '2026-11-01', to: '2026-11-16' },
  ).days;
  const nov9 = days.find((d) => d.date === '2026-11-09');
  assert.equal(eventsOn(nov9), 1, 'master occurrence is not suppressed');
});

test('all-day exception keeps the date-only recurrence id', () => {
  const allDay = {
    ...master(),
    allDay: true,
    dtstart: '2026-11-02',
    dtend: '2026-11-03',
  };
  const exc = makeExceptionEvent(allDay, '2026-11-09', {
    dtstart: '2026-11-11',
    dtend: '2026-11-12',
  });
  assert.equal(exc.recurrenceId, '2026-11-09');
  assert.equal(exc.allDay, true);
  const days = buildCalendarView(
    [entry('Calendar/weekly.md', allDay), entry('Calendar/exc.md', exc)],
    { from: '2026-11-01', to: '2026-11-16' },
  ).days;
  assert.equal(eventsOn(days.find((d) => d.date === '2026-11-09')), 0);
  assert.equal(eventsOn(days.find((d) => d.date === '2026-11-11')), 1);
});
