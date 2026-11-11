/**
 * Teaching any subject: what kind of knowledge a subject is, decided once for a roadmap or a
 * lesson's topic, and the teaching toolkit that follows from it.
 *
 * The kinds (a topic may combine two):
 * - build: learnt by making (programming, databases, game development, compilers)
 * - quant: concepts plus calculation (physics, maths, statistics, economics, ML theory)
 * - interpret: texts and arguments (philosophy, literature, theology, law's reasoning)
 * - narrative: facts, causes and chronology (history, geopolitics, biography)
 * - domain: a profession's standards and practice (core banking, accounting, medicine's facts, law's rules)
 * - creative: craft and judgement (game design, writing, music theory, UI design)
 * - physical: a skill the body learns, which an app can't give practice in
 *
 * Deciding is done in code first, from the curated map in subjectMap.ts (the topic, then the
 * roadmap's notebook); only a topic that nothing in the map names is "unclear", and then main
 * asks the stronger model once, with PROFILE_SCHEMA, and keeps the answer (main/subjects).
 *
 * Pure, so the lesson screen, main and the benchmark agree, and it can be tested.
 */
import { simGuide, simKindsFor, simLesson, type SimKind } from './sims'
import { HUMANITIES_RULES, THEOLOGY_RULES, humanitiesArea } from './humanities'
import { SUBJECTS, SUBJECT_KINDS, type Need, type SubjectEntry, type SubjectKind } from './subjectMap'

export type { SubjectKind } from './subjectMap'

