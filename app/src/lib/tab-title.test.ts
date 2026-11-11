import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  displayTabTitle,
  displayTabTooltip,
  extractFirstLineTitle,
  tabTitle,
  tabTooltip,
} from './tab-title.ts';
import type { Tab } from '../types.ts';

const t = (key: string, params?: Record<string, string | number>) =>
  `${key}${params?.date ? `:${params.date}` : ''}`;

test('extractFirstLineTitle strips Markdown syntax from the first non-empty line', () => {
  assert.equal(extractFirstLineTitle('# 项目周报 2026-10\n正文内容'), '项目周报 2026-10');
  assert.equal(extractFirstLineTitle('\n\n- [ ] 待办事项第一条\n第二条'), '待办事项第一条');
  assert.equal(extractFirstLineTitle('1. **重点** ==高亮== [链接](https://solomd.app)'), '重点 高亮 链接');
});

test('extractFirstLineTitle skips YAML frontmatter and falls back to frontmatter title or fileName', () => {
  const withBody = '---\ntitle: FM Title\ntags: [a]\n---\n\n# 正文第一行\n内容';
  assert.equal(extractFirstLineTitle(withBody), '正文第一行');

  const onlyFm = '---\ntitle: "仅 Frontmatter 标题"\n---\n\n';
  assert.equal(extractFirstLineTitle(onlyFm), '仅 Frontmatter 标题');
});

test('displayTabTitle and displayTabTooltip respect the setting flag', () => {
  const tab = {
    fileName: 'tmp_9f8a7b6c.md',
    filePath: 'C:\\Temp\\tmp_9f8a7b6c.md',
    content: '会议纪要：产品需求评审\n详细内容……',
  };
  assert.equal(displayTabTitle(tab, false), 'tmp_9f8a7b6c.md');
  assert.equal(displayTabTitle(tab, true), '会议纪要：产品需求评审');
  assert.equal(displayTabTooltip(tab, false), 'C:\\Temp\\tmp_9f8a7b6c.md');
  assert.equal(displayTabTooltip(tab, true), '会议纪要：产品需求评审 — C:\\Temp\\tmp_9f8a7b6c.md');

  const emptyTab = { fileName: 'Untitled.md', filePath: null, content: '   \n  ' };
  assert.equal(displayTabTitle(emptyTab, true), 'Untitled.md');
});

test('tabTitle keeps the file rules and asks the registry for virtual tabs', () => {
  const file = {
    id: 'f1',
    fileName: 'note.md',
    filePath: '/vault/note.md',
    content: '# 标题\n正文',
    savedContent: '',
    encoding: 'UTF-8',
    language: 'markdown',
    hadBom: false,
  } as Tab;
  assert.equal(tabTitle(file, t, true), '标题');
  assert.equal(tabTooltip(file, t, true), '标题 — /vault/note.md');

  const calendar = {
    ...file,
    id: 'c1',
    kind: 'calendar',
    input: { date: '2026-11-11', view: 'month' },
  } as Tab;
  assert.equal(tabTitle(calendar, t, false), 'editorTab.calendar:11-11');
  assert.equal(tabTooltip(calendar, t, false), 'editorTab.calendar:11-11');

  const renamed = { ...calendar, title: 'Weekly review' } as Tab;
  assert.equal(tabTitle(renamed, t, false), 'Weekly review');
});
