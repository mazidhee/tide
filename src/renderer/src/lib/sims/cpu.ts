/**
 * A tiny register machine: the assembler, the encoding, the machine itself and its named parts.
 *
 * Words are 8 bits, read as two's complement (−128 to 127). There are four registers (R0 to R3),
 * 32 memory cells, a program counter, a two-byte instruction register and four flags (Z, N, C, V).
 * Every instruction is two bytes, so the program lives in memory as numbers and fetch really
 * reads them:
 *
 *   byte 1: opcode in the high four bits, a register number in the low four
 *   byte 2: the operand (a value, an address, or a second register number)
 *
 *   00 00  HALT            stop
 *   1r nn  LOADI r, n      r ← n
 *   2r aa  LOAD  r, a      r ← memory[a]
 *   3r aa  STORE r, a      memory[a] ← r
 *   4r 0s  ADD   r, s      r ← r + s, sets the flags
 *   5r 0s  SUB   r, s      r ← r − s, sets the flags
 *   60 aa  JMP   a         PC ← a
 *   70 aa  JZ    a         PC ← a if Z is set
 *   80 aa  JN    a         PC ← a if N is set
 *
 * Only ADD and SUB change the flags. C after SUB means a borrow (the first operand, read as
 * unsigned, was the smaller). One step of the machine is one phase: fetch, decode or execute.
 */
import type { PartInfo } from './parts'
import { int, onlyVerbs, type Raw, type SimBase } from './specUtil'

export const MEMORY_SIZE = 32
export const REGISTERS = 4
export const CPU_LIMITS = { program: 2400, lines: 48, preload: 16, limit: [10, 1600] as const }

export const DEFAULT_PROGRAM = [
  '        LOADI R0, 0     ; total',
  '        LOAD  R1, n     ; counter, counting down',
  '        LOADI R2, 1',
  'loop:   ADD   R0, R1    ; total = total + counter',
  '        SUB   R1, R2    ; counter = counter - 1',
  '        JZ    done      ; the SUB gave zero',
  '        JMP   loop',
  'done:   STORE R0, total',
  '        HALT',
  'n:      DATA  5',
  'total:  DATA  0'
].join('\n')

// ---------- Numbers ----------

/** A byte read as two's complement: 0…127 stay, 128…255 become −128…−1 */
export const toSigned = (v: number) => ((v & 0xff) ^ 0x80) - 0x80

/** Binary in groups of four: 253 → "1111 1101" */
export function bin(v: number, bits = 8): string {
  const digits = (v & (2 ** bits - 1)).toString(2).padStart(bits, '0')
  return digits.replace(/(?=(?:.{4})+$)/g, ' ').trim()
}

export const hex = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0')

/** Signed decimal with a real minus sign */
export const dec = (v: number) => (v < 0 ? `−${-v}` : String(v))

export const signedText = (byte: number) => dec(toSigned(byte))

/** The two's-complement reading written out: 253 → "−128 + 64 + 32 + 16 + 8 + 4 + 1 = −3" */
export function placeValues(byte: number): string {
  const b = byte & 0xff
  const terms: string[] = []
  if (b & 0x80) terms.push('−128')
  for (let i = 6; i >= 0; i--) if (b & (1 << i)) terms.push(String(1 << i))
  if (!terms.length) return '0'
  return terms.length === 1 ? terms[0] : `${terms.join(' + ')} = ${signedText(b)}`
}

export interface Flags {
  z: number
  n: number
  c: number
  v: number
}

export interface AluResult extends Flags {
  result: number
}

function flagsOf(result: number, c: boolean, v: boolean): AluResult {
  return { result, z: result === 0 ? 1 : 0, n: result >> 7, c: c ? 1 : 0, v: v ? 1 : 0 }
}

/** a + b in 8 bits. C: carry out of bit 7. V: the signed sum does not fit. */
export function add8(a: number, b: number): AluResult {
  const sum = (a & 0xff) + (b & 0xff)
  const signed = toSigned(a) + toSigned(b)
  return flagsOf(sum & 0xff, sum > 0xff, signed > 127 || signed < -128)
}

/** a − b in 8 bits. C: a borrow (unsigned a < b). V: the signed difference does not fit. */
export function sub8(a: number, b: number): AluResult {
  const diff = (a & 0xff) - (b & 0xff)
  const signed = toSigned(a) - toSigned(b)
  return flagsOf(diff & 0xff, diff < 0, signed > 127 || signed < -128)
}

// ---------- The instruction set ----------

export type OpName = 'HALT' | 'LOADI' | 'LOAD' | 'STORE' | 'ADD' | 'SUB' | 'JMP' | 'JZ' | 'JN'
type Form = 'none' | 'reg-value' | 'reg-address' | 'reg-reg' | 'address'

export interface OpDef {
  code: number
  name: OpName
  form: Form
  /** How it is written, for the reference */
  syntax: string
  /** Its two bytes in hexadecimal, with letters for the fields */
  encoding: string
  effect: string
  example: string
  needs: string
}

