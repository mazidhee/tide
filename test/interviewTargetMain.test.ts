/**
 * Interview targets, main side, against a throwaway vault: targets listed and read, progress kept,
 * cards from every target's cards.md in a deck of its own ("Interview: <name>") with due counts,
 * and the writing jobs adding to files after a backup, with Claude stood in for.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-interview-')))
const vault = join(base, 'vault')
const userData = join(base, 'ud')
mkdirSync(userData, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))

const target = join(vault, 'Interview prep', 'Northwind Analyst')
mkdirSync(join(vault, 'Interview prep'), { recursive: true })
cpSync(join(__dirname, 'fixtures/interview/Northwind Analyst'), target, { recursive: true })
// A second target whose cards are tagged in the body, Obsidian style, with a cloze
mkdirSync(join(vault, 'Interview prep', 'Contoso Grad'), { recursive: true })
writeFileSync(join(vault, 'Interview prep', 'Contoso Grad', 'target.md'), '---\ncompany: Contoso\nrole: Graduate\ndate: 2026-12-01\n---\n')
writeFileSync(join(vault, 'Interview prep', 'Contoso Grad', 'cards.md'), '#flashcards/interview/contoso\n\nWhat are the three lines?::Business, risk, audit\n\nContoso was founded in {{c1::1990}}.\n')
// An ordinary deck, to show it stays where it was
mkdirSync(join(vault, 'Data'), { recursive: true })
writeFileSync(join(vault, 'Data', 'Hashing.md'), '---\ntags: [flashcards]\n---\nWhat is a hash map?::A table keyed by hash\n')
// Untagged cards in the first target
writeFileSync(join(target, 'cards.md'), 'What is VaR?::A loss threshold at a confidence level\n\nWhat is a KRI?::A key risk indicator\n')

const it2 = await import('../src/main/interviewTarget')
const { getReviewStats } = await import('../src/main/learn')
const { getCards, reviewCard } = await import('../src/main/study')

describe('cards from every target', () => {
  it('puts each target’s cards.md in its own deck, tagged or not', async () => {
    const stats = await getReviewStats()
    expect(stats.decks['Interview: Northwind Analyst']).toMatchObject({ total: 2, new: 2 })
    expect(stats.decks['Interview: Contoso Grad']).toMatchObject({ total: 2, new: 2 })
    expect(stats.decks['Data']).toMatchObject({ total: 1 })
    expect(stats.decks['Interview prep']).toBeUndefined()
    expect(stats.deckScopes?.['Interview: Northwind Analyst']).toEqual({ kind: 'note', path: 'Interview prep/Northwind Analyst/cards.md' })
    const all = await getCards({ kind: 'vault' })
    expect(all.filter((c) => c.path.startsWith('Interview prep/')).length).toBe(4)
  })
  it('counts due cards on the target page, and a review moves them on', async () => {
    let b = (await it2.getTarget('northwind-analyst'))!
    expect(b.cards).toMatchObject({ exists: true, total: 2, due: 2, remembered: 0 })
    const [first] = await getCards({ kind: 'note', path: b.cards.path })
    await reviewCard(first.id, 'good', first.path)
    b = (await it2.getTarget('northwind-analyst'))!
    expect(b.cards).toMatchObject({ total: 2, due: 1, remembered: 1 })
    expect(b.cards.reviewedToday.length).toBe(1)
  })
})

describe('targets', () => {
  it('lists and reads targets, with readiness', async () => {
    const list = await it2.listTargets()
    expect(list.map((t) => t.slug).sort()).toEqual(['contoso-grad', 'northwind-analyst'])
    const b = (await it2.getTarget('northwind-analyst'))!
    expect(b.files.meta.company).toBe('Northwind Capital')
    expect(b.files.questions.length).toBe(7)
    expect(b.has.stories).toBe(true)
    expect(await it2.getTarget('nope')).toBeNull()
  })
  it('keeps attempts in .tide/interview/<slug>.json', async () => {
    await it2.saveAttempt('northwind-analyst', { item: 'q:B1', area: 'behavioural', drill: 'behavioural', at: 1, score: 0.5, marks: {}, by: 'code' })
    const p = await it2.saveAttempt('northwind-analyst', { item: 'q:B1', area: 'behavioural', drill: 'behavioural', at: 2, score: 0.9, marks: {}, by: 'code' })
    expect(p.attempts).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(vault, '.tide/interview/northwind-analyst.json'), 'utf8')).attempts).toHaveLength(2)
  })
  it('makes a new target from the form', async () => {
    const r = await it2.createTarget({ company: 'Fabrikam', role: 'Analyst', date: '2026-12-02T10:30', timezone: 'Europe/London', sources: [' /a '], links: [] })
    expect(r).toEqual({ slug: 'fabrikam-analyst', folder: 'Interview prep/Fabrikam Analyst' })
    const again = await it2.createTarget({ company: 'Fabrikam', role: 'Analyst', sources: [], links: [] })
    expect(again.folder).toBe('Interview prep/Fabrikam Analyst 2')
    await expect(it2.createTarget({ company: ' ', role: '', sources: [], links: [] })).rejects.toThrow(/company/)
  })
  it('reads a target.md YAML refuses', async () => {
    mkdirSync(join(vault, 'Interview prep', 'Odd'), { recursive: true })
    writeFileSync(join(vault, 'Interview prep', 'Odd', 'target.md'), '---\ncompany: Odd Ltd\ncourse: odd-track\nrounds:\n  - id: r1\n    name: Case\n    kind: technical\n    notes: Required: one thing.\n---\n')
    for (let i = 0; i < 2; i++) {
      const b = (await it2.getTarget('odd'))!
      expect(b.files.meta.company).toBe('Odd Ltd')
      expect(b.files.meta.rounds[0].notes).toBe('Required: one thing.')
    }
  })
})

describe('writing jobs', () => {
  const ready = (out: (prompt: string) => string) => ({ ready: async () => true, once: async (prompt: string) => out(prompt) })
  it('adds today’s cards from the files without Claude, once a day', async () => {
    it2.setInterviewModels({ ready: async () => false, once: async () => '' })
    const r = await it2.generate('contoso-grad', 'cards')
    expect(r).toMatchObject({ added: 0, by: 'code' })
    writeFileSync(join(target, 'cards.md'), '')
    const n = await it2.generate('northwind-analyst', 'cards')
    expect(n.by).toBe('code')
    expect(n.added).toBeGreaterThan(3)
    const md = readFileSync(join(target, 'cards.md'), 'utf8')
    expect(md).toMatch(/^---\ntags: \[flashcards\]/)
    expect(md).toMatch(/## Added \d{4}-\d{2}-\d{2}/)
    expect((await it2.generate('northwind-analyst', 'cards')).note).toMatch(/already/)
  })
  it('writes model answers additively, after a backup, and only where there are none', async () => {
    const before = readFileSync(join(target, 'questions.md'), 'utf8')
    it2.setInterviewModels(ready(() => JSON.stringify({ B2: 'I was the weekend supervisor. PRACTICE VERSION: how many staff.', C1: 'I built a logistic regression.', B1: 'should not replace' })))
    const r = await it2.generate('northwind-analyst', 'answers')
    expect(r.added).toBeGreaterThanOrEqual(2)
    expect(r.backup).toMatch(/^\.tide\/backups\/interview-northwind-analyst-/)
    expect(readFileSync(join(vault, r.backup!, 'questions.md'), 'utf8')).toBe(before)
    const after = readFileSync(join(target, 'questions.md'), 'utf8')
    for (const line of before.split('\n').filter((l) => l.trim())) expect(after).toContain(line)
    expect(after).toContain('I was the weekend supervisor.')
    expect(after).not.toContain('should not replace')
  })
  it('fills stories from the gathered CV, keeping the ones there', async () => {
    mkdirSync(join(base, 'src'), { recursive: true })
    writeFileSync(join(base, 'src', 'cv.md'), '# CV\n- Ran the chess club for two years.\n')
    const t = readFileSync(join(target, 'target.md'), 'utf8').replace('/tmp/northwind-sources', join(base, 'src')).replace(/links:\n(  - .*\n)+/, 'links: []\n')
    writeFileSync(join(target, 'target.md'), t)
    const ctx = await it2.gather('northwind-analyst')
    expect(ctx.items.map((i) => i.title)).toEqual(['cv.md'])
    it2.setInterviewModels(ready(() => '## S4. Ran the chess club\n- Best for: leadership\n- Evidence:\n  - Ran the chess club for two years\n- Anchors: chess, two years, club\n- Gaps: how many members\n\n## S1. Duplicate\n- Evidence:\n  - x\n'))
    const r = await it2.generate('northwind-analyst', 'stories')
    expect(r.added).toBe(1)
    const stories = readFileSync(join(target, 'stories.md'), 'utf8')
    expect(stories).toContain('## S1. Rebuilt the society')
    expect(stories).toContain('## S4. Ran the chess club')
    expect(stories.match(/## S1\./g)).toHaveLength(1)
    expect(readdirSync(join(vault, '.tide/backups')).length).toBeGreaterThanOrEqual(2)
  })
  it('refuses to write stories and answers without Claude', async () => {
    it2.setInterviewModels({ ready: async () => false, once: async () => '' })
    await expect(it2.generate('northwind-analyst', 'answers')).rejects.toThrow(/needs Claude/)
    expect(existsSync(join(target, 'scenarios.md'))).toBe(true)
  })
  it('marks in code without Claude, and holds Claude to the measured time', async () => {
    const input = { drill: 'behavioural' as const, question: 'q', answer: 'I wrote a script and as a result we saved 10%.', seconds: 20 }
    it2.setInterviewModels({ ready: async () => false, once: async () => '' })
    expect((await it2.markAnswer('northwind-analyst', input)).by).toBe('code')
    it2.setInterviewModels(ready(() => '{"marks": {"structure": 4, "specifics": 4, "ownership": 4, "result": 4, "length": 4, "natural": 4}, "missed": [], "feedback": "Good."}'))
    const m = await it2.markAnswer('northwind-analyst', input)
    expect(m.by).toBe('claude')
    expect(m.marks.length).toBe(0)
    expect(m.score).toBeCloseTo(5 / 6, 1)
    it2.setInterviewModels(ready(() => 'not json'))
    expect((await it2.markAnswer('northwind-analyst', input)).by).toBe('code')
  })
})
