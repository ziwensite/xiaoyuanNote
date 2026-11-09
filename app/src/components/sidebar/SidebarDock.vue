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
  paneContext: [id: ImplementedSidebarPaneId, side: SidebarSide, x: number, y: number];
  tabContext: [id: ImplementedSidebarPaneId, side: SidebarSide, x: number, y: number];
  edgeContext: [side: SidebarSide, x: number, y: number];
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

/** Right-click inside a pane body. Panes that already own a menu (file tree,
 *  saved views) call stopPropagation, so this only fires on the chrome. */
function onPaneContext(ev: MouseEvent) {
  const el = ev.target as HTMLElement | null;
  const host = el?.closest<HTMLElement>('[data-rs-pane]');
  const id = host?.dataset.rsPane as ImplementedSidebarPaneId | undefined;
  if (!id) return;
  ev.preventDefault();
  ev.stopPropagation();
  emit('paneContext', id, props.side, ev.clientX, ev.clientY);
}

/** Right-click on the header's empty stretch: the pane-manager menu the `+`
 *  button already opens. Tab icons stop the event and show their own menu. */
function onHeaderContext(ev: MouseEvent) {
  const el = ev.target as HTMLElement | null;
  if (el?.closest('.dock-tab')) return;
  ev.preventDefault();
  ev.stopPropagation();
  emit('manage', ev);
}

/** Right-click on the resize handle / column edge. */
function onEdgeContext(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  emit('edgeContext', props.side, ev.clientX, ev.clientY);
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
      @contextmenu="onEdgeContext"
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
      @contextmenu="onHeaderContext"
    >
      <DockTabStrip
        :side="props.side"
        :groups="props.groups"
        @manage="emit('manage', $event)"
        @tab-context="(id, x, y) => emit('tabContext', id, props.side, x, y)"
      />
    </div>
    <DockTabStrip
      v-else
      :side="props.side"
      :groups="props.groups"
      :max-width="320"
      drawer
      @manage="emit('manage', $event)"
      @tab-context="(id, x, y) => emit('tabContext', id, props.side, x, y)"
    />

    <div
      v-for="(group, groupIndex) in props.groups"
      :key="groupIndex"
      class="dock-group"
      :data-dock-region="props.side"
      :data-dock-side="props.side"
      :data-dock-group="0"
      @contextmenu="onPaneContext"
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
  /* Both side columns are one continuous surface: the 36px header band and the
   * pane body below it share `--bg-sidebar`, which is also what the panes paint
   * themselves (`Sidebar.vue`). Panes that do not set a background of their own
   * (outline, backlinks, …) are transparent and therefore inherit this one, so
   * the column reads as a single sheet rather than a white strip above a tinted
   * panel. The middle column stays `--bg` (white) and is the only focus area. */
  background: var(--bg-sidebar);
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
/* Only the RIGHT column draws a divider. The left column's edge is left as a
 * surface step — `--bg-sidebar` against the editor's `--bg` — which already
 * reads as a boundary (1.11:1) without any line: the tint difference is what
 * makes the pane read as a pane, and a hairline on top of it was a SECOND
 * painter 1px from the 4px scrollbar pill, which is what looked like "two
 * borders" and a 1px overhang. Measured at 1x: with the hair, x291 is
 * #e2e2df (1.17 vs the pane, 1.30 vs the editor); without it, x291 is the
 * pane tint and the step to the editor is 1.11 — still a visible edge, one
 * pigment lighter, and no possible double line.
 *
 * Hover/keyboard still paints `.side-sidebar__resize::after` at the same x, so
 * the edge has unambiguous feedback while it is being dragged; that highlight
 * is the only line the left edge ever shows.
 *
 * The right column keeps its hair: it is not adjacent to a scrollbar, the user
 * reports no problem there, and it separates white from tint on that side. */
.side-sidebar--right::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--hair-w);
  background: var(--hairline);
  pointer-events: none;
  z-index: 1;
}
.side-sidebar--drop-host {
  background: var(--bg-2, var(--bg-sidebar));
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

/* Every scroller in this app — this column's panes, the editor, the right
 * column — takes the ONE bar from `styles/scrollbars.css`: 8px gutter, 4px
 * pill, 2px transparent border on each side. A column may not add its own
 * inset on top of that. A previous round did (`margin-right: var(--sp-1)` on
 * the left pane's scrollers) to pull the bar away from the divider; that moved
 * the pill 6px from the column edge while the editor's stays 2px from it, i.e.
 * the two columns no longer matched. The 2px clearance is already the pill's
 * own transparent border, so nothing else is needed here. */

/* Drag handle for live-resize. Sits on the outer edge.
 *
 * The 8px band is the HIT AREA ONLY and stays transparent: a translucent
 * fill on it read as two vertical lines (the band's own two hard edges, one
 * either side of the 1px column border). The affordance is a single hairline,
 * the same language as the editor's `.split-divider` — so hover / drag / focus
 * all light the SAME one line.
 *
 * The line lives entirely INSIDE the column (`right/left: 4px` pins it to the
 * inner edge of this 8px band, which overhangs the border by 4px a side).
 * Measured at 150% scaling (dpr 1.5): while it straddled the edge, its outer
 * 1 CSS px fell inside `.main-col`, and the editor header there is
 * `position: relative; z-index: 20` with an opaque `--bg` — above this
 * handle's z-index 10 in the root stacking context — so the header band showed
 * 1 physical pixel of accent and the body band below it showed 3.
 *
 * It is `--hair-w` wide, not 2px: the highlight REPLACES the static
 * `.side-sidebar::after` hair at exactly the same x, it does not widen the
 * boundary. A 2px highlight covered the 1px hair plus one extra pixel inside
 * the column, which read as the border thickening / sticking out on hover. */
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
  width: var(--hair-w);
  background: transparent;
  transition: background var(--dur-fast) var(--ease-out);
}
.side-sidebar__resize--right {
  right: -4px;
}
.side-sidebar__resize--right::after {
  right: 4px;
}
.side-sidebar__resize--left {
  left: -4px;
}
.side-sidebar__resize--left::after {
  left: 4px;
}
.side-sidebar__resize:hover::after,
.side-sidebar__resize:focus-visible::after,
.side-sidebar__resize--active::after {
  /* Opaque, not the translucent --accent-ring: the line crosses the white
   * header band and the tinted pane body, and a 45% accent composited over two
   * different backdrops reads as two different weights. Mixing the accent with
   * --bg up front gives one constant colour for the whole column. */
  background: color-mix(in srgb, var(--accent) 45%, var(--bg));
}
</style>
