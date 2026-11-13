/**
 * Courses in the plan (shared/coursePlan) and questions sourced from them (shared/courseQuiz): a
 * course's lessons numbered as the course numbers them, Haiku's alignment read and checked (and a
 * word match without it), the week's sessions given to a course's next lessons sized to the time,
 * one course a roadmap and never two that overlap, and quizzes that cite the course's own passages.
 */
import { describe, expect, it } from 'vitest'
import type { CourseOutline } from '../src/shared/courses'
import {
  aboutTime,
  alignPrompt,
  chooseCourses,
  courseItem,
  courseQueue,
  courseSessions,
  courseShare,
  courseWeek,
  heuristicAlignment,
  learnerLevel,
  lessonMinutes,
  likelyPhases,
  parseAlignment,
  planLessons,
  rangeLabel,
  weekLine,
  type AlignTopic,
  type CourseFit,
  type PlanLesson
} from '../src/shared/coursePlan'
import { attachCites, citeLabel, clock, exposureEvidence, fallbackQuiz, parseQuiz, parseQuizMarks, pickPassages, quizEvidence, quizScore, quoted, recallPrompt, textPassages, transcriptPassages, videoIds, type Passage } from '../src/shared/courseQuiz'
import { thingsTitle, weekMarkdown, type WeekPlan } from '../src/shared/coach'

const L = (id: string, title: string, words = 600, kind: 'reading' | 'notebook' | 'homework' = 'reading') => ({ id, path: id, title, kind, words })

/** ML Zoomcamp's module 3, as Tide reads it from GitHub */
const OUTLINE: CourseOutline = {
  modules: [
    { id: 'm1', title: 'Introduction', lessons: [L('README.md', 'About the course', 900)], code: [] },
    {
      id: 'm2',
      title: 'Module 2: Machine Learning for Regression',
      lessons: [L('02-regression/README.md', '2. Machine Learning for Regression', 186), L('02-regression/01-car-price-intro.md', 'Car price prediction project'), L('02-regression/10-rmse.md', 'Root Mean Squared Error (RMSE)')],
      code: []
    },
    {
      id: 'm3',
      title: 'Module 3: Machine Learning for Classification',
      lessons: [
        L('03-classification/README.md', 'Community notes', 186),
        L('03-classification/01-churn-project.md', 'Churn prediction project', 709),
        L('03-classification/02-data-preparation.md', 'Data preparation', 951),
        L('03-classification/03-validation.md', 'Setting up the validation framework', 515),
        L('03-classification/04-eda.md', 'EDA', 601),
        L('03-classification/05-risk.md', 'Feature importance: Churn rate and risk ratio', 1065),
        L('03-classification/06-mutual-info.md', 'Feature importance: Mutual information', 591),
        L('03-classification/09-logistic-regression.md', 'Logistic regression', 837),
        L('03-classification/14-explore-more.md', 'Explore more', 138),
        L('03-classification/notebook.ipynb', 'Notebook', 2253, 'notebook'),
        L('03-classification/images/imagegen-provenance-2026-09-08.md', 'Imagegen repair provenance: 2026-09-08', 1528),
        L('cohorts/2025/03-classification/homework.md', 'Homework (2025)', 600, 'homework')
      ],
      code: []
    }
  ],
  lessons: 16
}

