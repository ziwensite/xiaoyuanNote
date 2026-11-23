import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPeriodicTemplate,
  defaultPeriodicConfig,
  mergePeriodicConfig,
  periodAnchor,
  periodicPath,
  periodicTarget,
  shiftPeriod,
  type PeriodConfig,
} from './periodic-notes';
import { isoDate } from './daily-notes';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const DAILY: PeriodConfig = { folder: 'Daily', format: 'YYYY-MM-DD.md', template: '' };
const WEEKLY: PeriodConfig = { folder: 'Weekly', format: 'YYYY-[W]WW.md', template: '' };
const MONTHLY: PeriodConfig = { folder: 'Monthly', format: 'YYYY-MM.md', template: '' };
const QUARTERLY: PeriodConfig = { folder: 'Quarterly', format: 'YYYY-[Q]Q.md', template: '' };
const YEARLY: PeriodConfig = { folder: 'Yearly', format: 'YYYY.md', template: '' };

// P2: anchors, tokens and paths. Everything here is pure, so the whole engine
// is checkable without a workspace or a file system.

test('the daily kind resolves exactly where the old daily settings did', () => {
  assert.equal(periodicPath('daily', day(2026, 11, 10), DAILY), 'Daily/2026-11-10.md');
  // The folder is literal: tokens live in the filename only, so a folder named
  // `Quarterly` cannot be mangled into `4uarterly` by the `Q` token.
  assert.equal(
    periodicPath('daily', day(2026, 11, 10), { ...DAILY, folder: 'Archive/Notes' }),
    'Archive/Notes/2026-11-10.md',
  );
});

test('every kind is anchored to the start of its period', () => {
  const tuesday = day(2026, 11, 10);
  assert.equal(isoDate(periodAnchor('daily', tuesday)), '2026-11-10');
  // Monday-start week; 2026-11-10 is a Tuesday.
  assert.equal(isoDate(periodAnchor('weekly', tuesday, 1)), '2026-11-09');
  assert.equal(isoDate(periodAnchor('monthly', tuesday)), '2026-11-01');
  assert.equal(isoDate(periodAnchor('quarterly', tuesday)), '2026-10-01');
  assert.equal(isoDate(periodAnchor('yearly', tuesday)), '2026-01-01');
});

test('a Sunday-start week is one day earlier, and it is honoured by the path', () => {
  const tuesday = day(2026, 11, 10);
  assert.equal(isoDate(periodAnchor('weekly', tuesday, 0)), '2026-11-08');
  assert.equal(periodicPath('weekly', tuesday, WEEKLY, 0), 'Weekly/2026-W45.md');
  assert.equal(periodicPath('weekly', tuesday, WEEKLY, 1), 'Weekly/2026-W46.md');
});

test('the bracket keeps a literal W, and the week number is ISO', () => {
  // 2026-11-09 is a Monday; the Thursday of that week is 2026-11-12 → W46.
  assert.equal(periodicPath('weekly', day(2026, 11, 10), WEEKLY), 'Weekly/2026-W46.md');
  // A week that straddles New Year is named after the anchor day's year:
  // 2026-01-01 (Thu) sits in the week that starts 2025-12-29.
  assert.equal(isoDate(periodAnchor('weekly', day(2026, 1, 1), 1)), '2025-12-29');
  assert.equal(periodicPath('weekly', day(2026, 1, 1), WEEKLY), 'Weekly/2025-W01.md');
  // 2026 has 53 ISO weeks, so the last week of December stays in 2026.
  assert.equal(periodicPath('weekly', day(2026, 12, 28), WEEKLY), 'Weekly/2026-W53.md');
});

test('month, quarter and year names', () => {
  const d = day(2026, 11, 10);
  assert.equal(periodicPath('monthly', d, MONTHLY), 'Monthly/2026-11.md');
  assert.equal(periodicPath('quarterly', d, QUARTERLY), 'Quarterly/2026-Q4.md');
  assert.equal(periodicPath('quarterly', day(2026, 5, 15), QUARTERLY), 'Quarterly/2026-Q2.md');
  assert.equal(periodicPath('yearly', d, YEARLY), 'Yearly/2026.md');
});

test('a leap day is just another day', () => {
  assert.equal(periodicPath('daily', day(2028, 2, 29), DAILY), 'Daily/2028-02-29.md');
  assert.equal(periodicPath('monthly', day(2028, 2, 29), MONTHLY), 'Monthly/2028-02.md');
  assert.equal(isoDate(new Date(2028, 2, 0)), '2028-02-29', 'sanity: 2028 really has a 29th');
});

