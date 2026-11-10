/**
 * CodeMirror half of the task-line space menu (batches 5–7).
 *
 * `task-suggest.ts` decides *what* the menu offers; this file decides *when* it
 * is shown, owns the popup's lifetime, and walks the two levels. The contract
 * these batches were written against:
 *
 *   - the space itself is ordinary typing — the menu never swallows it (IME
 *     composition included). Since batch 7 a *single* space no longer opens
 *     anything: L0 needs two spaces in a row (so English typing stops popping
 *     menus), and only a bare marker followed by one space opens its L1;
 *   - until a row is chosen, nothing writes to the document: Esc, typing
 *     another character, clicking away, scrolling or losing focus just close
 *     the popup, byte for byte;
 *   - picking a row rewrites *one line* in one transaction — the write is
 *     re-serialized through `task-line.ts`, so the tokens land in the canonical
 *     order with single spaces, and one undo takes it all away;
 *   - the last row of every level hands the line to the task editor.
 *
 * Levels: the marker list is L0. A row that opens the values of one marker
 * (`[x]`, `📅`, `🔁`, `⏫`) is a `more` row — Enter re-opens the same popup at the same
 * caret with the value list instead, still writing nothing. `ArrowLeft` /
 * `Backspace` go back one level (value list → marker list) and are consumed; at
 * the marker list they are left alone so ordinary editing resumes. Esc always
 * closes outright.
 *
 * The popup lives on `document.body` with `position: fixed` coordinates from
 * `coordsAtPos`, because the editor's own scroller would clip it. Focus never
 * leaves the editor, so the keymap below keeps working while it is open.
 */

import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { taskLinePrefixLength, writeTaskLine, type TaskDateLink } from './task-line';
import {
  taskSuggestions,
  type TaskSuggestCandidate,
  type TaskSuggestEdit,
  type TaskSuggestMenu,
  type TaskSuggestMore,
  type TaskSuggestRequest,
  type TaskSuggestRow,
  type TaskSuggestWrite,
} from './task-suggest';

export interface TaskEditTarget {
  /** Document range of the whole line, terminator excluded. */
  from: number;
  to: number;
  /** The line's text, as the menu saw it. */
  line: string;
  /** The field to put the caret in, when a `🆔` / `⛔` value list asked. */
  focus?: 'id' | 'blockedBy';
}

export interface TaskSuggestOptions {
  /** Today as `YYYY-MM-DD`; called per open so a long session rolls over. */
  today: () => string;
  /** UI language, for the row labels (`zh` gets Chinese, everything else English). */
  lang: () => string;
  /**
   * IDs already used by tasks in the workspace, for the `🆔` / `⛔` value
   * lists. Called only when one of those lists opens; absent (no workspace
   * index) leaves those two rows as "type or edit…" and "clear".
   */
  knownIds?: () => TaskSuggestCandidate[];
  /** Opens the task editor for the line the menu is anchored on. */
  onEditTask?: (target: TaskEditTarget) => void;
}

/** A rendered row plus the absolute (document) range it replaces. */
interface Row {
  node: HTMLElement;
  item: TaskSuggestRow;
  from: number;
  to: number;
}

interface Runtime {
  el: HTMLElement;
  rows: Row[];
  active: number;
  /** The level on screen, so a `more` row can be turned into a request. */
  menu: TaskSuggestMenu;
  /** Caret the popup is anchored at; never moves while it is open. */
  pos: number;
  opts: TaskSuggestOptions;
  onScroll: () => void;
  onResize: () => void;
  onDocMouseDown: (e: MouseEvent) => void;
}

const runtimes = new WeakMap<EditorView, Runtime>();

/** Remove the popup and every listener it installed. Never touches the doc. */
function close(view: EditorView): void {
  const runtime = runtimes.get(view);
  if (!runtime) return;
  runtimes.delete(view);
  runtime.el.remove();
  view.scrollDOM.removeEventListener('scroll', runtime.onScroll, true);
  window.removeEventListener('resize', runtime.onResize);
  document.removeEventListener('mousedown', runtime.onDocMouseDown, true);
}

function setActive(view: EditorView, index: number): void {
  const runtime = runtimes.get(view);
  if (!runtime || !runtime.rows.length) return;
  const next = (index + runtime.rows.length) % runtime.rows.length;
  runtime.active = next;
  for (let i = 0; i < runtime.rows.length; i++) {
    const on = i === next;
    const { node } = runtime.rows[i];
    node.classList.toggle('task-suggest__row--active', on);
    node.setAttribute('aria-selected', String(on));
  }
  runtime.rows[next].node.scrollIntoView({ block: 'nearest' });
}

