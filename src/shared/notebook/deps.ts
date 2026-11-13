/**
 * Which cells are out of date. Like marimo, each code cell is read for the names it defines and
 * the names it uses; a cell that uses a name depends on the cell above it that last defines that
 * name. When a cell is edited or run again, every cell downstream of it that already ran is stale
 * until it runs again. Jupyter itself doesn't track this, so a notebook can show results from
 * code that no longer matches; Tide marks those cells and can run them in order.
 *
 * The reading is a light Python tokenizer, not a full parser: it knows assignments (also tuple,
 * augmented, annotated and walrus), def, class, import, for, with … as, except … as, comprehension
 * and function scopes, and treats `df["x"] = …`, `df.x = …` and a statement like `xs.append(…)` as
 * changing `df` and `xs`. It errs towards marking a cell stale rather than missing one.
 */

const KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type print'.split(' ')
)
const BUILTINS = new Set(
  'abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __name__ __file__ __doc__ Exception ValueError TypeError KeyError IndexError RuntimeError ZeroDivisionError AssertionError NotImplementedError StopIteration ArithmeticError AttributeError NameError ImportError OSError display get_ipython self cls'.split(
    ' '
  )
)

interface Line {
  indent: number
  text: string
}

/** Removes comments, replaces string contents with spaces (keeping f-string {expressions}), and joins continued lines */
function logicalLines(src: string): Line[] {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5))
    if (m && (m[1] === '' || !/[A-Za-z0-9_]/.test(src[i - 1] ?? ''))) {
      const prefix = m[1]
      const q = m[2]
      const isF = /f/i.test(prefix)
      i += prefix.length + q.length
      let body = ''
      while (i < src.length && !src.startsWith(q, i)) {
        if (src[i] === '\\' && !/r/i.test(prefix)) {
          body += '  '
          i += 2
          continue
        }
        if (q.length === 1 && src[i] === '\n') break
        body += src[i]
        i++
      }
      i += q.length
      // Keep an f-string's expressions as code, the rest as nothing
      let kept = ''
      if (isF) {
        const re = /\{([^{}]*)\}/g
        let e: RegExpExecArray | null
        while ((e = re.exec(body.replace(/\{\{|\}\}/g, '  ')))) kept += ` (${e[1].replace(/[!:][^)]*$/, '')}) `
      }
      out += ` "" ${kept}`.replace(/\n/g, ' ')
      continue
    }
    out += c
    i++
  }
  // Join lines inside brackets and after a backslash
  const lines: Line[] = []
  let depth = 0
  let cur = ''
  let indent = -1
  for (const raw of out.split('\n')) {
    if (indent < 0) {
      if (!raw.trim()) continue
      indent = raw.length - raw.trimStart().length
    }
    cur += (cur ? ' ' : '') + raw.trim()
    for (const ch of raw) {
      if ('([{'.includes(ch)) depth++
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    }
    if (depth > 0 || cur.endsWith('\\')) {
      cur = cur.replace(/\\$/, '')
      continue
    }
    if (cur.trim()) lines.push({ indent, text: cur.trim() })
    cur = ''
    indent = -1
  }
  if (cur.trim()) lines.push({ indent: Math.max(0, indent), text: cur.trim() })
  // Split simple statements joined with ;
  return lines.flatMap((l) => splitTop(l.text, ';').map((t) => ({ indent: l.indent, text: t.trim() })).filter((x) => x.text))
}

/** Splits at a character outside brackets */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === sep && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g

/** Identifiers used as values in an expression: not attributes (after a dot), not keyword-argument names */
function namesIn(expr: string): string[] {
  const out: string[] = []
  IDENT.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IDENT.exec(expr))) {
    const before = expr.slice(0, m.index).trimEnd()
    const after = expr.slice(m.index + m[0].length)
    if (before.endsWith('.')) continue
    if (/^\s*=(?!=)/.test(after) && /[(,]\s*$/.test(expr.slice(0, m.index))) continue // f(x=1)
    if (/^[0-9]/.test(m[0])) continue
    if (KEYWORDS.has(m[0])) continue
    out.push(m[0])
  }
  return out
}

