//! The binding for reading web pages (`extract.rs`): a Promise, the work done on libuv's pool, off
//! Node's main thread.

use std::collections::HashMap;

use napi::bindgen_prelude::*;
use napi::{Env, Task};
use napi_derive::napi;

use crate::extract;

#[napi(object)]
pub struct Article {
  pub title: String,
  pub doc_title: String,
  pub byline: Option<String>,
  pub site_name: Option<String>,
  pub excerpt: Option<String>,
  pub published: Option<String>,
  pub lang: Option<String>,
  pub image: Option<String>,
  pub text: String,
  pub content: String,
  pub formulas: Vec<String>,
  pub meta: HashMap<String, String>,
}

pub struct ExtractTask {
  html: String,
  url: String,
}

impl Task for ExtractTask {
  type Output = extract::Page;
  type JsValue = Article;

  fn compute(&mut self) -> Result<Self::Output> {
    let html = std::mem::take(&mut self.html);
    std::panic::catch_unwind(|| extract::extract(&html, &self.url)).unwrap_or_else(|_| Err("the reader failed on this page".into())).map_err(Error::from_reason)
  }

  fn resolve(&mut self, _env: Env, p: Self::Output) -> Result<Self::JsValue> {
    Ok(Article {
      title: p.title,
      doc_title: p.doc_title,
      byline: p.byline,
      site_name: p.site_name,
      excerpt: p.excerpt,
      published: p.published,
      lang: p.lang,
      image: p.image,
      text: p.text,
      content: p.content,
      formulas: p.formulas,
      meta: p.meta.into_iter().collect(),
    })
  }
}

/// The article in a page's HTML: title, byline, text (formulas as $TeX$) and its HTML (formulas as
/// TIDEMATH<n>X placeholders, with `formulas` to put back once it is Markdown)
#[napi(js_name = "extractArticle")]
pub fn extract_article(html: String, url: String) -> AsyncTask<ExtractTask> {
  AsyncTask::new(ExtractTask { html, url })
}
