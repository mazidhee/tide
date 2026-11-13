/**
 * Claude's visuals in the page: each ```visual block becomes a sandboxed frame (shared/visuals)
 * inside a frame of Tide's own: title, caption, the step bar (Back, Play, Step, Reset), the part
 * the learner selected with "Ask about this", and "What's happening here?".
 *
 * Lifecycle of one visual:
 * - waiting: nothing runs until the block is near the screen;
 * - checking: the frame runs hidden; it must load, draw something and report no error within a
 *   few seconds, while main watches its process;
 * - fixing: a failed visual goes back to Claude once (main/visuals), and the fix is checked the
 *   same way; if that fails too, a mermaid diagram or table Claude writes instead is shown;
 * - live: shown, with one frame per visible visual; a visual scrolled out of sight for a moment
 *   has its frame torn down (its process with it) and is rebuilt, at the same step, on return.
 * The outcome is kept in the lesson's record (main/lessons), so a reopened lesson shows its
 * visuals at once without checking or asking Claude again.
 */
import { MAX_MESSAGES_PER_SECOND, askAboutPart, frameUrl, isVisualSource, looksComplete, parseFrameMessage, themeCss, visualKey, tellTutor, visualNote, visualTitle, whatsHappening, type FrameMessage, type VisualRecord, type VisualState, type VisualTheme } from '@shared/visuals'
import type { ChatScope } from '@shared/types'
import { createKeeper, watchBlocks } from '../liveBlocks'
import { button, h } from '../sims/dom'
import { toAnswerBox } from '../sims/exploreBus'

// ---------- Settings, for tests ----------

export const timing = {
  /** A block must be unchanged this long before it is tried (the reply may still be streaming) */
  settleMs: 1000,
  /** From the frame's creation to its ready message */
  loadMs: 6000,
  /** After ready, errors still count for this long */
  watchMs: 700,
  /** Drawing every step once, hidden, may take this long */
  auditMs: 3000,
  /** No heartbeat for this long: the frame's main thread is stuck */
  hangMs: 3000,
  /** Out of sight this long: the frame is torn down */
  parkMs: 1500
}

type VisualsApi = Window['tide']['visuals']

export interface VisualDeps {
  api: VisualsApi
  /** The app's theme, as the frame's tokens, read where the visual sits */
  theme(at?: Element): VisualTheme
  /** A fresh frame host: v and random letters */
  host(): string
  /** Markdown to HTML, for a fallback */
  markdown(text: string): string
}

let deps: VisualDeps | null = null
export const configureVisuals = (d: Partial<VisualDeps>) => (deps = { ...defaultDeps(), ...deps, ...d })

function defaultDeps(): VisualDeps {
  return {
    api: (typeof window !== 'undefined' ? window.tide?.visuals : undefined) as VisualsApi,
    theme: readTheme,
    host: () => `v${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('')}`,
    markdown: (t) => {
      const el = document.createElement('div')
      el.textContent = t
      return el.innerHTML
    }
  }
}
const d = () => (deps ??= defaultDeps())

// ---------- Theme ----------

const TOKEN_SOURCES: Record<string, string> = {
  bg: '--bg-raised',
  surface: '--bg',
  ink: '--ink',
  'ink-soft': '--ink-soft',
  muted: '--ink-muted',
  line: '--line',
  'line-strong': '--line-strong',
  accent: '--accent',
  'accent-soft': '--accent-soft',
  pos: '--sim-pos',
  neg: '--sim-neg',
  good: '--series-3',
  bad: '--danger',
  warn: '--warn',
  c1: '--series-1',
  c2: '--series-2',
  c3: '--series-3',
  c4: '--series-4',
  c5: '--series-5',
  c6: '--series-6'
}

