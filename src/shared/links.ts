/**
 * Where a link goes inside Tide. Nothing a course, a lesson or a note links to has to leave Tide:
 *
 *  - a file in an imported course's repository (relative links, and GitHub links into that repo)
 *    opens in the course reader, rendered natively: Markdown, notebooks, code, images, PDFs, CSV
 *  - a file in any other GitHub repository opens the same way, read from GitHub
 *  - a YouTube video plays in Tide's own player, with its transcript
 *  - any other web page opens in Tide's reader view (the article, with its images, code and
 *    maths); a page that can't be read as an article (an app, an interactive site) opens in Tide's
 *    sandboxed web view instead
 *
 * "Open in browser" is only ever an explicit, secondary action. Pure, so it can be tested.
 */
import { linkTime, youtubeIdOf } from './video'

export interface RepoRef {
  /** "owner/name" */
  repo: string
  branch: string
}

/** An imported course, as the router needs to know it */
export interface CourseRepo extends RepoRef {
  id: string
}

export type LinkTarget =
  /** A file or folder in an imported course's repository */
  | { kind: 'course-file'; course: string; path: string; anchor?: string }
  /** A file or folder in some other GitHub repository, read from GitHub */
  | { kind: 'github-file'; repo: string; ref: string; path: string; anchor?: string }
  | { kind: 'youtube'; id: string; t?: number }
  /** A web page: Tide's reader view first, its web view when the page isn't an article */
  | { kind: 'web'; url: string }
  /** A heading on the page being read */
  | { kind: 'anchor'; id: string }
  /** mailto: and tel: hand over to the Mac (there is nothing to show in Tide) */
  | { kind: 'system'; url: string }

/** Where a link was clicked: the course and file it is in, so relative links resolve within the repository */
export interface LinkContext {
  courses: CourseRepo[]
  base?: { course: string; path: string } | { repo: string; ref: string; path: string }
}

