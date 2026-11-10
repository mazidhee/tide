/**
 * A roadmap read as a curriculum: every topic with a stable id, the headings it sits under, the
 * learner's own tag on those headings (CORE, LATER, OPTIONAL…), and whether it is a project
 * (a capstone) rather than something to be taught.
 */
import { parseOutline, splitSource, topicTitle } from './outline'

export type SectionClass = 'core' | 'supporting' | 'elective' | 'enrichment' | 'skip'

export interface RoadmapTopic {
  /** Stable while the topic and its headings keep their names, whatever the order */
  id: string
  notebook: string
  title: string
  /** The headings above it, outermost first, without their tags */
  path: string[]
  /** The nearest heading, as the week shows it */
  section: string
  /** The section's id: the notebook and its headings */
  sectionId: string
  /** Index of the line in parseOutline(md).lines, to tick it off */
  line: number
  checked: boolean
  /** The book or course the roadmap names for it ("Topic — _Book_") */
  source?: string
  /** A capstone or project: practised as a take-home, not taught as a lesson */
  project: boolean
  /** From the learner's heading tags, nearest heading first; undefined when untagged */
  tagged?: SectionClass
}

const norm = (s: string) =>
  s
    .replace(/\.md$/i, '')
    .replace(/^\s*(\d+[.)]|[IVX]+\.|Part [IVX]+\s*[—–-]|Chapter \d+:)\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The learner's heading tag as a class: "CORE, SHORT" → core, "LATER / OPTIONAL SPECIALIZATION" → elective */
export function tagClass(tag: string | undefined): SectionClass | undefined {
  if (!tag) return undefined
  const t = tag.toUpperCase()
  if (/OPTIONAL|LATER|\bADD\b|ELECTIVE/.test(t) && !/^CORE\b(?!\s+LATER)/.test(t)) return 'elective'
  if (/SUPPORTING|APPLICATION/.test(t)) return 'supporting'
  if (/\bCORE\b/.test(t)) return /\bLATER\b/.test(t) ? 'elective' : 'core'
  return undefined
}

/** "12. Distributed Systems — CORE" → the title and its tag (longer tags than the roadmap page shows) */
function splitTag(text: string): { title: string; tag?: string } {
  // A dated plan adds " — 3 Nov – 1 Dec" to headings: not part of the name
  const t = text.replace(/\s+[—–]\s+\d.*$/, '')
  const m = t.match(/^(.*?)\s+[—–-]\s+([A-Z][A-Z &/,]{1,60})\s*$/)
  return m ? { title: m[1], tag: m[2].trim() } : { title: t }
}

const PROJECT_HEAD = /\bcapstone\b|\bprojects?\b/i
const PROJECT_ITEM = /^\**\s*(capstone|project)\b/i

/** Every checkbox topic in a roadmap, with ids that don't collide */
export function roadmapTopics(notebook: string, md: string): RoadmapTopic[] {
  const { lines } = parseOutline(md)
  const heads: { level: number; text: string; tag?: SectionClass }[] = []
  const out: RoadmapTopic[] = []
  const seen = new Map<string, number>()
  // A bold line such as "**Capstone Projects**" marks the topics after it until the next heading
  let projectRun = false
  lines.forEach((l, i) => {
    if (l.kind === 'heading') {
      while (heads.length && heads[heads.length - 1].level >= l.level) heads.pop()
      const { title, tag } = splitTag(l.text)
      if (l.level >= 2) heads.push({ level: l.level, text: title, tag: tagClass(tag) })
      projectRun = false
      return
    }
    if (l.kind === 'raw') {
      const bold = l.text.match(/^\s*\*\*([^*]+)\*\*\s*$/)
      if (bold) projectRun = PROJECT_HEAD.test(bold[1])
      return
    }
    if (l.checked === null) return
    const title = topicTitle(l.text)
    const path = heads.map((h) => h.text)
    const sectionId = `${norm(notebook)}::${path.map(norm).join(' > ')}`
    const base = `${sectionId}::${norm(title.replace(/\*\*/g, ''))}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const source = splitSource(l.text).source
    out.push({
      id: n ? `${base}#${n + 1}` : base,
      notebook,
      title,
      path,
      section: path[path.length - 1] ?? '',
      sectionId,
      line: i,
      checked: l.checked,
      ...(source ? { source } : {}),
      project: projectRun || PROJECT_ITEM.test(title) || heads.some((h) => PROJECT_HEAD.test(h.text)),
      tagged: [...heads].reverse().find((h) => h.tag)?.tag
    })
  })
  return out
}

