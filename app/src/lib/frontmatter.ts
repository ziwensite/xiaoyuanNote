/**
 * F2 — Frontmatter splice helpers for the Type-driven sidebar.
 *
 * SoloMD keeps "types" 100% Markdown-native (Tolaria-compatible): membership
 * and type-definition metadata all live in a note's YAML frontmatter block.
 * Editing that metadata must NOT clobber the rest of the file — so instead of
 * re-serializing whole documents we splice ONLY the leading `---\n…\n---`
 * frontmatter block and leave the body bytes untouched.
 *
 * Two surfaces use `patchFrontmatter`:
 *   - `patchTypeDef(name, patch)` in stores/types.ts — edit a type-definition
 *     note's presentation keys (icon/color/order/…).
 *   - `setMemberType(path, name)` — set/replace a member note's `type:` field.
 *   - `writeCalendarEvent(text, event)` in lib/calendar.ts — rewrite an event
 *     note's managed iCal keys.
 *
 * Patching is TEXT-LEVEL, not a whole-block re-dump. We still parse with
 * `js-yaml` so the *meaning* of the document stays authoritative (and a patch
 * on top of a value the YAML parser would already reject is caught), but writes
 * are surgical: each top-level key owns the exact source lines of its entry
 * (`key:` line plus any indented / block-scalar / sequence continuation lines).
 * Only the lines of the keys named in the patch are touched, so YAML comments,
 * key order, quote style, indentation, inline arrays, blank lines, trailing
 * whitespace and CRLF of every other line survive byte-for-byte. This mirrors
 * the Rust Properties-inspector editor (`commands::set_frontmatter_property_str`).
 *
 * Degradation policy (never silently drop comments):
 *   - Invalid YAML in the existing block: the block is repaired by a whole-block
 *     dump of the merged data, and the caller is told via
 *     `patchFrontmatterWithReport().degraded`. (`patchFrontmatter` logs it.)
 *   - Duplicate top-level keys: throws `FrontmatterPatchError` and does not
 *     write, because picking one silently discards the other.
 *   - A root that is not a mapping (e.g. `---` + a YAML list): throws — a
 *     line-level patch has no key to attach to, and a dump would replace the
 *     list with a mapping.
 *   - Deleting an anchored key that other keys alias (`*name`): throws, because
 *     the alias would be left dangling.
 *   - Flow collections (`[a, b]`, `{k: v}`), multi-line block scalars (`|`, `>`)
 *     and nested maps are fully supported: they are either an untouched key's
 *     verbatim lines or the replaced key's whole span.
 */
import yaml from 'js-yaml';

export interface SplitDoc {
  /** A leading BOM, if the file had one (preserved on write). */
  bom: string;
  /** Parsed frontmatter object (empty object when there was no block). */
  data: Record<string, unknown>;
  /** Whether the source actually had a frontmatter block. */
  hadBlock: boolean;
  /** Everything after the frontmatter block (verbatim). */
  body: string;
}

/** Raised when a patch cannot be applied without risking data loss. */
export class FrontmatterPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrontmatterPatchError';
  }
}

/** Result of a patch, including whether it had to fall back to a full re-dump. */
export interface FrontmatterPatchReport {
  text: string;
  /** `null` when the edit was purely line-surgical. */
  degraded: { reason: string } | null;
}

/** One source line with its exact line ending (kept so nothing is reflowed). */
interface BlockLine {
  text: string;
  eol: string;
}

interface BlockLayout {
  bom: string;
  /** Line ending used inside the block (`\n` or `\r\n`). */
  nl: string;
  hadBlock: boolean;
  /** Exact open fence line including its EOL ('' when there was no block). */
  open: string;
  /** Exact close fence line including its EOL ('' when there was no block). */
  close: string;
  /** Inner YAML lines (between the fences), each with its own EOL. */
  lines: BlockLine[];
  /** Everything after the close fence line, byte-for-byte. */
  body: string;
}

