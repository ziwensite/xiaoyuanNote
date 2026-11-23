<script setup lang="ts">
/**
 * Capture presets editor. A preset is data only; the executor lives in
 * `useCapture`. The dialog edits a draft and only commits on Save, so the
 * command palette never sees a half-configured preset.
 */
import { computed, ref } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import {
  CAPTURE_DUE_OPTIONS,
  CAPTURE_INPUT_METHODS,
  CAPTURE_NEW_LINE_DIRECTIONS,
  CAPTURE_OPEN_DIRECTIONS,
  CAPTURE_OPEN_LOCATIONS,
  CAPTURE_OPEN_MODES,
  CAPTURE_PERIODS,
  CAPTURE_PLACEMENTS,
  CAPTURE_TARGETS,
  capturePreview,
  captureTargetRelativePath,
  newCapturePreset,
  type CaptureDueDateOption,
  type CaptureInputMethod,
  type CaptureNewLineDirection,
  type CaptureOpenDirection,
  type CaptureOpenLocation,
  type CaptureOpenMode,
  type CapturePreset,
  type CapturePlacement,
  type CaptureTarget,
} from '../lib/capture';
import type { PeriodKind } from '../lib/periodic-notes';

const settings = useSettingsStore();
const { t } = useI18n();
const draft = ref<CapturePreset | null>(null);

function add() {
  const preset = newCapturePreset(crypto.randomUUID(), t('capture.presetName'));
  settings.addCapture(preset);
  openEditor(preset);
}

function openEditor(preset: CapturePreset) {
  draft.value = { ...preset };
}

function save() {
  if (!draft.value) return;
  settings.updateCapture(draft.value.id, { ...draft.value });
  draft.value = null;
}

function update(preset: CapturePreset, patch: Partial<CapturePreset>) {
  settings.updateCapture(preset.id, patch);
}

function targetLabel(target: CaptureTarget): string {
  return t(`capture.target.${target}`);
}

function inputLabel(method: CaptureInputMethod): string {
  return t(`capture.input.${method}`);
}

function placementLabel(placement: CapturePlacement): string {
  return t(`capture.placement.${placement}`);
}

function periodLabel(period: PeriodKind): string {
  return t(`periodic.kinds.${period}`);
}

function dueLabel(option: CaptureDueDateOption): string {
  return t(`capture.due.${option}`);
}

function openLocationLabel(location: CaptureOpenLocation): string {
  return t(`capture.openLocation.${location}`);
}

function openModeLabel(mode: CaptureOpenMode): string {
  return t(`capture.openMode.${mode}`);
}

function targetSummary(preset: CapturePreset): string {
  if (preset.target === 'inbox') return t('capture.target.inbox');
  if (preset.target === 'active') return t('capture.presetActiveHint');
  if (preset.target === 'periodic') return periodLabel(preset.period);
  return preset.path || t('capture.presetPathPlaceholder');
}

function previewPath(preset: CapturePreset): string {
  if (preset.target === 'inbox') return t('capture.presetInboxHint');
  if (preset.target === 'active') return t('capture.presetActiveHint');
  return captureTargetRelativePath(preset, settings.periodic, settings.weekStartsOn, new Date())
    || t('capture.noTarget');
}

const sampleValues = computed(() => ({
  date: new Date(),
  value: t('capture.presetSampleValue'),
  input: t('capture.presetSampleValue'),
  selection: t('capture.presetSampleSelection'),
  clipboard: t('capture.presetSampleClipboard'),
  url: 'https://example.com',
  tags: 'tag1, tag2',
  title: '2026-11-22',
  file: '2026-11-22.md',
  folder: 'Daily',
  filePath: 'Daily/2026-11-22.md',
}));

function previewText(preset: CapturePreset): string {
  const vars = { ...sampleValues.value };
  if (preset.target !== 'active' && preset.target !== 'inbox') {
    const path = captureTargetRelativePath(preset, settings.periodic, settings.weekStartsOn, new Date());
    const parts = path.split(/[\\/]/).filter(Boolean);
    vars.filePath = path;
    vars.file = parts[parts.length - 1] ?? 'capture.md';
    vars.folder = parts.slice(0, -1).join('/');
    vars.title = vars.file.replace(/\.[^.]+$/, '');
  }
  return capturePreview(preset, vars);
}
</script>

