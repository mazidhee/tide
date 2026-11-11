//! The index itself, free of Node (so the retrieval evaluation and the tests can run it too): the vault's notes and books, split into passages, kept on disk
//! with Tantivy. Opening it is instant (nothing is rebuilt at start), the text lives in the OS file
//! cache rather than the app's memory, and a search takes about a millisecond.
//!
//! Given an embedding model, each passage also carries a small vector (in the same Tantivy
//! document, so the two can never disagree), and a finished question is answered by meaning as
//! well as by its words. Without a model nothing here differs from the index before vectors,
//! and the app's module is built without one (see `embed.rs`).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use tantivy::collector::{DocSetCollector, TopDocs};
use tantivy::index::SegmentId;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery, TermSetQuery};
use tantivy::schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED, STRING};
use tantivy::tokenizer::{LowerCaser, RemoveLongFilter, SimpleTokenizer, Stemmer, TextAnalyzer};
use tantivy::{doc, DocAddress, Index, IndexReader, IndexWriter, ReloadPolicy, Searcher, SegmentReader, TantivyDocument, Term};

use crate::embed::{dot, quantise, Model};

/// Bumped whenever the schema or the analyser changes: an older index is thrown away and rebuilt
const SCHEMA_VERSION: &str = "1";
const ANALYSER: &str = "tide";
/// The writer's working memory: small, since Gemma needs the RAM more than indexing needs speed
const WRITER_BYTES: usize = 20_000_000;
const VECTOR: &str = "vec";

pub type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

pub struct ChunkIn {
  pub id: String,
  pub title: String,
  pub heading: String,
  pub text: String,
  pub order: u32,
}

pub struct Chunk {
  pub id: String,
  pub path: String,
  pub title: String,
  pub heading: String,
  pub text: String,
  pub order: u32,
  pub score: f64,
}

/// How the passages for a question are chosen
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ranking {
  /// By the question's words alone (BM25): what Tide does without a model
  Words,
  /// By meaning alone: the passages whose vectors point most nearly the question's way
  Vectors,
  /// Reciprocal rank fusion of the two lists, each read `depth` deep: a passage scores
  /// `1 / (k + its place by words) + weight / (k + its place by meaning)`
  Fused { k: f32, weight: f32, depth: usize },
  /// The best `depth` by words, put in order of meaning
  Reranked { depth: usize },
}

/// What a finished question gets when a model is loaded. The app loads none: on the books'
/// questions in scripts/eval/retrieval.json no fusion beat words alone by more than chance.
pub const HYBRID: Ranking = Ranking::Fused { k: 60.0, weight: 0.5, depth: 50 };

struct Fields {
  id: Field,
  path: Field,
  title: Field,
  heading: Field,
  text: Field,
  order: Field,
  vector: Option<Field>,
}

/// One segment's vectors, a row per document (all zero, with a zero length, where there is none)
struct SegmentVectors {
  rows: Vec<i8>,
  lengths: Vec<f32>,
}

pub struct Core {
  index: Index,
  reader: IndexReader,
  writer: Mutex<Option<IndexWriter>>,
  f: Fields,
  model: Option<Model>,
  vectors: RwLock<HashMap<SegmentId, Arc<SegmentVectors>>>,
}

fn analyser() -> TextAnalyzer {
  TextAnalyzer::builder(SimpleTokenizer::default())
    .filter(RemoveLongFilter::limit(40))
    .filter(LowerCaser)
    .filter(Stemmer::default())
    .build()
}

fn schema(vectors: bool) -> Schema {
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
  if vectors {
    // A column rather than a stored field: read once per segment, never with the text
    b.add_bytes_field(VECTOR, FAST);
  }
  b.build()
}

fn open(dir: &Path, model: Option<&Model>) -> tantivy::Result<Index> {
  // An index with vectors says which model made them: with another model, or none, it's rebuilt
  let version = match model {
    Some(m) => format!("{SCHEMA_VERSION}+{}", m.id()),
    None => SCHEMA_VERSION.to_string(),
  };
  let marker = dir.join("tide-schema");
  if dir.exists() && std::fs::read_to_string(&marker).ok().as_deref() != Some(version.as_str()) {
    // An index from an older Tide: it's only a cache of the vault, so start again
    let _ = std::fs::remove_dir_all(dir);
  }
  std::fs::create_dir_all(dir)?;
  let index = match Index::open_in_dir(dir) {
    Ok(i) => i,
    Err(_) => {
      let _ = std::fs::remove_dir_all(dir);
      std::fs::create_dir_all(dir)?;
      Index::create_in_dir(dir, schema(model.is_some()))?
    }
  };
  std::fs::write(&marker, version)?;
  index.tokenizers().register(ANALYSER, analyser());
  Ok(index)
}

