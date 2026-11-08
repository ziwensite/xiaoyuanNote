//! M3 reminder scheduler — timing only, never model calls.
//!
//! The frontend owns recurrence and timezone math (`lib/calendar-reminders.ts`
//! reuses the calendar's `expandOccurrences`) and pushes a flat list of
//! absolute fire instants here. This module only:
//!
//!   1. sleeps until the next instant (re-checking at least once a minute so a
//!      system clock jump or a laptop resume re-aligns instead of waiting out
//!      the old timestamp),
//!   2. sends a **system notification** through `tauri-plugin-notification`,
//!   3. emits `solomd://calendar-reminder` so the UI can react,
//!   4. records that the id fired and persists those records so a restart
//!      cannot replay a reminder that already happened.
//!
//! Which memory: reminders are opt-in via event `alarms:` and task `⏰`
//! tokens. Anything without either produces nothing.
//!
//! **A reminder only fires while the app is running.** Closing the app stops
//! the loop; nothing wakes a quit process. This is stated to the user in the
//! calendar UI hint as well.
//!
//! Same-app rule: this loop is independent of `recipe_runner::spawn_cron_loop`
//! (that one runs recipes / calls models on a schedule). Sharing it would make
//! one feature's semantics leak into the other.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// A reminder that fired this late still counts as "on time" (laptop resume,
/// short sleep). Anything older is recorded as missed instead of popping up
/// after a restart.
const GRACE_SECS: i64 = 300;
/// Upper bound on one sleep: periodic re-alignment after clock changes.
const POLL_SECS: u64 = 60;
/// How long fired ids are kept. Past reminders older than this can never be
/// replayed, and this keeps the file small.
const KEEP_SECS: i64 = 7 * 24 * 60 * 60;

const REMINDER_EVENT: &str = "solomd://calendar-reminder";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReminderItem {
    pub id: String,
    pub fire_at: String,
    pub title: String,
    pub body: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FiredPayload<'a> {
    #[serde(flatten)]
    item: &'a ReminderItem,
    /// `false` when the OS notification API refused the notification; the UI
    /// is expected to show a visible in-app warning (never a silent no-op).
    notified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Persisted {
    items: Vec<ReminderItem>,
    /// id → fire instant (epoch ms). Presence means "already fired or missed".
    fired: HashMap<String, i64>,
}

pub struct RemindersState {
    items: Mutex<Vec<ReminderItem>>,
    fired: Mutex<HashMap<String, i64>>,
    wake: tokio::sync::Notify,
    path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum FireClass {
    Wait,
    Fire,
    Missed,
}

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => 0,
    }
}

fn fire_at_ms(item: &ReminderItem) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(&item.fire_at)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Decide what to do with one item at `now`.
fn classify(now: i64, fire_at: i64) -> FireClass {
    if fire_at > now {
        FireClass::Wait
    } else if now - fire_at <= GRACE_SECS * 1000 {
        FireClass::Fire
    } else {
        FireClass::Missed
    }
}

/// Sort by fire instant, drop duplicates by id and unparsable instants.
fn normalize_items(items: Vec<ReminderItem>) -> Vec<ReminderItem> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<ReminderItem> = items
        .into_iter()
        .filter(|i| fire_at_ms(i).is_some())
        .filter(|i| seen.insert(i.id.clone()))
        .collect();
    out.sort_by_key(|i| fire_at_ms(i).unwrap_or(i64::MAX));
    out
}

fn prune_fired(fired: &mut HashMap<String, i64>, now: i64) {
    let cutoff = now - KEEP_SECS * 1000;
    fired.retain(|_, at| *at >= cutoff);
}

