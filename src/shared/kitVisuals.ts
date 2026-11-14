/**
 * Tide's own visuals for the basics of how computers work, built on the computing kit
 * (TideMachine, shared/frame/machine): they need no model, so a lesson shows them whoever teaches
 * (Claude, Gemma, or nobody yet), and they are what a ```draw block names first. Each is a visual
 * as Claude would write one (shared/visuals): it runs in the same sandboxed frame and passes the
 * same checks. Python ones carry their snippet; Tide traces it before the frame starts.
 */

export interface KitVisual {
  id: string
  title: string
  /** What it shows, in a line, for the tutor's list */
  shows: string
  /** Words that name its concept: a lesson step or a ```draw block matching them gets it */
  match: RegExp
  code: string
}

const BINARY = `<title>Eight bits as switches and bulbs</title>
<div id="reg"></div>
<script>
const goal = TideMath.goal('Goal: make 173 with the switches')
const reg = TideMachine.bits('#reg', { n: 8, value: 0b00000101, onChange: v => goal(v === 173) })
visual.onReset(() => reg.set(0b00000101))
</script>`

const SIGNED = `<title>Two's complement: the top bit weighs −128</title>
<div id="reg"></div>
<script>
const reg = TideMachine.bits('#reg', { n: 8, signed: true, value: -5 })
const plan = [
  { v: 5, say: '5 is 0000 0101: 4 + 1.' },
  { v: ~5 & 255, mark: [0,1,2,3,4,5,6,7], say: 'Flip every bit: 1111 1010. Read with the top bit as −128 that is −128 + 64 + 32 + 16 + 8 + 2 = −6.' },
  { v: -5, mark: [7], say: 'Add 1: 1111 1011 = −128 + 64 + 32 + 16 + 8 + 2 + 1 = −5. Flip and add one is how a CPU negates.' },
  { v: -5 + 5, say: 'Check: −5 + 5 in 8 bits is 1 0000 0000; the ninth bit falls off, leaving 0000 0000 = 0.' }
]
visual.steps(plan.map(p => p.say), i => { reg.set(TideMachine.signed(TideMachine.unsigned(plan[i].v, 8), 8)); reg.mark(plan[i].mark || [], '') })
</script>`

const HEX = `<title>One hex digit is four bits</title>
<div id="reg"></div>
<script>
const reg = TideMachine.bits('#reg', { n: 16, value: 0x2F, label: '16 bits = 4 hex digits = 2 bytes' })
const values = [0x2F, 0x00FF, 0x0100, 0xCAFE]
visual.steps(values.map(v => '0x' + TideMachine.hex(v, 4) + ' = ' + v + ': each hex digit is the four bits above it, so hex is binary written short.'), i => reg.set(values[i]))
</script>`

const GATES = `<title>A half adder: XOR for the sum, AND for the carry</title>
<div id="c"></div><div id="t"></div>
<script>
const c = TideMachine.circuit('#c', TideMachine.circuits.halfAdder(), { label: 'A half adder' })
TideMachine.truthTable('#t', c)
const s = c.stepsFor({ A: 1, B: 1 }, { A: 0, B: 0 })
visual.steps(s.captions, s.draw)
</script>`

const FULL_ADDER = `<title>A full adder: two half adders and an OR</title>
<div id="c"></div><div id="t"></div>
<script>
const c = TideMachine.circuit('#c', TideMachine.circuits.fullAdder(), { label: 'A full adder' })
TideMachine.truthTable('#t', c)
const s = c.stepsFor({ A: 1, B: 1, Cin: 1 }, { A: 0, B: 0, Cin: 0 })
visual.steps(s.captions, s.draw)
</script>`

const RIPPLE = `<title>A 4-bit ripple-carry adder: 7 + 1</title>
<div id="c"></div>
<script>
// 7 = 0111 and 1 = 0001, bit 0 at the top: the carry ripples down through every adder
const c = TideMachine.circuit('#c', TideMachine.circuits.rippleAdder(4), { label: 'A 4-bit ripple-carry adder' })
const s = c.stepsFor({ A0: 1, A1: 1, A2: 1, A3: 0, B0: 1, B1: 0, B2: 0, B3: 0 })
visual.steps(s.captions, s.draw, 900)
</script>`

