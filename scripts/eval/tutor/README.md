# Tutor benchmark

A fixed, versioned set of teaching situations and an automatic scorer, so a change to the tutor's prompts, its model or its settings is measured before and after instead of judged by feel.

**Status: the runner has been exercised only by `--dry-run` and the scorer's tests. No model has been asked anything, so there are no baseline numbers yet.** The first real run is the baseline.

```bash
# No model: checks every scenario, builds every request, scores the good and bad replies kept with each scenario
PATH=/opt/homebrew/bin:$PATH npx vite-node scripts/eval/tutor/run.ts -- --dry-run

# A real run (about 210 requests at 3 repeats; the local tutor is busy while it runs)
npx vite-node scripts/eval/tutor/run.ts -- --base-url http://localhost:8080/v1 --label base
# with a judge for the qualities no pattern can check
npx vite-node scripts/eval/tutor/run.ts -- --label base --judge-base-url https://api.groq.com/openai/v1 --judge-key $KEY --judge-model openai/gpt-oss-120b

# Two runs side by side, and whether the second may replace the first
npx vite-node scripts/eval/tutor/compare.ts -- results/<base>.json results/<candidate>.json

# What one scenario sends, exactly
npx vite-node scripts/eval/tutor/run.ts -- --show systems-after-wrong-cache-locality
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

Each scenario is data (`types.ts`): the lesson's setup (mode, topic and options: the instructions variant, covering problem sets, the dialogue, maths and code ways of teaching, Why mode, hard, a refresher, a quiz, explain-from-memory), the conversation so far, and expectations a program can check. It also carries a `good` reply that meets every expectation, and usually a `bad` one with the checks it must trip, so the set proves of itself that each scenario can be passed and that the scorer notices failure.

Requests are built by the app's own prompt code (`request.ts`): the system prompt (`src/shared/tutorPrompt.ts`), the tag rules and lesson instructions (`src/shared/session.ts`), the learner's messages in the lesson screen's forms (`Answer:`, `My question:`, the Show me request) and the hidden pace and notes nudges (`src/shared/pace.ts`). No prompt is typed again here, so a prompt change in the app changes what the benchmark sends, and the result file records a fingerprint of everything sent.

The set has a version (`SCENARIO_SET_VERSION`). Bump it when a scenario or an expectation changes; `compare.ts` refuses to compare across versions, or across different prompts.

## What the scorer measures

All of it deterministic (`score.ts`), read with the app's own parsers:

- **Protocol**: tags closed and well formed; exactly one question, in an ask tag, at the end when one is due (or `<continue/>`, or nothing after Show me); no question in plain text; ask type valid and the kind called for; a grade first when an answer was given, with a valid verdict and score; a hidden `<solution>` whenever a problem is set; no answer inside the question; the tags the situation needs (a flashcard after a miss, a note when Tide asks for one) and none it forbids; the "Why this matters" opening; no greeting, voice tags, echoed hidden notes or tool-call text.
- **Marking accuracy** (the number that matters most): the verdict against the truth the scenario supplies, with the two mistakes counted apart (something not right marked correct; a right answer marked down), planted errors caught, unusual-but-correct answers accepted, and whether the feedback names the planted error or the stated misconception.
- **Exactness**: the values, formulae and terms the scenario supplies appear in what the learner reads, and the wrong ones don't.
- **Length and pace**: words the learner reads (not code, diagrams, tables, notes or hidden working) within the bounds for the situation.
- **The right visual**: the mermaid diagram kind, a table, a simulation of the right kind that the app's parser accepts, or a chart block with a query.

The summary gives each as a mean with its spread (the standard deviation of the per-repeat means: how far the same model moves between runs), overall, by subject and by situation, and the most common failures. Results are saved under `results/` with every reply.

## The judge (optional, reported apart)

Clarity, whether the reply deals with the learner's actual misconception, and the quality of its question can't be checked by pattern. `judge.ts` holds the prompt for a stronger model, with this rubric (1 to 5 each, "n/a" where it doesn't apply):

- **clarity**: could this learner follow it on one reading? 5 = one idea, in order, terms defined, an example where the idea is abstract; 3 = followable but with a detour, an undefined term or an ill-fitting example; 1 = muddled or beside the point.
- **misconception**: does it deal with what this learner got wrong or said? 5 = names the specific wrong idea in the learner's terms, says why it fails, gives the right one; 3 = corrects the result but treats the error generically; 1 = ignores, misdiagnoses or agrees with it.
- **socratic**: does its question make the learner think the next step? 5 = one question, answerable from what they now have, one step beyond it, not given away by the text; 3 = recall, too big a step, or half-answered already; 1 = "does that make sense?", unrelated, several questions, or it answers itself.
- **accuracy**: is everything it states true? 5 = nothing wrong; 3 = a loose statement; 1 = a wrong fact, result or verdict.

Judge scores never enter the deterministic numbers or the go/no-go rule: a judge has its own errors and changes between versions. Only use one for material that may leave the Mac; the scenarios here are invented, so they may.

## Deciding with it

`compare.ts` says GO only when the candidate is clearly better at something (pass rate, protocol or marking up by at least 5 points and by more than twice the runs' own spread) and worse at nothing that matters (marking accuracy not down by more than 2 points, no more not-right answers marked correct, exactness not down by more than 3, no subject down by more than 10), on the same scenario set, the same prompts and the same sampling settings, with at least 3 repeats and no failed requests. The thresholds are `RULE` in `compare.ts`.

## What it does not measure

- The app around the model: tools (nothing can be run or searched, though the system prompt describes them), the learner's profile and memory, sources, the problem bank, and the checks that run after a reply (the SymPy check of a final answer, the cloud second look). A marking mistake here may be one the app would catch.
- Lessons that need the canvas, the terminal or a book (walkthrough, lab and reading); recall questions that open a lesson from the spaced-recall schedule (that note is written in the main process); long lessons (histories are one or two exchanges).
- Whether its bounds are tuned to Gemma: until the first real run, a check that every reply fails, or none does, has not been seen. Expect to adjust a few expectations after the baseline, and bump the version when you do.
- 70 scenarios at 3 repeats is 210 replies: differences of a few points are within noise. The marking numbers rest on 35 scenarios (7 each: after-correct, after-wrong, planted error, unusual but correct, code bug), so one scenario is about 3 points.
