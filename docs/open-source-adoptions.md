# Open-source parts Tide could adopt

A survey made on 11 November 2026. Every licence was read from the project's own LICENSE file.
Only permissive licences are considered; any adopted component's notice goes in
THIRD_PARTY_NOTICES.md, which ships with the app.

## Ranked

| # | Adopt | Licence | Effort | Why |
|---|---|---|---|---|
| 1 | Schema-constrained JSON for cloud models, and `jsonrepair` for local replies | ISC (jsonrepair); llguidance MIT, already installed with mlx-vlm | 8–12 h | About 30 call sites dig JSON out of free text (`extractJson*` in src/main/ai.ts). mlx-vlm 0.7.12 refuses `response_format` while the MTP draft model is on, so local replies are repaired instead of constrained. |
| 2 | The `fsrs` crate in recall, and a review log | BSD-3 | 6–8 h | The current schedule ignores how late a review is; Tide's reviews are irregular by design. FSRS defaults: log loss 0.362 on srs-benchmark, against 0.469 (HLR) and 0.499 (Ebisu). |
| 3 | pdf.js find (⌘F) and link annotations in the PDF reader | Apache-2.0, already installed | 8–12 h | EventBus, PDFLinkService, PDFFindController, AnnotationLayer from `pdfjs-dist/web/pdf_viewer.mjs`. |
| 4 | Ruff (WASM) errors in the code editor | MIT | 6–10 h | Python diagnostics and formatting as Monaco markers, in a worker. |
| 5 | foliate-js for EPUB | MIT (bundles zip.js BSD-3, fflate MIT) | 20–30 h | Vendored at a pinned commit; its API is declared unstable. Taken by the humanities work. |
| 6 | Live preview in the note editor, adapted from SilverBullet's CodeMirror 6 extensions | MIT | 15–25 h | Keeps plain Markdown as the source. |
| 7 | FSRS retrievability as the knowledge map's forgetting model | BSD-3 | 10–16 h | Keeps knowledge.rs's structure; "solid" becomes R ≥ 0.85. |
| 8 | xyflow for the system-design canvas | MIT | 16–24 h | Keeps JSON Canvas as the stored format. |

Experiments, a few hours each: Defuddle (MIT) against Readability + turndown on about 20 clipped
pages; a CPU cross-encoder reranker through fastembed-rs (Apache-2.0) in the retrieval
evaluation; Transformer Explainer (MIT) bundled as an offline explorable.

## Keep Tide's own

The sandboxed runner (Pyodide would lose PyTorch), the expression parser for plots, the lab's
charts, the simulations, the CSV parser, the wikilink rules, and the evaluation harnesses.

## Excluded for their licences

tldraw (proprietary licence with keys); citeproc-js and so @citation-js/plugin-csl ("CPAL OR
AGPL"; hayagriva, MIT/Apache, is the permissive alternative); Open edX (AGPL); Moodle (GPL); D2's
TALA layout engine (proprietary; D2 itself is MPL-2.0). srs-benchmark has no licence file: its
results may be cited, its code not copied. Usable only under conditions: JSXGraph under its MIT
option; Pyodide and D2 only unmodified (MPL-2.0); Dive into Deep Learning's text under
CC BY-SA 4.0 (shown with attribution; adaptations stay CC BY-SA).

Note: ts-fsrs 6 makes FSRS-7 the default and needs Node 24; tests run on Node 22, and cards
without a full review history must stay on FSRS-6, so flashcards stay on FSRS-6 for now.
