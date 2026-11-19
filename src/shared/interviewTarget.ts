/**
 * Interview targets (docs/plans/interview-target.md): one real upcoming interview, kept in the
 * vault under "Interview prep/<Target name>/". Pure: the parsers for each of the target's files,
 * the progress record, readiness per area, the countdowns and today's plan. Main reads the files
 * (main/interviewTarget) and the page shows them (components/interview/InterviewTarget).
 *
 * Nothing here knows about a particular person, company or interview: that all lives in the vault.
 */

export const TARGETS_FOLDER = 'Interview prep'

export type RoundKind = 'behavioural' | 'technical' | 'presentation' | 'hirevue' | 'general'
export const ROUND_KINDS: RoundKind[] = ['behavioural', 'technical', 'presentation', 'hirevue', 'general']

export interface Round {
  id: string
  name: string
  kind: RoundKind
  minutes?: number
  notes?: string
}

export interface TargetMeta {
  slug: string
  /** The folder's name, also the target's name */
  name: string
  /** The folder, vault-relative */
  folder: string
  company: string
  role: string
  /** ISO, local: a day (2026-12-03) or a day and time (2026-12-03T09:30) */
  date?: string
  slidesDue?: string
  sources: string[]
  links: string[]
  rounds: Round[]
  /** The IANA zone the times are in (Europe/London); the Mac's own when not given */
  timezone?: string
  /** The track of modules (Roadmaps/Tracks/<id>.md) that teaches what this interview needs */
  course?: string
  /** target.md's body: free notes */
  notes: string
}

export interface Story {
  id: string
  title: string
  bestFor: string[]
  evidence: string[]
  anchors: string[]
  gaps: string[]
}

export type QuestionKind = 'motivation' | 'behavioural' | 'cv' | 'technical' | 'scenario' | 'presentation-qa' | 'market' | 'closing'
export const QUESTION_KINDS: QuestionKind[] = ['motivation', 'behavioural', 'cv', 'technical', 'scenario', 'presentation-qa', 'market', 'closing']

export interface Question {
  id: string
  text: string
  round?: string
  kind: QuestionKind
  source?: 'reported' | 'likely' | 'cv' | 'brief'
  stories: string[]
  route: string[]
  outline: string[]
  model?: string
}

export interface RubricPoint {
  text: string
  /** risk, mitigation, escalation, board, communication, or general */
  group: string
}

export interface Scenario {
  id: string
  title: string
  parts: string[]
  rubric: RubricPoint[]
}

export interface AssessorQuestion {
  id: string
  question: string
  point: string
}

export interface Presentation {
  checklist: { text: string; done: boolean }[]
  topic: string
  /** Research notes' headings, each a thing that might be taught */
  research: string[]
  assessor: AssessorQuestion[]
  /** Minutes the talk should run; 15 unless the brief says otherwise */
  minutes: number
}

export interface FirmFact {
  section: string
  text: string
  source?: string
  date?: string
}

export interface AskThem {
  groups: { who: string; questions: string[] }[]
  rules: string[]
}

export interface TargetFiles {
  meta: TargetMeta
  stories: Story[]
  questions: Question[]
  scenarios: Scenario[]
  presentation: Presentation | null
  firm: FirmFact[]
  ask: AskThem
  /** Headings of frameworks.md: things the target needs that can be taught */
  frameworks: string[]
}

// ---------- Small text helpers ----------

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'target'

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => clean(String(x ?? ''))).filter(Boolean) : typeof v === 'string' && v.trim() ? [clean(v)] : [])

/** A YAML date (gray-matter turns a bare day into a Date at midnight UTC) as an ISO string */
export function isoOf(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) {
    if (!v.getUTCHours() && !v.getUTCMinutes()) return v.toISOString().slice(0, 10)
    return v.toISOString()
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim()
  return undefined
}

/** Minutes a zone is ahead of UTC at a moment (Europe/London in summer: 60) */
export function zoneOffset(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second')) - Math.floor(at / 1000) * 1000) / 60_000)
}

/** A wall-clock time in a zone as a moment; without a zone, the Mac's own */
function wallTime(y: number, mo: number, d: number, h: number, mi: number, s: number, zone?: string): number {
  if (!zone || !validZone(zone)) return new Date(y, mo, d, h, mi, s).getTime()
  const guess = Date.UTC(y, mo, d, h, mi, s)
  // Twice, so a time near a clock change settles on the right side of it
  let at = guess - zoneOffset(guess, zone) * 60_000
  at = guess - zoneOffset(at, zone) * 60_000
  return at
}

export function validZone(zone: string | undefined): boolean {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * An ISO day or time as a moment. A time with Z or an offset is exact; one without is the
 * wall-clock time in the target's zone (the Mac's when none is given); a bare day is 9am there.
 */
export function momentOf(iso: string | undefined, zone?: string): number | null {
  if (!iso) return null
  const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) return wallTime(+day[1], +day[2] - 1, +day[3], 9, 0, 0, zone)
  const local = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
  if (local) return wallTime(+local[1], +local[2] - 1, +local[3], +local[4], +local[5], +(local[6] ?? 0), zone)
  const t = Date.parse(iso)
  return isNaN(t) ? null : t
}

/** The last word of a zone, as people say it: "Europe/New_York" → "New York" */
export const zoneCity = (zone: string) => zone.split('/').pop()!.replace(/_/g, ' ')

/**
 * When the interview is, for the header: "Wed 25 Nov, 09:00 London · 10:00 your time" when the
 * target's zone differs from the Mac's; just the day for a bare day.
 */
export function whenText(iso: string | undefined, zone: string | undefined, localZone: string): string {
  const at = momentOf(iso, zone)
  if (at === null || !iso) return ''
  const z = zone && validZone(zone) ? zone : localZone
  const dayFmt = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at))
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return dayFmt(z)
  const time = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
  const same = zoneOffset(at, z) === zoneOffset(at, localZone)
  if (same) return `${dayFmt(z)}, ${time(z)}`
  const localDay = dayFmt(localZone) !== dayFmt(z) ? ` ${dayFmt(localZone)}` : ''
  return `${dayFmt(z)}, ${time(z)} ${zoneCity(z)} · ${time(localZone)}${localDay} your time`
}

