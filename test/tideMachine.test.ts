// @vitest-environment happy-dom
/**
 * The computing kit (shared/frame/machine) as the frame runs it: its numbers, its assembler and
 * CPU, its circuits' arithmetic and its trace replay must teach the truth. Loaded from source into
 * a page, as main/visualLibs serves it.
 */
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { cleanTrace } from '../src/shared/pyTrace'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TM: any

beforeAll(() => {
  const dir = resolve('src/shared/frame/machine')
  const src = ['core', 'bits', 'circuit', 'memory', 'cpu', 'python', 'studio', 'scene3d', 'teardown', 'spaces', 'end'].map((f) => readFileSync(join(dir, `${f}.js`), 'utf8')).join('\n')
  ;(window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false })
  new Function(src)()
  TM = (window as unknown as { TideMachine: unknown }).TideMachine
})

describe('numbers', () => {
  it('binary, hex and two’s complement', () => {
    expect(TM.bin(173, 8)).toBe('10101101')
    expect(TM.hex(173, 2)).toBe('AD')
    expect(TM.bin(-5, 8)).toBe('11111011')
    expect(TM.signed(0b11111011, 8)).toBe(-5)
    expect(TM.unsigned(-128, 8)).toBe(128)
    expect(TM.signed(127, 8)).toBe(127)
    expect(TM.bytesOf(1000, 4)).toEqual([0xe8, 0x03, 0, 0])
    expect(TM.bytesOf(1000, 4, 'big')).toEqual([0, 0, 0x03, 0xe8])
    expect(TM.bytesOf(-1, 2)).toEqual([255, 255])
  })

  it('a register adds its place values, the top bit −128 when signed', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const reg = TM.bits(host, { n: 8, signed: true, value: -5 })
    expect(reg.get()).toBe(-5)
    expect(reg.unsigned()).toBe(251)
    expect(host.textContent).toContain('−128')
    expect(host.textContent).toContain('0xFB')
    reg.set(5)
    expect(host.textContent).toContain('4 + 1 = 5')
  })
})

describe('circuits', () => {
  it('a half adder is XOR and AND', () => {
    const c = TM.circuit(document.body, TM.circuits.halfAdder())
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      c.set({ A: a, B: b })
      expect([c.value('S'), c.value('C')]).toEqual([a ^ b, a & b])
    }
  })

  it('a full adder adds three bits', () => {
    const c = TM.circuit(document.body, TM.circuits.fullAdder())
    for (let n = 0; n < 8; n++) {
      const [a, b, cin] = [(n >> 2) & 1, (n >> 1) & 1, n & 1]
      c.set({ A: a, B: b, Cin: cin })
      expect(c.value('S') + 2 * c.value('Cout')).toBe(a + b + cin)
    }
  })

  it('a 4-bit ripple-carry adder adds every pair, and its carry takes a delay per adder', () => {
    const c = TM.circuit(document.body, TM.circuits.rippleAdder(4))
    for (const [x, y] of [[7, 1], [15, 1], [9, 6], [0, 0], [10, 5]]) {
      const ins: Record<string, number> = {}
      for (let i = 0; i < 4; i++) {
        ins[`A${i}`] = (x >> i) & 1
        ins[`B${i}`] = (y >> i) & 1
      }
      c.set(ins)
      const sum = [0, 1, 2, 3].reduce((s, i) => s + c.value(`S${i}`) * 2 ** i, 0) + 16 * c.value('Cout')
      expect(sum).toBe(x + y)
    }
    c.set({ A0: 0, A1: 0, A2: 0, A3: 0, B0: 0, B1: 0, B2: 0, B3: 0 })
    // 15 + 1: the carry ripples through all four adders
    const s = c.stepsFor({ A0: 1, A1: 1, A2: 1, A3: 1, B0: 1 })
    expect(s.states.length - 1).toBe(4)
    expect(s.captions.at(-1)).toMatch(/Settled/)
  })

  it('a multiplexer passes the selected input', () => {
    const c = TM.circuit(document.body, TM.circuits.mux2())
    c.set({ D0: 1, D1: 0, S: 0 })
    expect(c.value('Y')).toBe(1)
    c.set({ S: 1 })
    expect(c.value('Y')).toBe(0)
  })

  it('refuses a wire to nothing', () => {
    expect(() => TM.circuit(document.body, { inputs: ['A'], gates: [{ id: 'g', type: 'AND', in: ['A', 'Q'] }], outputs: [] })).toThrow(/nothing called Q/)
  })
})

