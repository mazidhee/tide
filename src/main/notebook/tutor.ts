/**
 * The tutor in a notebook's margin. Claude (the learner's own Claude Code, as everywhere in Tide)
 * sees the notebook through Tide's MCP server, with the key "nb:<session>": its cells, outputs,
 * errors and which cells are stale (read_notebook), the kernel's variables, a scratch kernel of
 * its own to try code in (run_scratch, never the learner's kernel), proposals of a cell that the
 * learner keeps or drops (propose_cell), and checked exercises with hidden tests that Tide first
 * runs against Claude's own solution (set_exercise).
 *
 * The coding-lesson rule holds: the learner writes the code. A proposal is accepted from Claude
 * only when the learner asked for one (Suggest the next cell, "show me…"); otherwise Claude
 * explains and hints. Without Claude, Gemma answers from the notebook's text, with no tools.
 */
import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CellProposal, NbSnapshot, TutorAction, TutorEvent, TutorRequest } from '@shared/notebook/api'
import { asksToBeShown } from '@shared/ideaProject'
import { outputText, type Output } from '@shared/notebook/ipynb'
import type { ExerciseSpec } from '@shared/notebook/templates'
import type { McpTool } from '../tideMcp'
import { Kernel, type KernelEvent } from './kernel'

interface Session {
  id: string
  proc: import('../claudeEngine').ClaudeProcess | null
  busy: AbortController | null
  notes: string[]
  snapshot: NbSnapshot | null
  scratch: Kernel | null
  /** The notebook code the scratch kernel last replayed */
  replayed: string
  /** The learner asked for code this turn: propose_cell is allowed */
  mayPropose: boolean
  model: string
}

const sessions = new Map<string, Session>()
const proposals = new Map<string, CellProposal>()

function emit(e: TutorEvent) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('notebook:tutor', e)
}

function sessionFor(id: string): Session {
  let s = sessions.get(id)
  if (!s) {
    s = { id, proc: null, busy: null, notes: [], snapshot: null, scratch: null, replayed: '', mayPropose: false, model: '' }
    sessions.set(id, s)
  }
  return s
}

export function noteForTutor(session: string, note: string) {
  sessionFor(session).notes.push(note)
}

export function setSnapshot(session: string, snap: NbSnapshot) {
  sessionFor(session).snapshot = snap
}

/** Which actions count as asking for code */
export function mayPropose(action: TutorAction, text: string): boolean {
  return action === 'next' || asksToBeShown(text) || /\b(fix it|write (the|a) cell|suggest (a|the) (next )?cell)\b/i.test(text)
}

/** A new turn: whether the learner asked for code decides if propose_cell works in it */
export function beginTurn(session: string, action: TutorAction, text: string): boolean {
  const s = sessionFor(session)
  s.mayPropose = mayPropose(action, text)
  return s.mayPropose
}

export function actionText(req: Pick<TutorRequest, 'action' | 'text' | 'cellId'>, cellNumber: (id: string) => number): string {
  const at = req.cellId ? `cell ${cellNumber(req.cellId)} (id ${req.cellId})` : 'the notebook'
  switch (req.action) {
    case 'explain':
      return `Explain the output of ${at}: what it shows and why. ${req.text}`.trim()
    case 'debug':
      return `Help me debug the error in ${at}. Don't fix it for me: help me find it. ${req.text}`.trim()
    case 'next':
      return `Suggest the next cell for this notebook${req.cellId ? `, after ${at}` : ''}, as a proposal I can keep or drop. ${req.text}`.trim()
    case 'exercise':
      return `Set me a checked exercise on what this notebook is about${req.cellId ? `, after ${at}` : ''}. ${req.text}`.trim()
    case 'review':
      return `Review my notebook: what's right, what's wrong or stale, and what to try next. ${req.text}`.trim()
    default:
      return req.text
  }
}

