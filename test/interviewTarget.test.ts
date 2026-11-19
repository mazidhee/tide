import { readFileSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import {
  areaItems,
  attemptOf,
  cardsAddedOn,
  cardsFileStart,
  cardsFromFiles,
  cardsHeading,
  countdown,
  covers,
  emptyProgress,
  fields,
  lenientFrontMatter,
  idAndTitle,
  itemMark,
  lengthMark,
  markInCode,
  momentOf,
  overallReadiness,
  parseAskThem,
  parseFirm,
  parseFrameworks,
  parseMarks,
  parsePresentation,
  parseQuestions,
  parseScenarios,
  parseStories,
  parseTarget,
  progressOf,
  rawField,
  readiness,
  reviewSlots,
  slugOf,
  targetMarkdown,
  todaysPlan,
  whenText,
  withModelAnswer,
  zoneOffset,
  targetWindow,
  type Attempt,
  type Progress,
  type TargetFiles
} from '@shared/interviewTarget'
import { aiTells, naturalness, HUMAN_WRITING } from '@shared/humanWriting'

const DIR = join(__dirname, 'fixtures/interview/Northwind Analyst')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

function load(): TargetFiles {
  const raw = read('target.md')
  const m = matter(raw)
  return {
    meta: parseTarget(m.data, m.content, 'Interview prep/Northwind Analyst', raw),
    stories: parseStories(read('stories.md')),
    questions: parseQuestions(read('questions.md')),
    scenarios: parseScenarios(read('scenarios.md')),
    presentation: parsePresentation(read('presentation.md')),
    firm: parseFirm(read('firm.md')),
    ask: parseAskThem(read('ask-them.md')),
    frameworks: parseFrameworks(read('frameworks.md'))
  }
}

const at = (iso: string) => new Date(iso).getTime()
const attempt = (item: string, area: Attempt['area'], score: number, t: number, drill: Attempt['drill'] = 'behavioural'): Attempt => ({ item, area, drill, at: t, score, marks: {}, by: 'code' })

describe('target.md', () => {
  const t = load().meta
  it('reads the front matter and rounds', () => {
    expect(t.company).toBe('Northwind Capital')
    expect(t.role).toBe('Graduate Analyst, Operational Risk')
    expect(t.slug).toBe('northwind-analyst')
    expect(t.name).toBe('Northwind Analyst')
    expect(t.date).toBe('2026-11-25T09:00')
    expect(t.slidesDue).toBe('2026-11-23')
    expect(t.timezone).toBe('Europe/London')
    expect(t.course).toBe('ops-risk-basics')
    expect(t.sources).toEqual(['/tmp/northwind-sources'])
    expect(t.links).toHaveLength(2)
    expect(t.rounds.map((r) => [r.id, r.kind, r.minutes])).toEqual([
      ['r1', 'hirevue', 20],
      ['r2', 'behavioural', 45],
      ['r3', 'technical', 40],
      ['r4', 'presentation', 30]
    ])
    expect(t.rounds[0].notes).toMatch(/Five recorded/)
    expect(t.notes).toMatch(/escalation/)
    expect(t.notes).not.toMatch(/^#/)
  })
  it('keeps dates as written, and tolerates a bare day, a Date and missing fields', () => {
    const fromDate = parseTarget({ company: 'Acme', date: new Date(Date.UTC(2026, 11, 3)) }, '', 'Interview prep/Acme')
    expect(fromDate.date).toBe('2026-12-03')
    expect(fromDate.rounds).toEqual([])
    expect(fromDate.sources).toEqual([])
    const bare = parseTarget({}, '', 'Interview prep/Plain Co')
    expect(bare.company).toBe('Plain Co')
    expect(bare.date).toBeUndefined()
    expect(rawField('---\ndate: "2026-11-25 09:00"\n---\n', 'date')).toBe('2026-11-25 09:00')
    expect(parseTarget({ timezone: 'Not/AZone' }, '', 'x').timezone).toBeUndefined()
  })
  it('accepts rounds as plain strings', () => {
    const r = parseTarget({ rounds: ['Technical case', 'Final behavioural'] }, '', 'x').rounds
    expect(r.map((x) => x.kind)).toEqual(['technical', 'behavioural'])
  })
  it('writes a new target.md that reads back', () => {
    const md = targetMarkdown({ company: 'Fabrikam: Bank', role: 'Analyst', date: '2026-12-01T10:30', timezone: 'Europe/Paris', sources: ['/Users/a/prep'], links: ['https://example.org/x'] })
    const m = matter(md)
    const back = parseTarget(m.data, m.content, 'Interview prep/Fabrikam', md)
    expect(back.company).toBe('Fabrikam: Bank')
    expect(back.date).toBe('2026-12-01T10:30')
    expect(back.sources).toEqual(['/Users/a/prep'])
    expect(back.timezone).toBe('Europe/Paris')
  })
  it('slugs names', () => {
    expect(slugOf('Contoso  Bank — Grad 2027!')).toBe('contoso-bank-grad-2027')
    expect(slugOf('///')).toBe('target')
  })
})

describe('stories.md', () => {
  const s = parseStories(read('stories.md'))
  it('reads each story', () => {
    expect(s.map((x) => x.id)).toEqual(['S1', 'S2', 'S3'])
    expect(s[0].title).toBe("Rebuilt the society's payments sheet")
    expect(s[0].bestFor).toEqual(['initiative', 'problem solving', 'attention to detail'])
    expect(s[0].evidence).toHaveLength(3)
    expect(s[0].anchors).toEqual(['treasurer', '400 payments', 'duplicate entries', 'script', 'reconciled monthly'])
    expect(s[0].gaps).toHaveLength(2)
  })
  it('treats "none" as no gaps and an untidy heading as its own id', () => {
    expect(s[1].gaps).toEqual([])
    expect(s[1].evidence).toHaveLength(2)
    expect(s[2].title).toMatch(/loan defaults/)
    expect(s[2].anchors).toEqual(['logistic regression', 'class imbalance', 'AUC 0.78'])
  })
  it('ids and titles', () => {
    expect(idAndTitle('B12. Tell me', 'x')).toEqual({ id: 'B12', title: 'Tell me' })
    expect(idAndTitle('Q-3) Why us?', 'x')).toEqual({ id: 'Q-3', title: 'Why us?' })
    expect(idAndTitle('Just a heading', 'H1')).toEqual({ id: 'H1', title: 'Just a heading' })
  })
  it('fields run over nested and continued lines', () => {
    const f = fields('- Evidence:\n  - one\n    more\n  - two\n- Anchors: a, b\n')
    expect(f.evidence.items).toEqual(['one more', 'two'])
    expect(f.anchors.inline).toBe('a, b')
  })
})

describe('questions.md', () => {
  const q = parseQuestions(read('questions.md'))
  it('reads fields, kinds and routes', () => {
    expect(q.map((x) => x.id)).toEqual(['M1', 'B1', 'B2', 'C1', 'T1', 'P1', 'K1'])
    expect(q[0]).toMatchObject({ round: 'r2', kind: 'motivation', source: 'likely', stories: ['S1'] })
    expect(q[0].route).toEqual(['Hook', 'What the role does', 'Why me', 'Why now'])
    expect(q[0].outline).toHaveLength(2)
    expect(q[1].outline).toEqual(['treasurer, payments sheet', 'wrote a script', '12 duplicates found'])
    expect(q.map((x) => x.kind)).toEqual(['motivation', 'behavioural', 'behavioural', 'cv', 'technical', 'presentation-qa', 'market'])
  })
  it('reads a model answer, and only where there is one', () => {
    expect(q[1].model).toMatch(/^When I was treasurer/)
    expect(q[1].model).toMatch(/PRACTICE VERSION/)
    expect(q[1].route).toEqual(['Context', 'Action', 'Result', 'Lesson'])
    expect(q[2].model).toBeUndefined()
  })
  it('adds a model answer under its question, once, leaving the rest alone', () => {
    const raw = read('questions.md')
    const next = withModelAnswer(raw, 'B2', 'I was a weekend supervisor.')
    const again = parseQuestions(next)
    expect(again.find((x) => x.id === 'B2')!.model).toBe('I was a weekend supervisor.')
    expect(again.find((x) => x.id === 'C1')!.model).toBeUndefined()
    expect(again.find((x) => x.id === 'B1')!.model).toBe(q[1].model)
    expect(withModelAnswer(next, 'B2', 'Other')).toBe(next)
    expect(withModelAnswer(raw, 'B1', 'Other')).toBe(raw)
    expect(withModelAnswer(raw, 'NOPE', 'x')).toBe(raw)
    expect(next.length).toBeGreaterThan(raw.length)
    // Additive: every original line is still there
    for (const line of raw.split('\n').filter((l) => l.trim())) expect(next).toContain(line)
  })
  it('adds to the last question too', () => {
    const next = withModelAnswer(read('questions.md'), 'K1', 'Revenue rose.')
    expect(parseQuestions(next).at(-1)!.model).toBe('Revenue rose.')
  })
})

describe('scenarios.md', () => {
  const c = parseScenarios(read('scenarios.md'))
  it('reads parts in order and the rubric by group', () => {
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('X1')
    expect(c[0].parts).toHaveLength(3)
    expect(c[0].parts[1]).toMatch(/37 items/)
    expect(c[0].rubric).toHaveLength(7)
    expect(c[0].rubric.filter((r) => r.group === 'risk')).toHaveLength(3)
    expect(c[0].rubric.filter((r) => r.group === 'mitigation')).toHaveLength(2)
    expect(c[0].rubric.filter((r) => r.group === 'escalation')).toHaveLength(2)
  })
  it('reads groups written into the bullets, and drops cases with no parts', () => {
    const c2 = parseScenarios('## A. Case\n### Part 1\nHello\n### Rubric\n- Risk: data loss\n- Board: tell the committee\n- something else\n\n## B. Empty\nNothing\n')
    expect(c2).toHaveLength(1)
    expect(c2[0].rubric.map((r) => r.group)).toEqual(['risk', 'board', 'general'])
  })
})

describe('presentation.md', () => {
  const p = parsePresentation(read('presentation.md'))
  it('reads the checklist, topic, research and assessor questions', () => {
    expect(p.checklist).toHaveLength(4)
    expect(p.checklist[0]).toEqual({ text: '10 slides at most', done: true })
    expect(p.topic).toMatch(/critical suppliers/)
    expect(p.research).toEqual(['Third-party risk basics', 'Concentration risk in cloud providers'])
    expect(p.assessor).toHaveLength(3)
    expect(p.assessor[0].question).toMatch(/cyber risk\?$/)
    expect(p.assessor[0].point).toMatch(/^Third-party failures/)
    expect(p.assessor[2].point).toBe('')
    expect(p.minutes).toBe(15)
  })
  it('reads assessor questions written as subheadings', () => {
    const p2 = parsePresentation('## Assessor questions\n### Why this?\n- Point: because it matters most\n### What next?\nA pilot.\n')
    expect(p2.assessor.map((a) => [a.question, a.point])).toEqual([
      ['Why this?', 'because it matters most'],
      ['What next?', 'A pilot.']
    ])
  })
})

describe('firm.md, ask-them.md, frameworks.md', () => {
  it('reads facts with their sources and dates', () => {
    const f = parseFirm(read('firm.md'))
    expect(f).toHaveLength(5)
    expect(f[0]).toMatchObject({ section: 'Strategy', source: 'annual report', date: '2025' })
    expect(f[0].text).toBe('Northwind aims to double its payments business by 2028')
    expect(f[1]).toMatchObject({ source: 'investor day', date: '2025-06' })
    expect(f[2]).toMatchObject({ section: 'Figures', date: '2026-02' })
    expect(f[3].source).toBeUndefined()
  })
  it('reads questions to ask by interviewer, and the rules', () => {
    const a = parseAskThem(read('ask-them.md'))
    expect(a.groups.map((g) => [g.who, g.questions.length])).toEqual([
      ['Recruiter', 2],
      ['Line manager', 2]
    ])
    expect(a.rules).toEqual(['never ask what they already covered.'])
  })
  it('reads framework topics', () => {
    expect(parseFrameworks(read('frameworks.md'))).toEqual(['Three lines of defence', 'Risk and control self-assessment', 'Value at risk'])
  })
})

describe('time zones', () => {
  it('reads a time without a zone as the target zone’s wall clock', () => {
    // 25 Nov is winter: London is UTC+0
    expect(momentOf('2026-11-25T09:00', 'Europe/London')).toBe(at('2026-11-25T09:00:00Z'))
    // July: London is UTC+1
    expect(momentOf('2026-07-01T09:00', 'Europe/London')).toBe(at('2026-07-01T08:00:00Z'))
    expect(momentOf('2026-11-25T09:00', 'America/New_York')).toBe(at('2026-11-25T14:00:00Z'))
    expect(momentOf('2026-11-25T09:00', 'Asia/Kolkata')).toBe(at('2026-11-25T03:30:00Z'))
  })
  it('keeps an explicit Z or offset as exact, whatever the zone', () => {
    expect(momentOf('2026-11-25T09:00:00Z', 'America/New_York')).toBe(at('2026-11-25T09:00:00Z'))
    expect(momentOf('2026-11-25T09:00:00+05:30')).toBe(at('2026-11-25T03:30:00Z'))
  })
  it('a bare day is 9am in the zone', () => {
    expect(momentOf('2026-11-25', 'Asia/Tokyo')).toBe(at('2026-11-25T00:00:00Z'))
  })
  it('settles on the right side of a clock change', () => {
    // London goes back an hour at 02:00 BST on 25 Oct 2026; 03:00 that day is GMT
    expect(momentOf('2026-10-25T03:00', 'Europe/London')).toBe(at('2026-10-25T03:00:00Z'))
    expect(momentOf('2026-03-29T03:00', 'Europe/London')).toBe(at('2026-03-29T02:00:00Z'))
    expect(zoneOffset(at('2026-07-01T00:00:00Z'), 'Europe/London')).toBe(60)
  })
  it('shows the time in both zones when they differ', () => {
    expect(whenText('2026-11-25T09:00', 'Europe/London', 'Europe/Paris')).toBe('Wed 25 Nov, 09:00 London · 10:00 your time')
    expect(whenText('2026-11-25T09:00', 'Europe/London', 'Europe/London')).toBe('Wed 25 Nov, 09:00')
    expect(whenText('2026-11-25T09:00', 'Europe/London', 'America/Los_Angeles')).toBe('Wed 25 Nov, 09:00 London · 01:00 your time')
    expect(whenText('2026-11-25T09:00', 'Asia/Tokyo', 'America/New_York')).toBe('Wed 25 Nov, 09:00 Tokyo · 19:00 Tue 24 Nov your time')
    expect(whenText('2026-11-25T09:00:00Z', undefined, 'America/New_York')).toBe('Wed 25 Nov, 04:00')
    expect(whenText('2026-11-25', 'Europe/London', 'Europe/Paris')).toBe('Wed 25 Nov')
    expect(whenText(undefined, undefined, 'Europe/London')).toBe('')
  })
  it('counts down correctly across zones', () => {
    const now = momentOf('2026-11-24T08:00', 'Europe/London')!
    const c = countdown('2026-11-25T09:00', now, 'Asia/Tokyo')!
    // 09:00 Tokyo is midnight London, 16 hours away
    expect(c.hours).toBe(16)
    expect(c.past).toBe(false)
    const z = countdown('2026-11-25T09:00:00Z', at('2026-11-25T08:00:00Z'), 'Asia/Tokyo')!
    expect(z.hours).toBe(1)
    expect(countdown('2026-11-20T09:00:00Z', at('2026-11-25T08:00:00Z'))!.past).toBe(true)
  })
})

describe('countdown', () => {
  const now = new Date(2026, 10, 19, 15, 0).getTime()
  it('counts days by the calendar', () => {
    expect(countdown('2026-11-25', now)!.text).toBe('in 6 days')
    expect(countdown('2026-11-20', now)!.text).toBe('tomorrow')
    expect(countdown('2026-11-19', now)!.text).toBe('today')
    expect(countdown('2026-11-17', now)).toMatchObject({ text: '2 days ago', past: true })
    expect(countdown('2026-11-19T18:00', now)!.text).toBe('in 3 hours')
    expect(countdown('2026-11-19T10:00', now)!.past).toBe(true)
    expect(countdown(undefined, now)).toBeNull()
    expect(countdown('soon', now)).toBeNull()
  })
})

describe('readiness', () => {
  const t = load()
  const now = new Date(2026, 10, 19, 9).getTime()
  it('builds each area from its files', () => {
    const items = areaItems(t)
    expect(items.cv.map((x) => x.item)).toEqual(['story:S1', 'story:S2', 'story:S3', 'q:C1'])
    expect(items.behavioural.map((x) => x.item)).toEqual(['q:M1', 'q:B1', 'q:B2'])
    expect(items.scenarios.map((x) => x.item)).toEqual(['scenario:X1', 'q:T1'])
    expect(items.presentation.map((x) => x.item)).toEqual(['talk', 'assessor:A1', 'assessor:A2', 'assessor:A3', 'q:P1'])
    expect(items.firm.map((x) => x.item)).toEqual(['q:K1', 'firm:facts'])
    expect(items.ask.map((x) => x.item)).toEqual(['ask:Recruiter', 'ask:Line manager'])
  })
  it('starts at zero', () => {
    const r = readiness(t, emptyProgress('x'), null)
    expect(r.every((a) => a.score === 0)).toBe(true)
    expect(overallReadiness(r)).toBe(0)
  })
  it('counts coverage and recent marks', () => {
    const p: Progress = { slug: 'x', attempts: [attempt('q:B1', 'behavioural', 0.2, now - 3000), attempt('q:B1', 'behavioural', 0.8, now - 1000)] }
    const b = readiness(t, p, null).find((a) => a.area === 'behavioural')!
    expect(b.attempted).toBe(1)
    // Latest counts twice: (0.2 + 1.6) / 3 = 0.6, spread over 3 items; 0.15 × 1/3 + 0.85 × 0.2
    expect(b.marks).toBeCloseTo(0.6)
    expect(b.score).toBeCloseTo(0.05 + 0.17)
  })
  it('weights recent attempts more, over the last five', () => {
    expect(itemMark([])).toBeNull()
    expect(itemMark([attempt('a', 'cv', 1, 1)])).toBe(1)
    const many = [0, 0, 0, 0, 0, 1].map((s, i) => attempt('a', 'cv', s, i))
    expect(itemMark(many)).toBeCloseTo(16 / 31)
  })
  it('counts card retention in firm and markets', () => {
    const r = readiness(t, emptyProgress('x'), { total: 10, due: 2, remembered: 6 })
    expect(r.find((a) => a.area === 'firm')!.score).toBeCloseTo(0.2)
  })
  it('leaves out areas with nothing in them, and leans the overall toward the weakest', () => {
    const empty: TargetFiles = { ...t, presentation: null, ask: { groups: [], rules: [] } }
    const r = readiness(empty, emptyProgress('x'), null)
    expect(r.find((a) => a.area === 'presentation')!.score).toBeNull()
    const fake = [
      { area: 'cv', label: '', score: 0.9, items: 1, attempted: 1, marks: 0.9 },
      { area: 'ask', label: '', score: 0.1, items: 1, attempted: 1, marks: 0.1 }
    ] as const
    const o = overallReadiness([...fake])!
    expect(o).toBeLessThan(0.5)
    expect(o).toBeGreaterThan(0.1)
    expect(overallReadiness([])).toBeNull()
  })
  it('drops malformed progress', () => {
    const p = progressOf('x', { attempts: [attempt('q:B1', 'behavioural', 1, 1), { item: 3 }, null, { ...attempt('a', 'cv', 1, 1), area: 'nope' }] })
    expect(p.attempts).toHaveLength(1)
    expect(progressOf('x', null).attempts).toEqual([])
  })
})

describe("today's plan", () => {
  const t = load()
  const now = new Date(2026, 10, 19, 9).getTime()
  it('puts due cards first, then mixes the weakest areas', () => {
    const plan = todaysPlan(t, emptyProgress('x'), { total: 5, due: 4, remembered: 0 }, now)
    expect(plan[0]).toMatchObject({ drill: 'cards', label: 'Review 4 cards' })
    expect(plan.length).toBeGreaterThanOrEqual(5)
    expect(plan.length).toBeLessThanOrEqual(8)
    expect(new Set(plan.map((p) => p.area).filter(Boolean)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(plan.map((p) => p.key)).size).toBe(plan.length)
  })
  it('brings in the talk when slides are due within three days', () => {
    const near = todaysPlan(t, emptyProgress('x'), null, new Date(2026, 10, 21, 9).getTime())
    expect(near[0].drill).toBe('talk')
    const far = todaysPlan(t, emptyProgress('x'), null, new Date(2026, 10, 1, 9).getTime())
    expect(far[0].drill).not.toBe('talk')
  })
  it('skips what was done today and what is already strong', () => {
    const p: Progress = { slug: 'x', attempts: [attempt('q:M1', 'behavioural', 0.3, now - 1000), attempt('story:S1', 'cv', 0.95, now - 5 * 86_400_000, 'cv')] }
    const plan = todaysPlan(t, p, null, now, 20)
    expect(plan.some((x) => x.item === 'q:M1')).toBe(false)
    expect(plan.some((x) => x.item === 'story:S1')).toBe(false)
    expect(plan.some((x) => x.item === 'story:S2')).toBe(true)
  })
  it('tries untried items before weak ones', () => {
    const p: Progress = { slug: 'x', attempts: [attempt('q:B1', 'behavioural', 0.1, now - 3 * 86_400_000)] }
    const plan = todaysPlan(t, p, null, now, 30).filter((x) => x.area === 'behavioural')
    expect(plan.map((x) => x.item)).toEqual(['q:M1', 'q:B2', 'q:B1'])
  })
})

describe('cards', () => {
  const t = load()
  it('heads each day’s cards, and knows when today’s are in', () => {
    const now = new Date(2026, 10, 19, 9).getTime()
    expect(cardsHeading(now)).toBe('## Added 2026-11-19')
    const raw = cardsFileStart('Northwind Analyst') + '\n' + cardsHeading(now) + '\n\nQ::A\n'
    expect(cardsAddedOn(raw, now)).toBe(true)
    expect(cardsAddedOn(raw, now + 86_400_000)).toBe(false)
    expect(matter(cardsFileStart('Northwind Analyst')).data).toEqual({ tags: ['flashcards'], deck: 'Interview: Northwind Analyst' })
  })
  it('makes cards from the files without a model, only from what is written', () => {
    const have = new Set<string>()
    const cards = cardsFromFiles(t, have)
    expect(cards.length).toBeGreaterThan(3)
    expect(cards.length).toBeLessThanOrEqual(10)
    const revenue = cards.find((c) => c.back.startsWith('Revenue'))!
    expect(revenue.front).toMatch(/…/)
    expect(revenue.front).not.toMatch(/4\.2/)
    expect(cards.some((c) => c.back === 'treasurer, 400 payments, duplicate entries, script, reconciled monthly')).toBe(true)
    expect(cardsFromFiles(t, have)).toEqual([])
  })
  it('splits today into a morning and an evening review', () => {
    const d = (h: number) => new Date(2026, 10, 19, h).getTime()
    const dues = [null, d(8), d(16), d(30)]
    const morning = reviewSlots(dues, [], d(9))
    expect(morning.morning).toMatchObject({ state: 'due', due: 2 })
    expect(morning.evening).toMatchObject({ state: 'later', due: 1 })
    const done = reviewSlots([d(30), d(16)], [d(9)], d(11))
    expect(done.morning).toMatchObject({ state: 'done', reviewed: 1 })
    const evening = reviewSlots([d(30), d(16)], [d(9)], d(17))
    expect(evening.evening).toMatchObject({ state: 'due', due: 1 })
    expect(reviewSlots([d(30)], [], d(17)).morning.state).toBe('missed')
    expect(reviewSlots([d(30)], [d(15)], d(17)).evening).toMatchObject({ state: 'done', reviewed: 1 })
  })
})

describe('marking in code', () => {
  const t = load()
  const b1 = t.questions.find((q) => q.id === 'B1')!
  const s1 = t.stories[0]
  it('marks a strong behavioural answer well and a weak one poorly', () => {
    const strong =
      'When I was treasurer of the investing society, I had to keep 400 member payments straight in a spreadsheet. I wrote a script that reconciled the bank export against the sheet every month, and I found 12 duplicate entries. As a result we refunded them, and now the sheet is reconciled monthly. I learned to check the source data before trusting a total.'
    const weak = 'We did a lot of work on the spreadsheet and the team fixed things.'
    const m1 = markInCode({ drill: 'behavioural', question: b1.text, answer: strong, seconds: 100, route: b1.route, anchors: s1.anchors, outline: b1.outline }, naturalness)
    const m2 = markInCode({ drill: 'behavioural', question: b1.text, answer: weak, seconds: 8, route: b1.route, anchors: s1.anchors, outline: b1.outline }, naturalness)
    expect(m1.score).toBeGreaterThan(0.7)
    expect(m2.score).toBeLessThan(0.35)
    expect(m1.marks.ownership).toBeGreaterThan(0.6)
    expect(m2.marks.ownership).toBe(0)
    expect(m1.missed.length).toBeLessThan(m2.missed.length)
    expect(m1.by).toBe('code')
    expect(m2.feedback).toMatch(/rough guide/)
  })
  it('marks a scenario against its rubric groups', () => {
    const c = t.scenarios[0]
    const answer =
      'First I would run the reconciliation now and investigate each break. Unreconciled items can hide errors or fraud, and the payment to a dormant supplier could be fraud. The control relied on one analyst, a key-person dependency, so I would document the procedure and assign a backup owner. I would escalate to the deputy the same day and raise an incident with operational risk.'
    const m = markInCode({ drill: 'scenario', question: c.title, answer, seconds: 120, rubric: c.rubric }, naturalness)
    expect(m.marks.risks).toBeGreaterThan(0.6)
    expect(m.marks.mitigation).toBe(1)
    expect(m.marks.communication).toBeGreaterThan(0.6)
    const thin = markInCode({ drill: 'scenario', question: c.title, answer: 'I would look into it.', seconds: 5, rubric: c.rubric }, naturalness)
    expect(thin.score).toBeLessThan(0.2)
    expect(thin.missed).toHaveLength(7)
  })
  it('marks a talk on the brief and the clock', () => {
    const p = t.presentation!
    const talk = 'I recommend one change to how the firm manages third-party risk. The talk lasts 15 minutes. One figure from public sources shows outages.'
    const onTime = markInCode({ drill: 'talk', question: 'talk', answer: talk, seconds: 14 * 60, checklist: p.checklist.map((c) => c.text), minutes: 15 }, naturalness)
    const long = markInCode({ drill: 'talk', question: 'talk', answer: talk, seconds: 22 * 60, checklist: p.checklist.map((c) => c.text), minutes: 15 }, naturalness)
    expect(onTime.marks.timing).toBe(1)
    expect(long.marks.timing).toBeLessThan(0.6)
    expect(onTime.marks.brief).toBeGreaterThanOrEqual(0.5)
  })
  it('marks an assessor answer on its point', () => {
    const a = t.presentation!.assessor[1]
    const good = markInCode({ drill: 'assessor', question: a.question, answer: 'I would track incidents traced to suppliers and the time it takes to detect them.', seconds: 50, point: a.point }, naturalness)
    const off = markInCode({ drill: 'assessor', question: a.question, answer: 'It would be a good thing for the bank overall.', seconds: 50, point: a.point }, naturalness)
    expect(good.marks.point).toBeGreaterThan(off.marks.point)
  })
  it('marks CV defence on accuracy and depth', () => {
    const m = markInCode({ drill: 'cv', question: 'Walk me through it', answer: 'I was treasurer and I reconciled 400 payments with a script because the sheet was kept by hand, and I found duplicate entries. Rather than fix them one by one I changed the process.', seconds: 60, evidence: s1.evidence, anchors: s1.anchors }, naturalness)
    expect(m.marks.accuracy).toBeGreaterThan(0.5)
    expect(m.marks.depth).toBeGreaterThan(0.4)
  })
  it('coverage and length helpers', () => {
    expect(covers('we escalated it to the risk owner', 'Escalate to the risk owner')).toBe(true)
    expect(covers('nothing relevant here', 'Escalate to the risk owner')).toBe(false)
    expect(lengthMark(100, [90, 150])).toBe(1)
    expect(lengthMark(45, [90, 150])).toBe(0)
    expect(lengthMark(300, [90, 150])).toBe(0)
  })
})

describe("Claude's marks", () => {
  it('reads JSON marks on a 0–4 scale', () => {
    const m = parseMarks('Here you go: {"marks": {"structure": 3, "specifics": 2, "ownership": 4, "result": 4, "length": 2, "natural": 3}, "covered": ["treasurer"], "missed": ["12 duplicates"], "feedback": "Lead with the number."}', 'behavioural')!
    expect(m.marks.structure).toBe(0.75)
    expect(m.score).toBeCloseTo(0.75)
    expect(m.missed).toEqual(['12 duplicates'])
  })
  it('gives up on junk so code marks instead', () => {
    expect(parseMarks('no json', 'behavioural')).toBeNull()
    expect(parseMarks('{"marks": {}}', 'behavioural')).toBeNull()
    expect(parseMarks('{bad json', 'scenario')).toBeNull()
  })
  it('builds an attempt to save', () => {
    const m = parseMarks('{"marks": {"risks": 4, "mitigation": 2, "communication": 2}, "missed": [], "feedback": "ok"}', 'scenario')!
    const a = attemptOf({ item: 'scenario:X1', area: 'scenarios', drill: 'scenario', mark: { ...m, by: 'claude' }, seconds: 61.6, spoken: true, answer: 'x', at: 5 })
    expect(a).toMatchObject({ item: 'scenario:X1', score: 0.67, by: 'claude', seconds: 62, spoken: true })
    expect(a.missed).toBeUndefined()
  })
})

describe('human writing', () => {
  it('flags the usual tells', () => {
    const text = 'I spearheaded a pivotal project — it was not only fast but also robust, highlighting my ability to leverage data. In conclusion, it was a testament to the team.'
    const phrases = aiTells(text).map((t) => t.phrase.toLowerCase())
    for (const p of ['spearheaded', 'pivotal', 'robust', 'leverage', 'in conclusion', 'a testament to', 'highlighting']) expect(phrases.some((x) => x.includes(p))).toBe(true)
    expect(aiTells(text).some((t) => /Em dash/.test(t.why))).toBe(true)
    expect(aiTells(text).some((t) => /Not only/.test(t.why))).toBe(true)
  })
  it('leaves plain speech alone', () => {
    const plain = 'I was treasurer of the investing society. I wrote a script to check the payments, and found 12 duplicates. We refunded them.'
    expect(aiTells(plain)).toEqual([])
    expect(naturalness(plain)).toBe(1)
  })
  it('flags long sentences and reflexive triples', () => {
    const long = `${'word '.repeat(40)}end.`
    expect(aiTells(long).some((t) => /35 words/.test(t.why))).toBe(true)
    const triples = 'It was fast, cheap, and simple. The team was calm, kind, and sharp.'
    expect(aiTells(triples).filter((t) => /three/.test(t.why))).toHaveLength(2)
    expect(aiTells('We tested speed, cost and safety.')).toEqual([])
  })
  it('says not to invent and how to mark a gap', () => {
    expect(HUMAN_WRITING).toMatch(/PRACTICE VERSION/)
    expect(HUMAN_WRITING).toMatch(/Never invent/)
    expect(naturalness('delve delve delve delve delve delve delve delve delve')).toBe(0)
  })
})

describe('front matter YAML refuses', () => {
  const raw = `---
company: Contoso Bank
role: Analyst (final round)
date: 2026-11-25T09:00:00Z
timezone: Europe/London
course: risk-basics
sources:
  - /Users/someone/prep
links:
  - https://github.com/example/repo
  - "https://example.org/a: b"
rounds:
  - id: technical
    name: Technical interview
    kind: technical
    minutes: 30
    notes: Questions first, then a case. Required: a caption of at most 10 words.
  - id: pres
    name: Presentation
    kind: presentation
    notes: Topic: risk.
      Slides sent ahead.
tags: [a, b]
---

# Body
`
  it('YAML itself refuses it', () => {
    expect(() => matter(raw)).toThrow()
  })
  it('reads it line by line instead', () => {
    const l = lenientFrontMatter(raw)
    const t = parseTarget(l.data, l.body, 'Interview prep/Contoso', raw)
    expect(t.company).toBe('Contoso Bank')
    expect(t.date).toBe('2026-11-25T09:00:00Z')
    expect(t.timezone).toBe('Europe/London')
    expect(t.course).toBe('risk-basics')
    expect(t.sources).toEqual(['/Users/someone/prep'])
    expect(t.links).toEqual(['https://github.com/example/repo', 'https://example.org/a: b'])
    expect(t.rounds.map((r) => [r.id, r.kind, r.minutes])).toEqual([
      ['technical', 'technical', 30],
      ['pres', 'presentation', undefined]
    ])
    expect(t.rounds[0].notes).toMatch(/Required: a caption/)
    expect(t.rounds[1].notes).toBe('Topic: risk. Slides sent ahead.')
    expect(l.data.tags).toEqual(['a', 'b'])
    expect(l.body.trim()).toBe('# Body')
    expect(lenientFrontMatter('no front matter').data).toEqual({})
  })
})

describe('files as people really write them', () => {
  it('reads group headings, time limits and bold in questions.md', () => {
    const q = parseQuestions(`# Question bank

Intro text.

## Motivation (most important)

## mot-01. Tell me about **yourself**.
- Round: r1
- Kind: motivation
- Route: Who I am → Why this → Why here (under 90 seconds)
- Outline:
  - First point
    - a detail under it

## Behavioural

## beh-01. A time you disagreed.
- Kind: behavioural
- Route: Situation → Action → Result (2 minutes)
`)
    expect(q.map((x) => x.id)).toEqual(['mot-01', 'beh-01'])
    expect(q[0]).toMatchObject({ text: 'Tell me about yourself.', group: 'Motivation (most important)', limit: 90 })
    expect(q[0].route).toEqual(['Who I am', 'Why this', 'Why here'])
    expect(q[0].outline).toEqual(['First point', 'a detail under it'])
    expect(q[1]).toMatchObject({ group: 'Behavioural', limit: 120 })
    expect(targetWindowOf(90)).toEqual([50, 90])
  })
  it('groups rubric bullets by their labels', () => {
    const c = parseScenarios(`## S1. Case
### Part 1
Something happens.
### Rubric
- Credit risk: defaults rise
- Controls, 1st line: caps on volume
- KRIs: approval-rate gap
- Escalation (Part 3): tell the CRO
- Board in 3 points: (1) losses (2) caps (3) next steps
- Something with no label
`)
    expect(c[0].rubric.map((r) => r.group)).toEqual(['risk', 'mitigation', 'mitigation', 'escalation', 'board', 'general'])
    expect(c[0].rubric[0].text).toBe('Credit risk: defaults rise')
  })
  it('reads assessor questions with "Strong answer:" paragraphs, and the topic from the title', () => {
    const p = parsePresentation(`# Presentation: Supplier risk at a bank

15 minutes presenting.

## Brief checklist
- [ ] Key message in **10 words**

## Opportunities (assessors asked for risks and opportunities)
- **Speed.** Faster checks.

## Research pack
### 1. Credit risk
### 2. Market risk

## What the research says in one paragraph
Short.

## Assessor questions

Practise each in 90 seconds.

### 1. Why this topic?
Strong answer: a reason tied to you, and a risk reason.

### 2. **How** would you measure it?
- Point: incidents and time to detect.
`)
    expect(p.topic).toBe('Supplier risk at a bank')
    expect(p.research).toEqual(['Credit risk', 'Market risk'])
    expect(p.checklist.map((c) => c.text)).toEqual(['Key message in **10 words**'])
    expect(p.assessor.map((a) => [a.question, a.point])).toEqual([
      ['Why this topic?', 'a reason tied to you, and a risk reason.'],
      ['How would you measure it?', 'incidents and time to detect.']
    ])
  })
  it('skips the sources preamble in firm.md and plain-texts bold', () => {
    const f = parseFirm(`# Facts

- **AR 2025**: the annual report

## 1. Strategy
- **Purpose**: "to help". (10-K 2025, Managing Risk section)

## Sources
- [S1] https://example.org
`)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ section: 'Strategy', text: 'Purpose: "to help".', source: '10-K 2025, Managing Risk section' })
  })
  it('reads "The rule" in ask-them.md as rules', () => {
    const a = parseAskThem(`# Ask

## The rule

- **Never ask about something they covered.** Listen first.
- Ask one or two.

## Recruiter (end of the day)
- What happens next?
`)
    expect(a.rules).toEqual(['Never ask about something they covered. Listen first.', 'Ask one or two.'])
    expect(a.groups.map((g) => g.who)).toEqual(['Recruiter (end of the day)'])
  })
})

const targetWindowOf = (limit: number) => targetWindow({ drill: 'behavioural', limit })
