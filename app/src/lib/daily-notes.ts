/**
 * Pure helpers for the F3 Daily Notes feature.
 *
 * No Vue, no Tauri, no I/O — just date/string formatting so this module is
 * trivially unit-testable and reusable from settings UI / command palette /
 * editor. The composable `useDailyNotes` wires these into the file system.
 *
 * Filename format tokens (Moment-ish, kept tiny on purpose):
 *   YYYY  → 4-digit year (e.g. `2026`)
 *   MM    → 2-digit month (`01`–`12`)
 *   DD    → 2-digit day of month (`01`–`31`)
 *   dddd  → full English weekday (`Monday`)
 *   ddd   → short English weekday (`Mon`)
 *   WW    → 2-digit ISO week (`01`–`53`)
 *   Q     → quarter (`1`–`4`)
 *   [X]   → `X` verbatim, so `YYYY-[W]WW` is `2026-W45`
 *
 * Template variables live in `periodic-notes.ts`; this module only owns the
 * filename formatter and the built-in daily template.
 */

const FULL_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Full English weekday name, e.g. `Friday`. */
export function weekdayName(date: Date): string {
  return FULL_WEEKDAYS[date.getDay()];
}

/**
 * Compute the ISO 8601 week number for a date (1–53).
 * Uses the standard "Thursday in the same week" trick.
 */
export function isoWeekNumber(date: Date): number {
  // Copy so we don't mutate the caller's date.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = (d.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Longest first, so `dddd` is never shadowed by `ddd`. */
const FILENAME_TOKENS = ['YYYY', 'dddd', 'ddd', 'WW', 'MM', 'DD', 'Q'] as const;

function tokenValue(token: (typeof FILENAME_TOKENS)[number], date: Date): string {
  switch (token) {
    case 'YYYY':
      return String(date.getFullYear());
    case 'MM':
      return pad2(date.getMonth() + 1);
    case 'DD':
      return pad2(date.getDate());
    case 'dddd':
      return FULL_WEEKDAYS[date.getDay()];
    case 'ddd':
      return SHORT_WEEKDAYS[date.getDay()];
    case 'WW':
      return pad2(isoWeekNumber(date));
    case 'Q':
      return String(Math.floor(date.getMonth() / 3) + 1);
  }
}

/**
 * Substitute filename tokens. A single pass, left to right, so a token never
 * re-scans what a previous token produced (a year like `2026` cannot contain
 * `DD`). `[...]` is emitted verbatim — that is how `YYYY-[W]WW` keeps its `W`.
 */
export function formatDailyFilename(date: Date, format: string): string {
  let out = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '[') {
      const end = format.indexOf(']', i + 1);
      if (end === -1) {
        out += format.slice(i + 1);
        break;
      }
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const token = FILENAME_TOKENS.find((t) => format.startsWith(t, i));
    if (token) {
      out += tokenValue(token, date);
      i += token.length;
      continue;
    }
    out += format[i];
    i += 1;
  }
  return out;
}

/**
 * Reasonable starter template used when the user hasn't customised one.
 * Keep it short so it doesn't feel imposing. The H1 uses {{date}} so the
 * filename and heading stay in sync if the user renames the file later.
 */
export function defaultDailyTemplate(lang: 'en' | 'zh'): string {
  if (lang === 'zh') {
    return [
      '# {{date}}（{{day}}）',
      '',
      '> 上一篇：{{previous}} · 下一篇：{{next}}',
      '',
      '## 今日要事',
      '- ',
      '',
      '## 笔记',
      '',
      '## 复盘',
      '',
    ].join('\n');
  }
  return [
    '# {{date}} ({{day}})',
    '',
    '> Previous: {{previous}} · Next: {{next}}',
    '',
    '## Today',
    '- ',
    '',
    '## Notes',
    '',
    '## Reflections',
    '',
  ].join('\n');
}
