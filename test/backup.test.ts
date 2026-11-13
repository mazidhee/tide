/**
 * Backups of Tide's own data (shared/backup, main/backup), in scratch folders only: what goes in
 * and what is left out, the names, which snapshots are kept, and a restore that keeps a safety
 * snapshot first and makes each place match the snapshot.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'tide-backup-'))
vi.mock('electron', () => ({ app: { getPath: () => join(root, 'unused-app'), getVersion: () => '9.9.9', on: () => {} }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, shell: {} }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: null, ai: {} }) }))

const B = await import('../src/shared/backup')
const M = await import('../src/main/backup')

const put = (path: string, text: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function scratch(name: string) {
  const base = join(root, name)
  const vault = join(base, 'vault')
  const app = join(base, 'app')
  const folder = join(app, 'Backups')
  // The vault's .tide: what Tide keeps, and its caches
  put(join(vault, '.tide/lessons/l1.json'), '{"id":"l1"}')
  put(join(vault, '.tide/knowledge.json'), '{"concepts":[]}')
  put(join(vault, '.tide/workout.json'), '{"rating":1200}')
  put(join(vault, '.tide/learner/changes.jsonl'), '{}\n')
  put(join(vault, '.tide/reading/marks.json'), '{}')
  put(join(vault, '.tide/pdftext/abc.json'), 'x'.repeat(5000))
  put(join(vault, '.tide/epubtext/b.json'), 'x')
  put(join(vault, '.tide/thumbs/c.jpg'), 'x')
  put(join(vault, 'Notes/a note.md'), 'not Tide’s: never in a backup')
  // Tide's app data: settings, profile, usage, mocks; Electron's folders, models and caches
  put(join(app, 'settings.json'), '{"theme":"dark"}')
  put(join(app, 'profile.json'), '{"name":"Ada"}')
  put(join(app, 'profile-photo.jpg'), Buffer.from([1, 2, 3]))
  put(join(app, 'claude-usage.jsonl'), '{}\n')
  put(join(app, 'usage.jsonl'), '{}\n')
  put(join(app, 'courses/progress.json'), '{}')
  put(join(app, 'courses/index/seg.bin'), 'x')
  put(join(app, 'courses/ml-zoomcamp/files/big.ipynb'), 'x')
  put(join(app, 'ide/tags.json'), '{}')
  put(join(app, 'ide/cache/x'), 'x')
  for (const d of ['Cache/data_0', 'Code Cache/js/1', 'GPUCache/d', 'DawnGraphiteCache/d', 'Local Storage/leveldb/1.ldb', 'voice/kokoro.onnx', 'python/bin/python', 'searxng/x', 'search/seg', 'reading-audio/a.mp3']) put(join(app, d), 'x')
  put(join(app, 'model-server.log'), 'log')
  put(join(folder, 'old-notes.txt'), 'not a snapshot')
  return { vault, app, folder, roots: { vault, app, folder } }
}

const namesIn = async (file: string) => (await M.readSnapshot(file)).entries.map((e) => e.name).sort()

describe('what a backup holds', () => {
  it('takes the vault’s .tide and Tide’s app data, and leaves out caches, models and Electron’s folders', async () => {
    const s = scratch('contents')
    const snap = await M.makeBackup('manual', s.roots, new Date(2026, 10, 13, 9, 30).getTime())
    expect(snap).toMatchObject({ name: 'tide-2026-11-13-093000-manual.tar.gz', kind: 'manual' })
    expect(snap.bytes).toBeGreaterThan(0)
    const names = await namesIn(join(s.folder, snap.name))
    expect(names).toEqual([
      'app/claude-usage.jsonl',
      'app/courses/progress.json',
      'app/ide/tags.json',
      'app/profile-photo.jpg',
      'app/profile.json',
      'app/settings.json',
      'app/usage.jsonl',
      'vault/.tide/knowledge.json',
      'vault/.tide/learner/changes.jsonl',
      'vault/.tide/lessons/l1.json',
      'vault/.tide/reading/marks.json',
      'vault/.tide/workout.json'
    ])
    const { manifest, entries } = await M.readSnapshot(join(s.folder, snap.name))
    expect(manifest).toMatchObject({ v: 1, kind: 'manual', app: '9.9.9', vault: s.vault, files: 12 })
    expect(entries.find((e) => e.name === 'app/profile-photo.jpg')!.data).toEqual(Buffer.from([1, 2, 3]))
  })

  it('writes a real tar.gz, long and non-ASCII names included', async () => {
    const s = scratch('names')
    const long = `lessons/${'a very long lesson name '.repeat(8)}— Bayes’ theorem.json`
    put(join(s.vault, '.tide', long), '{"ok":true}')
    const snap = await M.makeBackup('manual', s.roots)
    const raw = gunzipSync(readFileSync(join(s.folder, snap.name)))
    expect(raw.subarray(257, 262).toString()).toBe('ustar')
    const e = (await M.readSnapshot(join(s.folder, snap.name))).entries.find((x) => x.name === `vault/.tide/${long}`)
    expect(e?.data.toString()).toBe('{"ok":true}')
  })

  it('never backs up its own backups, wherever the folder is', () => {
    expect(B.keepAppFile('Backups/tide-2026-11-13-0930-daily.tar.gz')).toBe(false)
    expect(B.keepVaultFile('pdftext/a.json')).toBe(false)
    expect(B.keepVaultFile('mocks/history.json')).toBe(true)
    expect(B.keepAppFile('model-server.log')).toBe(false)
    expect(B.keepAppFile('windows.json')).toBe(true)
  })
})

describe('names and which are kept', () => {
  const at = (y: number, m: number, d: number, h = 2) => new Date(y, m - 1, d, h).getTime()
  const snap = (t: number, kind: import('../src/shared/backup').BackupKind = 'daily') => ({ name: B.snapshotName(t, kind), kind, at: t, bytes: 1 })

  it('reads its own names back, and nothing else', () => {
    const t = new Date(2026, 10, 13, 2, 5, 9).getTime()
    expect(B.snapshotName(t, 'daily')).toBe('tide-2026-11-13-020509-daily.tar.gz')
    expect(B.parseSnapshotName('tide-2026-11-13-020509-daily.tar.gz')).toEqual({ kind: 'daily', at: t })
    expect(B.parseSnapshotName('old-notes.txt')).toBeNull()
    expect(B.parseSnapshotName('tide-2026-11-13-020509-daily.tar.gz.part')).toBeNull()
  })

  it('keeps the last 14 days and 8 weeks before them, one each, and the last 3 safety snapshots', () => {
    // A snapshot every day for 120 days, two on some days, and five safety snapshots
    const all = []
    for (let i = 0; i < 120; i++) all.push(snap(at(2026, 11, 13) - i * 86_400_000))
    all.push(snap(at(2026, 11, 13, 18), 'manual'), snap(at(2026, 11, 12, 23), 'quit'))
    for (let i = 0; i < 5; i++) all.push(snap(at(2026, 11, 1) + i * 3600_000, 'safety'))
    const gone = new Set(B.snapshotsToDelete(all).map((s) => s.name))
    const kept = all.filter((s) => !gone.has(s.name))
    const ordinary = kept.filter((s) => s.kind !== 'safety').sort((a, b) => b.at - a.at)
    expect(ordinary).toHaveLength(14 + 8)
    // The newest of a day stays: the evening's manual one, not the 2am nightly
    expect(ordinary[0].kind).toBe('manual')
    expect(ordinary[1].kind).toBe('quit')
    // The 8 older ones are a week apart
    const weekly = ordinary.slice(14)
    // (the first may sit in the week the daily ones reach into, so it can be closer)
    expect(Math.round((weekly[0].at - weekly[1].at) / 86_400_000)).toBeLessThanOrEqual(7)
    for (let i = 2; i < weekly.length; i++) expect(Math.round((weekly[i - 1].at - weekly[i].at) / 86_400_000)).toBe(7)
    const safety = kept.filter((s) => s.kind === 'safety').map((s) => s.at)
    expect(safety.sort()).toEqual(all.filter((s) => s.kind === 'safety').map((s) => s.at).sort().slice(-3))
  })

  it('rotates on disc after each backup', async () => {
    const s = scratch('rotate')
    for (let i = 0; i < 20; i++) await M.makeBackup('daily', s.roots, at(2026, 11, 13) - i * 86_400_000)
    const left = await M.listSnapshots(s.folder)
    // The 14 newest days, and the older six days' weeks (one or two)
    expect(left.length).toBeGreaterThanOrEqual(15)
    expect(left.length).toBeLessThanOrEqual(16)
    for (let i = 0; i < 14; i++) expect(left.some((x) => x.at === at(2026, 11, 13) - i * 86_400_000)).toBe(true)
    expect(existsSync(join(s.folder, 'old-notes.txt'))).toBe(true)
  })

  it('is due each night once, and on quit after a day', () => {
    const now = at(2026, 11, 13, 9)
    expect(B.nightlyDue(null, now)).toBe(true)
    expect(B.nightlyDue(at(2026, 11, 12, 22), now)).toBe(true)
    expect(B.nightlyDue(at(2026, 11, 13, 2), now)).toBe(false)
    expect(B.nightlyDue(at(2026, 11, 12, 22), at(2026, 11, 13, 1))).toBe(false)
    expect(B.quitDue(now - 25 * 3600_000, now)).toBe(true)
    expect(B.quitDue(now - 3 * 3600_000, now)).toBe(false)
    expect(B.newestBackup([snap(now, 'safety'), snap(now - 1000)])?.kind).toBe('daily')
  })
})

describe('restoring', () => {
  it('keeps a safety snapshot of now, then makes .tide and the app data match the snapshot', async () => {
    const s = scratch('restore')
    const first = await M.makeBackup('manual', s.roots, new Date(2026, 10, 10, 9).getTime())
    // Life goes on: a setting changes, a lesson is added, a file is lost; caches change too
    put(join(s.app, 'settings.json'), '{"theme":"light"}')
    put(join(s.vault, '.tide/lessons/l2.json'), '{"id":"l2"}')
    put(join(s.vault, '.tide/pdftext/new.json'), 'cache')
    put(join(s.app, 'Cache/data_1'), 'chromium')
    const r = await M.restoreSnapshot(first.name, s.roots)
    expect(r.files).toBe(12)
    expect(r.safety.kind).toBe('safety')
    // The safety snapshot holds how things were just before
    const safety = await M.readSnapshot(join(s.folder, r.safety.name))
    expect(safety.entries.find((e) => e.name === 'app/settings.json')!.data.toString()).toBe('{"theme":"light"}')
    expect(safety.entries.some((e) => e.name === 'vault/.tide/lessons/l2.json')).toBe(true)
    // Now as the snapshot was
    expect(readFileSync(join(s.app, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(existsSync(join(s.vault, '.tide/lessons/l2.json'))).toBe(false)
    expect(readFileSync(join(s.vault, '.tide/lessons/l1.json'), 'utf8')).toBe('{"id":"l1"}')
    // Caches, notes and Electron's folders untouched
    expect(existsSync(join(s.vault, '.tide/pdftext/new.json'))).toBe(true)
    expect(existsSync(join(s.app, 'Cache/data_1'))).toBe(true)
    expect(existsSync(join(s.vault, 'Notes/a note.md'))).toBe(true)
    expect(existsSync(join(s.app, 'voice/kokoro.onnx'))).toBe(true)
    // And the safety snapshot can undo it
    await M.restoreSnapshot(r.safety.name, s.roots)
    expect(readFileSync(join(s.app, 'settings.json'), 'utf8')).toBe('{"theme":"light"}')
    expect(existsSync(join(s.vault, '.tide/lessons/l2.json'))).toBe(true)
  })

  it('touches nothing for a name that isn’t a snapshot, or a damaged one', async () => {
    const s = scratch('refuse')
    await expect(M.restoreSnapshot('../settings.json', s.roots)).rejects.toThrow(/isn’t one of Tide’s snapshots/)
    put(join(s.folder, 'tide-2026-11-01-020000-daily.tar.gz'), 'not gzip')
    await expect(M.restoreSnapshot('tide-2026-11-01-020000-daily.tar.gz', s.roots)).rejects.toThrow()
    expect((await M.listSnapshots(s.folder)).some((x) => x.kind === 'safety')).toBe(false)
    expect(readFileSync(join(s.app, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('never writes outside the place a file belongs', async () => {
    const s = scratch('escape')
    const entry = (name: string, body: string) => {
      const h = Buffer.alloc(512)
      h.write(name, 0)
      h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
      h.write('0', 156)
      return Buffer.concat([h, Buffer.from(body.padEnd(512, '\0'))])
    }
    const tar = Buffer.concat([entry('app/../../escape.txt', 'evil'), entry('vault/.tide/../outside.md', 'evil'), entry('app/settings.json', '{"theme":"sepia"}'), Buffer.alloc(1024)])
    expect(M.readTar(tar).map((e) => e.name)).toEqual(['app/../../escape.txt', 'vault/.tide/../outside.md', 'app/settings.json'])
    put(join(s.folder, 'tide-2026-11-02-020000-daily.tar.gz'), gzipSync(tar))
    await M.restoreSnapshot('tide-2026-11-02-020000-daily.tar.gz', s.roots)
    expect(existsSync(join(s.app, '..', '..', 'escape.txt'))).toBe(false)
    expect(existsSync(join(s.vault, 'outside.md'))).toBe(false)
    expect(readFileSync(join(s.app, 'settings.json'), 'utf8')).toBe('{"theme":"sepia"}')
  })
})
