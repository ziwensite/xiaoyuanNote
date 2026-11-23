<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { useCaptureDialogStore } from '../stores/capture-dialog';
import { useCaptureDestination } from '../composables/useCaptureDestination';
import CaptureInput from './CaptureInput.vue';

const { t } = useI18n();
const dialog = useCaptureDialogStore();
const destinationOf = useCaptureDestination();
const text = ref('');
const input = ref<InstanceType<typeof CaptureInput> | null>(null);

watch(
  () => dialog.request,
  (req) => {
    text.value = req?.initialValue ?? '';
    if (req) void nextTick(() => input.value?.focus());
  },
  { immediate: true },
);

const preset = computed(() => dialog.request?.preset);

const destination = computed(() => preset.value ? destinationOf(preset.value) : '');

const hint = computed(() => preset.value?.inputMethod === 'multi-line'
  ? t('capture.dialogHintMultiline')
  : t('capture.dialogHint'));

function cancel() {
  dialog.cancel();
}

function submit() {
  const value = text.value.trim();
  if (!value) return;
  dialog.submit(value);
}

onBeforeUnmount(() => {
  if (dialog.request) dialog.cancel();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog.request" class="capture-prompt__backdrop" @click.self="cancel">
      <div
        class="capture-prompt"
        role="dialog"
        aria-modal="true"
        :aria-label="t('capture.dialogTitle', { preset: preset?.name ?? '' })"
      >
        <div class="capture-prompt__head">
          <h4>{{ t('capture.dialogTitle', { preset: preset?.name ?? '' }) }}</h4>
          <button type="button" class="kb-btn" :title="t('capture.presetCancel')" @click="cancel">×</button>
        </div>
        <p class="capture-prompt__dest">{{ t('capture.dialogDestination', { destination }) }}</p>
        <div class="capture-prompt__body">
          <CaptureInput
            ref="input"
            v-model="text"
            :input-method="preset?.inputMethod ?? 'single-line'"
            :placeholder="dialog.request.placeholder || t('capture.inputPrompt')"
            @submit="submit"
            @cancel="cancel"
          />
        </div>
        <div class="capture-prompt__foot">
          <span class="capture-prompt__hint">{{ hint }}</span>
          <span class="capture-prompt__actions">
            <button type="button" class="kb-btn" @click="cancel">{{ t('capture.presetCancel') }}</button>
            <button type="button" class="kb-btn kb-btn--primary" @click="submit">{{ t('capture.presetSave') }}</button>
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.capture-prompt__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.capture-prompt {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

.capture-prompt__head,
.capture-prompt__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.capture-prompt__head {
  border-bottom: 1px solid var(--border);
}

.capture-prompt__head h4 {
  margin: 0;
  font-size: 14px;
}

.capture-prompt__dest {
  margin: 0;
  padding: 10px 16px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.capture-prompt__body {
  display: flex;
  height: 150px;
  padding: 8px 16px 12px;
}

.capture-prompt__foot {
  border-top: 1px solid var(--border);
}

.capture-prompt__hint {
  font-size: 11px;
  color: var(--text-faint);
}

.capture-prompt__actions {
  display: inline-flex;
  flex-shrink: 0;
  gap: 8px;
}
</style>
