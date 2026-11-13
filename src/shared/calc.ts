/**
 * The maths answer box's calculator (components/maths): LaTeX as MathLive writes it (and as Claude
 * transcribes a page of working) read into a small tree, then
 * - turned into SymPy for the exact answer, worked out in Tide's sandboxed Python (main/calculator)
 * - worked out here, in floating point, for the live preview and when SymPy isn't installed.
 * No model is involved, so it works offline and without Claude. Pure, so the box, main and the
 * tests agree.
 *
 * What it reads: numbers, letters and Greek, + − × ÷ · and implicit products, powers and roots,
 * fractions, trig and inverse trig (sin⁻¹ and arcsin), hyperbolic, ln, log and log base b, exp and
 * e^x, |x|, n!, %, degrees (x°), binomials, sums and products, integrals (definite and not),
 * derivatives (d/dx, dⁿ/dxⁿ, f′(x)), limits (one- and two-sided), matrices, determinants,
 * transposes and inverses, vectors (× between two 3-vectors is the cross product), and relations
 * (=, <, ≤, …) including chains such as a = b = c.
 */

export type Angle = 'rad' | 'deg'

export type Node =
  | { t: 'num'; v: string }
  | { t: 'sym'; name: string }
  | { t: 'const'; name: 'pi' | 'e' | 'i' | 'oo' }
  | { t: 'op'; op: '+' | '-' | '*' | '/' | '^' | 'cross'; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'apply'; name: string; args: Node[]; primes: number }
  | { t: 'fact'; a: Node }
  | { t: 'abs'; a: Node }
  | { t: 'root'; a: Node; n?: Node }
  | { t: 'log'; a: Node; base?: Node }
  | { t: 'big'; kind: 'sum' | 'prod'; v: string; lo: Node; hi: Node; body: Node }
  | { t: 'int'; v: string; lo?: Node; hi?: Node; body: Node }
  | { t: 'diff'; v: string; n: number; body: Node }
  | { t: 'lim'; v: string; to: Node; dir?: '+' | '-'; body: Node }
  | { t: 'mat'; rows: Node[][] }
  | { t: 'det'; a: Node }
  | { t: 'transpose'; a: Node }
  | { t: 'binom'; n: Node; k: Node }
  | { t: 'deg'; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'rel'; ops: Rel[]; parts: (Node | null)[] }

export type Rel = '=' | '<' | '>' | '<=' | '>=' | '!=' | '~'

export class CalcError extends Error {}

// ---------- Tokens ----------

type Tok = { k: 'cmd'; v: string } | { k: 'ch'; v: string } | { k: 'num'; v: string } | { k: '{' } | { k: '}' } | { k: '^' } | { k: '_' } | { k: '&' } | { k: 'row' }

/** Spacing and styling that changes nothing about the maths */
const IGNORED = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'middle', 'mathstrut', 'strut', 'hfill', 'thinspace', 'enspace', 'negthinspace'])
const DELIM_SIZERS = new Set(['left', 'right', 'mleft', 'mright', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr'])

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const s = src
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(s.slice(i))
      if (m) {
        i += m[0].length
        const name = m[1]
        if (IGNORED.has(name)) continue
        if (DELIM_SIZERS.has(name)) {
          // \left( is a "(": the delimiter that follows stands on its own; \left. is nothing
          while (s[i] === ' ') i++
          if (s[i] === '.') i++
          continue
        }
        // \text{…}, \mathrm{…} and friends: their letters as one word
        if (/^(text|textrm|mathrm|operatorname|mathit|mathbf|boldsymbol|vec|overrightarrow|mathsf|bm|hat|bar|overline|tilde)$/.test(name)) {
          const g = /^\s*\{([^{}]*)\}/.exec(s.slice(i))
          if (g) {
            i += g[0].length
            out.push({ k: 'cmd', v: `${name}:${g[1].replace(/\\,|\s+/g, '').trim()}` })
            continue
          }
        }
        out.push({ k: 'cmd', v: name })
        continue
      }
      const n = s[i + 1]
      i += 2
      if (n === '\\') out.push({ k: 'row' })
      else if (n === '{' || n === '}') out.push({ k: 'ch', v: n === '{' ? '(' : ')' })
      else if (n === '|') out.push({ k: 'ch', v: '‖' })
      else if (n === '%') out.push({ k: 'ch', v: '%' })
      else if (n === '#' || n === '&' || n === '$' || n === '_') out.push({ k: 'ch', v: n })
      // \, \; \! \  and the like are spacing
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
      if (m) {
        out.push({ k: 'num', v: m[1] })
        i += m[1].length
        continue
      }
    }
    if (c === '{') out.push({ k: '{' })
    else if (c === '}') out.push({ k: '}' })
    else if (c === '^') out.push({ k: '^' })
    else if (c === '_') out.push({ k: '_' })
    else if (c === '&') out.push({ k: '&' })
    else if (c === '$') {
      // a stray dollar from Markdown
    } else out.push({ k: 'ch', v: c })
    i++
  }
  return out
}

// ---------- Names ----------

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'])

