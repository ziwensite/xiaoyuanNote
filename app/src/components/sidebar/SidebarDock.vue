<script setup lang="ts">
/**
 * One dock COLUMN: a 36px header (the icon tab strip) plus the body, or the
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
import { computed, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
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
const { t } = useI18n();

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

const resizing = ref(false);

/** Keyboard: one step per press; the allocator clamps to 212–560. */
function nudge(dx: number) {
  const delta = props.side === 'right' ? -dx : dx;
  settings.setDockWidth(props.side, displayWidth.value + delta);
}

function onSidebarResize(ev: MouseEvent) {
  ev.preventDefault();
  resizing.value = true;
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
    resizing.value = false;
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
      :class="[
        props.side === 'left' ? 'side-sidebar__resize--right' : 'side-sidebar__resize--left',
        resizing ? 'side-sidebar__resize--active' : '',
      ]"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="t('rightSidebar.dragToResize')"
      @mousedown="onSidebarResize"
      @keydown.left.prevent="nudge(-8)"
      @keydown.right.prevent="nudge(8)"
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
/* The column divider is drawn ONCE, INSIDE the column, as an opaque hair.
 *
 * It used to be `border-right/left: var(--bd-hair)` on the `<aside>`. At 150%
 * display scaling that hair computes to 0.667px and sits exactly on the column
 * edge, where the neighbouring column's background paints over its outer half
 * in the header band — so the header's line read thinner than the body's, even
 * though one element drew both. An inset ::after is the column's own paint (no
 * sibling can clip it) and `--border` is opaque, so it composites identically
 * over the white header and the tinted pane body. */
.side-sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--hair-w);
  background: var(--border);
  pointer-events: none;
  z-index: 1;
}
.side-sidebar--left::after {
  right: 0;
}
.side-sidebar--right::after {
  left: 0;
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

/* Drag handle for live-resize. Sits on the outer edge.
 *
 * The 8px band is the HIT AREA ONLY and stays transparent: a translucent
 * fill on it read as two vertical lines (the band's own two hard edges, one
 * either side of the 1px column border). The affordance is a single 2px line
 * centred on that border, the same language as the editor's `.split-divider` —
 * so hover / drag / focus all light the SAME one line. */
.side-sidebar__resize {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
  outline: none;
}
.side-sidebar__resize::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: transparent;
  transition: background var(--dur-fast) var(--ease-out);
}
.side-sidebar__resize--right {
  right: -4px;
}
.side-sidebar__resize--right::after {
  right: 3px;
}
.side-sidebar__resize--left {
  left: -4px;
}
.side-sidebar__resize--left::after {
  left: 3px;
}
.side-sidebar__resize:hover::after,
.side-sidebar__resize:focus-visible::after,
.side-sidebar__resize--active::after {
  background: var(--accent-ring);
}
</style>
