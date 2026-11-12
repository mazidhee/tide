/**
 * Talking to YouTube's embedded player with its documented iframe postMessage protocol, without
 * loading YouTube's iframe_api script (so the window's script-src stays 'self').
 *
 * The embed is opened with enablejsapi=1. Tide says it's listening ({"event":"listening"}) until
 * the player answers; from then on the player sends JSON messages: onReady, infoDelivery (with
 * currentTime, duration, playerState, playbackRate as they change), onStateChange, onError. Tide
 * sends {"event":"command","func":"seekTo","args":[…]} and the like. A message is only taken from
 * the iframe this bridge drives, and only from YouTube's origins.
 */

export const EMBED_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com']

/** YouTube's player states */
export const STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const

export interface PlayerInfo {
  currentTime?: number
  duration?: number
  playerState?: number
  playbackRate?: number
  availablePlaybackRates?: number[]
  muted?: boolean
  volume?: number
}

export type PlayerEvent = { kind: 'ready' } | { kind: 'info'; info: PlayerInfo } | { kind: 'state'; state: number } | { kind: 'rate'; rate: number } | { kind: 'error'; code: number }

/** The embed's address: privacy-enhanced (youtube-nocookie), with the JS API on */
export function embedUrl(id: string, { start, autoplay = true, origin }: { start?: number; autoplay?: boolean; origin?: string } = {}): string {
  const q = new URLSearchParams({ enablejsapi: '1', rel: '0', playsinline: '1', modestbranding: '1', iv_load_policy: '3' })
  if (autoplay) q.set('autoplay', '1')
  if (start && start > 0) q.set('start', String(Math.floor(start)))
  // Only a real web origin: a page loaded from file:// has none to give
  if (origin && /^https?:\/\//.test(origin)) q.set('origin', origin)
  return `https://www.youtube-nocookie.com/embed/${id}?${q}`
}

/** One message from the player, read; null when it isn't one of YouTube's (or isn't for us) */
export function readMessage(data: unknown): PlayerEvent | null {
  let msg: { event?: string; info?: unknown } | null = null
  if (typeof data === 'string') {
    if (!data.startsWith('{')) return null
    try {
      msg = JSON.parse(data)
    } catch {
      return null
    }
  } else if (data && typeof data === 'object') msg = data as { event?: string; info?: unknown }
  if (!msg || typeof msg.event !== 'string') return null
  const info = msg.info
  switch (msg.event) {
    case 'onReady':
      return { kind: 'ready' }
    case 'initialDelivery':
    case 'infoDelivery': {
      if (!info || typeof info !== 'object') return null
      const i = info as Record<string, unknown>
      const out: PlayerInfo = {}
      if (typeof i.currentTime === 'number' && Number.isFinite(i.currentTime)) out.currentTime = i.currentTime
      if (typeof i.duration === 'number' && i.duration > 0) out.duration = i.duration
      if (typeof i.playerState === 'number') out.playerState = i.playerState
      if (typeof i.playbackRate === 'number' && i.playbackRate > 0) out.playbackRate = i.playbackRate
      if (Array.isArray(i.availablePlaybackRates)) out.availablePlaybackRates = i.availablePlaybackRates.filter((r): r is number => typeof r === 'number')
      if (typeof i.muted === 'boolean') out.muted = i.muted
      if (typeof i.volume === 'number') out.volume = i.volume
      return Object.keys(out).length ? { kind: 'info', info: out } : null
    }
    case 'onStateChange':
      return typeof info === 'number' ? { kind: 'state', state: info } : null
    case 'onPlaybackRateChange':
      return typeof info === 'number' ? { kind: 'rate', rate: info } : null
    case 'onError':
      return { kind: 'error', code: typeof info === 'number' ? info : 0 }
    default:
      return null
  }
}

/** What an error code means, said plainly */
export function errorText(code: number): string {
  if (code === 101 || code === 150 || code === 152 || code === 153) return 'The video’s owner doesn’t allow it to be played inside other apps.'
  if (code === 100) return 'This video has been removed or made private.'
  if (code === 2) return 'That isn’t a video YouTube can play.'
  if (code === 5) return 'The player couldn’t play this video.'
  return 'The player couldn’t load this video.'
}

interface Target {
  postMessage(message: string, targetOrigin: string): void
}

let ids = 0

/**
 * Drives one embedded player. `target` gives the iframe's window (null once it's gone); `emit`
 * hears what the player says. The bridge keeps the last known time, length, state and speed.
 */
export class YouTubeBridge {
  readonly id = ++ids
  ready = false
  time = 0
  duration = 0
  state: number = STATE.unstarted
  rate = 1
  rates: number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  /** When `time` was last heard, to estimate it between updates */
  private heardAt = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private queue: string[] = []
  private disposed = false

  constructor(
    private target: () => (Target & object) | null,
    private emit: (e: PlayerEvent) => void,
    private now: () => number = () => performance.now()
  ) {}

  /** Starts the handshake: "listening" until the player answers (every 250 ms, for up to 15 s) */
  start() {
    let tries = 0
    const say = () => {
      if (this.ready || this.disposed || ++tries > 60) return clearInterval(this.timer)
      this.post({ event: 'listening', id: this.id, channel: 'widget' })
    }
    say()
    this.timer = setInterval(say, 250)
  }

  /** A message the window received: true when it was this player's and was used */
  handle(ev: { origin: string; source: unknown; data: unknown }): boolean {
    if (this.disposed || !EMBED_ORIGINS.includes(ev.origin)) return false
    const target = this.target()
    if (!target || ev.source !== target) return false
    const e = readMessage(ev.data)
    if (!e) return false
    if (e.kind === 'ready' || (!this.ready && e.kind === 'info')) {
      if (!this.ready) {
        this.ready = true
        clearInterval(this.timer)
        // Events to hear, then whatever was asked for before the player was ready
        for (const name of ['onStateChange', 'onPlaybackRateChange', 'onError']) this.post({ event: 'command', func: 'addEventListener', args: [name], id: this.id, channel: 'widget' })
        for (const q of this.queue.splice(0)) this.send(q)
        this.emit({ kind: 'ready' })
      }
      if (e.kind === 'ready') return true
    }
    if (e.kind === 'info') {
      const i = e.info
      if (i.currentTime !== undefined) {
        this.time = i.currentTime
        this.heardAt = this.now()
      }
      if (i.duration !== undefined) this.duration = i.duration
      if (i.playerState !== undefined) this.state = i.playerState
      if (i.playbackRate !== undefined) this.rate = i.playbackRate
      if (i.availablePlaybackRates?.length) this.rates = i.availablePlaybackRates
    } else if (e.kind === 'state') this.state = e.state
    else if (e.kind === 'rate') this.rate = e.rate
    this.emit(e)
    return true
  }

  /** The time now: the last heard, carried forward while it plays */
  currentTime(): number {
    if (this.state !== STATE.playing || !this.heardAt) return this.time
    return this.time + ((this.now() - this.heardAt) / 1000) * this.rate
  }

  command(func: string, args: unknown[] = []) {
    const msg = JSON.stringify({ event: 'command', func, args, id: this.id, channel: 'widget' })
    if (this.ready) this.send(msg)
    else this.queue.push(msg)
  }

  play = () => this.command('playVideo')
  pause = () => this.command('pauseVideo')
  seek(t: number) {
    const to = Math.max(0, this.duration ? Math.min(t, this.duration - 0.5) : t)
    this.time = to
    this.heardAt = this.now()
    this.command('seekTo', [to, true])
  }
  setRate(r: number) {
    this.rate = r
    this.command('setPlaybackRate', [r])
  }
  toggle() {
    if (this.state === STATE.playing || this.state === STATE.buffering) this.pause()
    else this.play()
  }

  dispose() {
    this.disposed = true
    clearInterval(this.timer)
    this.queue = []
  }

  private post(msg: object) {
    this.send(JSON.stringify(msg))
  }
  private send(msg: string) {
    const t = this.target()
    if (!t) return
    try {
      // Only ever to the privacy-enhanced player's origin, which embedUrl always uses
      t.postMessage(msg, EMBED_ORIGINS[0])
    } catch {
      // the frame went away
    }
  }
}
