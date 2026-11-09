/**
 * Tide's own guide (Help): one Markdown file per page in docs/guide, readable on GitHub as they
 * are. A page starts with a few `key: value` lines between `---` (title, group, summary...), and
 * three kinds of block become live parts of the page in the app:
 *
 *   ```walkthrough                     a step-by-step player over screenshots of Tide
 *   Your day
 *   home | 27,20,62,9 | Open Tide | **Open Tide.** Home greets you… | home
 *   ```                                (image | highlight x,y,w,h in % | label | what to say | screen to open)
 *
 *   ```animation                       a small looping illustration: day, ladder, shelf, wave, brain, map
 *   ladder: P1, P2, P3, Mixed
 *   ```
 *
 *   ![What it shows](img/home.jpg)     on a line of its own: a screenshot with a caption
 */

export interface DocPage {
  id: string
  file: string
  title: string
  group: string
  summary: string
  meta: Record<string, string>
  body: string
}

export interface WalkStep {
  image: string
  hot: [number, number, number, number]
  label: string
  text: string
  open?: string
}

export type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'walk'; title: string; steps: WalkStep[] }
  | { kind: 'anim'; anim: string; labels: string[] }
  | { kind: 'figure'; image: string; caption: string }

/** "10-flow-day.md" -> "flow-day" */
export const pageId = (file: string) =>
  file
    .split('/')
    .pop()!
    .replace(/\.md$/, '')
    .replace(/^\d+-/, '')

export function parsePage(file: string, raw: string): DocPage {
  const meta: Record<string, string> = {}
  let body = raw.replace(/\r\n/g, '\n')
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([\w-]+):\s*(.*)$/)
      if (m) meta[m[1]] = m[2].trim()
    }
    body = body.slice(fm[0].length)
  }
  return { id: pageId(file), file, title: meta.title ?? pageId(file), group: meta.group ?? '', summary: meta.summary ?? '', meta, body }
}

const IMAGE = /^img\/([\w-]+)\.\w+$/

export function segments(body: string): Segment[] {
  const out: Segment[] = []
  let text: string[] = []
  const flush = () => {
    const t = text.join('\n').trim()
    if (t) out.push({ kind: 'md', text: t })
    text = []
  }
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^```(walkthrough|animation)\s*$/)
    if (fence) {
      const block: string[] = []
      while (++i < lines.length && !/^```\s*$/.test(lines[i])) block.push(lines[i])
      flush()
      out.push(fence[1] === 'walkthrough' ? walkthrough(block) : animation(block))
      continue
    }
    const fig = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (fig && IMAGE.test(fig[2])) {
      flush()
      out.push({ kind: 'figure', image: fig[2].match(IMAGE)![1], caption: fig[1] })
      continue
    }
    text.push(line)
  }
  flush()
  return out
}

function walkthrough(block: string[]): Segment {
  let title = ''
  const steps: WalkStep[] = []
  for (const line of block) {
    if (!line.trim()) continue
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length < 4) {
      title ||= line.trim()
      continue
    }
    const hot = parts[1].split(',').map(Number)
    if (hot.length !== 4 || hot.some((n) => !Number.isFinite(n))) continue
    steps.push({ image: parts[0], hot: hot as WalkStep['hot'], label: parts[2], text: parts[3], open: parts[4] || undefined })
  }
  return { kind: 'walk', title, steps }
}

function animation(block: string[]): Segment {
  const line = block.find((l) => l.trim()) ?? ''
  const [anim, rest = ''] = line.split(':')
  return {
    kind: 'anim',
    anim: anim.trim(),
    labels: rest
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

/** Headings people can jump to: the page's ## sections, outside code */
export const sections = (body: string) => [...body.replace(/^```[\s\S]*?^```/gm, '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/[*`]/g, '').trim())

export interface SearchHit {
  page: string
  section?: string
  title: string
  where: string
  snippet: string
  score: number
}

/** Text for searching: walkthroughs keep what they say, Markdown and HTML go */
const plain = (md: string) =>
  md
    .replace(/^```[\s\S]*?^```/gm, (b) =>
      b
        .split('\n')
        .slice(1, -1)
        .map((l) => l.split('|')[3] ?? l)
        .join(' ')
    )
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Every page and every section in it, scored by where the words appear */
export function searchDocs(pages: DocPage[], query: string, limit = 12): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits: SearchHit[] = []
  for (const p of pages) {
    const parts = p.body.split(/^##\s+/m)
    const intro = { title: p.title, text: `${p.summary} ${plain(parts[0])}`, section: undefined as string | undefined, where: p.group }
    const secs = parts.slice(1).map((s) => {
      const [head, ...rest] = s.split('\n')
      const title = head.replace(/[*`]/g, '').trim()
      return { title, text: plain(rest.join('\n')), section: title, where: p.title }
    })
    for (const e of [intro, ...secs]) {
      const t = e.title.toLowerCase()
      const b = e.text.toLowerCase()
      if (!words.every((w) => t.includes(w) || b.includes(w))) continue
      const score = words.reduce((n, w) => n + (t.includes(w) ? 6 : 0) + (b.includes(w) ? 1 : 0), 0) + (e.section ? 0 : 1)
      const at = Math.max(0, b.indexOf(words[0]))
      const snippet = (at > 50 ? '…' : '') + e.text.slice(Math.max(0, at - 50), at + 100).trim()
      hits.push({ page: p.id, section: e.section, title: e.title, where: e.where, snippet, score })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
