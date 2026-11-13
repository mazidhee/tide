/**
 * Dated milestones North Star plans with ("interview-ready by September 2027"), beside its
 * foundation-first stages rather than instead of them. Pure rules; main/northStar reads the goal
 * note, gathers the evidence and keeps the record in .tide/northstar.json.
 *
 * - A milestone is parsed from the goal note's "## Milestone: …" section: its date, roles, scope
 *   (the topics and skills in the bar), languages and hours (`parseMilestones`).
 * - Readiness is one number with a band, from what Tide already measures: the Sharpness algorithms
 *   rating against "LeetCode-medium in about 25 min" and the pass rate on unseen mediums, mocks and
 *   company rounds, learner-model depth on the C++ interview checklist, an OS and concurrency gate,
 *   and the capstone (`readinessOf`). The projection to the date is a straight line through the
 *   recent readings, said as an estimate (`projectReadiness`).
 * - The scheduler rule: every thread's weekly value is long-term value (fan-out times stage weight)
 *   plus deadline value (gap to the bar times urgency), only for what the milestone's scope covers
 *   (`threadValues`, `valueThreads`). Urgency rises as the date nears and when the projection is
 *   behind, and falls when it's ahead (`urgencyOf`). Floors keep maths at 15% of the week and every
 *   parked track's reviews alive (`parkThreads`). Languages are topics like any other: no order
 *   between them is written here; the value rule and the roadmaps' prerequisites order them.
 * - Hours: plan to the realistic day; longer days are bonus that pull the next items forward.
 */
import { addDays, daysBetween, type Thread } from './portfolio'
import { expected } from './workout'

// ---------- The scope catalogue ----------

export type ScopeId = 'dsa' | 'cpp' | 'os' | 'networking' | 'design' | 'probability' | 'sql' | 'behavioural'

/** Where a scope item's time goes: a roadmap track (with the headings it wants), or practice and mocks */
export type Channel = { kind: 'roadmap'; track: RegExp; headings: RegExp; share: number } | { kind: 'practice'; ref: 'algorithms' | 'quant' | 'design'; share: number } | { kind: 'mock'; ref: 'behavioural' | 'coding'; share: number }

export interface ScopeDef {
  id: ScopeId
  label: string
  /** Words in the note's bar that name it */
  detect: RegExp
  /** How much of the bar it is */
  weight: number
  channels: Channel[]
  /** Concept names it covers, for depth and for a topic's value */
  topic: RegExp
  /** Only planned within this many weeks of the ready-by date (mocks and design come late) */
  within?: number
}

