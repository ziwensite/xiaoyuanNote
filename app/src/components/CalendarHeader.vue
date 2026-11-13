<script setup lang="ts">
/**
 * Shared calendar header used by the dock preview panel, the main calendar
 * month view (inside CalendarPanel) and the day/week views (inside
 * CalendarWorkspace). One header for every view keeps the switching segment,
 * navigation and actions identical everywhere.
 *
 * `preview` mode (dock) hides the [日][周][月] segment and shows a single
 * calendar icon that opens the full workspace; `showOpenDay` toggles the
 * "open selected day" button (hidden in the workspace itself).
 */
import { computed, ref } from 'vue';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import { addDays } from '../lib/calendar';
import { CALENDAR_EDITOR_VIEWS } from '../lib/calendar-prefs';
import { useCalendarStore } from '../stores/calendar';

const props = defineProps<{ showOpenDay?: boolean; preview?: boolean }>();
const showOpenDay = computed(() => props.showOpenDay !== false);

const calendar = useCalendarStore();
const { t, lang } = useI18n();

function wallDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const monthTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric', month: 'long' });
  return fmt.format(wallDate(calendar.focusDate));
});
const dayTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
  return fmt.format(wallDate(calendar.focusDate));
});
const weekTitle = computed(() => {
  const d = wallDate(calendar.focusDate);
  const dow = d.getDay();
  const ws = addDays(calendar.focusDate, -((dow + 6) % 7));
  const we = addDays(ws, 6);
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { month: 'long', day: 'numeric' });
  return `${fmt.format(wallDate(ws))} – ${fmt.format(wallDate(we))}`;
});
const headerTitle = computed(() => {
  if (calendar.view === 'day') return dayTitle.value;
  if (calendar.view === 'week') return weekTitle.value;
  return monthTitle.value;
});

/** Year/month picker: click the title to open; pick a month to jump there. */
const ymOpen = ref(false);
const ymYear = ref(0);
const ymMonth = ref(0);
function toggleYearMonthPicker() {
  if (ymOpen.value) {
    ymOpen.value = false;
    return;
  }
  const [y, m] = calendar.focusDate.split('-').map(Number);
  ymYear.value = y;
  ymMonth.value = m;
  ymOpen.value = true;
}
function pickMonth(m: number) {
  const mm = String(m).padStart(2, '0');
  calendar.setFocusDate(`${ymYear.value}-${mm}-01`);
  ymOpen.value = false;
}

