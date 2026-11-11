//! The bindings for reading PDFs (`pdf.rs`): Promises, the work done on PDFium's own thread, off
//! Node's main thread.

use std::sync::OnceLock;

use napi::bindgen_prelude::*;
use napi::{Env, JsObject};
use napi_derive::napi;

use crate::pdf;

#[napi(object)]
pub struct PdfPages {
  pub pages: Vec<String>,
  pub num_pages: u32,
  pub title: Option<String>,
}

static WORKER: OnceLock<pdf::Worker> = OnceLock::new();

type Resolve = Box<dyn FnOnce(Env) -> Result<PdfPages> + Send>;

fn pdf_job(env: Env, lib: String, src: pdf::Source, max_pages: Option<u32>) -> Result<JsObject> {
  let (deferred, promise) = env.create_deferred::<PdfPages, Resolve>()?;
  WORKER.get_or_init(pdf::Worker::start).submit(
    lib,
    src,
    max_pages,
    Box::new(move |r| match r {
      Ok(t) => deferred.resolve(Box::new(move |_| Ok(PdfPages { pages: t.pages, num_pages: t.num_pages, title: t.title }))),
      Err(e) => deferred.reject(Error::from_reason(e)),
    }),
  );
  Ok(promise)
}

/// The text of each page of the PDF at `path` (the first `maxPages` if given), read by the PDFium
/// library at `lib`. Rejects if PDFium can't be loaded or can't read the file.
#[napi(js_name = "pdfText", ts_return_type = "Promise<PdfPages>")]
pub fn pdf_text(env: Env, lib: String, path: String, max_pages: Option<u32>) -> Result<JsObject> {
  pdf_job(env, lib, pdf::Source::Path(path), max_pages)
}

/// As `pdfText`, for a PDF already in memory (one read from the web)
#[napi(js_name = "pdfTextFromBytes", ts_return_type = "Promise<PdfPages>")]
pub fn pdf_text_from_bytes(env: Env, lib: String, data: Buffer, max_pages: Option<u32>) -> Result<JsObject> {
  pdf_job(env, lib, pdf::Source::Bytes(data.to_vec()), max_pages)
}
