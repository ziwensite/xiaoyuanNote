use app_lib::search::{search_in_dir_inner as search_in_dir, SearchHit};
use std::fs;

/// Fixture per test — a unique `tempfile` dir so parallel runs and stale
/// directories from earlier runs can't leak into this one.
///
/// The explicit non-dot prefix matters: `search_in_dir_inner` filters out
/// dot-named entries, and `TempDir::new()` would name the root `.tmp…`,
/// making the walker skip the root itself and return zero hits.
fn fixture() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("solomd-search-")
        .tempdir()
        .unwrap();
    let root = dir.path();
    fs::write(root.join("search_test.md"),
        "# Search Test\n\nThe needle in the haystack.\nNothing here.\n").unwrap();
    fs::write(root.join("other.md"),
        "Some other note. The needle pops up again.\n").unwrap();
    fs::write(root.join("notes.txt"),
        "plain text. needle should be findable here too.\n").unwrap();
    fs::write(root.join("binary.png"), b"fake png bytes").unwrap();
    dir
}

#[test]
fn finds_needle_across_files() {
    let dir = fixture();
    let hits: Vec<SearchHit> =
        search_in_dir(dir.path().to_string_lossy().to_string(), "needle".to_string(), 100).unwrap();
    println!("hits: {:#?}", hits);
    assert!(hits.len() >= 3, "expected >=3 hits, got {}", hits.len());
    assert!(hits.iter().any(|h| h.file.ends_with("search_test.md")));
    assert!(hits.iter().any(|h| h.file.ends_with("other.md")));
    assert!(hits.iter().any(|h| h.file.ends_with("notes.txt")));
}

#[test]
fn case_insensitive() {
    let dir = fixture();
    let hits = search_in_dir(dir.path().to_string_lossy().to_string(), "NEEDLE".to_string(), 100).unwrap();
    assert!(hits.len() >= 3);
}

#[test]
fn empty_query_returns_empty() {
    let dir = fixture();
    let hits = search_in_dir(dir.path().to_string_lossy().to_string(), "".to_string(), 100).unwrap();
    assert_eq!(hits.len(), 0);
}

#[test]
fn respects_max_results() {
    let dir = fixture();
    let hits = search_in_dir(dir.path().to_string_lossy().to_string(), "the".to_string(), 2).unwrap();
    assert!(hits.len() <= 2);
}
