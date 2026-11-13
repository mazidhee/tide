/**
 * The switch to modules on a vault on disk (main/modules), with the real knowledge map (the Rust
 * store: FSRS state replayed from evidence) and the real learning log (SQLite): everything learnt
 * moves to its new home and nothing is lost, a full backup comes first, the old roadmaps stay as
 * they were, running it again changes nothing, and Switch back restores it, keeping what was
 * learnt in between. Also: a vault without modules, or not switched, works exactly as before.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MODULE_FILES, MOVES, OLD_MATH, OLD_SWE, TRACK_FILES } from './fixtures/modules'

const { data } = vi.hoisted(() => ({ data: { dir: '', vault: '' } }))

vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: data.vault, libraryFolder: 'Library', ai: {} }) }))

import { roadmapTopics } from '../src/shared/curriculum'
import { moduleTopics, parseModule } from '../src/shared/modules'

const OLD_CPP = `# C++

## 1. The language core — CORE

- [ ] Pointer arithmetic
`

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 1, 9)

const SWE = (t: string) => roadmapTopics('Software Engineering', OLD_SWE).find((x) => x.title.includes(t))!.id
const MATH = (t: string) => roadmapTopics('Mathematics', OLD_MATH).find((x) => x.title.includes(t))!.id
const NEW = (file: string, t: string) => moduleTopics(parseModule(file, MODULE_FILES[file])!).find((x) => x.title.includes(t))!.id
const F = 'Roadmaps/Modules/computation-foundations.md'
const OS = 'Roadmaps/Modules/operating-systems.md'

const ev = (source: string, pos: string, kind: string, at: number, extra: Record<string, unknown> = {}) => ({ source, pos, kind, at, weight: 1, ...extra })

function concept(id: string, name: string, area: string, evidence: unknown[], extra: Record<string, unknown> = {}) {
  return { id, name, area, section: null, origin: 'roadmap', order: 0, prerequisites: [], evidence, ...extra }
}

function write(rel: string, text: string) {
  const p = join(data.vault, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}
const read = (rel: string) => readFileSync(join(data.vault, rel), 'utf8')

function hashTree(dir: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const rel = relative(dir, p)
      if (skip(rel)) continue
      if (statSync(p).isDirectory()) walk(p)
      else out[rel] = createHash('sha1').update(readFileSync(p)).digest('hex')
    }
  }
  walk(dir)
  return out
}

/** Every piece of evidence, as source and position, from a knowledge file */
const evidenceKeys = (file: { concepts: { evidence?: { source: string; pos: string }[] }[] }) =>
  file.concepts
    .flatMap((c) => (c.evidence ?? []).map((e) => `${e.source}#${e.pos}`))
    .sort()

