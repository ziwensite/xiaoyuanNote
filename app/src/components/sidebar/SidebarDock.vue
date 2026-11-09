<script setup lang="ts">
/**
 * Stage 1 — the dock body: one or more stacked regions, each with an ICON-ONLY
 * tab strip and one active pane.
 *
 * What changed from the activity-bar layout, and why:
 *
 *  - The 32px rail is gone. Panels start at the window edge; the strip on top
 *    of the body is the only switch surface.
 *  - Icons only. Every tab carries `title` + `aria-label` (pane name) because
 *    a pure icon is meaningless to a screen reader. Long names never truncate
 *    (nothing is drawn), so the native tooltip is enough.
 *  - The `+` (pane list) is the LAST item of the strip. It replaces the old
 *    dock-level right-click menu, so there is exactly one entry point.
 *  - There is no collapse chevron: collapse is zero-width and reopens from the
 *    header's side toggle / ⌘B / menu / palette (see `sidebar-dock.ts`).
 *  - Tabs drag within a side and across the two sides via Pointer Events.
 *    HTML5 DnD is unusable here: Tauri's native file-drop swallows it.
 *  - `files` is pinned first on the left and never a drag source; drops before
 *    it are clamped to after it.
 *
 * Stage 2 will create more than one group per side; this component already
 * renders `groups[]` so that only the split UI + height persistence is new.
 */
