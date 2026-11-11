import { readingHtml } from './reading'
import { explainerForUrl, type Explainer } from '@shared/explainers'
import { normalizeMath } from '@shared/modelText'
import MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

// Notes can contain raw HTML and clipped pages are untrusted, so everything rendered is sanitized.
// Only YouTube players may be embedded as iframes.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'iframe') return
  const src = (node as Element).getAttribute('src') ?? ''
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(src)) node.parentNode?.removeChild(node)
})

// DOMPurify returns its input untouched when it can't run, so fail closed instead
const sanitize = (html: string) =>
  !DOMPurify.isSupported
    ? escapeHtml(html)
    : DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'target', 'loading', 'type', 'checked', 'disabled'],
        // DOMPurify's default pattern (values without a scheme pass), limited to the schemes we use
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|vault):|data:image\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
  })

export interface RenderEnv {
  /** Vault relative path of the note being rendered */
  notePath: string
  /** Lower cased file name -> vault path, for resolving ![[embeds]] by name */
  filesByName: Map<string, string>
}

export const vaultUrl = (path: string) => `vault://file/${path.split('/').map(encodeURIComponent).join('/')}`

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

function dirOf(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Resolves a relative link or embed target from a note to a vault path. */
export function resolveRelative(target: string, env: RenderEnv): string {
  const clean = decodeURIComponent(target.split('#')[0].split('|')[0].trim())
  const byName = env.filesByName.get(clean.split('/').pop()!.toLowerCase())
  if (!clean.includes('/') && byName) return byName
  const parts = (clean.startsWith('/') ? clean.slice(1) : `${dirOf(env.notePath)}/${clean}`).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/') || byName || clean
}

export function youtubeEmbedId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/)
  return m?.[1] ?? null
}

// ---------- Math ----------

function renderMath(src: string, display: boolean) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' })
  } catch {
    return `<code>${escapeHtml(src)}</code>`
  }
}

function mathInline(state: StateInline, silent: boolean) {
  const src = state.src
  const start = state.pos
  if (src[start] !== '$') return false
  const isDisplay = src[start + 1] === '$'
  const open = isDisplay ? 2 : 1
  // Inline $ must not be followed by whitespace, e.g. "costs $5 and $6" is not math
  if (!isDisplay && /\s/.test(src[start + 1] ?? ' ')) return false
  let end = start + open
  while (end < src.length) {
    if (src[end] === '\\') {
      end += 2
      continue
    }
    if (src.startsWith(isDisplay ? '$$' : '$', end)) break
    end++
  }
  if (end >= src.length) return false
  const content = src.slice(start + open, end)
  if (!content.trim() || (!isDisplay && /\s/.test(content[content.length - 1]))) return false
  if (!isDisplay && /\d/.test(src[end + 1] ?? '')) return false
  if (!silent) {
    const token = state.push(isDisplay ? 'math_display_inline' : 'math_inline', 'math', 0)
    token.content = content
  }
  state.pos = end + open
  return true
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  const pos = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (!state.src.startsWith('$$', pos)) return false
  const firstLine = state.src.slice(pos + 2, max)
  let content = ''
  let line = startLine
  if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
    content = firstLine.trim().slice(0, -2)
  } else {
    const lines = [firstLine]
    let found = false
    while (++line < endLine) {
      const s = state.bMarks[line] + state.tShift[line]
      const text = state.src.slice(s, state.eMarks[line])
      if (text.trim().endsWith('$$')) {
        lines.push(text.trim().slice(0, -2))
        found = true
        break
      }
      lines.push(text)
    }
    if (!found) return false
    content = lines.join('\n')
  }
  if (silent) return true
  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = content
  token.map = [startLine, line + 1]
  state.line = line + 1
  return true
}

// ---------- Wiki links, embeds, highlights, tags ----------

function wikilink(state: StateInline, silent: boolean) {
  const src = state.src
  const start = state.pos
  const isEmbed = src.startsWith('![[', start)
  if (!isEmbed && !src.startsWith('[[', start)) return false
  const open = start + (isEmbed ? 3 : 2)
  const close = src.indexOf(']]', open)
  if (close < 0) return false
  const inner = src.slice(open, close)
  if (!inner || inner.includes('\n')) return false
  if (!silent) {
    const [target, alias] = inner.split('|')
    const token = state.push(isEmbed ? 'wiki_embed' : 'wikilink', '', 0)
    token.meta = { target: target.trim(), alias: alias?.trim() }
  }
  state.pos = close + 2
  return true
}

