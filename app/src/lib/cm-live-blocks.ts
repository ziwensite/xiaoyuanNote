/**
 * CodeMirror 6 block-level live-preview decorations for Markdown.
 *
 * Two block widgets, both gated on the cursor NOT being in the matched
 * block (move cursor in → source comes back):
 *
 *   1. **Image lines.** A line whose content is only `![alt](url)` (whitespace
 *      around it is fine, no other text) renders as an `<img>` element.
 *      Falls back to the source line if the image can't load.
 *
 *   2. **Tables.** A contiguous block of pipe-delimited lines with a
 *      separator row (the standard GFM table shape) renders as a real
 *      `<table>`. Tables don't need `extractImageRoot`, just markdown-it
 *      run on the source slice.
 *
 * This is the v3.6 implementation of issue #44 — "live edit should support
 * image / table live render". Companion to `cm-live-preview.ts` which
 * handles inline marker hiding.
 */

import { RangeSetBuilder, StateField, StateEffect, Prec, EditorSelection, Transaction, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isDragging, isDragEndTransaction } from './cm-drag-aware';
import { renderFrontmatterHtml } from './frontmatter-render';
import { extractFrontmatterYaml } from './frontmatter';
import { frozenFieldDuringComposition, isImeSafeFlushTransaction } from './cm-ime-guard';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';

// Block decorations (Decoration.replace with `block: true`) MUST come from a
// StateField — CM6 throws "Block decorations may not be specified via plugins"
// if a ViewPlugin emits them. So this whole module is a state field, not a
// view plugin. `relayoutEffect` lets the async Mermaid render (and any other
// out-of-band trigger) ask the field to recompute.
const relayoutEffect = StateEffect.define<null>();

// Bumped when the workspace index changes so inline ```query widgets remount
// with fresh results even though their source YAML is byte-identical (eq() keys
// on it). Editor.vue calls `bumpQueryDataVersion` on `xiaoyuan-note://index-updated`.
let queryDataVersion = 0;
export function bumpQueryDataVersion(): void {
  queryDataVersion += 1;
}

// The editor view currently in focus. Set by the relayout ViewPlugin so the
// interactive query widget can commit edits (dispatch) to the right pane even
// when several editors are open.
let activeView: EditorView | null = null;
/** The editor view currently (or last) in focus. Used to route inserts to the
 *  right pane even when a modal dialog currently holds DOM focus. */
export function getActiveView(): EditorView | null {
  return activeView;
}
import {
  installSvgImageFallbacks,
  isLocalSvgPath,
  resolveImagePath,
  resolveImageSrc,
  rewriteImageUrls,
} from './image-resolve';
import { renderMarkdown, extractImageRoot } from './markdown';
import { findHtmlBlockEnd } from './html-live-render';
import { openRenderedLink } from './link-open';
import {
  extractImageReferenceDefinitions,
  findMarkdownImagesInLine,
  parseImageAltSize,
} from './md-image-url';
import { plantumlSvgUrl } from './plantuml';
import { bindMermaidInteractions, initMermaid } from './mermaid-lazy';
import {
  buildQueryHtml,
  parseQuerySpec,
  serializeQuerySpec,
  type QuerySpec,
  type QueryScope,
} from './queryBlock';
import { inferColumns } from './bases';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import type { FilterLeaf } from './viewFile';
import type { CtxActionId } from './context-menus';
import {
  ADDABLE_TYPES,
  BOX_PROPS,
  COMPONENT_DEFS,
  STYLE_OPTIONS,
  TONE_OPTIONS,
  findNode,
  getComponentDataVersion,
  makeNode,
  makeRoot,
  parseComponentFenceRef,
  type ComponentFenceRef,
  type ComponentNode,
} from './component-system';
import { useComponentsStore } from '../stores/components';
import { getKatex, onRenderDepsChange, renderDepsVersion } from './render-deps';
import {
  parseTldrawFence,
  TLDRAW_DEFAULT_HEIGHT,
  type BoardThemeTokens,
} from './tldraw-board';

// v4.3.0 issue #57a — live-render math + Mermaid blocks in the editor.
// Mermaid is async; we render lazily into a counter-keyed cache so the
// widget toDOM() can pull a ready SVG without re-rendering. The cache is
// keyed on theme + source text → SVG so the same diagram across multiple panes
// renders once per theme.
//
// #354: this used to render with theme 'default' always, so in a dark theme
// the diagram's dark lines and labels sat on the dark editor background and
// all but vanished. The theme now comes from the editor (same mapping as
// preview), and it's part of the key, so switching theme renders fresh SVG
// instead of reusing the light one.
type MermaidTheme = 'dark' | 'default';
const mermaidSvgCache = new Map<
  string,
  { svg: string | null; bindFunctions?: ((el: Element) => void) | null; error: string | null }
>();
let mermaidIdSeq = 0;
const mermaidKey = (source: string, theme: MermaidTheme) => `${theme}\u0000${source}`;
// In-flight renders. A second caller has to wait for the same render, not
// return straight away: the widget's toDOM relies on the promise resolving
// only once the SVG is in the cache, to trigger the rebuild that swaps the
// "Rendering…" placeholder for the diagram. Returning early made that rebuild
// run before the render finished, and the placeholder stayed for good.
const mermaidInflight = new Map<string, Promise<void>>();
function ensureMermaidRendered(source: string, theme: MermaidTheme): Promise<void> {
  const key = mermaidKey(source, theme);
  const pending = mermaidInflight.get(key);
  if (pending) return pending;
  if (mermaidSvgCache.has(key)) return Promise.resolve();
  // Reserve the slot first so concurrent calls don't double-render.
  mermaidSvgCache.set(key, { svg: null, error: null });
  const job = (async () => {
    try {
      const id = `cm-mmd-${++mermaidIdSeq}`;
      const mermaid = await initMermaid({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
      });
      const { svg, bindFunctions } = await mermaid.render(id, source);
      mermaidSvgCache.set(key, { svg, bindFunctions, error: null });
    } catch (e) {
      mermaidSvgCache.set(key, { svg: null, error: (e as Error).message });
    } finally {
      mermaidInflight.delete(key);
    }
  })();
  mermaidInflight.set(key, job);
  return job;
}

// Pipe table heuristic: a header line, a separator (`---` / `:---:`), then
// at least one body row. We don't try to parse the GFM grammar ourselves —
// markdown-it does that — we only need a cheap detector to decide which
// line ranges to swap with widgets.
// #480 — tables inside blockquotes (`> | a | b |`) carry leading `>` markers;
// strip the quote prefix when checking pipe rows, while requiring every row
// of the table to share the same blockquote nesting depth.
function quoteDepth(line: string): number {
  const m = line.match(/^\s*((?:>\s*)+)/);
  if (!m) return 0;
  return (m[1].match(/>/g) || []).length;
}
function stripQuotePrefix(line: string): string {
  return line.replace(/^\s*(?:>\s*)+/, '');
}
function isPipeRow(line: string, expectedQuoteDepth?: number): boolean {
  if (expectedQuoteDepth !== undefined && quoteDepth(line) !== expectedQuoteDepth) return false;
  const trimmed = stripQuotePrefix(line).trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}
function isSeparatorRow(line: string, expectedQuoteDepth?: number): boolean {
  const trimmed = stripQuotePrefix(line).trim();
  // `| --- | :---: |` etc. Only `:`, `-`, ` `, `|` characters allowed,
  // and at least one `-` per cell.
  return (
    isPipeRow(line, expectedQuoteDepth) &&
    // `-` must be last in the class so it's a literal, not the range `:`..`|`
    // (which excludes `-` at 0x2D and made every real separator row fail —
    // tables never collapsed to a widget in live-edit).
    /^\|[\s:|-]+\|$/.test(trimmed) &&
    /-{3,}/.test(trimmed)
  );
}

// Images report their real height only after they load, and CM6 does not
// re-measure widget heights on its own — until something else triggers a
// measure, the height map (gutter numbers, scroll anchoring, click→pos
// mapping) is off by the full image height. Nudge the relayout plugin once
// per load burst, and remember natural sizes so re-rendered widgets reserve
// the right box up front (no layout shift at all on subsequent renders —
// `.cm-live-block img { max-width:100%; height:auto }` keeps the attribute
// pair behaving as an aspect-ratio hint, not a fixed size).
const imageNaturalSizes = new Map<string, { w: number; h: number }>();
let relayoutTimer: ReturnType<typeof setTimeout> | null = null;

// KaTeX / highlight.js finished loading: rebuild, so widgets rendered without
// them (see the `deps` field on each) remount with the real output.
onRenderDepsChange(() => {
  try {
    window.dispatchEvent(new CustomEvent('xiaoyuan-note:cm-relayout'));
  } catch {}
});

function scheduleImageRelayout(): void {
  if (relayoutTimer) return;
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    try {
      window.dispatchEvent(new CustomEvent('xiaoyuan-note:cm-relayout'));
    } catch {}
  }, 50);
}

function trackImageHeights(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const cached = imageNaturalSizes.get(img.src);
    if (
      cached &&
      !img.hasAttribute('width') &&
      !img.hasAttribute('height') &&
      !img.style.width &&
      !img.style.height
    ) {
      img.width = cached.w;
      img.height = cached.h;
    }
    const done = () => {
      if (img.naturalWidth && img.naturalHeight) {
        imageNaturalSizes.set(img.src, { w: img.naturalWidth, h: img.naturalHeight });
      }
      scheduleImageRelayout();
    };
    if (img.complete) {
      // Cache hit: `complete` is already true here, but the box gets its real
      // height only after the (async) decode + this widget entering layout —
      // both past CM's initial measure. Still needs a relayout pass.
      done();
      continue;
    }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }
}

/** 1-based number of the closing fence of a leading frontmatter block, or
 *  null. Mirrors `splitLayout` in lib/frontmatter.ts (BOM, CRLF, `...`). */
function findFrontmatterEndLine(lines: string[]): number | null {
  const first = (lines[0] ?? '').replace(/^\uFEFF/, '').replace(/\r$/, '');
  if (first !== '---') return null;
  for (let n = 1; n < lines.length; n += 1) {
    const t = lines[n].replace(/\r$/, '');
    if (t === '---' || t === '...') return n + 1;
  }
  return null;
}

/** The leading YAML frontmatter block, rendered as the same properties card
 *  the preview shows. Moving the cursor into the block drops this decoration,
 *  so the raw YAML comes back for editing. */
class FrontmatterWidget extends WidgetType {
  private readonly rawYaml: string;

  constructor(rawYaml: string) {
    super();
    this.rawYaml = rawYaml;
  }

  eq(other: FrontmatterWidget): boolean {
    return other.rawYaml === this.rawYaml;
  }

  toDOM(view: EditorView): HTMLElement {
    const holder = document.createElement('div');
    holder.className = 'cm-frontmatter';
    holder.innerHTML = renderFrontmatterHtml(this.rawYaml, { editable: true });
    // Clicking anywhere OTHER than a value control puts the caret back on the
    // first YAML line; the decoration then unmounts and the source is editable.
    holder.addEventListener('mousedown', (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (ev.button !== 0 || !view) return;
      if (target?.closest?.('a, input, select, textarea, button')) return;
      ev.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(0) });
      view.focus();
    });
    return holder;
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target as Element | null;
    // Let typing / selecting inside a value control reach the DOM, not CM6.
    if (target?.closest?.('input, select, textarea')) return true;
    return event.type === 'mousedown' && event instanceof MouseEvent && event.button === 0;
  }
}

class ImageWidget extends WidgetType {
  private readonly src: string;
  private readonly alt: string;
  private readonly localPath: string | null;
  private readonly lineNumber: number;
  private readonly inline: boolean;
  private readonly cleanAlt: string;
  private readonly width: string | null;
  private readonly height: string | null;

  // Plain field assignments, not TS parameter properties: node --test strips
  // types only and rejects parameter-property syntax, and the regression
  // tests below build real decorations through liveBlocksExtension().
  constructor(
    src: string,
    alt: string,
    localPath: string | null = null,
    lineNumber: number = 0,
    inline: boolean = false,
  ) {
    super();
    this.src = src;
    this.alt = alt;
    this.localPath = localPath;
    this.lineNumber = lineNumber;
    this.inline = inline;
    const parsed = parseImageAltSize(alt);
    this.cleanAlt = parsed.alt;
    this.width = parsed.width;
    this.height = parsed.height;
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.localPath === this.localPath &&
      other.lineNumber === this.lineNumber &&
      other.inline === this.inline
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement(this.inline ? 'span' : 'div');
    wrap.className = this.inline
      ? 'cm-live-block cm-live-block--image cm-live-block--image-inline'
      : 'cm-live-block cm-live-block--image';
    const img = document.createElement('img');
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.referrerPolicy = 'no-referrer';
    img.alt = this.cleanAlt;
    img.loading = 'lazy';
    img.draggable = false;
    if (this.width) img.style.width = this.width;
    if (this.height) img.style.height = this.height;
    if (this.lineNumber > 0) img.dataset.xiaoyuanNoteLine = String(this.lineNumber);
    if (this.localPath) img.dataset.xiaoyuanNoteLocalSrc = this.localPath;
    img.src = this.src;
    img.onerror = () => {
      // Image failed to load — fall back to a small "broken image" caption
      // rather than a giant empty box. The source text is one cursor-move
      // away regardless.
      if (this.localPath) return;
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `🖼 ${this.cleanAlt || this.src}`;
    };
    wrap.appendChild(img);
    installSvgImageFallbacks(wrap);
    trackImageHeights(wrap);
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === 'contextmenu') return true;
    if (event instanceof MouseEvent && event.button === 2) return true;
    return false;
  }
}