/** Whether a topic sits under a heading, given as the heading's text in the roadmap (tags and dates allowed) */
export const underHeading = (t: RoadmapTopic, heading: string) => t.path.some((p) => norm(p) === norm(splitTag(heading).title))

/** Topics still to learn: not ticked, not projects, under the heading if one is given */
export const topicsLeft = (topics: RoadmapTopic[], heading?: string) => topics.filter((t) => !t.checked && !t.project && (!heading || underHeading(t, heading))).length

// ---------- Sorting a roadmap against your aims ----------

export interface Section {
  id: string
  notebook: string
  path: string[]
  /** From the learner's heading tags */
  tagged?: SectionClass
  topics: RoadmapTopic[]
}

/** Topics grouped by the section they sit in, in roadmap order */
export function sectionsOf(topics: RoadmapTopic[]): Section[] {
  const out = new Map<string, Section>()
  for (const t of topics) {
    const s = out.get(t.sectionId) ?? { id: t.sectionId, notebook: t.notebook, path: t.path, tagged: t.tagged, topics: [] }
    s.topics.push(t)
    out.set(t.sectionId, s)
  }
  return [...out.values()]
}

/** What the model said about a section: what it's for and how much each aim needs it */
export interface SectionSort {
  /** Only for sections without the learner's own tag */
  class?: SectionClass
  /** Aim id → 0..1, how much that aim needs this section (foundations a later part relies on count) */
  serves: Record<string, number>
}

/** A roadmap sorted against the aims; kept in .tide/curriculum and redone only for what changed */
export interface SortedRoadmap {
  version: 1
  notebook: string
  aimsKey: string
  model: string
  at: number
  sections: Record<string, SectionSort>
  /** Topics that are history, stories or background rather than skills: weekend primers */
  enrichment: string[]
  /** Topics already looked at for enrichment, so only new ones are asked about */
  looked: string[]
}

/** What the roadmap page shows: by topic id, its class, whether it's your choice, and how much your aims need its section (0..1) */
export interface CurriculumView {
  sorted: boolean
  topics: Record<string, { class?: SectionClass; own: boolean; value: number }>
}

/** The learner's own choices, which always win: topic or section id → class */
export type Overrides = Record<string, SectionClass>

export const SORT_SYSTEM = `You help plan a self-taught learner's study. You are given their aims and the numbered sections of one of their roadmaps.
For each aim, sort the sections it calls for into three lists by section number:
- "about": the aim is about this; it is the day-to-day work of that aim.
- "needs": the aim's core material cannot be learned well without it (a foundation it is built on). Be strict: only what that work actually uses, not what is merely related or generally good to know.
- "useful": helpful background, not required.
Leave out every section the aim doesn't call for; most aims call for only a few sections of any roadmap.
Also give a class for each section marked (untagged): core (some aim is about it or needs it), supporting (needed only because a core section uses it), elective (a specialisation or extra for later), enrichment (history, stories, philosophy or culture: interesting, not a skill), or skip (no aim calls for it).
Judge by what each section teaches, using its full path: "History" inside a blockchain section can be a mechanism (Proof of History), and "groups" means different things in algebra and in consensus.
Reply with JSON only, like: {"aims":{"A1":{"about":[4],"needs":[1,2],"useful":[7]},"A2":{"about":[],"needs":[2],"useful":[]}},"classes":{"3":"core","5":"skip"}}`

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

/** The aims, numbered A1, A2… for the model */
export const aimLines = (aims: { id: string; text: string; weight: string }[]) => aims.map((a, i) => `A${i + 1} (${a.weight}): ${a.text}`).join('\n')

export function sortPrompt(aims: { id: string; text: string; weight: string }[], notebook: string, sections: Section[]): string {
  const lines = sections.map((s, i) => {
    const sample = s.topics.slice(0, 5).map((t) => clip(t.title.replace(/\*\*/g, ''), 48)).join('; ')
    return `${i + 1}. ${s.path.join(' > ') || notebook}${s.tagged ? '' : ' (untagged)'} (${s.topics.length} topics: ${sample}${s.topics.length > 5 ? '; …' : ''})`
  })
  return `Aims:\n${aimLines(aims)}\n\nRoadmap: ${notebook}\nSections:\n${lines.join('\n')}`
}

const CLASSES: SectionClass[] = ['core', 'supporting', 'elective', 'enrichment', 'skip']

const LIST_VALUE = { about: 1, needs: 0.6, useful: 0.3 } as const

