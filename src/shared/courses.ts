/**
 * Courses from GitHub, the pure part: how a repository's files become a course (modules in order,
 * lessons in each, homework and notebooks told apart), a lesson's sections as the steps a lesson
 * is taught in, a notebook read as Markdown, links made to point at GitHub, which course suits
 * what you want to learn, and progress. The catalogue is shared/courseCatalogue; fetching,
 * indexing and keeping progress is main/courses.
 */
import { CATALOGUE, type CatalogueCourse } from './courseCatalogue'
import { chooseExcerpt, EXCERPT, faithful, type Candidate, type StepReading } from './sourceLed'
import { parseJbToc } from './courseSource'

export * from './courseCatalogue'

// ---------- What a course is made of ----------

export type LessonKind = 'reading' | 'notebook' | 'homework'

export interface CourseLesson {
  /** Unique in its course: the file's path in the repository, with #slug for a part of one long file */
  id: string
  /** The file (in the repository) */
  path: string
  title: string
  kind: LessonKind
  /** About how many words */
  words: number
  /** A part of one long file (a course read from a single file): where it is in the file's text */
  range?: [number, number]
  /** Its page on the web (a course not read from GitHub) */
  url?: string
}

export interface CourseModule {
  id: string
  title: string
  lessons: CourseLesson[]
  /** Code files that sit with the module (exercises, scripts), by path */
  code: string[]
}

export interface CourseOutline {
  modules: CourseModule[]
  /** Lessons in all */
  lessons: number
}

/** A file in the repository as it is read for parsing: text only for what is needed */
export interface RepoFile {
  path: string
  /** Markdown, or a notebook already turned into Markdown */
  text?: string
}

export const CONTENT = /\.(md|markdown|mdx|ipynb|adoc|asciidoc)$/i
export const CODE = /\.(py|sql|rs|c|h|cc|cpp|hpp|js|ts|go|java|sh|jl|r|scala|asm)$/i
/** What is fetched: lessons, code and the licence (images and data are left on GitHub) */
export const FETCHED = /\.(md|markdown|mdx|ipynb|adoc|asciidoc|py|sql|rs|c|h|cc|cpp|hpp|js|ts|go|java|sh|jl|r|scala|asm|toml|yml|yaml)$|(^|\/)(LICEN[CS]E|COPYING)[^/]*$/i

const META = /^(licen[cs]e|copying|contributing|code_of_conduct|security|support|changelog|agents|claude|pull_request_template|issue_template|sponsors?|authors|governance|citation|todo|maintainers|translations?|summary|readme-template|style-guide)(\.|$)/i
const NEVER_DIRS = /(^|\/)(\.[^/]*|node_modules|translations?|translated_images|i18n|locales?|__pycache__|\.ipynb_checkpoints|_book|site-packages)(\/|$)/i

/** Natural order: "2-x" before "10-x", "part2" before "part10" */
export const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

const basename = (p: string) => p.split('/').pop() ?? p
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')

const skipRule = (rule: string): ((p: string) => boolean) => {
  const m = rule.match(/^\/(.+)\/([a-z]*)$/)
  if (m) {
    const re = new RegExp(m[1], m[2])
    return (p) => re.test(p) || re.test(basename(p))
  }
  return (p) => p === rule || p.startsWith(rule.endsWith('/') ? rule : `${rule}/`) || basename(p) === rule || basename(p).replace(/\.[^.]+$/, '') === rule
}

/** Whether a path (in the repository) belongs to the course at all */
export function inCourse(c: Pick<CatalogueCourse, 'root' | 'skip'>, path: string): boolean {
  const root = c.root ? `${c.root.replace(/\/+$/, '')}/` : ''
  if (root && !path.startsWith(root)) return false
  const rel = path.slice(root.length)
  if (NEVER_DIRS.test(rel)) return false
  const rules = (c.skip ?? []).map(skipRule)
  return !rules.some((r) => r(path) || r(rel))
}

// ---------- Text helpers ----------

/** Front matter at the top of a Markdown file: its fields, and where the body starts */
export function frontMatter(md: string): { data: Record<string, string>; body: number } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/)
  if (!m) return { data: {}, body: 0 }
  const data: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) data[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return { data, body: m[0].length }
}

const words = (t: string) => (t.match(/\S+/g) ?? []).length

