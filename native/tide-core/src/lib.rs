//! Tide's search index: the vault's notes and books, split into passages, kept on disk with
//! Tantivy. Opening it is instant (nothing is rebuilt at start), the text lives in the OS file
//! cache rather than the app's memory, and a search takes about a millisecond.

mod lab;
mod recall;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use tantivy::collector::{DocSetCollector, TopDocs};
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery, TermSetQuery};
use tantivy::schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED, STRING};
use tantivy::tokenizer::{LowerCaser, RemoveLongFilter, SimpleTokenizer, Stemmer, TextAnalyzer};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

/// Bumped whenever the schema or the analyser changes: an older index is thrown away and rebuilt
const SCHEMA_VERSION: &str = "1";
const ANALYSER: &str = "tide";
/// The writer's working memory: small, since Gemma needs the RAM more than indexing needs speed
const WRITER_BYTES: usize = 20_000_000;

fn err<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
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

struct Fields {
  id: Field,
  path: Field,
  title: Field,
  heading: Field,
  text: Field,
  order: Field,
}

#[napi]
pub struct SearchIndex {
  index: Index,
  reader: IndexReader,
  writer: Mutex<Option<IndexWriter>>,
  f: Fields,
}

fn analyser() -> TextAnalyzer {
  TextAnalyzer::builder(SimpleTokenizer::default())
    .filter(RemoveLongFilter::limit(40))
    .filter(LowerCaser)
    .filter(Stemmer::default())
    .build()
}

fn schema() -> Schema {
  let text = TextOptions::default()
    .set_indexing_options(TextFieldIndexing::default().set_tokenizer(ANALYSER).set_index_option(IndexRecordOption::WithFreqsAndPositions))
    .set_stored();
  let mut b = Schema::builder();
  b.add_text_field("id", STRING | STORED);
  b.add_text_field("path", STRING | STORED);
  b.add_text_field("title", text.clone());
  b.add_text_field("heading", text.clone());
  b.add_text_field("text", text);
  b.add_u64_field("order", STORED | FAST);
  b.build()
}

fn open(dir: &PathBuf) -> tantivy::Result<Index> {
  let marker = dir.join("tide-schema");
  if dir.exists() && std::fs::read_to_string(&marker).ok().as_deref() != Some(SCHEMA_VERSION) {
    // An index from an older Tide: it's only a cache of the vault, so start again
    let _ = std::fs::remove_dir_all(dir);
  }
  std::fs::create_dir_all(dir)?;
  let index = match Index::open_in_dir(dir) {
    Ok(i) => i,
    Err(_) => {
      let _ = std::fs::remove_dir_all(dir);
      std::fs::create_dir_all(dir)?;
      Index::create_in_dir(dir, schema())?
    }
  };
  std::fs::write(&marker, SCHEMA_VERSION)?;
  index.tokenizers().register(ANALYSER, analyser());
  Ok(index)
}

#[napi]
impl SearchIndex {
  /// Opens the index in `dir`, making it if it isn't there
  #[napi(constructor)]
  pub fn new(dir: String) -> Result<Self> {
    let index = open(&PathBuf::from(dir)).map_err(err)?;
    let s = index.schema();
    let field = |n: &str| s.get_field(n).map_err(err);
    let f = Fields { id: field("id")?, path: field("path")?, title: field("title")?, heading: field("heading")?, text: field("text")?, order: field("order")? };
    let reader = index.reader_builder().reload_policy(ReloadPolicy::Manual).try_into().map_err(err)?;
    Ok(SearchIndex { index, reader, writer: Mutex::new(None), f })
  }

  fn with_writer<T>(&self, run: impl FnOnce(&mut IndexWriter, &Fields) -> tantivy::Result<T>) -> Result<T> {
    let mut slot = self.writer.lock().map_err(err)?;
    if slot.is_none() {
      *slot = Some(self.index.writer_with_num_threads(1, WRITER_BYTES).map_err(err)?);
    }
    run(slot.as_mut().unwrap(), &self.f).map_err(err)
  }

  /// Replaces everything indexed for `path` with these passages (seen after `commit`)
  #[napi]
  pub fn replace(&self, path: String, chunks: Vec<ChunkIn>) -> Result<()> {
    self.with_writer(|w, f| {
      w.delete_term(Term::from_field_text(f.path, &path));
      for c in chunks {
        w.add_document(doc!(
          f.id => c.id,
          f.path => path.as_str(),
          f.title => c.title,
          f.heading => c.heading,
          f.text => c.text,
          f.order => c.order as u64
        ))?;
      }
      Ok(())
    })
  }

  /// Forgets a path (seen after `commit`)
  #[napi]
  pub fn remove(&self, path: String) -> Result<()> {
    self.with_writer(|w, f| {
      w.delete_term(Term::from_field_text(f.path, &path));
      Ok(())
    })
  }

  /// Forgets everything (seen after `commit`)
  #[napi]
  pub fn clear(&self) -> Result<()> {
    self.with_writer(|w, _| w.delete_all_documents().map(|_| ()))
  }

  /// Saves the changes and makes them searchable; the writer's memory is handed back afterwards
  #[napi]
  pub fn commit(&self) -> Result<()> {
    let mut slot = self.writer.lock().map_err(err)?;
    if let Some(w) = slot.as_mut() {
      // On failure the writer and what it holds are kept, to be committed by the next call
      w.commit().map_err(err)?;
    }
    if let Some(w) = slot.take() {
      w.wait_merging_threads().map_err(err)?;
    }
    self.reader.reload().map_err(err)
  }

