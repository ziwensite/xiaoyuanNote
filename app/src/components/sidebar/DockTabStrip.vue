<script setup lang="ts">
/**
 * One side's ICON-ONLY tab strip: the header of its dock column, and the same
 * strip inside the tablet/phone drawer.
 *
 * In the three-column shell the strip is the first child of the column's
 * `<aside>`, so it is exactly as wide as the panel below it. It fills that
 * width (`width: 100%`); the column resizes live, the strip's ResizeObserver
 * reports the new width in the same frame, and `dockStripLayout` recomputes
 * `»` immediately. No window-level cap, no second width number to sync.
 *
 * The strip never compresses icons: tabs that do not fit move into a `»` list
 * (icon + name), so every pane stays reachable. `+` is always the last item.
 * Empty strip space is still a drag handle for the window; only the buttons
 * opt out (they are `<button>`s, which the chrome drag handler skips).
 *
 * Drag: Pointer Events only (HTML5 DnD is swallowed by Tauri's native file
 * drop). Window-level `pointermove` means a pointer crossing another column
 * never gets "eaten": focus only changes on a real click, and no
 * `setPointerCapture` is involved. Dropping on a non-dock target is defined as
 * a cancel — `over` stays null and nothing moves.
 *
 * Collapsed side: the caller unmounts the whole column, so the editor takes the
 * width; the side's toggle in the top chrome stays as the way back.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import {
  PRIMARY_PANE_ID,
  isMovablePane,
  paneDef,
  type DockGroupView,
  type SidebarSide,
} from '../../lib/sidebar-dock';
import { dockDrag } from '../../lib/dock-drag';
import { dockStripLayout } from '../../lib/dock-strip-fit';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import Icon from '../Icons.vue';

const props = defineProps<{
  side: SidebarSide;
  groups: readonly DockGroupView[];
  /** Stage 2: render only this region's tabs. One strip instance per region,
   *  so each keeps its own overflow menu, `+` and drop insertion line. */
  regionIndex?: number;
  /** Drawer only: the floating panel's width cap (320). Column mode fills. */
  maxWidth?: number;
  /** Drawer placement: a 32px band inside the panel instead of a column header. */
  drawer?: boolean;
}>();

const emit = defineEmits<{
  manage: [ev: MouseEvent];
  tabContext: [id: ImplementedSidebarPaneId, x: number, y: number, group: number];
}>();

const settings = useSettingsStore();
const { t } = useI18n();

const DRAG_THRESHOLD = 6;

interface RenderedTab {
  id: ImplementedSidebarPaneId;
  /** Region the tab belongs to. */
  group: number;
  /** Position inside that region's `panes` (drag index, not render index). */
  index: number;
  active: boolean;
}

function renderableOf(group: DockGroupView) {
  return group.panes
    .map((pane, index) => ({ pane, index }))
    .filter((entry) => entry.pane.visible && entry.pane.available);
}

function activeOf(group: DockGroupView): ImplementedSidebarPaneId | null {
  const renderable = renderableOf(group).map((entry) => entry.pane.id);
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

const tabs = computed<RenderedTab[]>(() => {
  const out: RenderedTab[] = [];
  props.groups.forEach((group, groupIndex) => {
    // Stage 2: one strip instance owns one region, but `props.groups` stays
    // the full array so `dropAt` can still resolve a global region index.
    if (props.regionIndex !== undefined && groupIndex !== props.regionIndex) return;
    const active = activeOf(group);
    for (const entry of renderableOf(group)) {
      out.push({
        id: entry.pane.id,
        group: groupIndex,
        index: entry.index,
        active: entry.pane.id === active,
      });
    }
  });
  return out;
});

/* ---------------------------------------------------------------- overflow --- */
const rootEl = ref<HTMLElement | null>(null);
const measured = ref(0);

const layout = computed(() => dockStripLayout(tabs.value.length, measured.value));
const visibleTabs = computed(() => tabs.value.slice(0, layout.value.visible));
const hiddenTabs = computed(() => tabs.value.slice(layout.value.visible));

/**
 * Column mode fills the header, which is the column width. A 100% width is a
 * definite width, so measuring → `»` → measuring cannot ratchet the count down
 * (the reason the old capped strip had to take a fixed width when overflowing).
 * The drawer keeps its content-sized 32px band and an optional 320px cap.
 */
const stripStyle = computed(() => ({
  width: props.drawer ? undefined : '100%',
  maxWidth: props.maxWidth ? `${props.maxWidth}px` : undefined,
}));

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    // `clientWidth` includes the strip's own padding, which `dockStripLayout`
    // budgets for (border-box is global). Column resize (including every frame
    // of a drag) therefore reflows `»` immediately.
    observer = new ResizeObserver(() => {
      measured.value = rootEl.value?.clientWidth ?? 0;
    });
    observer.observe(rootEl.value);
    measured.value = rootEl.value.clientWidth;
  }
  document.addEventListener('pointerdown', onDocPointerDown, true);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('pointerdown', onDocPointerDown, true);
});

