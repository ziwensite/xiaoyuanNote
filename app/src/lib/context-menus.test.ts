import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildColumnEdgeMenu,
  buildDockTabMenu,
  buildPanelMenu,
  buildTabStripMenu,
  buildToolbarActionsMenu,
  type CtxNode,
  type CtxState,
  type CtxTranslate,
} from './context-menus.ts';
import { buildAppMenu, type MenuContext, type MenuNode, type TopMenu } from './app-menu.ts';
import { en } from '../i18n/en.ts';
import { zh } from '../i18n/zh.ts';
import { ja } from '../i18n/ja.ts';
import { ko } from '../i18n/ko.ts';
import { de } from '../i18n/de.ts';
import { fr } from '../i18n/fr.ts';
import { es } from '../i18n/es.ts';
import { pt } from '../i18n/pt.ts';
import { it as itDict } from '../i18n/it.ts';
import { pl } from '../i18n/pl.ts';
import { nl } from '../i18n/nl.ts';
import { tr } from '../i18n/tr.ts';
import { sv } from '../i18n/sv.ts';
import { uk } from '../i18n/uk.ts';
import { ru } from '../i18n/ru.ts';

const DICTS: Record<string, unknown> = { en, zh, ja, ko, de, fr, es, pt, it: itDict, pl, nl, tr, sv, uk, ru };

function strictT(dict: unknown, lang: string): CtxTranslate {
  return (key: string, params?: Record<string, string | number>) => {
    let cur: any = dict;
    for (const p of key.split('.')) cur = cur?.[p];
    if (typeof cur !== 'string') throw new Error(`${lang}: missing ${key}`);
    if (params) for (const [k, v] of Object.entries(params)) cur = cur.replaceAll(`{${k}}`, String(v));
    return cur;
  };
}

const t = strictT(en, 'en');

const base: CtxState = {
  showLeft: true,
  showRight: true,
  focusMode: false,
  typewriter: false,
  wordWrap: true,
  lineNumbers: false,
  toolbarHidden: false,
  paneId: 'backlinks',
  paneSide: 'right',
  panePinned: false,
  paneColumnCollapsed: false,
};

const idsOf = (nodes: CtxNode[]) => nodes.filter((n): n is Extract<CtxNode, { id: string }> => !('sep' in n)).map((n) => n.id);
const entryOf = (nodes: CtxNode[], id: string) => nodes.find((n) => !('sep' in n) && n.id === id) as Extract<CtxNode, { id: string }>;

test('panel body menu lists close, move, manage and collapse', () => {
  assert.deepEqual(idsOf(buildPanelMenu(t, base)), [
    'panel.close',
    'panel.moveLeft',
    'panel.moveRight',
    'panel.manage',
    'column.collapse',
  ]);
});

test('outline keeps the same menu (its close switches the tab outline off)', () => {
  const nodes = buildPanelMenu(t, { ...base, paneId: 'outline' });
  assert.equal(entryOf(nodes, 'panel.close')!.disabled, false);
  assert.ok(idsOf(nodes).includes('column.collapse'));
});

test('pinned pane cannot be closed or moved, and the current column is disabled', () => {
  const files = buildPanelMenu(t, { ...base, paneId: 'files', paneSide: 'left', panePinned: true });
  assert.equal(entryOf(files, 'panel.close')!.disabled, true);
  assert.equal(entryOf(files, 'panel.moveLeft')!.disabled, true);
  assert.equal(entryOf(files, 'panel.moveRight')!.disabled, true);

  const rightOutline = buildPanelMenu(t, base);
  assert.equal(entryOf(rightOutline, 'panel.moveRight')!.disabled, true);
  assert.equal(entryOf(rightOutline, 'panel.moveLeft')!.disabled, false);
});

test('dock tab icon menu talks about the slot, not the pane content', () => {
  assert.deepEqual(idsOf(buildDockTabMenu(t, base)), [
    'panel.open',
    'panel.splitRegion',
    'panel.mergeRegion',
    'panel.close',
    'panel.moveLeft',
    'panel.moveRight',
    'panel.manage',
    'column.collapse',
  ]);
  const files = buildDockTabMenu(t, { ...base, paneId: 'files', paneSide: 'left', panePinned: true });
  assert.equal(entryOf(files, 'panel.close')!.disabled, true);
  assert.equal(entryOf(files, 'panel.moveRight')!.disabled, true);
});

