<script setup lang="ts">
/**
 * Capture presets editor. A preset is data only; the executor lives in
 * `useCapture`. The dialog edits a draft and only commits on Save, so the
 * command palette never sees a half-configured preset.
 *
 * Controls use the shared Ds* primitives and the settings row conventions so
 * this section looks like the rest of the app.
 */
import { computed, ref } from 'vue';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { DsButton, DsInput, DsModal, DsSelect, DsTextarea } from '../ui';
import { useI18n } from '../i18n';
import { useFiles } from '../composables/useFiles';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
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
  captureNoteRelativePath,
  captureTargetRelativePath,
  newCapturePreset,
  renderCaptureNote,
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
const files = useFiles();
const workspace = useWorkspaceStore();
const draft = ref<CapturePreset | null>(null);

type PathField = 'path' | 'creationTemplate';

const editorOpen = computed({
  get: () => draft.value !== null,
  set: (open: boolean) => {
    if (!open) draft.value = null;
  },
});

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
  return t(`settings.periodic.kinds.${period}`);
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

function selectOptions<T extends string>(values: readonly T[], label: (value: T) => string) {
  return values.map((value) => ({ value, label: label(value) }));
}

function targetSummary(preset: CapturePreset): string {
  if (preset.target === 'inbox') return t('capture.target.inbox');
  if (preset.target === 'active') return t('capture.presetActiveHint');
  if (preset.target === 'periodic') return periodLabel(preset.period);
  return preset.path || t('capture.presetPathPlaceholder');
}

function previewPath(preset: CapturePreset): string {
  if (preset.target === 'inbox') {
    return preset.path ? captureNoteRelativePath(preset, new Date()) : t('capture.presetInboxHint');
  }
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
  return renderCaptureNote(preset, vars);
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/');
}

function absolutePath(value: string): string {
  if (!value) return '';
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/')) return value;
  const root = workspace.currentFolder;
  if (!root || root.startsWith('saf:')) return value;
  return `${normalizeSlash(root).replace(/\/+$/, '')}/${normalizeSlash(value).replace(/^\/+/, '')}`;
}

function relativePath(value: string): string {
  const root = workspace.currentFolder;
  if (!root || root.startsWith('saf:')) return normalizeSlash(value);
  const rootNorm = normalizeSlash(root).replace(/\/+$/, '').toLowerCase();
  const valueNorm = normalizeSlash(value);
  if (valueNorm.toLowerCase().startsWith(`${rootNorm}/`)) {
    return valueNorm.slice(rootNorm.length + 1);
  }
  return valueNorm;
}

async function pickDraftPath(field: PathField): Promise<void> {
  if (!draft.value) return;
  const current = draft.value[field];
  const defaultPath = current ? absolutePath(current) : await files.filePickerStartDir();
  const isFolder = field === 'path'
    && (draft.value.target === 'folder' || draft.value.target === 'inbox');
  const selected = await openFileDialog(
    isFolder
      ? { directory: true, multiple: false, defaultPath }
      : {
          multiple: false,
          defaultPath,
          filters: [{ name: t('settings.periodic.markdownFilter'), extensions: ['md', 'markdown', 'txt'] }],
        },
  );
  if (typeof selected !== 'string') return;
  draft.value[field] = relativePath(selected);
}

function clearDraftPath(field: PathField): void {
  if (draft.value) draft.value[field] = '';
}
</script>

