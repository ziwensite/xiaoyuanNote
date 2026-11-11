<script setup lang="ts">
/**
 * One reusable right-click menu for the app chrome.
 *
 * Uses the shared `.ctx-menu` / `.ctx-item` surface from styles/menus.css, so
 * it reads exactly like the file-tree, tab and editor menus. Behaviour kept in
 * one place: screen-edge flip, Esc, click-outside, and arrow-key navigation.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CtxActionId, CtxNode } from '../lib/context-menus';
import { measureMenu, placeMenuFromPoint } from '../lib/menu-position';

const props = defineProps<{ x: number; y: number; items: CtxNode[]; label?: string }>();
const emit = defineEmits<{ (e: 'pick', id: CtxActionId): void; (e: 'close'): void }>();

const root = ref<HTMLElement | null>(null);
const left = ref(props.x);
const top = ref(props.y);
const maxHeight = ref<number | null>(null);
const maxWidth = ref<number | null>(null);

function buttons() {
  return Array.from(root.value?.querySelectorAll<HTMLButtonElement>('.ctx-item:not(:disabled)') ?? []);
}

function focusAt(index: number) {
  const list = buttons();
  if (!list.length) return;
  list[(index + list.length) % list.length].focus();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
    return;
  }
  const list = buttons();
  if (!list.length) return;
  const current = list.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusAt(current + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusAt(current - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusAt(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusAt(list.length - 1);
  }
}

function onPick(id: CtxActionId) {
  emit('pick', id);
}

function onDocMouseDown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) emit('close');
}

function onScroll(e: Event) {
  if (root.value && e.target instanceof Node && root.value.contains(e.target)) return;
  emit('close');
}

const onWindowClose = () => emit('close');

onMounted(async () => {
  await nextTick();
  const el = root.value;
  if (!el) return;
  // Flip, don't clip: the pointer stays the anchor, the panel moves.
  const placed = placeMenuFromPoint(props.x, props.y, measureMenu(el), { pad: 4 });
  left.value = placed.left;
  top.value = placed.top;
  if (placed.maxHeight !== undefined) maxHeight.value = placed.maxHeight;
  if (placed.maxWidth !== undefined) maxWidth.value = placed.maxWidth;
  focusAt(0);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('blur', onWindowClose);
  window.addEventListener('resize', onWindowClose);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('blur', onWindowClose);
  window.removeEventListener('resize', onWindowClose);
});
</script>

<template>
  <div
    ref="root"
    class="ctx-menu app-ctx"
    role="menu"
    :aria-label="label"
    :style="{
      left: `${left}px`,
      top: `${top}px`,
      maxHeight: maxHeight === null ? undefined : `${maxHeight}px`,
      maxWidth: maxWidth === null ? undefined : `${maxWidth}px`,
    }"
    @contextmenu.prevent
    @keydown="onKey"
  >
    <template v-for="(item, i) in items" :key="i">
      <div v-if="'sep' in item" class="ctx-sep" role="separator" />
      <button
        v-else
        type="button"
        class="ctx-item"
        :role="item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
        :aria-checked="item.checked === undefined ? undefined : item.checked"
        :disabled="item.disabled"
        @mousedown.prevent
        @click="onPick(item.id)"
      >
        <span class="ctx-item__check" aria-hidden="true">{{ item.checked ? '✓' : '' }}</span>
        <span class="ctx-item__label">{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.app-ctx {
  position: fixed;
  z-index: 3000;
  min-width: 200px;
  max-width: min(320px, 90vw);
  max-height: min(70vh, 520px);
  overflow-y: auto;
}

.ctx-item__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  margin: 0 -2px 0 -4px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.ctx-item__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
