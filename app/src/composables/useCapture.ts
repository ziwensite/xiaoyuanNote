/**
 * Executor for capture presets (P5). The decision logic lives in
 * `lib/capture.ts`; this only collects the variables, finds the file and
 * writes it.
 *
 * Writes follow the same rule as the rest of the app: an open tab is
 * authoritative (writing under a dirty buffer would lose edits), otherwise the
 * file is read, changed and written once, with `noteOwnWrite` + `solomd:saved`
 * so the watcher does not report our own write as an external change.
 */

import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useFiles } from './useFiles';
import { useI18n } from '../i18n';
import {
  capturePreview,
  captureTargetPath,
  insertCaptureSnippet,
  type CapturePreset,
  type CaptureVariables,
} from '../lib/capture';
import { noteOwnWrite } from '../lib/external-change';
import { parentDirOf } from '../lib/new-file-target';
import { samePath } from '../lib/path-key';
import type { FileReadResult } from '../types';

function needsVariable(preset: CapturePreset, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(preset.template);
}

export function useCapture() {
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const tabs = useTabsStore();
  const toasts = useToastsStore();
  const files = useFiles();
  const { t } = useI18n();

  async function collectVariables(preset: CapturePreset): Promise<CaptureVariables | null> {
    const vars: CaptureVariables = { date: new Date() };
    if (needsVariable(preset, 'selection')) {
      vars.selection = window.getSelection()?.toString() ?? '';
    }
    if (needsVariable(preset, 'clipboard')) {
      vars.clipboard = await readText().catch(() => '');
    }
    if (needsVariable(preset, 'input')) {
      const value = window.prompt(t('capture.inputPrompt'), '');
      // Cancel aborts the whole capture: inserting a half-filled template would
      // be worse than doing nothing.
      if (value === null) return null;
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

  async function writeFile(path: string, text: string) {
    const tab = tabs.tabs.find((x) => samePath(x.filePath, path));
    if (tab) {
      tabs.setContent(tab.id, text);
      await files.saveTab(tab, { silent: true });
      return;
    }
    const dir = parentDirOf(path);
    const exists = await invoke<boolean>('fs_dir_exists', { path: dir }).catch(() => false);
    if (!exists) {
      await invoke('fs_create_dir', { path: dir }).catch(() => {
        // A racing create is fine; a real permission error surfaces on write.
      });
    }
    noteOwnWrite(path, text);
    await invoke('write_file', { path, content: text, encoding: 'UTF-8' });
    window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: path } }));
  }

  /**
   * Run one preset. Explicit invocation only — there is no automatic capture.
   */
  async function runPreset(id: string): Promise<boolean> {
    const preset = settings.captures.find((p) => p.id === id);
    if (!preset) return false;
    const root = workspace.currentFolder;
    if (!root) {
      toasts.error(t('calendar.openFolder'));
      return false;
    }
    const vars = await collectVariables(preset);
    if (!vars) return false;
    const date = vars.date ?? new Date();
    try {
      const path = captureTargetPath(preset, root, settings.periodic, settings.weekStartsOn, date);
      const snippet = capturePreview(preset, { ...vars, date });
      const existing = await readFile(path);
      const next = insertCaptureSnippet(existing, snippet, preset.placement, preset.heading);
      if (next !== existing) await writeFile(path, next);
      if (preset.openAfter) await files.openPath(path);
      toasts.success(t('capture.done'));
      return true;
    } catch (e) {
      toasts.error(String(e));
      return false;
    }
  }

  return { runPreset };
}
