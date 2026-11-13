/**
 * Courses from GitHub, main side (the catalogue and the parsing are shared/courses): importing one
 * (a shallow, sparse git clone of only its text and code, or GitHub's tarball when git isn't
 * there), reading it as a course, indexing its text in an index of its own (Tantivy, beside the
 * notes' index, so a course is never mistaken for your notes), updating it, keeping progress, and
 * handing a lesson's text to the source-led lessons (main/sourceLed) as the readings it is taught
 * from.
 *
 * Everything lives in Tide's app data (userData/courses), never in your notes folder unless you
 * choose "Save to my notes". A course with no open licence is fetched and read here for your own
 * study, like a web page you open, and is never redistributed.
 */
import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  allCourses,
  fromRepo,
  homeUrl,
  sourceOf,
  CONTENT,
  FETCHED,
  absolutise,
  buildOutline,
  catalogueCourse,
  courseDone,
  studied,
  lessonSections,
  lessonUrl,
  nextLesson,
  notebookMarkdown,
  titleOf,
  type CatalogueCourse,
  type CourseOutline,
  type CourseProgress,
  type LessonProgress,
  type RepoFile,
  type Section
} from '@shared/courses'
import { asciidocMarkdown, mystMarkdown, slugify, transcriptMarkdown } from '@shared/courseSource'
import { cleanPage, type PageCleaning } from '@shared/pageClean'
import type { Candidate } from '@shared/sourceLed'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson } from '@shared/lessonMemory'
import { chunkMarkdown, openChunkIndex, type Backend } from './search'
import { uniquePath, writeText } from './vault'

const root = () => join(app.getPath('userData'), 'courses')
export const repoDir = (id: string) => join(root(), id, 'repo')
const metaFile = (id: string) => join(root(), id, 'course.json')
const progressFile = () => join(root(), 'progress.json')

/** A course as imported: when, how, at which commit (or version of its pages), and its outline */
export interface Imported {
  id: string
  importedAt: number
  updatedAt: number
  commit?: string
  /** A course from the web: the fingerprint of its contents when it was read (main/sources) */
  version?: string
  method: 'git' | 'tarball' | 'web'
  outline: CourseOutline
  /** What reading it had to say (pages skipped and why) */
  notes?: string[]
}

export interface CourseCard extends CatalogueCourse {
  imported?: { importedAt: number; updatedAt: number; lessons: number; done: number; /** When a lesson of it was last studied */ lastStudied?: number; next?: { id: string; title: string; module: string } }
  /** Found by the weekly check (main/courseFresh): new this week, not imported */
  suggested?: { at: number; why: string; score: number; by: 'claude' | 'score' }
  /** Imported, and its source has changed since: one click brings it up to date */
  updateAvailable?: boolean
}

export interface CourseDetail {
  course: CatalogueCourse
  imported: Imported | null
  progress: CourseProgress
  /** Its source changed since it was imported (main/courseFresh) */
  updateAvailable?: boolean
}

export interface LessonContent {
  id: string
  title: string
  kind: 'reading' | 'notebook' | 'homework'
  /** The lesson's text as Markdown (a notebook already turned into it), links pointing at GitHub */
  markdown: string
  url: string
  sections: Section[]
  /** Code files beside it in its module */
  code: string[]
  /** `markdown` is the lesson without its noise (shared/pageClean): what was hidden, and the original block by block */
  cleaning?: PageCleaning
}

export type ImportPhase = { id: string; phase: 'fetching' | 'reading' | 'indexing' | 'done' | 'error'; detail?: string }

const broadcast = (e: ImportPhase) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('courses:progress', e)
}

// ---------- Fetching ----------

function run(cmd: string, args: string[], cwd?: string, timeoutMs = 300_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
    p.on('error', (e) => (clearTimeout(timer), resolve({ code: -1, out, err: String(e) })))
    p.on('close', (code) => (clearTimeout(timer), resolve({ code: code ?? -1, out, err })))
  })
}

