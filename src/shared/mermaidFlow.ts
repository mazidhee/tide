/**
 * Reads a mermaid flowchart (the diagrams the tutor writes in lessons) into plain nodes, edges and
 * subgraphs, so it can be drawn on Tide's canvas, where a request can be played along its edges.
 *
 * Only what this reader fully understands is accepted; anything else (the newer `A@{ shape }`
 * syntax, edge ids, a flowchart it can't follow) returns null and mermaid draws the block as before.
 */

export type FlowShape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'flag' | 'diamond' | 'hexagon' | 'parallelogram' | 'trapezoid'

export interface FlowNode {
  id: string
  label: string
  shape: FlowShape
}

export interface FlowLink {
  from: string
  to: string
  label?: string
  /** An arrowhead at each end */
  toArrow: boolean
  fromArrow: boolean
  dashed: boolean
  thick: boolean
}

export interface FlowGroup {
  id: string
  label: string
  /** Node ids and nested group ids directly inside it */
  members: string[]
  parent?: string
}

export interface MermaidFlow {
  direction: 'TB' | 'BT' | 'LR' | 'RL'
  nodes: FlowNode[]
  links: FlowLink[]
  groups: FlowGroup[]
}

// Openers, longest first, with the closer each one needs
const SHAPES: [string, string, FlowShape][] = [
  ['(((', ')))', 'circle'],
  ['([', '])', 'stadium'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[\\', '\\]', 'parallelogram'],
  ['[/', '\\]', 'trapezoid'],
  ['[\\', '/]', 'trapezoid'],
  ['(', ')', 'round'],
  ['[', ']', 'rect'],
  ['{', '}', 'diamond'],
  ['>', ']', 'flag']
]

const ID = /^[A-Za-z0-9_À-￿](?:[\w$À-￿]|-(?![-.>=]))*/

/** A label as mermaid would show it: quotes, markdown backticks and HTML line breaks undone */
export function cleanLabel(raw: string): string {
  let s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1)
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()
}

class Fail extends Error {}

/** Splits into statements on new lines and on semicolons outside quotes and brackets */
function statements(src: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = false
  let depth = 0
  for (const ch of src) {
    if (ch === '"') quote = !quote
    if (!quote) {
      if ('[({'.includes(ch)) depth++
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    }
    if ((ch === '\n' || (ch === ';' && !quote && depth === 0)) && !quote) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s && !s.startsWith('%%'))
}

