<script setup lang="ts">
/**
 * Batch 4 — convert legacy `🔁 FREQ=…` rules to Obsidian Tasks' natural
 * language, with a per-line before/after preview.
 *
 * Opened by the `solomd:open-recurrence-migration` window event (command
 * palette). The list is built from the workspace index (which already knows
 * every task line), then each candidate file is read once so the preview shows
 * the line's real bytes — index text is stripped of its bullet and indentation
 * and would not prove the rewrite is byte-faithful.
 *
 * Nothing is written until Apply: every convertible line starts ticked, can be
 * unticked individually, and whole files can be excluded. Rules with no exact
 * natural equivalent are listed as "cannot be expressed" and stay untouched.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import { useTabsStore } from '../stores/tabs';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useWorkspaceStore } from '../stores/workspace';
import { useToastsStore } from '../stores/toasts';
import { useFiles } from '../composables/useFiles';
import { useGlobalSearch } from '../composables/useGlobalSearch';
import { fromSafPath, isSafPath, safRead, safWrite } from '../lib/saf-fs';
import { taskLineIndexes } from '../lib/preview-task-toggle';
import {
  applyRecurrenceConversions,
  convertLegacyRecurrenceLine,
  type LegacyUnsupportedReason,
} from '../lib/recurrence-migration';
import { DsButton, DsModal } from '../ui';
import type { FileReadResult } from '../types';

const OPEN_EVENT = 'solomd:open-recurrence-migration';

const { t } = useI18n();
const tabs = useTabsStore();
const index = useWorkspaceIndexStore();
const workspace = useWorkspaceStore();
const toasts = useToastsStore();
const { saveTab } = useFiles();
const { search } = useGlobalSearch();

interface Row {
  line: number;
  before: string;
  after: string | null;
  reason?: LegacyUnsupportedReason;
  selected: boolean;
}

interface FileGroup {
  path: string;
  name: string;
  rows: Row[];
  selected: boolean;
}

const open = ref(false);
const loading = ref(false);
const applying = ref(false);
const groups = ref<FileGroup[]>([]);

const convertible = computed(() =>
  groups.value.reduce((n, g) => n + g.rows.filter((r) => r.after !== null).length, 0),
);
const selectedCount = computed(() =>
  groups.value.reduce((n, g) => n + g.rows.filter((r) => r.selected && r.after !== null).length, 0),
);

function reasonText(reason: LegacyUnsupportedReason | undefined): string {
  return t(`tasks.migrate.reason.${reason ?? 'malformed'}`);
}

function setGroupSelection(group: FileGroup, value: boolean): void {
  group.selected = value;
  for (const row of group.rows) {
    if (row.after !== null) row.selected = value;
  }
}

function onRowToggle(group: FileGroup): void {
  group.selected = group.rows.every((r) => r.after === null || r.selected);
}

async function load(): Promise<void> {
  loading.value = true;
  groups.value = [];
  try {
    if (!workspace.currentFolder) return;
    // Discovery goes through the global-search walker rather than the task
    // index: the index only keeps `- * +` bullets, and a legacy rule can also
    // sit on an ordered or quoted task line.
    const hits = await search('🔁', workspace.currentFolder, 5000);
    const files = new Map<string, { path: string; name: string; lines: number[] }>();
    for (const hit of hits) {
      const existing = files.get(hit.file);
      if (existing) {
        if (!existing.lines.includes(hit.line)) existing.lines.push(hit.line);
      } else {
        files.set(hit.file, {
          path: hit.file,
          name: hit.file.split(/[\\/]/).pop() ?? hit.file,
          lines: [hit.line],
        });
      }
    }

    const built = await Promise.all(
      [...files.values()].map(async (file) => {
        const content = await readFile(file.path);
        if (content === null) return null;
        const lines = content.split('\n');
        // Only real task lines: a `🔁 FREQ=…` inside prose or a code fence is
        // not something to rewrite.
        const taskLines = new Set(taskLineIndexes(lines));
        const rows: Row[] = [];
        for (const lineNo of file.lines.sort((a, b) => a - b)) {
          if (!taskLines.has(lineNo - 1)) continue;
          const raw = lines[lineNo - 1];
          if (raw === undefined) continue;
          const bare = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
          const conversion = convertLegacyRecurrenceLine(bare);
          if (!conversion) continue;
          rows.push({
            line: lineNo,
            before: conversion.before,
            after: conversion.after,
            reason: conversion.reason,
            selected: conversion.after !== null,
          });
        }
        if (!rows.length) return null;
        const group: FileGroup = {
          path: file.path,
          name: file.name,
          rows,
          selected: rows.every((r) => r.after === null || r.selected),
        };
        return group;
      }),
    );

    groups.value = built.filter((g): g is FileGroup => g !== null).sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    loading.value = false;
  }
}

/** Open tab content wins (it may hold unsaved edits); otherwise read the disk. */
async function readFile(path: string): Promise<string | null> {
  const tab = tabs.tabs.find((item) => item.filePath === path);
  if (tab) return tab.content ?? '';
  try {
    if (isSafPath(path) && workspace.safTreeUri) {
      return (await safRead(workspace.safTreeUri, fromSafPath(path))).content;
    }
    const result = await invoke<FileReadResult>('read_file', { path });
    return result.content;
  } catch (e) {
    console.error('[RecurrenceMigration] read failed', path, e);
    return null;
  }
}

