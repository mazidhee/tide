import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'tide-ide-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn(), showItemInFolder: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: {} }))

const { cleanRel, inside, insideReal } = await import('../src/main/ide/paths')
const ws = await import('../src/main/ide/workspace')
const { search, replace, parseRgLine, rgArgs, jsPattern, globMatch, preview } = await import('../src/main/ide/search')
const git = await import('../src/main/ide/git')
const { DapClient, encodeDap, startSession } = await import('../src/main/ide/dap')
const { pytestTree, parseCargo, parseTap } = await import('../src/main/ide/tests')
const { inSandbox, shellInSandbox } = await import('../src/main/ide/sandbox')

const project = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tide-ide-proj-')))
  ws.remember(dir)
  return dir
}

describe('paths inside a workspace', () => {
  it('cleans relative paths and refuses climbing out', () => {
    expect(cleanRel('/src//a/./b.py')).toBe('src/a/b.py')
    expect(cleanRel('a\\b.py')).toBe('a/b.py')
    expect(() => cleanRel('../x')).toThrow(/outside/)
    expect(() => cleanRel('a/../../x')).toThrow(/outside/)
  })

  it('takes an absolute path only when it is inside the root', () => {
    expect(inside('/p/root', '/p/root/a.py')).toBe('/p/root/a.py')
    expect(() => inside('/p/root', '/etc/passwd')).toThrow(/outside/)
    expect(() => inside('/p/root', '/p/rootx/a.py')).toThrow(/outside/)
  })

  it('will not write through a link that leads out of the project', () => {
    const dir = project()
    const outside = mkdtempSync(join(tmpdir(), 'tide-out-'))
    symlinkSync(outside, join(dir, 'escape'))
    expect(() => insideReal(dir, 'escape/x.txt')).toThrow(/outside/)
    expect(insideReal(dir, 'fine/new.txt')).toBe(join(dir, 'fine/new.txt'))
  })
})

describe('workspaces', () => {
  it('only works in folders that were opened', async () => {
    const stranger = mkdtempSync(join(tmpdir(), 'tide-stranger-'))
    await expect(ws.listFiles(stranger)).rejects.toThrow(/Open the folder/)
    const dir = project()
    expect(ws.workspaces().recent.some((w) => w.root === dir)).toBe(true)
  })

  it('lists files with ripgrep, keeping to .gitignore and skipping dependencies, and empty folders too', async () => {
    const dir = project()
    execFileSync('git', ['init', '-q'], { cwd: dir })
    mkdirSync(join(dir, 'src', 'empty'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '')
    writeFileSync(join(dir, 'src', 'a.py'), 'x = 1\n')
    writeFileSync(join(dir, 'secret.log'), '')
    writeFileSync(join(dir, '.gitignore'), '*.log\n')
    const l = await ws.listFiles(dir)
    expect(l.files).toEqual(['.gitignore', 'src/a.py'])
    expect(l.dirs).toContain('src/empty')
    expect(l.dirs).not.toContain('node_modules')
  })

  it('makes files without overwriting, reads them and refuses binary', async () => {
    const dir = project()
    expect(await ws.create(dir, 'pkg/m.py', 'file', 'a = 1\n')).toBe('pkg/m.py')
    expect(await ws.create(dir, 'pkg/m.py', 'file')).toBe('pkg/m 2.py')
    expect((await ws.readFile(dir, 'pkg/m.py')).text).toBe('a = 1\n')
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 0, 2]))
    expect((await ws.readFile(dir, 'b.bin')).binary).toBe(true)
    await ws.writeFile(dir, 'deep/new/f.txt', 'hi')
    expect(readFileSync(join(dir, 'deep/new/f.txt'), 'utf8')).toBe('hi')
    await ws.rename(dir, 'deep/new/f.txt', 'g.txt')
    expect(readFileSync(join(dir, 'g.txt'), 'utf8')).toBe('hi')
  })
})

