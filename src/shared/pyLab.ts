/**
 * The Python lab: a short program run once under the tracer, one step per bytecode instruction
 * (main/pyTrace.py with "ops"), then stepped through by the learner, forwards and back, with the
 * bytecode, the call stack and the objects in memory beside the code (renderer lib/pyLab). It
 * lives in tutor text as a ```pylab block, under any ```python block as "Step through", and on its
 * own page with the starter programs below. Pure: shared by main, the window and the tests.
 */
import type { PyCode, PyObject, PyOp, PyStep, PyTrace } from './pyTrace'

/** Fences that become a lab in tutor text */
const LAB_FENCES = /^(pylab|pytrace|python-lab)$/i
export const isLabFence = (lang: string): boolean => LAB_FENCES.test(lang.trim())

export type StepMode = 'line' | 'op'

const top = (s: PyStep | undefined) => s?.frames[s.frames.length - 1]

/**
 * Whether step i starts a new line: the first step, a call or a return (the stack changed), a
 * return or exception event, the innermost frame on another line, or a jump back to the same
 * line (a loop on one line).
 */
export function startsLine(steps: PyStep[], i: number): boolean {
  const s = steps[i]
  const prev = steps[i - 1]
  if (!s || !prev) return !!s
  if (s.event !== 'opcode' || prev.event === 'return' || prev.event === 'exception') return true
  if (s.frames.length !== prev.frames.length) return true
  const a = top(prev)!
  const b = top(s)!
  if (a.line !== b.line) return true
  return b.at !== undefined && a.at !== undefined && b.at < a.at
}

/** The step to go to from i: one instruction, or to the start of the next (or this or the previous) line */
export function stepFrom(steps: PyStep[], i: number, mode: StepMode, dir: 1 | -1): number {
  const last = steps.length - 1
  if (last < 0) return 0
  if (mode === 'op') return Math.max(0, Math.min(last, i + dir))
  if (dir === 1) {
    for (let j = i + 1; j <= last; j++) if (startsLine(steps, j)) return j
    return last
  }
  // Back: to the start of the line before the one i is in
  let j = Math.min(i, last)
  while (j > 0 && !startsLine(steps, j)) j--
  if (j > 0) j--
  while (j > 0 && !startsLine(steps, j)) j--
  return j
}

/** How many line steps the trace has, and which one step i falls in (from 1) */
export function lineCount(steps: PyStep[], i: number): { at: number; of: number } {
  let of = 0
  let at = 0
  for (let j = 0; j < steps.length; j++)
    if (startsLine(steps, j)) {
      of++
      if (j <= i) at = of
    }
  return { at, of }
}

/** Each object reachable at a step, by id */
export function heapAt(trace: PyTrace, i: number): Map<string, PyObject> {
  const m = new Map<string, PyObject>()
  for (const k of trace.steps[i]?.heap ?? []) {
    const o = trace.objects[k]
    if (o) m.set(o.id, o)
  }
  return m
}

/** What step i changed from the step before: objects new to memory, objects whose contents changed, and names (frame/name) bound to another object */
export function changesAt(trace: PyTrace, i: number): { fresh: Set<string>; changed: Set<string>; names: Set<string> } {
  const fresh = new Set<string>()
  const changed = new Set<string>()
  const names = new Set<string>()
  const s = trace.steps[i]
  const prev = trace.steps[i - 1]
  if (!s || !prev) return { fresh, changed, names }
  const was = new Map<string, number>()
  for (const k of prev.heap) if (trace.objects[k]) was.set(trace.objects[k].id, k)
  for (const k of s.heap) {
    const o = trace.objects[k]
    if (!o) continue
    const before = was.get(o.id)
    if (before === undefined) fresh.add(o.id)
    else if (before !== k) changed.add(o.id)
  }
  s.frames.forEach((f, depth) => {
    const old = prev.frames[depth]
    if (!old || old.name !== f.name) return
    const bound = new Map(old.names)
    for (const [n, r] of f.names) if (bound.get(n) !== r) names.add(`${depth}/${n}`)
  })
  return { fresh, changed, names }
}

/** The code the innermost frame runs at a step and the index of its next instruction, or null for a trace without bytecode */
export function opAt(trace: PyTrace, i: number, depth?: number): { code: PyCode; index: number } | null {
  const s = trace.steps[i]
  const f = s?.frames[depth ?? s.frames.length - 1]
  if (!f || f.code === undefined || !trace.codes?.[f.code]) return null
  const code = trace.codes[f.code]
  let index = code.ops.findIndex((op) => op[0] === f.at)
  // An offset inside an instruction's inline cache: the instruction it belongs to
  if (index < 0) index = code.ops.reduce((best, op, k) => (op[0] <= (f.at ?? 0) ? k : best), 0)
  return { code, index }
}

