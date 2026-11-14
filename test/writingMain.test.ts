import { createServer, type Server } from 'http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A scratch notes folder and a scratch "base-k": nothing real is read or written
const vault = mkdtempSync(join(tmpdir(), 'tide-writing-vault-'))
const ext = mkdtempSync(join(tmpdir(), 'tide-writing-ext-'))
mkdirSync(join(ext, 'thoughts'))
mkdirSync(join(vault, 'Coach'), { recursive: true })
const essay = `---
id: on rest
tags:
  - thoughts
date: "2026-10-01"
description: ""
title: on rest
draft: true
---
Rest is not laziness, it is part of the work. i used to think otherwise , now i know what i need.
`
writeFileSync(join(ext, 'thoughts', 'on rest.md'), essay)
writeFileSync(join(ext, 'thoughts', 'older.md'), '---\nid: older\ntags:\n  - thoughts\ndate: "2026-01-01"\ndescription: ""\ntitle: older\ndraft: false\n---\nDone.\n')
writeFileSync(join(vault, 'Coach', 'Writing topics.md'), '---\ntitle: Writing topics\n---\n\n## Personal and philosophical\n\n- [ ] On patience\n- [ ] Rest\n\n## Technical\n\n- [ ] Caches, plainly\n')

const settings = { vaultPath: vault, ai: {}, writing: { folders: [ext], things: true, thingsProject: 'Writing' } }
vi.mock('electron', () => ({ app: { getPath: () => vault, isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/search', () => ({ reindexPath: async () => {} }))
vi.mock('../src/main/connectionUse', () => ({ noteUse: () => {} }))

// A stand-in Things 4: the Writing project's to-dos, and a record of what was completed
const completed: string[] = []
let thingsUp = true
const server: Server = createServer((req, res) => {
  if (!thingsUp) return res.destroy()
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET' && req.url === '/v1/lists/Writing') {
    return res.end(
      JSON.stringify([
        { id: 'h1', type: 'heading', title: 'Essays', status: 'open' },
        { id: 'td1', type: 'to-do', title: 'On patience', notes: 'Why waiting is a skill', status: 'open', heading: { id: 'h1', title: 'Essays' } },
        { id: 'td2', type: 'to-do', title: 'Agents that plan', status: 'open' },
        { id: 'td3', type: 'to-do', title: 'Finished one', status: 'completed' }
      ])
    )
  }
  const m = req.url?.match(/^\/v1\/tasks\/([\w-]+)\/complete$/)
  if (req.method === 'POST' && m) {
    completed.push(m[1])
    return res.end(JSON.stringify({ id: m[1], type: 'to-do', title: 'x', status: 'completed' }))
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'no' }))
})

const W = await import('../src/main/writing')

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  process.env.TIDE_THINGS_API = `http://127.0.0.1:${port}/v1`
})
afterAll(() => {
  server.close()
  delete process.env.TIDE_THINGS_API
})

const piece = join(ext, 'thoughts', 'on rest.md')

describe('pieces', () => {
  it('lists pieces from the writing folders, drafts first', async () => {
    const list = await W.listPieces()
    expect(list.map((p) => p.title)).toEqual(['on rest', 'older'])
    expect(list[0]).toMatchObject({ draft: true, folder: ext.split('/').pop(), kind: 'essay', open: 0 })
  })
  it('refuses files outside the writing folders', async () => {
    await expect(W.openPiece('/etc/hosts')).rejects.toThrow(/writing folders/)
  })
})

