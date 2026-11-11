/**
 * Chinese statutory holidays: the built-in fallback table, the on-disk cache
 * shape written by the Rust side, and the per-day lookup the calendar uses.
 *
 * Merge rule: the network copy wins **per year**; a year without network data
 * falls back to the built-in table. (A year is only overridden when the cache
 * actually holds days — an empty/failed fetch must not blank a year.)
 *
 * Built-in coverage is 2024–2026. Adding a year is one record in
 * `CN_HOLIDAYS`; nothing else in this file changes.
 *
 * Data shape mirrors NateScarlet/holiday-cn: `{ name, date, isOffDay }`, where
 * `isOffDay: false` is a make-up workday (调休补班).
 */

export interface HolidayRange {
  /** Inclusive `YYYY-MM-DD`. */
  start: string;
  /** Inclusive `YYYY-MM-DD`. */
  end: string;
  /** Key in `HOLIDAY_NAME_ZH`, used to derive the displayed Chinese name. */
  nameKey: string;
}

export interface BuiltinHolidayYear {
  off: HolidayRange[];
  /** Make-up workdays (`YYYY-MM-DD`). */
  work: string[];
}

export type BuiltinHolidayTable = Record<number, BuiltinHolidayYear>;

export const HOLIDAY_NAME_ZH: Record<string, string> = {
  newYear: '元旦',
  springFestival: '春节',
  qingming: '清明',
  labourDay: '劳动节',
  dragonBoat: '端午',
  midAutumn: '中秋',
  nationalDay: '国庆',
};

function off(start: string, end: string, nameKey: string): HolidayRange {
  return { start, end, nameKey };
}

/** 2024–2026, from the State Council notices. Fallback only. */
export const CN_HOLIDAYS: BuiltinHolidayTable = {
  2024: {
    off: [
      off('2024-01-01', '2024-01-01', 'newYear'),
      off('2024-02-10', '2024-02-17', 'springFestival'),
      off('2024-04-04', '2024-04-06', 'qingming'),
      off('2024-05-01', '2024-05-05', 'labourDay'),
      off('2024-06-08', '2024-06-10', 'dragonBoat'),
      off('2024-09-15', '2024-09-17', 'midAutumn'),
      off('2024-10-01', '2024-10-07', 'nationalDay'),
    ],
    work: [
      '2024-02-04',
      '2024-02-18',
      '2024-04-07',
      '2024-04-28',
      '2024-05-11',
      '2024-09-14',
      '2024-09-29',
      '2024-10-12',
    ],
  },
  2025: {
    off: [
      off('2025-01-01', '2025-01-01', 'newYear'),
      off('2025-01-28', '2025-02-04', 'springFestival'),
      off('2025-04-04', '2025-04-06', 'qingming'),
      off('2025-05-01', '2025-05-05', 'labourDay'),
      off('2025-05-31', '2025-06-02', 'dragonBoat'),
      off('2025-10-01', '2025-10-08', 'nationalDay'),
    ],
    work: ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'],
  },
  2026: {
    off: [
      off('2026-01-01', '2026-01-03', 'newYear'),
      off('2026-02-15', '2026-02-22', 'springFestival'),
      off('2026-04-04', '2026-04-06', 'qingming'),
      off('2026-05-01', '2026-05-05', 'labourDay'),
      off('2026-06-19', '2026-06-21', 'dragonBoat'),
      off('2026-09-25', '2026-09-27', 'midAutumn'),
      off('2026-10-01', '2026-10-07', 'nationalDay'),
    ],
    work: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-04-26', '2026-05-09', '2026-09-20', '2026-10-10'],
  },
};

/** One day as returned by the API and stored in the cache. */
export interface HolidayDay {
  date: string;
  name: string;
  off: boolean;
}

