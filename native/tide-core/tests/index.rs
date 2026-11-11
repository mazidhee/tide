//! The index as the app's module builds it (no embedding model), without Node:
//!
//!   cargo test --release --test index

#[allow(dead_code)]
#[path = "../src/embed.rs"]
mod embed;
#[allow(dead_code)]
#[path = "../src/index.rs"]
mod index;

use index::{ChunkIn, Core, Titles};

fn passage(path: &str, n: u32, heading: &str, text: &str) -> ChunkIn {
  ChunkIn { id: format!("{path}#{n}"), title: path.trim_end_matches(".md").to_string(), heading: heading.to_string(), text: text.to_string(), order: n }
}

#[test]
fn finds_passages_follows_edits_and_deletions_and_is_there_after_a_restart() {
  let dir = tempfile::tempdir().unwrap();
  let first = Core::open(dir.path(), None).unwrap();
  first
    .replace("Binary.md", vec![passage("Binary.md", 0, "Binary", "Two's complement stores a negative number by inverting the bits and adding one."), passage("Binary.md", 1, "Hexadecimal", "Each hex digit is four bits.")])
    .unwrap();
  first.replace("Primes.md", vec![passage("Primes.md", 0, "Primes", "A prime has exactly two divisors.")]).unwrap();
  // Nothing is searchable until it is committed
  assert_eq!(first.size(), 0);
  first.commit().unwrap();
  assert_eq!(first.size(), 3);
  assert_eq!(first.search("complement negative", 20, None, false).unwrap()[0].path, "Binary.md");
  assert_eq!(first.search("complment", 20, None, false).unwrap()[0].path, "Binary.md");
  // The start of a word matches only in a search box being typed into
  assert!(first.search("hexa", 20, None, true).unwrap().iter().any(|c| c.heading == "Hexadecimal"));
  assert!(first.search("hexa", 20, None, false).unwrap().is_empty());
  assert!(first.search("bits", 5, Some(&["Primes.md".to_string()]), false).unwrap().is_empty());
  assert!(first.search("bits", 5, Some(&[]), false).unwrap().is_empty());
  assert!(first.search("bits", 0, None, false).unwrap().is_empty());
  assert!(first.search("?!", 5, None, false).unwrap().is_empty());
  let headings = |c: &Core, limit| c.chunks("Binary.md", limit).unwrap().into_iter().map(|c| c.heading).collect::<Vec<_>>();
  assert_eq!(headings(&first, None), ["Binary", "Hexadecimal"]);
  assert_eq!(headings(&first, Some(1)), ["Binary"]);

  first.replace("Primes.md", vec![passage("Primes.md", 0, "Primes", "The sieve of Eratosthenes crosses out multiples.")]).unwrap();
  first.remove("Binary.md").unwrap();
  first.commit().unwrap();
  assert_eq!(first.search("sieve", 20, None, false).unwrap()[0].path, "Primes.md");
  assert!(first.search("divisors", 20, None, false).unwrap().is_empty());
  assert!(first.search("complement", 20, None, false).unwrap().is_empty());
  assert_eq!(first.paths().unwrap(), ["Primes.md"]);
  drop(first);

  let again = Core::open(dir.path(), None).unwrap();
  assert_eq!(again.size(), 1);
  assert_eq!(again.search("sieve", 20, None, false).unwrap()[0].path, "Primes.md");
  assert_eq!(again.vector_count(), 0);
  again.clear().unwrap();
  again.commit().unwrap();
  assert_eq!(again.size(), 0);
  assert!(again.paths().unwrap().is_empty());
}

