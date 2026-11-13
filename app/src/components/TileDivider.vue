<script setup lang="ts">
import { ref } from 'vue';
import { useTilesStore } from '../stores/tiles';
import type { SplitDirection } from '../types';

const props = defineProps<{
  branchId: string;
  direction: SplitDirection;
}>();

const tiles = useTilesStore();
const active = ref(false);

function onMouseDown(e: MouseEvent) {
  e.preventDefault();
  active.value = true;

  const startPos = props.direction === 'horizontal' ? e.clientX : e.clientY;
  const startSizes = (() => {
    const node = findBranch();
    return node ? [...node.sizes] as [number, number] : [50, 50] as [number, number];
  })();

  // Get the branch container dimensions
  const container = (e.target as HTMLElement).parentElement;
  const totalSize = container
    ? (props.direction === 'horizontal' ? container.clientWidth : container.clientHeight) - 1 // minus the 1px divider
    : 1000;

  function onMove(ev: MouseEvent) {
    const currentPos = props.direction === 'horizontal' ? ev.clientX : ev.clientY;
    const delta = currentPos - startPos;
    const deltaPercent = (delta / totalSize) * 100;
    const newSizes: [number, number] = [
      startSizes[0] + deltaPercent,
      startSizes[1] - deltaPercent,
    ];
    tiles.setSizes(props.branchId, newSizes);
  }

  function onUp() {
    active.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function findBranch() {
  function walk(node: any): any {
    if (node.id === props.branchId) return node;
    if (node.type === 'leaf') return null;
    return walk(node.children[0]) ?? walk(node.children[1]);
  }
  return walk(tiles.root);
}
</script>

<template>
  <div
    class="tile-divider"
    :class="[
      `tile-divider--${direction}`,
      { 'tile-divider--active': active }
    ]"
    @mousedown="onMouseDown"
  />
</template>

<style scoped>
/* Mirrors the sidebar dock's middle splitter: 1px hairline, 9px transparent
   hit zone, one accent bar on hover / drag / focus. --hit / --glow transpose
   the inset for the horizontal (row-splitting) variant. */
.tile-divider {
  --hit: 0 -4px;
  --glow: 0 -1px;
  flex: 0 0 var(--hair-w, 1px);
  position: relative;
  z-index: 2;
  background: var(--hairline);
  outline: none;
}
.tile-divider::before {
  content: '';
  position: absolute;
  inset: var(--hit);
}
.tile-divider:hover::after,
.tile-divider:active::after,
.tile-divider:focus-visible::after,
.tile-divider--active::after {
  content: '';
  position: absolute;
  inset: var(--glow);
  background: var(--accent);
}
.tile-divider--horizontal {
  cursor: col-resize;
}
.tile-divider--vertical {
  --hit: -4px 0;
  --glow: -1px 0;
  cursor: row-resize;
}
</style>
