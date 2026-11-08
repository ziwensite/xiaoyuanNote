<script setup lang="ts">
/**
 * S2 — one dock = activity bar (rail) + tab header + a single active pane.
 *
 * The two docks (left of `.content`, right of it) share this component. The
 * rail is the stable entry point: it stays when the body is collapsed, lists
 * the panes that can actually render right now, and carries the `+` (opens
 * App's existing pane list) plus the collapse handle. Tabs only appear when
 * more than one pane is renderable — with one pane the tab label would just
 * repeat the panel content.
 *
 * Order (for S3 drag) lives in `sidebarDock.panes`, not here; this component
 * only consumes the per-side slice it is given.
 */
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import {
  DEFAULT_DOCK_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  paneDef,
  type SidebarDockState,
} from '../../lib/sidebar-dock';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import Icon from '../Icons.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';

export interface SidebarDockPaneView {
  id: ImplementedSidebarPaneId;
  /** User asked for it (dock switch, tab.showOutline, session search). */
  visible: boolean;
  /** Current context can draw it (markdown / folder / autoGit / build). */
  available: boolean;
}

const props = defineProps<{
  side: 'left' | 'right';
  panes: readonly SidebarDockPaneView[];
  active: ImplementedSidebarPaneId | null;
  collapsed: boolean;
  /** Narrow-screen drawer: App's CSS owns the width/position. */
  overlay?: boolean;
  searchPrefill?: string;
  outlineLine: number;
}>();

const emit = defineEmits<{
  contextmenu: [ev: MouseEvent];
  closePane: [id: ImplementedSidebarPaneId];
  manage: [ev: MouseEvent];
  filterTag: [tag: string];
  outlineGoto: [line: number];
  openSettings: [section?: string];
  openQuickSwitcher: [];
}>();

const settings = useSettingsStore();
const { t } = useI18n();

/** Panes that may appear in the rail / tabs / body right now. */
const renderable = computed(() =>
  props.panes.filter((pane) => pane.visible && pane.available),
);

/** Stored choice when it can render, else the first renderable pane. */
const activeId = computed<ImplementedSidebarPaneId | null>(() => {
  if (props.active && renderable.value.some((pane) => pane.id === props.active)) {
    return props.active;
  }
  return renderable.value[0]?.id ?? null;
});

const showTabs = computed(() => renderable.value.length >= 2);
const showBody = computed(() => !!activeId.value && !props.collapsed);
// `showBody` guarantees this; the cast keeps the template free of `!`.
const bodyPaneId = computed(() => activeId.value as ImplementedSidebarPaneId);

function titleOf(id: ImplementedSidebarPaneId): string {
  const key = paneDef(id)?.titleKey;
  return key ? t(key) : id;
}

function iconOf(id: ImplementedSidebarPaneId): string {
  return paneDef(id)?.icon ?? 'file';
}

function select(id: ImplementedSidebarPaneId) {
  // `setActiveDockPane` also expands the dock — picking a pane from the rail
  // while collapsed is the expected "open that panel" gesture.
  settings.setActiveDockPane(props.side, id);
}

const collapseIcon = computed(() => {
  const pointsOut = !props.collapsed;
  if (props.side === 'left') return pointsOut ? 'chevron-left' : 'chevron-right';
  return pointsOut ? 'chevron-right' : 'chevron-left';
});

const storedWidth = computed(
  () => (settings.sidebarDock as SidebarDockState).width[props.side],
);

/** Agent chat needs real estate; only widen when the user has not chosen a
 *  wider-than-default width themselves. Never written back to the store. */
const dockWidth = computed(() => {
  if (props.collapsed) return SIDEBAR_RAIL_WIDTH;
  const base = storedWidth.value;
  return activeId.value === 'agent' && base <= DEFAULT_DOCK_WIDTH ? 472 : base;
});

const dockStyle = computed(() =>
  props.collapsed
    ? { width: `${SIDEBAR_RAIL_WIDTH}px`, flexBasis: `${SIDEBAR_RAIL_WIDTH}px` }
    : {
        width: `min(${dockWidth.value}px, 45vw)`,
        flexBasis: `min(${dockWidth.value}px, 45vw)`,
      },
);

