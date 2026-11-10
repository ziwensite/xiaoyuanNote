import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTaskLine,
  parseTaskLine,
  serializeTaskLine,
  taskLinePrefixLength,
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
