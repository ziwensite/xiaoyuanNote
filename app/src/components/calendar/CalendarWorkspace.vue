<script setup lang="ts">
/**
 * B — full calendar workspace hosted inside `CalendarDialog`.
 *
 * Month is the default: month grid on the left, due-date grouped tasks on the
 * right (overdue / today / this week / later / undated). Day and week are
 * secondary and take the full width. The sidebar only shows a mini month; all
 * detailed views and all editing live here.
 *
 * Everything below uses local wall-clock time. The only Tauri calls are file
 * reads/writes and the existing folder helpers. Writes always re-read the file
 * and refuse to clobber an outside change without asking.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { useWorkspaceIndexStore } from '../../stores/workspaceIndex';
import { useWorkspaceStore } from '../../stores/workspace';
import { useSettingsStore } from '../../stores/settings';
import { useTabsStore } from '../../stores/tabs';
import { useToastsStore } from '../../stores/toasts';
import { useTilesStore } from '../../stores/tiles';
import { useCalendarStore } from '../../stores/calendar';
import { useTasks } from '../../composables/useTasks';
import { useFiles } from '../../composables/useFiles';
import { useI18n, htmlLangFor } from '../../i18n';
import Icons from '../Icons.vue';
import {
  addDays,
  calendarTasksFromEntry,
  createCalendarEvent,
  explainRRule,
  localDateKey,
  makeExceptionEvent,
  newEventUid,
  shiftMonth,
  splitSeriesAt,
  writeCalendarEvent,
  type CalendarEntry,
  type CalendarEvent,
  type CalendarOccurrence,
  type CalendarTask,
} from '../../lib/calendar';
import {
  buildCalendarView,
  groupTasksByDue,
  monthGridRange,
  resolveCalendarViewMode,
  weekRange,
  type CalendarViewDay,
  type TaskDueGroup,
} from '../../lib/calendar-view';
import {
  dailyNoteDates,
  dayDensity,
  type CalendarDayDensity,
} from '../../lib/calendar-density';
import {
  allDaySpanDays,
  applyEventTimes,
  moveOccurrence,
  planCalendarWrite,
  resizeOccurrence,
  wallAt,
  type EventTimes,
} from '../../lib/calendar-edit';
import { noteOwnWrite } from '../../lib/external-change';
import { samePath } from '../../lib/path-key';
import { joinInFolder } from '../../lib/import-plan';
import { parentDirOf } from '../../lib/new-file-target';
import type { FileReadResult } from '../../types';
import type { EditorDraft } from './editor-draft';
import CalendarEditor from './CalendarEditor.vue';

const idx = useWorkspaceIndexStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const toasts = useToastsStore();
const tiles = useTilesStore();
const calendar = useCalendarStore();
const files = useFiles();
const taskList = useTasks();
const { t, lang } = useI18n();

const root = ref<HTMLElement | null>(null);
const dayGrid = ref<HTMLElement | null>(null);
const monthGridEl = ref<HTMLElement | null>(null);
const width = ref(0);

const today = computed(() => localDateKey(new Date()));
const hasFolder = computed(() => idx.folder !== null);

/** Month keeps its split layout; day/week degrade by available width. */
const mode = computed(() => {
  if (calendar.view === 'month') return 'month';
  return resolveCalendarViewMode(calendar.view, width.value || 900);
});

const monthDays = computed(() => monthGridRange(calendar.focusDate));
const range = computed(() => {
  switch (mode.value) {
    case 'day':
      return { from: calendar.focusDate, to: addDays(calendar.focusDate, 1) };
    case 'week': {
      const days = weekRange(calendar.focusDate);
      return { from: days[0], to: addDays(days[6], 1) };
    }
    case 'month':
      return { from: monthDays.value[0], to: addDays(monthDays.value[41], 1) };
    default:
      return { from: addDays(calendar.focusDate, -7), to: addDays(calendar.focusDate, 32) };
  }
});

const viewData = computed(() =>
  buildCalendarView(idx.entries as CalendarEntry[], range.value),
);

const allTasks = computed(() =>
  (idx.entries as CalendarEntry[]).flatMap((entry) => calendarTasksFromEntry(entry)),
);

const taskDoneCount = computed(() => allTasks.value.filter((task) => task.done).length);

/** Simple text + state filter — deliberately not a query language. */
const taskQuery = ref('');
const taskFilter = ref<'all' | 'todo' | 'done'>('all');
const TASK_FILTERS = ['all', 'todo', 'done'] as const;

function cycleTaskFilter() {
  const index = TASK_FILTERS.indexOf(taskFilter.value);
  taskFilter.value = TASK_FILTERS[(index + 1) % TASK_FILTERS.length];
}

const filteredTasks = computed(() => {
  const query = taskQuery.value.trim().toLowerCase();
  return allTasks.value.filter((task) => {
    if (taskFilter.value === 'todo' && task.done) return false;
    if (taskFilter.value === 'done' && !task.done) return false;
    return !query || task.title.toLowerCase().includes(query);
  });
});

const taskGroups = computed(() => groupTasksByDue(filteredTasks.value, today.value, true));
const visibleTasks = computed(() => taskGroups.value.flatMap((group) => group.tasks));

const noteDates = computed(() =>
  dailyNoteDates(
    idx.entries,
    monthDays.value,
    workspace.currentFolder,
    settings.dailyNotesFolder,
    settings.dailyNotesFormat,
  ),
);

/** Same three-state rule as the sidebar mini month (see `calendar-density`). */
const densities = computed(() => {
  const map = new Map<string, CalendarDayDensity>();
  for (const day of viewData.value.days) {
    map.set(day.date, dayDensity(day, noteDates.value.has(day.date)));
  }
  return map;
});

const EMPTY_DENSITY: CalendarDayDensity = {
  state: 'none',
  total: 0,
  done: 0,
  todo: 0,
  events: 0,
  hasNote: false,
};

function densityOf(date: string): CalendarDayDensity {
  return densities.value.get(date) ?? EMPTY_DENSITY;
}

const monthTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric', month: 'long' });
  return fmt.format(wallDate(calendar.focusDate));
});

const dayTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return fmt.format(wallDate(calendar.focusDate));
});

const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { weekday: 'short' });
  return monthDays.value.slice(0, 7).map((date) => fmt.format(wallDate(date)));
});

const weekDays = computed(() => weekRange(calendar.focusDate));
const dayData = computed(
  () => viewData.value.days.find((d) => d.date === calendar.focusDate) ?? viewData.value.days[0],
);
const weekData = computed(() =>
  weekDays.value.map((date) => viewData.value.days.find((d) => d.date === date)).filter(Boolean) as CalendarViewDay[],
);

const agendaGroups = computed(() => {
  const start = addDays(calendar.focusDate, -7);
  const end = addDays(calendar.focusDate, 32);
  return buildCalendarView(idx.entries as CalendarEntry[], { from: start, to: end }).days
    .filter((day) => day.allDay.length || day.timed.length || day.tasks.length)
    .slice(0, 60);
});

// ── Editor ────────────────────────────────────────────────────────────────

const editor = ref<EditorDraft | null>(null);
const editorError = ref('');
const saving = ref(false);

function wallDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

function inMonth(date: string): boolean {
  return date.slice(0, 7) === calendar.focusDate.slice(0, 7);
}

function isFocus(date: string): boolean {
  return date === calendar.focusDate;
}

function tooltipFor(date: string): string {
  const d = densityOf(date);
  const parts = [date];
  if (d.total > 0) {
    parts.push(t('calendar.tooltip.tasks', { total: d.total, done: d.done, todo: d.todo }));
  }
  if (d.events > 0) parts.push(t('calendar.tooltip.events', { count: d.events }));
  if (d.hasNote) parts.push(t('calendar.tooltip.note'));
  return parts.join(' · ');
}

const ARROW_DELTAS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Arrows move the shared focus date; Enter opens that day's detail view. */
function onMonthKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    openDay(calendar.focusDate);
    return;
  }
  const delta = ARROW_DELTAS[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const next = addDays(calendar.focusDate, delta);
  calendar.setFocusDate(next);
  nextTick(() => {
    monthGridEl.value?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  });
}

/** Space toggles the focused task; arrows move between visible rows. */
function onTaskKeydown(event: KeyboardEvent, task: CalendarTask) {
  if (isTypingTarget(event.target)) return;
  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault();
    void toggleTask(task);
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const rows = Array.from(
    (event.currentTarget as HTMLElement)
      .closest('.cal-tasks-pane__scroll')
      ?.querySelectorAll<HTMLElement>('.cal-task-row') ?? [],
  );
  const index = rows.indexOf(event.currentTarget as HTMLElement);
  const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
  next?.focus();
}

function taskGroupLabel(group: TaskDueGroup): string {
  return group.key === 'undated'
    ? t('calendar.undated')
    : t(`calendar.groups.${group.key}`);
}

function timeOf(wall: string): string {
  return wall.slice(11, 16);
}

/** Rule warnings are per-rule-string; cache so render passes stay cheap. */
const warnedRules = new Map<string, string[]>();

function ruleWarningOf(event: CalendarEvent): string {
  if (!event.rrule) return '';
  let tokens = warnedRules.get(event.rrule);
  if (!tokens) {
    tokens = explainRRule(event.rrule).unsupported;
    warnedRules.set(event.rrule, tokens);
  }
  return tokens.length ? t('calendar.editor.ruleWarning', { parts: tokens.join(', ') }) : '';
}

/** Compact marker on event chips; `title` carries the full warning. */
function occurrenceWarning(occ: CalendarOccurrence): string {
  return ruleWarningOf(occ.source);
}

function blankEvent(date: string, allDay: boolean, startMin = 540): CalendarEvent {
  const uid = newEventUid();
  const dtstart = allDay ? date : wallAt(date, startMin);
  const dtend = allDay ? addDays(date, 1) : wallAt(date, startMin + 45);
  return {
    kind: 'event',
    uid,
    summary: '',
    description: '',
    notes: null,
    dtstart,
    dtend,
    tzid: null,
    allDay,
    status: 'CONFIRMED',
    categories: [],
    location: null,
    rrule: null,
    exdate: [],
    seriesUid: null,
    recurrenceId: null,
    alarms: [],
    relatedNote: null,
    source: 'local',
    remoteHref: null,
    etag: null,
    sequence: 0,
    path: '',
    mtime: 0,
  };
}

function openNew(date: string, startMin = 540, allDay = false) {
  const event = blankEvent(date, allDay, startMin);
  editor.value = {
    mode: 'new',
    path: null,
    snapshot: '',
    source: event,
    date,
    allDay,
    start: allDay ? '09:00' : timeOf(event.dtstart),
    end: allDay ? '10:00' : timeOf(event.dtend ?? event.dtstart),
    title: '',
    location: '',
    notes: '',
    status: 'CONFIRMED',
    spanDays: 1,
    recurring: false,
    scope: 'single',
    seriesUid: null,
    recurrenceId: null,
    ruleUnsupported: [],
    alarms: [],
  };
  editorError.value = '';
}

async function openEdit(occ: CalendarOccurrence) {
  const source = occ.source;
  const recurring = !!source.rrule;
  // The form starts from the clicked occurrence. With scope `series` the date
  // inputs are disabled and `buildEvent` keeps the master's own start, so this
  // only changes what the user sees (and what `single` edits).
  const date = occ.start.slice(0, 10);
  editor.value = {
    mode: 'edit',
    path: occ.path,
    snapshot: '',
    source,
    date,
    allDay: source.allDay,
    start: source.allDay ? '09:00' : timeOf(occ.start),
    end: source.allDay ? '10:00' : timeOf(occ.end ?? occ.start),
    title: source.summary,
    location: source.location ?? '',
    notes: source.notes ?? '',
    status: source.status,
    spanDays: allDaySpanDays(source),
    recurring,
    scope: 'series',
    seriesUid: recurring ? source.uid : source.seriesUid,
    recurrenceId: recurring ? occ.start : null,
    ruleUnsupported: explainRRule(source.rrule).unsupported,
    // Copied so cancelling the editor cannot mutate the rendered event and so
    // a non-DISPLAY action survives an unrelated edit.
    alarms: source.alarms.map((alarm) => ({ ...alarm })),
  };
  editorError.value = '';
  // Snapshot for conflict detection. A failure leaves '' — any non-empty disk
  // text then reads as an outside change and the user gets the prompt.
  try {
    const read = await invoke<FileReadResult>('read_file', { path: occ.path });
    if (editor.value?.path === occ.path) editor.value.snapshot = read.content;
  } catch {
    if (editor.value?.path === occ.path) editor.value.snapshot = '';
  }
}

