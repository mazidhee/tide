import { describe, expect, it } from 'vitest'
import {
  CPU_LIMITS,
  DEFAULT_PROGRAM,
  MEMORY_SIZE,
  Machine,
  OPS,
  add8,
  assemble,
  bin,
  decode,
  describeCpuPart,
  encode,
  hex,
  loadMachine,
  parseCpuPart,
  placeValues,
  signedText,
  sourceLines,
  sub8,
  toSigned,
  type CpuSpec,
  type Instruction,
  type OpName
} from '../src/renderer/src/lib/sims/cpu'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const spec = (o: object) => parseSim(JSON.stringify({ kind: 'cpu', ...o })) as CpuSpec

/** Assembles (it must assemble) and returns a machine */
function boot(program: string, preload: { at: number | string; value: number }[] = [], limit = 400): Machine {
  const asm = assemble(program)
  expect(asm.errors).toEqual([])
  return loadMachine(asm, preload, limit)
}

/** The bytes a one-line program assembles to */
const bytes = (line: string) => Array.from(assemble(line).image.slice(0, 2))

describe('cpu: numbers', () => {
  it('reads a byte as two’s complement', () => {
    expect([0, 1, 127, 128, 129, 255].map(toSigned)).toEqual([0, 1, 127, -128, -127, -1])
  })

  it('formats negative values as binary, hexadecimal and signed decimal', () => {
    // −3 is 256 − 3 = 253 = 1111 1101 = 0xFD
    expect(bin(253)).toBe('1111 1101')
    expect(hex(253)).toBe('FD')
    expect(signedText(253)).toBe('−3')
    expect(bin(128)).toBe('1000 0000')
    expect(hex(128)).toBe('80')
    expect(signedText(128)).toBe('−128')
    expect(bin(255)).toBe('1111 1111')
    expect(signedText(255)).toBe('−1')
    expect(bin(5)).toBe('0000 0101')
    expect(hex(5)).toBe('05')
    expect(signedText(5)).toBe('5')
    expect(bin(4, 4)).toBe('0100')
    expect(bin(-3)).toBe('1111 1101')
  })

  it('writes out the place values, with bit 7 worth −128', () => {
    expect(placeValues(253)).toBe('−128 + 64 + 32 + 16 + 8 + 4 + 1 = −3')
    expect(placeValues(5)).toBe('4 + 1 = 5')
    expect(placeValues(128)).toBe('−128')
    expect(placeValues(0)).toBe('0')
    for (let v = 0; v < 256; v++) {
      const sum = placeValues(v).split(' = ')[0].split(' + ').reduce((a, t) => a + Number(t.replace('−', '-')), 0)
      expect(sum).toBe(toSigned(v))
    }
  })
})

describe('cpu: arithmetic and flags', () => {
  it('wraps at the boundaries exactly as 8 bits do', () => {
    // 127 + 1: the bits are 1000 0000 = −128. Signed overflow, no carry out of bit 7.
    expect(add8(127, 1)).toEqual({ result: 128, z: 0, n: 1, c: 0, v: 1 })
    // −128 − 1: 128 − 1 = 127 unsigned, no borrow, but −129 does not fit
    expect(sub8(128, 1)).toEqual({ result: 127, z: 0, n: 0, c: 0, v: 1 })
    // −1 + 1 = 0: unsigned 255 + 1 carries out, signed is fine
    expect(add8(255, 1)).toEqual({ result: 0, z: 1, n: 0, c: 1, v: 0 })
    // 0 − 1 = −1: borrow, no signed overflow
    expect(sub8(0, 1)).toEqual({ result: 255, z: 0, n: 1, c: 1, v: 0 })
    // 5 − 5 = 0
    expect(sub8(5, 5)).toEqual({ result: 0, z: 1, n: 0, c: 0, v: 0 })
    expect(add8(0, 0)).toEqual({ result: 0, z: 1, n: 0, c: 0, v: 0 })
    // −128 + −128 = −256: wraps to 0 with both carry and overflow
    expect(add8(128, 128)).toEqual({ result: 0, z: 1, n: 0, c: 1, v: 1 })
    // 127 − (−1) = 128: overflow, and a borrow because 127 < 255 unsigned
    expect(sub8(127, 255)).toEqual({ result: 128, z: 0, n: 1, c: 1, v: 1 })
    expect(add8(100, 27)).toEqual({ result: 127, z: 0, n: 0, c: 0, v: 0 })
  })

  it('agrees with plain integer arithmetic for every pair of bytes', () => {
    for (let a = 0; a < 256; a++)
      for (let b = 0; b < 256; b++) {
        const s = add8(a, b)
        const d = sub8(a, b)
        expect(s.result).toBe((a + b) % 256)
        expect(d.result).toBe((a - b + 256) % 256)
        const es = toSigned(a) + toSigned(b)
        const ed = toSigned(a) - toSigned(b)
        if (s.v !== (es !== toSigned(s.result) ? 1 : 0) || d.v !== (ed !== toSigned(d.result) ? 1 : 0)) throw new Error(`V wrong for ${a}, ${b}`)
        if (s.c !== (a + b > 255 ? 1 : 0) || d.c !== (a < b ? 1 : 0)) throw new Error(`C wrong for ${a}, ${b}`)
        if (s.z !== (s.result === 0 ? 1 : 0) || s.n !== (s.result >= 128 ? 1 : 0)) throw new Error(`Z or N wrong for ${a}, ${b}`)
      }
  })
})

