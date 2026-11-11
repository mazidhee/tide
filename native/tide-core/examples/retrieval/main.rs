//! Measures how well the index finds the page that answers a question, with and without an
//! embedding model, over the books' extracted text. No Electron, no Node:
//!
//!   cargo run --release --example retrieval -- \
//!     --questions ../../scripts/eval/retrieval.json --pages "<vault>/.tide/pdftext" \
//!     --index /tmp/ix [--model models/potion-base-8M] [--reuse] [--exact] [--dump out.json]
//!
//! Pages are cut into passages exactly as `chunkPdf` in src/main/search.ts cuts them, and indexed
//! and searched through the same code the app's module runs. A question is answered when a
//! passage from its page, or the page either side, is among the results.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};
// The module's own index code, compiled here with a real embedding model in place of its stand-in
#[allow(dead_code)]
#[path = "../../src/index.rs"]
mod index;
#[allow(dead_code)]
mod embed;

use index::{Chunk, ChunkIn, Core, Ranking, Titles};

/// MAX_CHUNK in src/main/search.ts, in UTF-16 units as JavaScript counts a string's length
const MAX_CHUNK: usize = 1600;
/// Books saved between commits while the app builds its index
const COMMIT_EVERY: usize = 3;
/// How deep each ranking is read to find where the right page came
const DEPTH: u32 = 50;

struct Question {
  text: String,
  kind: String,
  book: String,
  path: String,
  page: u32,
}

/// `chunkPdf`: every page in slices of 1,600, headed "Page N"
fn chunk_pdf(path: &str, pages: &[String]) -> Vec<ChunkIn> {
  let title = Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
  let mut chunks = Vec::new();
  for (i, text) in pages.iter().enumerate() {
    let units: Vec<u16> = text.encode_utf16().collect();
    for (n, slice) in units.chunks(MAX_CHUNK).enumerate() {
      chunks.push(ChunkIn {
        id: format!("{path}#p{}-{}", i + 1, n * MAX_CHUNK),
        title: title.clone(),
        heading: format!("Page {}", i + 1),
        text: String::from_utf16_lossy(slice),
        order: chunks.len() as u32,
      });
    }
  }
  chunks
}

fn peak_rss_mb() -> f64 {
  let mut u: libc::rusage = unsafe { std::mem::zeroed() };
  unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) };
  // Bytes on macOS, kilobytes on Linux
  let bytes = if cfg!(target_os = "macos") { u.ru_maxrss as f64 } else { u.ru_maxrss as f64 * 1024.0 };
  bytes / 1_048_576.0
}

fn dir_bytes(dir: &Path) -> u64 {
  std::fs::read_dir(dir).map(|d| d.flatten().map(|e| e.metadata().map(|m| if m.is_dir() { dir_bytes(&e.path()) } else { m.len() }).unwrap_or(0)).sum()).unwrap_or(0)
}

fn page_of(c: &Chunk) -> u32 {
  c.heading.strip_prefix("Page ").and_then(|n| n.parse().ok()).unwrap_or(0)
}