const SYSTEM = `You are the learner's tutor in the margin of a Jupyter notebook in Tide, their study app, for maths, statistics, data science and quantitative finance.
The learner writes the code; you tutor. Read the notebook first with read_notebook (cells, outputs, errors, and which cells are stale: edited since they ran, or downstream of a change). Explain outputs from what they actually show. For an error, point to where it is and why with questions and hints, from vague to specific; don't hand over the fix unless they ask.
Try code in your own scratch kernel with run_scratch (never the learner's kernel; replay=true first runs the notebook's code there). Check a claim by running it rather than guessing.
propose_cell puts a cell in front of the learner as a proposal they keep or drop; it only works when the learner asked for code (Tide says when). Explain the proposal in a sentence; don't paste the code into your reply.
set_exercise sets a checked exercise in the notebook: a prompt, starter code, hidden tests (Python asserts with messages, run against the learner's variables) and your own solution, which Tide runs first: the tests must pass on it.
Write plainly and briefly, no analogies or jokes. Use Markdown, LaTeX in $…$, and code spans for names.`

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

function sessionOfCtx(ctx: { labId?: string }): Session {
  const key = ctx.labId?.replace(/^claude:/, '') ?? ''
  const s = key.startsWith('nb:') ? sessions.get(key.slice(3)) : undefined
  if (!s) throw new Error('No notebook is open for these tools.')
  return s
}

/** The scratch kernel, replaying the notebook's code first when asked and when it changed */
async function scratchKernel(s: Session, replay: boolean): Promise<{ kernel: Kernel; events: KernelEvent[]; replayNote: string }> {
  const events: KernelEvent[] = []
  if (!s.scratch || s.scratch.state === 'dead') {
    const { kernelEnv, notebookPython } = await import('./index')
    const dir = join(app.getPath('userData'), 'notebook', 'scratch', s.id.slice(0, 12))
    mkdirSync(dir, { recursive: true })
    s.scratch = new Kernel({ python: notebookPython(), cwd: dir, env: await kernelEnv(), writable: [], bootstrap: 'import tide_nb as _tide_nb', onEvent: (e) => listeners.get(s.id)?.(e) }, join(dir, 'k'))
    await s.scratch.start()
    s.replayed = ''
  }
  const code = s.snapshot?.code ?? []
  const all = code.map((c) => c.source).join('\n\n# ---\n\n')
  let replayNote = ''
  if (replay && all !== s.replayed) {
    if (s.replayed) await s.scratch.restart()
    let failed = 0
    for (const c of code) {
      if (!c.source.trim()) continue
      const r = s.scratch.execute(c.source, { silent: true })
      const done = await r.done.catch(() => ({ status: 'error' }))
      if (done.status !== 'ok') failed++
    }
    s.replayed = all
    replayNote = `(Replayed the notebook's ${code.length} code cells${failed ? `; ${failed} raised errors` : ''}.)\n`
  }
  listeners.set(s.id, (e) => events.push(e))
  return { kernel: s.scratch, events, replayNote }
}
const listeners = new Map<string, (e: KernelEvent) => void>()

async function runIn(s: Session, code: string, replay: boolean): Promise<string> {
  const { kernel, events, replayNote } = await scratchKernel(s, replay)
  const r = kernel.execute(code)
  const done = await Promise.race([r.done, new Promise<null>((res) => setTimeout(() => res(null), 60_000))])
  if (!done) {
    kernel.interrupt()
    return `${replayNote}Stopped after 60 s.`
  }
  await new Promise((res) => setTimeout(res, 30))
  const outs = events.filter((e) => e.type === 'output' && e.parent === r.id).map((e) => (e as Extract<KernelEvent, { type: 'output' }>).output as unknown as Output)
  const text = outs.map((o) => outputText(o, 4000)).join('\n')
  return `${replayNote}${text || '(no output)'}\n[${done.status}]`
}

