//! Reading a PDF's text through PDFium, on PDFium's own thread, without Node:
//!
//!   cargo test --release --test pdf
//!
//! Needs PDFium in native/pdfium (`npm run pdfium`); without it the tests say so and pass.

#[allow(dead_code)]
#[path = "../src/pdf.rs"]
mod pdf;

use std::path::PathBuf;
use std::sync::mpsc;

/// A small PDF, one page per string, each line of text drawn in Helvetica
pub fn make_pdf(pages: &[&[&str]]) -> Vec<u8> {
  let mut objects: Vec<String> = Vec::new();
  let n = pages.len();
  // 1: catalog, 2: pages, 3: font, then a page and its contents for each page
  objects.push("<< /Type /Catalog /Pages 2 0 R >>".into());
  let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 4 + i * 2)).collect();
  objects.push(format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")));
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into());
  for (i, lines) in pages.iter().enumerate() {
    objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>", 5 + i * 2));
    let mut stream = String::from("BT /F1 12 Tf 14 TL 72 720 Td");
    for l in lines.iter() {
      stream.push_str(&format!(" ({}) Tj T*", l.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")));
    }
    stream.push_str(" ET");
    objects.push(format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()));
  }
  let mut out = b"%PDF-1.4\n".to_vec();
  let mut offsets = Vec::new();
  for (i, o) in objects.iter().enumerate() {
    offsets.push(out.len());
    out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
  }
  let xref = out.len();
  out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
  for o in offsets {
    out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
  }
  out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
  out
}

fn lib() -> Option<String> {
  let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../pdfium/libpdfium.dylib");
  if p.exists() {
    Some(p.to_string_lossy().into_owned())
  } else {
    eprintln!("PDFium isn't in native/pdfium (npm run pdfium): skipping");
    None
  }
}

fn ask(w: &pdf::Worker, lib: &str, src: pdf::Source, max: Option<u32>) -> Result<pdf::PdfText, String> {
  let (tx, rx) = mpsc::channel();
  w.submit(lib.to_string(), src, max, Box::new(move |r| tx.send(r).unwrap()));
  rx.recv().unwrap()
}

#[test]
fn tidies_text_as_the_pdf_js_reader_did() {
  assert_eq!(pdf::tidy("  a \t b\r\nc\u{2}d\re  "), "a b\ncd\ne");
}

// One test, so PDFium is bound once, by the worker, as in the app
#[test]
fn reads_pages_from_files_and_memory_on_its_own_thread() {
  let w = pdf::Worker::start();
  let Some(lib) = lib() else {
    // Without the library, every job is refused with a reason (the app then uses pdf.js)
    let e = ask(&w, "/nowhere/libpdfium.dylib", pdf::Source::Bytes(vec![]), None).err().unwrap();
    assert!(e.contains("isn't at"));
    return;
  };
  let bytes = make_pdf(&[&["Page one says hello.", "Second line (with brackets)."], &[], &["The third page."]]);
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join("small.pdf");
  std::fs::write(&path, &bytes).unwrap();

  let t = ask(&w, &lib, pdf::Source::Path(path.to_string_lossy().into_owned()), None).unwrap();
  assert_eq!(t.num_pages, 3);
  assert_eq!(t.pages, vec!["Page one says hello.\nSecond line (with brackets).".to_string(), String::new(), "The third page.".to_string()]);

  let first = ask(&w, &lib, pdf::Source::Bytes(bytes), Some(1)).unwrap();
  assert_eq!((first.pages.len(), first.num_pages), (1, 3));

  // Not a PDF, and a file that isn't there: errors, and the thread carries on
  assert!(ask(&w, &lib, pdf::Source::Bytes(b"not a pdf".to_vec()), None).is_err());
  assert!(ask(&w, &lib, pdf::Source::Path("/nowhere.pdf".into()), None).is_err());
  assert_eq!(ask(&w, &lib, pdf::Source::Path(path.to_string_lossy().into_owned()), None).unwrap().pages.len(), 3);
}
