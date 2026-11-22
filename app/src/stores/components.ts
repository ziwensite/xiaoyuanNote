/**
 * components.ts — v5.0 reference-based component store (Pinia).
 *
 * Component trees live as plain markdown notes at
 * `{workspace}/<dir>/<name>_<cmp_id>.md`, so they are indexable/searchable like
 * any other note and easy to spot in a file manager. Because the file name
 * carries a display name, lookups by id use an in-memory path index (built on
 * reload) with a frontmatter-scan fallback. This store owns: workspace binding,
 * directory scan, the `id → ComponentFile` cache, and disk writes via the
 * existing generic Tauri commands (read_file / write_file / list_dir /
 * fs_create_dir / fs_rename / fs_delete). No new Rust command, no database.
 */
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  bumpComponentDataVersion,
  isValidComponentId,
  makeRoot,
  newComponentId,
  parseComponentFile,
  serializeComponentFile,
  type ComponentFile,
  type ComponentNode,
} from '../lib/component-system';
import { useSettingsStore } from './settings';

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface State {
  folder: string | null;
  /** id → parsed component file. */
  cache: Record<string, ComponentFile>;
  /** id → on-disk file name (`<name>_<id>.md`), rebuilt on every reload. */
  paths: Record<string, string>;
  /** ids currently being loaded (avoid duplicate reads). */
  loading: Record<string, boolean>;
  /** ids known to be missing on disk (avoid repeated failing reads). */
  missing: Record<string, boolean>;
  lastError: string | null;
}

