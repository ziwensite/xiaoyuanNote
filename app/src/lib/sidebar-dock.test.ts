import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AGENT_DOCK_WIDTH,
  DEFAULT_DOCK_WIDTH,
  DOCK_GROUP_DEFAULT_HEIGHT,
  DOCK_GROUP_MAX_HEIGHT,
  DOCK_GROUP_MIN_HEIGHT,
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  clampGroupHeight,
  defaultSidebarDock,
  dockActiveId,
  dockPane,
  effectiveDockWidth,
  isDockPaneVisible,
  mergeDockGroups,
  mergeFilesPane,
  migrateSidebarDock,
  moveAllPanesToSide,
  moveDockTab,
  nextActiveAfterHide,
  paneGroup,
  resolveGroupActive,
  sanitizeSidebarDock,
  setDockGroupHeight,
  sideDockPanes,
  splitDockGroup,
  type SidebarDockState,
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

/** Tab ids of one side, flattened across its regions. */
function idsOn(dock: SidebarDockState, side: 'left' | 'right'): string[] {
  return sideDockPanes(dock, side).map((pane) => pane.id);
}

test('fresh install follows V1: files left, outline + agent right', () => {
  const dock = defaultSidebarDock();
  assert.deepEqual(dock.groups.left[0].panes, ['files']);
  assert.equal(isDockPaneVisible(dock, 'files'), true);
  assert.equal(dock.groups.left[0].active, 'files');

  const right = idsOn(dock, 'right');
  assert.ok(right.includes('outline'));
  assert.ok(right.includes('agent'));
  assert.ok(right.includes('calendar'));
  assert.equal(isDockPaneVisible(dock, 'outline'), true);
  assert.equal(isDockPaneVisible(dock, 'agent'), true);
  // M1 ships the calendar opt-in: present in the dock, off for a fresh install.
  assert.equal(dockPane(dock, 'calendar')?.visible, false);
  assert.equal(dock.groups.right[0].active, 'outline');

  // D3: primary sidebar starts expanded, secondary collapsed.
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.width.left, DEFAULT_DOCK_WIDTH);
  assert.equal(dock.width.right, DEFAULT_DOCK_WIDTH);
});

test('stage 1 keeps exactly one region per side (the model supports more)', () => {
  const dock = defaultSidebarDock();
  assert.equal(dock.groups.left.length, 1);
  assert.equal(dock.groups.right.length, 1);
  assert.equal(sanitizeSidebarDock(dock).groups.left.length, 1);
});

test('migrates a legacy right-side stack onto the right, files stays left', () => {
  const dock = migrateSidebarDock(legacy());
  assert.deepEqual(idsOn(dock, 'left'), ['files']);
  assert.equal(idsOn(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);

  for (const id of ['backlinks', 'tags', 'agent'] as const) {
    assert.equal(isDockPaneVisible(dock, id), true, `${id} should stay on`);
  }
  for (const id of ['relationships', 'tasks', 'neighborhood', 'types', 'history', 'inspector'] as const) {
    assert.equal(isDockPaneVisible(dock, id), false, `${id} should stay off`);
  }
  // First visible setting pane in the legacy order.
  assert.equal(dock.groups.right[0].active, 'backlinks');
  // A legacy right-side stack leaves the primary region on its runtime fallback
  // (files); nothing was explicitly active on the left.
  assert.equal(dock.groups.left[0].active, null);
  // 260 content + 32 rail.
  assert.equal(dock.width.right, 292);
  assert.equal(dock.width.left, DEFAULT_DOCK_WIDTH);
  assert.equal(dock.collapsed.right, false);
  assert.equal(dock.collapsed.left, true);
});

test('migrates a legacy left-side stack onto the left', () => {
  const dock = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  assert.equal(idsOn(dock, 'right').length, 0);
  assert.equal(idsOn(dock, 'left').length, SIDEBAR_PANE_DEFS.length);
  assert.equal(dock.groups.left[0].active, 'backlinks');
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
});

test('a hidden legacy stack migrates as collapsed', () => {
  const dock = migrateSidebarDock(legacy({ rightSidebarHidden: true }));
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.groups.right[0].active, 'backlinks');
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
  assert.equal(dock.groups.right[0].active, 'outline');
});

