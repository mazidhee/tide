# A Rust core for everything except the model: measured plan

The ask: "a Rust core for everything except the model", so that "everything else runs in milliseconds; the only thing that makes it slow is Gemma itself".

The short answer, from the measurements below:

- **A lesson turn is already about 99.5% model.** Over 30 real lesson and chat turns with Gemma 4 12B (722 s in all), the model spent 47.6% of the time reading prompts and 40.9% writing. Another 11.2% went to waiting for Gemma while it finished other work. Tide's own code took 0.5%: a median of 72 ms to prepare a turn and 50 ms to handle its stream. Moving all of Tide's code to Rust cannot make a lesson noticeably faster. At best it saves about 0.1 s of a 22.7 s median turn.
- **Where Tide misses "milliseconds" is stalls, not latency.** The main process sometimes freezes for 70 to 640 ms, and most of those freezes come from the Rust module that already exists: its Tantivy commit runs synchronously on the main thread. Background page reading (jsdom) and PDF extraction (pdf.js) also run on the main thread. The window's drawing gets worse as a lesson grows: by the sixth turn the renderer is busy for 11 of every 12 seconds while a reply streams, and it draws at about 11 to 27 frames a second. That cost is in JavaScript (DOMPurify and KaTeX rerun on every block for every token). Rust would not fix it; caching would.
- **Rust is worth it in three places:** making the existing module's slow calls asynchronous, extracting web pages, and extracting PDF text. Not worth it: markdown, prompt building, stream plumbing, the runner, the watcher, the vault scanner, a whole-main-process rewrite, or Tauri.
- **What would make lessons faster** has to do with the model: fewer prefix-cache misses (15% of all turn time), no queueing behind background work (11%), fewer back-to-back model calls per turn (10%), and shorter prompts and replies.

The rest of this document gives the numbers, the candidates, the order, and the architecture.

## 1. How this was measured

- **Live turns with Gemma.** Thirty Settings › Speed records came from the rehearsal on 11 November, a dev copy with the real mlx-vlm server and `mlx-community/gemma-4-12B-it-4bit` on this Mac. The records were saved from `window.tide.speed.recent()`, and they cover 25 lesson turns and 5 chat turns. `src/main/speed.ts` writes these records. It times Tide's preparation up to the first request (`prepareMs`), each model call's prompt reading (`prefillMs`, up to the first token) and writing (`writeMs`), Tide's own time on each piece of the stream (`tideMs`, agent.ts:702-751), tools, and the window's drawing.
- **Tide on its own.** A dev copy ran on a copied profile and the test vault (`TIDE_USER_DATA`, `npx electron-vite dev --inspect`). Its model was a stand-in server on 127.0.0.1:18234 that streams a fixed 1,935-character lesson reply at about 30 words a second. The reply holds inline and display maths, a Python block, a softmax `sim`, a table, a SQL block and a callout. The stand-in takes no time to read a prompt, so whatever time remains belongs to Tide. The real model server on :8080 was never contacted. The main process was profiled over the Node inspector, and the window over CDP: Profiler at 100 µs sampling, Performance metrics, and `monitorEventLoopDelay` in main. Memory comes from `app.getAppMetrics()` and macOS `footprint`.
- **Libraries in isolation.** pdf.js and jsdom ran under Electron's own Node (`ELECTRON_RUN_AS_NODE`), with the same code as `search.ts:pdfPages` and `agent.ts:readWebpageNow`. The Rust candidates ran as a release build on the same files: PDFium 159.0.8152 through `pdfium-render` 0.9.5, `pdf-extract` 0.12.1, `dom_smoothie` 0.19.0, `pulldown-cmark` 0.13.6 and `comrak` 0.59.0.
- **Caveats.** The renderer ran as a dev build: Vite served unbundled modules, and React carried its development checks. The React share of renderer time would shrink in a packaged build. DOMPurify, KaTeX and highlight.js cost about the same in both builds, and they are most of the time. Start-up of the window is pessimistic in dev. The main process is bundled the same way in dev and packaged, so its numbers stand. No cloud model was configured in either profile, so cloud network time is not measured (see 2.6).