/**
 * Write one row and close. The write is spliced into the line and the whole
 * line goes back through `writeTaskLine`, so extra spaces collapse, the tokens
 * land in the canonical order and the status ↔ `✅`/`❌` link follows —
 * one transaction, one undo step.
 */
function accept(view: EditorView, runtime: Runtime, row: Row): void {
  const item = row.item as TaskSuggestWrite;
  close(view);
  const line = view.state.doc.lineAt(row.from);
  const from = row.from - line.from;
  const to = row.to - line.from;
  const raw = line.text.slice(0, from) + item.insert + line.text.slice(to);
  const link: TaskDateLink | null =
    item.link === 'status'
      ? { status: true }
      : item.link === 'completed'
        ? { completed: true }
        : item.link === 'cancelled'
          ? { cancelled: true }
          : null;
  const next = writeTaskLine(raw, runtime.opts.today(), link) ?? raw;
  // The token may have moved to its canonical slot, so look it up again; a
  // one-character write (a status) or a clear ends with the caret at the end.
  let anchor = line.from + next.length;
  if (item.insert.length > 1) {
    const at = next.indexOf(item.insert);
    if (at >= 0) anchor = line.from + at + item.insert.length;
  }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: next },
    selection: { anchor },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  view.focus();
}

/** The `任务编辑…` row: close the menu and hand the line to the caller. */
function requestEdit(view: EditorView, runtime: Runtime, item: TaskSuggestEdit): void {
  const line = view.state.doc.lineAt(runtime.pos);
  const target: TaskEditTarget = { from: line.from, to: line.to, line: line.text };
  if (item.focus) target.focus = item.focus;
  const opts = runtime.opts;
  close(view);
  opts.onEditTask?.(target);
}

/**
 * Show `request` (or whatever the line implies) at `pos`, replacing any popup
 * that is already there. Writing nothing is the point — swapping levels is a
 * DOM operation only, so Esc still leaves the line untouched.
 */
function open(
  view: EditorView,
  pos: number,
  opts: TaskSuggestOptions,
  request?: TaskSuggestRequest,
): void {
  close(view);
  const line = view.state.doc.lineAt(pos);
  const lang = opts.lang();
  // The caret is read after the space landed, so every range already accounts
  // for it and the token is never glued to the word before the space.
  // The ID pool is only read for the two lists that offer it.
  const wantsIds = !request || request.stage === 'id' || request.stage === 'blockedBy';
  const candidates = wantsIds ? (opts.knownIds?.() ?? []) : [];
  const menu = taskSuggestions(line.text, pos - line.from, opts.today(), lang, request, candidates);
  if (!menu || !menu.rows.length) return;

  const el = document.createElement('div');
  el.className = 'task-suggest';
  el.setAttribute('role', 'listbox');

  if (menu.title) {
    const title = document.createElement('div');
    title.className = 'task-suggest__title';
    title.textContent = menu.title;
    el.appendChild(title);
  }

  const rows: Row[] = [];
  for (const item of menu.rows) {
    const node = document.createElement('div');
    node.className = 'task-suggest__row';
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', 'false');

    const label = document.createElement('span');
    label.className = 'task-suggest__label';
    label.textContent = item.label;
    node.appendChild(label);

    if (item.kind === 'write' && item.detail) {
      const detail = document.createElement('span');
      detail.className = 'task-suggest__detail';
      detail.textContent = item.detail;
      node.appendChild(detail);
    } else if (item.kind === 'more') {
      node.classList.add('task-suggest__row--more');
      const arrow = document.createElement('span');
      arrow.className = 'task-suggest__detail';
      arrow.textContent = item.detail ? `${item.detail} ›` : '›';
      node.appendChild(arrow);
    }

    const from = line.from + (item.kind === 'write' ? item.from : 0);
    const to = line.from + (item.kind === 'write' ? item.to : 0);
    const row: Row = { node, item, from, to };
    const index = rows.length;
    node.addEventListener('mousedown', (e) => {
      // Keep the caret in the editor: no blur, no selection change.
      e.preventDefault();
      e.stopPropagation();
      if (item.kind === 'edit') {
        const runtime = runtimes.get(view);
        if (runtime) requestEdit(view, runtime, item);
      } else if (item.kind === 'more') {
        open(view, pos, opts, { stage: item.stage, field: item.field });
      } else {
        const runtime = runtimes.get(view);
        if (runtime) accept(view, runtime, row);
      }
    });
    node.addEventListener('mouseenter', () => setActive(view, index));
    el.appendChild(node);
    rows.push(row);
  }

  document.body.appendChild(el);

  const coords = view.coordsAtPos(pos);
  if (!coords) {
    el.remove();
    return;
  }
  const margin = 8;
  const rect = el.getBoundingClientRect();
  let top = coords.bottom + 4;
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, coords.top - rect.height - 4);
  }
  const left = Math.max(margin, Math.min(coords.left, window.innerWidth - rect.width - margin));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;

  const runtime: Runtime = {
    el,
    rows,
    active: 0,
    menu,
    pos,
    opts,
    onScroll: () => close(view),
    onResize: () => close(view),
    onDocMouseDown: (e) => {
      if (!el.contains(e.target as Node)) close(view);
    },
  };
  runtimes.set(view, runtime);
  view.scrollDOM.addEventListener('scroll', runtime.onScroll, true);
  window.addEventListener('resize', runtime.onResize);
  document.addEventListener('mousedown', runtime.onDocMouseDown, true);
  setActive(view, 0);
}