describe('cpu: encoding', () => {
  it('encodes every instruction as opcode and register, then operand', () => {
    expect(bytes('HALT')).toEqual([0x00, 0x00])
    expect(bytes('LOADI R1, 5')).toEqual([0x11, 0x05])
    expect(bytes('LOADI R3, -1')).toEqual([0x13, 0xff])
    expect(bytes('LOAD R2, 20')).toEqual([0x22, 0x14])
    expect(bytes('STORE R0, 31')).toEqual([0x30, 0x1f])
    expect(bytes('ADD R0, R1')).toEqual([0x40, 0x01])
    expect(bytes('SUB R3, R2')).toEqual([0x53, 0x02])
    expect(bytes('JMP 6')).toEqual([0x60, 0x06])
    expect(bytes('JZ 14')).toEqual([0x70, 0x0e])
    expect(bytes('JN 2')).toEqual([0x80, 0x02])
  })

  it('round-trips every instruction through encode and decode', () => {
    const rand = mulberry32(11)
    const pick = (n: number) => Math.floor(rand() * n)
    for (const op of OPS) {
      for (let k = 0; k < 40; k++) {
        const i: Instruction = {
          op: op.name,
          r: op.form === 'none' || op.form === 'address' ? 0 : pick(4),
          operand: op.form === 'none' ? 0 : op.form === 'reg-reg' ? pick(4) : op.form === 'reg-value' ? pick(256) : pick(MEMORY_SIZE)
        }
        const [b0, b1] = encode(i)
        const d = decode(b0, b1)
        expect(d.fault).toBeNull()
        expect({ op: d.op!.name, r: d.r, operand: d.operand }).toEqual(i)
        // …and the text it decodes to assembles back to the same two bytes
        expect(bytes(d.text)).toEqual([b0, b1])
      }
    }
  })

  it('refuses bytes that are not an instruction', () => {
    expect(decode(0x90, 0).fault).toMatch(/opcode 9/)
    expect(decode(0xf0, 0).fault).toMatch(/opcode 15/)
    expect(decode(0x15, 0).fault).toMatch(/register field 5/)
    expect(decode(0x40, 0x07).fault).toMatch(/operand 7/)
    expect(decode(0x60, 0x20).fault).toMatch(/address 32/)
    expect(decode(0x20, 0x28).fault).toMatch(/address 40/)
    expect(decode(0x11, 0xff).fault).toBeNull()
  })
})