describe('a course’s lessons, as the plan counts them', () => {
  const ls = planLessons(OUTLINE)
  it('numbers lessons as the course does: module 3, file 04 is 3.4', () => {
    const n = Object.fromEntries(ls.map((l) => [l.id, l.n]))
    expect(n['03-classification/04-eda.md']).toBe('3.4')
    expect(n['03-classification/06-mutual-info.md']).toBe('3.6')
    expect(n['02-regression/10-rmse.md']).toBe('2.10')
    expect(n['cohorts/2025/03-classification/homework.md']).toBe('3 homework')
  })
  it('leaves out housekeeping, link lists and a notebook that repeats the readings', () => {
    const titles = ls.map((l) => l.title)
    expect(titles).not.toContain('About the course')
    expect(titles).not.toContain('Explore more')
    expect(titles).not.toContain('Community notes')
    expect(titles.some((t) => /provenance/i.test(t))).toBe(false)
    expect(titles).not.toContain('Notebook')
    // A module's README that only lists its lessons is its contents page
    expect(titles).not.toContain('2. Machine Learning for Regression')
  })
  it('counts a notebook twin with its reading, not as a lesson of its own', () => {
    const o: CourseOutline = { modules: [{ id: 'm1', title: 'Module 1: Intro', lessons: [L('01-intro/07-numpy.md', 'Introduction to NumPy', 600), L('01-intro/07-numpy.ipynb', 'Introduction to NumPy: notebook', 1200, 'notebook')], code: [] }], lessons: 2 }
    const ls = planLessons(o, { '01-intro/07-numpy.md': 25 })
    expect(ls.map((l) => [l.n, l.title, l.minutes])).toEqual([['1.7', 'Introduction to NumPy', 35]])
  })
  it('sizes a lesson by its words, its videos and its work', () => {
    expect(lessonMinutes({ words: 600, kind: 'reading' }, 1)).toBe(25)
    expect(lessonMinutes({ words: 600, kind: 'reading' }, 0)).toBe(10)
    expect(lessonMinutes({ words: 600, kind: 'homework' })).toBe(55)
  })
})

const TOPICS: AlignTopic[] = [
  { id: 'lr', title: 'Logistic regression: derivation, decision boundary, when preferred over more complex models', phase: 'p16', phaseTitle: 'Optimization & Classical Machine Learning' },
  { id: 'metrics', title: 'Classification evaluation metrics: precision, recall, F1, ROC curve, AUC, confusion matrix', phase: 'p16', phaseTitle: 'Optimization & Classical Machine Learning' },
  { id: 'split', title: 'Train/validation/test split — _Hands-On Machine Learning_', phase: 'p16', phaseTitle: 'Optimization & Classical Machine Learning' },
  { id: 'mi', title: 'Mutual information and feature importance', phase: 'p16', phaseTitle: 'Optimization & Classical Machine Learning' },
  { id: 'tcp', title: 'TCP handshake and congestion control', phase: 'p9', phaseTitle: 'Networking' }
]

describe('aligning a course to a roadmap', () => {
  const ls = planLessons(OUTLINE)
  it('keeps the prompt to the phases the course is likely about', () => {
    const phases = likelyPhases('Machine Learning Zoomcamp regression classification logistic regression feature importance mutual information validation', TOPICS)
    expect(phases).toEqual(['p16'])
    const p = alignPrompt({ title: 'Machine Learning Zoomcamp', by: 'DataTalksClub', level: 'beginner', covers: 'Regression, classification' }, ls, TOPICS.filter((t) => phases.includes(t.phase)), 'Software Engineering')
    expect(p).toContain('[3.4] Module 3: Machine Learning for Classification / EDA')
    expect(p).toContain('T1. Logistic regression')
    expect(p).not.toContain('TCP')
  })
  it('reads Haiku’s answer: only lessons and topics that exist, at most four a lesson', () => {
    const iLR = ls.findIndex((l) => l.title === 'Logistic regression') + 1
    const iVal = ls.findIndex((l) => l.title === 'Setting up the validation framework') + 1
    const raw = { lessons: [{ l: `L${iLR}`, t: ['T1', 'T1', 'T9'] }, { l: `L${iVal}`, t: ['T3'] }, { l: 'L999', t: ['T1'] }, { l: 'L1', t: 'T2' }] }
    const a = parseAlignment(raw, ls, TOPICS)!
    expect(a['03-classification/09-logistic-regression.md']).toEqual(['lr'])
    expect(a['03-classification/03-validation.md']).toEqual(['split'])
    expect(Object.keys(a)).toHaveLength(2)
    expect(parseAlignment({ lessons: [] }, ls, TOPICS)).toBeNull()
    expect(parseAlignment('nonsense', ls, TOPICS)).toBeNull()
  })
  it('without a model, matches a lesson to a topic whose line holds most of its title’s words', () => {
    const a = heuristicAlignment(ls, TOPICS)
    expect(a['03-classification/09-logistic-regression.md']).toContain('lr')
    expect(a['03-classification/06-mutual-info.md']).toContain('mi')
    // "Data preparation" shares only general words with anything
    expect(a['03-classification/02-data-preparation.md']).toBeUndefined()
  })
})