test('stage 2 region commands are disabled unless split / merge are legal', () => {
  const plain = buildDockTabMenu(t, base);
  assert.equal(entryOf(plain, 'panel.splitRegion')!.disabled, true);
  assert.equal(entryOf(plain, 'panel.mergeRegion')!.disabled, true);

  const legal = buildDockTabMenu(t, {
    ...base,
    paneGroupIndex: 1,
    canSplitRegion: true,
    canMergeRegion: true,
  });
  assert.equal(entryOf(legal, 'panel.splitRegion')!.disabled, false);
  assert.equal(entryOf(legal, 'panel.mergeRegion')!.disabled, false);
});

test('the column item flips to "expand" once the column is folded', () => {
  // The rail only exists while the column is folded, and its right-click menu
  // is the dock-tab menu, so that menu must offer `column.expand`, not a
  // no-op "collapse" aimed at an already-collapsed column.
  const folded = { ...base, paneColumnCollapsed: true };
  assert.equal(idsOf(buildDockTabMenu(t, folded)).at(-1), 'column.expand');
  assert.equal(entryOf(buildDockTabMenu(t, folded), 'column.expand')!.label, 'Expand sidebar');
  assert.equal(idsOf(buildPanelMenu(t, folded)).at(-1), 'column.expand');

  assert.equal(idsOf(buildDockTabMenu(t, base)).at(-1), 'column.collapse');
  assert.equal(entryOf(buildDockTabMenu(t, base), 'column.collapse')!.label, 'Collapse sidebar');
});

test('toolbar icons each get their own menu', () => {
  const left = idsOf(buildToolbarActionsMenu('left', t, base));
  const right = idsOf(buildToolbarActionsMenu('right', t, base));
  const exported = idsOf(buildToolbarActionsMenu('export', t, base));
  const more = idsOf(buildToolbarActionsMenu('more', t, base));

  assert.deepEqual(left, ['view.toggleFileTree', 'view.toggleRightSidebar', 'view.toggleToolbar']);
  assert.deepEqual(right, ['view.toggleRightSidebar', 'view.toggleFileTree', 'view.toggleToolbar']);
  assert.deepEqual(exported, ['export.html', 'export.docx', 'export.pdfPrint', 'export.pdf', 'export.image', 'export.copyMd']);
  assert.deepEqual(more, [
    'view.toggleFocusMode',
    'view.toggleTypewriter',
    'view.toggleWrap',
    'view.toggleLineNumbers',
    'view.toggleToolbar',
  ]);
  assert.notDeepEqual(left, right);
  for (const ids of [left, right, exported, more]) assert.ok(!(ids as string[]).includes('panel.close'));
});

test('check marks follow the live state', () => {
  const nodes = buildToolbarActionsMenu('more', t, {
    ...base,
    focusMode: true,
    typewriter: true,
    wordWrap: false,
    lineNumbers: true,
    toolbarHidden: true,
  });
  assert.equal(entryOf(nodes, 'view.toggleFocusMode')!.checked, true);
  assert.equal(entryOf(nodes, 'view.toggleTypewriter')!.checked, true);
  assert.equal(entryOf(nodes, 'view.toggleWrap')!.checked, false);
  assert.equal(entryOf(nodes, 'view.toggleLineNumbers')!.checked, true);
  assert.equal(entryOf(nodes, 'view.toggleToolbar')!.checked, false);
});

test('tab strip blank offers "start something", never tab close items', () => {
  const nodes = buildTabStripMenu(t);
  assert.deepEqual(idsOf(nodes), ['file.new', 'file.open', 'file.openFolder', 'tab.reopenClosed']);
  assert.ok(!idsOf(nodes).some((id) => id.startsWith('tab.close') || id === 'tab.pin'));
});

test('column edge collapses/expands and toggles only its own side', () => {
  const collapsedLeft = idsOf(buildColumnEdgeMenu(t, 'left', true, base));
  assert.deepEqual(collapsedLeft, ['column.expand', 'view.toggleFileTree']);

  const openRight = idsOf(buildColumnEdgeMenu(t, 'right', false, base));
  assert.deepEqual(openRight, ['column.collapse', 'view.toggleRightSidebar']);
});

