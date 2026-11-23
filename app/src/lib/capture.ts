/**
 * Capture presets — the manual half of §6 in the entry-unification spec.
 *
 * A preset is pure data: where to put a snippet and what the snippet looks
 * like. Everything in this file is a pure function so the executor only has to
 * do I/O, and the settings page can preview the exact text without touching
 * the workspace.
 *
 * There is no de-duplication here on purpose: pressing a preset twice inserts
 * twice. Automatic writes (calendar → daily note) go through `entry-writer`,
 * which does match on `🆔`; this is the explicit, user-driven layer.
 */

import { formatDailyFilename, isoDate } from './daily-notes';
import { joinInFolder } from './import-plan';
import { PERIOD_KINDS, periodicPath, type PeriodicConfig, type PeriodKind } from './periodic-notes';

export type CaptureTarget = 'file' | 'folder' | 'periodic' | 'active' | 'inbox';
export type CapturePlacement = 'top' | 'bottom' | 'heading';
export type CaptureInputMethod = 'single-line' | 'multi-line' | 'none';
export type CaptureDueDateOption = 'today' | 'custom' | 'weekend' | 'monthEnd' | 'yearEnd';
export type CaptureNewLineDirection = 'above' | 'below';
export type CaptureOpenLocation = 'reuse' | 'tab' | 'split' | 'window';
export type CaptureOpenDirection = 'vertical' | 'horizontal';
export type CaptureOpenMode = 'default' | 'source' | 'live' | 'preview';

export interface CapturePreset {
  id: string;
  name: string;
  /** Built-in presets cannot be deleted; `flash` is the shipped default. */
  builtIn?: boolean;
  description: string;
  enabled: boolean;
  target: CaptureTarget;
  inputMethod: CaptureInputMethod;
  /** `file`: exact workspace-relative path. `folder`: the folder to create in. */
  path: string;
  /** `folder` only: file name pattern, same tokens as periodic formats. */
  fileName: string;
  /** `periodic` only. */
  period: PeriodKind;
  placement: CapturePlacement;
  /** `heading` only; an exact line match (leading/trailing space ignored). */
  heading: string;
  template: string;
  /** New-note presets can describe their own YAML front matter. */
  frontmatterEnabled: boolean;
  frontmatterTemplate: string;
  markInbox: boolean;
  /** Append `➕ <today>` to the first task line when it has none. */
  autoCreated: boolean;
  /** Append `📅 <today>` to the first task line when it has none. */
  autoDue: boolean;
  /** Create a missing target file instead of aborting. */
  createIfMissing: boolean;
  /** Insert a `[[wikilink]]` to the captured file into the active editor. */
  appendLink: boolean;
  /** False writes only `{{value}}`; used for plain-value captures. */
  formatEnabled: boolean;
  /** Prefill a new target file from another workspace note. */
  createWithTemplate: boolean;
  creationTemplate: string;
  /** Due-date calculation used by the automatic 📅 token. */
  dueDateOption: CaptureDueDateOption;
  customDueDays: number;
  /** `heading` insertion options, mirroring the reference plugin. */
  headingInsertAtEnd: boolean;
  headingConsiderSubsections: boolean;
  headingCreateIfMissing: boolean;
  headingCreateLocation: 'top' | 'bottom';
  /** `active` target: insert on a new line above/below instead of at the caret. */
  newLineEnabled: boolean;
  newLineDirection: CaptureNewLineDirection;
  /** Where and how the captured file is opened. */
  openAfter: boolean;
  openLocation: CaptureOpenLocation;
  openDirection: CaptureOpenDirection;
  openMode: CaptureOpenMode;
  openFocus: boolean;
}

