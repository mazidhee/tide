/**
 * Search across a workspace's files, as VS Code does it: ripgrep (@vscode/ripgrep, the same build
 * VS Code ships), its JSON output read as it streams, stopped once there are enough matches. With
 * no ripgrep, a plain walk and a JavaScript regular expression do the same, more slowly. Replace
 * rewrites the files the learner picked, with the same pattern in JavaScript.
 */
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { createInterface } from 'readline'
import type { SearchFile, SearchMatch, SearchOptions, SearchResult } from '@shared/ide'
import { inside } from './paths'
import { allowed, ignoreGlobs, listFiles, ripgrep } from './workspace'

const DEFAULT_MAX = 2000
const PREVIEW = 160

const splitGlobs = (s?: string) =>
  (s ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)

/** A folder name alone ("src") means everything under it, as in VS Code */
const globFor = (g: string) => (/[*?[{]/.test(g) || /\.\w+$/.test(g) ? g : `${g.replace(/\/$/, '')}/**`)

export function rgArgs(o: SearchOptions): string[] {
  const args = ['--json', '--hidden', '--no-messages', '--max-filesize', '2M', '--max-count', '400', ...ignoreGlobs()]
  if (!o.regex) args.push('--fixed-strings')
  args.push(o.caseSensitive ? '--case-sensitive' : '--ignore-case')
  if (o.wholeWord) args.push('--word-regexp')
  for (const g of splitGlobs(o.include)) args.push('-g', globFor(g))
  for (const g of splitGlobs(o.exclude)) args.push('-g', `!${globFor(g)}`)
  args.push('--', o.query, '.')
  return args
}

/** The line around a match, so long lines (minified code) don't flood the list */
export function preview(line: string, start: number, length: number): { preview: string; previewColumn: number } {
  const text = line.replace(/\r?\n$/, '')
  if (text.length <= PREVIEW) return { preview: text, previewColumn: start }
  const from = Math.max(0, start - 40)
  const cut = text.slice(from, from + PREVIEW)
  return { preview: (from > 0 ? '…' : '') + cut, previewColumn: start - from + (from > 0 ? 1 : 0) }
}

/** Byte offsets in a UTF-8 line, as ripgrep gives them, to character offsets */
export function charOffset(line: string, byte: number): number {
  return Buffer.from(line, 'utf8').subarray(0, byte).toString('utf8').length
}

interface RgMatch {
  type: string
  data: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: { start: number; end: number }[] }
}

/** One line of ripgrep's --json output, as matches (none for its begin, end and summary lines) */
export function parseRgLine(line: string): { path: string; matches: SearchMatch[] } | null {
  let j: RgMatch
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  if (j.type !== 'match' || !j.data.path?.text || j.data.lines?.text === undefined) return null
  const text = j.data.lines.text
  const path = j.data.path.text.replace(/^\.\//, '')
  const matches = (j.data.submatches ?? []).map((s) => {
    const start = charOffset(text, s.start)
    const length = charOffset(text, s.end) - start
    return { line: j.data.line_number ?? 1, column: start + 1, length, ...preview(text, start, length) }
  })
  return { path, matches }
}

/** The pattern as JavaScript sees it (for the walk without ripgrep, and for replacing) */
export function jsPattern(o: SearchOptions): RegExp {
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (o.wholeWord) src = `\\b(?:${src})\\b`
  return new RegExp(src, `g${o.caseSensitive ? '' : 'i'}u`)
}

/** A small glob test for the walk: *, ** and ? */
export function globMatch(glob: string, path: string): boolean {
  const g = globFor(glob)
  const re = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?.*')
  return new RegExp(`(^|/)${re}$`).test(path) || new RegExp(`^${re}`).test(path)
}

function searchJs(root: string, files: string[], o: SearchOptions, max: number): Promise<{ files: SearchFile[]; total: number; truncated: boolean }> {
  const re = jsPattern(o)
  const inc = splitGlobs(o.include)
  const exc = splitGlobs(o.exclude)
  const out: SearchFile[] = []
  let total = 0
  return (async () => {
    for (const f of files) {
      if (inc.length && !inc.some((g) => globMatch(g, f))) continue
      if (exc.some((g) => globMatch(g, f))) continue
      let text: string
      try {
        const buf = await fs.readFile(inside(root, f))
        if (buf.length > 2_000_000 || buf.subarray(0, 8000).includes(0)) continue
        text = buf.toString('utf8')
      } catch {
        continue
      }
      const matches: SearchMatch[] = []
      text.split('\n').forEach((line, i) => {
        re.lastIndex = 0
        for (let m = re.exec(line); m; m = re.exec(line)) {
          if (!m[0].length) {
            re.lastIndex++
            continue
          }
          matches.push({ line: i + 1, column: m.index + 1, length: m[0].length, ...preview(line, m.index, m[0].length) })
        }
      })
      if (matches.length) {
        out.push({ path: f, matches })
        total += matches.length
        if (total >= max) return { files: out, total, truncated: true }
      }
    }
    return { files: out, total, truncated: false }
  })()
}

export async function search(rootIn: string, o: SearchOptions): Promise<SearchResult> {
  const root = allowed(rootIn)
  const t0 = Date.now()
  const max = Math.min(o.maxResults ?? DEFAULT_MAX, 10_000)
  if (!o.query) return { files: [], total: 0, truncated: false, ms: 0, engine: 'ripgrep' }
  if (o.regex) {
    try {
      jsPattern(o)
    } catch (e) {
      return { files: [], total: 0, truncated: false, ms: 0, engine: 'ripgrep', error: (e as Error).message.replace(/^Invalid regular expression: /, '') }
    }
  }
  const rg = ripgrep()
  if (!rg) {
    const r = await searchJs(root, (await listFiles(root)).files, o, max)
    return { ...r, ms: Date.now() - t0, engine: 'node' }
  }
  return new Promise((resolve) => {
    const child = spawn(rg, rgArgs(o), { cwd: root })
    const byPath = new Map<string, SearchFile>()
    let total = 0
    let truncated = false
    let err = ''
    child.stderr.on('data', (d) => (err += String(d)))
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (truncated) return
      const r = parseRgLine(line)
      if (!r) return
      let f = byPath.get(r.path)
      if (!f) byPath.set(r.path, (f = { path: r.path, matches: [] }))
      f.matches.push(...r.matches)
      total += r.matches.length
      if (total >= max) {
        truncated = true
        child.kill()
      }
    })
    child.on('close', (code) => {
      const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
      // 1 is "nothing found"; 2 an error (a bad pattern), unless matches came anyway
      const error = code === 2 && !total ? err.trim().split('\n').pop() : undefined
      resolve({ files, total, truncated, ms: Date.now() - t0, engine: 'ripgrep', ...(error ? { error } : {}) })
    })
    child.on('error', (e) => resolve({ files: [], total: 0, truncated: false, ms: Date.now() - t0, engine: 'ripgrep', error: e.message }))
  })
}

/** Replaces every match in the files named (the ones the learner left ticked), on disk */
export async function replace(rootIn: string, o: SearchOptions, replacement: string, paths: string[]): Promise<{ files: number; replacements: number }> {
  const root = allowed(rootIn)
  const re = jsPattern(o)
  let files = 0
  let replacements = 0
  for (const p of paths) {
    const abs = inside(root, p)
    const text = await fs.readFile(abs, 'utf8').catch(() => null)
    if (text === null) continue
    let n = 0
    const next = text.replace(re, (...m) => {
      n++
      // $1… in the replacement, for a regular expression
      return o.regex ? replacement.replace(/\$(\d)/g, (_s, i) => String(m[Number(i)] ?? '')) : replacement
    })
    if (n && next !== text) {
      await fs.writeFile(abs, next, 'utf8')
      files++
      replacements += n
    }
  }
  return { files, replacements }
}