<template>
  <section class="capture-presets">
    <h3 class="settings__group-title">{{ t('capture.presetsTitle') }}</h3>
    <p class="setting-hint">{{ t('capture.presetsHint') }}</p>

    <label class="capture-presets__global">
      <input
        type="checkbox"
        :checked="settings.capturesEnabled"
        @change="settings.setCapturesEnabled(!settings.capturesEnabled)"
      />
      {{ t('capture.presetGlobalEnabled') }}
    </label>
    <DsButton block @click="settings.resetCaptureDefaults()">
      {{ t('capture.presetRestoreDefaults') }}
    </DsButton>

    <div v-for="(preset, index) in settings.captures" :key="preset.id" class="capture-presets__item">
      <div class="capture-presets__row">
        <input
          type="checkbox"
          :checked="preset.enabled"
          :title="t('capture.presetEnabled')"
          @change="update(preset, { enabled: !preset.enabled })"
        />
        <DsButton size="sm" @click="openEditor(preset)">{{ preset.name }}</DsButton>
        <span class="capture-presets__badge">{{ targetLabel(preset.target) }}</span>
        <span class="capture-presets__grow"></span>
        <DsButton size="sm" :disabled="index === 0" :title="t('capture.presetMoveUp')" @click="settings.moveCapture(preset.id, -1)">↑</DsButton>
        <DsButton size="sm" :disabled="index === settings.captures.length - 1" :title="t('capture.presetMoveDown')" @click="settings.moveCapture(preset.id, 1)">↓</DsButton>
        <DsButton size="sm" @click="settings.duplicateCapture(preset.id)">{{ t('capture.presetDuplicate') }}</DsButton>
        <DsButton size="sm" :disabled="preset.builtIn" @click="settings.removeCapture(preset.id)">{{ t('capture.presetRemove') }}</DsButton>
      </div>
      <p v-if="preset.description" class="setting-hint">{{ preset.description }}</p>
      <div class="capture-presets__meta">
        <span>{{ targetSummary(preset) }}</span>
        <code>{{ previewText(preset) }}</code>
      </div>
    </div>

    <DsButton block @click="add">{{ t('capture.presetAdd') }}</DsButton>

    <DsModal v-model="editorOpen" :title="t('capture.presetEdit')" width="760px">
      <template v-if="draft">
        <div class="capture-editor__grid">
          <label class="capture-editor__field">
            <span>{{ t('capture.presetName') }}</span>
            <DsInput v-model="draft.name" />
          </label>
          <label class="capture-editor__field">
            <span>{{ t('capture.presetDescription') }}</span>
            <DsInput v-model="draft.description" />
          </label>
        </div>
        <label class="capture-editor__check">
          <input v-model="draft.enabled" type="checkbox" />
          {{ t('capture.presetEnabled') }}
        </label>

        <h4 class="settings__group-title">{{ t('capture.section.target') }}</h4>
        <div class="capture-editor__grid">
          <label class="capture-editor__field">
            <span>{{ t('capture.presetTarget') }}</span>
            <DsSelect v-model="draft.target" :options="selectOptions(CAPTURE_TARGETS, targetLabel)" />
          </label>
          <label class="capture-editor__field">
            <span>{{ t('capture.presetInputMethod') }}</span>
            <DsSelect v-model="draft.inputMethod" :options="selectOptions(CAPTURE_INPUT_METHODS, inputLabel)" />
          </label>
          <label v-if="draft.target === 'periodic'" class="capture-editor__field">
            <span>{{ t('capture.presetPeriod') }}</span>
            <DsSelect v-model="draft.period" :options="selectOptions(CAPTURE_PERIODS, periodLabel)" />
          </label>
          <div v-if="draft.target === 'file' || draft.target === 'folder' || draft.target === 'inbox'" class="capture-editor__field">
            <span>{{ t('capture.presetPath') }}</span>
            <div class="capture-editor__path">
              <DsInput v-model="draft.path" :placeholder="t('capture.presetPathPlaceholder')" />
              <DsButton size="sm" @click="pickDraftPath('path')">
                {{ draft.target === 'file' ? t('capture.browseFile') : t('capture.browseFolder') }}
              </DsButton>
              <DsButton size="sm" :disabled="!draft.path" @click="clearDraftPath('path')">{{ t('capture.clear') }}</DsButton>
            </div>
          </div>
          <label v-if="draft.target === 'folder'" class="capture-editor__field">
            <span>{{ t('capture.presetFileName') }}</span>
            <DsInput v-model="draft.fileName" :placeholder="t('capture.presetFileNamePlaceholder')" />
          </label>
        </div>

        <h4 class="settings__group-title">{{ t('capture.section.create') }}</h4>
        <div class="capture-editor__checks">
          <label><input v-model="draft.createIfMissing" type="checkbox" />{{ t('capture.presetCreateIfMissing') }}</label>
          <label v-if="draft.createIfMissing"><input v-model="draft.createWithTemplate" type="checkbox" />{{ t('capture.presetCreateWithTemplate') }}</label>
        </div>
        <div v-if="draft.createIfMissing && draft.createWithTemplate" class="capture-editor__field">
          <span>{{ t('capture.presetCreationTemplate') }}</span>
          <div class="capture-editor__path">
            <DsInput v-model="draft.creationTemplate" :placeholder="t('capture.presetTemplateFilePlaceholder')" />
            <DsButton size="sm" @click="pickDraftPath('creationTemplate')">{{ t('capture.browseFile') }}</DsButton>
            <DsButton size="sm" :disabled="!draft.creationTemplate" @click="clearDraftPath('creationTemplate')">{{ t('capture.clear') }}</DsButton>
          </div>
        </div>

        <h4 class="settings__group-title">{{ t('capture.section.position') }}</h4>
        <div class="capture-editor__grid">
          <label class="capture-editor__field">
            <span>{{ t('capture.presetPlacement') }}</span>
            <DsSelect v-model="draft.placement" :options="selectOptions(CAPTURE_PLACEMENTS, placementLabel)" />
          </label>
          <label v-if="draft.placement === 'heading'" class="capture-editor__field">
            <span>{{ t('capture.presetHeading') }}</span>
            <DsInput v-model="draft.heading" :placeholder="t('capture.presetHeadingPlaceholder')" />
          </label>
        </div>
        <div v-if="draft.placement === 'heading'" class="capture-editor__checks">
          <label><input v-model="draft.headingInsertAtEnd" type="checkbox" />{{ t('capture.presetInsertAtEnd') }}</label>
          <label><input v-model="draft.headingConsiderSubsections" type="checkbox" />{{ t('capture.presetConsiderSubsections') }}</label>
          <label><input v-model="draft.headingCreateIfMissing" type="checkbox" />{{ t('capture.presetHeadingCreateIfMissing') }}</label>
          <label v-if="draft.headingCreateIfMissing">
            <input v-model="draft.headingCreateLocation" type="checkbox" true-value="top" false-value="bottom" />
            {{ t('capture.presetHeadingCreateTop') }}
          </label>
        </div>
        <div v-if="draft.target === 'active'" class="capture-editor__checks">
          <label><input v-model="draft.newLineEnabled" type="checkbox" />{{ t('capture.presetNewLine') }}</label>
          <DsSelect
            v-if="draft.newLineEnabled"
            v-model="draft.newLineDirection"
            :options="selectOptions(CAPTURE_NEW_LINE_DIRECTIONS, (v) => t(`capture.direction.${v as CaptureNewLineDirection}`))"
          />
        </div>

        <h4 class="settings__group-title">{{ t('capture.section.content') }}</h4>
        <label class="capture-editor__check">
          <input v-model="draft.formatEnabled" type="checkbox" />
          {{ t('capture.presetFormatEnabled') }}
        </label>
        <label v-if="draft.formatEnabled" class="capture-editor__field">
          <span>{{ t('capture.presetTemplate') }}</span>
          <DsTextarea v-model="draft.template" :rows="4" />
        </label>
        <p class="setting-hint">{{ t('capture.presetVariables') }}</p>

        <div class="capture-editor__checks">
          <label><input v-model="draft.frontmatterEnabled" type="checkbox" />{{ t('capture.presetFrontmatterEnabled') }}</label>
          <label v-if="draft.frontmatterEnabled"><input v-model="draft.markInbox" type="checkbox" />{{ t('capture.presetMarkInbox') }}</label>
        </div>
        <p class="setting-hint">{{ t('capture.presetFrontmatterHint') }}</p>
        <label v-if="draft.frontmatterEnabled" class="capture-editor__field">
          <span>{{ t('capture.presetFrontmatter') }}</span>
          <DsTextarea v-model="draft.frontmatterTemplate" :rows="3" />
        </label>

        <div class="capture-editor__checks">
          <label><input v-model="draft.autoCreated" type="checkbox" />{{ t('capture.presetAutoCreated') }}</label>
          <label><input v-model="draft.autoDue" type="checkbox" />{{ t('capture.presetAutoDue') }}</label>
          <label v-if="draft.autoDue">
            <DsSelect v-model="draft.dueDateOption" :options="selectOptions(CAPTURE_DUE_OPTIONS, dueLabel)" />
          </label>
          <label v-if="draft.autoDue && draft.dueDateOption === 'custom'">
            <DsInput
              :model-value="String(draft.customDueDays)"
              type="number"
              :min="0"
              @update:model-value="draft.customDueDays = Number($event)"
            />
            {{ t('capture.due.customDays') }}
          </label>
        </div>

        <h4 class="settings__group-title">{{ t('capture.section.behavior') }}</h4>
        <div class="capture-editor__checks">
          <label><input v-model="draft.appendLink" type="checkbox" />{{ t('capture.presetAppendLink') }}</label>
          <label><input v-model="draft.openAfter" type="checkbox" />{{ t('capture.presetOpenAfter') }}</label>
          <label><input v-model="draft.openFocus" type="checkbox" />{{ t('capture.presetOpenFocus') }}</label>
        </div>
        <div v-if="draft.openAfter" class="capture-editor__grid">
          <label class="capture-editor__field">
            <span>{{ t('capture.presetOpenLocation') }}</span>
            <DsSelect v-model="draft.openLocation" :options="selectOptions(CAPTURE_OPEN_LOCATIONS, openLocationLabel)" />
          </label>
          <label v-if="draft.openLocation === 'split'" class="capture-editor__field">
            <span>{{ t('capture.presetOpenDirection') }}</span>
            <DsSelect v-model="draft.openDirection" :options="selectOptions(CAPTURE_OPEN_DIRECTIONS, (v) => t(`capture.direction.${v as CaptureOpenDirection}`))" />
          </label>
          <label class="capture-editor__field">
            <span>{{ t('capture.presetOpenMode') }}</span>
            <DsSelect v-model="draft.openMode" :options="selectOptions(CAPTURE_OPEN_MODES, openModeLabel)" />
          </label>
        </div>

        <div class="capture-editor__preview">
          <div class="capture-editor__preview-head">
            <span>{{ t('capture.presetPreview') }}</span>
            <code>{{ previewPath(draft) }}</code>
          </div>
          <pre>{{ previewText(draft) }}</pre>
        </div>
      </template>

      <template #footer>
        <DsButton @click="editorOpen = false">{{ t('capture.presetCancel') }}</DsButton>
        <DsButton variant="primary" @click="save">{{ t('capture.presetSave') }}</DsButton>
      </template>
    </DsModal>
  </section>
