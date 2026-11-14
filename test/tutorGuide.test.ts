/**
 * The tutor's guide in layers (shared/tutorGuide): core pedagogy always, the format in lessons,
 * only the tools a session is given (and the same tools listed by Tide's MCP server), the picture
 * guides where they can be used, subject modules only where they apply. Pure parts here; the
 * server's listing with Tide's real tools.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-guide-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, libraryFolder: 'Library', ai: { claude: {} } }), updateSettings: () => {} }))

const G = await import('../src/shared/tutorGuide')
const { claudeSystemBase, CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM, stableSystem } = await import('../src/shared/tutorPrompt')
const { SIM_GUIDE } = await import('../src/shared/sims')
const { VISUAL_GUIDE } = await import('../src/shared/visuals')
const { SESSION_FORMAT, sessionInstructions } = await import('../src/shared/session')
const { forClaude } = await import('../src/shared/exercises')
const { TOOLKITS, withoutQuantToolkit } = await import('../src/shared/subjects')
const { mcpConfig } = await import('../src/main/claudeCli')
const mcp = await import('../src/main/tideMcp')

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const names = async (key: string, packs?: string) => (await mcp.toolsFor(key, packs)).map((t) => t.name)

describe('which tools a session is given', () => {
  it('a side thread gets a handful; a history lesson no maths, data or chat tools; a maths lesson its maths tools', () => {
    const tools = (s: Parameters<typeof G.toolPacks>[0]) => [...G.packTools(G.toolPacks(s))]
    expect(tools({ kind: 'thread' }).sort()).toEqual(['read_note', 'related_notes', 'run_code', 'save_to_notes', 'search_notes'])
    expect(tools({ kind: 'thread', data: true })).toContain('run_sql')
    const history = tools({ kind: 'lesson', humanities: true })
    expect(history).toEqual(expect.arrayContaining(['set_exercise', 'lesson_progress', 'learner_profile', 'search_notes']))
    for (const t of ['place_explorable', 'render_animation', 'run_sql', 'remember', 'record_answer', 'metabase', 'save_to_notes']) expect(history, t).not.toContain(t)
    const maths = tools({ kind: 'lesson', maths: true })
    expect(maths).toEqual(expect.arrayContaining(['place_explorable', 'set_challenge', 'check_graph', 'render_animation']))
    // A finance lesson that draws graphs but isn't in maths mode: only the graph check
    const pay = tools({ kind: 'lesson', graphs: true, data: true })
    expect(pay).toContain('check_graph')
    expect(pay).not.toContain('place_explorable')
    expect(pay).toContain('run_sql')
    // A chat: the learner's own tools, not the lesson map
    const chat = tools({ kind: 'chat' })
    expect(chat).toEqual(expect.arrayContaining(['remember', 'study_plan', 'record_answer', 'make_flashcards', 'run_sql']))
    expect(chat).not.toContain('lesson_progress')
    expect(tools({ kind: 'chat', metabase: true })).toContain('metabase')
    expect(tools({ kind: 'lesson' })).not.toContain('metabase')
  })

  it('travels in the MCP config as a header, and only known packs count', () => {
    const cfg = JSON.parse(mcpConfig(5, 't', 'lab:x', G.packsHeader(['notes', 'run'])))
    expect(cfg.mcpServers.tide.headers['X-Tide-Tools']).toBe('notes,run')
    expect(JSON.parse(mcpConfig(5, 't', 'lab:x')).mcpServers.tide.headers['X-Tide-Tools']).toBeUndefined()
    expect(G.parsePacks('notes, nonsense ,run')).toEqual(['notes', 'run'])
    expect(G.parsePacks('')).toBeNull()
    expect(G.parsePacks('nonsense')).toBeNull()
  })

  it('Tide’s server lists only the packs’ tools; with no packs (Claude Code in a terminal) all of them', async () => {
    const all = await names('lab:x')
    expect(all.length).toBeGreaterThan(25)
    const thread = await names('thread:x', G.packsHeader(G.toolPacks({ kind: 'thread' })))
    expect(thread.sort()).toEqual(['read_note', 'related_notes', 'run_code', 'save_to_notes', 'search_notes'])
    const history = await names('lab:x', G.packsHeader(G.toolPacks({ kind: 'lesson', humanities: true })))
    expect(history.length).toBeLessThan(all.length - 8)
    expect(history).not.toContain('place_explorable')
    // A notebook's margin tutor: the notebook's tools, the notes and the learner's, not a lesson's
    const nb = await names('nb:s1')
    expect(nb).toEqual(expect.arrayContaining(['read_notebook', 'run_scratch', 'propose_cell', 'set_exercise', 'search_notes', 'learner_profile']))
    expect(nb).not.toContain('run_code')
    expect(nb).not.toContain('render_animation')
    expect(nb.filter((n) => n === 'set_exercise')).toHaveLength(1)
  })

  it('set_exercise speaks of Metabase only where Metabase is one of the tools', async () => {
    const desc = async (packs?: string) => (await mcp.toolsFor('lab:x', packs)).find((t) => t.name === 'set_exercise')!.description
    expect(await desc()).toMatch(/metabase \(only while/)
    const lesson = await desc(G.packsHeader(G.toolPacks({ kind: 'lesson' })))
    expect(lesson).not.toMatch(/Metabase/)
    expect(lesson).toMatch(/Proof by kind: code/)
    expect(lesson).toMatch(/If it fails, fix it and call again with repair_of/)
  })
})

describe('the prompt, in layers', () => {
  it('core pedagogy says each teaching move once, short', () => {
    for (const move of [/First principles/, /Socratic/, /Predict, then reveal/, /Worked, then faded, then solo/, /They do the work/, /Feedback quotes their words/, /move on instead of drilling/, /Honour "move on"/, /Never answer the question you are asking them/, /work the step that disproves it/, /Learning comes first/]) expect(G.CORE_PEDAGOGY).toMatch(move)
    expect(words(G.CORE_PEDAGOGY)).toBeLessThan(380)
  })

  it('describes each tool it has once, and none it hasn’t', () => {
    for (const shape of [{ kind: 'lesson' }, { kind: 'lesson', maths: true, data: true }, { kind: 'chat' }, { kind: 'thread' }] as const) {
      const packs = G.toolPacks(shape)
      const ref = G.toolReference(packs)
      const have = G.packTools(packs)
      for (const t of have) expect(ref.split('\n').filter((l) => new RegExp(`\\b${t}\\b`).test(l)).length, `${shape.kind} ${t}`).toBe(1)
      for (const t of Object.values(G.PACK_TOOLS).flat()) if (!have.has(t)) expect(ref, `${shape.kind} ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`))
    }
  })

  it('a lesson has the format rules and the custom visuals, not the whole simulation guide; a chat has the simulations; a thread draws visuals but has no simulations', () => {
    const lesson = stableSystem(CLAUDE_LESSON_SYSTEM, { today: new Date(2026, 10, 13), web: true, session: true })
    expect(lesson).toContain(SESSION_FORMAT.slice(0, 80))
    expect(lesson).toContain(VISUAL_GUIDE)
    expect(lesson).not.toContain(SIM_GUIDE.slice(0, 120))
    expect(CLAUDE_TUTOR_SYSTEM).toContain(SIM_GUIDE)
    const thread = claudeSystemBase({ kind: 'thread' })
    expect(thread).toContain(VISUAL_GUIDE.slice(0, 80))
    expect(thread).toMatch(/Asked for a visual/)
    expect(thread).not.toContain(SIM_GUIDE.slice(0, 80))
    // The visual guide mentions <ask>; a thread's own rules (THREAD_RULES) forbid lesson tags
    expect(thread.replace(VISUAL_GUIDE, '')).not.toMatch(/<ask|<grade/)
    expect(words(thread.replace(VISUAL_GUIDE, ''))).toBeLessThan(300)
    // Taught as the humanities: no custom visuals
    expect(claudeSystemBase({ kind: 'lesson', humanities: true })).not.toContain(VISUAL_GUIDE.slice(0, 80))
  })

  it('stays small: the stable part of a lesson’s prompt, before the learner, under budget', () => {
    const lesson = forClaude(stableSystem(claudeSystemBase({ kind: 'lesson', maths: true }), { today: new Date(2026, 10, 13), web: true, session: true }))
    // Was some 26,000 characters with the whole simulation guide and every tool's line; the computing kit's guide (TideMachine) added some 700
    expect(lesson.length).toBeLessThan(19_800)
    const history = forClaude(stableSystem(claudeSystemBase({ kind: 'lesson', humanities: true }), { today: new Date(2026, 10, 13), web: true, session: true }))
    expect(history.length).toBeLessThan(10_500)
    // Each lesson rule said once: the exercise rule, the citation rule
    expect(lesson.match(/banked_exercise for one verified before/g)).toHaveLength(1)
    expect(lesson).not.toMatch(/numbered like \[3\]/)
  })

  it('a maths lesson’s instructions lose the quant toolkit Claude’s maths mode already says; other toolkits stay', () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Bond pricing and yield to maturity' })
    expect(s).toContain(TOOLKITS.quant.rules)
    const c = withoutQuantToolkit(s)
    expect(c).not.toContain(TOOLKITS.quant.rules)
    expect(c).toMatch(/How to teach this subject \(a profession's standards and practice\):/)
    expect(c).toContain(TOOLKITS.domain.rules)
    expect(withoutQuantToolkit('no toolkit here')).toBe('no toolkit here')
  })

  it('a history lesson isn’t taught hands-on, and gets no code or SQL guide', () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Augustine, Confessions book 8: the conversion' })
    expect(s).toMatch(/<appraise>/)
    expect(s).not.toMatch(/run_sql|teach it hands-on/)
    expect(s).not.toMatch(/blockchain|Merkle/)
  })
})