/** The app's colours as plain rgb() values (color-mix and light-dark resolved), read inside a figure so per-figure tokens apply */
export function readTheme(at?: Element): VisualTheme {
  const host = (at as HTMLElement | undefined) ?? document.body
  const probe = document.createElement('span')
  probe.style.display = 'none'
  host.appendChild(probe)
  const tokens: Record<string, string> = {}
  for (const [k, v] of Object.entries(TOKEN_SOURCES)) {
    probe.style.color = `var(${v})`
    const c = getComputedStyle(probe).color
    if (c) tokens[k] = c
  }
  probe.remove()
  const scheme = getComputedStyle(document.documentElement).colorScheme.includes('dark') || ['graphite', 'dark', 'midnight', 'ember'].includes(document.documentElement.dataset.theme ?? '') ? 'dark' : 'light'
  return { scheme, tokens }
}

// ---------- Where a block sits ----------

function scopeOf(el: Element): ChatScope {
  const raw = el.closest<HTMLElement>('[data-visual-scope]')?.dataset.visualScope
  if (!raw) return { kind: 'none' }
  try {
    return JSON.parse(raw) as ChatScope
  } catch {
    // Unreadable: treated as private, so nothing runs
    return { kind: 'folder', path: '\u0000unknown' }
  }
}
const lessonOf = (el: Element) => el.closest<HTMLElement>('[data-visual-lesson]')?.dataset.visualLesson || ''

const policies = new Map<string, Promise<{ show: boolean; repair: boolean; why?: string }>>()
function policyFor(scope: ChatScope) {
  const key = JSON.stringify(scope)
  let p = policies.get(key)
  if (!p) {
    p = d()
      .api.policy(scope)
      .catch(() => ({ show: false, repair: false, why: 'Tide could not check this lesson' }))
    policies.set(key, p)
    // Claude may become ready (or stop being) later on
    setTimeout(() => policies.delete(key), 60_000)
  }
  return p
}

const caches = new Map<string, Promise<Record<string, VisualRecord>>>()
const cachedFor = (lesson: string) => {
  let c = caches.get(lesson)
  if (!c) caches.set(lesson, (c = d().api.cached(lesson).catch(() => ({}))))
  return c
}
async function remember(lesson: string, key: string, record: VisualRecord, source?: string) {
  if (!lesson) return
  const all = await cachedFor(lesson)
  all[key] = record
  await d()
    .api.remember(lesson, key, record, source)
    .catch(() => false)
}

// ---------- One check at a time ----------

let checking: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = checking.catch(() => undefined).then(fn)
  checking = run
  return run
}

// ---------- A frame ----------

interface FrameRun {
  host: string
  iframe: HTMLIFrameElement
  /** Resolves when it's ready and has settled, or has failed */
  outcome: Promise<{ ok: boolean; errors: string[] }>
  errors: string[]
  stop(): void
  send(m: Record<string, unknown>): void
  /** Show a frame that passed its check, and hand its messages to `handlers` from now on (the last size and step are given again) */
  reveal(handlers: FrameHandlers): void
}

/** Frames running now, by host: main tells the window when it kills one */
const running = new Map<string, (why: string) => void>()

interface FrameHandlers {
  onMessage(m: FrameMessage): void
  /** Stuck, killed, or too chatty after it was shown */
  onDead(why: string): void
}

