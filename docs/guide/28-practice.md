---
title: Practice
group: Everyday
summary: Learn by doing: sharpness training, coding challenges, interview problems, quant drills, system design and company prep.
---
![Each tab starts from one box. Pills along its bottom set the level, language and sources.](img/practice.jpg)

## Sharpness

The **Sharpness** tab is a stream of problems you haven't seen, each just past your level: algorithms (LeetCode-medium to hard style, in Python, with hidden tests), system design (a feature store, a ledger at 50,000 postings a second, a blockchain indexer…), production incidents, ML problem-solving, quant brainteasers and maths proofs. With Claude, Opus writes each one and Tide checks it in the sandbox before you see it; without Claude they come from a fixed bank whose answers are checked in code.

The first attempt is timed and has no hints. Tick the methods you tried and submit (or give up); it's marked and your rating for that category moves. After a miss, **I'm stuck** gives a method hint (try a smaller case, find the invariant, work backwards…), never the answer; a solution hint only comes after two method hints and a retry. Then a five-minute post-mortem (where you got stuck, what you tried, what would have unlocked it, the pattern), with Opus asking back, ends as a card about the method. It goes into recall and comes back in the stream as a fresh problem of the same pattern.

Incident drills start with a page. Ask for data (logs, metrics, deploys, a query), say hypotheses, act, then name the root cause. Opus plays the system and your on-call partner; without Claude the system answers from its own data. Drills are graded on method, speed and correctness and end in a blameless post-mortem.

Each category has a rating with a ± band, a trend, and estimates against real bars (LeetCode-hard-style in about 35 minutes, a senior design rubric, trading-firm brainteasers), said only after five rated attempts. Mock interviews move the same ratings, and a higher algorithms rating raises the coding mock's level.

## Coding challenges

Name something you've been learning, like async Python or B-tree indexes, choose which notebook to draw on and how hard, and **Start**. The tutor writes an original challenge, runs a mock interview, runs your code against real test cases and gives you a scorecard. Challenges come back for another go, fresh each time.

## Interview problems

Paste a LeetCode link to track it by pattern. Each has a mock interview with real test cases. Struggled problems come back in two days; clean solves in a week, then two weeks, a month and two months.

## Mock interviews and exams

The **Mock** tab runs a timed mock of five kinds: a coding interview in the editor (a problem from a tagged bank at your level, with hidden tests run in the sandbox), system design on the canvas (a payment processor, a card authorisation flow, a ledger, a URL shortener…), quant and finance (mental maths, probability and expected value, a market sizing, payments and risk questions), behavioural (STAR questions with a follow-up each), and a mock exam written from what you've studied lately.

Each starts with a brief: what to expect and the rubric it's marked on. Then the clock runs: no breaks interrupt it and the sidebar steps away. With Claude, Sonnet is the interviewer (it asks for complexity, edge cases and testing, probes scale and failure, and follows up; a hint costs points) and Opus marks. Without Claude every mock still runs and is marked in code: the hidden tests, the design checklist, the quant answers, the shape of your stories.

The debrief scores each rubric item from 0 to 4, quotes the moments that decided it, shows a model answer (on a design, Opus's notes on your diagram and a reference design), and lists what to practise next. Those go into **Coach/Mock practice.md**, what you missed comes back as recall questions in later lessons, and your learner profile and the teaching measures take it in. The history below the kinds charts your scores over time.

## Linux lab

A real terminal in a throwaway Ubuntu container (needs Docker Desktop). The tutor asks what you know, gives you commands to try, sets up exercise files and checks what you typed. You're root, and nothing in the lab can touch your Mac; **Fresh lab** gives you a clean one. **Cards** turns the commands you ran into flashcards.

## Playground

A small editor using VS Code's editor. <kbd>⌘Enter</kbd> runs Python or JavaScript with the file's folder beside it, so a project can import its own modules and read its data files. Python can use NumPy, pandas and Matplotlib once set up, and charts appear under the output. The tutor beside it pair-programs with you: it sees the file and what it printed.

See [Prepare for an interview](15-flow-interview.md) for company prep, quant drills and system design.
