import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatMessage } from '../src/shared/types'
import type { LessonCodeEvent } from '../src/shared/ide'

const userData = realpathSync(mkdtempSync(join(tmpdir(), 'tide-lessoncode-ud-')))
const sent: LessonCodeEvent[] = []
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false },
  shell: { trashItem: vi.fn(), showItemInFolder: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [{ webContents: { isDestroyed: () => false, send: (_c: string, e: LessonCodeEvent) => sent.push(e) } }] }
}))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ libraryFolder: 'Library', ai: { claude: {} } }), updateSettings: () => {} }))
vi.mock('../src/main/claudeCli', async (orig) => ({ ...(await orig<object>()), checkClaude: async () => ({ installed: true, loggedIn: true, checkedAt: Date.now() }) }))
vi.mock('../src/main/agent', () => {
  let n = 0
  return {
    MCP_TUTOR_TOOLS: [{ type: 'function', function: { name: 'run_code', description: 'Run code', parameters: { type: 'object', properties: {} } } }],
    runTideTool: async () => 'ran',
    nextStepId: () => `s${++n}`,
    stablePrompt: async (base: string) => `SYSTEM ${base.length}`,
    buildTurn: async (req: { messages: ChatMessage[] }, emit: (e: ChatEvent) => void, _s: AbortSignal, base: string) => ({
      ctx: { sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {} },
      messages: [{ role: 'system', content: `SYSTEM ${base.length}` }, ...req.messages],
      images: [],
      emit
    })
  }
})

const shared = await import('../src/shared/lessonCode')
const { sessionInstructions } = await import('../src/shared/session')
const ws = await import('../src/main/ide/workspace')
const pair = await import('../src/main/ide/pair')
const lesson = await import('../src/main/ide/lesson')
const mcp = await import('../src/main/tideMcp')
const engine = await import('../src/main/claudeEngine')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude.mjs'))
afterAll(() => engine.stopClaude())

let n = 0
const ctxFor = (labId: string) => ({ signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {}, web: false, labId, chatId: undefined })
const tools = (labId: string) => {
  const list = lesson.lessonTools(labId)
  return (name: string, args: Record<string, unknown>) => list.find((t) => t.name === name)!.run(args, ctxFor(labId))
}
const names = async (key: string) => (await mcp.toolsFor(key)).map((t) => t.name)

describe('which lessons are coding lessons', () => {
  it('is a teach session on something learnt by building', () => {
    expect(shared.isCodingLesson({ mode: 'teach', topic: 'Python functions' })).toBe(true)
    expect(shared.isCodingLesson({ mode: 'teach', topic: 'The causes of the French Revolution' })).toBe(false)
    expect(shared.isCodingLesson({ mode: 'quiz', topic: 'Python functions' })).toBe(false)
    expect(shared.isCodingLesson({ mode: 'teach', topic: 'Anything', options: { strategy: 'code' } })).toBe(true)
    expect(shared.isCodingLesson({ mode: 'teach', topic: 'Our API', options: { codeRoot: '/x' } })).toBe(true)
  })

  it('answers each code question in its own file', () => {
    expect(shared.exerciseFile(2, 'python')).toBe('exercise-2.py')
    expect(shared.exerciseFile(1, 'TypeScript')).toBe('exercise-1.ts')
    expect(shared.exerciseNumber(['a', 'b'], 'b')).toBe(2)
    expect(shared.exerciseNumber(['a', 'b'], 'c')).toBe(3)
  })
})

