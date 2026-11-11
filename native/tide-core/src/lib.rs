//! Tide's search index: the vault's notes and books, split into passages, kept on disk with
//! Tantivy. Opening it is instant (nothing is rebuilt at start), the text lives in the OS file
//! cache rather than the app's memory, and a search takes about a millisecond.

mod lab;
mod extract;
mod extract_napi;
mod pdf;
mod pdf_napi;
mod knowledge;
mod recall;

use std::path::Path;
use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi_derive::napi;

// The index itself is in `index.rs`, free of Node, so the retrieval evaluation and the Rust tests
// run the very code the app does (some of it only they use); what follows is only its binding
mod embed;
#[allow(dead_code)]
mod index;

fn err(e: String) -> Error {
  Error::from_reason(e)
}

#[napi(object)]
pub struct ChunkIn {
  pub id: String,
  pub title: String,
  pub heading: String,
  pub text: String,
  pub order: u32,
}

#[napi(object)]
pub struct Chunk {
  pub id: String,
  pub path: String,
  pub title: String,
  pub heading: String,
  pub text: String,
  pub order: u32,
  pub score: f64,
}

fn out(chunks: Vec<index::Chunk>) -> Vec<Chunk> {
  chunks
    .into_iter()
    .map(|c| Chunk { id: c.id, path: c.path, title: c.title, heading: c.heading, text: c.text, order: c.order, score: c.score })
    .collect()
}

#[napi]
pub struct SearchIndex {
  core: Arc<index::Core>,
}

fn chunks_in(chunks: Vec<ChunkIn>) -> Vec<index::ChunkIn> {
  chunks.into_iter().map(|c| index::ChunkIn { id: c.id, title: c.title, heading: c.heading, text: c.text, order: c.order }).collect()
}

/// One piece of index work run off Node's main thread, on the libuv pool: a commit syncs a dozen
/// files (F_FULLFSYNC on macOS, ~4 ms each) and took 70-490 ms when it ran on the main thread.
/// The writer is behind a mutex, so the tasks are safe in any order; Tide's TypeScript still
/// sends the writes one at a time, so they land in the order they were made.
pub enum Job {
  Replace(String, Vec<index::ChunkIn>),
  Remove(String),
  Clear,
  Commit,
  Search(String, u32, Option<Vec<String>>, bool),
  Chunks(String, Option<u32>),
  Paths,
}

pub enum Done {
  Nothing,
  Chunks(Vec<index::Chunk>),
  Paths(Vec<String>),
}

pub struct IndexTask {
  core: Arc<index::Core>,
  job: Option<Job>,
}

impl Task for IndexTask {
  type Output = Done;
  type JsValue = Either3<(), Vec<Chunk>, Vec<String>>;

  fn compute(&mut self) -> Result<Done> {
    let c = &self.core;
    let done = match self.job.take() {
      Some(Job::Replace(path, chunks)) => c.replace(&path, chunks).map(|_| Done::Nothing),
      Some(Job::Remove(path)) => c.remove(&path).map(|_| Done::Nothing),
      Some(Job::Clear) => c.clear().map(|_| Done::Nothing),
      Some(Job::Commit) => c.commit().map(|_| Done::Nothing),
      Some(Job::Search(q, limit, paths, typing)) => c.search(&q, limit, paths.as_deref(), typing).map(Done::Chunks),
      Some(Job::Chunks(path, limit)) => c.chunks(&path, limit).map(Done::Chunks),
      Some(Job::Paths) => c.paths().map(Done::Paths),
      None => Ok(Done::Nothing),
    };
    done.map_err(err)
  }

  fn resolve(&mut self, _env: Env, done: Done) -> Result<Self::JsValue> {
    Ok(match done {
      Done::Nothing => Either3::A(()),
      Done::Chunks(c) => Either3::B(out(c)),
      Done::Paths(p) => Either3::C(p),
    })
  }
}

#[napi]
impl SearchIndex {
  /// Opens the index in `dir`, making it if it isn't there
  #[napi(constructor)]
  pub fn new(dir: String) -> Result<Self> {
    // By words alone. Searching by meaning as well (an embedding model beside the words) was
    // measured on the books and found too little more to be worth it, so no model is given
    Ok(SearchIndex { core: Arc::new(index::Core::open(Path::new(&dir), None).map_err(err)?) })
  }

