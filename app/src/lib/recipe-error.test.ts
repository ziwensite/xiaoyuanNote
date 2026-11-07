import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDirtyWorkspaceError, parseDirtyWorkspaceError } from './recipe-error.ts';

/** Minimal stand-in for i18n `t`: renders the key plus interpolated params. */
function t(key: string, params?: Record<string, string | number>): string {
  const tail = params ? ` ${JSON.stringify(params)}` : '';
  return `${key}${tail}`;
}

test('parses the backend refusal and keeps the exact total', () => {
  const raw = 'WORKSPACE_DIRTY|3|workspace has uncommitted changes\n'
    + 'a.md\nb.md\nc.md';
  assert.deepEqual(parseDirtyWorkspaceError(raw), {
    count: 3,
    files: ['a.md', 'b.md', 'c.md'],
  });
});

test('caps the shown files but keeps the total for "+N more"', () => {
  const raw = 'WORKSPACE_DIRTY|9|hint\n'
    + ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'].join('\n');
  const text = formatDirtyWorkspaceError(raw, t);
  assert.match(text, /recipes\.acceptDirty/);
  assert.match(text, /"count":9/);
  assert.match(text, /a\.md, b\.md, c\.md, d\.md, e\.md/);
  assert.match(text, /\(\+4\)/);
  assert.equal(text.includes('f.md'), false);
});

test('leaves unrelated errors untouched', () => {
  assert.equal(
    formatDirtyWorkspaceError('git open: permission denied', t),
    'git open: permission denied',
  );
});
