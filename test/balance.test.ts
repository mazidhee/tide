import { describe, expect, it } from 'vitest'
import { balanceWeek, type BalanceInput, type BalanceNotebook } from '../src/shared/balance'
import { roadmapTopics, sectionsOf, isSorted, type SortedRoadmap } from '../src/shared/curriculum'
import { aimsKey, type Aim } from '../src/shared/coach'
import { scheduleWeek } from '../src/shared/schedule'

const MATHS = `## Part I — Numbers

### Chapter 1: Numbers

- [ ] Why humans started counting
- [ ] The invention of zero
- [ ] Prime numbers
- [ ] Modular arithmetic

### Chapter 2: Calculus

- [ ] Limits
- [ ] Derivatives

### Chapter 3: Number Theory

- [ ] Fermat's little theorem
- [ ] Elliptic curves over finite fields
`

const SWE = `## 1. Foundations — CORE

- [ ] How a CPU runs a program
- [ ] Binary and hex

## 9. Networking — CORE

- [ ] TCP
- [ ] Gossip protocols

## 12. Distributed Systems — CORE

- [ ] Raft leader election
- [ ] Byzantine fault tolerance

## 21. Blockchain Infrastructure — OPTIONAL SPECIALIZATION

- [ ] Proof of History
- [ ] Validator clients

## 22. Compilers — LATER

- [ ] Parsing
`

const FINANCE = `## Fixed Income

- [ ] Bond pricing
- [ ] Duration
`

const aims: Aim[] = [
  { id: 'chain', text: 'Distributed systems and blockchain infrastructure', weight: 'main', since: 0 },
  { id: 'phil', text: 'Philosophy', weight: 'curious', since: 0 }
]
const key = aimsKey(aims)

function notebook(name: string, md: string, sort?: (sections: ReturnType<typeof sectionsOf>) => SortedRoadmap['sections'], enrichment: string[] = []): BalanceNotebook {
  const topics = roadmapTopics(name, md)
  const sections = sectionsOf(topics)
  const sorted: SortedRoadmap | null = sort ? { version: 1, notebook: name, aimsKey: key, model: 'test', at: 0, sections: sort(sections), enrichment: topics.filter((t) => enrichment.includes(t.title)).map((t) => t.id), looked: topics.map((t) => t.id) } : null
  return { name, topics, sorted, ready: isSorted(sorted, sections, key) }
}

const bySection = (map: Record<string, SortedRoadmap['sections'][string]>) => (sections: ReturnType<typeof sectionsOf>) => Object.fromEntries(sections.map((s) => [s.id, map[s.path[s.path.length - 1]] ?? { serves: {} }]))

const maths = () =>
  notebook(
    'Mathematics',
    MATHS,
    bySection({
      'Chapter 1: Numbers': { class: 'supporting', serves: { chain: 0.6 } },
      'Chapter 2: Calculus': { class: 'skip', serves: {} },
      'Chapter 3: Number Theory': { class: 'core', serves: { chain: 1 } }
    }),
    ['Why humans started counting', 'The invention of zero']
  )
const swe = () =>
  notebook(
    'Software Engineering',
    SWE,
    bySection({
      '1. Foundations': { serves: {} },
      '9. Networking': { serves: { chain: 0.6 } },
      '12. Distributed Systems': { serves: { chain: 1 } },
      '21. Blockchain Infrastructure': { serves: { chain: 1 } },
      '22. Compilers': { serves: {} }
    })
  )
const finance = () => notebook('Finance', FINANCE, bySection({ 'Fixed Income': { class: 'elective', serves: {} } }))

const base = (over: Partial<BalanceInput> = {}): BalanceInput => ({ aims, notebooks: [maths(), swe(), finance()], overrides: {}, goals: [], hoursPerWeek: 12, pick: 'tide', pinned: [], recent: {}, ...over })