describe('cpu: the assembler', () => {
  it('assembles the default program, with labels forward and back', () => {
    const asm = assemble(DEFAULT_PROGRAM)
    expect(asm.ok).toBe(true)
    expect(asm.labels).toEqual({ loop: 6, done: 14, n: 18, total: 19 })
    expect(asm.size).toBe(20)
    // prettier-ignore
    expect(Array.from(asm.image.slice(0, 20))).toEqual([
      0x10, 0x00, 0x21, 0x12, 0x12, 0x01, 0x40, 0x01, 0x51, 0x02,
      0x70, 0x0e, // JZ done: forward, to 14
      0x60, 0x06, // JMP loop: back, to 6
      0x30, 0x13, 0x00, 0x00, 5, 0
    ])
    expect(asm.kinds.slice(0, 18).every((k) => k === 'code')).toBe(true)
    expect(asm.kinds.slice(18, 22)).toEqual(['data', 'data', 'unused', 'unused'])
    const loop = asm.lines[3]
    expect(loop).toMatchObject({ line: 4, label: 'loop', code: 'ADD R0, R1', comment: 'total = total + counter', address: 6, bytes: [0x40, 0x01], kind: 'code' })
  })

  it('is forgiving about case, commas, spacing, brackets and aliases', () => {
    const neat = Array.from(assemble('LOADI R1, 5\nLOAD R2, 20\nSTORE R2, 21\nADD R1, R2\nJMP 0\nJZ 0\nJN 0\nHALT').image)
    const loose = Array.from(assemble('  ldi r1 5\nLd   R2 ,[20]\nsto r2,(21)\nadd   R1,r2\nJUMP 0\nbeq 0\nBMI 0\nhlt').image)
    expect(loose).toEqual(neat)
    expect(bytes('LOAD R1, #5')).toEqual([0x11, 0x05])
    expect(bytes('loadi r0, 0x1F')).toEqual([0x10, 0x1f])
    expect(bytes('loadi r0, 0b101')).toEqual([0x10, 0x05])
    expect(bytes('LOADI R0, −3')).toEqual([0x10, 0xfd])
    expect(bytes('LOADI R0, 255')).toEqual([0x10, 0xff])
  })

  it('accepts new lines, ";" on one line, comments and labels on their own line', () => {
    const lines = assemble('LOADI R0, 1 ; one\n// a whole-line comment\n# another\n\nloop:\n  ADD R0, R0 // double\n  JMP loop')
    expect(lines.ok).toBe(true)
    expect(lines.labels).toEqual({ loop: 2 })
    expect(lines.lines.map((l) => l.comment)).toEqual(['one', 'a whole-line comment', 'another', '', '', 'double', ''])
    const one = assemble('LOADI R0, 1; loop: ADD R0, R0; JMP loop')
    expect(Array.from(one.image)).toEqual(Array.from(lines.image))
    expect(sourceLines('A; B;C')).toEqual(['A', 'B', 'C'])
    expect(sourceLines('A\\nB')).toEqual(['A', 'B'])
    expect(sourceLines('\n\nA  \r\n B\n\n')).toEqual(['A', ' B'])
    // A label without its colon, and labels in any case
    expect(assemble('Loop ADD R0, R1\nJMP LOOP').labels).toEqual({ loop: 0 })
  })

  it('places DATA values and resolves labels used as values', () => {
    const asm = assemble('LOADI R0, table\nHALT\ntable: DATA 1, -2, 0x10')
    expect(asm.ok).toBe(true)
    expect(Array.from(asm.image.slice(0, 7))).toEqual([0x10, 4, 0, 0, 1, 254, 16])
    expect(asm.kinds.slice(4, 7)).toEqual(['data', 'data', 'data'])
  })

  const fails = (program: string) => assemble(program).errors.map((e) => `${e.line}: ${e.message}`)

  it('reports each error with its line and what was expected', () => {
    expect(fails('HALT\nFOO R1')).toEqual(['2: Unknown instruction "FOO"; expected one of HALT, LOADI, LOAD, STORE, ADD, SUB, JMP, JZ, JN or DATA.'])
    expect(fails('LOAD R1')).toEqual(['1: LOAD needs a register and an address, as in "LOAD R1, 20"; found "R1".'])
    expect(fails('HALT\nADD')).toEqual(['2: ADD needs two registers, as in "ADD R0, R1"; found nothing.'])
    expect(fails('HALT R1')).toEqual(['1: HALT needs no operands, as in "HALT"; found "R1".'])
    expect(fails('JMP')).toEqual(['1: JMP needs an address or a label, as in "JMP loop"; found nothing.'])
    expect(fails('LOAD R5, 2')).toEqual(['1: "R5" is not a register; expected R0, R1, R2 or R3.'])
    expect(fails('ADD R0, 5')).toEqual(['1: ADD needs two registers, as in "ADD R0, R1"; found "5" where the second register should be.'])
    expect(fails('JMP lop\nloop: HALT')).toEqual(['1: Unknown label "lop"; expected a label defined in the program or an address from 0 to 31.'])
    expect(fails('LOAD R0, 40')).toEqual(['1: Address 40 is outside memory; expected 0 to 31.'])
    expect(fails('LOADI R0, 300')).toEqual(['1: The value 300 does not fit in 8 bits; expected −128 to 255.'])
    expect(fails('LOADI R0, -129')).toEqual(['1: The value -129 does not fit in 8 bits; expected −128 to 255.'])
    expect(fails('LOADI R0, 1x')).toEqual(['1: "1x" is not a number or a label; expected a value such as 5, -3 or 0x1F.'])
    expect(fails('LOAD R0, R1')).toEqual(['1: Expected an address or a label here, but found the register "R1".'])
    expect(fails('a: HALT\na: HALT')).toEqual(['2: Label "a" is already defined on line 1; expected a new name.'])
    expect(fails('add: HALT')).toEqual(['1: "add" cannot be a label: it is the name of an instruction.'])
    // …but a word that is only another spelling of one is fine before a colon
    expect(assemble('JMP end\nend: HALT').labels).toEqual({ end: 2 })
    expect(fails('r1: HALT')).toEqual(['1: "r1" cannot be a label: it would be read as a register.'])
    expect(fails('9x: HALT')).toEqual(['1: "9x" is not a usable label; expected letters, digits or _ and not a digit first.'])
    expect(fails('x: DATA')).toEqual(['1: DATA needs at least one value, as in "DATA 5"; found nothing.'])
    expect(fails('')).toEqual(['1: The program is empty; expected at least one instruction, such as HALT.'])
    expect(fails('// only a comment\n; and another')).toEqual(['1: The program is empty; expected at least one instruction, such as HALT.'])
  })

  it('reports several errors at once, in line order, and a program too long for memory', () => {
    expect(assemble('LOADI R0, 300\nLOAD R5, 2\nloop: ADD R0\nJMP lop\nFOO R1\nHALT').errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5])
    const long = Array.from({ length: 17 }, () => 'ADD R0, R1').join('\n')
    expect(fails(long)).toEqual(['17: The program does not fit: from this line on it would need more than the 32 cells of memory; expected a shorter program.'])
    expect(assemble(Array.from({ length: 16 }, () => 'ADD R0, R1').join('\n')).ok).toBe(true)
  })

  it('gives an empty image when it does not assemble', () => {
    const asm = assemble('LOADI R0, 1\nBAD')
    expect(asm.ok).toBe(false)
    expect(Array.from(asm.image).every((b) => b === 0)).toBe(true)
    expect(asm.labels).toEqual({})
  })
})

