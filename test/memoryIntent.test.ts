import { describe, expect, it } from 'vitest'
import { memoryIntent } from '../src/shared/memoryIntent'

describe('memoryIntent', () => {
  it('finds explicit requests to remember and forget', () => {
    expect(memoryIntent('Remember that my test goal is TEST-ZEBRA-42. Then tell me what a hash map is.').remember).toEqual(['My test goal is TEST-ZEBRA-42'])
    expect(memoryIntent('ok, please remember that I am interviewing at Bloomberg in March 2027').remember).toEqual(['I am interviewing at Bloomberg in March 2027'])
    expect(memoryIntent('Keep in mind that I prefer worked examples before theory.').remember).toEqual(['I prefer worked examples before theory'])
    expect(memoryIntent('remember: I already know Python 3.12 well').remember).toEqual(['I already know Python 3.12 well'])
    expect(memoryIntent('Forget that I am interviewing at Bloomberg.').forget).toEqual(['I am interviewing at Bloomberg'])
  })

  it('ignores ordinary uses of the words', () => {
    for (const t of ["I don't remember how heaps work", 'Can you help me remember the order of operations?', 'What does it mean to forget a gradient?', 'remembering things is hard'])
      expect(memoryIntent(t), t).toEqual({ remember: [], forget: [] })
  })
})
