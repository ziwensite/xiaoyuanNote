//! Path safety helpers.
//!
//! Every tool that takes a `path` from MCP input goes through `resolve_in`
//! before touching the filesystem. The function:
//!
//! 1. Joins the input onto the workspace root if relative.
//! 2. Canonicalises it (so `..`, symlinks, etc. are normalised).
//! 3. Verifies the resulting absolute path is still inside the workspace.
//!
//! For *write* operations the target file may not yet exist; in that case we
//! canonicalise the parent directory instead and re-attach the file name.

use std::path::{Component, Path, PathBuf};

/// Resolve `input` against `workspace`, ensuring the result stays inside the
/// workspace. Both `workspace` and the resulting path are returned canonical.
///
/// `must_exist=true` errors if the resolved file does not exist.
pub fn resolve_in(workspace: &Path, input: &str, must_exist: bool) -> Result<PathBuf, String> {
    if input.is_empty() {
        return Err("path must not be empty".into());
    }
    let workspace_canon = workspace
        .canonicalize()
        .map_err(|e| format!("workspace not accessible: {e}"))?;

    // Reject obvious attempts to escape early.
    let raw = PathBuf::from(input);
    for c in raw.components() {
        if matches!(c, Component::ParentDir) {
            return Err("path traversal (..) is not allowed".into());
        }
    }

    let candidate = if raw.is_absolute() {
        raw
    } else {
        workspace_canon.join(&raw)
    };

    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| format!("cannot resolve path {}: {e}", candidate.display()))?
    } else if must_exist {
        return Err(format!("file not found: {}", candidate.display()));
    } else {
        // Resolve parent for write-not-yet-existing paths.
        let parent = candidate
            .parent()
            .ok_or_else(|| "path has no parent".to_string())?;
        if !parent.exists() {
            return Err(format!("parent directory does not exist: {}", parent.display()));
        }
        let parent_canon = parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve parent {}: {e}", parent.display()))?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| "path has no file name".to_string())?;
        parent_canon.join(file_name)
    };

    if !resolved.starts_with(&workspace_canon) {
        return Err(format!(
            "path {} escapes workspace {}",
            resolved.display(),
            workspace_canon.display()
        ));
    }
    Ok(resolved)
}

/// Same idea but for a folder filter — used by `list_notes`.
pub fn resolve_subfolder(workspace: &Path, input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim_matches('/').trim();
    if trimmed.is_empty() || trimmed == "." {
        return workspace
            .canonicalize()
            .map_err(|e| format!("workspace not accessible: {e}"));
    }
    resolve_in(workspace, trimmed, true)
}

/// Resolve a path that is about to be *created*, where any number of its
/// parent folders may not exist yet. Returns the resolved path and whether
/// it lies inside the workspace.
///
/// `..` is refused outright (in relative and absolute input alike), so the
/// part below the deepest existing ancestor cannot climb back out. That
/// ancestor is canonicalised, which resolves any symlinked folder before
/// the inside/outside decision is made. Callers decide what an outside
/// path means: `write_note` refuses it, `export_note` allows it behind
/// `--allow-write` and an explicit `overwrite` for existing files.
pub fn resolve_new(workspace: &Path, input: &str) -> Result<(PathBuf, bool), String> {
    if input.is_empty() {
        return Err("path must not be empty".into());
    }
    let workspace_canon = workspace
        .canonicalize()
        .map_err(|e| format!("workspace not accessible: {e}"))?;
    // `components()` catches `..` for ordinary paths, but a Windows verbatim
    // path (`\\?\C:\...` — exactly what `canonicalize()` returns there) keeps
    // `..` as a literal Normal component. Check the raw segments too, for
    // both separator styles, so a caller cannot smuggle a traversal past the
    // guard by handing us a canonicalized workspace root.
    if input.split(|c| c == '/' || c == '\\').any(|part| part == "..") {
        return Err("path traversal (..) is not allowed".into());
    }
    let raw = PathBuf::from(input);
    if raw.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("path traversal (..) is not allowed".into());
    }
    let candidate = if raw.is_absolute() {
        raw
    } else {
        workspace_canon.join(&raw)
    };
    if candidate.file_name().is_none() {
        return Err("path has no file name".into());
    }

    // Walk up to the deepest ancestor that exists, then re-attach the
    // missing tail (plain names only — `..` was rejected above).
    let mut existing = candidate.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                existing = parent;
            }
            _ => return Err(format!("cannot resolve path {}", candidate.display())),
        }
    }
    let mut resolved = existing
        .canonicalize()
        .map_err(|e| format!("cannot resolve path {}: {e}", existing.display()))?;
    for name in tail.iter().rev() {
        resolved.push(name);
    }
    if resolved.is_dir() {
        return Err(format!("{} is a directory", resolved.display()));
    }
    let inside = resolved.starts_with(&workspace_canon);
    Ok((resolved, inside))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fresh_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("solomd-mcp-safety-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn resolve_new_allows_missing_parents_inside_workspace() {
        let ws = fresh_dir("ws");
        let (p, inside) = resolve_new(&ws, "a/b/c.md").unwrap();
        assert!(inside);
        assert_eq!(p, ws.join("a/b/c.md"));
    }

    #[test]
    fn resolve_new_refuses_parent_dir_components() {
        let ws = fresh_dir("dotdot");
        assert!(resolve_new(&ws, "../x.md").is_err());
        // Build the string explicitly: `PathBuf::join("..")` normalises the
        // segments away, and hard-coding "/" produced a mixed-separator path
        // on Windows (where `canonicalize()` returns a `\\?\` verbatim path).
        // Both separator styles must still be refused.
        let sep = std::path::MAIN_SEPARATOR;
        let abs = format!("{}{sep}sub{sep}..{sep}..{sep}x.md", ws.display());
        assert!(
            resolve_new(&ws, &abs).is_err(),
            "expected to refuse {abs:?}"
        );
        // A file name that merely contains two dots is not a `..` segment.
        let (p, inside) = resolve_new(&ws, "a..b.md").unwrap();
        assert!(inside);
        assert_eq!(p, ws.join("a..b.md"));
    }

    #[test]
    fn resolve_new_flags_outside_paths() {
        let ws = fresh_dir("in");
        let other = fresh_dir("out");
        let (p, inside) = resolve_new(&ws, &other.join("x.html").to_string_lossy()).unwrap();
        assert!(!inside);
        assert_eq!(p, other.join("x.html"));
    }

    /// A folder inside the workspace that points outside must count as
    /// outside, or a write would land somewhere the caller never allowed.
    #[cfg(unix)]
    #[test]
    fn resolve_new_sees_through_symlinked_folders() {
        let ws = fresh_dir("link-ws");
        let other = fresh_dir("link-target");
        std::os::unix::fs::symlink(&other, ws.join("escape")).unwrap();
        let (p, inside) = resolve_new(&ws, "escape/x.md").unwrap();
        assert!(!inside, "resolved to {}", p.display());
    }
}
