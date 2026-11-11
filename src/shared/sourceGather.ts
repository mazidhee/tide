/**
 * Source-led lessons: gathering the candidates a reading is chosen from, and placing the reading
 * in the tutor's reply as it streams. What touches the outside (the search index, web search, the
 * page reader) is passed in, so the rules here (what a private lesson may use, which pages are
 * read, where the reading goes) are tested without the app or the network. main/sourceLed wires
 * the real ones.
 */
import { isBlocked } from './readings'
import { hostOf, planSteps, quoteCheck, readingBlock, unreadable, type Candidate, type LedPlan, type StepReading } from './sourceLed'
import { AUTHORITY, UNLISTED, academicHost, statedLicence, trustedSite } from './trustedSources'

/** A passage from the search index of your notes folder */
export interface Passage {
  id: string
  path: string
  title: string
  heading: string
  text: string
  order: number
}

export interface GatherDeps {
  /** The index of your notes folder: best passages for a query */
  search(q: string, limit: number): Passage[]
  /** Every passage of one file, in reading order */
  chunks(path: string): Passage[]
  /** The file is in a private project */
  isPrivate(path: string): boolean
  webSearch(q: string): Promise<{ title: string; url: string }[]>
  read(url: string): Promise<{ title: string; text: string }>
  /** Pages already known for the topic: readings found for it, and explainers kept for it */
  known(topic: string): Promise<{ title: string; by?: string; url: string; explainer?: boolean }[]>
  /** An ordinary public address (never this Mac, your network, your Metabase, or a signed link) */
  publicUrl(url: string): boolean
  now(): number
  /** The licence note recorded for a book added from a free library (Project Gutenberg, Standard Ebooks) */
  licenceOf?(path: string): { licence: string; by?: string } | undefined
}

export interface GatherOptions {
  topic: string
  /** The lesson is in a private project or about your Metabase: only your own material, nothing looked up */
  private: boolean
  /** Web search is on for this lesson */
  web: boolean
}