describe('a review', () => {
  it('without Claude: the local checker alone, the file untouched, the record in .tide/writing', async () => {
    W.setAsker(async () => null)
    const r = await W.reviewPiece(piece, essay)
    expect(r.by).toBe('tide')
    expect(r.record.comments.map((c) => c.rule)).toEqual(expect.arrayContaining(['comma-splice', 'lowercase-i', 'space-before-punct']))
    expect(readFileSync(piece, 'utf8')).toBe(essay)
    expect(readdirSync(join(vault, '.tide', 'writing', 'pieces'))).toHaveLength(1)
    expect(readFileSync(piece, 'utf8')).not.toContain('comma')
  })
  it('with Claude: its comments anchored next to the checker’s, and the habits line in the profile', async () => {
    W.setAsker(async (job) =>
      job === 'writingReview'
        ? JSON.stringify({ works: ['A sharp opening'], voice: ['The blunt first line'], top: ['a', 'b', 'c'], question: 'Rest for what?', rubric: [], comments: [{ quote: 'part of the work', category: 'argument', severity: 'moderate', what: 'Asserted, not shown.', principle: 'Claims need support.', ask: 'What shows this?' }] })
        : null
    )
    const r = await W.reviewPiece(piece, essay)
    expect(r.by).toBe('claude')
    expect(r.record.comments.filter((c) => c.status === 'open').some((c) => c.by === 'claude' && c.category === 'argument')).toBe(true)
    expect(r.record.runs).toHaveLength(2)
    await new Promise((res) => setTimeout(res, 100))
    await W.updateHabits()
    const profile = readFileSync(join(vault, 'Coach', 'About me as a learner.md'), 'utf8')
    expect(profile).toMatch(/- Writing habits: .*lowercase “i”/)
  })
  it('re-anchors comments when the file was edited outside Tide', async () => {
    writeFileSync(piece, essay.replace('Rest is not', 'Honestly, rest is not'))
    const o = await W.openPiece(piece)
    const c = o.record.comments.find((x) => x.by === 'claude' && x.status === 'open')!
    expect(o.text.slice(c.anchor.start, c.anchor.end)).toBe('part of the work')
  })
  it('"I’ve fixed it": checks the checker’s own comment in code, a reviewer’s with Claude', async () => {
    const o = await W.openPiece(piece)
    const sp = o.record.comments.find((x) => x.rule === 'space-before-punct' && x.status === 'open')!
    const fixedText = o.text.replace('otherwise , now', 'otherwise, now')
    const r1 = await W.recheck(piece, fixedText, sp.id)
    expect(r1.fixed).toBe(true)
    W.setAsker(async (job) => (job === 'writingRecheck' ? '{"fixed": false, "note": "Still asserted."}' : null))
    const arg = o.record.comments.find((x) => x.category === 'argument' && x.status === 'open')!
    const r2 = await W.recheck(piece, fixedText, arg.id)
    expect(r2).toMatchObject({ fixed: false, note: 'Still asserted.' })
    expect(r2.record.comments.find((x) => x.id === arg.id)?.status).toBe('open')
  })
  it('saves only through the editor, comments beside it in Tide’s data', async () => {
    await W.savePiece(piece, essay + '\nA new line.\n')
    expect(readFileSync(piece, 'utf8')).toContain('A new line.')
  })
})

describe('topics', () => {
  it('reads Things 4’s Writing project and the topics note, without repeats, and caches it', async () => {
    const t = await W.topics({ refresh: true })
    expect(t.topics.map((x) => x.title)).toEqual(['On patience', 'Agents that plan', 'Rest', 'Caches, plainly'])
    expect(t.topics[0]).toMatchObject({ note: 'Why waiting is a skill', group: 'Essays', thingsId: 'td1' })
    expect(t.thingsNote).toBeUndefined()
    expect(existsSync(join(vault, '.tide', 'writing', 'topics.json'))).toBe(true)
  })
  it('falls back to the cache when Things 4 isn’t running, and says so', async () => {
    thingsUp = false
    const t = await W.topics({ refresh: true })
    thingsUp = true
    expect(t.topics.map((x) => x.title)).toContain('Agents that plan')
    expect(t.thingsNote).toMatch(/Things 4/)
  })
  it('starts a draft: a new file shaped like its neighbours, never over an existing one; ticks the note', async () => {
    const t = await W.topics()
    const rest = t.topics.find((x) => x.title === 'Rest')!
    writeFileSync(join(ext, 'thoughts', 'Rest.md'), 'mine, keep me')
    const p = await W.startDraft(rest, ext)
    expect(p).toBe(join(ext, 'thoughts', 'Rest 2.md'))
    expect(readFileSync(join(ext, 'thoughts', 'Rest.md'), 'utf8')).toBe('mine, keep me')
    expect(readFileSync(p, 'utf8')).toMatch(/^---\nid: Rest\ntags:\n {2}- thoughts\ndate: "\d{4}-\d\d-\d\d"\ndescription: ""\ntitle: Rest\ndraft: true\n---\n/)
    expect(readFileSync(join(vault, 'Coach', 'Writing topics.md'), 'utf8')).toContain('- [x] Rest')
    expect((await W.topics()).topics.find((x) => x.title === 'Rest')?.done).toBe(true)
  })
  it('a draft from a Things to-do is linked; Things is only ticked when asked, after publishing', async () => {
    const t = await W.topics()
    const p = await W.startDraft(t.topics.find((x) => x.thingsId === 'td2')!, vault)
    expect(p).toBe(join(vault, 'Writing', 'Agents that plan.md'))
    expect(completed).toEqual([])
    const pub = await W.setPublished(p, true)
    expect(pub.thingsId).toBe('td2')
    expect(completed).toEqual([])
    await W.tickInThings(p)
    expect(completed).toEqual(['td2'])
    expect((await W.listPieces()).find((x) => x.path === p)).toMatchObject({ draft: false, folder: 'Tide' })
  })
})
