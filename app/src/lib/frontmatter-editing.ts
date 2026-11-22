/**
 * Interactions + write-back for the Obsidian-style properties card emitted by
 * `renderFrontmatterHtml(raw, { editable: true })`.
 *
 * Edits go into the ACTIVE TAB's text (never straight to disk): the Rust
 * round-trip command used by the sidebar inspector rewrites the whole file
 * and would clobber unsaved body edits. `patchFrontmatterWithReport` changes
 * only the named key's source lines, so comments, key order, CRLF and the
 * body survive; `tabs.setContent` leaves the tab dirty and lets the normal
 * save path persist it.
 *
 * Type changes (click a key's icon) go through `usePropertiesStore` — the
 * same store the sidebar inspector uses — so overrides persist to
 * `.xiaoyuan-note/properties.json` and both views agree.
 *
 * Document-level delegated listeners cover every rendering surface —
 * preview, reading view, the Windows plain live editor and the CodeMirror
 * live-edit widget — because all of them inject the same HTML.
 */
import { useTabsStore } from '../stores/tabs';
import { usePropertiesStore } from '../stores/properties';
import { patchFrontmatterWithReport } from './frontmatter';
import { DISPLAY_MODES, type DisplayMode } from './property-types';
import { iconSvg, MODE_LABELS, setUserCollapsed } from './frontmatter-render';

const IS_ZH = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh');
const NEW_KEY_HINT = IS_ZH ? '属性名，回车确认' : 'Property name, Enter to confirm';

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"' +
  ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

/** Patch one key into the active tab's text. No-op without an active tab. */
function writePatch(key: string, value: unknown): void {
  const tabs = useTabsStore();
  const id = tabs.activeId;
  if (!id) return;
  // The editor syncs doc -> store on a 350 ms debounce. Flush first so the
  // patch applies to what is on screen, not to text a few keystrokes old.
  window.dispatchEvent(new Event('xiaoyuan-note:flush-content-sync'));
  const tab = tabs.tabs.find((x) => x.id === id);
  if (!tab) return;
  try {
    const report = patchFrontmatterWithReport(tab.content, { [key]: value });
    if (report.text !== tab.content) tabs.setContent(id, report.text);
  } catch (e) {
    // Duplicate keys / non-mapping root / dangling aliases: never write a
    // half-parsed block. The next render restores the control's real value.
    console.warn('[frontmatter] value edit rejected:', e);
  }
}

/** Public write-back used by the in-app date picker (App.vue) after the user
 *  picks a date inside the frontmatter card. */
export function writeFrontmatterValue(key: string, value: unknown): void {
  writePatch(key, value);
}

function coercedValue(el: HTMLElement): unknown {
  const mode = el.dataset.fmMode;
  const raw = (el as HTMLInputElement).value;
  if (mode === 'boolean') return raw === 'true';
  if (mode === 'number') return raw.trim() === '' ? '' : Number(raw);
  return raw;
}

function tagList(wrap: Element | null): string[] {
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll<HTMLElement>('.md-prop__tag'))
    .map((p) => p.dataset.fmTagText ?? '')
    .filter((s) => s !== '');
}

/** Commit the tag input: existing pills + whatever is typed. Enter and blur
 *  both funnel here, and the input clears so blur can't double-commit. */
function writeTags(input: HTMLInputElement): void {
  const key = input.dataset.fmKey;
  if (!key) return;
  const pending = input.value.trim();
  const wrap = input.closest('[data-fm-tags]');
  const next = pending ? [...tagList(wrap), pending] : tagList(wrap);
  input.value = '';
  writePatch(key, next);
}

function onChange(ev: Event): void {
  const el = ev.target as HTMLElement | null;
  if (!el || !el.dataset) return;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return;
  const key = el.dataset.fmKey;
  if (!key) return;
  if (el.dataset.fmMode === 'tags') {
    writeTags(el as HTMLInputElement);
    return;
  }
  writePatch(key, coercedValue(el));
}

/* ------------------------------------------------------------- type menu */

let openMenu: HTMLElement | null = null;