export const OPS: readonly OpDef[] = [
  { code: 0, name: 'HALT', form: 'none', syntax: 'HALT', encoding: '00 00', effect: 'stop', example: 'HALT', needs: 'no operands' },
  { code: 1, name: 'LOADI', form: 'reg-value', syntax: 'LOADI r, n', encoding: '1r nn', effect: 'r ← n', example: 'LOADI R1, 5', needs: 'a register and a value' },
  { code: 2, name: 'LOAD', form: 'reg-address', syntax: 'LOAD r, a', encoding: '2r aa', effect: 'r ← memory[a]', example: 'LOAD R1, 20', needs: 'a register and an address' },
  { code: 3, name: 'STORE', form: 'reg-address', syntax: 'STORE r, a', encoding: '3r aa', effect: 'memory[a] ← r', example: 'STORE R1, 20', needs: 'a register and an address' },
  { code: 4, name: 'ADD', form: 'reg-reg', syntax: 'ADD r, s', encoding: '4r 0s', effect: 'r ← r + s, sets flags', example: 'ADD R0, R1', needs: 'two registers' },
  { code: 5, name: 'SUB', form: 'reg-reg', syntax: 'SUB r, s', encoding: '5r 0s', effect: 'r ← r − s, sets flags', example: 'SUB R0, R1', needs: 'two registers' },
  { code: 6, name: 'JMP', form: 'address', syntax: 'JMP a', encoding: '60 aa', effect: 'PC ← a', example: 'JMP loop', needs: 'an address or a label' },
  { code: 7, name: 'JZ', form: 'address', syntax: 'JZ a', encoding: '70 aa', effect: 'PC ← a if Z = 1', example: 'JZ done', needs: 'an address or a label' },
  { code: 8, name: 'JN', form: 'address', syntax: 'JN a', encoding: '80 aa', effect: 'PC ← a if N = 1', example: 'JN done', needs: 'an address or a label' }
]

const BY_NAME = new Map<string, OpDef>(OPS.map((op) => [op.name, op]))

const ALIASES: Record<string, OpName> = {
  HLT: 'HALT',
  STOP: 'HALT',
  END: 'HALT',
  LDI: 'LOADI',
  LI: 'LOADI',
  MOVI: 'LOADI',
  LD: 'LOAD',
  LDA: 'LOAD',
  ST: 'STORE',
  STO: 'STORE',
  STA: 'STORE',
  JUMP: 'JMP',
  GOTO: 'JMP',
  BR: 'JMP',
  BZ: 'JZ',
  BEQ: 'JZ',
  BRZ: 'JZ',
  JEQ: 'JZ',
  BN: 'JN',
  BMI: 'JN',
  BRN: 'JN',
  JNEG: 'JN',
  JLT: 'JN'
}

const DATA_WORDS = new Set(['DATA', '.DATA', 'DAT', 'DB', '.BYTE', 'BYTE', '.WORD', 'WORD'])

const opNamed = (word: string): OpDef | undefined => BY_NAME.get(word) ?? BY_NAME.get(ALIASES[word] ?? '')

export interface Instruction {
  op: OpName
  /** Register number in the first byte (0 where the instruction has none) */
  r: number
  /** The second byte */
  operand: number
}

export function encode(i: Instruction): [number, number] {
  const op = BY_NAME.get(i.op)!
  return [((op.code << 4) | (i.r & 0x0f)) & 0xff, i.operand & 0xff]
}

export interface Decoded {
  opcode: number
  r: number
  operand: number
  op: OpDef | null
  /** Why the two bytes are not an instruction this machine can run, or null */
  fault: string | null
  /** The instruction as it would be written: "ADD R0, R1" */
  text: string
}

export function decode(b0: number, b1: number): Decoded {
  const opcode = (b0 >> 4) & 0x0f
  const r = b0 & 0x0f
  const operand = b1 & 0xff
  const op = OPS[opcode] ?? null
  let fault: string | null = null
  let text = '??'
  if (!op) fault = `opcode ${opcode} is not an instruction`
  else {
    const usesR = op.form === 'reg-value' || op.form === 'reg-address' || op.form === 'reg-reg'
    const usesA = op.form === 'reg-address' || op.form === 'address'
    if (usesR && r >= REGISTERS) fault = `register field ${r} is not a register (R0 to R3)`
    else if (op.form === 'reg-reg' && operand >= REGISTERS) fault = `operand ${operand} is not a register (R0 to R3)`
    else if (usesA && operand >= MEMORY_SIZE) fault = `address ${operand} is outside memory (0 to ${MEMORY_SIZE - 1})`
    if (!fault)
      text =
        op.form === 'none'
          ? op.name
          : op.form === 'reg-value'
            ? `${op.name} R${r}, ${toSigned(operand)}`
            : op.form === 'reg-address'
              ? `${op.name} R${r}, ${operand}`
              : op.form === 'reg-reg'
                ? `${op.name} R${r}, R${operand}`
                : `${op.name} ${operand}`
  }
  return { opcode, r, operand, op, fault, text }
}