function markHighlight(state: StateInline, silent: boolean) {
  const start = state.pos
  if (!state.src.startsWith('==', start) || state.src[start + 2] === '=') return false
  const end = state.src.indexOf('==', start + 2)
  if (end < 0 || end === start + 2) return false
  if (!silent) {
    state.push('mark_open', 'mark', 1)
    const inner = state.md.parseInline(state.src.slice(start + 2, end), state.env)[0]?.children ?? []
    state.tokens.push(...inner)
    state.push('mark_close', 'mark', -1)
  }
  state.pos = end + 2
  return true
}

function hashtag(state: StateInline, silent: boolean) {
  const start = state.pos
  if (state.src[start] !== '#') return false
  const prev = start === 0 ? ' ' : state.src[start - 1]
  if (!/\s|\(/.test(prev)) return false
  const m = state.src.slice(start + 1).match(/^[\p{L}_][\p{L}\p{N}_/-]*/u)
  if (!m) return false
  if (!silent) {
    const token = state.push('hashtag', '', 0)
    token.content = m[0]
  }
  state.pos = start + 1 + m[0].length
  return true
}

// ---------- Callouts ----------

const ICON = {
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  tip: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z',
  warning: 'M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9v4.5M12 17h.01',
  danger: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-6 6M9 9l6 6',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  example: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  quote: 'M7 11H4.5V8.5A2.5 2.5 0 0 1 7 6M7 11v3a3 3 0 0 1-3 3M17 11h-2.5V8.5A2.5 2.5 0 0 1 17 6M17 11v3a3 3 0 0 1-3 3',
  summary: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  success: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.5 2.5L16 9.5',
  todo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  tutor: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'
}

const CALLOUT_ICONS: Record<string, keyof typeof ICON> = {
  note: 'info',
  info: 'info',
  tip: 'tip',
  hint: 'tip',
  important: 'warning',
  warning: 'warning',
  caution: 'warning',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  failure: 'danger',
  question: 'question',
  faq: 'question',
  example: 'example',
  quote: 'quote',
  abstract: 'summary',
  summary: 'summary',
  success: 'success',
  check: 'success',
  todo: 'todo',
  tutor: 'tutor'
}

const calloutIcon = (kind: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[CALLOUT_ICONS[kind] ?? 'info']}"/></svg>`

function callouts(md: MarkdownIt) {
  md.core.ruler.after('inline', 'callouts', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      const inline = tokens[i + 2]
      if (!inline || inline.type !== 'inline') continue
      const m = inline.content.match(/^\[!(\w+)\]([+-]?)\s*(.*)/)
      if (!m) continue
      const kind = m[1].toLowerCase()
      tokens[i].attrSet('class', `callout callout-${kind}`)
      tokens[i].meta = { callout: kind, title: m[3].split('\n')[0] || kind[0].toUpperCase() + kind.slice(1), fold: m[2] }
      // Drop the marker line from the first paragraph
      const firstChild = inline.children ?? []
      const breakAt = firstChild.findIndex((t) => t.type === 'softbreak' || t.type === 'hardbreak')
      inline.children = breakAt >= 0 ? firstChild.slice(breakAt + 1) : []
      if (!inline.children.length) {
        tokens[i + 1].hidden = true
        tokens[i + 3].hidden = true
      }
    }
  })
  const defaultOpen = md.renderer.rules.blockquote_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    const meta = tokens[idx].meta
    if (!meta?.callout) return defaultOpen(tokens, idx, opts, env, self)
    return `<div class="callout callout-${escapeHtml(meta.callout)}"><div class="callout-title"><span class="callout-icon">${calloutIcon(meta.callout)}</span>${md.renderInline(meta.title)}</div><div class="callout-body">`
  }
  const defaultClose = md.renderer.rules.blockquote_close ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
  md.renderer.rules.blockquote_close = (tokens, idx, opts, env, self) => {
    // Find the matching open token to know whether this quote was a callout
    let depth = 0
    for (let i = idx - 1; i >= 0; i--) {
      if (tokens[i].type === 'blockquote_close') depth++
      if (tokens[i].type === 'blockquote_open') {
        if (depth === 0) return tokens[i].meta?.callout ? '</div></div>' : defaultClose(tokens, idx, opts, env, self)
        depth--
      }
    }
    return defaultClose(tokens, idx, opts, env, self)
  }
}