export const SCOPE: ScopeDef[] = [
  {
    id: 'dsa',
    label: 'Algorithms',
    detect: /leetcode|algorithm|data structure|\bdsa\b/i,
    weight: 4,
    channels: [
      { kind: 'practice', ref: 'algorithms', share: 0.6 },
      { kind: 'roadmap', track: /^software eng/i, headings: /data structures?\s*(&|and)\s*algorithms/i, share: 0.4 }
    ],
    topic: /algorithm|data structure|sorting|binary search|graph|tree|heap|hash|dynamic programming|recursion|big-?o|two pointers|sliding window/i
  },
  {
    id: 'cpp',
    label: 'C++',
    detect: /c\+\+/i,
    weight: 2.5,
    channels: [{ kind: 'roadmap', track: /^c\+\+$/i, headings: /^(\d+\.\s*)?(the language core|memory and object lifetime|templates and the standard library)/i, share: 1 }],
    topic: /c\+\+|raii|pointer|smart pointer|move semantic|template|\bstl\b|unique_ptr|shared_ptr|undefined behaviou?r|destructor|constructor/i
  },
  {
    id: 'os',
    label: 'OS and concurrency',
    detect: /\bos\b|operating system|concurren/i,
    weight: 2,
    channels: [
      { kind: 'roadmap', track: /^software eng/i, headings: /operating systems|concurrency\s*(&|and)\s*parallelism/i, share: 0.7 },
      { kind: 'roadmap', track: /^c\+\+$/i, headings: /concurrency and systems/i, share: 0.3 }
    ],
    topic: /operating system|process|thread|virtual memory|paging|scheduling|mutex|lock|deadlock|concurren|atomic|syscall|system call|context switch/i
  },
  {
    id: 'networking',
    label: 'Networking',
    detect: /network/i,
    weight: 1.5,
    channels: [
      { kind: 'roadmap', track: /^software eng/i, headings: /^(\d+\.\s*)?networking/i, share: 0.7 },
      { kind: 'roadmap', track: /^backend/i, headings: /network|http/i, share: 0.3 }
    ],
    topic: /network|\btcp\b|\budp\b|\bhttp|\bdns\b|socket|\btls\b/i
  },
  {
    id: 'design',
    label: 'System design',
    detect: /system design/i,
    weight: 1,
    channels: [{ kind: 'practice', ref: 'design', share: 1 }],
    topic: /system design|scalab|caching|load balanc|sharding|replication/i,
    within: 24
  },
  {
    id: 'probability',
    label: 'Probability',
    detect: /probab|brainteaser|quant round/i,
    weight: 1,
    channels: [
      { kind: 'practice', ref: 'quant', share: 0.5 },
      { kind: 'roadmap', track: /^math/i, headings: /probability and statistics/i, share: 0.5 }
    ],
    topic: /probab|expectation|bayes|random variable|combinator|brainteaser/i
  },
  {
    id: 'sql',
    label: 'SQL',
    detect: /\bsql\b|data skills?/i,
    weight: 1,
    channels: [{ kind: 'roadmap', track: /^data eng/i, headings: /storage and sql|sql in depth/i, share: 1 }],
    topic: /\bsql\b|\bjoins?\b|window function|query plan|\bindex(es)?\b/i
  },
  {
    id: 'behavioural',
    label: 'Behavioural',
    detect: /behaviou?ral|stories/i,
    weight: 0.5,
    channels: [{ kind: 'mock', ref: 'behavioural', share: 1 }],
    topic: /behaviou?ral|star stor/i,
    within: 16
  }
]

export const scopeDef = (id: string) => SCOPE.find((s) => s.id === id)

// ---------- The milestone ----------

export interface ScopeItem {
  id: ScopeId
  label: string
  weight: number
}

export interface Milestone {
  id: string
  /** "Interview-ready by September 2027" */
  title: string
  /** The date it's for (yyyy-mm-dd) */
  date: string
  /** The bar should be met by about seven weeks before the date, so the season is spent sharp, not cramming */
  readyBy: string
  roles: string[]
  scope: ScopeItem[]
  /** The languages the note names, and which it says are known or new: data for the prompt, never an order */
  languages: { main: string[]; known: string[]; fromScratch: string[] }
  /** Hours a day: what's realistic, and what happens on a good day */
  hours?: { low: number; high: number; upLow?: number; upHigh?: number }
  /** The readiness that counts as ready, 0–100 */
  bar: number
}

/** Weeks before the date the bar should be met by */
export const READY_WEEKS = 7
export const BAR = 75

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "September 2027", "30 June 2027", "2027-09-01": the date it names (a month alone is its first day) */
export function parseWhen(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]
  const m = text.match(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i)
  if (!m) return null
  const month = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1
  const day = Math.min(28, Number(m[1] ?? 1)) || 1
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "4–5 a day realistically, often 6–7": the realistic range and the good days */
export function parseHours(text: string): Milestone['hours'] | undefined {
  const ranges = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:[–-]|to)\s*(\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  const single = text.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/i)
  if (!ranges.length && !single) return undefined
  const [low, high] = ranges[0] ?? [Number(single![1]), Number(single![1])]
  if (!(low > 0 && high >= low && high <= 16)) return undefined
  const up = ranges[1]
  return { low, high, ...(up && up[0] >= high ? { upLow: up[0], upHigh: up[1] } : {}) }
}

const field = (lines: string[], name: RegExp) => {
  const l = lines.find((x) => name.test(x.replace(/\*\*/g, '')))
  return l ? l.replace(/\*\*/g, '').replace(/^\s*[-*+]\s*/, '').replace(name, '').replace(/^\s*:?\s*/, '').trim() : ''
}