/** The sparse checkout's patterns: the course's text and code, the licence, the READMEs that order it */
export function sparsePatterns(c: CatalogueCourse): string[] {
  const exts = ['md', 'markdown', 'mdx', 'ipynb', 'adoc', 'asciidoc', 'py', 'sql', 'rs', 'c', 'h', 'cc', 'cpp', 'js', 'ts', 'go', 'sh', 'jl', 'asm', 'toml', 'yml', 'yaml']
  const under = c.split ? null : c.root ? `/${c.root.replace(/\/+$/, '')}/**/` : '/**/'
  const out = ['/LICENSE*', '/LICENCE*', '/COPYING*', '/*.md', '/*.markdown']
  if (c.split) out.push(`/${c.split}`)
  if (under) for (const e of exts) out.push(`${under}*.${e}`)
  if (c.homework) out.push(`/${c.homework.dir}/**/homework*`)
  return out
}

async function gitFetch(c: CatalogueCourse, dir: string): Promise<string | null> {
  if (!c.repo || !c.branch) return null
  const url = `https://github.com/${c.repo}.git`
  const clone = await run('git', ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', c.branch, url, dir])
  if (clone.code !== 0) return null
  const set = await run('git', ['sparse-checkout', 'set', '--no-cone', ...sparsePatterns(c)], dir)
  if (set.code !== 0) return null
  const co = await run('git', ['checkout', c.branch], dir)
  if (co.code !== 0) return null
  return (await run('git', ['rev-parse', 'HEAD'], dir)).out.trim() || null
}

async function gitUpdate(c: CatalogueCourse, dir: string): Promise<string | null> {
  if (!c.branch) return null
  // Patterns may have changed with the catalogue
  await run('git', ['sparse-checkout', 'set', '--no-cone', ...sparsePatterns(c)], dir)
  const f = await run('git', ['fetch', '--depth', '1', '--filter=blob:none', 'origin', c.branch], dir)
  if (f.code !== 0) return null
  const r = await run('git', ['reset', '--hard', 'FETCH_HEAD'], dir)
  if (r.code !== 0) return null
  return (await run('git', ['rev-parse', 'HEAD'], dir)).out.trim() || null
}

/** GitHub's tarball, unpacked with only the files a course is read from */
async function tarballFetch(c: CatalogueCourse, dir: string): Promise<boolean> {
  if (!c.repo || !c.branch) return false
  await fs.mkdir(dir, { recursive: true })
  const res = await fetch(`https://codeload.github.com/${c.repo}/tar.gz/refs/heads/${c.branch}`)
  if (!res.ok || !res.body) return false
  const file = join(dir, '..', 'repo.tar.gz')
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()))
  const includes = ['*.md', '*.markdown', '*.mdx', '*.ipynb', '*.adoc', '*.asciidoc', '*.py', '*.sql', '*.rs', '*.c', '*.h', '*.cpp', '*.js', '*.ts', '*.go', '*.sh', '*.toml', '*.yml', '*.yaml', '*LICENSE*', '*LICENCE*', '*COPYING*'].flatMap((p) => ['--include', p])
  const x = await run('tar', ['-xzf', file, '-C', dir, '--strip-components', '1', ...includes])
  await fs.rm(file, { force: true })
  return x.code === 0
}

// ---------- Reading ----------

/** Every file of the course on disk, by repository path; the text of what is read as lessons (notebooks as Markdown) */
async function readRepo(c: CatalogueCourse): Promise<RepoFile[]> {
  const myst = sourceOf(c) === 'jupyterbook'
  const base = repoDir(c.id)
  const out: RepoFile[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && FETCHED.test(e.name)) {
        const path = relative(base, full).split(sep).join('/')
        if (/(^|\/)_toc\.ya?ml$/.test(path)) {
          out.push({ path, text: await fs.readFile(full, 'utf8').catch(() => '') })
          continue
        }
        if (!CONTENT.test(path)) {
          out.push({ path })
          continue
        }
        const st = await fs.stat(full)
        // A notebook can carry megabytes of pictures in its outputs: read it, but skip one that is mostly that
        if (st.size > 8_000_000) continue
        const raw = await fs.readFile(full, 'utf8').catch(() => '')
        const text = /\.ipynb$/i.test(path) ? (notebookMarkdown(raw) ?? '') : /\.(adoc|asciidoc)$/i.test(path) ? asciidocMarkdown(raw) : raw
        out.push({ path, text: myst ? mystMarkdown(text) : text })
      }
    }
  }
  await walk(base, 0)
  return out
}

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
const writeJson = async (file: string, v: unknown) => {
  await fs.mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(v))
  await fs.rename(tmp, file)
}

