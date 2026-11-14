/**
 * Writing review (shared/writing has the rules): pieces in the notes folder's Writing folder and
 * in the writing folders the learner added in Settings (an Obsidian vault of essays, say), each
 * reviewed by the local checker and, when Claude can, by Opus.
 *
 * - Files are read from those folders only. A piece is written only by save(), which the editor
 *   the learner drives calls; a review never touches the file.
 * - Tide's records live in the notes folder's .tide/writing: one JSON per piece, keyed by its
 *   path (comments, the overall note, every review's counts, the conversation), never in the
 *   Markdown, so the note stays clean in Obsidian.
 * - After a review, the habits across pieces are tallied and the top recurring ones become the
 *   learner profile's "Writing habits:" line (main/learnerProfile noteWritingHabits).
 * - Topics to write about: the open to-dos of a Things 4 project (Writing, by default) and the
 *   topics note (Coach/Writing topics.md), cached so they show when Things isn't running. Starting
 *   a draft makes a new file (never over an existing one) and ticks the note's item; Things is
 *   only changed when the learner asks, after marking a piece published.
 */
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  detectKind,
  draftFileName,
  draftFrontMatter,
  frontMatter,
  habits,
  habitsLine,
  isDraft,
  isKind,
  parseTopics,
  pieceTitle,
  reanchor,
  tickTopic,
  wordCount,
  type FrontMatter,
  type Habit,
  type PieceRecord,
  type PieceSummary,
  type WritingComment,
  type WritingKind
} from '@shared/writing'
import { checkMechanics, recheckLocal } from '@shared/writingCheck'
import { HEIC_FILE, IMAGE_FILE, attachmentDir, attachmentName, attachmentSetting, resolveEmbed } from '@shared/writingMedia'
import { DEFAULT_FIELDS, UNSORTED, pieceDates, pieceField, pieceTags, setFrontTags, type MySections } from '@shared/writingMeta'
import {
  REVIEW_SYSTEM,
  RECHECK_SYSTEM,
  challengePrompt,
  challengeSystem,
  combineReview,
  mergeTopics,
  parseRecheck,
  parseReview,
  passageAround,
  recheckPrompt,
  reviewPrompt,
  topicsFromThings,
  type Topic
} from '@shared/writingPrompt'
import { getSettings } from './settings'
import { absPath, readText, vaultRoot, writeText } from './vault'

const DIR = '.tide/writing'
const PIECES = `${DIR}/pieces`
const TOPICS_CACHE = `${DIR}/topics.json`
const DRAFTS = `${DIR}/drafts.json`
export const TOPICS_NOTE = 'Coach/Writing topics.md'
/** Where new drafts go in the notes folder, and the folder there that counts as writing */
export const VAULT_WRITING = 'Writing'
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', '.tide', 'images', 'attachments', 'assets', 'templates', '_templates'])

export interface WritingRoot {
  root: string
  label: string
  vault: boolean
}

/** Tide's own notes folder always, then the folders added in Settings that are still there */
export function roots(): WritingRoot[] {
  const out: WritingRoot[] = []
  try {
    out.push({ root: resolve(vaultRoot()), label: 'Tide', vault: true })
  } catch {
    // No notes folder yet
  }
  for (const f of getSettings().writing?.folders ?? []) {
    const r = resolve(f)
    if (existsSync(r) && !out.some((x) => x.root === r)) out.push({ root: r, label: basename(r), vault: false })
  }
  return out
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + sep)

/** A piece's absolute path, checked: a Markdown file inside one of the writing roots */
export function resolvePiece(path: string): { abs: string; root: WritingRoot } {
  const rs = roots()
  const abs = isAbsolute(path) ? resolve(path) : absPath(path)
  const root = rs.filter((r) => inside(r.root, abs)).sort((a, b) => b.root.length - a.root.length)[0]
  if (!root || !/\.md$/i.test(abs)) throw new Error('That file isn’t in one of your writing folders.')
  return { abs, root }
}

const keyOf = (abs: string) => createHash('sha1').update(abs).digest('hex').slice(0, 20)
const recordPath = (abs: string) => `${PIECES}/${keyOf(abs)}.json`

