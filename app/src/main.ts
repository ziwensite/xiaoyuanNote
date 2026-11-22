import { createApp, defineAsyncComponent } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { followHtmlLang } from './i18n';
import { reanchorIosContainerPaths } from './lib/ios-container';
import { isMobile, isWindowsDesktop } from './lib/platform';
import { installNativeMenuGuard } from './lib/native-menu-guard';
import { preloadRenderDeps } from './lib/render-deps';
import './lib/frontmatter-editing';
import './styles/cjk-font.css';
import './styles/main.css';
import './styles/hljs-theme.css';
import 'katex/dist/katex.min.css';

// Brand migration: old settings/tab/window keys stay in place as a fallback,
// but first run copies them under the new xiaoyuan-note prefix so no user
// settings, workspaces, window layouts or per-window tabs are lost.
function copyLegacyStorage(store: Storage, legacyPrefix: string, nextPrefix: string): void {
  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(legacyPrefix)) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {
      const nextKey = nextPrefix + key.slice(legacyPrefix.length);
      if (store.getItem(nextKey) !== null) continue;
      const value = store.getItem(key);
      if (value !== null) store.setItem(nextKey, value);
    }
  } catch {
    // Storage can be unavailable in private webviews; stores already tolerate it.
  }
}
copyLegacyStorage(localStorage, 'solomd.', 'xiaoyuan-note.');
copyLegacyStorage(localStorage, 'solomd-window-', 'xiaoyuan-note-window-');
copyLegacyStorage(localStorage, 'solomd:', 'xiaoyuan-note:');
copyLegacyStorage(sessionStorage, 'solomd:', 'xiaoyuan-note:');

const params = new URLSearchParams(window.location.search);
const isSlideshow = params.get('slideshow') === '1';
// The quick-capture box is a second webview on the same bundle rather than a
// separate entry point: it needs the settings and workspace stores (theme,
// language, current folder) and gets them from the shared localStorage for
// free this way.
// Detected via the hash (not a query string): a query on an `App("index.html")`
// URL is dropped by Tauri's dev asset resolver, which left the capture box a
// blank window in `tauri dev`. The hash survives both dev and the bundled
// `tauri://localhost` protocol.
const isQuickCapture =
  params.get('quickCapture') === '1' || window.location.hash.includes('quickCapture=1');

// Both alternate roots are chosen by a URL param that the main window never
// carries, so they are loaded on demand — keeping reveal.js and the capture
// box out of the entry chunk every normal launch has to compile.
const rootComponent = isSlideshow
  ? defineAsyncComponent(() => import('./components/Slideshow.vue'))
  : isQuickCapture
    ? defineAsyncComponent(() => import('./components/QuickCapture.vue'))
    : App;
// Dev-only: ?imetrace loads dev/ime-trace.js (IME event tracer for the
// Windows VM tests). Stripped from production builds by the DEV guard.
if (import.meta.env.DEV && /[?&]imetrace\b/.test(location.search)) {
  const s = document.createElement('script');
  s.src = '/dev/ime-trace.js';
  document.head.appendChild(s);
}

const app = createApp(rootComponent);
app.use(createPinia());
followHtmlLang();
// No browser Back / Reload / Print menu on app chrome (lib/native-menu-guard).
installNativeMenuGuard({ mobile: isMobile(), dev: import.meta.env.DEV });

// Windows: the editor engine follows the WebView2 version (platform.ts
// resolveWindowsEditorEngine), and Editor.vue decides it once at load, so the
// version must be known before mount.
async function readWebviewVersion(): Promise<void> {
  if (!isWindowsDesktop()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const v = await invoke<string | null>('webview_runtime_version');
  if (v) (window as unknown as { __XIAOYUAN_NOTE_WEBVIEW_VERSION__?: string }).__XIAOYUAN_NOTE_WEBVIEW_VERSION__ = v;
}

// iOS: point stored paths at the current app container before any store reads
// them (lib/ios-container). Both are bounded, so a slow API never blocks
// launch — an unknown WebView2 version just means the native textarea.
void Promise.race([
  Promise.all([
    reanchorIosContainerPaths().catch(() => {}),
    readWebviewVersion().catch(() => {}),
  ]),
  new Promise((r) => setTimeout(r, 1500)),
]).then(() => {
  app.mount('#app');
  // KaTeX + highlight.js are their own chunks (lib/render-deps.ts): fetch and
  // compile them once the first frame is up, so they are almost always ready
  // before a formula or code fence is on screen. The capture box never
  // renders markdown; the slideshow awaits them itself.
  if (rootComponent === App) preloadRenderDeps();
});
