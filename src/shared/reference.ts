/**
 * Offline reference: the Python docs, the CPython source, cppreference, the Linux man pages and a
 * shelf of openly licensed textbooks, kept under Tide's data folder and searched by the tutor's
 * reference_lookup tool (main/reference). This file is the pure part: turning a page into sections,
 * source code into function-sized passages, and a passage into the citation the tutor quotes.
 */

export type RefSource = 'python-docs' | 'cpython' | 'cpp' | 'man' | 'books'
export const REF_SOURCES: RefSource[] = ['python-docs', 'cpython', 'cpp', 'man', 'books']

export const REF_LABELS: Record<RefSource, string> = {
  'python-docs': 'Python 3.15 docs',
  cpython: 'CPython 3.15 source',
  cpp: 'cppreference',
  man: 'Linux man pages',
  books: 'Open textbooks'
}

/** One passage of a reference: a docs section, a function in the source, a man page section */
export interface RefPassage {
  source: RefSource
  /** The file, from the source's folder: "reference/datamodel.html", "Objects/longobject.c" */
  path: string
  /** A docs section's id (the part after # in its URL) */
  anchor?: string
  /** The first line of a passage of source code, from 1 */
  line?: number
  /** The page's or file's title */
  title: string
  /** The section heading, or the function's name */
  heading: string
  text: string
}

export interface RefHit extends RefPassage {
  /** The citation to quote: reference/datamodel.html#object.__hash__ or Objects/longobject.c:1234 */
  cite: string
  score: number
}

/** Per source, for Settings › Reference & data */
export interface RefSourceStatus {
  id: RefSource
  label: string
  folder: string
  exists: boolean
  bytes: number
  files: number
  passages: number
  indexedAt?: number
  /** Seconds the last build took */
  seconds?: number
  building?: { done: number; total: number }
  error?: string
}

export interface DatasetStatus {
  id: string
  label: string
  folder: string
  exists: boolean
  bytes: number
  tables: { name: string; file: string; rows?: number; columns: string[] }[]
}

export interface SemanticStatus {
  /** The Python with mlx-embeddings in it, when there is one */
  python?: string
  model: string
  items: number
  vectors: number
  bytes: number
  indexedAt?: number
  seconds?: number
  loaded: boolean
  building?: { done: number; total: number }
  error?: string
}

export interface ReferenceStatus {
  root: string
  datasetsRoot: string
  sources: RefSourceStatus[]
  datasets: DatasetStatus[]
  semantic: SemanticStatus
  /** Whether the user's python3 can read Parquet (pandas with pyarrow) */
  pythonParquet?: boolean
}

// ---------- Citations ----------

/** What the tutor writes after a quote: a docs path with its section, or a source file with its line */
export function citeOf(p: Pick<RefPassage, 'source' | 'path' | 'anchor' | 'line'>): string {
  if (p.line) return `${p.path}:${p.line}`
  return p.anchor ? `${p.path}#${p.anchor}` : p.path
}

/** The path Tide keeps a passage under in its sources (the reader opens it): ref:<source>/<cite> */
export const refSourcePath = (p: Pick<RefPassage, 'source' | 'path' | 'anchor' | 'line'>) => `ref:${p.source}/${citeOf(p)}`

/** Reads a ref: path back */
export function parseRefPath(path: string): { source: RefSource; path: string; anchor?: string; line?: number } | null {
  const m = /^ref:([a-z-]+)\/(.+)$/.exec(path ?? '')
  if (!m || !REF_SOURCES.includes(m[1] as RefSource)) return null
  const source = m[1] as RefSource
  let rest = m[2]
  const line = /:(\d+)$/.exec(rest)
  if (line) return { source, path: rest.slice(0, line.index), line: Number(line[1]) }
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    const anchor = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
    return { source, path: rest, ...(anchor ? { anchor } : {}) }
  }
  return { source, path: rest }
}

/** Whether a source's passages are code (opened in the editor at a line) rather than pages (opened in the reader) */
export const isCodeSource = (s: RefSource) => s === 'cpython'

// ---------- HTML pages into sections ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", para: '', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', times: '×' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? all
  })
}

