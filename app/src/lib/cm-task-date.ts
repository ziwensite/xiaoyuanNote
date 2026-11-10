/**
 * Type a natural-language date at the end of a task line and it becomes the
 * standard token on the spot: `- [ ] 交报告 明天` + space → `📅 2026-11-11`.
 *
 * The work is done by `task-date-phrases.ts`, which returns exact ranges; this
 * file only decides *when* to run it (a space at the end of a task line) and
 * applies the changes together with the space itself, so the document goes
 * through one transaction and undo takes back the whole conversion.
 *
 * A space is the boundary because it is what ends a word in English and what
 * people type after a Chinese phrase; without one, `明天` would be rewritten
 * the instant its last character was typed, before `明天下午` was finished.
 */

import { EditorView } from '@codemirror/view';
import { naturalDateChanges } from './task-date-phrases';

export function taskDatePhraseExtension(today: () => string) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ' ' || from !== to || view.composing) return false;
    const line = view.state.doc.lineAt(from);
    const prefix = view.state.sliceDoc(line.from, from);
    const changes = naturalDateChanges(prefix, today());
    if (!changes) return false;
    const specs = changes
      .map((c) => ({ from: line.from + c.from, to: line.from + c.to, insert: c.insert }))
      .sort((a, b) => a.from - b.from);
    specs.push({ from, to, insert: text });
    view.dispatch({ changes: specs });
    return true;
  });
}
