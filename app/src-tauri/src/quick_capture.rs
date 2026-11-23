//! Quick capture — a global hotkey that takes a thought without switching apps.
//!
//! The idea arrives while you are in a browser, a terminal, a chat window.
//! Bringing xiaoyuanNote forward, waiting for it to paint, finding the right folder
//! and making a note is enough friction that the thought is usually gone. This
//! is the shortest path that still ends in a real file: press the chord
//! anywhere, a small always-on-top box appears, type, press Enter, the box
//! disappears and the note is in the Inbox.
//!
//! Registration lives here rather than in the webview on purpose. A global
//! shortcut handled in JavaScript is only as reliable as the main window's
//! event loop, and macOS throttles an occluded WKWebView — precisely the state
//! the window is in whenever this feature is worth having.
//!
//! The note is written through `capture_write_rendered` using the selected
//! preset's path and rendering rules — the same generic writer the HTTP
//! endpoint uses, so a hotkey capture and a browser-extension capture follow
//! the same preset policy.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};
// Every window this module touches lives behind `cfg(desktop)`, so on mobile
// the window traits are not just unused — they have nothing to name.
#[cfg(desktop)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// `super::` rather than `crate::`: this file is compiled twice — once as a
// top-level module of the lib, once inside `mod runner` in the binary (see the
// `#[path = ...]` declarations there). Only the relative path resolves in both.
use super::capture_endpoint;

/// Fixed label so a second press focuses the existing box instead of stacking
/// windows. Matches the `xiaoyuan-note-*` capability pattern.
pub const CAPTURE_LABEL: &str = "xiaoyuan-note-quick-capture";

/// Quick capture is a desktop idea: a global chord and a floating box over
/// whatever else you are doing. Neither exists on a phone.
#[cfg(not(desktop))]
const MOBILE_UNSUPPORTED: &str = "quick capture is desktop-only";

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/// Show the capture box, creating it on first use.
///
/// Deliberately small, undecorated and always-on-top: it is a prompt, not a
/// window you manage. Esc dismisses it (handled in the webview).
#[tauri::command]
pub fn quick_capture_open(app: AppHandle) -> Result<(), String> {
    #[cfg(not(desktop))]
    {
        // `show`/`set_focus` and the window builder's `title` are desktop-only
        // in Tauri 2 — and a second always-on-top window is not a thing a
        // phone has anyway. The setting is hidden on mobile; this is the
        // backstop, and it says so rather than silently reporting success.
        let _ = app;
        return Err(MOBILE_UNSUPPORTED.into());
    }
    #[cfg(desktop)]
    {
        if let Some(win) = app.get_webview_window(CAPTURE_LABEL) {
            win.show().map_err(|e| e.to_string())?;
            win.set_focus().map_err(|e| e.to_string())?;
            // The box remembers nothing between uses; tell the webview to clear.
            let _ = win.emit("xiaoyuan-note://quick-capture-reset", ());
            return Ok(());
        }

        let win = WebviewWindowBuilder::new(
            &app,
            CAPTURE_LABEL,
            WebviewUrl::App("index.html#quickCapture=1".into()),
        )
        .title("xiaoyuanNote — Quick Capture")
        .inner_size(560.0, 180.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .center()
        .skip_taskbar(true)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

        let _ = win.set_focus();
        Ok(())
    }
}

/// Hide (never destroy) the box — recreating a webview on every capture is
/// slow enough to be felt, and the whole point is that it is instant.
#[tauri::command]
pub fn quick_capture_close(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(win) = app.get_webview_window(CAPTURE_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    Ok(())
}

// ---------------------------------------------------------------------------
// Generic preset writer
// ---------------------------------------------------------------------------

/// Resolve a workspace-relative path without ever escaping the workspace.
fn safe_workspace_path(workspace: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut out = workspace.to_path_buf();
    for part in relative.trim().replace('\\', "/").split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err("capture path may not escape the workspace".into()),
            name => out.push(name),
        }
    }
    Ok(out)
}

fn dedupe_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for i in 2..u32::MAX {
        let candidate = parent.join(format!("{stem}-{i}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

/// Pure part of {@link capture_write_rendered}: no Tauri state or events.
pub fn capture_write_rendered_inner(
    workspace: &Path,
    relative: &str,
    content: &str,
    dedupe: bool,
) -> Result<PathBuf, String> {
    if !workspace.is_dir() {
        return Err("workspace folder does not exist".into());
    }
    let mut target = safe_workspace_path(workspace, relative)?;
    if dedupe {
        target = dedupe_path(target);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, content).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Write a fully rendered note (front matter included) to a preset-chosen path.
/// Policy lives in the preset; this command is only the I/O primitive.
#[tauri::command]
pub fn capture_write_rendered(
    app: AppHandle,
    path: String,
    content: String,
    dedupe: Option<bool>,
    emit: Option<bool>,
) -> Result<String, String> {
    let workspace = capture_endpoint::current_target()
        .map(|(workspace, _)| workspace)
        .ok_or_else(|| "no workspace folder is open".to_string())?;
    let target = capture_write_rendered_inner(&workspace, &path, &content, dedupe.unwrap_or(true))?;
    let rendered = target.to_string_lossy().to_string();
    if emit.unwrap_or(true) {
        let _ = app.emit("xiaoyuan-note://capture-written", rendered.clone());
    }
    Ok(rendered)
}

// ---------------------------------------------------------------------------
// Global shortcut (desktop only — mobile has no such concept)
// ---------------------------------------------------------------------------

#[cfg(desktop)]
static CURRENT_SHORTCUT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Register `accelerator` as the quick-capture hotkey, replacing whatever was
/// registered before. `None` unregisters and leaves nothing behind.
///
/// A failure here is almost always "another application already owns this
/// chord", which is a message for the user rather than a crash: the error
/// string goes back to Settings so they can pick a different one.
///
/// Defined at module level (not inside a `#[cfg]` submodule) because
/// `generate_handler!` needs the macro-generated `__cmd__` sibling to be
/// visible here — a `pub use` of a command from an inner module does not
/// re-export it.
#[tauri::command]
pub fn quick_capture_set_shortcut(
    app: AppHandle,
    accelerator: Option<String>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

        let mut current = CURRENT_SHORTCUT.lock().map_err(|e| e.to_string())?;
        if let Some(old) = current.take() {
            if let Ok(sc) = old.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(sc);
            }
        }
        let Some(accel) = accelerator
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
        else {
            return Ok(());
        };
        let shortcut: Shortcut = accel
            .parse()
            .map_err(|e| format!("not a valid shortcut ({accel}): {e}"))?;
        let handle = app.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _sc, event| {
                // Fire on press, not release — releasing after the window has
                // taken focus would open it a second time.
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                // Pressing the chord while the box is already up means "put it
                // away", same as Esc. Without this the hotkey feels stuck when
                // it lands on an already-open box.
                if let Some(win) = handle.get_webview_window(CAPTURE_LABEL) {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                        return;
                    }
                }
                if let Err(e) = quick_capture_open(handle.clone()) {
                    eprintln!("[quick_capture] open failed: {e}");
                }
            })
            .map_err(|e| format!("could not register {accel}: {e}"))?;
        *current = Some(accel);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, accelerator);
        Err("global shortcuts are desktop-only".into())
    }
}