function makeVault() {
  data.dir = mkdtempSync(join(tmpdir(), 'tide-modules-'))
  data.vault = join(data.dir, 'vault')
  write('Roadmaps/RM_SWE.md', OLD_SWE)
  write('Roadmaps/RM_MATH.md', OLD_MATH)
  write('Roadmaps/RM_CPP.md', OLD_CPP)
  write('Software Engineering/My notes.md', '# Notes\n')
  mkdirSync(join(data.vault, 'Mathematics'), { recursive: true })
  mkdirSync(join(data.vault, 'C++'), { recursive: true })
  write('.tide/notebooks.json', JSON.stringify({ 'Software Engineering': { outline: 'Roadmaps/RM_SWE.md', color: '#41355e' }, Mathematics: { outline: 'Roadmaps/RM_MATH.md' }, 'C++': { outline: 'Roadmaps/RM_CPP.md' } }, null, 1))
  const binary = SWE('Binary')
  write(
    '.tide/knowledge.json',
    JSON.stringify(
      {
        version: 2,
        model: 'fsrs-6',
        concepts: [
          concept(binary, 'Binary, hexadecimal, number representations', 'Software Engineering', [ev('attempt:1', '0', 'right', T0), ev('lesson:bin-1', 'taught', 'taught', T0 + DAY, { weight: 0.6 }), ev('lesson:bin-1', 'q0', 'wrong', T0 + DAY), ev('recall:r1', '1', 'recalled-right', T0 + 3 * DAY, { supersedes: 'lesson:bin-1#q0' }), ev('recall:r1', '2', 'recalled-right', T0 + 10 * DAY)]),
          concept(`${binary}##converting between binary and hex`, 'Converting between binary and hex', 'Software Engineering', [ev('lesson:bin-1', 'step:1', 'right', T0 + DAY)], { origin: 'step', parent: binary }),
          concept(SWE('Boolean'), 'Boolean algebra and logic gates', 'Software Engineering', [ev('lesson:bool-1', 'q0', 'right', T0 + 2 * DAY)]),
          concept(MATH('Boolean'), 'Boolean algebra and logic gates', 'Mathematics', [ev('lesson:bool-2', 'q0', 'partly', T0 + 4 * DAY), ev('lesson:bool-2', 'q1', 'right', T0 + 4 * DAY)]),
          concept(SWE('Processes'), 'Processes and threads', 'Software Engineering', [ev('lesson:proc-1', 'q0', 'right', T0 + 5 * DAY)]),
          // Somewhere nobody placed: its progress must stay
          concept(SWE('Something nobody'), 'Something nobody placed', 'Software Engineering', [ev('lesson:lost-1', 'q0', 'right', T0 + 6 * DAY)])
        ]
      },
      null,
      2
    )
  )
  write('.tide/placement.json', JSON.stringify({ topics: { [SWE('Generators')]: { state: 'known', at: T0 } }, sections: {} }))
  write('.tide/lessons/bin-1.json', JSON.stringify({ id: 'bin-1', topic: 'Binary, hexadecimal, number representations', options: { check: { concept: binary } } }, null, 1))
  write('.tide/coach/week-2026-10-01.json', JSON.stringify({ weekStart: '2026-10-01', days: [{ date: '2026-10-01', items: [{ kind: 'learn', title: 'Scheduling', topicId: SWE('Scheduling'), notebook: 'Software Engineering' }] }] }, null, 2))
  write('.tide/tracks.json', JSON.stringify({ version: 1, tracks: { 'Software Engineering': { phases: { 'software engineering::operating systems': { checks: [{ at: T0, by: 'claude', score: 2, total: 2, passed: true, marks: [] }] } }, log: [] } } }, null, 1))
  write('.tide/goals.json', JSON.stringify({ version: 1, goals: [{ id: 'g1', title: 'Get going', weight: 'main', createdAt: T0, needs: [{ id: 'n1', kind: 'roadmap', ref: 'C++', label: 'C++ basics', hours: 20 }] }], standing: {}, migrated: true }, null, 1))
  for (const [p, md] of Object.entries(MODULE_FILES)) write(p, md)
  for (const [p, md] of Object.entries(TRACK_FILES)) write(p, md)
  write('Roadmaps/_moves.json', JSON.stringify({ ...MOVES, 'RM_CPP#Pointer arithmetic': 'c-language' }, null, 1))
}

beforeAll(() => makeVault())
afterAll(() => rmSync(data.dir, { recursive: true, force: true }))

