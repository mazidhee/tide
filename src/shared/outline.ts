/**
 * Notebook outlines are plain Markdown, the way people already write syllabi in Obsidian:
 *   ## Part I
 *   ### Chapter 1: Numbers
 *   - [x] The invention of zero
 *   - [ ] [[Prime Numbers|Prime numbers]]
 *     - [ ] Sub topic
 * The model is a flat list of lines so editing never reorders or drops anything it doesn't understand.
 */

export type OutlineLine =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'item'; depth: number; checked: boolean | null; text: string }
  | { kind: 'raw'; text: string }

export interface Outline {
  lines: OutlineLine[]
  /** Indentation used by the file, kept when writing nested items */
  indent: string
  /** Frontmatter and anything before the first outline line, kept verbatim */
  preamble: string
}

const ITEM = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

export function parseOutline(md: string): Outline {
  let body = md
  let preamble = ''
  const fm = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (fm) {
    preamble = fm[0]
    body = md.slice(fm[0].length)
  }
  const rawLines = body.split('\n')
  // Detect the indent unit from the first indented list item
  let indent = '  '
  for (const l of rawLines) {
    const m = l.match(/^(\s+)[-*+]\s/)
    if (m) {
      indent = m[1].startsWith('\t') ? '\t' : m[1].length >= 4 ? '    ' : m[1]
      break
    }
  }
  const unit = indent === '\t' ? 1 : indent.length
  const lines: OutlineLine[] = rawLines.map((text) => {
    const h = text.match(HEADING)
    if (h) return { kind: 'heading', level: h[1].length, text: h[2] }
    const i = text.match(ITEM)
    if (i) {
      const lead = i[1].replace(/\t/g, indent === '\t' ? '\t' : ' '.repeat(unit))
      const depth = indent === '\t' ? (i[1].match(/\t/g)?.length ?? 0) : Math.floor(lead.length / unit)
      return { kind: 'item', depth, checked: i[2] === undefined ? null : i[2] !== ' ', text: i[3] }
    }
    return { kind: 'raw', text }
  })
  return { lines, indent, preamble }
}

export function serializeOutline(o: Outline): string {
  return (
    o.preamble +
    o.lines
      .map((l) => {
        if (l.kind === 'heading') return `${'#'.repeat(l.level)} ${l.text}`
        if (l.kind === 'item') {
          const box = l.checked === null ? '' : l.checked ? '[x] ' : '[ ] '
          return `${o.indent.repeat(l.depth)}- ${box}${l.text}`
        }
        return l.text
      })
      .join('\n')
  )
}

/** A topic's first [[link]], if any, and the text to show without link syntax */
export function itemLink(text: string): { target: string | null; label: string } {
  const m = text.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/)
  if (!m) return { target: null, label: text }
  const label = text.replace(m[0], m[2] ?? m[1]).trim()
  return { target: m[1].trim(), label }
}

const SOURCE = /\s+[—–-]\s+_(.+?)_\s*$/

/** Splits "Topic — _Book, Author_" into the topic and its source (a common roadmap style) */
export function splitSource(text: string): { main: string; source: string | null } {
  const m = text.match(SOURCE)
  return m ? { main: text.slice(0, m.index).trimEnd(), source: m[1].trim() } : { main: text, source: null }
}

export const joinSource = (main: string, source: string | null) => (source ? `${main} — _${source}_` : main)

/** A topic's title as the reader sees it: no link syntax, no source */
export const topicTitle = (text: string) => itemLink(splitSource(text).main).label

/** Rewrites a topic's text with a new title, keeping its link and source */
export function retitleItem(text: string, title: string): string {
  const { main, source } = splitSource(text)
  const { target } = itemLink(main)
  return joinSource(target ? `[[${target}|${title}]]` : title, source)
}

/** Rewrites a topic so its title links to a note, keeping its source */
export function linkItemText(text: string, noteName: string): string {
  const { main, source } = splitSource(text)
  return joinSource(`[[${noteName}|${itemLink(main).label}]]`, source)
}

