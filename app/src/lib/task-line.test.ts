import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  linkTaskDates,
  normalizeTaskLine,
  parseTaskLine,
  serializeTaskLine,
  taskLinePrefixLength,
  writeTaskLine,
} from './task-line';

/** The shape the user asked for, verbatim. */
const CANONICAL =
  '- [-] 采购硬件 #work 🆔 t001 ⛔ t000 🔁 every month ➕ 2026-11-01 🛫 2026-11-02 ⏳ 2026-11-03 📅 2026-11-05 ⏫ ❌ 2026-11-04 ✅ 2026-11-04';

test('the canonical line parses into every field', () => {
  const model = parseTaskLine(CANONICAL)!;
  assert.equal(model.open, '- [');
  assert.equal(model.status, '-');
  assert.equal(model.description, '采购硬件');
  assert.deepEqual(model.tags, ['work']);
  assert.equal(model.id, 't001');
  assert.equal(model.blockedBy, 't000');
  assert.equal(model.recurrence, 'every month');
  assert.equal(model.created, '2026-11-01');
  assert.equal(model.start, '2026-11-02');
  assert.equal(model.scheduled, '2026-11-03');
  assert.equal(model.due, '2026-11-05');
  assert.equal(model.priority, '⏫');
  assert.equal(model.cancelled, '2026-11-04');
  assert.equal(model.completed, '2026-11-04');
  assert.deepEqual(model.extra, []);
});

test('normalizing a canonical line changes nothing, so the command is a no-op', () => {
  assert.equal(normalizeTaskLine(CANONICAL), CANONICAL);
});

test('scrambled markers are put in order with single spaces', () => {
  const line = '- [ ] 采购硬件   📅 2026-11-05  ✅ 2026-11-04 ⏫ 🔁  every   month  #work   🆔 t001';
  assert.equal(
    normalizeTaskLine(line),
    '- [ ] 采购硬件 #work 🆔 t001 🔁 every month 📅 2026-11-05 ⏫ ✅ 2026-11-04',
  );
});

test('tags keep their order and unknown fragments land after the tokens', () => {
  const line = '- [ ] 写报告 #b 备注一 📅 2026-11-12 #a 备注二';
  assert.equal(normalizeTaskLine(line), '- [ ] 写报告 #b #a 📅 2026-11-12 备注一 备注二');
});

// Batch 9: tags are not tokens of ours — several may exist, and they keep
// their relative order right after the description.
test('several tags keep their relative order after the description', () => {
  const line = '- [ ] 写报告 #work 📅 2026-11-12 #urgent #2026';
  const model = parseTaskLine(line)!;
  assert.deepEqual(model.tags, ['work', 'urgent', '2026']);
  assert.equal(
    serializeTaskLine(model),
    '- [ ] 写报告 #work #urgent #2026 📅 2026-11-12',
  );
});

test('indentation, quote markers and the bullet are never rewritten', () => {
  assert.equal(normalizeTaskLine('  - [ ]    写报告   📅  2026-11-12'), '  - [ ] 写报告 📅 2026-11-12');
  assert.equal(normalizeTaskLine('> 1. [x] 写报告  ✅  2026-11-12'), '> 1. [x] 写报告 ✅ 2026-11-12');
  assert.equal(taskLinePrefixLength('  - [ ] 写'), 8);
});

test('a lone ⏺ clears the priority instead of being kept as one', () => {
  assert.equal(normalizeTaskLine('- [ ] 写报告 ⏫ ⏺'), '- [ ] 写报告');
});

test('bare markers are kept, not dropped', () => {
  assert.equal(normalizeTaskLine('- [ ] 写报告 🔁'), '- [ ] 写报告 🔁');
  assert.equal(normalizeTaskLine('- [ ] 写报告 📅 明天'), '- [ ] 写报告 📅 明天');
});

test('prose and plain bullets are not task lines', () => {
  assert.equal(parseTaskLine('普通段落 明天'), null);
  assert.equal(parseTaskLine('- 普通列表 [ ] 明天'), null);
  assert.equal(normalizeTaskLine('# 标题 📅 2026-11-12'), null);
});

test('parse → serialize is stable for a hand-written line', () => {
  const line = '- [ ] 写报告 📅 2026-11-12';
  const model = parseTaskLine(line)!;
  assert.equal(serializeTaskLine(model), line);
  assert.equal(normalizeTaskLine(serializeTaskLine(model)), line);
});

// ---------------------------------------------------------------------------
// batch 8 — separators: every field is written with exactly one space a side
// ---------------------------------------------------------------------------

