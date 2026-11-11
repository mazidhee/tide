/**
 * Free readings for a topic: what may be suggested, what may be downloaded, and how a model's
 * suggestions are checked. Only legal, free sources; piracy sites are never linked or fetched.
 */

export interface Reading {
  title: string
  by?: string
  /** What it's for, in a few words */
  why?: string
  url: string
  /** Saved in the Library (a PDF), when it was small enough and from a site PDFs are taken from */
  path?: string
  kind: 'paper' | 'spec' | 'docs' | 'book' | 'article' | 'encyclopedia'
}

/** Never linked, never fetched */
const BLOCKED = /(^|\.)(libgen|library\.lol|z-lib|zlibrary|z-library|1lib|sci-hub|scihub|annas-archive|pdfdrive|b-ok|bookfi|ebookee|freebookspot|pdfroom|vdoc\.pub|epdf\.pub|dokumen\.pub|ebin\.pub|silo\.pub)\b/i

/** Sites PDFs may be downloaded from: open-access archives, standards bodies, course and project sites */
const PDF_HOSTS = /(^|\.)(arxiv\.org|rfc-editor\.org|ietf\.org|usenix\.org|raft\.github\.io|pdos\.csail\.mit\.edu|ocw\.mit\.edu|bitcoin\.org|ethereum\.org|ethereum\.github\.io|research\.google|static\.googleusercontent\.com|lamport\.azurewebsites\.net|cs\.cornell\.edu|cs\.stanford\.edu|people\.csail\.mit\.edu|cs\.princeton\.edu|eecs\.berkeley\.edu|openstax\.org|nber\.org|bis\.org|federalreserve\.gov|imf\.org)$/i

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export const isBlocked = (url: string) => BLOCKED.test(hostOf(url))

/** A site PDFs may come from, over https, by name (never an address on this Mac or the local network) */
export function pdfHostAllowed(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || /^[\d.]+$|^\[|:/.test(host) || host === 'localhost') return false
  return !isBlocked(url) && PDF_HOSTS.test(host)
}

