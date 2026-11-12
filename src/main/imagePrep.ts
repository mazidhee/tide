/**
 * Pictures made ready for a model: a photo of handwritten working, a screenshot, a diagram from a
 * note. Claude takes PNG, JPEG, GIF and WebP up to about 5 MB each, and sees no more detail past
 * 1568 px on the long edge, so anything bigger (or an iPhone HEIC) is converted with macOS's own
 * `sips` to a JPEG that fits. A few per message at most, so a turn stays quick.
 */
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** Longest edge Claude uses at full detail */
export const MAX_EDGE = 1568
/** Pictures per message */
export const MAX_IMAGES = 4
/** Bytes per picture, under the API's 5 MB once base64 */
export const MAX_BYTES = 3_700_000

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** A picture as a model takes it: base64, with its type */
export interface PreparedImage {
  mediaType: ImageMime
  data: string
}

/** What the bytes are, by their signature (a file's name or a data: URL can be wrong) */
export function sniffMime(buf: Buffer): ImageMime | 'image/heic' | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(buf.toString('ascii', 8, 12))) return 'image/heic'
  return null
}

/** Width and height from the header alone, or null when it can't be read */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  const mime = sniffMime(buf)
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (mime === 'image/webp') {
      const kind = buf.toString('ascii', 12, 16)
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      return null
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]
        // Start of frame (not DHT, JPG or DAC): its height and width
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch {
    // a truncated header
  }
  return null
}

/** The size that fits within `max` on the long edge, keeping the shape (never larger) */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Whether a picture can go as it is: a type Claude takes, small enough, and no larger than it can use */
export function needsConverting(buf: Buffer): boolean {
  const mime = sniffMime(buf)
  if (!mime || mime === 'image/heic') return true
  if (buf.length > MAX_BYTES) return true
  const size = imageSize(buf)
  return !size || Math.max(size.width, size.height) > MAX_EDGE
}

const sips = (args: string[]) =>
  new Promise<string>((resolve, reject) => execFile('/usr/bin/sips', args, { timeout: 20_000 }, (e, out) => (e ? reject(e) : resolve(String(out)))))

/** The converter: macOS sips, to a JPEG no longer than `max` on its long edge (never enlarged). Swappable in tests */
let convert = async (buf: Buffer, max: number, quality: number): Promise<Buffer> => {
  const dir = await mkdtemp(join(tmpdir(), 'tide-img-'))
  try {
    const src = join(dir, 'in')
    const out = join(dir, 'out.jpg')
    await writeFile(src, buf)
    // sips -Z enlarges a small picture too: only scale one that's bigger (a HEIC's size needs sips to read)
    const size: { width: number; height: number } = imageSize(buf) ?? (await sips(['-g', 'pixelWidth', '-g', 'pixelHeight', src]).then((o) => ({ width: Number(/pixelWidth: (\d+)/.exec(o)?.[1]), height: Number(/pixelHeight: (\d+)/.exec(o)?.[1]) })))
    const scale = !size.width || !size.height || Math.max(size.width, size.height) > max ? ['-Z', String(max)] : []
    await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...scale, src, '--out', out])
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
/** Swaps the converter (tests); returns the one it replaced */
export function setImageConverter(fn: typeof convert): typeof convert {
  const was = convert
  convert = fn
  return was
}

/** A data: URL's bytes, or the buffer itself */
function bytesOf(input: Buffer | string): Buffer | null {
  if (Buffer.isBuffer(input)) return input
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(input)
  if (!m) return null
  return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]))
}

/** One picture made ready, or null when it isn't a picture or can't be made small enough */
export async function prepareImage(input: Buffer | string): Promise<PreparedImage | null> {
  let buf = bytesOf(input)
  if (!buf || !sniffMime(buf)) return null
  if (needsConverting(buf)) {
    // Detail first; a page of dense handwriting that's still too heavy goes again, smaller
    buf = await convert(buf, MAX_EDGE, 85).catch(() => null)
    if (buf && buf.length > MAX_BYTES) buf = await convert(buf, 1200, 70).catch(() => null)
    if (!buf || buf.length > MAX_BYTES) return null
  }
  const mime = sniffMime(buf)
  if (!mime || mime === 'image/heic') return null
  return { mediaType: mime, data: buf.toString('base64') }
}

/** Several, in order, skipping any that can't be read, at most `max` */
export async function prepareImages(inputs: (Buffer | string)[], max = MAX_IMAGES): Promise<PreparedImage[]> {
  const out: PreparedImage[] = []
  for (const i of inputs) {
    if (out.length >= max) break
    const p = await prepareImage(i)
    if (p) out.push(p)
  }
  return out
}

export const dataUrlOf = (p: PreparedImage) => `data:${p.mediaType};base64,${p.data}`
