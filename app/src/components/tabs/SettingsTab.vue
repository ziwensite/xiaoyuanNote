<script setup lang="ts">
/**
 * Settings inside the editor area.
 *
 * The panel itself is shared with the modal variant; this shell only supplies
 * the tab's deep-link section and lets the panel render inline. No window-level
 * Esc/⌘F capture is registered for the tab (see `onSearchKeys`).
 */
import { computed } from 'vue';
import SettingsPanel from '../SettingsPanel.vue';
import { resolveTabInput } from '../../lib/editor-input';
import type { Tab } from '../../types';

const props = defineProps<{ tab: Tab }>();

const section = computed(() => {
  const input = resolveTabInput(props.tab);
  return input.kind === 'settings' ? input.args.section ?? null : null;
});
</script>

<template>
  <SettingsPanel variant="tab" :open="true" :initial-section="section" />
</template>