/** Normalizes titles for matching: drops numbering, details after a dash, case and punctuation */
export function normalizeTitle(s: string): string {
  return s
    .replace(/\.md$/i, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .split(/\s[—–-]\s|\s\(/)[0]
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Counts done topics under each heading (until the next heading of the same or higher level) */
export function sectionProgress(lines: OutlineLine[], headingIndex: number): { done: number; total: number } {
  const head = lines[headingIndex]
  if (head.kind !== 'heading') return { done: 0, total: 0 }
  let done = 0
  let total = 0
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.kind === 'heading' && l.level <= head.level) break
    if (l.kind === 'item' && l.checked !== null) {
      total++
      if (l.checked) done++
    }
  }
  return { done, total }
}

/**
 * Turns a model's outline draft into a clean outline: headings, unticked topics, and indented
 * resource lines. Drops preambles, closing remarks, code fences and numbering, whatever the model
 * wrapped around it. A single top-level title is dropped (the notebook names it).
 */
export function normalizeOutlineDraft(raw: string): string {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^```[a-z]*\s*$/gim, '')
    .replace(/\r\n?/g, '\n')
  const out: string[] = []
  let started = false
  let lastWasItem = false
  const seenTopics = new Set<string>()
  const clean = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^(?:\d+[.)]|[IVXLC]+[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  const lines = text.split('\n')
  const h1s = lines.filter((l) => /^#\s+\S/.test(l)).length
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      let level = heading[1].length
      if (level === 1 && h1s === 1 && !started) continue
      if (level === 1) level = 2
      const title = clean(heading[2])
      if (!title) continue
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(`${'#'.repeat(level)} ${title}`, '')
      started = true
      lastWasItem = false
      continue
    }
    const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/)
    if (item && started) {
      const indent = item[1].replace(/\t/g, '    ').length
      const body = clean(item[3])
      if (!body) continue
      const hasBox = item[2] !== undefined
      // "- [ ] _Book — Author_" is a resource, not a topic; one with no real author is dropped
      if (/^[_*].{3,}[_*]$/.test(item[3].trim())) {
        if (lastWasItem && !/[—–-]\s*(various|unknown|n\/a|various sources)[\W_]*$/i.test(body)) out.push(`    - ${body}`)
        continue
      }
      if (indent < 2) {
        const key = body.toLowerCase().replace(/\W+/g, ' ').trim()
        if (seenTopics.has(key)) continue
        seenTopics.add(key)
        out.push(`- [ ] ${body}`)
        lastWasItem = true
      } else if (lastWasItem) {
        // Under a topic: a checkbox is a subtopic, a plain bullet is a resource or detail
        out.push(hasBox ? `    - [ ] ${body}` : `    - ${body}`)
      }
      continue
    }
    if (!started && item) {
      // Topics before any heading: give them a section so they aren't lost
      out.push('## Topics', '')
      started = true
      const body = clean(item[3])
      if (body) {
        out.push(`- [ ] ${body}`)
        lastWasItem = true
      }
    }
    // Any other prose is commentary and is dropped
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ---------- How the roadmap page shows each line ----------

/** "1. Foundations of Computation — CORE" → title "1. Foundations of Computation", tag "Core" */
export function headingTag(text: string): { title: string; tag?: string; suffix: string } {
  const m = text.match(/^(.*?)(\s+[—–-]\s+([A-Z][A-Z &/,]{1,30}))\s*$/)
  if (!m) return { title: text, suffix: '' }
  const tag = m[3].trim()
  return { title: m[1], tag: tag.charAt(0) + tag.slice(1).toLowerCase(), suffix: m[2] }

}

export type LineRole = 'title' | 'subhead' | 'note' | 'rule' | 'blank' | 'normal'

/**
 * What a line is for on the roadmap page. Topics and section headings are the roadmap; the rest is
 * commentary, shown only when you ask for notes. Nothing is removed from the file.
 * - the first level-1 heading is the document's title (the notebook already shows its name)
 * - a line that is only **bold text** labels a group of topics
 * - quotes, paragraphs and plain (unticked) bullets are notes, unless they're reading suggestions
 */
export function lineRole(lines: OutlineLine[], i: number): LineRole {
  const l = lines[i]
  if (l.kind === 'heading') return l.level === 1 && lines.findIndex((x) => x.kind === 'heading' && x.level === 1) === i ? 'title' : 'normal'
  if (l.kind === 'raw') {
    const t = l.text.trim()
    if (!t) return 'blank'
    if (/^([-*_])\1{2,}$/.test(t)) return 'rule'
    if (/^\*\*[^*]+\*\*:?$/.test(t)) return 'subhead'
    return 'note'
  }
  if (l.checked === null && !/^_.+_$/.test(l.text.trim())) return 'note'
  return 'normal'
}

// ---------- The reading lines a drafted roadmap names ----------

/** "    - *Fluent Python — Luciano Ramalho*" and the like: an indented, italic line under a topic */
const RESOURCE_LINE = /^(\s{2,}-\s+)([_*])(.+)\2\s*$/

/** The reading each resource line names (title and author), by line number */
export function outlineResources(md: string): { line: number; title: string; by?: string }[] {
  const out: { line: number; title: string; by?: string }[] = []
  md.split('\n').forEach((l, line) => {
    const m = l.match(RESOURCE_LINE)
    if (!m) return
    // A small model sometimes writes underscores for spaces inside the italics
    const text = m[3].replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    const [title, by] = text.split(/\s+[—–]\s+|\s+-\s+|,\s+by\s+|\s+by\s+/i)
    if (title?.trim()) out.push({ line, title: title.trim(), ...(by?.trim() ? { by: by.trim() } : {}) })
  })
  return out
}

/** Keeps the resource lines found to be real (written with their checked author) and drops the rest */
export function applyResourceChecks(md: string, checked: { line: number; title: string; by?: string; ok: boolean }[]): string {
  const byLine = new Map(checked.map((c) => [c.line, c]))
  return md
    .split('\n')
    .flatMap((l, i) => {
      const c = byLine.get(i)
      if (!c) return [l]
      if (!c.ok) return []
      const indent = l.match(/^\s*-\s+/)?.[0] ?? '    - '
      return [`${indent}_${c.title}${c.by ? ` — ${c.by}` : ''}_`]
    })
    .join('\n')
}
