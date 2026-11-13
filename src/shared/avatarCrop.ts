/**
 * Framing a photo in a circle. The visible square has side min(w, h) / zoom, so zoom 1 shows the
 * whole short side; the offset moves its centre from the image's centre, in units of that side.
 * Clamped so the square never leaves the photo.
 */
import type { Crop } from './profile'

export interface Rect {
  x: number
  y: number
  size: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/** The offsets that keep the square inside the photo, for a zoom */
export function offsetLimits(w: number, h: number, zoom: number): { x: number; y: number } {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  const side = Math.min(w, h) / z
  return { x: Math.max(0, (w - side) / 2 / side), y: Math.max(0, (h - side) / 2 / side) }
}

/** A crop pulled back inside the photo */
export function clampCrop(w: number, h: number, c: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(c.zoom) ? c.zoom : 1))
  const lim = offsetLimits(w, h, zoom)
  const fix = (v: number, m: number) => (Number.isFinite(v) ? Math.min(m, Math.max(-m, v)) : 0)
  return { zoom, x: fix(c.x, lim.x), y: fix(c.y, lim.y) }
}

/** The square of the photo the circle shows, in the photo's pixels */
export function cropRect(w: number, h: number, crop: Crop): Rect {
  const c = clampCrop(w, h, crop)
  const size = Math.min(w, h) / c.zoom
  return { x: w / 2 + c.x * size - size / 2, y: h / 2 + c.y * size - size / 2, size }
}

/**
 * Dragging the photo by (dx, dy) screen pixels in a circle `diameter` across: the photo follows
 * the pointer, so the visible square moves the other way.
 */
export function dragCrop(w: number, h: number, crop: Crop, dx: number, dy: number, diameter: number): Crop {
  return clampCrop(w, h, { ...crop, x: crop.x - dx / diameter, y: crop.y - dy / diameter })
}

/** Zooming about the centre of the circle, keeping what's in the middle where it is */
export function zoomCrop(w: number, h: number, crop: Crop, zoom: number): Crop {
  return clampCrop(w, h, { ...crop, zoom })
}

/** Where the photo sits behind a circle `diameter` across, for drawing the preview with CSS */
export function previewBox(w: number, h: number, crop: Crop, diameter: number): { left: number; top: number; width: number; height: number } {
  const r = cropRect(w, h, crop)
  const scale = diameter / r.size
  return { left: -r.x * scale, top: -r.y * scale, width: w * scale, height: h * scale }
}
