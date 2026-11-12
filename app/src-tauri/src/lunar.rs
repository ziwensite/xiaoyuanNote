//! Lunar / solar-term / traditional-festival data, fetched per year from a
//! public CDN and cached locally — the same ETag/304 + `holidays-cache.json`
//! discipline as `holidays.rs`, but for the fixed astronomical calendar.
//!
//! Why Rust: the webview cannot fetch a third-party host without CORS, and the
//! cache belongs next to the rest of the app data. The source only ever sees a
//! year in the path — no user data, no identifiers.
//!
//! Source: `hungtcs/traditional-chinese-calendar-database` (data derived from
//! the Hong Kong Observatory, 1901–2100). Shape (one static JSON per year):
//! `[{ "gregorian": {"year","month","date"}, "lunar": {"year","month","date",
//! "leapMonth"}, "solarTerm": "小寒" | absent, "zodiac": "蛇" }]`.
//!
//! The underlying data never changes per year, so the TTL is long (a year) and
//! we only pull the years the calendar actually shows. Front-end logic falls
//! back to its local lunar algorithm for years we have not fetched yet.

use crate::portable;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

/// Raw data kind, stored with every cached year.
pub const SOURCE_ID: &str = "hungtcs-lunar";
/// Swap the source here: `{year}` is replaced with a four-digit year.
pub const SOURCE_URL_TEMPLATE: &str =
    "https://cdn.jsdelivr.net/gh/hungtcs/traditional-chinese-calendar-database@master/database/json/{year}.json";

const CACHE_VERSION: u32 = 1;
const CACHE_FILE: &str = "lunar-cache.json";
/// The data is fixed per year, so a long TTL is fine.
const TTL_SECS: i64 = 365 * 24 * 60 * 60;
const REQUEST_TIMEOUT_SECS: u64 = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LunarDay {
    pub date: String,
    #[serde(default)]
    pub solar_term: Option<String>,
    #[serde(default)]
    pub lunar_month: String,
    #[serde(default)]
    pub lunar_date: String,
    #[serde(default)]
    pub leap: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedYear {
    pub fetched_at: String,
    #[serde(default)]
    pub last_checked_at: Option<String>,
    pub source: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub days: Vec<LunarDay>,
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

pub struct LunarState {
    inner: Mutex<Cache>,
    path: Option<PathBuf>,
    /// Single-flight latch: only one refresh may be in progress.
    inflight: Mutex<bool>,
}

impl LunarState {
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

/// A year is stale when it was never fetched, or the last check is older than
/// the (long) TTL. The calendar only shows nearby years, so a miss just means
/// the front end falls back to its local lunar algorithm.
fn is_stale(entry: Option<&CachedYear>, now: DateTime<Utc>) -> bool {
    let Some(entry) = entry else { return true };
    let checked = entry
        .last_checked_at
        .as_deref()
        .and_then(parse_ts)
        .or_else(|| parse_ts(&entry.fetched_at));
    let Some(checked) = checked else { return true };
    (now - checked).num_seconds() >= TTL_SECS
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
struct ApiDay {
    #[serde(default)]
    solar_term: Option<String>,
    gregorian: ApiGregorian,
    lunar: ApiLunar,
}

#[derive(Debug, Deserialize)]
struct ApiGregorian {
    year: i32,
    month: u32,
    date: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiLunar {
    #[serde(default)]
    year: String,
    month: String,
    date: String,
    #[serde(default)]
    leap_month: bool,
}

fn map_api_days(year: u32, days: Vec<ApiDay>) -> Vec<LunarDay> {
    let prefix = format!("{year}-");
    days
        .into_iter()
        .filter_map(|d| {
            let g = d.gregorian;
            let date = format!("{:04}-{:02}-{:02}", g.year, g.month, g.date);
            if date.len() != 10 || !date.starts_with(&prefix) {
                return None;
            }
            Some(LunarDay {
                date,
                solar_term: d.solar_term.filter(|s| !s.is_empty()),
                lunar_month: d.lunar.month,
                lunar_date: d.lunar.date,
                leap: d.lunar.leap_month,
            })
        })
        .collect()
}

enum FetchOutcome {
    NotModified,
    Updated {
        days: Vec<LunarDay>,
        etag: Option<String>,
        last_modified: Option<String>,
    },
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
    let api: Vec<ApiDay> = response.json().await.map_err(|e| e.to_string())?;
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
pub fn lunar_cached(state: State<'_, LunarState>) -> Snapshot {
    state.snapshot()
}

/// Refresh the requested years when stale (or when `force`). Always resolves
/// with a snapshot — failures degrade to the cache instead of surfacing errors.
#[tauri::command]
pub async fn lunar_refresh(
    state: State<'_, LunarState>,
    years: Vec<u32>,
    force: bool,
) -> Result<RefreshResult, String> {
    Ok(refresh_inner(&state, years, force).await)
}

async fn refresh_inner(state: &LunarState, years: Vec<u32>, force: bool) -> RefreshResult {
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

fn mark_failure(state: &LunarState, now: DateTime<Utc>) {
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