/** A front-matter field's text as written (gray-matter would turn "2026-11-25 09:00" into a UTC date) */
export function rawField(raw: string, key: string): string | undefined {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const m = fm?.[1].match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, '') || undefined : undefined
}

/** Splits a markdown body into its `## ` sections (text before the first is under '') */
export function sections(body: string, level = 2): { heading: string; text: string }[] {
  const mark = '#'.repeat(level) + ' '
  const out: { heading: string; text: string }[] = [{ heading: '', text: '' }]
  let fence = false
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.startsWith(mark)) out.push({ heading: clean(line.slice(mark.length)), text: '' })
    else out[out.length - 1].text += line + '\n'
  }
  return out.filter((s, i) => i > 0 || s.text.trim())
}

/** "B3. Tell me about…" as its id and text; an untitled heading gets a numbered id */
export function idAndTitle(heading: string, fallback: string): { id: string; title: string } {
  const m = heading.match(/^([A-Za-z]{0,4}[-_]?\d{1,3}[a-z]?|[A-Z]{1,4})[.):]\s+(.+)$/)
  return m ? { id: m[1], title: clean(m[2]) } : { id: fallback, title: clean(heading) }
}

/**
 * The "- Name: value" fields of a block. A value runs on over indented lines and nested bullets
 * until the next top-level bullet or heading. Keys are lower-cased, spaces and dashes removed.
 */
export function fields(text: string): Record<string, { inline: string; items: string[] }> {
  const out: Record<string, { inline: string; items: string[] }> = {}
  let cur: { inline: string; items: string[] } | null = null
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      cur = null
      continue
    }
    const top = line.match(/^[-*]\s+\*{0,2}([A-Za-z][A-Za-z -]{0,30}?)\*{0,2}:\*{0,2}\s*(.*)$/)
    if (top) {
      cur = { inline: clean(top[2]), items: [] }
      out[top[1].toLowerCase().replace(/[\s-]+/g, '')] = cur
      continue
    }
    if (/^[-*]\s/.test(line)) {
      cur = null
      continue
    }
    if (!cur) continue
    const nested = line.match(/^\s+(?:[-*]|\d+[.)])\s+(.*)$/)
    if (nested) cur.items.push(clean(nested[1]))
    else if (/^\s+\S/.test(line)) {
      if (cur.items.length) cur.items[cur.items.length - 1] += ' ' + clean(line)
      else cur.inline = clean(cur.inline + ' ' + line)
    }
  }
  return out
}

/** A field as a list: its nested bullets, else its inline value split on the separator */
function listField(f: { inline: string; items: string[] } | undefined, sep: RegExp): string[] {
  if (!f) return []
  const inline = f.inline ? f.inline.split(sep).map(clean).filter(Boolean) : []
  return [...(f.items.length && f.inline ? [f.inline] : f.items.length ? [] : inline), ...f.items].filter((s) => s && !/^(none|n\/a|-)$/i.test(s))
}

/** Top-level bullets of a block (with their nested lines folded in) */
export function bullets(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const b = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/)
    if (b) out.push(clean(b[1]))
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] = clean(out[out.length - 1] + ' ' + line.replace(/^\s+(?:[-*]|\d+[.)])\s+/, '— '))
  }
  return out.filter(Boolean)
}

const stripTick = (s: string) => s.replace(/^\[[ xX]\]\s*/, '')

// ---------- target.md ----------

const ROUND_KIND_OF = (v: unknown): RoundKind => {
  const s = String(v ?? '').toLowerCase()
  return (ROUND_KINDS.find((k) => s.includes(k.slice(0, 5))) ?? (/tech|case|scenario/.test(s) ? 'technical' : /video/.test(s) ? 'hirevue' : 'general')) as RoundKind
}

/** target.md, from its front matter (as gray-matter parses it) and body; `raw` keeps the dates as written */
export function parseTarget(data: Record<string, unknown>, body: string, folder: string, raw = ''): TargetMeta {
  const name = folder.split('/').pop() || folder
  const rounds: Round[] = (Array.isArray(data.rounds) ? data.rounds : [])
    .map((r, i): Round | null => {
      if (typeof r === 'string') return { id: `r${i + 1}`, name: clean(r), kind: ROUND_KIND_OF(r) }
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      const minutes = Number(o.minutes)
      return {
        id: clean(String(o.id ?? `r${i + 1}`)) || `r${i + 1}`,
        name: clean(String(o.name ?? o.id ?? `Round ${i + 1}`)),
        kind: ROUND_KIND_OF(o.kind),
        ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}),
        ...(o.notes ? { notes: clean(String(o.notes)) } : {})
      }
    })
    .filter((r): r is Round => !!r)
  return {
    slug: slugOf(name),
    name,
    folder,
    company: clean(String(data.company ?? '')) || name,
    role: clean(String(data.role ?? '')),
    date: isoOf(rawField(raw, 'date') ?? data.date),
    slidesDue: isoOf(rawField(raw, 'slidesDue') ?? rawField(raw, 'slides_due') ?? data.slidesDue ?? data.slides_due),
    ...(typeof data.timezone === 'string' && validZone(data.timezone.trim()) ? { timezone: data.timezone.trim() } : {}),
    ...(data.course ? { course: clean(String(data.course)) } : {}),
    sources: asList(data.sources),
    links: asList(data.links),
    rounds,
    notes: body.replace(/^\s*#\s+.*\n/, '').trim()
  }
}

/** A new target.md, from the New target form */
export function targetMarkdown(t: { company: string; role: string; date?: string; slidesDue?: string; sources: string[]; links: string[] }): string {
  const q = (s: string) => (/^[\w .,()/&+-]*$/.test(s) && !/^\d/.test(s) && !/:\s/.test(s) ? s : JSON.stringify(s))
  const list = (k: string, xs: string[]) => (xs.length ? `${k}:\n${xs.map((x) => `  - ${JSON.stringify(x)}`).join('\n')}\n` : `${k}: []\n`)
  return (
    `---\ncompany: ${q(t.company)}\nrole: ${q(t.role)}\n` +
    (t.date ? `date: ${t.date}\n` : '') +
    (t.slidesDue ? `slidesDue: ${t.slidesDue}\n` : '') +
    list('sources', t.sources) +
    list('links', t.links) +
    `rounds: []\n---\n\n# ${t.company}${t.role ? `, ${t.role}` : ''}\n\nNotes on the format, and advice from people who have done it.\n`
  )
}

