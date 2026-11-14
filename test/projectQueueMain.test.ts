/**
 * The project queue against a vault (main/modules): the scheduler's project needs are only what's
 * being built (the top of Up next when nothing is), the page's sections, the learner's changes saved
 * in .tide/tracks.json, and a suggested project added as a new file only, checked first.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-pq-')))
const vault = join(base, 'vault')
const userData = join(base, 'ud')
mkdirSync(userData, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [{ path: 'Software Engineering', name: 'Software Engineering', track: 'software-engineering' }], focusLog: async () => [] }))
vi.mock('../src/main/knowledge', () => ({ allConcepts: async () => [] }))
vi.mock('../src/main/northStar', () => ({ GOAL_NOTE: 'Coach/My goal and interests.md' }))
const flags = vi.hoisted(() => ({ claude: false, prompts: [] as string[], reply: '' }))
vi.mock('../src/main/ideaProjects', () => ({
  readPlan: async () => null,
  planRoute: async () => (flags.claude ? { who: 'claude', label: 'Claude' } : { who: 'gemma', label: 'Gemma' }),
  askClaudeForProjects: async (prompt: string) => (flags.prompts.push(prompt), { text: flags.reply, by: 'claude' })
}))
vi.mock('../src/main/ai', () => ({ extractJsonObject: (t: string) => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) }))

const mod = (id: string, requires: string[]) => `---\nmodule: ${id}\ntitle: ${id === 'python-core' ? 'Python Core' : 'Operating Systems'}\ntrack: software-engineering\nrequires: [${requires.join(', ')}]\nlevel: core\nhours: 20\n---\n# ${id}\n\n## 1. Basics — CORE\n### Basics\n- [ ] ${id} one\n- [ ] ${id} two\n`
const proj = (id: string, needs: string[][]) => `---\nproject: ${id}\ntitle: ${id.toUpperCase()}\ntracks: [software-engineering]\nmilestones:\n${needs.map((n, i) => `  - id: m${i + 1}\n    title: ${id} ${i + 1}\n    needs: [${n.join(', ')}]`).join('\n')}\n---\n# ${id.toUpperCase()}\n\nBuild ${id}.\n`

function write(rel: string, text: string) {
  mkdirSync(join(vault, rel, '..'), { recursive: true })
  writeFileSync(join(vault, rel), text)
}

beforeEach(async () => {
  write('Roadmaps/Modules/python-core.md', mod('python-core', []))
  write('Roadmaps/Modules/operating-systems.md', mod('operating-systems', ['python-core']))
  write('Roadmaps/Tracks/software-engineering.md', '---\ntrack: software-engineering\ntitle: Software Engineering\nmodules: [python-core, operating-systems]\n---\n# Software Engineering\n')
  write('Roadmaps/Projects/ledger.md', proj('ledger', [['python-core'], ['operating-systems']]))
  write('Roadmaps/Projects/shell.md', proj('shell', [['python-core']]))
  write('Roadmaps/Projects/kernel.md', proj('kernel', [['operating-systems']]))
  // Python Core passed ("I'm there"); Operating Systems open but not started
  write('.tide/tracks.json', JSON.stringify({ version: 1, tracks: {}, modules: { there: { 'python-core': { at: 1 } } } }))
  ;(await import('../src/main/modules')).resetModules()
})

describe('the queue in the vault', () => {
  it('with nothing being built, only the top of Up next is a scheduler need; then only what is built', async () => {
    const m = await import('../src/main/modules')
    const g = await m.projectsGoal()
    expect(g!.needs.map((n) => n.id)).toEqual(['pj:ledger'])
    const page = await m.queueAction({ kind: 'start', id: 'shell' })
    expect(page.building.map((p) => p.id)).toEqual(['shell'])
    expect(page.upNext.map((p) => p.id)).toEqual(['ledger'])
    expect(page.later.map((p) => p.id)).toEqual(['kernel'])
    expect(page.modules['operating-systems']).toBe('Operating Systems')
    expect(JSON.parse(readFileSync(join(vault, '.tide/tracks.json'), 'utf8')).modules.queue.building).toEqual(['shell'])
    expect((await m.projectsGoal())!.needs.map((n) => n.id)).toEqual(['pj:shell'])
    const after = await m.queueAction({ kind: 'cap', cap: 1 })
    expect(after.cap).toBe(1)
    await expect(m.queueAction({ kind: 'start', id: 'ledger' })).rejects.toThrow(/One is being built/)
  })

  it('adds a suggested project as a new file only, checked by the parser', async () => {
    const m = await import('../src/main/modules')
    const p = { id: 'tiny-db', title: 'Tiny DB', tracks: ['software-engineering'], about: 'A B-tree store.', milestones: [{ id: 'pages', title: 'Pages', needs: ['python-core'] }] }
    expect(await m.addProject(p)).toEqual({ id: 'tiny-db', path: 'Roadmaps/Projects/tiny-db.md' })
    expect(readFileSync(join(vault, 'Roadmaps/Projects/tiny-db.md'), 'utf8')).toMatch(/^---\nproject: tiny-db/)
    await expect(m.addProject(p)).rejects.toThrow(/already in Roadmaps\/Projects/)
    await expect(m.addProject({ ...p, id: 'other', milestones: [{ id: 'x', title: 'X', needs: ['no-such-module'] }] })).rejects.toThrow(/not a module.*no-such-module/)
    expect(existsSync(join(vault, 'Roadmaps/Projects/other.md'))).toBe(false)
  })

  it('suggestions: none without Claude; with it, from the goal note and the catalogue, each checked', async () => {
    const m = await import('../src/main/modules')
    flags.claude = false
    expect(await m.suggestProjects()).toEqual({ available: false, suggestions: [] })
    flags.claude = true
    write('Coach/My goal and interests.md', 'Become a systems engineer.')
    flags.reply = JSON.stringify({ projects: [{ title: 'Job Queue', tracks: ['software-engineering'], about: 'A durable queue.', milestones: [{ title: 'Enqueue', needs: ['python-core'] }] }, { title: 'Bad', milestones: [{ title: 'Magic', needs: ['wizardry'] }] }] })
    const r = await m.suggestProjects('message queues')
    expect(flags.prompts.at(-1)).toMatch(/Become a systems engineer/)
    expect(flags.prompts.at(-1)).toMatch(/message queues/)
    expect(flags.prompts.at(-1)).toMatch(/python-core \| Python Core/)
    expect(r.suggestions.map((s) => [s.id, s.problems.length])).toEqual([['job-queue', 0], ['bad', 1]])
    expect(r.suggestions[0].titles).toEqual({ 'python-core': 'Python Core' })
  })
})
