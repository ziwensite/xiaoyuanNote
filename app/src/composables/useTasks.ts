/**
 * Every `- [ ]` in the workspace, as one list.
 *
 * The Rust index already walks the vault and keeps itself current through a
 * file watcher, so this is a projection over `workspaceIndex.entries` rather
 * than a second scan: opening the panel costs nothing, and a task edited in the
 * editor shows up here without anything being told to refresh.
 */
import { computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import { useFiles } from './useFiles';
import { nextTaskDates } from '../lib/calendar';
import {
  completeRecurringTaskLine,
  localDateKey,
  parseTaskMeta,
  compareTasks,
  setTaskReminder,
  toggleTaskLine,
  type TaskMeta,
} from '../lib/tasks';
import type { FileReadResult } from '../types';

export interface WorkspaceTask {
  path: string;
  fileName: string;
  /** 1-based line in the file. */
  line: number;
  done: boolean;
  /** The task text as written, tokens included. */
  raw: string;
  meta: TaskMeta;
}

export function useTasks() {
  const idx = useWorkspaceIndexStore();
  const tabs = useTabsStore();
  const toasts = useToastsStore();
  const settings = useSettingsStore();
  const { t } = useI18n();
  const files = useFiles();

  const tasks = computed<WorkspaceTask[]>(() => {
    const out: WorkspaceTask[] = [];
    for (const entry of idx.entries) {
      for (const t of entry.tasks ?? []) {
        out.push({
          path: entry.path,
          fileName: entry.name,
          line: t.line,
          done: t.done,
          raw: t.text,
          meta: parseTaskMeta(t.text),
        });
      }
    }
    return out.sort(compareTasks);
  });

  /**
   * Apply `transform` to one line of the task's note and persist it.
   *
   * When the file is open in a tab, the edit has to go through the tab's copy:
   * writing the file directly would be overwritten the moment that tab saves.
   * The tab is then saved, because clicking a checkbox is an explicit act —
   * leaving it dirty would show the panel (which reads the index, i.e. disk)
   * disagreeing with what the user just clicked.
   */
  async function writeTaskLine(
    task: WorkspaceTask,
    transform: (content: string, line: number) => string | null,
  ): Promise<void> {
    const openTab = tabs.tabs.find((t) => t.filePath === task.path);
    try {
      if (openTab) {
        const next = transform(openTab.content ?? '', task.line);
        if (next === null) {
          toasts.warning('That line is no longer a task — reopen the note.');
          return;
        }
        tabs.setContent(openTab.id, next);
        await files.saveTab(openTab, { silent: true });
        return;
      }
      const read = await invoke<FileReadResult>('read_file', { path: task.path });
      const next = transform(read.content, task.line);
      if (next === null) {
        // The index is behind the file. Refusing to write is the whole point:
        // rewriting whatever now sits on that line would corrupt the note.
        toasts.warning('That line is no longer a task — the note changed.');
        return;
      }
      await invoke('write_file', {
        path: task.path,
        content: next,
        encoding: read.encoding || 'UTF-8',
      });
      window.dispatchEvent(
        new CustomEvent('solomd:saved', { detail: { filePath: task.path } }),
      );
    } catch (e) {
      toasts.error(t('toast.taskUpdateFailed', { error: String(e) }));
    }
  }

  /**
   * Tick / untick a task and persist it.
   *
   * Ticking a recurring task does not just flip the box: it writes the next
   * occurrence as a new open line, because a recurring task is one line per
   * occurrence, not one line whose date keeps being overwritten. Unticking
   * stays a plain flip — there is no rule to advance backwards.
   *
   * Only natural-language rules advance. A legacy `FREQ=` line is read-only:
   * advancing it would write a new `FREQ=` line, and this project only writes
   * the Tasks-compatible spelling. Unsupported text does not advance either —
   * guessing at a schedule is worse than showing the rule as unreadable.
   */
  async function toggle(task: WorkspaceTask): Promise<void> {
    const recurrence = task.meta.recurrence;
    const nextDates =
      !task.done && recurrence?.kind === 'natural' && task.meta.rrule
        ? nextTaskDates(task.meta, task.meta.rrule, {
            whenDone: recurrence.whenDone,
            today: localDateKey(new Date()),
          })
        : null;
    if (nextDates) {
      await writeTaskLine(task, (content, line) => {
        const done = completeRecurringTaskLine(
          content,
          line,
          nextDates,
          settings.recurringTaskPlacement,
          task.meta.recurrenceAction ?? 'keep',
        );
        return done ? done.content : null;
      });
      return;
    }
    await writeTaskLine(task, (content, line) => toggleTaskLine(content, line));
  }

  /**
   * Set (`trigger`) or clear (`null`) the task's `⏰`.
   *
   * The UID is injected when a reminder is added, not before: a task that never
   * had a reminder keeps its line byte-identical. An existing `🆔` is reused so
   * adding a reminder twice cannot mint a second identity.
   */
  async function setReminder(task: WorkspaceTask, trigger: string | null): Promise<void> {
    const uid = task.meta.uid ?? (trigger ? crypto.randomUUID().slice(0, 8) : undefined);
    await writeTaskLine(task, (content, line) => setTaskReminder(content, line, trigger, uid));
  }

  return { tasks, toggle, setReminder };
}
