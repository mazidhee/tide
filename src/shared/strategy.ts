/**
 * How to teach this, decided before the model says a word. A lesson can be taught as a set of
 * problems, a back-and-forth where you think it through together, a walkthrough traced step by
 * step on a canvas, code you write and run, commands in the lab, derivations checked with SymPy,
 * or guided reading. Which fits depends on several things at once, so it's scored, not ruled:
 *
 * - what you asked for, and how ("walk me through", "let's think it through", "draw it", "quiz me")
 * - what it's about (a flow in a system, a proof, a language feature, a command-line tool)
 * - where it comes from (a project's design doc, a book's chapter, your own note, a build brief)
 * - how well you know it already (new things need showing; known things need testing)
 * - what Tide can do right now (a canvas, the lab, running code, SymPy)
 *
 * Each signal adds weight to the strategies it argues for. The best wins when it's clearly ahead;
 * when two are close, the caller asks the model to break the tie or lets you pick, and the choice
 * can change mid-lesson when you say so ("let's just talk it through").
 */

export type Strategy = 'problems' | 'dialogue' | 'walkthrough' | 'code' | 'lab' | 'maths' | 'reading'

export const STRATEGIES: Strategy[] = ['problems', 'dialogue', 'walkthrough', 'code', 'lab', 'maths', 'reading']

export const STRATEGY_LABEL: Record<Strategy, string> = {
  problems: 'Problem sets',
  dialogue: 'Think it through together',
  walkthrough: 'Walk through it on a canvas',
  code: 'Write and run code',
  lab: 'Hands-on in the lab',
  maths: 'Derive it, checked by SymPy',
  reading: 'Guided reading'
}

export interface StrategySignals {
  /** What you asked for, or the lesson's topic */
  text: string
  /** Where the material comes from */
  source?: 'design-doc' | 'book' | 'note' | 'notebook' | 'brief' | 'none'
  /** The subject it sits in, e.g. a notebook's name */
  subject?: string
  /** How well you know it */
  level?: 'new' | 'weak' | 'shaky' | 'solid' | 'mastered'
  /** What Tide can do right now */
  can: { canvas: boolean; lab: boolean; code: boolean; maths: boolean }
}

export interface StrategyChoice {
  strategy: Strategy
  /** How far ahead of the runner-up it is, 0 to 1 */
  confidence: number
  runnerUp: Strategy
  scores: Record<Strategy, number>
  /** Why, in the words of the signals that counted most */
  reasons: string[]
  /** The best has a clear lead: no need to ask */
  clear: boolean
  /** What to open beside the lesson */
  surfaces: { canvas: boolean; lab: boolean }
}

type Rule = { test: RegExp; add: Partial<Record<Strategy, number>>; why: string }

/** What you asked for, and how: the strongest signals */
const ASKS: Rule[] = [
  { test: /\b(walk me through|trace|step by step through|end[- ]to[- ]end|how does .+ (flow|move|travel|get processed)|what happens when)\b/i, add: { walkthrough: 3.2, dialogue: 0.4 }, why: 'you asked to be walked through it' },
  { test: /\b(draw|diagram|map (it )?out|sketch|visuali[sz]e|on the canvas)\b/i, add: { walkthrough: 2.6 }, why: 'you asked to see it drawn' },
  { test: /\b(think (it |this )?through|talk (it |this )?through|with me|discuss|brainstorm|debate|trade-?offs?|pros and cons|should (we|i)|would you|why (would|did|do) (we|they)|design (it|this|one))\b/i, add: { dialogue: 3, walkthrough: 0.4 }, why: 'you wanted to think it through together' },
  { test: /\b(quiz|test me|practi[cs]e|problems?|exercises?|drill|questions? on)\b/i, add: { problems: 3 }, why: 'you asked for practice' },
  { test: /\b(implement|write (a|the|some)? ?(function|program|code|script)|code (it|this) up|in (python|c|c\+\+|go|rust|javascript|typescript|java))\b/i, add: { code: 2.8 }, why: 'you want to write it' },
  { test: /\b(run|type|commands?|terminal|shell|cli|install|configure|deploy|set ?up)\b/i, add: { lab: 1.6, code: 0.3 }, why: 'it is something you do at a command line' },
  { test: /\b(prove|proof|derive|derivation|show that|solve|integral|differentiate|eigen\w*|probabilit\w*|expected value|matri(x|ces)|equation|theorem|lemma)\b/i, add: { maths: 2.6, problems: 0.6 }, why: 'it is maths to work through' },
  { test: /\b(read|chapter|pages?|section \d|this book)\b/i, add: { reading: 1.4 }, why: 'it is reading' },
  { test: /\b(explain|what is|what are|overview|intro(duction)?|basics)\b/i, add: { reading: 0.5, walkthrough: 0.4, dialogue: 0.3 }, why: 'you want it explained first' }
]