fn is_gold(c: &Chunk, q: &Question) -> bool {
  c.path == q.path && page_of(c).abs_diff(q.page) <= 1
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
  if sorted.is_empty() {
    return 0.0;
  }
  sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn main() {
  let args: Vec<String> = std::env::args().collect();
  let arg = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
  let flag = |name: &str| args.iter().any(|a| a == name);
  let questions_file = arg("--questions").expect("--questions <retrieval.json>");
  let pages_dir = PathBuf::from(arg("--pages").expect("--pages <folder of page-text JSON>"));
  let index_dir = PathBuf::from(arg("--index").expect("--index <folder for the index>"));
  let model_dir = arg("--model").map(PathBuf::from);
  let reuse = flag("--reuse");

  let set: Value = serde_json::from_slice(&std::fs::read(&questions_file).expect("questions file")).expect("questions JSON");
  // The path a book has in the vault gives its title, as in the app
  let mut paths: BTreeMap<String, String> = BTreeMap::new();
  for (file, b) in set["books"].as_object().expect("books") {
    let path = match (b["path"].as_str().unwrap_or(""), b["book"].as_str().unwrap_or("")) {
      ("", "") => format!("Library/PDFs/{file}.pdf"),
      ("", book) => format!("Library/PDFs/{book}.pdf"),
      (path, _) => path.to_string(),
    };
    paths.insert(file.clone(), path);
  }
  let questions: Vec<Question> = set["questions"]
    .as_array()
    .expect("questions")
    .iter()
    .map(|q| Question {
      text: q["question"].as_str().unwrap().to_string(),
      kind: q["kind"].as_str().unwrap().to_string(),
      book: q["book"].as_str().unwrap().to_string(),
      path: paths[q["file"].as_str().unwrap()].clone(),
      page: q["page"].as_u64().unwrap() as u32,
    })
    .collect();

  let mut report = json!({ "model": model_dir.as_ref().map(|m| m.file_name().unwrap().to_string_lossy().into_owned()), "questions": questions.len() });

  // ---- build ----
  if !reuse {
    let _ = std::fs::remove_dir_all(&index_dir);
  }
  let t = Instant::now();
  let core = Core::open(&index_dir, model_dir.as_deref()).expect("open index");
  report["open_ms"] = json!(t.elapsed().as_secs_f64() * 1000.0);
  report["rss_after_open_mb"] = json!(peak_rss_mb());
  if !reuse {
    let mut books = Vec::new();
    for (file, path) in &paths {
      let pages: Vec<String> = serde_json::from_slice(&std::fs::read(pages_dir.join(format!("{file}.json"))).expect("page text")).expect("page JSON");
      books.push((path.clone(), pages));
    }
    let (mut passages, mut chars) = (0usize, 0usize);
    let t = Instant::now();
    for (n, (path, pages)) in books.iter().enumerate() {
      let chunks = chunk_pdf(path, pages);
      passages += chunks.len();
      chars += chunks.iter().map(|c| c.text.len()).sum::<usize>();
      core.replace(path, chunks).expect("replace");
      if (n + 1) % COMMIT_EVERY == 0 {
        core.commit().expect("commit");
      }
    }
    core.commit().expect("commit");
    report["build_s"] = json!(t.elapsed().as_secs_f64());
    report["built_passages"] = json!(passages);
    report["built_bytes_of_text"] = json!(chars);
    report["rss_after_build_mb"] = json!(peak_rss_mb());
  }
  report["passages"] = json!(core.size());
  report["vectors"] = json!(core.vector_count());
  report["index_mb"] = json!(dir_bytes(&index_dir) as f64 / 1_048_576.0);

  // ---- rankings ----
  let mut rankings: Vec<(String, Ranking)> = vec![("words (BM25, as shipped)".into(), Ranking::Words)];
  // `--titles`: words alone, with a title's words weighed other ways
  let mut titles: Vec<Titles> = Vec::new();
  if flag("--titles") {
    for boost in [3.0, 2.0, 1.5, 1.0, 0.5, 0.0] {
      rankings.push((format!("title x{boost}"), Ranking::Words));
      titles.push(Titles { note: boost, book: boost, once: false });
    }
    for (book, once) in [(0.0, false), (1.0, false), (1.5, false), (2.0, false), (3.0, true), (2.0, true), (1.0, true)] {
      rankings.push((format!("notes x3, books x{book}{}", if once { ", once" } else { "" }), Ranking::Words));
      titles.push(Titles { note: 3.0, book, once });
    }
  } else if model_dir.is_some() {
    rankings.push(("vectors only".into(), Ranking::Vectors));
    for (k, weight) in [(60.0, 1.0), (10.0, 1.0), (60.0, 0.5), (60.0, 2.0), (20.0, 0.5)] {
      rankings.push((format!("fused k={k} w={weight}"), Ranking::Fused { k, weight, depth: DEPTH as usize }));
    }
    rankings.push(("words top 50, reranked".into(), Ranking::Reranked { depth: DEPTH as usize }));
  }

  let mut rows = Vec::new();
  let mut per_question: Vec<Value> = questions.iter().map(|q| json!({ "question": q.text, "kind": q.kind, "book": q.book, "page": q.page, "place": {}, "top": {} })).collect();
  for (n, (name, how)) in rankings.iter().enumerate() {
    if let Some(t) = n.checked_sub(1).and_then(|i| titles.get(i)) {
      core.set_titles(*t);
    }
    // Where the right page came for each question (0: not in the first 50)
    let mut places = Vec::new();
    for (i, q) in questions.iter().enumerate() {
      let hits = core.search_by(&q.text, DEPTH, None, false, *how).expect("search");
      let place = hits.iter().position(|c| is_gold(c, q)).map(|p| p + 1).unwrap_or(0);
      places.push(place);
      per_question[i]["place"][name] = json!(place);
      per_question[i]["top"][name] = json!(hits.iter().take(3).map(|c| format!("{} p{}", c.title.chars().take(28).collect::<String>(), page_of(c))).collect::<Vec<_>>());
    }
    // Timed as the app asks: the best 8, each question five times
    let mut times = Vec::new();
    for _ in 0..5 {
      for q in &questions {
        let t = Instant::now();
        let hits = core.search_by(&q.text, 8, None, false, *how).expect("search");
        times.push(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(hits);
      }
    }
    times.sort_by(f64::total_cmp);
    let mut row = json!({ "ranking": name, "p50_ms": percentile(&times, 0.5), "p95_ms": percentile(&times, 0.95) });
    for kind in ["all", "keyword", "paraphrase"] {
      let of: Vec<usize> = questions.iter().zip(&places).filter(|(q, _)| kind == "all" || q.kind == kind).map(|(_, p)| *p).collect();
      let n = of.len() as f64;
      let within = |k: usize| of.iter().filter(|&&p| p > 0 && p <= k).count();
      row[kind] = json!({
        "n": of.len(),
        "hit3": within(3), "hit8": within(8),
        "recall3": within(3) as f64 / n, "recall8": within(8) as f64 / n,
        "mrr8": of.iter().filter(|&&p| p > 0 && p <= 8).map(|&p| 1.0 / p as f64).sum::<f64>() / n,
      });
    }
    rows.push(row);
  }

  // ---- the cost of one signed byte per number: the same ranking from full 32-bit vectors ----
  if flag("--exact") {
    if let Some(model) = core.model() {
      let mut passages: Vec<(String, u32, Vec<f32>)> = Vec::new();
      for path in paths.values() {
        for c in core.chunks(path, None).expect("chunks") {
          if let Some(v) = model.embed(&c.text) {
            passages.push((c.path.clone(), page_of(&c), v));
          }
        }
      }
      let (mut hit3, mut hit8, mut mrr) = (BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
      for q in &questions {
        let Some(v) = model.embed(&q.text) else { continue };
        let mut scored: Vec<(f32, usize)> = passages.iter().enumerate().map(|(i, p)| (p.2.iter().zip(&v).map(|(a, b)| a * b).sum(), i)).collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        let place = scored.iter().take(8).position(|(_, i)| passages[*i].0 == q.path && passages[*i].1.abs_diff(q.page) <= 1).map(|p| p + 1);
        for kind in ["all", q.kind.as_str()] {
          *hit3.entry(kind.to_string()).or_insert(0) += place.is_some_and(|p| p <= 3) as usize;
          *hit8.entry(kind.to_string()).or_insert(0) += place.is_some() as usize;
          *mrr.entry(kind.to_string()).or_insert(0.0) += place.map(|p| 1.0 / p as f64).unwrap_or(0.0);
        }
      }
      report["exact_vectors"] = json!({ "hit3": hit3, "hit8": hit8, "mrr8_sum": mrr, "bytes": passages.len() * model.dim() * 4 });
    }
  }

  report["rss_peak_mb"] = json!(peak_rss_mb());
  report["rankings"] = json!(rows);

  println!("{:<26} {:>18} {:>18} {:>18} {:>8} {:>8}", "ranking", "all r@3 r@8 mrr", "keyword", "paraphrase", "p50 ms", "p95 ms");
  for row in report["rankings"].as_array().unwrap() {
    let cell = |kind: &str| format!("{:.3} {:.3} {:.3}", row[kind]["recall3"].as_f64().unwrap(), row[kind]["recall8"].as_f64().unwrap(), row[kind]["mrr8"].as_f64().unwrap());
    println!("{:<26} {:>18} {:>18} {:>18} {:>8.2} {:>8.2}", row["ranking"].as_str().unwrap(), cell("all"), cell("keyword"), cell("paraphrase"), row["p50_ms"].as_f64().unwrap(), row["p95_ms"].as_f64().unwrap());
  }
  let mut summary = report.clone();
  summary.as_object_mut().unwrap().remove("rankings");
  println!("{summary}");
  if let Some(file) = arg("--dump") {
    report["per_question"] = json!(per_question);
    std::fs::write(file, serde_json::to_vec_pretty(&report).unwrap()).expect("write dump");
  }
}
