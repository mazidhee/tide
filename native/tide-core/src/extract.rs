//! A web page's article: its title, byline and main text, found the way Firefox's reader view finds
//! it (`legible` is a port of Mozilla's Readability). Free of Node, so the tests run the code the app does.
//!
//! Formulas are taken out before the article is looked for, so nothing can mangle the TeX: each one
//! becomes a placeholder (`TIDEMATH<n>X`) in the article's HTML, which the caller turns into
//! Markdown before putting the formulas back, and `$...$` / `$$...$$` in the plain text.
//!
//! The page is only scanned as text here (tags and their attributes), never built into a tree:
//! the article finder does that once, on the prepared page.

use std::borrow::Cow;

pub struct Page {
  /// The article's title (from the page's metadata, or its <title>, cleaned of the site's name)
  pub title: String,
  /// The page's own <title>
  pub doc_title: String,
  pub byline: Option<String>,
  pub site_name: Option<String>,
  pub excerpt: Option<String>,
  pub published: Option<String>,
  pub lang: Option<String>,
  /// The preview image, as the page gives it (maybe relative)
  pub image: Option<String>,
  /// The article as plain text: blocks apart by a blank line, code as it was laid out, formulas as TeX between dollars
  pub text: String,
  /// The article as HTML, formulas as placeholders
  pub content: String,
  /// Each placeholder's formula: `$tex$`, or `\n\n$$tex$$\n\n` for one on its own line
  pub formulas: Vec<String>,
  /// The <meta> tags asked for in `META`, by property or name, the first of each: (name, content)
  pub meta: Vec<(String, String)>,
}

/// The <meta> tags the library's clipper reads
pub const META: &[&str] = &["og:title", "og:site_name", "og:description", "description", "author", "article:published_time"];

pub fn placeholder(i: usize) -> String {
  format!("TIDEMATH{i}X")
}

// ---------- Scanning tags ----------

struct Tag<'a> {
  start: usize,
  /// Just after the closing '>'
  end: usize,
  /// Lower case
  name: String,
  closing: bool,
  self_closing: bool,
  /// The text between the name and '>'
  attrs: &'a str,
}

/// The next tag at or after `from` (comments, doctypes and processing instructions are skipped)
fn next_tag(html: &str, mut from: usize) -> Option<Tag<'_>> {
  let b = html.as_bytes();
  loop {
    let at = from + html.get(from..)?.find('<')?;
    let rest = &html[at..];
    if rest.starts_with("<!--") {
      from = at + 4 + rest[4..].find("-->").map_or(rest.len() - 4, |i| i + 3);
      continue;
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
      from = at + rest.find('>').map_or(rest.len(), |i| i + 1);
      continue;
    }
    let closing = rest.starts_with("</");
    let name_at = at + if closing { 2 } else { 1 };
    let name_len = b[name_at..].iter().take_while(|c| c.is_ascii_alphanumeric() || **c == b'-' || **c == b':').count();
    if name_len == 0 || !b[name_at].is_ascii_alphabetic() {
      from = at + 1;
      continue;
    }
    // The tag ends at the first '>' outside quotes
    let mut i = name_at + name_len;
    let mut quote = 0u8;
    while i < b.len() {
      let c = b[i];
      if quote != 0 {
        if c == quote {
          quote = 0;
        }
      } else if c == b'"' || c == b'\'' {
        quote = c;
      } else if c == b'>' {
        break;
      }
      i += 1;
    }
    let end = (i + 1).min(b.len());
    let inner = &html[name_at + name_len..i.min(b.len())];
    return Some(Tag {
      start: at,
      end,
      name: html[name_at..name_at + name_len].to_ascii_lowercase(),
      closing,
      self_closing: inner.trim_end().ends_with('/'),
      attrs: inner,
    });
  }
}

/// The value of attribute `name` in a tag's attribute text, entities decoded
fn attr<'a>(attrs: &'a str, name: &str) -> Option<Cow<'a, str>> {
  let b = attrs.as_bytes();
  let mut i = 0;
  while i < b.len() {
    while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
      i += 1;
    }
    let n0 = i;
    while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'>' && b[i] != b'/' {
      i += 1;
    }
    let key = &attrs[n0..i];
    while i < b.len() && b[i].is_ascii_whitespace() {
      i += 1;
    }
    let mut value = "";
    if i < b.len() && b[i] == b'=' {
      i += 1;
      while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
      }
      if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
        let q = b[i];
        let v0 = i + 1;
        i = v0 + b[v0..].iter().position(|c| *c == q).unwrap_or(b.len() - v0);
        value = &attrs[v0..i];
        i += 1;
      } else {
        let v0 = i;
        while i < b.len() && !b[i].is_ascii_whitespace() {
          i += 1;
        }
        value = &attrs[v0..i];
      }
    }
    if key.eq_ignore_ascii_case(name) {
      return Some(html_escape::decode_html_entities(value));
    }
    if n0 == i {
      i += 1;
    }
  }
  None
}

