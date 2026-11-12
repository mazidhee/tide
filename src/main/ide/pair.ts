/**
 * Claude as a pair programmer in the IDE: building a feature together, a bug planted for you to
 * hunt, and your changes reviewed like a senior engineer would.
 *
 * How the sandbox stays tight: Claude Code runs with none of its own tools (`--tools ""`), its
 * cwd in Tide's own folder, and only Tide's MCP server allowed. That server gives a pair session
 * (MCP key "ide:<session>") only the tools below, each confined to the session's project folder
 * by main/ide/paths: list, read and search files, read diagnostics, the git diff and the debugger's
 * state, run commands and tests in Tide's sandbox (a throwaway copy, no network), comment on lines,
 * and propose edits. A proposed edit is not written: it appears in the IDE as a diff the learner
 * keeps or undoes hunk by hunk. Only when the learner turns on "let Claude edit" for a project
 * (or in a bug hunt's own copy) does an edit go straight to disk. Claude Code's own Read, Edit
 * and Bash would reach the whole disk unsandboxed and write without asking, which is why they
 * aren't used.
 */
import { app, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { BugHunt, PairEvent, PairMode, ProblemReport, Proposal, ReviewComment } from '@shared/ide'
import { unified } from '@shared/hunks'
import type { McpTool } from '../tideMcp'
import { cleanRel, inside, insideReal } from './paths'
import { copyProject, shellInSandbox } from './sandbox'
import { search } from './search'
import * as git from './git'
import { runTests } from './tests'
import { allowed, huntsDir, listFiles, readFile, remember } from './workspace'

interface Session {
  id: string
  root: string
  mode: PairMode
  owner: WebContents
  proc: import('../claudeEngine').ClaudeProcess | null
  busy: AbortController | null
  /** What happened since Claude's last turn (proposals kept or undone), told with the next message */
  notes: string[]
  model: string
}

const sessions = new Map<string, Session>()
const proposals = new Map<string, Proposal>()
const problems = new Map<string, ProblemReport[]>()
const debugText = new Map<string, string>()

const ideDir = () => join(app.getPath('userData'), 'ide')
const autoFile = () => join(ideDir(), 'auto-edit.json')
const huntsFile = () => join(ideDir(), 'hunts.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
function writeJson(file: string, v: unknown) {
  mkdirSync(ideDir(), { recursive: true })
  writeFileSync(file, JSON.stringify(v, null, 1))
}

/** Projects where the learner let Claude write without asking */
export function autoEdit(root: string, on?: boolean): boolean {
  const list = readJson<string[]>(autoFile(), [])
  if (on !== undefined) writeJson(autoFile(), on ? [...new Set([...list, root])] : list.filter((r) => r !== root))
  return on ?? list.includes(root)
}

const hunts = (): BugHunt[] => readJson<BugHunt[]>(huntsFile(), [])
const saveHunts = (list: BugHunt[]) => writeJson(huntsFile(), list.slice(0, 30))
const huntFor = (root: string) => hunts().find((h) => h.root === root)

type PairBody = PairEvent extends infer E ? (E extends PairEvent ? Omit<E, 'session'> : never) : never

function emit(s: Session, e: PairBody) {
  if (!s.owner.isDestroyed()) s.owner.send('ide:pair:event', { session: s.id, ...e })
}

const sessionOf = (key: string): Session | null => (key.startsWith('ide:') ? (sessions.get(key.slice(4)) ?? null) : null)

const MAX_READ = 60_000
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s)

/** The text Claude's next edit applies to: its own pending proposal for the file, else the file */
async function currentText(s: Session, rel: string): Promise<{ text: string; exists: boolean; pending?: Proposal }> {
  const pending = [...proposals.values()].find((p) => p.root === s.root && p.path === rel)
  if (pending) return { text: pending.proposed, exists: true, pending }
  const abs = inside(s.root, rel)
  if (!existsSync(abs)) return { text: '', exists: false }
  const r = await readFile(s.root, rel)
  if (r.binary || r.tooLarge) throw new Error(`${rel} can't be edited here (${r.binary ? 'not text' : 'too large'}).`)
  return { text: r.text, exists: true }
}

/** Writes now (let-Claude-edit, or a bug hunt's copy) or shows a proposal; what Claude is told */
async function propose(s: Session, rel: string, next: string, explanation: string): Promise<string> {
  const path = cleanRel(rel)
  if (!path) throw new Error('Give the file’s path in the project.')
  const cur = await currentText(s, path)
  const hunt = huntFor(s.root)
  if (hunt || autoEdit(s.root)) {
    const abs = insideReal(s.root, path)
    const before = cur.exists ? (await fs.readFile(abs, 'utf8').catch(() => '')) : ''
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, next, 'utf8')
    if (hunt) {
      // The planted change is kept for the answer; the learner sees nothing of it now
      // Against the original project's file, so two edits to one file make one answer
      const original = await fs.readFile(join(hunt.source, ...path.split('/')), 'utf8').catch(() => before)
      const list = hunts().map((h) => (h.id === hunt.id ? { ...h, planted: true, answer: [...(h.answer ?? []).filter((a) => a.path !== path), { path, diff: unified(path, original, next), explanation }] } : h))
      saveHunts(list)
      return `Written to ${path} in the bug hunt's copy. Don't tell the learner where it is.`
    }
    emit(s, { type: 'applied', root: s.root, path })
    return `Written to ${path} (the learner lets you edit this project directly).`
  }
  const id = cur.pending?.id ?? randomUUID()
  const p: Proposal = { id, root: s.root, path, original: cur.pending?.original ?? cur.text, proposed: next, explanation: [cur.pending?.explanation, explanation].filter(Boolean).join('\n\n').slice(0, 3000), created: Date.now(), ...(cur.exists ? {} : { isNew: true }) }
  proposals.set(id, p)
  emit(s, { type: 'proposal', proposal: p })
  return `Proposed a change to ${path}. The learner sees it as a diff and keeps or undoes each change; nothing is written until they do. Further edits to this file are added to the same proposal.`
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** The tools a pair session has, all confined to its project (the MCP server lists only these for it) */
export const IDE_TOOLS: McpTool[] = [
  {
    name: 'list_files',
    description: 'List the files in the project (paths relative to its root), optionally under a folder. Ignores dependencies and build output.',
    inputSchema: obj({ folder: { type: 'string', description: 'A folder in the project, e.g. "src"' } }),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const l = await listFiles(s.root)
      const f = cleanRel(str(args.folder))
      const files = f ? l.files.filter((x) => x.startsWith(f + '/')) : l.files
      return files.length ? clip(files.slice(0, 600).join('\n'), 40_000) + (files.length > 600 ? `\n… and ${files.length - 600} more` : '') : 'No files.'
    }
  },
  {
    name: 'read_file',
    description: 'Read a file of the project, with line numbers. For a long file, give start_line and end_line.',
    inputSchema: obj({ path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, ['path']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const path = cleanRel(str(args.path))
      const r = await readFile(s.root, path)
      if (r.binary) return `${path} is not a text file.`
      if (r.tooLarge) return `${path} is too large to read.`
      const lines = r.text.split('\n')
      const a = Math.max(1, Number(args.start_line) || 1)
      const b = Math.min(lines.length, Number(args.end_line) || lines.length)
      const out = lines.slice(a - 1, b).map((l, i) => `${String(a + i).padStart(5)}  ${l}`).join('\n')
      return clip(out, MAX_READ) + (b < lines.length ? `\n(lines ${a}–${b} of ${lines.length})` : '')
    }
  },
  {
    name: 'search_code',
    description: 'Search the project’s files with ripgrep. Returns path:line: text for each match.',
    inputSchema: obj({ query: { type: 'string' }, regex: { type: 'boolean' }, include: { type: 'string', description: 'Globs, e.g. "*.py" or "src"' } }, ['query']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const r = await search(s.root, { query: str(args.query), regex: !!args.regex, include: str(args.include) || undefined, maxResults: 300 })
      if (r.error) return `Search failed: ${r.error}`
      if (!r.total) return 'No matches.'
      return clip(r.files.flatMap((f) => f.matches.map((m) => `${f.path}:${m.line}: ${m.preview.trim()}`)).join('\n'), 30_000)
    }
  },
  {
    name: 'get_diagnostics',
    description: 'The errors and warnings the editor shows for the files the learner has open (from the language servers and Ruff).',
    inputSchema: obj({ path: { type: 'string' } }),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const p = cleanRel(str(args.path))
      const list = (problems.get(s.root) ?? []).filter((x) => !p || x.path === p)
      return list.length ? list.slice(0, 120).map((x) => `${x.path}:${x.line}:${x.column} ${x.severity}: ${x.message}${x.source ? ` (${x.source})` : ''}`).join('\n') : 'No problems in the open files.'
    }
  },
  {
    name: 'git_diff',
    description: "The learner's uncommitted changes as a unified diff (staged and unstaged), and the git status.",
    inputSchema: obj({ path: { type: 'string' } }),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const st = await git.status(s.root)
      if (!st.repo) return 'This project is not a git repository.'
      const path = cleanRel(str(args.path)) || undefined
      const [staged, work] = await Promise.all([git.diff(s.root, { staged: true, path }), git.diff(s.root, { path })])
      const untracked = st.files.filter((f) => f.work === '?').map((f) => f.path)
      const parts = [`On branch ${st.branch ?? st.detached}. ${st.files.length} changed file(s).`, staged && `Staged:\n${staged}`, work && `Not staged:\n${work}`, untracked.length && `New files (not in the diff; read them with read_file): ${untracked.join(', ')}`].filter(Boolean)
      return clip(parts.join('\n\n'), 80_000)
    }
  },
  {
    name: 'propose_edit',
    description:
      'Propose replacing old_string with new_string in a file (old_string must appear exactly once; include enough surrounding lines). The learner reviews it as a diff and keeps or undoes each change; it is not written until they do. Several edits to one file join one proposal.',
    inputSchema: obj({ path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, explanation: { type: 'string', description: 'Why, in a sentence or two, for the learner' } }, ['path', 'old_string', 'new_string']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const path = cleanRel(str(args.path))
      const cur = await currentText(s, path)
      if (!cur.exists) return `${path} doesn't exist. Use write_file to make it.`
      const old = str(args.old_string)
      const count = old ? cur.text.split(old).length - 1 : 0
      if (count !== 1) return count ? `old_string appears ${count} times in ${path}: include more surrounding lines so it is unique.` : `old_string isn't in ${path} as written. Read the file again and copy the lines exactly.`
      return propose(s, path, cur.text.replace(old, () => str(args.new_string)), str(args.explanation))
    }
  },
  {
    name: 'write_file',
    description: 'Propose a whole file: a new one, or a full rewrite of a short one. Shown to the learner as a diff to keep or undo.',
    inputSchema: obj({ path: { type: 'string' }, content: { type: 'string' }, explanation: { type: 'string' } }, ['path', 'content']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      return propose(s, str(args.path), str(args.content), str(args.explanation))
    }
  },
  {
    name: 'run_command',
    description:
      "Run a shell command (zsh) in Tide's sandbox on a copy of the project: no network, and nothing it writes reaches the project. For running the program, a build, a linter or a script. Up to 2 minutes.",
    inputSchema: obj({ command: { type: 'string' } }, ['command']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const id = ctx.step({ kind: 'helper', label: `Running ${str(args.command).slice(0, 60)}`, status: 'running', depth: 0 })
      const r = await shellInSandbox(s.root, str(args.command), 120_000)
      ctx.updateStep(id, { status: 'done' })
      return clip(`exit ${r.exitCode}${r.timedOut ? ' (stopped at the time limit)' : ''} in ${(r.ms / 1000).toFixed(1)} s${r.partial ? ' (some large files were left out of the copy)' : ''}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`, 20_000)
    }
  },
  {
    name: 'run_tests',
    description: "Run the project's tests (pytest, cargo test, go test or node --test) in Tide's sandbox; optionally only some, by pytest node id.",
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const r = await runTests(s.root, Array.isArray(args.ids) ? args.ids.map(str) : undefined)
      if (r.error && !r.outcomes.length) return `${r.error}\n${clip(r.output, 6000)}`
      const failed = r.outcomes.filter((o) => o.status === 'fail' || o.status === 'error')
      return clip(`${r.framework}: ${r.outcomes.length - failed.length} passed, ${failed.length} failed in ${(r.ms / 1000).toFixed(1)} s\n${failed.map((f) => `FAILED ${f.id}\n${f.message ?? ''}`).join('\n\n')}`, 20_000)
    }
  },
  {
    name: 'debug_state',
    description: 'Where the learner’s debugger is stopped: the reason, the call stack and the variables in view. Read only.',
    inputSchema: obj({}),
    async run(_args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      return debugText.get(s.root) ?? 'Not debugging.'
    }
  },
  {
    name: 'add_review_comment',
    description: 'Put a review comment in the editor under a line of a file, as a reviewer does on a pull request. line is the line number in the file as it is now.',
    inputSchema: obj({ path: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string', enum: ['issue', 'suggestion', 'praise', 'question'] }, body: { type: 'string' } }, ['path', 'line', 'body']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const path = cleanRel(str(args.path))
      inside(s.root, path)
      const sev = ['issue', 'suggestion', 'praise', 'question'].includes(str(args.severity)) ? (str(args.severity) as ReviewComment['severity']) : 'suggestion'
      const c: ReviewComment = { id: randomUUID(), root: s.root, path, line: Math.max(1, Math.round(Number(args.line) || 1)), severity: sev, body: str(args.body).slice(0, 2000) }
      emit(s, { type: 'comment', comment: c })
      return 'Shown in the editor.'
    }
  },
  {
    name: 'open_in_editor',
    description: 'Open a file in the learner’s editor at a line, to show them something.',
    inputSchema: obj({ path: { type: 'string' }, line: { type: 'number' } }, ['path']),
    async run(args, ctx) {
      const s = sessionOf(ctx.labId?.replace(/^claude:/, '') ?? '')!
      const path = cleanRel(str(args.path))
      inside(s.root, path)
      emit(s, { type: 'opened', root: s.root, path, line: Number(args.line) || undefined })
      return 'Opened.'
    }
  }
]

