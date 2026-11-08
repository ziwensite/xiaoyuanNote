<script setup lang="ts">
/**
 * M1 — read-only calendar pane.
 *
 * Everything is derived from the in-memory workspace index: no scanning, no
 * watchers, no timers. The pane is registered as an async component, so a
 * closed calendar costs nothing. Editing (composer, drag, checkboxes) is M2;
 * the checkbox here is decoration, not a control.
 *
 * Width drives the view: the dock's default content width is ~260 px, so the
 * agenda is the only sensible default; day/week/month can be requested only
 * once the pane is wide enough (see `lib/calendar-view.ts` thresholds).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useFiles } from '../composables/useFiles';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useTilesStore } from '../stores/tiles';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import PanelHeader from './panel/PanelHeader.vue';
import SegControl from './panel/SegControl.vue';
import { addDays, localDateKey, type CalendarEntry, type CalendarOccurrence, type CalendarTask } from '../lib/calendar';
import {
  buildAgendaGroups,
  buildCalendarView,
  isCalendarTaskOverdue,
  monthGridRange,
  resolveCalendarViewMode,
  supportsCalendarView,
  weekRange,
  type AgendaGroup,
  type CalendarViewMode,
} from '../lib/calendar-view';

const files = useFiles();
const idx = useWorkspaceIndexStore();
const tiles = useTilesStore();
const { t, lang } = useI18n();

const emit = defineEmits<{ (e: 'close'): void }>();

const root = ref<HTMLElement | null>(null);
const width = ref(0);
const requestedView = ref<CalendarViewMode>('agenda');
const cursor = ref(localDateKey(new Date()));

const VIEWS: CalendarViewMode[] = ['agenda', 'day', 'week', 'month'];

const effectiveView = computed(() => resolveCalendarViewMode(requestedView.value, width.value));
const viewOptions = computed(() =>
  VIEWS.filter((view) => supportsCalendarView(view, width.value)).map((view) => ({
    value: view,
    label: t(`calendar.view.${view}`),
  })),
);

// A pane that is resized below the threshold must not leave a segment selected
// that no longer has a button.
watch(effectiveView, (view) => {
  if (requestedView.value !== view) requestedView.value = view;
});

const today = computed(() => localDateKey(new Date()));
const hasFolder = computed(() => idx.folder !== null);

const range = computed(() => {
  switch (effectiveView.value) {
    case 'day':
      return { from: cursor.value, to: addDays(cursor.value, 1) };
    case 'week': {
      const days = weekRange(cursor.value);
      return { from: days[0], to: addDays(days[6], 1) };
    }
    case 'month': {
      const days = monthGridRange(cursor.value);
      return { from: days[0], to: addDays(days[41], 1) };
    }
    default:
      return { from: addDays(cursor.value, -7), to: addDays(cursor.value, 32) };
  }
});

const viewData = computed(() =>
  buildCalendarView(idx.entries as CalendarEntry[], range.value),
);
const agenda = computed(() => buildAgendaGroups(viewData.value, today.value));
const dayData = computed(
  () => viewData.value.days.find((day) => day.date === cursor.value) ?? viewData.value.days[0],
);

const hasAnyInWindow = computed(() =>
  viewData.value.days.some(
    (day) => day.allDay.length > 0 || day.timed.length > 0 || day.tasks.length > 0,
  ),
);
const showEmpty = computed(() =>
  effectiveView.value === 'agenda' ? agenda.value.length === 0 : !hasAnyInWindow.value,
);

const dayFmt = computed(
  () =>
    new Intl.DateTimeFormat(htmlLangFor(lang.value), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
);
const weekdayFmt = computed(
  () => new Intl.DateTimeFormat(htmlLangFor(lang.value), { weekday: 'short' }),
);
const monthFmt = computed(
  () => new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric', month: 'long' }),
);

const monthTitle = computed(() => monthFmt.value.format(wallDate(cursor.value)));

function wallDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDay(date: string): string {
  return dayFmt.value.format(wallDate(date));
}

function weekdayLabel(date: string): string {
  return weekdayFmt.value.format(wallDate(date));
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

function isToday(date: string): boolean {
  return date === today.value;
}

function inMonth(date: string): boolean {
  return date.slice(0, 7) === cursor.value.slice(0, 7);
}

function timeLabel(occ: CalendarOccurrence): string {
  if (occ.allDay) return t('calendar.allDay');
  return occ.start.slice(11, 16) || t('calendar.allDay');
}

function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function shift(delta: number) {
  switch (effectiveView.value) {
    case 'day':
      cursor.value = addDays(cursor.value, delta);
      break;
    case 'week':
      cursor.value = addDays(cursor.value, delta * 7);
      break;
    case 'month':
      cursor.value = shiftMonth(cursor.value, delta);
      break;
    default:
      cursor.value = addDays(cursor.value, delta * 7);
  }
}

function goToday() {
  cursor.value = today.value;
}

function focusDay(date: string) {
  cursor.value = date;
  requestedView.value = 'agenda';
}

function openDay(date: string) {
  cursor.value = date;
  requestedView.value = 'day';
}

async function openEvent(path: string) {
  await files.openPath(path, { bypassNewWindow: true });
}

async function openTask(task: CalendarTask) {
  await files.openPath(task.path, { bypassNewWindow: true });
  // Same 120 ms tick the outline jump uses: the editor must mount the
  // document before a line jump can land.
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('solomd:outline-goto', {
        detail: { line: task.line, paneId: tiles.focusedPaneId },
      }),
    );
  }, 120);
}

function taskOverdue(task: CalendarTask): boolean {
  return isCalendarTaskOverdue(task, today.value);
}

function groupLabel(group: AgendaGroup): string {
  return group.key === 'undated' ? t('calendar.undated') : t(`calendar.groups.${group.key}`);
}

interface CellItem {
  key: string;
  kind: 'event' | 'task';
  label: string;
  time?: string;
  path?: string;
  task?: CalendarTask;
}

function cellItems(day: {
  date: string;
  allDay: CalendarOccurrence[];
  timed: { occurrence: CalendarOccurrence }[];
  tasks: CalendarTask[];
}): CellItem[] {
  const events: CellItem[] = [
    ...day.allDay.map((occ, i) => ({
      key: `a:${occ.eventUid}:${occ.start}:${i}`,
      kind: 'event' as const,
      label: occ.summary,
      time: t('calendar.allDay'),
      path: occ.path,
    })),
    ...day.timed.map((block, i) => ({
      key: `t:${block.occurrence.eventUid}:${block.occurrence.start}:${i}`,
      kind: 'event' as const,
      label: block.occurrence.summary,
      time: timeLabel(block.occurrence),
      path: block.occurrence.path,
    })),
  ];
  const tasks: CellItem[] = day.tasks.map((task, i) => ({
    key: `k:${task.path}:${task.line}:${i}`,
    kind: 'task' as const,
    label: task.title,
    task,
  }));
  return [...events, ...tasks];
}

function cellCount(day: Parameters<typeof cellItems>[0]): number {
  return cellItems(day).length;
}

function blockStyle(block: {
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
}): Record<string, string> {
  const top = (block.startMinutes / 1440) * 100;
  const height = ((block.endMinutes - block.startMinutes) / 1440) * 100;
  return {
    top: `${top}%`,
    height: `max(16px, ${height}%)`,
    left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
    width: `calc(${100 / block.columns}% - 4px)`,
  };
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
});
</script>

<template>
  <div ref="root" class="calendar-panel rp">
    <PanelHeader @close="emit('close')">
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.prev')"
        :aria-label="t('calendar.prev')"
        @click="shift(-1)"
      >
        <Icons name="chevron-left" :size="14" />
      </button>
      <button class="rp-btn rp-btn--sm calendar-panel__today" type="button" @click="goToday">
        {{ t('calendar.today') }}
      </button>
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.next')"
        :aria-label="t('calendar.next')"
        @click="shift(1)"
      >
        <Icons name="chevron-right" :size="14" />
      </button>
    </PanelHeader>

    <div class="calendar-panel__toolbar">
      <SegControl
        v-model="requestedView"
        class="calendar-panel__seg"
        :aria-label="t('calendar.view.agenda')"
        :options="viewOptions"
      />
    </div>

    <div v-if="!hasFolder" class="rp-empty">{{ t('calendar.openFolder') }}</div>
    <div v-else-if="showEmpty" class="rp-empty">{{ t('calendar.empty') }}</div>

    <!-- Agenda -->
    <div v-else-if="effectiveView === 'agenda'" class="rp-body calendar-panel__agenda">
      <section v-for="group in agenda" :key="group.key" class="calendar-panel__group">
        <h4 class="rp-section">{{ groupLabel(group) }}</h4>

        <div v-for="day in group.days" :key="day.date" class="calendar-panel__dayblock">
          <div class="calendar-panel__date" :class="{ 'is-today': isToday(day.date) }">
            {{ formatDay(day.date) }}
          </div>
          <ul class="rp-list">
            <li
              v-for="task in day.tasks"
              :key="`${task.path}:${task.line}`"
              class="rp-row calendar-panel__row calendar-panel__row--task"
              :class="{ 'is-done': task.done }"
              @click="openTask(task)"
            >
              <span
                class="rp-check calendar-panel__check"
                :class="{ 'is-done': task.done }"
                aria-hidden="true"
              />
              <span class="calendar-panel__label">{{ task.title }}</span>
              <span
                v-if="task.due"
                class="calendar-panel__due"
                :class="{ 'calendar-panel__due--overdue': taskOverdue(task) }"
              >{{ task.due }}</span>
            </li>

            <li
              v-for="occ in day.occurrences"
              :key="`${occ.eventUid}:${occ.start}:${occ.path}`"
              class="rp-row calendar-panel__row calendar-panel__row--event"
              :class="{ 'is-cancelled': occ.source.status === 'CANCELLED' }"
              @click="openEvent(occ.path)"
            >
              <span class="calendar-panel__bar" aria-hidden="true" />
              <span class="calendar-panel__time">{{ timeLabel(occ) }}</span>
              <span class="calendar-panel__label">{{ occ.summary }}</span>
            </li>
          </ul>
        </div>

        <ul v-if="group.undatedTasks.length" class="rp-list">
          <li
            v-for="task in group.undatedTasks"
            :key="`${task.path}:${task.line}`"
            class="rp-row calendar-panel__row calendar-panel__row--task"
            :class="{ 'is-done': task.done }"
            @click="openTask(task)"
          >
            <span
              class="rp-check calendar-panel__check"
              :class="{ 'is-done': task.done }"
              aria-hidden="true"
            />
            <span class="calendar-panel__label">{{ task.title }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- Day -->
    <div v-else-if="effectiveView === 'day' && dayData" class="rp-body calendar-panel__dayview">
      <div class="calendar-panel__allday">
        <span class="calendar-panel__allday-label">{{ t('calendar.allDay') }}</span>
        <button
          v-for="(occ, i) in dayData.allDay"
          :key="`${occ.eventUid}:${occ.start}:${i}`"
          type="button"
          class="rp-chip calendar-panel__allday-chip"
          @click="openEvent(occ.path)"
        >
          <span class="calendar-panel__bar" aria-hidden="true" />
          {{ occ.summary }}
        </button>
      </div>

      <div class="calendar-panel__hours">
        <div v-for="h in 24" :key="h" class="calendar-panel__hour">
          <span class="calendar-panel__hour-label">{{ String(h - 1).padStart(2, '0') }}:00</span>
        </div>
        <div class="calendar-panel__blocks">
          <button
            v-for="block in dayData.timed"
            :key="`${block.occurrence.eventUid}:${block.occurrence.start}`"
            type="button"
            class="calendar-panel__block"
            :class="{ 'is-cancelled': block.occurrence.source.status === 'CANCELLED' }"
            :style="blockStyle(block)"
            @click="openEvent(block.occurrence.path)"
          >
            <span class="calendar-panel__block-time">{{ timeLabel(block.occurrence) }}</span>
            <span class="calendar-panel__block-label">{{ block.occurrence.summary }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Week -->
    <div v-else-if="effectiveView === 'week'" class="rp-body calendar-panel__week">
      <div class="calendar-panel__week-head">
        <button
          v-for="day in viewData.days"
          :key="day.date"
          type="button"
          class="calendar-panel__week-day"
          :class="{ 'is-today': isToday(day.date) }"
          @click="openDay(day.date)"
        >
          <span class="calendar-panel__week-dow">{{ weekdayLabel(day.date) }}</span>
          <span class="calendar-panel__week-num">{{ dayNumber(day.date) }}</span>
        </button>
      </div>

      <div class="calendar-panel__week-body">
        <div v-for="day in viewData.days" :key="day.date" class="calendar-panel__week-col">
          <template v-for="item in cellItems(day).slice(0, 3)" :key="item.key">
            <button
              v-if="item.kind === 'event'"
              type="button"
              class="calendar-panel__mini calendar-panel__mini--event"
              :title="`${item.time ?? ''} ${item.label}`.trim()"
              @click="openEvent(item.path ?? '')"
            >
              <span class="calendar-panel__bar" aria-hidden="true" />
              <span class="calendar-panel__mini-label">{{ item.label }}</span>
            </button>
            <button
              v-else-if="item.task"
              type="button"
              class="calendar-panel__mini calendar-panel__mini--task"
              @click="openTask(item.task)"
            >
              <span class="calendar-panel__dot" aria-hidden="true" />
              <span class="calendar-panel__mini-label">{{ item.label }}</span>
            </button>
          </template>
          <span v-if="cellCount(day) > 3" class="calendar-panel__more">
            {{ t('calendar.more', { count: cellCount(day) - 3 }) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Month -->
    <div v-else-if="effectiveView === 'month'" class="rp-body calendar-panel__month">
      <div class="calendar-panel__month-title">{{ monthTitle }}</div>
      <div class="calendar-panel__month-head">
        <span v-for="day in viewData.days.slice(0, 7)" :key="day.date">
          {{ weekdayLabel(day.date) }}
        </span>
      </div>
      <div class="calendar-panel__month-grid">
        <button
          v-for="day in viewData.days"
          :key="day.date"
          type="button"
          class="calendar-panel__cell"
          :class="{ 'is-outside': !inMonth(day.date), 'is-today': isToday(day.date) }"
          @click="focusDay(day.date)"
        >
          <span class="calendar-panel__cell-date">{{ dayNumber(day.date) }}</span>
          <span
            v-for="item in cellItems(day).slice(0, 3)"
            :key="item.key"
            class="calendar-panel__cell-item"
            :class="`calendar-panel__cell-item--${item.kind}`"
          >
            <i class="calendar-panel__cell-mark" aria-hidden="true" />
            <span class="calendar-panel__cell-label">{{ item.label }}</span>
          </span>
          <span v-if="cellCount(day) > 3" class="calendar-panel__more">
            {{ t('calendar.more', { count: cellCount(day) - 3 }) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-panel__toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 8px 12px;
}
.calendar-panel__seg {
  flex: 1 1 auto;
  min-width: 0;
}
.calendar-panel__today {
  padding: 0 8px;
}

/* ── Agenda ─────────────────────────────────────────────────────────── */
.calendar-panel__group + .calendar-panel__group {
  margin-top: 6px;
}
.calendar-panel__dayblock + .calendar-panel__dayblock {
  margin-top: 4px;
}
.calendar-panel__date {
  padding: 4px 8px 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__date.is-today {
  color: var(--accent-text);
}
.calendar-panel__row {
  align-items: flex-start;
  padding-top: 5px;
  padding-bottom: 5px;
  min-height: 26px;
  line-height: 1.35;
}
.calendar-panel__label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.calendar-panel__row--event .calendar-panel__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calendar-panel__row.is-done .calendar-panel__label {
  text-decoration: line-through;
  color: var(--text-3);
}
.calendar-panel__row.is-cancelled .calendar-panel__label {
  text-decoration: line-through;
  color: var(--text-3);
}

/* Event = accent vertical bar; task = checkbox + date chip. */
.calendar-panel__bar {
  flex: 0 0 auto;
  width: 2px;
  align-self: stretch;
  min-height: 14px;
  margin: 2px 0;
  border-radius: 1px;
  background: var(--accent);
}
.calendar-panel__time {
  flex: 0 0 auto;
  min-width: 34px;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__check {
  margin-top: 1px;
  cursor: default;
  pointer-events: none;
}
.calendar-panel__check.is-done {
  background: var(--accent);
  border-color: var(--accent);
}
.calendar-panel__check.is-done::after {
  content: '';
  width: 7px;
  height: 4px;
  border: 1.6px solid var(--accent-strong-fg);
  border-top: 0;
  border-right: 0;
  transform: translateY(-1px) rotate(-45deg);
}
.calendar-panel__due {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__due--overdue {
  color: var(--danger);
  font-weight: 500;
}

/* ── Day ─────────────────────────────────────────────────────────────── */
.calendar-panel__dayview {
  padding-top: 0;
}
.calendar-panel__allday {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 0 4px 8px;
  border-bottom: var(--bd-hair);
}
.calendar-panel__allday-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
.calendar-panel__allday-chip {
  height: 24px;
  max-width: 100%;
}
.calendar-panel__hours {
  position: relative;
  margin-top: 4px;
}
.calendar-panel__hour {
  position: relative;
  height: 32px;
  border-top: var(--bd-hair);
  box-sizing: border-box;
}
.calendar-panel__hour:last-child {
  border-bottom: var(--bd-hair);
}
.calendar-panel__hour-label {
  position: absolute;
  top: -7px;
  left: 0;
  width: 34px;
  text-align: right;
  font-size: 10px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__blocks {
  position: absolute;
  inset: 0 0 0 38px;
  pointer-events: none;
}
.calendar-panel__block {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 16px;
  padding: 2px 5px;
  box-sizing: border-box;
  border: 0;
  border-left: 2px solid var(--accent);
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  line-height: 1.3;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
}
.calendar-panel__block:hover {
  background: var(--fill-2);
}
.calendar-panel__block.is-cancelled {
  border-left-color: var(--text-3);
  color: var(--text-3);
}
.calendar-panel__block-time {
  font-size: 10px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__block-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Week ────────────────────────────────────────────────────────────── */
.calendar-panel__week {
  padding-left: 4px;
  padding-right: 4px;
}
.calendar-panel__week-head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  padding-bottom: 6px;
}
.calendar-panel__week-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
  padding: 3px 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.calendar-panel__week-day:hover {
  background: var(--fill-1);
}
.calendar-panel__week-day.is-today {
  color: var(--accent-text);
  font-weight: 600;
}
.calendar-panel__week-dow {
  font-size: 10px;
  color: var(--text-3);
}
.calendar-panel__week-day.is-today .calendar-panel__week-dow {
  color: var(--accent-text);
}
.calendar-panel__week-num {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.calendar-panel__week-body {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}
.calendar-panel__week-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  min-height: 120px;
  padding: 2px;
  border-top: var(--bd-hair);
}
.calendar-panel__mini {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding: 2px 3px;
  border: 0;
  border-radius: 3px;
  background: var(--fill-1);
  color: var(--text);
  font: inherit;
  font-size: 10px;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.calendar-panel__mini:hover {
  background: var(--fill-2);
}
.calendar-panel__mini .calendar-panel__bar {
  min-height: 10px;
  margin: 0;
}
.calendar-panel__mini--task {
  background: transparent;
}
.calendar-panel__dot {
  flex: 0 0 auto;
  width: 4px;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--text-3);
}
.calendar-panel__mini-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Month ───────────────────────────────────────────────────────────── */
.calendar-panel__month {
  padding-left: 4px;
  padding-right: 4px;
}
.calendar-panel__month-title {
  padding: 0 4px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.calendar-panel__month-head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  padding-bottom: 2px;
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
}
.calendar-panel__month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-auto-rows: minmax(44px, auto);
  gap: 2px;
}
.calendar-panel__cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 2px 3px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--fill-1);
  color: var(--text);
  font: inherit;
  font-size: 10px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.calendar-panel__cell:hover {
  background: var(--fill-2);
}
.calendar-panel__cell.is-outside {
  opacity: 0.55;
}
.calendar-panel__cell.is-today {
  box-shadow: inset 0 0 0 2px var(--accent-soft);
}
.calendar-panel__cell-date {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.calendar-panel__cell.is-today .calendar-panel__cell-date {
  color: var(--accent-text);
  font-weight: 600;
}
.calendar-panel__cell-item {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  line-height: 1.25;
}
.calendar-panel__cell-mark {
  flex: 0 0 auto;
  width: 2px;
  height: 9px;
  border-radius: 1px;
  background: var(--accent);
}
.calendar-panel__cell-item--task .calendar-panel__cell-mark {
  width: 4px;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--text-3);
}
.calendar-panel__cell-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-panel__more {
  font-size: 10px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
</style>