  /// Replaces everything indexed for `path` with these passages (seen after `commit`)
  #[napi]
  pub fn replace(&self, path: String, chunks: Vec<ChunkIn>) -> Result<()> {
    self.core.replace(&path, chunks_in(chunks)).map_err(err)
  }

  fn task(&self, job: Job) -> AsyncTask<IndexTask> {
    AsyncTask::new(IndexTask { core: self.core.clone(), job: Some(job) })
  }

  /// `replace`, off the main thread
  #[napi(ts_return_type = "Promise<void>")]
  pub fn replace_async(&self, path: String, chunks: Vec<ChunkIn>) -> AsyncTask<IndexTask> {
    self.task(Job::Replace(path, chunks_in(chunks)))
  }

  /// `remove`, off the main thread
  #[napi(ts_return_type = "Promise<void>")]
  pub fn remove_async(&self, path: String) -> AsyncTask<IndexTask> {
    self.task(Job::Remove(path))
  }

  /// `clear`, off the main thread
  #[napi(ts_return_type = "Promise<void>")]
  pub fn clear_async(&self) -> AsyncTask<IndexTask> {
    self.task(Job::Clear)
  }

  /// `commit`, off the main thread
  #[napi(ts_return_type = "Promise<void>")]
  pub fn commit_async(&self) -> AsyncTask<IndexTask> {
    self.task(Job::Commit)
  }

  /// `search`, off the main thread (the first search after a commit opens new segments)
  #[napi(ts_return_type = "Promise<Chunk[]>")]
  pub fn search_async(&self, q: String, limit: u32, paths: Option<Vec<String>>, typing: Option<bool>) -> AsyncTask<IndexTask> {
    self.task(Job::Search(q, limit, paths, typing.unwrap_or(false)))
  }

  /// `chunks`, off the main thread
  #[napi(ts_return_type = "Promise<Chunk[]>")]
  pub fn chunks_async(&self, path: String, limit: Option<u32>) -> AsyncTask<IndexTask> {
    self.task(Job::Chunks(path, limit))
  }

  /// `paths`, off the main thread
  #[napi(ts_return_type = "Promise<string[]>")]
  pub fn paths_async(&self) -> AsyncTask<IndexTask> {
    self.task(Job::Paths)
  }

  /// Forgets a path (seen after `commit`)
  #[napi]
  pub fn remove(&self, path: String) -> Result<()> {
    self.core.remove(&path).map_err(err)
  }

  /// Forgets everything (seen after `commit`)
  #[napi]
  pub fn clear(&self) -> Result<()> {
    self.core.clear().map_err(err)
  }

  /// Saves the changes and makes them searchable; the writer's memory is handed back afterwards
  #[napi]
  pub fn commit(&self) -> Result<()> {
    self.core.commit().map_err(err)
  }

  /// The best passages for `q`, optionally only from `paths`. Every word may match a title
  /// (worth most), a heading or the text, and longer words forgive a typo. With `typing`, the
  /// last word also matches as the start of a word, for a search box filled as you type; a
  /// finished question never wants that ("...explain it?" would match everything starting "it").
  #[napi]
  pub fn search(&self, q: String, limit: u32, paths: Option<Vec<String>>, typing: Option<bool>) -> Result<Vec<Chunk>> {
    self.core.search(&q, limit, paths.as_deref(), typing.unwrap_or(false)).map(out).map_err(err)
  }

  /// The passages of one file in reading order: all of them, or the first `limit`. Positions come
  /// from a fast column, so only the passages returned are read from disk.
  #[napi]
  pub fn chunks(&self, path: String, limit: Option<u32>) -> Result<Vec<Chunk>> {
    self.core.chunks(&path, limit).map(out).map_err(err)
  }

  /// The paths with a live passage
  #[napi]
  pub fn paths(&self) -> Result<Vec<String>> {
    self.core.paths().map_err(err)
  }

  /// How many passages are searchable
  #[napi]
  pub fn size(&self) -> u32 {
    self.core.size()
  }
}
