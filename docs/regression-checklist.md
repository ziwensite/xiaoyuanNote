# Full regression checklist

Run before every major release. Built from the app's own tables — the menu
(`lib/app-menu.ts`), palette commands (`composables/useCommands.ts`),
bindable actions (`lib/keybindings.ts`) and settings — so a feature that is in
the app is on this list. Add a row when you add a feature.

Platforms: **M** macOS (Developer ID) · **S** Mac App Store build (no AI) ·
**W** Windows (CodeMirror engine; **Wp** = plain/native engine) · **L** Linux ·
**I** iOS/iPadOS app · **A** Android app. "—" = not on that platform.

Automated layers that run first: `pnpm test` (frontend unit tests),
`cargo test --lib` (Rust), `.github/workflows/tests.yml` in CI.

## A. Files, tabs, windows
| id | check | pass when |
|---|---|---|
| A1 | file.new / file.newText | new untitled tab of the right type, focused editor |
| A2 | file.newInFolder | file created in the selected folder, appears in tree |
| A3 | file.open / file.openFolder | picker opens; file/folder loads; tree shows folder |
| A4 | file.save / file.saveAs | bytes on disk match editor; dirty dot clears; save-as renames tab |
| A5 | file.autoSave (focus change) | switching window writes the file |
| A6 | file.closeTab / tab.reopenClosed | unsaved prompt on dirty; reopen restores the tab |
| A7 | tab.next / tab.prev / click tab | active tab changes (click must work on Windows title row) |
| A8 | file.import (docx/pdf/xlsx) | converted Markdown opens |
| A9 | file.openExternal | file opens in system app |
| A10 | recent list / recent.clear | recent shows last files; clear empties it |
| A11 | window.new | second window works independently |
| A12 | session restore | quit + relaunch restores tabs, cursor, unsaved buffer |
| A13 | external change | file edited outside reloads (or asks when dirty) |
| A14 | tree: rename / move (drag) / delete→trash / reveal | disk changes match; tree follows active file |
| A15 | encodings | GBK / Big5 / UTF-16 files open correctly and save back |

## B. Editing and formatting
| id | check | pass when |
|---|---|---|
| B1 | fmt.* (bold, italic, strike, code, link, h1–h6, ul, ol, task, quote, …) | each toggles on and off; selection kept; CJK not over-extended |
| B2 | heading.promote / demote / paragraph | level changes |
| B3 | insert.table / mathBlock / mathInline / mermaid / hr | snippet inserted, cursor placed |
| B4 | editor.insertImage / insertImageUrl / paste image / drop image | image saved to assets, link inserted, renders |
| B5 | editor.tableEditor / formulaEditor | editor opens, edits write back |
| B6 | editor.case* (upper/lower/title/cycle) | text transformed |
| B7 | editor.selectWord / selectLine / deleteWord / jumpToSelection | behave |
| B8 | undo / redo across all of the above | restores exactly |
| B9 | list continuation, renumbering, Tab indent | correct numbers |
| B10 | task checkbox click (live + preview) | toggles `[ ]`/`[x]` in source |
| B11 | [[wiki link]] autocomplete + click to open | completes; opens target |
| B12 | fold.toggle / all / none + gutter chevrons | folds headings |
| B13 | selection bubble | appears on selection, buttons apply, hides while find bar focused |
| B14 | IME (Chinese) typing in editor, find bar, settings fields | no dropped/doubled chars (W: MS Pinyin + Sogou) |

## C. Find and navigation
| id | check | pass when |
|---|---|---|
| C1 | editor.find (Ctrl/⌘F) | bar opens, query focus, n/m count, Enter cycles, Esc closes |
| C2 | editor.replace (Ctrl+H / ⌘⌥F) | replace one / all; Aa / .* / W options |
| C3 | search.global | results across folder; click jumps to line |
| C4 | quickSwitcher.open / palette.open | open; fuzzy match; Enter runs |
| C5 | preview find | find works in preview/reading |

