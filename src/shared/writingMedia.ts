/**
 * Pictures in a writing folder (main/writing serves them, the Writing editor draws them), resolved
 * the way Obsidian does so a vault like base-k reads the same in both apps:
 *
 * - the folder's attachment setting (.obsidian/app.json "attachmentFolderPath": "images", "./"
 *   for the note's own folder, "./x" for a folder beside the note, "/" for the vault's top);
 * - then the note's own folder;
 * - then the shortest path anywhere in the folder that ends in the name.
 *
 * Paths here are relative to the writing folder, with forward slashes.
 */

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i
export const HEIC_FILE = /\.hei[cf]$/i

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const join = (...parts: string[]) =>
  parts
    .join('/')
    .split('/')
    .reduce<string[]>((out, p) => (p === '..' ? out.slice(0, -1) : p && p !== '.' ? [...out, p] : out), [])
    .join('/')

/** The attachment setting from an .obsidian/app.json's text; undefined when it isn't there */
export function attachmentSetting(appJson: string | null | undefined): string | undefined {
  if (!appJson) return undefined
  try {
    const v = (JSON.parse(appJson) as { attachmentFolderPath?: unknown }).attachmentFolderPath
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * The folder new attachments go to for a note (relative to the root): Obsidian's setting when
 * there is one, else `fallback` (Tide's own notes put them in "attachments" beside the note).
 */
export function attachmentDir(setting: string | undefined, noteRel: string, fallback: 'root' | 'beside' | 'attachments' = 'root'): string {
  const here = dirOf(noteRel)
  if (setting === undefined || setting === '') return fallback === 'attachments' ? join(here, 'attachments') : fallback === 'beside' ? here : ''
  const s = setting.trim()
  if (s === '/' || s === '.') return s === '/' ? '' : here
  if (s === './') return here
  if (s.startsWith('./')) return join(here, s.slice(2))
  return join(s.replace(/^\/+/, ''))
}

/** The `|1072` or `|300x200` after an embed's name, as a width in pixels; null when it's an alias */
export function embedWidth(alias: string | null | undefined): number | null {
  const m = /^\s*(\d{1,5})(?:\s*x\s*\d{1,5})?\s*$/.exec(alias ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Where an embed's picture is, or null when no such file is in the root. `files` is every file in
 * the root (relative paths); `attach` the attachment folder for this note (attachmentDir).
 */
export function resolveEmbed(target: string, noteRel: string, attach: string, files: readonly string[]): string | null {
  const t = target.split('#')[0].split('|')[0].trim().replace(/^\/+/, '')
  if (!t) return null
  const have = new Set(files)
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]))
  const pick = (p: string) => (have.has(p) ? p : (lower.get(p.toLowerCase()) ?? null))
  // A path written out from the note's folder (Markdown images), or from the root
  if (t.includes('/') || target.startsWith('./') || target.startsWith('../')) {
    const found = pick(join(dirOf(noteRel), t)) ?? pick(join(t))
    if (found) return found
  }
  const name = t.split('/').pop()!
  const found = pick(join(attach, t)) ?? pick(join(dirOf(noteRel), t))
  if (found) return found
  // Anywhere: the shortest path that ends in the name (as Obsidian picks)
  const tail = '/' + t.toLowerCase()
  const nameTail = '/' + name.toLowerCase()
  const matches = files.filter((f) => {
    const l = '/' + f.toLowerCase()
    return l.endsWith(tail) || l.endsWith(nameTail)
  })
  if (!matches.length) return null
  return matches.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))[0]
}

/**
 * A name for a pasted or dropped picture, as Obsidian names one ("Pasted image 20261114093012.png",
 * or the dropped file's own name), with " 1", " 2" added rather than overwriting a file.
 */
export function attachmentName(original: string | null | undefined, ext: string, at: Date, taken: (name: string) => boolean): string {
  const stamp = [at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, '0')).join('')
  const own = original && !/^image\.\w+$/i.test(original) ? original.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim() : ''
  const base = own || `Pasted image ${stamp}`
  for (let i = 0; i < 1000; i++) {
    const name = `${base}${i ? ` ${i}` : ''}.${ext}`
    if (!taken(name)) return name
  }
  return `${base} ${Date.now()}.${ext}`
}

/** The URL a writing piece's picture loads from: main/writing finds the file (vault://writing) */
export const writingImageUrl = (piece: string, target: string) => `vault://writing/image?piece=${encodeURIComponent(piece)}&t=${encodeURIComponent(target)}`
