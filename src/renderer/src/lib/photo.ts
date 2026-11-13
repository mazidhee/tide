/**
 * Your profile photo in the renderer: read a file or a camera frame, keep a scaled-down copy, and
 * draw the framed circle (shared/avatarCrop) at the sizes Tide stores. Nothing leaves this Mac.
 */
import { cropRect } from '@shared/avatarCrop'
import type { Crop } from '@shared/profile'

/** The longest side of the photo kept for framing again */
export const SOURCE_MAX = 1600
/** The framed photo's side, as stored and shown */
export const PHOTO_SIDE = 256

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That picture could not be read.'))
    img.src = src
  })
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('That file could not be read.'))
    r.readAsDataURL(file)
  })

/** A picture drawn to a canvas no larger than `max` on its long side */
function scaled(src: CanvasImageSource & { width: number; height: number }, w: number, h: number, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/** A chosen or dropped file as a scaled-down JPEG data URL */
export async function fileToSource(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.')
  const img = await loadImage(await readAsDataUrl(file))
  return scaled(img, img.naturalWidth, img.naturalHeight, SOURCE_MAX).toDataURL('image/jpeg', 0.9)
}

/** A camera frame as a scaled-down JPEG data URL, mirrored as you saw it */
export function videoToSource(video: HTMLVideoElement): string {
  const w = video.videoWidth
  const h = video.videoHeight
  const k = Math.min(1, SOURCE_MAX / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * k)
  c.height = Math.round(h * k)
  const ctx = c.getContext('2d')!
  ctx.translate(c.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.9)
}

/** The framed square of the photo, drawn at side × side */
export function framed(img: HTMLImageElement, crop: Crop, side = PHOTO_SIDE): HTMLCanvasElement {
  const r = cropRect(img.naturalWidth, img.naturalHeight, crop)
  const c = document.createElement('canvas')
  c.width = side
  c.height = side
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, r.x, r.y, r.size, r.size, 0, 0, side, side)
  return c
}

/** The framed photo as stored: a small JPEG data URL */
export const framedPhoto = (img: HTMLImageElement, crop: Crop) => framed(img, crop).toDataURL('image/jpeg', 0.88)

/** The framed photo's pixels, for the pixeliser */
export function framedPixels(img: HTMLImageElement, crop: Crop): ImageData {
  const c = framed(img, crop)
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
}
