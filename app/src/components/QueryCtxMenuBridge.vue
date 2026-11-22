<script setup lang="ts">
/**
 * Bridge from the plain-TS CodeMirror query widget to the app's shared menu
 * surface. cm-live-blocks.ts dispatches `xiaoyuan-note:query-ctx` with an anchor point,
 * shared-style items and a pick callback; this component mounts ContextMenu.vue
 * so the "add column" / header menus read exactly like every other app menu.
 *
 * Also hosts ComponentCreateDialog: `xiaoyuan-note:new-component` (command palette /
 * editor toolbar) opens the new / import / copy picker instead of a prompt.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ContextMenu from './ContextMenu.vue';
import ComponentCreateDialog from './ComponentCreateDialog.vue';
import type { CtxActionId, CtxNode } from '../lib/context-menus';

interface QueryCtx {
  x: number;
  y: number;
  items: CtxNode[];
  onPick: (id: CtxActionId) => void;
}

const ctx = ref<QueryCtx | null>(null);
const dialogOpen = ref(false);

function onRequest(e: Event) {
  ctx.value = (e as CustomEvent).detail as QueryCtx;
}

function onPick(id: CtxActionId) {
  const current = ctx.value;
  ctx.value = null;
  current?.onPick(id);
}

function close() {
  ctx.value = null;
}

function onNewComponent() {
  dialogOpen.value = true;
}

onMounted(() => {
  window.addEventListener('xiaoyuan-note:query-ctx', onRequest as EventListener);
  window.addEventListener('xiaoyuan-note:new-component', onNewComponent);
});
onBeforeUnmount(() => {
  window.removeEventListener('xiaoyuan-note:query-ctx', onRequest as EventListener);
  window.removeEventListener('xiaoyuan-note:new-component', onNewComponent);
});
</script>

<template>
  <Teleport to="body">
    <ContextMenu
      v-if="ctx"
      :x="ctx.x"
      :y="ctx.y"
      :items="ctx.items"
      @pick="onPick"
      @close="close"
    />
  </Teleport>
  <ComponentCreateDialog :open="dialogOpen" @close="dialogOpen = false" />
</template>