/** The model's sort, checked: known sections and aims only; a section in several lists keeps the strongest; a class only where untagged */
export function parseSort(raw: unknown, aims: { id: string }[], sections: Section[]): Record<string, SectionSort> {
  const out: Record<string, SectionSort> = {}
  const r = (raw ?? {}) as { aims?: Record<string, Record<string, unknown>>; classes?: Record<string, unknown> }
  if (!r.aims || typeof r.aims !== 'object') return out
  for (const sec of sections) out[sec.id] = { serves: {} }
  for (const [key, lists] of Object.entries(r.aims)) {
    const aim = aims[Number(key.replace(/^A/i, '')) - 1]
    if (!aim || !lists || typeof lists !== 'object') continue
    for (const [list, value] of Object.entries(LIST_VALUE)) {
      const nums = (lists as Record<string, unknown>)[list]
      if (!Array.isArray(nums)) continue
      for (const n of nums) {
        const sec = sections[Number(n) - 1]
        if (sec) out[sec.id].serves[aim.id] = Math.max(out[sec.id].serves[aim.id] ?? 0, value)
      }
    }
  }
  for (const [n, cls] of Object.entries(r.classes ?? {})) {
    const sec = sections[Number(n) - 1]
    if (sec && !sec.tagged && CLASSES.includes(cls as SectionClass)) out[sec.id].class = cls as SectionClass
  }
  return out
}

export const ENRICH_SYSTEM = `You help plan a self-taught learner's study. Below are topics from a roadmap, grouped under their section path. Pick out the topics that are history, biography, origin stories, culture or background colour: interesting to read about, but not a concept, technique or skill the learner needs to do the work. Examples: "The invention of zero", "Why humans started counting", "The discovery of √2" (the story; the proof that √2 is irrational is a skill), "Euclid's Elements and its influence". Not enrichment: anything that is a mechanism, method or result, even if its name sounds historical ("Proof of History" in blockchain, "historical volatility" in finance).
Reply with JSON only: {"enrichment":[<topic numbers>]} (an empty list if none).`

export function enrichPrompt(topics: RoadmapTopic[]): string {
  let last = ''
  const lines: string[] = []
  topics.forEach((t, i) => {
    const head = t.path.join(' > ')
    if (head !== last) lines.push(`\n## ${head || t.notebook}`)
    last = head
    lines.push(`${i + 1}. ${clip(t.title.replace(/\*\*/g, ''), 90)}`)
  })
  return `Topics:${lines.join('\n')}`
}

export function parseEnrich(raw: unknown, topics: RoadmapTopic[]): string[] {
  const list = (raw as { enrichment?: unknown })?.enrichment
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((n) => topics[Number(n) - 1]?.id).filter((id): id is string => !!id))]
}

/** How much the aims need a section, weighted: main 1, side 0.5, curious 0.2 */
export const AIM_WEIGHT: Record<string, number> = { main: 1, side: 0.5, curious: 0.2 }

export function sectionValue(sort: SectionSort | undefined, aims: { id: string; weight: string }[]): number {
  if (!sort) return 0
  return Math.max(0, ...aims.map((a) => (sort.serves[a.id] ?? 0) * (AIM_WEIGHT[a.weight] ?? 0.5)))
}

/** The class a topic ends up with: the learner's choice, then their heading tag (a main aim can promote an elective), then the model's */
export function classOf(topic: RoadmapTopic, sorted: SortedRoadmap | null, overrides: Overrides, aims: { id: string; weight: string }[]): SectionClass | undefined {
  if (overrides[topic.id]) return overrides[topic.id]
  if (sorted?.enrichment.includes(topic.id)) return 'enrichment'
  if (overrides[topic.sectionId]) return overrides[topic.sectionId]
  const sort = sorted?.sections[topic.sectionId]
  if (topic.tagged) {
    // "Optional specialisation" in the roadmap, but a main aim is about it: it's core now
    if (topic.tagged === 'elective' && sort && aims.some((a) => a.weight === 'main' && (sort.serves[a.id] ?? 0) >= 0.7)) return 'core'
    return topic.tagged
  }
  return sort?.class
}

/** Whether a roadmap has been sorted for these aims, enough to plan from (else it's planned in roadmap order) */
export function isSorted(sorted: SortedRoadmap | null, sections: Section[], aimsKey: string): boolean {
  if (!sorted || sorted.aimsKey !== aimsKey || !sections.length) return false
  const done = sections.filter((s) => sorted.sections[s.id] && (s.tagged || sorted.sections[s.id].class)).length
  return done / sections.length >= 0.95
}