impl Core {
  /// Opens the index in `dir`, making it if it isn't there. With `model_dir` (a folder holding a
  /// static embedding model) passages are also indexed and searched by meaning.
  pub fn open(dir: &Path, model_dir: Option<&Path>) -> Res<Core> {
    let model = model_dir.map(Model::load).transpose()?;
    let index = open(dir, model.as_ref()).map_err(err)?;
    let s = index.schema();
    let field = |n: &str| s.get_field(n).map_err(err);
    let vector = if model.is_some() { Some(field(VECTOR)?) } else { None };
    let f = Fields { id: field("id")?, path: field("path")?, title: field("title")?, heading: field("heading")?, text: field("text")?, order: field("order")?, vector };
    let reader = index.reader_builder().reload_policy(ReloadPolicy::Manual).try_into().map_err(err)?;
    let core = Core { index, reader, writer: Mutex::new(None), f, model, vectors: RwLock::new(HashMap::new()) };
    core.load_vectors()?;
    Ok(core)
  }

  pub fn model(&self) -> Option<&Model> {
    self.model.as_ref()
  }

  fn with_writer<T>(&self, run: impl FnOnce(&mut IndexWriter, &Fields) -> tantivy::Result<T>) -> Res<T> {
    let mut slot = self.writer.lock().map_err(err)?;
    if slot.is_none() {
      *slot = Some(self.index.writer_with_num_threads(1, WRITER_BYTES).map_err(err)?);
    }
    run(slot.as_mut().unwrap(), &self.f).map_err(err)
  }

  /// Replaces everything indexed for `path` with these passages (seen after `commit`)
  pub fn replace(&self, path: &str, chunks: Vec<ChunkIn>) -> Res<()> {
    self.with_writer(|w, f| {
      w.delete_term(Term::from_field_text(f.path, path));
      for c in chunks {
        // The vector goes in the passage's own document: replaced, removed and saved with it
        let vector = self.model.as_ref().and_then(|m| m.embed(&c.text)).map(|v| quantise(&v)).filter(|v| !v.is_empty());
        let mut d = doc!(
          f.id => c.id,
          f.path => path,
          f.title => c.title,
          f.heading => c.heading,
          f.text => c.text,
          f.order => c.order as u64
        );
        if let (Some(field), Some(v)) = (f.vector, vector) {
          d.add_bytes(field, &v);
        }
        w.add_document(d)?;
      }
      Ok(())
    })
  }

  /// Forgets a path (seen after `commit`)
  pub fn remove(&self, path: &str) -> Res<()> {
    self.with_writer(|w, f| {
      w.delete_term(Term::from_field_text(f.path, path));
      Ok(())
    })
  }

  /// Forgets everything (seen after `commit`)
  pub fn clear(&self) -> Res<()> {
    self.with_writer(|w, _| w.delete_all_documents().map(|_| ()))
  }

  /// Saves the changes and makes them searchable; the writer's memory is handed back afterwards
  pub fn commit(&self) -> Res<()> {
    let mut slot = self.writer.lock().map_err(err)?;
    if let Some(w) = slot.as_mut() {
      // On failure the writer and what it holds are kept, to be committed by the next call
      w.commit().map_err(err)?;
    }
    if let Some(w) = slot.take() {
      w.wait_merging_threads().map_err(err)?;
    }
    self.reader.reload().map_err(err)?;
    self.load_vectors()
  }

  /// Brings the vectors in memory in line with the segments now searchable: those of a segment
  /// already held are kept, a new segment's are read from its column, a gone segment's dropped
  fn load_vectors(&self) -> Res<()> {
    let Some(model) = &self.model else { return Ok(()) };
    let searcher = self.reader.searcher();
    let held = self.vectors.read().map_err(err)?.clone();
    let mut now = HashMap::new();
    for seg in searcher.segment_readers() {
      let vectors = match held.get(&seg.segment_id()) {
        Some(v) => v.clone(),
        None => Arc::new(read_vectors(seg, model.dim()).map_err(err)?),
      };
      now.insert(seg.segment_id(), vectors);
    }
    *self.vectors.write().map_err(err)? = now;
    Ok(())
  }

