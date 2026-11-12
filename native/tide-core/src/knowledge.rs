//! Knowledge: one picture of what the learner knows. Concepts (roadmap topics, lesson topics and
//! the steps of a lesson's plan), the evidence on each (taught, answered, recalled), and from that
//! an estimate of how solid each one is today. One plain file in the vault, .tide/knowledge.json,
//! loaded once and held in memory; every query is a pass over a few thousand small records.
//!
//! The forgetting model is FSRS-6 with its default parameters, the same model and crate the recall
//! schedule uses (recall.rs). Each concept carries an FSRS memory state, worked out by replaying
//! its evidence in the order it happened:
//!
//!   stability S, in days: how long until the chance of remembering it falls to 90%
//!   difficulty D, 1 to 10: how hard it is to make stick
//!
//! Every marked answer is a review: right and recalled right are "good", partly right is "hard",
//! wrong, couldn't answer and recalled wrong are "again". Being taught is not a review (nothing
//! was asked); it only says the concept has been met. A review's weight (a placement check counts
//! for less than an answer in a lesson, a flashcard for less again) takes it part of the way from
//! the state before to the state FSRS gives: log S and D move by that share. FSRS knows how long it
//! really was since the last review, so three right answers in one sitting hardly move S, and a
//! right answer after weeks moves it a long way.
//!
//!   retrievability R(t) = (1 + F t / S) ^ -decay,   F = 0.9 ^ (-1 / decay) - 1
//!
//! t is the days since the last review; R is 0.9 when t = S. The estimate shown for a concept is R,
//! and after a miss R scaled by how its latest answers went (see `estimate`).
//!
//! Status: "new" with no evidence; "solid" while R is 0.85 or more and the last answer was right;
//! "fading" when the last answer was right but time has taken R below 0.85, where it keeps falling
//! until the concept is reviewed; "learning" otherwise (taught but never asked, or the last answer
//! wasn't right: FSRS treats a miss as relearnt at once, but it isn't solid until it is shown).
//! A concept that has only been taught has no memory state, and an estimate of 0.
//!
//! The file keeps the evidence, never the derived state, so a store written by the earlier model
//! (a level and a half-life from the same evidence) is read as it is and replayed through this one;
//! the first save under this model keeps a copy of the earlier file beside it, once.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use fsrs::{MemoryState, FSRS, FSRS6_DEFAULT_DECAY, FSRS6_DEFAULT_PARAMETERS};

use crate::recall::{words, DESIRED_RETENTION};

const DAY_MS: f64 = 86_400_000.0;
/// The retrievability at or above which a concept counts as solid
pub const SOLID: f64 = 0.85;
/// The file's version: 2 since the forgetting model is FSRS (the evidence in it is the same)
const VERSION: u32 = 2;
const DECAY: f64 = FSRS6_DEFAULT_DECAY as f64;
/// An answer counts towards retention when the concept was first met at least this long before, in another sitting
const RETURN_MS: f64 = 12.0 * 3_600_000.0;

fn is_false(b: &bool) -> bool {
  !*b
}

#[derive(Clone, Serialize, Deserialize)]
struct Evidence {
  /// Where it came from ("lesson:<id>", "recall:<id>", "attempt:<time>") and its place there
  source: String,
  pos: String,
  /// taught, right, partly, wrong, stuck, recalled-right, recalled-wrong
  kind: String,
  at: f64,
  weight: f64,
  /// From a private project: counted only for a reader on this Mac
  #[serde(default, skip_serializing_if = "is_false")]
  private: bool,
  /// The key (source#pos) of evidence this one stands in place of, which is then never kept
  #[serde(default, skip_serializing_if = "Option::is_none")]
  supersedes: Option<String>,
}

fn key(source: &str, pos: &str) -> String {
  format!("{source}#{pos}")
}

#[derive(Clone, Serialize, Deserialize)]
struct Concept {
  id: String,
  name: String,
  /// The notebook or roadmap it belongs to; empty when it belongs to none
  area: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  section: Option<String>,
  /// For a step of a lesson's plan: the topic it is part of
  #[serde(default, skip_serializing_if = "Option::is_none")]
  parent: Option<String>,
  /// roadmap, lesson or step
  origin: String,
  #[serde(default)]
  order: u32,
  #[serde(default)]
  prerequisites: Vec<String>,
  /// Ticked on the roadmap by the learner
  #[serde(default, skip_serializing_if = "is_false")]
  done: bool,
  #[serde(default, skip_serializing_if = "is_false")]
  private: bool,
  #[serde(default)]
  evidence: Vec<Evidence>,
}

#[derive(Deserialize)]
struct FileIn {
  #[serde(default = "first_version")]
  version: u32,
  concepts: Vec<Concept>,
  #[serde(default)]
  filled: Vec<String>,
}

fn first_version() -> u32 {
  1
}

