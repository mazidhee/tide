import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotebookMeta } from '../src/shared/types'
import type { PairEvent } from '../src/shared/ide'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-ideas-')))
const vault = join(base, 'vault')
const userData = join(base, 'ud')
mkdirSync(vault, { recursive: true })
mkdirSync(userData, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn(), showItemInFolder: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: {} }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))

// Notebooks, in memory
const notebooks = new Map<string, NotebookMeta>()
vi.mock('../src/main/learn', () => ({
  getNotebooks: async () => [...notebooks.values()],
  updateNotebook: async (path: string, patch: Partial<NotebookMeta>) => {
    const nb = notebooks.get(path) ?? ({ path, name: path.split('/').pop()!, noteCount: 0, fileCount: 0, mastered: 0, learning: 0, lastModified: 0 } as NotebookMeta)
    notebooks.set(path, { ...nb, ...patch })
  },
  filedUnder: async () => []
}))
vi.mock('../src/main/book', () => ({}))
vi.mock('../src/main/search', () => ({}))
const coach = { focus: ['Software Engineering'] as string[] }
vi.mock('../src/main/coach', () => ({
  getCoach: async () => ({ goal: '', focus: [...coach.focus], hoursPerWeek: 10, days: [1, 2, 3] }),
  saveCoach: async (s: { focus: string[] }) => ((coach.focus = s.focus), s),
  directionLine: async () => ''
}))
const evidence: { topic: string; kind: string; path?: string }[] = []
vi.mock('../src/main/knowledge', () => ({
  allConcepts: async (privateOk: boolean) => [{ id: 'k1', name: 'Double-entry bookkeeping', status: 'solid', seen: 3, private: false }, ...(privateOk ? [{ id: 'k2', name: 'Idempotency keys', status: 'fading', seen: 2 }] : [])],
  noteEvidence: async (e: { topic: string; kind: string; path?: string }) => void evidence.push(e)
}))
vi.mock('../src/main/courses', () => ({ searchCourses: async () => [] }))
const kept: { items: { prompt: string }[]; path?: string }[] = []
vi.mock('../src/main/recall', () => ({ keepForRecall: async (items: { prompt: string }[], path?: string) => void kept.push({ items, path }) }))
vi.mock('../src/main/ide/tests', () => ({
  discover: async () => ({ framework: 'pytest', tests: [] }),
  runTests: async () => ({ framework: 'pytest', outcomes: [{ id: 'a', status: 'fail' }, { id: 'b', status: 'fail' }], output: '', ms: 1 })
}))
const gemmaPrompts: string[] = []
vi.mock('../src/main/ai', () => ({
  jobRoute: async (_job: string, _p: string, o: { private?: boolean }) => (o.private ? { who: 'gemma', reason: 'private' } : { who: 'claude', role: 'hard' }),
  extractJsonObject: (t: string) => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)),
  complete: async (prompt: string) => (gemmaPrompts.push(prompt), '{}'),
  claudeOr: async () => '{}',
  completeFor: async () => '{}',
  friendlyError: (e: Error) => e.message
}))
// Claude for the pair session: what it was told, and that it ran
const launched: { system: string; turns: string[] }[] = []
vi.mock('../src/main/claudeEngine', () => ({
  claudeReady: async () => ({ ready: true, installed: true }),
  recordUse: () => {},
  ClaudeProcess: class {
    alive = true
    costSoFar = 0
    rec: { system: string; turns: string[] }
    constructor(_key: string, _model: string, system: string) {
      this.rec = { system, turns: [] }
      launched.push(this.rec)
    }
    async turn(text: string) {
      this.rec.turns.push(text)
      return { ok: true, usage: { costUsd: 0 }, model: 'opus' }
    }
    stop() {}
  }
}))
vi.mock('../src/main/tideMcp', () => ({ ensureMcp: async () => ({ port: 1, token: 't' }), bindLesson: () => {}, unbindLesson: () => {} }))
vi.mock('../src/main/claudeCli', () => ({ mcpConfig: () => '{}' }))
const profileOps: { do: string; section: string; text: string }[] = []
vi.mock('../src/main/learnerProfile', () => ({ noteFromProject: async (ops: { do: string; section: string; text: string }[]) => (profileOps.push(...ops), []) }))

const ideas = await import('../src/main/ideaProjects')
const { privatePath } = await import('../src/main/projects')
const { IDEA_TEMPLATES, planFromTemplate } = await import('../src/shared/ideaTemplates')
const pair = await import('../src/main/ide/pair')

