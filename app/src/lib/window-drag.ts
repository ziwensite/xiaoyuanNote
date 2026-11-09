/**
 * Window dragging for the custom chrome (macOS unified title bar and the
 * frameless Windows build).
 *
 * The declarative `data-tauri-drag-region` attribute proved unreliable on
 * macOS once the unified title bar shipped, so dragging is driven explicitly.
 * Shared by the toolbar/header and the side-column headers: all three are part
 * of the top chrome when the platform draws none itself.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';

import { customTitleBar } from './chrome';

const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [role="tab"], [contenteditable="true"], .dropdown__menu, [data-no-drag]';

/** Any clickable chrome inside a draggable region opts out of window drag. */
export function isInteractiveChromeTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return !!node?.closest?.(INTERACTIVE_SELECTOR);
}

function canDriveWindow(e: MouseEvent): boolean {
  if (!customTitleBar || e.button !== 0) return false;
  if (isInteractiveChromeTarget(e.target)) return false;
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Start an OS window drag (Aero snap included). Returns whether it ran. */
export function dragWindowFromChrome(e: MouseEvent): boolean {
  if (!canDriveWindow(e) || e.detail > 1) return false;
  void getCurrentWindow().startDragging();
  return true;
}

/** Double-click on empty chrome toggles maximize, mirroring the native bar. */
export function toggleMaximizeFromChrome(e: MouseEvent): boolean {
  if (!canDriveWindow(e)) return false;
  void getCurrentWindow().toggleMaximize();
  return true;
}
