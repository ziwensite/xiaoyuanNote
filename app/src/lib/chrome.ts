import { forceWinChromePreview, isMacOS, isWindowsDesktop } from './platform';

/**
 * Which window chrome this window draws (docs/v5-ui-spec.md §3). Computed once:
 * the platform does not change at runtime.
 *
 * macOS — `titleBarStyle: "Overlay"` (tauri.conf.json), with
 * `trafficLightPosition: { x: 20, y: 12 }`: the OS draws the traffic lights on
 * top of our own 36px header row (the three-column shell has no row inside the
 * window for the menu bar; the menus are the system ones). `y = 12` centres
 * the 12px buttons in 36px. The leftmost visible column's header reserves the
 * horizontal room — see `MAC_TRAFFIC_INSET`.
 *
 * Windows — the build is frameless (`decorations: false`), so we draw a 36px
 * title bar with the in-app menus and the caption buttons above the 36px
 * header row. `?forceWinChrome` previews it in a dev build on any OS.
 */
const winPreview = import.meta.env.DEV && forceWinChromePreview();
const hasTauriShell = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const macTitleBar = isMacOS() && !winPreview;
export const winTitleBar = (isWindowsDesktop() && hasTauriShell) || winPreview;
export const customTitleBar = macTitleBar || winTitleBar;

/**
 * Left inset the macOS header must reserve for the traffic lights, in px.
 *
 * With `titleBarStyle: "Overlay"` the three buttons are OS-drawn *over* our
 * 36px header, starting at `trafficLightPosition.x = 20`; ~72px covers their
 * right edge, +8px keeps the first control off the green button. The inset is
 * paid by the LEFTMOST VISIBLE COLUMN's header (the left dock's while it is
 * open, otherwise the editor's) — see App.vue's `leftTrafficInset` /
 * `middleTrafficInset`.
 *
 * Mirrored as `padding-left` on that header by SidebarDock.vue / Toolbar.vue.
 * Needs re-measuring on a real Mac — the position is OS-version dependent and
 * the lights disappear in fullscreen.
 */
export const MAC_TRAFFIC_INSET = 80;
