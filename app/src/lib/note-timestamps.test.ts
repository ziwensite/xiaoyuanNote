import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNoteTimestamps } from './note-timestamps';

const now = new Date(2026, 10, 23, 14, 5, 6);

test('adds all four timestamp fields to a note without front matter', () => {
  const stamped = applyNoteTimestamps('Body line\n', { createdAt: now, modifiedAt: now });
  assert.match(stamped, /^---\n/);
  assert.match(stamped, /created_date: ['"]?2026-11-23/);
  assert.match(stamped, /created_time: ['"]?2026-11-23T14:05:06/);
  assert.match(stamped, /modified_date: ['"]?2026-11-23/);
  assert.match(stamped, /modified_time: ['"]?2026-11-23T14:05:06/);
  assert.ok(stamped.endsWith('\nBody line\n'));
});

test('preserves created fields and refreshes modified fields', () => {
  const source = [
    '---',
    'title: Existing',
    'created_date: 2020-01-02',
    "created_time: '2020-01-02T03:04:05+00:00'",
    'modified_date: 2020-01-03',
    'modified_time: old',
    'tags: [a, b]',
    '---',
    '',
    'Body',
  ].join('\n');
  const stamped = applyNoteTimestamps(source, { modifiedAt: now });
  assert.match(stamped, /created_date: ['"]?2020-01-02/);
  assert.match(stamped, /created_time: ['"]?2020-01-02T03:04:05\+00:00/);
  assert.match(stamped, /modified_date: ['"]?2026-11-23/);
  assert.match(stamped, /modified_time: ['"]?2026-11-23T14:05:06/);
  assert.match(stamped, /title: Existing/);
  assert.match(stamped, /tags: \[a, b\]/);
  assert.ok(stamped.endsWith('\nBody'));
});

test('uses the filesystem creation time when created fields are missing', () => {
  const created = new Date(2019, 4, 6, 7, 8, 9);
  const stamped = applyNoteTimestamps('Body\n', { createdAt: created, modifiedAt: now });
  assert.match(stamped, /created_date: ['"]?2019-05-06/);
  assert.match(stamped, /created_time: ['"]?2019-05-06T07:08:09/);
  assert.match(stamped, /modified_date: ['"]?2026-11-23/);
});

test('keeps CRLF front matter and body intact', () => {
  const source = '---\r\ntitle: Windows\r\n---\r\n\r\nBody\r\n';
  const stamped = applyNoteTimestamps(source, { modifiedAt: now });
  assert.match(stamped, /---\r\n/);
  assert.match(stamped, /modified_date: ['"]?2026-11-23['"]?\r\n/);
  assert.ok(stamped.includes('\r\n\r\nBody\r\n'));
});
