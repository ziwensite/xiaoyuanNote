/**
 * Geometry for the dock tab strip in a column header (and the tablet drawer).
 *
 * Each dock column owns its header, so the strip fills the column's content
 * width. The column is a real flex item: when it gets narrower, the strip gets
 * narrower in the same frame and `dockStripLayout` decides how many tabs still
 * fit. Anything that does not fit moves into the `»` list — never a squeezed
 * icon, never an unreachable pane.
 *
 * All numbers are the fixed sizes from the tab component. They are exported so
 * the component's CSS and this fit math cannot drift apart — and so the rules
 * below are unit-testable without a DOM.
 */

/** `.dock-tab` width / height (mirrors `--ctl-size` in tokens.css). */
export const DOCK_TAB_SIZE = 24;
/** `.dock-strip` flex `gap` between tabs. */
export const DOCK_TAB_GAP = 2;
/** `.dock-strip` horizontal padding (4px each side). */
export const DOCK_STRIP_PAD = 8;
/** Width the trailing `+` button always reserves. */
export const DOCK_ADD_W = DOCK_TAB_SIZE;
/** Width of the `»` overflow trigger. */
export const DOCK_OVERFLOW_W = DOCK_TAB_SIZE;

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
