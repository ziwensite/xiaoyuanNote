import type { Tab } from '../types';

/**
 * Single source of truth for "does this tab have unsaved changes?".
 *
 * Virtual editor tabs (calendar / settings / search / web) have no file and
 * no buffer, so they are never dirty. Keeping that rule here means every
 * caller — the tab strip's dot, close confirmation, window close, batch
 * close — agrees without re-implementing the comparison.
 */
export function isTabDirty(tab: Tab): boolean {
  if ((tab.kind ?? 'file') !== 'file') return false;
  if (tab.ephemeral && !tab.filePath) return false;
  return tab.content !== tab.savedContent;
}

/**
 * "Already saved" for batch close (Close Saved) and the menu's enabled state.
 *
 * This is intentionally stricter than `!isTabDirty`: a virtual tab is not a
 * saved document, so a sweeping "close saved" must not silently close the
 * calendar or settings tab. File tabs keep their historical behaviour.
 */
export function isFileTabSaved(tab: Tab): boolean {
  return (tab.kind ?? 'file') === 'file' && tab.content === tab.savedContent;
}
