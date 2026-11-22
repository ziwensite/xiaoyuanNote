<script setup lang="ts">
/**
 * Create / edit a saved view (F5) — modal dialog.
 *
 * Opened by the `xiaoyuan-note:new-view` / `xiaoyuan-note:edit-view` window events (see
 * useSavedViews). Hosts {@link FilterBuilder} plus name / icon / color / sort
 * / column-visibility controls, and a LIVE match-count badge that re-evaluates
 * the draft tree against the index as you type. On save it persists through the
 * savedViews store (disk write) and, for a brand-new view, opens it in the
 * content area.
 *
 * Built from the design-system primitives in `@/ui` (DsModal / DsInput /
 * DsSelect / DsButton / DsChip) — no raw hex, consistent with the other panes.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from '../i18n';
import { useSavedViewsStore } from '../stores/savedViews';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useSavedViews, VIEW_NEW_EVENT, VIEW_EDIT_EVENT } from '../composables/useSavedViews';
import { buildQueryHtml, serializeQuerySpec, type QuerySpec } from '../lib/queryBlock';
import { useFiles } from '../composables/useFiles';
import { useTilesStore } from '../stores/tiles';
import {
  emptyView,
  slugify,
  uniqueSlug,
  type ViewFile,
} from '../lib/viewFile';
import { inferColumns, type SortSpec, type ColumnDef } from '../lib/bases';
import { DsButton, DsChip, DsInput, DsModal, DsSelect, type DsSelectOption } from '../ui';
import FilterBuilder from './FilterBuilder.vue';

const { t } = useI18n();
const store = useSavedViewsStore();
const index = useWorkspaceIndexStore();
const { openView } = useSavedViews();
const files = useFiles();
const tiles = useTilesStore();

const open = ref(false);
const editingSlug = ref<string | null>(null);

// Working copy — mutated freely, only committed on Save.
const draft = reactive<ViewFile>(emptyView('view', ''));

/** Columns offered in the filter builder. For `tasks` / `lines` the synthetic
 *  columns (`due` / `line` / `text` / `source`) are merged with the note
 *  columns so a user can also filter by tag / project of the source note. */
const columns = computed<ColumnDef[]>(() => {
  const noteCols = inferColumns(index.entries);
  if (draft.from === 'notes') return noteCols;
  const synth: ColumnDef[] =
    draft.from === 'tasks'
      ? [
          { id: 'name', label: '任务', kind: 'text', source: 'builtin' },
          { id: 'source', label: '来源笔记', kind: 'text', source: 'builtin' },
          { id: 'due', label: '截止日', kind: 'date', source: 'builtin' },
          { id: 'line', label: '行号', kind: 'number', source: 'builtin' },
        ]
      : [
          { id: 'name', label: '行内容', kind: 'text', source: 'builtin' },
          { id: 'source', label: '来源笔记', kind: 'text', source: 'builtin' },
          { id: 'line', label: '行号', kind: 'number', source: 'builtin' },
        ];
  return [...synth, ...noteCols];
});

/** Sort options = a "default (mtime desc)" sentinel + every column. */
const sortOptions = computed<DsSelectOption[]>(() => [
  { value: '', label: t('views.sortDefault') },
  ...columns.value.map((c) => ({ value: c.id, label: c.label })),
]);
const dirOptions = computed<DsSelectOption[]>(() => [
  { value: 'asc', label: t('views.asc') },
  { value: 'desc', label: t('views.desc') },
]);

const isEditing = computed(() => editingSlug.value !== null);

/** Live count of notes matching the draft tree (re-evaluates reactively). */
const liveCount = computed<number>(() => {
  void index.entries.length; // touch for reactivity
  try {
    return store.countMatches(draft.filters);
  } catch {
    return 0;
  }
});

function loadDraft(v: ViewFile) {
  draft.slug = v.slug;
  draft.name = v.name;
  draft.icon = v.icon;
  draft.color = v.color;
  draft.order = v.order;
  draft.columns = [...v.columns];
  draft.sort = v.sort ? { ...v.sort } : null;
  // Deep clone of the filter tree so edits don't mutate the store copy.
  draft.filters = JSON.parse(JSON.stringify(v.filters));
  draft.from = v.from ?? 'notes';
  draft.render = v.render ?? 'table';
}

