//! Reading a page's article, without Node:
//!
//!   cargo test --release --test extract
//!
//! The real pages (seventeen of them, against the old reader) are in test/extract.test.ts.

#[allow(dead_code)]
#[path = "../src/extract.rs"]
mod extract;

fn page(body: &str) -> String {
  let filler = "<p>Readers find the article by its paragraphs, so this page has several long ones about nothing much at all, written to look like prose.</p>".repeat(6);
  format!(r#"<!DOCTYPE html><html class="light sidebar-visible" lang="en"><head><title>The Title - Site</title>
<meta property="og:title" content="OG &amp; Title"><meta name="description" content="About it">
<meta name="twitter:image" content="/t.png"><meta property="og:image" content="/og.png">
<script>var x = "<p>not text</p>";</script></head>
<body><nav class="sidebar"><a href="/">Home</a></nav><article><h1>The Title</h1>{filler}{body}{filler}</article><footer>Footer</footer></body></html>"#)
}

#[test]
fn reads_the_article_its_title_and_metadata() {
  let p = extract::extract(&page("<p>The middle paragraph.</p>"), "https://example.org/a/b").unwrap();
  assert_eq!(p.doc_title, "The Title - Site");
  assert!(p.title.contains("Title"));
  assert!(p.text.contains("The middle paragraph."));
  assert!(!p.text.contains("Footer") && !p.text.contains("not text"));
  // og:image beats twitter:image, as link previews have it
  assert_eq!(p.image.as_deref(), Some("/og.png"));
  assert_eq!(p.meta, vec![("og:title".to_string(), "OG & Title".to_string()), ("description".to_string(), "About it".to_string())]);
  // Paragraphs stay apart
  assert!(p.text.contains("prose.\n\nReaders"));
}

#[test]
fn keeps_code_as_it_was_laid_out() {
  let code = "<pre><code>fn main() {\n    let s = \"a &lt; b\";\n}\n</code></pre>";
  let p = extract::extract(&page(code), "").unwrap();
  assert!(p.text.contains("fn main() {\n    let s = \"a < b\";\n}"), "{}", p.text);
}

#[test]
fn takes_formulas_out_as_tex() {
  let maths = r#"<p>Softmax is <span class="mwe-math-element"><span class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display: none;"><math><semantics><mrow><mi>σ</mi></mrow><annotation encoding="application/x-tex">{\displaystyle \sigma (\mathbf {z} )_{i}}</annotation></semantics></math></span><img class="mwe-math-fallback-image-inline" alt="x"></span> and then</p>
<p><math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">\frac{a}{b}</annotation></semantics></math> follows.</p>
<p>KaTeX: <span class="katex"><span class="katex-mathml"><math><semantics><mi>y</mi><annotation encoding="application/x-tex">y^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>y</span><span>2</span></span></span> done.</p>"#;
  let p = extract::extract(&page(maths), "https://example.org/").unwrap();
  assert_eq!(p.formulas, vec![r"$\sigma (\mathbf {z} )_{i}$".to_string(), "\n\n$$\\frac{a}{b}$$\n\n".to_string(), "$y^2$".to_string()]);
  assert!(p.text.contains(r"Softmax is $\sigma (\mathbf {z} )_{i}$ and then"), "{}", p.text);
  assert!(p.text.contains("$$\\frac{a}{b}$$\n\nfollows."), "{}", p.text);
  assert!(p.text.contains("KaTeX: $y^2$ done."), "{}", p.text);
  // The HTML keeps placeholders, for Markdown to be made from it before the formulas go back
  assert!(p.content.contains("TIDEMATH0X") && p.content.contains("TIDEMATH2X"));
  assert_eq!(extract::restore("a TIDEMATH2X b TIDEMATH9X", &p.formulas), "a $y^2$ b TIDEMATH9X");
}

#[test]
fn a_page_with_no_body_is_an_error_not_a_panic() {
  assert!(extract::extract("", "https://example.org/").is_err());
  let _ = extract::extract("<<<>>>&&& <p <!-- x", "not a url");
  let _ = extract::extract("<html><body><math><annotation encoding=\"application/x-tex\">", "https://example.org/");
}