const BASE = `You are pair-programming with a learner in Tide's IDE. You work on their project only through Tide's tools, which are confined to the project folder: list_files, read_file, search_code, get_diagnostics, git_diff, debug_state, run_command and run_tests (both in a sandbox on a throwaway copy, with no network), add_review_comment, open_in_editor, and propose_edit or write_file to change code.
Your edits are proposals: the learner sees each as a diff in the editor and keeps or undoes each change. Say what you proposed and why in a sentence; don't paste the same code into your reply.
Read before you change anything, and run the tests after a change when the project has them. Be direct and concrete, write plainly, no analogies or jokes. Use Markdown, short paragraphs, and code spans for names.`

const MODES: Record<PairMode, string> = {
  ask: 'The learner asks about their project. Answer from the code itself (read it, search it, run it), and point at files and lines.',
  build: `Build a feature together. The learner should end up understanding and owning the code. First agree a small plan (3 to 6 steps). For each step, explain what's needed and let the learner write it when it's a good thing to learn; propose an edit yourself for boilerplate, or when they ask. After each step, run the tests or the program and say what passed.`,
  review: `Review the learner's uncommitted changes like a senior engineer reviewing a pull request. Read git_diff and the files around it, run the tests, then put each specific point on its line with add_review_comment (issue for bugs and risks, suggestion for improvements, question when intent is unclear, praise for something done well; at most about eight). Finish with a short summary: what's good, what must change before it's merged, and what's optional. Don't propose edits unless asked.`,
  bughunt: `This is a bug hunt, in a copy of the learner's project made for it. First, quietly read the code and plant exactly one realistic bug of the kind real code has (an off-by-one, a wrong comparison or sign, a shared mutable default, a missed edge case, a swapped argument), with propose_edit; it is written to the copy directly. Make it findable with the tests, the debugger or careful reading. Never say where the bug is or what you changed. Then tell the learner the symptom to start from and how to see it (a test to run, an input to try), and coach them with questions as they hunt. When they say they've found it, check their explanation and fix against what you changed. If they give up, explain the bug and how one would have tracked it down.`
}