describe('the switch to modules', () => {
  let before: Record<string, { stability?: number | null; status: string; right: number; seen: number }> = {}
  let roadmapsBefore: Record<string, string> = {}
  let tideBefore: Record<string, string> = {}

  it('the preview counts what moves, and nothing is written', async () => {
    const lg = await import('../src/main/learningLog')
    lg.logEvents([{ key: `ev:lesson:bin-1#q0@${SWE('Binary')}`, at: T0 + DAY, kind: 'answered', source: 'lesson', concepts: [SWE('Binary')], skills: [], topic: 'Binary', outcome: 'wrong', lesson: 'bin-1' } as never])
    lg.setTargets([{ node: SWE('Binary'), depth: 4, goal: 'north-star', by: 'northstar' }])
    lg.saveLinks([{ from: SWE('Binary'), to: SWE('Boolean'), kind: 'used_in', origin: 'claude' }])
    lg.setMeta('links.asked', JSON.stringify([SWE('Binary')]))
    lg.close()
    const k = await import('../src/main/knowledge')
    for (const c of await k.allConcepts()) if (c.evidence !== undefined || c.seen) before[c.id] = { stability: c.stability, status: c.status, right: c.right, seen: c.seen }
    for (const c of await k.allConcepts()) before[c.id] = { stability: c.stability, status: c.status, right: c.right, seen: c.seen }
    k.resetKnowledge()
    roadmapsBefore = hashTree(join(data.vault, 'Roadmaps'), (r) => r.startsWith('Modules') || r.startsWith('Tracks') || r.startsWith('_'))
    tideBefore = hashTree(join(data.vault, '.tide'))
    const m = await import('../src/main/modules')
    const p = await m.switchPreview()
    expect(p.switched).toBe(false)
    expect(p.modules).toBe(5)
    expect(p.topics).toMatchObject({ dropped: 1, unplaced: 1 })
    expect(p.topics.placed).toBe(10)
    // Four with answers, and one a placement check found known
    expect(p.progress.concepts).toBe(5)
    expect(p.progress.ticks).toBe(1)
    expect(p.progress.links).toBe(1)
    expect(p.progress.placement).toBe(1)
    expect(p.progress.events).toBe(1)
    expect(p.progress.targets).toBe(1)
    expect(p.notebooks.map((n) => n.name).sort()).toEqual(['C++', 'Mathematics', 'Software Engineering'])
    expect(p.notebooks.find((n) => n.name === 'Software Engineering')!.to).toBe('Software Engineering')
    // The C++ folder is left with nothing: offered for removal, never removed by the switch
    expect(p.emptyFolders).toEqual(['C++'])
    expect(p.orphans).toEqual([{ title: 'Something nobody placed', notebook: 'Software Engineering' }])
    expect(hashTree(join(data.vault, '.tide'))).toEqual(tideBefore)
  })

  it('moves every concept, its evidence (so its FSRS state), ticks, links, placement, events, targets and checks, after a full backup', async () => {
    const m = await import('../src/main/modules')
    const r = await m.switchToModules({ now: T0 + 20 * DAY })
    expect(r.ok).toBe(true)
    // The backup: all of .tide as it was, and the module files as they were
    expect(existsSync(join(data.vault, r.backup))).toBe(true)
    expect(r.backup).toMatch(/^\.tide\/backups\/pre-modules-/)
    const backed = hashTree(join(data.vault, r.backup, '.tide'))
    for (const [f, h] of Object.entries(tideBefore)) expect(backed[f], f).toBe(h)
    expect(readFileSync(join(data.vault, r.backup, F), 'utf8')).toBe(MODULE_FILES[F])
    // The old roadmaps: untouched
    expect(hashTree(join(data.vault, 'Roadmaps'), (x) => x.startsWith('Modules') || x.startsWith('Tracks') || x.startsWith('_'))).toEqual(roadmapsBefore)

    const before0 = JSON.parse(readFileSync(join(data.vault, r.backup, '.tide/knowledge.json'), 'utf8'))
    const after = JSON.parse(read('.tide/knowledge.json'))
    // Lossless: every piece of evidence is still there, once (a placement result names its new topic)
    const placed = (k: string) => k.replace(SWE('Generators'), NEW('Roadmaps/Modules/python-core.md', 'Generators'))
    expect(evidenceKeys(after)).toEqual(evidenceKeys(before0).map(placed).sort())
    const binary = NEW(F, 'Binary')
    const got = after.concepts.find((c: { id: string }) => c.id === binary)
    // A shared module counts under the first track that lists it
    expect(got.area).toBe('Mathematics')
    expect(got.evidence).toHaveLength(5)
    expect(after.concepts.find((c: { id: string }) => c.id === `${binary}##converting between binary and hex`).parent).toBe(binary)
    // Boolean algebra was in two roadmaps and is one topic now: both histories, merged
    expect(after.concepts.find((c: { id: string }) => c.id === NEW(F, 'Boolean')).evidence.map((e: { source: string }) => e.source).sort()).toEqual(['lesson:bool-1', 'lesson:bool-2', 'lesson:bool-2'])
    expect(after.concepts.some((c: { id: string }) => c.id === SWE('Boolean') || c.id === MATH('Boolean'))).toBe(false)
    // An item with no home keeps its progress where it was
    expect(after.concepts.find((c: { id: string }) => c.id === SWE('Something nobody')).evidence).toHaveLength(1)

    // The knowledge map's state, replayed by the Rust store: the same as before for what moved alone
    const k = await import('../src/main/knowledge')
    const now = new Map((await k.allConcepts()).map((c) => [c.id, c]))
    const b = before[SWE('Binary')]
    expect(now.get(binary)).toMatchObject({ stability: b.stability, status: b.status, right: b.right, seen: b.seen })
    expect(now.get(NEW(OS, 'Processes'))).toMatchObject({ stability: before[SWE('Processes')].stability, right: 1 })
    expect(now.get(NEW(F, 'Boolean'))!.seen).toBe(3)
    expect(now.get(NEW(F, 'Boolean'))!.right).toBe(2)

    // Ticks and lesson links carried into the module file, nothing else on the line changed
    const fmd = read(F)
    expect(fmd).toContain('- [x] [[Binary, hexadecimal, number representations|Binary, hexadecimal, number representations]]')
    expect(fmd).toContain('- [ ] Boolean algebra and logic gates — _Nisan and Schocken_')
    // Placement, a lesson's link to its topic, a planned item, the phase check
    expect(Object.keys(JSON.parse(read('.tide/placement.json')).topics)).toEqual([NEW('Roadmaps/Modules/python-core.md', 'Generators')])
    expect(JSON.parse(read('.tide/lessons/bin-1.json')).options.check.concept).toBe(binary)
    expect(JSON.parse(read('.tide/coach/week-2026-10-01.json')).days[0].items[0].topicId).toBe(NEW(OS, 'Scheduling'))
    const tracks = JSON.parse(read('.tide/tracks.json'))
    expect(tracks.tracks['module:operating-systems'].phases['operating systems::processes and threads'].checks[0].passed).toBe(true)
    expect(tracks.tracks['Software Engineering']).toBeDefined()
    // The learning log: the event (key, body, node), the depth target, the link, the links asked
    const lg = await import('../src/main/learningLog')
    lg.close()
    expect(lg.readEvents({ node: binary }).map((e) => e.key)).toEqual([`ev:lesson:bin-1#q0@${binary}`])
    expect(lg.readTargets().map((t) => t.node)).toEqual([binary])
    expect(lg.readLinks().map((l) => [l.from, l.to])).toEqual([[binary, NEW(F, 'Boolean')]])
    expect(JSON.parse(lg.getMeta('links.asked')!)).toEqual([binary])
    lg.close()
    // Notebooks: the tracks take over; C++ stops using its roadmap; nothing is removed
    const nbs = JSON.parse(read('.tide/notebooks.json'))
    expect(nbs['Software Engineering']).toEqual({ color: '#41355e', track: 'software-engineering' })
    expect(nbs.Mathematics).toEqual({ track: 'mathematics' })
    expect(nbs['C++']).toEqual({})
    expect(existsSync(join(data.vault, 'C++'))).toBe(true)
    // A goal that needed the C++ roadmap now needs the module its topics went to
    expect(JSON.parse(read('.tide/goals.json')).goals[0].needs[0]).toMatchObject({ ref: 'Software Engineering', sections: ['C'] })
  })

  it('the tracks are notebooks; a shared module shows in both, with one progress', async () => {
    const { getNotebooks } = await import('../src/main/learn')
    const nbs = await getNotebooks()
    const se = nbs.find((n) => n.name === 'Software Engineering')!
    const ma = nbs.find((n) => n.name === 'Mathematics')!
    expect(se.track).toBe('software-engineering')
    expect(se.outline).toBeUndefined()
    const m = await import('../src/main/modules')
    const a = await m.trackView('Software Engineering')
    const b = await m.trackView('Mathematics')
    expect(a!.modules.map((x) => x.id)).toEqual(['computation-foundations', 'c-language', 'python-core', 'operating-systems'])
    const fa = a!.modules.find((x) => x.id === 'computation-foundations')!
    const fb = b!.modules.find((x) => x.id === 'computation-foundations')!
    expect(fa).toMatchObject({ status: 'active', shared: ['Mathematics'] })
    expect({ solid: fb.solid, shaky: fb.shaky, total: fb.total }).toEqual({ solid: fa.solid, shaky: fa.shaky, total: fa.total })
    expect(a!.modules.find((x) => x.id === 'operating-systems')).toMatchObject({ status: 'locked', requires: [{ id: 'c-language', title: 'C', passed: false }, { id: 'computation-foundations', title: 'Computation Foundations', passed: false }] })
    // Topics come from the modules, and the locked ones are held back
    const topics = await m.notebookTopics(se)
    expect(topics.filter((t) => t.module === 'computation-foundations').map((t) => t.id)).toEqual((await m.notebookTopics(ma)).filter((t) => t.module === 'computation-foundations').map((t) => t.id))
    const { heldTopics } = await import('../src/main/track')
    const held = await heldTopics()
    expect(held.has(NEW(OS, 'Processes'))).toBe(true)
    expect(held.has(NEW(F, 'Boolean'))).toBe(false)
    // "I'm there" opens what requires it
    await m.setThere('computation-foundations', true)
    await m.setThere('c-language', true)
    const c = await m.trackView('Software Engineering')
    expect(c!.modules.find((x) => x.id === 'operating-systems')!.status).not.toBe('locked')
    await m.setThere('c-language', false)
  })

  it('running it again changes nothing', async () => {
    const m = await import('../src/main/modules')
    const k = await import('../src/main/knowledge')
    k.resetKnowledge()
    const mid = hashTree(data.vault, (r) => r.startsWith('.tide/backups') || r === '.tide/learning.db')
    const again = await m.switchToModules()
    expect(again.already).toBe(true)
    expect(hashTree(data.vault, (r) => r.startsWith('.tide/backups') || r === '.tide/learning.db')).toEqual(mid)
    // And the rewrite itself is idempotent: the plan applied to its own result is a no-op
    const { idMapper, migrateKnowledge, planMoves, homesOf } = await import('../src/shared/moduleMigration')
    const cat = (await m.loadCatalogue(true))!
    const plan = planMoves([{ file: 'Roadmaps/RM_SWE.md', notebook: 'Software Engineering', md: OLD_SWE }, { file: 'Roadmaps/RM_MATH.md', notebook: 'Mathematics', md: OLD_MATH }], MOVES, cat)
    const file = JSON.parse(read('.tide/knowledge.json'))
    const r = migrateKnowledge(file, idMapper(plan), homesOf(cat))
    expect(r.moved).toBe(0)
    expect(r.file).toEqual(file)
  })

  it('removes only the empty folders you confirm', async () => {
    const m = await import('../src/main/modules')
    write('Software Engineering/keep.md', 'x')
    const done = await m.removeEmptyFolders(['C++', 'Software Engineering', 'Library'])
    expect(done).toEqual(['C++'])
    expect(existsSync(join(data.vault, 'C++'))).toBe(false)
    expect(existsSync(join(data.vault, 'Software Engineering/keep.md'))).toBe(true)
  })

  it('switch back restores the backup, and keeps what was learnt since, moved back onto the old topics', async () => {
    const k = await import('../src/main/knowledge')
    // A lesson after the switch, on the new topic
    await k.noteReviewAnswer({ concept: NEW(F, 'Binary'), source: 'review:after', pos: 'q0', kind: 'right', at: T0 + 25 * DAY })
    const lg = await import('../src/main/learningLog')
    lg.logEvents([{ key: `ev:review:after#q0@${NEW(F, 'Binary')}`, at: T0 + 25 * DAY, kind: 'recalled', source: 'review', concepts: [NEW(F, 'Binary')], skills: [], topic: 'Binary' } as never])
    lg.close()
    const m = await import('../src/main/modules')
    const state = await m.readState()
    const backup = state.switched!.backup
    const r = await m.switchBack()
    expect(r.ok).toBe(true)
    expect(r.kept).toBeGreaterThanOrEqual(2)
    const kf = JSON.parse(read('.tide/knowledge.json'))
    const orig = JSON.parse(readFileSync(join(data.vault, backup, '.tide/knowledge.json'), 'utf8'))
    // Everything that was there, plus the new answer on the old topic
    expect(evidenceKeys(kf)).toEqual([...evidenceKeys(orig), 'review:after#q0'].sort())
    expect(kf.concepts.find((c: { id: string }) => c.id === SWE('Binary')).evidence.some((e: { source: string }) => e.source === 'review:after')).toBe(true)
    // Untouched since the switch: back byte for byte
    expect(read('.tide/placement.json')).toBe(readFileSync(join(data.vault, backup, '.tide/placement.json'), 'utf8'))
    expect(read('.tide/lessons/bin-1.json')).toBe(readFileSync(join(data.vault, backup, '.tide/lessons/bin-1.json'), 'utf8'))
    expect(read(F)).toBe(MODULE_FILES[F])
    // The notebooks have their roadmaps again; the removed folder is back; the log has the new event on the old topic
    const nbs = JSON.parse(read('.tide/notebooks.json'))
    expect(nbs['Software Engineering']).toEqual({ color: '#41355e', outline: 'Roadmaps/RM_SWE.md' })
    expect(nbs['C++']).toEqual({ outline: 'Roadmaps/RM_CPP.md' })
    expect(existsSync(join(data.vault, 'C++'))).toBe(true)
    lg.close()
    expect(lg.readEvents({ node: SWE('Binary') }).map((e) => e.key).sort()).toEqual([`ev:lesson:bin-1#q0@${SWE('Binary')}`, `ev:review:after#q0@${SWE('Binary')}`])
    lg.close()
    expect((await m.readState()).switched).toBeUndefined()
    // The roadmap path again
    const { getNotebooks } = await import('../src/main/learn')
    expect((await getNotebooks()).find((n) => n.name === 'Software Engineering')!.outline).toBe('Roadmaps/RM_SWE.md')
    // And switching again works (the same moves, from the restored state)
    k.resetKnowledge()
    const again = await m.switchToModules({ now: T0 + 30 * DAY })
    expect(again.ok && !again.already).toBe(true)
    const kk = JSON.parse(read('.tide/knowledge.json'))
    expect(kk.concepts.find((c: { id: string }) => c.id === NEW(F, 'Binary')).evidence.some((e: { source: string }) => e.source === 'review:after')).toBe(true)
  })
})