test('upgrades the pre-stage-1 flat panes[] shape without losing tab order', () => {
  const dock = sanitizeSidebarDock({
    panes: [
      { id: 'files', side: 'left', visible: true },
      { id: 'outline', side: 'right', visible: true },
      { id: 'agent', side: 'right', visible: true },
      { id: 'backlinks', side: 'right', visible: true },
    ],
    active: { left: 'files', right: 'agent' },
    collapsed: { left: false, right: false },
    width: { left: 292, right: 292 },
  });

  assert.deepEqual(dock.groups.left[0].panes, ['files']);
  // Stored order survives; panes the blob never mentioned are appended at
  // their registry default side (outline etc. are already present).
  assert.deepEqual(dock.groups.right[0].panes.slice(0, 3), ['outline', 'agent', 'backlinks']);
  assert.equal(dock.groups.right[0].active, 'agent');
  assert.equal(dock.groups.left[0].active, 'files');
  // Upgrading the same blob twice changes nothing.
  assert.deepEqual(sanitizeSidebarDock(dock), dock);
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

  const ids = [...dock.groups.left, ...dock.groups.right].flatMap((group) => group.panes);
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
  assert.equal(dockPane(dock, 'files')?.side, 'left');
  // `bogus` is not a pane, and `agent` now lives on the left, so both slots clear.
  assert.equal(dock.groups.left[0].active, null);
  assert.equal(dock.groups.right[0]?.active, null);
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  assert.equal(dock.width.left, MIN_DOCK_WIDTH);
  assert.equal(dock.width.right, MAX_DOCK_WIDTH);
});

test('files is pinned first on the left and always visible', () => {
  const dock = sanitizeSidebarDock({
    groups: {
      left: [{ panes: ['outline', 'files'], active: 'outline' }],
      right: [{ panes: ['agent'], active: 'agent' }],
    },
    visible: { files: false, outline: true, agent: true },
    collapsed: { left: false, right: false },
    width: { left: 292, right: 292 },
  });
  assert.deepEqual(dock.groups.left[0].panes.slice(0, 2), ['files', 'outline']);
  assert.equal(isDockPaneVisible(dock, 'files'), true);
  // `files` was the stored active tab of the left group; it is reinstated.
  assert.equal(dock.groups.left[0].active, 'outline');
});

test('marker without dock data restores defaults instead of legacy switches', () => {
  const dock = migrateSidebarDock(
    legacy({ v510SidebarDockMigrated: true, showBacklinks: true }),
  );
  assert.deepEqual(idsOn(dock, 'left'), ['files']);
  assert.equal(dock.groups.right[0].active, 'outline');
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
  const right = idsOn(dock, 'right');
  assert.deepEqual(right.slice(0, 2), ['agent', 'outline']);
  assert.ok(right.includes('calendar'));
  // Duplicates in the stored order are not duplicated in the result.
  const duplicate = migrateSidebarDock(legacy({ rsPaneOrder: ['agent', 'agent'] }));
  assert.equal(idsOn(duplicate, 'right').filter((id) => id === 'agent').length, 1);
});

test('dockActiveId follows the stored active pane and falls back to the first renderable', () => {
  const groups = [
    {
      panes: [
        { id: 'files' as const, visible: true, available: true },
        { id: 'outline' as const, visible: true, available: true },
      ],
      active: 'files' as const,
    },
  ];
  assert.equal(dockActiveId(groups), 'files');
  assert.equal(dockActiveId([{ ...groups[0], active: null }]), 'files');
  assert.equal(
    dockActiveId([{ panes: [{ id: 'outline' as const, visible: false, available: true }], active: null }]),
    null,
  );
  assert.equal(
    dockActiveId([
      { panes: [], active: null },
      { panes: [{ id: 'agent' as const, visible: true, available: true }], active: 'agent' },
    ]),
    'agent',
  );
});

