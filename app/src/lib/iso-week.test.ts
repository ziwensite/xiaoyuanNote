import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isoWeek } from './iso-week';

test('weeks start on Monday and belong to the year of their Thursday', () => {
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2025-01-01'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2026-11-11'), { year: 2026, week: 46 });
});

test('a 53-week year is detected', () => {
  assert.deepEqual(isoWeek('2020-12-31'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2022-01-02'), { year: 2021, week: 52 });
});

test('mid-year weeks count from the first Monday', () => {
  assert.deepEqual(isoWeek('2025-06-16'), { year: 2025, week: 25 });
  assert.deepEqual(isoWeek('2025-12-28'), { year: 2025, week: 52 });
});
