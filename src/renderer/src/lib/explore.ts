import { useEffect, useState } from 'react'
import type { ExploreFrom, ExploreInput, ExploreItem } from '@shared/explore'
import { profileSubject } from '@shared/subjects'
import type { ChatScope } from '@shared/types'
import type { useApp } from '../state'

type App = ReturnType<typeof useApp>

/** The "To explore" list, kept up to date as items are added, titled and explored */
export function useExplore(): ExploreItem[] | null {
  const [items, setItems] = useState<ExploreItem[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      window.tide.explore
        .list()
        .then((l) => live && setItems(l))
        .catch(() => live && setItems([]))
    load()
    const off = window.tide.explore.onChange(load)
    return () => {
      live = false
      off()
    }
  }, [])
  return items
}

/** The subject a lesson is in: its own profile's, else the notebook it is from, else read off the topic */
export function lessonSubject(topic: string, scope: ChatScope, profile?: { subjects: string[] }): string | undefined {
  if (profile?.subjects[0]) return profile.subjects[0]
  if (scope.kind === 'folder') return scope.path.split('/')[0]
  return profileSubject(topic).subjects[0]
}

/** Keeps something to explore later, with a toast that leads to the list */
export async function exploreLater(app: App, input: ExploreInput) {
  try {
    await window.tide.explore.add(input)
    app.toast('Kept to explore later', { action: { label: 'See the list', run: () => app.setView({ kind: 'learn' }) } })
  } catch {
    app.toast('Couldn’t keep that just now.', { tone: 'error' })
  }
}

/** Opens the lesson something came up in, at that message: it's brought into view and flashed */
export async function openWhereItCameUp(app: App, from: ExploreFrom) {
  const r = from.lesson ? await window.tide.lessons.get(from.lesson).catch(() => null) : null
  if (!r) return app.toast('That lesson isn’t kept any more.', { tone: 'error' })
  // As Past lessons carries one on: up to its last reply
  const turns = r.turns.map(({ role, content }) => ({ role, content }))
  while (turns.length && (turns[turns.length - 1].role === 'user' || !turns[turns.length - 1].content.trim())) turns.pop()
  app.setView({
    kind: 'session',
    mode: r.mode,
    scope: r.scope,
    topic: r.topic,
    options: r.options,
    turns,
    lesson: r.id,
    ...(r.threads?.length ? { threads: r.threads } : {}),
    ...(from.turn != null ? { focus: { turn: from.turn, ...(from.thread ? { thread: from.thread, reply: from.reply } : {}) } } : {}),
    nonce: Date.now()
  })
}

/** Starts the short side lesson on an item: on this Mac when the lesson it came from was private */
export function startSideLesson(app: App, item: ExploreItem) {
  app.setView({
    kind: 'session',
    mode: 'teach',
    scope: item.private && item.scope ? item.scope : { kind: 'none' },
    topic: item.title,
    options: { curiosity: { id: item.id, text: item.text, from: item.from } },
    nonce: Date.now()
  })
}

/** Opens the side lesson an item was explored in */
export async function openSideLesson(app: App, item: ExploreItem) {
  if (!item.explored?.lesson) return startSideLesson(app, item)
  const r = await window.tide.lessons.get(item.explored.lesson).catch(() => null)
  if (r?.page) return app.openPath(r.page)
  return openWhereItCameUp(app, { lesson: item.explored.lesson, topic: item.explored.topic })
}
