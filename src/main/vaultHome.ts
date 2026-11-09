import { execFile } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { getSettings, updateSettings } from './settings'

/**
 * Follows the notes folder when something moves it (you in Finder, a tidy-up, another app): every
 * few seconds Tide checks it's still there; if not, it looks for a folder of the same name that
 * holds Tide's own .tide folder, and follows it when there's exactly one. Until then nothing is
 * written (vault.ts refuses), so an empty vault is never started in its place.
 */

const isVault = (dir: string) => existsSync(join(dir, '.tide'))

function spotlight(name: string): Promise<string[]> {
  return new Promise((done) => execFile('mdfind', ['-onlyin', homedir(), `kMDItemFSName == '${name.replace(/'/g, "\\'")}'`], { timeout: 10_000 }, (err, out) => done(err ? [] : out.split('\n').filter(Boolean))))
}

/** Folders of that name near where it was, and under Documents, Desktop and iCloud, a few levels down */
async function scan(old: string, name: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, depth: number) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.name === name) found.push(p)
      else if (depth > 0) await walk(p, depth - 1)
    }
  }
  // Where it was first: a tidy-up usually moves it into a folder beside it
  await walk(dirname(old), 3)
  for (const root of ['Documents', 'Desktop', 'Library/Mobile Documents/com~apple~CloudDocs']) await walk(join(homedir(), root), 3)
  return found
}

export async function findMovedVault(old: string): Promise<string[]> {
  const name = basename(old)
  const candidates = [...new Set([...(await spotlight(name)), ...(await scan(old, name))])]
  return candidates.filter((p) => p !== old && isVault(p))
}

let told = ''

export function followVault(onMoved: (path: string) => void, onMissing: (old: string) => void) {
  let checking = false
  const check = async () => {
    const root = getSettings().vaultPath
    if (checking || !root || existsSync(root)) return
    checking = true
    try {
      const found = await findMovedVault(root)
      if (found.length === 1) {
        updateSettings({ vaultPath: found[0] })
        told = ''
        onMoved(found[0])
      } else if (told !== root) {
        told = root
        onMissing(root)
      }
    } finally {
      checking = false
    }
  }
  void check()
  setInterval(() => void check(), 10_000)
}
