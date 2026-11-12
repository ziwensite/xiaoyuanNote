import terms from './solar-terms.json';

const SOLAR_TERMS: Record<string, string> = terms as Record<string, string>;

/**
 * Built-in 24 solar-term lookup, keyed by solar date (YYYY-MM-DD). Data sourced
 * from hungtcs/traditional-chinese-calendar-database (Hong Kong Observatory,
 * 1901–2100) and bundled statically — no network, no runtime astronomical
 * calculation. Returns the term name, or null on an ordinary day.
 */
export function solarTermOf(date: string): string | null {
  return SOLAR_TERMS[date] ?? null;
}
