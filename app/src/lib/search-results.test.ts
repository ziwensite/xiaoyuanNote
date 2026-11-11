import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenGroups, groupHits, moveHitSelection } from './search-results.ts';

const hit = (file: string, line: number) => ({ file, line, snippet: `line ${line}` });

test('empty results stay empty', () => {
  assert.deepEqual(groupHits([]), []);
  assert.deepEqual(flattenGroups([]), []);
});

test('groups follow first-seen file order and keep hits together', () => {
  const hits = [hit('b.md', 1), hit('a.md', 2), hit('b.md', 3), hit('a.md', 4)];
  const groups = groupHits(hits);
  assert.deepEqual(
    groups.map((g) => g.file),
    ['b.md', 'a.md'],
  );
  assert.deepEqual(
    groups[0].hits.map((h) => h.line),
    [1, 3],
  );
  assert.deepEqual(
    groups[1].hits.map((h) => h.line),
    [2, 4],
  );
});

test('flattenGroups restores the visual order across files', () => {
  const groups = groupHits([hit('a.md', 1), hit('a.md', 2), hit('b.md', 3)]);
  assert.deepEqual(
    flattenGroups(groups).map((h) => `${h.file}:${h.line}`),
    ['a.md:1', 'a.md:2', 'b.md:3'],
  );
});

test('selection moves across group boundaries and clamps at both ends', () => {
  const length = 3;
  assert.equal(moveHitSelection(0, 1, length), 1);
  assert.equal(moveHitSelection(1, 1, length), 2);
  assert.equal(moveHitSelection(2, 1, length), 2);
  assert.equal(moveHitSelection(0, -1, length), 0);
  assert.equal(moveHitSelection(0, 1, 0), 0);
});
