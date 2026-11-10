import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
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

function write(m: TaskSuggestMenu, label: string): TaskSuggestWrite {
  const found = row(m, label);
  assert.equal(found.kind, 'write', `${JSON.stringify(label)} should write a token`);
  return found as TaskSuggestWrite;
}

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

test('L0 is one icon per marker, most used first, and ends with the task editor', () => {
  const m = menu('- [ ] 写报告 |');
  assert.equal(m.stage, 'marker');
  assert.equal(m.title, undefined);
  assert.deepEqual(
    m.rows.map((r) => r.label),
    ['[ ]', '📅', '⏫', '⏳', '🛫', '🔁', '➕', '✅', '❌', '任务编辑…'],
  );
  assert.equal(m.rows.at(-1)!.kind, 'edit');
  // The status is a single row carrying the character in effect, never the
  // whole set of four.
  assert.deepEqual(
    m.rows.filter((r) => r.label.startsWith('[')).map((r) => r.label),
    ['[ ]'],
  );
});

test('L0 marks each field by its own icon and opens that field', () => {
  const m = menu('- [ ] 写报告 |');
  assert.equal(more(m, '[ ]').stage, 'status');
  assert.equal(more(m, '📅').stage, 'date');
  assert.equal(more(m, '📅').field, 'due');
  assert.equal(more(m, '🛫').field, 'start');
  assert.equal(more(m, '⏳').field, 'scheduled');
  assert.equal(more(m, '➕').field, 'created');
  assert.equal(more(m, '✅').field, 'completed');
  assert.equal(more(m, '❌').field, 'cancelled');
  assert.equal(more(m, '🔁').stage, 'recurrence');
  assert.equal(more(m, '⏫').stage, 'priority');
});

test('L0 hides every marker the line already carries, status included', () => {
  const line = '- [ ] 写报告 📅 2026-11-12 ✅ 2026-11-12 ⏫ 🔁 every week';
  const labels = menu(`${line}|`).rows.map((r) => r.label);
  assert.equal(labels.includes('📅'), false);
  assert.equal(labels.includes('✅'), false);
  assert.equal(labels.includes('🔁'), false);
  assert.ok(labels.includes('⏳'));
  // Priority is a single row showing the value that is set, not the ladder.
  assert.equal(labels.filter((label) => label === '⏫').length, 1);
  assert.equal(labels.includes('🔺'), false);
});

test('L0 shows the current priority as its one priority row', () => {
  const m = menu('- [ ] 写报告 🔽 #work|');
  const priority = more(m, '🔽');
  assert.equal(priority.stage, 'priority');
  assert.equal(priority.detail, '较低');
});

test('the status icon opens the other characters and replaces the one in place', () => {
  const m = menu('- [ ] 写报告 |', 'zh', { stage: 'status' });
  assert.equal(m.stage, 'status');
  assert.equal(m.title, '[ ] 状态');
  assert.deepEqual(
    m.rows.map((r) => r.label),
    ['[/]', '[x]', '[-]', '[?]', '任务编辑…'],
  );
  assert.equal(m.rows.at(-1)!.kind, 'edit');
  const doing = write(m, '[/]');
  assert.equal(doing.from, 3);
  assert.equal(doing.to, 4);
  assert.equal(doing.insert, '/');
  // A status write is the status side of the ✅ / ❌ link.
  assert.equal(doing.link, 'status');

  // Picking one replaces the character, and never offers the current one.
  const done = menu('- [/] 写报告 |', 'zh', { stage: 'status' });
  assert.equal(done.rows.some((r) => r.label === '[/]'), false);
  assert.equal(write(done, '[x]').link, 'status');
});

test('a bare 📅 opens the date level and replaces the marker', () => {
  const { line, caret } = at('- [ ] 写报告 📅 |');
  const m = taskSuggestions(line, caret, TODAY, 'zh');
  assert.ok(m);
  assert.equal(m.stage, 'date');
  assert.equal(m.field, 'due');
  assert.equal(m.title, '📅 截止');
  assert.equal(m.rows.length, 9);
  assert.equal(m.rows.at(-1)!.kind, 'edit');

  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.insert, '📅 2026-11-11');
  assert.equal(tomorrow.detail, '2026-11-11');
  // The range covers the bare marker and the space that opened the menu.
  assert.equal(line.slice(tomorrow.from, tomorrow.to), '📅 ');
});

