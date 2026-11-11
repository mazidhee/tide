/**
 * A hash table worked one probe at a time: chaining, linear probing, quadratic probing and
 * double hashing, with the hash arithmetic written out, tombstones, and the rebuild into a
 * bigger table when the load factor passes its limit. Every bucket drawn is the model's own
 * snapshot of that step; the sentence beside it says what the probe found and what follows.
 */
import { button, h, rangeField, ring, selectField, stat } from '../dom'
import {
  HASH_LIMITS,
  HashSim,
  LIMIT_RANGE,
  describeHashTablePart,
  fitCapacity,
  parseHKey,
  parseHashTablePart,
  parseStrategy,
  probeAt,
  probeText,
  showHKey,
  strategyName,
  tableStats,
  type HKey,
  type HOp,
  type HOpType,
  type HSnap,
  type HStep,
  type HashTableSpec,
  type Saw,
  type Strategy
} from '../hashTable'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../spec'

const OP_WORD: Record<HOpType, string> = { insert: 'Insert', delete: 'Delete', search: 'Search for' }
const opText = (op: HOp) => `${OP_WORD[op.type]} ${showHKey(op.key)}`
const cellText = (key: HKey) => (typeof key === 'number' ? showHKey(key) : key)
const SAW_WORD: Record<Saw, string> = { empty: 'empty', other: 'collision', self: 'found', tomb: 'tombstone' }
const CHIP: Record<HStep['kind'], string> = { empty: 'pos', collision: 'neg', found: 'pos', tombstone: 'neg', exhausted: 'bad', grow: 'accent', grown: 'accent', full: 'bad' }
const TOMB = '✕'

const STRATEGY_OPTIONS = [
  ['chaining', 'Chaining'],
  ['linear', 'Linear probing'],
  ['quadratic', 'Quadratic probing'],
  ['double', 'Double hashing']
] as const