export const importedCourse = (id: string) => readJson<Imported | null>(metaFile(id), null)

// ---------- The index ----------

let index: Backend | null = null
const courseIndex = () => (index ??= openChunkIndex(join(root(), 'index')))
/** Paths in the index are "course id/path in the repository" */
const indexPath = (id: string, path: string) => `${id}/${path}`

async function indexCourse(c: CatalogueCourse, files: RepoFile[], outline: CourseOutline) {
  const ix = courseIndex()
  for (const p of await ix.paths()) if (p.startsWith(`${c.id}/`)) await ix.remove(p)
  const lessonFiles = new Set(outline.modules.flatMap((m) => m.lessons.map((l) => l.path)))
  for (const f of files) {
    if (!f.text || !lessonFiles.has(f.path)) continue
    const chunks = chunkMarkdown(indexPath(c.id, f.path), `${titleOf(f.text, f.path)} · ${c.title}`, cleanPage(f.text, { repo: c.repo, rules: c.clean }).markdown)
    await ix.replace(indexPath(c.id, f.path), chunks)
  }
  await ix.commit()
}

/** Passages of the imported courses about a query, best first */
export async function searchCourses(q: string, limit = 12): Promise<{ course: string; path: string; title: string; heading: string; text: string; score: number }[]> {
  if (!q.trim() || !existsSync(join(root(), 'index'))) return []
  const hits = await courseIndex().search(q, limit).catch(() => [])
  return hits.map((h) => ({ course: h.path.split('/')[0], path: h.path.split('/').slice(1).join('/'), title: h.title, heading: h.heading, text: h.text, score: h.score }))
}

// ---------- Import, update, remove ----------

const busy = new Map<string, Promise<Imported>>()

async function readAndIndex(c: CatalogueCourse, method: Imported['method'], commit: string | undefined, importedAt: number): Promise<Imported> {
  broadcast({ id: c.id, phase: 'reading' })
  const files = await readRepo(c)
  const outline = buildOutline(c, files)
  if (!outline.lessons) throw new Error('Nothing in it reads as lessons')
  broadcast({ id: c.id, phase: 'indexing', detail: `${outline.lessons} lessons` })
  await indexCourse(c, files, outline).catch((e) => console.warn('[courses] index failed', e))
  const meta: Imported = { id: c.id, importedAt, updatedAt: Date.now(), ...(commit ? { commit } : {}), method, outline }
  await writeJson(metaFile(c.id), meta)
  broadcast({ id: c.id, phase: 'done', detail: `${outline.lessons} lessons` })
  // Its lectures' captions, in the background, so lessons can draw on them (main/related)
  void import('./related').then((r) => r.fetchCourseTranscripts()).catch(() => {})
  return meta
}

