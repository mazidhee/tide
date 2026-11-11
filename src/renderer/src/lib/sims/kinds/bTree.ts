/**
 * A B-tree worked one small step at a time: compare and go down, insert into a leaf, split an
 * overflowing node around its median, borrow or merge to repair an underflow, and the root
 * splitting or shrinking when the height changes. The tree drawn is the model's own snapshot of
 * each step; the sentence beside it is the rule the model applied.
 */
import { button, h, ring, s, segmented, stat } from '../dom'
import { BTREE_LIMITS, BTreeSim, describeBTreePart, levels, maxKeys, minKeys, parseBTreePart, parseKey, showKey, stats, whereIs, type BNode, type BOp, type BOpType, type BStep, type BTreeSpec } from '../btree'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../spec'

const CELL_H = 24
const CELL_W = 22
const CHAR_W = 6.7
const LEVEL_GAP = 32
const LEAF_GAP = 8
const TREE_GAP = 16
/** Room for "2/3" beside an internal node or under a leaf */
const OCC_W = 20
const PAD = 9
const MIN_SCALE = 0.86
const MAX_SCALE = 1.2

const cellWidth = (key: number) => Math.max(CELL_W, Math.ceil(showKey(key).length * CHAR_W + 9))
const nodeWidth = (n: BNode) => (n.keys.length ? n.keys.reduce((a, k) => a + cellWidth(k), 0) : CELL_W)

interface Placed {
  node: BNode
  level: number
  x: number
  y: number
  w: number
  /** Left edge of each key cell, and the right edge of the last */
  edges: number[]
  kids: Placed[]
}

/** Lays the tree out with leaves side by side and each parent centred over its children */
function layout(root: BNode): { placed: Placed; width: number; height: number } {
  const widths = new Map<number, number>()
  const span = (n: BNode): number => {
    const leaf = !n.kids.length
    const kids = n.kids.reduce((a, k) => a + span(k), 0) + Math.max(0, n.kids.length - 1) * (n.kids[0]?.kids.length ? TREE_GAP : LEAF_GAP)
    const w = Math.max(kids, nodeWidth(n) + (leaf ? 0 : 2 * (OCC_W + 5)))
    widths.set(n.id, w)
    return w
  }
  const place = (n: BNode, left: number, level: number): Placed => {
    const total = widths.get(n.id) ?? 0
    const gap = n.kids[0]?.kids.length ? TREE_GAP : LEAF_GAP
    const kidsW = n.kids.reduce((a, k) => a + (widths.get(k.id) ?? 0), 0) + Math.max(0, n.kids.length - 1) * gap
    let at = left + (total - kidsW) / 2
    const kids = n.kids.map((k) => {
      const p = place(k, at, level + 1)
      at += (widths.get(k.id) ?? 0) + gap
      return p
    })
    const w = nodeWidth(n)
    const cx = kids.length ? (kids[0].x + kids[0].w / 2 + kids[kids.length - 1].x + kids[kids.length - 1].w / 2) / 2 : left + total / 2
    const x = Math.round(cx - w / 2)
    const edges = [x]
    for (const k of n.keys) edges.push(edges[edges.length - 1] + cellWidth(k))
    if (!n.keys.length) edges.push(x + w)
    return { node: n, level, x, y: PAD + (level - 1) * (CELL_H + LEVEL_GAP), w, edges, kids }
  }
  const total = span(root)
  const depth = levels(root).length
  return { placed: place(root, PAD, 1), width: total + 2 * PAD, height: PAD + depth * CELL_H + (depth - 1) * LEVEL_GAP + 20 }
}

const OP_WORD: Record<BOpType, string> = { insert: 'Insert', delete: 'Delete', search: 'Search for' }
const opText = (op: BOp) => `${OP_WORD[op.type]} ${showKey(op.key)}`
const CHIP: Partial<Record<BStep['kind'], string>> = {
  found: 'pos',
  insert: 'pos',
  missing: 'bad',
  duplicate: 'bad',
  full: 'bad',
  split: 'neg',
  'root-split': 'neg',
  'borrow-left': 'neg',
  'borrow-right': 'neg',
  merge: 'neg',
  'root-shrink': 'neg'
}