## 2. Where time and memory go today

### 2.1 A lesson turn, with Gemma

Thirty turns, 721.7 s in all. Median turn 22.7 s, 90th percentile 37.0 s. Median prompt 6,748 tokens, of which 5,111 were cached. Median reply 222 tokens.

| Where | Total | Share | Median per turn |
| --- | ---: | ---: | ---: |
| Gemma reading the prompt (prefill, to first token) | 343.5 s | 47.6% | 8.7 s |
| Gemma writing (decode, 29 tok/s median) | 295.2 s | 40.9% | 8.1 s |
| Waiting for Gemma to finish other work (7 turns) | 80.6 s | 11.2% | 0 |
| Tide preparing the turn (retrieval, sources, prompt) | 1.9 s | 0.27% | 72 ms |
| Tide handling the stream (0.20 ms a token) | 1.7 s | 0.23% | 50 ms |
| Tools (load_table 85 ms, run_sql 1 ms) | 0.09 s | 0.01% | 0 |
| Not accounted for | 0.35 s | 0.05% | |
| *Window drawing (runs alongside, not in the total)* | *14.2 s* | *2.0%* | *78 ms; worst 3.3 s* |

The waits come from the interactive lane in `modelQueue.ts:58-67`. A turn that starts while another interactive request holds Gemma waits for it, and that wait is counted in `prepareMs` (30.2 s, 22.4 s, 16.8 s, 5.1 s, 2.8 s, 2.0 s, 1.3 s). Without those turns, Tide's preparation has a median of 72 ms and a maximum of 324 ms. The rehearsal notes link the longest waits to the dev-only double start of a session (StrictMode, issue 13) and to background readings and bank calls (issue 14).

**Network.** The model runs on loopback. With the stand-in, the gap between Tide sending a 24.6 KB request and the first token was 10 ms, and that 10 ms includes `JSON.stringify` and the server's parse. Network time is under 0.1% of a local turn.

### 2.2 Tide's own work in a turn (stand-in model)

Eight turns in one growing lesson. All times are main-process times.

| Step | Measured | Where |
| --- | --- | --- |
| Preparing the turn (`prepareMs`) | 5-104 ms, median 12 ms | agent.ts `agentChatNow` |
| Retrieval (Tantivy search) | 2.5-52 ms a turn; 0.9 ms per IPC search | search.ts `retrieve` → native `search` |
| Stream handling (`tideMs`) | 65-193 ms a turn, 0.22-0.29 ms a token | agent.ts:715-752 |
| ...of which the loop check | 46-61 ms a turn | shared/modelText.ts:55 `isLooping` |
| Saving the lesson note, then reindexing it | 213-340 ms a turn, **synchronous** | search.ts:266 `commitIndex` → native `commit` |
| Reading a lesson source page (jsdom + Readability) | 545 ms, **synchronous** | agent.ts:459 `readWebpageNow`, called from sourceLed |
| Subject regexes, first use | 266 ms once, then about 19 ms | shared/subjects.ts:47 `subjectMatches` |
| Main busy per turn, background work included | 0.42-1.86 s | |
| Main event-loop delay, worst per turn | 82-637 ms (p50 5 ms) | |

The extra cost is concentrated in a few calls. A lesson turn sends one 24.6 KB request (18,367 prompt characters, 11 tools) and then a background practice-problem request.

### 2.3 Main process, other paths

