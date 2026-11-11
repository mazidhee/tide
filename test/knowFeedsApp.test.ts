/**
 * Quizzes, flashcards and reviews feeding the knowledge map, through the app's own code, with the
 * Rust module and a vault on disk: each on the right topic, and each event counted once.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { roadmapTopics } from '../src/shared/curriculum'
import { roadmapConcepts } from '../src/shared/knowledge'
import type { LessonRecord } from '../src/shared/lessonLog'

const DAY = 86_400_000
const root = mkdtempSync(join(tmpdir(), 'tide-knowfeeds-'))
const vault = join(root, 'vault')
const tide = join(vault, '.tide')
mkdirSync(join(tide, 'lessons'), { recursive: true })
mkdirSync(join(vault, 'Algorithms'), { recursive: true })

const ROADMAP = '# Algorithms\n\n## Data structures — CORE\n- [ ] Hash tables\n- [ ] Tries\n'
writeFileSync(join(vault, 'Algorithms', 'Roadmap.md'), ROADMAP)
writeFileSync(join(tide, 'notebooks.json'), JSON.stringify({ Algorithms: { outline: 'Algorithms/Roadmap.md' } }))
const CARDS = '#flashcards\n\nCards for [[Hash tables]]\n\n## Load factor\n\nWhat is the load factor of a hash table?::entries over slots\n'
writeFileSync(join(vault, 'Algorithms', 'Hash tables (Flashcards).md'), CARDS)
// A deck on nothing the map has
const GARDEN = '#flashcards\n\n## Pruning\n\nWhen are roses pruned?::late winter\n'
writeFileSync(join(vault, 'Garden.md'), GARDEN)

const [hash, tries] = roadmapConcepts(roadmapTopics('Algorithms', ROADMAP))
const T = Date.now()

// A map kept by the earlier model: a lesson on Hash tables ten days ago, nothing read in from flashcards or exams
const V1 = JSON.stringify({
  version: 1,
  concepts: [
    { ...hash, evidence: [{ source: 'lesson:old', pos: 'taught', kind: 'taught', at: T - 10 * DAY, weight: 1 }, { source: 'lesson:old', pos: 'q0', kind: 'right', at: T - 10 * DAY + 60_000, weight: 1 }] },
    { ...tries, evidence: [] }
  ]
})
writeFileSync(join(tide, 'knowledge.json'), V1)
// Since then: a flashcard reviewed twice, and an exam answer on Tries (an exam keeps no lesson record)
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { parseFlashcards, reviewCard, scheduleAfter } = await import('../src/main/study')
const { saveLesson } = await import('../src/main/lessons')
const { knowledgeView } = await import('../src/main/knowledge')
const { recordAttempt } = await import('../src/main/learn')
const { recallItems } = await import('../src/main/recall')
const { addMistakes, listMistakes } = await import('../src/main/mistakes')
const { answerReview, keptOn, reviewFor } = await import('../src/main/review')

const [loadCard] = parseFlashcards('Algorithms/Hash tables (Flashcards).md', CARDS, { highlightClozes: true })
const [roseCard] = parseFlashcards('Garden.md', GARDEN, { highlightClozes: true })
writeFileSync(
  join(tide, 'reviews.jsonl'),
  [
    { at: T - 8 * DAY, id: loadCard.id, path: loadCard.path, grade: 'good', interval: 3 },
    { at: T - 4 * DAY, id: loadCard.id, path: loadCard.path, grade: 'again', interval: 0 },
    { at: T - 4 * DAY, id: roseCard.id, path: roseCard.path, grade: 'good', interval: 3 }
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n'
)
// And the schedule those two reviews left the card with
const once = scheduleAfter(undefined, 'good', new Date(T - 8 * DAY)).stored
writeFileSync(join(tide, 'srs.json'), JSON.stringify({ [loadCard.id]: scheduleAfter(once, 'again', new Date(T - 4 * DAY)).stored }))
writeFileSync(join(tide, 'attempts.jsonl'), JSON.stringify({ at: T - 3 * DAY, topic: 'Tries — CORE', mode: 'quiz', verdict: 'correct', score: 1, question: 'What does a trie node hold?' }) + '\n')

interface Kept {
  id: string
  name: string
  parent?: string
  evidence: { source: string; pos: string; kind: string; weight: number; at: number }[]
}
const file = () => JSON.parse(readFileSync(join(tide, 'knowledge.json'), 'utf8')) as { version: number; model: string; filled?: string[]; concepts: Kept[] }
const on = (id: string) => file().concepts.find((c) => c.id === id)!.evidence
const sources = (id: string, prefix: string) => on(id).filter((e) => e.source.startsWith(prefix))
const asked = async () => (await knowledgeView()).weeks.reduce((n, w) => n + w.asked, 0)

const quiz = (over: Partial<LessonRecord> & Pick<LessonRecord, 'id' | 'topic' | 'turns'>) => saveLesson({ mode: 'quiz', scope: { kind: 'folder', path: 'Algorithms' }, ...over })

describe('a map from the earlier model', () => {
  it('is replayed through FSRS, kept as it was beside it, and reads in flashcards and exam answers once', async () => {
    const view = await knowledgeView()
    const f = file()
    expect([f.version, f.model]).toEqual([2, 'fsrs-6'])
    expect(readFileSync(join(tide, 'knowledge.v1.json'), 'utf8')).toBe(V1)
    expect(f.filled).toEqual(expect.arrayContaining(['flashcards', 'attempts-without-a-record']))
    // The lesson's evidence is all still there
    expect(sources(hash.id, 'lesson:old').map((e) => e.kind)).toEqual(['taught', 'right'])
    // The load-factor card is on Hash tables (by the note it was made from: its heading is no topic): first shown, then a recall; half weight
    expect(sources(hash.id, 'card:').map((e) => [e.kind, e.weight])).toEqual([
      ['right', 0.5],
      ['recalled-wrong', 0.5]
    ])
    // The roses card is on no topic, and makes none
    expect(file().concepts.some((c) => /garden|pruning|roses/i.test(c.name))).toBe(false)
    expect(file().concepts.flatMap((c) => c.evidence).filter((e) => e.source === `card:${roseCard.id}`)).toEqual([])
    // The exam answer, under its tagged heading, is on the roadmap's Tries
    expect(sources(tries.id, 'attempt:').map((e) => e.kind)).toEqual(['right'])
    const h = view.concepts.find((c) => c.id === hash.id)!
    expect(h.status).toBe('learning')
    expect(h.stability).toBeGreaterThan(0)

    // Opened again: nothing read twice
    const before = JSON.stringify(file().concepts)
    await knowledgeView()
    expect(JSON.stringify(file().concepts)).toBe(before)
  })
})

describe('flashcards', () => {
  it('count on their topic as they are reviewed, and once in what came back', async () => {
    const before = await asked()
    await reviewCard(loadCard.id, 'good', loadCard.path)
    const cards = sources(hash.id, 'card:')
    expect(cards).toHaveLength(3)
    // It has been shown before, in the review log: a recall
    expect(cards[2].kind).toBe('recalled-right')
    // Its line in the review log has the same time, so reading the log in again would change nothing
    const logged = readFileSync(join(tide, 'reviews.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(logged[logged.length - 1].at).toBe(cards[2].at)
    // Counted once in the questions that came back: from the review log, not the map as well
    expect(await asked()).toBe(before + 1)
    // A card on no topic is reviewed as ever and adds nothing
    await reviewCard(roseCard.id, 'good', roseCard.path)
    expect(file().concepts.flatMap((c) => c.evidence).some((e) => e.source === `card:${roseCard.id}`)).toBe(false)
  })
})

describe('quizzes', () => {
  it('put each answer on the syllabus topic it is about, and an answer with a record is counted from the record only', async () => {
    await quiz({
      id: 'studied',
      topic: 'What I studied today: Hash tables; Tries — CORE',
      turns: [
        { role: 'user', content: 'Quiz me.' },
        { role: 'assistant', content: '<ask type="short" topic="Tries">What does each node of a trie hold?</ask>' },
        { role: 'user', content: 'Answer: its children by letter' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<ask type="short">Why does a hash table resize as its load factor grows?</ask>' },
        { role: 'user', content: 'Answer: to save memory' },
        { role: 'assistant', content: '<grade verdict="wrong" score="0">To keep chains short.</grade>\n\n<ask type="short">What is the time complexity of this?</ask>' },
        { role: 'user', content: 'Answer: O(1)' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }
      ]
    })
    expect(sources(tries.id, 'lesson:studied').map((e) => `${e.pos}:${e.kind}`)).toEqual(['q0:right'])
    expect(sources(hash.id, 'lesson:studied').map((e) => `${e.pos}:${e.kind}`)).toEqual(['q1:wrong'])
    // The question that names neither is counted on neither
    expect(file().concepts.flatMap((c) => c.evidence).some((e) => e.source === 'lesson:studied' && e.pos === 'q2')).toBe(false)

    // A quiz on a heading with its tag is on the roadmap topic, not a new one
    await quiz({ id: 'tries-q', topic: 'Tries — CORE', turns: [{ role: 'user', content: 'Quiz me.' }, { role: 'assistant', content: '<ask type="short">What is a trie?</ask>' }, { role: 'user', content: 'Answer: a prefix tree' }, { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }] })
    expect(sources(tries.id, 'lesson:tries-q')).toHaveLength(1)
    expect(file().concepts.filter((c) => /tries/i.test(c.name))).toHaveLength(1)
    // The same answer sent as an attempt names its record: not counted again
    const n = on(tries.id).length
    await recordAttempt({ topic: 'Tries — CORE', mode: 'quiz', verdict: 'correct', score: 1, lesson: 'tries-q' })
    expect(on(tries.id)).toHaveLength(n)
    // An exam's marked part keeps no record: counted
    await recordAttempt({ topic: 'Tries', mode: 'quiz', verdict: 'partial', score: 0.5 })
    expect(on(tries.id)).toHaveLength(n + 1)
    expect(on(tries.id)[n].kind).toBe('partly')
  })
})

describe('Review now, Quick check and the questions missed', () => {
  it('reviews the questions kept on a topic, each scheduled where it is kept and counted once', async () => {
    // A lesson on Hash tables with a question not answered: kept for recall
    await saveLesson({
      id: 'hash-lesson',
      mode: 'teach',
      topic: 'Hash tables',
      scope: { kind: 'folder', path: 'Algorithms' },
      turns: [
        { role: 'user', content: 'Teach me.' },
        { role: 'assistant', content: '<plan>\n1. Hash functions\n2. Collisions and chaining\n</plan>\n<ask type="short">Two keys land in one slot: how does chaining handle the collisions?</ask>' },
        { role: 'user', content: "Answer: I don't know" },
        { role: 'assistant', content: 'Each slot keeps a list.\n\n<ask type="short">What does a hash function return?</ask>' },
        { role: 'user', content: 'Answer: a slot' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }
      ]
    })
    const item = recallItems().find((i) => /chaining/.test(i.prompt))!
    expect(item.lesson).toBe('hash-lesson')
    await addMistakes([{ topic: 'Hash tables — CORE', source: 'quiz', question: 'Why resize a hash table?', fix: 'To keep the chains short.' }])

    // What is kept on it, in all three stores; due now: the recall question, and nothing that isn't due
    const kept = await keptOn(hash.id)
    expect(kept.map((i) => i.kind).sort()).toEqual(['card', 'mistake', 'recall'])
    const review = await reviewFor(hash.id)
    expect(review.items.map((i) => i.id)).toContain(item.id)
    expect(review.items.every((i) => i.due <= Date.now())).toBe(true)

    // Answered: recall's FSRS schedule moves, the review log has it, and the map has it once, as a recall
    const revlog = () => readFileSync(join(tide, 'revlog.jsonl'), 'utf8').trim().split('\n').length
    const lines = revlog()
    await answerReview(hash.id, review.items.find((i) => i.id === item.id)!, 'correct')
    const after = recallItems().find((i) => i.id === item.id)!
    expect([after.reviews, after.due > Date.now()]).toEqual([1, true])
    expect(revlog()).toBe(lines + 1)
    expect(sources(hash.id, `recall:${item.id}`).map((e) => e.kind)).toEqual(['recalled-right'])
    // A mistake answered in a review: retested in the journal, a recall on the map
    const mistake = kept.find((i) => i.kind === 'mistake')!
    await answerReview(hash.id, mistake, 'wrong')
    expect((await listMistakes())[0].lastTried).toBeTruthy()
    expect(sources(hash.id, `mistake:${mistake.id}`).map((e) => e.kind)).toEqual(['recalled-wrong'])

    // The review's own record adds nothing more: no evidence of its own, no question kept twice
    const total = file().concepts.flatMap((c) => c.evidence).length
    const recallCount = recallItems().length
    await quiz({
      id: 'review-1',
      topic: 'Hash tables',
      options: { length: 2, review: { concept: hash.id, items: [review.items.find((i) => i.id === item.id)!, mistake] } },
      turns: [
        { role: 'user', content: 'Review.' },
        { role: 'assistant', content: '<ask type="short">How does chaining handle two keys in one slot?</ask>' },
        { role: 'user', content: 'Answer: a list per slot' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<ask type="short">Why is a hash table resized?</ask>' },
        { role: 'user', content: 'Answer: it is full' },
        { role: 'assistant', content: '<grade verdict="wrong" score="0">To keep chains short.</grade>' }
      ]
    })
    expect(file().concepts.flatMap((c) => c.evidence)).toHaveLength(total)
    expect(recallItems()).toHaveLength(recallCount)
  })

  it('reviews from memory when nothing is kept, and checks a part of a topic on that part', async () => {
    expect((await reviewFor('no such concept')).items).toEqual([])
    await quiz({
      id: 'review-tries',
      topic: 'Tries',
      options: { length: 3, review: { concept: tries.id, items: [] } },
      turns: [{ role: 'user', content: 'Review.' }, { role: 'assistant', content: '<ask type="explain">Explain how a trie stores words.</ask>' }, { role: 'user', content: 'Answer: by prefix' }, { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }]
    })
    expect(sources(tries.id, 'lesson:review-tries').map((e) => e.kind)).toEqual(['recalled-right'])

    const step = file().concepts.find((c) => c.parent === hash.id && /hash functions/i.test(c.name))!
    await quiz({
      id: 'check-step',
      topic: step.name,
      options: { length: 3, check: { concept: step.id, parts: [], avoid: [] } },
      turns: [{ role: 'user', content: 'Check.' }, { role: 'assistant', content: '<ask type="short">What makes a good hash function?</ask>' }, { role: 'user', content: 'Answer: it spreads keys evenly' }, { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }]
    })
    expect(sources(step.id, 'lesson:check-step').map((e) => e.kind)).toEqual(['right'])
    // On the part itself, not a new topic named after it
    expect(file().concepts.filter((c) => c.name === step.name)).toHaveLength(1)
  })

  it('gives each missed question its lesson and the page to open it at', async () => {
    const view = await knowledgeView()
    const missed = view.missed![hash.id]
    const q = missed.find((m) => /chaining/.test(m.prompt))!
    expect(q.lesson).toBe('hash-lesson')
    expect(q.id).toBeTruthy()
    expect(q.page).toMatch(/^Lessons\/.*Hash tables\.md$/)
    expect(existsSync(join(vault, q.page!))).toBe(true)
    expect(readFileSync(join(vault, q.page!), 'utf8')).toContain('how does chaining handle the collisions?')
  })
})
