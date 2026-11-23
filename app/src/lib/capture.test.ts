import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCaptureTokens,
  captureDueDate,
  capturePreview,
  captureTargetPath,
  captureTargetRelativePath,
  composeCaptureInsert,
  defaultCapturePresets,
  effectiveCaptureTemplate,
  expandCaptureTemplate,
  insertCaptureSnippet,
  insertCaptureLine,
  insertTextAtCursor,
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

test('default presets are quick, flash, record, task and meeting only', () => {
  const defaults = defaultCapturePresets();
  assert.deepEqual(defaults.map((p) => p.id), ['quick', 'flash', 'record', 'task', 'meeting']);
  assert.ok(defaults.every((p) => p.enabled && p.createIfMissing));
  assert.equal(defaults.find((p) => p.id === 'quick')?.target, 'inbox');
  assert.equal(defaults.find((p) => p.id === 'quick')?.builtIn, true);
  assert.equal(defaults.find((p) => p.id === 'flash')?.period, 'flash');
  assert.equal(defaults.find((p) => p.id === 'meeting')?.target, 'folder');
  assert.equal(defaults.find((p) => p.id === 'meeting')?.appendLink, false);
});

test('normalization migrates the richer preset fields', () => {
  const list = normalizeCapturePresets([
    {
      id: 'x',
      name: 'X',
      description: 'custom',
      enabled: false,
      inputMethod: 'multi-line',
      createIfMissing: false,
      appendLink: true,
      target: 'active',
      path: '',
    },
  ]);
  assert.equal(list.length, 1);
  const preset = list[0];
  assert.equal(preset.description, 'custom');
  assert.equal(preset.enabled, false);
  assert.equal(preset.inputMethod, 'multi-line');
  assert.equal(preset.createIfMissing, false);
  assert.equal(preset.appendLink, true);
  assert.equal(preset.target, 'active');
});

test('extra template variables expand and unknown names survive', () => {
  const text = expandCaptureTemplate(
    '{{value}}|{{filePath}}|{{file}}|{{folder}}|{{url}}|{{tags}}|{{missing}}',
    {
      value: 'hello',
      filePath: 'Daily/2026-11-10.md',
      url: 'https://example.com',
      tags: 'a, b',
    },
  );
  assert.equal(
    text,
    'hello|Daily/2026-11-10.md|2026-11-10.md|Daily|https://example.com|a, b|{{missing}}',
  );
});

test('a folder target with no folder writes to the workspace root', () => {
  const preset = { ...newCapturePreset('inbox', 'Inbox'), target: 'folder' as const, path: '' };
  assert.equal(
    captureTargetRelativePath(preset, defaultPeriodicConfig(), 1, DAY),
    '2026-11-10.md',
  );
});

test('cursor insertion clamps to the requested line', () => {
  assert.equal(insertTextAtCursor('abc\ndef', 'X', { line: 1, col: 2 }), 'aXbc\ndef');
  assert.equal(insertTextAtCursor('abc\ndef', 'X', { line: 2, col: 99 }), 'abc\ndefX');
  assert.equal(insertTextAtCursor('abc', 'X', null), 'abcX');
});

test('active-note new-line insertion respects direction', () => {
  const text = 'one\ntwo\nthree';
  assert.equal(insertCaptureLine(text, 'X', { line: 2, col: 1 }, 'above'), 'one\nX\ntwo\nthree');
  assert.equal(insertCaptureLine(text, 'X', { line: 2, col: 1 }, 'below'), 'one\ntwo\nX\nthree');
});

test('due date options feed the automatic 📅 token', () => {
  const monday = new Date(2026, 10, 16);
  assert.equal(captureDueDate(monday, 'weekend', 0).getDay(), 6);
  assert.equal(captureDueDate(monday, 'custom', 3).getDate(), 19);
  assert.equal(captureDueDate(monday, 'monthEnd', 0).getDate(), 30);
  assert.equal(captureDueDate(monday, 'yearEnd', 0).getDate(), 31);
  const line = applyCaptureTokens('- [ ] task', monday, true, true, 'weekend', 0);
  assert.match(line, /➕ 2026-11-16/);
  assert.match(line, /📅 2026-11-21/);
});

test('heading insertion can refuse a missing heading and insert at section end', () => {
  const text = '## 任务\n- [ ] 旧\n\n### 子节\n- 细节\n\n## 其他\n';
  const refused = composeCaptureInsert(text, 'X', 'heading', '## 缺失', { createIfMissing: false });
  assert.equal(refused.inserted, false);
  assert.equal(refused.reason, 'missingHeading');
  assert.equal(refused.content, text);
  const atEnd = composeCaptureInsert(text, 'X', 'heading', '## 任务', {
    insertAtEnd: true,
    considerSubsections: true,
  });
  assert.ok(atEnd.content.indexOf('X') > atEnd.content.indexOf('- 细节'));
  assert.ok(atEnd.content.indexOf('X') < atEnd.content.indexOf('## 其他'));
});

test('a preset with formatting disabled writes only the value', () => {
  const preset = { ...newCapturePreset('plain', 'Plain'), formatEnabled: false };
  assert.equal(effectiveCaptureTemplate(preset), '{{value}}');
  assert.equal(capturePreview(preset, { value: 'hello' }), 'hello');
});
