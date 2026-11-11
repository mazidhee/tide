import { describe, expect, it } from 'vitest'
import { onlyVerbs, parseBase, parseTour, TOUR_LIMITS } from '../src/renderer/src/lib/sims/specUtil'

describe('tour verbs', () => {
  it('keeps small plain values under a verb, and drops anything else', () => {
    const [step] = parseTour([
      {
        at: 'Node:2',
        say: 'Stop the leader.',
        do: {
          run: 3,
          Stop: 2,
          command: 'x=1',
          heal: true,
          partition: [[1, 2], [3, 4, 5]],
          set: { a: 2, b: 'no', c: Infinity },
          nested: { deep: { deeper: 1 } },
          nothing: null,
          fn: undefined
        }
      }
    ])
    expect(step.at).toBe('node:2')
    expect(step.do).toEqual({ run: 3, stop: 2, command: 'x=1', heal: true, partition: [[1, 2], [3, 4, 5]], set: { a: 2 }, nested: {} })
  })

  it('bounds what a verb may carry', () => {
    const long = 'x'.repeat(1000)
    const many = Array.from({ length: 100 }, (_, i) => i)
    const verbs = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`v${i}`, i]))
    const [a, b] = parseTour([
      { say: 'a', do: { text: long, list: many, groups: [many, [long, {}, 1]] } },
      { say: 'b', do: verbs }
    ])
    expect((a.do!.text as string).length).toBe(TOUR_LIMITS.text)
    expect(a.do!.list).toHaveLength(TOUR_LIMITS.list)
    expect((a.do!.groups as unknown[][])[0]).toHaveLength(TOUR_LIMITS.list)
    expect((a.do!.groups as unknown[][])[1]).toEqual([long.slice(0, TOUR_LIMITS.text), 1])
    expect(Object.keys(b.do!)).toHaveLength(TOUR_LIMITS.verbs)
  })

  it('a kind keeps only the verbs it knows; run, pause and sample always stay', () => {
    const spec = parseBase({ title: 'T', tour: [{ say: 'one', do: { insert: 4, explode: true, run: 2 } }, { say: 'two', do: { explode: true } }, { say: 'three', do: { pause: true } }] })
    onlyVerbs(spec, ['insert'])
    expect(spec.tour.map((s) => s.do)).toEqual([{ insert: 4, run: 2 }, undefined, { pause: true }])
  })
})
