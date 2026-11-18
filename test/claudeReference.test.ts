/**
 * The offline reference reaches Claude, not only Gemma: Tide's MCP server lists reference_lookup
 * for every kind of Claude session, Claude's system prompt says when to use it, and a question
 * about what the docs or the source say carries the line that sends the tutor there first.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-ref-claude-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, libraryFolder: 'Library', ai: { claude: {} } }), updateSettings: () => {} }))

const { toolPacks, packsHeader } = await import('../src/shared/tutorGuide')
const { claudeSystemBase, CLAUDE_TUTOR_SYSTEM, CLAUDE_LESSON_SYSTEM } = await import('../src/shared/tutorPrompt')
const { forClaude } = await import('../src/shared/exercises')
const { referenceHint } = await import('../src/shared/reference')
const mcp = await import('../src/main/tideMcp')

const SHAPES = [{ kind: 'chat' }, { kind: 'lesson' }, { kind: 'thread' }, { kind: 'lesson', placement: true }] as const

describe('Claude and the offline reference', () => {
  it("Tide's MCP server lists reference_lookup for every kind of Claude session", async () => {
    for (const shape of SHAPES) {
      const tools = await mcp.toolsFor(`lesson:${shape.kind}`, packsHeader(toolPacks(shape)))
      const ref = tools.find((t) => t.name === 'reference_lookup')
      expect(ref, shape.kind).toBeTruthy()
      expect(ref!.description).toMatch(/Python 3\.15 docs/)
      expect(Object.keys((ref!.inputSchema as { properties: object }).properties)).toEqual(['query', 'source'])
    }
    // A notebook's margin tutor gets the notes pack too
    expect((await mcp.toolsFor('nb:x')).some((t) => t.name === 'reference_lookup')).toBe(true)
  }, 60_000)

  it("Claude's system prompt says when to use it", () => {
    for (const system of [CLAUDE_TUTOR_SYSTEM, CLAUDE_LESSON_SYSTEM, claudeSystemBase({ kind: 'thread' })]) {
      expect(forClaude(system)).toMatch(/reference_lookup: for language rules, quote the official docs or CPython source and cite it/)
    }
  })

  it('a question about the docs or the source sends the tutor to reference_lookup first', () => {
    expect(referenceHint('What does the data model say about __hash__?')).toMatch(/call reference_lookup first/)
    expect(referenceHint('How is an int implemented in CPython?')).toMatch(/call reference_lookup \(source "cpython"\) first/)
    expect(referenceHint('Can you quiz me on recursion?')).toBe('')
  })
})
