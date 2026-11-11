//! A static embedding model (the model2vec family, e.g. `minishlab/potion-base-8M`): a table with
//! one vector per word piece, and a passage's vector is the mean of its pieces'. No network runs,
//! so embedding costs about as much as tokenising. The table is mapped from disk rather than read,
//! so only the rows a text touches are ever in memory.

use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use memmap2::Mmap;
use unicode_categories::UnicodeCategories;
use unicode_normalization::UnicodeNormalization;

/// As the reference implementation: a text is read up to this many word pieces
const MAX_PIECES: usize = 512;
/// A longer run of letters is not a word (WordPiece's own limit)
const MAX_WORD_CHARS: usize = 100;

pub struct Model {
  /// Pieces that start a word, and pieces that continue one (stored without their `##`)
  start: HashMap<Box<str>, u32>,
  cont: HashMap<Box<str>, u32>,
  table: Mmap,
  /// Where the table's numbers begin in the file
  offset: usize,
  rows: usize,
  dim: usize,
  /// Folder name, vocabulary and width: an index built with another model is rebuilt
  id: String,
}

fn bad<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
  move |e| format!("embedding model: {what}: {e}")
}

impl Model {
  /// Loads `model.safetensors` and `tokenizer.json` from `dir`
  pub fn load(dir: &Path) -> Result<Model, String> {
    let tok: serde_json::Value =
      serde_json::from_slice(&std::fs::read(dir.join("tokenizer.json")).map_err(bad("tokenizer.json"))?).map_err(bad("tokenizer.json"))?;
    if tok["model"]["type"] != "WordPiece" || tok["normalizer"]["type"] != "BertNormalizer" || tok["normalizer"]["lowercase"] != true {
      return Err("embedding model: only uncased WordPiece tokenisers are supported".into());
    }
    let vocab = tok["model"]["vocab"].as_object().ok_or("embedding model: tokenizer.json has no vocabulary")?;
    let unk = tok["model"]["unk_token"].as_str().unwrap_or("[UNK]");
    let (mut start, mut cont) = (HashMap::new(), HashMap::new());
    for (piece, id) in vocab {
      let id = id.as_u64().ok_or("embedding model: a vocabulary entry has no number")? as u32;
      // The unknown piece is left out, so a word that can't be spelled adds nothing to the mean
      if piece == unk {
        continue;
      }
      match piece.strip_prefix("##") {
        Some(rest) if !rest.is_empty() => cont.insert(rest.into(), id),
        _ => start.insert(piece.as_str().into(), id),
      };
    }

    let file = File::open(dir.join("model.safetensors")).map_err(bad("model.safetensors"))?;
    // Read-only and private: the file is never written through this mapping
    let table = unsafe { Mmap::map(&file) }.map_err(bad("model.safetensors"))?;
    let head_len = table.get(..8).map(|b| u64::from_le_bytes(b.try_into().unwrap()) as usize).ok_or("embedding model: model.safetensors is empty")?;
    let head: serde_json::Value = serde_json::from_slice(table.get(8..8 + head_len).ok_or("embedding model: model.safetensors is cut short")?).map_err(bad("model.safetensors"))?;
    let t = &head["embeddings"];
    let shape: Vec<usize> = t["shape"].as_array().map(|a| a.iter().filter_map(|v| v.as_u64().map(|n| n as usize)).collect()).unwrap_or_default();
    if t["dtype"] != "F32" || shape.len() != 2 {
      return Err("embedding model: expected one 32-bit float table named `embeddings`".into());
    }
    let (rows, dim) = (shape[0], shape[1]);
    let offset = 8 + head_len + t["data_offsets"][0].as_u64().unwrap_or(0) as usize;
    if dim == 0 || table.len() < offset + rows * dim * 4 {
      return Err("embedding model: model.safetensors is cut short".into());
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Model { start, cont, table, offset, rows, dim, id: format!("{name}:{rows}x{dim}") })
  }

  pub fn dim(&self) -> usize {
    self.dim
  }

  pub fn id(&self) -> &str {
    &self.id
  }

