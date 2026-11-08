/**
 * M3 — pushes the reminder schedule to the Rust timing loop and surfaces
 * delivery failures.
 *
 * The schedule is rebuilt from the workspace index whenever the index changes
 * (file saved, folder switched) and on a rolling timer so the horizon never
 * runs dry. Rust owns the clock and the OS notification; this store never
 * schedules timers for reminders itself.
 *
 * Reminders only fire while the app is running — see `calendar-reminders.ts`
 * and `src-tauri/src/reminders.rs`.
 */
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useWorkspaceIndexStore } from './workspaceIndex';
import { useToastsStore } from './toasts';
import { useI18n } from '../i18n';
import { buildReminderSchedule } from '../lib/calendar-reminders';
import type { CalendarEntry } from '../lib/calendar';

/** Re-push the horizon well before its seven days run out. */
const REFRESH_MS = 30 * 60 * 1000;
/** Collapse a burst of index-updated events into one push. */
const DEBOUNCE_MS = 2_000;

interface FiredPayload {
  id: string;
  notified: boolean;
}

interface State {
  started: boolean;
  lastCount: number;
  lastError: string | null;
}

let unlistenFired: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

export const useRemindersStore = defineStore('reminders', {
  state: (): State => ({
    started: false,
    lastCount: 0,
    lastError: null,
  }),
  actions: {
    async init() {
      if (this.started) return;
      this.started = true;
      const toasts = useToastsStore();
      const { t } = useI18n();

      try {
        unlistenFired = await listen<FiredPayload>('solomd://calendar-reminder', (event) => {
          // A delivered notification needs no in-app duplicate. The event
          // still fires so future UI (banner, history) can hook in.
          if (!event.payload.notified) {
            toasts.warning(t('calendar.reminders.notificationFailed'));
          }
        });
        unlistenError = await listen<{ id: string }>('solomd://calendar-reminder-error', () => {
          // Visible fallback: never let a failed notification disappear
          // silently behind an app-internal-only reminder.
          toasts.warning(t('calendar.reminders.notificationFailed'));
        });
      } catch (err) {
        this.lastError = String(err);
      }

      const idx = useWorkspaceIndexStore();
      unsubscribe = idx.$subscribe(() => this.scheduleSoon());
      timer = setInterval(() => void this.push(), REFRESH_MS);
      await this.push();
    },

    scheduleSoon() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void this.push(), DEBOUNCE_MS);
    },

    /** Rebuild and hand the list to Rust. No-op while the index is loading. */
    async push() {
      const idx = useWorkspaceIndexStore();
      if (!idx.ready) return;
      const entries = idx.folder ? (idx.entries as CalendarEntry[]) : [];
      const items = entries.length ? buildReminderSchedule(entries, Date.now()) : [];
      this.lastCount = items.length;
      try {
        await invoke<number>('reminders_sync', { items });
        this.lastError = null;
      } catch (err) {
        // Older builds / non-Tauri preview: keep the UI alive, but record it
        // instead of pretending the schedule was accepted.
        this.lastError = String(err);
      }
    },

    dispose() {
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      timer = null;
      debounce = null;
      unsubscribe?.();
      unsubscribe = null;
      unlistenFired?.();
      unlistenError?.();
      unlistenFired = null;
      unlistenError = null;
      this.started = false;
    },
  },
});
