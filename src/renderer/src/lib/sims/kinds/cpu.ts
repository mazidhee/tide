/**
 * A tiny register machine, one phase at a time: fetch reads two bytes of memory into IR, decode
 * says what the bits mean, execute changes a register, a memory cell, the flags or PC. The
 * program is text the learner can edit and assemble again; everything shown is the machine's
 * own state (see ../cpu for the instruction set and its encoding).
 */
import { button, h, ring } from '../dom'
import {
  FLAG_NAMES,
  MEMORY_SIZE,
  OPS,
  PHASES,
  REGISTERS,
  assemble,
  bin,
  describeCpuPart,
  hex,
  labelAt,
  loadMachine,
  parseCpuPart,
  placeValues,
  signedText,
  type Assembly,
  type CpuPart,
  type CpuSpec,
  type FlagName,
  type Machine
} from '../cpu'
import type { SimHost, SimKindDef, SimView } from '../shell'

const FLAGS: readonly FlagName[] = ['z', 'n', 'c', 'v']
const READY = 'Ready. Each step is one phase: fetch reads the two bytes at PC into IR, decode works out what they mean, execute carries it out.'

/** The canonical name of a part, as the machine's trace writes it */
function partKey(p: CpuPart): string {
  switch (p.type) {
    case 'register':
      return `register:${p.i}`
    case 'flag':
      return `flag:${p.f}`
    case 'cell':
      return `memory:${p.a}`
    case 'line':
      return `line:${p.n}`
    default:
      return p.type
  }
}

