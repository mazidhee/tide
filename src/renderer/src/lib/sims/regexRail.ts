/**
 * A railroad diagram of a regular expression: the pattern is parsed by regexp-tree (MIT) and laid
 * out here as SVG. Any path from the left end to the right end spells a string the pattern
 * matches: boxes are what must be read, branches are alternatives, a loop below repeats, a line
 * above skips. Capture groups are framed and numbered as the match table numbers them.
 */
import parser from 'regexp-tree/dist/parser'
import { s } from './dom'

// ---------- The parse ----------

interface CharNode {
  type: 'Char'
  value: string
  kind: string
  symbol?: string
}
interface ClassRangeNode {
  type: 'ClassRange'
  from: CharNode
  to: CharNode
}
type AstNode =
  | { type: 'RegExp'; body: AstNode | null; flags: string }
  | { type: 'Disjunction'; left: AstNode | null; right: AstNode | null }
  | { type: 'Alternative'; expressions: AstNode[] }
  | CharNode
  | { type: 'CharacterClass'; negative?: boolean; expressions: (CharNode | ClassRangeNode)[] }
  | { type: 'Group'; capturing: boolean; number?: number; name?: string; expression: AstNode | null }
  | { type: 'Backreference'; kind: string; number?: number; reference: number | string }
  | { type: 'Repetition'; expression: AstNode; quantifier: { kind: string; from?: number; to?: number; greedy: boolean } }
  | { type: 'Assertion'; kind: string; negative?: boolean; assertion?: AstNode | null }

export type Parsed = { ok: true; ast: AstNode; groups: number } | { ok: false; error: string }

export function parsePattern(pattern: string, flags: string): Parsed {
  try {
    const ast = (parser as { parse(s: string): AstNode }).parse(`/${pattern.replace(/(^|[^\\])\//g, '$1\\/')}/${flags.replace(/[^gimsuy]/g, '')}`)
    let groups = 0
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return
      const node = n as Record<string, unknown>
      if (node.type === 'Group' && node.capturing) groups++
      for (const v of Object.values(node)) if (v && typeof v === 'object') Array.isArray(v) ? v.forEach(walk) : walk(v)
    }
    walk(ast)
    return { ok: true, ast, groups }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).trim().split('\n').pop() ?? 'Cannot be read' }
  }
}

// ---------- Words for the pieces ----------

const META: Record<string, string> = {
  '\\d': 'digit',
  '\\D': 'not a digit',
  '\\w': 'word character',
  '\\W': 'not a word character',
  '\\s': 'whitespace',
  '\\S': 'not whitespace',
  '.': 'any character',
  '\\n': 'newline',
  '\\t': 'tab',
  '\\r': 'carriage return',
  '\\f': 'form feed',
  '\\v': 'vertical tab',
  '\\0': 'null'
}

const charText = (c: CharNode) => (c.kind === 'meta' ? (META[c.value] ?? c.value) : c.kind === 'simple' ? (c.symbol ?? c.value) : (c.symbol ?? c.value))
const visible = (t: string) => (t === ' ' ? '␣' : t)

export function classText(n: { negative?: boolean; expressions: (CharNode | ClassRangeNode)[] }): string {
  const items = n.expressions.map((e) => (e.type === 'ClassRange' ? `${visible(charText(e.from))}–${visible(charText(e.to))}` : visible(charText(e))))
  return `${n.negative ? 'none of' : 'one of'} ${items.join(' ')}`
}

export function times(q: { kind: string; from?: number; to?: number; greedy: boolean }): { min: number; max: number } {
  switch (q.kind) {
    case '*':
      return { min: 0, max: Infinity }
    case '+':
      return { min: 1, max: Infinity }
    case '?':
      return { min: 0, max: 1 }
    default:
      // {n} has to = n; {n,} has no to at all
      return { min: q.from ?? 0, max: q.to ?? Infinity }
  }
}

// ---------- Layout ----------

interface Box {
  w: number
  up: number
  down: number
  draw(g: SVGGElement, x: number, y: number): void
}

const R = 9
const GAP = 12
const CHAR_MONO = 7.25
const CHAR_UI = 6.5

const line = (g: SVGGElement, d: string, cls = 'rr-line') => g.append(s('path', { d, class: cls }))