async function ensureProcess(s: Session): Promise<import('../claudeEngine').ClaudeProcess> {
  if (s.proc?.alive) return s.proc
  const { ClaudeProcess } = await import('../claudeEngine')
  const { ensureMcp } = await import('../tideMcp')
  const { mcpConfig } = await import('../claudeCli')
  const mcp = await ensureMcp()
  const dir = join(app.getPath('userData'), 'claude')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `mcp-ide-${s.id.slice(0, 12)}.json`)
  // This launch's token for Tide's own server only; readable by the user alone
  writeFileSync(file, mcpConfig(mcp.port, mcp.token, `ide:${s.id}`), { mode: 0o600 })
  const system = `${BASE}\n\nThe project is "${basename(s.root)}".\n\n${MODES[s.mode]}`
  s.proc = new ClaudeProcess(`ide:${s.id}`, s.model, system, file, [])
  return s.proc
}

const TOOL_LABELS: Record<string, string> = { list_files: 'Listing files', read_file: 'Reading', search_code: 'Searching', get_diagnostics: 'Reading the problems', git_diff: 'Reading your changes', propose_edit: 'Proposing an edit', write_file: 'Proposing a file', run_command: 'Running', run_tests: 'Running the tests', debug_state: 'Reading the debugger', add_review_comment: 'Commenting', open_in_editor: 'Opening' }

