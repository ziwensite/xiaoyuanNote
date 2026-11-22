<script setup lang="ts">
/**
 * Shared calendar header used by the dock preview panel, the main calendar
 * month view (inside CalendarPanel) and the day/week views (inside
 * CalendarWorkspace). One header for every view keeps the switching segment,
 * navigation and actions identical everywhere.
 *
 * `preview` mode (dock) hides the [日][周][月][年] segment and shows a single
 * calendar icon that opens the full workspace; `showOpenDay` toggles the
 * "open selected day" button (hidden in the workspace itself).
 */
import { computed } from 'vue';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import DatePickerPopover from './DatePickerPopover.vue';
import { addDays } from '../lib/calendar';
import { CALENDAR_EDITOR_VIEWS, type CalendarEditorView } from '../lib/calendar-prefs';
import { useCalendarStore } from '../stores/calendar';
import { useTabsStore } from '../stores/tabs';
import { isNarrowViewport, isTabletOverlayViewport } from '../composables/useViewport';

const props = defineProps<{ showOpenDay?: boolean; preview?: boolean }>();
const showOpenDay = computed(() => props.showOpenDay !== false);

const calendar = useCalendarStore();
const tabs = useTabsStore();
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
// In the dock preview the panel is always a month grid, so it must NOT follow
// the main calendar's view — otherwise switching day/week/month there would also
// flip the dock's title and date navigation.
const yearTitle = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric' });
  return fmt.format(wallDate(calendar.focusDate));
});
const effectiveView = computed<CalendarEditorView>(() => (props.preview ? 'month' : calendar.view));
const headerTitle = computed(() => {
  if (effectiveView.value === 'day') return dayTitle.value;
  if (effectiveView.value === 'week') return weekTitle.value;
  if (effectiveView.value === 'year') return yearTitle.value;
  return monthTitle.value;
});

/** The date button opens the app's own menu-styled date picker
 *  (DatePickerPopover) instead of the browser's native date bubble, so the
 *  picker reads exactly like the other pop-up menus — same surface, radius,
 *  shadow and open animation. */
function onPickDate(iso: string) {
  calendar.setFocusDate(iso);
}

function shiftStep(delta: number) {
  if (effectiveView.value === 'day') calendar.setFocusDate(addDays(calendar.focusDate, delta));
  else if (effectiveView.value === 'week') calendar.setFocusDate(addDays(calendar.focusDate, delta * 7));
  else if (effectiveView.value === 'year') calendar.shiftMonth(delta * 12);
  else calendar.shiftMonth(delta);
}

/** Explicit header actions open the desktop editor tab whenever the app is in
 *  the desktop shell, even if the editor column is narrower than the virtual
 *  tab's comfortable minimum. Phones/tablets keep the overlay dialog. */
function openWorkspaceFromHeader(): void {
  const desktopShell = !isNarrowViewport() && !isTabletOverlayViewport();
  calendar.openWorkspace(calendar.focusDate, calendar.view, { forceTab: desktopShell });
}

function openSelectedDay() {
  openWorkspaceFromHeader();
}

/** "+" opens the full calendar workspace focused on the current day/view. */
function onNew() {
  openWorkspaceFromHeader();
}

/** The dock preview's calendar icon focuses the full workspace. It lights up
 *  while the workspace is open; clicking the active workspace closes it, while
 *  clicking an existing-but-background calendar tab activates that tab. */
const calendarTab = computed(() => tabs.tabs.find((t) => t.kind === 'calendar'));
const panelOpen = computed(() => calendar.dialogOpen || !!calendarTab.value);
function togglePanel() {
  if (calendar.dialogOpen) {
    calendar.closeDialog();
    return;
  }
  const tab = calendarTab.value;
  if (tab) {
    if (tabs.activeId === tab.id) tabs.closeTab(tab.id);
    else tabs.activate(tab.id);
    return;
  }
  openWorkspaceFromHeader();
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
      <DatePickerPopover mode="month" :iso="calendar.focusDate" @pick="onPickDate">
        <template #trigger="{ toggle }">
          <button
            class="calendar-panel__month"
            type="button"
            :title="t('calendar.pickMonth')"
            :aria-label="t('calendar.pickMonth')"
            @click="toggle"
          >
            {{ headerTitle }}
          </button>
        </template>
      </DatePickerPopover>
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
          :class="{ 'is-active': panelOpen }"
          :aria-pressed="panelOpen"
          :title="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          :aria-label="t('calendar.selectedDay.open', { date: calendar.focusDate })"
          @click="togglePanel"
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
  position: relative;
  z-index: 41;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
}
/* Date navigation sits at the right of every view's header. The auto margin
   absorbs the free space even where a host still uses `space-between`, so the
   nav group and the right-hand controls line up together on the right. */
.calendar-panel__nav {
  position: relative;
  z-index: 41;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 0;
  margin-left: auto;
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
.rp-icon-btn.is-active {
  color: var(--accent, #3b82f6);
  background: var(--hover, rgba(0, 0, 0, 0.06));
}
</style>
