/**
 * Stage 1 shell rework — two sidebar docks, now without the 32px activity rail.
 *
 * Model: side → groups[] → tabs[]. Stage 1 always writes exactly ONE group per
 * side; the array exists so stage 2 (stacked regions, each with its own icon
 * strip) only adds UI + split actions — never another schema migration.
 *
 * Decisions that live here because the rest of the shell has to agree:
 *
 *  - Collapse is a real zero width: the rail used to be the way back in, so
 *    the reopen affordance moved to the header's two toggle icons (App.vue
 *    unmounts the dock when `collapsed[side]`), plus ⌘B / View menu / palette.
 *    One state (`collapsed`), one toggle action — no second source of truth.
 *  - `+` (the pane list) sits at the end of the icon strip. It replaced the
 *    dock-level right-click menu; there is exactly one entry point left.
 *  - `files` is shell chrome, not a user choice: it is pinned to
 *    `groups.left[0].panes[0]`, always visible, and never a drag source.
 *  - `visible` is a separate map now (a pane can be switched off without
 *    leaving its tab group). `outline` / `search` still answer from their own
 *    runtime source in App.vue.
 */

import {
  SIDEBAR_PANE_DEFS,
  type SidebarPaneDef,
  type SidebarPaneId,
} from '../panes/sidebar-panes';

export type SidebarSide = 'left' | 'right';

/** One stacked region of a side. Stage 1 ships exactly one; stage 2 adds more. */
export interface SidebarDockGroup {
  /** Tab order — `panes[0]` is drawn first (leftmost icon). */
  panes: SidebarPaneId[];
  /** Active tab of this region; null → first renderable pane. */
  active: SidebarPaneId | null;
}

export interface SidebarDockState {
  groups: Record<SidebarSide, SidebarDockGroup[]>;
  /**
   * Per-pane user switch. `visibility === 'always'` (files) is forced true;
   * tab/session panes are overridden at runtime by App.vue.
   */
  visible: Record<SidebarPaneId, boolean>;
  /** User-collapsed dock (distinct from "no renderable pane"). */
  collapsed: Record<SidebarSide, boolean>;
  /** Content width — the rail is gone, so this is the panel body's width. */
  width: Record<SidebarSide, number>;
}

/** Compatibility view of one pane: its side + its switch. */
export interface SidebarDockPaneState {
  id: SidebarPaneId;
  side: SidebarSide;
  visible: boolean;
}

/** Content width. The numbers are unchanged on purpose: 292 used to be
 *  "260 content + 32 rail", which is exactly what the body needs alone. */
export const DEFAULT_DOCK_WIDTH = 292;
/** 180 content + the old 32 rail — keeps the previous file-tree minimum. */
export const MIN_DOCK_WIDTH = 212;
export const MAX_DOCK_WIDTH = 560;
/** Width the removed activity rail contributed. Migration only — never used
 *  to size a live dock (the rail no longer exists). */
export const LEGACY_RAIL_WIDTH = 32;

/** V1 — the file tree container. It is the primary sidebar itself, so every
 *  move/sanitize path locks it to the left, first tab, always visible. */
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

/** `files` never travels: it is the shell's primary container. */
export function isMovablePane(id: SidebarPaneId): boolean {
  return id !== PRIMARY_PANE_ID && !isPendingPane(id);
}

export function clampDockWidth(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DOCK_WIDTH;
  return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, Math.round(n)));
}

function visibleDefaults(): Record<SidebarPaneId, boolean> {
  const out = {} as Record<SidebarPaneId, boolean>;
  for (const def of SIDEBAR_PANE_DEFS) out[def.id] = def.defaultVisible;
  return out;
}

/** D6 preset: files alone on the left; outline + agent (+ the rest, switched
 *  off) on the right. */