// ---------- Instance ----------

function embedHtml(target: string, env: RenderEnv, alias?: string): string {
  const yt = youtubeEmbedId(target)
  if (yt) {
    return `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
  }
  const path = /^https?:/.test(target) ? target : resolveRelative(target, env)
  const src = /^https?:/.test(path) ? path : vaultUrl(path)
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path)) {
    const width = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : ''
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alias && !width ? alias : '')}"${width} loading="lazy">`
  }
  if (/\.pdf$/i.test(path)) {
    return `<a class="wikilink file-link" data-href="${escapeHtml(path)}" href="#">${escapeHtml(alias || path.split('/').pop()!)}</a>`
  }
  return `<a class="wikilink" data-wikilink="${escapeHtml(target)}" href="#">${escapeHtml(alias || target)}</a>`
}

// The app's own "external" icon (components/Icon.tsx)
const EXTERNAL_ICON = 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'

/** The card for a trusted explainer. An ordinary external link underneath, so it opens in the browser like any other. */
export function exploreCard(e: Explainer): string {
  const host = new URL(e.url).hostname.replace(/^www\./, '')
  return (
    `<a class="external explore-card" href="${escapeHtml(e.url)}" target="_blank" data-explainer="${escapeHtml(e.id)}">` +
    `<span class="explore-head"><span class="explore-title">${escapeHtml(e.title)}</span><span class="explore-by">${escapeHtml(e.by)}</span></span>` +
    `<span class="explore-what">${escapeHtml(e.what)}</span>` +
    `<span class="explore-foot"><span class="explore-tag">Explore</span><span class="explore-where">${escapeHtml(host)}, opens in your browser</span>` +
    `<svg class="explore-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${EXTERNAL_ICON}"/></svg></span>` +
    `</a>`
  )
}

