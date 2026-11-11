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
  CATALOGUE,
  CONTENT,
  FETCHED,
  absolutise,
  buildOutline,
  catalogueCourse,
  courseDone,
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
import type { Candidate } from '@shared/sourceLed'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson } from '@shared/lessonMemory'
import { chunkMarkdown, openChunkIndex, type Backend } from './search'
import { uniquePath, writeText } from './vault'

const root = () => join(app.getPath('userData'), 'courses')
const repoDir = (id: string) => join(root(), id, 'repo')
const metaFile = (id: string) => join(root(), id, 'course.json')
const progressFile = () => join(root(), 'progress.json')

/** A course as imported: when, how, at which commit, and its outline */
export interface Imported {
  id: string
  importedAt: number
  updatedAt: number
  commit?: string
  method: 'git' | 'tarball'
  outline: CourseOutline
}

export interface CourseCard extends CatalogueCourse {
  imported?: { importedAt: number; updatedAt: number; lessons: number; done: number; next?: { id: string; title: string; module: string } }
}

export interface CourseDetail {
  course: CatalogueCourse
  imported: Imported | null
  progress: CourseProgress
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
  const exts = ['md', 'markdown', 'mdx', 'ipynb', 'py', 'sql', 'rs', 'c', 'h', 'cc', 'cpp', 'js', 'ts', 'go', 'sh', 'jl', 'asm', 'toml', 'yml', 'yaml']
  const under = c.split ? null : c.root ? `/${c.root.replace(/\/+$/, '')}/**/` : '/**/'
  const out = ['/LICENSE*', '/LICENCE*', '/COPYING*', '/*.md', '/*.markdown']
  if (c.split) out.push(`/${c.split}`)
  if (under) for (const e of exts) out.push(`${under}*.${e}`)
  if (c.homework) out.push(`/${c.homework.dir}/**/homework*`)
  return out
}

async function gitFetch(c: CatalogueCourse, dir: string): Promise<string | null> {
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
  await fs.mkdir(dir, { recursive: true })
  const res = await fetch(`https://codeload.github.com/${c.repo}/tar.gz/refs/heads/${c.branch}`)
  if (!res.ok || !res.body) return false
  const file = join(dir, '..', 'repo.tar.gz')
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()))
  const includes = ['*.md', '*.markdown', '*.mdx', '*.ipynb', '*.py', '*.sql', '*.rs', '*.c', '*.h', '*.cpp', '*.js', '*.ts', '*.go', '*.sh', '*.toml', '*.yml', '*.yaml', '*LICENSE*', '*LICENCE*', '*COPYING*'].flatMap((p) => ['--include', p])
  const x = await run('tar', ['-xzf', file, '-C', dir, '--strip-components', '1', ...includes])
  await fs.rm(file, { force: true })
  return x.code === 0
}

// ---------- Reading ----------

/** Every file of the course on disk, by repository path; the text of what is read as lessons (notebooks as Markdown) */
async function readRepo(c: CatalogueCourse): Promise<RepoFile[]> {
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
        if (!CONTENT.test(path)) {
          out.push({ path })
          continue
        }
        const st = await fs.stat(full)
        // A notebook can carry megabytes of pictures in its outputs: read it, but skip one that is mostly that
        if (st.size > 8_000_000) continue
        const raw = await fs.readFile(full, 'utf8').catch(() => '')
        out.push({ path, text: /\.ipynb$/i.test(path) ? (notebookMarkdown(raw) ?? '') : raw })
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
    const chunks = chunkMarkdown(indexPath(c.id, f.path), `${titleOf(f.text, f.path)} · ${c.title}`, f.text)
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
  return meta
}

/** Imports a course from the catalogue (or returns it as it is, when it already is) */
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
    broadcast({ id, phase: 'fetching', detail: `github.com/${c.repo}` })
    let method: Imported['method'] = 'git'
    let commit = await gitFetch(c, dir).catch(() => null)
    if (!commit) {
      await fs.rm(dir, { recursive: true, force: true })
      method = 'tarball'
      if (!(await tarballFetch(c, dir).catch(() => false))) throw new Error(`Couldn't download github.com/${c.repo}`)
    }
    return readAndIndex(c, method, commit ?? undefined, Date.now())
  })()
  busy.set(id, job)
  job.catch((e) => broadcast({ id, phase: 'error', detail: (e as Error).message })).finally(() => busy.delete(id))
  return job
}

/** Brings an imported course up to date (git pull, or a fresh download) and reads it again */
export function updateCourse(id: string): Promise<Imported> {
  const c = catalogueCourse(id)
  if (!c) return Promise.reject(new Error('Not in the catalogue'))
  const had = busy.get(id)
  if (had) return had
  const job = (async () => {
    const meta = await importedCourse(id)
    if (!meta) return importCourse(id)
    broadcast({ id, phase: 'fetching', detail: `github.com/${c.repo}` })
    const dir = repoDir(id)
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
    return readAndIndex(c, method, commit ?? undefined, meta.importedAt)
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

export async function listCourses(): Promise<CourseCard[]> {
  const progress = await allProgress()
  const out: CourseCard[] = []
  for (const c of CATALOGUE) {
    const meta = await importedCourse(c.id)
    if (!meta) {
      out.push({ ...c })
      continue
    }
    const p = progress[c.id]
    const next = nextLesson(meta.outline, p)
    out.push({
      ...c,
      imported: { importedAt: meta.importedAt, updatedAt: meta.updatedAt, lessons: meta.outline.lessons, done: courseDone(meta.outline, p), ...(next ? { next: { id: next.lesson.id, title: next.lesson.title, module: next.module.title } } : {}) }
    })
  }
  return out
}

export async function courseDetail(id: string): Promise<CourseDetail | null> {
  const course = catalogueCourse(id)
  if (!course) return null
  return { course, imported: await importedCourse(id), progress: (await allProgress())[id] ?? {} }
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
  let md = /\.ipynb$/i.test(lesson.path) ? (notebookMarkdown(raw) ?? '') : raw
  // A part of one long file
  if (lesson.range) md = md.slice(lesson.range[0], lesson.range[1]).replace(/\s+$/, '')
  md = absolutise(md, c, lesson.path)
  return { id: lesson.id, title: lesson.title, kind: lesson.kind, markdown: md, url: lessonUrl(c, lesson), sections: lessonSections(md, lesson.title, lesson.kind), code: mod.code }
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
  return { kind: 'course', title: l.title, by: `${c.title} · ${c.by}`, url: l.url, licence: c.licence, fetchedAt, text: l.markdown, format: 'md' }
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
      const note = `${head}> From [${c.title}](https://github.com/${c.repo}) by ${c.by}, ${c.licence}. ${c.tier === 'personal' ? 'For your own study only.' : ''}\n\n${content.markdown}\n`
      await writeText(`${folder}/${String(mi + 1).padStart(2, '0')} ${safe(m.title)}/${String(li + 1).padStart(2, '0')} ${safe(l.title)}.md`, note)
      files++
    }
  }
  return { folder, files }
}
