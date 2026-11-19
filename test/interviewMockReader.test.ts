import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// An invented target in a throwaway vault
const root = mkdtempSync(join(tmpdir(), 'tide-mock-reader-'))
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))
vi.mock('../src/main/vault', () => ({ absPath: (p: string) => join(root, p) }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({}) }))

const dir = join(root, 'Interview prep', 'Northwind Analyst')
mkdirSync(dir, { recursive: true })
// An unquoted colon in a round's notes: not valid YAML, still read
writeFileSync(
  join(dir, 'target.md'),
  `---\ncompany: Northwind Capital\nrole: Risk Analyst\nrounds:\n  - id: technical\n    name: Technical interview\n    kind: technical\n    minutes: 30\n    notes: Scenarios piece by piece. Required: clarifying questions.\n  - id: presentation\n    name: Presentation\n    kind: presentation\n    minutes: 30\n---\n\n# Northwind\n\nQuestions candidates reported:\n- Tell me about a time you persuaded someone.\n`
)
writeFileSync(
  join(dir, 'questions.md'),
  `# Bank\n\n## Motivation\n\n## mot-01. Tell me about yourself.\n- Round: technical\n- Kind: motivation\n- Route: Who → Why → Next\n- Outline:\n  - Maths student\n  - Why risk: grew up around a small business\n\n## beh-01. Tell me about a **hard** goal.\n- Kind: behavioural\n`
)
writeFileSync(join(dir, 'scenarios.md'), `## S1. Lending app\n\n### Part 1\nAn app approves loans.\n\n### Part 2\nDefaults rise.\n\n### Rubric\n- Model risk: drift\n- Escalate to the board\n`)
writeFileSync(
  join(dir, 'presentation.md'),
  `# Presentation: AI in lending\n\n## Brief checklist\n- [ ] Key message caption\n- [ ] Conclusion\n\n## Opportunities (assessors like balance)\nText.\n\n## Assessor questions\n\n### 1. Which risk first?\nStrong answer: picks one and defends it.\n`
)
writeFileSync(join(dir, 'ask-them.md'), `# Ask\n\n1. "What does a first month look like?"\n- Never ask what they covered.\n`)

describe('the temporary target reader', () => {
  it('reads rounds even when the front matter is not valid YAML', async () => {
    const m = await import('../src/main/interviewMock')
    const ts = await m.listTargets()
    expect(ts[0].slug).toBe('northwind-analyst')
    expect(ts[0].rounds.map((r) => `${r.id}/${r.kind}/${r.minutes}`)).toEqual(['technical/technical/30', 'presentation/presentation/30'])
    const i = await m.loadInput('northwind-analyst', 'technical')
    expect(i.round.notes).toContain('Required: clarifying questions')
    // The grouping heading isn't a question; an outline's own bullets stay in the outline
    expect(i.questions.map((q) => q.id)).toEqual(['mot-01', 'beh-01'])
    expect(i.questions[0].outline).toContain('Why risk: grew up')
    expect(i.questions[0].kind).toBe('motivation')
    expect(i.questions[1].text).toBe('Tell me about a hard goal.')
    expect(i.scenarios[0]).toMatchObject({ id: 'S1', parts: ['An app approves loans.', 'Defaults rise.'], rubric: ['Model risk: drift', 'Escalate to the board'] })
    expect(i.presentation).toEqual({ topic: 'AI in lending', checklist: ['Key message caption', 'Conclusion'], assessorQuestions: [{ q: 'Which risk first?', point: 'picks one and defends it.' }] })
    expect(i.askThem).toEqual(['"What does a first month look like?"'])
  })
})
