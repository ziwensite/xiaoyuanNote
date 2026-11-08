import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_DOCK_WIDTH,
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  defaultSidebarDock,
  dockPane,
  isDockPaneVisible,
  mergeFilesPane,
  migrateSidebarDock,
  moveAllPanesToSide,
  nextActiveAfterHide,
  resolveActive,
  sanitizeSidebarDock,
  sideDockPanes,
} from './sidebar-dock.ts';
import { SIDEBAR_PANE_DEFS } from '../panes/sidebar-panes.ts';
import { en } from '../i18n/en.ts';
import { zh } from '../i18n/zh.ts';
import { ja } from '../i18n/ja.ts';
import { ko } from '../i18n/ko.ts';
import { de } from '../i18n/de.ts';
import { fr } from '../i18n/fr.ts';
import { es } from '../i18n/es.ts';
import { pt } from '../i18n/pt.ts';
import { it } from '../i18n/it.ts';
import { pl } from '../i18n/pl.ts';
import { nl } from '../i18n/nl.ts';
import { tr } from '../i18n/tr.ts';
import { sv } from '../i18n/sv.ts';
import { uk } from '../i18n/uk.ts';
import { ru } from '../i18n/ru.ts';

const LOCALES = { en, zh, ja, ko, de, fr, es, pt, it, pl, nl, tr, sv, uk, ru };

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, dict);
}

/** Legacy blob shaped like the pre-S2 `solomd.settings.v1`. */
function legacy(overrides: Record<string, unknown> = {}) {
  return {
    outlineSide: 'right',
    rsPaneOrder: [
      'search',
      'outline',
      'backlinks',
      'relationships',
      'tags',
      'tasks',
      'neighborhood',
      'types',
      'history',
      'inspector',
      'agent',
    ],
    showBacklinks: true,
    showRelationships: false,
    showTagsPanel: true,
    showTasksPanel: false,
    showNeighborhood: false,
    showTypesPanel: false,
    showHistoryPanel: false,
    showInspector: false,
    showAgentPanel: true,
    rightSidebarHidden: false,
    sideSidebarWidth: 260,
    ...overrides,
  };
}

test('fresh install follows V1: files left, outline + agent right', () => {
  const dock = defaultSidebarDock();
  const left = sideDockPanes(dock, 'left');
  const right = sideDockPanes(dock, 'right');

  assert.deepEqual(left.map((pane) => pane.id), ['files']);
  assert.equal(isDockPaneVisible(dock, 'files'), true);
  assert.equal(dock.active.left, 'files');

  assert.ok(right.some((pane) => pane.id === 'outline'));
  assert.ok(right.some((pane) => pane.id === 'agent'));
  assert.ok(right.some((pane) => pane.id === 'calendar'));
  assert.equal(isDockPaneVisible(dock, 'outline'), true);
  assert.equal(isDockPaneVisible(dock, 'agent'), true);
  // Calendar is reserved, not switched on for real UI lists.
  assert.equal(dockPane(dock, 'calendar')?.visible, true);
  assert.equal(dock.active.right, 'outline');

  // D3: primary sidebar starts expanded, secondary collapsed.
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.width.left, DEFAULT_DOCK_WIDTH);
  assert.equal(dock.width.right, DEFAULT_DOCK_WIDTH);
});

test('migrates a legacy right-side stack onto the right, files stays left', () => {
  const dock = migrateSidebarDock(legacy());
  assert.deepEqual(sideDockPanes(dock, 'left').map((pane) => pane.id), ['files']);
  assert.equal(sideDockPanes(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);

  for (const id of ['backlinks', 'tags', 'agent'] as const) {
    assert.equal(isDockPaneVisible(dock, id), true, `${id} should stay on`);
  }
  for (const id of ['relationships', 'tasks', 'neighborhood', 'types', 'history', 'inspector'] as const) {
    assert.equal(isDockPaneVisible(dock, id), false, `${id} should stay off`);
  }
  // First visible setting pane in the legacy order.
  assert.equal(dock.active.right, 'backlinks');
  assert.equal(dock.active.left, null);
  // 260 content + 32 rail.
  assert.equal(dock.width.right, 292);
  assert.equal(dock.width.left, DEFAULT_DOCK_WIDTH);
  assert.equal(dock.collapsed.right, false);
  assert.equal(dock.collapsed.left, true);
});

test('migrates a legacy left-side stack onto the left', () => {
  const dock = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  assert.equal(sideDockPanes(dock, 'right').length, 0);
  assert.equal(sideDockPanes(dock, 'left').length, SIDEBAR_PANE_DEFS.length);
  assert.equal(dock.active.left, 'backlinks');
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
});

test('a hidden legacy stack migrates as collapsed', () => {
  const dock = migrateSidebarDock(legacy({ rightSidebarHidden: true }));
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.active.right, 'backlinks');
});

