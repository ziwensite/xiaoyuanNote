<script setup lang="ts">
/**
 * Detailed calendar dialog (form B).
 *
 * The editor area is the only place wide enough for a real time grid, so the
 * month view + due-date task list open here. The sidebar keeps a mini month
 * that only picks a day; both read `stores/calendar`, so they share one focus
 * date and can never disagree about which month is showing.
 *
 * `DsModal` already owns Esc, the focus trap, Teleport and `role="dialog"`.
 * This shell only widens the panel, makes the body a fill layout (so the two
 * columns scroll independently instead of scrolling the dialog), and falls
 * back to a full-screen sheet under 720 px.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DsModal } from '../ui';
import { useCalendarStore } from '../stores/calendar';
import { CALENDAR_EDITOR_VIEWS } from '../lib/calendar-prefs';
import { useI18n } from '../i18n';
import CalendarWorkspace from './calendar/CalendarWorkspace.vue';

const calendar = useCalendarStore();
const { t } = useI18n();

const open = computed({
  get: () => calendar.dialogOpen,
  set: (value: boolean) => (value ? calendar.openDialog() : calendar.closeDialog()),
});

const narrow = ref(false);
const width = computed(() => (narrow.value ? '100%' : 'min(94vw, 980px)'));

function measure() {
  narrow.value = window.innerWidth < 720;
}

onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
});
</script>

<template>
  <DsModal
    v-model="open"
    :width="width"
    :class="['calendar-dialog', { 'calendar-dialog--narrow': narrow }]"
  >
    <template #header>
      <div class="cal-dialog__head">
        <h2 class="cal-dialog__title">{{ t('calendar.title') }}</h2>
        <div class="cal-dialog__seg" role="group" :aria-label="t('calendar.title')">
          <button
            v-for="view in CALENDAR_EDITOR_VIEWS"
            :key="view"
            type="button"
            :class="{ 'is-active': calendar.view === view }"
            :aria-pressed="calendar.view === view"
            @click="calendar.setView(view)"
          >
            {{ t(`calendar.view.${view}`) }}
          </button>
        </div>
      </div>
    </template>

    <div class="cal-dialog__body">
      <CalendarWorkspace v-if="calendar.dialogOpen" :class="{ 'is-narrow': narrow }" />
    </div>
  </DsModal>
</template>

<style scoped>
.cal-dialog__head {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.cal-dialog__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.cal-dialog__seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: var(--fill-1);
}

.cal-dialog__seg button {
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-dialog__seg button:hover {
  color: var(--text);
}

.cal-dialog__seg button.is-active {
  background: var(--bg-pop);
  color: var(--text);
  box-shadow: var(--sh-1, 0 1px 2px rgba(0, 0, 0, 0.12));
}

.cal-dialog__body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* The panel is teleported to <body>, so the modal's own classes are reached
   from outside this component's scope. */
:global(.calendar-dialog) .ds-modal__panel {
  height: min(84vh, 640px);
}

:global(.calendar-dialog) .ds-modal__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

:global(.calendar-dialog--narrow) {
  padding: 0;
}

:global(.calendar-dialog--narrow) .ds-modal__panel {
  width: 100%;
  height: 100%;
  max-height: 100%;
  border: 0;
  border-radius: 0;
}
</style>
