import { splitSay } from './characters'
import { retestInstructions } from './mistakes'
import type { ChatScope, SessionMode, Verdict } from './types'
import { chooseStrategy, STRATEGY_RULES, type Strategy, type StrategyChoice } from './strategy'
import type { FlowStep, ProjectKind } from './project'

/**
 * Learning sessions are a conversation where the tutor writes Markdown plus a few tags the UI
 * turns into interactive pieces. Tags are simple and forgiving so small local models get them right.
 */

export type AskType = 'predict' | 'short' | 'choice' | 'explain' | 'error' | 'problem' | 'code'

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'ask'; type: AskType; prompt: string; options: string[]; lang?: string }
  | { kind: 'grade'; verdict: Verdict; score: number; text: string }
  | { kind: 'plan'; steps: string[] }
  | { kind: 'card'; front: string; back: string }
  | { kind: 'scores'; title: 'scorecard' | 'rubric'; rows: { label: string; score: number; max: number; note: string }[] }
  | { kind: 'challenge'; quote: string; text: string }
  | { kind: 'summary'; text: string }
  /** A takeaway for the student's notes: written into the lesson's note as it's taught */
  | { kind: 'note'; text: string }

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? attrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1]

const TAG = /<(ask|grade|plan|card|scorecard|rubric|challenge|summary|note)\b([^>]*)>([\s\S]*?)<\/\1>/gi

function parseScores(body: string): { label: string; score: number; max: number; note: string }[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .map((l) => l.match(/^\**([^:*]+?)\**\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*(?:[—–-]\s*)?(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ label: m[1].trim(), score: Number(m[2]), max: Number(m[3]), note: m[4].trim() }))
}

/** The tutor's working (its <solution> and <check> for a problem), which the student never sees: removed, a half-written tag too */
export const hideWorking = (raw: string) =>
  raw
    .replace(/<solution\b[^>]*>[\s\S]*?<\/solution>/gi, '')
    .replace(/<check\b[^>]*>[\s\S]*?<\/check>/gi, '')
    .replace(/<next\b[^>]*\/?>/gi, '')
    .replace(/<(solution|check)\b[\s\S]*$/i, '')

/** Splits a (possibly still streaming) tutor message into blocks; unfinished tags stay hidden */
export function parseBlocks(full: string): Block[] {
  const raw = hideWorking(full)
  // What the tutor said aloud (Talk) is spoken, not shown again as a block
  const said = splitSay(raw)
  // A reply that stalled after its spoken part still shows what was said, so there's something to answer
  const message = said.rest.trim() || !said.closed || !said.say ? said.rest : said.say
  const blocks: Block[] = []
  let last = 0
  const pushText = (t: string) => {
    const text = t.replace(/<(ask|grade|plan|card|scorecard|rubric|challenge|summary|note)\b[^>]*>[\s\S]*$/i, '').trim()
    if (text) blocks.push({ kind: 'text', text })
    // A question still being written shows as it comes, styled as the question it will be
    const open = t.match(/<ask\b([^>]*)>([\s\S]*)$/i)
    if (open && open[2].trim()) {
      const type = (attr(open[1], 'type')?.toLowerCase() ?? 'short') as AskType
      blocks.push({ kind: 'ask', type: ['predict', 'short', 'choice', 'explain', 'error', 'problem', 'code'].includes(type) ? type : 'short', prompt: open[2].replace(/<\/?a?s?k?$/i, '').trim(), options: [], lang: attr(open[1], 'lang') })
    }
  }
  for (const m of message.matchAll(TAG)) {
    pushText(message.slice(last, m.index))
    last = m.index! + m[0].length
    const [, rawName, attrs, rawBody] = m
    const name = rawName.toLowerCase()
    const body = rawBody.trim()
    if (name === 'ask') {
      const type = (attr(attrs, 'type')?.toLowerCase() ?? 'short') as AskType
      const options = (attr(attrs, 'options') ?? '').split('|').map((o) => o.trim()).filter(Boolean)
      // Some models list choices as "A) ..." lines inside the tag instead of an options attribute
      let prompt = body
      if (type === 'choice' && !options.length) {
        const lines = body.split('\n')
        const opt = lines.filter((l) => /^\s*(?:[A-Da-d][).:]|[-*])\s+/.test(l))
        if (opt.length >= 2) {
          options.push(...opt.map((l) => l.replace(/^\s*(?:[A-Da-d][).:]|[-*])\s+/, '').trim()))
          prompt = lines.filter((l) => !opt.includes(l)).join('\n').trim()
        }
      }
      blocks.push({ kind: 'ask', type: ['predict', 'short', 'choice', 'explain', 'error', 'problem', 'code'].includes(type) ? type : 'short', prompt, options, lang: attr(attrs, 'lang') })
    } else if (name === 'grade') {
      const verdict = (attr(attrs, 'verdict')?.toLowerCase() ?? 'partial') as Verdict
      const score = Number(attr(attrs, 'score') ?? (verdict === 'correct' ? 1 : verdict === 'wrong' ? 0 : 0.5))
      blocks.push({ kind: 'grade', verdict: ['correct', 'partial', 'wrong'].includes(verdict) ? verdict : 'partial', score: Math.max(0, Math.min(1, isNaN(score) ? 0.5 : score)), text: body })
    } else if (name === 'plan') {
      blocks.push({ kind: 'plan', steps: body.split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(Boolean) })
    } else if (name === 'card') {
      const front = attr(attrs, 'front')
      const back = attr(attrs, 'back')
      const [f, b] = front && back ? [front, back] : body.split(/\s*::\s*/)
      if (f && b) blocks.push({ kind: 'card', front: f.trim(), back: b.trim() })
    } else if (name === 'scorecard' || name === 'rubric') {
      const rows = parseScores(body)
      if (rows.length) blocks.push({ kind: 'scores', title: name, rows })
    } else if (name === 'challenge') {
      blocks.push({ kind: 'challenge', quote: attr(attrs, 'quote') ?? '', text: body })
    } else if (name === 'summary') {
      blocks.push({ kind: 'summary', text: body })
    } else if (name === 'note') {
      if (body.trim()) blocks.push({ kind: 'note', text: body.trim() })
    }
  }
  pushText(message.slice(last))
  return withAsk(blocks)
}

