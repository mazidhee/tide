//! The index with an embedding model, as the evaluation runs it (the app's module has none). These
//! need a model on disk, so they pass without looking when there isn't one:
//!
//!   TIDE_MODEL=models/potion-base-8M [TIDE_PAGES=<vault>/.tide/pdftext] \
//!     cargo test --release --test vectors -- --nocapture

#[allow(dead_code)]
#[path = "../examples/retrieval/embed.rs"]
mod embed;
#[allow(dead_code)]
#[path = "../src/index.rs"]
mod index;

use std::path::PathBuf;

use embed::Model;
use index::{ChunkIn, Core, Ranking};

fn model_dir() -> Option<PathBuf> {
  let dir = std::env::var_os("TIDE_MODEL").map(PathBuf::from);
  if dir.is_none() {
    eprintln!("TIDE_MODEL not set: skipped");
  }
  dir
}

const SAMPLES: &[&str] = &[
  "Two's complement stores a negative number by inverting the bits and adding one.",
  "naïve café — “quoted”, it’s soft‐hyphen func‐ tions, x₁ + 2x₂ ≤ λ·v; A = QS, B⁻¹",
  "std::vector<bool>::reference, __init__.py, R_386_PC32, players[-3:] and 0xDEADBEEF\t\ttabs\r\nnewlines",
  "中文 mixed with English, ελληνικά, кириллица, and an emoji 🙂 plus a\u{0}null and \u{200b}zero-width",
  "",
  "   ",
  "Pneumonoultramicroscopicsilicovolcanoconiosisandthenmuchmuchmuchmorethanahundredcharacterslongwordwithoutanyspacesatall end",
];

/// The evaluation splits text into word pieces with its own few lines rather than the
/// `tokenizers` crate (dozens of crates, were it ever shipped): the two must agree piece for piece
#[test]
fn pieces_match_the_reference_tokeniser() {
  let Some(dir) = model_dir() else { return };
  let model = Model::load(&dir).expect("model");
  let reference = tokenizers::Tokenizer::from_file(dir.join("tokenizer.json")).expect("tokenizer.json");
  let unknown = reference.token_to_id("[UNK]").expect("an unknown piece");
  let mut texts: Vec<String> = SAMPLES.iter().map(|s| s.to_string()).collect();
  if let Some(pages) = std::env::var_os("TIDE_PAGES") {
    for entry in std::fs::read_dir(pages).expect("pages folder").flatten() {
      if entry.path().extension().is_some_and(|e| e == "json") {
        let book: Vec<String> = serde_json::from_slice(&std::fs::read(entry.path()).unwrap()).unwrap();
        texts.extend(book);
      }
    }
  }
  let mut pieces = 0;
  for text in &texts {
    let mut want: Vec<u32> = reference.encode(text.as_str(), false).expect("encode").get_ids().iter().copied().filter(|id| *id != unknown).collect();
    want.truncate(512);
    let got = model.pieces(text);
    assert_eq!(got, want, "pieces differ for {:?}", text.chars().take(200).collect::<String>());
    pieces += got.len();
  }
  eprintln!("{} texts, {} pieces: identical", texts.len(), pieces);
}

