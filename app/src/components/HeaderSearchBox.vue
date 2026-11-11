<script setup lang="ts">
/**
 * The inline global-search box in the title row.
 *
 * It is the ONLY visible search entry point (spec D1). The search itself is
 * not reimplemented: `useGlobalSearch().search()` supplies the hits and the
 * open behaviour mirrors GlobalSearch.vue (`files.openPath` followed by a
 * `solomd:outline-goto` event on the next tick).
 *
 * `data-no-drag` on the root keeps a click from turning into a window drag —
 * the title bar lives inside Tauri's draggable region.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icons from './Icons.vue';
import { useGlobalSearch, type SearchHit } from '../composables/useGlobalSearch';
import { useFiles } from '../composables/useFiles';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useWorkspaceStore } from '../stores/workspace';
import { useI18n } from '../i18n';
import { useViewport } from '../composables/useViewport';
import { focusActiveEditorSoon } from '../lib/editor-focus';
import { headerSearch, moveSelection, shortPath } from '../lib/header-search';
import { placeMenuFromRect } from '../lib/menu-position';

const search = useGlobalSearch();
const files = useFiles();
const tabs = useTabsStore();
const tiles = useTilesStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();
const { isNarrow } = useViewport();

const DEBOUNCE_MS = 220;

const query = ref('');
const hits = ref<SearchHit[]>([]);
const loading = ref(false);
const open = ref(false);
const selectedIdx = ref(0);
const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const dropRef = ref<HTMLElement | null>(null);
const dropStyle = ref<Record<string, string>>({});

let debounceTimer: number | null = null;
// Monotonic request id: only the newest `search()` may write `hits`, so a slow
// earlier query cannot overwrite the results of what the user typed last
// (spec D7).
let requestSeq = 0;

const grouped = computed(() => {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits.value) {
    if (!map.has(h.file)) map.set(h.file, []);
    map.get(h.file)!.push(h);
  }
  return Array.from(map.entries());
});

const hasQuery = computed(() => query.value.trim().length > 0);
const showStatus = computed(
  () => !workspace.currentFolder || !hasQuery.value || (!hits.value.length && !loading.value),
);
const statusText = computed(() => {
  if (!workspace.currentFolder) return t('search.openFolder');
  if (!hasQuery.value) return t('search.typeToSearch');
  if (!hits.value.length && !loading.value) return t('search.noMatches');
  return '';
});

const expanded = computed(() => open.value && !isNarrow.value);
const showListbox = computed(() => expanded.value && !showStatus.value);
const activeOptionId = computed(() =>
  showListbox.value && hits.value.length ? `hsearch-opt-${selectedIdx.value}` : undefined,
);

watch(query, () => {
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void doSearch();
  }, DEBOUNCE_MS);
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
    if (seq !== requestSeq) return; // 过期结果：最新一次请求已接手
    hits.value = result;
    selectedIdx.value = 0;
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

/** Anchor the teleported dropdown under the box, clamped to the viewport. */
function recomputePosition() {
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(rect.width, 360), vw - 16);
  const placed = placeMenuFromRect(
    { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    { width, height: 0 },
  );
  const maxHeight = Math.max(0, Math.min(420, vh - placed.top - 8));
  dropStyle.value = {
    top: `${placed.top}px`,
    left: `${placed.left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  };
}

function openDrop() {
  if (open.value) {
    recomputePosition();
    return;
  }
  open.value = true;
  // 先同步测量，避免首帧出现在左上角再跳位。
  recomputePosition();
  void nextTick(recomputePosition);
}

function closeDrop() {
  open.value = false;
}

function onWindowResize() {
  if (open.value) recomputePosition();
}

function onDocScroll() {
  if (open.value) recomputePosition();
}

function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return;
  const target = e.target instanceof Node ? e.target : null;
  if (target && (rootRef.value?.contains(target) || dropRef.value?.contains(target))) return;
  // 点击外部只收起下拉，保留已输入的文本。
  closeDrop();
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('scroll', onDocScroll, true);
  document.addEventListener('pointerdown', onDocPointerDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('scroll', onDocScroll, true);
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
});

watch(
  () => headerSearch.focusSeq,
  async (seq) => {
    if (seq <= 0) return;
    // 预填是一次性的：消费后立即清掉，避免下一次 ⌘⇧F 复活旧标签。
    if (headerSearch.prefill) {
      query.value = headerSearch.prefill;
      headerSearch.prefill = '';
    }
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
    openDrop();
  },
  { immediate: true },
);

function clearQuery() {
  query.value = '';
  hits.value = [];
  selectedIdx.value = 0;
  inputRef.value?.focus();
  if (!open.value) openDrop();
}

async function openHit(hit: SearchHit) {
  try {
    await files.openPath(hit.file);
    nextTick(() => {
      window.dispatchEvent(
        new CustomEvent('solomd:outline-goto', {
          detail: { line: hit.line, paneId: tiles.focusedPaneId },
        }),
      );
    });
    closeDrop();
  } catch (e) {
    console.error('HeaderSearchBox: openPath failed', e);
  }
}

/** D3 — ⌘⇧↵ (Ctrl+Shift+Enter) opens all results in an editor tab. Plain
 *  Enter keeps opening the selected hit in place. */
function openAllResults() {
  const q = query.value.trim();
  if (!q) return;
  tabs.openInput('search', { query: q });
  closeDrop();
}

function onKey(e: KeyboardEvent) {
  // IME composition owns these keys (same guard as QuickSwitcher).
  if (e.isComposing || e.keyCode === 229) return;

  if (e.key === 'Escape') {
    // Stop here so Esc does not also close an unrelated popover underneath.
    e.preventDefault();
    e.stopPropagation();
    if (open.value) {
      // 第一下：只收起下拉，文本与焦点都留着。
      closeDrop();
    } else {
      // 第二下：清空并失焦，把键盘交还编辑器。
      query.value = '';
      hits.value = [];
      selectedIdx.value = 0;
      inputRef.value?.blur();
      focusActiveEditorSoon(() => tiles.focusedPaneId);
    }
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const wasOpen = open.value;
    if (!wasOpen) openDrop();
    // 首次展开时停在第一条命中；之后的按键才真正移动选中项。
    selectedIdx.value = wasOpen
      ? moveSelection(selectedIdx.value, delta, hits.value.length)
      : 0;
    return;
  }

  if (e.key === 'Enter') {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      openAllResults();
      return;
    }
    const hit = hits.value[selectedIdx.value];
    if (hit) {
      e.preventDefault();
      void openHit(hit);
    }
  }
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
  <div ref="rootRef" class="hsearch" data-no-drag>
    <Icons class="hsearch__icon" name="search" :size="14" aria-hidden="true" />
    <input
      ref="inputRef"
      v-model="query"
      class="hsearch__input"
      type="text"
      :placeholder="t('search.placeholder')"
      :aria-label="t('header.searchLabel')"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      :aria-controls="showListbox ? 'hsearch-listbox' : undefined"
      :aria-activedescendant="activeOptionId"
      autocomplete="off"
      spellcheck="false"
      @keydown="onKey"
      @focus="openDrop"
    />
    <span v-if="loading" class="hsearch__loading" aria-hidden="true">…</span>
    <button
      v-if="hasQuery"
      class="hsearch__clear"
      type="button"
      :title="t('header.searchClear')"
      :aria-label="t('header.searchClear')"
      @click="clearQuery"
    >×</button>

    <!-- Single root on purpose: the parent passes `class="toolbar__search"`,
         and a fragment root would drop it. Teleport lifts the dropdown to
         <body> so the title bar's overflow cannot clip it. -->
    <Teleport to="body">
      <div v-if="expanded" ref="dropRef" class="hsearch__drop" :style="dropStyle">
        <div v-if="showStatus" class="hsearch__empty">{{ statusText }}</div>
        <div v-else id="hsearch-listbox" class="hsearch__list" role="listbox">
          <div v-for="[file, fileHits] in grouped" :key="file" class="hsearch__group">
            <div class="hsearch__file" :title="file">{{ shortPath(file, workspace.currentFolder) }}</div>
            <div
              v-for="hit in fileHits"
              :id="`hsearch-opt-${hits.indexOf(hit)}`"
              :key="hit.line"
              class="hsearch__hit"
              :class="{ 'is-active': hits.indexOf(hit) === selectedIdx }"
              role="option"
              :aria-selected="hits.indexOf(hit) === selectedIdx"
              @click="openHit(hit)"
              @mouseenter="selectedIdx = hits.indexOf(hit)"
            >
              <span class="hsearch__lineno">L{{ hit.line }}</span>
              <span class="hsearch__snippet" v-html="highlight(hit.snippet)"></span>
            </div>
          </div>
        </div>
        <div class="hsearch__footer">
          <span>{{ t('search.hitCount', { n: hits.length }) }}</span>
          <button
            v-if="hasQuery"
            class="hsearch__open-all"
            type="button"
            :title="t('editorTab.openInEditor')"
            @mousedown.prevent
            @click="openAllResults"
          >{{ t('editorTab.openInEditor') }}</button>
          <span v-if="!isNarrow" class="key-hint">{{ t('search.keyHint') }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 胶囊输入：与 GlobalSearch / 命令面板的输入行同一观感（--fill-1 底、
   focus-within 换成 --bg + --ring-tight）。 */
.hsearch {
  display: flex;
  align-items: center;
  gap: 6px;
  /* Same as the icon buttons next to it (24px), so the field sits centred in
     the 36px menu row instead of protruding. */
  height: var(--ctl-size);
  padding: 0 9px;
  border-radius: var(--ctl-radius);
  background: var(--fill-1);
  color: var(--text-3);
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.hsearch:focus-within {
  background: var(--bg);
  /* 1px halo, not the 4px --ring: the focus frame must not look bigger than
     the field it belongs to. */
  box-shadow: var(--ring-tight);
}
.hsearch__icon {
  flex: none;
}
.hsearch__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: 13px var(--font-ui);
  color: var(--text);
}
.hsearch__input::placeholder {
  color: var(--text-3);
}
.hsearch__loading {
  flex: none;
  color: var(--accent);
  font-size: 14px;
}
.hsearch__clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  font: 13px/1 var(--font-ui);
  cursor: pointer;
}
.hsearch__clear:hover {
  color: var(--text);
  background: var(--fill-2);
}

/* 下拉与 .dropdown__menu 同一层（--z-pop），但 Teleport 到 body 且 fixed，
   所以不会被标题行的 overflow 裁剪。 */
.hsearch__drop {
  position: fixed;
  z-index: var(--z-pop);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-pop);
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-modal);
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text);
  user-select: none;
  -webkit-user-select: none;
  transform-origin: top left;
  animation: sm-menu-in var(--dur-fast) var(--ease-out);
}
.hsearch__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.hsearch__group {
  margin-bottom: 2px;
}
.hsearch__file {
  padding: 6px 12px 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hsearch__hit {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  padding: 3px 12px 3px 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.hsearch__hit:hover,
.hsearch__hit.is-active {
  background: var(--bg-hover, rgba(255, 159, 64, 0.12));
}
.hsearch__lineno {
  flex: none;
  width: 32px;
  font-size: 10px;
  color: var(--text-faint);
}
.hsearch__snippet {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
}
.hsearch__snippet :deep(mark) {
  background: var(--accent, #ff9f40);
  color: #fff;
  padding: 0 2px;
  border-radius: 2px;
}
.hsearch__empty {
  padding: 18px 14px;
  color: var(--text-faint);
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
}
.hsearch__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border-top: var(--bd-hair);
  font-size: 10px;
  color: var(--text-faint);
}
.hsearch__open-all {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.hsearch__open-all:hover {
  text-decoration: underline;
}
</style>
