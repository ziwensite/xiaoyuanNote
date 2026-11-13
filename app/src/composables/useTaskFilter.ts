/**
 * The ONE filter chain behind both task lists.
 *
 * `TasksPanel.vue` (sidebar) and the task column in `CalendarWorkspace.vue`
 * (main calendar view) show the same tasks with the same filters — they only
 * differ in where they sit and how a row is laid out. State therefore lives in
 * a module-level singleton: switching the view, period, priority or calendar
 * link in one list is immediately reflected in the other.
 *
 * The filter is deliberately shape-based (`TaskFilterItem`) so it can consume
 * either projection of the workspace index without either panel owning a
 * second copy of the logic. Writes are NOT here — they stay in `useTasks()`.
 */
import { computed, ref, type Ref } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useCalendarStore } from '../stores/calendar';
import { addDays } from '../lib/calendar';
import { localDateKey, type TaskPriority } from '../lib/tasks';
import { PERIOD_KINDS, shiftPeriod, type PeriodKind } from '../lib/periodic-notes';
import { periodWindow } from '../lib/period-window';

export type TaskView = 'open' | 'today' | 'all';
export const TASK_VIEWS: readonly TaskView[] = ['open', 'today', 'all'];
export { PERIOD_KINDS };

/** The fields every task projection must expose to the shared filter. */
export interface TaskFilterItem {
  done: boolean;
  title: string;
  due: string | null;
  priority: TaskPriority;
}

interface SharedState {
  view: Ref<TaskView>;
  query: Ref<string>;
  windowOn: Ref<boolean>;
  windowKind: Ref<PeriodKind>;
  windowDate: Ref<Date>;
  priorityOnly: Ref<boolean>;
}

let sharedState: SharedState | null = null;
function shared(): SharedState {
  if (!sharedState) {
    sharedState = {
      view: ref<TaskView>('open'),
      query: ref(''),
      windowOn: ref(false),
      windowKind: ref<PeriodKind>('weekly'),
      windowDate: ref(new Date()),
      priorityOnly: ref(false),
    };
  }
  return sharedState;
}

export function useTaskFilter() {
  const settings = useSettingsStore();
  const calendar = useCalendarStore();
  const s = shared();

  const activeWindow = computed(() =>
    periodWindow(s.windowKind.value, s.windowDate.value, settings.weekStartsOn),
  );
  const windowRange = computed(() =>
    activeWindow.value.start === activeWindow.value.end
      ? activeWindow.value.start
      : `${activeWindow.value.start} – ${activeWindow.value.end}`,
  );
  const linked = computed(() => settings.tasksLinkCalendar);
  /** A selected day, or the whole selected week. Null when the link is off. */
  const linkedRange = computed<{ start: string; end: string } | null>(() => {
    if (!linked.value) return null;
    const wk = calendar.selectedWeekStart;
    if (wk) return { start: wk, end: addDays(wk, 6) };
    return { start: calendar.focusDate, end: calendar.focusDate };
  });
  /** Recomputed per render: the panel can stay open across midnight. */
  const today = computed(() => localDateKey(new Date()));

  function setView(event: Event) {
    s.view.value = (event.target as HTMLSelectElement).value as TaskView;
  }

  /** "off" clears the period window; any other value turns it on and switches
   *  the kind, resetting the anchor to today. */
  function setPeriod(event: Event) {
    const v = (event.target as HTMLSelectElement).value;
    if (v === 'off') {
      s.windowOn.value = false;
      return;
    }
    s.windowOn.value = true;
    const kind = v as PeriodKind;
    if (kind !== s.windowKind.value) {
      s.windowKind.value = kind;
      s.windowDate.value = new Date();
    }
  }

  function toggleWindow() {
    s.windowOn.value = !s.windowOn.value;
  }
  function stepWindow(delta: number) {
    s.windowDate.value = shiftPeriod(s.windowKind.value, activeWindow.value.anchor, delta);
  }
  function togglePriority() {
    s.priorityOnly.value = !s.priorityOnly.value;
  }
  function toggleLink() {
    settings.toggleTasksLinkCalendar();
  }

  function inWindow(task: TaskFilterItem, win: { start: string; end: string }): boolean {
    return !task.done && task.due !== null && task.due >= win.start && task.due <= win.end;
  }

  /** One chain for both lists: period → view → priority → calendar link → text.
   *  The calendar link is an extra AND condition, never a replacement. */
  function filter<T extends TaskFilterItem>(tasks: readonly T[]): T[] {
    const win = s.windowOn.value ? activeWindow.value : null;
    const range = linkedRange.value;
    const query = s.query.value.trim().toLowerCase();
    const day = today.value;
    const view = s.view.value;
    const priorityOnly = s.priorityOnly.value;
    return tasks.filter((task) => {
      if (win) {
        if (!inWindow(task, win)) return false;
      } else if (view === 'open') {
        if (task.done) return false;
      } else if (view === 'today') {
        if (task.done || !task.due || task.due > day) return false;
      }
      if (priorityOnly && task.priority === null) return false;
      if (range && (!task.due || task.due < range.start || task.due > range.end)) return false;
      return !query || task.title.toLowerCase().includes(query);
    });
  }

  /** Header tally: follows every DATE scope (period + calendar link) and the
   *  priority filter, but NOT the open/today/all view or the text query —
   *  choosing a view only changes which rows are shown, never the tally. */
  function count<T extends TaskFilterItem>(tasks: readonly T[]): { open: number; total: number } {
    const win = s.windowOn.value ? activeWindow.value : null;
    const range = linkedRange.value;
    const priorityOnly = s.priorityOnly.value;
    const list = tasks.filter((task) => {
      if (win && !inWindow(task, win)) return false;
      if (priorityOnly && task.priority === null) return false;
      if (range && (!task.due || task.due < range.start || task.due > range.end)) return false;
      return true;
    });
    return { open: list.filter((task) => !task.done).length, total: list.length };
  }

  return {
    view: s.view,
    query: s.query,
    windowOn: s.windowOn,
    windowKind: s.windowKind,
    windowDate: s.windowDate,
    priorityOnly: s.priorityOnly,
    linked,
    activeWindow,
    windowRange,
    linkedRange,
    today,
    setView,
    setPeriod,
    toggleWindow,
    stepWindow,
    togglePriority,
    toggleLink,
    filter,
    count,
  };
}
