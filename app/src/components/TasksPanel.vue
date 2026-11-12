<script setup lang="ts">
/**
 * Tasks sidebar panel — every `- [ ]` in the workspace, in one list.
 *
 * Notes accumulate to-dos in the file they belong to, which is the right place
 * to write them and the wrong place to find them: answering "what is open?"
 * meant opening every note. This reads the workspace index (which already
 * tracks task lines and is kept live by the file watcher), so the list is
 * current without a scan and without a second source of truth.
 *
 * Ticking a box here rewrites the checkbox in the note. Clicking the row opens
 * the note at that line — the panel is a way in, not a replacement inbox: the
 * task's context is the paragraph it sits in, and this list can't show that.
 */
import { computed, ref } from 'vue';
import { useTasks, type WorkspaceTask } from '../composables/useTasks';
import { useFiles } from '../composables/useFiles';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useTilesStore } from '../stores/tiles';
import { useSettingsStore } from '../stores/settings';
import { useCalendarStore } from '../stores/calendar';
import { useI18n } from '../i18n';
import { addDays } from '../lib/calendar';
import Icons from './Icons.vue';
import { lunarDateLabel } from '../lib/lunar';
import { isoWeek } from '../lib/iso-week';
import { isOverdue, localDateKey, type TaskPriority } from '../lib/tasks';
import { PERIOD_KINDS, shiftPeriod, type PeriodKind } from '../lib/periodic-notes';
import { periodWindow, tasksInWindow } from '../lib/period-window';

const { tasks, toggle } = useTasks();
const files = useFiles();
const idx = useWorkspaceIndexStore();
const tiles = useTilesStore();
const settings = useSettingsStore();
const calendar = useCalendarStore();
const { t } = useI18n();

type Filter = 'open' | 'today' | 'all';
const filter = ref<Filter>('open');
const priorityOnly = ref(false);

/**
 * P6 — the period window (spec §5.5) is a filter, not a roll-up: it lists the
 * unfinished lines dated inside one periodic note's range and writes nothing
 * into that note. `windowDate` is any day in the period; the window itself is
 * always recomputed from the anchor, so paging from mid-week stays on weeks.
 */
const windowOn = ref(false);
const windowKind = ref<PeriodKind>('weekly');
const windowDate = ref(new Date());
const activeWindow = computed(() => periodWindow(windowKind.value, windowDate.value, settings.weekStartsOn));
const windowRange = computed(() =>
  activeWindow.value.start === activeWindow.value.end
    ? activeWindow.value.start
    : `${activeWindow.value.start} – ${activeWindow.value.end}`,
);

function stepWindow(delta: number) {
  windowDate.value = shiftPeriod(windowKind.value, activeWindow.value.anchor, delta);
}

function setFilter(event: Event) {
  filter.value = (event.target as HTMLSelectElement).value as Filter;
}

/** Period dropdown: "off" clears the period window; any other value turns it on
 *  and switches the kind (resetting the anchor to today) — without touching the
 *  open/today/all view or the priority filter, so only the list changes. */
function setPeriod(event: Event) {
  const v = (event.target as HTMLSelectElement).value;
  if (v === 'off') {
    windowOn.value = false;
    return;
  }
  windowOn.value = true;
  const k = v as PeriodKind;
  if (k !== windowKind.value) {
    windowKind.value = k;
    windowDate.value = new Date();
  }
}

/** Recomputed per render rather than cached: the panel can be open across
 *  midnight, and a stale "today" is how a task silently stops being overdue. */
const today = computed(() => localDateKey(new Date()));

/** Range the panel follows when "link to calendar" is on: a single day, or the
 *  whole selected week. Null when the link is off (falls through to the
 *  ordinary filters below). */
const linkedRange = computed<{ start: string; end: string } | null>(() => {
  if (!settings.tasksLinkCalendar) return null;
  const wk = calendar.selectedWeekStart;
  if (wk) return { start: wk, end: addDays(wk, 6) };
  return { start: calendar.focusDate, end: calendar.focusDate };
});

/** The calendar link is an *extra* AND condition layered on top of whatever the
 *  ordinary filters already chose — it never replaces them (per design: the
 *  link must not disturb the filters below). So we build the base list from
 *  open/today/all or the period window, apply priority, then narrow by the
 *  calendar's selected day/week when the link is on. */
