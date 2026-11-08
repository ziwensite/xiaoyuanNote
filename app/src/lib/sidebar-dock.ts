/**
 * S2 — state + migration for the two sidebar docks.
 *
 * Pure functions only: no Vue, no stores, no components. `settings.ts` calls
 * `migrateSidebarDock` from `load()`; `SidebarDock.vue` reads the shape
 * directly. Array order in `panes` is the per-side tab order, so S3's drag
 * reorder only has to move entries around instead of changing the schema.
 */

import {
  SIDEBAR_PANE_DEFS,
  type SidebarPaneDef,
  type SidebarPaneId,
} from '../panes/sidebar-panes';

export type SidebarSide = 'left' | 'right';

export interface SidebarDockPaneState {
  id: SidebarPaneId;
  side: SidebarSide;
  /** Only meaningful for `visibility === 'setting'` panes. */
  visible: boolean;
}

export interface SidebarDockState {
  /** Array order = tab order. Same-side entries are contiguous when created. */
  panes: SidebarDockPaneState[];
  active: Record<SidebarSide, SidebarPaneId | null>;
  /** User-collapsed dock (distinct from "no renderable pane"). */
  collapsed: Record<SidebarSide, boolean>;
  /** Total dock width including the rail. */
  width: Record<SidebarSide, number>;
}

export const SIDEBAR_RAIL_WIDTH = 32;
/** 260 content + 32 rail — keeps the old content width on migration. */
export const DEFAULT_DOCK_WIDTH = 292;
/** 180 content + 32 rail — keeps the old file-tree minimum. */
export const MIN_DOCK_WIDTH = 212;
export const MAX_DOCK_WIDTH = 560;

/** V1 — the file tree container. It is the primary sidebar itself, so every
 *  move/sanitize path locks it to the left. */
export const PRIMARY_PANE_ID: SidebarPaneId = 'files';
export const PRIMARY_SIDE: SidebarSide = 'left';

export const SIDES: readonly SidebarSide[] = ['left', 'right'];

const DEF_BY_ID = new Map<SidebarPaneId, SidebarPaneDef>(
  SIDEBAR_PANE_DEFS.map((def) => [def.id, def]),
);

export function paneDef(id: SidebarPaneId): SidebarPaneDef | undefined {
  return DEF_BY_ID.get(id);
}

export function isPendingPane(id: SidebarPaneId): boolean {
  return !!DEF_BY_ID.get(id)?.pending;
}

export function clampDockWidth(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DOCK_WIDTH;
  return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, Math.round(n)));
}

/** D6 preset: outline on the left; calendar (reserved) + agent on the right. */
export function defaultSidebarDock(): SidebarDockState {
  const panes: SidebarDockPaneState[] = SIDEBAR_PANE_DEFS.map((def) => ({
    id: def.id,
    side: def.defaultSide,
    visible: def.defaultVisible,
  }));
  return {
    panes,
    active: { left: 'files', right: 'outline' },
    collapsed: { left: false, right: true },
    width: { left: DEFAULT_DOCK_WIDTH, right: DEFAULT_DOCK_WIDTH },
  };
}

function normalizeSide(value: unknown, fallback: SidebarSide): SidebarSide {
  return value === 'left' || value === 'right' ? value : fallback;
}

function cloneDock(state: SidebarDockState): SidebarDockState {
  return {
    panes: state.panes.map((pane) => ({ ...pane })),
    active: { ...state.active },
    collapsed: { ...state.collapsed },
    width: { ...state.width },
  };
}

/** Idempotent repair: drop unknown/duplicate ids, append missing ones, clamp. */
export function sanitizeSidebarDock(
  raw: unknown,
  fallback: SidebarDockState = defaultSidebarDock(),
): SidebarDockState {
  if (!raw || typeof raw !== 'object') return cloneDock(fallback);
  const src = raw as Partial<SidebarDockState>;
  if (!Array.isArray(src.panes) || src.panes.length === 0) return cloneDock(fallback);

  const panes: SidebarDockPaneState[] = [];
  const seen = new Set<SidebarPaneId>();
  for (const entry of src.panes) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as SidebarDockPaneState).id;
    const def = id ? DEF_BY_ID.get(id as SidebarPaneId) : undefined;
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    panes.push({
      id: def.id,
      side: normalizeSide((entry as SidebarDockPaneState).side, def.defaultSide),
      visible:
        typeof (entry as SidebarDockPaneState).visible === 'boolean'
          ? (entry as SidebarDockPaneState).visible
          : def.defaultVisible,
    });
  }
  // Scroll-upgrade tolerance: a pane added in a later build gets its default.
  for (const def of SIDEBAR_PANE_DEFS) {
    if (seen.has(def.id)) continue;
    panes.push({ id: def.id, side: def.defaultSide, visible: def.defaultVisible });
  }
  // The primary container is part of the shell, not a user choice: even a
  // hand-edited blob cannot move it to the secondary sidebar or hide it.
  const files = panes.find((pane) => pane.id === PRIMARY_PANE_ID);
  if (files) {
    files.side = PRIMARY_SIDE;
    files.visible = true;
  }

  const activeRaw = (src.active ?? {}) as Partial<Record<SidebarSide, unknown>>;
  const collapsedRaw = (src.collapsed ?? {}) as Partial<Record<SidebarSide, unknown>>;
  const widthRaw = (src.width ?? {}) as Partial<Record<SidebarSide, unknown>>;
  const active: Record<SidebarSide, SidebarPaneId | null> = { left: null, right: null };
  for (const side of SIDES) {
    const value = activeRaw[side];
    if (typeof value === 'string' && DEF_BY_ID.has(value as SidebarPaneId)) {
      const pane = panes.find((p) => p.id === value);
      active[side] = pane && pane.side === side ? (value as SidebarPaneId) : null;
    }
  }

  return {
    panes,
    active,
    collapsed: {
      left: typeof collapsedRaw.left === 'boolean' ? collapsedRaw.left : true,
      right: typeof collapsedRaw.right === 'boolean' ? collapsedRaw.right : true,
    },
    width: {
      left: clampDockWidth(widthRaw.left),
      right: clampDockWidth(widthRaw.right),
    },
  };
}