describe('cpu: the three phases', () => {
  it('fetch reads memory into IR and advances PC; nothing else moves', () => {
    const m = boot('LOADI R1, 5\nHALT')
    const t = m.step()!
    expect(t.phase).toBe('fetch')
    expect(m.ir).toEqual([0x11, 0x05])
    expect(m.irAt).toBe(0)
    expect(m.pc).toBe(2)
    expect(m.phase).toBe('decode')
    expect(m.decoded).toBeNull()
    expect(Array.from(m.reg)).toEqual([0, 0, 0, 0])
    expect(t.changed).toEqual(['ir', 'pc'])
    expect(t.read).toEqual([0, 1])
    expect(t.text).toBe('Fetch: IR ← memory[0] and memory[1], the two bytes 11 05. PC moves on from 0 to 2, the next instruction.')
    expect(m.instructions).toBe(0)
  })

  it('decode says what the bits mean and changes nothing', () => {
    const m = boot('LOADI R1, 5\nHALT')
    m.step()
    const t = m.step()!
    expect(t.phase).toBe('decode')
    expect(m.decoded).toMatchObject({ opcode: 1, r: 1, operand: 5, text: 'LOADI R1, 5' })
    expect(t.changed).toEqual([])
    expect(t.text).toBe('Decode: the high four bits of 11 are 0001, opcode 1: LOADI. The low four bits name R1; the second byte 05 is the value 5 itself. So IR holds LOADI R1, 5.')
    expect(Array.from(m.reg)).toEqual([0, 0, 0, 0])
    expect(m.pc).toBe(2)
    expect(m.phase).toBe('execute')
  })

  it('execute carries it out and counts the instruction', () => {
    const m = boot('LOADI R1, 5\nHALT')
    m.run(2)
    const t = m.step()!
    expect(t.phase).toBe('execute')
    expect(Array.from(m.reg)).toEqual([0, 5, 0, 0])
    expect(t.changed).toEqual(['register:1'])
    expect(t.text).toBe('Execute: R1 ← 5. The value came from the instruction itself; the flags are left alone.')
    expect(m.instructions).toBe(1)
    expect(m.phase).toBe('fetch')
    expect(m.stopped).toBeNull()
  })
})

