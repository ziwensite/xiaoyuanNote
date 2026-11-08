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
 * S2 adds the presentation metadata the activity bar / tab header needs
 * (`icon`, `titleKey`) plus `available(ctx)` — the context gate that used to
 * live inline in `App.vue`. The gate is a pure function of the document type,
 * workspace and build flavor; the user-facing on/off switch is separate so a
 * pane can stay "on" while unavailable without showing an empty body.
 */

export type SidebarPaneId =
  | 'files'
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

/** Where a pane's current visibility derives from. `always` is a container
 *  that is part of the shell itself (the primary sidebar's file tree) and can
 *  never be switched off. */
export type SidebarPaneVisibility = 'setting' | 'tab' | 'session' | 'always';

/** Context the availability gate reads. Kept structural so this module stays
 *  store-free; `App.vue` builds it from its existing computeds. */
export interface SidebarPaneAvailabilityCtx {
  hasMarkdownTab: boolean;
  hasFolder: boolean;
  autoGitEnabled: boolean;
  appStoreBuild: boolean;
}

export interface SidebarPaneDef {
  id: SidebarPaneId;
  visibility: SidebarPaneVisibility;
  defaultSide: 'left' | 'right';
  defaultVisible: boolean;
  /** D6: the pane a fresh install activates by default. */
  defaultActive?: boolean;
  /** Not implemented yet — no component, no entry point. */
  pending?: boolean;
  /** Existing `Icons.vue` name — S2 must not add new icons. */
  icon: string;
  /** i18n key for the activity-bar tooltip and the tab label. */
  titleKey: string;
  /** `settings` key the old blob stored this pane's on/off in (migration). */
  settingKey?: string;
  /** `MenuContext.panes` key, when this pane has a View › Panels entry. */
  menuKey?: string;
  /** Context gate — pure. */
  available: (ctx: SidebarPaneAvailabilityCtx) => boolean;
}

const markdownInFolder = (ctx: SidebarPaneAvailabilityCtx) =>
  ctx.hasMarkdownTab && ctx.hasFolder;

/**
 * Array order drives the fallback append order in `sanitizeSidebarDock`. The
 * first entry is the primary sidebar container; the rest keep the pre-S1
 * order so old `rsPaneOrder` blobs migrate predictably.
 */
export const SIDEBAR_PANE_DEFS: readonly SidebarPaneDef[] = [
  // V1 — the primary sidebar container. Not a toggleable panel: locked to the
  // left dock, always on, and deliberately absent from View › Panels / the
  // dock's `+` list.
  {
    id: 'files',
    visibility: 'always',
    defaultSide: 'left',
    defaultVisible: true,
    icon: 'folder',
    titleKey: 'rsPane.files',
    available: () => true,
  },
  {
    id: 'search',
    visibility: 'session',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'search',
    titleKey: 'rsPane.search',
    available: () => true,
  },
  {
    id: 'outline',
    visibility: 'tab',
    defaultSide: 'right',
    defaultVisible: true,
    icon: 'outline',
    titleKey: 'rsPane.outline',
    available: (ctx) => ctx.hasMarkdownTab,
  },
  {
    id: 'backlinks',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'link',
    titleKey: 'rsPane.backlinks',
    settingKey: 'showBacklinks',
    menuKey: 'backlinks',
    available: markdownInFolder,
  },
  {
    id: 'relationships',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'share',
    titleKey: 'rsPane.relationships',
    settingKey: 'showRelationships',
    menuKey: 'relationships',
    available: markdownInFolder,
  },
  {
    id: 'tags',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'tag',
    titleKey: 'rsPane.tags',
    settingKey: 'showTagsPanel',
    menuKey: 'tags',
    available: (ctx) => ctx.hasFolder,
  },
  {
    id: 'tasks',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'task',
    titleKey: 'rsPane.tasks',
    settingKey: 'showTasksPanel',
    menuKey: 'tasks',
    available: (ctx) => ctx.hasFolder,
  },
  {
    id: 'neighborhood',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'globe',
    titleKey: 'rsPane.neighborhood',
    settingKey: 'showNeighborhood',
    menuKey: 'neighborhood',
    available: markdownInFolder,
  },
  {
    id: 'types',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'type',
    titleKey: 'rsPane.types',
    settingKey: 'showTypesPanel',
    menuKey: 'types',
    available: (ctx) => ctx.hasFolder,
  },
  {
    id: 'history',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'recent',
    titleKey: 'rsPane.history',
    settingKey: 'showHistoryPanel',
    menuKey: 'history',
    available: (ctx) => ctx.autoGitEnabled && markdownInFolder(ctx),
  },
  {
    id: 'inspector',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: false,
    icon: 'wrench',
    titleKey: 'rsPane.inspector',
    settingKey: 'showInspector',
    menuKey: 'inspector',
    available: markdownInFolder,
  },
  {
    id: 'agent',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: true,
    icon: 'sparkle',
    titleKey: 'rsPane.agent',
    settingKey: 'showAgentPanel',
    menuKey: 'agent',
    available: (ctx) => !ctx.appStoreBuild,
  },
  // D6 preset: right side = calendar (active) + agent. Reserved only.
  {
    id: 'calendar',
    visibility: 'setting',
    defaultSide: 'right',
    defaultVisible: true,
    defaultActive: true,
    pending: true,
    icon: 'calendar',
    titleKey: 'rsPane.calendar',
    available: () => false,
  },
];

/** Ids with a renderable component today. Drives `visibleRsPanes`. */
export const IMPLEMENTED_SIDEBAR_PANE_IDS: readonly ImplementedSidebarPaneId[] =
  SIDEBAR_PANE_DEFS.filter((d) => !d.pending).map((d) => d.id as ImplementedSidebarPaneId);