#[derive(Serialize)]
struct FileOut<'a> {
  version: u32,
  /// The forgetting model the estimates are worked out with (never stored: replayed from the evidence)
  model: &'static str,
  concepts: Vec<&'a Concept>,
  /// Earlier records read in once each (the review log's flashcards, say), so they are never read twice
  #[serde(skip_serializing_if = "Vec::is_empty")]
  filled: Vec<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ConceptIn {
  pub id: String,
  pub name: String,
  pub area: String,
  pub section: Option<String>,
  pub parent: Option<String>,
  /// "roadmap", "lesson" or "step"
  pub origin: String,
  pub order: u32,
  pub prerequisites: Vec<String>,
  pub done: Option<bool>,
  pub private: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct EvidenceIn {
  pub concept: String,
  pub source: String,
  pub pos: String,
  pub kind: String,
  pub at: f64,
  pub weight: f64,
  pub private: Option<bool>,
  pub supersedes: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ConceptState {
  pub id: String,
  pub name: String,
  pub area: String,
  pub section: Option<String>,
  pub parent: Option<String>,
  pub origin: String,
  pub order: u32,
  pub prerequisites: Vec<String>,
  pub done: bool,
  pub private: bool,
  /// How solid it is now, 0 to 1: FSRS retrievability, the chance of remembering it today
  pub estimate: f64,
  /// What it stood at after the last answer, before any forgetting: 1 when that answer was right
  pub level: f64,
  /// Days from the last review for R to halve when unused
  pub half_life: f64,
  /// FSRS stability (days for R to fall to 90%) and difficulty (1 to 10); none until something is asked
  pub stability: Option<f64>,
  pub difficulty: Option<f64>,
  /// new, learning, solid or fading
  pub status: String,
  pub last_seen: Option<f64>,
  pub last_right: Option<f64>,
  /// Every piece of evidence, being taught included
  pub seen: u32,
  pub right: u32,
  pub partly: u32,
  /// Wrong, or couldn't answer
  pub wrong: u32,
  /// For a solid concept: days until it stops being solid if it isn't used
  pub fades_in: Option<f64>,
  /// For a solid concept: when it stops being solid if it isn't used (ms)
  pub fades_at: Option<f64>,
  /// The first evidence on it (ms)
  pub first_seen: Option<f64>,
  /// When it first became solid (ms): the moment it was learnt, whatever has happened since
  pub made_solid: Option<f64>,
}

#[napi(object)]
pub struct Picture {
  /// The concept with this very name, when there is one
  pub topic: Option<ConceptState>,
  /// Around it and solid, the most solid first
  pub solid: Vec<ConceptState>,
  /// Around it and begun but not solid, or fading: the weakest first
  pub shaky: Vec<ConceptState>,
  /// What it builds on that isn't solid yet, the nearest first
  pub prerequisites: Vec<ConceptState>,
}

/// A question that came back: a recall, or an answer on a topic first met in an earlier sitting
#[napi(object)]
pub struct Returned {
  pub at: f64,
  /// 1 right, 0.5 partly right, 0 wrong or not answered
  pub right: f64,
}

/// What a concept's evidence adds up to
#[derive(Clone, Default)]
struct Fold {
  /// The FSRS memory state after the last review; none until something is asked
  memory: Option<MemoryState>,
  last_review: Option<f64>,
  /// The last answer was right: what makes a concept solid while R holds, and fading after
  proven: bool,
  last_right: Option<f64>,
  last_seen: Option<f64>,
  first_seen: Option<f64>,
  made_solid: Option<f64>,
  seen: u32,
  right: u32,
  partly: u32,
  wrong: u32,
  /// The last few ratings, oldest first: how the latest answers went
  recent: Vec<u32>,
}

/// How many of the latest answers count towards a concept's standing after a miss
const RECENT: usize = 4;

thread_local! {
  static MODEL: FSRS = FSRS::new(&FSRS6_DEFAULT_PARAMETERS).expect("the FSRS-6 default parameters are valid");
}

/// The FSRS rating of a kind of evidence: 1 again, 2 hard, 3 good; none for being taught
fn rating(kind: &str) -> Option<u32> {
  match kind {
    "right" | "recalled-right" => Some(3),
    "partly" => Some(2),
    "wrong" | "stuck" | "recalled-wrong" => Some(1),
    _ => None,
  }
}

/// One review through FSRS-6, `weight` of the way from the state before to the one it gives
fn review(model: &FSRS, before: Option<MemoryState>, rating: u32, elapsed_days: f64, weight: f64) -> Option<MemoryState> {
  let pick = |s: Option<MemoryState>, r: u32, el: f64| {
    model.next_states_with_elapsed_days(s, DESIRED_RETENTION, el.max(0.0) as f32).ok().map(|n| match r {
      1 => n.again.memory,
      2 => n.hard.memory,
      4 => n.easy.memory,
      _ => n.good.memory,
    })
  };
  let full = pick(before, rating, elapsed_days)?;
  if weight >= 1.0 {
    return Some(full);
  }
  // A first review that counts for less starts part of the way from a first miss
  let from = match before {
    Some(s) => s,
    None => pick(None, 1, 0.0)?,
  };
  let w = weight.clamp(0.0, 1.0) as f32;
  let stability = (from.stability.ln() + w * (full.stability.ln() - from.stability.ln())).exp();
  let difficulty = from.difficulty + w * (full.difficulty - from.difficulty);
  Some(MemoryState { stability, difficulty, stability_fast: stability })
}

/// FSRS-6's forgetting curve: the chance of remembering after `days` at stability `s` (in fractions of a day)
pub fn retrievability(s: f64, days: f64) -> f64 {
  let factor = 0.9_f64.powf(-1.0 / DECAY) - 1.0;
  (1.0 + factor * days.max(0.0) / s.max(1e-6)).powf(-DECAY)
}

/// The days after a review at which R falls to `r`
fn days_to(s: f64, r: f64) -> f64 {
  let factor = 0.9_f64.powf(-1.0 / DECAY) - 1.0;
  s * (r.powf(-1.0 / DECAY) - 1.0) / factor
}

/// Replays evidence (oldest first) through the model described at the top of this file
fn fold<'a>(events: impl Iterator<Item = &'a Evidence>) -> Fold {
  MODEL.with(|model| {
    let mut f = Fold::default();
    for e in events {
      let w = e.weight.clamp(0.0, 1.0);
      match rating(&e.kind) {
        None if e.kind == "taught" => {}
        None => continue,
        Some(r) => {
          let elapsed = f.last_review.map_or(0.0, |t| (e.at - t) / DAY_MS);
          if let Some(next) = review(model, f.memory, r, elapsed, w) {
            f.memory = Some(next);
          }
          f.last_review = Some(e.at);
          f.proven = r == 3;
          f.recent.push(r);
          if f.recent.len() > RECENT {
            f.recent.remove(0);
          }
          match r {
            3 => {
              f.right += 1;
              f.last_right = Some(e.at);
            }
            2 => f.partly += 1,
            _ => f.wrong += 1,
          }
        }
      }
      f.seen += 1;
      f.last_seen = Some(e.at);
      f.first_seen.get_or_insert(e.at);
      if f.made_solid.is_none() && status(&f, e.at) == "solid" {
        f.made_solid = Some(e.at);
      }
    }
    f
  })
}

/// R at `now`: the chance of remembering it, from its memory state and the time since the last review
fn retention(f: &Fold, now: f64) -> f64 {
  match (f.memory, f.last_review) {
    (Some(m), Some(t)) => retrievability(m.stability as f64, (now - t) / DAY_MS),
    _ => 0.0,
  }
}

/// How solid it is now, as shown. While the last answer was right that is R. After a miss FSRS
/// counts the idea as relearnt on the spot, so R is back near 1 within the hour: shown as it is,
/// a concept you had just forgotten read "You hold this at 100%". So after a miss R is scaled by
/// how the latest answers went (right 1, partly 0.5, a miss 0), and climbs back as they come right.
fn estimate(f: &Fold, now: f64) -> f64 {
  let r = retention(f, now);
  if f.proven || f.recent.is_empty() {
    return r;
  }
  let share = f.recent.iter().map(|x| match x {
    3 | 4 => 1.0,
    2 => 0.5,
    _ => 0.0,
  });
  r * share.sum::<f64>() / f.recent.len() as f64
}

fn status(f: &Fold, now: f64) -> &'static str {
  if f.seen == 0 {
    "new"
  } else if f.proven && estimate(f, now) >= SOLID {
    "solid"
  } else if f.proven {
    "fading"
  } else {
    "learning"
  }
}

/// Days until a solid concept's R falls to the line, if it isn't used
fn fades_in(f: &Fold, now: f64) -> Option<f64> {
  let (m, t) = (f.memory?, f.last_review?);
  (status(f, now) == "solid").then(|| days_to(m.stability as f64, SOLID) - (now - t).max(0.0) / DAY_MS)
}

/// The order evidence is replayed in: by time; at the same moment, being taught comes before the
/// answers, and the answers in the order they were asked ("q2" before "q10")
fn in_order(a: &Evidence, b: &Evidence) -> std::cmp::Ordering {
  let place = |e: &Evidence| (e.kind != "taught", e.pos.trim_start_matches(|c: char| !c.is_ascii_digit()).parse::<u32>().unwrap_or(0));
  a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal).then_with(|| place(a).cmp(&place(b))).then_with(|| a.pos.cmp(&b.pos))
}

