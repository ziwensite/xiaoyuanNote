/**
 * Context menus for the app chrome — as data.
 *
 * Right-click used to mean six different things (file tree, editor, tabs,
 * saved views, pomodoro) while the *chrome* — panel bodies, dock tab icons,
 * toolbar action icons, the tab strip's empty stretch, the column edge — had
 * no menu at all. In a release build `native-menu-guard` swallows the browser
 * menu there, so a right-click looked like a dead control.
 *
 * These builders are pure: no Vue, no stores, no i18n instance. Each one
 * describes only the items that make sense on *that* surface, and every id is
 * an action that already exists (a `settings` dock action, or an id
 * `dispatchMenuAction` in App.vue routes). Nothing here invents a command.
 */

import type { SidebarSide } from './sidebar-dock';
import type { SidebarPaneId } from '../panes/sidebar-panes';

export type CtxTranslate = (key: string, params?: Record<string, string | number>) => string;

/** Every action a context menu may dispatch. Ids match App.vue / the store. */
export type CtxActionId =
  | 'panel.open'
  | 'panel.close'
  | 'panel.moveLeft'
  | 'panel.moveRight'
  | 'panel.manage'
  | 'column.collapse'
  | 'column.expand'
  | 'view.toggleFileTree'
  | 'view.toggleRightSidebar'
  | 'view.toggleToolbar'
  | 'view.toggleFocusMode'
  | 'view.toggleTypewriter'
  | 'view.toggleWrap'
  | 'view.toggleLineNumbers'
  | 'export.html'
  | 'export.docx'
  | 'export.pdf'
  | 'export.pdfPrint'
  | 'export.image'
  | 'export.copyMd'
  | 'file.new'
  | 'file.open'
  | 'file.openFolder'
  | 'tab.reopenClosed';

export interface CtxEntry {
  id: CtxActionId;
  label: string;
  checked?: boolean;
  disabled?: boolean;
}

export interface CtxSep {
  sep: true;
}

export type CtxNode = CtxEntry | CtxSep;
export type CtxToolbarKind = 'left' | 'right' | 'export' | 'more';

/** State the check marks and the disabled flags read. */
export interface CtxState {
  showLeft: boolean;
  showRight: boolean;
  focusMode: boolean;
  typewriter: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  toolbarHidden: boolean;
  /** Pane a panel menu was opened on. */
  paneId: SidebarPaneId;
  /** Which column that pane currently sits in. */
  paneSide: SidebarSide;
  /** `files` is shell chrome: pinned first, never movable. */
  panePinned: boolean;
  /** Is that column already folded down to its icon rail? */
  paneColumnCollapsed: boolean;
  /** Stage 2: region the tab lives in, and whether split/merge are legal. */
  paneGroupIndex?: number;
  canSplitRegion?: boolean;
  canMergeRegion?: boolean;
}

const sep: CtxSep = { sep: true };

const entry = (id: CtxActionId, label: string, extra: Partial<CtxEntry> = {}): CtxEntry => ({
  id,
  label,
  ...extra,
});

/** Fold / unfold the column the menu was opened on. The rail's own menu runs
 *  while the column is already folded, so the item has to flip or it lies. */
const columnToggle = (t: CtxTranslate, state: CtxState): CtxEntry =>
  state.paneColumnCollapsed
    ? entry('column.expand', t('sidebarDock.expand'))
    : entry('column.collapse', t('sidebarDock.collapse'));

/**
 * Panel body. These are dock actions — close/switch/move a *slot* — not
 * content actions (the file tree, editor, tabs and saved views carry their
 * own menus and stop the event before it reaches here).
 *
 * "Close" and "collapse" are two different things and both live here:
 *  - close     removes this pane from the column (`hideDockPane`), and it can
 *              be brought back from the `+` panel list;
 *  - collapse  folds the whole column down to its icon rail.
 * `files` is shell chrome and cannot be removed, so its close is greyed out —
 * the item stays visible so the menu reads the same everywhere.
 */
