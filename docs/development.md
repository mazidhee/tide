# Developing Tide

A local-first study app for macOS, built on an Obsidian vault. You read and write your own Markdown notes, and an AI tutor that runs on any OpenAI-compatible server (including local models through MLX, Ollama or LM Studio) probes your thinking, quizzes you, teaches step by step, and schedules your flashcards.

The user guide lives in [`user-guide.md`](user-guide.md) and is bundled into the app as **Help** (⌘?).

## Quick start

```sh
npm install
npm run dev        # electron-vite with hot reload (main, preload and renderer)
npm test           # vitest
npm run typecheck  # main/preload and renderer projects
npm run dist:mac   # build and package dist/Tide-<version>-arm64.dmg
```

Requirements: Node 22, macOS on Apple silicon for the packaged build. If `npm run dev` fails with "Electron uninstall", run `node node_modules/electron/install.js` once to download the Electron binary.

Development switches:

| Variable | Effect |
| --- | --- |
| `TIDE_REMOTE_DEBUGGING_PORT=9333` | Opens a Chrome DevTools Protocol port in dev builds, for driving and screenshotting the app |
| `TIDE_DEBUG_AI=/path/file.json` | Writes the last request sent to the AI server, for replaying model behaviour outside the app |

In dev builds, `window.__tide` exposes the app state (navigation, settings) for tooling.


## How it fits together

Tide is an Electron app with three layers. The renderer never touches the file system or the network directly; everything goes through a typed bridge.

```
Renderer (React)  ── window.tide (preload, contextBridge) ──  Main process (Node)
 views, editor,                                               vault files, search index,
 sessions, PDF                                                AI client and tool harness,
 reader, graph                                                library clipping, study data
                                                                   │
                                          ┌────────────────────────┼────────────────────┐
                                     Obsidian vault           AI server (OpenAI API)   Web search API
                                     (.md, .pdf, .tide/)      local or hosted          Wikipedia / Brave /
                                                                                       Tavily / SearXNG
```

The whole IPC surface is the `TideApi` interface in `src/shared/types.ts`. The preload (`src/preload/index.ts`) maps each method to an `ipcMain.handle` channel registered in `src/main/index.ts`. Streaming AI output arrives as `ai:event` messages (`ChatEvent`).

## Source layout