test('a bare ⏫ opens the priority ladder', () => {
  const m = menu('- [ ] 写报告 ⏫ |');
  assert.equal(m.stage, 'priority');
  assert.deepEqual(
    m.rows.map((r) => r.label),
    ['🔺 最高', '⏫ 较高', '🔼 中等', '🔽 较低', '⏬ 最低', '⏺ 清除', '任务编辑…'],
  );
  const low = write(m, '🔽 较低');
  assert.equal(low.insert, '🔽');
});

test('a bare 🔁 opens the repetition level directly', () => {
  const { line, caret } = at('- [ ] 写报告 🔁 |');
  const m = taskSuggestions(line, caret, TODAY, 'zh');
  assert.ok(m);
  assert.equal(m.stage, 'recurrence');
  assert.equal(m.title, '🔁 重复');
  assert.equal(m.rows.length, 7);
  assert.equal(write(m, '每周').insert, '🔁 every week');
  assert.equal(line.slice(write(m, '每周').from, write(m, '每周').to), '🔁 ');
});

test('the date chips are the reference eight and all parse', () => {
  const m = menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'due' });
  assert.deepEqual(
    m.rows.map((r) => (r.kind === 'write' ? r.detail : null)).slice(0, 8),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-17', '2026-11-24', '2026-11-30', '2026-12-10', '2027-11-10'],
  );
  assert.equal(write(m, '下个月').insert, '📅 2026-12-10');
});

test('a value inserted where nothing is written stays at the caret', () => {
  const m = menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.from, 10);
  assert.equal(tomorrow.to, 10);
});

test('an existing due date is replaced, not duplicated', () => {
  const line = '- [ ] 写报告 📅 2026-11-12';
  const m = menu(`${line}|`, 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(line.slice(tomorrow.from, tomorrow.to), '📅 2026-11-12');
});

test('a date is inserted before a 🔁 rule that sits earlier in the line', () => {
  const line = '- [ ] 写报告 🔁 every week';
  const m = menu(`${line}|`, 'zh', { stage: 'date', field: 'due' });
  const tomorrow = write(m, '明天');
  assert.equal(tomorrow.from, line.indexOf('🔁'));
  assert.equal(tomorrow.to, tomorrow.from);
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

test('the priority ladder replaces the current level or clears it', () => {
  const line = '- [ ] 写报告 ⏫';
  const m = menu(`${line}|`, 'zh', { stage: 'priority' });
  const low = write(m, '🔽 较低');
  assert.equal(line.slice(low.from, low.to), '⏫');
  const clear = write(m, '⏺ 清除');
  assert.equal(clear.insert, '');
  assert.equal(line.slice(clear.from, clear.to), '⏫');
});

test('the closing dates carry the status side of the link, the other dates do not', () => {
  assert.equal(write(menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'completed' }), '明天').link, 'completed');
  assert.equal(write(menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'cancelled' }), '明天').link, 'cancelled');
  assert.equal(write(menu('- [ ] 写报告 |', 'zh', { stage: 'date', field: 'due' }), '明天').link, undefined);
  assert.equal(write(menu('- [ ] 写报告 |', 'zh', { stage: 'priority' }), '🔽 较低').link, undefined);
});

test('English labels for a non-Chinese UI language', () => {
  const m = menu('- [ ] report |', 'en');
  assert.equal(more(m, '[ ]').stage, 'status');
  assert.equal(more(m, '📅').field, 'due');
  assert.equal(more(m, '⏳').field, 'scheduled');
  assert.deepEqual(
    m.rows.map((r) => r.label),
    ['[ ]', '📅', '⏫', '⏳', '🛫', '🔁', '➕', '✅', '❌', 'Edit task…'],
  );

  const due = menu('- [ ] report |', 'en', { stage: 'date', field: 'due' });
  assert.equal(write(due, 'Tomorrow').insert, '📅 2026-11-11');

  const rep = menu('- [ ] report |', 'en', { stage: 'recurrence' });
  assert.equal(write(rep, 'Every 2 weeks').insert, '🔁 every 2 weeks');
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
