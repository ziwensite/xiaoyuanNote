/**
 * Holiday cache for the calendar.
 *
 * Two jobs:
 *   1. hold the snapshot Rust read from `holidays-cache.json`, merged with the
 *      built-in table (network wins per year), exposed as a date → entry map;
 *   2. ask Rust to refresh — only on real events: app startup, calendar open,
 *      or the manual button in Settings. There is no timer here either.
 *
 * Every failure is silent by design: the calendar keeps rendering the cache /
 * built-in table, and nothing toasts. `lastOutcome` exists for the one place
 * that *should* say something — the manual check button.
 */
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import {
  holidayIndex,
  resolveHolidayYears,
  type CachedHolidayYears,
  type HolidayEntry,
  type HolidaySnapshot,
} from '../lib/holidays';
import { useSettingsStore } from './settings';

export type HolidayCheckOutcome = 'updated' | 'current' | 'failed' | 'skipped';

interface RefreshResponse {
  outcome: HolidayCheckOutcome;
  updatedYears: number[];
  checkedAt: string | null;
  snapshot: HolidaySnapshot;
}

const NORMAL_TTL_MS = 7 * 86_400_000;
const NOTICE_TTL_MS = 86_400_000;

function nowParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Nov 20 – Dec 15, when a new State Council notice can land any morning. */
function inNoticeWindow(): boolean {
  const { month, day } = nowParts();
  return (month === 11 && day >= 20) || (month === 12 && day <= 15);
}

function lastCheckedOf(entry: { lastCheckedAt?: string | null; fetchedAt?: string } | undefined) {
  const value = entry?.lastCheckedAt ?? entry?.fetchedAt;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export const useHolidaysStore = defineStore('holidays', {
  state: () => ({
    years: {} as CachedHolidayYears,
    loaded: false,
    checking: false,
    /** Result of the last refresh, for the manual check line in Settings. */
    lastOutcome: null as HolidayCheckOutcome | null,
    lastUpdatedYears: [] as number[],
  }),

  getters: {
    /** Built-in + cached, merged per year, flattened for O(1) cell lookups. */
    index(state): Map<string, HolidayEntry> {
      return holidayIndex(resolveHolidayYears(state.years));
    },
    /** Years with network data on disk (may be newer than the built-in table). */
    coverage(state): number[] {
      return Object.keys(state.years)
        .map(Number)
        .filter((year) => Number.isFinite(year))
        .sort((a, b) => a - b);
    },
  },

  actions: {
    /** Read the cache once. Never touches the network. */
    async init() {
      if (this.loaded) return;
      this.loaded = true;
      try {
        const snapshot = await invoke<HolidaySnapshot>('holidays_cached');
        this.years = snapshot?.years ?? {};
      } catch {
        // Browser preview / no backend: the built-in table still renders.
      }
    },

    /**
     * The only entry point for refreshes. `startup` checks only when the cache
     * is missing or the year rolled over; `open` honours the TTL; `manual`
     * forces past both (Rust still enforces single-flight).
     */
    async maybeRefresh(reason: 'startup' | 'open' | 'manual'): Promise<HolidayCheckOutcome | null> {
      await this.init();
      if (reason !== 'manual' && !useSettingsStore().calendarAutoUpdateHolidays) return null;
      if (this.checking) return null;
      const force = reason === 'manual';
      if (!force && !this.shouldCheck(reason)) return null;
      return this.refresh(force);
    },

    shouldCheck(reason: 'startup' | 'open'): boolean {
      const { year } = nowParts();
      const entry = this.years[String(year)];
      if (!entry || !entry.days?.length) return true;
      const checked = lastCheckedOf(entry);
      if (checked === null) return true;
      if (new Date(checked).getFullYear() !== year) return true;
      if (reason === 'startup') return false;
      const ttl = inNoticeWindow() ? NOTICE_TTL_MS : NORMAL_TTL_MS;
      return Date.now() - checked >= ttl;
    },

    /** Current year, plus next year in December (its notice is already out). */
    requestedYears(): number[] {
      const { year, month } = nowParts();
      return month === 12 ? [year, year + 1] : [year];
    },

    async refresh(force: boolean): Promise<HolidayCheckOutcome> {
      this.checking = true;
      try {
        const result = await invoke<RefreshResponse>('holidays_refresh', {
          years: this.requestedYears(),
          force,
        });
        this.years = result.snapshot?.years ?? this.years;
        this.lastOutcome = result.outcome;
        this.lastUpdatedYears = result.updatedYears ?? [];
        return result.outcome;
      } catch {
        this.lastOutcome = 'failed';
        this.lastUpdatedYears = [];
        return 'failed';
      } finally {
        this.checking = false;
      }
    },

    /** Settings button. */
    async checkNow(): Promise<HolidayCheckOutcome> {
      return (await this.maybeRefresh('manual')) ?? 'skipped';
    },
  },
});
