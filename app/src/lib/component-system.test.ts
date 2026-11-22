import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPONENTS_DIR,
  COMPONENT_TREE_LANG,
  isValidComponentId,
  makeRoot,
  newComponentId,
  parseComponentFenceRef,
  parseComponentFile,
  serializeComponentFenceRef,
  serializeComponentFile,
} from './component-system.ts';

test('component constants and ID validation', () => {
  assert.equal(COMPONENTS_DIR, '_components');
  assert.equal(COMPONENT_TREE_LANG, 'component-tree');
  assert.ok(isValidComponentId('cmp_abc123'));
  assert.ok(isValidComponentId(newComponentId()));
  assert.ok(!isValidComponentId('abc123'));
  assert.ok(!isValidComponentId('../cmp_evil'));
  assert.ok(!isValidComponentId('cmp_a/b'));
  assert.ok(!isValidComponentId('cmp_a.md'));
});

test('parseComponentFenceRef parses id + optional name', () => {
  const a = parseComponentFenceRef('cmp_abc123 我的组件');
  assert.deepEqual(a, { kind: 'id', id: 'cmp_abc123', name: '我的组件' });
  const b = parseComponentFenceRef('cmp_xyz');
  assert.deepEqual(b, { kind: 'id', id: 'cmp_xyz', name: '' });
  const c = parseComponentFenceRef('   cmp_q1  带空格的名称  \n');
  assert.deepEqual(c, { kind: 'id', id: 'cmp_q1', name: '带空格的名称' });
});

test('parseComponentFenceRef handles empty and legacy bodies', () => {
  assert.deepEqual(parseComponentFenceRef(''), { kind: 'empty' });
  assert.deepEqual(parseComponentFenceRef('   \n  '), { kind: 'empty' });
  // Old inline YAML tree → legacy (no auto-render).
  assert.deepEqual(parseComponentFenceRef('- id: c1\n  type: callout\n  props: {}'), { kind: 'legacy' });
  assert.deepEqual(parseComponentFenceRef('type: stack\nchildren: []'), { kind: 'legacy' });
  // Non-ID single line is treated as legacy too.
  assert.equal(parseComponentFenceRef('not-an-id').kind, 'legacy');
});

test('serializeComponentFenceRef round-trips with name', () => {
  assert.equal(serializeComponentFenceRef('cmp_a1', '名称'), 'cmp_a1 名称');
  assert.equal(serializeComponentFenceRef('cmp_a1', ''), 'cmp_a1');
  assert.equal(serializeComponentFenceRef('cmp_a1', ' 多行\n名称 '), 'cmp_a1 多行 名称');
});

test('component note parse/serialize round-trips tree and name', () => {
  const root = makeRoot();
  root.children = [
    { id: 'c1', type: 'callout', props: { title: '提示', text: '内容', tone: 'warn', style: 'card' } },
  ];
  const md = serializeComponentFile({ id: 'cmp_demo', name: '演示组件', tree: root });
  assert.match(md, /^---\n/);
  assert.match(md, /kind: component/);
  assert.match(md, /id: cmp_demo/);
  assert.match(md, /name: 演示组件/);
  assert.match(md, /```component-tree\n/);

  const parsed = parseComponentFile(md);
  assert.ok(parsed);
  assert.equal(parsed.id, 'cmp_demo');
  assert.equal(parsed.name, '演示组件');
  assert.equal(parsed.tree.children?.length, 1);
  assert.equal(parsed.tree.children?.[0].type, 'callout');
  assert.equal(parsed.tree.children?.[0].props.tone, 'warn');
  assert.equal(parsed.tree.children?.[0].props.style, 'card');
});

test('parseComponentFile rejects invalid or missing id', () => {
  const bad = '---\nkind: component\nid: bad_id\nname: nope\n---\n\n```component-tree\n[]\n```\n';
  assert.equal(parseComponentFile(bad), null);
  assert.equal(parseComponentFile('no frontmatter here'), null);
});

test('serializeComponentFile rejects invalid id', () => {
  assert.throws(() => serializeComponentFile({ id: '../evil', name: 'x', tree: makeRoot() }));
});