function onNew() {
  editingSlug.value = null;
  loadDraft(emptyView('view', ''));
  open.value = true;
}

function onEdit(e: Event) {
  const slug = (e as CustomEvent).detail?.slug as string | undefined;
  if (!slug) return;
  const v = store.views.find((x) => x.slug === slug);
  if (!v) return;
  editingSlug.value = slug;
  loadDraft(v);
  open.value = true;
}

const EDIT_INLINE_EVENT = 'xiaoyuan-note:edit-query-block';

/** Default columns when an inline block carries none, so the preview is useful. */
function defaultColsFor(from: 'notes' | 'tasks' | 'lines'): string[] {
  if (from === 'tasks') return ['name', 'due', 'source'];
  if (from === 'lines') return ['name', 'line', 'source'];
  return ['name', 'summary', 'tags', 'mtime'];
}

/** Re-edit an inline ```query fence: open the builder pre-filled with its spec.
 *  The block is not a saved view, so saving creates a new one — or the user can
 *  "插入到笔记" to drop a fresh block (replacing the old one by hand). */
function onEditInline(e: Event) {
  const spec = (e as CustomEvent).detail?.spec as Partial<QuerySpec> | undefined;
  if (!spec) return;
  const from = spec.from ?? 'notes';
  const cols = spec.columns && spec.columns.length ? spec.columns : defaultColsFor(from);
  const v = emptyView('view', '');
  v.from = from;
  v.render = spec.render ?? 'table';
  v.filters = spec.filters ?? { combinator: 'all', children: [] };
  v.sort = spec.sort ?? null;
  v.columns = cols;
  editingSlug.value = null;
  loadDraft(v);
  open.value = true;
}

function close() {
  open.value = false;
}

function onModalUpdate(v: boolean) {
  open.value = v;
}

// ---- sort controls ---------------------------------------------------------

const sortColumn = computed<string>({
  get: () => draft.sort?.column ?? '',
  set: (col: string) => {
    if (!col) draft.sort = null;
    else draft.sort = { column: col, dir: draft.sort?.dir ?? 'desc' };
  },
});
const sortDir = computed<string>({
  get: () => draft.sort?.dir ?? 'desc',
  set: (dir) => {
    if (draft.sort) draft.sort = { ...draft.sort, dir: dir as 'asc' | 'desc' } as SortSpec;
  },
});

function toggleColumn(id: string) {
  const i = draft.columns.indexOf(id);
  if (i >= 0) draft.columns.splice(i, 1);
  else draft.columns.push(id);
}

function setFilters(g: ViewFile['filters']) {
  draft.filters = g;
}

// ---- save ------------------------------------------------------------------

const saving = ref(false);

async function save() {
  if (saving.value) return;
  const name = draft.name.trim() || t('views.untitled');
  saving.value = true;
  try {
    let slug = editingSlug.value;
    if (!slug) {
      // New view → derive a unique slug from the name.
      const taken = new Set(store.views.map((v) => v.slug));
      slug = uniqueSlug(name || slugify(name), taken);
      // Place new views at the end of the sidebar.
      draft.order = store.views.length;
    }
    const toSave: ViewFile = {
      slug,
      name,
      icon: draft.icon || undefined,
      color: draft.color || undefined,
      order: draft.order,
      columns: [...draft.columns],
      sort: draft.sort ? { ...draft.sort } : null,
      filters: JSON.parse(JSON.stringify(draft.filters)),
      from: draft.from,
      render: draft.render,
    };
    const saved = await store.save(toSave);
    const wasEditing = editingSlug.value !== null;
    open.value = false;
    if (!wasEditing) openView(saved.slug);
  } catch (e) {
    console.error('[ViewEditorDialog] save failed', e);
  } finally {
    saving.value = false;
  }
}

// ---- live preview + embed --------------------------------------------------

