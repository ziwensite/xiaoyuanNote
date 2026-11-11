<script setup lang="ts">
/**
 * 5.0 right-sidebar panel header (docs/v5-ui-spec.md, panel anatomy):
 * 36 px, section-label title on the left, 24 px icon buttons on the right.
 * Put extra buttons in the default slot (use `.rp-icon-btn` + <Icons>).
 *
 * No close button: panes are closed from their right-click menu (关闭面板)
 * and the whole column is folded from the same menu (收起侧栏).
 */
import '../../styles/panels.css';

withDefaults(
  defineProps<{
    /** S2 — the dock tab header carries the pane name now; panels leave this
     *  off so the two headers don't repeat the same label. */
    title?: string | null;
    /** Optional count shown next to the title in --text-3. */
    count?: number | string | null;
  }>(),
  { title: null, count: null },
);
</script>

<template>
  <header class="rp-head">
    <span v-if="title" class="rp-title">
      {{ title }}<span v-if="count !== null && count !== undefined && count !== ''" class="rp-title__count">{{ count }}</span>
    </span>
    <span v-else-if="count !== null && count !== undefined && count !== ''" class="rp-title rp-title--count-only">{{ count }}</span>
    <!-- Neither label nor count: an empty flex-grow spacer keeps the right-side
         action buttons on the right (the title used to do that job). -->
    <span v-else class="rp-title" aria-hidden="true" />
    <slot />
  </header>
</template>
