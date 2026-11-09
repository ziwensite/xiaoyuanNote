import { reactive } from 'vue';

/**
 * 这是「聚焦顶部搜索框」的唯一状态源：命令、快捷键（⌘⇧F / Ctrl+Shift+F）、
 * View › Search in Folder 与 TagsPanel 的 `#tag` 都走 `requestHeaderSearch`，
 * 不产生第二套面板开关 —— 可见入口始终只是标题行里的那一个输入框。
 *
 * A monotonic `focusSeq` (rather than a boolean) lets a request re-focus and
 * re-select even when the box already has focus.
 */
export const headerSearch = reactive({ prefill: '', focusSeq: 0 });

export function requestHeaderSearch(term?: string): void {
  // A term replaces the text; a plain request leaves whatever the user typed
  // alone. The box clears `prefill` once it has consumed it, so the value is
  // one-shot and a later ⌘⇧F never resurrects a stale tag.
  if (term !== undefined) headerSearch.prefill = term;
  headerSearch.focusSeq += 1;
}

/** Move a flat-list selection by `delta`, clamped to `[0, length - 1]`. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}

/** Same shortening rule as GlobalSearch: strip the workspace prefix, else
 *  keep the last two path segments (`vault/notes.md`). */
export function shortPath(path: string, folder: string | null | undefined): string {
  if (folder && path.startsWith(folder)) {
    // 统一成正斜杠：Windows 命中在标题行下拉里也读成 `dir/a.md`。
    return path.slice(folder.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
  }
  return path.split(/[\\/]/).slice(-2).join('/');
}