const asked: { job: string; private: boolean; prompt: string }[] = []
const CLAUDE_PLAN = JSON.stringify({
  name: 'Payment rail',
  summary: 'A rail.',
  components: [
    { id: 'ledger', name: 'Ledger', about: 'double entry', prerequisites: ['double-entry bookkeeping', 'idempotency keys'] },
    { id: 'api', name: 'Payment API', about: 'HTTP', prerequisites: ['HTTP'] }
  ],
  links: [{ from: 'api', to: 'ledger', label: 'postings' }],
  milestones: [
    { id: 'm1', title: 'Ledger', build: 'b', components: ['ledger'], lessons: [{ concept: 'double-entry bookkeeping', why: 'w' }], doneWhen: ['balanced entries post'], hours: 4, recall: ['Why balance?'] },
    { id: 'm2', title: 'API', build: 'b', components: ['api'], lessons: ['idempotency keys'], doneWhen: ['retries are safe'], hours: 5 }
  ],
  scaffold: [
    { path: 'rail/ledger.py', content: 'def post():\n    raise NotImplementedError\n' },
    { path: 'tests/test_ledger.py', content: 'from rail.ledger import post\n\ndef test_post():\n    post()\n' }
  ]
})

beforeEach(() => {
  asked.length = 0
  ideas.setAsker(async (job, prompt, _system, o, gemma) => {
    asked.push({ job, private: o.private, prompt })
    if (o.private) return { text: gemma ? await gemma() : '{}', by: 'gemma' }
    if (job === 'projectReady') return { text: JSON.stringify({ questions: [...[1, 2, 3, 4, 5].map((i) => ({ id: `d${i}`, kind: 'design', question: `Design question ${i}?`, points: ['ledger'], revisit: 'double-entry bookkeeping' })), { id: 'r1', kind: 'reading', question: 'Reading question?', points: ['balance'], revisit: 'Accounting for developers' }, { id: 'r2', kind: 'reading', question: 'Second reading question?', points: ['minor units'] }] }), by: 'claude' }
    if (job === 'projectReadyMark') {
      const answers = [...prompt.matchAll(/Question (\w+) \(\w+\): [^\n]*\n[^\n]*\nTheir answer: ([^\n]*)/g)]
      return { text: JSON.stringify({ results: answers.map((a) => ({ id: a[1], pass: !/dunno/.test(a[2]), feedback: /dunno/.test(a[2]) ? 'Think about where the money goes.' : 'Good.' })) }), by: 'claude' }
    }
    if (job === 'projectDebrief') return { text: JSON.stringify({ built: 'A ledger that refuses unbalanced entries.', decisions: ['Integers for money, at the cost of currency handling'], wrong: ['Allowed floats at first'], strengths: ['Tests read like the rules'], recall: ['Why integers for money?'] }), by: 'claude' }
    if (job === 'projectIdeas') return { text: JSON.stringify({ ideas: [{ title: 'A FX settlement netting engine', idea: 'Net FX trades between banks and settle them PvP', tier: 2, area: 'payments', why: 'You studied net settlement' }] }), by: 'claude' }
    return { text: job === 'projectQuestions' ? '{"questions":[{"id":"scope","question":"Which rails?","options":["Faster Payments","SEPA"]}]}' : CLAUDE_PLAN, by: 'claude' }
  })
})

const owner = (events: PairEvent[]) => ({ isDestroyed: () => false, send: (_c: string, e: PairEvent) => events.push(e) }) as unknown as Electron.WebContents

