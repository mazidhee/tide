import { afterEach, describe, expect, it } from 'vitest'
import type { ReviewItem } from '@shared/review'
import { parseRerank, rankPrior, rerankPool, rerankPrompt, RERANK_SYSTEM, warmupCards, type PriorConcept } from '@shared/warmup'
import { forgetReranks, rerank, setReranker } from '../src/main/warmup'

/**
 * The two warm-ups the learner reported on 13 Nov, from their real knowledge map: a Docker lesson
 * warmed up on hexadecimal, and a pandas lesson on "the key idea of Introduction to Machine
 * Learning", which wasn't even related. Same subject and a stray search hit are not relevance.
 */
const NOV10 = new Date(2026, 10, 10).getTime()
const NOV12 = new Date(2026, 10, 12).getTime()
// As the real map has them: the hex roadmap topic (studied, in Software Engineering) and the ML course lesson
const hex: PriorConcept = {
  id: 'software engineering::foundations of computation > how computers work::binary hexadecimal number representations',
  name: 'Binary, hexadecimal, number representations',
  area: 'Software Engineering',
  estimate: 0.62,
  status: 'learning',
  seen: 29,
  firstSeen: NOV10,
  lastSeen: NOV12,
  steps: ['Place value in base 2', 'Hex digits as four bits', 'Converting between bases']
}
const ml: PriorConcept = { id: 'lesson::::introduction to machine learning', name: 'Introduction to Machine Learning', area: '', estimate: 0.5, status: 'learning', seen: 1, firstSeen: NOV12, lastSeen: NOV12, steps: [] }
const hexCard: ReviewItem = { kind: 'card', id: 'hex1', topic: '', question: 'What is the decimal value of the hexadecimal number $2A$?', answer: '42', path: 'Flashcards/Binary.md', due: NOV12 }
// What made them come up before: the same subject, and a past lesson page a search for the topic hit
const studied = [
  { ...hex, searched: 1 },
  { ...ml, searched: 1 }
]

afterEach(() => {
  setReranker(null)
  forgetReranks()
})

describe('warm-ups only on what a lesson really builds on', () => {
  it('Docker gets no hex warm-up without Claude: same subject and a search hit are not enough', () => {
    expect(rankPrior('docker', studied, 'Software Engineering')).toEqual([])
    expect(warmupCards(rankPrior('docker', studied, 'Software Engineering'), new Map([[hex.id, [hexCard]]]))).toEqual([])
  })

  it('pandas gets no "key idea of Introduction to Machine Learning" card', () => {
    const ranked = rankPrior('pandas', studied, 'Software Engineering')
    expect(ranked).toEqual([])
    // Even if it had come up, a concept with nothing kept gives no card at all
    expect(warmupCards([ml], new Map())).toEqual([])
  })

  it("Claude's judgement is a filter: what it leaves out stays out, even when names match", () => {
    const binaryLesson = { ...hex, id: 'b2', name: 'Binary arithmetic' }
    const pool = rerankPool('Binary search', [binaryLesson, ...studied], 'Software Engineering')
    expect(rankPrior('Binary search', pool, 'Software Engineering', 4, []).map((c) => c.id)).toEqual([])
    // Claude says hex is related to Rust's integer types: then, and only then, it comes up
    expect(rankPrior('Rust integer types and overflow', studied, 'Software Engineering', 4, [hex.id]).map((c) => c.id)).toEqual([hex.id])
  })

  it('a roadmap prerequisite comes up even without Claude', () => {
    expect(rankPrior('docker', [{ ...hex, prerequisite: true }], 'Software Engineering').map((c) => c.id)).toEqual([hex.id])
  })

  it('Docker and pandas: Claude answering [] means no warm-up', async () => {
    setReranker(async () => '{"related": []}')
    for (const topic of ['docker', 'pandas']) {
      const pool = rerankPool(topic, studied, 'Software Engineering')
      const picked = await rerank(topic, pool, 500)
      expect(picked).toEqual([])
      expect(rankPrior(topic, studied, 'Software Engineering', 4, picked)).toEqual([])
    }
  })

  it('asks Haiku for real prerequisites or close links, and that [] is fine', () => {
    const p = rerankPrompt('docker', rerankPool('docker', studied))
    expect(p).toMatch(/genuinely build on/)
    expect(p).toMatch(/\[\] is a fine answer/)
    expect(RERANK_SYSTEM).toMatch(/same broad field is not a link/i)
    expect(parseRerank('{"related": []}', rerankPool('docker', studied))).toEqual([])
  })
})
