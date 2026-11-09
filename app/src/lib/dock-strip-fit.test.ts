import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DOCK_ADD_W,
  DOCK_OVERFLOW_W,
  DOCK_STRIP_PAD,
  DOCK_TAB_GAP,
  DOCK_TAB_SIZE,
  dockStripLayout,
  tabsWidth,
} from './dock-strip-fit.ts';

test('tabsWidth is zero for an empty strip', () => {
  assert.equal(tabsWidth(0), 0);
});

test('tabsWidth counts one gap between tabs, not after the last one', () => {
  assert.equal(tabsWidth(1), DOCK_TAB_SIZE);
  assert.equal(tabsWidth(3), DOCK_TAB_SIZE * 3 + DOCK_TAB_GAP * 2);
});

test('dockStripLayout renders all tabs when they fit with the `+`', () => {
  // 1 tab: 8 + 24 + 2 + 24 = 58
  assert.deepEqual(dockStripLayout(1, 58), { visible: 1, overflow: false });
  // 2 tabs: 8 + 50 + 2 + 24 = 84
  assert.deepEqual(dockStripLayout(2, 84), { visible: 2, overflow: false });
});

test('dockStripLayout overflows one pixel short of fitting', () => {
  // 3 tabs without `»`: 8 + (24*3 + 2*2) + 2 + 24 = 110.
  assert.deepEqual(dockStripLayout(3, 109), { visible: 1, overflow: true });
  assert.deepEqual(dockStripLayout(3, 110), { visible: 3, overflow: false });
});

test('dockStripLayout moves at least one tab into the `»` list', () => {
  const layout = dockStripLayout(12, 300);
  assert.equal(layout.overflow, true);
  assert.ok(layout.visible < 12);
  assert.ok(layout.visible > 0);
  assert.ok(
    DOCK_STRIP_PAD +
      tabsWidth(layout.visible) +
      DOCK_TAB_GAP +
      DOCK_ADD_W +
      DOCK_TAB_GAP +
      DOCK_OVERFLOW_W <=
      300,
  );
});

test('dockStripLayout degrades to `»` + `+` only when nothing else fits', () => {
  const width = DOCK_STRIP_PAD + DOCK_ADD_W + DOCK_OVERFLOW_W + DOCK_TAB_GAP;
  assert.deepEqual(dockStripLayout(6, width), { visible: 0, overflow: true });
});

test('dockStripLayout treats an unmeasured strip as "show everything"', () => {
  assert.deepEqual(dockStripLayout(8, 0), { visible: 8, overflow: false });
});

test('dockStripLayout does not overflow an empty strip', () => {
  assert.deepEqual(dockStripLayout(0, 40), { visible: 0, overflow: false });
});