/** The base names a target assigns: `a, (b, c)` → a b c; `df["x"]` and `df.x` → df (a change to df) */
function targetNames(target: string): { defs: string[]; mutated: string[]; uses: string[] } {
  const defs: string[] = []
  const mutated: string[] = []
  const uses: string[] = []
  for (let t of splitTop(target.replace(/^\(|\)$/g, ''), ',')) {
    t = t.trim().replace(/^\*/, '').replace(/^[([]|[)\]]$/g, '').trim()
    if (!t) continue
    if (/^[A-Za-z_]\w*$/.test(t)) defs.push(t)
    else if (t.includes(',')) {
      const inner = targetNames(t)
      defs.push(...inner.defs)
      mutated.push(...inner.mutated)
      uses.push(...inner.uses)
    } else {
      const base = /^([A-Za-z_]\w*)\s*[[.]/.exec(t)
      if (base) {
        mutated.push(base[1])
        uses.push(...namesIn(t.slice(base[1].length)))
      }
    }
  }
  return { defs, mutated, uses }
}

/** Finds the "=" of an assignment (not ==, <=, >=, !=, and not inside brackets); -1 when none */
function assignAt(s: string, annotations = true): { at: number; op: string } | null {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (depth === 0 && ch === '=' && s[i + 1] !== '=' && !'=<>!:'.includes(s[i - 1] ?? '')) {
      const aug = /(\*\*|\/\/|>>|<<|[-+*/%@&|^])$/.exec(s.slice(0, i))
      return { at: aug ? i - aug[1].length : i, op: aug ? aug[1] + '=' : '=' }
    } else if (annotations && depth === 0 && ch === ':' && s[i + 1] !== '=' && !/^\s*lambda\b/.test(s) && /^[A-Za-z_][\w.[\]"' ]*$/.test(s.slice(0, i).trim()) && !/^(if|elif|else|for|while|with|try|except|finally|def|class|lambda|match|case)\b/.test(s)) {
      // An annotation: x: int = 1, or a bare x: int
      const rest = s.slice(i + 1)
      const eq = assignAt(rest)
      return eq ? { at: i, op: ':=' } : { at: i, op: ':' }
    }
  }
  return null
}

export interface CellNames {
  defs: string[]
  uses: string[]
}

/** The names one cell defines at the top level and the names it reads from outside itself */
export function cellNames(source: string): CellNames {
  const defs = new Set<string>()
  const uses = new Set<string>()
  // Scopes opened by def/lambda/class: their own names don't leak out
  const scopes: { indent: number; locals: Set<string>; pendingUses: string[] }[] = []
  const comprehensionLocals = new Set<string>()
  const define = (n: string) => {
    if (scopes.length) scopes[scopes.length - 1].locals.add(n)
    else defs.add(n)
  }
  const use = (names: string[]) => {
    for (const n of names) {
      if (BUILTINS.has(n) || KEYWORDS.has(n)) continue
      if (scopes.length) scopes[scopes.length - 1].pendingUses.push(n)
      else if (!defs.has(n)) uses.add(n)
    }
  }
  const closeScope = () => {
    const s = scopes.pop()!
    const outer = s.pendingUses.filter((n) => !s.locals.has(n))
    use(outer)
  }

  for (const { indent, text } of logicalLines(source)) {
    while (scopes.length && indent <= scopes[scopes.length - 1].indent) closeScope()
    let s = text
    // Comprehension and lambda variables are local to their expression
    for (const m of s.matchAll(/\bfor\s+([\w\s,()]+?)\s+in\b/g)) if (!/^for\b/.test(s) || m.index! > 0) for (const n of m[1].split(/[\s,()]+/).filter(Boolean)) comprehensionLocals.add(n)
    for (const m of s.matchAll(/\blambda\s*([^:]*):/g)) for (const n of m[1].split(/[\s,*=]+/).filter((x) => /^[A-Za-z_]\w*$/.test(x))) comprehensionLocals.add(n)
    const local = (names: string[]) => names.filter((n) => !comprehensionLocals.has(n))

    let m: RegExpExecArray | null
    if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*(.*))?:(.*)$/.exec(s))) {
      define(m[1])
      const params = splitTop(m[2], ',').map((p) => p.trim().replace(/^\*+/, ''))
      const locals = new Set<string>(params.map((p) => /^([A-Za-z_]\w*)/.exec(p)?.[1]).filter((x): x is string => !!x))
      // Defaults and annotations are read when def runs
      use(local(params.flatMap((p) => namesIn(p.replace(/^[A-Za-z_]\w*/, '')))))
      if (m[3]) use(namesIn(m[3]))
      scopes.push({ indent, locals, pendingUses: [] })
      if (m[4].trim()) scopes[scopes.length - 1].pendingUses.push(...namesIn(m[4]))
      continue
    }
    if ((m = /^class\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*:(.*)$/.exec(s))) {
      define(m[1])
      if (m[2]) use(namesIn(m[2]))
      scopes.push({ indent, locals: new Set(), pendingUses: [] })
      continue
    }
    if ((m = /^(?:global|nonlocal)\s+(.*)$/.exec(s))) {
      if (scopes.length) for (const n of m[1].split(/\s*,\s*/)) {
        scopes[scopes.length - 1].locals.delete(n)
        defs.add(n)
      }
      continue
    }
    if ((m = /^import\s+(.*)$/.exec(s))) {
      for (const part of splitTop(m[1], ',')) {
        const a = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part)
        if (a) define(a[2] ?? a[1].split('.')[0])
      }
      continue
    }
    if ((m = /^from\s+[\w.]+\s+import\s+\(?(.*?)\)?$/.exec(s))) {
      for (const part of splitTop(m[1], ',')) {
        const a = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part)
        if (a && a[1] !== '*') define(a[2] ?? a[1])
      }
      continue
    }
    // Block headers: for/with/except/if/while/elif/match … the targets they bind, then the rest as uses
    if ((m = /^(?:async\s+)?for\s+(.+?)\s+in\s+(.*):(.*)$/.exec(s))) {
      const t = targetNames(m[1])
      t.defs.forEach(define)
      use(local(namesIn(m[2])))
      s = m[3]
      if (!s.trim()) continue
    } else if ((m = /^(?:async\s+)?with\s+(.*):(.*)$/.exec(s))) {
      for (const item of splitTop(m[1], ',')) {
        const a = /^(.*)\s+as\s+(.+)$/.exec(item)
        use(local(namesIn(a ? a[1] : item)))
        if (a) targetNames(a[2]).defs.forEach(define)
      }
      s = m[2]
      if (!s.trim()) continue
    } else if ((m = /^except\b(.*?)(?:\s+as\s+(\w+))?\s*:(.*)$/.exec(s))) {
      use(namesIn(m[1]))
      if (m[2]) define(m[2])
      s = m[3]
      if (!s.trim()) continue
    } else if ((m = /^(?:if|elif|while|match|case|else|try|finally)\b(.*?):(.*)$/.exec(s)) && !assignAt(s.split(':')[0])) {
      use(local(namesIn(m[1].replace(/^\s*:\s*$/, ''))))
      s = m[2]
      if (!s.trim()) continue
    } else if ((m = /^(?:return|yield|raise|assert|del|await)\b(.*)$/.exec(s))) {
      if (/^del\b/.test(s)) for (const n of namesIn(m[1])) define(n)
      use(local(namesIn(m[1])))
      continue
    }

    // Walrus
    for (const w of s.matchAll(/\b([A-Za-z_]\w*)\s*:=/g)) define(w[1])

    // Assignment chains: a = b = expr
    const parts: string[] = []
    let rest = s
    let op = ''
    for (;;) {
      // Only the first target can carry an annotation (x: int = …); after it, a colon is a lambda's or a slice's
      const a = assignAt(rest, !parts.length)
      if (!a) break
      parts.push(rest.slice(0, a.at))
      op = a.op
      if (a.op === ':') {
        rest = ''
        break
      }
      if (a.op === ':=') {
        // x: T = value
        const after = rest.slice(a.at + 1)
        const eq = assignAt(after)!
        use(namesIn(after.slice(0, eq.at)))
        rest = after.slice(eq.at + 1)
        break
      }
      rest = rest.slice(a.at + a.op.length)
      if (a.op !== '=') break
    }
    use(local(namesIn(rest)))
    for (const target of parts) {
      const t = targetNames(target)
      if (op.length > 1 && op !== ':=') use(t.defs) // x += 1 reads x
      t.defs.forEach(define)
      for (const n of t.mutated) {
        use([n])
        define(n)
      }
      use(local(t.uses))
    }
    // An expression statement that calls a method on a name may change it in place (xs.append, df.drop(inplace=True))
    if (!parts.length) {
      const call = /^([A-Za-z_]\w*)\s*\.\s*(\w+)\s*\(/.exec(s)
      if (call && MUTATORS.test(call[2]) && !KNOWN_MODULES.has(call[1])) define(call[1])
    }
  }
  while (scopes.length) closeScope()
  for (const n of comprehensionLocals) if (!defs.has(n)) uses.delete(n)
  return { defs: [...defs], uses: [...uses] }
}