function buildEvent(draft: EditorDraft): CalendarEvent | null {
  const base = draft.source ?? blankEvent(draft.date, draft.allDay);
  const summary = draft.title.trim() || t('calendar.editor.untitled');
  const notes = draft.notes.trim() ? draft.notes : null;
  const location = draft.location.trim() ? draft.location : null;

  // Editing the master keeps its own DTSTART/DTEND; date inputs are disabled
  // for that scope anyway. "This occurrence" (and any non-recurring event)
  // takes the times from the form.
  const keepSeriesTimes = draft.recurring && draft.scope === 'series';

  let dtstart = base.dtstart;
  let dtend = base.dtend;
  if (!keepSeriesTimes) {
    if (draft.allDay) {
      dtstart = draft.date;
      dtend = addDays(draft.date, Math.max(1, draft.spanDays));
    } else {
      const start = parseTime(draft.start);
      const end = parseTime(draft.end);
      if (start === null || end === null) {
        editorError.value = t('calendar.editor.invalidTime');
        return null;
      }
      if (start === end) {
        editorError.value = t('calendar.editor.invalidRange');
        return null;
      }
      const endDate = end < start ? addDays(draft.date, 1) : draft.date;
      dtstart = wallAt(draft.date, start);
      dtend = wallAt(endDate, end);
    }
  }

  if (draft.recurring && draft.scope === 'single' && draft.recurrenceId) {
    // Detached instance: new note, new UID, no RRULE. `series_uid` +
    // `recurrence_id` are what stop the master from also rendering this
    // occurrence (see `makeExceptionEvent`).
    return makeExceptionEvent(base, draft.recurrenceId, {
      summary,
      notes,
      location,
      allDay: draft.allDay,
      dtstart,
      dtend,
      status: draft.status,
      alarms: draft.alarms,
    });
  }

  return {
    ...base,
    summary,
    notes,
    location,
    allDay: draft.allDay,
    dtstart,
    dtend,
    status: draft.status,
    alarms: draft.alarms,
  };
}

function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function eventFileName(date: string, summary: string, uid: string): string {
  const slug = summary
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = uid.replace(/-/g, '').slice(0, 8);
  return `${date}-${slug || 'event'}-${short}.md`;
}

async function saveEditor() {
  const draft = editor.value;
  if (!draft || saving.value) return;
  const event = buildEvent(draft);
  if (!event) return;
  saving.value = true;
  editorError.value = '';
  try {
    if (draft.mode === 'new') {
      await createNewEvent(event);
    } else if (draft.path) {
      if (draft.recurring && draft.scope === 'single') {
        await createExceptionNote(draft.path, event);
      } else if (draft.recurring && draft.scope === 'after') {
        await splitSeriesNote(draft, event);
      } else {
        const ok = await persistExisting(draft.path, Promise.resolve(draft.snapshot), event);
        if (ok) toasts.success(t('calendar.toastSaved'));
      }
    }
  } catch (e) {
    editorError.value = t('calendar.toastFailed', { error: String(e) });
  } finally {
    saving.value = false;
  }
}

async function createNewEvent(event: CalendarEvent) {
  const folder = workspace.currentFolder;
  if (!folder) {
    editorError.value = t('calendar.openFolder');
    return;
  }
  const dir = joinInFolder(folder, 'Calendar');
  const exists = await invoke<boolean>('fs_dir_exists', { path: dir }).catch(() => false);
  if (!exists) {
    await invoke('fs_create_dir', { path: dir }).catch((e) => {
      if (!String(e).includes('already exists')) throw e;
    });
  }
  let path = joinInFolder(dir, eventFileName(event.dtstart.slice(0, 10), event.summary, event.uid));
  if (await invoke<boolean>('fs_file_exists', { path }).catch(() => false)) {
    path = joinInFolder(dir, eventFileName(event.dtstart.slice(0, 10), event.summary, newEventUid()));
  }
  const text = createCalendarEvent(event, '');
  noteOwnWrite(path, text);
  await invoke('write_file', { path, content: text, encoding: 'UTF-8' });
  window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: path } }));
  editor.value = null;
  toasts.success(t('calendar.toastCreated'));
}

/**
 * "This occurrence only": write a detached note next to the master and leave
 * the master untouched. The exception carries `series_uid` + `recurrence_id`
 * (from `makeExceptionEvent`), which is the only thing that stops the master
 * from rendering that occurrence as well.
 */
async function createExceptionNote(masterPath: string, event: CalendarEvent) {
  const dir = parentDirOf(masterPath) ?? workspace.currentFolder;
  if (!dir) {
    editorError.value = t('calendar.openFolder');
    return;
  }
  const date = event.dtstart.slice(0, 10);
  let uid = event.uid;
  let path = joinInFolder(dir, eventFileName(date, event.summary, uid));
  if (await invoke<boolean>('fs_file_exists', { path }).catch(() => false)) {
    uid = newEventUid();
    event = { ...event, uid };
    path = joinInFolder(dir, eventFileName(date, event.summary, uid));
  }
  const text = createCalendarEvent(event, '');
  noteOwnWrite(path, text);
  await invoke('write_file', { path, content: text, encoding: 'UTF-8' });
  window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: path } }));
  editor.value = null;
  toasts.success(t('calendar.toastSavedOnce'));
}

