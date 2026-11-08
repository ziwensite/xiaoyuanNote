/**
 * Width rules for the header's three-segment layout (left panels · editor ·
 * right panels).
 *
 * The middle segment holds the editor tab strip and the 实时/源码/分栏/预览
 * switch. The switch alone is ~210px (4 buttons of at least 44px + 12px button
 * padding, 3px track padding and 6px margin — see `.seg` in Toolbar.vue), and a
 * single tab can take 220px before it truncates (`max-width` in PaneTabBar.vue).
 * Below 470px they stop fitting side by side without squeezing the tab, so the
 * switch moves into the More menu and the strip keeps its horizontal scroll.
 *
 * 470px is derived from those CSS constants, NOT measured in a running window —
 * re-check with devtools after changing `.seg`/`.tab` sizing.
 */
export const VIEW_MODE_FOLD_THRESHOLD = 470;

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
