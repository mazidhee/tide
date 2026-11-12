/**
 * Free online books with an open table of contents (mdBook, Jupyter Book, Sphinx, Quarto,
 * bookdown, MkDocs) and official guides read in a set order, as Tide courses. A book: its contents
 * page read for the order (parts become modules, chapters lessons), then each chapter's page read
 * for its text; a Jupyter Book's chapter that offers its notebook is kept as that notebook, so its
 * code runs in Tide. A guide: its listed pages, HTML or PDF, in order.
 *
 * Only pages under the book's own address are read, at most `maxPages` (150 unless the catalogue
 * says), one a second.
 */
import { fingerprint } from '@shared/courseSource'
import { splitOutline } from '@shared/courses'
import type { CatalogueCourse } from '@shared/courseCatalogue'
import { SourceRefused, type Fetcher } from './fetcher'
import { absUrl, flatten, mainText, parseHtml, parseToc, textOf, type Doc, type TocNode } from './html'
import { pdfMarkdown } from './pdf'
import { chunk, type Adapter, type Built, type BuiltLesson, type BuiltModule } from './types'

/** The folder a book lives under: its pages are read only there */
export const bookBase = (url: string) => {
  const u = new URL(url)
  u.hash = ''
  u.search = ''
  u.pathname = u.pathname.replace(/[^/]*$/, '')
  return u.toString()
}

const inBook = (url: string | undefined, base: string) => !!url && url.startsWith(base) && !/\.(pdf|zip|png|jpe?g|gif|svg|ipynb|py|txt|epub)$/i.test(url.split('?')[0]) && !/\/(genindex|search|py-modindex|bibliography)\.html$/.test(url)

/**
 * A table of contents as modules: a part (an entry with entries under it) is a module, its own page
 * (if it has one) its first lesson; entries with nothing under them, side by side, form modules
 * named by what they are; a book that is one flat list is cut into modules of about eight.
 */
export function tocModules(nodes: TocNode[], base: string, max = 150): { title: string; pages: { title: string; url: string }[] }[] {
  const seen = new Set<string>()
  const take = (n: TocNode) => {
    if (!inBook(n.url, base) || seen.has(n.url!) || seen.size >= max) return null
    seen.add(n.url!)
    return { title: n.title, url: n.url! }
  }
  const parted = nodes.some((n) => n.children.length)
  if (!parted) {
    const pages = nodes.map(take).filter((x): x is { title: string; url: string } => !!x)
    return chunk(
      pages.map((p) => ({ ...p, kind: 'reading' as const, markdown: '' })),
      (a, b) => (pages.length <= 8 ? 'Chapters' : `Chapters ${a}–${b}`)
    ).map((m) => ({ title: m.title, pages: m.lessons.map((l) => ({ title: l.title, url: l.url })) }))
  }
  const out: { title: string; pages: { title: string; url: string }[] }[] = []
  let loose: { title: string; url: string }[] = []
  const flushLoose = () => {
    if (loose.length) out.push({ title: out.length ? 'More' : 'Front matter', pages: loose })
    loose = []
  }
  for (const n of nodes) {
    if (!n.children.length) {
      const p = take(n)
      if (p) loose.push(p)
      continue
    }
    flushLoose()
    const pages = [take(n), ...flatten(n.children).map(take)].filter((x): x is { title: string; url: string } => !!x)
    if (pages.length) out.push({ title: n.title.replace(/^\d+(\.\d+)*\.?\s+/, ''), pages })
  }
  flushLoose()
  return out
}

/** A Jupyter Book page's own notebook, when it offers one (its download link) */
export function notebookLink(doc: Doc, base: string): string | null {
  for (const a of doc.querySelectorAll('a[href*=".ipynb"]')) {
    const u = absUrl(a.getAttribute('href'), doc.URL)
    if (u && u.startsWith(new URL(base).origin) && /\.ipynb$/i.test(u.split('?')[0])) return u
  }
  return null
}

/** The table of contents: on the contents page, or (a newer mdBook) in its toc.html */
async function contents(c: CatalogueCourse, f: Fetcher): Promise<{ base: string; nodes: TocNode[]; version: string }> {
  const start = c.url!
  const base = bookBase(start)
  const page = await f.page(start)
  let nodes = parseToc(parseHtml(page.text, page.url), page.url, c.toc)
  if (nodes.length < 2 && /toc\.js|mdbook/i.test(page.text)) {
    const toc = await f.page(new URL('toc.html', base).toString(), { allowMissing: true }).catch(() => null)
    if (toc && toc.status === 200) nodes = parseToc(parseHtml(toc.text, toc.url), base, c.toc)
  }
  if (nodes.length < 2) throw new SourceRefused('unreachable', start, `No table of contents was found at ${start}`)
  const version = fingerprint(JSON.stringify(flatten(nodes).map((n) => [n.title, n.url ?? ''])))
  return { base, nodes, version }
}

const EXERCISE = /\b(exercises?|problems?|problem sets?|homework|assignments?|labs?|quiz)\b/i

