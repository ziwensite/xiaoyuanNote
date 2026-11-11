import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isFileTabSaved, isTabDirty } from './tab-dirty.ts';
import type { Tab } from '../types.ts';

function tab(patch: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    fileName: 'a.md',
    content: '',
    savedContent: '',
    encoding: 'UTF-8',
    language: 'markdown',
    hadBom: false,
    ...patch,
  };
}

test('isTabDirty follows the buffer for file tabs', () => {
  assert.equal(isTabDirty(tab()), false);
  assert.equal(isTabDirty(tab({ content: 'edited' })), true);
});

test('isTabDirty keeps the ephemeral-untitled exemption', () => {
  assert.equal(isTabDirty(tab({ ephemeral: true, content: 'tour' })), false);
  assert.equal(
    isTabDirty(tab({ ephemeral: true, filePath: '/notes/a.md', content: 'tour' })),
    true,
  );
});

test('isTabDirty is always false for virtual tabs', () => {
  for (const kind of ['calendar', 'settings', 'search', 'web'] as const) {
    assert.equal(isTabDirty(tab({ kind, content: 'stale', savedContent: '' })), false, kind);
  }
});

test('isFileTabSaved excludes virtual tabs even when their buffers match', () => {
  assert.equal(isFileTabSaved(tab()), true);
  assert.equal(isFileTabSaved(tab({ content: 'edited' })), false);
  for (const kind of ['calendar', 'settings', 'search', 'web'] as const) {
    assert.equal(isFileTabSaved(tab({ kind })), false, kind);
  }
});

test('isFileTabSaved keeps treating an ephemeral untitled tab as saved', () => {
  assert.equal(isFileTabSaved(tab({ ephemeral: true })), true);
});
