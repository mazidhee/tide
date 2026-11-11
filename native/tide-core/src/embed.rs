//! The app's module has no embedding model: searching by meaning as well as by words was measured
//! on the books (examples/retrieval, scripts/eval/retrieval.json) and found too little more to be
//! worth a model. This stands where one would go. A `Model` can never exist here, so every path
//! in the index that would use one is compiled away, and the module carries no code, tables or
//! crates for it. The real thing, for the evaluation, is examples/retrieval/embed.rs.

use std::path::Path;

pub enum Model {}

impl Model {
  pub fn load(_dir: &Path) -> Result<Model, String> {
    Err("this build of tide-core has no embedding model".into())
  }

  pub fn dim(&self) -> usize {
    match *self {}
  }

  pub fn id(&self) -> &str {
    match *self {}
  }

  pub fn embed(&self, _text: &str) -> Option<Vec<f32>> {
    match *self {}
  }
}

pub fn quantise(_v: &[f32]) -> Vec<u8> {
  Vec::new()
}

pub fn dot(_q: &[f32], _bytes: &[i8]) -> f32 {
  0.0
}