export async function readRecord(abs: string): Promise<PieceRecord> {
  try {
    const r = JSON.parse(await readText(recordPath(abs))) as PieceRecord
    return { ...r, path: abs, comments: r.comments ?? [], runs: r.runs ?? [] }
  } catch {
    return { path: abs, comments: [], runs: [] }
  }
}

async function writeRecord(r: PieceRecord): Promise<void> {
  await writeText(recordPath(r.path), JSON.stringify(r))
}

async function allRecords(): Promise<PieceRecord[]> {
  const dir = absPath(PIECES)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: PieceRecord[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      out.push(JSON.parse(await fs.readFile(join(dir, n), 'utf8')))
    } catch {
      // A torn record
    }
  }
  return out
}

/** Markdown files under a folder, shallow enough to stay quick */
async function walk(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 5 || out.length > 1500) return out
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(p, depth + 1, out)
    } else if (/\.md$/i.test(e.name)) out.push(p)
  }
  return out
}

async function summary(abs: string, root: WritingRoot, rec?: PieceRecord): Promise<PieceSummary | null> {
  try {
    const [md, st] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    const kind = rec?.kind ?? detectKind(md, abs).kind
    const tags = pieceTags(md)
    const fm = frontMatter(md)
    return {
      ...pieceDates(fm.data, { birthtime: st.birthtimeMs, mtime: st.mtimeMs }),
      tags,
      field: pieceField(md, tags),
      ...(typeof fm.data.field === 'string' && fm.data.field.trim() ? { fieldSet: true } : {}),
      path: abs,
      title: pieceTitle(md, abs),
      kind,
      kindSet: !!rec?.kind,
      words: wordCount(md),
      draft: isDraft(md) && !rec?.published,
      mtime: st.mtimeMs,
      folder: root.label,
      ...(rec?.runs.length ? { lastReviewed: rec.runs[rec.runs.length - 1].at } : {}),
      open: rec?.comments.filter((c) => c.status === 'open').length ?? 0,
      ...(rec?.published ? { published: rec.published } : {})
    }
  } catch {
    return null
  }
}

/** Every piece: drafts first, then the latest changed */
export async function listPieces(): Promise<PieceSummary[]> {
  const rs = roots()
  const records = await allRecords()
  const byPath = new Map(records.map((r) => [r.path, r]))
  const files = new Set<string>()
  for (const r of rs) {
    if (r.vault) {
      for (const f of await walk(join(r.root, VAULT_WRITING))) files.add(f)
      // Anything in the notes folder that was reviewed counts too
      for (const rec of records) if (inside(r.root, rec.path) && existsSync(rec.path)) files.add(rec.path)
    } else for (const f of await walk(r.root)) files.add(f)
  }
  const out: PieceSummary[] = []
  for (const f of files) {
    const root = rs.filter((r) => inside(r.root, f)).sort((a, b) => b.root.length - a.root.length)[0]
    if (!root) continue
    const s = await summary(f, root, byPath.get(f))
    if (s) out.push(s)
  }
  // A tag that names a field some piece declares counts as that field too
  const declared = [...new Set(out.filter((p) => p.fieldSet).map((p) => p.field))]
  if (declared.length)
    for (const p of out) if (p.field === UNSORTED) p.field = pieceField('', p.tags, [...DEFAULT_FIELDS, ...declared])
  return out.sort((a, b) => Number(b.draft) - Number(a.draft) || b.mtime - a.mtime)
}

export interface PieceOpen {
  path: string
  text: string
  title: string
  kind: WritingKind
  kindWhy: string
  folder: string
  record: PieceRecord
  written: number
  edited: number
}

/** A piece and its record, the comments moved to where their words are now (the file may have been edited in Obsidian) */
export async function openPiece(path: string): Promise<PieceOpen> {
  const { abs, root } = resolvePiece(path)
  const text = await fs.readFile(abs, 'utf8')
  const rec = await readRecord(abs)
  const { comments } = reanchor(text, rec.comments)
  const detected = detectKind(text, abs)
  const st = await fs.stat(abs)
  return {
    path: abs,
    text,
    title: pieceTitle(text, abs),
    kind: rec.kind ?? detected.kind,
    kindWhy: rec.kind ? 'You chose it' : detected.why,
    folder: root.label,
    record: { ...rec, comments },
    ...pieceDates(frontMatter(text).data, { birthtime: st.birthtimeMs, mtime: st.mtimeMs })
  }
}

