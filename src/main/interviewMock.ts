/**
 * Live mock rounds (shared/interviewMock): reads a target's round from the vault, streams the
 * interviewer's lines (Claude on the turn model, else the scripted interviewer), marks the round
 * (Claude on the marking model, else in code) and saves the attempt under `mocks[]` in
 * `.tide/interview/<slug>.json`, leaving every other key in that file as it was.
 *
 * TEMPORARY: `readTarget` below reads `Interview prep/<name>/` loosely by its headings, so the
 * mock can run before the interview-target parser (shared/interviewTarget) lands. At merge it is
 * replaced by that parser; only `loadInput` and `listTargets` call it.
 */
import { ipcMain, type WebContents } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import matter from 'gray-matter'
import { characterById } from '@shared/characters'
import {
  attemptOf,
  deltas,
  interviewerSystem,
  makePersona,
  markInCode,
  markPrompt,
  markSystem,
  planRound,
  readMarks,
  readTurn,
  scriptedTurn,
  slugOf,
  turnPrompt,
  type MockAttempt,
  type MockDelta,
  type MockLoaded,
  type MockMarkRequest,
  type MockQuestion,
  type MockRound,
  type MockScenario,
  type MockStory,
  type MockTargetInput,
  type MockTargetSummary,
  type MockTurnRequest,
  type Persona,
  type RoundKind,
  type TurnMark
} from '@shared/interviewMock'
import { absPath } from './vault'
import { getSettings } from './settings'

const PREP = 'Interview prep'
const progressFile = (slug: string) => `.tide/interview/${slug.replace(/[^a-z0-9-]/gi, '')}.json`

// ---------- Reading the vault (temporary, loose) ----------

interface Section {
  level: number
  title: string
  body: string
}

/** A Markdown file as its headed sections (text before the first heading is level 0) */
export function sections(md: string): Section[] {
  const out: Section[] = [{ level: 0, title: '', body: '' }]
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) out.push({ level: h[1].length, title: h[2].trim(), body: '' })
    else out[out.length - 1].body += line + '\n'
  }
  return out
}

const bullets = (body: string) =>
  body
    .split('\n')
    .map((l) => l.match(/^\s*[-*+]\s+(.*)$/)?.[1]?.trim())
    .filter((x): x is string => !!x)

/** `- Field: value` lines of a section */
function fields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let last = ''
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*[-*]\s+([A-Za-z][A-Za-z -]{1,20}):\s*(.*)$/)
    if (m) out[(last = m[1].trim().toLowerCase())] = m[2].trim()
    else if (last && /^\s{2,}\S/.test(line)) out[last] += '\n' + line.trim()
  }
  return out
}

/** "## 3. Title" → { id: '3', title: 'Title' } */
const idTitle = (t: string) => {
  const m = t.match(/^([A-Za-z0-9_-]{1,12})[.)]\s+(.*)$/)
  return m ? { id: m[1], title: m[2].trim() } : { id: slugOf(t).slice(0, 24), title: t }
}

const read = async (path: string) => (existsSync(path) ? fs.readFile(path, 'utf8') : '')

/** Questions the target's notes list as bullets under a line or heading that mentions questions */
export function questionsFromNotes(body: string): MockQuestion[] {
  const out: MockQuestion[] = []
  let on = false
  for (const line of body.split('\n')) {
    if (/^#{1,6}\s|^\S.*:\s*$/.test(line)) on = /question/i.test(line) && !/to ask|ask them|for them|your questions/i.test(line)
    else if (!line.trim()) continue
    const b = line.match(/^\s*[-*]\s+(.*)$/)?.[1]
    if (on && b && /\?|^(tell|describe|give|walk|talk|explain|what|why|how)\b/i.test(b) && !/^make it clear/i.test(b)) {
      const text = b.replace(/\s*\((situation|e\.g\.|for them)[^)]*\)/gi, '').trim()
      out.push({
        id: `n${out.length + 1}`,
        text,
        kind: /\bcv\b|your experience/i.test(text) ? 'cv' : 'behavioural'
      })
    }
  }
  return out
}

