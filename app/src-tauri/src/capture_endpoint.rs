//! HTTP capture endpoint — v2.4.
//!
//! A localhost HTTP server that accepts new-note submissions from external
//! clients (browser extension, iOS shortcuts, shell scripts, curl). Same
//! shape as `dev_bridge.rs` (hand-rolled HTTP/1.1, single bearer token,
//! 127.0.0.1 only) but **production-ready** — shipped in release builds
//! and gated by a Settings → Integrations toggle instead of `cfg(debug_assertions)`.
//!
//! Wire format:
//!
//!   POST http://127.0.0.1:7777/capture
//!     Headers: Authorization: Bearer <token>
//!              Content-Type: application/json
//!     Body:    { "title"?, "content", "url"?, "tags"?, "inbox"?,
//!                "append_path"? }
//!     -> 200   { "ok": true, "path": "/abs/path/to/inbox/..." }
//!     -> 401   missing or wrong bearer token
//!     -> 503   no workspace folder open
//!
//! Off by default. The user opts in from Settings → Integrations, copies
//! the displayed bearer token into their browser extension / shell, and
//! pings the endpoint. Toggling off shuts down the listener and clears
//! the on-disk port/token files.
//!
//! v2.4 — `append_path` mode (added for the iOS Shortcuts "append to
//! today's daily note" recipe). When the JSON body has an `append_path:
//! "<workspace-relative path>"`, the content is appended to that file
//! (creating it if missing) instead of writing a fresh note. Same
//! workspace constraint, same path-traversal rejection, same auth as the
//! create path. Useful for daily notes, running logs, dictation buffers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::quick_capture::capture_write_rendered_inner;

// ---------------------------------------------------------------------------
// Public state shared between the Tauri command layer and the running server.
// ---------------------------------------------------------------------------

/// Frontend-facing snapshot of the capture endpoint's current state.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CaptureState {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub inbox_folder: String,
    /// Path pattern pushed from the selected capture preset.
    pub capture_path: String,
    /// Front matter template pushed from the same preset.
    pub capture_frontmatter: String,
    /// `markInbox` pushed from the same preset.
    pub capture_inbox: bool,
    /// Auto note timestamps setting pushed from the frontend.
    pub stamp_timestamps: bool,
}

#[derive(Debug, Clone)]
struct InnerState {
    enabled: bool,
    running: bool,
    port: u16,
    token: String,
    /// Workspace folder. Pushed in by the frontend whenever the user opens
    /// or switches a folder. None → endpoint returns 503.
    workspace: Option<PathBuf>,
    /// Sub-folder inside the workspace where new notes land. Default `inbox`.
    inbox_folder: String,
    /// Create path + front matter from the preset chosen for HTTP captures.
    capture_path: String,
    capture_frontmatter: String,
    capture_inbox: bool,
    stamp_timestamps: bool,
    /// Set when the active server should stop accepting new connections.
    shutdown_gen: u64,
}

const DEFAULT_CAPTURE_PATH: &str = "inbox/YYYY-MM-DD-HHmm.md";
const DEFAULT_CAPTURE_FRONTMATTER: &str =
    "title: {{title}}\nsource: {{source}}\ntags: [{{tags}}]\ninbox: {{inbox}}\ncaptured_at: {{capturedAt}}";

static STATE: Lazy<Mutex<InnerState>> = Lazy::new(|| {
    Mutex::new(InnerState {
        enabled: false,
        running: false,
        port: 7777,
        token: String::new(),
        workspace: None,
        inbox_folder: "inbox".to_string(),
        capture_path: DEFAULT_CAPTURE_PATH.to_string(),
        capture_frontmatter: DEFAULT_CAPTURE_FRONTMATTER.to_string(),
        capture_inbox: true,
        stamp_timestamps: true,
        shutdown_gen: 0,
    })
});

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Token generation. Same construction as dev_bridge — 32 hex chars derived
// from system time + pid + LCG mixer. Loopback-only, paired with an opt-in
// toggle, so we don't need true crypto secrecy.
// ---------------------------------------------------------------------------

fn random_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let mix = nanos.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(pid);
    let mut s = String::with_capacity(32);
    let mut x = mix;
    for _ in 0..16 {
        s.push_str(&format!("{:02x}", (x & 0xff) as u8));
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    }
    s
}

// ---------------------------------------------------------------------------
// Tauri commands.
// ---------------------------------------------------------------------------

/// Read the current state. Cheap — just clones the in-memory snapshot.
#[tauri::command]
pub fn capture_get_state() -> CaptureState {
    let s = STATE.lock().expect("capture state lock");
    CaptureState {
        enabled: s.enabled,
        running: s.running,
        port: s.port,
        token: s.token.clone(),
        inbox_folder: s.inbox_folder.clone(),
        capture_path: s.capture_path.clone(),
        capture_frontmatter: s.capture_frontmatter.clone(),
        capture_inbox: s.capture_inbox,
        stamp_timestamps: s.stamp_timestamps,
    }
}

