/**
 * M3 — reminder schedule tests.
 *
 * These pin the time semantics that the Rust loop relies on. "Local" cases
 * build the expected instant with the same device zone the implementation uses;
 * zone-specific cases use fixed-offset `Etc/GMT±n` ids so they assert a literal
 * UTC string and cannot drift with the machine's timezone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TASK_DUE_HOUR,
  alarmFireAt,
  buildReminderSchedule,
  isValidAlarmTrigger,
  parseAlarmDuration,
  taskDueBaseUtc,
} from './calendar-reminders';
import {
  calendarEventFromEntry,
  createCalendarEvent,
  type CalendarEntry,
  type CalendarEvent,
} from './calendar';
import { splitFrontmatter } from './frontmatter';

const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime(); // local noon, 2026-11-08

function localIso(y: number, m: number, d: number, hh: number, mm: number): string {
  return new Date(y, m - 1, d, hh, mm, 0).toISOString();
}

function eventEntry(fields: Record<string, unknown>, path = 'Calendar/event.md'): CalendarEntry {
  return { path, frontmatter: { type: 'event', uid: 'evt-1', ...fields }, tasks: [], mtime: 0 };
}

function taskEntry(text: string, done = false, path = 'Notes/tasks.md'): CalendarEntry {
  return { path, frontmatter: null, tasks: [{ line: 1, text, done }], mtime: 0 };
}

test('parseAlarmDuration handles the alarm subset', () => {
  assert.equal(parseAlarmDuration('-PT15M'), -15 * 60 * 1000);
  assert.equal(parseAlarmDuration('PT1H30M'), 90 * 60 * 1000);
  assert.equal(parseAlarmDuration('-P1D'), -24 * 60 * 60 * 1000);
  assert.equal(parseAlarmDuration('P2W'), 14 * 24 * 60 * 60 * 1000);
  assert.equal(parseAlarmDuration('-PT1H'), -60 * 60 * 1000);
  assert.equal(parseAlarmDuration('P'), null);
  assert.equal(parseAlarmDuration('nonsense'), null);
});

test('timed event in a zone: relative alarm offsets from the UTC start', () => {
  const start = alarmFireAt(
    '2026-11-08T14:00:00.000Z',
    '2026-11-08',
    'Etc/GMT+5',
    '-PT15M',
  );
  assert.equal(start, '2026-11-08T13:45:00.000Z');
});

test('timed event: clock alarm uses the event zone wall date', () => {
  const fire = alarmFireAt('2026-11-08T14:00:00.000Z', '2026-11-08', 'Etc/GMT+5', '09:00');
  assert.equal(fire, '2026-11-08T14:00:00.000Z');
});

test('all-day event: clock alarm is that day at the clock time', () => {
  const fire = alarmFireAt('2026-11-08T05:00:00.000Z', '2026-11-08', 'Etc/GMT+5', '09:00');
  assert.equal(fire, '2026-11-08T14:00:00.000Z');
});

test('all-day event: relative alarm counts back from midnight', () => {
  const fire = alarmFireAt('2026-11-08T05:00:00.000Z', '2026-11-08', 'Etc/GMT+5', '-PT15M');
  assert.equal(fire, '2026-11-08T04:45:00.000Z');
});

test('absolute alarm trigger is already an instant', () => {
  const fire = alarmFireAt('2026-11-08T14:00:00.000Z', '2026-11-08', null, '2026-11-08T12:00:00Z');
  assert.equal(fire, '2026-11-08T12:00:00.000Z');
});

test('unparsable trigger produces no reminder instead of a wrong time', () => {
  assert.equal(alarmFireAt('2026-11-08T14:00:00.000Z', '2026-11-08', null, 'tomorrow-ish'), null);
  assert.equal(alarmFireAt('2026-11-08T14:00:00.000Z', '2026-11-08', null, '25:00'), null);
});

test('task due date resolves to 09:00 device-local', () => {
  assert.equal(taskDueBaseUtc('2026-11-09'), localIso(2026, 11, 9, TASK_DUE_HOUR, 0));
  assert.equal(taskDueBaseUtc('2026-11-09T09:00'), null);
});

test('task reminders: clock, relative, and no-reminder cases', () => {
  const clock = buildReminderSchedule([taskEntry('Pay rent 📅 2026-11-09 ⏰ 09:00')], NOW);
  assert.equal(clock.length, 1);
  assert.equal(clock[0].fireAt, localIso(2026, 11, 9, 9, 0));
  assert.equal(clock[0].kind, 'task');

  const early = buildReminderSchedule([taskEntry('Pay rent 📅 2026-11-09 ⏰ -PT1H')], NOW);
  assert.equal(early[0].fireAt, localIso(2026, 11, 9, 8, 0));

  const none = buildReminderSchedule([taskEntry('Pay rent 📅 2026-11-09')], NOW);
  assert.equal(none.length, 0);

  const undated = buildReminderSchedule([taskEntry('Pay rent ⏰ 09:00')], NOW);
  assert.equal(undated.length, 0);
});

test('completed tasks never remind', () => {
  assert.equal(buildReminderSchedule([taskEntry('Pay rent 📅 2026-11-09 ⏰ 09:00', true)], NOW).length, 0);
});

test('event reminders are sorted, deduplicated, and past items dropped', () => {
  const entry = eventEntry({
    dtstart: '2026-11-08T14:00:00',
    alarms: ['-PT15M', '09:00'],
  });
  const items = buildReminderSchedule([entry], NOW, { notBeforeMs: 0 });
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.fireAt),
    [localIso(2026, 11, 8, 9, 0), localIso(2026, 11, 8, 13, 45)],
  );
  // The 09:00 alarm is before NOW (local noon) and must not be rescheduled.
  assert.equal(buildReminderSchedule([entry], NOW).length, 1);
});

test('recurring events produce one reminder per occurrence in the horizon', () => {
  const entry = eventEntry({
    dtstart: '2026-11-08T09:00:00',
    rrule: 'FREQ=DAILY',
    alarms: ['-PT15M'],
  });
  const items = buildReminderSchedule([entry], NOW);
  assert.equal(items.length, 8); // today + seven days
  assert.equal(items[0].fireAt, localIso(2026, 11, 9, 8, 45));
});

test('cancelled events produce no reminders', () => {
  const entry = eventEntry({
    dtstart: '2026-11-09T09:00:00',
    status: 'CANCELLED',
    alarms: ['09:00'],
  });
  assert.equal(buildReminderSchedule([entry], NOW).length, 0);
});

test('reminder ids stay stable across recomputes', () => {
  const entry = eventEntry({ dtstart: '2026-11-09T09:00:00', alarms: ['09:00'] });
  const a = buildReminderSchedule([entry], NOW);
  const b = buildReminderSchedule([entry], NOW + 60_000);
  assert.equal(a[0].id, b[0].id);
  assert.equal(a[0].id, `event:evt-1:${a[0].fireAt}`);
});

// ---------------------------------------------------------------------------
// Editor contract: the trigger validator and the alarm round-trip
// ---------------------------------------------------------------------------

function bareEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    kind: 'event',
    uid: 'evt-1',
    summary: 'Sync',
    description: '',
    notes: null,
    dtstart: '2026-11-09T09:00:00',
    dtend: '2026-11-09T10:00:00',
    tzid: null,
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
    source: 'local',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: 'Calendar/evt.md',
    mtime: 0,
    ...overrides,
  };
}

test('isValidAlarmTrigger agrees with alarmFireAt on both valid and invalid shapes', () => {
  const start = '2026-11-09T14:00:00.000Z';
  const valid = ['-PT15M', '09:00', '2026-11-09T12:00:00Z', '-P1D', 'PT0S'];
  for (const trigger of valid) {
    assert.equal(isValidAlarmTrigger(trigger), true, `valid: ${trigger}`);
    assert.notEqual(alarmFireAt(start, '2026-11-09', null, trigger), null, `resolves: ${trigger}`);
  }
  const invalid = ['', 'tomorrow', '25:00', 'P', 'PT', '  '];
  for (const trigger of invalid) {
    assert.equal(isValidAlarmTrigger(trigger), false, `invalid: ${trigger}`);
    assert.equal(alarmFireAt(start, '2026-11-09', null, trigger), null, `rejects: ${trigger}`);
  }
});

test('alarms survive a note round-trip with their action and order', () => {
  const event = bareEvent({
    alarms: [
      { trigger: '-PT15M', action: 'DISPLAY' },
      { trigger: '09:00', action: 'EMAIL' },
    ],
  });
  const text = createCalendarEvent(event, 'body text');
  const { data } = splitFrontmatter(text);
  const parsed = calendarEventFromEntry({
    path: 'Calendar/evt.md',
    frontmatter: data,
    tasks: [],
    mtime: 0,
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.alarms.map((a) => a.trigger), ['-PT15M', '09:00']);
  assert.deepEqual(parsed.alarms.map((a) => a.action), ['DISPLAY', 'EMAIL']);
});

test('an edited alarm set reaches the schedule (editor → note → reminders)', () => {
  const event = bareEvent({
    alarms: [
      { trigger: '-PT15M', action: 'DISPLAY' },
      { trigger: '09:00', action: 'DISPLAY' },
    ],
  });
  const { data } = splitFrontmatter(createCalendarEvent(event, ''));
  const items = buildReminderSchedule(
    [{ path: 'Calendar/evt.md', frontmatter: data, tasks: [], mtime: 0 }],
    NOW,
    { notBeforeMs: 0 },
  );
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.fireAt), [
    localIso(2026, 11, 9, 8, 45),
    localIso(2026, 11, 9, 9, 0),
  ]);
});

