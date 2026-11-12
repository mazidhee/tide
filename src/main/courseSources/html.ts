/**
 * Reading course pages: a page's HTML as a document, its table of contents as a tree, and its main
 * text as the Markdown Tide renders (code with its language, maths as TeX, tables as tables, links
 * and pictures made absolute). Pure apart from jsdom, so the adapters are tested on saved pages.
 */
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

export type Doc = Document

export function parseHtml(html: string, url: string): Doc {
  return new JSDOM(html, { url }).window.document
}

export const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** An href made absolute against the page, without its #fragment; null for anything not http(s) */
export function absUrl(href: string | null | undefined, base: string, keepHash = false): string | null {
  if (!href || /^(javascript:|mailto:|tel:|data:)/i.test(href.trim())) return null
  try {
    const u = new URL(href.trim(), base)
    if (!/^https?:$/.test(u.protocol)) return null
    if (!keepHash) u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

// ---------- HTML → Markdown ----------

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
td.remove(['script', 'style', 'noscript', 'iframe', 'button', 'form', 'nav', 'template', 'select', 'input'])
td.remove((node) => node.nodeName.toLowerCase() === 'svg')
td.addRule('code-lang', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const el = node as HTMLElement
    const code = el.querySelector('code') ?? el
    const cls = `${code.getAttribute('class') ?? ''} ${el.getAttribute('class') ?? ''} ${el.parentElement?.getAttribute('class') ?? ''} ${el.parentElement?.parentElement?.getAttribute('class') ?? ''}`
    const lang = cls.match(/(?:language|lang|highlight|sourceCode)-([\w+#-]+)/)?.[1]?.replace(/^(ipython3?|python3|default|none|text|console)$/, (m) => (m.startsWith('ipython') || m === 'python3' ? 'python' : '')) ?? (el.getAttribute('data-lang') || '')
    const text = (code.textContent ?? '').replace(/\n+$/, '')
    const fence = '`'.repeat(Math.max(3, ...(text.match(/`{3,}/g) ?? []).map((t) => t.length + 1)))
    return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`
  }
})
td.addRule('table', {
  filter: 'table',
  replacement: (_c, node) => {
    const rows = [...(node as HTMLTableElement).querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()))
    const wide = Math.max(0, ...rows.map((r) => r.length))
    if (!rows.length || !wide) return ''
    const pad = (r: string[]) => [...r, ...Array(wide - r.length).fill('')]
    const [head, ...body] = rows
    return `\n\n| ${pad(head).join(' | ')} |\n| ${Array(wide).fill('---').join(' | ')} |\n${body.map((r) => `| ${pad(r).join(' | ')} |`).join('\n')}\n\n`
  }
})

/** Maths swapped for placeholders before turndown (which would escape the TeX), put back after */
function protectMath(root: Element, formulas: string[]) {
  const doc = root.ownerDocument
  const put = (el: Element, tex: string, block: boolean) => {
    formulas.push(block ? `\n\n$$${tex.trim()}$$\n\n` : `$${tex.trim()}$`)
    el.replaceWith(doc.createTextNode(`TIDEMATH${formulas.length - 1}X`))
  }
  root.querySelectorAll('script[type^="math/tex"]').forEach((s) => put(s, s.textContent ?? '', /mode=display/.test(s.getAttribute('type') ?? '')))
  root.querySelectorAll('math').forEach((m) => {
    const tex = m.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex) put(m, tex, m.getAttribute('display') === 'block')
  })
  // MathJax's source left in the text: \( … \), \[ … \], $$ … $$ in .math spans and divs
  root.querySelectorAll('.math, .arithmatex').forEach((el) => {
    const t = (el.textContent ?? '').trim()
    const m = t.match(/^\\\(([\s\S]*)\\\)$/) ?? t.match(/^\$([^$][\s\S]*)\$$/)
    const b = t.match(/^\\\[([\s\S]*)\\\]$/) ?? t.match(/^\$\$([\s\S]*)\$\$$/)
    if (b) put(el, b[1], true)
    else if (m) put(el, m[1], false)
    else if (el.tagName === 'DIV' && t) put(el, t.replace(/^\\begin\{equation\*?\}|\\end\{equation\*?\}$/g, ''), true)
  })
}

/** Elements that are a page's furniture, not its text */
const FURNITURE = [
  'header.site-header',
  'nav',
  'footer',
  '.headerlink',
  'a.headerlink',
  '.copybtn',
  '.anchorjs-link',
  '.sidebar',
  '.prev-next-area',
  '.bd-header-article',
  '.toc',
  '#toc',
  '.quarto-title-meta',
  '.nav-wrapper',
  '.mobile-nav-chapters',
  '.page-toc',
  '.breadcrumb',
  '.edit-this-page',
  '.cell-output-display img[src^="data:"]'
]

/**
 * An element's content as Markdown: furniture removed, links and pictures absolute, code fenced
 * with its language, maths as $…$.
 */
export function htmlToMarkdown(el: Element, base: string): string {
  const clone = el.cloneNode(true) as Element
  for (const sel of FURNITURE) clone.querySelectorAll(sel).forEach((x) => x.remove())
  clone.querySelectorAll('a[href]').forEach((a) => {
    const u = absUrl(a.getAttribute('href'), base, true)
    if (u) a.setAttribute('href', u)
  })
  clone.querySelectorAll('img').forEach((img) => {
    const u = absUrl(img.getAttribute('data-src') || img.getAttribute('src'), base)
    if (u) img.setAttribute('src', u)
    else img.remove()
  })
  const formulas: string[] = []
  protectMath(clone, formulas)
  return td
    .turndown(clone.innerHTML)
    .replace(/TIDEMATH(\d+)X/g, (_, i) => formulas[Number(i)])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The main text of a page: the first of these that has some words in it */
export const MAIN = [
  'main#course-content-section',
  '#main-course-section',
  'article.bd-article',
  'main.bd-main [role="main"]',
  '[role="main"] .section',
  'div[role="main"]',
  'main#quarto-document-content',
  '#quarto-document-content',
  'main .content',
  '#content main',
  'main article',
  '.book-body .page-inner section',
  'article.md-content__inner',
  'div.document div.body',
  'div.body',
  'article',
  'main',
  '#content',
  'body'
]

export function mainText(doc: Doc, base: string, selectors: string[] = MAIN): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el && textOf(el).split(' ').length >= 40) return htmlToMarkdown(el, base)
  }
  return ''
}

// ---------- Tables of contents ----------

export interface TocNode {
  title: string
  /** The page, absolute and without its #fragment; absent for a heading that only groups its children */
  url?: string
  children: TocNode[]
}

/** Where books keep their table of contents, most specific first */
export const TOC = [
  'ol.chapter',
  'nav.bd-docs-nav',
  'nav#bd-docs-nav',
  '.bd-sidebar-primary nav.bd-links',
  'nav.bd-links',
  '#quarto-sidebar .sidebar-menu-container',
  '.book-summary ul.summary',
  'nav.md-nav--primary',
  '.globaltoc',
  '.sphinxsidebarwrapper',
  '.wy-menu-vertical',
  '.toctree-wrapper',
  'nav.menu',
  '#TOC',
  'nav#toc',
  '.toc'
]

/** The list items of a list element, as a tree: each item's own link (or label) and the lists under it */
function itemsOf(list: Element, base: string, depth: number): TocNode[] {
  const out: TocNode[] = []
  for (const li of [...list.children].filter((c) => c.tagName === 'LI')) {
    // Its own label: the first link not inside a nested list, else its own text before the nested list
    const own = [...li.querySelectorAll('a[href]')].find((a) => !a.parentElement?.closest('li ul, li ol') || a.parentElement.closest('li') === li)
    const ownA = own && own.closest('li') === li ? own : undefined
    const nested = [...li.querySelectorAll(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol')]
    const label = ownA ? textOf(ownA) : textOf(li.querySelector(':scope > span, :scope > div > a, :scope > div > span, :scope > strong, :scope > p') ?? null) || (li.childNodes[0]?.textContent ?? '').trim()
    const url = ownA ? absUrl(ownA.getAttribute('href'), base) ?? undefined : undefined
    const children = depth < 3 ? nested.flatMap((n) => itemsOf(n, base, depth + 1)) : []
    if (!label && !children.length) continue
    out.push({ title: label.replace(/^\d+(\.\d+)*\.?\s+/, (m) => (url ? m : m)).trim(), ...(url ? { url } : {}), children })
  }
  return out
}

/** A page's table of contents as a tree, from the first place it is found (or `selector`) */
export function parseToc(doc: Doc, base: string, selector?: string): TocNode[] {
  for (const sel of selector ? [selector] : TOC) {
    const box = doc.querySelector(sel)
    if (!box) continue
    // The lists at the top of the box (some themes split the contents into several)
    const lists = box.matches('ul,ol') ? [box] : [...box.querySelectorAll('ul,ol')].filter((l) => !l.parentElement?.closest('li') || !box.contains(l.parentElement.closest('li')))
    const nodes = lists.flatMap((l) => itemsOf(l, base, 1))
    if (nodes.filter((n) => n.url || n.children.length).length >= 2) return nodes
  }
  return []
}

/** Every page of a tree, in reading order */
export const flatten = (nodes: TocNode[]): TocNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)])
