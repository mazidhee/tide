import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { countsAsSave, editorFor, openArgs, saveNotice, since, type InstalledEditor } from '../src/shared/editor'
import type { StageRun } from '../src/shared/workshop'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null }, ipcMain: { handle: () => {} }, Notification: class {}, app: { getPath: () => tmpdir() } }))

const { detectEditors, openFolder, prepareFolder } = await import('../src/main/editors')
const { SaveWatcher, folderSignature, exclusive } = await import('../src/main/workshopWatch')

const ed = (id: InstalledEditor['id'], name: string, bundleId = `b.${id}`): InstalledEditor => ({ id, name, bundleId, path: `/Applications/${name}.app` })

describe('finding editors', () => {
  it('finds editors by bundle id through Spotlight, preferring a copy in Applications', async () => {
    const seen: string[] = []
    const found = await detectEditors({
      mdfind: async (id) => {
        seen.push(id)
        if (id === 'com.jetbrains.pycharm') return ['/Users/me/Downloads/PyCharm.app', '/Applications/PyCharm.app']
        if (id === 'dev.zed.Zed') return ['/Users/me/.Trash/Zed.app']
        return []
      },
      exists: () => false,
      home: '/Users/me'
    })
    expect(found).toEqual([{ id: 'pycharm', name: 'PyCharm', bundleId: 'com.jetbrains.pycharm', path: '/Applications/PyCharm.app' }])
    expect(seen).toContain('com.microsoft.VSCode')
    expect(seen).toContain('com.jetbrains.CLion')
  })

  it('falls back to /Applications and ~/Applications when Spotlight has nothing', async () => {
    const paths = new Set(['/Applications/Visual Studio Code.app', '/Users/me/Applications/CLion.app'])
    const found = await detectEditors({ mdfind: async () => [], exists: (p) => paths.has(p), home: '/Users/me' })
    expect(found.map((e) => [e.id, e.bundleId, e.path])).toEqual([
      ['vscode', 'com.microsoft.VSCode', '/Applications/Visual Studio Code.app'],
      ['clion', 'com.jetbrains.CLion', '/Users/me/Applications/CLion.app']
    ])
  })

  it('takes a Spotlight failure as nothing found', async () => {
    expect(await detectEditors({ mdfind: async () => Promise.reject(new Error('no')), exists: () => false, home: '/x' })).toEqual([])
  })
})

describe('choosing the editor', () => {
  const all = [ed('pycharm', 'PyCharm'), ed('vscode', 'VS Code'), ed('clion', 'CLion'), ed('zed', 'Zed')]
  it('uses the one picked in Settings when it is installed', () => {
    expect(editorFor(all, ['c'], 'zed')?.id).toBe('zed')
    expect(editorFor([ed('pycharm', 'PyCharm')], ['python'], 'sublime')?.id).toBe('pycharm')
  })
  it('picks by language: CLion for C and C++, PyCharm for Python, VS Code otherwise', () => {
    expect(editorFor(all, ['c'])?.id).toBe('clion')
    expect(editorFor(all, ['cpp', 'python'])?.id).toBe('clion')
    expect(editorFor(all, ['python'])?.id).toBe('pycharm')
    expect(editorFor(all, ['sql'])?.id).toBe('vscode')
    expect(editorFor([ed('pycharm-ce', 'PyCharm CE'), ed('vscode', 'VS Code')], ['python'])?.id).toBe('pycharm-ce')
  })
  it('falls back to the first found, PyCharm first, and to nothing with nothing installed', () => {
    expect(editorFor([ed('zed', 'Zed'), ed('pycharm', 'PyCharm')], ['c'])?.id).toBe('pycharm')
    expect(editorFor([ed('zed', 'Zed')], ['javascript'])?.id).toBe('zed')
    expect(editorFor([], ['python'])).toBeNull()
  })
})