/** The session for this conversation: a new one when the project or the mode changed */
export function ensureSession(id: string, root: string, mode: PairMode, owner: WebContents, model: string): Session {
  let s = sessions.get(id)
  if (!s || s.root !== root || s.mode !== mode) {
    s?.proc?.stop()
    s = { id, root, mode, owner, proc: null, busy: null, notes: [], model }
    sessions.set(id, s)
  }
  s.owner = owner
  return s
}

export async function send(owner: WebContents, req: { session: string; root: string; mode: PairMode; text: string; activePath?: string; selection?: string; model?: string }): Promise<void> {
  const root = allowed(req.root)
  const { claudeReady, recordUse } = await import('../claudeEngine')
  const ready = await claudeReady()
  const { claudeModel } = await import('@shared/claude')
  const { getSettings } = await import('../settings')
  const sess = ensureSession(req.session, root, req.mode, owner, req.model ?? claudeModel('teach', getSettings().ai.claude))
  if (!ready.ready) {
    emit(sess, { type: 'error', message: `Claude isn’t available: ${ready.why ?? 'not ready'}. The IDE works without it; the Tutor tab can help on this Mac.` })
    return
  }
  if (sess.busy) {
    emit(sess, { type: 'error', message: 'Claude is still answering.' })
    return
  }
  const context = [
    sess.notes.length ? `(Since your last message: ${sess.notes.join(' ')})` : '',
    req.activePath ? `(The learner has ${req.activePath} open.)` : '',
    req.selection ? `(They selected:\n\`\`\`\n${req.selection.slice(0, 4000)}\n\`\`\`)` : ''
  ]
    .filter(Boolean)
    .join('\n')
  sess.notes = []
  const ctrl = new AbortController()
  sess.busy = ctrl
  const t0 = Date.now()
  const { bindLesson, unbindLesson } = await import('../tideMcp')
  const key = `ide:${sess.id}`
  let n = 0
  bindLesson(key, { signal: ctrl.signal, sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {}, web: false, labId: key, chatId: undefined })
  try {
    const proc = await ensureProcess(sess)
    let gap = false
    let wrote = false
    const result = await proc.turn(`${context ? `${context}\n\n` : ''}${req.text}`, sess.model, (e) => {
      if (e.type === 'text' && e.text) {
        emit(sess, { type: 'delta', text: (gap && wrote ? '\n\n' : '') + e.text })
        gap = false
        wrote = true
      } else if (e.type === 'message-start') gap = true
      else if (e.type === 'tool') {
        const name = e.name.replace(/^mcp__tide__/, '')
        const input = (e.input ?? {}) as Record<string, unknown>
        emit(sess, { type: 'tool', name, label: `${TOOL_LABELS[name] ?? name}${input.path ? ` ${str(input.path)}` : input.command ? ` ${str(input.command).slice(0, 50)}` : input.query ? ` “${str(input.query).slice(0, 40)}”` : ''}` })
      }
    }, ctrl.signal)
    const cost = Math.max(0, result.usage.costUsd - proc.costSoFar)
    proc.costSoFar = result.usage.costUsd
    recordUse({ ...result.usage, costUsd: cost, at: Date.now(), model: result.model ?? sess.model, role: 'teach', ms: Date.now() - t0 })
    if (!result.ok) emit(sess, { type: 'error', message: result.error ?? 'Claude stopped.' })
    else emit(sess, { type: 'done', ms: Date.now() - t0, costUsd: cost })
  } catch (e) {
    emit(sess, { type: 'error', message: (e as Error).name === 'AbortError' ? 'Stopped.' : (e as Error).message })
  } finally {
    unbindLesson(key)
    sess.busy = null
  }
}

