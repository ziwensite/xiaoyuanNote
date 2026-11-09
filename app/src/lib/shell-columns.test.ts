import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIDDLE_MIN_WIDTH,
  SIDE_LAYOUT_FLOOR,
  SIDE_MIN_WIDTH,
  shellColumnWidths,
} from './shell-columns.ts';

test('no docks: the editor owns the whole shell', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: null, right: null }), {
    left: 0,
    right: 0,
    middle: 1024,
  });
});

test('one dock is capped so the editor keeps its 360px', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: 560, right: null }), {
    left: 560,
    right: 0,
    middle: 464,
  });
  assert.deepEqual(shellColumnWidths({ shellWidth: 800, left: 560, right: null }), {
    left: 440,
    right: 0,
    middle: MIDDLE_MIN_WIDTH,
  });
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: null, right: 292 }), {
    left: 0,
    right: 292,
    middle: 732,
  });
});

test('1024 with both docks at the default width needs no clamping', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: 292, right: 292 }), {
    left: 292,
    right: 292,
    middle: 440,
  });
});

test('1024 with both docks at max splits the room evenly above the 212 floor', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: 560, right: 560 }), {
    left: 332,
    right: 332,
    middle: MIDDLE_MIN_WIDTH,
  });
});

test('1280 and 1440 scale both docks above the floor', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1280, left: 560, right: 560 }), {
    left: 460,
    right: 460,
    middle: MIDDLE_MIN_WIDTH,
  });
  assert.deepEqual(shellColumnWidths({ shellWidth: 1440, left: 560, right: 560 }), {
    left: 540,
    right: 540,
    middle: MIDDLE_MIN_WIDTH,
  });
});

test('asymmetric stored widths keep their relative excess', () => {
  // Left is at the floor, so all spare room goes to the right.
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: 212, right: 560 }), {
    left: 212,
    right: 452,
    middle: MIDDLE_MIN_WIDTH,
  });
});

test('784 is the exact point where the 212 floor still fits', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 784, left: 560, right: 560 }), {
    left: SIDE_MIN_WIDTH,
    right: SIDE_MIN_WIDTH,
    middle: MIDDLE_MIN_WIDTH,
  });
});

test('601 falls to the 120px layout floor', () => {
  const out = shellColumnWidths({ shellWidth: 601, left: 292, right: 292 });
  assert.equal(out.left + out.right, 241);
  assert.ok(out.left >= SIDE_LAYOUT_FLOOR);
  assert.ok(out.right >= SIDE_LAYOUT_FLOOR);
  assert.equal(out.middle, MIDDLE_MIN_WIDTH);
});

test('the three columns always add up to the shell width', () => {
  for (const shellWidth of [601, 700, 784, 860, 1024, 1280, 1440, 1920]) {
    for (const [left, right] of [
      [212, 212],
      [292, 292],
      [560, 560],
      [212, 560],
      [560, 212],
    ] as const) {
      const out = shellColumnWidths({ shellWidth, left, right });
      assert.equal(out.left + out.right + out.middle, shellWidth, `${shellWidth}/${left}/${right}`);
      assert.ok(out.middle >= MIDDLE_MIN_WIDTH, `${shellWidth}/${left}/${right}`);
    }
  }
});

test('invalid widths are treated as hidden rather than as zero-sized columns', () => {
  assert.deepEqual(shellColumnWidths({ shellWidth: 1024, left: NaN, right: -1 }), {
    left: 0,
    right: 0,
    middle: 1024,
  });
});