/** The pre-S2 blob shape we need. Structural so this module stays store-free. */
export type LegacySidebarBlob = {
  outlineSide?: unknown;
  rsPaneOrder?: unknown;
  rightSidebarHidden?: unknown;
  sideSidebarWidth?: unknown;
  v510SidebarDockMigrated?: unknown;
  sidebarDock?: unknown;
  [key: string]: unknown;
} | null | undefined;

/**
 * One-time migration:
 *  1. already migrated / has dock state → sanitize (never re-read legacy);
 *  2. otherwise the whole legacy stack lands on its old `outlineSide`, the
 *     other side stays empty;
 *  3. no persisted blob at all → the D6 new-install preset.
 */
export function migrateSidebarDock(
  legacy: LegacySidebarBlob,
  fallback: SidebarDockState = defaultSidebarDock(),
): SidebarDockState {
  if (legacy && typeof legacy === 'object' && legacy.sidebarDock) {
    return sanitizeSidebarDock(legacy.sidebarDock, fallback);
  }
  // Marker without data: treat the dock state as lost, don't resurrect it from
  // the frozen legacy switches (that is what "frozen" means after S2).
  if (legacy && legacy.v510SidebarDockMigrated === true) return cloneDock(fallback);
  if (!legacy || typeof legacy !== 'object' || Object.keys(legacy).length === 0) {
    return cloneDock(fallback);
  }

  const legacySide = normalizeSide(legacy.outlineSide, 'right');
  const known = new Set(SIDEBAR_PANE_DEFS.map((def) => def.id));
  const ordered: SidebarPaneId[] = [];
  if (Array.isArray(legacy.rsPaneOrder)) {
    for (const raw of legacy.rsPaneOrder) {
      if (typeof raw !== 'string') continue;
      const id = raw as SidebarPaneId;
      if (known.has(id) && !ordered.includes(id)) ordered.push(id);
    }
  }
  for (const def of SIDEBAR_PANE_DEFS) {
    if (!ordered.includes(def.id)) ordered.push(def.id);
  }

  const panes: SidebarDockPaneState[] = ordered.map((id) => {
    const def = DEF_BY_ID.get(id)!;
    return {
      id,
      side: legacySide,
      visible:
        def.visibility === 'setting'
          ? !!legacy[def.settingKey as string]
          : def.visibility === 'tab' || def.visibility === 'always'
            ? true
            : false,
    };
  });

  const firstVisible = panes.find(
    (pane) => pane.visible && DEF_BY_ID.get(pane.id)?.visibility === 'setting',
  );
  // V1 — the primary container is never part of the legacy stack: it stays
  // on the left even when every other pane lands on `legacySide`.
  const files = panes.find((pane) => pane.id === PRIMARY_PANE_ID);
  if (files) {
    files.side = PRIMARY_SIDE;
    files.visible = true;
  }
  const active: Record<SidebarSide, SidebarPaneId | null> = { left: null, right: null };
  active[legacySide] = firstVisible?.id ?? 'outline';

  const legacyWidth = Number(legacy.sideSidebarWidth);
  const width: Record<SidebarSide, number> = { left: DEFAULT_DOCK_WIDTH, right: DEFAULT_DOCK_WIDTH };
  width[legacySide] = clampDockWidth(
    Number.isFinite(legacyWidth) ? legacyWidth + SIDEBAR_RAIL_WIDTH : DEFAULT_DOCK_WIDTH,
  );

  return {
    panes,
    active,
    collapsed: {
      left: legacySide === 'right' ? true : legacy.rightSidebarHidden === true,
      right: legacySide === 'right' ? legacy.rightSidebarHidden === true : true,
    },
    width,
  };
}

/** Panes assigned to one side, in tab order. Pending panes are included so
 *  callers can decide; UI lists should filter them out. */