export interface SubjectProfile {
  /** One or two kinds, the main one first; empty when unclear */
  kinds: SubjectKind[]
  /** The subjects in the map it was read from */
  subjects: string[]
  /** Where the decision came from */
  from: 'map' | 'notebook' | 'model' | 'unclear'
  /** Data work in the SQL lab suits it */
  lab?: boolean
  /** Teach with the hands-on code and SQL rules */
  hands?: boolean
  sims?: SimKind[]
  needs?: Need[]
  areas?: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()

const COMPILED = SUBJECTS.map((s) => ({ entry: s, res: s.phrases.map((p) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${p})(?![\\p{L}\\p{N}])`, 'iu')) }))

/** Each subject a text names, with the length of the longest phrase that named it, best first */
export function subjectMatches(text: string): { entry: SubjectEntry; score: number; at: number }[] {
  const t = norm(text)
  if (!t) return []
  const out: { entry: SubjectEntry; score: number; at: number }[] = []
  for (const { entry, res } of COMPILED) {
    let best = 0
    let at = 0
    for (const re of res) {
      const m = re.exec(t)
      if (m && m[0].length > best) [best, at] = [m[0].length, m.index]
    }
    if (best) out.push({ entry, score: best, at })
  }
  // The longest phrase wins: "physics in games" over "physics", "history of mathematics" over "mathematics"
  return out.sort((a, b) => b.score - a.score)
}

/** "Build my own X", "X from scratch": a subject made by building it, whatever it is */
const BUILDS = /\b(build|make|write|implement|code|create)\b.{0,40}\b(own|from scratch)\b|\bfrom scratch\b/i

function fromMatches(found: { entry: SubjectEntry; score: number; at: number }[], text: string, from: SubjectProfile['from']): SubjectProfile {
  const [top, ...rest] = found
  const kinds = [...top.entry.kinds]
  const used = [top.entry]
  // A second subject of another kind ("philosophy of physics"): its kind joins, unless its words are
  // part of the first one's ("syntax" in "abstract syntax trees")
  if (kinds.length < 2) {
    const inside = (r: { at: number; score: number }) => r.at >= top.at && r.at + r.score <= top.at + top.score
    const other = rest.find((r) => r.score >= 5 && !kinds.includes(r.entry.kinds[0]) && !inside(r))
    if (other) {
      kinds.push(other.entry.kinds[0])
      used.push(other.entry)
    }
  }
  if (kinds.length < 2 && !kinds.includes('build') && BUILDS.test(text) && !kinds.includes('physical')) kinds.push('build')
  const uniq = <T>(xs: T[]) => [...new Set(xs)]
  const needs = uniq(used.flatMap((u) => u.needs ?? []))
  const areas = uniq(used.flatMap((u) => u.areas ?? []))
  const sims = uniq(used.flatMap((u) => u.sims ?? []))
  return {
    kinds: kinds.slice(0, 2),
    subjects: used.map((u) => u.name),
    from,
    ...(used.some((u) => u.lab) ? { lab: true } : {}),
    ...(used.some((u) => u.hands) || kinds.includes('build') ? { hands: true } : {}),
    ...(sims.length ? { sims } : {}),
    ...(needs.length ? { needs } : {}),
    ...(areas.length ? { areas } : {})
  }
}

/**
 * A subject's profile, in code: from the topic, else from the roadmap (notebook) it sits in.
 * `from: 'unclear'` with no kinds when neither names anything in the map.
 */
export function profileSubject(topic: string, notebook?: string): SubjectProfile {
  const own = subjectMatches(topic)
  if (own.length) return fromMatches(own, topic, 'map')
  const book = notebook ? subjectMatches(notebook.split('/').pop() ?? notebook) : []
  if (book.length) return fromMatches(book, `${topic} ${notebook}`, 'notebook')
  // Nothing named, but "build my own X" or "X from scratch" says how it is learnt
  if (BUILDS.test(topic)) return { kinds: ['build'], subjects: [], from: 'map', hands: true }
  return { kinds: [], subjects: [], from: 'unclear' }
}

export const isUnclear = (p: SubjectProfile) => !p.kinds.length

// ---------- The toolkit for each kind ----------

export interface Toolkit {
  /** What it is, in a few words */
  label: string
  /** Trusted-source areas to prefer (shared/trustedSources) */
  areas: string[]
  /** How it is practised */
  practice: string
  /** How answers are marked */
  assessment: 'verdict' | 'rubric' | 'project tests' | 'verdict and rubric'
  /** The pictures that fit */
  visuals: string
  /** How a lesson is paced */
  pace: string
  /** What the tutor is told, at most about 150 words */
  rules: string
  /** What each roadmap phase ends with, besides the project and the exam */
  phaseWork: string
  /** What the phase's project is, for this kind */
  project: string
}

export const TOOLKITS: Record<SubjectKind, Toolkit> = {
  build: {
    label: 'learnt by building',
    areas: ['Programming languages', 'The web', 'Systems and networking', 'Databases and data engineering', 'Distributed systems'],
    practice: 'code with hidden tests, the SQL lab, small builds that grow',
    assessment: 'project tests',
    visuals: 'mermaid flowcharts, sequence and state diagrams; simulations of the mechanism',
    pace: 'build early',
    rules: `This subject is learnt by building. Within the first few exchanges have them write something small that runs, then grow it one feature at a time, each written and run by them. Mark code by running it against hidden tests, not by reading it, and name the exact line that fails. Before a design choice, ask which trade-off they are making. Draw the structure (modules, data flow, states) as a small mermaid diagram.`,
    phaseWork: '',
    project: 'a working program that proves the phase, with tests'
  },
  quant: {
    label: 'concepts plus calculation',
    areas: ['Mathematics and statistics', 'Physics', 'Chemistry', 'Economics'],
    practice: 'worked problems, exact checks with SymPy, plots and simulations',
    assessment: 'verdict',
    visuals: 'plot simulations, labelled diagrams, real figures from find_image',
    pace: 'worked example first for beginners, then fade the help',
    rules: `This subject is concepts plus calculation. For a beginner, work one example fully before asking them to solve one; then give one half worked; then one on their own. Ask for an estimate, the sign or the units before any calculation. Check every number and algebra step with run_code (Python with SymPy or NumPy) before calling it right or wrong, and give results with units and sensible precision; a missing or wrong unit is a mistake. Mark each answer with a verdict against your worked solution. Show how a quantity behaves with a plot simulation, and a set-up (forces, a circuit, a cycle) as a labelled diagram or a real figure from find_image.`,
    phaseWork: 'Problem set',
    project: 'an applied problem or a derivation carried through and checked, with a short write-up'
  },
  interpret: {
    label: 'texts and arguments',
    areas: ['Philosophy', 'Theology and religious studies', 'Literature', 'General reference', 'History, texts and languages', 'Law'],
    practice: 'close reading, argument reconstruction, short essays',
    assessment: 'rubric',
    visuals: 'argument maps as mermaid flowcharts; a short quotation set out',
    pace: 'read first',
    rules: `This subject is texts and arguments. Read first: put a short passage in front of them (quoted exactly, with author and work) before discussing it, and ask what it says before what it means. Answers must be tied to the words of the text. Set arguments out as numbered premises and a conclusion, then ask which premise is weakest and what the strongest objection is. Give rival readings in their best form; where scholars disagree, say so rather than settling it. Mark what a text says with a verdict; mark an interpretation or argument against a rubric: claim, textual evidence, reasoning, objection. Draw an argument's structure as a mermaid flowchart. No code, no simulations.`,
    phaseWork: 'Essay',
    project: 'an essay arguing a position from the texts read, answering the strongest objection'
  },
  narrative: {
    label: 'facts, causes and chronology',
    areas: ['History', 'History, texts and languages', 'General reference'],
    practice: 'timelines, cause-and-effect questions, primary sources',
    assessment: 'verdict and rubric',
    visuals: 'timelines as a table or a mermaid timeline; maps from find_image',
    pace: 'the story first, then the causes',
    rules: `This subject is facts, causes and chronology. Anchor every event in a date and a place, and build a timeline as the lesson goes (a table of date, event and consequence, or a mermaid timeline). Keep what happened apart from why: ask them to rank causes, and what would have had to differ for another outcome. Bring in a primary source: a short quotation from the time, with who wrote it, when and for whom, and ask what it shows and what its author wanted. Say which claims are established, which are the majority view, which are contested. Show places with a real map from find_image. Mark dates and facts with a verdict, explanations against a rubric.`,
    phaseWork: 'Primary sources',
    project: 'a short source-based essay: a question about the period answered from primary sources'
  },
  domain: {
    label: "a profession's standards and practice",
    areas: ['Finance, payments and blockchains', 'Accounting', 'Law', 'Biology and medicine'],
    practice: 'case studies with a realistic scenario, worked records',
    assessment: 'verdict and rubric',
    visuals: 'sequence diagrams of flows; records as tables that balance',
    pace: 'a case first, then the rule that governs it',
    rules: `This subject is a profession's standards and practice. Teach each rule from the standard, regulation or rulebook that governs it, named with its section and looked up rather than recalled; say the jurisdiction and the year, since rules change. Teach through case studies: a realistic scenario (a customer, an account, a transaction, a patient) with real numbers, asking what the practitioner does next and why. Show a flow (a payment, a settlement, a posting) as a mermaid sequence diagram, and records (ledger or journal entries) as tables that must balance. Mark procedures and figures with a verdict, judgement calls against what the standard requires. Medicine and law: teach, never advise on a real case.`,
    phaseWork: 'Case study',
    project: 'a case study worked end to end against the governing standards'
  },
  creative: {
    label: 'craft and judgement',
    areas: ['Music and design', 'Game development and graphics'],
    practice: 'critique of an example, small making exercises',
    assessment: 'rubric',
    visuals: 'side-by-side examples; notation; screens and layouts described exactly',
    pace: 'examples first, then the principle',
    rules: `This subject is craft and judgement. Learn from examples: show a strong and a weak one side by side (a level, a melody, a paragraph, a screen) and ask what makes the difference before naming the principle. Then set a small exercise to make something, and critique it against a short rubric of named criteria (its goal, clarity, use of the constraint, effect on the audience): one strength and one change at a time. Argue taste from principles and evidence of effect, never assert it. What can't be shown here (sound, motion) is described exactly, written in notation, or pointed to in a real example.`,
    phaseWork: 'Critique',
    project: 'a finished piece made to a brief, with a self-critique against the rubric'
  },
  physical: {
    label: 'a physical skill',
    areas: ['General reference'],
    practice: 'a practice plan with drills, done away from the app',
    assessment: 'rubric',
    visuals: 'real photos or figures from find_image; a drill plan as a table',
    pace: 'theory in short pieces, practice between lessons',
    rules: `This is a physical skill, which can't be practised in an app: say so once, plainly. Teach the theory that makes practice better: the mechanics, the common faults and what causes them, how to judge progress. Check understanding with questions on technique and on diagnosing a described fault. End with a practice plan as a table: specific drills, how long, how often, what to record or film, and how to tell it is working. Put safety first where it matters.`,
    phaseWork: 'Practice log',
    project: 'a recorded performance or test of the skill, judged against the plan’s checkpoints'
  }
}

export const toolkitFor = (p: SubjectProfile): Toolkit[] => p.kinds.map((k) => TOOLKITS[k])

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-/]*/gu) ?? []).length