async function apply(): Promise<void> {
  if (!selectedCount.value || applying.value) return;
  applying.value = true;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  try {
    for (const group of groups.value) {
      const picked = group.rows.filter((r) => r.selected && r.after !== null);
      if (!picked.length) continue;
      const conversions = picked.map((r) => ({ line: r.line, before: r.before, after: r.after! }));
      try {
        const tab = tabs.tabs.find((item) => item.filePath === group.path);
        if (tab) {
          const result = applyRecurrenceConversions(tab.content ?? '', conversions);
          if (result.applied === 0) {
            skipped += result.skipped.length;
            continue;
          }
          tabs.setContent(tab.id, result.content);
          await saveTab(tab, { silent: true });
          written += result.applied;
          skipped += result.skipped.length;
        } else if (isSafPath(group.path) && workspace.safTreeUri) {
          const read = await safRead(workspace.safTreeUri, fromSafPath(group.path));
          const result = applyRecurrenceConversions(read.content, conversions);
          if (result.applied === 0) {
            skipped += result.skipped.length;
            continue;
          }
          await safWrite(workspace.safTreeUri, fromSafPath(group.path), result.content);
          window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: group.path } }));
          written += result.applied;
          skipped += result.skipped.length;
        } else {
          const read = await invoke<FileReadResult>('read_file', { path: group.path });
          const result = applyRecurrenceConversions(read.content, conversions);
          if (result.applied === 0) {
            skipped += result.skipped.length;
            continue;
          }
          // `read_file` strips the BOM; put it back so the bytes outside the
          // rewritten lines stay identical.
          const body =
            read.had_bom && /^utf-?8$/i.test(read.encoding) ? `\uFEFF${result.content}` : result.content;
          await invoke('write_file', {
            path: group.path,
            content: body,
            encoding: read.encoding || 'UTF-8',
            workspace: workspace.currentFolder,
          });
          window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: group.path } }));
          written += result.applied;
          skipped += result.skipped.length;
        }
      } catch (e) {
        failed++;
        console.error('[RecurrenceMigration] write failed', group.path, e);
      }
    }

    if (written) toasts.push(t('tasks.migrate.done', { n: written }), 'success');
    if (skipped) toasts.push(t('tasks.migrate.partial', { s: skipped }), 'warning');
    if (failed) toasts.push(t('tasks.migrate.failed', { n: failed }), 'error');
    await index.rescan();
    if (!skipped && !failed) open.value = false;
    else await load();
  } finally {
    applying.value = false;
  }
}

function openDialog(): void {
  open.value = true;
  void load();
}

onMounted(() => window.addEventListener(OPEN_EVENT, openDialog));
onBeforeUnmount(() => window.removeEventListener(OPEN_EVENT, openDialog));
</script>

<template>
  <DsModal :model-value="open" width="820px" @update:model-value="open = $event">
    <template #header>
      <h2 class="rmg__title">{{ t('tasks.migrate.title') }}</h2>
    </template>

    <div class="rmg__body">
      <p class="rmg__intro">{{ t('tasks.migrate.intro') }}</p>

      <p v-if="loading" class="rmg__empty">{{ t('tasks.migrate.loading') }}</p>
      <p v-else-if="!workspace.currentFolder" class="rmg__empty">{{ t('tasks.migrate.noFolder') }}</p>
      <p v-else-if="!groups.length" class="rmg__empty">{{ t('tasks.migrate.empty') }}</p>

      <section v-for="group in groups" :key="group.path" class="rmg__file">
        <header class="rmg__filehead">
          <label class="rmg__check">
            <input
              type="checkbox"
              :checked="group.selected"
              :disabled="!group.rows.some((r) => r.after !== null)"
              @change="setGroupSelection(group, ($event.target as HTMLInputElement).checked)"
            />
            <span class="rmg__name">{{ group.name }}</span>
          </label>
          <span class="rmg__path" :title="group.path">{{ group.path }}</span>
        </header>

        <ul class="rmg__rows">
          <li v-for="row in group.rows" :key="row.line" class="rmg__row">
            <label class="rmg__check rmg__check--row">
              <input
                v-model="row.selected"
                type="checkbox"
                :disabled="row.after === null"
                @change="onRowToggle(group)"
              />
              <span class="rmg__ln">{{ t('tasks.migrate.line', { n: row.line }) }}</span>
            </label>
            <div class="rmg__diff">
              <code class="rmg__before">{{ row.before }}</code>
              <code v-if="row.after !== null" class="rmg__after">{{ row.after }}</code>
              <p v-else class="rmg__blocked">
                <span class="rmg__badge">{{ t('tasks.migrate.unsupported') }}</span>
                {{ reasonText(row.reason) }}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <p v-if="convertible" class="rmg__count">
        {{ t('tasks.migrate.selected', { n: selectedCount, total: convertible }) }}
      </p>
    </div>

    <template #footer>
      <DsButton variant="secondary" @click="open = false">{{ t('tasks.migrate.close') }}</DsButton>
      <DsButton variant="primary" :loading="applying" :disabled="!selectedCount" @click="apply">
        {{ t('tasks.migrate.apply', { n: selectedCount }) }}
      </DsButton>
    </template>
  </DsModal>
</template>

<style scoped>
.rmg__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.rmg__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  max-height: 62vh;
  overflow-y: auto;
}
.rmg__intro,
.rmg__empty,
.rmg__count {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.rmg__file {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.rmg__filehead {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface-2);
}
.rmg__path {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.rmg__name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
}
.rmg__check {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
  min-width: 0;
}
.rmg__check--row {
  flex: none;
  width: 84px;
}
.rmg__ln {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.rmg__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rmg__row {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--border);
  align-items: flex-start;
}
.rmg__diff {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.rmg__before,
.rmg__after {
  display: block;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.rmg__before {
  color: var(--text-muted);
  background: var(--surface-2);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-muted) 50%, transparent);
}
.rmg__after {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.rmg__blocked {
  margin: 0;
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.rmg__badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  background: color-mix(in srgb, var(--warning, #d08700) 16%, transparent);
  color: var(--warning, #d08700);
}
</style>
