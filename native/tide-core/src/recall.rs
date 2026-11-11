//! Recall: the questions a learner missed or couldn't answer, kept and brought back when they
//! are about to be forgotten. One small file in the vault (plain JSON, readable and yours), loaded
//! once and held in memory; finding what is due for a topic among thousands of items takes microseconds.
//!
//! The schedule is FSRS-6 with its default parameters. Each item has a difficulty, a stability
//! (the days until the chance of remembering it falls to 90%) and its history of reviews. The
//! original miss counts as a first review rated "again". After each review the item is due when
//! its predicted retrievability falls to the desired retention, 0.9. Because the model knows how
//! long it really was since the last review, a review done late moves the schedule differently
//! from one done on time.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use fsrs::{MemoryState, FSRS, FSRS6_DEFAULT_PARAMETERS};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

const DAY_MS: f64 = 86_400_000.0;
/// The chance of remembering an item at the moment it comes due
pub const DESIRED_RETENTION: f32 = 0.9;

/// One review: 1 again, 2 hard, 3 good, 4 easy; when it happened (ms since 1970)
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecallReview {
  pub rating: u32,
  pub at: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RecallItem {
  pub id: String,
  /// The question, as the tutor asked it
  pub prompt: String,
  pub topic: String,
  /// The lesson it came from
  pub lesson: String,
  pub created: f64,
  /// When to ask it again (ms since 1970); at or before now means due
  pub due: f64,
  /// FSRS stability: days until the chance of remembering it falls to 90%
  pub stability: f64,
  /// FSRS difficulty, 1 to 10 (0 only in files written before FSRS, until they are migrated)
  #[serde(default)]
  pub difficulty: f64,
  /// Reviews since it was kept (the original miss is in `history`, not counted here)
  pub reviews: u32,
  pub lapses: u32,
  pub last: Option<f64>,
  /// Every review, oldest first, starting with the original miss
  #[serde(default)]
  pub history: Vec<RecallReview>,
}

#[napi(object)]
pub struct RecallNew {
  pub prompt: String,
  pub topic: String,
  pub lesson: String,
}

#[napi(object)]
pub struct RecallStats {
  pub total: u32,
  pub due: u32,
  /// Reviewed at least once and now stable for three weeks or more
  pub settled: u32,
}

#[napi]
pub struct Recall {
  path: PathBuf,
  items: Mutex<Vec<RecallItem>>,
  fsrs: FSRS,
}

const STOP: &[&str] = &[
  "about", "with", "from", "that", "this", "into", "what", "when", "where", "which", "their", "there", "have", "your", "and", "the", "for", "are", "its", "how", "why",
  "introduction", "intro", "basics", "fundamentals", "advanced", "overview", "part", "lesson", "topic", "learn", "learning", "understanding", "understand", "explained", "guide",
];

/// The words that say what a topic is about; plurals count as the same word
pub fn words(text: &str) -> HashSet<String> {
  text
    .to_lowercase()
    .split(|c: char| !(c.is_ascii_alphanumeric() || c == '+' || c == '#'))
    .filter(|w| w.len() > 2 && !STOP.contains(w))
    .map(|w| if w.len() > 3 { w.trim_end_matches('s').to_string() } else { w.to_string() })
    .collect()
}

/// How close two topics are: 1 the same, 0 nothing in common
pub fn closeness(a: &str, b: &str) -> f64 {
  let (x, y) = (words(a), words(b));
  if x.is_empty() || y.is_empty() {
    return 0.0;
  }
  x.intersection(&y).count() as f64 / x.len().min(y.len()) as f64
}

fn normal(prompt: &str) -> String {
  prompt.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn model() -> FSRS {
  FSRS::new(&FSRS6_DEFAULT_PARAMETERS).expect("the FSRS-6 default parameters are valid")
}

pub fn rating(grade: &str) -> u32 {
  match grade {
    "again" => 1,
    "hard" => 2,
    "easy" => 4,
    _ => 3,
  }
}

/// The state of a question just missed: one review, rated "again"
fn first_miss(fsrs: &FSRS) -> MemoryState {
  fsrs.next_states(None, DESIRED_RETENTION, 0).expect("a new item always has next states").again.memory
}

/// Gives an item kept before FSRS a plausible state. Its old stability was the days it was
/// expected to stay remembered, and it was due that long after its last review: read as the
/// interval at which recall falls to 90%, that is FSRS's own stability, so the due date stays as
/// it was. Lapses lower the ease the difficulty is derived from. The original miss goes in the
/// history; the ratings of later reviews were never recorded, so none are made up.
pub fn migrate(item: &mut RecallItem, fsrs: &FSRS) -> bool {
  if item.difficulty >= 1.0 {
    return false;
  }
  if item.history.is_empty() {
    item.history.push(RecallReview { rating: 1, at: item.created });
  }
  let state = if item.reviews == 0 {
    first_miss(fsrs)
  } else {
    let ease = (2.5 - 0.2 * item.lapses as f32).clamp(1.3, 2.5);
    fsrs.memory_state_from_sm2(ease, (item.stability as f32).max(0.25), DESIRED_RETENTION).unwrap_or_else(|_| first_miss(fsrs))
  };
  item.stability = state.stability as f64;
  item.difficulty = state.difficulty as f64;
  true
}

/// Schedules one review of `item` at `now` with a rating from 1 (again) to 4 (easy)
pub fn schedule(item: &mut RecallItem, fsrs: &FSRS, rating: u32, now: f64) {
  let since = item.last.or(item.history.last().map(|r| r.at)).unwrap_or(item.created);
  let elapsed = ((now - since) / DAY_MS).max(0.0) as f32;
  let state = MemoryState { stability: item.stability as f32, difficulty: item.difficulty as f32, stability_fast: item.stability as f32 };
  let next = fsrs.next_states_with_elapsed_days(Some(state), DESIRED_RETENTION, elapsed).ok();
  let chosen = next.map(|n| match rating {
    1 => n.again,
    2 => n.hard,
    4 => n.easy,
    _ => n.good,
  });
  if let Some(s) = chosen {
    item.stability = s.memory.stability as f64;
    item.difficulty = s.memory.difficulty as f64;
    item.due = now + (s.interval as f64).max(0.0) * DAY_MS;
  }
  if rating == 1 {
    item.lapses += 1;
  }
  item.reviews += 1;
  item.last = Some(now);
  item.history.push(RecallReview { rating, at: now });
}

fn err<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
}

#[napi]
impl Recall {
  /// Opens the store at `path` (a JSON file), empty when it isn't there yet. A file written
  /// before FSRS is migrated in place: every item kept, each given a state of its own.
  #[napi(constructor)]
  pub fn new(path: String) -> Result<Self> {
    let path = PathBuf::from(path);
    let fsrs = model();
    let mut items: Vec<RecallItem> = match std::fs::read(&path) {
      Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| err(format!("{} is not a recall file: {e}", path.display())))?,
      Err(_) => Vec::new(),
    };
    let mut migrated = false;
    for item in items.iter_mut() {
      migrated |= migrate(item, &fsrs);
    }
    let recall = Recall { path, items: Mutex::new(Vec::new()), fsrs };
    if migrated {
      recall.save(&items)?;
    }
    *recall.items.lock().map_err(err)? = items;
    Ok(recall)
  }

  /// Written beside itself and renamed, so a crash never leaves half a file
  fn save(&self, items: &[RecallItem]) -> Result<()> {
    if let Some(dir) = self.path.parent() {
      std::fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = self.path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(items).map_err(err)?).map_err(err)?;
    std::fs::rename(&tmp, &self.path).map_err(err)
  }

  /// Adds questions that aren't already kept (the same words, whatever the spacing or case).
  /// Each starts from one "again" review, the miss itself, and is due straight away: the next
  /// lesson on its topic opens with it. Returns how many were new.
  #[napi]
  pub fn add(&self, new: Vec<RecallNew>, now: f64) -> Result<u32> {
    let mut items = self.items.lock().map_err(err)?;
    let mut seen: HashSet<String> = items.iter().map(|i| normal(&i.prompt)).collect();
    let mut added = 0;
    for n in new {
      let key = normal(&n.prompt);
      if key.len() < 8 || !seen.insert(key) {
        continue;
      }
      added += 1;
      let id = format!("{:x}-{}", now as u64, items.len());
      let s = first_miss(&self.fsrs);
      items.push(RecallItem {
        id,
        prompt: n.prompt,
        topic: n.topic,
        lesson: n.lesson,
        created: now,
        due: now,
        stability: s.stability as f64,
        difficulty: s.difficulty as f64,
        reviews: 0,
        lapses: 0,
        last: None,
        history: vec![RecallReview { rating: 1, at: now }],
      });
    }
    if added > 0 {
      self.save(&items)?;
    }
    Ok(added)
  }

  /// What is due now for this topic: its own questions first, then those of close topics, the
  /// longest overdue first. Never from the lesson named in `not_from` (it is still going on).
  #[napi]
  pub fn due(&self, topic: String, now: f64, limit: u32, not_from: Option<String>) -> Result<Vec<RecallItem>> {
    let items = self.items.lock().map_err(err)?;
    let mut found: Vec<(f64, &RecallItem)> = items
      .iter()
      .filter(|i| i.due <= now && not_from.as_deref() != Some(i.lesson.as_str()))
      .map(|i| (closeness(&topic, &i.topic), i))
      .filter(|(close, _)| *close >= 0.5)
      .collect();
    found.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.due.partial_cmp(&b.1.due).unwrap()));
    Ok(found.into_iter().take(limit as usize).map(|(_, i)| i.clone()).collect())
  }

  /// Records how a question went ("again", "hard", "good", "easy") and schedules it. Returns the item as it is now.
  #[napi]
  pub fn review(&self, id: String, grade: String, now: f64) -> Result<Option<RecallItem>> {
    let mut items = self.items.lock().map_err(err)?;
    let Some(item) = items.iter_mut().find(|i| i.id == id) else { return Ok(None) };
    schedule(item, &self.fsrs, rating(&grade), now);
    let out = item.clone();
    self.save(&items)?;
    Ok(Some(out))
  }

  #[napi]
  pub fn stats(&self, now: f64) -> Result<RecallStats> {
    let items = self.items.lock().map_err(err)?;
    Ok(RecallStats {
      total: items.len() as u32,
      due: items.iter().filter(|i| i.due <= now).count() as u32,
      settled: items.iter().filter(|i| i.reviews > 0 && i.stability >= 21.0).count() as u32,
    })
  }

  /// Everything kept, for a page that lists it
  #[napi]
  pub fn all(&self) -> Result<Vec<RecallItem>> {
    Ok(self.items.lock().map_err(err)?.clone())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const T0: f64 = 1_700_000_000_000.0;

  fn fresh(fsrs: &FSRS) -> RecallItem {
    let s = first_miss(fsrs);
    RecallItem {
      id: "a".into(),
      prompt: "What is 0x2A in decimal?".into(),
      topic: "Hexadecimal".into(),
      lesson: "l".into(),
      created: T0,
      due: T0,
      stability: s.stability as f64,
      difficulty: s.difficulty as f64,
      reviews: 0,
      lapses: 0,
      last: None,
      history: vec![RecallReview { rating: 1, at: T0 }],
    }
  }

  fn days(item: &RecallItem, from: f64) -> f64 {
    (item.due - from) / DAY_MS
  }

  #[test]
  fn schedule_grows_with_success_and_shrinks_with_failure() {
    let fsrs = model();
    let mut item = fresh(&fsrs);
    // The miss itself: FSRS-6's first stability for "again"
    assert!((item.stability - FSRS6_DEFAULT_PARAMETERS[0] as f64).abs() < 1e-6);
    let mut now = T0 + DAY_MS;
    schedule(&mut item, &fsrs, 3, now);
    let first = item.stability;
    assert!(days(&item, now) > 0.5);
    now = item.due;
    schedule(&mut item, &fsrs, 3, now);
    assert!(item.stability > first * 1.5, "good on time grows stability: {first} -> {}", item.stability);
    let mut easy = item.clone();
    let mut good = item.clone();
    let mut again = item.clone();
    now = item.due;
    schedule(&mut easy, &fsrs, 4, now);
    schedule(&mut good, &fsrs, 3, now);
    schedule(&mut again, &fsrs, 1, now);
    assert!(easy.stability > good.stability);
    assert!(again.stability < item.stability);
    assert_eq!(again.lapses, 1);
    assert_eq!(good.reviews, 3);
    assert_eq!(good.history.iter().map(|r| r.rating).collect::<Vec<_>>(), vec![1, 3, 3, 3]);
    // Due when retrievability falls to 0.9: for FSRS-6 that is one stability after the review
    let r = fsrs.current_retrievability(MemoryState { stability: good.stability as f32, difficulty: good.difficulty as f32, stability_fast: good.stability as f32 }, days(&good, now) as f32);
    assert!((r - 0.9).abs() < 0.005, "retrievability at due {r}");
  }

  #[test]
  fn a_late_review_is_scheduled_differently_from_an_on_time_one() {
    let fsrs = model();
    let mut item = fresh(&fsrs);
    schedule(&mut item, &fsrs, 3, T0 + DAY_MS);
    let at = item.due;
    schedule(&mut item, &fsrs, 3, at);
    let (mut on_time, mut late) = (item.clone(), item.clone());
    let due = item.due;
    let interval = due - item.last.unwrap();
    schedule(&mut on_time, &fsrs, 3, due);
    schedule(&mut late, &fsrs, 3, due + 3.0 * interval);
    // Remembering it after much longer is stronger evidence: more stability, a longer wait
    assert!(late.stability > on_time.stability * 1.2, "{} vs {}", late.stability, on_time.stability);
    assert!(days(&late, late.last.unwrap()) > days(&on_time, on_time.last.unwrap()));
    // And a miss after a long gap is not punished like a miss on time
    let (mut miss_on_time, mut miss_late) = (item.clone(), item.clone());
    schedule(&mut miss_on_time, &fsrs, 1, due);
    schedule(&mut miss_late, &fsrs, 1, due + 3.0 * interval);
    assert_ne!(miss_on_time.stability, miss_late.stability);
  }

  #[test]
  fn files_from_before_fsrs_are_migrated_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recall.json");
    let old = serde_json::json!([
      { "id": "new", "prompt": "What is 0x2A in decimal?", "topic": "Hexadecimal", "lesson": "l1",
        "created": T0, "due": T0, "stability": 0.0, "reviews": 0, "lapses": 0, "last": null },
      { "id": "kept", "prompt": "Why does two's complement work?", "topic": "Binary", "lesson": "l2",
        "created": T0, "due": T0 + 12.5 * DAY_MS, "stability": 5.0, "reviews": 2, "lapses": 0, "last": T0 + 7.5 * DAY_MS },
      { "id": "shaky", "prompt": "What is a nibble, in bits?", "topic": "Binary", "lesson": "l2",
        "created": T0, "due": T0 + 3.0 * DAY_MS, "stability": 0.5, "reviews": 4, "lapses": 3, "last": T0 + 2.5 * DAY_MS }
    ]);
    std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    let r = Recall::new(path.to_string_lossy().into()).unwrap();
    let items = r.all().unwrap();
    assert_eq!(items.len(), 3, "nothing dropped");
    for i in &items {
      assert!(i.difficulty >= 1.0 && i.difficulty <= 10.0);
      assert!(i.stability > 0.0);
      assert_eq!(i.history[0], RecallReview { rating: 1, at: T0 }, "the original miss");
    }
    let by = |id: &str| items.iter().find(|i| i.id == id).unwrap().clone();
    // Never reviewed: the state of a fresh miss, still due now
    assert!((by("new").stability - FSRS6_DEFAULT_PARAMETERS[0] as f64).abs() < 1e-6);
    assert_eq!(by("new").due, T0);
    // Reviewed: its old stability carries over, its due date and counts too
    assert!((by("kept").stability - 5.0).abs() < 0.01);
    assert_eq!(by("kept").due, T0 + 12.5 * DAY_MS);
    assert_eq!((by("kept").reviews, by("shaky").lapses), (2, 3));
    // Lapses read as a harder item
    assert!(by("shaky").difficulty > by("kept").difficulty);
    // Written back at once, and reopening it changes nothing more
    let disk: Vec<RecallItem> = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert!(disk.iter().all(|i| i.difficulty >= 1.0 && i.history.len() == 1));
    assert!(!path.with_extension("json.tmp").exists());
    let again = Recall::new(path.to_string_lossy().into()).unwrap().all().unwrap();
    assert_eq!(serde_json::to_value(&again).unwrap(), serde_json::to_value(&items).unwrap());
    // And it schedules from there
    let after = r.review("kept".into(), "good".into(), T0 + 12.5 * DAY_MS).unwrap().unwrap();
    assert!(after.stability > 5.0);
    assert_eq!(after.history.len(), 2);
  }

  #[test]
  fn topics_match_by_what_they_are_about() {
    assert_eq!(closeness("Binary, hexadecimal, number representations", "Hexadecimal and binary"), 1.0);
    assert!(closeness("Two's complement and binary numbers", "Binary, hexadecimal, number representations") >= 0.5);
    assert_eq!(closeness("BigQuery", "Binary numbers"), 0.0);
    assert_eq!(closeness("Pointers in C", "C"), 0.0); // one-letter names are too short to tell topics apart on their own
  }
}