/// Toggle the endpoint on/off. When turning on, a token is minted (if the
/// caller didn't pass one) and the listener is bound. When turning off, the
/// existing listener is asked to stop accepting new connections.
#[tauri::command]
pub async fn capture_set_enabled(
    app: AppHandle,
    enabled: bool,
    port: Option<u16>,
) -> Result<CaptureState, String> {
    {
        let mut s = STATE.lock().expect("capture state lock");
        s.enabled = enabled;
        if let Some(p) = port {
            s.port = p;
        }
        if enabled && s.token.is_empty() {
            s.token = random_token();
        }
        if !enabled {
            // Bumping the shutdown generation makes the running accept loop
            // notice on its next iteration (we poll a short timeout).
            s.shutdown_gen = s.shutdown_gen.wrapping_add(1);
            s.running = false;
        }
    }
    if enabled {
        spawn_if_needed(app);
    }
    Ok(capture_get_state())
}

/// Mint a fresh bearer token. The old one stops working immediately —
/// in-flight requests already past auth check are unaffected, but the
/// next request with the old header gets 401.
#[tauri::command]
pub fn capture_regenerate_token() -> CaptureState {
    {
        let mut s = STATE.lock().expect("capture state lock");
        s.token = random_token();
    }
    capture_get_state()
}

/// Set the inbox sub-folder (relative to workspace). Defaults to "inbox".
#[tauri::command]
pub fn capture_set_inbox_folder(folder: String) -> CaptureState {
    {
        let mut s = STATE.lock().expect("capture state lock");
        let trimmed = folder.trim().trim_matches('/').trim_matches('\\');
        s.inbox_folder = if trimmed.is_empty() {
            "inbox".to_string()
        } else {
            trimmed.to_string()
        };
    }
    capture_get_state()
}

/// Push the rendering rules of the preset chosen for HTTP captures. The
/// endpoint then writes exactly what the preset describes — YAML included.
#[tauri::command]
pub fn capture_set_preset(path: String, frontmatter: String, inbox: bool) -> CaptureState {
    {
        let mut s = STATE.lock().expect("capture state lock");
        let trimmed = path.trim().trim_matches('/').trim_matches('\\');
        s.capture_path = if trimmed.is_empty() {
            DEFAULT_CAPTURE_PATH.to_string()
        } else {
            trimmed.to_string()
        };
        s.capture_frontmatter = frontmatter;
        s.capture_inbox = inbox;
    }
    capture_get_state()
}

/// Frontend pushes the auto-note-timestamps setting here.
#[tauri::command]
pub fn capture_set_timestamps(enabled: bool) -> CaptureState {
    {
        let mut s = STATE.lock().expect("capture state lock");
        s.stamp_timestamps = enabled;
    }
    capture_get_state()
}

/// Frontend pushes the active workspace folder here whenever it changes.
/// Server reads this on every request — when None, the endpoint replies
/// 503 with a friendly error.
#[tauri::command]
pub fn capture_set_workspace(folder: Option<String>) {
    let mut s = STATE.lock().expect("capture state lock");
    s.workspace = folder
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
        .map(PathBuf::from);
}

/// Where a capture should land right now: the open workspace plus the
/// configured inbox folder. `None` when no workspace is open.
///
/// Quick capture (global hotkey) writes through the same pair as the HTTP
/// endpoint so both agree on the destination without the caller having to
/// pass it in — the frontend already keeps `capture_set_workspace` current.
pub fn current_target() -> Option<(PathBuf, String)> {
    let s = STATE.lock().expect("capture state lock");
    s.workspace.clone().map(|w| (w, s.inbox_folder.clone()))
}

// ---------------------------------------------------------------------------
// Server boot.
// ---------------------------------------------------------------------------

fn spawn_if_needed(app: AppHandle) {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        // Another accept-loop is already alive; it'll pick up the new
        // token / config on the next request.
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app).await {
            eprintln!("[capture_endpoint] fatal: {e}");
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });
}