  /// The word pieces of `text`, as the reference BERT tokeniser splits them (unknown words dropped)
  pub fn pieces(&self, text: &str) -> Vec<u32> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut chars: Vec<(usize, char)> = Vec::new();
    let mut flush = |word: &mut String, out: &mut Vec<u32>| {
      if !word.is_empty() {
        self.word_pieces(word, &mut chars, out);
        word.clear();
      }
    };
    // Cleaned, accents removed, lower-cased; then split at spaces, with every punctuation mark
    // (and every Chinese character) a word of its own
    let cleaned = text.chars().filter(|&c| !(c == '\0' || c == '\u{fffd}' || is_control(c)));
    for c in cleaned.nfd().filter(|c| !c.is_mark_nonspacing()).flat_map(char::to_lowercase) {
      if out.len() >= MAX_PIECES {
        break;
      }
      if c.is_whitespace() {
        flush(&mut word, &mut out);
      } else if c.is_ascii_punctuation() || c.is_punctuation() || is_chinese(c) {
        flush(&mut word, &mut out);
        word.push(c);
        flush(&mut word, &mut out);
      } else {
        word.push(c);
      }
    }
    flush(&mut word, &mut out);
    out.truncate(MAX_PIECES);
    out
  }

  /// Longest piece first, from the left; a word with a part that isn't in the vocabulary is unknown
  fn word_pieces(&self, word: &str, chars: &mut Vec<(usize, char)>, out: &mut Vec<u32>) {
    chars.clear();
    chars.extend(word.char_indices());
    if chars.len() > MAX_WORD_CHARS {
      return;
    }
    let before = out.len();
    let ends: Vec<usize> = chars.iter().skip(1).map(|(i, _)| *i).chain([word.len()]).collect();
    let mut at = 0;
    while at < chars.len() {
      let from = chars[at].0;
      let vocab = if at == 0 { &self.start } else { &self.cont };
      let found = (at..chars.len()).rev().find_map(|end| vocab.get(&word[from..ends[end]]).map(|id| (end, *id)));
      match found {
        Some((end, id)) => {
          out.push(id);
          at = end + 1;
        }
        None => {
          out.truncate(before);
          return;
        }
      }
    }
  }

  /// The unit-length vector for `text`, or `None` when no word of it is in the vocabulary
  pub fn embed(&self, text: &str) -> Option<Vec<f32>> {
    let ids = self.pieces(text);
    let mut sum = vec![0f32; self.dim];
    let mut n = 0;
    for id in ids {
      let id = id as usize;
      if id >= self.rows {
        continue;
      }
      let row = &self.table[self.offset + id * self.dim * 4..self.offset + (id + 1) * self.dim * 4];
      for (s, b) in sum.iter_mut().zip(row.chunks_exact(4)) {
        *s += f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
      }
      n += 1;
    }
    let norm = sum.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n == 0 || norm == 0.0 || !norm.is_finite() {
      return None;
    }
    sum.iter_mut().for_each(|x| *x /= norm);
    Some(sum)
  }
}

fn is_control(c: char) -> bool {
  !matches!(c, '\t' | '\n' | '\r') && c.is_other()
}

fn is_chinese(c: char) -> bool {
  matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0x2A700..=0x2B73F | 0x2B740..=0x2B81F | 0x2B920..=0x2CEAF | 0xF900..=0xFAFF | 0x2F800..=0x2FA1F)
}

/// A unit vector as one signed byte per number, scaled so its largest is 127: a quarter of the
/// size, and the angle to another vector is all but unchanged
pub fn quantise(v: &[f32]) -> Vec<u8> {
  let max = v.iter().fold(0f32, |m, x| m.max(x.abs()));
  if max == 0.0 {
    return Vec::new();
  }
  v.iter().map(|x| (x / max * 127.0).round() as i8 as u8).collect()
}

/// The dot product of a query with a quantised passage
#[inline]
pub fn dot(q: &[f32], bytes: &[i8]) -> f32 {
  q.iter().zip(bytes).map(|(a, b)| a * *b as f32).sum()
}
