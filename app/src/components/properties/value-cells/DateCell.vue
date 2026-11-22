<script setup lang="ts">
/** v4.6 F1 — date value cell. Renders the ISO date as a clickable trigger that
 *  opens the shared menu-styled date picker (DatePickerPopover). Emits an ISO
 *  date string. */
import { computed } from 'vue';
import DatePickerPopover from '../../DatePickerPopover.vue';

const props = defineProps<{ value: unknown }>();
const emit = defineEmits<{ update: [string] }>();

const current = computed<string>(() => {
  const v = props.value;
  return v == null ? '' : typeof v === 'string' ? v : String(v);
});

function onPick(iso: string) {
  if (iso !== current.value) emit('update', iso);
}
</script>

<template>
  <DatePickerPopover :iso="current" @pick="onPick">
    <template #trigger="{ toggle }">
      <span
        class="prop-value-trigger"
        :class="{ 'prop-value-trigger--empty': current === '' }"
        role="button"
        tabindex="0"
        @click="toggle"
        @keydown.enter.prevent="toggle"
        @keydown.space.prevent="toggle"
      >{{ current || '—' }}</span>
    </template>
  </DatePickerPopover>
</template>
