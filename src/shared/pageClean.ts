/**
 * A lesson's text without the noise around it: the badges, "Register here" banners, "Join our
 * Slack" bars, sponsor and newsletter sections, contributor avatars, tracking pixels, testimonials
 * and "Back to top" links that course READMEs and web articles carry and that aren't the lesson.
 *
 * It reads the Markdown as blocks (a paragraph, a list, an HTML block, a fenced code block, a
 * heading) and hides:
 *  - whole sections whose heading names noise ("Sponsors", "Community notes", "Learner stories")
 *  - blocks that are only badges, avatars, tracking pixels or a promotional banner
 *  - link bars that mostly point at Slack, Discord, Telegram, sign-up forms and social sites
 *  - short call-outs to register, subscribe, star the repo, join a community or sponsor it
 *  - repository navigation Tide already has: "Back to top", "Previous | Next", "Edit this page"
 *
 * It is conservative: code, maths, a diagram, a link to the lesson's own materials (its files,
 * videos, slides, notebooks, homework) and anything a course's `keep` rules name are never hidden
 * outside a section that is noise as a whole. Nothing is lost either: the result keeps every block
 * in order (`segments`), so the reader can show the original with the hidden parts marked.
 */

export type NoiseKind = 'ads' | 'badges' | 'sign-up' | 'community' | 'sponsors' | 'promotion' | 'repo' | 'tracking' | 'navigation'

export interface HiddenItem {
  kind: NoiseKind
  /** A few words saying what it was: a section's heading, or the start of its text */
  what: string
}

/** The page, block by block in order: what was hidden, and lines with a badge taken out of them */
export interface CleanSegment {
  text: string
  hidden?: NoiseKind
  /** The text as shown cleaned, when something inside it was taken out (a badge in a line of prose) */
  clean?: string
}

/** What cleaning did to a page, sent with it so the reader can say so and show the original */
export interface PageCleaning {
  hidden: HiddenItem[]
  segments: CleanSegment[]
}

/** A course's own rules (courseCatalogue `clean`): regular expressions matched against a section's heading or a block's text */
export interface CleanRules {
  /** Never hidden */
  keep?: string[]
  /** Always hidden */
  drop?: string[]
}

export interface CleanOptions {
  /** A course's lesson (the default) or an article from the web, which has its own noise ("Related posts", "Share this") */
  mode?: 'course' | 'article'
  /** owner/name: links into it are the course's own materials */
  repo?: string
  rules?: CleanRules
  /** Whether a picture or a link goes to an ad or a tracker (main/adblock's filter lists, for an article from the web) */
  blocked?: (url: string, kind: 'image' | 'link') => boolean
}

export interface CleanResult {
  markdown: string
  /** Null when nothing was hidden */
  cleaning: PageCleaning | null
}

const LABELS: Record<NoiseKind, [string, string]> = {
  ads: ['ad', 'ads'],
  badges: ['badge', 'badges'],
  'sign-up': ['sign-up call-out', 'sign-up call-outs'],
  community: ['community link', 'community links'],
  sponsors: ['sponsor section', 'sponsor sections'],
  promotion: ['promotion', 'promotions'],
  repo: ['repository notice', 'repository notices'],
  tracking: ['tracking pixel', 'tracking pixels'],
  navigation: ['navigation link', 'navigation links']
}

/** "3 badges, 2 sign-up call-outs" */
export function describeHidden(hidden: HiddenItem[]): string {
  const n = new Map<NoiseKind, number>()
  for (const h of hidden) n.set(h.kind, (n.get(h.kind) ?? 0) + 1)
  return [...n].map(([k, c]) => `${c} ${LABELS[k][c === 1 ? 0 : 1]}`).join(', ')
}

// ---------- Blocks ----------

type BlockKind = 'front' | 'code' | 'math' | 'html' | 'comment' | 'region' | 'heading' | 'text' | 'rule' | 'blank'

interface Block {
  kind: BlockKind
  /** Exactly as written, with the blank lines after it */
  raw: string
  level?: number
  heading?: string
  /** A marked region's name (<!-- NAME START --> … <!-- NAME END -->) */
  region?: string
  hidden?: NoiseKind
  clean?: string
  /** Hidden as part of a section hidden as a whole (counted once, with its heading) */
  inSection?: boolean
}

const FENCE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*\n?$/
const HTML_START = /^ {0,3}<(\/?[a-zA-Z][\w-]*)(?:[\s>/]|$)/
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})\n?$/
const REGION = /^\s*<!--\s*([A-Z][A-Z0-9 _-]*?)[\s:-]+START\b/
const blank = (l: string) => /^\s*$/.test(l)