function terminal(label: string, cls: 'rr-lit' | 'rr-class' | 'rr-meta' | 'rr-assert' | 'rr-ref', part?: string): Box {
  const mono = cls === 'rr-lit'
  const w = Math.round(label.length * (mono ? CHAR_MONO : CHAR_UI) + 20)
  return {
    w,
    up: 12,
    down: 12,
    draw(g, x, y) {
      const node = s('g', { class: `rr-node ${cls}`, ...(part ? { 'data-part': part } : {}) })
      node.append(s('rect', { x, y: y - 12, width: w, height: 24, rx: cls === 'rr-lit' ? 12 : 5 }), s('text', { x: x + w / 2, y: y + 4, 'text-anchor': 'middle' }, label))
      g.append(node)
    }
  }
}

const space = (w: number): Box => ({ w, up: 0, down: 0, draw: (g, x, y) => line(g, `M${x} ${y}h${w}`) })

function seq(items: Box[]): Box {
  if (!items.length) return space(GAP * 2)
  const w = items.reduce((a, b) => a + b.w, 0) + GAP * (items.length - 1)
  return {
    w,
    up: Math.max(...items.map((i) => i.up)),
    down: Math.max(...items.map((i) => i.down)),
    draw(g, x, y) {
      let at = x
      items.forEach((it, k) => {
        if (k) {
          line(g, `M${at} ${y}h${GAP}`)
          at += GAP
        }
        it.draw(g, at, y)
        at += it.w
      })
    }
  }
}

function choice(items: Box[]): Box {
  if (items.length === 1) return items[0]
  const inner = Math.max(...items.map((i) => i.w))
  const offsets: number[] = [0]
  for (let k = 1; k < items.length; k++) offsets.push(offsets[k - 1] + items[k - 1].down + 10 + items[k].up)
  return {
    w: inner + 4 * R,
    up: items[0].up,
    down: offsets[offsets.length - 1] + items[items.length - 1].down,
    draw(g, x, y) {
      items.forEach((it, k) => {
        const by = y + offsets[k]
        const left = x + 2 * R
        if (k === 0) line(g, `M${x} ${y}h${2 * R}`)
        else line(g, `M${x} ${y}q${R} 0 ${R} ${R}v${offsets[k] - 2 * R}q0 ${R} ${R} ${R}`)
        it.draw(g, left, by)
        line(g, `M${left + it.w} ${by}H${left + inner}`)
        if (k === 0) line(g, `M${left + inner} ${y}h${2 * R}`)
        else line(g, `M${left + inner} ${by}q${R} 0 ${R} ${-R}v${-(offsets[k] - 2 * R)}q0 ${-R} ${R} ${-R}`)
      })
    }
  }
}

function repeat(item: Box, min: number, max: number, greedy: boolean): Box {
  const loops = max > 1
  const skips = min === 0
  const label = !loops ? '' : max === Infinity ? (min > 1 ? `${min} or more times` : '') : min === max ? `${min} times` : `${min} to ${max} times`
  const note = [label, greedy ? '' : 'as few as possible'].filter(Boolean).join(', ')
  const labelW = note.length * CHAR_UI * 0.92
  const w = Math.max(item.w + 4 * R, labelW + 2 * R)
  const loopDrop = item.down + R + 4
  return {
    w,
    up: skips ? item.up + R + 4 : item.up,
    down: (loops ? loopDrop + (note ? 16 : 0) : item.down) + 2,
    draw(g, x, y) {
      const left = x + (w - item.w) / 2
      line(g, `M${x} ${y}H${left}`)
      item.draw(g, left, y)
      line(g, `M${left + item.w} ${y}H${x + w}`)
      if (skips) {
        const top = item.up + R + 4
        line(g, `M${x} ${y}q${R} 0 ${R} ${-R}v${-(top - 2 * R)}q0 ${-R} ${R} ${-R}H${x + w - 2 * R}q${R} 0 ${R} ${R}v${top - 2 * R}q0 ${R} ${R} ${R}`, 'rr-line rr-skip')
      }
      if (loops) {
        line(g, `M${left + item.w} ${y}q${R} 0 ${R} ${R}v${loopDrop - 2 * R}q0 ${R} ${-R} ${R}H${left}q${-R} 0 ${-R} ${-R}v${-(loopDrop - 2 * R)}q0 ${-R} ${R} ${-R}`, 'rr-line rr-loop')
        if (note) g.append(s('text', { x: x + w / 2, y: y + loopDrop + 13, 'text-anchor': 'middle', class: 'rr-note' }, note))
      }
    }
  }
}