/**
 * "This and following": cap the original series before this occurrence and
 * start a new series here with the edited values.
 *
 * Both halves stay ordinary recurring events (`splitSeriesAt` puts `UNTIL` on
 * the head and keeps the rule on the tail), so nothing later has to understand
 * a third kind of event. The head is written first: if that write is refused
 * because of a conflict, no orphan tail is created.
 */
async function splitSeriesNote(draft: EditorDraft, tail: CalendarEvent) {
  if (!draft.path || !draft.source || !draft.recurrenceId) return;
  const split = splitSeriesAt(draft.source, draft.recurrenceId);
  if (!split) {
    editorError.value = t('calendar.editor.splitFailed');
    return;
  }
  const dir = parentDirOf(draft.path) ?? workspace.currentFolder;
  if (!dir) {
    editorError.value = t('calendar.openFolder');
    return;
  }
  const ok = await persistExisting(draft.path, Promise.resolve(draft.snapshot), split.head);
  if (!ok) return;

  let uid = split.tail.uid;
  let path = joinInFolder(dir, eventFileName(tail.dtstart.slice(0, 10), tail.summary, uid));
  if (await invoke<boolean>('fs_file_exists', { path }).catch(() => false)) {
    uid = newEventUid();
    path = joinInFolder(dir, eventFileName(tail.dtstart.slice(0, 10), tail.summary, uid));
  }
  const created: CalendarEvent = {
    ...tail,
    uid,
    rrule: split.tail.rrule,
    seriesUid: null,
    recurrenceId: null,
    sequence: 0,
    exdate: [],
    path,
  };
  const text = createCalendarEvent(created, '');
  noteOwnWrite(path, text);
  await invoke('write_file', { path, content: text, encoding: 'UTF-8' });
  window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: path } }));
  toasts.success(t('calendar.toastSplit'));
}

/**
 * Rewrite one event, keeping its body byte-for-byte.
 *
 * The file is re-read first. If disk no longer matches the snapshot taken when
 * the edit/drag started, the write stops and the user decides — an outside
 * change is never silently overwritten.
 */
async function persistExisting(
  path: string,
  snapshotPromise: Promise<string>,
  event: CalendarEvent,
  notify = false,
): Promise<boolean> {
  const disk = await invoke<FileReadResult>('read_file', { path });
  const tab = tabs.tabs.find((x) => samePath(x.filePath, path));
  if (tab && tab.content !== tab.savedContent) {
    toasts.warning(t('calendar.toastTabDirty'));
    return false;
  }
  const base = tab ? tab.content : disk.content;
  const next = writeCalendarEvent(base, event);
  const snapshot = await snapshotPromise.catch(() => '');
  if (planCalendarWrite(disk.content, snapshot, next) === 'conflict') {
    const ok = await confirmDialog(t('calendar.confirmConflict'), {
      title: t('calendar.title'),
      kind: 'warning',
      okLabel: t('calendar.conflictOverwrite'),
      cancelLabel: t('calendar.cancel'),
    });
    if (!ok) return false;
  }
  if (tab) {
    tabs.setContent(tab.id, next);
    await files.saveTab(tab, { silent: true });
  } else {
    noteOwnWrite(path, next);
    await invoke('write_file', { path, content: next, encoding: disk.encoding || 'UTF-8' });
    window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: path } }));
  }
  editor.value = null;
  if (notify) toasts.success(t('calendar.toastSaved'));
  return true;
}

async function toggleCancelled() {
  const draft = editor.value;
  if (!draft?.source || !draft.path) return;
  const cancelling = draft.status !== 'CANCELLED';
  if (cancelling) {
    const ok = await confirmDialog(t('calendar.confirmDelete'), {
      title: t('calendar.title'),
      kind: 'warning',
      okLabel: t('calendar.editor.delete'),
      cancelLabel: t('calendar.cancel'),
    });
    if (!ok) return;
  }
  const event = buildEvent({ ...draft, status: cancelling ? 'CANCELLED' : 'CONFIRMED' });
  if (!event) return;
  const ok = await persistExisting(draft.path, Promise.resolve(draft.snapshot), event);
  if (ok) {
    toasts.success(cancelling ? t('calendar.toastCancelled') : t('calendar.toastRestored'));
  }
}

async function openNote(path: string) {
  calendar.closeDialog();
  await files.openPath(path, { bypassNewWindow: true });
}

// ── Tasks ─────────────────────────────────────────────────────────────────

async function toggleTask(task: CalendarTask) {
  const live = taskList.tasks.value.find((x) => samePath(x.path, task.path) && x.line === task.line);
  if (!live) {
    toasts.warning(t('calendar.toastTaskGone'));
    return;
  }
  await taskList.toggle(live);
}

/**
 * Explicit reminder toggle: a task with no `⏰` gets one at the task due hour
 * (09:00), and one that already has reminders has them removed.
 *
 * Nothing is written on its own — this only runs when the bell is clicked — so
 * a note that never used reminders stays byte-identical.
 */
async function toggleTaskReminder(task: CalendarTask) {
  const live = taskList.tasks.value.find((x) => samePath(x.path, task.path) && x.line === task.line);
  if (!live) {
    toasts.warning(t('calendar.toastTaskGone'));
    return;
  }
  const has = (live.meta.reminders?.length ?? 0) > 0;
  if (!has && !live.meta.due) {
    // The scheduler has no anchor without a due date, so the reminder would
    // silently never fire. Say it instead of writing a dead token.
    toasts.warning(t('calendar.taskReminderNeedsDue'));
    return;
  }
  await taskList.setReminder(live, has ? null : '09:00');
}

async function jumpToTask(task: CalendarTask) {
  calendar.closeDialog();
  await files.openPath(task.path, { bypassNewWindow: true });
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('solomd:outline-goto', {
        detail: { line: task.line, paneId: tiles.focusedPaneId },
      }),
    );
  }, 120);
}

// ── Drag / resize (15-minute snap; writes only on pointerup) ───────────────

interface DragPreview {
  path: string;
  eventUid: string;
  oldStart: string;
  oldEnd: string | null;
  times: EventTimes;
}

const dragPreview = ref<DragPreview | null>(null);
let suppressClickUntil = 0;
let cleanupDrag: (() => void) | null = null;

