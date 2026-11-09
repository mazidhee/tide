import { describe, expect, it } from 'vitest'
import { briefMilestones, detectTools, drawSteps, flowsIn, markdownHeadings, seedCanvas, stepsReached } from '../src/shared/project'

describe('detectTools', () => {
  it('finds the tools a design doc uses, most mentioned first', () => {
    const doc = `The ledger lives in MongoDB. Each settlement batch is written to a Mongo collection.
Workflows run in n8n, triggered by webhooks from the bank. n8n retries failed steps.
Everything ships in Docker containers; docker-compose for local runs. We use mongoose for models.
A JavaScript client reads the API.`
    const found = detectTools([doc]).map((t) => t.name)
    expect(found[0]).toBe('MongoDB')
    expect(new Set(found)).toEqual(new Set(['MongoDB', 'n8n', 'Docker']))
  })

  it('needs two mentions, and keeps Java apart from JavaScript', () => {
    expect(detectTools(['We use JavaScript and javascript tooling, once Redis.'])).toEqual([])
  })
})

describe('flowsIn', () => {
  it('picks the headings that describe something happening in order', () => {
    expect(flowsIn(['Bank Reconciliation System — Design', '1. Overview', 'Matching Engine', 'Statement Ingestion service', '2. Settlement flow', '3. Data model', '4.2 Reconciliation matching process', 'Glossary', 'How payouts work'])).toEqual([
      'Settlement flow',
      'Reconciliation matching process',
      'How payouts work'
    ])
  })
})

describe('markdownHeadings and briefMilestones', () => {
  const brief = `# Tiny shell in C\n\n## Goal\nA shell.\n\n## Milestones\n- [x] **Read a line** and echo it\n- [ ] Parse commands into argv\n- [ ] fork/exec with PATH lookup\n\n## Risks\n- [ ] not a milestone`
  it('reads headings and the milestone checklist', () => {
    expect(markdownHeadings(brief)).toEqual(['Tiny shell in C', 'Goal', 'Milestones', 'Risks'])
    expect(briefMilestones(brief)).toEqual([
      { text: 'Read a line and echo it', done: true },
      { text: 'Parse commands into argv', done: false },
      { text: 'fork/exec with PATH lookup', done: false }
    ])
  })
})

describe('seedCanvas', () => {
  it("lays out the project's parts with its data stores beneath, unconnected", () => {
    const c = seedCanvas({ components: [{ name: 'Statement Ingestion service', about: 'Pulls statements' }, { name: 'Matching Engine', about: '' }, { name: 'Ledger service', about: '' }], tools: [{ name: 'MongoDB', mentions: 7 }, { name: 'Docker', mentions: 4 }] })
    expect(c.nodes.map((n) => [n.text.split('\n')[0], n.kind])).toEqual([
      ['Statement Ingestion service', 'service'],
      ['Matching Engine', 'service'],
      ['Ledger service', 'service'],
      ['MongoDB', 'database']
    ])
    expect(c.edges).toEqual([])
    expect(c.nodes[3].y).toBeGreaterThan(c.nodes[0].y)
  })
})

describe('a walkthrough keeps pace with the lesson', () => {
  const steps = [
    { from: 'Ledger service', to: 'Bank', label: 'payout instruction' },
    { from: 'Bank', to: 'Statement Ingestion service', label: 'MT940 statement' },
    { from: 'Statement Ingestion service', to: 'Matching Engine', label: 'bank_lines' }
  ]
  it('counts the steps the tutor has reached, in order', () => {
    expect(stepsReached(steps, 'A payout starts in the Ledger service.')).toBe(1)
    expect(stepsReached(steps, 'The ledger service sends it to the bank, and the bank sends a statement back. What reads it?')).toBe(1)
    expect(stepsReached(steps, 'The bank sends a statement; the ingestion service parses it. Then the Matching Engine pairs lines.')).toBe(3)
  })
  it('draws only the steps reached, adding parts the map lacked', () => {
    const start = seedCanvas({ components: [{ name: 'Statement Ingestion service', about: '' }, { name: 'Matching Engine', about: '' }, { name: 'Ledger service', about: '' }], tools: [] })
    const c = drawSteps(start, steps, 2)
    expect(c.edges.map((e) => e.label)).toEqual(['1. payout instruction', '2. MT940 statement'])
    expect(c.nodes.find((n) => n.text === 'Bank')?.kind).toBe('external')
  })
})
