import { describe, expect, it } from 'vitest'
import { appendBlock, courseNotesPath, lessonNotes, lessonSection, momentLink, newCourseNotes, quoteFor, withLessonNotes } from '@shared/courseNotes'

const a = { id: '01-intro/01-what-is-ml.md', title: 'Introduction to Machine Learning', url: 'https://github.com/x/y/blob/main/01-intro/01-what-is-ml.md' }
const b = { id: '01-intro/10-summary.md', title: 'Summary' }
const c = { id: '02-regression/16-summary.md', title: 'Summary' }

describe('a course’s notes, a heading per lesson', () => {
  it('lives in the course’s folder in the vault', () => {
    expect(courseNotesPath('Machine Learning Zoomcamp')).toBe('Courses/Machine Learning Zoomcamp/Course notes.md')
    expect(courseNotesPath('A/B: tests?')).toBe('Courses/A B tests/Course notes.md')
  })
  it('makes a lesson’s heading the first time you write, and edits only that lesson after', () => {
    let doc = newCourseNotes({ title: 'ML Zoomcamp', by: 'DataTalksClub' })
    expect(withLessonNotes(doc, a, '  ')).toBe(doc)
    doc = withLessonNotes(doc, a, 'Models learn from data.')
    doc = withLessonNotes(doc, b, 'Summary of module 1')
    doc = withLessonNotes(doc, c, 'Summary of module 2')
    expect(doc).toContain('## [Introduction to Machine Learning](https://github.com/x/y/blob/main/01-intro/01-what-is-ml.md) <!-- lesson: 01-intro/01-what-is-ml.md -->')
    // Two lessons called Summary never mix
    expect(lessonNotes(doc, b.id)).toBe('Summary of module 1')
    expect(lessonNotes(doc, c.id)).toBe('Summary of module 2')
    const edited = withLessonNotes(doc, a, 'Models learn from data.\n\n- features\n- target')
    expect(lessonNotes(edited, a.id)).toBe('Models learn from data.\n\n- features\n- target')
    expect(lessonNotes(edited, b.id)).toBe('Summary of module 1')
    expect(edited.startsWith('---\ncourse: "ML Zoomcamp"')).toBe(true)
    // Headings of your own inside a lesson's notes stay its own, ## ones too
    const sub = withLessonNotes(edited, b, '## Key ideas\n\nOne\n\n### More')
    expect(lessonNotes(sub, b.id)).toBe('## Key ideas\n\nOne\n\n### More')
    expect(lessonNotes(withLessonNotes(sub, b, '## Key ideas\n\nTwo'), b.id)).toBe('## Key ideas\n\nTwo')
    expect(lessonNotes(sub, c.id)).toBe('Summary of module 2')
    expect(lessonSection(sub, 'nope')).toBeNull()
  })
  it('quotes a passage with its source, and links a video’s moment', () => {
    expect(quoteFor('Line one\n\n\nLine two\n', { label: 'Intro § The problem', url: 'https://x/y#the-problem' })).toBe('> Line one\n>\n> Line two\n> — [Intro § The problem](https://x/y#the-problem)\n')
    expect(momentLink('dQw4w9WgXcQ', 760.4)).toBe('[12:40](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=760s)')
    expect(appendBlock('', '> q\n')).toBe('> q\n')
    expect(appendBlock('mine\n\n', '> q')).toBe('mine\n\n> q\n')
  })
})
