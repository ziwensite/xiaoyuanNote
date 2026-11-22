/**
 * One renderer for a note's YAML frontmatter properties block.
 *
 * `renderMarkdown()` (preview / reading / split / exports), the Windows plain
 * live editor and the CodeMirror live-edit widget all call this function, so
 * frontmatter looks identical wherever it is rendered. The input is the raw
 * YAML between the fences — no `---` lines — exactly what
 * `markdown-it-front-matter` hands to its callback.
 *
 * `editable: true` renders the interactive Obsidian-style properties card:
 * clickable type icon + key on the left, an aligned value control on the
 * right, tag pills and an "add property" row. Type overrides come from the
 * SAME `usePropertiesStore` the sidebar inspector uses (`.xiaoyuan-note/
 * properties.json`), so both views agree. `frontmatter-editing.ts` handles
 * the menu and writes edits back into the active tab. Exports and slideshows
 * stay static by leaving `editable` off.
 */
import yaml from 'js-yaml';
import { inferDisplayMode, type DisplayMode } from './property-types';
import { usePropertiesStore } from '../stores/properties';
import { useSettingsStore } from '../stores/settings';

export interface FrontmatterRenderOptions {
  /** Render editable value controls. Interactive surfaces only. */
  editable?: boolean;
}

const IS_ZH = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh');
const TITLE_LABEL = IS_ZH ? '笔记属性' : 'Properties';
const EMPTY_LABEL = IS_ZH ? '没有值' : 'No value';
const ADD_LABEL = IS_ZH ? '添加笔记属性' : 'Add a property';
const TYPE_TITLE = IS_ZH ? '属性类型' : 'Property type';

/** Localized mode labels, shared with the type menu in frontmatter-editing. */
export const MODE_LABELS: Record<DisplayMode, string> = IS_ZH
  ? {
      text: '文本',
      number: '数字',
      date: '日期',
      boolean: '复选框',
      status: '状态',
      url: 'URL',
      tags: '列表',
      relation: '链接',
    }
  : {
      text: 'Text',
      number: 'Number',
      date: 'Date',
      boolean: 'Checkbox',
      status: 'Status',
      url: 'URL',
      tags: 'List',
      relation: 'Link',
    };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** js-yaml turns `2025-10-27` into a Date; show it as the ISO day it was. */
