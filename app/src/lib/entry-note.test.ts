/**
 * P4 tests — D1 = B: a heavy entry's note is a pointer + extras, and the line
 * it points at stays the single authority for the shared fields.
 *
 * Run from `app/`: `pnpm test` (node --test + type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalendarMaterial,
  createEntryEventNote,
  entryEventFrontmatter,
  lineFromCalendarEvent,
  newEntryLine,
  writeEntryEventNote,
  type CalendarEntry,
  type CalendarEvent,
} from './calendar';
import { parseTaskLine } from './task-line';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    kind: 'event',
    uid: 'evt-1',
    summary: '评审',
    description: '',
    notes: null,
    dtstart: '2026-11-12T09:00:00',
    dtend: '2026-11-12T10:00:00',
    tzid: null,
    allDay: false,
    status: 'CONFIRMED',
    categories: ['work'],
    location: null,
    rrule: null,
    exdate: [],
    seriesUid: null,
    recurrenceId: null,
    alarms: [{ trigger: '-PT15M', action: 'DISPLAY' }],
    relatedNote: null,
    source: 'local',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: 'Calendar/2026-11-12-评审-abc12345.md',
    mtime: 1,
    ...overrides,
  };
}

function dailyNote(tasks: Array<{ line: number; text: string }>): CalendarEntry {
  return {
    path: 'Daily/2026-11-10.md',
    name: '2026-11-10',
    mtime: 1,
    frontmatter: null,
    tasks: tasks.map((task) => ({ ...task, done: false })),
  };
}

function pointerEntry(frontmatter: Record<string, unknown>): CalendarEntry {
  return {
    path: 'Calendar/2026-11-12-评审-abc12345.md',
    name: '2026-11-12-评审-abc12345',
    mtime: 2,
    frontmatter,
  };
}

test('a pointer note joins its line: shared fields from the line, extras from the note', () => {
  const material = buildCalendarMaterial([
    dailyNote([{ line: 3, text: '- [ ] 评审 #work 📅 2026-11-12 ⏰ -PT15M 🆔 abc12345' }]),
    pointerEntry({
      type: 'event',
      uid: 'evt-1',
      entry_uid: 'abc12345',
      start_time: '09:00',
      end_time: '10:00',
      location: '会议室 A',
      description: '短备注',
    }),
  ]);

  assert.equal(material.events.length, 1);
  const projection = material.events[0];
  assert.equal(projection.summary, '评审');
  assert.deepEqual(projection.categories, ['work']);
  assert.equal(projection.dtstart, '2026-11-12T09:00:00');
  assert.equal(projection.dtend, '2026-11-12T10:00:00');
  assert.equal(projection.location, '会议室 A');
  assert.equal(projection.notes, '短备注');
  assert.equal(projection.entryUid, 'abc12345');
  assert.deepEqual(
    projection.alarms.map((alarm) => alarm.trigger),
    ['-PT15M'],
  );
  // The line is already on the grid as an event; it must not also be a task row.
  assert.deepEqual(material.tasks, []);
  assert.equal(material.lines.get('abc12345')?.path, 'Daily/2026-11-10.md');
});

test('a legacy note without a pointer renders from its own frontmatter', () => {
  const material = buildCalendarMaterial([
    dailyNote([{ line: 1, text: '- [ ] 独立任务 📅 2026-11-12' }]),
    pointerEntry({
      type: 'event',
      uid: 'legacy-1',
      dtstart: '2026-11-12T09:00:00',
      dtend: '2026-11-12T10:00:00',
      summary: '旧事件',
      categories: ['old'],
    }),
  ]);

  assert.equal(material.events.length, 1);
  assert.equal(material.events[0].summary, '旧事件');
  assert.deepEqual(material.events[0].categories, ['old']);
  assert.equal(material.events[0].entryUid, null);
  // No pointer → nothing is claimed → the unrelated task is untouched.
  assert.equal(material.tasks.length, 1);
});

test('a pointer whose line is gone falls back to its own frontmatter, and the orphan line stays a task', () => {
  const material = buildCalendarMaterial([
    dailyNote([{ line: 1, text: '- [ ] 孤行 📅 2026-11-12 🆔 gone0001' }]),
    pointerEntry({
      type: 'event',
      uid: 'evt-2',
      entry_uid: 'missing1',
      start_time: '09:00',
      end_time: '10:00',
    }),
  ]);

  // An extras-only note has no dtstart, so the fallback cannot invent a date.
  assert.deepEqual(material.events, []);
  assert.equal(material.tasks.length, 1);
  assert.equal(material.tasks[0].uid, 'gone0001');
});

test('an all-day pointer joins the date from the line and keeps multi-day spans', () => {
  const material = buildCalendarMaterial([
    dailyNote([{ line: 2, text: '- [ ] 培训 #work 📅 2026-11-20 🆔 full0001' }]),
    pointerEntry({
      type: 'event',
      uid: 'evt-3',
      entry_uid: 'full0001',
      all_day: true,
      end_time: '2026-11-22',
      location: 'B 栋',
    }),
  ]);

  const projection = material.events[0];
  assert.equal(projection.allDay, true);
  assert.equal(projection.dtstart, '2026-11-20');
  assert.equal(projection.dtend, '2026-11-22');
});

test('extras frontmatter never carries the shared fields', () => {
  const fm = entryEventFrontmatter(
    event({ rrule: 'FREQ=WEEKLY', notes: '备注', location: 'A' }),
    'abc12345',
  );

  for (const key of ['summary', 'dtstart', 'dtend', 'rrule', 'categories', 'alarms']) {
    assert.equal(key in fm, false, `${key} must stay on the line`);
  }
  assert.equal(fm.entry_uid, 'abc12345');
  assert.equal(fm.start_time, '09:00');
  assert.equal(fm.end_time, '10:00');
  assert.equal(fm.description, '备注');
  assert.equal(fm.location, 'A');
});

test('two identical saves of a pointer note are byte-identical', () => {
  const created = createEntryEventNote(event({ notes: '备注' }), 'abc12345', '正文');
  const once = writeEntryEventNote(created, event({ notes: '备注' }), 'abc12345');
  const twice = writeEntryEventNote(once, event({ notes: '备注' }), 'abc12345');
  assert.equal(once, twice);
  assert.ok(once.includes('正文'));
});

test('saving a legacy note removes the stale copies and adds the pointer', () => {
  const legacy = [
    '---',
    'type: event',
    'uid: evt-1',
    'summary: 旧标题',
    'dtstart: "2026-11-12T09:00:00"',
    'dtend: "2026-11-12T10:00:00"',
    'rrule: FREQ=WEEKLY',
    'categories:',
    '  - old',
    'alarms:',
    '  - trigger: -PT15M',
    '    action: DISPLAY',
    '---',
    '',
    '正文保持',
  ].join('\n');

  const next = writeEntryEventNote(legacy, event({ rrule: 'FREQ=WEEKLY' }), 'abc12345');
  for (const key of ['summary', 'dtstart', 'dtend', 'rrule', 'categories', 'alarms']) {
    assert.equal(new RegExp(`^${key}:`, 'm').test(next), false, `${key} should be gone`);
  }
  assert.match(next, /^entry_uid: abc12345$/m);
  assert.match(next, /^start_time: '?09:00'?$/m);
  assert.match(next, /正文保持/);
});

test('a line edit rewrites shared fields and keeps task-only tokens', () => {
  const line = '- [ ] 旧标题 ⏫ 📅 2026-11-01 ⏳ 2026-11-02 🆔 abc12345';
  const next = lineFromCalendarEvent(line, event({ summary: '新标题' }));

  assert.ok(next);
  const model = parseTaskLine(next!);
  assert.ok(model);
  assert.equal(model!.description, '新标题');
  assert.deepEqual(model!.tags, ['work']);
  assert.equal(model!.due, '2026-11-12');
  assert.deepEqual(model!.reminders, ['-PT15M']);
  assert.equal(model!.priority, '⏫');
  assert.equal(model!.scheduled, '2026-11-02');
  assert.equal(model!.id, 'abc12345');
});

test('a natural-language rule is kept when it still compiles to the same rule', () => {
  const line = '- [ ] 评审 🔁 every week 📅 2026-11-12 🆔 abc12345';
  const next = lineFromCalendarEvent(line, event({ rrule: 'FREQ=WEEKLY' }));
  assert.ok(next);
  assert.match(next!, /🔁 every week/);
  assert.equal(parseTaskLine(next!)?.recurrence, 'every week');
});

test('a rule the natural text cannot express is written back as iCal', () => {
  const line = '- [ ] 评审 🔁 every week 📅 2026-11-12 🆔 abc12345';
  const next = lineFromCalendarEvent(line, event({ rrule: 'FREQ=WEEKLY;UNTIL=20261231T235959Z' }));
  assert.ok(next);
  assert.match(next!, /🔁 FREQ=WEEKLY;UNTIL=20261231T235959Z/);
});

test('a fresh line carries the event fields with `⏰` directly after `📅`', () => {
  const line = newEntryLine(
    event({ summary: '评审', categories: ['work', 'q4'], alarms: [
      { trigger: '-PT15M', action: 'DISPLAY' },
      { trigger: '-PT5M', action: 'DISPLAY' },
    ] }),
    'abc12345',
  );

  assert.equal(
    line,
    '- [ ] 评审 #work #q4 🆔 abc12345 📅 2026-11-12 ⏰ -PT15M ⏰ -PT5M',
  );
  const model = parseTaskLine(line);
  assert.deepEqual(model!.reminders, ['-PT15M', '-PT5M']);
});