const MUX = `<title>A multiplexer: Sel picks which input goes through</title>
<div id="c"></div><div id="t"></div>
<script>
const c = TideMachine.circuit('#c', TideMachine.circuits.mux2(), { label: 'A 2-to-1 multiplexer' })
c.set({ D0: 1, D1: 0, S: 0 })
TideMachine.truthTable('#t', c)
</script>`

const CPU = `<title>Fetch, decode, execute: 5 + 3</title>
<div id="cpu"></div>
<script>
const cpu = TideMachine.cpu('#cpu', { asm: \`
  LOADI R0, 5      ; R0 = 5
  LOADI R1, 3      ; R1 = 3
  ADD   R0, R1     ; R0 = R0 + R1
  STORE R0, [0x0E] ; memory[14] = R0
  HALT\` })
visual.steps(cpu.captions, cpu.draw, 1600)
</script>`

const MEMORY = `<title>An int in memory: four bytes, lowest first</title>
<div id="m"></div>
<script>
const mem = TideMachine.memory('#m', { size: 32, base: 0x1000, cols: 8, label: 'Memory from 0x1000' })
const plan = [
  () => mem.clear().write(0x1000, new Array(32).fill(0)),
  () => mem.writeInt(0x1004, 1000, { label: 'x' }),
  () => mem.writeInt(0x100C, 1000, { label: 'y', endian: 'big', color: 'c2' }),
  () => mem.write(0x1018, [0x04, 0x10, 0, 0]).mark(0x1018, 4, { label: 'p: pointer to x\\nholds 0x00001004', color: 'c4' }).pointer(0x1018, 0x1004)
]
const say = [
  'Thirty-two bytes of memory. Every byte has an address; a byte holds 0 to 255, written as two hex digits.',
  'x = 1000 as a 4-byte int: 1000 = 0x000003E8. Little-endian (x86, ARM) stores the lowest byte first: E8 03 00 00.',
  'The same number big-endian, highest byte first: 00 00 03 E8. Same value, opposite byte order.',
  'A pointer is just a number: p holds 0x00001004, the address where x starts (stored little-endian too).'
]
visual.steps(say, i => { mem.clear().write(0x1000, new Array(32).fill(0)); for (let k = 1; k <= i; k++) plan[k]() })
</script>`

const PY_NAMES = `<title>Names point at objects: b = a makes no copy</title>
<script type="text/x-python">
a = [1, 2]
b = a
b.append(3)
print(a)
</script>
<div id="py"></div>
<script>
const py = TideMachine.python('#py')
visual.steps(py.captions, py.draw, 1800)
</script>`

const PY_FRAMES = `<title>Call frames: factorial(4)</title>
<script type="text/x-python">
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

result = factorial(4)
print(result)
</script>
<div id="py"></div>
<script>
const py = TideMachine.python('#py')
visual.steps(py.captions, py.draw, 1400)
</script>`

const PY_INT = `<title>How Python stores an int</title>
<script type="text/x-python">
small = 7
big = 2 ** 40 + 5
neg = -big
</script>
<div id="py"></div>
<script>
const py = TideMachine.python('#py', { digits: true })
visual.steps(py.captions, py.draw, 1600)
</script>`

const DIE = `<title>Inside a CPU: cores, caches and memory</title>
<div id="s"></div>
<script>
const die = TideMachine.die('#s', { cores: 4 })
visual.steps(die.captions, die.draw, 3500)
</script>`

const GPU = `<title>Inside a GPU: SMs, warps and memory</title>
<div id="s"></div>
<script>
const gpu = TideMachine.gpu('#s', { sms: 8 })
visual.steps(gpu.captions, gpu.draw, 3500)
</script>`

