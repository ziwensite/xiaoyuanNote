import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  taskSuggestGroupLabel,
  taskSuggestions,
  type TaskSuggestMenu,
  type TaskSuggestMore,
  type TaskSuggestRequest,
  type TaskSuggestRow,
  type TaskSuggestWrite,
} from './task-suggest';
import { parseDatePhrase } from './task-date-phrases';

/** 2026-11-10 is a Tuesday. */
const TODAY = '2026-11-10';

/** `|` marks the caret; it is removed from the line. */
function at(marked: string): { line: string; caret: number } {
  const caret = marked.indexOf('|');
  assert.ok(caret >= 0, `no caret in ${JSON.stringify(marked)}`);
  return { line: marked.replace('|', ''), caret };
}

function menu(marked: string, lang = 'zh', request?: TaskSuggestRequest): TaskSuggestMenu {
  const { line, caret } = at(marked);
  const found = taskSuggestions(line, caret, TODAY, lang, request);
  assert.ok(found, `expected a menu for ${JSON.stringify(line)}`);
  return found;
}

function row(m: TaskSuggestMenu, label: string): TaskSuggestRow {
  const found = m.rows.find((r) => r.label === label);
  assert.ok(found, `no row ${JSON.stringify(label)} in ${JSON.stringify(m.rows.map((r) => r.label))}`);
  return found;
}

/** A row that writes a token. */
function write(m: TaskSuggestMenu, label: string): TaskSuggestWrite {
  const found = row(m, label);
  assert.equal(found.kind, 'write', `${JSON.stringify(label)} should write a token`);
  return found as TaskSuggestWrite;
}

/** A row that opens the values of one marker. */
function more(m: TaskSuggestMenu, label: string): TaskSuggestMore {
  const found = row(m, label);
  assert.equal(found.kind, 'more', `${JSON.stringify(label)} should open a submenu`);
  return found as TaskSuggestMore;
}