const withTopics = (ls: PlanLesson[], map: Record<string, string[]>) => ls.map((l) => ({ ...l, topics: map[l.id] ?? [] }))

describe('the week gives the course its next lessons, sized to the time', () => {
  const ls = withTopics(planLessons(OUTLINE, {}, {}), { '03-classification/03-validation.md': ['split'], '03-classification/06-mutual-info.md': ['mi'], '03-classification/09-logistic-regression.md': ['lr'], '02-regression/10-rmse.md': ['rmse'] })
    .map((l) => ({ ...l, minutes: 30 }))
  const open = new Set(['split', 'mi', 'lr', 'metrics'])
  it('queues every lesson not done in a module that teaches an open topic, in course order', () => {
    const q = courseQueue(ls, { '03-classification/01-churn-project.md': { started: 1, updated: 1, done: true, right: 0, partly: 0, wrong: 0 } }, open)
    expect(q.map((l) => l.n)).toEqual(['3.2', '3.3', '3.4', '3.5', '3.6', '3.9', '3 homework'])
    // A lesson read to the end isn't given again
    expect(courseQueue(ls, { '03-classification/01-churn-project.md': { started: 1, updated: 1, done: false, right: 0, partly: 0, wrong: 0, read: 0.95 } }, open)[0].n).toBe('3.2')
    // Regression is in another phase: none of its lessons come
    expect(q.some((l) => l.module.includes('Regression'))).toBe(false)
  })
  it('takes the first session and then evenly, filling each with the lessons that fit its minutes', () => {
    const q = courseQueue(ls, {}, open)
    const slots = courseSessions([60, 45, 60, 90], q, 0.5)
    expect(slots.map((s) => (s ? s.map((l) => l.n) : null))).toEqual([['3.1', '3.2'], null, ['3.3', '3.4'], null])
    // A longer week holds more lessons; the course's lessons only ever come in order
    const more = courseSessions([90, 90, 90, 90], q, 0.75).flatMap((s) => s ?? [])
    expect(more.map((l) => l.n)).toEqual(['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.9', '3 homework'].slice(0, more.length))
    expect(more.length).toBeGreaterThan(4)
  })
  it('a session shorter than one lesson still gets that lesson', () => {
    const slots = courseSessions([20], courseQueue(ls, {}, open), 1)
    expect(slots[0]!.map((l) => l.n)).toEqual(['3.1'])
  })
  it('the course’s share is what it covers of the phase, between a third and three quarters', () => {
    expect(courseShare(1, 10)).toBe(0.34)
    expect(courseShare(6, 9)).toBeCloseTo(0.667)
    expect(courseShare(9, 9)).toBe(0.75)
    expect(courseShare(0, 9)).toBe(0)
  })
  it('says the week’s course as a line: module, lessons, about how long, and why', () => {
    const pick = { course: 'ml-zoomcamp', title: 'Machine Learning Zoomcamp', level: 'beginner' as const, notebook: 'Software Engineering', phase: 'p16', phaseTitle: 'Classification — CORE', covers: ['lr'], names: {}, open: 4, started: true, queue: 6, why: 'w', itemWhy: 'Covers Classification, the phase you’re in' }
    const week = courseWeek(pick, ls.filter((l) => ['3.3', '3.4', '3.5', '3.6'].includes(l.n)))
    expect(week.range).toBe('3.3–3.6')
    expect(weekLine(week)).toBe('ML Zoomcamp module 3, lessons 3.3–3.6 (about 2 h), because it covers Classification, the phase you’re in')
    const item = courseItem(pick, ls.slice(5, 7), 60, 'roadmap:software engineering')
    expect(item.kind).toBe('course')
    expect(item.title).toBe('ML Zoomcamp 3.4–3.5')
    expect(thingsTitle(item)).toBe('Course: ML Zoomcamp 3.4–3.5')
    expect(rangeLabel([{ n: '3.9' }, { n: '3 homework' }])).toBe('3.9 and the module 3 homework')
    expect(aboutTime(40)).toBe('about 40 min')
    expect(aboutTime(150)).toBe('about 2.5 h')
    const plan: WeekPlan = { weekStart: '2026-11-16', createdAt: 1, summary: 'S', priorities: [], days: [{ date: '2026-11-16', items: [item] }], courses: [week] }
    expect(weekMarkdown(plan)).toContain('- 3.4 EDA (about 30 min)')
  })
})

