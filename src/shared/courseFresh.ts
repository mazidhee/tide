/**
 * Keeping the catalogue fresh, the pure part: your subjects as search terms, what a found course
 * must be to be suggested at all (free without a login, its licence known, not already here, not
 * dismissed), the simple ranking used without Claude (subject match, source quality, recency),
 * reading Claude's ranking when it gives one, and when the weekly check is due. main/freshJob runs
 * the check; it only ever suggests: nothing is imported without you.
 */
import type { CatalogueCourse, CourseArea } from './courseCatalogue'
import { neverHost, tierOfLicence } from './courseSource'

/** Your focus subjects, always searched (beside your aims, roadmaps and What you know) */
export const FOCUS_SUBJECTS = [
  'stablecoins',
  'payments',
  'payment rails',
  'core banking',
  'open banking',
  'payment infrastructure',
  'quantitative finance',
  'financial risk',
  'blockchain',
  'machine learning',
  'data engineering',
  'data science',
  'economics',
  'software engineering'
]

/** Words that say nothing about a subject on their own */
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'how', 'what', 'learn', 'study', 'studying', 'get', 'better', 'good', 'at', 'more', 'about', 'intro', 'introduction', 'to', 'of', 'in', 'on', 'a', 'an', 'my', 'i', 'want', 'be', 'able', 'basics', 'course', 'courses', 'notes', 'topics', 'week', 'job', 'work', 'really', 'deeply', 'understand', 'master', 'become', 'expert'])