export function buildPanelMenu(t: CtxTranslate, state: CtxState): CtxNode[] {
  const pinned = state.panePinned;
  return [
    entry('panel.close', t('panelMenu.close'), { disabled: pinned }),
    sep,
    entry('panel.moveLeft', t('panelMenu.moveToLeft'), {
      disabled: pinned || state.paneSide === 'left',
    }),
    entry('panel.moveRight', t('panelMenu.moveToRight'), {
      disabled: pinned || state.paneSide === 'right',
    }),
    sep,
    entry('panel.manage', t('panelMenu.manage')),
    sep,
    columnToggle(t, state),
  ];
}

/** Dock tab icon: the icon is a slot, so the menu talks about the slot. */
export function buildDockTabMenu(t: CtxTranslate, state: CtxState): CtxNode[] {
  const pinned = state.panePinned;
  return [
    entry('panel.open', t('panelMenu.open')),
    sep,
    entry('panel.close', t('panelMenu.close'), { disabled: pinned }),
    entry('panel.moveLeft', t('panelMenu.moveToLeft'), {
      disabled: pinned || state.paneSide === 'left',
    }),
    entry('panel.moveRight', t('panelMenu.moveToRight'), {
      disabled: pinned || state.paneSide === 'right',
    }),
    sep,
    entry('panel.manage', t('panelMenu.manage')),
    sep,
    columnToggle(t, state),
  ];
}

/** Toolbar action icons: each icon answers one question, and only that one. */
export function buildToolbarActionsMenu(kind: CtxToolbarKind, t: CtxTranslate, state: CtxState): CtxNode[] {
  if (kind === 'export') {
    return [
      entry('export.html', t('toolbar.exportHtml')),
      entry('export.docx', t('toolbar.exportDocx')),
      entry('export.pdfPrint', t('toolbar.exportPdfPrint')),
      entry('export.pdf', t('toolbar.exportPdf')),
      entry('export.image', t('toolbar.exportImage')),
      sep,
      entry('export.copyMd', t('cmd.export.copyMd')),
    ];
  }
  if (kind === 'more') {
    return [
      entry('view.toggleFocusMode', t('menubar.focusMode'), { checked: state.focusMode }),
      entry('view.toggleTypewriter', t('menubar.typewriterMode'), { checked: state.typewriter }),
      entry('view.toggleWrap', t('menubar.wordWrap'), { checked: state.wordWrap }),
      entry('view.toggleLineNumbers', t('menubar.lineNumbers'), { checked: state.lineNumbers }),
      sep,
      entry('view.toggleToolbar', t('menubar.toggleToolbar'), { checked: !state.toolbarHidden }),
    ];
  }
  // left / right column toggles: both answer "which columns are on", but the
  // icon's own column comes first so the two menus are not byte-identical.
  const left = entry('view.toggleFileTree', t('header.leftPanels'), { checked: state.showLeft });
  const right = entry('view.toggleRightSidebar', t('header.rightPanels'), { checked: state.showRight });
  return [
    ...(kind === 'right' ? [right, left] : [left, right]),
    sep,
    entry('view.toggleToolbar', t('menubar.toggleToolbar'), { checked: !state.toolbarHidden }),
  ];
}

/** The empty stretch of the editor tab strip: nothing is under the pointer. */
export function buildTabStripMenu(t: CtxTranslate): CtxNode[] {
  return [
    entry('file.new', t('menubar.newMd')),
    entry('file.open', t('menubar.openFile')),
    entry('file.openFolder', t('menubar.openFolder')),
    sep,
    entry('tab.reopenClosed', t('cmd.tab.reopenClosed')),
  ];
}

/** The resize handle / column edge. */
export function buildColumnEdgeMenu(
  t: CtxTranslate,
  side: SidebarSide,
  collapsed: boolean,
  state: CtxState,
): CtxNode[] {
  const toggleId: CtxActionId = side === 'left' ? 'view.toggleFileTree' : 'view.toggleRightSidebar';
  const toggleLabel = side === 'left' ? t('header.leftPanels') : t('header.rightPanels');
  return [
    collapsed
      ? entry('column.expand', t('sidebarDock.expand'))
      : entry('column.collapse', t('sidebarDock.collapse')),
    sep,
    entry(toggleId, toggleLabel, { checked: side === 'left' ? state.showLeft : state.showRight }),
  ];
}
