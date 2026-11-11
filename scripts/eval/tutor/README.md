# Tutor benchmark

A fixed, versioned set of teaching situations and an automatic scorer, so a change to the tutor's prompts, its model or its settings is measured before and after instead of judged by feel.

**Status: one baseline, one pass (`results/2026-11-11-14-34-base.json`, Gemma 4 12B, scenario set 1.0.0).** It was scored on raw completions, and reading its 70 replies showed that most of what it failed was not what a learner would have been shown: a quarter of the replies had stalled in a thought channel, which the app carries past and the runner then didn't. Set 1.1.0 scores the reply the learner is shown (below), and the baseline re-scored that way is in "The baseline, corrected". It was also run before the system prompt grew by about 2,800 characters (seven more simulation kinds), so its prompts are not the ones the app sends now: run again before comparing anything with it.

```bash
# No model: checks every scenario, builds every request, scores the good and bad replies kept with each scenario
# (-c vitest.config.ts gives vite-node the app's import aliases)
PATH=/opt/homebrew/bin:$PATH npx vite-node -c vitest.config.ts scripts/eval/tutor/run.ts -- --dry-run

# A real run (about 210 requests at 3 repeats, more where a reply stalls and is carried on; the local tutor is busy while it runs)
npx vite-node -c vitest.config.ts scripts/eval/tutor/run.ts -- --base-url http://localhost:8080/v1 --label base
# with a judge for the qualities no pattern can check
npx vite-node -c vitest.config.ts scripts/eval/tutor/run.ts -- --label base --judge-base-url https://api.groq.com/openai/v1 --judge-key $KEY --judge-model openai/gpt-oss-120b

# Two runs side by side, and whether the second may replace the first
npx vite-node -c vitest.config.ts scripts/eval/tutor/compare.ts -- results/<base>.json results/<candidate>.json

# A saved run scored again with the scorer as it is now, no model (--rows lists every reply, --out saves it)
npx vite-node -c vitest.config.ts scripts/eval/tutor/rescore.ts -- scripts/eval/tutor/results/<run>.json --rows

# What one scenario sends, exactly
npx vite-node -c vitest.config.ts scripts/eval/tutor/run.ts -- --show systems-after-wrong-cache-locality
```

Other flags: `--model`, `--out <folder>`, `--repeats 3`, `--temperature 0.4`, `--seed 1`, `--max-tokens 1500`, `--only systems,show-me,<id>`, `--limit n`, `--adapter-path <dir>` (a LoRA adapter the mlx-vlm server applies per request), `--key` for a hosted model.

## The scenarios

70 scenarios (`scenarios/`, one file a subject), one for each subject in each situation:

| | open | after correct | after wrong | "I don't know" | show me | planted error | unusual but correct | tangent | recall opening | code bug |
|---|---|---|---|---|---|---|---|---|---|---|
| Computer systems | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| C and C++ | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Distributed systems | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Databases and SQL | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| ML and neural networks | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Probability and linear algebra | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Data engineering | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

### Breadth (set 1.2.0)

47 more scenarios across 22 subjects outside the set Tide was tuned on (`scenarios/breadth-*.ts`): classical mechanics, electromagnetism, quantum basics, organic chemistry, genetics, statistics, epidemiology, macroeconomics, corporate finance, core banking (ledgers, clearing and settlement), accounting, contract law, game loops and game physics, 3-D graphics maths, compilers, operating systems, music theory, world history, linguistics, UI design critique, philosophy and a physical skill (the piano). Two or three each, in the situations that matter most for the subject, so they don't fill the grid above. Each names the kinds its topic must be profiled as (`src/shared/subjects.ts`); validation fails if the map profiles it otherwise, and the tests check that each request carries its kinds' toolkit and no other's. Three test capability honesty (a circuit to measure, a reaction to run, a Godot project): the reply must say in a line what Tide can't do and offer the substitute. Where there is no single right answer (an interpretation, a design), the deterministic checks hold the protocol and the facts, and the `judge` line carries what a good reply does.

Each scenario is data (`types.ts`): the lesson's setup (mode, topic and options: the instructions variant, covering problem sets, the dialogue, maths and code ways of teaching, Why mode, hard, a refresher, a quiz, explain-from-memory), the conversation so far, and expectations a program can check. It also carries a `good` reply that meets every expectation, and usually a `bad` one with the checks it must trip, so the set proves of itself that each scenario can be passed and that the scorer notices failure.