describe('opening a folder', () => {
  it('runs open -b with the folder as one argument, never through a shell', async () => {
    const calls: [string, string[]][] = []
    const folder = "/Users/me/Notes/Code/A key-value store; rm -rf ~ 'x'"
    await openFolder({ bundleId: 'com.jetbrains.pycharm' }, folder, async (f, a) => calls.push([f, a]))
    expect(calls).toEqual([['/usr/bin/open', ['-b', 'com.jetbrains.pycharm', folder]]])
    expect(openArgs('dev.zed.Zed', '/a b')).toEqual(['-b', 'dev.zed.Zed', '/a b'])
  })

  it('writes .vscode/settings.json only for VS Code or Cursor, and never over the learner’s own', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tide-editor-'))
    try {
      expect(await prepareFolder({ id: 'pycharm' }, dir, '/py')).toBe(false)
      expect(existsSync(join(dir, '.idea'))).toBe(false)
      expect(await prepareFolder({ id: 'vscode' }, dir, null)).toBe(false)
      expect(await prepareFolder({ id: 'vscode' }, dir, '/tide/python/bin/python')).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, '.vscode/settings.json'), 'utf8'))).toEqual({ 'python.defaultInterpreterPath': '/tide/python/bin/python' })
      writeFileSync(join(dir, '.vscode/settings.json'), '{"mine": true}')
      expect(await prepareFolder({ id: 'cursor' }, dir, '/other')).toBe(false)
      expect(readFileSync(join(dir, '.vscode/settings.json'), 'utf8')).toBe('{"mine": true}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('which saves count', () => {
  it('counts source and data files', () => {
    for (const p of ['kv.py', 'src/kv.py', 'main.c', 'lib.h', 'tree.cpp', 'ledger.sql', 'data.csv', 'index.js', 'conf.toml']) expect(countsAsSave(p), p).toBe(true)
  })
  it('ignores editor scratch, config folders, caches and briefs', () => {
    for (const p of [
      '.idea/workspace.xml',
      '.vscode/settings.json',
      '__pycache__/kv.cpython-312.pyc',
      '.git/index',
      'node_modules/x/index.js',
      'kv.py~',
      '.kv.py.swp',
      'kv.py.swx',
      '4913',
      'kv.py___jb_tmp___',
      'kv.py___jb_old___',
      '.#kv.py',
      '#kv.py#',
      '.DS_Store',
      'STAGE-2.md',
      'README.md',
      'kv.pyc',
      null,
      ''
    ])
      expect(countsAsSave(p), String(p)).toBe(false)
  })
})

const run = (tests: [string, 'pass' | 'fail', string?][], o: Partial<StageRun> = {}): StageRun => ({
  at: 1,
  stage: 's1',
  passed: tests.every(([, s]) => s === 'pass'),
  tests: tests.map(([name, status, message]) => ({ stage: 's1', name, status, ...(message ? { message } : {}) })),
  durationMs: 10,
  ...o
})

describe('when a run on a save is worth a notification', () => {
  const base = { project: 'KV', stageNumber: 1 }
  it('says nothing while Tide is in front', () => {
    expect(saveNotice({ ...base, before: run([['a', 'fail']]), after: run([['a', 'pass']]), focused: true })).toBeNull()
  })
  it('tells when the stage newly passes', () => {
    expect(saveNotice({ ...base, before: run([['a', 'fail']]), after: run([['a', 'pass']]), focused: false })).toEqual({ title: 'KV', body: 'Stage 1 passes. Every test passes.' })
    expect(saveNotice({ ...base, before: null, after: run([['a', 'pass']]), focused: false })?.body).toMatch(/passes/)
    expect(saveNotice({ ...base, before: run([['a', 'pass']]), after: run([['a', 'pass']]), focused: false })).toBeNull()
  })
  it('tells of a new failure, by the first failing test’s name', () => {
    const n = saveNotice({ ...base, before: run([['a', 'pass'], ['b', 'fail']]), after: run([['a', 'fail', 'got 2'], ['b', 'fail']]), focused: false })
    expect(n).toEqual({ title: 'KV', body: '“a” fails: got 2' })
    expect(saveNotice({ ...base, before: run([['a', 'pass'], ['b', 'pass']]), after: run([['a', 'pass'], ['b', 'fail']]), focused: false })?.body).toBe('“b” fails.')
  })
  it('stays quiet for the same failures again, or a first run that fails', () => {
    expect(saveNotice({ ...base, before: run([['a', 'fail'], ['b', 'fail']]), after: run([['a', 'fail', 'x'], ['b', 'pass']]), focused: false })).toBeNull()
    expect(saveNotice({ ...base, before: undefined, after: run([['a', 'fail']]), focused: false })).toBeNull()
  })
  it('tells when the code stops running, once', () => {
    expect(saveNotice({ ...base, before: run([['a', 'fail']]), after: run([], { error: 'SyntaxError', passed: false }), focused: false })?.body).toMatch(/Nothing ran/)
    expect(saveNotice({ ...base, before: run([], { error: 'SyntaxError', passed: false }), after: run([], { error: 'SyntaxError', passed: false }), focused: false })).toBeNull()
  })
})