/** A Jupyter Book read from a repository of its notebooks: its _toc.yml, fetched from where the book keeps it */
async function fetchJbToc(c: CatalogueCourse, dir: string): Promise<void> {
  if (!c.jbToc) return
  const res = await fetch(c.jbToc, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
  if (res?.ok) await fs.writeFile(join(dir, '_toc.yml'), await res.text())
}

/** A course from GitHub (or a Jupyter Book kept there): a sparse clone, else the tarball */
async function repoImport(c: CatalogueCourse, dir: string): Promise<{ method: Imported['method']; commit?: string }> {
  broadcast({ id: c.id, phase: 'fetching', detail: `github.com/${c.repo}` })
  let method: Imported['method'] = 'git'
  const commit = await gitFetch(c, dir).catch(() => null)
  if (!commit) {
    await fs.rm(dir, { recursive: true, force: true })
    method = 'tarball'
    if (!(await tarballFetch(c, dir).catch(() => false))) throw new Error(`Couldn't download github.com/${c.repo}`)
  }
  await fetchJbToc(c, dir)
  return { method, ...(commit ? { commit } : {}) }
}

/**
 * A course from the web (main/sources): its adapter reads it politely, and its lessons are written
 * into the course's own folder (a Markdown file a lesson, or the notebook it is), with its outline
 * built from the adapter's order. Captions the source publishes are kept as its videos' transcripts.
 */
async function webImport(c: CatalogueCourse, dir: string, importedAt: number): Promise<Imported> {
  const { buildCourse } = await import('./courseSources')
  broadcast({ id: c.id, phase: 'fetching', detail: homeUrl(c).replace(/^https?:\/\/(www\.)?/, '') })
  const built = await buildCourse(c, (detail) => broadcast({ id: c.id, phase: 'fetching', detail }))
  broadcast({ id: c.id, phase: 'reading' })
  await fs.mkdir(dir, { recursive: true })
  const modules: CourseOutline['modules'] = []
  const files: RepoFile[] = []
  for (const [mi, m] of built.modules.entries()) {
    const lessons: CourseOutline['modules'][number]['lessons'] = []
    for (const [li, l] of m.lessons.entries()) {
      const folder = `m${String(mi + 1).padStart(2, '0')}`
      const path = `${folder}/${String(li + 1).padStart(2, '0')}-${slugify(l.title, 50)}.${l.notebook ? 'ipynb' : 'md'}`
      await fs.mkdir(join(dir, folder), { recursive: true })
      await fs.writeFile(join(dir, ...path.split('/')), l.notebook ?? l.markdown)
      const text = l.notebook ? (notebookMarkdown(l.notebook) ?? l.markdown) : l.markdown
      files.push({ path, text })
      lessons.push({ id: path, path, title: l.title, kind: l.kind, words: (text.match(/\S+/g) ?? []).length, url: l.url })
    }
    if (lessons.length) modules.push({ id: `m${modules.length + 1}`, title: m.title, lessons, code: [] })
  }
  const outline: CourseOutline = { modules, lessons: modules.reduce((n, m) => n + m.lessons.length, 0) }
  if (!outline.lessons) throw new Error(built.notes[0] ?? 'Nothing in it reads as lessons')
  // OCW's own captions, kept as the lectures' transcripts (the player shows them, lessons search them)
  if (built.captions.length) {
    const { keepTranscript } = await import('./videos')
    for (const cap of built.captions) await keepTranscript(cap.video, { title: cap.title, channel: c.by, segments: cap.segments }, undefined, c.title).catch(() => null)
  }
  broadcast({ id: c.id, phase: 'indexing', detail: `${outline.lessons} lessons` })
  await indexCourse(c, files, outline).catch((e) => console.warn('[courses] index failed', e))
  const meta: Imported = { id: c.id, importedAt, updatedAt: Date.now(), version: built.version, method: 'web', outline, ...(built.notes.length ? { notes: built.notes.slice(0, 40) } : {}) }
  await writeJson(metaFile(c.id), meta)
  broadcast({ id: c.id, phase: 'done', detail: `${outline.lessons} lessons` })
  void import('./related').then((r) => r.fetchCourseTranscripts()).catch(() => {})
  return meta
}

/** Imports a course from the catalogue (or returns it as it is, when it already is). Only ever on your say: nothing imports by itself */
export function importCourse(id: string): Promise<Imported> {
  const c = catalogueCourse(id)
  if (!c) return Promise.reject(new Error('Not in the catalogue'))
  const had = busy.get(id)
  if (had) return had
  const job = (async () => {
    const existing = await importedCourse(id)
    if (existing) return existing
    const dir = repoDir(id)
    await fs.rm(join(root(), id), { recursive: true, force: true })
    await fs.mkdir(join(root(), id), { recursive: true })
    // A suggestion you import stays in the catalogue from now on
    await import('./courseFresh').then((f) => f.adopt(id)).catch(() => {})
    if (!fromRepo(c)) return webImport(c, dir, Date.now())
    const r = await repoImport(c, dir)
    return readAndIndex(c, r.method, r.commit, Date.now())
  })()
  busy.set(id, job)
  job.catch((e) => broadcast({ id, phase: 'error', detail: (e as Error).message })).finally(() => busy.delete(id))
  return job
}

/** Brings an imported course up to date (git pull, a fresh download, or its pages read again) and reads it again */
export function updateCourse(id: string): Promise<Imported> {
  const c = catalogueCourse(id)
  if (!c) return Promise.reject(new Error('Not in the catalogue'))
  const had = busy.get(id)
  if (had) return had
  const job = (async () => {
    const meta = await importedCourse(id)
    if (!meta) return importCourse(id)
    const dir = repoDir(id)
    let done: Imported
    if (!fromRepo(c)) {
      // Read into a new folder; the old one is replaced only once the new one is whole
      const fresh = `${dir}.new`
      await fs.rm(fresh, { recursive: true, force: true })
      done = await webImport(c, fresh, meta.importedAt)
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rename(fresh, dir)
    } else {
      broadcast({ id, phase: 'fetching', detail: `github.com/${c.repo}` })
      let commit: string | null = null
      let method = meta.method
      if (existsSync(join(dir, '.git'))) commit = await gitUpdate(c, dir).catch(() => null)
      if (!commit) {
        const fresh = `${dir}.new`
        await fs.rm(fresh, { recursive: true, force: true })
        if (!(await tarballFetch(c, fresh).catch(() => false))) throw new Error(`Couldn't download github.com/${c.repo}`)
        await fs.rm(dir, { recursive: true, force: true })
        await fs.rename(fresh, dir)
        method = 'tarball'
      }
      await fetchJbToc(c, dir)
      done = await readAndIndex(c, method, commit ?? undefined, meta.importedAt)
    }
    await import('./courseFresh').then((f) => f.noteUpdated(id)).catch(() => {})
    return done
  })()
  busy.set(id, job)
  job.catch((e) => broadcast({ id, phase: 'error', detail: (e as Error).message })).finally(() => busy.delete(id))
  return job
}

/** Removes a course's copy and its index entries; its progress is kept, in case it comes back */
export async function removeCourse(id: string): Promise<void> {
  if (!catalogueCourse(id)) return
  const ix = courseIndex()
  for (const p of await ix.paths().catch(() => [] as string[])) if (p.startsWith(`${id}/`)) await ix.remove(p)
  await ix.commit().catch(() => {})
  await fs.rm(join(root(), id), { recursive: true, force: true })
}

// ---------- Progress ----------

let progressCache: Record<string, CourseProgress> | null = null
let progressWrite: Promise<void> = Promise.resolve()
const allProgress = async () => (progressCache ??= await readJson<Record<string, CourseProgress>>(progressFile(), {}))

async function setProgress(course: string, lesson: string, f: (p: LessonProgress | undefined) => LessonProgress | undefined) {
  const all = await allProgress()
  const next = f(all[course]?.[lesson])
  all[course] = { ...(all[course] ?? {}) }
  if (next) all[course][lesson] = next
  else delete all[course][lesson]
  const snapshot = JSON.stringify(all)
  progressWrite = progressWrite.then(() => writeJson(progressFile(), JSON.parse(snapshot))).catch(() => {})
  await progressWrite
}

/**
 * How you are getting on with a lesson as you read it: how far down you read, how much of each of
 * its videos you watched, code you ran. Once it's read to the end (and a video of it watched),
 * What you know hears the lesson was studied: a light "taught", never a right answer.
 */
export async function trackLesson(course: string, lesson: string, patch: { read?: number; video?: { id: string; watched: number }; ran?: boolean }): Promise<CourseProgress> {
  const now = Date.now()
  let became = false
  await setProgress(course, lesson, (p) => {
    const base: LessonProgress = p ?? { started: now, updated: now, done: false, right: 0, partly: 0, wrong: 0 }
    const read = Math.max(base.read ?? 0, Math.min(1, Number(patch.read) || 0))
    const watched = { ...(base.watched ?? {}) }
    if (patch.video && /^[\w-]{11}$/.test(patch.video.id)) watched[patch.video.id] = Math.max(watched[patch.video.id] ?? 0, Math.min(1, Number(patch.video.watched) || 0))
    const next: LessonProgress = { ...base, updated: now, read, ...(Object.keys(watched).length ? { watched } : {}), ...(patch.ran ? { ran: (base.ran ?? 0) + 1 } : {}) }
    became = !studied(base, Object.keys(watched).length) && studied(next, Object.keys(watched).length)
    return next
  })
  if (became) {
    const meta = await importedCourse(course)
    const c = catalogueCourse(course)
    const l = meta?.outline.modules.flatMap((m) => m.lessons.map((x) => ({ m, x }))).find((y) => y.x.id === lesson)
    if (c && l) {
      const { noteEvidence } = await import('./knowledge')
      const topic = /^(introduction|intro|overview|readme|summary)$/i.test(l.x.title.trim()) ? l.m.title : l.x.title
      await noteEvidence({ topic, kind: 'taught', source: `course:${course}`, pos: `${lesson}.studied`, at: now, weight: 0.5 }).catch(() => {})
    }
  }
  return (await allProgress())[course] ?? {}
}

/** The imported courses' repositories, so links into them open in the course reader */
export async function importedRepos(): Promise<{ id: string; repo: string; branch: string }[]> {
  const out: { id: string; repo: string; branch: string }[] = []
  for (const c of allCourses()) if (c.repo && c.branch && fromRepo(c) && existsSync(metaFile(c.id))) out.push({ id: c.id, repo: c.repo, branch: c.branch })
  return out
}

export async function markLesson(course: string, lesson: string, done: boolean): Promise<CourseProgress> {
  const now = Date.now()
  await setProgress(course, lesson, (p) => (done ? { right: 0, partly: 0, wrong: 0, started: now, ...p, updated: now, done: true } : p?.record ? { ...p, done: false, updated: now } : undefined))
  return (await allProgress())[course] ?? {}
}

/** A lesson was saved (main/lessons): when it is a course's, its progress follows it */
export async function noteCourseLesson(record: LessonRecord): Promise<void> {
  const ref = record.options?.course
  if (!ref?.id || !ref.lesson) return
  const d = digestLesson(record)
  await setProgress(ref.id, ref.lesson, (p) => ({
    record: record.id,
    started: p?.started ?? record.started,
    updated: record.updated,
    done: !!p?.done || !!record.finished,
    right: d?.right ?? 0,
    partly: d?.partly ?? 0,
    wrong: d?.wrong ?? 0
  }))
}

// ---------- What the window asks for ----------

/** When you last studied any lesson of a course */
const lastStudied = (p: CourseProgress | undefined) => Math.max(0, ...Object.values(p ?? {}).map((x) => x.updated || x.started || 0))

export async function listCourses(): Promise<CourseCard[]> {
  const progress = await allProgress()
  const fresh = await import('./courseFresh').then((f) => f.freshState()).catch(() => null)
  const out: CourseCard[] = []
  for (const c of allCourses()) {
    // A suggestion you dismissed is gone from the catalogue
    if (fresh?.dismissed.includes(c.id)) continue
    const meta = await importedCourse(c.id)
    const sug = fresh?.suggestions.find((x) => x.course.id === c.id)
    if (!meta) {
      out.push({ ...c, ...(sug ? { suggested: { at: sug.at, why: sug.why, score: sug.score, by: sug.by } } : {}) })
      continue
    }
    const p = progress[c.id]
    const next = nextLesson(meta.outline, p)
    const latest = fresh?.updates[c.id]
    out.push({
      ...c,
      imported: { importedAt: meta.importedAt, updatedAt: meta.updatedAt, lessons: meta.outline.lessons, done: courseDone(meta.outline, p), ...(lastStudied(p) ? { lastStudied: lastStudied(p) } : {}), ...(next ? { next: { id: next.lesson.id, title: next.lesson.title, module: next.module.title } } : {}) },
      ...(latest && latest !== (meta.version ?? meta.commit) ? { updateAvailable: true } : {})
    })
  }
  return out
}

export async function courseDetail(id: string): Promise<CourseDetail | null> {
  const fresh = await import('./courseFresh').then((f) => f.freshState()).catch(() => null)
  const course = catalogueCourse(id)
  if (!course) return null
  const imported = await importedCourse(id)
  return { course, imported, progress: (await allProgress())[id] ?? {}, ...(imported && fresh?.updates[id] ? { updateAvailable: true } : {}) }
}

/** The transcript Tide keeps for a video, as a lesson's text, where a lesson marks its place */
async function withTranscripts(md: string): Promise<string> {
  const marks = [...md.matchAll(/<!-- tide:transcript ([\w-]{11}) -->/g)]
  if (!marks.length) return md
  const { getTranscript } = await import('./videos')
  for (const m of marks) {
    const r = await getTranscript(m[1]).catch(() => null)
    const lines = r?.transcript?.lines ?? []
    const text = lines.length ? `## Transcript\n\n${transcriptMarkdown(m[1], lines.map((l) => ({ start: l.start, text: l.text })))}` : ''
    md = md.replace(m[0], text)
  }
  return md.replace(/\s+$/, '')
}

/** Where a lesson is on the web: its own page, a Jupyter Book's page on its site, else on GitHub */
function webUrlOf(c: CatalogueCourse, lesson: { path: string; id: string; url?: string }): string {
  if (lesson.url) return lesson.url
  if (sourceOf(c) === 'jupyterbook' && c.url) return `${c.url.replace(/\/+$/, '')}/${lesson.path.split('/').pop()!.replace(/\.(md|ipynb)$/i, '')}.html`
  return c.repo && c.branch ? lessonUrl(c as CatalogueCourse & { repo: string; branch: string }, lesson) : homeUrl(c)
}

/** A lesson's own text, ready to read or teach from */
export async function lessonContent(id: string, lessonId: string): Promise<LessonContent | null> {
  const c = catalogueCourse(id)
  const meta = await importedCourse(id)
  if (!c || !meta) return null
  const mod = meta.outline.modules.find((m) => m.lessons.some((l) => l.id === lessonId))
  const lesson = mod?.lessons.find((l) => l.id === lessonId)
  if (!mod || !lesson) return null
  const full = join(repoDir(id), ...lesson.path.split('/'))
  // Never outside the course's own copy
  if (!full.startsWith(repoDir(id) + sep)) return null
  const raw = await fs.readFile(full, 'utf8').catch(() => null)
  if (raw === null) return null
  let md = /\.ipynb$/i.test(lesson.path) ? (notebookMarkdown(raw, { images: meta.method === 'web' || sourceOf(c) === 'jupyterbook' }) ?? '') : /\.(adoc|asciidoc)$/i.test(lesson.path) ? asciidocMarkdown(raw) : raw
  if (sourceOf(c) === 'jupyterbook') md = mystMarkdown(md)
  // A part of one long file
  if (lesson.range) md = md.slice(lesson.range[0], lesson.range[1]).replace(/\s+$/, '')
  if (fromRepo(c) && c.repo && c.branch) md = absolutise(md, c as CatalogueCourse & { repo: string; branch: string }, lesson.path)
  else md = await withTranscripts(md)
  // The lesson, not the badges, sign-up banners and sponsor sections around it: what you read, what the tutor teaches from
  const { markdown, cleaning } = cleanPage(md, { repo: c.repo, rules: c.clean })
  return { id: lesson.id, title: lesson.title, kind: lesson.kind, markdown, url: webUrlOf(c, lesson), sections: lessonSections(markdown, lesson.title, lesson.kind), code: mod.code, ...(cleaning ? { cleaning } : {}) }
}

/** A code file of a course, to read or run */
export async function courseFile(id: string, path: string): Promise<string | null> {
  if (!catalogueCourse(id) || path.includes('..')) return null
  const full = join(repoDir(id), ...path.split('/'))
  if (!full.startsWith(repoDir(id) + sep)) return null
  const st = await fs.stat(full).catch(() => null)
  if (!st || st.size > 400_000) return null
  return fs.readFile(full, 'utf8').catch(() => null)
}

// ---------- Teaching from it (main/sourceLed) ----------

const day = (at: number) => new Date(at).toISOString().slice(0, 10)

/** A course lesson as a source a reading is taken from */
function candidateOf(c: CatalogueCourse, l: LessonContent, fetchedAt: number): Candidate {
  return { kind: 'course', title: l.title, by: `${c.title} · ${c.by}`, url: l.url, licence: c.tier === 'open' ? c.licence : 'No open licence: for your own study', fetchedAt, text: l.markdown, format: 'md' }
}

/** The lesson a course lesson is taught from: its text as a source, and its sections (the plan's steps) */
export async function courseLessonSource(id: string, lessonId: string): Promise<{ candidate: Candidate; sections: Section[] } | null> {
  const c = catalogueCourse(id)
  const meta = await importedCourse(id)
  const l = await lessonContent(id, lessonId)
  if (!c || !meta || !l) return null
  return { candidate: candidateOf(c, l, meta.updatedAt), sections: l.sections }
}

/** Lessons of the imported courses that teach a topic, as sources for any lesson on it (at most a few) */
export async function courseCandidates(topic: string, limit = 3): Promise<Candidate[]> {
  const hits = await searchCourses(topic, 20)
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const h of hits) {
    const key = `${h.course}/${h.path}`
    if (seen.has(key)) continue
    seen.add(key)
    const c = catalogueCourse(h.course)
    const meta = await importedCourse(h.course)
    const lesson = meta?.outline.modules.flatMap((m) => m.lessons).find((l) => l.path === h.path)
    if (!c || !meta || !lesson) continue
    const l = await lessonContent(h.course, lesson.id)
    if (l) out.push(candidateOf(c, l, meta.updatedAt))
    if (out.length >= limit) break
  }
  return out
}