/** The text of a piece of HTML: tags gone, blocks on their own lines, whitespace tidied */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer)\b[^]*?<\/\1>/gi, ' ')
      .replace(/<!--[^]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|dt|dd|tr|pre|h[1-6]|table|blockquote|section)>/gi, '\n')
      .replace(/<(li)\b[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const MAX_PASSAGE = 1800

/** Cuts a long text into pieces of about `max` characters on paragraph (then line) boundaries */
export function splitLong(text: string, max = MAX_PASSAGE): string[] {
  if (text.length <= max) return text ? [text] : []
  const out: string[] = []
  let buf = ''
  for (const para of text.split(/\n\n+/)) {
    const parts = para.length > max ? para.match(new RegExp(`[^]{1,${max}}(?=\\n|$)|[^]{1,${max}}`, 'g')) ?? [para] : [para]
    for (const p of parts) {
      if (buf && buf.length + p.length + 2 > max) {
        out.push(buf)
        buf = ''
      }
      buf += (buf ? '\n\n' : '') + p
    }
  }
  if (buf) out.push(buf)
  return out
}

/**
 * Splits an HTML page into sections at its headings and at the definitions Sphinx gives ids to
 * (`<dt id="object.__hash__">`), so a passage carries the exact anchor its text lives under.
 * Section ids come from the heading itself, its wrapping `<section id>`, or an `<a id>` in it.
 */
export function htmlSections(html: string): { title: string; sections: { anchor?: string; heading: string; text: string }[] } {
  const title = htmlText(/<title[^>]*>([^]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s*[—–|-]\s*(Python [\d.]+ documentation|cppreference\.com|Composing Programs)\s*$/i, '').trim()
  // The article only, when the page marks one: menus and sidebars are not the reference
  const body =
    /<div[^>]+(?:itemprop="articleBody"|role="main"|id="mw-content-text"|class="body")[^>]*>([^]*)$/i.exec(html)?.[1] ??
    /<(?:article|main)\b[^>]*>([^]*?)<\/(?:article|main)>/i.exec(html)?.[1] ??
    /<body[^>]*>([^]*)<\/body>/i.exec(html)?.[1] ??
    html
  const marks: { at: number; end: number; anchor?: string; heading: string }[] = []
  const heading = /<(h[1-4])\b([^>]*)>([^]*?)<\/\1>/gi
  for (let m: RegExpExecArray | null; (m = heading.exec(body)); ) {
    const before = body.slice(Math.max(0, m.index - 300), m.index)
    const sectionId = /<section\b[^>]*\bid="([^"]+)"[^>]*>\s*$/i.exec(before)?.[1] ?? /<div\b[^>]*\bclass="section"[^>]*\bid="([^"]+)"[^>]*>\s*$/i.exec(before)?.[1]
    const own = /\bid="([^"]+)"/.exec(m[2])?.[1] ?? /<(?:a|span)\b[^>]*\b(?:id|name)="([^"]+)"/i.exec(m[3])?.[1]
    const text = htmlText(m[3]).replace(/¶$/, '').trim()
    if (text) marks.push({ at: m.index, end: m.index + m[0].length, anchor: own ?? sectionId, heading: text })
  }
  // Sphinx definitions: <dt class="sig ..." id="object.__hash__">
  const dt = /<dt\b[^>]*\bid="([^"]+)"[^>]*>([^]*?)<\/dt>/gi
  for (let m: RegExpExecArray | null; (m = dt.exec(body)); ) {
    const text = htmlText(m[2]).replace(/¶$/, '').replace(/\s+/g, ' ').trim()
    if (text) marks.push({ at: m.index, end: m.index + m[0].length, anchor: m[1], heading: text.slice(0, 160) })
  }
  marks.sort((a, b) => a.at - b.at)
  const sections: { anchor?: string; heading: string; text: string }[] = []
  const lead = htmlText(body.slice(0, marks[0]?.at ?? body.length))
  if (lead) sections.push({ heading: title, text: lead })
  marks.forEach((mk, i) => {
    const text = htmlText(body.slice(mk.end, marks[i + 1]?.at ?? body.length))
    if (text || mk.heading) sections.push({ ...(mk.anchor ? { anchor: mk.anchor } : {}), heading: mk.heading, text })
  })
  return { title: title || sections[0]?.heading || '', sections }
}

/** A page's passages: its sections, long ones cut, each passage tagged with its section's anchor */
export function chunkHtml(source: RefSource, path: string, html: string): RefPassage[] {
  const { title, sections } = htmlSections(html)
  const out: RefPassage[] = []
  for (const s of sections) {
    if (s.text.length < 20 && !s.anchor) continue
    for (const part of splitLong(s.text)) out.push({ source, path, ...(s.anchor ? { anchor: s.anchor } : {}), title, heading: s.heading, text: part })
  }
  return out
}

// ---------- Source code into functions ----------

/**
 * Splits C or Python source into passages a function (or class, or top-level block) long, each
 * with the line it starts on. C: a definition starts at a line beginning with an identifier and
 * ending in `(…)` followed by a line of `{`; the comment just above stays with it. Python: `def`
 * and `class` at the left margin. A long function is cut into pieces, each with its own first line.
 */
export function chunkCode(source: RefSource, path: string, code: string, maxLines = 80): RefPassage[] {
  const lines = code.split('\n')
  const python = /\.py$/i.test(path)
  const starts: { line: number; name: string; weak?: boolean }[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (python) {
      const m = /^(?:async\s+)?(?:def|class)\s+(\w+)/.exec(l)
      if (m) starts.push({ line: i, name: m[1] })
    } else {
      // A C function: "static PyObject *\nlong_add(...)" or "PyLong_FromLong(long ival)" with { on the next line or this one
      const m = /^([A-Za-z_][\w \t*]*?\b)?([A-Za-z_]\w*)\s*\([^;]*$/.exec(l)
      if (m && !/^(if|for|while|switch|return|else|do)\b/.test(l) && !/^\s/.test(l)) {
        let j = i
        while (j < lines.length && j < i + 8 && !/\)\s*(\{)?\s*$/.test(lines[j])) j++
        const brace = /\{\s*$/.test(lines[j] ?? '') || /^\{/.test(lines[j + 1] ?? '')
        if (brace) {
          // Keep the return type on the line above and a comment right above that
          let s = i
          if (s > 0 && /^[A-Za-z_][\w \t*]*$/.test(lines[s - 1]) && !/;\s*$/.test(lines[s - 1])) s--
          while (s > 0 && /^\s*(\/\*|\*|\/\/)/.test(lines[s - 1])) s--
          starts.push({ line: s, name: m[2] })
        }
      } else if (/^(typedef\s+)?struct\s+(\w+)\s*\{/.test(l) || /^#define\s+\w+/.test(l)) {
        const name = /struct\s+(\w+)/.exec(l)?.[1] ?? /^#define\s+(\w+)/.exec(l)![1]
        let s = i
        while (s > 0 && /^\s*(\/\*|\*|\/\/)/.test(lines[s - 1])) s--
        const weak = !/struct/.test(l)
        // A run of #defines stays one passage: a new one starts only well after the last
        if (!starts.length || (weak ? starts[starts.length - 1].line + 20 <= s : starts[starts.length - 1].line < s)) starts.push({ line: s, name, ...(weak ? { weak } : {}) })
      }
    }
  }
  const title = path.split('/').pop() ?? path
  const out: RefPassage[] = []
  const push = (from: number, to: number, name: string) => {
    for (let a = from; a < to; a += maxLines) {
      const text = lines.slice(a, Math.min(to, a + maxLines)).join('\n').trim()
      if (text.length > 20) out.push({ source, path, line: a + 1, title, heading: name, text })
    }
  }
  if (!starts.length || starts[0].line > 0) push(0, starts[0]?.line ?? lines.length, title)
  starts.forEach((s, i) => push(s.line, starts[i + 1]?.line ?? lines.length, s.name))
  return out
}

/** A man page in roff: sections at .SH, the formatting requests dropped */
export function chunkMan(path: string, roff: string): RefPassage[] {
  const name = /^\.TH\s+"?([^\s"]+)"?\s+"?(\w+)/m.exec(roff)
  const title = name ? `${name[1].toLowerCase()}(${name[2]})` : (path.split('/').pop() ?? path)
  const out: RefPassage[] = []
  let heading = title
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    for (const part of splitLong(text)) out.push({ source: 'man', path, anchor: heading.toLowerCase().replace(/\W+/g, '-'), title, heading, text: part })
    buf = []
  }
  for (const raw of roff.split('\n')) {
    if (/^\.\\"/.test(raw) || /^'\\"/.test(raw)) continue
    const sh = /^\.S[HS]\s+"?(.*?)"?\s*$/.exec(raw)
    if (sh) {
      flush()
      heading = sh[1]
      continue
    }
    if (/^\.(PP|LP|P|sp|br|TP|IP)\b/.test(raw)) {
      buf.push(/^\.IP\s+(.+)/.exec(raw)?.[1]?.replace(/"/g, '') ?? '')
      continue
    }
    const line = raw
      .replace(/^\.(B|I|BR|IR|RB|RI|BI|IB|SM|SB)\s+/, '')
      .replace(/^\.[a-zA-Z]{1,3}\b.*$/, '')
      .replace(/\\f[BIRPC]|\\f\(..|\\&|\\\(..|\\-/g, (m) => (m === '\\-' ? '-' : ''))
      .replace(/\\e/g, '\\')
      .replace(/"/g, (q) => (raw.startsWith('.') ? '' : q))
    buf.push(line)
  }
  flush()
  return out
}

/** A Jupyter notebook (the Python Data Science Handbook): markdown and code cells as text, split at headings */
export function chunkNotebook(path: string, json: string): RefPassage[] {
  let nb: { cells?: { cell_type: string; source: string | string[] }[] }
  try {
    nb = JSON.parse(json)
  } catch {
    return []
  }
  const cells = nb.cells ?? []
  const text = (c: { source: string | string[] }) => (Array.isArray(c.source) ? c.source.join('') : c.source)
  let title = ''
  let heading = ''
  let anchor: string | undefined
  let buf: string[] = []
  const out: RefPassage[] = []
  const flush = () => {
    const t = buf.join('\n\n').trim()
    if (t.length > 20) for (const part of splitLong(t)) out.push({ source: 'books', path, ...(anchor ? { anchor } : {}), title, heading: heading || title, text: part })
    buf = []
  }
  for (const c of cells) {
    const src = text(c)
    if (c.cell_type === 'markdown') {
      for (const line of src.split('\n')) {
        const h = /^(#{1,3})\s+(.+)/.exec(line)
        if (h) {
          flush()
          heading = h[2].replace(/<[^>]+>/g, '').trim()
          anchor = heading.replace(/\s+/g, '-')
          if (!title) title = heading
        } else buf.push(line)
      }
    } else if (c.cell_type === 'code' && src.trim()) buf.push('```python\n' + src.trim() + '\n```')
  }
  flush()
  return out.filter((p) => !/^<!--|^< \[/.test(p.text))
}

/** A file of a source into passages */
export function passagesOf(s: RefSource, rel: string, text: string): RefPassage[] {
  if (s === 'cpython') return chunkCode(s, rel, text)
  if (s === 'man') return chunkMan(rel, text)
  if (s === 'books' && rel.endsWith('.ipynb')) return chunkNotebook(rel, text)
  return chunkHtml(s, rel, text)
}

// ---------- Ranking ----------

/**
 * Reciprocal rank fusion: each list votes 1/(k + rank) for what it ranked, and the sums decide.
 * Lists may be weighted; an item in only one list can still win if that list ranked it first.
 */
export function rrf<T>(lists: { items: T[]; weight?: number }[], key: (t: T) => string, k = 60): { item: T; score: number }[] {
  const acc = new Map<string, { item: T; score: number }>()
  for (const list of lists) {
    list.items.forEach((item, rank) => {
      const id = key(item)
      const add = (list.weight ?? 1) / (k + rank + 1)
      const have = acc.get(id)
      if (have) have.score += add
      else acc.set(id, { item, score: add })
    })
  }
  return [...acc.values()].sort((a, b) => b.score - a.score)
}

// ---------- The tutor's view ----------

/** What reference_lookup hands the tutor: numbered passages with their citations, clipped */
export function refToolText(hits: RefHit[], query: string, sourceIndex: (h: RefHit) => number, clip = 1100): string {
  if (!hits.length) return `Nothing in the offline reference matches "${query}". Try other words (an identifier like __hash__ or PyLong_FromLong finds its definition).`
  return [
    'Passages from the offline reference. Quote the words that settle the point and cite them as given, e.g. (Python docs: reference/datamodel.html#object.__hash__) or (CPython: Objects/longobject.c:120). In a lesson, quote with quote_source: the citation as printed after the number, and the exact words.',
    ...hits.map((h) => {
      const body = h.text.length > clip ? `${h.text.slice(0, clip)}…` : h.text
      return `[${sourceIndex(h)}] ${REF_LABELS[h.source]}: ${h.cite}\n${h.title}${h.heading && h.heading !== h.title ? ` › ${h.heading}` : ''}\n${body}`
    })
  ].join('\n\n')
}

/**
 * A message that asks what the language or the source says ("what does the data model say about
 * __hash__", "where does CPython store an int's digits"): the line that sends the tutor to
 * reference_lookup first, so the answer quotes the docs rather than memory.
 */
export function referenceHint(question: string): string {
  const q = String(question ?? '')
  const docs = /\b(data ?model|language reference|the docs|documentation|official|spec(ification)?|PEP \d+|man page|cppreference)\b|__\w+__|\bstd::\w+/i.test(q)
  const source = /\bcpython\b|\bsource code\b|\bin the source\b|\bimplemented\b|\bunder the hood\b|\b(PyObject|Py[A-Z]\w+|ob_\w+)\b/i.test(q)
  if (!docs && !source) return ''
  return `They are asking what ${source ? 'the CPython source' : 'the official reference'} says: call reference_lookup${source ? ' (source "cpython")' : ''} first, with the words or identifiers of THIS question, quote the passage that settles it and cite it as the tool gives it${source ? ' (file:line)' : ''}.`
}
