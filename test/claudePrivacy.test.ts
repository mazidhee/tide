import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
const hit = (path: string) => ({ path, title: path, heading: '', text: `about ${path}` })
vi.mock('../src/main/search', async (orig) => ({
  ...(await orig<object>()),
  indexReady: async () => {},
  search: async () => [hit('Secret project/plan.md'), hit('Python/loops.md')],
  getChunks: async (p: string) => [{ ...hit(p), text: `full text of ${p}` }]
}))
vi.mock('../src/main/projects', async (orig) => ({ ...(await orig<object>()), privatePath: async (p: string) => p.startsWith('Secret project') }))

const { runTideTool } = await import('../src/main/agent')
const ctx = () => ({ signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'lesson:x' })

describe('what Claude may read', () => {
  it("never finds a private project's notes", async () => {
    const out = await runTideTool('search_notes', { query: 'plan' }, ctx())
    expect(out).toContain('Python/loops.md')
    expect(out).not.toContain('Secret project')
  })
  it("can't open a private project's note", async () => {
    expect(await runTideTool('read_note', { path: 'Secret project/plan.md' }, ctx())).toMatch(/private project/)
    expect(await runTideTool('read_note', { path: 'Python/loops.md' }, ctx())).toContain('full text of Python/loops.md')
  })
})