/** Search terms from what you study: your focus subjects first, then aims, roadmaps and What you know, each once */
export function subjectTerms(inputs: { aims?: string[]; roadmaps?: string[]; known?: string[] }, max = 40): string[] {
  const out: string[] = []
  const add = (raw: string) => {
    const t = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#.\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t || t.length < 3 || t.length > 48 || STOP.has(t)) return
    // "I want to learn payment rails" → "payment rails": the leading words that aren't the subject go
    const words = t.split(' ')
    while (words.length && STOP.has(words[0])) words.shift()
    while (words.length && STOP.has(words[words.length - 1])) words.pop()
    if (!words.length || words.every((w) => STOP.has(w))) return
    const clean = words.join(' ')
    if (!out.includes(clean)) out.push(clean)
  }
  for (const s of FOCUS_SUBJECTS) add(s)
  // An aim is a sentence: its comma- or "and"-separated parts are the subjects in it
  for (const a of inputs.aims ?? []) for (const part of a.split(/,|;|\band\b|\bthen\b|\//i)) add(part)
  for (const r of inputs.roadmaps ?? []) add(r)
  for (const k of inputs.known ?? []) add(k)
  return out.slice(0, max)
}

/** Which area of the catalogue a found course belongs in, from its words */
export function areaFor(text: string): CourseArea {
  const t = text.toLowerCase()
  const has = (re: RegExp) => re.test(t)
  if (has(/stablecoin|blockchain|bitcoin|ethereum|crypto(currency)?|defi|smart contract|web3|ledger tech/)) return 'blockchain'
  if (has(/payment|banking|bank|iso 20022|swift|ach|card network|settlement|clearing|fintech|open banking|psd2|ledger|treasury/)) return 'payments'
  if (has(/quant|finance|financial|derivative|option pricing|portfolio|risk|asset pricing|trading|stochastic calculus|fixed income|investment/)) return 'quant'
  if (has(/econom|game theory|macro|micro|monetary|labor|inequality|development/)) return 'econ'
  if (has(/data engineer|pipeline|warehouse|spark|kafka|airflow|dbt|etl|streaming/)) return 'data'
  if (has(/mlops|deploy|serving|production ml/)) return 'mlops'
  if (has(/deep learning|neural|transformer|llm|language model|computer vision|reinforcement/)) return 'dl'
  if (has(/machine learning|statistic|data science|probability|inference|regression|bayes/)) return 'ml'
  if (has(/database|operating system|distributed|network|compiler|systems/)) return 'systems'
  if (has(/algorithm|data structure|interview/)) return 'algo'
  if (has(/linear algebra|calculus|maths|mathematics|differential|optimization|numerical/)) return 'maths'
  if (has(/software|programming|python|rust|javascript|testing|design pattern|engineering/)) return 'swe'
  return 'cs'
}

/** A course found on a source by the weekly check, before it is ranked */
export interface Found {
  course: CatalogueCourse
  /** When the source last changed it (ms), when it says */
  updatedAt?: number
  /** GitHub stars, a playlist's video count: how much there is of it / how many found it useful */
  weight?: number
}

export interface Suggestion {
  course: CatalogueCourse
  /** When it was suggested */
  at: number
  score: number
  /** One line on why it suits you */
  why: string
  /** Who ranked it: Claude, or the simple score */
  by: 'claude' | 'score'
}

/** Why a found course can't be suggested, or null when it can */
export function unsuitable(f: Found, have: CatalogueCourse[], dismissed: string[]): string | null {
  const c = f.course
  const where = c.url ?? (c.repo ? `https://github.com/${c.repo}` : c.playlist ? `https://www.youtube.com/playlist?list=${c.playlist}` : '')
  if (!where) return 'no address'
  if (neverHost(where)) return 'behind a login or a payment'
  if (!c.licence?.trim()) return 'its licence is unknown'
  if (c.tier !== tierOfLicence(c.licence) && c.tier === 'open') return 'its licence is not an open one'
  if (dismissed.includes(c.id)) return 'dismissed'
  const same = have.find((h) => h.id === c.id || (c.repo && h.repo?.toLowerCase() === c.repo.toLowerCase()) || (c.url && h.url && h.url.replace(/\/+$/, '') === c.url.replace(/\/+$/, '')) || (c.playlist && h.playlist === c.playlist))
  if (same) return 'already in the catalogue'
  // The same course from another source: MIT 18.642's playlist when its OCW course is here
  const codes = courseCodes(c.title)
  if (codes.length && have.some((h) => courseCodes(h.title).some((x) => codes.includes(x)))) return 'already in the catalogue from another source'
  return null
}

/** A title's course numbers, normalised: "MIT 18.642", "Stanford CS229", "ECON 252" → ["18.642", "CS229", "ECON252"] */
export function courseCodes(title: string): string[] {
  const out = new Set<string>()
  for (const m of title.matchAll(/\b(\d{1,2}\.[A-Z]?\d{2,4}[A-Z]?x?)\b/gi)) out.add(m[1].toUpperCase())
  for (const m of title.matchAll(/\b([A-Z]{2,5})[\s-]?(\d{3}[A-Z]?)\b/g)) if (!/^(MIT|RES|IAP|ISO|ERC|BIP|FIX|SQL)$/.test(m[1])) out.add(`${m[1]}${m[2]}`)
  return [...out]
}

/** Words of a subject that say little on their own */
const GENERIC = new Set(['science', 'engineering', 'systems', 'system', 'infrastructure', 'theory', 'topics', 'principles', 'introduction', 'applied', 'advanced', 'methods', 'design', 'open', 'core', 'rails', 'quantitative', 'analysis', 'studies', 'special', 'modern', 'foundations'])

/** Source quality, 0 to 1: university courses and official material over a random repository */
export function sourceQuality(f: Found): number {
  const s = f.course.source ?? 'github'
  if (s === 'ocw' || s === 'yale') return 1
  if (s === 'jupyterbook') return 0.95
  if (s === 'docs') return 0.85
  if (s === 'site') return 0.8
  if (s === 'youtube') return 0.75
  // GitHub: by stars, 100 → 0.4, 1k → 0.6, 10k → 0.8
  const stars = f.weight ?? 0
  return Math.max(0.2, Math.min(0.85, 0.2 * Math.log10(Math.max(1, stars))))
}

/**
 * The simple ranking (no Claude): how much of the course is about your subjects (focus subjects
 * count most), how good its source is, and how recently it changed. 0 to 10.
 */
export function scoreFound(f: Found, terms: string[], now = Date.now()): { score: number; why: string } {
  const c = f.course
  const text = ` ${`${c.title} ${c.covers} ${c.topics.join(' ')}`.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ')} `
  const hits: string[] = []
  let match = 0
  terms.forEach((t, i) => {
    const words = t.split(' ')
    const has = (w: string) => text.includes(` ${w} `) || text.includes(` ${w}s `)
    const whole = has(t)
    const most = words.length > 1 && words.filter(has).length >= Math.ceil(words.length * 0.75)
    // One telling word of it: "Public Finance" is about quantitative finance a little; "Data Science" isn't about rocket science
    const some = words.length > 1 && words.some((w) => w.length >= 4 && !GENERIC.has(w) && has(w))
    if (!whole && !most && !some) return
    // Your focus subjects come first in the list and count most
    match += (whole ? 1 : most ? 0.6 : 0.35) * (i < FOCUS_SUBJECTS.length ? 1.5 : 1)
    const word = whole || most ? t : words.find((w) => w.length >= 4 && !GENERIC.has(w) && has(w))!
    if (!hits.includes(word)) hits.push(word)
  })
  const subject = Math.min(1, match / 2.5)
  const quality = sourceQuality(f)
  const ageDays = f.updatedAt ? (now - f.updatedAt) / 86_400_000 : 720
  const recency = ageDays < 30 ? 1 : ageDays < 180 ? 0.8 : ageDays < 365 ? 0.6 : ageDays < 3 * 365 ? 0.4 : 0.25
  const score = subject === 0 ? 0 : Math.round((subject * 6 + quality * 2.5 + recency * 1.5) * 10) / 10
  const why = hits.length ? `About ${hits.slice(0, 3).join(', ')}${f.updatedAt && ageDays < 365 ? `; updated ${ageDays < 30 ? 'this month' : 'this year'}` : ''}` : 'Not about your subjects'
  return { score, why }
}

/** Ranks found courses with the simple score, best first, leaving out what isn't about your subjects */
export function rankFound(found: Found[], terms: string[], now = Date.now(), min = 3.5): { found: Found; score: number; why: string }[] {
  return found
    .map((f) => ({ found: f, ...scoreFound(f, terms, now) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
}

/** Claude's ranking, read from its reply: [{ id, score, why }], only for ids it was given */
export function readRanking(text: string, ids: string[]): { id: string; score: number; why: string }[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as { id?: unknown; score?: unknown; why?: unknown }[]
    return arr
      .filter((x) => typeof x.id === 'string' && ids.includes(x.id) && Number.isFinite(Number(x.score)))
      .map((x) => ({ id: x.id as string, score: Math.max(0, Math.min(10, Number(x.score))), why: String(x.why ?? '').slice(0, 200) }))
  } catch {
    return []
  }
}

/** The prompt Claude ranks found courses with */
export function rankingPrompt(terms: string[], found: Found[]): string {
  const rows = found.map((f) => ({ id: f.course.id, title: f.course.title, by: f.course.by, source: f.course.source ?? 'github', covers: f.course.covers, level: f.course.level, licence: f.course.licence, ...(f.updatedAt ? { updated: new Date(f.updatedAt).toISOString().slice(0, 10) } : {}), ...(f.weight ? { weight: f.weight } : {}) }))
  return `A learner studies these subjects (most important first):\n${terms.slice(0, 30).map((t) => `- ${t}`).join('\n')}\n\nThese free courses were found this week:\n${JSON.stringify(rows, null, 1)}\n\nRank the ones worth suggesting to this learner: real courses or books that teach (not link lists, not marketing, not one-off talks), about their subjects, from a trustworthy source. Prefer recent material: leave out anything more than about 15 years old unless it is a classic still taught, and anything only loosely related to their subjects. Reply with only a JSON array, best first, at most 12 items: [{"id": "...", "score": 0-10, "why": "one plain sentence on what it teaches them"}]. Leave out anything below 5.`
}

export const RANK_SYSTEM = 'You choose study material for one learner. You are strict: you prefer university courses, official guides and well-known books, and leave out anything thin. You answer with JSON only.'

// ---------- When it runs ----------

export const WEEK = 7 * 86_400_000

/** Whether the weekly check should run now: a week since the last, and no lesson running */
export function checkDue(lastRun: number | undefined, now: number, lessonRunning: boolean): boolean {
  if (lessonRunning) return false
  return !lastRun || now - lastRun >= WEEK
}

/** Suggestions kept: the latest for each course, none older than four weeks, none dismissed or imported */
export function keepSuggestions(old: Suggestion[], fresh: Suggestion[], opts: { now: number; dismissed: string[]; imported: string[]; max?: number }): Suggestion[] {
  const by = new Map<string, Suggestion>()
  for (const s of [...old, ...fresh]) {
    if (opts.dismissed.includes(s.course.id) || opts.imported.includes(s.course.id)) continue
    if (opts.now - s.at > 4 * WEEK) continue
    const had = by.get(s.course.id)
    by.set(s.course.id, had ? { ...s, at: had.at } : s)
  }
  return [...by.values()].sort((a, b) => b.at - a.at || b.score - a.score).slice(0, opts.max ?? 30)
}

/** New this week: suggested in the last seven days */
export const isNew = (s: Pick<Suggestion, 'at'>, now = Date.now()) => now - s.at < WEEK

// ---------- The log ----------

export interface CheckLog {
  at: number
  /** What was checked: a source's discovery, or a course's update */
  what: string
  url?: string
  result: 'ok' | 'changed' | 'unchanged' | 'found' | 'skipped' | 'refused' | 'failed' | 'paused'
  detail?: string
}
