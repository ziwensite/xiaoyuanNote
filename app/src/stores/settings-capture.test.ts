/**
 * Capture preset defaults and HTTP endpoint settings are user data: an older
 * blob must keep the built-in presets, and endpoint choices must survive a
 * restart (the Rust state itself is memory-only).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.window = {
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  localStorage: g.localStorage,
};
if (!g.navigator) g.navigator = { userAgent: 'node', language: 'en-US', platform: 'MacIntel' };

const { createPinia, setActivePinia } = await import('pinia');
const { useSettingsStore } = await import('./settings');
const LS_KEY = 'xiaoyuan-note.settings.v1';

function fresh() {
  setActivePinia(createPinia());
  return useSettingsStore();
}

beforeEach(() => store.clear());

test('a fresh install ships flash / record / task / inbox presets', () => {
  const settings = fresh();
  assert.deepEqual(
    settings.captures.map((p) => p.id),
    ['flash', 'record', 'task', 'inbox'],
  );
  assert.equal(settings.quickCapturePresetId, 'flash');
  assert.equal(settings.capturesEnabled, true);
  assert.equal(settings.captureEndpointEnabled, false);
  assert.equal(settings.inboxFolder, 'inbox');
  assert.equal(settings.httpCapturePresetId, 'inbox');
});

test('an old blob with an empty captures array is reseeded once', () => {
  store.set(LS_KEY, JSON.stringify({ captures: [], captureEndpointEnabled: false }));
  const settings = fresh();
  assert.deepEqual(
    settings.captures.map((p) => p.id),
    ['flash', 'record', 'task', 'inbox'],
  );
  settings.resetCaptureDefaults();
  assert.equal(settings.capturePresetsMigrated, true);
  const saved = JSON.parse(store.get(LS_KEY)!);
  assert.equal(saved.capturePresetsMigrated, true);
});

test('an older blob without captures keeps the built-in presets', () => {
  store.set(LS_KEY, JSON.stringify({ theme: 'dark' }));
  const settings = fresh();
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(
    settings.captures.map((p) => p.id),
    ['flash', 'record', 'task', 'inbox'],
  );
});

test('malformed capture fields do not survive a load', () => {
  store.set(LS_KEY, JSON.stringify({
    captures: [{
      id: 'custom',
      name: 'Custom',
      enabled: false,
      inputMethod: 'multi-line',
      createIfMissing: false,
      appendLink: true,
      target: 'active',
    }],
  }));
  const settings = fresh();
  assert.equal(settings.captures.length, 2);
  assert.equal(settings.captures[0].id, 'flash');
  const preset = settings.captures[1];
  assert.equal(preset.enabled, false);
  assert.equal(preset.inputMethod, 'multi-line');
  assert.equal(preset.createIfMissing, false);
  assert.equal(preset.appendLink, true);
  assert.equal(preset.target, 'active');
});

test('the old endpoint inbox folder migrates into the inbox pointer', () => {
  store.set(LS_KEY, JSON.stringify({ captureEndpointInbox: '/clipped/' }));
  const settings = fresh();
  assert.equal(settings.inboxFolder, 'clipped');
});

test('capture endpoint choices persist', () => {
  const settings = fresh();
  settings.setCaptureEndpointEnabled(true);
  settings.setInboxFolder(' clipped/ ');
  assert.equal(settings.captureEndpointEnabled, true);
  assert.equal(settings.inboxFolder, 'clipped');
  settings.setHttpCapturePreset('task');
  assert.equal(settings.httpCapturePresetId, 'inbox', 'periodic presets cannot define an HTTP path');
  settings.setHttpCapturePreset('flash');
  assert.equal(settings.httpCapturePresetId, 'flash');
  const saved = JSON.parse(store.get(LS_KEY)!);
  assert.equal(saved.captureEndpointEnabled, true);
  assert.equal(saved.inboxFolder, 'clipped');
  assert.equal(saved.httpCapturePresetId, 'flash');
});

test('capture presets can be reordered and duplicated', () => {
  const settings = fresh();
  const first = settings.captures[1].id;
  settings.moveCapture(first, 1);
  assert.equal(settings.captures[2].id, first);
  settings.duplicateCapture(first);
  assert.equal(settings.captures.length, 5);
  assert.equal(settings.captures[4].name, '记录 副本');
  assert.notEqual(settings.captures[4].id, first);
});

test('the built-in flash preset cannot be removed but can be disabled', () => {
  const settings = fresh();
  assert.equal(settings.captures[0].id, 'flash');
  settings.removeCapture('flash');
  assert.ok(settings.captures.some((preset) => preset.id === 'flash' && preset.builtIn));
  settings.updateCapture('flash', { enabled: false });
  assert.equal(settings.captures.find((preset) => preset.id === 'flash')?.enabled, false);

  settings.setQuickCapturePreset('task');
  assert.equal(settings.quickCapturePresetId, 'task');
  // `active` presets are valid commands but not global-hotkey targets.
  settings.addCapture({
    ...settings.captures[0],
    id: 'custom-active',
    name: 'Custom active',
    builtIn: false,
    target: 'active',
  });
  settings.setQuickCapturePreset('custom-active');
  assert.equal(settings.quickCapturePresetId, 'task');
});

test('an old quick preset and hotkey are migrated into flash', () => {
  store.set(LS_KEY, JSON.stringify({
    captures: [
      { id: 'quick', name: '快速捕获', target: 'inbox', builtIn: true },
      { id: 'flash', name: '闪念', target: 'periodic', period: 'flash', builtIn: true },
    ],
    quickCapturePresetId: 'quick',
  }));
  const settings = fresh();
  assert.ok(!settings.captures.some((preset) => preset.id === 'quick'));
  assert.ok(settings.captures.some((preset) => preset.id === 'flash' && preset.builtIn));
  assert.equal(settings.quickCapturePresetId, 'flash');
});

test('removing a capture preset also removes its shortcut binding', () => {
  const settings = fresh();
  settings.addCapture({
    ...settings.captures[1],
    id: 'temporary',
    name: 'Temporary',
    builtIn: false,
  });
  settings.setKeybinding('capture.preset.temporary', 'F12');
  assert.equal(settings.keybindings['capture.preset.temporary'], 'F12');
  settings.removeCapture('temporary');
  assert.equal(settings.keybindings['capture.preset.temporary'], undefined);
});
