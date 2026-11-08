import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import type { PdfHighlight } from '@shared/types'
import { absPath, joinRel, writeText } from './vault'

const fileFor = (path: string) =>
  joinRel('.tide', 'highlights', `${createHash('sha1').update(path).digest('hex')}.json`)

export async function getHighlights(path: string): Promise<PdfHighlight[]> {
  const rel = fileFor(path)
  if (!existsSync(absPath(rel))) return []
  try {
    const data = JSON.parse(await fs.readFile(absPath(rel), 'utf8'))
    return Array.isArray(data.highlights) ? data.highlights : []
  } catch {
    return []
  }
}

export async function saveHighlights(path: string, highlights: PdfHighlight[]) {
  await writeText(fileFor(path), JSON.stringify({ path, highlights }, null, 1))
}