const splitList = (s: string) =>
  s
    .replace(/\(.*?\)/g, '')
    .split(/;|,(?![^(]*\))/)
    .map((x) => x.replace(/\.$/, '').trim())
    .filter(Boolean)

const LANGS = ['C++', 'Python', 'Rust', 'Go', 'Java', 'TypeScript', 'C']
const langsIn = (s: string) => LANGS.filter((l) => new RegExp(`(^|[^\\w+])${l.replace(/\+/g, '\\+')}(?![\\w+])`, 'i').test(s))

/**
 * Every "## Milestone: …" section of the goal note, as data. The heading names it and its date
 * ("interview-ready by September 2027"); bullets give the roles, the bar (its scope), the
 * languages and the hours. A section with no date it can read is skipped.
 */
export function parseMilestones(note: string): Milestone[] {
  const out: Milestone[] = []
  const parts = note.replace(/\r\n/g, '\n').split(/^(?=##\s)/m)
  for (const part of parts) {
    const head = part.match(/^##\s+milestone\s*[:—–-]\s*(.+)$/im)
    if (!head) continue
    const title = head[1].trim()
    const lines = part.split('\n').slice(1)
    const body = lines.join('\n')
    const date = parseWhen(title) ?? parseWhen(field(lines, /^\s*[-*+]?\s*(date|by|interviews? run until)\b/i)) ?? parseWhen(body)
    if (!date) continue
    const roles = splitList(field(lines, /^\s*[-*+]?\s*roles?\b/i)).map((r) => r.replace(/^(and|or)\s+/i, ''))
    const bar = field(lines, /^\s*[-*+]?\s*what the bar means\b/i) || field(lines, /^\s*[-*+]?\s*(the )?bar\b/i) || body
    const scope: ScopeItem[] = SCOPE.filter((s) => s.detect.test(bar)).map((s) => ({ id: s.id, label: s.label, weight: s.weight }))
    const langText = field(lines, /^\s*[-*+]?\s*languages?\b/i)
    const sentences = langText.split(/[.;]/)
    const languages = {
      main: langsIn(sentences[0] ?? ''),
      known: sentences.filter((s) => /\bknow\b/i.test(s) && !/scratch/i.test(s)).flatMap(langsIn),
      fromScratch: sentences.filter((s) => /scratch|from zero|new to/i.test(s)).flatMap(langsIn)
    }
    const hours = parseHours(field(lines, /^\s*[-*+]?\s*hours?\b/i))
    const id = `ms-${date}`
    out.push({ id, title: title.replace(/^./, (c) => c.toUpperCase()), date, readyBy: addDays(date, -READY_WEEKS * 7), roles, scope, languages, ...(hours ? { hours } : {}), bar: BAR })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** The milestone in force: the first whose date hasn't passed */
export const activeMilestone = (ms: Milestone[] | undefined, today: string) => (ms ?? []).find((m) => m.date >= today) ?? null

/** For prompts: the milestone in a few lines */
export function milestoneText(m: Milestone, today: string): string {
  const weeks = Math.round(daysBetween(today, m.readyBy) / 7)
  return [
    `- ${m.title}: the date is ${m.date}; the bar should be met by ${m.readyBy} (about ${weeks} weeks from now).`,
    m.roles.length ? `- Roles: ${m.roles.join('; ')}.` : '',
    m.scope.length ? `- In the interview bar: ${m.scope.map((s) => s.label).join(', ')}.` : '',
    m.languages.main.length ? `- Languages: ${m.languages.main.join(', ')}${m.languages.known.length ? `; knows ${m.languages.known.join(', ')}` : ''}${m.languages.fromScratch.length ? `; ${m.languages.fromScratch.join(', ')} from scratch` : ''}.` : '',
    m.hours ? `- Hours: ${m.hours.low}–${m.hours.high} a day realistically${m.hours.upLow ? `, ${m.hours.upLow}–${m.hours.upHigh} on good days` : ''}.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------- Checklists: the C++ interview checklist and the OS and concurrency gate ----------

export interface CheckRow {
  id: string
  label: string
  match: RegExp
}

export const CPP_CHECKLIST: CheckRow[] = [
  { id: 'pointers', label: 'Pointers and references', match: /pointer|reference/i },
  { id: 'lifetime', label: 'Stack, heap and lifetime', match: /stack|heap|lifetime|storage duration/i },
  { id: 'classes', label: 'Classes, constructors, destructors', match: /class|constructor|destructor/i },
  { id: 'stl', label: 'STL containers and iterators', match: /\bstl\b|container|vector|iterator|standard library/i },
  { id: 'const', label: 'const and references', match: /\bconst\b|const correctness/i },
  { id: 'raii', label: 'RAII', match: /raii|resource acquisition/i },
  { id: 'smart', label: 'unique_ptr and shared_ptr', match: /unique_ptr|shared_ptr|smart pointer/i },
  { id: 'move', label: 'Move semantics', match: /move semantic|rvalue|std::move/i },
  { id: 'rule5', label: 'Rule of zero, three, five', match: /rule of (zero|three|five|0|3|5)|copy (constructor|assignment)/i },
  { id: 'templates', label: 'Templates', match: /template|generic programming/i },
  { id: 'virtual', label: 'Virtual functions and vtables', match: /virtual|polymorphism|vtable/i },
  { id: 'ub', label: 'Undefined behaviour', match: /undefined behaviou?r|sanitizer/i },
  { id: 'threads', label: 'Threads, mutexes, atomics', match: /thread|mutex|atomic|memory model/i }
]

export const OS_CHECKLIST: CheckRow[] = [
  { id: 'proc', label: 'Processes and threads', match: /process|fork|exec|\bthreads?\b/i },
  { id: 'vm', label: 'Virtual memory and paging', match: /virtual memory|paging|\btlb\b|page table/i },
  { id: 'sched', label: 'Scheduling, context switches', match: /schedul|context switch/i },
  { id: 'syscall', label: 'System calls and the kernel', match: /system call|syscall|kernel/i },
  { id: 'locks', label: 'Locks and condition variables', match: /mutex|\blocks?\b|condition variable|semaphore/i },
  { id: 'deadlock', label: 'Deadlocks and races', match: /deadlock|race condition|data race/i },
  { id: 'atomics', label: 'Atomics and the memory model', match: /atomic|memory model|memory order/i }
]

/** The depth needed: C++ to explain and apply (4), the OS gate to apply (3) */
export const CPP_DEPTH = 4
export const OS_DEPTH = 3

export interface CheckState {
  id: string
  label: string
  depth: number
  target: number
}

/** Each row's depth: the deepest concept that matches it (in the right area, where one is given) */
export function checklistDepths(rows: CheckRow[], concepts: { name: string; area?: string; depth?: number }[], target: number, area?: RegExp): CheckState[] {
  return rows.map((r) => {
    const hits = concepts.filter((c) => r.match.test(c.name) && (!area || area.test(c.area ?? '') || area.test(c.name)))
    return { id: r.id, label: r.label, depth: Math.max(0, ...hits.map((c) => c.depth ?? 0)), target }
  })
}

/** The OS and concurrency gate: every row at apply */
export const osGate = (os: CheckState[]) => os.length > 0 && os.every((r) => r.depth >= r.target)

// ---------- Readiness ----------

export interface ReadinessInput {
  now: number
  /** Sharpness algorithms: rating and band, rated attempts, and first attempts at medium difficulty */
  algo: { rating: number; band: number; attempts: number; mediums: { solved: boolean; at: number }[] }
  /** Mocks and company rounds: kind, score 0–1, when */
  mocks: { kind: string; score: number; at: number }[]
  cpp: CheckState[]
  os: CheckState[]
  capstone: 'none' | 'started' | 'done'
}

export interface ReadinessPart {
  id: 'algorithms' | 'mocks' | 'cpp' | 'os' | 'capstone'
  label: string
  /** 0–1 */
  value: number
  /** ± 0–1 */
  spread: number
  weight: number
  /** A few words: "1180 · 2/5 mediums" */
  detail: string
}

export interface Readiness {
  /** 0–100 */
  value: number
  low: number
  high: number
  parts: ReadinessPart[]
  /** How far each scope item is from the bar, 0 (met) to 1 */
  gaps: Partial<Record<ScopeId, number>>
}

/** The medium bar, as Sharpness states it */
export const MEDIUM = 1300
export const MEDIUM_BAND: [number, number] = [1150, 1450]

const WEIGHTS: Record<ReadinessPart['id'], number> = { algorithms: 0.35, cpp: 0.2, os: 0.15, mocks: 0.2, capstone: 0.1 }
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * One readiness number with a band. Algorithms: the chance of a medium in about 25 minutes from the
 * rating, averaged with the pass rate on the last unseen mediums once there are three. Mocks: the
 * latest of each kind (coding, design, quant, behavioural), and wide until there are some. C++:
 * depth against 4 on the checklist. OS: the gate's rows against 3. Capstone: none, started, built.
 */
export function readinessOf(i: ReadinessInput): Readiness {
  const chance = expected(i.algo.rating, MEDIUM)
  const chanceLo = expected(i.algo.rating - i.algo.band, MEDIUM)
  const chanceHi = expected(i.algo.rating + i.algo.band, MEDIUM)
  const last = [...i.algo.mediums].sort((a, b) => b.at - a.at).slice(0, 10)
  const pass = last.length ? last.filter((m) => m.solved).length / last.length : null
  const algo = pass !== null && last.length >= 3 ? (chance + pass) / 2 : chance
  const algoSpread = Math.max(0.05, (chanceHi - chanceLo) / 2) * (pass !== null && last.length >= 3 ? 0.7 : 1)
  const latest = new Map<string, { score: number; at: number }>()
  for (const m of i.mocks) if (!latest.has(m.kind) || latest.get(m.kind)!.at < m.at) latest.set(m.kind, m)
  const mockVals = [...latest.values()].map((m) => clamp01(m.score))
  const mocks = mean(mockVals)
  const cpp = mean(i.cpp.map((r) => clamp01(r.depth / r.target)))
  const os = mean(i.os.map((r) => clamp01(r.depth / r.target)))
  const cap = i.capstone === 'done' ? 1 : i.capstone === 'started' ? 0.4 : 0
  const parts: ReadinessPart[] = [
    { id: 'algorithms', label: 'Algorithms', value: algo, spread: algoSpread, weight: WEIGHTS.algorithms, detail: `${Math.round(i.algo.rating)}${last.length ? ` · ${last.filter((m) => m.solved).length}/${last.length} mediums` : ''}` },
    { id: 'mocks', label: 'Mocks', value: mocks, spread: mockVals.length ? 0.25 / Math.sqrt(mockVals.length) : 0.3, weight: WEIGHTS.mocks, detail: mockVals.length ? `${mockVals.length} kind${mockVals.length === 1 ? '' : 's'}` : 'none yet' },
    { id: 'cpp', label: 'C++', value: cpp, spread: 0.08, weight: WEIGHTS.cpp, detail: `${i.cpp.filter((r) => r.depth >= r.target).length}/${i.cpp.length} at depth ${CPP_DEPTH}` },
    { id: 'os', label: 'OS and concurrency', value: os, spread: 0.08, weight: WEIGHTS.os, detail: `${i.os.filter((r) => r.depth >= r.target).length}/${i.os.length} at depth ${OS_DEPTH}` },
    { id: 'capstone', label: 'Capstone', value: cap, spread: 0, weight: WEIGHTS.capstone, detail: i.capstone === 'none' ? 'not started' : i.capstone }
  ]
  const value = parts.reduce((n, p) => n + p.value * p.weight, 0) * 100
  const spread = Math.sqrt(parts.reduce((n, p) => n + (p.spread * p.weight) ** 2, 0)) * 100
  const v = Math.round(value)
  const gaps: Readiness['gaps'] = {
    dsa: 1 - algo,
    cpp: 1 - cpp,
    os: 1 - os,
    // What's not measured directly: the mocks of that kind, else half way
    networking: 1 - os * 0.5,
    design: 1 - (latest.get('design')?.score ?? 0.1),
    probability: 1 - (latest.get('quant')?.score ?? 0.15),
    sql: 0.85,
    behavioural: 1 - (latest.get('behavioural')?.score ?? 0)
  }
  return { value: v, low: Math.max(0, Math.round(value - spread)), high: Math.min(100, Math.round(value + spread)), parts, gaps }
}

// ---------- Projection ----------

export interface ReadingPoint {
  date: string
  value: number
}

export interface Projection {
  now: number
  /** Points a week, from the recent readings (null until there are enough) */
  slope: number | null
  /** At the ready-by date, if the line holds (an estimate) */
  projected: number | null
  /** Points a week needed to meet the bar by the ready-by date */
  need: number
  weeksLeft: number
  status: 'ahead' | 'on' | 'behind' | 'unknown'
  /** Change over the last four weeks, for the trend arrow */
  trend: number | null
}

/**
 * A straight line through the last eight weeks of readings (least squares, at least three readings
 * across ten days), carried to the ready-by date. Ahead: five points past the bar; behind: more than
 * three short. Until there's a line, the reading is compared with the straight path from the first
 * reading to the bar, so a plan that starts behind says so.
 */
export function projectReadiness(history: ReadingPoint[], today: string, readyBy: string, bar = BAR): Projection {
  const pts = [...history].filter((p) => p.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const now = pts.length ? pts[pts.length - 1].value : 0
  const weeksLeft = Math.max(0, daysBetween(today, readyBy) / 7)
  const need = weeksLeft > 0 ? Math.max(0, (bar - now) / weeksLeft) : Math.max(0, bar - now)
  const recent = pts.filter((p) => daysBetween(p.date, today) <= 56)
  const span = recent.length ? daysBetween(recent[0].date, recent[recent.length - 1].date) : 0
  const ago = pts.filter((p) => daysBetween(p.date, today) >= 28).pop() ?? (span >= 7 ? recent[0] : undefined)
  const trend = ago ? Math.round(now - ago.value) : null
  let slope: number | null = null
  if (recent.length >= 3 && span >= 10) {
    const xs = recent.map((p) => daysBetween(recent[0].date, p.date) / 7)
    const ys = recent.map((p) => p.value)
    const mx = mean(xs)
    const my = mean(ys)
    const sxx = xs.reduce((n, x) => n + (x - mx) ** 2, 0)
    slope = sxx > 0 ? xs.reduce((n, x, k) => n + (x - mx) * (ys[k] - my), 0) / sxx : 0
  }
  if (slope !== null) {
    const projected = Math.max(0, Math.min(100, Math.round(now + slope * weeksLeft)))
    return { now, slope: Math.round(slope * 10) / 10, projected, need: Math.round(need * 10) / 10, weeksLeft, status: projected >= bar + 5 ? 'ahead' : projected >= bar - 3 ? 'on' : 'behind', trend }
  }
  // No line yet: against the straight path from the first reading to the bar
  const first = pts[0]
  if (!first || pts.length < 2) return { now, slope: null, projected: null, need: Math.round(need * 10) / 10, weeksLeft, status: 'unknown', trend }
  const total = daysBetween(first.date, readyBy)
  const expectedNow = total > 0 ? first.value + ((bar - first.value) * daysBetween(first.date, today)) / total : bar
  return { now, slope: null, projected: null, need: Math.round(need * 10) / 10, weeksLeft, status: now >= expectedNow + 5 ? 'ahead' : now >= expectedNow - 3 ? 'on' : 'behind', trend }
}

/** Adds today's reading (one a day, the latest wins), keeping a year */
export function addReading(history: ReadingPoint[], p: ReadingPoint): ReadingPoint[] {
  return [...history.filter((x) => x.date !== p.date), p].sort((a, b) => a.date.localeCompare(b.date)).slice(-366)
}

// ---------- Urgency and value ----------

/**
 * How hard the date pulls: 2 × time × pace. Time rises from about a half a year out to 1 at the
 * ready-by date; pace is 1 on the trajectory, up to 2.5 when the projection falls short of the bar,
 * down to 0.4 when it's well past it (the hours go back to the long term).
 */
export function urgencyOf(p: Pick<Projection, 'weeksLeft' | 'projected' | 'status' | 'now'>, bar = BAR): number {
  const time = 1 / (1 + Math.max(0, p.weeksLeft) / 40)
  let pace = 1
  if (p.projected !== null) {
    const d = (bar - p.projected) / bar
    pace = d > 0 ? 1 + Math.min(1.5, d * 3) : Math.max(0.4, 1 + d * 2)
  } else if (p.status === 'behind') pace = 1.5
  else if (p.status === 'ahead') pace = 0.7
  return Math.round(2 * time * pace * 1000) / 1000
}

export interface StageLite {
  n: number
  tracks: { track: string; weight: number }[]
}

/**
 * Long-term value of a track: its weight in the current stage (or in its next stage, discounted
 * by how far away that is) times its fan-out: how many later stages build on it.
 */
export function longTermOf(track: string, stages: StageLite[], current: number): number {
  const at = stages.findIndex((s) => s.n === current)
  const ahead = stages.slice(Math.max(0, at))
  const key = track.toLowerCase()
  const uses = ahead.map((s, i) => ({ i, w: s.tracks.find((t) => t.track.toLowerCase() === key)?.weight ?? 0 })).filter((x) => x.w > 0)
  if (!uses.length) return 0
  const first = uses[0]
  const stageWeight = (first.w / 100) * 0.75 ** first.i
  const fanOut = uses.length - 1
  return stageWeight * (1 + fanOut / 4)
}

export interface ValueRow {
  id: string
  longTerm: number
  deadline: number
  /** The scope items behind its deadline value */
  scope: ScopeId[]
}

/** Which thread a channel is: a roadmap by its track, practice and mocks by their kind */
export const channelThread = (c: Channel, threads: Pick<Thread, 'id' | 'kind' | 'label'>[]) =>
  c.kind === 'roadmap' ? threads.find((t) => t.kind === 'roadmap' && c.track.test(t.label)) : threads.find((t) => t.id === `${c.kind}:${c.ref}`)

/**
 * Each thread's long-term and deadline value, both as shares: long-term values sum to 1 over the
 * threads that have any; deadline values sum to urgency × (how far the scope is from the bar), split
 * by each scope item's channels (a channel with no thread passes its share to the others).
 */
export function threadValues(threads: Pick<Thread, 'id' | 'kind' | 'label'>[], o: { stages: StageLite[]; current: number; milestone: Milestone | null; gaps: Partial<Record<ScopeId, number>>; urgency: number; today: string }): Map<string, ValueRow> {
  const out = new Map<string, ValueRow>(threads.map((t) => [t.id, { id: t.id, longTerm: 0, deadline: 0, scope: [] }]))
  const lt = threads.map((t) => (t.kind === 'roadmap' ? longTermOf(t.label, o.stages, o.current) : 0))
  const ltSum = lt.reduce((a, b) => a + b, 0)
  threads.forEach((t, i) => (out.get(t.id)!.longTerm = ltSum ? lt[i] / ltSum : 0))
  const ms = o.milestone
  if (!ms || ms.date < o.today) return out
  const weeks = daysBetween(o.today, ms.readyBy) / 7
  const live = ms.scope.filter((s) => !scopeDef(s.id)?.within || weeks <= scopeDef(s.id)!.within!)
  const wSum = ms.scope.reduce((n, s) => n + s.weight, 0) || 1
  for (const s of live) {
    const def = scopeDef(s.id)
    if (!def) continue
    const gap = clamp01(o.gaps[s.id] ?? 1)
    const chans = def.channels.map((c) => ({ c, t: channelThread(c, threads) })).filter((x) => x.t)
    const shareSum = chans.reduce((n, x) => n + x.c.share, 0)
    for (const { c, t } of chans) {
      const row = out.get(t!.id)!
      row.deadline += (o.urgency * gap * s.weight * (c.share / shareSum)) / wSum
      if (!row.scope.includes(s.id)) row.scope.push(s.id)
    }
  }
  return out
}

/**
 * The threads with their values as weights: value = long-term + deadline, scaled so the valued
 * threads keep the same total weight they had (threads with neither keep theirs). Threads that
 * score on both come out on top without any rule saying so.
 */
export function valueThreads<T extends Thread>(threads: T[], values: Map<string, ValueRow>): T[] {
  const valued = threads.filter((t) => {
    const v = values.get(t.id)
    return v && v.longTerm + v.deadline > 0 && !t.parked
  })
  const before = valued.reduce((n, t) => n + t.weight, 0)
  const sum = valued.reduce((n, t) => n + values.get(t.id)!.longTerm + values.get(t.id)!.deadline, 0)
  const k = sum > 0 ? before / sum : 0
  return threads.map((t) => {
    const v = values.get(t.id)
    if (!v || !valued.includes(t)) return t
    return { ...t, weight: (v.longTerm + v.deadline) * k, value: { longTerm: Math.round(v.longTerm * 1000) / 1000, deadline: Math.round(v.deadline * 1000) / 1000, scope: v.scope } }
  })
}

// ---------- Floors: maths and parked tracks ----------

export const MATHS_FLOOR = 0.15
/** Review interval for a parked track: touched at least this often, for its due reviews */
export const PARK_INTERVAL = 14
/** Tracks with no new material before the milestone */
export const PARKED = /payment|blockchain|stablecoin|econom|banking|open banking/i
export const isMaths = (label: string) => /^math/i.test(label)

/**
 * Before the milestone, tracks outside the stage and the scope get no new material: they're parked,
 * kept alive with a short review every PARK_INTERVAL days (their learned cards keep their reviews
 * in the daily warm-up as before). Maths threads join the maths floor.
 */
export function parkThreads<T extends Thread>(threads: T[], o: { milestone: Milestone | null; today: string; stageTracks: string[] }): T[] {
  const before = !!o.milestone && o.milestone.date >= o.today
  return threads.map((t) => {
    const inStage = o.stageTracks.some((s) => s.toLowerCase() === t.label.toLowerCase())
    const out: T = isMaths(t.label) ? { ...t, group: 'maths' } : t
    if (before && t.kind === 'roadmap' && !inStage && PARKED.test(t.label)) return { ...out, parked: true, paused: false, session: 15, touch: 15, maxGap: PARK_INTERVAL, hard: false }
    return out
  })
}

// ---------- Hours ----------

/**
 * A day's planned minutes: the setting, but never past the realistic figure (its middle). What the
 * setting has above that is bonus: a longer day pulls the next items forward rather than being
 * planned and then missed. A day counts as full at the realistic low.
 */
export function plannedDay(settingMinutes: number, h?: Milestone['hours']): { plan: number; bonus: number; full: number } {
  if (!h) return { plan: settingMinutes, bonus: 0, full: settingMinutes }
  const realistic = Math.round((((h.low + h.high) / 2) * 60) / 5) * 5
  const plan = Math.min(settingMinutes, realistic)
  return { plan, bonus: Math.max(0, settingMinutes - plan), full: Math.min(plan, Math.round(h.low * 60)) }
}

/** "4.5", "4:30", "4h30", "4 h 30 m", "270m": hours a day as minutes (null when unreadable) */
export function parseDayTime(text: string): number | null {
  const s = String(text ?? '').trim().toLowerCase()
  if (!s) return null
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = s.match(/^(\d{1,2})\s*h(?:ours?|rs?)?\s*(?:([0-5]?\d)\s*(?:m(?:in)?s?)?)?$/)
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0)
  m = s.match(/^(\d{1,4})\s*m(?:in(?:utes?)?)?$/)
  if (m) return Number(m[1])
  m = s.match(/^(\d{0,2}(?:[.,]\d+)?)$/)
  if (m && m[1] && m[1] !== '.') return Math.round(Number(m[1].replace(',', '.')) * 60)
  return null
}

/** Minutes as the editor shows them: 270 → "4.5", 255 → "4:15" */
export function dayTimeText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return String(h)
  if (m === 30) return `${h}.5`
  return `${h}:${String(m).padStart(2, '0')}`
}

/** Days and weeks to a date */
export function countdown(today: string, date: string): { days: number; weeks: number } {
  const days = Math.max(0, daysBetween(today, date))
  return { days, weeks: Math.round(days / 7) }
}
