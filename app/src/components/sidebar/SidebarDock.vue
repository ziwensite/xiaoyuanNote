<script setup lang="ts">
/**
 * The dock body: one or more stacked regions, each with one active pane.
 *
 * Stage 1 — the 32px rail is gone and the icon tab strip moved OUT of the
 * panel. On desktop it is rendered by `DockTabStrip.vue` inside the editor
 * toolbar row (Toolbar.vue), above the panel it controls. What is left here is
 * the body plus the resize handle.
 *
 * The one exception is the drawer (phone narrow / iPad portrait overlay):
 * there is no header row above a floating drawer, so the drawer keeps the
 * in-panel strip. That also keeps the tablets' pane switching reachable.
 *
 * Tabs drag within a side and across the two sides via Pointer Events
 * (HTML5 DnD is unusable here: Tauri's native file-drop swallows it).
 * `files` is pinned first on the left and never a drag source; drops before
 * it are clamped to after it.
 *
 * Stage 2 will create more than one group per side; this component already
 * renders `groups[]`, and each drawer group gets its own strip.
 */
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import {
  DEFAULT_DOCK_WIDTH,
  type DockGroupView,
  type SidebarDockState,
  type SidebarSide,
} from '../../lib/sidebar-dock';
import { dockDrag } from '../../lib/dock-drag';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import DockTabStrip from './DockTabStrip.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';

const props = defineProps<{
  side: SidebarSide;
  groups: readonly DockGroupView[];
  /** Narrow-screen drawer: App's CSS owns the width/position. */
  overlay?: boolean;
  outlineLine: number;
}>();

const emit = defineEmits<{
  closePane: [id: ImplementedSidebarPaneId];
  manage: [ev: MouseEvent];
  filterTag: [tag: string];
  outlineGoto: [line: number];
  openSettings: [section?: string];
  openQuickSwitcher: [];
}>();

const settings = useSettingsStore();

function tabsOf(group: DockGroupView) {
  return group.panes
    .map((pane, index) => ({ pane, index }))
    .filter((entry) => entry.pane.visible && entry.pane.available);
}

/** Stored choice when it can render, else the first renderable pane. */
function activeOf(group: DockGroupView): ImplementedSidebarPaneId | null {
  const renderable = tabsOf(group).map((entry) => entry.pane.id);
  if (group.active && renderable.includes(group.active)) return group.active;
  return renderable[0] ?? null;
}

const storedWidth = computed(
  () => (settings.sidebarDock as SidebarDockState).width[props.side],
);

/** Agent chat needs real estate; only widen when the user has not chosen a
 *  wider-than-default width themselves. Never written back to the store. */
const dockWidth = computed(() => {
  const base = storedWidth.value;
  const active = props.groups[0] ? activeOf(props.groups[0]) : null;
  return active === 'agent' && base <= DEFAULT_DOCK_WIDTH ? 472 : base;
});

const dockStyle = computed(() =>
  props.overlay
    ? undefined
    : {
        width: `min(${dockWidth.value}px, 45vw)`,
        flexBasis: `min(${dockWidth.value}px, 45vw)`,
      },
);

const isDropHost = computed(
  () => !!dockDrag.id && dockDrag.over?.side === props.side,
);

function onSidebarResize(ev: MouseEvent) {
  ev.preventDefault();
  const startX = ev.clientX;
  const startW = dockWidth.value;
  const onMove = (m: MouseEvent) => {
    const dx = m.clientX - startX;
    // Right dock: drag left = wider. Left dock: drag right = wider.
    const delta = props.side === 'right' ? -dx : dx;
    settings.setDockWidth(props.side, startW + delta);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
</script>

<template>
  <aside
    class="side-sidebar"
    :class="[
      `side-sidebar--${props.side}`,
      props.overlay ? 'side-sidebar--overlay' : '',
      isDropHost ? 'side-sidebar--drop-host' : '',
    ]"
    :style="dockStyle"
  >
    <div
      v-if="!props.overlay"
      class="side-sidebar__resize"
      :class="props.side === 'left' ? 'side-sidebar__resize--right' : 'side-sidebar__resize--left'"
      @mousedown="onSidebarResize"
    />

    <!-- Desktop: the strip lives in the header row (Toolbar.vue). Drawer: there
         is no row above the floating panel, so it keeps the in-panel strip. -->
    <DockTabStrip
      v-if="props.overlay"
      :side="props.side"
      :groups="props.groups"
      :dock-width="320"
      :max-width="320"
      drawer
      @manage="emit('manage', $event)"
    />

    <div
      v-for="(group, groupIndex) in props.groups"
      :key="groupIndex"
      class="dock-group"
      :data-dock-region="props.side"
      :data-dock-side="props.side"
      :data-dock-group="0"
    >
      <div v-if="activeOf(group)" class="rs-pane-host" :data-rs-pane="activeOf(group)">
        <SidebarPaneBody
          :id="activeOf(group) as ImplementedSidebarPaneId"
          :outline-line="props.outlineLine"
          @close="emit('closePane', activeOf(group) as ImplementedSidebarPaneId)"
          @filter-tag="(tag: string) => emit('filterTag', tag)"
          @outline-goto="(line: number) => emit('outlineGoto', line)"
          @open-settings="(section?: string) => emit('openSettings', section)"
          @open-quick-switcher="emit('openQuickSwitcher')"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  background: var(--bg);
}
.side-sidebar--left {
  border-right: var(--bd-hair);
}
.side-sidebar--right {
  border-left: var(--bd-hair);
}
.side-sidebar--drop-host {
  background: var(--bg-2, var(--bg));
}

/* One stacked region. Stage 1 renders exactly one; stage 2 stacks several. */
.dock-group {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dock-group + .dock-group {
  border-top: var(--bd-hair);
}

.rs-pane-host {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Drag handle for live-resize. Sits on the outer edge. */
.side-sidebar__resize {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
}
.side-sidebar__resize--right {
  right: -4px;
}
.side-sidebar__resize--left {
  left: -4px;
}
.side-sidebar__resize:hover {
  background: var(--accent);
  opacity: 0.35;
}
</style>