function create(spec: HashTableSpec, host: SimHost): SimView {
  const sim = new HashSim(spec)
  let marked: string | null = null
  let stale = true
  let message = ''
  let messageBad = false

  const touch = () => {
    stale = true
    host.invalidate()
  }
  const selectable = <E extends HTMLElement>(el: E, part: string): E => {
    el.addEventListener('click', () => host.select(part))
    if (el.tagName !== 'BUTTON')
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          host.select(part)
          e.preventDefault()
        }
      })
    return el
  }
  const asButton = <E extends HTMLElement>(el: E, part: string, label?: string): E => {
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    if (label) el.setAttribute('aria-label', label)
    return selectable(el, part)
  }

  // ---------- Controls ----------
  const input = h('input', { class: 'sim-input sim-mono sim-ht-input', type: 'text', placeholder: '42 or cat', maxlength: 8, 'aria-label': 'Key: a whole number or a short word', autocomplete: 'off', spellcheck: 'false' })
  const say = h('p', { class: 'sim-ht-msg', 'aria-live': 'polite' })

  function submit(type: HOpType): void {
    const typed = input.value.trim()
    const key = parseHKey(typed)
    input.classList.toggle('bad', key === null)
    if (key === null) {
      messageBad = true
      message = !typed
        ? 'Type a key first: a whole number such as 42, or a short word such as cat.'
        : /^[-+−]?\d+$/.test(typed)
          ? `Whole numbers from −${-HASH_LIMITS.number[0]} to ${HASH_LIMITS.number[1]} only.`
          : /^[-+−]?[\d.]/.test(typed)
            ? `"${typed}" is not a whole number. Keys are whole numbers or short words.`
            : `Words can have up to ${HASH_LIMITS.word} characters, with no spaces or punctuation.`
      touch()
      return
    }
    const present = sim.table.has(key)
    messageBad = false
    message =
      type === 'insert' && present
        ? `${showHKey(key)} is already in the table. Step through to see the probes find it.`
        : type !== 'insert' && !present
          ? `${showHKey(key)} is not in the table. Step through to see where the search stops.`
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

  const limitField = rangeField('Load limit', { min: LIMIT_RANGE[sim.strategy][0], max: LIMIT_RANGE[sim.strategy][1], step: 0.05, value: sim.limit, format: (v) => v.toFixed(2) }, (v) => {
    sim.setLimit(v)
    messageBad = false
    message = `The limit is checked after each insert: the next one that leaves the table over ${sim.limit.toFixed(2)} rebuilds it.`
    touch()
  })
  limitField.el.classList.add('sim-ht-limit')
  limitField.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && host.select('load'))
  function fitLimitField(): void {
    const range = limitField.input as HTMLInputElement
    range.min = String(LIMIT_RANGE[sim.strategy][0])
    range.max = String(LIMIT_RANGE[sim.strategy][1])
    limitField.set(sim.limit)
  }

  function chooseStrategy(strategy: Strategy): void {
    sim.setStrategy(strategy)
    strategyField.set(strategy)
    fitLimitField()
    const n = sim.table.size
    messageBad = false
    message = `Rebuilt with ${strategyName(strategy)}: the same ${n} ${n === 1 ? 'key' : 'keys'} inserted in the same sequence, starting from ${fitCapacity(strategy, spec.capacity)} buckets.`
    stale = true
  }
  const strategyField = selectField('Collisions resolved by', STRATEGY_OPTIONS, sim.strategy, (v) => {
    chooseStrategy(v)
    host.invalidate()
  })
  strategyField.el.querySelector('.sim-label')?.addEventListener('click', () => host.select('strategy'))

  // ---------- The picture ----------
  const tables = h('div', { class: 'sim-ht-tables' })
  const legend = h(
    'div',
    { class: 'sim-ht-legend' },
    h('span', { class: 'sim-ht-leg' }, h('i', { class: 'sim-cell on sim-ht-sw' }), 'being looked at'),
    h('span', { class: 'sim-ht-leg' }, h('i', { class: 'sim-cell neg sim-ht-sw' }), 'looked at, not free'),
    h('span', { class: 'sim-ht-leg' }, h('i', { class: 'sim-cell pos sim-ht-sw' }), 'where the key is'),
    h('span', { class: 'sim-ht-leg sim-ht-leg-tomb' }, h('i', { class: 'sim-cell sim-ht-tomb sim-ht-sw' }, TOMB), 'tombstone')
  )

  // ---------- What just happened ----------
  const chip = asButton(h('span', { class: 'sim-chip sim-ht-rule' }), 'probe')
  const opLabel = h('span', { class: 'sim-ht-op' })
  const sentence = h('p', { class: 'sim-ht-text', 'aria-live': 'polite' })
  const probeRow = asButton(h('div', { class: 'sim-ht-probes sim-part' }), 'probe', 'Probe sequence of the current operation')
  const now = h('div', { class: 'sim-panel sim-ht-now' }, h('div', { class: 'sim-ht-nowhead' }, chip, opLabel), sentence, probeRow)

  const workLines = h('div', { class: 'sim-ht-work sim-mono' })
  const workBox = asButton(h('div', { class: 'sim-panel sim-ht-hash sim-part' }, h('div', { class: 'sim-panel-title' }, 'Hash arithmetic'), workLines), 'hash', 'Hash arithmetic for the current key')

  const statKeys = stat('Keys')
  const statSize = stat('Buckets')
  const statLoad = stat('Load / limit')
  const statHits = stat('Collisions')
  const statLong = stat('Longest probe')
  const statMean = stat('Probes per insert')
  const statTombs = stat('Tombstones')
  const loadFill = h('i', { class: 'sim-ht-loadfill' })
  const loadTomb = h('i', { class: 'sim-ht-loadtomb' })
  const loadTick = h('i', { class: 'sim-ht-loadtick' })
  statLoad.el.append(h('span', { class: 'sim-ht-loadbar', 'aria-hidden': 'true' }, loadFill, loadTomb, loadTick))
  for (const [st, part] of [[statLoad, 'load'], [statHits, 'collisions'], [statMean, 'collisions']] as const) {
    st.el.classList.add('sim-part', 'sim-ht-stat')
    asButton(st.el, part)
  }
  const statsRow = h('div', { class: 'sim-stats sim-ht-stats' }, statKeys.el, statSize.el, statLoad.el, statTombs.el, statHits.el, statLong.el, statMean.el)
  const queueRow = h('div', { class: 'sim-ht-queue' })
  const side = h('div', { class: 'sim-stack' }, workBox, h('div', { class: 'sim-ht-block' }, h('span', { class: 'sim-label' }, 'Queued next'), queueRow))
  const note = h('p', { class: 'sim-note' })
  const el = h('div', { class: 'sim-ht' }, h('div', { class: 'sim-params' }, keyField, strategyField.el, limitField.el, say), tables, legend, h('div', { class: 'sim-two sim-ht-under' }, now, side), statsRow, note)

  const context = () => ({ snap: sim.shown, strategy: sim.strategy, limit: sim.limit, counts: sim.counts, op: sim.op, step: sim.current })

  // ---------- Drawing ----------
  /** Columns that fit the width and leave the rows evenly filled */
  function columns(m: number, cellWidth: number): number {
    const width = tables.clientWidth || 620
    const most = Math.max(4, Math.floor((width + 4) / (cellWidth + 4)))
    return Math.ceil(m / Math.ceil(m / most))
  }

  interface Marks {
    /** Bucket → what this operation's probes found there */
    seen: Map<number, Saw>
    seenLinks: Map<number, Saw>
    bucket: number
    link: number
    placed: { bucket: number; link: number } | null
    /** Old table only: how many keys have been taken, and whether one is being moved now */
    moved: number
    moving: boolean
    /** Chaining: mark the bucket itself rather than a link */
    head: boolean
  }

  function drawTable(snap: HSnap, title: string, marks: Marks | null, live: boolean): HTMLElement {
    const chained = sim.strategy === 'chaining'
    const longest = snap.cells.reduce((a, c) => c.keys.reduce<number>((b, k) => Math.max(b, cellText(k).length), a), 2)
    const cellWidth = Math.max(30, Math.ceil(longest * 6.3 + 12))
    const cols = columns(snap.capacity, cellWidth)
    const want = live && marked ? parseHashTablePart(marked, snap) : null
    const grid = h('div', { class: `sim-ht-grid${chained ? ' chained' : ''}`, style: `grid-template-columns: repeat(${cols}, minmax(${cellWidth}px, 58px))` })
    let nth = 0
    snap.cells.forEach((cell, b) => {
      const looking = marks?.bucket === b
      const sawSlot = marks?.seen.get(b)
      // The table being left is only shown, so its cells are not buttons
      const box = (cls: string, label: string, text: string, part: string): HTMLElement => {
        if (!live) return h('span', { class: cls, title: label }, text)
        const c = h('button', { type: 'button', class: cls, 'aria-label': label, 'data-part': part }, text)
        return selectable(c, part)
      }
      const index = box(`sim-ht-index${looking ? ' on' : ''}`, `${chained ? 'Bucket' : 'Slot'} ${b}`, String(b), `bucket:${b}`)
      const col = h('div', { class: 'sim-ht-bucket' }, index)
      const keyCell = (key: HKey, link: number): HTMLElement => {
        const mine = nth++
        const gone = marks !== null && !live && mine < marks.moved
        const lifting = marks !== null && !live && marks.moving && mine === marks.moved
        const here = looking && (!chained || marks?.link === link)
        const saw = chained ? (looking ? marks?.seenLinks.get(link) : undefined) : sawSlot
        const placed = !!marks?.placed && marks.placed.bucket === b && (!chained || marks.placed.link === link)
        const state = lifting ? 'on' : placed || saw === 'self' ? 'pos' : here ? 'on' : saw === 'other' ? 'neg' : ''
        const cls = ['sim-cell', 'sim-ht-key', gone && 'dim', state].filter(Boolean).join(' ')
        const c = box(cls, `Key ${showHKey(key)}${gone ? ', already moved' : ''}`, cellText(key), `key:${key}`)
        if (live) ring(c, want?.type === 'key' && want.key === key)
        return c
      }
      if (chained) {
        const head = h('span', { class: `sim-cell sim-ht-head${cell.keys.length ? '' : ' empty'}${looking && (!cell.keys.length || marks?.head) ? ' on' : ''}`, 'aria-hidden': 'true' }, cell.keys.length ? '•' : '')
        col.append(head)
        cell.keys.forEach((key, j) => col.append(h('i', { class: 'sim-ht-linkline', 'aria-hidden': 'true' }), keyCell(key, j)))
      } else if (cell.keys.length) col.append(keyCell(cell.keys[0], -1))
      else {
        const cls = ['sim-cell', cell.tomb ? 'sim-ht-tomb' : 'empty', looking && 'on', !looking && sawSlot === 'tomb' && 'neg'].filter(Boolean).join(' ')
        col.append(box(cls, cell.tomb ? `Slot ${b}: a tombstone` : `Slot ${b}: empty`, cell.tomb ? TOMB : '', `bucket:${b}`))
      }
      ring(col, want?.type === 'bucket' && want.index === b)
      grid.append(col)
    })
    return h('div', { class: `sim-ht-table${live ? '' : ' old'}` }, h('div', { class: 'sim-ht-tabletitle' }, title), grid)
  }

  function drawTables(): void {
    const step = sim.current
    const snap = sim.shown
    const held = tables.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.part : null
    const seen = new Map<number, Saw>()
    const seenLinks = new Map<number, Saw>()
    // A link just unlinked is gone from the chain, so the links that remain are not marked: the bucket is
    const unlinked = !!step?.removed && sim.strategy === 'chaining'
    if (step && !unlinked) for (const p of step.probes) (p.link >= 0 ? seenLinks.set(p.link, p.saw) : seen.set(p.bucket, p.saw))
    const marks: Marks | null = step
      ? { seen, seenLinks, bucket: step.bucket >= 0 ? step.bucket : (step.placed?.bucket ?? -1), link: unlinked ? -1 : step.link, placed: step.placed, moved: step.moved, moving: step.moving, head: unlinked }
      : null
    const place = sim.strategy === 'chaining' ? 'buckets' : 'slots'
    const blocks: HTMLElement[] = []
    if (step?.old) {
      blocks.push(drawTable(step.old, `Old table, m = ${step.old.capacity}: keys leave in order, faded once moved`, { seen: new Map(), seenLinks: new Map(), bucket: -1, link: -1, placed: null, moved: step.moved, moving: step.moving, head: false }, false))
      blocks.push(drawTable(snap, `New table, m = ${snap.capacity}`, marks, true))
    } else blocks.push(drawTable(snap, `m = ${snap.capacity} ${place}, numbered from 0`, marks, true))
    tables.replaceChildren(...blocks)
    if (held) (tables.querySelector<HTMLElement>(`[data-part="${CSS.escape(held)}"]`) ?? host.root).focus({ preventScroll: true })
  }

  function drawText(): void {
    const step = sim.current
    const snap = sim.shown
    const chained = sim.strategy === 'chaining'
    const next = sim.queue[0]
    const m = snap.capacity
    if (step && sim.op) {
      chip.className = `sim-chip sim-ht-rule ${CHIP[step.kind]}`
      chip.textContent = step.rule
      opLabel.textContent = `${opText(sim.op)} · step ${sim.at + 1} of ${sim.steps.length}${sim.midway ? '' : ' · finished'}`
      sentence.textContent = step.text
      const hops = step.probes.flatMap((p, i) => [
        ...(i ? [h('span', { class: 'sim-ht-arrow', 'aria-hidden': 'true' }, '→')] : []),
        h('span', { class: `sim-ht-hop ${p.saw}${i === step.probes.length - 1 ? ' last' : ''}` }, h('b', { class: 'sim-mono' }, p.link >= 0 ? `link ${p.link + 1}` : String(p.bucket)), ` ${p.saw === 'other' && sim.op?.type !== 'insert' ? 'another key' : SAW_WORD[p.saw]}`)
      ])
      probeRow.replaceChildren(h('span', { class: 'sim-label' }, step.moving ? `Probes for ${showHKey(step.key)}` : 'Probes'), ...(hops.length ? hops : [h('span', { class: 'sim-ht-hop' }, 'none on this step')]))
      const w = step.work
      const i = step.probes.length - 1
      const lines = [w.codeText, w.homeText, w.stepText]
      if (!chained && i >= 1 && step.probes[i].bucket === probeAt(w, sim.strategy, i)) lines.push(`probe ${i + 1}: ${probeText(w, sim.strategy, i)}`)
      workLines.replaceChildren(...lines.filter(Boolean).map((line) => h('div', null, line)))
    } else {
      chip.className = 'sim-chip sim-ht-rule'
      chip.textContent = 'Ready'
      opLabel.textContent = 'No operation in progress'
      sentence.textContent = next
        ? `Press Step or Play to start the next queued operation (${opText(next).toLowerCase()}), or type a key of your own and choose Insert, Search or Delete.`
        : 'Type a key and choose Insert, Search or Delete. Each press of Step then looks at one bucket and says what it found.'
      probeRow.replaceChildren(h('span', { class: 'sim-label' }, 'Probes'), h('span', { class: 'sim-ht-hop' }, 'none yet'))
      const lines = [`h(k) = code(k) mod ${m}`, 'code of a whole number: the number itself', 'code of a word: 1×c₁ + 2×c₂ + … (character codes)']
      if (sim.strategy === 'linear') lines.push(`probe i: (h + i) mod ${m}`)
      if (sim.strategy === 'quadratic') lines.push(`probe i: (h + i(i + 1)/2) mod ${m}`)
      if (sim.strategy === 'double') lines.push(`step = 1 + (code mod ${m - 1})`, `probe i: (h + i×step) mod ${m}`)
      workLines.replaceChildren(...lines.map((line) => h('div', null, line)))
    }
    const st = tableStats(snap, sim.strategy)
    const counts = sim.counts
    statKeys.set(String(st.keys))
    statSize.set(String(m))
    statLoad.set(`${st.load.toFixed(2)} / ${sim.limit.toFixed(2)}`)
    statTombs.set(String(st.tombs))
    statTombs.el.hidden = chained
    statHits.set(String(counts.collisions))
    const longLabel = statLong.el.querySelector('.sim-stat-label')
    if (longLabel) longLabel.textContent = chained ? 'Longest chain' : 'Longest probe'
    statLong.set(st.longest ? String(st.longest) : '–')
    statMean.set(counts.inserts ? (counts.probes / counts.inserts).toFixed(2) : '–')
    const scale = Math.max(1, sim.limit * 1.15)
    loadFill.style.width = `${Math.min(100, (st.load / scale) * 100)}%`
    loadTomb.style.left = `${Math.min(100, (st.load / scale) * 100)}%`
    loadTomb.style.width = `${Math.min(100 - Math.min(100, (st.load / scale) * 100), ((st.filled - st.load) / scale) * 100)}%`
    loadTick.style.left = `${(sim.limit / scale) * 100}%`
    statLoad.el.classList.toggle('over', st.filled > sim.limit)
    legend.querySelector<HTMLElement>('.sim-ht-leg-tomb')!.hidden = chained
    const shownQueue = sim.queue.slice(0, 5)
    queueRow.replaceChildren(
      ...(shownQueue.length ? shownQueue.map((op) => h('span', { class: 'sim-chip' }, opText(op).toLowerCase())) : [h('span', { class: 'sim-ht-none' }, 'Nothing queued')]),
      ...(sim.queue.length > shownQueue.length ? [h('span', { class: 'sim-ht-none' }, `and ${sim.queue.length - shownQueue.length} more`)] : [])
    )
    say.textContent = message
    say.classList.toggle('bad', messageBad)
    const reach =
      sim.strategy === 'chaining'
        ? 'A chain can always take one more key, so the limit only keeps chains short.'
        : sim.strategy === 'linear'
          ? 'Stepping by 1 reaches every slot, so a free one is always found.'
          : sim.strategy === 'quadratic'
            ? 'The table size is kept a power of two: with the offsets 1, 3, 6, 10, … that makes the first m probes reach every slot.'
            : 'The table size is kept prime, so a step of 1 to m − 1 shares no factor with it and reaches every slot; the step is never 0.'
    note.textContent = `${reach} ${chained ? '' : 'Tombstones count towards the limit and are dropped when the table is rebuilt. '}Simplified: keys without values, a toy hash (code mod m) where real tables mix the bits first, and at most ${HASH_LIMITS.keys} keys in ${HASH_LIMITS.maxCapacity} buckets.`
    ring(probeRow, marked === 'probe' || marked === 'probes')
    ring(workBox, marked === 'hash')
    ring(statLoad.el, marked === 'load')
    ring(statHits.el, marked === 'collisions')
    ring(strategyField.input, marked === 'strategy')
  }

  function begin(ops: HOp[]): void {
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
      strategyField.set(sim.strategy)
      fitLimitField()
      input.value = ''
      input.classList.remove('bad')
      message = ''
      messageBad = false
      stale = true
    },
    draw() {
      if (!stale) return
      stale = false
      drawTables()
      drawText()
    },
    relayout() {
      stale = true
    },
    stepsPerSecond: () => 1.25,
    done: () => (sim.idle ? (sim.op ? `${opText(sim.op)} is finished and nothing is queued` : 'Nothing queued: type a key above') : null),
    describe(part) {
      const parsed = parseHashTablePart(part, sim.shown)
      return parsed ? describeHashTablePart(parsed, context()) : null
    },
    highlight(part) {
      marked = part
      stale = true
    },
    act(action: TourAction) {
      if (typeof action.strategy === 'string') chooseStrategy(parseStrategy(action.strategy, sim.strategy))
      if (typeof action.limit === 'number') {
        sim.setLimit(action.limit)
        limitField.set(sim.limit)
        stale = true
      }
      const ops: HOp[] = []
      for (const [verb, value] of Object.entries(action)) {
        if (verb !== 'insert' && verb !== 'delete' && verb !== 'search') continue
        const items = Array.isArray(value) ? value.flat() : [value]
        for (const item of items) {
          const key = parseHKey(item)
          if (key !== null) ops.push({ type: verb, key })
        }
      }
      begin(ops)
    }
  }
}

export const hashTableKind: SimKindDef<HashTableSpec> = {
  label: 'Hash table',
  transport: true,
  autoplay: () => false,
  create
}
