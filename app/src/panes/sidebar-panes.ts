/**
 * S1 — single source of truth for right-sidebar panes.
 *
 * Pure metadata: no Vue imports, no store access, no behaviour. `App.vue`
 * derives the pane *order* from `IMPLEMENTED_SIDEBAR_PANE_IDS` (exactly the
 * list the old `known` literal held), and `SidebarPaneBody` maps ids to
 * components. Visibility still comes from the existing stores, so this table
 * is read-only in S1 — S2 will start writing `sidebarDock` state from it.
 *
 * `defaultSide` / `defaultVisible` / `defaultActive` describe the *new-install*
 * preset only; they must not affect an existing install until S2 ships the
 * migration. `calendar` is reserved ahead of the calendar pane itself: it
 * carries `pending` so it stays out of `IMPLEMENTED_SIDEBAR_PANE_IDS` and has
 * no component, no entry point and no effect on `settings.rsPaneOrder`.
 *
 * `titleKey` / `icon` intentionally absent: S1 renders neither an activity
 * bar nor a tab header, and adding them would require new i18n copy.
 */

export type SidebarPaneId =
  | 'search'
  | 'outline'
  | 'backlinks'
  | 'relationships'
  | 'tags'
  | 'tasks'
  | 'neighborhood'
  | 'types'
  | 'history'
  | 'inspector'
  | 'agent'
  | 'calendar';

/** Panes that exist today (everything except the reserved calendar pane). */
export type ImplementedSidebarPaneId = Exclude<SidebarPaneId, 'calendar'>;

/** Where a pane's current visibility derives from. */
export type SidebarPaneVisibility = 'setting' | 'tab' | 'session';

export interface SidebarPaneDef {
  id: SidebarPaneId;
  visibility: SidebarPaneVisibility;
  defaultSide: 'left' | 'right';
  defaultVisible: boolean;
  /** D6: the pane a fresh install activates by default. */
  defaultActive?: boolean;
  /** Not implemented yet — no component, no entry point. */
  pending?: boolean;
}

/**
 * Array order is load-bearing: it is the fallback order `visibleRsPanes`
 * appends unknown ids in, and must stay identical to the pre-S1 `known` list.
 */
export const SIDEBAR_PANE_DEFS: readonly SidebarPaneDef[] = [
  { id: 'search', visibility: 'session', defaultSide: 'right', defaultVisible: false },
  { id: 'outline', visibility: 'tab', defaultSide: 'left', defaultVisible: true },
  { id: 'backlinks', visibility: 'setting', defaultSide: 'right', defaultVisible: true },
  { id: 'relationships', visibility: 'setting', defaultSide: 'right', defaultVisible: false },
  { id: 'tags', visibility: 'setting', defaultSide: 'right', defaultVisible: true },
  { id: 'tasks', visibility: 'setting', defaultSide: 'right', defaultVisible: false },
  { id: 'neighborhood', visibility: 'setting', defaultSide: 'right', defaultVisible: false },
  { id: 'types', visibility: 'setting', defaultSide: 'right', defaultVisible: false },
  { id: 'history', visibility: 'setting', defaultSide: 'right', defaultVisible: true },
  { id: 'inspector', visibility: 'setting', defaultSide: 'right', defaultVisible: false },
  { id: 'agent', visibility: 'setting', defaultSide: 'right', defaultVisible: true },
  // D6 preset: right side = calendar (active) + agent. Reserved only.
  {
    id: 'calendar',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: true,
    defaultActive: true,
    pending: true,
  },
];

/** Ids with a renderable component today. Drives `visibleRsPanes`. */
export const IMPLEMENTED_SIDEBAR_PANE_IDS: readonly ImplementedSidebarPaneId[] =
  SIDEBAR_PANE_DEFS.filter((d) => !d.pending).map((d) => d.id as ImplementedSidebarPaneId);
