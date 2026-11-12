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
  paneDef,
  paneGroup,
  isMovablePane,
} from '../../lib/sidebar-dock';
import { dockDrag } from '../../lib/dock-drag';
import { dragWindowFromChrome, toggleMaximizeFromChrome } from '../../lib/window-drag';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import DockTabStrip from './DockTabStrip.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';
import Icon from '../Icons.vue';

const props = defineProps<{
  side: SidebarSide;
  groups: readonly DockGroupView[];
  /** Narrow-screen drawer: App's CSS owns the width/position. */
  overlay?: boolean;
  /** Folded column: only the 32px icon rail is drawn, no header/body. */
  collapsed?: boolean;
  /** Displayed column width (already clamped by `shellColumnWidths`). */
  width?: number;
  /** macOS traffic-light inset on the leftmost visible column's header. */
  trafficInset?: number;
  outlineLine: number;
}>();

const emit = defineEmits<{
  manage: [ev: MouseEvent];
  filterTag: [tag: string];
  outlineGoto: [line: number];
  openSettings: [section?: string];
  openQuickSwitcher: [];
  paneContext: [id: ImplementedSidebarPaneId, side: SidebarSide, x: number, y: number, group: number];
  tabContext: [id: ImplementedSidebarPaneId, side: SidebarSide, x: number, y: number, group: number];
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

/** Folded rail: every renderable pane across both regions, in dock order. */
const railTabs = computed(() =>
  props.groups.flatMap((group) => {
    const active = activeOf(group);
    return tabsOf(group).map(({ pane }) => {
      const def = paneDef(pane.id);
      return {
        id: pane.id,
        active: pane.id === active,
        title: def?.titleKey ? t(def.titleKey) : pane.id,
        icon: def?.icon ?? 'file',
      };
    });
  }),
);

/** macOS traffic lights sit over the left column; when it is folded they sit
 *  over the rail, so the icons start below them. */
const railStyle = computed(() =>
  props.side === 'left' && props.trafficInset
    ? { paddingTop: `${props.trafficInset}px` }
    : undefined,
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
/** Stage 2 — the `files` region is shell chrome: no splitter, no resize. */
function isLockedRegion(index: number): boolean {
  return !!props.groups[index]?.panes.some((pane) => pane.id === 'files');
}

/** Relative weight → flex share. Absent height = one equal share. */
function groupStyle(group: DockGroupView) {
  return { flex: `${group.height ?? 1} 1 0%` };
}

/** Drag a region separator. The first left-side separator sits below `files`,
 *  which cannot be resized, so in that case we resize the LOWER region. */
function onRegionResize(ev: MouseEvent, groupIndex: number) {
  ev.preventDefault();
  const upperLocked = isLockedRegion(groupIndex - 1);
  const targetIndex = upperLocked ? groupIndex : groupIndex - 1;
  const startWeight = props.groups[targetIndex]?.height ?? 1;
  const host = (ev.currentTarget as HTMLElement).parentElement;
  const regionEl = host?.querySelectorAll<HTMLElement>('.dock-group')[targetIndex];
  const startHeight = regionEl?.getBoundingClientRect().height ?? 0;
  if (!startHeight) return;
  const startY = ev.clientY;
  const onMove = (m: MouseEvent) => {
    const dy = m.clientY - startY;
    const nextPx = Math.max(60, startHeight + (upperLocked ? -dy : dy));
    settings.setDockRegionHeight(props.side, targetIndex, startWeight * (nextPx / startHeight));
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onPaneContext(ev: MouseEvent) {
  const el = ev.target as HTMLElement | null;
  const host = el?.closest<HTMLElement>('[data-rs-pane]');
  const id = host?.dataset.rsPane as ImplementedSidebarPaneId | undefined;
  if (!id) return;
  const region = el?.closest<HTMLElement>('[data-dock-region]');
  const group = Number(region?.dataset.dockGroup ?? 0);
  ev.preventDefault();
  ev.stopPropagation();
  emit('paneContext', id, props.side, ev.clientX, ev.clientY, group);
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

/** Whether this column should show the split drop zone right now. True only
 *  while a tab from THIS side is being dragged AND that tab's region actually
 *  has a second pane to peel off (the old `canSplitRegion` guard). So a
 *  single-pane region never advertises a dead drop. */
const splitHighlight = computed<boolean>(() => {
  if (!dockDrag.over?.split || dockDrag.over.side !== props.side) return false;
  const id = dockDrag.id;
  if (!id || !isMovablePane(id)) return false;
  const loc = paneGroup(settings.sidebarDock, id);
  if (!loc || loc.side !== props.side) return false;
  const group = settings.sidebarDock.groups[props.side]?.[loc.group];
  return !!group && group.panes.length > 1;
});
</script>

<template>
  <aside
    class="side-sidebar"
    :class="[
      `side-sidebar--${props.side}`,
      props.overlay ? 'side-sidebar--overlay' : '',
      isDropHost ? 'side-sidebar--drop-host' : '',
      splitHighlight ? 'side-sidebar--split' : '',
    ]"
    :data-dock-side="props.side"
    :style="dockStyle"
  >
    <!-- Folded: a 32px icon rail. Every reachable pane and `+` stay one click
         away, so collapsing never strands a panel. -->
    <div
      v-if="props.collapsed && !props.overlay"
      class="side-rail"
      :style="railStyle"
      @mousedown.capture="dragWindowFromChrome($event)"
      @dblclick="toggleMaximizeFromChrome($event)"
      @contextmenu="onHeaderContext"
    >
      <button
        v-for="tab in railTabs"
        :key="tab.id"
        type="button"
        class="side-rail__btn"
        :class="{ 'side-rail__btn--active': tab.active }"
        :title="tab.title"
        :aria-label="t('sidebarDock.openPanel', { name: tab.title })"
        @click="settings.setActiveDockPane(props.side, tab.id)"
        @contextmenu.prevent.stop="emit('tabContext', tab.id, props.side, $event.clientX, $event.clientY, 0)"
      >
        <Icon :name="tab.icon" :size="16" />
      </button>
      <span class="side-rail__spacer" />
      <button
        type="button"
        class="side-rail__btn side-rail__btn--add"
        :title="t('sidebarDock.addPanel')"
        :aria-label="t('sidebarDock.addPanel')"
        @click="emit('manage', $event)"
        @contextmenu.prevent.stop="emit('manage', $event)"
      >
        <Icon name="plus" :size="14" />
      </button>
    </div>

    <template v-else>
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
          :region-index="0"
          @manage="emit('manage', $event)"
          @tab-context="(id, x, y, region) => emit('tabContext', id, props.side, x, y, region)"
        />
      </div>
      <DockTabStrip
        v-else
        :side="props.side"
        :groups="props.groups"
        :max-width="320"
        drawer
        @manage="emit('manage', $event)"
        @tab-context="(id, x, y, region) => emit('tabContext', id, props.side, x, y, region)"
      />

      <template v-for="(group, groupIndex) in props.groups" :key="groupIndex">
        <div
          v-if="groupIndex > 0 && !props.overlay"
          class="dock-splitter"
          role="separator"
          aria-orientation="horizontal"
          :aria-label="t('rightSidebar.dragToResize')"
          @mousedown="onRegionResize($event, groupIndex)"
        />
        <div
          class="dock-group"
          :style="groupStyle(group)"
          :data-dock-region="props.side"
          :data-dock-side="props.side"
          :data-dock-group="groupIndex"
          @contextmenu="onPaneContext"
        >
          <div v-if="groupIndex > 0 && !props.overlay" class="dock-group__strip">
            <DockTabStrip
              :side="props.side"
              :groups="props.groups"
              :region-index="groupIndex"
              @manage="emit('manage', $event)"
              @tab-context="(id, x, y, region) => emit('tabContext', id, props.side, x, y, region)"
            />
          </div>
          <div v-if="activeOf(group)" class="rs-pane-host" :data-rs-pane="activeOf(group)">
            <SidebarPaneBody
              :id="activeOf(group) as ImplementedSidebarPaneId"
              :outline-line="props.outlineLine"
              @filter-tag="(tag: string) => emit('filterTag', tag)"
              @outline-goto="(line: number) => emit('outlineGoto', line)"
              @open-settings="(section?: string) => emit('openSettings', section)"
              @open-quick-switcher="emit('openQuickSwitcher')"
            />
          </div>
        </div>
      </template>
    </template>
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

/* Drag-to-split affordance: while a tab hovers a column (anywhere but its tab
 *  strip), the whole column highlights — dropping there peels the tab into a new
 *  region at the column's foot. This is the large, easy target that replaced the
 *  old tiny dashed zone. */
.side-sidebar--split {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: var(--accent-soft);
}

/* Folded column: a full-height 32px icon rail. Same surface as the open
 * column, so folding reads as "the panel shrank", not "a new toolbar". */
.side-rail {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
.side-rail::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.side-rail__spacer {
  flex: 1 1 auto;
}
.side-rail__btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-sm, 5px);
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
}
.side-rail__btn:hover {
  background: var(--bg-hover);
  color: var(--fg-1);
}
.side-rail__btn--active {
  background: var(--bg-active, var(--bg-hover));
  color: var(--fg-1);
}
.side-rail__btn--add {
  color: var(--fg-3);
}

/* One stacked region. Stage 1 renders exactly one; stage 2 stacks several.
   The inline `flex` from groupStyle() overrides this default with the stored
   relative weight. */
.dock-group {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dock-group + .dock-group {
  border-top: var(--bd-hair);
}
/* Stage 2: 1px separator with a 9px hit area, like the column edge. */
.dock-splitter {
  flex: 0 0 var(--hair-w);
  height: var(--hair-w);
  position: relative;
  z-index: 2;
  background: var(--hairline);
  cursor: ns-resize;
}
.dock-splitter::before {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.dock-splitter:hover::after,
.dock-splitter:active::after {
  content: '';
  position: absolute;
  inset: -1px 0;
  background: var(--accent);
}
/* Regions below the first carry their own strip, aligned with the header. */
.dock-group__strip {
  flex: 0 0 var(--header-h);
  height: var(--header-h);
  min-width: 0;
  display: flex;
  border-bottom: var(--bd-hair);
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