Requests are built by the app's own prompt code (`request.ts`): the system prompt (`src/shared/tutorPrompt.ts`), the tag rules and lesson instructions (`src/shared/session.ts`), the learner's messages in the lesson screen's forms (`Answer:`, `My question:`, the Show me request) and the hidden pace and notes nudges (`src/shared/pace.ts`). No prompt is typed again here, so a prompt change in the app changes what the benchmark sends, and the result file records a fingerprint of everything sent.

The set has a version (`SCENARIO_SET_VERSION`). Bump it when a scenario or an expectation changes; `compare.ts` refuses to compare across versions, or across different prompts.

## What is scored: the reply the learner is shown

The app never shows a raw completion, so the benchmark doesn't score one. Before a reply is scored:

- **It is read as the app reads a stream** (`turn.ts`, with `turnReader` from `src/shared/modelText.ts`, the same code `src/main/agent.ts` streams through). When Gemma opens a thought channel after its answer has begun, it stays there repeating it; the app keeps what was written and asks it to carry on, up to four times, and starts a looping turn over once with more randomness. The runner does the same, with the app's own carry-on message and temperatures, and streams (`model.ts`) so a stalled reply is cut where the app cuts it rather than running to the token limit.
- **The app's repairs are applied** (`score.ts`): hidden reasoning and special tokens cleaned off (`cleanModelText`); a mark on a question or on "I don't know" taken off, an unclosed grade closed, a numbered question left with `<continue/>` made answerable (`repairReply` in `src/shared/lessonRepair.ts`, given what the learner sent); a closing question in plain text made the ask (`parseBlocks`); a problem with no `<solution>` counted as having one, because `lessonGuard` works it out and attaches it (`wantsSolution`); a simulation in a block labelled `json` drawn as one (`isSimSource`). Every one of these is a function imported from `src/`, so a repair added to the app changes the score without a line here.
- **Each repair is counted**, under "Put right by the app": `stall` (carried on), `loop` (started over), `ask` (a question made the ask), `grade` (a mark taken off what wasn't an answer), `close` (a grade closed), `solution` (worked out), `sim` (relabelled). A model that needs fewer of them is better (faster, and less depends on the repair holding), so a fine-tune should be read on these as well as on the pass rate.

A request that fails is tried again, and one that fails twice is left out of every number (the first baseline scored one as an empty reply).

`rescore.ts` reads a saved run the same way with no model: where a saved completion stalled and then went on, what it wrote next stands in for the carry-on; where it stalled and wrote nothing more, the reply is unfinished and only its mark is read. A re-score corrects the arithmetic; it is not a run.

## What the scorer measures

All of it deterministic (`score.ts`), read with the app's own parsers:

- **Protocol**: tags closed and well formed; exactly one question, in an ask tag, at the end when one is due (or `<continue/>`, or nothing after Show me); no question in plain text; ask type valid and the kind called for; a grade first when an answer was given, with a valid verdict and score; a hidden `<solution>` whenever a problem is set; no answer inside the question; the tags the situation needs (a flashcard after a miss, a note when Tide asks for one) and none it forbids; the "Why this matters" opening; no greeting, voice tags, echoed hidden notes or tool-call text.
- **Marking accuracy** (the number that matters most): the verdict, read from the grade's opening tag as the app reads it (a grade left unclosed is a protocol failure, not a wrong mark), against the truth the scenario supplies, with the two mistakes counted apart (something not right marked correct; a right answer marked down), planted errors caught, unusual-but-correct answers accepted, and whether the feedback names the planted error or the stated misconception.
- **Exactness**: the values, formulae and terms the scenario supplies appear in what the learner reads, and the wrong ones don't.
- **Length and pace**: words the learner reads (not code, diagrams, tables, notes or hidden working) within the bounds for the situation, with a tenth of grace over the bound.
- **The right visual**: the mermaid diagram kind, a table, a simulation of the right kind that the app's parser accepts, or a chart block with a query; any one of them where a scenario lists more than one kind that shows the idea properly.

Three protocol rules are narrower than they read above, each because the first baseline failed good replies on them: a question may stand in prose when it closes a set-up straight before the ask that puts it (a case and its question, like a problem and its ask); a second go at the problem just marked needs no new `<solution>` (the one already written is what it will be marked against); and a problem whose solution the app would work out itself is a repair, not a failure.

The summary gives each as a mean with its spread (the standard deviation of the per-repeat means: how far the same model moves between runs), overall, by subject and by situation, and the most common failures. Results are saved under `results/` with every reply.

## The judge (optional, reported apart)

Clarity, whether the reply deals with the learner's actual misconception, and the quality of its question can't be checked by pattern. `judge.ts` holds the prompt for a stronger model, with this rubric (1 to 5 each, "n/a" where it doesn't apply):

- **clarity**: could this learner follow it on one reading? 5 = one idea, in order, terms defined, an example where the idea is abstract; 3 = followable but with a detour, an undefined term or an ill-fitting example; 1 = muddled or beside the point.
- **misconception**: does it deal with what this learner got wrong or said? 5 = names the specific wrong idea in the learner's terms, says why it fails, gives the right one; 3 = corrects the result but treats the error generically; 1 = ignores, misdiagnoses or agrees with it.
- **socratic**: does its question make the learner think the next step? 5 = one question, answerable from what they now have, one step beyond it, not given away by the text; 3 = recall, too big a step, or half-answered already; 1 = "does that make sense?", unrelated, several questions, or it answers itself.
- **accuracy**: is everything it states true? 5 = nothing wrong; 3 = a loose statement; 1 = a wrong fact, result or verdict.

Judge scores never enter the deterministic numbers or the go/no-go rule: a judge has its own errors and changes between versions. Only use one for material that may leave the Mac; the scenarios here are invented, so they may.

## The baseline, corrected

The first baseline's 70 saved replies, as scored then (set 1.0.0, raw completions) and re-scored offline (set 1.1.0, the reply the learner is shown). The re-score leaves out the one failed request, and reads only the mark of the 13 replies that stalled after their grade with nothing saved after it.

| | as scored (1.0.0) | re-scored (1.1.0) | and with the repairs added since |
|---|---|---|---|
| pass | 37.1% (n=70) | 64.3% (n=56) | 78.6% (n=56) |
| overall | 85.5% | 96.8% | 97.5% |
| protocol | 89.2% | 96.5% | 98.6% |
| marking | 85.7% (n=35) | 97.1% (n=35) | 97.1% |
| not-right marked correct | 0.0% (n=21) | 0.0% (n=21) | 0.0% |
| unusual-but-correct accepted | 57.1% (n=7) | 85.7% (n=7) | 85.7% |
| planted errors caught | 85.7% (n=7) | 100.0% (n=7) | 100.0% |
| exactness | 89.0% | 97.1% | 97.1% |
| pace | 79.8% | 96.5% | 96.5% |
| visual | 57.1% (n=7) | 85.7% (n=7) | 85.7% |
| stalled and had to be carried on | not counted | 24.6% of replies | 24.6% |

The middle column is the benchmark corrected and nothing else: the scorer's rules, the scenarios, and the repairs the app already made on the day of the run. What it leaves is real: a flashcard missing after a miss (12.5% of the finished replies), a grade given to a question or to "I don't know" (10.7%), a problem with no solution the app would supply (5.4%), a reply well over length (5.4%), a grade never closed (3.6%), and one right answer in 35 marked down for its method.

The last column is the same saved replies read by the app as it is after the fixes that followed (a mark taken off what wasn't an answer, a grade closed, a numbered question made answerable, a solution worked out for any problem): what a rule could put right without asking the model again. It is a projection from 56 old replies, not a measurement. The prompt changes made at the same time (the marking note with each answer, the Show me note, the shorter lesson prompt) can't be seen in saved replies at all: each commit states what it expects the re-run to show.

## Deciding with it

`compare.ts` compares one change at a time (new prompts on the same model, or a new model or adapter on the same prompts) and says GO only when the candidate is clearly better at something (pass rate, protocol or marking up by at least 5 points and by more than twice the runs' own spread) and worse at nothing that matters (marking accuracy not down by more than 2 points, no more not-right answers marked correct, exactness not down by more than 3, no subject down by more than 10), on the same scenario set and the same sampling settings, with at least 3 repeats and no failed requests. The thresholds are `RULE` in `compare.ts`.

## What it does not measure

- The app around the model beyond the repairs listed above: tools (nothing can be run or searched, though the system prompt describes them), the learner's profile and memory, sources, the problem bank, and the checks that need a second model or the sandbox (the SymPy check of a final answer, the solution worked out for a problem set without one, the cloud second look). A marking mistake here may be one the app would catch.
- Lessons that need the canvas, the terminal or a book (walkthrough, lab and reading); recall questions that open a lesson from the spaced-recall schedule (that note is written in the main process); long lessons (histories are one or two exchanges).
- Whether every expectation is fair: the first baseline's failures were read one by one and six rules and four scenarios corrected (set 1.1.0), but only the checks a reply tripped were tested that way. Read the replies behind any failure that looks too common before believing it, and bump the version when an expectation changes.
- 70 scenarios at 3 repeats is 210 replies: differences of a few points are within noise. The marking numbers rest on 35 scenarios (7 each: after-correct, after-wrong, planted error, unusual but correct, code bug), so one scenario is about 3 points.
