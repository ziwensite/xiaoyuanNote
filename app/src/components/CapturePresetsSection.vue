<script setup lang="ts">
/**
 * P5 — capture presets editor.
 *
 * A preset is data only; the executor lives in `useCapture`. This component
 * edits the list and previews exactly what the executor would insert, so there
 * is no second implementation of the template rules to drift.
 */
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import {
  CAPTURE_PERIODS,
  CAPTURE_PLACEMENTS,
  CAPTURE_TARGETS,
  capturePreview,
  newCapturePreset,
  type CapturePlacement,
  type CapturePreset,
  type CaptureTarget,
} from '../lib/capture';

const settings = useSettingsStore();
const { t } = useI18n();

function add() {
  const preset = newCapturePreset(crypto.randomUUID(), t('capture.presetName'));
  settings.addCapture(preset);
}

function update(id: string, patch: Partial<CapturePreset>) {
  settings.updateCapture(id, patch);
}

function onTarget(preset: CapturePreset, value: string) {
  update(preset.id, { target: value as CaptureTarget });
}

function onPlacement(preset: CapturePreset, value: string) {
  update(preset.id, { placement: value as CapturePlacement });
}

function previewText(preset: CapturePreset): string {
  return capturePreview(preset, {
    date: new Date(),
    selection: 'selection',
    clipboard: 'clipboard',
    input: 'input',
  });
}
</script>

<template>
  <section class="capture-presets">
    <h3>{{ t('capture.presetsTitle') }}</h3>
    <p class="setting-hint">{{ t('capture.presetsHint') }}</p>

    <div v-for="preset in settings.captures" :key="preset.id" class="capture-presets__item">
      <div class="capture-presets__row">
        <input
          type="text"
          class="settings__field"
          :value="preset.name"
          :placeholder="t('capture.presetName')"
          @input="update(preset.id, { name: ($event.target as HTMLInputElement).value })"
        />
        <button class="kb-btn" @click="settings.removeCapture(preset.id)">
          {{ t('capture.presetRemove') }}
        </button>
      </div>

      <div class="capture-presets__row">
        <select :value="preset.target" @change="onTarget(preset, ($event.target as HTMLSelectElement).value)">
          <option v-for="target in CAPTURE_TARGETS" :key="target" :value="target">{{ target }}</option>
        </select>
        <select v-if="preset.target === 'periodic'" :value="preset.period" @change="update(preset.id, { period: ($event.target as HTMLSelectElement).value as CapturePreset['period'] })">
          <option v-for="period in CAPTURE_PERIODS" :key="period" :value="period">{{ period }}</option>
        </select>
        <input
          v-if="preset.target !== 'periodic'"
          type="text"
          class="settings__field"
          :value="preset.path"
          :placeholder="preset.target === 'folder' ? 'Inbox' : 'Inbox.md'"
          @input="update(preset.id, { path: ($event.target as HTMLInputElement).value })"
        />
        <input
          v-if="preset.target === 'folder'"
          type="text"
          class="settings__field"
          :value="preset.fileName"
          placeholder="YYYY-MM-DD.md"
          @input="update(preset.id, { fileName: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <div class="capture-presets__row">
        <select :value="preset.placement" @change="onPlacement(preset, ($event.target as HTMLSelectElement).value)">
          <option v-for="placement in CAPTURE_PLACEMENTS" :key="placement" :value="placement">{{ placement }}</option>
        </select>
        <input
          v-if="preset.placement === 'heading'"
          type="text"
          class="settings__field"
          :value="preset.heading"
          placeholder="## 任务"
          @input="update(preset.id, { heading: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <textarea
        class="settings__field capture-presets__template"
        :value="preset.template"
        rows="2"
        @input="update(preset.id, { template: ($event.target as HTMLInputElement).value })"
      />

      <div class="capture-presets__row capture-presets__flags">
        <label>
          <input type="checkbox" :checked="preset.autoCreated" @change="update(preset.id, { autoCreated: !preset.autoCreated })" />
          ➕
        </label>
        <label>
          <input type="checkbox" :checked="preset.autoDue" @change="update(preset.id, { autoDue: !preset.autoDue })" />
          📅
        </label>
        <label>
          <input type="checkbox" :checked="preset.openAfter" @change="update(preset.id, { openAfter: !preset.openAfter })" />
          {{ t('capture.presetOpenAfter') }}
        </label>
      </div>

      <pre class="capture-presets__preview">{{ previewText(preset) }}</pre>
    </div>

    <button class="kb-btn kb-btn--wide" @click="add">{{ t('capture.presetAdd') }}</button>
  </section>
</template>

<style scoped>
.capture-presets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.capture-presets__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.capture-presets__row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.capture-presets__row > .settings__field,
.capture-presets__row > select {
  flex: 1;
  min-width: 0;
}

.capture-presets__row > select {
  text-transform: capitalize;
}

.capture-presets__flags {
  flex-wrap: wrap;
}

.capture-presets__template {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-mono);
  resize: vertical;
}

.capture-presets__preview {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