export const CAPTURE_PLACEMENTS: readonly CapturePlacement[] = ['top', 'bottom', 'heading'];
export const CAPTURE_TARGETS: readonly CaptureTarget[] = ['inbox', 'file', 'folder', 'periodic', 'active'];
export const CAPTURE_INPUT_METHODS: readonly CaptureInputMethod[] = ['single-line', 'multi-line', 'none'];
export const CAPTURE_PERIODS: readonly PeriodKind[] = PERIOD_KINDS;
export const CAPTURE_DUE_OPTIONS: readonly CaptureDueDateOption[] = ['today', 'custom', 'weekend', 'monthEnd', 'yearEnd'];
export const CAPTURE_NEW_LINE_DIRECTIONS: readonly CaptureNewLineDirection[] = ['above', 'below'];
export const CAPTURE_OPEN_LOCATIONS: readonly CaptureOpenLocation[] = ['reuse', 'tab', 'split', 'window'];
export const CAPTURE_OPEN_DIRECTIONS: readonly CaptureOpenDirection[] = ['vertical', 'horizontal'];
export const CAPTURE_OPEN_MODES: readonly CaptureOpenMode[] = ['default', 'source', 'live', 'preview'];

/** Variables a template may use. Unknown names are left untouched. */
export const CAPTURE_VARIABLES = [
  'value',
  'input',
  'selection',
  'clipboard',
  'date',
  'time',
  'title',
  'file',
  'folder',
  'filePath',
  'url',
  'tags',
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function newCapturePreset(id: string, name = 'Capture'): CapturePreset {
  return {
    id,
    name,
    description: '',
    enabled: true,
    target: 'file',
    inputMethod: 'single-line',
    path: '',
    fileName: 'YYYY-MM-DD.md',
    period: 'daily',
    placement: 'bottom',
    heading: '## 任务',
    template: '- [ ] {{input}}',
    frontmatterEnabled: false,
    frontmatterTemplate: '',
    markInbox: false,
    autoCreated: false,
    autoDue: false,
    createIfMissing: true,
    appendLink: false,
    formatEnabled: true,
    createWithTemplate: false,
    creationTemplate: '',
    dueDateOption: 'today',
    customDueDays: 0,
    headingInsertAtEnd: false,
    headingConsiderSubsections: false,
    headingCreateIfMissing: true,
    headingCreateLocation: 'bottom',
    newLineEnabled: false,
    newLineDirection: 'below',
    openAfter: false,
    openLocation: 'reuse',
    openDirection: 'vertical',
    openMode: 'default',
    openFocus: true,
  };
}

/**
 * Built-in capture scenarios. A preset is pure data: the flash preset writes
 * into its own folder, the others write into periodic notes or a folder.
 */
export function defaultCapturePresets(): CapturePreset[] {
  const base = newCapturePreset('', '');
  return [
    {
      ...base,
      id: 'flash',
      name: '闪念',
      builtIn: true,
      description: '把一句话记入闪念文件夹',
      enabled: true,
      target: 'folder',
      inputMethod: 'single-line',
      path: 'Flash',
      fileName: 'YYYY-MM-DD-HHmm.md',
      placement: 'bottom',
      heading: '## 闪念',
      template: '- 💡 {{date}} {{time}} {{input}}',
      autoCreated: false,
      autoDue: false,
      createIfMissing: true,
      appendLink: false,
      openAfter: false,
    },
    {
      ...base,
      id: 'record',
      name: '记录',
      description: '追加一条记录到今日日记',
      enabled: true,
      target: 'periodic',
      inputMethod: 'single-line',
      path: '',
      fileName: 'YYYY-MM-DD.md',
      period: 'daily',
      placement: 'bottom',
      heading: '## 笔记',
      template: '- 📝 {{input}}',
      autoCreated: false,
      autoDue: false,
      createIfMissing: true,
      appendLink: false,
      openAfter: false,
    },
    {
      ...base,
      id: 'task',
      name: '任务',
      description: '追加一个待办到今日日记',
      enabled: true,
      target: 'periodic',
      inputMethod: 'single-line',
      path: '',
      fileName: 'YYYY-MM-DD.md',
      period: 'daily',
      placement: 'bottom',
      heading: '## 今日要事',
      template: '- [ ] ⏰ {{input}}',
      autoCreated: false,
      autoDue: true,
      createIfMissing: true,
      appendLink: false,
      openAfter: false,
    },
    {
      ...base,
      id: 'inbox',
      name: '收件箱笔记',
      description: '新建一篇收件箱笔记并标记 inbox: true',
      enabled: true,
      target: 'inbox',
      inputMethod: 'single-line',
      path: 'inbox',
      fileName: 'YYYY-MM-DD-HHmm.md',
      formatEnabled: false,
      template: '{{value}}',
      frontmatterEnabled: true,
      frontmatterTemplate: 'title: {{value}}\ninbox: {{inbox}}\ncaptured_at: {{capturedAt}}',
      markInbox: true,
      placement: 'bottom',
      appendLink: false,
      openAfter: false,
    },
  ];
}

/** Keep only well-formed presets so a hand-edited settings blob cannot crash the palette. */
export function normalizeCapturePresets(value: unknown): CapturePreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CapturePreset[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const base = newCapturePreset(id, name);
    out.push({
      ...base,
      id,
      name,
      builtIn: item.builtIn === true && id === 'flash',
      description: typeof item.description === 'string' ? item.description : base.description,
      enabled: item.enabled !== false,
      inputMethod: CAPTURE_INPUT_METHODS.includes(item.inputMethod as CaptureInputMethod)
        ? (item.inputMethod as CaptureInputMethod)
        : base.inputMethod,
      target: CAPTURE_TARGETS.includes(item.target as CaptureTarget)
        ? (item.target as CaptureTarget)
        : base.target,
      path: typeof item.path === 'string' ? item.path : base.path,
      fileName: typeof item.fileName === 'string' && item.fileName ? item.fileName : base.fileName,
      period: CAPTURE_PERIODS.includes(item.period as PeriodKind)
        ? (item.period as PeriodKind)
        : base.period,
      placement: CAPTURE_PLACEMENTS.includes(item.placement as CapturePlacement)
        ? (item.placement as CapturePlacement)
        : base.placement,
      heading: typeof item.heading === 'string' ? item.heading : base.heading,
      template: typeof item.template === 'string' ? item.template : base.template,
      frontmatterEnabled: item.frontmatterEnabled === true,
      frontmatterTemplate: typeof item.frontmatterTemplate === 'string'
        ? item.frontmatterTemplate
        : base.frontmatterTemplate,
      markInbox: item.markInbox === true,
      autoCreated: item.autoCreated === true,
      autoDue: item.autoDue === true,
      createIfMissing: item.createIfMissing !== false,
      appendLink: item.appendLink === true,
      formatEnabled: item.formatEnabled !== false,
      createWithTemplate: item.createWithTemplate === true,
      creationTemplate: typeof item.creationTemplate === 'string' ? item.creationTemplate : base.creationTemplate,
      dueDateOption: CAPTURE_DUE_OPTIONS.includes(item.dueDateOption as CaptureDueDateOption)
        ? (item.dueDateOption as CaptureDueDateOption)
        : base.dueDateOption,
      customDueDays: Number.isFinite(item.customDueDays)
        ? Math.max(0, Math.trunc(item.customDueDays as number))
        : base.customDueDays,
      headingInsertAtEnd: item.headingInsertAtEnd !== false,
      headingConsiderSubsections: item.headingConsiderSubsections === true,
      headingCreateIfMissing: item.headingCreateIfMissing !== false,
      headingCreateLocation: item.headingCreateLocation === 'top' ? 'top' : base.headingCreateLocation,
      newLineEnabled: item.newLineEnabled === true,
      newLineDirection: CAPTURE_NEW_LINE_DIRECTIONS.includes(item.newLineDirection as CaptureNewLineDirection)
        ? (item.newLineDirection as CaptureNewLineDirection)
        : base.newLineDirection,
      openAfter: item.openAfter === true,
      openLocation: CAPTURE_OPEN_LOCATIONS.includes(item.openLocation as CaptureOpenLocation)
        ? (item.openLocation as CaptureOpenLocation)
        : base.openLocation,
      openDirection: CAPTURE_OPEN_DIRECTIONS.includes(item.openDirection as CaptureOpenDirection)
        ? (item.openDirection as CaptureOpenDirection)
        : base.openDirection,
      openMode: CAPTURE_OPEN_MODES.includes(item.openMode as CaptureOpenMode)
        ? (item.openMode as CaptureOpenMode)
        : base.openMode,
      openFocus: item.openFocus !== false,
    });
  }
  return out;
}

