<script setup lang="ts">
/**
 * Sidebar calendar — a compact month grid plus the selected day's task list.
 *
 * The dock is 292 px wide (≈35 px per day cell), which cannot hold a usable
 * time grid: detailed day/week/agenda views and editing live in the dialog
 * (`CalendarDialog.vue`). Clicking a day therefore only *selects* it, and the
 * lines due that day appear underneath, in the same pane — that is the question
 * a sidebar calendar is usually asked. The dialog stays one click away in the
 * header (and on Enter, for keyboard users).
 *
 * Month and selected day come from `stores/calendar`, the same state the
 * dialog uses, so the two can never show different months.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { useCalendarStore } from '../stores/calendar';
import { useHolidaysStore } from '../stores/holidays';
import { useTilesStore } from '../stores/tiles';
import { useToastsStore } from '../stores/toasts';
import { useTasks } from '../composables/useTasks';
import { useFiles } from '../composables/useFiles';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import PanelHeader from './panel/PanelHeader.vue';
import { addDays, localDateKey, type CalendarEntry, type CalendarTask } from '../lib/calendar';
import { buildCalendarView, monthGridRange } from '../lib/calendar-view';
import { samePath } from '../lib/path-key';
import {
  dailyNoteDates,
  dayDensity,
  type CalendarDayDensity,
} from '../lib/calendar-density';
import { isoWeek } from '../lib/iso-week';
import {
  festivalOf,
  lunarDateLabel,
  lunarDayName,
  lunarMonthName,
  solarToLunar,
} from '../lib/lunar';

const idx = useWorkspaceIndexStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const calendar = useCalendarStore();
const holidays = useHolidaysStore();
const tiles = useTilesStore();
const toasts = useToastsStore();
const files = useFiles();
const taskList = useTasks();
const { t, lang } = useI18n();

const gridEl = ref<HTMLElement | null>(null);

const today = computed(() => localDateKey(new Date()));
const hasFolder = computed(() => idx.folder !== null);

const grid = computed(() => monthGridRange(calendar.focusDate));

/** Six Monday-start rows; the left gutter carries each row's ISO week. */
const weeks = computed(() => {
  const rows: { week: number; days: string[] }[] = [];
  for (let i = 0; i < grid.value.length; i += 7) {
    const days = grid.value.slice(i, i + 7);
    rows.push({ week: isoWeek(days[0]).week, days });
  }
  return rows;
});

const showHolidays = computed(() => settings.calendarShowHolidays);
const showLunar = computed(() => settings.calendarShowLunar);
const showWeeks = computed(() => settings.calendarShowIsoWeeks);
const gridColumns = computed(() =>
  showWeeks.value ? '18px repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))',
);
const holidayMap = computed(() => holidays.index);

onMounted(() => {
  // Opening the pane is one of the three refresh events. It honours the TTL,
  // runs in the background and stays silent on failure.
  void holidays.maybeRefresh('open');
});

const range = computed(() => {
  const days = grid.value;
  return { from: days[0], to: addOne(days[days.length - 1]) };
});

const viewData = computed(() =>
  buildCalendarView(idx.entries as CalendarEntry[], range.value),
);

/** The selection IS the shared focus date: one value drives the grid outline,
 *  the list below and the dialog's starting day. */
const selectedTasks = computed(
  () => viewData.value.days.find((day) => day.date === calendar.focusDate)?.tasks ?? [],
);
const dayLabel = computed(() =>
  new Intl.DateTimeFormat(htmlLangFor(lang.value), {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(wallDate(calendar.focusDate)),
);

const noteDates = computed(() =>
  dailyNoteDates(
    idx.entries,
    grid.value,
    workspace.currentFolder,
    settings.dailyNotesFolder,
    settings.dailyNotesFormat,
  ),
);

/** Same three-state rule as the dialog month grid (see `calendar-density`). */
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

const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { weekday: 'narrow' });
  return grid.value.slice(0, 7).map((date) => fmt.format(wallDate(date)));
});

const monthTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric', month: 'long' });
  return fmt.format(wallDate(calendar.focusDate));
});

function wallDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addOne(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function isToday(date: string): boolean {
  return date === today.value;
}

function isFocus(date: string): boolean {
  return date === calendar.focusDate;
}

function inMonth(date: string): boolean {
  return date.slice(0, 7) === calendar.focusDate.slice(0, 7);
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

function holidayOf(date: string) {
  return showHolidays.value ? holidayMap.value.get(date) ?? null : null;
}

function cornerOf(date: string): 'off' | 'work' | null {
  const hit = holidayOf(date);
  return hit ? hit.kind : null;
}

/**
 * The 9 px second line. A statutory holiday's name wins over the lunar day
 * (they would otherwise duplicate, e.g. 春节 / 初一); 补班 days get no extra
 * text — the hollow corner already says it. Keep it to one short string so the
 * cell never grows past the grid's rhythm.
 */
function subLabel(date: string): string {
  const hit = holidayOf(date);
  if (hit?.kind === 'off' && hit.name) return hit.name;
  if (!showLunar.value) return '';
  const festival = festivalOf(date);
  if (festival) return festival.name;
  const lunar = solarToLunar(date);
  if (!lunar) return '';
  const prefix = lunar.leap ? '闰' : '';
  if (lunar.day === 1) return `${prefix}${lunarMonthName(lunar.month)}`;
  return `${prefix}${lunarDayName(lunar.day)}`;
}

function tooltipFor(date: string): string {
  const d = densityOf(date);
  const parts = [date];
  const holiday = holidayOf(date);
  if (holiday) {
    parts.push(
      holiday.kind === 'off'
        ? t('calendar.day.off', { name: holiday.name })
        : holiday.name
          ? `${t('calendar.day.work')} · ${holiday.name}`
          : t('calendar.day.work'),
    );
  }
  if (showLunar.value) {
    const lunar = lunarDateLabel(date);
    if (lunar) parts.push(t('calendar.lunar.tooltip', { value: lunar }));
  }
  if (d.total > 0) {
    parts.push(
      t('calendar.tooltip.tasks', { total: d.total, done: d.done, todo: d.todo }),
    );
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

/** Arrows move the shared focus date; Enter still opens the day in the dialog. */
function onGridKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    openSelectedDay();
    return;
  }
  const delta = ARROW_DELTAS[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const next = addDays(calendar.focusDate, delta);
  calendar.setFocusDate(next);
  nextTick(() => {
    gridEl.value?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  });
}

/** A click only selects — the day's lines are what the pane is for now. */
function pick(date: string) {
  calendar.setFocusDate(date);
}

/** The dialog kept its old self, it just moved behind a deliberate button. */
function openSelectedDay() {
  calendar.openDialog();
}

async function toggleSelected(task: CalendarTask) {
  // Toggle the live index row, not the projection: the calendar's copy is a
  // snapshot that would go stale the moment the file is written.
  const live = taskList.tasks.value.find(
    (x) => samePath(x.path, task.path) && x.line === task.line,
  );
  if (!live) {
    toasts.warning(t('calendar.toastTaskGone'));
    return;
  }
  await taskList.toggle(live);
}

async function openSelectedTask(task: CalendarTask) {
  await files.openPath(task.path, { bypassNewWindow: true });
  // Same jump path as the tasks panel: the editor needs a tick to mount the
  // document before the line can be revealed.
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
  <div class="calendar-panel rp">
    <PanelHeader :title="monthTitle">
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.prev')"
        :aria-label="t('calendar.prev')"
        @click="calendar.shiftMonth(-1)"
      >
        <Icons name="chevron-left" :size="14" />
      </button>
      <button class="rp-btn rp-btn--sm calendar-panel__today" type="button" @click="calendar.goToday()">
        {{ t('calendar.today') }}
      </button>
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.next')"
        :aria-label="t('calendar.next')"
        @click="calendar.shiftMonth(1)"
      >
        <Icons name="chevron-right" :size="14" />
      </button>
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.selectedDay.open', { date: dayLabel })"
        :aria-label="t('calendar.selectedDay.open', { date: dayLabel })"
        @click="openSelectedDay"
      >
        <Icons name="calendar" :size="14" />
      </button>
    </PanelHeader>

    <div v-if="!hasFolder" class="rp-empty">{{ t('calendar.openFolder') }}</div>

    <template v-else>
      <div class="calendar-mini">
        <div
          class="calendar-mini__weekdays"
          :style="{ gridTemplateColumns: gridColumns }"
          aria-hidden="true"
        >
          <span v-if="showWeeks" class="calendar-mini__weeknum">
            {{ t('calendar.week.header') }}
          </span>
          <span v-for="(label, i) in weekdayLabels" :key="i">{{ label }}</span>
        </div>
        <div
          ref="gridEl"
          class="calendar-mini__grid"
          role="grid"
          :aria-label="monthTitle"
          :style="{ gridTemplateColumns: gridColumns }"
          @keydown="onGridKeydown"
        >
          <template v-for="row in weeks" :key="row.week">
            <span
              v-if="showWeeks"
              class="calendar-mini__weeknum"
              :title="t('calendar.week.tooltip', { week: row.week })"
              aria-hidden="true"
            >
              {{ row.week }}
            </span>
            <button
              v-for="date in row.days"
              :key="date"
              type="button"
              class="calendar-mini__cell"
              :data-date="date"
              :class="{
                'is-outside': !inMonth(date),
                'is-today': isToday(date),
                'is-selected': isFocus(date),
              }"
              :tabindex="isFocus(date) ? 0 : -1"
              :title="tooltipFor(date)"
              :aria-label="tooltipFor(date)"
              :aria-pressed="isFocus(date)"
              @click="pick(date)"
            >
              <span
                v-if="cornerOf(date)"
                class="calendar-mini__corner"
                :class="`is-${cornerOf(date)}`"
                aria-hidden="true"
              />
              <span class="calendar-mini__day">{{ dayNumber(date) }}</span>
              <span v-if="subLabel(date)" class="calendar-mini__sub">{{ subLabel(date) }}</span>
              <span
                class="calendar-mini__mark"
                :class="`is-${densityOf(date).state}`"
                aria-hidden="true"
              />
            </button>
          </template>
        </div>
      </div>

      <section class="calendar-day">
        <h4 class="rp-section calendar-day__head">
          <span class="rp-row__label">{{ dayLabel }}</span>
          <span class="calendar-day__count">{{ selectedTasks.length }}</span>
        </h4>
        <div v-if="selectedTasks.length === 0" class="rp-empty">
          {{ t('calendar.selectedDay.empty') }}
        </div>
        <ul v-else class="rp-list calendar-day__list">
          <li
            v-for="task in selectedTasks"
            :key="`${task.path}:${task.line}`"
            class="rp-row calendar-day__item"
            :class="{ 'is-done': task.done }"
            @click="openSelectedTask(task)"
          >
            <input
              type="checkbox"
              class="rp-check"
              :checked="task.done"
              :aria-label="task.title"
              @click.stop="toggleSelected(task)"
            />
            <span class="rp-row__label">{{ task.title }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.calendar-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.calendar-mini {
  flex: 0 0 auto;
  min-height: 0;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.calendar-mini__weekdays,
.calendar-mini__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.calendar-mini__weekdays {
  font-size: 10px;
  color: var(--text-3, #8a9199);
  text-align: center;
  padding-bottom: 2px;
}

/* Week-number gutter. 18 px keeps the seven day columns the same width as the
   bare grid; the header "W" uses the same box so the rows line up. */
.calendar-mini__weeknum {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--text-3, #8a9199);
  font-variant-numeric: tabular-nums;
}

.calendar-mini__cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-height: 38px;
  padding: 3px 0 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-1, #1f2328);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.calendar-mini__cell:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}

.calendar-mini__cell.is-outside {
  color: var(--text-3, #b4bac1);
}

.calendar-mini__cell.is-today .calendar-mini__day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--accent, #3b82f6);
  color: #fff;
}

/* Selection, not navigation: a soft fill plus the accent hairline is enough to
   read at 35 px without competing with today's filled dot. */
.calendar-mini__cell.is-selected {
  border-color: var(--accent, #3b82f6);
  background: var(--accent-soft);
}

/* ── Selected day's lines ─────────────────────────────────────────────── */
.calendar-day {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line-2, rgba(0, 0, 0, 0.08));
}

.calendar-day__head {
  flex: 0 0 auto;
  padding: 8px 18px 4px;
}

.calendar-day > .rp-empty {
  padding: 16px;
}

.calendar-day__list {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 12px;
}

.calendar-day__item {
  cursor: pointer;
}

/* Done lines stay visible — the day's full record — but recede. */
.calendar-day__item.is-done {
  color: var(--text-3);
}

.calendar-day__item.is-done .rp-row__label {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

/* Second line: lunar day / festival. Deliberately one short string, 9 px, so
   the extra layer never changes the cell's height or pushes the density dot. */
.calendar-mini__sub {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  font-size: 9px;
  line-height: 1;
  color: var(--text-3, #8a9199);
  letter-spacing: -0.01em;
}

/* Corner mark: filled = day off, hollow = make-up workday. */
.calendar-mini__corner {
  position: absolute;
  top: 5px;
  left: 5px;
  box-sizing: border-box;
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.calendar-mini__corner.is-off {
  background: var(--accent, #3b82f6);
}

.calendar-mini__corner.is-work {
  border: 1px solid var(--text-3, #8a9199);
}

/* Density dot moved out of the flow (top-right) so the lunar line owns the
   bottom of the cell. */
.calendar-mini__mark {
  position: absolute;
  top: 4px;
  right: 4px;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.calendar-mini__mark.is-none {
  visibility: hidden;
}

.calendar-mini__mark.is-note {
  background: var(--text-3, #8a9199);
}

.calendar-mini__mark.is-done {
  background: var(--success, #2f9e63);
}

/* Hollow ring: unfinished tasks are the one thing that must draw the eye. */
.calendar-mini__mark.is-open {
  background: transparent;
  border: 1.5px solid var(--accent, #3b82f6);
}

.calendar-mini__cell.is-outside .calendar-mini__mark,
.calendar-mini__cell.is-outside .calendar-mini__sub,
.calendar-mini__cell.is-outside .calendar-mini__corner {
  opacity: 0.55;
}
</style>