test('all legacy switches off falls back to the outline', () => {
  const dock = migrateSidebarDock(
    legacy({
      showBacklinks: false,
      showRelationships: false,
      showTagsPanel: false,
      showTasksPanel: false,
      showNeighborhood: false,
      showTypesPanel: false,
      showHistoryPanel: false,
      showInspector: false,
      showAgentPanel: false,
    }),
  );
  assert.equal(dock.active.right, 'outline');
});

test('sanitize keeps unknown/duplicate entries out and appends missing ids', () => {
  const dock = sanitizeSidebarDock({
    panes: [
      { id: 'agent', side: 'left', visible: true },
      { id: 'bogus', side: 'right', visible: true },
      { id: 'agent', side: 'right', visible: false },
      { id: 'outline', side: 'nope', visible: 'x' },
    ],
    active: { left: 'bogus', right: 'agent' },
    collapsed: { left: false },
    width: { left: 100, right: 900 },
  });

  const ids = dock.panes.map((pane) => pane.id);
  assert.equal(ids.filter((id) => id === 'agent').length, 1);
  assert.equal(ids.includes('bogus' as never), false);
  for (const def of SIDEBAR_PANE_DEFS) assert.ok(ids.includes(def.id), `missing ${def.id}`);

  const agent = dockPane(dock, 'agent');
  assert.equal(agent?.side, 'left');
  assert.equal(agent?.visible, true);
  // Invalid side falls back to the registry default (files left, outline right).
  assert.equal(dockPane(dock, 'outline')?.side, 'right');
  assert.equal(dockPane(dock, 'outline')?.visible, true);
  // The primary container cannot be moved to the right by a stored blob.
  assert.equal(dockPane(dock, 'files')?.side, 'left');
  assert.equal(dockPane(dock, 'files')?.visible, true);
  // `bogus` is not a pane, and `agent` now lives on the left, so both slots clear.
  assert.equal(dock.active.left, null);
  assert.equal(dock.active.right, null);
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.width.left, MIN_DOCK_WIDTH);
  assert.equal(dock.width.right, MAX_DOCK_WIDTH);
});

test('marker without dock data restores defaults instead of legacy switches', () => {
  const dock = migrateSidebarDock(
    legacy({ v510SidebarDockMigrated: true, showBacklinks: true }),
  );
  assert.deepEqual(sideDockPanes(dock, 'left').map((pane) => pane.id), ['files']);
  assert.equal(dock.active.right, 'outline');
});

test('an already-migrated dock is sanitized, not re-read from legacy', () => {
  const first = migrateSidebarDock(legacy());
  const second = migrateSidebarDock({ ...legacy(), sidebarDock: first });
  assert.deepEqual(second, first);
  // Idempotent even after the user moved everything.
  const moved = moveAllPanesToSide(first, 'left');
  assert.deepEqual(
    migrateSidebarDock({ ...legacy(), sidebarDock: moved }),
    sanitizeSidebarDock(moved),
  );
});

test('width migration keeps 440 → 472 and clamps the extremes', () => {
  assert.equal(migrateSidebarDock(legacy({ sideSidebarWidth: 440 })).width.right, 472);
  assert.equal(migrateSidebarDock(legacy({ sideSidebarWidth: 999 })).width.right, MAX_DOCK_WIDTH);
  assert.equal(migrateSidebarDock(legacy({ sideSidebarWidth: 100 })).width.right, MIN_DOCK_WIDTH);
});

test('order follows the stored rsPaneOrder and appends unknown future ids', () => {
  const dock = migrateSidebarDock(
    legacy({ rsPaneOrder: ['agent', 'outline', 'nope'] }),
  );
  const right = sideDockPanes(dock, 'right').map((pane) => pane.id);
  assert.deepEqual(right.slice(0, 2), ['agent', 'outline']);
  assert.ok(right.includes('calendar'));
  // Duplicates in the stored order are not duplicated in the result.
  const duplicate = migrateSidebarDock(legacy({ rsPaneOrder: ['agent', 'agent'] }));
  assert.equal(sideDockPanes(duplicate, 'right').filter((pane) => pane.id === 'agent').length, 1);
});

