import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCaptureTokens,
  capturePreview,
  captureTargetPath,
  expandCaptureTemplate,
  insertCaptureSnippet,
  newCapturePreset,
  normalizeCapturePresets,
} from './capture';
import { defaultPeriodicConfig } from './periodic-notes';

const DAY = new Date(2026, 10, 10, 9, 5);

test('variables expand and unknown names survive', () => {
  const text = expandCaptureTemplate(
    '{{date}} {{time}} {{title}} {{selection}}|{{clipboard}}|{{input}}|{{nope}}',
    { date: DAY, selection: 's', clipboard: 'c', input: 'i' },
  );
  assert.equal(text, '2026-11-10 09:05 2026-11-10 s|c|i|{{nope}}');
});

test('auto tokens only touch the first task line and never duplicate', () => {
  const snippet = '前言\n- [ ] 写周报\n- [ ] 第二条';
  const once = applyCaptureTokens(snippet, DAY, true, true);
  assert.equal(once, '前言\n- [ ] 写周报 ➕ 2026-11-10 📅 2026-11-10\n- [ ] 第二条');
  assert.equal(applyCaptureTokens(once, DAY, true, true), once);
});

test('no task line means no token is added', () => {
  assert.equal(applyCaptureTokens('- 普通条目', DAY, true, true), '- 普通条目');
});

test('insert at bottom keeps existing bytes and one trailing newline', () => {
  assert.equal(insertCaptureSnippet('旧内容\n', '- [ ] 新', 'bottom'), '旧内容\n- [ ] 新\n');
  assert.equal(insertCaptureSnippet('旧内容', '- [ ] 新', 'bottom'), '旧内容\n- [ ] 新\n');
});

test('insert at top goes after the frontmatter, not before it', () => {
  const note = '---\ntitle: x\n---\n\n正文\n';
  assert.equal(
    insertCaptureSnippet(note, '- [ ] 新', 'top'),
    '---\ntitle: x\n---\n\n- [ ] 新\n\n正文\n',
  );
});

test('insert after a heading lands right below it, creating it when missing', () => {
  const note = '# 日记\n\n## 任务\n\n- [ ] 旧\n\n## 其他\n';
  assert.equal(
    insertCaptureSnippet(note, '- [ ] 新', 'heading', '## 任务'),
    '# 日记\n\n## 任务\n\n- [ ] 新\n\n- [ ] 旧\n\n## 其他\n',
  );
  assert.equal(
    insertCaptureSnippet('# 日记\n', '- [ ] 新', 'heading', '## 任务'),
    '# 日记\n\n## 任务\n\n- [ ] 新\n',
  );
});

test('targets resolve for file, folder and periodic presets', () => {
  const config = defaultPeriodicConfig();
  const root = '/w';
  const file = { ...newCapturePreset('a', 'A'), target: 'file' as const, path: 'Inbox.md' };
  assert.equal(captureTargetPath(file, root, config, 1, DAY), '/w/Inbox.md');

  const folder = {
    ...newCapturePreset('b', 'B'),
    target: 'folder' as const,
    path: 'Notes',
    fileName: 'YYYY-MM-DD.md',
  };
  assert.equal(captureTargetPath(folder, root, config, 1, DAY), '/w/Notes/2026-11-10.md');

  const periodic = {
    ...newCapturePreset('c', 'C'),
    target: 'periodic' as const,
    period: 'weekly' as const,
  };
  assert.equal(captureTargetPath(periodic, root, config, 1, DAY), '/w/Weekly/2026-W46.md');
});

test('preview applies variables and automatic tokens together', () => {
  const preset = {
    ...newCapturePreset('p', 'P'),
    template: '- [ ] {{input}}',
    autoCreated: true,
  };
  assert.equal(capturePreview(preset, { date: DAY, input: '买牛奶' }), '- [ ] 买牛奶 ➕ 2026-11-10');
});

test('a hand-edited settings blob is filtered instead of trusted', () => {
  const list = normalizeCapturePresets([
    { id: 'a', name: 'A', target: 'nope', placement: 'sideways', template: 3 },
    { id: 'a', name: 'dup' },
    { id: '', name: 'no id' },
    null,
    'text',
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].name, 'A');
  assert.equal(list[0].target, 'file');
  assert.equal(list[0].placement, 'bottom');
  assert.equal(list[0].template, '- [ ] {{input}}');
});