export interface CaptureVariables {
  /** `{{value}}` and `{{input}}` are aliases for the same user-provided text. */
  value?: string;
  input?: string;
  selection?: string;
  clipboard?: string;
  url?: string;
  tags?: string;
  filePath?: string;
  folder?: string;
  file?: string;
  /** Defaults to now. */
  date?: Date;
  /** Defaults to the ISO date, which is a useful note title. */
  title?: string;
  /** Full ISO timestamp for front matter templates. */
  capturedAt?: string;
  /** `true`/`false`, derived from the preset's `markInbox`. */
  inbox?: string;
}

export function expandCaptureTemplate(template: string, vars: CaptureVariables = {}): string {
  const date = vars.date ?? new Date();
  const value = vars.value ?? vars.input ?? '';
  const filePath = vars.filePath ?? '';
  const file = vars.file ?? (filePath ? filePath.split(/[\\/]/).pop() ?? '' : '');
  const folder = vars.folder ?? (filePath ? filePath.split(/[\\/]/).slice(0, -1).join('/') : '');
  const values: Record<string, string> = {
    value,
    input: value,
    selection: vars.selection ?? '',
    clipboard: vars.clipboard ?? '',
    url: vars.url ?? '',
    tags: vars.tags ?? '',
    filePath,
    file,
    folder,
    date: isoDate(date),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    title: vars.title ?? isoDate(date),
    capturedAt: vars.capturedAt ?? date.toISOString(),
    inbox: vars.inbox ?? 'false',
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? values[name] : match,
  );
}

