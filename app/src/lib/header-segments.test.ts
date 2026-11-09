import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VIEW_MODE_FOLD_THRESHOLD, shouldFoldViewModes } from './header-segments.ts';

test('view-mode picker folds strictly below 320px', () => {
  assert.equal(VIEW_MODE_FOLD_THRESHOLD, 320);
  assert.equal(shouldFoldViewModes(319), true);
  assert.equal(shouldFoldViewModes(320), false);
  assert.equal(shouldFoldViewModes(321), false);
});

test('an unmeasured middle segment is treated as wide enough', () => {
  assert.equal(shouldFoldViewModes(Number.POSITIVE_INFINITY), false);
  assert.equal(shouldFoldViewModes(Number.NaN), false);
});

test('the threshold can be overridden for a narrower header', () => {
  assert.equal(shouldFoldViewModes(400, 380), false);
  assert.equal(shouldFoldViewModes(379, 380), true);
});
