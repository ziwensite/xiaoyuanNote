/**
 * CodeMirror half of the task-line space menu (batches 5–6).
 *
 * `task-suggest.ts` decides *what* the menu offers and what each row writes;
 * this file decides *when* it is shown, owns the popup's lifetime, and walks
 * the two levels. The contract these batches were written against:
 *
 *   - the space itself is ordinary typing — the menu only opens after it, and
 *     is never allowed to swallow the key (IME composition included);
 *   - until a row is chosen, nothing writes to the document: Esc, typing
 *     another character, clicking away, scrolling or losing focus just close
 *     the popup, byte for byte;
 *   - picking a row is one transaction (`userEvent: input.complete`), so one
 *     undo takes the token away again.
 *
 * Levels (batch 6): the marker list is L0. A row that opens the values of one
 * marker (`📅 截止`, `🔁 重复`) is a `more` row — Enter re-opens the same popup
 * at the same caret with the value list instead, still writing nothing.
 * `ArrowLeft` / `Backspace` go back one level (value list → marker list) and
 * are consumed; at the marker list they are left alone so ordinary editing
 * resumes. Esc always closes outright.
 *
 * The popup lives on `document.body` with `position: fixed` coordinates from
 * `coordsAtPos`, because the editor's own scroller would clip it. Focus never
 * leaves the editor, so the keymap below keeps working while it is open.
 */

import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import {
  taskSuggestGroupLabel,
  taskSuggestions,
  type TaskSuggestGroup,
  type TaskSuggestMenu,
  type TaskSuggestMore,
  type TaskSuggestRequest,
  type TaskSuggestRow,
  type TaskSuggestWrite,
} from './task-suggest';

export interface TaskSuggestOptions {
  /** Today as `YYYY-MM-DD`; called per open so a long session rolls over. */
  today: () => string;
  /** UI language, for the row labels (`zh` gets Chinese, everything else English). */
  lang: () => string;
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

/** Write one row's token and close. One transaction, one undo step. */
function accept(view: EditorView, row: Row): void {
  const item = row.item as TaskSuggestWrite;
  close(view);
  view.dispatch({
    changes: { from: row.from, to: row.to, insert: item.insert },
    selection: { anchor: row.from + item.insert.length },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  view.focus();
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
  const menu = taskSuggestions(line.text, pos - line.from, opts.today(), lang, request);
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
  let group: TaskSuggestGroup | null = null;
  for (const item of menu.rows) {
    // The marker level groups its rows; a value level is titled instead.
    if (!menu.title && item.group !== group) {
      group = item.group;
      const heading = document.createElement('div');
      heading.className = 'task-suggest__group';
      heading.textContent = taskSuggestGroupLabel(group, lang);
      el.appendChild(heading);
    }

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
      arrow.textContent = '›';
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
      if (item.kind === 'more') {
        open(view, pos, opts, { stage: item.stage, field: item.field });
      } else {
        accept(view, row);
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
        const menu = taskSuggestions(line.text, sel.from - line.from, opts.today(), opts.lang());
        if (!menu || !menu.rows.length) return false;
        view.dispatch({
          changes: { from: sel.from, insert: ' ' },
          selection: { anchor: sel.from + 1 },
          userEvent: 'input.type',
          scrollIntoView: true,
        });
        // Opened after the transaction: the plugin's update() has already run,
        // so inserting the space cannot close the menu that the space asked for.
        open(view, sel.from + 1, opts);
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
        if (row.item.kind === 'more') descend(view, runtime, row.item);
        else accept(view, row);
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