/** Date picker — day/week title jumps to a specific date. */
const dateOpen = ref(false);
const dateYear = ref(0);
const dateMonth = ref(0);
function openDatePicker() {
  const [y, m] = calendar.focusDate.split('-').map(Number);
  dateYear.value = y;
  dateMonth.value = m;
  dateOpen.value = true;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function pickDate(day: number) {
  const mm = String(dateMonth.value).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  calendar.setFocusDate(`${dateYear.value}-${mm}-${dd}`);
  dateOpen.value = false;
}

function shiftStep(delta: number) {
  if (calendar.view === 'day') calendar.setFocusDate(addDays(calendar.focusDate, delta));
  else if (calendar.view === 'week') calendar.setFocusDate(addDays(calendar.focusDate, delta * 7));
  else calendar.shiftMonth(delta);
  ymOpen.value = false;
  dateOpen.value = false;
}

function openSelectedDay() {
  calendar.openWorkspace();
}

/** Header title click: month opens the year/month picker, day/week open the
 *  date picker, so the shared focus date is editable from any view. */
function onTitleClick() {
  if (calendar.view === 'month') toggleYearMonthPicker();
  else openDatePicker();
}

/** "+" opens the full calendar workspace focused on the current day/view. */
function onNew() {
  calendar.openWorkspace(calendar.focusDate, calendar.view);
}
</script>

<template>
  <div class="calendar-panel__head">
    <div class="calendar-panel__nav">
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.prev')"
        :aria-label="t('calendar.prev')"
        @click="shiftStep(-1)"
      >
        <Icons name="chevron-left" :size="14" />
      </button>
      <button
        class="calendar-panel__month"
        type="button"
        :title="t('calendar.pickMonth')"
        :aria-label="t('calendar.pickMonth')"
        @click="onTitleClick"
      >
        {{ headerTitle }}
      </button>
      <button
        class="rp-icon-btn"
        type="button"
        :title="t('calendar.next')"
        :aria-label="t('calendar.next')"
        @click="shiftStep(1)"
      >
        <Icons name="chevron-right" :size="14" />
      </button>
    </div>
    <div class="calendar-panel__right">
      <div v-if="preview" class="calendar-panel__open">
        <button
          type="button"
          class="rp-icon-btn"
          :title="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          :aria-label="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          @click="calendar.openWorkspace(calendar.focusDate, calendar.view)"
        >
          <Icons name="calendar" :size="14" />
        </button>
      </div>
      <div v-else class="calendar-panel__seg" role="group" :aria-label="t('calendar.title')">
        <button
          v-for="view in CALENDAR_EDITOR_VIEWS"
          :key="view"
          type="button"
          :class="{ 'is-active': calendar.view === view }"
          :aria-pressed="calendar.view === view"
          @click="calendar.setView(view)"
        >{{ t(`calendar.view.${view}`) }}</button>
      </div>
      <div class="calendar-panel__head-actions">
        <button class="rp-btn rp-btn--sm calendar-panel__today" type="button" @click="calendar.goToday()">
          {{ t('calendar.today') }}
        </button>
        <button
          type="button"
          class="rp-icon-btn"
          :title="t('calendar.newEvent')"
          :aria-label="t('calendar.newEvent')"
          @click="onNew"
        >
          <Icons name="plus" :size="14" />
        </button>
        <button
          v-if="showOpenDay && !preview"
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          :aria-label="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          @click="openSelectedDay"
        >
          <Icons name="calendar" :size="14" />
        </button>
      </div>
    </div>
    <div v-if="ymOpen" class="calendar-panel__ym-backdrop" @click="ymOpen = false"></div>
    <div v-if="ymOpen" class="calendar-panel__ym" role="dialog" :aria-label="t('calendar.pickMonth')">
      <div class="calendar-panel__ym-year">
        <button
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.prev')"
          :aria-label="t('calendar.prev')"
          :disabled="ymYear <= 1900"
          @click="ymYear--"
        >
          <Icons name="chevron-left" :size="14" />
        </button>
        <span class="calendar-panel__ym-year-label">{{ ymYear }}</span>
        <button
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.next')"
          :aria-label="t('calendar.next')"
          :disabled="ymYear >= 2200"
          @click="ymYear++"
        >
          <Icons name="chevron-right" :size="14" />
        </button>
      </div>
      <div class="calendar-panel__ym-months">
        <button
          v-for="m in 12"
          :key="m"
          type="button"
          class="calendar-panel__ym-month"
          :class="{ 'is-active': m === ymMonth }"
          @click="pickMonth(m)"
        >
          {{ m }}
        </button>
      </div>
    </div>
    <div v-if="dateOpen" class="calendar-panel__ym-backdrop" @click="dateOpen = false"></div>
    <div v-if="dateOpen" class="calendar-panel__ym" role="dialog" :aria-label="t('calendar.pickMonth')">
      <div class="calendar-panel__ym-year">
        <button type="button" class="rp-icon-btn" :disabled="dateYear <= 1900" @click="dateYear--">
          <Icons name="chevron-left" :size="14" />
        </button>
        <span class="calendar-panel__ym-year-label">{{ dateYear }}</span>
        <button type="button" class="rp-icon-btn" :disabled="dateYear >= 2200" @click="dateYear++">
          <Icons name="chevron-right" :size="14" />
        </button>
      </div>
      <div class="calendar-panel__ym-months">
        <button
          v-for="m in 12"
          :key="m"
          type="button"
          class="calendar-panel__ym-month"
          :class="{ 'is-active': m === dateMonth }"
          @click="dateMonth = m"
        >
          {{ m }}
        </button>
      </div>
      <div class="calendar-panel__date-days">
        <button
          v-for="d in daysInMonth(dateYear, dateMonth)"
          :key="d"
          type="button"
          class="calendar-panel__date-day"
          :class="{ 'is-active': `${dateYear}-${String(dateMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}` === calendar.focusDate }"
          @click="pickDate(d)"
        >
          {{ d }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-panel__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: auto;
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
  padding: 8px 10px 4px;
}
.calendar-panel__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
}
.calendar-panel__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 0;
}
.calendar-panel__month {
  border: 0;
  margin: 0;
  padding: 2px 4px;
  background: transparent;
  color: var(--text, #1f2328);
  font: inherit;
  font-weight: 600;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calendar-panel__month:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
.calendar-panel__head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 auto;
}
.calendar-panel__ym-backdrop {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 3000px;
  z-index: 5;
}
.calendar-panel__ym {
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  right: 8px;
  z-index: 6;
  padding: 8px;
  border: 1px solid var(--line-2, #d0d7de);
  border-radius: 10px;
  background: var(--surface-2, #fff);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
.calendar-panel__ym-year {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.calendar-panel__ym-year-label {
  font-weight: 600;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.calendar-panel__ym-months {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.calendar-panel__ym-month {
  border: 1px solid var(--line-2, #d0d7de);
  border-radius: 6px;
  background: var(--surface-1, #fff);
  color: var(--text-1, #1f2328);
  font: inherit;
  font-size: 12px;
  padding: 4px 0;
  cursor: pointer;
}
.calendar-panel__ym-month:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
.calendar-panel__ym-month.is-active {
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
  font-weight: 600;
}
.calendar-panel__seg {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 0;
}
.calendar-panel__seg button {
  flex: 0 0 auto;
  min-width: 44px;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.15));
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-2, #5b6168);
}
.calendar-panel__seg button:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
.calendar-panel__seg button.is-active {
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
  font-weight: 600;
}
.calendar-panel__date-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  margin-top: 8px;
}
.calendar-panel__date-day {
  font-size: 12px;
  padding: 4px 0;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-2, #5b6168);
}
.calendar-panel__date-day:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
.calendar-panel__date-day.is-active {
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
  font-weight: 600;
}
</style>
