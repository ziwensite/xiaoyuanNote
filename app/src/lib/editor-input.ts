/**
 * Editor input abstraction.
 *
 * A tab is either a file-backed document (`kind` omitted / `'file'`) or a
 * virtual editor input whose component is chosen by its kind. This module is
 * the runtime view of that distinction:
 *
 *   - `TabInput`      — what the tab actually is, for rendering and menus
 *   - `EDITOR_KINDS`  — per-kind metadata (title, icon, singleton, persistence)
 *
 * The stored `Tab` record stays flat and gains only optional fields, so every
 * existing file-tab code path keeps working unchanged. Virtual tabs carry no
 * buffer and are never dirty (see `lib/tab-dirty.ts`).
 */
import type { Tab, TabKind } from '../types';
import type { CalendarEditorView } from './calendar-prefs';

export type VirtualTabKind = Exclude<TabKind, 'file'>;

/** Matches the app's i18n `t()` signature without importing the store. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface CalendarTabArgs {
  date: string;
  view: CalendarEditorView;
}

export interface SettingsTabArgs {
  /** Settings category id; validated by the settings panel itself. */
  section?: string;
}

export interface SearchTabArgs {
  query: string;
}

export interface WebTabArgs {
  url: string;
}

/**
 * Resolved editor input. The file branch deliberately carries only the tab id:
 * the buffer lives on the `Tab` record, and duplicating it here would create a
 * second source of truth.
 */
export type TabInput =
  | { kind: 'file'; tabId: string }
  | { kind: 'calendar'; tabId: string; args: CalendarTabArgs }
  | { kind: 'settings'; tabId: string; args: SettingsTabArgs }
  | { kind: 'search'; tabId: string; args: SearchTabArgs }
  | { kind: 'web'; tabId: string; args: WebTabArgs };

export interface EditorKindDef {
  kind: VirtualTabKind;
  /** Icon name from `Icons.vue`. */
  icon: string;
  title(tab: Tab, t: TranslateFn): string;
  /** Editor body component, loaded lazily. Filled in by the phase that
   *  actually renders this kind; `undefined` means "not available yet". */
  component?: () => Promise<unknown>;
  /** Singleton key, or `false` when several tabs may coexist. */
  singleton: false | ((args: never) => string);
  /** Whether the tab may be dragged into a split pane. */
  splittable: boolean;
  /** `never` = not restored after relaunch; `workspace` = stored with the
   *  workspace's tab bucket. */
  persist: 'never' | 'workspace';
  serialize(args: never): unknown;
  deserialize(json: unknown): unknown | null;
}

const CALENDAR_VIEWS: readonly CalendarEditorView[] = ['month', 'day', 'week'];

export function readCalendarArgs(json: unknown): CalendarTabArgs | null {
  if (!json || typeof json !== 'object') return null;
  const { date, view } = json as Record<string, unknown>;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const safeView = CALENDAR_VIEWS.includes(view as CalendarEditorView)
    ? (view as CalendarEditorView)
    : 'month';
  return { date, view: safeView };
}

export function readSettingsArgs(json: unknown): SettingsTabArgs {
  if (json && typeof json === 'object') {
    const section = (json as Record<string, unknown>).section;
    if (typeof section === 'string' && section) return { section };
  }
  return {};
}

export function readSearchArgs(json: unknown): SearchTabArgs | null {
  if (!json || typeof json !== 'object') return null;
  const query = (json as Record<string, unknown>).query;
  return typeof query === 'string' && query.trim() ? { query } : null;
}

/** Only https is accepted: the app runs in a secure context, so an http
 *  subframe would be blocked as mixed content. */
export function normalizeWebUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return url.toString();
}

export function readWebArgs(json: unknown): WebTabArgs | null {
  if (!json || typeof json !== 'object') return null;
  const raw = (json as Record<string, unknown>).url;
  if (typeof raw !== 'string') return null;
  const url = normalizeWebUrl(raw);
  return url ? { url } : null;
}

/** Calendar is a single tab: opening another date updates its parameters
 *  instead of spawning one tab per day. */
