/**
 * Chinese lunar calendar — exact conversion over the classic 1900–2100 table.
 *
 * Each year is one 20-bit record:
 *
 *   bits 0–3   the leap month (0 = none)
 *   bit  16    the leap month has 30 days (else 29)
 *   bits 4–15  months 1–12: 1 = 30 days, 0 = 29 days
 *
 * Conversion is day arithmetic from the anchor 1900-01-31 (lunar 1900 正月初一)
 * in UTC, so no timezone or DST can shift a date. Nothing here is approximate:
 * an out-of-range year returns null and the UI simply shows no lunar text.
 *
 * Pure module (no Vue/Tauri) so `node --test` covers the anchors directly.
 */

/** 1900 … 2100, one entry per year. */
const LUNAR_INFO: readonly number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;

const BASE_UTC = Date.UTC(1900, 0, 31);
const DAY_MS = 86_400_000;

function infoOf(year: number): number | null {
  if (!Number.isInteger(year) || year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
  return LUNAR_INFO[year - LUNAR_MIN_YEAR];
}

/** The leap month of `year` (1–12), or 0 when there is none. */
export function leapMonth(year: number): number {
  const info = infoOf(year);
  return info === null ? 0 : info & 0xf;
}

/** Days in the leap month of `year` (0 when it has none). */
export function leapDays(year: number): number {
  const info = infoOf(year);
  if (info === null || (info & 0xf) === 0) return 0;
  return info & 0x10000 ? 30 : 29;
}

/** Days in lunar month `month` (1–12) of `year`; 0 outside the table. */
export function lunarMonthDays(year: number, month: number): number {
  const info = infoOf(year);
  if (info === null || month < 1 || month > 12) return 0;
  return info & (0x10000 >> month) ? 30 : 29;
}

/** Days in the lunar year, leap month included. */
export function lunarYearDays(year: number): number {
  const info = infoOf(year);
  if (info === null) return 0;
  let total = 0;
  for (let month = 1; month <= 12; month += 1) total += lunarMonthDays(year, month);
  return total + leapDays(year);
}

export interface LunarDate {
  year: number;
  /** 1–12 (the leap month repeats its number). */
  month: number;
  day: number;
  leap: boolean;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Solar `YYYY-MM-DD` → lunar date. Returns null outside 1900–2100 (or for a
 * malformed input), which the UI reads as "no lunar line for this day".
 */
export function solarToLunar(date: string): LunarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  let offset = Math.round((Date.UTC(year, month - 1, day) - BASE_UTC) / DAY_MS);
  if (offset < 0) return null;

  let lunarYear = LUNAR_MIN_YEAR;
  while (lunarYear <= LUNAR_MAX_YEAR) {
    const days = lunarYearDays(lunarYear);
    if (days === 0) return null;
    if (offset < days) break;
    offset -= days;
    lunarYear += 1;
  }
  if (lunarYear > LUNAR_MAX_YEAR) return null;

  const leap = leapMonth(lunarYear);
  for (let lunarMonth = 1; lunarMonth <= 12; lunarMonth += 1) {
    const regular = lunarMonthDays(lunarYear, lunarMonth);
    if (offset < regular) {
      return { year: lunarYear, month: lunarMonth, day: offset + 1, leap: false };
    }
    offset -= regular;
    if (leap === lunarMonth) {
      const extra = leapDays(lunarYear);
      if (offset < extra) {
        return { year: lunarYear, month: lunarMonth, day: offset + 1, leap: true };
      }
      offset -= extra;
    }
  }
  return null;
}

const DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const DAY_NAMES: readonly string[] = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  if (day <= 10) return `初${DIGITS[day - 1]}`;
  if (day < 20) return `十${DIGITS[day - 11]}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${DIGITS[day - 21]}`;
  return '三十';
});

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

/** 初一 … 三十. */
export function lunarDayName(day: number): string {
  return DAY_NAMES[day - 1] ?? '';
}

/** 正月 … 腊月. */
export function lunarMonthName(month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''}月`;
}

/** `初三` / `闰六月初三`, for the cell and the tooltip. */
export function lunarDateLabel(date: string): string | null {
  const lunar = solarToLunar(date);
  if (!lunar) return null;
  return `${lunar.leap ? '闰' : ''}${lunarMonthName(lunar.month)}${lunarDayName(lunar.day)}`;
}

export type FestivalKey =
  | 'newYearsEve'
  | 'springFestival'
  | 'lantern'
  | 'dragonHead'
  | 'qingming'
  | 'dragonBoat'
  | 'doubleSeventh'
  | 'ghost'
  | 'midAutumn'
  | 'doubleNinth'
  | 'laba'
  | 'minorNewYear';

export interface LunarFestival {
  key: FestivalKey;
  /** Chinese proper name; shown as-is in every locale (see the plan). */
  name: string;
}

const LUNAR_FESTIVALS: Record<string, LunarFestival> = {
  '1-1': { key: 'springFestival', name: '春节' },
  '1-15': { key: 'lantern', name: '元宵' },
  '2-2': { key: 'dragonHead', name: '龙抬头' },
  '5-5': { key: 'dragonBoat', name: '端午' },
  '7-7': { key: 'doubleSeventh', name: '七夕' },
  '7-15': { key: 'ghost', name: '中元' },
  '8-15': { key: 'midAutumn', name: '中秋' },
  '9-9': { key: 'doubleNinth', name: '重阳' },
  '12-8': { key: 'laba', name: '腊八' },
  // 小年：北方腊月廿三、南方腊月廿四（数据表内置，非算法推算）。
  '12-23': { key: 'minorNewYear', name: '小年' },
  '12-24': { key: 'minorNewYear', name: '小年' },
};

/**
 * Qingming's day in April. The standard 20th/21st-century coefficients
 * (`[Y×0.2422 + C] − [Y/4]`, Y = last two digits) — exact for 1900–2100.
 */
export function qingmingDay(year: number): number {
  const y = year % 100;
  const c = year >= 2000 ? 4.81 : 5.59;
  return Math.floor(y * 0.2422 + c) - Math.floor(y / 4);
}

/**
 * The traditional festival on a solar date, if any. Solar-term Qingming wins
 * over lunar lookups because it is not a lunar date; 除夕 is detected as the
 * day before lunar 正月初一, so a 29/30-day month cannot shift it.
 */
export function festivalOf(date: string): LunarFestival | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  if (Number(m[2]) === 4 && Number(m[3]) === qingmingDay(Number(m[1]))) {
    return { key: 'qingming', name: '清明' };
  }
  const lunar = solarToLunar(date);
  if (!lunar) return null;
  if (!lunar.leap) {
    const hit = LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`];
    if (hit) return hit;
  }
  const next = solarToLunar(addDays(date, 1));
  if (next && !next.leap && next.month === 1 && next.day === 1) {
    return { key: 'newYearsEve', name: '除夕' };
  }
  return null;
}
