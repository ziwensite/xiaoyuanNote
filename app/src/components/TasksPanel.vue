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
import { useCalendarStore } from '../stores/calendar';
import { useI18n } from '../i18n';
import Icons from './Icons.vue';
import { lunarDateLabel } from '../lib/lunar';
import { isoWeek } from '../lib/iso-week';
import { isOverdue } from '../lib/tasks';
import { priorityIcon } from '../lib/task-display';
import { useTaskFilter } from '../composables/useTaskFilter';
import TaskFilterBar from './tasks/TaskFilterBar.vue';

const { tasks, toggle } = useTasks();
const files = useFiles();
const idx = useWorkspaceIndexStore();
const tiles = useTilesStore();
const calendar = useCalendarStore();
const { t } = useI18n();
const { windowOn, today, filter: filterTasks, count } = useTaskFilter();

/** Adapt the index projection to the shared filter's shape. `...t` keeps
 *  path / line / meta / fileName, so a row can still write through useTasks()
 *  without a second lookup. */
const filterItems = computed(() =>
  tasks.value.map((t) => ({
    ...t,
    title: t.meta.title,
    due: t.meta.due,
    priority: t.meta.priority,
  })),
);
type Row = (typeof filterItems.value)[number];
const visible = computed(() => filterTasks(filterItems.value));
const tally = computed(() => count(filterItems.value));

/** Grouped by file so a row's origin is obvious without repeating the file
 *  name on every line. */
const groups = computed(() => {
  const byFile = new Map<string, { fileName: string; items: Row[] }>();
  for (const task of visible.value) {
    const g = byFile.get(task.path) ?? { fileName: task.fileName, items: [] };
    g.items.push(task);
    byFile.set(task.path, g);
  }
  return [...byFile.entries()].map(([path, g]) => ({ path, ...g }));
});
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
      <span class="tasks-panel__count">{{ t('tasks.count', { done: tally.open, total: tally.total }) }}</span>
    </div>

    <TaskFilterBar />

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
                  v-if="task.meta.due"
                  class="tasks-panel__due"
                  :class="{ 'tasks-panel__due--overdue': overdue(task) }"
                >{{ task.meta.due }}</span>
                <span
                  v-if="priorityIcon(task.meta.priority)"
                  class="tasks-panel__priority"
                  :title="task.meta.priority"
                >{{ priorityIcon(task.meta.priority) }}</span>
                <span
                  v-if="task.meta.reminders?.length"
                  class="tasks-panel__reminder"
                  :title="task.meta.reminders.join(', ')"
                >⏰</span>
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
/* The filter row, its controls and the period pager live in the shared
   TaskFilterBar.vue — this file only styles the list itself. */
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
  margin-left: auto;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
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
/* Third-row badges — due date, importance, reminder, recurrence — are the
   same fields the main calendar view shows, just stacked instead of inline. */
.tasks-panel__reminder {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.75;
  cursor: help;
}
</style>