function minutesOnDay(wall: string, date: string): number {
  const startDate = wall.slice(0, 10);
  const delta = daysBetweenDates(date, startDate);
  const m = /T(\d{2}):(\d{2})/.exec(wall);
  return delta * 1440 + (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
}

function daysBetweenDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function displayTimes(occ: CalendarOccurrence): EventTimes {
  const preview = dragPreview.value;
  if (preview && preview.eventUid === occ.eventUid && preview.path === occ.path && preview.oldStart === occ.start) {
    return preview.times;
  }
  return { dtstart: occ.start, dtend: occ.end };
}

function blockStyle(
  block: { occurrence: CalendarOccurrence; startMinutes: number; endMinutes: number; column: number; columns: number },
  date: string,
): Record<string, string> {
  const times = displayTimes(block.occurrence);
  const previewed =
    times.dtstart !== block.occurrence.start || (times.dtend ?? null) !== (block.occurrence.end ?? null);
  let start = previewed ? minutesOnDay(times.dtstart, date) : block.startMinutes;
  let end = previewed && times.dtend ? minutesOnDay(times.dtend, date) : block.endMinutes;
  if (previewed && times.dtstart !== block.occurrence.start && times.dtend === block.occurrence.end) {
    // Moving the whole block: keep the original duration in preview minutes.
    end = start + (block.endMinutes - block.startMinutes);
  }
  start = Math.max(0, Math.min(1440, start));
  end = Math.max(start + 15, Math.min(1440, end));
  const outside = previewed && (start >= 1440 || end <= 0);
  return {
    top: `${(start / 1440) * 100}%`,
    height: `max(16px, ${((end - start) / 1440) * 100}%)`,
    left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
    width: `calc(${100 / block.columns}% - 4px)`,
    opacity: outside ? '0.3' : '1',
  };
}

function snapshotFor(path: string): Promise<string> {
  return invoke<FileReadResult>('read_file', { path })
    .then((r) => r.content)
    .catch(() => '');
}

function beginDayDrag(occ: CalendarOccurrence, kind: 'move' | 'resize', ev: PointerEvent) {
  if (occ.source.rrule) {
    toasts.info(t('calendar.editor.recurringHint'));
    return;
  }
  const grid = dayGrid.value;
  if (!grid) return;
  ev.preventDefault();
  ev.stopPropagation();
  const rect = grid.getBoundingClientRect();
  const pxPerMin = rect.height / 1440;
  const startY = ev.clientY;
  const origin = { dtstart: occ.start, dtend: occ.end };
  let moved = false;
  const snapshot = snapshotFor(occ.path);
  dragPreview.value = null;

  const onMove = (m: PointerEvent) => {
    const dy = m.clientY - startY;
    if (Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const delta = dy / pxPerMin;
    const date = occ.start.slice(0, 10);
    const next = kind === 'move'
      ? moveOccurrence(occ.source, occ.start, date, delta)
      : resizeOccurrence(occ.source, occ.start, delta);
    if (next) {
      dragPreview.value = {
        path: occ.path,
        eventUid: occ.eventUid,
        oldStart: occ.start,
        oldEnd: occ.end,
        times: next,
      };
    }
  };

  const finish = async (commit: boolean) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    cleanupDrag = null;
    const preview = dragPreview.value;
    dragPreview.value = null;
    if (moved) suppressClickUntil = Date.now() + 300;
    if (!commit || !preview) return;
    if (preview.times.dtstart === origin.dtstart && (preview.times.dtend ?? null) === (origin.dtend ?? null)) {
      return;
    }
    const event = applyEventTimes(occ.source, preview.times);
    await persistExisting(occ.path, snapshot, event, true);
  };

  const onUp = () => void finish(true);
  const onCancel = () => void finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') void finish(false);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  document.body.style.userSelect = 'none';
  document.body.style.cursor = kind === 'move' ? 'grabbing' : 'ns-resize';
  cleanupDrag = () => void finish(false);
}

function beginWeekDrag(occ: CalendarOccurrence, ev: PointerEvent) {
  if (occ.source.rrule) {
    toasts.info(t('calendar.editor.recurringHint'));
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const originDate = occ.start.slice(0, 10);
  let target = originDate;
  let moved = false;
  const snapshot = snapshotFor(occ.path);
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';

  const onMove = (m: PointerEvent) => {
    if (Math.abs(m.clientX - startX) > 4 || Math.abs(m.clientY - startY) > 4) moved = true;
    const el = document.elementFromPoint(m.clientX, m.clientY) as HTMLElement | null;
    const cell = el?.closest('[data-date]') as HTMLElement | null;
    target = cell?.dataset.date ?? target;
  };

  const finish = async (commit: boolean) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    cleanupDrag = null;
    if (moved) suppressClickUntil = Date.now() + 300;
    if (!commit || !moved || target === originDate) return;
    const times = moveOccurrence(occ.source, occ.start, target, 0);
    await persistExisting(occ.path, snapshot, applyEventTimes(occ.source, times), true);
  };

  const onUp = () => void finish(true);
  const onCancel = () => void finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') void finish(false);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  cleanupDrag = () => void finish(false);
}

function clickOccurrence(occ: CalendarOccurrence) {
  if (Date.now() < suppressClickUntil) return;
  void openEdit(occ);
}

function clickDay(date: string) {
  calendar.setFocusDate(date);
}

function newOnMonth(date: string) {
  openNew(date, 540, true);
}

function newOnHour(date: string, hour: number) {
  openNew(date, hour * 60, false);
}

function newOnFocusDate() {
  openNew(calendar.focusDate, 540, true);
}

function shift(delta: number) {
  if (mode.value === 'day') calendar.setFocusDate(addDays(calendar.focusDate, delta));
  else if (mode.value === 'week') calendar.setFocusDate(addDays(calendar.focusDate, delta * 7));
  else calendar.setFocusDate(shiftMonth(calendar.focusDate, delta));
}

function openDay(date: string) {
  calendar.setFocusDate(date);
  calendar.setView('day');
}

function eventsOf(day: CalendarViewDay): CalendarOccurrence[] {
  return [...day.allDay, ...day.timed.map((block) => block.occurrence)];
}

function chipTime(occ: CalendarOccurrence): string {
  return occ.allDay ? t('calendar.allDay') : timeOf(occ.start);
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  const el = root.value;
  if (!el) return;
  width.value = el.clientWidth;
  observer = new ResizeObserver((entries) => {
    width.value = entries[0]?.contentRect.width ?? 0;
  });
  observer.observe(el);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  cleanupDrag?.();
});
</script>

