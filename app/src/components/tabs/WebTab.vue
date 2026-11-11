<script setup lang="ts">
/**
 * A web page embedded in the editor area (iframe route).
 *
 * The iframe is the default because it keeps the app's own shortcuts, splits
 * and drag-reorder working; Tauri child webviews would need manual bounds /
 * z-order sync. The P5 experiment was evaluated and rejected (spec §4.4):
 * `settings.webTabEngine` is pinned to `iframe` until child webviews can be
 * verified on a real GUI. Sites that refuse framing (X-Frame-Options / CSP)
 * either hit the static host list or show a non-blocking "open externally"
 * hint after six seconds.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';
import Icons from '../Icons.vue';
import { useI18n } from '../../i18n';
import { useToastsStore } from '../../stores/toasts';
import { resolveTabInput } from '../../lib/editor-input';
import {
  hostOf,
  hostPreference,
  isKnownFrameBlocker,
  normalizeUrl,
  setHostPreference,
  WEB_TAB_PERMISSIONS,
  WEB_TAB_SANDBOX,
  type WebTabMode,
} from '../../lib/web-tab';
import type { Tab } from '../../types';

const SLOW_LOAD_MS = 6000;

const props = defineProps<{ tab: Tab }>();

const { t } = useI18n();
const toasts = useToastsStore();

// The tab record is persisted and can be tampered with (or written by an
// older build), so re-validate before the value reaches an iframe src.
const url = computed(() => {
  const input = resolveTabInput(props.tab);
  return input.kind === 'web' ? (normalizeUrl(input.args.url) ?? '') : '';
});
const validUrl = computed(() => url.value !== '');
const host = computed(() => hostOf(url.value));

const mode = ref<WebTabMode>(
  !url.value || isKnownFrameBlocker(host.value) || hostPreference(host.value) === 'external'
    ? 'external'
    : 'frame',
);
const frameKey = ref(0);
const slow = ref(false);
let slowTimer: number | null = null;

function startSlowTimer() {
  stopSlowTimer();
  slow.value = false;
  slowTimer = window.setTimeout(() => {
    slow.value = true;
  }, SLOW_LOAD_MS);
}
function stopSlowTimer() {
  if (slowTimer != null) {
    window.clearTimeout(slowTimer);
    slowTimer = null;
  }
}
if (mode.value === 'frame') startSlowTimer();

onBeforeUnmount(stopSlowTimer);

function reload() {
  frameKey.value += 1;
  startSlowTimer();
}

function tryFrame() {
  if (!validUrl.value) return;
  setHostPreference(host.value, 'frame');
  mode.value = 'frame';
  startSlowTimer();
}

function rememberExternal() {
  if (!validUrl.value) return;
  setHostPreference(host.value, 'external');
  mode.value = 'external';
  stopSlowTimer();
  void openUrl(url.value).catch((e) => console.warn('[web] openUrl failed', e));
}

async function copyLink() {
  if (!validUrl.value) return;
  try {
    await writeText(url.value);
    toasts.info(t('editorTab.webCopied'));
  } catch (e) {
    console.warn('[web] copy failed', e);
  }
}

function openInBrowser() {
  if (!validUrl.value) return;
  void openUrl(url.value).catch((e) => console.warn('[web] openUrl failed', e));
}

function onFrameLoad() {
  // A cross-origin error page still fires `load`, so this only clears the
  // non-blocking hint; it is not a reliable framing check (spec §4.1).
  stopSlowTimer();
  slow.value = false;
}
</script>

<template>
  <div class="web-tab">
    <div class="web-tab__chrome">
      <Icons class="web-tab__icon" name="globe" :size="13" aria-hidden="true" />
      <span class="web-tab__url" :title="url">{{ url }}</span>
      <button
        v-if="mode === 'frame'"
        class="web-tab__btn"
        type="button"
        :title="t('editorTab.webReload')"
        @click="reload"
      ><Icons name="refresh" :size="13" /></button>
      <button
        class="web-tab__btn"
        type="button"
        :title="t('editorTab.webCopyLink')"
        :disabled="!validUrl"
        @click="copyLink"
      ><Icons name="link" :size="13" /></button>
      <button
        class="web-tab__btn"
        type="button"
        :title="t('editorTab.openInBrowser')"
        :disabled="!validUrl"
        @click="openInBrowser"
      ><Icons name="external" :size="13" /></button>
    </div>

    <div v-if="mode === 'external'" class="web-tab__fallback">
      <Icons class="web-tab__fallback-icon" name="globe" :size="28" aria-hidden="true" />
      <p class="web-tab__fallback-title">{{ host || t('editorTab.web') }}</p>
      <p class="web-tab__fallback-text">{{ validUrl ? t('editorTab.webFallback') : t('editorTab.webInvalid') }}</p>
      <div v-if="validUrl" class="web-tab__actions">
        <button class="web-tab__primary" type="button" @click="rememberExternal">
          {{ t('editorTab.openInBrowser') }}
        </button>
        <button class="web-tab__secondary" type="button" @click="tryFrame">
          {{ t('editorTab.webTryFrame') }}
        </button>
      </div>
    </div>

    <template v-else>
      <div v-if="slow" class="web-tab__slow">
        <span>{{ t('editorTab.webSlow') }}</span>
        <button class="web-tab__slow-btn" type="button" @click="openInBrowser">
          {{ t('editorTab.openInBrowser') }}
        </button>
      </div>
      <iframe
        :key="frameKey"
        class="web-tab__frame"
        :src="url"
        :title="host || t('editorTab.web')"
        :sandbox="WEB_TAB_SANDBOX"
        :allow="WEB_TAB_PERMISSIONS"
        referrerpolicy="no-referrer"
        @load="onFrameLoad"
      ></iframe>
    </template>
  </div>
</template>

<style scoped>
.web-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}
.web-tab__chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 32px;
  padding: 0 8px;
  border-bottom: var(--bd-hair);
  background: var(--bg-elevated, var(--bg));
  color: var(--text-3);
}
.web-tab__icon {
  flex: none;
}
.web-tab__url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: 11px var(--font-mono);
}
.web-tab__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.web-tab__btn:hover {
  background: var(--fill-1);
  color: var(--text);
}
.web-tab__btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.web-tab__btn:disabled:hover {
  background: transparent;
  color: var(--text-2);
}
.web-tab__frame {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}
.web-tab__fallback {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 24px;
  text-align: center;
}
.web-tab__fallback-icon {
  color: var(--text-faint);
}
.web-tab__fallback-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.web-tab__fallback-text {
  max-width: 420px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}
.web-tab__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.web-tab__primary,
.web-tab__secondary {
  padding: 6px 14px;
  border-radius: var(--r-sm);
  font-size: 12px;
  cursor: pointer;
}
.web-tab__primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent, #fff);
}
.web-tab__secondary {
  border: var(--bd-hair);
  background: transparent;
  color: var(--text-2);
}
.web-tab__slow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  padding: 6px 12px;
  background: var(--accent-soft, rgba(255, 159, 64, 0.12));
  font-size: 11px;
  color: var(--text-2);
}
.web-tab__slow-btn {
  flex: none;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--accent);
  color: var(--on-accent, #fff);
  font-size: 11px;
  cursor: pointer;
}
</style>