<template>
  <section class="capture-presets">
    <h3>{{ t('capture.presetsTitle') }}</h3>
    <p class="setting-hint">{{ t('capture.presetsHint') }}</p>

    <label class="capture-presets__global">
      <input
        type="checkbox"
        :checked="settings.capturesEnabled"
        @change="settings.setCapturesEnabled(!settings.capturesEnabled)"
      />
      {{ t('capture.presetGlobalEnabled') }}
    </label>
    <button class="kb-btn kb-btn--wide" @click="settings.resetCaptureDefaults()">
      {{ t('capture.presetRestoreDefaults') }}
    </button>

    <div v-for="(preset, index) in settings.captures" :key="preset.id" class="capture-presets__item">
      <div class="capture-presets__row">
        <label class="capture-presets__toggle" :title="t('capture.presetEnabled')">
          <input
            type="checkbox"
            :checked="preset.enabled"
            :disabled="preset.builtIn"
            @change="update(preset, { enabled: !preset.enabled })"
          />
        </label>
        <button class="capture-presets__name" @click="openEditor(preset)">{{ preset.name }}</button>
        <span class="capture-presets__badge">{{ targetLabel(preset.target) }}</span>
        <span class="capture-presets__grow"></span>
        <button class="kb-btn" :disabled="index === 0" :title="t('capture.presetMoveUp')" @click="settings.moveCapture(preset.id, -1)">↑</button>
        <button class="kb-btn" :disabled="index === settings.captures.length - 1" :title="t('capture.presetMoveDown')" @click="settings.moveCapture(preset.id, 1)">↓</button>
        <button class="kb-btn" :title="t('capture.presetDuplicate')" @click="settings.duplicateCapture(preset.id)">{{ t('capture.presetDuplicate') }}</button>
        <button class="kb-btn" :disabled="preset.builtIn" @click="settings.removeCapture(preset.id)">{{ t('capture.presetRemove') }}</button>
      </div>
      <p v-if="preset.description" class="capture-presets__desc">{{ preset.description }}</p>
      <div class="capture-presets__meta">
        <span>{{ targetSummary(preset) }}</span>
        <code>{{ previewText(preset) }}</code>
      </div>
    </div>

    <button class="kb-btn kb-btn--wide" @click="add">{{ t('capture.presetAdd') }}</button>

    <Teleport to="body">
      <div v-if="draft" class="capture-dialog__backdrop" @click.self="draft = null">
        <div class="capture-dialog" role="dialog" aria-modal="true" :aria-label="t('capture.presetsTitle')">
          <div class="capture-dialog__head">
            <h4>{{ t('capture.presetEdit') }}</h4>
            <button class="kb-btn" @click="draft = null">×</button>
          </div>

          <div class="capture-dialog__body">
            <label class="capture-dialog__field">
              <span>{{ t('capture.presetName') }}</span>
              <input v-model="draft.name" type="text" class="settings__field" />
            </label>
            <label class="capture-dialog__field">
              <span>{{ t('capture.presetDescription') }}</span>
              <input v-model="draft.description" type="text" class="settings__field" />
            </label>
            <label class="capture-dialog__inline">
              <input v-model="draft.enabled" type="checkbox" />
              {{ t('capture.presetEnabled') }}
            </label>

            <h5 class="capture-dialog__section">{{ t('capture.section.target') }}</h5>
            <div class="capture-dialog__grid">
              <label class="capture-dialog__field">
                <span>{{ t('capture.presetTarget') }}</span>
                <select v-model="draft.target" :disabled="draft.builtIn">
                  <option v-for="target in CAPTURE_TARGETS" :key="target" :value="target">{{ targetLabel(target) }}</option>
                </select>
              </label>
              <label class="capture-dialog__field">
                <span>{{ t('capture.presetInputMethod') }}</span>
                <select v-model="draft.inputMethod">
                  <option v-for="method in CAPTURE_INPUT_METHODS" :key="method" :value="method">{{ inputLabel(method) }}</option>
                </select>
              </label>
              <label v-if="draft.target === 'periodic'" class="capture-dialog__field">
                <span>{{ t('capture.presetPeriod') }}</span>
                <select v-model="draft.period">
                  <option v-for="period in CAPTURE_PERIODS" :key="period" :value="period">{{ periodLabel(period) }}</option>
                </select>
              </label>
              <label v-if="draft.target === 'file' || draft.target === 'folder'" class="capture-dialog__field">
                <span>{{ t('capture.presetPath') }}</span>
                <input v-model="draft.path" type="text" class="settings__field" :placeholder="t('capture.presetPathPlaceholder')" />
              </label>
              <label v-if="draft.target === 'folder'" class="capture-dialog__field">
                <span>{{ t('capture.presetFileName') }}</span>
                <input v-model="draft.fileName" type="text" class="settings__field" placeholder="YYYY-MM-DD-HHmm.md" />
              </label>
            </div>

            <h5 class="capture-dialog__section">{{ t('capture.section.create') }}</h5>
            <div class="capture-dialog__flags">
              <label><input v-model="draft.createIfMissing" type="checkbox" />{{ t('capture.presetCreateIfMissing') }}</label>
              <label v-if="draft.createIfMissing"><input v-model="draft.createWithTemplate" type="checkbox" />{{ t('capture.presetCreateWithTemplate') }}</label>
            </div>
            <label v-if="draft.createIfMissing && draft.createWithTemplate" class="capture-dialog__field">
              <span>{{ t('capture.presetCreationTemplate') }}</span>
              <input v-model="draft.creationTemplate" type="text" class="settings__field" placeholder="Templates/Note.md" />
            </label>

            <h5 class="capture-dialog__section">{{ t('capture.section.position') }}</h5>
            <div class="capture-dialog__grid">
              <label class="capture-dialog__field">
                <span>{{ t('capture.presetPlacement') }}</span>
                <select v-model="draft.placement">
                  <option v-for="placement in CAPTURE_PLACEMENTS" :key="placement" :value="placement">{{ placementLabel(placement) }}</option>
                </select>
              </label>
              <label v-if="draft.placement === 'heading'" class="capture-dialog__field">
                <span>{{ t('capture.presetHeading') }}</span>
                <input v-model="draft.heading" type="text" class="settings__field" placeholder="## 任务" />
              </label>
            </div>
            <div v-if="draft.placement === 'heading'" class="capture-dialog__flags">
              <label><input v-model="draft.headingInsertAtEnd" type="checkbox" />{{ t('capture.presetInsertAtEnd') }}</label>
              <label><input v-model="draft.headingConsiderSubsections" type="checkbox" />{{ t('capture.presetConsiderSubsections') }}</label>
              <label><input v-model="draft.headingCreateIfMissing" type="checkbox" />{{ t('capture.presetHeadingCreateIfMissing') }}</label>
              <label v-if="draft.headingCreateIfMissing">
                <input v-model="draft.headingCreateLocation" type="checkbox" true-value="top" false-value="bottom" />
                {{ t('capture.presetHeadingCreateTop') }}
              </label>
            </div>
            <div v-if="draft.target === 'active'" class="capture-dialog__flags">
              <label><input v-model="draft.newLineEnabled" type="checkbox" />{{ t('capture.presetNewLine') }}</label>
              <select v-if="draft.newLineEnabled" v-model="draft.newLineDirection">
                <option v-for="direction in CAPTURE_NEW_LINE_DIRECTIONS" :key="direction" :value="direction">
                  {{ t(`capture.direction.${direction as CaptureNewLineDirection}`) }}
                </option>
              </select>
            </div>

            <h5 class="capture-dialog__section">{{ t('capture.section.content') }}</h5>
            <label class="capture-dialog__inline">
              <input v-model="draft.formatEnabled" type="checkbox" />
              {{ t('capture.presetFormatEnabled') }}
            </label>
            <label v-if="draft.formatEnabled" class="capture-dialog__field">
              <span>{{ t('capture.presetTemplate') }}</span>
              <textarea v-model="draft.template" class="settings__field capture-dialog__template" rows="4"></textarea>
            </label>
            <p class="capture-dialog__hint">{{ t('capture.presetVariables') }}</p>
            <div class="capture-dialog__flags">
              <label><input v-model="draft.autoCreated" type="checkbox" />{{ t('capture.presetAutoCreated') }}</label>
              <label><input v-model="draft.autoDue" type="checkbox" />{{ t('capture.presetAutoDue') }}</label>
              <label v-if="draft.autoDue">
                <select v-model="draft.dueDateOption">
                  <option v-for="option in CAPTURE_DUE_OPTIONS" :key="option" :value="option">{{ dueLabel(option) }}</option>
                </select>
              </label>
              <label v-if="draft.autoDue && draft.dueDateOption === 'custom'">
                <input v-model.number="draft.customDueDays" type="number" min="0" class="capture-dialog__number" />
                {{ t('capture.due.customDays') }}
              </label>
            </div>

            <h5 class="capture-dialog__section">{{ t('capture.section.behavior') }}</h5>
            <div class="capture-dialog__flags">
              <label><input v-model="draft.appendLink" type="checkbox" />{{ t('capture.presetAppendLink') }}</label>
              <label><input v-model="draft.openAfter" type="checkbox" />{{ t('capture.presetOpenAfter') }}</label>
              <label><input v-model="draft.openFocus" type="checkbox" />{{ t('capture.presetOpenFocus') }}</label>
            </div>
            <div v-if="draft.openAfter" class="capture-dialog__grid">
              <label class="capture-dialog__field">
                <span>{{ t('capture.presetOpenLocation') }}</span>
                <select v-model="draft.openLocation">
                  <option v-for="location in CAPTURE_OPEN_LOCATIONS" :key="location" :value="location">{{ openLocationLabel(location) }}</option>
                </select>
              </label>
              <label v-if="draft.openLocation === 'split'" class="capture-dialog__field">
                <span>{{ t('capture.presetOpenDirection') }}</span>
                <select v-model="draft.openDirection">
                  <option v-for="direction in CAPTURE_OPEN_DIRECTIONS" :key="direction" :value="direction">
                    {{ t(`capture.direction.${direction as CaptureOpenDirection}`) }}
                  </option>
                </select>
              </label>
              <label class="capture-dialog__field">
                <span>{{ t('capture.presetOpenMode') }}</span>
                <select v-model="draft.openMode">
                  <option v-for="mode in CAPTURE_OPEN_MODES" :key="mode" :value="mode">{{ openModeLabel(mode) }}</option>
                </select>
              </label>
            </div>

            <div class="capture-dialog__preview">
              <div class="capture-dialog__preview-head">
                <span>{{ t('capture.presetPreview') }}</span>
                <code>{{ previewPath(draft) }}</code>
              </div>
              <pre>{{ previewText(draft) }}</pre>
            </div>
          </div>

          <div class="capture-dialog__foot">
            <button class="kb-btn" @click="draft = null">{{ t('capture.presetCancel') }}</button>
            <button class="kb-btn kb-btn--primary" @click="save">{{ t('capture.presetSave') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.capture-presets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.capture-presets__global {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
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

.capture-presets__grow {
  flex: 1;
}

.capture-presets__name {
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
}

.capture-presets__badge {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-radius: 10px;
  padding: 2px 7px;
}

.capture-presets__desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.capture-presets__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.capture-presets__meta code,
.capture-dialog__preview code {
  font-family: var(--font-mono);
  word-break: break-all;
}

.capture-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.capture-dialog {
  width: min(760px, 100%);
  max-height: min(860px, 92vh);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

.capture-dialog__head,
.capture-dialog__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.capture-dialog__foot {
  border-bottom: 0;
  border-top: 1px solid var(--border);
  justify-content: flex-end;
  gap: 8px;
}

.capture-dialog__head h4 {
  margin: 0;
  font-size: 14px;
}

.capture-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  overflow: auto;
}

.capture-dialog__section {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}

.capture-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.capture-dialog__field > span {
  color: var(--text-muted);
}

.capture-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.capture-dialog__inline,
.capture-dialog__flags label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.capture-dialog__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.capture-dialog__number {
  width: 64px;
}

.capture-dialog__template {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-mono);
  resize: vertical;
}

.capture-dialog__hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
}

.capture-dialog__preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-secondary);
}

.capture-dialog__preview-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
}

.capture-dialog__preview pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}
</style>