describe('a project from an idea', () => {
  it('asks Claude its questions, and asks a private idea’s plainly, without a model', async () => {
    const q = await ideas.questions('I want to build a payment rail', false)
    expect(q.by).toBe('claude')
    expect(q.questions[0].question).toBe('Which rails?')
    const p = await ideas.questions('I want to build a payment rail', true)
    expect(p.by).toBe('none')
    expect(p.questions.map((x) => x.id)).toEqual(['scope', 'language', 'depth'])
    expect(asked.filter((a) => a.job === 'projectQuestions')).toHaveLength(1)
  })

  it('has Claude write the plan, marked against what you know, with the template as its starting map', async () => {
    const r = await ideas.draftPlan({ idea: 'I want to build a payment rail', answers: [{ question: 'Language?', answer: 'Python' }], private: false, source: 'model' })
    expect(r.plan.by).toBe('claude')
    expect(r.problems).toEqual([])
    expect(asked[0]).toMatchObject({ job: 'projectPlan', private: false })
    expect(asked[0].prompt).toContain('A starting map for this kind of project')
    expect(asked[0].prompt).toContain('Double-entry bookkeeping')
    const ledger = r.plan.components.find((c) => c.id === 'ledger')!
    // Private concepts aren't read for a plan Claude sees
    expect(ledger.prerequisites.map((p) => p.status)).toEqual(['known', 'new'])
  })

  it('keeps a private plan on Gemma: no starting code, placeholder tests, private concepts allowed', async () => {
    const r = await ideas.draftPlan({ idea: 'I want to build a payment rail', answers: [], private: true, source: 'model' })
    expect(asked.every((a) => a.private)).toBe(true)
    // Gemma is given its own, smaller prompt, with no starting code asked for
    expect(gemmaPrompts.at(-1)).toMatch(/^Plan a project a learner will build themselves/)
    expect(gemmaPrompts.at(-1)).not.toContain('scaffold')
    // Gemma's answer here is empty JSON, so the template stands in, and says so
    expect(r.plan.private).toBe(true)
    expect(r.note).toMatch(/template/)
  })

  it('works with no model at all: a template, or a blank plan', async () => {
    const t = await ideas.draftPlan({ idea: 'blockchain', answers: [], private: false, source: 'template', template: 'blockchain' })
    expect(t.plan.by).toBe('template')
    expect(t.plan.milestones[0].title).toBe('Blocks linked by hashes')
    const b = await ideas.draftPlan({ idea: 'I want to build a tiny shell', answers: [], private: false, source: 'blank' })
    expect(b.plan).toMatchObject({ by: 'manual', name: 'A tiny shell' })
    expect(asked).toHaveLength(0)
  })

  it('makes the notebook, the notes, a git repository (tests held for the ready check), the roadmap and the coach', async () => {
    const plan = planFromTemplate(IDEA_TEMPLATES[0], 'I want to build a payment rail', Date.now(), false)
    const made = await ideas.createProject(plan)
    expect(made.notebook).toBe('Payment rail')
    expect(made.root).toBe(join(vault, 'Code', 'payment-rail'))
    // The first milestone's tests wait for its ready check
    expect(made.tests).toMatchObject({ held: 1, framework: 'pytest' })
    expect(existsSync(join(made.root, 'tests/test_ledger.py'))).toBe(false)
    expect(made.coach).toBe('added')
    expect(coach.focus).toEqual(['Software Engineering', 'Payment rail'])
    // The repository
    expect(execFileSync('git', ['log', '--oneline'], { cwd: made.root, encoding: 'utf8' })).toMatch(/Start Payment rail/)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: made.root, encoding: 'utf8' })).toBe('')
    for (const f of ['README.md', 'pyproject.toml', 'requirements.txt', 'rail/ledger.py']) expect(existsSync(join(made.root, f)), f).toBe(true)
    // The notes and the notebook
    const nb = notebooks.get('Payment rail')!
    expect(nb.project).toMatchObject({ kind: 'build', private: false, brief: 'Payment rail/Payment rail plan.md', code: 'Code/payment-rail' })
    expect(nb.outline).toBe('Payment rail/Payment rail roadmap.md')
    expect(readFileSync(join(vault, 'Payment rail/Payment rail roadmap.md'), 'utf8')).toContain('## Milestone 1: A double-entry ledger')
    expect(readFileSync(join(vault, 'Payment rail/Project memory.md'), 'utf8')).toContain('Milestone 1: A double-entry ledger. Make its failing tests pass.')
    // Found again from its folder
    expect((await ideas.planForRoot(made.root))?.notebook).toBe('Payment rail')
    expect((await ideas.listProjects()).map((c) => [c.name, c.current])).toEqual([['Payment rail', 'A double-entry ledger']])
    // A second one with the same name doesn't overwrite the first
    const again = await ideas.createProject(plan)
    expect(again.root).toBe(join(vault, 'Code', 'payment-rail 2'))
    expect(again.notebook).not.toBe('Payment rail')
  })

  it('runs a milestone’s session: the ready check unlocks the tests, the debrief ends it, points are kept', async () => {
    const plan = planFromTemplate(IDEA_TEMPLATES[2], 'stablecoin', Date.now(), false)
    const { notebook, root } = await ideas.createProject(plan)
    await expect(ideas.startMilestoneSession(notebook, 'm2')).rejects.toThrow(/before it/)
    await ideas.startMilestoneSession(notebook, 'm1')
    for (const st of ['warmup', 'lesson'] as const) await ideas.stepSession(notebook, 'm1', st, 'done')
    // Building waits for the ready check, which can't be skipped or ticked by hand
    await expect(ideas.stepSession(notebook, 'm1', 'build', 'done')).rejects.toThrow(/ready check comes first/)
    await expect(ideas.stepSession(notebook, 'm1', 'ready', 'skipped')).rejects.toThrow(/ready check/)
    await expect(ideas.stepSession(notebook, 'm1', 'ready', 'done')).rejects.toThrow(/Pass the ready check/)
    // Opus asks five design questions and two on the reading
    let p = await ideas.readyQuestions(notebook, 'm1')
    const qs = p.milestones[0].gate!.questions
    expect(qs.filter((q) => q.kind === 'design')).toHaveLength(5)
    expect(qs.filter((q) => q.kind === 'reading')).toHaveLength(2)
    // Not ready: two missed; the gaps are what to revisit, and the tests stay held
    const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 2 ? 'dunno' : 'An answer about the ledger and balance in minor units.']))
    let r = await ideas.markReady(notebook, 'm1', answers)
    expect(r.plan.milestones[0].gate).toMatchObject({ passed: 5, total: 7, ready: false, by: 'claude', tries: 1 })
    expect(existsSync(join(root, 'tests/test_vault.py'))).toBe(false)
    // Ready: the tests are written and committed
    r = await ideas.markReady(notebook, 'm1', Object.fromEntries(qs.map((q) => [q.id, 'Collateral value over debt, kept above the minimum ratio.'])))
    expect(r.plan.milestones[0].gate).toMatchObject({ passed: 7, ready: true, tries: 2 })
    expect(r.plan.milestones[0].session?.done).toContain('ready')
    expect(existsSync(join(root, 'tests/test_vault.py'))).toBe(true)
    expect(execFileSync('git', ['log', '--oneline', '-1'], { cwd: root, encoding: 'utf8' })).toMatch(/Milestone 1: its tests, unlocked by the ready check/)
    await ideas.stepSession(notebook, 'm1', 'build', 'done')
    await expect(ideas.stepSession(notebook, 'm1', 'tests', 'done', { passed: 4, total: 5 })).rejects.toThrow(/Not all/)
    await ideas.stepSession(notebook, 'm1', 'tests', 'done', { passed: 5, total: 5 })
    await ideas.stepSession(notebook, 'm1', 'review', 'done')
    await ideas.stepSession(notebook, 'm1', 'bughunt', 'skipped')
    await expect(ideas.finishWith(notebook, 'm1')).rejects.toThrow(/debrief/)
    await expect(ideas.stepSession(notebook, 'm1', 'debrief', 'done')).rejects.toThrow(/Write the debrief/)
    // The debrief: a note, recall cards kept, the profile told
    const d = await ideas.writeDebrief(notebook, 'm1')
    expect(d.path).toBe(`${notebook}/Debriefs/Milestone 1 - Collateralised vaults.md`)
    expect(readFileSync(join(vault, d.path), 'utf8')).toMatch(/## What you got wrong\n\n- Allowed floats at first/)
    expect(kept.at(-1)).toMatchObject({ path: notebook, items: [{ prompt: 'Why integers for money?' }] })
    expect(profileOps.map((o) => o.section)).toEqual(expect.arrayContaining(['missed', 'strengths']))
    expect(d.plan.milestones[0].session?.step).toBe('finished')
    const done = await ideas.finishWith(notebook, 'm1')
    expect(done.plan.milestones.map((m) => m.status).slice(0, 2)).toEqual(['done', 'active'])
    expect(done.celebrate).not.toBeNull()
    expect(evidence.filter((e) => e.path === notebook).map((e) => [e.topic, e.kind])).toEqual([['collateralisation ratios', 'right'], ['Decimal arithmetic', 'right']])
    const { memory } = await ideas.readMemory(notebook)
    expect(memory['What’s next']).toEqual(['Milestone 2: A price oracle.'])
    expect(memory.Reviews.at(-1)).toMatch(/^Debrief, milestone 1/)
    expect(readFileSync(join(vault, notebook, 'Stablecoin simulator roadmap.md'), 'utf8')).toContain('- [x] collateralisation ratios')
    // Points: the project, the ready check (second try), the debrief, the milestone (tier 3)
    const sc = await ideas.scoreView()
    expect(sc.recent.slice(0, 3).map((e) => e.points)).toEqual([150, 25, 15])
    expect(sc.points).toBeGreaterThanOrEqual(10 + 15 + 25 + 150)
    expect(sc.streak).toBe(1)
    p = await ideas.startMilestoneSession(notebook, 'm2')
    // A later milestone's tests are placeholders from its done-when lines, also behind its ready check
    p = await ideas.readyQuestions(notebook, 'm2')
    await ideas.markReady(notebook, 'm2', Object.fromEntries(p.milestones[1].gate!.questions.map((q) => [q.id, 'The oracle takes the median of fresh feeds and ignores stale ones.'])))
    expect(readFileSync(join(root, 'tests/test_a_price_oracle.py'), 'utf8')).toMatch(/Milestone 2: A price oracle/)
  })
})