function joinPath(folder: string, rel: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const relNative = sep === '\\' ? rel.replace(/\//g, '\\') : rel;
  return folder.endsWith(sep) ? folder + relNative : folder + sep + relNative;
}

/** Build a cross-platform-safe file name: `<name>_<id>.md`. */
export function componentFileName(file: ComponentFile): string {
  if (!isValidComponentId(file.id)) throw new Error(`Invalid component id: ${file.id}`);
  const name = (file.name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return name ? `${name}_${file.id}.md` : `${file.id}.md`;
}

/** Tauri listener for workspace index updates; registered once on first folder. */
let unlistenIndex: UnlistenFn | null = null;

export const useComponentsStore = defineStore('components', {
  state: (): State => ({
    folder: null,
    cache: {},
    paths: {},
    loading: {},
    missing: {},
    lastError: null,
  }),

  getters: {
    /** Folder name from settings (v5.0: configurable in Settings → Writing). */
    dirName(): string {
      const settings = useSettingsStore();
      const name = (settings.componentsDirName || '').replace(/[\\/]/g, '').trim();
      return name || '_components';
    },
    /** All cached components, sorted by name then id (for an import picker). */
    list(state): ComponentFile[] {
      return Object.values(state.cache).sort(
        (a, b) => (a.name || a.id).localeCompare(b.name || b.id),
      );
    },
  },

  actions: {
    /** Bind to a workspace folder and (re)load all component notes. */
    async setFolder(folder: string | null) {
      if (folder === this.folder) return;
      this.folder = folder;
      this.cache = {};
      this.paths = {};
      this.loading = {};
      this.missing = {};
      this.lastError = null;
      if (folder) {
        if (!unlistenIndex) {
          unlistenIndex = await listen('xiaoyuan-note://index-updated', () => {
            // Component notes are ordinary `.md` files; the index watcher sees
            // their changes. Reload so widgets rendered from other panes refresh.
            this.reload().catch(() => {});
          });
        }
        await this.reload();
      }
    },

    /** Scan `<dir>/*.md` and rebuild the cache + id→filename index. */
    async reload() {
      const folder = this.folder;
      if (!folder) return;
      const dir = joinPath(folder, this.dirName);
      let entries: DirEntry[] = [];
      try {
        entries = await invoke<DirEntry[]>('list_dir', { path: dir });
      } catch {
        // Directory doesn't exist yet → no components. Not an error.
        this.cache = {};
        this.paths = {};
        return;
      }
      const cache: Record<string, ComponentFile> = {};
      const paths: Record<string, string> = {};
      for (const e of entries) {
        if (e.is_dir || !/\.md$/i.test(e.name)) continue;
        try {
          const res = await invoke<{ content: string }>('read_file', { path: e.path });
          const file = parseComponentFile(res.content);
          if (file && isValidComponentId(file.id)) {
            cache[file.id] = file;
            paths[file.id] = e.name;
          }
        } catch (err) {
          console.warn('[components] failed to read', e.path, err);
        }
      }
      this.cache = cache;
      this.paths = paths;
      this.missing = {};
      bumpComponentDataVersion();
    },

    /** Ensure the configured components folder exists (idempotent). */
    async ensureDir(folder: string): Promise<string> {
      const dir = joinPath(folder, this.dirName);
      try {
        await invoke('fs_create_dir', { path: dir });
      } catch (e) {
        if (!String(e).includes('already exists')) throw e;
      }
      return dir;
    },

    /** Get a component by id from cache; kick off an async load if not cached. */
    get(id: string): ComponentFile | null {
      if (!isValidComponentId(id)) return null;
      return this.cache[id] ?? null;
    },

    /** Scan the folder for the note whose frontmatter id matches `id`. */
    async findOnDisk(id: string): Promise<{ name: string; file: ComponentFile } | null> {
      const folder = this.folder;
      if (!folder) return null;
      const dir = joinPath(folder, this.dirName);
      let entries: DirEntry[];
      try {
        entries = await invoke<DirEntry[]>('list_dir', { path: dir });
      } catch {
        return null;
      }
      for (const e of entries) {
        if (e.is_dir || !/\.md$/i.test(e.name)) continue;
        try {
          const res = await invoke<{ content: string }>('read_file', { path: e.path });
          const file = parseComponentFile(res.content);
          if (file && file.id === id) return { name: e.name, file };
        } catch {
          // unreadable note — skip
        }
      }
      return null;
    },

    /** Load one component from disk on demand (populates cache + path index). */
    async load(id: string): Promise<ComponentFile | null> {
      if (!isValidComponentId(id)) return null;
      if (this.cache[id]) return this.cache[id];
      if (this.loading[id]) return null;
      const folder = this.folder;
      if (!folder) return null;
      if (this.missing[id]) return null;
      this.loading[id] = true;
      try {
        let name = this.paths[id] || '';
        let file: ComponentFile | null = null;
        if (name) {
          try {
            const res = await invoke<{ content: string }>('read_file', {
              path: joinPath(joinPath(folder, this.dirName), name),
            });
            file = parseComponentFile(res.content);
          } catch {
            // stale path — fall through to a frontmatter scan
          }
        }
        if (!file || file.id !== id) {
          const found = await this.findOnDisk(id);
          if (found) {
            name = found.name;
            file = found.file;
          }
        }
        if (file && file.id === id && name) {
          this.paths[id] = name;
          this.cache[id] = file;
          delete this.missing[id];
          // A concurrent caller (e.g. Preview while the CM widget loads the
          // same id) got `null` from load(); bump so its version subscription
          // re-runs and picks up the now-cached tree — no Ctrl+R needed.
          bumpComponentDataVersion();
          return file;
        }
        this.missing[id] = true;
        return null;
      } catch {
        this.missing[id] = true;
        return null;
      } finally {
        delete this.loading[id];
      }
    },

    /** Create a new component note with an empty root tree. Returns its id. */
    async create(name: string, tree?: ComponentNode): Promise<string> {
      const folder = this.folder;
      if (!folder) throw new Error('no workspace folder');
      const id = newComponentId();
      const file: ComponentFile = { id, name: name || '', tree: tree ?? makeRoot() };
      await this.save(file);
      return id;
    },

    /** Save a component to disk and update the cache + path index. */
    async save(file: ComponentFile): Promise<ComponentFile> {
      if (!isValidComponentId(file.id)) throw new Error(`Invalid component id: ${file.id}`);
      const folder = this.folder;
      if (!folder) throw new Error('no workspace folder');
      await this.ensureDir(folder);
      const dir = joinPath(folder, this.dirName);
      const name = componentFileName(file);
      const oldName = this.paths[file.id];
      if (oldName && oldName !== name) {
        // A rename (or an upgrade from the old `<id>.md` layout): move the
        // existing note so we never leave two files with the same component id.
        try {
          await invoke('fs_rename', {
            from: joinPath(dir, oldName),
            to: joinPath(dir, name),
          });
        } catch (e) {
          // External editor may have moved/deleted it meanwhile. Drop the
          // stale entry and let write_file recreate the note under its new name.
          console.warn('[components] rename failed, recreating', oldName, e);
          await invoke('fs_delete', { path: joinPath(dir, oldName) }).catch(() => {});
        }
      }
      const path = joinPath(dir, name);
      try {
        await invoke('write_file', {
          path,
          content: serializeComponentFile(file),
          encoding: 'UTF-8',
        });
        this.cache[file.id] = { ...file };
        this.paths[file.id] = name;
        delete this.missing[file.id];
        this.lastError = null;
        bumpComponentDataVersion();
        return file;
      } catch (e) {
        this.lastError = String(e);
        throw e;
      }
    },
  },
});