/// A name as it is matched: lower case, letters and digits only
fn normal(name: &str) -> String {
  name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

fn overlap(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
  if a.is_empty() || b.is_empty() {
    return 0.0;
  }
  a.intersection(b).count() as f64 / a.len().min(b.len()) as f64
}

struct Entry {
  c: Concept,
  norm: String,
  words: HashSet<String>,
  /// From all its evidence, and from what isn't private
  all: Fold,
  open: Fold,
}

impl Entry {
  fn new(mut c: Concept) -> Entry {
    c.evidence.sort_by(in_order);
    let mut e = Entry { norm: normal(&c.name), words: words(&c.name), all: Fold::default(), open: Fold::default(), c };
    e.refold();
    e
  }

  fn refold(&mut self) {
    self.c.evidence.sort_by(in_order);
    self.all = fold(self.c.evidence.iter());
    self.open = fold(self.c.evidence.iter().filter(|e| !e.private));
  }

  fn seen_by(&self, private_ok: bool) -> &Fold {
    if private_ok { &self.all } else { &self.open }
  }

  fn state(&self, now: f64, private_ok: bool) -> ConceptState {
    let f = self.seen_by(private_ok);
    let c = &self.c;
    ConceptState {
      id: c.id.clone(),
      name: c.name.clone(),
      area: c.area.clone(),
      section: c.section.clone(),
      parent: c.parent.clone(),
      origin: c.origin.clone(),
      order: c.order,
      prerequisites: c.prerequisites.clone(),
      done: c.done,
      private: c.private,
      estimate: estimate(f, now),
      level: if f.proven { 1.0 } else { estimate(f, now) },
      half_life: f.memory.map_or(0.0, |m| days_to(m.stability as f64, 0.5)),
      stability: f.memory.map(|m| m.stability as f64),
      difficulty: f.memory.map(|m| m.difficulty as f64),
      status: status(f, now).to_string(),
      last_seen: f.last_seen,
      last_right: f.last_right,
      seen: f.seen,
      right: f.right,
      partly: f.partly,
      wrong: f.wrong,
      fades_in: fades_in(f, now),
      fades_at: fades_in(f, now).map(|d| now + d * DAY_MS),
      first_seen: f.first_seen,
      made_solid: f.made_solid,
    }
  }

  /// Safe to build on: solid, or ticked on the roadmap with nothing against it (the learner's
  /// word stands until an answer that wasn't right, or forgetting, says otherwise)
  fn settled(&self, now: f64, private_ok: bool) -> bool {
    let f = self.seen_by(private_ok);
    let s = status(f, now);
    s == "solid" || (self.c.done && s != "fading" && f.wrong == 0 && f.partly == 0)
  }
}

/// The store itself, free of Node so the tests run the code the app does
pub struct Store {
  path: PathBuf,
  existed: bool,
  /// The version the file was written in, when it was there
  version: u32,
  filled: Vec<String>,
  entries: Vec<Entry>,
  by_id: HashMap<String, usize>,
  /// Evidence key -> the concept holding it
  keys: HashMap<String, usize>,
  superseded: HashSet<String>,
}

impl Store {
  pub fn open(path: PathBuf) -> std::result::Result<Store, String> {
    let (existed, file) = match std::fs::read(&path) {
      Ok(bytes) => (true, serde_json::from_slice::<FileIn>(&bytes).map_err(|e| format!("{} is not a knowledge file: {e}", path.display()))?),
      Err(_) => (false, FileIn { version: VERSION, concepts: Vec::new(), filled: Vec::new() }),
    };
    let mut s = Store { path, existed, version: file.version, filled: file.filled, entries: file.concepts.into_iter().map(Entry::new).collect(), by_id: HashMap::new(), keys: HashMap::new(), superseded: HashSet::new() };
    s.reindex();
    Ok(s)
  }

  fn reindex(&mut self) {
    self.by_id = self.entries.iter().enumerate().map(|(i, e)| (e.c.id.clone(), i)).collect();
    self.keys.clear();
    self.superseded.clear();
    for (i, e) in self.entries.iter().enumerate() {
      for ev in &e.c.evidence {
        self.keys.insert(key(&ev.source, &ev.pos), i);
        if let Some(s) = &ev.supersedes {
          self.superseded.insert(s.clone());
        }
      }
    }
  }

  /// Written beside itself and renamed, so a crash never leaves half a file
  pub fn save(&mut self) -> std::result::Result<(), String> {
    if let Some(dir) = self.path.parent() {
      std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // A file from an earlier model is kept as it was, once, before it is first written in this one
    if self.existed && self.version < VERSION {
      let copy = self.earlier_copy();
      if !copy.exists() {
        std::fs::copy(&self.path, &copy).map_err(|e| e.to_string())?;
      }
    }
    let out = FileOut { version: VERSION, model: "fsrs-6", concepts: self.entries.iter().map(|e| &e.c).collect(), filled: self.filled.clone() };
    let tmp = self.path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&out).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
    self.existed = true;
    self.version = VERSION;
    Ok(())
  }

  /// Where the copy of a file written by an earlier model goes: knowledge.v1.json beside it
  fn earlier_copy(&self) -> PathBuf {
    self.path.with_extension(format!("v{}.json", self.version))
  }

  /// Whether earlier records of this kind have been read in
  pub fn is_filled(&self, what: &str) -> bool {
    self.filled.iter().any(|f| f == what)
  }

  /// Marks earlier records of this kind as read in, and saves
  pub fn mark_filled(&mut self, what: &str) -> std::result::Result<(), String> {
    if !self.is_filled(what) {
      self.filled.push(what.to_string());
    }
    self.save()
  }

  /// Adds a concept or brings it up to date; true when anything changed. A roadmap topic stays one whoever names it again.
  fn put(&mut self, n: ConceptIn) -> bool {
    let (done, private) = (n.done.unwrap_or(false), n.private.unwrap_or(false));
    if let Some(&i) = self.by_id.get(&n.id) {
      let e = &mut self.entries[i];
      let origin = if e.c.origin == "roadmap" { "roadmap".to_string() } else { n.origin };
      let c = &e.c;
      if c.name == n.name && c.area == n.area && c.section == n.section && c.parent == n.parent && c.origin == origin && c.order == n.order && c.prerequisites == n.prerequisites && c.done == done && c.private == private {
        return false;
      }
      if c.name != n.name {
        e.norm = normal(&n.name);
        e.words = words(&n.name);
      }
      let c = &mut e.c;
      c.name = n.name;
      c.area = n.area;
      c.section = n.section;
      c.parent = n.parent;
      c.origin = origin;
      c.order = n.order;
      c.prerequisites = n.prerequisites;
      c.done = done;
      c.private = private;
      return true;
    }
    self.by_id.insert(n.id.clone(), self.entries.len());
    self.entries.push(Entry::new(Concept { id: n.id, name: n.name, area: n.area, section: n.section, parent: n.parent, origin: n.origin, order: n.order, prerequisites: n.prerequisites, done, private, evidence: Vec::new() }));
    true
  }

  /// Adds or updates concepts. The same list twice changes nothing. Returns how many were new or changed.
  pub fn upsert(&mut self, concepts: Vec<ConceptIn>) -> std::result::Result<u32, String> {
    let changed = concepts.into_iter().map(|c| self.put(c)).filter(|c| *c).count() as u32;
    if changed > 0 {
      self.save()?;
    }
    Ok(changed)
  }

  /// A roadmap as it is now: its topics added or updated, and the topics it no longer has dropped
  /// (kept as lesson topics, without their place in it, when there is evidence on them).
  pub fn sync_roadmap(&mut self, area: &str, concepts: Vec<ConceptIn>) -> std::result::Result<u32, String> {
    let ids: HashSet<String> = concepts.iter().map(|c| c.id.clone()).collect();
    let mut changed = concepts.into_iter().map(|c| self.put(c)).filter(|c| *c).count() as u32;
    let before = self.entries.len();
    self.entries.retain(|e| !(e.c.origin == "roadmap" && e.c.area == area && !ids.contains(&e.c.id) && e.c.evidence.is_empty()));
    for e in self.entries.iter_mut().filter(|e| e.c.origin == "roadmap" && e.c.area == area && !ids.contains(&e.c.id)) {
      e.c.origin = "lesson".into();
      e.c.section = None;
      e.c.prerequisites.clear();
      e.c.done = false;
      changed += 1;
    }
    changed += (before - self.entries.len()) as u32;
    if changed > 0 {
      self.reindex();
      self.save()?;
    }
    Ok(changed)
  }

  /// Keeps evidence, each piece once: the same source and position again replaces what was there
  /// (and keeps the earlier time), so a lesson saved twice counts once. With `replace`, whatever
  /// else was kept from the sources named here is dropped, so a source can also take evidence back.
  /// Returns how many pieces were added, changed or dropped.
  pub fn record(&mut self, events: Vec<EvidenceIn>, replace: bool) -> std::result::Result<u32, String> {
    let mut changed = 0u32;
    let mut touched: HashSet<usize> = HashSet::new();
    if replace {
      let mut keep: HashMap<&str, HashSet<String>> = HashMap::new();
      for e in &events {
        keep.entry(e.source.as_str()).or_default().insert(key(&e.source, &e.pos));
      }
      for (i, entry) in self.entries.iter_mut().enumerate() {
        let before = entry.c.evidence.len();
        entry.c.evidence.retain(|e| keep.get(e.source.as_str()).is_none_or(|k| k.contains(&key(&e.source, &e.pos))));
        if entry.c.evidence.len() != before {
          changed += (before - entry.c.evidence.len()) as u32;
          touched.insert(i);
        }
      }
      if changed > 0 {
        self.reindex();
      }
    }
    for e in events {
      let k = key(&e.source, &e.pos);
      let Some(&to) = self.by_id.get(&e.concept) else { continue };
      if self.superseded.contains(&k) {
        continue;
      }
      let private = e.private.unwrap_or(false);
      let mut at = e.at;
      if let Some(&from) = self.keys.get(&k) {
        let list = &mut self.entries[from].c.evidence;
        if let Some(p) = list.iter().position(|x| x.source == e.source && x.pos == e.pos) {
          let old = &list[p];
          at = at.min(old.at);
          if from == to && old.kind == e.kind && old.weight == e.weight && old.private == private && old.supersedes == e.supersedes {
            continue;
          }
          list.remove(p);
          touched.insert(from);
        }
      }
      if let Some(s) = &e.supersedes {
        self.superseded.insert(s.clone());
        if let Some(from) = self.keys.remove(s) {
          self.entries[from].c.evidence.retain(|x| key(&x.source, &x.pos) != *s);
          touched.insert(from);
        }
      }
      self.entries[to].c.evidence.push(Evidence { source: e.source, pos: e.pos, kind: e.kind, at, weight: e.weight, private, supersedes: e.supersedes });
      self.keys.insert(k, to);
      touched.insert(to);
      changed += 1;
    }
    for i in touched {
      self.entries[i].refold();
    }
    if changed > 0 {
      // A plan step nothing was taught or asked on is not yet something they know anything about
      let before = self.entries.len();
      self.entries.retain(|e| !(e.c.origin == "step" && e.c.evidence.is_empty()));
      if self.entries.len() != before {
        self.reindex();
      }
      self.save()?;
    }
    Ok(changed)
  }

  /// The concept with this name (whatever the case or punctuation), else the one whose name says
  /// the same words (plurals and words like "introduction to" aside): in `area` first, a roadmap
  /// topic first. Never a plan step.
  pub fn resolve(&self, name: &str, area: Option<&str>) -> Option<String> {
    let n = normal(name);
    if n.is_empty() {
      return None;
    }
    let best = |hit: &dyn Fn(&Entry) -> bool| {
      self
        .entries
        .iter()
        .filter(|e| e.c.parent.is_none() && hit(e))
        .min_by_key(|e| (area != Some(e.c.area.as_str()), e.c.origin != "roadmap", e.c.order))
        .map(|e| e.c.id.clone())
    };
    let w = words(name);
    best(&|e| e.norm == n).or_else(|| if w.is_empty() { None } else { best(&|e| e.words == w) })
  }

  fn visible(&self, private_ok: bool) -> impl Iterator<Item = (usize, &Entry)> {
    self.entries.iter().enumerate().filter(move |(_, e)| private_ok || !e.c.private)
  }

  pub fn state(&self, id: &str, now: f64, private_ok: bool) -> Option<ConceptState> {
    let e = &self.entries[*self.by_id.get(id)?];
    (private_ok || !e.c.private).then(|| e.state(now, private_ok))
  }

  pub fn all(&self, now: f64, private_ok: bool) -> Vec<ConceptState> {
    self.visible(private_ok).map(|(_, e)| e.state(now, private_ok)).collect()
  }

  /// The picture around a topic: the concepts whose names share its words, what they build on
  /// (two links back) and their plan steps, sorted into solid, shaky and prerequisites not yet solid.
  pub fn around(&self, topic: &str, now: f64, private_ok: bool, limit: usize) -> Picture {
    let (n, tw) = (normal(topic), words(topic));
    let mut close: Vec<(f64, usize)> = self
      .visible(private_ok)
      .filter_map(|(i, e)| {
        let s = if e.norm == n { 2.0 } else { overlap(&tw, &e.words) };
        (s >= 0.5).then_some((s, i))
      })
      .collect();
    close.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then_with(|| self.entries[a.1].c.parent.is_some().cmp(&self.entries[b.1].c.parent.is_some())).then_with(|| self.entries[a.1].c.order.cmp(&self.entries[b.1].c.order)));
    let exact = close.first().filter(|c| c.0 == 2.0).map(|c| c.1);
    let centres: Vec<usize> = close.iter().filter(|c| exact.is_none() || c.0 == 2.0).take(3).map(|c| c.1).collect();

    // What the centres build on, nearest first
    let mut prereqs: Vec<usize> = Vec::new();
    let mut edge = centres.clone();
    for _ in 0..2 {
      let mut next = Vec::new();
      for &i in &edge {
        for p in &self.entries[i].c.prerequisites {
          if let Some(&j) = self.by_id.get(p) {
            if !centres.contains(&j) && !prereqs.contains(&j) && (private_ok || !self.entries[j].c.private) {
              prereqs.push(j);
              next.push(j);
            }
          }
        }
      }
      edge = next;
    }
    let centre_ids: HashSet<&str> = centres.iter().map(|&i| self.entries[i].c.id.as_str()).collect();
    let steps = self.visible(private_ok).filter(|(_, e)| e.c.parent.as_deref().is_some_and(|p| centre_ids.contains(p))).map(|(i, _)| i);
    let mut around: Vec<usize> = Vec::new();
    for i in close.iter().map(|c| c.1).take(limit * 4).chain(steps) {
      if Some(i) != exact && !prereqs.contains(&i) && !around.contains(&i) {
        around.push(i);
      }
    }

    let mut p = Picture { topic: exact.map(|i| self.entries[i].state(now, private_ok)), solid: Vec::new(), shaky: Vec::new(), prerequisites: Vec::new() };
    for i in prereqs {
      let e = &self.entries[i];
      if !e.settled(now, private_ok) {
        p.prerequisites.push(e.state(now, private_ok));
      } else if status(e.seen_by(private_ok), now) == "solid" {
        p.solid.push(e.state(now, private_ok));
      }
    }
    for i in around {
      let s = self.entries[i].state(now, private_ok);
      match s.status.as_str() {
        "solid" => p.solid.push(s),
        "learning" | "fading" => p.shaky.push(s),
        _ => {}
      }
    }
    p.solid.sort_by(|a, b| b.estimate.partial_cmp(&a.estimate).unwrap());
    p.shaky.sort_by(|a, b| a.estimate.partial_cmp(&b.estimate).unwrap());
    p.solid.truncate(limit);
    p.shaky.truncate(limit);
    p.prerequisites.truncate(limit);
    p
  }

  /// Ready to learn next: not solid (nor ticked with nothing against it), not something already known
  /// and slipping (that is for `fading`), and everything it builds on is safe to build on.
  /// What is already begun comes first, then what carries a chain on, in roadmap order.
  pub fn ready(&self, area: Option<&str>, now: f64, private_ok: bool, limit: usize) -> Vec<ConceptState> {
    let mut found: Vec<(bool, bool, usize, &Entry)> = self
      .visible(private_ok)
      .filter(|(_, e)| e.c.parent.is_none() && area.is_none_or(|a| a == e.c.area))
      .filter(|(_, e)| !e.settled(now, private_ok) && status(e.seen_by(private_ok), now) != "fading")
      .filter(|(_, e)| e.c.prerequisites.iter().all(|p| self.by_id.get(p).is_none_or(|&j| self.entries[j].settled(now, private_ok))))
      .map(|(i, e)| (e.seen_by(private_ok).seen == 0, e.c.prerequisites.is_empty(), i, e))
      .collect();
    found.sort_by(|a, b| (a.0, a.1, a.3.c.area.as_str(), a.3.c.order, a.2).cmp(&(b.0, b.1, b.3.c.area.as_str(), b.3.c.order, b.2)));
    found.into_iter().take(limit).map(|f| f.3.state(now, private_ok)).collect()
  }

  /// The solid concepts that will stop being solid soonest if they aren't used
  pub fn fading(&self, area: Option<&str>, now: f64, private_ok: bool, limit: usize) -> Vec<ConceptState> {
    let mut found: Vec<ConceptState> = self
      .visible(private_ok)
      .filter(|(_, e)| e.c.parent.is_none() && area.is_none_or(|a| a == e.c.area))
      .map(|(_, e)| e.state(now, private_ok))
      .filter(|s| s.fades_in.is_some())
      .collect();
    found.sort_by(|a, b| a.fades_in.partial_cmp(&b.fades_in).unwrap());
    found.truncate(limit);
    found
  }

  /// Every question that came back, oldest first: a recall, or an answer on a topic first met at
  /// least half a day before in another sitting. Not flashcards: the review log has those. Topics only, not their plan steps. Put into weeks
  /// by the caller, which knows the learner's calendar (time zone and clock changes included).
  pub fn returns(&self, private_ok: bool) -> Vec<Returned> {
    let mut out = Vec::new();
    for (_, e) in self.visible(private_ok).filter(|(_, e)| e.c.parent.is_none()) {
      // The earliest evidence, and the earliest from any other source than that
      let mut one: Option<(f64, &str)> = None;
      let mut two: Option<(f64, &str)> = None;
      for ev in e.c.evidence.iter().filter(|ev| private_ok || !ev.private) {
        // A flashcard's return is counted from the review log, where every card is, matched to a topic or not
        if ev.source.starts_with("card:") {
          continue;
        }
        let came_back = ev.kind.starts_with("recalled-") || [one, two].iter().flatten().any(|(t, s)| *s != ev.source && *t <= ev.at - RETURN_MS);
        let credit = match ev.kind.as_str() {
          "right" | "recalled-right" => Some(1.0),
          "partly" => Some(0.5),
          "wrong" | "stuck" | "recalled-wrong" => Some(0.0),
          _ => None,
        };
        if let (true, Some(c)) = (came_back, credit) {
          out.push(Returned { at: ev.at, right: c });
        }
        match one {
          None => one = Some((ev.at, &ev.source)),
          Some((_, s)) if s != ev.source && two.is_none() => two = Some((ev.at, &ev.source)),
          _ => {}
        }
      }
    }
    out.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
    out
  }
}

