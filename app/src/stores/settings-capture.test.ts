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

test('a fresh install ships quick / flash / record / task / meeting presets', () => {
  const settings = fresh();
  assert.deepEqual(
    settings.captures.map((p) => p.id),
    ['quick', 'flash', 'record', 'task', 'meeting'],
  );
  assert.equal(settings.quickCapturePresetId, 'quick');
  assert.equal(settings.capturesEnabled, true);
  assert.equal(settings.captureEndpointEnabled, false);
  assert.equal(settings.captureEndpointInbox, 'inbox');
});

test('an old blob with an empty captures array is reseeded once', () => {
  store.set(LS_KEY, JSON.stringify({ captures: [], captureEndpointEnabled: false }));
  const settings = fresh();
  assert.deepEqual(
    settings.captures.map((p) => p.id),
    ['quick', 'flash', 'record', 'task', 'meeting'],
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
    ['quick', 'flash', 'record', 'task', 'meeting'],
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
  assert.equal(settings.captures[0].id, 'quick');
  const preset = settings.captures[1];
  assert.equal(preset.enabled, false);
  assert.equal(preset.inputMethod, 'multi-line');
  assert.equal(preset.createIfMissing, false);
  assert.equal(preset.appendLink, true);
  assert.equal(preset.target, 'active');
});

test('capture endpoint choices persist', () => {
  const settings = fresh();
  settings.setCaptureEndpointEnabled(true);
  settings.setCaptureEndpointInbox(' clipped/ ');
  assert.equal(settings.captureEndpointEnabled, true);
  assert.equal(settings.captureEndpointInbox, 'clipped');
  const saved = JSON.parse(store.get(LS_KEY)!);
  assert.equal(saved.captureEndpointEnabled, true);
  assert.equal(saved.captureEndpointInbox, 'clipped');
});

test('capture presets can be reordered and duplicated', () => {
  const settings = fresh();
  const first = settings.captures[1].id;
  settings.moveCapture(first, 1);
  assert.equal(settings.captures[2].id, first);
  settings.duplicateCapture(first);
  assert.equal(settings.captures.length, 6);
  assert.equal(settings.captures[5].name, '闪念 副本');
  assert.notEqual(settings.captures[5].id, first);
});

test('the built-in quick preset cannot be removed and stays a valid hotkey target', () => {
  const settings = fresh();
  settings.setQuickCapturePreset('task');
  assert.equal(settings.quickCapturePresetId, 'task');
  settings.removeCapture('quick');
  assert.ok(settings.captures.some((preset) => preset.id === 'quick' && preset.builtIn));
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
