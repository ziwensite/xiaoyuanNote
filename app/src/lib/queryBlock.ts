/**
 * Embedded query / multi-dimensional-table block (the runtime half).
 *
 * This is the engine behind the ```` ```query ```` fence rendered inside a note
 * (see `Preview.vue::processQuery`) and behind the visual builder's live preview
 * (`ViewEditorDialog.vue`). It reuses the SAME machinery as the saved-views
 * system so a built table and an embedded block never disagree: the notes scope
 * is evaluated through `savedViews.evaluateTree` (which resolves relative dates
 * + relationship ops via the one bases engine), while the `tasks` / `lines`
 * scopes share the same operator semantics (`matchOp` mirrors `bases.matchFilter`)
 * over synthetic columns (`due` / `line` / `text` / `source`).
 *
 * Three scopes:
 *   - `notes`  — one row per note (Bases semantics; default).
 *   - `tasks`  — one row per checkbox task across the workspace, carrying its
 *               source note, line number and due date.
 *   - `lines`  — one row per non-empty body line carrying its source note + line.
 *
 * Two shapes are accepted (both round-trip through YAML):
 *   1. `{ view: <slug> }`      — embed an existing saved view (stays in sync).
 *   2. inline `{ from, filters, sort, columns, render, limit, search }`.
 *
 * `search` is a top-level keyword over the note's full text (`content`) for
 * notes, or over the task / line text for the other scopes.
 *
 * No Tauri / DOM access here — `buildQueryHtml` only emits a sanitized HTML
 * string so both the live preview (`v-html`) and the rendered note (Preview)
 * share one rendering path.
 */
import yaml from 'js-yaml';
import {
  inferColumns,
  getRawValue,
  formatMtime,
  formatIsoDate,
  parseRelativeDuration,
  type ColumnDef,
  type SortSpec,
} from './bases';
import type { FilterGroup, FilterLeaf } from './viewFile';
import { useSavedViewsStore } from '../stores/savedViews';
import { useWorkspaceIndexStore, type IndexEntry } from '../stores/workspaceIndex';
import { parseTaskMeta } from './tasks';

export type QueryScope = 'notes' | 'tasks' | 'lines';
export type QueryRender = 'table' | 'list';
type ColKind = 'text' | 'date' | 'number' | 'boolean' | 'array';

export interface QuerySpec {
  /** Data scope. Defaults to `notes`. */
  from?: QueryScope;
  /** `table` (default) or `list`. */
  render?: QueryRender;
  /** Embed an existing saved view by slug (or name). Inline fields are ignored. */
  view?: string;
  /** Inline filter tree (view vocabulary: `contains` / `has-tag` / …). */
  filters?: FilterGroup;
  sort?: SortSpec | null;
  /** Column ids to display. Empty = a sensible default set. */
  columns?: string[];
  /** Cap the number of rows. */
  limit?: number;
  /** Best-effort keyword over the note / task / line text. */
  search?: string;
  /** v5.0 — render rows/columns transposed (fields as rows, items as columns). */
  transpose?: boolean;
  /** v5.0 — per-column pixel widths, keyed by column id. */
  columnWidths?: Record<string, number>;
}

const SCOPES: QueryScope[] = ['notes', 'tasks', 'lines'];
const RENDERS: QueryRender[] = ['table', 'list'];

/** A single result row, regardless of scope. `entry` is always the source note,
 *  so note-column filters/values can be resolved against it. */
export interface QueryRow {
  kind: 'note' | 'task' | 'line';
  stem: string;
  path: string;
  /** Display title: note name / cleaned task text / line text. */
  title: string;
  /** 1-based line in the source file (tasks / lines only). */
  line?: number;
  /** Due date `YYYY-MM-DD` (tasks only). */
  due?: string | null;
  /** Raw text (task text or line text). */
  text?: string;
  /** Source note title (tasks / lines). */
  sourceTitle?: string;
  entry: IndexEntry;
}