/** Functions of one argument, by their LaTeX name, with the SymPy name */
const FUNCS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cosec: 'csc', cot: 'cot',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', arcsec: 'asec', arccsc: 'acsc', arccot: 'acot',
  asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', coth: 'coth', sech: 'sech', csch: 'csch',
  arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh', arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', asinh: 'asinh', acosh: 'acosh', atanh: 'atanh',
  exp: 'exp', sgn: 'sign', sign: 'sign', floor: 'floor', ceil: 'ceiling', Re: 're', Im: 'im', arg: 'arg', gcd: 'gcd', lcm: 'lcm', max: 'Max', min: 'Min', erf: 'erf', Gamma: 'gamma'
}
const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', sec: 'asec', csc: 'acsc', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' }
const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])
const INV_TRIG = new Set(['asin', 'acos', 'atan', 'asec', 'acsc', 'acot'])

const RELS: Record<string, Rel> = { '=': '=', '<': '<', '>': '>', lt: '<', gt: '>', le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', ne: '!=', neq: '!=', approx: '~', equiv: '=' }

// ---------- Parser ----------

class Parser {
  private p = 0
  private absDepth = 0
  /** Inside an integral: a "d" followed by a letter ends its body */
  private intDepth = 0
  constructor(private toks: Tok[]) {}

  private peek(o = 0): Tok | undefined {
    return this.toks[this.p + o]
  }
  private next(): Tok {
    const t = this.toks[this.p++]
    if (!t) throw new CalcError('The expression ends too soon')
    return t
  }
  private isCh(v: string, o = 0) {
    const t = this.peek(o)
    return !!t && t.k === 'ch' && t.v === v
  }
  private isCmd(v: string | RegExp, o = 0) {
    const t = this.peek(o)
    return !!t && t.k === 'cmd' && (typeof v === 'string' ? t.v === v : v.test(t.v))
  }
  private expectCh(v: string) {
    if (!this.isCh(v)) throw new CalcError(`Expected "${v}"`)
    this.p++
  }
  get done() {
    return this.p >= this.toks.length
  }

  parseTop(): Node {
    const n = this.relation()
    if (!this.done) {
      const t = this.peek()!
      throw new CalcError(`Couldn’t read past ${t.k === 'cmd' ? `\\${t.v}` : t.k === 'ch' || t.k === 'num' ? `"${t.v}"` : t.k}`)
    }
    return n
  }

  private relOp(): Rel | null {
    const t = this.peek()
    if (!t) return null
    if (t.k === 'ch' && (t.v === '=' || t.v === '<' || t.v === '>')) {
      // <= and >= typed as two characters
      if ((t.v === '<' || t.v === '>') && this.isCh('=', 1)) {
        this.p += 2
        return t.v === '<' ? '<=' : '>='
      }
      this.p++
      return t.v as Rel
    }
    if (t.k === 'ch' && (t.v === '≤' || t.v === '≥' || t.v === '≠' || t.v === '≈')) {
      this.p++
      return ({ '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~' } as Record<string, Rel>)[t.v]
    }
    if (t.k === 'cmd' && RELS[t.v]) {
      this.p++
      return RELS[t.v]
    }
    return null
  }

  relation(): Node {
    const parts: (Node | null)[] = []
    const ops: Rel[] = []
    // A line of working may start with "=": it carries on from the line before
    const lead = this.relOp()
    if (lead) {
      parts.push(null)
      ops.push(lead)
    }
    parts.push(this.additive())
    for (let op = this.relOp(); op; op = this.relOp()) {
      ops.push(op)
      parts.push(this.additive())
    }
    return ops.length ? { t: 'rel', ops, parts } : parts[0]!
  }

  private startsTerm(): boolean {
    const t = this.peek()
    if (!t) return false
    if (t.k === 'num' || t.k === '{') return true
    if (t.k === 'ch') {
      if (t.v === '|') return this.absDepth === 0
      if (t.v === '‖') return false
      if (/[a-zA-Z(\[]/.test(t.v)) {
        if (this.intDepth > 0 && t.v === 'd' && this.isDifferential()) return false
        return true
      }
      return /[αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ∞√]/.test(t.v)
    }
    if (t.k === 'cmd') {
      if (RELS[t.v] || /^(cdot|times|div|ast|pm|mp|to|rightarrow|end)$/.test(t.v)) return false
      if (this.intDepth > 0 && this.isDifferential()) return false
      return true
    }
    return false
  }

  /** dx, \mathrm{d}x, \differentialD x, \operatorname{d}x */
  private isDifferential(): boolean {
    const t = this.peek()
    if (!t) return false
    const isD = (t.k === 'ch' && t.v === 'd') || (t.k === 'cmd' && /^(differentialD|mathrm:d|operatorname:d|text:d|mathit:d)$/.test(t.v))
    if (!isD) return false
    const n = this.peek(1)
    return !!n && ((n.k === 'ch' && /[a-zA-Z]/.test(n.v)) || (n.k === 'cmd' && GREEK.has(n.v)))
  }

  private readDifferential(): string {
    this.next()
    const n = this.next()
    return n.k === 'ch' ? n.v : (n as { v: string }).v
  }

  additive(): Node {
    let left: Node
    if (this.isCh('-') || this.isCmd(/^(pm|mp)$/)) {
      this.p++
      left = { t: 'neg', a: this.multiplicative() }
    } else if (this.isCh('+')) {
      this.p++
      left = this.multiplicative()
    } else left = this.multiplicative()
    for (;;) {
      if (this.isCh('+')) {
        this.p++
        left = { t: 'op', op: '+', a: left, b: this.multiplicative() }
      } else if (this.isCh('-') || this.isCh('−')) {
        this.p++
        left = { t: 'op', op: '-', a: left, b: this.multiplicative() }
      } else return left
    }
  }

  multiplicative(): Node {
    let left = this.unary()
    for (;;) {
      if (this.isCmd(/^(cdot|ast)$/) || this.isCh('*') || this.isCh('·')) {
        this.p++
        left = { t: 'op', op: '*', a: left, b: this.unary() }
      } else if (this.isCmd('times') || this.isCh('×')) {
        this.p++
        left = { t: 'op', op: 'cross', a: left, b: this.unary() }
      } else if (this.isCmd('div') || this.isCh('/') || this.isCh('÷')) {
        this.p++
        left = { t: 'op', op: '/', a: left, b: this.unary() }
      } else if (this.startsTerm()) {
        left = { t: 'op', op: '*', a: left, b: this.power() }
      } else return left
    }
  }

  private unary(): Node {
    if (this.isCh('-') || this.isCh('−')) {
      this.p++
      return { t: 'neg', a: this.unary() }
    }
    if (this.isCh('+')) {
      this.p++
      return this.unary()
    }
    return this.power()
  }

  /** A script's argument: a group, or one character, digit or command */
  private scriptArg(): Node {
    const t = this.peek()
    if (!t) throw new CalcError('A power or index is empty')
    if (t.k === '{') return this.group()
    if (t.k === 'num') {
      this.p++
      if (t.v.length > 1) {
        // x^23 in TeX is x² · 3
        this.toks.splice(this.p, 0, { k: 'num', v: t.v.slice(1) })
        return { t: 'num', v: t.v[0] }
      }
      return { t: 'num', v: t.v }
    }
    return this.atom()
  }

  private group(): Node {
    if (this.peek()?.k !== '{') return this.atom()
    this.p++
    if (this.peek()?.k === '}') throw new CalcError('There’s an empty box to fill')
    const saveAbs = this.absDepth
    const saveInt = this.intDepth
    this.absDepth = 0
    this.intDepth = 0
    const n = this.relation()
    this.absDepth = saveAbs
    this.intDepth = saveInt
    if (this.peek()?.k !== '}') throw new CalcError('A group isn’t closed')
    this.p++
    return n
  }

  /** The text of a group as raw tokens, for subscripts of names and limits */
  private rawGroupTokens(): Tok[] {
    if (this.peek()?.k !== '{') return [this.next()]
    this.p++
    const start = this.p
    let depth = 1
    while (this.p < this.toks.length) {
      const k = this.toks[this.p].k
      if (k === '{') depth++
      if (k === '}' && --depth === 0) break
      this.p++
    }
    const inner = this.toks.slice(start, this.p)
    this.p++
    return inner
  }

  power(): Node {
    let base = this.postfix(this.atom())
    while (this.peek()?.k === '^') {
      this.p++
      // ^{\circ} is degrees, ^{T} a transpose, ^{\prime} a derivative mark
      const t = this.peek()
      if (t?.k === '{' && this.peek(1)?.k === 'cmd' && /^(circ)$/.test((this.peek(1) as { v: string }).v) && this.peek(2)?.k === '}') {
        this.p += 3
        base = { t: 'deg', a: base }
      } else if (t?.k === 'cmd' && t.v === 'circ') {
        this.p++
        base = { t: 'deg', a: base }
      } else if ((t?.k === '{' && this.peek(1)?.k === 'ch' && /^[T]$/.test((this.peek(1) as { v: string }).v) && this.peek(2)?.k === '}') || (t?.k === 'ch' && t.v === 'T') || (t?.k === '{' && this.peek(1)?.k === 'cmd' && /^(top|intercal)$/.test((this.peek(1) as { v: string }).v) && this.peek(2)?.k === '}')) {
        this.p += t.k === '{' ? 3 : 1
        base = { t: 'transpose', a: base }
      } else {
        const exp = this.scriptArg()
        base = { t: 'op', op: '^', a: base, b: exp }
      }
      base = this.postfix(base)
    }
    return base
  }

  private postfix(n: Node): Node {
    for (;;) {
      if (this.isCh('!')) {
        this.p++
        n = { t: 'fact', a: n }
      } else if (this.isCh('%')) {
        this.p++
        n = { t: 'pct', a: n }
      } else if (this.isCh('°') || this.isCmd('degree')) {
        this.p++
        n = { t: 'deg', a: n }
      } else return n
    }
  }

  /** A function's argument: (…) when it has brackets, else the run of factors after it (sin 2x) */
  private fnArg(): Node {
    if (this.isCh('(') || this.isCh('[')) return this.power()
    if (this.peek()?.k === '{') return this.group()
    let a = this.power()
    while (this.startsTerm() && !this.startsFunction()) a = { t: 'op', op: '*', a, b: this.power() }
    return a
  }

  private startsFunction(): boolean {
    const t = this.peek()
    return !!t && t.k === 'cmd' && (FUNCS[t.v] !== undefined || /^(ln|log|lg|sqrt|det|sum|prod|int|iint|lim|frac|dfrac|tfrac)$/.test(t.v))
  }

  private fnCall(name: string): Node {
    // \sin^2 x is (sin x)², \sin^{-1} x is arcsin x
    let pow: Node | null = null
    let fname = name
    if (this.peek()?.k === '^') {
      this.p++
      const e = this.scriptArg()
      const minusOne = e.t === 'neg' && e.a.t === 'num' && e.a.v === '1'
      if (minusOne && INVERSE[name]) fname = INVERSE[name]
      else pow = e
    }
    const sym = FUNCS[fname] ?? fname
    // gcd(a, b), max(a, b, c): several arguments in brackets
    if ((sym === 'gcd' || sym === 'lcm' || sym === 'Max' || sym === 'Min') && this.isCh('(')) {
      this.p++
      const args = [this.relation()]
      while (this.isCh(',')) {
        this.p++
        args.push(this.relation())
      }
      this.expectCh(')')
      const n: Node = { t: 'fn', name: sym, args }
      return pow ? { t: 'op', op: '^', a: n, b: pow } : n
    }
    const n: Node = { t: 'fn', name: sym, args: [this.fnArg()] }
    return pow ? { t: 'op', op: '^', a: n, b: pow } : n
  }

  private varName(toks: Tok[]): string {
    return toks.map((t) => (t.k === 'ch' || t.k === 'num' ? t.v : t.k === 'cmd' ? t.v.replace(/^\w+:/, '') : '')).join('')
  }

  atom(): Node {
    const t = this.next()
    if (t.k === 'num') return { t: 'num', v: t.v.endsWith('.') ? t.v.slice(0, -1) : t.v }
    if (t.k === '{') {
      this.p--
      return this.group()
    }
    if (t.k === 'ch') {
      const v = t.v
      if (v === '(' || v === '[') {
        const close = v === '(' ? ')' : ']'
        const saveAbs = this.absDepth
        const saveInt = this.intDepth
        this.absDepth = 0
        this.intDepth = 0
        const first = this.relation()
        // (a, b): a point or a vector, read as a column
        if (this.isCh(',')) {
          const items = [first]
          while (this.isCh(',')) {
            this.p++
            items.push(this.relation())
          }
          this.absDepth = saveAbs
          this.intDepth = saveInt
          this.expectCh(close)
          return { t: 'mat', rows: items.map((x) => [x]) }
        }
        this.absDepth = saveAbs
        this.intDepth = saveInt
        if (this.isCh(close) || this.isCh(close === ')' ? ']' : ')')) this.p++
        else throw new CalcError('A bracket isn’t closed')
        return first
      }
      if (v === '|' || v === '‖') {
        this.absDepth++
        const saveInt = this.intDepth
        this.intDepth = 0
        const inner = this.additive()
        this.intDepth = saveInt
        this.absDepth--
        if (!this.isCh(v)) throw new CalcError('An absolute value isn’t closed')
        this.p++
        return { t: 'abs', a: inner }
      }
      if (v === '∞') return { t: 'const', name: 'oo' }
      if (v === 'π') return { t: 'const', name: 'pi' }
      if (v === '√') return { t: 'root', a: this.power() }
      if (/[a-zA-Z]/.test(v)) return this.letter(v)
      const greek: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', σ: 'sigma', φ: 'phi', ω: 'omega' }
      if (greek[v]) return this.withSub(greek[v])
      throw new CalcError(`Couldn’t read "${v}"`)
    }
    if (t.k === 'cmd') return this.command(t.v)
    throw new CalcError('Couldn’t read that')
  }

  /** A name with its subscript: x_1, a_{n+1} */
  private withSub(name: string): Node {
    if (this.peek()?.k === '_') {
      this.p++
      const sub = this.varName(this.rawGroupTokens())
      return { t: 'sym', name: `${name}_${sub}` }
    }
    return { t: 'sym', name }
  }

  private letter(v: string): Node {
    // f(x), g(x+h), f'(x): a function applied, for the learner's own f and g
    if (/^[fgFG]$/.test(v)) {
      let primes = 0
      for (;;) {
        if (this.isCh("'") || this.isCh('′')) {
          this.p++
          primes++
        } else if (this.peek()?.k === '^' && ((this.peek(1)?.k === 'cmd' && (this.peek(1) as { v: string }).v === 'prime') || (this.peek(1)?.k === '{' && this.peek(2)?.k === 'cmd' && /^(prime|doubleprime)$/.test((this.peek(2) as { v: string }).v)))) {
          const braced = this.peek(1)?.k === '{'
          const which = (this.peek(braced ? 2 : 1) as { v: string }).v
          this.p += braced ? 4 : 2
          primes += which === 'doubleprime' ? 2 : 1
        } else break
      }
      if (this.isCh('(')) {
        this.p++
        const args = [this.relation()]
        while (this.isCh(',')) {
          this.p++
          args.push(this.relation())
        }
        this.expectCh(')')
        return { t: 'apply', name: v, args, primes }
      }
      if (primes) return { t: 'sym', name: `${v}${"'".repeat(primes)}` }
    }
    if (v === 'e') return { t: 'const', name: 'e' }
    return this.withSub(v)
  }

  private command(v: string): Node {
    if (v === 'pi') return { t: 'const', name: 'pi' }
    if (v === 'infty' || v === 'infin') return { t: 'const', name: 'oo' }
    if (v === 'exponentialE' || v === 'mathrm:e' || v === 'operatorname:e') return { t: 'const', name: 'e' }
    if (v === 'imaginaryI' || v === 'mathrm:i' || v === 'imath') return { t: 'const', name: 'i' }
    if (v === 'placeholder') throw new CalcError('There’s an empty box to fill')
    if (GREEK.has(v)) return this.withSub(v.replace(/^var/, ''))
    if (v === 'frac' || v === 'dfrac' || v === 'tfrac' || v === 'cfrac') return this.fraction()
    if (v === 'sqrt') {
      let n: Node | undefined
      if (this.isCh('[')) {
        this.p++
        n = this.additive()
        this.expectCh(']')
      }
      return { t: 'root', a: this.scriptArg(), ...(n ? { n } : {}) }
    }
    if (v === 'binom' || v === 'dbinom' || v === 'tbinom' || v === 'choose') {
      const n = this.scriptArg()
      return { t: 'binom', n, k: this.scriptArg() }
    }
    if (v === 'ln') return this.logOf()
    if (v === 'log' || v === 'lg') {
      let base: Node | undefined = v === 'lg' ? { t: 'num', v: '10' } : undefined
      if (this.peek()?.k === '_') {
        this.p++
        base = this.scriptArg()
      }
      return this.logOf(base)
    }
    if (v === 'det') return { t: 'det', a: this.fnArg() }
    if (v === 'sum' || v === 'prod') return this.big(v)
    if (v === 'int') return this.integral()
    if (v === 'lim') return this.limit()
    if (v === 'begin') return this.environment()
    if (v === 'lbrack' || v === 'lparen') {
      this.toks.splice(this.p, 0, { k: 'ch', v: v === 'lbrack' ? '[' : '(' })
      return this.atom()
    }
    if (v === 'lvert' || v === 'vert') {
      this.toks.splice(this.p, 0, { k: 'ch', v: '|' })
      return this.atom()
    }
    if (v === 'lfloor' || v === 'lceil') {
      const inner = this.additive()
      if (!this.isCmd(v === 'lfloor' ? 'rfloor' : 'rceil')) throw new CalcError('A floor or ceiling isn’t closed')
      this.p++
      return { t: 'fn', name: v === 'lfloor' ? 'floor' : 'ceiling', args: [inner] }
    }
    if (v === 'partial') throw new CalcError('Partial derivatives aren’t read yet')
    if (FUNCS[v] !== undefined) return this.fnCall(v)
    const word = /^(?:mathrm|operatorname|text|mathit|textrm|mathsf):(.+)$/.exec(v)?.[1]
    if (word !== undefined) {
      if (FUNCS[word] !== undefined) return this.fnCall(word)
      if (word === 'ln') return this.logOf()
      if (word === 'log') return this.command('log')
      if (/^(nCr|C)$/.test(word) && this.isCh('(')) {
        this.p++
        const n = this.additive()
        this.expectCh(',')
        const k = this.additive()
        this.expectCh(')')
        return { t: 'binom', n, k }
      }
      if (!word) throw new CalcError('There’s an empty box to fill')
      return this.withSub(word)
    }
    const bold = /^(?:mathbf|boldsymbol|vec|overrightarrow|bm|hat|bar|overline|tilde):(.+)$/.exec(v)?.[1]
    if (bold) return this.withSub(bold.replace(/^\\/, ''))
    throw new CalcError(`Tide’s calculator doesn’t know \\${v} yet`)
  }

  private logOf(base?: Node): Node {
    if (this.peek()?.k === '^') {
      // \ln^2 x
      this.p++
      const pow = this.scriptArg()
      return { t: 'op', op: '^', a: { t: 'log', a: this.fnArg(), ...(base ? { base } : {}) }, b: pow }
    }
    return { t: 'log', a: this.fnArg(), ...(base ? { base } : {}) }
  }

  private fraction(): Node {
    // d/dx and dⁿ/dxⁿ: a derivative, not a fraction
    const save = this.p
    const num = this.rawGroupTokens()
    const den = this.rawGroupTokens()
    const d = (x: Tok | undefined) => !!x && ((x.k === 'ch' && x.v === 'd') || (x.k === 'cmd' && /^(differentialD|mathrm:d|operatorname:d|text:d|partial)$/.test(x.v)))
    if (num.length >= 1 && d(num[0]) && den.length >= 2 && d(den[0])) {
      let order = 1
      let rest = num.slice(1)
      if (rest[0]?.k === '^') {
        order = Number((rest[1] as { v?: string })?.v ?? 1) || 1
        rest = rest.slice(2)
        if (rest[0]?.k === '{') rest = rest.slice(0)
      }
      const varTok = den[1]
      const v = varTok.k === 'ch' ? varTok.v : varTok.k === 'cmd' ? varTok.v.replace(/^\w+:/, '') : ''
      if (/^[a-zA-Z]+$/.test(v)) {
        if (num[0].k === 'cmd' && (num[0] as { v: string }).v === 'partial') throw new CalcError('Partial derivatives aren’t read yet')
        // dy/dx: the derivative of a name; d/dx (…): of what follows
        const body = rest.length ? new Parser(rest.filter((x) => x.k !== '{' && x.k !== '}')).parseTop() : this.fnArg()
        return { t: 'diff', v, n: order, body }
      }
    }
    this.p = save
    const a = this.scriptArg()
    const b = this.scriptArg()
    return { t: 'op', op: '/', a, b }
  }

  private big(kind: 'sum' | 'prod'): Node {
    let v = ''
    let lo: Node | undefined
    let hi: Node | undefined
    for (let k = 0; k < 2; k++) {
      if (this.peek()?.k === '_') {
        this.p++
        const toks = this.rawGroupTokens()
        const eq = toks.findIndex((x) => x.k === 'ch' && x.v === '=')
        if (eq < 1) throw new CalcError(`Give the ${kind === 'sum' ? 'sum' : 'product'} its index, as i = 1`)
        v = this.varName(toks.slice(0, eq))
        lo = new Parser(toks.slice(eq + 1)).parseTop()
      } else if (this.peek()?.k === '^') {
        this.p++
        hi = this.scriptArg()
      }
    }
    if (!v || !lo || !hi) throw new CalcError(`Give the ${kind === 'sum' ? 'sum' : 'product'} both its limits`)
    const body = this.fnArg()
    return { t: 'big', kind, v, lo, hi, body }
  }

  private integral(): Node {
    let lo: Node | undefined
    let hi: Node | undefined
    for (let k = 0; k < 2; k++) {
      if (this.peek()?.k === '_') {
        this.p++
        lo = this.scriptArg()
      } else if (this.peek()?.k === '^') {
        this.p++
        hi = this.scriptArg()
      }
    }
    this.intDepth++
    let body: Node
    try {
      body = this.additive()
    } finally {
      this.intDepth--
    }
    // The differential: dx, \,dx, \mathrm{d}x
    if (!this.isDifferential()) throw new CalcError('An integral needs its dx')
    const v = this.readDifferential()
    if ((lo && !hi) || (hi && !lo)) throw new CalcError('Give the integral both its limits, or neither')
    return { t: 'int', v, body, ...(lo && hi ? { lo, hi } : {}) }
  }

  private limit(): Node {
    if (this.peek()?.k !== '_') throw new CalcError('Give the limit what it tends to, as x → 0')
    this.p++
    const toks = this.rawGroupTokens()
    const arrow = toks.findIndex((x) => (x.k === 'cmd' && /^(to|rightarrow|longrightarrow)$/.test(x.v)) || (x.k === 'ch' && x.v === '→'))
    if (arrow < 1) throw new CalcError('Give the limit what it tends to, as x → 0')
    const v = this.varName(toks.slice(0, arrow))
    let target = toks.slice(arrow + 1)
    // 0^+ and 0^-: one-sided
    let dir: '+' | '-' | undefined
    const caret = target.findIndex((x) => x.k === '^')
    if (caret >= 0) {
      const after = target.slice(caret + 1).filter((x) => x.k !== '{' && x.k !== '}')
      if (after.length === 1 && after[0].k === 'ch' && (after[0].v === '+' || after[0].v === '-')) {
        dir = after[0].v as '+' | '-'
        target = target.slice(0, caret)
      }
    }
    const to = new Parser(target).parseTop()
    const body = this.fnArg()
    return { t: 'lim', v, to, body, ...(dir ? { dir } : {}) }
  }

  private environment(): Node {
    const name = this.varName(this.rawGroupTokens())
    if (!/^(pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|array|cases|aligned)$/.test(name)) throw new CalcError(`Tide’s calculator doesn’t read ${name} yet`)
    if (name === 'array' && this.peek()?.k === '{') this.rawGroupTokens()
    const rows: Node[][] = [[]]
    for (;;) {
      if (this.isCmd('end')) {
        this.p++
        this.rawGroupTokens()
        break
      }
      if (this.done) throw new CalcError('A matrix isn’t closed')
      if (this.peek()?.k === '&') {
        this.p++
        continue
      }
      if (this.peek()?.k === 'row') {
        this.p++
        rows.push([])
        continue
      }
      const save = this.absDepth
      this.absDepth = 0
      rows[rows.length - 1].push(this.additive())
      this.absDepth = save
    }
    const full = rows.filter((r) => r.length)
    if (!full.length) throw new CalcError('The matrix is empty')
    if (full.some((r) => r.length !== full[0].length)) throw new CalcError('Each row of a matrix needs the same number of entries')
    const m: Node = { t: 'mat', rows: full }
    return name === 'vmatrix' ? { t: 'det', a: m } : name === 'Vmatrix' ? { t: 'abs', a: { t: 'det', a: m } } : m
  }
}

/** The tree of a LaTeX expression; throws CalcError with a sentence a learner can act on */
export function parseLatex(src: string): Node {
  const cleaned = src
    .replace(/\\placeholder(\[[^\]]*\])?\{\}/g, '\\placeholder')
    .replace(/\\mathrm\{d\}/g, '\\differentialD ')
    .replace(/\\operatorname\{d\}/g, '\\differentialD ')
    .trim()
  if (!cleaned) throw new CalcError('Nothing to work out yet')
  return new Parser(tokenize(cleaned)).parseTop()
}

// ---------- SymPy ----------

const S = (name: string) => `Symbol(${JSON.stringify(name)})`

/** The tree as a SymPy expression; degrees wrap trig in and out */
export function toSympy(n: Node, angle: Angle = 'rad'): string {
  const go = (x: Node): string => toSympy(x, angle)
  switch (n.t) {
    case 'num':
      return n.v.includes('.') ? `Rational(${JSON.stringify(n.v)})` : `Integer(${n.v})`
    case 'sym':
      return S(n.name)
    case 'const':
      return { pi: 'pi', e: 'E', i: 'I', oo: 'oo' }[n.name]
    case 'op':
      if (n.op === '^') return `(${go(n.a)})**(${go(n.b)})`
      if (n.op === 'cross') return `_times(${go(n.a)}, ${go(n.b)})`
      return `(${go(n.a)} ${n.op} ${go(n.b)})`
    case 'neg':
      return `(-${go(n.a)})`
    case 'fn': {
      const args = n.args.map(go).join(', ')
      // sin 30° is in degrees whatever the setting
      if (angle === 'deg' && TRIG.has(n.name) && n.args[0].t !== 'deg') return `${n.name}(_rad(${args}))`
      if (angle === 'deg' && INV_TRIG.has(n.name)) return `_deg(${n.name}(${args}))`
      return `${n.name}(${args})`
    }
    case 'apply': {
      const f = `Function(${JSON.stringify(n.name)})(${n.args.map(go).join(', ')})`
      if (!n.primes) return f
      const arg = n.args[0]
      // f'(x): the derivative of f at x; at anything else, the derivative there
      if (n.args.length === 1 && arg.t === 'sym') return `Derivative(${f}, (${S(arg.name)}, ${n.primes}))`
      return `Subs(Derivative(Function(${JSON.stringify(n.name)})(Symbol("_t")), (Symbol("_t"), ${n.primes})), Symbol("_t"), ${go(arg)})`
    }
    case 'fact':
      return `factorial(${go(n.a)})`
    case 'abs':
      return `Abs(${go(n.a)})`
    case 'root':
      return n.n ? `_root(${go(n.a)}, ${go(n.n)})` : `sqrt(${go(n.a)})`
    case 'log':
      return n.base ? `log(${go(n.a)}, ${go(n.base)})` : `log(${go(n.a)})`
    case 'big':
      return `${n.kind === 'sum' ? 'Sum' : 'Product'}(${go(n.body)}, (${S(n.v)}, ${go(n.lo)}, ${go(n.hi)}))`
    case 'int':
      return n.lo && n.hi ? `Integral(${go(n.body)}, (${S(n.v)}, ${go(n.lo)}, ${go(n.hi)}))` : `Integral(${go(n.body)}, ${S(n.v)})`
    case 'diff':
      return `Derivative(${go(n.body)}, (${S(n.v)}, ${n.n}))`
    case 'lim':
      return `Limit(${go(n.body)}, ${S(n.v)}, ${go(n.to)}, ${JSON.stringify(n.dir ?? '+-')})`
    case 'mat':
      return `Matrix([${n.rows.map((r) => `[${r.map(go).join(', ')}]`).join(', ')}])`
    case 'det':
      return `_det(${go(n.a)})`
    case 'transpose':
      return `_transpose(${go(n.a)})`
    case 'binom':
      return `binomial(${go(n.n)}, ${go(n.k)})`
    case 'deg':
      return `(${go(n.a)} * pi / 180)`
    case 'pct':
      return `(${go(n.a)} / 100)`
    case 'rel':
      throw new CalcError('A relation is worked out part by part')
  }
}

/** The parts of a relation chain (a = b = c) or the one expression, as SymPy; a leading "=" carries on from before */
export interface SympyLine {
  parts: (string | null)[]
  ops: Rel[]
}

export function lineToSympy(n: Node, angle: Angle = 'rad'): SympyLine {
  if (n.t === 'rel') return { parts: n.parts.map((p) => (p ? toSympy(p, angle) : null)), ops: n.ops }
  return { parts: [toSympy(n, angle)], ops: [] }
}

// ---------- Numbers, here ----------

const factorial = (k: number): number => {
  if (!Number.isInteger(k) || k < 0) return Number.NaN
  if (k > 170) return Infinity
  let r = 1
  for (let j = 2; j <= k; j++) r *= j
  return r
}

const binomial = (n: number, k: number): number => {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) return Number.NaN
  let r = 1
  for (let j = 1; j <= Math.min(k, n - k); j++) r = (r * (n - Math.min(k, n - k) + j)) / j
  return Math.round(r)
}

const NUM_FN: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  asec: (x) => Math.acos(1 / x), acsc: (x) => Math.asin(1 / x), acot: (x) => Math.atan(1 / x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, coth: (x) => 1 / Math.tanh(x), sech: (x) => 1 / Math.cosh(x), csch: (x) => 1 / Math.sinh(x),
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, sign: Math.sign, floor: Math.floor, ceiling: Math.ceil
}

/** Simpson's rule, adaptive: a definite integral of a smooth enough function */
function integrate(f: (x: number) => number, a: number, b: number): number {
  const simpson = (l: number, r: number, fl: number, fm: number, fr: number) => ((r - l) / 6) * (fl + 4 * fm + fr)
  const rec = (l: number, r: number, fl: number, fm: number, fr: number, whole: number, eps: number, depth: number): number => {
    const m = (l + r) / 2
    const lm = (l + m) / 2
    const rm = (m + r) / 2
    const flm = f(lm)
    const frm = f(rm)
    const left = simpson(l, m, fl, flm, fm)
    const right = simpson(m, r, fm, frm, fr)
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15
    return rec(l, m, fl, flm, fm, left, eps / 2, depth - 1) + rec(m, r, fm, frm, fr, right, eps / 2, depth - 1)
  }
  const fa = f(a)
  const fb = f(b)
  const fm = f((a + b) / 2)
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), 1e-10, 40)
}