/**
 * #504 — Compute the character offset within a Markdown pipe-table row line
 * (`| col0 | col1 |`) for the `colIdx`-th cell (0-based), ignoring escaped
 * `\|` and pipes inside inline code spans. `clickRatio` (0..1) maps the
 * horizontal click position across the trimmed cell text.
 */
export function findTableCellOffsetInLine(
  lineText: string,
  colIdx: number,
  clickRatio = 1,
): number {
  const n = lineText.length;
  const pipes: number[] = [];
  let p = 0;
  while (p < n) {
    if (lineText[p] === '`') {
      let ticks = 1;
      while (p + ticks < n && lineText[p + ticks] === '`') ticks++;
      let q = p + ticks;
      let closed = -1;
      while (q < n) {
        if (lineText[q] === '`') {
          let ticks2 = 1;
          while (q + ticks2 < n && lineText[q + ticks2] === '`') ticks2++;
          if (ticks2 === ticks) {
            closed = q + ticks2;
            break;
          }
          q += ticks2;
        } else {
          q++;
        }
      }
      p = closed >= 0 ? closed : p + ticks;
      continue;
    }
    if (lineText[p] === '\\' && p + 1 < n) {
      p += 2;
      continue;
    }
    if (lineText[p] === '|') {
      pipes.push(p);
    }
    p++;
  }
  if (pipes.length === 0) return n;
  const maxCellIdx = Math.max(0, pipes.length - 2);
  const cellIdx = Math.max(0, Math.min(colIdx, maxCellIdx));
  const cellStart = pipes[cellIdx] + 1;
  const cellEnd = pipes[cellIdx + 1] ?? n;
  const rawCell = lineText.slice(cellStart, cellEnd);
  const firstNonSpace = rawCell.search(/\S/);
  if (firstNonSpace < 0) {
    return Math.min(cellStart + 1, cellEnd);
  }
  const lastNonSpace = rawCell.trimEnd().length;
  const contentStart = cellStart + firstNonSpace;
  const contentEnd = cellStart + lastNonSpace;
  const ratio = Math.max(0, Math.min(1, Number.isFinite(clickRatio) ? clickRatio : 1));
  return contentStart + Math.round((contentEnd - contentStart) * ratio);
}

class TableWidget extends WidgetType {
  // Cells can hold math / code: a widget built before KaTeX or highlight.js
  // arrived must not count as equal to the one built after (render-deps.ts).
  private readonly deps = renderDepsVersion();
  private readonly source: string;
  private readonly imageRoot: string | null;
  private readonly filePath?: string;
  private readonly startLine: number;

  constructor(
    source: string,
    imageRoot: string | null = null,
    filePath?: string,
    startLine: number = 0,
  ) {
    super();
    this.source = source;
    this.imageRoot = imageRoot;
    this.filePath = filePath;
    this.startLine = startLine;
  }

  eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.imageRoot === this.imageRoot &&
      other.filePath === this.filePath &&
      other.startLine === this.startLine &&
      other.deps === this.deps
    );
  }

  toDOM(view?: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--table';
    // Render the table source through the same markdown pipeline used by the
    // preview pane so we get GFM alignment, inline formatting, etc. for free.
    // We strip everything except the table rows from the rendered output.
    const rawHtml = renderMarkdown(this.source);
    wrap.innerHTML = rewriteImageUrls(rawHtml, this.imageRoot, this.filePath);
    installSvgImageFallbacks(wrap);
    trackImageHeights(wrap);

    // #504 — Clicking a rendered table cell in Live mode places the caret at
    // the exact Markdown table row (header or body row) and column cell offset,
    // and anchors scrollTop so the clicked row stays under the mouse cursor
    // instead of jumping to the very start or end of the table.
    wrap.addEventListener('mousedown', (ev: MouseEvent) => {
      if (ev.button !== 0 || !view || this.startLine <= 0) return;
      const target = ev.target as Element | null;
      if (target?.closest?.('a')) return;
      const cell = target?.closest?.('th, td') as HTMLTableCellElement | null;
      const tr = target?.closest?.('tr') as HTMLTableRowElement | null;
      if (!cell && !tr) return;

      let targetLineNum = this.startLine;
      const sectionTag = tr?.parentElement?.tagName;
      if (sectionTag === 'THEAD') {
        targetLineNum = this.startLine;
      } else if (sectionTag === 'TBODY' && tr?.parentElement) {
        const rows = Array.from(tr.parentElement.children).filter((el) => el.tagName === 'TR');
        const rowIdx = Math.max(0, rows.indexOf(tr));
        targetLineNum = this.startLine + 2 + rowIdx;
      } else if (tr) {
        const table = tr.closest('table');
        const allRows = table ? Array.from(table.querySelectorAll('tr')) : [];
        const idx = allRows.indexOf(tr);
        targetLineNum = idx <= 0 ? this.startLine : this.startLine + 1 + idx;
      }
      targetLineNum = Math.max(1, Math.min(view.state.doc.lines, targetLineNum));

      const colIdx = cell ? Math.max(0, cell.cellIndex) : 0;
      let clickRatio = 1;
      if (cell) {
        const rect = cell.getBoundingClientRect();
        const innerLeft = rect.left + 12;
        const innerWidth = Math.max(1, rect.width - 24);
        clickRatio = Math.max(0, Math.min(1, (ev.clientX - innerLeft) / innerWidth));
      }

      const docLine = view.state.doc.line(targetLineNum);
      const colOffset = findTableCellOffsetInLine(docLine.text, colIdx, clickRatio);
      const targetPos = docLine.from + colOffset;
      const clickClientY = ev.clientY;

      ev.preventDefault();
      ev.stopPropagation();
      view.focus();
      view.dispatch({
        selection: { anchor: targetPos },
        userEvent: 'select.pointer',
      });
      requestAnimationFrame(() => {
        const coords = view.coordsAtPos(targetPos);
        if (!coords) return;
        const scroller = view.scrollDOM;
        const scrollerRect = scroller.getBoundingClientRect();
        const desiredY = Math.max(
          scrollerRect.top + 24,
          Math.min(scrollerRect.bottom - 24, clickClientY),
        );
        const delta = coords.top - desiredY;
        if (Math.abs(delta) > 4) {
          scroller.scrollTop += delta;
        }
      });
    });

    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    if (
      event.type === 'mousedown' &&
      event instanceof MouseEvent &&
      event.button === 0 &&
      !(event.target as Element | null)?.closest?.('a') &&
      !!(event.target as Element | null)?.closest?.('th, td, tr')
    ) {
      return true;
    }
    return false;
  }
}

/** Raw block HTML rendered with the same markdown-it pipeline as Preview.vue. */
class HtmlBlockWidget extends WidgetType {
  private readonly deps = renderDepsVersion();
  private readonly source: string;
  private readonly imageRoot: string | null;
  private readonly filePath?: string;
  private readonly lineNumber: number;

  constructor(
    source: string,
    imageRoot: string | null,
    filePath?: string,
    lineNumber: number = 0,
  ) {
    super();
    this.source = source;
    this.imageRoot = imageRoot;
    this.filePath = filePath;
    this.lineNumber = lineNumber;
  }

  eq(other: HtmlBlockWidget): boolean {
    return (
      other.source === this.source &&
      other.imageRoot === this.imageRoot &&
      other.filePath === this.filePath &&
      other.lineNumber === this.lineNumber &&
      other.deps === this.deps
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--html';
    wrap.innerHTML = rewriteImageUrls(
      renderMarkdown(this.source),
      this.imageRoot,
      this.filePath,
    );
    if (this.lineNumber > 0) {
      for (const img of Array.from(wrap.querySelectorAll('img'))) {
        img.dataset.xiaoyuanNoteLine = String(this.lineNumber);
      }
    }
    installSvgImageFallbacks(wrap);
    trackImageHeights(wrap);
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === 'contextmenu') return true;
    if (event instanceof MouseEvent && event.button === 2) return true;
    return false;
  }
}