/* ------------------------------------------------------------- `»` list --- */
const moreBtnRef = ref<HTMLElement | null>(null);
const moreMenuRef = ref<HTMLElement | null>(null);
const moreOpen = ref(false);
const moreStyle = ref<Record<string, string>>({});

function positionMore() {
  const rect = moreBtnRef.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 200;
  const vw = window.innerWidth;
  const left = Math.min(Math.max(rect.left, 8), vw - width - 8);
  const top = rect.bottom + 4;
  moreStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
}

function openMore() {
  moreOpen.value = true;
  positionMore();
  void nextTick(() => {
    moreMenuRef.value?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
  });
}

function closeMore(refocus = false) {
  moreOpen.value = false;
  if (refocus) moreBtnRef.value?.focus();
}

function toggleMore() {
  if (moreOpen.value) closeMore();
  else openMore();
}

function onMoreKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMore(true);
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.from(
    moreMenuRef.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
  );
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
  items[Math.min(Math.max(next, 0), items.length - 1)]?.focus();
}

function onDocPointerDown(e: PointerEvent) {
  if (!moreOpen.value) return;
  const target = e.target instanceof Node ? e.target : null;
  if (target && (moreBtnRef.value?.contains(target) || moreMenuRef.value?.contains(target))) return;
  closeMore();
}

function pick(id: ImplementedSidebarPaneId) {
  settings.setActiveDockPane(props.side, id);
  closeMore();
}

/* --------------------------------------------------------------- keyboard --- */
/** Arrow keys move between tabs; Enter/Space is the native button click. */
function onStripKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
  const buttons = Array.from(
    rootEl.value?.querySelectorAll<HTMLElement>('[data-dock-tab]') ?? [],
  );
  const i = buttons.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? buttons.length - 1
        : i + (e.key === 'ArrowRight' ? 1 : -1);
  buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
}

function select(id: ImplementedSidebarPaneId) {
  /** Also expands the dock, so the row toggle and ⌘B stay honest. */
  settings.setActiveDockPane(props.side, id);
}

/* ------------------------------------------------------------------ drag --- */
function updateDropTarget(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  // A drop on the dock's split zone peels the dragged pane into a new region.
  // Checked before the region hit-test because the zone sits at a column's
  // bottom, outside any `[data-dock-region]`.
  const splitZone = el?.closest<HTMLElement>('[data-dock-split-zone]');
  if (splitZone) {
    const side = splitZone.dataset.dockSplitZone;
    if (side === 'left' || side === 'right') {
      dockDrag.over = { side, group: 0, index: 0, split: true };
      return;
    }
  }
  const region = el?.closest<HTMLElement>('[data-dock-region]');
  const side = region?.dataset.dockSide;
  const group = Number(region?.dataset.dockGroup ?? -1);
  if (!region || (side !== 'left' && side !== 'right') || !Number.isFinite(group) || group < 0) {
    // Search box, window buttons, editor tabs: not a dock target = cancel.
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
  const tabGroup = Number(tab?.dataset.dockGroup ?? group);
  dockDrag.over = {
    side,
    group: Number.isFinite(tabGroup) && tabGroup >= 0 ? tabGroup : group,
    index: Number.isFinite(index) ? index : 9999,
  };
}

const suppressClick = ref(false);

function onTabPointerDown(ev: PointerEvent, id: ImplementedSidebarPaneId) {
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
    if (target?.split) {
      // Split: peel the pane into a new region. The drop zone only renders on
      // the pane's own side, so `target.side` is its source side.
      settings.splitDockRegionFromDrag(target.side, id);
    } else if (target) {
      settings.moveDockTab(id, { side: target.side, group: target.group, index: target.index });
    }
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

/** Rendered position of the insertion line, or null when this side is not the
 *  current target. Hidden tabs sit behind `»`, so the line never goes past the
 *  visible run. */
const dropAt = computed<number | null>(() => {
  const over = dockDrag.over;
  if (!over || over.side !== props.side) return null;
  // Stage 2: each strip draws the insertion line for its own region only.
  if (props.regionIndex !== undefined && over.group !== props.regionIndex) return null;
  let insert = over.index;
  const panes = props.groups[over.group]?.panes ?? [];
  // `files` is pinned first: dropping "before files" lands after it.
  if (props.side === 'left' && panes[0]?.id === PRIMARY_PANE_ID) insert = Math.max(insert, 1);
  for (let i = 0; i < visibleTabs.value.length; i += 1) {
    const tab = visibleTabs.value[i];
    if (tab.group !== over.group) continue;
    if (tab.index >= insert) return i;
  }
  if (over.group === props.groups.length - 1) return visibleTabs.value.length;
  return null;
});
</script>

<template>
  <div
    ref="rootEl"
    class="dock-strip"
    :class="[
      `dock-strip--${props.side}`,
      props.drawer ? 'dock-strip--drawer' : '',
      layout.overflow ? 'dock-strip--overflow' : '',
    ]"
    role="tablist"
    :aria-label="props.side === 'left' ? t('header.leftPanels') : t('header.rightPanels')"
    data-dock-region
    :data-dock-side="props.side"
    :data-dock-group="props.regionIndex ?? 0"
    :style="stripStyle"
    @keydown="onStripKeydown"
  >
    <template v-for="(tab, i) in visibleTabs" :key="tab.id">
      <span v-if="dropAt === i" class="dock-strip__drop" aria-hidden="true" />
      <button
        type="button"
        class="dock-tab"
        :class="{
          'dock-tab--active': tab.active,
          'dock-tab--dragging': dockDrag.id === tab.id,
        }"
        role="tab"
        :aria-selected="tab.active"
        :aria-label="t('sidebarDock.openPanel', { name: titleOf(tab.id) })"
        :title="titleOf(tab.id)"
        :data-dock-tab="tab.id"
        :data-dock-index="tab.index"
        :data-dock-group="tab.group"
        @pointerdown="onTabPointerDown($event, tab.id)"
        @click="onTabClick(tab.id)"
        @contextmenu.prevent.stop="emit('tabContext', tab.id, $event.clientX, $event.clientY, tab.group)"
      >
        <Icon :name="iconOf(tab.id)" :size="16" />
      </button>
    </template>
    <span v-if="dropAt === visibleTabs.length" class="dock-strip__drop" aria-hidden="true" />
    <span class="dock-strip__spacer" />
    <button
      v-if="layout.overflow"
      ref="moreBtnRef"
      type="button"
      class="dock-tab dock-tab--more"
      aria-haspopup="menu"
      :aria-expanded="moreOpen"
      :aria-label="t('sidebarDock.moreTabs')"
      :title="t('sidebarDock.moreTabs')"
      @click="toggleMore"
    >»</button>
    <button
      type="button"
      class="dock-tab dock-tab--add"
      :title="t('sidebarDock.addPanel')"
      :aria-label="t('sidebarDock.addPanel')"
      @click="emit('manage', $event)"
      @contextmenu.prevent.stop="emit('manage', $event)"
    >
      <Icon name="plus" :size="14" />
    </button>

    <Teleport to="body">
      <div
        v-if="moreOpen"
        ref="moreMenuRef"
        class="dock-more"
        role="menu"
        data-no-drag
        :style="moreStyle"
        @keydown="onMoreKey"
      >
        <button
          v-for="tab in hiddenTabs"
          :key="tab.id"
          type="button"
          class="dock-more__item"
          role="menuitemradio"
          :aria-checked="tab.active"
          :title="titleOf(tab.id)"
          @click="pick(tab.id)"
        >
          <Icon :name="iconOf(tab.id)" :size="14" />
          <span class="dock-more__name">{{ titleOf(tab.id) }}</span>
          <span v-if="tab.active" class="dock-more__check" aria-hidden="true">✓</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Column header: fills the header width, full header height. */