const visible = computed<WorkspaceTask[]>(() => {
  let list: WorkspaceTask[];
  if (windowOn.value) list = tasksInWindow(tasks.value, activeWindow.value);
  else {
    list = tasks.value;
    if (filter.value === 'open') list = list.filter((x) => !x.done);
    else if (filter.value === 'today') {
      list = list.filter(
        (x) => !x.done && x.meta.due !== null && x.meta.due <= today.value,
      );
    }
  }
  if (priorityOnly.value) list = list.filter((x) => x.meta.priority !== null);
  const range = linkedRange.value;
  if (range) {
    list = list.filter(
      (x) => x.meta.due !== null && x.meta.due >= range.start && x.meta.due <= range.end,
    );
  }
  return list;
});

/** Grouped by file so a row's origin is obvious without repeating the file
 *  name on every line. */
const groups = computed(() => {
  const byFile = new Map<string, { fileName: string; items: WorkspaceTask[] }>();
  for (const task of visible.value) {
    const g = byFile.get(task.path) ?? { fileName: task.fileName, items: [] };
    g.items.push(task);
    byFile.set(task.path, g);
  }
  return [...byFile.entries()].map(([path, g]) => ({ path, ...g }));
});

const openCount = computed(() => tasks.value.filter((x) => !x.done).length);
const total = computed(() => tasks.value.length);
/** Header date readout: two lines for a selected day (bold `12日周五` over the
 *  lunar day), or one bold line for a selected week (`第47周`). */
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const dateInfo = computed(() => {
  const wk = calendar.selectedWeekStart;
  if (wk) {
    return { kind: 'week' as const, main: t('tasks.week', { week: isoWeek(wk).week }), sub: '' };
  }
  const d = calendar.focusDate;
  const [y, m, day] = d.split('-').map(Number);
  const wd = WEEKDAY_CN[new Date(y, m - 1, day).getDay()];
  return { kind: 'day' as const, main: `${day}日周${wd}`, sub: lunarDateLabel(d) ?? '' };
});

/** Per-row expand state for the two-line title clamp. Click toggles; double
 *  click on the row opens the note (see template). */
const expanded = ref<Record<string, boolean>>({});
function isExpanded(key: string): boolean {
  return !!expanded.value[key];
}
function toggleExpand(key: string) {
  expanded.value = { ...expanded.value, [key]: !expanded.value[key] };
}

const hasFolder = computed(() => idx.folder !== null);

function overdue(task: WorkspaceTask): boolean {
  return !task.done && isOverdue(task.meta.due, today.value);
}

function keyOf(task: WorkspaceTask): string {
  return `${task.path}:${task.line}`;
}

/** Obsidian Tasks priority glyphs (docs/specs … priority row): 🔺 ⏫ 🔼 🔽 ⏬. */
const PRIORITY_ICON: Record<Exclude<TaskPriority, null>, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
};
function priorityIcon(p: TaskPriority): string | null {
  return p ? PRIORITY_ICON[p] : null;
}

/** Single click expands/collapses the two-line clamp; double click opens the
 *  note. A short timer keeps a double click from also toggling the row. */
let clickTimer: ReturnType<typeof setTimeout> | null = null;
function onRowClick(key: string) {
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    toggleExpand(key);
  }, 200);
}
function onRowDblClick(task: WorkspaceTask) {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  openTask(task);
}

async function openTask(task: WorkspaceTask) {
  await files.openPath(task.path, { bypassNewWindow: true });
  // The editor needs a tick to mount the new document before a line jump can
  // land; the outline panel's jump has the same shape.
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('solomd:outline-goto', {
        detail: { line: task.line, paneId: tiles.focusedPaneId },
      }),
    );
  }, 120);
}
</script>

