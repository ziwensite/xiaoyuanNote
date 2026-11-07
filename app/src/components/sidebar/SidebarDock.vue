<script setup lang="ts">
/**
 * S1 — one sidebar shell, mounted twice (left of `.content`, right of it).
 *
 * Lifted verbatim out of App.vue's two near-identical `<aside>` blocks; the
 * only per-side differences that remain are the ones that existed before:
 * root `side-sidebar--left|right`, the resize handle's inner-edge class, and
 * the sign of the resize delta. Everything else — splitter order, grip
 * reorder, pane heights — is side-agnostic and unchanged.
 *
 * `width` arrives pre-bumped (Agent gets 440 when the stored width is <= 260);
 * that rule stays in App.vue next to the pane-visibility computeds.
 */
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import RsSplitter from '../RsSplitter.vue';
import SidebarPaneBody from './SidebarPaneBody.vue';

const props = defineProps<{
  side: 'left' | 'right';
  panes: readonly { id: ImplementedSidebarPaneId }[];
  width: number;
  searchPrefill?: string;
  outlineLine: number;
}>();

const emit = defineEmits<{
  contextmenu: [ev: MouseEvent];
  closePane: [id: ImplementedSidebarPaneId];
  filterTag: [tag: string];
  outlineGoto: [line: number];
  openSettings: [section?: string];
}>();

const settings = useSettingsStore();
const { t } = useI18n();

const dockStyle = computed(() => ({
  width: `${props.width}px`,
  flexBasis: `${props.width}px`,
}));

