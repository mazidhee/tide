import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'tide-user-'))
const vault = mkdtempSync(join(tmpdir(), 'tide-vault-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { updateSettings } = await import('../src/main/settings')
const learn = await import('../src/main/learn')
const { renamePath } = await import('../src/main/vault')

updateSettings({ vaultPath: vault })
mkdirSync(join(vault, 'Payments'))
mkdirSync(join(vault, 'Roadmaps'))
mkdirSync(join(vault, 'Library', 'PDFs'), { recursive: true })
writeFileSync(join(vault, 'Roadmaps', 'Payments.md'), '## Rails\n\n- [ ] ACH\n')
writeFileSync(join(vault, 'Library', 'PDFs', 'Book.pdf'), '%PDF-1.4')

describe('notebook and library records', () => {
  it('lists an empty notebook with its outline and hides an outline-only folder', async () => {
    await learn.updateNotebook('Payments', { outline: 'Roadmaps/Payments.md' })
    const nbs = await learn.getNotebooks()
    expect(nbs.find((n) => n.path === 'Payments')?.outline).toBe('Roadmaps/Payments.md')
    expect(nbs.some((n) => n.path === 'Roadmaps')).toBe(false)
  })

  it('saves subjects without losing concurrent edits', async () => {
    await Promise.all([learn.setLibraryTopics('Library/PDFs/Book.pdf', ['Payments', ' payments ', 'Finance']), learn.updateNotebook('Payments', { description: 'How money moves' })])
    expect(await learn.getLibraryTopics()).toEqual({ 'Library/PDFs/Book.pdf': ['Payments', 'Finance'] })
    const nb = (await learn.getNotebooks()).find((n) => n.path === 'Payments')
    expect(nb?.description).toBe('How money moves')
    expect(nb?.outline).toBe('Roadmaps/Payments.md')
  })

  it('carries notebook settings, outlines, subjects and goals across renames', async () => {
    await learn.saveGoals([{ id: 'g1', name: 'Rails by June', notebook: 'Payments', deadline: '2027-06-01', createdAt: Date.now() }])
    const to = await renamePath('Payments', 'Payment rails')
    await learn.onPathMoved('Payments', to)
    const roadmaps = await renamePath('Roadmaps', 'Plans')
    await learn.onPathMoved('Roadmaps', roadmaps)
    const pdfs = await renamePath('Library/PDFs', 'Books')
    await learn.onPathMoved('Library/PDFs', pdfs)

    const nb = (await learn.getNotebooks()).find((n) => n.path === 'Payment rails')
    expect(nb?.outline).toBe('Plans/Payments.md')
    expect(nb?.description).toBe('How money moves')
    expect(await learn.getLibraryTopics()).toEqual({ 'Library/Books/Book.pdf': ['Payments', 'Finance'] })
    expect((await learn.getGoals())[0].notebook).toBe('Payment rails')
    expect(existsSync(join(vault, 'Plans', 'Payments.md'))).toBe(true)
  })

  it('clears subjects when none are left', async () => {
    await learn.setLibraryTopics('Library/Books/Book.pdf', [])
    expect(await learn.getLibraryTopics()).toEqual({})
  })
})

describe('conversation compaction', () => {
  it('folds older turns into a summary and keeps recent ones word for word', async () => {
    const chats = await import('../src/main/chats')
    const { getSettings } = await import('../src/main/settings')
    updateSettings({ ai: { ...getSettings().ai, contextTokens: 4000 } })
    const long = (i: number) => `message ${i} ` + 'about consistent hashing '.repeat(60)
    await chats.updateChat('long', () => ({
      ...chats.newChat('long', { kind: 'vault' }),
      messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: long(i), at: i }) as const)
    }))
    const before = await chats.getChat('long')
    expect(chats.needsCompaction(before!)).toBe(true)
    let seen = ''
    const ok = await chats.compactChat('long', async (_system, prompt) => {
      seen = prompt
      return 'The student is learning consistent hashing and asked how virtual nodes even out load.'
    })
    expect(ok).toBe(true)
    expect(seen).toContain('message 0')
    expect(seen).not.toContain('message 8')
    const after = await chats.getChat('long')
    expect(after?.summarizedUpTo).toBe(8)
    expect(after?.messages).toHaveLength(12)
    const { summary, messages } = chats.historyFor(after!)
    expect(summary).toMatch(/virtual nodes/)
    expect(messages[0].content.startsWith('message 8') || messages[0].content.includes('left out')).toBe(true)
    expect(messages.at(-1)?.content.startsWith('message 11')).toBe(true)
  })

  it('lists conversations newest first with titles from the first question', async () => {
    const chats = await import('../src/main/chats')
    await chats.updateChat('short', () => ({ ...chats.newChat('short', { kind: 'none' }), updatedAt: Date.now() + 1000, messages: [{ id: 'a', role: 'user', content: 'How does Raft elect a leader when the network splits?', at: 1 }] }))
    await chats.pinChat('long', true)
    const list = await chats.listChats()
    expect(list.map((c) => c.id)).toEqual(['long', 'short'])
    expect(list[1].title).toBe('How does Raft elect a leader when')
    await chats.deleteChat('short')
    expect((await chats.listChats()).map((c) => c.id)).toEqual(['long'])
  })
})

describe('graph for the tutor', () => {
  it('reports links, backlinks and two-step neighbours', async () => {
    const learn = await import('../src/main/learn')
    const { writeFileSync, mkdirSync } = await import('fs')
    mkdirSync(join(vault, 'Maths'), { recursive: true })
    writeFileSync(join(vault, 'Maths', 'Derivatives.md'), '# Derivatives\n\nBuilt on [[Limits]].\n')
    writeFileSync(join(vault, 'Maths', 'Limits.md'), '# Limits\n\nNeeds [[Functions]].\n')
    writeFileSync(join(vault, 'Maths', 'Functions.md'), '# Functions\n')
    writeFileSync(join(vault, 'Maths', 'Integrals.md'), '# Integrals\n\nThe reverse of [[Derivatives]].\n')
    learn.invalidateGraph()
    const r = await learn.relatedNotes('Maths/Derivatives.md')
    expect(r?.linksTo.map((x) => x.title)).toEqual(['Limits'])
    expect(r?.linkedFrom.map((x) => x.title)).toEqual(['Integrals'])
    expect(r?.twoSteps.map((x) => x.title)).toEqual(['Functions'])
    expect(r?.note.level).toBe('new')
  })
})