async fn serve(app: AppHandle) -> Result<(), String> {
    let port = STATE.lock().expect("capture state lock").port;
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("bind 127.0.0.1:{port}: {e}"))?;
    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    {
        let mut s = STATE.lock().expect("capture state lock");
        s.port = bound_port;
        s.running = true;
    }

    let my_gen = STATE.lock().expect("capture state lock").shutdown_gen;
    write_port_token(&app, bound_port);

    eprintln!(
        "[capture_endpoint] listening on http://127.0.0.1:{bound_port}"
    );

    loop {
        // Bail out if the user toggled the endpoint off.
        let (enabled, gen_now) = {
            let s = STATE.lock().expect("capture state lock");
            (s.enabled, s.shutdown_gen)
        };
        if !enabled || gen_now != my_gen {
            break;
        }

        // Accept with a small timeout so we can re-check the toggle.
        let accept = tokio::time::timeout(Duration::from_millis(500), listener.accept()).await;
        let stream = match accept {
            Ok(Ok((s, _))) => s,
            Ok(Err(e)) => {
                eprintln!("[capture_endpoint] accept: {e}");
                continue;
            }
            Err(_) => continue, // timeout — loop back, re-check toggle
        };
        let app2 = app.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, app2).await {
                eprintln!("[capture_endpoint] conn: {e}");
            }
        });
    }

    {
        let mut s = STATE.lock().expect("capture state lock");
        s.running = false;
    }
    cleanup_port_token(&app);
    eprintln!("[capture_endpoint] stopped");
    Ok(())
}