// v4.3.0 issue #57a — block math (`$$...$$`). Goes through markdown-it so
// it picks up the same KaTeX renderer used in the preview pane. We render
// the wrapping `$$\n…\n$$` literal so markdown-it-katex sees it as block
// math and emits `<span class="katex-display">`.
class MathWidget extends WidgetType {
  private readonly deps = renderDepsVersion();
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.deps === this.deps;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--math';
    try {
      wrap.innerHTML = renderMarkdown(this.source);
    } catch (e) {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `∑ ${(e as Error).message}`;
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.5.5 — inline math (`$…$`). Standard markdown parsers don't emit
// inline-math nodes, so cm-live-render's syntax-tree pass can't see them.
// We detect spans with inlineMathSpans() below and replace each with a
// KaTeX render while the caret is off the line (click in → source returns).
class InlineMathWidget extends WidgetType {
  private readonly deps = renderDepsVersion();
  private readonly tex: string;

  constructor(tex: string) {
    super();
    this.tex = tex;
  }

  eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex && other.deps === this.deps;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-inline-math';
    // KaTeX still loading (render-deps.ts): show the source, which is what
    // the line reads without the widget; the load triggers a rebuild.
    const katex = getKatex();
    if (!katex) {
      span.textContent = `$${this.tex}$`;
      return span;
    }
    try {
      span.innerHTML = katex.renderToString(this.tex, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      span.classList.add('cm-live-inline-math--broken');
      span.textContent = `$${this.tex}$`;
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Detect inline math `$…$` spans within a single line. Offsets are relative
// to the line start. Guards against the common false positives so prose isn't
// mangled:
//   - `$$` block-math delimiters are skipped (handled as block widgets).
//   - `$` inside inline code spans (`` `…$…` ``) is ignored.
//   - escaped `\$` neither opens nor closes.
//   - currency like `$5` / `$5 and $10`: an opening `$` can't be followed by
//     whitespace, and a closing `$` followed by a digit is rejected.
//   - empty or space-padded content (`$ $`, `$x $`) is rejected.
function inlineMathSpans(text: string): Array<{ start: number; end: number; tex: string }> {
  const spans: Array<{ start: number; end: number; tex: string }> = [];
  const n = text.length;
  // Mask out inline-code spans (matched backtick runs of equal length).
  const code = new Array<boolean>(n).fill(false);
  for (let p = 0; p < n; ) {
    if (text[p] === '`') {
      let len = 1;
      while (p + len < n && text[p + len] === '`') len++;
      let q = p + len;
      let closed = -1;
      while (q < n) {
        if (text[q] === '`') {
          let len2 = 1;
          while (q + len2 < n && text[q + len2] === '`') len2++;
          if (len2 === len) { closed = q + len2; break; }
          q += len2;
        } else q++;
      }
      if (closed >= 0) { for (let k = p; k < closed; k++) code[k] = true; p = closed; }
      else p += len;
    } else p++;
  }
  let i = 0;
  while (i < n) {
    if (code[i]) { i++; continue; }
    // #433 — LaTeX `\( ... \)` and inline `\[ ... \]` delimiters (DeepSeek / ChatGPT).
    if (
      text[i] === '\\' &&
      (i === 0 || text[i - 1] !== '\\') &&
      (text[i + 1] === '(' || text[i + 1] === '[')
    ) {
      const closeChar = text[i + 1] === '[' ? ']' : ')';
      let j = i + 2;
      let close = -1;
      while (j < n - 1) {
        if (!code[j] && text[j] === '\\' && text[j + 1] === closeChar) {
          let bs = 0;
          let k = j;
          while (k >= i + 2 && text[k] === '\\') { bs++; k--; }
          if (bs % 2 === 1) { close = j; break; }
        }
        j++;
      }
      if (close >= 0) {
        const content = text.slice(i + 2, close).trim();
        if (content) {
          spans.push({ start: i, end: close + 2, tex: content });
          i = close + 2;
          continue;
        }
      }
      i += 2;
      continue;
    }
    if (text[i] !== '$') { i++; continue; }
    if (i > 0 && text[i - 1] === '\\') { i++; continue; }          // escaped \$
    if (text[i + 1] === '$') { i += 2; continue; }                  // $$ block delimiter
    if (i + 1 >= n || /\s/.test(text[i + 1])) { i++; continue; }    // opening must hug content
    let j = i + 1;
    let close = -1;
    while (j < n) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '$' && !code[j]) { close = j; break; }
      j++;
    }
    if (close < 0) { i++; continue; }
    const content = text.slice(i + 1, close);
    if (!content.trim() || /\s$/.test(content)) { i = close + 1; continue; }   // empty / space-padded
    if (close + 1 < n && /\d/.test(text[close + 1])) { i = close + 1; continue; } // currency $5
    spans.push({ start: i, end: close + 1, tex: content });
    i = close + 1;
  }
  return spans;
}

// v4.3.0 issue #57a — mermaid fenced blocks. Mermaid is async so we render
// into a module-level cache; toDOM() pulls the SVG when available, falls
// back to a "rendering…" placeholder, then dispatches `xiaoyuan-note:cm-relayout`
// to ask the editor to rebuild decorations once the cache fills.
class MermaidWidget extends WidgetType {
  /** Whether the cache held a finished result when this widget was built. */
  private readonly settled: boolean;
  private readonly source: string;
  private readonly theme: MermaidTheme;
  private readonly filePath?: string;

  constructor(source: string, theme: MermaidTheme, filePath?: string) {
    super();
    this.source = source;
    this.theme = theme;
    this.filePath = filePath;
    const cached = mermaidSvgCache.get(mermaidKey(source, theme));
    this.settled = !!(cached && (cached.svg || cached.error));
  }

  eq(other: MermaidWidget): boolean {
    // A theme change must remount the widget with the other theme's SVG. So
    // must the render finishing: if the placeholder and the finished widget
    // compared equal, CodeMirror would keep the "Rendering…" DOM.
    return (
      other.source === this.source &&
      other.theme === this.theme &&
      other.filePath === this.filePath &&
      other.settled === this.settled
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--mermaid';
    const cached = mermaidSvgCache.get(mermaidKey(this.source, this.theme));
    if (cached?.svg) {
      wrap.innerHTML = cached.svg;
      bindMermaidInteractions(wrap, cached.bindFunctions);
      wrap.addEventListener('click', (ev) => {
        const anchor = (ev.target as Element | null)?.closest?.('a');
        if (anchor) {
          openRenderedLink(anchor, ev, this.filePath);
        }
      });
    } else if (cached?.error) {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `Mermaid: ${cached.error}`;
    } else {
      wrap.textContent = '⌛ Rendering Mermaid…';
      ensureMermaidRendered(this.source, this.theme).then(() => {
        // Ask the field to recompute now that the SVG cache is filled. We
        // can't hold an EditorView here (block decorations live in a state
        // field, built without a view), so signal via a window event that
        // the companion relayout plugin turns into a `relayoutEffect`.
        try {
          window.dispatchEvent(new CustomEvent('xiaoyuan-note:cm-relayout'));
        } catch {}
      });
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Embedded ```query block — renders a live table/list inline using the very
// same engine as Preview.vue and the saved-view builder, so an embedded block
// and a built view never disagree. The widget's `ignoreEvent` returns TRUE, so
// clicks stay inside the widget (toolbar / header menus / resize handles) and
// never drop the caret into the fence — the raw YAML is only shown in source
// (edit) mode. Double-clicking opens the visual builder (xiaoyuan-note:edit-query-block).
// v5.0 — transient UI state for the interactive query widget. The condition
// panel is a toggle that must survive a relayout/remount, so keep it module-level.
let conditionsVisible = false;
/** v5.0 — global edit-mode switch for nested component trees. Off = pure
 *  content (no chrome); on = outlines, toolbars, add/move/delete controls. */
let componentEditMode = false;

const SYNTH_LABELS: Record<string, string> = {
  name: '名称',
  summary: '摘要',
  tags: '标签',
  mtime: '修改时间',
  text: '内容',
  due: '截止',
  source: '来源',
  line: '行号',
};

function defaultCols(from: QueryScope): string[] {
  if (from === 'tasks') return ['name', 'due', 'source'];
  if (from === 'lines') return ['name', 'line', 'source'];
  return ['name', 'summary', 'tags', 'mtime'];
}

function availableColumns(from: QueryScope): string[] {
  const index = useWorkspaceIndexStore();
  const entries = index.entries ?? [];
  const noteCols = inferColumns(entries).map((c) => c.id);
  const base = from === 'notes' ? ['name', 'summary', 'tags', 'mtime'] : ['name', 'text', 'due', 'source', 'line'];
  return Array.from(new Set([...base, ...noteCols]));
}

function labelOf(colId: string, _from: QueryScope): string {
  if (SYNTH_LABELS[colId]) return SYNTH_LABELS[colId];
  const index = useWorkspaceIndexStore();
  const entries = index.entries ?? [];
  const c = inferColumns(entries).find((x) => x.id === colId);
  return c ? c.label : colId;
}

function ensureFilters(spec: QuerySpec): void {
  if (!spec.filters) spec.filters = { combinator: 'all', children: [] };
}

/** Show a menu through the app's shared ContextMenu surface. The widget is
 *  plain TS outside Vue, so it bridges via a window event; the bridge mounts
 *  ContextMenu.vue, giving query menus the same look as every other menu. */
function showQueryCtxMenu(
  anchor: HTMLElement,
  items: Array<{ id: string; label: string }>,
  onPick: (id: string) => void,
): void {
  const r = anchor.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent('xiaoyuan-note:query-ctx', {
      detail: {
        x: r.left,
        y: r.bottom,
        items: items.map((it) => ({ id: it.id as CtxActionId, label: it.label })),
        onPick,
      },
    }),
  );
}

class QueryWidget extends WidgetType {
  private readonly source: string;
  private readonly blockFrom: number;
  private readonly blockTo: number;
  private readonly deps: number;
  /** Hosting editor view, captured in toDOM() so writes never depend on a
   *  global "focused pane" (a modal / context menu may own focus at the time a
   *  toolbar or menu action dispatches). */
  private view: EditorView | null = null;

  constructor(source: string, blockFrom: number, blockTo: number) {
    super();
    this.source = source;
    this.blockFrom = blockFrom;
    this.blockTo = blockTo;
    this.deps = queryDataVersion;
  }

  eq(other: QueryWidget): boolean {
    return (
      other.source === this.source && other.deps === this.deps && other.blockTo === this.blockTo
    );
  }

  private spec(): QuerySpec {
    try {
      return parseQuerySpec(this.source);
    } catch {
      return {};
    }
  }

  /** Serialize the edited spec and replace the fence. The caret must park on the
   *  line AFTER the closing ``` — landing on the closing line itself makes the
   *  decoration treat it as "cursor inside" and briefly reveal the raw YAML. */
  private commit(spec: QuerySpec): void {
    const view = this.view;
    if (!view) return;
    const body = serializeQuerySpec(spec);
    const fence = '```query\n' + body + '\n```';
    const from = this.blockFrom;
    const to = this.blockTo;
    // Preview the post-change doc (no dispatch) to find a line strictly AFTER
    // the fence. The closing-fence line itself counts as inside (cursorLine <=
    // endI in buildBlockDecorations), so +1 line is required.
    const next = view.state.update({ changes: { from, to, insert: fence } });
    const fenceEnd = from + fence.length;
    const endLine = next.state.doc.lineAt(Math.min(fenceEnd, next.state.doc.length));
    const anchor = endLine.number < next.state.doc.lines
      ? next.state.doc.line(endLine.number + 1).from
      : Math.min(fenceEnd + 1, next.state.doc.length);
    view.dispatch({
      changes: { from, to, insert: fence },
      selection: { anchor },
    });
  }


  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--query';
    const spec = this.spec();

    // v5.0 — the config toolbar (and the optional conditions panel) sit ABOVE
    // the table so the always-available controls are at the top, not below.
    wrap.appendChild(this.buildToolbar(spec));
    if (conditionsVisible) wrap.appendChild(this.buildConditions(spec));

    const host = document.createElement('div');
    host.className = 'qb-host';
    try {
      host.innerHTML = buildQueryHtml(spec);
    } catch {
      host.innerHTML = '';
    }
    wrap.appendChild(host);

    // Click a row's wikilink → open the source note (with #L for tasks/lines).
    host.addEventListener('click', (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a.md-wikilink') as HTMLElement | null;
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      const target = a.getAttribute('data-wikilink-target') || '';
      window.dispatchEvent(new CustomEvent('xiaoyuan-note:open-wikilink', { detail: { target } }));
    });

    this.enhanceHeaders(host, spec);

    // Double-click the table opens the full visual builder (pre-filled). It is
    // suppressed when the double-click lands on an interactive control.
    wrap.addEventListener('dblclick', (ev) => {
      if ((ev.target as Element).closest('.qb-toolbar, .qb-conditions, .qb-menu, th, .qb-resize')) return;
      ev.preventDefault();
      ev.stopPropagation();
      window.dispatchEvent(new CustomEvent('xiaoyuan-note:edit-query-block', { detail: { spec } }));
    });
    return wrap;
  }

  private toolbarBtn(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qb-btn';
    b.textContent = label;
    return b;
  }

  private buildToolbar(spec: QuerySpec): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'qb-toolbar';

    const tBtn = this.toolbarBtn(spec.transpose ? '⇄ 转置✓' : '⇄ 转置');
    tBtn.onclick = () => {
      spec.transpose = !spec.transpose;
      this.commit(spec);
    };
    const cBtn = this.toolbarBtn(conditionsVisible ? '⚙ 条件✓' : '⚙ 条件');
    cBtn.onclick = () => {
      conditionsVisible = !conditionsVisible;
      this.view?.dispatch({ effects: relayoutEffect.of(null) });
    };
    const addBtn = this.toolbarBtn('＋列');
    addBtn.onclick = () => this.openInsertColumnMenu(addBtn, spec, 'append');

    const fromSel = document.createElement('select');
    fromSel.className = 'qb-select';
    (['notes', 'tasks', 'lines'] as QueryScope[]).forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s === 'notes' ? '笔记' : s === 'tasks' ? '任务' : '行';
      fromSel.appendChild(o);
    });
    fromSel.value = spec.from ?? 'notes';
    fromSel.onchange = () => {
      spec.from = fromSel.value as QueryScope;
      this.commit(spec);
    };

    const rSel = document.createElement('select');
    rSel.className = 'qb-select';
    (['table', 'list'] as const).forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s === 'table' ? '表格' : '列表';
      rSel.appendChild(o);
    });
    rSel.value = spec.render ?? 'table';
    rSel.onchange = () => {
      spec.render = rSel.value as QuerySpec['render'];
      this.commit(spec);
    };

    const fromLbl = document.createElement('span');
    fromLbl.className = 'qb-lbl';
    fromLbl.textContent = '范围';
    const rLbl = document.createElement('span');
    rLbl.className = 'qb-lbl';
    rLbl.textContent = '视图';

    bar.append(tBtn, cBtn, addBtn, fromLbl, fromSel, rLbl, rSel);
    return bar;
  }

  private buildConditions(spec: QuerySpec): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'qb-conditions';