// ---------- stories.md ----------

export function parseStories(raw: string): Story[] {
  return sections(raw)
    .filter((s) => s.heading)
    .map((s, i) => {
      const { id, title } = idAndTitle(s.heading, `S${i + 1}`)
      const f = fields(s.text)
      return {
        id,
        title,
        bestFor: listField(f.bestfor, /[,;]/),
        evidence: listField(f.evidence, /;/),
        anchors: listField(f.anchors, /[,;]|\s+[·•/]\s+/),
        gaps: listField(f.gaps, /;/)
      }
    })
}

// ---------- questions.md ----------

const KIND_OF = (v: string): QuestionKind => {
  const s = v.toLowerCase().replace(/\s+/g, '-')
  return QUESTION_KINDS.find((k) => s.startsWith(k)) ?? (/q&?a|assessor/.test(s) ? 'presentation-qa' : /firm|news|market/.test(s) ? 'market' : /why|motiv/.test(s) ? 'motivation' : 'behavioural')
}

export function parseQuestions(raw: string): Question[] {
  return sections(raw)
    .filter((s) => s.heading)
    .map((s, i) => {
      const { id, title } = idAndTitle(s.heading, `Q${i + 1}`)
      const parts = sections(s.text, 3)
      const head = parts.find((p) => !p.heading)?.text ?? (s.text.split(/^### /m)[0] || '')
      const model = parts.find((p) => /^model answer/i.test(p.heading))?.text.trim()
      const f = fields(head)
      const source = f.source?.inline.toLowerCase()
      return {
        id,
        text: title,
        ...(f.round?.inline ? { round: f.round.inline } : {}),
        kind: KIND_OF(f.kind?.inline ?? ''),
        ...(source && ['reported', 'likely', 'cv', 'brief'].includes(source) ? { source: source as Question['source'] } : {}),
        stories: listField(f.stories, /[,;\s]+/),
        route: (f.route?.inline ?? '').split(/\s*(?:→|->|=>|>|\|)\s*/).map(clean).filter(Boolean),
        outline: listField(f.outline, /;/),
        ...(model ? { model } : {})
      }
    })
}

/** questions.md with a model answer under one question (only where it has none) */
export function withModelAnswer(raw: string, id: string, answer: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.startsWith('## ') && idAndTitle(l.slice(3), '').id === id)
  if (start < 0) return raw
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++)
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  if (lines.slice(start, end).some((l) => /^###\s+model answer/i.test(l))) return raw
  let at = end
  while (at > start + 1 && !lines[at - 1].trim()) at--
  const block = ['', '### Model answer', '', answer.trim(), '']
  return [...lines.slice(0, at), ...block, ...lines.slice(end).length ? lines.slice(end) : []].join('\n').replace(/\n{3,}/g, '\n\n')
}

// ---------- scenarios.md ----------

const RUBRIC_GROUPS = ['risk', 'mitigation', 'escalation', 'board', 'communication', 'control', 'regulat']

export function parseScenarios(raw: string): Scenario[] {
  return sections(raw)
    .filter((s) => s.heading)
    .map((s, i) => {
      const { id, title } = idAndTitle(s.heading, `C${i + 1}`)
      const subs = sections(s.text, 3)
      const parts = subs.filter((p) => /^part\b/i.test(p.heading)).map((p) => p.text.trim()).filter(Boolean)
      const rubric = subs
        .filter((p) => /^rubric|^marking|^a strong answer/i.test(p.heading))
        .flatMap((p) => {
          // Rubric bullets may be grouped under "#### Risks", or say their group first ("Risk: …")
          let group = 'general'
          const out: RubricPoint[] = []
          for (const line of p.text.split('\n')) {
            const h = line.match(/^#{4,6}\s+(.+)$/) ?? line.match(/^\*\*(.+?)\*\*:?\s*$/)
            if (h) {
              group = RUBRIC_GROUPS.find((g) => h[1].toLowerCase().startsWith(g.slice(0, 5))) ?? h[1].toLowerCase()
              continue
            }
            const b = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/)
            if (!b) continue
            const pre = b[1].match(/^\*{0,2}([A-Za-z ]{3,20})\*{0,2}:\s*(.+)$/)
            const g = pre && RUBRIC_GROUPS.find((x) => pre[1].toLowerCase().startsWith(x.slice(0, 5)))
            out.push(g ? { text: clean(pre![2]), group: g === 'regulat' ? 'risk' : g } : { text: clean(b[1]), group: group === 'regulat' ? 'risk' : group })
          }
          return out
        })
      return { id, title, parts, rubric }
    })
    .filter((c) => c.parts.length)
}

// ---------- presentation.md ----------

export function parsePresentation(raw: string): Presentation {
  const all = sections(raw)
  const checklist: Presentation['checklist'] = []
  for (const s of all.filter((x) => !/assessor/i.test(x.heading)))
    for (const line of s.text.split('\n')) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/)
      if (m) checklist.push({ text: clean(m[2]), done: m[1] !== ' ' })
    }
  const topicSec = all.find((s) => /^(chosen )?topic/i.test(s.heading))
  const topic = clean(topicSec?.text.split(/\n\s*\n/).find((p) => p.trim())?.replace(/^[-*]\s+/, '') ?? '')
  const researchSec = all.find((s) => /research/i.test(s.heading))
  const research = researchSec ? sections(researchSec.text, 3).map((s) => s.heading).filter(Boolean) : []
  const qa = all.find((s) => /assessor/i.test(s.heading))
  const assessor: AssessorQuestion[] = []
  if (qa) {
    const subs = sections(qa.text, 3).filter((s) => s.heading)
    if (subs.length)
      subs.forEach((s, i) => {
        const f = fields(s.text)
        assessor.push({ id: `A${i + 1}`, question: s.heading, point: clean(f.point?.inline || f.stronganswer?.inline || s.text.replace(/^[-*]\s+/gm, '')) })
      })
    else
      bullets(qa.text).forEach((b, i) => {
        const m = b.match(/^(.+?\?)\s*(?:[—–-]+|:|→|->)?\s*(?:point:|strong answer:)?\s*(.*)$/i)
        if (m) assessor.push({ id: `A${i + 1}`, question: clean(m[1]), point: clean(m[2].replace(/^—\s*/, '').replace(/^(point|strong answer):\s*/i, '')) })
        else assessor.push({ id: `A${i + 1}`, question: b, point: '' })
      })
  }
  const mins = raw.match(/\b(\d{1,2})[- ]?min(?:ute)?s?\b/i)
  const minutes = mins ? Math.min(60, Math.max(3, Number(mins[1]))) : 15
  return { checklist, topic, research, assessor, minutes }
}

