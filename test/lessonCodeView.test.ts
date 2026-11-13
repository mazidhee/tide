// @vitest-environment jsdom
/**
 * A coding lesson's files on the lesson's side (lib/lessonCode): what's typed is saved to the
 * question's file, the tutor's proposals arrive and are kept or undone (written only when kept,
 * and the tutor told either way), a planted file takes over the editor for the next question,
 * and another lesson's events are ignored.
 */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LessonCodeEvent, Proposal } from '../src/shared/ide'
import { useLessonCode, type LessonCode } from '../src/renderer/src/lib/lessonCode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/data/ide/lessons/python-functions-abc'
let disk: Record<string, string> = {}
const writes: [string, string, string][] = []
const resolved: [string, string | null][] = []
let fire: (e: LessonCodeEvent) => void = () => {}

beforeEach(() => {
  disk = {}
  writes.length = 0
  resolved.length = 0
  ;(window as unknown as { tide: unknown }).tide = {
    ide: {
      lesson: {
        open: async () => ({ root: ROOT, name: 'Python functions', kind: 'lesson' }),
        onEvent: (cb: (e: LessonCodeEvent) => void) => ((fire = cb), () => (fire = () => {}))
      },
      read: async (_r: string, p: string) => (p in disk ? { text: disk[p] } : Promise.reject(new Error('missing'))),
      write: async (r: string, p: string, t: string) => void (writes.push([r, p, t]), (disk[p] = t)),
      pair: { resolve: async (id: string, text: string | null) => void resolved.push([id, text]), problems: vi.fn() }
    }
  }
})

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let lc: LessonCode
let setCode: (s: string) => void
let code = ''
let setBusy: (b: boolean) => void

function Host({ exercise, labId = 'lesson:1' }: { exercise: string | null; labId?: string }) {
  const [c, sc] = useState('')
  const [busy, sb] = useState(false)
  code = c
  setCode = sc
  setBusy = sb
  lc = useLessonCode({ on: true, labId, topic: 'Python functions', exercise, code: c, setCode: sc, busy })
  return null
}

const settle = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

async function mount(exercise: string | null) {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root.render(createElement(Host, { exercise })))
  await settle()
}
afterEach(() => act(() => root.unmount()))

const proposal = (over: Partial<Proposal> = {}): Proposal => ({ id: 'p1', root: ROOT, path: 'exercise-1.py', original: 'return a - b\n', proposed: 'return a + b\n', explanation: 'add', created: 1, ...over })

describe("a coding lesson's editor and its files", () => {
  it('saves what is typed to the question’s file', async () => {
    await mount('exercise-1.py')
    expect(lc.file).toBe('exercise-1.py')
    await act(async () => setCode('return a - b\n'))
    await settle(400)
    expect(writes.at(-1)).toEqual([ROOT, 'exercise-1.py', 'return a - b\n'])
  })

  it('picks up what was saved when the lesson is opened again', async () => {
    disk['exercise-1.py'] = 'saved before\n'
    await mount('exercise-1.py')
    expect(code).toBe('saved before\n')
  })

  it('keeps a proposal: writes the kept text, shows it in the editor and tells the tutor', async () => {
    await mount('exercise-1.py')
    await act(async () => setCode('return a - b\n'))
    await act(async () => fire({ labId: 'lesson:1', type: 'proposal', proposal: proposal() }))
    expect(lc.proposals.map((p) => p.id)).toEqual(['p1'])
    expect(lc.currentOf(lc.proposals[0])).toBe('return a - b\n')
    await act(async () => lc.resolve(lc.proposals[0], 'return a + b\n'))
    expect(writes.at(-1)).toEqual([ROOT, 'exercise-1.py', 'return a + b\n'])
    expect(code).toBe('return a + b\n')
    expect(resolved).toEqual([['p1', 'return a + b\n']])
    expect(lc.proposals).toEqual([])
  })

  it('undoes a proposal: nothing written, the tutor told', async () => {
    await mount('exercise-1.py')
    await act(async () => fire({ labId: 'lesson:1', type: 'proposal', proposal: proposal({ id: 'p2' }) }))
    const before = writes.length
    await act(async () => lc.resolve(lc.proposals[0], null))
    expect(writes.length).toBe(before)
    expect(resolved).toEqual([['p2', null]])
  })

  it('shows review comments on the file on screen only', async () => {
    await mount('exercise-1.py')
    await act(async () => fire({ labId: 'lesson:1', type: 'comment', comment: { id: 'c1', root: ROOT, path: 'exercise-1.py', line: 2, severity: 'issue', body: 'Subtracts.' } }))
    await act(async () => fire({ labId: 'lesson:1', type: 'comment', comment: { id: 'c2', root: ROOT, path: 'other.py', line: 1, severity: 'praise', body: 'Nice.' } }))
    expect(lc.comments.map((c) => c.id)).toEqual(['c1'])
    await act(async () => lc.dismissComment('c1'))
    expect(lc.comments).toEqual([])
  })

  it('a file planted while the tutor writes is the one the next question is answered in', async () => {
    disk['buggy.py'] = 'def mean(xs):\n    return sum(xs) / (len(xs) - 1)\n'
    await mount('exercise-1.py')
    await act(async () => setBusy(true))
    await act(async () => fire({ labId: 'lesson:1', type: 'opened', root: ROOT, path: 'buggy.py', planted: true }))
    await settle()
    expect(lc.file).toBe('buggy.py')
    expect(code).toContain('len(xs) - 1')
    await act(async () => setBusy(false))
    // The new question doesn't replace it with its starter
    expect(lc.newExercise()).toBe(false)
    // The one after does
    let fresh = false
    await act(async () => void (fresh = lc.newExercise()))
    expect(fresh).toBe(true)
    expect(lc.file).toBe('exercise-1.py')
  })

  it('the next question is answered in the file the tutor just commented on, so the comments stay with the code', async () => {
    let exercise = 'exercise-2.py'
    container = document.createElement('div')
    root = createRoot(container)
    const render = () => act(async () => root.render(createElement(Host, { exercise })))
    await render()
    await settle()
    await act(async () => setCode('for i in range(1, len(xs)):\n'))
    await act(async () => setBusy(true))
    await act(async () => fire({ labId: 'lesson:1', type: 'comment', comment: { id: 'c1', root: ROOT, path: 'exercise-2.py', line: 1, severity: 'issue', body: 'Skips xs[0].' } }))
    await act(async () => setBusy(false))
    exercise = 'exercise-3.py'
    await render()
    let fresh = true
    await act(async () => void (fresh = lc.newExercise()))
    expect(fresh).toBe(false)
    expect(lc.file).toBe('exercise-2.py')
    expect(lc.comments.map((c) => c.id)).toEqual(['c1'])
    expect(code).toBe('for i in range(1, len(xs)):\n')
    // A turn with nothing done to a file: the question after it starts its own file
    await act(async () => setBusy(true))
    await act(async () => setBusy(false))
    await act(async () => void (fresh = lc.newExercise()))
    expect(fresh).toBe(true)
  })

  it('ignores another lesson’s events', async () => {
    await mount('exercise-1.py')
    await act(async () => fire({ labId: 'lesson:other', type: 'proposal', proposal: proposal() }))
    expect(lc.proposals).toEqual([])
  })
})
