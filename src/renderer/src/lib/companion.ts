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
