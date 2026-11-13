---
title: The learner model and the learning event log
---

# The learner model and the learning event log

One place that knows what you've done and how deep it goes, for the tutor, the proactive coach and North Star to read. Built on top of each feature's own records, never instead of them.

## The event log

`.tide/learning.db` in the vault: SQLite through Node's own `node:sqlite` (Electron's Node and the tests' alike, so no native module to rebuild). Everything Tide had before stays where it was; the log only adds.

Every learning act is one event (`shared/learningEvents.ts`, `LearningEvent`):

| kind | from |
|---|---|
| `studied` | timed study (focus), project steps without tests |
| `answered` | lesson answers, loose answers (exams, recall sessions), maths working, notebook checks, phase checks, course checks, Claude's `record_answer`, mistake retests |
| `recalled` | flashcards, recall questions, warm-ups, reviews (with an FSRS-style grade where there is one) |
| `explained` | lesson "explain" questions (quality = the mark), a project's ready check, an explorable's "Tell the tutor" (unmarked: seen, not counted) |
| `transfer` | lesson questions the tutor tagged near or far transfer |
| `built` | project milestones and guided project stages, tests run in a milestone |
| `read` | course lessons studied, reading room minutes per book per day |
| `mock` | a mock's result and each marked item, mock interview rounds |
| `workout` | workout rounds, mental maths, speed drills |
| `skipped`, `moved_on` | a project step skipped, "I've got this, move on" |
| `misconception_seen`, `misconception_resolved` | the marker naming one, the mistake journal |
| `corrected` | you, from Your model |

Each carries concept ids (or a topic resolved when the model is built), skills, the source feature, outcome, confidence (said, or inferred and flagged), hints, time, minutes, quality, tests, and links to the lesson, course and project.

**Writing.** `learningEvent(e | e[], { replace? })` in `main/learningLog.ts`. Never throws, never awaited on by anything that matters. The key names the act (`lesson:<id>#t<turn>`, `ev:<source>#<pos>@<concept>`, `workout:<id>`…): writing the same act again replaces its row, so a live write and the read-in agree. `replace: 'lesson:<id>#'` drops rows of that prefix the new set doesn't have (a lesson saved again).

**Sharpness** writes through one adapter (`main/sharpEventLog.ts`, mapping in `shared/sharpEvents.ts`): a rated first attempt or a drill's outcome is `transfer` (with the rating before and after in `data`), a retry is `answered` with its hints, "I'm stuck" is `answered` with outcome `stuck`, a post-mortem is `misconception_seen` on the pattern and a solved revisit `misconception_resolved`, and drill steps are `studied`. Skills come from the category (`algorithms`, `system-design`, `incident-response`, `debugging`, `modelling`, `estimation`, `proof`). The ratings themselves ride along in the digest (`learnerDigest` and the `learner_model` tool's `digest`).

Evidence that goes through the knowledge map (`noteEvidence`, `noteReviewAnswer`, `noteCardReview`, `noteRecallReview`) is logged there, so any feature using those is already wired.

**Read-in.** `main/learningBackfill.ts` reads every earlier record once per vault (lessons, loose answers, the knowledge map's evidence, focus, workout, mental maths, drills, mocks, interviews, mistakes, the reading room, course progress). It only reads.

## The model

`shared/learnerModel.ts` (pure) and `main/learnerModel.ts` (gathers, caches for a minute or until the log changes).

- **Nodes**: concepts (the knowledge map's topics; plan steps roll into their topic), skills (`SKILLS`: debugging, proof, system design, problem decomposition, estimation, SQL and pipelines, modelling, mental arithmetic, algorithms, incident response), goals (your goals and any registered from elsewhere), interests (subjects), projects, courses. Ids: concept ids as the map has them, `skill:<id>`, `goal:<id>`, `interest:<area>`, `project:<notebook>`, `course:<id>`.
- **Edges**: `needs` (prerequisite), `used_in`, `serves` (goal), `covered_by` (course or project), `in` (subject), `exercises` (skill).
- **Depth** 0–6: 1 recall, 2 explain, 3 apply, 4 transfer to an unseen problem, 5 build or teach, 6 research. A level is shown when its credit (right 1, partly ½, hinted halved) meets its need and the latest tries hold up; the ladder climbs 1 → 3 → 4 → 5 → 6, with explain shown beside it. Every level keeps the keys of the events behind it.
- **Targets**: a goal's concepts default to 3 (2 for a curious goal); a target set outright wins.
- **Measures**: retention (FSRS), transfer rate, speed and hint trends, calibration (Brier, sure-but-wrong), explanation quality, project outcomes, misconceptions seen and resolved.
- **Corrections**: a `corrected` event sets the floor; evidence after it climbs from there. The evidence before it stays visible.
- **Links**: Haiku proposes `used_in` and `exercises` links in the background (job `modelLinks`, at most every six hours, each concept asked once, Claude only). Without Claude, name heuristics stand in.

## Asking it

From main (`main/learnerModel.ts`):

```ts
learnerModel(fresh?)                  // { model, events }
whereIStand(topic, compact?)          // text: depth, target, measures, next step, evidence, builds on, used in, recent
whatsFading(limit?)                   // ModelNode[]
weakestForGoal(goal, limit?)          // begun concepts furthest below target, then the next ones in roadmap order
whatUses(topic)                       // { node, usedIn, uses }
transferGapList(limit?)               // at apply, not yet on unseen problems
recent({ node?, limit?, since? })     // LearningEvent[]
learnerDigest(goal?)                  // a few lines for a prompt
modelView() / nodeDetail(id)          // what the page shows
```

For North Star and anything else that sets direction:

```ts
setTarget(node, depth | null, { goal?, by? })        // node: concept id or name, or a skill ("proof", "skill:proof")
setTargetsFrom('northstar', [{ node, depth, goal }])
registerGoals('northstar', [{ id, title, concepts?, areas?, projects?, targets?, date?, weight? }])  // replaces that source's goals
addLinks([{ from, to, kind: 'used_in' | 'exercises', origin? }])
correctJudgement(nodeId, depth, note?)
```

## Claude's tools

- `learner_model` (pack `model`, for coach and planning sessions: `toolPacks({ kind: 'coach' | 'plan' })`): `ask` = standing, fading, weakest, used_in, transfer_gaps, recent, digest.
- `learner_standing` (pack `learner`, so lessons and chats): one topic's standing, compact.

Claude Code in a terminal (no packs) gets both.

## In the app

What you know › Your model: depth against target by goal, skills, what's fading and the transfer gaps, the evidence behind any concept, and "That's not right" to correct it.