describe('cpu: each instruction', () => {
  /** Runs one whole instruction and returns the execute trace */
  const one = (m: Machine) => {
    m.run(2)
    return m.step()!
  }

  it('LOAD copies a cell into a register and leaves flags and memory alone', () => {
    const m = boot('LOAD R2, x\nHALT\nx: DATA -7')
    const t = one(m)
    expect(toSigned(m.reg[2])).toBe(-7)
    expect(m.mem[4]).toBe(249)
    expect(m.flags).toEqual({ z: 0, n: 0, c: 0, v: 0 })
    expect(t.read).toEqual([4])
    expect(t.text).toContain('R2 ← memory[4] = −7')
  })

  it('STORE copies a register into a cell', () => {
    const m = boot('LOADI R3, 9\nSTORE R3, 30\nHALT')
    one(m)
    const t = one(m)
    expect(m.mem[30]).toBe(9)
    expect(m.reg[3]).toBe(9)
    expect(m.kinds[30]).toBe('data')
    expect(t.changed).toEqual(['memory:30'])
    expect(t.text).toContain('memory[30] ← R3 = 9')
  })

  it('ADD and SUB write the first register and set all four flags', () => {
    const m = boot('LOADI R0, 127\nLOADI R1, 1\nADD R0, R1\nSUB R0, R0\nHALT')
    one(m)
    one(m)
    const t = one(m)
    expect(m.reg[0]).toBe(128)
    expect(m.reg[1]).toBe(1)
    expect(m.flags).toEqual({ z: 0, n: 1, c: 0, v: 1 })
    expect(t.changed).toEqual(['register:0', 'flag:z', 'flag:n', 'flag:c', 'flag:v'])
    expect(t.text).toBe(
      'Execute: R0 ← R0 + R1 = 127 + 1 = 128, which does not fit in 8 signed bits (−128 to 127) and wraps to −128. Flags: Z = 0 (the result is not zero), N = 1 (bit 7 is 1), C = 0 (no carry out of bit 7), V = 1 (the signed result does not fit).'
    )
    const u = one(m)
    expect(m.reg[0]).toBe(0)
    expect(m.flags).toEqual({ z: 1, n: 0, c: 0, v: 0 })
    expect(u.text).toContain('R0 ← R0 − R0 = −128 − (−128) = 0. Flags: Z = 1 (the result is zero)')
  })

  it('says why carry is set: a carry out for ADD, a borrow for SUB', () => {
    const m = boot('LOADI R0, -1\nLOADI R1, 1\nADD R0, R1\nSUB R0, R1\nHALT')
    one(m)
    one(m)
    expect(one(m).text).toContain('C = 1 (as unsigned numbers 255 + 1 passes 255, a carry out of bit 7)')
    expect(m.flags).toEqual({ z: 1, n: 0, c: 1, v: 0 })
    expect(one(m).text).toContain('C = 1 (as unsigned numbers 0 is less than 1, so it borrows)')
    expect(m.flags).toEqual({ z: 0, n: 1, c: 1, v: 0 })
    expect(toSigned(m.reg[0])).toBe(-1)
  })

  it('−128 − 1 wraps to 127 and sets overflow', () => {
    const m = boot('LOADI R0, -128\nLOADI R1, 1\nSUB R0, R1\nHALT')
    one(m)
    one(m)
    const t = one(m)
    expect(m.reg[0]).toBe(127)
    expect(m.flags).toEqual({ z: 0, n: 0, c: 0, v: 1 })
    expect(t.text).toContain('= −128 − 1 = −129, which does not fit in 8 signed bits (−128 to 127) and wraps to 127')
  })

  it('JMP sets PC', () => {
    const m = boot('JMP 6\nHALT\nHALT\nLOADI R0, 1\nHALT')
    const t = one(m)
    expect(m.pc).toBe(6)
    expect(t.changed).toEqual(['pc'])
    expect(t.text).toBe('Execute: PC ← 6, so the next fetch reads address 6 instead of 2.')
  })

  it('JZ and JN branch only when their flag is set', () => {
    const m = boot('JZ 20\nJN 20\nLOADI R0, 1\nSUB R1, R0\nJZ 20\nJN 20\nHALT')
    expect(one(m).text).toBe('Execute: Z is 0, so the branch is not taken: PC stays at 2 and the next instruction follows.')
    expect(one(m).changed).toEqual([])
    expect(m.pc).toBe(4)
    one(m)
    one(m) // 0 − 1 = −1: N set, Z clear
    one(m)
    expect(m.pc).toBe(10)
    expect(one(m).text).toBe('Execute: N is 1, so the branch is taken: PC ← 20 instead of 12.')
    expect(m.pc).toBe(20)

    const z = boot('SUB R0, R0\nJZ 8\nHALT\nHALT\nLOADI R3, 1\nHALT')
    one(z)
    one(z)
    expect(z.pc).toBe(8)
  })

  it('HALT stops the machine and Step then does nothing', () => {
    const m = boot('HALT')
    const t = one(m)
    expect(t.text).toBe('Execute: HALT stops the machine. Nothing else changes.')
    expect(m.halted).toBe(true)
    expect(m.stopped).toBe('Halted after 1 instruction')
    expect(m.step()).toBeNull()
    expect(m.pc).toBe(2)
  })

  it('a program can overwrite itself, and says so', () => {
    const m = boot('LOADI R0, 0\nSTORE R0, 4\nJMP 0')
    one(m)
    expect(one(m).text).toContain('so the program itself has changed')
    one(m)
    expect(m.stopped).toBe('Halted after 3 instructions')
  })
})