function startFrame(stage: HTMLElement, code: string, visible: boolean, initial: FrameHandlers): FrameRun {
  let handlers = initial
  const { api, host: newHost, theme } = d()
  const last: Partial<Record<'ready' | 'size' | 'steps', FrameMessage>> = {}
  const host = newHost()
  const iframe = document.createElement('iframe')
  // Scripts only: never allow-same-origin, forms, popups, modals or top navigation
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('allow', '')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('loading', 'eager')
  iframe.className = visible ? 'visual-frame' : 'visual-frame checking'
  iframe.setAttribute('aria-hidden', visible ? 'false' : 'true')
  if (!visible) iframe.tabIndex = -1
  iframe.title = 'Interactive visual'
  const errors: string[] = []
  let ready = false
  let drawn = true
  let lastBeat = 0
  let stopped = false
  let count = 0
  let second = 0
  let finish: (r: { ok: boolean; errors: string[] }) => void = () => {}
  const outcome = new Promise<{ ok: boolean; errors: string[] }>((r) => (finish = r))
  let settled = false
  let auditTimer: ReturnType<typeof setTimeout> | undefined
  const settle = (ok: boolean) => {
    if (settled) return
    settled = true
    finish({ ok: ok && errors.length === 0 && drawn, errors: [...errors, ...(drawn ? [] : ['The visual drew nothing: it must put its SVG, canvas or text in the page.'])] })
  }
  const fail = (why: string) => {
    if (!errors.includes(why)) errors.push(why)
    if (!settled) settle(false)
    else handlers.onDead(why)
  }

  const onMessage = (e: MessageEvent) => {
    if (stopped || e.source !== iframe.contentWindow) return
    // A frame that floods the page is treated as running away
    const now = Date.now()
    if (now - second > 1000) {
      second = now
      count = 0
    }
    if (++count > MAX_MESSAGES_PER_SECOND) {
      void api.kill(host, 'it sent too many messages')
      fail('It sent Tide too many messages at once (more than 120 a second).')
      return
    }
    const m = parseFrameMessage(e.data)
    if (!m) return
    if (m.t === 'beat') {
      lastBeat = now
      return
    }
    if (m.t === 'error') {
      if (errors.length < 8 && !errors.includes(m.msg)) errors.push(m.msg)
      if (!settled && ready) settle(false)
    }
    if (m.t === 'ready' || m.t === 'size' || m.t === 'steps') last[m.t] = m
    if (m.t === 'ready') {
      ready = true
      lastBeat = now
      drawn = m.drawn
      // Errors already reported fail it at once; otherwise it has a moment more to report any
      if (errors.length || !drawn) settle(false)
      // Checked hidden: every step is drawn once first (errors, overlapping labels), then it is put back at the start
      else if (!visible) {
        iframe.contentWindow?.postMessage({ tv: 1, t: 'control', action: 'audit' }, '*')
        auditTimer = setTimeout(() => settle(true), timing.auditMs)
      } else setTimeout(() => settle(true), timing.watchMs)
    }
    if (m.t === 'audit' && !settled) {
      clearTimeout(auditTimer)
      for (const p of m.problems) if (errors.length < 8 && !errors.includes(p)) errors.push(p)
      if (errors.length) settle(false)
      else setTimeout(() => settle(true), timing.watchMs)
    }
    handlers.onMessage(m)
  }
  window.addEventListener('message', onMessage)

  const loadTimer = setTimeout(() => !ready && fail(`It did not finish loading within ${timing.loadMs / 1000} s.`), timing.loadMs)
  const hangTimer = setInterval(() => {
    if (!ready || stopped) return
    // Out of the page (its message re-rendered): it is about to be put back or destroyed
    if (!iframe.isConnected) return void (lastBeat = Date.now())
    if (Date.now() - lastBeat > timing.hangMs) {
      void api.kill(host, 'it stopped answering')
      fail('Its script never yielded (an endless loop or a very long computation), so Tide stopped it.')
      clearInterval(hangTimer)
    }
  }, 500)

  iframe.src = frameUrl(host, code, theme(stage))
  stage.append(iframe)
  running.set(host, (why) => fail(`Tide stopped it: ${why}.`))
  void api.watch(host).catch(() => undefined)

  return {
    host,
    iframe,
    outcome,
    errors,
    stop() {
      if (stopped) return
      stopped = true
      clearTimeout(loadTimer)
      clearInterval(hangTimer)
      running.delete(host)
      window.removeEventListener('message', onMessage)
      void api.unwatch(host).catch(() => undefined)
      iframe.remove()
      settle(false)
    },
    send(m) {
      if (!stopped) iframe.contentWindow?.postMessage({ tv: 1, ...m }, '*')
    },
    reveal(h) {
      handlers = h
      iframe.className = 'visual-frame'
      iframe.setAttribute('aria-hidden', 'false')
      iframe.removeAttribute('tabindex')
      for (const k of ['ready', 'size', 'steps'] as const) if (last[k]) h.onMessage(last[k]!)
    }
  }
}

// ---------- A visual ----------

interface Widget {
  root: HTMLElement
  state: VisualState
  /** Changed by the learner since the tutor last heard */
  dirty: boolean
  host(): string | null
  destroy(): void
}

const widgets = new Set<Widget>()

