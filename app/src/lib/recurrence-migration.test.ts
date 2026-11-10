import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileNaturalRecurrence } from './tasks';
import {
  applyRecurrenceConversions,
  convertLegacyRecurrenceLine,
  naturalRecurrenceFromLegacy,
  translateLegacyRecurrence,
} from './recurrence-migration';

test('the simple legacy rules become the documented natural spellings', () => {
  const cases: Array<[string, string]> = [
    ['FREQ=DAILY', 'every day'],
    ['FREQ=DAILY;INTERVAL=3', 'every 3 days'],
    ['FREQ=WEEKLY', 'every week'],
    ['FREQ=WEEKLY;INTERVAL=2', 'every 2 weeks'],
    ['FREQ=WEEKLY;BYDAY=MO', 'every monday'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', 'every saturday and sunday'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'every weekday'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR', 'every 2 weeks on monday and friday'],
    ['FREQ=MONTHLY', 'every month'],
    ['FREQ=MONTHLY;BYMONTHDAY=1', 'every month on the 1st'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', 'every month on the 1st and 15th'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'every month on the last day'],
    ['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=2', 'every 3 months on the 2nd'],
    ['FREQ=MONTHLY;BYDAY=2TU', 'every month on the 2nd tuesday'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'every month on the last friday'],
    ['FREQ=YEARLY', 'every year'],
    ['FREQ=YEARLY;INTERVAL=2', 'every 2 years'],
    ['FREQ=YEARLY;BYMONTH=1', 'every january'],
    ['FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=5', 'every june 5th'],
    ['FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=-1', 'every december last day'],
  ];
  for (const [rule, phrase] of cases) {
    assert.equal(naturalRecurrenceFromLegacy(rule), phrase, rule);
    // The phrase must compile back to the same canonical rule — that is what
    // "Tasks can express this" means here.
    assert.ok(compileNaturalRecurrence(phrase), rule);
  }
});

test('an explicit INTERVAL=1 is equivalent to none and still converts', () => {
  assert.equal(naturalRecurrenceFromLegacy('FREQ=WEEKLY;INTERVAL=1'), 'every week');
  assert.equal(naturalRecurrenceFromLegacy('freq=monthly;byday=-1FR'), 'every month on the last friday');
});

test('rules outside the natural-language subset are refused with a reason', () => {
  const cases: Array<[string, string]> = [
    ['FREQ=DAILY;COUNT=3', 'unknown-key'],
    ['FREQ=WEEKLY;UNTIL=20261231T000000Z', 'unknown-key'],
    ['FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1', 'unknown-key'],
    ['FREQ=WEEKLY;WKST=MO', 'unknown-key'],
    ['FREQ=HOURLY', 'frequency'],
    ['FREQ=MINUTELY;INTERVAL=30', 'frequency'],
    ['FREQ=WEEKLY;BYDAY=1MO', 'combination'],
    ['FREQ=DAILY;BYDAY=MO', 'combination'],
    ['FREQ=MONTHLY;BYMONTH=3', 'combination'],
    ['FREQ=MONTHLY;BYDAY=MO', 'combination'],
    ['FREQ=MONTHLY;BYDAY=1MO,2TU', 'combination'],
    ['FREQ=YEARLY;BYMONTH=6;BYDAY=2TU', 'combination'],
    ['FREQ=YEARLY;BYMONTH=1,6', 'combination'],
    ['FREQ=YEARLY;INTERVAL=2;BYMONTH=6', 'combination'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', 'malformed'],
    ['FREQ=MONTHLY;BYMONTHDAY=-2', 'malformed'],
    ['FREQ=WEEKLY;INTERVAL=0', 'malformed'],
    ['FREQ=WEEKLY;', 'malformed'],
    ['INTERVAL=2', 'malformed'],
  ];
  for (const [rule, reason] of cases) {
    const out = translateLegacyRecurrence(rule);
    assert.equal(out.natural, null, rule);
    assert.equal(out.reason, reason, rule);
  }
});

test('only the rule text changes; spacing, dates and trailing blanks survive', () => {
  const line = '- [ ] water plants  🔁 FREQ=WEEKLY   📅 2026-11-16 ⏰ 09:00 🆔 abcd1234  ';
  const out = convertLegacyRecurrenceLine(line)!;
  assert.equal(out.natural, 'every week');
  assert.equal(
    out.after,
    '- [ ] water plants  🔁 every week   📅 2026-11-16 ⏰ 09:00 🆔 abcd1234  ',
  );
});

test('trailing spaces after a rule at the end of the line are kept', () => {
  const out = convertLegacyRecurrenceLine('- [x] done 🔁 FREQ=DAILY;INTERVAL=2   ')!;
  assert.equal(out.after, '- [x] done 🔁 every 2 days   ');
});

test('a natural-language rule or a line without one is left alone', () => {
  assert.equal(convertLegacyRecurrenceLine('- [ ] task 🔁 every week 📅 2026-11-16'), null);
  assert.equal(convertLegacyRecurrenceLine('- [ ] plain task 📅 2026-11-16'), null);
  assert.equal(convertLegacyRecurrenceLine('- [ ] no rule 🔁 not a rule at all'), null);
});

test('an unsupported rule is reported and never rewritten', () => {
  const line = '- [ ] task 🔁 FREQ=WEEKLY;COUNT=3 📅 2026-11-16';
  const out = convertLegacyRecurrenceLine(line)!;
  assert.equal(out.after, null);
  assert.equal(out.reason, 'unknown-key');
  assert.equal(out.before, line);
});

test('applying keeps CRLF and refuses a stale line', () => {
  const content = ['- [ ] a 🔁 FREQ=DAILY', '- [ ] b 🔁 FREQ=WEEKLY', '- [ ] c'].join('\r\n');
  const result = applyRecurrenceConversions(content, [
    { line: 1, before: '- [ ] a 🔁 FREQ=DAILY', after: '- [ ] a 🔁 every day' },
    { line: 2, before: '- [ ] changed since preview', after: '- [ ] b 🔁 every week' },
  ]);
  assert.equal(result.applied, 1);
  assert.deepEqual(result.skipped, [2]);
  assert.equal(
    result.content,
    ['- [ ] a 🔁 every day', '- [ ] b 🔁 FREQ=WEEKLY', '- [ ] c'].join('\r\n'),
  );
});

test('a line number past the end of the file is skipped, not appended', () => {
  const result = applyRecurrenceConversions('- [ ] only', [
    { line: 9, before: '- [ ] only', after: '- [ ] only 🔁 every day' },
  ]);
  assert.equal(result.applied, 0);
  assert.deepEqual(result.skipped, [9]);
  assert.equal(result.content, '- [ ] only');
});