export function sideDockPanes(
  state: SidebarDockState,
  side: SidebarSide,
): SidebarDockPaneState[] {
  return state.panes.filter((pane) => pane.side === side);
}

export function dockPane(state: SidebarDockState, id: SidebarPaneId): SidebarDockPaneState | undefined {
  return state.panes.find((pane) => pane.id === id);
}

/** True when the user has this pane switched on. Tab/session panes answer from
 *  their own runtime source and should not use this helper. */
export function isDockPaneVisible(state: SidebarDockState, id: SidebarPaneId): boolean {
  return dockPane(state, id)?.visible ?? false;
}

/** Runtime active resolution: keep the stored choice when it can render,
 *  otherwise the first renderable pane (never a pending one). */
export function resolveActive(
  state: SidebarDockState,
  side: SidebarSide,
  renderable: readonly SidebarPaneId[],
): SidebarPaneId | null {
  const stored = state.active[side];
  if (stored && renderable.includes(stored) && !isPendingPane(stored)) return stored;
  return renderable[0] ?? null;
}

/** Next activation after hiding `id`: scan forward then backward on its side. */
export function nextActiveAfterHide(
  state: SidebarDockState,
  id: SidebarPaneId,
): SidebarPaneId | null {
  const index = state.panes.findIndex((pane) => pane.id === id);
  if (index < 0) return null;
  const side = state.panes[index].side;
  const isCandidate = (pane: SidebarDockPaneState | undefined, self: SidebarPaneId) =>
    !!pane && pane.id !== self && pane.side === side && pane.visible && !isPendingPane(pane.id);
  for (let i = index + 1; i < state.panes.length; i += 1) {
    if (isCandidate(state.panes[i], id)) return state.panes[i].id;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isCandidate(state.panes[i], id)) return state.panes[i].id;
  }
  return null;
}

/** Move every *movable* pane to `side`, preserving order. The primary
 *  container (`files`) is locked to the left; when everything else lands on
 *  the right, the left stays active on it instead of going blank. */
export function moveAllPanesToSide(
  state: SidebarDockState,
  side: SidebarSide,
): SidebarDockState {
  const panes = state.panes.map((pane) => ({
    ...pane,
    side: pane.id === PRIMARY_PANE_ID ? PRIMARY_SIDE : side,
  }));
  const active: Record<SidebarSide, SidebarPaneId | null> = { left: null, right: null };
  if (side === 'left') {
    active.left = state.active.left ?? state.active.right ?? PRIMARY_PANE_ID;
  } else {
    active.left = PRIMARY_PANE_ID;
    active.right = state.active.right ?? state.active.left ?? null;
    if (active.right === PRIMARY_PANE_ID) active.right = null;
  }
  return {
    panes,
    active,
    collapsed: { left: state.collapsed.left, right: state.collapsed.right },
    width: { left: state.width.left, right: state.width.right },
  };
}

/**
 * V1 — one-time merge of the old standalone file-tree column into the left
 * dock. Pure and idempotent: `alreadyMerged` skips the width/move work and
 * only normalizes the stored state.
 */
export function mergeFilesPane(
  state: SidebarDockState,
  opts: { showFileTree: boolean; fileTreeWidth: number; alreadyMerged: boolean },
): { dock: SidebarDockState; movedToSecondary: SidebarPaneId[] } {
  const dock = sanitizeSidebarDock(state);
  if (opts.alreadyMerged) return { dock, movedToSecondary: [] };

  const panes = dock.panes.map((pane) => ({ ...pane }));
  let files = panes.find((pane) => pane.id === PRIMARY_PANE_ID);
  if (!files) {
    files = { id: PRIMARY_PANE_ID, side: PRIMARY_SIDE, visible: true };
    panes.unshift(files);
  }
  files.side = PRIMARY_SIDE;
  files.visible = true;

  const movedToSecondary: SidebarPaneId[] = [];
  for (const pane of panes) {
    if (pane.id === PRIMARY_PANE_ID || pane.side !== PRIMARY_SIDE) continue;
    pane.side = 'right';
    movedToSecondary.push(pane.id);
  }

  const rightIds = panes
    .filter((pane) => pane.side === 'right' && !isPendingPane(pane.id))
    .map((pane) => pane.id);
  let right = dock.active.right;
  if (!right || right === PRIMARY_PANE_ID || !rightIds.includes(right)) {
    right = rightIds.includes('outline')
      ? 'outline'
      : movedToSecondary.includes('outline')
        ? 'outline'
        : movedToSecondary[0] ?? rightIds[0] ?? null;
  }

  return {
    dock: {
      panes,
      active: { left: PRIMARY_PANE_ID, right },
      collapsed: { left: !opts.showFileTree, right: dock.collapsed.right },
      width: {
        left: clampDockWidth(opts.fileTreeWidth + SIDEBAR_RAIL_WIDTH),
        right: dock.width.right,
      },
    },
    movedToSecondary,
  };
}
