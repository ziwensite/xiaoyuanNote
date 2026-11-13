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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n, htmlLangFor } from '../i18n';
import Icons from './Icons.vue';
import { addDays } from '../lib/calendar';
import { CALENDAR_EDITOR_VIEWS, type CalendarEditorView } from '../lib/calendar-prefs';
import { useCalendarStore } from '../stores/calendar';
import { useTabsStore } from '../stores/tabs';

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
const effectiveView = computed<CalendarEditorView>(() => (props.preview ? 'month' : calendar.view));
const headerTitle = computed(() => {
  if (effectiveView.value === 'day') return dayTitle.value;
  if (effectiveView.value === 'week') return weekTitle.value;
  return monthTitle.value;
});

/** The native calendar bubble is painted by the browser OUTSIDE the DOM, so
 *  page CSS cannot give it a background, border or shadow. Keep its default
 *  palette and create the contrast on our side instead: a very light scrim
 *  over the editor while the picker is open, plus a card-ish active state on
 *  the title button that anchors it. No `color-scheme` flipping — the input's
 *  own system-coloured background flipped with it, so repeated clicks made
 *  the bubble oscillate between light and dark. */
const pickerActive = ref(false);
function closePicker() {
  pickerActive.value = false;
}
function onGlobalKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && pickerActive.value) closePicker();
}
function onGlobalPointerDown(ev: PointerEvent) {
  if (!pickerActive.value) return;
  // The title button toggles itself in openNativePicker; every other click
  // (scrim, toolbar, another control) dismisses the picker state.
  const target = ev.target as HTMLElement | null;
  if (target?.closest('.calendar-panel__month')) return;
  closePicker();
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown);
  window.addEventListener('pointerdown', onGlobalPointerDown, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  window.removeEventListener('pointerdown', onGlobalPointerDown, true);
});

/** One native date input backs every view (dock, month, day, week). Clicking
 *  the title calls showPicker() so the browser/OS renders its own date UI —
 *  a calendar popover on desktop, a wheel picker on mobile. focus()+click()
 *  is the fallback for engines that do not implement showPicker(). */
const pickerEl = ref<HTMLInputElement | null>(null);
type PickerInput = HTMLInputElement & { showPicker?: () => void };
function openNativePicker() {
  if (pickerActive.value) {
    closePicker();
    return;
  }
  const el = pickerEl.value as PickerInput | null;
  if (!el) return;
  // A cancelled native picker can leave the DOM value out of sync while the
  // Vue-side focusDate is unchanged, so re-sync before every open.
  el.value = calendar.focusDate;
  // Drop any inline colour-scheme left by an earlier session/HMR so the
  // bubble always uses the system default palette.
  el.style.colorScheme = '';
  pickerActive.value = true;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
      return;
    } catch {
      // No transient user activation (programmatic call) — fall through.
    }
  }
  el.focus();
  el.click();
}
function onDateChange(ev: Event) {
  const value = (ev.target as HTMLInputElement).value;
  if (value) calendar.setFocusDate(value);
  closePicker();
}

function shiftStep(delta: number) {
  if (effectiveView.value === 'day') calendar.setFocusDate(addDays(calendar.focusDate, delta));
  else if (effectiveView.value === 'week') calendar.setFocusDate(addDays(calendar.focusDate, delta * 7));
  else calendar.shiftMonth(delta);
}

function openSelectedDay() {
  calendar.openWorkspace();
}

/** "+" opens the full calendar workspace focused on the current day/view. */
function onNew() {
  calendar.openWorkspace(calendar.focusDate, calendar.view);
}

/** The dock preview's calendar icon toggles the full workspace: it lights up
 *  while the workspace is open, and clicking it again closes the workspace.
 *  Covers both the desktop editor tab and the narrow-screen dialog. */
const panelOpen = computed(() => {
  if (calendar.dialogOpen) return true;
  return tabs.tabs.some((t) => t.kind === 'calendar');
});
function togglePanel() {
  if (!panelOpen.value) {
    calendar.openWorkspace(calendar.focusDate, calendar.view);
    return;
  }
  if (calendar.dialogOpen) {
    calendar.closeDialog();
    return;
  }
  const t = tabs.tabs.find((x) => x.kind === 'calendar');
  if (t) tabs.closeTab(t.id);
}
</script>

<template>
  <div class="calendar-panel__head">
    <div v-if="pickerActive" class="calendar-panel__scrim" aria-hidden="true" @click="closePicker"></div>
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
        :class="{ 'is-picking': pickerActive }"
        type="button"
        :title="t('calendar.pickMonth')"
        :aria-label="t('calendar.pickMonth')"
        @click="openNativePicker"
      >
        {{ headerTitle }}
      </button>
      <input
        ref="pickerEl"
        class="calendar-panel__native-date"
        type="date"
        :value="calendar.focusDate"
        :aria-label="t('calendar.pickMonth')"
        tabindex="-1"
        @change="onDateChange"
      />
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
/* While the native picker is open, give the editor a very light scrim so the
   browser-drawn bubble (default palette, no rec colouring) reads as a raised
   layer. No blur: it would soften the whole editor and fight the simple look. */
.calendar-panel__scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.08);
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
.calendar-panel__nav {
  position: relative;
  z-index: 41;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 0;
}
/* The native input must stay in the render tree (showPicker() rejects
   display:none) but must not occupy layout space or intercept clicks. */
.calendar-panel__native-date {
  position: absolute;
  left: 0;
  top: 100%;
  width: 1px;
  height: 1px;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
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
/* Card-ish anchor for the native bubble: hairline edge + soft shadow, using
   the theme's default surface colour rather than an inverted one. */
.calendar-panel__month.is-picking {
  background: var(--bg-pop, #fff);
  border-radius: 8px;
  box-shadow:
    0 0 0 1px var(--hairline, rgba(128, 128, 128, 0.35)),
    0 4px 14px rgba(0, 0, 0, 0.14);
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
