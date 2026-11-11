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

## Teaching blocks: second survey

Made the same day, for parts the tutor can put in a lesson. Ranked by teaching value against
effort; licences read from each package's own LICENSE file.

| # | Candidate | Licence | Size | Verdict |
|---|---|---|---|---|
| 1 | planck.js (Box2D port) for physics scenes | MIT | 400 kB, loaded with the first physics block | Adopted |
| 2 | Mafs for geometry and linear maps | MIT (with tiny-invariant, use-gesture, use-resize-observer, all MIT) | 110 kB, on first use; KaTeX is shared | Adopted |
| 3 | regexp-tree (parser only) for regex railroad diagrams | MIT | 130 kB, on first use | Adopted |
| 4 | chess.js for game-tree search | BSD-2-Clause | 95 kB, on first use | Adopted |
| 5 | sql-formatter (SQLite dialect) to tidy SQL blocks | MIT (bundles nearley, MIT) | 100 kB, on first Tidy | Adopted |
| 6 | Observable Plot for lesson charts | ISC (pulls in d3) | about 400 kB | Not done: the lab's charts and the plot simulation already cover it |
| 7 | JSXGraph for constructions | MIT option of MIT/LGPL | 75 MB package, about 800 kB bundle | Not done: Mafs does the same for a seventh of the size |
| 8 | Excalidraw whiteboard | MIT | 47 MB package, over 2 MB bundle | Not done: too heavy, and a 12B model can't write its scenes reliably; mermaid already draws structure |
| 9 | DuckDB-WASM analytics lab | MIT | 150 MB package, 30 MB WASM | Not done: the SQLite lab covers the SQL lessons; worth it only for Parquet or large files |
| 10 | Transformer Explainer | MIT | bundles GPT-2 (about 500 MB) | Not done: too large offline; the attention, softmax and tokeniser simulations cover the mechanism |
| 11 | Circuit simulators | CircuitJS is GPL-2.0 | | Excluded for the licence; no maintained permissive one found |
| 12 | Periodic table data | most data sets are CC BY-SA | | Not done |

Pyodide stays excluded: the runner keeps real Python.

What was built, each as a ```sim kind the tutor can write (shared/sims.ts tells it how; a lesson
is told only about the kinds its topic can use):

- physics: projectile, pendulum, spring, incline and collision scenes stepped by Box2D, with
  the textbook prediction beside the engine's measurement and the energy over time. A
  pendulum runs at 3,840 steps a second: Box2D's joints bleed energy at 240 (12% in 10 s from 90°).
  The exact pendulum period is computed with the arithmetic-geometric mean.
- geometry: draggable points with every length, angle and area measured; or a 2×2 matrix with
  draggable basis vectors, the determinant as the unit square's area, and real eigenvectors.
  Themed by mapping Mafs's CSS variables to Tide's tokens.
- regex: a railroad diagram drawn from regexp-tree's parse, matches and groups marked in
  editable test strings. Matching runs in a worker with a 0.4 s limit, so catastrophic
  backtracking is reported, not a frozen window.
- chess: legal moves from chess.js, and a minimax or alpha-beta search to depth 4 showing its
  pick, each move's score and how many positions each search visited. The search uses chess.js's
  internal move list (50 times faster than its public API); the version is pinned and a test
  fails if those internals change.
- SQL blocks gain a Tidy button (Shift+Alt+F).

Found on the way: live blocks waited for the page to be still for 500 ms before looking for new
ones, so an animated icon anywhere kept simulations and diagrams from ever appearing. The wait is
now capped.
