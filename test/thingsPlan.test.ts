import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A scratch vault and a fake Things 4: nothing here touches the real app
const home = mkdtempSync(join(tmpdir(), 'tide-home-'))
const vault = mkdtempSync(join(tmpdir(), 'tide-vault-'))
mkdirSync(join(home, 'Library', 'Application Support', 'Things4'), { recursive: true })
writeFileSync(join(home, 'Library', 'Application Support', 'Things4', 'api.json'), JSON.stringify({ url: 'http://things.test/v1', token: 't' }))
vi.mock('os', async (orig) => ({ ...(await orig<typeof import('os')>()), homedir: () => home }))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { planToThings, syncFromThings } = await import('../src/main/planner')
const { shortDate } = await import('../src/shared/plan')

const ROADMAP = `---
plan_start: 2026-11-09
plan_hours: 6
plan_weeks: [1, 2]
---

## Phase 1: Basics — 9 Nov to 15 Nov

### Setup
- [ ] Install Metabase
- [ ] Connect a database
    - _Metabase docs_
- [ ] Project: A first dashboard
- [ ] Exam: Basics (by 15 Nov)

## Phase 2: Modelling — 16 Nov to 29 Nov

### Models
- [ ] Create models
- [ ] Exam: Modelling (by 29 Nov)
`

afterEach(() => vi.unstubAllGlobals())

describe('plans in Things 4', () => {
  it('sends a phase per heading, chapters with their topics, and dated projects and exams', async () => {
    mkdirSync(join(vault, 'Metabase'), { recursive: true })
    writeFileSync(join(vault, 'Metabase', 'Plan.md'), ROADMAP)
    let sent: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/projects') && init.method === 'POST') {
        sent = JSON.parse(init.body as string)
        return new Response(JSON.stringify([{ id: 'P1', type: 'project', title: 'Learn Metabase', status: 'open' }]), { status: 201 })
      }
      return new Response('{"error":"not found"}', { status: 404 })
    })
    const r = await planToThings('Metabase/Plan.md', 'Metabase')
    expect(r.project).toBe('P1')
    const todos = (sent as unknown as { 'to-dos': Record<string, unknown>[] })['to-dos']
    expect(todos[0]).toEqual({ type: 'heading', title: `Phase 1: Basics (${shortDate('2026-11-09')} to ${shortDate('2026-11-15')})` })
    expect(todos[1]).toMatchObject({ title: 'Setup', 'checklist-items': ['Install Metabase', 'Connect a database'], when: '2026-11-09', deadline: '2026-11-15' })
    expect(todos[2]).toMatchObject({ title: 'Project: A first dashboard', deadline: '2026-11-15' })
    expect(todos[3]).toMatchObject({ title: 'Exam: Basics (by 15 Nov)', when: '2026-11-15' })
    expect((sent as unknown as { deadline: string }).deadline).toBe('2026-11-29')
    expect(readFileSync(join(vault, 'Metabase', 'Plan.md'), 'utf8')).toContain('things_project: P1')
  })

  it('ticks topics finished in Things, and never unticks', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/health')) return new Response('{"ok":true}')
      return new Response(
        JSON.stringify({
          id: 'P1',
          type: 'project',
          title: 'Learn Metabase',
          status: 'open',
          'to-dos': [
            { id: 'a', type: 'to-do', title: 'Setup', status: 'open', checklist: [{ id: 'c1', title: 'Install Metabase', completed: true }, { id: 'c2', title: 'Connect a database', completed: false }] },
            { id: 'b', type: 'to-do', title: 'Exam: Basics (by 15 Nov)', status: 'completed' }
          ]
        })
      )
    })
    const n = await syncFromThings('Metabase/Plan.md')
    const md = readFileSync(join(vault, 'Metabase', 'Plan.md'), 'utf8')
    expect(n).toBe(2)
    expect(md).toContain('- [x] Install Metabase')
    expect(md).toContain('- [ ] Connect a database')
    expect(md).toContain('- [x] Exam: Basics (by 15 Nov)')
  })
})