test('every field is written with one space on either side', () => {
  const model = parseTaskLine('- [ ] 写报告')!;
  model.tags = ['work'];
  model.id = 't001';
  model.blockedBy = 't000';
  model.recurrence = 'every month';
  model.created = '2026-11-01';
  model.start = '2026-11-02';
  model.scheduled = '2026-11-03';
  model.due = '2026-11-05';
  model.priority = '⏫';
  model.cancelled = '2026-11-04';
  model.completed = '2026-11-04';
  const line = serializeTaskLine(model);
  const tokens = [
    '#work',
    '🆔 t001',
    '⛔ t000',
    '🔁 every month',
    '➕ 2026-11-01',
    '🛫 2026-11-02',
    '⏳ 2026-11-03',
    '📅 2026-11-05',
    '⏫',
    '❌ 2026-11-04',
    '✅ 2026-11-04',
  ];
  for (const token of tokens) {
    // ✅ closes the line, so it only needs a space in front of it.
    assert.ok(
      line.includes(` ${token} `) || line.endsWith(` ${token}`),
      `${token} needs one space on each side: ${line}`,
    );
  }
  // The status character is followed by the description with one space, and no
  // pair of tokens is separated by more than one.
  assert.ok(line.startsWith('- [ ] 写报告 #work'));
  assert.equal(/ {2,}/u.test(line), false, `collapsed spacing expected: ${line}`);
});

test('a line written without separators is repaired when it is written', () => {
  assert.equal(
    normalizeTaskLine('- [ ] 写报告 🔁 every day🛫 2026-11-10 📅 2026-11-11 ⏫'),
    '- [ ] 写报告 🔁 every day 🛫 2026-11-10 📅 2026-11-11 ⏫',
  );
  assert.equal(
    normalizeTaskLine('- [ ] 写报告 📅2026-11-10 ⏫🔁 every day'),
    '- [ ] 写报告 🔁 every day 📅 2026-11-10 ⏫',
  );
  assert.equal(normalizeTaskLine('- [ ] 写报告 🆔t001 ⛔t000 #work'), '- [ ] 写报告 #work 🆔 t001 ⛔ t000');
});

// ---------------------------------------------------------------------------
// batch 8 — status ↔ ✅ / ❌
// ---------------------------------------------------------------------------

const TODAY = '2026-11-10';

test('completing a task stamps ✅ today and drops ❌', () => {
  assert.equal(writeTaskLine('- [x] 写报告', TODAY, { status: true }), '- [x] 写报告 ✅ 2026-11-10');
  assert.equal(
    writeTaskLine('- [x] 写报告 ❌ 2026-10-01 ✅ 2026-10-01', TODAY, { status: true }),
    '- [x] 写报告 ✅ 2026-11-10',
  );
});

test('cancelling stamps ❌ today and every other status clears both dates', () => {
  assert.equal(writeTaskLine('- [-] 写报告', TODAY, { status: true }), '- [-] 写报告 ❌ 2026-11-10');
  assert.equal(
    writeTaskLine('- [/] 写报告 ✅ 2026-10-01 ❌ 2026-10-01', TODAY, { status: true }),
    '- [/] 写报告',
  );
  assert.equal(writeTaskLine('- [ ] 写报告 ✅ 2026-10-01', TODAY, { status: true }), '- [ ] 写报告');
});

test('setting ✅ completes the task, setting ❌ cancels it, and they never coexist', () => {
  assert.equal(
    writeTaskLine('- [ ] 写报告 ✅ 2026-10-01 ❌ 2026-10-02', TODAY, { completed: true }),
    '- [x] 写报告 ✅ 2026-10-01',
  );
  assert.equal(
    writeTaskLine('- [x] 写报告 ✅ 2026-10-01 ✅ 2026-10-02', TODAY, { completed: true }),
    '- [x] 写报告 ✅ 2026-10-02',
  );
  assert.equal(
    writeTaskLine('- [ ] 写报告 ❌ 2026-10-02', TODAY, { cancelled: true }),
    '- [-] 写报告 ❌ 2026-10-02',
  );
  assert.equal(
    writeTaskLine('- [-] 写报告 ✅ 2026-10-01 ❌ 2026-10-02', TODAY, { cancelled: true }),
    '- [-] 写报告 ❌ 2026-10-02',
  );
});

test('clearing a closing date leaves the status alone', () => {
  // The user asked for "done, but without a date": clearing ✅ must not reopen
  // the task, and must not touch ❌ either.
  assert.equal(writeTaskLine('- [x] 写报告', TODAY, { completed: true }), '- [x] 写报告');
  assert.equal(writeTaskLine('- [-] 写报告', TODAY, { cancelled: true }), '- [-] 写报告');
});

test('any other write keeps a line with both dates to one of them', () => {
  assert.equal(
    writeTaskLine('- [x] 写报告 ✅ 2026-10-01 ❌ 2026-10-02', TODAY),
    '- [x] 写报告 ✅ 2026-10-01',
  );
  assert.equal(
    writeTaskLine('- [-] 写报告 ✅ 2026-10-01 ❌ 2026-10-02', TODAY),
    '- [-] 写报告 ❌ 2026-10-02',
  );
});

test('writeTaskLine refuses a line that is not a task', () => {
  assert.equal(writeTaskLine('普通段落 📅 2026-11-12', TODAY), null);
});

// The model-level half, used by the task editor, which edits fields one by one.
test('linkTaskDates applies the link to a parsed model in place', () => {
  const model = parseTaskLine('- [ ] 写报告 ❌ 2026-10-01')!;
  model.status = 'x';
  linkTaskDates(model, { status: true }, TODAY);
  assert.equal(model.completed, TODAY);
  assert.equal(model.cancelled, '');
});