/** The kinds whose lessons use simulations at all */
const SIM_KINDS_OK: SubjectKind[] = ['build', 'quant', 'domain']

/** What a lesson is told for its subject, beside the rules every lesson gets */
export interface LessonKit {
  /** Include the hands-on code and SQL rules (session.HANDS_ON) */
  handsOn: boolean
  /** The simulation guide for the kinds this lesson can use, or '' */
  sims: string
  /** The toolkit's own rules, short */
  toolkit: string
  /** The humanities' marking (<appraise>) and, for religion, theology's rules (shared/humanities), or '' */
  humanities: string
}

/** The SQL lab, briefly, for a subject that works with data but isn't taught hands-on */
const LAB_LINE = 'Real data suits this: query the lab with run_sql (the shop and product-analytics tables, or their own .csv after load_table), show each query as a ```sql block, and draw results with a ```chart block of JSON {"sql": "...", "type": "line"}.'

/** Where to read from, for a source-led reading or a look-up: the trusted areas for its kinds */
export function preferredAreas(p: SubjectProfile): string[] {
  return [...new Set([...(p.areas ?? []), ...p.kinds.flatMap((k) => TOOLKITS[k].areas)])]
}

/**
 * The hook in session.sessionInstructions: for a lesson on `topic`, which of the rules apply.
 * An unclear topic keeps the rules every lesson had before (hands-on and the simulations its
 * topic names), so nothing is lost while main asks the model what it is.
 */