fn app_config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn load_persisted(app: &AppHandle) -> Persisted {
    let Some(dir) = app_config_dir(app) else {
        return Persisted::default();
    };
    let file = dir.join("reminders.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(_) => return Persisted::default(),
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_persisted(app: &AppHandle, state: &RemindersState) {
    let Some(dir) = app_config_dir(app) else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let payload = Persisted {
        items: state.items.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        fired: state.fired.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    };
    if let Ok(text) = serde_json::to_string(&payload) {
        let _ = std::fs::write(dir.join("reminders.json"), text);
    }
}

impl RemindersState {
    /// Load the previous schedule and fired records. Stale schedule entries are
    /// kept so a reminder that became due while the app was closed can still
    /// fire within the grace window, but anything older than the keep window is
    /// discarded.
    pub fn load(app: &AppHandle) -> Self {
        let such = load_persisted(app);
        let now = now_ms();
        let mut fired = such.fired;
        prune_fired(&mut fired, now);
        let items = normalize_items(
            such.items
                .into_iter()
                .filter(|i| fire_at_ms(i).map(|at| at >= now - KEEP_SECS * 1000).unwrap_or(false))
                .collect(),
        );
        let path = app_config_dir(app)
            .map(|d| d.join("reminders.json"))
            .unwrap_or_default();
        Self {
            items: Mutex::new(items),
            fired: Mutex::new(fired),
            wake: tokio::sync::Notify::new(),
            path,
        }
    }

    fn pending(&self) -> Vec<ReminderItem> {
        self.items.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn already_fired(&self, id: &str) -> bool {
        self.fired
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(id)
    }

    /// Mark before sending: at-most-once is the contract. A notification that
    /// the OS rejects must not become a notification storm every minute.
    fn mark_fired(&self, id: &str, at: i64) {
        self.fired
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), at);
    }

    fn fired_snapshot(&self) -> HashMap<String, i64> {
        self.fired.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn persisted_path(&self) -> &PathBuf {
        &self.path
    }
}

/// Replace the schedule. The frontend calls this after every index/calendar
/// change and on a rolling basis before the horizon runs out.
#[tauri::command]
pub fn reminders_sync(
    app: AppHandle,
    state: State<'_, RemindersState>,
    items: Vec<ReminderItem>,
) -> Result<usize, String> {
    let normalized = normalize_items(items);
    let count = normalized.len();
    *state.items.lock().unwrap_or_else(|e| e.into_inner()) = normalized;
    {
        let mut fired = state.fired.lock().unwrap_or_else(|e| e.into_inner());
        prune_fired(&mut fired, now_ms());
    }
    state.wake.notify_one();
    save_persisted(&app, &state);
    Ok(count)
}

/// Diagnostics for the UI / tests: when the next pending reminder is due.
#[tauri::command]
pub fn reminders_status(state: State<'_, RemindersState>) -> serde_json::Value {
    let now = now_ms();
    let next = state
        .pending()
        .into_iter()
        .filter(|i| fire_at_ms(i).map(|at| at > now).unwrap_or(false))
        .min_by_key(|i| fire_at_ms(i).unwrap_or(i64::MAX));
    serde_json::json!({
        "next": next,
        "firedCount": state.fired_snapshot().len(),
        "persisted": state.persisted_path().to_string_lossy(),
    })
}

fn notify(app: &AppHandle, item: &ReminderItem) -> bool {
    use tauri_plugin_notification::NotificationExt;
    match app
        .notification()
        .builder()
        .title(&item.title)
        .body(&item.body)
        .show()
    {
        Ok(()) => true,
        Err(err) => {
            tracing::warn!("calendar reminder notification failed: {err}");
            false
        }
    }
}

fn fire(app: &AppHandle, state: &RemindersState, item: ReminderItem) {
    let Some(at) = fire_at_ms(&item) else { return };
    // Record first — if the process dies while the OS shows the notification,
    // a restart must not repeat it.
    state.mark_fired(&item.id, at);
    save_persisted(app, state);

    let notified = notify(app, &item);
    let _ = app.emit(
        REMINDER_EVENT,
        FiredPayload {
            item: &item,
            notified,
        },
    );
    if !notified {
        // Visible fallback signal. The frontend shows a warning toast; doing
        // nothing here is the silent degradation this milestone forbids.
        let _ = app.emit(
            "solomd://calendar-reminder-error",
            serde_json::json!({ "id": item.id }),
        );
    }
}

/// Single tokio task. Sleeps until the soonest pending instant, capped at
/// `POLL_SECS` so clock jumps and resume-from-sleep re-align quickly.
pub fn spawn_reminder_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<RemindersState>();
            let now = now_ms();
            let mut wait_secs = POLL_SECS;
            let mut fired_any = false;

            for item in state.pending() {
                let Some(at) = fire_at_ms(&item) else { continue };
                if state.already_fired(&item.id) {
                    continue;
                }
                match classify(now, at) {
                    FireClass::Wait => {
                        let delta = ((at - now) / 1000).max(1) as u64;
                        wait_secs = wait_secs.min(delta);
                    }
                    FireClass::Fire => {
                        fired_any = true;
                        fire(&app, &state, item);
                    }
                    FireClass::Missed => {
                        // Past the grace window: record it so it cannot pop up
                        // later, but do not notify — a restart should not
                        // replay yesterday's alarms.
                        state.mark_fired(&item.id, at);
                        fired_any = true;
                    }
                }
            }
            if fired_any {
                save_persisted(&app, &state);
            }

            let notified = state.wake.notified();
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(wait_secs)) => {}
                _ = notified => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, fire_at: &str) -> ReminderItem {
        ReminderItem {
            id: id.into(),
            fire_at: fire_at.into(),
            title: "Standup".into(),
            body: "2026-11-08 09:00".into(),
            path: "Calendar/standup.md".into(),
            kind: "event".into(),
        }
    }

    #[test]
    fn classify_fires_within_grace_and_skips_older() {
        let at = 1000;
        assert_eq!(classify(900, at), FireClass::Wait);
        assert_eq!(classify(1000, at), FireClass::Fire);
        assert_eq!(classify(1000 + GRACE_SECS * 1000, at), FireClass::Fire);
        assert_eq!(classify(1001 + GRACE_SECS * 1000, at), FireClass::Missed);
    }

    #[test]
    fn normalize_sorts_and_dedupes() {
        let out = normalize_items(vec![
            item("b", "2026-11-09T09:00:00.000Z"),
            item("a", "2026-11-08T09:00:00.000Z"),
            item("a", "2026-11-08T09:00:00.000Z"),
            item("bad", "not-a-date"),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "a");
        assert_eq!(out[1].id, "b");
    }

    #[test]
    fn prune_keeps_recent_fired_records_only() {
        let now = 1_000_000_000_000_i64;
        let mut fired = HashMap::new();
        fired.insert("old".to_string(), now - KEEP_SECS * 1000 - 1);
        fired.insert("new".to_string(), now - 60_000);
        prune_fired(&mut fired, now);
        assert_eq!(fired.len(), 1);
        assert!(fired.contains_key("new"));
    }

    #[test]
    fn sort_order_is_by_instant_not_by_id() {
        let out = normalize_items(vec![
            item("z", "2026-11-08T10:00:00.000Z"),
            item("a", "2026-11-08T09:00:00.000Z"),
        ]);
        assert_eq!(out[0].id, "a");
        assert_eq!(out[1].id, "z");
    }
}