/// Mirror dev_bridge: drop a `capture-endpoint.{port,token}` pair next to
/// the dev-bridge files so external clients (e.g. a Mac shortcut) can
/// auto-discover the port and token without the user manually editing
/// their script. Best-effort — we don't fail the boot if the write fails.
fn write_port_token(app: &AppHandle, port: u16) {
    let token = STATE.lock().expect("capture state lock").token.clone();
    let dir = match super::portable::app_config_dir(app.path()) {
        Ok(d) => d,
        Err(_) => return,
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(dir.join("capture-endpoint.port"), port.to_string());
    let token_path = dir.join("capture-endpoint.token");
    let _ = std::fs::write(&token_path, &token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(
            &token_path,
            std::fs::Permissions::from_mode(0o600),
        );
    }
}

fn cleanup_port_token(app: &AppHandle) {
    if let Ok(dir) = super::portable::app_config_dir(app.path()) {
        let _ = std::fs::remove_file(dir.join("capture-endpoint.port"));
        let _ = std::fs::remove_file(dir.join("capture-endpoint.token"));
    }
}

// ---------------------------------------------------------------------------
// Connection handling. Hand-rolled HTTP/1.1 — same minimal parser as
// dev_bridge::handle_conn. Single route, no chunked encoding, no keep-alive.
// ---------------------------------------------------------------------------

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

async fn handle_conn(mut stream: TcpStream, _app: AppHandle) -> Result<(), String> {
    let req = match read_request(&mut stream).await {
        Ok(r) => r,
        Err(e) => {
            let _ = write_resp(
                &mut stream,
                400,
                "Bad Request",
                &serde_json::json!({"ok": false, "error": e}).to_string(),
            )
            .await;
            return Ok(());
        }
    };

    if req.method == "OPTIONS" {
        let _ = write_resp(&mut stream, 204, "No Content", "").await;
        return Ok(());
    }

    if req.method == "GET" && req.path == "/" {
        let _ = write_resp(
            &mut stream,
            200,
            "OK",
            "{\"ok\":true,\"server\":\"xiaoyuan-note-capture\"}",
        )
        .await;
        return Ok(());
    }

    // Health check — used by the browser-extension "Test connection" button
    // to verify URL + token without writing a note. Token-gated so we never
    // reveal anything (workspace path included) to a probe lacking the
    // bearer header. Returns the workspace path so the user can sanity-check
    // they paired the extension with the *right* xiaoyuanNote instance.
    if req.method == "GET" && req.path == "/capture/health" {
        let (token, workspace, inbox_folder) = {
            let s = STATE.lock().expect("capture state lock");
            (s.token.clone(), s.workspace.clone(), s.inbox_folder.clone())
        };
        if !auth_ok(&req, &token) {
            let _ = write_resp(
                &mut stream,
                401,
                "Unauthorized",
                "{\"ok\":false,\"error\":\"missing or wrong Authorization: Bearer <token>\"}",
            )
            .await;
            return Ok(());
        }
        let workspace_str = workspace
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let body = serde_json::json!({
            "ok": true,
            "version": env!("CARGO_PKG_VERSION"),
            "workspace": workspace_str,
            "inbox_folder": inbox_folder,
            "workspace_open": workspace.is_some(),
        })
        .to_string();
        let _ = write_resp(&mut stream, 200, "OK", &body).await;
        return Ok(());
    }

    if req.method == "POST" && req.path == "/capture" {
        // Auth check.
        let token = STATE.lock().expect("capture state lock").token.clone();
        if !auth_ok(&req, &token) {
            let _ = write_resp(
                &mut stream,
                401,
                "Unauthorized",
                "{\"ok\":false,\"error\":\"missing or wrong Authorization: Bearer <token>\"}",
            )
            .await;
            return Ok(());
        }

        match handle_capture(&req.body) {
            Ok(path) => {
                let body =
                    serde_json::json!({"ok": true, "path": path}).to_string();
                let _ = write_resp(&mut stream, 200, "OK", &body).await;
            }
            Err(CaptureError::NoWorkspace) => {
                let _ = write_resp(
                    &mut stream,
                    503,
                    "Service Unavailable",
                    "{\"ok\":false,\"error\":\"no workspace folder open in xiaoyuanNote; open a folder first\"}",
                )
                .await;
            }
            Err(CaptureError::BadRequest(msg)) => {
                let body =
                    serde_json::json!({"ok": false, "error": msg}).to_string();
                let _ = write_resp(&mut stream, 400, "Bad Request", &body).await;
            }
            Err(CaptureError::Io(msg)) => {
                let body =
                    serde_json::json!({"ok": false, "error": msg}).to_string();
                let _ = write_resp(&mut stream, 500, "Internal Server Error", &body).await;
            }
        }
        return Ok(());
    }

    let _ = write_resp(
        &mut stream,
        404,
        "Not Found",
        "{\"ok\":false,\"error\":\"unknown route\"}",
    )
    .await;
    Ok(())
}

fn auth_ok(req: &Request, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let Some(h) = req.headers.get("authorization") else {
        return false;
    };
    let want = format!("Bearer {expected}");
    h == &want || h.eq_ignore_ascii_case(&want)
}

// ---------------------------------------------------------------------------
// Capture core — takes a JSON body and returns the created file path.
// New notes are rendered from the pushed preset and written through the
// shared `capture_write_rendered_inner` writer.
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum CaptureError {
    NoWorkspace,
    BadRequest(String),
    Io(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::NoWorkspace => write!(f, "no workspace folder open"),
            CaptureError::BadRequest(s) => write!(f, "{s}"),
            CaptureError::Io(s) => write!(f, "{s}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct CaptureBody {
    title: Option<String>,
    content: Option<String>,
    url: Option<String>,
    tags: Option<Vec<String>>,
    /// v2.4 append mode (iOS Shortcuts "append to today's daily note").
    /// When set to a workspace-relative path, the body is appended to
    /// that file with a leading newline. Path-traversal is rejected
    /// the same way the workspace_index resolver rejects it.
    append_path: Option<String>,
}

/// Expand the date tokens a preset may use in its capture path.
fn format_capture_path_pattern(pattern: &str) -> String {
    let (y, mo, d, h, mi, _) = local_now_parts();
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::with_capacity(pattern.len());
    let mut i = 0;
    while i < chars.len() {
        if i + 4 <= chars.len() && chars[i..i + 4] == ['Y', 'Y', 'Y', 'Y'] {
            out.push_str(&format!("{y:04}"));
            i += 4;
        } else if i + 2 <= chars.len()
            && matches!([chars[i], chars[i + 1]], ['M', 'M'] | ['D', 'D'] | ['H', 'H'] | ['m', 'm'])
        {
            let token = [chars[i], chars[i + 1]];
            match token {
                ['M', 'M'] => out.push_str(&format!("{mo:02}")),
                ['D', 'D'] => out.push_str(&format!("{d:02}")),
                ['H', 'H'] => out.push_str(&format!("{h:02}")),
                _ => out.push_str(&format!("{mi:02}")),
            }
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn expand_frontmatter_template(template: &str, values: &[(&str, String)]) -> String {
    template
        .lines()
        .filter_map(|line| {
            let mut empty = false;
            let mut rendered = line.to_string();
            for (key, value) in values {
                let token = format!("{{{{{key}}}}}");
                if value.is_empty() && rendered.contains(&token) {
                    empty = true;
                }
                rendered = rendered.replace(&token, value);
            }
            if empty { None } else { Some(rendered) }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn yaml_top_level_key(line: &str) -> Option<&str> {
    if line.starts_with(char::is_whitespace) || line.trim_start() != line {
        return None;
    }
    let (key, _) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

fn upsert_yaml_field(head: &str, key: &str, value: &str, overwrite: bool) -> String {
    let mut lines: Vec<String> = head.lines().map(str::to_string).collect();
    let replacement = format!("{key}: \"{value}\"");
    if let Some(line) = lines.iter_mut().find(|line| yaml_top_level_key(line) == Some(key)) {
        if overwrite {
            *line = replacement;
        }
    } else {
        lines.push(replacement);
    }
    lines.join("\n")
}

fn stamp_yaml_head(head: &str, now: &str) -> String {
    let date = now.get(..10).unwrap_or(now);
    let head = upsert_yaml_field(head, "created_date", date, false);
    let head = upsert_yaml_field(&head, "created_time", now, false);
    let head = upsert_yaml_field(&head, "modified_date", date, true);
    upsert_yaml_field(&head, "modified_time", now, true)
}

fn stamp_note_timestamps_text(text: &str, now: &str) -> String {
    let trimmed = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let rest = if let Some(after_first) = trimmed.strip_prefix("---\n") {
        if let Some(end) = after_first.find("\n---") {
            let head = &after_first[..end];
            let body = after_first[end + 5..].strip_prefix('\n').unwrap_or(&after_first[end + 5..]);
            (stamp_yaml_head(head, now), body.to_string())
        } else {
            (stamp_yaml_head("", now), after_first.to_string())
        }
    } else {
        (stamp_yaml_head("", now), trimmed)
    };
    let (head, body) = rest;
    if body.is_empty() {
        format!("---\n{head}\n---\n")
    } else {
        format!("---\n{head}\n---\n\n{body}")
    }
}

/// Render the note exactly as the pushed preset describes it.
fn render_http_note(
    frontmatter: &str,
    title: &str,
    content: &str,
    url: Option<&str>,
    tags: Option<&[String]>,
    inbox: bool,
    stamp_timestamps: bool,
) -> String {
    let (y, mo, d, h, mi, _) = local_now_parts();
    let tags = tags
        .map(|all| {
            all.iter()
                .map(|tag| tag.trim())
                .filter(|tag| !tag.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let first_line = content
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .trim_start_matches('#')
        .trim()
        .to_string();
    let values: Vec<(&str, String)> = vec![
        ("title", title.to_string()),
        ("value", first_line.clone()),
        ("input", first_line),
        ("source", url.unwrap_or("").trim().to_string()),
        ("tags", tags),
        ("inbox", inbox.to_string()),
        ("capturedAt", local_iso8601_now()),
        ("date", format!("{y:04}-{mo:02}-{d:02}")),
        ("time", format!("{h:02}:{mi:02}")),
    ];
    let head = expand_frontmatter_template(frontmatter, &values);
    let body = strip_front_matter(content);
    let note = if head.is_empty() {
        body.to_string()
    } else {
        format!("---\n{head}\n---\n\n{body}")
    };
    if !stamp_timestamps {
        return note;
    }
    let now = local_iso8601_now();
    stamp_note_timestamps_text(&note, &now)
}

fn handle_capture(body: &[u8]) -> Result<String, CaptureError> {
    let parsed: CaptureBody = serde_json::from_slice(body)
        .map_err(|e| CaptureError::BadRequest(format!("parse body: {e}")))?;
    let content = parsed
        .content
        .as_deref()
        .ok_or_else(|| CaptureError::BadRequest("missing field: content".into()))?
        .to_string();

    let (workspace, path_pattern, frontmatter, inbox, stamp_timestamps) = {
        let s = STATE.lock().expect("capture state lock");
        (
            s.workspace.clone(),
            s.capture_path.clone(),
            s.capture_frontmatter.clone(),
            s.capture_inbox,
            s.stamp_timestamps,
        )
    };
    let workspace = workspace.ok_or(CaptureError::NoWorkspace)?;

    // Append branch: bypass the create-note flow, just open-for-append.
    if let Some(rel) = parsed.append_path.as_deref() {
        let trimmed = rel.trim();
        if trimmed.is_empty() {
            return Err(CaptureError::BadRequest(
                "append_path is empty; pass a workspace-relative path or omit the field".into(),
            ));
        }
        return capture_append_inner(&workspace, trimmed, &content, stamp_timestamps);
    }

    let relative = format_capture_path_pattern(&path_pattern);
    let title = parsed
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| extract_first_h1(&content))
        .unwrap_or_else(|| "Untitled".to_string());
    let note = render_http_note(
        &frontmatter,
        &title,
        &content,
        parsed.url.as_deref(),
        parsed.tags.as_deref(),
        inbox,
        stamp_timestamps,
    );
    capture_write_rendered_inner(&workspace, &relative, &note, true)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(CaptureError::Io)
}

/// Pure append — open-or-create the workspace-relative file at `rel_path`,
/// then append the body with a single leading newline so successive appends
/// stack on separate lines. Same path-traversal protection as the create
/// branch: rejects absolute paths, `..` segments, drive-letter prefixes,
/// and anything that resolves outside the workspace canonical root.
pub fn capture_append_inner(
    workspace: &Path,
    rel_path: &str,
    content: &str,
    stamp_timestamps: bool,
) -> Result<String, CaptureError> {
    if !workspace.is_dir() {
        return Err(CaptureError::Io(format!(
            "workspace folder does not exist: {}",
            workspace.display()
        )));
    }

    let target = resolve_safe_workspace_path(workspace, rel_path)
        .map_err(CaptureError::BadRequest)?;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CaptureError::Io(format!("mkdir {}: {e}", parent.display())))?;
    }

    let existing = std::fs::read_to_string(&target).unwrap_or_default();
    let base = if stamp_timestamps {
        stamp_note_timestamps_text(&existing, &local_iso8601_now())
    } else {
        existing
    };
    let mut output = base;
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
    output.push('\n');
    output.push_str(content);
    if !content.ends_with('\n') {
        output.push('\n');
    }
    std::fs::write(&target, output)
        .map_err(|e| CaptureError::Io(format!("write {}: {e}", target.display())))?;

    Ok(target.to_string_lossy().to_string())
}

/// Resolve a workspace-relative `rel_path` to an absolute path, refusing
/// any input that would escape the workspace. Three layers of defense:
///
///   1. Reject `..` segments outright (no need to canonicalize first).
///   2. Reject absolute paths and Windows drive prefixes.
///   3. After joining + canonicalizing both the workspace and the target,
///      assert the target starts with the workspace canonical prefix.
///
/// Returns `Err(String)` with a 400-suitable message on any rejection.
fn resolve_safe_workspace_path(workspace: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.is_empty() {
        return Err("append_path is empty".into());
    }
    // Layer 1: any `..` segment, anywhere, is rejected.
    for seg in rel_path.split(|c| c == '/' || c == '\\') {
        if seg == ".." {
            return Err("append_path contains a `..` segment (path-traversal denied)".into());
        }
    }
    // Layer 2: absolute / drive-prefix paths rejected.
    if rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err("append_path must be workspace-relative, not absolute".into());
    }
    let bytes = rel_path.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Err("append_path must be workspace-relative, not a drive path".into());
    }

    let candidate = workspace.join(rel_path);
    // Layer 3: when the file already exists we can canonicalize it; when
    // it doesn't, canonicalize the parent and assert containment from
    // there. Symlinks pointing outside the workspace are rejected by the
    // canonical-prefix check.
    let workspace_canon = std::fs::canonicalize(workspace)
        .map_err(|e| format!("canonicalize workspace: {e}"))?;
    let resolved = if candidate.exists() {
        std::fs::canonicalize(&candidate)
            .map_err(|e| format!("canonicalize append_path: {e}"))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| "append_path has no parent component".to_string())?;
        // Walk up to the deepest existing ancestor — canonicalize that —
        // then re-attach the remainder. Avoids "no such file" errors on
        // brand-new files in brand-new folders.
        let mut existing: PathBuf = parent.to_path_buf();
        let mut suffix: Vec<std::ffi::OsString> = Vec::new();
        loop {
            if existing.exists() {
                break;
            }
            let name_opt = existing.file_name().map(|s| s.to_os_string());
            let parent_opt = existing.parent().map(|p| p.to_path_buf());
            if let Some(name) = name_opt {
                suffix.push(name);
            }
            match parent_opt {
                Some(p) if p != existing => existing = p,
                _ => return Err("append_path resolves outside workspace".into()),
            }
        }
        let canon_existing = std::fs::canonicalize(&existing)
            .map_err(|e| format!("canonicalize parent: {e}"))?;
        let mut out = canon_existing;
        for seg in suffix.iter().rev() {
            out.push(seg);
        }
        if let Some(name) = candidate.file_name() {
            out.push(name);
        }
        out
    };

    if !resolved.starts_with(&workspace_canon) {
        return Err("append_path resolves outside workspace (denied)".into());
    }
    Ok(resolved)
}

fn strip_front_matter(input: &str) -> &str {
    let trimmed = input.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return input;
    }
    let after_first = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return input,
    };
    if let Some(end) = after_first.find("\n---") {
        let rest_offset = end + "\n---".len();
        let rest = &after_first[rest_offset..];
        return rest.strip_prefix('\n').unwrap_or(rest);
    }
    input
}

fn extract_first_h1(content: &str) -> Option<String> {
    for line in content.lines().take(40) {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("# ") {
            let h = rest.trim().to_string();
            if !h.is_empty() {
                return Some(h);
            }
        }
    }
    None
}

/// `YYYY-MM-DDTHH:MM:SS+HH:MM` local time, ISO 8601 with offset.
pub fn local_iso8601_now() -> String {
    let (y, mo, d, h, mi, s) = local_now_parts();
    let off_secs = local_offset_seconds();
    let sign = if off_secs >= 0 { '+' } else { '-' };
    let off_abs = off_secs.unsigned_abs();
    let oh = off_abs / 3600;
    let om = (off_abs % 3600) / 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        y, mo, d, h, mi, s, sign, oh, om
    )
}

/// (year, month, day, hour, minute, second) — local time.
fn local_now_parts() -> (i64, u32, u32, u32, u32, u32) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let local_secs = secs + local_offset_seconds();
    civil_from_unix(local_secs)
}

fn civil_from_unix(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    // Howard Hinnant's civil-from-days. Same algo as git_history.rs.
    let days = secs.div_euclid(86_400);
    let mut sod = secs.rem_euclid(86_400);
    let h = (sod / 3600) as u32;
    sod %= 3600;
    let m = (sod / 60) as u32;
    let s = (sod % 60) as u32;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo_raw = if mp < 10 { mp + 3 } else { mp - 9 };
    let mo = mo_raw as u32;
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, m, s)
}

/// Local UTC offset, in seconds. Best-effort: we ask `localtime_r` via libc.
/// If we can't determine it (e.g. mis-configured zoneinfo), fall back to UTC.
fn local_offset_seconds() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    #[cfg(unix)]
    unsafe {
        // Need libc::localtime_r — but tauri brings it in transitively. Use
        // raw FFI to avoid a new top-level dep.
        extern "C" {
            fn localtime_r(time: *const i64, result: *mut Tm) -> *mut Tm;
        }
        #[repr(C)]
        struct Tm {
            tm_sec: i32,
            tm_min: i32,
            tm_hour: i32,
            tm_mday: i32,
            tm_mon: i32,
            tm_year: i32,
            tm_wday: i32,
            tm_yday: i32,
            tm_isdst: i32,
            tm_gmtoff: i64,
            tm_zone: *const i8,
        }
        let t: i64 = secs;
        let mut out: Tm = std::mem::zeroed();
        let r = localtime_r(&t as *const i64, &mut out as *mut Tm);
        if r.is_null() {
            return 0;
        }
        out.tm_gmtoff
    }
    #[cfg(not(unix))]
    {
        let _ = secs;
        // Windows: GetTimeZoneInformation. Skipped for now — the v2.4 capture
        // endpoint is functional with a UTC `captured_at` on Windows; users
        // rarely care that the timestamp is in Z vs. local offset.
        0
    }
}

// ---------------------------------------------------------------------------
// Hand-rolled minimal HTTP/1.1 reader/writer. Same structure as dev_bridge.
// ---------------------------------------------------------------------------

async fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 1024];
    let header_end;
    loop {
        if buf.len() > 64 * 1024 {
            return Err("headers too large".into());
        }
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            return Err("unexpected eof".into());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_double_crlf(&buf) {
            header_end = pos + 4;
            break;
        }
    }
    let (head_bytes, rest) = buf.split_at(header_end);
    let head = std::str::from_utf8(head_bytes)
        .map_err(|_| "non-utf8 headers".to_string())?
        .to_string();
    let mut rest = rest.to_vec();

    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or("empty request")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or("no method")?.to_string();
    let path = parts.next().ok_or("no path")?.to_string();

    let mut headers: HashMap<String, String> = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    // Body length cap — 8 MiB is plenty for a single note. Anything bigger
    // is almost certainly a misconfigured client trying to push a video.
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if content_length > 8 * 1024 * 1024 {
        return Err("body too large (max 8 MiB)".into());
    }

    while rest.len() < content_length {
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| format!("read body: {e}"))?;
        if n == 0 {
            break;
        }
        rest.extend_from_slice(&tmp[..n]);
    }
    rest.truncate(content_length);

    Ok(Request {
        method,
        path,
        headers,
        body: rest,
    })
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    let needle = b"\r\n\r\n";
    if buf.len() < 4 {
        return None;
    }
    for i in 0..=buf.len() - 4 {
        if &buf[i..i + 4] == needle {
            return Some(i);
        }
    }
    None
}