/** One top-level key's footprint inside the block. */
interface KeySpan {
  key: string;
  /** First line index (the `key:` line). */
  start: number;
  /** One-past-last line index (covers continuation lines). */
  end: number;
}

/** Split text into lines, remembering each line's exact terminator. */
function splitLines(raw: string): BlockLine[] {
  const out: BlockLine[] = [];
  let i = 0;
  while (i < raw.length) {
    let j = i;
    while (j < raw.length && raw[j] !== '\n') j += 1;
    if (j >= raw.length) {
      out.push({ text: raw.slice(i), eol: '' });
      break;
    }
    const crlf = j > i && raw[j - 1] === '\r';
    out.push({ text: raw.slice(i, crlf ? j - 1 : j), eol: crlf ? '\r\n' : '\n' });
    i = j + 1;
  }
  return out;
}

/** Locate the leading frontmatter block without normalizing a single byte. */
function splitLayout(text: string): BlockLayout {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const rest = bom ? text.slice(1) : text;
  const lines = splitLines(rest);
  const noBlock = (body: string, nl?: string): BlockLayout => ({
    bom,
    nl: nl ?? (body.includes('\r\n') ? '\r\n' : '\n'),
    hadBlock: false,
    open: '',
    close: '',
    lines: [],
    body,
  });

  if (!lines.length || lines[0].text !== '---') return noBlock(rest);

  let closeAt = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].text === '---' || lines[i].text === '...') {
      closeAt = i;
      break;
    }
  }
  if (closeAt < 0) return noBlock(rest);

  const open = lines[0].text + lines[0].eol;
  const close = lines[closeAt].text + lines[closeAt].eol;
  const body = lines
    .slice(closeAt + 1)
    .map((l) => l.text + l.eol)
    .join('');
  const inner = lines.slice(1, closeAt);
  const nl = lines[0].eol || inner[0]?.eol || (rest.includes('\r\n') ? '\r\n' : '\n');

  return { bom, nl, hadBlock: true, open, close, lines: inner, body };
}

/** Parse the block's YAML and classify it for the patch decision. */
function parseInner(layout: BlockLayout): {
  data: Record<string, unknown>;
  valid: boolean;
  isMap: boolean;
} {
  const src = layout.lines.map((l) => l.text + l.eol).join('');
  if (!src.trim()) return { data: {}, valid: true, isMap: true };
  try {
    const parsed = yaml.load(src);
    if (parsed == null) return { data: {}, valid: true, isMap: true };
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, valid: true, isMap: true };
    }
    return { data: {}, valid: true, isMap: false };
  } catch {
    return { data: {}, valid: false, isMap: false };
  }
}

/**
 * A top-level YAML key line is `key:` or `key: value` at column 0 (no leading
 * whitespace, not a comment, not a sequence item). Quoted keys (`"a: b": x`)
 * are found by scanning for the first unquoted `:` followed by space/EOL.
 * Returns the raw key token (still quoted) or null for continuation lines.
 */
function topLevelKeyOf(line: string): string | null {
  if (!line || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#') || line.startsWith('-')) {
    return null;
  }
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      const next = line[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return line.slice(0, i);
    }
  }
  return null;
}

/** Unquote a raw key token into its logical string (`"a: b"` → `a: b`). */
function unquoteKey(raw: string): string {
  const t = raw.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    try {
      const parsed = yaml.load(`${t}: 0`);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const key = Object.keys(parsed as Record<string, unknown>)[0];
        if (typeof key === 'string') return key;
      }
    } catch {
      // Not a parseable quoted key — fall through to the plain token.
    }
  }
  return t;
}

/**
 * Compute the line spans of each top-level key. A key owns its `key:` line up
 * to (but excluding) the next top-level key; indented lines, `- ` sequence
 * items and block-scalar bodies in between are continuations. A blank line is
 * only a continuation when a real continuation follows it.
 */
