/**
 * Unit tests for task metadata parsing and the checkbox rewrite.
 *
 * Run from `app/`:  node src/lib/tasks.selftest.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTaskMeta,
  isOverdue,
  localDateKey,
  compareTasks,
  completeRecurringTaskLine,
  setTaskReminder,
  toggleTaskLine,
} from './tasks';

test('plain text has no metadata', () => {
  const m = parseTaskMeta('buy milk');
  assert.deepEqual(m, { title: 'buy milk', priority: null, due: null, tags: [] });
});

test('Obsidian emoji priority and due date', () => {
  const m = parseTaskMeta('ship the release ⏫ 📅 2026-09-10');
  assert.equal(m.priority, 'high');
  assert.equal(m.due, '2026-09-10');
  assert.equal(m.title, 'ship the release');
});

test('ASCII forms work too', () => {
  assert.equal(parseTaskMeta('call the bank due:2026-01-02').due, '2026-01-02');
  assert.equal(parseTaskMeta('call the bank due: 2026-01-02').title, 'call the bank');
  assert.equal(parseTaskMeta('[#A] fix the build').priority, 'high');
  assert.equal(parseTaskMeta('[#c] tidy up').priority, 'low');
  assert.equal(parseTaskMeta('deploy !!!').priority, 'high');
  assert.equal(parseTaskMeta('deploy !!').priority, 'medium');
  assert.equal(parseTaskMeta('deploy !').priority, 'low');
  assert.equal(parseTaskMeta('deploy !!!').title, 'deploy');
});

test('an exclamation attached to a word is not a priority', () => {
  const m = parseTaskMeta('Ship it!');
  assert.equal(m.priority, null);
  assert.equal(m.title, 'Ship it!');
});

test('emoji wins over ASCII when both are present, and nothing is eaten twice', () => {
  const m = parseTaskMeta('thing 🔽 !!!');
  assert.equal(m.priority, 'low');
  assert.equal(m.title, 'thing !!!');
});

test('unrecognised text is left alone', () => {
  const m = parseTaskMeta('review PR #42 with @alex 50% done');
  assert.equal(m.title, 'review PR #42 with @alex 50% done');
  assert.deepEqual(m.tags, ['42']);
});

test('CJK tags are captured', () => {
  const m = parseTaskMeta('写周报 #工作 #写作');
  assert.deepEqual(m.tags, ['工作', '写作']);
  assert.equal(m.title, '写周报 #工作 #写作');
});

test('a malformed date is not a due date', () => {
  assert.equal(parseTaskMeta('due:2026-9-1 something').due, null);
  assert.equal(parseTaskMeta('📅 tomorrow').due, null);
});

test('overdue is strictly before today', () => {
  assert.equal(isOverdue('2026-09-02', '2026-09-03'), true);
  assert.equal(isOverdue('2026-09-03', '2026-09-03'), false);
  assert.equal(isOverdue('2026-09-04', '2026-09-03'), false);
  assert.equal(isOverdue(null, '2026-09-03'), false);
});

test('date key uses local time, not UTC', () => {
  // 00:30 local on the 3rd is still the 3rd, even where UTC says the 2nd.
  const d = new Date(2026, 8, 3, 0, 30);
  assert.equal(localDateKey(d), '2026-09-03');
});

test('sort: open before done, then due, then priority, then title', () => {
  const t = (done: boolean, text: string) => ({ done, meta: parseTaskMeta(text) });
  const list = [
    t(true, 'finished ⏫ 📅 2026-01-01'),
    t(false, 'no date'),
    t(false, 'later 📅 2026-12-01'),
    t(false, 'today 📅 2026-09-03'),
    t(false, 'also today 📅 2026-09-03 ⏫'),
  ];
  const order = [...list].sort(compareTasks).map((x) => x.meta.title);
  assert.deepEqual(order, ['also today', 'today', 'later', 'no date', 'finished']);
});

test('toggling rewrites only the checkbox on that line', () => {
  const doc = ['# H', '', '- [ ] one', '- [x] two', 'plain line'].join('\n');
  assert.equal(
    toggleTaskLine(doc, 3),
    ['# H', '', '- [x] one', '- [x] two', 'plain line'].join('\n'),
  );
  assert.equal(
    toggleTaskLine(doc, 4),
    ['# H', '', '- [ ] one', '- [ ] two', 'plain line'].join('\n'),
  );
});

test('toggling a line that is not a task refuses rather than corrupting it', () => {
  const doc = ['- [ ] one', 'plain'].join('\n');
  assert.equal(toggleTaskLine(doc, 2), null);
  assert.equal(toggleTaskLine(doc, 0), null);
  assert.equal(toggleTaskLine(doc, 99), null);
});

test('toggling preserves indentation and marker style', () => {
  assert.equal(toggleTaskLine('  * [ ] nested', 1), '  * [x] nested');
  assert.equal(toggleTaskLine('+ [X] done', 1), '+ [ ] done');
});

test('calendar tokens: uid, reminders and rrule are parsed out of the title', () => {
  const m = parseTaskMeta(
    'review PR 🆔 8f14e45f-ea0c ⏰ -PT15M ⏰ 09:00 🔁 FREQ=WEEKLY;BYDAY=MO',
  );
  assert.equal(m.title, 'review PR');
  assert.equal(m.uid, '8f14e45f-ea0c');
  assert.deepEqual(m.reminders, ['-PT15M', '09:00']);
  assert.equal(m.rrule, 'FREQ=WEEKLY;BYDAY=MO');
});

test('calendar tokens are optional and absent keys stay absent', () => {
  const m = parseTaskMeta('plain task 📅 2026-09-10');
  assert.equal('uid' in m, false);
  assert.equal('reminders' in m, false);
  assert.equal('rrule' in m, false);
});

test('malformed calendar tokens are not eaten', () => {
  const m = parseTaskMeta('call mom ⏰ tomorrow 🔁 BYDAY=MO 🆔 ab');
  assert.equal(m.title, 'call mom ⏰ tomorrow 🔁 BYDAY=MO 🆔 ab');
  assert.equal(m.uid, undefined);
  assert.equal(m.rrule, undefined);
  assert.equal(m.reminders, undefined);
});

// ---------------------------------------------------------------------------
// setTaskReminder — the explicit add/remove entry point
// ---------------------------------------------------------------------------

const DOC = [
  '# Notes',
  '',
  '- [ ] pay rent 📅 2026-11-09 #home',
  '- [x] done thing',
  '  * [ ] nested 📅 2026-12-01',
  'a plain paragraph',
  '',
].join('\n');

/** Every line except `line1Based`, which is what "byte-identical" means here. */
function otherLines(doc: string, line1Based: number): string[] {
  return doc.split('\n').filter((_, i) => i !== line1Based - 1);
}