export function stop(id: string) {
  sessions.get(id)?.busy?.abort()
}

export function end(id: string) {
  const s = sessions.get(id)
  s?.busy?.abort()
  s?.proc?.stop()
  sessions.delete(id)
}

/** The learner kept (some of) a proposal, or undid it; Claude hears which with its next message */
export function resolve(id: string, text: string | null) {
  const p = proposals.get(id)
  if (!p) return
  proposals.delete(id)
  const note = text === null ? `the learner undid your proposed change to ${p.path}.` : text === p.proposed ? `the learner kept your change to ${p.path}.` : `the learner kept part of your change to ${p.path} (some hunks undone); read it again before editing it.`
  for (const s of sessions.values()) if (s.root === p.root) s.notes.push(note)
}

/** A copy of the project for a bug hunt, in Tide's own folder, opened as a workspace of its own */
export async function startHunt(rootIn: string): Promise<BugHunt> {
  const source = allowed(rootIn)
  const id = randomUUID().slice(0, 8)
  const root = join(huntsDir(), `${basename(source)}-bug-hunt-${id}`)
  await fs.mkdir(root, { recursive: true })
  await copyProject(source, root)
  // The copy's git history is the source's, so the learner's own diff shows only what changes from here
  if (existsSync(join(source, '.git'))) {
    await git.git(root, ['init', '-q']).catch(() => {})
    await git.git(root, ['add', '-A']).catch(() => {})
    await git.git(root, ['-c', 'user.name=Tide', '-c', 'user.email=tide@localhost', 'commit', '-q', '-m', 'Before the bug hunt']).catch(() => {})
  }
  remember(root, 'bughunt', `${basename(source)} (bug hunt)`)
  const hunt: BugHunt = { id, source, root, planted: false }
  saveHunts([hunt, ...hunts()])
  return hunt
}