export const NOTEBOOK_TOOLS: McpTool[] = [
  {
    name: 'read_notebook',
    description: "Read the learner's notebook: every cell with its id, type, source, execution count, outputs (text, errors with tracebacks, pictures noted), and which cells are stale.",
    inputSchema: obj({ cell_ids: { type: 'array', items: { type: 'string' }, description: 'Only these cells' } }),
    async run(args, ctx) {
      const s = sessionOfCtx(ctx)
      const snap = s.snapshot
      if (!snap) return 'The notebook has not been shared yet.'
      const ids = Array.isArray(args.cell_ids) ? (args.cell_ids as unknown[]).map(str) : null
      const text = ids ? snap.text.split(/\n(?=### Cell )/).filter((b) => ids.some((id) => b.includes(`id=${id}`))).join('\n') : snap.text
      return `Notebook "${snap.name}". Kernel: ${snap.kernel}.${snap.active ? ` The learner is in cell id ${snap.active}.` : ''}\n\n${text.slice(0, 60_000)}`
    }
  },
  {
    name: 'get_variables',
    description: "The variables in the learner's running kernel: name, type, shape and a short value.",
    inputSchema: obj({}),
    async run(_args, ctx) {
      const s = sessionOfCtx(ctx)
      const { liveKernel } = await import('./index')
      const k = s.snapshot ? liveKernel(s.snapshot.ref) : null
      if (!k || k.state === 'dead') return 'The kernel is not running.'
      const out = await k.evaluate('_tide_nb.variables()', 10_000).catch(() => '[]')
      const vars = JSON.parse(out.trim() || '[]') as { name: string; type: string; shape?: number[]; value?: string }[]
      return vars.length ? vars.map((v) => `${v.name}: ${v.type}${v.shape ? ` ${JSON.stringify(v.shape)}` : ''} = ${v.value ?? ''}`).join('\n') : 'No variables yet.'
    }
  },
  {
    name: 'run_scratch',
    description: "Run Python in your own scratch kernel (Tide's sandbox, the same libraries as the notebook, no network). replay=true first runs the notebook's code cells there, so the learner's variables exist. Returns printed output, results and errors.",
    inputSchema: obj({ code: { type: 'string' }, replay: { type: 'boolean' } }, ['code']),
    async run(args, ctx) {
      const s = sessionOfCtx(ctx)
      return runIn(s, str(args.code), args.replay === true)
    }
  },
  {
    name: 'propose_cell',
    description: 'Propose a cell: new source for an existing cell (replace_cell_id), or a new cell after a given one (after_cell_id; at the end if neither). The learner sees it as a diff and keeps or drops it. Only works when the learner asked for code.',
    inputSchema: obj({ source: { type: 'string' }, cell_type: { type: 'string', enum: ['code', 'markdown'] }, replace_cell_id: { type: 'string' }, after_cell_id: { type: 'string' }, explanation: { type: 'string' } }, ['source', 'explanation']),
    async run(args, ctx) {
      const s = sessionOfCtx(ctx)
      if (!s.mayPropose) return 'Not proposed: the learner writes the code here. Guide them with questions and hints; a proposal is allowed only when they ask for one (Suggest the next cell, or "show me").'
      const p: CellProposal = {
        id: randomUUID(),
        session: s.id,
        kind: args.replace_cell_id ? 'replace' : 'insert',
        ...(args.replace_cell_id ? { cellId: str(args.replace_cell_id) } : {}),
        ...(args.after_cell_id ? { after: str(args.after_cell_id) } : {}),
        cellType: args.cell_type === 'markdown' ? 'markdown' : 'code',
        source: str(args.source),
        explanation: str(args.explanation).slice(0, 2000)
      }
      proposals.set(p.id, p)
      emit({ session: s.id, type: 'proposal', proposal: p })
      return 'Proposed. The learner sees it beside the cell and keeps or drops it; you will hear which.'
    }
  },
  {
    name: 'set_exercise',
    description: "Set a checked exercise in the notebook: a Markdown prompt, starter code, hidden tests (each a name and Python code with assert statements that have messages, run against the learner's variables after they run their cell), a hint, and your own solution. Tide runs your solution and the tests in the scratch kernel first (after replaying the notebook); the exercise is set only if they pass.",
    inputSchema: obj(
      {
        title: { type: 'string' },
        prompt: { type: 'string' },
        starter: { type: 'string' },
        solution: { type: 'string' },
        tests: { type: 'array', items: obj({ name: { type: 'string' }, code: { type: 'string' } }, ['name', 'code']) },
        hint: { type: 'string' },
        after_cell_id: { type: 'string' }
      },
      ['title', 'prompt', 'starter', 'solution', 'tests']
    ),
    async run(args, ctx) {
      const s = sessionOfCtx(ctx)
      const tests = (Array.isArray(args.tests) ? args.tests : []).map((t) => ({ name: str((t as Record<string, unknown>).name), code: str((t as Record<string, unknown>).code) })).filter((t) => t.code.trim())
      if (!tests.length) return 'Not set: give at least one test.'
      const spec: ExerciseSpec = { id: `nb:${randomUUID().slice(0, 12)}`, title: str(args.title).slice(0, 120), prompt: str(args.prompt), starter: str(args.starter), solution: str(args.solution), tests, ...(args.hint ? { hint: str(args.hint) } : {}) }
      // Your solution must pass, from the notebook's state
      const tried = await runIn(s, spec.solution, true)
      if (/\[(error|aborted)\]\s*$/.test(tried)) {
        console.warn('[notebook] exercise not set: solution failed', tried.slice(-400))
        return `Not set: your solution raised an error in the scratch kernel:\n${tried}`
      }
      const { runChecks, saveExercise } = await import('./index')
      const r = await runChecks(s.scratch!, tests)
      if (!r.passed) console.warn('[notebook] exercise not set: tests failed', JSON.stringify(r.results).slice(0, 400))
      if (!r.passed) return `Not set: your solution fails its own tests: ${r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.message}`).join('; ')}`
      await saveExercise(spec)
      emit({ session: s.id, type: 'exercise', exercise: { id: spec.id, title: spec.title, prompt: spec.prompt, starter: spec.starter, ...(spec.hint ? { hint: spec.hint } : {}) }, ...(args.after_cell_id ? { after: str(args.after_cell_id) } : {}) })
      return `Set: the exercise is in the notebook with ${tests.length} hidden tests, which your solution passes. You'll hear when the learner checks it.`
    }
  }
]