// ---------- The assembler ----------

export type CellKind = 'code' | 'data' | 'unused'

export interface AsmLine {
  /** Line number, from 1 */
  line: number
  /** The line as written */
  source: string
  label: string
  /** The instruction or DATA with its operands, tidied; '' for a blank or comment-only line */
  code: string
  comment: string
  /** Where its bytes start, or null when the line holds no instruction or data */
  address: number | null
  bytes: number[]
  kind: 'code' | 'data' | 'none'
}

export interface AsmError {
  line: number
  message: string
}

export interface Assembly {
  ok: boolean
  lines: AsmLine[]
  errors: AsmError[]
  /** The memory image (all zeros when it did not assemble) */
  image: Uint8Array
  kinds: CellKind[]
  /** Label → address, labels in lower case */
  labels: Record<string, number>
  /** Cells used by the program and its data */
  size: number
}

/**
 * Splits a program into lines. Instructions are separated by new lines; a program written on
 * one line may separate them with ";" instead. A model that escaped twice ("\\n") is forgiven.
 */
export function sourceLines(program: string): string[] {
  const text = program.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
  const lines = text.includes('\n') ? text.split('\n').map((l) => l.replace(/\s+$/, '')) : text.split(';').map((l) => l.trim())
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.slice(0, CPU_LIMITS.lines).map((l) => l.slice(0, 80))
}

/** Where a comment starts: ";" or "//", or "#" unless it marks a value (#5) */
function commentAt(line: string): number {
  const m = /;|\/\/|#(?![-+]?[0-9a-z_])/i.exec(line)
  return m ? m.index : -1
}

function parseNumber(word: string): number | null {
  const w = word.replace(/_/g, '')
  const m = /^([-+−]?)(0x[0-9a-f]+|0b[01]+|\$[0-9a-f]+|\d+)$/i.exec(w)
  if (!m) return null
  const body = m[2].toLowerCase()
  const value = body.startsWith('0x') ? parseInt(body.slice(2), 16) : body.startsWith('$') ? parseInt(body.slice(1), 16) : body.startsWith('0b') ? parseInt(body.slice(2), 2) : parseInt(body, 10)
  return m[1] === '-' || m[1] === '−' ? -value : value
}

const registerOf = (word: string): number | null => {
  const m = /^r(\d+)$/i.exec(word)
  return m ? Number(m[1]) : null
}

const LABEL = /^[a-z_][a-z0-9_]*$/i

interface Pending {
  entry: AsmLine
  op: OpDef | null
  words: string[]
}

