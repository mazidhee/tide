/**
 * The Python lab in tutor text, anywhere it renders (lessons, threads, notes), and on its own
 * page (components/PyLabView). A ```pylab block becomes a program you can step through, forwards
 * and back, a line or one bytecode instruction at a time, with four panes that follow each step:
 * the code, the bytecode of the frame you are looking at (the instruction about to run marked and
 * explained), the call stack with each frame's names, and every object those names reach (id,
 * type, size, an int's digits, a list's spare slots), new and changed objects marked. Any
 * ```python block gets "Step through", which turns it into one.
 *
 * The program runs once, sandboxed, under main/pyTrace.py's "ops" mode; stepping only replays the
 * trace (shared/pyLab), so going back is free and nothing runs twice.
 */
import { changesAt, heapAt, isLabFence, lineCount, opAt, opcodeNote, opsByLine, stepFrom, type StepMode } from '@shared/pyLab'
import type { PyObject, PyStep, PyTrace } from '@shared/pyTrace'
import { createKeeper, watchBlocks } from './liveBlocks'

type Traced = { trace?: PyTrace; error?: string }

export interface PyLabOptions {
  /** Start with the editor open (the lab page) */
  editing?: boolean
  /** How a program is traced; the window's tide.visuals.traceLab unless a test gives another */
  trace?: (code: string) => Promise<Traced>
  /** A line under the bar saying what to watch */
  watch?: string
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  b.addEventListener('click', onClick)
  return b
}

/** The last four hex digits of an id, enough to tell objects apart at a glance */
const shortId = (id: string) => `…${id.slice(-4)}`
const ATOMS = new Set(['int', 'float', 'complex', 'bool', 'str', 'bytes', 'NoneType'])
const isAtom = (o: PyObject | undefined) => !!o && ATOMS.has(o.t)

const bytes = (n: number | undefined) => (n === undefined ? '' : `${n} B`)

/** A reference as it reads in a frame or a container: an atom's value, or the type and short id of anything else */
function chip(ref: string, heap: Map<string, PyObject>, marks: { fresh: Set<string>; changed: Set<string> }): HTMLElement {
  const o = heap.get(ref)
  const c = el('span', 'pylab-ref')
  c.dataset.ref = ref
  c.title = o ? `${o.t} at ${ref}${o.sz !== undefined ? `, ${o.sz} bytes` : ''}` : ref
  if (o && isAtom(o)) {
    c.classList.add('atom')
    c.append(el('span', 'pylab-ref-v', o.v ?? ''), el('span', 'pylab-ref-id', shortId(ref)))
  } else {
    c.append(el('span', 'pylab-ref-t', o ? (o.t === 'function' || o.t === 'class' ? `${o.t} ${o.v ?? ''}` : o.t) : '?'), el('span', 'pylab-ref-id', shortId(ref)))
  }
  if (marks.fresh.has(ref)) c.classList.add('fresh')
  return c
}