<template>
  <div ref="root" class="cal-w">
    <div v-if="!hasFolder" class="cal-empty">{{ t('calendar.openFolder') }}</div>

    <div v-else-if="mode === 'month'" class="cal-w__split">
      <section class="cal-month">
        <header class="cal-month__head">
          <span class="cal-month__title">{{ monthTitle }}</span>
          <div class="cal-nav">
            <button type="button" class="cal-nav__btn" :title="t('calendar.newEvent')" @click="newOnFocusDate">
              <Icons name="plus" :size="14" />
            </button>
            <button type="button" class="cal-nav__btn" :title="t('calendar.prev')" @click="shift(-1)">
              <Icons name="chevron-left" :size="14" />
            </button>
            <button type="button" class="cal-nav__btn" @click="calendar.goToday()">
              {{ t('calendar.today') }}
            </button>
            <button type="button" class="cal-nav__btn" :title="t('calendar.next')" @click="shift(1)">
              <Icons name="chevron-right" :size="14" />
            </button>
          </div>
        </header>
        <div class="cal-month__weekdays" aria-hidden="true">
          <span v-for="(label, i) in weekdayLabels" :key="i">{{ label }}</span>
        </div>
        <div
          ref="monthGridEl"
          class="cal-month__grid"
          @keydown="onMonthKeydown"
        >
          <button
            v-for="date in monthDays"
            :key="date"
            type="button"
            class="cal-month__cell"
            :data-date="date"
            :class="{
              'is-outside': !inMonth(date),
              'is-today': date === today,
              'is-focus': isFocus(date),
            }"
            :tabindex="isFocus(date) ? 0 : -1"
            :title="tooltipFor(date)"
            :aria-label="tooltipFor(date)"
            :aria-pressed="isFocus(date)"
            @click="clickDay(date)"
            @dblclick="newOnMonth(date)"
          >
            <span class="cal-month__day">{{ dayNumber(date) }}</span>
            <span
              class="cal-month__mark"
              :class="`is-${densityOf(date).state}`"
              aria-hidden="true"
            />
          </button>
        </div>
      </section>

      <section v-if="!editor" class="cal-tasks-pane">
        <header class="cal-tasks-pane__head">
          <span>
            {{ t('calendar.tasks') }}
            <span class="cal-tasks-pane__count">({{ taskDoneCount }}/{{ allTasks.length }})</span>
          </span>
        </header>
        <div class="cal-tasks-pane__tools">
          <input
            v-model="taskQuery"
            type="search"
            class="cal-tasks-pane__filter"
            :placeholder="t('calendar.filter.placeholder')"
            :aria-label="t('calendar.filter.placeholder')"
          />
          <button
            type="button"
            class="cal-tasks-pane__state"
            :title="t('calendar.filter.cycle')"
            @click="cycleTaskFilter"
          >
            {{ t(`calendar.filter.${taskFilter}`) }}
          </button>
        </div>
        <div class="cal-tasks-pane__scroll">
          <div v-if="visibleTasks.length === 0" class="cal-empty cal-empty--sm">
            {{ t('calendar.noTasks') }}
          </div>
          <section
            v-for="group in taskGroups"
            v-show="group.tasks.length"
            :key="group.key"
            class="cal-task-group"
          >
            <h4 class="cal-task-group__head">
              {{ taskGroupLabel(group) }}
              <span>{{ group.tasks.length }}</span>
            </h4>
            <button
              v-for="task in group.tasks"
              :key="`${task.path}:${task.line}`"
              type="button"
              class="cal-task-row"
              :class="{
                'is-done': task.done,
                'is-overdue': group.key === 'overdue' && !task.done,
              }"
              @click="jumpToTask(task)"
              @keydown="onTaskKeydown($event, task)"
            >
              <span
                class="cal-task-row__check"
                :class="{ 'is-done': task.done }"
                role="checkbox"
                :aria-checked="task.done"
                @click.stop="toggleTask(task)"
              />
              <span class="cal-task-row__title">{{ task.title }}</span>
              <span
                class="cal-task-row__bell"
                :class="{ 'is-on': task.reminders.length > 0 }"
                role="button"
                :title="task.reminders.length ? t('calendar.taskReminderRemove') : t('calendar.taskReminderAdd')"
                :aria-label="task.reminders.length ? t('calendar.taskReminderRemove') : t('calendar.taskReminderAdd')"
                @click.stop="toggleTaskReminder(task)"
              >⏰</span>
              <span v-if="task.due" class="cal-task-row__due">{{ task.due.slice(5) }}</span>
            </button>
          </section>
        </div>
        <!-- Honest scope: the scheduler is a desktop process loop, so a quit
             app cannot remind. Stated here, not only in code comments. -->
        <p class="cal-tasks-pane__hint">{{ t('calendar.reminders.hint') }}</p>
      </section>

      <section v-else class="cal-editor-host">
        <CalendarEditor
          :draft="editor"
          :saving="saving"
          :error="editorError"
          @save="saveEditor"
          @cancel="editor = null"
          @toggle-status="toggleCancelled"
          @open-note="openNote"
        />
      </section>
    </div>

    <div v-else class="cal-w__single">
      <header class="cal-bar">
        <span class="cal-bar__title">{{ mode === 'day' ? dayTitle : monthTitle }}</span>
        <div class="cal-nav">
          <button type="button" class="cal-nav__btn" :title="t('calendar.newEvent')" @click="newOnFocusDate">
            <Icons name="plus" :size="14" />
          </button>
          <button type="button" class="cal-nav__btn" :title="t('calendar.prev')" @click="shift(-1)">
            <Icons name="chevron-left" :size="14" />
          </button>
          <button type="button" class="cal-nav__btn" @click="calendar.goToday()">
            {{ t('calendar.today') }}
          </button>
          <button type="button" class="cal-nav__btn" :title="t('calendar.next')" @click="shift(1)">
            <Icons name="chevron-right" :size="14" />
          </button>
        </div>
      </header>

      <!-- Day -->
      <div v-if="mode === 'day'" class="cal-day">
        <div class="cal-day__allday">
          <span class="cal-day__allday-label">{{ t('calendar.allDay') }}</span>
          <button
            v-for="occ in dayData?.allDay ?? []"
            :key="`${occ.path}:${occ.start}`"
            type="button"
            class="cal-day__allday-chip"
            @click="clickOccurrence(occ)"
          >
            {{ occ.summary }}
            <span
              v-if="occurrenceWarning(occ)"
              class="cal-warn"
              :title="occurrenceWarning(occ)"
            >!</span>
          </button>
        </div>
        <div ref="dayGrid" class="cal-day__grid">
          <div
            v-for="hour in 24"
            :key="hour"
            class="cal-day__hour"
            @click="newOnHour(calendar.focusDate, hour - 1)"
          >
            <span class="cal-day__hour-label">{{ String(hour - 1).padStart(2, '0') }}:00</span>
          </div>
          <div
            v-for="(block, i) in dayData?.timed ?? []"
            :key="i"
            class="cal-day__block"
            :style="blockStyle(block, calendar.focusDate)"
            @pointerdown="beginDayDrag(block.occurrence, 'move', $event)"
            @click="clickOccurrence(block.occurrence)"
          >
            <span class="cal-day__block-title">
              {{ block.occurrence.summary }}
              <span
                v-if="occurrenceWarning(block.occurrence)"
                class="cal-warn"
                :title="occurrenceWarning(block.occurrence)"
              >!</span>
            </span>
            <span class="cal-day__block-time">
              {{ timeOf(block.occurrence.start) }}–{{ block.occurrence.end ? timeOf(block.occurrence.end) : '' }}
            </span>
            <span
              class="cal-day__resize"
              :title="t('calendar.editor.end')"
              @pointerdown.stop="beginDayDrag(block.occurrence, 'resize', $event)"
            />
          </div>
        </div>
      </div>

      <!-- Week -->
      <div v-else-if="mode === 'week'" class="cal-week">
        <div class="cal-week__head">
          <button
            v-for="date in weekDays"
            :key="date"
            type="button"
            class="cal-week__day-head"
            :class="{ 'is-today': date === today, 'is-focus': isFocus(date) }"
            @click="openDay(date)"
          >
            <span>{{ weekdayLabels[(new Date(wallDate(date)).getDay() + 6) % 7] }}</span>
            <span class="cal-week__day-num">{{ dayNumber(date) }}</span>
          </button>
        </div>
        <div class="cal-week__cols">
          <div
            v-for="day in weekData"
            :key="day.date"
            class="cal-week__col"
            :data-date="day.date"
            :class="{ 'is-today': day.date === today }"
          >
            <button
              v-for="occ in eventsOf(day)"
              :key="`${occ.path}:${occ.start}`"
              type="button"
              class="cal-week__chip"
              :class="{ 'is-allday': occ.allDay }"
              @pointerdown="beginWeekDrag(occ, $event)"
              @click="clickOccurrence(occ)"
            >
              <span class="cal-week__chip-time">{{ chipTime(occ) }}</span>
              <span class="cal-week__chip-title">
                {{ occ.summary }}
                <span
                  v-if="occurrenceWarning(occ)"
                  class="cal-warn"
                  :title="occurrenceWarning(occ)"
                >!</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Agenda fallback on very narrow widths -->
      <div v-else class="cal-agenda">
        <div v-if="agendaGroups.length === 0" class="cal-empty">{{ t('calendar.empty') }}</div>
        <section v-for="day in agendaGroups" :key="day.date" class="cal-agenda__day">
          <h4 :class="{ 'is-today': day.date === today }">{{ day.date }}</h4>
          <button
            v-for="occ in [...day.allDay, ...day.timed.map((b) => b.occurrence)]"
            :key="`${occ.path}:${occ.start}`"
            type="button"
            class="cal-agenda__row"
            @click="clickOccurrence(occ)"
          >
            <span class="cal-agenda__time">{{ chipTime(occ) }}</span>
            <span>
              {{ occ.summary }}
              <span
                v-if="occurrenceWarning(occ)"
                class="cal-warn"
                :title="occurrenceWarning(occ)"
              >!</span>
            </span>
          </button>
          <button
            v-for="task in day.tasks"
            :key="`${task.path}:${task.line}`"
            type="button"
            class="cal-agenda__row cal-agenda__row--task"
            @click="jumpToTask(task)"
          >
            <span class="cal-agenda__time">{{ t('calendar.tasks') }}</span>
            <span>{{ task.title }}</span>
          </button>
        </section>
      </div>

      <div v-if="editor" class="cal-editor-float">
        <CalendarEditor
          :draft="editor"
          :saving="saving"
          :error="editorError"
          @save="saveEditor"
          @cancel="editor = null"
          @toggle-status="toggleCancelled"
          @open-note="openNote"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal-w {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text);
  font-size: 13px;
}