export function lessonKit(topic: string, profile?: SubjectProfile, notebook?: string): LessonKit {
  const p = profile ?? profileSubject(topic, notebook)
  if (isUnclear(p)) return { handsOn: true, sims: simLesson(topic), toolkit: '', humanities: humanitiesText(topic, p) }
  const simsOk = p.kinds.some((k) => SIM_KINDS_OK.includes(k))
  const kinds = simsOk ? [...new Set([...simKindsFor(topic), ...(p.kinds.includes('quant') || p.kinds.includes('build') ? (p.sims ?? []) : [])])] : []
  const sims = kinds.length ? `A live simulation fits this topic (${kinds.join(', ')}). Use one rather than a diagram where it shows the idea running, with a short tour pointing at what to look at, then ask them to change one thing and predict what happens.\n${simGuide(kinds)}` : ''
  const handsOn = !!p.hands
  const parts = p.kinds.map((k) => TOOLKITS[k].rules)
  if (p.lab && !handsOn) parts.push(LAB_LINE)
  return { handsOn, sims, toolkit: parts.length ? `How to teach this subject (${p.kinds.map((k) => TOOLKITS[k].label).join('; ')}):\n${parts.join('\n')}` : '', humanities: humanitiesText(topic, p) }
}

/**
 * Whether a lesson is taught and marked as the humanities are (shared/humanities): readings and
 * arguments appraised with <appraise>, facts and dates marked. Decided by the profile: a subject
 * whose main kind is texts and arguments (interpret) or facts, causes and chronology (narrative).
 * A second kind doesn't make it so ("NULL and three-valued logic" is quant+interpret, contract law
 * domain+interpret): build, quant and domain subjects keep their verdicts. An unclear topic falls
 * back to the humanities' own word list, so a book's title ("Augustine, Confessions") still counts.
 */
