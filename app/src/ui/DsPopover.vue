<script setup lang="ts">
import { ref, nextTick, watch, onBeforeUnmount } from 'vue';
import { measureMenu, placeMenuFromPoint } from '../lib/menu-position';

const props = withDefaults(
  defineProps<{
    align?: 'start' | 'end';
    /** Extra class for the teleported panel — lets a caller opt into a
     *  menu-style variant (e.g. tighter padding) without affecting other
     *  DsPopover users. */
    panelClass?: string;
  }>(),
  { align: 'start' },
);

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const popRef = ref<HTMLElement | null>(null);
const pos = ref<{ top: number; left: number; maxHeight?: number }>({ top: 0, left: 0 });

async function position() {
  const el = triggerRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  await nextTick();
  const pop = popRef.value;
  const measured = pop ? measureMenu(pop) : { width: r.width, height: 0 };
  const startX = props.align === 'end' ? r.right - measured.width : r.left;
  const placed = placeMenuFromPoint(startX, r.bottom, measured, { gap: 6 });
  pos.value = {
    top: placed.top,
    left: placed.left,
    ...(placed.maxHeight !== undefined ? { maxHeight: placed.maxHeight } : {}),
  };
}

async function toggle() {
  open.value = !open.value;
  if (open.value) await position();
}

function close() {
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    triggerRef.value?.focus();
  }
}

function onDocPointer(e: PointerEvent) {
  const t = e.target as Node;
  if (triggerRef.value?.contains(t) || popRef.value?.contains(t)) return;
  close();
}

watch(open, (v) => {
  if (v) {
    document.addEventListener('pointerdown', onDocPointer, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
});

defineExpose({ close });
</script>

<template>
  <span class="ds-popover">
    <span
      ref="triggerRef"
      class="ds-popover__trigger"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <slot name="trigger" :open="open" />
    </span>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popRef"
        :class="['ds-popover__panel', panelClass]"
        role="dialog"
        tabindex="-1"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, maxHeight: pos.maxHeight === undefined ? undefined : `${pos.maxHeight}px` }"
        @keydown="onKeydown"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.ds-popover {
  display: inline-flex;
}
.ds-popover__trigger {
  display: inline-flex;
  border-radius: var(--r-md);
}
.ds-popover__trigger:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
</style>

<style>
/* Teleported to <body>. The shared menu surface lives in styles/menus.css,
   but unlike .ctx-menu (which re-declares its own surface in a scoped block)
   this panel only had position/z-index here — so if the shared rule didn't
   cascade onto it, the popover lost its background/border/radius/shadow/
   animation while the right-click menus kept theirs. Declare the full surface
   here too (same tokens as menus.css) so the date picker always reads like the
   other pop-up menus. Specificity stays low (0,1,0); menus.css's :root:not(#_)
   rule still wins where it applies, this is the fallback. */
.ds-popover__panel {
  position: fixed;
  z-index: var(--z-pop);
  background: var(--bg-pop);
  color: var(--text);
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-pop);
  padding: var(--sp-1);
  font-family: var(--font-ui, inherit);
  font-size: 13px;
  line-height: 1.3;
  transform-origin: top left;
  animation: sm-menu-in var(--dur-fast) var(--ease-out);
}
.ds-popover__panel:focus-visible {
  outline: none;
}
</style>