export interface QueryResult {
  rows: QueryRow[];
  columns: ColumnDef[];
  from: QueryScope;
  render: QueryRender;
  /** Set when a referenced view is missing; rendering shows an error. */
  error?: string;
}

/** Parse a ```` ```query ```` fence body into a spec. Tolerant: malformed YAML
 *  or unknown enum values fall back to defaults rather than throwing, so one bad
 *  block can't break a note. */
export function parseQuerySpec(src: string): QuerySpec {
  let raw: unknown = null;
  try {
    raw = yaml.load(src);
  } catch {
    raw = null;
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const from = SCOPES.includes(o.from as QueryScope) ? (o.from as QueryScope) : undefined;
  const render = RENDERS.includes(o.render as QueryRender) ? (o.render as QueryRender) : undefined;
  const filters: FilterGroup | undefined =
    o.filters && typeof o.filters === 'object' ? (o.filters as FilterGroup) : undefined;

  let sort: SortSpec | null = null;
  if (o.sort && typeof o.sort === 'object' && typeof (o.sort as Record<string, unknown>).column === 'string') {
    const s = o.sort as Record<string, unknown>;
    sort = { column: String(s.column), dir: s.dir === 'asc' ? 'asc' : 'desc' };
  }

  const columns = Array.isArray(o.columns)
    ? (o.columns as unknown[]).filter((x) => typeof x === 'string') as string[]
    : undefined;
  const limit = typeof o.limit === 'number' && o.limit > 0 ? o.limit : undefined;
  const search = typeof o.search === 'string' && o.search.trim() ? o.search.trim() : undefined;
  const view = typeof o.view === 'string' && o.view.trim() ? o.view.trim() : undefined;
  const transpose = o.transpose === true ? true : undefined;
  const columnWidths =
    o.columnWidths && typeof o.columnWidths === 'object'
      ? (Object.fromEntries(
          Object.entries(o.columnWidths as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'number' && (v as number) > 0,
          ),
        ) as Record<string, number>)
      : undefined;

  return { from, render, filters, sort, columns, limit, search, view, transpose, columnWidths };
}

/** Serialize a spec to the YAML body of a ```` ```query ```` fence. */
export function serializeQuerySpec(spec: QuerySpec): string {
  const out: Record<string, unknown> = {};
  if (spec.from && spec.from !== 'notes') out.from = spec.from;
  out.render = spec.render ?? 'table';
  if (spec.view) {
    out.view = spec.view;
  } else {
    if (spec.filters && spec.filters.children && spec.filters.children.length) {
      out.filters = spec.filters;
    }
    if (spec.sort) out.sort = { column: spec.sort.column, dir: spec.sort.dir };
    // Keep an explicit empty array (a "blank" block) so it stays column-less
    // instead of falling back to the default column set on reload.
    if (spec.columns) out.columns = spec.columns;
  }
  if (spec.limit) out.limit = spec.limit;
  if (spec.search) out.search = spec.search;
  if (spec.transpose) out.transpose = true;
  if (spec.columnWidths && Object.keys(spec.columnWidths).length) {
    out.columnWidths = spec.columnWidths;
  }
  return yaml.dump(out, { lineWidth: 100, noRefs: true, sortKeys: false }).trimEnd();
}

// ---------- small value helpers (mirror bases.ts) ----------

function asString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
/** Coerce a date-ish value to epoch ms (also resolves `@today`). */
function toEpochMs(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '@today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    const n = Number(s);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

/** Evaluate one filter leaf against a pre-resolved value + column kind. */
function matchOp(leaf: FilterLeaf, raw: unknown, kind: ColKind): boolean {
  const op = leaf.op as string;
  switch (op) {
    case 'is-empty':
    case 'isEmpty':
      return isEmpty(raw);
    case 'isNotEmpty':
      return !isEmpty(raw);
    case 'contains':
    case 'notContains': {
      const needle = String(leaf.value ?? '').toLowerCase();
      if (!needle) return true;
      const hay = asString(raw).toLowerCase();
      return op === 'contains' ? hay.includes(needle) : !hay.includes(needle);
    }
    case 'starts-with':
    case 'startsWith': {
      const needle = String(leaf.value ?? '').toLowerCase();
      if (!needle) return true;
      return asString(raw).toLowerCase().startsWith(needle);
    }
    case 'endsWith': {
      const needle = String(leaf.value ?? '').toLowerCase();
      if (!needle) return true;
      return asString(raw).toLowerCase().endsWith(needle);
    }
    case 'equals':
    case 'eq': {
      const want = leaf.value;
      if (Array.isArray(raw)) return raw.some((x) => String(x) === String(want));
      return String(raw ?? '') === String(want ?? '');
    }
    case 'neq': {
      const want = leaf.value;
      if (Array.isArray(raw)) return !raw.some((x) => String(x) === String(want));
      return String(raw ?? '') !== String(want ?? '');
    }
    case 'matches': {
      const pattern = String(leaf.value ?? '');
      if (!pattern) return true;
      try {
        return new RegExp(pattern, 'i').test(asString(raw));
      } catch {
        return false;
      }
    }
    case 'has-tag': {
      const tags = Array.isArray(raw)
        ? raw.map(String)
        : asString(raw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const wanted = Array.isArray(leaf.value)
        ? (leaf.value as unknown[]).map(String)
        : [String(leaf.value ?? '')].filter(Boolean);
      if (wanted.length === 0) return true;
      return wanted.some((w) => tags.includes(w));
    }
    case '>':
    case 'gt':
    case '<':
    case 'lt':
    case 'gte':
    case 'lte': {
      const cmp = (a: number, b: number) =>
        op === '>' || op === 'gt'
          ? a > b
          : op === '<'
            ? a < b
            : op === 'lte'
              ? a <= b
              : a >= b;
      if (kind === 'date') {
        const a = toEpochMs(raw);
        const b = toEpochMs(leaf.value);
        if (a == null || b == null) return false;
        return cmp(a, b);
      }
      const a = asNumber(raw);
      const b = asNumber(leaf.value);
      if (a == null || b == null) return false;
      return cmp(a, b);
    }
    case 'after': {
      const a = toEpochMs(raw);
      const b = toEpochMs(leaf.value);
      if (a == null || b == null) return false;
      return a > b;
    }
    case 'before': {
      const a = toEpochMs(raw);
      const b = toEpochMs(leaf.value);
      if (a == null || b == null) return false;
      return a < b;
    }
    case 'on': {
      const a = toEpochMs(raw);
      const b = toEpochMs(leaf.value);
      if (a == null || b == null) return false;
      const da = new Date(a);
      const db = new Date(b);
      return (
        da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate()
      );
    }
    case 'inLast': {
      const span = parseRelativeDuration(leaf.value);
      if (span == null) return false;
      const a = toEpochMs(raw);
      if (a == null) return false;
      const now = Date.now();
      return a >= now - span && a <= now;
    }
    default:
      return true; // unknown op → don't filter
  }
}

function isGroup(child: FilterGroup | FilterLeaf): child is FilterGroup {
  return Array.isArray((child as FilterGroup).children);
}

/** Resolve a leaf against a row: synthetic columns come from the row, note
 *  columns from the source entry. */
function rowLeaf(row: QueryRow, leaf: FilterLeaf, noteCols: ColumnDef[]): boolean {
  const id = leaf.column;
  let raw: unknown;
  let kind: ColKind;
  if (id === 'name') {
    raw = row.title;
    kind = 'text';
  } else if (id === 'source') {
    raw = row.sourceTitle ?? row.entry.name;
    kind = 'text';
  } else if (id === 'due') {
    raw = row.due;
    kind = 'date';
  } else if (id === 'line') {
    raw = row.line;
    kind = 'number';
  } else if (id === 'text') {
    raw = row.text;
    kind = 'text';
  } else {
    const col = noteCols.find((c) => c.id === id);
    raw = col ? getRawValue(row.entry, col) : undefined;
    kind = (col?.kind as ColKind) ?? 'text';
  }
  return matchOp(leaf, raw, kind);
}

/** Recursively evaluate a filter tree against one row (AND/OR). */
function rowMatches(row: QueryRow, group: FilterGroup, noteCols: ColumnDef[]): boolean {
  const children = group.children ?? [];
  if (group.combinator === 'any') {
    if (children.length === 0) return false;
    return children.some((child) =>
      isGroup(child) ? rowMatches(row, child, noteCols) : rowLeaf(row, child, noteCols),
    );
  }
  return children.every((child) =>
    isGroup(child) ? rowMatches(row, child, noteCols) : rowLeaf(row, child, noteCols),
  );
}

function rowRawValue(r: QueryRow, id: string): unknown {
  if (id === 'name') return r.title;
  if (id === 'source') return r.sourceTitle ?? r.entry.name;
  if (id === 'due') return r.due;
  if (id === 'line') return r.line;
  if (id === 'text') return r.text;
  if (id === 'mtime') return r.entry.mtime;
  if (id === 'tags') return r.entry.tags ?? [];
  const fm = r.entry.frontmatter;
  if (fm && typeof fm === 'object') return (fm as Record<string, unknown>)[id.replace(/^fm:/, '')];
  return undefined;
}

function sortRows(rows: QueryRow[], sort: SortSpec): QueryRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = rowRawValue(a, sort.column);
    const vb = rowRawValue(b, sort.column);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

// ---------- column resolution ----------

const SYNTH_COLUMNS: Record<QueryScope, ColumnDef[]> = {
  notes: [],
  tasks: [
    { id: 'name', label: '任务', kind: 'text', source: 'builtin' },
    { id: 'source', label: '来源笔记', kind: 'text', source: 'builtin' },
    { id: 'due', label: '截止日', kind: 'date', source: 'builtin' },
    { id: 'line', label: '行号', kind: 'number', source: 'builtin' },
  ],
  lines: [
    { id: 'name', label: '行内容', kind: 'text', source: 'builtin' },
    { id: 'source', label: '来源笔记', kind: 'text', source: 'builtin' },
    { id: 'line', label: '行号', kind: 'number', source: 'builtin' },
  ],
};

function findNoteCol(id: string, entries: IndexEntry[]): ColumnDef | undefined {
  if (id.startsWith('fm:')) {
    const key = id.slice(3);
    return { id, label: key, kind: 'text', source: 'frontmatter', fmKey: key };
  }
  return inferColumns(entries).find((c) => c.id === id);
}

function resolveColumns(from: QueryScope, columnsReq: string[] | undefined, entries: IndexEntry[]): ColumnDef[] {
  // Explicit empty array → blank block (no columns yet); render a blank grid.
  if (columnsReq !== undefined && columnsReq.length === 0) return [];
  if (from === 'notes') {
    const cols = inferColumns(entries);
    if (columnsReq && columnsReq.length) {
      return columnsReq.map((id) => cols.find((c) => c.id === id)).filter((c): c is ColumnDef => !!c);
    }
    return cols;
  }
  const synth = SYNTH_COLUMNS[from];
  if (columnsReq && columnsReq.length) {
    const out = columnsReq
      .map((id) => synth.find((c) => c.id === id) ?? findNoteCol(id, entries))
      .filter((c): c is ColumnDef => !!c);
    if (!out.some((c) => c.id === 'name')) out.unshift(synth.find((c) => c.id === 'name')!);
    return out;
  }
  return synth;
}

/** Cell display value for a row + column (mirrors bases.getCellValue). */
function rowCellValue(row: QueryRow, col: ColumnDef): string {
  let raw: unknown;
  switch (col.id) {
    case 'name':
      raw = row.title;
      break;
    case 'source':
      raw = row.sourceTitle ?? row.entry.name;
      break;
    case 'due':
      raw = row.due;
      break;
    case 'line':
      raw = row.line;
      break;
    case 'text':
      raw = row.text;
      break;
    case 'mtime':
      raw = row.entry.mtime;
      break;
    case 'tags':
      raw = row.entry.tags ?? [];
      break;
    default:
      raw = getRawValue(row.entry, col);
  }
  if (raw == null || raw === '') return '';
  if (col.id === 'mtime' || col.kind === 'date') {
    if (col.id === 'mtime') return formatMtime(Number(raw));
    return formatIsoDate(String(raw));
  }
  if (col.kind === 'array') return Array.isArray(raw) ? raw.join(', ') : String(raw);
  if (col.kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? String(n) : String(raw);
  }
  if (col.kind === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

// ---------- resolution ----------

/** Resolve a spec against the live workspace index. Pure read; safe to call
 *  from a computed / render pass. */
export function resolveQuery(spec: QuerySpec): QueryResult {
  const index = useWorkspaceIndexStore();
  const saved = useSavedViewsStore();

  let from: QueryScope = spec.from ?? 'notes';
  let render: QueryRender = spec.render ?? 'table';
  let filters: FilterGroup = { combinator: 'all', children: [] };
  let sort: SortSpec | null = null;
  let columnsReq = spec.columns;

  if (spec.view) {
    const v = saved.views.find((x) => x.slug === spec.view || x.name === spec.view);
    if (!v) {
      return { rows: [], columns: [], from, render, error: `View not found: ${spec.view}` };
    }
    from = v.from ?? 'notes';
    render = v.render ?? 'table';
    filters = v.filters;
    sort = v.sort;
    if (v.columns.length) columnsReq = v.columns;
  } else {
    if (spec.filters) filters = spec.filters;
    sort = spec.sort ?? null;
  }

  // A blank block (columns: []) shows an empty grid to fill via the UI; skip
  // querying entirely so it renders with no columns and no data rows.
  if (columnsReq !== undefined && columnsReq.length === 0) {
    return { rows: [], columns: [], from, render };
  }

  const entries = index.entries ?? [];
  const noteCols = inferColumns(entries);
  let rows: QueryRow[] = [];

  if (from === 'notes') {
    // Notes share the full bases engine (relative dates + relationships).
    const matched = saved.evaluateTree(filters, sort);
    rows = matched.map((e) => ({
      kind: 'note' as const,
      stem: e.stem,
      path: e.path,
      title: e.name,
      entry: e,
    }));
  } else if (from === 'tasks') {
    for (const e of entries) {
      for (const t of e.tasks ?? []) {
        const meta = parseTaskMeta(t.text);
        const due = t.due ?? meta.due ?? null;
        rows.push({
          kind: 'task',
          stem: e.stem,
          path: e.path,
          title: meta.title || t.text,
          line: t.line,
          due,
          text: t.text,
          sourceTitle: e.title ?? e.name,
          entry: e,
        });
      }
    }
    if (filters.children && filters.children.length) {
      rows = rows.filter((r) => rowMatches(r, filters, noteCols));
    }
    if (sort) rows = sortRows(rows, sort);
  } else {
    // lines
    for (const e of entries) {
      const content = e.content ?? '';
      const lines = content.split(/\r?\n/);
      lines.forEach((ln, i) => {
        const text = ln.trim();
        if (!text) return;
        rows.push({
          kind: 'line',
          stem: e.stem,
          path: e.path,
          title: text,
          line: i + 1,
          text: ln,
          sourceTitle: e.title ?? e.name,
          entry: e,
        });
      });
    }
    if (filters.children && filters.children.length) {
      rows = rows.filter((r) => rowMatches(r, filters, noteCols));
    }
    if (sort) rows = sortRows(rows, sort);
  }

  // Top-level keyword search.
  if (spec.search) {
    const q = spec.search.toLowerCase();
    rows = rows.filter((r) => {
      if (from === 'notes') {
        const c = r.entry.content ?? '';
        return (
          c.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          (r.entry.summary && r.entry.summary.toLowerCase().includes(q))
        );
      }
      return (
        (r.text && r.text.toLowerCase().includes(q)) || r.title.toLowerCase().includes(q)
      );
    });
  }

  if (spec.limit) rows = rows.slice(0, spec.limit);

  const columns = resolveColumns(from, columnsReq, entries);
  return { rows, columns, from, render };
}

// ---------- HTML rendering ----------

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function renderTable(res: QueryResult, spec: QuerySpec): string {
  const widths = spec.columnWidths;
  // v5.0 — transposed view: fields become rows, result items become columns.
  if (spec.transpose) {
    const head =
      '<tr><th></th>' +
      res.rows.map((r, i) => `<th>${esc(r.title || '#' + (i + 1))}</th>`).join('') +
      '</tr>';
    const body = res.columns
      .map((col) => {
        const tds = res.rows.map((r) => `<td>${esc(rowCellValue(r, col))}</td>`).join('');
        return `<tr><th data-col-id="${esc(col.id)}">${esc(col.label)}</th>${tds}</tr>`;
      })
      .join('');
    return `<div class="qb qb--table" data-transpose="1"><table>${head}${body}</table></div>`;
  }
  // Blank block (no columns): render an empty grid with a hint to add columns.
  if (res.columns.length === 0) {
    return `<div class="qb qb--table"><table><tbody><tr><td class="qb-empty-row">点击表头 ＋ 或工具栏“＋列”添加列</td></tr></tbody></table></div>`;
  }
  const head =
    '<tr>' +
    res.columns
      .map((c) => {
        const w = widths && widths[c.id] ? ` style="width:${widths[c.id]}px"` : '';
        return `<th data-col-id="${esc(c.id)}"${w}>${esc(c.label)}</th>`;
      })
      .join('') +
    '</tr>';
  const body =
    res.rows.length === 0
      ? `<tr><td class="qb-empty-row" colspan="${res.columns.length}">暂无数据</td></tr>`
      : res.rows
          .map((row) => {
            const tds = res.columns
              .map((c) => {
                if (c.id === 'name') {
                  const name = esc(rowCellValue(row, c));
                  const tgt = row.kind === 'note' ? row.stem : `${row.stem}#L${row.line}`;
                  return `<td><a class="md-wikilink" data-wikilink-target="${esc(tgt)}">${name}</a></td>`;
                }
                return `<td>${esc(rowCellValue(row, c))}</td>`;
              })
              .join('');
            return `<tr>${tds}</tr>`;
          })
          .join('');
  return `<div class="qb qb--table"><table>${head}${body}</table></div>`;
}

function renderList(res: QueryResult): string {
  if (res.rows.length === 0) {
    return `<div class="qb qb--list"><ul><li class="qb-empty-row">暂无数据</li></ul></div>`;
  }
  const items = res.rows
    .map((row) => {
      const chips = res.columns
        .filter((c) => c.id !== 'name')
        .map((c) => {
          const v = rowCellValue(row, c);
          return v == null || v === '' ? '' : `<span class="qb__chip">${esc(v)}</span>`;
        })
        .filter(Boolean)
        .join('');
      const name = esc(row.title);
      const tgt = row.kind === 'note' ? row.stem : `${row.stem}#L${row.line}`;
      return `<li><a class="md-wikilink" data-wikilink-target="${esc(tgt)}">${name}</a>${
        chips ? `<span class="qb__chips">${chips}</span>` : ''
      }</li>`;
    })
    .join('');
  return `<div class="qb qb--list"><ul>${items}</ul></div>`;
}

/**
 * Render a spec to a sanitized HTML string. Used both by the rendered note
 * (Preview) and the builder's live preview. Returns an error/empty placeholder
 * when nothing matches or the spec is invalid.
 */
export function buildQueryHtml(spec: QuerySpec): string {
  let res: QueryResult;
  try {
    res = resolveQuery(spec);
  } catch (e) {
    return `<div class="qb qb--error">${esc(String((e as Error)?.message ?? e))}</div>`;
  }
  if (res.error) return `<div class="qb qb--error">${esc(res.error)}</div>`;
  // v5.0 — never collapse to a bare text line; an empty result still renders a
  // real grid with its headers so the block shows a fillable empty table.
  return res.render === 'list' ? renderList(res) : renderTable(res, spec);
}
