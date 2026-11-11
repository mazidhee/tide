import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { JSDOM } from 'jsdom'
import type { EpubBook, EpubChapter } from '@shared/epub'
import { openZip } from './zip'
import { EPUB, type TocItem } from './vendor/foliate-js/epub.js'

/**
 * Reads an EPUB into chapters of clean paragraphs (shared/epub). The package, its spine, its
 * navigation and each chapter's document are read by the vendored EPUB module (src/main/vendor),
 * given the zip by Tide's own reader and a DOM parser from jsdom; turning those documents into
 * paragraphs, notes and chapters is Tide's.
 */

/** The browser pieces the EPUB module expects, from jsdom (the main process has no DOM of its own) */
function ensureDom() {
  const g = globalThis as Record<string, unknown>
  if (g.DOMParser) return
  const { window } = new JSDOM('')
  g.DOMParser = window.DOMParser
  g.NodeFilter ??= window.NodeFilter
  g.CSS ??= { escape: (s: string) => String(s).replace(/["\\\]\[]/g, '\\$&') }
}

const sha1 = async (s: string) => new Uint8Array(createHash('sha1').update(s).digest())

/** Front and back matter that isn't part of the work */
const SKIP_TITLE = /^(cover|title ?page|half ?title|copyright|(table of )?contents|imprint|colophon|uncopyright|landmarks|list of (illustrations|figures|tables)|the full project gutenberg licen[cs]e|project gutenberg licen[cs]e|about this (e-?book|edition)|also by|other works|index|the books of|books by|paragraphs with first lines|index of first lines)\b/i
/** A copyright page that the contents list as if it were a chapter */
const RIGHTS = /^(copyright\b|©|all rights reserved)|\ball rights reserved\b/i
/** Book or part headings: peers of one another, so one doesn't stay the part of the next */
const PART = /\b(book|part|volume|canto)\b/i
/** A chapter this long with headings of its own (The Prophet's "On Love", "On Marriage"…) is read by its headings */
const SPLIT_OVER = 120
const SKIP_TYPE = /\b(cover|titlepage|halftitlepage|copyright-page|toc|imprint|colophon|loi|lot|landmarks|index|backmatter-licen[cs]e)\b/i
const SKIP_ID = /(^|[-_])(cover|titlepage|title-page|toc|nav|imprint|colophon|uncopyright|copyright|pg-header|pg-footer|license|licence)([-_.]|$)/i
/** Front matter worth keeping, when it comes before the first chapter */
const FRONT_TITLE = /^(preface|foreword|introduction|translator['’]s (note|preface|introduction)|editor['’]s (note|preface)|note on the (text|translation)|dedication|epigraph|to the reader|author['’]s (note|preface))\b/i
const NOTES_TITLE = /^(end ?notes|notes|footnotes)$/i
const NOTE_TYPE = /\b(footnote|endnote|rearnote|note)s?\b/i

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'dd', 'dt', 'td', 'th', 'figcaption', 'div', 'blockquote', 'section', 'article', 'header', 'footer', 'main', 'ol', 'ul', 'dl', 'table', 'tbody', 'thead', 'tr', 'figure', 'hgroup', 'body', 'nav', 'aside', 'hr'])
const HEAD = /^h[1-6]$/

interface Block {
  text: string
  head: boolean
  section: number
  /** Note ids referred to from this block, in order */
  refs: string[]
}

const local = (el: Element) => el.localName?.toLowerCase() ?? ''
const epubType = (el: Element) => `${el.getAttribute('epub:type') ?? el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ?? ''} ${el.getAttribute('role') ?? ''}`

/** An element's text with line breaks kept (verse), spaces collapsed */
function textOf(node: Node): string {
  let out = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.nodeValue ?? ''
    else if (n.nodeType === 1) {
      const el = n as Element
      if (local(el) === 'br') out += ' '
      else for (const c of Array.from(el.childNodes)) walk(c)
    }
  }
  walk(node)
  return out
    .replace(/[ \t\r\n\f ]+/g, ' ')
    .split(' ')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

const hasBlockInside = (el: Element) => Array.from(el.querySelectorAll('*')).some((d) => BLOCK.has(local(d)))

interface SectionText {
  blocks: Block[]
  /** id → index of the block it marks, within this section */
  anchors: Map<string, number>
}

/** One spine document into blocks, its notes taken out into `notes` (by id) */
function sectionBlocks(doc: Document, section: number, notes: Map<string, string>, noteSection: Map<string, number>): SectionText {
  const body = doc.querySelector('body') ?? doc.documentElement
  // Notes: kept by id, out of the running text
  for (const el of Array.from(body.querySelectorAll('aside, [epub\\:type], [role], .footnote, .endnote, li[id]'))) {
    const type = epubType(el)
    const isNote = (local(el) === 'aside' && NOTE_TYPE.test(type)) || /\b(doc-footnote|doc-endnote|footnote|endnote|rearnote)\b/i.test(type) || /\b(footnote|endnote)\b/i.test(el.getAttribute('class') ?? '')
    if (!isNote) continue
    const id = el.getAttribute('id') ?? el.querySelector('[id]')?.getAttribute('id')
    const text = textOf(el).replace(/^(↩|\^)\s*|\s*(↩︎?|↑|back)\s*$/gi, '').trim()
    if (id && text) {
      notes.set(id, text)
      noteSection.set(id, section)
    }
    el.remove()
  }
  for (const el of Array.from(body.querySelectorAll('script, style, nav, [epub\\:type~="pagebreak"], [role="doc-pagebreak"]'))) el.remove()
  const blocks: Block[] = []
  const anchors = new Map<string, number>()
  let pendingRefs: string[] = []
  // Note references: remembered against the block they sit in, then taken out of its text
  const takeRefs = (el: Element): string[] => {
    const refs: string[] = []
    for (const a of Array.from(el.querySelectorAll('a[href*="#"]'))) {
      const type = epubType(a)
      const sup = a.parentElement && local(a.parentElement) === 'sup' ? a.parentElement : null
      if (/\bnoteref\b|doc-noteref/i.test(type) || (sup && /^\[?\s*[\d*†‡a-z]{1,4}\s*\]?$/i.test(textOf(a)))) {
        refs.push(decodeURIComponent(a.getAttribute('href')!.split('#')[1] ?? ''))
        ;(sup ?? a).remove()
      }
    }
    return refs
  }
  const mark = (el: Element) => {
    const id = el.getAttribute('id') ?? el.getAttribute('name')
    if (id && !anchors.has(id)) anchors.set(id, blocks.length)
  }
  const emit = (text: string, head: boolean, refs: string[]) => {
    if (!/[\p{L}\p{N}]/u.test(text)) return
    blocks.push({ text, head, section, refs: [...pendingRefs, ...refs] })
    pendingRefs = []
  }
  const walk = (el: Element) => {
    let inline: Node[] = []
    const flush = () => {
      if (!inline.length) return
      const holder = doc.createElement('span')
      for (const n of inline) holder.appendChild(n.cloneNode(true))
      const refs = takeRefs(holder)
      emit(textOf(holder), false, refs)
      inline = []
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        const c = child as Element
        if (!BLOCK.has(local(c))) {
          // Ids inside inline content mark the block it ends up in
          mark(c)
          c.querySelectorAll('[id]').forEach(mark)
          inline.push(c)
          continue
        }
        flush()
        mark(c)
        if (local(c) === 'hr') continue
        if (hasBlockInside(c)) walk(c)
        else {
          c.querySelectorAll('[id]').forEach(mark)
          const refs = takeRefs(c)
          emit(textOf(c), HEAD.test(local(c)) || /\b(title|heading|chapter-title)\b/i.test(c.getAttribute('class') ?? ''), refs)
        }
      } else if (child.nodeType === 3) {
        if ((child.nodeValue ?? '').trim()) inline.push(child)
      }
    }
    flush()
  }
  walk(body)
  return { blocks, anchors }
}

const langValue = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v as Record<string, string>)[0] ?? '') : '')

