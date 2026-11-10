/**
 * One entry, two views (batch 10 / P1).
 *
 * An entry is a calendar event and a task line at the same time: the same thing
 * is called an event in the calendar and a task in a note. This module names
 * that shape and guarantees the part every later stage depends on — the line
 * round-trips through the model unchanged, and the `🆔` inside it is the entry's
 * identity across files.
 *
 * D1 = B (see `docs/specs/entry-unification/spec.md`):
 *
 *   - the task line is authoritative and always lives in a periodic note,
 *     including for a "heavy" entry;
 *   - the event note under `Calendar/` keeps only `extras` — the fields a task
 *     line has no token for — plus `entry_uid`, which points back at the line;
 *   - so no shared field is ever stored twice. The calendar joins the two by
 *     `entry_uid`.
 *
 * `extras` keys are written to frontmatter as-is (snake_case), matching the keys
 * the calendar already reads (`related_note`, `series_uid`, …). Nothing here
 * validates or normalizes them yet: P3/P4 own writing, this owns the shape.
 */

import { parseTaskLine, serializeTaskLine, type TaskLineModel } from './task-line';

/** Frontmatter key on the event note that points at the authoritative line. */
export const ENTRY_UID_KEY = 'entry_uid';

/**
 * The event-only half of an entry. Every key is optional: an entry with none of
 * them is a light entry and has no event note at all.
 */
export interface EntryExtras {
  /** Wall-clock start (`HH:mm`), the date comes from the line's `📅`. */
  start_time?: string;
  /** Wall-clock end (`HH:mm`), or a second date when it spans days. */
  end_time?: string;
  /** Whole-day event: no time of day, the line's date is all there is. */
  all_day?: boolean;
  /** IANA zone for the two times above. */
  tzid?: string;
  location?: string;
  /** Parsed, not editable yet (see the spec's "not this round"). */
  attendees?: string[];
  /** The short note the editor writes; long minutes live in the note body. */
  notes?: string;
  related_note?: string;
}

/** The `extras` keys as they appear in frontmatter, for P3/P4 writers. */
export const ENTRY_EXTRAS_KEYS = [
  'start_time',
  'end_time',
  'all_day',
  'tzid',
  'location',
  'attendees',
  'notes',
  'related_note',
] as const satisfies readonly (keyof EntryExtras)[];

export interface Entry {
  /** The authoritative text. `lineFromEntry` gives it back byte for byte. */
  line: string;
  model: TaskLineModel;
  /** The `🆔` value; `''` until something assigns one. */
  uid: string;
  /** Event-only fields; `{}` for a light entry. */
  extras: EntryExtras;
}

/**
 * Read one line as an entry. Returns null for anything that is not a task line
 * (no bullet/checkbox), so callers can scan a note and skip the prose.
 */
export function entryFromLine(line: string, extras: EntryExtras = {}): Entry | null {
  const model = parseTaskLine(line);
  if (!model) return null;
  return { line, model, uid: model.id.trim(), extras };
}

/** Write the entry back, through the one canonical serializer. */
export function lineFromEntry(entry: Entry): string {
  return serializeTaskLine(entry.model);
}

/** Whether this entry already has an identity to join on. */
export function hasEntryUid(entry: Entry): boolean {
  return entry.uid !== '';
}

/** A light entry needs no event note: nothing outside the line to store. */
export function isHeavyEntry(entry: Entry): boolean {
  return ENTRY_EXTRAS_KEYS.some((key) => {
    const value = entry.extras[key];
    if (value === undefined || value === '' || value === false) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });
}
