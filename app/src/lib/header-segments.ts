/**
 * Width rules for the header's three-segment layout (left panels · editor ·
 * right panels).
 *
 * The middle segment holds the editor tab strip, the mode picker and More.
 * The picker is compact now (icon + current mode + chevron, ~110px; the four
 * options live in its menu — see `.mode-btn` in Toolbar.vue), and a single tab
 * can take 220px before it truncates (`max-width` in PaneTabBar.vue). Below
 * 320px the picker would start squeezing the tab, so it moves into the More
 * menu and the strip keeps its horizontal scroll.
 *
 * 320px is derived from those CSS constants, NOT measured in a running window —
 * re-check with devtools after changing `.mode-btn`/`.tab` sizing.
 */
export const VIEW_MODE_FOLD_THRESHOLD = 320;

/**
 * True while the middle segment is too narrow for the inline view-mode switch.
 * A non-finite width (first frame, before the ResizeObserver reports) reads as
 * "it fits", so the header does not flash the folded state on mount.
 */
export function shouldFoldViewModes(
  middleWidth: number,
  threshold = VIEW_MODE_FOLD_THRESHOLD,
): boolean {
  if (!Number.isFinite(middleWidth)) return false;
  return middleWidth < threshold;
}
