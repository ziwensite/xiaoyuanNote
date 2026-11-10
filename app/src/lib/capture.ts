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
import { periodicPath, type PeriodicConfig, type PeriodKind } from './periodic-notes';

export type CaptureTarget = 'file' | 'folder' | 'periodic';
export type CapturePlacement = 'top' | 'bottom' | 'heading';

export interface CapturePreset {
  id: string;
  name: string;
  target: CaptureTarget;
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
  /** Append `➕ <today>` to the first task line when it has none. */
  autoCreated: boolean;
  /** Append `📅 <today>` to the first task line when it has none. */
  autoDue: boolean;
  openAfter: boolean;
}

export const CAPTURE_PLACEMENTS: readonly CapturePlacement[] = ['top', 'bottom', 'heading'];
export const CAPTURE_TARGETS: readonly CaptureTarget[] = ['file', 'folder', 'periodic'];
export const CAPTURE_PERIODS: readonly PeriodKind[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/** Variables a template may use. Unknown names are left untouched. */
export const CAPTURE_VARIABLES = ['selection', 'clipboard', 'input', 'date', 'time', 'title'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function newCapturePreset(id: string, name = 'Capture'): CapturePreset {
  return {
    id,
    name,
    target: 'file',
    path: '',
    fileName: 'YYYY-MM-DD.md',
    period: 'daily',
    placement: 'bottom',
    heading: '## 任务',
    template: '- [ ] {{input}}',
    autoCreated: false,
    autoDue: false,
    openAfter: false,
  };
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
      autoCreated: item.autoCreated === true,
      autoDue: item.autoDue === true,
      openAfter: item.openAfter === true,
    });
  }
  return out;
}

export interface CaptureVariables {
  selection?: string;
  clipboard?: string;
  input?: string;
  /** Defaults to now. */
  date?: Date;
  /** Defaults to the ISO date, which is a useful note title. */
  title?: string;
}

export function expandCaptureTemplate(template: string, vars: CaptureVariables = {}): string {
  const date = vars.date ?? new Date();
  const values: Record<string, string> = {
    selection: vars.selection ?? '',
    clipboard: vars.clipboard ?? '',
    input: vars.input ?? '',
    date: isoDate(date),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    title: vars.title ?? isoDate(date),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? values[name] : match,
  );
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
): string {
  if (!autoCreated && !autoDue) return snippet;
  const day = isoDate(date);
  const lines = snippet.split('\n');
  const index = lines.findIndex((line) => /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/.test(line));
  if (index === -1) return snippet;
  let line = lines[index];
  if (autoCreated && !line.includes('➕')) line = `${line} ➕ ${day}`;
  if (autoDue && !line.includes('📅')) line = `${line} 📅 ${day}`;
  lines[index] = line;
  return lines.join('\n');
}

function splitFrontmatterText(text: string): { head: string; body: string } {
  if (!text.startsWith('---')) return { head: '', body: text };
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { head: '', body: text };
  return { head: match[0], body: text.slice(match[0].length) };
}

/**
 * Put a snippet into a note at the configured position.
 *
 * `heading` is a literal line match rather than a markdown parser: users type
 * `## 任务`, and a fuzzy heading search would put the snippet under a heading
 * they did not mean. When the heading is missing it is created at the end.
 */
export function insertCaptureSnippet(
  text: string,
  snippet: string,
  placement: CapturePlacement,
  heading = '',
): string {
  const block = snippet.replace(/\s+$/, '');
  if (!block) return text;

  if (placement === 'top') {
    const { head, body } = splitFrontmatterText(text);
    const rest = body.replace(/^\s*\n/, '');
    return `${head}\n${block}\n\n${rest}`.replace(/\n{3,}/g, (m) => m.slice(0, 2));
  }

  if (placement === 'heading' && heading.trim()) {
    const wanted = heading.trim();
    const lines = text.split('\n');
    const index = lines.findIndex((line) => line.trim() === wanted);
    if (index !== -1) {
      const before = lines.slice(0, index + 1).join('\n');
      const after = lines.slice(index + 1).join('\n').replace(/^\s*\n/, '');
      return `${before}\n\n${block}\n\n${after}`.replace(/\n{3,}/g, (m) => m.slice(0, 2));
    }
    const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return `${prefix}\n${wanted}\n\n${block}\n`;
  }

  const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${prefix}${block}\n`;
}

/** Where a preset writes, relative to the workspace root. */
export function captureTargetPath(
  preset: CapturePreset,
  root: string,
  periodic: PeriodicConfig,
  weekStartsOn: number,
  date: Date,
): string {
  if (preset.target === 'periodic') {
    return joinInFolder(root, periodicPath(preset.period, date, periodic[preset.period], weekStartsOn));
  }
  if (preset.target === 'folder') {
    const folder = joinInFolder(root, preset.path);
    return joinInFolder(folder, formatDailyFilename(date, preset.fileName || 'YYYY-MM-DD.md'));
  }
  return joinInFolder(root, preset.path);
}

/** The text a preset would insert right now, before any insertion position is applied. */
export function capturePreview(
  preset: CapturePreset,
  vars: CaptureVariables = {},
): string {
  const date = vars.date ?? new Date();
  return applyCaptureTokens(
    expandCaptureTemplate(preset.template, { ...vars, date }),
    date,
    preset.autoCreated,
    preset.autoDue,
  );
}