    const comb = document.createElement('select');
    comb.className = 'qb-select';
    (['all', 'any'] as const).forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s === 'all' ? '且' : '或';
      comb.appendChild(o);
    });
    comb.value = spec.filters?.combinator ?? 'all';
    comb.onchange = () => {
      ensureFilters(spec);
      spec.filters!.combinator = comb.value as 'all' | 'any';
      this.commit(spec);
    };
    const combRow = document.createElement('div');
    combRow.className = 'qb-cond-row';
    const combLbl = document.createElement('span');
    combLbl.className = 'qb-lbl';
    combLbl.textContent = '匹配';
    combRow.append(combLbl, comb);
    panel.appendChild(combRow);

    const fg = spec.filters ?? { combinator: 'all' as const, children: [] };
    // The inline panel edits leaves only; nested groups are still honoured by
    // the query engine but have no row representation here.
    fg.children
      .filter((node): node is FilterLeaf => !('children' in node))
      .forEach((leaf, idx) => panel.appendChild(this.buildFilterRow(spec, leaf, idx)));

    const addBtn = this.toolbarBtn('＋ 添加条件');
    addBtn.onclick = () => {
      ensureFilters(spec);
      const cols = availableColumns(spec.from ?? 'notes');
      spec.filters!.children.push({ column: cols[0] ?? 'name', op: 'contains', value: '' });
      this.commit(spec);
    };
    panel.appendChild(addBtn);
    return panel;
  }

  private buildFilterRow(spec: QuerySpec, leaf: FilterLeaf, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'qb-cond-row';

    const colSel = document.createElement('select');
    colSel.className = 'qb-select';
    availableColumns(spec.from ?? 'notes').forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = labelOf(c, spec.from ?? 'notes');
      colSel.appendChild(o);
    });
    colSel.value = leaf.column;
    colSel.onchange = () => {
      leaf.column = colSel.value;
      this.commit(spec);
    };

    const opSel = document.createElement('select');
    opSel.className = 'qb-select';
    (['contains', 'equals', 'gt', 'lt', 'gte', 'lte', 'is-empty', 'isNotEmpty', 'has-tag'] as const).forEach(
      (op) => {
        const o = document.createElement('option');
        o.value = op;
        o.textContent = op;
        opSel.appendChild(o);
      },
    );
    opSel.value = leaf.op;
    opSel.onchange = () => {
      leaf.op = opSel.value as FilterLeaf['op'];
      this.commit(spec);
    };

    const val = document.createElement('input');
    val.className = 'qb-input';
    val.value = leaf.value == null ? '' : String(leaf.value);
    val.placeholder = '值';
    const commitVal = () => {
      leaf.value = val.value;
      this.commit(spec);
    };
    val.onchange = commitVal;
    val.onblur = commitVal;

    const del = this.toolbarBtn('✕');
    del.onclick = () => {
      ensureFilters(spec);
      spec.filters!.children.splice(idx, 1);
      this.commit(spec);
    };

    row.append(colSel, opSel, val, del);
    return row;
  }

  private enhanceHeaders(host: HTMLElement, spec: QuerySpec): void {
    const table = host.querySelector('table');
    if (!table || spec.transpose) return; // transposed view: no per-column ops
    table.querySelectorAll('th[data-col-id]').forEach((thEl) => {
      const th = thEl as HTMLElement;
      const colId = th.getAttribute('data-col-id') || '';

      const handle = document.createElement('div');
      handle.className = 'qb-resize';
      th.appendChild(handle);
      handle.addEventListener('mousedown', (e) => this.startResize(e, th, colId, spec));

      // Hover "delete column" (top-left corner).
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'qb-col-del';
      del.textContent = '✕';
      del.title = '删除列';
      th.appendChild(del);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeColumn(spec, colId);
      });

      // Hover "insert column" (top-right, inserts a column to the right).
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'qb-col-add';
      add.textContent = '＋';
      add.title = '在右侧插入列';
      th.appendChild(add);
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openInsertColumnMenu(add, spec, 'right', colId);
      });

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'qb-th-menu';
      menuBtn.textContent = '▾';
      th.appendChild(menuBtn);
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openHeaderMenu(e, colId, spec);
      });
    });
  }

  private startResize(e: MouseEvent, th: HTMLElement, colId: string, spec: QuerySpec): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const onMove = (me: MouseEvent) => {
      const w = Math.max(40, Math.round(startW + me.clientX - startX));
      th.style.width = w + 'px';
    };
    const onUp = (me: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const w = Math.max(40, Math.round(startW + me.clientX - startX));
      spec.columnWidths = spec.columnWidths || {};
      spec.columnWidths[colId] = w;
      this.commit(spec);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private openHeaderMenu(e: MouseEvent, colId: string, spec: QuerySpec): void {
    const anchor = e.target as HTMLElement;
    const actions: Array<{ id: string; label: string; act: () => void }> = [
      { id: 'qact.asc', label: '↑ 升序', act: () => { spec.sort = { column: colId, dir: 'asc' }; this.commit(spec); } },
      { id: 'qact.desc', label: '↓ 降序', act: () => { spec.sort = { column: colId, dir: 'desc' }; this.commit(spec); } },
      { id: 'qact.clear', label: '清除排序', act: () => { spec.sort = null; this.commit(spec); } },
      { id: 'qact.insertL', label: '左侧插入列', act: () => this.openInsertColumnMenu(anchor, spec, 'left', colId) },
      { id: 'qact.insertR', label: '右侧插入列', act: () => this.openInsertColumnMenu(anchor, spec, 'right', colId) },
      { id: 'qact.hide', label: '隐藏/删除列', act: () => this.removeColumn(spec, colId) },
    ];
    const byId = new Map(actions.map((a) => [a.id, a]));
    showQueryCtxMenu(
      anchor,
      actions.map((a) => ({ id: a.id, label: a.label })),
      (id) => byId.get(id)?.act(),
    );
  }

  private removeColumn(spec: QuerySpec, colId: string): void {
    const cols = spec.columns ?? defaultCols(spec.from ?? 'notes');
    spec.columns = cols.filter((c) => c !== colId);
    this.commit(spec);
  }

  private openInsertColumnMenu(
    anchor: HTMLElement,
    spec: QuerySpec,
    side: 'append' | 'left' | 'right',
    atColId?: string,
  ): void {
    const from = spec.from ?? 'notes';
    // `undefined` = legacy block with no explicit columns (defaults are the
    // baseline). `[]` = blank block from the wizard — start from ZERO columns
    // and offer every column; otherwise all defaults get filtered out as
    // "already used" and the menu ends up empty (click did nothing).
    const base = spec.columns === undefined ? defaultCols(from) : spec.columns;
    const avail = availableColumns(from).filter((c) => !base.includes(c));
    const options = avail.map((id) => ({ id, label: labelOf(id, from) }));

    const pick = (colId: string) => {
      const cols = [...base];
      if (side === 'append' || !atColId) cols.push(colId);
      else {
        const i = cols.indexOf(atColId);
        cols.splice(side === 'left' ? i : i + 1, 0, colId);
      }
      spec.columns = cols;
      this.commit(spec);
    };

    if (options.length === 0) {
      showQueryCtxMenu(anchor, [{ id: 'qcol.none', label: '（暂无可用列）' }], () => {});
      return;
    }
    // CtxActionId is a fixed union, so use synthetic ids and map them back to
    // the real column id before writing the spec.
    const mapped = options.map((o, i) => ({ id: `qcol.${i}`, label: o.label }));
    const byId = new Map(mapped.map((m, i) => [m.id, options[i].id]));
    showQueryCtxMenu(anchor, mapped, (id) => {
      const colId = byId.get(id);
      if (colId) pick(colId);
    });
  }

  ignoreEvent(): boolean {
    // v5.0 — TRUE so CodeMirror never consumes clicks inside the widget. The
    // interactive controls (toolbar buttons, <select>, column-resize handles,
    // header menu) own their events; this also stops a click from dropping the
    // caret into the fence and revealing the raw YAML source.
    return true;
  }
}

/**
 * v5.0 — a ```component fence: one widget renders an entire nested component
 * tree (CM6 forbids overlapping block decorations). Every interaction edits a
 * cloned tree then writes it back through one fence replacement.
 */
class ComponentWidget extends WidgetType {
  private readonly source: string;
  private readonly ref: ComponentFenceRef;
  private readonly blockTo: number;
  private readonly deps: number;
  private readonly componentVersion: number;
  private readonly editing: boolean;
  private readonly propsOpen: string | null;
  private view: EditorView | null = null;
  /** Node whose property panel is open (module-level so it survives relayout). */
  private static editing: string | null = null;

  constructor(source: string, _blockFrom: number, blockTo: number) {
    super();
    this.source = source;
    this.ref = parseComponentFenceRef(source);
    this.blockTo = blockTo;
    this.deps = queryDataVersion;
    this.componentVersion = getComponentDataVersion();
    this.editing = componentEditMode;
    this.propsOpen = ComponentWidget.editing;
  }

  eq(other: ComponentWidget): boolean {
    return (
      other.source === this.source &&
      other.deps === this.deps &&
      other.componentVersion === this.componentVersion &&
      other.blockTo === this.blockTo &&
      other.editing === this.editing &&
      other.propsOpen === this.propsOpen
    );
  }

  /** Resolve the referenced component from the store, loading on demand. */
  private resolve(): ComponentNode | null {
    if (this.ref.kind !== 'id') return null;
    const store = useComponentsStore();
    const cached = store.get(this.ref.id);
    if (cached) return cached.tree;
    // Not in cache yet: kick off an async load. bumpComponentDataVersion() in
    // the store will retrigger this widget with the loaded tree.
    void store.load(this.ref.id);
    return null;
  }

  /** Save the edited tree to the EXTERNAL component note; leave the fence as-is. */
  private commit(root: ComponentNode): void {
    if (this.ref.kind !== 'id') return;
    const store = useComponentsStore();
    // The component note is the single source of truth for the display name.
    // A legacy fence may still carry one, but it must never override the file.
    const name = store.get(this.ref.id)?.name || this.ref.name || '';
    void store.save({ id: this.ref.id, name, tree: root }).catch((e) => console.warn('[component] save failed', e));
    // The store bumps componentDataVersion → decorations rebuild via relayout.
    // No fence replacement: the current note keeps only the ID line.
  }

  /** Deep-clone a working tree so edits don't mutate the store cache in place. */
  private cloneTree(root: ComponentNode): ComponentNode {
    return JSON.parse(JSON.stringify(root)) as ComponentNode;
  }

  /** Show the shared app menu anchored at `anchor`. */
  private menu(anchor: HTMLElement, items: Array<{ id: string; label: string }>, onPick: (id: string) => void): void {
    showQueryCtxMenu(anchor, items, onPick);
  }

  private addMenu(anchor: HTMLElement, root: ComponentNode, parentId: string | null, index?: number): void {
    const mapped = ADDABLE_TYPES.map((t, i) => ({ id: `cs.add.${i}`, label: COMPONENT_DEFS[t].label }));
    const byId = new Map(mapped.map((m, i) => [m.id, ADDABLE_TYPES[i]]));
    this.menu(anchor, mapped, (id) => {
      const type = byId.get(id);
      if (!type) return;
      const tree = this.cloneTree(root);
      const node = makeNode(type);
      const target = parentId ? findNode(tree, parentId)?.node : tree;
      if (!target || !COMPONENT_DEFS[target.type].container) return;
      const children = target.children ?? [];
      if (index === undefined) children.push(node);
      else children.splice(index, 0, node);
      target.children = children;
      this.commit(tree);
    });
  }

  private rowMenu(anchor: HTMLElement, root: ComponentNode, node: ComponentNode): void {
    const actions = [
      { id: 'cs.props', label: '⚙ 属性' },
      { id: 'cs.dup', label: '⧉ 复制' },
      { id: 'cs.left', label: '← 上移' },
      { id: 'cs.right', label: '→ 下移' },
      { id: 'cs.del', label: '✕ 删除' },
    ];
    this.menu(anchor, actions, (id) => {
      const tree = this.cloneTree(root);
      const hit = findNode(tree, node.id);
      if (!hit) return;
      if (id === 'cs.props') {
        ComponentWidget.editing = ComponentWidget.editing === node.id ? null : node.id;
        this.view?.dispatch({ effects: relayoutEffect.of(null) });
        return;
      }
      if (id === 'cs.del') {
        if (!hit.parent) return; // cannot delete root
        hit.parent.children?.splice(hit.index, 1);
      } else if (id === 'cs.dup') {
        if (!hit.parent) return;
        const clone = JSON.parse(JSON.stringify(node)) as ComponentNode;
        clone.id = makeNode(node.type).id;
        hit.parent.children?.splice(hit.index + 1, 0, clone);
      } else if ((id === 'cs.left' || id === 'cs.right') && hit.parent) {
        const sibs = hit.parent.children ?? [];
        const j = id === 'cs.left' ? hit.index - 1 : hit.index + 1;
        if (j >= 0 && j < sibs.length) {
          [sibs[hit.index], sibs[j]] = [sibs[j], sibs[hit.index]];
        }
      }
      this.commit(tree);
    });
  }

  private propEditor(node: ComponentNode): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cs-props';
    const title = document.createElement('span');
    title.className = 'cs-props-title';
    title.textContent = `${COMPONENT_DEFS[node.type].label} 属性`;
    box.appendChild(title);

    const addField = (key: string, label: string, multiline = false) => {
      const row = document.createElement('label');
      row.className = 'cs-props-row';
      row.textContent = label;
      const input = multiline
        ? (document.createElement('textarea') as HTMLTextAreaElement)
        : (document.createElement('input') as HTMLInputElement);
      const val = node.props[key];
      input.value = Array.isArray(val) ? val.join(', ') : String(val ?? '');
      // Do NOT commit on every keystroke: that replaces the fence and rebuilds
      // this widget mid-typing, destroying the input's focus. Update memory
      // live; the single "完成" click below writes the whole tree back.
      input.oninput = () => {
        node.props[key] = Array.isArray(val) ? input.value.split(',').map((s) => s.trim()).filter(Boolean) : input.value;
      };
      row.appendChild(input);
      box.appendChild(row);
    };

