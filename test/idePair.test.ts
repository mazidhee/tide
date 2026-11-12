import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'tide-pair-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn(), showItemInFolder: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: {} }))

const ws = await import('../src/main/ide/workspace')
const pair = await import('../src/main/ide/pair')
import type { ToolContext } from '../src/main/agent'
import type { PairEvent } from '../src/shared/ide'

const project = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tide-pair-proj-')))
  ws.remember(dir)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'calc.py'), 'def add(a, b):\n    return a - b\n')
  writeFileSync(join(dir, 'test_calc.py'), 'from src.calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n')
  return dir
}

function session(root: string, mode: 'ask' | 'build' | 'review' | 'bughunt' = 'ask') {
  const events: PairEvent[] = []
  const id = `t${Math.random().toString(36).slice(2)}`
  const owner = { isDestroyed: () => false, send: (_c: string, e: PairEvent) => events.push(e) } as unknown as Electron.WebContents
  pair.ensureSession(id, root, mode, owner, 'sonnet')
  let n = 0
  const ctx: ToolContext = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {}, web: false, labId: `ide:${id}`, chatId: undefined }
  const tool = (name: string) => pair.IDE_TOOLS.find((t) => t.name === name)!
  return { events, run: (name: string, args: Record<string, unknown>) => tool(name).run(args, ctx) }
}

describe("Claude's coding tools", () => {
  it('read, list and search only inside the project', async () => {
    const root = project()
    const s = session(root)
    expect(await s.run('list_files', {})).toContain('src/calc.py')
    expect(await s.run('read_file', { path: 'src/calc.py' })).toContain('2      return a - b')
    expect(await s.run('search_code', { query: 'return' })).toContain('src/calc.py:2:')
    await expect(s.run('read_file', { path: '../../etc/passwd' })).rejects.toThrow(/outside/)
    // An absolute path is read as one inside the project, so the real one is never reached
    await expect(s.run('read_file', { path: '/etc/passwd' })).rejects.toThrow(join(root, 'etc/passwd'))
  })

  it('proposes an edit as a diff without writing it, and joins edits to one file', async () => {
    const root = project()
    const s = session(root)
    const r = await s.run('propose_edit', { path: 'src/calc.py', old_string: 'return a - b', new_string: 'return a + b', explanation: 'add, not subtract' })
    expect(r).toMatch(/nothing is written/)
    expect(readFileSync(join(root, 'src/calc.py'), 'utf8')).toContain('a - b')
    const p = s.events.find((e) => e.type === 'proposal')
    expect(p && p.type === 'proposal' && p.proposal.proposed).toContain('a + b')
    // A second edit to the same file joins the same proposal
    await s.run('propose_edit', { path: 'src/calc.py', old_string: 'def add(a, b):', new_string: 'def add(a: int, b: int) -> int:' })
    const props = s.events.filter((e) => e.type === 'proposal')
    expect(props).toHaveLength(2)
    if (props[1].type === 'proposal' && props[0].type === 'proposal') {
      expect(props[1].proposal.id).toBe(props[0].proposal.id)
      expect(props[1].proposal.original).toContain('a - b')
      expect(props[1].proposal.proposed).toContain('a: int')
      pair.resolve(props[1].proposal.id, null)
    }
    expect(await s.run('propose_edit', { path: 'src/calc.py', old_string: 'nowhere', new_string: 'x' })).toMatch(/isn't in/)
    expect(await s.run('write_file', { path: '../evil.py', content: 'x' }).catch((e) => (e as Error).message)).toMatch(/outside/)
  })

  it('writes straight to disk only when the learner lets Claude edit the project', async () => {
    const root = project()
    pair.autoEdit(root, true)
    const s = session(root)
    expect(await s.run('write_file', { path: 'notes/new.md', content: '# hi\n' })).toMatch(/Written/)
    expect(readFileSync(join(root, 'notes/new.md'), 'utf8')).toBe('# hi\n')
    expect(s.events.some((e) => e.type === 'applied')).toBe(true)
    pair.autoEdit(root, false)
  })

  it('runs commands and tests in the sandbox, never on the project itself', async () => {
    const root = project()
    const s = session(root)
    const out = await s.run('run_command', { command: 'echo changed > src/calc.py; cat src/calc.py' })
    expect(out).toMatch(/exit 0/)
    expect(out).toContain('changed')
    expect(readFileSync(join(root, 'src/calc.py'), 'utf8')).toContain('return a - b')
  })

  it('puts review comments under their lines', async () => {
    const root = project()
    const s = session(root, 'review')
    await s.run('add_review_comment', { path: 'src/calc.py', line: 2, severity: 'issue', body: 'This subtracts.' })
    const c = s.events.find((e) => e.type === 'comment')
    expect(c && c.type === 'comment' && c.comment).toMatchObject({ path: 'src/calc.py', line: 2, severity: 'issue' })
  })

  it('reads the git diff', async () => {
    const root = project()
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', 'add', '-A'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-qm', 'one'], { cwd: root })
    writeFileSync(join(root, 'src', 'calc.py'), 'def add(a, b):\n    return a + b\n')
    expect(await session(root).run('git_diff', {})).toContain('+    return a + b')
  })
})

describe('a bug hunt', () => {
  it('copies the project, plants the bug in the copy directly, and keeps the answer hidden until asked', async () => {
    const root = project()
    const hunt = await pair.startHunt(root)
    expect(hunt.root).not.toBe(root)
    expect(existsSync(join(hunt.root, 'src', 'calc.py'))).toBe(true)
    const s = session(hunt.root, 'bughunt')
    const r = await s.run('propose_edit', { path: 'test_calc.py', old_string: 'add(2, 3) == 5', new_string: 'add(2, 3) == 5 and True', explanation: 'harmless' })
    expect(r).toMatch(/Don't tell/)
    // Nothing shown to the learner, the copy changed, the original didn't
    expect(s.events.filter((e) => e.type === 'proposal' || e.type === 'applied')).toEqual([])
    expect(readFileSync(join(hunt.root, 'test_calc.py'), 'utf8')).toContain('and True')
    expect(readFileSync(join(root, 'test_calc.py'), 'utf8')).not.toContain('and True')
    const answer = pair.reveal(hunt.id)
    expect(answer.planted).toBe(true)
    expect(answer.answer?.[0].diff).toContain('+    assert add(2, 3) == 5 and True')
  })
})