function create(spec: CpuSpec, host: SimHost): SimView {
  let source = spec.program
  let asm: Assembly = assemble(source)
  let machine: Machine = loadMachine(asm, spec.memory, spec.limit)
  let editing = !asm.ok
  /** Errors from the learner's last attempt to assemble (the program shown is then not the one loaded) */
  let draftErrors = asm.errors
  let inspected = 'register:0'
  let marked: string | null = null

  const blocked = () => !asm.ok || draftErrors.length > 0

  const choose = (part: string) => {
    const p = parseCpuPart(part, asm)
    if (p && (p.type === 'register' || p.type === 'cell' || p.type === 'pc')) inspected = partKey(p)
    host.select(part)
    host.invalidate()
  }
  const partButton = (part: () => string, cls: string, label: string) => {
    const b = h('button', { type: 'button', class: `sim-part ${cls}`, 'aria-label': label })
    b.addEventListener('click', () => choose(part()))
    return b
  }

  // ---------- The program: listing, or the editor ----------
  const listing = h('div', { class: 'sim-cpu-listing sim-mono' })
  let rows = new Map<number, { el: HTMLElement; mark: HTMLElement; bytes: HTMLElement; address: number; size: number; code: boolean }>()
  const area = h('textarea', { class: 'sim-input sim-mono sim-cpu-src', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Program', wrap: 'off' })
  const errorList = h('ul', { class: 'sim-cpu-errors', role: 'alert' })
  const assembleBtn = button('Assemble', () => load(area.value), 'primary')
  const cancelBtn = button('Cancel', () => {
    editing = false
    draftErrors = []
    host.invalidate()
  }, 'quiet')
  const restoreBtn = button('Restore the original', () => {
    area.value = spec.program
    load(spec.program)
  }, 'quiet')
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      load(area.value)
      e.preventDefault()
    }
  })
  const editor = h('div', { class: 'sim-cpu-editor' }, area, errorList, h('div', { class: 'sim-inline' }, assembleBtn, cancelBtn, restoreBtn))
  const editBtn = button('Edit program', () => {
    editing = true
    area.value = source
    host.invalidate()
    area.focus()
  }, 'quiet')
  const programHint = h('span', { class: 'sim-cpu-hint' })
  const programPanel = h('div', { class: 'sim-panel sim-cpu-program' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Program'), programHint), listing, editor)

  function buildListing(): void {
    rows = new Map()
    const labelWidth = Math.min(8, Math.max(0, ...asm.lines.map((l) => (l.label ? l.label.length + 1 : 0))))
    const codeWidth = Math.min(18, Math.max(4, ...asm.lines.map((l) => l.code.length)))
    listing.style.setProperty('--label', `${labelWidth}ch`)
    listing.style.setProperty('--code', `${codeWidth}ch`)
    listing.replaceChildren(
      h('div', { class: 'sim-cpu-line head', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'sim-cpu-addr' }, 'at'), h('span', null, 'bytes'), h('span', { class: 'sim-cpu-wide' }, 'instruction'))
    )
    for (const line of asm.lines) {
      if (!line.label && !line.code && !line.comment) continue
      const mark = h('span', { class: 'sim-cpu-mark', 'aria-hidden': 'true' })
      const bytes = h('span', { class: 'sim-cpu-bytes' })
      const cells = [
        mark,
        h('span', { class: 'sim-cpu-addr' }, line.address === null ? '' : String(line.address)),
        bytes,
        h('span', { class: 'sim-cpu-lab' }, line.label ? `${line.label}:` : ''),
        h('span', { class: 'sim-cpu-code' }, line.code),
        h('span', { class: 'sim-cpu-comment' }, line.comment)
      ]
      if (line.address === null || !line.bytes.length) {
        listing.append(h('div', { class: 'sim-cpu-line quiet' }, ...cells))
        continue
      }
      const el = h('button', { type: 'button', class: 'sim-part sim-cpu-line', title: line.source.trim() }, ...cells)
      el.addEventListener('click', () => choose(`line:${line.line}`))
      rows.set(line.line, { el, mark, bytes, address: line.address, size: line.bytes.length, code: line.kind === 'code' })
      listing.append(el)
    }
  }

  /** Assembles the text; loads it only if it assembles */
  function load(text: string): void {
    const next = assemble(text)
    if (!next.ok) {
      draftErrors = next.errors
      editing = true
      host.invalidate()
      return
    }
    source = next.lines.map((l) => l.source).join('\n')
    asm = next
    draftErrors = []
    editing = false
    machine = loadMachine(asm, spec.memory, spec.limit)
    if (!parseCpuPart(inspected, asm)) inspected = 'register:0'
    buildListing()
    host.select(null)
    host.invalidate()
  }

  // ---------- The cycle and what just happened ----------
  const phaseEls = PHASES.map((p, i) => h('span', { class: 'sim-cpu-phase' }, h('i', null, String(i + 1)), p.charAt(0).toUpperCase() + p.slice(1)))
  const phaseBox = partButton(() => 'phase', 'sim-cpu-phases', 'The phase of the cycle')
  phaseEls.forEach((el, i) => {
    if (i) phaseBox.append(h('span', { class: 'sim-cpu-arrow', 'aria-hidden': 'true' }, '→'))
    phaseBox.append(el)
  })
  const count = h('span', { class: 'sim-cpu-count' })
  const state = h('span', { class: 'sim-chip' })
  const say = h('p', { class: 'sim-cpu-say', 'aria-live': 'polite' })
  const now = h('div', { class: 'sim-cpu-now' }, h('div', { class: 'sim-cpu-cycle' }, phaseBox, h('span', { class: 'sim-cpu-status' }, count, state)), say)

  // ---------- The processor ----------
  const valueRow = (name: string, part: string, title: string) => {
    const b = h('span', { class: 'sim-cpu-bin' })
    const x = h('span', { class: 'sim-cpu-hex' })
    const d = h('span', { class: 'sim-cpu-dec' })
    const el = partButton(() => part, 'sim-cpu-row', title)
    el.append(h('span', { class: 'sim-cpu-name' }, name), b, x, d)
    return { el, b, x, d }
  }
  const pcRow = valueRow('PC', 'pc', 'Program counter')
  const irBits = h('span', { class: 'sim-cpu-bin' })
  const irHex = h('span', { class: 'sim-cpu-hex' })
  const irMeans = h('span', { class: 'sim-cpu-means' })
  const irRow = partButton(() => 'ir', 'sim-cpu-row ir', 'Instruction register')
  irRow.append(h('span', { class: 'sim-cpu-name' }, 'IR'), irBits, irHex, h('span'), irMeans)
  const regRows = Array.from({ length: REGISTERS }, (_, i) => valueRow(`R${i}`, `register:${i}`, `Register R${i}`))
  const flagEls = FLAGS.map((f) => {
    const value = h('b')
    const el = partButton(() => `flag:${f}`, 'sim-cpu-flag', `The ${FLAG_NAMES[f]} flag`)
    el.append(h('span', { class: 'sim-cpu-flag-top' }, h('span', { class: 'sim-cpu-flag-letter' }, f.toUpperCase()), value), h('span', { class: 'sim-cpu-flag-name' }, FLAG_NAMES[f]))
    return { el, value }
  })
  const flagBox = h('div', { class: 'sim-cpu-flags' }, ...flagEls.map((f) => f.el))
  const cpuPanel = h(
    'div',
    { class: 'sim-panel sim-cpu-proc sim-mono' },
    h('div', { class: 'sim-panel-title' }, h('span', null, 'Processor')),
    h('div', { class: 'sim-cpu-row head', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'sim-cpu-bin' }, 'binary'), h('span', { class: 'sim-cpu-hex' }, 'hex'), h('span', { class: 'sim-cpu-dec' }, 'signed')),
    pcRow.el,
    irRow,
    h('div', { class: 'sim-cpu-rule' }),
    ...regRows.map((r) => r.el),
    h('div', { class: 'sim-cpu-rule' }),
    flagBox
  )

  // ---------- The selected value in full ----------
  const WEIGHTS = ['−128', '64', '32', '16', '8', '4', '2', '1']
  const bitEls = WEIGHTS.map((w) => {
    const bit = h('span', { class: 'sim-cell' })
    return { bit, el: h('span', { class: 'sim-cpu-bit' }, bit, h('i', null, w)) }
  })
  const inspectName = h('span')
  const inspectRole = h('span', { class: 'sim-cpu-hint' })
  const facts = ['Hex', 'Signed', 'Unsigned'].map((label) => {
    const v = h('b')
    return { v, el: h('span', { class: 'sim-cpu-fact' }, h('i', null, label), v) }
  })
  const sumLine = h('p', { class: 'sim-cpu-sum sim-mono' })
  const inspector = h(
    'div',
    { class: 'sim-panel sim-cpu-inspect' },
    h('div', { class: 'sim-panel-title' }, inspectName, inspectRole),
    h('div', { class: 'sim-cpu-bits sim-mono' }, ...bitEls.map((b) => b.el)),
    h('div', { class: 'sim-cpu-facts sim-mono' }, ...facts.map((f) => f.el)),
    sumLine
  )

  // ---------- Memory ----------
  const cells = Array.from({ length: MEMORY_SIZE }, (_, a) => {
    const value = h('span', { class: 'sim-cpu-cellv' })
    const tag = h('i', { class: 'sim-cpu-celltag' })
    const el = partButton(() => `memory:${a}`, 'sim-cpu-cell', `Memory cell ${a}`)
    el.append(h('span', { class: 'sim-cpu-cella' }, String(a), tag), value)
    return { el, value, tag }
  })
  const key = (cls: string, text: string) => h('span', { class: 'sim-cpu-key' }, h('i', { class: `sim-cpu-swatch ${cls}` }), text)
  const memoryPanel = h(
    'div',
    { class: 'sim-panel sim-cpu-memory' },
    h('div', { class: 'sim-panel-title' }, h('span', null, 'Memory'), h('span', { class: 'sim-cpu-hint' }, `${MEMORY_SIZE} cells, address above each byte (hex)`)),
    h('div', { class: 'sim-cpu-grid sim-mono' }, ...cells.map((c) => c.el)),
    h('div', { class: 'sim-cpu-legend' }, key('code', 'Code'), key('data', 'Data'), key('unused', 'Unused'), h('span', { class: 'sim-cpu-key' }, h('i', { class: 'sim-cpu-celltag' }, 'PC'), 'next fetch'))
  )

  // ---------- The instruction set ----------
  const reference = h(
    'div',
    { class: 'sim-panel sim-cpu-refbox' },
    h('div', { class: 'sim-panel-title' }, h('span', null, 'Instruction set'), h('span', { class: 'sim-cpu-hint' }, 'two bytes each: opcode and register, then operand')),
    h(
      'div',
      { class: 'sim-cpu-ref' },
      ...OPS.map((op) => h('div', { class: 'sim-cpu-op' }, h('span', { class: 'sim-mono sim-cpu-syntax' }, op.syntax), h('span', { class: 'sim-mono sim-cpu-enc' }, op.encoding), h('span', null, op.effect)))
    )
  )

  const note = h(
    'p',
    { class: 'sim-note' },
    'A teaching machine, not a real processor. Words are 8 bits in two’s complement (−128 to 127) and arithmetic wraps; r and s are R0 to R3, a is an address (0 to 31) or a label, n is a value. Only ADD and SUB set the flags; after SUB, C means a borrow. DATA n puts a value in memory; comments start with ; or //.'
  )

  const params = h('div', { class: 'sim-params' }, editBtn)
  const el = h(
    'div',
    { class: 'sim-cpu' },
    params,
    now,
    h('div', { class: 'sim-two sim-cpu-main' }, programPanel, cpuPanel),
    memoryPanel,
    h('div', { class: 'sim-two sim-cpu-foot' }, inspector, reference),
    note
  )

  buildListing()
  area.value = source

  function elementOf(part: string | null): Element | null {
    const p = part ? parseCpuPart(part, asm) : null
    if (!p) return null
    switch (p.type) {
      case 'pc':
        return pcRow.el
      case 'ir':
        return irRow
      case 'phase':
        return phaseBox
      case 'program':
        return programPanel
      case 'memory':
        return memoryPanel
      case 'flags':
        return flagBox
      case 'register':
        return regRows[p.i].el
      case 'flag':
        return flagEls[FLAGS.indexOf(p.f)].el
      case 'cell':
        return cells[p.a].el
      case 'line':
        return rows.get(p.n)?.el ?? null
    }
  }
  let ringed: Element | null = null
  function mark(part: string | null): void {
    marked = part
    ring(ringed, false)
    ringed = elementOf(part)
    ring(ringed, true)
  }

  function draw(): void {
    const m = machine
    const stopped = m.stopped
    const changed = new Set(blocked() ? [] : (m.last?.changed ?? []))
    const read = new Set(blocked() ? [] : (m.last?.read ?? []))

    // Program
    listing.hidden = editing
    editor.hidden = !editing
    params.hidden = editing
    cancelBtn.hidden = !asm.ok
    restoreBtn.hidden = area.value === spec.program && source === spec.program
    area.rows = Math.min(16, Math.max(6, area.value.split('\n').length + 1))
    area.classList.toggle('bad', draftErrors.length > 0)
    errorList.replaceChildren(...draftErrors.map((e) => h('li', null, h('b', null, `Line ${e.line}:`), ` ${e.message}`)))
    errorList.hidden = !draftErrors.length
    programHint.textContent = editing ? (draftErrors.length ? 'Not assembled: nothing runs until it is' : 'One instruction per line; ⌘↵ assembles') : `${asm.size} of ${MEMORY_SIZE} cells`
    // The instruction in hand: the one in IR while it is decoded and executed, otherwise the one PC points at
    const current = m.phase === 'fetch' ? m.pc : m.irAt
    for (const row of rows.values()) {
      const on = row.code && row.address === current && !stopped && !blocked()
      row.el.classList.toggle('on', on)
      const live = Array.from({ length: row.size }, (_, k) => hex(m.mem[row.address + k])).join(' ')
      if (row.bytes.textContent !== live) row.bytes.textContent = live
      let wrote = false
      for (let k = 0; k < row.size; k++) if (changed.has(`memory:${row.address + k}`)) wrote = true
      row.el.classList.toggle('changed', wrote)
    }

    // The cycle
    const last = blocked() ? null : m.last
    PHASES.forEach((p, i) => {
      phaseEls[i].classList.toggle('on', last?.phase === p)
      phaseEls[i].classList.toggle('next', !stopped && !blocked() && m.phase === p)
    })
    count.textContent = blocked() ? '' : `${m.instructions} instruction${m.instructions === 1 ? '' : 's'} run`
    state.className = `sim-chip${blocked() ? ' bad' : m.halted ? ' accent' : stopped ? ' bad' : ''}`
    state.textContent = blocked() ? 'not assembled' : m.halted ? 'halted' : stopped ? 'stopped' : `next: ${m.phase}`
    const text = blocked() ? 'The program has not assembled, so there is nothing to run. Fix the lines listed and assemble again.' : last ? last.text : READY
    const cut = last ? text.indexOf(':') : -1
    const tail = stopped && !m.halted && last && !m.fault ? ` ${stopped}.` : ''
    say.replaceChildren(...(cut > 0 ? [h('b', null, text.slice(0, cut))] : []), (cut > 0 ? text.slice(cut) : text) + tail)

    // Processor
    const setRow = (r: { el: HTMLElement; b: HTMLElement; x: HTMLElement; d: HTMLElement }, v: number, name: string, signed = true) => {
      r.b.textContent = bin(v)
      r.x.textContent = hex(v)
      r.d.textContent = signed ? signedText(v) : String(v)
      r.el.classList.toggle('changed', changed.has(name))
      r.el.classList.toggle('sel', inspected === name)
    }
    setRow(pcRow, m.pc, 'pc', false)
    regRows.forEach((r, i) => setRow(r, m.reg[i], `register:${i}`))
    irBits.textContent = `${bin(m.ir[0])}  ${bin(m.ir[1])}`
    irHex.textContent = `${hex(m.ir[0])} ${hex(m.ir[1])}`
    irMeans.textContent = m.irAt === null ? 'empty until the first fetch' : m.decoded ? (m.decoded.fault ? 'not an instruction' : `= ${m.decoded.text.replace('-', '−')}`) : 'fetched, not decoded yet'
    irRow.classList.toggle('changed', changed.has('ir'))
    FLAGS.forEach((f, i) => {
      flagEls[i].value.textContent = String(m.flags[f])
      flagEls[i].el.classList.toggle('set', m.flags[f] === 1)
      flagEls[i].el.classList.toggle('changed', changed.has(`flag:${f}`))
    })

    // Memory
    cells.forEach((c, a) => {
      c.value.textContent = hex(m.mem[a])
      c.el.className = `sim-part sim-cpu-cell ${m.kinds[a]}${changed.has(`memory:${a}`) ? ' changed' : ''}${read.has(a) ? ' read' : ''}${inspected === `memory:${a}` ? ' sel' : ''}`
      c.tag.textContent = a === m.pc && !stopped && !blocked() ? 'PC' : ''
      if (ringed === c.el) ring(c.el, true)
    })

    // The selected value
    const p = parseCpuPart(inspected, asm)
    const value = p?.type === 'cell' ? m.mem[p.a] : p?.type === 'pc' ? m.pc : m.reg[p?.type === 'register' ? p.i : 0]
    const label = p?.type === 'cell' ? labelAt(asm, p.a) : null
    inspectName.textContent = p?.type === 'cell' ? `Memory cell ${p.a}${label ? ` (${label})` : ''} in full` : p?.type === 'pc' ? 'PC in full' : `R${p?.type === 'register' ? p.i : 0} in full`
    inspectRole.textContent = 'select a register or a cell'
    bitEls.forEach((b, i) => {
      const one = (value >> (7 - i)) & 1
      b.bit.textContent = String(one)
      b.bit.className = `sim-cell${one ? ' on' : ' empty'}`
    })
    facts[0].v.textContent = `0x${hex(value)}`
    facts[1].v.textContent = signedText(value)
    facts[2].v.textContent = String(value)
    sumLine.textContent = `${bin(value)} = ${placeValues(value)}`
  }

  return {
    el,
    stepsPerSecond: () => 3,
    step() {
      if (!blocked()) machine.step()
    },
    done() {
      if (blocked()) return `Not assembled: fix line ${(draftErrors[0] ?? asm.errors[0])?.line ?? 1} and assemble again`
      return machine.stopped
    },
    reset() {
      // The program as last assembled starts again: registers cleared, memory as loaded
      if (asm.ok) {
        machine = loadMachine(asm, spec.memory, spec.limit)
        draftErrors = []
        editing = false
      }
    },
    draw,
    relayout() {
      mark(marked)
    },
    describe(part) {
      const p = parseCpuPart(part, asm)
      return p && asm.ok ? describeCpuPart(p, machine, asm) : null
    },
    highlight: mark
  }
}

export const cpuKind: SimKindDef<CpuSpec> = {
  label: 'Register machine',
  transport: true,
  autoplay: () => false,
  create
}