export function teachesAsHumanities(topic: string, profile?: SubjectProfile, notebook?: string): boolean {
  const p = profile ?? profileSubject(topic, notebook)
  if (isUnclear(p)) return !!humanitiesArea(topic)
  return p.kinds[0] === 'interpret' || p.kinds[0] === 'narrative'
}

/** Religion is described in each tradition's own terms: by the map's subject, or the humanities' word list */
const isTheology = (topic: string, p: SubjectProfile) => p.subjects.includes('theology and religion') || humanitiesArea(topic) === 'theology'

/** The humanities rules a lesson on this topic gets through the subject hook, or '' */
function humanitiesText(topic: string, p: SubjectProfile): string {
  if (!teachesAsHumanities(topic, p)) return ''
  return isTheology(topic, p) ? `${HUMANITIES_RULES}\n\n${THEOLOGY_RULES}` : HUMANITIES_RULES
}

/** The toolkit's text for a profile decided outside the lesson's instructions (main, for an unclear topic) */
export const toolkitText = (topic: string, p: SubjectProfile, opts: { humanities?: boolean } = {}) => {
  const kit = lessonKit(topic, p)
  return [kit.toolkit, kit.sims, opts.humanities === false ? '' : kit.humanities].filter(Boolean).join('\n\n')
}

// ---------- Roadmaps ----------

/**
 * What the roadmap builder is told for a subject: how its phases are practised and what each
 * ends with. BUILD gets projects; QUANT problem sets; INTERPRET readings and essays; DOMAIN case
 * studies and the governing standards; NARRATIVE periods and primary sources.
 */
export function roadmapGuidance(p: SubjectProfile): string {
  if (isUnclear(p)) return ''
  const k = p.kinds
  const lines = [`This subject is ${k.map((x) => TOOLKITS[x].label).join(' and ')}.`]
  if (k.includes('build')) lines.push('Have them build from the first phase; every phase ends in a project they build, with tests that prove it works.')
  if (k.includes('quant')) lines.push('Every phase has a problem set of graded problems (worked examples first, then unaided ones), with answers checked exactly.')
  if (k.includes('interpret')) lines.push('Organise phases around the key texts, read in full where they are short; every phase has readings to discuss and ends in an essay.')
  if (k.includes('narrative')) lines.push('Organise phases by period or theme in chronological order, each with its primary sources to read and a timeline to build.')
  if (k.includes('domain')) lines.push('Name the governing standards, regulations or rulebooks for each phase and teach from them; every phase has a realistic case study.')
  if (k.includes('creative')) lines.push('Every phase studies strong examples, makes something small, and ends in a critique against a rubric.')
  if (k.includes('physical')) lines.push('This is practised away from the app: every phase has a weekly practice plan of drills with checkpoints, and the theory that makes practice better.')
  return lines.join(' ')
}

const PHASE_WORK: Record<string, string> = {
  'Problem set': 'graded problems on this phase, worked examples first',
  Essay: "an argued essay on this phase's texts",
  'Primary sources': "reading this period's primary sources and building its timeline",
  'Case study': 'a realistic case worked against the governing standard',
  Critique: 'critiquing strong and weak examples, then a small piece of your own',
  'Practice log': 'the weekly drills, logged with checkpoints'
}

