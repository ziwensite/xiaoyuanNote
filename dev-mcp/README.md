# xiaoyuan-note-dev-mcp

**Internal-only MCP server for end-to-end self-testing of xiaoyuan-note.** Not shipped to users; sits next to (not inside) the user-facing `xiaoyuan-note-mcp` so the test harness can never accidentally surface in a release build.

## Why

The end-user `xiaoyuan-note-mcp` exposes a vault to LLM clients. This separate server exposes xiaoyuanNote’s own internal state (settings, tabs, AutoGit, file system) so Claude can drive the app from the outside and verify that a feature actually works — the rule from `~/.claude/CLAUDE.md` is "every client project ships with CLI + MCP for self-test."

We use this dev MCP for things AppleScript can't reliably do (clicking nested WKWebView elements like the History panel's Restore button) and for state setup that would otherwise require a human (toggling settings before a fresh launch).

## Tools

| Tool | What it does |
|---|---|
| `XIAOYUAN_NOTE_get_settings` / `XIAOYUAN_NOTE_set_setting` | Read / write `xiaoyuan-note.settings.v1` in the WebKit LocalStorage SQLite. |
| `XIAOYUAN_NOTE_get_workspace` / `XIAOYUAN_NOTE_set_workspace` | Read / set `currentFolder`. |
| `XIAOYUAN_NOTE_get_tabs` / `XIAOYUAN_NOTE_set_tabs` | Read / replace the tabs state with a single open tab. |
| `XIAOYUAN_NOTE_git_status` | Same payload as the `git_workspace_status` Tauri command. |
| `XIAOYUAN_NOTE_git_init` | Initialize the folder + initial commit. |
| `XIAOYUAN_NOTE_git_commit` | Stage and commit. Returns the new SHA or null. |
| `XIAOYUAN_NOTE_git_log` | List commits that touched a single file, newest first. |
| `XIAOYUAN_NOTE_git_file_at` | Read a file's content at a specific commit (no disk write). |
| `XIAOYUAN_NOTE_git_rollback` | Overwrite the working-copy file with the version at a SHA. |
| `XIAOYUAN_NOTE_rag_status` | v2.3: report semantic-index status for a workspace folder. |
| `XIAOYUAN_NOTE_rag_reindex` | v2.3: full reindex into `<folder>/.xiaoyuan-note/embeddings.sqlite`. |
| `XIAOYUAN_NOTE_rag_search` | v2.3: semantic search over an indexed workspace; ranks by cosine similarity. |
| `XIAOYUAN_NOTE_dev_eval` | **v2.3**: run arbitrary JS inside xiaoyuanNote’s WebView, return its result (live UI bridge). |
| `XIAOYUAN_NOTE_dev_click` | **v2.3**: click the first DOM element matching a CSS selector. |
| `XIAOYUAN_NOTE_dev_text` | **v2.3**: read `textContent` of one (or all) elements matching a selector. |
| `XIAOYUAN_NOTE_dev_dispatch` | **v2.3**: dispatch a DOM event (keyboard / mouse / custom) on a selector. |
| `XIAOYUAN_NOTE_dev_url` | **v2.3**: report `location.href` of the WebView. |
| `XIAOYUAN_NOTE_dev_wait_for` | **v2.3**: poll until a selector matches or timeout. |
| `XIAOYUAN_NOTE_read_file` / `XIAOYUAN_NOTE_write_file` | Plain disk read/write for verification. |
| `XIAOYUAN_NOTE_screenshot` | `screencapture -x` to a temp PNG; returns the path. |
| `XIAOYUAN_NOTE_app_status` | List running xiaoyuanNote processes (so you know if you're testing dev or prod). |

LocalStorage writes (`XIAOYUAN_NOTE_set_setting` / `XIAOYUAN_NOTE_set_workspace` / `XIAOYUAN_NOTE_set_tabs`) require **xiaoyuanNote be closed** — WKWebView holds the SQLite open exclusively while running.

## Build + run

```bash
cd dev-mcp
cargo build                # debug
cargo build --release      # 1.5 MB single binary
./target/debug/xiaoyuan-note-dev-mcp -v
```

Speaks JSON-RPC over stdio. Logs to stderr.

## Register with Claude Code

```bash
claude mcp add --scope user xiaoyuan-note-dev -- \
  /Volumes/Dev/code/notebook/dev-mcp/target/debug/xiaoyuan-note-dev-mcp
```

After restarting Claude Code, the tools show up as `mcp__xiaoyuanNote-dev__XIAOYUAN_NOTE_*`.

## Bundle id distinction

WebKit LocalStorage is keyed by bundle id:

- **dev** (`bundle: "dev"`) → `~/Library/WebKit/xiaoyuan-note/...` — what `pnpm tauri dev` writes.
- **prod** (`bundle: "prod"`) → `~/Library/WebKit/app.xiaoyuan-note/...` — the installed dmg.

Default is `dev`. The two never share state, which has bitten me twice — be explicit when scripting.

## Live UI driving (v2.3 dev-bridge)

The `XIAOYUAN_NOTE_dev_*` family lets you reach into the running WebView and drive
the actual Vue components — clicking buttons, reading rendered text, firing
keyboard events, asserting on DOM after navigation. This closes the last
gap the dev MCP used to call out as "out of scope".

**How it works:** the xiaoyuanNote debug build (only — `#[cfg(debug_assertions)]`-gated)
spawns a tiny localhost JSON-RPC server (`app/src-tauri/src/dev_bridge.rs`) on
a random port and writes the port + a per-launch bearer token to:

```
~/Library/Application Support/app.xiaoyuan-note/dev-bridge.port
~/Library/Application Support/app.xiaoyuan-note/dev-bridge.token   (mode 0600)
```

The dev-mcp tools read those files at call time and POST to `/eval`. The
WebView runs the script inside an `async` IIFE and POSTs the JSON-encoded
result back to the bridge. Round-trip is typically <10 ms on warm cache.

**Release builds don't include any of this** — the entire `dev_bridge`
module is `#[cfg(debug_assertions)]`. Verify with
`nm app/src-tauri/target/release/xiaoyuanNote | grep dev_bridge` — you should
see zero matches.

**Worked example (drive the active tab name):**

```jsonc
// XIAOYUAN_NOTE_dev_url
"http://localhost:1420/"

// XIAOYUAN_NOTE_dev_text { selector: ".tab--active .tab__name" }
"note.md"

// XIAOYUAN_NOTE_dev_eval { script: "return document.querySelectorAll('button').length;" }
36

// XIAOYUAN_NOTE_dev_wait_for { selector: ".cm-editor", timeout_ms: 5000 }
{ "matched": true, "elapsed_ms": 0, "selector": ".cm-editor" }

// XIAOYUAN_NOTE_dev_click { selector: "button[title^=\"切换文件树\"]" }
{ "matched": true, "selector": "...", "tag": "button" }

// XIAOYUAN_NOTE_dev_dispatch { selector: "body", event: "keydown",
//                       init: { "key": "k", "metaKey": true } }
{ "matched": true, "default_prevented": false }
```

If xiaoyuanNote isn't running you get a friendly error pointing you at
`pnpm tauri dev`. Each call is independently authenticated via the bearer
token, so a stray process can't talk to the bridge by accident.

**Foreground gotcha (macOS):** WKWebView aggressively throttles JS execution
when the window is occluded or even just below another window — `eval` calls
queue up but don't actually fire until xiaoyuanNote becomes the foreground app
**and** its window is raised. There's no Tauri 2 / wry API to bypass this —
it's AppKit gating the run loop. If `XIAOYUAN_NOTE_dev_eval` times out, bring the
window forward and retry. The reliable invocation is two-step (plain
`activate` is sometimes not enough if xiaoyuanNote’s window is occluded by a
maximized terminal):

```bash
osascript <<'EOF'
tell application "xiaoyuanNote" to activate
delay 0.3
tell application "System Events"
  tell process "xiaoyuanNote"
    set frontmost to true
    perform action "AXRaise" of window 1
  end tell
end tell
EOF
```

(In CI you can either run with the xiaoyuanNote window visible from the start, or
schedule the AXRaise step before each `XIAOYUAN_NOTE_dev_*` call.)

## What this DOESN'T cover

- Production app store builds — same code paths but in a sandboxed location we can't poke. The dev-bridge is debug-only and the released DMG/MAS bundle has zero bridge code.

For the in-flight pieces dev MCP covers (settings persist, AutoGit init/commit/rollback, file roundtrip, RAG index/search, **live UI driving**), it's the source of truth — `cargo build && ./target/debug/xiaoyuan-note-dev-mcp` and you can run the same JSON-RPC sequences in CI.
