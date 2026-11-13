/**
 * Maths animations in the page (shared/manim, main/manim): each ```animation block becomes a
 * video in Tide's simulation frame. The lesson's text is there first; the block shows the
 * render's progress and slots the video in when it is ready. Captions follow the narration beat
 * by beat, the transcript can be opened and clicked to jump, and narration can be muted. When
 * Manim isn't installed, the first lesson to use it offers the install once; otherwise (and when
 * a render fails) the narration is shown as numbered steps, so nothing is lost.
 */
import { captionAt, isAnimationSource, paletteFrom, parseAnimationBlock, type AnimStatus, type Caption } from '@shared/manim'
import { templateById } from '@shared/manimTemplates'
import { createKeeper, watchBlocks } from '../liveBlocks'
import { button, h } from '../sims/dom'
import { ask, readTheme } from '../visuals'
import { PATHS } from '../../components/Icon'

type Api = Window['tide']['manim']

const sourceOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''
const isAnimationBlock = (pre: HTMLElement) => isAnimationSource(pre.dataset.lang ?? '')
const keeper = createKeeper({ widget: 'figure.anim', isSource: isAnimationBlock, sourceOf })

let api: Api | null = null
const live = new Map<string, Set<(s: AnimStatus) => void>>()
const mounted = new Set<{ refresh(): void }>()

function icon(path: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v))
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  svg.append(p)
  return svg
}
const MUTED_PATH = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5'

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const lessonOf = (el: Element) => el.closest<HTMLElement>('[data-visual-lesson]')?.dataset.visualLesson || ''

/** The narration as numbered steps: what shows while it renders, without Manim, and if it fails */
function steps(captions: Caption[] | undefined): HTMLElement {
  return h('ol', { class: 'anim-steps' }, ...(captions ?? []).map((c) => h('li', null, c.text)))
}

export interface Widget {
  root: HTMLElement
  destroy(): void
}