  /// The best passages for `q`, optionally only from `paths`. Every word may match a title
  /// (worth most), a heading or the text, and longer words forgive a typo. With `typing`, the
  /// last word also matches as the start of a word, for a search box filled as you type; a
  /// finished question never wants that ("...explain it?" would match everything starting "it").
  #[napi]
  pub fn search(&self, q: String, limit: u32, paths: Option<Vec<String>>, typing: Option<bool>) -> Result<Vec<Chunk>> {
    let mut words: Vec<String> = Vec::new();
    let mut a = analyser();
    let mut stream = a.token_stream(&q);
    while stream.advance() {
      let t = stream.token().text.clone();
      if !words.contains(&t) {
        words.push(t);
      }
    }
    if words.is_empty() || limit == 0 {
      return Ok(Vec::new());
    }
    // A pasted paragraph is searched by its first words: each one costs a lookup per field
    words.truncate(32);
    let typed_last = typing.unwrap_or(false) && !q.ends_with(char::is_whitespace);
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for (i, w) in words.iter().enumerate() {
      for (field, boost) in [(self.f.title, 3.0), (self.f.heading, 2.0), (self.f.text, 1.0)] {
        let term = Term::from_field_text(field, w);
        // An exact match counts in full; a longer word one typo off counts for less
        clauses.push((Occur::Should, Box::new(BoostQuery::new(Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqs)), boost))));
        // A near match scores a flat amount, so it is kept small beside a real one, and only the
        // first dozen words get one
        if w.chars().count() >= 5 && i < 12 {
          clauses.push((Occur::Should, Box::new(BoostQuery::new(Box::new(FuzzyTermQuery::new(term.clone(), 1, true)), boost * 0.25))));
        }
        if i == words.len() - 1 && typed_last && w.chars().count() >= 3 {
          clauses.push((Occur::Should, Box::new(BoostQuery::new(Box::new(FuzzyTermQuery::new_prefix(term, 0, false)), boost * 0.5))));
        }
      }
    }
    let mut query: Box<dyn Query> = Box::new(BooleanQuery::new(clauses));
    if let Some(paths) = paths {
      if paths.is_empty() {
        return Ok(Vec::new());
      }
      let only = TermSetQuery::new(paths.iter().map(|p| Term::from_field_text(self.f.path, p)));
      query = Box::new(BooleanQuery::new(vec![(Occur::Must, query), (Occur::Must, Box::new(only))]));
    }
    let searcher = self.reader.searcher();
    let top = searcher.search(&query, &TopDocs::with_limit(limit as usize)).map_err(err)?;
    top
      .into_iter()
      .map(|(score, addr)| {
        let d: TantivyDocument = searcher.doc(addr).map_err(err)?;
        Ok(self.chunk(&d, score as f64))
      })
      .collect()
  }

  /// The passages of one file in reading order: all of them, or the first `limit`. Positions come
  /// from a fast column, so only the passages returned are read from disk.
  #[napi]
  pub fn chunks(&self, path: String, limit: Option<u32>) -> Result<Vec<Chunk>> {
    let searcher = self.reader.searcher();
    let q = TermQuery::new(Term::from_field_text(self.f.path, &path), IndexRecordOption::Basic);
    let found = searcher.search(&q, &DocSetCollector).map_err(err)?;
    let mut placed = Vec::with_capacity(found.len());
    for addr in found {
      let column = searcher.segment_reader(addr.segment_ord).fast_fields().u64("order").map_err(err)?;
      placed.push((column.first(addr.doc_id).unwrap_or(0), addr));
    }
    placed.sort_by_key(|(order, _)| *order);
    placed.truncate(limit.map(|n| n as usize).unwrap_or(usize::MAX));
    placed
      .into_iter()
      .map(|(_, addr)| searcher.doc::<TantivyDocument>(addr).map(|d| self.chunk(&d, 0.0)).map_err(err))
      .collect()
  }

  /// The paths with a live passage
  #[napi]
  pub fn paths(&self) -> Result<Vec<String>> {
    let searcher = self.reader.searcher();
    let mut seen = HashSet::new();
    for seg in searcher.segment_readers() {
      let alive = seg.alive_bitset();
      let store = seg.get_store_reader(1).map_err(err)?;
      for doc in 0..seg.max_doc() {
        if alive.map(|a| a.is_alive(doc)).unwrap_or(true) {
          let d: TantivyDocument = store.get(doc).map_err(err)?;
          if let Some(p) = d.get_first(self.f.path).and_then(|v| v.as_str()) {
            seen.insert(p.to_string());
          }
        }
      }
    }
    Ok(seen.into_iter().collect())
  }

  /// How many passages are searchable
  #[napi]
  pub fn size(&self) -> u32 {
    self.reader.searcher().num_docs() as u32
  }

  fn chunk(&self, d: &TantivyDocument, score: f64) -> Chunk {
    let s = |f: Field| d.get_first(f).and_then(|v| v.as_str()).unwrap_or("").to_string();
    Chunk {
      id: s(self.f.id),
      path: s(self.f.path),
      title: s(self.f.title),
      heading: s(self.f.heading),
      text: s(self.f.text),
      order: d.get_first(self.f.order).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
      score,
    }
  }
}
