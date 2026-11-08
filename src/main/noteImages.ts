import { promises as fs } from 'fs'
import { posix } from 'path'
import { imageRefs } from '@shared/noteImages'
import { absPath, resolveLink } from './vault'

/**
 * The pictures a note or message embeds, read from the vault for Gemma to look at: a screenshot
 * of a textbook page, a diagram, a photo of working. A few at most, so a turn stays quick.
 */

const MAX_IMAGES = 4
const MAX_BYTES = 6_000_000
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

export interface NoteImage {
  /** Its vault path */
  path: string
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
    if (!buf || buf.length > MAX_BYTES) continue
    out.push({ path, dataUrl: `data:${MIME[path.split('.').pop()!.toLowerCase()] ?? 'image/png'};base64,${buf.toString('base64')}` })
  }
  return out
}