export const KIT_VISUALS: KitVisual[] = [
  { id: 'binary-place-value', title: 'Eight bits as switches and bulbs', shows: 'a byte as switches and bulbs, place values adding up to its value, and its hex', match: /\b(binary|base[- ]?2|bits?|bytes?|place values?|switch(es)?|light bulbs?)\b/i, code: BINARY },
  { id: 'twos-complement', title: "Two's complement", shows: 'flip the bits and add one; the top bit weighs −128', match: /\b(two'?s[- ]complement|signed (integers?|numbers?)|negative (numbers?|binary)|overflow)\b/i, code: SIGNED },
  { id: 'hexadecimal', title: 'One hex digit is four bits', shows: 'a 16-bit register with each hex digit under its four bits', match: /\b(hex(adecimal)?|base[- ]?16|nibbles?)\b/i, code: HEX },
  { id: 'half-adder', title: 'A half adder', shows: 'XOR and AND gates whose wires light as 1 + 1 settles, with the truth table', match: /\b(logic gates?|gates?|half[- ]adder|boolean (logic|algebra)|xor|and gate|or gate|truth tables?)\b/i, code: GATES },
  { id: 'full-adder', title: 'A full adder', shows: 'two half adders and an OR adding three bits, settling gate by gate', match: /\bfull[- ]adder\b/i, code: FULL_ADDER },
  { id: 'ripple-carry-adder', title: 'A 4-bit ripple-carry adder', shows: '7 + 1 with the carry rippling through four full adders', match: /\b(ripple[- ]carry|adders?|binary addition|circuits?|carry)\b/i, code: RIPPLE },
  { id: 'multiplexer', title: 'A multiplexer', shows: 'a select line choosing between two inputs', match: /\b(multiplexers?|mux|selectors?)\b/i, code: MUX },
  { id: 'fetch-decode-execute', title: 'Fetch, decode, execute', shows: 'a tiny CPU running 5 + 3: PC, IR, registers, ALU, buses and memory', match: /\b(cpu|processor|fetch|decode|execute|instruction cycle|registers?|alu|program counter|machine code|assembly|von neumann)\b/i, code: CPU },
  { id: 'memory-bytes', title: 'An int in memory', shows: 'addressed bytes, a little- and a big-endian int, a pointer', match: /\b(memory|ram|address(es)?|endian(ness)?|pointers?|bytes in memory)\b/i, code: MEMORY },
  { id: 'python-names-objects', title: 'Names point at objects', shows: 'a real trace of a = [1, 2]; b = a; b.append(3): one list, two names', match: /\b(python (names|variables|objects|memory|lists?)|names and objects|references?|aliasing|mutab(le|ility)|lists? as arrays|id\(\)|is vs ==)\b/i, code: PY_NAMES },
  { id: 'python-call-frames', title: 'Call frames', shows: 'a real trace of recursive factorial(4): frames pushed and popped', match: /\b(call (stack|frames?)|stack frames?|recursion|recursive|function calls?|the stack)\b/i, code: PY_FRAMES },
  { id: 'python-int-storage', title: 'How Python stores an int', shows: 'ints as objects: CPython base-2^30 digits, sizes, small-int cache', match: /\b(how (python|an int|ints?) (is )?stored|int objects?|bignums?|arbitrary precision|integers? in python)\b/i, code: PY_INT },
  { id: 'cpu-die-caches', title: 'Inside a CPU', shows: '3D die: cores, L1, L2, L3, memory controller, DRAM, and a cache miss', match: /\b(caches?|cache (lines?|miss(es)?|hierarchy)|memory hierarchy|cores?|die|latency|l1|l2|l3|dram)\b/i, code: DIE },
  { id: 'gpu-sms-warps', title: 'Inside a GPU', shows: '3D GPU: SMs, a warp of 32 lanes, divergence, L2 and HBM', match: /\b(gpus?|cuda|warps?|sms?|streaming multiprocessors?|simt|hbm|kernels? launch)\b/i, code: GPU }
]

export const kitVisual = (id: string) => KIT_VISUALS.find((v) => v.id === id) ?? null

/**
 * The kit visual for a concept's words, or null. An exact id wins; otherwise the first whose
 * words match, so the list runs from the most specific idea to the broadest.
 */
export function kitVisualFor(text: string): KitVisual | null {
  const t = text.trim()
  if (!t) return null
  const slug = conceptId(t)
  return kitVisual(slug) ?? KIT_VISUALS.find((v) => v.match.test(t)) ?? null
}

/** A concept's name as a file-safe id: "Two's complement" → "twos-complement" */
export const conceptId = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

/** The list the tutor is given: ids it can name in a ```draw block, with what each shows */
export const kitVisualList = () => KIT_VISUALS.map((v) => `${v.id} (${v.shows})`).join('; ')
