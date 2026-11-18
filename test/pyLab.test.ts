// @vitest-environment happy-dom
/**
 * The Python lab: the tracer's "ops" mode on real Python (main/pyTrace.py), the stepping and
 * diffing it is replayed with (shared/pyLab), the block in tutor text (renderer lib/pyLab), and
 * the line that tells a Python lesson's tutor about it (shared/subjects).
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { changesAt, heapAt, isLabFence, LAB_STARTERS, lineCount, opAt, opcodeNote, opsByLine, PYTHON_LAB_LINE, startsLine, starterFor, stepFrom } from '../src/shared/pyLab'
import { cleanTrace, MAX_LAB_STEPS, type PyTrace } from '../src/shared/pyTrace'
import { lessonKit } from '../src/shared/subjects'
import { pyLabBlock } from '../src/renderer/src/lib/pyLab'

const dir = mkdtempSync(join(tmpdir(), 'tide-pylab-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
/** A program traced as the lab traces it: one step per instruction */
function trace(code: string): PyTrace {
  const name = `p${n++}`
  writeFileSync(join(dir, `${name}.py`), code)
  execFileSync('python3', ['-I', resolve('src/main/pyTrace.py'), join(dir, `${name}.py`), join(dir, `${name}.json`), 'ops'], { timeout: 15_000 })
  return cleanTrace(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')), MAX_LAB_STEPS)!
}

const starter = (id: string) => LAB_STARTERS.find((s) => s.id === id)!
const lines = (t: PyTrace) => t.steps.map((s, i) => (startsLine(t.steps, i) ? s.frames.at(-1)!.line : null)).filter((l) => l !== null)

describe('the tracer, one bytecode instruction at a time', () => {
  it('traces every starter program to the end, with each frame on an instruction of its disassembled code', () => {
    for (const s of LAB_STARTERS) {
      const t = trace(s.code)
      expect(t.ok, s.id).toBe(true)
      expect(t.error, s.id).toBeUndefined()
      expect(t.stopped, s.id).toBeUndefined()
      expect(t.version).toMatch(/^3\.\d+\.\d+$/)
      expect(t.codes!.length, s.id).toBeGreaterThan(0)
      expect(t.steps.some((st) => st.event === 'opcode'), s.id).toBe(true)
      for (let i = 0; i < t.steps.length; i++)
        for (let d = 0; d < t.steps[i].frames.length; d++) {
          const where = opAt(t, i, d)
          expect(where, `${s.id} step ${i}`).not.toBeNull()
          expect(where!.code.ops[where!.index][0]).toBe(t.steps[i].frames[d].at)
        }
    }
  })

  it('pushes a frame per call: fact(4) is four frames over the module at its deepest', () => {
    const t = trace(starter('frames').code)
    expect(Math.max(...t.steps.map((s) => s.frames.length))).toBe(5)
    expect(t.codes!.map((c) => c.name)).toEqual(['module', 'fact'])
    const ret = t.steps.filter((s) => s.event === 'return' && s.frames.length > 1)
    expect(ret.map((s) => heapAt(t, t.steps.indexOf(s)).get(s.ret!)?.v)).toEqual(['1', '2', '6', '24'])
    expect(t.steps.at(-1)!.out).toBe('24\n')
  })

  it('shows what the bytecode really is: a for loop has GET_ITER, FOR_ITER and a backward jump', () => {
    const t = trace(starter('loop').code)
    const names = t.codes![0].ops.map((o) => o[1])
    for (const op of ['GET_ITER', 'FOR_ITER', 'JUMP_BACKWARD']) expect(names).toContain(op)
    // A jump lands somewhere: the loop's head is marked as a jump target
    expect(t.codes![0].ops.some((o) => o[4] === 1)).toBe(true)
    const groups = opsByLine(t.codes![0])
    expect(groups.map((g) => g.line).filter(Boolean)).toEqual(expect.arrayContaining([1, 2, 3, 4]))
    expect(groups.flatMap((g) => g.ops).length).toBe(t.codes![0].ops.length)
  })

  it('keeps a visual’s trace as it was: a step per line, no bytecode', () => {
    writeFileSync(join(dir, 'lines.py'), 'a = 1\nb = a + 1\n')
    execFileSync('python3', ['-I', resolve('src/main/pyTrace.py'), join(dir, 'lines.py'), join(dir, 'lines.json')], { timeout: 10_000 })
    const t = cleanTrace(JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8')))!
    expect(t.codes).toBeUndefined()
    expect(t.steps.every((s) => s.event !== 'opcode' && s.frames.every((f) => f.code === undefined))).toBe(true)
  })

  it('says where a program failed, and still gives the steps before it', () => {
    const t = trace('xs = [1]\ny = xs[3]\n')
    expect(t.ok).toBe(true)
    expect(t.error).toMatch(/IndexError/)
    expect(t.steps.some((s) => s.exc?.startsWith('IndexError'))).toBe(true)
    const bad = cleanTrace({ code: 'x', ok: false, error: 'SyntaxError: invalid syntax (line 1)', steps: [], objects: [] })!
    expect(bad.ok).toBe(false)
  })
})

describe('stepping (shared/pyLab)', () => {
  it('steps a line at a time forwards and back, through calls and returns', () => {
    const t = trace(starter('frames').code)
    const ls = lines(t)
    // def, the call, into fact at its first line (n <= 1), then on to the recursive call
    expect(ls.slice(0, 4)).toEqual([1, 6, 2, 4])
    const forward: number[] = [0]
    for (let i = 0; forward.length < 400; ) {
      const j = stepFrom(t.steps, i, 'line', 1)
      if (j === i) break
      forward.push((i = j))
    }
    expect(forward.length).toBe(lineCount(t.steps, 0).of)
    expect(forward.at(-1)).toBe(t.steps.length - 1)
    // Back from each line step lands on the one before
    for (let k = forward.length - 1; k > 0; k--) expect(stepFrom(t.steps, forward[k], 'line', -1)).toBe(forward[k - 1])
    expect(lineCount(t.steps, forward[3])).toEqual({ at: 4, of: forward.length })
  })

  it('steps one instruction at a time, and stops at the ends', () => {
    const t = trace('x = 1\n')
    expect(stepFrom(t.steps, 0, 'op', 1)).toBe(1)
    expect(stepFrom(t.steps, 0, 'op', -1)).toBe(0)
    expect(stepFrom(t.steps, t.steps.length - 1, 'op', 1)).toBe(t.steps.length - 1)
    expect(stepFrom([], 0, 'line', 1)).toBe(0)
  })

  it('counts each time round a one-line loop as a line of its own', () => {
    const t = trace('i = 0\nwhile i < 3: i += 1\n')
    expect(lines(t).filter((l) => l === 2).length).toBeGreaterThanOrEqual(4)
  })

  it('marks what a step changed: a new list, the list append changed, and a name bound to another object', () => {
    const t = trace(starter('names').code)
    const at = (pred: (i: number) => boolean) => t.steps.findIndex((_, i) => pred(i))
    const list = t.steps.at(-1)!.frames[0].names.find(([k]) => k === 'a')![1]
    const appended = at((i) => changesAt(t, i).changed.has(list))
    expect(appended).toBeGreaterThan(0)
    expect(heapAt(t, appended).get(list)!.items!.length).toBe(3)
    expect(heapAt(t, appended - 1).get(list)!.items!.length).toBe(2)
    const made = at((i) => changesAt(t, i).fresh.has(list))
    expect(made).toBeGreaterThan(0)
    expect(made).toBeLessThan(appended)
    expect(at((i) => changesAt(t, i).names.has('0/b'))).toBeGreaterThan(made)
    expect(changesAt(t, 0)).toEqual({ fresh: new Set(), changed: new Set(), names: new Set() })
  })

  it('a list over-allocates as it grows: cap runs ahead of len', () => {
    const t = trace(starter('growth').code)
    const caps = new Set<number>()
    for (let i = 0; i < t.steps.length; i++) {
      const xs = t.steps[i].frames[0].names.find(([k]) => k === 'xs')
      const o = xs && heapAt(t, i).get(xs[1])
      if (o?.cap !== undefined) caps.add(o.cap - o.items!.length)
    }
    expect([...caps].some((spare) => spare > 0)).toBe(true)
  })

  it('reads a big int’s CPython digits', () => {
    const t = trace(starter('ints').code)
    const last = t.steps.length - 1
    const big = heapAt(t, last).get(t.steps[last].frames[0].names.find(([k]) => k === 'big')![1])!
    expect(big.d).toEqual([0, 1024])
  })
})

describe('instructions in plain words', () => {
  it('explains the instructions short programs meet, and says nothing it doesn’t know', () => {
    for (const op of ['LOAD_FAST', 'LOAD_FAST_BORROW', 'LOAD_FAST_BORROW_LOAD_FAST_BORROW', 'STORE_NAME', 'BINARY_OP', 'CALL', 'RETURN_VALUE', 'FOR_ITER', 'LOAD_SMALL_INT', 'MAKE_FUNCTION', 'POP_JUMP_IF_FALSE'])
      expect(opcodeNote(op), op).not.toBe('')
    expect(opcodeNote('LOAD_FAST_BORROW_LOAD_FAST_BORROW')).toMatch(/two locals/)
    expect(opcodeNote('SOMETHING_NEW')).toBe('')
  })

  it('has words for every instruction the starter programs run', () => {
    for (const s of LAB_STARTERS) for (const c of trace(s.code).codes!) for (const op of c.ops) expect(opcodeNote(op[1]), `${s.id}: ${op[1]}`).not.toBe('')
  })
})

describe('the lab in lessons', () => {
  it('knows its fences', () => {
    expect(['pylab', 'pytrace', 'Python-Lab'].every(isLabFence)).toBe(true)
    expect(isLabFence('python')).toBe(false)
  })

  it('picks the starter for a lesson’s topic', () => {
    expect(starterFor('Python call stacks and recursion').id).toBe('frames')
    expect(starterFor('How CPython stores integers').id).toBe('ints')
    expect(starterFor('Closures and nonlocal').id).toBe('closure')
    expect(starterFor('Something else').id).toBe('names')
  })

  it('tells a Python lesson’s tutor about it, and not a C lesson’s', () => {
    expect(lessonKit('Python lists in memory', undefined, 'Software Engineering').toolkit).toContain(PYTHON_LAB_LINE)
    expect(lessonKit('Pointers in C', undefined, 'Software Engineering').toolkit).not.toContain(PYTHON_LAB_LINE)
  })
})

describe('the block (renderer lib/pyLab)', () => {
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? ''

  it('draws the code, bytecode, stack and objects, and follows each step', async () => {
    const t = trace(starter('frames').code)
    const block = pyLabBlock(starter('frames').code, { trace: async () => ({ trace: t }) })
    document.body.append(block.root)
    await block.ready
    const r = block.root
    expect(text(r, '.pylab-ver')).toMatch(/CPython 3\./)
    expect(text(r, '.pylab-line.now .pylab-ln')).toBe('1')
    expect(r.querySelectorAll('.pylab-frame').length).toBe(1)
    // Lines: forward until fact is running four deep
    for (let i = 0; i < 40 && r.querySelectorAll('.pylab-frame').length < 5; i++) key(r, 'ArrowRight')
    expect(r.querySelectorAll('.pylab-frame').length).toBe(5)
    expect(text(r, '.pylab-frame.top .pylab-frame-name')).toBe('fact()')
    expect(text(r, '.pylab-ops .pylab-pane-sub')).toMatch(/^fact/)
    expect(r.querySelector('.pylab-op.now')).not.toBeNull()
    expect(text(r, '.pylab-opnote')).not.toBe('')
    // A caller's frame shows where it waits
    r.querySelectorAll<HTMLButtonElement>('.pylab-frame')[1].click()
    expect(r.querySelector('.pylab-op.waiting .pylab-opname')?.textContent).toBe('CALL')
    // Instructions: one step is one instruction
    r.querySelectorAll<HTMLButtonElement>('.pylab-mode button')[1].click()
    const before = text(r, '.pylab-count')
    key(r, 'ArrowRight')
    expect(text(r, '.pylab-count')).not.toBe(before)
    expect(text(r, '.pylab-count')).toMatch(/^Instruction \d+ of \d+$/)
    key(r, 'End')
    expect(text(r, '.pylab-out-text')).toBe('24\n')
    expect(r.querySelectorAll('.pylab-frame').length).toBe(1)
    block.destroy()
    r.remove()
  })

  it('draws a list’s spare slots and a big int’s digits', async () => {
    const code = 'xs = []\nfor i in range(5):\n    xs.append(i)\nbig = 2 ** 40\n'
    const t = trace(code)
    const block = pyLabBlock(code, { trace: async () => ({ trace: t }) })
    await block.ready
    key(block.root, 'End')
    expect(block.root.querySelectorAll('.pylab-obj .pylab-slot.spare').length).toBeGreaterThan(0)
    expect([...block.root.querySelectorAll('.pylab-digit')].map((d) => d.textContent)).toEqual(['0', '1024'])
    block.destroy()
  })

  it('opens the editor and says what is wrong when the program does not compile', async () => {
    const block = pyLabBlock('def (:', { trace: async () => ({ trace: cleanTrace({ code: 'def (:', ok: false, error: 'SyntaxError: invalid syntax (line 1)', steps: [], objects: [] })! }) })
    await block.ready
    expect(block.root.querySelector<HTMLElement>('.pylab-editor')!.hidden).toBe(false)
    expect(text(block.root, '.pylab-err')).toMatch(/SyntaxError/)
    expect(block.root.querySelector<HTMLElement>('.pylab-panes')!.hidden).toBe(true)
    block.destroy()
  })
})