#[test]
fn a_vector_has_unit_length_and_survives_quantising() {
  let Some(dir) = model_dir() else { return };
  let model = Model::load(&dir).expect("model");
  assert!(model.embed("").is_none());
  let a = model.embed("How does a hash table handle two keys landing in the same slot?").unwrap();
  let b = model.embed("Collisions are resolved by chaining: each cell holds a linked list.").unwrap();
  let c = model.embed("Preheat the oven and whisk the eggs with sugar.").unwrap();
  assert!((a.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-4);
  let cos = |x: &[f32], y: &[f32]| x.iter().zip(y).map(|(p, q)| p * q).sum::<f32>();
  assert!(cos(&a, &b) > cos(&a, &c));
  // One signed byte per number moves the cosine by well under a hundredth
  let q: Vec<i8> = embed::quantise(&b).into_iter().map(|x| x as i8).collect();
  let length = q.iter().map(|x| (*x as f32).powi(2)).sum::<f32>().sqrt();
  assert!((embed::dot(&a, &q) / length - cos(&a, &b)).abs() < 0.01);
}

fn passage(path: &str, n: u32, text: &str) -> ChunkIn {
  ChunkIn { id: format!("{path}#{n}"), title: path.to_string(), heading: String::new(), text: text.to_string(), order: n }
}

/// A passage's vector lives in its own Tantivy document, so it is replaced, removed and saved
/// with the passage, and is there again after a restart
#[test]
fn vectors_follow_replace_remove_clear_and_a_restart() {
  let Some(model) = model_dir() else { return };
  let dir = tempfile::tempdir().unwrap();
  let by_meaning = |c: &Core, q: &str| c.search_by(q, 5, None, false, Ranking::Vectors).unwrap().into_iter().map(|c| c.id).collect::<Vec<_>>();
  let core = Core::open(dir.path(), Some(&model)).unwrap();
  core.replace("hash.md", vec![passage("hash.md", 0, "Collisions are resolved by chaining: each cell of the table holds a linked list."), passage("hash.md", 1, "")]).unwrap();
  core.replace("cake.md", vec![passage("cake.md", 0, "Preheat the oven and whisk the eggs with sugar.")]).unwrap();
  assert_eq!(core.vector_count(), 0);
  core.commit().unwrap();
  // The empty passage is indexed but has no vector
  assert_eq!((core.size(), core.vector_count()), (3, 2));
  let question = "what happens when two keys land in the same slot";
  assert_eq!(by_meaning(&core, question)[0], "hash.md#0");
  // Only within the paths asked for
  assert_eq!(by_meaning(&core, question).len(), 2);
  assert_eq!(core.search_by(question, 5, Some(&["cake.md".to_string()]), false, Ranking::Vectors).unwrap().len(), 1);
  // A search box being typed into is matched by words alone; nothing shares a word, nothing shows
  assert!(core.search("zzzz", 5, None, true).unwrap().is_empty());
  assert!(core.search("zzzz", 5, None, false).unwrap().is_empty());
  assert_eq!(core.search("two keys in the same slot of the table", 5, None, false).unwrap()[0].id, "hash.md#0");

  // Replaced: the old vector is gone with the old passage, the new one found
  core.replace("hash.md", vec![passage("hash.md", 0, "Bake the sponge for twenty minutes, then let it cool.")]).unwrap();
  core.commit().unwrap();
  assert_eq!((core.size(), core.vector_count()), (2, 2));
  assert!(by_meaning(&core, "how long does the cake stay in the oven").iter().all(|id| id == "hash.md#0" || id == "cake.md#0"));
  assert_eq!(by_meaning(&core, "how long does the cake stay in the oven").len(), 2);

  core.remove("cake.md").unwrap();
  core.commit().unwrap();
  assert_eq!((core.size(), core.vector_count()), (1, 1));
  assert_eq!(by_meaning(&core, question), ["hash.md#0"]);
  drop(core);

  // A restart: the vectors are read back from the index, nothing is embedded again
  let again = Core::open(dir.path(), Some(&model)).unwrap();
  assert_eq!((again.size(), again.vector_count()), (1, 1));
  assert_eq!(by_meaning(&again, question), ["hash.md#0"]);
  again.clear().unwrap();
  again.commit().unwrap();
  assert_eq!((again.size(), again.vector_count()), (0, 0));
  assert!(by_meaning(&again, question).is_empty());
  drop(again);

  // Opened without the model, an index with vectors is thrown away and started again by words
  let plain = Core::open(dir.path(), None).unwrap();
  assert_eq!(plain.size(), 0);
  assert_eq!(std::fs::read_to_string(dir.path().join("tide-schema")).unwrap(), "1");
}