test('effectiveDockWidth only widens Agent at or below the default', () => {
  assert.equal(effectiveDockWidth(292, 'agent'), AGENT_DOCK_WIDTH);
  assert.equal(effectiveDockWidth(212, 'agent'), AGENT_DOCK_WIDTH);
  assert.equal(effectiveDockWidth(400, 'agent'), 400);
  assert.equal(effectiveDockWidth(292, 'outline'), 292);
  assert.equal(effectiveDockWidth(292, null), 292);
});

test('active falls back to the first renderable pane and never to calendar', () => {
  const dock = defaultSidebarDock();
  const group = dock.groups.right[0];
  assert.equal(resolveGroupActive({ ...group, active: null }, ['agent']), 'agent');
  assert.equal(resolveGroupActive(group, []), null);
  assert.equal(resolveGroupActive({ ...group, active: 'agent' }, ['backlinks', 'agent']), 'agent');
  // A pending pane (calendar) is never chosen as the fallback.
  assert.equal(resolveGroupActive({ ...group, active: null }, ['outline']), 'outline');
});

test('hiding a pane activates the next visible pane in the same region', () => {
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

test('moveDockTab reorders within a region', () => {
  const dock = sanitizeSidebarDock({
    groups: {
      left: [{ panes: ['files'], active: 'files' }],
      right: [{ panes: ['outline', 'agent'], active: 'outline' }],
    },
    visible: { files: true, outline: true, agent: true },
    collapsed: { left: false, right: false },
    width: { left: 292, right: 292 },
  });

  // Drop agent before outline.
  const first = moveDockTab(dock, 'agent', { side: 'right', group: 0, index: 0 });
  assert.deepEqual(first.groups.right[0].panes.slice(0, 2), ['agent', 'outline']);
  assert.equal(first.groups.right[0].active, 'agent');

  // Drop outline after agent (append).
  const second = moveDockTab(dock, 'outline', { side: 'right', group: 0, index: 2 });
  assert.deepEqual(second.groups.right[0].panes.slice(0, 2), ['agent', 'outline']);
  assert.equal(second.groups.right[0].active, 'outline');
});

test('moveDockTab crosses sides and keeps files pinned first', () => {
  const dock = defaultSidebarDock();
  const moved = moveDockTab(dock, 'outline', { side: 'left', group: 0, index: 0 });
  // files pins index 0, so the drop lands right after it.
  assert.deepEqual(moved.groups.left[0].panes.slice(0, 2), ['files', 'outline']);
  assert.equal(paneGroup(moved, 'outline')?.side, 'left');
  assert.equal(paneGroup(moved, 'outline')?.index, 1);
  assert.equal(moved.groups.left[0].active, 'outline');
  assert.equal(moved.groups.right[0].panes.includes('outline'), false);

  // `files` itself never moves.
  assert.equal(moveDockTab(dock, 'files', { side: 'right', group: 0, index: 0 }), dock);

  // Out-of-range indices clamp instead of throwing.
  const clamped = moveDockTab(dock, 'agent', { side: 'left', group: 0, index: 99 });
  assert.deepEqual(clamped.groups.left[0].panes.slice(0, 2), ['files', 'agent']);
});

test('moving every pane to a side keeps files on the left', () => {
  const dock = moveAllPanesToSide(defaultSidebarDock(), 'right');
  assert.deepEqual(dock.groups.left[0].panes, ['files']);
  assert.equal(idsOn(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);
  assert.equal(dock.groups.right[0].active, 'outline');
  assert.equal(dock.groups.left[0].active, 'files');
});

test('V1 merge moves every non-files pane off the left and keeps files there', () => {
  const before = migrateSidebarDock(legacy({ outlineSide: 'left' }));
  assert.equal(idsOn(before, 'right').length, 0);
  assert.ok(idsOn(before, 'left').includes('outline'));

  const { dock, movedToSecondary } = mergeFilesPane(before, {
    showFileTree: true,
    fileTreeWidth: 260,
    alreadyMerged: false,
  });

  assert.deepEqual(idsOn(dock, 'left'), ['files']);
  assert.equal(idsOn(dock, 'right').length, SIDEBAR_PANE_DEFS.length - 1);
  assert.ok(movedToSecondary.includes('outline'));
  assert.equal(dock.groups.left[0].active, 'files');
  assert.equal(dock.groups.right[0].active, 'outline');
  assert.equal(dock.collapsed.left, false);
  assert.equal(dock.collapsed.right, true);
  // 260 old content + 32 rail keeps the pre-merge width.
  assert.equal(dock.width.left, 292);
});

test('V1 merge mirrors showFileTree into the collapsed state', () => {
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
    groups: {
      left: [{ panes: ['outline'], active: 'outline' }],
      right: [{ panes: ['files', 'agent'], active: 'files' }],
    },
    visible: { files: false, outline: true, agent: true },
    collapsed: { left: false, right: true },
    width: { left: 292, right: 292 },
  });
  assert.equal(dockPane(dock, 'files')?.side, 'left');
  assert.equal(dockPane(dock, 'files')?.visible, true);
  assert.deepEqual(dock.groups.left[0].panes, ['files', 'outline']);
  assert.equal(dock.groups.right[0].active, null);
});

test('every locale has a title key for each shipped pane and the dock chrome', () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const def of SIDEBAR_PANE_DEFS) {
      assert.equal(typeof lookup(dict, def.titleKey), 'string', `${name} missing ${def.titleKey}`);
    }
    for (const key of [
      'sidebarDock.collapse',
      'sidebarDock.expand',
      'sidebarDock.openPanel',
      'sidebarDock.addPanel',
      'toolbar.leftSidebarTooltip',
    ]) {
      assert.equal(typeof lookup(dict, key), 'string', `${name} missing ${key}`);
    }
    for (const key of [
      'calendar.openFolder',
      'calendar.empty',
      'calendar.today',
      'calendar.allDay',
      'calendar.more',
      'calendar.view.agenda',
      'calendar.view.month',
      'calendar.groups.overdue',
      'calendar.undated',
    ]) {
      assert.equal(typeof lookup(dict, key), 'string', `${name} missing ${key}`);
    }
    assert.equal(
      typeof lookup(dict, 'toast.outlineMovedToSecondary'),
      'string',
      `${name} missing toast.outlineMovedToSecondary`,
    );
  }
});

