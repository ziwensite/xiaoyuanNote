import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CN_HOLIDAYS,
  holidayIndex,
  holidayNameKey,
  mergeHolidayYears,
  type CachedHolidayYears,
  type ResolvedHolidayYear,
} from './holidays';

function cachedYear(days: { date: string; name: string; off: boolean }[]): CachedHolidayYears {
  return {
    '2024': { fetchedAt: '2024-11-01T00:00:00Z', source: 'holiday-cn', days },
  };
}

test('the built-in table expands ranges and make-up workdays', () => {
  const index = holidayIndex(mergeHolidayYears(CN_HOLIDAYS, {}));
  assert.equal(index.get('2024-02-10')?.kind, 'off');
  assert.equal(index.get('2024-02-10')?.name, '春节');
  assert.equal(index.get('2024-02-17')?.kind, 'off');
  assert.equal(index.get('2024-02-18')?.kind, 'work');
  assert.equal(index.get('2024-02-19'), undefined);
  assert.equal(index.get('2024-02-04')?.kind, 'work');
  assert.equal(index.get('2024-02-09'), undefined);
});

test('network data replaces the built-in table per year, not per day', () => {
  const index = holidayIndex(
    mergeHolidayYears(CN_HOLIDAYS, cachedYear([{ date: '2024-01-02', name: '测试', off: true }])),
  );
  assert.equal(index.get('2024-01-02')?.name, '测试');
  assert.equal(index.get('2024-01-02')?.source, 'network');
  // The year is fully owned by the network copy now.
  assert.equal(index.get('2024-02-10'), undefined);
  // Other years still come from the built-in table.
  assert.equal(index.get('2025-01-01')?.source, 'builtin');
});

test('a missing or empty cached year falls back to the built-in table', () => {
  const partial: CachedHolidayYears = {
    '2025': { fetchedAt: '2025-11-01T00:00:00Z', source: 'holiday-cn', days: [] },
  };
  const index = holidayIndex(mergeHolidayYears(CN_HOLIDAYS, partial));
  assert.equal(index.get('2025-01-01')?.source, 'builtin');
  assert.equal(index.get('2024-02-10')?.source, 'builtin');
});

test('network-only years are kept', () => {
  const years = mergeHolidayYears(CN_HOLIDAYS, {
    '2027': {
      fetchedAt: '2026-12-01T00:00:00Z',
      source: 'holiday-cn',
      days: [{ date: '2027-01-01', name: '元旦', off: true }],
    },
  });
  assert.ok(years.some((year) => year.year === 2027 && year.source === 'network'));
});

test('a make-up workday wins over a day off on the same date', () => {
  const years: ResolvedHolidayYear[] = [
    {
      year: 2024,
      source: 'network',
      days: [
        { date: '2024-02-04', name: '春节', off: true },
        { date: '2024-02-04', name: '春节', off: false },
        { date: '2024-02-04', name: '春节', off: true },
      ],
    },
  ];
  assert.equal(holidayIndex(years).get('2024-02-04')?.kind, 'work');
});

test('API festival names map onto the built-in keys', () => {
  assert.equal(holidayNameKey('元旦'), 'newYear');
  assert.equal(holidayNameKey('春节'), 'springFestival');
  assert.equal(holidayNameKey('清明节'), 'qingming');
  assert.equal(holidayNameKey('国庆节'), 'nationalDay');
  assert.equal(holidayNameKey('端午节'), 'dragonBoat');
  assert.equal(holidayNameKey('中秋节'), 'midAutumn');
  assert.equal(holidayNameKey('某个新节日'), null);
});