const MUTATORS = /^(append|extend|insert|pop|remove|clear|update|add|discard|sort|reverse|setdefault|drop|fillna|rename|set_index|reset_index|sort_values|sort_index|dropna|replace|astype|apply_|insert|assign_|fit|partial_fit|set_|update_|resize|fill|put|seed)$/
const KNOWN_MODULES = new Set(['np', 'pd', 'plt', 'math', 'os', 'sys', 'random', 'tf', 'sns', 'ql', 'cp', 'pl', 'duckdb', 'json', 're', 'time', 'datetime', 'stats', 'sm', 'px', 'go'])

export type CellState = 'fresh' | 'edited' | 'stale' | 'never' | 'earlier'

export interface CellStatus {
  state: CellState
  /** For stale: the names that changed upstream, and the cells they came from */
  names?: string[]
  from?: string[]
}

export interface CellRunInfo {
  id: string
  type: 'code' | 'markdown' | 'raw'
  source: string
  /** The source it last ran with in this kernel, and when (a counter that only goes up) */
  ranSource?: string
  ranSeq?: number
  /** It has outputs or an execution count from before this kernel started */
  hadOutput?: boolean
}

/** The cell each name a cell uses comes from: the nearest cell above that defines it */
export function dependencies(cells: CellRunInfo[], names: Map<string, CellNames> = new Map()): Map<string, { from: string; name: string }[]> {
  const read = (c: CellRunInfo) => names.get(c.id) ?? (names.set(c.id, cellNames(c.source)), names.get(c.id)!)
  const out = new Map<string, { from: string; name: string }[]>()
  const definedBy = new Map<string, string>()
  for (const c of cells) {
    if (c.type !== 'code') continue
    const n = read(c)
    out.set(
      c.id,
      n.uses.filter((u) => definedBy.has(u)).map((u) => ({ from: definedBy.get(u)!, name: u }))
    )
    for (const d of n.defs) definedBy.set(d, c.id)
  }
  return out
}

