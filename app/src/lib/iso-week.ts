/**
 * ISO 8601 week numbers.
 *
 * Weeks start on Monday and week 1 is the week containing January 4th, which
 * is the same as saying the week containing the year's first Thursday. The
 * week's *year* can differ from the calendar year around New Year — the caller
 * shows only the number in the gutter, and the year in the tooltip.
 */

const DAY_MS = 86_400_000;

export interface IsoWeek {
  year: number;
  /** 1–53. */
  week: number;
}

/** Monday = 0 … Sunday = 6, in UTC. */
function weekdayMon0(utc: number): number {
  return (new Date(utc).getUTCDay() + 6) % 7;
}

export function isoWeek(date: string): IsoWeek {
  const [y, m, d] = date.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  // The Thursday of this week decides both the week number and its year.
  const thursday = utc + (3 - weekdayMon0(utc)) * DAY_MS;
  const weekYear = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const week1Monday = jan4 - weekdayMon0(jan4) * DAY_MS;
  return {
    year: weekYear,
    week: Math.round((thursday - week1Monday) / (7 * DAY_MS)) + 1,
  };
}
