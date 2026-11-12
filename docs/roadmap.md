---
title: Tide roadmap
---

# Tide roadmap

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
- Claude teaches (your plan): Sonnet turns, Opus marking and plans, Tide's tools over MCP; private notebooks stay on Gemma
- Faster lessons: off-thread index, cached rendering, steadier prompt cache, idle unload
- The redesign, with the classic design in Settings

## Now

- [ ] **Claude as Tide's tutor, on your Ultra plan, joined to Tide through MCP.** Part 1 installed 12 Nov: lessons and chat on Claude (Sonnet teaches, Opus marks and plans), Tide's MCP tools, privacy routing, usage in Connections. Part 2 next: background work on Haiku, readings, flashcard and recall tools, course and transcript search, web search, the Ghostty connector. Claude becomes the main teacher and Tide its hands and memory, instead of routing to limited free cloud models. Tide runs your own logged-in Claude Code (`claude -p`, unmodified, no API key) and never reads or copies your login.
  - Tide serves Claude through MCP (Model Context Protocol, the standard way to give Claude tools). With it, Claude can:
    - search and read your notes, books, courses and transcripts
    - run code and SQL in Tide's sandbox
    - show readings, simulations, diagrams and videos in the lesson
    - mark answers into What you know
    - schedule recall
    - make flashcards
    - see your roadmap, aims and past lessons, so it remembers you
  - Claude's own web search and page reading are used for lessons that aren't private.
  - Models: Opus for teaching and marking by default, Sonnet when speed matters, Haiku for background work. Gemma stays for private notebooks and Metabase (never sent out), offline use, and near your limit.
  - One Claude process per lesson, kept running, so answers stream in about 2 s and the lesson stays cached. Your other connectors and settings are kept out of it. Any API key in the environment is stripped so your plan is used.
  - The same MCP server registered in Claude Code (`claude mcp add --scope user tide …`), so in Ghostty Claude can teach from your notes, run your code in Tide and record progress back to Tide.
  - Usage shown in Connections; choose per notebook or per lesson which engine teaches.
- [ ] **Claude: visuals made for each concept.** Claude writes a custom interactive explainer for whatever you're stuck on (backprop, B-tree splits, attention, a market shift). It runs in a sandboxed frame inside the lesson, beyond the 11 fixed simulation kinds.
- [ ] **Claude: exercises checked before you see them.** Each problem comes with tests and a reference solution, run in Tide's sandbox first, so every exercise is hard, fair and never broken.
- [ ] **Claude: a tutor that remembers you.** A learner profile in your vault (misconceptions, pace, what clicked), kept up by Claude and read with your past lessons and mistakes before each session.
- [ ] **Claude: lesson prep while you're away.** Background prep before tomorrow's lesson: what's due, the best reading, exercises, a custom visual, a short plan. Plus a weekly review.
- [ ] **Claude: a mentor for your projects.** Reads your whole project across sessions, reviews it like a senior engineer, runs your tests, and proposes edits in the Code view that you approve line by line.
- [ ] **Claude: reading primary sources together.** Papers, documentation and classics read in full, with web search and page reading. A seminar that argues, steelmans and critiques your writing.
- [ ] **Claude: photos and screenshots.** Mark handwritten maths from a photo; explain a diagram or an error screenshot.
- [ ] **Claude: mock interviews and exams.** Live coding with tests and system design on the canvas, timed and marked.
- [ ] **Claude: a simpler, faster Tide.** Switch off the Gemma workarounds (stall guards, retries, output repair, constant trimming) on Claude lessons.
- [ ] **Benchmark Sonnet and Opus.** Run Tide's tutor benchmark on both, and move any task where Sonnet is clearly weaker to Opus.
- [ ] **Videos in Tide.** Paused for Claude: partial work in worktree `tide-video` (player, captions and cinema view working). YouTube's own player inside Tide, so almost no added weight: one player at a time, a thumbnail until play, removed when closed. Videos are never downloaded or hosted; your own MP4s also play.
  - Player and transcript side by side: the line being spoken is marked, clicking a line jumps there, highlight or ask about a line.
  - The tutor picks a section to watch before a lesson (from saved transcripts and course videos) and a recap clip after it, with questions drawn from the transcript.
  - Course lessons that have a video show it beside the course text.
  - After that: the video pauses at chosen moments for a question and goes on when you answer.
  - Videos without captions can be transcribed on the Mac, only on request and when Gemma is idle.
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
  - Code editor: pandas parameter types show "Unknown" until pandas-stubs is in Tide's Python; rename only changes open files; ⌘⇧O is taken by Add Files.
  - Course lessons: Gemma often writes the plan before probing; "Show me" on a course's first step shows the reading again.
  - Course notebooks needing IPython, data files or internet can't run yet; homework has no generated tests.
  - Long regex diagrams scroll sideways.
  - Matrix labels sit under the drag handles.
  - A notebook holding only its roadmap is left off the knowledge map.
  - Decide whether one right answer should make a topic solid (FSRS says about 4.5 days) or two.
- [ ] **PDF reading in Rust.** Removes a one-time 455 ms load.

## Not doing

- Fine-tuning Gemma (the Mac runs out of memory; marking is already 97%)
- The pathways graph view
- A new dock icon