test('a plain paragraph, a heading and a plain bullet get no menu', () => {
  assert.equal(taskSuggestions('普通段落 ', 5, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('# 标题 ', 4, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('- 普通列表 ', 6, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('- [书写] 普通文本 ', 12, TODAY, 'zh'), null);
});

test('the caret inside the checkbox gets no menu', () => {
  assert.equal(taskSuggestions('- [ ] 写报告', 0, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('- [ ] 写报告', 3, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('- [ ] 写报告', 4, TODAY, 'zh'), null);
  assert.equal(taskSuggestions('- [ ] 写报告', 5, TODAY, 'zh'), null);
  assert.ok(taskSuggestions('- [ ] 写报告', 6, TODAY, 'zh'));
});

test('every status character is a task line', () => {
  for (const status of [' ', 'x', '/', '-', '?']) {
    const line = `- [${status}] 写报告 `;
    const found = taskSuggestions(line, line.length, TODAY, 'zh');
    assert.ok(found && found.rows.length > 0, `no menu for [${status}]`);
  }
});

test('ordered and quoted task lines are recognised', () => {
  const ordered = '1. [ ] 写报告 ';
  assert.ok(taskSuggestions(ordered, ordered.length, TODAY, 'zh'));
  const quoted = '> - [ ] 写报告 ';
  assert.ok(taskSuggestions(quoted, quoted.length, TODAY, 'zh'));
});

test('an explicit level still needs a task line and a caret past the checkbox', () => {
  assert.equal(taskSuggestions('普通段落 ', 5, TODAY, 'zh', { stage: 'date', field: 'due' }), null);
  assert.equal(taskSuggestions('- [ ] 写报告', 4, TODAY, 'zh', { stage: 'marker' }), null);
});

test('the marker level offers priorities, repeat, the missing dates and the other statuses', () => {
  const m = menu('- [ ] 写报告 |');
  assert.equal(m.stage, 'marker');
  assert.equal(m.title, undefined);
  assert.deepEqual(
    [...new Set(m.rows.map((r) => r.group))],
    ['priority', 'recurrence', 'date', 'status'],
  );

  assert.equal(write(m, '🔺 最高').insert, '🔺');
  assert.equal(write(m, '⏺ 无').insert, '');
  assert.equal(write(m, '[/] 进行中').insert, '/');

  assert.equal(more(m, '🔁 重复').stage, 'recurrence');
  const due = more(m, '📅 截止');
  assert.equal(due.stage, 'date');
  assert.equal(due.field, 'due');
  assert.equal(more(m, '🛫 开始').field, 'start');
  assert.equal(more(m, '⏳ 计划').field, 'scheduled');
  assert.equal(more(m, '➕ 创建').field, 'created');
  assert.equal(more(m, '✅ 完成').field, 'completed');
  assert.equal(more(m, '❌ 取消').field, 'cancelled');

  // The status already in effect is not offered again.
  assert.equal(m.rows.some((r) => r.label === '[ ] 未开始'), false);
  // 6 priorities + 🔁 + 6 date fields + 4 other statuses.
  assert.equal(m.rows.length, 17);
});

test('the marker level hides what the line already has', () => {
  const withDue = menu('- [ ] 写报告 📅 2026-11-12|');
  assert.equal(withDue.rows.some((r) => r.label === '📅 截止'), false);
  assert.ok(withDue.rows.some((r) => r.label === '⏳ 计划'));

  const withRule = menu('- [ ] 写报告 🔁 every week|');
  assert.equal(withRule.rows.some((r) => r.group === 'recurrence'), false);

  const withPriority = menu('- [ ] 写报告 ⏫|');
  assert.equal(withPriority.rows.some((r) => r.label === '⏫ 较高'), false);
  assert.ok(withPriority.rows.some((r) => r.label === '🔼 中等'));

  const done = menu('- [x] 写报告 |');
  assert.equal(done.rows.some((r) => r.label === '[x] 完成'), false);
});

test('priorities replace the current level or insert before the first date', () => {
  const line = '- [ ] 写报告 ⏫';
  const m = menu(`${line}|`);
  const medium = write(m, '🔼 中等');
  assert.equal(line.slice(medium.from, medium.to), '⏫');
  assert.equal(medium.insert, '🔼');

  const none = write(m, '⏺ 无');
  assert.equal(none.insert, '');
  assert.equal(line.slice(none.from, none.to), '⏫');

  const dated = '- [ ] 写报告 📅 2026-11-12';
  const inserted = write(menu(`${dated}|`), '⏫ 较高');
  assert.equal(inserted.from, dated.indexOf('📅'));
  assert.equal(inserted.to, inserted.from);
});

test('status rows rewrite the checkbox character only', () => {
  const m = menu('- [ ] 写报告 |');
  const doing = write(m, '[/] 进行中');
  assert.equal(doing.from, 3);
  assert.equal(doing.to, 4);
  assert.equal(doing.insert, '/');
});

test('a bare 📅 opens the date level and replaces the marker with the token', () => {
  const { line, caret } = at('- [ ] 写报告 📅 |');
  const m = taskSuggestions(line, caret, TODAY, 'zh');
  assert.ok(m);
  assert.equal(m.stage, 'date');
  assert.equal(m.field, 'due');
  assert.equal(m.title, '📅 截止');
  assert.equal(m.rows.length, 8);

  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.insert, '📅 2026-11-11');
  assert.equal(tomorrow.detail, '2026-11-11');
  // The range covers the bare marker and the space that opened the menu.
  assert.equal(line.slice(tomorrow.from, tomorrow.to), '📅 ');
});

test('the date chips are the reference eight, all parsed', () => {
  const m = menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'due' });
  assert.deepEqual(
    m.rows.map((r) => (r.kind === 'write' ? r.detail : null)),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-17', '2026-11-24', '2026-11-30', '2026-12-10', '2027-11-10'],
  );
  assert.equal(write(m, '下个月').insert, '📅 2026-12-10');
});

test('the date level keeps the space before an inserted token', () => {
  const m = menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.from, 10);
  assert.equal(tomorrow.to, 10);
  assert.equal(tomorrow.insert, '📅 2026-11-11');
});

test('an existing due date is replaced, not duplicated', () => {
  const line = '- [ ] 写报告 📅 2026-11-12';
  const m = menu(`${line}|`, 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(line.slice(tomorrow.from, tomorrow.to), '📅 2026-11-12');
  assert.equal(tomorrow.insert, '📅 2026-11-11');
});

test('a date is inserted before a 🔁 rule that sits earlier in the line', () => {
  const line = '- [ ] 写报告 🔁 every week';
  const m = menu(`${line}|`, 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.from, line.indexOf('🔁'));
  assert.equal(tomorrow.to, tomorrow.from);
});

test('a bare 🔁 opens the repetition level directly', () => {
  const { line, caret } = at('- [ ] 写报告 🔁 |');
  const m = taskSuggestions(line, caret, TODAY, 'zh');
  assert.ok(m);
  assert.equal(m.stage, 'recurrence');
  assert.equal(m.title, '🔁 重复');
  assert.equal(m.rows.length, 6);

  const weekly = write(m, '每周');
  assert.equal(weekly.insert, '🔁 every week');
  assert.equal(weekly.detail, 'every week');
  assert.equal(line.slice(weekly.from, weekly.to), '🔁 ');
});

test('the repetition level replaces the rule text, or goes before the first date', () => {
  const line = '- [ ] 写报告 🔁 every 2 weeks';
  const m = menu(`${line}|`, 'zh', { stage: 'recurrence' });
  const weekly = write(m, '每周');
  assert.equal(line.slice(weekly.from, weekly.to), '🔁 every 2 weeks');
  assert.equal(weekly.insert, '🔁 every week');

  const dated = '- [ ] 写报告 📅 2026-11-12';
  const inserted = write(menu(`${dated}|`, 'zh', { stage: 'recurrence' }), '每月');
  assert.equal(inserted.from, dated.indexOf('📅'));
  assert.equal(inserted.to, inserted.from);
  assert.equal(inserted.insert, '🔁 every month');
});

test('English labels for a non-Chinese UI language', () => {
  const m = menu('- [ ] report |', 'en');
  assert.equal(more(m, '📅 Due').field, 'due');
  assert.equal(more(m, '⏳ Scheduled').field, 'scheduled');
  assert.equal(write(m, '⏺ None').insert, '');

  const due = menu('- [ ] report |', 'en', { stage: 'date', field: 'due' });
  assert.equal(write(due, 'Tomorrow').insert, '📅 2026-11-11');

  const rep = menu('- [ ] report |', 'en', { stage: 'recurrence' });
  assert.equal(write(rep, 'Every 2 weeks').insert, '🔁 every 2 weeks');

  assert.equal(taskSuggestGroupLabel('priority', 'en'), 'Priority');
  assert.equal(taskSuggestGroupLabel('date', 'zh-CN'), '日期');
});

test('parseDatePhrase reads whole phrases only', () => {
  assert.deepEqual(parseDatePhrase('今天', TODAY), { date: '2026-11-10', time: undefined });
  assert.deepEqual(parseDatePhrase('下周三', TODAY), { date: '2026-11-18', time: undefined });
  assert.deepEqual(parseDatePhrase('月末', TODAY), { date: '2026-11-30', time: undefined });
  assert.deepEqual(parseDatePhrase('月底', TODAY), { date: '2026-11-30', time: undefined });
  assert.deepEqual(parseDatePhrase('2026-11-30', TODAY), { date: '2026-11-30', time: undefined });
  assert.deepEqual(parseDatePhrase('next monday', TODAY), { date: '2026-11-16', time: undefined });
  assert.deepEqual(parseDatePhrase('15:00', TODAY), { date: undefined, time: '15:00' });
  assert.equal(parseDatePhrase('明天见', TODAY), null);
  assert.equal(parseDatePhrase('随便写点什么', TODAY), null);
  assert.equal(parseDatePhrase('', TODAY), null);
});

test('the chips added with the two-level menu parse', () => {
  assert.deepEqual(parseDatePhrase('一周后', TODAY), { date: '2026-11-17', time: undefined });
  assert.deepEqual(parseDatePhrase('两周后', TODAY), { date: '2026-11-24', time: undefined });
  assert.deepEqual(parseDatePhrase('明年', TODAY), { date: '2027-11-10', time: undefined });
});
