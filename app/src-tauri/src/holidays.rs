//! Statutory-holiday data: an on-disk cache plus **conditional, event-driven**
//! refreshes.
//!
//! Why Rust: the webview cannot fetch a third-party host without CORS, and the
//! cache belongs next to the rest of the app data. The source only ever sees a
//! year in the path — no user data, no identifiers.
//!
//! Source: NateScarlet/holiday-cn (MIT), one static JSON per year generated
//! from the State Council notices. Shape:
//! `{ year, days: [{ name, date: "YYYY-MM-DD", isOffDay }] }`, where
//! `isOffDay: false` is a make-up workday. The URL lives in
//! [`SOURCE_URL_TEMPLATE`] so swapping sources is a one-line change.
//!
//! No polling thread, no system scheduler: the frontend calls
//! `holidays_refresh` on three events (startup, calendar open, manual button).
//! The cache records `ETag` / `Last-Modified` and sends `If-None-Match` /
//! `If-Modified-Since`; a 304 only bumps `lastCheckedAt` — no parse, no rewrite.
//! A source that omits validators degrades to a plain GET, throttled by the TTL
//! (7 days normally, 1 day inside the 11-20 … 12-15 notice window).
//!
//! Every failure is silent: the command still returns the cached snapshot, and
//! consecutive failures set a backoff (1 h → 6 h → 24 h → 7 d cap) so repeated
//! launches cannot hammer the source. Manual checks may bypass the backoff but
//! never run concurrently with an in-flight refresh.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::portable;

/// Raw data kind, stored with every cached year.
pub const SOURCE_ID: &str = "holiday-cn";
/// Swap the source here: `{year}` is replaced with a four-digit year.
pub const SOURCE_URL_TEMPLATE: &str =
    "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json";

