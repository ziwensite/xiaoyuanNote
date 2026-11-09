import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headerSearch, moveSelection, requestHeaderSearch, shortPath } from './header-search.ts';
import { en } from '../i18n/en.ts';
import { zh } from '../i18n/zh.ts';
import { ja } from '../i18n/ja.ts';
import { ko } from '../i18n/ko.ts';
import { de } from '../i18n/de.ts';
import { fr } from '../i18n/fr.ts';
import { es } from '../i18n/es.ts';
import { pt } from '../i18n/pt.ts';
import { it } from '../i18n/it.ts';
import { pl } from '../i18n/pl.ts';
import { nl } from '../i18n/nl.ts';
import { tr } from '../i18n/tr.ts';
import { sv } from '../i18n/sv.ts';
import { uk } from '../i18n/uk.ts';
import { ru } from '../i18n/ru.ts';

const LOCALES = { en, zh, ja, ko, de, fr, es, pt, it, pl, nl, tr, sv, uk, ru };

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, dict);
}

test('moveSelection clamps to the list bounds', () => {
  assert.equal(moveSelection(0, 1, 3), 1);
  assert.equal(moveSelection(2, 1, 3), 2);
  assert.equal(moveSelection(0, -1, 3), 0);
  assert.equal(moveSelection(1, -2, 3), 0);
  assert.equal(moveSelection(1, 5, 3), 2);
});

test('moveSelection returns 0 for an empty list', () => {
  assert.equal(moveSelection(0, 1, 0), 0);
  assert.equal(moveSelection(7, -1, 0), 0);
  assert.equal(moveSelection(-3, 1, -1), 0);
});

test('shortPath strips a matching workspace prefix', () => {
  assert.equal(shortPath('/root/notes/a.md', '/root/notes'), 'a.md');
  assert.equal(shortPath('/root/notes/dir/a.md', '/root/notes'), 'dir/a.md');
  // Windows separators.
  assert.equal(shortPath('C:\\vault\\a.md', 'C:\\vault'), 'a.md');
  assert.equal(shortPath('C:\\vault\\dir\\a.md', 'C:\\vault'), 'dir/a.md');
});

test('shortPath falls back to the last two segments', () => {
  assert.equal(shortPath('/other/place/b.md', '/root'), 'place/b.md');
  assert.equal(shortPath('/a/b/c/d.md', null), 'c/d.md');
  assert.equal(shortPath('/a/b/c/d.md', undefined), 'c/d.md');
  assert.equal(shortPath('C:\\a\\b\\c.md', ''), 'b/c.md');
});

test('requestHeaderSearch sets prefill and bumps focusSeq', () => {
  headerSearch.prefill = '';
  const before = headerSearch.focusSeq;

  requestHeaderSearch('#tag');

  assert.equal(headerSearch.prefill, '#tag');
  assert.equal(headerSearch.focusSeq, before + 1);
});

test('requestHeaderSearch without a term keeps the current prefill', () => {
  headerSearch.prefill = 'leftover';
  const before = headerSearch.focusSeq;

  requestHeaderSearch();

  assert.equal(headerSearch.prefill, 'leftover');
  assert.equal(headerSearch.focusSeq, before + 1);
});

test('header search labels exist in every locale', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const key of ['header.searchLabel', 'header.searchClear']) {
      const value = lookup(dict, key);
      assert.equal(typeof value, 'string', `${code}: ${key} must be a string`);
      assert.ok((value as string).trim().length > 0, `${code}: ${key} must not be empty`);
    }
  }
});