/// A book's file name is the title of every one of its pages. Weighed as a note's title is, a
/// book with a common word in its name ("number") came first for any question using that word.
#[test]
fn a_book_whose_name_shares_a_word_with_the_question_does_not_flood_the_results() {
  let dir = tempfile::tempdir().unwrap();
  let core = Core::open(dir.path(), None).unwrap();
  let page = |path: &str, n: u32, text: String| ChunkIn { id: format!("{path}#p{n}-0"), title: path.trim_end_matches(".pdf").to_string(), heading: format!("Page {n}"), text, order: n };
  let survey = "Survey of Number Representations for Computer Arithmetic.pdf";
  core.replace(survey, (1..=60).map(|n| page(survey, n, format!("Residue arithmetic, radix conversion and carry propagation for fixed point operands, part {n}."))).collect()).unwrap();
  // Other books use the question's everyday words on most pages, as real ones do
  let common = ["variables", "name", "rules", "python", "start", "spaces", "contain", "number"];
  for book in ["Cooking.pdf", "Garden Almanac.pdf", "Sailing Knots.pdf", "Bread.pdf", "Chess Openings.pdf"] {
    let pages = (1..=100u32).map(|n| {
      let words: Vec<&str> = (0..7).map(|k| common[(n as usize + k) % common.len()]).collect();
      page(book, n, format!("Chapter notes {n}: what are the {} for a reader, in a hurry or with time, can vary, and other remarks fill out the page to an ordinary length.", words.join(", ")))
    });
    core.replace(book, pages.collect()).unwrap();
  }
  let course = "pythoncrashcourse.pdf";
  core
    .replace(course, vec![page(course, 54, "Rules for naming variables in Python: variable names can contain only letters, numbers and underscores. A name can start with a letter or an underscore, but not with a number. Spaces are not allowed in variable names.".into())])
    .unwrap();
  core.commit().unwrap();

  let question = "What are the rules for naming variables in Python? Can a variable name start with a number or contain spaces?";
  let top = |c: &Core| c.search(question, 3, None, false).unwrap().into_iter().map(|c| c.path).collect::<Vec<_>>();
  assert_eq!(top(&core)[0], course);
  // As it was, with a book's title weighed like a note's: the flood this guards against
  core.set_titles(Titles { note: 3.0, book: 3.0, once: false });
  assert_eq!(top(&core), [survey, survey, survey]);
}

/// A note's title says what the note is about, and still counts in full
#[test]
fn a_note_is_still_found_by_its_title_ahead_of_a_passing_mention() {
  let dir = tempfile::tempdir().unwrap();
  let core = Core::open(dir.path(), None).unwrap();
  core.replace("Eigenvalues.md", vec![passage("Eigenvalues.md", 0, "", "Scalars that a matrix stretches certain vectors by.")]).unwrap();
  core.replace("Diary.md", vec![passage("Diary.md", 0, "", "Today I revised eigenvalues, eigenvalues and more eigenvalues before lunch.")]).unwrap();
  core.replace("Strang.pdf", vec![ChunkIn { id: "Strang.pdf#p1-0".into(), title: "Strang".into(), heading: "Page 1".into(), text: "The eigenvalues of a triangular matrix are on its diagonal.".into(), order: 0 }]).unwrap();
  core.commit().unwrap();
  assert_eq!(core.search("eigenvalues", 3, None, false).unwrap()[0].path, "Eigenvalues.md");
}

#[test]
fn the_index_on_disk_is_the_one_from_before_vectors() {
  // Schema version "1" and the six fields: an index made by an earlier Tide opens as it is
  let dir = tempfile::tempdir().unwrap();
  let core = Core::open(dir.path(), None).unwrap();
  core.replace("a.md", vec![passage("a.md", 0, "A", "alpha")]).unwrap();
  core.commit().unwrap();
  assert_eq!(std::fs::read_to_string(dir.path().join("tide-schema")).unwrap(), "1");
  let meta = std::fs::read_to_string(dir.path().join("meta.json")).unwrap();
  let fields: Vec<&str> = meta.match_indices("\"name\":").map(|(i, _)| meta[i + 7..].split('"').nth(1).unwrap()).collect();
  assert_eq!(fields, ["id", "path", "title", "heading", "text", "order"]);
  // And asking this build for a model fails, rather than quietly searching without one
  assert!(Core::open(dir.path(), Some(std::path::Path::new("/nowhere"))).is_err());
}