/** Build the HTML for the live preview with the same engine as the rendered
 *  note, so what you see here is exactly what lands in the note. */
const previewHtml = computed(() => {
  const spec: QuerySpec = {
    from: draft.from,
    render: draft.render,
    filters: draft.filters,
    sort: draft.sort,
    columns: draft.columns,
  };
  try {
    return buildQueryHtml(spec);
  } catch {
    return '';
  }
});

/** Open a note when its row is clicked in the preview. */
function onPreviewClick(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.('a.md-wikilink') as HTMLElement | null;
  if (!a) return;
  const stem = a.getAttribute('data-wikilink-target') || '';
  const entry = index.entries.find((x) => x.stem === stem);
  if (entry) files.openPath(entry.path, { bypassNewWindow: true });
}

/** Emit an inline ```query``` fence at the caret of the focused editor. */
function insertToNote() {
  const spec: QuerySpec = {
    from: draft.from,
    render: draft.render,
    filters: draft.filters,
    sort: draft.sort,
    columns: draft.columns,
  };
  const fence = '```query\n' + serializeQuerySpec(spec) + '\n```\n';
  window.dispatchEvent(
    new CustomEvent('xiaoyuan-note:insert-markdown', {
      detail: { snippet: fence, paneId: tiles.focusedPaneId },
    }),
  );
  open.value = false;
}

onMounted(() => {
  window.addEventListener(VIEW_NEW_EVENT, onNew as EventListener);
  window.addEventListener(VIEW_EDIT_EVENT, onEdit as EventListener);
  window.addEventListener(EDIT_INLINE_EVENT, onEditInline as EventListener);
});
onBeforeUnmount(() => {
  window.removeEventListener(VIEW_NEW_EVENT, onNew as EventListener);
  window.removeEventListener(VIEW_EDIT_EVENT, onEdit as EventListener);
  window.removeEventListener(EDIT_INLINE_EVENT, onEditInline as EventListener);
});
</script>