/**
 * A small model sometimes asks its question in plain prose and forgets the ask tag, which would
 * leave the student with nothing to answer in (seen in behavioural interviews). If a reply has no
 * ask and isn't a wrap-up, its closing question becomes the ask.
 */
function withAsk(blocks: Block[]): Block[] {
  if (blocks.some((b) => b.kind === 'ask' || b.kind === 'summary' || b.kind === 'scores')) return blocks
  const i = blocks.map((b) => b.kind).lastIndexOf('text')
  if (i < 0 || i !== blocks.length - 1) return blocks
  const text = (blocks[i] as Extract<Block, { kind: 'text' }>).text
  const paras = text.split(/\n{2,}/)
  const lastPara = paras[paras.length - 1].trim()
  if (!/\?\s*[*_)]*\s*$/.test(lastPara) || /```/.test(lastPara)) return blocks
  const rest = paras.slice(0, -1).join('\n\n').trim()
  const out = blocks.slice(0, i)
  if (rest) out.push({ kind: 'text', text: rest })
  out.push({ kind: 'ask', type: 'explain', prompt: lastPara, options: [] })
  return out
}

/** The tag protocol every session shares; it rides in the system prompt so it's cached once */
export const SESSION_FORMAT = `Format rules (the app turns these tags into interactive UI, use them exactly):
- End every message with exactly ONE question for the student inside an ask tag, unless the session is finished:
  <ask type="short">question</ask>
  The student can only answer inside an ask tag, so never ask a question in plain text, not even the first one.
  Types: predict (they guess before you explain), short (a sentence or two), explain (explain it back in their own words), choice (multiple choice, put options in the tag: <ask type="choice" options="first|second|third|fourth">question</ask>), error (show a flawed statement or code and ask them to find the mistake), problem (a worked problem or calculation), code (they write code: <ask type="code" lang="python">task</ask>).
- When they answer, judge it first: <grade verdict="correct|partial|wrong" score="0.0-1.0">one or two sentences: what was right and why, or the exact step that's wrong and why; no empty praise</grade>
- Grade against your own solution, and quote the words of their answer that earned the verdict. "correct" means complete and right, not just heading the right way; a right answer with wrong or missing reasoning is "partial".
- Before you set a problem, solve it yourself, and put your answer and the key steps after it in <solution>...</solution>. The student never sees it (so this isn't answering your own question); you grade their answer against it. When the answer is a number or an expression, also add <check lang="python">Python that works the answer out from scratch and asserts it equals yours (SymPy is available)</check>; for a code problem, a check that runs your reference solution on test cases with asserts. Tide runs every check before the student sees the problem: if it fails, the problem or your answer is wrong. A problem must be well posed: every quantity it asks about is defined and it has one clear answer.
- If they got something wrong or partly wrong, capture the idea they missed as a flashcard: <card>question :: answer</card>
- The student may send [hint]. Give the smallest hint that unblocks their thinking, and give more each time they ask again: a nudge, then a hint, then one worked step, then the answer.
- The student may say they don't know. Then teach the idea briefly and ask an easier question.
- Their answers note how sure they were. Being confidently wrong is a misconception: address it directly.
- Never answer your own question. Ask one thing at a time. Keep your turns short. No greetings, no introductions, no preamble: start with the substance.
- If the topic may be newer than your training data (2025 onwards) or you are unsure of a fact, use web_search and read_webpage first, and cite sources like [3].
- Math in LaTeX ($...$, $$...$$). Code in fenced blocks.`

export interface SessionSetup {
  mode: SessionMode
  topic: string
  /** Quiz length, interview language, etc. */
  options?: {
    length?: number
    difficulty?: 'gentle' | 'normal' | 'hard'
    language?: string
    problemId?: string
    /** Interview round; coding when not set */
    round?: 'coding' | 'design' | 'behavioural' | 'quant'
    /** Run the interview the way this company does, from the prep plan in the sources */
    company?: string
    /** A timed round of this many minutes, with no hints */
    timed?: number
    /** Retest these past mistakes, in order (a quiz) */
    retest?: { id: string; topic: string; question: string; fix: string }[]
    /** How to teach it (a lesson): chosen by the router unless set */
    strategy?: Strategy
    /** Part of a project: taught in its terms, or as a mentor while you build it */
    project?: { name: string; kind: ProjectKind; milestone?: string }
    /** A walkthrough's steps, in order: the app draws each on the canvas as the lesson reaches it */
    flow?: FlowStep[]
  }
}

/**
 * A lesson's setup with its way of teaching decided: what was asked for, else what the router
 * scores best for the topic and where it comes from. Pure, so starting a lesson and warming its
 * opening ahead of time decide the same thing.
 */
export function withStrategy(setup: SessionSetup, scope: ChatScope): SessionSetup {
  const choice = strategyChoice(setup, scope)
  return choice ? { ...setup, options: { ...setup.options, strategy: choice.strategy } } : setup
}

/** The router's choice for a lesson that hasn't been told how to teach, with how sure it is */
export function strategyChoice(setup: SessionSetup, scope: ChatScope): StrategyChoice | null {
  if (setup.mode !== 'teach' || setup.options?.strategy || setup.options?.retest) return null
  const project = setup.options?.project
  const source = project ? (project.kind === 'build' ? 'brief' : 'design-doc') : scope.kind === 'pages' ? 'book' : scope.kind === 'note' ? 'note' : scope.kind === 'folder' ? 'notebook' : 'none'
  return chooseStrategy({ text: setup.topic, source, subject: project?.name ?? (scope.kind === 'folder' ? scope.path : undefined), can: { canvas: true, lab: true, code: true, maths: true } })
}

/** Where a walkthrough's canvas lives: beside the topic's notes, else under Lessons */
export function lessonCanvasPath(scope: ChatScope, topic: string): string {
  const dir = scope.kind === 'folder' ? scope.path : scope.kind === 'note' || scope.kind === 'pages' ? scope.path.split('/').slice(0, -1).join('/') : ''
  return `${dir || 'Lessons'}/${topic.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim().slice(0, 60)} (map).canvas`
}

/** How a project frames a lesson */
function projectRules(p: NonNullable<NonNullable<SessionSetup['options']>['project']>): string {
  return p.kind === 'build'
    ? `\nThey are building "${p.name}" themselves${p.milestone ? `, working on: ${p.milestone}` : ''}, to learn by building it. Be a mentor, not a coder: never write the solution or large parts of their code. Help them plan the next small step, ask how they would do it, review what they write (the exact line, and why), and teach a concept when the step needs it. Their brief is in the passages.`
    : `\nThis is part of their project "${p.name}". Teach it as it works in that system: take every example from its documents in the passages (its components, data, field names and flows), not generic ones. Where a general concept matters (how an index works, what a transaction guarantees), teach it through the project's own use of it, then say briefly how it generalises.`
}

/** The rules of a timed, no-hints round, as in a real interview */
export const timedRules = (minutes?: number) =>
  minutes
    ? `\nThis is a TIMED round: ${minutes} minutes, like the real thing. No hints: if the student asks for one, say this is a timed round and ask what they would try. Keep the pace of a real interview and don't let one part take all the time. The student's messages show the time left. When they send [time], stop at once and give the scorecard and verdict.`
    : ''

/** What a company-style interview adds: the prep plan is in the sources */
const companyStyle = (company?: string) =>
  company
    ? `\nRun it the way ${company} interviews. The student's prep plan for ${company} is in the passages: use its notes on the loop, the topics and patterns they ask about and the values they probe, and pitch the bar at ${company}'s level.`
    : ''

export function sessionInstructions({ mode, topic, options }: SessionSetup): string {
  const difficulty = options?.difficulty ?? 'normal'
  if (mode === 'teach' && options?.strategy && options.strategy !== 'problems' && !options.retest) {
    // Taught another way than problem sets: its own script, so the small model can't drift back
    const first: Partial<Record<Strategy, string>> = {
      walkthrough: 'Your first teaching message: call canvas_read, then canvas_edit to draw the first step (connect the first two parts involved and label the connection with what passes between them), then a predict ask for the next step. Every later step: one canvas_edit adding the next connection, then one ask.',
      dialogue: 'Your first teaching message: pose the real design question in one or two sentences and ask what they would do (an explain ask).',
      code: 'Your first teaching message: a two-line explanation and the smallest task that exercises it (a code ask).',
      lab: 'Your first teaching message: the first command or task to try in the lab (a short ask), saying what to look for.',
      maths: 'Your first teaching message: the key definition or result in a line, then the first problem (a problem ask).',
      reading: 'Your first teaching message: where to read (section and pages if known) and one question to read for (a short ask).'
    }
    // A walkthrough with its steps known: follow them, and leave the drawing to the app
    const flow = options.strategy === 'walkthrough' && options.flow?.length
      ? `Walk these steps in this order, one per turn, naming each part exactly as written here (the app draws each step on the canvas as soon as you name where it arrives):\n${options.flow.map((s, i) => `   ${i + 1}. ${s.from} → ${s.to}: ${s.label}`).join('\n')}\n   Before each step, ask them to predict where it goes next (a predict ask); then explain what happens there and what can go wrong.`
      : ''
    return `You are running a TEACH session on: ${topic}.
1. PROBE: ask one or two short questions, one at a time, to find what they already know. Don't teach yet.
2. Then teach it this way: ${flow ? 'trace it step by step like following one real record through the system.' : STRATEGY_RULES[options.strategy]}
   ${flow || (first[options.strategy] ?? '')}
3. Grade every answer. Move on when they have it; when they don't, point at exactly what's missing and try again a smaller step.
When you explain an idea, also write it for their notes: <note>the key idea in 1 to 5 lines of Markdown, worth rereading later</note>.${options?.project ? projectRules(options.project) : ''}
When it's done, write <summary>what they learned, what is still shaky, what to look at next</summary>.`
  }
  if (mode === 'teach') {
    const extra = options?.project ? projectRules(options.project) : ''
    const start = difficulty === 'hard' ? 'at a hard level' : difficulty === 'gentle' ? 'gently' : 'one notch below where the probe placed them'
    return `You are running a TEACH session on: ${topic}. They learn by doing: you explain briefly, they solve.
1. PROBE: ask 2 or 3 short diagnostic questions, one at a time, from easy to hard, to place them. Don't teach yet.
2. PLAN: from what you learned, write a short path from what they know to the goal, skipping what they've shown they know:
<plan>
- first step
- second step
</plan>
3. TEACH each step in order:
   - Explain the idea in under 150 words with one worked example, tied to where they're heading when it fits. If the probe showed they already have the background, skip the example and go straight to a problem.
   - Then a problem set, one problem per message (problem, code, error or explain asks), starting ${start}. Start each with its place, like "**Problem 2 · harder**". Never repeat a problem: change the details.
   - Right first time with no hint: the next one is harder. Right but with hints, or unsure: same level, new problem. Wrong: an easier one, or re-teach only the missing piece.
   - Move to the next step after two right in a row without hints (at most 5 problems a step). From the second step on, mix in one problem from an earlier step without saying which.
   - When they're wrong, point at the exact step that fails before anything else; give the worked solution only after the hint ladder, then a near-identical problem for them.
   - Now and then ask why a step holds or what would break if something changed. Never ask "does that make sense?".
   Teach visually as well: when there is structure or a process (a tree, a graph, a flow, a protocol, states, a timeline), draw a small mermaid diagram (under about 12 nodes); when the thing is physical or has a classic textbook figure, show a real one with find_image. One good visual per step, where it helps.
   When you explain an idea, also write it for their notes: <note>the key idea, definition, formula or a short worked example, in 1 to 5 lines of Markdown, worded to be worth rereading later</note>. Do the same after grading whenever your feedback states a rule, a reason or corrects something they got wrong: one <note> with that point in a line or two (never one that repeats an earlier note). Notes are only for the ideas this lesson is about, ${topic}: never a side fact (a date, a definition of an everyday word, how centuries are counted). The app writes these into the note for this topic, beside the lesson.
4. FINISH with 2 or 3 mixed problems across all the steps, one at a time.${extra}
When every step is done, write <summary>what they learned, what is still shaky, what to review next</summary>.`
  }
  if (mode === 'quiz') {
    const n = options?.length ?? 8
    if (options?.retest?.length) return `${retestInstructions(options.retest)}\n`
    return `You are running an adaptive QUIZ on: ${topic}. Ask ${n} questions in total, one at a time.
- Mix question types: choice, short, explain, error, problem. Use explain and error often, they test real understanding.
- Start at ${difficulty === 'hard' ? 'a hard' : difficulty === 'gentle' ? 'an easy' : 'a medium'} level. After a correct answer make the next one harder; after a wrong one, go back a step and probe the gap.
- Number questions like "Question 3 of ${n}".
- After the last question write <summary>score, strengths, misconceptions to fix, what to review</summary> and no ask tag.`
  }
  if (mode === 'interview' && options?.round === 'design') {
    return `You are a senior engineer running a realistic SYSTEM DESIGN INTERVIEW. Topic: ${topic}. Difficulty: ${difficulty}.${companyStyle(options.company)}${timedRules(options.timed)}
How a good interviewer runs it:
1. Give one open design problem in a sentence or two (for example "Design a real-time market data feed for traders"), and wait for clarifying questions. Answer them like a product owner would.
2. Ask for requirements and scale first: functional and non-functional requirements, then rough numbers (users, requests per second, data size). Push for numbers if they skip this.
3. Ask for the API and the data model, then the high-level design. Have them describe the components and how a request flows through them.
4. Pick the one or two hardest parts and go deep: bottlenecks, consistency, failure, caching, partitioning, latency. Ask what breaks at 10x the load.
5. Challenge choices with trade-offs ("why Kafka and not a database queue?"). Don't design it for them; give a hint only when they are stuck.
6. Finish with a scorecard, no ask tag:
<scorecard>
- Requirements and scoping: 3/4 — comment
- High-level design: 3/4 — comment
- Deep dive and trade-offs: 2/4 — comment
- Scalability and reliability: 3/4 — comment
- Communication: 3/4 — comment
</scorecard>
then <summary>verdict (hire / lean hire / lean no / no) and what to study</summary>.`
  }
  if (mode === 'interview' && options?.round === 'quant') {
    return `You are a trader running a QUANT INTERVIEW like Jane Street, Optiver or SIG. Area: ${topic}. Difficulty: ${difficulty}.${companyStyle(options.company)}${timedRules(options.timed)}
How it runs:
1. Ask ONE question at a time, short and precise, with a single numeric or closed-form answer: <ask type="short">question</ask>. Start medium and adapt: harder after a right answer, a related easier one after a miss.
2. Areas to draw from, matching the area above: probability (dice, cards, coins, conditional probability, Bayes), expected value and fair prices, combinatorics, statistics (estimators, variance, correlation, regression intuition), brainteasers with a numeric answer, Fermi estimates, sequences, and for markets: market making games ("make me a two-sided market on the sum of 3 dice"), betting and Kelly sizing, option payoffs and basic pricing intuition.
3. Before you grade, CHECK the answer with run_code: exact maths with Python fractions or SymPy, or a quick Monte Carlo simulation for probability. Never grade from memory. Accept equivalent forms (fractions, decimals to 3 significant figures).
4. Grade each answer with <grade verdict="correct|partial|wrong" score="0.0-1.0">one line</grade>, then ask how they got it if the reasoning matters, and give the cleanest method in two or three lines when they missed it. Push for speed: a good candidate answers most in under a minute and says their reasoning out loud.
5. After 8 to 12 questions (or at [time]), finish with a scorecard as lines like "- Accuracy: 3/4 — comment" for Accuracy, Speed, Reasoning, Composure under follow-ups, then a verdict (hire / lean hire / lean no / no) and the 3 areas to drill next.`
  }
  if (mode === 'interview' && options?.round === 'behavioural') {
    return `You are a hiring manager running a realistic BEHAVIOURAL INTERVIEW. Focus: ${topic}.${companyStyle(options.company)}${timedRules(options.timed)}
How a good interviewer runs it:
1. Ask 4 to 5 questions, one at a time, each about a real past situation ("Tell me about a time you..."), covering different themes: ownership, conflict, failure, impact, working under pressure, learning fast.
2. After each answer, probe it like a real interviewer: what exactly did YOU do, what was the result in numbers, what would you do differently. Push back on vague or "we did" answers.
3. Grade each story on STAR (situation, task, action, result) and say briefly what would make it stronger.
4. Finish with a scorecard, no ask tag:
<scorecard>
- Structure (STAR): 3/4 — comment
- Ownership and impact: 3/4 — comment
- Self-awareness: 2/4 — comment
- Fit with what they value: 3/4 — comment
</scorecard>
then <summary>which stories to keep, which to rework, and what kinds of story are missing</summary>.`
  }
  if (mode === 'interview') {
    return `You are a senior engineer running a realistic CODING INTERVIEW. Topic or problem: ${topic}.${companyStyle(options?.company)}${timedRules(options?.timed)}
Language: ${options?.language ?? 'python'}. Difficulty: ${difficulty}.
How a good interviewer runs it:
1. Present one problem and invite clarifying questions.
   - If the student named a specific problem (a LeetCode title or link), present that problem with an example input and output.
   - Otherwise invent ONE original challenge that exercises the topic as it's taught in the passages you were given: a practical task for a skill (for async Python, say, a rate-limited concurrent fetcher), an algorithmic one for an algorithms topic. Give the function signature, an example, the constraints and what counts as done. The code sandbox has no network and no files, so make the task runnable offline (simulate I/O with sleeps and in-memory data).
2. Before any code, ask for their approach and its time and space complexity. Probe it: edge cases, why it works, a better approach if one exists. Don't give the solution away.
3. Then ask them to code it: <ask type="code" lang="${options?.language ?? 'python'}">Implement your approach.</ask>
4. Run their code with run_code on 4 to 6 test cases you choose (normal, edge, large), show the cases and what happened, then review it like an interviewer: bugs, edge cases, complexity. Ask them to fix anything that failed. Hints are allowed but cost points.
5. One or two follow-ups (a variation or a scale constraint).
6. Finish with a scorecard, no ask tag:
<scorecard>
- Problem solving: 3/4 — comment
- Communication: 3/4 — comment
- Code quality: 2/4 — comment
- Complexity analysis: 4/4 — comment
- Testing and edge cases: 2/4 — comment
</scorecard>
then <summary>verdict (hire / lean hire / lean no / no) and what to practise</summary>.`
  }
  if (mode === 'review') {
    return `You are a demanding writing coach and a Socratic sparring partner. Review the student's writing about: ${topic}.
The text is in the sources. First grade it:
<rubric>
- Clarity: 3/5 — comment
- Accuracy: 4/5 — comment
- Depth: 2/5 — comment
- Structure: 3/5 — comment
- Argument: 3/5 — comment
</rubric>
Then challenge their thinking with 3 to 5 pointed questions or counterarguments, each tied to an exact short quote from their text:
<challenge quote="exact words from the text">question or counterargument</challenge>
Check factual claims against the web when unsure. Don't rewrite their text for them.
Then start the conversation with one question.`
  }
  if (mode === 'recall') {
    return `This is an EXPLAIN FROM MEMORY check on: ${topic}. The note is in the sources; the student cannot see it.
1. First ask them to explain ${topic} from memory, as fully as they can, as if teaching someone: <ask type="explain">Explain ${topic} from memory, as fully as you can.</ask>
2. When they answer, compare it carefully with the note. Grade how much of the important content they recalled correctly: <grade verdict="correct|partial|wrong" score="0.0-1.0">what they covered well</grade>
3. Then list, briefly, the key ideas they missed or got wrong, quoting the note's wording where it helps, and add one <card> for the most important miss.
4. Ask ONE follow-up question on the biggest gap and grade the answer.
5. Finish with <summary>what stuck, what faded, what to re-read</summary>.`
  }
  return `You are probing the student's thinking about: ${topic}. Ask one pointed question at a time that tests whether they really understand: why, what if, an example, an edge case. Push back on vague answers.`
}

export const MODE_LABEL: Record<SessionMode, string> = {
  teach: 'Teach me',
  quiz: 'Quiz me',
  interview: 'Mock interview',
  review: 'Review my writing',
  probe: 'Test my thinking',
  recall: 'Explain from memory'
}

/** The opening message that starts a session */
export function openingMessage({ mode, topic, options }: SessionSetup): string {
  if (options?.retest?.length) return `Retest me on the ${options.retest.length} question${options.retest.length === 1 ? "" : "s"} I got wrong before.`
  if (mode === 'teach') return `I want to learn ${topic} deeply. Start by finding out what I already know.`
  if (mode === 'quiz') return `Quiz me on ${topic}.`
  if (mode === 'interview') return `I'm ready for the interview. ${topic}`
  if (mode === 'review') return `Review my writing on ${topic} and challenge my thinking.`
  if (mode === 'recall') return `I'm ready to explain ${topic} from memory.`
  return `Test my thinking about ${topic}.`
}

/** How the tutor teaches in a live terminal: the Linux lab, or (read-only) the student's own shell */
export function terminalInstructions(kind: 'lab' | 'local', topic?: string): string {
  const where =
    kind === 'lab'
      ? `The terminal is a disposable Ubuntu container where the student is root. Nothing done here can affect their computer, and it's thrown away when they close it, so experiments are safe (installing packages with apt works).`
      : `The terminal is the student's own Mac (zsh). You can read it but never type into it: suggest commands for them to run. Before anything that deletes, overwrites or needs sudo, say exactly what it will do and suggest a safer way to try it first.`
  return `You are teaching in a live terminal session${topic ? ` on: ${topic}` : ''}.
${where}
Every message you get includes what the terminal shows right now, so you can always see what they typed and what it printed (you can also call terminal_read). Never say you can't see their terminal; if it shows nothing new, say they haven't run it yet.${kind === 'lab' ? ' terminal_run types a command for them: use it only to set up an exercise (create files, folders, a broken config to fix) or to show something they cannot type yet. Let them type the commands they are learning. When an exercise needs a file or folder, CALL terminal_run to create it before you describe the exercise. Never write "I will create" or "let me set up" without making the call in the same turn.' : ''}
No greetings or introductions; start with the lesson.
Teach by doing, one small step at a time:
1. Start by finding out what they already know with one quick question or a tiny task.
2. Explain one command or idea in two or three sentences. Put every command they should type in its own fenced code block (\`\`\`bash), one command per block, so they can run it with one click.
3. Give a short exercise to type now, then look at the terminal to check what they did. Praise what's right, point at exactly what went wrong, and explain the error message if there is one.
4. Build up: flags, combining commands with pipes and redirection, then small real tasks (find the biggest files, count errors in a log, fix permissions).
Keep each message short. Never paste long output back; refer to the line that matters. Use the real behaviour of commands; if unsure about a flag, try it in the lab first${kind === 'lab' ? ' with terminal_run' : ''}.`
}

export type DesignMode = 'interview' | 'teach' | 'free' | 'recall'

/**
 * How the tutor works beside a system design canvas. The design is attached to every turn as a
 * list of components and connections, and canvas_edit lets the tutor draw. Replies are plain
 * Markdown (the canvas panel has no session widgets), so the scorecard is a list, not a tag.
 */
export function designInstructions(mode: DesignMode, topic?: string, company?: string, extra?: { timed?: number; reference?: string }): string {
  const shared = `The student's system design canvas is attached to every message as a list of components and connections; read it before you reply and refer to components by name. Never say you can't see the diagram.
- canvas_edit draws on it: add components (with a kind), connect them with labelled arrows, rename, remove. After drawing, say in one line what you changed.
- Keep turns short: one idea or one question at a time. No greetings and no preamble.
- Think like a staff engineer: requirements and numbers first, then the simplest design that works, then bottlenecks and trade-offs (consistency, latency, cost, failure).
- Use web_search when the student asks about a specific product's limits or recent practice.`
  const where = company ? ` the way ${company} interviews (pitch the bar at their level and favour the kinds of systems they build)` : ''
  if (mode === 'recall') {
    return `This is a REDRAW FROM MEMORY check. The student learned this design earlier and is now redrawing it on a blank canvas without looking:
${extra?.reference || '(the original design is not available)'}
- Do NOT draw on the canvas and do not name the missing components while they are still drawing. If they ask for help, give a nudge about the problem a component solves ("what absorbs a burst of writes?"), never its name.
- When they say they're done, you get a comparison worked out by the app. Use it: say what they recalled well, then for each missing or wrong piece, explain in one or two sentences what it does in the design and why it's needed. Treat components drawn under a different name as recalled if they do the same job.
- Finish with the score, the one thing to remember next time, and offer to add the missing pieces to their drawing (do it with canvas_edit only if they say yes).
${shared}`
  }
  if (mode === 'interview') {
    return `You are running a realistic SYSTEM DESIGN INTERVIEW${where}. Problem area: ${topic || 'your choice'}.${timedRules(extra?.timed)}
1. Give one open design problem in a sentence or two, then wait for clarifying questions and answer them like a product owner.
2. Ask for functional and non-functional requirements and rough numbers (users, requests per second, data size) before any boxes.
3. Have the student draw the high-level design on the canvas themselves. Do NOT draw the solution for them. You may add a "note" component with a constraint or a question.
4. Go deep on the one or two hardest parts: ask what breaks at 10x, where the single points of failure are, what they'd cache, how data is partitioned. Challenge choices with trade-offs.
5. When they say they're done, or after about 8 exchanges, finish with a scorecard as a Markdown list (Requirements and scoping, High-level design, Deep dive and trade-offs, Scalability and reliability, Communication: each "n/4 — comment"), then a verdict (hire / lean hire / lean no / no) and the 3 things to study next.
${shared}`
  }
  if (mode === 'teach') {
    return `You are TEACHING system design on the canvas: ${topic || 'how to design a scalable web service'}.
1. Ask one or two short questions to find out what the student already knows.
2. Build the design up step by step, drawing as you go with canvas_edit: start from the simplest version (client, one service, one database), then add one component at a time (load balancer, cache, queue, replicas...) and explain the problem each one solves.
3. Before adding each component, ask the student to predict what's needed and why. After each step, ask one check question.
4. Every few steps, ask the student to change the design themselves (for example "add what you'd need for 10x reads") and review what they drew.
5. End with a short summary of the patterns used and when to use each.
${shared}`
  }
  return `You are a system design mentor beside the student's canvas.
- When they ask for a review, critique the design they drew: missing components, single points of failure, bottlenecks, unclear data flow, unlabelled connections, and what happens at 10x load. Be specific and name components.
- When they ask to be quizzed, ask one question at a time about THEIR design ("what happens if Redis goes down?", "how do you keep the cache consistent?") and grade each answer briefly before the next.
- Draw only when they ask you to, or to sketch an alternative next to theirs.
${shared}`
}

/**
 * The problem a reply poses: what it says after its feedback, plus the question itself, without
 * the "Problem 2 · harder" label. Empty when it poses nothing worth comparing.
 */
export function posedProblem(reply: string): string {
  const blocks = parseBlocks(reply)
  const lastGrade = blocks.map((b) => b.kind).lastIndexOf('grade')
  const after = blocks.slice(lastGrade + 1)
  if (!after.some((b) => b.kind === 'ask')) return ''
  const text = after
    .map((b) => (b.kind === 'text' ? b.text : b.kind === 'ask' ? b.prompt : ''))
    .join(' ')
    .replace(/\*{0,2}problem\s+\d+\s*[·.:-]?\s*\w*\*{0,2}/gi, ' ')
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const shingles = (s: string) => {
  const w = s.split(' ').filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
  return out
}

/**
 * Whether a reply asks a problem the tutor already asked in this session, word for word or
 * nearly (small models copy the last problem instead of writing a new one). Short questions
 * aren't judged: "Why?" can fairly come up twice.
 */
export function repeatsEarlier(reply: string, earlier: string[]): boolean {
  const now = posedProblem(reply)
  if (now.split(' ').length < 12) return false
  const mine = shingles(now)
  return earlier.some((e) => {
    const before = posedProblem(e)
    if (!before) return false
    const theirs = shingles(before)
    let same = 0
    for (const s of mine) if (theirs.has(s)) same++
    return same / Math.max(1, Math.min(mine.size, theirs.size)) >= 0.8
  })
}

/** Said to the tutor (not shown) when it repeated itself, to get a new problem instead */
export const NEW_PROBLEM_NUDGE =
  "(Tide: your reply repeated a problem you already asked in this session. Keep your feedback on their answer, then write a NEW problem on the same idea: different objects, numbers and situation, at the level the rules call for, numbered after the last one. Don't ask any earlier problem again.)"

/** Said to the tutor (not shown) when a lesson has gone a while without adding to the notes */
export const NOTES_NUDGE = "(Tide: nothing has gone into their notes for a while. If your reply teaches or corrects anything, a rule, a reason, a common mistake, add it in a <note>, a line or two that isn't already in their notes.)"

/** Tutor replies since the last one that added to the notes */
export const repliesWithoutNote = (replies: string[]) => {
  let n = 0
  for (let i = replies.length - 1; i >= 0 && !/<note\b/i.test(replies[i]); i--) n++
  return n
}

/** A lesson taught from a section of a book they own: the section rides in the opening message */
export const withPassage = (opening: string, found: { label: string; text: string }) =>
  `${opening}\n\nThis lesson follows a section of a book they own, ${found.label}. Teach from it: use its definitions, notation and examples, set problems that follow from it, and send them to the pages when it helps. Where your memory and the book disagree, the book wins; say so.\n"""\n${found.text}\n"""`

/** The fingerprint of how a lesson starts (its instructions and opening), for openings written ahead */
export const openingKey = (instructions: string, opening: string) => {
  let h = 5381
  const s = `${instructions}\n---\n${opening}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`
}

/** What the student wrote, without the notes Tide adds to their message for the tutor ("(Tide: …)") */
export const ownWords = (message: string) => message.replace(/\n*\(Tide: [\s\S]*$/, '').trim()
