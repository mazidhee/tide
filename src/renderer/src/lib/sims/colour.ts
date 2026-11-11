/**
 * Colours for canvas drawing, read from the theme's CSS tokens so every theme works. The
 * diverging pair (--sim-neg orange, --sim-pos blue) is defined in sims.css per colour scheme.
 */
export type RGB = [number, number, number]

export interface Palette {
  pos: RGB
  neg: RGB
  bg: RGB
  ink: RGB
  accent: RGB
  /** Ready-to-use CSS colours for strokes and text */
  css: { pos: string; neg: string; bg: string; ink: string; soft: string; muted: string; accent: string; line: string; lineStrong: string }
  font: string
}

let scratch: CanvasRenderingContext2D | null = null

/** Any CSS colour → 0–255 RGB, by painting one pixel (so color-mix, light-dark and friends all work) */
function toRgb(colour: string): RGB {
  scratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!scratch) return [128, 128, 128]
  scratch.canvas.width = scratch.canvas.height = 1
  scratch.fillStyle = '#808080'
  scratch.fillStyle = colour
  scratch.fillRect(0, 0, 1, 1)
  const d = scratch.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

export function readPalette(el: HTMLElement): Palette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  el.appendChild(probe)
  const read = (token: string) => {
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color
  }
  const css = {
    pos: read('--sim-pos'),
    neg: read('--sim-neg'),
    bg: read('--bg-raised'),
    ink: read('--ink'),
    soft: read('--ink-soft'),
    muted: read('--ink-muted'),
    accent: read('--accent'),
    line: read('--line'),
    lineStrong: read('--line-strong')
  }
  const font = getComputedStyle(el).fontFamily
  probe.remove()
  return { pos: toRgb(css.pos), neg: toRgb(css.neg), bg: toRgb(css.bg), ink: toRgb(css.ink), accent: toRgb(css.accent), css, font }
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const rgb = (c: RGB, alpha = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`

/** t in [-1, 1]: orange for negative, the surface colour at zero, blue for positive */
export function diverging(p: Palette, t: number, strength = 0.85): RGB {
  const c = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0))
  return mix(p.bg, c < 0 ? p.neg : p.pos, Math.abs(c) * strength)
}
