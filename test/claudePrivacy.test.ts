import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
const hit = (path: string) => ({ path, title: path, heading: '', text: `about ${path}` })
vi.mock('../src/main/search', async (orig) => ({
  ...(await orig<object>()),
  indexReady: async () => {},
  search: async () => [hit('Secret project/plan.md'), hit('Python/loops.md')],
  getChunks: async (p: string) => [{ ...hit(p), text: `full text of ${p}` }]
}))

const { runTideTool } = await import('../src/main/agent')
const ctx = () => ({ signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'lesson:x' })

describe('what Claude may read: everything, with no private projects held back', () => {
  it('finds every note, a work project’s included', async () => {
    const out = await runTideTool('search_notes', { query: 'plan' }, ctx())
    expect(out).toContain('Python/loops.md')
    expect(out).toContain('Secret project/plan.md')
  })
  it('opens any note', async () => {
    expect(await runTideTool('read_note', { path: 'Secret project/plan.md' }, ctx())).toContain('full text of Secret project/plan.md')
    expect(await runTideTool('read_note', { path: 'Python/loops.md' }, ctx())).toContain('full text of Python/loops.md')
  })
})
