/**
 * Executor for capture presets. The decision logic lives in `lib/capture.ts`;
 * this only collects variables, resolves the target, and writes the file.
 *
 * Writes follow the same rule as the rest of the app: an open tab is
 * authoritative (writing under a dirty buffer would lose edits), otherwise the
 * file is read, changed and written once, with `noteOwnWrite` + `xiaoyuan-note:saved`
 * so the watcher does not report our own write as an external change.
 */

import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useToastsStore } from '../stores/toasts';
import { useCaptureDialogStore } from '../stores/capture-dialog';
import { useFiles } from './useFiles';
import { useI18n } from '../i18n';
import {
  captureNoteRelativePath,
  capturePreview,
  captureTargetRelativePath,
  composeCaptureInsert,
  effectiveCaptureTemplate,
  formatCapturePath,
  insertCaptureLine,
  insertTextAtCursor,
  renderCaptureFrontmatter,
  renderCaptureNote,
  renderCaptureTemplateNote,
  type CapturePreset,
  type CaptureVariables,
} from '../lib/capture';
import { noteOwnWrite } from '../lib/external-change';
import { isFileTab } from '../lib/editor-input';
import { baseNameOf, joinInFolder } from '../lib/import-plan';
import { parentDirOf } from '../lib/new-file-target';
import { samePath, segmentsBelow } from '../lib/path-key';
import { getPlainSelection } from '../lib/plain-selection';
import type { FileReadResult, Tab } from '../types';

function needsVariable(preset: CapturePreset, name: string): boolean {
  const template = effectiveCaptureTemplate(preset);
  return new RegExp(`\\{\\{\\s*(\\w+)\\s*\\}\\}`).test(template) &&
    new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(template);
}

export interface CaptureRunOptions extends Partial<CaptureVariables> {
  /** Explicitly provided value (selection / context-menu text / HTTP client). */
  value?: string;
  date?: Date;
}

export interface CaptureRunResult {
  ok: boolean;
  error?: string;
  path?: string;
}

