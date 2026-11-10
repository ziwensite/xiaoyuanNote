/**
 * The canonical shape of a task line (batches 7–8).
 *
 * One place decides what a task line is allowed to look like:
 *
 *   open 状态字符 描述 #tags 🆔 ⛔ 🔁 ➕ 🛫 ⏳ 📅 优先级 ❌ ✅ 未识别片段
 *
 * with exactly one space between neighbours. `open` is everything up to and
 * including `[` — indentation, quote markers and the bullet are never rewritten,
 * so a re-serialized line keeps its own shape. The line terminator is not part
 * of the model either: callers replace one line's text, never the `\r\n`.
 *
 * Only the parts we understand are moved: words the tokenizer does not
 * recognise are kept, in their original relative order, after the standard
 * tokens. Nothing is dropped. A marker glued to its neighbour (`every day🛫`,
 * `2026-11-10📅`, `⏫🔁`) is split on the marker, so the canonical rewrite is
 * also the repair for a line that was written without separators.
 *
 * `writeTaskLine` is the single exit every writer goes through — the space menu,
 * the task editor, the normalize command, the checkbox toggle and the next
 * occurrence of a recurring task. It serializes the line *and* keeps the status
 * and the two closing dates (`✅` / `❌`) in step: see `linkTaskDates`.
 */

export type TaskDateField = 'created' | 'start' | 'scheduled' | 'due' | 'completed' | 'cancelled';

export interface TaskDateFieldSpec {
  field: TaskDateField;
  marker: string;
  zh: string;
  en: string;
}

/** A checkbox on a bullet, ordered or quoted line, with any status character. */
export const TASK_LINE_RE =
  /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\][ \t])/u;

/** Emoji the menu offers and the editor shows, in menu order. */
export const TASK_DATE_FIELDS: TaskDateFieldSpec[] = [
  { field: 'created', marker: '➕', zh: '创建', en: 'Created' },
  { field: 'start', marker: '🛫', zh: '开始', en: 'Start' },
  { field: 'scheduled', marker: '⏳', zh: '计划', en: 'Scheduled' },
  { field: 'due', marker: '📅', zh: '截止', en: 'Due' },
  { field: 'completed', marker: '✅', zh: '完成', en: 'Done' },
  { field: 'cancelled', marker: '❌', zh: '取消', en: 'Cancelled' },
];

export interface TaskPrioritySpec {
  emoji: string;
  zh: string;
  en: string;
}

/** Highest first. `⏺` is not a stored priority — it is the "clear" choice. */
export const TASK_PRIORITIES: TaskPrioritySpec[] = [
  { emoji: '🔺', zh: '最高', en: 'Highest' },
  { emoji: '⏫', zh: '较高', en: 'High' },
  { emoji: '🔼', zh: '中等', en: 'Medium' },
  { emoji: '🔽', zh: '较低', en: 'Low' },
  { emoji: '⏬', zh: '最低', en: 'Lowest' },
];

export const TASK_CLEAR_PRIORITY = '⏺';

export interface TaskStatusSpec {
  char: string;
  zh: string;
  en: string;
}

export const TASK_STATUSES: TaskStatusSpec[] = [
  { char: ' ', zh: '未开始', en: 'To do' },
  { char: '/', zh: '进行中', en: 'In progress' },
  { char: 'x', zh: '完成', en: 'Done' },
  { char: '-', zh: '已取消', en: 'Cancelled' },
  { char: '?', zh: '待定', en: 'Question' },
];