// ---------- firm.md ----------

export function parseFirm(raw: string): FirmFact[] {
  const out: FirmFact[] = []
  for (const s of sections(raw))
    for (const b of bullets(s.text)) {
      let text = stripTick(b)
      let source: string | undefined
      let date: string | undefined
      const paren = text.match(/\((?:source:\s*)?([^()]*?)(?:,\s*)?(\d{4}(?:-\d{2}(?:-\d{2})?)?)?\)\s*$/i)
      if (paren && (paren[1] || paren[2])) {
        source = clean(paren[1].replace(/,\s*$/, '')) || undefined
        date = paren[2]
        text = clean(text.slice(0, paren.index))
      } else {
        const tail = text.match(/\s+[—–-]+\s*(?:source:\s*)?([^—–]+?)(?:,\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?))?$/i)
        if (tail && /source|report|\.com|\.org|site|annual|press|news|filing|\d{4}/i.test(tail[0])) {
          source = clean(tail[1])
          date = tail[2]
          text = clean(text.slice(0, tail.index))
        }
      }
      const link = text.match(/\[([^\]]+)\]\((https?:[^)]+)\)/)
      if (link && !source) source = link[2]
      if (text) out.push({ section: s.heading || 'Facts', text, ...(source ? { source } : {}), ...(date ? { date } : {}) })
    }
  return out
}

// ---------- ask-them.md ----------

export function parseAskThem(raw: string): AskThem {
  const groups: AskThem['groups'] = []
  const rules: string[] = []
  for (const s of sections(raw)) {
    const qs = bullets(s.text).filter((b) => !/^(rule|never ask)\b/i.test(b))
    for (const line of s.text.split('\n')) if (/never ask|^rule:/i.test(line.replace(/^[-*>\s]+/, ''))) rules.push(clean(line.replace(/^[-*>\s]+/, '').replace(/^rule:\s*/i, '')))
    if (/^rules?$/i.test(s.heading)) {
      rules.push(...qs)
      continue
    }
    if (qs.length) groups.push({ who: s.heading || 'Anyone', questions: qs })
  }
  return { groups, rules: [...new Set(rules)] }
}

/** frameworks.md's `## ` headings */
export const parseFrameworks = (raw: string) => sections(raw).map((s) => s.heading).filter(Boolean)

// ---------- Progress ----------

export type Area = 'cv' | 'behavioural' | 'scenarios' | 'presentation' | 'firm' | 'ask'
export const AREAS: { id: Area; label: string }[] = [
  { id: 'cv', label: 'CV defence' },
  { id: 'behavioural', label: 'Behavioural' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'presentation', label: 'Presentation and Q&A' },
  { id: 'firm', label: 'Firm and markets' },
  { id: 'ask', label: 'Questions to ask' }
]

export type DrillKind = 'cv' | 'behavioural' | 'scenario' | 'talk' | 'assessor' | 'ask' | 'firm'

export interface Attempt {
  /** What was practised: "q:B3", "story:S2", "scenario:C1", "talk", "assessor:A2", "ask:Recruiter", "firm:3" */
  item: string
  area: Area
  drill: DrillKind
  at: number
  /** 0 to 1 */
  score: number
  /** Each criterion, 0 to 1 */
  marks: Record<string, number>
  by: 'claude' | 'code' | 'self'
  /** Spoken time, when spoken */
  seconds?: number
  spoken?: boolean
  answer?: string
  feedback?: string
  missed?: string[]
}

export interface Progress {
  slug: string
  attempts: Attempt[]
}

export const emptyProgress = (slug: string): Progress => ({ slug, attempts: [] })

/** A progress file as read, with anything malformed dropped */
export function progressOf(slug: string, raw: unknown): Progress {
  const r = raw as Partial<Progress> | null
  const attempts = Array.isArray(r?.attempts)
    ? r!.attempts.filter((a): a is Attempt => !!a && typeof a.item === 'string' && typeof a.score === 'number' && AREAS.some((x) => x.id === a.area))
    : []
  return { slug, attempts }
}

// ---------- Readiness ----------

export interface CardsState {
  total: number
  due: number
  /** Cards reviewed and not due again yet */
  remembered: number
}

export interface AreaReadiness {
  area: Area
  label: string
  /** 0 to 1; null when the target has nothing for this area yet */
  score: number | null
  items: number
  attempted: number
  /** Recency-weighted mean of the latest marks, over items attempted */
  marks: number | null
}

/** The items each area is made of, by id */
export function areaItems(t: TargetFiles): Record<Area, { item: string; label: string; drill: DrillKind }[]> {
  const q = (kinds: QuestionKind[]) => t.questions.filter((x) => kinds.includes(x.kind)).map((x) => ({ item: `q:${x.id}`, label: x.text, drill: x.kind === 'cv' ? ('cv' as const) : ('behavioural' as const) }))
  return {
    cv: [...t.stories.map((s) => ({ item: `story:${s.id}`, label: s.title, drill: 'cv' as const })), ...q(['cv'])],
    behavioural: q(['motivation', 'behavioural', 'closing']),
    scenarios: [...t.scenarios.map((c) => ({ item: `scenario:${c.id}`, label: c.title, drill: 'scenario' as const })), ...t.questions.filter((x) => x.kind === 'technical' || x.kind === 'scenario').map((x) => ({ item: `q:${x.id}`, label: x.text, drill: 'behavioural' as const }))],
    presentation: t.presentation
      ? [{ item: 'talk', label: 'Timed run of the talk', drill: 'talk' as const }, ...t.presentation.assessor.map((a) => ({ item: `assessor:${a.id}`, label: a.question, drill: 'assessor' as const })), ...t.questions.filter((x) => x.kind === 'presentation-qa').map((x) => ({ item: `q:${x.id}`, label: x.text, drill: 'behavioural' as const }))]
      : [],
    firm: [...t.questions.filter((x) => x.kind === 'market').map((x) => ({ item: `q:${x.id}`, label: x.text, drill: 'behavioural' as const })), ...(t.firm.length ? [{ item: 'firm:facts', label: 'Firm facts check', drill: 'firm' as const }] : [])],
    ask: t.ask.groups.map((g) => ({ item: `ask:${g.who}`, label: `Questions for ${g.who.toLowerCase()}`, drill: 'ask' as const }))
  }
}

