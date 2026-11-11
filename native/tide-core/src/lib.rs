//! Tide's search index: the vault's notes and books, split into passages, kept on disk with
//! Tantivy. Opening it is instant (nothing is rebuilt at start), the text lives in the OS file
//! cache rather than the app's memory, and a search takes about a millisecond.

mod recall;

use std::path::Path;

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
  core: index::Core,
}

#[napi]
impl SearchIndex {
  /// Opens the index in `dir`, making it if it isn't there
  #[napi(constructor)]
  pub fn new(dir: String) -> Result<Self> {
    // By words alone. Searching by meaning as well (an embedding model beside the words) was
    // measured on the books and found too little more to be worth it, so no model is given
    Ok(SearchIndex { core: index::Core::open(Path::new(&dir), None).map_err(err)? })
  }

  /// Replaces everything indexed for `path` with these passages (seen after `commit`)
  #[napi]
  pub fn replace(&self, path: String, chunks: Vec<ChunkIn>) -> Result<()> {
    let chunks = chunks.into_iter().map(|c| index::ChunkIn { id: c.id, title: c.title, heading: c.heading, text: c.text, order: c.order }).collect();
    self.core.replace(&path, chunks).map_err(err)
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