const TOOL_LABELS: Record<string, string> = { read_notebook: 'Reading the notebook', get_variables: 'Reading the variables', run_scratch: 'Trying it in a scratch kernel', propose_cell: 'Proposing a cell', set_exercise: 'Setting an exercise' }

async function ensureProcess(s: Session) {
  if (s.proc?.alive) return s.proc
  const { ClaudeProcess } = await import('../claudeEngine')
  const { ensureMcp } = await import('../tideMcp')
  const { mcpConfig } = await import('../claudeCli')
  const mcp = await ensureMcp()
  const dir = join(app.getPath('userData'), 'claude')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `mcp-nb-${s.id.slice(0, 12)}.json`)
  writeFileSync(file, mcpConfig(mcp.port, mcp.token, `nb:${s.id}`), { mode: 0o600 })
  s.proc = new ClaudeProcess(`nb:${s.id}`, s.model, SYSTEM, file, [])
  return s.proc
}

export async function tutorStatus(): Promise<{ claude: boolean; why?: string }> {
  const { claudeReady } = await import('../claudeEngine')
  const r = await claudeReady()
  return { claude: r.ready, ...(r.why ? { why: r.why } : {}) }
}

export async function send(req: TutorRequest): Promise<void> {
  const s = sessionFor(req.session)
  if (s.busy) return emit({ session: s.id, type: 'error', message: 'Still answering.' })
  const snap = s.snapshot
  const cellNumber = (id: string) => (snap?.code.findIndex((c) => c.id === id) ?? -1) + 1 || 0
  const text = actionText(req, (id) => {
    const i = (snap?.text ?? '').split('\n').find((l) => l.includes(`id=${id}`))
    return Number(/Cell (\d+)/.exec(i ?? '')?.[1]) || cellNumber(id)
  })
  beginTurn(s.id, req.action, req.text)
  const ctrl = new AbortController()
  s.busy = ctrl
  const t0 = Date.now()
  const { claudeReady, recordUse } = await import('../claudeEngine')
  const ready = await claudeReady()
  try {
    if (!ready.ready) return await gemmaAnswer(s, text, ctrl.signal, t0)
    const { claudeModel } = await import('@shared/claude')
    const { getSettings } = await import('../settings')
    s.model ||= claudeModel('teach', getSettings().ai.claude)
    const { bindLesson, unbindLesson } = await import('../tideMcp')
    const key = `nb:${s.id}`
    let n = 0
    bindLesson(key, { signal: ctrl.signal, sources: [], emitSources: () => {}, step: () => `n${++n}`, updateStep: () => {}, web: false, labId: key, chatId: undefined })
    try {
      const context = [
        s.notes.length ? `(Since your last message: ${s.notes.join(' ')})` : '',
        snap?.active ? `(The learner is in cell id ${snap.active}.)` : '',
        s.mayPropose ? '(The learner asked for code: propose_cell is allowed this turn.)' : '(The learner did not ask for code: hints and questions, no propose_cell.)'
      ]
        .filter(Boolean)
        .join('\n')
      s.notes = []
      const proc = await ensureProcess(s)
      let gap = false
      let wrote = false
      const result = await proc.turn(
        `${context}\n\n${text}`,
        s.model,
        (e) => {
          if (e.type === 'text' && e.text) {
            emit({ session: s.id, type: 'delta', text: (gap && wrote ? '\n\n' : '') + e.text })
            gap = false
            wrote = true
          } else if (e.type === 'message-start') gap = true
          else if (e.type === 'tool') {
            const name = e.name.replace(/^mcp__tide__/, '')
            emit({ session: s.id, type: 'tool', label: TOOL_LABELS[name] ?? name })
          }
        },
        ctrl.signal
      )
      const cost = Math.max(0, result.usage.costUsd - proc.costSoFar)
      proc.costSoFar = result.usage.costUsd
      recordUse({ ...result.usage, costUsd: cost, at: Date.now(), model: result.model ?? s.model, role: 'teach', ms: Date.now() - t0 })
      if (!result.ok) {
        // Claude couldn't before writing: Gemma answers instead
        if (!wrote) return await gemmaAnswer(s, text, ctrl.signal, t0)
        emit({ session: s.id, type: 'error', message: result.error ?? 'Claude stopped.' })
      } else emit({ session: s.id, type: 'done', ms: Date.now() - t0, engine: 'claude', model: result.model ?? s.model })
    } finally {
      unbindLesson(key)
    }
  } catch (e) {
    emit({ session: s.id, type: 'error', message: (e as Error).name === 'AbortError' ? 'Stopped.' : (e as Error).message })
  } finally {
    s.busy = null
  }
}

