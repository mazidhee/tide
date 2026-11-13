/**
 * A lesson's sources: short excerpts from the readings found for its topic (specs, papers, docs,
 * open textbooks), so the tutor teaches from text rather than memory and cites it, and the checks
 * compare what it says against the text, not against another model's memory.
 */

export interface LessonSource {
  /** S1, S2… as the tutor cites them */
  n: number
  title: string
  url?: string
  /** A copy in your Library */
  path?: string
  text: string
}

export interface SourcePack {
  topic: string
  at: number
  sources: LessonSource[]
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'what', 'how', 'why', 'its', 'are', 'its', 'of', 'in', 'to', 'a', 'an', 'on', 'by', 'vs', 'versus'])
const words = (t: string) => (t.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w))

/**
 * The paragraphs of a text that are most about the topic, in their original order, up to `max`
 * characters: a page about Raft yields its leader-election paragraphs for "Raft leader election".
 */
export function excerpt(text: string, topic: string, max = 1500): string {
  const want = new Set(words(topic))
  // Paragraphs, and long ones (a page with no blank lines, a PDF page) cut into pieces of a few sentences
  const pieces = (p: string): string[] => {
    if (p.length <= 600) return [p]
    const out: string[] = []
    let cur = ''
    for (const sentence of p.split(/(?<=[.!?])\s+|\n/)) {
      if (cur && cur.length + sentence.length > 600) {
        out.push(cur)
        cur = ''
      }
      cur = cur ? `${cur} ${sentence}` : sentence
    }
    if (cur) out.push(cur)
    return out
  }
  const paras = text
    .split(/\n\s*\n|(?<=[.!?])\s{2,}/)
    .flatMap(pieces)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 60 && !/^(cookie|subscribe|sign in|copyright|all rights reserved)/i.test(p))
  if (!want.size || !paras.length) return text.replace(/\s+/g, ' ').slice(0, max)
  const scored = paras.map((p, i) => {
    const w = words(p)
    const hits = w.filter((x) => want.has(x)).length
    return { i, p, score: hits / Math.sqrt(Math.max(8, w.length)) }
  })
  const picked: typeof scored = []
  let used = 0
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (s.score <= 0 || used + s.p.length > max) continue
    picked.push(s)
    used += s.p.length
  }
  if (!picked.length) return paras[0].slice(0, max)
  return picked
    .sort((a, b) => a.i - b.i)
    .map((s) => s.p)
    .join('\n')
}

/** The sources as they go into the lesson's opening: hidden from you, there for the tutor to teach from and cite */
export function sourcesNote(pack: SourcePack | null): string {
  if (!pack?.sources.length) return ''
  const list = pack.sources.map((s) => `[S${s.n}] ${s.title}${s.url ? ` (${s.url})` : ''}\n${s.text}`).join('\n\n')
  return `(Tide: sources for this lesson. Teach from them where they cover the topic and cite them as [S1], [S2]; where they don't, say it's general knowledge.\n${list})`
}

/** The source text a check compares against, shortened */
export const sourcesForCheck = (pack: SourcePack | null, max = 3500) =>
  pack?.sources.length ? pack.sources.map((s) => `[S${s.n}] ${s.title}\n${s.text}`).join('\n\n').slice(0, max) : ''

/** The rules for teaching technical material from sources, added to every lesson */
export const GROUNDED = `Getting it right:
- When the lesson has sources ([S1], [S2]…), teach from them and cite them for facts. Never contradict a source; if you know otherwise, say so and why.
- Never state a specific number, constant, version or date unless a source, a search or a run shows it; otherwise say it's approximate or worth checking, and for things that change, say which version or year a fact is from.
- When something can be shown by running code, run it and show the real output instead of stating the result.`

/** A lesson's opening with its sources added (the same on both sides, so openings written ahead still match) */
export const withSources = (opening: string, pack: SourcePack | null) => {
  const note = sourcesNote(pack)
  return note ? `${opening}\n\n${note}` : opening
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A lesson's citations as the learner sees them: [S2] (or [S2][S3], [S2, S3]) becomes the name of
 * the source, a button the lesson opens it with (shown beside "Read" and in the rail). Code is left
 * as it is, and so is a number the lesson has no source for.
 */
export function citeSources(md: string, sources: Pick<LessonSource, 'n' | 'title' | 'url' | 'path'>[]): string {
  if (!sources.length || !/\[S\d/.test(md)) return md
  const chip = (n: number) => {
    const s = sources.find((x) => x.n === n)
    if (!s) return null
    const name = s.title.length > 48 ? `${s.title.slice(0, 47).trimEnd()}…` : s.title
    let where = 'a source for this lesson'
    if (s.path) where = 'in your library'
    else if (s.url) {
      try {
        where = new URL(s.url).hostname.replace(/^www\./, '')
      } catch {
        // as it is
      }
    }
    return `<button type="button" class="s-cite" data-source="${n}" title="${escapeAttr(`${s.title}, ${where}. Click to open it.`)}">${escapeAttr(name)}</button>`
  }
  // Fenced and inline code split out, so a citation-like string in code stays code
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\[(S\d{1,2}(?:\s*,\s*S?\d{1,2})*)\]/g, (all, group: string) => {
            const chips = group.split(/\s*,\s*/).map((g) => chip(Number(g.replace(/^S/, ''))))
            return chips.every(Boolean) ? chips.join(' ') : all
          })
    )
    .join('')
}