/**
 * The value as a decimal, worked out here; null when it has a letter with no value, a matrix, a
 * limit, or anything else that needs SymPy. Real numbers only.
 */
export function evalNumeric(n: Node, angle: Angle = 'rad', vars: Record<string, number> = {}): number | null {
  const go = (x: Node, v: Record<string, number> = vars): number | null => evalNumeric(x, angle, v)
  const both = (a: Node, b: Node, f: (x: number, y: number) => number) => {
    const x = go(a)
    const y = go(b)
    return x === null || y === null ? null : f(x, y)
  }
  const fin = (x: number | null) => (x === null || Number.isNaN(x) ? null : x)
  switch (n.t) {
    case 'num':
      return Number(n.v)
    case 'sym':
      return n.name in vars ? vars[n.name] : null
    case 'const':
      return n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : n.name === 'oo' ? Infinity : null
    case 'op':
      if (n.op === '+') return both(n.a, n.b, (x, y) => x + y)
      if (n.op === '-') return both(n.a, n.b, (x, y) => x - y)
      if (n.op === '*' || n.op === 'cross') return both(n.a, n.b, (x, y) => x * y)
      if (n.op === '/') return fin(both(n.a, n.b, (x, y) => (y === 0 ? Number.NaN : x / y)))
      return fin(
        both(n.a, n.b, (x, y) => {
          // A real odd root of a negative: (-8)^(1/3) is -2
          if (x < 0 && !Number.isInteger(y)) {
            const inv = 1 / y
            if (Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-12 && Math.round(inv) % 2 !== 0) return -Math.pow(-x, y)
          }
          return Math.pow(x, y)
        })
      )
    case 'neg': {
      const x = go(n.a)
      return x === null ? null : -x
    }
    case 'fn': {
      if (n.args.length !== 1) {
        const xs = n.args.map((a) => go(a))
        if (xs.some((x) => x === null)) return null
        const v = xs as number[]
        if (n.name === 'Max') return Math.max(...v)
        if (n.name === 'Min') return Math.min(...v)
        const g = (a: number, b: number): number => (b ? g(b, a % b) : Math.abs(a))
        if (n.name === 'gcd') return v.reduce(g)
        if (n.name === 'lcm') return v.reduce((a, b) => Math.abs(a * b) / g(a, b))
        return null
      }
      const f = NUM_FN[n.name]
      let x = go(n.args[0])
      if (!f || x === null) return null
      if (angle === 'deg' && TRIG.has(n.name) && n.args[0].t !== 'deg') x = (x * Math.PI) / 180
      let r = f(x)
      if (angle === 'deg' && INV_TRIG.has(n.name)) r = (r * 180) / Math.PI
      // sin(π) is 1.2e-16 in floating point: show it as the 0 it is
      if (TRIG.has(n.name) && Math.abs(r) < 1e-12) r = 0
      return fin(r)
    }
    case 'apply':
      return null
    case 'fact': {
      const x = go(n.a)
      return x === null ? null : fin(factorial(x))
    }
    case 'abs': {
      const x = go(n.a)
      return x === null ? null : Math.abs(x)
    }
    case 'root': {
      const x = go(n.a)
      const k = n.n ? go(n.n) : 2
      if (x === null || k === null) return null
      if (x < 0) return Number.isInteger(k) && k % 2 === 1 ? -Math.pow(-x, 1 / k) : null
      return Math.pow(x, 1 / k)
    }
    case 'log': {
      const x = go(n.a)
      const b = n.base ? go(n.base) : Math.E
      if (x === null || b === null || x <= 0 || b <= 0 || b === 1) return null
      return Math.log(x) / Math.log(b)
    }
    case 'big': {
      const lo = go(n.lo)
      const hi = go(n.hi)
      if (lo === null || hi === null || !Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo > 1_000_000) return null
      let acc = n.kind === 'sum' ? 0 : 1
      for (let k = lo; k <= hi; k++) {
        const v = go(n.body, { ...vars, [n.v]: k })
        if (v === null) return null
        acc = n.kind === 'sum' ? acc + v : acc * v
      }
      return fin(acc)
    }
    case 'int': {
      if (!n.lo || !n.hi) return null
      const a = go(n.lo)
      const b = go(n.hi)
      if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null
      let bad = false
      const f = (x: number) => {
        const v = go(n.body, { ...vars, [n.v]: x })
        if (v === null || !Number.isFinite(v)) bad = true
        return v ?? 0
      }
      const r = integrate(f, a, b)
      return bad ? null : fin(r)
    }
    case 'binom':
      return both(n.n, n.k, binomial)
    case 'deg': {
      const x = go(n.a)
      return x === null ? null : (x * Math.PI) / 180
    }
    case 'pct': {
      const x = go(n.a)
      return x === null ? null : x / 100
    }
    default:
      return null
  }
}

/** A decimal for the display: 12 significant figures at most, scientific when very large or small */
export function formatNumber(x: number, digits = 12): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : 'undefined'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e12 || ax < 1e-6) {
    const [m, e] = x.toExponential(digits - 1).split('e')
    const mant = m.replace(/\.?0+$/, '')
    return `${mant}\\times10^{${Number(e)}}`
  }
  const s = Number(x.toPrecision(digits)).toString()
  return s
}

/** The live preview: the decimal value of what's typed, or null when there isn't one yet */
export function previewOf(latex: string, angle: Angle = 'rad'): string | null {
  try {
    const n = parseLatex(latex)
    if (n.t === 'rel' || n.t === 'num') return null
    const v = evalNumeric(n, angle)
    return v === null ? null : formatNumber(v)
  } catch {
    return null
  }
}
