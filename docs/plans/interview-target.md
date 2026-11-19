# Interview targets: preparing for one real interview

A *target* is one upcoming interview: a company, a role, a date and its rounds. Tide gathers everything about it (the learner's CV and its links, their own prep documents, the job posting, what candidates report, the firm's public facts and news) and turns that into practice that runs until the day. Practice means teaching sessions, CV defence, behavioural answers, scenario cases, presentation rehearsal and Q&A, live voice mocks, flashcards, and a readiness view. It builds on Practice › Mock (src/shared/mocks.ts), company prep (main/companyPrep.ts), FSRS cards and the voice server (main/voice.ts: TTS, plus `transcribe` for STT).

The engine is generic. Everything about a particular person, company or interview lives in the learner's vault and never in this repo.

## Where a target lives (vault)

`Interview prep/<Target name>/`:

| File | What it holds |
|---|---|
| `target.md` | Front matter: `company`, `role`, `date` (ISO, local), `slidesDue` (ISO, optional), `sources` (absolute folders or files with the learner's own material), `links` (URLs: CV links, posting, firm pages), `rounds` (a list of `{ id, name, kind: behavioural \| technical \| presentation \| hirevue \| general, minutes, notes }`). The body is free notes: format details, advice from people who've done it. |
| `stories.md` | Story bank. One `## <ID>. <Title>` per story, with `- Best for:`, `- Evidence:` (facts only, from the CV or the learner), `- Anchors:` (5–7 words to recall it), and `- Gaps:` (details Tide must ask the learner for, never invent). |
| `questions.md` | Question bank. One `## <id>. <question>` per question, with `- Round:` (round id), `- Kind:` (motivation \| behavioural \| cv \| technical \| scenario \| presentation-qa \| market \| closing), `- Source:` (reported \| likely \| cv \| brief), `- Stories:` (story IDs), `- Route:` (the structure as arrows, e.g. `Context → Action → Result → Lesson`), and an `- Outline:` of the learner's own facts. Optionally a `### Model answer` written in plain human prose from real facts only, with `PRACTICE VERSION` marking any part the learner must replace with a real detail. |
| `scenarios.md` | Scenario cases that are revealed piece by piece. `## <id>. <title>` with `### Part 1`, `### Part 2` … (what the interviewer says at each stage) and `### Rubric` (the risks, mitigations, escalation and board points a strong answer covers, each as a bullet). |
| `presentation.md` | The brief's requirements as a checklist, the chosen topic, research notes with sources, and `## Assessor questions` (likely Q&A questions, each with the point a strong answer makes). The learner writes their own slides; Tide coaches. |
| `firm.md` | Facts to know cold, each with its source and date: strategy, values, divisions, figures, recent news. |
| `ask-them.md` | Questions to ask at the end, grouped by interviewer type, with the rule "never ask what they already covered". |
| `cards.md` | Flashcards in Tide's existing card syntax, fed into review (FSRS) under deck `Interview: <Target name>`. |

Progress is stored at `.tide/interview/<slug>.json`, one attempt per question, scenario or mock, with marks per readiness area.

## Readiness

The readiness areas are CV defence, behavioural, scenarios (technical), presentation and Q&A, firm and markets, and questions to ask. Each area is scored 0–100% from:
- coverage: how many of its items have been attempted;
- the latest marks, weighted toward recent attempts;
- card retention for its deck.

The overall figure is the weakest-weighted mean. A countdown runs to `date` and to `slidesDue`. "Today's plan" picks the next few items from the lowest areas and the cards that are due.

## Sessions

- **Teach.** A teach-mode lesson on a topic the target needs (for example the three lines of defence, or VaR), using the target's sources and research as readings.
- **CV defence.** Questions on every CV line and project, followed by deeper probes (why this tool, what would you change, what was hard). Marked for accuracy against the learner's real facts, depth and clarity.
- **Behavioural drill.** One question at a time, answered spoken or typed. Marked on structure (route), specifics, ownership, result, length (spoken time) and how natural it sounds. Feedback shows the anchors and what was missed.
- **Scenario.** The case is revealed part by part, and the learner may ask clarifying questions. Marked against the rubric's coverage of risk identification, mitigation and communication.
- **Presentation.** Checks the brief's checklist and a timed run of the talk (the learner speaks it), then 15 minutes of assessor Q&A from `presentation.md`.
- **Live mock.** One full round as the real thing: the interviewer introduces themselves, then asks for a short intro. The interviewer speaks aloud (TTS, not the professor's voice) and the learner answers aloud (STT). It ends with recruiter-style feedback and readiness updates.

The answers Tide writes follow the human-writing guide (src/shared/humanWriting.ts): plain words, varied sentence length, none of the AI tells (inflated vocabulary, rule-of-three padding, "not only… but", em-dash chains, generic upbeat closers). They are never invented: anything the learner hasn't told Tide is a gap to ask about.
