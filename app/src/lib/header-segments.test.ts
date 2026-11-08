import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VIEW_MODE_FOLD_THRESHOLD, shouldFoldViewModes } from './header-segments.ts';

test('view-mode switch folds strictly below 470px', () => {
  assert.equal(VIEW_MODE_FOLD_THRESHOLD, 470);
  assert.equal(shouldFoldViewModes(469), true);
  assert.equal(shouldFoldViewModes(470), false);
  assert.equal(shouldFoldViewModes(471), false);
});

test('an unmeasured middle segment is treated as wide enough', () => {
  assert.equal(shouldFoldViewModes(Number.POSITIVE_INFINITY), false);
  assert.equal(shouldFoldViewModes(Number.NaN), false);
});

test('the threshold can be overridden for a narrower header', () => {
  assert.equal(shouldFoldViewModes(400, 380), false);
  assert.equal(shouldFoldViewModes(379, 380), true);
});
