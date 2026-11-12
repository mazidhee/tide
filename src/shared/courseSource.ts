/**
 * The rules every course source is read by (main/sources does the fetching): what robots.txt
 * allows, what a site's content signals refuse, what counts as a login wall or a paywall (never
 * crossed), which sites are never read at all, how a licence sorts into open or personal study, and
 * the small text formats the adapters share (a Jupyter Book's _toc.yml, MyST, WebVTT captions).
 * Pure, so each rule is tested on its own.
 */

// ---------- robots.txt ----------

export interface Robots {
  /** Rules for Tide: from a group naming it, else the group for every robot */
  rules: { allow: boolean; path: string }[]
  /** Seconds between requests, when the site asks for it */
  crawlDelay?: number
  /** Content-Signal values (search, ai-input, ai-train), as the site sets them for Tide */
  signals: Record<string, string>
}

/** The agent Tide names itself by in robots.txt groups */
export const ROBOT_NAME = 'tide'

/**
 * robots.txt read the standard way (RFC 9309): the group whose user-agent names Tide, else the `*`
 * group; Allow and Disallow with `*` and `$`; Crawl-delay; Cloudflare's Content-Signal line.
 */
export function parseRobots(text: string, agent = ROBOT_NAME): Robots {
  type Group = { agents: string[]; rules: Robots['rules']; delay?: number; signals: Record<string, string> }
  const groups: Group[] = []
  let cur: Group | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], signals: {} }
        groups.push(cur)
      }
      cur.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything: no rule
      if (value) cur.rules.push({ allow: key === 'allow', path: value })
    } else if (key === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) cur.delay = n
    } else if (key === 'content-signal') {
      for (const part of value.split(',')) {
        const [k, v] = part.split('=').map((x) => x.trim().toLowerCase())
        if (k && v) cur.signals[k] = v
      }
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a.replace(/\/.*$/, ''))))
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'))
  return {
    rules: chosen.flatMap((g) => g.rules),
    ...(chosen.find((g) => g.delay !== undefined) ? { crawlDelay: chosen.find((g) => g.delay !== undefined)!.delay } : {}),
    signals: Object.assign({}, ...chosen.map((g) => g.signals))
  }
}

const ruleRe = (path: string) => new RegExp(`^${path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$').replace(/\$$/, '$')}`)

/** Whether robots.txt lets Tide fetch a path (with its query): the longest matching rule wins, Allow on a tie */
export function robotsAllow(r: Robots, pathAndQuery: string): boolean {
  let best: { allow: boolean; len: number } | null = null
  for (const rule of r.rules) {
    if (!ruleRe(rule.path).test(pathAndQuery)) continue
    const len = rule.path.length
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len }
  }
  return best ? best.allow : true
}

/** A site that says its pages may not be given to an AI model: Tide doesn't read it as a course */
export const refusesAi = (r: Robots) => r.signals['ai-input'] === 'no'

// ---------- Free, without a login ----------

/** Sites whose courses sit behind an account or a payment: never read, never suggested */
export const NEVER_HOSTS = [
  'coursera.org',
  'edx.org',
  'udemy.com',
  'udacity.com',
  'linkedin.com',
  'datacamp.com',
  'pluralsight.com',
  'skillshare.com',
  'teachable.com',
  'thinkific.com',
  'kajabi.com',
  'talentlms.com',
  'masterclass.com',
  'oreilly.com',
  'educative.io',
  'brilliant.org',
  'domestika.org',
  'futurelearn.com',
  'maven.com'
]

export function neverHost(url: string): boolean {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  return NEVER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|sign_in|signup|sign-up|register|auth|oauth|sso|account\/(login|signin)|users\/sign_in|session\/new)(\/|\?|$|\.)/i

/**
 * What stands between Tide and a page: null when it is free to read, else 'login' (it redirected
 * to a sign-in, asked for credentials, or is a sign-in form) or 'paywall' (it says the rest is for
 * subscribers). Either way the page isn't read, and the course isn't imported from it.
 */