export function parseMermaidFlow(code: string): MermaidFlow | null {
  let src = code.replace(/\r/g, '')
  // Front matter (--- title: ... ---) before the diagram
  src = src.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '')
  const lines = statements(src)
  const head = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*$/i.exec(lines[0] ?? '')
  if (!head) return null
  const dir = (head[2] ?? 'TB').toUpperCase()
  const flow: MermaidFlow = { direction: dir === 'TD' ? 'TB' : (dir as MermaidFlow['direction']), nodes: [], links: [], groups: [] }
  const nodes = new Map<string, FlowNode>()
  const groups = new Map<string, FlowGroup>()
  const stack: FlowGroup[] = []
  const place = (id: string) => {
    const g = stack[stack.length - 1]
    if (!g || g.members.includes(id)) return
    // A node belongs to the first subgraph it is written in
    if ([...groups.values()].some((x) => x.members.includes(id))) return
    g.members.push(id)
  }
  try {
    for (const line of lines.slice(1)) {
      if (/^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/.test(line)) continue
      const sub = /^subgraph\s+(.+)$/.exec(line)
      if (sub) {
        const rest = sub[1].trim()
        let id: string
        let label: string
        const m = /^([A-Za-z0-9_\-.]+)\s*\[(.*)\]$/.exec(rest)
        if (m) {
          id = m[1]
          label = cleanLabel(m[2])
        } else if (/^".*"$/.test(rest)) {
          label = cleanLabel(rest)
          id = `sub-${groups.size + 1}`
        } else {
          id = rest
          label = rest
        }
        if (groups.has(id) || nodes.has(id)) return null
        const g: FlowGroup = { id, label, members: [], ...(stack.length ? { parent: stack[stack.length - 1].id } : {}) }
        if (stack.length) stack[stack.length - 1].members.push(id)
        groups.set(id, g)
        stack.push(g)
        continue
      }
      if (line === 'end') {
        if (!stack.pop()) return null
        continue
      }
      statement(line)
    }
  } catch (e) {
    if (e instanceof Fail) return null
    throw e
  }
  if (stack.length) return null
  // A link to a subgraph's id would need a node to attach to; leave those to mermaid
  if (flow.links.some((l) => groups.has(l.from) || groups.has(l.to))) return null
  flow.nodes = [...nodes.values()]
  flow.groups = [...groups.values()]
  return flow.nodes.length ? flow : null

  function statement(line: string) {
    let pos = 0
    const ws = () => {
      while (pos < line.length && /\s/.test(line[pos])) pos++
    }
    const node = (): string => {
      ws()
      const m = ID.exec(line.slice(pos))
      if (!m) throw new Fail()
      const id = m[0]
      pos += id.length
      if (line[pos] === '@') throw new Fail() // A@{ shape: ... } or an edge id
      let shape: FlowShape | null = null
      let label: string | null = null
      for (const [open, close, s] of SHAPES) {
        if (!line.startsWith(open, pos)) continue
        let i = pos + open.length
        let text: string
        const inner = line.slice(i).trimStart()
        if (inner.startsWith('"')) {
          i = line.indexOf('"', line.indexOf('"', i) + 1)
          if (i < 0) throw new Fail()
          text = line.slice(pos + open.length, i + 1)
          i++
          while (line[i] === ' ') i++
          if (!line.startsWith(close, i)) continue
        } else {
          const end = line.indexOf(close, i)
          if (end < 0) continue
          text = line.slice(i, end)
          i = end
        }
        shape = s
        label = cleanLabel(text)
        pos = i + close.length
        break
      }
      // :::className
      const cls = /^:::[\w-]+/.exec(line.slice(pos))
      if (cls) pos += cls[0].length
      const known = nodes.get(id)
      if (!known) nodes.set(id, { id, label: label ?? id, shape: shape ?? 'rect' })
      else if (label !== null) Object.assign(known, { label, shape: shape ?? known.shape })
      place(id)
      return id
    }
    const group = (): string[] => {
      const ids = [node()]
      for (;;) {
        ws()
        if (line[pos] !== '&') return ids
        pos++
        ids.push(node())
      }
    }
    const link = (): Omit<FlowLink, 'from' | 'to'> & { hidden: boolean } | null => {
      ws()
      const rest = line.slice(pos)
      if (!rest) return null
      // -- text -->, == text ==>, -. text .->
      const named = /^(<)?(--|==|-\.)\s+(.+?)\s*(-->|---|==>|===|\.->|\.-)(?!-)/.exec(rest)
      if (named && !named[3].includes('|')) {
        pos += named[0].length
        const end = named[4]
        return { label: cleanLabel(named[3]), toArrow: end.endsWith('>'), fromArrow: !!named[1], dashed: named[2] === '-.', thick: named[2] === '==', hidden: false }
      }
      const m = /^(<|o(?=-)|x(?=-))?(-{2,}|={2,}|-\.+-|~{3,})(>|o|x)?/.exec(rest)
      if (!m) throw new Fail()
      pos += m[0].length
      ws()
      let label: string | undefined
      if (line[pos] === '|') {
        const end = line.indexOf('|', pos + 1)
        if (end < 0) throw new Fail()
        label = cleanLabel(line.slice(pos + 1, end)) || undefined
        pos = end + 1
      }
      const body = m[2]
      return { label, toArrow: !!m[3], fromArrow: !!m[1], dashed: body.includes('.'), thick: body.startsWith('='), hidden: body.startsWith('~') }
    }
    let left = group()
    for (;;) {
      const l = link()
      if (!l) break
      const right = group()
      if (!l.hidden)
        for (const from of left)
          for (const to of right) {
            const { hidden: _h, label, ...rest } = l
            flow.links.push({ from, to, ...(label ? { label } : {}), ...rest })
          }
      left = right
    }
    ws()
    if (pos < line.length) throw new Fail()
  }
}
