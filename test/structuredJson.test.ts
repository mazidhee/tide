import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-json-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, libraryFolder: 'Library', ai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma', temperature: 0.3 } }) }))

const { extractJsonArray, extractJsonObject, wholeItems, streamCompletion } = await import('../src/main/ai')
const { responseFormat, streamCloud } = await import('../src/main/cloudStream')
const { PLAN_SCHEMA, CLAIMS_SCHEMA } = await import('../src/main/replySchemas')
const { PROVIDERS } = await import('../src/shared/providers')

afterEach(() => vi.unstubAllGlobals())

// Replies recorded from local and cloud models, broken the ways they really break
const REPLIES = {
  trailingCommas: `{"scope": "skill", "coding": true, "why": "Six months at six hours a week.", "phases": [{"title": "Basics", "weeks": 3, "outcome": "Write queries", "project": "A report", "practice": ["Join two tables", "Group by month",],},],}`,
  proseAround: `Sure! Here is the plan you asked for, sized to your hours:\n\n{"scope": "tool", "coding": false, "why": "A single product.", "phases": [{"title": "Dashboards", "weeks": 2, "outcome": "Build one", "project": "Team KPIs", "practice": ["A filter"]}]}\n\nLet me know if you want it shorter [or longer].`,
  singleQuotes: `[{'front': 'What is a monad?', 'back': 'A type with bind and return'}, {'front': "Functor law", 'back': 'fmap id = id'}]`,
  truncatedList: `Here are the cards:\n[{"front": "Big-O of binary search", "back": "O(log n)"}, {"front": "Big-O of merge sort", "back": "O(n log n)"}, {"front": "Big-O of quicksort's worst ca`,
  truncatedObject: `{"ok": false, "errors": [{"quote": "2^10 = 1000", "fix": "2^10 = 1024"}], "unsure": [{"quote": "Python 3.9 added`,
  bracketsInProse: `As noted in [1] and [2], these are the readings:\n[{"title": "SICP", "by": "Abelson"}]`,
  latexAndComma: `[{"front": "Derivative of \\sin x", "back": "\\cos x",}]`,
  fenced: '```json\n{"enrichment": [3, 7, 12]}\n```'
}

describe('reading JSON out of a model reply', () => {
  it('keeps the strict and the old paths for replies that were fine', () => {
    expect(extractJsonObject(REPLIES.fenced)).toEqual({ enrichment: [3, 7, 12] })
    expect(extractJsonArray('[1, 2]')).toEqual([1, 2])
    expect(extractJsonArray<{ front: string; back: string }>('Sure!\n```json\n[{"front":"x","back":"$\\frac{1}{2}$"}]\n```')[0].back).toBe('$\\frac{1}{2}$')
  })

  it('mends trailing commas', () => {
    const plan = extractJsonObject<{ phases: { practice: string[] }[] }>(REPLIES.trailingCommas)
    expect(plan.phases[0].practice).toEqual(['Join two tables', 'Group by month'])
  })

  it('reads JSON with prose around it, brackets in the prose too', () => {
    expect(extractJsonObject<{ scope: string }>(REPLIES.proseAround).scope).toBe('tool')
    expect(extractJsonArray(REPLIES.bracketsInProse)).toEqual([{ title: 'SICP', by: 'Abelson' }])
  })

  it('mends single quotes', () => {
    expect(extractJsonArray<{ front: string }>(REPLIES.singleQuotes).map((c) => c.front)).toEqual(['What is a monad?', 'Functor law'])
  })

  it('keeps the whole items of a list that was cut off, and drops the cut one', () => {
    const cards = extractJsonArray<{ front: string; back: string }>(REPLIES.truncatedList)
    expect(cards).toEqual([
      { front: 'Big-O of binary search', back: 'O(log n)' },
      { front: 'Big-O of merge sort', back: 'O(n log n)' }
    ])
    expect(wholeItems('["a", "b", "c')).toBe('["a", "b"]')
    expect(wholeItems('[1, 2]')).toBeNull()
  })

  it('closes an object that was cut off', () => {
    const check = extractJsonObject<{ ok: boolean; errors: { fix: string }[] }>(REPLIES.truncatedObject)
    expect(check.ok).toBe(false)
    expect(check.errors[0].fix).toBe('2^10 = 1024')
  })

  it('still repairs LaTeX written without escapes', () => {
    expect(extractJsonArray<{ front: string }>(REPLIES.latexAndComma)[0].front).toBe('Derivative of \\sin x')
  })

  it('still says so when there is nothing to read', () => {
    expect(() => extractJsonArray('no json')).toThrow(/did not return a list/)
    expect(() => extractJsonObject('I could not do that.')).toThrow(/expected format/)
  })
})

