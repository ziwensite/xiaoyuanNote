import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENTRY_EXTRAS_KEYS,
  ENTRY_UID_KEY,
  entryFromLine,
  hasEntryUid,
  isHeavyEntry,
  lineFromEntry,
} from './entry';

// Batch 10 / P1: the shape of a unified entry. The line is the whole story for
// the shared fields, so everything here is about the line surviving a trip
// through the model and about the id that ties it to an event note.

const LINES = [
  '- [ ] 写周报',
  '- [ ] 写周报 #work #urgent',
  '- [ ] 写周报 #work 🆔 t001 ⛔ t000 📅 2026-11-12 ⏫',
  '- [ ] 写周报 #work 🆔 t001 🔁 every 2 weeks 🛫 2026-11-10 ⏳ 2026-11-11 📅 2026-11-12 ⏰ -PT15M ⏫ ❌ 2026-11-13',
  '- [x] 采购硬件 📅 2026-11-05 ⏰ 09:00 ✅ 2026-11-06',
  '- [-] 取消的会 ❌ 2026-11-06',
  '- [/] 进行中的会 📅 2026-11-12',
  '  - [ ] 缩进的任务 📅 2026-11-12',
  '> - [ ] 引用块里的任务 📅 2026-11-12',
  '- [ ] 没有日期的任务 ⏬',
  // P2 / T0.3: the remaining shapes the golden-sample list calls for.
  '- [?] 待定的评审 📅 2026-11-12',
  '- [ ] 周会 🏁 keep 🔁 every week 📅 2026-11-12',
  '- [ ] 📅 2026-11-12',
  '- [ ] 跨年任务 📅 2026-12-31 ✅ 2027-01-01',
  '- [ ] 多个提醒 📅 2026-11-12 ⏰ -PT15M ⏰ 09:00 ⏫',
  '- [ ] 裸提醒标记 ⏰ 📅 2026-11-12',
  '- [ ] 依赖与身份 🆔 t002 ⛔ t001 📅 2026-11-12',
  '- [ ] 全 token 补全 ➕ 2026-11-01 🛫 2026-11-10 ⏳ 2026-11-11 📅 2026-11-12 🔺 ❌ 2026-11-13 ✅ 2026-11-14',
  '- [/] 引号与括号 100% 覆盖 #a #b #c',
  '1. [ ] 有序列表任务 📅 2026-11-12',
];

test('a canonical line survives the entry round trip byte for byte', () => {
  for (const line of LINES) {
    const entry = entryFromLine(line);
    assert.ok(entry, `expected a task line: ${line}`);
    assert.equal(lineFromEntry(entry), line);
  }
});

test('the same entry can be read and written repeatedly without drifting', () => {
  for (const line of LINES) {
    let current = line;
    for (let i = 0; i < 3; i += 1) {
      const entry = entryFromLine(current)!;
      current = lineFromEntry(entry);
    }
    assert.equal(current, line);
  }
});

test('a scrambled line is normalized once and then stays put', () => {
  const scrambled = '- [ ] 写周报 ⏰ -PT15M 🆔 t001 📅 2026-11-12 #work ⏫';
  const once = lineFromEntry(entryFromLine(scrambled)!);
  assert.equal(once, '- [ ] 写周报 #work 🆔 t001 📅 2026-11-12 ⏰ -PT15M ⏫');
  assert.equal(lineFromEntry(entryFromLine(once)!), once);
});

test('anything that is not a task line is not an entry', () => {
  for (const text of ['', '普通段落', '- 普通列表项', '## 标题', '- [] 坏的复选框']) {
    assert.equal(entryFromLine(text), null, `unexpected entry: ${text}`);
  }
});

test('the 🆔 value is the entry identity, and it is optional', () => {
  const withId = entryFromLine('- [ ] 写周报 🆔 t001')!;
  assert.equal(withId.uid, 't001');
  assert.equal(hasEntryUid(withId), true);

  const withoutId = entryFromLine('- [ ] 写周报')!;
  assert.equal(withoutId.uid, '');
  assert.equal(hasEntryUid(withoutId), false);
});

test('a light entry has no extras and needs no event note', () => {
  const light = entryFromLine('- [ ] 写周报 📅 2026-11-12 ⏫');
  assert.ok(light);
  assert.deepEqual(light.extras, {});
  assert.equal(isHeavyEntry(light), false);
});

test('extras are carried as given and make the entry heavy', () => {
  const extras = {
    start_time: '14:00',
    end_time: '15:00',
    all_day: false,
    tzid: 'Asia/Shanghai',
    location: '3 楼会议室',
    attendees: ['a@example.com'],
    notes: '带上预算表',
    related_note: '[[Q4 规划]]',
  };
  const entry = entryFromLine('- [ ] 写周报 🆔 t001 📅 2026-11-12', extras)!;
  assert.equal(entry.extras, extras);
  assert.equal(isHeavyEntry(entry), true);
  // The line never absorbs extras: they live in the event note, not the line.
  assert.equal(lineFromEntry(entry), '- [ ] 写周报 🆔 t001 📅 2026-11-12');
});

