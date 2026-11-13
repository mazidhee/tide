import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../src/main/exercises', () => ({ lessonInfo: () => ({ path: 'Work/Secret', private: true }), EXERCISE_TOOLS: [] }))
const dir = mkdtempSync(join(tmpdir(), 'tide-related-'))
vi.mock('electron', () => ({ app: { getPath: () => dir }, BrowserWindow: { getAllWindows: () => [] } }))

const meta = (id: string) => ({ id, importedAt: 1, updatedAt: 1, method: 'git', outline: { lessons: 1, modules: [{ id: 'm', title: 'Module 2', lessons: [{ id: `${id}-l`, path: 'lesson.md', title: 'Deployment', kind: 'reading', words: 900 }] }] } })
vi.mock('../src/main/courses', () => ({
  importedCourse: async (id: string) => (['mlops-zoomcamp', 'made-with-ml'].includes(id) ? meta(id) : null),
  lessonContent: async (id: string) => ({ markdown: id === 'mlops-zoomcamp' ? 'Watch https://www.youtube.com/watch?v=AAAAAAAAAAA' : 'no video', title: 'Deployment' }),
  searchCourses: async () => [
    { course: 'made-with-ml', path: 'lesson.md', title: 'Deployment · Made With ML', heading: 'Serving with Ray', text: 'serving '.repeat(60), score: 9 },
    { course: 'mlops-zoomcamp', path: 'lesson.md', title: 'Deployment · MLOps Zoomcamp', heading: 'Web services', text: 'flask '.repeat(60), score: 8 }
  ]
}))
vi.mock('../src/main/videos', () => ({
  getTranscript: async () => ({ transcript: null, why: 'offline' }),
  clipsFor: async () => [
    { video: 'AAAAAAAAAAA', start: 760, end: 905, title: 'Deploying models', text: 'why we serve behind an API', score: 0.9 },
    { video: 'PPPPPPPPPPP', start: 10, end: 100, title: 'My work recording', text: 'how our team deploys models', score: 0.88, path: 'Work/Secret/video.md' }
  ]
}))

for (const id of ['mlops-zoomcamp', 'made-with-ml']) {
  mkdirSync(join(dir, 'courses', id), { recursive: true })
  writeFileSync(join(dir, 'courses', id, 'course.json'), '{}')
}

const { relatedMaterial } = await import('../src/main/related')

describe('the cross-course search behind related_material', () => {
  it('finds both courses’ material, attributed, and a work project’s video too', async () => {
    const r = await relatedMaterial('model deployment', { limit: 3 })
    expect(r.items.some((i) => i.kind === 'clip' && i.video === 'PPPPPPPPPPP')).toBe(true)
    const clip = r.items.find((i) => i.kind === 'clip')
    expect(clip).toMatchObject({ video: 'AAAAAAAAAAA', course: 'mlops-zoomcamp', courseTitle: 'MLOps Zoomcamp' })
    const reading = r.items.find((i) => i.kind === 'reading')
    expect(reading).toMatchObject({ course: 'made-with-ml', courseTitle: 'Made With ML', heading: 'Serving with Ray' })
    // Courses not imported are offered to suggest, never imported
    expect(r.notImported.every((c) => !['mlops-zoomcamp', 'made-with-ml'].includes(c.id))).toBe(true)
  })

  it('leaves out the course being taught', async () => {
    const r = await relatedMaterial('model deployment', { exclude: 'mlops-zoomcamp' })
    expect(r.items.every((i) => (i.kind === 'reading' ? i.course : i.course) !== 'mlops-zoomcamp')).toBe(true)
    expect(r.items.length).toBeGreaterThan(0)
  })
})

describe('related_material, the MCP tool', () => {
  const ctx = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's1', updateStep: () => {}, web: false, labId: 'lesson-1', chatId: undefined }

  it('teaches from both courses with attribution, in a work project’s lesson too', async () => {
    const { EXTRA_TOOLS } = await import('../src/main/tideMcpTools')
    const tool = EXTRA_TOOLS.find((t) => t.name === 'related_material')!
    const out = await tool.run({ concept: 'model deployment' }, ctx as never)
    expect(out).toContain('READING from Made With ML')
    expect(out).toContain('the MLOps Zoomcamp video at 12:40')
    expect(out).not.toMatch(/private/)
  })
})