/** "a/b/../c/./d" → "a/c/d"; never above the root */
export function normalisePath(p: string): string {
  const out: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return out.join('/')
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** A relative link from the file at `from`, as a path in the same repository (and its #anchor) */
export function repoRelative(from: string, href: string): { path: string; anchor?: string } {
  const [raw, ...rest] = href.split('#')
  const anchor = rest.join('#') || undefined
  let p = raw.split('?')[0]
  try {
    p = decodeURIComponent(p)
  } catch {
    // keep it as written
  }
  const path = normalisePath(p.startsWith('/') ? p.slice(1) : `${dirOf(from) ? `${dirOf(from)}/` : ''}${p}`)
  return { path, ...(anchor ? { anchor } : {}) }
}

/** A github.com or raw.githubusercontent.com link as a repository, ref and path; null for anything else on GitHub (issues, pull requests…) */
export function parseGithub(url: string): { repo: string; ref?: string; path: string; anchor?: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const anchor = u.hash.replace(/^#/, '') || undefined
  const parts = u.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  const host = u.hostname.toLowerCase()
  if (host === 'raw.githubusercontent.com') {
    if (parts.length < 4) return null
    return { repo: `${parts[0]}/${parts[1]}`, ref: parts[2], path: parts.slice(3).join('/') }
  }
  if (host !== 'github.com' && host !== 'www.github.com') return null
  if (parts.length < 2) return null
  const repo = `${parts[0]}/${parts[1].replace(/\.git$/, '')}`
  if (parts.length === 2) return { repo, path: '', ...(anchor ? { anchor } : {}) }
  if (!['blob', 'tree', 'raw'].includes(parts[2]) || parts.length < 4) return null
  return { repo, ref: parts[3], path: parts.slice(4).join('/'), ...(anchor ? { anchor } : {}) }
}

/** Sites that are apps rather than articles: they open in the web view straight away */
const APP_HOSTS = /(^|\.)(colab\.research\.google\.com|docs\.google\.com|drive\.google\.com|figma\.com|codepen\.io|codesandbox\.io|replit\.com|observablehq\.com|excalidraw\.com|desmos\.com|geogebra\.org|huggingface\.co\/spaces|play\.rust-lang\.org|godbolt\.org|jsfiddle\.net|stackblitz\.com|kaggle\.com|app\.|console\.|dashboard\.)/i

/** True for a page that is an interactive app: Tide's reader would find nothing to read in it */
export function prefersWebView(url: string): boolean {
  try {
    const u = new URL(url)
    return APP_HOSTS.test(u.hostname) || APP_HOSTS.test(`${u.hostname}${u.pathname}`)
  } catch {
    return false
  }
}

/** Only these are ever loaded in Tide's web view */
export const webAllowed = (url: string) => /^https?:\/\/[^/\s]+/i.test(url.trim())

/**
 * Where a link goes. `null` for links Tide never follows (javascript:, file:, data:…) and for
 * links inside the notes folder, which the note's own link handling already opens.
 */
export function routeLink(href: string, ctx: LinkContext): LinkTarget | null {
  const h = (href ?? '').trim()
  if (!h) return null
  if (h.startsWith('#')) return h.length > 1 ? { kind: 'anchor', id: decodeURIComponentSafe(h.slice(1)) } : null
  if (/^(mailto|tel):/i.test(h)) return { kind: 'system', url: h }
  const scheme = h.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') return null
  if (h.startsWith('//')) return routeLink(`https:${h}`, ctx)

  // Relative: within the repository the link is in (a note's relative links are the note's business)
  if (!scheme) {
    const b = ctx.base
    if (!b) return null
    const { path, anchor } = repoRelative(b.path, h)
    if ('course' in b) return { kind: 'course-file', course: b.course, path, ...(anchor ? { anchor } : {}) }
    return { kind: 'github-file', repo: b.repo, ref: b.ref, path, ...(anchor ? { anchor } : {}) }
  }

  const yt = youtubeIdOf(h)
  if (yt) {
    const t = linkTime(h)
    return { kind: 'youtube', id: yt, ...(t != null && t > 0 ? { t } : {}) }
  }

  const gh = parseGithub(h)
  if (gh) {
    const course = ctx.courses.find((c) => c.repo.toLowerCase() === gh.repo.toLowerCase())
    if (course) return { kind: 'course-file', course: course.id, path: gh.path, ...(gh.anchor ? { anchor: gh.anchor } : {}) }
    return { kind: 'github-file', repo: gh.repo, ref: gh.ref ?? 'HEAD', path: gh.path, ...(gh.anchor ? { anchor: gh.anchor } : {}) }
  }
  return webAllowed(h) ? { kind: 'web', url: h } : null
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ---------- Files in a repository ----------

export type FileKind = 'markdown' | 'notebook' | 'code' | 'image' | 'pdf' | 'csv' | 'video' | 'text' | 'folder' | 'binary'

const KINDS: [RegExp, FileKind][] = [
  [/\.(md|markdown|mdx)$/i, 'markdown'],
  [/\.ipynb$/i, 'notebook'],
  [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  [/\.(csv|tsv)$/i, 'csv'],
  [/\.(mp4|webm|mov|m4v)$/i, 'video'],
  [/\.(py|sql|rs|c|h|cc|cpp|hpp|js|mjs|cjs|jsx|ts|tsx|go|java|kt|swift|rb|php|sh|bash|zsh|jl|r|scala|asm|s|toml|ya?ml|json|xml|html?|css|scss|lua|hs|ml|ex|exs|clj|dart|tf|hcl|proto|graphql|ini|cfg|conf|env|gradle|cmake|makefile|dockerfile)$|(^|\/)(Makefile|Dockerfile|Procfile|Gemfile|Pipfile|Vagrantfile|\.gitignore|\.dockerignore|\.env\.example)$/i, 'code'],
  [/\.(txt|text|log|rst|adoc|tex|bib|lock|license|gitattributes)$|(^|\/)(LICEN[CS]E|COPYING|AUTHORS|NOTICE|CHANGELOG|README)[^/]*$/i, 'text']
]

/** What a file in a repository is, by its name (a path ending in / or with no extension is a folder when the listing says so) */
export function fileKind(path: string): FileKind {
  for (const [re, k] of KINDS) if (re.test(path)) return k
  return 'binary'
}

/** The language of a code file, for highlighting */
export function codeLanguage(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  const map: Record<string, string> = { py: 'python', rs: 'rust', ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', h: 'c', cc: 'cpp', hpp: 'cpp', kt: 'kotlin', rb: 'ruby', jl: 'julia', md: 'markdown', tf: 'hcl', ex: 'elixir', exs: 'elixir', hs: 'haskell', ml: 'ocaml', clj: 'clojure', htm: 'html' }
  return map[ext] ?? ext ?? ''
}

/** A repository file's GitHub page (what "Open in browser" opens) */
export const githubBlobUrl = (r: RepoRef, path: string, folder = false) => `https://github.com/${r.repo}/${folder || !path ? 'tree' : 'blob'}/${r.branch}/${path.split('/').map(encodeURIComponent).join('/')}`.replace(/\/$/, '')

/** A repository file's raw bytes on GitHub (images, and files not fetched with the course) */
export const githubRawUrl = (r: RepoRef, path: string) => `https://raw.githubusercontent.com/${r.repo}/${r.branch}/${path.split('/').map(encodeURIComponent).join('/')}`

/** The page a target is on, for "Open in browser" and for showing where it came from */
export function targetUrl(t: LinkTarget, courses: CourseRepo[]): string | null {
  if (t.kind === 'web' || t.kind === 'system') return t.url
  if (t.kind === 'youtube') return `https://www.youtube.com/watch?v=${t.id}${t.t ? `&t=${Math.floor(t.t)}s` : ''}`
  if (t.kind === 'course-file') {
    const c = courses.find((x) => x.id === t.course)
    return c ? githubBlobUrl(c, t.path) + (t.anchor ? `#${t.anchor}` : '') : null
  }
  if (t.kind === 'github-file') return githubBlobUrl({ repo: t.repo, branch: t.ref }, t.path) + (t.anchor ? `#${t.anchor}` : '')
  return null
}

/** The same place, so a link to the page already open doesn't stack it twice */
export function sameTarget(a: LinkTarget, b: LinkTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'course-file' && b.kind === 'course-file') return a.course === b.course && a.path === b.path
  if (a.kind === 'github-file' && b.kind === 'github-file') return a.repo === b.repo && a.path === b.path
  if (a.kind === 'youtube' && b.kind === 'youtube') return a.id === b.id
  if (a.kind === 'web' && b.kind === 'web') return a.url.replace(/#.*$/, '') === b.url.replace(/#.*$/, '')
  return false
}

// ---------- A history of pages, with back and forward ----------

export interface History<T> {
  pages: T[]
  /** The page shown; -1 when none is (the lesson underneath is) */
  at: number
}

export const emptyHistory = <T>(): History<T> => ({ pages: [], at: -1 })

/** Opens a page after the current one: whatever was forward of it is dropped, as in a browser */
export function pushPage<T>(h: History<T>, page: T, same: (a: T, b: T) => boolean = () => false, max = 50): History<T> {
  const cur = h.at >= 0 ? h.pages[h.at] : undefined
  if (cur !== undefined && same(cur, page)) return { pages: [...h.pages.slice(0, h.at), page, ...h.pages.slice(h.at + 1)], at: h.at }
  const pages = [...h.pages.slice(0, h.at + 1), page].slice(-max)
  return { pages, at: pages.length - 1 }
}

export const canGoBack = <T>(h: History<T>) => h.at >= 0
export const canGoForward = <T>(h: History<T>) => h.at < h.pages.length - 1
export const goBack = <T>(h: History<T>): History<T> => (h.at >= 0 ? { ...h, at: h.at - 1 } : h)
export const goForward = <T>(h: History<T>): History<T> => (h.at < h.pages.length - 1 ? { ...h, at: h.at + 1 } : h)
export const currentPage = <T>(h: History<T>): T | null => (h.at >= 0 ? h.pages[h.at] : null)