test('adding a reminder touches only the target line', () => {
  const next = setTaskReminder(DOC, 3, '09:00', 'abc12345');
  assert.ok(next);
  assert.deepEqual(otherLines(next, 3), otherLines(DOC, 3));
  assert.equal(next.split('\n')[2], '- [ ] pay rent 📅 2026-11-09 #home ⏰ 09:00 🆔 abc12345');
});

test('removing a reminder drops the token, keeps the uid, and leaves the rest of the note alone', () => {
  const added = setTaskReminder(DOC, 3, '-PT15M', 'abc12345');
  assert.ok(added);
  const removed = setTaskReminder(added, 3, null);
  assert.ok(removed);
  assert.deepEqual(otherLines(removed, 3), otherLines(DOC, 3));
  // The UID is a task identity, not part of the reminder: it is injected once
  // and then kept, so the note is not rewritten again on every toggle.
  assert.equal(removed.split('\n')[2], '- [ ] pay rent 📅 2026-11-09 #home 🆔 abc12345');
});

test('adding twice replaces instead of duplicating, and the uid is not re-injected', () => {
  const once = setTaskReminder(DOC, 3, '09:00', 'abc12345');
  assert.ok(once);
  const twice = setTaskReminder(once, 3, '-PT30M', 'ffff9999');
  assert.ok(twice);
  const meta = parseTaskMeta(twice.split('\n')[2].replace(/^- \[ \] /, ''));
  assert.deepEqual(meta.reminders, ['-PT30M']);
  assert.equal(meta.uid, 'abc12345');
  assert.equal((twice.match(/🆔/gu) ?? []).length, 1);
});

test('every existing reminder is removed at once', () => {
  const line = '- [ ] meds 📅 2026-11-09 ⏰ 09:00 ⏰ -PT10M';
  assert.equal(setTaskReminder(line, 1, null), '- [ ] meds 📅 2026-11-09');
});

test('removal keeps the space before the token out of the way', () => {
  assert.equal(setTaskReminder('- [ ] x ⏰ 09:00', 1, null), '- [ ] x');
  assert.equal(setTaskReminder('- [ ] ⏰ 09:00 x', 1, null), '- [ ] x');
  assert.equal(setTaskReminder('- [ ] ⏰ 09:00', 1, null), '- [ ]');
});

test('a non-writable trigger refuses and writes nothing', () => {
  for (const bad of ['', 'tomorrow', '25:00', 'P', 'PT']) {
    assert.equal(setTaskReminder(DOC, 3, bad, 'abc12345'), null, `rejects: ${bad}`);
  }
});

