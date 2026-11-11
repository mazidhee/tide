/**
 * The frame every simulation sits in: title, tour captions, the picture, a readout of the
 * selected part with "Ask about this", and the transport (Play/Pause, Step, Reset, speed).
 *
 * It also owns the clock. Steps run inside requestAnimationFrame with a time budget, and stop
 * when the figure is off screen, the window is hidden, or the model is working (the GPU is
 * shared with it). Reduced motion starts paused; steps then happen only when asked for.
 */
import { readPalette, type Palette } from './colour'
import { button, h, num, selectField } from './dom'
import { ASK_EVENT, askDetail, askQuestion, dispatchAsk, type PartInfo } from './parts'
import type { SimSpec, TourStep } from './spec'

export interface SimView {
  el: HTMLElement
  /** One unit of work: a training batch, an optimiser step, the next token */
  step(): void
  /** Start again (with a new seed where there is one) */
  reset(): void
  /** Paint the current state */
  draw(): void
  /** Steps per second at 1× */
  stepsPerSecond?(): number
  /** A reason to stop playing, once there is one */
  done?(): string | null
  /** The numbers behind a named part, or null if there's no such part */
  describe(part: string): PartInfo | null
  /** Point at a named part (null clears) */
  highlight(part: string | null): void
  /** Select sample or token n (from 1) */
  sample?(n: number): void
  /** Layout or theme changed */
  relayout?(): void
  destroy?(): void
}

export interface SimHost {
  root: HTMLElement
  palette(): Palette
  /** The learner chose a part (click or Enter): show its numbers and offer to ask about it */
  select(part: string | null): void
  /** The pointer is over a part: show its numbers for now */
  peek(part: string | null): void
  /** State changed outside a step; repaint */
  invalidate(): void
  reducedMotion: boolean
}

export interface SimKindDef<S extends SimSpec = SimSpec> {
  label: string
  /** Whether Play, Step and speed make sense for this kind */
  transport: boolean
  autoplay(spec: S): boolean
  create(spec: S, host: SimHost): SimView
}

export interface Mounted {
  root: HTMLElement
  destroy(): void
}

const SPEEDS = [
  ['0.25', '¼×'],
  ['1', '1×'],
  ['4', '4×'],
  ['16', '16×'],
  ['64', '64×']
] as const

/** Milliseconds of stepping allowed per frame, so the interface never stalls */
const BUDGET_MS = 6

const busy = () => document.documentElement.dataset.modelBusy === '1'