    // Visual style preset (card / outlined / filled / elevated / plain).
    const styleRow = document.createElement('label');
    styleRow.className = 'cs-props-row';
    styleRow.textContent = '风格';
    const styleSel = document.createElement('select');
    styleSel.className = 'qb-select';
    STYLE_OPTIONS.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.value;
      o.textContent = s.label;
      styleSel.appendChild(o);
    });
    styleSel.value = String(node.props.style ?? 'plain');
    styleSel.onchange = () => {
      node.props.style = styleSel.value;
      // Style change has no typing-focus concern — commit immediately so the
      // preview updates the moment a preset is chosen.
      this.commit(this.root);
    };
    styleRow.appendChild(styleSel);
    box.appendChild(styleRow);

    // Common size/spacing props for every component.
    BOX_PROPS.forEach((f) => {
      if (f.key === 'gap' && !COMPONENT_DEFS[node.type].container) return;
      addField(f.key, f.label + (f.hint ? `（${f.hint}）` : ''));
    });
    if (node.type === 'callout') {
      addField('title', '标题');
      addField('text', '内容', true);
      const toneRow = document.createElement('label');
      toneRow.className = 'cs-props-row';
      toneRow.textContent = '色调';
      const toneSel = document.createElement('select');
      toneSel.className = 'qb-select';
      TONE_OPTIONS.forEach((t) => {
        const o = document.createElement('option');
        o.value = t.value;
        o.textContent = t.label;
        toneSel.appendChild(o);
      });
      toneSel.value = String(node.props.tone ?? 'info');
      toneSel.onchange = () => {
        node.props.tone = toneSel.value;
        this.commit(this.root);
      };
      toneRow.appendChild(toneSel);
      box.appendChild(toneRow);
    } else if (node.type === 'text') {
      addField('text', '文本', true);
    } else if (node.type === 'query') {
      addField('from', '范围（notes/tasks/lines）');
      addField('columns', '列（逗号分隔）');
      addField('search', '搜索');
    } else if (node.type === 'grid') {
      addField('columns', '网格列数');
    }
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'qb-btn';
    done.textContent = '完成';
    done.onclick = () => {
      ComponentWidget.editing = null;
      this.commit(this.root); // single write-back after edits
    };
    box.appendChild(done);
    return box;
  }

  private root: ComponentNode = makeRoot();

  /** Apply common box props (width/minHeight/padding/margin) to a node element. */
  private applyBox(el: HTMLElement, props: Record<string, unknown>): void {
    const style = String(props.style ?? 'plain');
    if (STYLE_OPTIONS.some((s) => s.value === style)) el.classList.add(`cs-style--${style}`);
    if (props.width) el.style.width = String(props.width);
    if (props.minHeight) el.style.minHeight = String(props.minHeight);
    if (props.padding) el.style.padding = String(props.padding);
    if (props.margin) el.style.margin = String(props.margin);
  }

  /** Inner layout for a container: stack/tabs vertical, grid columns + gap. */
  private applyContainerLayout(content: HTMLElement, node: ComponentNode): void {
    content.style.display = node.type === 'grid' ? 'grid' : 'flex';
    content.style.flexDirection = 'column';
    if (node.props.gap) {
      const g = String(node.props.gap);
      content.style.gap = /^\d+$/.test(g) ? `${g}px` : g;
    }
    if (node.type === 'grid') {
      const cols = Math.max(1, Math.min(6, Number(node.props.columns) || 2));
      content.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
    }
  }

  private renderNode(node: ComponentNode, _containerId: string | null): HTMLElement {
    const def = COMPONENT_DEFS[node.type];
    // Transparent root: no node frame, no bar. Its children are laid out in a
    // plain vertical flow; an empty root renders nothing (no default box).
    if (node.type === 'root') {
      const rootWrap = document.createElement('div');
      rootWrap.className = 'cs-root-inner';
      rootWrap.dataset.nodeId = node.id;
      (node.children ?? []).forEach((child) => rootWrap.appendChild(this.renderNode(child, node.id)));
      if (componentEditMode) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'qb-btn cs-root-add';
        add.textContent = (node.children ?? []).length ? '＋ 添加组件' : '＋ 添加第一个组件';
        add.onclick = (e) => { e.stopPropagation(); this.addMenu(add, this.root, null); };
        rootWrap.appendChild(add);
      }
      return rootWrap;
    }

    const wrap = document.createElement('div');
    wrap.className = `cs-node cs-node--${node.type}`;
    wrap.dataset.nodeId = node.id;
    wrap.draggable = componentEditMode;

    // Chrome (drag handle / type / +) exists ONLY in edit mode. In reading mode
    // the DOM carries no editor controls at all — just the node's content.
    if (!componentEditMode) {
      this.applyBox(wrap, node.props);
      const content = document.createElement('div');
      content.className = 'cs-node-content';
      if (def.container) {
        this.applyContainerLayout(content, node);
        (node.children ?? []).forEach((child) => content.appendChild(this.renderNode(child, node.id)));
        if ((node.children ?? []).length === 0) {
          const ph = document.createElement('div');
          ph.className = 'cs-placeholder';
          ph.textContent = '空容器';
          content.appendChild(ph);
        }
      } else {
        content.innerHTML = def.render(node.props, '');
        if (node.type === 'query') {
          content.addEventListener('click', (ev) => {
            const a = (ev.target as Element)?.closest?.('a.md-wikilink') as HTMLElement | null;
            if (!a) return;
            ev.preventDefault();
            ev.stopPropagation();
            window.dispatchEvent(new CustomEvent('xiaoyuan-note:open-wikilink', {
              detail: { target: a.getAttribute('data-wikilink-target') || '' },
            }));
          });
        }
      }
      wrap.appendChild(content);
      return wrap;
    }

    const bar = document.createElement('div');
    bar.className = 'cs-node-bar';
    const typeBtn = document.createElement('button');
    typeBtn.type = 'button';
    typeBtn.className = 'cs-node-type';
    typeBtn.textContent = def.label;
    typeBtn.title = '组件操作';
    typeBtn.onclick = (e) => {
      e.stopPropagation();
      this.rowMenu(typeBtn, this.root, node);
    };
    bar.appendChild(typeBtn);
    const spacer = document.createElement('span');
    spacer.className = 'cs-node-spacer';
    bar.appendChild(spacer);
    // Add child button (containers only).
    if (def.container) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'cs-node-add';
      add.textContent = '＋';
      add.title = '添加子组件';
      add.onclick = (e) => {
        e.stopPropagation();
        this.addMenu(add, this.root, node.id);
      };
      bar.appendChild(add);
    }
    wrap.appendChild(bar);

    // Drag & drop reorder within the same parent.
    wrap.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer?.setData('text/cs-node-id', node.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.add('cs-drop-target');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('cs-drop-target'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove('cs-drop-target');
      const dragId = e.dataTransfer?.getData('text/cs-node-id');
      if (!dragId || dragId === node.id) return;
      const tree = this.cloneTree(this.root);
      const from = findNode(tree, dragId);
      const target = findNode(tree, this.root.id === node.id ? '' : node.id);
      if (!from || !target || !from.parent || !target.parent || from.parent !== target.parent) return;
      const sibs = from.parent.children ?? [];
      const [moved] = sibs.splice(from.index, 1);
      const at = sibs.indexOf(target.node);
      sibs.splice(at >= 0 ? at : sibs.length, 0, moved);
      from.parent.children = sibs;
      this.commit(tree);
    });

    // Node content.
    this.applyBox(wrap, node.props);
    const content = document.createElement('div');
    content.className = 'cs-node-content';
    if (def.container) {
      this.applyContainerLayout(content, node);
      const children = node.children ?? [];
      children.forEach((child) => content.appendChild(this.renderNode(child, node.id)));
      if (children.length === 0) {
        const ph = document.createElement('div');
        ph.className = 'cs-placeholder';
        ph.textContent = '空容器 — 用 ＋ 添加组件';
        content.appendChild(ph);
      }
    } else {
      content.innerHTML = def.render(node.props, '');
      if (node.type === 'query') {
        content.addEventListener('click', (ev) => {
          const a = (ev.target as Element)?.closest?.('a.md-wikilink') as HTMLElement | null;
          if (!a) return;
          ev.preventDefault();
          ev.stopPropagation();
          window.dispatchEvent(new CustomEvent('xiaoyuan-note:open-wikilink', {
            detail: { target: a.getAttribute('data-wikilink-target') || '' },
          }));
        });
      }
    }
    wrap.appendChild(content);
    if (ComponentWidget.editing === node.id) wrap.appendChild(this.propEditor(node));
    return wrap;
  }

  private toggleEdit(view: EditorView): void {
    componentEditMode = !componentEditMode;
    if (!componentEditMode) ComponentWidget.editing = null;
    view.dispatch({ effects: relayoutEffect.of(null) });
  }

  toDOM(view: EditorView): HTMLElement {
    try {
      return this.buildDOM(view);
    } catch (e) {
      // A broken component tree must never take down the whole editor view.
      const fallback = document.createElement('div');
      fallback.className = 'cm-live-block cm-live-block--component cs-error';
      fallback.textContent = `组件渲染失败：${(e as Error)?.message ?? e}`;
      return fallback;
    }
  }

  private buildDOM(view: EditorView): HTMLElement {
    this.view = view;
    // Reference-only fences; legacy inline YAML is intentionally NOT rendered.
    if (this.ref.kind === 'legacy') {
      const box = document.createElement('div');
      box.className = 'cm-live-block cm-live-block--component cs-hint cs-hint--legacy';
      box.textContent = '旧版内联组件（待迁移）：请新建组件并把内容复制过去。';
      return box;
    }
    if (this.ref.kind === 'empty') {
      const box = document.createElement('div');
      box.className = 'cm-live-block cm-live-block--component cs-hint cs-hint--empty';
      box.textContent = '空组件引用：请在编辑模式新建一个组件并填入 ID。';
      return box;
    }
    const resolved = this.resolve();
    if (!resolved) {
      const box = document.createElement('div');
      box.className = 'cm-live-block cm-live-block--component cs-hint cs-hint--missing';
      box.textContent = `组件 ${this.ref.id} 未找到或仍在加载…`;
      return box;
    }
    this.root = resolved;
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--component' + (componentEditMode ? ' cs-editing' : '');
    // Mark as a self-contained, non-editable region. The browser then allows
    // native text selection inside it, and CodeMirror (via ignoreEvent below)
    // leaves mouse events alone instead of mapping them onto document offsets.
    wrap.setAttribute('contenteditable', 'false');
    // CodeMirror's document-level selectionchange handler maps a DOM selection
    // onto editor offsets only while contentDOM owns focus. Moving focus to the
    // widget itself keeps native selection intact without blurring the editor
    // to <body>, which used to leave later clicks on real source lines unable
    // to restore focus (Ctrl+V then did nothing until a right-click refocused).
    wrap.tabIndex = -1;
    // Interactive controls keep their events; everything else (the rendered
    // text) is treated as a read-only region detached from the editor.
    const isControl = (t: EventTarget | null): boolean =>
      !!(t as Element | null)?.closest?.('button, input, select, a');
    // Block pointerdown from reaching cm-drag-aware (scrollDOM listener) and
    // mousedown from reaching CodeMirror's own selection handler (contentDOM
    // listener). Both would otherwise overwrite/poison the native selection.
    wrap.addEventListener('pointerdown', (e) => {
      if (isControl(e.target)) return;
      e.stopPropagation();
    });
    wrap.addEventListener('mousedown', (e) => {
      if (isControl(e.target)) return;
      // Do NOT preventDefault — the browser still needs this event to begin
      // the native selection. Focusing this detached widget is enough.
      e.stopPropagation();
      wrap.focus({ preventScroll: true });
    });

    const bar = document.createElement('div');
    bar.className = 'cs-toolbar';
    const btn = (text: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qb-btn';
      b.textContent = text;
      return b;
    };
    // One toggle in the SAME corner: ✎ to enter, ✓ to leave. Adding components
    // is already handled by the root "＋ 添加组件" button in edit mode — no
    // duplicate top-bar action.
    const toggle = btn(componentEditMode ? '✓ 完成' : '✎ 编辑');
    toggle.className = 'qb-btn cs-edit-toggle';
    toggle.onclick = (e) => {
      e.stopPropagation();
      this.toggleEdit(view);
    };
    bar.appendChild(toggle);
    // The fence holds only the ID; the display name comes from the component
    // note, so renaming it there updates every reference automatically.
    const componentStore = useComponentsStore();
    const compName = componentStore.get(this.ref.id)?.name || this.ref.name || '';
    const nameLbl = document.createElement('span');
    nameLbl.className = 'cs-ref-name';
    nameLbl.textContent = compName;
    bar.appendChild(nameLbl);
    const content = this.renderNode(this.root, null);
    // Copy the rendered text: a CodeMirror replace-widget is atomic, so its
    // inner text can't be selected with the mouse. A button sidesteps that and
    // copies what the user actually sees (callout text, query tables, etc.).
    const copy = btn('复制');
    copy.className = 'qb-btn';
    copy.title = '复制组件渲染内容';
    let copiedTimer: number | undefined;
    copy.onclick = async (e) => {
      e.stopPropagation();
      const text = content.innerText;
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '已复制';
        window.clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(() => { copy.textContent = '复制'; }, 1200);
      } catch {
        copy.textContent = '复制失败';
        window.clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(() => { copy.textContent = '复制'; }, 1200);
      }
    };
    bar.appendChild(copy);
    // Only an id ref can be renamed/saved as a component file; legacy and
    // empty fences have no id and would silently save `id: undefined`.
    // Capture the narrowed value: TS does not keep property narrowing inside
    // the click callback.
    const ref = this.ref;
    if (componentEditMode && ref.kind === 'id') {
      const rename = btn('重命名');
      rename.className = 'qb-btn';
      rename.onclick = (e) => {
        e.stopPropagation();
        const current = componentStore.get(ref.id)?.name || compName;
        const next = window.prompt('组件名称', current);
        if (next === null) return;
        const name = next.trim() || '新组件';
        void componentStore.save({ id: ref.id, name, tree: this.root });
      };
      bar.appendChild(rename);
    }
    wrap.appendChild(bar);
    wrap.appendChild(content);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