async function cvText(sources: string[]): Promise<string | undefined> {
  for (const src of sources) {
    if (!existsSync(src)) continue
    const st = await fs.stat(src).catch(() => null)
    const files = st?.isDirectory() ? (await fs.readdir(src).catch(() => [])).map((n) => join(src, n)) : [src]
    const cv = files.find((f) => /(^|[^a-z])(cv|resume|résumé)([^a-z]|$)/i.test(basename(f)) && /\.(md|txt|pdf)$/i.test(f))
    if (!cv) continue
    if (/\.pdf$/i.test(cv)) {
      const { pdfiumText } = await import('./pdftext')
      const p = await pdfiumText(cv, 4).catch(() => null)
      if (p?.pages.length) return p.pages.join('\n').slice(0, 8000)
    } else return (await fs.readFile(cv, 'utf8')).slice(0, 8000)
  }
  return undefined
}

interface RawTarget {
  slug: string
  dir: string
  name: string
  company: string
  role: string
  rounds: MockRound[]
  notes: string
  sources: string[]
}

async function targetDirs(): Promise<RawTarget[]> {
  const root = absPath(PREP)
  if (!existsSync(root)) return []
  const out: RawTarget[] = []
  for (const name of await fs.readdir(root)) {
    const dir = join(root, name)
    const file = join(dir, 'target.md')
    if (!existsSync(file)) continue
    const fm = matter(await fs.readFile(file, 'utf8'))
    const d = fm.data as Record<string, unknown>
    const rounds = (Array.isArray(d.rounds) ? d.rounds : []).map((r: Record<string, unknown>, i: number) => ({
      id: String(r.id ?? `round-${i + 1}`),
      name: String(r.name ?? r.id ?? `Round ${i + 1}`),
      kind: (['behavioural', 'technical', 'presentation', 'hirevue', 'general'].includes(String(r.kind)) ? r.kind : 'general') as RoundKind,
      minutes: Number(r.minutes) || 30,
      notes: r.notes ? String(r.notes) : undefined
    }))
    out.push({
      slug: slugOf(name),
      dir,
      name,
      company: String(d.company ?? ''),
      role: String(d.role ?? ''),
      rounds,
      notes: fm.content.trim(),
      sources: (Array.isArray(d.sources) ? d.sources : []).map(String)
    })
  }
  return out
}

export async function listTargets(): Promise<MockTargetSummary[]> {
  return (await targetDirs()).map(({ slug, name, company, role, rounds }) => ({
    slug,
    name,
    company,
    role,
    rounds
  }))
}

