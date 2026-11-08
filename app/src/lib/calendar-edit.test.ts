/**
 * M2 tests — pure edit arithmetic and write-back decisions.
 *
 * No Vue and no Tauri: snapping, cross-day moves, resize, conflict detection,
 * month shifting and the preference format.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shiftMonth, writeCalendarEvent, type CalendarEvent } from './calendar';
import {
  allDaySpanDays,
  applyEventTimes,
  eventDurationMinutes,
  moveOccurrence,
  planCalendarWrite,
  resizeOccurrence,
  snapToQuarter,
  wallAt,
} from './calendar-edit';
import { parseCalendarPrefs, serializeCalendarPrefs } from './calendar-prefs';

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    kind: 'event',
    uid: 'uid-1',
    summary: 'Standup',
    description: '',
    notes: null,
    dtstart: '2026-11-08T09:00:00',
    dtend: '2026-11-08T10:00:00',
    tzid: 'Asia/Shanghai',
    allDay: false,
    status: 'CONFIRMED',
    categories: [],
    location: null,
    rrule: null,
    exdate: [],
    seriesUid: null,
    recurrenceId: null,
    alarms: [],
    relatedNote: null,
    source: 'note',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: 'Calendar/standup.md',
    mtime: 0,
    ...over,
  };
}

test('snapToQuarter: 14/15/16 minutes all land on 15', () => {
  assert.equal(snapToQuarter(14), 15);
  assert.equal(snapToQuarter(15), 15);
  assert.equal(snapToQuarter(16), 15);
  assert.equal(snapToQuarter(0), 0);
  assert.equal(snapToQuarter(1440), 1440);
  assert.equal(snapToQuarter(-3), 0);
});

test('moveOccurrence snaps the delta and keeps the duration', () => {
  const ev = event({ dtstart: '2026-11-08T09:00:00', dtend: '2026-11-08T10:30:00' });
  for (const delta of [14, 15, 16]) {
    const moved = moveOccurrence(ev, ev.dtstart, '2026-11-09', delta);
    assert.equal(moved.dtstart, '2026-11-09T09:15:00');
    assert.equal(moved.dtend, '2026-11-09T10:45:00');
  }
});

test('moveOccurrence keeps an overnight event across a day change', () => {
  const ev = event({ dtstart: '2026-11-08T23:00:00', dtend: '2026-11-09T00:30:00' });
  assert.equal(eventDurationMinutes(ev), 90);
  const moved = moveOccurrence(ev, ev.dtstart, '2026-11-12', 0);
  assert.equal(moved.dtstart, '2026-11-12T23:00:00');
  assert.equal(moved.dtend, '2026-11-13T00:30:00');
  const later = moveOccurrence(ev, ev.dtstart, '2026-11-12', 30);
  assert.equal(later.dtstart, '2026-11-12T23:30:00');
  assert.equal(later.dtend, '2026-11-13T01:00:00');
});

test('moveOccurrence moves all-day events by whole dates and keeps the span', () => {
  const ev = event({
    allDay: true,
    dtstart: '2026-11-07',
    dtend: '2026-11-09',
  });
  assert.equal(allDaySpanDays(ev), 2);
  const moved = moveOccurrence(ev, '2026-11-07', '2026-11-10', 0);
  assert.equal(moved.dtstart, '2026-11-10');
  assert.equal(moved.dtend, '2026-11-12');
});

test('resizeOccurrence changes only the end and never crosses the start', () => {
  const ev = event({ dtstart: '2026-11-08T09:00:00', dtend: '2026-11-08T10:00:00' });
  for (const delta of [14, 15, 16]) {
    const resized = resizeOccurrence(ev, ev.dtstart, delta);
    assert.ok(resized);
    assert.equal(resized.dtstart, '2026-11-08T09:00:00');
    assert.equal(resized.dtend, '2026-11-08T10:15:00');
  }
  const tiny = resizeOccurrence(ev, ev.dtstart, -600);
  assert.ok(tiny);
  assert.equal(tiny.dtstart, '2026-11-08T09:00:00');
  assert.equal(tiny.dtend, '2026-11-08T09:15:00');
  assert.equal(resizeOccurrence(event({ allDay: true, dtstart: '2026-11-08' }), '2026-11-08', 0), null);
});

test('wallAt rolls past midnight', () => {
  assert.equal(wallAt('2026-11-08', 23 * 60 + 45), '2026-11-08T23:45:00');
  assert.equal(wallAt('2026-11-08', 25 * 60), '2026-11-09T01:00:00');
  assert.equal(wallAt('2026-11-08', -15), '2026-11-07T23:45:00');
});

test('planCalendarWrite: unchanged disk writes, externally changed disk conflicts', () => {
  const snapshot = '# Event\n';
  assert.equal(planCalendarWrite(snapshot, snapshot, '# Edited\n'), 'write');
  assert.equal(planCalendarWrite('# Edited\n', snapshot, '# Edited\n'), 'write');
  assert.equal(planCalendarWrite('# Outside\n', snapshot, '# Edited\n'), 'conflict');
  // CRLF on disk is the same content, not an outside change.
  assert.equal(planCalendarWrite('# Event\r\n', snapshot, '# Edited\n'), 'write');
});

test('writeCalendarEvent updates frontmatter and leaves the body byte-identical', () => {
  const body = '\n\n# Notes\nkeep me\n';
  const text = `---\ntype: event\nuid: uid-1\ndtstart: 2026-11-08T09:00:00\ndtend: 2026-11-08T10:00:00\n---${body}`;
  const moved = applyEventTimes(
    event(),
    moveOccurrence(event(), '2026-11-08T09:00:00', '2026-11-09', 15),
  );
  const next = writeCalendarEvent(text, moved);
  assert.match(next, /dtstart: '2026-11-09T09:15:00'/);
  assert.ok(next.endsWith(body));
  assert.equal(next.slice(next.indexOf('\n---') + 4), body);

  const withNotes = writeCalendarEvent(text, { ...event(), notes: 'bring slides' });
  assert.match(withNotes, /description: bring slides/);
  assert.ok(withNotes.endsWith(body));
});

test('shiftMonth keeps the day and clamps short months', () => {
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftMonth('2025-12-15', 1), '2026-01-15');
  assert.equal(shiftMonth('2026-03-31', -1), '2026-02-28');
  assert.equal(shiftMonth('2026-11-08', 0), '2026-11-08');
});

test('calendar preference format round-trips and rejects garbage', () => {
  const pref = parseCalendarPrefs(serializeCalendarPrefs({ focusDate: '2026-11-08', view: 'week' }), '2026-01-01');
  assert.deepEqual(pref, { focusDate: '2026-11-08', view: 'week' });
  assert.deepEqual(parseCalendarPrefs('{oops', '2026-01-01'), { focusDate: '2026-01-01', view: 'month' });
  assert.deepEqual(
    parseCalendarPrefs('{"focusDate":"bad","view":"year"}', '2026-01-01'),
    { focusDate: '2026-01-01', view: 'month' },
  );
});
