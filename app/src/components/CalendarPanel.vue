<script setup lang="ts">
/**
 * Sidebar calendar — a compact month grid only.
 *
 * The dock is 292 px wide (≈35 px per day cell), which cannot hold a usable
 * time grid: detailed day/week/agenda views and editing live in the dialog
 * (`CalendarDialog.vue`). This pane is for scanning and picking a day; clicking
 * one focuses it and opens the dialog.
 *
 * Month and selected day come from `stores/calendar`, the same state the
 * dialog uses, so the two can never show different months.
 */
import { computed } from 'vue';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useCalendarStore } from '../stores/calendar';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import PanelHeader from './panel/PanelHeader.vue';
import { localDateKey, type CalendarEntry } from '../lib/calendar';
import { buildCalendarView, monthGridRange } from '../lib/calendar-view';

const idx = useWorkspaceIndexStore();
const calendar = useCalendarStore();
const { t, lang } = useI18n();

const emit = defineEmits<{ (e: 'close'): void }>();

const today = computed(() => localDateKey(new Date()));
const hasFolder = computed(() => idx.folder !== null);

const grid = computed(() => monthGridRange(calendar.focusDate));
const range = computed(() => {
  const days = grid.value;
  return { from: days[0], to: addOne(days[days.length - 1]) };
});

const viewData = computed(() =>
  buildCalendarView(idx.entries as CalendarEntry[], range.value),
);

/** How many events + tasks a day carries (dots stop at three). */
const counts = computed(() => {
  const map = new Map<string, number>();
  for (const day of viewData.value.days) {
    map.set(day.date, day.allDay.length + day.timed.length + day.tasks.length);
  }
  return map;
});

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

function dots(date: string): number {
  return Math.min(3, counts.value.get(date) ?? 0);
}

function dotKeys(date: string): number[] {
  return Array.from({ length: dots(date) }, (_, i) => i);
}

function titleFor(date: string): string {
  const n = counts.value.get(date) ?? 0;
  return n
    ? `${date} · ${t('calendar.items', { count: n })}`
    : date;
}

function pick(date: string) {
  calendar.openDialog(date);
}
</script>

<template>
  <div class="calendar-panel rp">
    <PanelHeader @close="emit('close')">
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
    </PanelHeader>

    <div v-if="!hasFolder" class="rp-empty">{{ t('calendar.openFolder') }}</div>

    <div v-else class="calendar-mini">
      <div class="calendar-mini__title">{{ monthTitle }}</div>
      <div class="calendar-mini__weekdays" aria-hidden="true">
        <span v-for="(label, i) in weekdayLabels" :key="i">{{ label }}</span>
      </div>
      <div class="calendar-mini__grid" role="grid" :aria-label="monthTitle">
        <button
          v-for="date in grid"
          :key="date"
          type="button"
          class="calendar-mini__cell"
          :class="{
            'is-outside': !inMonth(date),
            'is-today': isToday(date),
            'is-focus': isFocus(date),
          }"
          :title="titleFor(date)"
          :aria-label="titleFor(date)"
          :aria-pressed="isFocus(date)"
          @click="pick(date)"
        >
          <span class="calendar-mini__day">{{ dayNumber(date) }}</span>
          <span class="calendar-mini__dots" aria-hidden="true">
            <span v-for="i in dotKeys(date)" :key="i" class="calendar-mini__dot" />
          </span>
        </button>
      </div>
    </div>
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
  flex: 1;
  min-height: 0;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.calendar-mini__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1, #1f2328);
  padding: 0 2px;
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

.calendar-mini__cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 28px;
  padding: 3px 0 5px;
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

.calendar-mini__cell.is-focus {
  border-color: var(--accent, #3b82f6);
}

.calendar-mini__dots {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 2px;
}

.calendar-mini__dot {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--accent, #3b82f6);
}

.calendar-mini__cell.is-outside .calendar-mini__dot {
  background: var(--text-3, #b4bac1);
}
</style>