// ── Stage 2, batch 1: stacked regions (data layer only) ──────────────────

function stagedDock(): SidebarDockState {
  const base = defaultSidebarDock();
  return {
    ...base,
    groups: {
      left: base.groups.left,
      right: [
        { panes: ['outline', 'backlinks'], active: 'outline' },
        { panes: ['agent', 'tags'], active: 'agent' },
      ],
    },
  };
}

test('stage 2 height weights clamp and fall back to 1', () => {
  assert.equal(clampGroupHeight(undefined), DOCK_GROUP_DEFAULT_HEIGHT);
  assert.equal(clampGroupHeight(NaN), DOCK_GROUP_DEFAULT_HEIGHT);
  assert.equal(clampGroupHeight(0), DOCK_GROUP_MIN_HEIGHT);
  assert.equal(clampGroupHeight(99), DOCK_GROUP_MAX_HEIGHT);
  assert.equal(clampGroupHeight(1.234), 1.23);
});

test('stage 2 sanitize keeps heights, drops the files share and is idempotent', () => {
  const raw: SidebarDockState = {
    ...stagedDock(),
    groups: {
      left: [{ panes: ['files'], active: 'files', height: 3 }],
      right: [
        { panes: ['outline', 'backlinks'], active: 'outline', height: 2 },
        { panes: ['agent', 'tags'], active: 'agent', height: 99 },
      ],
    },
  };
  const once = sanitizeSidebarDock(raw);
  assert.equal(once.groups.left[0].height, undefined);
  assert.equal(once.groups.right[0].height, 2);
  assert.equal(once.groups.right[1].height, DOCK_GROUP_MAX_HEIGHT);
  assert.deepEqual(sanitizeSidebarDock(once), once);
});