describe('a vault without modules, or not switched', () => {
  it('reads its roadmaps exactly as before', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tide-nomod-'))
    const prev = data.vault
    data.vault = join(dir, 'vault')
    try {
      write('Roadmaps/RM_SWE.md', OLD_SWE)
      mkdirSync(join(data.vault, 'Software Engineering'), { recursive: true })
      write('.tide/notebooks.json', JSON.stringify({ 'Software Engineering': { outline: 'Roadmaps/RM_SWE.md' } }))
      const m = await import('../src/main/modules')
      m.resetModules()
      const { getNotebooks } = await import('../src/main/learn')
      const nb = (await getNotebooks()).find((n) => n.name === 'Software Engineering')!
      expect(nb.outline).toBe('Roadmaps/RM_SWE.md')
      expect(nb.track).toBeUndefined()
      expect(await m.loadCatalogue(true)).toBeNull()
      expect(await m.notebookTopics(nb)).toEqual(roadmapTopics('Software Engineering', OLD_SWE))
      expect(await m.openTopics(nb)).toEqual(roadmapTopics('Software Engineering', OLD_SWE))
      const status = await m.modulesStatus()
      expect(status).toMatchObject({ available: false, switched: false })
      // Modules in the vault but no switch: still the roadmap
      for (const [p, md] of Object.entries(MODULE_FILES)) write(p, md)
      for (const [p, md] of Object.entries(TRACK_FILES)) write(p, md)
      m.resetModules()
      const nb2 = (await getNotebooks()).find((n) => n.name === 'Software Engineering')!
      expect(nb2.outline).toBe('Roadmaps/RM_SWE.md')
      expect(await m.notebookTopics(nb2)).toEqual(roadmapTopics('Software Engineering', OLD_SWE))
      expect((await m.modulesStatus()).available).toBe(true)
    } finally {
      data.vault = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