/** One round of a target as the mock's input. TEMPORARY: swapped for the core parser at merge */
export async function loadInput(slug: string, roundId: string): Promise<MockTargetInput> {
  const t = (await targetDirs()).find((x) => x.slug === slug)
  if (!t) throw new Error('That interview target isn’t in your notes any more.')
  const round = t.rounds.find((r) => r.id === roundId) ??
    t.rounds[0] ?? {
      id: 'general',
      name: 'Interview',
      kind: 'general' as const,
      minutes: 30
    }
  const f = (n: string) => read(join(t.dir, n))
  const [qMd, sMd, scMd, pMd, firmMd, askMd] = await Promise.all(['questions.md', 'stories.md', 'scenarios.md', 'presentation.md', 'firm.md', 'ask-them.md'].map(f))

  const questions: MockQuestion[] = []
  for (const s of sections(qMd).filter((s) => s.level === 2)) {
    const { id, title } = idTitle(s.title)
    const fl = fields(s.body.split(/^###\s/m)[0])
    questions.push({
      id,
      text: title,
      kind: (fl.kind ?? 'behavioural').toLowerCase(),
      round: fl.round,
      route: fl.route,
      outline: fl.outline
    })
  }
  if (!questions.length) questions.push(...questionsFromNotes(t.notes))

  const stories: MockStory[] = sections(sMd)
    .filter((s) => s.level === 2)
    .map((s) => ({
      ...idTitle(s.title),
      evidence: fields(s.body).evidence ?? ''
    }))

  const scenarios: MockScenario[] = []
  const sc = sections(scMd)
  for (let i = 0; i < sc.length; i++) {
    if (sc[i].level !== 2) continue
    const { id, title } = idTitle(sc[i].title)
    const parts: string[] = []
    let rubric: string[] = []
    for (let j = i + 1; j < sc.length && sc[j].level > 2; j++) {
      if (/^part\b/i.test(sc[j].title)) parts.push(sc[j].body.trim())
      else if (/rubric/i.test(sc[j].title)) rubric = bullets(sc[j].body)
    }
    if (!parts.length && sc[i].body.trim()) parts.push(sc[i].body.trim())
    if (parts.length) scenarios.push({ id, title, parts, rubric })
  }

  let presentation: MockTargetInput['presentation']
  if (pMd || round.kind === 'presentation') {
    const ps = sections(pMd)
    const topic =
      (matter(pMd).data as { topic?: string }).topic ??
      ps
        .find((s) => /topic/i.test(s.title))
        ?.body.trim()
        .split('\n')[0] ??
      round.notes?.split('.')[0] ??
      ''
    const checklist = ps.filter((s) => /checklist|requirement|brief/i.test(s.title)).flatMap((s) => bullets(s.body).map((b) => b.replace(/^\[[ x]\]\s*/i, '')))
    const assessorQuestions: { q: string; point: string }[] = []
    const aq = ps.findIndex((s) => /assessor/i.test(s.title))
    if (aq >= 0) {
      for (const b of bullets(ps[aq].body)) {
        const [q, point] = b.split(/\s+[—–-]\s+|\s*→\s*/)
        assessorQuestions.push({ q: q.trim(), point: (point ?? '').trim() })
      }
      for (let j = aq + 1; j < ps.length && ps[j].level > ps[aq].level; j++)
        assessorQuestions.push({
          q: idTitle(ps[j].title).title,
          point: ps[j].body.trim().slice(0, 400)
        })
    }
    presentation = { topic, checklist, assessorQuestions }
  }

  const firmFacts = bullets(firmMd)
  const askThem = bullets(askMd).filter((b) => b.includes('?'))
  return {
    slug,
    company: t.company,
    role: t.role,
    round,
    notes: t.notes,
    questions,
    scenarios,
    presentation,
    stories,
    askThem,
    firmFacts,
    cv: await cvText(t.sources)
  }
}

// ---------- Progress file ----------

async function readProgress(slug: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(absPath(progressFile(slug)), 'utf8'))
  } catch {
    return {}
  }
}

export async function history(slug: string): Promise<MockAttempt[]> {
  const p = await readProgress(slug)
  return Array.isArray(p.mocks) ? (p.mocks as MockAttempt[]) : []
}

/** Adds an attempt under `mocks[]`, keeping the rest of the file (the target core's attempts) */
async function saveAttempt(slug: string, a: MockAttempt): Promise<void> {
  const p = await readProgress(slug)
  const mocks = Array.isArray(p.mocks) ? (p.mocks as MockAttempt[]) : []
  p.mocks = [...mocks.filter((m) => m.id !== a.id), a]
  const file = absPath(progressFile(slug))
  await fs.mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(p, null, 2))
  await fs.rename(tmp, file)
}

// ---------- Claude ----------

async function claudeOk(): Promise<boolean> {
  try {
    const { claudeReady } = await import('./claudeEngine')
    return (await claudeReady()).ready
  } catch {
    return false
  }
}

