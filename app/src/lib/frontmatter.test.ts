/**
 * Fidelity tests for the text-level frontmatter patch.
 *
 * Run from `app/`: `pnpm test` (node --test + type stripping).
 *
 * The contract pinned here:
 *   1. Only the keys named in the patch change; every other byte of the block
 *      (comments, key order, quote style, inline arrays, indentation, blank
 *      lines, trailing spaces, CRLF) survives verbatim.
 *   2. The body is never touched.
 *   3. Unpatchable blocks throw instead of silently discarding content.
 *   4. An unparseable block is repaired whole and reported, never silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FrontmatterPatchError,
  patchFrontmatter,
  patchFrontmatterWithReport,
  splitFrontmatter,
} from './frontmatter';

/** The raw text between the fences (fences excluded), newlines as-is. */
const blockOf = (s: string): string => {
  const bom = s.startsWith('\uFEFF') ? 1 : 0;
  const rest = s.slice(bom);
  assert.ok(rest.startsWith('---\n') || rest.startsWith('---\r\n'), `no block:\n${s}`);
  const openLen = rest.startsWith('---\r\n') ? 5 : 4;
  const body = rest.slice(openLen);
  const close = body.search(/\r?\n---(?:\r?\n|$)/);
  assert.ok(close >= 0, `unclosed block:\n${s}`);
  return body.slice(0, close);
};

/** The body after the closing fence line. */
const bodyOf = (s: string): string => {
  const bom = s.startsWith('\uFEFF') ? 1 : 0;
  const rest = s.slice(bom);
  const openLen = rest.startsWith('---\r\n') ? 5 : 4;
  const tail = rest.slice(openLen);
  const m = /\r?\n---(\r?\n|$)/.exec(tail);
  assert.ok(m, `unclosed block:\n${s}`);
  return tail.slice(m.index + m[0].length);
};

test('an untouched line keeps its inline comment, order and quote style', () => {
  const src = [
    '---',
    '# top comment',
    'title: x  # inline note',
    'tags: [a, b] # tags comment',
    "name: 'O''Brien: special'",
    'status: draft',
    '---',
    'body',
    '',
  ].join('\n');
  const out = patchFrontmatter(src, { status: 'done' });
  assert.equal(
    blockOf(out),
    [
      '# top comment',
      'title: x  # inline note',
      'tags: [a, b] # tags comment',
      "name: 'O''Brien: special'",
      'status: done',
    ].join('\n'),
  );
  assert.equal(bodyOf(out), 'body\n');
});

test('updating keeps key order; a new key is appended at the end', () => {
  const src = '---\ntitle: A\nstatus: draft\n---\nbody\n';
  const out = patchFrontmatter(src, { status: 'done', priority: 3 });
  assert.equal(blockOf(out), 'title: A\nstatus: done\npriority: 3');
  assert.equal(bodyOf(out), 'body\n');
});

test('CRLF survives in both the block and the body', () => {
  const src = '---\r\ntitle: x\r\nstatus: draft\r\n---\r\nbody line\r\n';
  const out = patchFrontmatter(src, { status: 'done' });
  assert.ok(out.startsWith('---\r\n'));
  assert.equal(blockOf(out), 'title: x\r\nstatus: done');
  assert.ok(out.endsWith('body line\r\n'));
  // No lone LF was introduced.
  assert.equal(out.replace(/\r\n/g, ''), out.replace(/\r\n/g, '').replace(/\n/g, ''));
});

test('a file without frontmatter gets one at the top, body intact', () => {
  const out = patchFrontmatter('# My Note\n\nBody text.\n', { type: 'note' });
  assert.equal(out, '---\ntype: note\n---\n\n# My Note\n\nBody text.\n');
});

test('an empty frontmatter block is filled in place, not duplicated', () => {
  const src = '---\n---\nbody\n';
  const doc = splitFrontmatter(src);
  assert.equal(doc.hadBlock, true);
  assert.deepEqual(doc.data, {});
  const out = patchFrontmatter(src, { type: 'note' });
  assert.equal(out, '---\ntype: note\n---\nbody\n');
});

test('a block scalar neighbour is left verbatim; editing it replaces only its lines', () => {
  const src = [
    '---',
    'title: x',
    'note: |',
    '  line one',
    '  line two',
    'status: draft',
    '---',
    'body',
    '',
  ].join('\n');

  const untouched = patchFrontmatter(src, { status: 'done' });
  assert.equal(
    blockOf(untouched),
    ['title: x', 'note: |', '  line one', '  line two', 'status: done'].join('\n'),
  );

  const replaced = patchFrontmatter(src, { note: 'single line' });
  assert.equal(blockOf(replaced), 'title: x\nnote: single line\nstatus: draft');
  assert.equal(bodyOf(replaced), 'body\n');
});