/** One item's mark from its attempts: later attempts count more (each twice the one before), capped at the last five */
export function itemMark(attempts: Attempt[]): number | null {
  const xs = [...attempts].sort((a, b) => a.at - b.at).slice(-5)
  if (!xs.length) return null
  let w = 1
  let sum = 0
  let total = 0
  for (const a of xs) {
    sum += a.score * w
    total += w
    w *= 2
  }
  return sum / total
}

/**
 * Each area's readiness: 40% coverage (items tried), 60% the recency-weighted marks. Firm and
 * markets also counts card retention (a third of it) when there are cards.
 */
export function readiness(t: TargetFiles, p: Progress, cards: CardsState | null): AreaReadiness[] {
  const items = areaItems(t)
  return AREAS.map(({ id, label }) => {
    const list = items[id]
    const byItem = new Map<string, Attempt[]>()
    for (const a of p.attempts) if (a.area === id) byItem.set(a.item, [...(byItem.get(a.item) ?? []), a])
    const known = list.filter((x) => byItem.has(x.item))
    const marks = known.map((x) => itemMark(byItem.get(x.item)!)!).filter((m) => m !== null)
    const mean = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null
    const withCards = id === 'firm' && cards && cards.total > 0
    if (!list.length && !withCards) return { area: id, label, score: null, items: 0, attempted: 0, marks: null }
    const coverage = list.length ? known.length / list.length : 0
    let score = list.length ? 0.4 * coverage + 0.6 * (mean ?? 0) : 0
    if (withCards) {
      const retention = cards!.remembered / cards!.total
      score = list.length ? (2 / 3) * score + (1 / 3) * retention : retention
    }
    return { area: id, label, score: Math.max(0, Math.min(1, score)), items: list.length, attempted: known.length, marks: mean }
  })
}

/** The weakest-weighted mean: each area weighs more the lower it is, so one weak area pulls the whole down */
export function overallReadiness(areas: AreaReadiness[]): number | null {
  const xs = areas.filter((a) => a.score !== null)
  if (!xs.length) return null
  let sum = 0
  let total = 0
  for (const a of xs) {
    const w = 1.5 - a.score!
    sum += a.score! * w
    total += w
  }
  return sum / total
}

// ---------- Countdown ----------

export interface Countdown {
  days: number
  hours: number
  /** "in 12 days", "tomorrow", "today", "in 5 hours", "3 days ago" */
  text: string
  past: boolean
}