describe('search across files', () => {
  it('reads ripgrep JSON with character columns for non-ASCII text', () => {
    const line = JSON.stringify({ type: 'match', data: { path: { text: './a.py' }, lines: { text: 'é = "foo"\n' }, line_number: 3, submatches: [{ match: { text: 'foo' }, start: 7, end: 10 }] } })
    const r = parseRgLine(line)!
    expect(r.path).toBe('a.py')
    expect(r.matches[0]).toMatchObject({ line: 3, column: 7, length: 3, preview: 'é = "foo"' })
    expect(parseRgLine('{"type":"begin","data":{}}')).toBeNull()
  })

  it('builds ripgrep arguments from the options', () => {
    const a = rgArgs({ query: 'a.b', include: 'src, *.py', exclude: 'tests' })
    expect(a).toContain('--fixed-strings')
    expect(a).toContain('--ignore-case')
    expect(a.join(' ')).toContain('-g src/** -g *.py -g !tests/**')
    expect(rgArgs({ query: 'x', regex: true, caseSensitive: true, wholeWord: true })).toEqual(expect.arrayContaining(['--case-sensitive', '--word-regexp']))
  })

  it('keeps long lines to a window around the match', () => {
    const p = preview('x'.repeat(500) + 'needle' + 'y'.repeat(500), 500, 6)
    expect(p.preview.slice(p.previewColumn, p.previewColumn + 6)).toBe('needle')
    expect(p.preview.length).toBeLessThan(200)
  })

  it('matches globs and patterns as ripgrep would', () => {
    expect(globMatch('*.py', 'src/a.py')).toBe(true)
    expect(globMatch('src', 'src/deep/a.py')).toBe(true)
    expect(globMatch('src', 'lib/a.py')).toBe(false)
    expect('Foo foo food'.match(jsPattern({ query: 'foo', wholeWord: true }))).toHaveLength(2)
  })

  it('finds and replaces across a project', async () => {
    const dir = project()
    writeFileSync(join(dir, 'a.py'), 'total = price * qty\nprint(total)\n')
    writeFileSync(join(dir, 'b.py'), 'from a import total\n')
    writeFileSync(join(dir, 'c.txt'), 'nothing\n')
    const r = await search(dir, { query: 'total' })
    expect(r.engine).toBe('ripgrep')
    expect(r.files.map((f) => f.path)).toEqual(['a.py', 'b.py'])
    expect(r.total).toBe(3)
    const only = await search(dir, { query: 'total', include: 'b.py' })
    expect(only.files.map((f) => f.path)).toEqual(['b.py'])
    expect((await search(dir, { query: '(', regex: true })).error).toBeTruthy()
    const n = await replace(dir, { query: 'tot(al)', regex: true }, 'sum$1', ['a.py'])
    expect(n).toEqual({ files: 1, replacements: 2 })
    expect(readFileSync(join(dir, 'a.py'), 'utf8')).toBe('sumal = price * qty\nprint(sumal)\n')
    expect(readFileSync(join(dir, 'b.py'), 'utf8')).toBe('from a import total\n')
  })
})