test('a line that is not a task refuses rather than corrupting it', () => {
  assert.equal(setTaskReminder(DOC, 6, '09:00', 'abc12345'), null);
  assert.equal(setTaskReminder(DOC, 1, null), null);
  assert.equal(setTaskReminder(DOC, 0, '09:00'), null);
  assert.equal(setTaskReminder(DOC, 99, null), null);
});

test('indentation, checkbox state and CRLF survive the rewrite', () => {
  assert.equal(
    setTaskReminder('  * [x] nested 📅 2026-12-01', 1, '09:00'),
    '  * [x] nested 📅 2026-12-01 ⏰ 09:00',
  );
  const crlf = ['- [ ] one', '- [ ] two'].join('\r\n');
  assert.equal(setTaskReminder(crlf, 2, '09:00'), '- [ ] one\r\n- [ ] two ⏰ 09:00');
  assert.equal(setTaskReminder('- [ ] one\r\n- [ ] two', 1, null), '- [ ] one\r\n- [ ] two');
});

test('trailing whitespace stays on the line, after the token', () => {
  assert.equal(setTaskReminder('- [ ] spaced   ', 1, '09:00'), '- [ ] spaced ⏰ 09:00   ');
});

test('the written token is re-parsed as the same reminder', () => {
  const next = setTaskReminder(DOC, 3, '2026-11-09T01:00:00Z', 'abc12345');
  assert.ok(next);
  const meta = parseTaskMeta(next.split('\n')[2].replace(/^- \[ \] /, ''));
  assert.deepEqual(meta.reminders, ['2026-11-09T01:00:00Z']);
  assert.equal(meta.due, '2026-11-09');
});

// ---------------------------------------------------------------------------
// completeRecurringTaskLine — one line per occurrence
// ---------------------------------------------------------------------------

const RECURRING = [
  '# Habits',
  '',
  '- [ ] water plants 📅 2026-11-09 ⏰ 09:00 🆔 abcd1234 🔁 FREQ=WEEKLY;BYDAY=MO',
  '- [ ] unrelated task 📅 2026-12-01',
  '',
].join('\n');

test('completing below ticked the old line and opens the next one right after it', () => {
  const result = completeRecurringTaskLine(RECURRING, 3, '2026-11-16', 'below');
  assert.ok(result);
  const lines = result.content.split('\n');
  assert.equal(lines[2], '- [x] water plants 📅 2026-11-09 ⏰ 09:00 🆔 abcd1234 🔁 FREQ=WEEKLY;BYDAY=MO');
  assert.equal(lines[3], '- [ ] water plants 📅 2026-11-16 ⏰ 09:00 🔁 FREQ=WEEKLY;BYDAY=MO');
  assert.equal(result.line, 4);
  // Everything outside the two affected lines is untouched.
  assert.deepEqual(
    lines.filter((_, i) => i !== 2 && i !== 3),
    RECURRING.split('\n').filter((_, i) => i !== 2),
  );
});

test('completing above puts the new occurrence before the completed line', () => {
  const result = completeRecurringTaskLine(RECURRING, 3, '2026-11-16', 'above');
  assert.ok(result);
  const lines = result.content.split('\n');
  assert.equal(lines[2], '- [ ] water plants 📅 2026-11-16 ⏰ 09:00 🔁 FREQ=WEEKLY;BYDAY=MO');
  assert.equal(lines[3], '- [x] water plants 📅 2026-11-09 ⏰ 09:00 🆔 abcd1234 🔁 FREQ=WEEKLY;BYDAY=MO');
  assert.equal(result.line, 3);
});

test('the ASCII due spelling survives the advance', () => {
  const result = completeRecurringTaskLine('- [ ] report due:2026-11-09', 1, '2026-11-10', 'below');
  assert.ok(result);
  assert.equal(result.content, ['- [x] report due:2026-11-09', '- [ ] report due:2026-11-10'].join('\n'));
});

test('a completed line or a missing due refuses instead of guessing', () => {
  assert.equal(completeRecurringTaskLine('- [x] done 📅 2026-11-09', 1, '2026-11-10', 'below'), null);
  assert.equal(completeRecurringTaskLine('- [ ] no date 🔁 FREQ=DAILY', 1, '2026-11-10', 'below'), null);
  assert.equal(completeRecurringTaskLine('plain text', 1, '2026-11-10', 'below'), null);
  assert.equal(completeRecurringTaskLine('- [ ] ok 📅 2026-11-09', 0, '2026-11-10', 'below'), null);
});