/** The editor's save: the file in place, and the comments' anchors as the editor last placed them */
export async function savePiece(path: string, text: string, comments?: WritingComment[]): Promise<void> {
  const { abs, root } = resolvePiece(path)
  await fs.writeFile(abs, text, 'utf8')
  if (root.vault) {
    const { reindexPath } = await import('./search')
    await reindexPath(relative(root.root, abs).split(sep).join('/')).catch(() => {})
  }
  if (comments) await saveComments(abs, comments)
}

/** Comments as the window has them: dismissed ones, anchors moved by edits */
export async function saveComments(path: string, comments: WritingComment[]): Promise<PieceRecord> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const ids = new Set(comments.map((c) => c.id))
  const next = { ...rec, comments: [...rec.comments.filter((c) => !ids.has(c.id)), ...comments] }
  await writeRecord(next)
  return next
}

export async function setKind(path: string, kind: WritingKind | null): Promise<PieceRecord> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const next: PieceRecord = { ...rec }
  if (kind && isKind(kind)) next.kind = kind
  else delete next.kind
  await writeRecord(next)
  return next
}

/** Marks a piece published (or a draft again): Tide's own state, the file's front matter is left alone */
export async function setPublished(path: string, published: boolean): Promise<{ record: PieceRecord; thingsId?: string }> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const next: PieceRecord = { ...rec }
  if (published) next.published = Date.now()
  else delete next.published
  await writeRecord(next)
  const link = (await readDrafts()).find((d) => d.path === abs && d.thingsId)
  return { record: next, ...(published && link?.thingsId && !link.ticked ? { thingsId: link.thingsId } : {}) }
}

// ---------- Reviews ----------

/** Asks Claude (only Claude: no Gemma for a review) for a job's answer; null when Claude can't */
type Ask = (job: 'writingReview' | 'writingRecheck' | 'writingTalk', prompt: string, system: string) => Promise<string | null>
const realAsk: Ask = async (job, prompt, system) => {
  const { jobRoute, completeFor } = await import('./ai')
  if ((await jobRoute(job)).who !== 'claude') return null
  return completeFor(job, prompt, system, { noFallback: true, timeoutMs: job === 'writingReview' ? 6 * 60_000 : 2 * 60_000 }).catch(() => null)
}
let ask: Ask = realAsk
/** For tests: Claude's answers */
export const setAsker = (fn: Ask | null) => (ask = fn ?? realAsk)

export interface ReviewResult {
  record: PieceRecord
  /** Claude reviewed it too, or only the local checker did (and why) */
  by: 'claude' | 'tide'
}

/**
 * Reviews a piece as it is now (the text the editor has, saved or not): the local checker, then
 * Claude when it can. Open comments from the last review give way to the new ones.
 */
export async function reviewPiece(path: string, text: string, o: { full?: boolean } = {}): Promise<ReviewResult> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const kind = rec.kind ?? detectKind(text, abs).kind
  const at = Date.now()
  const light = kind === 'journal' && !o.full
  const local = checkMechanics(text, { light, at })
  const prev = rec.runs.length
    ? {
        overall: rec.overall,
        resolved: rec.comments.filter((c) => c.status === 'resolved').slice(-12).map((c) => c.what),
        open: rec.comments.filter((c) => c.status === 'open').slice(0, 12).map((c) => c.what)
      }
    : undefined
  const reply = await ask('writingReview', reviewPrompt({ text, kind, title: pieceTitle(text, abs), found: local, ...(prev ? { previous: prev } : {}), light }), REVIEW_SYSTEM)
  const claude = reply ? parseReview(reply, text, at) : null
  const next = combineReview(rec, { text, words: wordCount(text), kind, local, claude, at })
  await writeRecord(next)
  void updateHabits().catch(() => {})
  return { record: next, by: claude ? 'claude' : 'tide' }
}

/**
 * "I've fixed it": the checker's own comments are checked again in code; Claude's by Claude, on
 * the paragraph around it. Fixed comments are resolved (and disappear); otherwise the reply says
 * what's still wrong. Without Claude, a reviewer's comment is taken at the learner's word.
 */
