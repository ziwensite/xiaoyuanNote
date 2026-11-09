<script setup lang="ts">
/**
 * One dock COLUMN: a 52px header (the icon tab strip) plus the body, or the
 * floating drawer on a tablet/phone.
 *
 * In the three-column shell this `<aside>` is the column. Its width comes from
 * App (`shellColumnWidths`), and the header is its first child — so the strip
 * and the body below it are the same element's width by construction. There is
 * no second width number to keep in sync, and a live resize changes both at
 * once.
 *
 * The drawer (phone narrow / iPad portrait overlay) has no column header above
 * it, so it keeps the in-panel 32px strip.
 *
 * Tabs drag within a side and across the two sides via Pointer Events
 * (HTML5 DnD is unusable here: Tauri's native file-drop swallows it).
 * `files` is pinned first on the left and never a drag source; drops before
 * it are clamped to after it.
 */
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import {
  type DockGroupView,
  type SidebarDockState,
  type SidebarSide,
} from '../../lib/sidebar-dock';
import { dockDrag } from '../../lib/dock-drag';
import { dragWindowFromChrome, toggleMaximizeFromChrome } from '../../lib/window-drag';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import DockTabStrip from './DockTabStrip.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';

const props = defineProps<{
  side: SidebarSide;
  groups: readonly DockGroupView[];
  /** Narrow-screen drawer: App's CSS owns the width/position. */
  overlay?: boolean;
  /** Displayed column width (already clamped by `shellColumnWidths`). */
  width?: number;
  /** macOS traffic-light inset on the leftmost visible column's header. */
  trafficInset?: number;
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

/** App passes the allocated width; the stored value is only a fallback for
 *  tests/mounts that do not (e.g. a drawer never resizes). */
const displayWidth = computed(() => props.width ?? storedWidth.value);

const dockStyle = computed(() =>
  props.overlay
    ? undefined
    : {
        width: `${displayWidth.value}px`,
        flexBasis: `${displayWidth.value}px`,
      },
);

const headerStyle = computed(() =>
  props.trafficInset ? { paddingLeft: `${props.trafficInset}px` } : undefined,
);

const isDropHost = computed(
  () => !!dockDrag.id && dockDrag.over?.side === props.side,
);

function onSidebarResize(ev: MouseEvent) {
  ev.preventDefault();
  const startX = ev.clientX;
  // Start from the displayed (possibly window-clamped) width, so the first
  // pixel of the drag never jumps.
  const startW = displayWidth.value;
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

    <!-- Column header: belongs to this column, same `<aside>` width as the
         body. Drawer: no row above the floating panel, so it keeps the
         in-panel strip. -->
    <div
      v-if="!props.overlay"
      class="side-sidebar__header"
      :style="headerStyle"
      @mousedown.capture="dragWindowFromChrome($event)"
      @dblclick="toggleMaximizeFromChrome($event)"
    >
      <DockTabStrip
        :side="props.side"
        :groups="props.groups"
        @manage="emit('manage', $event)"
      />
    </div>
    <DockTabStrip
      v-else
      :side="props.side"
      :groups="props.groups"
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
  /* The three-column allocator can go below the stored 212 minimum on very
   * narrow windows; do not reintroduce a wider CSS floor here. */
  min-width: 0;
  background: var(--bg);
}
/* The column's own header, exactly as tall as the editor header next to it. */
.side-sidebar__header {
  flex: 0 0 var(--header-h);
  height: var(--header-h);
  min-width: 0;
  display: flex;
  align-items: center;
  border-bottom: var(--bd-hair);
  overflow: hidden;
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