describe('one course a roadmap, never two on the same topics', () => {
  const fit = (o: Partial<CourseFit>): CourseFit => ({ course: 'x', title: 'X', level: 'beginner', notebook: 'ML', phase: 'p', phaseTitle: 'Classification', covers: [], names: { lr: 'Logistic regression', metrics: 'Classification metrics', trees: 'Decision trees', k: 'Kafka' }, open: 6, started: false, queue: 5, ...o })
  it('picks the best fit for your level, and says why and what it was chosen over', () => {
    const { picks, skipped } = chooseCourses(
      [
        fit({ course: 'zoomcamp', title: 'ML Zoomcamp', level: 'beginner', covers: ['lr', 'metrics', 'trees'] }),
        fit({ course: 'cs229', title: 'CS229', level: 'advanced', covers: ['lr', 'metrics', 'trees'] })
      ],
      { ML: 'beginner' }
    )
    expect(picks.map((p) => p.course)).toEqual(['zoomcamp'])
    expect(picks[0].why).toContain('It covers 3 of the 6 topics left in Classification, the phase you’re in. Beginner, your level.')
    expect(picks[0].why).toContain('Chosen over CS229')
    expect(skipped[0].why).toMatch(/same topics as ML Zoomcamp \(Logistic regression, Classification metrics and Decision trees\).*level suits you better/)
  })
  it('a course you have started wins over one you haven’t that covers a little more', () => {
    const { picks } = chooseCourses([fit({ course: 'a', title: 'A', covers: ['lr', 'metrics', 'trees'] }), fit({ course: 'b', title: 'B', covers: ['lr', 'metrics'], started: true })], { ML: 'beginner' })
    expect(picks.map((p) => p.course)).toEqual(['b'])
    expect(picks[0].why).toContain('you’ve started it')
  })
  it('two roadmaps can each have a course, but not two that teach the same topic', () => {
    const { picks, skipped } = chooseCourses(
      [fit({ course: 'a', title: 'A', notebook: 'ML', covers: ['lr'] }), fit({ course: 'b', title: 'B', notebook: 'Data', covers: ['k'] }), fit({ course: 'c', title: 'C', notebook: 'Data', covers: ['lr'], names: { lr: 'Logistic regression' } })],
      { ML: 'beginner', Data: 'beginner' }
    )
    expect(picks.map((p) => p.course).sort()).toEqual(['a', 'b'])
    expect(skipped.map((s) => s.course)).toEqual(['c'])
  })
  it('a course with nothing left for the phase is not picked', () => {
    expect(chooseCourses([fit({ covers: ['lr'], queue: 0 })], {}).picks).toEqual([])
  })
  it('reads your level from how much is solid', () => {
    expect([learnerLevel(0), learnerLevel(10), learnerLevel(40)]).toEqual(['beginner', 'intermediate', 'advanced'])
  })
})

// ---------- Questions from the course ----------

const lesson = { course: 'ml-zoomcamp', courseTitle: 'ML Zoomcamp', id: '03-classification/06-mutual-info.md', n: '3.6', title: 'Feature importance: Mutual information', topics: ['mi', 'lr'] }
const MD = `# Mutual information

## Mutual information

Mutual information tells us how much we learn about one variable by observing another. For churn, it measures how much knowing a customer's contract type tells us about whether they churn. A higher value means the feature is more important for predicting churn, and categorical features like contract are where it shines because it works directly on categories without encoding them.

## Computing it with scikit-learn

We use mutual_info_score from sklearn.metrics and apply it to every categorical column against the churn column. Sorting the scores shows that contract matters most, followed by online security and tech support, while gender and phone service tell us almost nothing about churn at all.
`
const sections = [
  { title: 'Mutual information', start: MD.indexOf('## Mutual'), end: MD.indexOf('## Computing') },
  { title: 'Computing it with scikit-learn', start: MD.indexOf('## Computing'), end: MD.length }
]
const LINES = Array.from({ length: 60 }, (_, i) => ({ start: i * 10, text: `line ${i} of the lecture where Alexey explains how mutual information is computed for each categorical variable and churn` }))