/** Days and hours to a moment, by the Mac's calendar (where the learner is) */
export function countdown(iso: string | undefined, now: number, zone?: string): Countdown | null {
  const at = momentOf(iso, zone)
  if (at === null) return null
  const start = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((start(at) - start(now)) / 86_400_000)
  const hours = Math.round((at - now) / 3_600_000)
  const hasTime = !/^\d{4}-\d{2}-\d{2}$/.test(iso!)
  const text =
    days < 0 ? `${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? (hasTime && hours > 0 ? `in ${hours} hour${hours === 1 ? '' : 's'}` : 'today') : days === 1 ? 'tomorrow' : `in ${days} days`
  return { days, hours, text, past: days < 0 || (days === 0 && hasTime && at < now) }
}

// ---------- Today's plan ----------

export interface PlanItem {
  key: string
  drill: DrillKind | 'cards' | 'teach'
  /** The item it practises (as in Attempt.item), or the topic to teach */
  item: string
  label: string
  area?: Area
  minutes: number
}

const DRILL_MINUTES: Record<DrillKind | 'cards' | 'teach', number> = { cv: 6, behavioural: 5, scenario: 15, talk: 20, assessor: 6, ask: 4, firm: 5, cards: 8, teach: 25 }

/**
 * The next few things to do: cards that are due first, then from the lowest areas, each area's
 * untried items before its weakest marks, taken in turn so one area doesn't fill the day. The
 * talk comes in when slides are due within three days. Five to eight items.
 */
export function todaysPlan(t: TargetFiles, p: Progress, cards: CardsState | null, now: number, max = 7): PlanItem[] {
  const out: PlanItem[] = []
  if (cards?.due) out.push({ key: 'cards', drill: 'cards', item: 'cards', label: `Review ${cards.due} card${cards.due === 1 ? '' : 's'}`, minutes: Math.min(20, Math.max(3, Math.round(cards.due / 3))) })
  const slides = countdown(t.meta.slidesDue, now, t.meta.timezone)
  if (t.presentation && slides && !slides.past && slides.days <= 3) out.push({ key: 'talk', drill: 'talk', item: 'talk', label: 'Timed run of the talk', area: 'presentation', minutes: DRILL_MINUTES.talk })
  const areas = readiness(t, p, cards)
    .filter((a) => a.items > 0)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
  const items = areaItems(t)
  const today = new Date(now).toDateString()
  const queues = areas.map((a) => {
    const marks = (item: string) => itemMark(p.attempts.filter((x) => x.item === item && x.area === a.area))
    const doneToday = (item: string) => p.attempts.some((x) => x.item === item && new Date(x.at).toDateString() === today)
    return items[a.area]
      .filter((x) => !doneToday(x.item) && !out.some((o) => o.item === x.item))
      .map((x) => ({ ...x, area: a.area, mark: marks(x.item) }))
      .filter((x) => x.mark === null || x.mark < 0.85)
      .sort((x, y) => (x.mark ?? -1) - (y.mark ?? -1))
  })
  for (let round = 0; out.length < max && queues.some((q) => q.length); round++)
    for (const q of queues) {
      // The weakest areas give two items a round, the rest one
      const take = queues.indexOf(q) < 2 ? 2 : 1
      for (let k = 0; k < take && q.length && out.length < max; k++) {
        const x = q.shift()!
        out.push({ key: `${x.area}:${x.item}`, drill: x.drill, item: x.item, label: x.label, area: x.area, minutes: DRILL_MINUTES[x.drill] })
      }
    }
  return out.slice(0, Math.max(0, max))
}

// ---------- Marking helpers (code, for when Claude can't) ----------

const STOP = new Set(
  'a an and are as at be but by can did do does for from had has have how i if in into is it its me my not of on or our so than that the their them then there these they this to too us was we were what when where which who why will with would you your about also any been being both each just more most must only other over such some very via per out up off own same should could'.split(' ')
)

/** A crude stem: plural, -ing, -ed and -ly endings off, so "mitigating" meets "mitigation" */
export const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(ations?|ings?|ed|ly|es|s|ment|ments|ity|ies|ive|ion|ions)$/, '')
    .slice(0, 7)

export const contentWords = (s: string) => [...new Set(s.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem).filter((w) => w.length > 2))]

/** Whether an answer covers a point: enough of its content words appear (half, at least one, at most three needed) */
export function covers(answer: string, point: string): boolean {
  const want = contentWords(point)
  if (!want.length) return false
  const have = new Set(contentWords(answer))
  const hit = want.filter((w) => have.has(w)).length
  return hit >= Math.min(3, Math.max(1, Math.ceil(want.length / 2)))
}

/** Speaking pace for typed answers: about 150 words a minute */
export const spokenSeconds = (text: string) => Math.round((text.trim().split(/\s+/).filter(Boolean).length / 150) * 60)

/** How long an answer of each kind should run, in seconds */
export const TARGET_SECONDS: Record<DrillKind, [number, number]> = { cv: [45, 120], behavioural: [90, 150], scenario: [60, 240], talk: [13 * 60, 15 * 60], assessor: [40, 100], ask: [10, 60], firm: [10, 60] }

/** 1 inside the window, falling off linearly to 0 at half or double it */
export function lengthMark(seconds: number, [lo, hi]: [number, number]): number {
  if (seconds >= lo && seconds <= hi) return 1
  if (seconds < lo) return Math.max(0, (seconds - lo / 2) / (lo / 2))
  return Math.max(0, 1 - (seconds - hi) / hi)
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// ---------- Cards: added each day, reviewed morning and evening ----------

export const CARDS_PER_DAY = 10
/** Morning ends at 2pm: a review after that is the evening one */
export const EVENING_FROM_HOUR = 14

const ymd = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const dayOf = ymd

/** The heading new cards go under on a day */
export const cardsHeading = (now: number) => `## Added ${ymd(now)}`

/** A new cards.md: tagged so review finds it, with its deck name */
export const cardsFileStart = (name: string) => `---\ntags: [flashcards]\ndeck: "Interview: ${name.replace(/"/g, "'")}"\n---\n\n# Cards: ${name}\n\nNew cards are added each day from what was taught. Edit or delete any that are wrong.\n`

/** Whether today's cards were added already */
export const cardsAddedOn = (raw: string, now: number) => raw.includes(cardsHeading(now))

export type SlotState = 'due' | 'done' | 'clear' | 'later' | 'missed'
export interface ReviewSlot {
  label: 'Morning' | 'Evening'
  state: SlotState
  /** Cards reviewed in this slot today */
  reviewed: number
  /** Cards due when this slot comes (new ones included) */
  due: number
}

/**
 * Today's two reviews of the target's cards. `dues` holds each card's next due time (null for a
 * new card), `reviewedAt` when each of today's reviews was.
 */
export function reviewSlots(dues: (number | null)[], reviewedAt: number[], now: number): { morning: ReviewSlot; evening: ReviewSlot } {
  const d = new Date(now)
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), EVENING_FROM_HOUR).getTime()
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dueBy = (t: number) => dues.filter((x) => x === null || x <= t).length
  const am = reviewedAt.filter((t) => t >= start && t < noon).length
  const pm = reviewedAt.filter((t) => t >= noon && t < end).length
  const dueNow = dueBy(now)
  const morningNow = now < noon
  return {
    morning: { label: 'Morning', reviewed: am, due: morningNow ? dueNow : dueBy(noon), state: morningNow ? (dueNow ? 'due' : am ? 'done' : 'clear') : am ? 'done' : 'missed' },
    evening: { label: 'Evening', reviewed: pm, due: morningNow ? dueBy(end) - dueNow : dueNow, state: morningNow ? 'later' : dueNow ? 'due' : pm ? 'done' : 'clear' }
  }
}

/**
 * Cards from the target's own files, for days Claude can't write them: a story's anchors, a
 * firm fact with its figure blanked, an assessor question's point. Only facts already written down.
 */
export function cardsFromFiles(t: TargetFiles, have: Set<string>, max = CARDS_PER_DAY): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = []
  const add = (front: string, back: string) => {
    if (out.length >= max || !front || !back || have.has(front)) return
    have.add(front)
    out.push({ front, back })
  }
  for (const f of t.firm) {
    const figure = f.text.match(/(?:[$£€]\s?)?\d[\d,.]*\s?(?:%|bn|billion|m|million|k|years?)?/i)
    if (figure && figure[0].trim().length > 1) add(`${f.section}: ${f.text.replace(figure[0], '…')}`, f.text)
  }
  for (const s of t.stories) if (s.anchors.length) add(`Story ${s.id}, ${s.title}: its anchors?`, s.anchors.join(', '))
  for (const a of t.presentation?.assessor ?? []) if (a.point) add(`Assessor: ${a.question} What point does a strong answer make?`, a.point)
  return out
}

// ---------- Marking ----------

export const CRITERIA: Record<DrillKind, { id: string; label: string }[]> = {
  behavioural: [
    { id: 'structure', label: 'Structure' },
    { id: 'specifics', label: 'Specifics' },
    { id: 'ownership', label: 'Ownership' },
    { id: 'result', label: 'Result' },
    { id: 'length', label: 'Length' },
    { id: 'natural', label: 'Sounds like you' }
  ],
  cv: [
    { id: 'accuracy', label: 'Accuracy' },
    { id: 'depth', label: 'Depth' },
    { id: 'clarity', label: 'Clarity' },
    { id: 'length', label: 'Length' }
  ],
  scenario: [
    { id: 'risks', label: 'Risks found' },
    { id: 'mitigation', label: 'Mitigation' },
    { id: 'communication', label: 'Escalation and communication' }
  ],
  talk: [
    { id: 'brief', label: 'Covers the brief' },
    { id: 'timing', label: 'Timing' },
    { id: 'natural', label: 'Sounds like you' }
  ],
  assessor: [
    { id: 'point', label: 'Makes the point' },
    { id: 'clarity', label: 'Clarity' },
    { id: 'length', label: 'Length' }
  ],
  ask: [{ id: 'ready', label: 'Ready' }],
  firm: [{ id: 'recall', label: 'Recall' }]
}

