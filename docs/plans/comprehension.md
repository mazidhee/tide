# Comprehension lessons: build plan

Comprehension lives **inside the book first**. Reading a book in Tide's reader is already the reading half of a comprehension lesson, so when the learner turns it on for a book, the check comes to them in the reading flow: at the end of a chapter (or every section), a quiet card asks them to say what they just read, without showing it again, grades it against that section's exact words and lights the caught, missed and wrong words in the book itself. The separate **Comprehension** view (Learn's mode) stays for texts that are not books on the shelf: next, fresh passages pulled carefully from the open web, matched to what the learner is studying. Built a little per session; each increment ships on its own.

Order: (1) foundation (built) · (2) in the book (built) · (3) fresh texts from the web · (4) argument map · (5) going beyond the text · (6) genre and level · (7) speed and retention · (8) course evidence and chosen passages · (9) polish. Every step from (4) on works in both places: the reader's inline card and the Comprehension view.

Shape of the code, so later increments slot in:

- `src/shared/comprehension.ts`: pure rules (passage selection, words per minute, the steps, prompts, parsing a grade, self-check rubric, cards, where the in-book checks go). Unit tested in `test/comprehension.test.ts`.
- `src/main/comprehension.ts`: the store (`.tide/comprehension/lessons/<id>.json` in the notes folder, one record per lesson), the passage from the reading room, Claude calls (jobs `comprehensionGrade` and later ones, role `mark`, so Opus), cards via `study.saveCards`. IPC `comp:*`, preload `window.tide.comprehension`.
- `src/renderer/src/components/comprehension/`: `ComprehensionView` (home and lesson), one component per step. Styles in `styles/comprehension.css`, the passage in the reader's face and paper (`--read-face`, `--rp-day`/`--rp-night`), feedback cards in the writing review's look (`wr-card`, `wr-mark`).
- A lesson record has `steps` in order; each step has its own answer and grade. New steps are added to `STEPS` and get their own component; the record's `step` says where the learner is.
- The in-book check: `readerSections`, `checkpoints` and `passageSpans` in `shared/comprehension.ts` (where the checks go, and passage offsets back to the book's paragraphs), `startInBook` in `main/comprehension.ts` (IPC `comp:inBook`), `components/comprehension/InBookCheck.tsx` (the card), drawn by `reading/Reader.tsx`; styles in `styles/comprehension.css` under `.ib-`.

Render checks use offscreen Electron against a temp vault copy with seeded lesson records (canned grades), never live calls.

## 1. Foundation: read, hide, say what it says (built)

Adds: the Comprehension mode in Learn and a view of its own; the passage is the next unread section of the book on the reading-room shelf (`current`), or a passage selected in the reader ("Test my understanding", also at a chapter's end for the section just read). The read is timed (hidden window time left out) and the learner marks hard words or lines; looking a word up is only offered after the first read. The passage is hidden, the learner writes a 3–5 sentence summary, Opus grades it as caught / missed / wrong points, each anchored to the passage's exact words, and the passage comes back with those points beside their words. Marked words become flashcards (with their sentence) in Review. Without Claude: a self-check against the shown passage with a four-line rubric.

Depends on: nothing.

Acceptance: a lesson can be started from Learn and from the reader; the read records words per minute; marks survive to the cards step; a grade whose quotes are not in the passage is dropped; the no-Claude path finishes a lesson; records are written only under `.tide/comprehension`; tests and both tsc configs clean; shots of read, summary, feedback and end, light and dark, wide and narrow.

Files: `shared/comprehension.ts`, `main/comprehension.ts`, `main/index.ts`, `preload/index.ts`, `shared/types.ts`, `shared/gemmaPolicy.ts`, `shared/thinking.ts`, `renderer/.../comprehension/*`, `LearnView.tsx`, `reading/Reader.tsx`, `App.tsx`, `state.tsx`, `lib/tabs.ts`.

Measure before (2): does the learner finish lessons (records with `finishedAt`)? How long does grading take? Are anchored points found in the passage (dropped-quote count in the record)? How many words marked per lesson; are the cards reviewed?

## 2. In the book (built)

Adds: the check inside Tide's reader, **off by default**. A quiet "Check me" button in the reader's top bar (beside Aa and Listen) turns it on or off for this book, remembered per book; off means no cards at all and nothing that asks. When on, the Aa menu shows the frequency: End of each chapter (the default) or Every section.

At the end of each chapter, or at every natural break of about 400 to 900 words (`readerSections`: whole paragraphs, a short tail joined to the section before it), a quiet card sits in the reading flow, in the reader's own typography: "Say what that said", one text box, Check and Skip. The section is not shown again; a short cue says where it began. The answer is graded against the section's exact text by the increment-1 path (`gradeSummary`, Opus, anchored points, quotes not in the text dropped). The feedback stays in the card, one line per point; "Look again" scrolls back up the book and lights the caught, missed and wrong words in place for a while (CSS Custom Highlight API, so the page's own marks are untouched); a point clicked lights its own words. Words marked hard while reading (the selection menu's "Hard word") become cards after the feedback, with Claude's meanings in context. Without Claude: "Look again" over the whole section and the four-line self-check in the card.

Skip hides that card for good (kept per book in the window's storage) and never asks again. Reading time for the section is the time the window was in view and the learner active while the section was on the page (no separate timed read), recorded as the lesson's words per minute. Each check is a lesson record like increment 1's (`source.kind: 'book-check'`), so the home, the measures and later increments see it; a section already checked shows a one-line result with its feedback a click away. "Test my understanding" from a selection or the seminar card still opens the Comprehension view.

Depends on: (1).

Acceptance: with the toggle off (the default) no card is drawn; on, the card appears only at the chosen breaks and never again for a checked or skipped section; the text graded is exactly the section's paragraphs (checked against the book in main); the spans lit are the graded quotes' own words; no record is written except under `.tide/comprehension`; tests for `readerSections`, `checkpoints` (off/chapter/section), `passageSpans` and the record; shots of the card at a chapter's end, the feedback with spans lit in the book, and the Aa menu, light and dark, wide and narrow.

Measure: how many books have checks on; how often a card is answered versus skipped, per frequency; words per minute from real reading against increment 1's timed reads; the grading wait felt inline; whether "Look again" is used.

## 3. Fresh texts from the web

For the Comprehension view: passages the learner has not chosen, pulled from the open web, close to what they are working on. In the learner's words: texts "that align with the broader theme of what I'm doing… you really need to think about and be careful with." Designed now, built next session.

**Where texts may come from.** Only:
- Tide's trusted list (`shared/trustedSources.ts`: `trustedSite`, its `kind` and stated `licence`), the list source-led lessons use.
- Wikipedia (CC BY-SA 4.0; attribution and the article link always shown, the revision id kept).
- Project Gutenberg and Standard Ebooks (public domain in the US; Gutenberg's licence header and boilerplate stripped, the ebook number kept).
- Open essays their authors publish for anyone to read (e.g. paulgraham.com), named one by one in a new `READING_SOURCES` list beside `TRUSTED`, each with who to credit and the terms as the site states them.
- arXiv abstracts (the abstract page only; a paper's body only when its own licence is CC BY or CC0).
- A short list of reputable open magazines readable without an account (e.g. Aeon, Quanta), added one at a time after checking their terms.

Nothing else: no unlisted site found by web search, no page behind a login, a metered or hard paywall (`isBlocked` in `shared/readings`, plus a check on the fetched page: a short text with subscribe or sign-in walls, `unreadable` in `shared/sourceLed`), nothing whose `robots.txt` disallows Tide's user agent for that path, nothing whose terms forbid copying for personal study. Public addresses only (`publicUrl`).

**Choosing what to read.** From the learner's current courses and modules (the active plan and topics), their goal note (`Coach/About me as a learner.md`, the North Star) and the comprehension level once (6) exists. One query per lesson: the topic the learner is on, widened to its broader theme (payments → the history of settlement; ML → a classic essay on learning), with the genre rotating (explanatory, argued essay, history, philosophy, paper abstract). Opus may *name* candidate pages or works and say why (role `plan`), but never supplies the text. Pages already used in a lesson are passed over.

**The text itself.** Fetched by Tide (`main/extract.readArticle`, the page reader source-led lessons use), then a passage cut by rules: whole paragraphs, 250 to 600 words, starting at a paragraph that opens a thought (not "As we saw above"), no tables, code or equation-only paragraphs, footnote markers removed. The passage is the page's own words: **never generated, summarised or paraphrased**. Before the lesson starts, Tide checks that the passage appears verbatim in the fetched page text (whitespace and quote marks normalised only, as `checkedSelection` does for books); if it does not, the candidate is dropped. The record keeps the URL, title, author or site, licence, fetch time and a hash of the page text.

**Attribution.** Always shown with the passage and in the feedback: title, author or site, licence, the link (opens in Tide's browser), and "excerpt" when cut. Wikipedia: "From Wikipedia, CC BY-SA 4.0" with the article link.

**Caching.** The fetched page and the passage are kept only in `.tide/comprehension/web/` in the notes folder, for the learner's own lessons and recall checks; never published, synced elsewhere, or used to make anything shared. A cached page older than 90 days is fetched again before reuse, and dropped if it has gone or the passage is no longer verbatim.

**Failure.** Offline, no candidate passing every check, a fetch error, a robots disallow, a paywall, or a passage that fails the verbatim check → the library fallback: the next section of the book being read (as in (1)), with one quiet line saying why ("Couldn’t find a fresh text on payments just now; here is your book"). Never a made-up passage.

**Without Claude.** Candidates come from the topic's known readings, the trusted list's search and Wikipedia's own search API; the rest of the pipeline is the same.

Depends on: (1); the page reader and trusted list (built for source-led lessons).

Acceptance: every passage shown passes the verbatim check against its fetched page (a test with a page fixture and a tampered passage that is refused); a host outside the lists is never used; robots-disallow and paywall fixtures are refused; attribution and licence render with every web passage; the fallback is used, and said, when nothing passes; cached files only under `.tide/comprehension/web/`; no paid model calls in tests.

Measure: how often a fresh text is found versus the fallback, and why it fell back (robots, paywall, verbatim, nothing on topic); fetch and cut time; topic fit (the learner's "was this on what you're doing?"); scores on web passages against book passages; passages later found not verbatim (should be zero).

## 4. Map how it argues

Adds: a step after the summary: a small structured editor for claim, reasons (each with its evidence), assumptions and the turn; for narrative and literature: what happens, who, the turn, what it means. Opus writes a reference map (started in the background while the learner reads) and compares field by field (matches / partly / missing / off), anchored to the passage. Review shows both maps side by side. In the book: an optional second part of the inline card ("Map how it argued"), offered after the summary's feedback, never required. No-Claude: the reference is not available, so a rubric self-check.

Depends on: (1), (2). Genre detection only needs narrative vs argued at this point (the book's `narrative` flag).

Acceptance: the map editor is one calm structure, not a form wall; a reference map is cached on the record; a comparison with no anchor is shown without a highlight rather than dropped; shots of the editor and the comparison, in the view and in the book.

Files: `shared/comprehension.ts` (map types, prompt, parse), `main/comprehension.ts` (prep job), new `MapStep.tsx`, `InBookCheck.tsx`, CSS.

Measure: time spent on the map step; how often the learner's claim matches; whether waits for the reference map are felt (prep finished before the step opens?).

## 5. Go beyond the text

Adds: 2–3 inference questions (an implication, what the author would say about X, the weakest point), written in the prep job, graded with reasons and anchored. Generic fallback questions without Claude, self-checked. In the book: one question at most, offered after the feedback on chapter-end checks only.

Depends on: (4)'s prep job.

Acceptance: questions are about the passage, not general knowledge; each grade says why; shots of the questions and their review.

Measure: inference scores against summary scores (is inference the weak part?).

## 6. Genre and the adaptive level

Adds: a genre per passage (explanatory, argued essay, textbook or technical, philosophy, literature, academic paper, mathematical), detected from the book's subjects and the text, and a level ladder per genre (stored in `.tide/comprehension/state.json`). Each lesson's scores move it: up when comfortable at or above the level, down when well below, otherwise stay; passages are pitched one rung above (for web passages; a book is the book). Checks in the book count like lessons. Shown as a small ladder per genre on the home and the end of a lesson.

Depends on: (1)–(5) for a combined score (works with (1) alone, using the summary score).

Acceptance: pure `nextLevel` and `estimateLevel` with tests; a library passage that is far below the level does not move it up.

Measure: does the level settle, or oscillate? Do the learner's own "this was hard" marks agree with the level?

## 7. Speed and retention

Adds: words per minute per genre (from the in-book checks' real reading time as well as timed reads) and a recall check a week later on the same passage ("what do you still remember"), kept through the existing recall path (`main/recall` keep and review, so FSRS schedules it), shown as two small trends. A measured `Reading:` line in the learner profile (`Coach/About me as a learner.md`, `setMeasured`, a code prefix so the learner's own lines are kept).

Depends on: (1), (2); (6) for per-genre trends.

Acceptance: the recall check is offered on the home when due; its grade reviews the recall item; the profile line is rewritten, never duplicated.

Measure: retention against the original summary score; whether WPM rises without scores falling.

## 8. Course integration and chosen passages

Adds: a lesson on a topic of the `reading-comprehension` or `reading-difficult-texts` modules opens this mode (routing in `setView` for teach sessions on those topics) and counts as evidence on the topic (`knowledge.noteEvidence`). Passages in order: the current book, a passage named by the topic's Practice lines, then a fresh text from the web by (3)'s rules. A course topic that names a book on the shelf can open that book's reader with checks turned on.

Depends on: (1), (2), (3); the modules being in the vault.

Acceptance: a passage is only shown if its text came from a file or a fetched source; evidence is recorded once per lesson.

Measure: which source passages come from; whether course topics get covered.

## 9. Polish from use

Fixes and adjustments from the learner's use of (1)–(8): bugs from `Tide/Tide bugs.md`, wording, waits, the size of passages and sections.
