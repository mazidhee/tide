import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LearningStatus, NoteMeta, ReadStatus } from '@shared/types'
import { fileTitle, useApp } from '../state'
import { isCompanion } from './companion'

export type ItemType = 'article' | 'youtube' | 'pdf' | 'epub' | 'doc' | 'link'

export interface LibraryItem {
  path: string
  title: string
  type: ItemType
  excerpt: string
  mtime: number
  sourceUrl?: string
  image?: string
  site?: string
  duration?: string
  saved?: string
  /** Subjects it's filed under, e.g. "Mathematics" */
  topics: string[]
  /** Notes only: the `learning_status` frontmatter field */
  learning?: LearningStatus
  /** Reading status you set on it, which wins over one derived from `learning` */
  readStatus?: ReadStatus
}

const sameTopic = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

/**
 * Everything in the library folder with its metadata and subjects. Subject changes are applied
 * at once and saved in the background; a failed save puts the old subjects back.
 */
export function useLibrary() {
  const app = useApp()
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [topics, setTopicsState] = useState<Record<string, string[]>>({})
  const [notebooks, setNotebooks] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, ReadStatus>>({})
  const prefix = app.settings.libraryFolder + '/'

  useEffect(() => {
    let live = true
    Promise.all([window.tide.vault.notes(), window.tide.library.topics(), window.tide.learn.notebooks()])
      .then(([n, t, nbs]) => {
        if (!live) return
        setNotes(n)
        setTopicsState(t)
        setNotebooks(nbs.map((nb) => nb.name).filter((name) => name !== app.settings.libraryFolder))
      })
      .catch(() => {})
    window.tide.library
      .status()
      .then((s) => live && setStatuses(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [app.files, app.settings.libraryFolder])

  const items: LibraryItem[] = useMemo(() => {
    const meta = new Map(notes.map((n) => [n.path, n]))
    return app.files
      .filter((f) => f.path.startsWith(prefix) && (f.kind === 'note' || f.kind === 'pdf' || f.kind === 'epub' || f.kind === 'doc') && !isCompanion(f.path))
      .map((f) => {
        const m = meta.get(f.path)
        const type: ItemType = f.kind === 'pdf' ? 'pdf' : f.kind === 'epub' ? 'epub' : m?.sourceType && m.sourceType !== 'pdf' ? m.sourceType : f.path.includes('/Docs/') ? 'doc' : 'article'
        return {
          path: f.path,
          title: m?.title ?? fileTitle(f.name).replace(/\.(pdf|epub)$/i, ''),
          type,
          excerpt: m?.excerpt ?? '',
          mtime: f.mtime ?? 0,
          sourceUrl: m?.sourceUrl,
          image: m?.image,
          site: m?.site,
          duration: m?.duration,
          saved: m?.saved,
          topics: topics[f.path] ?? [],
          learning: m?.status,
          readStatus: statuses[f.path]
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  }, [app.files, notes, prefix, topics, statuses])

  /** Notebook names first (in shelf order), then any other subject in use */
  const subjects = useMemo(() => {
    const out = [...notebooks]
    for (const list of Object.values(topics)) for (const t of list) if (!out.some((s) => sameTopic(s, t))) out.push(t)
    return out
  }, [notebooks, topics])

  const setTopics = useCallback(
    (path: string, next: string[]) => {
      let previous: string[] = []
      setTopicsState((t) => {
        previous = t[path] ?? []
        const copy = { ...t }
        if (next.length) copy[path] = next
        else delete copy[path]
        return copy
      })
      window.tide.library.setTopics(path, next).catch(() => {
        setTopicsState((t) => ({ ...t, [path]: previous }))
        app.toast('Could not save the subjects. Try again.', { tone: 'error' })
      })
    },
    [app]
  )

  const setStatus = useCallback(
    (path: string, next: ReadStatus) => {
      let previous: ReadStatus | undefined
      setStatuses((s) => {
        previous = s[path]
        return { ...s, [path]: next }
      })
      window.tide.library.setStatus(path, next).catch(() => {
        setStatuses((s) => {
          const copy = { ...s }
          if (previous) copy[path] = previous
          else delete copy[path]
          return copy
        })
        app.toast('Could not save the reading status. Try again.', { tone: 'error' })
      })
    },
    [app]
  )

  return { items, subjects, setTopics, setStatus }
}

/** Read / reading / unread: what you set, else what the note's learning status implies */
export const readStatusOf = (item: LibraryItem): ReadStatus =>
  item.readStatus ?? (item.learning === 'mastered' ? 'read' : item.learning === 'learning' || item.learning === 'reviewing' ? 'reading' : 'unread')

export const hasTopic = (item: LibraryItem, topic: string) => item.topics.some((t) => sameTopic(t, topic))