export function assemble(program: string): Assembly {
  const errors: AsmError[] = []
  const labels: Record<string, number> = {}
  const labelLine: Record<string, number> = {}
  const lines: AsmLine[] = []
  const pending: Pending[] = []
  const waiting: { name: string; line: number }[] = []
  let at = 0
  let overflowed = false

  const fail = (line: number, message: string) => {
    if (errors.length < 8) errors.push({ line, message })
  }
  const define = (name: string, line: number, address: number) => {
    const key = name.toLowerCase()
    if (key in labels) fail(line, `Label "${name}" is already defined on line ${labelLine[key]}; expected a new name.`)
    else {
      labels[key] = address
      labelLine[key] = line
    }
  }
  const isWord = (w: string) => !!opNamed(w.toUpperCase()) || DATA_WORDS.has(w.toUpperCase())

  sourceLines(program).forEach((source, index) => {
    const line = index + 1
    const cut = commentAt(source)
    const comment = cut < 0 ? '' : source.slice(cut).replace(/^(;|\/\/|#)\s*/, '').trim()
    let body = (cut < 0 ? source : source.slice(0, cut)).trim()
    const entry: AsmLine = { line, source, label: '', code: '', comment, address: null, bytes: [], kind: 'none' }
    lines.push(entry)

    const colon = /^([^\s:]+)\s*:\s*(.*)$/.exec(body)
    let label = ''
    if (colon) {
      label = colon[1]
      body = colon[2]
    }
    const words = body.replace(/[,[\]()]/g, ' ').trim().split(/\s+/).filter(Boolean)
    // "loop ADD R0, R1": a label written without its colon
    if (!label && words.length > 1 && !isWord(words[0]) && isWord(words[1])) label = words.shift()!
    if (label) {
      entry.label = label
      if (BY_NAME.has(label.toUpperCase()) || DATA_WORDS.has(label.toUpperCase())) fail(line, `"${label}" cannot be a label: it is the name of an instruction.`)
      else if (registerOf(label) !== null) fail(line, `"${label}" cannot be a label: it would be read as a register.`)
      else if (!LABEL.test(label)) fail(line, `"${label}" is not a usable label; expected letters, digits or _ and not a digit first.`)
      else waiting.push({ name: label, line })
    }
    if (!words.length) return

    const head = words[0].toUpperCase()
    const rest = words.slice(1)
    for (const w of waiting.splice(0)) define(w.name, w.line, at)
    if (DATA_WORDS.has(head)) {
      entry.kind = 'data'
      entry.code = `DATA ${rest.join(', ')}`.trim()
      if (!rest.length) fail(line, 'DATA needs at least one value, as in "DATA 5"; found nothing.')
      entry.bytes = rest.map(() => 0)
      pending.push({ entry, op: null, words: rest })
    } else {
      let op = opNamed(head)
      if (!op) {
        fail(line, `Unknown instruction "${words[0]}"; expected one of ${OPS.map((o) => o.name).join(', ')} or DATA.`)
        return
      }
      // "LOAD R1, #5" means the value 5, not the cell at address 5
      if (op.name === 'LOAD' && rest[1]?.startsWith('#')) op = BY_NAME.get('LOADI')!
      entry.kind = 'code'
      entry.code = `${op.name} ${rest.map((w) => (registerOf(w) !== null ? w.toUpperCase() : w)).join(', ')}`.trim()
      entry.bytes = [0, 0]
      pending.push({ entry, op, words: rest })
    }
    entry.address = at
    at += entry.bytes.length
    if (at > MEMORY_SIZE && !overflowed) {
      overflowed = true
      fail(line, `The program does not fit: from this line on it would need more than the ${MEMORY_SIZE} cells of memory; expected a shorter program.`)
    }
  })
  // Labels after the last instruction name the next free cell
  for (const w of waiting) define(w.name, w.line, at)

  if (!pending.length && !errors.length) fail(1, 'The program is empty; expected at least one instruction, such as HALT.')

  const value = (word: string, line: number, what: 'value' | 'address'): number => {
    const bare = word.replace(/^#/, '')
    const n = parseNumber(bare)
    const resolved = n ?? labels[bare.toLowerCase()]
    if (resolved === undefined) {
      if (registerOf(bare) !== null) fail(line, `Expected ${what === 'value' ? 'a value' : 'an address or a label'} here, but found the register "${word}".`)
      else if (LABEL.test(bare)) fail(line, `Unknown label "${bare}"; expected a label defined in the program or ${what === 'value' ? 'a number' : `an address from 0 to ${MEMORY_SIZE - 1}`}.`)
      else fail(line, `"${word}" is not a number or a label; expected ${what === 'value' ? 'a value such as 5, -3 or 0x1F' : `an address from 0 to ${MEMORY_SIZE - 1} or a label`}.`)
      return 0
    }
    if (what === 'address' && (resolved < 0 || resolved >= MEMORY_SIZE)) {
      // A label past the end is already reported as the program not fitting
      if (n !== null) fail(line, `Address ${resolved} is outside memory; expected 0 to ${MEMORY_SIZE - 1}.`)
      return 0
    }
    if (what === 'value' && (resolved < -128 || resolved > 255)) {
      fail(line, `The value ${resolved} does not fit in 8 bits; expected −128 to 255.`)
      return 0
    }
    return resolved & 0xff
  }
  const register = (word: string, line: number): number => {
    const r = registerOf(word)
    if (r === null || r >= REGISTERS) {
      fail(line, `"${word}" is not a register; expected R0, R1, R2 or R3.`)
      return 0
    }
    return r
  }

  for (const { entry, op, words } of pending) {
    const line = entry.line
    if (!op) {
      entry.bytes = words.map((w) => value(w, line, 'value'))
      continue
    }
    const want = op.form === 'none' ? 0 : op.form === 'address' ? 1 : 2
    if (words.length !== want) {
      fail(line, `${op.name} needs ${op.needs}, as in "${op.example}"; found ${words.length ? `"${words.join(', ')}"` : 'nothing'}.`)
      continue
    }
    let r = 0
    let operand = 0
    if (op.form === 'reg-value' || op.form === 'reg-address') {
      r = register(words[0], line)
      operand = value(words[1], line, op.form === 'reg-value' ? 'value' : 'address')
    } else if (op.form === 'reg-reg') {
      r = register(words[0], line)
      if (registerOf(words[1]) === null) fail(line, `${op.name} needs two registers, as in "${op.example}"; found "${words[1]}" where the second register should be.`)
      else operand = register(words[1], line)
    } else if (op.form === 'address') operand = value(words[0], line, 'address')
    entry.bytes = encode({ op: op.name, r, operand })
  }

  errors.sort((a, b) => a.line - b.line)
  const ok = errors.length === 0
  const image = new Uint8Array(MEMORY_SIZE)
  const kinds: CellKind[] = Array.from({ length: MEMORY_SIZE }, () => 'unused')
  if (ok)
    for (const entry of lines) {
      if (entry.address === null) continue
      entry.bytes.forEach((b, k) => {
        image[entry.address! + k] = b
        kinds[entry.address! + k] = entry.kind === 'code' ? 'code' : 'data'
      })
    }
  return { ok, lines, errors, image, kinds, labels: ok ? labels : {}, size: ok ? at : 0 }
}

// ---------- The machine ----------

export type Phase = 'fetch' | 'decode' | 'execute'
export const PHASES: readonly Phase[] = ['fetch', 'decode', 'execute']

export interface Trace {
  phase: Phase
  /** What moved where, and why */
  text: string
  /** Part names written in this phase: 'pc', 'ir', 'register:1', 'memory:19', 'flag:z' */
  changed: string[]
  /** Memory addresses read in this phase */
  read: number[]
}

export interface Preload {
  /** An address, or a label from the program */
  at: number | string
  value: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export class Machine {
  readonly mem = new Uint8Array(MEMORY_SIZE)
  readonly reg = new Uint8Array(REGISTERS)
  kinds: CellKind[]
  pc = 0
  ir: [number, number] = [0, 0]
  /** Where the instruction in IR was fetched from, or null before the first fetch */
  irAt: number | null = null
  flags: Flags = { z: 0, n: 0, c: 0, v: 0 }
  /** The phase the next step performs */
  phase: Phase = 'fetch'
  /** What IR means, once decoded */
  decoded: Decoded | null = null
  halted = false
  fault: string | null = null
  /** Instructions completed */
  instructions = 0
  last: Trace | null = null

  constructor(
    image: ArrayLike<number>,
    kinds: readonly CellKind[],
    readonly limit = 400
  ) {
    for (let i = 0; i < MEMORY_SIZE; i++) this.mem[i] = (image[i] ?? 0) & 0xff
    this.kinds = Array.from({ length: MEMORY_SIZE }, (_, i) => kinds[i] ?? 'unused')
  }

  /** Why the machine will not step again, or null while it can */
  get stopped(): string | null {
    if (this.halted) return `Halted after ${plural(this.instructions, 'instruction')}`
    if (this.fault) return `Stopped: ${this.fault}`
    if (this.phase === 'fetch' && this.instructions >= this.limit) return `Stopped after ${this.instructions} instructions without reaching HALT (the limit for one run)`
    return null
  }

  /** One phase. Returns what happened, or null when the machine has stopped. */
  step(): Trace | null {
    if (this.stopped) return null
    const trace = this.phase === 'fetch' ? this.fetch() : this.phase === 'decode' ? this.decodePhase() : this.execute()
    this.last = trace
    return trace
  }

  /** Runs whole phases until the machine stops or `phases` have run; returns how many ran */
  run(phases = Infinity): number {
    let did = 0
    while (did < phases && this.step()) did++
    return did
  }

  private fetch(): Trace {
    const at = this.pc
    if (at + 1 >= MEMORY_SIZE) {
      this.fault = `the program counter (${at}) ran past the end of memory without reaching HALT`
      return { phase: 'fetch', text: `Fetch: PC is ${at}, but an instruction needs two cells and memory ends at ${MEMORY_SIZE - 1}. The machine stops.`, changed: [], read: [] }
    }
    this.ir = [this.mem[at], this.mem[at + 1]]
    this.irAt = at
    this.decoded = null
    this.pc = at + 2
    this.phase = 'decode'
    return {
      phase: 'fetch',
      text: `Fetch: IR ← memory[${at}] and memory[${at + 1}], the two bytes ${hex(this.ir[0])} ${hex(this.ir[1])}. PC moves on from ${at} to ${this.pc}, the next instruction.`,
      changed: ['ir', 'pc'],
      read: [at, at + 1]
    }
  }

  private decodePhase(): Trace {
    const d = decode(this.ir[0], this.ir[1])
    this.decoded = d
    const bits = `${hex(this.ir[0])} ${hex(this.ir[1])}`
    if (d.fault || !d.op) {
      this.fault = `${bits} at address ${this.irAt} is not an instruction (${d.fault})`
      return { phase: 'decode', text: `Decode: ${bits} cannot be run: ${d.fault}. The machine stops; data was probably reached as if it were code.`, changed: [], read: [] }
    }
    this.phase = 'execute'
    const op = d.op
    const first = `the high four bits of ${hex(this.ir[0])} are ${bin(d.opcode, 4)}, opcode ${d.opcode}: ${op.name}`
    const what =
      op.form === 'none'
        ? `${first}. It takes no operands.`
        : op.form === 'reg-value'
          ? `${first}. The low four bits name R${d.r}; the second byte ${hex(d.operand)} is the value ${signedText(d.operand)} itself.`
          : op.form === 'reg-address'
            ? `${first}. The low four bits name R${d.r}; the second byte ${hex(d.operand)} is the address ${d.operand}.`
            : op.form === 'reg-reg'
              ? `${first}. The low four bits name R${d.r}; the second byte ${hex(d.operand)} names R${d.operand}.`
              : `${first}. The second byte ${hex(d.operand)} is the address ${d.operand}.`
    return { phase: 'decode', text: `Decode: ${what} So IR holds ${d.text.replace('-', '−')}.`, changed: [], read: [] }
  }

  private execute(): Trace {
    const d = this.decoded!
    const op = d.op!
    const r = d.r
    const changed: string[] = []
    const read: number[] = []
    let text = ''
    switch (op.name) {
      case 'HALT':
        this.halted = true
        text = 'HALT stops the machine. Nothing else changes.'
        break
      case 'LOADI':
        this.reg[r] = d.operand
        changed.push(`register:${r}`)
        text = `R${r} ← ${signedText(d.operand)}. The value came from the instruction itself; the flags are left alone.`
        break
      case 'LOAD':
        this.reg[r] = this.mem[d.operand]
        changed.push(`register:${r}`)
        read.push(d.operand)
        text = `R${r} ← memory[${d.operand}] = ${signedText(this.reg[r])}. The cell keeps its value; the flags are left alone.`
        break
      case 'STORE': {
        const wasCode = this.kinds[d.operand] === 'code'
        this.mem[d.operand] = this.reg[r]
        if (this.kinds[d.operand] === 'unused') this.kinds[d.operand] = 'data'
        changed.push(`memory:${d.operand}`)
        text = `memory[${d.operand}] ← R${r} = ${signedText(this.reg[r])}. R${r} keeps its value; the flags are left alone.${wasCode ? ' That cell holds part of the program, so the program itself has changed.' : ''}`
        break
      }
      case 'ADD':
      case 'SUB': {
        const add = op.name === 'ADD'
        const a = this.reg[r]
        const b = this.reg[d.operand]
        const out = add ? add8(a, b) : sub8(a, b)
        const exact = add ? toSigned(a) + toSigned(b) : toSigned(a) - toSigned(b)
        this.reg[r] = out.result
        this.flags = { z: out.z, n: out.n, c: out.c, v: out.v }
        changed.push(`register:${r}`, 'flag:z', 'flag:n', 'flag:c', 'flag:v')
        const sign = add ? '+' : '−'
        const sum = `R${r} ← R${r} ${sign} R${d.operand} = ${signedText(a)} ${sign} ${toSigned(b) < 0 ? `(${signedText(b)})` : signedText(b)} = ${dec(exact)}`
        const wrap = out.v ? `, which does not fit in 8 signed bits (−128 to 127) and wraps to ${signedText(out.result)}` : ''
        const carry = add
          ? out.c
            ? `as unsigned numbers ${a} + ${b} passes 255, a carry out of bit 7`
            : 'no carry out of bit 7'
          : out.c
            ? `as unsigned numbers ${a} is less than ${b}, so it borrows`
            : 'no borrow'
        text = `${sum}${wrap}. Flags: Z = ${out.z} (the result is ${out.z ? '' : 'not '}zero), N = ${out.n} (bit 7 is ${out.n}), C = ${out.c} (${carry}), V = ${out.v} (the signed result ${out.v ? 'does not fit' : 'fits'}).`
        break
      }
      case 'JMP':
        text = `PC ← ${d.operand}, so the next fetch reads address ${d.operand} instead of ${this.pc}.`
        this.pc = d.operand
        changed.push('pc')
        break
      case 'JZ':
      case 'JN': {
        const flag = op.name === 'JZ' ? 'Z' : 'N'
        const set = op.name === 'JZ' ? this.flags.z : this.flags.n
        if (set) {
          text = `${flag} is 1, so the branch is taken: PC ← ${d.operand} instead of ${this.pc}.`
          this.pc = d.operand
          changed.push('pc')
        } else text = `${flag} is 0, so the branch is not taken: PC stays at ${this.pc} and the next instruction follows.`
        break
      }
    }
    this.instructions++
    this.phase = 'fetch'
    return { phase: 'execute', text: `Execute: ${text}`, changed, read }
  }
}

/** A machine loaded with an assembled program and any preloaded cells (which win over the program's own bytes) */
export function loadMachine(asm: Assembly, preload: readonly Preload[] = [], limit = 400): Machine {
  const image = Uint8Array.from(asm.image)
  const kinds = asm.kinds.slice()
  for (const p of preload) {
    const at = typeof p.at === 'number' ? p.at : asm.labels[p.at.toLowerCase()]
    if (at === undefined || at < 0 || at >= MEMORY_SIZE) continue
    image[at] = p.value & 0xff
    if (kinds[at] === 'unused') kinds[at] = 'data'
  }
  return new Machine(image, kinds, limit)
}

// ---------- Spec ----------

export interface CpuSpec extends SimBase {
  kind: 'cpu'
  /** The program text, one instruction per line */
  program: string
  /** Cells set after the program is loaded */
  memory: Preload[]
  /** Instructions run before a program that has not halted is stopped */
  limit: number
}

const VERBS: readonly string[] = []

function programText(v: unknown): string {
  const text = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : typeof v === 'string' ? v : ''
  return sourceLines(text.slice(0, CPU_LIMITS.program)).join('\n')
}

function preloads(v: unknown): Preload[] {
  const out: Preload[] = []
  const add = (at: unknown, value: unknown) => {
    if (out.length >= CPU_LIMITS.preload) return
    const n = typeof value === 'number' ? value : typeof value === 'string' ? (parseNumber(value.trim()) ?? NaN) : NaN
    if (!Number.isInteger(n) || n < -128 || n > 255) return
    const where = typeof at === 'number' ? at : typeof at === 'string' ? (parseNumber(at.trim()) ?? at.trim().toLowerCase()) : null
    if (where === null || where === '') return
    if (typeof where === 'number' && (!Number.isInteger(where) || where < 0 || where >= MEMORY_SIZE)) return
    if (typeof where === 'string' && !LABEL.test(where)) return
    out.push({ at: where, value: n })
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      if (Array.isArray(item)) add(item[0], item[1])
      else if (item && typeof item === 'object') {
        const o = item as Raw
        add(o.at ?? o.address ?? o.addr ?? o.cell, o.value ?? o.v)
      }
    }
  } else if (v && typeof v === 'object') for (const [key, value] of Object.entries(v as Raw)) add(key, value)
  return out
}

export function parseCpuSpec(raw: Raw, base: SimBase): CpuSpec | null {
  const program = programText(raw.program ?? raw.code ?? raw.source ?? raw.asm ?? raw.assembly ?? raw.instructions)
  const spec: CpuSpec = {
    ...base,
    kind: 'cpu',
    program: program || DEFAULT_PROGRAM,
    memory: preloads(raw.memory ?? raw.data ?? raw.preload ?? raw.cells),
    limit: int(raw.limit ?? raw.maxInstructions ?? raw.max, 400, ...CPU_LIMITS.limit)
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- Named parts ----------

export type FlagName = 'z' | 'n' | 'c' | 'v'

export type CpuPart =
  | { type: 'pc' | 'ir' | 'phase' | 'program' | 'memory' | 'flags' }
  | { type: 'register'; i: number }
  | { type: 'flag'; f: FlagName }
  | { type: 'cell'; a: number }
  | { type: 'line'; n: number }

const FLAG_WORDS: Record<string, FlagName> = { z: 'z', zero: 'z', n: 'n', negative: 'n', neg: 'n', sign: 'n', c: 'c', carry: 'c', v: 'v', overflow: 'v', o: 'v' }
export const FLAG_NAMES: Record<FlagName, string> = { z: 'zero', n: 'negative', c: 'carry', v: 'overflow' }

/**
 * pc, ir, phase, program, memory, flags, register:N or register:rN (N is the register's number,
 * 0 to 3), flag:z|n|c|v, memory:A (an address 0 to 31, or a label), line:N (a program line from
 * 1, or a label).
 */
export function parseCpuPart(name: string, asm: Assembly): CpuPart | null {
  const [head, arg, ...more] = name.trim().toLowerCase().split(':')
  if (more.length) return null
  if (arg === undefined) {
    if (head === 'pc' || head === 'ir' || head === 'phase' || head === 'program' || head === 'memory' || head === 'flags') return { type: head }
    if (head === 'listing') return { type: 'program' }
    const r = registerOf(head)
    return r !== null && r < REGISTERS ? { type: 'register', i: r } : null
  }
  const whole = /^\d+$/.test(arg)
  if (head === 'register' || head === 'reg') {
    const r = whole ? Number(arg) : registerOf(arg)
    return r !== null && r < REGISTERS ? { type: 'register', i: r } : null
  }
  if (head === 'flag') return FLAG_WORDS[arg] ? { type: 'flag', f: FLAG_WORDS[arg] } : null
  if (head === 'memory' || head === 'mem' || head === 'cell') {
    const a = whole ? Number(arg) : asm.labels[arg]
    return a !== undefined && a >= 0 && a < MEMORY_SIZE ? { type: 'cell', a } : null
  }
  if (head === 'line') {
    const n = whole ? Number(arg) : asm.lines.find((l) => l.address !== null && l.bytes.length > 0 && l.address === asm.labels[arg])?.line
    const line = n === undefined ? undefined : asm.lines[n - 1]
    return line && line.address !== null ? { type: 'line', n: line.line } : null
  }
  return null
}

/** The name the program gives an address, if any */
export function labelAt(asm: Assembly, address: number): string | null {
  for (const [name, a] of Object.entries(asm.labels)) if (a === address) return name
  return null
}

const word = (byte: number) => `${signedText(byte)}: ${bin(byte)} in binary, ${hex(byte)} in hexadecimal`
const wordValues = (byte: number) => ({ decimal: toSigned(byte), binary: bin(byte), hex: `0x${hex(byte)}`, unsigned: byte })

export function describeCpuPart(part: CpuPart, m: Machine, asm: Assembly): PartInfo {
  switch (part.type) {
    case 'pc':
      return {
        label: `the program counter (${m.pc}: the next instruction is fetched from address ${m.pc})`,
        values: { PC: m.pc, binary: bin(m.pc), hex: `0x${hex(m.pc)}` }
      }
    case 'ir': {
      if (m.irAt === null) return { label: 'the instruction register (empty until the first fetch)', values: { IR: '00 00' } }
      const d = decode(m.ir[0], m.ir[1])
      return {
        label: `the instruction register (${hex(m.ir[0])} ${hex(m.ir[1])}, fetched from address ${m.irAt}, which ${d.fault ? 'is not an instruction' : `means ${d.text}`})`,
        values: { IR: `${hex(m.ir[0])} ${hex(m.ir[1])}`, binary: `${bin(m.ir[0])}  ${bin(m.ir[1])}`, opcode: d.opcode, means: d.fault ? 'not an instruction' : d.text }
      }
    }
    case 'phase':
      return {
        label: `the phase of the cycle (${m.stopped ? 'the machine has stopped' : `${m.phase} is next`}; ${plural(m.instructions, 'instruction')} completed)`,
        values: { next: m.stopped ? 'none' : m.phase, last: m.last?.phase ?? 'none', instructions: m.instructions }
      }
    case 'program': {
      const count = asm.lines.filter((l) => l.kind === 'code').length
      return {
        label: `the program (${plural(count, 'instruction')} in ${asm.size} of the ${MEMORY_SIZE} memory cells)`,
        values: { instructions: count, cells: asm.size, labels: Object.keys(asm.labels).join(' ') || 'none' }
      }
    }
    case 'memory':
      return {
        label: `memory (${MEMORY_SIZE} cells of 8 bits; cells 0 to ${Math.max(0, asm.size - 1)} hold the program and its data)`,
        values: { cells: MEMORY_SIZE, code: m.kinds.filter((k) => k === 'code').length, data: m.kinds.filter((k) => k === 'data').length }
      }
    case 'flags':
      return {
        label: `the flags (Z = ${m.flags.z}, N = ${m.flags.n}, C = ${m.flags.c}, V = ${m.flags.v}; set by the last ADD or SUB)`,
        values: { Z: m.flags.z, N: m.flags.n, C: m.flags.c, V: m.flags.v }
      }
    case 'register':
      return { label: `register R${part.i} (holds ${word(m.reg[part.i])})`, values: wordValues(m.reg[part.i]) }
    case 'flag': {
      const on = m.flags[part.f]
      const why: Record<FlagName, string> = {
        z: on ? 'the last ADD or SUB gave zero' : 'the last ADD or SUB did not give zero',
        n: on ? 'bit 7 of the last ADD or SUB result was 1' : 'bit 7 of the last ADD or SUB result was 0',
        c: on ? 'the last ADD carried out of bit 7, or the last SUB borrowed' : 'the last ADD or SUB had no carry or borrow',
        v: on ? 'the last signed result did not fit in −128 to 127' : 'the last signed result fitted in −128 to 127'
      }
      return { label: `the ${FLAG_NAMES[part.f]} flag ${part.f.toUpperCase()} (${on}: ${why[part.f]})`, values: { [part.f.toUpperCase()]: on, Z: m.flags.z, N: m.flags.n, C: m.flags.c, V: m.flags.v } }
    }
    case 'cell': {
      const a = part.a
      const label = labelAt(asm, a)
      const kind = m.kinds[a]
      const owner = asm.lines.find((l) => l.address !== null && a >= l.address && a < l.address + l.bytes.length)
      const role = kind === 'code' ? `${a === owner?.address ? 'the first' : 'the second'} byte of ${owner?.code ?? 'an instruction'}` : kind === 'data' ? 'data' : 'unused'
      return {
        label: `memory cell ${a}${label ? `, labelled ${label}` : ''} (holds ${word(m.mem[a])}; ${role})`,
        values: { ...wordValues(m.mem[a]), kind }
      }
    }
    case 'line': {
      const line = asm.lines[part.n - 1]
      const bytes = line.bytes.map(hex).join(' ')
      const now = line.kind === 'code' && m.phase !== 'fetch' && m.irAt === line.address ? '; it is the instruction in IR now' : line.kind === 'code' && m.phase === 'fetch' && m.pc === line.address && !m.stopped ? '; it is fetched next' : ''
      return {
        label: `line ${line.line} of the program, ${line.code} (at address ${line.address}, stored as ${bytes}${now})`,
        values: { address: line.address ?? 0, bytes, binary: line.bytes.map((b) => bin(b)).join('  '), label: line.label || 'none' }
      }
    }
  }
}
