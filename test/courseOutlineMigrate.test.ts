/** A course imported by an older Tide is read again from its copy on this Mac: housekeeping out, progress kept */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => data.dir }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: '/nowhere', ai: {} }) }))
vi.mock('../src/main/search', () => ({ chunkMarkdown: () => [], openChunkIndex: () => ({ paths: async () => [], remove: async () => {}, replace: async () => {}, commit: async () => {}, search: async () => [] }) }))

data.dir = mkdtempSync(join(tmpdir(), 'tide-course-migrate-'))
const repo = join(data.dir, 'courses', 'ml-zoomcamp', 'repo')
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 9}`).join(' ')
mkdirSync(join(repo, '01-intro', 'images'), { recursive: true })
writeFileSync(join(repo, 'README.md'), `# Machine Learning Zoomcamp\n\n${words(200)}`)
writeFileSync(join(repo, '01-intro', 'README.md'), `## 1. Introduction to Machine Learning\n\n- [Intro](01-what-is-ml.md)\n- [Summary](10-summary.md)\n\n${words(70)}`)
writeFileSync(join(repo, '01-intro', '01-what-is-ml.md'), `# Introduction to Machine Learning\n\n${words(300)}`)
writeFileSync(join(repo, '01-intro', '10-summary.md'), `# Summary\n\n${words(100)}`)
writeFileSync(join(repo, '01-intro', 'images', '2026-09-09-provenance-ledger.md'), `# Strict provenance audit\n\n${words(300)}`)
const old = { id: 'ml-zoomcamp', importedAt: 1, updatedAt: 1, method: 'git', outline: { modules: [{ id: 'm1', title: 'Intro', lessons: [{ id: '01-intro/images/2026-09-09-provenance-ledger.md', path: '01-intro/images/2026-09-09-provenance-ledger.md', title: 'Strict provenance audit', kind: 'reading', words: 300 }], code: [] }], lessons: 1 } }
writeFileSync(join(data.dir, 'courses', 'ml-zoomcamp', 'course.json'), JSON.stringify(old))
const progress = { 'ml-zoomcamp': { '01-intro/01-what-is-ml.md': { started: 1, updated: 2, done: false, right: 0, partly: 0, wrong: 0, read: 0.9 } } }
writeFileSync(join(data.dir, 'courses', 'progress.json'), JSON.stringify(progress))

import { courseDetail, OUTLINE_VERSION } from '../src/main/courses'

afterAll(() => rmSync(data.dir, { recursive: true, force: true }))

describe('an outline an older Tide built', () => {
  it('is read again from the copy on this Mac, with progress untouched', async () => {
    const d = await courseDetail('ml-zoomcamp')
    const paths = d!.imported!.outline.modules.flatMap((m) => m.lessons.map((l) => l.path))
    expect(paths).toContain('01-intro/01-what-is-ml.md')
    expect(paths.some((p) => p.includes('provenance'))).toBe(false)
    expect(d!.progress['01-intro/01-what-is-ml.md'].read).toBe(0.9)
    const saved = JSON.parse(readFileSync(join(data.dir, 'courses', 'ml-zoomcamp', 'course.json'), 'utf8'))
    expect(saved.outlineVersion).toBe(OUTLINE_VERSION)
    expect(saved.importedAt).toBe(1)
    expect(JSON.parse(readFileSync(join(data.dir, 'courses', 'progress.json'), 'utf8'))).toEqual(progress)
  })
})
