<script setup lang="ts">
/**
 * The quick-capture box — a whole window, but only just.
 *
 * Opened by the global hotkey (registered in Rust, see `quick_capture.rs`).
 * Type, press Enter, it's an Inbox note and the box is gone. Esc throws the
 * text away. There is deliberately nothing else here: no formatting, no
 * folder picker, no tags UI. Every control added is a decision the user has to
 * make before the thought is written down, which is the friction this exists
 * to remove.
 *
 * It runs as its own Vue root (`main.ts` branches on `?quickCapture=1`) in a
 * second webview, so it shares localStorage with the main window — which is
 * how it knows the theme and the language without any IPC.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from '../i18n';
import { useCapture } from '../composables/useCapture';
import { useCaptureDestination } from '../composables/useCaptureDestination';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import CaptureInput from './CaptureInput.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const capture = useCapture();
const destinationOf = useCaptureDestination();

const text = ref('');
const input = ref<InstanceType<typeof CaptureInput> | null>(null);
const error = ref('');
const saving = ref(false);
let unlistenReset: UnlistenFn | null = null;

const selectedPreset = computed(() => {
  const eligible = settings.captures.filter((p) => p.enabled && p.target !== 'active');
  const configured = eligible.find((p) => p.id === settings.quickCapturePresetId);
  return configured
    ?? eligible.find((p) => p.id === 'flash')
    ?? eligible[0]
    ?? settings.captures[0];
});

const destinationLabel = computed(() => selectedPreset.value ? destinationOf(selectedPreset.value) : '');

const keysHint = computed(() => selectedPreset.value?.inputMethod === 'multi-line'
  ? t('capture.dialogHintMultiline')
  : t('quickCapture.keys'));

function focusBox() {
  input.value?.focus();
}

async function close() {
  text.value = '';
  error.value = '';
  try {
    await invoke('quick_capture_close');
  } catch {
    /* the window is going away either way */
  }
}

async function save() {
  if (saving.value) return;
  const content = text.value.trim();
  if (!content) {
    void close();
    return;
  }
  const preset = selectedPreset.value;
  if (!preset) {
    error.value = t('capture.disabled');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const result = await capture.runPresetDetailed(preset.id, { value: content });
    if (!result.ok) {
      // Staying open with the text intact is the only acceptable failure: the
      // note exists nowhere else, and the window closing would destroy it.
      error.value = result.error || t('quickCapture.failed');
      return;
    }
    text.value = '';
    await close();
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  document.documentElement.setAttribute(
    'data-theme',
    settings.theme === 'light' ? 'light' : settings.theme,
  );
  focusBox();
  try {
    // Reopening the box must not present the last capture's leftovers.
    unlistenReset = await listen('xiaoyuan-note://quick-capture-reset', () => {
      text.value = '';
      error.value = '';
      focusBox();
    });
  } catch {}
});

onBeforeUnmount(() => {
  unlistenReset?.();
});
</script>

<template>
  <div class="qc">
    <CaptureInput
      ref="input"
      v-model="text"
      :input-method="selectedPreset?.inputMethod ?? 'single-line'"
      :placeholder="t('quickCapture.placeholder')"
      @submit="save"
      @cancel="close"
    />
    <div class="qc__bar">
      <span v-if="error" class="qc__error">{{ error }}</span>
      <span v-else-if="!workspace.currentFolder" class="qc__error">
        {{ t('quickCapture.noWorkspace') }}
      </span>
      <span v-else class="qc__dest">
        {{ t('capture.dialogDestination', { destination: destinationLabel }) }}
        · {{ selectedPreset?.name }}
      </span>
      <span class="qc__keys">{{ keysHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.qc {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  padding: 12px 14px 10px;
  background: var(--bg-elev, #f7f6f3);
  border: 1px solid var(--border, #e9e9e7);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font-ui, system-ui, sans-serif);
}
.qc__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border, #e9e9e7);
  font-size: 11px;
  color: var(--text-muted, #787774);
}
.qc__error {
  color: var(--danger, #d64545);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qc__dest,
.qc__keys {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qc__keys {
  flex-shrink: 0;
  opacity: 0.75;
}
</style>