function onSidebarResize(ev: MouseEvent) {
  if (props.collapsed) return;
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
      props.collapsed ? 'side-sidebar--collapsed' : '',
    ]"
    :style="props.overlay ? undefined : dockStyle"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div
      v-if="!props.collapsed && !props.overlay"
      class="side-sidebar__resize"
      :class="props.side === 'left' ? 'side-sidebar__resize--right' : 'side-sidebar__resize--left'"
      @mousedown="onSidebarResize"
    />

    <div class="dock-rail" role="toolbar" :aria-orientation="'vertical'">
      <button
        v-for="pane in renderable"
        :key="pane.id"
        type="button"
        class="dock-rail__btn"
        :class="{ 'dock-rail__btn--active': pane.id === activeId }"
        :title="titleOf(pane.id)"
        :aria-pressed="pane.id === activeId"
        @click="select(pane.id)"
      >
        <Icon :name="iconOf(pane.id)" :size="16" />
      </button>
      <div class="dock-rail__spacer" />
      <button
        type="button"
        class="dock-rail__btn"
        :title="t('menubar.panes')"
        @click="emit('manage', $event)"
      >
        <Icon name="plus" :size="14" />
      </button>
      <button
        type="button"
        class="dock-rail__btn"
        :title="t(props.collapsed ? 'sidebarDock.expand' : 'sidebarDock.collapse')"
        :aria-expanded="!props.collapsed"
        @click="settings.toggleDockCollapsed(props.side)"
      >
        <Icon :name="collapseIcon" :size="14" />
      </button>
    </div>

    <div v-if="showBody" class="dock-main">
      <div v-if="showTabs" class="dock-tabs" role="tablist">
        <button
          v-for="pane in renderable"
          :key="pane.id"
          type="button"
          class="dock-tab"
          :class="{ 'dock-tab--active': pane.id === activeId }"
          role="tab"
          :aria-selected="pane.id === activeId"
          :title="titleOf(pane.id)"
          @click="select(pane.id)"
        >
          {{ titleOf(pane.id) }}
        </button>
      </div>
      <div :data-rs-pane="activeId" class="rs-pane-host">
        <SidebarPaneBody
          :id="bodyPaneId"
          :search-prefill="props.searchPrefill"
          :outline-line="props.outlineLine"
          @close="emit('closePane', bodyPaneId)"
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
  flex-direction: row;
  min-width: 240px;
  background: var(--bg);
}
.side-sidebar--left {
  border-right: var(--bd-hair);
}
.side-sidebar--right {
  border-left: var(--bd-hair);
}
.side-sidebar--collapsed {
  min-width: 0;
}

/* Activity bar — 32px, always present, one icon per renderable pane. */
.dock-rail {
  flex: 0 0 32px;
  width: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
  border-right: var(--bd-hair);
  background: var(--bg);
}
.side-sidebar--right .dock-rail {
  border-right: 0;
  border-left: var(--bd-hair);
  order: 1;
}
.dock-rail__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.dock-rail__btn:hover {
  background: var(--fill-1);
  color: var(--text-2);
}
.dock-rail__btn--active {
  background: var(--accent-soft);
  color: var(--accent-text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.dock-rail__spacer {
  flex: 1 1 auto;
}

.dock-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Tab header — only with 2+ renderable panes (S4 adds overflow affordances). */
.dock-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 0 6px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: var(--bd-hair);
}
.dock-tabs::-webkit-scrollbar {
  display: none;
}
.dock-tab {
  flex: 0 0 auto;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 24px;
  white-space: nowrap;
  cursor: pointer;
}
.dock-tab:hover {
  background: var(--fill-1);
  color: var(--text);
}
.dock-tab--active {
  background: var(--fill-1);
  color: var(--text);
  font-weight: 540;
}

/* Drag handle for live-resize. Sits on the outer edge (away from the rail). */
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
/* Mouse affordance and an 8px touch trap. */
.app--narrow .side-sidebar__resize {
  display: none;
}

/* Body — exactly one pane, same sizing contract the stack used before. */
.rs-pane-host {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.rs-pane-host > :deep(*) {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.rs-pane-host :deep(.outline) {
  width: 100% !important;
  border-left: 0;
  border-right: 0;
}
.rs-pane-host :deep(.backlinks) {
  border-left: 0;
  border-right: 0;
}
.rs-pane-host :deep(.rel) {
  border-left: 0;
  border-right: 0;
}
</style>