.dock-strip {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 0;
  height: 100%;
  padding: 0 4px;
  overflow: hidden;
}
/* Drawer (tablet/phone): the strip is the same 32px band the panels used to
 * have, because there is no header row above the drawer to merge it into. */
.dock-strip--drawer {
  flex: 0 0 32px;
  height: 32px;
  border-bottom: var(--bd-hair);
}
/* A drop between tabs is a 2px accent line; it must not shift the layout. */
.dock-strip__drop {
  flex: 0 0 2px;
  align-self: center;
  height: 18px;
  margin: 0;
  border-radius: 1px;
  background: var(--accent);
}
.dock-strip__spacer {
  flex: 1 1 auto;
  min-width: 0;
}
.dock-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  /* Same control size and highlight radius as the header's icon buttons and
   * the menu pills (`--ctl-size`); `DOCK_TAB_SIZE` in dock-strip-fit.ts is the
   * arithmetic mirror of this value — change both or the `»` math drifts. */
  width: var(--ctl-size);
  height: var(--ctl-size);
  padding: 0;
  border: 0;
  border-radius: var(--ctl-radius);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  position: relative;
}
.dock-tab:hover {
  background: var(--fill-1);
  color: var(--text-2);
}
.dock-tab:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.dock-tab--active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.dock-tab--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
.dock-tab--more {
  color: var(--text-3);
  font: 13px/1 var(--font-ui);
}
.dock-tab--add {
  color: var(--text-3);
}

/* `»` list — teleported so the top row's overflow cannot clip it. */
.dock-more {
  position: fixed;
  z-index: var(--z-pop);
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-pop);
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-pop);
  font-family: var(--font-ui);
  font-size: 12px;
}
.dock-more__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--ctl-text-h);
  padding: 4px 8px;
  border: 0;
  border-radius: var(--ctl-radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dock-more__item:hover,
.dock-more__item:focus-visible {
  outline: none;
  background: var(--bg-hover, var(--fill-1));
}
.dock-more__name {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dock-more__check {
  color: var(--accent);
}

/* Body-level affordance while a tab is in flight; lives outside scoped CSS so
 * it can style the cursor over any pane body. */
</style>

<style>
body.dock-drag-active,
body.dock-drag-active * {
  cursor: grabbing !important;
  user-select: none;
}
</style>
