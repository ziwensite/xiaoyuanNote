<script setup lang="ts">
/**
 * Shared textbox for capture: used by the standalone quick-capture window and
 * by the in-app capture prompt. It owns focus, IME safety and submit/cancel
 * keys; callers own the window chrome, destination labels and the actual write.
 */
import { computed, nextTick, ref } from 'vue';
import { captureInputKeyAction } from '../lib/capture-input';
import type { CaptureInputMethod } from '../lib/capture';

const props = withDefaults(defineProps<{
  modelValue: string;
  inputMethod?: CaptureInputMethod;
  placeholder?: string;
}>(), {
  inputMethod: 'single-line',
  placeholder: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [value: string];
  cancel: [];
}>();

const box = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);

const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
});

function focus() {
  void nextTick(() => box.value?.focus());
}

function onKeydown(event: KeyboardEvent) {
  const action = captureInputKeyAction(props.inputMethod, event, composing.value);
  if (action === 'ignore' || action === 'newline') return;
  event.preventDefault();
  if (action === 'cancel') emit('cancel');
  else emit('submit', props.modelValue);
}

defineExpose({ focus });
</script>

<template>
  <div class="capture-input">
    <textarea
      ref="box"
      v-model="text"
      class="capture-input__area"
      :placeholder="placeholder"
      rows="3"
      spellcheck="false"
      @keydown="onKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    ></textarea>
  </div>
</template>

<style scoped>
.capture-input {
  display: flex;
  flex: 1;
  min-height: 0;
}

.capture-input__area {
  flex: 1;
  width: 100%;
  min-height: 72px;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  line-height: 1.55;
  font-family: inherit;
}

.capture-input__area::placeholder {
  color: var(--text-faint, #b4b4b4);
}
</style>