export function splitBlocks(md: string): Block[] {
  const lines = md.split(/(?<=\n)/)
  const out: Block[] = []
  let i = 0
  const push = (b: Block) => out.push(b)
  // Front matter: kept as it is
  if (/^---\s*\n/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l))
    if (end > 0) {
      push({ kind: 'front', raw: lines.slice(0, end + 1).join('') })
      i = end + 1
    }
  }
  while (i < lines.length) {
    const l = lines[i]
    if (blank(l)) {
      const prev = out[out.length - 1]
      if (prev) prev.raw += l
      else push({ kind: 'blank', raw: l })
      i++
      continue
    }
    const fence = l.match(FENCE)
    if (fence) {
      const ch = fence[1][0]
      const len = fence[1].length
      let j = i + 1
      while (j < lines.length && !new RegExp(`^\\s*(?:>\\s*)*\\${ch}{${len},}\\s*$`).test(lines[j])) j++
      push({ kind: 'code', raw: lines.slice(i, Math.min(j + 1, lines.length)).join('') })
      i = j + 1
      continue
    }
    if (/^\s*\$\$\s*$/.test(l)) {
      let j = i + 1
      while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j])) j++
      push({ kind: 'math', raw: lines.slice(i, Math.min(j + 1, lines.length)).join('') })
      i = j + 1
      continue
    }
    const atx = l.match(ATX)
    if (atx) {
      push({ kind: 'heading', raw: l, level: atx[1].length, heading: atx[2] })
      i++
      continue
    }
    const region = l.match(REGION)
    if (region) {
      const name = region[1].trim()
      const endRe = new RegExp(`<!--\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:-]+END\\b`)
      const j = lines.findIndex((x, k) => k > i && endRe.test(x))
      if (j > i) {
        push({ kind: 'region', raw: lines.slice(i, j + 1).join(''), region: name })
        i = j + 1
        continue
      }
    }
    if (/^\s*<!--/.test(l)) {
      let j = i
      while (j < lines.length && !lines[j].includes('-->')) j++
      push({ kind: 'comment', raw: lines.slice(i, Math.min(j + 1, lines.length)).join('') })
      i = j + 1
      continue
    }
    if (HTML_START.test(l)) {
      let j = i + 1
      while (j < lines.length && !blank(lines[j])) j++
      const raw = lines.slice(i, j).join('')
      const h = raw.match(/^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*$/i)
      push(h ? { kind: 'heading', raw, level: Number(h[1]), heading: stripTags(h[2]) } : { kind: 'html', raw })
      i = j
      continue
    }
    if (RULE.test(l)) {
      push({ kind: 'rule', raw: l })
      i++
      continue
    }
    // A paragraph, a list, a table, a quote: up to a blank line, a heading or a fence
    let j = i + 1
    while (j < lines.length && !blank(lines[j]) && !ATX.test(lines[j]) && !FENCE.test(lines[j]) && !REGION.test(lines[j])) j++
    const raw = lines.slice(i, j).join('')
    const setext = j - i === 2 && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1])
    push(setext ? { kind: 'heading', raw, level: lines[i + 1].trim()[0] === '=' ? 1 : 2, heading: lines[i].trim() } : { kind: 'text', raw })
    i = j
  }
  return out
}

// ---------- What a block holds ----------

interface Link {
  text: string
  href: string
}
interface Img {
  alt: string
  src: string
  w?: number
  h?: number
}
interface Parts {
  text: string
  words: number
  links: Link[]
  images: Img[]
  /** Characters of link text: with `text`, how much of it is links */
  linkChars: number
}

const ENT: Record<string, string> = { nbsp: ' ', middot: '·', amp: '&', lt: '<', gt: '>', quot: '"', bull: '•', vert: '|', mdash: '—', ndash: '–', larr: '←', rarr: '→', uarr: '↑', '#39': "'" }
const entities = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENT[e] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m))
function stripTags(s: string) {
  return entities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((x) => x !== undefined)

const MD_IMG = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g
const MD_REF_IMG = /!\[([^\]]*)\]\[([^\]]*)\]/g
const MD_LINK = /(?<!!)\[((?:[^[\]]|\[(?:[^[\]]|\[[^\]]*\])*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g
const MD_REF_LINK = /(?<![!\]])\[((?:[^[\]]|\[[^\]]*\])+)\]\[([^\]]*)\]/g
const HTML_A = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const HTML_IMG = /<img\b[^>]*>/gi

/** Reference definitions ([id]: url) of the whole page, which links and images anywhere may use */
export function referenceDefs(md: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const d of md.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm)) m.set(d[1].toLowerCase(), d[2])
  return m
}

