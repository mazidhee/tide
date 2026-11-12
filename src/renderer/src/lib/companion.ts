import { fileTitle, folderOf } from '../state'

/** True for a book's or article's own notes file, which belongs with it rather than being an item itself */
export const isCompanion = (path: string) => / \(Notes\)\.md$/i.test(path)

/** The note that goes with a PDF or saved article: "<name> (Notes).md" next to it */
export const companionPath = (source: string) => {
  const dir = folderOf(source)
  const name = fileTitle(source).replace(/\.(pdf|epub)$/i, '')
  return `${dir ? dir + '/' : ''}${name} (Notes).md`
}

const fileName = (path: string) => path.split('/').pop()!

/** Appends a quoted passage, linked back to where it came from, to the source's companion note */
export async function addQuoteToNotes(source: string, text: string, page?: number): Promise<string> {
  const target = companionPath(source)
  let existing = ''
  try {
    existing = await window.tide.vault.read(target)
  } catch {
    const name = fileTitle(source).replace(/\.(pdf|epub)$/i, '')
    existing = `---\nsource: "[[${fileName(source)}]]"\n---\n\n# Notes on ${name}\n`
  }
  const link = page ? `[[${fileName(source)}#page=${page}|p. ${page}]]` : `[[${fileName(source).replace(/\.md$/i, '')}]]`
  const quote = text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  const next = `${existing.trimEnd()}\n\n${quote}\n> — ${link}\n\n`
  await window.tide.vault.write(target, next)
  return target
}

/**
 * A note written while watching a video, at a moment of it: a line in the video's notes page
 * ("<saved note> (Notes).md" beside a saved video, else "<title> (Notes).md" in the library's
 * Videos folder), led by a timestamp link. The page opens with the video itself, so on it every
 * timestamp seeks the player there.
 */
export async function addVideoNote(v: { id?: string; path?: string; file?: string; title: string; at: number; text: string }): Promise<string> {
  const { formatTime, watchUrl } = await import('@shared/video')
  const library = (await window.tide.settings.get()).libraryFolder || 'Library'
  const safe = v.title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Video'
  const target = v.path ? companionPath(v.path) : v.file ? companionPath(v.file) : `${library}/Videos/${safe} (Notes).md`
  let existing = ''
  try {
    existing = await window.tide.vault.read(target)
  } catch {
    const from = v.path ?? v.file
    existing =
      (from ? `---\nsource: "[[${fileName(from).replace(/\.md$/i, '')}]]"\n---\n\n` : '') +
      `# Notes on ${safe}\n\n` +
      (v.id ? `![](${watchUrl(v.id)})\n\n` : v.file ? `![[${v.file}]]\n\n` : '')
  }
  const stamp = v.id ? `[${formatTime(v.at)}](${watchUrl(v.id, Math.max(1, v.at))})` : `**${formatTime(v.at)}**`
  const body = v.text.trim().replace(/\n+/g, ' ')
  const prev = existing.trimEnd()
  // Notes taken one after another stay one list
  await window.tide.vault.write(target, `${prev}${/(^|\n)- [^\n]*$/.test(prev) ? '\n' : '\n\n'}- ${stamp} ${body}\n`)
  return target
}