```
src/
  main/            Electron main process
    index.ts         window, menu, vault:// protocol, IPC handlers
    settings.ts      settings.json in the app's user data folder
    vault.ts         tree, read/write, wiki link resolution, note metadata, file watcher
    search.ts        MiniSearch index over note chunks and PDF text
    ai.ts            OpenAI-compatible client, retrieval, chat, quiz/flashcard/read-along generation
    agent.ts         tool-using tutor harness: note/web tools, helper agents, streaming tool calls
    sampling.ts      model-specific sampling fixes for local servers
    library.ts       saving articles, YouTube transcripts, PDFs and Word docs; cover images
    websearch.ts     private SearXNG search engine in Docker: status, setup, wake on launch
    outlineDraft.ts  new-topic outlines: research syllabi on the web, then stream a draft
    runner.ts        sandboxed Python/JavaScript runner: snippets, whole project folders, Matplotlib
                     charts captured as images, Tide's own Python (SymPy, NumPy, pandas, Matplotlib)
    companyPrep.ts   company interview plans: research the loop on the web, then stream a plan
    coach.ts         weekly plans towards the learner's goal, today's agenda, the learner profile note
    planner.ts       study plans: research, size (clamped to realistic ranges), audit; Things 4 export and sync
    things.ts        Things 4 client (local HTTP API, bearer token from Things' api.json)
    labCards.ts      flashcards from the commands run in a Linux lab session
    modelServer.ts   at launch, turns on mlx-vlm's prefix cache and (if downloaded) Gemma 4's MTP draft model
    memo.ts          time-limited cache for web searches, pages and papers
    terminal.ts      terminals via node-pty: Linux lab (Ubuntu in Docker) and a local shell; tutor read/run tools
    modelQueue.ts    scheduler for the one local model: interactive first, background work waits and yields
    search.ts        local search index (MiniSearch), reindexing serialized per file
    memory.ts        what the tutor remembers about the learner
    chats.ts         stored conversations, budgeted history and compaction
    brief.ts         Home's daily recap
    exam.ts          exam papers and marking (including photos of handwritten answers)
    practice.ts      coding practice tracker with spaced re-interviews
    study.ts         flashcard parsing (Spaced Repetition format + clozes), FSRS scheduling
    learn.ts         link graph (cached, shared with the tutor), notebooks, learning status,
                     attempts and mastery, tutor threads, goals, explain-from-memory queue,
                     library subjects, interview history, records that follow renames
    highlights.ts    PDF highlights
  preload/         contextBridge exposing window.tide
  shared/          code used by both sides
    types.ts         every type crossing the bridge
    session.ts       learning-session prompts and the tag protocol parser
    personas.ts      reviewer personas
    outline.ts       Markdown checklist outline parser/serializer, topic sources, draft cleanup
    thumbs.ts        where library covers are cached
    modelText.ts     cleaning model output (special tokens, hidden reasoning, loop detection)
    cards.ts         formatting cards in the Spaced Repetition syntax
    canvas.ts        system design canvases (JSON Canvas): edit operations shared by the editor and
                     the tutor's canvas_edit tool, text descriptions, redraw-from-memory comparison
    interviews.ts    mock interview results: scorecard and verdict parsing, per-company trends
    plan.ts          study plan sizes, phase dates, dated roadmaps, reading lists, plan front matter
    drills.ts        mental maths speed drills, generated and marked in code
    learnIntent.ts   spotting "I want to learn X" so it starts a plan, not a chat answer
    labCards.ts      finding lab commands in a terminal transcript, merging cards without repeats
  renderer/src/    React UI
    App.tsx          shell, routing between views, theme, menu actions, drag and drop
    state.tsx        app state: settings, tree, current view, history, toasts
    components/      one file per view or widget (NoteView, PdfView, SessionView, OutlineView, …)
    lib/             markdown rendering, page settings, thread engine, mermaid, companion notes
    styles/          theme.css (tokens), app.css (layout and components), prose.css (reading)
docs/user-guide.md   the user guide, bundled into Help
test/                vitest suites
build/icon.icns      app icon
```

## Key design decisions

**The vault is the source of truth.** Notes, outlines, saved pages and flashcards are plain Markdown in formats Obsidian already understands: wikilinks, callouts, `learning_status` frontmatter, Spaced Repetition plugin cards, checklist roadmaps. The outline parser round-trips files byte for byte (tested against a real 600-line roadmap). App-only data lives in `<vault>/.tide/`, which Obsidian ignores.

**Untrusted content is sanitized.** Notes may contain raw HTML and clipped web pages are untrusted, so all rendered Markdown passes through DOMPurify. Only YouTube embed iframes are allowed, the URI allow-list is narrow, and if DOMPurify can't run the renderer escapes everything instead of passing HTML through. Packaged builds add a strict Content Security Policy. Links open in the user's browser, never inside the app.

**The canvas is a file, and the tutor edits it with operations.** A system design is a `.canvas` file (JSON Canvas, so Obsidian opens it). The editor and the tutor's `canvas_edit` tool both go through `applyCanvasOps` in `shared/canvas.ts`, which places new components without overlaps and accepts the field names small models tend to use. Every message carries `describeCanvas`, a plain-text list of components and connections, so the model reasons about the design rather than pixels. Redraw-from-memory scores in code (`compareDesigns`) and gives the model the result, so the score doesn't depend on the model's judgement.

