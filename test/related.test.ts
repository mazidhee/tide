import { describe, expect, it } from 'vitest'
import { attribution, pickRelated, readingsIn, relatedForPrompt, relatedTag, sectionOf, suggestionsIn, type RelatedClip, type RelatedReading } from '../src/shared/related'

const reading = (course: string, courseTitle: string, score: number, heading = 'Docker'): RelatedReading => ({ kind: 'reading', course, courseTitle, by: 'Someone', path: `${course}/lesson.md`, lessonTitle: 'Lesson', heading, text: 'text '.repeat(60), score, licence: 'MIT' })
const clip = (video: string, score: number, course?: string, courseTitle?: string): RelatedClip => ({ kind: 'clip', video, start: 760, end: 905, title: 'Lecture', ...(course ? { course, courseTitle } : {}), text: 'what is said', score })

describe('lessons that draw on several courses', () => {
  it('brings in at most three, one reading and one clip per course at most, leaving out the course being taught', () => {
    const r = pickRelated([reading('mwml', 'Made With ML', 9), reading('mwml', 'Made With ML', 8), reading('ossu', 'OSSU', 7), reading('zoom', 'MLOps Zoomcamp', 10)], [clip('aaaaaaaaaaa', 0.9, 'zoom', 'MLOps Zoomcamp'), clip('bbbbbbbbbbb', 0.8)], { exclude: 'zoom', limit: 5 })
    expect(r.length).toBe(3)
    expect(r.some((i) => i.kind === 'reading' && i.course === 'zoom')).toBe(false)
    expect(r.some((i) => i.kind === 'clip' && i.course === 'zoom')).toBe(false)
    const keys = r.map((i) => `${i.kind}:${i.kind === 'reading' ? i.course : (i.course ?? i.video)}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(r.filter((i) => i.kind === 'reading' && i.course === 'mwml').length).toBe(1)
  })

  it('prefers a reading and a clip over two readings when both are close', () => {
    const r = pickRelated([reading('mwml', 'Made With ML', 10), reading('ossu', 'OSSU', 9.5)], [clip('aaaaaaaaaaa', 0.9, 'zoom', 'MLOps Zoomcamp')], { limit: 2 })
    expect(r.map((i) => i.kind).sort()).toEqual(['clip', 'reading'])
  })

  it('leaves out what barely matches, and gives nothing when nothing does', () => {
    expect(pickRelated([reading('a', 'A', 10), reading('b', 'B', 1)], [], { limit: 3 }).length).toBe(1)
    expect(pickRelated([], [], {})).toEqual([])
  })

  it('names each source the way the tutor says it', () => {
    expect(attribution(reading('mwml', 'Made With ML', 1, 'Serving'))).toBe('Made With ML\'s reading “Serving”')
    expect(attribution(clip('aaaaaaaaaaa', 1, 'zoom', 'MLOps Zoomcamp'))).toBe('the MLOps Zoomcamp video at 12:40')
    expect(attribution(clip('aaaaaaaaaaa', 1))).toBe('“Lecture” at 12:40')
  })

  it('tells the tutor how to show and name each, and the rules: integrate, at most two or three, nothing auto-imported', () => {
    const text = relatedForPrompt({ topic: 'docker', items: [reading('mwml', 'Made With ML', 1), clip('aaaaaaaaaaa', 1, 'zoom', 'MLOps Zoomcamp')], notImported: [{ id: 'de-zoomcamp', title: 'Data Engineering Zoomcamp', by: 'DataTalksClub' }] })
    expect(text).toContain('<reading course="mwml" path="mwml/lesson.md" heading="Docker">')
    expect(text).toContain('<clip video="aaaaaaaaaaa" start="12:40" end="15:05">')
    expect(text).toContain('the MLOps Zoomcamp video at 12:40')
    expect(text).toContain('<suggest-course id="ID">')
    expect(text).toMatch(/never import anything yourself/i)
    expect(text).toMatch(/At most two or three/)
    expect(relatedForPrompt({ topic: 'x', items: [], notImported: [] })).toMatch(/Teach it yourself/)
  })

  it('reads the tags back, and finds a section by its heading', () => {
    const reply = `Made With ML shows the code:\n${relatedTag(reading('mwml', 'Made With ML', 1))}\n<suggest-course id="de-zoomcamp">for the pipelines</suggest-course>\n<reading course="x" path="../../etc/passwd">no</reading>`
    expect(readingsIn(reply)).toEqual([expect.objectContaining({ course: 'mwml', path: 'mwml/lesson.md', heading: 'Docker' })])
    expect(suggestionsIn(reply)).toEqual([expect.objectContaining({ id: 'de-zoomcamp', why: 'for the pipelines' })])
    const md = '# A\nintro\n## Docker\nimages\n```\n# not a heading\n```\n### Layers\ncache\n## Compose\nyaml'
    expect(sectionOf(md, 'docker')).toBe('## Docker\nimages\n```\n# not a heading\n```\n### Layers\ncache')
    expect(sectionOf(md, 'nowhere')).toBe(md)
  })
})
