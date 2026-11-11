import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EDITOR_KINDS,
  isFileTab,
  normalizeWebUrl,
  resolveTabInput,
  singletonKeyOf,
} from './editor-input.ts';
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

test('isFileTab treats a missing or unknown kind as a file', () => {
  assert.equal(isFileTab(tab()), true);
  assert.equal(isFileTab(tab({ kind: 'file' })), true);
  assert.equal(isFileTab(tab({ kind: 'settings' })), false);
  assert.equal(isFileTab(tab({ kind: 'nope' as never })), true);
});

test('resolveTabInput maps a file tab to its id only', () => {
  assert.deepEqual(resolveTabInput(tab({ content: 'body' })), { kind: 'file', tabId: 't1' });
});

test('resolveTabInput round-trips calendar arguments', () => {
  const input = { date: '2026-11-11', view: 'week' };
  assert.deepEqual(resolveTabInput(tab({ kind: 'calendar', input })), {
    kind: 'calendar',
    tabId: 't1',
    args: input,
  });
});

test('resolveTabInput falls back to a file input for invalid virtual payloads', () => {
  assert.deepEqual(resolveTabInput(tab({ kind: 'calendar', input: { date: '11/11/2026' } })), {
    kind: 'file',
    tabId: 't1',
  });
  assert.deepEqual(resolveTabInput(tab({ kind: 'calendar' })), { kind: 'file', tabId: 't1' });
  assert.deepEqual(resolveTabInput(tab({ kind: 'search', input: { query: '   ' } })), {
    kind: 'file',
    tabId: 't1',
  });
  assert.deepEqual(resolveTabInput(tab({ kind: 'web', input: { url: 'http://a.com' } })), {
    kind: 'file',
    tabId: 't1',
  });
});

test('resolveTabInput defaults an unknown calendar view to month', () => {
  assert.deepEqual(
    resolveTabInput(tab({ kind: 'calendar', input: { date: '2026-11-11', view: 'year' } })),
    { kind: 'calendar', tabId: 't1', args: { date: '2026-11-11', view: 'month' } },
  );
});

test('resolveTabInput accepts settings without arguments', () => {
  assert.deepEqual(resolveTabInput(tab({ kind: 'settings' })), {
    kind: 'settings',
    tabId: 't1',
    args: {},
  });
  assert.deepEqual(
    resolveTabInput(tab({ kind: 'settings', input: { section: 'integrations' } })),
    { kind: 'settings', tabId: 't1', args: { section: 'integrations' } },
  );
});

test('resolveTabInput normalizes an https web url', () => {
  assert.deepEqual(resolveTabInput(tab({ kind: 'web', input: { url: 'https://example.com' } })), {
    kind: 'web',
    tabId: 't1',
    args: { url: 'https://example.com/' },
  });
});

test('normalizeWebUrl only accepts https', () => {
  assert.equal(normalizeWebUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeWebUrl('http://example.com'), null);
  assert.equal(normalizeWebUrl('example.com'), null);
  assert.equal(normalizeWebUrl('   '), null);
});

test('registry singleton keys match the agreed decisions', () => {
  assert.equal(EDITOR_KINDS.calendar.singleton(), 'calendar');
  assert.equal(EDITOR_KINDS.settings.singleton(), 'settings');
  assert.equal(EDITOR_KINDS.search.singleton(), 'search');
  assert.equal(EDITOR_KINDS.web.singleton, false);
});

test('singletonKeyOf returns one identity per kind, null for multi-instance kinds', () => {
  assert.equal(singletonKeyOf('calendar', { date: '2026-11-11', view: 'month' }), 'calendar');
  assert.equal(singletonKeyOf('settings', {}), 'settings');
  assert.equal(singletonKeyOf('search', { query: 'a' }), 'search');
  assert.equal(singletonKeyOf('web', { url: 'https://example.com/' }), null);
});

test('registry persistence and split policy match the agreed decisions', () => {
  assert.equal(EDITOR_KINDS.calendar.persist, 'workspace');
  assert.equal(EDITOR_KINDS.web.persist, 'workspace');
  assert.equal(EDITOR_KINDS.settings.persist, 'never');
  assert.equal(EDITOR_KINDS.search.persist, 'never');
  assert.equal(EDITOR_KINDS.settings.splittable, false);
  assert.equal(EDITOR_KINDS.search.splittable, false);
  assert.equal(EDITOR_KINDS.calendar.splittable, true);
  assert.equal(EDITOR_KINDS.web.splittable, true);
});