export function gate(p: { url: string; finalUrl?: string; status: number; html?: string }): 'login' | 'paywall' | null {
  if (p.status === 401 || p.status === 407) return 'login'
  if (p.status === 402) return 'paywall'
  const asked = (() => {
    try {
      return new URL(p.url).pathname
    } catch {
      return ''
    }
  })()
  const landed = (() => {
    try {
      return new URL(p.finalUrl ?? p.url).pathname + new URL(p.finalUrl ?? p.url).search
    } catch {
      return ''
    }
  })()
  if (LOGIN_PATH.test(landed) && !LOGIN_PATH.test(asked)) return 'login'
  const html = p.html ?? ''
  if (!html) return null
  // Structured data that says so
  if (/"isAccessibleForFree"\s*:\s*(false|"False"|"false")/.test(html)) return 'paywall'
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  const words = text.split(' ').filter(Boolean).length
  // A sign-in form with little else on the page
  if (/<input[^>]+type=["']?password/i.test(html) && words < 600) return 'login'
  if (words < 1500 && /\b(sign in|log in|create an account|create a free account) to (continue|read|view|access|watch|enrol|enroll)\b/i.test(text)) return 'login'
  if (/\b(subscribe|become a member|start your free trial|upgrade) to (continue reading|read (the|this) (full|rest)|unlock)\b/i.test(text)) return 'paywall'
  return null
}

// ---------- Licences ----------

/** A licence that allows copying with attribution (what `open` means in the catalogue) */
export function tierOfLicence(licence: string | null | undefined): 'open' | 'personal' {
  const l = (licence ?? '').toLowerCase().replace(/[\s_]+/g, '-')
  if (!l || l === 'none' || l === 'noassertion' || l === 'other' || l.includes('none-stated')) return 'personal'
  // Non-commercial or no-derivatives: read here, never passed on
  if (/(^|-)nc(-|$)|noncommercial|non-commercial|(^|-)nd(-|$)|noderiv|no-deriv/.test(l)) return 'personal'
  if (/^(mit|isc|0bsd|unlicense|zlib|bsl-1\.0|wtfpl)$/.test(l)) return 'open'
  if (/^(apache|bsd|mpl|cc0|cc-by|cc-by-sa|cc-by-4|gpl|lgpl|agpl|gfdl|epl|artistic|python|psf|odc-by|pddl|cc-pdm)/.test(l)) return 'open'
  return 'personal'
}

// ---------- Small helpers ----------

/** A short, stable fingerprint of some text (FNV-1a, 32 bits, hex): a source's version */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** A title as a file or id fragment: "Lecture 7: Value at Risk" → "lecture-7-value-at-risk" */
export const slugify = (s: string, max = 60) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'page'

// ---------- A Jupyter Book's table of contents ----------

export interface JbPart {
  title: string
  files: string[]
}

/**
 * A Jupyter Book's _toc.yml (jb-book or jb-article) as its parts, each with its files in order
 * (chapters and their sections, flattened). The root page is left out: it is the book's cover, a
 * list of what follows. Read line by line: the format is a small, regular subset of YAML.
 */
export function parseJbToc(yml: string): { root?: string; parts: JbPart[] } {
  const parts: JbPart[] = []
  let root: string | undefined
  let current: JbPart | null = null
  const unq = (s: string) => s.trim().replace(/^["']|["']$/g, '')
  for (const raw of yml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    const r = line.match(/^root:\s*(.+)$/)
    if (r) {
      root = unq(r[1])
      continue
    }
    const cap = line.match(/^\s*-?\s*caption:\s*(.+)$/)
    if (cap) {
      current = { title: unq(cap[1]), files: [] }
      parts.push(current)
      continue
    }
    const f = line.match(/^\s*-?\s*file:\s*(.+)$/)
    if (f) {
      if (!current) {
        current = { title: 'Lectures', files: [] }
        parts.push(current)
      }
      current.files.push(unq(f[1]).replace(/\.(md|ipynb)$/i, ''))
    }
  }
  return { ...(root ? { root } : {}), parts: parts.filter((p) => p.files.length) }
}

// ---------- MyST (Jupyter Book's Markdown) as plain Markdown ----------

const ADMONITION = /^(note|tip|hint|important|warning|caution|attention|danger|error|seealso|admonition|exercise|solution|prf:\w+|theorem|lemma|proof|definition|example|remark)$/

/**
 * MyST read as the Markdown Tide renders: code cells become runnable fenced code, math blocks
 * become $$…$$, admonitions and exercises become quoted blocks with their name, a solution is kept
 * in a closed block below its exercise, and roles ({doc}, {ref}, {cite}, {math}) become text.
 */
export function mystMarkdown(md: string, lang = 'python'): string {
  const lines = md.replace(/\r/g, '').split('\n')
  const out: string[] = []
  // Open directives: their fence, and what they were
  const stack: { fence: string; kind: 'code' | 'math' | 'quote' | 'drop' | 'raw'; depth: number }[] = []
  const quoteDepth = () => stack.filter((s) => s.kind === 'quote').length
  const prefix = () => '> '.repeat(quoteDepth())
  for (const line of lines) {
    const top = stack[stack.length - 1]
    // Closing the innermost directive
    if (top && line.trim() === top.fence) {
      stack.pop()
      if (top.kind === 'code' || top.kind === 'math' || top.kind === 'raw') out.push(prefix() + (top.kind === 'math' ? '$$' : '```'))
      continue
    }
    if (top && (top.kind === 'code' || top.kind === 'math' || top.kind === 'raw' || top.kind === 'drop')) {
      if (top.kind === 'drop') continue
      // Directive options at the top of a code cell (:tags: [...]) aren't code
      if (top.kind === 'code' && /^:[\w-]+:/.test(line) && out[out.length - 1]?.endsWith('```' + lang)) continue
      out.push(prefix() + line)
      continue
    }
    // The gated form (sphinx-exercise): start and end are directives of their own, the body between them
    const gated = line.match(/^(```+|:::+)\{(solution|exercise)-(start|end)\}\s*(.*)$/)
    if (gated) {
      if (gated[3] === 'start') out.push(`#### ${gated[2] === 'solution' ? 'Solution' : 'Exercise'}`)
      stack.push({ fence: gated[1], kind: 'drop', depth: 0 })
      continue
    }
    const d = line.match(/^(\s*)(```+|:::+)\{([\w:-]+)\}\s*(.*)$/)
    if (d) {
      const fence = d[2]
      const name = d[3]
      if (name === 'code-cell' || name === 'code-block' || name === 'code' || name === 'sourcecode') {
        const l = (d[4] || '').trim().replace(/^ipython3?$/, 'python') || lang
        out.push(prefix() + '```' + (name === 'code-cell' ? lang : l))
        stack.push({ fence, kind: 'code', depth: 0 })
      } else if (name === 'math') {
        out.push(prefix() + '$$')
        stack.push({ fence, kind: 'math', depth: 0 })
      } else if (ADMONITION.test(name)) {
        const label = name.replace(/^prf:/, '')
        const title = d[4]?.trim()
        stack.push({ fence, kind: 'quote', depth: 0 })
        out.push(`${prefix()}**${label.charAt(0).toUpperCase() + label.slice(1)}${title && !/^[\w-]+$/.test(title) ? `: ${title}` : ''}**`)
        out.push(prefix().trimEnd())
      } else if (/^(raw|only|toctree|tableofcontents|bibliography|contents|index|glue:\w+|div)$/.test(name)) {
        stack.push({ fence, kind: name === 'div' ? 'quote' : 'drop', depth: 0 })
      } else if (/^(figure|image)$/.test(name)) {
        const src = d[4]?.trim()
        if (src) out.push(`${prefix()}![](${src})`)
        stack.push({ fence, kind: 'drop', depth: 0 })
      } else {
        // Anything else: its body kept as text
        stack.push({ fence, kind: 'quote', depth: 0 })
      }
      continue
    }
    // Directive options inside a quoted directive
    if (top?.kind === 'quote' && /^:[\w-]+:/.test(line.trim())) continue
    // Labels "(name)=" and comments
    if (/^\(\S+\)=\s*$/.test(line) || /^%/.test(line)) continue
    out.push(prefix() + roles(line))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** MyST roles as text: {math}`x` → $x$, {doc}`text <file>` → text, {cite}`k` dropped */
export function roles(line: string): string {
  return line
    .replace(/\{math\}`([^`]+)`/g, (_, x) => `$${x}$`)
    .replace(/\{(cite|cite:\w+|footcite)\}`[^`]*`/g, '')
    .replace(/\{(doc|ref|numref|eq|download|term|prf:ref|index)\}`([^`<]*?)\s*<[^>]+>`/g, '$2')
    .replace(/\{(doc|ref|numref|eq|download|term|prf:ref|index)\}`([^`]+)`/g, (_, __, x: string) => x.replace(/^.*\//, '').replace(/[-_]/g, ' '))
    .replace(/\{(sub|sup|abbr|kbd|code|guilabel|menuselection)\}`([^`]+)`/g, '$2')
}

// ---------- Captions ----------

/** A WebVTT or SRT caption file as timed segments (seconds) */
export function captionSegments(text: string): { start: number; dur: number; text: string }[] {
  const out: { start: number; dur: number; text: string }[] = []
  const stamp = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/
  const sec = (m: RegExpMatchArray) => Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
  for (const cue of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = cue.split('\n')
    const at = rows.findIndex((r) => r.includes('-->'))
    if (at < 0) continue
    const [a, b] = rows[at].split('-->')
    const ma = a.match(stamp)
    const mb = b?.match(stamp)
    if (!ma) continue
    const t = rows
      .slice(at + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t) continue
    const start = sec(ma)
    out.push({ start, dur: mb ? Math.max(0, sec(mb) - start) : 0, text: t })
  }
  return out
}

const clock = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

/**
 * A lecture's transcript as the lesson's text: paragraphs of about a minute, each starting with a
 * link to its moment in the video, under a heading every ten minutes or so (the parts the tutor
 * takes it in).
 */
export function transcriptMarkdown(videoId: string, segs: { start: number; text: string }[], every = 600): string {
  if (!segs.length) return ''
  const out: string[] = []
  let para: string[] = []
  let paraStart = segs[0].start
  let nextHead = 0
  const flush = () => {
    if (!para.length) return
    out.push(`[${clock(paraStart)}](https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(paraStart)}s) ${para.join(' ')}`)
    para = []
  }
  for (const s of segs) {
    if (s.start >= nextHead) {
      flush()
      out.push(`### From ${clock(s.start)}`)
      nextHead = s.start + every
      paraStart = s.start
    }
    if (para.length && s.start - paraStart >= 60) {
      flush()
      paraStart = s.start
    }
    para.push(s.text)
  }
  flush()
  return out.join('\n\n')
}

// ---------- AsciiDoc (O'Reilly's open books) as Markdown ----------

/**
 * AsciiDoc read as Markdown, enough for a book's chapters: section titles, source and literal
 * blocks, admonitions and sidebars as quotes, links, cross-references and pictures, emphasis,
 * lists, and the markup that only steers the publisher's build (anchors, roles, index terms,
 * attributes, includes) left out. Tables are kept as preformatted text.
 */
export function asciidocMarkdown(src: string): string {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let block: { end: string; kind: 'code' | 'quote' | 'table' | 'drop'; lang?: string } | null = null
  let pendingLang: string | null = null
  let pendingTitle: string | null = null
  let admonition: string | null = null
  const inline = (s: string) =>
    s
      .replace(/\(\(\(([^)]*)\)\)\)/g, '')
      .replace(/indexterm:\[[^\]]*\]/g, '')
      .replace(/<<([^,>]+),\s*([^>]+)>>/g, '$2')
      .replace(/<<([^>]+)>>/g, (_, id: string) => id.replace(/^[a-z]+\d*_/, '').replace(/[-_]/g, ' '))
      .replace(/(?:link:)?(https?:\/\/[^\s[\]]+)\[([^\]]*)\]/g, (_, u: string, t: string) => `[${t || u}](${u})`)
      .replace(/footnote:\[([^\]]*)\]/g, ' ($1)')
      .replace(/kbd:\[([^\]]*)\]/g, '`$1`')
      .replace(/\+\+([^+]+)\+\+|(?<![\w+])\+([^+\s][^+]*?)\+(?![\w+])/g, (_, a, b) => `\`${a ?? b}\``)
      .replace(/(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '**$1**')
      .replace(/(?<![\w_])_([^_\s][^_]*?)_(?![\w_])/g, '*$1*')
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (block) {
      if (line === block.end) {
        if (block.kind === 'code' || block.kind === 'table') out.push('```')
        if (block.kind === 'quote') out.push('')
        block = null
        continue
      }
      if (block.kind === 'code' || block.kind === 'table') out.push(line.replace(/\s*<\d+>$/, ''))
      else if (block.kind === 'quote') out.push(`> ${inline(line)}`)
      continue
    }
    // Comments, attributes, anchors, roles and includes steer the build, not the reader
    if (/^\/\/(?!\/)/.test(line) || /^:[\w-]+:/.test(line) || /^\[\[[^\]]*\]\]$/.test(line) || /^include::/.test(line) || /^ifdef::|^endif::|^ifndef::/.test(line)) continue
    if (line === '////') {
      block = { end: '////', kind: 'drop' }
      continue
    }
    const attr = line.match(/^\[(source|listing)(?:,\s*([\w+#-]+))?[^\]]*\]$/)
    if (attr) {
      pendingLang = attr[2] ?? ''
      continue
    }
    const adm = line.match(/^\[(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]$/)
    if (adm) {
      admonition = adm[1]
      continue
    }
    if (/^\[[^\]]*\]$/.test(line)) continue
    if (/^\.[A-Za-z0-9]/.test(line) && !/^\.\.\./.test(line)) {
      pendingTitle = inline(line.slice(1))
      continue
    }
    if (/^(----|\.\.\.\.)$/.test(line)) {
      if (pendingTitle) out.push(`*${pendingTitle}*`, '')
      out.push('```' + (pendingLang ?? ''))
      block = { end: line, kind: 'code' }
      pendingLang = pendingTitle = null
      continue
    }
    if (/^(====|\*\*\*\*|____)$/.test(line)) {
      const label = admonition ? admonition.charAt(0) + admonition.slice(1).toLowerCase() : pendingTitle
      out.push(label ? `> **${label}**${admonition && pendingTitle ? `: ${pendingTitle}` : ''}` : '>', '>')
      block = { end: line, kind: 'quote' }
      admonition = pendingTitle = null
      continue
    }
    if (/^\|===$/.test(line)) {
      out.push('```text')
      block = { end: '|===', kind: 'table' }
      continue
    }
    const h = line.match(/^(={1,6})\s+(.+)$/)
    if (h) {
      out.push(`${'#'.repeat(h[1].length)} ${inline(h[2])}`)
      pendingTitle = null
      continue
    }
    const one = line.match(/^(NOTE|TIP|WARNING|CAUTION|IMPORTANT):\s+(.*)$/)
    if (one) {
      out.push(`> **${one[1].charAt(0) + one[1].slice(1).toLowerCase()}**: ${inline(one[2])}`)
      continue
    }
    const img = line.match(/^image::([^[]+)\[([^\]]*)\]$/)
    if (img) {
      out.push(`![${img[2].split(',')[0].replace(/"/g, '')}](${img[1]})`)
      continue
    }
    const li = line.match(/^(\*{1,4}|\.{1,4})\s+(.*)$/)
    if (li) {
      const depth = li[1].length - 1
      out.push(`${'  '.repeat(depth)}${li[1][0] === '.' ? '1.' : '-'} ${inline(li[2])}`)
      continue
    }
    if (line === '+') continue
    pendingTitle = null
    out.push(inline(line))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
