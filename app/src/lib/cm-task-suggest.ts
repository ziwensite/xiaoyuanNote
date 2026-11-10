/**
 * CodeMirror half of the task-line space menu (batch 5).
 *
 * `task-suggest.ts` decides *what* the menu offers and what each row writes;
 * this file decides *when* it is shown and owns the popup's lifetime. The
 * contract the batch was written against:
 *
 *   - the space itself is ordinary typing — the menu only opens after it, and
 *     is never allowed to swallow the key (IME composition included);
 *   - until a row is chosen, nothing writes to the document: Esc, typing
 *     another character, clicking away, scrolling or losing focus just close
 *     the popup, byte for byte;
 *   - picking a row is one transaction (`userEvent: input.complete`), so one
 *     undo takes the token away again.
 *
 * The popup lives on `document.body` with `position: fixed` coordinates from
 * `coordsAtPos`, because the editor's own scroller would clip it. Focus never
 * leaves the editor, so the keymap below keeps working while it is open.
 */

import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { taskSuggestions, type TaskSuggestGroup, type TaskSuggestion } from './task-suggest';

export interface TaskSuggestOptions {
  /** Today as `YYYY-MM-DD`; called per open so a long session rolls over. */
  today: () => string;
  /** UI language, for the row labels (`zh` gets Chinese, everything else English). */
  lang: () => string;
}

/** A row plus the absolute (document) range it replaces. */
interface Placement {
  item: TaskSuggestion;
  from: number;
  to: number;
}

interface Row {
  node: HTMLElement;
  placement: Placement;
}

interface Runtime {
  el: HTMLElement;
  rows: Row[];
  active: number;
  onScroll: () => void;
  onResize: () => void;
  onDocMouseDown: (e: MouseEvent) => void;
}

const runtimes = new WeakMap<EditorView, Runtime>();

const GROUP_LABELS: Record<TaskSuggestGroup, { zh: string; en: string }> = {
  date: { zh: '日期', en: 'Date' },
  field: { zh: '字段', en: 'Field' },
  priority: { zh: '优先级', en: 'Priority' },
  status: { zh: '状态', en: 'Status' },
  repeat: { zh: '重复', en: 'Repeat' },
};

function groupLabel(group: TaskSuggestGroup, lang: string): string {
  const entry = GROUP_LABELS[group];
  return lang.toLowerCase().startsWith('zh') ? entry.zh : entry.en;
}

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
function accept(view: EditorView, placement: Placement): void {
  close(view);
  view.dispatch({
    changes: { from: placement.from, to: placement.to, insert: placement.item.insert },
    selection: { anchor: placement.from + placement.item.insert.length },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  view.focus();
}

function open(view: EditorView, pos: number, opts: TaskSuggestOptions): void {
  close(view);
  const line = view.state.doc.lineAt(pos);
  const lang = opts.lang();
  // Read the line *after* the space landed, so every range already accounts
  // for it and the token is never glued to the word before the space.
  const items = taskSuggestions(line.text, pos - line.from, opts.today(), lang);
  if (!items || !items.length) return;

  const el = document.createElement('div');
  el.className = 'task-suggest';
  el.setAttribute('role', 'listbox');

  const rows: Row[] = [];
  let group: TaskSuggestGroup | null = null;
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      const heading = document.createElement('div');
      heading.className = 'task-suggest__group';
      heading.textContent = groupLabel(group, lang);
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
    if (item.detail) {
      const detail = document.createElement('span');
      detail.className = 'task-suggest__detail';
      detail.textContent = item.detail;
      node.appendChild(detail);
    }

    const placement: Placement = {
      item,
      from: line.from + item.from,
      to: line.from + item.to,
    };
    const index = rows.length;
    node.addEventListener('mousedown', (e) => {
      // Keep the caret in the editor: no blur, no selection change.
      e.preventDefault();
      e.stopPropagation();
      accept(view, placement);
    });
    node.addEventListener('mouseenter', () => setActive(view, index));
    el.appendChild(node);
    rows.push({ node, placement });
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

export function taskSuggestExtension(opts: TaskSuggestOptions): Extension {
  const commands = [
    {
      key: 'Space',
      run: (view: EditorView) => {
        // While an input method owns the keystrokes, a space is the IME's:
        // never open the menu and never take the key.
        if (view.composing) return false;
        const sel = view.state.selection.main;
        if (!sel.empty) return false;
        const line = view.state.doc.lineAt(sel.from);
        const items = taskSuggestions(line.text, sel.from - line.from, opts.today(), opts.lang());
        if (!items || !items.length) return false;
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
        accept(view, row.placement);
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