describe('since', () => {
  it('counts seconds while recent', () => {
    expect(since(0, 2000)).toBe('just now')
    expect(since(0, 12_000)).toBe('12 s ago')
    expect(since(0, 61_000)).toBe('a minute ago')
    expect(since(0, 5 * 60_000)).toBe('5 min ago')
  })
})

describe('the watcher', () => {
  const dirs: string[] = []
  const temp = () => {
    const d = mkdtempSync(join(tmpdir(), 'tide-watch-'))
    dirs.push(d)
    return d
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  afterEach(() => {
    vi.useRealTimers()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('runs once after a burst of saves settles, and ignores scratch files (a real folder)', async () => {
    const dir = temp()
    let runs = 0
    const w = new SaveWatcher(dir, async () => void runs++, { delayMs: 150 }).start()
    try {
      await wait(100)
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(dir, 'kv.py'), `x = ${i}\n`)
        await wait(20)
      }
      await wait(500)
      expect(runs).toBe(1)
      mkdirSync(join(dir, '.idea'))
      writeFileSync(join(dir, '.idea', 'workspace.xml'), '<x/>')
      writeFileSync(join(dir, '.kv.py.swp'), 'swap')
      writeFileSync(join(dir, 'kv.py___jb_tmp___'), 'tmp')
      mkdirSync(join(dir, '__pycache__'))
      writeFileSync(join(dir, '__pycache__', 'kv.cpython-312.pyc'), 'pyc')
      await wait(500)
      expect(runs).toBe(1)
      writeFileSync(join(dir, 'kv.py'), 'x = 99\n')
      await wait(500)
      expect(runs).toBe(2)
    } finally {
      w.close()
    }
    writeFileSync(join(dir, 'kv.py'), 'after close\n')
    await wait(400)
    expect(runs).toBe(2)
  })

  it('debounces: each save restarts the wait', () => {
    vi.useFakeTimers()
    let runs = 0
    const w = new SaveWatcher('/nowhere', async () => void runs++, { delayMs: 600 })
    w.changed('kv.py')
    vi.advanceTimersByTime(500)
    w.changed('kv.py')
    vi.advanceTimersByTime(500)
    expect(runs).toBe(0)
    vi.advanceTimersByTime(100)
    expect(runs).toBe(1)
    w.changed('.idea/workspace.xml')
    vi.advanceTimersByTime(1000)
    expect(runs).toBe(1)
    w.close()
  })

  it('coalesces saves during a run into one more run, never two at once', async () => {
    vi.useFakeTimers()
    let running = 0
    let most = 0
    let runs = 0
    const finish: (() => void)[] = []
    const w = new SaveWatcher(
      '/nowhere',
      () =>
        new Promise<void>((resolve) => {
          running++
          runs++
          most = Math.max(most, running)
          finish.push(() => {
            running--
            resolve()
          })
        }),
      { delayMs: 600 }
    )
    w.changed('kv.py')
    vi.advanceTimersByTime(600)
    expect(runs).toBe(1)
    // A storm of autosaves while the tests run
    for (let i = 0; i < 10; i++) {
      w.changed('kv.py')
      vi.advanceTimersByTime(700)
    }
    expect(runs).toBe(1)
    finish.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toBe(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(runs).toBe(2)
    finish.shift()!()
    await vi.advanceTimersByTimeAsync(5000)
    expect(runs).toBe(2)
    expect(most).toBe(1)
    w.close()
  })

  it('the signature changes with a source file, not with scratch or config', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'kv.py'), 'a')
    const one = await folderSignature(dir)
    mkdirSync(join(dir, '.idea'))
    writeFileSync(join(dir, '.idea', 'misc.xml'), 'x')
    writeFileSync(join(dir, 'kv.py~'), 'b')
    writeFileSync(join(dir, 'STAGE-1.md'), 'brief')
    expect(await folderSignature(dir)).toBe(one)
    writeFileSync(join(dir, 'kv.py'), 'b')
    expect(await folderSignature(dir)).not.toBe(one)
  })

  it('runs of one project wait their turn', async () => {
    const order: string[] = []
    const slow = exclusive('p', async () => {
      order.push('a start')
      await wait(30)
      order.push('a end')
    })
    const fast = exclusive('p', async () => void order.push('b'))
    await Promise.all([slow, fast])
    expect(order).toEqual(['a start', 'a end', 'b'])
  })
})