const CACHE_VERSION: u32 = 1;
const CACHE_FILE: &str = "holidays-cache.json";
const NORMAL_TTL_SECS: i64 = 7 * 24 * 60 * 60;
const NOTICE_TTL_SECS: i64 = 24 * 60 * 60;
const REQUEST_TIMEOUT_SECS: u64 = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HolidayDay {
    pub date: String,
    #[serde(default)]
    pub name: String,
    pub off: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedYear {
    /// When the day list last changed (a 200 with a body).
    pub fetched_at: String,
    /// Last successful check, including 304. The TTL reads this.
    #[serde(default)]
    pub last_checked_at: Option<String>,
    /// Raw data kind (`holiday-cn`).
    pub source: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub days: Vec<HolidayDay>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backoff {
    #[serde(default)]
    pub failures: u32,
    #[serde(default)]
    pub next_attempt_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    pub version: u32,
    #[serde(default)]
    pub years: BTreeMap<String, CachedYear>,
    #[serde(default)]
    pub backoff: Backoff,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            version: CACHE_VERSION,
            years: BTreeMap::new(),
            backoff: Backoff::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub years: BTreeMap<String, CachedYear>,
    pub backoff: Backoff,
    pub cache_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    /// `updated` | `current` | `failed` | `skipped`.
    pub outcome: String,
    pub updated_years: Vec<u32>,
    pub checked_at: Option<String>,
    pub snapshot: Snapshot,
}

pub struct HolidaysState {
    inner: Mutex<Cache>,
    path: Option<PathBuf>,
    /// Single-flight latch: only one refresh may be in progress.
    inflight: Mutex<bool>,
}

impl HolidaysState {
    pub fn load(app: &AppHandle) -> Self {
        let path = portable::app_data_dir(app.path())
            .ok()
            .map(|dir| dir.join(CACHE_FILE));
        let cache = path
            .as_deref()
            .and_then(read_cache)
            .unwrap_or_default();
        Self {
            inner: Mutex::new(cache),
            path,
            inflight: Mutex::new(false),
        }
    }

    fn cache_path(&self) -> String {
        self.path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    }

    fn snapshot(&self) -> Snapshot {
        let cache = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        Snapshot {
            years: cache.years.clone(),
            backoff: cache.backoff.clone(),
            cache_path: self.cache_path(),
        }
    }
}

fn read_cache(path: &Path) -> Option<Cache> {
    let text = std::fs::read_to_string(path).ok()?;
    let cache: Cache = serde_json::from_str(&text).ok()?;
    if cache.version == CACHE_VERSION {
        Some(cache)
    } else {
        None
    }
}

fn write_cache(path: &Path, cache: &Cache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn parse_ts(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn now_iso(now: DateTime<Utc>) -> String {
    now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 7 days normally; during the State Council's publication window (Nov 20 –
/// Dec 15) a day, since a new notice can land any morning.
fn ttl_secs(now: DateTime<Utc>) -> i64 {
    let (month, day) = (now.month(), now.day());
    if (month == 11 && day >= 20) || (month == 12 && day <= 15) {
        NOTICE_TTL_SECS
    } else {
        NORMAL_TTL_SECS
    }
}

fn backoff_secs(failures: u32) -> i64 {
    match failures {
        1 => 60 * 60,
        2 => 6 * 60 * 60,
        3 => 24 * 60 * 60,
        _ => 7 * 24 * 60 * 60,
    }
}

fn in_backoff(cache: &Cache, now: DateTime<Utc>) -> bool {
    cache
        .backoff
        .next_attempt_at
        .as_deref()
        .and_then(parse_ts)
        .map(|at| now < at)
        .unwrap_or(false)
}

/// A year is stale when it was never fetched, the cache went a calendar year
/// without a check, or the last check is older than the TTL.
fn is_stale(entry: Option<&CachedYear>, now: DateTime<Utc>) -> bool {
    let Some(entry) = entry else { return true };
    let checked = entry
        .last_checked_at
        .as_deref()
        .and_then(parse_ts)
        .or_else(|| parse_ts(&entry.fetched_at));
    let Some(checked) = checked else { return true };
    if checked.year() != now.year() {
        return true;
    }
    (now - checked).num_seconds() >= ttl_secs(now)
}

fn years_to_check(
    cache: &Cache,
    requested: &[u32],
    force: bool,
    now: DateTime<Utc>,
) -> Vec<u32> {
    let mut years: Vec<u32> = requested
        .iter()
        .copied()
        .filter(|year| (1900..=2100).contains(year))
        .collect();
    years.sort_unstable();
    years.dedup();
    if force {
        return years;
    }
    if in_backoff(cache, now) {
        return Vec::new();
    }
    years
        .into_iter()
        .filter(|year| is_stale(cache.years.get(&year.to_string()), now))
        .collect()
}

#[derive(Debug, Deserialize)]
struct ApiYear {
    #[serde(default)]
    days: Vec<ApiDay>,
}

#[derive(Debug, Deserialize)]
struct ApiDay {
    #[serde(default)]
    name: String,
    date: String,
    #[serde(rename = "isOffDay")]
    is_off_day: bool,
}

fn map_api_days(year: u32, api: ApiYear) -> Vec<HolidayDay> {
    let prefix = format!("{year}-");
    api.days
        .into_iter()
        .filter_map(|day| {
            let date = day.date.trim().to_string();
            if date.len() != 10 || !date.starts_with(&prefix) {
                return None;
            }
            Some(HolidayDay {
                date,
                name: day.name.trim().to_string(),
                off: day.is_off_day,
            })
        })
        .collect()
}

enum FetchOutcome {
    NotModified,
    Updated {
        days: Vec<HolidayDay>,
        etag: Option<String>,
        last_modified: Option<String>,
    },
    /// The year has no published notice yet (404) — remembered so it is not
    /// re-requested on every launch, but not counted as a failure.
    NoData,
}

fn apply_outcome(cache: &mut Cache, year: u32, outcome: FetchOutcome, now_iso: &str) {
    let key = year.to_string();
    match outcome {
        FetchOutcome::NotModified => {
            if let Some(entry) = cache.years.get_mut(&key) {
                entry.last_checked_at = Some(now_iso.to_string());
                entry.source = SOURCE_ID.to_string();
            }
        }
        FetchOutcome::Updated {
            days,
            etag,
            last_modified,
        } => {
            cache.years.insert(
                key,
                CachedYear {
                    fetched_at: now_iso.to_string(),
                    last_checked_at: Some(now_iso.to_string()),
                    source: SOURCE_ID.to_string(),
                    etag,
                    last_modified,
                    days,
                },
            );
        }
        FetchOutcome::NoData => {
            let entry = cache.years.entry(key).or_insert_with(|| CachedYear {
                fetched_at: now_iso.to_string(),
                last_checked_at: None,
                source: SOURCE_ID.to_string(),
                etag: None,
                last_modified: None,
                days: Vec::new(),
            });
            entry.last_checked_at = Some(now_iso.to_string());
        }
    }
}

fn header_string(resp: &reqwest::Response, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

async fn fetch_year(
    client: &reqwest::Client,
    year: u32,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<FetchOutcome, String> {
    let url = SOURCE_URL_TEMPLATE.replace("{year}", &year.to_string());
    let mut request = client.get(url);
    if let Some(etag) = etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = last_modified {
        request = request.header(reqwest::header::IF_MODIFIED_SINCE, last_modified);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 304 {
        return Ok(FetchOutcome::NotModified);
    }
    if status.as_u16() == 404 {
        return Ok(FetchOutcome::NoData);
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    let etag = header_string(&response, "etag");
    let last_modified = header_string(&response, "last-modified");
    let api: ApiYear = response.json().await.map_err(|e| e.to_string())?;
    let days = map_api_days(year, api);
    if days.is_empty() {
        return Ok(FetchOutcome::NoData);
    }
    Ok(FetchOutcome::Updated {
        days,
        etag,
        last_modified,
    })
}

/// Read-only snapshot; never touches the network.
#[tauri::command]
pub fn holidays_cached(state: State<'_, HolidaysState>) -> Snapshot {
    state.snapshot()
}

/// Refresh the requested years when stale (or when `force`). Always resolves
/// with a snapshot — failures degrade to the cache instead of surfacing errors.
#[tauri::command]
pub async fn holidays_refresh(
    state: State<'_, HolidaysState>,
    years: Vec<u32>,
    force: bool,
) -> Result<RefreshResult, String> {
    // Async commands with borrowed inputs must return `Result`; failures still
    // resolve as `Ok` so the UI can stay silent and keep the cache.
    Ok(refresh_inner(&state, years, force).await)
}

async fn refresh_inner(state: &HolidaysState, years: Vec<u32>, force: bool) -> RefreshResult {
    let now = Utc::now();
    let now_text = now_iso(now);

    {
        let mut inflight = state.inflight.lock().unwrap_or_else(|e| e.into_inner());
        if *inflight {
            return RefreshResult {
                outcome: "skipped".to_string(),
                updated_years: Vec::new(),
                checked_at: Some(now_text),
                snapshot: state.snapshot(),
            };
        }
        *inflight = true;
    }
    let _guard = InflightGuard(&state.inflight);

    // Read everything this pass needs in one short lock; the guard must not
    // live across the awaits below (MutexGuard is not Send).
    let (targets, credentials) = {
        let cache = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let targets = years_to_check(&cache, &years, force, now);
        let credentials: Vec<(u32, Option<String>, Option<String>)> = targets
            .iter()
            .map(|year| {
                let entry = cache.years.get(&year.to_string());
                (
                    *year,
                    entry.and_then(|e| e.etag.clone()),
                    entry.and_then(|e| e.last_modified.clone()),
                )
            })
            .collect();
        (targets, credentials)
    };

    if targets.is_empty() {
        return RefreshResult {
            outcome: "current".to_string(),
            updated_years: Vec::new(),
            checked_at: Some(now_text),
            snapshot: state.snapshot(),
        };
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            mark_failure(state, Utc::now());
            return RefreshResult {
                outcome: "failed".to_string(),
                updated_years: Vec::new(),
                checked_at: Some(now_text),
                snapshot: state.snapshot(),
            };
        }
    };

    let mut outcomes: Vec<(u32, FetchOutcome)> = Vec::new();
    let mut failed = false;
    for (year, etag, last_modified) in credentials {
        match fetch_year(&client, year, etag, last_modified).await {
            Ok(outcome) => outcomes.push((year, outcome)),
            Err(_) => failed = true,
        }
    }

    let mut updated_years = Vec::new();
    {
        let mut cache = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        for (year, outcome) in outcomes {
            if matches!(outcome, FetchOutcome::Updated { .. }) {
                updated_years.push(year);
            }
            apply_outcome(&mut cache, year, outcome, &now_text);
        }
        if failed {
            cache.backoff.failures = cache.backoff.failures.saturating_add(1);
            let delay = backoff_secs(cache.backoff.failures);
            cache.backoff.next_attempt_at =
                Some(now_iso(Utc::now() + chrono::Duration::seconds(delay)));
        } else {
            cache.backoff.failures = 0;
            cache.backoff.next_attempt_at = None;
        }
        if let Some(path) = state.path.as_deref() {
            let _ = write_cache(path, &cache);
        }
    }

    let outcome = if !updated_years.is_empty() {
        "updated"
    } else if failed {
        "failed"
    } else {
        "current"
    };

    RefreshResult {
        outcome: outcome.to_string(),
        updated_years,
        checked_at: Some(now_text),
        snapshot: state.snapshot(),
    }
}

fn mark_failure(state: &HolidaysState, now: DateTime<Utc>) {
    let mut cache = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    cache.backoff.failures = cache.backoff.failures.saturating_add(1);
    let delay = backoff_secs(cache.backoff.failures);
    cache.backoff.next_attempt_at = Some(now_iso(now + chrono::Duration::seconds(delay)));
    if let Some(path) = state.path.as_deref() {
        let _ = write_cache(path, &cache);
    }
}

struct InflightGuard<'a>(&'a Mutex<bool>);

impl Drop for InflightGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut inflight) = self.0.lock() {
            *inflight = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(date: &str, name: &str, off: bool) -> HolidayDay {
        HolidayDay {
            date: date.to_string(),
            name: name.to_string(),
            off,
        }
    }

    fn cached(days: Vec<HolidayDay>, checked: &str) -> CachedYear {
        CachedYear {
            fetched_at: "2026-01-01T00:00:00Z".to_string(),
            last_checked_at: Some(checked.to_string()),
            source: SOURCE_ID.to_string(),
            etag: Some("\"abc\"".to_string()),
            last_modified: None,
            days,
        }
    }

    fn cache_with(year: &str, entry: CachedYear) -> Cache {
        let mut cache = Cache::default();
        cache.years.insert(year.to_string(), entry);
        cache
    }

    fn at(value: &str) -> DateTime<Utc> {
        parse_ts(value).expect("valid timestamp")
    }

    #[test]
    fn maps_api_days_and_rejects_other_years() {
        let api: ApiYear = serde_json::from_str(
            r#"{"year":2026,"days":[
                {"name":"元旦","date":"2026-01-01","isOffDay":true},
                {"name":"春节","date":"2026-02-14","isOffDay":false},
                {"name":"bogus","date":"2025-12-31","isOffDay":true}
            ]}"#,
        )
        .expect("api json");
        let days = map_api_days(2026, api);
        assert_eq!(days.len(), 2);
        assert_eq!(days[0], day("2026-01-01", "元旦", true));
        assert_eq!(days[1], day("2026-02-14", "春节", false));
    }

    #[test]
    fn a_304_only_moves_last_checked() {
        let mut cache = cache_with(
            "2026",
            cached(vec![day("2026-01-01", "元旦", true)], "2026-11-01T00:00:00Z"),
        );
        apply_outcome(&mut cache, 2026, FetchOutcome::NotModified, "2026-11-05T00:00:00Z");
        let entry = cache.years.get("2026").expect("entry");
        assert_eq!(entry.last_checked_at.as_deref(), Some("2026-11-05T00:00:00Z"));
        assert_eq!(entry.fetched_at, "2026-01-01T00:00:00Z");
        assert_eq!(entry.days.len(), 1);
        assert_eq!(entry.etag.as_deref(), Some("\"abc\""));
    }

    #[test]
    fn staleness_uses_ttl_window_and_cross_year() {
        let now = at("2026-06-01T00:00:00Z");
        assert!(is_stale(None, now));
        assert!(!is_stale(
            Some(&cached(vec![day("2026-01-01", "元旦", true)], "2026-05-26T00:00:00Z")),
            now
        ));
        assert!(is_stale(
            Some(&cached(vec![day("2026-01-01", "元旦", true)], "2026-05-20T00:00:00Z")),
            now
        ));
        assert!(is_stale(
            Some(&cached(vec![day("2025-01-01", "元旦", true)], "2025-12-20T00:00:00Z")),
            now
        ));
    }

    #[test]
    fn the_notice_window_shrinks_the_ttl_to_one_day() {
        assert_eq!(ttl_secs(at("2026-11-19T00:00:00Z")), NORMAL_TTL_SECS);
        assert_eq!(ttl_secs(at("2026-11-20T00:00:00Z")), NOTICE_TTL_SECS);
        assert_eq!(ttl_secs(at("2026-12-15T00:00:00Z")), NOTICE_TTL_SECS);
        assert_eq!(ttl_secs(at("2026-12-16T00:00:00Z")), NORMAL_TTL_SECS);
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_secs(1), 3_600);
        assert_eq!(backoff_secs(2), 21_600);
        assert_eq!(backoff_secs(3), 86_400);
        assert_eq!(backoff_secs(9), 604_800);
    }

    #[test]
    fn auto_checks_skip_years_inside_backoff() {
        let now = at("2026-06-01T12:00:00Z");
        let mut cache = cache_with(
            "2026",
            cached(vec![day("2026-01-01", "元旦", true)], "2026-01-01T00:00:00Z"),
        );
        cache.backoff.failures = 2;
        cache.backoff.next_attempt_at = Some("2026-06-01T18:00:00Z".to_string());
        assert!(years_to_check(&cache, &[2026], false, now).is_empty());
        // A manual check ignores the backoff.
        assert_eq!(years_to_check(&cache, &[2026], true, now), vec![2026]);
    }

    #[test]
    fn cache_round_trips_through_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(CACHE_FILE);
        let mut cache = Cache::default();
        cache
            .years
            .insert("2026".to_string(), cached(vec![day("2026-01-01", "元旦", true)], "2026-11-01T00:00:00Z"));
        cache.backoff.failures = 1;
        write_cache(&path, &cache).expect("write");
        let loaded = read_cache(&path).expect("read");
        assert_eq!(loaded.version, CACHE_VERSION);
        assert_eq!(loaded.years["2026"].days[0].name, "元旦");
        assert_eq!(loaded.backoff.failures, 1);
    }
}