// server (opt-in; see lib/plantuml.ts for the privacy story). Same reveal
// model as mermaid/tables: cursor inside → source. The <img> reports its
// final size only after load, so onload nudges the relayout plugin to make
// CM re-measure the block height.
class PlantumlWidget extends WidgetType {
  readonly source: string;
  readonly url: string;

  constructor(source: string, url: string) {
    super();
    this.source = source;
    this.url = url;
  }
  eq(other: PlantumlWidget): boolean {
    return other.source === this.source && other.url === this.url;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--plantuml';
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = 'PlantUML diagram';
    img.src = this.url;
    img.addEventListener('load', () => {
      try {
        window.dispatchEvent(new CustomEvent('xiaoyuan-note:cm-relayout'));
      } catch {}
    });
    img.addEventListener('error', () => {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = 'PlantUML render failed — check the server setting';
      try {
        window.dispatchEvent(new CustomEvent('xiaoyuan-note:cm-relayout'));
      } catch {}
    });
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.6 F7 — ```tldraw fenced whiteboard. Unlike mermaid (which collapses only
// when the cursor leaves), the board ALWAYS replaces the fence: the JSON is
// never meant to be hand-edited. The widget mounts a LIVE tldraw editor via the
// dynamic-import adapter (tldraw-runtime.ts) so the rest of the app compiles
// without the dep. Edits debounce 350ms inside the adapter, then splice ONLY
// the fence body back through the writeback callback (→ tabs.setContent),
// exactly like Tolaria's onSnapshotChange → tldrawMarkdown round-trip.
class TldrawWidget extends WidgetType {
  private readonly boardId: string;
  private readonly height: string;
  private readonly width: string;
  private readonly snapshot: string;
  private readonly opts: BlockOptions;

  constructor(
    boardId: string,
    height: string,
    width: string,
    snapshot: string,
    opts: BlockOptions,
  ) {
    super();
    this.boardId = boardId;
    this.height = height;
    this.width = width;
    this.snapshot = snapshot;
    this.opts = opts;
  }

  // Re-mount only when the board IDENTITY or stored snapshot changes — NOT on
  // every keystroke elsewhere in the doc. This is what makes the always-render
  // model viable: a relayout that doesn't touch this fence reuses the same
  // widget DOM (eq → true) so the tldraw instance is never torn down (avoids
  // the canvas remounting on every keystroke near it, per the plan's risks).
  eq(other: TldrawWidget): boolean {
    return (
      other.boardId === this.boardId &&
      other.height === this.height &&
      other.width === this.width &&
      other.snapshot === this.snapshot
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--tldraw';
    wrap.setAttribute('data-board-id', this.boardId);
    // Bordered card lives one level down so the wrap's padding (the old
    // inter-block margin, see #155) stays outside the border.
    const card = document.createElement('div');
    card.className = 'cm-tldraw-card';
    const h = parseInt(this.height, 10);
    card.style.height = `${Number.isFinite(h) && h > 0 ? h : 520}px`;
    if (this.width) card.style.maxWidth = `${this.width}px`;
    wrap.appendChild(card);

    // Overflow toolbar: a fullscreen toggle that pops the board into the
    // WhiteboardOverlay (full-window editor). The board id + current snapshot
    // are handed off so the overlay edits the SAME fence.
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-tldraw-toolbar';
    const strings = this.opts.getBoardStrings?.() ?? {
      loading: 'Loading whiteboard…',
      openFull: 'Open fullscreen',
      loadFailed: 'Whiteboard failed to load',
    };
    const fullBtn = document.createElement('button');
    fullBtn.className = 'cm-tldraw-fullscreen';
    fullBtn.type = 'button';
    fullBtn.title = strings.openFull;
    fullBtn.setAttribute('aria-label', strings.openFull);
    fullBtn.textContent = '⛶';
    fullBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    fullBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const handle = (wrap as unknown as { __boardHandle?: { getSnapshotString(): string } })
        .__boardHandle;
      const snap = handle?.getSnapshotString?.() ?? this.snapshot;
      window.dispatchEvent(
        new CustomEvent('xiaoyuan-note:whiteboard-open', {
          detail: {
            boardId: this.boardId,
            tabId: this.opts.getTabId?.() ?? '',
            snapshot: snap,
          },
        }),
      );
    });
    toolbar.appendChild(fullBtn);
    card.appendChild(toolbar);

    const surface = document.createElement('div');
    surface.className = 'cm-tldraw-surface';
    card.appendChild(surface);

    const placeholder = document.createElement('div');
    placeholder.className = 'cm-tldraw-loading';
    const spinner = document.createElement('span');
    spinner.className = 'cm-tldraw-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = strings.loading;
    placeholder.append(spinner, loadingLabel);
    surface.appendChild(placeholder);

    // Mount asynchronously — the adapter dynamic-imports tldraw on first use.
    const theme: BoardThemeTokens = this.opts.getBoardTheme?.() ?? {
      colorScheme: 'light',
      locale: 'en',
    };
    const boardId = this.boardId;
    let destroyed = false;
    void import('./tldraw-runtime')
      .then(({ mountBoard }) =>
        mountBoard(surface, {
          snapshot: this.snapshot,
          theme,
          onSnapshotChange: (snapshotJson) => {
            // Splice the new snapshot back into the note's Markdown. We resolve
            // the fence by board id at write time (positions drift as the doc
            // is edited), keeping height/width attributes intact.
            this.opts.onBoardEdit?.(boardId, snapshotJson);
          },
        }),
      )
      .then((handle) => {
        if (destroyed) {
          handle.destroy();
          return;
        }
        placeholder.remove();
        (wrap as unknown as { __boardHandle?: unknown }).__boardHandle = handle;
        // Expose the live board instance for the dev-bridge self-test.
        try {
          const reg =
            ((window as any).__xiaoyuanNoteBoards ||= new Map<string, unknown>());
          reg.set(boardId, handle);
        } catch {
          /* dev-only */
        }
      })
      .catch((e) => {
        placeholder.className = 'cm-tldraw-loading cm-live-block--broken';
        placeholder.textContent = `${strings.loadFailed}: ${(e as Error).message}`;
      });

    // Stash a teardown hook the widget's destroy() path can call.
    (wrap as unknown as { __destroyBoard?: () => void }).__destroyBoard = () => {
      destroyed = true;
      const handle = (wrap as unknown as { __boardHandle?: { destroy(): void } })
        .__boardHandle;
      try {
        handle?.destroy();
      } catch {
        /* already gone */
      }
      try {
        (window as any).__xiaoyuanNoteBoards?.delete(boardId);
      } catch {
        /* dev-only */
      }
    };

    return wrap;
  }

  destroy(dom: HTMLElement): void {
    // CM calls destroy() when the widget DOM is removed (relayout / unmount).
    // Tear down the tldraw React root so we don't leak an editor per relayout.
    (dom as unknown as { __destroyBoard?: () => void }).__destroyBoard?.();
  }

  // The board owns all pointer/keyboard interaction inside its canvas — let
  // those events through to tldraw rather than routing them to CodeMirror.
  ignoreEvent(): boolean {
    return true;
  }
}

interface BlockOptions {
  /** Workspace context for resolving relative image paths. */
  getImageRoot?: () => string | null;
  /** Active note's filesystem path so relative paths resolve to its dir. */
  getFilePath?: () => string | undefined;
  /** Theme/locale tokens handed to a mounted tldraw board (F7). */
  getBoardTheme?: () => BoardThemeTokens;
  /** Active tab id — the fullscreen overlay writes edits back to it (F7). */
  getTabId?: () => string;
  /**
   * F7 writeback: a whiteboard's snapshot changed. `snapshotJson` is the fresh
   * pretty-printed body to splice into the ```tldraw fence with `boardId`.
   */
  onBoardEdit?: (boardId: string, snapshotJson: string) => void;
  /**
   * F7 i18n: localized strings for the inline board chrome (loading text,
   * fullscreen button tooltip, load-failure prefix). Optional — sensible
   * English fallbacks are used when absent so the widget never shows a raw key.
   */
  getBoardStrings?: () => { loading: string; openFull: string; loadFailed: string };
  /**
   * #354 — Mermaid theme for the current app theme ('dark' for any dark
   * theme). Absent → 'default'. A change takes effect on the next rebuild;
   * the editor dispatches a relayout when the theme changes.
   */
  getMermaidTheme?: () => 'dark' | 'default';
  /** v4.10 #163 — PlantUML opt-in + server; absent/disabled → fences stay source. */
  getPlantuml?: () => { enabled: boolean; server: string };
  /**
   * #353 "Always show Markdown markers": the source stays visible whatever the
   * caret does, so nothing collapses and nothing jumps when a line is clicked.
   * Images still render, as a block below their own (visible) source line;
   * tables, math, HTML blocks and diagrams keep their source. tldraw boards
   * are unaffected — they never reveal source anyway.
   */
  keepSource?: () => boolean;
}

function buildBlockDecorations(state: EditorState, opts: BlockOptions): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const sel = state.selection.main;
        const cursorLine = state.doc.lineAt(sel.from).number;
        const cursorLineEnd = state.doc.lineAt(sel.to).number;
        const keepSource = opts.keepSource?.() === true;

