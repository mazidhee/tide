/**
 * Writes a planned project's starting files into a new folder and makes it a git repository with a
 * first commit (as you when git knows who you are, else as Tide). Every path stays inside the
 * folder; a folder that already exists is never written into.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { ScaffoldFile } from '@shared/ideaProject'
import { safeRelPath } from '@shared/ideaProject'
import { git } from './git'
import { inside } from './paths'

/** A folder name under the parent that isn't taken: "name", then "name 2", "name 3"… */
export function freeFolder(parent: string, name: string): string {
  let root = join(parent, name)
  for (let i = 2; existsSync(root); i++) root = join(parent, `${name} ${i}`)
  return root
}

export async function writeScaffold(root: string, files: ScaffoldFile[], message: string): Promise<{ written: string[]; commit: boolean }> {
  if (existsSync(root)) throw new Error(`${root} already exists.`)
  mkdirSync(root, { recursive: true })
  const written: string[] = []
  for (const f of files) {
    const rel = safeRelPath(f.path)
    if (!rel) continue
    const abs = inside(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content)
    written.push(rel)
  }
  await git(root, ['init', '-q', '-b', 'main']).catch(() => git(root, ['init', '-q']).catch(() => ''))
  await git(root, ['add', '-A']).catch(() => '')
  let commit = true
  await git(root, ['commit', '-q', '-m', message]).catch(() =>
    git(root, ['-c', 'user.name=Tide', '-c', 'user.email=tide@localhost', 'commit', '-q', '-m', message]).catch(() => {
      commit = false
      return ''
    })
  )
  return { written, commit }
}