  /// The question's words as a query: every word may match a title (worth most), a heading or the
  /// text, and longer words forgive a typo
  fn words_query(&self, q: &str, typing: bool) -> Option<Box<dyn Query>> {
    let mut words: Vec<String> = Vec::new();
    let mut a = analyser();
    let mut stream = a.token_stream(q);
    while stream.advance() {
      let t = stream.token().text.clone();
      if !words.contains(&t) {
        words.push(t);
      }
    }
    if words.is_empty() {
      return None;
    }
    // A pasted paragraph is searched by its first words: each one costs a lookup per field
    words.truncate(32);
    let typed_last = typing && !q.ends_with(char::is_whitespace);
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
    Some(Box::new(BooleanQuery::new(clauses)))
  }

  fn only(&self, paths: &[String]) -> TermSetQuery {
    TermSetQuery::new(paths.iter().map(|p| Term::from_field_text(self.f.path, p)))
  }

  /// The best `n` passages by the question's words
  fn by_words(&self, searcher: &Searcher, q: &str, n: usize, paths: Option<&[String]>, typing: bool) -> Res<Vec<(f32, DocAddress)>> {
    let Some(mut query) = self.words_query(q, typing) else { return Ok(Vec::new()) };
    if let Some(paths) = paths {
      query = Box::new(BooleanQuery::new(vec![(Occur::Must, query), (Occur::Must, Box::new(self.only(paths)))]));
    }
    searcher.search(&query, &TopDocs::with_limit(n)).map_err(err)
  }

  /// Every live passage's closeness to the question's vector (cosine), best first: a plain pass
  /// over all of them, which for a vault's worth of passages is quicker than any index would be
  fn by_meaning(&self, searcher: &Searcher, question: &[f32], paths: Option<&[String]>) -> Res<Vec<(f32, DocAddress)>> {
    let dim = question.len();
    let held = self.vectors.read().map_err(err)?;
    let mut out = Vec::new();
    let mut score = |ord: usize, doc: u32, v: &SegmentVectors| {
      let length = v.lengths.get(doc as usize).copied().unwrap_or(0.0);
      if length > 0.0 {
        let at = doc as usize * dim;
        out.push((dot(question, &v.rows[at..at + dim]) / length, DocAddress::new(ord as u32, doc)));
      }
    };
    match paths {
      Some(paths) => {
        for addr in searcher.search(&self.only(paths), &DocSetCollector).map_err(err)? {
          if let Some(v) = held.get(&searcher.segment_reader(addr.segment_ord).segment_id()) {
            score(addr.segment_ord as usize, addr.doc_id, v);
          }
        }
      }
      None => {
        for (ord, seg) in searcher.segment_readers().iter().enumerate() {
          let Some(v) = held.get(&seg.segment_id()) else { continue };
          let alive = seg.alive_bitset();
          for doc in 0..seg.max_doc() {
            if alive.map(|a| a.is_alive(doc)).unwrap_or(true) {
              score(ord, doc, v);
            }
          }
        }
      }
    }
    // Ties in a fixed order, so the same question always gets the same list
    out.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    Ok(out)
  }

  /// The best passages for `q`, optionally only from `paths`. With `typing`, the last word also
  /// matches as the start of a word, for a search box filled as you type; a finished question
  /// never wants that ("...explain it?" would match everything starting "it"). With a model, a
  /// finished question is also matched by meaning; a search box being typed into never is.
  pub fn search(&self, q: &str, limit: u32, paths: Option<&[String]>, typing: bool) -> Res<Vec<Chunk>> {
    let how = if self.model.is_some() && !typing { HYBRID } else { Ranking::Words };
    self.search_by(q, limit, paths, typing, how)
  }

