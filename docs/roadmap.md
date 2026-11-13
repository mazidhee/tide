---
title: Tide roadmap
---

# Tide roadmap

**Rule for every feature: build for Claude's full capabilities, and keep Tide working without it.** Claude is the main tutor: each feature should use everything Claude can do (deep thinking, Claude Code's own tools, long context, vision, generated visuals, web research) as fully as it can, without holding back to fit a smaller model. Every feature must also still work, more simply, on Gemma, on another provider, or when the plan's usage runs out. Claude-only extras (Claude Code's own tools, thinking depth, generated visuals) switch off cleanly and say so; lessons, courses, notes, recall, What you know and the reader never depend on Claude.

Testing is your daily use: bugs go in the **Tide bugs** note in this notebook, and each working session starts by fixing them. No separate benchmark or rehearsal sessions.

Up to three builds at a time, each in its own folder, merged, tested and installed as it lands. Gemma no longer stays loaded while Claude teaches, so there's room.

Last updated: 13 November 2026.

## In the app now

- Lessons in any subject, with live code, SQL, simulations, readings and the tutor's questions
- Recall across lessons: the next lesson opens with what is due
- What you know: syllabus by subject, a timeline with forecasts, FSRS forgetting, fed by lessons, quizzes and flashcards
- Review now (spaced review of what is due) and Quick check (a fresh diagnostic)
- Live preview in the note editor (⌘⇧E for source)
- Teaching blocks: physics, geometry and matrices, regex, chess search, SQL tidy
- Courses from GitHub: 52 courses (zoomcamps, OSSU, Made With ML, Zero to Hero, d2l…), taught from their own text, notebooks runnable
- A VS Code-like code editor: Python IntelliSense (basedpyright), VS Code highlighting, explorer, tabs, Problems, Tests, ⌘P
- Claude teaches (your plan): Sonnet turns, Opus marking and plans, Haiku background; Tide's tools over MCP (notes, code, SQL, courses, transcripts, flashcards, recall); web search in lessons; usage view; Claude Code in your terminal can use Tide (Settings › Models)
- Claude's visuals: a custom interactive explainer per concept, sandboxed (no network, no access to Tide), checked and repaired before showing, cached per lesson
- Claude's exercises are proven first: code against hidden tests (and a known mistake), SQL against the lab, maths by SymPy; repaired once or replaced; banked for reuse
- Courses you live in: every link, file, article and YouTube video opens inside Tide (player with synced transcript, reader view, sandboxed web view); the tutor sees the page, section or video moment; lessons bring in credited readings and clips from your other courses
- Lesson threads: ask about any explanation in a thread under it, follow up as long as you like, fold it when you've got it; the lesson stays clean
- Courses from everywhere: MIT OpenCourseWare, Open Yale, QuantEcon, free books, university lecture series and official guides, with 47 picked for your subjects; a weekly check suggests new and updated courses, never importing on its own
- Faster lessons: off-thread index, cached rendering, steadier prompt cache, idle unload
- The redesign, with the classic design in Settings
- Courses you live in (branch `videos`): every link opens inside Tide (course files rendered natively, any GitHub file, YouTube in Tide's player with its transcript, web pages in a reader with Save to library, apps in a sandboxed web view); the course room (sidebar on hover, outline beside the text, the lecture beside it and in theatre when it plays, the tutor docked under the text); the tutor sees the page, section, video moment and selection and can move the video or page; lessons open with what your other courses and lectures add, credited; reading, watching and running course material counts in What you know

- Lesson fixes from your bugs note, the lesson map (where a lesson is heading, the step you're on, when it ends), notes open to write, thread replies save to notes, Explore later side lessons
- Warm-up on what a lesson builds on; tea breaks timed by your own signals; the morning workout (five adaptive rounds, thinking puzzles and chess, titles, streaks, a pixel party)
- A tidier Courses page; Gemma loads only when needed; images go to Claude; usage and cost in detail
- A tutor that remembers you, lesson prep while you're away, teaching quality measured
- A full IDE in the Code view (debugger, git, search, languages, tests) with Claude pair-programming; coding lessons get the same tools
- Mock interviews and exams; projects from an idea with levels up to flagship systems, a ready check, you write the code and Claude tutors, a mentor and debriefs
- You in Tide: name, photo and a pixel self; the sidebar peeks from the left edge when collapsed

## Now

- [ ] **End-to-end check of every main flow (next session).** One scripted pass in a test copy with real Claude: click through each feature once (lessons and the lesson map, threads, warm-ups and breaks, workout, courses, reading room, IDE and coding lessons, projects with the ready check and debrief, mocks, maths tutor and explorables, finance labs, goals and planning, backups and restore, the bug shortcut, pop-outs) and report what breaks between features. Not a benchmark.
- [x] **Pop-out windows everywhere.** Open a lesson, project, course, note, the reader or a mock in its own window, from a clear button, ⌥⌘N or right-click.
- [x] **The reading room.** Library › Reading: tonight's chapter in "Then today", an immersive reader (highlight, quote, margin notes, Challenge me, the core argument), a book page with a cover banner, an end-of-chapter seminar, and listening with a mini player.
- [x] **Goals and dynamic planning.** Goals with or without a date, broken down by Opus into what they need (roadmaps, projects, mocks, workout rounds, books, new topics) and yours to edit; every roadmap and project in progress kept alive as a standing goal; a portfolio scheduler in code (shared/portfolio) that mixes each week and day across all of it with a touch limit per thread, deadlines weighted as they near, interleaving, spaced review and hard work in your best hours; a plain note on the week's mix; the rest of the week reshuffled each morning and after a miss or a finish, saying what moved and why, raising neglect and drift; honest trade-offs with numbers and choices; Things kept in step. In Your week, no new sidebar item. Built: worktree `tide-goals`, waiting to merge.
- [x] **Maths tutor.** First-principles, Socratic teaching for maths and statistics; drift detection that switches format; explorables you drag (derivatives, matrices, distributions, random walks); poke-holes challenges; a maths-to-quant ladder.
- [x] **Claude for everything.** Remove the privacy routing: private notebooks and Metabase go to Claude; Gemma only when Claude is unavailable.
- [x] **Backups of Tide's own data.** A nightly local backup of `.tide/` and app data (lessons, ratings, profile, usage, workout), kept for weeks, with restore in Settings.
- [x] **Report a bug from anywhere.** One shortcut adds a line to the Tide bugs note, with a screenshot of the screen.
- [x] **Weekly progress, in Your week.** Mastered, workout ratings, projects, books and time, on the existing page (no new sidebar item).
- [ ] **Learn Metabase on your own data.** Tide maps your connected Metabase (databases, tables, links, the dashboards people use) into a "Your data" note and a roadmap; lessons on your real tables from the query builder to SQL and data science (filters and summaries, combining data with joins and models, custom columns and metrics, window functions, cohorts, funnels, a first regression, good dashboards); exercises checked by running your query and a reference read-only and comparing; "take apart this dashboard" lessons; Metabase open beside the tutor in Tide's web view. Read-only by default, small row limits, nothing written to Metabase unless you ask. Needs Metabase connected in Settings › Connections.
- [ ] **Leftovers from 13 Nov.** Everything in the "Dropped along the way" line under Small fixes.
- [ ] **Claude thinks as hard as each job needs, plus three fixes.** The coding tutor runs your code; review comments and suggestions survive a reload; sharper eyes on pixel avatars.
- [ ] **Maths animations with Manim (important).** Manim Community Edition (MIT): the tutor writes a short scene for the idea you're on (vectors and transformations, eigenvectors, derivatives, gradient descent on a loss surface, backprop, attention, Fourier, the CLT), Tide renders it in the sandbox and plays it in the lesson, repaired if it fails, narrated in Tide's voice (manim-voiceover); a library of tested scenes adapted to your example; pre-rendered by overnight prep and cached. Pairs with the explorables (watch, then break it). Ask before installing Manim (about 200 MB) and TinyTeX for equations.
- [ ] **Maths answers and a scientific calculator.** The answer box in maths lessons: say or type in plain words with a rendered read-back; a full scientific calculator and expression editor (MathLive with its maths keyboard: fractions, roots, powers, trig, logs, sums, integrals, limits, matrices, Greek), evaluating exactly (SymPy) and numerically, with a history and "insert into my answer"; paper via iPhone Continuity Camera or a photo, where Claude transcribes each line, marks it and boxes the wrong line on your page. No drawing pad. Prototype: scratchpad/mathinput. Next after the maths tutor.
- [ ] **Notebook and quant lab.** A Jupyter-compatible notebook in Tide with the tutor in the margin (build on Jupyter's kernel or marimo); the lab pack (scipy, statsmodels, scikit-learn, polars, DuckDB, cvxpy, QuantLib, arch); market data from free sources; finance visuals (yield curve, option payoffs and Greeks, Monte Carlo, efficient frontier, order book). Check each licence first (OpenBB is AGPL).
- [ ] **Audiobook voices.** Download two or three local voices (Chatterbox, Orpheus, VibeVoice or newer) after asking, play the same passage in each, and keep the one you pick; render chapters ahead while idle; narrator plus character voices. ElevenLabs as an option for public-domain books.
- [x] **Tide tuned for finance, payments and quant.** Your focus subjects: stablecoins, payments and payment rails, core banking, open banking, payment infrastructure, quantitative finance, risk, blockchain, plus ML, data engineering, data science and economics.
  - Roadmaps for each, built from the best sources.
  - Trusted sources: BIS, central banks, ISO 20022, Bitcoin and Ethereum docs, QuantEcon, the Fed and ECB.
  - Courses in the catalogue for each.
  - Labs:
    - double-entry ledgers and a core-banking simulation
    - payment messages and settlement (ISO 20022, card and instant-payment flows)
    - stablecoin mechanics
    - backtests, risk (VaR, stress tests), Monte Carlo and pricing
    - market data in the SQL and Python lab
  - Visuals and checked exercises for each.
- [x] **Usage and cost, in detail.**
  - Your plan's five-hour and seven-day windows: how full, when they reset, and a projection.
  - Tokens (input, output, thinking, cache read and write) per call, lesson, day, model and job.
  - The most expensive lessons, turn by turn; cache savings; speed per model.
  - Dollar figures labelled as API-price equivalents, since the plan isn't billed per token.
  - Gemma and other providers shown the same way.
- [ ] **Claude thinks as hard as each job needs.** Long thinking for curriculum plans, proofs and hard design questions; quick replies for chat. Tuned by measurement, cheaper overall. Without Claude: no change.
- [x] **Claude's coding powers in lessons, projects and interviews.** Claude Code's own tools (read, edit, run, test, debug), limited to a project folder in Tide's sandbox. Real pair programming: building a feature together, a bug planted for you to find, your changes reviewed as diffs. Without Claude: today's code lessons, runner and tests.
- [x] **Teaching quality, measured.** From your real lessons, no test sessions. Misconceptions (named by Opus's marks, tracked to resolved), near and far transfer, hint dependence, confidence calibration (accuracy by Guessing, Unsure and Sure, Brier score), time to mastery and next-day and next-week retention, for any model. Opus reviews each finished lesson against a teaching rubric, and Tide adjusts how it teaches from a fixed set of changes, each with an off switch, on "How Tide is teaching you" in What you know.
- [ ] **Low-level labs.**
  - A debugger (lldb) stepping through your program with a live view of registers, stack and memory.
  - A disassembler showing what your C becomes.
  - System calls and packet traces.
  - A blockchain built from scratch (hashing, Merkle trees, signatures), checked by tests.
  - Reading real codebases together (SQLite, Redis, Bitcoin).
  - The tools work without Claude; Claude narrates them best.
- [x] **Claude: a tutor that remembers you.** A learner profile in your vault (misconceptions, pace, what clicked), kept up by Claude and read with your past lessons and mistakes before each session.
- [x] **Claude: lesson prep while you're away.** Background prep before tomorrow's lesson: what's due, the best reading, exercises, a custom visual, a short plan. Plus a weekly review.
- [x] **Claude: a mentor for your projects.** Reads your whole project across sessions, reviews it like a senior engineer, runs your tests, and proposes edits in the Code view that you approve line by line.
- [ ] **Claude: reading primary sources together.** Papers, documentation and classics read in full, with web search and page reading. A seminar that argues, steelmans and critiques your writing.
- [x] **Claude: photos and screenshots.** Mark handwritten maths from a photo; explain a diagram or an error screenshot. Pictures in chat, lessons, threads, notes and exams go to Claude as image blocks (scaled to 1568 px, HEIC to JPEG), Gemma when Claude can’t or the work is private.
- [x] **Claude: mock interviews and exams.** Live coding with tests and system design on the canvas, timed and marked.
- [x] **Claude: a simpler, faster Tide.** Switch off the Gemma workarounds (stall guards, retries, output repair, constant trimming) on Claude lessons.
- [ ] **Faster lesson starts and fewer stalls.** The first answer of a new lesson takes 14–27 s. Gemma stalls in about 14% of turns, and retries run one after another. The turn after a long lesson is trimmed re-reads it all. Partial work: worktree `tide-fast2`.
- [ ] **Everyday check: Python and ML from zero.** Run real lessons the way you use Tide ("I want to learn Python", "I want to learn ML"), over several sessions, and fix what goes wrong.
- [ ] **Lab pack ready before it's needed.** Install the data and ML packages (about 900 MB) from Settings, in the background, so the first ML lesson doesn't stall for 30 s. Partial work: worktree `tide-voice`.

## Next

- [ ] **Humanities, tested live.** Meditations, The Prophet, a Russian novel: Discuss this, highlights, notes, challenging your arguments.
- [ ] **New subjects, tested live.** Physics, game dev, core banking, building a database. Run the 69 untried tutor test scenarios against Gemma and fix what fails.
- [ ] **Narrated simulations.** Each step of a simulation read aloud in the tutor's Kokoro voice. Built: worktree `tide-voice`, 2 commits.
- [ ] **Narrow windows.** Project lesson buttons wrap below 800 px.

## Later

- [ ] **Calendar awareness and time blocks (later). Deferred: not being built now.** Read macOS Calendar through a small native helper (EventKit, with the user's permission), so the week and the day plan around meetings and free time instead of a fixed number of minutes a day. Then write approved study blocks to a separate Tide calendar (never your own calendars), only after you accept them, and keep them in step when the replanner moves things. Builds on Goals and dynamic planning.
- [ ] **System-design canvas on xyflow.** Animated request flow along the arrows during a lesson. Built in part: worktree `tide-canvas`, 2 commits.
- [ ] **Better web clipper and search.** Compare Defuddle with the current clipper, and try a reranker; adopt only if the numbers win.
- [ ] **Live preview leftovers.** The properties block at the top of a note, embedded notes, and tables and maths inside lists.
- [ ] **Small fixes.**
  - Dropped along the way (13 Nov): the warm-up isn't a stage on the lesson-map track; walkthrough, dialogue and refresher lessons get no lesson map; practice and flashcard sessions don't tell the break planner when a block ends; two Tide windows can start the same tea break (a doubled log line); warm-up relevance matches names only, so an unrelated-sounding topic misses its groundwork (an optional Haiku rerank); side lessons from Explore later still say "Teach me" in the header; private lessons are skipped by the learner profile (a Gemma path); pictures inside PDFs aren't sent to Claude; cloud-provider failures aren't in the usage log; the workout's bits round, trophy ceremony and streak scene and the maths reminder were never seen live; a live mock can't move to its own window; nobody presses Guessing, Unsure or Sure, so calibration has no data (make it one tap or infer it).
  - From 13 Nov: the coding tutor sometimes trusts the hidden tests instead of running your code; review comments and pending proposals are lost on reload; Node/JS debugging; ⌘W, ⌘J and ⌘\ with physical keys in the IDE; Go projects untested; the pixel self's eyes come out soft on real photos at 32 px; lesson prep's near-limit check should use the plan-window figures; the mock history chart mixes kinds; the design canvas's own colours per component; project ready checks and debriefs need a live run; the Opus project plan takes 3–4 minutes.
  - Courses: no open-banking course yet (the UK standards site is on github.io, blocked here); QuantEcon's websites unreachable here, so it's read from GitHub; ranking without Claude lets weak GitHub repos through; long lessons can show step names like "part 3" with no part 2.
  - Threads: "Add to notes" text isn't kept on reopen; threads may not follow a lesson into its own window; "Ask first" still asks in the main lesson; Gemma path checked by tests only.
  - Courses: the video pausing for a question; highlights in course PDFs; github.io and some sites won't load on this network; Medium link cards come through rough; check Claude draws on a second course's code when it's better.
  - Readings sometimes arrive before an exercise Claude meant to set; a code ask written outside set_exercise is marked by eye.
  - Claude: marking waits 4–7 s while Opus thinks; try a lower effort setting for marking. Other background jobs (margin notes and the like) still run on Gemma.
  - Code editor: pandas parameter types show "Unknown" until pandas-stubs is in Tide's Python; rename only changes open files; ⌘⇧O is taken by Add Files.
  - Course lessons: Gemma often writes the plan before probing; "Show me" on a course's first step shows the reading again.
  - Course notebooks needing IPython, data files or internet can't run yet; homework has no generated tests.
  - Long regex diagrams scroll sideways.
  - Matrix labels sit under the drag handles.
  - A notebook holding only its roadmap is left off the knowledge map.
  - Decide whether one right answer should make a topic solid (FSRS says about 4.5 days) or two.
- [ ] **PDF reading in Rust.** Removes a one-time 455 ms load.

## Not doing

- Cloud models tested live: dropped 13 Nov, Claude is the tutor.

- Separate benchmark and rehearsal sessions: daily use and the bugs note do that job

- Fine-tuning Gemma (the Mac runs out of memory; marking is already 97%)
- The pathways graph view
- A new dock icon