describe("a coding lesson's folder and its tools", () => {
  it('lives under Tide’s data, and the IDE may open it', () => {
    const l = lesson.lessonWorkspace('lesson:a', 'Python functions')
    expect(l.root.startsWith(join(userData, 'ide', 'lessons'))).toBe(true)
    expect(l.root).toMatch(/python-functions-[0-9a-f]{10}$/)
    expect(existsSync(l.root)).toBe(true)
    expect(ws.allowed(l.root)).toBe(l.root)
    // The same lesson, the same folder
    expect(lesson.lessonWorkspace('lesson:a', 'Python functions').root).toBe(l.root)
    expect(lesson.lessonWorkspace('lesson:b', 'Python functions').root).not.toBe(l.root)
    // Nothing beside the lessons' folder is let in that way
    expect(() => ws.allowed(join(userData, 'ide'))).toThrow()
  })

  it('reads, searches and runs only inside the folder', async () => {
    const l = lesson.lessonWorkspace('lesson:read', 'Python functions')
    writeFileSync(join(l.root, 'exercise-1.py'), 'def add(a, b):\n    return a - b\n')
    const run = tools('lesson:read')
    expect(await run('list_files', {})).toContain('exercise-1.py')
    expect(await run('read_file', { path: 'exercise-1.py' })).toContain('2      return a - b')
    await expect(run('read_file', { path: '../../claude-usage.jsonl' })).rejects.toThrow(/outside/)
    const out = await run('run_command', { command: 'echo changed > exercise-1.py; cat exercise-1.py' })
    expect(out).toContain('changed')
    expect(readFileSync(join(l.root, 'exercise-1.py'), 'utf8')).toContain('a - b')
  })

  it('proposes an edit as a diff for the lesson, writing nothing until it is kept, and tells the tutor what became of it', async () => {
    const l = lesson.lessonWorkspace('lesson:prop', 'Python functions')
    writeFileSync(join(l.root, 'exercise-1.py'), 'def add(a, b):\n    return a - b\n')
    // Off by default: "let Claude edit" is the learner's to turn on
    expect(pair.autoEdit(l.root)).toBe(false)
    sent.length = 0
    const r = await tools('lesson:prop')('propose_edit', { path: 'exercise-1.py', old_string: 'a - b', new_string: 'a + b', explanation: 'add, not subtract' })
    expect(r).toMatch(/nothing is written/)
    expect(readFileSync(join(l.root, 'exercise-1.py'), 'utf8')).toContain('a - b')
    const p = sent.find((e) => e.type === 'proposal')
    expect(p).toMatchObject({ labId: 'lesson:prop', type: 'proposal', proposal: { path: 'exercise-1.py', root: l.root } })
    if (p?.type !== 'proposal') throw new Error('no proposal')
    pair.resolve(p.proposal.id, 'def add(a, b):\n    return a + b\n')
    expect(lesson.lessonTurnNote('lesson:prop', 'exercise-1.py')).toBe('(Tide: their editor shows exercise-1.py; the learner kept your change to exercise-1.py.)')
    // Told once
    expect(lesson.lessonTurnNote('lesson:prop', 'exercise-1.py')).toBe('(Tide: their editor shows exercise-1.py.)')
  })

  it('writes straight to disk only when the learner lets Claude edit the folder', async () => {
    const l = lesson.lessonWorkspace('lesson:auto', 'Python functions')
    sent.length = 0
    expect(await tools('lesson:auto')('write_file', { path: 'helper.py', content: 'x = 1\n' })).toMatch(/Proposed/)
    expect(existsSync(join(l.root, 'helper.py'))).toBe(false)
    pair.autoEdit(l.root, true)
    expect(await tools('lesson:auto')('write_file', { path: 'helper.py', content: 'x = 1\n' })).toMatch(/Written/)
    expect(readFileSync(join(l.root, 'helper.py'), 'utf8')).toBe('x = 1\n')
    pair.autoEdit(l.root, false)
  })

  it('puts review comments in the lesson, and opens a file at a line', async () => {
    lesson.lessonWorkspace('lesson:rev', 'Python functions')
    sent.length = 0
    await tools('lesson:rev')('add_review_comment', { path: 'exercise-1.py', line: 2, severity: 'issue', body: 'This subtracts.' })
    await tools('lesson:rev')('open_in_editor', { path: 'exercise-1.py', line: 2 })
    expect(sent.map((e) => e.type)).toEqual(['comment', 'opened'])
    expect(sent[0]).toMatchObject({ labId: 'lesson:rev', comment: { path: 'exercise-1.py', line: 2, severity: 'issue' } })
  })

  it('keeps review comments and pending proposals across a reload, dropping or moving them when the code changed', async () => {
    const l = lesson.lessonWorkspace('lesson:keep', 'Python functions')
    const file = join(l.root, 'exercise-1.py')
    writeFileSync(file, 'def add(a, b):\n    return a - b\n')
    await tools('lesson:keep')('add_review_comment', { path: 'exercise-1.py', line: 2, severity: 'issue', body: 'This subtracts.' })
    await tools('lesson:keep')('propose_edit', { path: 'exercise-1.py', old_string: 'a - b', new_string: 'a + b', explanation: 'add' })
    // A reload (or a restart): nothing in memory, all of it read back
    pair.forgetReview()
    let r = pair.reviewOf(l.root)
    expect(r.comments).toMatchObject([{ path: 'exercise-1.py', line: 2, anchor: 'return a - b', body: 'This subtracts.' }])
    expect(r.proposals).toMatchObject([{ path: 'exercise-1.py', proposed: 'def add(a, b):\n    return a + b\n' }])
    // The learner added a line above it while Tide was closed: the comment follows its line, the proposal (against the old text) goes
    writeFileSync(file, '# adds two numbers\ndef add(a, b):\n    return a - b\n')
    pair.forgetReview()
    r = pair.reviewOf(l.root)
    expect(r.comments.map((c) => c.line)).toEqual([3])
    expect(r.proposals).toEqual([])
    // The line itself is gone: so is its comment
    writeFileSync(file, 'def add(a, b):\n    return b + a\n')
    pair.forgetReview()
    expect(pair.reviewOf(l.root).comments).toEqual([])
    // Dismissed stays dismissed
    await tools('lesson:keep')('add_review_comment', { path: 'exercise-1.py', line: 1, severity: 'praise', body: 'Good name.' })
    const id = pair.reviewOf(l.root).comments[0].id
    pair.dismissComment(id)
    pair.forgetReview()
    expect(pair.reviewOf(l.root).comments).toEqual([])
  })

  it('a kept proposal takes its file’s comments with it, after a reload too', async () => {
    const l = lesson.lessonWorkspace('lesson:keep2', 'Python functions')
    writeFileSync(join(l.root, 'exercise-1.py'), 'x = 1\n')
    await tools('lesson:keep2')('add_review_comment', { path: 'exercise-1.py', line: 1, body: 'Name it.' })
    sent.length = 0
    await tools('lesson:keep2')('propose_edit', { path: 'exercise-1.py', old_string: 'x = 1', new_string: 'count = 1', explanation: 'a name' })
    const p = sent.find((e) => e.type === 'proposal')
    if (p?.type !== 'proposal') throw new Error('no proposal')
    pair.resolve(p.proposal.id, 'count = 1\n')
    pair.forgetReview()
    expect(pair.reviewOf(l.root)).toEqual({ proposals: [], comments: [] })
  })

  it('plants a bug without a diff, only in the lesson’s own files', async () => {
    const l = lesson.lessonWorkspace('lesson:bug', 'Python functions')
    writeFileSync(join(l.root, 'exercise-1.py'), 'def mean(xs):\n    return sum(xs) / len(xs)\n')
    sent.length = 0
    const r = await tools('lesson:bug')('plant_bug', { path: 'exercise-1.py', old_string: 'len(xs)', new_string: '(len(xs) - 1)', bug: 'off by one in the divisor' })
    expect(r).toMatch(/Don't say where/)
    expect(readFileSync(join(l.root, 'exercise-1.py'), 'utf8')).toContain('(len(xs) - 1)')
    expect(sent).toEqual([{ labId: 'lesson:bug', type: 'opened', root: l.root, path: 'exercise-1.py', planted: true }])
    await expect(tools('lesson:bug')('plant_bug', { path: '../x.py', content: 'x', bug: 'b' })).rejects.toThrow(/outside/)
  })

  it('works in a linked project’s folder, with git, and never plants a bug there', async () => {
    const proj = realpathSync(mkdtempSync(join(tmpdir(), 'tide-lessoncode-proj-')))
    ws.remember(proj)
    mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src', 'app.py'), 'print(1)\n')
    execFileSync('git', ['init', '-q'], { cwd: proj })
    const l = lesson.lessonWorkspace('lesson:linked', 'Our app', proj)
    expect(l).toMatchObject({ root: proj, linked: true })
    const list = lesson.lessonTools('lesson:linked').map((t) => t.name)
    expect(list).toContain('git_diff')
    expect(list).not.toContain('plant_bug')
    expect(await tools('lesson:linked')('read_file', { path: 'src/app.py' })).toContain('print(1)')
    // A folder the IDE was never given isn't one
    expect(() => lesson.lessonWorkspace('lesson:linked2', 'x', join(tmpdir(), 'nope-' + Date.now()))).toThrow()
  })

  it('has no tools at all for a lesson without a folder', async () => {
    await expect(tools('lesson:none')('list_files', {})).rejects.toThrow(/No project or lesson/)
  })
})

describe('which callers get the code tools', () => {
  it('a coding lesson gets the tutor’s tools and the code tools; a chat or another lesson gets neither code tool', async () => {
    lesson.lessonWorkspace('lesson:gate', 'Python functions')
    const coding = await names('code:lesson:gate:web')
    expect(coding).toEqual(expect.arrayContaining(['run_code', 'read_file', 'run_tests', 'propose_edit', 'write_file', 'add_review_comment', 'plant_bug', 'get_diagnostics', 'open_in_editor']))
    expect(coding).not.toContain('git_diff')
    for (const key of ['chat:abc', 'lab:lesson:gate', 'lab:lesson:gate:web', 'thread:lesson:gate', 'first:x', '']) {
      const list = await names(key)
      expect(list).toContain('run_code')
      expect(list.filter((x) => ['read_file', 'propose_edit', 'write_file', 'run_command', 'plant_bug', 'add_review_comment'].includes(x))).toEqual([])
    }
    const ide = await names('ide:s1')
    expect(ide).toContain('propose_edit')
    expect(ide).not.toContain('run_code')
    expect(ide).not.toContain('plant_bug')
  })

  it('the IDE’s Claude teaches as the tutor does in a lesson’s folder', () => {
    expect(shared.IDE_LESSON_NOTE).toMatch(/review/)
  })
})

describe('a coding lesson on Claude', () => {
  const say = (messages: ChatMessage[], extra: Record<string, unknown>) => {
    const events: ChatEvent[] = []
    return engine.claudeTurn({ id: `r${Math.random()}`, messages, scope: { kind: 'none' }, session: true, topic: 'Python functions', ...extra } as never, (e) => events.push(e), new AbortController().signal)
  }

  it('runs under its own key, with the code rules in its system prompt and the file on screen with each message', async () => {
    const r = await say([{ role: 'user', content: 'teach me [tail]' }], { labId: 'lesson:claude1', codeLesson: { file: 'exercise-1.py' } })
    expect(engine.liveClaude().some((p) => p.key === 'code:lesson:claude1:web')).toBe(true)
    expect(r).toContain('(Tide: their editor shows exercise-1.py.)')
    expect(r).toContain('plant_bug writes one realistic bug')
    const config = /\[config ([^\]]+)\]/.exec(r)![1]
    expect(JSON.parse(readFileSync(config, 'utf8')).mcpServers.tide.headers['X-Tide-Lesson']).toBe('code:lesson:claude1:web')
    expect(lesson.lessonOf('lesson:claude1')?.root).toBeTruthy()
  })

  it('an ordinary lesson is as before: its own key, no code rules', async () => {
    const r = await say([{ role: 'user', content: 'teach me [tail]' }], { labId: 'lesson:plain1' })
    expect(engine.liveClaude().some((p) => p.key === 'lab:lesson:plain1:web')).toBe(true)
    expect(r).not.toContain('plant_bug')
    expect(r).not.toContain('their editor shows')
  })

  it('a work project’s coding lesson goes to Claude like any other', async () => {
    expect(await say([{ role: 'user', content: 'x' }], { labId: 'lesson:work1', codeLesson: { file: 'exercise-1.py' }, scope: { kind: 'folder', path: 'Secret project' } })).toBeTruthy()
  })

  it('runs the learner’s code itself before judging it when asked to check it, and is sent back to run it when it didn’t', async () => {
    // It ran the tests (run_tests) before answering: one message, with the run-first note on it
    const ran = await say([{ role: 'user', content: 'can you check my code [runs] [tail]' }], { labId: 'lesson:run1', codeLesson: { file: 'exercise-1.py' } })
    expect(ran).toContain(shared.RUN_FIRST_NOTE)
    expect(ran).not.toContain('you judged their code without running it')
    // It judged without running: Tide sends it back to run the code, in the same reply
    const skipped = await say([{ role: 'user', content: 'is my code right?' }], { labId: 'lesson:run2', codeLesson: { file: 'exercise-1.py' } })
    expect(skipped).toMatch(/turn 1 [\s\S]*turn 2 [\s\S]*heard: \(Tide: you judged their code without running it/)
    // An answer to a code question counts too, marker or not
    const ask = { role: 'assistant' as const, content: 'Write add(a, b). <ask type="code">Your code</ask>' }
    const answered = await say([{ role: 'user', content: 'start' }, ask, { role: 'user', content: 'def add(a, b): return a + b [runs] [tail]' }], { labId: 'lesson:run3', codeLesson: { file: 'exercise-1.py' } })
    expect(answered).toContain(shared.RUN_FIRST_NOTE)
    // An ordinary message isn't sent back, and a lesson without code is as before
    const plain = await say([{ role: 'user', content: 'teach me closures' }], { labId: 'lesson:run4', codeLesson: { file: 'exercise-1.py' } })
    expect(plain).not.toContain('turn 2')
    const other = await say([{ role: 'user', content: 'can you check my essay [tail]' }], { labId: 'lesson:run5' })
    expect(other).not.toContain(shared.RUN_FIRST_NOTE)
    expect(other).not.toContain('turn 2')
  })

  it('knows a request to run or check the code from an ordinary message', () => {
    for (const t of ['run it', 'can you check this?', 'review my solution', 'does my code work', 'why does this fail', 'what’s wrong with it', "what's wrong"]) expect(shared.asksToRunCode(t), t).toBe(true)
    for (const t of ['teach me closures', 'test me on loops', 'go on', 'what is a decorator']) expect(shared.asksToRunCode(t), t).toBe(false)
  })

  it('keeps the rules short, for the prompt cache, and leaves what Gemma is told alone', () => {
    expect(shared.CLAUDE_CODE_LESSON_NOTE.length).toBeLessThan(1400)
    for (const tool of ['read_file', 'run_command', 'run_tests', 'get_diagnostics', 'add_review_comment', 'propose_edit', 'plant_bug', 'open_in_editor']) expect(shared.CLAUDE_CODE_LESSON_NOTE).toContain(tool)
    expect(shared.CLAUDE_CODE_LESSON_NOTE).toMatch(/before you judge/)
    expect(sessionInstructions({ mode: 'teach', topic: 'Python functions' })).not.toMatch(/plant_bug|propose_edit|exercise-N/)
    expect(engine.lessonKey({ labId: 'l', session: true, messages: [] })).toBe('lab:l')
    expect(engine.lessonKey({ labId: 'l', session: true, messages: [], codeLesson: {} })).toBe('code:l')
    // A side thread never gets them
    expect(engine.lessonKey({ labId: 'l', session: true, messages: [], codeLesson: {}, thread: 't' })).toBe('thread:l')
  })
})
