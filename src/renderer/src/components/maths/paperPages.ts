import { CHAT_IMAGES, readImageFile } from '../../lib/pastedImages'

/** The longest edge a page is kept at: enough for small handwriting, small enough to send quickly */
const PAGE_EDGE = 2200

/** A data: URL's bytes (the page's policy doesn't let fetch read data: URLs) */
function blobOf(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2)
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'image/jpeg'
  if (!/;base64/.test(head)) return new Blob([decodeURIComponent(body)], { type })
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

const stamp = () => {
  const d = new Date()
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('')
}

/**
 * A photo of working made ready: turned upright (a phone's photo carries its rotation separately,
 * and the page and Claude must see the same pixels for the line boxes to land), scaled down,
 * saved as a JPEG in the vault's chat images. Returns its vault path.
 */
export async function savePage(source: File | string): Promise<string> {
  const dataUrl = typeof source === 'string' ? source : await readImageFile(source)
  const blob = blobOf(dataUrl)
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const scale = Math.min(1, PAGE_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const jpeg = canvas.toDataURL('image/jpeg', 0.9)
  const path = `${CHAT_IMAGES}/Working ${stamp()}${Math.random().toString(36).slice(2, 4)}.jpg`
  await window.tide.vault.writeImage(path, jpeg)
  return path
}

/** A frame from a camera, at its full size */
export async function grabFrame(video: HTMLVideoElement, track?: MediaStreamTrack): Promise<string> {
  // A still from the camera itself is sharper than a video frame, where the browser offers it
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture
  if (IC && track) {
    try {
      const blob = await new IC(track).takePhoto()
      return await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = () => rej(r.error)
        r.readAsDataURL(blob)
      })
    } catch {
      // fall back to the video frame
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/** An iPhone (or iPad) offered as a camera through Continuity Camera, by the name macOS gives it */
export const isPhoneCamera = (label: string) => /iphone|ipad|continuity/i.test(label) && !/desk view/i.test(label)