function keySpans(lines: string[]): KeySpan[] {
  const spans: KeySpan[] = [];
  let i = 0;
  while (i < lines.length) {
    const rawKey = topLevelKeyOf(lines[i]);
    if (rawKey == null) {
      i += 1;
      continue;
    }
    const start = i;
    let end = i + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line === '') {
        const nextReal = lines.slice(end + 1).find((x) => x !== '');
        const follows = nextReal
          ? nextReal.startsWith(' ') || nextReal.startsWith('\t') || nextReal.startsWith('-')
          : false;
        if (!follows) break;
        end += 1;
      } else if (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('-')) {
        end += 1;
      } else {
        break;
      }
    }
    spans.push({ key: unquoteKey(rawKey), start, end });
    i = end;
  }
  return spans;
}

/** Render one key's entry through js-yaml (quoting/typing decided there). */
function renderEntry(key: string, value: unknown): string[] {
  let dumped: string;
  try {
    dumped = yaml.dump({ [key]: value }, { lineWidth: -1, noRefs: true, skipInvalid: true });
  } catch (e) {
    throw new FrontmatterPatchError(`cannot serialize frontmatter key "${key}": ${String(e)}`);
  }
  const trimmed = dumped.endsWith('\n') ? dumped.slice(0, -1) : dumped;
  return trimmed.split('\n');
}

/** A `---\n…\n---` block (no trailing newline), using the requested EOL. */
function dumpBlock(data: Record<string, unknown>, nl: string): string {
  const yamlStr = yaml
    .dump(data, { lineWidth: -1, noRefs: true, skipInvalid: true })
    .replace(/\n$/, '');
  const inner = nl === '\r\n' ? yamlStr.replace(/\n/g, '\r\n') : yamlStr;
  return `---${nl}${inner}${nl}---`;
}

/**
 * Split a document into its frontmatter object and the untouched body.
 * Never throws: malformed YAML yields `data: {}` + the whole text as body so
 * callers can still operate.
 */
export function splitFrontmatter(text: string): SplitDoc {
  const layout = splitLayout(text);
  if (!layout.hadBlock) {
    return { bom: layout.bom, data: {}, hadBlock: false, body: layout.body };
  }
  const { data } = parseInner(layout);
  return { bom: layout.bom, data, hadBlock: true, body: layout.body };
}

/** Serialize a frontmatter object into a `---\n…\n---` block (no trailing nl). */
export function dumpFrontmatter(data: Record<string, unknown>): string {
  return dumpBlock(data, '\n');
}

/**
 * Apply `patch` to a document's frontmatter and return the new full text plus a
 * report. See the module header for the exact fidelity contract and the
 * degradation policy.
 */