/** The line each roadmap phase ends with before its project, for the outline writer; '' for none */
export function phaseWorkLine(p: SubjectProfile): string {
  const work = p.kinds.map((k) => TOOLKITS[k].phaseWork).find(Boolean)
  // A "Practice:" line, so the roadmap's parser (plan.phasesForTasks) and Things treat it as the phase's practice
  return work ? `- [ ] Practice: ${work}, ${PHASE_WORK[work] ?? 'specific to the phase'}` : ''
}

/** What a phase's project is, for this subject */
export const projectKind = (p: SubjectProfile) => (isUnclear(p) ? '' : TOOLKITS[p.kinds[0]].project)

// ---------- Asking the model, when the map can't tell ----------

/** The strict shape the model must answer in (also given to it as the schema) */
export const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kinds', 'lab', 'needs'],
  properties: {
    kinds: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: SUBJECT_KINDS } },
    lab: { type: 'boolean', description: 'Working with real data in SQL helps learn it' },
    needs: { type: 'array', items: { enum: ['wet-lab', 'body', 'instrument', 'live-data', 'hardware', 'engine', 'gpu', 'clinic'] } }
  }
} as const

export const PROFILE_SYSTEM = `You classify a subject someone wants to learn by the kind of knowledge it is. Kinds:
- build: learnt by making things (programming, databases, game development, compilers)
- quant: concepts plus calculation (physics, maths, statistics, economics, ML theory)
- interpret: texts and arguments (philosophy, literature, theology, legal reasoning)
- narrative: facts, causes and chronology (history, geopolitics, biography)
- domain: a profession's standards and practice (banking, accounting, payments, medicine's facts, law's rules)
- creative: craft and judgement (game design, writing, music theory, UI design)
- physical: a skill the body must practise (a sport, an instrument, a craft)
Give one kind, or two when it truly combines them, main kind first. Reply with ONLY a JSON object matching this JSON schema, nothing else:
${JSON.stringify(PROFILE_SCHEMA)}`

export const profilePrompt = (topic: string, notebook?: string) => `Subject: ${topic}${notebook && notebook !== topic ? `\nPart of a study roadmap on: ${notebook}` : ''}`

const NEEDS = PROFILE_SCHEMA.properties.needs.items.enum as readonly string[]

/** The model's answer, held strictly to the schema: anything else is null */
export function parseModelProfile(text: string): SubjectProfile | null {
  const body = text.replace(/```(?:json)?/g, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some((k) => !['kinds', 'lab', 'needs'].includes(k))) return null
  if (!Array.isArray(o.kinds) || o.kinds.length < 1 || o.kinds.length > 2 || new Set(o.kinds).size !== o.kinds.length) return null
  if (!o.kinds.every((k) => (SUBJECT_KINDS as string[]).includes(k as string))) return null
  if (typeof o.lab !== 'boolean' || !Array.isArray(o.needs) || !o.needs.every((n) => NEEDS.includes(n as string))) return null
  const kinds = o.kinds as SubjectKind[]
  return {
    kinds,
    subjects: [],
    from: 'model',
    ...(o.lab ? { lab: true } : {}),
    ...(kinds.includes('build') ? { hands: true } : {}),
    ...(o.needs.length ? { needs: o.needs as Need[] } : {})
  }
}

/** A profile as kept with a roadmap (front matter) or in the cache: just what decides teaching */
export const profileKey = (topic: string) => norm(topic).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

/** Front matter value for a roadmap: "build, quant" */
export const kindsValue = (p: SubjectProfile) => p.kinds.join(', ')

/** Reads `subject_kinds: build, quant` back */
export function kindsFrom(value: string | undefined): SubjectKind[] {
  return (value ?? '')
    .split(/[,\s[\]]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k): k is SubjectKind => (SUBJECT_KINDS as string[]).includes(k))
    .slice(0, 2)
}
