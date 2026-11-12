---
title: Tide roadmap
---

# Tide roadmap

**Rule for every feature: build for Claude's full capabilities, and keep Tide working without it.** Claude is the main tutor: each feature should use everything Claude can do (deep thinking, Claude Code's own tools, long context, vision, generated visuals, web research) as fully as it can, without holding back to fit a smaller model. Every feature must also still work, more simply, on Gemma, on another provider, or when the plan's usage runs out. Claude-only extras (Claude Code's own tools, thinking depth, generated visuals) switch off cleanly and say so; lessons, courses, notes, recall, What you know and the reader never depend on Claude.

Testing is your daily use: bugs go in the **Tide bugs** note in this notebook, and each working session starts by fixing them. No separate benchmark or rehearsal sessions.

One feature at a time, in this order. Each one is built, tested, installed, and only then is the next one started. Nothing runs in parallel: the Mac has 24 GB, and Gemma needs most of it.

Last updated: 12 November 2026. Courses from GitHub and the fuller code editor moved to the top at your request.

## In the app now

- Lessons in any subject, with live code, SQL, simulations, readings and the tutor's questions
- Recall across lessons: the next lesson opens with what is due
- What you know: syllabus by subject, a timeline with forecasts, FSRS forgetting, fed by lessons, quizzes and flashcards
- Review now (spaced review of what is due) and Quick check (a fresh diagnostic)
- Live preview in the note editor (⌘⇧E for source)
- Teaching blocks: physics, geometry and matrices, regex, chess search, SQL tidy
- Courses from GitHub: 52 courses (zoomcamps, OSSU, Made With ML, Zero to Hero, d2l…), taught from their own text, notebooks runnable
- A VS Code-like code editor: Python IntelliSense (basedpyright), VS Code highlighting, explorer, tabs, Problems, Tests, ⌘P
- Claude teaches (your plan): Sonnet turns, Opus marking and plans, Haiku background; Tide's tools over MCP (notes, code, SQL, courses, transcripts, flashcards, recall); web search for non-private lessons; usage view; Claude Code in your terminal can use Tide (Settings › Models); private notebooks stay on Gemma
- Claude's visuals: a custom interactive explainer per concept, sandboxed (no network, no access to Tide), checked and repaired before showing, cached per lesson
- Claude's exercises are proven first: code against hidden tests (and a known mistake), SQL against the lab, maths by SymPy; repaired once or replaced; banked for reuse
- Courses you live in: every link, file, article and YouTube video opens inside Tide (player with synced transcript, reader view, sandboxed web view); the tutor sees the page, section or video moment; lessons bring in credited readings and clips from your other courses
- Lesson threads: ask about any explanation in a thread under it, follow up as long as you like, fold it when you've got it; the lesson stays clean
- Courses from everywhere: MIT OpenCourseWare, Open Yale, QuantEcon, free books, university lecture series and official guides, with 47 picked for your subjects; a weekly check suggests new and updated courses, never importing on its own
- Faster lessons: off-thread index, cached rendering, steadier prompt cache, idle unload
- The redesign, with the classic design in Settings
- Courses you live in (branch `videos`): every link opens inside Tide (course files rendered natively, any GitHub file, YouTube in Tide's player with its transcript, web pages in a reader with Save to library, apps in a sandboxed web view); the course room (sidebar on hover, outline beside the text, the lecture beside it and in theatre when it plays, the tutor docked under the text); the tutor sees the page, section, video moment and selection and can move the video or page; lessons open with what your other courses and lectures add, credited; reading, watching and running course material counts in What you know

## Now

- [ ] **Tide tuned for finance, payments and quant.** Your focus subjects: stablecoins, payments and payment rails, core banking, open banking, payment infrastructure, quantitative finance, risk, blockchain, plus ML, data engineering, data science and economics.
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
- [ ] **Claude's coding powers in lessons, projects and interviews.** Claude Code's own tools (read, edit, run, test, debug), limited to a project folder in Tide's sandbox. Real pair programming: building a feature together, a bug planted for you to find, your changes reviewed as diffs. Without Claude: today's code lessons, runner and tests.
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
- [ ] **Claude: a mentor for your projects.** Reads your whole project across sessions, reviews it like a senior engineer, runs your tests, and proposes edits in the Code view that you approve line by line.
- [ ] **Claude: reading primary sources together.** Papers, documentation and classics read in full, with web search and page reading. A seminar that argues, steelmans and critiques your writing.
- [x] **Claude: photos and screenshots.** Mark handwritten maths from a photo; explain a diagram or an error screenshot. Pictures in chat, lessons, threads, notes and exams go to Claude as image blocks (scaled to 1568 px, HEIC to JPEG), Gemma when Claude can’t or the work is private.
- [ ] **Claude: mock interviews and exams.** Live coding with tests and system design on the canvas, timed and marked.
- [x] **Claude: a simpler, faster Tide.** Switch off the Gemma workarounds (stall guards, retries, output repair, constant trimming) on Claude lessons.
- [ ] **Faster lesson starts and fewer stalls.** The first answer of a new lesson takes 14–27 s. Gemma stalls in about 14% of turns, and retries run one after another. The turn after a long lesson is trimmed re-reads it all. Partial work: worktree `tide-fast2`.
- [ ] **Everyday check: Python and ML from zero.** Run real lessons the way you use Tide ("I want to learn Python", "I want to learn ML"), over several sessions, and fix what goes wrong.
- [ ] **Lab pack ready before it's needed.** Install the data and ML packages (about 900 MB) from Settings, in the background, so the first ML lesson doesn't stall for 30 s. Partial work: worktree `tide-voice`.
- [ ] **Cloud models, tested live.** Route hard questions to stronger cloud models, with your keys in a throwaway test profile (approved), keeping private-project and Metabase content on the Mac.

## Next

- [ ] **Humanities, tested live.** Meditations, The Prophet, a Russian novel: Discuss this, highlights, notes, challenging your arguments.
- [ ] **New subjects, tested live.** Physics, game dev, core banking, building a database. Run the 69 untried tutor test scenarios against Gemma and fix what fails.
- [ ] **Narrated simulations.** Each step of a simulation read aloud in the tutor's Kokoro voice. Built: worktree `tide-voice`, 2 commits.
- [ ] **Narrow windows.** Project lesson buttons wrap below 800 px.

## Later

- [ ] **System-design canvas on xyflow.** Animated request flow along the arrows during a lesson. Built in part: worktree `tide-canvas`, 2 commits.
- [ ] **Better web clipper and search.** Compare Defuddle with the current clipper, and try a reranker; adopt only if the numbers win.
- [ ] **Live preview leftovers.** The properties block at the top of a note, embedded notes, and tables and maths inside lists.
- [ ] **Small fixes.**
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

- Separate benchmark and rehearsal sessions: daily use and the bugs note do that job

- Fine-tuning Gemma (the Mac runs out of memory; marking is already 97%)
- The pathways graph view
- A new dock icon