async fn write_resp(
    stream: &mut TcpStream,
    code: u16,
    reason: &str,
    body: &str,
) -> Result<(), String> {
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
         \r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| format!("write head: {e}"))?;
    stream
        .write_all(body.as_bytes())
        .await
        .map_err(|e| format!("write body: {e}"))?;
    let _ = stream.shutdown().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers exposed for the e2e test.
// ---------------------------------------------------------------------------

/// Set the in-memory state directly. Used by the e2e test to avoid running
/// the Tauri command layer.
#[doc(hidden)]
pub fn _test_set_state(workspace: Option<PathBuf>, token: String, inbox_folder: String) {
    let mut s = STATE.lock().expect("capture state lock");
    s.workspace = workspace;
    s.token = token;
    s.inbox_folder = inbox_folder;
    s.capture_path = DEFAULT_CAPTURE_PATH.to_string();
    s.capture_frontmatter = DEFAULT_CAPTURE_FRONTMATTER.to_string();
    s.capture_inbox = true;
    s.stamp_timestamps = true;
    s.enabled = true;
}

#[doc(hidden)]
pub fn _test_current_token() -> String {
    STATE.lock().expect("capture state lock").token.clone()
}

#[doc(hidden)]
pub fn _test_handle_capture(body: &[u8]) -> Result<String, CaptureError> {
    handle_capture(body)
}

