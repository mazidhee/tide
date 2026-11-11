/**
 * How long the window takes to draw each answer as it streams: frame by frame from the first word
 * to the last: how many frames, how long past their budget, and the longest. Reported with the turn, for
 * Settings › Speed.
 */
type Meter = { frames: number; totalMs: number; longestMs: number; last: number; raf: number }

const FRAME = 1000 / 60
const meters = new Map<string, Meter>()

function start(id: string) {
  const m: Meter = { frames: 0, totalMs: 0, longestMs: 0, last: performance.now(), raf: 0 }
  const tick = (now: number) => {
    const dt = now - m.last
    m.last = now
    // A hidden window draws nothing, so a long gap there is not the window being busy
    if (dt < 1000 && document.visibilityState === 'visible') {
      m.frames++
      // Time beyond a frame's budget is time the window was busy
      m.totalMs += Math.max(0, dt - FRAME)
      m.longestMs = Math.max(m.longestMs, dt)
    }
    m.raf = requestAnimationFrame(tick)
  }
  m.raf = requestAnimationFrame(tick)
  meters.set(id, m)
}

function finish(id: string) {
  const m = meters.get(id)
  if (!m) return
  cancelAnimationFrame(m.raf)
  meters.delete(id)
  window.tide.speed.render(id, { frames: m.frames, totalMs: Math.round(m.totalMs), longestMs: Math.round(m.longestMs) }).catch(() => {})
}

/** Starts measuring every streamed answer; returns the way to stop */
export function measureRendering(): () => void {
  return window.tide.ai.onEvent((e) => {
    if (e.type === 'delta' && !meters.has(e.id)) start(e.id)
    else if (e.type === 'done' || e.type === 'error') finish(e.id)
  })
}