  /// `search`, ranked a given way (the evaluation compares them)
  pub fn search_by(&self, q: &str, limit: u32, paths: Option<&[String]>, typing: bool, how: Ranking) -> Res<Vec<Chunk>> {
    let limit = limit as usize;
    if limit == 0 || paths.is_some_and(|p| p.is_empty()) {
      return Ok(Vec::new());
    }
    let searcher = self.reader.searcher();
    let question = match how {
      Ranking::Words => None,
      _ => self.model.as_ref().and_then(|m| m.embed(q)),
    };
    let ranked: Vec<(f32, DocAddress)> = match (how, question) {
      (Ranking::Words, _) | (Ranking::Fused { .. } | Ranking::Reranked { .. }, None) => self.by_words(&searcher, q, limit, paths, typing)?,
      (Ranking::Vectors, None) => Vec::new(),
      (Ranking::Vectors, Some(v)) => {
        let mut all = self.by_meaning(&searcher, &v, paths)?;
        all.truncate(limit);
        all
      }
      (Ranking::Fused { k, weight, depth }, Some(v)) => {
        let depth = depth.max(limit);
        let words = self.by_words(&searcher, q, depth, paths, typing)?;
        // Nothing shares a word with the question: as without a model, there is nothing to show
        // (the nearest vectors to a question about something absent are noise, not answers)
        if words.is_empty() {
          return Ok(Vec::new());
        }
        let mut meaning = self.by_meaning(&searcher, &v, paths)?;
        meaning.truncate(depth);
        let mut fused: HashMap<DocAddress, f32> = HashMap::new();
        for (place, (_, addr)) in words.iter().enumerate() {
          *fused.entry(*addr).or_default() += 1.0 / (k + place as f32 + 1.0);
        }
        for (place, (_, addr)) in meaning.iter().enumerate() {
          *fused.entry(*addr).or_default() += weight / (k + place as f32 + 1.0);
        }
        let mut all: Vec<(f32, DocAddress)> = fused.into_iter().map(|(addr, s)| (s, addr)).collect();
        all.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        all.truncate(limit);
        all
      }
      (Ranking::Reranked { depth }, Some(v)) => {
        let words = self.by_words(&searcher, q, depth.max(limit), paths, typing)?;
        let dim = v.len();
        let held = self.vectors.read().map_err(err)?;
        let mut all: Vec<(f32, DocAddress)> = words
          .into_iter()
          .map(|(_, addr)| {
            let close = held
              .get(&searcher.segment_reader(addr.segment_ord).segment_id())
              .filter(|s| s.lengths[addr.doc_id as usize] > 0.0)
              .map(|s| dot(&v, &s.rows[addr.doc_id as usize * dim..(addr.doc_id as usize + 1) * dim]) / s.lengths[addr.doc_id as usize]);
            (close.unwrap_or(-1.0), addr)
          })
          .collect();
        all.sort_by(|a, b| b.0.total_cmp(&a.0));
        all.truncate(limit);
        all
      }
    };
    ranked
      .into_iter()
      .map(|(score, addr)| {
        let d: TantivyDocument = searcher.doc(addr).map_err(err)?;
        Ok(self.chunk(&d, score as f64))
      })
      .collect()
  }

  /// The passages of one file in reading order: all of them, or the first `limit`. Positions come
  /// from a fast column, so only the passages returned are read from disk.
  pub fn chunks(&self, path: &str, limit: Option<u32>) -> Res<Vec<Chunk>> {
    let searcher = self.reader.searcher();
    let q = TermQuery::new(Term::from_field_text(self.f.path, path), IndexRecordOption::Basic);
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
  pub fn paths(&self) -> Res<Vec<String>> {
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
  pub fn size(&self) -> u32 {
    self.reader.searcher().num_docs() as u32
  }

  /// How many searchable passages have a vector in memory (none without a model)
  pub fn vector_count(&self) -> usize {
    let searcher = self.reader.searcher();
    let Ok(held) = self.vectors.read() else { return 0 };
    let mut n = 0;
    for seg in searcher.segment_readers() {
      let Some(v) = held.get(&seg.segment_id()) else { continue };
      let alive = seg.alive_bitset();
      n += (0..seg.max_doc()).filter(|&d| v.lengths[d as usize] > 0.0 && alive.map(|a| a.is_alive(d)).unwrap_or(true)).count();
    }
    n
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

/// A segment's vector column, laid out a row per document
fn read_vectors(seg: &SegmentReader, dim: usize) -> tantivy::Result<SegmentVectors> {
  let docs = seg.max_doc() as usize;
  let mut out = SegmentVectors { rows: vec![0; docs * dim], lengths: vec![0.0; docs] };
  let Some(column) = seg.fast_fields().bytes(VECTOR)? else { return Ok(out) };
  let mut bytes = Vec::with_capacity(dim);
  for doc in 0..docs {
    let Some(ord) = column.ords().first(doc as u32) else { continue };
    bytes.clear();
    if !column.ord_to_bytes(ord, &mut bytes)? || bytes.len() != dim {
      continue;
    }
    let row = &mut out.rows[doc * dim..(doc + 1) * dim];
    for (r, b) in row.iter_mut().zip(&bytes) {
      *r = *b as i8;
    }
    out.lengths[doc] = row.iter().map(|x| (*x as f32) * (*x as f32)).sum::<f32>().sqrt();
  }
  Ok(out)
}