export interface MarkInput {
  drill: DrillKind
  question: string
  answer: string
  /** Spoken time, or the typed answer's time at speaking pace */
  seconds: number
  route?: string[]
  anchors?: string[]
  outline?: string[]
  evidence?: string[]
  rubric?: RubricPoint[]
  point?: string
  checklist?: string[]
  /** The talk's target minutes */
  minutes?: number
}

export interface MarkResult {
  score: number
  marks: Record<string, number>
  covered: string[]
  missed: string[]
  feedback: string
  by: 'claude' | 'code'
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round2 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100

/** The window an answer should land in */
export function targetWindow(i: Pick<MarkInput, 'drill' | 'minutes'>): [number, number] {
  return i.drill === 'talk' && i.minutes ? [i.minutes * 60 - 120, i.minutes * 60] : TARGET_SECONDS[i.drill]
}

/**
 * An answer marked in code, for when Claude can't: how much of what it should cover it does
 * (anchors, rubric, the point, the brief, by content words), its parts, "I" against "we",
 * numbers, its length against the window, and how natural it reads. Rough, and says so.
 */
export function markInCode(i: MarkInput, natural: (t: string) => number): MarkResult {
  const text = i.answer.trim()
  const words = text.split(/\s+/).filter(Boolean).length
  const length = lengthMark(i.seconds, targetWindow(i))
  const nat = natural(text)
  const split = (points: string[]) => ({ covered: points.filter((p) => covers(text, p)), missed: points.filter((p) => !covers(text, p)) })
  let marks: Record<string, number> = {}
  let points: string[] = []
  if (i.drill === 'behavioural') {
    points = [...(i.anchors ?? []), ...(i.outline ?? [])]
    const route = i.route?.length ? i.route : ['Situation', 'Action', 'Result']
    const lower = text.toLowerCase()
    const star = starPartsLite(lower)
    const steps = route.map((r) => (/situation|context|background/i.test(r) ? star.situation : /task|goal|problem/i.test(r) ? star.task : /action|what i did|approach/i.test(r) ? star.action : /result|outcome|impact/i.test(r) ? star.result : /lesson|learn|reflect|differently/i.test(r) ? /\b(learn|differently|next time|would now|lesson)/.test(lower) : covers(text, r)))
    const iCount = (text.match(/\bI\b|\bI'(m|ve|d)\b|\bmy\b/g) ?? []).length
    const we = (text.match(/\bwe\b|\bour\b|\bthe team\b/gi) ?? []).length
    const numbers = (text.match(/\b\d[\d,.]*\s?(%|k|m|bn|x|hours?|days?|weeks?|months?|people)?/gi) ?? []).length
    const hit = points.length ? split(points).covered.length / points.length : 0
    marks = {
      structure: steps.filter(Boolean).length / steps.length,
      specifics: Math.min(1, numbers * 0.25 + hit * 0.75 + (points.length ? 0 : 0.25)),
      ownership: iCount + we === 0 ? 0 : iCount / (iCount + we),
      result: star.result ? 1 : 0,
      length,
      natural: nat
    }
  } else if (i.drill === 'cv') {
    points = [...(i.evidence ?? []), ...(i.anchors ?? [])]
    const hit = points.length ? split(points).covered.length / points.length : 0.5
    const reasons = (text.match(/\b(because|so that|so we|trade-?off|instead of|rather than|the reason|which meant|if i did it again|i would change)\b/gi) ?? []).length
    marks = { accuracy: Math.min(1, hit * 1.5), depth: Math.min(1, reasons * 0.3 + (words > 90 ? 0.4 : words / 225)), clarity: nat, length }
  } else if (i.drill === 'scenario') {
    const rubric = i.rubric ?? []
    points = rubric.map((r) => r.text)
    const group = (gs: string[]) => {
      const xs = rubric.filter((r) => gs.includes(r.group))
      return xs.length ? xs.filter((r) => covers(text, r.text)).length / xs.length : null
    }
    const all = rubric.length ? rubric.filter((r) => covers(text, r.text)).length / rubric.length : 0
    const talk = /\b(escalat|inform|report|tell|notify|board|committee|regulator|stakeholder|senior|manager|risk owner)\w*/i.test(text) ? 0.6 : 0
    marks = { risks: group(['risk', 'general']) ?? all, mitigation: group(['mitigation', 'control']) ?? all, communication: Math.max(group(['escalation', 'board', 'communication']) ?? 0, talk, all * 0.8) }
  } else if (i.drill === 'talk') {
    points = i.checklist ?? []
    marks = { brief: points.length ? split(points).covered.length / points.length : 0.5, timing: length, natural: nat }
  } else if (i.drill === 'assessor') {
    points = i.point ? [i.point] : []
    const want = contentWords(i.point ?? '')
    const have = new Set(contentWords(text))
    marks = { point: want.length ? Math.min(1, (want.filter((w) => have.has(w)).length / want.length) * 1.6) : 0.5, clarity: nat, length }
  } else {
    marks = Object.fromEntries(CRITERIA[i.drill].map((c) => [c.id, text ? 1 : 0]))
  }
  marks = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, round2(v)]))
  const { covered, missed } = split(points)
  const weakest = CRITERIA[i.drill].filter((c) => (marks[c.id] ?? 1) < 0.5).map((c) => c.label.toLowerCase())
  const feedback = !text
    ? 'Nothing to mark yet.'
    : `Marked in code from the words you used, so take it as a rough guide.${weakest.length ? ` Work on ${weakest.slice(0, 2).join(' and ')}.` : ''}${missed.length ? ` You left out ${missed.length} of ${points.length} points.` : points.length ? ' You touched every point.' : ''}`
  return { score: round2(mean(Object.values(marks))), marks, covered, missed, feedback, by: 'code' }
}