export const EDITOR_KINDS = {
  calendar: {
    kind: 'calendar',
    icon: 'calendar',
    // Month/day only: the full ISO date made the tab wider than it needs to be
    // and the label is already visible inside the tab.
    title: (tab: Tab, t: TranslateFn) => {
      const date = readCalendarArgs(tab.input)?.date ?? '';
      return t('editorTab.calendar', { date: date.slice(5) });
    },
    component: () => import('../components/tabs/CalendarTab.vue'),
    singleton: () => 'calendar',
    splittable: true,
    persist: 'workspace',
    serialize: (args: CalendarTabArgs) => ({ date: args.date, view: args.view }),
    deserialize: (json: unknown) => readCalendarArgs(json),
  },
  settings: {
    kind: 'settings',
    icon: 'settings',
    title: (_tab: Tab, t: TranslateFn) => t('editorTab.settings'),
    component: () => import('../components/tabs/SettingsTab.vue'),
    singleton: () => 'settings',
    splittable: false,
    persist: 'never',
    serialize: (args: SettingsTabArgs) => ({ section: args.section ?? null }),
    deserialize: (json: unknown) => readSettingsArgs(json),
  },
  search: {
    kind: 'search',
    icon: 'search',
    title: (tab: Tab, t: TranslateFn) =>
      t('editorTab.search', { query: readSearchArgs(tab.input)?.query ?? '' }),
    singleton: () => 'search',
    splittable: false,
    persist: 'never',
    serialize: (args: SearchTabArgs) => ({ query: args.query }),
    deserialize: (json: unknown) => readSearchArgs(json),
  },
  web: {
    kind: 'web',
    icon: 'globe',
    title: (tab: Tab, t: TranslateFn) => tab.title || t('editorTab.web'),
    singleton: false,
    splittable: true,
    persist: 'workspace',
    serialize: (args: WebTabArgs) => ({ url: args.url }),
    deserialize: (json: unknown) => readWebArgs(json),
  },
} as Record<VirtualTabKind, EditorKindDef>;

/**
 * True for documents backed by the editor buffer. An unknown kind (bad
 * persisted data) is treated as a file so the tab degrades to an empty buffer
 * instead of breaking rendering.
 */
export function isFileTab(tab: Tab): boolean {
  const kind = tab.kind ?? 'file';
  return kind === 'file' || !(kind in EDITOR_KINDS);
}

/** Singleton identity for `kind`/`args`, or `null` when several tabs may
 *  coexist. Used by `tabs.openInput` to reuse an existing tab. */
export function singletonKeyOf(kind: VirtualTabKind, args: unknown): string | null {
  const def = EDITOR_KINDS[kind];
  if (!def.singleton) return null;
  return def.singleton(args as never);
}

const fileInput = (tab: Tab): TabInput => ({ kind: 'file', tabId: tab.id });

/** Turn the stored record into the input the renderer/menus act on. */
export function resolveTabInput(tab: Tab): TabInput {
  switch (tab.kind) {
    case 'calendar': {
      const args = READERS.calendar(tab.input);
      return args ? { kind: 'calendar', tabId: tab.id, args } : fileInput(tab);
    }
    case 'settings': {
      const args = READERS.settings(tab.input);
      return args ? { kind: 'settings', tabId: tab.id, args } : fileInput(tab);
    }
    case 'search': {
      const args = READERS.search(tab.input);
      return args ? { kind: 'search', tabId: tab.id, args } : fileInput(tab);
    }
    case 'web': {
      const args = READERS.web(tab.input);
      return args ? { kind: 'web', tabId: tab.id, args } : fileInput(tab);
    }
    default:
      return fileInput(tab);
  }
}

/** Narrowed readers keep the switch above readable and type-safe. */
const READERS: {
  calendar: (json: unknown) => CalendarTabArgs | null;
  settings: (json: unknown) => SettingsTabArgs | null;
  search: (json: unknown) => SearchTabArgs | null;
  web: (json: unknown) => WebTabArgs | null;
} = {
  calendar: readCalendarArgs,
  settings: (json) => readSettingsArgs(json),
  search: readSearchArgs,
  web: readWebArgs,
};