        // Single pass over the whole doc — for each line, decide:
        //   * is it a standalone image line we should replace? (1 line)
        //   * is it the start of a table block we should collapse? (N lines)
        // Tables are walked as ranges so we don't double-iterate. (We walk
        // the full doc, not just the viewport: block decorations come from a
        // state field, which has no viewport — and CM only renders the
        // visible slice anyway, so this stays cheap.)
        const doc = state.doc;
        const lastLine = doc.lines;
        const sourceLines = Array.from(
          { length: lastLine },
          (_, index) => doc.line(index + 1).text,
        );
        // #457 — every line scan below (raw HTML blocks, <img> lines, tables,
        // math) must stay inert inside code blocks: a ```vue fence whose
        // template holds <div>…</div> had its middle replaced by an
        // HtmlBlockWidget and rendered as real HTML while the preview (which
        // keeps fence content literal) looked fine. Take code-block ranges
        // from the same lezer tree the fenced-line decorations use — it
        // already owns the fence/list/indent rules, so the scans stay in
        // step with what live mode actually renders, in every nesting shape.
        // Includes indented CodeBlocks (same "literal code, never live
        // markdown" contract in the preview). Block OPENING lines stay false
        // here so the dedicated ```mermaid / ```plantuml / ```tldraw handlers
        // below still match on them.
        const fenceBody: boolean[] = new Array(lastLine).fill(false);
        syntaxTree(state).iterate({
          enter: (node) => {
            if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(Math.min(node.to, doc.length)).number;
            for (let ln = startLine + 1; ln <= endLine; ln += 1) {
              fenceBody[ln - 1] = true;
            }
          },
        });
        const imageRefs = extractImageReferenceDefinitions(sourceLines, fenceBody);
        let i = 1;
        // Leading YAML frontmatter is document-level syntax. Render it as the
        // preview's properties card while the caret is outside the block;
        // entering it reveals the source, like every other live widget.
        const fmEnd = findFrontmatterEndLine(sourceLines);
        if (fmEnd !== null && !keepSource) {
          const cursorInside =
            (cursorLine >= 1 && cursorLine <= fmEnd) ||
            (cursorLineEnd >= 1 && cursorLineEnd <= fmEnd);
          if (!cursorInside) {
            const fmFrom = doc.line(1).from;
            const fmTo = doc.line(fmEnd).to;
            const rawYaml = extractFrontmatterYaml(doc.sliceString(fmFrom, fmTo));
            if (rawYaml !== null) {
              builder.add(
                fmFrom,
                fmTo,
                Decoration.replace({ widget: new FrontmatterWidget(rawYaml), block: true }),
              );
            }
          }
          i = fmEnd + 1;
        }
        while (i <= lastLine) {
          const line = doc.line(i);

          // Fence body (or closing fence): the content is code, never
          // live-renderable markdown — skip every scan below.
          if (fenceBody[i - 1]) {
            i += 1;
            continue;
          }

          // Raw block HTML (`<div>…</div>`, `<details>`, HTML tables, etc.).
          // Preview.vue has always rendered this through markdown-it, but live
          // edit previously left the tags visible. Collapse the complete block
          // while the caret is outside; entering it reveals the source again.
          const htmlEndIndex = findHtmlBlockEnd(sourceLines, i - 1);
          if (htmlEndIndex !== null) {
            const endI = htmlEndIndex + 1;
            const cursorInside =
              keepSource ||
              (cursorLine >= i && cursorLine <= endI) ||
              (cursorLineEnd >= i && cursorLineEnd <= endI);
            if (!cursorInside) {
              const blockFrom = line.from;
              const blockTo = doc.line(endI).to;
              const source = doc.sliceString(blockFrom, blockTo);
              builder.add(
                blockFrom,
                blockTo,
                Decoration.replace({
                  widget: new HtmlBlockWidget(
                    source,
                    opts.getImageRoot?.() ?? null,
                    opts.getFilePath?.(),
                    i,
                  ),
                  block: true,
                }),
              );
            }
            i = endI + 1;
            continue;
          }

          // Standalone HTML `<img ...>` line (#446).
          if (/^\s*<img\b[^>]*>\s*$/i.test(line.text)) {
            if (keepSource) {
              builder.add(
                line.to,
                line.to,
                Decoration.widget({
                  widget: new HtmlBlockWidget(
                    line.text,
                    opts.getImageRoot?.() ?? null,
                    opts.getFilePath?.(),
                    i,
                  ),
                  block: true,
                  side: 1,
                }),
              );
              i += 1;
              continue;
            }
            const cursorInside = i >= cursorLine && i <= cursorLineEnd;
            if (!cursorInside) {
              builder.add(
                line.from,
                line.to,
                Decoration.replace({
                  widget: new HtmlBlockWidget(
                    line.text,
                    opts.getImageRoot?.() ?? null,
                    opts.getFilePath?.(),
                    i,
                  ),
                  block: true,
                }),
              );
            }
            i += 1;
            continue;
          }

          // #506 — Standalone Markdown image line (`![alt](url)`, `[![alt](img)](link)`,
          // `![[1] alt](url)`, `![alt](<url>)`, `![alt][ref]`, etc.).
          const lineImages = findMarkdownImagesInLine(line.text, imageRefs);
          const isStandaloneImage =
            lineImages.length === 1 &&
            line.text.slice(0, lineImages[0].start).trim() === '' &&
            line.text.slice(lineImages[0].end).trim() === '';
          if (isStandaloneImage) {
            const imgSpan = lineImages[0];
            if (keepSource) {
              // Render below the source line and leave the line alone, so
              // clicking into it changes nothing on screen.
              const root = opts.getImageRoot?.() ?? null;
              const filePath = opts.getFilePath?.();
              const src = resolveImageSrc(imgSpan.src, root, filePath);
              const localPath = resolveImagePath(imgSpan.src, root, filePath);
              const needsFallback =
                isLocalSvgPath(localPath) ||
                localPath.startsWith('saf:') ||
                /^\/(?:storage\/emulated\/0|sdcard)\//i.test(localPath);
              builder.add(
                line.to,
                line.to,
                Decoration.widget({
                  widget: new ImageWidget(src, imgSpan.alt, needsFallback ? localPath : null, i),
                  block: true,
                  side: 1,
                }),
              );
              i += 1;
              continue;
            }
            const cursorInside = i >= cursorLine && i <= cursorLineEnd;
            if (!cursorInside) {
              const alt = imgSpan.alt;
              const rawSrc = imgSpan.src;
              const root = opts.getImageRoot?.() ?? null;
              const filePath = opts.getFilePath?.();
              const src = resolveImageSrc(rawSrc, root, filePath);
              const localPath = resolveImagePath(rawSrc, root, filePath);
              const needsFallback =
                isLocalSvgPath(localPath) ||
                localPath.startsWith('saf:') ||
                /^\/(?:storage\/emulated\/0|sdcard)\//i.test(localPath);
              builder.add(
                line.from,
                line.to,
                Decoration.replace({
                  widget: new ImageWidget(src, alt, needsFallback ? localPath : null, i),
                  block: true,
                }),
              );
            }
            i += 1;
            continue;
          }

          // v4.3.0 issue #57a / #433 — block math (`$$…$$` or `\[…\]`).
          // Recognise either inline `$$E=mc^2$$` / `\[E=mc^2\]` on a single
          // line OR a multi-line block opened with `$$` / `\[` and closed with
          // `$$` / `\]`. We only collapse if the cursor is outside.
          const trimmedLine = line.text.trim();
          if (trimmedLine.startsWith('$$') || trimmedLine.startsWith('\\[')) {
            const isBracket = trimmedLine.startsWith('\\[');
            const closeDelim = isBracket ? '\\]' : '$$';
            // Single-line `$$ ... $$` or `\[ ... \]`?
            if (trimmedLine.endsWith(closeDelim) && trimmedLine.length > 4) {
              const cursorInside = keepSource || cursorLine === i || cursorLineEnd === i;
              if (!cursorInside) {
                builder.add(
                  line.from,
                  line.to,
                  Decoration.replace({
                    widget: new MathWidget(line.text),
                    block: true,
                  }),
                );
              }
              i += 1;
              continue;
            }
            // Multi-line block — scan forward for the closing `$$` or `\]` line.
            let endI = i + 1;
            while (endI <= lastLine) {
              const nextTrimmed = doc.line(endI).text.trim();
              if (
                isBracket
                  ? nextTrimmed.startsWith('\\]') || nextTrimmed.endsWith('\\]')
                  : nextTrimmed.startsWith('$$') || nextTrimmed.endsWith('$$')
              ) {
                break;
              }
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = keepSource || (cursorLine >= i && cursorLine <= endI);
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                const source = doc.sliceString(blockFrom, blockTo);
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new MathWidget(source),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // v4.6 F7 — ```tldraw fenced whiteboard. The fence carries
          // id/height/width attributes and a variable-length backtick run
          // (3+, grown past backticks inside the JSON). Unlike every other
          // block here there is NO cursor-inside gating: the board always
          // replaces the fence (the JSON is never hand-edited), so the canvas
          // stays mounted while you type around it.
          const tldrawOpen = /^\s*(`{3,})\s*tldraw\b([^\n]*)$/i.exec(line.text);
          if (tldrawOpen) {
            const ticks = tldrawOpen[1].length;
            const closeRe = new RegExp(`^\\s*\`{${ticks},}\\s*$`);
            let endI = i + 1;
            while (endI <= lastLine && !closeRe.test(doc.line(endI).text)) {
              endI += 1;
            }
            if (endI <= lastLine) {
              const info = `tldraw${tldrawOpen[2]}`;
              let body = '';
              for (let k = i + 1; k < endI; k++) {
                body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
              }
              const fence = parseTldrawFence(info, body) ?? {
                boardId: '',
                height: TLDRAW_DEFAULT_HEIGHT,
                width: '',
                snapshot: body.trim(),
              };
              const blockFrom = doc.line(i).from;
              const blockTo = doc.line(endI).to;
              builder.add(
                blockFrom,
                blockTo,
                Decoration.replace({
                  widget: new TldrawWidget(
                    fence.boardId,
                    fence.height,
                    fence.width,
                    fence.snapshot,
                    opts,
                  ),
                  block: true,
                }),
              );
              i = endI + 1;
              continue;
            }
          }

          // v4.3.0 issue #57a — ```mermaid fenced block. Pre-render to SVG
          // via the mermaid cache; the widget waits for the SVG and asks
          // CM to rebuild decorations once ready.
          if (/^\s*```\s*mermaid\s*$/i.test(line.text)) {
            let endI = i + 1;
            while (endI <= lastLine) {
              const next = doc.line(endI);
              if (/^\s*```\s*$/.test(next.text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = keepSource || (cursorLine >= i && cursorLine <= endI);
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                // Body is between the opening and closing fence.
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                // Kick off async render outside the build loop.
                const mermaidTheme = opts.getMermaidTheme?.() ?? 'default';
                ensureMermaidRendered(body, mermaidTheme);
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new MermaidWidget(body, mermaidTheme, opts.getFilePath?.()),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // v5.0 — ```component fence: one widget renders a nested component
          // tree (stack/grid/tabs containers hosting query/callout/text, ...).
          if (/^\s*```\s*component\s*$/i.test(line.text)) {
            let endI = i + 1;
            while (endI <= lastLine) {
              if (/^\s*```\s*$/.test(doc.line(endI).text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = keepSource || (cursorLine >= i && cursorLine <= endI);
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new ComponentWidget(body, blockFrom, blockTo),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // Embedded ```query block — live table/list (same engine as Preview +
          // the saved-view builder). Cursor inside reveals the source YAML.
          if (/^\s*```\s*query\s*$/i.test(line.text)) {
            let endI = i + 1;
            while (endI <= lastLine) {
              if (/^\s*```\s*$/.test(doc.line(endI).text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = keepSource || (cursorLine >= i && cursorLine <= endI);
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new QueryWidget(body, blockFrom, blockTo),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // v4.10 issue #163 — ```plantuml / ```puml fence (opt-in).
          const plantumlCfg = opts.getPlantuml?.();
          if (
            plantumlCfg?.enabled &&
            plantumlCfg.server &&
            /^\s*```\s*(plantuml|puml)\s*$/i.test(line.text)
          ) {
            let endI = i + 1;
            while (endI <= lastLine) {
              const next = doc.line(endI);
              if (/^\s*```\s*$/.test(next.text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = keepSource || (cursorLine >= i && cursorLine <= endI);
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new PlantumlWidget(body, plantumlSvgUrl(plantumlCfg.server, body)),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // Table block — header + separator + ≥1 body row (including inside blockquotes, #480).
          const tableQuoteDepth = quoteDepth(line.text);
          if (isPipeRow(line.text, tableQuoteDepth) && i + 1 <= lastLine) {
            const sepLine = doc.line(i + 1);
            if (isSeparatorRow(sepLine.text, tableQuoteDepth) && i + 2 <= lastLine) {
              // Walk forward as long as we keep seeing pipe rows at the same quote depth.
              let endI = i + 2;
              while (endI <= lastLine) {
                const next = doc.line(endI);
                if (!isPipeRow(next.text, tableQuoteDepth)) break;
                endI += 1;
              }
              const tableEnd = endI - 1; // last pipe row
              if (tableEnd >= i + 2) {
                const cursorInside =
                  keepSource ||
                  (cursorLine >= i && cursorLine <= tableEnd
                    ? true
                    : cursorLineEnd >= i && cursorLineEnd <= tableEnd);
                if (!cursorInside) {
                  const blockFrom = doc.line(i).from;
                  const blockTo = doc.line(tableEnd).to;
                  const source = doc.sliceString(blockFrom, blockTo);
                  builder.add(
                    blockFrom,
                    blockTo,
                    Decoration.replace({
                      widget: new TableWidget(
                        source,
                        opts.getImageRoot?.() ?? null,
                        opts.getFilePath?.(),
                        i,
                      ),
                      block: true,
                    }),
                  );
                }
                i = tableEnd + 1;
                continue;
              }
            }
          }

          // #506 — When `keepSource` is enabled and this non-standalone line
          // (e.g. a list item `- ![alt](url)` or blockquote `> ![alt](url)`)
          // carries a Markdown image, render it below the source line.
          if (keepSource && lineImages.length > 0) {
            const firstImg = lineImages[0];
            const root = opts.getImageRoot?.() ?? null;
            const filePath = opts.getFilePath?.();
            const src = resolveImageSrc(firstImg.src, root, filePath);
            const localPath = resolveImagePath(firstImg.src, root, filePath);
            const needsFallback =
              isLocalSvgPath(localPath) ||
              localPath.startsWith('saf:') ||
              /^\/(?:storage\/emulated\/0|sdcard)\//i.test(localPath);
            builder.add(
              line.to,
              line.to,
              Decoration.widget({
                widget: new ImageWidget(src, firstImg.alt, needsFallback ? localPath : null, i),
                block: true,
                side: 1,
              }),
            );
            i += 1;
            continue;
          }

          // v4.5.5 / #506 — inline math (`$…$`) and inline / list-item /
          // blockquote images (`- ![alt](url)`, `> ![alt](url)`, inline `![alt](url)`)
          // on an otherwise-plain line. Render each span while the caret is
          // off this line (same reveal model as the block widgets above: move
          // the caret onto the line to edit source).
          const inlineCursorHere = keepSource || (i >= cursorLine && i <= cursorLineEnd);
          if (!inlineCursorHere) {
            const hasMathCandidate =
              line.text.indexOf('$') !== -1 ||
              line.text.indexOf('\\(') !== -1 ||
              line.text.indexOf('\\[') !== -1;
            if (lineImages.length > 0 || hasMathCandidate) {
              const inlineSpans: Array<{ start: number; end: number; deco: Decoration }> = [];
              const root = lineImages.length > 0 ? (opts.getImageRoot?.() ?? null) : null;
              const filePath = lineImages.length > 0 ? opts.getFilePath?.() : undefined;
              for (const imgSpan of lineImages) {
                const src = resolveImageSrc(imgSpan.src, root, filePath);
                const localPath = resolveImagePath(imgSpan.src, root, filePath);
                const needsFallback =
                  isLocalSvgPath(localPath) ||
                  localPath.startsWith('saf:') ||
                  /^\/(?:storage\/emulated\/0|sdcard)\//i.test(localPath);
                inlineSpans.push({
                  start: imgSpan.start,
                  end: imgSpan.end,
                  deco: Decoration.replace({
                    widget: new ImageWidget(
                      src,
                      imgSpan.alt,
                      needsFallback ? localPath : null,
                      i,
                      true,
                    ),
                  }),
                });
              }
              if (hasMathCandidate) {
                for (const mathSpan of inlineMathSpans(line.text)) {
                  const overlapsImage = lineImages.some(
                    (im) => mathSpan.start < im.end && mathSpan.end > im.start,
                  );
                  if (!overlapsImage) {
                    inlineSpans.push({
                      start: mathSpan.start,
                      end: mathSpan.end,
                      deco: Decoration.replace({ widget: new InlineMathWidget(mathSpan.tex) }),
                    });
                  }
                }
              }
              inlineSpans.sort((a, b) => a.start - b.start);
              for (const item of inlineSpans) {
                builder.add(line.from + item.start, line.from + item.end, item.deco);
              }
            }
          }

          i += 1;
        }

        return builder.finish();
}

/**
 * Live-render of standalone images / tables / block-math / Mermaid in the
 * WYSIWYG "live edit" mode. Returns a StateField (block decorations are not
 * allowed from view plugins) plus a companion view plugin that turns the
 * async-Mermaid `xiaoyuan-note:cm-relayout` window event into a field recompute.
 */
export function liveBlocksExtension(opts: BlockOptions = {}) {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildBlockDecorations(state, opts),
    update(deco, tr) {
      // Rebuild on edits, on a relayout signal (Mermaid SVG ready), and on
      // the drag-end flush. Selection moves rebuild too (cursor entering a
      // block reveals its source), but not mid-drag — see cm-drag-aware.ts.
      const frozen = frozenFieldDuringComposition(tr, deco);
      if (frozen) return frozen;
      if (isImeSafeFlushTransaction(tr)) return buildBlockDecorations(tr.state, opts);
      if (tr.docChanged) return buildBlockDecorations(tr.state, opts);
      if (isDragEndTransaction(tr)) return buildBlockDecorations(tr.state, opts);
      // Freeze block widget replacements completely during pointer drag so
      // incremental Lezer parsing (~700 lines into a large file) or async
      // Mermaid relayouts cannot mount/unmount widgets mid-drag and shift the
      // document height under the pointer. `isDragEndTransaction` above flushes
      // the final state as soon as the pointer is released.
      if (isDragging(tr.state)) {
        return deco.map(tr.changes);
      }
      if (tr.effects.some((e) => e.is(relayoutEffect))) {
        return buildBlockDecorations(tr.state, opts);
      }
      if (tr.selection) {
        return buildBlockDecorations(tr.state, opts);
      }
      if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
        return buildBlockDecorations(tr.state, opts);
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Mermaid renders asynchronously; when its SVG cache fills, the widget
  // fires `xiaoyuan-note:cm-relayout`. Translate that into a `relayoutEffect` so the
  // field rebuilds and the widget remounts with the finished SVG.
  const relayout = ViewPlugin.fromClass(
    class {
      private readonly onRelayout: () => void;
      private readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        this.onRelayout = () => {
          view.dispatch({ effects: relayoutEffect.of(null) });
        };
        window.addEventListener('xiaoyuan-note:cm-relayout', this.onRelayout);
      }
      update() {
        if (this.view.hasFocus) activeView = this.view;
      }
      destroy() {
        if (activeView === this.view) activeView = null;
        window.removeEventListener('xiaoyuan-note:cm-relayout', this.onRelayout);
      }
    },
  );

  // #155 — ↑/↓ across a collapsed block widget. CM's default vertical motion
  // has no valid cursor position inside a replaced range, so from the line
  // next to a table/math/mermaid widget it hops clear over the block. Reveal
  // model says the caret should land ON the block's edge line instead, which
  // expands it to source. We compute the default target first and only step
  // in when that target would jump past a collapsed range.
  const arrowIntoBlock = (forward: boolean) => (view: EditorView) => {
    const sel = view.state.selection.main;
    if (!sel.empty || view.state.selection.ranges.length > 1) return false;
    const deco = view.state.field(field, false);
    if (!deco) return false;
    const doc = view.state.doc;
    const fromLine = doc.lineAt(sel.head);
    const def = view.moveVertically(sel, forward);
    const toLineNo = doc.lineAt(def.head).number;
    let handled = false;
    deco.between(0, doc.length, (from, to, d) => {
      if (!(d.spec as { block?: boolean }).block) return;
      // tldraw boards never reveal their source (no cursor-inside gating in
      // buildBlockDecorations), so parking the caret inside one just hides
      // it — let the default motion hop over the fence instead.
      if ((d.spec as { widget?: unknown }).widget instanceof TldrawWidget) return;
      const a = doc.lineAt(from).number;
      const b = doc.lineAt(to).number;
      const jumpedOver = forward
        ? fromLine.number < a && toLineNo > b
        : fromLine.number > b && toLineNo < a;
      if (!jumpedOver) return;
      const edge = doc.line(forward ? a : b);
      const col = Math.min(sel.head - fromLine.from, edge.length);
      view.dispatch({
        selection: { anchor: edge.from + col },
        scrollIntoView: true,
        userEvent: 'select',
      });
      handled = true;
      return false;
    });
    return handled;
  };
  const blockArrowKeymap = Prec.high(
    keymap.of([
      { key: 'ArrowUp', run: arrowIntoBlock(false) },
      { key: 'ArrowDown', run: arrowIntoBlock(true) },
    ]),
  );

  // #155 (vim) — the arrow keymap above never sees vim's `j`/`k`, which run
  // through @replit/codemirror-vim's own key handling, so vim motions still
  // hopped clear over collapsed blocks. Instead of chasing vim's dispatch
  // path, catch the *signature* of that hop at the transaction level: an
  // empty-cursor selection moving in one step from the line directly above a
  // collapsed block to the line directly below it (or the reverse). Only a
  // single-line vertical motion produces that pair, so counted jumps (`5j`),
  // searches and `G` stay untouched; pointer selections are excluded
  // explicitly. Retarget to the block's edge line — same reveal model as the
  // arrow fix.
  const vimBlockHop = EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection) return tr;
    const userEvent = tr.annotation(Transaction.userEvent);
    if (userEvent && userEvent.includes('pointer')) return tr;
    const prev = tr.startState.selection.main;
    const next = tr.newSelection.main;
    if (!prev.empty || !next.empty || tr.newSelection.ranges.length > 1) return tr;
    const doc = tr.startState.doc;
    const fromNo = doc.lineAt(prev.head).number;
    const toNo = doc.lineAt(next.head).number;
    if (Math.abs(toNo - fromNo) < 2) return tr;
    const deco = tr.startState.field(field, false);
    if (!deco) return tr;
    let retarget: number | null = null;
    deco.between(0, doc.length, (from, to, d) => {
      if (!(d.spec as { block?: boolean }).block) return;
      if ((d.spec as { widget?: unknown }).widget instanceof TldrawWidget) return;
      const a = doc.lineAt(from).number;
      const b = doc.lineAt(to).number;
      const forwardHop = fromNo === a - 1 && toNo === b + 1;
      const backwardHop = fromNo === b + 1 && toNo === a - 1;
      if (!forwardHop && !backwardHop) return;
      const edge = doc.line(forwardHop ? a : b);
      const col = Math.min(prev.head - doc.lineAt(prev.head).from, edge.length);
      retarget = edge.from + col;
      return false;
    });
    if (retarget === null) return tr;
    return [tr, { selection: EditorSelection.cursor(retarget), scrollIntoView: true, sequential: true }];
  });

  return [field, relayout, blockArrowKeymap, vimBlockHop];
}

/** Suggested CSS — pulled out so the editor's theme owns the rule set. */
export const liveBlocksTheme = EditorView.theme({
  // #155 — block widgets must NOT carry vertical margins: CodeMirror measures
  // widget height via the border box, so margin space is invisible to its
  // height map. The resulting drift between the height map and the real DOM
  // below a table/image/math widget made ↑/↓ teleport across whole screens
  // (moveVertically scans with height-map coordinates). Spacing lives in
  // padding instead, which IS measured.
  '.cm-live-block': {
    margin: '0',
    padding: '0.6em 0',
    cursor: 'text',
  },
  '.cm-live-block--image img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '6px',
    display: 'block',
  },
  '.cm-live-block--image-inline': {
    display: 'inline-block',
    verticalAlign: 'middle',
    maxWidth: '100%',
    padding: '0.25em 0',
  },
  '.cm-live-block--html': {
    maxWidth: '100%',
    overflowX: 'auto',
  },
  '.cm-live-block--html img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '6px',
  },
  '.cm-live-block--html table': {
    borderCollapse: 'collapse',
  },
  '.cm-live-block--html th, .cm-live-block--html td': {
    border: '1px solid var(--border)',
    padding: '6px 12px',
  },
  '.cm-live-block--broken': {
    color: 'var(--text-faint)',
    fontStyle: 'italic',
  },
  '.cm-live-block--table blockquote': {
    margin: '0.2em 0',
    paddingLeft: '1em',
    borderLeft: '3px solid var(--accent)',
    color: 'var(--text-muted)',
  },
  '.cm-live-block--table table': {
    borderCollapse: 'collapse',
    margin: '0.4em 0',
    fontSize: '0.95em',
    // Body text runs at 1.8; table rows read better tighter (as in preview).
    lineHeight: '1.6',
  },
  '.cm-live-block--table th, .cm-live-block--table td': {
    border: '1px solid var(--border)',
    padding: '6px 12px',
    textAlign: 'left',
  },
  '.cm-live-block--table thead th': {
    background: 'var(--bg-elev)',
    fontWeight: '600',
  },
  // v4.3.0 issue #57a — paddings fold in the 0.6em that used to come from the
  // shared margin (see #155 note above) so the visual rhythm is unchanged.
  '.cm-live-block--math': {
    padding: '1em 0',
    overflowX: 'auto',
    textAlign: 'center',
  },
  '.cm-live-block--mermaid': {
    padding: '1.2em 0',
    textAlign: 'center',
  },
  '.cm-live-block--mermaid svg': {
    maxWidth: '100%',
    height: 'auto',
  },
  // v4.10 #163
  '.cm-live-block--plantuml': {
    padding: '1.2em 0',
    textAlign: 'center',
  },
  '.cm-live-block--plantuml img': {
    maxWidth: '100%',
    height: 'auto',
  },
  // v4.6 F7 — tldraw whiteboard card. A bordered surface hosting the live
  // canvas; the inner `.cm-tldraw-surface` fills it so tldraw can measure.
  // The bordered card is an inner element (`.cm-tldraw-card`) so the outer
  // block can keep its measurable padding (#155) without the border growing
  // around it.
  '.cm-live-block--tldraw': {
    width: '100%',
  },
  '.cm-tldraw-card': {
    position: 'relative',
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  '.cm-tldraw-surface': {
    position: 'absolute',
    inset: '0',
  },
  '.cm-tldraw-loading': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    height: '100%',
    color: 'var(--text-faint)',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  '.cm-tldraw-spinner': {
    width: '14px',
    height: '14px',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent, var(--text-faint))',
    borderRadius: '50%',
    animation: 'cm-tldraw-spin 0.7s linear infinite',
    flex: '0 0 auto',
  },
  '@keyframes cm-tldraw-spin': {
    to: { transform: 'rotate(360deg)' },
  },
  '.cm-tldraw-toolbar': {
    position: 'absolute',
    top: '6px',
    right: '6px',
    zIndex: '5',
    display: 'flex',
    gap: '4px',
  },
  '.cm-tldraw-fullscreen': {
    appearance: 'none',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    borderRadius: '6px',
    width: '26px',
    height: '26px',
    lineHeight: '1',
    cursor: 'pointer',
    fontSize: '14px',
    opacity: '0.85',
  },
  '.cm-tldraw-fullscreen:hover': {
    opacity: '1',
  },
});

// Re-exported helpers in case the editor wants to wire up the imageRoot
// extractor from outside.
export { extractImageRoot };