test('the eight surfaces do not share one menu with a different title', () => {
  const surfaces: Record<string, string[]> = {
    panel: idsOf(buildPanelMenu(t, base)),
    dockTab: idsOf(buildDockTabMenu(t, base)),
    toolbarLeft: idsOf(buildToolbarActionsMenu('left', t, base)),
    toolbarRight: idsOf(buildToolbarActionsMenu('right', t, base)),
    toolbarExport: idsOf(buildToolbarActionsMenu('export', t, base)),
    toolbarMore: idsOf(buildToolbarActionsMenu('more', t, base)),
    tabStrip: idsOf(buildTabStripMenu(t)),
    columnEdge: idsOf(buildColumnEdgeMenu(t, 'left', false, base)),
  };
  const names = Object.keys(surfaces);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.notDeepEqual(surfaces[names[i]], surfaces[names[j]], `${names[i]} vs ${names[j]}`);
    }
  }
});

test('every menu item maps to a command the app already dispatches', () => {
  const menuCtx: MenuContext = {
    t,
    overrides: {},
    platform: 'windows',
    macKeys: false,
    recent: [],
    themes: [{ value: 'light', label: 'Light' }],
    state: {
      autoSave: false, viewMode: 'edit', focusMode: false, typewriter: false, spellCheck: true,
      livePreview: true, fitWidth: false, dark: false, theme: 'light',
      wordWrap: true, lineNumbers: false, autoGit: false,
      panes: {
        outline: true, inspector: false, backlinks: false, relationships: false, neighborhood: false,
        tags: false, tasks: false, types: false, history: false, savedViews: false, agent: false,
      },
    },
    aiAvailable: true,
    updateCheckAvailable: true,
    gitAvailable: true,
  };
  const walk = (nodes: MenuNode[], out: MenuNode[] = []) => {
    for (const n of nodes) {
      out.push(n);
      if (n.type === 'submenu') walk(n.items, out);
    }
    return out;
  };
  const appIds = new Set(
    (buildAppMenu(menuCtx) as TopMenu[])
      .flatMap((m) => walk(m.items))
      .filter((n) => n.type === 'item')
      .map((n) => (n as { id: string }).id),
  );
  // Dock actions are settings methods, not app-menu entries.
  const dockIds = new Set([
    'panel.open', 'panel.close', 'panel.moveLeft', 'panel.moveRight', 'panel.manage',
    'panel.splitRegion', 'panel.mergeRegion', 'column.collapse', 'column.expand',
  ]);
  const all = [
    ...idsOf(buildPanelMenu(t, base)),
    ...idsOf(buildDockTabMenu(t, base)),
    ...idsOf(buildToolbarActionsMenu('left', t, base)),
    ...idsOf(buildToolbarActionsMenu('right', t, base)),
    ...idsOf(buildToolbarActionsMenu('export', t, base)),
    ...idsOf(buildToolbarActionsMenu('more', t, base)),
    ...idsOf(buildTabStripMenu(t)),
    ...idsOf(buildColumnEdgeMenu(t, 'left', false, base)),
  ];
  for (const id of all) assert.ok(appIds.has(id) || dockIds.has(id), `no command for ${id}`);
});

test('all 15 locales carry the panelMenu strings', () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const localized = strictT(dict, lang);
    for (const nodes of [
      buildPanelMenu(localized, base),
      buildDockTabMenu(localized, base),
      buildToolbarActionsMenu('left', localized, base),
      buildToolbarActionsMenu('right', localized, base),
      buildToolbarActionsMenu('export', localized, base),
      buildToolbarActionsMenu('more', localized, base),
      buildTabStripMenu(localized),
      buildColumnEdgeMenu(localized, 'left', false, base),
      buildColumnEdgeMenu(localized, 'right', true, base),
    ]) {
      for (const n of nodes) {
        if ('sep' in n) continue;
        assert.ok(n.label.length > 0, `${lang}: empty label for ${n.id}`);
      }
    }
  }
});
