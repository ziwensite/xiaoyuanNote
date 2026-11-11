/**
 * Single source of truth for "which day the calendar is looking at" and which
 * view is selected. The sidebar mini month and the full dialog both read and
 * write this store, so they can never show different months.
 *
 * Focus date + view persist per workspace (`solomd.calendar.v1::<folder>`),
 * mirroring the tabs bucket: the calendar is about files in that workspace,
 * so each workspace keeps its own place. `dialogOpen` is session-only.
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { localDateKey, shiftMonth as shiftMonthDate } from '../lib/calendar';
import {
  parseCalendarPrefs,
  serializeCalendarPrefs,
  type CalendarEditorView,
} from '../lib/calendar-prefs';
import { useWorkspaceStore } from './workspace';
import { useTabsStore } from './tabs';
import { prefersOverlayEditor } from '../lib/editor-layout';

const KEY_PREFIX = 'solomd.calendar.v1::';

function bucketKey(folder: string | null): string {
  return `${KEY_PREFIX}${folder ?? ''}`;
}

function readBucket(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeBucket(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Private mode / quota — the in-memory state still works for this session.
  }
}

export const useCalendarStore = defineStore('calendar', () => {
  const workspace = useWorkspaceStore();
  const focusDate = ref(localDateKey(new Date()));
  const view = ref<CalendarEditorView>('month');
  const dialogOpen = ref(false);

  let hydrating = false;

  function hydrate() {
    hydrating = true;
    const prefs = parseCalendarPrefs(readBucket(bucketKey(workspace.currentFolder)));
    focusDate.value = prefs.focusDate;
    view.value = prefs.view;
    hydrating = false;
  }

  function persist() {
    if (hydrating) return;
    writeBucket(
      bucketKey(workspace.currentFolder),
      serializeCalendarPrefs({ focusDate: focusDate.value, view: view.value }),
    );
  }

  watch(() => workspace.currentFolder, hydrate, { immediate: true });
  watch([focusDate, view], persist);

  /** The only write path for the shared date. */
  function setFocusDate(date: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) focusDate.value = date;
  }

  function shiftMonth(delta: number) {
    focusDate.value = shiftMonthDate(focusDate.value, delta);
  }

  function goToday() {
    focusDate.value = localDateKey(new Date());
  }

  function setView(next: CalendarEditorView) {
    view.value = next;
  }

  /** The one entry point for "show the full calendar". Desktop widths open it
   *  as an editor tab (singleton, parameters updated in place); narrow windows,
   *  phones and tablets keep the dialog. */
  function openWorkspace(date?: string, nextView?: CalendarEditorView) {
    if (date) setFocusDate(date);
    if (nextView) setView(nextView);
    if (prefersOverlayEditor()) {
      dialogOpen.value = true;
      return;
    }
    useTabsStore().openInput('calendar', { date: focusDate.value, view: view.value });
  }

  /** Narrow-shell only; `openWorkspace` is the desktop path. */
  function openDialog(date?: string) {
    if (date) setFocusDate(date);
    dialogOpen.value = true;
  }

  function closeDialog() {
    dialogOpen.value = false;
  }

  return {
    focusDate,
    view,
    dialogOpen,
    setFocusDate,
    shiftMonth,
    goToday,
    setView,
    openWorkspace,
    openDialog,
    closeDialog,
  };
});