/** One object as a card: its header (type, id, size), then what it holds */
function card(o: PyObject, heap: Map<string, PyObject>, marks: { fresh: Set<string>; changed: Set<string> }): HTMLElement {
  const box = el('div', 'pylab-obj')
  box.dataset.id = o.id
  if (marks.fresh.has(o.id)) box.classList.add('fresh')
  else if (marks.changed.has(o.id)) box.classList.add('changed')
  const atom = isAtom(o)
  if (atom) box.classList.add('atom')
  const head = el('div', 'pylab-obj-head')
  // An atom's card stays narrow, so a row of them fits: its id goes under its value
  head.append(el('span', 'pylab-obj-t', o.t), ...(atom ? [] : [el('span', 'pylab-obj-id', o.id)]), el('span', 'pylab-obj-sz', bytes(o.sz)))
  // CPython makes the ints -5 to 256 once, at start-up, and every 7 in the program is that one object
  if (o.t === 'int' && o.v !== undefined && /^-?\d+$/.test(o.v) && Number(o.v) >= -5 && Number(o.v) <= 256) {
    const cached = el('span', 'pylab-tag cached', 'cached')
    cached.title = 'A small int (-5 to 256): one shared object CPython made at start-up'
    head.append(cached)
  }
  if (marks.fresh.has(o.id)) head.append(el('span', 'pylab-tag', 'new'))
  else if (marks.changed.has(o.id)) head.append(el('span', 'pylab-tag changed', 'changed'))
  box.append(head)
  const body = el('div', 'pylab-obj-body')
  if (o.items) {
    const list = el('div', 'pylab-items')
    o.items.forEach((it, i) => {
      const slot = el('div', 'pylab-slot')
      if (Array.isArray(it)) {
        slot.classList.add('pair')
        slot.append(chip(it[0], heap, marks), el('span', 'pylab-colon', ':'), chip(it[1], heap, marks))
      } else {
        if (o.t === 'list' || o.t === 'tuple') slot.append(el('span', 'pylab-idx', String(i)))
        slot.append(chip(it, heap, marks))
      }
      list.append(slot)
    })
    // A list's spare capacity: slots CPython has allocated but nothing fills yet
    const spare = o.t === 'list' && o.cap !== undefined ? o.cap - o.items.length - (o.more ?? 0) : 0
    for (let i = 0; i < Math.min(spare, 16); i++) list.append(el('div', 'pylab-slot spare'))
    if (!o.items.length && spare <= 0) list.append(el('span', 'pylab-empty', 'empty'))
    body.append(list)
    const facts: string[] = []
    if (o.more) facts.push(`${o.more} more not shown`)
    if (o.t === 'list' && o.cap !== undefined) facts.push(`len ${o.items.length + (o.more ?? 0)}, cap ${o.cap}`)
    if (facts.length) body.append(el('div', 'pylab-obj-note', facts.join(' · ')))
  } else if (o.attrs) {
    const list = el('div', 'pylab-attrs')
    for (const [k, r] of o.attrs) {
      const row = el('div', 'pylab-attr')
      row.append(el('span', 'pylab-name', k), chip(r, heap, marks))
      list.append(row)
    }
    if (!o.attrs.length) list.append(el('span', 'pylab-empty', 'no attributes'))
    body.append(list)
  } else {
    body.append(el('code', 'pylab-val', o.v ?? ''))
    if (atom) body.append(el('div', 'pylab-obj-id', o.id))
    if (o.d && (o.d.length > 1 || o.d[0] >= 256)) {
      // A big int's magnitude in CPython's base-2^30 digits, least significant first
      const digits = el('div', 'pylab-digits')
      digits.title = 'CPython stores an int’s magnitude as base-2^30 digits, least significant first'
      digits.append(el('span', 'pylab-obj-note', `${o.d.length} digit${o.d.length === 1 ? '' : 's'} of 30 bits:`))
      for (const d of o.d) digits.append(el('code', 'pylab-digit', String(d)))
      body.append(digits)
    }
  }
  box.append(body)
  return box
}

/** Objects in the order they first appear in the trace, so cards keep their places as you step */
function firstSeen(trace: PyTrace): Map<string, number> {
  const order = new Map<string, number>()
  for (const s of trace.steps) for (const k of s.heap) {
    const id = trace.objects[k]?.id
    if (id && !order.has(id)) order.set(id, order.size)
  }
  return order
}

