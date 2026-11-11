//! Recall: the questions a learner missed or couldn't answer, kept and brought back at growing
//! intervals. One small file in the vault (plain JSON, readable and yours), loaded once and held
//! in memory; finding what is due for a topic among thousands of items takes microseconds.
//!
//! The schedule is deliberately simple and visible. Each item has a "stability": the number of
//! days it is expected to stay remembered. Answering well multiplies it (2.5 times, 4 when it was
//! easy); struggling grows it a little; failing cuts it to a quarter and counts a lapse. The item
//! is due again that many days after the review.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

const DAY_MS: f64 = 86_400_000.0;

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
  /// Days it is expected to stay remembered
  pub stability: f64,
  pub reviews: u32,
  pub lapses: u32,
  pub last: Option<f64>,
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

/// The stability after a review: "again", "hard", "good" or "easy"
pub fn next_stability(stability: f64, reviews: u32, grade: &str) -> f64 {
  match grade {
    "again" => (stability * 0.25).max(0.25),
    "hard" => (stability * 1.3).max(1.0),
    "easy" => if reviews == 0 { 5.0 } else { stability * 4.0 },
    _ => if reviews == 0 { 2.0 } else { stability * 2.5 },
  }
  .min(365.0)
}

fn err<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
}

#[napi]
impl Recall {
  /// Opens the store at `path` (a JSON file), empty when it isn't there yet
  #[napi(constructor)]
  pub fn new(path: String) -> Result<Self> {
    let path = PathBuf::from(path);
    let items = match std::fs::read(&path) {
      Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| err(format!("{} is not a recall file: {e}", path.display())))?,
      Err(_) => Vec::new(),
    };
    Ok(Recall { path, items: Mutex::new(items) })
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
  /// A new one is due straight away: the next lesson on its topic opens with it. Returns how many were new.
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
      items.push(RecallItem { id, prompt: n.prompt, topic: n.topic, lesson: n.lesson, created: now, due: now, stability: 0.0, reviews: 0, lapses: 0, last: None });
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
    item.stability = next_stability(item.stability, item.reviews, &grade);
    if grade == "again" {
      item.lapses += 1;
    }
    item.reviews += 1;
    item.last = Some(now);
    item.due = now + item.stability * DAY_MS;
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

  #[test]
  fn schedule_grows_with_success_and_shrinks_with_failure() {
    let first = next_stability(0.0, 0, "good");
    assert_eq!(first, 2.0);
    let second = next_stability(first, 1, "good");
    assert_eq!(second, 5.0);
    assert!(next_stability(second, 2, "easy") > next_stability(second, 2, "good"));
    assert_eq!(next_stability(second, 2, "again"), 1.25);
    assert_eq!(next_stability(0.5, 3, "again"), 0.25);
    assert_eq!(next_stability(300.0, 9, "easy"), 365.0);
  }

  #[test]
  fn topics_match_by_what_they_are_about() {
    assert_eq!(closeness("Binary, hexadecimal, number representations", "Hexadecimal and binary"), 1.0);
    assert!(closeness("Two's complement and binary numbers", "Binary, hexadecimal, number representations") >= 0.5);
    assert_eq!(closeness("BigQuery", "Binary numbers"), 0.0);
    assert_eq!(closeness("Pointers in C", "C"), 0.0); // one-letter names are too short to tell topics apart on their own
  }
}
