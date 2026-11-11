/**
 * P5 of `editor-input-tabs`: the child-webview experiment was evaluated and
 * not shipped, so `webTabEngine` must always resolve to the iframe route —
 * including for settings blobs written by an experimental build.
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
  matchMedia: () => ({ get matches() { return false; }, addEventListener: () => {} }),
  localStorage: g.localStorage,
};
if (!g.navigator) g.navigator = { userAgent: 'node', language: 'en-US', platform: 'MacIntel' };

const { createPinia, setActivePinia } = await import('pinia');
const { useSettingsStore } = await import('./settings');
const LS_KEY = 'solomd.settings.v1';

function fresh() {
  setActivePinia(createPinia());
  return useSettingsStore();
}

beforeEach(() => {
  store.clear();
});

test('a new install uses the iframe engine', () => {
  assert.equal(fresh().webTabEngine, 'iframe');
});

test('an experimental or tampered persisted engine falls back to iframe', () => {
  for (const saved of ['webview', 'banana', 42, null]) {
    store.set(LS_KEY, JSON.stringify({ webTabEngine: saved }));
    assert.equal(fresh().webTabEngine, 'iframe', `saved=${JSON.stringify(saved)}`);
  }
});

test('the converged value is what gets persisted', () => {
  store.set(LS_KEY, JSON.stringify({ webTabEngine: 'webview' }));
  const s = fresh();
  s.setTheme('dracula');
  assert.equal(JSON.parse(store.get(LS_KEY)!).webTabEngine, 'iframe');
});