async function readPages(c: CatalogueCourse, f: Fetcher, plan: { title: string; pages: { title: string; url: string }[] }[], progress: (d: string) => void, notebooks: boolean, base: string) {
  const modules: BuiltModule[] = []
  const notes: string[] = []
  /** Each page's fingerprint, as the guide's check makes it */
  const prints: string[] = []
  const total = plan.reduce((n, m) => n + m.pages.length, 0)
  let i = 0
  for (const m of plan) {
    const lessons: BuiltLesson[] = []
    for (const p of m.pages) {
      i++
      progress(`Page ${i} of ${total}`)
      try {
        if (/\.pdf($|\?)/i.test(p.url)) {
          const bytes = await f.bytes(p.url)
          prints.push(`${p.url}:${bytes?.length ?? 0}`)
          const text = await pdfMarkdown(bytes)
          lessons.push({ title: p.title, url: p.url, kind: EXERCISE.test(p.title) ? 'homework' : 'reading', markdown: `[The document as a PDF](${p.url})${text ? `\n\n${text}` : ''}` })
          if (!text) notes.push(`${p.title}: the PDF is linked, its text wasn't read`)
          continue
        }
        const page = await f.page(p.url)
        const doc = parseHtml(page.text, page.url)
        const md = mainText(doc, page.url)
        prints.push(`${p.url}:${fingerprint(md)}`)
        const nbUrl = notebooks ? notebookLink(doc, base) : null
        const nb = nbUrl ? await f.page(nbUrl).catch(() => null) : null
        const raw = nb && /^\s*\{/.test(nb.text) ? nb.text : undefined
        if (!md.trim() && !raw) {
          notes.push(`${p.title}: no text found`)
          continue
        }
        const title = p.title || textOf(doc.querySelector('h1')) || doc.title
        lessons.push({ title, url: page.url, kind: raw ? 'notebook' : EXERCISE.test(title) ? 'homework' : 'reading', markdown: md, ...(raw ? { notebook: raw } : {}) })
      } catch (e) {
        if (e instanceof SourceRefused && e.why !== 'unreachable') throw e
        notes.push(`${p.title}: ${(e as Error).message}`)
        prints.push(`${p.url}:-`)
      }
    }
    if (lessons.length) modules.push({ title: m.title, lessons })
  }
  return { modules, notes, prints }
}

/** A guide's pages, grouped by the module each names (pages without one join the module before) */
export function guidePlan(c: CatalogueCourse): { title: string; pages: { title: string; url: string }[] }[] {
  const out: { title: string; pages: { title: string; url: string }[] }[] = []
  for (const p of c.pages ?? []) {
    if (p.module || !out.length) out.push({ title: p.module ?? 'The guide', pages: [] })
    out[out.length - 1].pages.push({ title: p.title, url: p.url })
  }
  return out.filter((m) => m.pages.length)
}

export const site: Adapter = {
  async probe(c, f) {
    return (await contents(c, f)).version
  },
  async build(c, f, progress): Promise<Built> {
    const { base, nodes, version } = await contents(c, f)
    const plan = tocModules(nodes, base, c.maxPages ?? 150)
    // A manual on one long page (its contents are links into it): the page, cut at its headings
    if (plan.reduce((n, m) => n + m.pages.length, 0) === 1 && flatten(nodes).length > 3) {
      progress('Reading the manual')
      const page = await f.page(plan[0].pages[0].url)
      const md = mainText(parseHtml(page.text, page.url), page.url)
      const o = splitOutline(md, 'page')
      const modules: BuiltModule[] = o.modules.map((m) => ({ title: m.title, lessons: m.lessons.map((l) => ({ title: l.title, url: `${page.url}#${l.id.split('#')[1] ?? ''}`, kind: EXERCISE.test(l.title) ? ('homework' as const) : ('reading' as const), markdown: md.slice(l.range![0], l.range![1]).trim() })) }))
      return { modules, version, captions: [], notes: [] }
    }
    const { modules, notes } = await readPages(c, f, plan, progress, true, base)
    if (flatten(nodes).length > (c.maxPages ?? 150)) notes.push(`Only the first ${c.maxPages ?? 150} pages are read`)
    return { modules, version, captions: [], notes }
  }
}

export const docs: Adapter = {
  /** A guide has no contents page to compare: each page's text is, so the check reads them all (a guide is short) */
  async probe(c, f) {
    const parts: string[] = []
    for (const p of c.pages ?? []) {
      if (/\.pdf($|\?)/i.test(p.url)) {
        const b = await f.bytes(p.url).catch(() => null)
        parts.push(`${p.url}:${b?.length ?? 0}`)
        continue
      }
      const page = await f.page(p.url).catch(() => null)
      parts.push(`${p.url}:${page ? fingerprint(mainText(parseHtml(page.text, page.url), page.url)) : '-'}`)
    }
    return fingerprint(parts.join('\n'))
  },
  async build(c, f, progress) {
    const plan = guidePlan(c)
    const { modules, notes, prints } = await readPages(c, f, plan, progress, false, c.url ?? plan[0]?.pages[0]?.url ?? '')
    // The same fingerprint the check makes, from what was read
    return { modules, version: fingerprint(prints.join('\n')), captions: [], notes }
  }
}
