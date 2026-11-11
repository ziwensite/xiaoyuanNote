/**
 * Desktop-vs-overlay decision for virtual editor inputs.
 *
 * Width is measured on the editor column, never `window.innerWidth`: the
 * sidebars and split panes decide how much room a virtual tab really gets.
 * Phones and tablets keep their overlay/sheet form regardless of width.
 */
import { isNarrowViewport, isTabletOverlayViewport } from '../composables/useViewport';

/** Below this a two-column virtual editor (month grid, settings nav) cramps. */
export const EDITOR_TAB_MIN_WIDTH = 720;

export function editorColumnWidth(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelector<HTMLElement>('.main-col')?.clientWidth ?? 0;
}

export function prefersOverlayEditor(): boolean {
  if (isNarrowViewport() || isTabletOverlayViewport()) return true;
  return editorColumnWidth() < EDITOR_TAB_MIN_WIDTH;
}
