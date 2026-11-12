<script setup lang="ts">
/**
 * Sidebar calendar — a compact month grid for picking a day or a whole week.
 *
 * The dock is 292 px wide (≈35 px per day cell), which cannot hold a usable
 * time grid: detailed day/week/agenda views and editing live in the dialog
 * (`CalendarDialog.vue`). Clicking a day selects it; clicking a week number in
 * the left gutter selects that whole week. The selection is shared with the
 * tasks panel when its "link to calendar" switch is on, so the two never
 * disagree about which day/week is current. The dialog stays one click away in
 * the header (and on Enter, for keyboard users).
 *
 * Month and selection come from `stores/calendar`, the same state the dialog
 * uses, so the two can never show different months.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { useCalendarStore } from '../stores/calendar';
import { useHolidaysStore } from '../stores/holidays';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import { addDays, localDateKey, type CalendarEntry } from '../lib/calendar';
import { buildCalendarView, monthGridRange } from '../lib/calendar-view';
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
import { solarTermOf } from '../lib/solar-terms';

const idx = useWorkspaceIndexStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const calendar = useCalendarStore();
const holidays = useHolidaysStore();
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

/** The linked tasks panel reads the same selection: when a whole week is
 *  selected, every cell in that row is highlighted. */
const selectedWeekSet = computed<Set<string> | null>(() => {
  const wk = calendar.selectedWeekStart;
  if (!wk) return null;
  const set = new Set<string>();
  for (let i = 0; i < 7; i++) set.add(addDays(wk, i));
  return set;
});
function isInSelectedWeek(date: string): boolean {
  return selectedWeekSet.value?.has(date) ?? false;
}

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
function shiftAndClose(delta: number) {
  calendar.shiftMonth(delta);
  ymOpen.value = false;
}

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
 * text — the corner already says it. Keep it to one short string so the cell
 * never grows past the grid's rhythm.
 *
 * The festival name shows ONLY on the actual statutory day — a fixed solar or
 * lunar date — never on the adjacent 调休 days that merely share the off span
 * (e.g. 国庆 on 10-01 only, not on 10-02…10-07; 春节 on 正月初一, not 除夕 or
 * the break's tail). The extra off days keep just the red corner and fall
 * through to the lunar line.
 */
const STATUTORY_FESTIVAL_KEYS = new Set(['qingming', 'springFestival', 'dragonBoat', 'midAutumn']);

/** True when `date` is the real day of a statutory festival (fixed solar or
 *  lunar), independent of the surrounding 调休 off span. */
function isFestivalDay(date: string): boolean {
  const [, mm, dd] = date.split('-');
  if (mm === '01' && dd === '01') return true; // 元旦
  if (mm === '05' && dd === '01') return true; // 劳动节
  if (mm === '10' && dd === '01') return true; // 国庆
  const f = festivalOf(date);
  return f !== null && STATUTORY_FESTIVAL_KEYS.has(f.key);
}

/**
 * The 9 px second line. Priority: statutory festival name (real day only) →
 * traditional lunar festival (春节/元宵/端午/中秋/重阳/腊八/小年, from the
 * built-in lunar table) → solar term (小寒…大雪, all 24, from the built-in
 * table) → local lunar day. Everything here is data-driven (bundled tables),
 * no runtime astronomical calculation.
 */
function subLabel(date: string): string {
  const hit = holidayOf(date);
  if (hit?.kind === 'off' && hit.name && isFestivalDay(date)) return hit.name;
  const festival = festivalOf(date);
  if (festival) return festival.name;
  const st = solarTermOf(date);
  if (st) return st;
  if (!showLunar.value) return '';
  const l = solarToLunar(date);
  if (!l) return '';
  const prefix = l.leap ? '闰' : '';
  if (l.day === 1) return `${prefix}${lunarMonthName(l.month)}`;
  return `${prefix}${lunarDayName(l.day)}`;
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
  calendar.selectDay(next);
  nextTick(() => {
    gridEl.value?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  });
}

/** A click selects a single day (clears any week selection). */
function pick(date: string) {
  calendar.selectDay(date);
}

/** Desktop: an editor tab; narrow windows / tablets: the dialog. */
function openSelectedDay() {
  calendar.openWorkspace();
}
</script>

<template>
  <div class="calendar-panel rp">
    <div class="rp-head calendar-panel__head">
      <div class="calendar-panel__nav">
        <button
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.prev')"
          :aria-label="t('calendar.prev')"
          @click="shiftAndClose(-1)"
        >
          <Icons name="chevron-left" :size="14" />
        </button>
        <button
          class="calendar-panel__month"
          type="button"
          :title="t('calendar.pickMonth')"
          :aria-label="t('calendar.pickMonth')"
          @click="toggleYearMonthPicker"
        >
          {{ monthTitle }}
        </button>
        <button
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.next')"
          :aria-label="t('calendar.next')"
          @click="shiftAndClose(1)"
        >
          <Icons name="chevron-right" :size="14" />
        </button>
      </div>
      <div class="calendar-panel__head-actions">
        <button class="rp-btn rp-btn--sm calendar-panel__today" type="button" @click="calendar.goToday()">
          {{ t('calendar.today') }}
        </button>
        <button
          class="rp-icon-btn"
          type="button"
          :title="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          :aria-label="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          @click="openSelectedDay"
        >
          <Icons name="calendar" :size="14" />
        </button>
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
    </div>

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
            <button
              v-if="showWeeks"
              type="button"
              class="calendar-mini__weeknum calendar-mini__weeknum--btn"
              :title="t('calendar.week.select', { week: row.week })"
              :aria-label="t('calendar.week.select', { week: row.week })"
              :aria-pressed="calendar.isWeekSelected && row.days[0] === calendar.selectedWeekStart"
              @click="calendar.selectWeek(row.days[0])"
            >
              {{ row.week }}
            </button>
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
                'is-week-selected': isInSelectedWeek(date),
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
              <span
                class="calendar-mini__day"
                :class="{
                  'is-off': cornerOf(date) === 'off' && !isToday(date),
                  'is-work': cornerOf(date) === 'work' && !isToday(date),
                }"
              >{{ dayNumber(date) }}</span>
              <span v-if="subLabel(date)" class="calendar-mini__sub">{{ subLabel(date) }}</span>
              <span
                v-if="densityOf(date).hasNote || densityOf(date).total > 0"
                class="calendar-mini__marks"
              >
                <span v-if="densityOf(date).hasNote" class="calendar-mini__dot is-note" :title="t('calendar.mark.note')"></span>
                <span v-if="densityOf(date).todo > 0" class="calendar-mini__dot is-open" :title="t('calendar.mark.open')"></span>
                <span v-else-if="densityOf(date).total > 0" class="calendar-mini__dot is-done" :title="t('calendar.mark.done')"></span>
              </span>
            </button>
          </template>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.calendar-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.calendar-panel__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: auto;
  flex: 0 0 auto;
  min-height: 36px;
}
.calendar-panel__nav {
  display: flex;
  align-items: center;
  gap: 2px;
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
}
.calendar-panel__month:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
.calendar-panel__head-actions {
  display: flex;
  align-items: center;
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

/* Whole-week selection: every cell in the selected row gets a soft fill so the
   week reads as one unit; the focused day still keeps its accent hairline. */
.calendar-mini__cell.is-week-selected {
  background: var(--accent-soft);
}

/* Week-number gutter becomes a clickable "select this week" button. */
.calendar-mini__weeknum--btn {
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3, #8a9199);
  font: inherit;
  cursor: pointer;
}

.calendar-mini__weeknum--btn:hover {
  background: var(--hover, rgba(0, 0, 0, 0.06));
  color: var(--text-1, #1f2328);
}

.calendar-mini__weeknum--btn[aria-pressed='true'] {
  background: var(--accent-soft);
  color: var(--accent, #3b82f6);
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
  background: #e5484d;
}

.calendar-mini__corner.is-work {
  background: #3b82f6;
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

/* Third line: explicit note / open / done marks under the lunar line. Note and
   task state can both appear (a day may have a note and unfinished tasks). */
.calendar-mini__marks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 8px;
  margin-top: 1px;
}
.calendar-mini__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  box-sizing: border-box;
}
.calendar-mini__dot.is-note {
  background: var(--text-3, #8a9199);
}
.calendar-mini__dot.is-open {
  background: transparent;
  border: 1.5px solid var(--accent, #3b82f6);
}
.calendar-mini__dot.is-done {
  background: var(--success, #2f9e63);
}

/* Holiday / make-up-work days tint the solar day number to match the corner
   mark (off = accent blue, work = muted grey). Today's filled dot wins. */
.calendar-mini__day.is-off {
  color: #e5484d;
}
.calendar-mini__day.is-work {
  color: #3b82f6;
}

.calendar-mini__cell.is-outside .calendar-mini__mark,
.calendar-mini__cell.is-outside .calendar-mini__sub,
.calendar-mini__cell.is-outside .calendar-mini__corner {
  opacity: 0.55;
}
</style>