test('a block scalar with an internal blank line stays one key', () => {
  const src = ['---', 'note: |', '  a', '', '  b', 'status: x', '---', 'body', ''].join('\n');
  const out = patchFrontmatter(src, { status: 'done' });
  assert.equal(blockOf(out), ['note: |', '  a', '', '  b', 'status: done'].join('\n'));
});

test('a value containing # round-trips as one scalar', () => {
  const src = '---\ntitle: x\n---\nbody\n';
  const out = patchFrontmatter(src, { note: '#tag: value here' });
  const doc = splitFrontmatter(out);
  assert.equal(doc.data.note, '#tag: value here');
  assert.equal(bodyOf(out), 'body\n');
});

test('nested keys are one span: editing the parent replaces only it', () => {
  const src = [
    '---',
    'meta:',
    '  owner: me',
    '  tags: [x]',
    'status: draft',
    '---',
    'body',
    '',
  ].join('\n');

  const neighbour = patchFrontmatter(src, { status: 'done' });
  assert.equal(
    blockOf(neighbour),
    ['meta:', '  owner: me', '  tags: [x]', 'status: done'].join('\n'),
  );

  const parent = patchFrontmatter(src, { meta: { owner: 'you' } });
  assert.equal(blockOf(parent), 'meta:\n  owner: you\nstatus: draft');
});

test('duplicate keys refuse the patch instead of picking one', () => {
  const src = '---\na: 1\na: 2\n---\nbody\n';
  assert.throws(() => patchFrontmatter(src, { a: 3 }), (err: unknown) => {
    assert.ok(err instanceof FrontmatterPatchError);
    assert.match(err.message, /duplicate frontmatter key "a"/);
    return true;
  });
});

test('an unparseable block is repaired whole and reported, body kept', () => {
  const src = '---\n: : :\n---\nbody\n';
  const report = patchFrontmatterWithReport(src, { type: 'note' });
  assert.deepEqual(report.degraded, { reason: 'invalid-yaml' });
  assert.equal(report.text, '---\ntype: note\n---\nbody\n');
  // The throwing-free wrapper still succeeds.
  assert.equal(patchFrontmatter(src, { type: 'note' }), report.text);
});

test('a non-mapping root refuses the patch', () => {
  const src = '---\n- one\n- two\n---\nbody\n';
  assert.throws(() => patchFrontmatter(src, { type: 'note' }), FrontmatterPatchError);
});

test('deleting a key removes only its lines; deleting the last drops the block', () => {
  const src = '---\na: 1\nb: 2\nc: 3\n---\nbody\n';
  assert.equal(blockOf(patchFrontmatter(src, { b: undefined })), 'a: 1\nc: 3');

  const last = patchFrontmatter('---\nonly: value\n---\n\n# Body\n', { only: undefined });
  assert.equal(last, '\n# Body\n');
  assert.equal(splitFrontmatter(last).hadBlock, false);
});

test('deleting the last key keeps comments that remain in the block', () => {
  const src = '---\na: 1\n# keep me\n---\nbody\n';
  const out = patchFrontmatter(src, { a: undefined });
  assert.equal(blockOf(out), '# keep me');
  assert.equal(bodyOf(out), 'body\n');
});

test('BOM, trailing spaces and blank lines survive a patch', () => {
  const src = '\uFEFF---\ntitle: x   \n\nstatus: draft\n\n---\nbody\n';
  const out = patchFrontmatter(src, { status: 'done' });
  assert.ok(out.startsWith('\uFEFF---\n'));
  assert.equal(blockOf(out), 'title: x   \n\nstatus: done\n');
  assert.equal(bodyOf(out), 'body\n');
});

test('patching a missing key to undefined is a no-op', () => {
  const src = '---\na: 1\n---\nbody\n';
  assert.equal(patchFrontmatter(src, { zzz: undefined }), src);
});

test('an anchored key cannot be deleted while an alias points at it', () => {
  const src = '---\nbase: &b\n  x: 1\ncopy: *b\n---\nbody\n';
  assert.throws(() => patchFrontmatter(src, { base: undefined }), (err: unknown) => {
    assert.ok(err instanceof FrontmatterPatchError);
    assert.match(err.message, /aliased/);
    return true;
  });
  // Removing the alias itself is fine and leaves the anchor untouched.
  assert.equal(blockOf(patchFrontmatter(src, { copy: undefined })), 'base: &b\n  x: 1');
});

test('flow collections and multi-key patches keep neighbours verbatim', () => {
  const src = '---\na: [1, 2]\nmeta: {k: v}\nb: 2\n---\nbody\n';
  const out = patchFrontmatter(src, { a: ['x'], b: 3, extra: true });
  // The edited array is re-rendered by js-yaml (block style); every neighbour
  // keeps its flow spelling exactly.
  assert.equal(blockOf(out), 'a:\n  - x\nmeta: {k: v}\nb: 3\nextra: true');
});