<template>
  <DsModal
    :model-value="open"
    :width="'600px'"
    @update:model-value="onModalUpdate"
  >
    <template #header>
      <h2 class="ved__title">{{ isEditing ? t('views.editorEdit') : t('views.editorNew') }}</h2>
      <span class="ved__live" :title="t('views.liveMatchTitle')">
        {{ t('views.liveMatch', { n: liveCount }) }}
      </span>
    </template>

    <div class="ved__body">
      <!-- Name / icon / color row -->
      <div class="ved__grid">
        <label class="ved__field ved__field--grow">
          <span class="ved__label">{{ t('views.name') }}</span>
          <DsInput
            v-model="draft.name"
            :placeholder="t('views.namePlaceholder')"
          />
        </label>
        <label class="ved__field ved__field--icon">
          <span class="ved__label">{{ t('views.icon') }}</span>
          <DsInput v-model="draft.icon" class="ved__input--icon" placeholder="#" />
        </label>
        <label class="ved__field ved__field--color">
          <span class="ved__label">{{ t('views.color') }}</span>
          <input v-model="draft.color" type="color" class="ved__color" :aria-label="t('views.color')" />
        </label>
      </div>

      <!-- Sort -->
      <div class="ved__grid">
        <label class="ved__field ved__field--grow">
          <span class="ved__label">{{ t('views.sortBy') }}</span>
          <DsSelect v-model="sortColumn" :options="sortOptions" />
        </label>
        <label class="ved__field ved__field--dir" v-if="draft.sort">
          <span class="ved__label">{{ t('views.sortDir') }}</span>
          <DsSelect v-model="sortDir" :options="dirOptions" />
        </label>
      </div>

      <!-- Scope + render mode -->
      <div class="ved__grid">
        <label class="ved__field ved__field--grow">
          <span class="ved__label">{{ t('views.scope') }}</span>
          <div class="ved__seg">
            <button type="button" :class="{ 'is-on': draft.from === 'notes' }" @click="draft.from = 'notes'">{{ t('views.asNotes') }}</button>
            <button type="button" :class="{ 'is-on': draft.from === 'tasks' }" @click="draft.from = 'tasks'">{{ t('views.asTasks') }}</button>
            <button type="button" :class="{ 'is-on': draft.from === 'lines' }" @click="draft.from = 'lines'">{{ t('views.asLines') }}</button>
          </div>
        </label>
        <label class="ved__field ved__field--grow">
          <span class="ved__label">{{ t('views.render') }}</span>
          <div class="ved__seg">
            <button type="button" :class="{ 'is-on': draft.render === 'table' }" @click="draft.render = 'table'">{{ t('views.asTable') }}</button>
            <button type="button" :class="{ 'is-on': draft.render === 'list' }" @click="draft.render = 'list'">{{ t('views.asList') }}</button>
          </div>
        </label>
      </div>

      <!-- Display columns -->
      <div class="ved__field">
        <span class="ved__label">{{ t('views.columns') }}</span>
        <div class="ved__chips">
          <button
            v-for="c in columns"
            :key="c.id"
            type="button"
            class="ved__chipbtn"
            @click="toggleColumn(c.id)"
          >
            <DsChip size="sm" :color="draft.columns.includes(c.id) ? 'var(--accent)' : undefined">
              {{ c.label }}
            </DsChip>
          </button>
        </div>
        <span class="ved__hint">{{ t('views.columnsHint') }}</span>
      </div>

      <!-- Filters -->
      <div class="ved__field">
        <span class="ved__label">{{ t('views.filters') }}</span>
        <FilterBuilder
          :model-value="draft.filters"
          :columns="columns"
          :depth="0"
          :max-depth="3"
          @update:model-value="setFilters"
        />
      </div>

      <!-- Live preview (same engine as the rendered note) -->
      <div class="ved__field">
        <span class="ved__label">{{ t('views.preview') }}</span>
        <div class="ved__preview" @click="onPreviewClick" v-html="previewHtml"></div>
      </div>
    </div>

    <template #footer>
      <DsButton variant="secondary" @click="close">{{ t('views.cancel') }}</DsButton>
      <DsButton variant="secondary" @click="insertToNote">{{ t('views.insert') }}</DsButton>
      <DsButton variant="primary" :loading="saving" @click="save">{{ t('views.save') }}</DsButton>
    </template>
  </DsModal>
</template>

<style scoped>
.ved__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.ved__live {
  margin-left: auto;
  margin-right: var(--sp-3);
  height: 22px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  background: var(--fill-1);
  border-radius: var(--r-full);
  padding: 0 var(--sp-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ved__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ved__grid {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-end;
}
.ved__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ved__field--grow { flex: 1 1 auto; }
.ved__field--icon { flex: 0 0 64px; }
.ved__field--color { flex: 0 0 56px; }
.ved__field--dir { flex: 0 0 140px; }
.ved__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}
.ved__hint {
  font-size: 12px;
  color: var(--text-3);
}
.ved__input--icon :deep(.ds-input) {
  text-align: center;
}
.ved__color {
  height: 32px;
  width: 100%;
  border: 0;
  border-radius: var(--r-md);
  background: var(--fill-1);
  cursor: pointer;
  padding: 3px;
  box-sizing: border-box;
}
.ved__color::-webkit-color-swatch-wrapper {
  padding: 0;
}
.ved__color::-webkit-color-swatch {
  border: 0;
  border-radius: var(--r-sm);
}
.ved__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ved__chipbtn {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  border-radius: var(--r-full);
  transition: opacity var(--dur-fast) var(--ease);
}
.ved__chipbtn:hover {
  opacity: 0.8;
}
.ved__chipbtn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.ved__seg {
  display: inline-flex;
  border: var(--bd-hair);
  border-radius: var(--r-md);
  overflow: hidden;
}
.ved__seg button {
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.ved__seg button + button {
  border-left: var(--bd-hair);
}
.ved__seg button.is-on {
  background: var(--accent);
  color: var(--accent-strong-fg);
}
.ved__seg button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ved__preview {
  border: var(--bd-hair);
  border-radius: var(--r-md);
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  background: var(--bg);
}
</style>
