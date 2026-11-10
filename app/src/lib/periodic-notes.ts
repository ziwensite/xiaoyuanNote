/**
 * Periodic notes (batch 10 / P2) — five kinds, one folder + filename format +
 * template each, resolved by pure functions.
 *
 * This is the shape the reference plugin uses (see spec §2.1): every kind is
 * just "anchor date → formatted name → `<folder>/<name>`". There is no
 * aggregation between kinds, and nothing here touches the file system — the
 * composable `useDailyNotes` does the open/create half.
 *
 * Anchors:
 *   daily      the day itself
 *   weekly     first day of that week, per `weekStartsOn`
 *   monthly    the 1st
 *   quarterly  the 1st of the quarter's first month
 *   yearly     Jan 1
 */

import { formatDailyFilename, isoDate, isoWeekNumber, weekdayName } from './daily-notes';

export type PeriodKind = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const PERIOD_KINDS: readonly PeriodKind[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

export interface PeriodConfig {
  /** Workspace-relative folder. Used verbatim — no tokens, so `Quarterly`
   *  stays `Quarterly` instead of turning into `4uarterly`. */
  folder: string;
  /** Filename format *including* the extension, as the daily setting always did. */
  format: string;
  /** Workspace-relative template path; empty = built-in default. */
  template: string;
}

export type PeriodicConfig = Record<PeriodKind, PeriodConfig>;

/**
 * Fresh objects every call — the store hands this straight to state, and a
 * shared literal would let one setter mutate the defaults for everyone.
 * The daily values reproduce the pre-P2 defaults exactly, extension included.
 */
export function defaultPeriodicConfig(): PeriodicConfig {
  return {
    daily: { folder: 'Daily', format: 'YYYY-MM-DD.md', template: '' },
    weekly: { folder: 'Weekly', format: 'YYYY-[W]WW.md', template: '' },
    monthly: { folder: 'Monthly', format: 'YYYY-MM.md', template: '' },
    quarterly: { folder: 'Quarterly', format: 'YYYY-[Q]Q.md', template: '' },
    yearly: { folder: 'Yearly', format: 'YYYY.md', template: '' },
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Read a saved blob into a complete config. `raw` is whatever sat under
 * `periodic` (possibly nothing, possibly tampered); `legacy` is the pre-P2
 * `dailyNotes*` triple, used only when `periodic.daily` is absent so an
 * upgrade keeps pointing at the same files.
 */
export function mergePeriodicConfig(
  raw: unknown,
  legacy: Record<string, unknown> = {},
): PeriodicConfig {
  const defaults = defaultPeriodicConfig();
  const saved = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as PeriodicConfig;
  for (const kind of PERIOD_KINDS) {
    const base = defaults[kind];
    const entry = saved[kind];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      out[kind] = {
        folder: str(e.folder).trim() || base.folder,
        format: str(e.format).trim() || base.format,
        template: str(e.template),
      };
    } else if (kind === 'daily') {
      out[kind] = {
        folder: str(legacy.dailyNotesFolder).trim() || base.folder,
        format: str(legacy.dailyNotesFormat).trim() || base.format,
        template: str(legacy.dailyNotesTemplate),
      };
    } else {
      out[kind] = { ...base };
    }
  }
  return out;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function shiftDays(date: Date, days: number): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The day a period is named after. */
export function periodAnchor(kind: PeriodKind, date: Date, weekStartsOn = 1): Date {
  const d = startOfDay(date);
  switch (kind) {
    case 'daily':
      return d;
    case 'weekly': {
      // 0 = Sunday … 6 = Saturday. Default 1 = Monday.
      const back = (d.getDay() - weekStartsOn + 7) % 7;
      return shiftDays(d, -back);
    }
    case 'monthly':
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case 'quarterly':
      return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    case 'yearly':
      return new Date(d.getFullYear(), 0, 1);
  }
}

/** Move `delta` periods from an anchor; callers pass anchors, not mid-period days. */
export function shiftPeriod(kind: PeriodKind, date: Date, delta: number): Date {
  const d = startOfDay(date);
  switch (kind) {
    case 'daily':
      return shiftDays(d, delta);
    case 'weekly':
      return shiftDays(d, delta * 7);
    case 'monthly':
      return new Date(d.getFullYear(), d.getMonth() + delta, 1);
    case 'quarterly':
      return new Date(d.getFullYear(), d.getMonth() + delta * 3, 1);
    case 'yearly':
      return new Date(d.getFullYear() + delta, 0, 1);
  }
}

export interface PeriodicTarget {
  /** Workspace-relative folder, after token substitution. */
  folder: string;
  filename: string;
  /** Filename without its extension — what `[[wikilinks]]` use. */
  stem: string;
  /** `<folder>/<filename>`, always with `/`; callers join it onto the workspace. */
  path: string;
}

export function periodicTarget(
  kind: PeriodKind,
  date: Date,
  config: PeriodConfig,
  weekStartsOn = 1,
): PeriodicTarget {
  const anchor = periodAnchor(kind, date, weekStartsOn);
  const folder = config.folder.replace(/^[/\\]+|[/\\]+$/g, '');
  const filename = formatDailyFilename(anchor, config.format);
  const stem = filename.replace(/\.[^.]+$/, '');
  return { folder, filename, stem, path: folder ? `${folder}/${filename}` : filename };
}

/** `<folder>/<filename>` for the period `date` falls in. */
export function periodicPath(
  kind: PeriodKind,
  date: Date,
  config: PeriodConfig,
  weekStartsOn = 1,
): string {
  return periodicTarget(kind, date, config, weekStartsOn).path;
}

/**
 * Template variables. Unknown `{{tokens}}` are left alone by the replacer, so a
 * literal `{{example}}` in a user template survives.
 */
export function periodicTemplateVars(
  kind: PeriodKind,
  date: Date,
  config: PeriodConfig,
  weekStartsOn = 1,
): Record<string, string> {
  const anchor = periodAnchor(kind, date, weekStartsOn);
  const target = periodicTarget(kind, date, config, weekStartsOn);
  const weekStart = periodAnchor('weekly', anchor, weekStartsOn);
  const prev = periodicTarget(kind, shiftPeriod(kind, anchor, -1), config, weekStartsOn).stem;
  const next = periodicTarget(kind, shiftPeriod(kind, anchor, 1), config, weekStartsOn).stem;
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  return {
    date: isoDate(anchor),
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    title: target.stem,
    day: weekdayName(anchor),
    week: String(isoWeekNumber(anchor)),
    yesterday: isoDate(shiftDays(anchor, -1)),
    tomorrow: isoDate(shiftDays(anchor, 1)),
    weekStart: isoDate(weekStart),
    weekEnd: isoDate(shiftDays(weekStart, 6)),
    monthStart: isoDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
    monthEnd: isoDate(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    quarter: `${anchor.getFullYear()}-Q${Math.floor(anchor.getMonth() / 3) + 1}`,
    year: String(anchor.getFullYear()),
    prev: `[[${prev}]]`,
    previous: `[[${prev}]]`,
    next: `[[${next}]]`,
  };
}

export function applyPeriodicTemplate(
  template: string,
  kind: PeriodKind,
  date: Date,
  config: PeriodConfig,
  weekStartsOn = 1,
): string {
  const vars = periodicTemplateVars(kind, date, config, weekStartsOn);
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : value;
  });
}