/** One year in `holidays-cache.json` (written by Rust, camelCase). */
export interface CachedHolidayYear {
  /** When the data last changed (200 with a body). */
  fetchedAt: string;
  /** Last successful check, including 304 — this is what the TTL uses. */
  lastCheckedAt?: string | null;
  /** Raw data kind, e.g. `holiday-cn`. */
  source: string;
  etag?: string | null;
  lastModified?: string | null;
  days: HolidayDay[];
}

export type CachedHolidayYears = Record<string, CachedHolidayYear>;

export interface HolidaySnapshot {
  years: CachedHolidayYears;
  backoff?: { failures: number; nextAttemptAt?: string | null };
  cachePath?: string;
}

export type HolidayKind = 'off' | 'work';

export interface HolidayEntry {
  kind: HolidayKind;
  /** Chinese festival name from the source; may be empty for built-in 补班. */
  name: string;
  source: 'builtin' | 'network';
}

export interface ResolvedHolidayYear {
  year: number;
  source: 'builtin' | 'network';
  days: HolidayDay[];
}

const DAY_MS = 86_400_000;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

function expandBuiltin(table: BuiltinHolidayYear): HolidayDay[] {
  const days: HolidayDay[] = [];
  for (const range of table.off) {
    const name = HOLIDAY_NAME_ZH[range.nameKey] ?? range.nameKey;
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      days.push({ date: d, name, off: true });
    }
  }
  for (const date of table.work) days.push({ date, name: '', off: false });
  return days;
}

/**
 * Per-year switch between network and built-in data. Exported for tests; the
 * app calls `resolveHolidayYears`.
 */
export function mergeHolidayYears(
  builtin: BuiltinHolidayTable,
  cached: CachedHolidayYears,
): ResolvedHolidayYear[] {
  const merged: ResolvedHolidayYear[] = [];
  const builtinYears = Object.keys(builtin)
    .map(Number)
    .sort((a, b) => a - b);

  for (const year of builtinYears) {
    const hit = cached[String(year)];
    if (hit && hit.days.length > 0) {
      merged.push({ year, source: 'network', days: hit.days });
    } else {
      merged.push({ year, source: 'builtin', days: expandBuiltin(builtin[year]) });
    }
  }

  // Network-only years (e.g. a future year the built-in table does not know).
  for (const [key, value] of Object.entries(cached)) {
    const year = Number(key);
    if (builtin[year] || value.days.length === 0) continue;
    merged.push({ year, source: 'network', days: value.days });
  }

  return merged;
}

export function resolveHolidayYears(cached: CachedHolidayYears): ResolvedHolidayYear[] {
  return mergeHolidayYears(CN_HOLIDAYS, cached);
}

/**
 * Flatten resolved years into a date → entry map. A make-up workday wins over
 * a day off if a source ever lists both (the workday is the narrower signal).
 */
export function holidayIndex(years: ResolvedHolidayYear[]): Map<string, HolidayEntry> {
  const index = new Map<string, HolidayEntry>();
  for (const year of years) {
    for (const day of year.days) {
      const existing = index.get(day.date);
      if (existing?.kind === 'work') continue;
      index.set(day.date, {
        kind: day.off ? 'off' : 'work',
        name: day.name,
        source: year.source,
      });
    }
  }
  return index;
}

/** Map an API festival name to its built-in key, or null when unknown. */
export function holidayNameKey(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  const direct = Object.entries(HOLIDAY_NAME_ZH).find(([, zh]) => zh === name);
  if (direct) return direct[0];
  if (name === '元旦节') return 'newYear';
  if (name === '清明节') return 'qingming';
  if (name === '端午节') return 'dragonBoat';
  if (name === '中秋节') return 'midAutumn';
  if (name === '国庆节') return 'nationalDay';
  return null;
}

/** True when `date` is an `YYYY-MM-DD` inside the built-in table's years. */
export function isBuiltinHolidayDate(date: string): boolean {
  return Boolean(CN_HOLIDAYS[Number(date.slice(0, 4))]);
}
