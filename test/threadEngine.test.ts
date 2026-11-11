// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { TutorThread } from '@shared/types'
import { useThreadEngine } from '../src/renderer/src/lib/useThreadEngine'

type Ev = { id: string; type: 'delta' | 'done' | 'error' | 'reset'; text?: string; message?: string }

describe('inline tutor answers', () => {
  it('arrive once when reading mode and the margin both run an engine over the same threads', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const listeners = new Set<(e: Ev) => void>()
    const sent: string[] = []
    ;(window as unknown as { tide: unknown }).tide = {
      ai: {
        onEvent: (f: (e: Ev) => void) => {
          listeners.add(f)
          return () => listeners.delete(f)
        },
        chat: async (req: { id: string }) => void sent.push(req.id)
      }
    }
    const emit = (e: Ev) => listeners.forEach((f) => f(e))

    let threads: TutorThread[] = []
    let ask: ReturnType<typeof useThreadEngine>['ask'] = async () => {}
    function Page() {
      const [list, setList] = useState<TutorThread[]>([{ id: 't1', quote: 'A passage', messages: [] } as unknown as TutorThread])
      threads = list
      const reading = useThreadEngine('Maths/Fourier.md', '', 'tutor', setList)
      useThreadEngine('Maths/Fourier.md', '', 'tutor', setList)
      ask = reading.ask
      return null
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Page)))
    await act(async () => ask(threads[0], 'Explain this passage simply, with an example.'))
    expect(listeners.size).toBe(2)

    await act(async () => {
      emit({ id: sent[0], type: 'delta', text: 'This passage ' })
      emit({ id: sent[0], type: 'delta', text: 'describes latency.' })
      emit({ id: sent[0], type: 'done' })
    })
    expect(threads[0].messages.at(-1)?.content).toBe('This passage describes latency.')

    // An answer for another page's engine is left alone
    await act(async () => emit({ id: 't1:inline:999', type: 'delta', text: 'stray' }))
    expect(threads[0].messages.at(-1)?.content).toBe('This passage describes latency.')
    act(() => root.unmount())
  })
})