| Path | Measured | Notes |
| --- | --- | --- |
| Start-up, warm (text caches valid) | 1.6 s of CPU in the first 20 s; window target at 1.0 s; UI usable at 2.3 s (dev) | Tantivy commit 486 ms synchronous, bundle evaluation 315 ms, `createWindow` 178 ms, subject regexes 69 ms |
| Start-up, PDFs to extract (copied vault, so the cache missed on mtime) | 6.6 s of CPU in the first 30 s | pdf.js 3.0 s plus its `structuredClone` 0.66 s and `@napi-rs/canvas` load 0.37 s, all on the main thread; main peaked at 540 MB |
| PDF text extraction, pdf.js | 2.6 ms a page: 1,078 pages in 2.81 s, 545 in 1.45 s, 263 in 0.59 s; longest page 77 ms; +140 MB peak | search.ts:71 `pdfPages`, book.ts:31; once per file, then cached in `.tide/pdftext` |
| Opening a 1,078-page PDF in the reader | 0.5 s renderer CPU, main ~0 | pdf.js in the window has its own worker |
| EPUB indexing (Moby-Dick, 700 KB) | about 250 ms CPU (jsdom `loadDocument` 75 ms), then a 261 ms commit | epub.ts:184 |
| Note save (`vault:write`) | 73 ms, of which the commit is about 70 ms | index.ts:214 writes, then calls `reindexPath`, which commits |
| File change → `vault:changed` | 425-476 ms | 400 ms of that is deliberate debounce (vault.ts:257-261) |
| Knowledge map (`knowledge:view`) | 41 ms a call; 797 KB payload | knowledge.ts:305. Roadmap re-sync is forced on every view (16 ms), plus `k.all` over 1,560 concepts through napi and IPC |
| Vault tree / notes list | 1.1 ms / 0.9 ms (test vault) | gray-matter: 500 synthetic notes in 13-16 ms |
| Code runner round trip | Python 39 ms, JavaScript 78 ms, SQL 0.1 ms | interpreter start-up dominates; SQL is already Rust (lab.rs) |

Why the commit is slow: all of tide-core's napi methods are synchronous (`native/tide-core/src/lib.rs`), so `commit()` runs on Electron's main thread. Tantivy's commit syncs its segment files and directory. On macOS, Rust's `File::sync_all` is `F_FULLFSYNC`, which took a median of 3.7 ms and up to 7.5 ms a call on this Mac (`fsync` alone takes under 0.1 ms). A commit that syncs a dozen files, plus any merge it triggers, adds up to the 70-490 ms measured.

### 2.4 Renderer

Lesson turns get slower to draw as the lesson grows. These are the same eight turns, with the same reply each time. The fixed reply makes later turns look somewhat worse than real ones, because every block holds maths, a sim and a table. Real Gemma turns show the same rise: `render.totalMs` reached 1.6-3.3 s in the rehearsal.

| Turn | Frames during the stream | Drawing time (`render.totalMs`) | Longest frame | Renderer script | Renderer busy, of ~12 s |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,121 | 409 ms | 76 ms | 3.3 s | 5.7 s |
| 2 | 656 | 2,774 ms | 176 ms | 5.7 s | 9.5 s |
| 3 | 402 | 4,870 ms | 232 ms | 6.8 s | 10.3 s |
| 5 | 268 | 5,898 ms | 121 ms | 8.4 s | 10.9 s |
| 6 | 114 | 8,193 ms | 132 ms | 8.6 s | 11.1 s |
| 8 (lesson reopened: 18 blocks, 8 sims, 8 tables) | 163 | 7,527 ms | 92 ms | 8.8 s | |

Where the seventh turn's renderer time went: DOMPurify `sanitize` 5,119 ms, KaTeX 830 ms, the Professor sprite 511 ms, highlight.js 158 ms, markdown-it 152 ms, and React (dev checks included) about 1 s.

The cause: `SessionView.tsx:740-836` calls `renderMarkdown` for every block on every render. `markdown.ts:478` has no cache, so every streamed update parses, typesets and sanitises the whole lesson again. One reply block costs 3.2 ms in total: 0.15 ms markdown-it, 0.5 ms KaTeX and about 2.5 ms DOMPurify. With 16 blocks that is about 51 ms per update, and the cost grows with the lesson. The Professor draws one SVG `<rect>` per pixel and re-renders on a timer (`Professor.tsx:44-52`), at 0.4-0.5 s of CPU a turn.

The knowledge map view costs 230 ms of renderer time to open. The PDF reader costs 0.5 s to open a 1,078-page book.

### 2.5 Memory

Physical footprint per process, with `macOS footprint`, in dev:

| | Main | GPU | Network | Renderer | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| At rest, Home, after a warm start | 184 MB | 219 MB | 72 MB | 140 MB | 615 MB |
| Mid-stream, 18-block lesson | 187 MB | 275 MB | 57 MB | 446 MB | 965 MB |
| Peak working set seen | 540 MB (PDF and page extraction) | 94 MB | 115 MB | 548 MB (lesson streaming) | |

JS heaps are small: main 31-53 MB, renderer 41-85 MB. The renderer's mid-lesson growth is DOM churn: `innerHTML` replaced on every update, with 150,000-560,000 nodes counted, most of them detached. The main process's peak comes from pdf.js and jsdom. In the jsdom benchmark, RSS climbed to 472 MB after 30 page reads. For scale: the Gemma server holds about 11 GB, and the benchmark run on 11 November recorded 10.9-11.5 GB of swap in use with 31-42% of memory free (`scripts/bench/results/2026-11-11-0349-after.json`).

### 2.6 What is not measured

- **Cloud turns.** Neither profile had a cloud key, and the rehearsal's `usage.jsonl` holds only local calls (77 tutor, 67 background, 24 other, 7 planning). Each cloud request already records its time (`cloud.ts` `noteOutcome`). The first step of the migration (section 5.5) adds cloud time-to-first-token to Settings › Speed, so the network share of a cloud turn is measured too.
- **The owner's vault.** It holds 497 notes and 332 PDFs, about 1.2 GB. These measurements used the test vault. Note-level costs scale linearly and are small (gray-matter at 0.025 ms a note). PDF extraction is the one cost that scales with that vault: at 2.6 ms a page it runs on the main thread the first time each PDF is seen.

### 2.7 Against the goal

| | Meets "milliseconds"? |
| --- | --- |
| Preparing a turn (retrieval, sources, prompt) | **Yes**: median 12 ms (stand-in) and 72 ms (live) |
| Handling the stream | **Yes**: 0.2-0.3 ms a token |
| Search, tree, notes, SQL, settings IPC | **Yes**: 0.1-1.1 ms |
| Knowledge map | Nearly: 41 ms in main, 230 ms in the window |
| Saving and reindexing | **No**: 70-490 ms with the main thread blocked |
| Reading a web page for sources | **No**: 57-545 ms with the main thread blocked |
| First extraction of a PDF or EPUB | **No**: 0.25-2.8 s of main-thread CPU per book |
| Drawing a long lesson as it streams | **No**: 11-27 fps by turn 5, and 8 s of drawing per turn |
| A whole lesson turn | **Already Gemma-bound**: Tide is 0.5% of it |

## 3. Candidates for Rust

Effort: S = a day or two, M = about a week, L = several weeks, XL = months. "Gain" means for the owner's goal, not for throughput in general.