/** A file name as a title: "03-dockerizing-pipeline.md" → "Dockerizing pipeline" */
export function prettyName(name: string): string {
  const t = name
    .replace(/\.(en\.)?(md|markdown|mdx|ipynb|adoc|asciidoc)$/i, '')
    .replace(/^(chapter_|ch|lab|part|week_?)?\d+[a-z]?([._-]\d+)*[._\s-]*/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  const out = t || name.replace(/\.(md|markdown|mdx|ipynb)$/i, '').replace(/[_-]+/g, ' ')
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** Strips Markdown marks and links from a heading's text */
export const headingText = (h: string) =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\{#[^}]*\}\s*$/, '')
    .replace(/:[a-z_]+:/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Headings outside code fences, with where each line starts */
export function headingsOf(md: string, from = 0): { level: number; text: string; at: number; end: number }[] {
  const out: { level: number; text: string; at: number; end: number }[] = []
  let fence: string | null = null
  let at = 0
  for (const line of md.split('\n')) {
    const lineEnd = at + line.length + 1
    if (at >= from) {
      const f = line.match(/^\s*(```+|~~~+)/)
      if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1]
      else if (!fence) {
        const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
        if (h) out.push({ level: h[1].length, text: headingText(h[2]), at, end: Math.min(md.length, lineEnd) })
      }
    }
    at = lineEnd
  }
  return out
}

/** A lesson's title: its front matter's title, else its first heading, else its file name */
export function titleOf(md: string, path: string): string {
  const fm = frontMatter(md)
  if (fm.data.title) return headingText(fm.data.title)
  const heads = headingsOf(md, fm.body)
  // Its own title (#), or a page's first heading; a notebook's first ## is a section, not its name
  const first = heads.find((h) => h.level === 1) ?? (/^(readme|index)\./i.test(basename(path)) ? heads.find((h) => h.level === 2) : undefined)
  const t = first?.text.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (t && t.length <= 120) return t
  // A folder's README with no title of its own: named by its folder
  return prettyName(/^(readme|index)\./i.test(basename(path)) && dirOf(path) ? basename(dirOf(path)) : basename(path))
}

// ---------- Notebooks ----------

interface NbCell {
  cell_type: string
  source?: string | string[]
  outputs?: { output_type: string; text?: string | string[]; data?: Record<string, string | string[]>; name?: string }[]
}

const joinSrc = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''))

/**
 * A Jupyter notebook as Markdown: its Markdown cells as they are, its code cells as fenced blocks
 * in its language (the lesson's Run button runs them), and each cell's text output under it in an
 * ```output block (pictures and long outputs left out). Null when it isn't a notebook.
 */
export function notebookMarkdown(raw: string, opts: { images?: boolean } = {}): string | null {
  let nb: { cells?: NbCell[]; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } }
  try {
    nb = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(nb.cells)) return null
  const lang = (nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? 'python').toLowerCase().replace(/^(python[23]?|ipython[23]?)$/, 'python')
  const parts: string[] = []
  for (const cell of nb.cells) {
    const src = joinSrc(cell.source).replace(/\s+$/, '')
    if (!src.trim()) continue
    if (cell.cell_type === 'markdown') parts.push(src)
    else if (cell.cell_type === 'code') {
      const fence = '`'.repeat(Math.max(3, ...(src.match(/`{3,}/g) ?? []).map((t) => t.length + 1)))
      parts.push(`${fence}${lang}\n${src}\n${fence}`)
      const out: string[] = []
      for (const o of cell.outputs ?? []) {
        if (o.output_type === 'stream' && o.name !== 'stderr') out.push(joinSrc(o.text))
        else if ((o.output_type === 'execute_result' || o.output_type === 'display_data') && o.data?.['text/plain'] && !o.data['image/png']) out.push(joinSrc(o.data['text/plain']))
      }
      // Read in the course reader: its plots too (never in the search index or a lesson's prompt)
      const pics = opts.images ? (cell.outputs ?? []).map((o) => joinSrc(o.data?.['image/png']).replace(/\s+/g, '')).filter((b) => b && b.length < 2_000_000) : []
      let text = out.join('').replace(/\s+$/, '')
      if (text) {
        const lines = text.split('\n')
        if (lines.length > 30) text = `${lines.slice(0, 30).join('\n')}\n…`
        if (text.length > 3000) text = `${text.slice(0, 3000)}…`
        parts.push(`\`\`\`output\n${text.replace(/```/g, "'''")}\n\`\`\``)
      }
      for (const b of pics) parts.push(`![Output](data:image/png;base64,${b})`)
    } else if (cell.cell_type === 'raw') continue
  }
  return parts.join('\n\n')
}

// ---------- Links ----------

/**
 * Relative links and pictures made absolute, so a lesson read in Tide still reaches them: pictures
 * from raw.githubusercontent.com, other links to the file on github.com.
 */
export function absolutise(md: string, c: Pick<CatalogueCourse, 'repo' | 'branch'>, path: string): string {
  const dir = dirOf(path)
  const resolve = (href: string): string | null => {
    if (!href || /^([a-z][a-z0-9+.-]*:|#|\/\/|mailto:)/i.test(href)) return null
    const [p, hash] = href.split('#')
    const parts = (p.startsWith('/') ? p.slice(1) : `${dir ? `${dir}/` : ''}${p}`).split('/')
    const out: string[] = []
    for (const s of parts) {
      if (s === '..') out.pop()
      else if (s && s !== '.') out.push(s)
    }
    return `${out.join('/')}${hash ? `#${hash}` : ''}`
  }
  const raw = (p: string) => `https://raw.githubusercontent.com/${c.repo}/${c.branch}/${p}`
  const blob = (p: string) => `https://github.com/${c.repo}/${/\.[a-z0-9]+(#.*)?$/i.test(p) ? 'blob' : 'tree'}/${c.branch}/${p}`
  return md
    .replace(/(!\[[^\]]*\]\()(\s*<?)([^)\s>]+)(>?(?:\s+"[^"]*")?\s*\))/g, (all, a, lt, href, rest) => {
      const r = resolve(href)
      return r ? `${a}${lt}${raw(r)}${rest}` : all
    })
    .replace(/((?<!!)\[[^\]]*\]\()(\s*<?)([^)\s>]+)(>?(?:\s+"[^"]*")?\s*\))/g, (all, a, lt, href, rest) => {
      const r = resolve(href)
      return r ? `${a}${lt}${blob(r)}${rest}` : all
    })
    .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (all, a, href, b) => {
      const r = resolve(href)
      return r ? `${a}${raw(r)}${b}` : all
    })
}

/** Where a lesson is on GitHub */
export const lessonUrl = (c: Pick<CatalogueCourse, 'repo' | 'branch'>, lesson: Pick<CourseLesson, 'path' | 'id'>) => {
  const hash = lesson.id.includes('#') ? `#${lesson.id.split('#').pop()}` : ''
  return `https://github.com/${c.repo}/blob/${c.branch}/${lesson.path}${hash}`
}

// ---------- The outline ----------

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

const kindOf = (path: string): LessonKind => (/\.ipynb$/i.test(path) ? 'notebook' : /(^|[/_-])(homework|assignment|exercises?|hw\d*|challenge)([._/-]|$)/i.test(path) ? 'homework' : 'reading')

const lessonOf = (f: RepoFile): CourseLesson => ({ id: f.path, path: f.path, title: titleOf(f.text ?? '', f.path), kind: kindOf(f.path), words: words(f.text ?? '') })

/**
 * A course that is one long file: its top headings (the level that heads at least three parts) are
 * modules. A long module is cut into lessons at the headings under it, its opening as a lesson of
 * its own; a heading with little under it stays inside the lesson before it. Each lesson keeps
 * where it is in the file's text.
 */
export function splitOutline(md: string, path: string): CourseOutline {
  const body = frontMatter(md).body
  const heads = headingsOf(md, body)
  const count = (l: number) => heads.filter((h) => h.level === l).length
  const top = [1, 2, 3].find((l) => count(l) >= 3) ?? 2
  const SKIP = /^(table of contents|contents|index|license|licen[cs]e|contact|credits|translations?|contributing|contributors|support|sponsors?|acknowledg|about|motivation|faq|under development|other|disclaimer|how to contribute|feedback|stars?|star history|community|code of conduct|anki flashcards|coding resource)\b/i
  const clean = (t: string) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const modules: CourseModule[] = []
  const used = new Set<string>()
  const idFor = (text: string) => {
    const base = `${path}#${slug(clean(text)) || 'part'}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
  const lessonAt = (title: string, from: number, to: number, kind: LessonKind = 'reading'): CourseLesson => ({ id: idFor(title), path, title: clean(title) || title, kind, words: words(md.slice(from, to)), range: [from, to] })
  heads.forEach((h, i) => {
    if (h.level !== top || SKIP.test(clean(h.text))) return
    const end = heads.slice(i + 1).find((x) => x.level <= top)?.at ?? md.length
    const total = words(md.slice(h.end, end))
    if (total < 40) return
    const kind = kindOf(h.text)
    // Under a long module, its headings one level down: those with enough under them start a lesson
    const inner = heads.slice(i + 1).filter((x) => x.at < end && x.level === top + 1 && !SKIP.test(clean(x.text)))
    const sizeOf = (x: (typeof inner)[number]) => words(md.slice(x.end, inner[inner.indexOf(x) + 1]?.at ?? end))
    const starts = total > 1200 ? inner.filter((x) => sizeOf(x) >= 150) : []
    let lessons: CourseLesson[]
    if (starts.length >= 2) {
      lessons = []
      const intro = words(md.slice(h.end, starts[0].at))
      if (intro >= 60) lessons.push(lessonAt(h.text, h.at, starts[0].at, kind))
      starts.forEach((x, j) => lessons.push(lessonAt(x.text, x.at, starts[j + 1]?.at ?? end, kind === 'homework' ? kind : kindOf(x.text))))
    } else lessons = [lessonAt(h.text, h.at, end, kind)]
    modules.push({ id: `m${modules.length + 1}`, title: clean(h.text), lessons, code: [] })
  })
  return { modules, lessons: modules.reduce((n, m) => n + m.lessons.length, 0) }
}

/** An mdBook's SUMMARY.md: its top-level entries are modules, the entries under each its lessons */
export function summaryOrder(summary: string, dir: string): { title: string; lessons: { title: string; path: string }[] }[] | null {
  const out: { title: string; lessons: { title: string; path: string }[] }[] = []
  for (const line of summary.split('\n')) {
    const m = line.match(/^(\s*)[-*]\s+\[([^\]]+)\]\(([^)]+)\)/)
    if (!m || !/\.md$/i.test(m[3].split('#')[0])) continue
    const path = `${dir ? `${dir}/` : ''}${m[3].split('#')[0].replace(/^\.\//, '')}`
    const entry = { title: headingText(m[2]), path }
    if (m[1].length === 0 || !out.length) out.push({ title: entry.title, lessons: [entry] })
    else out[out.length - 1].lessons.push(entry)
  }
  return out.length ? out : null
}

/** Folder names in the order the README links to them, with the link text */
function readmeOrder(readme: string, dirs: string[], root = ''): Map<string, { at: number; title: string }> {
  const out = new Map<string, { at: number; title: string }>()
  for (const m of readme.matchAll(/\[([^\]]+)\]\((?:\.\/)?([^)#\s]+)/g)) {
    let target = decodeURIComponent(m[2]).replace(/^\/+/, '').replace(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:tree|blob)\/[^/]+\//, '')
    if (root && target.startsWith(`${root}/`)) target = target.slice(root.length + 1)
    const first = target.split('/')[0]
    if (dirs.includes(first) && !out.has(first)) out.set(first, { at: m.index!, title: headingText(m[1]) })
  }
  return out
}

const isIndex = (p: string) => /^(readme|index)\.(en\.)?(md|markdown|mdx)$/i.test(basename(p))

/**
 * A repository's files as a course: modules in order (an mdBook's SUMMARY.md, else the order its
 * README links its folders in, else folder names in natural order), the lessons in each (its
 * README first as the overview, then by name), homework kept beside its module, code listed.
 */
export function buildOutline(c: CatalogueCourse, files: RepoFile[]): CourseOutline {
  const byPath = new Map(files.map((f) => [f.path, f]))
  // A Jupyter Book: its _toc.yml gives the parts and their order
  const jb = jbOutline(c, files)
  if (jb) return jb
  if (c.split) {
    const f = byPath.get(c.split)
    return f?.text ? splitOutline(f.text, f.path) : { modules: [], lessons: 0 }
  }
  const root = c.root ? c.root.replace(/\/+$/, '') : ''
  const rel = (p: string) => (root ? p.slice(root.length + 1) : p)
  let content = files.filter((f) => CONTENT.test(f.path) && inCourse(c, f.path) && !META.test(basename(f.path)) && (f.text ?? '').trim().length > 0)
  // Two languages side by side: the English file where there is one
  if (c.english === 'suffix') {
    const en = new Set(content.filter((f) => /\.en\.(md|markdown)$/i.test(f.path)).map((f) => f.path.replace(/\.en\.(md|markdown)$/i, '.$1')))
    content = content.filter((f) => /\.en\.(md|markdown)$/i.test(f.path) || !en.has(f.path))
  }
  const code = files.filter((f) => CODE.test(f.path) && inCourse(c, f.path)).map((f) => f.path)

  // An mdBook: the order its SUMMARY.md gives
  const summaryPath = [root ? `${root}/SUMMARY.md` : 'SUMMARY.md'].find((p) => byPath.get(p)?.text)
  const summary = summaryPath ? summaryOrder(byPath.get(summaryPath)!.text!, dirOf(summaryPath)) : null
  if (summary) {
    const have = new Map(content.map((f) => [f.path, f]))
    const modules: CourseModule[] = []
    for (const s of summary) {
      const lessons = s.lessons.flatMap((l) => {
        const f = have.get(l.path)
        return f && words(f.text ?? '') >= 25 ? [{ ...lessonOf(f), title: l.title }] : []
      })
      if (lessons.length) modules.push({ id: `m${modules.length + 1}`, title: s.title, lessons, code: [] })
    }
    if (modules.length) return { modules, lessons: modules.reduce((n, m) => n + m.lessons.length, 0) }
  }

  const modRe = c.modules ? new RegExp(c.modules) : null
  const groups = new Map<string, RepoFile[]>()
  const loose: RepoFile[] = []
  for (const f of content) {
    const parts = rel(f.path).split('/')
    if (parts.length === 1) loose.push(f)
    else if (!modRe || modRe.test(parts[0])) groups.set(parts[0], [...(groups.get(parts[0]) ?? []), f])
  }
  const readme = byPath.get(root ? `${root}/README.md` : 'README.md')?.text ?? byPath.get('README.md')?.text ?? ''
  const dirs = [...groups.keys()]
  const linked = readmeOrder(readme, dirs, root)
  const orderAt = (name: string) => {
    const i = (c.order ?? []).findIndex((o) => o === name || o === basename(name))
    return i < 0 ? Infinity : i
  }
  const useLinks = linked.size >= Math.max(2, dirs.length / 2)
  dirs.sort((a, b) => orderAt(a) - orderAt(b) || (useLinks ? (linked.get(a)?.at ?? Infinity) - (linked.get(b)?.at ?? Infinity) : 0) || natural(a, b))

  // A site's pages carry their order in front matter (a lecture's date, a nav order); '' when they don't
  const dated = (f: RepoFile) => {
    const d = frontMatter(f.text ?? '').data
    return d.date ?? (d.nav_order ? d.nav_order.padStart(6, '0') : d.weight ? d.weight.padStart(6, '0') : '')
  }
  const lessonsIn = (fs: RepoFile[]) =>
    fs
      .slice()
      .sort((a, b) => {
        // The folder's own README opens it; then by place in `order`, then by name
        const da = rel(a.path).split('/').length
        const db = rel(b.path).split('/').length
        const ia = isIndex(a.path) && da <= 2 ? 0 : 1
        const ib = isIndex(b.path) && db <= 2 ? 0 : 1
        return ia - ib || orderAt(rel(a.path)) - orderAt(rel(b.path)) || dated(a).localeCompare(dated(b)) || natural(dirOf(a.path), dirOf(b.path)) || (isIndex(a.path) ? 0 : 1) - (isIndex(b.path) ? 0 : 1) || natural(a.path, b.path)
      })
      .map(lessonOf)
      // A README that only lists the lessons isn't one
      .filter((l) => l.words >= (isIndex(l.path) ? 60 : 25))

  const modules: CourseModule[] = []
  // Homework kept per cohort: the latest cohort's homework for each module folder
  const homeworkFor = (dir: string): CourseLesson[] => {
    if (!c.homework) return []
    const base = `${c.homework.dir}/`
    const cohorts = [...new Set(files.filter((f) => f.path.startsWith(base)).map((f) => f.path.slice(base.length).split('/')[0]))].sort(natural).reverse()
    for (const cohort of cohorts) {
      const hw = files.filter((f) => f.path.startsWith(`${base}${cohort}/${dir}/`) && /homework[^/]*\.(md|ipynb)$/i.test(f.path) && (f.text ?? '').trim())
      if (hw.length) return hw.map((f) => ({ ...lessonOf(f), kind: 'homework' as const, title: `Homework (${cohort})${hw.length > 1 ? `: ${titleOf(f.text ?? '', f.path)}` : ''}` }))
    }
    return []
  }
  for (const dir of dirs) {
    const lessons = [...lessonsIn(groups.get(dir)!), ...homeworkFor(dir)]
    if (!lessons.length) continue
    const index = groups.get(dir)!.find((f) => isIndex(f.path) && rel(f.path).split('/').length === 2)
    const fromIndex = index?.text ? headingsOf(index.text, frontMatter(index.text).body).find((h) => h.level === 1)?.text : undefined
    // The course's own name for it: its README's link, else the folder's name, else its README's heading
    const fromDir = prettyName(dir)
    const named = c.moduleTitles?.[dir] ?? (useLinks ? linked.get(dir)?.title : undefined) ?? (/\p{L}{3}/u.test(fromDir) ? fromDir : undefined) ?? fromIndex ?? fromDir
    const title = named.charAt(0).toUpperCase() + named.slice(1)
    const prefix = `${root ? `${root}/` : ''}${dir}/`
    modules.push({ id: `m${modules.length + 1}`, title, lessons, code: code.filter((p) => p.startsWith(prefix)).sort(natural).slice(0, 40) })
  }
  // Files straight under the root: the lessons of a flat course; beside modules, only the README introduces them
  const flat = lessonsIn(modules.length ? loose.filter((f) => isIndex(f.path) || orderAt(rel(f.path)) < Infinity) : loose)
  if (flat.length) {
    if (modules.length) modules.unshift({ id: 'm0', title: 'Introduction', lessons: flat.map((l) => (isIndex(l.path) ? { ...l, title: 'About the course' } : l)), code: [] })
    else {
      // A flat course: groups of up to eight lessons
      const size = Math.ceil(flat.length / Math.ceil(flat.length / 8))
      for (let i = 0; i < flat.length; i += size) {
        const part = flat.slice(i, i + size)
        const unit = c.kind === 'book' ? 'Chapter' : 'Lesson'
        modules.push({ id: `m${modules.length + 1}`, title: flat.length <= 8 ? `${unit}s` : part.length === 1 ? `${unit} ${i + 1}` : `${unit}s ${i + 1}–${i + part.length}`, lessons: part, code: [] })
      }
      if (modules.length === 1) modules[0].code = code.filter((p) => !p.includes('/')).slice(0, 40)
    }
  }
  modules.forEach((m, i) => (m.id = `m${i + 1}`))
  return { modules, lessons: modules.reduce((n, m) => n + m.lessons.length, 0) }
}

/**
 * A Jupyter Book's outline from its _toc.yml (in the course's root, or fetched beside it): each part
 * a module, each chapter a lesson, read from its .md or .ipynb. A lesson with code to run is a
 * notebook. Null when there is no _toc.yml.
 */
export function jbOutline(c: Pick<CatalogueCourse, 'root'>, files: RepoFile[]): CourseOutline | null {
  const root = c.root ? c.root.replace(/\/+$/, '') : ''
  const tocFile = files.find((f) => f.text && (f.path === (root ? `${root}/_toc.yml` : '_toc.yml') || f.path === '_toc.yml'))
  if (!tocFile) return null
  const toc = parseJbToc(tocFile.text!)
  const byStem = new Map<string, RepoFile>()
  for (const f of files) {
    if (!f.text || !/\.(md|ipynb)$/i.test(f.path)) continue
    const rel = root && f.path.startsWith(`${root}/`) ? f.path.slice(root.length + 1) : f.path
    const stem = rel.replace(/\.(md|ipynb)$/i, '')
    // A notebook wins over Markdown of the same name: it has the outputs
    if (!byStem.has(stem) || /\.ipynb$/i.test(f.path)) byStem.set(stem, f)
    // A notebooks repository keeps them flat: found by name alone
    const name = stem.split('/').pop()!
    if (!byStem.has(`#${name}`) || /\.ipynb$/i.test(f.path)) byStem.set(`#${name}`, f)
  }
  const modules: CourseModule[] = []
  for (const part of toc.parts) {
    const lessons: CourseLesson[] = []
    for (const stem of part.files) {
      const f = byStem.get(stem) ?? byStem.get(`#${stem.split('/').pop()}`)
      if (!f || words(f.text ?? '') < 25) continue
      const l = lessonOf(f)
      const code = /\.ipynb$/i.test(f.path) || /```\{code-cell\}|^```(python|ipython3?|julia)\s*$/m.test(f.text ?? '')
      lessons.push({ ...l, kind: code ? 'notebook' : l.kind })
    }
    if (lessons.length) modules.push({ id: `m${modules.length + 1}`, title: part.title, lessons, code: [] })
  }
  return modules.length ? { modules, lessons: modules.reduce((n, m) => n + m.lessons.length, 0) } : null
}

// ---------- A lesson's sections: the steps it is taught in ----------

export interface Section {
  title: string
  /** Where it is in the lesson's text */
  start: number
  end: number
  words: number
}

const AROUND = /^(solutions?( to (exercise|problem)s?.*)?$|homework|resources|further reading|references|bibliography|table of contents|contents|navigation|previous|next|community notes|notes|videos?|video|links|useful links|additional resources|summary of links|credits|acknowledg|license|licen[cs]e|post-lecture quiz|pre-lecture quiz|quiz|review (&|and) self study|self study|assignment|🚀 challenge|challenge|\[?edit\]?|see also|faq|discussion|exercises? for the reader|footnotes)\b/i
export const SECTION_MAX = 600
export const MAX_STEPS = 10

/**
 * A lesson's text cut into the sections it is taught in, each one stretch of the text: at its
 * headings (## and ###, or # when it has no others), what comes before the first heading as an
 * opening when there is enough of it, long sections cut at paragraphs into parts of at most about
 * 600 words, sections with almost nothing in them run into the next, and the lesson's own
 * signposts (resources, navigation, the quiz links) left out. At most ten: beyond that,
 * neighbours are joined. Every section is a slice of the text, so its words are the source's.
 */
export function lessonSections(md: string, title: string, kind: LessonKind = 'reading'): Section[] {
  const body = frontMatter(md).body
  const heads = headingsOf(md, body)
  const levels = [2, 3].filter((l) => heads.some((h) => h.level === l))
  const cut = (levels.length ? heads.filter((h) => levels.includes(h.level)) : heads.filter((h) => h.level === 1 && h.at > body)).filter((h) => h.at >= body)
  // Each heading starts a section; the text before the first is the opening
  const raw: { title: string; start: number; end: number }[] = []
  const firstAt = cut[0]?.at ?? md.length
  const opening = md.slice(body, firstAt)
  const openingTitle = heads.find((h) => h.level === 1 && h.at < firstAt)?.text ?? title
  if (words(opening.replace(/^#\s.*$/m, '')) >= 40 || !cut.length) raw.push({ title: openingTitle, start: body, end: firstAt })
  cut.forEach((h, i) => raw.push({ title: h.text, start: h.at, end: cut[i + 1]?.at ?? md.length }))
  // Signposts out (all of a homework is the task, so nothing is left out of one)
  let secs = raw.filter((s) => kind === 'homework' || !AROUND.test(s.title.replace(/^[^\p{L}]+/u, '')))
  // Almost empty: runs into the next
  const merged: typeof secs = []
  for (const s of secs) {
    const prev = merged[merged.length - 1]
    if (prev && words(md.slice(prev.start, prev.end)) < 30 && prev.end === s.start) prev.end = s.end
    else merged.push({ ...s })
  }
  secs = merged.filter((s) => words(md.slice(s.start, s.end)) >= 15)
  // Long ones: parts of at most SECTION_MAX words, cut where a paragraph ends (never inside a code block)
  const parted: typeof secs = []
  for (const s of secs) {
    const text = md.slice(s.start, s.end)
    if (words(text) <= SECTION_MAX * 1.25) {
      parted.push(s)
      continue
    }
    const breaks: number[] = []
    let fence = false
    let at = s.start
    for (const line of text.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      at += line.length + 1
      if (!fence && !line.trim()) breaks.push(at)
    }
    let from = s.start
    let part = 1
    let last = from
    for (const b of breaks) {
      if (words(md.slice(from, b)) > SECTION_MAX && last > from) {
        parted.push({ title: `${s.title}${part > 1 ? ` (part ${part})` : ''}`, start: from, end: last })
        part++
        from = last
      }
      last = b
    }
    // A last bit too small to stand alone stays with the part before it
    if (part > 1 && words(md.slice(from, s.end)) < 80) {
      parted[parted.length - 1].end = s.end
      part--
    } else parted.push({ title: `${s.title}${part > 1 ? ` (part ${part})` : ''}`, start: from, end: s.end })
    // The first part is named "(part 1)" only when there are others
    if (part > 1) {
      const first = parted[parted.length - part]
      first.title = `${s.title} (part 1)`
    }
  }
  // Too many: join the neighbours that make the smallest pair
  while (parted.length > MAX_STEPS) {
    let best = 0
    let size = Infinity
    for (let i = 0; i < parted.length - 1; i++) {
      if (parted[i].end !== parted[i + 1].start) continue
      const n = words(md.slice(parted[i].start, parted[i + 1].end))
      if (n < size) (size = n), (best = i)
    }
    if (size === Infinity) {
      parted.length = MAX_STEPS
      break
    }
    parted.splice(best, 2, { title: parted[best].title, start: parted[best].start, end: parted[best + 1].end })
  }
  // Titles are steps of a plan: unique
  const seen = new Map<string, number>()
  return parted.map((s) => {
    let t = s.title.replace(/\s+/g, ' ').trim().slice(0, 100) || title
    const n = (seen.get(t.toLowerCase()) ?? 0) + 1
    seen.set(t.toLowerCase(), n)
    if (n > 1) t = `${t} (${n})`
    // Trailing white space isn't part of a section
    let end = s.end
    while (end > s.start && /\s/.test(md[end - 1])) end--
    return { title: t, start: s.start, end, words: words(md.slice(s.start, end)) }
  })
}

/** The section a plan step is about: the one with its name, else the one whose name shares most of its words */
export function sectionFor(sections: Section[], step: string, index: number): Section | null {
  if (!sections.length) return null
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const exact = sections.find((s) => norm(s.title) === norm(step))
  if (exact) return exact
  const want = new Set(norm(step).split(' ').filter((w) => w.length > 2))
  let best: Section | null = null
  let score = 0
  for (const s of sections) {
    const have = norm(s.title).split(' ').filter((w) => w.length > 2)
    const hit = have.filter((w) => want.has(w)).length / Math.max(1, Math.min(want.size, have.length))
    if (hit > score) (score = hit), (best = s)
  }
  // Nothing in common: the plan was written in the course's order, so its place says which
  return score >= 0.5 ? best : (sections[index] ?? null)
}

// ---------- Suggesting a course ----------

/** The catalogue's courses that teach what a sentence names, best first */
export function suggestCourses(text: string, limit = 3, catalogue: CatalogueCourse[] = CATALOGUE): CatalogueCourse[] {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}+#.-]+/gu, ' ')} `
  const scored = catalogue
    .map((c) => {
      let s = 0
      for (const p of c.topics) if (t.includes(` ${p} `) || t.includes(` ${p}s `)) s += 1 + p.split(' ').length
      const title = c.title.toLowerCase()
      if (t.trim().length > 3 && title.includes(t.trim())) s += 3
      // Beginner material first for a newcomer's phrasing
      if (s && /\b(beginner|basics|start|new to|intro)\b/.test(t) && c.level === 'beginner') s += 1
      // A course with lessons and homework over a list of links
      if (s && c.kind === 'course') s += 0.5
      return { c, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map((x) => x.c)
}

// ---------- Progress ----------

export interface LessonProgress {
  /** The lesson record (main/lessons) of its latest sitting */
  record?: string
  started: number
  updated: number
  /** The lesson was finished, or you marked it done */
  done: boolean
  right: number
  partly: number
  wrong: number
  /** How far down its text you read, 0 to 1 (the furthest) */
  read?: number
  /** How much of each of its videos you watched, 0 to 1, by video id */
  watched?: Record<string, number>
  /** Code of it you ran in Tide (its notebook's cells, its exercises) */
  ran?: number
}

/** Read to the end and its videos watched: a lesson studied, though nothing about it has been asked yet */
export function studied(p: LessonProgress | undefined, videos = 0): boolean {
  if (!p) return false
  const watched = Object.values(p.watched ?? {}).filter((w) => w >= 0.8).length
  return (p.read ?? 0) >= 0.9 && watched >= Math.min(videos, 1)
}

/** Progress kept per course, by lesson id */
export type CourseProgress = Record<string, LessonProgress>

export function moduleProgress(m: CourseModule, p: CourseProgress | undefined): { done: number; started: number; total: number } {
  const total = m.lessons.length
  let done = 0
  let started = 0
  for (const l of m.lessons) {
    const x = p?.[l.id]
    if (x?.done) done++
    else if (x) started++
  }
  return { done, started, total }
}

/** Where to carry on: a lesson begun and not done, else the first not done after the furthest one done, else the first not done */
export function nextLesson(o: CourseOutline, p: CourseProgress | undefined): { module: CourseModule; lesson: CourseLesson } | null {
  const all = o.modules.flatMap((m) => m.lessons.map((lesson) => ({ module: m, lesson })))
  const begun = all.find((x) => p?.[x.lesson.id] && !p[x.lesson.id].done)
  if (begun) return begun
  // After the furthest lesson done, not back at the start because an early one was skipped
  let last = -1
  all.forEach((x, i) => p?.[x.lesson.id]?.done && (last = i))
  return all.slice(last + 1).find((x) => !p?.[x.lesson.id]?.done) ?? all.find((x) => !p?.[x.lesson.id]?.done) ?? null
}

export const courseDone = (o: CourseOutline, p: CourseProgress | undefined) => o.modules.reduce((n, m) => n + moduleProgress(m, p).done, 0)

/** A lesson taught from a course, as a lesson's setup carries it (shared/session) */
export interface CourseRef {
  id: string
  title: string
  by: string
  lesson: string
  lessonTitle: string
  kind: LessonKind
  /** The lesson's sections, in order: the plan it is taught in */
  steps: string[]
  url: string
  licence: string
}

/** What the tutor is told about a lesson taught from a course */
export function courseRules(c: CourseRef): string {
  const plan = c.steps.map((s) => `- ${s}`).join('\n')
  const head = `\nThis lesson follows "${c.lessonTitle}" from the course "${c.title}" by ${c.by} (an open course on GitHub, licence: ${c.licence}). The course's own text does the teaching: Tide shows it to the student a section at a time as readings, word for word with its source. Your part is to question, mark and fill gaps, never to re-explain what a reading already says.${'\n'}Where another of the learner's courses or a lecture video adds something this course leaves out (the code, the why, the theory), you may bring in one or two with related_material, if you have it (pass exclude="${c.id}").`
  const planRule = `\nKeep the probe short (one or two questions). Then write the plan as exactly these steps, in this order, word for word, leaving out only a step the probe showed they already know:\n<plan>\n${plan}\n</plan>\nWrite the plan once, and never again: after it, Tide moves the lesson on from step to step.`
  if (c.kind === 'homework')
    return `${head}\nThis is the module's HOMEWORK. Its brief is shown as the reading. Be a mentor, not a solver: never give the answers. For each question in it, ask how they would approach it, check their reasoning and their result, and point at the exact part of the course that answers it when they are stuck. Where an answer can be checked by running code (a query, a function, a number), set it as a code ask with hidden tests.${planRule}`
  return `${head}${c.kind === 'notebook' ? '\nThe lesson is a notebook: its code runs here. When a reading has code in it, ask them to run it or to change it and predict what changes (a code ask in its language), rather than asking them to recall it.' : ''}${planRule}`
}

// ---------- The reading for a step of a course's lesson (main/sourceLed) ----------

/** The words of a course's section for a step, at most a reading's length: the section itself, or its passage most about the step */
export function courseReading(course: { candidate: Candidate; sections: Section[] }, i: number, step: string, topic: string): StepReading | null {
  const sec = sectionFor(course.sections, step, i)
  if (!sec) return null
  const c = course.candidate
  let excerpt = c.text.slice(sec.start, sec.end)
  if (sec.words > EXCERPT.max) {
    const e = chooseExcerpt(excerpt, step, topic)
    if (e) excerpt = e.text
    else {
      // Its first paragraphs, up to the length of a reading
      let n = 0
      const paras = excerpt.split(/(?<=\n\s*\n)/)
      const kept: string[] = []
      for (const p of paras) {
        n += (p.match(/\S+/g) ?? []).length
        if (kept.length && n > EXCERPT.max) break
        kept.push(p)
      }
      excerpt = kept.join('')
    }
  }
  excerpt = excerpt.replace(/\s+$/, '')
  if (!excerpt.trim() || !faithful(excerpt, c.text)) return null
  return {
    step: i,
    title: c.title,
    ...(c.by ? { by: c.by } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.licence ? { licence: c.licence } : {}),
    fetched: new Date(c.fetchedAt).toISOString().slice(0, 10),
    format: 'md',
    kind: 'course',
    text: excerpt
  }
}

