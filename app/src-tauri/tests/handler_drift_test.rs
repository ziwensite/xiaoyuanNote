//! Two `generate_handler!` tables exist, and they drift.
//!
//! `src/lib.rs` registers commands for the mobile entry point
//! (`#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`). The
//! desktop binary goes through `src/main.rs` → `src/runner.rs`, which
//! re-declares the modules with `#[path = "..."] mod ...;` and maintains a
//! second table. Adding a command to only one of them produces a build that
//! compiles cleanly and then fails at runtime with "command not found" on
//! the other platform. `docs/calendar-pane-plan.md` calls this out as
//! "双注册漂移".
//!
//! A true single source of truth was evaluated and rejected for now:
//!
//!   - 44 arguments in `lib.rs` carry `#[cfg(not(target_os = "android"))]`
//!     attributes *inside* the macro invocation; a shared macro would have
//!     to move those cfgs without changing which platform sees which name.
//!   - 7 desktop commands are `#[tauri::command]` functions defined inside
//!     `runner.rs` itself, which the lib crate does not compile at all.
//!   - `holidays::*` commands need a `HolidaysState` that only `lib.rs`
//!     installs via `.manage(...)`.
//!
//! So the minimal, verifiable guard is this source-level parity test: it
//! parses both macro bodies and asserts that the only differences are the
//! explicitly reviewed platform whitelists below. A new command added to
//! just one table fails the test and forces a decision. It uses only `std`
//! and `include_str!` — no Tauri runtime, no new dependency.
//!
//! Whitelist rows are grouped by *why* they are one-sided, so a future fix
//! (e.g. registering `holidays_*` on desktop) has an obvious line to remove.

use std::collections::BTreeSet;
use std::path::PathBuf;

const LIB_SRC: &str = include_str!("../src/lib.rs");
const RUNNER_SRC: &str = include_str!("../src/runner.rs");

/// Android-only storage/SAF commands: the desktop runner does not declare
/// `storage_android` / `saf_android` at all.
const LIB_ONLY_ANDROID: &[&str] = &[
    "android_has_all_files_access",
    "android_request_all_files_access",
    "android_system_insets",
    "android_restart_app",
    "saf_pick_folder",
    "saf_poll_picked",
    "saf_persisted_trees",
    "saf_tree_root",
    "saf_tree_name",
    "saf_list",
    "saf_read",
    "saf_read_base64",
    "saf_write",
    "saf_write_base64",
    "saf_read_content_uri_base64",
    "saf_create",
    "saf_delete",
];

/// Known one-sided registration: `HolidaysState` is `.manage()`-ed only in
/// lib.rs's setup, so the desktop runner cannot register these two yet.
/// `docs/calendar-pane-plan.md` asks for dual registration here — remove
/// these two names from the whitelist once desktop catches up.
const LIB_ONLY_HOLIDAYS: &[&str] = &["holidays_cached", "holidays_refresh"];

/// Desktop-only commands. The first six are defined in `runner.rs` itself
/// (window lifecycle, native menu, Windows title-bar hit rect, language
/// preference, DevTools); the last one needs OS registry / plist access.
const RUNNER_ONLY_DESKTOP: &[&str] = &[
    "drain_pending_opens",
    "force_close_window",
    "set_menu_spec",
    "set_max_button_rect",
    "save_language_preference",
    "set_as_default_markdown_editor",
    "open_devtools_window",
];

/// Extract the command names from the first `tauri::generate_handler![...]`.
/// `#[cfg(...)]` attributes and comments are skipped; a `module::fn` entry
/// is normalized to its last segment so the two tables are comparable.
fn handler_commands(src: &str) -> Vec<String> {
    const MARKER: &str = "tauri::generate_handler![";
    let start = src
        .find(MARKER)
        .expect("a generate_handler! invocation")
        + MARKER.len();
    let tail = &src[start..];

    // Stop at the line that closes the macro. Scanning line-by-line avoids
    // being fooled by the `.build(tauri::generate_context!())` that follows
    // the lib.rs table.
    let mut body_end = tail.len();
    let mut offset = 0usize;
    for line in tail.split_inclusive('\n') {
        if line.trim() == "])" {
            body_end = offset;
            break;
        }
        offset += line.len();
    }
    assert!(body_end < tail.len(), "generate_handler! is never closed");

    let mut out = Vec::new();
    for line in tail[..body_end].lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("//") || t.starts_with("#[cfg(") {
            continue;
        }
        let code = t
            .split("//")
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches(',')
            .trim();
        if code.is_empty() {
            continue;
        }
        let name = code.rsplit("::").next().unwrap().trim();
        assert!(
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
            "unexpected handler entry: {line:?}"
        );
        out.push(name.to_string());
    }
    out
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn the_two_handler_tables_differ_only_by_the_reviewed_whitelists() {
    let lib = handler_commands(LIB_SRC);
    let runner = handler_commands(RUNNER_SRC);
    assert!(lib.len() > 100, "lib.rs table looks truncated: {}", lib.len());
    assert!(
        runner.len() > 100,
        "runner.rs table looks truncated: {}",
        runner.len()
    );

    let ls: BTreeSet<String> = lib.iter().cloned().collect();
    let rs: BTreeSet<String> = runner.iter().cloned().collect();
    assert_eq!(ls.len(), lib.len(), "duplicate command in lib.rs table");
    assert_eq!(
        rs.len(),
        runner.len(),
        "duplicate command in runner.rs table"
    );

    let lib_only: BTreeSet<String> = ls.difference(&rs).cloned().collect();
    let runner_only: BTreeSet<String> = rs.difference(&ls).cloned().collect();

    let mut expected_lib_only = set(LIB_ONLY_ANDROID);
    expected_lib_only.extend(set(LIB_ONLY_HOLIDAYS));
    assert_eq!(
        lib_only, expected_lib_only,
        "a command is registered on mobile but not on desktop (or a whitelist entry is stale)"
    );
    assert_eq!(
        runner_only,
        set(RUNNER_ONLY_DESKTOP),
        "a command is registered on desktop but not on mobile (or a whitelist entry is stale)"
    );

    // The shared surface is the bulk of both tables; a parser regression
    // that accidentally matched only a few lines would fail here.
    assert!(
        ls.intersection(&rs).count() > 150,
        "handler parser probably matched the wrong block"
    );
}

#[test]
fn there_are_exactly_two_real_handler_tables() {
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut calls = 0usize;
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&src_dir).expect("src directory") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|s| s.to_str()) != Some("rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("read source");
        let n = text.matches("tauri::generate_handler![").count();
        if n > 0 {
            calls += n;
            files.push(path.file_name().unwrap().to_string_lossy().into_owned());
        }
    }
    files.sort();
    assert_eq!(
        calls, 2,
        "a third command table appeared; this test only guards lib.rs + runner.rs ({files:?})"
    );
    assert_eq!(files, vec!["lib.rs".to_string(), "runner.rs".to_string()]);
}