export function mountSim<S extends SimSpec>(spec: S, def: SimKindDef<S>, place: (root: HTMLElement) => void): Mounted {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const root = h('figure', { class: 'sim', 'data-kind': spec.kind, tabindex: 0, role: 'group', 'aria-label': `${def.label} simulation${spec.title ? `: ${spec.title}` : ''}` })
  const body = h('div', { class: 'sim-body' })
  root.append(h('figcaption', { class: 'sim-head' }, h('span', { class: 'sim-title' }, spec.title || def.label), h('span', { class: 'sim-kind' }, spec.title ? def.label : 'Live simulation')))
  place(root)

  let palette: Palette | null = null
  let playing = false
  let queued = 0
  let speed = 1
  let owed = 0
  let raf = 0
  let last = 0
  let visible = false
  let dirty = true
  let dead = false
  let selected: string | null = null
  let peeked: string | null = null
  let note = ''

  const host: SimHost = {
    root,
    reducedMotion,
    palette: () => (palette ??= readPalette(root)),
    select: (part) => {
      selected = part
      showReadout()
    },
    peek: (part) => {
      peeked = part
      showReadout()
    },
    invalidate: () => {
      dirty = true
      schedule()
    }
  }
  const view = def.create(spec, host)

  // ---------- Tour ----------
  const tour: TourStep[] = spec.tour
  let tourAt = 0
  const tourCount = h('span', { class: 'sim-tour-count' })
  const tourSay = h('p', { class: 'sim-tour-say', 'aria-live': 'polite' })
  const back = button('Back', () => goTo(tourAt - 1), 'quiet')
  const next = button('Next', () => goTo(tourAt + 1))
  function goTo(index: number): void {
    if (index < 0 || index >= tour.length) return
    const forward = index > tourAt || index === 0
    tourAt = index
    const stepNow = tour[index]
    tourCount.textContent = `${index + 1} / ${tour.length}`
    tourSay.textContent = stepNow.say
    back.disabled = index === 0
    next.disabled = index === tour.length - 1
    view.highlight(stepNow.at && view.describe(stepNow.at) ? stepNow.at : null)
    // Going back only re-reads the words; it doesn't train again
    if (forward && stepNow.do) {
      if (stepNow.do.sample !== undefined) view.sample?.(stepNow.do.sample)
      if (stepNow.do.pause !== undefined) setPlaying(!stepNow.do.pause)
      if (stepNow.do.run) queued += stepNow.do.run
    }
    host.invalidate()
  }
  // One caption needs no step count or buttons
  if (tour.length === 1) root.append(h('div', { class: 'sim-tour single' }, tourSay))
  else if (tour.length) root.append(h('div', { class: 'sim-tour' }, tourCount, tourSay, h('div', { class: 'sim-tour-nav' }, back, next)))

  body.append(view.el)
  root.append(body)

  // ---------- Readout and asking ----------
  const readLabel = h('span', { class: 'sim-readout-label' })
  const readValues = h('span', { class: 'sim-readout-values' })
  const ask = button('Ask about this', () => {
    const info = selected ? view.describe(selected) : null
    if (!selected || !info) return
    const detail = askDetail(spec.kind, selected, info)
    const event = dispatchAsk(root, detail)
    // A listener that took the question says so by cancelling the event; otherwise it's copied
    if (event.defaultPrevented) flash('Added to your question')
    else
      navigator.clipboard
        ?.writeText(askQuestion(detail))
        .then(() => flash('Copied as a question'))
        .catch(() => undefined)
  }, 'quiet sim-ask')
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  function flash(text: string): void {
    ask.textContent = text
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (ask.textContent = 'Ask about this'), 1800)
  }
  const readout = h('div', { class: 'sim-readout' }, h('div', { class: 'sim-readout-text', 'aria-live': 'polite' }, readLabel, readValues), ask)
  root.append(readout)

  function showReadout(): void {
    const part = peeked ?? selected
    const info = part ? view.describe(part) : null
    readout.classList.toggle('empty', !info)
    ask.hidden = !(info && selected && part === selected)
    if (!info) {
      readLabel.textContent = 'Select a part of the picture to read its numbers.'
      readValues.textContent = ''
      return
    }
    readLabel.textContent = info.label.charAt(0).toUpperCase() + info.label.slice(1)
    readValues.textContent = Object.entries(info.values)
      .slice(0, 4)
      .map(([key, v]) => `${key} ${typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 3) : v}`)
      .join('   ')
  }

  // ---------- Transport ----------
  const status = h('span', { class: 'sim-status', 'aria-live': 'polite' })
  const play = button('Play', () => setPlaying(!playing), 'primary sim-play')
  const stepBtn = button('Step', () => stepOnce())
  const resetBtn = button('Reset', () => reset())
  play.title = 'Space'
  stepBtn.title = 'S'
  resetBtn.title = 'R'
  const bar = h('div', { class: 'sim-bar' })
  if (def.transport) {
    const speedField = selectField('Speed', SPEEDS, '1', (v) => (speed = Number(v)))
    bar.append(play, stepBtn, resetBtn, speedField.el, status)
  } else {
    bar.append(resetBtn, status)
  }
  root.append(bar)

  function showStatus(): void {
    play.textContent = playing ? 'Pause' : 'Play'
    play.setAttribute('aria-pressed', playing ? 'true' : 'false')
    const waiting = (playing || queued > 0) && busy()
    const text = waiting ? 'Waiting while the model is working' : queued > 0 ? `Running ${queued} steps` : note
    if (status.textContent !== text) status.textContent = text
  }

  function setPlaying(on: boolean): void {
    if (!def.transport) return
    if (on && view.done?.()) return
    playing = on
    if (on) note = ''
    owed = 0
    last = 0
    showStatus()
    schedule()
  }

  function finishIfDone(): boolean {
    const reason = view.done?.()
    if (!reason) return false
    playing = false
    queued = 0
    note = reason
    return true
  }

  function stepOnce(): void {
    if (!def.transport) return
    setPlaying(false)
    if (!finishIfDone()) {
      view.step()
      finishIfDone()
    }
    paint()
  }

  function reset(): void {
    queued = 0
    note = ''
    owed = 0
    view.reset()
    paint()
  }

  function paint(): void {
    dirty = false
    view.draw()
    showReadout()
    showStatus()
  }

  const blocked = () => !visible || document.hidden || busy()

  function schedule(): void {
    if (dead || raf) return
    raf = requestAnimationFrame(frame)
  }

  function frame(now: number): void {
    raf = 0
    if (dead || !visible || document.hidden) return
    let want = 0
    if (!busy()) {
      if (queued > 0) want = queued
      else if (playing) {
        const dt = last ? Math.min(now - last, 100) : 16
        owed += (dt / 1000) * (view.stepsPerSecond?.() ?? 30) * speed
        want = Math.floor(owed)
        owed -= want
      }
    }
    last = now
    let did = 0
    const t0 = performance.now()
    while (did < want && !finishIfDone()) {
      view.step()
      did++
      if (queued > 0) queued--
      if (performance.now() - t0 > BUDGET_MS) break
    }
    if (did) finishIfDone()
    // Steps that didn't fit in the budget are dropped rather than piling up
    if (playing && did < want) owed = 0
    if (did || dirty) paint()
    else showStatus()
    if ((playing || queued > 0) && !blocked()) schedule()
  }

  // ---------- Keyboard ----------
  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    const field = target.closest('input, select, textarea')
    if (tour.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !field && !target.closest('[data-arrows]')) {
      goTo(tourAt + (e.key === 'ArrowRight' ? 1 : -1))
      e.preventDefault()
      return
    }
    if (field && (field as HTMLInputElement).type !== 'range') return
    if (e.key === ' ' && !target.closest('button, select, [data-arrows]') && def.transport) {
      setPlaying(!playing)
      e.preventDefault()
    } else if (e.key === 's' || e.key === 'S') stepOnce()
    else if (e.key === 'r' || e.key === 'R') reset()
    else if (e.key === 'Escape') host.select(null)
  })

  // ---------- Watching: on screen, theme, the model, size ----------
  const seen = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting
    if (visible) {
      last = 0
      if (dirty || playing || queued > 0) schedule()
    }
  })
  seen.observe(root)

  const rootWatch = new MutationObserver((records) => {
    if (records.some((r) => r.attributeName !== 'data-model-busy')) {
      palette = null
      view.relayout?.()
      host.invalidate()
    }
    last = 0
    showStatus()
    schedule()
  })
  rootWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-model-busy', 'style', 'class'] })

  let width = 0
  const sized = new ResizeObserver(() => {
    const w = body.clientWidth
    if (w === width) return
    width = w
    view.relayout?.()
    // Painted at once rather than on the next frame, so a resize never shows a stale picture
    paint()
  })
  sized.observe(body)

  const onShow = () => {
    last = 0
    if (!document.hidden) schedule()
  }
  document.addEventListener('visibilitychange', onShow)

  if (tour.length) goTo(0)
  else if (def.transport && def.autoplay(spec) && !reducedMotion) playing = true
  // The first picture doesn't wait for a frame
  if (root.isConnected) paint()
  schedule()

  return {
    root,
    destroy() {
      if (dead) return
      dead = true
      cancelAnimationFrame(raf)
      clearTimeout(flashTimer)
      seen.disconnect()
      rootWatch.disconnect()
      sized.disconnect()
      document.removeEventListener('visibilitychange', onShow)
      view.destroy?.()
    }
  }
}

export { ASK_EVENT }
