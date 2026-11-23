import assert from 'node:assert/strict';
import test from 'node:test';

import { en } from './en';
import { zh } from './zh';
import { ALL_PERIODIC_KINDS, defaultPeriodicConfig } from '../lib/periodic-notes';

test('periodic notes keep their original name and no longer include flash', () => {
  assert.equal(en.settings.periodic.title, 'Periodic notes');
  assert.equal(zh.settings.periodic.title, '周期笔记');
  assert.equal(en.capture.target.periodic, 'Periodic note');
  assert.equal(zh.capture.target.periodic, '周期笔记');

  assert.ok(!('flash' in en.settings.periodic.kinds));
  assert.ok(!('flash' in zh.settings.periodic.kinds));
  assert.ok(!(ALL_PERIODIC_KINDS as readonly string[]).includes('flash'));
  assert.ok(!('flash' in defaultPeriodicConfig()));
});
