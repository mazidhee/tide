/**
 * How the Courses page sorts the catalogue into what you're doing (Continue), what the weekly check
 * found (New for you) and everything else (Browse, by your subjects and by where it comes from).
 * Pure, so the grouping and filters are tested (test/courseShelf.test.ts).
 */
import { mediaOf, nextLesson, sourceOf, SOURCES, sourceSite, type CatalogueCourse, type CourseOutline, type CourseProgress } from './courses'

/** A catalogue course as the page lists it (main/courses CourseCard) */
export interface ShelfCourse extends CatalogueCourse {
  imported?: { importedAt: number; updatedAt: number; lessons: number; done: number; lastStudied?: number; next?: { id: string; title: string; module: string } }
  suggested?: { at: number; why: string; score: number; by: 'claude' | 'score' }
  updateAvailable?: boolean
}

export type SubjectId = 'payments' | 'blockchain' | 'quant' | 'econ' | 'ml' | 'data' | 'datasci' | 'cs' | 'other'

/** Your subjects, in the order you study them; a course can sit in more than one */
export const SUBJECTS: { id: SubjectId; label: string }[] = [
  { id: 'payments', label: 'Payments and banking' },
  { id: 'blockchain', label: 'Blockchain and stablecoins' },
  { id: 'quant', label: 'Quant and risk' },
  { id: 'econ', label: 'Economics' },
  { id: 'ml', label: 'Machine learning' },
  { id: 'data', label: 'Data engineering' },
  { id: 'datasci', label: 'Data science' },
  { id: 'cs', label: 'CS and systems' },
  { id: 'other', label: 'Maths and more' }
]

const DATA_SCIENCE = /\b(data science|pandas|statistic|data analysis|data visuali[sz]ation|forecasting|time series|bayesian|probability|numpy)\b/i

export function subjectsOf(c: Pick<CatalogueCourse, 'area' | 'title' | 'covers' | 'topics'>): SubjectId[] {
  const out: SubjectId[] = []
  const a = c.area
  if (a === 'payments') out.push('payments')
  if (a === 'blockchain') out.push('blockchain')
  if (a === 'quant') out.push('quant')
  if (a === 'econ') out.push('econ')
  if (a === 'ml' || a === 'dl' || a === 'mlops') out.push('ml')
  if (a === 'data') out.push('data')
  if ((a === 'ml' || a === 'maths') && DATA_SCIENCE.test(`${c.title} ${c.covers} ${c.topics.join(' ')}`)) out.push('datasci')
  if (a === 'cs' || a === 'systems' || a === 'swe' || a === 'design' || a === 'algo') out.push('cs')
  if (!out.length) out.push('other')
  return out
}

export type SourceGroup = 'github' | 'ocw' | 'yale' | 'quantecon' | 'books' | 'lectures' | 'guides'

export const SOURCE_GROUPS: { id: SourceGroup; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'ocw', label: 'MIT OpenCourseWare' },
  { id: 'yale', label: 'Open Yale' },
  { id: 'quantecon', label: 'QuantEcon' },
  { id: 'books', label: 'Books' },
  { id: 'lectures', label: 'Lecture series' },
  { id: 'guides', label: 'Guides' }
]

export function sourceGroupOf(c: CatalogueCourse): SourceGroup {
  if (/quantecon/i.test(`${c.by} ${c.repo ?? ''} ${c.url ?? ''}`)) return 'quantecon'
  const s = sourceOf(c)
  if (s === 'ocw') return 'ocw'
  if (s === 'yale') return 'yale'
  if (s === 'youtube') return 'lectures'
  if (s === 'docs' || c.kind === 'guide') return 'guides'
  if (s === 'site' || s === 'jupyterbook' || c.kind === 'book') return 'books'
  return 'github'
}

export type CourseSort = 'subject' | 'title' | 'level' | 'newest'
export const SORTS: { id: CourseSort; label: string }[] = [
  { id: 'subject', label: 'By subject' },
  { id: 'title', label: 'A to Z' },
  { id: 'level', label: 'Beginner first' },
  { id: 'newest', label: 'Newest found' }
]

export interface BrowseFilter {
  subject: SubjectId | 'all'
  source: SourceGroup | 'all'
  media: 'all' | 'video' | 'text'
  level: 'all' | CatalogueCourse['level']
  query: string
  sort: CourseSort
}

export const NO_FILTER: BrowseFilter = { subject: 'all', source: 'all', media: 'all', level: 'all', query: '', sort: 'subject' }

/** The three shelves: courses under way, ones finished, and the weekly check's new finds */
export function shelves<T extends ShelfCourse>(cards: T[]): { continuing: T[]; finished: T[]; suggested: T[] } {
  const imported = cards.filter((c) => c.imported)
  const recent = (c: T) => c.imported!.lastStudied ?? c.imported!.importedAt
  return {
    continuing: imported.filter((c) => c.imported!.done < c.imported!.lessons).sort((a, b) => recent(b) - recent(a) || a.title.localeCompare(b.title)),
    finished: imported.filter((c) => c.imported!.lessons > 0 && c.imported!.done >= c.imported!.lessons).sort((a, b) => recent(b) - recent(a)),
    suggested: cards.filter((c) => c.suggested && !c.imported).sort((a, b) => b.suggested!.at - a.suggested!.at || b.suggested!.score - a.suggested!.score)
  }
}

const LEVEL_ORDER = { beginner: 0, intermediate: 1, advanced: 2 }