/** The template actually used by a preset. Disabled formatting writes only the value. */
export function effectiveCaptureTemplate(preset: CapturePreset): string {
  return preset.formatEnabled ? preset.template : '{{value}}';
}

/** Resolve the 📅 date chosen by a preset (`weekend` means this Saturday, inclusive). */
export function captureDueDate(
  date: Date,
  option: CaptureDueDateOption = 'today',
  customDays = 0,
): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (option === 'custom') {
    out.setDate(out.getDate() + Math.max(0, Math.trunc(customDays)));
  } else if (option === 'weekend') {
    const delta = (6 - out.getDay() + 7) % 7;
    out.setDate(out.getDate() + delta);
  } else if (option === 'monthEnd') {
    out.setDate(new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate());
  } else if (option === 'yearEnd') {
    out.setMonth(11, 31);
  }
  return out;
}

/**
 * Add `➕` / `📅` to the first task line, unless that token is already there.
 *
 * The line keeps whatever the template wrote — we only append. That is why the
 * result is not run through the task serializer: a deliberate prefix (quote,
 * indentation) must survive an automatic capture.
 */
export function applyCaptureTokens(
  snippet: string,
  date: Date,
  autoCreated: boolean,
  autoDue: boolean,
  dueDateOption: CaptureDueDateOption = 'today',
  customDueDays = 0,
): string {
  if (!autoCreated && !autoDue) return snippet;
  const created = isoDate(date);
  const due = isoDate(captureDueDate(date, dueDateOption, customDueDays));
  const lines = snippet.split('\n');
  const index = lines.findIndex((line) => /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/.test(line));
  if (index === -1) return snippet;
  let line = lines[index];
  if (autoCreated && !line.includes('➕')) line = `${line} ➕ ${created}`;
  if (autoDue && !line.includes('📅')) line = `${line} 📅 ${due}`;
  lines[index] = line;
  return lines.join('\n');
}

