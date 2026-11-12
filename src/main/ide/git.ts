/**
 * Source control through the git command line, as VS Code's own git extension does it: status in
 * porcelain v2, a file's text at HEAD or in the index (for the gutter and the diff editor), stage,
 * unstage, discard, commit, branches and blame. git never asks for a password here and takes no
 * optional locks, so a status never gets in the way of a git in the terminal.
 */
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { shell } from 'electron'
import type { BlameLine, GitCommit, GitFile, GitStatus } from '@shared/ide'
import { cleanRel, inside } from './paths'
import { allowed } from './workspace'

const GIT_PATHS = ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']
export const gitBin = () => GIT_PATHS.find((p) => existsSync(p)) ?? 'git'

export function git(root: string, args: string[], opts: { input?: string; maxBuffer?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitBin(),
      ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args],
      {
        cwd: root,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C', PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/bin:/bin` }
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim().split('\n').slice(-3).join('\n')))
        else resolve(stdout)
      }
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

/** `git status --porcelain=v2 --branch -z`, read */
export function parseStatus(out: string): Omit<GitStatus, 'repo'> {
  const s: Omit<GitStatus, 'repo'> = { branch: null, ahead: 0, behind: 0, files: [] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const h = line.slice(14)
      s.branch = h === '(detached)' ? null : h
    } else if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13)
      if (oid !== '(initial)') s.detached = oid.slice(0, 7)
    } else if (line.startsWith('# branch.upstream ')) s.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        s.ahead = Number(m[1])
        s.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const f = line.split(' ')
      s.files.push({ path: f.slice(8).join(' '), index: f[1][0], work: f[1][1] })
    } else if (line.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path\0origPath
      const f = line.split(' ')
      s.files.push({ path: f.slice(9).join(' '), index: f[1][0], work: f[1][1], from: parts[++i] })
    } else if (line.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = line.split(' ')
      s.files.push({ path: f.slice(10).join(' '), index: f[1][0], work: f[1][1], conflicted: true })
    } else if (line.startsWith('? ')) s.files.push({ path: line.slice(2), index: '.', work: '?' })
  }
  if (s.branch) delete s.detached
  return s
}

export async function status(rootIn: string): Promise<GitStatus> {
  const root = allowed(rootIn)
  try {
    const inRepo = (await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => 'false')).trim() === 'true'
    if (!inRepo) return { repo: false, branch: null, ahead: 0, behind: 0, files: [] }
    // Paths relative to the workspace, even when the repository's top is above it
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim()
    const s = parseStatus(await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', '.']))
    if (prefix) for (const f of s.files) {
      f.path = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path
      if (f.from?.startsWith(prefix)) f.from = f.from.slice(prefix.length)
    }
    return { repo: true, ...s }
  } catch (e) {
    return { repo: false, branch: null, ahead: 0, behind: 0, files: [], error: (e as Error).message }
  }
}

/** A file's text at a revision ('HEAD'), or in the index (''); null when it isn't there */
export async function show(rootIn: string, rel: string, ref = 'HEAD'): Promise<string | null> {
  const root = allowed(rootIn)
  const path = cleanRel(rel)
  return git(root, ['show', `${ref}:./${path}`]).catch(() => null)
}

const paths = (list: string[]) => list.map((p) => cleanRel(p)).filter(Boolean)

export async function stage(rootIn: string, list: string[]) {
  await git(allowed(rootIn), ['add', '-A', '--', ...paths(list)])
}

export async function unstage(rootIn: string, list: string[]) {
  const root = allowed(rootIn)
  // Before the first commit there is no HEAD to reset to
  const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false)
  if (hasHead) await git(root, ['reset', '-q', 'HEAD', '--', ...paths(list)])
  else await git(root, ['rm', '-q', '--cached', '-r', '--', ...paths(list)])
}

/** Throws away working-tree changes: tracked files go back to the index; new files go to the Bin */
export async function discard(rootIn: string, list: string[]) {
  const root = allowed(rootIn)
  const st = await status(root)
  const untracked = new Set(st.files.filter((f) => f.work === '?').map((f) => f.path))
  const tracked = paths(list).filter((p) => !untracked.has(p))
  if (tracked.length) await git(root, ['checkout', '--', ...tracked])
  for (const p of paths(list).filter((x) => untracked.has(x))) await shell.trashItem(inside(root, p))
}

export async function commit(rootIn: string, message: string, o: { amend?: boolean; all?: boolean } = {}): Promise<string> {
  const root = allowed(rootIn)
  if (!message.trim() && !o.amend) throw new Error('Write a commit message first.')
  if (o.all) await git(root, ['add', '-A', '--', '.'])
  const args = ['commit', '--quiet', '--file', '-', ...(o.amend ? ['--amend'] : [])]
  await git(root, args, { input: message })
  return (await git(root, ['rev-parse', '--short', 'HEAD'])).trim()
}

export async function diff(rootIn: string, o: { staged?: boolean; path?: string } = {}): Promise<string> {
  const root = allowed(rootIn)
  const args = ['diff', '--no-ext-diff', '-U3', ...(o.staged ? ['--cached'] : []), '--', o.path ? cleanRel(o.path) : '.']
  return git(root, args)
}

export async function branches(rootIn: string): Promise<{ current: string | null; local: string[] }> {
  const root = allowed(rootIn)
  const out = await git(root, ['branch', '--format=%(HEAD) %(refname:short)']).catch(() => '')
  const lines = out.split('\n').filter(Boolean)
  return { current: lines.find((l) => l.startsWith('*'))?.slice(2) ?? null, local: lines.map((l) => l.slice(2)) }
}

export async function checkout(rootIn: string, branch: string, create = false) {
  const root = allowed(rootIn)
  const name = String(branch ?? '').trim()
  if (!/^[\w./-]+$/.test(name) || name.startsWith('-')) throw new Error('That isn’t a branch name git takes.')
  await git(root, create ? ['checkout', '-b', name] : ['checkout', name])
}

/** `git blame --porcelain`, one entry per line of the file */
export function parseBlame(out: string): BlameLine[] {
  const commits = new Map<string, BlameLine>()
  const lines: BlameLine[] = []
  let cur: BlameLine | null = null
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l)
    if (head) {
      const hash = head[1]
      cur = commits.get(hash) ?? { hash, author: '', time: 0, summary: '' }
      commits.set(hash, cur)
      continue
    }
    if (!cur) continue
    if (l.startsWith('author ')) cur.author = l.slice(7)
    else if (l.startsWith('author-time ')) cur.time = Number(l.slice(12)) * 1000
    else if (l.startsWith('summary ')) cur.summary = l.slice(8)
    else if (l.startsWith('\t')) lines.push(cur)
  }
  return lines
}

export async function blame(rootIn: string, rel: string): Promise<BlameLine[]> {
  const root = allowed(rootIn)
  return parseBlame(await git(root, ['blame', '--porcelain', '--', cleanRel(rel)]).catch(() => ''))
}

export async function log(rootIn: string, n = 30): Promise<GitCommit[]> {
  const root = allowed(rootIn)
  const out = await git(root, ['log', `-${Math.min(200, Math.max(1, n))}`, '--format=%h%x1f%an%x1f%at%x1f%s']).catch(() => '')
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, author, at, subject] = l.split('\x1f')
      return { hash, author, time: Number(at) * 1000, subject }
    })
}

export async function init(rootIn: string) {
  await git(allowed(rootIn), ['init', '-q'])
}