fn err<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
}

#[napi]
pub struct Knowledge {
  store: Mutex<Store>,
}

#[napi]
impl Knowledge {
  /// Opens the store at `path` (a JSON file), empty when it isn't there yet
  #[napi(constructor)]
  pub fn new(path: String) -> Result<Self> {
    Ok(Knowledge { store: Mutex::new(Store::open(PathBuf::from(path)).map_err(err)?) })
  }

  /// Whether the file is there: false until something is first saved, which is when earlier records are read in
  #[napi]
  pub fn existed(&self) -> Result<bool> {
    Ok(self.store.lock().map_err(err)?.existed)
  }

  /// Writes the file as it is now (even when empty, so the first read-in happens once)
  #[napi]
  pub fn flush(&self) -> Result<()> {
    self.store.lock().map_err(err)?.save().map_err(err)
  }

  #[napi]
  pub fn size(&self) -> Result<u32> {
    Ok(self.store.lock().map_err(err)?.entries.len() as u32)
  }

  #[napi]
  pub fn upsert(&self, concepts: Vec<ConceptIn>) -> Result<u32> {
    self.store.lock().map_err(err)?.upsert(concepts).map_err(err)
  }

  #[napi]
  pub fn sync_roadmap(&self, area: String, concepts: Vec<ConceptIn>) -> Result<u32> {
    self.store.lock().map_err(err)?.sync_roadmap(&area, concepts).map_err(err)
  }