export function splitCaptureFrontmatter(text: string): { head: string; body: string } {
  if (!text.startsWith('---')) return { head: '', body: text };
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { head: '', body: text };
  const block = match[0];
  const head = block
    .replace(/^---\r?\n/, '')
    .replace(/\r?\n---[ \t]*(?:\r?\n|$)?$/, '');
  return { head, body: text.slice(block.length) };
}

export function formatCaptureFrontmatter(head: string): string {
  const trimmed = head.trim();
  return trimmed ? `---\n${trimmed}\n---\n\n` : '';
}

/** Remove an existing YAML block, leaving only the note body. */
export function stripCaptureFrontmatter(text: string): string {
  return splitCaptureFrontmatter(text).body;
}

function topLevelYamlKey(line: string): string | null {
  if (!line || /^\s/.test(line)) return null;
  return /^([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1] ?? null;
}

function yamlBlockEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '' || /^\s/.test(line) || line.trimStart().startsWith('#')) end += 1;
    else break;
  }
  return end;
}

function splitYamlAdditions(additions: string): { key: string | null; lines: string[] }[] {
  const blocks: { key: string | null; lines: string[] }[] = [];
  for (const line of additions.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue;
    const key = topLevelYamlKey(line);
    if (key || !blocks.length) blocks.push({ key, lines: [line] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

/** Merge preset fields into template YAML; preset fields win on key clashes. */
export function mergeCaptureFrontmatter(baseHead: string, additions: string): string {
  const extra = splitYamlAdditions(additions);
  if (!extra.length) return baseHead.trim();
  const baseLines = baseHead.replace(/\r/g, '').split('\n');
  const used = new Set<number>();
  const out: string[] = [];
  for (let i = 0; i < baseLines.length;) {
    const key = topLevelYamlKey(baseLines[i]);
    const matchIndex = key
      ? extra.findIndex((block, index) => !used.has(index) && block.key === key)
      : -1;
    if (matchIndex >= 0) {
      out.push(...extra[matchIndex].lines);
      used.add(matchIndex);
      i = yamlBlockEnd(baseLines, i);
    } else {
      out.push(baseLines[i]);
      i += 1;
    }
  }
  extra.forEach((block, index) => {
    if (!used.has(index)) out.push(...block.lines);
  });
  return out.join('\n').trim();
}

export interface CaptureInsertOptions {
  insertAtEnd?: boolean;
  considerSubsections?: boolean;
  createIfMissing?: boolean;
  createLocation?: 'top' | 'bottom';
}

export interface CaptureInsertResult {
  content: string;
  inserted: boolean;
  reason?: 'emptyText' | 'missingHeading';
  missingHeading?: string;
}

function headingLevel(line: string): number {
  const match = /^\s{0,3}(#{1,6})\s/.exec(line);
  return match?.[1] ? match[1].length : -1;
}

function findHeadingLine(lines: readonly string[], target: string): number {
  const needle = target.replace(/\\n/g, '').trimEnd();
  if (!needle) return -1;
  let partial = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trimStart();
    if (line === needle) return i;
    if (line.startsWith(needle)) {
      if (line.slice(needle.length).trim() === '') return i;
      if (partial === -1) partial = i;
    }
  }
  return partial;
}

function findSectionEndLine(lines: readonly string[], start: number, includeSubsections: boolean): number {
  const level = headingLevel(lines[start] ?? '');
  if (level === -1) return start;
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const current = headingLevel(lines[i] ?? '');
    if (current !== -1 && (!includeSubsections || current <= level)) break;
    end = i;
  }
  while (end > start && !(lines[end] ?? '').trim()) end -= 1;
  return end;
}

/** Put a snippet into a note and report when a configured heading blocks it. */
export function composeCaptureInsert(
  text: string,
  snippet: string,
  placement: CapturePlacement,
  heading = '',
  options: CaptureInsertOptions = {},
): CaptureInsertResult {
  const block = snippet.replace(/\s+$/, '');
  if (!block) return { content: text, inserted: false, reason: 'emptyText' };

  const insertAtTop = (value: string) => {
    const { head, body } = splitCaptureFrontmatter(text);
    const rest = body.replace(/^\s*\n/, '');
    return `${formatCaptureFrontmatter(head)}${value}\n\n${rest}`.replace(/\n{3,}/g, (m) => m.slice(0, 2));
  };
  const appendAtBottom = (value: string) => {
    const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return `${prefix}${value}\n`;
  };
  const insertAfterLine = (value: string, lineIndex: number) => {
    const lines = text.split('\n');
    const before = lines.slice(0, lineIndex + 1).join('\n');
    const after = lines.slice(lineIndex + 1).join('\n').replace(/^\s*\n/, '');
    return `${before}\n\n${value}\n\n${after}`.replace(/\n{3,}/g, (m) => m.slice(0, 2));
  };

  if (placement === 'top') return { content: insertAtTop(block), inserted: true };

  if (placement === 'heading' && heading.trim()) {
    const wanted = heading.trim();
    const lines = text.split('\n');
    let index = findHeadingLine(lines, wanted);
    if (index !== -1 && options.insertAtEnd) {
      index = findSectionEndLine(lines, index, options.considerSubsections === true);
    }
    if (index !== -1) return { content: insertAfterLine(block, index), inserted: true };
    if (options.createIfMissing === false) {
      return { content: text, inserted: false, reason: 'missingHeading', missingHeading: wanted };
    }
    const value = `${wanted}\n\n${block}`;
    const createdAtBottom = text === ''
      ? `${value}\n`
      : `${text.replace(/\s+$/, '')}\n\n${value}\n`;
    return {
      content: options.createLocation === 'top' ? insertAtTop(value) : createdAtBottom,
      inserted: true,
    };
  }

  return { content: appendAtBottom(block), inserted: true };
}

/** Put a snippet into a note at the configured position. */
export function insertCaptureSnippet(
  text: string,
  snippet: string,
  placement: CapturePlacement,
  heading = '',
): string {
  return composeCaptureInsert(text, snippet, placement, heading).content;
}

/** Insert text at a 1-based `{line, col}` caret, clamping both ends. */
export function insertTextAtCursor(
  text: string,
  insert: string,
  cursor?: { line: number; col: number } | null,
): string {
  if (!insert) return text;
  if (!cursor || !Number.isFinite(cursor.line) || cursor.line < 1) return `${text}${insert}`;
  const lines = text.split('\n');
  const lineIndex = Math.min(cursor.line - 1, lines.length - 1);
  const line = lines[lineIndex] ?? '';
  const col = Math.max(0, Math.min((cursor.col || 1) - 1, line.length));
  let offset = col;
  for (let i = 0; i < lineIndex; i += 1) offset += (lines[i]?.length ?? 0) + 1;
  return `${text.slice(0, offset)}${insert}${text.slice(offset)}`;
}

/** Insert a capture on a new line above/below the active caret line. */
export function insertCaptureLine(
  text: string,
  insert: string,
  cursor: { line: number; col: number } | null | undefined,
  direction: CaptureNewLineDirection,
): string {
  if (!insert) return text;
  const lines = text.split('\n');
  const index = Math.max(0, Math.min((cursor?.line ?? lines.length) - 1, lines.length - 1));
  const block = insert.replace(/\s+$/, '');
  if (direction === 'above') lines.splice(index, 0, block);
  else lines.splice(index + 1, 0, block);
  return lines.join('\n');
}

/** Where a preset writes, relative to the workspace root. */
export function captureTargetRelativePath(
  preset: CapturePreset,
  periodic: PeriodicConfig,
  weekStartsOn: number,
  date: Date,
): string {
  if (preset.target === 'inbox') return '';
  if (preset.target === 'periodic') {
    return periodicPath(preset.period, date, periodic[preset.period], weekStartsOn);
  }
  if (preset.target === 'folder') {
    const name = formatDailyFilename(date, preset.fileName || 'YYYY-MM-DD.md');
    const folder = formatDailyFilename(date, preset.path.trim());
    return folder ? joinInFolder(folder, name) : name;
  }
  return formatDailyFilename(date, preset.path.trim());
}

/** Expand date tokens in a workspace-relative capture path. */
export function formatCapturePath(path: string, date: Date): string {
  return formatDailyFilename(date, path.trim());
}

/** Workspace-relative path for a new-note preset, fully owned by the preset. */
export function captureNoteRelativePath(preset: CapturePreset, date = new Date()): string {
  const folder = preset.path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const fileName = formatCapturePath(preset.fileName || 'YYYY-MM-DD.md', date);
  return [folder, fileName].filter(Boolean).join('/');
}

export interface CapturePresetRules {
  path: string;
  frontmatter: string;
  inbox: boolean;
}

/** Rules pushed to the Rust HTTP endpoint for the selected capture preset. */
export function capturePresetRules(
  preset: CapturePreset | undefined,
  date = new Date(),
): CapturePresetRules {
  return {
    path: preset ? captureNoteRelativePath(preset, date) : 'inbox/YYYY-MM-DD-HHmm.md',
    frontmatter: preset?.frontmatterEnabled ? preset.frontmatterTemplate : '',
    inbox: preset?.markInbox ?? true,
  };
}

/** Absolute path used by the frontend executor. */
export function captureTargetPath(
  preset: CapturePreset,
  root: string,
  periodic: PeriodicConfig,
  weekStartsOn: number,
  date: Date,
): string {
  return joinInFolder(root, captureTargetRelativePath(preset, periodic, weekStartsOn, date));
}

/** The text a preset would insert right now, before any insertion position is applied. */
export function capturePreview(
  preset: CapturePreset,
  vars: CaptureVariables = {},
): string {
  const date = vars.date ?? new Date();
  return applyCaptureTokens(
    expandCaptureTemplate(effectiveCaptureTemplate(preset), { ...vars, date }),
    date,
    preset.autoCreated,
    preset.autoDue,
    preset.dueDateOption,
    preset.customDueDays,
  );
}

/** The YAML block a preset wants at the top of a newly created note. */
export function renderCaptureFrontmatter(preset: CapturePreset, vars: CaptureVariables = {}): string {
  if (!preset.frontmatterEnabled) return '';
  const date = vars.date ?? new Date();
  const head = expandCaptureTemplate(preset.frontmatterTemplate, {
    ...vars,
    date,
    inbox: vars.inbox ?? (preset.markInbox ? 'true' : 'false'),
  }).trim();
  return formatCaptureFrontmatter(head);
}

/** Full note text a new-note preset would produce, front matter included. */
export function renderCaptureNote(preset: CapturePreset, vars: CaptureVariables = {}): string {
  return `${renderCaptureFrontmatter(preset, vars)}${capturePreview(preset, vars)}`;
}

function joinCaptureFrontmatter(head: string, body: string): string {
  const trimmed = head.trim();
  if (!trimmed) return body;
  const block = `---\n${trimmed}\n---\n`;
  return /^\r?\n/.test(body) ? `${block}${body}` : `${block}\n${body}`;
}

/** Render a template file as the new note, keeping or merging its YAML in one pass. */
export function renderCaptureTemplateNote(
  templateText: string,
  preset: CapturePreset,
  vars: CaptureVariables = {},
): string {
  const { head, body } = splitCaptureFrontmatter(templateText);
  if (!preset.frontmatterEnabled) {
    return joinCaptureFrontmatter(head, body);
  }
  const date = vars.date ?? new Date();
  const additions = expandCaptureTemplate(preset.frontmatterTemplate, {
    ...vars,
    date,
    inbox: vars.inbox ?? (preset.markInbox ? 'true' : 'false'),
  }).trim();
  const merged = head.trim() ? mergeCaptureFrontmatter(head, additions) : additions;
  return joinCaptureFrontmatter(merged, body);
}