describe('cpu: whole programs', () => {
  it('sums 1 to 5 with the default program', () => {
    const m = boot(DEFAULT_PROGRAM)
    const phases = m.run()
    // 3 to set up; ADD, SUB, JZ, JMP four times; ADD, SUB, JZ (taken); STORE, HALT
    expect(m.instructions).toBe(3 + 4 * 4 + 3 + 2)
    expect(phases).toBe(24 * 3)
    expect(m.stopped).toBe('Halted after 24 instructions')
    expect(m.mem[19]).toBe(15)
    expect(Array.from(m.reg)).toEqual([15, 0, 1, 0])
    expect(m.flags).toEqual({ z: 1, n: 0, c: 0, v: 0 })
  })

  it('sums 1 to n for every n that fits, and wraps exactly when it does not', () => {
    const asm = assemble(DEFAULT_PROGRAM)
    for (let n = 1; n <= 22; n++) {
      const m = loadMachine(asm, [{ at: 'n', value: n }])
      m.run()
      expect(m.halted).toBe(true)
      const sum = (n * (n + 1)) / 2
      expect(m.mem[19]).toBe(sum % 256)
      // 1 + … + 15 = 120 fits; 1 + … + 16 = 136 reads as −120
      expect(toSigned(m.mem[19])).toBe(sum <= 127 ? sum : sum - 256)
    }
  })

  const MULTIPLY = 'LOAD R1, a\nLOAD R2, b\nLOADI R3, 1\nloop: ADD R0, R1\nSUB R2, R3\nJZ done\nJMP loop\ndone: STORE R0, product\nHALT\na: DATA 6\nb: DATA 7\nproduct: DATA 0'

  it('multiplies by repeated addition', () => {
    const asm = assemble(MULTIPLY)
    expect(asm.errors).toEqual([])
    const m = loadMachine(asm)
    m.run()
    expect(m.mem[asm.labels.product]).toBe(42)
    const rand = mulberry32(3)
    for (let k = 0; k < 40; k++) {
      const a = Math.floor(rand() * 256)
      const b = 1 + Math.floor(rand() * 12)
      const run = loadMachine(asm, [{ at: 'a', value: a }, { at: 19, value: b }])
      run.run()
      expect(run.halted).toBe(true)
      expect(run.mem[asm.labels.product]).toBe((a * b) % 256)
      expect(run.instructions).toBe(3 + 4 * (b - 1) + 3 + 2)
    }
  })

  it('counts down with branch-if-zero and branch-if-negative', () => {
    // Counts R0 from 3 to 0, adding 2 to R2 each time round: 6
    const m = boot('LOADI R0, 3\nLOADI R1, 1\nLOADI R3, 2\nloop: ADD R2, R3\nSUB R0, R1\nJZ end\nJMP loop\nend: HALT')
    m.run()
    expect(Array.from(m.reg)).toEqual([0, 1, 6, 2])
    expect(m.stopped).toBe('Halted after 15 instructions')
    // The same loop leaving on negative runs once more
    const n = boot('LOADI R0, 3\nLOADI R1, 1\nLOADI R3, 2\nloop: ADD R2, R3\nSUB R0, R1\nJN end\nJMP loop\nend: HALT')
    n.run()
    expect(Array.from(n.reg)).toEqual([255, 1, 8, 2])
  })

  it('stops a loop without end at the limit, and says so', () => {
    const m = boot('LOADI R1, 1\nloop: ADD R0, R1\nJMP loop', [], 40)
    const phases = m.run(100000)
    expect(phases).toBe(40 * 3)
    expect(m.instructions).toBe(40)
    expect(m.halted).toBe(false)
    expect(m.stopped).toBe('Stopped after 40 instructions without reaching HALT (the limit for one run)')
    expect(m.step()).toBeNull()
    // 1 LOADI, then 19 ADDs and 20… the 39 remaining alternate ADD, JMP: 20 ADDs
    expect(m.reg[0]).toBe(20)
  })

  it('stops when data is reached as code, or PC runs off the end', () => {
    const bad = boot('LOADI R0, 1\nDATA 0x90, 0')
    bad.run()
    expect(bad.stopped).toBe('Stopped: 90 00 at address 2 is not an instruction (opcode 9 is not an instruction)')
    expect(bad.last!.phase).toBe('decode')
    const off = boot(Array.from({ length: 16 }, () => 'ADD R0, R1').join('\n'))
    off.run()
    expect(off.instructions).toBe(16)
    expect(off.stopped).toBe('Stopped: the program counter (32) ran past the end of memory without reaching HALT')
  })

  it('is deterministic', () => {
    const run = () => {
      const m = boot(DEFAULT_PROGRAM)
      const texts: string[] = []
      for (let t = m.step(); t; t = m.step()) texts.push(t.text)
      return texts
    }
    expect(run()).toEqual(run())
  })

  it('preloaded cells win over the program and unknown labels are ignored', () => {
    const asm = assemble('HALT\nx: DATA 1')
    const m = loadMachine(asm, [{ at: 'x', value: -2 }, { at: 'nowhere', value: 9 }, { at: 31, value: 7 }])
    expect(m.mem[2]).toBe(254)
    expect(m.mem[31]).toBe(7)
    expect(m.kinds[31]).toBe('data')
  })
})