describe('privacy', () => {
  it('a private project’s folder is private, Claude refuses it, and a bug hunt can’t start in it', async () => {
    const plan = planFromTemplate(IDEA_TEMPLATES[3], 'core banking for work', Date.now(), true)
    const made = await ideas.createProject(plan)
    expect(await privatePath('Code/core-banking/bank/accounts.py')).toBe(true)
    expect(await ideas.privateRoot(made.root)).toBe(true)
    const events: PairEvent[] = []
    const before = launched.length
    await pair.send(owner(events), { session: 'priv1', root: made.root, mode: 'mentor', text: 'Review the whole project' })
    expect(launched.length).toBe(before)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringMatching(/private/) })
    await expect(pair.startHunt(made.root)).rejects.toThrow(/private/)
    // Its ready check is the plan's own, marked on this Mac with no model asked
    await ideas.startMilestoneSession(made.notebook, 'm1')
    asked.length = 0
    const p = await ideas.readyQuestions(made.notebook, 'm1')
    expect(p.milestones[0].gate?.by).toBe('plan')
    const r = await ideas.markReady(made.notebook, 'm1', { d1: 'too short' })
    expect(r.plan.milestones[0].gate?.ready).toBe(false)
    expect(asked).toEqual([])
    // Its debrief stays out of the profile (written by Gemma, here an empty answer, so from what Tide recorded)
    for (const st of ['warmup', 'lesson'] as const) await ideas.stepSession(made.notebook, 'm1', st, 'skipped')
  })
})

