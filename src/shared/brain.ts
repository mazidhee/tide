/**
 * Tide's brain: everything it knows about you and your learning, as one graph. You in the middle,
 * with where you're heading; your notebooks and their notes (linked as you link them, coloured by
 * how well you know them); the books you own and their chapters, tied to the notes they cover;
 * what the tutor remembers about you; and this week's topics. Built from what Tide already
 * stores, so it's always the real state, not a picture of it.
 */
import { matchSections, type BookMap } from './books'
import type { GraphData, MasteryLevel } from './types'

export type BrainKind = 'you' | 'notebook' | 'note' | 'book' | 'chapter' | 'memory' | 'week'

export interface BrainNode {
  id: string
  kind: BrainKind
  label: string
  /** What it clusters with: a notebook's name, a book, or "you" */
  group: string
  /** The file it opens */
  path?: string
  /** A chapter's pages */
  from?: number
  to?: number
  level?: MasteryLevel
  /** A roadmap's share done, 0 to 1 */
  progress?: number
  /** A line more: the direction, a chapter's summary, a memory in full */
  detail?: string
  degree: number
}

export type BrainEdgeKind = 'link' | 'contains' | 'covers' | 'focus' | 'owns' | 'remembers' | 'plan'

export interface BrainEdge {
  source: string
  target: string
  kind: BrainEdgeKind
}

export interface BrainData {
  nodes: BrainNode[]
  edges: BrainEdge[]
}

/** Something Tide just learned or did, shown live on the graph */
export interface BrainEvent {
  at: number
  kind: 'memory' | 'attempt' | 'book' | 'direction' | 'week' | 'note'
  label: string
  /** The node it touched, to light up */
  id?: string
}

export interface BrainInput {
  direction: string
  /** Notebook names, most important first */
  focus: string[]
  notebooks: { name: string; path: string; progress?: number }[]
  graph: GraphData
  mastery: Record<string, { level: MasteryLevel }>
  memories: { id: string; text: string }[]
  books: BookMap[]
  /** This week's topics still to learn */
  week: { topic: string; notebook?: string }[]
}

const MAX_MEMORIES = 30

/** A book's chapters: its top entries, or the entries inside its parts ("Part II" holds chapters) */
export function bookChapters(map: BookMap): BookMap['sections'] {
  return map.sections.filter((s, i) => {
    if (/^part\b/i.test(s.title.trim())) return false
    if (s.level === 0) return true
    const parent = [...map.sections.slice(0, i)].reverse().find((c) => c.level === s.level - 1)
    return !!parent && /^part\b/i.test(parent.title.trim())
  })
}

export function buildBrain(i: BrainInput): BrainData {
  const nodes: BrainNode[] = []
  const edges: BrainEdge[] = []
  const add = (n: Omit<BrainNode, 'degree'>) => nodes.push({ ...n, degree: 0 })

  add({ id: 'you', kind: 'you', label: 'You', group: 'you', ...(i.direction ? { detail: i.direction } : {}) })

  for (const nb of i.notebooks) {
    add({ id: `nb:${nb.path}`, kind: 'notebook', label: nb.name, group: nb.name, path: nb.path, ...(nb.progress !== undefined ? { progress: nb.progress } : {}) })
    edges.push({ source: 'you', target: `nb:${nb.path}`, kind: i.focus.includes(nb.name) ? 'focus' : 'owns' })
  }
  const nbByName = new Map(i.notebooks.map((n) => [n.name, n]))

  // Notes, linked as you link them, each inside its notebook
  const notePaths = new Set<string>()
  for (const n of i.graph.nodes) {
    // Only notes in your notebooks: not PDFs, saved pages or Tide's own files
    if (/\.pdf$/i.test(n.path) || !nbByName.has(n.notebook)) continue
    notePaths.add(n.path)
    add({ id: n.path, kind: 'note', label: n.title, group: n.notebook || 'Notes', path: n.path, level: i.mastery[n.path]?.level ?? 'new' })
    const nb = nbByName.get(n.notebook)
    if (nb) edges.push({ source: `nb:${nb.path}`, target: n.path, kind: 'contains' })
  }
  for (const e of i.graph.edges) if (notePaths.has(e.source) && notePaths.has(e.target)) edges.push({ source: e.source, target: e.target, kind: 'link' })

  // Books and their chapters, each chapter tied to the notes it covers
  for (const map of i.books) {
    const bookId = `book:${map.path}`
    add({ id: bookId, kind: 'book', label: map.title, group: bookId, path: map.path })
    edges.push({ source: 'you', target: bookId, kind: 'owns' })
    const chapters = bookChapters(map)
    for (const c of chapters) {
      const id = `ch:${map.path}#${c.from}`
      add({ id, kind: 'chapter', label: c.title, group: bookId, path: map.path, from: c.from, to: c.to, ...(c.about ? { detail: c.about } : {}) })
      edges.push({ source: bookId, target: id, kind: 'contains' })
    }
    for (const n of i.graph.nodes) {
      if (!notePaths.has(n.path)) continue
      const [hit] = matchSections(n.title, [map], [], 1)
      const chapter = hit && [...chapters].reverse().find((c) => c.from <= hit.from)
      if (chapter) edges.push({ source: `ch:${map.path}#${chapter.from}`, target: n.path, kind: 'covers' })
    }
  }

  // What the tutor remembers about you, newest first
  for (const m of i.memories.slice(-MAX_MEMORIES)) {
    add({ id: `mem:${m.id}`, kind: 'memory', label: m.text.length > 48 ? `${m.text.slice(0, 46)}…` : m.text, group: 'you', detail: m.text })
    edges.push({ source: 'you', target: `mem:${m.id}`, kind: 'remembers' })
  }

  // This week's topics, by their notebook and the note they'll become
  const byTitle = new Map(i.graph.nodes.map((n) => [n.title.toLowerCase(), n.path]))
  i.week.forEach((w, k) => {
    const note = byTitle.get(w.topic.toLowerCase())
    if (note) return void edges.push({ source: 'you', target: note, kind: 'plan' })
    const nb = w.notebook ? nbByName.get(w.notebook) : undefined
    add({ id: `wk:${k}`, kind: 'week', label: w.topic, group: nb?.name ?? 'you' })
    edges.push({ source: nb ? `nb:${nb.path}` : 'you', target: `wk:${k}`, kind: 'plan' })
  })

  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0
  return { nodes, edges }
}
