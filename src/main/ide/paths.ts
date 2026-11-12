/**
 * Paths inside a workspace. Everything the window or Claude names is a POSIX path relative to the
 * workspace's root, and must stay inside it: no "..", no absolute paths, and (for writes) no
 * symbolic link that leads out.
 */
import { realpathSync } from 'fs'
import { isAbsolute, join, normalize, relative, sep } from 'path'

/** Folders that are never listed, searched or copied: tools' output and dependencies */
export const IGNORED_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'target', '.next', '.turbo', '.cache', '.tox', 'DerivedData', '.DS_Store'])

/** A relative path made safe: forward slashes, no leading slash, nothing that climbs out */
export function cleanRel(rel: string): string {
  const s = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!s) return ''
  const parts: string[] = []
  for (const p of s.split('/')) {
    if (!p || p === '.') continue
    if (p === '..') throw new Error(`${rel} is outside the project`)
    parts.push(p)
  }
  return parts.join('/')
}

/** The absolute path of `rel` inside `root`; throws when it would leave the root */
export function inside(root: string, rel: string): string {
  if (isAbsolute(rel)) {
    const r = relative(root, normalize(rel))
    if (r.startsWith('..') || isAbsolute(r)) throw new Error(`${rel} is outside the project`)
    rel = r
  }
  const clean = cleanRel(rel)
  const abs = clean ? join(root, ...clean.split('/')) : root
  const back = relative(root, abs)
  if (back.startsWith('..') || isAbsolute(back)) throw new Error(`${rel} is outside the project`)
  return abs
}

/**
 * As inside(), and the real path (links followed, for the part that exists) stays inside the
 * root's real path too: a link in the project to ~/.ssh can't be written through.
 */
export function insideReal(root: string, rel: string): string {
  const abs = inside(root, rel)
  const realRoot = safeReal(root)
  // The longest part of the path that exists, resolved
  let probe = abs
  let rest = ''
  for (;;) {
    try {
      const real = realpathSync(probe)
      const full = rest ? join(real, rest) : real
      const back = relative(realRoot, full)
      if (back.startsWith('..') || isAbsolute(back)) throw new Error(`${rel} leads outside the project`)
      return abs
    } catch (e) {
      if ((e as Error).message.includes('outside the project')) throw e
      const parent = join(probe, '..')
      if (parent === probe) return abs
      rest = rest ? join(probe.slice(parent.length + 1), rest) : probe.slice(parent.length + 1)
      probe = parent
    }
  }
}

function safeReal(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** A path relative to the root, with forward slashes */
export function relOf(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}
