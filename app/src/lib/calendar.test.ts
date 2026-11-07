/**
 * M0 tests — calendar model, recurrence and the Markdown round-trip.
 *
 * Run from `app/`: `pnpm test` (node --test + type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalendarIndex,
  calendarTasksFromEntry,
  canonicalWall,
  createCalendarEvent,
  eventFromFrontmatter,
  expandOccurrences,
  normalizeWallTime,
  parseCalendarEvent,
  parseRRule,
  wallTimeToUtc,
  writeCalendarEvent,
  type CalendarEntry,
} from './calendar';

const note = (frontmatter: string, body = '') => `---\n${frontmatter}\n---\n${body}`;

test('parses a timed event and keeps the body verbatim', () => {
  const ev = parseCalendarEvent(
    'Calendar/weekly.md',
    note(
      [
        'type: event',
        'uid: evt-1',
        'dtstart: "2026-11-07T09:00:00"',
        'dtend: "2026-11-07T10:00:00"',
        'tzid: Asia/Shanghai',
        'summary: 周会',
        'location: 会议室 A',
        'alarms:',
        '  - trigger: -PT15M',
        '    action: DISPLAY',
      ].join('\n'),
      '议程正文',
    ),
  );

  assert.ok(ev);
  assert.equal(ev.uid, 'evt-1');
  assert.equal(ev.summary, '周会');
  assert.equal(ev.location, '会议室 A');
  assert.equal(ev.allDay, false);
  assert.equal(ev.tzid, 'Asia/Shanghai');
  assert.equal(ev.alarms[0].trigger, '-PT15M');
  assert.equal(ev.description, '议程正文');
});

test('all-day DTEND is exclusive, and a missing DTEND means one day', () => {
  const dated = parseCalendarEvent(
    'Calendar/holiday.md',
    note(['type: event', 'uid: e1', 'dtstart: "2026-11-07"', 'dtend: "2026-11-08"'].join('\n')),
  );
  assert.ok(dated);
  assert.equal(dated.allDay, true);
  assert.equal(dated.dtend, '2026-11-08');

  const noEnd = eventFromFrontmatter(
    { type: 'event', uid: 'e2', dtstart: '2026-11-07' },
    { path: 'Calendar/x.md' },
  );
  assert.ok(noEnd);
  assert.equal(noEnd.allDay, true);
  assert.equal(noEnd.dtend, '2026-11-08');

  // Unquoted YAML dates arrive as UTC-midnight Date objects.
  assert.equal(normalizeWallTime(new Date('2026-11-07T00:00:00.000Z')), '2026-11-07');
  assert.equal(
    normalizeWallTime(new Date('2026-11-07T09:00:00.000Z')),
    '2026-11-07T09:00:00',
  );
});

test('an all-day event occupies only its start day, not the exclusive end', () => {
  const entries: CalendarEntry[] = [
    {
      path: 'Calendar/holiday.md',
      name: 'holiday',
      mtime: 1,
      frontmatter: {
        type: 'event',
        uid: 'e1',
        dtstart: '2026-11-07',
        dtend: '2026-11-08',
        summary: '假期',
      },
    },
  ];

  const index = buildCalendarIndex(entries, { from: '2026-11-07', to: '2026-11-10' });
  assert.deepEqual(index.days.map((d) => d.date), ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.equal(index.days[0].events.length, 1);
  assert.equal(index.days[0].events[0].allDay, true);
  assert.equal(index.days[1].events.length, 0);
});

test('malformed frontmatter degrades safely', () => {
  assert.equal(parseCalendarEvent('x.md', 'no frontmatter here'), null);
  assert.equal(
    parseCalendarEvent('x.md', note(['type: event', 'dtstart: tomorrow'].join('\n'))),
    null,
  );
  assert.equal(
    parseCalendarEvent('x.md', note(['type: note', 'dtstart: "2026-11-07"'].join('\n'))),
    null,
  );
  // Broken YAML must not throw.
  assert.equal(parseCalendarEvent('x.md', '---\n: : :\n---\nbody'), null);

  const ev = eventFromFrontmatter(
    {
      type: 'event',
      dtstart: '2026-11-07',
      alarms: [{ trigger: '-PT15M' }, { foo: 'x' }, 'PT5M'],
      exdate: ['not-a-date', '2026-11-09'],
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  assert.deepEqual(ev.alarms.map((a) => a.trigger), ['-PT15M', 'PT5M']);
  assert.deepEqual(ev.exdate, ['2026-11-09']);
});

test('missing summary falls back to the note stem, never to undefined', () => {
  const ev = parseCalendarEvent(
    'Calendar/standup.md',
    note(['type: event', 'dtstart: "2026-11-07T09:00:00"'].join('\n')),
  );
  assert.ok(ev);
  assert.equal(ev.summary, 'standup');
});

test('wall time conversion: aware, floating and zoned', () => {
  assert.equal(wallTimeToUtc('2026-11-07T09:00:00Z'), '2026-11-07T09:00:00.000Z');
  assert.equal(wallTimeToUtc('2026-11-07T09:00:00+08:00'), '2026-11-07T01:00:00.000Z');
  // Asia/Shanghai has no DST in November.
  assert.equal(
    wallTimeToUtc('2026-11-07T09:00:00', 'Asia/Shanghai'),
    '2026-11-07T01:00:00.000Z',
  );
  // New York: EST (-05:00) after the November change, EDT (-04:00) in March.
  assert.equal(
    wallTimeToUtc('2026-11-07T09:00:00', 'America/New_York'),
    '2026-11-07T14:00:00.000Z',
  );
  assert.equal(
    wallTimeToUtc('2026-03-08T09:00:00', 'America/New_York'),
    '2026-03-08T13:00:00.000Z',
  );
  assert.equal(wallTimeToUtc('2026-11-07T09:00:00', 'Mars/Olympus'), null);
});

test('weekly RRULE honours BYDAY and COUNT', () => {
  const ev = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'weekly',
      dtstart: '2026-11-02T09:00:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5',
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  assert.deepEqual(parseRRule(ev.rrule)?.byDay, [0, 2]);

  const occ = expandOccurrences(ev, '2026-11-02', '2026-11-20');
  assert.deepEqual(occ.map((o) => o.start.slice(0, 10)), [
    '2026-11-02',
    '2026-11-04',
    '2026-11-09',
    '2026-11-11',
    '2026-11-16',
  ]);
});

test('EXDATE removes one occurrence without changing COUNT', () => {
  const ev = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'weekly',
      dtstart: '2026-11-02T09:00:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5',
      exdate: ['2026-11-09T09:00:00'],
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  const occ = expandOccurrences(ev, '2026-11-02', '2026-11-20');
  assert.deepEqual(occ.map((o) => o.start.slice(0, 10)), [
    '2026-11-02',
    '2026-11-04',
    '2026-11-11',
    '2026-11-16',
  ]);
});

test('UNTIL stops the series (date-only is inclusive)', () => {
  const ev = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'daily',
      dtstart: '2026-11-02T09:00:00',
      rrule: 'FREQ=DAILY;UNTIL=2026-11-06',
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  const occ = expandOccurrences(ev, '2026-11-01', '2026-11-10');
  assert.deepEqual(occ.map((o) => o.start.slice(0, 10)), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
  ]);
});

test('monthly recurrence skips invalid dates instead of rolling over', () => {
  const ev = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'monthly',
      dtstart: '2026-01-31T09:00:00',
      rrule: 'FREQ=MONTHLY;COUNT=4',
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  const occ = expandOccurrences(ev, '2026-01-01', '2026-09-01');
  assert.deepEqual(occ.map((o) => o.start.slice(0, 10)), [
    '2026-01-31',
    '2026-03-31',
    '2026-05-31',
    '2026-07-31',
  ]);
});

test('an invalid RRULE falls back to a single event', () => {
  const ev = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'bad',
      dtstart: '2026-11-07T09:00:00',
      rrule: 'BYDAY=MO',
    },
    { path: 'x.md' },
  );
  assert.ok(ev);
  assert.equal(parseRRule(ev.rrule), null);
  assert.equal(expandOccurrences(ev, '2026-11-01', '2026-11-10').length, 1);
});

test('an exception instance suppresses the master occurrence it replaces', () => {
  const master = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'series-1',
      dtstart: '2026-11-02T09:00:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5',
    },
    { path: 'master.md' },
  );
  const exception = eventFromFrontmatter(
    {
      type: 'event',
      uid: 'exception-1',
      series_uid: 'series-1',
      recurrence_id: '2026-11-09T09:00:00',
      dtstart: '2026-11-10T10:00:00',
    },
    { path: 'exception.md' },
  );
  assert.ok(master && exception);
  assert.equal(canonicalWall(exception.recurrenceId ?? ''), '2026-11-09T09:00:00');

  const occ = expandOccurrences(master, '2026-11-02', '2026-11-20', [exception]);
  assert.deepEqual(occ.map((o) => o.start.slice(0, 10)), [
    '2026-11-02',
    '2026-11-16',
  ]);
});

test('events and tasks coexist in the day buckets', () => {
  const entries: CalendarEntry[] = [
    {
      path: 'Calendar/meeting.md',
      name: 'meeting',
      mtime: 1,
      frontmatter: {
        type: 'event',
        uid: 'e1',
        dtstart: '2026-11-07T09:00:00',
        dtend: '2026-11-07T10:00:00',
        summary: '周会',
      },
    },
    {
      path: 'Calendar/holiday.md',
      name: 'holiday',
      mtime: 2,
      frontmatter: { type: 'event', uid: 'e2', dtstart: '2026-11-07', summary: '假期' },
    },
    {
      path: 'notes/todo.md',
      name: 'todo',
      mtime: 3,
      frontmatter: {},
      tasks: [
        { line: 3, text: '交周报 📅 2026-11-07', done: false },
        { line: 7, text: '无日期任务 🆔 abc12345 ⏰ -PT15M', done: false },
      ],
    },
  ];

  const index = buildCalendarIndex(entries, { from: '2026-11-07', to: '2026-11-09' });
  assert.equal(index.days.length, 2);
  assert.equal(index.days[0].events.length, 2);
  // All-day first, then the timed event.
  assert.deepEqual(index.days[0].events.map((e) => e.summary), ['假期', '周会']);
  assert.equal(index.days[0].tasks.length, 1);
  assert.equal(index.days[1].events.length, 0);
  assert.equal(index.days[1].tasks.length, 0);
  assert.equal(index.undatedTasks.length, 1);
  assert.equal(index.undatedTasks[0].uid, 'abc12345');
  assert.deepEqual(index.undatedTasks[0].reminders, ['-PT15M']);
});

test('task projection keeps calendar metadata', () => {
  const [task] = calendarTasksFromEntry({
    path: 'n.md',
    frontmatter: {},
    tasks: [{ line: 9, text: 'review 🔁 FREQ=WEEKLY;BYDAY=MO ⏰ 09:00', done: true }],
  });
  assert.equal(task.kind, 'task');
  assert.equal(task.done, true);
  assert.equal(task.line, 9);
  assert.equal(task.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.deepEqual(task.reminders, ['09:00']);
  assert.equal(task.uid, null);
});

test('writing an event preserves body bytes and unrelated frontmatter keys', () => {
  const before = note(
    [
      'type: event',
      'uid: evt-1',
      'dtstart: "2026-11-07T09:00:00"',
      'summary: 旧标题',
      'custom: keep-me',
    ].join('\n'),
    '\nBody line 1\n\nBody line 2\n',
  );

  const ev = parseCalendarEvent('x.md', before);
  assert.ok(ev);
  ev.summary = '新标题';
  ev.dtstart = '2026-11-08T09:00:00';
  ev.dtend = '2026-11-08T10:00:00';

  const after = writeCalendarEvent(before, ev);
  assert.match(after, /custom: keep-me/);
  assert.match(after, /summary: 新标题/);

  const reparsed = parseCalendarEvent('x.md', after);
  assert.ok(reparsed);
  assert.equal(reparsed.summary, '新标题');
  assert.equal(reparsed.dtstart, '2026-11-08T09:00:00');
  assert.equal(reparsed.dtend, '2026-11-08T10:00:00');
  // The body is untouched — including its leading blank line.
  assert.equal(reparsed.description, '\nBody line 1\n\nBody line 2\n');
});

test('creating a new event note produces parseable frontmatter', () => {
  const text = createCalendarEvent(
    {
      kind: 'event',
      uid: 'new-1',
      summary: '新会议',
      description: '',
      dtstart: '2026-11-09T14:00:00',
      dtend: '2026-11-09T15:00:00',
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
      source: 'local',
      remoteHref: null,
      etag: null,
      sequence: 0,
      path: 'Calendar/new.md',
      mtime: 0,
    },
    '备注',
  );

  const ev = parseCalendarEvent('Calendar/new.md', text);
  assert.ok(ev);
  assert.equal(ev.uid, 'new-1');
  assert.equal(ev.summary, '新会议');
  // `createCalendarEvent` inserts the conventional blank line after the block;
  // the description is the verbatim body, so it starts with that newline.
  assert.equal(ev.description, '\n备注');
});