// ---------- Save to my notes ----------

const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Lesson'

/** Copies a course's lessons into your notes folder, under Courses/<title>, each with where it is from */
export async function saveToNotes(id: string): Promise<{ folder: string; files: number }> {
  const c = catalogueCourse(id)
  const meta = await importedCourse(id)
  if (!c || !meta) throw new Error('Import the course first')
  const folder = uniquePath(`Courses/${safe(c.title)}`)
  let files = 0
  for (const [mi, m] of meta.outline.modules.entries()) {
    for (const [li, l] of m.lessons.entries()) {
      const content = await lessonContent(id, l.id)
      if (!content) continue
      const head = `---\ntitle: "${l.title.replace(/"/g, "'")}"\nsource: ${content.url}\ncourse: "${c.title.replace(/"/g, "'")}"\nauthor: "${c.by.replace(/"/g, "'")}"\nlicence: "${c.licence.replace(/"/g, "'")}"\nfetched: ${day(meta.updatedAt)}\n---\n\n`
      const note = `${head}> From [${c.title}](${homeUrl(c)}) by ${c.by}, ${c.licence}. ${c.tier === 'personal' ? 'For your own study only.' : ''}\n\n${content.markdown}\n`
      await writeText(`${folder}/${String(mi + 1).padStart(2, '0')} ${safe(m.title)}/${String(li + 1).padStart(2, '0')} ${safe(l.title)}.md`, note)
      files++
    }
  }
  return { folder, files }
}

