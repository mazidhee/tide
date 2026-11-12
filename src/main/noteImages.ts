import { promises as fs } from 'fs'
import { posix } from 'path'
import { imageRefs } from '@shared/noteImages'
import { dataUrlOf, MAX_IMAGES, prepareImage, type PreparedImage } from './imagePrep'
import { absPath, resolveLink } from './vault'

/**
 * The pictures a note or message embeds, read from the vault for the tutor to look at: a
 * screenshot of a textbook page, a diagram, a photo of working. Each is made ready for a model
 * (main/imagePrep: an iPhone HEIC becomes a JPEG, a large photo is scaled down), a few at most,
 * so a turn stays quick.
 */

/** Read at all: a phone photo can be large before it is scaled down */
const MAX_FILE_BYTES = 30_000_000

export interface NoteImage {
  /** Its vault path */
  path: string
  /** Ready to send: base64 and its type */
  image: PreparedImage
  dataUrl: string
}

export async function loadImages(md: string, fromPath: string, max = MAX_IMAGES): Promise<NoteImage[]> {
  const out: NoteImage[] = []
  for (const ref of imageRefs(md)) {
    if (out.length >= max) break
    // "../img/a.png" from the note's folder, "/Folder/a.png" from the vault's root, else by name
    const rel = ref.startsWith('/') ? ref.slice(1) : ref.includes('/') ? posix.normalize(posix.join(posix.dirname(fromPath), ref)) : ref
    const path = (await resolveLink(rel, fromPath).catch(() => null)) ?? (await resolveLink(ref.replace(/^\//, ''), fromPath).catch(() => null))
    if (!path || out.some((i) => i.path === path)) continue
    const buf = await fs.readFile(absPath(path)).catch(() => null)
    if (!buf || buf.length > MAX_FILE_BYTES) continue
    const image = await prepareImage(buf).catch(() => null)
    if (image) out.push({ path, image, dataUrl: dataUrlOf(image) })
  }
  return out
}