describe('git', () => {
  it('reads porcelain v2 status: branch, ahead and behind, renames, untracked and conflicts', () => {
    const out = ['# branch.oid abc123def', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b src/a.py', '2 R. N... 100644 100644 100644 a b R100 new name.py', 'old.py', 'u UU N... 1 2 3 4 h1 h2 h3 c.py', '? notes.txt', ''].join('\0')
    const s = git.parseStatus(out)
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(s.files).toEqual([
      { path: 'src/a.py', index: '.', work: 'M' },
      { path: 'new name.py', index: 'R', work: '.', from: 'old.py' },
      { path: 'c.py', index: 'U', work: 'U', conflicted: true },
      { path: 'notes.txt', index: '.', work: '?' }
    ])
  })

  it('stages, commits, diffs, blames and branches a real repository', async () => {
    const dir = project()
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir })
    writeFileSync(join(dir, 'a.py'), 'x = 1\n')
    let s = await git.status(dir)
    expect(s.repo).toBe(true)
    expect(s.files).toEqual([{ path: 'a.py', index: '.', work: '?' }])
    await git.stage(dir, ['a.py'])
    expect((await git.status(dir)).files[0].index).toBe('A')
    await git.unstage(dir, ['a.py'])
    expect((await git.status(dir)).files[0].work).toBe('?')
    await git.stage(dir, ['a.py'])
    const hash = await git.commit(dir, 'First')
    expect(hash).toMatch(/^[0-9a-f]{7}/)
    writeFileSync(join(dir, 'a.py'), 'x = 2\n')
    expect(await git.show(dir, 'a.py')).toBe('x = 1\n')
    expect(await git.diff(dir)).toContain('+x = 2')
    const b = await git.blame(dir, 'a.py')
    expect(b).toHaveLength(1)
    expect((await git.log(dir))[0].subject).toBe('First')
    await git.discard(dir, ['a.py'])
    expect(readFileSync(join(dir, 'a.py'), 'utf8')).toBe('x = 1\n')
    await git.checkout(dir, 'feature', true)
    expect((await git.branches(dir)).current).toBe('feature')
    await expect(git.checkout(dir, '--evil')).rejects.toThrow()
    s = await git.status(dir)
    expect(s.branch).toBe('feature')
  })

  it('says a plain folder is not a repository', async () => {
    expect((await git.status(project())).repo).toBe(false)
  })
})

/** A fake debug adapter on two streams */
function fakeAdapter(handle: (req: { seq: number; command: string; arguments: unknown }, send: (m: object) => void) => void) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const proc = Object.assign(new EventEmitter(), { stdin, stdout, kill: () => proc.emit('exit', 0) })
  let seq = 1
  const send = (m: object) => {
    const body = Buffer.from(JSON.stringify({ seq: seq++, ...m }))
    stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  let buf = Buffer.alloc(0)
  stdin.on('data', (c: Buffer) => {
    buf = Buffer.concat([buf, c])
    for (;;) {
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) break
      const len = Number(/Content-Length: (\d+)/.exec(buf.subarray(0, end).toString())![1])
      if (buf.length < end + 4 + len) break
      const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString())
      buf = buf.subarray(end + 4 + len)
      handle(msg, send)
    }
  })
  return proc
}