## D. Views and display
| id | check | pass when |
|---|---|---|
| D1 | Live / Source / Split / Preview switch | correct panes; math+mermaid render; split scroll sync |
| D2 | view.toggleReading / view.slideshow | reading view; slides, arrows, Esc |
| D3 | focus mode / typewriter / line numbers / wrap / live preview / fit width | each toggles visibly and persists |
| D4 | view.toggleToolbar, view.toggleFileTree (Ctrl/⌘B once = once) | toggles exactly once (Linux GTK!) |
| D5 | zoom editor / preview / UI (in/out/reset) | sizes change, reset restores |
| D6 | theme light/dark/system + theme styles + custom CSS / clear | applied everywhere incl. menus, dialogs, find bar |
| D7 | tile.splitRight / splitDown / focusNext / focusPrev / closePane | panes split and close |
| D8 | narrow window | menus stay on screen; header doesn't overflow |

## E. Panels
| id | check | pass when |
|---|---|---|
| E1 | outline / backlinks / tags / tasks / types / neighborhood / relationships | open, show correct data, click navigates |
| E2 | history panel / inspector (properties) / views / bases | open and work |
| E3 | view.resetSidebarPanes, splitter drag | layout resets |

## F. Export
| id | check | pass when |
|---|---|---|
| F1 | export.pdf (text) / pdfPrint | file written, text selectable, math/mermaid/images present, no endless pages |
| F2 | export.docx (+ template) | opens in Word; tables, images, lists |
| F3 | export.html / image | file written; looks like preview |
| F4 | export.epub / odt / rtf / latex / pandocCustom | with pandoc installed; clear message without |
| F5 | export.copyMd / copyHtml / copyPlain / copyImage | clipboard holds the right format |

## G. Chinese tools
| id | check | pass when |
|---|---|---|
| G1 | cn.s2t / cn.t2s / cn.copyPinyin | correct conversion |
| G2 | proofread.cjk (F7) | real issues found; file names / ellipses / URLs not flagged; fix + fix all |

## H. Notes workflow
| id | check | pass when |
|---|---|---|
| H1 | daily today / yesterday / tomorrow | note created in daily folder |
| H2 | inbox.open / organizeAndAdvance / toggle | works |
| H3 | capture.quick | captured text lands in inbox |
| H4 | pomodoro open / startLast | timer runs, notifies |
| H5 | type.create / views.create / views.toggle / bases.open | created and listed |
| H6 | clean.stripMarkdown / clean.aiArtifacts / format.markdown | text cleaned |

## I. History and sync
| id | check | pass when |
|---|---|---|
| I1 | history.initWorkspace / toggleAutoGit / commitNow | commits created; restore from history |
| I2 | sync.pullNow / pushNow / copyShareLink / note.copyGitUrl | against a test repo (GitHub + Gitea) |
| I3 | image.uploadLocalImages | image host upload (configured) |

## J. AI (not in App Store builds)
| id | check | pass when |
|---|---|---|
| J1 | wizard opens on first AI reach (not on launch) | |
| J2 | editor.aiRewrite / agent panel with Ollama + one cloud key | |
| J3 | **S/I: no AI surface at all** | no menu items, no settings, no wizard |

## K. Settings
| id | check | pass when |
|---|---|---|
| K1 | every section opens; search finds items; deep links (keys) land | |
| K2 | each toggle takes effect immediately and survives restart | |
| K3 | shortcuts: rebind, conflict warning, reset, Typora preset; native menu accelerators follow | |
| K4 | language switch (all 15) — no overflow in header, menus, settings | |
| K5 | telemetry switch (not shown in S/I) | |

## L. Platform specials
| id | check | pass when |
|---|---|---|
| L1 | M/S native menu: every item enabled state + accelerators | |
| L2 | W in-app menubar: every menu opens, items run, Alt access | |
| L3 | W plain engine (Wp): typing, IME, cross-block selection, find, focus mode | |
| L4 | W window: drag title row, snap, maximize/restore, minimize memory trim | |
| L5 | L: GTK menu accelerators fire once; AppImage + deb start | |
| L6 | I phone: home/search/editor bottom bar, keyboard bar, Files app folder, in-place edit | |
| L7 | I iPad: overlay sidebar portrait, tabs, hardware keyboard ⌘ shortcuts | |
| L8 | A: SAF folder open, edit in place, toolbar under status bar, back button | |
| L9 | touch: taps don't select chrome text; no key hints on phone | |