/** Live frames on the page, for measuring */
export const liveVisuals = () => [...widgets].filter((w) => w.host()).length

/** Notes for the tutor about visuals in `container` the learner has used since it last heard (and clears them) */
export function takeVisualNotes(container: Element | null): string[] {
  if (!container) return []
  const out: string[] = []
  for (const w of widgets) {
    if (!w.dirty || !container.contains(w.root)) continue
    w.dirty = false
    const note = visualNote(w.state)
    if (note) out.push(note)
  }
  return out
}

export const ASK_VISUAL_EVENT = 'tide:ask-visual'

/** Hands a question to whatever is listening (a lesson sends it); otherwise it fills the nearest "Ask…" box, or is copied */
export function ask(root: HTMLElement, question: string, flash: (t: string) => void) {
  const event = new CustomEvent(ASK_VISUAL_EVENT, { bubbles: true, cancelable: true, detail: { question } })
  root.dispatchEvent(event)
  if (event.defaultPrevented) return flash('Asked')
  for (let el = root.parentElement; el; el = el.parentElement) {
    const boxes = Array.from(el.querySelectorAll<HTMLTextAreaElement>('textarea:not([readonly]):not([disabled])')).filter((t) => /^ask\b/i.test(t.placeholder || t.getAttribute('aria-label') || ''))
    const box = boxes[boxes.length - 1]
    if (!box) continue
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(box, question.split('\n\n(Tide:')[0])
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.focus()
    return flash('Added to your question')
  }
  void navigator.clipboard?.writeText(question.split('\n\n(Tide:')[0]).then(() => flash('Copied as a question')).catch(() => undefined)
}