export function pyLabBlock(initial: string, opts: PyLabOptions = {}): { root: HTMLElement; destroy(): void; ready: Promise<void> } {
  let code = initial.replace(/\s+$/, '')
  let trace: PyTrace | null = null
  let error = ''
  let at = 0
  let mode: StepMode = 'line'
  let depth: number | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let order = new Map<string, number>()
  let turn = 0
  const traceIt = opts.trace ?? ((c: string) => window.tide.visuals.traceLab(c))

  const root = el('div', 'pylab')
  root.tabIndex = 0
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Python lab')

  // ---------- Bar ----------
  const bar = el('div', 'pylab-bar')
  const lang = el('span', 'pylab-lang', 'Python lab')
  const ver = el('span', 'pylab-ver')
  const status = el('span', 'pylab-status')
  status.setAttribute('aria-live', 'polite')
  const editBtn = button('btn small ghost pylab-edit', 'Edit', 'Change the program', () => setEditing(!editing))
  const runBtn = button('btn small primary pylab-run', 'Trace', 'Run it again under the tracer (⌘↵)', () => void run())
  bar.append(lang, ver, el('span', 'pylab-space'), status, editBtn, runBtn)
  root.append(bar)
  if (opts.watch) root.append(el('div', 'pylab-watch', opts.watch))

  // ---------- Editor ----------
  const editor = el('div', 'pylab-editor')
  const area = el('textarea', 'pylab-src')
  area.spellcheck = false
  area.value = code
  area.setAttribute('aria-label', 'Program')
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void run()
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end')
    }
    e.stopPropagation()
  })
  const fit = () => (area.style.height = `${Math.min(420, Math.max(96, area.value.split('\n').length * 20 + 20))}px`)
  area.addEventListener('input', fit)
  editor.append(area)
  root.append(editor)
  let editing = !!opts.editing
  function setEditing(on: boolean) {
    editing = on
    editor.hidden = !on
    editBtn.textContent = on ? 'Done' : 'Edit'
    if (on) {
      fit()
      area.focus()
    }
  }

  // ---------- Controls ----------
  const controls = el('div', 'pylab-controls')
  const first = button('pylab-ctl', '⏮', 'Start (Home)', () => go(0))
  const back = button('pylab-ctl', '◀', 'Back a step (←)', () => go(stepFrom(trace?.steps ?? [], at, mode, -1)))
  const play = button('pylab-ctl pylab-play', '▶', 'Play (Space)', () => toggle())
  const next = button('pylab-ctl', '▶|', 'Forward a step (→)', () => go(stepFrom(trace?.steps ?? [], at, mode, 1)))
  const last = button('pylab-ctl', '⏭', 'End (End)', () => go((trace?.steps.length ?? 1) - 1))
  const modes = el('div', 'segmented text pylab-mode')
  modes.setAttribute('role', 'group')
  modes.setAttribute('aria-label', 'Step by')
  const modeBtns: Record<StepMode, HTMLButtonElement> = {
    line: button('', 'Lines', 'Step a line at a time', () => setMode('line')),
    op: button('', 'Instructions', 'Step one bytecode instruction at a time', () => setMode('op'))
  }
  modes.append(modeBtns.line, modeBtns.op)
  const slider = el('input', 'pylab-slider')
  slider.type = 'range'
  slider.min = '0'
  slider.setAttribute('aria-label', 'Step')
  slider.addEventListener('input', () => go(Number(slider.value)))
  const count = el('span', 'pylab-count')
  controls.append(first, back, play, next, last, modes, slider, count)
  root.append(controls)

  // ---------- Panes ----------
  const panes = el('div', 'pylab-panes')
  const pane = (cls: string, title: string) => {
    const s = el('section', `pylab-pane ${cls}`)
    const h = el('header', 'pylab-pane-head')
    const t = el('span', 'pylab-pane-title', title)
    const sub = el('span', 'pylab-pane-sub')
    h.append(t, sub)
    const body = el('div', 'pylab-pane-body')
    s.append(h, body)
    panes.append(s)
    return { s, sub, body }
  }
  const codePane = pane('pylab-code', 'Code')
  const opsPane = pane('pylab-ops', 'Bytecode')
  const stackPane = pane('pylab-stack', 'Call stack')
  const heapPane = pane('pylab-heap', 'Objects in memory')
  const note = el('div', 'pylab-opnote')
  opsPane.s.append(note)
  root.append(panes)

  const out = el('div', 'pylab-out')
  const outText = el('pre', 'pylab-out-text')
  const outErr = el('div', 'pylab-err')
  outErr.setAttribute('role', 'alert')
  out.append(el('span', 'pylab-pane-title', 'Output'), outText)
  root.append(out, outErr)

  // Hovering a reference lights the object it points at, and an object lights every reference to it
  root.addEventListener('mouseover', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('.pylab-ref, .pylab-obj')
    const id = t?.dataset.ref ?? t?.dataset.id
    root.querySelectorAll('.lit').forEach((n) => n.classList.remove('lit'))
    if (!id) return
    root.querySelectorAll(`[data-ref="${id}"], [data-id="${id}"]`).forEach((n) => n.classList.add('lit'))
  })
  root.addEventListener('mouseleave', () => root.querySelectorAll('.lit').forEach((n) => n.classList.remove('lit')))

  root.addEventListener('keydown', (e) => {
    if (!trace || e.target !== root) return
    const keys: Record<string, () => void> = {
      ArrowRight: () => go(stepFrom(trace!.steps, at, mode, 1)),
      ArrowLeft: () => go(stepFrom(trace!.steps, at, mode, -1)),
      Home: () => go(0),
      End: () => go(trace!.steps.length - 1),
      ' ': () => toggle()
    }
    const f = keys[e.key]
    if (f) {
      e.preventDefault()
      f()
    }
  })

  function setMode(m: StepMode) {
    mode = m
    for (const [k, b] of Object.entries(modeBtns)) {
      b.classList.toggle('on', k === m)
      b.setAttribute('aria-pressed', String(k === m))
    }
    render()
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    play.textContent = '▶'
    play.title = 'Play (Space)'
  }

  function toggle() {
    if (!trace) return
    if (timer) return stop()
    if (at >= trace.steps.length - 1) go(0)
    play.textContent = '❚❚'
    play.title = 'Pause (Space)'
    timer = setInterval(
      () => {
        if (!trace || at >= trace.steps.length - 1) return stop()
        go(stepFrom(trace.steps, at, mode, 1), true)
      },
      mode === 'op' ? 260 : 650
    )
  }

  function go(i: number, playing = false) {
    if (!trace) return
    if (!playing) stop()
    at = Math.max(0, Math.min(trace.steps.length - 1, i))
    depth = null
    render()
  }

  async function run() {
    const mine = ++turn
    stop()
    code = area.value.replace(/\s+$/, '')
    runBtn.disabled = true
    status.textContent = 'Tracing…'
    root.classList.add('running')
    let r: Traced
    try {
      r = await traceIt(code)
    } catch (e) {
      r = { error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
    }
    if (mine !== turn) return
    runBtn.disabled = false
    root.classList.remove('running')
    status.textContent = ''
    trace = r.trace && r.trace.steps.length ? r.trace : null
    error = r.trace?.error ?? r.error ?? (r.trace && !r.trace.steps.length ? 'Nothing ran.' : '')
    order = trace ? firstSeen(trace) : new Map()
    at = 0
    depth = null
    if (!trace) setEditing(true)
    else if (editing && !opts.editing) setEditing(false)
    render()
  }

  // ---------- Drawing ----------

  function renderCode(s: PyStep) {
    const lines = (trace?.code ?? code).split('\n')
    const topLine = s.frames[s.frames.length - 1]?.line
    const callers = new Set(s.frames.slice(0, -1).map((f) => f.line))
    const viewing = depth !== null ? s.frames[depth]?.line : undefined
    const list = el('ol', 'pylab-lines')
    lines.forEach((text, i) => {
      const n = i + 1
      const li = el('li', 'pylab-line')
      li.append(el('span', 'pylab-ln', String(n)), el('code', 'pylab-lt', text || ' '))
      if (n === topLine) li.classList.add(s.event === 'return' ? 'returning' : s.event === 'exception' ? 'raising' : 'now')
      else if (callers.has(n)) li.classList.add('caller')
      if (viewing === n && n !== topLine) li.classList.add('viewing')
      list.append(li)
    })
    codePane.body.replaceChildren(list)
    codePane.sub.textContent = s.event === 'return' ? `returning from ${s.frames[s.frames.length - 1]?.name}` : s.event === 'exception' ? 'raising' : topLine ? `line ${topLine}` : ''
    keepInView(codePane.body, list.querySelector('.now, .returning, .raising'))
  }

  function renderOps(i: number) {
    const s = trace!.steps[i]
    const d = depth ?? s.frames.length - 1
    const where = opAt(trace!, i, d)
    if (!where) {
      opsPane.body.replaceChildren(el('div', 'pylab-empty', 'No bytecode in this trace.'))
      note.textContent = ''
      return
    }
    opsPane.sub.textContent = `${where.code.name}${trace!.version ? ` · CPython ${trace!.version}` : ''}`
    const table = el('div', 'pylab-optable')
    for (const group of opsByLine(where.code)) {
      const g = el('div', 'pylab-opgroup')
      g.append(el('div', 'pylab-opline', group.line ? String(group.line) : ''))
      const rows = el('div', 'pylab-oprows')
      for (const { op, index } of group.ops) {
        const row = el('div', 'pylab-op')
        if (index === where.index) row.classList.add(d === s.frames.length - 1 ? (s.event === 'opcode' ? 'now' : 'done') : 'waiting')
        else if (index < where.index) row.classList.add('past')
        row.append(el('span', 'pylab-off', (op[4] ? '>> ' : '') + String(op[0])), el('span', 'pylab-opname', op[1]), el('span', 'pylab-oparg', op[2]))
        rows.append(row)
      }
      g.append(rows)
      table.append(g)
    }
    opsPane.body.replaceChildren(table)
    const op = where.code.ops[where.index]
    const waiting = d !== s.frames.length - 1
    note.replaceChildren()
    if (op) {
      note.append(el('code', 'pylab-opnote-name', op[1]))
      const said = waiting ? 'This frame waits here for the call above it to return.' : s.event === 'return' ? 'This frame has returned; its value goes back to the caller.' : opcodeNote(op[1])
      note.append(el('span', '', said || 'An instruction of this version of CPython.'))
    }
    keepInView(opsPane.body, table.querySelector('.now, .done, .waiting'))
  }

  function renderStack(i: number, marks: ReturnType<typeof changesAt>, heap: Map<string, PyObject>) {
    const s = trace!.steps[i]
    const list = el('div', 'pylab-frames')
    stackPane.sub.textContent = `${s.frames.length} frame${s.frames.length === 1 ? '' : 's'}`
    // The newest frame on top, as the stack grows
    for (let d = s.frames.length - 1; d >= 0; d--) {
      const f = s.frames[d]
      const isTop = d === s.frames.length - 1
      const box = el('button', 'pylab-frame')
      box.type = 'button'
      box.title = isTop ? 'The running frame' : 'Show this frame’s bytecode'
      if (isTop) box.classList.add('top')
      if ((depth ?? s.frames.length - 1) === d) box.classList.add('viewing')
      box.addEventListener('click', () => {
        depth = d === s.frames.length - 1 ? null : d
        render()
      })
      const head = el('div', 'pylab-frame-head')
      head.append(el('span', 'pylab-frame-name', f.name === 'module' ? '<module>' : `${f.name}()`), el('span', 'pylab-frame-line', `line ${f.line}`))
      box.append(head)
      const names = el('div', 'pylab-names')
      for (const [n, r] of f.names) {
        const row = el('div', 'pylab-attr')
        if (marks.names.has(`${d}/${n}`)) row.classList.add('rebound')
        row.append(el('span', 'pylab-name', n), chip(r, heap, marks))
        names.append(row)
      }
      if (!f.names.length) names.append(el('span', 'pylab-empty', 'no names yet'))
      box.append(names)
      if (isTop && s.event === 'return' && s.ret) {
        const ret = el('div', 'pylab-attr pylab-ret')
        ret.append(el('span', 'pylab-name', 'returns'), chip(s.ret, heap, marks))
        box.append(ret)
      }
      list.append(box)
    }
    stackPane.body.replaceChildren(list)
  }

  function renderHeap(heap: Map<string, PyObject>, marks: ReturnType<typeof changesAt>) {
    const objs = [...heap.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    const grid = el('div', 'pylab-objs')
    // Containers and instances first, then the atoms they hold
    for (const o of objs.filter((x) => !isAtom(x))) grid.append(card(o, heap, marks))
    const atoms = objs.filter(isAtom)
    if (atoms.length) {
      const row = el('div', 'pylab-atoms')
      for (const o of atoms) row.append(card(o, heap, marks))
      grid.append(row)
    }
    heapPane.sub.textContent = `${objs.length} object${objs.length === 1 ? '' : 's'}, ${objs.reduce((n, o) => n + (o.sz ?? 0), 0)} bytes`
    heapPane.body.replaceChildren(grid)
  }

  function render() {
    root.classList.toggle('empty', !trace)
    controls.hidden = !trace
    panes.hidden = !trace
    out.hidden = !trace
    ver.textContent = trace?.version ? `CPython ${trace.version}` : ''
    outErr.hidden = !error
    outErr.textContent = error
    if (!trace) return
    const s = trace.steps[at]
    const heap = heapAt(trace, at)
    const marks = changesAt(trace, at)
    slider.max = String(trace.steps.length - 1)
    slider.value = String(at)
    const lc = lineCount(trace.steps, at)
    count.textContent = `${mode === 'line' ? `Line step ${lc.at} of ${lc.of}` : `Instruction ${at + 1} of ${trace.steps.length}`}${trace.stopped ? ' · stopped early' : ''}`
    count.title = trace.stopped ?? ''
    for (const [k, b] of Object.entries(modeBtns)) {
      b.classList.toggle('on', k === mode)
      b.setAttribute('aria-pressed', String(k === mode))
    }
    first.disabled = back.disabled = at === 0
    next.disabled = last.disabled = at === trace.steps.length - 1
    renderCode(s)
    renderOps(at)
    renderStack(at, marks, heap)
    renderHeap(heap, marks)
    outText.textContent = s.out || ' '
    const atEnd = at === trace.steps.length - 1
    const exc = s.exc ? `${s.exc} (raised here)` : ''
    outErr.hidden = !(exc || (atEnd && error))
    outErr.textContent = exc || (atEnd ? error : '')
  }

  /** Scrolls a pane, not the page, so a marked row is in sight */
  function keepInView(box: HTMLElement, row: Element | null) {
    if (!row) return
    const r = (row as HTMLElement).offsetTop - box.offsetTop
    if (r < box.scrollTop + 8) box.scrollTop = Math.max(0, r - 24)
    else if (r > box.scrollTop + box.clientHeight - 32) box.scrollTop = r - box.clientHeight + 48
  }

  setMode('line')
  setEditing(editing)
  render()
  const ready = run()
  return {
    root,
    ready,
    destroy() {
      turn++
      stop()
    }
  }
}

// ---------- In tutor text ----------

const DONE = 'pylabDone'
const bodyOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''
/** ```python blocks the learner chose to step through, by their text, so they come back as labs when the message is drawn again */
const stepped = new Set<string>()
const isPython = (pre: HTMLElement) => /^(python|py|python3)$/i.test(pre.dataset.lang ?? '')
const sourceOf = (pre: HTMLElement) => bodyOf(pre).replace(/\s+$/, '')

const keeper = createKeeper({
  widget: '.pylab',
  isSource: (pre) => isLabFence(pre.dataset.lang ?? '') || (isPython(pre) && stepped.has(sourceOf(pre))),
  sourceOf
})

function mount(pre: HTMLElement) {
  const code = sourceOf(pre)
  pre.dataset[DONE] = '1'
  if (!code.trim()) return
  const slot = keeper.slot(pre)
  const block = pyLabBlock(code)
  pre.replaceWith(block.root)
  keeper.keep(slot, block.root, block.destroy)
}

function scan() {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block[data-lang]').forEach((pre) => {
    if (pre.dataset[DONE] || !pre.isConnected) return
    if (isLabFence(pre.dataset.lang ?? '') || (isPython(pre) && stepped.has(sourceOf(pre)))) mount(pre)
  })
}

/** Watches the whole document for ```pylab blocks and "Step through" on Python blocks; call once at startup */
export function startPyLab() {
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('.step-code')
    const pre = b?.closest<HTMLElement>('pre.code-block')
    if (!pre) return
    e.preventDefault()
    e.stopPropagation()
    stepped.add(sourceOf(pre))
    mount(pre)
  })
  watchBlocks(keeper, scan)
  scan()
}