function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(displayValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Stroke-style icons matching Icons.vue, drawn before each property key
 *  (Obsidian-style). Kept inline so the card works everywhere v-html does. */
const MODE_ICON: Record<DisplayMode, string> = {
  text: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  number: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4 9.5h17M3 14.5h17"/>',
  date: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  boolean: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12l3 3 5-6"/>',
  status:
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  url: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  tags: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z"/><circle cx="8" cy="8" r="1.4"/>',
  relation:
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

/** Shared with the type menu (frontmatter-editing.ts). */
export function iconSvg(mode: DisplayMode): string {
  return (
    `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"` +
    ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MODE_ICON[mode]}</svg>`
  );
}

function plusSvg(): string {
  return (
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"' +
    ' stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  );
}

/** Display-mode override from the sidebar inspector's store. Reading the
 *  store here also wires reactivity: when `frontmatter-editing` changes an
 *  override, the reactive render (preview, Windows plain blocks) re-runs.
 *  Falls back to inference when no Pinia is active (tests). */
function effectiveMode(key: string, inferred: DisplayMode): DisplayMode {
  try {
    return usePropertiesStore().overrideFor(key) ?? inferred;
  } catch {
    return inferred;
  }
}

/** Tag pills + a small "add" input. The pills carry their text in
 *  `data-fm-tag-text` so the write-back layer can rebuild the array. */
function tagsHtml(key: string, value: unknown): string {
  const k = escapeHtml(key);
  const list = Array.isArray(value)
    ? value.map(displayValue).filter((s) => s !== '')
    : displayValue(value) !== ''
      ? [displayValue(value)]
      : [];
  const pills = list
    .map(
      (t) =>
        `<span class="md-prop__tag" data-fm-tag-text="${escapeHtml(t)}">${escapeHtml(t)}` +
        `<button type="button" class="md-prop__tag-x" data-fm-tag-remove="${k}"` +
        ` data-fm-tag-value="${escapeHtml(t)}" aria-label="remove">&times;</button></span>`,
    )
    .join('');
  return (
    `<span class="md-prop__tags" data-fm-tags="${k}">${pills}` +
    `<input type="text" class="md-prop__value md-prop__value--tag" data-fm-key="${k}"` +
    ` data-fm-mode="tags" placeholder="+" /></span>`
  );
}

function controlHtml(key: string, value: unknown, mode: DisplayMode): string {
  if (mode === 'tags') return tagsHtml(key, value);
  const k = escapeHtml(key);
  const attrs = `class="md-prop__value" data-fm-key="${k}" data-fm-mode="${mode}"`;
  const shown = displayValue(value);
  if (mode === 'boolean') {
    const isTrue = value === true || value === 'true';
    const first = isTrue ? 'true' : 'false';
    const second = isTrue ? 'false' : 'true';
    return `<select ${attrs}><option value="${first}" selected>${first}</option><option value="${second}">${second}</option></select>`;
  }
  if (mode === 'date') {
    // Editable text input (type a date by hand, e.g. 2025-10-27) with a calendar
    // icon INSIDE the box on the LEFT. Only the icon opens the in-app picker
    // (DatePickerPopover) via `xiaoyuan-note:open-fm-date`; the input itself stays
    // editable and writes back through the normal change handler.
    return (
      `<span class="md-prop__date-wrap" style="position:relative;display:inline-flex;align-items:center;flex:1;min-width:0">` +
      `<input type="text" class="md-prop__value md-prop__value--date"` +
      ` style="width:100%;padding-left:24px" data-fm-key="${k}" data-fm-mode="date"` +
      ` value="${escapeHtml(shown)}" placeholder="${EMPTY_LABEL}" />` +
      `<button type="button" class="md-prop__date-ico" data-fm-date-trigger data-fm-key="${k}"` +
      ` aria-label="${IS_ZH ? '选择日期' : 'Pick date'}"` +
      ` style="position:absolute;left:6px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;background:transparent;color:var(--text-muted,#8a8a8a);cursor:pointer;border-radius:4px">${iconSvg('date')}</button>` +
      `</span>`
    );
  }
  const type = mode === 'number' ? 'number' : mode === 'url' ? 'url' : 'text';
  return `<input type="${type}" ${attrs} value="${escapeHtml(shown)}" placeholder="${EMPTY_LABEL}" />`;
}

function rawBlock(raw: string): string {
  return `<pre class="md-frontmatter md-frontmatter--raw">${escapeHtml(raw)}</pre>`;
}

/** Initial collapse state: an in-session manual toggle wins (so a re-render
 *  keeps what the user picked), otherwise the "collapse note properties by
 *  default" setting decides — default is COLLAPSED. */
let userCollapsed: boolean | null = null;

/** Session-only manual toggle, called from the card's title row. */
export function setUserCollapsed(v: boolean): void {
  userCollapsed = v;
}

function collapsedInitially(): boolean {
  if (userCollapsed !== null) return userCollapsed;
  try {
    return useSettingsStore().frontmatterDefaultCollapsed;
  } catch {
    return true; // no active Pinia (tests): default collapsed
  }
}

/** Anything that is not a non-empty key/value map is shown verbatim, so a
 *  malformed block is never silently turned into an empty properties card. */
export function renderFrontmatterHtml(
  raw: string,
  options: FrontmatterRenderOptions = {},
): string {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return rawBlock(raw);
  }
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return rawBlock(raw);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return rawBlock(raw);

  if (!options.editable) {
    const rows = entries
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(displayValue(v))}</dd>`)
      .join('');
    return (
      `<div class="md-frontmatter">` +
      `<div class="md-frontmatter__title md-frontmatter__title--static">${TITLE_LABEL}</div>` +
      `<dl>${rows}</dl></div>`
    );
  }

  const rows = entries
    .map(([k, v]) => {
      // js-yaml parses `2025-10-27` as a Date; infer from the ISO string so
      // date-like keys still get a date control.
      const inferred = inferDisplayMode(k, v instanceof Date ? displayValue(v) : v);
      const mode = effectiveMode(k, inferred);
      const kHtml = escapeHtml(k);
      return (
        `<div class="md-prop" data-fm-mode="${mode}">` +
        `<span class="md-prop__key" title="${kHtml}">` +
        `<button type="button" class="md-prop__type" data-fm-menu="${kHtml}"` +
        ` data-fm-mode="${mode}" title="${TYPE_TITLE}">${iconSvg(mode)}</button>` +
        `${kHtml}</span>` +
        controlHtml(k, v, mode) +
        `</div>`
      );
    })
    .join('');
  const collapsed = collapsedInitially();
  return (
    `<div class="md-frontmatter md-frontmatter--editable${collapsed ? ' md-frontmatter--collapsed' : ''}">` +
    `<button type="button" class="md-frontmatter__title" data-fm-toggle aria-expanded="${collapsed ? 'false' : 'true'}">` +
    `<span class="md-frontmatter__chevron" aria-hidden="true">▾</span>${TITLE_LABEL}` +
    `</button>` +
    `<div class="md-prop__rows">${rows}</div>` +
    `<button type="button" class="md-prop__add" data-fm-add>${plusSvg()}${ADD_LABEL}</button>` +
    `</div>`
  );
}