.cal-empty {
  padding: 32px 16px;
  color: var(--text-3);
  text-align: center;
}

.cal-empty--sm {
  padding: 16px;
  font-size: 12px;
}

/* Month split: fixed month column + flexible task column. */
.cal-w__split {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* Narrow (<720): month on top, tasks below, both full width. */
.cal-w.is-narrow .cal-w__split {
  flex-direction: column;
}

.cal-w.is-narrow .cal-month {
  width: auto;
  max-height: 50%;
  overflow-y: auto;
  border-right: 0;
  border-bottom: var(--bd-hair);
}

.cal-w.is-narrow .cal-editor-host {
  border-left: 0;
}

.cal-month {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 360px;
  min-width: 0;
  padding: 12px 14px;
  border-right: var(--bd-hair);
}

.cal-month__head,
.cal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
}

.cal-month__title,
.cal-bar__title {
  font-size: 13px;
  font-weight: 600;
}

.cal-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cal-nav__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-nav__btn:hover {
  background: var(--fill-1);
  color: var(--text);
}

.cal-month__weekdays,
.cal-month__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.cal-month__weekdays {
  padding-bottom: 4px;
  color: var(--text-3);
  font-size: 11px;
  text-align: center;
}

.cal-month__grid {
  flex: 1;
  min-height: 0;
  grid-auto-rows: minmax(40px, 1fr);
}