describe('cpu: spec', () => {
  it('gives a good simulation from the kind alone', () => {
    const s = spec({})
    expect(s).toMatchObject({ kind: 'cpu', program: DEFAULT_PROGRAM, memory: [], limit: 400, tour: [] })
    expect(assemble(s.program).ok).toBe(true)
    expect(parseSim('{"kind":"register-machine"}')!.kind).toBe('cpu')
  })

  it('reads the program as text with new lines, as one line with ";", or as a list', () => {
    expect(spec({ program: 'LOADI R0, 1\nHALT' }).program).toBe('LOADI R0, 1\nHALT')
    expect(spec({ program: 'LOADI R0, 1; HALT' }).program).toBe('LOADI R0, 1\nHALT')
    expect(spec({ code: ['LOADI R0, 1', 'HALT'] }).program).toBe('LOADI R0, 1\nHALT')
    expect(spec({ program: 'LOADI R0, 1\\nHALT' }).program).toBe('LOADI R0, 1\nHALT')
    expect(spec({ program: 42 }).program).toBe(DEFAULT_PROGRAM)
    expect(spec({ program: '   ' }).program).toBe(DEFAULT_PROGRAM)
    // A program with a mistake is kept, so the mistake can be shown
    expect(spec({ program: 'FOO' }).program).toBe('FOO')
  })

  it('caps the program and clamps the limit', () => {
    const long = spec({ program: Array.from({ length: 200 }, () => 'HALT').join('\n') })
    expect(long.program.split('\n')).toHaveLength(CPU_LIMITS.lines)
    expect(spec({ limit: 5 }).limit).toBe(10)
    expect(spec({ limit: 99999 }).limit).toBe(1600)
    expect(spec({ limit: 'many' }).limit).toBe(400)
    expect(spec({ max: 50 }).limit).toBe(50)
  })

  it('reads preloaded memory as an object, pairs or records, and drops junk', () => {
    expect(spec({ memory: { '20': 5, total: -1, '0x1F': '0x10' } }).memory).toEqual([
      { at: 20, value: 5 },
      { at: 'total', value: -1 },
      { at: 31, value: 16 }
    ])
    expect(spec({ memory: [[20, 5], ['n', 3], { address: 21, value: 9 }] }).memory).toEqual([
      { at: 20, value: 5 },
      { at: 'n', value: 3 },
      { at: 21, value: 9 }
    ])
    expect(spec({ memory: { '40': 1, '-1': 1, '3': 999, '4': 1.5, 'a b': 1, '5': null } }).memory).toEqual([])
    expect(spec({ memory: 'lots' }).memory).toEqual([])
    expect(spec({ memory: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, 1])) }).memory).toHaveLength(CPU_LIMITS.preload)
  })

  it('keeps run in a tour and drops verbs it does not know', () => {
    const s = spec({ tour: [{ at: 'IR', say: 'Fetch.', do: { run: 3, explode: 1 } }, { at: 'pc', say: 'Nothing to do.', do: { insert: 4 } }] })
    expect(s.tour[0]).toEqual({ at: 'ir', say: 'Fetch.', do: { run: 3 } })
    expect(s.tour[1].do).toBeUndefined()
  })
})