| Candidate | Cost today (measured) | Rust alternative (measured) | Expected gain | Effort | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Asynchronous calls into the existing tide-core** (commit, replace, search, knowledge, recall) | Commit 70-490 ms synchronous; main-thread stalls up to 637 ms in a turn | Same code, run on the libuv pool or a Rust thread (napi `AsyncTask`); commits grouped every ~2 s | Ends the main-process stalls during lessons and saves; start-up stall drops by about 0.5 s | S | Low: the index already serialises writes with a mutex | **Do first** |
| **Web page extraction** (jsdom + Readability) | 57-201 ms a page (545 ms seen in a turn); jsdom loads in 108 ms; RSS reached 472 MB | `dom_smoothie` (MIT): 2.7-10.8 ms, 20-35× faster; text length within 0.3-2.6% on five pages | Source gathering in milliseconds and off the main thread; less main-process memory | M | Medium: extraction quality on odd pages; keep jsdom as the fallback | **Do second** |
| **PDF text** (pdf.js in main) | 2.6 ms a page; 2.81 s for a 1,078-page book; +140 MB peak; longest page 77 ms on the main thread | PDFium via `pdfium-render` (MIT/Apache; PDFium BSD-3/Apache; 7.6 MB dylib): 0.58-1.54 ms a page, 0.62 s for the same book (4.5×), 1.7× and 1.5× on the others; 26-51 MB peak. Word overlap with pdf.js 0.95-0.995 (differences are maths subscripts joined, `x1` against `x 1`) | First indexing of the 332-PDF vault several times faster, off the main thread, ~100 MB lower peak | M | Medium: shipping and signing a dylib; text differences change search results slightly | **Do third** |
| PDF text with `pdf-extract`/`lopdf` (pure Rust) | as above | 1.70 ms a page on CS:APP, but 4.46 ms on Strang (slower than pdf.js), 1.98 ms on the survey | Inconsistent | M | Panics on some files (caught in the bench) | No |
| **EPUB parsing** (foliate-js with jsdom's DOMParser) | about 250 ms CPU per book, once | `zip` + `html5ever` or `quick-xml`: estimated 10× faster, not benchmarked | ~0.2 s per book, once; also lets main drop jsdom entirely | M | Medium: foliate's spine and TOC rules have to be ported | Later, only to remove jsdom |
| Markdown parse (markdown-it in the renderer) | 0.15 ms a block; 2% of renderer time | `pulldown-cmark` 0.010 ms, `comrak` 0.014 ms (native; WASM would be slower) | ≤0.14 ms a block; the 5.1 s of DOMPurify and 0.8 s of KaTeX stay | L: every plugin (wikilinks, callouts, math, explainers, embeds) has to be ported | High: rendering differences everywhere | **No.** Cache rendered blocks instead (section 4.2) |
| Prompt assembly and retrieval glue | 5-104 ms per turn (median 12); search itself 0.9-2.5 ms | — | ≤0.1 s per turn, 0.3% | L: the prompts live in shared TS, tested by 134 suites | Medium | No |
| Request and stream plumbing (SSE parse, loop check, IPC) | 0.2-0.3 ms a token; 65-193 ms a turn | — | ≤0.15 s per turn, inside a stream that lasts 8 s | M | Medium: it touches every model call | No |
| Code runner process management | Python 39 ms, JS 78 ms round trip; that is interpreter start-up | — | None: the time is Python and Node starting | M | — | No |
| File watcher (chokidar) | 425-476 ms to an event, 400 ms of it deliberate debounce; ~0 CPU at rest | `notify` | None, unless the debounce changes | S | Low | No |
| Vault scanner, note metadata (gray-matter, tree) | 13-16 ms for 500 notes; tree 1.1 ms | `walkdir` + a YAML parser | A few ms on the owner's vault | M | Low | No |
| JSON stores and their writes | `knowledge.json` 765 KB is already owned by Rust; other stores are small | — | — | — | — | No (already done where it mattered) |
| Knowledge map | 41 ms a view: roadmap re-parse 16 ms, 1,560 objects through napi and IPC | Move roadmap parsing into knowledge.rs; send a compact view | ~30 ms a view | S | Low | Optional; caching the roadmap parse by mtime in TS gets most of it |
| Whole main process in Rust (napi or sidecar) | Tide's code is 0.5% of a turn; 23.5k lines in `src/main`, 215 IPC handlers, 14 files importing Electron | Sidecar or napi rewrite | ≤0.1 s of a 22.7 s turn, beyond what the three moves above give | XL | High: every feature | **No** |
| Tauri instead of Electron | Electron footprint 615 MB at rest and 965 MB mid-lesson (dev); window at 1.0 s | Estimate: 250-400 MB at rest and 0.3-0.5 s to a window. WebKit's content process hosts the same React app, so the renderer's 140-446 MB mostly stays; the saving is Chromium's GPU process and main | About 0.3 GB at rest, against an 11 GB model; no change to lesson latency | XL: main logic needs Node (sidecar) or a Rust rewrite | High: node-pty → portable-pty; Monaco and xterm need retesting on WebKit; `field-sizing` (2 files) and `startViewTransition` (1 file) need WebKit equivalents; pdf.js works in WebKit | **No**, unless memory pressure is shown to slow Gemma |

## 4. Recommendation

### 4.1 Move to Rust, in this order

1. **Make tide-core's slow calls asynchronous** and group commits. That means `commit`, `replace`, `remove` and `search` on the index, plus the knowledge and recall calls that walk all records. This removes the largest main-thread stalls in a lesson (213-340 ms every turn) and in a save (70 ms), and about 0.5 s at start-up. One crate, no new dependencies.
2. **Web page extraction in Rust** with `dom_smoothie`, behind `extractArticle(html, url)`. Source gathering for lessons, outlines and company prep goes from 57-545 ms to 3-11 ms a page, off the main thread. The first lesson after start-up no longer pays the 108 ms jsdom load. Keep the Firecrawl path for short results.
3. **PDF text in Rust** with PDFium, behind `pdfPages(path)`, using the same `.tide/pdftext` cache key so existing caches stay valid. This is 1.5-4.5× faster, uses about 100 MB less memory at peak, and keeps the main thread free while a new library is indexed.
4. Optionally, after these, **EPUB parsing**, but only if it lets the main process drop jsdom completely (library.ts, agent.ts and epub.ts are its only users).

**Expected effect on the goal:** every path in section 2.7 marked "No" in the main process moves into milliseconds or off the main thread. Lesson turns stay about as fast as they are now, because they were never slow in Tide: the saving is ≤0.1 s of a 22.7 s median turn. The visible change is that the app stops hitching. IPC replies, scrolling and streamed text no longer pause for 0.1-0.6 s while a commit or a page parse holds the main thread.

### 4.2 Not Rust, but needed for the goal

These are TypeScript fixes. Each matters more to how fast the app feels than any Rust move:

- **Cache rendered blocks in a lesson.** Memoise `renderMarkdown` by block text, or memoise the finished blocks in `SessionView`, so a streamed token re-renders only the live block. Expected: one update drops from about 51 ms (16 blocks) to about 3 ms whatever the lesson's length. Drawing time per turn drops from 7.5-8.2 s to about the first turn's 0.4 s, and frames return to about 100 a second. Keeping a block's DOM node stops the DOM churn that took the renderer from 140 to 446 MB.
- **Draw the Professor once per frame state**: cache the SVG string per (state, tick) or use a canvas, rather than one React `<rect>` per filled pixel of a 16-pixel-high sprite on every tick (0.4-0.5 s a turn).
- **Knowledge view:** re-parse roadmaps only when their files change (16 of its 41 ms).
- **Compile the subject regexes lazily, off the turn's path** (266 ms the first time).

### 4.3 What would make lessons faster

Lessons are slow where Gemma is slow, so that is where to act. From the 30 live turns:

1. **Prefix-cache misses cost 15% of all turn time.** Eleven calls read at least 800 new tokens: median prefill 14.5 s, median 2,292 new tokens, read at about 164 tokens a second. Ten of those calls had only the 3,451-token system prefix cached, so the conversation's snapshot was gone. The 19 warm calls had a median prefill of 4.6 s. Making the cold calls warm saves about 110 s of the 722 s. Tide's prefix-cache work in `modelServer.ts` (snapshots, read-back, reserve) addresses this. The places to look are what evicts a lesson's snapshot (background calls between turns, a 2 GB memory budget, swap) and the lesson start, which always reads the per-lesson context cold.
2. **Queueing behind other Gemma work costs 11%.** That is 80.6 s over 7 turns. Some of it is a dev artefact: StrictMode starts a session twice. The rest is background bank and readings calls that hold the model when a lesson starts. Defer those calls until the lesson is idle, run them in the cloud when a key exists (cloud calls can run in parallel with local ones), or pre-compute them before the lesson starts. The bank and lesson openings already do that (`bank.ts:223-240`).
3. **Back-to-back calls in one turn cost 10%.** Six turns made 2-4 model calls. The calls before the last one took 72.5 s of those turns' 130.9 s, and each re-reads the prompt. Fewer tool round trips, or a first step that the code does instead of the model, make the biggest per-turn difference.
4. **Prompt size.** Each 1,000 uncached tokens costs about 6 s. The stable prefix is 3,451 tokens, and the median prompt is 6,748. Keeping the variable part short, and putting retrieved passages after the cache point, compounds with item 1.
5. **Decode is 41%.** Median 29 tok/s, median reply 222 tokens. Shorter replies, and the draft model already wired in `modelServer.ts` (stated at +30% for code and JSON), are the levers.
6. **Warm prefill is slower than the benchmark.** Live warm calls had a median of 4.6 s for about 138 new tokens. `scripts/bench/gemma.py` measured 0.7-1.2 s for the same shape. The gap of about 3.5 s a turn is on the server side: snapshot restore from disk, swap, or contention. It should be investigated with `gemma.py` under the app's real memory conditions. Tide's Electron footprint, 0.6-1.0 GB, is part of that memory pressure but small next to the model's 11 GB.

## 5. Architecture, if adopted

### 5.1 Module boundaries

```
native/tide-core/                 one crate, one cdylib (tide-core.node), as today
  src/lib.rs                      napi bindings only: argument conversion, AsyncTask wrappers
  src/index.rs      (exists)      Tantivy index; Node-free
  src/recall.rs     (exists)      FSRS schedule
  src/knowledge.rs  (exists)      knowledge model (+ roadmap parsing, optional)
  src/lab.rs        (exists)      SQLite data lab
  src/extract/mod.rs  (new)       Node-free extraction, used by the bindings and by tests/benches
  src/extract/html.rs (new)       dom_smoothie: html + url -> { title, text, byline?, lang? }
  src/extract/pdf.rs  (new)       PDFium (pdfium-render, dynamic binding): path -> pages: Vec<String>
  src/extract/epub.rs (later)     zip + html5ever: bytes -> chapters
  src/jobs.rs         (new)       a small worker pool for the extraction jobs (PDFium is not thread-safe:
                                  one PDFium thread; HTML on the pool)
  benches/            (new)       criterion benches on fixtures
  examples/           (exists)    retrieval evaluation
```

Nothing to do with the model moves: prompts, routing, the model queue, streaming, sampling, prefix-cache tuning, and everything in `src/shared` stay in TypeScript. They are measured as cheap, and `src/shared` is also used by the renderer and by 134 test suites.

### 5.2 The napi interface

- **Rule: no native call over 1 ms on the main thread.** Anything that can exceed it returns a Promise. It is implemented as a napi `AsyncTask`, which runs `compute()` on the libuv pool and `resolve()` back on the JS thread, or on the crate's own thread for PDFium. Synchronous calls stay only for getters measured in microseconds (`size`, `paths`).
- New signatures, mirroring today's TS functions so the call sites hardly change:

```ts
// search.ts: commit is grouped (at most every ~2 s, and before quit) and awaited off-thread
commitAsync(): Promise<void>
replaceAsync(path: string, chunks: ChunkIn[]): Promise<void>
searchAsync(q: string, limit: number, paths?: string[] | null, typing?: boolean): Promise<Chunk[]>

// agent.ts readWebpageNow, library.ts: same return shape as today
extractArticle(html: string, url: string): Promise<{ title: string; text: string } | null>

// search.ts pdfPages, book.ts: same return as today; Rust also writes .tide/pdftext/<sha1(rel:size:mtime)>.json
pdfPages(absPath: string, cacheFile: string): Promise<string[]>
```

- Large data crosses once, as `String`, `Vec<String>` or `Buffer`. Rust reads files itself when given a path, rather than receiving a 7 MB `Uint8Array`.
- Errors come back as rejected Promises with a reason. A missing module or dylib means `tideCore()` returns null or the method is absent, and the caller uses today's JS path. That is the existing pattern in `native.ts` and `search.ts:157` with `TIDE_JS_SEARCH`.

### 5.3 Data ownership

| Data | Owner | Format |
| --- | --- | --- |
| Search index (`.tide` index dir, manifest) | Rust index, TS keeps the manifest of signatures | Tantivy, JSON manifest (unchanged) |
| PDF text cache `.tide/pdftext/*.json` | Rust writes, TS may read | unchanged key: `sha1("rel:size:mtimeMs")` |
| `knowledge.json`, recall DB, lab DBs | Rust (as today) | unchanged |
| Settings, chats, lessons, notes, bank, readings, all other `.tide` JSON | TypeScript | unchanged |
| Prompts, model requests and streams, Speed records | TypeScript | unchanged |

No data format changes, so moving back is always possible.

### 5.4 Tests and benchmarks

- **Rust unit tests** (`cargo test`) on fixtures: `test/fixtures/sourceLed/*.json` already holds real pages, and small public-domain PDFs and EPUBs can be added as fixtures.
- **Parity tests in vitest**, in the style of `test/nativeSearch.test.ts`. They run the JS path and the Rust path on the same inputs and assert:
  - PDF: word overlap ≥ 0.95 with pdf.js per book (measured here: 0.95-0.995), and identical page counts.
  - HTML: the extracted text covers ≥ 95% of jsdom + Readability's words, and the title is equal.
  - Index: `commitAsync` followed by a search returns the same results as the synchronous path.
- **Benchmarks**:
  - `cargo bench` (criterion) for each extractor.
  - A `scripts/bench/core.mjs` that reruns this document's comparisons under `ELECTRON_RUN_AS_NODE`: pdf.js and PDFium on the same PDFs, jsdom and dom_smoothie on the same pages, commit times.
  - The figures in section 3 are the baseline.
- **In the app.** Settings › Speed gets two more numbers per turn: main-thread worst stall (event-loop delay max) and, for cloud calls, time to first byte. The window already reports its own drawing. A regression in "milliseconds" then shows up where the owner already looks.

### 5.5 Migration, keeping the app working at each step

Each step is its own branch, passes `npm test` and `npm run typecheck`, and is re-measured with the scripts above before merging.

1. **Measure better.** Add main event-loop worst delay and cloud time-to-first-byte to `TurnSpeed` (speed.ts) and to Settings › Speed. No behaviour change.
2. **Async index calls.** Add `*Async` methods beside the synchronous ones. Switch `search.ts` to them, with grouped commits and a flush on `before-quit`. Keep the synchronous methods for one release, behind `TIDE_SYNC_INDEX=1`. Expect the 213-340 ms stall per lesson turn to drop to 0.
3. **HTML extraction.** Add `extract/html.rs` and the `extractArticle` binding. `readWebpageNow` and the library clipper call it first and fall back to jsdom if the module is missing, if it throws, or if the text is under 600 characters (the Firecrawl threshold that already exists). `TIDE_JS_EXTRACT=1` forces the old path.
4. **PDF text.** Ship `libpdfium.dylib` (arm64, about 7.6 MB) through `extraResources` next to `tide-core.node`, sign it with the app, and add it to `THIRD_PARTY_NOTICES.md`. Add `extract/pdf.rs`. `search.ts:pdfPages` and `book.ts` call `pdfPages` and fall back to pdf.js if the dylib or binding is missing. The cache key is unchanged, so no re-extraction happens on upgrade.
5. **Optional: EPUB**, and then remove `jsdom` and `@mozilla/readability` from the main process's dependencies once nothing uses them.
6. **Stop.** Re-measure section 2. Further moves need a new measurement showing a cost of tens of milliseconds or more on a path the owner waits on.

In parallel, and more important for lesson speed than any of the above: the JS fixes in 4.2 and the model-side items in 4.3.

## Appendix: the numbers' sources

| Number | Source |
| --- | --- |
| Lesson turn breakdown (2.1) | 30 records saved from Settings › Speed during the 11 November rehearsal: `speed-1.json` to `speed-7.json`, de-duplicated by turn id and time |
| Tide-only turn costs, renderer growth, memory (2.2-2.5) | Dev copy with the stand-in model, CPU profiles of main and window per turn, `Performance.getMetrics`, `monitorEventLoopDelay`, `app.getAppMetrics`, `footprint` |
| Library comparisons (3) | pdf.js and jsdom + Readability under Electron 42.3's Node; PDFium, pdf-extract, dom_smoothie, pulldown-cmark and comrak as a release build; the same three PDFs from the test vault and five public pages (Wikipedia: Raft, Softmax, CPU; MDN Closures; Python tutorial, Classes) |
| F_FULLFSYNC cost | 10 syncs of a 64 KB file on this Mac |