describe('the debug adapter client', () => {
  it('frames messages as the protocol says', () => {
    const b = encodeDap({ seq: 1, type: 'request', command: 'threads' })
    expect(b.toString()).toMatch(/^Content-Length: \d+\r\n\r\n\{"seq":1/)
  })

  it('starts a session in VS Code’s order and passes events on', async () => {
    const order: string[] = []
    const events: string[] = []
    const proc = fakeAdapter((req, send) => {
      order.push(req.command)
      const ok = (body: object = {}) => send({ type: 'response', request_seq: req.seq, command: req.command, success: true, body })
      if (req.command === 'initialize') ok({ supportsConfigurationDoneRequest: true, exceptionBreakpointFilters: [{ filter: 'uncaught' }] })
      else if (req.command === 'launch') {
        send({ type: 'event', event: 'initialized' })
        // debugpy answers the launch only after configurationDone
        setTimeout(() => ok(), 20)
      } else if (req.command === 'setBreakpoints') ok({ breakpoints: [{ verified: true, line: 3 }] })
      else if (req.command === 'configurationDone') {
        ok()
        send({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
      } else if (req.command === 'threads') ok({ threads: [{ id: 1, name: 'main' }] })
      else send({ type: 'response', request_seq: req.seq, command: req.command, success: false, message: 'nope' })
    })
    let initialized!: () => void
    const ready = new Promise<void>((r) => (initialized = r))
    const client = new DapClient(proc, {
      onEvent: (e) => {
        events.push(e)
        if (e === 'initialized') initialized()
      }
    })
    const r = await startSession(client, { adapterID: 'x', launch: { program: '/p/a.py' }, breakpoints: { '/p/a.py': [{ line: 3 }] }, exceptionFilters: ['uncaught'], initialized: ready })
    expect(order).toEqual(['initialize', 'launch', 'setBreakpoints', 'setExceptionBreakpoints', 'configurationDone'])
    expect(r.verified['/p/a.py']).toEqual([{ verified: true, line: 3 }])
    expect(events).toContain('stopped')
    expect(await client.request('threads')).toEqual({ threads: [{ id: 1, name: 'main' }] })
    await expect(client.request('evaluate', { expression: '1' })).rejects.toThrow('nope')
    proc.kill()
    await expect(client.request('threads')).rejects.toThrow(/isn’t running/)
  })

  it('answers the adapter’s own requests, refusing what Tide does not do', async () => {
    const answers: { success: boolean }[] = []
    const proc = fakeAdapter((m) => answers.push(m as unknown as { success: boolean }))
    new DapClient(proc, { onEvent: () => {} })
    const body = Buffer.from(JSON.stringify({ seq: 1, type: 'request', command: 'runInTerminal', arguments: {} }))
    proc.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
    await new Promise((r) => setTimeout(r, 20))
    expect(answers[0]).toMatchObject({ type: 'response', request_seq: 1, success: false })
  })
})

describe('the test explorer', () => {
  it('turns pytest items into a tree of files, classes and tests', () => {
    const t = pytestTree([
      { id: 'tests/test_a.py::test_one', path: 'tests/test_a.py', line: 3, name: 'test_one' },
      { id: 'tests/test_a.py::TestK::test_two', path: 'tests/test_a.py', line: 9, name: 'TestK.test_two' },
      { id: 'test_b.py::test_three[1]', path: 'test_b.py', line: 1, name: 'test_three[1]' }
    ])
    expect(t.map((n) => n.id)).toEqual(['test_b.py', 'tests/test_a.py'])
    const a = t[1]
    expect(a.children!.map((c) => c.label)).toEqual(['test_one', 'TestK'])
    expect(a.children![1].children![0]).toMatchObject({ id: 'tests/test_a.py::TestK::test_two', line: 9 })
  })

  it('reads cargo test and node --test output', () => {
    const cargo = 'running 2 tests\ntest tests::adds ... ok\ntest tests::fails ... FAILED\n\nfailures:\n\n---- tests::fails stdout ----\nassertion failed: 1 == 2\n\nfailures:\n    tests::fails\n\ntest result: FAILED'
    expect(parseCargo(cargo)).toEqual([
      { id: 'tests::adds', status: 'pass' },
      { id: 'tests::fails', status: 'fail', message: 'assertion failed: 1 == 2' }
    ])
    const tap = "TAP version 13\n# Subtest: adds\nok 1 - adds\n  ---\n  duration_ms: 1.5\n  ...\n# Subtest: breaks\nnot ok 2 - breaks\n  ---\n  duration_ms: 0.4\n  error: 'boom'\n  ...\n1..2"
    expect(parseTap(tap)).toEqual([
      { id: 'adds', status: 'pass', ms: 2 },
      { id: 'breaks', status: 'fail', ms: 0, message: "---\n  duration_ms: 0.4\n  error: 'boom'\n  ...\n1..2" }
    ])
  })
})

describe('the project sandbox', () => {
  it('runs a command on a copy: no writes to the project, no network', async () => {
    const dir = project()
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    const r = await shellInSandbox(dir, 'cat a.txt; echo changed > a.txt; cat a.txt; pwd')
    expect(r.stdout).toContain('hello')
    expect(r.stdout).toContain('changed')
    // The copy's path shows as the project's
    expect(r.stdout).toContain(dir)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello\n')
    const out = await shellInSandbox(dir, `echo x > ${JSON.stringify(join(dir, 'b.txt'))}`)
    expect(out.exitCode).not.toBe(0)
    const net = await inSandbox(dir, ['/usr/bin/curl', '-sS', '--max-time', '3', 'http://example.com'], { timeoutMs: 10_000 })
    expect(net.exitCode).not.toBe(0)
  })
})
