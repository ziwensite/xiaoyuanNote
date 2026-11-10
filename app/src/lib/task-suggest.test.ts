import { test } from 'node:test';
import assert from 'node:assert/strict';

import { taskSuggestions, type TaskSuggestion } from './task-suggest';
import { parseDatePhrase } from './task-date-phrases';

/** 2026-11-10 is a Tuesday. */
const TODAY = '2026-11-10';

/** `|` marks the caret; it is removed from the line. */
function at(marked: string): { line: string; caret: number } {
  const caret = marked.indexOf('|');
  return { line: marked.replace('|', ''), caret };
}

function menu(marked: string, lang = 'zh'): TaskSuggestion[] {
  const { line, caret } = at(marked);
  const items = taskSuggestions(line, caret, TODAY, lang);
  assert.ok(items, `expected a menu for ${JSON.stringify(line)}`);
  return items;
}

function row(items: TaskSuggestion[], label: string): TaskSuggestion {
  const found = items.find((i) => i.label === label);
  assert.ok(found, `no row ${JSON.stringify(label)} in ${JSON.stringify(items.map((i) => i.label))}`);
  return found;
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
  assert.ok(taskSuggestions('- [ ] 写报告', 6, TODAY, 'zh'));
});

test('every status character is a task line', () => {
  for (const status of [' ', 'x', '/', '-', '?']) {
    const line = `- [${status}] 写报告 `;
    const items = taskSuggestions(line, line.length, TODAY, 'zh');
    assert.ok(items && items.length > 0, `no menu for [- ${status} -]`);
  }
});

test('ordered and quoted task lines are recognised', () => {
  const ordered = '1. [ ] 写报告 ';
  assert.ok(taskSuggestions(ordered, ordered.length, TODAY, 'zh'));
  const quoted = '> - [ ] 写报告 ';
  assert.ok(taskSuggestions(quoted, quoted.length, TODAY, 'zh'));
});

test('date rows write the parsed ISO date as a 📅 token, at the caret', () => {
  const items = menu('- [ ] 写报告 |');
  const tomorrow = row(items, '明天');
  assert.equal(tomorrow.insert, '📅 2026-11-11');
  assert.equal(tomorrow.detail, '2026-11-11');
  assert.equal(tomorrow.from, 10);
  assert.equal(tomorrow.to, 10);
  assert.equal(row(items, '月末').insert, '📅 2026-11-30');
  assert.equal(row(items, '下周三').insert, '📅 2026-11-18');
});

test('an existing due date is replaced, not duplicated', () => {
  const line = '- [ ] 写报告 📅 2026-11-12';
  const items = menu(`${line}|`);
  const tomorrow = row(items, '明天');
  assert.equal(line.slice(tomorrow.from, tomorrow.to), '📅 2026-11-12');
  assert.equal(tomorrow.insert, '📅 2026-11-11');
});

test('a date is inserted before a 🔁 rule that sits earlier in the line', () => {
  const line = '- [ ] 写报告 🔁 every week';
  const items = menu(`${line}|`);
  const tomorrow = row(items, '明天');
  assert.equal(tomorrow.from, line.indexOf('🔁'));
  assert.equal(tomorrow.to, tomorrow.from);
  assert.equal(tomorrow.insert, '📅 2026-11-11');
});

test('field rows write the field token with today, replacing the same field', () => {
  const items = menu('- [ ] 写报告 |');
  const scheduled = row(items, '⏳ 计划');
  assert.equal(scheduled.insert, '⏳ 2026-11-10');
  assert.equal(row(items, '🛫 开始').insert, '🛫 2026-11-10');
  assert.equal(row(items, '📅 截止').insert, '📅 2026-11-10');

  const existing = '- [ ] 写报告 ⏳ 2026-10-01';
  const replacing = row(menu(`${existing}|`), '⏳ 计划');
  assert.equal(existing.slice(replacing.from, replacing.to), '⏳ 2026-10-01');
  assert.equal(replacing.insert, '⏳ 2026-11-10');
});

test('priorities append, replace, and ⏺ removes', () => {
  const appended = row(menu('- [ ] 写报告 |'), '⏫ 较高');
  assert.equal(appended.insert, '⏫');
  assert.equal(appended.from, 10);

  const line = '- [ ] 写报告 ⏫';
  const items = menu(`${line}|`);
  const medium = row(items, '🔼 中等');
  assert.equal(line.slice(medium.from, medium.to), '⏫');
  assert.equal(medium.insert, '🔼');
  // The level the task already has is not offered again.
  assert.equal(items.some((i) => i.label === '⏫ 较高'), false);

  const none = row(items, '⏺ 无');
  assert.equal(none.insert, '');
  assert.equal(line.slice(none.from, none.to), '⏫');
});

test('a priority goes before the existing dates', () => {
  const line = '- [ ] 写报告 📅 2026-11-12';
  const items = menu(`${line}|`);
  assert.equal(row(items, '⏫ 较高').from, line.indexOf('📅'));
});

test('status rows rewrite the checkbox character only', () => {
  const items = menu('- [ ] 写报告 |');
  const doing = row(items, '[/] 进行中');
  assert.equal(doing.from, 3);
  assert.equal(doing.to, 4);
  assert.equal(doing.insert, '/');
  // The current status is already in effect, so it is not offered.
  assert.equal(items.some((i) => i.group === 'status' && i.insert === ' '), false);
});

test('repeat rows replace the rule text, or go before the first date', () => {
  const line = '- [ ] 写报告 🔁 every 2 weeks';
  const items = menu(`${line}|`);
  const weekly = row(items, '🔁 每周');
  assert.equal(line.slice(weekly.from, weekly.to), '🔁 every 2 weeks');
  assert.equal(weekly.insert, '🔁 every week');
  assert.equal(weekly.detail, 'every week');

  const dated = '- [ ] 写报告 📅 2026-11-12';
  const inserted = row(menu(`${dated}|`), '🔁 每月');
  assert.equal(inserted.from, dated.indexOf('📅'));
  assert.equal(inserted.to, inserted.from);
});

test('English labels for a non-Chinese UI language', () => {
  const items = menu('- [ ] report |', 'en');
  assert.equal(row(items, 'Tomorrow').insert, '📅 2026-11-11');
  assert.equal(row(items, '⏳ Scheduled').insert, '⏳ 2026-11-10');
});

test('parseDatePhrase reads whole phrases only', () => {
  assert.deepEqual(parseDatePhrase('今天', TODAY), { date: '2026-11-10', time: undefined });
  assert.deepEqual(parseDatePhrase('下周三', TODAY), { date: '2026-11-18', time: undefined });
  assert.deepEqual(parseDatePhrase('月末', TODAY), { date: '2026-11-30', time: undefined });
  assert.deepEqual(parseDatePhrase('2026-11-30', TODAY), { date: '2026-11-30', time: undefined });
  assert.deepEqual(parseDatePhrase('next monday', TODAY), { date: '2026-11-16', time: undefined });
  assert.deepEqual(parseDatePhrase('15:00', TODAY), { date: undefined, time: '15:00' });
  assert.equal(parseDatePhrase('明天见', TODAY), null);
  assert.equal(parseDatePhrase('随便写点什么', TODAY), null);
  assert.equal(parseDatePhrase('', TODAY), null);
});
