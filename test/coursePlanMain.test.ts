/**
 * Courses in the plan, end to end on a course on disk (main/coursePlan, main/courseQuiz,
 * main/courses): Haiku's alignment asked once and kept, a word match when it fails; ticking a
 * course item marks its lessons read (exposure, never mastery) and finishing them ticks the item;
 * a check written from the lesson's text and video, citing them, marked by Opus, counted on its
 * concepts, a miss kept for recall, a pass marking the lesson done; and the same with no model.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { data, calls } = vi.hoisted(() => ({
  data: { dir: '', plan: null as unknown, topics: [] as { id: string; title: string }[] },
  calls: { evidence: [] as { concept: string; kind: string; weight?: number; source: string }[], named: [] as { topic: string; kind: string }[], done: [] as [string, number, boolean][], recall: [] as { prompt: string; topic: string }[] }
}))

vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => data.dir }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: '/nowhere', ai: {} }) }))
vi.mock('../src/main/knowledge', () => ({
  noteReviewAnswer: async (e: { concept: string; kind: string; weight?: number; source: string }) => void calls.evidence.push(e),
  noteEvidence: async (e: { topic: string; kind: string }) => void calls.named.push(e),
  allConcepts: async () => [
    { id: 'mi', name: 'Mutual information and feature importance' },
    { id: 'lr', name: 'Logistic regression' }
  ],
  conceptOfTopic: async () => null
}))
vi.mock('../src/main/coach', () => ({
  getWeek: async () => data.plan,
  setItemDone: async (date: string, index: number, done: boolean) => void calls.done.push([date, index, done])
}))
vi.mock('../src/main/goals', () => ({ replanNow: async () => null }))
vi.mock('../src/main/recall', () => ({ keepFromReading: async (items: { prompt: string; topic: string }[]) => (calls.recall.push(...items), items.length) }))
vi.mock('../src/main/learnerProfile', () => ({ profileDigest: async () => '' }))
vi.mock('../src/main/ai', () => ({
  extractJsonObject: (t: string) => JSON.parse(t),
  jobRoute: async () => ({ who: 'claude', role: 'mark' })
}))
vi.mock('../src/main/videos', () => ({
  getTranscript: async (id: string) => ({ transcript: { id, title: 'Lecture', lines: Array.from({ length: 50 }, (_, i) => ({ start: i * 12, end: i * 12 + 12, text: `At this point in the lecture we compute mutual information between contract type and churn, step ${i}` })), from: 'captions', fetchedAt: 1 } })
}))
const ROADMAP = `# Software Engineering

## 16. Optimization & Classical Machine Learning — CORE

### Classical ML & Evaluation

- [ ] Logistic regression: derivation, decision boundary, when preferred over more complex models
- [ ] Mutual information and feature importance
- [ ] Classification evaluation metrics: precision, recall, F1, ROC curve, AUC

## 17. Networking — CORE

- [ ] TCP handshake and congestion control
`
vi.mock('../src/main/track', () => ({
  phaseNow: async () => ({ notebook: 'Software Engineering', phases: [], current: { id: 'p16', title: 'Optimization & Classical Machine Learning — CORE', topics: data.topics }, open: data.topics.map((t: { id: string }) => t.id), solid: 2 })
}))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [{ name: 'Software Engineering', path: 'Software Engineering', outline: 'Roadmaps/RM_SWE.md' }] }))
vi.mock('../src/main/vault', () => ({ readText: async () => ROADMAP, writeText: async () => {}, uniquePath: (p: string) => p, joinRel: (...p: string[]) => p.join('/') }))

data.dir = mkdtempSync(join(tmpdir(), 'tide-courseplan-'))
const course = join(data.dir, 'courses', 'ml-zoomcamp')
const repo = join(course, 'repo')
mkdirSync(join(repo, '03-classification'), { recursive: true })
const para = (s: string) => `${s} `.repeat(6).trim()
writeFileSync(
  join(repo, '03-classification', '06-mutual-info.md'),
  `# Feature importance: Mutual information

[![](https://img.youtube.com/vi/_u2YaGT6RN0/0.jpg)](https://www.youtube.com/watch?v=_u2YaGT6RN0)

## Mutual information

${para('Mutual information tells us how much we learn about one variable by observing another, and for churn it says how much the contract type tells us.')}

## Computing it

${para('We use mutual_info_score from sklearn.metrics on every categorical column against churn, and sort the scores so contract comes first.')}
`
)
writeFileSync(join(repo, '03-classification', '09-logistic-regression.md'), `# Logistic regression\n\n## The sigmoid\n\n${para('Logistic regression passes a linear score through the sigmoid so the output is a probability between zero and one.')}\n`)
const lessons = [
  { id: '03-classification/06-mutual-info.md', path: '03-classification/06-mutual-info.md', title: 'Feature importance: Mutual information', kind: 'reading', words: 600 },
  { id: '03-classification/09-logistic-regression.md', path: '03-classification/09-logistic-regression.md', title: 'Logistic regression', kind: 'reading', words: 600 }
]
writeFileSync(join(course, 'course.json'), JSON.stringify({ id: 'ml-zoomcamp', importedAt: 1, updatedAt: 1, method: 'git', outline: { modules: [{ id: 'm1', title: 'Module 3: Machine Learning for Classification', lessons, code: [] }], lessons: 2 } }))

import { alignCourse, keptAlignments, resetCoursePlan, setAligner, tickCourseItem } from '../src/main/coursePlan'
import { courseProgressAll, markLesson } from '../src/main/courses'
import { courseItemsFor, resetCourseQuiz, setQuizAsker, startCourseQuiz, submitCourseQuiz } from '../src/main/courseQuiz'
import type { AgendaItem } from '../src/shared/coach'

afterAll(() => rmSync(data.dir, { recursive: true, force: true }))
beforeEach(() => {
  calls.evidence.length = 0
  calls.named.length = 0
  calls.done.length = 0
  calls.recall.length = 0
})

describe('aligning a course to a roadmap, once', () => {
  it('asks Haiku, keeps the answer, and doesn’t ask again while nothing changed', async () => {
    let asked = 0
    let prompt = ''
    setAligner(async (p) => {
      asked++
      prompt = p
      return { text: JSON.stringify({ lessons: [{ l: 'L1', t: ['T2'] }, { l: 'L2', t: ['T1'] }] }), by: 'claude' }
    })
    const a = await alignCourse('ml-zoomcamp', 'Software Engineering')
    expect(a!.by).toBe('claude')
    expect(a!.lessons).toEqual({ '03-classification/06-mutual-info.md': [expect.stringContaining('mutual information')], '03-classification/09-logistic-regression.md': [expect.stringContaining('logistic regression')] })
    // Only the phase the course is about went to Haiku
    expect(prompt).not.toMatch(/TCP/)
    // Its lessons' minutes, with the video counted
    expect(a!.minutes!['03-classification/06-mutual-info.md']).toBe(25)
    resetCoursePlan()
    await alignCourse('ml-zoomcamp', 'Software Engineering')
    expect(asked).toBe(1)
  })
})

describe('the week’s course, sized to the roadmap’s time', () => {
  it('gives the course the first session and its lessons in order, and says why', async () => {
    const a = (await keptAlignments('ml-zoomcamp'))[0]
    data.topics = [...new Set(Object.values(a.lessons).flat())].map((id) => ({ id, title: id }))
    const thread = { id: 'roadmap:software engineering', label: 'Software Engineering', kind: 'roadmap' as const, weight: 1, maxGap: 7, hard: true, session: 60, touch: 15 }
    const { planCourses } = await import('../src/main/coursePlan')
    const r = await planCourses([thread], new Map([[thread.id, [30, 60, 30]]]))
    const slots = r.slots.get(thread.id)!
    expect(slots[0]!.map((l) => l.n)).toEqual(['3.6'])
    expect(slots.flatMap((x) => x ?? []).map((l) => l.n)).toEqual(['3.6', '3.9'])
    expect(r.weeks[0]).toMatchObject({ course: 'ml-zoomcamp', range: '3.6–3.9', modules: 'module 3', phaseTitle: 'Optimization & Classical Machine Learning — CORE' })
    expect(r.weeks[0].why).toMatch(/It covers 2 of the 2 topics left in Optimization & Classical Machine Learning, the phase you’re in\. Beginner, your level/)
    expect([...r.covered.get('Software Engineering')!].sort()).toEqual(data.topics.map((t) => t.id).sort())
    // Nothing to plan when the roadmap has no sessions this week
    expect((await planCourses([thread], new Map())).weeks).toEqual([])
  })
})

const plan = (ids: string[]) => ({ weekStart: '2026-11-16', createdAt: 1, summary: '', priorities: [], days: [{ date: new Date().toISOString().slice(0, 10), items: [{ kind: 'review', title: 'Warm-up', minutes: 10 }, courseItemOf(ids)] }] })
const courseItemOf = (ids: string[]): AgendaItem => ({ kind: 'course', title: 'ML Zoomcamp 3.6–3.9', minutes: 50, thread: 'roadmap:software engineering', course: { id: 'ml-zoomcamp', title: 'Machine Learning Zoomcamp', lessons: ids.map((id, i) => ({ id, title: `L${i}`, n: `3.${i}`, minutes: 25 })) } })

describe('ticks, both ways', () => {
  const ids = lessons.map((l) => l.id)
  it('ticking a course item marks its lessons read: exposure on their concepts, never a right answer', async () => {
    data.plan = plan(ids)
    await tickCourseItem(courseItemOf(ids), true)
    const p = (await courseProgressAll())['ml-zoomcamp']
    expect(ids.every((id) => p[id].done)).toBe(true)
    expect(calls.evidence.length).toBeGreaterThan(0)
    expect(calls.evidence.every((e) => e.kind === 'taught' && e.weight === 0.5)).toBe(true)
    // The tick came from the plan: the plan isn't ticked again from here
    expect(calls.done).toEqual([])
  })
  it('finishing the item’s last lesson in the course room ticks the plan’s item', async () => {
    data.plan = plan(ids)
    await markLesson('ml-zoomcamp', ids[0], false)
    await markLesson('ml-zoomcamp', ids[1], false)
    await markLesson('ml-zoomcamp', ids[0], true)
    expect(calls.done).toEqual([])
    await markLesson('ml-zoomcamp', ids[1], true)
    expect(calls.done).toEqual([[new Date().toISOString().slice(0, 10), 1, true]])
  })
})

describe('a check from the course, cited and marked', () => {
  it('writes questions on the lesson’s text and video, each citing where it comes from', async () => {
    let quizPrompt = ''
    setQuizAsker(async (job, prompt) => {
      if (job === 'courseQuiz') {
        quizPrompt = prompt
        const video = prompt.match(/(P\d+) \[[^\]]*video at/)![1]
        return { text: JSON.stringify({ questions: [{ p: 'P1', quote: 'how much we learn about one variable', question: 'Why does mutual information suit a categorical feature?', answer: 'It works on categories.' }, { p: video, quote: 'we compute mutual information between contract type and churn', question: 'What is compared with churn in the lecture?', answer: 'Contract type.' }] }), by: 'claude' }
      }
      return { text: JSON.stringify({ marks: [{ q: 'Q1', verdict: 'correct', feedback: 'Right.' }, { q: 'Q2', verdict: 'wrong', feedback: 'It is the contract type.' }] }), by: 'claude' }
    })
    resetCourseQuiz()
    const s = await startCourseQuiz({ course: 'ml-zoomcamp', lessons: [lessons[0].id], kind: 'check' })
    expect(quizPrompt).toContain('3.6 Feature importance: Mutual information')
    expect(s.questions).toHaveLength(2)
    expect(s.questions.every((q) => !('answer' in q))).toBe(true)
    expect(s.questions[0].cite).toMatchObject({ n: '3.6', kind: 'text', section: 'Mutual information', quote: 'how much we learn about one variable' })
    expect(s.questions[1].cite.kind).toBe('video')
    expect(s.questions[1].cite.at).toEqual(expect.any(Number))
    expect(s.questions[0].concept).toBeTruthy()

    await markLesson('ml-zoomcamp', lessons[0].id, false)
    const r = await submitCourseQuiz(s.id, { q1: 'It works directly on categories.', q2: 'The price' })
    expect(r.by).toBe('claude')
    expect(r.score).toBe(1)
    expect(r.passed).toBe(false)
    // Each answer counts on its concept; the miss is kept for recall with where it is in the course
    expect(calls.evidence.map((e) => e.kind).sort()).toEqual(['right', 'wrong'])
    expect(calls.evidence.every((e) => e.source.startsWith('coursecheck:'))).toBe(true)
    expect(calls.recall).toHaveLength(1)
    expect(calls.recall[0].prompt).toMatch(/\(ML Zoomcamp 3\.6, at \d+:\d\d in the video\)$/)
    // Not passed: the lesson isn't marked done by it
    expect((await courseProgressAll())['ml-zoomcamp'][lessons[0].id]).toMatchObject({ done: false, right: 1, wrong: 1 })
    // The questions are kept, for warm-ups and reviews on the concept
    const items = await courseItemsFor([s.questions[0].concept!])
    expect(items.get(s.questions[0].concept!)?.[0].question).toMatch(/\(ML Zoomcamp 3\.6, “Mutual information”\)$/)
  })

  it('a check passed marks the lesson done', async () => {
    setQuizAsker(async (job) => (job === 'courseQuiz' ? { text: JSON.stringify({ questions: [{ p: 'P1', question: 'Why the sigmoid?', answer: 'Probabilities.' }] }), by: 'claude' } : { text: JSON.stringify({ marks: [{ q: 'Q1', verdict: 'correct', feedback: '' }] }), by: 'claude' }))
    await markLesson('ml-zoomcamp', lessons[1].id, false)
    const s = await startCourseQuiz({ course: 'ml-zoomcamp', lessons: [lessons[1].id], kind: 'check' })
    const r = await submitCourseQuiz(s.id, { q1: 'To get a probability' })
    expect(r.passed).toBe(true)
    expect((await courseProgressAll())['ml-zoomcamp'][lessons[1].id].done).toBe(true)
  })

  it('with no model: the course’s own words to answer and mark yourself', async () => {
    setQuizAsker(async () => {
      throw new Error('offline')
    })
    const s = await startCourseQuiz({ course: 'ml-zoomcamp', lessons: [lessons[0].id], kind: 'check' })
    expect(s.by).toBe('tide')
    expect(s.questions).toHaveLength(3)
    expect(s.questions[0].question).toMatch(/^Without looking: what does 3\.6 say about/)
    const r = await submitCourseQuiz(s.id, { q1: 'x' })
    expect(r.needsSelf).toBe(true)
    expect(r.answers!.q1).toMatch(/^The course says:/)
    const mine = await submitCourseQuiz(s.id, { q1: 'x' }, { q1: 'correct', q2: 'correct', q3: 'partial' })
    expect(mine.by).toBe('self')
    expect(mine.passed).toBe(true)
  })
})

describe('without Claude, the alignment is Tide’s own word match', () => {
  it('stands in when Haiku fails, and still maps the obvious lessons', async () => {
    rmSync(join(data.dir, 'courses', 'alignments.json'), { force: true })
    resetCoursePlan()
    setAligner(async () => {
      throw new Error('no Claude')
    })
    const a = await alignCourse('ml-zoomcamp', 'Software Engineering', 50)
    expect(a!.by).toBe('heuristic')
    expect(Object.values(a!.lessons).flat().length).toBeGreaterThan(0)
    expect((await keptAlignments('ml-zoomcamp'))[0].by).toBe('heuristic')
  })
})
