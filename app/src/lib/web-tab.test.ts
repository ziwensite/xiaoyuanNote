import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const {
  hostOf,
  hostPreference,
  isKnownFrameBlocker,
  normalizeUrl,
  readHostPrefs,
  setHostPreference,
  WEB_TAB_PERMISSIONS,
  WEB_TAB_SANDBOX,
} = await import('./web-tab.ts');

test('only https URLs are accepted', () => {
  assert.equal(normalizeUrl('http://example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('file:///etc/passwd'), null);
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl('   '), null);
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
});

test('data/blob URLs and embedded credentials are rejected', () => {
  assert.equal(normalizeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(normalizeUrl('blob:https://example.com/0000-0000'), null);
  assert.equal(normalizeUrl('https://user:secret@example.com/'), null);
  assert.equal(normalizeUrl('https://user@example.com/'), null);
  assert.equal(normalizeUrl('https://example.com@evil.test/'), null);
  assert.equal(normalizeUrl('https://'), null);
});

test('the iframe policy is a single source of truth and cannot take over the app', () => {
  const tokens = WEB_TAB_SANDBOX.split(/\s+/);
  assert.equal(tokens.includes('allow-scripts'), true);
  assert.equal(tokens.includes('allow-same-origin'), true);
  assert.equal(tokens.includes('allow-forms'), true);
  assert.equal(tokens.includes('allow-popups'), true);
  assert.equal(tokens.includes('allow-downloads'), true);
  for (const forbidden of [
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-modals',
    'allow-orientation-lock',
    'allow-pointer-lock',
    'allow-presentation',
  ]) {
    assert.equal(tokens.includes(forbidden), false, `${forbidden} must never be granted`);
  }
  assert.equal(new Set(tokens).size, tokens.length, 'no duplicate sandbox tokens');
  assert.equal(WEB_TAB_PERMISSIONS, 'clipboard-read; clipboard-write');
});

test('host and path are normalized, not rewritten', () => {
  assert.equal(normalizeUrl('  HTTPS://Example.COM/Path '), 'https://example.com/Path');
  assert.equal(hostOf('https://WWW.Example.com/a'), 'www.example.com');
  assert.equal(hostOf('garbage'), '');
});

test('known frame blockers match the host and its subdomains only', () => {
  assert.equal(isKnownFrameBlocker('google.com'), true);
  assert.equal(isKnownFrameBlocker('www.google.com'), true);
  assert.equal(isKnownFrameBlocker('mail.google.com'), true);
  assert.equal(isKnownFrameBlocker('google.com.evil.test'), false);
  assert.equal(isKnownFrameBlocker('example.com'), false);
  assert.equal(isKnownFrameBlocker('notgoogle.com'), false);
});

test('host preference round-trips and frame is the implicit default', () => {
  mem.clear();
  assert.equal(hostPreference('example.com'), 'frame');

  setHostPreference('EXAMPLE.com', 'external');
  assert.deepEqual(readHostPrefs(), { 'example.com': 'external' });
  assert.equal(hostPreference('example.com'), 'external');

  setHostPreference('example.com', 'frame');
  assert.deepEqual(readHostPrefs(), {});
  assert.equal(hostPreference('example.com'), 'frame');
});

test('corrupt preference storage degrades to defaults', () => {
  mem.clear();
  mem.set('solomd.webTabs.v1', '{not json');
  assert.deepEqual(readHostPrefs(), {});
  assert.equal(hostPreference('example.com'), 'frame');
});
