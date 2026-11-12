/**
 * Lunar / solar-term / traditional-festival data — the front-end mirror of the
 * Rust `lunar` cache (sourced from hungtcs/traditional-chinese-calendar-database,
 * fetched per year and cached in `lunar-cache.json`). We flatten the cached
 * years into a date → day lookup so cell rendering is O(1).
 *
 * The data is fixed per year (1901–2100), so a missing year simply means the
 * cell falls back to the local lunar algorithm in `lib/lunar`-adjacent code.
 */

export interface LunarDay {
  date: string;
  /** Solar term name for that day, e.g. 小寒; absent on ordinary days. */
  solarTerm?: string | null;
  /** Chinese lunar month name, e.g. 正月 / 十一月 / 十二月. */
  lunarMonth?: string;
  /** Chinese lunar day name, e.g. 初一 / 十三 / 廿三. */
  lunarDate?: string;
  /** True when this is an intercalary (leap) lunar month. */
  leap?: boolean;
}

export interface CachedLunarYear {
  fetchedAt: string;
  lastCheckedAt?: string | null;
  source: string;
  etag?: string | null;
  lastModified?: string | null;
  days: LunarDay[];
}

export type CachedLunarYears = Record<string, CachedLunarYear>;

export interface LunarSnapshot {
  years: CachedLunarYears;
  backoff?: { failures: number; nextAttemptAt?: string | null };
  cachePath?: string;
}

/** Flatten cached years into a `date → LunarDay` map for O(1) cell lookups. */
export function lunarIndex(years: CachedLunarYears): Map<string, LunarDay> {
  const map = new Map<string, LunarDay>();
  for (const entry of Object.values(years)) {
    if (!entry || !Array.isArray(entry.days)) continue;
    for (const day of entry.days) {
      if (day && day.date) map.set(day.date, day);
    }
  }
  return map;
}
