<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../i18n';
import { useSettingsStore } from '../stores/settings';

const props = defineProps<{
  /** Pane id immediately above the splitter — receives Δ+ when dragging down. */
  above: string;
  /** Pane id immediately below the splitter — receives Δ- when dragging down. */
  below: string;
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const dragging = ref(false);

function startDrag(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const aboveEl = document.querySelector<HTMLElement>(`[data-rs-pane="${props.above}"]`);
  const belowEl = document.querySelector<HTMLElement>(`[data-rs-pane="${props.below}"]`);
  if (!aboveEl || !belowEl) return;
  const startAboveH = aboveEl.getBoundingClientRect().height;
  const startBelowH = belowEl.getBoundingClientRect().height;
  document.body.classList.add('rs-splitter--dragging');
  dragging.value = true;

  function onMove(ev: MouseEvent) {
    const dy = ev.clientY - startY;
    // Clamp so neither pane shrinks below 80px.
    const min = 80;
    let newAbove = startAboveH + dy;
    let newBelow = startBelowH - dy;
    if (newAbove < min) {
      newAbove = min;
      newBelow = startAboveH + startBelowH - min;
    } else if (newBelow < min) {
      newBelow = min;
      newAbove = startAboveH + startBelowH - min;
    }
    settings.setRightSidebarPaneHeight(props.above, newAbove);
    settings.setRightSidebarPaneHeight(props.below, newBelow);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('rs-splitter--dragging');
    dragging.value = false;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
</script>

<template>
  <div
    class="rs-splitter"
    :class="{ 'rs-splitter--active': dragging }"
    :title="t('rightSidebar.dragToResize')"
    @mousedown="startDrag"
    @dblclick="settings.resetRightSidebarPaneHeights()"
  />
</template>

<style scoped>
/* Same drag-line language as the sidebar dock's middle splitter: 1px
   hairline, 9px transparent hit zone, one accent bar while hovering /
   dragging / dragging-by-class. Double-click still resets. */
.rs-splitter {
  flex: 0 0 var(--hair-w, 1px);
  height: var(--hair-w, 1px);
  position: relative;
  z-index: 5;
  cursor: row-resize;
  background: var(--hairline);
  outline: none;
}
.rs-splitter::before {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.rs-splitter:hover::after,
.rs-splitter:active::after,
.rs-splitter:focus-visible::after,
.rs-splitter--active::after {
  content: '';
  position: absolute;
  inset: -1px 0;
  background: var(--accent);
}
</style>