test('an empty extras bag, or one with only empty values, stays light', () => {
  const line = '- [ ] 写周报 📅 2026-11-12';
  assert.equal(isHeavyEntry(entryFromLine(line, {})!), false);
  assert.equal(isHeavyEntry(entryFromLine(line, { all_day: false })!), false);
  assert.equal(isHeavyEntry(entryFromLine(line, { attendees: [] })!), false);
  assert.equal(isHeavyEntry(entryFromLine(line, { location: '' })!), false);
  assert.equal(isHeavyEntry(entryFromLine(line, { all_day: true })!), true);
});

test('the extras key list is the frontmatter contract, in a stable order', () => {
  assert.deepEqual([...ENTRY_EXTRAS_KEYS], [
    'start_time',
    'end_time',
    'all_day',
    'tzid',
    'location',
    'attendees',
    'notes',
    'related_note',
  ]);
  assert.equal(ENTRY_UID_KEY, 'entry_uid');
});

test('the model is exposed, not copied away', () => {
  const entry = entryFromLine('- [ ] 写周报 #work 📅 2026-11-12 ⏰ 09:00 🆔 t001 ⛔ t000 ⏫')!;
  assert.equal(entry.model.description, '写周报');
  assert.deepEqual(entry.model.tags, ['work']);
  assert.equal(entry.model.due, '2026-11-12');
  assert.deepEqual(entry.model.reminders, ['09:00']);
  assert.equal(entry.model.priority, '⏫');
  assert.equal(entry.model.id, 't001');
  assert.equal(entry.model.blockedBy, 't000');
});

test('golden lines pin the fields the calendar joins on', () => {
  const question = entryFromLine('- [?] 待定的评审 📅 2026-11-12')!;
  assert.equal(question.model.status, '?');
  assert.equal(question.model.due, '2026-11-12');

  const multi = entryFromLine('- [ ] 多个提醒 📅 2026-11-12 ⏰ -PT15M ⏰ 09:00 ⏫')!;
  assert.deepEqual(multi.model.reminders, ['-PT15M', '09:00']);
  assert.equal(multi.model.priority, '⏫');

  const year = entryFromLine('- [ ] 跨年任务 📅 2026-12-31 ✅ 2027-01-01')!;
  assert.equal(year.model.due, '2026-12-31');
  assert.equal(year.model.completed, '2027-01-01');

  const empty = entryFromLine('- [ ] 📅 2026-11-12')!;
  assert.equal(empty.model.description, '');

  const full = entryFromLine(
    '- [ ] 全 token 补全 ➕ 2026-11-01 🛫 2026-11-10 ⏳ 2026-11-11 📅 2026-11-12 🔺 ❌ 2026-11-13 ✅ 2026-11-14',
  )!;
  assert.equal(full.model.created, '2026-11-01');
  assert.equal(full.model.start, '2026-11-10');
  assert.equal(full.model.scheduled, '2026-11-11');
  assert.equal(full.model.due, '2026-11-12');
  assert.equal(full.model.priority, '🔺');
  assert.equal(full.model.cancelled, '2026-11-13');
  assert.equal(full.model.completed, '2026-11-14');

  const tags = entryFromLine('- [/] 引号与括号 100% 覆盖 #a #b #c')!;
  assert.equal(tags.model.status, '/');
  assert.deepEqual(tags.model.tags, ['a', 'b', 'c']);
});

test('a bare ⏰ and 🏁 keep stay as text, never becoming token fields', () => {
  const bare = entryFromLine('- [ ] 裸提醒标记 ⏰ 📅 2026-11-12')!;
  assert.deepEqual(bare.model.reminders, []);
  assert.equal(bare.model.description, '裸提醒标记 ⏰');

  const keep = entryFromLine('- [ ] 周会 🏁 keep 🔁 every week 📅 2026-11-12')!;
  assert.equal(keep.model.description, '周会 🏁 keep');
  assert.equal(keep.model.recurrence, 'every week');
});

test('a line written without separators is repaired once and then stays put', () => {
  const glued = '- [ ] 写周报📅2026-11-12⏫';
  const once = lineFromEntry(entryFromLine(glued)!);
  assert.equal(once, '- [ ] 写周报 📅 2026-11-12 ⏫');
  assert.equal(lineFromEntry(entryFromLine(once)!), once);

  const gluedId = '- [ ] 交稿🆔t003⛔t002';
  const fixed = lineFromEntry(entryFromLine(gluedId)!);
  assert.equal(fixed, '- [ ] 交稿 🆔 t003 ⛔ t002');
  assert.equal(lineFromEntry(entryFromLine(fixed)!), fixed);
});