function starPartsLite(t: string) {
  return {
    situation: /\b(when i was|at (my|the) (job|company|team|work|bank|firm|university)|we were|the team|project|context|background|last year|in \d{4}|during)\b/.test(t),
    task: /\b(i (had|needed|was asked|was responsible) to|my (job|task|goal|role) was|the goal|needed to|had to)\b/.test(t),
    action: /\b(i (built|wrote|decided|started|changed|proposed|set up|talked|spoke|asked|fixed|found|traced|tested|measured|led|created|designed|ran|checked|organised|organized|analysed|analyzed|planned|reviewed|called|worked))\b/.test(t),
    result: /\b(as a result|in the end|the result|it (cut|reduced|saved|improved|meant)|we (shipped|launched|cut|saved|reduced)|\d+\s?%|went from|now|which meant|outcome)\b/.test(t)
  }
}

/**
 * Claude's marks, as JSON: {"marks": {criterion: 0-4}, "covered": [...], "missed": [...],
 * "feedback": "..."}. Null if they can't be read, so code marks instead.
 */
export function parseMarks(text: string, drill: DrillKind): Omit<MarkResult, 'by'> | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(json)
  } catch {
    return null
  }
  const raw = (o.marks ?? {}) as Record<string, unknown>
  const marks: Record<string, number> = {}
  for (const c of CRITERIA[drill]) {
    const v = Number(raw[c.id])
    if (Number.isFinite(v)) marks[c.id] = round2(v > 1 ? v / 4 : v)
  }
  if (Object.keys(marks).length < Math.ceil(CRITERIA[drill].length / 2)) return null
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 12) : [])
  return { score: round2(mean(Object.values(marks))), marks, covered: strs(o.covered), missed: strs(o.missed), feedback: String(o.feedback ?? '').trim().slice(0, 1200) }
}

/** The attempt to save from a mark */
export function attemptOf(o: { item: string; area: Area; drill: DrillKind; mark: MarkResult; seconds?: number; spoken?: boolean; answer: string; at: number }): Attempt {
  return {
    item: o.item,
    area: o.area,
    drill: o.drill,
    at: o.at,
    score: o.mark.score,
    marks: o.mark.marks,
    by: o.mark.by,
    ...(o.seconds ? { seconds: Math.round(o.seconds) } : {}),
    ...(o.spoken ? { spoken: true } : {}),
    answer: o.answer.slice(0, 6000),
    ...(o.mark.feedback ? { feedback: o.mark.feedback } : {}),
    ...(o.mark.missed.length ? { missed: o.mark.missed } : {})
  }
}

/** Which area a question belongs to */
export function areaOfQuestion(q: Pick<Question, 'kind'>): Area {
  return q.kind === 'cv' ? 'cv' : q.kind === 'technical' || q.kind === 'scenario' ? 'scenarios' : q.kind === 'presentation-qa' ? 'presentation' : q.kind === 'market' ? 'firm' : 'behavioural'
}

/** Ways to answer each kind of question, taught as a lesson in Teach */
export const ANSWER_KINDS: { kind: QuestionKind; label: string }[] = [
  { kind: 'motivation', label: 'Why this firm, why this role' },
  { kind: 'behavioural', label: 'Behavioural stories' },
  { kind: 'cv', label: 'Defending your CV' },
  { kind: 'technical', label: 'Technical and scenario cases' },
  { kind: 'presentation-qa', label: 'Presentation Q&A' },
  { kind: 'market', label: 'Firm and market questions' }
]

// ---------- What main hands the page (main/interviewTarget, preload/interview) ----------

export interface TargetSummary {
  slug: string
  name: string
  company: string
  role: string
  date?: string
  timezone?: string
  readiness: number | null
}

export interface GatheredItem {
  kind: 'file' | 'repo' | 'page'
  title: string
  /** The path or URL it came from */
  ref: string
  chars: number
}

export interface GatheredContext {
  at: number
  items: GatheredItem[]
  errors: string[]
}

export interface CourseModule {
  id: string
  title: string
  status: 'locked' | 'open' | 'active' | 'passed'
  solid: number
  total: number
  parts: { passed: number; of: number }
  /** The next topic not yet ticked off, to start a lesson on */
  next?: string
}

export interface CourseState {
  track: string
  title: string
  /** The track's notebook (its lessons are scoped to it, so module progress counts them) */
  notebook?: string
  modules: CourseModule[]
}

export interface TargetCards extends CardsState {
  path: string
  exists: boolean
  /** Each card's next due time; null for a new card */
  dues: (number | null)[]
  /** When this deck's reviews were today */
  reviewedToday: number[]
  addedToday: boolean
}

export interface TargetBundle {
  files: TargetFiles
  progress: Progress
  cards: TargetCards
  context: GatheredContext | null
  course: CourseState | null
  /** Which of the target's files exist */
  has: Record<'stories' | 'questions' | 'scenarios' | 'presentation' | 'firm' | 'ask' | 'frameworks', boolean>
  /** Claude can write and mark */
  claude: boolean
}

export interface NewTarget {
  company: string
  role: string
  date?: string
  slidesDue?: string
  sources: string[]
  links: string[]
}

export type GenerateWhat = 'stories' | 'answers' | 'cards'

export interface GenerateResult {
  /** The file written, vault-relative */
  path: string
  added: number
  backup?: string
  by: 'claude' | 'code'
  note?: string
}

export interface ProbeRequest {
  /** The CV line or story being defended */
  item: string
  question: string
  answer: string
  /** Probes asked so far */
  asked: string[]
}

export interface ClarifyRequest {
  scenario: string
  /** Parts revealed so far (count) */
  shown: number
  question: string
}

export interface InterviewApi {
  list(): Promise<TargetSummary[]>
  get(slug: string): Promise<TargetBundle | null>
  create(t: NewTarget): Promise<{ slug: string; folder: string }>
  /** Saves an attempt; the progress after it */
  attempt(slug: string, a: Attempt): Promise<Progress>
  mark(slug: string, input: MarkInput): Promise<MarkResult>
  probe(slug: string, req: ProbeRequest): Promise<{ probe: string; by: 'claude' | 'code' }>
  clarify(slug: string, req: ClarifyRequest): Promise<{ reply: string; by: 'claude' | 'code' }>
  gather(slug: string): Promise<GatheredContext>
  generate(slug: string, what: GenerateWhat): Promise<GenerateResult>
  onProgress(cb: (p: { slug: string; step: string }) => void): () => void
}