**Memory is a short note, not a long history.** Every request resends the whole prompt and this Mac reads prompts at a few hundred tokens a second, so context is kept small on purpose: the tutor carries a learner profile of under 1,400 characters (`Coach/Learner profile.md`, rewritten weekly from progress data, editable by the learner), the explicit memories, and a running summary per conversation. Everything else (the week's plan, notes, tasks) is fetched by tools when a question needs it. The profile sits in the stable part of the system prompt, so the server's prefix cache still holds between turns.

**Plans are sized by the model and bounded by code.** Asked how long something takes, a small model pads (it planned Metabase as three months). `normalizePlan` keeps the total inside a range for the kind of subject (a tool 1–4 weeks, a skill 1–4 months, a discipline 6–18 months, a career 2–4 years, at 6 hours a week, scaled by the learner's hours and capped by their deadline) and scales the phases to fit. Dates, exams and practice lines are put into the roadmap by code too, so they're always there and always consistent with the front matter that Things 4 export reads.

**Speed on a local model is mostly prompt reading.** On an M4 Pro, Gemma 4 12B reads prompts at a few hundred tokens a second, so resending a 2,300-token system prompt each turn and each tool step cost seconds. The system prompt is kept stable turn to turn (per-turn passages go in the last user message), `modelServer.ts` switches on mlx-vlm's prefix cache at launch, and `warmChat` loads the opening of an ordinary chat in the background. A follow-up then starts in about a second instead of five. If Google's Gemma 4 12B assistant drafter (`mlx-community/gemma-4-12B-it-qat-assistant-5bit`, 323 MB) is in the Hugging Face cache, it's switched on too: speculative decoding with multi-token prediction took code and JSON from about 31 to 41 tokens a second on an M4 Pro, prose only about 5%, with identical outputs and tool calls.

**Retrieval is local and cited.** Notes are chunked by heading and PDFs by page, then indexed with MiniSearch. The tutor gets numbered sources and cites them as `[n]`; the UI turns citations into links back to the passage.

**The tutor drives a tool loop.** `agent.ts` streams each turn with OpenAI-style function calling and accumulates tool-call deltas. Tools: `search_notes`, `read_note`, `web_search` (with `when` and `news`), `search_papers` (arXiv), `read_webpage` (HTML or PDF), `run_code`, and `delegate`, which runs up to three helper agents in parallel, each with its own shorter loop. Every source any of them reads gets a citation number. Guards: identical repeated calls are refused, the last round keeps its tools but ignores any calls (so the prompt stays cached), and servers without tool support fall back to plain retrieval chat. Replies that stall on an empty thought channel are carried on from where they stopped.

**Sessions use a tag protocol.** Learning sessions ask the model to write Markdown plus a few tags, which `src/shared/session.ts` parses even while the text is still streaming:

| Tag | Becomes |
| --- | --- |
| `<ask type="predict\|short\|choice\|explain\|error\|problem\|code">` | The answer card (one per turn) |
| `<grade verdict="…" score="0–1">` | A graded verdict with feedback, recorded as an attempt |
| `<card>front :: back</card>` | A flashcard offered from a miss |
| `<plan>`, `<summary>` | Lesson plan tracker, end-of-session summary |
| `<scorecard>`, `<rubric>` | Interview and writing scores (`Label: n/max — note` lines) |
| `<challenge quote="…">` | A challenge tied to a sentence in the student's text |

Simple tags proved more reliable than strict JSON for small local models in the middle of a conversation.

**Local model quirks are handled in one place.** `sampling.ts` adds fixes only for local servers, because hosted APIs reject unknown fields. Gemma 4 can loop forever opening empty hidden-reasoning blocks on long contexts. A repetition penalty doesn't fix it, but banning the `<|channel>` token (id 100) with `logit_bias` does. `modelText.ts` also strips hidden reasoning from streams (even when split across chunks) and detects loops on the raw stream, triggering one retry with more randomness.

**Web search is private by default.** `websearch.ts` runs SearXNG in Docker bound to 127.0.0.1:8888 and switches the tutor to it. Results are de-duplicated and dated; if the engine is unreachable the tutor falls back to Wikipedia and tells the model so. New-topic outlines do their research in code (two searches, the two best pages read) before one streamed generation, which keeps a small model on format; `normalizeOutlineDraft` then turns whatever it wrote into a clean checklist.

**App records follow renames.** Notebook settings, library subjects and goals are keyed by path, so `vault:rename` calls `onPathMoved` to rewrite them (outline paths inside moved folders too). Writes to these JSON files go through a per-file queue, so quick successive edits can't overwrite each other.

**Mastery is computed, not stored.** `learn.ts` derives a level per note from session attempts (newer answers weigh more), flashcard reviews (weighted lower, since recall isn't understanding) and the note's learning status. Confidently wrong answers are counted as misconceptions.

**The link graph is shared with the tutor.** `learn.ts` caches the graph (`graphCached`, invalidated when the vault changes) and `relatedNotes` returns a note's links, backlinks, two-step neighbours and same-tag notes with their mastery. The agent's `related_notes` tool exposes it, and note-scoped turns also get the best passage from up to three linked notes.

**The writing coach** reuses read-along: after a pause, `readAlong(..., 'coach')` returns one margin note (question, correction, gap or clearer wording). `parseCoachNote` rejects rewrites that are far shorter or longer than the original, so Apply never swaps a sentence for something unrelated.

**Scheduling uses FSRS** through `ts-fsrs`, with schedules saved by the earlier SM-2 scheduler migrated on read. Each card carries next-interval previews for every grade, so the UI shows real numbers.

## Data files

| File | Contents |
| --- | --- |
| `~/Library/Application Support/Tide/settings.json` | Vault path, theme, AI server, web search provider |
| `.tide/srs.json` | FSRS state per card id |
| `.tide/reviews.jsonl` | One line per flashcard review |
| `.tide/attempts.jsonl` | One line per graded answer in a session |
| `.tide/progress.json` | Quiz history |
| `.tide/threads/<sha1>.json` | Inline and margin tutor threads per note |
| `.tide/highlights/<sha1>.json` | PDF highlights |
| `.tide/notebooks.json`, `.tide/covers/` | Notebook covers, colours, descriptions, outline note |
| `.tide/pdftext/<sha1>.json` | Extracted PDF text cache |
| `.tide/thumbs/` | Library covers (`.none` marks an item with no picture) |
| `.tide/library.json` | Subjects each library item is filed under |
| `.tide/goals.json`, `.tide/recall.json`, `.tide/practice.json` | Goals, explain-from-memory schedule, coding practice |
| `.tide/interviews.jsonl` | One line per mock interview round: company, round, score, verdict, timed |

Card ids are a hash of the note path and the card's front, so editing an answer keeps the card's history.

## Styling

All colour comes from tokens in `styles/theme.css`, one block per theme (Light, Sepia, Graphite, Slate, Midnight, Ember, plus Match system). Type uses a fixed scale (`--text-2xs` to `--text-lg`). The reading column's width is set in ems of the reading size (`--measure`), so a title and its body always share one column. Toolbars use container queries, so they adapt to the space their view has rather than the window size. Fonts are bundled (Source Serif 4, Inter, JetBrains Mono) so the app works offline.

## Tests

`npm test` runs these suites:

| Suite | Covers |
| --- | --- |
| `main.test.ts` | Chunking, flashcard and cloze parsing, FSRS scheduling and migration, JSON and LaTeX repair, YouTube ids, note metadata |
| `markdown.test.ts` | Math, wikilinks, embeds, callouts, highlights, tasks, sanitizing, block anchors |
| `outline.test.ts` | Exact round-trips, including the real vault roadmap when present |
| `session.test.ts` | Session tag parsing, including mid-stream and loosely formatted output |
| `modelText.test.ts` | Hidden-reasoning filtering across chunks, loop detection |
| `integration.test.ts` | Chat and quiz against a mock OpenAI server; live YouTube and article saving when online |

Integration tests use a throwaway vault in the system temp folder, never your real notes.

## Packaging

`npm run dist:mac` builds with electron-vite and packages an arm64 DMG with electron-builder, using `build/icon.icns`. The app is not code-signed (`identity: null`), so macOS asks for confirmation on first launch. `pdfjs-dist` is unpacked from the asar, because PDF text extraction loads its worker from disk.