const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const week = (b: ReturnType<typeof balanceWeek>, hours = 12) =>
  scheduleWeek({ weekStart: days[0], days, hoursPerWeek: hours, focus: b.focus, candidates: b.candidates, shares: b.shares, primers: b.primers, checks: b.checks, weekend: days.map((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 6), goals: [], weak: [], dueCards: 0, mistakes: { count: 0, topics: [] }, undone: [] })

describe('balanceWeek', () => {
  it('gives weekdays to the roadmaps your aims need, two at most', () => {
    const b = balanceWeek(base())
    expect(b.focus).toEqual(['Software Engineering', 'Mathematics'])
    expect(b.focus).not.toContain('Finance')
    expect(b.shares.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1)
  })

  it('never puts history on a weekday: the invention of zero is a weekend primer', () => {
    const b = balanceWeek(base())
    expect(b.candidates.map((c) => c.topic)).not.toContain('The invention of zero')
    expect(b.primers.map((p) => p.topic)).toContain('The invention of zero')
    const plan = week(b)
    for (const d of plan.days) {
      const saturday = new Date(d.date + 'T12:00:00Z').getUTCDay() === 6
      if (!saturday) expect(d.items.map((i) => i.topic)).not.toContain('The invention of zero')
    }
  })

  it('skips what no aim needs, and your own LATER sections', () => {
    const topics = balanceWeek(base()).candidates.map((c) => c.topic)
    expect(topics).not.toContain('Limits')
    expect(topics).not.toContain('Parsing')
    expect(topics).toContain('Prime numbers')
  })

  it('promotes an optional section a main aim is about, and keeps Proof of History as core', () => {
    const topics = balanceWeek(base()).candidates.map((c) => c.topic)
    expect(topics).toContain('Proof of History')
    expect(topics).toContain('Validator clients')
  })

  it('keeps roadmap order within a roadmap: foundations before what builds on them', () => {
    const swe = balanceWeek(base()).candidates.filter((c) => c.notebook === 'Software Engineering').map((c) => c.topic)
    expect(swe.indexOf('How a CPU runs a program')).toBeLessThan(swe.indexOf('Raft leader election'))
    expect(swe.indexOf('TCP')).toBeLessThan(swe.indexOf('Raft leader election'))
  })

  it('says why, from the aim a topic serves', () => {
    const raft = balanceWeek(base()).candidates.find((c) => c.topic === 'Raft leader election')
    expect(raft?.why).toBe('12. Distributed Systems, for distributed systems and blockchain infrastructure')
  })

  it('lets your choices win over Tide’s', () => {
    const zero = maths().topics.find((t) => t.title === 'The invention of zero')!
    const calculus = maths().topics.find((t) => t.title === 'Limits')!
    const b = balanceWeek(base({ overrides: { [zero.id]: 'core', [calculus.sectionId]: 'core' } }))
    const topics = b.candidates.map((c) => c.topic)
    expect(topics).toContain('The invention of zero')
    expect(topics).toContain('Limits')
  })

  it('plans an unsorted roadmap in roadmap order, without your LATER sections, and says so', () => {
    const raw = notebook('Software Engineering', SWE)
    const b = balanceWeek(base({ notebooks: [raw] }))
    expect(b.unsorted).toEqual(['Software Engineering'])
    const topics = b.candidates.map((c) => c.topic)
    expect(topics[0]).toBe('How a CPU runs a program')
    expect(topics).not.toContain('Parsing')
    expect(topics).not.toContain('Proof of History')
  })

  it('reorders nothing when the roadmap is shuffled: the same topics are needed', () => {
    const shuffled = SWE.split(/\n(?=## )/).reverse().join('\n')
    const a = new Set(balanceWeek(base()).candidates.map((c) => c.topicId))
    const nb = notebook('Software Engineering', shuffled, () => swe().sorted!.sections)
    const b = new Set(balanceWeek(base({ notebooks: [maths(), nb, finance()] })).candidates.map((c) => c.topicId))
    expect(b).toEqual(a)
  })

  it('uses your pinned roadmaps when you pick, and shows what Tide would pick', () => {
    const b = balanceWeek(base({ pick: 'me', pinned: ['Finance'] }))
    expect(b.focus).toEqual(['Finance'])
    expect(b.suggested?.map((s) => s.notebook)).toEqual(['Software Engineering', 'Mathematics'])
  })

  it('gives a deadline its time even when the aims rank it lower', () => {
    const b = balanceWeek(base({ pick: 'tide', goals: [{ notebook: 'Mathematics', left: 30, daysLeft: 14, name: 'Finish number theory' }] }))
    expect(b.focus[0]).toBe('Mathematics')
    expect(b.shares[0].reason).toMatch(/30 topics left/)
  })
})

describe('the week from a balance', () => {
  it('keeps weekends to one subject, puts the take-home there, and caps primers', () => {
    const plan = week(balanceWeek(base()))
    const saturday = plan.days.find((d) => new Date(d.date + 'T12:00:00Z').getUTCDay() === 6)!
    const subjects = new Set(saturday.items.filter((i) => i.kind === 'learn' && !/primer/i.test(i.why ?? '')).map((i) => i.notebook))
    expect(subjects.size).toBeLessThanOrEqual(1)
    expect(saturday.items.some((i) => i.kind === 'take-home')).toBe(true)
    const primerMinutes = plan.days.flatMap((d) => d.items).filter((i) => /primer/i.test(i.why ?? '')).reduce((n, i) => n + i.minutes, 0)
    expect(primerMinutes / (12 * 60)).toBeLessThanOrEqual(0.15)
    for (const d of plan.days) expect(new Set(d.items.filter((i) => i.kind === 'learn' && !/primer/i.test(i.why ?? '')).map((i) => i.notebook)).size).toBeLessThanOrEqual(2)
  })

  it('has no primers and no error without a weekend day', () => {
    const b = balanceWeek(base())
    const weekdays = days.slice(0, 5)
    const plan = scheduleWeek({ weekStart: weekdays[0], days: weekdays, hoursPerWeek: 10, focus: b.focus, candidates: b.candidates, shares: b.shares, primers: b.primers, weekend: weekdays.map(() => false), goals: [], weak: [], dueCards: 0, mistakes: { count: 0, topics: [] }, undone: [] })
    expect(plan.days.flatMap((d) => d.items).some((i) => /primer/i.test(i.why ?? ''))).toBe(false)
  })

  it('carries topic ids into the week, so finishing ticks the roadmap', () => {
    const plan = week(balanceWeek(base()))
    const learn = plan.days.flatMap((d) => d.items).filter((i) => i.kind === 'learn')
    expect(learn.length).toBeGreaterThan(0)
    expect(learn.every((i) => i.topicId)).toBe(true)
  })
})

describe('classes from aims', () => {
  const nb = (map: Record<string, SortedRoadmap['sections'][string]>, md = MATHS) => notebook('Mathematics', md, bySection(map))
  const classes = (n: BalanceNotebook) => balanceWeek(base({ notebooks: [n] })).candidates.map((c) => c.topic)

  it('keeps a section a main aim needs even when the model skipped it', () => {
    const topics = classes(nb({ 'Chapter 1: Numbers': { class: 'skip', serves: { chain: 0.6 } }, 'Chapter 2: Calculus': { class: 'skip', serves: {} }, 'Chapter 3: Number Theory': { class: 'core', serves: { chain: 1 } } }))
    expect(topics).toContain('Prime numbers')
    expect(topics).not.toContain('Limits')
  })

  it('sends what only a curious aim needs to the weekend', () => {
    const b = balanceWeek(base({ notebooks: [nb({ 'Chapter 1: Numbers': { class: 'core', serves: { phil: 1 } }, 'Chapter 2: Calculus': { class: 'skip', serves: {} }, 'Chapter 3: Number Theory': { class: 'core', serves: { chain: 1 } } })] }))
    expect(b.candidates.map((c) => c.topic)).not.toContain('Prime numbers')
    expect(b.primers.map((p) => p.topic)).toContain('Prime numbers')
  })

  it('brings forward a LATER section your main aim needs, as supporting', () => {
    const md = `## 23. Cryptography — LATER / OPTIONAL SPECIALIZATION\n\n- [ ] Elliptic curve signatures\n`
    const n = notebook('Software Engineering', md, bySection({ '23. Cryptography': { serves: { chain: 0.6 } } }))
    expect(balanceWeek(base({ notebooks: [n] })).candidates.map((c) => c.topic)).toEqual(['Elliptic curve signatures'])
  })
})

describe('main aims', () => {
  it('gives each main aim’s roadmap weekday time, even behind foundations', () => {
    const aims2: Aim[] = [...aims, { id: 'pay', text: 'Payments', weight: 'main', since: 0 }]
    const fin = notebook('Finance', FINANCE, bySection({ 'Fixed Income': { class: 'core', serves: { pay: 1 } } }))
    // Maths has had more study lately; Software Engineering starts with foundations no aim names
    const b = balanceWeek({ ...base(), aims: aims2, notebooks: [maths(), swe(), fin], recent: { Mathematics: 300 } })
    expect(b.focus).toContain('Software Engineering')
    expect(b.focus).toContain('Finance')
  })
})

describe('placement in the week', () => {
  it('checks a section before its first lesson, once', () => {
    const md = `## Number Theory\n\n- [ ] Primes\n- [ ] Divisibility\n- [ ] Modular arithmetic\n- [ ] Fermat's little theorem\n`
    const nt = notebook('Mathematics', md, bySection({ 'Number Theory': { class: 'core', serves: { chain: 1 } } }))
    const base2 = (over: Partial<BalanceInput> = {}) => base({ notebooks: [nt, swe()], ...over })
    const b = balanceWeek(base2())
    const check = b.checks.find((c) => c.section === 'Number Theory')
    expect(check?.topics.map((t) => t.title)).toEqual(['Primes', 'Divisibility', 'Modular arithmetic', "Fermat's little theorem"])
    const plan = week(b)
    const items = plan.days.flatMap((d) => d.items)
    const first = b.checks[0]
    const at = items.findIndex((i) => i.kind === 'check' && i.title === first.section)
    const lesson = items.findIndex((i) => i.kind === 'learn' && first.topics.some((t) => t.id === i.topicId))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(lesson)
    const again = balanceWeek(base2({ placement: { topics: {}, sections: Object.fromEntries(b.checks.map((c) => [c.sectionId, 1])) } }))
    expect(again.checks.map((c) => c.sectionId)).not.toContain(first.sectionId)
  })

  it('drops what you know and makes what is rusty a short refresher', () => {
    const swe = balanceWeek(base()).candidates.filter((c) => c.notebook === 'Software Engineering')
    const [known, shaky] = [swe[0], swe[1]]
    const b = balanceWeek(base({ placement: { topics: { [known.topicId!]: { state: 'known', at: 1 }, [shaky.topicId!]: { state: 'shaky', at: 1 } }, sections: {} } }))
    expect(b.candidates.map((c) => c.topicId)).not.toContain(known.topicId)
    expect(b.candidates.find((c) => c.topicId === shaky.topicId)?.refresh).toBe(true)
    const item = week(b).days.flatMap((d) => d.items).find((i) => i.topicId === shaky.topicId)
    expect(item?.refresh).toBe(true)
    expect(item?.minutes).toBeLessThanOrEqual(25)
  })
})