export function matches(c: CatalogueCourse, f: Omit<BrowseFilter, 'sort'>): boolean {
  const q = f.query.trim().toLowerCase()
  return (
    (f.subject === 'all' || subjectsOf(c).includes(f.subject)) &&
    (f.source === 'all' || sourceGroupOf(c) === f.source) &&
    (f.media === 'all' || (f.media === 'video' ? mediaOf(c) !== 'text' : mediaOf(c) !== 'video')) &&
    (f.level === 'all' || c.level === f.level) &&
    (!q || q.split(/\s+/).every((w) => `${c.title} ${c.by} ${c.covers} ${c.topics.join(' ')} ${sourceSite(c)} ${SOURCES[sourceOf(c)].label}`.toLowerCase().includes(w)))
  )
}

/** The catalogue filtered and sorted; by subject it comes as one group per subject, otherwise as one */
export function browse<T extends ShelfCourse>(cards: T[], f: BrowseFilter): { id: SubjectId | 'all'; label: string; courses: T[] }[] {
  const shown = cards.filter((c) => matches(c, f))
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
  if (f.sort === 'subject') {
    const subjects = f.subject === 'all' ? SUBJECTS : SUBJECTS.filter((s) => s.id === f.subject)
    return subjects
      .map((s) => ({ id: s.id, label: s.label, courses: shown.filter((c) => subjectsOf(c).includes(s.id)).sort((a, b) => Number(!!b.suggested) - Number(!!a.suggested) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || byTitle(a, b)) }))
      .filter((g) => g.courses.length)
  }
  const sorted = [...shown].sort(
    f.sort === 'title' ? byTitle : f.sort === 'level' ? (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || byTitle(a, b) : (a, b) => (b.suggested?.at ?? 0) - (a.suggested?.at ?? 0) || (b.imported?.importedAt ?? 0) - (a.imported?.importedAt ?? 0) || byTitle(a, b)
  )
  return sorted.length ? [{ id: 'all', label: 'All', courses: sorted }] : []
}

/** How many courses each subject and source holds, for the filter labels */
export function counts(cards: CatalogueCourse[]): { subjects: Record<SubjectId, number>; sources: Record<SourceGroup, number> } {
  const subjects = Object.fromEntries(SUBJECTS.map((s) => [s.id, 0])) as Record<SubjectId, number>
  const sources = Object.fromEntries(SOURCE_GROUPS.map((s) => [s.id, 0])) as Record<SourceGroup, number>
  for (const c of cards) {
    for (const s of subjectsOf(c)) subjects[s]++
    sources[sourceGroupOf(c)]++
  }
  return { subjects, sources }
}

// ---------- The page's home: the course you're in, then shelves ----------

/** Where you are in a course: its module, how much of that module is left, and the next lesson */
export interface CoursePlace {
  /** 1-based */
  module: number
  modules: number
  moduleTitle: string
  /** Reading time left in the module, from its lessons' length (about 200 words a minute) */
  minutesLeft: number
  next: { id: string; title: string } | null
}

export function coursePlace(o: CourseOutline, p: CourseProgress | undefined): CoursePlace | null {
  const at = nextLesson(o, p)
  const mods = o.modules.filter((m) => m.lessons.length)
  if (!mods.length) return null
  const mod = at?.module ?? mods[mods.length - 1]
  const i = Math.max(0, mods.findIndex((m) => m.id === mod.id))
  const words = mod.lessons.filter((l) => !p?.[l.id]?.done).reduce((n, l) => n + (l.words || 0), 0)
  return { module: i + 1, modules: mods.length, moduleTitle: mod.title, minutesLeft: words ? Math.max(1, Math.round(words / 200)) : 0, next: at ? { id: at.lesson.id, title: at.lesson.title } : null }
}

/** "about 6 h", "about 40 min" */
export function timeLeft(minutes: number): string {
  if (minutes < 60) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} min`
  const h = Math.round(minutes / 30) / 2
  return `about ${h % 1 ? h.toFixed(1) : h} h`
}

/** Quiet marks for each subject's covers; a course always gets the same one */
export const SUBJECT_GLYPHS: Record<SubjectId, string[]> = {
  payments: ['$', '€', '£', '¤'],
  blockchain: ['#', '⛓', '⊕', '0x'],
  quant: ['σ', 'Δ', 'π', '∫', 'Γ'],
  econ: ['λ', '%', '∂', 'ε'],
  ml: ['θ', '∂', '∇', 'λ', 'ŷ'],
  data: ['⋈', '∪', '→', '⊆'],
  datasci: ['μ', 'σ²', 'x̄', 'ρ'],
  cs: ['{ }', '< >', '⊢', 'λ', '∅'],
  other: ['∑', '√', '∞', 'φ']
}

export function glyphFor(c: Pick<CatalogueCourse, 'id' | 'area' | 'title' | 'covers' | 'topics'>): string {
  const set = SUBJECT_GLYPHS[subjectsOf(c)[0] ?? 'other']
  let h = 0
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return set[h % set.length]
}

/**
 * The catalogue as shelves by subject: subjects of the courses you're in first, then the usual
 * order; each shelf a handful of courses you haven't started, new finds first.
 */
export function subjectShelves<T extends ShelfCourse>(cards: T[], perShelf = 5): { id: SubjectId; label: string; total: number; courses: T[] }[] {
  const { continuing } = shelves(cards)
  const mine: SubjectId[] = []
  for (const c of continuing) for (const s of subjectsOf(c)) if (!mine.includes(s)) mine.push(s)
  const order = [...mine, ...SUBJECTS.map((s) => s.id).filter((id) => !mine.includes(id))]
  const groups = browse(cards, { ...NO_FILTER })
  return order
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((g) => ({ id: g.id as SubjectId, label: g.label, total: g.courses.length, courses: g.courses.filter((c) => !c.imported).slice(0, perShelf) }))
    .filter((g) => g.courses.length)
}