// ---------- A look before importing ----------

const previews = new Map<string, { at: number; markdown: string | null }>()

/**
 * The course's README (or the file it is read from), fetched from GitHub to show what the course is
 * before you import it: read like a web page, kept in memory for an hour, never saved.
 */
export async function coursePreview(id: string): Promise<{ markdown: string; url: string; cleaning?: PageCleaning } | null> {
  const p = await rawPreview(id)
  if (!p) return null
  const c = catalogueCourse(id)
  const { markdown, cleaning } = cleanPage(p.markdown, { repo: c?.repo, rules: c?.clean })
  return { ...p, markdown, ...(cleaning ? { cleaning } : {}) }
}

async function rawPreview(id: string): Promise<{ markdown: string; url: string } | null> {
  const c = catalogueCourse(id)
  if (!c) return null
  if (!fromRepo(c)) {
    const had = previews.get(id)
    if (had && Date.now() - had.at < 3_600_000) return had.markdown ? { markdown: had.markdown, url: homeUrl(c) } : null
    const { previewCourse } = await import('./courseSources')
    const markdown = await previewCourse(c).catch(() => null)
    previews.set(id, { at: Date.now(), markdown })
    return markdown ? { markdown, url: homeUrl(c) } : null
  }
  if (!c.repo || !c.branch) return null
  const path = c.split ?? (c.root ? `${c.root}/README.md` : 'README.md')
  const url = `https://github.com/${c.repo}/blob/${c.branch}/${path}`
  const had = previews.get(id)
  if (had && Date.now() - had.at < 3_600_000) return had.markdown ? { markdown: had.markdown, url } : null
  let markdown: string | null = null
  for (const p of [...new Set([path, 'README.md'])]) {
    const res = await fetch(`https://raw.githubusercontent.com/${c.repo}/${c.branch}/${p}`).catch(() => null)
    if (!res?.ok) continue
    const raw = await res.text()
    const md = /\.ipynb$/i.test(p) ? notebookMarkdown(raw) : raw
    if (md?.trim()) {
      markdown = absolutise(md.length > 60_000 ? md.slice(0, 60_000) : md, c, p)
      if (sourceOf(c) === 'jupyterbook') markdown = mystMarkdown(markdown)
      break
    }
  }
  previews.set(id, { at: Date.now(), markdown })
  return markdown ? { markdown, url } : null
}
