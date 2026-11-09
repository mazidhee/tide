import { describe, expect, it } from 'vitest'
import { costOf, escalationFor, modelPrice, providerInfo, DEFAULT_CLOUD } from '../src/shared/providers'

describe('when a turn goes to the stronger model', () => {
  it('worked maths in answer to a problem', () => {
    expect(escalationFor('P(at least one six) = 4 × 1/6 = 2/3\nso it is likely', 'problem')).toBe('maths')
    expect(escalationFor('By induction: assume it holds for n, then for n+1 we get $\\sum k = n(n+1)/2 + (n+1)$', 'explain')).toBe('maths')
  })
  it('asking where the mistake is, or answering a find-the-error question', () => {
    expect(escalationFor('Check my working: d/dx x^2 sin x = 2x cos x because I multiply the derivatives')).toBe('errors')
    expect(escalationFor('The bug is that the loop never updates the left pointer so it spins forever', 'error')).toBe('errors')
  })
  it('stays local for short answers, hints and ordinary questions', () => {
    expect(escalationFor('O(log n)', 'short')).toBeNull()
    expect(escalationFor("I don't know, can you explain it differently please?", 'problem')).toBeNull()
    expect(escalationFor('Can you explain what a hash map is and when I would use one in practice?')).toBeNull()
  })
})

describe('what a request costs', () => {
  it('prices input, cached input and output per million tokens', () => {
    expect(costOf({ input: 0.15, output: 0.6 }, { input: 1_000_000, output: 500_000 })).toBeCloseTo(0.45)
    expect(costOf({ input: 1, output: 4, cachedInput: 0.1 }, { input: 1000, output: 0, cached: 800 })).toBeCloseTo((200 * 1 + 800 * 0.1) / 1e6)
  })
  it('an unknown price is unknown, not zero', () => {
    expect(costOf(undefined, { input: 10, output: 10 })).toBeUndefined()
    expect(modelPrice('deepseek', 'deepseek-chat')).toBeUndefined()
  })
  it('your own prices override the catalogue, and custom providers work', () => {
    const settings = { ...DEFAULT_CLOUD, providers: { deepseek: { prices: { 'deepseek-chat': { input: 0.3, output: 1.2 } } }, mine: { name: 'My server', baseUrl: 'https://llm.example/v1', models: ['big'] } } }
    expect(modelPrice('deepseek', 'deepseek-chat', settings)).toEqual({ input: 0.3, output: 1.2 })
    expect(providerInfo('mine', settings)).toMatchObject({ name: 'My server', baseUrl: 'https://llm.example/v1', models: [{ id: 'big' }] })
  })
})

describe('who answers a job', () => {
  it('spreads jobs over NVIDIA models, then its other models, then other providers', async () => {
    const { jobLine, DEFAULT_CLOUD } = await import('../src/shared/providers')
    const s = { ...DEFAULT_CLOUD, provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' }
    const keys = { nvidia: true, groq: true }
    const maths = jobLine(s, keys, 'maths')
    expect(maths[0]).toEqual({ provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' })
    expect(maths[1]).toEqual({ provider: 'nvidia', model: 'moonshotai/kimi-k2.6' })
    expect(maths.at(-1)).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' })
    expect(maths.filter((t) => t.provider === 'nvidia')).toHaveLength(4)
    expect(jobLine(s, keys, 'marking')[0].model).toBe('z-ai/glm-5.3-flash')
    expect(jobLine(s, keys, 'errors')[0].model).toBe('moonshotai/kimi-k2.6')
    // Your own choice for a job wins; providers without a key are left out
    expect(jobLine({ ...s, taskModels: { maths: 'z-ai/glm-5.3-flash' } }, keys, 'maths')[0].model).toBe('z-ai/glm-5.3-flash')
    expect(jobLine(s, { nvidia: true }, 'maths').every((t) => t.provider === 'nvidia')).toBe(true)
  })
})