/** One animation block: its frame, kept up to date with the render, then the player */
export function mountAnimation(source: string, at: Element): Widget {
  const parsed = parseAnimationBlock(source.trim())
  const template = parsed.ok && parsed.block.template ? templateById(parsed.block.template) : null
  const title = (parsed.ok && parsed.block.title) || template?.title || 'Animation'
  const root = h('figure', { class: 'sim anim', role: 'group', 'aria-label': `Animation: ${title}`, 'data-state': 'queued' })
  const status = h('span', { class: 'sim-kind anim-status', 'aria-live': 'polite' }, 'Animation')
  root.append(h('figcaption', { class: 'sim-head' }, h('span', { class: 'sim-title' }, title), status))
  const stage = h('div', { class: 'anim-stage' })
  const body = h('div', { class: 'sim-body anim-body' }, stage)
  root.append(body)
  let key = ''
  let destroyed = false
  let unlisten: (() => void) | null = null
  let player: { destroy(): void } | null = null
  let shownState = ''
  let progress: { set(f: number, label: string): void } | null = null

  const listen = (k: string) => {
    unlisten?.()
    if (!k) return
    const fns = live.get(k) ?? new Set()
    const fn = (s: AnimStatus) => show(s)
    fns.add(fn)
    live.set(k, fns)
    unlisten = () => {
      fns.delete(fn)
      if (!fns.size) live.delete(k)
    }
  }

  function pending(s: AnimStatus) {
    if (shownState !== 'pending') {
      shownState = 'pending'
      stage.replaceChildren()
      const bar = h('div', { class: 'anim-progress-fill' })
      const label = h('span', { class: 'anim-progress-label' })
      stage.append(h('div', { class: 'anim-placeholder' }, h('div', { class: 'anim-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), label))
      progress = {
        set(f, text) {
          bar.style.transform = `scaleX(${Math.max(0.03, Math.min(1, f))})`
          bar.parentElement!.setAttribute('aria-valuenow', String(Math.round(f * 100)))
          label.textContent = text
        }
      }
    }
    progress?.set(s.progress, s.state === 'repairing' ? 'Fixing the scene…' : s.label || 'Rendering…')
    status.textContent = s.state === 'queued' ? 'Waiting to render' : `Rendering ${Math.round(s.progress * 100)}%`
  }

  async function offer(s: AnimStatus) {
    shownState = 'offer'
    stage.replaceChildren()
    const st = await api!.status().catch(() => null)
    if (destroyed) return
    const list = steps(s.captions)
    status.textContent = 'Not installed'
    if (st && !st.settings.prompted) {
      const line = h('p', { class: 'anim-offer-text' }, 'Tide can play this as a short narrated animation. It needs Manim on this Mac: about 135 MB to download, 350 MB on disk, once.')
      const progressLine = h('p', { class: 'anim-offer-progress', 'aria-live': 'polite' })
      const install = button('Install maths animations (about 135 MB)', () => void doInstall(), 'primary')
      const later = button('Not now', () => {
        void api!.settings({ prompted: true })
        card.replaceWith(h('p', { class: 'anim-note' }, 'You can install it any time in Settings › Tools.'))
      }, 'quiet')
      const card = h('div', { class: 'anim-offer' }, h('p', { class: 'anim-offer-title' }, 'Watch this as an animation'), line, h('div', { class: 'anim-offer-actions' }, install, later), progressLine)
      const doInstall = async () => {
        install.disabled = later.disabled = true
        install.textContent = 'Installing…'
        const off = api!.onInstallProgress((t) => (progressLine.textContent = t))
        const r = await api!.install().catch((e) => ({ ready: false, detail: String((e as Error).message ?? e) }))
        off()
        void api!.settings({ prompted: true })
        if (r.ready) {
          for (const w of mounted) w.refresh()
          return
        }
        progressLine.textContent = r.detail
        install.disabled = later.disabled = false
        install.textContent = 'Try again'
      }
      stage.append(card)
    } else stage.append(h('p', { class: 'anim-note' }, 'Install maths animations in Settings › Tools to watch this as a video.'))
    if (s.captions?.length) stage.append(list)
  }

  function failed(s: AnimStatus) {
    shownState = 'failed'
    status.textContent = 'Couldn’t render'
    stage.replaceChildren(h('p', { class: 'anim-note' }, s.error ? `It couldn’t be rendered: ${s.error.split('\n').pop()}` : 'It couldn’t be rendered.'), steps(s.captions))
  }

  function ready(s: AnimStatus) {
    if (shownState === `ready:${s.video}`) return
    shownState = `ready:${s.video}`
    player?.destroy()
    stage.replaceChildren()
    player = mountPlayer(stage, s, title, status, () => {
      if (template?.explore || parsed.ok) ask(root, `I watched "${title}". Now let me try it myself: give me the explorable to break it.`, () => {})
    }, template?.explore ? 'Now try it yourself' : 'Ask about it')
  }

  function show(s: AnimStatus) {
    if (destroyed) return
    root.dataset.state = s.state
    if (s.state === 'ready' && s.video) ready(s)
    else if (s.state === 'unavailable') void offer(s)
    else if (s.state === 'failed') failed(s)
    else pending(s)
  }

  async function request() {
    if (!parsed.ok) return failed({ key: '', state: 'failed', progress: 0, label: '', error: parsed.error })
    api = window.tide?.manim ?? api
    if (!api) return
    const palette = paletteFrom(readTheme(root.isConnected ? root : at))
    const s = await api.request({ block: source.trim(), lesson: lessonOf(at), palette }).catch((e) => ({ key: '', state: 'failed' as const, progress: 0, label: '', error: String((e as Error).message ?? e) }))
    if (destroyed || !s) return
    key = s.key
    listen(key)
    show(s)
  }

  const self = { refresh: () => void request() }
  mounted.add(self)
  void request()
  return {
    root,
    destroy() {
      destroyed = true
      unlisten?.()
      player?.destroy()
      mounted.delete(self)
    }
  }
}

/** The player: the video, its own controls, captions over it, and the transcript */
function mountPlayer(stage: HTMLElement, s: AnimStatus, title: string, status: HTMLElement, onTry: () => void, tryText: string): { destroy(): void } {
  const video = h('video', { class: 'anim-video', src: s.video!, preload: 'auto', playsinline: true, 'aria-label': title }) as HTMLVideoElement
  const caps = s.captions ?? []
  const caption = h('p', { class: 'anim-caption', 'aria-live': 'off' })
  const screen = h('div', { class: 'anim-screen' }, video)
  const playBtn = h('button', { type: 'button', class: 'sim-btn square anim-play', 'aria-label': 'Play' }, icon(PATHS.play))
  const scrub = h('input', { type: 'range', class: 'sim-range anim-scrub', min: 0, max: 1000, value: 0, 'aria-label': 'Position' }) as HTMLInputElement
  const clock = h('span', { class: 'anim-time' }, `0:00 / ${time(s.seconds ?? 0)}`)
  const muteBtn = h('button', { type: 'button', class: 'sim-btn square quiet anim-mute', 'aria-label': 'Mute narration', 'aria-pressed': 'false', hidden: !s.narrated }, icon(PATHS.speaker))
  const ccBtn = h('button', { type: 'button', class: 'sim-btn quiet anim-cc', 'aria-pressed': 'true', title: 'Captions' }, 'CC')
  const lines = caps.map((c) => {
    const li = h('li', null, h('span', { class: 'anim-t' }, time(c.start)), h('span', null, c.text))
    li.addEventListener('click', () => {
      video.currentTime = c.start + 0.01
      void video.play()
    })
    return li
  })
  const transcript = h('details', { class: 'anim-transcript' }, h('summary', null, 'Transcript'), h('ol', null, ...lines))
  const tryBtn = button(tryText, onTry, 'quiet anim-try')
  const bar = h('div', { class: 'anim-bar' }, playBtn, scrub, clock, muteBtn, ccBtn)
  stage.append(screen, caption, bar, h('div', { class: 'anim-foot' }, transcript, tryBtn))

  let mutedPref = false
  try {
    mutedPref = localStorage.getItem('tide.anim.muted') === '1'
  } catch {
    // no storage: narration on
  }
  let showCaptions = true
  try {
    showCaptions = localStorage.getItem('tide.anim.captions') !== '0'
  } catch {
    // captions on
  }
  const setMuted = (m: boolean) => {
    video.muted = m
    muteBtn.replaceChildren(icon(m ? MUTED_PATH : PATHS.speaker))
    muteBtn.setAttribute('aria-pressed', String(m))
    muteBtn.setAttribute('aria-label', m ? 'Turn narration on' : 'Mute narration')
  }
  const setCaptions = (on: boolean) => {
    showCaptions = on
    ccBtn.setAttribute('aria-pressed', String(on))
    caption.hidden = !on
  }
  setMuted(mutedPref)
  setCaptions(showCaptions)
  status.textContent = `${s.narrated ? 'Narrated' : 'Captioned'} animation · ${time(s.seconds ?? 0)}`

  let used = false
  const tick = () => {
    const t = video.currentTime
    const d = video.duration || s.seconds || 1
    if (document.activeElement !== scrub) scrub.value = String(Math.round((t / d) * 1000))
    clock.textContent = `${time(t)} / ${time(d)}`
    const c = captionAt(caps, t)
    caption.textContent = c?.text ?? ''
    caption.classList.toggle('empty', !c)
    lines.forEach((li, i) => li.classList.toggle('now', caps[i] === c))
    if (!used && t / d > 0.5) {
      used = true
      void window.tide?.manim?.used(s.key)
    }
  }
  const playing = () => {
    playBtn.replaceChildren(icon(video.paused ? PATHS.play : PATHS.pause))
    playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause')
  }
  video.addEventListener('timeupdate', tick)
  video.addEventListener('loadedmetadata', tick)
  video.addEventListener('play', playing)
  video.addEventListener('pause', playing)
  video.addEventListener('ended', playing)
  const toggle = () => (video.paused ? void video.play() : video.pause())
  playBtn.addEventListener('click', toggle)
  video.addEventListener('click', toggle)
  scrub.addEventListener('input', () => {
    video.currentTime = (Number(scrub.value) / 1000) * (video.duration || s.seconds || 0)
    tick()
  })
  muteBtn.addEventListener('click', () => {
    setMuted(!video.muted)
    try {
      localStorage.setItem('tide.anim.muted', video.muted ? '1' : '0')
    } catch {
      // kept for this video only
    }
  })
  ccBtn.addEventListener('click', () => {
    setCaptions(!showCaptions)
    try {
      localStorage.setItem('tide.anim.captions', showCaptions ? '1' : '0')
    } catch {
      // kept for this video only
    }
  })
  // The first frame stands in for a poster: the first caption shows before it plays
  caption.textContent = caps[0]?.text ?? ''
  return {
    destroy() {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }
}

async function renderBlock(pre: HTMLElement): Promise<void> {
  const code = sourceOf(pre)
  if (!code.trim() || pre.dataset.animTried === code) return
  // Still streaming: wait for the whole object
  try {
    JSON.parse(code)
  } catch {
    return
  }
  pre.dataset.animTried = code
  const slot = keeper.slot(pre)
  const w = mountAnimation(code, pre)
  pre.replaceWith(w.root)
  keeper.keep(slot, w.root, w.destroy)
}

function scan(): void {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block').forEach((pre) => {
    if (isAnimationBlock(pre)) void renderBlock(pre)
  })
}

/** Watches the whole document; call once at startup */
export function startAnimations(): void {
  api = window.tide?.manim ?? null
  api?.onStatus((s) => live.get(s.key)?.forEach((fn) => fn(s)))
  // A new theme draws them again in its colours
  let soon: ReturnType<typeof setTimeout> | undefined
  new MutationObserver(() => {
    clearTimeout(soon)
    soon = setTimeout(() => {
      for (const w of mounted) w.refresh()
    }, 400)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'style'] })
  watchBlocks(keeper, scan)
  scan()
}
