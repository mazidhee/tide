import { describe, expect, it } from 'vitest'
import type { CourseOutline } from '@shared/courses'
import { coursePlace, glyphFor, subjectShelves, timeLeft, type ShelfCourse } from '@shared/courseShelf'

const lesson = (id: string, words = 2000) => ({ id, path: id, title: `Lesson ${id}`, kind: 'reading' as const, words })
const outline: CourseOutline = {
  lessons: 5,
  modules: [
    { id: 'm1', title: 'Introduction', code: [], lessons: [lesson('a'), lesson('b')] },
    { id: 'm2', title: 'Classification', code: [], lessons: [lesson('c', 6000), lesson('d', 12000), lesson('e', 6000)] },
    { id: 'm3', title: 'Empty', code: [], lessons: [] }
  ]
}

const course = (id: string, area: ShelfCourse['area'], extra: Partial<ShelfCourse> = {}): ShelfCourse =>
  ({ id, title: id, by: 'x', area, level: 'beginner', kind: 'course', covers: '', topics: [], tier: 'open', licence: 'MIT', ...extra }) as ShelfCourse

describe('the course you are in', () => {
  it('names its module, the time left in it and the next lesson', () => {
    const p = coursePlace(outline, { a: { done: true }, b: { done: true }, c: { done: true } } as never)!
    expect(p).toMatchObject({ module: 2, modules: 2, moduleTitle: 'Classification', next: { id: 'd', title: 'Lesson d' } })
    expect(p.minutesLeft).toBe(90)
    expect(timeLeft(p.minutesLeft)).toBe('about 1.5 h')
    expect(timeLeft(12)).toBe('about 10 min')
  })

  it('starts at the first lesson of the first module', () => {
    expect(coursePlace(outline, undefined)).toMatchObject({ module: 1, moduleTitle: 'Introduction', next: { id: 'a' } })
  })
})

describe('shelves by subject', () => {
  it('puts the subjects of courses under way first and leaves out started courses', () => {
    const cards = [
      course('cs1', 'cs'),
      course('q1', 'quant', { imported: { importedAt: 1, updatedAt: 1, lessons: 10, done: 2 } }),
      course('q2', 'quant'),
      course('p1', 'payments')
    ]
    const shelves = subjectShelves(cards)
    expect(shelves.map((s) => s.id)).toEqual(['quant', 'payments', 'cs'])
    expect(shelves[0].courses.map((c) => c.id)).toEqual(['q2'])
    expect(shelves[0].total).toBe(2)
  })

  it('gives a course the same glyph every time', () => {
    const c = course('ml-zoomcamp', 'ml')
    expect(glyphFor(c)).toBe(glyphFor(c))
  })
})