export function reveal(id: string): BugHunt {
  const h = hunts().find((x) => x.id === id)
  if (!h) throw new Error('That bug hunt is gone.')
  return h
}

export function registerPair(): void {
  ipcMain.handle('ide:pair:status', async (_e, fresh?: boolean) => {
    const { claudeReady, claudeStatus } = await import('../claudeEngine')
    if (fresh) await claudeStatus(true)
    const r = await claudeReady()
    return { ready: r.ready, installed: r.installed, why: r.why }
  })
  ipcMain.handle('ide:pair:send', (e, req) => send(e.sender, req))
  ipcMain.handle('ide:pair:stop', (_e, id: string) => stop(id))
  ipcMain.handle('ide:pair:end', (_e, id: string) => end(id))
  ipcMain.handle('ide:pair:proposals', (_e, root: string) => [...proposals.values()].filter((p) => p.root === root))
  ipcMain.handle('ide:pair:resolve', (_e, id: string, text: string | null) => resolve(id, text))
  ipcMain.handle('ide:pair:autoEdit', (_e, root: string, on?: boolean) => autoEdit(allowed(root), on))
  ipcMain.on('ide:pair:problems', (_e, root: string, list: ProblemReport[]) => {
    if (typeof root === 'string' && Array.isArray(list)) problems.set(root, list.slice(0, 500))
  })
  ipcMain.on('ide:pair:debugState', (_e, root: string, text: string) => {
    if (typeof root === 'string') debugText.set(root, String(text ?? '').slice(0, 20_000))
  })
  ipcMain.handle('ide:pair:bugHunt', (_e, root: string) => startHunt(root))
  ipcMain.handle('ide:pair:reveal', (_e, id: string) => reveal(id))
  ipcMain.handle('ide:pair:hunts', () => hunts())
}

export const pairSessionCount = () => sessions.size
