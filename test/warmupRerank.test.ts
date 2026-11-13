import { afterEach, describe, expect, it } from 'vitest'
import { parseRerank, rankPrior, rerankPool, rerankPrompt, rerankWorthIt, type PriorConcept } from '@shared/warmup'
import { forgetReranks, rerank, setReranker } from '../src/main/warmup'

const concept = (id: string, name: string, extra: Partial<PriorConcept> = {}): PriorConcept => ({ id, name, area: 'Finance', estimate: 0.6, status: 'learning', seen: 3, steps: [], lastSeen: 1, ...extra })
const studied = [concept('bank-runs', 'Bank runs and deposit insurance', { steps: ['Diamond-Dybvig model'] }), concept('hex', 'Binary and hexadecimal', { area: 'CS' }), concept('mmf', 'Money market funds', { steps: ['Breaking the buck'] }), concept('joins', 'SQL joins', { area: 'Data' })]
const TOPIC = 'Stablecoin redemption runs'

afterEach(() => {
  setReranker(null)
  forgetReranks()
})

describe("the warm-up's rerank on Claude", () => {
  it('names alone miss groundwork that is called something else', () => {
    expect(rankPrior(TOPIC, studied, 'Crypto').map((c) => c.id)).not.toContain('mmf')
  })

  it("Claude's pick brings it in, most related first, and leaves the unrelated out", () => {
    const pool = rerankPool(TOPIC, studied, 'Crypto')
    const ids = parseRerank('{"related": [3, 1]}', pool.map((c) => c) as PriorConcept[])
    const ranked = rankPrior(TOPIC, studied, 'Crypto', 4, ids)
    expect(ranked.map((c) => c.id)).toContain('mmf')
    expect(ranked.map((c) => c.id)).toContain('bank-runs')
    expect(ranked.map((c) => c.id)).not.toContain('hex')
  })

  it('the prompt numbers the pool, and a reply it cannot read is null', () => {
    const pool = rerankPool(TOPIC, studied)
    expect(rerankPrompt(TOPIC, pool)).toMatch(/1\. .+\n2\. /)
    expect(rerankPrompt(TOPIC, pool)).toContain('(covered: Diamond-Dybvig model)')
    expect(parseRerank('no idea', pool)).toBeNull()
    expect(parseRerank('```json\n{"related": [2, 2, 99]}\n```', pool)).toEqual([pool[1].id])
  })

  it("isn't asked when names already fill the warm-up, or there's nothing studied", () => {
    expect(rerankWorthIt(TOPIC, [], 'Crypto')).toBe(false)
    const named = [1, 2, 3, 4].map((n) => concept(`s${n}`, `Stablecoin redemption runs part ${n}`))
    expect(rerankWorthIt('Stablecoin redemption runs', named, 'Finance', 4)).toBe(false)
    expect(rerankWorthIt(TOPIC, rerankPool(TOPIC, studied), 'Crypto')).toBe(true)
  })

  it('falls back to names past its time limit, and keeps the late answer for next time', async () => {
    let calls = 0
    setReranker(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 60))
      return '{"related": [2]}'
    })
    const pool = rerankPool(TOPIC, studied)
    expect(await rerank(TOPIC, pool, 10)).toBeNull()
    await new Promise((r) => setTimeout(r, 80))
    expect(await rerank(TOPIC, pool, 10)).toEqual([pool[1].id])
    expect(calls).toBe(1)
  })

  it('no Claude, or Claude failing: null, and names decide', async () => {
    setReranker(async () => null)
    expect(await rerank(TOPIC, rerankPool(TOPIC, studied), 500)).toBeNull()
    forgetReranks()
    setReranker(async () => {
      throw new Error('limit')
    })
    expect(await rerank(TOPIC, rerankPool(TOPIC, studied), 500)).toBeNull()
  })
})