function partsOf(raw: string, refs: Map<string, string>): Parts {
  const images: Img[] = []
  const links: Link[] = []
  for (const m of raw.matchAll(MD_IMG)) images.push({ alt: m[1], src: m[2] })
  for (const m of raw.matchAll(MD_REF_IMG)) images.push({ alt: m[1], src: refs.get((m[2] || m[1]).toLowerCase()) ?? '' })
  for (const m of raw.matchAll(HTML_IMG)) {
    const w = Number(attr(m[0], 'width'))
    const h = Number(attr(m[0], 'height'))
    images.push({ alt: attr(m[0], 'alt') ?? '', src: attr(m[0], 'src') ?? '', ...(Number.isFinite(w) && attr(m[0], 'width') ? { w } : {}), ...(Number.isFinite(h) && attr(m[0], 'height') ? { h } : {}) })
  }
  // Text without pictures, then links as their words
  let t = raw.replace(MD_IMG, ' ').replace(MD_REF_IMG, ' ').replace(HTML_IMG, ' ')
  t = t.replace(MD_LINK, (_, txt: string, href: string) => {
    const words = txt.replace(MD_IMG, ' ').replace(HTML_IMG, ' ').replace(/[[\]]/g, ' ').trim()
    links.push({ text: stripTags(words), href })
    return ` ${words} `
  })
  t = t.replace(MD_REF_LINK, (_, txt: string, id: string) => {
    links.push({ text: stripTags(txt), href: refs.get((id || txt).toLowerCase()) ?? '' })
    return ` ${txt} `
  })
  t = t.replace(HTML_A, (_, attrs: string, inner: string) => {
    const words = stripTags(inner.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '))
    links.push({ text: words, href: attr(`<a ${attrs}>`, 'href') ?? '' })
    return ` ${words} `
  })
  // Reference definitions, markup and the separators of a link bar aren't words
  t = t.replace(/^ {0,3}\[[^\]]+\]:\s*\S+.*$/gm, ' ')
  const text = stripTags(t)
    .replace(/(^|\s)(?:[-*+>|•·]|\d+[.)])(?=\s|$)/g, ' ')
    .replace(/[*_`~#|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const linkChars = links.reduce((n, l) => n + l.text.replace(/\s+/g, '').length, 0)
  return { text, words: text ? text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0, links, images, linkChars }
}

// ---------- Where links and pictures go ----------

function urlOf(href: string): URL | null {
  try {
    return new URL(href, 'https://relative.invalid/')
  } catch {
    return null
  }
}

const BADGE_HOSTS = /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|forthebadge\.com|travis-ci\.(org|com)|circleci\.com|codecov\.io|coveralls\.io|codacy\.com|snyk\.io|codeclimate\.com|readthedocs\.org|appveyor\.com|pepy\.tech|badgesize\.io|gitter\.im|awesome\.re|deepsource\.io|sonarcloud\.io|codefactor\.io|dcbadge\.(limes\.pink|vercel\.app)|herokucdn\.com|bestpractices\.coreinfrastructure\.org|zenodo\.org|anaconda\.org|tokei\.rs|hitsofcode\.com|wakatime\.com|discordapp\.com|bundlephobia\.com|packagephobia\.com|github-readme-stats\.vercel\.app|github-readme-streak-stats\.herokuapp\.com)$/i
/** Pictures that are a way into the lesson (Open in Colab, Launch Binder), even when they look like badges */
const LESSON_BADGE = /\b(colab|binder|kaggle|deepnote|sagemaker|studiolab|gitpod|codespaces|nbviewer|lightning|paperspace|launch|watch|video|slides?|youtube)\b|\bopen[ %_-]?in\b|\brun[ %_-]?(it|on|in)\b/i
const TRACKER_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|ga-beacon\.appspot\.com|komarev\.com|visitor-badge\.(laobi\.icu|glitch\.me)|visitorbadge\.io|seeyoufarm\.com|hits\.dwyl\.com|profile-counter\.glitch\.me|count\.getloli\.com|scarf\.sh|pixel\.wp\.com|stats\.wp\.com|doubleclick\.net|facebook\.com\/tr|bat\.bing\.com|ads\.linkedin\.com|analytics\.[\w.-]+|matomo\.[\w.-]+|plausible\.io|hit-counter\.[\w.-]+|hitwebcounter\.com|statcounter\.com|counter\.[\w.-]+|trk\.[\w.-]+|sendgrid\.net|list-manage\.com\/track|mailchimp\.com\/track)$/i
const AVATAR = /(^|\.)(avatars\.githubusercontent\.com|contrib\.rocks|allcontributors\.org|sourcerer\.io)$|opencollective\.com\/[^/]+\/(backers|sponsors|contributors|organization|individual)|^github\.com\/[^/]+\.png/i
const STARS = /(^|\.)(star-history\.com|starchart\.cc|repobeats\.axiom\.co)$/i
const SOCIAL = /(^|\.)(slack\.com|discord\.gg|discord\.com|discordapp\.com|t\.me|telegram\.me|twitter\.com|x\.com|linkedin\.com|facebook\.com|fb\.me|instagram\.com|tiktok\.com|bsky\.app|threads\.net|mastodon\.social|reddit\.com|campaign-archive\.com|mailchi\.mp|eepurl\.com|substack\.com|lu\.ma|luma\.com|meetup\.com|eventbrite\.[\w.]+|whatsapp\.com|chat\.whatsapp\.com|wa\.me|gitter\.im|patreon\.com|ko-fi\.com|buymeacoffee\.com|opencollective\.com)$/i
const SIGNUP_PATH = /\/(register|registration|signup|sign-up|subscribe|newsletter|join|slack(\.html)?|discord|community|waitlist|enroll)(\/|\.html|$|\?)/i
const FORM_HOSTS = /(^|\.)(forms\.gle|airtable\.com|typeform\.com|tally\.so|jotform\.com|surveymonkey\.com)$|^docs\.google\.com\/forms/i

/** A picture of a badge (not one that opens the lesson's notebook or video) */
function isBadge(img: Img, link?: string): boolean {
  const u = urlOf(img.src)
  if (!u) return false
  const badge = BADGE_HOSTS.test(u.hostname) || /\/badges?(\/|\.svg|$)|badge\.svg|\/shields?\//i.test(u.pathname) || (u.hostname === 'github.com' && /\/(workflows|actions)\/.*badge/i.test(u.pathname))
  if (!badge) return false
  return !(LESSON_BADGE.test(img.alt) || LESSON_BADGE.test(decodeURIComponent(u.pathname)) || (link && isMaterial(link, undefined, true)))
}
function isTracker(img: Img): boolean {
  if ((img.w !== undefined && img.w <= 1) || (img.h !== undefined && img.h <= 1)) return true
  const u = urlOf(img.src)
  return !!u && (TRACKER_HOSTS.test(u.hostname) || TRACKER_HOSTS.test(`${u.hostname}${u.pathname}`) || /\/(pixel|beacon|track|tracking|collect)(\.gif|\.png|\/|\?|$)/i.test(u.pathname))
}
const isAvatar = (img: Img) => {
  const u = urlOf(img.src)
  return !!u && (AVATAR.test(u.hostname) || AVATAR.test(`${u.hostname}${u.pathname}`))
}
const isStars = (img: Img) => {
  const u = urlOf(img.src)
  return !!u && STARS.test(u.hostname)
}
/** Profiles on a social site: a link to one counts as a community link only when it names the site (or is an icon), not a person */
const PROFILE_HOSTS = /(^|\.)(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|tiktok\.com|bsky\.app|threads\.net|mastodon\.social|reddit\.com|github\.com|youtube\.com)$/i
const PLATFORM_WORDS = /^(twitter|x|linkedin|facebook|instagram|tiktok|bluesky|threads|mastodon|reddit|youtube( channel)?|github|website|blog|events?|newsletter|slack|discord|telegram|follow( us)?( on .*)?|join( us)?( on .*)?|subscribe|community)$/i
function isSocialLink(l: Link): boolean {
  if (!isSocial(l.href)) return false
  const u = urlOf(l.href)
  return !(u && PROFILE_HOSTS.test(u.hostname)) || !l.text.trim() || PLATFORM_WORDS.test(l.text.trim())
}

function isSocial(href: string): boolean {
  const u = urlOf(href)
  if (!u || u.hostname === 'relative.invalid') return false
  if (/^mailto:/i.test(href)) return false
  if (SOCIAL.test(u.hostname) || FORM_HOSTS.test(u.hostname) || FORM_HOSTS.test(`${u.hostname}${u.pathname}`)) return true
  // A YouTube or GitHub channel itself, not a video or a file in it
  if (/(^|\.)youtube\.com$/.test(u.hostname) && /^\/(@|c\/|channel\/|user\/)/.test(u.pathname)) return true
  if (/(^|\.)aka\.ms$/.test(u.hostname) && /discord|slack|community/i.test(u.pathname)) return true
  return SIGNUP_PATH.test(u.pathname)
}

/**
 * A link to the lesson's own materials: a file of the course, a video, slides, a notebook, homework.
 * `loose` also counts any notebook runner (Colab, Binder) and video, wherever it is.
 */
function isMaterial(href: string, repo?: string, loose = false): boolean {
  if (!href || href.startsWith('#') || /^mailto:/i.test(href)) return false
  const u = urlOf(href)
  if (!u) return false
  const path = decodeURIComponent(u.pathname)
  if (u.hostname === 'relative.invalid') return !/(^|\/)(LICEN[CS]E|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|translations?)(\/|\.|$)/i.test(path)
  if (repo) {
    const r = repo.toLowerCase()
    const p = `${u.hostname}${u.pathname}`.toLowerCase()
    if ((p.startsWith(`github.com/${r}/blob/`) || p.startsWith(`github.com/${r}/tree/`) || p.startsWith(`raw.githubusercontent.com/${r}/`)) && !/\/(LICEN[CS]E|CONTRIBUTING|CODE_OF_CONDUCT)(\.|$)|\/translations?\//i.test(path)) return true
  }
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(u.hostname) && (/^\/(watch|embed|playlist|live|shorts)/.test(u.pathname))) return true
  if (u.hostname === 'youtu.be') return true
  if (/\.(ipynb|pdf|pptx?|key|csv|parquet|py|r|sql|zip)$/i.test(path)) return true
  if (/(^|\.)(slideshare\.net|speakerdeck\.com|colab\.research\.google\.com|mybinder\.org|nbviewer\.org|kaggle\.com|deepnote\.com|loom\.com|vimeo\.com)$/.test(u.hostname)) return true
  if (u.hostname === 'docs.google.com' && /^\/presentation/.test(u.pathname)) return true
  if (loose) return false
  return /homework|assignment|exercise|solution|lecture|slides|notebook|videos?\b/i.test(path)
}

// ---------- Rules ----------

const norm = (s: string) =>
  stripTags(s.replace(MD_IMG, ' ').replace(MD_LINK, '$1'))
    .replace(/[^\p{L}\p{N}\s&'.-]+/gu, ' ')
    .replace(/^\s*(\d+(\.\d+)*\.?|[ivx]+\.)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.]+$/, '')

/** Section headings that name noise: the section goes as a whole */
const SECTIONS: [NoiseKind, RegExp][] = [
  ['community', /^(community notes|community (and|&) support|support (and|&) community|getting help on (slack|discord|telegram)|join (our|the) (community|slack|discord|telegram)( (server|channel|workspace))?|join us( on (slack|discord|telegram))?|stay (in touch|connected|updated|tuned)|follow us( on .*)?|social( media| links)?|connect with us|learning in public|community)$/],
  ['sign-up', /^(newsletter|subscribe( to (our|the) newsletter)?|sign ?up( for (the|our) (newsletter|course|cohort))?|register( for the course| here| now)?|registration|join the (course|cohort|next cohort)|get (notified|updates))$/],
  ['sponsors', /^(sponsors?|our sponsors|sponsorship|course sponsors|backers|supporters|support (us|the project|this project|our work)|donat(e|ions?)|funding|thanks to our sponsors|sponsored by)$/],
  ['repo', /^(contributors?|our contributors|contributing|how to contribute|contribution guidelines|contributions?|code of conduct|star history|stargazers( over time)?|acknowledge?ments?|credits|licen[cs]e|licen[cs]ing|repository stats)$/],
  ['promotion', /^(learner stories|student stories|testimonials|success stories|what (students|people|learners|our students|users|others|participants|graduates) (say|said|are saying)( about .*)?|other courses|more courses( from us)?|related courses|check out (our )?other courses|about (datatalks\.?club|datatalks\.club|the organi[sz]ation|us|the authors?|the team)|(get|download|grab) (your|the|my|a) free .*|discover how .*|.*\b(e-?book|mind ?map|cheat ?sheet|mini-course)\b.*free.*|free .*\b(e-?book|mind ?map|cheat ?sheet|mini-course)\b.*)$/],
  ['navigation', /^(multi-?language support|translations?|other languages|available languages|read this in other languages)$/]
]
/** In an article from the web, as well */
const ARTICLE_SECTIONS: [NoiseKind, RegExp][] = [
  ['promotion', /^(related( posts| articles| reading| stories| content)?|you (may|might) also like|recommended( for you| reading| articles)?|more from .*|more stories|popular (posts|articles)|trending|read next|up next|about the authors?|written by .*|share (this|on)( .*)?|comments?|leave a (reply|comment)|responses|discussion|advertisement|sponsored( content)?|tags)$/],
  ['sign-up', /^(subscribe .*|sign up .*|join .* newsletter|never miss .*|get (the|our) .*newsletter.*|stay (up to date|informed).*)$/]
]

const CTA: [NoiseKind, RegExp][] = [
  ['promotion', /(⭐|🌟)\s*star\b|\bstar (this|the|our) (repo|repository|project)\b|\bgive (us|it|this( repo)?) a (⭐|star)\b|\bleave a (⭐|star)\b|\bif you (like|find|enjoy)[^.]{0,40}(⭐|star)\b/i],
  ['sign-up', /\b(register (here|now|today|for (the|this|our|free|it|a))|sign[ -]?up (here|now|today|for( (the|our|a|free))?|to (get|receive|be notified|our))|sign-?up form|subscribe (to|for|here|now|today)|newsletter|mailing list|get (notified|updates|announcements)|be notified|announcements? channel)\b/i],
  ['community', /\bjoin (us|our|the|my)\b[^.\n]{0,60}\b(slack|discord|telegram|community|channel|server|workspace|group)\b|\b(slack|discord|telegram) (community|channel|server|workspace|group)\b|\b(PRs? (are )?welcome|send (us )?a (PR|pull request)[^.]{0,40}(notes|links)|add your (notes|link)|did you take notes|share (them|your notes) here|feel free to (add|contribute|open a (PR|pull request)))\b/i],
  ['sponsors', /\b(sponsored by|sponsor(ing)? (us|this|the (course|project))|interested in (sponsoring|supporting)|support (us|the project|our work|this project)|donate|donation|buy me a coffee|patreon|ko-fi|open ?collective|github sponsors)\b/i]
]
const ARTICLE_CTA: [NoiseKind, RegExp][] = [
  ['promotion', /\b(e-?book|mini-course|free (pdf|guide|cheat ?sheet|mind ?map|trial|course)|discount|coupon|limited time|see what'?s inside|enrol(l)? now|get started|start (your )?free|learn to code for free|upgrade to|become a member|member-only|members only|open in app|download (the|our) app)\b/i],
  ['sign-up', /\b(sign in|sign up|log in|create (a )?(free )?account|subscribe|newsletter|get (the|our) (latest|best)|in your inbox|enter your email|your email address)\b/i],
  ['community', /\b(share (this|on)|follow (us|me|on)|tweet this|share on (twitter|x|facebook|linkedin))\b/i],
  ['repo', /\b(cookies?|privacy policy|terms of (use|service)|all rights reserved|©)\b/i]
]
/** A link that is itself the call to action */
const ARTICLE_CALL = /^(get started( for free| now)?|sign ?up( now| for free| free)?|subscribe( now)?|join( now| us| free| for free)?|start (your )?free( trial)?|start (learning|for free)|see what'?s inside|learn more|buy( now| the book)?|enrol+( now)?|download( (now|it|the (app|ebook|guide)))?|try (it )?(for )?free|register( now)?|become a member|upgrade( now)?|open in app|get (the|my|your) (free )?(ebook|guide|cheat ?sheet|mind ?map|course))$/i
/** A pitch plain enough to go without a link that calls */
const ARTICLE_PITCH = /\b(e-?book|mini-course|discount|coupon|limited time|see what'?s inside|learn to code for free|member-only|members only|become a member)\b/i
const NAV_WORDS = /^(?:[←⬅«‹<↑⬆🔝]+\s*)?(previous|prev|next|back|home|up|top|index|contents|table of contents|go back|return|back to (the )?(top|contents|index|course|module|readme|main( page)?|home))\b|(?:→|➡|»|›|>)\s*$|^[←⬅«‹→➡»›↑⬆]+$/i
const EDIT_WORDS = /^(edit (this|on|the) (page|github|file)|edit this page|improve this page|suggest (an )?edit|report an issue|view (the )?source|open an issue|view on github|edit on github)$/i
const BACK_TO_TOP = /^(?:[⬆↑🔝^]\s*)?back to (the )?top(?:\s*[⬆↑🔝^])?$/i

interface Ctx {
  repo?: string
  mode: 'course' | 'article'
  keep: RegExp[]
  drop: RegExp[]
  refs: Map<string, string>
  blocked?: (url: string, kind: 'image' | 'link') => boolean
}

const compile = (xs: string[] | undefined) =>
  (xs ?? []).flatMap((x) => {
    try {
      return [new RegExp(x, 'i')]
    } catch {
      return []
    }
  })

function sectionKind(heading: string, ctx: Ctx): NoiseKind | null {
  const h = norm(heading)
  if (!h) return null
  if (ctx.keep.some((r) => r.test(h))) return null
  if (ctx.drop.some((r) => r.test(h))) return 'promotion'
  for (const [k, re] of SECTIONS) if (re.test(h)) return k
  if (ctx.mode === 'article') for (const [k, re] of ARTICLE_SECTIONS) if (re.test(h)) return k
  return null
}

/** Pictures and links a block's noise is made of, taken out of it: what's left is the lesson */
function withoutNoise(raw: string, ctx: Ctx): { text: string; took: NoiseKind[] } {
  const took: NoiseKind[] = []
  const noise = (img: Img, link?: string): NoiseKind | null =>
    isTracker(img) ? 'tracking' : ctx.blocked && (ctx.blocked(img.src, 'image') || (link && ctx.blocked(link, 'link'))) ? 'ads' : isBadge(img, link) ? 'badges' : isAvatar(img) ? 'repo' : isStars(img) ? 'promotion' : null
  let t = raw
  // A linked picture: [![alt](src)](href) and <a href><img></a>
  t = t.replace(/\[\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)\s*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g, (m, alt: string, src: string, href: string) => {
    const k = noise({ alt, src }, href)
    if (!k) return m
    took.push(k)
    return ''
  })
  t = t.replace(/\[\s*!\[([^\]]*)\]\[([^\]]*)\]\s*\]\[([^\]]*)\]/g, (m, alt: string, id: string, lid: string) => {
    const k = noise({ alt, src: ctx.refs.get((id || alt).toLowerCase()) ?? '' }, ctx.refs.get(lid.toLowerCase()))
    if (!k) return m
    took.push(k)
    return ''
  })
  t = t.replace(/<a\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/a>/gi, (m, attrs: string, img: string) => {
    const k = noise({ alt: attr(img, 'alt') ?? '', src: attr(img, 'src') ?? '', ...(attr(img, 'width') ? { w: Number(attr(img, 'width')) } : {}), ...(attr(img, 'height') ? { h: Number(attr(img, 'height')) } : {}) }, attr(`<a ${attrs}>`, 'href'))
    if (!k) return m
    took.push(k)
    return ''
  })
  t = t.replace(MD_IMG, (m, alt: string, src: string) => {
    const k = noise({ alt, src })
    if (!k) return m
    took.push(k)
    return ''
  })
  t = t.replace(HTML_IMG, (m) => {
    const k = noise({ alt: attr(m, 'alt') ?? '', src: attr(m, 'src') ?? '', ...(attr(m, 'width') ? { w: Number(attr(m, 'width')) } : {}), ...(attr(m, 'height') ? { h: Number(attr(m, 'height')) } : {}) })
    if (!k) return m
    took.push(k)
    return ''
  })
  return { text: t, took }
}

const majority = (ks: NoiseKind[]): NoiseKind => {
  const n = new Map<NoiseKind, number>()
  for (const k of ks) n.set(k, (n.get(k) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0][0]
}

/** What a block (not a heading, not code) is, when it is noise */
function blockKind(b: Block, ctx: Ctx): { kind?: NoiseKind; clean?: string; inline?: NoiseKind } {
  if (b.kind === 'region') {
    const n = b.region!.toUpperCase()
    if (/CONTRIBUTOR/.test(n)) return { kind: 'repo' }
    if (/LANGUAGE|TRANSLAT/.test(n)) return { kind: 'navigation' }
    if (/OTHER COURSES|SPONSOR|PROMO|BANNER|AD\b/.test(n)) return { kind: /SPONSOR/.test(n) ? 'sponsors' : 'promotion' }
  }
  if (b.kind !== 'text' && b.kind !== 'html' && b.kind !== 'region') return {}
  const p = partsOf(b.raw, ctx.refs)
  const flat = p.text
  if (ctx.keep.some((r) => r.test(flat))) return {}
  if (flat && ctx.drop.some((r) => r.test(flat))) return { kind: 'promotion' }
  // Code inside the block (inline code in prose is fine; a <pre> is code)
  if (/<pre\b|<code\b[^>]*>[\s\S]{80,}/i.test(b.raw)) return {}
  const material = p.links.some((l) => isMaterial(l.href, ctx.repo))

  // Badges, avatars, pixels and star charts: the block goes when nothing else is left in it
  const { text: rest, took } = withoutNoise(b.raw, ctx)
  if (took.length) {
    const left = partsOf(rest, ctx.refs)
    if (!left.words && !left.images.length && !left.links.some((l) => l.text)) return { kind: majority(took) }
    // Prose with a badge in it: the badge goes, the prose stays
    const tidy = rest.replace(/[ \t]+$/gm, '').replace(/^\s*[|•·]\s*$/gm, '')
    return { ...blockText(b, p, material, ctx), clean: tidy, inline: majority(took) }
  }
  return blockText(b, p, material, ctx)
}

function blockText(b: Block, p: Parts, material: boolean, ctx: Ctx): { kind?: NoiseKind } {
  const flat = p.text
  const links = p.links.filter((l) => l.href && !l.href.startsWith('#'))
  // Back to top, edit this page, previous | next
  if (BACK_TO_TOP.test(flat) || (p.links.length && p.links.every((l) => BACK_TO_TOP.test(l.text)) && p.words <= 6)) return { kind: 'navigation' }
  if (EDIT_WORDS.test(flat)) return { kind: 'navigation' }
  if (p.links.length && p.linkChars >= flat.replace(/\s+/g, '').length * 0.7 && p.links.every((l) => NAV_WORDS.test(l.text.trim()) || EDIT_WORDS.test(l.text.trim())) && p.words <= 24) return { kind: 'navigation' }

  // Links to ad networks, in a line or two
  if (ctx.blocked && links.length && p.words <= 40 && links.every((l) => ctx.blocked!(l.href, 'link'))) return { kind: 'ads' }
  // A banner: pictures (no words of its own) linking to a sign-up form, a community or a sponsor
  if (p.images.length && p.words <= 3 && links.length && links.every(isSocialLink) && !material) return { kind: links.some((l) => /regist|sign-?up|subscribe|enrol/i.test(l.href)) ? 'sign-up' : 'promotion' }
  if (p.images.length && p.words <= 3 && !material && p.images.every((i) => /\b(register|sign ?up|join|subscribe|sponsor|advert|advertisement|banner|promo)\b/i.test(i.alt))) return { kind: /register|sign|subscribe/i.test(p.images.map((i) => i.alt).join(' ')) ? 'sign-up' : 'promotion' }

  // A bar of links, half or more of them to Slack, Telegram, sign-up forms, social sites
  const social = links.filter(isSocialLink).length
  const dense = p.linkChars >= flat.replace(/\s+/g, '').length * 0.6
  if (links.length >= 2 && dense && social / links.length >= 0.5 && p.words <= 60) return { kind: 'community' }
  // A table of links: the rows that are sign-up or community go (a table that is only those goes as a whole)
  // (handled by tableRows, which rewrites the block)

  // A short call-out: register, subscribe, star the repo, join the Slack, sponsor us (never a table: that's information)
  const table = /^\s*\|.*\|\s*$/m.test(b.raw) && /^\s*\|?\s*:?-+:?\s*\|/m.test(b.raw)
  const short = p.words <= (ctx.mode === 'article' ? 70 : 60)
  if (short && !table && !/`[^`]+`/.test(b.raw)) {
    const nonMaterial = !links.some((l) => isMaterial(l.href, ctx.repo))
    // In an article, a mention in passing ("announced in Slack and the newsletter") isn't a call: the link has to be one
    const pointsOut = links.some((l) => (isSocialLink(l) || /[?&]utm_(campaign|medium)=|^mailto:/i.test(l.href)) && (ctx.mode === 'course' || ARTICLE_CALL.test(l.text.trim())))
    for (const [k, re] of CTA) {
      if (!re.test(flat)) continue
      // Starring the repo and sponsoring are noise wherever they are; signing up and joining only when they point at the form or the community
      if (k === 'promotion' || ((k === 'sponsors' || pointsOut) && nonMaterial) || (k === 'sign-up' && ctx.mode === 'course' && /\b(cohort|newsletter|announcements?|course platform)\b/i.test(flat) && nonMaterial)) return { kind: k }
    }
    // A referral link to something else, in a line or two
    if (links.length && links.every((l) => /[?&]utm_(campaign|medium)=/i.test(l.href) && !isMaterial(l.href, ctx.repo)) && p.words <= 50) return { kind: 'promotion' }
    // An article's own call to action: the link is the call ("Get started", "Subscribe"), or the pitch is plain (an ebook, a discount)
    if (ctx.mode === 'article' && nonMaterial && p.words <= 45) {
      const callLink = links.some((l) => ARTICLE_CALL.test(l.text.trim()))
      for (const [k, re] of ARTICLE_CTA) {
        if (!re.test(flat)) continue
        if (callLink || (k === 'promotion' && ARTICLE_PITCH.test(flat)) || (k === 'repo' && p.words <= 30 && links.length > 0)) return { kind: k }
      }
    }
  }
  return {}
}

/** A Markdown table's rows that are only sign-up or community links (a "Quick links" table): those rows go */
function tableRows(b: Block, ctx: Ctx): { clean?: string; dropped: number; all: boolean } {
  const lines = b.raw.split(/(?<=\n)/)
  const rows = lines.filter((l) => /^\s*\|/.test(l))
  if (b.kind !== 'text' || rows.length < 3 || rows.length !== lines.filter((l) => !blank(l)).length || !/^\s*\|?\s*:?-+:?\s*(\||$)/.test(rows[1])) return { dropped: 0, all: false }
  const LABEL = /^(register|registration|sign ?up|community|slack( channel| community)?|discord|telegram|announcements|newsletter|sponsors?|follow( us)?|social|join( us)?)$/i
  let dropped = 0
  const keep = lines.filter((l, i) => {
    if (i < 2 || !/^\s*\|/.test(l)) return true
    const cells = l.split('|').slice(1, -1)
    const label = norm(cells[0] ?? '')
    const p = partsOf(cells.slice(1).join(' '), ctx.refs)
    const links = p.links.filter((x) => x.href)
    const noisy = LABEL.test(label) || (links.length > 0 && links.every((x) => isSocial(x.href)) && !links.some((x) => isMaterial(x.href, ctx.repo)))
    if (noisy) dropped++
    return !noisy
  })
  if (!dropped) return { dropped: 0, all: false }
  return { clean: keep.join(''), dropped, all: dropped === rows.length - 2 }
}

// ---------- The page ----------

/** `md` without its noise, and what was hidden (null when nothing was) */
export function cleanPage(md: string, opts: CleanOptions = {}): CleanResult {
  if (!md || !md.trim()) return { markdown: md, cleaning: null }
  const ctx: Ctx = { repo: opts.repo, mode: opts.mode ?? 'course', keep: compile(opts.rules?.keep), drop: compile(opts.rules?.drop), refs: referenceDefs(md), ...(opts.blocked ? { blocked: opts.blocked } : {}) }
  const blocks = splitBlocks(md)
  const hidden: HiddenItem[] = []
  const what = (b: Block) => {
    if (b.heading) return norm(b.heading)
    const p = partsOf(b.raw, ctx.refs)
    return (p.text || p.images.map((i) => i.alt).filter(Boolean).join(', ') || p.links.map((l) => l.text).filter(Boolean).join(', ') || 'a picture').slice(0, 80)
  }

  // Sections that are noise as a whole
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.kind !== 'heading' || b.hidden) continue
    const k = sectionKind(b.heading ?? '', ctx)
    if (!k) continue
    b.hidden = k
    hidden.push({ kind: k, what: b.heading ? norm(b.heading) : what(b) })
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j]
      if (n.kind === 'heading' && (n.level ?? 6) <= (b.level ?? 1)) break
      if (n.kind === 'front') break
      n.hidden = k
      n.inSection = true
    }
  }
  // Blocks that are noise by themselves
  for (const b of blocks) {
    if (b.hidden || b.kind === 'heading' || b.kind === 'front' || b.kind === 'code' || b.kind === 'math') continue
    const rows = tableRows(b, ctx)
    if (rows.dropped) {
      if (rows.all) {
        b.hidden = 'community'
        hidden.push({ kind: 'community', what: what(b) })
      } else {
        b.clean = rows.clean
        hidden.push({ kind: 'sign-up', what: `${rows.dropped} ${rows.dropped === 1 ? 'row' : 'rows'} of a table` })
      }
      continue
    }
    const r = blockKind(b, ctx)
    if (r.kind) {
      b.hidden = r.kind
      hidden.push({ kind: r.kind, what: what(b) })
    } else if (r.clean !== undefined && r.inline) {
      b.clean = r.clean
      hidden.push({ kind: r.inline, what: what(b) })
    }
  }
  // A heading whose whole section went is noise too ("## Links" over a bar of social links)
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.kind !== 'heading' || b.hidden) continue
    const body: Block[] = []
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j]
      if (n.kind === 'heading' && (n.level ?? 6) <= (b.level ?? 1)) break
      if (n.kind === 'comment' || n.kind === 'blank') continue
      body.push(n)
    }
    if (body.length && body.every((n) => n.hidden && n.kind !== 'heading')) {
      b.hidden = majority(body.map((n) => n.hidden!))
      b.inSection = true
    }
  }
  if (!hidden.length) return { markdown: md, cleaning: null }

  // Each hidden block keeps the blank lines after it out of the cleaned text too, but never runs paragraphs together
  let out = ''
  let gap = false
  for (const b of blocks) {
    if (b.hidden) {
      gap = true
      continue
    }
    if (gap && out && !out.endsWith('\n\n')) out = out.replace(/\n?$/, '\n\n')
    gap = false
    out += b.clean ?? b.raw
  }
  const segments: CleanSegment[] = []
  for (const b of blocks) {
    const last = segments[segments.length - 1]
    if (last && last.hidden === b.hidden && !b.clean && !last.clean) last.text += b.raw
    else segments.push({ text: b.raw, ...(b.hidden ? { hidden: b.hidden } : {}), ...(b.clean !== undefined && !b.hidden ? { clean: b.clean } : {}) })
  }
  return { markdown: out.replace(/^\s+/, '').replace(/\s+$/, '') + (md.endsWith('\n') ? '\n' : ''), cleaning: { hidden, segments } }
}

/** The Markdown of a cleaned page, as it was or cleaned: hidden segments dropped, or kept */
export function segmentsText(segments: CleanSegment[], original: boolean): string {
  return segments.map((s) => (s.hidden ? (original ? s.text : '') : original ? s.text : (s.clean ?? s.text))).join('')
}