/**
 * Each code cell's state: never run, from an earlier kernel, fresh, edited since it ran, or stale
 * because a cell it depends on was edited or ran again after it (directly or further up).
 */
export function cellStates(cells: CellRunInfo[], cache?: Map<string, CellNames>): Map<string, CellStatus> {
  const deps = dependencies(cells, cache)
  const byId = new Map(cells.map((c) => [c.id, c]))
  const out = new Map<string, CellStatus>()
  /** The newest moment a cell's inputs changed: its own run, or an upstream change */
  const changedAt = new Map<string, number>()
  for (const c of cells) {
    if (c.type !== 'code') continue
    const ran = c.ranSeq !== undefined
    const edited = ran && c.ranSource !== c.source
    let state: CellState = !ran ? (c.hadOutput ? 'earlier' : 'never') : edited ? 'edited' : 'fresh'
    const names: string[] = []
    const from: string[] = []
    let newest = ran ? c.ranSeq! : -1
    for (const d of deps.get(c.id) ?? []) {
      const up = byId.get(d.from)!
      const upState = out.get(d.from)!.state
      const upChanged = changedAt.get(d.from) ?? -1
      // Upstream edited (or stale, or not run in this kernel while this one has) means this cell's input will change
      const outOfDate = ran && (upState === 'edited' || upState === 'stale' || upChanged > c.ranSeq! || (up.ranSeq === undefined && upState !== 'never'))
      if (outOfDate) {
        if (!names.includes(d.name)) names.push(d.name)
        if (!from.includes(d.from)) from.push(d.from)
      }
      newest = Math.max(newest, upChanged)
    }
    if (names.length && state === 'fresh') state = 'stale'
    changedAt.set(c.id, state === 'edited' ? Infinity : newest)
    out.set(c.id, names.length ? { state, names, from } : { state })
  }
  return out
}

/** The cells to run to bring the notebook up to date, in notebook order */
export function staleOrder(cells: CellRunInfo[], states: Map<string, CellStatus>): string[] {
  return cells.filter((c) => c.type === 'code' && ['edited', 'stale'].includes(states.get(c.id)?.state ?? '')).map((c) => c.id)
}