<template>
  <div class="tasks-panel rp">
    <div class="rp-head tasks-panel__head">
      <div class="tasks-panel__date">
        <div class="tasks-panel__date-main">{{ dateInfo.main }}</div>
        <div v-if="dateInfo.kind === 'day'" class="tasks-panel__date-sub">{{ dateInfo.sub }}</div>
      </div>
      <span class="tasks-panel__count">{{ t('tasks.count', { done: openCount, total: total }) }}</span>
      <button
        class="rp-icon-btn tasks-panel__flag"
        :class="{ 'is-on': settings.tasksLinkCalendar }"
        type="button"
        :title="t('tasks.linkCalendar')"
        :aria-label="t('tasks.linkCalendar')"
        :aria-pressed="settings.tasksLinkCalendar"
        @click="settings.toggleTasksLinkCalendar()"
      >
        <Icons name="link" :size="14" />
      </button>
    </div>

    <div class="tasks-panel__filters">
      <select
        class="tasks-panel__select"
        :value="filter"
        :aria-label="t('tasks.view')"
        @change="setFilter"
      >
        <option v-for="f in (['open', 'today', 'all'] as Filter[])" :key="f" :value="f">
          {{ t(`tasks.filter.${f}`) }}
        </option>
      </select>
      <select
        class="tasks-panel__select"
        :value="windowOn ? windowKind : 'off'"
        :aria-label="t('tasks.period.toggle')"
        @change="setPeriod"
      >
        <option value="off">{{ t('tasks.period.off') }}</option>
        <option v-for="kind in PERIOD_KINDS" :key="kind" :value="kind">
          {{ t(`tasks.period.${kind}`) }}
        </option>
      </select>
      <button
        v-if="windowOn"
        class="tasks-panel__step"
        type="button"
        :title="t('tasks.period.prev')"
        :aria-label="t('tasks.period.prev')"
        @click="stepWindow(-1)"
      >
        <Icons name="chevron-left" :size="14" />
      </button>
      <button
        v-if="windowOn"
        class="tasks-panel__step"
        type="button"
        :title="t('tasks.period.next')"
        :aria-label="t('tasks.period.next')"
        @click="stepWindow(1)"
      >
        <Icons name="chevron-right" :size="14" />
      </button>
      <button
        class="rp-icon-btn tasks-panel__flag"
        :class="{ 'is-on': priorityOnly }"
        type="button"
        :title="t('tasks.priorityOnly')"
        :aria-label="t('tasks.priorityOnly')"
        :aria-pressed="priorityOnly"
        @click="priorityOnly = !priorityOnly"
      >
        <span class="tasks-panel__bars tasks-panel__bars--high" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </div>
    <div v-if="windowOn" class="tasks-panel__range" :title="t('tasks.period.note')">
      {{ windowRange }}
    </div>

    <div v-if="!hasFolder" class="rp-empty">{{ t('tasks.openFolder') }}</div>
    <div v-else-if="groups.length === 0" class="rp-empty">
      {{ windowOn ? t('tasks.period.empty') : t('tasks.empty') }}
    </div>

    <div v-else class="rp-body tasks-panel__list">
      <section v-for="group in groups" :key="group.path" class="tasks-panel__group">
        <h4 class="rp-section tasks-panel__file">
          <Icons name="file" :size="12" />
          <span class="rp-row__label">{{ group.fileName }}</span>
        </h4>
        <ul class="rp-list">
          <li
            v-for="task in group.items"
            :key="keyOf(task)"
            class="rp-row tasks-panel__item"
            :class="{ 'tasks-panel__item--done': task.done, 'is-expanded': isExpanded(keyOf(task)) }"
            @click="onRowClick(keyOf(task))"
            @dblclick="onRowDblClick(task)"
          >
            <input
              v-if="!windowOn"
              type="checkbox"
              class="rp-check tasks-panel__check"
              :checked="task.done"
              :aria-label="task.meta.title"
              @click.stop="toggle(task)"
            />
            <span v-else class="tasks-panel__mark" aria-hidden="true">•</span>
            <div class="tasks-panel__text-wrap">
              <span class="tasks-panel__text" :class="{ 'is-clamped': !isExpanded(keyOf(task)) }">{{ task.meta.title }}</span>
              <div class="tasks-panel__meta-row">
                <span
                  v-if="priorityIcon(task.meta.priority)"
                  class="tasks-panel__priority"
                  :title="task.meta.priority"
                >{{ priorityIcon(task.meta.priority) }}</span>
                <span
                  v-if="task.meta.due"
                  class="tasks-panel__due"
                  :class="{ 'tasks-panel__due--overdue': overdue(task) }"
                >{{ task.meta.due }}</span>
                <span
                  v-if="task.meta.recurrence && task.meta.recurrence.kind !== 'natural'"
                  class="tasks-panel__recur"
                  :class="`tasks-panel__recur--${task.meta.recurrence.kind}`"
                  :title="
                    task.meta.recurrence.kind === 'legacy'
                      ? t('tasks.recurrenceLegacy')
                      : t('tasks.recurrenceUnsupported')
                  "
                >🔁</span>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tasks-panel__filters {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 8px 12px;
}
.tasks-panel__select {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
}
.tasks-panel__step {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.tasks-panel__step:hover {
  background: var(--fill-1);
  color: var(--text-1);
}
.tasks-panel__select:hover {
  border-color: var(--line-3);
}
.tasks-panel__range {
  flex: 0 0 auto;
  padding: 0 12px 8px;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
/* Stands in for the checkbox in window mode: the window is read-only, rows
   are links into the note where the line actually lives. */
.tasks-panel__mark {
  flex: 0 0 auto;
  width: 13px;
  margin-right: 6px;
  color: var(--text-3);
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
}
.tasks-panel__flag {
  width: 28px;
  height: 28px;
}
.tasks-panel__group + .tasks-panel__group {
  margin-top: 6px;
}
.tasks-panel__file {
  margin: 0;
  min-width: 0;
  letter-spacing: 0;
  font-weight: 500;
  font-size: 12px;
}
.tasks-panel__item {
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
  min-height: 28px;
  line-height: 1.35;
}
.tasks-panel__check {
  margin-top: 2px;
}
/* Override the global .rp-head's locked `height:36px; flex:0 0 36px` so the
   top/bottom padding below actually grows the header instead of being clipped
   by the fixed height. Left/right padding kept at 12px to match other panels. */
.tasks-panel__head {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  min-height: 36px;
  height: auto;
  flex: 0 0 auto;
  padding: 6px 12px 8px;
}
.tasks-panel__date {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.tasks-panel__date-main {
  font-weight: 600;
  font-size: 15px;
}
.tasks-panel__date-sub {
  font-size: 12px;
  color: var(--text-3);
}
.tasks-panel__count {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.tasks-panel__head .tasks-panel__flag {
  margin-left: auto;
}
.tasks-panel__text-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tasks-panel__text {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* Two-line clamp by default; a row click toggles `is-expanded` to show the
   whole title. */
.tasks-panel__text.is-clamped {
  -webkit-line-clamp: 2;
}
.tasks-panel__item--done .tasks-panel__text {
  text-decoration: line-through;
  color: var(--text-3);
}
.tasks-panel__meta-row {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tasks-panel__priority {
  font-size: 12px;
  line-height: 1;
}
/* Priority glyph and due date share one bottom row so neither crowds a long
   title. */
.tasks-panel__due {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.tasks-panel__due--overdue {
  color: var(--danger);
  font-weight: 500;
}
/* A recurrence this app only reads, not expands: same glyph as the line,
   muted, with the explanation in the tooltip. */
.tasks-panel__recur {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.55;
  cursor: help;
}
.tasks-panel__recur--unsupported {
  opacity: 0.35;
}
/* Priority: three ascending bars, filled by level (no emoji). */
.tasks-panel__bars {
  flex-shrink: 0;
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  height: 11px;
  margin-top: 3px;
}
.tasks-panel__bars i {
  display: block;
  width: 2.5px;
  border-radius: 1px;
  background: var(--fill-2);
}
.tasks-panel__bars i:nth-child(1) { height: 5px; }
.tasks-panel__bars i:nth-child(2) { height: 8px; }
.tasks-panel__bars i:nth-child(3) { height: 11px; }
/* Five parsed levels collapse onto the three bars: highest reads like high,
   lowest like low. The distinction still shows in sorting. */
.tasks-panel__bars--lowest i:nth-child(1),
.tasks-panel__bars--low i:nth-child(1),
.tasks-panel__bars--medium i:nth-child(-n + 2),
.tasks-panel__bars--high i,
.tasks-panel__bars--highest i {
  background: var(--accent);
}
.tasks-panel__flag .tasks-panel__bars {
  margin-top: 0;
}
.tasks-panel__flag:not(.is-on) .tasks-panel__bars i {
  background: currentColor;
  opacity: 0.55;
}
</style>
