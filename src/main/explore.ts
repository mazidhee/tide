/**
 * Explore later (shared/explore): the things you kept to come back to for curiosity, in the vault
 * at .tide/explore.json beside Tide's other data. Each gets a short title in the background, on
 * Claude's background model (Haiku) when Claude teaches, else on Gemma.
 * A side lesson that finishes marks its item explored (main/lessons).
 */
import { existsSync, promises as fs } from 'fs'
import { cleanTitle, newExploreItem, sortExplore, titlePrompt, TITLE_SYSTEM, type ExploreInput, type ExploreItem } from '@shared/explore'
import { absPath, writeText } from './vault'

const FILE = '.tide/explore.json'

async function read(): Promise<ExploreItem[]> {
  try {
    if (!existsSync(absPath(FILE))) return []
    const list = JSON.parse(await fs.readFile(absPath(FILE), 'utf8')) as unknown
    return Array.isArray(list) ? list.filter((x): x is ExploreItem => !!x && typeof x === 'object' && typeof (x as ExploreItem).id === 'string' && typeof (x as ExploreItem).text === 'string') : []
  } catch {
    return []
  }
}

/** One change at a time, so a title arriving while you add another can't lose it */
let queue: Promise<unknown> = Promise.resolve()
function change(fn: (list: ExploreItem[]) => ExploreItem[]): Promise<ExploreItem[]> {
  const run = queue.then(async () => {
    const next = fn(await read())
    await writeText(FILE, JSON.stringify(next, null, 1))
    return next
  })
  queue = run.catch(() => undefined)
  void run.then(changed, () => undefined)
  return run
}

/** Every window hears that the list changed */
function changed() {
  void import('electron')
    .then(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('explore:changed')
    })
    .catch(() => undefined)
}

export const listExplore = async () => sortExplore(await read())

export async function addExplore(input: ExploreInput): Promise<ExploreItem> {
  const item = newExploreItem(input)
  if (!item.text) throw new Error('Nothing to keep')
  const kept: ExploreItem = item
  await change((list) => [kept, ...list.filter((x) => x.id !== kept.id)])
  void nameIt(kept)
  return kept
}

/** The title, made in the background; the first words stay if no model can do it */
async function nameIt(item: ExploreItem) {
  try {
    const { backgroundOnClaude } = await import('./claudeEngine')
    const { complete } = await import('./ai')
    const prompt = titlePrompt(item.text, item.from.topic)
    const reply = (await backgroundOnClaude(prompt, TITLE_SYSTEM, undefined).catch(() => null)) ?? (await complete(prompt, TITLE_SYSTEM, undefined, 'background'))
    const title = cleanTitle(reply)
    if (title) await change((list) => list.map((x) => (x.id === item.id ? { ...x, title, titled: true } : x)))
  } catch {
    // the first words stay
  }
}

export const updateExplore = (id: string, patch: Partial<Pick<ExploreItem, 'title' | 'explored'>>) =>
  change((list) => list.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.title ? { titled: true } : {}) } : x))).then(sortExplore)

export const removeExplore = (id: string) => change((list) => list.filter((x) => x.id !== id)).then(sortExplore)

/** A side lesson finished: its item is explored, and points at it */
export async function exploredIn(id: string, lesson: { id: string; topic: string }) {
  const list = await read()
  const item = list.find((x) => x.id === id)
  if (!item || item.explored?.lesson === lesson.id) return
  await change((l) => l.map((x) => (x.id === id ? { ...x, explored: { at: Date.now(), lesson: lesson.id, topic: lesson.topic } } : x)))
}