describe('the tiny CPU', () => {
  it('assembles two bytes an instruction: opcode, registers, operand', () => {
    const p = TM.assemble('LOADI R0, 5\nADD R0, R1\nSTORE R0, [0x0E]\nloop: JMP loop\nHALT')
    expect(p.bytes.slice(0, 10)).toEqual([0x30, 5, 0x41, 0, 0x20, 0x0e, 0x60, 6, 0, 0])
    expect(() => TM.assemble('MOV R0, 1')).toThrow(/unknown instruction/)
    expect(() => TM.assemble('LOADI R7, 1')).toThrow(/not a register/)
  })

  it('runs 5 + 3 in fetch, decode and execute steps, and stores 8', () => {
    const cpu = TM.cpu(document.body, { asm: 'LOADI R0, 5\nLOADI R1, 3\nADD R0, R1\nSTORE R0, [0x0E]\nHALT' })
    expect(cpu.states.length).toBe(1 + 5 * 3)
    expect(cpu.captions[1]).toMatch(/^Fetch: the PC sends 0x00/)
    expect(cpu.captions[2]).toMatch(/^Decode: .*Opcode 0011 means LOADI/)
    expect(cpu.captions[3]).toMatch(/^Execute: the number 5 is copied into R0/)
    const last = cpu.states.at(-1)
    expect(last.regs.slice(0, 2)).toEqual([8, 3])
    expect(last.mem[0x0e]).toBe(8)
    expect(last.halted).toBe(true)
    expect(cpu.captions.find((c: string) => /ALU/.test(c))).toMatch(/5 \+ 3 = 8/)
  })

  it('wraps at 256 and sets Z on a zero result', () => {
    const cpu = TM.cpu(document.body, { asm: 'LOADI R0, 200\nLOADI R1, 56\nADD R0, R1\nHALT' })
    const ex = cpu.states.filter((s: { alu?: unknown }) => s.alu)[0]
    expect(ex.alu.out).toBe(0)
    expect(ex.z).toBe(1)
    expect(cpu.captions.join(' ')).toMatch(/wrapped past 255/)
  })
})

describe('memory', () => {
  it('writes an int little-endian and reads it back', () => {
    const m = TM.memory(document.body, { size: 16, base: 0x1000 })
    m.writeInt(0x1004, 1000)
    expect([0, 1, 2, 3].map((k) => m.read(0x1004 + k))).toEqual([0xe8, 0x03, 0, 0])
    expect(m.readInt(0x1004)).toBe(1000)
    m.writeInt(0x1008, -2, { size: 2, endian: 'big' })
    expect(m.readInt(0x1008, { size: 2, endian: 'big' })).toBe(-2)
  })
})

describe('Python, from a real trace', () => {
  const trace = (code: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'tide-trace-test-'))
    writeFileSync(join(dir, 'snippet.py'), code)
    execFileSync('python3', ['-I', resolve('src/main/pyTrace.py'), join(dir, 'snippet.py'), join(dir, 'trace.json')], { timeout: 10_000 })
    return cleanTrace(JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')))!
  }

  it('b = a names the same list; append changes it in place for both', () => {
    const t = trace('a = [1, 2]\nb = a\nb.append(3)\nprint(a)\n')
    const py = TM.python(document.body, { trace: t })
    expect(py.captions[0]).toMatch(/Nothing has run yet. Next: line 1, a = \[1, 2\]/)
    expect(py.captions[2]).toMatch(/b now names the list \[1, 2\], the same object as a: no copy was made/)
    expect(py.captions[3]).toMatch(/changed in place, \[1, 2\] → \[1, 2, 3\]; a and b both see it/)
    expect(py.captions.at(-1)).toMatch(/prints "\[1, 2, 3\]"/)
    const ids = t.steps.at(-1)!.frames[0].names.map(([, id]) => id)
    expect(ids[0]).toBe(ids[1])
  })

  it('recursion pushes a frame per call and pops them with their results', () => {
    const t = trace('def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nresult = factorial(4)\n')
    expect(Math.max(...t.steps.map((s) => s.frames.length))).toBe(5)
    const py = TM.python(document.body, { trace: t })
    expect(py.captions.join('\n')).toMatch(/factorial\(n=4\) is called: a new frame/)
    expect(py.captions.join('\n')).toMatch(/factorial returns int 24/)
  })
})

describe('spaces and teardowns', () => {
  it('eigenvalues and eigenvectors, 2×2 and 3×3', () => {
    const e2 = TM.eigen([[2, 1], [1, 2]])
    expect(e2.map((e: { value: number }) => Math.round(e.value * 1e6) / 1e6)).toEqual([3, 1])
    const v = e2[0].vector
    expect(Math.abs(v[0] - v[1])).toBeLessThan(1e-9)
    expect(TM.eigen([[0, -1], [1, 0]])).toEqual([])
    const e3 = TM.eigen([[2, 1, 0], [1, 2, 0], [0, 0, 0.5]]).map((e: { value: number }) => Math.round(e.value * 1e6) / 1e6).sort((a: number, b: number) => a - b)
    expect(e3).toEqual([0.5, 1, 3])
    for (const e of TM.eigen([[2, 1, 0], [1, 2, 0], [0, 0, 0.5]])) {
      const A = [[2, 1, 0], [1, 2, 0], [0, 0, 0.5]]
      const Av = A.map((r) => r[0] * e.vector[0] + r[1] * e.vector[1] + r[2] * e.vector[2])
      Av.forEach((x, i) => expect(x).toBeCloseTo(e.value * e.vector[i], 6))
    }
  })

  it('a teardown tours whole, apart, each part, then whole again', () => {
    const t = TM.teardown(document.body, { label: 'A board', parts: [
      { id: 'board', label: 'Board', note: 'the base', box: [4, 0.2, 4], at: [0, 0, 0] },
      { id: 'chip', label: 'Chip', box: [1, 0.2, 1], at: [0, 0.2, 0], parent: 'board', explode: [0, 2, 0] },
      { id: 'die', label: 'Die', say: 'The die, on its own.', box: [0.5, 0.1, 0.5], at: [0, 0.3, 0], parent: 'chip', explode: [0, 1, 0] }
    ] })
    expect(t.captions).toEqual([
      'A board, assembled. Drag to turn it; click any part to take it out.',
      'Taken apart: each part moves out along the way it fits in.',
      'Board: the base.',
      'Chip.',
      'The die, on its own.',
      'Back together: every part you saw has its place in the whole.'
    ])
  })
})

