<script setup lang="ts">
/**
 * Calendar as an editor tab (desktop widths only).
 *
 * The tab's parameters are the source of truth when it opens; once mounted the
 * shared calendar store drives the workspace, so arrows / month shift / view
 * switches rewrite this tab's `input` instead of spawning another tab.
 *
 * Narrowness follows the tab's own width, never `window.innerWidth`: the same
 * window can show a wide pane and a narrow split pane at the same time.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CalendarWorkspace from '../calendar/CalendarWorkspace.vue';
import { useCalendarStore } from '../../stores/calendar';
import { useTabsStore } from '../../stores/tabs';
import { resolveTabInput, type CalendarTabArgs } from '../../lib/editor-input';
import type { Tab } from '../../types';

const NARROW_TAB_PX = 720;

const props = defineProps<{ tab: Tab }>();

const calendar = useCalendarStore();
const tabs = useTabsStore();

const root = ref<HTMLElement | null>(null);
const isNarrow = ref(false);
let observer: ResizeObserver | null = null;

const args = computed<CalendarTabArgs | null>(() => {
  const input = resolveTabInput(props.tab);
  return input.kind === 'calendar' ? input.args : null;
});

// Tab parameters -> shared store (mount, and when the tab is repointed).
watch(
  args,
  (next) => {
    if (!next) return;
    calendar.setFocusDate(next.date);
    if (calendar.view !== next.view) calendar.setView(next.view);
  },
  { immediate: true },
);

// Shared store -> tab parameters: navigation inside the workspace must update
// this tab in place (D1 — one calendar tab, parameters change).
watch([() => calendar.focusDate, () => calendar.view], ([date, view]) => {
  const current = args.value;
  if (!current || (current.date === date && current.view === view)) return;
  tabs.updateInput(props.tab.id, { date, view });
});

onMounted(() => {
  const el = root.value;
  if (!el) return;
  isNarrow.value = el.clientWidth < NARROW_TAB_PX;
  observer = new ResizeObserver((entries) => {
    isNarrow.value = (entries[0]?.contentRect.width ?? 0) < NARROW_TAB_PX;
  });
  observer.observe(el);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div ref="root" class="calendar-tab">
    <CalendarWorkspace :class="{ 'is-narrow': isNarrow }" />
  </div>
</template>

<style scoped>
.calendar-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--text);
}
</style>