  #[napi]
  pub fn record(&self, events: Vec<EvidenceIn>, replace: Option<bool>) -> Result<u32> {
    self.store.lock().map_err(err)?.record(events, replace.unwrap_or(false)).map_err(err)
  }

  #[napi]
  pub fn resolve(&self, name: String, area: Option<String>) -> Result<Option<String>> {
    Ok(self.store.lock().map_err(err)?.resolve(&name, area.as_deref()))
  }

  #[napi]
  pub fn state(&self, id: String, now: f64, private_ok: bool) -> Result<Option<ConceptState>> {
    Ok(self.store.lock().map_err(err)?.state(&id, now, private_ok))
  }

  #[napi]
  pub fn all(&self, now: f64, private_ok: bool) -> Result<Vec<ConceptState>> {
    Ok(self.store.lock().map_err(err)?.all(now, private_ok))
  }

  #[napi]
  pub fn around(&self, topic: String, now: f64, private_ok: bool, limit: u32) -> Result<Picture> {
    Ok(self.store.lock().map_err(err)?.around(&topic, now, private_ok, limit as usize))
  }

  #[napi]
  pub fn ready(&self, area: Option<String>, now: f64, private_ok: bool, limit: u32) -> Result<Vec<ConceptState>> {
    Ok(self.store.lock().map_err(err)?.ready(area.as_deref(), now, private_ok, limit as usize))
  }

  #[napi]
  pub fn fading(&self, area: Option<String>, now: f64, private_ok: bool, limit: u32) -> Result<Vec<ConceptState>> {
    Ok(self.store.lock().map_err(err)?.fading(area.as_deref(), now, private_ok, limit as usize))
  }

  #[napi]
  pub fn returns(&self, private_ok: bool) -> Result<Vec<Returned>> {
    Ok(self.store.lock().map_err(err)?.returns(private_ok))
  }

  /// Whether earlier records of this kind (a name the caller chooses) have been read in
  #[napi]
  pub fn filled(&self, what: String) -> Result<bool> {
    Ok(self.store.lock().map_err(err)?.is_filled(&what))
  }

