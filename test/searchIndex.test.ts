import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it, vi } from 'vitest'
const root = mkdtempSync(join(tmpdir(), 'tide-idx-'))
vi.mock('electron', () => ({ app: { getPath: () => root } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: root, libraryFolder: 'Library', ai: {} }) }))
it('reindexing the same note at once never adds it twice', async () => {
  writeFileSync(join(root, 'a.md'), '# A\n\nSome text about hash maps.\n')
  const { reindexPath, search } = await import('../src/main/search')
  await Promise.all([reindexPath('a.md'), reindexPath('a.md'), reindexPath('a.md')])
  expect(search('hash maps').filter((h) => h.path === 'a.md').length).toBe(1)
})
