/**
 * What all the video players on screen share: only one plays at a time (starting one puts any
 * other back to its thumbnail, which removes its iframe), where you left off in each video, the
 * speed you like, the cinema layout, and timestamp links that seek a player on the page instead of
 * opening the browser.
 */
import { linkTime, youtubeIdOf } from '@shared/video'

export interface PlayerHandle {
  /** youtube id, or "file:<path>" */
  key: string
  /** Puts it back to its thumbnail (the iframe goes) */
  stop(): void
  /** Seeks to `t` and plays, opening the player first if it is a thumbnail; a negative `t` plays from where it is (or where you left off) */
  playAt(t: number): void
  /** The element, to bring into view */
  el(): HTMLElement | null
}

const players = new Set<PlayerHandle>()
let current: PlayerHandle | null = null

export function register(p: PlayerHandle): () => void {
  players.add(p)
  return () => {
    players.delete(p)
    if (current === p) current = null
  }
}

/** `p` starts playing: whichever other player was open goes back to its thumbnail */
export function activate(p: PlayerHandle) {
  if (current && current !== p) current.stop()
  current = p
}

export function deactivate(p: PlayerHandle) {
  if (current === p) current = null
}

/** How many players have an iframe or a video open (for tests and the memory check) */
export const openPlayers = () => (current ? 1 : 0)

// ---------- Remembered per viewer ----------

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // private or blocked storage: nothing is remembered
    }
  }
}

const POS = 'tide.video.pos:'

/** Where you left off, when it's worth resuming (past the first 10 s, before the last 15 s) */
export function resumeAt(key: string, duration?: number): number | null {
  const v = Number(store.get(POS + key))
  if (!Number.isFinite(v) || v < 10) return null
  if (duration && v > duration - 15) return null
  return v
}

export function rememberPosition(key: string, t: number, duration?: number) {
  // Finished (or nearly): next time starts from the beginning
  if (duration && t > duration - 15) store.set(POS + key, null)
  else if (t >= 10) store.set(POS + key, String(Math.floor(t)))
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

export function preferredRate(): number {
  const r = Number(store.get('tide.video.rate'))
  return RATES.includes(r) ? r : 1
}
export const rememberRate = (r: number) => store.set('tide.video.rate', String(r))

/** Cinema: a playing video spans the page on a dark band. On unless you turn it off */
export const cinemaOn = () => store.get('tide.video.cinema') !== 'off'
export const rememberCinema = (on: boolean) => store.set('tide.video.cinema', on ? 'on' : 'off')

// ---------- Timestamp links ----------

/** The player a link is for (a YouTube link to a video on the page), with the moment it names (-1: none, so where you left off) */
export function playerFor(href: string): { player: PlayerHandle; at: number } | null {
  const id = youtubeIdOf(href)
  if (!id) return null
  const at = linkTime(href) ?? -1
  const mine = [...players].filter((p) => p.key === id)
  if (!mine.length) return null
  // The one already open, else the first on the page
  return { player: mine.find((p) => p === current) ?? mine[0], at }
}

let listening = false

/** Once, for the whole window: a click on a link to a video that's on the page plays it there (at the link's moment) instead of opening the browser */
export function listenForTimestampLinks() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const found = playerFor(a.getAttribute('href') ?? '')
      if (!found) return
      e.preventDefault()
      e.stopPropagation()
      found.player.playAt(found.at)
      const el = found.player.el()
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.bottom < 60 || r.top > window.innerHeight - 60) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    },
    true
  )
}
