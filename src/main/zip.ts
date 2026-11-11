import { inflateRawSync } from 'zlib'

/**
 * Reads a zip archive held in memory (an EPUB is one): the central directory at its end lists
 * every file with where its data starts, and each file is stored or deflated. Only what EPUBs use;
 * no zip64, no encryption. Node's own zlib does the inflating.
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  offset: number
}

const MAX_ENTRY = 64 * 1024 * 1024

export function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End of central directory: 22 bytes plus a comment of up to 64 KB, searched from the end
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no central directory).')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, ZipEntry>()
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error('The zip file’s directory is damaged.')
    const method = buf.readUInt16LE(at + 10)
    const compressedSize = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const offset = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    if (!name.endsWith('/')) out.set(name, { name, method, compressedSize, size, offset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export function zipRead(buf: Buffer, e: ZipEntry): Buffer {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error(`Damaged entry: ${e.name}`)
  if (e.size > MAX_ENTRY) throw new Error(`${e.name} is too large to read.`)
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28)
  const data = buf.subarray(start, start + e.compressedSize)
  if (e.method === 0) return Buffer.from(data)
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY })
  throw new Error(`${e.name} uses a compression method Tide can't read (${e.method}).`)
}

/** An archive's files by name, read on demand */
export function openZip(buf: Buffer) {
  const entries = zipEntries(buf)
  const read = (name: string): Buffer | null => {
    const e = entries.get(name) ?? entries.get(decodeURI(name))
    return e ? zipRead(buf, e) : null
  }
  return {
    names: () => [...entries.keys()],
    has: (name: string) => entries.has(name) || entries.has(decodeURI(name)),
    text: (name: string) => read(name)?.toString('utf8') ?? null,
    bytes: read,
    size: (name: string) => entries.get(name)?.size ?? 0
  }
}