## M. Help, CLI, MCP
| id | check | pass when |
|---|---|---|
| M1 | help.about / checkUpdate / shortcuts / markdown / welcomeTour / cli | |
| M2 | CLI: every subcommand against a fixture vault | |
| M3 | MCP: read tools; write tools only with --allow-write | |

## N. Sidebar shell, stage 1
Rows from `docs/specs/sidebar-shell-stage1/tasks.md`. All eight were code-inferred when the stage shipped; none has been visually confirmed. "auto" marks a row a dev-bridge check can assert without a human.

| id | check | pass when | auto |
|---|---|---|---|
| N1 | both 32px activity rails are gone | panels start at the window edge; no rail DOM on either side | yes |
| N2 | icon-only dock tabs | strip shows icons only, hover gives a tooltip, Tab focus reads the pane name from `aria-label` | yes |
| N3 | same-side drag | insertion edge line appears; dropping reorders the tabs | no |
| N4 | cross-side drag | target side highlights; dropped tab appears on that side | no |
| N5 | `files` is pinned | cannot be a drag source; every left-side insertion index >= 1 | yes |
| N6 | zero-width collapse | collapsed column has no width and no focusable leftover; header toggle / `⌘B` / `⌥⌘B` reopen at the previous width | yes |
| N7 | `+` at the strip end | pane-list checkbox state matches the visible tabs | yes |
| N8 | platform regressions | mac traffic lights clear of the header buttons; tablet drawer, narrow layout (no left column), Agent auto-width 472 unchanged | no |
| N9 | two regions on one side | splitting a tab creates a second strip + body stacked below; each strip has its own `+` and `»` | yes |
| N10 | drag lands in the right region | dropping on a lower body / strip puts the tab in that region, not group 0; the insertion line appears on the right strip | no |
| N11 | splitter persists | dragging the separator changes the share; relaunch keeps it; the `files` region shows no separator and never resizes | no |
| N12 | split / merge via drag | drag a tab to its own column's foot (only that side shows the drop zone) → peel it into a new region (split); drag a tab onto another region → move/merge there, and an emptied region auto-collapses; `files` cannot be dragged out and is never a merge target; the illegal-drop guards are enforced by `splitDockGroup` / `mergeDockGroups` (unit-tested in `sidebar-dock.test.ts`) — replace the old right-click menu | yes (guards unit-tested; the drop-zone affordance still needs a human) |

## O. Virtual editor tabs (P0–P4)
From `docs/specs/editor-input-tabs/spec.md` §6(4). File-tab behaviour is the baseline: any difference is a regression.

| id | check | pass when | auto |
|---|---|---|---|
| O1 | file tabs unchanged | open / switch / save / close / context menu / drag identical to pre-P0 | yes |
| O2 | virtual tabs open, switch and close | calendar, settings, search results and a web page each open as an editor tab and close cleanly | yes |
| O3 | split and restore | dragging a virtual tab into a split works; restoring the pane keeps its kind | no |
| O4 | tab drag reorder | virtual and file tabs reorder together | no |
| O5 | session restore | relaunch restores file tabs; virtual tabs obey their `persist` rule (`never` / `workspace`) | yes |
| O6 | external change | a virtual tab never blocks the reload prompt for a file changed outside | no |
| O7 | quit confirmation | dirty file tabs still prompt; virtual tabs are never dirty | yes |
| O8 | phone layout | phone shell shows no virtual tab chrome | no |
| O9 | 15 locales | virtual tab titles and empty states are translated | yes |

## Q. Web tab hardening (P4)
From `docs/specs/editor-input-tabs/tasks.md` → "P4 安全加固". The URL and
iframe policy rows are covered by `app/src/lib/web-tab.test.ts`; the visual
rows still need a real GUI. 13 of the 15 locales ship the English fallback
string for `editorTab.webInvalid` by design — the `en` dictionary defines the
required shape, so `vue-tsc` forces every locale to declare the key.