function frame(item: Box, label: string, cls: string, part?: string): Box {
  const pad = 8
  const labelW = label.length * CHAR_UI * 0.92 + 4
  const w = Math.max(item.w + 2 * pad, labelW + 2 * pad)
  return {
    w,
    up: item.up + pad + 15,
    down: item.down + pad,
    draw(g, x, y) {
      const node = s('g', { class: `rr-frame ${cls}`, ...(part ? { 'data-part': part } : {}) })
      node.append(s('rect', { x, y: y - item.up - pad, width: w, height: item.up + item.down + 2 * pad, rx: 7 }), s('text', { x: x + 2, y: y - item.up - pad - 5, class: 'rr-note' }, label))
      g.append(node)
      const left = x + (w - item.w) / 2
      line(g, `M${x} ${y}H${left}`)
      item.draw(g, left, y)
      line(g, `M${left + item.w} ${y}H${x + w}`)
    }
  }
}

function build(n: AstNode | null): Box {
  if (!n) return space(GAP * 2)
  switch (n.type) {
    case 'RegExp':
      return build(n.body)
    case 'Disjunction': {
      const alts: (AstNode | null)[] = []
      const flatten = (d: AstNode | null): void => {
        if (d && d.type === 'Disjunction') {
          flatten(d.left)
          flatten(d.right)
        } else alts.push(d)
      }
      flatten(n)
      return choice(alts.map(build))
    }
    case 'Alternative': {
      const out: Box[] = []
      let run = ''
      const flush = () => {
        if (run) out.push(terminal(`"${run}"`, 'rr-lit'))
        run = ''
      }
      for (const e of n.expressions) {
        if (e.type === 'Char' && e.kind !== 'meta' && charText(e).length === 1) run += charText(e)
        else {
          flush()
          out.push(build(e))
        }
      }
      flush()
      return seq(out)
    }
    case 'Char':
      return n.kind === 'meta' ? terminal(charText(n), 'rr-meta') : terminal(`"${charText(n)}"`, 'rr-lit')
    case 'CharacterClass':
      return terminal(classText(n), 'rr-class')
    case 'Group':
      return n.capturing ? frame(build(n.expression), `group ${n.number}${n.name ? ` · ${n.name}` : ''}`, `rr-group g${(((n.number ?? 1) - 1) % 4) + 1}`, `group:${n.number}`) : build(n.expression)
    case 'Backreference':
      return terminal(`same text as group ${n.number ?? n.reference}`, 'rr-ref')
    case 'Repetition': {
      const { min, max } = times(n.quantifier)
      return repeat(build(n.expression), min, max, n.quantifier.greedy)
    }
    case 'Assertion': {
      const words: Record<string, string> = { '^': 'start', $: 'end', '\\b': 'word boundary', '\\B': 'not a word boundary' }
      if (n.kind === 'Lookahead' || n.kind === 'Lookbehind') {
        const label = `${n.negative ? 'not ' : ''}${n.kind === 'Lookahead' ? 'followed by' : 'preceded by'} (not consumed)`
        return frame(build(n.assertion ?? null), label, 'rr-look')
      }
      return terminal(words[n.kind] ?? n.kind, 'rr-assert')
    }
  }
}

/** The diagram as an SVG element, or null when the pattern can't be read */
export function railroad(ast: AstNode): { svg: SVGSVGElement; width: number; height: number } {
  const body = build(ast)
  const end = 10
  const width = body.w + 2 * end + 16
  const height = body.up + body.down + 16
  const y = body.up + 8
  const svg = s('svg', { class: 'rr', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Railroad diagram of the pattern' })
  const g = s('g')
  svg.append(g)
  g.append(s('path', { d: `M8 ${y - 7}v14M12 ${y - 7}v14`, class: 'rr-end' }))
  line(g, `M12 ${y}h${end - 4}`)
  body.draw(g, 8 + end, y)
  line(g, `M${8 + end + body.w} ${y}h${end - 4}`)
  g.append(s('path', { d: `M${width - 12} ${y - 7}v14M${width - 8} ${y - 7}v14`, class: 'rr-end' }))
  return { svg, width, height }
}
