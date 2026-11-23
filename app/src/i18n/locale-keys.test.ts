import assert from 'node:assert/strict';
import test from 'node:test';

import { en } from './en';
import { zh } from './zh';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { nl } from './nl';
import { pl } from './pl';
import { pt } from './pt';
import { ru } from './ru';
import { sv } from './sv';
import { tr } from './tr';
import { uk } from './uk';

const locales = { de, es, fr, it, ja, ko, nl, pl, pt, ru, sv, tr, uk };

/** Every dotted leaf path, e.g. `views.scope`. */
function paths(value: unknown, prefix = '', out: string[] = []): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) out.push(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    paths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

test('en is the complete reference dictionary', () => {
  const keys = paths(en);
  assert.ok(keys.length > 1000, `expected a full dictionary, got ${keys.length} keys`);
  for (const section of [
    'capture', 'settings', 'quickCapture', 'menubar', 'views', 'tasks', 'calendar', 'componentDialog',
  ]) {
    assert.ok(paths((en as unknown as Record<string, unknown>)[section]).length > 0, section);
  }
});

test('locales have no stray or misspelled keys (English is the fallback)', () => {
  const english = new Set(paths(en));
  for (const [name, dict] of Object.entries(locales)) {
    const stray = paths(dict).filter((key) => !english.has(key));
    assert.deepEqual(stray, [], `${name} has keys absent from en (typo or removed key)`);
  }
  assert.deepEqual(paths(zh).filter((key) => !english.has(key)), []);
});
