/**
 * Periodic notes (P2) — open or create the note for any of the five kinds.
 *
 * Workflow:
 *   1. Resolve `<workspace>/<folder>/<formatted name>` with the pure helpers in
 *      `lib/periodic-notes.ts` (anchor date → tokens → path).
 *   2. If the file already exists, open it. Never overwrite.
 *   3. Otherwise read the configured template (a workspace-relative path),
 *      substitute its variables, write the file, then open it.
 *
 * The three daily settings are still honoured through `settings.periodic.daily`,
 * which `load()` derives from the old keys and the daily setters keep in sync.
 * We rely on `write_binary_file` to create parent folders (which `write_file`
 * does not); existence is a `read_file` attempt, as before.
 */

import { invoke } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { useFiles } from './useFiles';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { defaultDailyTemplate } from '../lib/daily-notes';
import {
  applyPeriodicTemplate,
  defaultPeriodicConfig,
  periodicTarget,
  type PeriodConfig,
  type PeriodKind,
} from '../lib/periodic-notes';
import {
  isSafPath,
  fromSafPath,
  toSafPath,
  safEnsureSubdir,
  safList,
  safCreate,
  safWrite,
} from '../lib/saf-fs';

function joinPath(...parts: string[]): string {
  // `sep()` is a string accessor on @tauri-apps/api/path. On macOS/Linux it's
  // '/', on Windows '\\'. We strip leading/trailing separators on inner parts
  // so user-typed `Daily/` or `/Daily` both work.
  const s = sep();
  return parts
    .filter((p) => !!p)
    .map((p, i) => {
      if (i === 0) return p.replace(/[/\\]+$/g, '');
      return p.replace(/^[/\\]+/g, '').replace(/[/\\]+$/g, '');
    })
    .join(s);
}

function shiftDate(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await invoke<string>('read_file', { path });
  } catch {
    return null;
  }
}

