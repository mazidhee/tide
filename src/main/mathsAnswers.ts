/**
 * The maths answer box's model work (shared/mathsAnswer has the prompts and parsing):
 * - readBack: Claude's quick model (Haiku) writes what you said as maths, for you to confirm.
 *   Gemma does it only when Claude can't and Gemma is already loaded: a read-back is never worth
 *   loading a 10 GB model for, so without either the answer goes as typed.
 * - readPaper: Opus transcribes photos of your working, each line as LaTeX with its box on the
 *   page. Claude only: without it the box says so.
 * - markWorking: SymPy checks each step against the last (main/calculator), then Opus marks each
 *   line and the whole, with SymPy's findings as facts. Without Claude, SymPy's marks stand and
 *   the tutor gives the verdict.
 * A private lesson (main/projects privatePath) keeps all of it on the Mac.
 */
import { promises as fs } from 'fs'
import type { Angle } from '@shared/calc'
import {
  MARK_LINES_SYSTEM,
  READBACK_SYSTEM,
  TRANSCRIBE_SYSTEM,
  markLinesPrompt,
  marksFromSympy,
  parseLineMarks,
  parseReadBack,
  parseTranscription,
  readBackPrompt,
  transcribePrompt,
  type Marked,
  type PaperLine,
  type StepCheck
} from '@shared/mathsAnswer'

export interface ReadBack {
  latex: string
  unclear: string
  by: 'claude' | 'gemma'
}

/** Whether Claude would take this lesson's maths jobs now, and why not */
export async function mathsClaude(path?: string): Promise<{ claude: boolean; why?: string }> {
  const { jobRoute } = await import('./ai')
  const r = await jobRoute('paperRead')
  if (r.who === 'claude') return { claude: true }
  const { reasonText } = await import('@shared/gemmaPolicy')
  return { claude: false, why: reasonText(r.reason) }
}

export async function readBack(words: string, question?: string, path?: string): Promise<ReadBack | null> {
  const text = words.trim()
  if (!text) return null
  const prompt = readBackPrompt(text, question)
  const [{ jobRoute }, { withUsage }] = await Promise.all([import('./ai'), import('./usageLog')])
  const route = await jobRoute('mathsReadBack')
  if (route.who === 'claude') {
    const { claudeOnce } = await import('./claudeEngine')
    const r = await withUsage({ job: 'mathsReadBack' }, () => claudeOnce(prompt, READBACK_SYSTEM, 'background', AbortSignal.timeout(25_000))).catch(() => null)
    const parsed = r ? parseReadBack(r.text) : null
    if (parsed) return { ...parsed, by: 'claude' }
  }
  // Gemma, only if it's already loaded
  const { loaded } = await import('./modelIdle')
  if (!(await loaded().catch(() => false))) return null
  const { complete } = await import('./ai')
  const out = await complete(prompt, READBACK_SYSTEM, AbortSignal.timeout(30_000), 'interactive').catch(() => '')
  const parsed = out ? parseReadBack(out) : null
  return parsed ? { ...parsed, by: 'gemma' } : null
}

/** The photos as Claude will see them */
async function pictures(paths: string[]) {
  const [{ absPath }, { prepareImage }] = await Promise.all([import('./vault'), import('./imagePrep')])
  const out = []
  for (const p of paths.slice(0, 6)) {
    const buf = await fs.readFile(absPath(p)).catch(() => null)
    const img = buf ? await prepareImage(buf).catch(() => null) : null
    if (img) out.push(img)
  }
  return out
}

export type PaperReading = { ok: true; lines: PaperLine[]; ms: number } | { ok: false; needsClaude?: boolean; error: string }

export async function readPaper(paths: string[], question?: string, path?: string): Promise<PaperReading> {
  if (!paths.length) return { ok: false, error: 'Add a photo of your working first.' }
  const status = await mathsClaude(path)
  if (!status.claude) return { ok: false, needsClaude: true, error: `Reading paper needs Claude${status.why ? ` (${status.why})` : ''}.` }
  const images = await pictures(paths)
  if (!images.length) return { ok: false, error: 'Those photos couldn’t be read. Try a JPEG or PNG.' }
  const [{ claudeOnce, ClaudeUnavailable }, { withUsage }] = await Promise.all([import('./claudeEngine'), import('./usageLog')])
  const t0 = Date.now()
  try {
    const r = await withUsage({ job: 'paperRead' }, () => claudeOnce(transcribePrompt(images.length, question), TRANSCRIBE_SYSTEM, 'mark', AbortSignal.timeout(180_000), undefined, images))
    const lines = parseTranscription(r.text, images.length)
    console.log(`[maths answers] read ${images.length} page(s): ${lines?.length ?? 0} lines in ${Date.now() - t0} ms`)
    if (!lines) return { ok: false, error: 'Claude couldn’t make out lines of working on that page. Try a sharper, closer photo.' }
    return { ok: true, lines, ms: Date.now() - t0 }
  } catch (e) {
    if (e instanceof ClaudeUnavailable) return { ok: false, needsClaude: true, error: `Reading paper needs Claude: ${e.message}` }
    return { ok: false, error: `Claude couldn’t read the page: ${(e as Error).message.slice(0, 160)}` }
  }
}

export interface WorkingMarking {
  marks: Marked
  checks: StepCheck[] | null
}

/** Each line marked: SymPy's exact checks first, then Opus with them as facts; SymPy's alone without Claude */
export async function markWorking(req: { question: string; lines: string[]; path?: string; angle?: Angle; /** The lesson's topic, for the learning event log */ topic?: string }): Promise<WorkingMarking> {
  const lines = req.lines.map((l) => l.trim()).filter(Boolean)
  const { checkSteps } = await import('./calculator')
  const checks = await checkSteps(lines, req.angle).catch(() => null)
  const status = await mathsClaude(req.path)
  if (status.claude) {
    const [{ claudeOnce }, { withUsage }] = await Promise.all([import('./claudeEngine'), import('./usageLog')])
    const r = await withUsage({ job: 'workingMark' }, () => claudeOnce(markLinesPrompt(req.question, lines, checks ?? undefined), MARK_LINES_SYSTEM, 'mark', AbortSignal.timeout(150_000))).catch((e) => {
      console.log(`[maths answers] marking failed: ${(e as Error).message.slice(0, 160)}`)
      return null
    })
    const marks = r ? parseLineMarks(r.text, lines.length) : null
    if (marks) {
      logWorking(req, marks)
      return { marks, checks }
    }
  }
  const marks = marksFromSympy(checks ?? [], lines.length)
  logWorking(req, marks)
  return { marks, checks }
}

/** Maths working marked, in the learning event log: the answer, and a misconception the marker named */
function logWorking(req: { question: string; lines: string[]; path?: string; topic?: string }, marks: Marked): void {
  const at = Date.now()
  const about = { ...(req.topic ? { topic: req.topic } : {}), ...(req.path ? { path: req.path } : {}) }
  void Promise.all([import('@shared/learningEvents'), import('./learningLog')])
    .then(([, { learningEvent }]) =>
      learningEvent([
        ...(marks.verdict ? [{ key: `maths:${at}`, at, kind: 'answered' as const, source: 'maths', ...about, outcome: marks.verdict, level: 3 as const, note: req.question.slice(0, 200), data: { lines: req.lines.length, by: marks.by } }] : []),
        ...(marks.misconception ? [{ key: `maths:${at}:mis`, at, kind: 'misconception_seen' as const, source: 'maths', ...about, note: `${marks.misconception.name}: ${marks.misconception.text}`, data: { name: marks.misconception.name } }] : [])
      ])
    )
    .catch(() => {})
}