// #131 — sidebar pane reordering via the ⋮⋮ grip.
//
// This used HTML5 drag-and-drop (`draggable` + dragstart/dragover/drop), but
// the Tauri webview ships with `dragDropEnabled: true` (the app needs the
// native OS file-drop for "drop a file to open it" + image drop), and that
// native handler swallows in-webview HTML5 DnD — so the grip silently did
// nothing. Pointer events are not intercepted, so we drive the reorder
// manually: pointerdown on the grip → track the pane under the cursor →
// pointerup commits the move. Works on mouse, trackpad and touch alike.
const draggingPaneId = ref<string | null>(null);
const dragOverPaneId = ref<string | null>(null);
function startPaneReorder(e: PointerEvent, id: string) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  draggingPaneId.value = id;
  dragOverPaneId.value = null;
  const paneUnder = (x: number, y: number): string | null => {
    const host = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
      '[data-rs-pane]',
    ) as HTMLElement | null;
    return host?.getAttribute('data-rs-pane') || null;
  };
  const onMove = (m: PointerEvent) => {
    const over = paneUnder(m.clientX, m.clientY);
    dragOverPaneId.value = over && over !== id ? over : null;
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const src = draggingPaneId.value;
    const tgt = dragOverPaneId.value;
    draggingPaneId.value = null;
    dragOverPaneId.value = null;
    if (!src || !tgt || src === tgt) return;
    // Index into the full order list (not just the visible subset) so the
    // reorder survives toggling pane visibility off + on.
    const order = [...(settings.rsPaneOrder || [])];
    const targetIdx = order.indexOf(tgt);
    if (targetIdx < 0) return;
    settings.moveRsPane(src, targetIdx);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// Per-pane height map → inline flex-basis. Panes without a stored height
// fall back to the CSS flex defaults (1× for read-only panes, 4× for
// Agent so chat keeps room when no splitter has been touched).
function paneStyle(id: string) {
  const panes = props.panes;
  // #294 — a pane's stored height outlives the stack it was measured in.
  // Drag the splitter while Outline shares the sidebar with Backlinks, then
  // close Backlinks, and Outline stays pinned to that old height with dead
  // space under it — and no splitter left to drag, because splitters only
  // exist *between* panes. A pane that owns the sidebar alone therefore
  // ignores the stored height and fills it, which is also the default
  // `.rs-pane-host { flex: 1 1 0 }` behaviour before any drag.
  if (panes.length < 2) return {};
  // A stack nobody has dragged keeps the stylesheet's proportional shares
  // (Agent asks for 4×) — only once a height has actually been pinned does
  // this take over the sizing.
  const stored = settings.rightSidebarPaneHeights;
  if (!panes.some((p) => (stored[p.id] ?? 0) > 0)) return {};
  // Then the bottom pane absorbs whatever the panes above leave over, so the
  // stack always reaches the bottom edge no matter how stale the stored
  // heights are or how much the window has been resized since.
  if (panes[panes.length - 1]?.id === id) return { flex: '1 1 auto', minHeight: '80px' };
  const h = stored[id];
  if (h && h > 0) {
    // `0 1` rather than `0 0`: heights are stored in pixels, so a window that
    // later got shorter must be able to squeeze them instead of pushing the
    // last pane off the bottom.
    return { flex: `0 1 ${h}px`, height: `${h}px`, minHeight: '80px' };
  }
  return {};
}

function onSidebarResize(ev: MouseEvent) {
  ev.preventDefault();
  const startX = ev.clientX;
  const startW = props.width;
  const onMove = (m: MouseEvent) => {
    const dx = m.clientX - startX;
    // Right sidebar: drag left = wider. Left sidebar: drag right = wider.
    const delta = props.side === 'right' ? -dx : dx;
    settings.setSideSidebarWidth(startW + delta);
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
    :class="`side-sidebar--${props.side}`"
    :style="dockStyle"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div
      class="side-sidebar__resize"
      :class="props.side === 'left' ? 'side-sidebar__resize--right' : 'side-sidebar__resize--left'"
      @mousedown="onSidebarResize"
    />
    <template v-for="(p, idx) in props.panes" :key="p.id">
      <RsSplitter v-if="idx > 0" :above="props.panes[idx - 1].id" :below="p.id" />
      <div
        :data-rs-pane="p.id"
        :class="[
          'rs-pane-host',
          `rs-pane-host--${p.id}`,
          draggingPaneId === p.id ? 'rs-pane-host--dragging' : '',
          dragOverPaneId === p.id ? 'rs-pane-host--drop-target' : '',
        ]"
        :style="paneStyle(p.id)"
      >
        <div
          class="rs-pane-grip"
          :title="t('rsPane.dragToReorder')"
          @pointerdown="startPaneReorder($event, p.id)"
        />
        <SidebarPaneBody
          :id="p.id"
          :search-prefill="props.searchPrefill"
          :outline-line="props.outlineLine"
          @close="emit('closePane', p.id)"
          @filter-tag="(tag: string) => emit('filterTag', tag)"
          @outline-goto="(line: number) => emit('outlineGoto', line)"
          @open-settings="(section?: string) => emit('openSettings', section)"
        />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.side-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 260px;
  flex: 0 0 260px;
  min-width: 240px;
  background: var(--bg);
}
.side-sidebar--left {
  border-right: var(--bd-hair);
}
.side-sidebar--right {
  border-left: var(--bd-hair);
}
/* Drag handle for live-resize. Sits on the inner edge of the sidebar
   (right edge of left sidebar, left edge of right sidebar) as a 5px
   hit zone. v4.0 — agent panel chat needs more width than read-only
   panes. */
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
/* The drag-to-resize handles are a mouse affordance and a 8px touch trap. */
.app--narrow .side-sidebar__resize {
  display: none;
}
/* v4.0.2 — each pane lives inside an .rs-pane-host wrapper so the
   <RsSplitter> can find adjacent panes via [data-rs-pane] and resize
   them. Direct children of .side-sidebar are now: the resize handle,
   .rs-pane-host wrappers, and .rs-splitter elements between them. */
.rs-pane-host {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}
/* Agent Panel needs vertical room — chat scrollback, tool-call cards,
   compose box. Give it 4× the share Outline/Backlinks/Tags/History get
   when they coexist (so Agent ≈ 50% of sidebar height with all 5 on
   AND no splitter has been touched yet). Once the user drags a
   splitter the inline style overrides this. */
.rs-pane-host--agent {
  flex: 4 1 0;
  min-height: 240px;
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
/* v4.3.0 issue #57b — drag grip for right-sidebar reordering. 5.0: no
   longer a strip that takes height; a six-dot handle floats over the top
   edge of the pane header, centred, and only appears while the pointer is
   over that pane. Only the grip starts a drag, so text selection inside
   the pane still works. */
.rs-pane-host {
  position: relative;
}
.rs-pane-grip {
  position: absolute;
  top: 1px;
  left: 50%;
  z-index: 3;
  width: 28px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: var(--r-xs);
  color: var(--text-3);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  /* #131 — pointer-driven reorder: stop the browser turning a vertical drag on
     the grip into a scroll/pan gesture so pointermove tracking stays clean. */
  touch-action: none;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
/* 3 × 2 dots, 2 px, on a 4 px pitch. */
.rs-pane-grip::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 8px;
  transform: translate(-50%, -50%);
  background-image: radial-gradient(circle, currentColor 0.9px, transparent 1.3px);
  background-size: 4px 4px;
  background-position: 0 0;
}
.rs-pane-host:hover > .rs-pane-grip,
.rs-pane-grip:focus-visible {
  opacity: 1;
}
.rs-pane-grip:hover {
  background: var(--fill-1);
  color: var(--text-2);
}
.rs-pane-grip:active {
  cursor: grabbing;
  background: var(--fill-2);
}
.rs-pane-host--dragging {
  opacity: 0.4;
}
.rs-pane-host--drop-target {
  outline: 0;
  box-shadow: inset 0 2px 0 var(--accent);
  background: var(--accent-soft);
}
/* Make sure the grip + content layout share vertical space cleanly. */
.rs-pane-host > .rs-pane-grip + :deep(*) {
  flex: 1 1 0;
  min-height: 0;
}
</style>
