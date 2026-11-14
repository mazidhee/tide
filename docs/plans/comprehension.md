# Comprehension lessons: build plan

A Learn mode, **Comprehension**, and a "Test my understanding" action in the book reader. The learner reads a passage (timed, marking what was hard), the passage is hidden, and they show what they understood in steps graded against the passage's exact words. Built a little per session; each increment ships on its own.

Shape of the code, so later increments slot in:

- `src/shared/comprehension.ts`: pure rules (passage selection, words per minute, the steps, prompts, parsing a grade, self-check rubric, cards). Unit tested in `test/comprehension.test.ts`.
- `src/main/comprehension.ts`: the store (`.tide/comprehension/lessons/<id>.json` in the notes folder, one record per lesson), the passage from the reading room, Claude calls (jobs `comprehensionGrade` and later ones, role `mark`, so Opus), cards via `study.saveCards`. IPC `comp:*`, preload `window.tide.comprehension`.
- `src/renderer/src/components/comprehension/`: `ComprehensionView` (home and lesson), one component per step. Styles in `styles/comprehension.css`, the passage in the reader's face and paper (`--read-face`, `--rp-day`/`--rp-night`), feedback cards in the writing review's look (`wr-card`, `wr-mark`).
- A lesson record has `steps` in order; each step has its own answer and grade. New steps are added to `STEPS` and get their own component; the record's `step` says where the learner is.

Render checks use offscreen Electron against a temp vault copy with seeded lesson records (canned grades), never live calls.

## 1. Foundation: read, hide, say what it says (built)

Adds: the Comprehension mode in Learn and a view of its own; the passage is the next unread section of the book on the reading-room shelf (`current`), or a passage selected in the reader ("Test my understanding", also at a chapter's end for the section just read). The read is timed (hidden window time left out) and the learner marks hard words or lines; looking a word up is only offered after the first read. The passage is hidden, the learner writes a 3–5 sentence summary, Opus grades it as caught / missed / wrong points, each anchored to the passage's exact words, and the passage comes back with those points beside their words. Marked words become flashcards (with their sentence) in Review. Without Claude: a self-check against the shown passage with a four-line rubric.

Depends on: nothing.

Acceptance: a lesson can be started from Learn and from the reader; the read records words per minute; marks survive to the cards step; a grade whose quotes are not in the passage is dropped; the no-Claude path finishes a lesson; records are written only under `.tide/comprehension`; tests and both tsc configs clean; shots of read, summary, feedback and end, light and dark, wide and narrow.

Files: `shared/comprehension.ts`, `main/comprehension.ts`, `main/index.ts`, `preload/index.ts`, `shared/types.ts`, `shared/gemmaPolicy.ts`, `shared/thinking.ts`, `renderer/.../comprehension/*`, `LearnView.tsx`, `reading/Reader.tsx`, `App.tsx`, `state.tsx`, `lib/tabs.ts`.

Measure before (2): does the learner finish lessons (records with `finishedAt`)? How long does grading take? Are anchored points found in the passage (dropped-quote count in the record)? How many words marked per lesson; are the cards reviewed?

## 2. Map how it argues

Adds: a step after the summary: a small structured editor for claim, reasons (each with its evidence), assumptions and the turn; for narrative and literature: what happens, who, the turn, what it means. Opus writes a reference map (started in the background while the learner reads) and compares field by field (matches / partly / missing / off), anchored to the passage. Review shows both maps side by side. No-Claude: the reference is not available, so a rubric self-check.

Depends on: (1). Genre detection only needs narrative vs argued at this point (the book's `narrative` flag).

Acceptance: the map editor is one calm structure, not a form wall; a reference map is cached on the record; a comparison with no anchor is shown without a highlight rather than dropped; shots of the editor and the comparison.

Files: `shared/comprehension.ts` (map types, prompt, parse), `main/comprehension.ts` (prep job), new `MapStep.tsx`, CSS.

Measure: time spent on the map step; how often the learner's claim matches; whether waits for the reference map are felt (prep finished before the step opens?).

## 3. Go beyond the text

Adds: 2–3 inference questions (an implication, what the author would say about X, the weakest point), written in the prep job, graded with reasons and anchored. Generic fallback questions without Claude, self-checked.

Depends on: (2)'s prep job.

Acceptance: questions are about the passage, not general knowledge; each grade says why; shots of the questions and their review.

Measure: inference scores against summary scores (is inference the weak part?).

## 4. Genre and the adaptive level

Adds: a genre per passage (explanatory, argued essay, textbook or technical, philosophy, literature, academic paper, mathematical), detected from the book's subjects and the text, and a level ladder per genre (stored in `.tide/comprehension/state.json`). Each lesson's scores move it: up when comfortable at or above the level, down when well below, otherwise stay; passages are pitched one rung above. Shown as a small ladder per genre on the home and the end of a lesson.

Depends on: (1)–(3) for a combined score (works with (1) alone, using the summary score).

Acceptance: pure `nextLevel` and `estimateLevel` with tests; a library passage that is far below the level does not move it up.

Measure: does the level settle, or oscillate? Do the learner's own "this was hard" marks agree with the level?

## 5. Speed and retention

Adds: words per minute per genre and a recall check a week later on the same passage ("what do you still remember"), kept through the existing recall path (`main/recall` keep and review, so FSRS schedules it), shown as two small trends. A measured `Reading:` line in the learner profile (`Coach/About me as a learner.md`, `setMeasured`, a code prefix so the learner's own lines are kept).

Depends on: (1); (4) for per-genre trends.

Acceptance: the recall check is offered on the home when due; its grade reviews the recall item; the profile line is rewritten, never duplicated.

Measure: retention against the original summary score; whether WPM rises without scores falling.

## 6. Course integration and chosen passages

Adds: a lesson on a topic of the `reading-comprehension` or `reading-difficult-texts` modules opens this mode (routing in `setView` for teach sessions on those topics) and counts as evidence on the topic (`knowledge.noteEvidence`). Passages in order: the current book, a passage named by the topic's Practice lines, then one Claude names from a public-domain text, fetched verbatim from Project Gutenberg by Tide (never written by the model); if it can't be found word for word, say so and use the library.

Depends on: (1); the modules being in the vault.

Acceptance: a passage is only shown if its text came from a file or a fetched source; evidence is recorded once per lesson.

Measure: which source passages come from; whether course topics get covered.

## 7. Polish from use

Fixes and adjustments from the learner's use of (1)–(6): bugs from `Tide/Tide bugs.md`, wording, waits, the size of passages.
