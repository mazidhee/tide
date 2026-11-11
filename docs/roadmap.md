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
- Faster lessons: off-thread index, cached rendering, steadier prompt cache, idle unload
- The redesign, with the classic design in Settings

## Now

- [ ] **Courses from GitHub.** Learn from repos such as DataTalksClub's zoomcamps, Made With ML, Karpathy's Zero to Hero and OSSU: modules become lessons with the repo's text shown and credited, and notebooks and exercises run in the lesson. Partial work: worktree `tide-ghcourses`.
- [ ] **A fuller code editor.** monaco-vscode-api, so lesson code feels like VS Code.
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
  - Long regex diagrams scroll sideways.
  - Matrix labels sit under the drag handles.
  - A notebook holding only its roadmap is left off the knowledge map.
  - Decide whether one right answer should make a topic solid (FSRS says about 4.5 days) or two.
- [ ] **PDF reading in Rust.** Removes a one-time 455 ms load.

## Not doing

- Fine-tuning Gemma (the Mac runs out of memory; marking is already 97%)
- The pathways graph view
- A new dock icon
