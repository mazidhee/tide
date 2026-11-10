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
    const base = `${norm(notebook)}::${path.map(norm).join(' > ')}::${norm(title.replace(/\*\*/g, ''))}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const source = splitSource(l.text).source
    out.push({
      id: n ? `${base}#${n + 1}` : base,
      notebook,
      title,
      path,
      section: path[path.length - 1] ?? '',
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
