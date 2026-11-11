/**
 * Web tabs: URL validation, host helpers and per-host display preferences.
 *
 * The app runs in a secure context, so only https is accepted (an http
 * subframe would be blocked as mixed content). Some hosts refuse framing via
 * `X-Frame-Options` / CSP and cannot be detected from the parent page, so a
 * static list covers the common ones and everything else falls back to a
 * timed "open externally" hint.
 */

export type WebTabMode = 'frame' | 'external';

const PREFS_KEY = 'solomd.webTabs.v1';

/** Hosts known to refuse embedding. Matched against the host and its
 *  subdomains (`www.` included). Not exhaustive — only a fast path. */
const FRAME_BLOCKERS = [
  'google.com',
  'youtube.com',
  'github.com',
  'gitlab.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'reddit.com',
  'amazon.com',
  'apple.com',
  'microsoft.com',
  'openai.com',
  'chatgpt.com',
  'notion.so',
  'figma.com',
  'discord.com',
  'slack.com',
  'zoom.us',
  'bilibili.com',
  'zhihu.com',
  'weibo.com',
  'baidu.com',
  'taobao.com',
  'jd.com',
  'douban.com',
];

export function normalizeUrl(raw: string): string | null {
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

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isKnownFrameBlocker(host: string): boolean {
  const h = host.toLowerCase();
  return FRAME_BLOCKERS.some((blocked) => h === blocked || h.endsWith(`.${blocked}`));
}

export function readHostPrefs(): Record<string, WebTabMode> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, WebTabMode> = {};
    for (const [host, mode] of Object.entries(parsed)) {
      if (mode === 'external' || mode === 'frame') out[host] = mode;
    }
    return out;
  } catch {
    return {};
  }
}

export function hostPreference(host: string): WebTabMode {
  return readHostPrefs()[host.toLowerCase()] ?? 'frame';
}

/** `frame` is the default and is dropped from storage, keeping the map small. */
export function setHostPreference(host: string, mode: WebTabMode) {
  try {
    const prefs = readHostPrefs();
    if (mode === 'frame') delete prefs[host.toLowerCase()];
    else prefs[host.toLowerCase()] = mode;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}
