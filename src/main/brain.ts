import { aimOf } from '@shared/coach'
import { buildBrain, type BrainData } from '@shared/brain'
import { bookMaps } from './books'
import { getCoach, getWeek } from './coach'
import { getMastery, getNotebooks, graphCached } from './learn'
import { listMemories } from './memory'
import { readText } from './vault'
import { getSettings } from './settings'

/** Folders Tide keeps for itself, and the Library (its books are shown as books): not your subjects */
const TIDES_OWN = new Set(['Coach', 'Exams', 'Designs', 'Lessons', 'Chat images'])
import { localDate } from '@shared/coach'

/** Tide's brain as a graph: you, your notebooks and notes, your books, its memories, this week */
export async function getBrain(): Promise<BrainData> {
  const [coach, notebooks, graph, mastery, memories, books, week] = await Promise.all([
    getCoach(),
    getNotebooks().catch(() => []),
    graphCached(),
    getMastery().catch(() => ({})),
    listMemories().catch(() => []),
    bookMaps().catch(() => []),
    getWeek(localDate()).catch(() => null)
  ])
  const library = getSettings().libraryFolder
  const shown = notebooks.filter((n) => !TIDES_OWN.has(n.path) && n.path !== library && !n.path.startsWith('.'))
  // How far along each roadmap is, from its ticks
  const progress = await Promise.all(
    shown.map(async (n) => {
      if (n.track) {
        const topics = await import('./modules').then((m) => m.notebookTopics(n)).catch(() => [])
        return topics.length ? topics.filter((t) => t.checked).length / topics.length : undefined
      }
      if (!n.outline) return undefined
      const md = await readText(n.outline).catch(() => '')
      const all = (md.match(/^\s*- \[[ xX]\] /gm) ?? []).length
      return all ? (md.match(/^\s*- \[[xX]\] /gm) ?? []).length / all : undefined
    })
  )
  const today = localDate()
  return buildBrain({
    direction: aimOf(coach),
    focus: coach.focus,
    notebooks: shown.map((n, i) => ({ name: n.name, path: n.path, ...(progress[i] !== undefined ? { progress: progress[i] } : {}) })),
    graph,
    mastery: mastery as Record<string, { level: import('@shared/types').MasteryLevel }>,
    memories,
    books,
    week: (week?.days ?? []).filter((d) => d.date >= today).flatMap((d) => d.items.filter((it) => it.kind === 'learn' && !it.done && it.topic).map((it) => ({ topic: it.topic!, notebook: it.notebook })))
  })
}
