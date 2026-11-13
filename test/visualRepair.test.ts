/**
 * Claude's visuals in main: where they may run (every lesson), one repair and a
 * fallback through the stand-in CLI, and each lesson's kept visuals in its record.
 */
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'tide-visuals-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, '.tide', 'lessons'), { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))
vi.mock('../src/main/claudeCli', async (orig) => ({ ...(await orig<object>()), checkClaude: async () => ({ installed: true, loggedIn: true, checkedAt: Date.now() }) }))

const engine = await import('../src/main/claudeEngine')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude.mjs'))
const { visualPolicy, repairVisual, visualFallback, lessonVisuals, rememberVisual } = await import('../src/main/visuals')
const { saveLesson, getLesson } = await import('../src/main/lessons')

const calls = () => (existsSync(join(root, 'claude-usage.jsonl')) ? readFileSync(join(root, 'claude-usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { model: string; role: string }) : [])
const BROKEN = `<title>Split</title><svg viewBox="0 0 10 10"></svg><script>visual.report('a'); undefinedThing.call();</script>`
const open = { kind: 'folder' as const, path: 'Algorithms' }
const secret = { kind: 'folder' as const, path: 'Secret project' }

describe('where visuals run', () => {
  it('in an ordinary lesson, with Claude to repair them', async () => {
    expect(await visualPolicy()).toEqual({ show: true, repair: true })
  })
  it('in a once-private notebook too, repaired by Claude like any other', async () => {
    const before = calls().length
    expect(await visualPolicy()).toMatchObject({ show: true, repair: true })
    expect(await repairVisual({ code: BROKEN, errors: ['undefinedThing is not defined'], scope: secret })).not.toBeNull()
    expect(calls().length).toBe(before + 1)
  })
})

describe('repair and fallback', () => {
  it('sends the visual and its errors to Claude once, on the teaching model, and takes back the fixed block', async () => {
    const before = calls().length
    const r = await repairVisual({ code: BROKEN, errors: ['undefinedThing is not defined (line 1)'], scope: open })
    expect(r?.code).toBe(`<title>Split</title><svg viewBox="0 0 10 10"></svg><script>visual.report('a'); </script>`)
    const used = calls().slice(before)
    expect(used).toHaveLength(1)
    expect(used[0]).toMatchObject({ role: 'teach' })
  })

  it('a reply without a whole visual block is no repair', async () => {
    expect(await repairVisual({ code: '', errors: [], scope: open })).toBeNull()
  })

  it('falls back to a mermaid diagram on the background model', async () => {
    const md = await visualFallback({ code: BROKEN, title: 'Split', scope: open })
    expect(md).toMatch(/```mermaid\nflowchart LR\n {2}A\["haiku"\] --> B\["fallback"\]/)
    expect(calls().pop()).toMatchObject({ role: 'background' })
  })
})

describe("a lesson's kept visuals", () => {
  const turns = [
    { role: 'user' as const, content: 'Teach me B-trees' },
    { role: 'assistant' as const, content: '```visual\n' + BROKEN + '\n```' }
  ]
  it('keeps one checked before the lesson was first saved, and then with the record', async () => {
    expect(await rememberVisual('btrees-1', 'vabcdef12', { status: 'ok', code: '<svg></svg>', at: 1 })).toBe(true)
    await saveLesson({ id: 'btrees-1', mode: 'teach', topic: 'B-trees', scope: open, turns })
    expect((await getLesson('btrees-1'))?.visuals).toEqual({ vabcdef12: { status: 'ok', code: '<svg></svg>', at: 1 } })
  })

  it('adds more, and a later save from the window (which never sends them) keeps them', async () => {
    await rememberVisual('btrees-1', 'vfallback1', { status: 'fallback', fallback: '```mermaid\nA-->B\n```', at: 2 })
    await saveLesson({ id: 'btrees-1', mode: 'teach', topic: 'B-trees', scope: open, turns: [...turns, { role: 'user', content: 'Answer: 3' }, { role: 'assistant', content: 'Right.' }] })
    const kept = await lessonVisuals('btrees-1')
    expect(Object.keys(kept).sort()).toEqual(['vabcdef12', 'vfallback1'])
    expect((await getLesson('btrees-1'))?.turns).toHaveLength(4)
  })

  it('a save and a kept visual at the same moment both land', async () => {
    await Promise.all([
      saveLesson({ id: 'btrees-1', mode: 'teach', topic: 'B-trees', scope: open, turns: [...turns, { role: 'user', content: 'Answer: 3' }, { role: 'assistant', content: 'Right.' }, { role: 'user', content: 'Go on.' }, { role: 'assistant', content: 'Next.' }] }),
      rememberVisual('btrees-1', 'vsame0time', { status: 'ok', at: 3 })
    ])
    const r = await getLesson('btrees-1')
    expect(r?.turns).toHaveLength(6)
    expect(Object.keys(r?.visuals ?? {})).toContain('vsame0time')
  })

  it('refuses bad keys and records', async () => {
    expect(await rememberVisual('btrees-1', '../../x', { status: 'ok', at: 1 })).toBe(false)
    expect(await rememberVisual('btrees-1', 'vgoodkey1', { status: 'run' })).toBe(false)
    expect(await lessonVisuals('no-such-lesson')).toEqual({})
  })
})