export function useCapture() {
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const tabs = useTabsStore();
  const tiles = useTilesStore();
  const toasts = useToastsStore();
  const dialog = useCaptureDialogStore();
  const files = useFiles();
  const { t } = useI18n();

  async function collectVariables(
    preset: CapturePreset,
    options: CaptureRunOptions = {},
  ): Promise<CaptureVariables | null> {
    const vars: CaptureVariables = { date: options.date ?? new Date() };
    if (options.value !== undefined) {
      vars.value = options.value;
      vars.input = options.value;
    }
    if (options.selection !== undefined) vars.selection = options.selection;
    if (options.clipboard !== undefined) vars.clipboard = options.clipboard;
    if (options.url !== undefined) vars.url = options.url;
    if (options.tags !== undefined) vars.tags = options.tags;
    if (options.filePath !== undefined) vars.filePath = options.filePath;
    if (options.folder !== undefined) vars.folder = options.folder;
    if (options.file !== undefined) vars.file = options.file;
    if (options.title !== undefined) vars.title = options.title;
    const wantsInput = needsVariable(preset, 'input') || needsVariable(preset, 'value');
    const wantsSelection = wantsInput || needsVariable(preset, 'selection');
    if (wantsSelection && vars.selection === undefined) {
      vars.selection = window.getSelection()?.toString()
        || getPlainSelection()?.selection
        || '';
    }
    if (needsVariable(preset, 'clipboard') && vars.clipboard === undefined) {
      vars.clipboard = await readText().catch(() => '');
    }
    if (wantsInput && preset.inputMethod !== 'none' && vars.value === undefined && vars.selection?.trim()) {
      vars.value = vars.selection;
      vars.input = vars.selection;
    }
    if (wantsInput && preset.inputMethod !== 'none' && vars.value === undefined) {
      const value = await dialog.open({
        preset,
        placeholder: t('capture.inputPrompt'),
      });
      if (value === null) return null;
      vars.value = value;
      vars.input = value;
    }
    return vars;
  }

  async function readFile(path: string): Promise<string> {
    const tab = tabs.tabs.find((x) => samePath(x.filePath, path));
    if (tab) return tab.content;
    try {
      return (await invoke<FileReadResult>('read_file', { path })).content;
    } catch {
      return '';
    }
  }

  async function exists(path: string): Promise<boolean> {
    return invoke<boolean>('fs_file_exists', { path }).catch(() => true);
  }

  async function writeFile(path: string, text: string) {
    const tab = tabs.tabs.find((x) => samePath(x.filePath, path));
    if (tab) {
      tabs.setContent(tab.id, text);
      await files.saveTab(tab, { silent: true });
      return;
    }
    const dir = parentDirOf(path);
    const hasDir = await invoke<boolean>('fs_dir_exists', { path: dir }).catch(() => false);
    if (!hasDir) {
      await invoke('fs_create_dir', { path: dir }).catch(() => {
        // A racing create is fine; a real permission error surfaces on write.
      });
    }
    noteOwnWrite(path, text);
    await invoke('write_file', { path, content: text, encoding: 'UTF-8' });
    window.dispatchEvent(new CustomEvent('xiaoyuan-note:saved', { detail: { filePath: path } }));
  }

  async function appendLinkToActive(tab: Tab, stem: string): Promise<void> {
    if (!tab.filePath || !isFileTab(tab)) return;
    const link = `[[${stem}]]`;
    const next = insertTextAtCursor(tab.content, link, tab.cursor);
    if (next === tab.content) return;
    tabs.setContent(tab.id, next);
    await files.saveTab(tab, { silent: true });
  }

  async function openCapturedFile(path: string, preset: CapturePreset): Promise<void> {
    const before = tabs.activeId;
    if (preset.openLocation === 'window') {
      files.spawnAuxWindow(path);
    } else if (preset.openLocation === 'split') {
      await files.openPath(path, { bypassNewWindow: true });
      tiles.splitPane(tiles.focusedPaneId, preset.openDirection, tabs.activeId);
    } else {
      await files.openPath(path, { bypassNewWindow: true });
    }
    const mode = preset.openMode === 'source' ? 'edit'
      : preset.openMode === 'live' ? 'liveEdit'
        : preset.openMode === 'preview' ? 'preview'
          : null;
    if (mode) settings.setViewMode(mode);
    if (!preset.openFocus && before && tabs.tabs.some((tab) => tab.id === before)) {
      tabs.activate(before);
    }
  }

  /**
   * Run a preset without showing a toast. The quick-capture window uses this
   * so its own error line stays authoritative.
   */
  async function runPresetDetailed(id: string, options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
    if (!settings.capturesEnabled) return { ok: false, error: t('capture.disabled') };
    const preset = settings.captures.find((p) => p.id === id);
    if (!preset || !preset.enabled) return { ok: false, error: t('capture.disabled') };

    const date = options.date ?? new Date();
    const active = tabs.activeTab && isFileTab(tabs.activeTab) && tabs.activeTab.filePath
      ? tabs.activeTab
      : undefined;

    try {
      const vars = await collectVariables(preset, options);
      if (!vars) return { ok: false };

      // New-note presets own both the path and the rendered text, including
      // front matter. Rust is only the I/O primitive for this branch.
      if (preset.target === 'inbox') {
        const content = renderCaptureNote(preset, { ...vars, date });
        const relativePath = captureNoteRelativePath(preset, date);
        const path = await invoke<string>('capture_write_rendered', {
          path: relativePath,
          content,
          dedupe: true,
        });
        return { ok: true, path };
      }

      const root = workspace.currentFolder;
      if (!root) return { ok: false, error: t('calendar.openFolder') };

      let relativePath: string;
      let path: string;
      if (preset.target === 'active') {
        if (!active?.filePath) return { ok: false, error: t('capture.noActiveFile') };
        path = active.filePath;
        relativePath = segmentsBelow(root, path)?.join('/') || path.split(/[\\/]/).pop() || path;
      } else {
        relativePath = captureTargetRelativePath(preset, settings.periodic, settings.weekStartsOn, date);
        if (!relativePath.trim()) return { ok: false, error: t('capture.noTarget') };
        path = joinInFolder(root, relativePath);
      }

      const normalizedRelative = relativePath.replace(/\\/g, '/');
      const fileName = normalizedRelative.split('/').pop() ?? normalizedRelative;
      const folder = parentDirOf(normalizedRelative) ?? '';
      const fullVars: CaptureVariables = {
        ...vars,
        date,
        filePath: vars.filePath ?? normalizedRelative,
        folder: vars.folder ?? folder,
        file: vars.file ?? fileName,
        title: vars.title ?? baseNameOf(fileName),
      };

      const isNew = preset.target !== 'active' && !(await exists(path));
      if (isNew && !preset.createIfMissing) {
        return { ok: false, error: t('capture.fileMissing', { path: relativePath }) };
      }

      let initial = '';
      if (isNew) {
        let templateText: string | null = null;
        if (preset.createWithTemplate && preset.creationTemplate.trim()) {
          const templatePath = formatCapturePath(preset.creationTemplate, date);
          const resolvedTemplate = joinInFolder(root, templatePath);
          if (await exists(resolvedTemplate)) {
            templateText = await readFile(resolvedTemplate);
          } else {
            toasts.warning(t('capture.templateMissing', { path: templatePath }));
          }
        }
        initial = templateText !== null
          ? renderCaptureTemplateNote(templateText, preset, fullVars)
          : renderCaptureFrontmatter(preset, fullVars);
      }

      const snippet = capturePreview(preset, fullVars);
      const base = isNew ? initial : await readFile(path);
      let next: string;
      if (preset.target === 'active' && preset.newLineEnabled && active) {
        next = insertCaptureLine(base, snippet, active.cursor, preset.newLineDirection);
      } else {
        const result = composeCaptureInsert(base, snippet, preset.placement, preset.heading, {
          insertAtEnd: preset.headingInsertAtEnd,
          considerSubsections: preset.headingConsiderSubsections,
          createIfMissing: preset.headingCreateIfMissing,
          createLocation: preset.headingCreateLocation,
        });
        if (!result.inserted) {
          return {
            ok: false,
            error: result.reason === 'missingHeading'
              ? t('capture.headingMissing', { heading: result.missingHeading ?? preset.heading, path: relativePath })
              : t('capture.emptyValue'),
          };
        }
        next = result.content;
      }
      if (isNew || next !== base) await writeFile(path, next);
      if (preset.appendLink && active && !samePath(active.filePath, path)) {
        await appendLinkToActive(active, baseNameOf(fileName));
      }
      if (preset.openAfter) await openCapturedFile(path, preset);
      return { ok: true, path };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** Run one preset with the normal user-facing success/error toasts. */
  async function runPreset(id: string, options: CaptureRunOptions = {}): Promise<boolean> {
    const result = await runPresetDetailed(id, options);
    if (result.ok) toasts.success(t('capture.done'));
    else if (result.error) toasts.error(result.error);
    return result.ok;
  }

  return { runPreset, runPresetDetailed };
}
