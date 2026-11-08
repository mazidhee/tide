import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { thumbPath } from '@shared/thumbs'
import { vaultUrl } from './markdown'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

let queue: Promise<unknown> = Promise.resolve()

/**
 * Renders a PDF's first page to a JPEG cover and caches it next to the other library covers.
 * Runs one PDF at a time so a shelf of large books doesn't stall the window.
 */
export function pdfCover(path: string, width = 480): Promise<string | null> {
  const job = queue.then(async () => {
    const doc = await pdfjs.getDocument({ url: vaultUrl(path), disableAutoFetch: true, disableStream: false }).promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const to = thumbPath(path)
      await window.tide.vault.writeImage(to, canvas.toDataURL('image/jpeg', 0.82))
      return to
    } finally {
      doc.destroy()
    }
  })
  queue = job.catch(() => null)
  return job.catch(() => null)
}
