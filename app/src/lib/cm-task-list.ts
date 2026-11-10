/**
 * Task list checkbox interactivity for CodeMirror 6.
 *
 * GFM's `TaskMarker` node only exists for `[ ]` and `[x]`, so `[/]`, `[-]`,
 * `[?]` and any custom status Obsidian Tasks understands would stay as literal
 * text and could not be clicked. This scans task lines with a regex instead,
 * which keeps every status character clickable, and derives the checkbox state
 * from the same status table the rest of the app uses (`taskStatusRule`).
 *
 * The marker stays a real <input type="checkbox">; clicking it rewrites only
 * the three characters between the brackets.
 */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { frozenDuringComposition, isImeSafeFlushTransaction } from './cm-ime-guard';
import { taskStatusRule } from './tasks';

const TOGGLE_EVENT = 'solomd-task-toggle';

/** `- [ ]` / `* [x]` / `1. [/]`, with any single status character. */
const TASK_MARKER = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+)(\[[^\]\n]\])(?=[ \t]|$)/u;

interface ToggleDetail {
  from: number;
  to: number;
  checked: boolean;
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return (
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  toDOM(): HTMLElement {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.checked;
    cb.className = 'cm-task-checkbox';
    cb.style.cursor = 'pointer';
    cb.style.verticalAlign = 'middle';
    cb.style.margin = '0 4px 0 0';
    cb.addEventListener('mousedown', (e) => e.preventDefault());
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const detail: ToggleDetail = {
        from: this.from,
        to: this.to,
        checked: !this.checked,
      };
      cb.dispatchEvent(
        new CustomEvent<ToggleDetail>(TOGGLE_EVENT, {
          bubbles: true,
          detail,
        }),
      );
    });
    return cb;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Fenced and indented code must keep showing raw `[ ]` text. */
function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent as typeof node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
}

function buildTaskDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const found: Array<{ from: number; to: number; checked: boolean }> = [];

  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = doc.lineAt(pos);
      const m = TASK_MARKER.exec(line.text);
      if (m && !insideCode(view.state, line.from + m[1].length)) {
        const from = line.from + m[1].length;
        found.push({
          from,
          to: from + m[2].length,
          checked: taskStatusRule(m[2][1]).type === 'done',
        });
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }

  // Visible ranges may start mid-line, so the scan can revisit a line; sort
  // before building because RangeSetBuilder insists on ascending positions.
  found.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const item of found) {
    if (item.from === last) continue;
    last = item.from;
    builder.add(
      item.from,
      item.to,
      Decoration.replace({
        widget: new TaskWidget(item.checked, item.from, item.to),
      }),
    );
  }
  return builder.finish();
}

export function taskListExtension() {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly onToggle: (ev: Event) => void;
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.decorations = buildTaskDecorations(view);
        this.onToggle = (ev: Event) => {
          const ce = ev as CustomEvent<ToggleDetail>;
          const d = ce.detail;
          if (!d) return;
          if (d.to > view.state.doc.length) return;
          const current = view.state.doc.sliceString(d.from, d.to);
          const m = /^\[([^\]\n])\]$/u.exec(current);
          if (!m) return;
          // Ticking advances the status table (unknown → `x`); unticking goes
          // back to TODO through the same table.
          const next = d.checked ? taskStatusRule(m[1]).next : taskStatusRule('x').next;
          view.dispatch({
            changes: { from: d.from, to: d.to, insert: `[${next}]` },
          });
        };
        view.dom.addEventListener(TOGGLE_EVENT, this.onToggle);
      }

      update(update: ViewUpdate) {
        // IME composition guard (#108) — see cm-ime-guard.ts.
        const frozen = frozenDuringComposition(update, this.decorations);
        if (frozen) {
          this.decorations = frozen;
          return;
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some(isImeSafeFlushTransaction) ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildTaskDecorations(update.view);
        }
      }

      destroy() {
        this.view.dom.removeEventListener(TOGGLE_EVENT, this.onToggle);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  return [plugin];
}