function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/** A mousedown anywhere outside the open type menu — any button, left or right
 *  — dismisses it, so it can never sit on top of another popup (e.g. the
 *  editor's own context menu). Every popup following this single rule is
 *  mutually exclusive for free. */
function dismissOnDocDown(ev: MouseEvent): void {
  if (openMenu && !openMenu.contains(ev.target as Node)) closeMenu();
}

function openModeMenu(key: string, anchor: HTMLElement): void {
  closeMenu();
  let override: DisplayMode | undefined;
  try {
    override = usePropertiesStore().overrideFor(key);
  } catch {
    override = undefined;
  }
  const current = (anchor.dataset.fmMode as DisplayMode) || 'text';
  const menu = document.createElement('div');
  menu.className = 'md-prop-menu';
  menu.dataset.fmMenuKey = key;
  const item = (mode: string, label: string, icon: string, checked: boolean): string =>
    `<button type="button" class="md-prop-menu__item${checked ? ' md-prop-menu__item--on' : ''}"` +
    ` data-fm-mode-set="${mode}"><span class="md-prop-menu__icon">${icon}</span>${label}` +
    (checked ? '<span class="md-prop-menu__check">✓</span>' : '') +
    '</button>';
  const parts: string[] = [
    `<div class="md-prop-menu__head">${IS_ZH ? '属性类型' : 'Property type'}` +
      `<span class="md-prop-menu__hint">›</span></div>`,
    item(
      'auto',
      IS_ZH ? `自动 (${MODE_LABELS[current]})` : `Automatic (${MODE_LABELS[current]})`,
      iconSvg(current),
      !override,
    ),
  ];
  for (const m of DISPLAY_MODES) parts.push(item(m, MODE_LABELS[m], iconSvg(m), override === m));
  parts.push(
    `<button type="button" class="md-prop-menu__item md-prop-menu__item--danger" data-fm-remove="1">` +
      `<span class="md-prop-menu__icon">${TRASH_ICON}</span>${IS_ZH ? '移除属性' : 'Remove property'}</button>`,
  );
  menu.innerHTML = parts.join('');
  document.body.appendChild(menu);
  // Keep the menu inside the viewport, flipping above when near the bottom.
  const r = anchor.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 4;
  if (left + menu.offsetWidth > window.innerWidth - 8) left = window.innerWidth - menu.offsetWidth - 8;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = r.top - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  openMenu = menu;
}

/** Persist a type override (or clear it with 'auto'). */
function applyModeSet(key: string, mode: string): void {
  try {
    void usePropertiesStore().setDisplayMode(key, mode === 'auto' ? null : (mode as DisplayMode));
  } catch {
    /* no active Pinia — nothing to persist */
  }
}

/** Commit the inline "add property" input. Guarded with fmDone so the
 *  focusout fired by removing a focused input can't double-commit. */
function commitNewProperty(input: HTMLInputElement): void {
  if (input.dataset.fmDone) return;
  input.dataset.fmDone = '1';
  const key = input.value.trim();
  input.remove();
  // `''` creates the key with an empty value; the next render shows the row.
  if (key) writePatch(key, '');
}

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && openMenu) {
    closeMenu();
    return;
  }
  // IME composition (Chinese/Japanese): Enter just confirms a candidate and
  // must not commit a tag or the new-property input.
  if (ev.isComposing || ev.keyCode === 229) return;
  const el = ev.target as HTMLElement | null;
  if (!el || !el.dataset) return;
  // Enter in a tag input commits the pending tag immediately.
  if (el.dataset.fmMode === 'tags') {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    writeTags(el as HTMLInputElement);
    return;
  }
  // The inline "add property" input: Enter creates the key, Escape cancels.
  if (!el.classList.contains('md-prop--new')) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    (el as HTMLInputElement).dataset.fmDone = '1';
    el.remove();
    return;
  }
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  commitNewProperty(el as HTMLInputElement);
}

