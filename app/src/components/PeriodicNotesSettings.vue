<script setup lang="ts">
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '../i18n';
import { useFiles } from '../composables/useFiles';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import {
  ALL_PERIODIC_KINDS,
  defaultPeriodicConfig,
  periodicTarget,
  type PeriodKind,
} from '../lib/periodic-notes';

type PathField = 'folder' | 'template';

const { t } = useI18n();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const files = useFiles();
const defaultConfig = defaultPeriodicConfig();

function labelFor(kind: PeriodKind): string {
  return t(`settings.periodic.kinds.${kind}`);
}

function formatPreview(kind: PeriodKind): string {
  const current = settings.periodic[kind];
  const config = current.format.trim() ? current : defaultConfig[kind];
  return periodicTarget(kind, new Date(), config, settings.weekStartsOn).path;
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

async function pickPath(kind: PeriodKind, field: PathField): Promise<void> {
  const current = settings.periodic[kind][field];
  const defaultPath = current ? absolutePath(current) : await files.filePickerStartDir();
  const selected =
    field === 'template'
      ? await openFileDialog({
          multiple: false,
          defaultPath,
          filters: [{ name: t('settings.periodic.markdownFilter'), extensions: ['md', 'markdown', 'txt'] }],
        })
      : await openFileDialog({ directory: true, multiple: false, defaultPath });
  if (typeof selected !== 'string') return;
  settings.setPeriodicConfig(kind, { [field]: relativePath(selected) });
}

function clearPath(kind: PeriodKind, field: PathField): void {
  settings.setPeriodicConfig(kind, { [field]: '' });
}

function updateFormat(kind: PeriodKind, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  settings.setPeriodicConfig(kind, { format: value });
}
</script>

<template>
  <h3 class="settings__group-title">{{ t('settings.periodic.title') }}</h3>
  <p class="setting-hint">{{ t('settings.periodic.hint') }}</p>

  <div class="periodic-notes">
    <details
      v-for="kind in ALL_PERIODIC_KINDS"
      :key="kind"
      class="periodic-note"
      :open="kind === 'daily'"
    >
      <summary>{{ labelFor(kind) }}</summary>

      <div class="periodic-note__row">
        <label>{{ t('settings.periodic.templatePath') }}</label>
        <input
          type="text"
          spellcheck="false"
          class="settings__field"
          :value="settings.periodic[kind].template"
          :placeholder="t('settings.periodic.templatePlaceholder')"
          @input="settings.setPeriodicConfig(kind, { template: ($event.target as HTMLInputElement).value })"
        />
        <button type="button" @click="pickPath(kind, 'template')">{{ t('settings.periodic.browseFile') }}</button>
        <button type="button" :disabled="!settings.periodic[kind].template" @click="clearPath(kind, 'template')">
          {{ t('settings.periodic.clear') }}
        </button>
      </div>

      <div class="periodic-note__row">
        <label>{{ t('settings.periodic.savePath') }}</label>
        <input
          type="text"
          spellcheck="false"
          class="settings__field"
          :value="settings.periodic[kind].folder"
          @input="settings.setPeriodicConfig(kind, { folder: ($event.target as HTMLInputElement).value })"
        />
        <button type="button" @click="pickPath(kind, 'folder')">{{ t('settings.periodic.browseFolder') }}</button>
        <button type="button" :disabled="!settings.periodic[kind].folder" @click="clearPath(kind, 'folder')">
          {{ t('settings.periodic.clear') }}
        </button>
      </div>

      <div class="periodic-note__row">
        <label>{{ t('settings.periodic.filenameFormat') }}</label>
        <input
          type="text"
          spellcheck="false"
          class="settings__field"
          :value="settings.periodic[kind].format"
          @input="updateFormat(kind, $event)"
        />
        <p class="setting-hint periodic-note__hint">
          {{ t('settings.periodic.preview', { path: formatPreview(kind) }) }}
          <span class="periodic-note__default">
            · {{ t('settings.periodic.defaultFormat', { format: defaultConfig[kind].format }) }}
          </span>
        </p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.periodic-notes {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.periodic-note {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-elev);
}

.periodic-note > summary {
  cursor: pointer;
  font-weight: 600;
  padding: 2px 0;
}

.periodic-note__row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.periodic-note__row label {
  font-size: 12px;
  color: var(--text-muted);
}

.periodic-note__row input {
  min-width: 0;
}

.periodic-note__hint {
  grid-column: 2 / -1;
  margin-top: -4px;
}

.periodic-note__default {
  opacity: 0.75;
}

@media (max-width: 720px) {
  .periodic-note__row {
    grid-template-columns: 1fr;
  }
}
</style>