export async function recheck(path: string, text: string, id: string): Promise<{ record: PieceRecord; fixed: boolean; note: string }> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const { comments } = reanchor(text, rec.comments)
  const c = comments.find((x) => x.id === id)
  if (!c) throw new Error('That comment is gone.')
  let fixed: boolean
  let note: string
  if (c.by === 'tide') {
    const left = recheckLocal(text, c)
    fixed = !left.length
    note = fixed ? 'Fixed.' : `Not yet: ${left.length} place${left.length === 1 ? '' : 's'} still ${left.length === 1 ? 'has' : 'have'} it.`
    if (!fixed) Object.assign(c, { anchor: left[0], more: left.slice(1) })
  } else {
    const p = passageAround(text, c.anchor.start, c.anchor.end)
    const reply = await ask('writingRecheck', recheckPrompt(c, p.text), RECHECK_SYSTEM)
    const r = reply ? parseRecheck(reply) : null
    fixed = r ? r.fixed : true
    note = r ? r.note || (r.fixed ? 'Fixed.' : 'Not yet.') : 'Marked fixed on your word: Claude couldn’t check it just now.'
  }
  const next: PieceRecord = { ...rec, comments: comments.map((x) => (x.id !== id ? x : fixed ? { ...c, status: 'resolved' as const, resolvedAt: Date.now(), reply: note } : { ...c, reply: note })) }
  await writeRecord(next)
  return { record: next, fixed, note }
}

/** The Socratic conversation beside the piece: one reply, kept in the record */
export async function challenge(path: string, text: string, said: string): Promise<{ record: PieceRecord; reply: string | null }> {
  const { abs } = resolvePiece(path)
  const rec = await readRecord(abs)
  const kind = rec.kind ?? detectKind(text, abs).kind
  const turns = [...(rec.talk ?? []), ...(said.trim() ? [{ role: 'learner' as const, text: said.trim().slice(0, 4000) }] : [])]
  const reply = await ask('writingTalk', challengePrompt(text, turns), challengeSystem(kind))
  const next: PieceRecord = { ...rec, talk: [...turns, ...(reply ? [{ role: 'tutor' as const, text: reply.trim() }] : [])].slice(-40) }
  await writeRecord(next)
  return { record: next, reply }
}

// ---------- Habits ----------

export async function habitsNow(): Promise<Habit[]> {
  return habits(await allRecords())
}

/** The top recurring habits into the learner profile (its "Writing habits:" line under Misconceptions) */
export async function updateHabits(): Promise<string> {
  const line = habitsLine(await habitsNow())
  const { noteWritingHabits } = await import('./learnerProfile')
  await noteWritingHabits(line)
  return line
}

// ---------- Topics ----------

interface TopicsCache {
  at: number
  things: Topic[]
}

export interface TopicsView {
  topics: Topic[]
  /** When the Things list was last read */
  thingsAt?: number
  /** Things couldn't be read just now (shown in one quiet line), or is off */
  thingsNote?: string
  thingsOn: boolean
}

interface DraftLink {
  title: string
  path: string
  thingsId?: string
  at: number
  ticked?: number
}

async function readDrafts(): Promise<DraftLink[]> {
  try {
    return JSON.parse(await readText(DRAFTS))
  } catch {
    return []
  }
}

async function noteTopics(): Promise<Topic[]> {
  const md = await readText(TOPICS_NOTE).catch(() => '')
  return parseTopics(md).flatMap((g) => g.items.map((i) => ({ title: i.text, group: g.heading, from: 'note' as const, done: i.done })))
}

/** Topics to write about: Things' open to-dos (read now, or the last ones read) and the topics note's */
export async function topics(o: { refresh?: boolean } = {}): Promise<TopicsView> {
  const w = getSettings().writing ?? {}
  const on = w.things !== false
  const project = w.thingsProject?.trim() || 'Writing'
  let cache: TopicsCache | null = null
  try {
    cache = JSON.parse(await readText(TOPICS_CACHE))
  } catch {
    cache = null
  }
  let note: string | undefined
  if (on && (o.refresh || !cache || Date.now() - cache.at > 5 * 60_000)) {
    try {
      const { listNamed } = await import('./things')
      const items = await listNamed(project)
      cache = { at: Date.now(), things: topicsFromThings(items, project) }
      await writeText(TOPICS_CACHE, JSON.stringify(cache))
    } catch (e) {
      note = e instanceof Error ? e.message : 'Things 4 couldn’t be reached.'
    }
  }
  const drafts = await readDrafts()
  const started = (t: Topic) => drafts.some((d) => (t.thingsId && d.thingsId === t.thingsId) || d.title === t.title)
  const things = on ? (cache?.things ?? []) : []
  const merged = mergeTopics(things, await noteTopics()).map((t) => (started(t) ? { ...t, done: true } : t))
  return { topics: merged, ...(on && cache ? { thingsAt: cache.at } : {}), ...(note ? { thingsNote: note } : {}), thingsOn: on }
}