test('shifting a period stays on anchors', () => {
  assert.equal(isoDate(shiftPeriod('daily', day(2026, 11, 10), -1)), '2026-11-09');
  assert.equal(isoDate(shiftPeriod('weekly', day(2026, 11, 9), 1)), '2026-11-16');
  // Dec 1 + 1 month, which a mid-month date would have overshot.
  assert.equal(isoDate(shiftPeriod('monthly', day(2026, 12, 1), 1)), '2027-01-01');
  assert.equal(isoDate(shiftPeriod('quarterly', day(2026, 10, 1), -1)), '2026-07-01');
  assert.equal(isoDate(shiftPeriod('yearly', day(2026, 1, 1), -1)), '2025-01-01');
  assert.equal(isoDate(shiftPeriod('yearly', day(2028, 2, 29), 1)), '2029-01-01');
});

test('target keeps folder, filename and stem apart', () => {
  const target = periodicTarget('weekly', day(2026, 11, 10), WEEKLY);
  assert.deepEqual(target, {
    folder: 'Weekly',
    filename: '2026-W46.md',
    stem: '2026-W46',
    path: 'Weekly/2026-W46.md',
  });
  // A format without a folder still yields a usable target.
  const flat = periodicTarget('daily', day(2026, 11, 10), { ...DAILY, folder: '' });
  assert.equal(flat.path, '2026-11-10.md');
});

// ---------------------------------------------------------------------------
// Template variables
// ---------------------------------------------------------------------------

test('weekly variables describe the whole period, not the day', () => {
  const tuesday = new Date(2026, 10, 10, 9, 5);
  const out = applyPeriodicTemplate(
    '{{date}} {{title}} {{week}} {{day}} {{weekStart}} {{weekEnd}} {{monthStart}} {{monthEnd}} {{quarter}} {{year}} {{prev}} {{next}} {{time}}',
    'weekly',
    tuesday,
    WEEKLY,
  );
  assert.equal(
    out,
    '2026-11-09 2026-W46 46 Monday 2026-11-09 2026-11-15 2026-11-01 2026-11-30 2026-Q4 2026 [[2026-W45]] [[2026-W47]] 09:05',
  );
});

test('daily keeps the legacy variable names working', () => {
  const out = applyPeriodicTemplate(
    '# {{date}} ({{day}}) – {{previous}} → {{next}}',
    'daily',
    day(2026, 11, 10),
    DAILY,
  );
  assert.equal(out, '# 2026-11-10 (Tuesday) – [[2026-11-09]] → [[2026-11-11]]');
});

test('an unknown token is left alone, and whitespace inside braces is fine', () => {
  assert.equal(
    applyPeriodicTemplate('{{ nope }} {{year}}', 'yearly', day(2026, 11, 10), YEARLY),
    '{{ nope }} 2026',
  );
});

// ---------------------------------------------------------------------------
// Saved-config merge
// ---------------------------------------------------------------------------

test('a blob that predates P2 keeps its daily folder and format', () => {
  const cfg = mergePeriodicConfig(undefined, {
    dailyNotesFolder: 'Journal/Days',
    dailyNotesFormat: 'YYYY.MM.DD.md',
    dailyNotesTemplate: 'Templates/day.md',
  });
  assert.deepEqual(cfg.daily, {
    folder: 'Journal/Days',
    format: 'YYYY.MM.DD.md',
    template: 'Templates/day.md',
  });
  assert.deepEqual(cfg.weekly, defaultPeriodicConfig().weekly);
  assert.equal(cfg.weekly.format, 'YYYY-[W]WW.md');
});

test('an explicit periodic entry wins over the legacy keys', () => {
  const cfg = mergePeriodicConfig(
    { daily: { folder: 'Notes/Day', format: 'DD-MM-YYYY.md', template: '' } },
    { dailyNotesFolder: 'Daily', dailyNotesFormat: 'YYYY-MM-DD.md' },
  );
  assert.equal(cfg.daily.folder, 'Notes/Day');
  assert.equal(cfg.daily.format, 'DD-MM-YYYY.md');
});

test('tampered values fall back instead of leaking through', () => {
  const cfg = mergePeriodicConfig({
    weekly: { folder: 42, format: '   ', template: null },
    monthly: 'not an object',
  });
  assert.equal(cfg.weekly.folder, 'Weekly');
  assert.equal(cfg.weekly.format, 'YYYY-[W]WW.md');
  assert.equal(cfg.weekly.template, '');
  assert.deepEqual(cfg.monthly, defaultPeriodicConfig().monthly);
});

test('the merge returns fresh objects, so a setter cannot poison the defaults', () => {
  const first = mergePeriodicConfig(undefined);
  first.daily.folder = 'Changed';
  assert.equal(mergePeriodicConfig(undefined).daily.folder, 'Daily');
  assert.equal(defaultPeriodicConfig().daily.folder, 'Daily');
});