const tutorVoice = () => {
  const s = getSettings()
  return s.voice?.custom || characterById(s.character).voice
}

export async function load(slug: string, round: string): Promise<MockLoaded> {
  const [input, hist, claude, voice] = await Promise.all([loadInput(slug, round), history(slug), claudeOk(), import('./voice').then((v) => v.voiceStatus().then((s) => s.ready)).catch(() => false)])
  return { input, history: hist, claude, voice, tutorVoice: tutorVoice() }
}

const running = new Map<string, AbortController>()

/** Inputs are cached per slug and round for the length of a call: each turn needs them */
const inputs = new Map<string, { at: number; input: Promise<MockTargetInput> }>()
function cachedInput(slug: string, round: string): Promise<MockTargetInput> {
  const k = `${slug}:${round}`
  const hit = inputs.get(k)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.input
  const input = loadInput(slug, round)
  inputs.set(k, { at: Date.now(), input })
  input.catch(() => inputs.delete(k))
  return input
}

/**
 * Streams one interviewer line to the window: text deltas as Claude writes (the marker held back
 * until it's whole), then a done event with the marker. Claude failing before any text hands the
 * line to the scripted interviewer.
 */
export async function turn(req: MockTurnRequest, send: (d: MockDelta) => void): Promise<void> {
  const input = await cachedInput(req.slug, req.round)
  const plan = planRound(input, req.seed)
  const scripted = () => {
    const s = scriptedTurn(req.next, req.lines, {
      persona: req.persona,
      input,
      seed: req.seed,
      totalMs: plan.totalMs
    })
    send({ id: req.id, text: s.text })
    send({
      id: req.id,
      done: true,
      mark: s.mark,
      text: s.text,
      by: 'script',
      firstMs: 0
    })
  }
  if (req.scripted || !(await claudeOk())) return scripted()
  const ctrl = new AbortController()
  running.set(req.id, ctrl)
  const t0 = Date.now()
  let first = 0
  let raw = ''
  let shown = 0
  try {
    const { claudeStream } = await import('./claudeEngine')
    const scenario = plan.items.find((i) => i.type === 'scenario')
    const prompt = turnPrompt(req.next, req.lines, {
      persona: req.persona,
      elapsedMs: req.elapsedMs,
      totalMs: plan.totalMs,
      presentation: input.presentation,
      scenario: scenario?.type === 'scenario' && (req.next.move === 'part' || (req.next.move === 'ask' && req.next.item.type === 'scenario') || req.lines.some((l) => l.stage === 'scenario')) ? scenario.s : undefined
    })
    for await (const t of claudeStream(prompt, interviewerSystem(input, req.persona), 'teach', ctrl.signal, undefined, 'mockInterviewer')) {
      raw += t
      const r = readTurn(raw)
      if (r.pending) continue
      if (r.text.length > shown) {
        first ||= Date.now() - t0
        send({ id: req.id, text: r.text.slice(shown) })
        shown = r.text.length
      }
    }
    if (ctrl.signal.aborted) return
    const r = readTurn(raw)
    const mark: TurnMark = r.mark ?? (req.next.move === 'close' ? 'close' : 'next')
    if (!r.text.trim()) return scripted()
    send({
      id: req.id,
      done: true,
      mark,
      text: r.text.trim(),
      by: 'claude',
      firstMs: first
    })
  } catch (e) {
    if (ctrl.signal.aborted) return
    if (!raw) return scripted()
    send({
      id: req.id,
      done: true,
      mark: 'next',
      text: readTurn(raw).text.trim(),
      by: 'claude',
      firstMs: first,
      error: (e as Error).message
    })
  } finally {
    running.delete(req.id)
  }
}