export function useDailyNotes() {
  const files = useFiles();
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const toasts = useToastsStore();
  const { lang, t } = useI18n();

  /** One kind's config, with the defaults filling anything the store lacks. */
  function readConfig(kind: PeriodKind): PeriodConfig {
    const fallback = defaultPeriodicConfig()[kind];
    const cfg = settings.periodic?.[kind];
    return {
      folder: (cfg?.folder ?? '').trim() || fallback.folder,
      format: (cfg?.format ?? '').trim() || fallback.format,
      template: cfg?.template ?? '',
    };
  }

  /**
   * Resolve the target file for `date` in `kind`. Returns null when there is no
   * workspace open. `fullPath` is absolute; `folder`/`filename` are kept apart
   * because the Android SAF path needs them separately.
   */
  function resolvePeriodicPath(kind: PeriodKind, date: Date): {
    config: PeriodConfig;
    folder: string;
    filename: string;
    stem: string;
    fullPath: string;
  } | null {
    const ws = workspace.currentFolder;
    if (!ws) return null;
    const config = readConfig(kind);
    const target = periodicTarget(kind, date, config, settings.weekStartsOn);
    const folder = joinPath(ws, target.folder);
    return {
      config,
      folder,
      filename: target.filename,
      stem: target.stem,
      fullPath: joinPath(folder, target.filename),
    };
  }

  /** Kept for callers (sidebar highlight) that only care about today's note. */
  function resolveDailyPath(date: Date) {
    return resolvePeriodicPath('daily', date);
  }

  /**
   * The text of a brand-new note: the configured template with its variables
   * replaced, or the built-in starter when there is none. A template path that
   * cannot be read is reported and falls back to the starter — never blocks.
   */
  async function buildBody(
    kind: PeriodKind,
    date: Date,
    config: PeriodConfig,
    ws: string,
  ): Promise<string> {
    let template = '';
    const templatePath = config.template.trim();
    if (templatePath) {
      const raw = await readTextFile(joinPath(ws, templatePath));
      if (raw === null) {
        toasts.warning(`Template not found: ${templatePath} — started from the default instead.`);
      } else {
        template = raw;
      }
    }
    if (!template.trim()) {
      template =
        kind === 'daily'
          ? defaultDailyTemplate(lang.value === 'zh' ? 'zh' : 'en')
          : '# {{title}}\n';
    }
    return applyPeriodicTemplate(template, kind, date, config, settings.weekStartsOn);
  }

  /**
   * Resolve the note for `kind`/`date`, creating it from the template when it is
   * missing. Returns null when there is no workspace, or when creating failed
   * (the toast has already been shown).
   *
   * Split out of `openPeriodic` so auto-capture can make sure today's note
   * exists without stealing focus or opening a tab.
   */
  async function ensurePeriodic(
    kind: PeriodKind,
    date: Date,
  ): Promise<{ path: string; existed: boolean } | null> {
    const resolved = resolvePeriodicPath(kind, date);
    if (!resolved) return null;
    const ws = workspace.currentFolder;
    if (!ws) return null;
    const { config, fullPath, filename } = resolved;

    // #502 — Android SAF vault support: create the periodic subfolder (and any
    // date-formatted path segments in `filename`) via ContentResolver.
    if (isSafPath(ws) && workspace.safTreeUri) {
      try {
        const treeUri = workspace.safTreeUri;
        const rootDocId = fromSafPath(ws);
        const relFile = filename.replace(/\\/g, '/').replace(/^\/+/, '');
        const lastSlash = relFile.lastIndexOf('/');
        const extraSubdir = lastSlash >= 0 ? relFile.slice(0, lastSlash) : '';
        const baseFileName = lastSlash >= 0 ? relFile.slice(lastSlash + 1) : relFile;
        const combinedSubdir = [config.folder, extraSubdir]
          .filter((s) => s && s.trim())
          .join('/');
        const dirDocId = await safEnsureSubdir(treeUri, rootDocId, combinedSubdir);
        const children = await safList(treeUri, dirDocId);
        const existing = children.find(
          (c) => !c.is_dir && c.name.toLowerCase() === baseFileName.toLowerCase(),
        );
        if (existing) return { path: existing.path, existed: true };
        const body = await buildBody(kind, date, config, ws);
        const newDocId = await safCreate(treeUri, dirDocId, baseFileName);
        await safWrite(treeUri, newDocId, body);
        return { path: toSafPath(newDocId), existed: false };
      } catch (e) {
        toasts.error(t('toast.createFileFailed', { name: filename, error: String(e) }));
        return null;
      }
    }

    if ((await readTextFile(fullPath)) !== null) return { path: fullPath, existed: true };

    try {
      const body = await buildBody(kind, date, config, ws);
      // `write_binary_file` is used here (rather than `write_file`) because
      // it creates missing parent directories for us.
      const bytes = Array.from(new TextEncoder().encode(body));
      await invoke('write_binary_file', { path: fullPath, data: bytes });
    } catch (e) {
      toasts.error(t('toast.createFileFailed', { name: filename, error: String(e) }));
      return null;
    }

    return { path: fullPath, existed: false };
  }

  async function openPeriodic(kind: PeriodKind, date: Date): Promise<void> {
    if (!workspace.currentFolder) {
      toasts.warning('Open a folder first to use periodic notes.');
      return;
    }
    const target = await ensurePeriodic(kind, date);
    if (!target) return;
    await files.openPath(target.path, { bypassNewWindow: true });
  }

  async function openTodayNote(): Promise<void> {
    return openPeriodic('daily', new Date());
  }

  async function openYesterday(): Promise<void> {
    return openPeriodic('daily', shiftDate(new Date(), -1));
  }

  async function openTomorrow(): Promise<void> {
    return openPeriodic('daily', shiftDate(new Date(), 1));
  }

  return {
    openPeriodic,
    openTodayNote,
    openYesterday,
    openTomorrow,
    ensurePeriodic,
    resolvePeriodicPath,
    resolveDailyPath,
  };
}
