/**
 * Coding lessons get the IDE's Claude tools. Each coding lesson has a folder of its own under
 * Tide's data (ide/lessons/<topic>-<id>), or works in a linked project's folder when the lesson is
 * about one; the lesson's editor saves each code question's answer there as a file. A Claude
 * process for a coding lesson (MCP key "code:<lab>", main/claudeEngine) is listed the tutor's
 * tools plus the subset of the IDE's below, confined to that folder by the same rules as the IDE
 * (main/ide/paths, the sandbox for runs). Proposals and comments go to the lesson's window as
 * LessonCodeEvents; an edit is written only when the learner keeps it, or straight away only if
 * they turned on "let Claude edit" for that folder in the IDE (off by default). Ordinary chats
 * never see any of this: their key isn't one.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, promises as fs } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { LessonCodeEvent, Workspace } from '@shared/ide'
import { codeTurnNote, IDE_LESSON_NOTE } from '@shared/lessonCode'
import type { McpTool } from '../tideMcp'
import { cleanRel, insideReal } from './paths'
import { IDE_TOOLS, resolvedListeners, setLessonNote, setLessonTargets } from './pair'
import { allowed, lessonsDir, remember } from './workspace'

interface LessonCode {
  labId: string
  root: string
  topic: string
  /** A project's folder, not Tide's own lesson folder: nothing is planted in it */
  linked: boolean
  /** Proposals kept or undone since the tutor last heard */
  notes: string[]
}

const lessons = new Map<string, LessonCode>()

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** The lesson's own folder: the same for the same lesson every time */
export function lessonFolder(labId: string, topic: string): string {
  const id = createHash('sha1').update(labId).digest('hex').slice(0, 10)
  return join(lessonsDir(), `${slug(topic) || 'lesson'}-${id}`)
}

export const isLessonRoot = (root: string) => dirname(resolve(root)) === resolve(lessonsDir())

/**
 * The lesson's workspace, made if new: a linked project's folder when given and the IDE may open
 * it (else the lesson's own), kept for the tools to find by the lesson's lab id.
 */
export function lessonWorkspace(labId: string, topic = '', linkedRoot?: string): LessonCode {
  if (!labId) throw new Error('A coding lesson needs its id.')
  let root: string
  let linked = false
  if (linkedRoot) {
    root = allowed(linkedRoot)
    linked = !isLessonRoot(root)
  } else {
    root = lessonFolder(labId, topic)
    mkdirSync(root, { recursive: true })
  }
  const had = lessons.get(labId)
  const l: LessonCode = { labId, root, topic: topic || had?.topic || '', linked, notes: had?.root === root ? had.notes : [] }
  lessons.set(labId, l)
  return l
}

export const lessonOf = (labId: string): LessonCode | null => lessons.get(labId) ?? null

/** The lab id in a coding lesson's MCP key ("code:<lab>", with ":web" when Claude's web tools are on) */
export const labOfKey = (key: string) => key.replace(/^code:/, '').replace(/:web$/, '')

function broadcast(e: LessonCodeEvent) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('ide:lesson:event', e)
}

const FORWARDED = new Set(['proposal', 'applied', 'comment', 'opened'])

setLessonTargets((labId) => {
  const l = lessons.get(labId)
  return l ? { root: l.root, send: (e) => FORWARDED.has(e.type) && broadcast({ labId, ...e } as LessonCodeEvent) } : null
})
resolvedListeners.push((root, note) => {
  for (const l of lessons.values()) if (l.root === root) l.notes.push(note)
})
setLessonNote((root) => (isLessonRoot(root) ? IDE_LESSON_NOTE : ''))