test('active falls back to the first renderable pane and never to calendar', () => {
  const dock = defaultSidebarDock();
  assert.equal(resolveActive(dock, 'right', ['agent']), 'agent');
  assert.equal(resolveActive(dock, 'right', []), null);
  const storedAgent = { ...dock, active: { ...dock.active, right: 'agent' as const } };
  assert.equal(resolveActive(storedAgent, 'right', ['backlinks', 'agent']), 'agent');
});

test('hiding a pane activates the next visible pane on the same side', () => {
  const dock = sanitizeSidebarDock({
    panes: [
      { id: 'backlinks', side: 'right', visible: true },
      { id: 'tags', side: 'right', visible: true },
      { id: 'agent', side: 'left', visible: true },
      { id: 'tasks', side: 'right', visible: true },
      { id: 'outline', side: 'right', visible: false },
    ],
    active: { left: 'agent', right: 'backlinks' },
    collapsed: { left: false, right: false },
    width: { left: 292, right: 292 },
  });
  assert.equal(nextActiveAfterHide(dock, 'backlinks'), 'tags');
  assert.equal(nextActiveAfterHide(dock, 'tasks'), 'tags');
  // Forward first, then backward (closing the middle tab focuses the next one).
  assert.equal(nextActiveAfterHide(dock, 'tags'), 'tasks');
});

test('moving every pane to a side keeps files on the left', () => {
  const dock = moveAllPanesToSide(defaultSidebarDock(), 'right');
  assert.deepEqual(sideDockPanes(dock, 'left').map((pane) => pane.id), ['files']);
  assert.equal(sideDockPanes(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);
  assert.equal(dock.active.right, 'outline');
  assert.equal(dock.active.left, 'files');
});

test('V1 merge moves every non-files pane off the left and keeps files there', () => {
  const before = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  assert.equal(sideDockPanes(before, 'right').length, 0);
  assert.ok(sideDockPanes(before, 'left').some((pane) => pane.id === 'outline'));

  const { dock, movedToSecondary } = mergeFilesPane(before, {
    showFileTree: true,
    fileTreeWidth: 260,
    alreadyMerged: false,
  });

  assert.deepEqual(sideDockPanes(dock, 'left').map((pane) => pane.id), ['files']);
  assert.equal(sideDockPanes(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);
  assert.ok(movedToSecondary.includes('outline'));
  assert.equal(dock.active.left, 'files');
  assert.equal(dock.active.right, 'outline');
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  // 260 old content + 32 rail keeps the pre-merge width.
  assert.equal(dock.width.left, 292);
});

test('V1 merge mirrors showFileTree into the collapsed rail state', () => {
  const before = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  const { dock } = mergeFilesPane(before, {
    showFileTree: false,
    fileTreeWidth: 180,
    alreadyMerged: false,
  });
  assert.equal(dock.collapsed.left, true);
  assert.equal(dock.width.left, MIN_DOCK_WIDTH);
});

test('V1 merge is idempotent: a second run never resets user state', () => {
  const before = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  const opts = { showFileTree: true, fileTreeWidth: 320, alreadyMerged: false };
  const first = mergeFilesPane(before, opts);

  const marked = mergeFilesPane(first.dock, { ...opts, alreadyMerged: true });
  assert.deepEqual(marked.dock, first.dock);
  assert.deepEqual(marked.movedToSecondary, []);

  const rerun = mergeFilesPane(first.dock, opts);
  assert.deepEqual(rerun.dock, first.dock);
  assert.deepEqual(rerun.movedToSecondary, []);
});

test('files cannot be hidden or moved to the secondary sidebar by stored state', () => {
  const dock = sanitizeSidebarDock({
    panes: [
      { id: 'files', side: 'right', visible: false },
      { id: 'outline', side: 'right', visible: true },
    ],
    active: { left: 'files', right: 'outline' },
    collapsed: { left: false, right: true },
    width: { left: 292, right: 292 },
  });
  assert.equal(dockPane(dock, 'files')?.side, 'left');
  assert.equal(dockPane(dock, 'files')?.visible, true);
  assert.equal(moveAllPanesToSide(dock, 'right').panes.find((pane) => pane.id === 'files')?.side, 'left');
});


test('every locale has a title key for each shipped pane and the dock chrome', () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const def of SIDEBAR_PANE_DEFS) {
      assert.equal(typeof lookup(dict, def.titleKey), 'string', `${name} missing ${def.titleKey}`);
    }
    for (const key of ['sidebarDock.collapse', 'sidebarDock.expand']) {
      assert.equal(typeof lookup(dict, key), 'string', `${name} missing ${key}`);
    }
    assert.equal(
      typeof lookup(dict, 'toast.outlineMovedToSecondary'),
      'string',
      `${name} missing toast.outlineMovedToSecondary`,
    );
  }
});