test('CRLF notes keep their line endings on both affected lines', () => {
  const doc = ['- [ ] a 📅 2026-11-09', '- [ ] b 📅 2026-12-01'].join('\r\n');
  const result = completeRecurringTaskLine(doc, 1, '2026-11-10', 'below');
  assert.ok(result);
  assert.equal(
    result.content,
    ['- [x] a 📅 2026-11-09', '- [ ] a 📅 2026-11-10', '- [ ] b 📅 2026-12-01'].join('\r\n'),
  );
});

test('the new occurrence is parseable as the next task', () => {
  const result = completeRecurringTaskLine(RECURRING, 3, '2026-11-16', 'below');
  assert.ok(result);
  const meta = parseTaskMeta(result.content.split('\n')[3].replace(/^- \[ \] /, ''));
  assert.equal(meta.due, '2026-11-16');
  assert.deepEqual(meta.reminders, ['09:00']);
  assert.equal(meta.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.equal(meta.uid, undefined);
});

// ---------------------------------------------------------------------------
// Obsidian Tasks compatibility: five date fields, five priorities, statuses
// ---------------------------------------------------------------------------

test('every Obsidian Tasks date token is parsed and removed from the title', () => {
  const m = parseTaskMeta(
    'ship the release ➕ 2026-09-01 ⏳ 2026-09-08 🛫 2026-09-09 📅 2026-09-10 ✅ 2026-09-11 ❌ 2026-09-12',
  );
  assert.equal(m.title, 'ship the release');
  assert.equal(m.created, '2026-09-01');
  assert.equal(m.scheduled, '2026-09-08');
  assert.equal(m.start, '2026-09-09');
  assert.equal(m.due, '2026-09-10');
  assert.equal(m.completed, '2026-09-11');
  assert.equal(m.cancelled, '2026-09-12');
});

test('absent date tokens stay absent rather than becoming null', () => {
  const m = parseTaskMeta('plain ⏳ 2026-09-08');
  assert.equal(m.scheduled, '2026-09-08');
  assert.equal('start' in m, false);
  assert.equal('completed' in m, false);
});

test('a malformed date after a token is left in the title', () => {
  const m = parseTaskMeta('call mom ⏳ tomorrow');
  assert.equal(m.title, 'call mom ⏳ tomorrow');
  assert.equal(m.scheduled, undefined);
});

test('five priority levels are recognised', () => {
  assert.equal(parseTaskMeta('a 🔺').priority, 'highest');
  assert.equal(parseTaskMeta('a ⏫').priority, 'high');
  assert.equal(parseTaskMeta('a 🔼').priority, 'medium');
  assert.equal(parseTaskMeta('a 🔽').priority, 'low');
  assert.equal(parseTaskMeta('a ⏬').priority, 'lowest');
  assert.equal(parseTaskMeta('a 🔺 task').title, 'a task');
});

test('sorting puts highest first and lowest last, unprioritised after both', () => {
  const list = ['none', 'b ⏬', 'c 🔺', 'd 🔽', 'e 🔼', 'f ⏫'].map((text) => ({
    done: false,
    meta: parseTaskMeta(text),
  }));
  const order = [...list].sort(compareTasks).map((x) => x.meta.title);
  assert.deepEqual(order, ['c', 'f', 'e', 'd', 'b', 'none']);
});

test('an unknown status is a TODO that toggles to x, like Obsidian Tasks', () => {
  assert.equal(toggleTaskLine('- [/] doing it', 1), '- [x] doing it');
  assert.equal(toggleTaskLine('- [-] dropped', 1), '- [x] dropped');
  assert.equal(toggleTaskLine('- [?] question', 1), '- [x] question');
});

test('toggling a done custom-status task clears it to todo', () => {
  assert.equal(toggleTaskLine('- [X] done', 1), '- [ ] done');
  assert.equal(toggleTaskLine('- [/] doing it', 1), '- [x] doing it');
});

test('toggling does not eat the rest of a custom-status line', () => {
  const line = '  * [/] review ⏳ 2026-09-08 📅 2026-09-10  ';
  assert.equal(toggleTaskLine(line, 1), '  * [x] review ⏳ 2026-09-08 📅 2026-09-10  ');
});

test('an in-progress recurring task advances and is completed as x', () => {
  const result = completeRecurringTaskLine(
    '- [/] water 📅 2026-11-09 🔁 FREQ=WEEKLY;BYDAY=MO',
    1,
    '2026-11-16',
    'above',
  );
  assert.ok(result);
  assert.equal(
    result.content,
    ['- [ ] water 📅 2026-11-16 🔁 FREQ=WEEKLY;BYDAY=MO', '- [x] water 📅 2026-11-09 🔁 FREQ=WEEKLY;BYDAY=MO'].join(
      '\n',
    ),
  );
});