/** What the tutor hears with this message: the file on screen, and what became of its proposals */
export function lessonTurnNote(labId: string, file?: string): string {
  const l = lessons.get(labId)
  if (!l) return ''
  let shown: string | undefined
  try {
    shown = file ? cleanRel(file) || undefined : undefined
  } catch {
    shown = undefined
  }
  const note = codeTurnNote(shown, l.notes)
  l.notes = []
  return note
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** A find-the-bug exercise: one bug written into the lesson's own file, without a diff */
const PLANT_BUG: McpTool = {
  name: 'plant_bug',
  description:
    "For a find-the-bug exercise: write one realistic bug into a file of the lesson without showing the learner a diff. Replace old_string with new_string in an existing file (their own working code is best; old_string must appear exactly once), or give content for a whole new file. The file opens in their editor. Never tell them where the bug is.",
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, content: { type: 'string', description: 'A whole new file, instead of old_string and new_string' }, bug: { type: 'string', description: 'What you changed and the fix, for your own reference' } },
    required: ['path', 'bug']
  },
  async run(args, ctx) {
    const l = lessons.get(ctx.labId ?? '')
    if (!l) throw new Error('This lesson has no code folder.')
    if (l.linked) return "Bugs are planted only in the lesson's own files, never in their project. Start a bug hunt from the IDE, which works on a copy."
    const path = cleanRel(str(args.path))
    if (!path) return 'Give the file’s path.'
    const abs = insideReal(l.root, path)
    let next: string
    if (typeof args.content === 'string') next = args.content
    else {
      if (!existsSync(abs)) return `${path} doesn't exist: give content for a new file.`
      const cur = await fs.readFile(abs, 'utf8')
      const old = str(args.old_string)
      const count = old ? cur.split(old).length - 1 : 0
      if (count !== 1) return count ? `old_string appears ${count} times in ${path}: include more lines.` : `old_string isn't in ${path} as written. Read it again.`
      next = cur.replace(old, () => str(args.new_string))
    }
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, next, 'utf8')
    broadcast({ labId: l.labId, type: 'opened', root: l.root, path, planted: true })
    return `Planted in ${path}, which is now open in their editor. Don't say where it is; give them the symptom.`
  }
}

/** The IDE tools a lesson gets: no git or debugger in its own folder, and nothing planted in a project */
const OWN = ['list_files', 'read_file', 'search_code', 'get_diagnostics', 'run_command', 'run_tests', 'add_review_comment', 'open_in_editor', 'propose_edit', 'write_file']
const LINKED = [...OWN, 'git_diff', 'debug_state']

/** What the lesson's work log says each tool did (run_command says it itself; a planted bug says nothing of where) */
const SHOWN: Record<string, (a: Record<string, unknown>) => string> = {
  list_files: () => 'Looked at your files',
  read_file: (a) => `Read ${str(a.path)}`,
  search_code: (a) => `Searched your code for “${str(a.query).slice(0, 40)}”`,
  get_diagnostics: () => 'Read the problems in your editor',
  run_tests: () => 'Ran your tests',
  add_review_comment: (a) => `Commented on ${str(a.path)}, line ${Math.round(Number(a.line) || 1)}`,
  open_in_editor: (a) => `Opened ${str(a.path)}${a.line ? ` at line ${Math.round(Number(a.line))}` : ''}`,
  propose_edit: (a) => `Proposed a change to ${str(a.path)}`,
  write_file: (a) => `Proposed ${str(a.path)}`,
  git_diff: () => 'Read your changes',
  debug_state: () => 'Read the debugger',
  plant_bug: () => 'Set up the exercise'
}

const shown = (t: McpTool): McpTool =>
  SHOWN[t.name]
    ? {
        ...t,
        async run(args, ctx) {
          const out = await t.run(args, ctx)
          ctx.step({ kind: 'helper', label: SHOWN[t.name](args), status: 'done', depth: 0 })
          return out
        }
      }
    : t

export function lessonTools(labId: string): McpTool[] {
  const linked = lessons.get(labId)?.linked
  const names = linked ? LINKED : OWN
  return [...IDE_TOOLS.filter((t) => names.includes(t.name)), ...(linked ? [] : [PLANT_BUG])].map(shown)
}

/** The lesson's folder for the window; kept among the IDE's workspaces when it opens it there */
export function registerLessonCode(): void {
  const open = (labId: string, topic: string, root?: string) => {
    try {
      return lessonWorkspace(String(labId ?? ''), String(topic ?? ''), root ? String(root) : undefined)
    } catch (e) {
      // A linked folder the IDE can't open: the lesson's own
      if (root) return lessonWorkspace(String(labId ?? ''), String(topic ?? ''))
      throw e
    }
  }
  ipcMain.handle('ide:lesson:open', (_e, labId: string, topic: string, root?: string): Workspace => {
    const l = open(labId, topic, root)
    return { root: l.root, name: l.linked ? basename(l.root) : l.topic || 'Lesson', kind: l.linked ? 'folder' : 'lesson' }
  })
  ipcMain.handle('ide:lesson:openInIde', (_e, labId: string, topic: string, root?: string): Workspace => {
    const l = open(labId, topic, root)
    return l.linked ? remember(l.root) : remember(l.root, 'lesson', `Lesson: ${l.topic || 'code'}`)
  })
}