</template>

<style scoped>
.capture-presets {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.capture-presets__global,
.capture-editor__check,
.capture-editor__checks label {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: 12px;
}

.capture-presets__item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: var(--bd-hair);
  border-color: var(--hairline);
  border-radius: var(--r-sm);
}

.capture-presets__row {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
}

.capture-presets__grow {
  flex: 1;
}

.capture-presets__badge {
  font-size: 11px;
  color: var(--text-3);
  background: var(--fill-1);
  border-radius: var(--r-sm);
  padding: 2px 7px;
}

.capture-presets__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.capture-presets__meta code,
.capture-editor__preview code,
.capture-editor__preview pre {
  font-family: var(--font-mono);
  word-break: break-all;
}

.capture-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.capture-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: 12px;
  min-width: 0;
}

.capture-editor__field > span {
  color: var(--text-3);
}

.capture-editor__path {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-width: 0;
}

.capture-editor__path > :first-child {
  flex: 1;
  min-width: 0;
}

.capture-editor__checks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1) var(--sp-4);
}

.capture-editor__checks label {
  min-width: 0;
}

.capture-editor__preview {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--fill-1);
}

.capture-editor__preview-head {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  font-size: 11px;
  color: var(--text-3);
}

.capture-editor__preview pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text);
}
</style>