export function mountVisual(source: string, at: Element, place: (root: HTMLElement) => void): Widget {
  const original = source.trim()
  const key = visualKey(original)
  const title = visualTitle(original) || 'Visual'
  const scope = scopeOf(at)
  const lesson = lessonOf(at)

  const root = h('figure', { class: 'sim visual', tabindex: 0, role: 'group', 'aria-label': `Interactive visual: ${title}`, 'data-state': 'waiting' })
  const status = h('span', { class: 'sim-kind visual-status', 'aria-live': 'polite' }, 'Interactive visual')
  root.append(h('figcaption', { class: 'sim-head' }, h('span', { class: 'sim-title' }, title), status))
  const caption = h('p', { class: 'sim-tour-say visual-say', 'aria-live': 'polite' })
  const count = h('span', { class: 'sim-tour-count' })
  const captionBox = h('div', { class: 'sim-tour single visual-caption', hidden: true }, caption)
  root.append(captionBox)
  const stage = h('div', { class: 'visual-stage' })
  root.append(h('div', { class: 'sim-body' }, stage))
  // A goal the visual set (visual.goal), met or not
  const goalLine = h('p', { class: 'sim-ex-goal visual-goal', hidden: true, 'aria-live': 'polite' })
  root.append(goalLine)

  // Readout and asking
  const readLabel = h('span', { class: 'sim-readout-label' })
  const askPart = button('Ask about this', () => {
    ask(root, askAboutPart(state), flashAsk)
    widget.dirty = false
  }, 'quiet sim-ask')
  askPart.hidden = true
  const readout = h('div', { class: 'sim-readout empty' }, h('div', { class: 'sim-readout-text', 'aria-live': 'polite' }, readLabel), askPart)
  // Shown once the learner selects a part (a visual may have none)
  readout.hidden = true
  root.append(readout)
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const flashAsk = (t: string) => {
    const was = askPart.hidden ? happening : askPart
    const text = was.textContent
    was.textContent = t
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (was.textContent = text), 1600)
  }

  // The bar
  const back = button('Back', () => control('back'), 'quiet')
  const play = button('Play', () => control(playing ? 'pause' : 'play'), 'primary sim-play')
  const next = button('Step', () => control('next'))
  const reset = button('Reset', () => doReset())
  const happening = button("What's happening here?", () => {
    ask(root, whatsHappening(state), flashAsk)
    widget.dirty = false
  }, 'quiet')
  back.title = '←'
  next.title = '→'
  play.title = 'Space'
  reset.title = 'R'
  const stepper = h('span', { class: 'visual-stepper' }, back, play, next, count)
  stepper.hidden = true
  // What they found, into their answer, to finish in their own words (like the explorables)
  const tell = button('Tell the tutor', () => {
    const where = toAnswerBox(root, tellTutor(state))
    tell.textContent = where === 'answer' ? 'In your answer' : where === 'ask' ? 'Added to your question' : 'Copied'
    setTimeout(() => (tell.textContent = 'Tell the tutor'), 1600)
    widget.dirty = false
  }, 'quiet')
  const bar = h('div', { class: 'sim-bar visual-bar' }, stepper, reset, h('span', { class: 'visual-gap' }), tell, happening)
  root.append(bar)
  bar.hidden = true

  const state: VisualState = { title }
  let playing = false
  let steps: { i: number; n: number } | null = null
  let code = original
  let frame: FrameRun | null = null
  let height = 240
  let dead = false
  let phase: 'waiting' | 'checking' | 'fixing' | 'live' | 'parked' | 'done' = 'waiting'
  let verified = false
  let repaired = false
  let near = false
  let awayTimer: ReturnType<typeof setTimeout> | undefined
  let restoreStep = 0
  /** The policy and the lesson's cache have been read: it may start */
  let prepared = false

  const setPhase = (p: typeof phase, text: string) => {
    phase = p
    root.dataset.state = p
    status.textContent = text
  }

  const widget: Widget = {
    root,
    state,
    dirty: false,
    host: () => (frame && phase === 'live' ? frame.host : null),
    destroy
  }
  widgets.add(widget)
  place(root)

  function control(action: string, i?: number) {
    frame?.send({ t: 'control', action, ...(i !== undefined ? { i } : {}) })
  }

  function doReset() {
    if (steps) {
      control('reset')
      widget.dirty = true
    } else if (phase === 'live') {
      // Nothing to step: run it again from the start
      showLive()
    }
  }

  function onMessage(m: FrameMessage) {
    switch (m.t) {
      case 'size':
      case 'ready':
        height = Math.max(60, Math.min(640, m.h || height))
        if (frame && phase === 'live') frame.iframe.style.height = `${height}px`
        if (m.t === 'ready' && phase === 'live' && restoreStep > 0) {
          control('goto', restoreStep)
          restoreStep = 0
        }
        break
      case 'steps': {
        const first = !steps
        steps = { i: m.i, n: m.n }
        playing = m.playing
        state.step = { i: m.i, n: m.n, say: m.say }
        stepper.hidden = false
        count.textContent = `${m.i + 1} / ${m.n}`
        caption.textContent = m.say
        captionBox.hidden = !m.say
        back.disabled = m.i === 0
        next.disabled = m.i >= m.n - 1
        play.textContent = playing ? 'Pause' : 'Play'
        play.setAttribute('aria-pressed', playing ? 'true' : 'false')
        if (!first) widget.dirty = true
        break
      }
      case 'report':
        state.report = { text: m.text, data: m.data }
        widget.dirty = true
        break
      case 'predict':
        state.predicted = { question: m.question, value: m.value }
        widget.dirty = true
        break
      case 'goal':
        // Once met, it stays met
        state.goal = { text: m.text, met: m.met || (state.goal?.text === m.text && state.goal.met) }
        goalLine.hidden = false
        goalLine.classList.toggle('met', state.goal.met)
        goalLine.textContent = state.goal.met ? `Reached: ${m.text.replace(/^Goal:\s*/i, '')}` : m.text
        if (m.met) widget.dirty = true
        break
      case 'select':
        state.selected = { label: m.label, data: m.data }
        widget.dirty = true
        readLabel.textContent = m.label.charAt(0).toUpperCase() + m.label.slice(1)
        readout.classList.remove('empty')
        readout.hidden = false
        askPart.hidden = false
        break
      case 'error':
        if (phase === 'live') note(`The visual reported a problem: ${m.msg}`)
        break
    }
  }

  let noteEl: HTMLElement | null = null
  function note(text: string, action?: { label: string; run: () => void }) {
    noteEl?.remove()
    noteEl = h('p', { class: 'visual-note' }, text)
    if (action) noteEl.append(' ', button(action.label, action.run, 'quiet'))
    stage.after(noteEl)
  }

  function onDead(why: string) {
    if (dead) return
    frame?.stop()
    frame = null
    bar.hidden = true
    stage.style.height = `${height}px`
    stage.classList.add('parked')
    setPhase('done', 'Stopped')
    note(`Tide stopped this visual: ${why}`, { label: 'Run again', run: () => (noteEl?.remove(), showLive()) })
  }

  function showLive(checked?: FrameRun) {
    if (frame !== checked) frame?.stop()
    noteEl?.remove()
    stage.classList.remove('parked')
    stage.style.height = ''
    steps = null
    if (checked) {
      frame = checked
      checked.reveal({ onMessage, onDead })
    } else frame = startFrame(stage, code, true, { onMessage, onDead })
    frame.iframe.style.height = `${height}px`
    setPhase('live', 'Interactive visual')
    bar.hidden = false
    // Anything it does wrong from here on is reported in place, not repaired
    void frame.outcome.then((r) => {
      if (!r.ok && phase === 'live' && frame && r.errors.length && !dead) note(`The visual reported a problem: ${r.errors[0]}`)
    })
  }

  /** Runs it hidden; a frame that passes is kept, to be shown as it is */
  async function check(source: string): Promise<{ ok: boolean; errors: string[]; run?: FrameRun }> {
    return oneAtATime(async () => {
      if (dead) return { ok: false, errors: [] }
      const run = startFrame(stage, source, false, { onMessage: () => undefined, onDead: () => undefined })
      const r = await run.outcome
      if (r.ok && !dead && near) return { ...r, run }
      run.stop()
      return r
    })
  }

  async function begin() {
    const policy = await policyFor(scope)
    if (dead) return
    if (!policy.show) {
      setPhase('done', 'Not shown')
      note(policy.why ?? 'Visuals are not shown here.')
      return
    }
    const kept = lesson ? (await cachedFor(lesson))[key] : undefined
    if (dead) return
    if (kept?.status === 'ok') {
      code = kept.code ?? original
      verified = true
    } else if (kept?.status === 'fallback' && kept.fallback) return showFallback(kept.fallback)
    else if (kept?.status === 'failed') return showFailed(kept.errors ?? [])
    prepared = true
    if (near) void start()
  }

  async function start() {
    if (dead || phase !== 'waiting') return
    if (verified) return showLive()
    setPhase('checking', 'Checking the visual…')
    stage.style.height = `${height}px`
    stage.classList.add('pending')
    let r = await check(code)
    if (dead) return
    const policy = await policyFor(scope)
    if (!r.ok && policy.repair) {
      setPhase('fixing', 'Fixing the visual…')
      const fixed = await d()
        .api.repair({ code: original, errors: r.errors, scope })
        .catch(() => null)
      if (dead) return
      if (fixed?.code) {
        repaired = true
        code = fixed.code
        setPhase('checking', 'Checking the fixed visual…')
        r = await check(code)
        if (dead) return
      }
    }
    stage.classList.remove('pending')
    stage.style.height = ''
    if (r.ok) {
      verified = true
      void remember(lesson, key, { status: 'ok', ...(repaired ? { code } : {}), at: Date.now() }, code)
      if (r.run && near && !dead) return showLive(r.run)
      r.run?.stop()
      return near ? showLive() : setPhase('waiting', 'Interactive visual')
    }
    if (policy.repair) {
      setPhase('fixing', 'Drawing it another way…')
      const md = await d()
        .api.fallback({ code: original, title, scope })
        .catch(() => null)
      if (dead) return
      if (md) {
        void remember(lesson, key, { status: 'fallback', fallback: md, errors: r.errors, at: Date.now() })
        return showFallback(md)
      }
      void remember(lesson, key, { status: 'failed', errors: r.errors, at: Date.now() })
    }
    showFailed(r.errors)
  }

  function showFallback(md: string) {
    setPhase('done', 'Drawn another way')
    stage.classList.remove('pending')
    stage.classList.add('fallback')
    const box = h('div', { class: 'prose compact visual-fallback' })
    box.innerHTML = d().markdown(md)
    stage.replaceChildren(box)
    readout.hidden = true
    bar.hidden = true
  }

  function showFailed(errors: string[]) {
    setPhase('done', 'Could not be shown')
    stage.classList.remove('pending')
    stage.classList.add('failed')
    readout.hidden = true
    bar.hidden = true
    const details = h('details', { class: 'visual-code' }, h('summary', null, 'Show its code'), h('pre', null, original))
    stage.replaceChildren(h('p', { class: 'visual-note' }, `This visual didn’t run${errors[0] ? `: ${errors[0]}` : '.'}`), details)
  }

  function park() {
    if (phase !== 'live' || !frame) return
    restoreStep = steps?.i ?? 0
    frame.stop()
    frame = null
    stage.style.height = `${height}px`
    stage.classList.add('parked')
    setPhase('parked', 'Interactive visual')
  }

  // Near the screen: start, or come back; away for a moment: torn down
  const seen = new IntersectionObserver(
    (entries) => {
      near = entries[entries.length - 1].isIntersecting
      clearTimeout(awayTimer)
      if (near) {
        if (phase === 'waiting' && prepared) void start()
        else if (phase === 'parked') showLive()
      } else if (phase === 'live') awayTimer = setTimeout(park, timing.parkMs)
    },
    { rootMargin: '200px 0px' }
  )
  seen.observe(root)

  // Theme changes reach a live frame without reloading it
  const themeWatch = new MutationObserver(() => frame?.send({ t: 'theme', css: themeCss(d().theme(stage)) }))
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class', 'data-design'] })

  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !steps) return
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    if (e.key === 'ArrowRight') control('next')
    else if (e.key === 'ArrowLeft') control('back')
    else if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) control(playing ? 'pause' : 'play')
    else if (e.key === 'r' || e.key === 'R') doReset()
    else return
    e.preventDefault()
  })

  function destroy() {
    if (dead) return
    dead = true
    clearTimeout(awayTimer)
    clearTimeout(flashTimer)
    seen.disconnect()
    themeWatch.disconnect()
    frame?.stop()
    frame = null
    widgets.delete(widget)
  }

  void begin()
  return widget
}