fn has_class(attrs: &str, part: &str) -> bool {
  attr(attrs, "class").is_some_and(|c| c.contains(part))
}

/// Where the element whose start tag is `open` ends (just after its end tag; the page's end if it never does)
fn element_end(html: &str, open: &Tag) -> usize {
  if open.self_closing {
    return open.end;
  }
  // Script and style hold text, not tags
  if open.name == "script" || open.name == "style" {
    let close = format!("</{}", open.name);
    let lower = &html[open.end..];
    return match find_ci(lower, &close) {
      Some(i) => open.end + i + lower[i..].find('>').map_or(lower.len() - i, |j| j + 1),
      None => html.len(),
    };
  }
  let mut depth = 1;
  let mut at = open.end;
  while let Some(t) = next_tag(html, at) {
    at = t.end;
    if t.name == open.name {
      if t.closing {
        depth -= 1;
        if depth == 0 {
          return t.end;
        }
      } else if !t.self_closing {
        depth += 1;
      }
    }
  }
  html.len()
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
  let (h, n) = (hay.as_bytes(), needle.as_bytes());
  if n.is_empty() || h.len() < n.len() {
    return None;
  }
  (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// The text inside some HTML: tags dropped, entities decoded
fn strip_tags(html: &str) -> String {
  let mut out = String::new();
  let mut at = 0;
  while let Some(t) = next_tag(html, at) {
    out.push_str(&html_escape::decode_html_entities(&html[at..t.start]));
    at = t.end;
  }
  out.push_str(&html_escape::decode_html_entities(&html[at.min(html.len())..]));
  out
}

fn escape(s: &str) -> String {
  s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

// ---------- Formulas ----------

fn tex_of(math_tag: &Tag, inner: &str) -> Option<String> {
  let mut at = 0;
  let mut tex = None;
  while let Some(t) = next_tag(inner, at) {
    at = t.end;
    if t.name == "annotation" && !t.closing && attr(t.attrs, "encoding").is_some_and(|e| e.eq_ignore_ascii_case("application/x-tex")) {
      let end = element_end(inner, &t);
      let body = &inner[t.end..end];
      let body = &body[..body.rfind("</").unwrap_or(body.len())];
      tex = Some(strip_tags(body).trim().to_string());
      break;
    }
  }
  let tex = tex.filter(|t| !t.is_empty()).or_else(|| {
    // Wikipedia's Parsoid output keeps the source in data-mw
    let mw = attr(math_tag.attrs, "data-mw")?;
    let v: serde_json::Value = serde_json::from_str(&mw).ok()?;
    v.pointer("/body/extsrc")?.as_str().map(|s| s.trim().to_string())
  })?;
  // Wikipedia wraps every formula in {\displaystyle ...}
  let t = tex.trim();
  let clean = t.strip_prefix(r"{\displaystyle").and_then(|r| r.strip_suffix('}')).map(str::trim).unwrap_or(t);
  (!clean.is_empty()).then(|| clean.to_string())
}

fn formula(tex: &str, block: bool) -> String {
  if block {
    format!("\n\n$${tex}$$\n\n")
  } else {
    format!("${tex}$")
  }
}

/// The page with each formula swapped for a placeholder, and the formulas in placeholder order.
/// Also takes out the copies of each formula that are only there to be seen (Wikipedia's fallback
/// images, KaTeX's drawing) and shows Wikipedia's MathML, which it hides from everything but
/// screen readers, so the reader keeps the placeholder.
fn take_formulas(html: &str) -> (String, Vec<String>) {
  let mut out = String::with_capacity(html.len());
  let mut formulas = Vec::new();
  let mut at = 0;
  while let Some(t) = next_tag(html, at) {
    out.push_str(&html[at..t.start]);
    at = t.end;
    if t.closing {
      out.push_str(&html[t.start..t.end]);
      continue;
    }
    match t.name.as_str() {
      "math" => {
        let end = element_end(html, &t);
        let inner = &html[t.end..end];
        match tex_of(&t, inner) {
          Some(tex) => {
            formulas.push(formula(&tex, attr(t.attrs, "display").is_some_and(|d| d == "block")));
            out.push_str(&placeholder(formulas.len() - 1));
          }
          // No TeX: keep what the formula says
          None => out.push_str(&escape(&strip_tags(inner))),
        }
        at = end;
      }
      // Their classes describe the page's state, not its content, but the reader weighs them as
      // it does any element's, and a "sidebar" class on <html> loses it the whole page
      "html" | "body" => {
        out.push('<');
        out.push_str(&t.name);
        for a in ["lang", "dir"] {
          if let Some(v) = attr(t.attrs, a) {
            out.push_str(&format!(" {a}=\"{}\"", v.replace('"', "&quot;")));
          }
        }
        out.push('>');
      }
      "img" if has_class(t.attrs, "mwe-math-fallback") => {}
      "span" if has_class(t.attrs, "katex-html") => at = element_end(html, &t),
      "span" if has_class(t.attrs, "mwe-math-mathml") => {
        out.push_str("<span>");
      }
      "script" => {
        let end = element_end(html, &t);
        // MathJax 2 keeps the source in scripts, which the reader would drop
        if attr(t.attrs, "type").is_some_and(|ty| ty.starts_with("math/tex")) {
          let body = &html[t.end..end];
          let tex = body[..body.rfind("</").unwrap_or(body.len())].trim();
          if !tex.is_empty() {
            formulas.push(formula(tex, attr(t.attrs, "type").is_some_and(|ty| ty.contains("mode=display"))));
            out.push_str(&placeholder(formulas.len() - 1));
          }
        } else {
          out.push_str(&html[t.start..end]);
        }
        at = end;
      }
      "style" => {
        let end = element_end(html, &t);
        out.push_str(&html[t.start..end]);
        at = end;
      }
      _ => out.push_str(&html[t.start..t.end]),
    }
  }
  out.push_str(&html[at.min(html.len())..]);
  (out, formulas)
}

/// Puts the formulas back into text that carries their placeholders
pub fn restore(text: &str, formulas: &[String]) -> String {
  if formulas.is_empty() {
    return text.to_string();
  }
  let mut out = String::with_capacity(text.len() + formulas.iter().map(String::len).sum::<usize>());
  let mut rest = text;
  while let Some(at) = rest.find("TIDEMATH") {
    out.push_str(&rest[..at]);
    let after = &rest[at + 8..];
    let digits = after.bytes().take_while(u8::is_ascii_digit).count();
    let n = after[..digits].parse::<usize>().ok();
    match (n, after[digits..].starts_with('X')) {
      (Some(n), true) if n < formulas.len() => {
        out.push_str(&formulas[n]);
        rest = &after[digits + 1..];
        // Text after a formula on its own line starts its own paragraph
        if formulas[n].ends_with('\n') {
          rest = rest.trim_start_matches([' ', '\t']);
        }
      }
      _ => {
        out.push_str("TIDEMATH");
        rest = after;
      }
    }
  }
  out.push_str(rest);
  out
}

// ---------- The page's metadata ----------

struct Head {
  title: String,
  meta: Vec<(String, String)>,
  image: Option<String>,
}

fn head_of(html: &str) -> Head {
  let mut title = None;
  let mut meta: Vec<(String, String)> = Vec::new();
  // The preview image, in the order link previews look for it: (rank, url)
  let mut image: Option<(usize, String)> = None;
  let mut offer = |rank: usize, v: Option<Cow<str>>| {
    if let Some(v) = v.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
      if image.as_ref().is_none_or(|(r, _)| rank < *r) {
        image = Some((rank, v));
      }
    }
  };
  let mut at = 0;
  while let Some(t) = next_tag(html, at) {
    at = t.end;
    if t.closing {
      continue;
    }
    match t.name.as_str() {
      "title" if title.is_none() => {
        let end = element_end(html, &t);
        let body = &html[t.end..end];
        title = Some(strip_tags(&body[..body.rfind("</").unwrap_or(body.len())]).split_whitespace().collect::<Vec<_>>().join(" "));
        at = end;
      }
      // Never inside an <svg>'s <title> or a script
      "script" | "style" | "svg" => at = element_end(html, &t),
      "meta" => {
        let content = || attr(t.attrs, "content");
        for key in ["property", "name"] {
          let Some(k) = attr(t.attrs, key) else { continue };
          if META.iter().any(|m| *m == k) && !meta.iter().any(|(m, _)| *m == k) {
            if let Some(c) = content() {
              meta.push((k.to_string(), c.to_string()));
            }
          }
          let rank = match (key, k.as_ref()) {
            ("property", "og:image:secure_url") | ("property", "og:image") | ("name", "og:image") => 0,
            ("name", "twitter:image") | ("property", "twitter:image") | ("name", "twitter:image:src") => 1,
            _ => continue,
          };
          offer(rank, content());
        }
      }
      "link" => {
        let rank = match attr(t.attrs, "rel").as_deref() {
          Some("image_src") => 2,
          Some("apple-touch-icon") => 3,
          _ => continue,
        };
        offer(rank, attr(t.attrs, "href"));
      }
      _ => {}
    }
  }
  // The <meta> order the clipper asked in, whatever the page's order
  meta.sort_by_key(|(k, _)| META.iter().position(|m| m == k));
  Head { title: title.unwrap_or_default(), meta, image: image.map(|(_, v)| v) }
}

// ---------- The article as text ----------

const BLOCKS: &[&str] = &[
  "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "ul",
];
const LINES: &[&str] = &["br", "li", "tr", "dt", "dd", "caption", "thead", "tbody", "tfoot"];

struct TextOut {
  s: String,
  space: bool,
}

impl TextOut {
  fn breaks(&mut self, n: usize) {
    while self.s.ends_with(' ') {
      self.s.pop();
    }
    self.space = false;
    if self.s.is_empty() {
      return;
    }
    let have = self.s.len() - self.s.trim_end_matches('\n').len();
    for _ in have..n {
      self.s.push('\n');
    }
  }

  fn flowing(&mut self, text: &str) {
    for c in text.chars() {
      if c.is_whitespace() {
        self.space = true;
      } else {
        if self.space && !self.s.is_empty() && !self.s.ends_with('\n') {
          self.s.push(' ');
        }
        self.space = false;
        self.s.push(c);
      }
    }
  }
}

/// The article's HTML as plain text: blocks apart by a blank line, list items and table rows on lines
/// of their own, and preformatted text (code) exactly as laid out
pub fn html_to_text(html: &str) -> String {
  let mut out = TextOut { s: String::with_capacity(html.len() / 2), space: false };
  let mut pre = 0usize;
  let mut at = 0;
  let text = |out: &mut TextOut, raw: &str, pre: usize| {
    let t = html_escape::decode_html_entities(raw);
    if pre > 0 {
      out.s.push_str(&t.replace("\r\n", "\n"));
    } else {
      out.flowing(&t);
    }
  };
  while let Some(t) = next_tag(html, at) {
    text(&mut out, &html[at..t.start], pre);
    at = t.end;
    let name = t.name.as_str();
    match name {
      "script" | "style" | "template" | "noscript" if !t.closing => {
        at = element_end(html, &t);
        continue;
      }
      "pre" => {
        out.breaks(2);
        if t.closing {
          pre = pre.saturating_sub(1);
        } else {
          pre += 1;
        }
        continue;
      }
      "td" | "th" if t.closing => out.space = true,
      _ => {}
    }
    if pre > 0 {
      if name == "br" {
        out.s.push('\n');
      }
      continue;
    }
    if BLOCKS.contains(&name) {
      out.breaks(2);
    } else if LINES.contains(&name) {
      out.breaks(1);
    }
  }
  text(&mut out, &html[at.min(html.len())..], pre);
  out.s
}

/// Lines ended without trailing spaces, and no more than one blank line in a row (outside code too)
fn tidy(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut blank = 0;
  for line in text.split('\n') {
    let line = line.trim_end();
    if line.is_empty() {
      blank += 1;
      if blank > 1 {
        continue;
      }
    } else {
      blank = 0;
    }
    out.push_str(line);
    out.push('\n');
  }
  out.trim().to_string()
}

/// The article in `html`, read from `url` (used to make links absolute; may be empty)
pub fn extract(html: &str, url: &str) -> Result<Page, String> {
  let head = head_of(html);
  let (prepared, formulas) = take_formulas(html);
  let url = (url.starts_with("http://") || url.starts_with("https://")).then_some(url);
  let article = legible::parse(&prepared, url, None).or_else(|e| if url.is_some() { legible::parse(&prepared, None, None) } else { Err(e) }).map_err(|e| e.to_string())?;
  let text = tidy(&restore(&html_to_text(&article.content), &formulas));
  Ok(Page {
    title: article.title,
    doc_title: head.title,
    byline: article.byline,
    site_name: article.site_name,
    excerpt: article.excerpt,
    published: article.published_time,
    lang: article.lang,
    image: head.image,
    text,
    content: article.content,
    formulas,
    meta: head.meta,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_attributes_and_tags() {
    let t = next_tag(r#"x <META property="og:title" content='A &amp; B'> y"#, 0).unwrap();
    assert_eq!(t.name, "meta");
    assert_eq!(attr(t.attrs, "content").unwrap(), "A & B");
    assert_eq!(attr(t.attrs, "PROPERTY").unwrap(), "og:title");
  }
}