describe('schemas for cloud replies', () => {
  const target = (provider: string, model = 'm') => ({ provider, model, baseUrl: 'http://cloud.test/v1', apiKey: 'k', extra: {} })

  it('only providers that document structured outputs are sent one', () => {
    const flagged = PROVIDERS.filter((p) => p.jsonSchema).map((p) => p.id)
    expect(flagged.sort()).toEqual(['gemini', 'groq'])
    expect(responseFormat(target('groq'), PLAN_SCHEMA)).toEqual({ response_format: { type: 'json_schema', json_schema: { name: 'study_plan', schema: PLAN_SCHEMA.schema } } })
    expect(responseFormat(target('gemini'), CLAIMS_SCHEMA).response_format).toBeTruthy()
    for (const id of ['nvidia', 'deepseek', 'openrouter', 'qwen', 'kilo', 'my-custom']) expect(responseFormat(target(id), PLAN_SCHEMA)).toEqual({})
    expect(responseFormat(target('groq'))).toEqual({})
  })

  const bodies: Record<string, unknown>[] = []
  function serve(status: (body: Record<string, unknown>) => number) {
    bodies.length = 0
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      const code = status(body)
      if (code !== 200) return new Response(JSON.stringify({ error: { message: 'response_format is not supported' } }), { status: code })
      const enc = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok": true}' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`))
            c.close()
          }
        }),
        { status: 200 }
      )
    })
  }
  const read = async (gen: AsyncGenerator<string>) => {
    let out = ''
    for await (const t of gen) out += t
    return out
  }
  const messages = [{ role: 'user' as const, content: 'Check this.' }]

  it('a cloud request carries it, and a model that refuses it is asked again without', async () => {
    serve(() => 200)
    expect(await read(streamCloud(target('groq', 'a'), messages, new AbortController().signal, 500, 0, 'maths', CLAIMS_SCHEMA))).toBe('{"ok": true}')
    expect(bodies[0].response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'claim_check' } })

    serve(() => 200)
    await read(streamCloud(target('nvidia', 'a'), messages, new AbortController().signal, 500, 0, 'maths', CLAIMS_SCHEMA))
    expect(bodies[0].response_format).toBeUndefined()

    serve((b) => (b.response_format ? 400 : 200))
    expect(await read(streamCloud(target('groq', 'picky'), messages, new AbortController().signal, 500, 0, 'maths', CLAIMS_SCHEMA))).toBe('{"ok": true}')
    expect(bodies.map((b) => !!b.response_format)).toEqual([true, false])
    // And it isn't sent to that model again
    serve(() => 200)
    await read(streamCloud(target('groq', 'picky'), messages, new AbortController().signal, 500, 0, 'maths', CLAIMS_SCHEMA))
    expect(bodies[0].response_format).toBeUndefined()
  })

  it('never goes to the local server, which refuses it while the draft model is on', async () => {
    serve(() => 200)
    await read(streamCompletion(messages, new AbortController().signal, 500, true, 0, 'planning', null, PLAN_SCHEMA))
    expect(bodies).toHaveLength(1)
    expect(bodies[0].model).toBe('gemma')
    expect(bodies[0].response_format).toBeUndefined()
  })
})