function create(spec: BTreeSpec, host: SimHost): SimView {
  const sim = new BTreeSim(spec)
  let marked: string | null = null
  let stale = true
  let message = ''
  let messageBad = false

  const touch = () => {
    stale = true
    host.invalidate()
  }

  // ---------- Controls ----------
  const input = h('input', { class: 'sim-input sim-mono sim-bt-input', type: 'text', inputmode: 'numeric', placeholder: '42', maxlength: 6, 'aria-label': 'Key, a whole number', autocomplete: 'off', spellcheck: 'false' })
  const say = h('p', { class: 'sim-bt-msg', 'aria-live': 'polite' })

  function submit(type: BOpType): void {
    const typed = input.value.trim()
    const key = parseKey(typed)
    input.classList.toggle('bad', key === null)
    if (key === null) {
      messageBad = true
      message = !typed
        ? 'Type a key first: a whole number such as 42.'
        : /^[-+−]?\d+$/.test(typed)
          ? `Keys here run from ${showKey(BTREE_LIMITS.key[0])} to ${BTREE_LIMITS.key[1]}.`
          : `"${typed.slice(0, 12)}" is not a whole number. Keys are whole numbers such as 42.`
      touch()
      return
    }
    const present = sim.tree.has(key)
    messageBad = false
    message =
      type === 'insert' && present
        ? `${showKey(key)} is already in the tree. Step through to see where the search finds it.`
        : type !== 'insert' && !present
          ? `${showKey(key)} is not in the tree. Step through to see where the search ends.`
          : `${opText({ type, key })}: press Step or Play to follow it.`
    sim.begin({ type, key })
    input.select()
    touch()
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submit('insert')
      e.preventDefault()
    }
  })
  input.addEventListener('input', () => input.classList.remove('bad'))
  const keyField = h(
    'div',
    { class: 'sim-field' },
    h('span', { class: 'sim-label' }, 'Key'),
    h('div', { class: 'sim-inline' }, input, button('Insert', () => submit('insert')), button('Search', () => submit('search')), button('Delete', () => submit('delete')))
  )
  const orderField = segmented(
    'Order m',
    [3, 4, 5, 6, 7].map((m) => [String(m), String(m)] as const),
    String(sim.order),
    (v) => {
      sim.setOrder(Number(v))
      messageBad = false
      message = `Rebuilt at order ${v} by inserting the same ${sim.tree.size} keys in the same sequence.`
      touch()
    }
  )
  orderField.el.classList.add('sim-bt-order')

  // ---------- The picture ----------
  const svg = s('svg', { class: 'sim-bt-svg', role: 'group' })
  const treeBox = h('div', { class: 'sim-bt-tree' }, svg)
  const scrollHint = h('span', { class: 'sim-bt-leg sim-bt-scroll', hidden: true }, 'Scroll sideways for the rest of the tree')
  const legend = h(
    'div',
    { class: 'sim-bt-legend' },
    h('span', { class: 'sim-bt-leg' }, h('i', { class: 'sim-bt-sw sim-bt-sw-now' }), 'node being worked on'),
    h('span', { class: 'sim-bt-leg' }, h('i', { class: 'sim-bt-sw' }), 'path'),
    h('span', { class: 'sim-bt-leg' }, h('i', { class: 'sim-bt-sw sim-bt-sw-touched' }), 'also changed'),
    h('span', { class: 'sim-bt-leg' }, h('span', { class: 'sim-mono' }, '2/3'), 'keys held of the most a node may hold'),
    scrollHint
  )

  // ---------- What just happened ----------
  const chip = h('span', { class: 'sim-chip' })
  const opLabel = h('span', { class: 'sim-bt-op' })
  const sentence = h('p', { class: 'sim-bt-text', 'aria-live': 'polite' })
  const pathRow = h('div', { class: 'sim-bt-path sim-part', tabindex: 0, role: 'button', 'aria-label': 'Path of the current operation' })
  const now = h('div', { class: 'sim-panel sim-bt-now' }, h('div', { class: 'sim-bt-nowhead' }, chip, opLabel), sentence, pathRow)
  const selectable = (el: HTMLElement, part: string): HTMLElement => {
    el.addEventListener('click', () => host.select(part))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        host.select(part)
        e.preventDefault()
      }
    })
    return el
  }
  selectable(pathRow, 'path')
  chip.tabIndex = 0
  chip.setAttribute('role', 'button')
  chip.classList.add('sim-bt-rule')
  selectable(chip, 'step')

  const statKeys = stat('Keys')
  const statNodes = stat('Nodes')
  const statHeight = stat('Height')
  const statFill = stat('Fill')
  const partStat = (st: { el: HTMLElement }, part: string): HTMLElement => {
    st.el.classList.add('sim-part', 'sim-bt-stat')
    st.el.tabIndex = 0
    st.el.setAttribute('role', 'button')
    return selectable(st.el, part)
  }
  const statsRow = h('div', { class: 'sim-stats sim-bt-stats' }, statKeys.el, statNodes.el, partStat(statHeight, 'height'), partStat(statFill, 'fill'))
  orderField.el.querySelector('.sim-label')?.addEventListener('click', () => host.select('order'))
  const trail = h('ol', { class: 'sim-bt-trail' })
  const queueRow = h('div', { class: 'sim-bt-queue' })
  const side = h('div', { class: 'sim-stack' }, statsRow, h('div', { class: 'sim-bt-block' }, h('span', { class: 'sim-label' }, 'Steps of this operation'), trail), h('div', { class: 'sim-bt-block' }, h('span', { class: 'sim-label' }, 'Queued next'), queueRow))

  const note = h('p', { class: 'sim-note' })
  const el = h('div', { class: 'sim-bt' }, h('div', { class: 'sim-params' }, keyField, orderField.el, say), treeBox, legend, h('div', { class: 'sim-two sim-bt-under' }, now, side), note)

  const context = () => ({ root: sim.shown, order: sim.order, op: sim.op, step: sim.current, stepAt: sim.at + 1, stepCount: sim.steps.length })

  // ---------- Drawing ----------
  function drawTree(): void {
    const root = sim.shown
    const step = sim.current
    const { placed, width, height } = layout(root)
    const max = maxKeys(sim.order)
    const min = minKeys(sim.order)
    const onPath = new Set(step?.path ?? [])
    const touched = new Set(step?.touched ?? [])
    const hot = new Set(step?.keys ?? [])
    const want = marked ? parseBTreePart(marked, root) : null
    const held = svg.contains(document.activeElement) ? (document.activeElement as Element).getAttribute('data-part') : null
    const index = new Map<number, number>()
    levels(root).forEach((row) => row.forEach((n, i) => index.set(n.id, i + 1)))

    const edges = s('g', { class: 'sim-bt-edges' })
    const nodes = s('g')
    const walk = (p: Placed): void => {
      const n = p.node
      const i = index.get(n.id) ?? 1
      const isRoot = p.level === 1
      const over = n.keys.length > max
      const under = !isRoot && n.keys.length < min
      const focus = step?.node === n.id
      const cls = ['sim-bt-node', onPath.has(n.id) && 'path', focus && 'now', touched.has(n.id) && 'touched', (over || under) && 'bad', !n.keys.length && 'hollow'].filter(Boolean).join(' ')
      const g = s('g', { class: cls })
      g.append(s('rect', { class: 'sim-bt-box', x: p.x + 0.5, y: p.y + 0.5, width: p.w - 1, height: CELL_H - 1, rx: 6 }))
      n.keys.forEach((key, k) => {
        const x = p.edges[k]
        const w = p.edges[k + 1] - x
        const cell = s(
          'g',
          { class: `sim-bt-key${hot.has(key) ? ' hot' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Key ${showKey(key)}`, 'data-part': `key:${key}` },
          s('rect', { class: 'sim-bt-keybg', x: x + 2.5, y: p.y + 2.5, width: w - 5, height: CELL_H - 5, rx: 4 }),
          s('text', { class: 'sim-bt-num', x: x + w / 2, y: p.y + CELL_H / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, showKey(key))
        )
        g.append(cell)
        if (k > 0) g.append(s('line', { class: 'sim-bt-div', x1: x, y1: p.y + 4, x2: x, y2: p.y + CELL_H - 4 }))
        if (want?.type === 'key' && want.key === key) g.append(s('rect', { class: 'sim-bt-ring', x: x - 1.5, y: p.y - 2.5, width: w + 3, height: CELL_H + 5, rx: 7 }))
      })
      if (focus) g.append(s('path', { class: 'sim-bt-mark', d: `M${p.x - 8} ${p.y + CELL_H / 2 - 4.5} l6 4.5 l-6 4.5 z` }))
      const leaf = !n.kids.length
      const part = `node:${p.level}:${i}`
      const word = over ? 'over' : under ? 'under' : `${n.keys.length}/${max}`
      const ox = leaf ? p.x + p.w / 2 : p.x + p.w + 5
      const oy = leaf ? p.y + CELL_H + 10 : p.y + CELL_H / 2 + 0.5
      const occ = s(
        'g',
        { class: 'sim-bt-occ', tabindex: 0, role: 'button', 'data-part': part, 'aria-label': `${isRoot ? 'The root' : `Node ${i} on level ${p.level}`}: ${n.keys.length} of at most ${max} keys${over ? ', overflowing' : under ? ', underflowing' : ''}` },
        s('rect', { class: 'sim-bt-occhit', x: leaf ? ox - 13 : ox - 2, y: oy - 7, width: 26, height: 14, rx: 4 }),
        s('text', { x: ox, y: oy, 'text-anchor': leaf ? 'middle' : 'start', 'dominant-baseline': 'central' }, word)
      )
      g.append(occ)
      if (want && ((want.type === 'root' && isRoot) || (want.type === 'node' && want.level === p.level && want.index === i)))
        g.append(s('rect', { class: 'sim-bt-ring', x: p.x - 3.5, y: p.y - 3.5, width: p.w + 7, height: CELL_H + 7, rx: 9 }))
      nodes.append(g)
      p.kids.forEach((kid, c) => {
        const from = Math.min(p.x + p.w - 3, Math.max(p.x + 3, p.edges[Math.min(c, p.edges.length - 1)]))
        const on = (onPath.has(n.id) && onPath.has(kid.node.id)) || (focus && step?.child === c)
        edges.append(s('line', { class: `sim-bt-edge${on ? ' on' : ''}`, x1: from, y1: p.y + CELL_H, x2: kid.x + kid.w / 2, y2: kid.y }))
        walk(kid)
      })
    }
    walk(placed)
    const st = stats(root, sim.order)
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('aria-label', `B-tree of order ${sim.order}: ${st.keys} keys in ${st.nodes} nodes on ${st.height} levels`)
    // Drawn a little larger when there is room, a little smaller to fit; a tree too wide for that keeps its size and scrolls
    const room = treeBox.clientWidth
    const fit = room ? room / width : 1
    const scale = fit < MIN_SCALE ? 1 : Math.min(fit, MAX_SCALE)
    svg.style.width = `${Math.round(width * scale)}px`
    svg.style.height = `${Math.round(height * scale)}px`
    svg.replaceChildren(edges, nodes)
    svg.querySelectorAll<SVGGElement>('[data-part]').forEach((g) => {
      const part = g.getAttribute('data-part') as string
      g.addEventListener('click', () => host.select(part))
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          host.select(part)
          e.preventDefault()
        }
      })
    })
    // Rebuilding drops keyboard focus: give it back to the same part, or to the figure so S and Space still work
    if (held) (svg.querySelector<SVGGElement>(`[data-part="${held}"]`) ?? host.root).focus({ preventScroll: true })
    // Keep the node being worked on in view when the tree is wider than its box
    scrollHint.hidden = fit >= MIN_SCALE
    const mark = svg.querySelector('.sim-bt-node.now .sim-bt-box') ?? svg.querySelector('.sim-bt-box')
    if (mark && treeBox.scrollWidth > treeBox.clientWidth + 1) {
      const x = Number(mark.getAttribute('x')) * scale
      const w = Number(mark.getAttribute('width')) * scale
      if (x < treeBox.scrollLeft + 12 || x + w > treeBox.scrollLeft + treeBox.clientWidth - 12) treeBox.scrollLeft = Math.max(0, x + w / 2 - treeBox.clientWidth / 2)
    }
  }

  function nodeName(root: BNode, id: number): string {
    const at = whereIs(root, id)
    if (!at) return ''
    return `${at.level === 1 ? 'root' : `level ${at.level}, node ${at.index}`} (${at.node.keys.length ? at.node.keys.map(showKey).join(' ') : 'empty'})`
  }

  function drawText(): void {
    const step = sim.current
    const root = sim.shown
    const next = sim.queue[0]
    if (step && sim.op) {
      chip.className = `sim-chip sim-bt-rule ${CHIP[step.kind] ?? 'accent'}`
      chip.textContent = step.rule
      opLabel.textContent = `${opText(sim.op)} · step ${sim.at + 1} of ${sim.steps.length}${sim.midway ? '' : ' · finished'}`
      sentence.textContent = step.text
      pathRow.replaceChildren(h('span', { class: 'sim-label' }, 'Path'), ...step.path.flatMap((id, i) => [...(i ? [h('span', { class: 'sim-bt-arrow', 'aria-hidden': 'true' }, '→')] : []), h('span', { class: `sim-bt-hop${i === step.path.length - 1 ? ' last' : ''}` }, nodeName(root, id))]))
    } else {
      chip.className = 'sim-chip sim-bt-rule'
      chip.textContent = 'Ready'
      opLabel.textContent = 'No operation in progress'
      sentence.textContent = next
        ? `Press Step or Play to start the next queued operation (${opText(next).toLowerCase()}), or type a key of your own and choose Insert, Search or Delete.`
        : 'Type a key and choose Insert, Search or Delete. Each press of Step then shows one small step of that operation and the rule behind it.'
      pathRow.replaceChildren(h('span', { class: 'sim-label' }, 'Path'), h('span', { class: 'sim-bt-hop' }, 'none yet'))
    }
    const st = stats(root, sim.order)
    statKeys.set(String(st.keys))
    statNodes.set(String(st.nodes))
    statHeight.set(`${st.height} level${st.height === 1 ? '' : 's'}`)
    statFill.set(`${Math.round(st.fill * 100)}% (${st.keys}/${st.places})`)
    trail.replaceChildren(
      ...(sim.at >= 0 ? sim.steps.slice(0, sim.at + 1).map((x, i) => h('li', { class: i === sim.at ? 'on' : '' }, h('span', { class: 'sim-bt-n' }, String(i + 1)), x.rule)) : [h('li', { class: 'none' }, 'None yet')])
    )
    const shownQueue = sim.queue.slice(0, 5)
    queueRow.replaceChildren(
      ...(shownQueue.length ? shownQueue.map((op) => h('span', { class: 'sim-chip' }, opText(op).toLowerCase())) : [h('span', { class: 'sim-bt-none' }, 'Nothing queued')]),
      ...(sim.queue.length > shownQueue.length ? [h('span', { class: 'sim-bt-none' }, `and ${sim.queue.length - shownQueue.length} more`)] : [])
    )
    say.textContent = message
    say.classList.toggle('bad', messageBad)
    const m = sim.order
    note.textContent = `Order m = ${m} here means at most ${m} children in a node, so at most ${m - 1} keys, and at least ⌈${m}/2⌉ − 1 = ${minKeys(m)} in every node but the root. A node splits after it overflows (the lower middle key goes up); an underflow tries the left sibling, then the right, then merges. Other textbooks define order differently or split on the way down, and real B-trees use orders in the hundreds.`
    ring(pathRow, marked === 'path')
    ring(now, marked === 'step')
    ring(statHeight.el, marked === 'height')
    ring(statFill.el, marked === 'fill' || marked === 'occupancy')
    ring(orderField.input, marked === 'order')
  }

  function begin(ops: BOp[]): void {
    if (!ops.length) return
    sim.queue.unshift(...ops.slice(1))
    sim.begin(ops[0])
    message = ''
    messageBad = false
    stale = true
  }

  return {
    el,
    step() {
      if (sim.step()) {
        message = ''
        messageBad = false
        stale = true
      }
    },
    reset() {
      sim.reset()
      orderField.set(String(sim.order))
      input.value = ''
      input.classList.remove('bad')
      message = ''
      messageBad = false
      stale = true
    },
    draw() {
      if (!stale) return
      stale = false
      drawTree()
      drawText()
    },
    relayout() {
      stale = true
    },
    stepsPerSecond: () => 1,
    done: () => (sim.idle ? (sim.op ? `${opText(sim.op)} is finished and nothing is queued` : 'Nothing queued: type a key above') : null),
    describe(part) {
      const parsed = parseBTreePart(part, sim.shown)
      return parsed ? describeBTreePart(parsed, context()) : null
    },
    highlight(part) {
      marked = part
      stale = true
    },
    act(action: TourAction) {
      const ops: BOp[] = []
      for (const [verb, value] of Object.entries(action)) {
        if (verb !== 'insert' && verb !== 'delete' && verb !== 'search') continue
        const items = Array.isArray(value) ? value.flat() : [value]
        for (const item of items) {
          const key = parseKey(item)
          if (key !== null) ops.push({ type: verb, key })
        }
      }
      begin(ops)
    }
  }
}

export const bTreeKind: SimKindDef<BTreeSpec> = {
  label: 'B-tree',
  transport: true,
  autoplay: () => false,
  create
}
