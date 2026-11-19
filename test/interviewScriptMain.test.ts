/**
 * Scripts, main side, against a throwaway vault: the first version from the model answer or the
 * learner's own draft, voice.md seeded from their writing, feedback kept and revised by a stand-in
 * for Claude (with stated facts, alternatives and a voice rule), hand edits as versions, lock with
 * beats, Say it marked and saved, and the whole flow with no Claude at all.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-script-')))
const vault = join(base, 'vault')
const userData = join(base, 'ud')
mkdirSync(userData, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))

const target = join(vault, 'Interview prep', 'Northwind Analyst')
mkdirSync(join(vault, 'Interview prep'), { recursive: true })
cpSync(join(__dirname, 'fixtures/interview/Northwind Analyst'), target, { recursive: true })
// The learner's own draft of B2, and their recorded-interview answers in the sources folder
const qPath = join(target, 'questions.md')
writeFileSync(qPath, readFileSync(qPath, 'utf8').replace('## B2. Describe a conflict in a team and how you handled it.\n', '## B2. Describe a conflict in a team and how you handled it.\n\n### Your draft\n\nSo two of us wanted different fixes for the rota. I asked us both to write down what we were trying to protect. It turned out we wanted the same thing.\n\n').replace("- Route: Problem → Method → Result → What I'd change\n", "- Route: Problem → Method → Result → What I'd change\n- Outline: cleaned the loan data; built a logistic regression\n"))
mkdirSync(join(vault, '.tide', 'interview-sources', 'northwind-analyst'), { recursive: true })
writeFileSync(join(vault, '.tide', 'interview-sources', 'northwind-analyst', 'HireVue answers.md'), '# Answers\n\nI like problems where I can see the numbers move. So I started keeping my own log of every mistake I found at work.\n')

const it2 = await import('../src/main/interviewTarget')
const sc = await import('../src/main/interviewScript')
const { parseScript } = await import('../src/shared/interviewScript')

type Once = (prompt: string, system: string, role: string) => string
const calls: { prompt: string; system: string; role: string }[] = []
const claude = (fn: Once) => {
  it2.setInterviewModels({
    ready: async () => true,
    once: async (prompt, system, role) => {
      calls.push({ prompt, system, role })
      return fn(prompt, system, role)
    }
  })
}
const noClaude = () => it2.setInterviewModels({ ready: async () => false, once: async () => '' })
const slug = 'northwind-analyst'
const file = (id: string) => join(target, 'scripts', `${id}.md`)

describe('scripts with Claude', () => {
  it('starts from the model answer, and seeds voice.md from the learner’s own writing', async () => {
    claude(() => '["Rules from their sentences: short sentences", "Starts points with so"]')
    const b = await sc.getScript(slug, 'B1')
    expect(b.start).toBe('model')
    expect(b.target).toEqual([90, 120])
    // Rules come from the samples in the background, after the page has what it needs
    await vi.waitFor(() => expect(readFileSync(join(target, 'voice.md'), 'utf8')).toContain('- Starts points with so'))
    const voice = readFileSync(join(target, 'voice.md'), 'utf8')
    expect(voice).toContain('So I started keeping my own log of every mistake I found at work.')
    expect(voice).toContain('I asked us both to write down what we were trying to protect.')
    expect(calls.at(-1)!.role).toBe('background')
    const s = await sc.startScript(slug, 'B1')
    expect(s.script!.versions).toHaveLength(1)
    expect(s.script!.versions[0]).toMatchObject({ by: 'start', note: 'The model answer from questions.md.' })
    expect(existsSync(file('B1'))).toBe(true)
  })
  it('starts from the learner’s own draft over anything else', async () => {
    const b = await sc.startScript(slug, 'B2')
    expect(b.script!.versions[0].text).toMatch(/^So two of us wanted different fixes/)
    expect(b.script!.versions[0].note).toMatch(/Your own draft/)
  })
  it('drafts with Opus when there is nothing to start from, in the learner’s voice', async () => {
    claude(() => JSON.stringify({ draft: 'I want operational risk because I like finding what breaks. [why Northwind]', note: 'A first draft from your outline.', facts: [], voiceRule: null, options: [] }))
    const b = await sc.startScript(slug, 'M1')
    expect(calls.at(-1)!.role).toBe('hard')
    expect(calls.at(-1)!.system).toMatch(/Writing for the ear/)
    expect(calls.at(-1)!.system).toMatch(/Starts points with so/)
    expect(calls.at(-1)!.system).toMatch(/Never invent/)
    expect(b.script!.versions[0]).toMatchObject({ by: 'tide', note: 'A first draft from your outline.' })
  })
  it('revises on feedback: keeps hand edits first, records stated facts, offers a voice rule', async () => {
    claude((prompt) => {
      expect(prompt).toContain('My hand edit.')
      expect(prompt).toContain('The candidate\'s feedback now: say we reached the final, and I\'d never say "pivotal"')
      return JSON.stringify({ draft: 'My hand edit. We reached the final.', note: 'Added the final.', facts: ['We reached the final'], voiceRule: 'Never say “pivotal”.', options: [] })
    })
    const r = await sc.reviseScript(slug, 'M1', 'say we reached the final, and I\'d never say "pivotal"', 'My hand edit.')
    const s = r.bundle.script!
    expect(s.versions.map((v) => v.by)).toEqual(['tide', 'you', 'tide'])
    expect(s.log.map((t) => t.who)).toEqual(['you', 'tide'])
    expect(s.log[1]).toMatchObject({ text: 'Added the final.', version: 3 })
    expect(s.facts[0]).toMatch(/^We reached the final \(stated \d{4}-\d{2}-\d{2}\)$/)
    expect(r.reply).toMatchObject({ voiceRule: 'Never say “pivotal”.', by: 'claude' })
    // The learner's own words count as material: no "confirm this is true" for what they stated
    expect(r.bundle.script!.facts).toHaveLength(1)
    // Readable Markdown in the vault
    const md = readFileSync(file('M1'), 'utf8')
    expect(md).toContain('## Version 3')
    expect(md).toContain('## Conversation')
    expect(md).toContain('## Facts you stated')
    expect(parseScript(md).versions).toHaveLength(3)
  })
  it('offers two openings without changing the draft, and keeps the one picked', async () => {
    claude((prompt) => {
      expect(prompt).toMatch(/They want alternatives/)
      return JSON.stringify({ note: 'Two openings.', options: [{ kind: 'opening', text: 'A.', draft: 'A. We reached the final.' }, { kind: 'opening', text: 'B.', draft: 'B. We reached the final.' }] })
    })
    const r = await sc.reviseScript(slug, 'M1', 'two other openings', 'My hand edit. We reached the final.')
    expect(r.bundle.script!.versions).toHaveLength(3)
    expect(r.reply.options).toHaveLength(2)
    const b = await sc.pickOption(slug, 'M1', r.reply.options![1].draft, 'The opening B you picked.')
    expect(b.script!.versions.at(-1)).toMatchObject({ n: 4, text: 'B. We reached the final.' })
  })
  it('sets the length the learner asks for', async () => {
    claude(() => JSON.stringify({ draft: 'Short.', note: 'Cut to a minute.' }))
    const r = await sc.reviseScript(slug, 'M1', 'make it 60 seconds', '')
    expect(r.bundle.target).toEqual([50, 70])
    expect(calls.at(-1)!.prompt).toMatch(/Fit it into 50 to 70 seconds/)
  })
  it('goes back to an old version as a new one, locks with Haiku’s beats, and unlocks', async () => {
    const back = await sc.restoreVersion(slug, 'M1', 4)
    expect(back.script!.versions.at(-1)).toMatchObject({ n: 6, by: 'you', note: 'Back to version 4.', text: 'B. We reached the final.' })
    claude(() => '["Opens with B", "We reached the final"]')
    const locked = await sc.lockScript(slug, 'M1', 6)
    expect(calls.at(-1)!.role).toBe('background')
    expect(locked.script).toMatchObject({ status: 'locked', lockedVersion: 6, beats: ['Opens with B', 'We reached the final'] })
    expect(await sc.lockedScriptOf('Interview prep/Northwind Analyst', 'M1')).toEqual({ text: 'B. We reached the final.', beats: ['Opens with B', 'We reached the final'] })
    const un = await sc.lockScript(slug, 'M1', null)
    expect(un.script!.status).toBe('draft')
    expect(un.script!.lockedVersion).toBeUndefined()
    expect(await sc.lockedScriptOf('Interview prep/Northwind Analyst', 'M1')).toBeNull()
  })
  it('marks Say it with Claude on the beats and saves the attempt', async () => {
    claude(() => '["Opens with B", "We reached the final"]')
    await sc.lockScript(slug, 'M1', 6)
    claude(() => '{"hit": [false, true], "natural": 0.9, "feedback": "You skipped the opening."}')
    const r = await sc.sayIt(slug, 'M1', 'We got all the way to the final.', 20)
    expect(r).toMatchObject({ by: 'claude', feedback: 'You skipped the opening.' })
    expect(r.beats.map((b) => b.hit)).toEqual([false, true])
    const t = (await it2.getTarget(slug))!
    expect(t.progress.attempts.at(-1)).toMatchObject({ item: 'q:M1', by: 'claude', seconds: 20, spoken: true })
  })
})

describe('scripts without Claude', () => {
  it('starts from the outline, keeps feedback as a note, offers a voice rule in code', async () => {
    noClaude()
    const b = await sc.startScript(slug, 'C1')
    expect(b.claude).toBe(false)
    expect(b.script!.versions[0].by).toBe('start')
    expect(b.script!.versions[0].note).toMatch(/Claude isn’t available/)
    const r = await sc.reviseScript(slug, 'C1', 'I don\'t use "furthermore"', b.script!.versions[0].text)
    expect(r.reply.by).toBe('code')
    expect(r.reply.voiceRule).toBe('Never say “furthermore”.')
    expect(r.bundle.script!.log.map((t) => t.who)).toEqual(['you', 'tide'])
    const v = await sc.addVoice(slug, 'rules', r.reply.voiceRule!)
    expect(v.rules).toContain('Never say “furthermore”.')
  })
  it('edits, locks with beats in code, and marks Say it in code', async () => {
    const text = 'I built a model that predicted loan defaults.\n\nI cleaned 50,000 rows of loan data first.\n\nThe model caught most defaults early.'
    const saved = await sc.saveScript(slug, 'C1', text)
    expect(saved.script!.versions.at(-1)).toMatchObject({ by: 'you', text })
    // A hand-written sentence becomes a sample of the learner's voice
    expect(readFileSync(join(target, 'voice.md'), 'utf8')).toContain('I cleaned 50,000 rows of loan data first.')
    const locked = await sc.lockScript(slug, 'C1', null === null ? saved.script!.versions.at(-1)!.n : 0)
    expect(locked.script!.beats).toHaveLength(3)
    const r = await sc.sayIt(slug, 'C1', 'I built a model to predict loan defaults, after cleaning the loan data.', null)
    expect(r.by).toBe('code')
    expect(r.beats.filter((b) => b.hit).length).toBeGreaterThanOrEqual(2)
  })
  it('flags claims the material doesn’t back', async () => {
    const b = await sc.getScript(slug, 'C1')
    const { unsupportedClaims } = await import('../src/shared/interviewScript')
    expect(unsupportedClaims('I cut defaults by 83% at Fabrikam.', b.known).map((c) => c.missing)).toEqual([['83%', 'fabrikam']])
    expect(unsupportedClaims('I cleaned 50,000 rows.', b.known)).toEqual([])
  })
  it('refuses Say it before a version is locked, and a question that isn’t there', async () => {
    await expect(sc.sayIt(slug, 'B2', 'x', null)).rejects.toThrow(/Lock a version first/)
    await expect(sc.getScript(slug, 'NOPE')).rejects.toThrow(/isn’t in questions.md/)
  })
})