#[doc(hidden)]
pub fn _test_resolve_safe_workspace_path(
    workspace: &Path,
    rel_path: &str,
) -> Result<PathBuf, String> {
    resolve_safe_workspace_path(workspace, rel_path)
}

/// Spin a standalone server for live curl testing — no Tauri AppHandle
/// required. Used by `examples/capture_drive.rs`. Binds, accepts, and
/// returns the bound port. Caller is responsible for keeping the tokio
/// runtime alive.
#[doc(hidden)]
pub async fn _test_bind_and_serve() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind: {e}"))?;
    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    {
        let mut s = STATE.lock().expect("capture state lock");
        s.port = bound_port;
        s.running = true;
    }
    tokio::spawn(async move {
        loop {
            let stream = match listener.accept().await {
                Ok((s, _)) => s,
                Err(_) => continue,
            };
            tokio::spawn(async move {
                // Read + dispatch without needing an AppHandle. We don't
                // call write_port_token here (no app paths), and we won't
                // touch the live STATE.workspace either — caller seeds it.
                let (mut s, _) = (stream, ());
                let req = match read_request(&mut s).await {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = write_resp(
                            &mut s,
                            400,
                            "Bad Request",
                            &serde_json::json!({"ok": false, "error": e}).to_string(),
                        )
                        .await;
                        return;
                    }
                };
                if req.method == "OPTIONS" {
                    let _ = write_resp(&mut s, 204, "No Content", "").await;
                    return;
                }
                if req.method == "GET" && req.path == "/" {
                    let _ = write_resp(&mut s, 200, "OK", "{\"ok\":true}").await;
                    return;
                }
                if req.method == "GET" && req.path == "/capture/health" {
                    let (token, workspace, inbox_folder) = {
                        let st = STATE.lock().expect("capture state lock");
                        (st.token.clone(), st.workspace.clone(), st.inbox_folder.clone())
                    };
                    if !auth_ok(&req, &token) {
                        let _ = write_resp(
                            &mut s,
                            401,
                            "Unauthorized",
                            "{\"ok\":false,\"error\":\"missing or wrong token\"}",
                        )
                        .await;
                        return;
                    }
                    let workspace_str = workspace
                        .as_ref()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let body = serde_json::json!({
                        "ok": true,
                        "version": env!("CARGO_PKG_VERSION"),
                        "workspace": workspace_str,
                        "inbox_folder": inbox_folder,
                        "workspace_open": workspace.is_some(),
                    })
                    .to_string();
                    let _ = write_resp(&mut s, 200, "OK", &body).await;
                    return;
                }
                if req.method == "POST" && req.path == "/capture" {
                    let token = STATE.lock().expect("capture state lock").token.clone();
                    if !auth_ok(&req, &token) {
                        let _ = write_resp(
                            &mut s,
                            401,
                            "Unauthorized",
                            "{\"ok\":false,\"error\":\"missing or wrong token\"}",
                        )
                        .await;
                        return;
                    }
                    match handle_capture(&req.body) {
                        Ok(p) => {
                            let body = serde_json::json!({"ok": true, "path": p}).to_string();
                            let _ = write_resp(&mut s, 200, "OK", &body).await;
                        }
                        Err(CaptureError::NoWorkspace) => {
                            let _ = write_resp(
                                &mut s,
                                503,
                                "Service Unavailable",
                                "{\"ok\":false,\"error\":\"no workspace open\"}",
                            )
                            .await;
                        }
                        Err(CaptureError::BadRequest(msg)) => {
                            let body = serde_json::json!({"ok": false, "error": msg}).to_string();
                            let _ = write_resp(&mut s, 400, "Bad Request", &body).await;
                        }
                        Err(CaptureError::Io(msg)) => {
                            let body = serde_json::json!({"ok": false, "error": msg}).to_string();
                            let _ = write_resp(&mut s, 500, "Internal Server Error", &body).await;
                        }
                    }
                    return;
                }
                let _ = write_resp(
                    &mut s,
                    404,
                    "Not Found",
                    "{\"ok\":false,\"error\":\"unknown route\"}",
                )
                .await;
            });
        }
    });
    Ok(bound_port)
}

#[doc(hidden)]
pub fn _test_check_auth(header: Option<&str>) -> bool {
    let token = STATE.lock().expect("capture state lock").token.clone();
    let req = Request {
        method: "POST".into(),
        path: "/capture".into(),
        headers: {
            let mut h = HashMap::new();
            if let Some(v) = header {
                h.insert("authorization".to_string(), v.to_string());
            }
            h
        },
        body: vec![],
    };
    auth_ok(&req, &token)
}

// ---------------------------------------------------------------------------
// Tests — internal helpers only. The full HTTP flow is exercised by
// `tests/capture_e2e_test.rs`.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_32_hex() {
        let t = random_token();
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn first_h1_extraction() {
        assert_eq!(
            extract_first_h1("preamble\n\n# The Title\n\nbody"),
            Some("The Title".to_string()),
        );
        assert_eq!(extract_first_h1("no headings here"), None);
    }

    #[test]
    fn front_matter_is_stripped_when_present() {
        let stripped = strip_front_matter("---\nfoo: 1\n---\nbody\n");
        assert_eq!(stripped, "body\n");
        let untouched = strip_front_matter("no front matter here");
        assert_eq!(untouched, "no front matter here");
    }

}