/** Everything the three writers can change about one task line. */
export interface TaskLineModel {
  /** Indentation, quote markers, bullet and `[`, exactly as written. */
  open: string;
  status: string;
  description: string;
  /** Tag names without `#`, in the order the line had them. */
  tags: string[];
  id: string;
  blockedBy: string;
  /** The rule text without `🔁`, e.g. `every 2 weeks`. */
  recurrence: string;
  created: string;
  start: string;
  scheduled: string;
  due: string;
  priority: string;
  cancelled: string;
  completed: string;
  /** Words we did not recognise, in their original relative order. */
  extra: string[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_WORD_RE = /^(➕|🛫|⏳|📅|✅|❌)(.*)$/u;
const ID_WORD_RE = /^🆔(.*)$/u;
const BLOCKED_WORD_RE = /^⛔(.*)$/u;
const PRIORITY_WORD_RE = /^(🔺|⏫|🔼|🔽|⏬)$/u;
const RECURRENCE_START = '🔁';
/** `🏁 keep` / `🏁 delete` — a task token, but not one this module orders. */
const RECURRENCE_ACTION = '🏁';

/**
 * Every character that begins a token. Splitting on these is what repairs a
 * line written without spaces (`every day🛫`, `2026-11-10📅`, `⏫🔁`).
 */
const MARKER_CHAR_RE = /([➕🛫⏳📅✅❌🔁🆔⛔🔺⏫🔼🔽⏬⏺🏁])/gu;

/** Whitespace-separated words, with a marker glued to text split off it. */
function splitWords(body: string): string[] {
  return body
    .replace(MARKER_CHAR_RE, ' $1 ')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Does this word begin a marker (so a `🔁` rule must stop before it)? */
function startsToken(word: string): boolean {
  return (
    word.startsWith('#') ||
    word.startsWith(RECURRENCE_START) ||
    word === RECURRENCE_ACTION ||
    DATE_WORD_RE.test(word) ||
    ID_WORD_RE.test(word) ||
    BLOCKED_WORD_RE.test(word) ||
    PRIORITY_WORD_RE.test(word) ||
    word === TASK_CLEAR_PRIORITY
  );
}

/** Length of the prefix (`- [ ]` → the part that ends with the `] ` separator). */
export function taskLinePrefixLength(line: string): number {
  return TASK_LINE_RE.exec(line)?.[0].length ?? 0;
}

/** The model, or null when the line is not a task line at all. */
export function parseTaskLine(line: string): TaskLineModel | null {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return null;

  const model: TaskLineModel = {
    open: m[1],
    status: m[2],
    description: '',
    tags: [],
    id: '',
    blockedBy: '',
    recurrence: '',
    created: '',
    start: '',
    scheduled: '',
    due: '',
    priority: '',
    cancelled: '',
    completed: '',
    extra: [],
  };

  const words = splitWords(line.slice(m[0].length));
  const leading: string[] = [];
  let seenToken = false;
  const text = (word: string) => {
    if (seenToken) model.extra.push(word);
    else leading.push(word);
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word.startsWith(RECURRENCE_START)) {
      const parts = [word.slice(RECURRENCE_START.length)];
      while (i + 1 < words.length && !startsToken(words[i + 1])) parts.push(words[++i]);
      const rule = parts.join(' ').trim();
      // A bare `🔁` is an unfinished token, not a rule: keep the bytes.
      if (rule) {
        model.recurrence = rule;
        seenToken = true;
        continue;
      }
      text(word);
      continue;
    }

    if (word.startsWith('#')) {
      const name = word.replace(/^#+/u, '').trim();
      if (name) {
        model.tags.push(name);
        seenToken = true;
        continue;
      }
      text(word);
      continue;
    }

    if (ID_WORD_RE.test(word)) {
      let value = ID_WORD_RE.exec(word)![1].trim();
      if (!value && i + 1 < words.length && !startsToken(words[i + 1])) value = words[++i];
      model.id = value;
      seenToken = true;
      continue;
    }

    if (BLOCKED_WORD_RE.test(word)) {
      let value = BLOCKED_WORD_RE.exec(word)![1].trim();
      if (!value && i + 1 < words.length && !startsToken(words[i + 1])) value = words[++i];
      model.blockedBy = value;
      seenToken = true;
      continue;
    }

    if (PRIORITY_WORD_RE.test(word)) {
      model.priority = word;
      seenToken = true;
      continue;
    }

    if (word === TASK_CLEAR_PRIORITY) {
      model.priority = '';
      seenToken = true;
      continue;
    }

    const date = DATE_WORD_RE.exec(word);
    if (date) {
      const spec = TASK_DATE_FIELDS.find((f) => f.marker === date[1])!;
      let value = date[2].trim();
      if (!value && ISO_RE.test(words[i + 1] ?? '')) value = words[++i];
      // A marker with anything else after it is not a token we understand;
      // keep the word as text rather than writing it back mangled.
      if (ISO_RE.test(value)) {
        model[spec.field] = value;
        seenToken = true;
        continue;
      }
    }

    text(word);
  }

  model.description = leading.join(' ');
  return model;
}

/** One canonical string for a model. Never touches the line terminator. */
export function serializeTaskLine(model: TaskLineModel): string {
  const parts: string[] = [];
  const push = (value: string) => {
    const text = value.trim();
    if (text) parts.push(text);
  };

  push(model.description);
  for (const tag of model.tags) {
    const name = tag.replace(/^#+/u, '').trim();
    if (name) push(`#${name}`);
  }
  if (model.id.trim()) push(`🆔 ${model.id.trim()}`);
  if (model.blockedBy.trim()) push(`⛔ ${model.blockedBy.trim()}`);
  if (model.recurrence.trim()) push(`🔁 ${model.recurrence.trim().replace(/\s+/gu, ' ')}`);

  for (const spec of TASK_DATE_FIELDS) {
    if (spec.field === 'cancelled' || spec.field === 'completed') continue;
    const value = model[spec.field].trim();
    if (value) push(`${spec.marker} ${value}`);
  }
  if (model.priority.trim()) push(model.priority.trim());
  if (model.cancelled.trim()) push(`❌ ${model.cancelled.trim()}`);
  if (model.completed.trim()) push(`✅ ${model.completed.trim()}`);

  for (const extra of model.extra) push(extra);

  return `${model.open}${model.status}] ${parts.join(' ')}`;
}

/**
 * The canonical form of one task line, or null when the line is not a task.
 * Idempotent: normalizing a normalized line changes nothing.
 */
export function normalizeTaskLine(line: string): string | null {
  const model = parseTaskLine(line);
  return model ? serializeTaskLine(model) : null;
}

/** Which side of the status ↔ closing-date link a write touched. */
export interface TaskDateLink {
  /** The status character was the thing being set. */
  status?: boolean;
  completed?: boolean;
  cancelled?: boolean;
}

/** The date field that records the moment a status closes a task. */
function closingField(status: string): TaskDateField | null {
  if (status === 'x' || status === 'X') return 'completed';
  if (status === '-') return 'cancelled';
  return null;
}

/**
 * Status → date: completing stamps `✅ today`, cancelling stamps `❌ today`, and
 * every other status (todo, in progress, question…) leaves no closing date at
 * all. The two never coexist, so the opposite one is dropped.
 */
function applyStatus(model: TaskLineModel, today: string): void {
  const closing = closingField(model.status);
  if (closing === 'completed') {
    model.completed = today;
    model.cancelled = '';
  } else if (closing === 'cancelled') {
    model.cancelled = today;
    model.completed = '';
  } else {
    model.completed = '';
    model.cancelled = '';
  }
}

/**
 * Date → status: setting a closing date decides the status, and the two stay
 * exclusive. *Clearing* one only removes the token — the status is left alone,
 * because "done, without a date" is a state the user can ask for on purpose.
 */
function applyClosing(model: TaskLineModel, field: 'completed' | 'cancelled'): void {
  if (!model[field].trim()) return;
  if (field === 'completed') {
    model.status = 'x';
    model.cancelled = '';
  } else {
    model.status = '-';
    model.completed = '';
  }
}

/**
 * Apply the status ↔ `✅`/`❌` link in place.
 *
 * `link` names the side the user just changed, in priority order: the status
 * first, then `✅`, then `❌` — so setting a date and a status in the same write
 * ends with the explicit date winning. Clearing a date is not a change that
 * propagates: "done with no date" should stay done. A `null` link changes
 * nothing except enforcing the mutex (a line may never carry both dates), which
 * is what every other write — a priority, a tag, the normalize command — gets.
 */
export function linkTaskDates(model: TaskLineModel, link: TaskDateLink | null, today: string): void {
  if (link?.status) applyStatus(model, today);
  if (link?.completed) applyClosing(model, 'completed');
  if (link?.cancelled) applyClosing(model, 'cancelled');
  if (model.completed.trim() && model.cancelled.trim()) {
    if (closingField(model.status) === 'cancelled') model.completed = '';
    else model.cancelled = '';
  }
}

/**
 * The one write exit (batch 8): canonical order, single spaces, and the status /
 * closing-date link applied. Null when the line is not a task — the caller must
 * not write then.
 */
export function writeTaskLine(
  line: string,
  today: string,
  link: TaskDateLink | null = null,
): string | null {
  const model = parseTaskLine(line);
  if (!model) return null;
  linkTaskDates(model, link, today);
  return serializeTaskLine(model);
}