.cal-month__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-month__cell:hover {
  background: var(--fill-1);
}

.cal-month__cell.is-outside {
  color: var(--text-3);
}

.cal-month__cell.is-today .cal-month__day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
}

.cal-month__cell.is-focus {
  border-color: var(--accent);
}

.cal-month__mark {
  box-sizing: border-box;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.cal-month__mark.is-none {
  visibility: hidden;
}

.cal-month__mark.is-note {
  background: var(--text-3);
}

.cal-month__mark.is-done {
  background: var(--success, #2f9e63);
}

/* Hollow ring: unfinished tasks are the one thing that must draw the eye. */
.cal-month__mark.is-open {
  background: transparent;
  border: 1.5px solid var(--accent);
}

.cal-month__cell.is-outside .cal-month__mark {
  opacity: 0.55;
}

/* Task column */
.cal-tasks-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.cal-tasks-pane__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  font-size: 12px;
  font-weight: 600;
}

.cal-tasks-pane__count {
  color: var(--text-3);
  font-weight: 400;
}

.cal-tasks-pane__tools {
  display: flex;
  gap: 6px;
  padding: 0 12px 8px;
}

.cal-tasks-pane__filter {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--bg-input, var(--fill-1));
  color: var(--text);
  font: inherit;
  font-size: 12px;
}

.cal-tasks-pane__state {
  flex: none;
  height: 26px;
  padding: 0 8px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--fill-1);
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-tasks-pane__state:hover {
  color: var(--text);
}

.cal-tasks-pane__scroll {
  flex: 1;
  min-height: 0;
  padding: 0 8px 12px;
  overflow-y: auto;
}

.cal-tasks-pane__hint {
  margin: 0;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-3);
}

.cal-task-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 2px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--bg-pop);
}

.cal-task-group__head span {
  color: var(--text-3);
  font-weight: 400;
}

.cal-task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.cal-task-row:hover {
  background: var(--fill-1);
}

.cal-task-row__check {
  flex: none;
  width: 13px;
  height: 13px;
  border: 1px solid var(--line-2, var(--text-3));
  border-radius: 3px;
}

.cal-task-row__check.is-done {
  background: var(--accent);
  border-color: var(--accent);
}

.cal-task-row__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-task-row.is-done .cal-task-row__title {
  color: var(--text-3);
  text-decoration: line-through;
}

.cal-task-row.is-overdue .cal-task-row__due {
  color: var(--danger, #d33);
}

.cal-task-row__due {
  flex: none;
  color: var(--text-3);
  font-size: 11px;
}

.cal-task-row__bell {
  flex: none;
  font-size: 11px;
  line-height: 1;
  opacity: 0.25;
  cursor: pointer;
}

.cal-task-row__bell:hover,
.cal-task-row__bell.is-on {
  opacity: 1;
}

/* Day/week single-column layout */
.cal-w__single {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px 14px;
}

.cal-day {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.cal-day__allday {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding-bottom: 6px;
  border-bottom: var(--bd-hair);
}

.cal-day__allday-label {
  flex: none;
  color: var(--text-3);
  font-size: 11px;
}

.cal-day__allday-chip {
  padding: 2px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--fill-1);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-day__grid {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.cal-day__hour {
  position: relative;
  flex: 1;
  min-height: 0;
  border-bottom: 1px solid var(--line-1, rgba(0, 0, 0, 0.06));
  cursor: pointer;
}

.cal-day__hour:hover {
  background: var(--fill-1);
}

.cal-day__hour-label {
  position: absolute;
  top: -6px;
  left: 0;
  color: var(--text-3);
  font-size: 10px;
  pointer-events: none;
}

.cal-day__block {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  overflow: hidden;
  cursor: grab;
}

.cal-day__block-title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-day__block-time {
  font-size: 10px;
  opacity: 0.85;
}

.cal-day__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 6px;
  cursor: ns-resize;
}

.cal-week {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.cal-week__head,
.cal-week__cols {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.cal-week__day-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.cal-week__day-head:hover {
  background: var(--fill-1);
}

.cal-week__day-head.is-today {
  color: var(--accent);
}

.cal-week__day-head.is-focus {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.cal-week__day-num {
  font-size: 12px;
  font-weight: 600;
}

.cal-week__cols {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.cal-week__col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  padding: 4px 2px;
  border-radius: 4px;
}

.cal-week__col.is-today {
  background: var(--fill-1);
}

.cal-week__chip {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 4px;
  border: 0;
  border-left: 2px solid var(--accent);
  border-radius: 3px;
  background: var(--fill-1);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  text-align: left;
  overflow: hidden;
  cursor: grab;
}

.cal-week__chip.is-allday {
  background: var(--accent);
  color: #fff;
  border-left-color: transparent;
}

.cal-week__chip-time {
  opacity: 0.8;
  font-size: 10px;
}

.cal-week__chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-agenda {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.cal-agenda__day h4 {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.cal-agenda__day h4.is-today {
  color: var(--accent);
}

.cal-agenda__row {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.cal-agenda__row:hover {
  background: var(--fill-1);
}

.cal-agenda__row--task {
  color: var(--text-2);
}

.cal-agenda__time {
  flex: none;
  width: 52px;
  color: var(--text-3);
  font-size: 11px;
}

.cal-warn {
  margin-left: 3px;
  font-weight: 700;
  color: var(--warning, #b7791f);
}

.cal-editor-host {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-left: var(--bd-hair);
}

.cal-editor-float {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: var(--bg-pop);
}
</style>
