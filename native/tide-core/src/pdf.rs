//! A PDF's text, page by page, through PDFium (the library Chrome reads PDFs with). PDFium is a
//! separate dynamic library, loaded the first time it is asked for; it must only be used by one
//! thread at a time, so all PDF work happens on one thread of its own (see `Worker`). Free of Node.

use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;

use pdfium_render::prelude::*;

pub enum Source {
  Path(String),
  Bytes(Vec<u8>),
}

pub struct PdfText {
  pub pages: Vec<String>,
  /// How many pages the file has (more than `pages` when only the first few were read)
  pub num_pages: u32,
  pub title: Option<String>,
}

/// Binds the PDFium library at `lib` (the dylib itself). Only one PDFium can be bound in a process.
pub fn bind(lib: &str) -> Result<Pdfium, String> {
  if !Path::new(lib).exists() {
    return Err(format!("PDFium isn't at {lib}"));
  }
  let bindings = Pdfium::bind_to_library(lib).map_err(|e| format!("PDFium didn't load: {e:?}"))?;
  Ok(Pdfium::new(bindings))
}

/// The same tidying the pdf.js reader did: runs of spaces and tabs become one space, ends trimmed.
/// PDFium also ends lines with \r\n and marks hyphenation and some breaks with control characters.
pub fn tidy(raw: &str) -> String {
  let mut out = String::with_capacity(raw.len());
  let mut space = false;
  let mut chars = raw.chars().peekable();
  while let Some(c) = chars.next() {
    let c = match c {
      '\r' => {
        if chars.peek() == Some(&'\n') {
          continue;
        }
        '\n'
      }
      '\u{2}' | '\u{0}' | '\u{feff}' | '\u{fffe}' => continue,
      '\t' | '\u{a0}' => ' ',
      c if c.is_control() && c != '\n' => continue,
      c => c,
    };
    if c == ' ' {
      if !space {
        out.push(' ');
      }
      space = true;
    } else {
      space = false;
      out.push(c);
    }
  }
  out.trim().to_string()
}

/// The text of each page, the first `max_pages` only if given
pub fn read(pdfium: &Pdfium, src: &Source, max_pages: Option<u32>) -> Result<PdfText, String> {
  let doc = match src {
    Source::Path(p) => pdfium.load_pdf_from_file(p, None),
    Source::Bytes(b) => pdfium.load_pdf_from_byte_slice(b, None),
  }
  .map_err(|e| format!("PDFium couldn't open the PDF: {e:?}"))?;
  let pages = doc.pages();
  let num_pages = pages.len() as u32;
  let n = max_pages.map_or(num_pages, |m| m.min(num_pages));
  let mut out = Vec::with_capacity(n as usize);
  for i in 0..n {
    // A page that can't be read is an empty page, as with pdf.js, rather than a lost book
    let text = pages.get(i as i32).ok().and_then(|p| p.text().ok().map(|t| t.all())).unwrap_or_default();
    out.push(tidy(&text));
  }
  let title = doc.metadata().get(PdfDocumentMetadataTagType::Title).map(|t| t.value().trim().to_string()).filter(|t| !t.is_empty());
  Ok(PdfText { pages: out, num_pages, title })
}

pub type Done = Box<dyn FnOnce(Result<PdfText, String>) + Send>;

struct Job {
  lib: String,
  src: Source,
  max_pages: Option<u32>,
  done: Done,
}

/// The one thread that talks to PDFium. Jobs queue in order; each answers through its callback.
pub struct Worker {
  tx: Mutex<mpsc::Sender<Job>>,
}

impl Worker {
  pub fn start() -> Worker {
    let (tx, rx) = mpsc::channel::<Job>();
    thread::Builder::new()
      .name("tide-pdfium".into())
      .spawn(move || {
        // Bound on first use; a failure is kept, so a missing library is reported, not retried each time
        let mut pdfium: Option<Result<Pdfium, String>> = None;
        for job in rx {
          let lib = pdfium.get_or_insert_with(|| bind(&job.lib));
          let result = match lib {
            Ok(p) => std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read(p, &job.src, job.max_pages))).unwrap_or_else(|_| Err("PDFium failed on this PDF".into())),
            Err(e) => Err(e.clone()),
          };
          (job.done)(result);
        }
      })
      .expect("the PDF thread starts");
    Worker { tx: Mutex::new(tx) }
  }

  pub fn submit(&self, lib: String, src: Source, max_pages: Option<u32>, done: Done) {
    let job = Job { lib, src, max_pages, done };
    let tx = match self.tx.lock() {
      Ok(g) => g.clone(),
      Err(poisoned) => poisoned.into_inner().clone(),
    };
    if let Err(mpsc::SendError(job)) = tx.send(job) {
      (job.done)(Err("the PDF thread stopped".into()));
    }
  }
}
