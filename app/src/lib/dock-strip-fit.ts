/**
 * Geometry for the dock tab strip that now lives in the top chrome row.
 *
 * The strip used to sit inside each panel (`SidebarDock.vue`), so it could
 * overflow horizontally into its own `overflow: hidden` and simply hide tabs.
 * In the top row there is no such spare room: a hidden tab is an unreachable
 * pane, and letting the strip grow would push the inline search box and the
 * window caption buttons around. Hence a hard width cap per side plus a
 * `»` list for whatever does not fit.
 *
 * All numbers are the fixed sizes from the tab component. They are exported so
 * the component's CSS and this fit math cannot drift apart — and so the rules
 * below are unit-testable without a DOM.
 */

/** `.dock-tab` width / height. */
export const DOCK_TAB_SIZE = 26;
/** `.dock-strip` flex `gap` between tabs. */
export const DOCK_TAB_GAP = 2;
/** `.dock-strip` horizontal padding (4px each side). */
export const DOCK_STRIP_PAD = 8;
/** Width the trailing `+` button always reserves. */
export const DOCK_ADD_W = DOCK_TAB_SIZE;
/** Width of the `»` overflow trigger. */
export const DOCK_OVERFLOW_W = DOCK_TAB_SIZE;

/**
 * Share of the window width one side's strip may claim.
 *
 * Two strips can therefore never take more than half the row, which leaves the
 * inline search, the editor tab strip and the caption buttons a computable
 * minimum at every window width. 25% at 1440px is 360px — still above
 * `MAX_DOCK_WIDTH` (560), so the panel width only binds below ~1440px, which
 * is exactly where the cap should apply.
 */
export const DOCK_STRIP_VIEWPORT_SHARE = 0.25;

/**
 * Width cap for one side's strip: the panel it controls, but never more than
 * 25% of the window.
 */
export function dockStripCap(dockWidth: number, viewportWidth: number): number {
  const share = Math.round(viewportWidth * DOCK_STRIP_VIEWPORT_SHARE);
  const cap = Math.min(dockWidth, share);
  // Even when the row is tiny the strip must still be able to show `»` and `+`.
  return Math.max(cap, DOCK_STRIP_PAD + DOCK_ADD_W + DOCK_OVERFLOW_W + DOCK_TAB_GAP);
}

export interface DockStripLayout {
  /** Tabs rendered in the strip (the rest move into the `»` list). */
  visible: number;
  /** Whether the `»` trigger is shown. */
  overflow: boolean;
}

/** Width needed for `count` tab buttons, excluding padding / trailing chrome. */
export function tabsWidth(count: number): number {
  if (count <= 0) return 0;
  return count * DOCK_TAB_SIZE + (count - 1) * DOCK_TAB_GAP;
}

/**
 * How many tabs fit in `width`, and whether `»` is needed.
 *
 * `width <= 0` means "not measured yet": render everything for the first
 * paint instead of flashing an overflow button, then the ResizeObserver
 * supplies the real number.
 *
 * The overflow layout reserves `»` AND `+`, and never displays `count` tabs —
 * one tab always moves into the list, otherwise `»` would be a no-op.
 */
export function dockStripLayout(tabCount: number, width: number): DockStripLayout {
  if (tabCount <= 0) return { visible: 0, overflow: false };
  if (width <= 0) return { visible: tabCount, overflow: false };

  const fits = (count: number, withOverflow: boolean): boolean => {
    const trailingChrome = DOCK_TAB_GAP + DOCK_ADD_W + (withOverflow ? DOCK_TAB_GAP + DOCK_OVERFLOW_W : 0);
    return DOCK_STRIP_PAD + tabsWidth(count) + trailingChrome <= width;
  };

  if (fits(tabCount, false)) return { visible: tabCount, overflow: false };

  let visible = tabCount - 1;
  while (visible > 0 && !fits(visible, true)) visible -= 1;
  return { visible, overflow: true };
}
