import { describe, expect, it } from 'vitest'
import { CATALOGUE, type CatalogueCourse } from '@shared/courses'
import { NO_FILTER, SUBJECTS, browse, counts, matches, shelves, sourceGroupOf, subjectsOf, type ShelfCourse } from '@shared/courseShelf'

const base: CatalogueCourse = { id: 'x', repo: 'a/b', title: 'X', by: 'Someone', area: 'cs', licence: 'MIT', tier: 'open', covers: 'Things', kind: 'course', level: 'beginner', topics: [] }
const course = (o: Partial<ShelfCourse>): ShelfCourse => ({ ...base, ...o })

describe('course shelves', () => {
  const cards: ShelfCourse[] = [
    course({ id: 'a', title: 'Alpha', imported: { importedAt: 1, updatedAt: 1, lessons: 10, done: 3, lastStudied: 500 } }),
    course({ id: 'b', title: 'Beta', imported: { importedAt: 2, updatedAt: 2, lessons: 10, done: 0 } }),
    course({ id: 'c', title: 'Gamma', imported: { importedAt: 3, updatedAt: 3, lessons: 4, done: 4, lastStudied: 900 } }),
    course({ id: 'd', title: 'Delta', suggested: { at: 100, why: 'new', score: 1, by: 'score' } }),
    course({ id: 'e', title: 'Epsilon', suggested: { at: 200, why: 'newer', score: 1, by: 'claude' } }),
    // Imported after being suggested: it is under way, not new
    course({ id: 'f', title: 'Zeta', suggested: { at: 300, why: 'x', score: 1, by: 'score' }, imported: { importedAt: 600, updatedAt: 600, lessons: 5, done: 1 } }),
    course({ id: 'g', title: 'Eta' })
  ]

  it('splits courses under way, finished and newly found, each in its own order', () => {
    const s = shelves(cards)
    // Most recently studied (or imported) first
    expect(s.continuing.map((c) => c.id)).toEqual(['f', 'a', 'b'])
    expect(s.finished.map((c) => c.id)).toEqual(['c'])
    expect(s.suggested.map((c) => c.id)).toEqual(['e', 'd'])
  })
})

describe('browsing the catalogue', () => {
  it('puts every shipped course under at least one of your subjects', () => {
    for (const c of CATALOGUE) expect(subjectsOf(c).length).toBeGreaterThan(0)
    const n = counts(CATALOGUE)
    for (const s of ['payments', 'blockchain', 'quant', 'econ', 'ml', 'data', 'datasci', 'cs'] as const) expect(n.subjects[s]).toBeGreaterThan(0)
  })

  it('files courses by subject, a course in more than one where it belongs', () => {
    expect(subjectsOf(course({ area: 'payments' }))).toEqual(['payments'])
    expect(subjectsOf(course({ area: 'dl' }))).toEqual(['ml'])
    expect(subjectsOf(course({ area: 'ml', topics: ['pandas', 'data visualization'] }))).toEqual(['ml', 'datasci'])
    expect(subjectsOf(course({ area: 'maths', topics: ['probability'] }))).toEqual(['datasci'])
    expect(subjectsOf(course({ area: 'systems' }))).toEqual(['cs'])
    expect(subjectsOf(course({ area: 'physics' }))).toEqual(['other'])
  })

  it('names where each course comes from', () => {
    expect(sourceGroupOf(course({}))).toBe('github')
    expect(sourceGroupOf(course({ source: 'ocw', repo: undefined, url: 'https://ocw.mit.edu/x' }))).toBe('ocw')
    expect(sourceGroupOf(course({ source: 'yale', repo: undefined }))).toBe('yale')
    expect(sourceGroupOf(course({ source: 'youtube', repo: undefined, playlist: 'PL1' }))).toBe('lectures')
    expect(sourceGroupOf(course({ source: 'docs', repo: undefined, kind: 'guide' }))).toBe('guides')
    expect(sourceGroupOf(course({ source: 'site', repo: undefined, kind: 'book' }))).toBe('books')
    expect(sourceGroupOf(course({ kind: 'book' }))).toBe('books')
    expect(sourceGroupOf(course({ source: 'jupyterbook', repo: 'QuantEcon/lecture-python-intro', by: 'QuantEcon' }))).toBe('quantecon')
    // Every shipped QuantEcon course is found as QuantEcon
    expect(CATALOGUE.filter((c) => /quantecon/i.test(c.id)).every((c) => sourceGroupOf(c) === 'quantecon')).toBe(true)
  })

  it('filters by subject, source, format, level and words in any order', () => {
    const quant = course({ id: 'q', title: 'Options pricing', area: 'quant', source: 'ocw', repo: undefined, level: 'advanced', covers: 'Black–Scholes and hedging' })
    expect(matches(quant, { ...NO_FILTER, subject: 'quant' })).toBe(true)
    expect(matches(quant, { ...NO_FILTER, subject: 'payments' })).toBe(false)
    expect(matches(quant, { ...NO_FILTER, source: 'ocw' })).toBe(true)
    expect(matches(quant, { ...NO_FILTER, source: 'github' })).toBe(false)
    expect(matches(quant, { ...NO_FILTER, level: 'beginner' })).toBe(false)
    expect(matches(quant, { ...NO_FILTER, query: 'hedging options' })).toBe(true)
    expect(matches(quant, { ...NO_FILTER, query: 'hedging swaps' })).toBe(false)
    expect(matches(course({ media: 'video' }), { ...NO_FILTER, media: 'text' })).toBe(false)
    expect(matches(course({ media: 'mixed' }), { ...NO_FILTER, media: 'video' })).toBe(true)
  })

  it('groups by subject in your order, new finds first in each, or lists everything sorted', () => {
    const list = [
      course({ id: '1', title: 'B advanced', area: 'payments', level: 'advanced' }),
      course({ id: '2', title: 'A beginner', area: 'payments', level: 'beginner' }),
      course({ id: '3', title: 'Found', area: 'payments', level: 'advanced', suggested: { at: 5, why: '', score: 1, by: 'score' } }),
      course({ id: '4', title: 'Chain', area: 'blockchain' })
    ]
    const groups = browse(list, NO_FILTER)
    expect(groups.map((g) => g.id)).toEqual(['payments', 'blockchain'])
    expect(groups[0].courses.map((c) => c.id)).toEqual(['3', '2', '1'])
    expect(browse(list, { ...NO_FILTER, subject: 'blockchain' }).map((g) => g.courses.map((c) => c.id))).toEqual([['4']])
    expect(browse(list, { ...NO_FILTER, sort: 'title' })[0].courses.map((c) => c.title)).toEqual(['A beginner', 'B advanced', 'Chain', 'Found'])
    expect(browse(list, { ...NO_FILTER, sort: 'level' })[0].courses.map((c) => c.id)).toEqual(['2', '4', '1', '3'])
    expect(browse(list, { ...NO_FILTER, sort: 'newest' })[0].courses[0].id).toBe('3')
    expect(browse(list, { ...NO_FILTER, query: 'nothing like this' })).toEqual([])
  })

  it('lists the subjects in the order they are studied', () => {
    expect(SUBJECTS.map((s) => s.id).slice(0, 4)).toEqual(['payments', 'blockchain', 'quant', 'econ'])
  })
})