import { computed, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import {
  DEFAULT_DOCK_WIDTH,
  PRIMARY_PANE_ID,
  isMovablePane,
  paneDef,
  type SidebarDockState,
  type SidebarSide,
} from '../../lib/sidebar-dock';
import { dockDrag } from '../../lib/dock-drag';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import Icon from '../Icons.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';

export interface SidebarDockPaneView {
  id: ImplementedSidebarPaneId;
  /** User asked for it (dock switch, tab.showOutline, session-only panes). */
  visible: boolean;
  /** Current context can draw it (markdown / folder / autoGit / build). */
  available: boolean;
}

export interface SidebarDockGroupView {
  /** Registry order of this region — tab order. */
  panes: readonly SidebarDockPaneView[];
  active: ImplementedSidebarPaneId | null;
}

const props = defineProps<{
  side: SidebarSide;
  groups: readonly SidebarDockGroupView[];
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
const { t } = useI18n();

const DRAG_THRESHOLD = 6;

/** Click that follows a drag must not switch the tab. */
const suppressClick = ref(false);

function tabsOf(group: SidebarDockGroupView) {
  return group.panes
    .map((pane, index) => ({ pane, index }))
    .filter((entry) => entry.pane.visible && entry.pane.available);
}

/** Stored choice when it can render, else the first renderable pane. */
function activeOf(group: SidebarDockGroupView): ImplementedSidebarPaneId | null {
  const renderable = tabsOf(group).map((entry) => entry.pane.id);
  if (group.active && renderable.includes(group.active)) return group.active;
  return renderable[0] ?? null;
}

function titleOf(id: ImplementedSidebarPaneId): string {
  const key = paneDef(id)?.titleKey;
  return key ? t(key) : id;
}

function iconOf(id: ImplementedSidebarPaneId): string {
  return paneDef(id)?.icon ?? 'file';
}

function select(id: ImplementedSidebarPaneId) {
  // `setActiveDockPane` also expands the dock; that keeps the header toggle
  // and ⌘B honest when a pane is picked programmatically.
  settings.setActiveDockPane(props.side, id);
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

/* ------------------------------------------------------------------ drag ---
 * Pointer Events only. `elementFromPoint` finds the region under the cursor;
 * the region carries `data-dock-side/group`, each tab carries its absolute
 * index in `group.panes`, so both the drop target and the insertion line are
 * derivable without DOM bookkeeping. */
function updateDropTarget(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const region = el?.closest<HTMLElement>('[data-dock-region]');
  const side = region?.dataset.dockSide;
  const group = Number(region?.dataset.dockGroup ?? -1);
  if (!region || (side !== 'left' && side !== 'right') || !Number.isFinite(group) || group < 0) {
    dockDrag.over = null;
    return;
  }
  const tab = el?.closest<HTMLElement>('[data-dock-tab]');
  let index = Number.POSITIVE_INFINITY;
  if (tab && tab.dataset.dockIndex != null) {
    const raw = Number(tab.dataset.dockIndex);
    if (Number.isFinite(raw) && raw >= 0) {
      const rect = tab.getBoundingClientRect();
      index = x > rect.left + rect.width / 2 ? raw + 1 : raw;
    }
  }
  dockDrag.over = { side, group, index: Number.isFinite(index) ? index : 9999 };
}

function onTabPointerDown(
  ev: PointerEvent,
  id: ImplementedSidebarPaneId,
) {
  if (ev.button !== 0 || !isMovablePane(id)) return;
  const startX = ev.clientX;
  const startY = ev.clientY;
  let dragging = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.body.classList.remove('dock-drag-active');
    dockDrag.id = null;
    dockDrag.over = null;
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      dockDrag.id = id;
      document.body.classList.add('dock-drag-active');
    }
    updateDropTarget(e.clientX, e.clientY);
  };
  const onUp = () => {
    const target = dockDrag.over;
    cleanup();
    if (!dragging) return;
    suppressClick.value = true;
    if (target) {
      settings.moveDockTab(id, {
        side: target.side,
        group: target.group,
        index: target.index,
      });
    }
    // Fall-through: the browser fires `click` after `pointerup`. Clear the
    // guard on the next task so that click is swallowed, nothing later.
    setTimeout(() => {
      suppressClick.value = false;
    }, 0);
  };
  const onCancel = () => cleanup();

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function onTabClick(id: ImplementedSidebarPaneId) {
  if (suppressClick.value) return;
  select(id);
}

/** Insertion line: position (in the rendered list) where the tab would land.
 *  `null` = this group is not the current target. */
function dropIndexFor(groupIndex: number, group: SidebarDockGroupView): number | null {
  const over = dockDrag.over;
  if (!over || over.side !== props.side || over.group !== groupIndex) return null;
  let insert = over.index;
  // `files` is pinned first: dropping "before files" lands after it.
  if (props.side === 'left' && group.panes[0]?.id === PRIMARY_PANE_ID) {
    insert = Math.max(insert, 1);
  }
  const tabs = tabsOf(group);
  for (let i = 0; i < tabs.length; i += 1) {
    if (tabs[i].index >= insert) return i;
  }
  return tabs.length;
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

    <div
      v-for="(group, groupIndex) in props.groups"
      :key="groupIndex"
      class="dock-group"
      :data-dock-region="props.side"
      :data-dock-side="props.side"
      :data-dock-group="groupIndex"
    >
      <div class="dock-strip" role="tablist">
        <template v-for="(entry, renderedIndex) in tabsOf(group)" :key="entry.pane.id">
          <span
            v-if="dropIndexFor(groupIndex, group) === renderedIndex"
            class="dock-strip__drop"
            aria-hidden="true"
          />
          <button
            type="button"
            class="dock-tab"
            :class="{
              'dock-tab--active': entry.pane.id === activeOf(group),
              'dock-tab--dragging': dockDrag.id === entry.pane.id,
            }"
            role="tab"
            :aria-selected="entry.pane.id === activeOf(group)"
            :aria-label="t('sidebarDock.openPanel', { name: titleOf(entry.pane.id) })"
            :title="titleOf(entry.pane.id)"
            :data-dock-tab="entry.pane.id"
            :data-dock-index="entry.index"
            @pointerdown="onTabPointerDown($event, entry.pane.id)"
            @click="onTabClick(entry.pane.id)"
          >
            <Icon :name="iconOf(entry.pane.id)" :size="16" />
          </button>
        </template>
        <span
          v-if="dropIndexFor(groupIndex, group) === tabsOf(group).length"
          class="dock-strip__drop"
          aria-hidden="true"
        />
        <div class="dock-strip__spacer" />
        <!-- The only "open a panel" entry point: it replaced the right-click
             menu that used to live on the whole dock. -->
        <button
          type="button"
          class="dock-tab dock-tab--add"
          :title="t('sidebarDock.addPanel')"
          :aria-label="t('sidebarDock.addPanel')"
          @click="emit('manage', $event)"
        >
          <Icon name="plus" :size="14" />
        </button>
      </div>

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

/* Icon strip — 32px, replaces the old 32px rail but sits on top of the
 * panel instead of beside it. Empty space still accepts drops. */
.dock-strip {
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  overflow: hidden;
  border-bottom: var(--bd-hair);
}
.dock-strip__spacer {
  flex: 1 1 auto;
}
.dock-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  position: relative;
}
.dock-tab:hover {
  background: var(--fill-1);
  color: var(--text-2);
}
.dock-tab--active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.dock-tab--active::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  bottom: -3px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.dock-tab--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
.dock-tab--add {
  color: var(--text-3);
}
.dock-strip__drop {
  flex: 0 0 2px;
  align-self: stretch;
  margin: 4px 0;
  border-radius: 1px;
  background: var(--accent);
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

<style>
/* Body-level affordance while a tab is in flight; lives outside scoped CSS so
 * it can style the cursor over any pane body. */
body.dock-drag-active,
body.dock-drag-active * {
  cursor: grabbing !important;
  user-select: none;
}
</style>
