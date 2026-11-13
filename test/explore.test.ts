import { mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { cleanTitle, curiosityOpening, fallbackTitle, fromLine, newExploreItem, sortExplore, type ExploreItem } from '../src/shared/explore'
import { openingMessage, sessionInstructions, strategyChoice } from '../src/shared/session'

const root = mkdtempSync(join(tmpdir(), 'tide-explore-'))
const vault = join(root, 'vault')
mkdirSync(vault, { recursive: true })
const sent: string[] = []
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [{ webContents: { isDestroyed: () => false, send: (c: string) => sent.push(c) } }] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))
const titles: { prompt: string; args: number }[] = []
vi.mock('../src/main/claudeEngine', () => ({
  backgroundOnClaude: async (prompt: string, ...rest: unknown[]) => {
    titles.push({ prompt, args: rest.length + 1 })
    return /metabase/i.test(prompt) ? 'Metabase question ids.' : 'Why the Babylonians counted in 60s.'
  }
}))
vi.mock('../src/main/ai', () => ({ complete: async () => 'Title: Metabase question ids' }))

const BABYLON = 'The Babylonians used base 60. That is where 60 minutes and 360 degrees come from. The Maya used base 20.'
const from = { lesson: 'abc123', topic: 'Binary, hexadecimal and other bases', mode: 'teach' as const, turn: 5 }
const settle = () => new Promise((r) => setTimeout(r, 30))

describe('explore later: the item', () => {
  it('keeps the text, the first words as a title, the link back and the date', () => {
    const x = newExploreItem({ text: `**${BABYLON}**`, subject: 'Maths', from }, Date.UTC(2026, 10, 12))
    expect(x.text).toBe(BABYLON)
    expect(x.title).toBe('The Babylonians used base 60')
    expect(x.subject).toBe('Maths')
    expect(x.from).toEqual(from)
    expect(x.at).toBe(Date.UTC(2026, 10, 12))
  })

  it('makes a fallback title from a long sentence', () => {
    expect(fallbackTitle('the quick brown fox jumps over the lazy dog again and again')).toBe('The quick brown fox jumps over the…')
    expect(fallbackTitle('')).toBe('Something to explore')
  })

  it('takes the model’s title only when it is one', () => {
    expect(cleanTitle('"Why the Babylonians counted in 60s."')).toBe('Why the Babylonians counted in 60s')
    expect(cleanTitle('<think>hm</think>\nTitle: base 20 in Maya numerals')).toBe('Base 20 in Maya numerals')
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('This is not a title at all because it goes on and on for far too many words')).toBeNull()
  })

  it('says where it came from and when', () => {
    expect(fromLine({ from, at: Date.UTC(2026, 10, 12, 12) }, Date.UTC(2026, 10, 13))).toBe('from Binary, hexadecimal and other bas… · 12 Nov')
    expect(fromLine({ from: { topic: 'Logic' }, at: Date.UTC(2025, 0, 3, 12) }, Date.UTC(2026, 10, 13))).toBe('from Logic · 3 Jan 2025')
  })

  it('lists what is still to explore first, newest first', () => {
    const a = { id: 'a', at: 1 } as ExploreItem
    const b = { id: 'b', at: 2 } as ExploreItem
    const c = { id: 'c', at: 3, explored: { at: 9, topic: 'x' } } as ExploreItem
    expect(sortExplore([c, a, b]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('explore later: the side lesson', () => {
  const curiosity = { id: 'x1', text: BABYLON, from }
  const setup = { mode: 'teach' as const, topic: 'Why the Babylonians counted in 60s', options: { curiosity } }

  it('is short and for curiosity: no probe, no plan, no big picture', () => {
    const rules = sessionInstructions(setup)
    expect(rules).toMatch(/SIDE LESSON, just for curiosity/)
    expect(rules).toMatch(/10 to 15 minutes/)
    expect(rules).toContain(BABYLON)
    expect(rules).toContain('Binary, hexadecimal and other bases')
    expect(rules).toMatch(/<summary>/)
    expect(rules).not.toMatch(/PROBE|<plan>|Why this matters/)
  })

  it('opens from what was said, and is never routed to another way of teaching', () => {
    expect(openingMessage(setup)).toBe(curiosityOpening(setup.topic, curiosity))
    expect(openingMessage(setup)).toMatch(/^This came up in my lesson on Binary, hexadecimal and other bases and I'm curious: "The Babylonians/)
    expect(strategyChoice(setup, { kind: 'none' })).toBeNull()
  })
})

describe('explore later: kept in the vault', async () => {
  const store = await import('../src/main/explore')
  const { saveLesson } = await import('../src/main/lessons')
  const file = () => JSON.parse(readFileSync(join(vault, '.tide', 'explore.json'), 'utf8')) as ExploreItem[]

  it('saves an item at once and titles it in the background', async () => {
    const x = await store.addExplore({ text: BABYLON, subject: 'Maths', from })
    expect(x.title).toBe('The Babylonians used base 60')
    expect(file()[0].id).toBe(x.id)
    await settle()
    expect(file()[0]).toMatchObject({ id: x.id, title: 'Why the Babylonians counted in 60s', titled: true })
    expect(titles[0].args).toBe(3)
    expect(sent).toContain('explore:changed')
  })

  it('titles a work or Metabase item on Claude like any other, with no private flag or scope kept', async () => {
    const x = await store.addExplore({ text: 'Metabase stores questions by id.', from: { topic: 'Our Metabase' } })
    expect(x).not.toHaveProperty('private')
    expect(x).not.toHaveProperty('scope')
    await settle()
    expect(titles.at(-1)?.prompt).toMatch(/Metabase/)
    expect((await store.listExplore()).find((i) => i.id === x.id)?.title).toBe('Metabase question ids')
  })

  it('marks the item explored when its side lesson finishes, linked to it', async () => {
    const first = (await store.listExplore()).find((i) => /Babylonians/.test(i.text))!
    const lesson = { id: 'side1', mode: 'teach' as const, topic: first.title, scope: { kind: 'none' as const }, options: { curiosity: { id: first.id, text: first.text, from: first.from } } }
    await saveLesson({ ...lesson, turns: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'Sixty divides well.' }], finished: false })
    expect((await store.listExplore()).find((i) => i.id === first.id)?.explored).toBeUndefined()
    await saveLesson({ ...lesson, turns: [{ role: 'user', content: 'go' }, { role: 'assistant', content: '<summary>done</summary>' }], finished: true })
    const done = (await store.listExplore()).find((i) => i.id === first.id)!
    expect(done.explored).toMatchObject({ lesson: 'side1', topic: first.title })
    // Explored ones go to the end of the list
    expect((await store.listExplore()).at(-1)?.id).toBe(first.id)
  })

  it('removes an item', async () => {
    const before = await store.listExplore()
    const after = await store.removeExplore(before[0].id)
    expect(after).toHaveLength(before.length - 1)
  })
})

describe('a side lesson says what it is', () => {
  it('its header reads "Side lesson", not "Teach me"; other lessons are unchanged', async () => {
    const { modeLabel } = await import('@shared/session')
    const curiosity = { text: 'Hex was used because…', from: { topic: 'Binary', lesson: 'l1' } }
    expect(modeLabel('teach', { curiosity } as never)).toBe('Side lesson')
    expect(modeLabel('teach')).toBe('Teach me')
    expect(modeLabel('quiz', { curiosity } as never)).toBe('Quiz me')
  })
})