/** Marks a finished round and saves it: Claude's marking model when it can, else in code */
export async function mark(req: MockMarkRequest): Promise<{ attempt: MockAttempt; delta: ReturnType<typeof deltas> }> {
  const input = await loadInput(req.slug, req.round)
  inputs.delete(`${req.slug}:${req.round}`)
  const plan = planRound(input, req.seed)
  let debrief = markInCode(input, plan, req.lines)
  if (!req.scripted && debrief.items.length && (await claudeOk())) {
    try {
      const { claudeOnce } = await import('./claudeEngine')
      const r = await claudeOnce(markPrompt(input, plan, req.lines), markSystem(), 'mark', AbortSignal.timeout(4 * 60_000), undefined, [], 'mockMark')
      debrief = readMarks(r.text, debrief) ?? debrief
    } catch {
      // the code's marks stand
    }
  }
  const attempt = attemptOf(input, req.persona, req.lines, debrief, req.totalMs)
  const before = await history(req.slug)
  await saveAttempt(req.slug, attempt)
  return { attempt, delta: deltas(before, attempt) }
}

// ---------- Slides (read-only) ----------

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** The learner's own slide file, as text per slide (or one image), to glance at while presenting */
export async function slides(path: string): Promise<{ name: string; pages: string[]; image?: string } | { error: string }> {
  const p = path
    .trim()
    .replace(/^file:\/\//, '')
    .replace(/^~(?=\/)/, process.env.HOME ?? '~')
  if (!existsSync(p)) return { error: 'There’s no file at that path.' }
  const ext = extname(p).toLowerCase()
  const name = basename(p)
  try {
    if (ext === '.pdf') {
      const { pdfiumText } = await import('./pdftext')
      const r = await pdfiumText(p, 40)
      return r ? { name, pages: r.pages.map((x) => x.trim()) } : { error: 'Tide couldn’t read that PDF.' }
    }
    if (ext === '.pptx' || ext === '.key') {
      if (ext === '.key') return { error: 'Export Keynote slides as PDF to show them here.' }
      const { openZip } = await import('./zip')
      const z = openZip(await fs.readFile(p))
      const slideNames = z
        .names()
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      const pages = slideNames.map((n) =>
        (z.text(n) ?? '')
          .split(/<\/a:p>/)
          .map((para) => [...para.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
          .filter(Boolean)
          .join('\n')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'")
      )
      return { name, pages }
    }
    if (IMAGE.has(ext)) {
      const b = await fs.readFile(p)
      if (b.length > 15 * 1024 * 1024) return { error: 'That image is too large to show.' }
      return {
        name,
        pages: [],
        image: `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${b.toString('base64')}`
      }
    }
    if (ext === '.md' || ext === '.txt')
      return {
        name,
        pages: (await fs.readFile(p, 'utf8'))
          .split(/\n-{3,}\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      }
    return {
      error: 'Tide can show PDF, PowerPoint, image, Markdown or text slides.'
    }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ---------- IPC ----------

export function registerInterviewMock(): void {
  ipcMain.handle('interviewMock:targets', () => listTargets())
  ipcMain.handle('interviewMock:load', (_e, slug: string, round: string) => load(String(slug), String(round ?? '')))
  ipcMain.handle('interviewMock:persona', async (_e, slug: string, round: string, seed: number, avoid?: string): Promise<Persona> => makePersona(await cachedInput(String(slug), String(round)), Number(seed) || Date.now(), avoid ?? tutorVoice()))
  ipcMain.handle('interviewMock:turn', (e, req: MockTurnRequest) => {
    const wc: WebContents = e.sender
    return turn(req, (d) => !wc.isDestroyed() && wc.send('interviewMock:delta', d))
  })
  ipcMain.handle('interviewMock:cancel', (_e, id: string) => running.get(String(id))?.abort())
  ipcMain.handle('interviewMock:mark', (_e, req: MockMarkRequest) => mark(req))
  ipcMain.handle('interviewMock:history', (_e, slug: string) => history(String(slug)))
  ipcMain.handle('interviewMock:slides', (_e, path: string) => slides(String(path ?? '')))
}