describe('cpu: parts', () => {
  const asm = assemble(DEFAULT_PROGRAM)

  it('parses the names', () => {
    expect(parseCpuPart('pc', asm)).toEqual({ type: 'pc' })
    expect(parseCpuPart(' IR ', asm)).toEqual({ type: 'ir' })
    expect(parseCpuPart('phase', asm)).toEqual({ type: 'phase' })
    expect(parseCpuPart('program', asm)).toEqual({ type: 'program' })
    expect(parseCpuPart('memory', asm)).toEqual({ type: 'memory' })
    expect(parseCpuPart('flags', asm)).toEqual({ type: 'flags' })
    expect(parseCpuPart('register:0', asm)).toEqual({ type: 'register', i: 0 })
    expect(parseCpuPart('register:r3', asm)).toEqual({ type: 'register', i: 3 })
    expect(parseCpuPart('R2', asm)).toEqual({ type: 'register', i: 2 })
    expect(parseCpuPart('register:4', asm)).toBeNull()
    expect(parseCpuPart('flag:z', asm)).toEqual({ type: 'flag', f: 'z' })
    expect(parseCpuPart('flag:overflow', asm)).toEqual({ type: 'flag', f: 'v' })
    expect(parseCpuPart('flag:q', asm)).toBeNull()
    expect(parseCpuPart('memory:19', asm)).toEqual({ type: 'cell', a: 19 })
    expect(parseCpuPart('memory:total', asm)).toEqual({ type: 'cell', a: 19 })
    expect(parseCpuPart('memory:32', asm)).toBeNull()
    expect(parseCpuPart('memory:nowhere', asm)).toBeNull()
    expect(parseCpuPart('line:4', asm)).toEqual({ type: 'line', n: 4 })
    expect(parseCpuPart('line:loop', asm)).toEqual({ type: 'line', n: 4 })
    expect(parseCpuPart('line:12', asm)).toBeNull()
    expect(parseCpuPart('line:0', asm)).toBeNull()
    expect(parseCpuPart('line:1:2', asm)).toBeNull()
    expect(parseCpuPart('nonsense', asm)).toBeNull()
    // A line with only a comment is not a part
    expect(parseCpuPart('line:1', assemble('; note\nHALT'))).toBeNull()
  })

  it('describes each part with its current numbers', () => {
    const m = loadMachine(asm)
    const say = (name: string) => describeCpuPart(parseCpuPart(name, asm)!, m, asm)
    expect(say('ir').label).toBe('the instruction register (empty until the first fetch)')
    expect(say('line:1').label).toBe('line 1 of the program, LOADI R0, 0 (at address 0, stored as 10 00; it is fetched next)')
    m.run(23) // seven instructions, then the eighth (ADD R0, R1 the second time round) fetched and decoded
    expect(m.phase).toBe('execute')
    expect(say('pc').label).toBe('the program counter (8: the next instruction is fetched from address 8)')
    expect(say('ir').label).toBe('the instruction register (40 01, fetched from address 6, which means ADD R0, R1)')
    expect(say('ir').values).toMatchObject({ IR: '40 01', binary: '0100 0000  0000 0001', opcode: 4 })
    expect(say('phase').label).toBe('the phase of the cycle (execute is next; 7 instructions completed)')
    expect(say('register:0')).toEqual({ label: 'register R0 (holds 5: 0000 0101 in binary, 05 in hexadecimal)', values: { decimal: 5, binary: '0000 0101', hex: '0x05', unsigned: 5 } })
    expect(say('line:4').label).toBe('line 4 of the program, ADD R0, R1 (at address 6, stored as 40 01; it is the instruction in IR now)')
    expect(say('memory:n').label).toBe('memory cell 18, labelled n (holds 5: 0000 0101 in binary, 05 in hexadecimal; data)')
    expect(say('memory:7').label).toBe('memory cell 7 (holds 1: 0000 0001 in binary, 01 in hexadecimal; the second byte of ADD R0, R1)')
    expect(say('memory:30').label).toContain('unused')
    expect(say('program').label).toBe('the program (9 instructions in 20 of the 32 memory cells)')
    expect(say('memory').values).toEqual({ cells: 32, code: 18, data: 2 })
    m.run()
    expect(say('flag:z').label).toBe('the zero flag Z (1: the last ADD or SUB gave zero)')
    expect(say('flag:n').label).toBe('the negative flag N (0: bit 7 of the last ADD or SUB result was 0)')
    expect(say('flags').values).toEqual({ Z: 1, N: 0, C: 0, V: 0 })
    expect(say('memory:total').values).toMatchObject({ decimal: 15, hex: '0x0F', kind: 'data' })
    expect(say('phase').label).toBe('the phase of the cycle (the machine has stopped; 24 instructions completed)')
  })

  it('describes a negative register in all three forms', () => {
    const neg = assemble('LOADI R1, -3\nHALT')
    const m = loadMachine(neg)
    m.run()
    expect(describeCpuPart({ type: 'register', i: 1 }, m, neg)).toEqual({
      label: 'register R1 (holds −3: 1111 1101 in binary, FD in hexadecimal)',
      values: { decimal: -3, binary: '1111 1101', hex: '0xFD', unsigned: 253 }
    })
  })
})
