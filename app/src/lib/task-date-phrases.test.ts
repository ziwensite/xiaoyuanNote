import { test } from 'node:test';
import assert from 'node:assert/strict';

import { naturalDateChanges } from './task-date-phrases';

/** 2026-11-10 is a Tuesday. */
const TODAY = '2026-11-10';

function apply(prefix: string): string {
  const changes = naturalDateChanges(prefix, TODAY);
  assert.ok(changes, `no phrase understood in ${JSON.stringify(prefix)}`);
  let out = prefix;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

test('Chinese day words become a due date', () => {
  assert.equal(apply('- [ ] 交报告 今天'), '- [ ] 交报告 📅 2026-11-10');
  assert.equal(apply('- [ ] 交报告 明天'), '- [ ] 交报告 📅 2026-11-11');
  assert.equal(apply('- [ ] 交报告 后天'), '- [ ] 交报告 📅 2026-11-12');
  assert.equal(apply('- [ ] 交报告 大后天'), '- [ ] 交报告 📅 2026-11-13');
});

test('weekday phrases resolve against the current week', () => {
  assert.equal(apply('- [ ] 周会 下周三'), '- [ ] 周会 📅 2026-11-18');
  assert.equal(apply('- [ ] 周会 周三'), '- [ ] 周会 📅 2026-11-11');
  assert.equal(apply('- [ ] 周会 本周三'), '- [ ] 周会 📅 2026-11-11');
  assert.equal(apply('- [ ] 周会 下星期一'), '- [ ] 周会 📅 2026-11-16');
});

test('month phrases become a date', () => {
  assert.equal(apply('- [ ] 结算 月末'), '- [ ] 结算 📅 2026-11-30');
  assert.equal(apply('- [ ] 结算 下个月'), '- [ ] 结算 📅 2026-12-10');
  assert.equal(apply('- [ ] 结算 下个月底'), '- [ ] 结算 📅 2026-12-31');
  assert.equal(apply('- [ ] 结算 12月31日'), '- [ ] 结算 📅 2026-12-31');
  assert.equal(apply('- [ ] 结算 20号'), '- [ ] 结算 📅 2026-11-20');
});

test('English phrases are understood too', () => {
  assert.equal(apply('- [ ] report tomorrow'), '- [ ] report 📅 2026-11-11');
  assert.equal(apply('- [ ] report next monday'), '- [ ] report 📅 2026-11-16');
  assert.equal(apply('- [ ] report next week'), '- [ ] report 📅 2026-11-17');
  assert.equal(apply('- [ ] report end of month'), '- [ ] report 📅 2026-11-30');
  assert.equal(apply('- [ ] report in 3 days'), '- [ ] report 📅 2026-11-13');
});

test('the keyword in front chooses scheduled or start', () => {
  assert.equal(apply('- [ ] 复盘 计划 明天'), '- [ ] 复盘 计划 ⏳ 2026-11-11');
  assert.equal(apply('- [ ] 复盘 开始 明天'), '- [ ] 复盘 开始 🛫 2026-11-11');
  assert.equal(apply('- [ ] 复盘 due tomorrow'), '- [ ] 复盘 due 📅 2026-11-11');
});

test('an existing date token is changed in place, not duplicated', () => {
  assert.equal(
    apply('- [ ] 复盘 📅 2026-01-01 明天'),
    '- [ ] 复盘 📅 2026-11-11 ',
  );
  assert.equal(
    apply('- [ ] 复盘 🛫 2026-01-01 开始 明天'),
    '- [ ] 复盘 🛫 2026-11-11 开始 ',
  );
});

test('a time range lands on the reminder token', () => {
  assert.equal(apply('- [ ] 站会 明天 15:00-16:00'), '- [ ] 站会 明天 ⏰ 15:00');
  assert.equal(apply('- [ ] 站会 3pm-4pm'), '- [ ] 站会 ⏰ 15:00');
  assert.equal(apply('- [ ] 站会 ⏰ 09:00 15:00-16:00'), '- [ ] 站会 ⏰ 15:00 ');
});

test('the recurrence rule stays before the dates', () => {
  assert.equal(
    apply('- [ ] 浇水 🔁 every week 明天'),
    '- [ ] 浇水 📅 2026-11-11 🔁 every week ',
  );
});

test('everything outside the phrase is preserved byte for byte', () => {
  assert.equal(apply('-   [ ]   a   b   明天'), '-   [ ]   a   b   📅 2026-11-11');
  assert.equal(
    apply('- [ ] 保留  #tag  📅 2026-01-01  明天'),
    '- [ ] 保留  #tag  📅 2026-11-11  ',
  );
});

test('prose and other lines are left alone', () => {
  assert.equal(naturalDateChanges('- [ ] 明天见', TODAY), null);
  assert.equal(naturalDateChanges('- [ ] 明天开会 再说', TODAY), null);
  assert.equal(naturalDateChanges('明天', TODAY), null);
  assert.equal(naturalDateChanges('普通段落 明天 ', TODAY), null);
  assert.equal(naturalDateChanges('- [ ] nothing here', TODAY), null);
});

test('impossible dates are not silently normalised', () => {
  assert.equal(naturalDateChanges('- [ ] x 2月30日', TODAY), null);
  assert.equal(naturalDateChanges('- [ ] x 25:00', TODAY), null);
});