// ---------- Blocks on the page ----------

const sourceOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''
const isVisualBlock = (pre: HTMLElement) => isVisualSource(pre.dataset.lang ?? '')
const keeper = createKeeper({ widget: 'figure.visual', isSource: isVisualBlock, sourceOf })

/** When each block's text was first seen as it is now: a block still streaming keeps changing */
const firstSeen = new WeakMap<HTMLElement, { code: string; at: number }>()
let rescan: ReturnType<typeof setTimeout> | undefined

export function scanVisuals(): void {
  keeper.reclaim()
  const now = Date.now()
  let waiting = false
  document.querySelectorAll<HTMLElement>('pre.code-block').forEach((pre) => {
    if (!isVisualBlock(pre)) return
    const code = sourceOf(pre)
    if (!looksComplete(code) || pre.dataset.visualTried === code) return
    const seen = firstSeen.get(pre)
    if (!seen || seen.code !== code) {
      firstSeen.set(pre, { code, at: now })
      waiting = true
      return
    }
    if (now - seen.at < timing.settleMs) {
      waiting = true
      return
    }
    pre.dataset.visualTried = code
    const slot = keeper.slot(pre)
    const w = mountVisual(code, pre, (root) => pre.replaceWith(root))
    keeper.keep(slot, w.root, w.destroy)
  })
  if (waiting) {
    clearTimeout(rescan)
    rescan = setTimeout(scanVisuals, timing.settleMs + 50)
  }
}

/** Watches the whole document; call once at startup */
export function startVisuals(): void {
  watchBlocks(keeper, scanVisuals)
  // Main stopped a frame (memory, a busy core): the widget showing it says so
  d().api?.onKilled?.((e) => running.get(e.host)?.(e.reason))
  scanVisuals()
}