function onClick(ev: MouseEvent): void {
  const target = ev.target as HTMLElement | null;
  // A click outside the open menu closes it and then behaves normally.
  if (openMenu && !openMenu.contains(target as Node)) closeMenu();

  const targetEl = target as HTMLElement | null;
  if (openMenu) {
    const set = targetEl?.closest?.('[data-fm-mode-set]');
    if (set) {
      ev.preventDefault();
      const key = openMenu.dataset.fmMenuKey ?? '';
      closeMenu();
      if (key) applyModeSet(key, set.getAttribute('data-fm-mode-set') ?? 'auto');
      return;
    }
    const rm = targetEl?.closest?.('[data-fm-remove]');
    if (rm) {
      ev.preventDefault();
      const key = openMenu.dataset.fmMenuKey ?? '';
      closeMenu();
      // `undefined` deletes the key from the frontmatter block.
      if (key) writePatch(key, undefined);
      return;
    }
    if (openMenu.contains(targetEl as Node)) return; // menu body: no-op
  }

  // A key's type icon opens the menu. This MUST run before the date branch
  // below: the type-icon button itself carries `data-fm-mode`, so a broad
  // `[data-fm-mode="date"]` match would swallow the type-menu click.
  const menuBtn = targetEl?.closest?.('[data-fm-menu]');
  if (menuBtn) {
    ev.preventDefault();
    openModeMenu(menuBtn.getAttribute('data-fm-menu') ?? '', menuBtn as HTMLElement);
    return;
  }

  // Date control: ONLY the calendar icon (not the text input) opens the in-app
  // picker (DatePickerPopover). The input stays editable so the user can type a
  // date by hand; its change event (handled below) writes the value back.
  const dateTrigger = targetEl?.closest?.('[data-fm-date-trigger]');
  if (dateTrigger) {
    ev.preventDefault();
    const input = dateTrigger.parentElement?.querySelector?.(
      'input.md-prop__value--date',
    ) as HTMLInputElement | null;
    const r = dateTrigger.getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent('xiaoyuan-note:open-fm-date', {
        detail: {
          key: dateTrigger.getAttribute('data-fm-key') ?? '',
          iso: input?.value ?? '',
          x: r.left,
          y: r.bottom,
        },
      }),
    );
    return;
  }

  // Remove one tag pill.
  const x = targetEl?.closest?.('[data-fm-tag-remove]');
  if (x) {
    ev.preventDefault();
    const key = x.getAttribute('data-fm-tag-remove') ?? '';
    const pill = x.closest('.md-prop__tag');
    const wrap = x.closest('[data-fm-tags]');
    const idx = Array.from(wrap?.querySelectorAll('.md-prop__tag') ?? []).indexOf(
      pill as Element,
    );
    const next = tagList(wrap);
    if (idx >= 0) next.splice(idx, 1);
    writePatch(key, next);
    return;
  }
  // "Add a property": an inline key input; Enter creates it with an empty
  // value and the normal render turns it into a new row.
  const add = targetEl?.closest?.('[data-fm-add]');
  if (add) {
    ev.preventDefault();
    if (add.nextElementSibling?.classList.contains('md-prop--new')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'md-prop__value md-prop--new';
    input.placeholder = NEW_KEY_HINT;
    add.after(input);
    input.focus();
    return;
  }
  // Title row toggles collapse; remembered per device.
  const btn = targetEl?.closest?.('[data-fm-toggle]');
  if (!btn) return;
  ev.preventDefault();
  const card = btn.closest('.md-frontmatter--editable');
  if (!card) return;
  const collapsed = card.classList.toggle('md-frontmatter--collapsed');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  // Session-level manual choice: wins over the settings default until reload.
  setUserCollapsed(collapsed);
}

function onNewBlur(ev: Event): void {
  const el = ev.target as HTMLElement | null;
  // Clicking elsewhere commits a typed name instead of dropping it.
  if (el?.classList?.contains('md-prop--new')) commitNewProperty(el as HTMLInputElement);
}

if (typeof document !== 'undefined') {
  document.addEventListener('change', onChange, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', onNewBlur, true);
  // A mousedown outside the type menu (any button) closes it.
  document.addEventListener('mousedown', dismissOnDocDown, true);
}
