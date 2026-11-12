/**
 * Lunar / solar-term / traditional-festival cache for the calendar.
 *
 * Mirrors `useHolidaysStore`'s shape but for the fixed lunar data: it holds the
 * snapshot Rust read from `lunar-cache.json` and exposes it as a date → day map,
 * and asks Rust to refresh only on the same real events (startup, calendar open,
 * manual button). Every failure is silent — the calendar keeps rendering its
 * local lunar fallback.
 */
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import {
  lunarIndex,
  type CachedLunarYears,
  type LunarDay,
  type LunarSnapshot,
} from '../lib/lunar';
import { useSettingsStore } from './settings';

const TTL_MS = 365 * 86_400_000;

function nowParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function lastCheckedOf(entry: { lastCheckedAt?: string | null; fetchedAt?: string } | undefined) {
  const value = entry?.lastCheckedAt ?? entry?.fetchedAt;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export const useLunarStore = defineStore('lunar', {
  state: () => ({
    years: {} as CachedLunarYears,
    loaded: false,
    checking: false,
    lastOutcome: null as string | null,
    lastUpdatedYears: [] as number[],
  }),

  getters: {
    /** Cached years flattened to a date → day map for O(1) cell lookups. */
    index(state): Map<string, LunarDay> {
      return lunarIndex(state.years);
    },
  },

  actions: {
    /** Read the cache once. Never touches the network. */
    async init() {
      if (this.loaded) return;
      this.loaded = true;
      try {
        const snapshot = await invoke<LunarSnapshot>('lunar_cached');
        this.years = snapshot?.years ?? {};
      } catch {
        // Browser preview / no backend: the local lunar algorithm still renders.
      }
    },

    async maybeRefresh(
      reason: 'startup' | 'open' | 'manual',
    ): Promise<string | null> {
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
      return Date.now() - checked >= TTL_MS;
    },

    /** Current year, plus next year in December (its data is already published). */
    requestedYears(): number[] {
      const { year, month } = nowParts();
      return month === 12 ? [year, year + 1] : [year];
    },

    async refresh(force: boolean): Promise<string> {
      this.checking = true;
      try {
        const result = await invoke<{
          outcome: string;
          updatedYears: number[];
          checkedAt: string | null;
          snapshot: LunarSnapshot;
        }>('lunar_refresh', {
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
    async checkNow(): Promise<string> {
      return (await this.maybeRefresh('manual')) ?? 'skipped';
    },
  },
});