/** What it's about: weaker signals that tilt the balance */
const TOPICS: Rule[] = [
  { test: /\b(system|service|microservices?|architecture|component|pipeline|queue|event|message|ledger|settlement|reconcil\w*|payment|api|webhook|request|transaction|replication|consensus|cache|load balanc\w*|sharding|partition\w*|flow)\b/i, add: { walkthrough: 1.1, dialogue: 0.9 }, why: 'it is a system with moving parts' },
  { test: /\b(schema|collection|index(es|ing)?|query|aggregation|join|sql|mongo\w*|postgres\w*|database)\b/i, add: { code: 0.8, walkthrough: 0.4, problems: 0.4 }, why: 'it is data you can query' },
  { test: /\b(pointer|malloc|struct|syscall|fork|exec|thread|mutex|compiler|assembly|memory layout|linked list|hash ?map|tree|graph|algorithm|recursion|big o)\b/i, add: { code: 1.2, problems: 0.8 }, why: 'it is programming you learn by doing' },
  { test: /\b(docker|kubernetes|k8s|linux|bash|git|nginx|systemd|permissions?|chmod|ssh|n8n)\b/i, add: { lab: 1.4, walkthrough: 0.3 }, why: 'it is a tool you learn by using' },
  { test: /\b(algebra|calculus|statistic\w*|logarithm\w*|vector|linear|number theory|combinatoric\w*|series|limit|function)\b/i, add: { maths: 1.2, problems: 0.8 }, why: 'it is maths' },
  { test: /\b(history|why .+ (exists|matters)|philosophy|ethic\w*|strategy|market)\b/i, add: { dialogue: 0.8, reading: 0.6 }, why: 'it is an idea to discuss' }
]

const SOURCE: Record<NonNullable<StrategySignals['source']>, Partial<Record<Strategy, number>>> = {
  'design-doc': { walkthrough: 1.2, dialogue: 0.9 },
  brief: { dialogue: 1.3, code: 0.9 },
  book: { reading: 0.7, problems: 0.5 },
  note: { problems: 0.4, dialogue: 0.2 },
  notebook: { problems: 0.5 },
  none: {}
}

const LEVEL: Record<NonNullable<StrategySignals['level']>, Partial<Record<Strategy, number>>> = {
  new: { walkthrough: 0.5, reading: 0.4, problems: -0.2 },
  weak: { walkthrough: 0.3, problems: 0.3 },
  shaky: { problems: 0.6 },
  solid: { problems: 0.7, dialogue: 0.5 },
  mastered: { dialogue: 0.8, problems: 0.4 }
}

/** Problem sets are the default way to learn by doing: a small head start */
const PRIOR: Record<Strategy, number> = { problems: 1, dialogue: 0.4, walkthrough: 0.3, code: 0.2, lab: 0, maths: 0.2, reading: 0.1 }

