/**
 * Virtual editor inputs: singleton reuse, session-only persistence and the
 * hydration rules that keep stale/unknown kinds out of the tab strip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

const mem = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = localStorage;
g.window = {
  localStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
};
if (!('navigator' in globalThis)) g.navigator = { userAgent: 'node', platform: 'MacIntel' };

const SETTINGS = JSON.stringify({ restoreSession: true, perWorkspaceTabs: false });
const TABS_KEY = 'solomd.tabs.v1';

function reset(extra: Record<string, string> = {}) {
  mem.clear();
  mem.set('solomd.settings.v1', SETTINGS);
  for (const [k, v] of Object.entries(extra)) mem.set(k, v);
  setActivePinia(createPinia());
}

const { useTabsStore } = await import('./tabs.ts');

test('openInput reuses the calendar tab and swaps its parameters in place', () => {
  reset();
  const tabs = useTabsStore();
  const first = tabs.openInput('calendar', { date: '2026-11-11', view: 'month' });
  const again = tabs.openInput('calendar', { date: '2026-11-12', view: 'week' });

  assert.equal(tabs.tabs.length, 1);
  assert.equal(first.id, again.id);
  assert.deepEqual(again.input, { date: '2026-11-12', view: 'week' });
  assert.equal(tabs.activeId, again.id);
  assert.equal(tabs.isDirty(again.id), false);
});

test('web tabs are not singletons and open one tab per input', () => {
  reset();
  const tabs = useTabsStore();
  const a = tabs.openInput('web', { url: 'https://a.example/' });
  const b = tabs.openInput('web', { url: 'https://b.example/' });

  assert.notEqual(a.id, b.id);
  assert.equal(tabs.tabs.length, 2);
});

test('session-only kinds are never written to the bucket', () => {
  reset();
  const tabs = useTabsStore();
  tabs.openInput('calendar', { date: '2026-11-11', view: 'month' });
  tabs.openInput('settings', { section: 'editor' });
  tabs.openInput('search', { query: 'needle' });
  tabs.persist();

  const saved = JSON.parse(mem.get(TABS_KEY)!);
  assert.deepEqual(
    saved.tabs.map((t: { kind?: string }) => t.kind),
    ['calendar'],
  );
});

test('hydration drops unknown and session-only kinds and normalizes arguments', () => {
  const base = {
    fileName: '',
    content: '',
    savedContent: '',
    encoding: 'UTF-8',
    language: 'plaintext',
    hadBom: false,
  };
  reset({
    [TABS_KEY]: JSON.stringify({
      tabs: [
        { ...base, id: 'c1', kind: 'calendar', input: { date: '2026-11-11', view: 'year' } },
        { ...base, id: 's1', kind: 'settings', input: { section: 'editor' } },
        { ...base, id: 'x1', kind: 'nope', input: {} },
      ],
      activeId: 'c1',
    }),
  });

  const tabs = useTabsStore();
  assert.equal(tabs.tabs.length, 1);
  assert.equal(tabs.tabs[0].kind, 'calendar');
  assert.deepEqual(tabs.tabs[0].input, { date: '2026-11-11', view: 'month' });
  assert.equal(tabs.activeId, 'c1');
});

test('a closed calendar tab carries kind and arguments in the reopen stack', () => {
  reset();
  const tabs = useTabsStore();
  const tab = tabs.openInput('calendar', { date: '2026-11-11', view: 'month' });
  tabs.closeTab(tab.id);

  assert.equal(tabs.hasClosedTabs(), true);
  const rec = tabs.popClosedTab();
  assert.equal(rec?.kind, 'calendar');
  assert.deepEqual(rec?.input, { date: '2026-11-11', view: 'month' });
});