export function createMarkdown() {
  const md: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (code, lang) => {
      const language = lang && hljs.getLanguage(lang) ? lang : null
      const html = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code)
      const runnable = /^(python|py|javascript|js)$/i.test(lang)
      return `<pre class="code-block" data-lang="${escapeHtml(lang || '')}">${runnable ? '<button class="run-code" type="button">Run</button>' : ''}<button class="copy-code" type="button">Copy</button><code class="hljs">${html}</code></pre>`
    }
  })

  md.inline.ruler.before('escape', 'math_inline', mathInline)
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.inline.ruler.before('link', 'wikilink', wikilink)
  md.inline.ruler.before('emphasis', 'mark', markHighlight)
  md.inline.ruler.push('hashtag', hashtag)
  callouts(md)

  md.renderer.rules.math_inline = (t, i) => renderMath(t[i].content, false)
  md.renderer.rules.math_display_inline = (t, i) => renderMath(t[i].content, true)
  md.renderer.rules.math_block = (t, i) => {
    const line = t[i].attrGet('data-line')
    const attrs = line !== null ? ` data-line="${line}" data-line-end="${t[i].attrGet('data-line-end')}"` : ''
    return `<div class="math-block"${attrs}>${renderMath(t[i].content, true)}</div>`
  }
  md.renderer.rules.hashtag = (t, i) => `<span class="tag">#${escapeHtml(t[i].content)}</span>`
  md.renderer.rules.wikilink = (t, i) => {
    const { target, alias } = t[i].meta
    return `<a class="wikilink" data-wikilink="${escapeHtml(target)}" href="#">${escapeHtml(alias || target.split('#')[0].split('/').pop() || target)}</a>`
  }
  md.renderer.rules.wiki_embed = (t, i, _o, env: RenderEnv) => embedHtml(t[i].meta.target, env, t[i].meta.alias)

  // Headings get ids for citations and outline navigation
  md.renderer.rules.heading_open = (tokens, idx, opts, _env, self) => {
    const inline = tokens[idx + 1]
    tokens[idx].attrSet('id', slugify(inline?.content ?? ''))
    return self.renderToken(tokens, idx, opts)
  }

  // Relative images resolve into the vault, YouTube "images" become players
  md.renderer.rules.image = (tokens, idx, _opts, env: RenderEnv) => {
    const token = tokens[idx]
    const src = token.attrGet('src') ?? ''
    const alt = token.children?.map((c) => c.content).join('') ?? ''
    if (youtubeEmbedId(src)) return embedHtml(src, env)
    const resolved = /^(https?|data|vault):/.test(src) ? src : vaultUrl(resolveRelative(src, env))
    if (/^https?:/.test(src)) {
      let from = ''
      try {
        const host = new URL(src).hostname.replace(/^www\./, '')
        from = /wikimedia|wikipedia/.test(host) ? 'Wikimedia Commons' : host
      } catch {
        // no source line
      }
      return `<span class="web-figure"><img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy">${alt || from ? `<span class="web-figure-cap">${escapeHtml(alt)}${from ? `<span class="web-figure-src">${escapeHtml(from)}</span>` : ''}</span>` : ''}</span>`
    }
    return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy">`
  }

  // Links to other notes stay in the app, web links open in the browser
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
  md.renderer.rules.link_open = (tokens: Token[], idx, opts, env: RenderEnv, self) => {
    const href = tokens[idx].attrGet('href') ?? ''
    if (/^https?:/.test(href)) {
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('class', 'external')
    } else if (!href.startsWith('#')) {
      tokens[idx].attrSet('data-href', resolveRelative(href, env))
      tokens[idx].attrSet('href', '#')
      tokens[idx].attrSet('class', 'wikilink')
    }
    return defaultLinkOpen(tokens, idx, opts, env, self)
  }

  // A link to one of the interactive explainers Tide trusts, standing alone in its paragraph or
  // list item, is shown as a small card saying what you can do there. In the middle of a sentence
  // it stays an ordinary link.
  md.core.ruler.after('linkify', 'explore_cards', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      const kids = token.children.filter((k) => !(k.type === 'softbreak' || (k.type === 'text' && /^[\s.:;,–—-]*$/.test(k.content))))
      if (kids.length < 3 || kids[0].type !== 'link_open' || kids[kids.length - 1].type !== 'link_close') continue
      if (kids.some((k, i) => i > 0 && k.type === 'link_open')) continue
      const explainer = explainerForUrl(kids[0].attrGet('href') ?? '')
      if (!explainer) continue
      const card = new state.Token('html_inline', '', 0)
      card.content = exploreCard(explainer)
      token.children = [card]
    }
  })

  // Top-level blocks carry their source lines so tutor threads can anchor to them
  md.core.ruler.push('block_lines', (state) => {
    for (const token of state.tokens) {
      if (token.level === 0 && token.map && (token.nesting === 1 || token.type === 'fence' || token.type === 'math_block' || token.type === 'hr')) {
        token.attrSet('data-line', String(token.map[0]))
        token.attrSet('data-line-end', String(token.map[1]))
      }
    }
  })
  const fenceRule = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    // [source-led] a reading Tide put into a lesson: the source's words under their attribution (lib/reading.ts)
    if (tokens[idx].info.trim() === 'reading') return readingHtml(tokens[idx].content, (m) => md.render(m, env))
    const html = fenceRule(tokens, idx, opts, env, self)
    const t = tokens[idx]
    return t.attrGet('data-line') !== null
      ? html.replace('<pre ', `<pre data-line="${t.attrGet('data-line')}" data-line-end="${t.attrGet('data-line-end')}" `)
      : html
  }

  // Task list checkboxes
  md.core.ruler.after('inline', 'tasks', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children?.length) continue
      const first = token.children[0]
      const m = first.type === 'text' && first.content.match(/^\[([ xX])\]\s+/)
      if (!m) continue
      first.content = first.content.slice(m[0].length)
      const box = new state.Token('html_inline', '', 0)
      box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `
      token.children.unshift(box)
    }
  })

  return md
}

const instance = createMarkdown()

export interface Frontmatter {
  data: Record<string, string>
  body: string
}

/** Splits YAML frontmatter from the body, keeping simple key: value pairs for display. */
export function splitFrontmatter(raw: string): Frontmatter {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { data: {}, body: raw }
  const data: Record<string, string> = {}
  let lastKey = ''
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) {
      lastKey = kv[1]
      data[lastKey] = kv[2].replace(/^["']|["']$/g, '')
    } else if (lastKey && /^\s*-\s+/.test(line)) {
      const item = line.replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '')
      data[lastKey] = data[lastKey] ? `${data[lastKey]}, ${item}` : item
    }
  }
  return { data, body: raw.slice(m[0].length) }
}

export function renderMarkdown(body: string, env: RenderEnv): string {
  return sanitize(instance.render(normalizeMath(body), env))
}