describe('passages from what you read and watched', () => {
  it('cuts a lesson into its sections and its video into timed windows, spread through it', () => {
    const t = textPassages({ ...lesson, markdown: MD, sections })
    expect(t.map((p) => p.cite.section)).toEqual(['Mutual information', 'Computing it with scikit-learn'])
    expect(t[0].text).not.toMatch(/^##/)
    const v = transcriptPassages(lesson, 'abcdefghijk', LINES, 100, 3)
    expect(v).toHaveLength(3)
    expect(v.map((p) => p.cite.at)).toEqual([100, 300, 500])
    expect(v[0].cite.kind).toBe('video')
  })
  it('finds a lesson’s YouTube videos, each once', () => {
    expect(videoIds('[watch](https://www.youtube.com/watch?v=abcdefghijk&list=x) and https://youtu.be/abcdefghijk and <iframe src="https://www.youtube.com/embed/ZZZZZZZZZZZ">')).toEqual(['abcdefghijk', 'ZZZZZZZZZZZ'])
  })
  it('cites like the course: “from 3.4, at 12:40 in the video”', () => {
    expect(citeLabel({ n: '3.4', kind: 'video', at: 760, lessonTitle: 'EDA' })).toBe('from 3.4, at 12:40 in the video')
    expect(citeLabel({ n: '3.6', kind: 'text', section: 'Computing it', lessonTitle: 'Mutual information' })).toBe('from 3.6, “Computing it”')
    expect(citeLabel({ n: '3 homework', kind: 'exercise', section: 'Question 2', lessonTitle: 'Homework' })).toBe('from the module 3 homework, “Question 2”')
    expect(clock(3725)).toBe('1:02:05')
  })
  it('puts the course’s own exercises first, then every lesson in turn', () => {
    const a = textPassages({ ...lesson, markdown: MD, sections })
    const hw = textPassages({ ...lesson, id: 'hw', n: '3 homework', title: 'Homework', markdown: '## Question 1\n\nWhat is the most frequent observation (mode) for the column ocean_proximity in the housing dataset? Compute it with pandas and report the value you get, along with the code you used, before going on to the next question about correlations.', sections: [], homework: true })
    const v = transcriptPassages(lesson, 'abcdefghijk', LINES)
    const picked = pickPassages([a, v, hw], 4)
    expect(picked.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(picked[0].cite.kind).toBe('exercise')
    expect(picked.slice(1).map((p) => p.cite.kind)).toEqual(['text', 'video', 'text'])
  })
})

describe('questions sourced from the course, with citations', () => {
  const passages = pickPassages([textPassages({ ...lesson, markdown: MD, sections }), transcriptPassages(lesson, 'abcdefghijk', LINES)], 6)
  const names = { mi: 'Mutual information and feature importance', lr: 'Logistic regression' }
  it('keeps each question on a passage that exists, and a quote only when it is really there', () => {
    const raw = {
      questions: [
        { p: 'P1', quote: 'how much we learn about one variable by observing another', question: 'Why is mutual information a good fit for a categorical feature like contract type?', answer: 'It works on categories directly.' },
        { p: 'P3', quote: 'a phrase the course never said at all', question: 'Which features does the course find tell us almost nothing about churn, and how?', answer: 'Gender and phone service.' },
        { p: 'P3', question: 'A second question on the same passage', answer: '' },
        { p: 'P42', question: 'On a passage that does not exist', answer: '' }
      ]
    }
    const qs = parseQuiz(raw, passages, names)!
    expect(qs).toHaveLength(2)
    expect(qs[0].cite.quote).toBe('how much we learn about one variable by observing another')
    expect(qs[0].cite.n).toBe('3.6')
    expect(qs[0].concept).toBe('mi')
    expect(qs[1].cite.quote).toBeUndefined()
    expect(qs[1].cite.section).toBe('Computing it with scikit-learn')
    expect(quoted('Mutual information TELLS us how much', MD)).toBe(true)
  })
  it('with no model, asks the course’s own words, answer and all, for you to mark', () => {
    const qs = fallbackQuiz(passages, 3, names)
    expect(qs).toHaveLength(3)
    expect(qs[0].question).toMatch(/^Without looking: what does 3\.6 say about mutual information/)
    expect(qs[0].answer).toMatch(/^The course says: Mutual information tells us/)
    expect(qs.some((q) => q.cite.kind === 'video' && /around \d+:\d\d/.test(q.question))).toBe(true)
  })
  it('reads Opus’s marks: every question gets one, an empty answer is wrong', () => {
    const qs = parseQuiz({ questions: [{ p: 'P1', question: 'Q one about mutual information', answer: 'a' }, { p: 'P3', question: 'Q two about scikit-learn', answer: 'b' }, { p: 'P2', question: 'Q three from the video', answer: 'c' }] }, passages, names)!
    const marks = parseQuizMarks({ marks: [{ q: 'Q1', verdict: 'correct', feedback: 'Yes.' }, { q: 'Q2', verdict: 'partial', feedback: 'Half.' }, { q: 'Q3', verdict: 'correct' }] }, qs, { q1: 'x', q2: 'y', q3: '' })!
    expect(marks.map((m) => m.verdict)).toEqual(['correct', 'partial', 'wrong'])
    expect(quizScore(marks)).toEqual({ score: 1.5, total: 3, passed: false })
    expect(quizScore(marks.slice(0, 2).map(() => ({ verdict: 'correct' as const })).concat([{ verdict: 'wrong' }]))).toMatchObject({ passed: true })
    expect(recallPrompt(qs[2])).toMatch(/\(ML Zoomcamp 3\.6, at \d+:\d\d in the video\)$/)
  })
})

describe('What you know: reading is exposure, answers are mastery', () => {
  it('reading a lesson is a light “taught” on each concept it teaches, never a right answer', () => {
    const e = exposureEvidence(['mi', 'lr'], 'ml-zoomcamp', '03-classification/06-mutual-info.md', 5)
    expect(e.map((x) => [x.concept, x.kind, x.weight])).toEqual([
      ['mi', 'taught', 0.5],
      ['lr', 'taught', 0.5]
    ])
  })
  it('a check’s answers count on their concepts as right, partly or wrong', () => {
    const cite = { course: 'c', courseTitle: 'C', lesson: 'l', n: '1.1', lessonTitle: 'L', kind: 'text' as const, excerpt: '' }
    const e = quizEvidence(
      [
        { id: 'q1', question: 'a', verdict: 'correct', feedback: '', cite, concept: 'mi' },
        { id: 'q2', question: 'b', verdict: 'partial', feedback: '', cite, concept: 'lr' },
        { id: 'q3', question: 'c', verdict: 'wrong', feedback: '', cite }
      ],
      'coursecheck:x',
      9
    )
    expect(e).toEqual([
      { concept: 'mi', kind: 'right', pos: 'q0', source: 'coursecheck:x', at: 9 },
      { concept: 'lr', kind: 'partly', pos: 'q1', source: 'coursecheck:x', at: 9 }
    ])
  })
})

describe('a phase check drawn from the course', () => {
  it('cites a passage only where the model based a concept’s question on one about that concept', () => {
    const passages: Passage[] = pickPassages([textPassages({ ...lesson, topics: ['mi'], markdown: MD, sections }).slice(0, 1)])
    const picked = [{ id: 'lr' }, { id: 'mi' }]
    const questions = [
      { id: 'q1', concept: 'lr', topic: 'Logistic regression', question: 'Q1', answer: '' },
      { id: 'q2', concept: 'mi', topic: 'Mutual information', question: 'Q2', answer: '' }
    ]
    const raw = { questions: [{ concept: 'C1', p: 'P1', quote: 'how much we learn about one variable' }, { concept: 'C2', p: 'P1', quote: 'how much we learn about one variable' }] }
    const out = attachCites(raw, questions, passages, picked)
    expect(out[0].cite).toBeUndefined()
    expect(out[1].cite?.n).toBe('3.6')
    expect(out[1].cite?.quote).toBe('how much we learn about one variable')
  })
})