/** The PDF behind a link, when there is one Tide may download: arXiv's abstract pages become their PDF */
export function pdfFor(url: string): string | null {
  if (!pdfHostAllowed(url.replace(/^http:/i, 'https:'))) return null
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:[?#].*)?$/i)
  if (arxiv) return `https://arxiv.org/pdf/${arxiv[1]}`
  return /\.pdf($|[?#])/i.test(url) ? url.replace(/^http:/i, 'https:') : null
}

export const READINGS_SYSTEM = 'You recommend real, well-known readings that are free and legal to read online. You never make up a title.'

export function readingsPrompt(topic: string, section: string, notebook: string, aims: string): string {
  return `A self-taught learner${aims ? ` (${aims})` : ''} is about to study "${topic}"${section ? `, in the "${section}" part of their ${notebook} roadmap` : ` (${notebook})`}.
Name up to 3 of the best readings for exactly this topic that are FREE and LEGAL to read online: a landmark paper (arXiv or the authors' own site), an RFC or official specification, official documentation, an open textbook chapter (OpenStax, MIT OpenCourseWare notes, an author's free online book), or a well-known tutorial. Prefer short, focused readings over whole books. No paywalled books, no piracy sites.
Return ONLY JSON: {"readings":[{"title":"...","by":"author or publisher","kind":"paper|spec|docs|book|article","why":"what it gives them, in a few words"}]}`
}

const KINDS = ['paper', 'spec', 'docs', 'book', 'article'] as const

/** The model's suggestions, cleaned: titles only, at most three, nothing from a blocked site */
export function parseReadings(raw: unknown): { title: string; by?: string; why?: string; kind: Reading['kind'] }[] {
  const list = (raw as { readings?: unknown })?.readings
  if (!Array.isArray(list)) return []
  return list
    .filter((x): x is { title: string; by?: unknown; why?: unknown; kind?: unknown } => !!x && typeof (x as { title?: unknown }).title === 'string' && !!(x as { title: string }).title.trim())
    .slice(0, 3)
    .map((x) => ({
      title: x.title.trim().slice(0, 160),
      ...(typeof x.by === 'string' && x.by.trim() ? { by: x.by.trim().slice(0, 100) } : {}),
      ...(typeof x.why === 'string' && x.why.trim() ? { why: x.why.trim().slice(0, 160) } : {}),
      kind: KINDS.includes(x.kind as (typeof KINDS)[number]) ? (x.kind as Reading['kind']) : 'article'
    }))
}

/** Wikipedia's article for a topic, when its title shares most of the topic's words */
export function wikipediaPick(topic: string, results: { title: string }[]): { title: string; url: string } | null {
  const want = (topic.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !['the', 'and', 'for', 'with', 'from', 'into'].includes(w))
  if (!want.length) return null
  for (const r of results.slice(0, 3)) {
    const t = r.title.toLowerCase()
    // "Raft (algorithm)" for "Raft leader election": the article's own name is part of the topic
    const core = t.replace(/\(.*?\)/g, '').match(/[a-z0-9]{3,}/g) ?? []
    const named = core.length > 0 && core.every((w) => want.includes(w))
    if (named || want.filter((w) => t.includes(w)).length / want.length >= 0.5) return { title: r.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}` }
  }
  return null
}

// ---------- Checking a suggested reading is real ----------

const titleWords = (s: string) => new Set(s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'wikipedia'].includes(w)))

/**
 * The search result that is this reading: its own title, not a page that mentions the words. Most
 * of the reading's title words are in the result's title, and most of the result's title words are
 * the reading's, so "Fluent Python" is not "Python Package Index" and "Python Tutorial" is not
 * "Python (programming language)".
 */
export function sameTitle(want: string, got: string): boolean {
  const a = titleWords(want)
  const b = titleWords(got)
  if (!a.size || !b.size) return false
  const shared = [...a].filter((w) => b.has(w)).length
  return shared / a.size >= 0.6 && shared / b.size >= 0.6
}

/** The makers' own documentation, by what a reading names: linked directly, never to a page about it */
const OFFICIAL_DOCS: [RegExp, string, string][] = [
  [/\bnumpy\b/i, 'https://numpy.org/doc/stable/', 'NumPy'],
  [/\bpandas\b/i, 'https://pandas.pydata.org/docs/', 'pandas'],
  [/\bscipy\b/i, 'https://docs.scipy.org/doc/scipy/', 'SciPy'],
  [/\bmatplotlib\b/i, 'https://matplotlib.org/stable/', 'Matplotlib'],
  [/\bpytorch\b/i, 'https://pytorch.org/docs/stable/', 'PyTorch'],
  [/\bpostgres(ql)?\b/i, 'https://www.postgresql.org/docs/current/', 'PostgreSQL'],
  [/\bsqlite\b/i, 'https://www.sqlite.org/docs.html', 'SQLite'],
  [/\brust\b/i, 'https://doc.rust-lang.org/book/', 'The Rust Project'],
  [/\btypescript\b/i, 'https://www.typescriptlang.org/docs/', 'Microsoft'],
  [/\bnode\.?js\b/i, 'https://nodejs.org/docs/latest/api/', 'Node.js'],
  [/\bjavascript\b|\bmdn\b/i, 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', 'MDN'],
  [/\bgolang\b|\bgo (language|programming)\b/i, 'https://go.dev/doc/', 'The Go Project'],
  [/\bpython\b/i, 'https://docs.python.org/3/', 'Python Software Foundation']
]

/** A reading that is a language's or library's official documentation: its real address and maker */
export function officialDocs(item: { title: string; by?: string; kind?: string }): { url: string; by: string } | null {
  const text = `${item.title} ${item.by ?? ''}`
  const isDocs = item.kind === 'docs' || /\b(documentation|docs|official tutorial|reference manual|language reference|library reference)\b/i.test(item.title) || /^(the )?\w+ tutorial$/i.test(item.title.trim()) || /software foundation|\bproject\b|developers\b/i.test(item.by ?? '')
  if (!isDocs) return null
  for (const [re, url, by] of OFFICIAL_DOCS)
    if (re.test(text)) {
      if (by === 'Python Software Foundation' && /\btutorial\b/i.test(item.title)) return { url: 'https://docs.python.org/3/tutorial/', by }
      return { url, by }
    }
  return null
}