/** Enter on a `more` row: same popup, next level, still nothing written. */
function descend(view: EditorView, runtime: Runtime, item: TaskSuggestMore): void {
  open(view, runtime.pos, runtime.opts, { stage: item.stage, field: item.field });
}

/** Back one level (value list → marker list), writing nothing. */
function ascend(view: EditorView, runtime: Runtime): void {
  open(view, runtime.pos, runtime.opts, { stage: 'marker' });
}

export function taskSuggestExtension(opts: TaskSuggestOptions): Extension {
  const commands = [
    {
      key: 'Space',
      run: (view: EditorView) => {
        // While an input method owns the keystrokes, a space is the IME's:
        // never open the menu and never take the key.
        if (view.composing) return false;
        // With a menu open, a space is just typing: close and let it through.
        if (runtimes.has(view)) {
          close(view);
          return false;
        }
        const sel = view.state.selection.main;
        if (!sel.empty) return false;
        const line = view.state.doc.lineAt(sel.from);
        const caret = sel.from - line.from;
        const bodyStart = taskLinePrefixLength(line.text);
        if (!bodyStart || caret < bodyStart) return false;

        // Two spaces in a row → L0. One space after a bare marker → that
        // marker's L1. Every other space is just a space.
        const tail = line.text.slice(bodyStart, caret);
        const doubleSpace = tail !== '' && /\s$/u.test(tail);
        if (!doubleSpace) {
          const menu = taskSuggestions(line.text, caret, opts.today(), opts.lang());
          if (!menu || menu.stage === 'marker') return false;
        }

        view.dispatch({
          changes: { from: sel.from, insert: ' ' },
          selection: { anchor: sel.from + 1 },
          userEvent: 'input.type',
          scrollIntoView: true,
        });
        // Opened after the transaction: the plugin's update() has already run,
        // so inserting the space cannot close the menu that the space asked for.
        open(view, sel.from + 1, opts, doubleSpace ? { stage: 'marker' } : undefined);
        return true;
      },
    },
    {
      key: 'ArrowDown',
      run: (view: EditorView) => {
        const runtime = runtimes.get(view);
        if (!runtime) return false;
        setActive(view, runtime.active + 1);
        return true;
      },
    },
    {
      key: 'ArrowUp',
      run: (view: EditorView) => {
        const runtime = runtimes.get(view);
        if (!runtime) return false;
        setActive(view, runtime.active - 1);
        return true;
      },
    },
    {
      key: 'Enter',
      run: (view: EditorView) => {
        const runtime = runtimes.get(view);
        const row = runtime?.rows[runtime.active];
        if (!runtime || !row) return false;
        if (row.item.kind === 'edit') requestEdit(view, runtime, row.item);
        else if (row.item.kind === 'more') descend(view, runtime, row.item);
        else accept(view, runtime, row);
        return true;
      },
    },
    {
      key: 'ArrowLeft',
      run: (view: EditorView) => {
        const runtime = runtimes.get(view);
        // Only inside a value list: on the marker list this is a caret move,
        // which closes the popup through the plugin's update().
        if (!runtime || runtime.menu.stage === 'marker') return false;
        ascend(view, runtime);
        return true;
      },
    },
    {
      key: 'Backspace',
      run: (view: EditorView) => {
        const runtime = runtimes.get(view);
        if (!runtime || runtime.menu.stage === 'marker') return false;
        ascend(view, runtime);
        return true;
      },
    },
    {
      key: 'Escape',
      run: (view: EditorView) => {
        if (!runtimes.has(view)) return false;
        close(view);
        return true;
      },
    },
  ];

  const lifecycle = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (!runtimes.has(this.view)) return;
        // Any other edit, caret move or relayout makes the anchored ranges
        // stale; closing is silent and leaves the document untouched.
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          close(this.view);
        }
      }

      destroy() {
        close(this.view);
      }
    },
  );

  return [
    Prec.highest(keymap.of(commands)),
    EditorView.domEventHandlers({
      blur: (_event, view) => {
        close(view);
        return false;
      },
      compositionstart: (_event, view) => {
        close(view);
        return false;
      },
    }),
    lifecycle,
  ];
}