/** Without Claude: Gemma answers from the notebook's text, with no tools (no proposals or exercises) */
async function gemmaAnswer(s: Session, text: string, signal: AbortSignal, t0: number) {
  const { draftFor } = await import('../ai')
  const notebook = s.snapshot ? `The notebook "${s.snapshot.name}":\n\n${s.snapshot.text.slice(0, 24_000)}` : 'The notebook is empty.'
  const system = `${SYSTEM.split('\n')[0]}\nThe learner writes the code; you tutor: explain outputs, point to where an error is and why with questions and hints. Show code only if they ask. You can't run code or change the notebook here. Write plainly and briefly, no analogies or jokes.`
  for await (const t of draftFor('notebookTutor', [{ role: 'system', content: system }, { role: 'user', content: `${notebook}\n\n${text}` }], signal, 1200, 'other')) emit({ session: s.id, type: 'delta', text: t })
  emit({ session: s.id, type: 'done', ms: Date.now() - t0, engine: 'gemma' })
}

export function stop(id: string) {
  sessions.get(id)?.busy?.abort()
}

export async function end(id: string) {
  const s = sessions.get(id)
  s?.busy?.abort()
  s?.proc?.stop()
  await s?.scratch?.shutdown().catch(() => {})
  sessions.delete(id)
  listeners.delete(id)
}

export async function stopTutors() {
  await Promise.all([...sessions.keys()].map(end))
}

/** The learner kept or dropped a proposal; Claude hears which with its next message */
export function resolveProposal(id: string, kept: string | null) {
  const p = proposals.get(id)
  if (!p) return
  proposals.delete(id)
  const what = p.kind === 'replace' ? `your proposed change to cell ${p.cellId}` : 'your proposed new cell'
  noteForTutor(p.session, kept === null ? `the learner dropped ${what}.` : kept === p.source ? `the learner kept ${what}.` : `the learner kept ${what} with their own edits.`)
}

export const pendingProposals = (session: string) => [...proposals.values()].filter((p) => p.session === session)