export function patchFrontmatterWithReport(
  text: string,
  patch: Record<string, unknown>,
): FrontmatterPatchReport {
  const layout = splitLayout(text);

  // No block yet: synthesize one for the keys that are actually being set.
  if (!layout.hadBlock) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return { text, degraded: null };
    const nl = layout.nl;
    const block = `---${nl}${entries
      .map(([k, v]) => renderEntry(k, v).join(nl))
      .join(nl)}${nl}---`;
    const sep = layout.body.length
      ? /^\r?\n/.test(layout.body)
        ? nl
        : nl + nl
      : nl;
    return { text: `${layout.bom}${block}${sep}${layout.body}`, degraded: null };
  }

  const parsed = parseInner(layout);
  const spans = keySpans(layout.lines.map((l) => l.text));

  // Duplicate keys cannot be patched unambiguously.
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.key)) {
      throw new FrontmatterPatchError(`duplicate frontmatter key "${span.key}"`);
    }
    seen.add(span.key);
  }

  if (!parsed.valid) {
    // Repair path: the block cannot be trusted line-by-line, so re-emit it
    // whole. The caller is told, so no comment loss happens silently.
    const next: Record<string, unknown> = { ...parsed.data };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    const closeEol = layout.close.slice(3);
    return {
      text: `${layout.bom}${dumpBlock(next, layout.nl)}${closeEol}${layout.body}`,
      degraded: { reason: 'invalid-yaml' },
    };
  }

  if (!parsed.isMap) {
    throw new FrontmatterPatchError('frontmatter root is not a mapping');
  }

  // Deleting an anchored key that is aliased elsewhere would dangle the alias.
  const innerText = layout.lines.map((l) => l.text).join('\n');
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) continue;
    const span = spans.find((s) => s.key === key);
    if (!span) continue;
    const spanText = layout.lines.slice(span.start, span.end).map((l) => l.text).join('\n');
    const anchor = /&([A-Za-z0-9_-]+)/.exec(spanText);
    if (anchor && new RegExp(`\\*${anchor[1]}(?![A-Za-z0-9_-])`).test(innerText)) {
      throw new FrontmatterPatchError(
        `cannot delete anchored key "${key}" while "${anchor[1]}" is aliased`,
      );
    }
  }

  // Replace / delete the keys that exist; collect the rest for appending.
  const replacements = new Map<number, { lines: string[]; eol: string } | null>();
  const spanByStart = new Map<number, KeySpan>();
  const appended: [string, unknown][] = [];

  for (const [key, value] of Object.entries(patch)) {
    const span = spans.find((s) => s.key === key);
    if (!span) {
      if (value !== undefined) appended.push([key, value]);
      continue;
    }
    spanByStart.set(span.start, span);
    if (value === undefined) {
      replacements.set(span.start, null);
      continue;
    }
    const startEol = layout.lines[span.start].eol;
    const lastEol = layout.lines[span.end - 1]?.eol;
    const lines = renderEntry(key, value);
    replacements.set(span.start, { lines, eol: lastEol || startEol || layout.nl });
  }

  const result: BlockLine[] = [];
  let i = 0;
  while (i < layout.lines.length) {
    const rep = replacements.get(i);
    if (rep !== undefined) {
      const span = spanByStart.get(i)!;
      if (rep) {
        for (const lineText of rep.lines) result.push({ text: lineText, eol: rep.eol });
      }
      i = span.end;
      continue;
    }
    result.push(layout.lines[i]);
    i += 1;
  }

  if (appended.length) {
    const last = result[result.length - 1];
    if (last && last.eol === '') last.eol = layout.nl;
    for (const [key, value] of appended) {
      for (const lineText of renderEntry(key, value)) {
        result.push({ text: lineText, eol: layout.nl });
      }
    }
  }

  // Nothing but blank lines left → drop the block entirely. Comments are kept.
  const innerRaw = result.map((l) => l.text + l.eol).join('');
  const keysLeft = keySpans(result.map((l) => l.text));
  if (!keysLeft.length && !result.some((l) => l.text.trim() !== '')) {
    return { text: `${layout.bom}${layout.body}`, degraded: null };
  }

  return {
    text: `${layout.bom}${layout.open}${innerRaw}${layout.close}${layout.body}`,
    degraded: null,
  };
}

/**
 * Apply `patch` to a document's frontmatter and return the new full text.
 *
 * - Keys whose patched value is `undefined` are DELETED from the frontmatter.
 * - Only the named keys' lines change; all other bytes (comments, key order,
 *   quote style, CRLF, trailing spaces) are preserved exactly, and so is the
 *   body.
 * - When the source had no frontmatter block, one is created at the very top.
 * - On an unparseable existing block the block is repaired whole; that is
 *   logged (use `patchFrontmatterWithReport` to surface it to the user).
 * - Unpatchable structures throw `FrontmatterPatchError` without touching text.
 */
export function patchFrontmatter(
  text: string,
  patch: Record<string, unknown>,
): string {
  const report = patchFrontmatterWithReport(text, patch);
  if (report.degraded) {
    console.warn(`[frontmatter] ${report.degraded.reason}: rewrote the whole block`);
  }
  return report.text;
}