/** A code object's instructions grouped by source line, in order, as dis prints them */
export function opsByLine(code: PyCode): { line: number; ops: { op: PyOp; index: number }[] }[] {
  const out: { line: number; ops: { op: PyOp; index: number }[] }[] = []
  code.ops.forEach((op, index) => {
    const last = out[out.length - 1]
    if (last && (op[3] === last.line || op[3] === 0)) last.ops.push({ op, index })
    else out.push({ line: op[3], ops: [{ op, index }] })
  })
  return out
}

// ---------- What an instruction does ----------

/**
 * Plain words for the instructions a short program meets, written against CPython 3.12 to 3.15.
 * Specialised and fused forms (LOAD_FAST_BORROW, LOAD_FAST_LOAD_FAST) fall back to their family.
 */
const OPCODES: [RegExp, string][] = [
  [/^RESUME$/, 'Start or resume this frame; a check point for tracing and signals.'],
  [/^NOP$|^NOT_TAKEN$|^CACHE$/, 'Does nothing at run time (a marker kept for tracing and branch statistics).'],
  [/^LOAD_SMALL_INT$/, 'Push a small int (0 to 255): taken from the cache of ints made at start-up, never created.'],
  [/^LOAD_CONST/, 'Push a constant stored in the code object (co_consts).'],
  [/^LOAD_COMMON_CONSTANT$/, 'Push a constant every code object shares (None, AssertionError…).'],
  [/^LOAD_FAST_LOAD_FAST|^LOAD_FAST_BORROW_LOAD_FAST_BORROW/, 'Push two locals at once (two LOAD_FASTs fused into one instruction).'],
  [/^LOAD_FAST/, 'Push a local variable, read from the frame’s array of locals by index: no dictionary lookup.'],
  [/^STORE_FAST_STORE_FAST|^STORE_FAST_LOAD_FAST/, 'Two local-variable moves fused into one instruction.'],
  [/^STORE_FAST/, 'Pop the top of the stack into a local variable slot.'],
  [/^DELETE_FAST/, 'Unbind a local variable.'],
  [/^LOAD_NAME/, 'Push the value of a name, looked up in locals, then globals, then builtins (module-level code).'],
  [/^STORE_NAME/, 'Pop the top of the stack and bind it to a name in the current namespace dict.'],
  [/^LOAD_GLOBAL/, 'Push a global (or builtin) by name; “+ NULL” also pushes a NULL for the call that follows.'],
  [/^STORE_GLOBAL/, 'Pop into a global name.'],
  [/^LOAD_DEREF|^LOAD_CLOSURE/, 'Push a variable kept in a cell, shared with a closure.'],
  [/^STORE_DEREF/, 'Pop into a cell, a variable shared with a closure.'],
  [/^MAKE_CELL|^COPY_FREE_VARS/, 'Set up the cells that let an inner function share this variable.'],
  [/^LOAD_ATTR/, 'Replace the object on top of the stack with one of its attributes (or a method, ready to call).'],
  [/^STORE_ATTR/, 'Set an attribute: obj.name = value.'],
  [/^LOAD_SUPER_ATTR/, 'Look up an attribute through super().'],
  [/^BINARY_OP/, 'Pop two values, apply the operator (by its dunder method, e.g. __add__), push the result.'],
  [/^BINARY_SUBSCR|^BINARY_SLICE/, 'Pop a container and a key or slice, push container[key].'],
  [/^STORE_SUBSCR|^STORE_SLICE/, 'Set container[key] = value.'],
  [/^DELETE_SUBSCR/, 'Delete container[key].'],
  [/^UNARY_/, 'Apply a unary operator (-x, not x, ~x) to the top of the stack.'],
  [/^TO_BOOL/, 'Turn the top of the stack into True or False (for an if or while).'],
  [/^COMPARE_OP/, 'Pop two values, compare them, push the result.'],
  [/^IS_OP/, 'Pop two values, push whether they are the same object (is, is not): compares ids, not values.'],
  [/^CONTAINS_OP/, 'Pop two values, push whether one is in the other (in, not in).'],
  [/^POP_JUMP_IF/, 'Pop the top of the stack and jump if it is true, false or None, as named.'],
  [/^JUMP_BACKWARD/, 'Jump back to the start of the loop.'],
  [/^JUMP/, 'Jump to another instruction.'],
  [/^GET_ITER/, 'Replace an iterable on top of the stack with an iterator over it (iter(x)).'],
  [/^FOR_ITER/, 'Call next() on the iterator: push the next item, or leave the loop when it is done.'],
  [/^END_FOR|^POP_ITER/, 'Drop the finished iterator at the end of a loop.'],
  [/^PUSH_NULL/, 'Push a NULL that marks where a call’s callable sits on the stack.'],
  [/^CALL_INTRINSIC/, 'Call one of the interpreter’s own helpers (printing in the REPL, unpacking…).'],
  [/^CALL_KW/, 'Call a function with keyword arguments.'],
  [/^CALL/, 'Call the function under its arguments on the stack: a new frame is pushed when it is Python code.'],
  [/^RETURN_VALUE|^RETURN_CONST/, 'Pop the top of the stack and return it to the caller; this frame is popped.'],
  [/^RETURN_GENERATOR|^YIELD_VALUE/, 'Suspend this generator frame and hand a value out; the frame is kept to resume later.'],
  [/^POP_TOP/, 'Discard the top of the stack (a value nobody keeps, like a call’s None).'],
  [/^COPY$/, 'Push a copy of a value further down the stack.'],
  [/^SWAP$/, 'Swap the top of the stack with a value below it.'],
  [/^BUILD_LIST/, 'Pop n items and push a new list holding them.'],
  [/^BUILD_TUPLE/, 'Pop n items and push a new tuple holding them.'],
  [/^BUILD_MAP/, 'Pop n key/value pairs and push a new dict.'],
  [/^BUILD_SET/, 'Pop n items and push a new set.'],
  [/^BUILD_STRING|^FORMAT_/, 'Build an f-string from its pieces.'],
  [/^LIST_APPEND|^SET_ADD|^MAP_ADD/, 'Add an item to the container a comprehension is building.'],
  [/^LIST_EXTEND|^SET_UPDATE|^DICT_UPDATE|^DICT_MERGE/, 'Add every item of an iterable to a container being built.'],
  [/^UNPACK_SEQUENCE|^UNPACK_EX/, 'Pop a sequence and push its items, for a, b = …'],
  [/^MAKE_FUNCTION/, 'Turn the code object on the stack into a function object.'],
  [/^SET_FUNCTION_ATTRIBUTE/, 'Attach defaults, a closure or annotations to the new function.'],
  [/^LOAD_BUILD_CLASS/, 'Push builtins.__build_class__, which a class statement calls.'],
  [/^LOAD_LOCALS/, 'Push the namespace dict of the class body being run.'],
  [/^LOAD_FROM_DICT_OR_/, 'Look a name up in a class body’s namespace first, then where a function would.'],
  [/^IMPORT_NAME/, 'Import a module (sys.modules first, then the import system).'],
  [/^IMPORT_FROM/, 'Load one name from the module on the stack (from m import name).'],
  [/^PUSH_EXC_INFO|^POP_EXCEPT/, 'Save or restore the exception being handled around an except block.'],
  [/^CHECK_EXC_MATCH/, 'Push whether the exception matches the except clause’s type.'],
  [/^RAISE_VARARGS|^RERAISE/, 'Raise an exception: the stack of frames unwinds until a handler is found.'],
  [/^GET_LEN/, 'Push len() of the top of the stack (for match statements).'],
  [/^EXTENDED_ARG/, 'Widen the next instruction’s argument past 255.']
]