| id | check | pass when | auto |
|---|---|---|---|
| Q1 | https-only entry | `http:` / `javascript:` / `file:` / `data:` / `blob:` / `https://user:pass@host` are all rejected; the toast follows the UI language | yes |
| Q2 | persisted URL re-validation | tamper the workspace tab bucket with a `javascript:` URL → relaunch shows the `webInvalid` card, no iframe src, copy / external / reload disabled | no |
| Q3 | iframe policy | DevTools shows the sandbox exactly as `WEB_TAB_SANDBOX` and `allow="clipboard-read; clipboard-write"`; no `allow-top-navigation*`, no `allow-modals` | yes |
| Q4 | known frame blockers | google.com / github.com show the fallback card without loading a frame; "Open in browser" remembers the host | no |
| Q5 | slow hint + reload | an unknown host that never finishes shows the 6s hint; reload clears it; links copy the normalized URL | no |
| Q6 | engine pinned to iframe | a settings blob with `webTabEngine: "webview"` still renders an iframe after relaunch | yes |
| Q7 | 15 locales | `editorTab.webInvalid` is translated in en / zh and non-empty (English fallback) in the other 13; no layout overflow | yes |

## R. Release consistency (P5)
Automated by `mcp-server/tests/release_consistency.rs` in CI and in
`scripts/release.sh`; the rows below are the artifact / runtime checks that
text parsing cannot do. `server.json` and `distribution/manifests/*` are
allowed to lag behind the code on purpose — see `mcp-server/README.md`.

| id | check | pass when | auto |
|---|---|---|---|
| R1 | version bump dry run | every version source named in the test moves together; the consistency test passes after a bump | yes |
| R2 | `server.json` refresh | after publishing, version / identifier / `fileSha256` all point at the new .mcpb; sha matches the uploaded bytes | no |
| R3 | distribution manifests | winget / scoop / homebrew installer URLs return 200 and their checksums match the published artifacts | no |
| R4 | MCP runtime | `solomd-mcp --version` equals the app version; `tools/list` is 15 without the Node backend and 16 with it; all 4 write tools reject calls without `--allow-write` | no |
| R5 | website downloads | installer filenames and `softwareVersion` match the new release; 15 locale badges show the new version | no |
| R6 | listing copy | Smithery / marketplace / llms descriptions say 16 tools (15 listed by default) | yes |

### Pre-existing Windows failures found by the full MCP baseline (2026-11-11)

`cargo test --manifest-path mcp-server/Cargo.toml -j 1` is now green. Two
failures were unrelated to the release work but were fixed rather than left
red — both came from Rust's Windows `canonicalize()` returning `\\?\C:\…`:

- `mcp-server/src/safety.rs`: `resolve_new` now rejects a literal `..`
  segment in the raw input as well as via `Path::components()`. In a
  verbatim path `..` stays a `Normal` component, so a caller could previously
  smuggle a traversal past the guard. The test now builds the path with
  `MAIN_SEPARATOR` (using `PathBuf::join("..")` normalises it away) and also
  asserts `a..b.md` is still a legal file name.
- `app/scripts/solomd-export.mjs`: `normalizePath` strips the `//?/`
  verbatim prefix before its segment walk. Without that, relative images
  resolved to `/?/C:/…` and docx exports silently lost every image
  (`export_test.rs` caught it).

CI's `mcp` job deliberately runs only `--test version_sync --test
release_consistency`: the full MCP suite needs Node plus the app's npm
dependencies for the export script, so it stays a local / release-time check
(row R4).

## S. Architecture debt: command tables and CSP (P6)

### Command registration

`app/src-tauri/tests/handler_drift_test.rs` parses both `generate_handler!`
bodies with `include_str!` and asserts that they differ only by the reviewed
platform whitelists. It runs in CI (`cargo test --test handler_drift_test`).
A **single-source macro was evaluated and rejected for now**: 44 arguments in
`lib.rs` carry in-macro `#[cfg(not(target_os = "android"))]`, 7 desktop
commands are defined inside `runner.rs` (which the lib crate never compiles),
and `holidays::*` needs a `HolidaysState` that only `lib.rs` installs. The
rationale is recorded in the test's module docs.

| id | check | pass when | auto |
|---|---|---|---|
| S1 | dual registration | adding a command to one table fails the parity test; the reviewed whitelists are still exact | yes |
| S2 | third table | `src/*.rs` contains exactly two `tauri::generate_handler![` calls, in `lib.rs` and `runner.rs` | yes |
| S3 | `holidays_*` on desktop | known one-sided registration: confirm the desktop calendar still renders holidays; if desktop registers them, remove the two whitelist entries | no |