interface Entry {
  label: string
  href: string
  parents: string[]
}

const flatten = (items: TocItem[] | null | undefined, parents: string[] = []): Entry[] =>
  (items ?? []).flatMap((t) => [{ label: (t.label ?? '').replace(/\s+/g, ' ').trim(), href: t.href, parents }, ...flatten(t.subitems, [...parents, (t.label ?? '').replace(/\s+/g, ' ').trim()])])

/** Gutenberg wraps its texts in a header and a licence: only what lies between the markers is the book */
function trimGutenberg(blocks: Block[]): Block[] {
  const start = blocks.findIndex((b) => /^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG/i.test(b.text))
  const end = blocks.findIndex((b) => /^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i.test(b.text))
  return blocks.map((b, i) => ((start >= 0 && i <= start) || (end >= 0 && i >= end) ? { ...b, text: '' } : b))
}

export async function parseEpub(data: Buffer): Promise<EpubBook> {
  ensureDom()
  const zip = openZip(data)
  if (!zip.has('META-INF/container.xml')) throw new Error('That file isn’t an EPUB (it has no container).')
  const book = await new EPUB({
    loadText: (name) => zip.text(name),
    loadBlob: (name) => new Blob([new Uint8Array(zip.bytes(name) ?? Buffer.alloc(0))]),
    getSize: (name) => zip.size(name),
    sha1
  }).init()

  const notes = new Map<string, string>()
  const noteSection = new Map<string, number>()
  let all: Block[] = []
  /** "href#id" and "href" → index in `all` */
  const at = new Map<string, number>()
  const skipped = new Set<number>()
  const printed: Entry[][] = []
  for (const [i, s] of book.sections.entries()) {
    let doc: Document
    try {
      doc = await s.createDocument()
    } catch {
      continue
    }
    const body = doc.querySelector('body')
    const types = [body, ...Array.from(body?.querySelectorAll(':scope > section, :scope > div') ?? [])].map((e) => (e ? epubType(e) : '')).join(' ')
    const skip = s.linear === 'no' || SKIP_ID.test(s.id.split('/').pop() ?? '') || (SKIP_TYPE.test(types) && !/\b(bodymatter|chapter|part)\b/i.test(types))
    // A contents page printed in the book: its links, kept in case the navigation lists too little
    const links = Array.from(doc.querySelectorAll('a[href]'))
      .map((a) => ({ label: textOf(a).replace(/\n/g, ' '), href: a.getAttribute('href') ?? '' }))
      .filter((l) => /\p{L}{2}/u.test(l.label) && !/↩|^back$/i.test(l.label) && !/^[a-z]+:/i.test(l.href) && /#|\.x?html?/i.test(l.href))
    // Only near the front, where a printed contents page sits (not an index or the notes at the back)
    if (links.length >= 5 && i <= Math.max(2, book.sections.length / 4)) printed.push(links.map((l) => ({ label: l.label, href: s.resolveHref ? s.resolveHref(l.href) : l.href, parents: [] })))
    const { blocks, anchors } = sectionBlocks(doc, i, notes, noteSection)
    // An endnotes document: its notes are kept (above), the document isn't read as a chapter
    const endnotes = /\bendnotes|rearnotes|footnotes\b/i.test(types)
    if (skip || endnotes) skipped.add(i)
    at.set(s.id, all.length)
    for (const [id, k] of anchors) at.set(`${s.id}#${id}`, all.length + k)
    all.push(...blocks)
  }
  all = trimGutenberg(all)

  const where = (href: string): number | undefined => {
    const [path, hash] = href.split('#')
    const file = decodeURI(path)
    return hash ? (at.get(`${file}#${decodeURIComponent(hash)}`) ?? at.get(file)) : at.get(file)
  }
  const place = (list: Entry[]) =>
    list
      .map((e) => ({ ...e, index: where(e.href) }))
      .filter((e): e is Entry & { index: number } => e.index !== undefined)
      .sort((a, b) => a.index - b.index)
  let entries = place(flatten(book.toc))
  // The navigation lists less than a contents page printed in the book does (Gutenberg's older
  // texts): read by the printed contents
  const fuller = printed.map(place).sort((a, b) => b.length - a.length)[0]
  if (fuller && fuller.length >= 5 && fuller.length > entries.length * 2) entries = fuller

  // Ranges of blocks, each a chapter candidate with its title
  type Range = { title: string; parents: string[]; from: number; to: number }
  const ranges: Range[] = []
  if (entries.length >= 2) {
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k]
      const to = entries[k + 1]?.index ?? all.length
      if (to <= e.index && k < entries.length - 1) continue
      ranges.push({ title: e.label, parents: e.parents, from: e.index, to })
    }
  } else {
    // No usable contents: one chapter for each document of the spine
    let from = 0
    for (let k = 1; k <= all.length; k++) {
      if (k === all.length || all[k].section !== all[k - 1].section) {
        const head = all.slice(from, k).find((b) => b.head)?.text ?? ''
        ranges.push({ title: head.replace(/\n/g, ' '), parents: [], from, to: k })
        from = k
      }
    }
  }

  const chapters: EpubChapter[] = []
  const front: EpubChapter = { n: 0, title: 'Front matter', paragraphs: [], notes: [], heads: [] }
  let carried: string[] = []
  let n = 0
  for (const r of ranges) {
    const blocks = all.slice(r.from, r.to).filter((b) => b.text && !skipped.has(b.section))
    const title = r.title || blocks.find((b) => b.head)?.text.replace(/\n/g, ' ') || ''
    if (SKIP_TITLE.test(title) || NOTES_TITLE.test(title)) continue
    // Leading headings are the chapter's title, not its text
    let lead = 0
    while (lead < blocks.length && blocks[lead].head) lead++
    const body = blocks.slice(lead)
    if (!body.length) {
      // A part's own heading, with its chapters after it: its name goes with them
      carried = [...r.parents, title].filter(Boolean)
      continue
    }
    if (body.length <= 6 && RIGHTS.test(body[0].text)) continue
    // A list of short lines before the first chapter is a contents page
    if (!n && body.length >= 5 && body.every((b) => b.text.length < 70)) continue
    if (PART.test(title)) carried = []
    const refs = blocks.flatMap((b) => b.refs)
    // Notes it refers to, then any footnote printed in its own pages that nothing points at
    const sections = new Set(body.map((b) => b.section))
    const loose = [...noteSection].filter(([id, sec]) => sections.has(sec) && !skipped.has(sec) && !refs.includes(id)).map(([id]) => id)
    const chNotes = [...refs, ...loose].map((id) => notes.get(id)).filter((t): t is string => !!t)
    const parents = (r.parents.length ? r.parents : carried).filter((p) => p && p !== title && !SKIP_TITLE.test(p))
    if (!n && FRONT_TITLE.test(title)) {
      front.heads!.push({ para: front.paragraphs.length + 1, title })
      front.paragraphs.push(...body.map((b) => b.text))
      front.notes.push(...chNotes)
      continue
    }
    // Split at the chapter's own headings when it is long and has them
    const heads = body.map((b, i) => (b.head ? i : -1)).filter((i) => i > 0)
    const pieces = body.length > SPLIT_OVER && heads.length >= 3 ? [0, ...heads].map((from, k, all) => ({ title: k ? body[from].text.replace(/\n/g, ' ') : title, blocks: body.slice(k ? from + 1 : 0, all[k + 1] ?? body.length) })) : [{ title, blocks: body }]
    for (const piece of pieces) {
      if (!piece.blocks.length) continue
      n++
      const part = pieces.length > 1 && piece.title !== title ? [...parents, title] : parents
      chapters.push({ n, title: piece.title || `Chapter ${n}`, ...(part.length ? { part: part.join(' › ') } : {}), paragraphs: piece.blocks.map((b) => b.text), notes: pieces.length > 1 ? (piece === pieces[0] ? chNotes : []) : chNotes })
    }
  }
  const m = (book.metadata ?? {}) as Record<string, unknown>
  // The module gives a single value where there's one, a list where there are more
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : [])
  const names = (v: unknown) => list(v).map((a) => langValue((a as { name?: unknown })?.name ?? a)).filter(Boolean)
  const authors = names(m.author)
  const subjects = names(m.subject)
  const language = langValue(list(m.language)[0])
  return {
    title: langValue(m.title) || 'Untitled',
    ...(authors.length ? { author: authors.join(', ') } : {}),
    ...(language ? { language } : {}),
    ...(subjects.length ? { subjects } : {}),
    chapters: front.paragraphs.length ? [front, ...chapters] : chapters
  }
}

// ---------- Cached per version of the file, like PDF text ----------

const memo = new Map<string, EpubBook>()

/** A book in the notes folder, read once per version (kept in .tide/epubtext) */
export async function epubBook(rel: string, abs: (rel: string) => string, write: (rel: string, text: string) => Promise<void>): Promise<EpubBook> {
  const full = abs(rel)
  const stat = await fs.stat(full)
  const key = createHash('sha1').update(`${rel}:${stat.size}:${stat.mtimeMs}:v1`).digest('hex')
  const hit = memo.get(key)
  if (hit) return hit
  const cacheRel = `.tide/epubtext/${key}.json`
  let book: EpubBook
  if (existsSync(abs(cacheRel))) book = JSON.parse(await fs.readFile(abs(cacheRel), 'utf8'))
  else {
    book = await parseEpub(await fs.readFile(full))
    await write(cacheRel, JSON.stringify(book)).catch(() => {})
  }
  memo.set(key, book)
  if (memo.size > 6) memo.delete(memo.keys().next().value!)
  return book
}