/** The folder in a root where drafts live: where most of its drafts already are */
async function draftFolder(r: WritingRoot): Promise<string> {
  if (r.vault) return join(r.root, VAULT_WRITING)
  const files = await walk(r.root)
  const count = new Map<string, number>()
  for (const f of files) {
    const md = await fs.readFile(f, 'utf8').catch(() => '')
    if (frontMatter(md).keys.length) count.set(dirname(f), (count.get(dirname(f)) ?? 0) + (isDraft(md) ? 2 : 1))
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.root
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A new draft for a topic in one of the writing roots: a new file named after it (a number added
 * if that name is taken; nothing is ever overwritten), with front matter shaped like its
 * neighbours'. The topics note's item is ticked; the draft is linked to the Things to-do.
 */
export async function startDraft(topic: Topic, rootPath: string): Promise<string> {
  const r = roots().find((x) => x.root === resolve(rootPath))
  if (!r) throw new Error('That isn’t one of your writing folders.')
  const folder = await draftFolder(r)
  const samples: FrontMatter[] = []
  for (const f of (await fs.readdir(folder).catch(() => [] as string[])).filter((n) => /\.md$/i.test(n)).slice(0, 12)) {
    const fm = frontMatter(await fs.readFile(join(folder, f), 'utf8').catch(() => ''))
    if (fm.keys.length) samples.push(fm)
  }
  const name = draftFileName(topic.title)
  let abs = join(folder, name)
  for (let n = 2; existsSync(abs) && n < 100; n++) abs = join(folder, name.replace(/\.md$/, ` ${n}.md`))
  if (existsSync(abs)) throw new Error('A file with that name is already there.')
  await fs.mkdir(folder, { recursive: true })
  // wx: fails rather than overwrite, even if the file appeared a moment ago
  await fs.writeFile(abs, `${draftFrontMatter(samples, topic.title, today())}\n`, { encoding: 'utf8', flag: 'wx' })
  if (topic.from === 'note') {
    const md = await readText(TOPICS_NOTE).catch(() => '')
    const ticked = tickTopic(md, topic.title)
    if (ticked !== md) await writeText(TOPICS_NOTE, ticked)
  }
  const drafts = await readDrafts()
  await writeText(DRAFTS, JSON.stringify([...drafts, { title: topic.title, path: abs, ...(topic.thingsId ? { thingsId: topic.thingsId } : {}), at: Date.now() }].slice(-300)))
  return abs
}

/** "Tick it off in Things 4", after a piece is published: the only time Writing changes Things */
export async function tickInThings(path: string): Promise<void> {
  const { abs } = resolvePiece(path)
  const drafts = await readDrafts()
  const link = drafts.find((d) => d.path === abs && d.thingsId)
  if (!link?.thingsId) throw new Error('This piece didn’t start from a Things 4 to-do.')
  const { setTaskDone } = await import('./things')
  await setTaskDone(link.thingsId, true)
  await writeText(DRAFTS, JSON.stringify(drafts.map((d) => (d === link ? { ...d, ticked: Date.now() } : d))))
}

/** The writing roots, for the window: where a draft can go */
export const rootList = () => roots().map((r) => ({ root: r.root, label: r.label, vault: r.vault }))

// ---------- Pictures, tags and the learner's sections ----------

const filesCache = new Map<string, { at: number; files: string[] }>()

/** Every file under a writing root (relative paths), hidden folders left out; kept a few seconds */
async function rootFiles(root: string): Promise<string[]> {
  const hit = filesCache.get(root)
  if (hit && Date.now() - hit.at < 10_000) return hit.files
  const out: string[] = []
  const go = async (dir: string, depth: number) => {
    if (depth > 8 || out.length > 20_000) return
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await go(p, depth + 1)
      else out.push(relative(root, p).split(sep).join('/'))
    }
  }
  await go(root, 0)
  filesCache.set(root, { at: Date.now(), files: out })
  return out
}

/** Where new pictures for a piece go (relative to its root): Obsidian's setting, else Tide's "attachments" beside the note */
async function attachFolder(root: WritingRoot, noteRel: string): Promise<string> {
  const setting = attachmentSetting(await fs.readFile(join(root.root, '.obsidian', 'app.json'), 'utf8').catch(() => null))
  return attachmentDir(setting, noteRel, root.vault ? 'attachments' : 'root')
}

/**
 * The file a piece's embed shows (vault://writing/image?piece=…&t=…): only a picture inside that
 * piece's writing folder. A HEIC is turned into a JPEG once, kept in .tide/cache/heic of the
 * notes folder (never beside the photo). Null when there's no such picture.
 */
export async function writingImage(piece: string, target: string): Promise<string | null> {
  let found: { abs: string; root: WritingRoot }
  try {
    found = resolvePiece(piece)
  } catch {
    return null
  }
  const { abs, root } = found
  const noteRel = relative(root.root, abs).split(sep).join('/')
  const files = (await rootFiles(root.root)).filter((f) => IMAGE_FILE.test(f))
  const rel = resolveEmbed(target, noteRel, await attachFolder(root, noteRel), files)
  if (!rel) return null
  const file = resolve(root.root, rel)
  if (!inside(root.root, file) || !IMAGE_FILE.test(file) || !existsSync(file)) return null
  if (!HEIC_FILE.test(file)) return file
  const st = await fs.stat(file)
  const out = absPath(`.tide/cache/heic/${createHash('sha1').update(`${file}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 20)}.jpg`)
  if (existsSync(out)) return out
  await fs.mkdir(dirname(out), { recursive: true })
  const { execFile } = await import('child_process')
  await new Promise<void>((res, rej) => execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '2400', file, '--out', out], { timeout: 30_000 }, (e) => (e ? rej(e) : res())))
  return existsSync(out) ? out : null
}

/**
 * A picture pasted or dropped into a piece, saved in its folder's attachment folder under an
 * Obsidian-style name (never over a file). Returns the embed to put in and where it went.
 */
export async function attachImage(piece: string, original: string, dataUrl: string): Promise<{ embed: string; folder: string }> {
  const { abs, root } = resolvePiece(piece)
  const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(dataUrl)
  if (!m) throw new Error('That isn’t a picture Tide can save.')
  const noteRel = relative(root.root, abs).split(sep).join('/')
  const folderRel = await attachFolder(root, noteRel)
  const dir = resolve(root.root, folderRel)
  if (!inside(root.root, dir)) throw new Error('The attachment folder is outside this writing folder.')
  await fs.mkdir(dir, { recursive: true })
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const name = attachmentName(original, ext, new Date(), (n) => existsSync(join(dir, n)))
  await fs.writeFile(join(dir, name), Buffer.from(m[2], 'base64'), { flag: 'wx' })
  filesCache.delete(root.root)
  return { embed: `![[${name}]]`, folder: folderRel ? `${folderRel}/` : 'the top of the folder' }
}

/** Sets a piece's tags: only the front matter's tags entry changes. Returns the new text */
export async function setTags(path: string, tags: string[]): Promise<string> {
  const { abs } = resolvePiece(path)
  const text = await fs.readFile(abs, 'utf8')
  const next = setFrontTags(text, tags.map(String))
  if (next !== text) await savePiece(abs, next)
  return next
}

const SECTIONS = `${DIR}/sections.json`

/** The learner's own sections for the Writing list (Tide's records, never the notes) */
export async function getSections(): Promise<MySections> {
  try {
    const s = JSON.parse(await readText(SECTIONS)) as MySections
    return { names: Array.isArray(s.names) ? s.names.map(String) : [], assign: s.assign && typeof s.assign === 'object' ? s.assign : {} }
  } catch {
    return { names: [], assign: {} }
  }
}

export async function saveSections(s: MySections): Promise<MySections> {
  const clean: MySections = { names: [...new Set((s.names ?? []).map((n) => String(n).trim()).filter(Boolean))].slice(0, 50), assign: {} }
  for (const [k, v] of Object.entries(s.assign ?? {})) if (clean.names.includes(String(v))) clean.assign[k] = String(v)
  await writeText(SECTIONS, JSON.stringify(clean))
  return clean
}
