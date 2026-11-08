import { forceWinChromePreview, isMacOS, isWindowsDesktop } from './platform';

/**
 * Which window chrome this window draws (docs/v5-ui-spec.md §3). Computed once:
 * the platform does not change at runtime.
 *
 * macOS — `titleBarStyle: "Overlay"` (tauri.conf.json), with
 * `trafficLightPosition: { x: 20, y: 20 }`: the OS draws the traffic lights on
 * top of our own 52px header line. Since V1 moved the file tree into the left
 * dock, that header spans the full window width (the dock sits below it), so
 * the header always reserves room for them — see `MAC_TRAFFIC_INSET`.
 *
 * Windows — the build is frameless (`decorations: false`), so we draw a 44px
 * title bar with the in-app menus and the caption buttons above the header.
 * `?forceWinChrome` previews it in a dev build on any OS.
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
 * 52px header, starting at `trafficLightPosition.x = 20`; ~72px covers their
 * right edge, +8px keeps the first control off the green button. The inset is
 * unconditional (not tied to a side panel being hidden): after V1 the header
 * spans the whole window width, so the lights always sit on its left end.
 *
 * Mirrored as `padding-left` on the header by Toolbar.vue.
 * Needs re-measuring on a real Mac — the position is OS-version dependent and
 * the lights disappear in fullscreen.
 */
export const MAC_TRAFFIC_INSET = 80;