/** Written by Tide or by the tutor, not a source: lesson pages, flashcards, Tide's own files */
const NOT_A_SOURCE = /^(\.tide|Lessons|Flashcards)\//i
const pageOf = (id: string) => Number(id.match(/#p(\d+)-(\d+)$/)?.[1] ?? 0)
const startOf = (id: string) => Number(id.match(/#p(\d+)-(\d+)$/)?.[2] ?? 0)

/**
 * What you own that might teach this: the pages around the best match in up to three of your books
 * (their exact pages recorded), and the best-matching section of up to two of your notes. A file
 * in a private project is only ever used by a lesson that is itself private.
 */
export function ownedCandidates(deps: GatherDeps, query: string, opts: GatherOptions): Candidate[] {
  const hits = deps.search(query, 24).filter((h) => !NOT_A_SOURCE.test(h.path) && (opts.private || !deps.isPrivate(h.path)))
  const best = new Map<string, Passage>()
  for (const h of hits) if (!best.has(h.path)) best.set(h.path, h)
  const out: Candidate[] = []
  let books = 0
  let notes = 0
  for (const hit of best.values()) {
    if (/\.pdf$/i.test(hit.path)) {
      if (books++ >= 3) continue
      const page = pageOf(hit.id)
      if (!page) continue
      // The page before (where the section usually starts) to two after
      const near = deps
        .chunks(hit.path)
        .filter((c) => pageOf(c.id) >= page - 1 && pageOf(c.id) <= page + 2)
        .sort((a, b) => pageOf(a.id) - pageOf(b.id) || startOf(a.id) - startOf(b.id))
      let text = ''
      const pages: { page: number; at: number }[] = []
      for (const c of near) {
        const p = pageOf(c.id)
        if (pages[pages.length - 1]?.page !== p) {
          if (text) text += '\n\n'
          pages.push({ page: p, at: text.length })
        }
        // Pieces of one page were cut from it mid-word: put back end to end, they are the page again
        text += c.text
      }
      if (text.trim()) out.push({ kind: 'book', title: hit.title, path: hit.path, pages, fetchedAt: deps.now(), text })
    } else if (/\.epub$/i.test(hit.path)) {
      // An EPUB: the passage found and the next one in its chapter, under "Book: Chapter N: title"
      if (books++ >= 3) continue
      const chapter = hit.heading.replace(/\s*\(¶[^)]*\)\s*$/, '')
      const all = deps.chunks(hit.path).sort((a, b) => a.order - b.order)
      const at = all.findIndex((c) => c.id === hit.id)
      const near = (at >= 0 ? all.slice(at, at + 2) : [hit]).filter((c) => c.heading.startsWith(chapter))
      const text = near.map((c) => c.text).join('\n\n')
      const source = deps.licenceOf?.(hit.path)
      if (text.trim()) out.push({ kind: 'book', title: `${hit.title}: ${hit.heading}`, path: hit.path, fetchedAt: deps.now(), text, ...(source?.by ? { by: source.by } : {}), ...(source?.licence ? { licence: source.licence } : {}) })
    } else if (/\.md$/i.test(hit.path)) {
      if (notes++ >= 2) continue
      // One section of the note: its pieces were cut at paragraph breaks, so joined they are its text
      const section = deps
        .chunks(hit.path)
        .filter((c) => c.heading === hit.heading)
        .sort((a, b) => a.order - b.order)
      const text = (section.length ? section : [hit]).map((c) => c.text).join('\n\n')
      if (text.trim()) out.push({ kind: 'note', title: hit.heading ? `${hit.title}: ${hit.heading}` : hit.title, by: 'Your notes', path: hit.path, fetchedAt: deps.now(), text, format: 'md' })
    }
  }
  return out
}

const MAX_TEXT = 60_000
const authority = (url: string) => {
  const t = trustedSite(url)
  return t ? AUTHORITY[t.kind] : academicHost(url) ? 0.6 : UNLISTED
}

/**
 * Pages from the web that might teach this: what is already known for the topic, then what a
 * search finds, the trusted ones first (up to three), and one page nobody has listed only when
 * fewer than two trusted ones turned up. Nothing at all for a private lesson or with the web off:
 * no search, no page read, so not even the topic's name leaves this Mac.
 */
export async function webCandidates(deps: GatherDeps, query: string, opts: GatherOptions, have: Set<string>, withKnown = false): Promise<Candidate[]> {
  if (opts.private || !opts.web) return []
  const known = withKnown ? await deps.known(opts.topic).catch(() => []) : []
  const found = await deps.webSearch(query).catch(() => [])
  const explainers = new Set(known.filter((k) => k.explainer).map((k) => k.url))
  const by = new Map(known.filter((k) => k.by).map((k) => [k.url, k.by!]))
  const seen = new Set<string>()
  const usable = [...known, ...found].filter((r) => {
    if (!/^https?:\/\//i.test(r.url) || isBlocked(r.url) || !deps.publicUrl(r.url) || have.has(r.url) || seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
  const listed = usable.filter((r) => authority(r.url) > UNLISTED || explainers.has(r.url)).sort((a, b) => authority(b.url) - authority(a.url))
  const unlisted = usable.filter((r) => !listed.includes(r))
  const picks = [...listed.slice(0, 3), ...(listed.length < 2 ? unlisted.slice(0, 1) : [])]
  const read = await Promise.all(
    picks.map(async (r): Promise<Candidate | null> => {
      have.add(r.url)
      const page = await deps.read(r.url).catch(() => null)
      if (!page || unreadable(page.text)) return null
      const text = page.text.slice(0, MAX_TEXT)
      const site = trustedSite(r.url)
      const licence = site?.licence ?? statedLicence(page.text)
      const md = /^#{1,4} \S/m.test(text) && /\]\(https?:/.test(text)
      return {
        kind: explainers.has(r.url) ? 'explainer' : 'web',
        title: (page.title && page.title !== r.url ? page.title : r.title) || hostOf(r.url),
        by: by.get(r.url) ?? site?.by ?? hostOf(r.url),
        url: r.url,
        ...(licence ? { licence } : {}),
        fetchedAt: deps.now(),
        text,
        ...(md ? { format: 'md' as const } : {})
      }
    })
  )
  return read.filter((c): c is Candidate => !!c)
}

// ---------- Placing the reading in the reply ----------

export interface TapOptions {
  plan: LedPlan
  /** The reading this turn may show */
  reading: StepReading | null
  /** Passes text on to the window */
  emit: (text: string) => void
  /** Asked when the tutor finishes writing its plan: is there a reading for the first step? Then its turn ends there. */
  firstReading?: (steps: string[]) => boolean
  /** Ends the model's turn */
  cut?: () => void
}

/**
 * The tutor's reply as it streams, with the reading put in by Tide, never by the model: at the top
 * of the reply, or straight after the mark once the mark is "correct". And when the plan has just
 * been written and its first step has a reading, the turn ends at the plan with "carry on", so the
 * step opens with the reading instead of the tutor's own explanation.
 */
export function ledTap(o: TapOptions) {
  let seen = ''
  let placed = false
  let decided = false
  let planChecked = false
  let ended = false
  const block = o.reading ? readingBlock(o.reading) : ''
  return {
    delta(text: string) {
      if (ended) return
      if (o.plan.top !== undefined && block && !placed) {
        placed = true
        o.emit(`${block}\n\n`)
      }
      const before = seen.length
      seen += text
      if (o.plan.onCorrect !== undefined && block && !decided) {
        const at = seen.search(/<\/grade>/i)
        if (at >= 0) {
          decided = true
          const end = at + '</grade>'.length
          const verdict = /<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/i.exec(seen.slice(0, end))?.[1]?.toLowerCase()
          o.emit(text.slice(0, Math.max(0, end - before)))
          if (verdict === 'correct') {
            placed = true
            o.emit(`\n\n${block}\n\n`)
          }
          o.emit(text.slice(Math.max(0, end - before)).replace(placed ? /^\s+/ : /^$/, ''))
          return
        }
      }
      if (o.firstReading && !planChecked) {
        const at = seen.search(/<\/plan>/i)
        if (at >= 0) {
          planChecked = true
          const end = at + '</plan>'.length
          const steps = planSteps(seen.slice(0, end))
          if (steps.length && o.firstReading(steps)) {
            ended = true
            o.emit(`${text.slice(0, Math.max(0, end - before))}\n\n<continue/>`)
            o.cut?.()
            return
          }
        }
      }
      o.emit(text)
    },
    /** The reply is being written again from the start */
    reset() {
      seen = ''
      placed = false
      decided = false
      planChecked = false
    },
    /** A reading was put into this reply */
    get placed() {
      return placed
    }
  }
}

/** Under a mark that quotes words the reading doesn't hold: said plainly, so a made-up quote isn't taken for the source's */
export function quoteNote(reply: string, reading: StepReading | undefined, answer = ''): string {
  if (!reading) return ''
  const grade = /<grade\b[^>]*>([\s\S]*?)<\/grade>/i.exec(reply)?.[1] ?? ''
  const missing = quoteCheck(grade, reading.text, answer).missing
  return missing.length ? `\n\n> **Worth checking:** the mark quotes “${missing[0]}”, which is not in the reading. Read the passage itself before relying on that line.` : ''
}