describe('the mentor in the IDE', () => {
  it('knows the plan and its memory, and keeps the memory with its tool', async () => {
    const plan = planFromTemplate(IDEA_TEMPLATES[1], 'a blockchain', Date.now(), false)
    const made = await ideas.createProject(plan)
    const events: PairEvent[] = []
    await pair.send(owner(events), { session: 'mentor1', root: made.root, mode: 'mentor', text: 'Review the whole project' })
    const rec = launched.at(-1)!
    expect(rec.system).toContain('Current milestone 1 of 6: Blocks linked by hashes')
    expect(rec.system).toMatch(/review the whole project, not only the diff/)
    expect(rec.turns).toEqual(['Review the whole project'])
    expect(events.at(-1)?.type).toBe('done')

    pair.ensureSession('mentor2', made.root, 'mentor', owner([]), 'opus')
    const ctx = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'ide:mentor2', chatId: undefined }
    const tool = (n: string) => pair.IDE_TOOLS.find((t) => t.name === n)!
    expect(await tool('project_memory').run({}, ctx)).toContain('Your memory note from earlier sessions')
    expect(await tool('update_project_memory').run({ decisions: ['Headers are serialised as compact JSON.'], open_issues: ['No difficulty target yet'], resolve: ['Blocks linked by hashes'] }, ctx)).toMatch(/updated/)
    const { memory } = await ideas.readMemory(made.notebook)
    expect(memory.Decisions).toContain('Headers are serialised as compact JSON.')
    expect(memory['Open issues']).toEqual(['No difficulty target yet'])
    expect(memory['What’s next']).toEqual([])
  })
  it('lets the learner write: no write_file, and code only as a small, counted hint when asked or after failed runs', async () => {
    const plan = planFromTemplate(IDEA_TEMPLATES[0], 'a payment rail', Date.now(), false)
    const made = await ideas.createProject(plan)
    const events: PairEvent[] = []
    await pair.send(owner(events), { session: 'tut1', root: made.root, mode: 'tutor', text: 'How should I start?' })
    expect(launched.at(-1)!.system).toMatch(/you are their tutor, not the author/)
    const ctx = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'ide:tut1', chatId: undefined }
    const tool = (n: string) => pair.IDE_TOOLS.find((t) => t.name === n)!
    const old = '"""Opens an account with a zero balance."""\n        raise NotImplementedError'
    const small = '"""Opens an account with a zero balance."""\n        self.balances.setdefault(name, 0)'
    expect(await tool('write_file').run({ path: 'rail/new.py', content: 'x = 1\n' }, ctx)).toMatch(/write_file is off/)
    expect(await tool('propose_edit').run({ path: 'rail/ledger.py', old_string: old, new_string: small }, ctx)).toMatch(/^Not proposed: in this project the learner writes/)
    // Asked to be shown: one small hint, labelled and counted; a second needs asking again
    await pair.send(owner(events), { session: 'tut1', root: made.root, mode: 'tutor', text: 'I’m stuck, show me how to open an account' })
    expect(launched.at(-1)!.turns.at(-1)).toMatch(/You may give one hint as code/)
    expect(await tool('propose_edit').run({ path: 'rail/ledger.py', old_string: old, new_string: small, explanation: 'keep a balance per account' }, ctx)).toMatch(/Proposed a change/)
    const prop = events.filter((e) => e.type === 'proposal').at(-1)
    expect(prop && prop.type === 'proposal' && prop.proposal).toMatchObject({ hint: true, explanation: 'Hint: keep a balance per account' })
    expect((await ideas.planForRoot(made.root))!.milestones[0].hints).toBe(1)
    expect(await tool('propose_edit').run({ path: 'rail/ledger.py', old_string: 'def balance', new_string: 'def balance_of' }, ctx)).toMatch(/^Not proposed/)
    // Three failed runs in a row also allow one, but never a solution-sized one
    for (let i = 0; i < 3; i++) await ideas.noteTestRun(made.root, { failed: 2, total: 5 })
    expect(ideas.failedRuns(made.root)).toBe(3)
    await pair.send(owner(events), { session: 'tut1', root: made.root, mode: 'tutor', text: 'Why does it still fail?' })
    const big = Array.from({ length: 20 }, (_, i) => `        x${i} = ${i}`).join('\n')
    expect(await tool('propose_edit').run({ path: 'rail/ledger.py', old_string: 'def balance(self, account: str) -> int:', new_string: `def balance(self, account: str) -> int:\n${big}` }, ctx)).toMatch(/at most 12 changed lines/)
    await ideas.noteTestRun(made.root, { failed: 0, total: 5 })
    expect(ideas.failedRuns(made.root)).toBe(0)
    expect((await ideas.planForRoot(made.root))!.milestones[0].failedRuns).toBe(3)
    // Letting Claude write makes it an author again
    await ideas.savePlan({ ...(await ideas.planForRoot(made.root))!, claudeWrites: true })
    await pair.send(owner(events), { session: 'tut1', root: made.root, mode: 'tutor', text: 'Write the ledger' })
    expect(await tool('write_file').run({ path: 'rail/new.py', content: 'x = 1\n' }, ctx)).toMatch(/Proposed/)
  })
})

describe('the ladder and suggestions, from what you study', () => {
  it('suggests mapped-out next steps and Claude’s own ideas', async () => {
    const v = await ideas.ladderView()
    expect(v.areas.map((a) => a.id)).toEqual(expect.arrayContaining(['software', 'data', 'blockchain', 'payments', 'quant', 'maths']))
    expect(v.suggestions.length).toBeGreaterThan(0)
    expect(v.suggestions.map((x) => x.area)).toContain('payments')
    const ideasNow = await ideas.ideaSuggestions(true)
    expect(ideasNow[0]).toMatchObject({ title: 'A FX settlement netting engine', tier: 2, area: 'payments' })
    // Cached for the day
    asked.length = 0
    await ideas.ideaSuggestions()
    expect(asked).toEqual([])
    // A step starts a plan already mapped out, with its tier
    const d = await ideas.draftPlan({ idea: '', answers: [], private: false, source: 'template', seed: 'ledger-module' })
    expect(d.plan).toMatchObject({ seed: 'ledger-module', tier: 1, area: 'payments' })
    expect(d.plan.milestones).toHaveLength(1)
  })
})