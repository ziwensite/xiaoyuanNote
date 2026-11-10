/**
 * Where a unified entry's line goes, and how it gets there (batch 10 / P3).
 *
 * D1 = B: the line always lives in a periodic note — for a new entry, today's
 * daily note — and a heavy entry's event note is a separate file that only
 * points back at it. So this module never decides between two homes; it makes
 * one home idempotent.
 *
 * Two halves:
 *   - `upsertEntryLine` is pure: given the file's text, the line to write, its
 *     `🆔` and the capture heading, it returns the new text. Same uid → replace
 *     in place; no match → insert under the heading. No uid → always insert,
 *     so a line the user typed by hand is never overwritten.
 *   - `createEntryWriter` adds the I/O contract: queue per path, re-read just
 *     before writing, and report whether anything actually changed. Callers
 *     inject `read`/`write`, which keeps this testable without a real vault.
 */

import { entryFromLine } from './entry';

/** D1 = B: a light entry and a heavy entry both start in a periodic note. */
export interface EntryHome {
  kind: 'periodic';
  /** Absolute path of the target note. */
  path: string;
}

export interface UpsertOptions {
  /** `🆔` value of the line; `''` means "no identity, always insert". */
  uid: string;
  /** Heading to insert under (`## 任务`); `''` or missing heading → end of file. */
  heading: string;
}

export interface UpsertResult {
  text: string;
  changed: boolean;
}

/**
 * Insert or update one line in `text`.
 *
 * A uid match replaces that line where it already sits — position is the
 * user's, not ours. Without a match the line goes directly under the capture
 * heading; if that heading is absent the line is appended after the last
 * non-empty line, which is the least surprising place we can pick without
 * inventing structure.
 */
export function upsertEntryLine(text: string, line: string, opts: UpsertOptions): UpsertResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);

  if (opts.uid) {
    for (let i = 0; i < lines.length; i += 1) {
      const entry = entryFromLine(lines[i]);
      if (entry && entry.uid === opts.uid) {
        if (lines[i] === line) return { text, changed: false };
        lines[i] = line;
        return { text: lines.join(eol), changed: true };
      }
    }
  }

  const heading = opts.heading.trim();
  const at = heading ? lines.findIndex((l) => l.trim() === heading) : -1;
  if (at >= 0) {
    lines.splice(at + 1, 0, line);
    return { text: lines.join(eol), changed: true };
  }

  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  lines.splice(end, 0, line);
  return { text: lines.join(eol), changed: true };
}

export interface EntryWriterDeps {
  /** `null` when the file does not exist yet. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

/** `created` = the file did not exist; `unchanged` = the line was already right. */
export type WriteOutcome = 'created' | 'written' | 'unchanged';

/**
 * `write(path, line, options)` — serialized per path, idempotent per uid.
 *
 * The re-read before writing is the conflict guard: if the file changed while
 * we were computing, we recompute from the fresh text once instead of clobbering
 * whatever landed in between. Two in-process writers cannot interleave at all,
 * because every write to a path waits for the previous one to settle.
 */
export function createEntryWriter(deps: EntryWriterDeps) {
  const queues = new Map<string, Promise<unknown>>();

  function enqueue<T>(path: string, job: () => Promise<T>): Promise<T> {
    const previous = queues.get(path) ?? Promise.resolve();
    // Run regardless of whether the previous job resolved or rejected.
    const next = previous.then(job, job);
    queues.set(
      path,
      next.catch(() => undefined),
    );
    return next;
  }

  async function attempt(path: string, line: string, opts: UpsertOptions): Promise<WriteOutcome> {
    const before = await deps.read(path);
    const current = before ?? '';
    let plan = upsertEntryLine(current, line, opts);
    if (!plan.changed) return 'unchanged';

    const fresh = (await deps.read(path)) ?? '';
    if (fresh !== current) {
      plan = upsertEntryLine(fresh, line, opts);
      if (!plan.changed) return 'unchanged';
    }

    await deps.write(path, plan.text);
    return before === null ? 'created' : 'written';
  }

  return function write(
    path: string,
    line: string,
    opts: UpsertOptions,
  ): Promise<WriteOutcome> {
    return enqueue(path, () => attempt(path, line, opts));
  };
}