/** What an instruction does, in a sentence, or '' when it is one Tide has no words for */
export function opcodeNote(opname: string): string {
  for (const [re, text] of OPCODES) if (re.test(opname)) return text
  return ''
}

// ---------- Starter programs ----------

export interface LabStarter {
  id: string
  title: string
  /** What to watch as it steps */
  watch: string
  code: string
  /** Lesson topics it belongs with */
  match: RegExp
}

export const LAB_STARTERS: LabStarter[] = [
  {
    id: 'names',
    title: 'Names point at objects',
    watch: 'b = a copies a reference, not the list: one list, two names. list(a) makes a second list holding the same ints.',
    code: 'a = [1, 2]\nb = a\nb.append(3)\nc = list(a)\nprint(a is b, a is c, a == c)',
    match: /\b(names?|variables?|references?|aliasing|mutab(le|ility)|identity|is vs ==|id\(\))\b/i
  },
  {
    id: 'frames',
    title: 'Call frames and recursion',
    watch: 'Each call pushes a frame with its own n; each return pops it and hands its value to the CALL waiting below.',
    code: 'def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\nresult = fact(4)\nprint(result)',
    match: /\b(call (stack|frames?)|stack frames?|recurs(ion|ive)|functions?)\b/i
  },
  {
    id: 'ints',
    title: 'How an int is stored',
    watch: 'Small ints are shared from a cache; 2 ** 40 needs two base-2^30 digits and grows in sys.getsizeof.',
    code: 'small = 7\nalso_small = 3 + 4\nbig = 2 ** 40\nhuge = big * big\nprint(small is also_small, big.bit_length(), huge.bit_length())',
    match: /\b(ints?|integers?|bignums?|arbitrary precision|small.int|numbers?)\b/i
  },
  {
    id: 'growth',
    title: 'A list grows by over-allocating',
    watch: 'Watch cap, the slots CPython has allocated, jump ahead of len on append: that is why append is amortised O(1).',
    code: 'xs = []\nfor i in range(10):\n    xs.append(i)\nprint(len(xs))',
    match: /\b(lists?|dynamic arrays?|append|amorti[sz]ed|over.?allocat)/i
  },
  {
    id: 'strings',
    title: 'Strings are immutable',
    watch: 's += "!" builds a new string object each time; the name moves to it and the old one is dropped.',
    code: 's = "tide"\nt = s\ns += "!"\ns += "!"\nprint(s, t)',
    match: /\b(strings?|str|immutab(le|ility)|text)\b/i
  },
  {
    id: 'loop',
    title: 'A for loop in bytecode',
    watch: 'GET_ITER makes an iterator, FOR_ITER calls next() each time round, and JUMP_BACKWARD closes the loop.',
    code: 'total = 0\nfor n in [3, 1, 4]:\n    total += n\nprint(total)',
    match: /\b(loops?|for|iterat(or|ion|ors)|bytecode|dis)\b/i
  },
  {
    id: 'closure',
    title: 'Closures keep variables alive',
    watch: 'count lives on in a cell after make_counter returns; each call of tick reads and writes that same cell.',
    code: 'def make_counter():\n    count = 0\n    def tick():\n        nonlocal count\n        count += 1\n        return count\n    return tick\n\ntick = make_counter()\ntick()\nprint(tick())',
    match: /\b(closures?|nonlocal|scopes?|cells?|LEGB|nested functions?)\b/i
  },
  {
    id: 'defaults',
    title: 'The mutable default argument',
    watch: 'The default list is made once, when def runs, and lives on the function: both calls append to the same list.',
    code: 'def add(item, into=[]):\n    into.append(item)\n    return into\n\nfirst = add(1)\nsecond = add(2)\nprint(first is second, second)',
    match: /\b(default (arguments?|values?|parameters?)|mutable defaults?|gotchas?)\b/i
  },
  {
    id: 'objects',
    title: 'An instance and its __dict__',
    watch: 'Each instance holds its attributes; both points share one class. p.x = 5 changes one object.',
    code: 'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n\np = Point(1, 2)\nq = Point(1, 2)\np.x = 5\nprint(p.x, q.x, p == q)',
    match: /\b(class(es)?|objects?|instances?|attributes?|__dict__|OOP|self)\b/i
  },
  {
    id: 'exceptions',
    title: 'An exception unwinds the stack',
    watch: 'The raise in inner leaves inner and middle at once; frames pop until the try in outer catches it.',
    code: 'def inner():\n    raise ValueError("bad")\n\ndef middle():\n    inner()\n    return "never"\n\ndef outer():\n    try:\n        middle()\n    except ValueError as e:\n        return f"caught {e}"\n\nprint(outer())',
    match: /\b(exceptions?|raise|try|except|errors?|unwind)/i
  }
]

/** The starter that suits a lesson's topic, or the first one */
export function starterFor(topic: string): LabStarter {
  return LAB_STARTERS.find((s) => s.match.test(topic)) ?? LAB_STARTERS[0]
}

/** What the tutor is told about the lab, for a Python lesson */
export const PYTHON_LAB_LINE =
  'Show the interpreter at work in a ```pylab block: a short program (at most 30 lines, no input() or files) they step through by line or bytecode instruction, watching the bytecode, call stack and objects (ids, sizes, int digits, list capacity) change. One per mechanism, then ask what they saw.'