export function defaultSidebarDock(): SidebarDockState {
  const left: SidebarPaneId[] = [];
  const right: SidebarPaneId[] = [];
  for (const def of SIDEBAR_PANE_DEFS) {
    (def.defaultSide === PRIMARY_SIDE ? left : right).push(def.id);
  }
  return {
    groups: {
      left: [{ panes: left, active: PRIMARY_PANE_ID }],
      right: [{ panes: right, active: 'outline' }],
    },
    visible: visibleDefaults(),
    collapsed: { left: false, right: true },
    width: { left: DEFAULT_DOCK_WIDTH, right: DEFAULT_DOCK_WIDTH },
  };
}

function normalizeSide(value: unknown, fallback: SidebarSide): SidebarSide {
  return value === 'left' || value === 'right' ? value : fallback;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function knownId(value: unknown): SidebarPaneId | null {
  return typeof value === 'string' && DEF_BY_ID.has(value as SidebarPaneId)
    ? (value as SidebarPaneId)
    : null;
}

function cloneGroup(group: SidebarDockGroup): SidebarDockGroup {
  return { panes: [...group.panes], active: group.active };
}

function cloneDock(state: SidebarDockState): SidebarDockState {
  return {
    groups: {
      left: state.groups.left.map(cloneGroup),
      right: state.groups.right.map(cloneGroup),
    },
    visible: { ...state.visible },
    collapsed: { ...state.collapsed },
    width: { ...state.width },
  };
}

interface ParsedDock {
  groups: Record<SidebarSide, SidebarDockGroup[]>;
  visible: Partial<Record<SidebarPaneId, boolean>>;
  collapsed: Record<SidebarSide, unknown>;
  width: Record<SidebarSide, unknown>;
}

/**
 * Shape sniffing only: accepts the current `groups` shape AND every persisted
 * shape before it (stage-1 flat `panes[]`, one `active` per side). Unknown
 * values are left for `sanitizeSidebarDock` to repair, so this stays a pure
 * "read" pass. Returns null when the blob is not a dock at all.
 */
function parseStored(raw: unknown): ParsedDock | null {
  if (!isObj(raw)) return null;
  const groups: Record<SidebarSide, SidebarDockGroup[]> = { left: [], right: [] };
  const visible: Partial<Record<SidebarPaneId, boolean>> = {};
  const activeBySide: Partial<Record<SidebarSide, SidebarPaneId>> = {};

  if (isObj(raw.groups)) {
    const source = raw.groups;
    for (const side of SIDES) {
      const list = Array.isArray(source[side]) ? source[side] : [];
      for (const entry of list) {
        if (!isObj(entry)) continue;
        const panes: SidebarPaneId[] = [];
        if (Array.isArray(entry.panes)) {
          for (const value of entry.panes) {
            const id = knownId(value);
            if (id) panes.push(id);
          }
        }
        const active = knownId(entry.active);
        groups[side].push({ panes, active: active && panes.includes(active) ? active : null });
      }
      if (groups[side].length === 0) groups[side].push({ panes: [], active: null });
    }
    if (isObj(raw.visible)) {
      for (const key of Object.keys(raw.visible)) {
        const id = knownId(key);
        const value = raw.visible[key];
        if (id && typeof value === 'boolean') visible[id] = value;
      }
    }
  } else if (Array.isArray(raw.panes)) {
    // Pre-stage-1 flat model: one list, one active per side.
    groups.left.push({ panes: [], active: null });
    groups.right.push({ panes: [], active: null });
    const seen = new Set<SidebarPaneId>();
    for (const entry of raw.panes) {
      if (!isObj(entry)) continue;
      const id = knownId(entry.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const side = normalizeSide(entry.side, DEF_BY_ID.get(id)!.defaultSide);
      groups[side][0].panes.push(id);
      if (typeof entry.visible === 'boolean') visible[id] = entry.visible;
    }
    if (isObj(raw.active)) {
      for (const side of SIDES) {
        const id = knownId(raw.active[side]);
        if (id) activeBySide[side] = id;
      }
    }
  } else {
    return null;
  }

  for (const side of SIDES) {
    const active = activeBySide[side];
    if (active) groups[side][0].active = active;
  }

  const collapsed = isObj(raw.collapsed) ? raw.collapsed : {};
  const width = isObj(raw.width) ? raw.width : {};
  return {
    groups,
    visible,
    collapsed: { left: collapsed.left, right: collapsed.right },
    width: { left: width.left, right: width.right },
  };
}

/**
 * Idempotent repair: drop unknown / duplicate ids, append missing panes at
 * their registry default side, pin `files`, validate each group's active tab
 * and clamp widths. Safe to call on already-valid state.
 */
export function sanitizeSidebarDock(
  raw: unknown,
  fallback: SidebarDockState = defaultSidebarDock(),
): SidebarDockState {
  const parsed = parseStored(raw);
  if (!parsed) return cloneDock(fallback);

  // One pass over both sides, in order: unknown ids and duplicates out.
  const seen = new Set<SidebarPaneId>();
  const groups: Record<SidebarSide, SidebarDockGroup[]> = { left: [], right: [] };
  for (const side of SIDES) {
    for (const source of parsed.groups[side]) {
      const panes: SidebarPaneId[] = [];
      for (const id of source.panes) {
        if (seen.has(id) || !DEF_BY_ID.has(id)) continue;
        seen.add(id);
        panes.push(id);
      }
      groups[side].push({ panes, active: source.active });
    }
    if (groups[side].length === 0) groups[side].push({ panes: [], active: null });
  }

  // Scroll-upgrade tolerance: a pane added in a later build gets its default.
  for (const def of SIDEBAR_PANE_DEFS) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    groups[def.defaultSide][0].panes.push(def.id);
  }

  // The primary container is shell chrome: it cannot live on the right, sit
  // second, or be hidden — even if the stored blob says otherwise.
  const primaryGroup = groups[PRIMARY_SIDE][0];
  const filesWasActive = primaryGroup.active === PRIMARY_PANE_ID;
  for (const side of SIDES) {
    for (const group of groups[side]) {
      group.panes = group.panes.filter((id) => id !== PRIMARY_PANE_ID);
      if (group.active === PRIMARY_PANE_ID) group.active = null;
    }
  }
  primaryGroup.panes.unshift(PRIMARY_PANE_ID);
  // Reinstating `files` must not silently un-select it if it was the tab.
  if (filesWasActive) primaryGroup.active = PRIMARY_PANE_ID;

  for (const side of SIDES) {
    for (const group of groups[side]) {
      if (group.active && !group.panes.includes(group.active)) group.active = null;
      if (group.active && isPendingPane(group.active)) group.active = null;
    }
  }

  const visible = visibleDefaults();
  for (const [key, value] of Object.entries(parsed.visible)) {
    if (typeof value === 'boolean') visible[key as SidebarPaneId] = value;
  }
  visible[PRIMARY_PANE_ID] = true;

  return {
    groups,
    visible,
    collapsed: {
      left:
        typeof parsed.collapsed.left === 'boolean' ? parsed.collapsed.left : fallback.collapsed.left,
      right:
        typeof parsed.collapsed.right === 'boolean' ? parsed.collapsed.right : fallback.collapsed.right,
    },
    width: {
      left: clampDockWidth(parsed.width.left ?? fallback.width.left),
      right: clampDockWidth(parsed.width.right ?? fallback.width.right),
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
 * One-time migration, shape-based so a marker can never lose data:
 *  1. stored dock blob (current `groups` or the old flat `panes[]`) →
 *     sanitize/upgrade (never re-read the frozen legacy switches);
 *  2. marker without data → defaults (that is what "frozen" means after S2);
 *  3. otherwise the whole legacy stack lands on its old `outlineSide`, the
 *     other side stays empty — then gets repaired into one group per side;
 *  4. no persisted blob at all → the D6 new-install preset.
 *
 * `v512DockGroupsMigrated` (written by settings.load) is bookkeeping only:
 * correctness comes from the shape, so a downgrade/upgrade cycle is lossless.
 */
export function migrateSidebarDock(
  legacy: LegacySidebarBlob,
  fallback: SidebarDockState = defaultSidebarDock(),
): SidebarDockState {
  if (legacy && typeof legacy === 'object' && legacy.sidebarDock) {
    return sanitizeSidebarDock(legacy.sidebarDock, fallback);
  }
  // Marker without data: treat the dock state as lost, don't resurrect it from
  // the frozen legacy switches.
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

  const panes = ordered.map((id) => {
    const def = DEF_BY_ID.get(id)!;
    return {
      id,
      // V1 — the primary container never travelled with the legacy stack.
      side: id === PRIMARY_PANE_ID ? PRIMARY_SIDE : legacySide,
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
  const legacyWidth = Number(legacy.sideSidebarWidth);

  // Feed the pre-stage-1 shape through the same sanitizer so the upgrade path
  // is one code path, not two.
  return sanitizeSidebarDock(
    {
      panes,
      active: { [legacySide]: firstVisible?.id ?? 'outline' },
      collapsed: {
        left: legacySide === 'right' ? true : legacy.rightSidebarHidden === true,
        right: legacySide === 'right' ? legacy.rightSidebarHidden === true : true,
      },
      width: {
        [legacySide]: Number.isFinite(legacyWidth)
          ? clampDockWidth(legacyWidth + LEGACY_RAIL_WIDTH)
          : DEFAULT_DOCK_WIDTH,
      },
    },
    fallback,
  );
}

/** Panes assigned to one side, flattened across its groups, in tab order.
 *  Pending panes are included so callers can decide; UI lists filter them. */
export function sideDockPanes(
  state: SidebarDockState,
  side: SidebarSide,
): SidebarDockPaneState[] {
  return state.groups[side].flatMap((group) =>
    group.panes.map((id) => ({ id, side, visible: isDockPaneVisible(state, id) })),
  );
}

/** Where a pane currently lives. */
export interface DockPaneLocation {
  side: SidebarSide;
  group: number;
  index: number;
}

export function paneGroup(state: SidebarDockState, id: SidebarPaneId): DockPaneLocation | null {
  for (const side of SIDES) {
    const groups = state.groups[side];
    for (let group = 0; group < groups.length; group += 1) {
      const index = groups[group].panes.indexOf(id);
      if (index >= 0) return { side, group, index };
    }
  }
  return null;
}

export function dockPane(
  state: SidebarDockState,
  id: SidebarPaneId,
): SidebarDockPaneState | undefined {
  const location = paneGroup(state, id);
  if (!location) return undefined;
  return { id, side: location.side, visible: isDockPaneVisible(state, id) };
}

export function isDockPaneVisible(state: SidebarDockState, id: SidebarPaneId): boolean {
  return state.visible[id] === true;
}

/** Runtime active resolution: keep the stored choice when it can render,
 *  otherwise the first renderable pane (never a pending one). */
export function resolveGroupActive(
  group: SidebarDockGroup,
  renderable: readonly SidebarPaneId[],
): SidebarPaneId | null {
  const stored = group.active;
  if (stored && renderable.includes(stored) && !isPendingPane(stored)) return stored;
  return renderable[0] ?? null;
}

/** Next activation after hiding `id`: scan forward then backward in its group. */
export function nextActiveAfterHide(
  state: SidebarDockState,
  id: SidebarPaneId,
): SidebarPaneId | null {
  const location = paneGroup(state, id);
  if (!location) return null;
  const group = state.groups[location.side][location.group];
  const isCandidate = (candidate: SidebarPaneId) =>
    candidate !== id && isDockPaneVisible(state, candidate) && !isPendingPane(candidate);
  for (let i = location.index + 1; i < group.panes.length; i += 1) {
    if (isCandidate(group.panes[i])) return group.panes[i];
  }
  for (let i = location.index - 1; i >= 0; i -= 1) {
    if (isCandidate(group.panes[i])) return group.panes[i];
  }
  return null;
}

/** Pick a sensible active tab for a freshly built group. */
function pickActive(preferred: SidebarPaneId | null, panes: readonly SidebarPaneId[]): SidebarPaneId | null {
  if (preferred && panes.includes(preferred)) return preferred;
  if (panes.includes('outline')) return 'outline';
  return panes[0] ?? null;
}

/** Move every *movable* pane to `side`, preserving order. `files` stays on the
 *  left; when everything else lands on the right, the left stays active on it
 *  instead of going blank. */
export function moveAllPanesToSide(
  state: SidebarDockState,
  side: SidebarSide,
): SidebarDockState {
  const all = SIDES.flatMap((s) => state.groups[s].flatMap((group) => group.panes));
  const others = all.filter((id) => id !== PRIMARY_PANE_ID);
  const previousActive = state.groups[side]
    .map((group) => group.active)
    .find((id): id is SidebarPaneId => !!id) ?? null;
  return {
    groups: {
      left: [{ panes: side === 'left' ? [PRIMARY_PANE_ID, ...others] : [PRIMARY_PANE_ID], active: PRIMARY_PANE_ID }],
      right: [{ panes: side === 'right' ? others : [], active: side === 'right' ? pickActive(previousActive, others) : null }],
    },
    visible: { ...state.visible },
    collapsed: { ...state.collapsed },
    width: { ...state.width },
  };
}

/** Target of a drag. `index` is an insertion point in the pre-removal array:
 *  `0…n` before that pane, `n` = append. */
export interface DockTabTarget {
  side: SidebarSide;
  /** Defaults to 0 (stage 1 has exactly one region per side). */
  group?: number;
  index?: number;
}

/**
 * Pure reorder / cross-side move used by the pointer drag (and by
 * `movePaneToSide`). `files` is not movable; a drop before it on the left is
 * clamped to just after it.
 */
export function moveDockTab(
  state: SidebarDockState,
  id: SidebarPaneId,
  target: DockTabTarget,
): SidebarDockState {
  if (!isMovablePane(id)) return state;
  const from = paneGroup(state, id);
  if (!from) return state;

  const next = cloneDock(state);
  const sourceGroups = next.groups[from.side];
  const source = sourceGroups[from.group];
  if (!source) return state;
  source.panes.splice(from.index, 1);
  if (source.active === id) source.active = null;
  const removedGroup = source.panes.length === 0 && sourceGroups.length > 1;
  if (removedGroup) sourceGroups.splice(from.group, 1);

  const destinationGroups = next.groups[target.side];
  let groupIndex = target.group ?? 0;
  if (removedGroup && target.side === from.side && groupIndex > from.group) groupIndex -= 1;
  groupIndex = Math.min(Math.max(groupIndex, 0), destinationGroups.length - 1);
  const destination = destinationGroups[groupIndex];

  let index = target.index ?? destination.panes.length;
  // The drop index was measured in the array that still contained the dragged
  // tab; after removing it, everything to its right shifted left by one.
  if (target.side === from.side && groupIndex === from.group && from.index < index) index -= 1;
  index = Math.min(Math.max(index, 0), destination.panes.length);
  if (target.side === PRIMARY_SIDE) {
    const filesIndex = destination.panes.indexOf(PRIMARY_PANE_ID);
    if (filesIndex >= 0) index = Math.max(index, filesIndex + 1);
  }
  destination.panes.splice(index, 0, id);
  destination.active = id;
  return next;
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

  const leftIds = dock.groups.left.flatMap((group) => group.panes);
  const movedToSecondary = leftIds.filter((id) => id !== PRIMARY_PANE_ID);
  const others = SIDES.flatMap((s) => dock.groups[s].flatMap((group) => group.panes)).filter(
    (id) => id !== PRIMARY_PANE_ID,
  );
  const previousRight = dock.groups.right
    .map((group) => group.active)
    .find((id): id is SidebarPaneId => !!id) ?? null;

  return {
    dock: {
      groups: {
        left: [{ panes: [PRIMARY_PANE_ID], active: PRIMARY_PANE_ID }],
        right: [{ panes: others, active: pickActive(previousRight, others) }],
      },
      visible: { ...dock.visible },
      collapsed: { left: !opts.showFileTree, right: dock.collapsed.right },
      width: {
        left: clampDockWidth(opts.fileTreeWidth + LEGACY_RAIL_WIDTH),
        right: dock.width.right,
      },
    },
    movedToSecondary,
  };
}