export function chooseStrategy(s: StrategySignals): StrategyChoice {
  const scores = { ...PRIOR }
  const counted: { why: string; weight: number }[] = []
  const apply = (add: Partial<Record<Strategy, number>>, why?: string) => {
    let weight = 0
    for (const [k, v] of Object.entries(add) as [Strategy, number][]) {
      scores[k] += v
      weight = Math.max(weight, v)
    }
    if (why) counted.push({ why, weight })
  }
  const text = `${s.text} ${s.subject ?? ''}`
  for (const r of ASKS) if (r.test.test(s.text)) apply(r.add, r.why)
  for (const r of TOPICS) if (r.test.test(text)) apply(r.add, r.why)
  if (s.source) apply(SOURCE[s.source], s.source === 'design-doc' ? "it comes from your project's design doc" : s.source === 'brief' ? "it is part of something you're building" : undefined)
  if (s.level) apply(LEVEL[s.level], s.level === 'new' ? "it's new to you" : s.level === 'solid' || s.level === 'mastered' ? 'you know it well already' : undefined)

  // What can't happen right now loses most of its weight: a walkthrough still works without a
  // canvas (diagrams in the lesson), the lab and code don't work without their tools
  if (!s.can.lab) scores.lab *= 0.2
  if (!s.can.code) scores.code *= 0.4
  if (!s.can.maths) scores.maths *= 0.6
  if (!s.can.canvas) scores.walkthrough *= 0.85

  const ranked = [...STRATEGIES].sort((a, b) => scores[b] - scores[a])
  const [best, second] = ranked
  const lead = scores[best] - scores[second]
  return {
    strategy: best,
    runnerUp: second,
    confidence: Math.max(0, Math.min(1, lead / 2.5)),
    scores,
    reasons: counted
      .filter((c) => c.weight >= 0.8)
      .sort((a, b) => b.weight - a.weight)
      .map((c) => c.why)
      .slice(0, 3),
    clear: lead >= 1,
    surfaces: { canvas: best === 'walkthrough' && s.can.canvas, lab: best === 'lab' && s.can.lab }
  }
}

/** Saying how you want to go on, mid-lesson: the approach changes to match */
const SWITCH: [RegExp, Strategy][] = [
  [/\b(let'?s|can we|just) (talk|think) (it |this )?through\b|\bjust (talk|discuss)\b|\bless problems\b/i, 'dialogue'],
  [/\b(draw|diagram|map) (it|this) out\b|\bon the canvas\b|\bshow me the flow\b|\bwalk me through\b/i, 'walkthrough'],
  [/\b(give me|more) (some )?(problems|practice|exercises|questions)\b|\bquiz me\b|\btest me\b/i, 'problems'],
  [/\blet me (code|write|implement) it\b|\bi want to (code|write|implement)\b/i, 'code'],
  [/\b(in|use) the (lab|terminal)\b|\blet me (run|try) (it|the commands?)\b/i, 'lab']
]

export function switchFrom(text: string, current: Strategy): Strategy | null {
  for (const [re, to] of SWITCH) if (re.test(text) && to !== current) return to
  return null
}

/** How the tutor should teach in each way: added to the lesson's instructions */
export const STRATEGY_RULES: Record<Strategy, string> = {
  problems: '',
  dialogue:
    "Teach this by thinking it through WITH them, like a design discussion with a senior colleague: pose the real question, let them propose, then probe the weakest part of their answer (why that, what breaks, what it costs, what the alternative is). Add what they miss, one point at a time. Short turns, one question each (use short or explain asks). Give problems only if they ask; correct firmly when they're wrong.",
  walkthrough:
    "Teach this as a walkthrough: trace it step by step like following one real request or record through the system. One step per turn: what happens, which part does it, what it reads or writes, what can fail there. Before each step, ask them to predict it (a predict ask). Draw it on the canvas as you go with canvas_edit: add each component when it first appears and connect them in the order things flow, labelling each connection with what passes along it. Read the canvas first with canvas_read. End with them explaining the whole flow back.",
  code:
    "Teach this by having them write and run code: small, growing tasks (code asks) that each exercise one idea; run their code with run_code on real cases including edge cases before judging it; point at the exact line that fails. Explain only what they need for the next task.",
  lab: 'Teach this hands-on in the Linux lab terminal: give them a command or a small task to do there, read what happened with terminal_read, and explain from the result. Let them type the commands they are learning; only set things up yourself.',
  maths:
    'Teach this by deriving and solving: short explanations, then problems where they show working. Check every algebra or calculus step with run_code (SymPy) before calling it right or wrong, and name the exact step that fails.',
  reading:
    'Guide the reading: point them to the section (with its pages when you have them), ask one question to read for before each part, then check their answer against the text and fill gaps. Keep your own explanations short; the text does the teaching.'
}
