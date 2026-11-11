import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { roadmapTopics } from '../src/shared/curriculum'
import { knowledgeNote, lessonEvidence, needsOf, NOTE_WORDS, roadmapConcepts, type ConceptState, type Picture } from '../src/shared/knowledge'
import { digestLesson } from '../src/shared/lessonMemory'
import type { LessonRecord } from '../src/shared/lessonLog'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 11, 12)

const ROADMAP = `# Algorithms

## Data structures
- [x] Arrays
- [ ] Hash tables — _CLRS ch. 11_
- [ ] Bloom filters
- [ ] **Project: build a cache**
- [ ] Tries (needs: Arrays)

## Graphs
- [ ] Breadth-first search (needs: nothing)
- [ ] Shortest paths (needs: Breadth-first search, Hash tables, Nonsense)
`

describe('concepts from a roadmap', () => {
  const concepts = roadmapConcepts(roadmapTopics('Algorithms', ROADMAP))
  const by = (name: string) => concepts.find((c) => c.name === name)!

  it('each topic builds on the one before it in its section, unless its line says otherwise', () => {
    expect(concepts.map((c) => c.name)).toEqual(['Arrays', 'Hash tables', 'Bloom filters', 'Tries', 'Breadth-first search', 'Shortest paths'])
    expect(by('Arrays').prerequisites).toEqual([])
    expect(by('Hash tables').prerequisites).toEqual([by('Arrays').id])
    expect(by('Bloom filters').prerequisites).toEqual([by('Hash tables').id])
    // Said in the line: only Arrays, not the topic above it
    expect(by('Tries').prerequisites).toEqual([by('Arrays').id])
    expect(by('Breadth-first search').prerequisites).toEqual([])
    // Across sections, and a name the roadmap doesn't have is left out
    expect(by('Shortest paths').prerequisites).toEqual([by('Breadth-first search').id, by('Hash tables').id])
  })

  it('keeps the section, the order and the tick, and leaves projects out', () => {
    expect(by('Arrays').done).toBe(true)
    expect(by('Hash tables').done).toBeUndefined()
    expect(by('Shortest paths').section).toBe('Graphs')
    expect(concepts.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(concepts.every((c) => c.origin === 'roadmap' && c.area === 'Algorithms')).toBe(true)
    expect(roadmapConcepts(roadmapTopics('Algorithms', ROADMAP), true).every((c) => c.private)).toBe(true)
  })

  it('reads what a line says it needs', () => {
    expect(needsOf('Raft (needs: Consensus; Logical clocks)')).toEqual({ name: 'Raft', needs: ['Consensus', 'Logical clocks'] })
    expect(needsOf('Raft (after Consensus)')).toEqual({ name: 'Raft', needs: ['Consensus'] })
    expect(needsOf('Raft (needs: none)')).toEqual({ name: 'Raft', needs: [] })
    expect(needsOf('Raft (the consensus algorithm)')).toEqual({ name: 'Raft (the consensus algorithm)', needs: null })
  })
})

const lesson = (over: Partial<LessonRecord> = {}): LessonRecord => ({
  id: 'l1',
  mode: 'teach',
  topic: 'Hash tables',
  scope: { kind: 'folder', path: 'Algorithms' },
  started: NOW - 3_600_000,
  updated: NOW,
  turns: [
    { role: 'user', content: 'Teach me.' },
    { role: 'assistant', content: '<plan>\n1. Hash functions\n2. Collisions and chaining\n3. Load factor and resizing\n</plan>\nA hash function maps a key to a slot.\n\n<ask type="short">What does a hash function return for a key?</ask>' },
    { role: 'user', content: 'Answer: a slot index' },
    { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<ask type="short">Two keys land in one slot: how does chaining handle the collisions?</ask>' },
    { role: 'user', content: "Answer: I don't know" },
    { role: 'assistant', content: 'Each slot holds a list.\n\n<ask type="short">Two keys land in one slot: how does chaining handle the collisions?</ask>' },
    { role: 'user', content: 'Answer: each slot keeps a list of entries' },
    { role: 'assistant', content: '<grade verdict="correct" score="1">Right.</grade>\n\n<ask type="short">Why is the sky blue?</ask>' },
    { role: 'user', content: 'Answer: no' },
    { role: 'assistant', content: '<grade verdict="wrong" score="0">Not quite.</grade>\n\n<ask type="short">What is next?</ask>' }
  ],
  ...over
})

describe('evidence from a lesson record', () => {
  it('reads every question in order with how it went', () => {
    const d = digestLesson(lesson())!
    expect(d.asked.map((a) => a.mark)).toEqual(['correct', 'stuck', 'wrong', undefined])
    // What the digest already said is unchanged
    expect([d.right, d.partly, d.wrong, d.stuck.length]).toEqual([2, 0, 1, 1])
  })

  it('becomes taught and answers on the topic, and on the plan steps the questions are about', () => {
    const r = lesson()
    const { steps, events } = lessonEvidence(r, digestLesson(r)!, { id: 'c', area: 'Algorithms' })
    const on = (id: string) => events.filter((e) => e.concept === id).map((e) => `${e.pos}:${e.kind}`)
    expect(on('c')).toEqual(['taught:taught', 'q0:right', 'q1:stuck', 'q2:wrong'])
    expect(events.find((e) => e.pos === 'taught')).toMatchObject({ at: r.started, weight: 0.6, source: 'lesson:l1' })
    // Not finished: the steps reached are the first two; the third has shown nothing yet
    expect(steps.map((s) => s.name)).toEqual(['Hash functions', 'Collisions and chaining'])
    expect(steps.every((s) => s.parent === 'c' && s.origin === 'step' && s.area === 'Algorithms')).toBe(true)
    expect(on(steps[0].id)).toEqual(['s0.taught:taught', 's0.q0:right'])
    expect(on(steps[1].id)).toEqual(['s1.taught:taught', 's1.q1:stuck'])
    // Every piece has its own place in its source, so saving again replaces rather than adds
    expect(new Set(events.map((e) => `${e.source}#${e.pos}`)).size).toBe(events.length)

    const done = lesson({ finished: true })
    const all = lessonEvidence(done, digestLesson(done)!, { id: 'c', area: 'Algorithms' }, true)
    expect(all.steps.map((s) => s.name)).toEqual(['Hash functions', 'Collisions and chaining', 'Load factor and resizing'])
    expect(all.events.find((e) => e.pos === 'taught')!.weight).toBe(1)
    expect(all.events.every((e) => e.private) && all.steps.every((s) => s.private)).toBe(true)

    // A quiz teaches nothing: only its answers count
    const quiz = lesson({ mode: 'quiz' })
    expect(lessonEvidence(quiz, digestLesson(quiz)!, { id: 'c', area: '' }).events.some((e) => e.kind === 'taught')).toBe(false)
  })
})

const state = (name: string, over: Partial<ConceptState> = {}): ConceptState => ({
  id: name,
  name,
  area: 'Algorithms',
  origin: 'roadmap',
  order: 0,
  prerequisites: [],
  done: false,
  private: false,
  estimate: 0.8,
  level: 0.85,
  halfLife: 10,
  status: 'solid',
  lastSeen: NOW - 2 * DAY,
  lastRight: NOW - 2 * DAY,
  seen: 5,
  right: 4,
  partly: 0,
  wrong: 0,
  ...over
})

describe('the note a lesson opens with', () => {
  it('says what is solid, what to check first, and what it builds on that isn’t solid', () => {
    const p: Picture = {
      topic: state('Bloom filters', { status: 'learning', estimate: 0.3, right: 1, wrong: 2, seen: 4 }),
      solid: [state('Arrays'), state('Bit manipulation')],
      shaky: [state('Hash functions', { status: 'fading', estimate: 0.4, lastRight: NOW - 30 * DAY }), state('Modular arithmetic', { status: 'learning', estimate: 0.2, right: 0, seen: 1, lastRight: undefined })],
      prerequisites: [state('Hash tables', { status: 'learning', estimate: 0.35, right: 2, wrong: 3, seen: 6 }), state('Probability basics', { status: 'new', estimate: 0, seen: 0, right: 0, lastRight: undefined, lastSeen: undefined })]
    }
    const note = knowledgeNote(p, NOW)
    expect(note.split('\n')).toEqual([
      'From Tide’s record of this student’s answers and the time since (facts, not your memory):',
      'This topic itself: 1 of 3 right.',
      'Solid, don\'t re-teach: "Arrays"; "Bit manipulation".',
      'Shaky or fading, check first with one short question: "Hash functions" (fading, last right 4 weeks ago); "Modular arithmetic" (taught, never checked).',
      'Builds on these, not yet solid; teach or check them first: "Hash tables" (2 of 5 right); "Probability basics" (not studied here).'
    ])
  })

  it('is empty when there is nothing to say, and never long', () => {
    expect(knowledgeNote({ solid: [], shaky: [], prerequisites: [] }, NOW)).toBe('')
    // A topic nothing is known about is not mentioned
    expect(knowledgeNote({ topic: state('Tries', { status: 'new', seen: 0 }), solid: [], shaky: [], prerequisites: [] }, NOW)).toBe('')
    expect(knowledgeNote({ topic: state('Tries'), solid: [], shaky: [], prerequisites: [] }, NOW)).toContain('This topic itself: solid (4 right, last 2 days ago); go further, don\'t start again.')
    const long = (i: number) => `The ${i}th very long name of a topic that goes on and on about consensus in distributed systems`
    const many = (over: Partial<ConceptState>) => [1, 2, 3, 4, 5].map((i) => state(long(i), over))
    const note = knowledgeNote({ topic: state(long(0)), solid: many({}), shaky: many({ status: 'fading', lastRight: NOW - 90 * DAY }), prerequisites: many({ status: 'learning', right: 1, wrong: 4 }) }, NOW)
    expect(note.split(/\s+/).length).toBeLessThanOrEqual(NOTE_WORDS)
    expect(note).toContain('Solid, don\'t re-teach')
    expect(note).toContain('Shaky or fading')
    expect(note).toContain('Builds on these')
  })
})

// ---------- Through the app's own code, with the Rust module and a vault on disk ----------

const root = mkdtempSync(join(tmpdir(), 'tide-knowledge-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, '.tide', 'lessons'), { recursive: true })
mkdirSync(join(vault, 'Algorithms'), { recursive: true })
mkdirSync(join(vault, 'Bank'), { recursive: true })
writeFileSync(join(vault, 'Algorithms', 'Roadmap.md'), ROADMAP)
writeFileSync(join(vault, 'Algorithms', 'Arrays.md'), '# Arrays\n')
writeFileSync(join(vault, 'Bank', 'Roadmap.md'), '# Bank\n\n## Ledger\n- [ ] Ledger reconciliation\n- [ ] Settlement files\n')
writeFileSync(join(vault, 'Bank', 'Brief.md'), '# Brief\n')
writeFileSync(
  join(vault, '.tide', 'notebooks.json'),
  JSON.stringify({ Algorithms: { outline: 'Algorithms/Roadmap.md' }, Bank: { outline: 'Bank/Roadmap.md', project: { kind: 'understand', private: true, docs: [] } } })
)
// Kept before the knowledge map existed: one lesson, and marked answers (the lesson's own, and one from a recall session)
const OLD = Date.now() - 20 * DAY
const old = lesson({ id: 'old', topic: 'Arrays', started: OLD, updated: OLD + 600_000, finished: true })
writeFileSync(join(vault, '.tide', 'lessons', 'old.json'), JSON.stringify(old))
writeFileSync(
  join(vault, '.tide', 'attempts.jsonl'),
  [
    { at: OLD + 60_000, topic: 'Arrays', mode: 'teach', verdict: 'correct', score: 1 },
    { at: OLD + 120_000, topic: 'Arrays', mode: 'teach', verdict: 'wrong', score: 0 },
    { at: OLD + 8 * DAY, topic: 'Arrays', mode: 'recall', verdict: 'correct', score: 1, path: 'Algorithms/Arrays.md' },
    { at: OLD - 30 * DAY, topic: 'Sorting by hand', mode: 'quiz', verdict: 'partial', score: 0.5 }
  ]
    .map((a) => JSON.stringify(a))
    .join('\n') + '\n'
)
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { saveLesson, earlierLessons } = await import('../src/main/lessons')
const { knowledgeView, conceptState } = await import('../src/main/knowledge')
const { recordAttempt } = await import('../src/main/learn')

interface Kept {
  id: string
  name: string
  origin: string
  parent?: string
  private?: boolean
  prerequisites: string[]
  evidence: { source: string; pos: string; kind: string; private?: boolean; supersedes?: string }[]
}
const FILE = join(vault, '.tide', 'knowledge.json')
const kept = () => (JSON.parse(readFileSync(FILE, 'utf8')) as { version: number; concepts: Kept[] }).concepts
const keptNamed = (name: string) => kept().find((c) => c.name === name && !c.parent)!

describe('the knowledge map, through lessons, recall and answers', () => {
  it('reads in what was recorded before it existed, once', async () => {
    expect(existsSync(FILE)).toBe(false)
    const view = await knowledgeView()
    expect(existsSync(FILE)).toBe(true)
    expect(view.areas.map((a) => a.name).sort()).toEqual(['Algorithms', 'Bank'])
    // Both roadmaps, in order, with the private one marked
    const top = view.concepts.filter((c) => !c.parent)
    expect(top.filter((c) => c.area === 'Algorithms' && c.origin === 'roadmap').map((c) => c.name)).toEqual(['Arrays', 'Hash tables', 'Bloom filters', 'Tries', 'Breadth-first search', 'Shortest paths'])
    expect(top.filter((c) => c.area === 'Bank').every((c) => c.private)).toBe(true)

    // The old lesson counts on its roadmap topic; its own answers in the attempts log are not counted again;
    // the recall a week later is, as a recall
    const arrays = keptNamed('Arrays')
    expect(arrays.origin).toBe('roadmap')
    expect(arrays.evidence.map((e) => `${e.source.replace(/\d{6,}/, 'T')}#${e.pos}:${e.kind}`)).toEqual(['lesson:old#taught:taught', 'lesson:old#q0:right', 'lesson:old#q1:stuck', 'lesson:old#q2:wrong', 'attempt:T#0:recalled-right'])
    const state = view.concepts.find((c) => c.id === arrays.id)!
    expect([state.seen, state.right, state.wrong]).toEqual([5, 2, 2])
    expect(state.done).toBe(true)
    // A finished lesson's plan steps are parts of the topic
    expect(view.concepts.filter((c) => c.parent === arrays.id).map((c) => c.name)).toEqual(['Hash functions', 'Collisions and chaining', 'Load factor and resizing'])
    // A quiz answer older than any lesson record: a topic of its own, on no roadmap
    expect(keptNamed('Sorting by hand')).toMatchObject({ origin: 'lesson', evidence: [{ kind: 'partly' }] })
    // That recall, a week after the lesson, is the one question that came back
    expect(view.weeks).toHaveLength(12)
    expect(view.weeks.reduce((n, w) => n + w.asked, 0)).toBe(1)
    expect(view.weeks.reduce((n, w) => n + w.right, 0)).toBe(1)
    // Arrays is ticked but an answer went wrong, so what builds on it waits: only chains with nothing before them are ready
    const names = (ids: string[]) => ids.map((id) => view.concepts.find((c) => c.id === id)!.name)
    expect(names(view.ready).filter((n) => ['Hash tables', 'Tries'].includes(n))).toEqual([])
    expect(names(view.ready)).toContain('Breadth-first search')
  })

  it('counts a lesson once however often it is saved, and tells the next lesson’s tutor', async () => {
    const r = lesson({ id: 'hash-1' })
    const input = { id: r.id, mode: r.mode, topic: r.topic, scope: r.scope, turns: r.turns }
    await saveLesson(input)
    const first = keptNamed('Hash tables').evidence.length
    await saveLesson(input)
    await saveLesson({ ...input, turns: [...input.turns] })
    const hash = keptNamed('Hash tables')
    expect(hash.origin).toBe('roadmap')
    expect(hash.evidence.length).toBe(first)
    expect(hash.evidence.map((e) => `${e.pos}:${e.kind}`)).toEqual(['taught:taught', 'q0:right', 'q1:stuck', 'q2:wrong'])
    expect(kept().filter((c) => c.parent === hash.id).map((c) => c.name)).toEqual(['Hash functions', 'Collisions and chaining'])
    expect((await conceptState('hash tables'))!.status).toBe('learning')

    // Bloom filters comes after Hash tables on the roadmap: the tutor is told it rests on shaky ground
    const note = await earlierLessons('Bloom filters', false)
    expect(note).toContain('From Tide’s record of this student’s answers')
    expect(note).toMatch(/Builds on these, not yet solid; teach or check them first: "Hash tables" \(1 of 3 right\)/)
    // A lesson on Hash tables itself hears about the topic and its parts
    const same = await earlierLessons('Hash tables', false, 'hash-1')
    expect(same).toContain('This topic itself: 1 of 3 right.')
    expect(same).toMatch(/Shaky or fading, check first with one short question: .*"Collisions and chaining"/)
    // Nothing known nearby: nothing said
    expect(await earlierLessons('Photosynthesis', false)).toBe('')
  })

  it('counts the recall question a lesson opens with as a recall, not twice', async () => {
    // The lesson above left "how does chaining handle the collisions?" for recall; this one opens with it
    const opening = await earlierLessons('Hash tables', false)
    expect(opening).toContain('Due for recall today')
    await saveLesson({
      id: 'hash-2',
      mode: 'teach',
      topic: 'Hash tables',
      scope: { kind: 'folder', path: 'Algorithms' },
      turns: [
        { role: 'user', content: 'Teach me.' },
        { role: 'assistant', content: '<ask type="short">Two keys land in one slot: how does chaining handle the collisions?</ask>' },
        { role: 'user', content: 'Answer: a list per slot' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<ask type="short">What is the load factor?</ask>' },
        { role: 'user', content: 'Answer: entries divided by slots' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }
      ]
    })
    const again = () => keptNamed('Hash tables').evidence.filter((e) => e.source === 'lesson:hash-2' || e.source.startsWith('recall:'))
    expect(again().map((e) => `${e.source.replace(/recall:.*/, 'recall')}#${e.pos}:${e.kind}`).sort()).toEqual(['lesson:hash-2#q1:right', 'lesson:hash-2#taught:taught', 'recall#1:recalled-right'])
    expect(again().find((e) => e.kind === 'recalled-right')!.supersedes).toBe('lesson:hash-2#q0')
    // Saved again later (the recall is no longer waiting): still once
    await saveLesson({ id: 'hash-2', mode: 'teach', topic: 'Hash tables', scope: { kind: 'folder', path: 'Algorithms' }, turns: (JSON.parse(readFileSync(join(vault, '.tide', 'lessons', 'hash-2.json'), 'utf8')) as LessonRecord).turns })
    expect(again()).toHaveLength(3)
  })

  it('takes answers from sessions that keep no lesson record, and leaves lessons’ answers to their records', async () => {
    const before = keptNamed('Hash tables').evidence.length
    await recordAttempt({ topic: 'Hash tables', mode: 'teach', verdict: 'correct', score: 1 })
    expect(keptNamed('Hash tables').evidence.length).toBe(before)
    await recordAttempt({ topic: 'Hash tables', mode: 'recall', verdict: 'wrong', score: 0, path: 'Algorithms/Arrays.md' })
    expect(keptNamed('Hash tables').evidence.filter((e) => /^attempt:\d+$/.test(e.source)).map((e) => e.kind)).toEqual(['recalled-wrong'])
  })

  it('gives the page its timeline: made solid, what came back, the questions missed, and each aim’s forecast', async () => {
    writeFileSync(join(vault, '.tide', 'goals.json'), JSON.stringify([{ id: 'g1', name: 'Algorithms by spring', notebook: 'Algorithms', deadline: '2027-03-01', createdAt: Date.now() }]))
    const view = await knowledgeView()
    const t = view.timeline!
    expect(t.weeks.length).toBeGreaterThanOrEqual(26 + 8)
    expect(t.weeks[t.now].start).toBeLessThanOrEqual(view.at)
    expect(t.weeks[t.now].end).toBeGreaterThan(view.at)
    // The same questions that came back, whichever view counts them
    expect(t.weeks.reduce((n, w) => n + w.asked, 0)).toBe(view.weeks.reduce((n, w) => n + w.asked, 0))
    // Every topic made solid is in the week it happened, once
    const made = view.concepts.filter((c) => !c.parent && c.madeSolid && c.madeSolid >= t.weeks[0].start)
    expect(t.weeks.flatMap((w) => w.solid).sort()).toEqual(made.map((c) => c.id).sort())
    // A solid topic has a fade date ahead of now
    for (const c of view.concepts.filter((c) => c.status === 'solid')) expect(c.fadesAt!).toBeGreaterThan(view.at)
    // What was missed in the Hash tables lessons is on Hash tables
    const hash = view.concepts.find((c) => c.name === 'Hash tables' && !c.parent)!
    expect(view.missed![hash.id].length).toBeGreaterThan(0)
    expect(view.missed![hash.id].some((q) => /chaining|load factor|resiz/i.test(q.prompt))).toBe(true)
    // The aim covers the roadmap’s six topics; its history is under three weeks, so it isn’t forecast
    const aim = t.aims[0]
    expect([aim.area, aim.total, aim.state]).toEqual(['Algorithms', 6, 'early'])
    expect(aim.projection).toEqual([])
    expect(aim.say).toMatch(/^Too early to forecast Algorithms/)
  })

  it('keeps private work for a reader on this Mac only', async () => {
    const r = lesson({ id: 'bank-1', topic: 'Ledger reconciliation', scope: { kind: 'folder', path: 'Bank' } })
    await saveLesson({ id: r.id, mode: r.mode, topic: r.topic, scope: r.scope, turns: r.turns })
    const ledger = keptNamed('Ledger reconciliation')
    expect(ledger.private).toBe(true)
    expect(ledger.evidence.every((e) => e.private)).toBe(true)
    // The page is read here, so it is in it
    const view = await knowledgeView()
    expect(view.concepts.find((c) => c.id === ledger.id)!.seen).toBe(4)
    // The next topic on that roadmap builds on it: said to a private lesson's tutor, never to one that may leave the Mac
    expect(await earlierLessons('Settlement files', true)).toContain('"Ledger reconciliation"')
    expect(await earlierLessons('Settlement files', false)).not.toContain('Ledger')
    expect(await earlierLessons('Ledger reconciliation', false)).not.toContain('This topic itself')
    // Private evidence on an open topic is left out of an open lesson's note as well
    const quiet = lesson({ id: 'bank-2', topic: 'Tries', scope: { kind: 'folder', path: 'Bank' }, finished: true })
    await saveLesson({ id: quiet.id, mode: quiet.mode, topic: quiet.topic, scope: quiet.scope, turns: quiet.turns, finished: true })
    expect(keptNamed('Tries').private).toBeUndefined()
    expect(await earlierLessons('Tries', true, 'bank-2')).toContain('This topic itself')
    expect(await earlierLessons('Tries', false, 'bank-2')).not.toContain('This topic itself')
  })
})
