/**
 * "Build my North Star" end to end on a vault on disk (main/northStar): the goal note is read as
 * the primary input; the preview lists exactly what will be written; building writes new files
 * only (an existing note, an existing roadmap and every other file untouched); ready roadmaps
 * already in the vault are registered as tracks, not copied; the week is planned at once. Then
 * the weekly check: a proposal approved changes the note and is recorded, a rejected one isn't
 * proposed again; and the learner's edits to the note are what the scheduler uses.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { data } = vi.hoisted(() => ({ data: { dir: '', planned: 0, prompts: [] as string[], reply: '' as string } }))

vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => data.dir }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: join(data.dir, 'vault'), ai: {} }) }))
vi.mock('../src/main/knowledge', () => ({ allConcepts: async () => [] }))
vi.mock('../src/main/learnerProfile', () => ({ profileDigest: async () => '' }))
vi.mock('../src/main/track', () => ({ loadTracks: async () => ({ version: 1, tracks: {} }) }))
vi.mock('../src/main/goals', () => ({ loadGoals: async () => ({ goals: [] }), replanNow: async () => null }))
vi.mock('../src/main/coach', () => ({
  getCoach: async () => ({ hoursPerWeek: 10, direction: 'old guess' }),
  getWeek: async () => null,
  planWeek: async () => void data.planned++
}))
vi.mock('../src/main/ai', () => ({ extractJsonObject: (t: string) => JSON.parse(t) }))
vi.mock('../src/main/learn', async () => {
  const ns = await import('../src/main/northStar')
  return {
    focusLog: async () => [],
    // Own notebooks, plus North Star's tracks as notebooks with no folder (as main/learn lists them)
    getNotebooks: async () => [
      { name: 'Mathematics', path: 'Mathematics', outline: 'Roadmaps/RM_MATH.md' },
      ...Object.entries(await ns.installedTracks()).map(([name, t]) => ({ name, path: name, outline: t.outline, virtual: true }))
    ]
  }
})

import * as NS from '../src/main/northStar'

const MATHS = `# Mathematics

## Part III — Abstraction and Rigour

### Chapter 12: Linear Algebra

- [ ] Vectors and vector spaces
- [ ] Eigenvalues and eigenvectors

### Chapter 14: Probability and Statistics

- [ ] Random variables, expectation and variance
- [ ] The central limit theorem
`

const GOAL_NOTE = `---
title: My goal and interests
---

# My goal and interests

## The goal

Become a cracked ML engineer with deep infrastructure knowledge, across quant finance and blockchain.

## Interests

- Risk and data science, hand in hand
`

const SYNTH = {
  goal: 'A cracked ML engineer with deep infrastructure.',
  assumptions: ['About 10 hours a week.'],
  thisMonth: ['Vectors and eigenvalues', 'Random variables'],
  stages: [
    {
      n: 1,
      title: 'Foundations',
      after: [],
      depth: 5,
      tracks: [
        { track: 'Mathematics', weight: 60, scope: ['Linear Algebra'] },
        { track: 'Data Science', weight: 40, scope: ['Probability and statistics'] }
      ],
      deep: [{ topic: 'Linear Algebra', depth: 5 }],
      synergies: ['Probability here feeds both VaR and logistic regression.'],
      capstone: { title: 'A Monte Carlo simulator', brief: 'Simulate and test.', joins: ['Mathematics', 'Data Science'] },
      gate: 'Linear algebra to build.'
    },
    {
      n: 2,
      title: 'Risk',
      after: [1],
      depth: 4,
      tracks: [
        { track: 'Risk', weight: 60, scope: ['Measuring market risk'] },
        { track: 'Data Science', weight: 40, scope: ['Analysis'] }
      ],
      deep: [],
      synergies: ['VaR is a quantile.'],
      capstone: { title: 'A VaR engine', brief: '', joins: ['Risk', 'Data Science'] },
      gate: ''
    }
  ],
  timeline: { summary: 'Honest.', cracked: 'Real systems.', compress: ['Once'] },
  shared: []
}

const vault = () => join(data.dir, 'vault')
const snapshot = () => {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else out.set(relative(vault(), p).split('\\').join('/'), readFileSync(p, 'utf8'))
    }
  }
  walk(vault())
  return out
}

beforeAll(() => {
  data.dir = mkdtempSync(join(tmpdir(), 'tide-ns-'))
  const w = (rel: string, text: string) => {
    mkdirSync(join(vault(), rel, '..'), { recursive: true })
    writeFileSync(join(vault(), rel), text)
  }
  w('Roadmaps/RM_MATH.md', MATHS)
  // A ready roadmap the learner already has (and changed): used as it is, never copied over
  w('Roadmaps/RM_RISK.md', '# Risk Roadmap\n\nMY EDITS\n\n## 1. Measuring market risk — CORE\n\n### Value at Risk\n\n- [ ] Historical simulation\n')
  // An earlier North Star note of theirs
  w('Tide/North Star.md', '# My own North Star\n\nhand written')
  w('Coach/My goal and interests.md', GOAL_NOTE)
  w('Mathematics/Vectors.md', 'a note')
  NS.setNorthStarAsker(async (job, prompt) => {
    data.prompts.push(prompt)
    return { text: job === 'northStar' ? JSON.stringify(SYNTH) : data.reply, by: 'claude' }
  })
})
afterAll(() => rmSync(data.dir, { recursive: true, force: true }))

describe('Build my North Star', () => {
  it('plans from the goal note, previews exactly what it writes, and writes only new files', async () => {
    const d = await NS.synthesise({ goal: '' })
    expect(data.prompts[0]).toContain('their own note, the primary input')
    expect(data.prompts[0]).toContain('Risk and data science, hand in hand')
    expect(d.notePath).toBe('Tide/North Star 2.md')
    expect(d.files.map((f) => [f.path, f.exists])).toEqual([
      ['Tide/North Star.md', true],
      ['Tide/North Star 2.md', false],
      ['Roadmaps/RM_DATA_SCIENCE.md', false],
      ['Roadmaps/RM_RISK.md', true],
      ['.tide/northstar.json', false]
    ])
    expect(d.note).toContain('- Depth: 5 (build)')

    const before = snapshot()
    const r = await NS.build()
    const after = snapshot()
    // Every file that was there is byte for byte the same
    for (const [path, text] of before) expect(after.get(path), path).toBe(text)
    // And the new ones are exactly what the preview said
    expect([...after.keys()].filter((p) => !before.has(p)).sort()).toEqual(['.tide/northstar.json', 'Roadmaps/RM_DATA_SCIENCE.md', 'Tide/North Star 2.md'])
    expect(r.notePath).toBe('Tide/North Star 2.md')
    // Ready roadmaps already in the vault are tracks without being copied; no folders were made
    expect(r.tracks.sort()).toEqual(['Data Science', 'Risk'])
    expect(readdirSync(vault()).sort()).toEqual(['.tide', 'Coach', 'Mathematics', 'Roadmaps', 'Tide'])
    // Started right away: the week was planned
    expect(r.week).toBe(true)
    expect(data.planned).toBe(1)
    await expect(NS.build()).rejects.toThrow(/Nothing to build/)
  })

  it('never writes over a note that appears between the preview and the build', async () => {
    await NS.synthesise({ goal: 'and C++ too' })
    const d = NS.currentDraft()!
    expect(d.notePath).toBe('Tide/North Star 3.md')
    writeFileSync(join(vault(), d.notePath), 'made meanwhile')
    await expect(NS.build()).rejects.toThrow(/appeared meanwhile/)
    expect(readFileSync(join(vault(), d.notePath), 'utf8')).toBe('made meanwhile')
    NS.discardDraft()
  })

  it('the scheduler takes the current stage from the note, edits included', async () => {
    NS.resetNorthStar()
    const g = (await NS.schedulerGoal())!
    expect(g.needs.map((n) => [n.ref, n.hours])).toEqual([
      ['Mathematics', 60],
      ['Data Science', 40]
    ])
    const path = join(vault(), 'Tide/North Star 2.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('- Tracks: Mathematics 60%, Data Science 40%', '- Tracks: Mathematics 45%, Data Science 55%'))
    NS.resetNorthStar()
    expect((await NS.schedulerGoal())!.needs.map((n) => n.hours)).toEqual([45, 55])
    expect((await NS.trackScope('Risk'))!.scope).toEqual([])
    expect((await NS.trackScope('Mathematics'))!.scope).toEqual(['Chapter 12: Linear Algebra'])
    expect(await NS.trackScope('Economics')).toBeNull()
    const v = (await NS.view())!
    expect(v.edited).toBe(true)
    expect(v.ns.stages[0].tracks[1].weight).toBe(55)
  })

  it('the weekly check: approve changes the note and is recorded; a rejected change isn’t proposed again', async () => {
    data.reply = JSON.stringify({
      summary: 'Data science is ahead.',
      proposals: [
        { kind: 'depth', stage: 1, topic: 'Probability and Statistics', depth: 4, why: 'It feeds VaR.' },
        { kind: 'synergy', stage: 1, synergy: 'Eigenvalues are PCA.', why: 'Seen in a lesson.' }
      ]
    })
    let v = (await NS.review(true))!
    expect(data.prompts.at(-1)).toContain('they have edited it since Tide last wrote it')
    expect(data.prompts.at(-1)).toContain('Become a cracked ML engineer')
    expect(v.proposals.map((p) => p.kind)).toEqual(['depth', 'synergy'])
    v = (await NS.decide(v.proposals[0].id, true))!
    const note = readFileSync(join(vault(), 'Tide/North Star 2.md'), 'utf8')
    expect(note).toContain('Probability and Statistics 4 (transfer)')
    expect(note).toMatch(/Approved: Stage 1: take Probability and Statistics to depth 4/)
    // Their own edit survived Tide writing the note again
    expect(note).toContain('Mathematics 45%, Data Science 55%')
    v = (await NS.decide(v.proposals[0].id, false))!
    expect(readFileSync(join(vault(), 'Tide/North Star 2.md'), 'utf8')).toMatch(/Rejected: Stage 1: note the synergy/)
    expect(v.proposals).toEqual([])
    v = (await NS.review(true))!
    expect(v.proposals).toEqual([])
  })

  it('moving on installs the next stage’s roadmaps (new files only) and records it', async () => {
    const before = readFileSync(join(vault(), 'Roadmaps/RM_RISK.md'), 'utf8')
    const v = (await NS.moveOn())!
    expect(v.ns.current).toBe(2)
    expect(readFileSync(join(vault(), 'Roadmaps/RM_RISK.md'), 'utf8')).toBe(before)
    expect(readFileSync(join(vault(), 'Tide/North Star 2.md'), 'utf8')).toMatch(/Moved on to stage 2 before stage 1’s gate passed/)
    expect((await NS.trackScope('Risk'))!.scope).toEqual(['Measuring market risk'])
  })
})
