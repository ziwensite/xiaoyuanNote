import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  festivalOf,
  leapMonth,
  lunarDateLabel,
  lunarDayName,
  qingmingDay,
  solarToLunar,
} from './lunar';

test('solarToLunar hits the known Spring Festival anchors', () => {
  assert.deepEqual(solarToLunar('2025-01-29'), { year: 2025, month: 1, day: 1, leap: false });
  assert.deepEqual(solarToLunar('2026-02-17'), { year: 2026, month: 1, day: 1, leap: false });
  assert.deepEqual(solarToLunar('2025-01-27'), { year: 2024, month: 12, day: 28, leap: false });
});

test('solarToLunar hits the known Mid-Autumn anchors', () => {
  assert.deepEqual(solarToLunar('2024-09-17'), { year: 2024, month: 8, day: 15, leap: false });
  assert.deepEqual(solarToLunar('2025-10-06'), { year: 2025, month: 8, day: 15, leap: false });
  assert.deepEqual(solarToLunar('2026-09-25'), { year: 2026, month: 8, day: 15, leap: false });
});

test('leap months are preserved, not folded into the regular month', () => {
  assert.equal(leapMonth(2025), 6);
  assert.equal(leapMonth(2024), 0);

  let cursor = '2025-07-01';
  let found: ReturnType<typeof solarToLunar> = null;
  for (let i = 0; i < 120; i += 1) {
    const lunar = solarToLunar(cursor);
    if (lunar?.leap && lunar.month === 6 && lunar.day === 1) {
      found = lunar;
      break;
    }
    const [y, m, d] = cursor.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
      next.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  assert.ok(found, 'expected a leap 6th month start in 2025');
  assert.equal(lunarDateLabel('2025-07-25') === '闰六月初一', true);
});

test('the table edges behave (1900 base, 2100 end)', () => {
  assert.deepEqual(solarToLunar('1900-01-31'), { year: 1900, month: 1, day: 1, leap: false });
  assert.equal(solarToLunar('1900-01-30'), null);
  assert.ok(solarToLunar('2100-12-31'));
});

test('traditional festivals come from lunar dates', () => {
  assert.equal(festivalOf('2026-02-17')?.key, 'springFestival');
  assert.equal(festivalOf('2026-02-16')?.key, 'newYearsEve');
  assert.equal(festivalOf('2025-05-31')?.key, 'dragonBoat');
  assert.equal(festivalOf('2026-09-25')?.key, 'midAutumn');
  assert.equal(festivalOf('2026-06-19')?.key, 'dragonBoat');
});

test('Qingming uses the solar-term formula', () => {
  assert.equal(qingmingDay(2025), 4);
  assert.equal(qingmingDay(2026), 5);
  assert.equal(festivalOf('2025-04-04')?.key, 'qingming');
  assert.equal(festivalOf('2026-04-05')?.key, 'qingming');
});

test('day names cover the 30-day cycle', () => {
  assert.equal(lunarDayName(1), '初一');
  assert.equal(lunarDayName(15), '十五');
  assert.equal(lunarDayName(20), '二十');
  assert.equal(lunarDayName(21), '廿一');
  assert.equal(lunarDayName(30), '三十');
});