  #[napi]
  pub fn mark_filled(&self, what: String) -> Result<()> {
    self.store.lock().map_err(err)?.mark_filled(&what).map_err(err)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const T0: f64 = 1_762_732_800_000.0; // Monday 10 November 2025, 00:00 UTC
  const HOUR: f64 = 3_600_000.0;

  fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path().join(".tide").join("knowledge.json")).unwrap();
    (dir, s)
  }

  fn concept(id: &str, name: &str, area: &str, order: u32, needs: &[&str]) -> ConceptIn {
    ConceptIn { id: id.into(), name: name.into(), area: area.into(), section: None, parent: None, origin: "roadmap".into(), order, prerequisites: needs.iter().map(|s| s.to_string()).collect(), done: None, private: None }
  }

  fn ev(concept: &str, source: &str, pos: &str, kind: &str, at: f64) -> EvidenceIn {
    EvidenceIn { concept: concept.into(), source: source.into(), pos: pos.into(), kind: kind.into(), at, weight: 1.0, private: None, supersedes: None }
  }

  fn one(kind: &str, at: f64) -> Evidence {
    Evidence { source: format!("s{at}"), pos: "0".into(), kind: kind.into(), at, weight: 1.0, private: false, supersedes: None }
  }

  /// Taught, then answered right twice in the sitting: enough to be solid that day
  fn learn(s: &mut Store, id: &str, at: f64) {
    let src = format!("lesson:{id}");
    s.record(vec![ev(id, &src, "taught", "taught", at), ev(id, &src, "q0", "right", at + 60_000.0), ev(id, &src, "q1", "right", at + 120_000.0)], false).unwrap();
  }

  /// The FSRS-6 state recall.rs would reach for the same ratings at the same times
  fn recall_engine(ratings: &[(u32, f64)]) -> (f64, f64) {
    use crate::recall::{schedule, RecallItem, RecallReview};
    let model = FSRS::new(&FSRS6_DEFAULT_PARAMETERS).unwrap();
    let (r0, t0) = ratings[0];
    let first = model.next_states(None, DESIRED_RETENTION, 0).unwrap();
    let m = match r0 {
      1 => first.again.memory,
      2 => first.hard.memory,
      _ => first.good.memory,
    };
    let mut item = RecallItem { id: "x".into(), prompt: String::new(), topic: String::new(), lesson: String::new(), created: t0, due: t0, stability: m.stability as f64, difficulty: m.difficulty as f64, reviews: 0, lapses: 0, last: Some(t0), history: vec![RecallReview { rating: r0, at: t0 }] };
    for &(r, at) in &ratings[1..] {
      schedule(&mut item, &model, r, at);
    }
    (item.stability, item.difficulty)
  }

  #[test]
  fn answers_are_fsrs_reviews_and_being_taught_is_not() {
    // Taught only: met, but nothing asked, so no memory state and nothing to hold
    let taught = fold([one("taught", T0)].iter());
    assert_eq!((taught.seen, taught.memory.is_none()), (1, true));
    assert_eq!(estimate(&taught, T0 + HOUR), 0.0);
    assert_eq!(status(&taught, T0 + HOUR), "learning");

    // A right answer is a "good" review: FSRS-6's first stability for good, w2 days
    let right = fold([one("taught", T0), one("right", T0 + 1.0)].iter());
    let m = right.memory.unwrap();
    assert!((m.stability - FSRS6_DEFAULT_PARAMETERS[2]).abs() < 1e-4);
    // Exactly the state the recall schedule reaches for the same reviews at the same times
    let ratings = [(3, T0), (1, T0 + 2.0 * DAY_MS), (3, T0 + 3.0 * DAY_MS), (2, T0 + 10.0 * DAY_MS), (3, T0 + 30.0 * DAY_MS)];
    let kinds = |r: u32| match r {
      1 => "wrong",
      2 => "partly",
      _ => "right",
    };
    let replayed = fold(ratings.iter().map(|&(r, at)| one(kinds(r), at)).collect::<Vec<_>>().iter()).memory.unwrap();
    let (s, d) = recall_engine(&ratings);
    assert!((replayed.stability as f64 - s).abs() < 1e-3 && (replayed.difficulty as f64 - d).abs() < 1e-3, "{} {} vs {s} {d}", replayed.stability, replayed.difficulty);

    // Partly right is "hard", wrong and couldn't answer are "again": less stability, more difficulty
    let partly = fold([one("partly", T0)].iter()).memory.unwrap();
    let wrong = fold([one("wrong", T0)].iter()).memory.unwrap();
    assert!(wrong.stability < partly.stability && partly.stability < m.stability);
    assert!(wrong.difficulty > partly.difficulty && partly.difficulty > m.difficulty);
    let stuck = fold([one("stuck", T0)].iter()).memory.unwrap();
    assert_eq!(stuck, wrong);

    // A recall that went right is a good review like any other; the time since the last one is what counts
    let lesson_then_recall = fold([one("right", T0), one("recalled-right", T0 + 5.0 * DAY_MS)].iter()).memory.unwrap();
    let lesson_then_answer = fold([one("right", T0), one("right", T0 + 5.0 * DAY_MS)].iter()).memory.unwrap();
    assert_eq!(lesson_then_recall, lesson_then_answer);

    // At the same moment: taught first, then the questions in the order they were asked
    let mut same: Vec<Evidence> = ["q10", "taught", "q2", "q3"].iter().map(|p| Evidence { pos: p.to_string(), kind: if *p == "taught" { "taught".into() } else { "right".into() }, ..one("right", T0) }).collect();
    same.sort_by(in_order);
    assert_eq!(same.iter().map(|e| e.pos.as_str()).collect::<Vec<_>>(), ["taught", "q2", "q3", "q10"]);
    // An unknown kind is ignored, and R never leaves 0..1
    assert_eq!(fold([one("guessed", T0)].iter()).seen, 0);
    let many: Vec<Evidence> = (0..40).map(|i| one("recalled-right", T0 + i as f64 * 30.0 * DAY_MS)).collect();
    let top = fold(many.iter());
    let r = estimate(&top, T0 + 40.0 * 30.0 * DAY_MS);
    assert!(r > 0.0 && r <= 1.0);
  }

  #[test]
  fn a_review_that_counts_for_less_moves_the_state_less() {
    let model = FSRS::new(&FSRS6_DEFAULT_PARAMETERS).unwrap();
    let base = review(&model, None, 3, 0.0, 1.0).unwrap();
    let full = review(&model, Some(base), 3, 6.0, 1.0).unwrap();
    let half = review(&model, Some(base), 3, 6.0, 0.5).unwrap();
    assert!(half.stability > base.stability && half.stability < full.stability);
    // Half the way in log stability: the geometric mean
    assert!(((half.stability as f64) - ((base.stability * full.stability) as f64).sqrt()).abs() < 1e-3);
    // A first review that counts for less starts part of the way from a first miss
    let first = review(&model, None, 3, 0.0, 0.7).unwrap();
    let miss = review(&model, None, 1, 0.0, 1.0).unwrap();
    assert!(first.stability > miss.stability && first.stability < base.stability);
    assert_eq!(review(&model, Some(base), 3, 6.0, 0.0).unwrap().stability, base.stability);
  }

  #[test]
  fn retrievability_is_fsrs_six_and_solid_is_its_85_per_cent_line() {
    // The crate's own curve (its scheduler rounds to whole days; this one doesn't, so the map moves through the day)
    for (s, t) in [(2.3, 0.0), (2.3, 1.0), (2.3, 4.5), (40.0, 90.0), (0.2, 0.5)] {
      let theirs = fsrs::current_retrievability(MemoryState { stability: s as f32, difficulty: 5.0, stability_fast: s as f32 }, t as f32, FSRS6_DEFAULT_DECAY) as f64;
      assert!((retrievability(s, t) - theirs).abs() < 1e-5, "S {s}, t {t}: {} vs {theirs}", retrievability(s, t));
    }
    // R is 0.9 one stability after the review, and the line is crossed where days_to says
    assert!((retrievability(7.0, 7.0) - 0.9).abs() < 1e-9);
    assert!((retrievability(7.0, days_to(7.0, SOLID)) - SOLID).abs() < 1e-9);
    assert_eq!(SOLID, 0.85);
  }

  #[test]
  fn it_fades_with_time_and_more_slowly_once_spaced() {
    // Three right answers in one sitting hardly move stability...
    let crammed = fold([one("right", T0), one("right", T0 + 60_000.0), one("right", T0 + 120_000.0)].iter());
    let once = fold([one("right", T0)].iter());
    assert!(crammed.memory.unwrap().stability < once.memory.unwrap().stability * 1.05);
    // ...the same three a few days apart move it a long way
    let spaced = fold([one("right", T0), one("right", T0 + 3.0 * DAY_MS), one("right", T0 + 9.0 * DAY_MS)].iter());
    assert!(spaced.memory.unwrap().stability > 5.0 * crammed.memory.unwrap().stability);
    assert_eq!(crammed.right, spaced.right);
    let later = 20.0 * DAY_MS;
    assert!(estimate(&spaced, T0 + 9.0 * DAY_MS + later) > estimate(&crammed, T0 + later) + 0.1);

    // Solid while R holds at 0.85, then fading as it falls under; a recall brings it back stronger
    assert_eq!(status(&crammed, T0 + HOUR), "solid");
    let left = fades_in(&crammed, T0 + HOUR).unwrap();
    assert!(left > 3.0 && left < 6.0, "{left}");
    assert_eq!(status(&crammed, T0 + 6.0 * DAY_MS), "fading");
    assert!(estimate(&crammed, T0 + 6.0 * DAY_MS) < SOLID);
    assert!(estimate(&crammed, T0 + 12.0 * DAY_MS) < estimate(&crammed, T0 + 6.0 * DAY_MS), "and keeps falling");
    assert!(fades_in(&crammed, T0 + 6.0 * DAY_MS).is_none());
    let back = fold([one("right", T0), one("right", T0 + 60_000.0), one("right", T0 + 120_000.0), one("recalled-right", T0 + 6.0 * DAY_MS)].iter());
    assert_eq!(status(&back, T0 + 10.0 * DAY_MS), "solid");
    assert!(back.memory.unwrap().stability > 2.0 * crammed.memory.unwrap().stability);
    assert_eq!(status(&Fold::default(), T0), "new");

    // A wrong answer leaves it in progress, however high FSRS puts R once it has been put right;
    // the next right answer makes it solid again
    let missed = fold([one("right", T0), one("right", T0 + 3.0 * DAY_MS), one("wrong", T0 + 4.0 * DAY_MS)].iter());
    assert!(retention(&missed, T0 + 4.0 * DAY_MS + HOUR) > SOLID);
    // What is shown counts the miss: two right and one wrong of the last three, not 100%
    let shown = estimate(&missed, T0 + 4.0 * DAY_MS + HOUR);
    assert!(shown < 0.7 && shown > 0.5, "{shown}");
    assert_eq!(status(&missed, T0 + 4.0 * DAY_MS + HOUR), "learning");
    assert!(fades_in(&missed, T0 + 4.0 * DAY_MS + HOUR).is_none());
    // Seen live: right once, stuck in a lesson, then stuck on the next day's opening recall question.
    // The lesson said "You hold this at 100%"; what it holds now is far less, and each miss lowers it
    let forgot = [one("right", T0), one("stuck", T0 + 2.0 * HOUR), one("right", T0 + 3.0 * HOUR), one("stuck", T0 + 4.0 * HOUR), one("recalled-wrong", T0 + DAY_MS)];
    let before = estimate(&fold(forgot[..4].iter()), T0 + DAY_MS);
    let after = estimate(&fold(forgot.iter()), T0 + DAY_MS + 60_000.0);
    assert!(after < 0.3, "{after}");
    assert!(after < before);
    let fixed = fold([one("right", T0), one("right", T0 + 3.0 * DAY_MS), one("wrong", T0 + 4.0 * DAY_MS), one("right", T0 + 5.0 * DAY_MS)].iter());
    assert_eq!(status(&fixed, T0 + 5.0 * DAY_MS + HOUR), "solid");
    // Partly right isn't shown either
    assert_eq!(status(&fold([one("right", T0), one("partly", T0 + DAY_MS)].iter()), T0 + DAY_MS + HOUR), "learning");
  }

  #[test]
  fn the_same_concepts_and_evidence_twice_count_once() {
    let (_dir, mut s) = store();
    assert!(!s.existed);
    let list = || vec![concept("a", "Hash tables", "Algorithms", 0, &[]), concept("b", "Bloom filters", "Algorithms", 1, &["a"])];
    assert_eq!(s.upsert(list()).unwrap(), 2);
    assert_eq!(s.upsert(list()).unwrap(), 0);
    assert_eq!(s.entries.len(), 2);

    let lesson = || vec![ev("a", "lesson:l1", "taught", "taught", T0), ev("a", "lesson:l1", "q0", "right", T0 + 1.0), ev("a", "lesson:l1", "q1", "wrong", T0 + 2.0)];
    assert_eq!(s.record(lesson(), true).unwrap(), 3);
    let first = s.state("a", T0 + HOUR, true).unwrap();
    assert_eq!(s.record(lesson(), true).unwrap(), 0);
    // Saved again later, as the lesson goes on: what was answered keeps the time it was answered
    let mut again = lesson();
    again.iter_mut().for_each(|e| e.at += HOUR);
    again.push(ev("a", "lesson:l1", "q2", "right", T0 + HOUR));
    assert_eq!(s.record(again, true).unwrap(), 1);
    let second = s.state("a", T0 + HOUR, true).unwrap();
    assert_eq!((first.seen, first.right, first.wrong), (3, 1, 1));
    assert_eq!((second.seen, second.right, second.wrong), (4, 2, 1));
    assert_eq!(s.entries[0].c.evidence[1].at, T0 + 1.0);

    // A mark that changed replaces the old one; a question the record no longer has is taken back
    let changed = vec![ev("a", "lesson:l1", "taught", "taught", T0), ev("a", "lesson:l1", "q0", "partly", T0 + 1.0)];
    s.record(changed, true).unwrap();
    let third = s.state("a", T0 + HOUR, true).unwrap();
    assert_eq!((third.seen, third.right, third.partly, third.wrong), (2, 0, 1, 0));
    // Evidence on a concept that isn't there is left out
    assert_eq!(s.record(vec![ev("nope", "lesson:l2", "q0", "right", T0)], false).unwrap(), 0);

    // A recall question a lesson opened with stands in place of that lesson's first question
    let mut recall = ev("a", "recall:r1", "1", "recalled-right", T0 + 2.0 * DAY_MS);
    recall.supersedes = Some("lesson:l3#q0".into());
    s.record(vec![ev("a", "lesson:l3", "q0", "right", T0 + 2.0 * DAY_MS)], true).unwrap();
    s.record(vec![recall], false).unwrap();
    s.record(vec![ev("a", "lesson:l3", "q0", "right", T0 + 2.0 * DAY_MS), ev("a", "lesson:l3", "q1", "right", T0 + 2.0 * DAY_MS + 5.0)], true).unwrap();
    let kinds: Vec<String> = s.entries[0].c.evidence.iter().filter(|e| e.at >= T0 + DAY_MS).map(|e| format!("{}#{}", e.source, e.pos)).collect();
    assert_eq!(kinds, ["recall:r1#1", "lesson:l3#q1"]);

    // And it is all there when the file is opened again
    let path = s.path.clone();
    let again = Store::open(path).unwrap();
    assert!(again.existed);
    assert_eq!(again.entries.len(), 2);
    assert_eq!(again.state("a", T0 + HOUR, true).unwrap().seen, s.state("a", T0 + HOUR, true).unwrap().seen);
    assert!(again.superseded.contains("lesson:l3#q0"));
  }

  #[test]
  fn ready_next_is_what_rests_on_solid_ground() {
    let (_dir, mut s) = store();
    let mut ticked = concept("x", "Big O notation", "Algorithms", 0, &[]);
    ticked.done = Some(true);
    s.upsert(vec![
      ticked,
      concept("a", "Arrays", "Algorithms", 1, &["x"]),
      concept("b", "Hash tables", "Algorithms", 2, &["a"]),
      concept("c", "Bloom filters", "Algorithms", 3, &["b"]),
      concept("n1", "TCP", "Networks", 0, &[]),
      concept("n2", "TLS", "Networks", 1, &["n1"]),
    ])
    .unwrap();
    let names = |s: &Store, area: Option<&str>, now: f64| s.ready(area, now, true, 10).into_iter().map(|c| c.name).collect::<Vec<_>>();

    // A tick with no evidence stands; nothing else has been learnt
    assert_eq!(names(&s, Some("Algorithms"), T0), ["Arrays"]);
    assert_eq!(names(&s, None, T0), ["Arrays", "TCP"]);

    learn(&mut s, "a", T0);
    assert_eq!(names(&s, Some("Algorithms"), T0 + HOUR), ["Hash tables"]);
    // Begun but not solid: still ready, and first
    s.record(vec![ev("n1", "lesson:n1", "taught", "taught", T0)], false).unwrap();
    assert_eq!(names(&s, None, T0 + HOUR), ["TCP", "Hash tables"]);

    // Once Arrays has faded, Hash tables waits for it; Arrays itself is for revisiting, not for learning next
    let later = T0 + 10.0 * DAY_MS;
    assert_eq!(s.state("a", later, true).unwrap().status, "fading");
    assert_eq!(names(&s, Some("Algorithms"), later), Vec::<String>::new());

    // A tick that an answer contradicts no longer stands
    s.record(vec![ev("x", "attempt:1", "0", "wrong", later)], false).unwrap();
    assert_eq!(names(&s, Some("Algorithms"), later), ["Big O notation"]);

    // Fading soonest: the solid ones, the nearest to the line first
    learn(&mut s, "b", later);
    s.record(vec![ev("n1", "lesson:n1", "q0", "right", later - 4.0 * DAY_MS), ev("n1", "recall:n1", "1", "recalled-right", later)], false).unwrap();
    let soon = s.fading(None, later + HOUR, true, 10);
    assert_eq!(soon.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Hash tables", "TCP"]);
    assert!(soon[0].fades_in.unwrap() < soon[1].fades_in.unwrap());
  }

  #[test]
  fn the_picture_around_a_topic() {
    let (_dir, mut s) = store();
    let mut step = concept("b##chaining", "Collisions and chaining", "Algorithms", 0, &[]);
    step.parent = Some("b".into());
    step.origin = "step".into();
    let mut secret = concept("p", "Hash tables at the bank", "Work", 0, &[]);
    secret.private = Some(true);
    s.upsert(vec![
      concept("a", "Arrays", "Algorithms", 0, &[]),
      concept("b", "Hash tables", "Algorithms", 1, &["a"]),
      concept("c", "Consistent hashing with hash rings", "Systems", 0, &["b"]),
      concept("d", "Hash rings in Dynamo", "Systems", 1, &["c"]),
      concept("z", "Photosynthesis", "Biology", 0, &[]),
      step,
      secret,
    ])
    .unwrap();
    // The step's evidence goes in with its lesson's: a step with none is dropped at the next save
    s.record(vec![ev("b", "lesson:b", "taught", "taught", T0), ev("b", "lesson:b", "q0", "wrong", T0 + 1.0), ev("b##chaining", "lesson:b", "s0", "taught", T0)], false).unwrap();
    learn(&mut s, "d", T0);
    learn(&mut s, "p", T0);

    let p = s.around("Consistent hashing with hash rings", T0 + HOUR, false, 5);
    assert_eq!(p.topic.as_ref().unwrap().id, "c");
    // What it builds on, nearest first, shaky or untouched alike
    assert_eq!(p.prerequisites.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
    assert_eq!(p.solid.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["d"]);
    assert!(p.shaky.is_empty());

    // By name alone, with the topic's own plan steps; private concepts only for a reader on this Mac
    let p = s.around("Hash tables", T0 + HOUR, false, 5);
    assert_eq!(p.topic.as_ref().unwrap().status, "learning");
    assert_eq!(p.shaky.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["b##chaining"]);
    assert_eq!(p.prerequisites.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["a"]);
    let local = s.around("Hash tables", T0 + HOUR, true, 5);
    assert!(local.topic.is_some());
    assert!(s.around("hash table", T0 + HOUR, true, 5).solid.iter().any(|c| c.id == "p"));
    assert!(s.around("hash table", T0 + HOUR, false, 5).solid.iter().all(|c| c.id != "p"));
    assert!(s.state("p", T0, false).is_none());

    // Private evidence on an open concept is likewise only counted on this Mac
    let mut quiet = ev("z", "lesson:z", "q0", "right", T0);
    quiet.private = Some(true);
    s.record(vec![quiet], false).unwrap();
    assert_eq!(s.state("z", T0, true).unwrap().right, 1);
    assert_eq!(s.state("z", T0, false).unwrap().status, "new");

    let none = s.around("Bayesian statistics", T0, true, 5);
    assert!(none.topic.is_none() && none.solid.is_empty() && none.shaky.is_empty() && none.prerequisites.is_empty());
    assert_eq!(s.resolve("hash tables!", None).as_deref(), Some("b"));
    assert_eq!(s.resolve("Collisions and chaining", None), None);
  }

  #[test]
  fn a_roadmap_that_changes_keeps_what_has_evidence() {
    let (_dir, mut s) = store();
    s.sync_roadmap("Algorithms", vec![concept("a", "Arrays", "Algorithms", 0, &[]), concept("b", "Hash tables", "Algorithms", 1, &["a"]), concept("c", "Tries", "Algorithms", 2, &["b"])]).unwrap();
    learn(&mut s, "b", T0);
    // The roadmap now has only Arrays, renamed in place
    assert!(s.sync_roadmap("Algorithms", vec![concept("a", "Arrays and slices", "Algorithms", 0, &[])]).unwrap() > 0);
    assert_eq!(s.sync_roadmap("Algorithms", vec![concept("a", "Arrays and slices", "Algorithms", 0, &[])]).unwrap(), 0);
    assert_eq!(s.entries.iter().map(|e| (e.c.name.as_str(), e.c.origin.as_str())).collect::<Vec<_>>(), [("Arrays and slices", "roadmap"), ("Hash tables", "lesson")]);
    assert_eq!(s.resolve("arrays and slices", Some("Algorithms")).as_deref(), Some("a"));
    assert_eq!(s.state("b", T0 + HOUR, true).unwrap().right, 2);
  }

  #[test]
  fn the_questions_that_came_back() {
    let (_dir, mut s) = store();
    s.upsert(vec![concept("a", "Arrays", "Algorithms", 0, &[]), concept("b", "Hash tables", "Algorithms", 1, &[])]).unwrap();
    let mut step = concept("a##s", "Indexing", "Algorithms", 0, &[]);
    step.parent = Some("a".into());
    step.origin = "step".into();
    s.upsert(vec![step]).unwrap();
    // Week one: first lessons. Nothing has come back yet, however many answers
    learn(&mut s, "a", T0 + DAY_MS);
    learn(&mut s, "b", T0 + DAY_MS);
    // Week two: a recall that went right, a quiz answer partly right, one wrong; and the same evening's second answer in the same sitting
    let w2 = T0 + 8.0 * DAY_MS;
    s.record(
      vec![
        ev("a", "recall:r1", "1", "recalled-right", w2),
        ev("a", "attempt:1", "0", "partly", w2 + HOUR),
        ev("b", "lesson:b2", "q0", "wrong", w2),
        ev("b", "lesson:b2", "q1", "right", w2 + 60_000.0),
        ev("a##s", "lesson:b2", "s0", "right", w2),
      ],
      false,
    )
    .unwrap();
    // Week three: nothing. Week four (this week): one recall missed
    let now = T0 + 23.0 * DAY_MS;
    s.record(vec![ev("b", "recall:r2", "1", "recalled-wrong", now - HOUR)], false).unwrap();

    let back = s.returns(true);
    let at = |w: f64| back.iter().filter(|r| r.at >= T0 + w * 7.0 * DAY_MS && r.at < T0 + (w + 1.0) * 7.0 * DAY_MS).collect::<Vec<_>>();
    // Week one: nothing came back. Week two: the recall, the quiz answer an hour later, and the wrong answer
    // in the second sitting on b and the right one after it; not the plan step. Week four: the missed recall
    assert_eq!([at(0.0).len(), at(1.0).len(), at(2.0).len(), at(3.0).len()], [0, 4, 0, 1]);
    assert_eq!(at(1.0).iter().map(|r| r.right).sum::<f64>(), 2.5);
    assert_eq!(at(3.0)[0].right, 0.0);
    assert!(back.windows(2).all(|w| w[0].at <= w[1].at), "oldest first");
  }

  #[test]
  fn when_a_topic_was_first_met_and_first_made_solid() {
    let (_dir, mut s) = store();
    s.upsert(vec![concept("a", "Arrays", "Algorithms", 0, &[]), concept("b", "Hash tables", "Algorithms", 1, &[])]).unwrap();
    // Taught, then partly right: begun, not yet solid. The right answer a day later makes it solid
    s.record(vec![ev("a", "lesson:1", "taught", "taught", T0), ev("a", "lesson:1", "q0", "partly", T0 + 60_000.0)], false).unwrap();
    let a = s.state("a", T0 + HOUR, true).unwrap();
    assert_eq!((a.first_seen, a.made_solid, a.fades_at, a.status.as_str()), (Some(T0), None, None, "learning"));
    s.record(vec![ev("a", "lesson:2", "q0", "right", T0 + DAY_MS)], false).unwrap();
    let now = T0 + DAY_MS + HOUR;
    let a = s.state("a", now, true).unwrap();
    assert_eq!(a.made_solid, Some(T0 + DAY_MS));
    assert_eq!(a.status, "solid");
    assert_eq!(a.level, 1.0);
    assert!(a.stability.unwrap() > 1.0 && a.difficulty.unwrap() >= 1.0);
    // R halves far more slowly than it falls from 1 to 0.9: FSRS-6's curve has a long tail
    assert!(a.half_life > 10.0 * a.stability.unwrap());
    // The fade date is the fade-in days from now, and R is at the line then
    let fades_at = a.fades_at.unwrap();
    assert!((fades_at - (now + a.fades_in.unwrap() * DAY_MS)).abs() < 1.0);
    let then = s.state("a", fades_at, true).unwrap();
    assert!((then.estimate - SOLID).abs() < 1e-6);
    assert_eq!(s.state("a", fades_at + HOUR, true).unwrap().status, "fading");
    // Once made solid, it stays made solid when it fades or an answer goes wrong
    s.record(vec![ev("a", "lesson:3", "q0", "wrong", T0 + 3.0 * DAY_MS)], false).unwrap();
    assert_eq!(s.state("a", T0 + 3.0 * DAY_MS, true).unwrap().made_solid, Some(T0 + DAY_MS));
    // Never studied: none of the three
    let b = s.state("b", now, true).unwrap();
    assert_eq!((b.first_seen, b.made_solid, b.fades_at, b.stability), (None, None, None, None));
  }

  #[test]
  fn a_file_from_the_earlier_model_is_replayed_and_kept() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("knowledge.json");
    // As the half-life model wrote it: version 1, the evidence and nothing derived
    let v1 = serde_json::json!({ "version": 1, "concepts": [
      { "id": "a", "name": "Arrays", "area": "Algorithms", "origin": "roadmap", "order": 0, "prerequisites": [], "done": true, "evidence": [
        { "source": "lesson:old", "pos": "taught", "kind": "taught", "at": T0, "weight": 1.0 },
        { "source": "lesson:old", "pos": "q0", "kind": "right", "at": T0 + 60_000.0, "weight": 1.0 },
        { "source": "recall:r1", "pos": "1", "kind": "recalled-right", "at": T0 + 8.0 * DAY_MS, "weight": 1.0, "supersedes": "lesson:x#q0" } ] },
      { "id": "b", "name": "Hash tables", "area": "Algorithms", "origin": "roadmap", "order": 1, "prerequisites": ["a"], "evidence": [] } ] });
    let original = serde_json::to_vec_pretty(&v1).unwrap();
    std::fs::write(&path, &original).unwrap();

    let mut s = Store::open(path.clone()).unwrap();
    assert!(s.existed);
    // Worked out from the same evidence, through FSRS: two good reviews eight days apart
    let a = s.state("a", T0 + 8.0 * DAY_MS + HOUR, true).unwrap();
    assert_eq!((a.seen, a.right, a.status.as_str()), (3, 2, "solid"));
    assert!((a.stability.unwrap() - recall_engine(&[(3, T0 + 60_000.0), (3, T0 + 8.0 * DAY_MS)]).0).abs() < 1e-3);
    // Opening it writes nothing
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(!path.with_extension("v1.json").exists());

    // The first save keeps the earlier file beside it, as it was, and writes every piece of evidence back
    s.record(vec![ev("b", "lesson:b", "q0", "right", T0 + 9.0 * DAY_MS)], false).unwrap();
    assert_eq!(std::fs::read(path.with_extension("v1.json")).unwrap(), original);
    let now: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!((now["version"].as_u64(), now["model"].as_str()), (Some(2), Some("fsrs-6")));
    assert_eq!(now["concepts"][0]["evidence"], v1["concepts"][0]["evidence"]);
    assert_eq!(now["concepts"][0]["done"], true);
    // Saved again, or opened and saved again, the copy is left alone
    std::fs::write(path.with_extension("v1.json"), b"kept").unwrap();
    s.save().unwrap();
    let mut again = Store::open(path.clone()).unwrap();
    again.save().unwrap();
    assert_eq!(std::fs::read(path.with_extension("v1.json")).unwrap(), b"kept");
    assert!(again.superseded.contains("lesson:x#q0"));

    // What has been read in once is remembered with the file
    assert!(!again.is_filled("cards"));
    again.mark_filled("cards").unwrap();
    assert!(Store::open(path).unwrap().is_filled("cards"));
  }

  #[test]
  fn a_name_finds_its_topic_by_its_words_and_flashcards_are_not_counted_twice() {
    let (_dir, mut s) = store();
    s.upsert(vec![concept("h", "Hash tables", "Algorithms", 0, &[]), concept("n", "Binary numbers", "Maths", 0, &[])]).unwrap();
    assert_eq!(s.resolve("Hash tables", None).as_deref(), Some("h"));
    assert_eq!(s.resolve("hash table", None).as_deref(), Some("h"));
    assert_eq!(s.resolve("Introduction to hash tables", None).as_deref(), Some("h"));
    assert_eq!(s.resolve("Hash tables in Rust", None), None);
    assert_eq!(s.resolve("binary", None), None);
    // A flashcard's return is in the map's evidence, but not in what came back: the review log counts it
    learn(&mut s, "h", T0);
    s.record(vec![ev("h", "card:abc", "1", "recalled-right", T0 + 5.0 * DAY_MS), ev("h", "recall:r", "1", "recalled-right", T0 + 6.0 * DAY_MS)], false).unwrap();
    assert_eq!(s.state("h", T0 + 6.0 * DAY_MS, true).unwrap().right, 4);
    assert_eq!(s.returns(true).len(), 1);
  }

  #[test]
  fn thousands_of_concepts_stay_fast() {
    let (_dir, mut s) = store();
    let concepts: Vec<ConceptIn> = (0..5000).map(|i| concept(&format!("c{i}"), &format!("Topic {i} of hash tables and trees"), &format!("Area {}", i % 12), i, &if i % 40 == 0 { vec![] } else { vec![format!("c{}", i - 1)] }.iter().map(|s| s.as_str()).collect::<Vec<_>>())).collect();
    s.upsert(concepts).unwrap();
    let events: Vec<EvidenceIn> = (0..5000).flat_map(|i| (0..6).map(move |k| ev(&format!("c{i}"), &format!("lesson:{i}"), &format!("q{k}"), if k % 3 == 0 { "wrong" } else { "right" }, T0 + k as f64 * DAY_MS))).collect();
    s.record(events, true).unwrap();
    let now = T0 + 30.0 * DAY_MS;
    let started = std::time::Instant::now();
    for _ in 0..20 {
      s.around("Hash tables", now, true, 5);
      s.ready(None, now, true, 8);
      s.fading(None, now, true, 8);
      s.returns(true);
      s.state("c2500", now, true);
    }
    // Twenty rounds of every query over 5,000 concepts and 30,000 pieces of evidence
    assert!(started.elapsed().as_millis() < 1500, "took {:?}", started.elapsed());
  }
}
