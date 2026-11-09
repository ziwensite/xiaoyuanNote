/**
 * Width allocation for the three-column shell.
 *
 * The shell is one row: [left dock] [editor] [right dock]. Each dock column
 * owns its header, so the only number that matters is the column width — this
 * module is the single place that turns the window width plus the two stored
 * dock widths into the three displayed widths.
 *
 * Rules (see `.trae/specs/three-column-shell/spec.md` §3):
 *  - The editor keeps `MIDDLE_MIN_WIDTH` whenever the window allows it.
 *  - Both docks visible: give each `SIDE_MIN_WIDTH` first, then split the
 *    remaining room proportionally to how far each stored width exceeds that
 *    minimum. Below 2×`SIDE_MIN_WIDTH` the floor drops to
 *    `SIDE_LAYOUT_FLOOR` (601px-class windows).
 *  - Displayed widths are clamped, never written back: growing the window
 *    restores the user's stored width.
 *  - `middle` is derived as `shell - left - right`, so the three columns always
 *    add up to the shell width exactly (no 1px gap from independent rounding).
 */

export const MIDDLE_MIN_WIDTH = 360;
export const SIDE_MIN_WIDTH = 212;
export const SIDE_LAYOUT_FLOOR = 120;

export interface ShellColumnInput {
  /** Measured width of the row that holds the three columns. */
  shellWidth: number;
  /** Stored/effective left width, or null when the left column is hidden. */
  left: number | null;
  right: number | null;
}

export interface ShellColumnWidths {
  left: number;
  right: number;
  middle: number;
}

function finiteWidth(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n > 0 ? n : null;
}

function shellWidthOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** Split `avail` between two sides, each at least `floor`, proportionally to
 *  how far their stored widths exceed the floor. */
function splitAtFloor(a: number, b: number, avail: number, floor: number): [number, number] {
  const budget = Math.max(0, avail - floor * 2);
  const aExcess = Math.max(0, a - floor);
  const bExcess = Math.max(0, b - floor);
  const totalExcess = aExcess + bExcess;
  if (totalExcess <= 0) {
    const aShare = Math.floor(budget / 2);
    return [floor + aShare, floor + budget - aShare];
  }
  const aShare = Math.max(
    0,
    Math.min(budget, Math.round((budget * aExcess) / totalExcess)),
  );
  return [floor + aShare, floor + budget - aShare];
}

export function shellColumnWidths(input: ShellColumnInput): ShellColumnWidths {
  const shell = shellWidthOf(input.shellWidth);
  const left = finiteWidth(input.left);
  const right = finiteWidth(input.right);

  if (left === null && right === null) {
    return { left: 0, right: 0, middle: shell };
  }

  // One dock only: it may grow into everything the editor does not need.
  if (left === null || right === null) {
    const natural = left ?? right!;
    const side = Math.min(natural, Math.max(0, shell - MIDDLE_MIN_WIDTH));
    return left === null
      ? { left: 0, right: side, middle: shell - side }
      : { left: side, right: 0, middle: shell - side };
  }

  const avail = Math.max(0, shell - MIDDLE_MIN_WIDTH);
  if (left + right <= avail) {
    return { left, right, middle: shell - left - right };
  }

  let l: number;
  let r: number;
  if (avail >= 2 * SIDE_MIN_WIDTH) {
    [l, r] = splitAtFloor(left, right, avail, SIDE_MIN_WIDTH);
  } else if (avail >= 2 * SIDE_LAYOUT_FLOOR) {
    [l, r] = splitAtFloor(left, right, avail, SIDE_LAYOUT_FLOOR);
  } else {
    const total = left + right;
    l = total > 0 ? Math.round((avail * left) / total) : 0;
    r = avail - l;
  }

  return { left: l, right: r, middle: shell - l - r };
}