test('stage 2 blobs without height keep their old shape', () => {
  const base = defaultSidebarDock();
  const clean = sanitizeSidebarDock(base);
  assert.equal(clean.groups.left[0].height, undefined);
  assert.deepEqual(clean.groups, base.groups);
});

test('stage 2 splitDockGroup moves a pane into a new region', () => {
  const before = stagedDock();
  const after = splitDockGroup(before, 'right', 0, 'backlinks');
  assert.notEqual(after, before);
  assert.equal(after.groups.right.length, 3);
  assert.deepEqual(after.groups.right[0].panes, ['outline']);
  assert.deepEqual(after.groups.right[1].panes, ['backlinks']);
  assert.equal(after.groups.right[1].active, 'backlinks');
  assert.equal(after.groups.right[0].height, 0.5);
  assert.equal(after.groups.right[1].height, 0.5);
  assert.equal(before.groups.right.length, 2);
});

test('stage 2 splitDockGroup refuses files, unknown panes and single-tab regions', () => {
  const before = stagedDock();
  assert.equal(splitDockGroup(before, 'left', 0, 'outline'), before);
  assert.equal(splitDockGroup(before, 'right', 0, 'files'), before);
  assert.equal(splitDockGroup(before, 'right', 0, 'calendar'), before);
  assert.equal(splitDockGroup(before, 'right', 9, 'outline'), before);
  const single = splitDockGroup(before, 'right', 1, 'agent');
  assert.notEqual(single, before);
  assert.equal(splitDockGroup(single, 'right', 2, 'agent'), single);
});

test('stage 2 mergeDockGroups folds the next region back', () => {
  const before = stagedDock();
  const weighted = setDockGroupHeight(
    setDockGroupHeight(before, 'right', 0, 2),
    'right',
    1,
    1.5,
  );
  const after = mergeDockGroups(weighted, 'right', 0);
  assert.equal(after.groups.right.length, 1);
  assert.deepEqual(after.groups.right[0].panes, ['outline', 'backlinks', 'agent', 'tags']);
  assert.equal(after.groups.right[0].active, 'outline');
  assert.equal(after.groups.right[0].height, 3.5);
});

test('stage 2 mergeDockGroups refuses files regions and bad indices', () => {
  const before = stagedDock();
  const withLeftRegions: SidebarDockState = {
    ...before,
    groups: {
      left: [before.groups.left[0], { panes: ['tags'], active: 'tags' }],
      right: before.groups.right,
    },
  };
  assert.equal(mergeDockGroups(withLeftRegions, 'left', 0), withLeftRegions);
  assert.equal(mergeDockGroups(before, 'right', 1), before);
  assert.equal(mergeDockGroups(before, 'right', -1), before);
});

test('stage 2 setDockGroupHeight clamps and never touches files', () => {
  const before = stagedDock();
  assert.equal(
    setDockGroupHeight(before, 'right', 1, 9).groups.right[1].height,
    DOCK_GROUP_MAX_HEIGHT,
  );
  assert.equal(
    setDockGroupHeight(before, 'right', 1, -3).groups.right[1].height,
    DOCK_GROUP_MIN_HEIGHT,
  );
  assert.equal(setDockGroupHeight(before, 'left', 0, 3), before);
  assert.equal(before.groups.right[1].height, undefined);
});

test('stage 2 drag targets a region and rehomes the share of an emptied group', () => {
  const base = defaultSidebarDock();
  const before: SidebarDockState = {
    ...base,
    groups: {
      left: base.groups.left,
      right: [
        { panes: ['outline', 'backlinks'], active: 'outline', height: 1 },
        { panes: ['tags'], active: 'tags', height: 2 },
        { panes: ['agent'], active: 'agent', height: 1 },
      ],
    },
  };
  const after = moveDockTab(before, 'tags', { side: 'right', group: 0, index: 1 });
  assert.equal(after.groups.right.length, 2);
  assert.deepEqual(after.groups.right[0].panes, ['outline', 'tags', 'backlinks']);
  assert.equal(after.groups.right[1].height, 3);
  assert.equal(before.groups.right.length, 3);
});
