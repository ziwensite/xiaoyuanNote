<script setup lang="ts">
/**
 * All search hits as an editor tab (D3).
 *
 * The tab is a singleton: running another search retargets this one via
 * `input.query`. Opening a hit opens the file in the editor but leaves the
 * results tab alive, so the user can keep walking the list.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Icons from '../Icons.vue';
import { useGlobalSearch, type SearchHit } from '../../composables/useGlobalSearch';
import { useFiles } from '../../composables/useFiles';
import { useTabsStore } from '../../stores/tabs';
import { useTilesStore } from '../../stores/tiles';
import { useWorkspaceStore } from '../../stores/workspace';
import { useI18n } from '../../i18n';
import { resolveTabInput } from '../../lib/editor-input';
import { flattenGroups, groupHits, moveHitSelection } from '../../lib/search-results';
import { shortPath } from '../../lib/header-search';
import { focusActiveEditorSoon } from '../../lib/editor-focus';
import type { Tab } from '../../types';

const DEBOUNCE_MS = 220;
/** Opening the file remounts the editor; give it a beat before asking the
 *  outline to jump (same reason HeaderSearchBox waits a tick). */
const GOTO_DELAY_MS = 120;

const props = defineProps<{ tab: Tab }>();

const search = useGlobalSearch();
const files = useFiles();
const tabs = useTabsStore();
const tiles = useTilesStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const hits = ref<SearchHit[]>([]);
const loading = ref(false);
const selectedIdx = ref(0);

let debounceTimer: number | null = null;
// Only the newest query may write hits (same guard as the header box).
let requestSeq = 0;

const argsQuery = computed(() => {
  const input = resolveTabInput(props.tab);
  return input.kind === 'search' ? input.args.query : '';
});

const groups = computed(() => groupHits(hits.value));
const flatHits = computed(() => flattenGroups(groups.value));
const hasQuery = computed(() => query.value.trim().length > 0);

watch(
  argsQuery,
  (next) => {
    if (next === query.value) return;
    // The query watcher below owns the search (debounced, one request path).
    query.value = next;
  },
  { immediate: true },
);

watch(query, () => {
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    // Keep the tab's parameters (and therefore its title) in step with what
    // the user typed, without spawning a second search tab. An empty box is
    // not a search input, so the last query stays (the tab keeps rendering).
    const q = query.value.trim();
    if (q) tabs.updateInput(props.tab.id, { query: q });
    void doSearch();
  }, DEBOUNCE_MS);
});

onMounted(async () => {
  if (hasQuery.value) void doSearch();
  await nextTick();
  inputRef.value?.focus();
});

async function doSearch() {
  const q = query.value.trim();
  const seq = ++requestSeq;
  if (!q || !workspace.currentFolder) {
    hits.value = [];
    loading.value = false;
    selectedIdx.value = 0;
    return;
  }
  loading.value = true;
  try {
    const result = await search.search(q);
    if (seq !== requestSeq) return;
    hits.value = result;
    selectedIdx.value = 0;
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

async function openHit(hit: SearchHit) {
  try {
    await files.openPath(hit.file);
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('solomd:outline-goto', {
          detail: { line: hit.line, paneId: tiles.focusedPaneId },
        }),
      );
    }, GOTO_DELAY_MS);
  } catch (e) {
    console.error('SearchResultsTab: openPath failed', e);
  }
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    selectedIdx.value = moveHitSelection(selectedIdx.value, delta, flatHits.value.length);
    return;
  }
  if (e.key === 'Enter') {
    const hit = flatHits.value[selectedIdx.value];
    if (hit) {
      e.preventDefault();
      void openHit(hit);
    }
    return;
  }
  if (e.key === 'Escape') {
    // Never close the tab from here: hand the keyboard back to the editor.
    e.preventDefault();
    inputRef.value?.blur();
    focusActiveEditorSoon(() => tiles.focusedPaneId);
  }
}

function shortFile(file: string): string {
  return shortPath(file, workspace.currentFolder);
}

function highlight(snippet: string): string {
  const q = query.value.trim();
  if (!q) return escapeHtml(snippet);
  const re = new RegExp(`(${escapeRe(q)})`, 'gi');
  return escapeHtml(snippet).replace(re, '<mark>$1</mark>');
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
</script>

<template>
  <div class="srt">
    <div class="srt__bar">
      <Icons class="srt__icon" name="search" :size="14" aria-hidden="true" />
      <input
        ref="inputRef"
        v-model="query"
        class="srt__input"
        type="text"
        :placeholder="t('search.placeholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown="onKey"
      />
      <span v-if="loading" class="srt__loading" aria-hidden="true">…</span>
    </div>

    <div v-if="!workspace.currentFolder" class="srt__empty">
      {{ t('search.openFolder') }}
    </div>
    <div v-else-if="!hasQuery" class="srt__empty">
      {{ t('search.typeToSearch') }}
    </div>
    <div v-else-if="!hits.length && !loading" class="srt__empty">
      {{ t('search.noMatches') }}
    </div>

    <div v-else class="srt__results">
      <div v-for="group in groups" :key="group.file" class="srt__group">
        <div class="srt__file" :title="group.file">{{ shortFile(group.file) }}</div>
        <div
          v-for="hit in group.hits"
          :key="hit.line"
          class="srt__hit"
          :class="{ 'srt__hit--active': flatHits.indexOf(hit) === selectedIdx }"
          @click="openHit(hit)"
          @mouseenter="selectedIdx = flatHits.indexOf(hit)"
        >
          <span class="srt__lineno">L{{ hit.line }}</span>
          <span class="srt__snippet" v-html="highlight(hit.snippet)"></span>
        </div>
      </div>
    </div>

    <div class="srt__footer">
      <span>{{ t('search.hitCount', { n: hits.length }) }}</span>
      <span class="key-hint">{{ t('editorTab.searchHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.srt {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
.srt__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin: 10px 12px 6px;
  padding: 0 10px;
  border-radius: var(--r-md);
  background: var(--fill-1);
  color: var(--text-3);
}
.srt__bar:focus-within {
  background: var(--bg);
  box-shadow: var(--ring);
}
.srt__icon {
  flex: none;
}
.srt__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: 13px var(--font-ui);
  color: var(--text);
}
.srt__input::placeholder {
  color: var(--text-3);
}
.srt__loading {
  flex: none;
  color: var(--accent);
  font-size: 14px;
}
.srt__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
.srt__results {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0 8px;
}
.srt__group {
  margin-bottom: 2px;
}
.srt__file {
  padding: 7px 14px 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.srt__hit {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  padding: 3px 14px 3px 20px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.srt__hit:hover,
.srt__hit--active {
  background: var(--bg-hover, rgba(255, 159, 64, 0.12));
}
.srt__lineno {
  flex: none;
  width: 34px;
  font-size: 10px;
  color: var(--text-faint);
}
.srt__snippet {
  overflow: hidden;
  text-overflow: ellipsis;
}
.srt__snippet :deep(mark) {
  background: var(--accent-soft, rgba(255, 159, 64, 0.25));
  color: inherit;
  border-radius: 2px;
}
.srt__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 12px;
  border-top: var(--bd-hair);
  font-size: 10px;
  color: var(--text-faint);
}
</style>
