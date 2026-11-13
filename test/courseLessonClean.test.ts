/**
 * A course lesson as Tide reads it (main/courses): cleaned of its noise for the reader, for the
 * tutor that teaches from it (courseLessonSource) and for saving to notes, with what was hidden
 * kept beside it so "Show original" loses nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { data } = vi.hoisted(() => ({ data: { dir: '' } }))
vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => data.dir }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: '/nowhere', ai: {} }) }))

data.dir = mkdtempSync(join(tmpdir(), 'tide-course-clean-'))
const repo = join(data.dir, 'courses', 'ml-zoomcamp', 'repo')
const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures', 'pageClean', f), 'utf8')
mkdirSync(join(repo, '01-intro'), { recursive: true })
writeFileSync(join(repo, '01-intro', 'README.md'), fixture('zoomcamp-module.md'))
writeFileSync(join(repo, '01-intro', '01-what-is-ml.md'), fixture('zoomcamp-lesson.md'))
const lessons = [
  { id: '01-intro/README.md', path: '01-intro/README.md', title: 'Introduction', kind: 'reading', words: 120 },
  { id: '01-intro/01-what-is-ml.md', path: '01-intro/01-what-is-ml.md', title: 'What machine learning is', kind: 'reading', words: 400 }
]
writeFileSync(join(data.dir, 'courses', 'ml-zoomcamp', 'course.json'), JSON.stringify({ id: 'ml-zoomcamp', importedAt: 1, updatedAt: 1, method: 'git', outline: { modules: [{ id: '01-intro', title: 'Introduction', lessons, code: [] }], lessons: 2 } }))

import { courseLessonSource, lessonContent } from '../src/main/courses'

afterAll(() => rmSync(data.dir, { recursive: true, force: true }))

describe('a course lesson, read cleaned', () => {
  it('reads without the community notes, and keeps them beside it for "Show original"', async () => {
    const l = await lessonContent('ml-zoomcamp', '01-intro/README.md')
    expect(l!.markdown).toContain('1.1 [What machine learning is]')
    expect(l!.markdown).not.toContain('Community notes')
    expect(l!.cleaning!.hidden).toEqual([{ kind: 'community', what: 'community notes' }])
    expect(l!.cleaning!.segments.map((s) => s.text).join('')).toContain('Add your notes here')
  })

  it('the tutor is taught from the cleaned lesson', async () => {
    const src = await courseLessonSource('ml-zoomcamp', '01-intro/README.md')
    expect(src!.candidate.text).not.toContain('Did you take notes?')
    expect(src!.candidate.text).toContain('Setting up the environment')
    expect(src!.sections.map((s) => s.title).join(' ')).not.toMatch(/Community notes/i)
  })

  it('a lesson with nothing to hide comes as it is, with no cleaning attached', async () => {
    const l = await lessonContent('ml-zoomcamp', '01-intro/01-what-is-ml.md')
    expect(l!.cleaning).toBeUndefined()
    expect(l!.markdown).toContain("df = pd.read_csv('cars.csv')")
  })
})
