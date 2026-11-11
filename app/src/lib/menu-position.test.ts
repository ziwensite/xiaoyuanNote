import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  placeMenu,
  placeMenuFromPoint,
  placeMenuFromRect,
  type MenuMetrics,
  type Placement,
  type ViewportBox,
} from './menu-position.ts';

const VP: ViewportBox = { left: 0, top: 0, right: 1000, bottom: 800 };
const PAD = 8;

const metrics = (width: number, height: number, extra: Partial<MenuMetrics> = {}): MenuMetrics => ({
  width,
  height,
  ...extra,
});

/** The size the menu actually draws after any cap we returned. */
function drawn(m: MenuMetrics, p: Placement): { width: number; height: number } {
  return {
    width: Math.min(m.width, p.maxWidth ?? m.maxWidth ?? m.width),
    height: Math.min(m.height, p.maxHeight ?? m.maxHeight ?? m.height),
  };
}

/**
 * The property the whole module exists for: after flipping / pinning, the
 * menu's box is inside the padded viewport. Asserted for every case instead of
 * eyeballing the coordinates.
 */
function assertInside(p: Placement, m: MenuMetrics, vp: ViewportBox = VP, pad = PAD): void {
  const size = drawn(m, p);
  assert.ok(p.left >= vp.left + pad - 0.01, `left ${p.left} < ${vp.left + pad}`);
  assert.ok(p.top >= vp.top + pad - 0.01, `top ${p.top} < ${vp.top + pad}`);
  assert.ok(
    p.left + size.width <= vp.right - pad + 0.01,
    `right ${p.left + size.width} > ${vp.right - pad}`,
  );
  assert.ok(
    p.top + size.height <= vp.bottom - pad + 0.01,
    `bottom ${p.top + size.height} > ${vp.bottom - pad}`,
  );
}

test('fits below and to the right: no flip', () => {
  const m = metrics(200, 150);
  const p = placeMenuFromPoint(100, 100, m, { viewport: VP });
  assert.equal(p.left, 100);
  assert.equal(p.top, 104);
  assert.equal(p.maxHeight, undefined);
  assert.equal(p.maxWidth, undefined);
  assertInside(p, m);
});

test('bottom-right corner flips left and up', () => {
  const m = metrics(200, 150);
  const p = placeMenuFromPoint(990, 790, m, { viewport: VP });
  assert.equal(p.left, 790);
  assert.equal(p.top, 636);
  assertInside(p, m);
});

test('a trigger near the right edge keeps its right edge after flipping', () => {
  const m = metrics(200, 100);
  const p = placeMenuFromRect({ left: 900, top: 100, right: 980, bottom: 140 }, m, {
    viewport: VP,
  });
  assert.equal(p.left, 780);
  assert.equal(p.top, 144);
  assertInside(p, m);
});

test('a trigger near the bottom flips above itself', () => {
  const m = metrics(200, 100);
  const p = placeMenuFromRect({ left: 100, top: 700, right: 300, bottom: 740 }, m, {
    viewport: VP,
  });
  assert.equal(p.left, 100);
  assert.equal(p.top, 596);
  assertInside(p, m);
});

test('a menu that exactly fits does not flip', () => {
  const m = metrics(100, 200);
  // bottom + gap + height === viewport bottom - pad
  const p = placeMenuFromRect({ left: 100, top: 100, right: 200, bottom: 588 }, m, {
    viewport: VP,
  });
  assert.equal(p.top, 592);
  assertInside(p, m);
});

test('taller than both sides: pin to the larger side and cap the height', () => {
  const m = metrics(200, 700);
  const p = placeMenuFromPoint(500, 400, m, { viewport: VP });
  assert.equal(p.maxHeight, 388);
  assert.equal(p.top, 404);
  assertInside(p, m);
});

test("a smaller CSS max-height is never widened by the placement", () => {
  const m = metrics(100, 1000, { maxHeight: 300 });
  const p = placeMenuFromPoint(10, 700, m, { viewport: VP });
  // CSS already clips to 300, which fits the 688px of room: no inline cap.
  assert.equal(p.maxHeight, undefined);
  assertInside(p, m);
});

test('a CSS cap larger than the room is tightened', () => {
  const m = metrics(100, 1000, { maxHeight: 900 });
  const p = placeMenuFromPoint(10, 400, m, { viewport: VP });
  assert.equal(p.maxHeight, 388);
  assertInside(p, m);
});

test('wider than a 320px viewport: pin to the pad and cap the width', () => {
  const vp: ViewportBox = { left: 0, top: 0, right: 320, bottom: 600 };
  const m = metrics(400, 100);
  const p = placeMenuFromPoint(300, 100, m, { viewport: vp });
  assert.equal(p.maxWidth, 304);
  assert.equal(p.left, 8);
  assertInside(p, m, vp);
});

test('a CSS max-width smaller than the viewport is not overridden', () => {
  const vp: ViewportBox = { left: 0, top: 0, right: 320, bottom: 600 };
  const m = metrics(400, 100, { maxWidth: 300 });
  const p = placeMenuFromPoint(300, 100, m, { viewport: vp });
  assert.equal(p.maxWidth, undefined);
  assertInside(p, m, vp);
});

test('an offset viewport (visualViewport origin) is respected', () => {
  const vp: ViewportBox = { left: 200, top: 100, right: 900, bottom: 700 };
  const m = metrics(200, 100);
  const p = placeMenuFromPoint(150, 50, m, { viewport: vp });
  assert.equal(p.left, 208);
  assert.equal(p.top, 108);
  assertInside(p, m, vp);
});

test('every placement stays inside its own viewport', () => {
  const viewports: ViewportBox[] = [
    VP,
    { left: 0, top: 0, right: 320, bottom: 480 },
    { left: -400, top: 0, right: 0, bottom: 800 },
    { left: 100, top: 50, right: 500, bottom: 300 },
  ];
  const sizes = [metrics(120, 80), metrics(320, 240), metrics(900, 900), metrics(40, 1200)];
  for (const vp of viewports) {
    for (const m of sizes) {
      for (const [x, y] of [
        [vp.left + 2, vp.top + 2],
        [vp.right - 2, vp.bottom - 2],
        [(vp.left + vp.right) / 2, (vp.top + vp.bottom) / 2],
        [vp.right + 200, vp.bottom + 200],
      ]) {
        assertInside(placeMenuFromPoint(x, y, m, { viewport: vp }), m, vp);
      }
    }
  }
});