### CSP: evaluated, deliberately not tightened

`app/src-tauri/tauri.conf.json` keeps `"csp": null` and
`assetProtocol.scope: ["**"]`. Setting a naive `default-src 'self'` would
silently break features that are otherwise covered by this checklist. Any
future tightening must first land every directive below and then pass the
real-GUI rows on all platforms (dev and production CSP differ because Tauri
injects HMR in dev).

| directive (candidate) | what breaks without it |
|---|---|
| `frame-src https:` | P4 web tabs, embedded Markdown/export preview frames |
| `img-src 'self' data: blob: asset: http://asset.localhost https:` | pasted images, `data:` images/fonts in exports, Tauri asset images, remote illustrations |
| `font-src 'self' data:` | custom font picker, embedded theme fonts |
| `style-src 'self' 'unsafe-inline'` | CodeMirror, theme CSS variables, custom CSS injection, format bubble |
| `connect-src 'self' https: http://127.0.0.1:* ws://localhost:1420` | update check, local REST / MCP calls, BYOK provider calls, Vite HMR |
| `worker-src 'self' blob:` | library workers (pdf / mermaid / html2pdf chunks) |
| `media-src 'self' data: blob:` | audio/video notes, export previews |
| `object-src 'none'` | stays closed; no current feature needs plugins |

`assetProtocol.scope: ["**"]` is a separate widening that should be narrowed
in the same change, not as a drive-by edit.

| id | check | pass when | auto |
|---|---|---|---|
| S4 | frames | web tab loads an https site; Markdown/export preview frames render; no CSP console errors | no |
| S5 | images and fonts | paste, `data:` URL, `asset:` image and remote image all render; custom font applies | no |
| S6 | styles | theme switch, CodeMirror, custom CSS and selection bubble keep their styling | no |
| S7 | network | update check, local REST/MCP, BYOK call and `pnpm dev` HMR all work | no |
| S8 | platform matrix | M / W / L / I / A production builds launch without a blank window or blocked-resource spam | no |

## P. Manual sign-off record
One row per source, per run. `未测` is the initial state; keep FAIL rows until a fix is re-verified. This environment cannot launch a Tauri GUI, so these rows need a real machine.

| run | date | env (OS / build) | source | rows | result | notes |
|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | Windows / dev | `sidebar-shell-stage1` | N1–N8 | 未测 | 代码推断，需真机目视 |
| 2 | 2026-11-11 | Windows / dev | `editor-input-tabs` §6(4) | O1–O9 | 未测 | 同上 |
| 3 | 2026-11-11 | Windows / dev | `calendar-ui-forms/tasks.md` L59 | 弹窗开关 / 重启恢复 / 月份一致 / 任务勾选与跳转 / 窄屏 | 未测 | 同上 |
| 4 | 2026-11-11 | Windows / dev | `v1-file-tree-merge/tasks.md` L83 | spec §6 人工核对 | 未测 | 同上 |
| 5 | 2026-11-11 | Windows / dev | `sidebar-shell-stage2` 第二批 | N9–N12 | 未测 | UI 代码已落地，需真机目视 |
| 6 | 2026-11-11 | Windows / dev | `editor-input-tabs` P4 加固 | Q1–Q7 | 未测 | URL / iframe 策略已有单测，视觉与交互需真机 |
| 7 | 2026-11-11 | Windows / dev | release consistency | R1–R6 | 未测 | 自动层（版本 / 产物三元组 / 工具清单 / 文案）已全绿，产物 URL 与 MCP 运行时待发布期核对 |
| 8 | 2026-11-11 | Windows / dev | command parity + CSP | S1–S8 | 未测 | 源码扫描守门已全绿；CSP 保持 `null`，收紧需按平台真机矩阵验证 |
| 9 | 2026-11-11 | Windows / dev (5.0.13) | sidebar-shell-stage2 第二批 | N9–N11 PASS; N12 进行中 | 部分 | N9–N11 目视通过；测试中发现并修复 B1 文件面板右键菜单在别处右键时不消失（双菜单）、B3 快速记录窗口 dev 下白屏（改 hash URL）；B2 左右面板 `+` 是否冗余待定 |
