/**
 * Scripts: co-writing a spoken answer to one question of an interview target, then practising it.
 * A script lives in the vault at `Interview prep/<Target>/scripts/<question id>.md`: front matter
 * (question, status, the locked version, the beats) and a readable body (every version, newest
 * first, then the conversation with Tide and the facts the learner stated). The learner's voice,
 * their own style rules and sample sentences, is `Interview prep/<Target>/voice.md`.
 *
 * Everything here is pure: parsing and writing those files, the target length for a kind of
 * question, the claims a draft makes that the learner's material doesn't back, spotting feedback
 * that is really a voice rule, beats in code, and marking a run of the script against its beats.
 */
import { contentWords, covers, spokenSeconds, type Question, type QuestionKind } from './interviewTarget'

export type ScriptStatus = 'draft' | 'locked'
export type VersionBy = 'tide' | 'you' | 'start'

export interface ScriptVersion {
  n: number
  /** "2026-11-19 21:40", local time */
  at: string
  by: VersionBy
  /** Tide's 1–3 lines on what changed, or where a first version came from */
  note?: string
  text: string
}

export interface ScriptTurn {
  at: string
  who: 'you' | 'tide'
  text: string
  /** The version Tide's reply made */
  version?: number
}

export interface Script {
  questionId: string
  question: string
  status: ScriptStatus
  lockedVersion?: number
  /** The key points of the locked version, extracted once when it was locked */
  beats: string[]
  /** Seconds the learner asked for ("make it 60 seconds"), over the kind's default */
  target?: [number, number]
  versions: ScriptVersion[]
  log: ScriptTurn[]
  /** Facts the learner stated in feedback, allowed in the script although no file has them */
  facts: string[]
}

export const SCRIPTS_DIR = 'scripts'
export const VOICE_FILE = 'voice.md'
export const WORDS_PER_MINUTE = 150

/** A question id as a file name */
export const scriptFile = (questionId: string) => `${questionId.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'question'}.md`

export const stamp = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

export const emptyScript = (q: Pick<Question, 'id' | 'text'>): Script => ({ questionId: q.id, question: q.text, status: 'draft', beats: [], versions: [], log: [], facts: [] })

/** The newest version */
export const latest = (s: Script): ScriptVersion | undefined => s.versions.reduce<ScriptVersion | undefined>((a, v) => (!a || v.n > a.n ? v : a), undefined)

/** The version the learner locked as their script */
export const lockedText = (s: Script): string | null => (s.status === 'locked' ? s.versions.find((v) => v.n === s.lockedVersion)?.text ?? latest(s)?.text ?? null : null)

// ---------- Length ----------

/** Is this "tell me about yourself", the intro every interviewer asks for */
export const isIntro = (text: string) => /\b(tell me about yourself|introduce yourself|walk me through your (cv|resume|background)|about you)\b/i.test(text)

/** How long a spoken answer to this kind of question should run, in seconds */
export function scriptTarget(q: Pick<Question, 'kind' | 'text' | 'limit'>, own?: [number, number]): [number, number] {
  if (own) return own
  if (q.limit) return [Math.round(q.limit * 0.6), q.limit]
  if (isIntro(q.text)) return [60, 90]
  const by: Record<QuestionKind, [number, number]> = { motivation: [45, 90], behavioural: [90, 120], cv: [60, 120], technical: [60, 120], scenario: [90, 180], 'presentation-qa': [40, 90], market: [45, 90], closing: [20, 45] }
  return by[q.kind]
}

/** "make it 60 seconds", "under 2 minutes", "90s": the length asked for, as a window */
export function lengthAsked(feedback: string): [number, number] | null {
  const m = feedback.match(/\b(?:make it|keep it|cut it to|get it to|bring it (?:down )?to|under|about|around|at most|max|no more than|aim for)?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?)\b/i)
  if (!m) return null
  const secs = Math.round(Number(m[1]) * (/^m/i.test(m[2]) ? 60 : 1))
  if (secs < 15 || secs > 600) return null
  return /under|at most|max|no more than/i.test(m[0]) ? [Math.round(secs * 0.75), secs] : [Math.max(10, secs - 10), secs + 10]
}

// ---------- The script file ----------

const yamlStr = (s: string) => JSON.stringify(s)

function unquote(v: string): string {
  const t = v.trim()
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t)
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  return t
}

/** The front matter as key → value, lists as arrays (only the shapes scriptMarkdown writes, read leniently) */
function frontMatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: raw }
  const data: Record<string, string | string[]> = {}
  let key = ''
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && key) {
      const cur = data[key]
      data[key] = [...(Array.isArray(cur) ? cur : []), unquote(item[1])]
      continue
    }
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    key = kv[1]
    data[key] = kv[2].trim() === '' ? [] : kv[2].trim() === '[]' ? [] : unquote(kv[2])
  }
  return { data, body: m[2] }
}

const BY_LABEL: Record<VersionBy, string> = { tide: 'Tide', you: 'You', start: 'Start' }
const byOf = (label: string): VersionBy => (/^you/i.test(label) ? 'you' : /^start/i.test(label) ? 'start' : 'tide')

/** Readable Markdown: front matter, then the versions newest first, the conversation and the facts */
export function scriptMarkdown(s: Script): string {
  const fm = [
    '---',
    `question: ${yamlStr(s.question)}`,
    `questionId: ${yamlStr(s.questionId)}`,
    `status: ${s.status}`,
    ...(s.status === 'locked' && s.lockedVersion ? [`lockedVersion: ${s.lockedVersion}`] : []),
    ...(s.target ? [`target: ${s.target[0]}-${s.target[1]}`] : []),
    s.beats.length ? `beats:\n${s.beats.map((b) => `  - ${yamlStr(b)}`).join('\n')}` : 'beats: []',
    '---'
  ]
  const versions = [...s.versions].sort((a, b) => b.n - a.n)
  const body = [
    `# ${s.question}`,
    '',
    ...versions.flatMap((v) => [
      `## Version ${v.n}${s.status === 'locked' && s.lockedVersion === v.n ? ' (locked)' : ''}`,
      '',
      `*${BY_LABEL[v.by]} · ${v.at}*`,
      ...(v.note ? ['', ...v.note.split('\n').map((l) => `> ${l}`)] : []),
      '',
      v.text.trim(),
      ''
    ]),
    ...(s.log.length ? ['## Conversation', '', ...s.log.map((t) => `- **${t.who === 'you' ? 'You' : 'Tide'}** (${t.at}${t.version ? `, version ${t.version}` : ''}): ${t.text.replace(/\s*\n\s*/g, ' ')}`), ''] : []),
    ...(s.facts.length ? ['## Facts you stated', '', ...s.facts.map((f) => `- ${f}`), ''] : [])
  ]
  return `${fm.join('\n')}\n\n${body.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

export function parseScript(raw: string, fallback?: Pick<Question, 'id' | 'text'>): Script {
  const { data, body } = frontMatter(raw)
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '')
  const target = str('target').match(/^(\d+)\s*-\s*(\d+)$/)
  const s: Script = {
    questionId: str('questionId') || fallback?.id || '',
    question: str('question') || fallback?.text || '',
    status: str('status') === 'locked' ? 'locked' : 'draft',
    beats: Array.isArray(data.beats) ? data.beats.filter(Boolean) : [],
    versions: [],
    log: [],
    facts: []
  }
  const lv = Number(str('lockedVersion'))
  if (s.status === 'locked' && lv > 0) s.lockedVersion = lv
  if (target) s.target = [Number(target[1]), Number(target[2])]
  // Split the body on its ## headings
  const parts = body.replace(/\r\n/g, '\n').split(/^## /m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim()
    const text = nl < 0 ? '' : p.slice(nl + 1)
    const v = head.match(/^Version (\d+)/i)
    if (v) {
      const lines = text.split('\n')
      let i = 0
      while (i < lines.length && !lines[i].trim()) i++
      let at = ''
      let by: VersionBy = 'tide'
      const meta = lines[i]?.match(/^\*([^·*]+?)\s*·\s*([^*]+)\*\s*$/)
      if (meta) {
        by = byOf(meta[1].trim())
        at = meta[2].trim()
        i++
      }
      while (i < lines.length && !lines[i].trim()) i++
      const note: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) note.push(lines[i++].replace(/^>\s?/, ''))
      s.versions.push({ n: Number(v[1]), at, by, ...(note.length ? { note: note.join('\n').trim() } : {}), text: lines.slice(i).join('\n').trim() })
    } else if (/^conversation/i.test(head)) {
      for (const line of text.split('\n')) {
        const m = line.match(/^- \*\*(You|Tide)\*\* \(([^,)]+)(?:, version (\d+))?\):\s*(.*)$/)
        if (m) s.log.push({ who: m[1] === 'You' ? 'you' : 'tide', at: m[2].trim(), text: m[4].trim(), ...(m[3] ? { version: Number(m[3]) } : {}) })
      }
    } else if (/^facts/i.test(head)) {
      for (const line of text.split('\n')) {
        const m = line.match(/^[-*]\s+(.+)$/)
        if (m) s.facts.push(m[1].trim())
      }
    }
  }
  s.versions.sort((a, b) => a.n - b.n)
  return s
}

/** The script with a new version, unless it is the same text as the newest */
export function addVersion(s: Script, v: Omit<ScriptVersion, 'n'>): Script {
  const last = latest(s)
  if (last && last.text.trim() === v.text.trim()) return s
  return { ...s, versions: [...s.versions, { ...v, n: (last?.n ?? 0) + 1 }] }
}

// ---------- voice.md ----------

export interface Voice {
  rules: string[]
  samples: string[]
}

export const VOICE_START = `# My voice

How I speak in interviews. Tide follows these when it drafts a script with me. Edit freely.
`

export function parseVoice(raw: string): Voice {
  const v: Voice = { rules: [], samples: [] }
  let sec: 'rules' | 'samples' | null = null
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const h = line.match(/^##\s+(.+)$/)
    if (h) {
      sec = /rule/i.test(h[1]) ? 'rules' : /sample|sentence|example/i.test(h[1]) ? 'samples' : null
      continue
    }
    if (!sec) continue
    const m = line.match(/^\s*(?:[-*]|>)\s+(.+)$/)
    if (m && m[1].trim() && !/^\(none yet\)$/.test(m[1].trim())) v[sec].push(m[1].trim().replace(/^"(.*)"$/, '$1'))
  }
  return v
}

export function voiceMarkdown(v: Voice, intro = VOICE_START): string {
  return `${intro.trimEnd()}\n\n## Rules\n\n${v.rules.map((r) => `- ${r}`).join('\n') || '- (none yet)'}\n\n## Sample sentences\n\n${v.samples.map((s) => `- ${s}`).join('\n') || '- (none yet)'}\n`
}

const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim()

/** voice.md with one more rule (or sample), keeping everything else in the file as it was */
export function withVoiceLine(raw: string, kind: 'rules' | 'samples', line: string): string {
  const text = line.trim().replace(/\s*\n\s*/g, ' ')
  if (!text) return raw
  const v = parseVoice(raw)
  if (v[kind].some((x) => same(x, text))) return raw
  if (!raw.trim()) return voiceMarkdown({ ...v, [kind]: [text] })
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const want = kind === 'rules' ? /rule/i : /sample|sentence|example/i
  const start = lines.findIndex((l) => /^##\s+/.test(l) && want.test(l))
  if (start < 0) return `${raw.trimEnd()}\n\n## ${kind === 'rules' ? 'Rules' : 'Sample sentences'}\n\n- ${text}\n`
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++)
    if (/^##?\s+/.test(lines[i])) {
      end = i
      break
    }
  // Drop the "(none yet)" placeholder, add after the section's last line
  const sec = lines.slice(start + 1, end).filter((l) => !/^\s*-\s*\(none yet\)\s*$/.test(l))
  while (sec.length && !sec[sec.length - 1].trim()) sec.pop()
  if (!sec.some((l) => l.trim())) sec.splice(0, sec.length, '')
  return [...lines.slice(0, start + 1), ...sec, `- ${text}`, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Voice rules and samples for a prompt */
export const voiceText = (v: Voice) =>
  [v.rules.length ? `The learner's own rules for how they speak (these win over every other rule):\n${v.rules.map((r) => `- ${r}`).join('\n')}` : '', v.samples.length ? `Sentences in the learner's own words, to match their rhythm and vocabulary (don't reuse them unless they fit):\n${v.samples.slice(0, 24).map((s) => `- ${s}`).join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n')

/**
 * Sentences from the learner's own writing that show how they talk: first person, 6 to 30 words,
 * no AI tells (checked by the caller's function), no Markdown. At most `max`, longest-first variety.
 */
export function sampleSentences(text: string, tells: (s: string) => number, max = 12): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/^#+\s.*$/gm, '')
    .replace(/^\s*[-*>]\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/https?:\/\/\S+/g, 'LINKHERE')
  for (const m of clean.matchAll(/[^.!?\n]+[.!?]/g)) {
    const s = m[0].trim()
    const n = wordCount(s)
    if (n < 6 || n > 30) continue
    if (!/\b(I|I'm|I've|I'd|my|me|we)\b/.test(s)) continue
    if (/PRACTICE VERSION|LINKHERE|\(|\[|\||:$/.test(s)) continue
    if (tells(s) > 0) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** The text under "### Your draft …" headings in questions.md (the learner's own words) */
export function yourDrafts(questionsMd: string): { under: string; text: string }[] {
  const out: { under: string; text: string }[] = []
  const lines = questionsMd.replace(/\r\n/g, '\n').split('\n')
  let h2 = ''
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) h2 = lines[i].slice(3).trim()
    if (!/^###\s+your (own )?(draft|answer|version)/i.test(lines[i])) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length && !/^#{2,3}\s/.test(lines[j]); j++) body.push(lines[j])
    const text = body.join('\n').trim()
    if (text) out.push({ under: h2, text })
  }
  return out
}

/** The learner's own draft of one question, if questions.md has one under it */
export function yourDraftOf(questionsMd: string, q: Pick<Question, 'id' | 'text'>): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return yourDrafts(questionsMd).find((d) => d.under.startsWith(`${q.id}.`) || d.under.startsWith(`${q.id} `) || norm(d.under).includes(norm(q.text)))?.text.replace(/\n\s*\((about|roughly)[^)]*\)\s*$/i, '').trim()
}

// ---------- Feedback that is a voice rule ----------

/**
 * Feedback that says how the learner talks in general, not what this answer should say:
 * "I don't use 'furthermore'", "short sentences", "I say 'so' to start a point". The rule to
 * offer, or null for feedback about this answer only ("start with the second project").
 */
export function voiceRuleFrom(feedback: string): string | null {
  const f = feedback.trim().replace(/\s+/g, ' ').replace(/(\w)’(\w)/g, "$1'$2")
  if (!f || f.length > 220) return null
  const quoted = f.match(/(?:^|\s)["“'‘]([^"”’]{1,40}?)["”'’](?=$|[\s.,;!?])/)?.[1]
  const neverSay = f.match(/\b(?:i(?:'d| would)? never (?:say|use)|i don'?t (?:say|use)|i never (?:say|use)|don'?t (?:ever )?use|never use|stop using|no more)\s+["“'‘]?([^"”'’.,;]{1,40})/i)
  if (neverSay) return `Never say “${(quoted ?? neverSay[1]).trim()}”.`
  const iSay = f.match(/\bi (?:always |usually |tend to )?(?:say|start (?:a point|points|with)|use)\s+["“'‘]([^"”'’]{1,30})["”'’](.*)$/i)
  if (iSay) return `I say “${iSay[1].trim()}”${iSay[2].trim() ? ` ${iSay[2].trim().replace(/[.!]+$/, '')}` : ''}.`
  if (/\b(short(er)? sentences|long(er)? sentences|contractions|no jargon|plain(er)? words|less formal|more casual|more formal|more direct|fewer adjectives|no big words|simple words|active voice|get to the point|answer first|less corporate|sound(s)? like me|too (formal|corporate|polished|stiff))\b/i.test(f) && !/\b(this|that|here|the (first|second|last|opening|ending|intro)|this one|paragraph|sentence (about|on))\b/i.test(f)) {
    const t = f.replace(/^(please|can you|could you|make it|keep it|use|i like|i prefer|i want)\s+/i, '').replace(/[.!]+$/, '')
    return t.charAt(0).toUpperCase() + t.slice(1) + '.'
  }
  if (/\b(i (always|never|don'?t|tend to|prefer|like to)|in general|always|generally)\b/i.test(f) && !/\b(this answer|this one|here|for this)\b/i.test(f)) return f.replace(/[.!]*$/, '.')
  return null
}

// ---------- Claims the material doesn't back ----------

const ORDINARY_CAPS = new Set(
  'I I’m I’d I’ve I’ll I\'m I\'d I\'ve I\'ll So But And Then That This The When What Why How My We Our It It’s It\'s In At On For If After Before Since During One Two Three First Second Last Next Now Today Also Because While Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December English'.split(' ')
)

/** The specific things a sentence asserts: numbers and names (capitalised words not at its start) */
export function claimTokens(sentence: string): string[] {
  const out = new Set<string>()
  for (const m of sentence.matchAll(/(?:[$£€₦]\s?)?\d[\d,.]*\s?(?:%|k|m|bn|x)?/gi)) {
    const n = m[0].replace(/[$£€₦\s,]/g, '').replace(/\.$/, '').toLowerCase()
    if (n && !/^(1|2|3|0)$/.test(n)) out.add(n)
  }
  const words = sentence.trim().split(/\s+/)
  words.forEach((w, i) => {
    const bare = w.replace(/^[^\p{L}\d]+|[^\p{L}\d’']+$/gu, '').replace(/[’']s$/, '')
    if (i === 0 || !/^\p{Lu}/u.test(bare) || ORDINARY_CAPS.has(bare) || bare.length < 2) return
    out.add(bare.toLowerCase())
  })
  return [...out]
}

/** Every number and name in the learner's material, for checking a draft's claims against */
export function knownTokens(texts: string[]): string[] {
  const out = new Set<string>()
  for (const t of texts) {
    for (const m of t.matchAll(/(?:[$£€₦]\s?)?\d[\d,.]*\s?(?:%|k|m|bn|x)?/gi)) out.add(m[0].replace(/[$£€₦\s,]/g, '').replace(/\.$/, '').toLowerCase())
    for (const m of t.matchAll(/\b\p{Lu}[\p{L}\d&’'-]+/gu)) out.add(m[0].replace(/[’']s$/, '').toLowerCase())
  }
  return [...out].filter(Boolean)
}

export interface Unsupported {
  sentence: string
  at: number
  length: number
  /** The numbers and names the material doesn't have */
  missing: string[]
}

/** Sentences whose numbers or names appear nowhere in the learner's material: "confirm this is true" */
export function unsupportedClaims(text: string, known: Set<string> | string[]): Unsupported[] {
  const have = known instanceof Set ? known : new Set(known)
  const out: Unsupported[] = []
  for (const m of text.matchAll(/[^.!?\n]+[.!?]?/g)) {
    const sentence = m[0].trim()
    if (!sentence) continue
    const missing = claimTokens(sentence).filter((t) => !have.has(t) && !have.has(t.replace(/%$/, '')))
    if (missing.length) out.push({ sentence, at: (m.index ?? 0) + (m[0].length - m[0].trimStart().length), length: sentence.length, missing })
  }
  return out
}

// ---------- Beats ----------

/** Beats in code, when Claude can't: one per paragraph, or per sentence or two when it is one block */
export function beatsInCode(script: string, max = 7): string[] {
  const paras = script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const sentences = (t: string) => (t.match(/[^.!?]+[.!?]?/g) ?? []).map((s) => s.trim()).filter((s) => wordCount(s) >= 3)
  let units: string[]
  if (paras.length >= 3) units = paras.map((p) => sentences(p)[0] ?? p)
  else {
    const all = paras.flatMap(sentences)
    const per = Math.max(1, Math.ceil(all.length / max))
    units = []
    for (let i = 0; i < all.length; i += per) units.push(all[i])
  }
  return units.slice(0, max).map((u) => {
    const words = u.replace(/[.!?]+$/, '').split(/\s+/)
    return words.length > 14 ? words.slice(0, 14).join(' ') + '…' : words.join(' ')
  })
}

/** Claude's beats: a JSON array of short strings */
export function parseBeats(raw: string): string[] | null {
  try {
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '')
    if (!Array.isArray(arr)) return null
    const out = arr.map((x) => String(typeof x === 'object' && x ? (x as { beat?: unknown; text?: unknown }).beat ?? (x as { text?: unknown }).text ?? '' : x).trim()).filter(Boolean)
    return out.length >= 2 ? out.slice(0, 10) : null
  } catch {
    return null
  }
}

// ---------- Say it: a run marked against the beats ----------

export interface SayItResult {
  beats: { text: string; hit: boolean }[]
  seconds: number
  target: [number, number]
  /** 0 to 1 */
  natural: number
  /** 0 to 1: beats landed, time and naturalness */
  score: number
  feedback: string
  by: 'claude' | 'code'
}

/** A beat lands when the run covers its content words (looser than word for word) */
export function beatLanded(answer: string, beat: string): boolean {
  if (covers(answer, beat)) return true
  // Short beats: any two of its content words, or its one name or number
  const want = contentWords(beat)
  const have = new Set(contentWords(answer))
  const hit = want.filter((w) => have.has(w)).length
  return want.length <= 4 ? hit >= Math.min(2, want.length) : false
}

const lengthScore = (s: number, [lo, hi]: [number, number]) => (s >= lo && s <= hi ? 1 : s < lo ? Math.max(0, s / lo) : Math.max(0, 1 - (s - hi) / hi))

export function sayItInCode(o: { beats: string[]; answer: string; seconds: number | null; target: [number, number]; natural: (t: string) => number }): SayItResult {
  const seconds = o.seconds ?? spokenSeconds(o.answer)
  const beats = o.beats.map((b) => ({ text: b, hit: !!o.answer.trim() && beatLanded(o.answer, b) }))
  const landed = beats.length ? beats.filter((b) => b.hit).length / beats.length : 0
  const natural = o.answer.trim() ? o.natural(o.answer) : 0
  const time = lengthScore(seconds, o.target)
  const score = Math.round((landed * 0.6 + time * 0.25 + natural * 0.15) * 100) / 100
  const missed = beats.filter((b) => !b.hit).length
  const [lo, hi] = o.target
  const timeNote = seconds < lo ? 'It ran short.' : seconds > hi ? 'It ran long.' : 'The length was right.'
  return {
    beats,
    seconds,
    target: o.target,
    natural,
    score,
    feedback: !o.answer.trim() ? 'Nothing to mark yet.' : `${beats.length - missed} of ${beats.length} beats landed. ${timeNote}${missed ? ' The missed ones are marked in the script below.' : ''}`,
    by: 'code'
  }
}

/** Claude's beat marks: {"hit": [true, false, …], "feedback": "…"} folded over the code's */
export function readSayIt(raw: string, base: SayItResult): SayItResult | null {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as { hit?: unknown[]; feedback?: unknown; natural?: unknown }
    if (!Array.isArray(j.hit) || j.hit.length !== base.beats.length) return null
    const beats = base.beats.map((b, i) => ({ ...b, hit: !!j.hit![i] }))
    const landed = beats.filter((b) => b.hit).length / Math.max(1, beats.length)
    const natural = typeof j.natural === 'number' && Number.isFinite(j.natural) ? Math.max(0, Math.min(1, j.natural)) : base.natural
    const time = lengthScore(base.seconds, base.target)
    return { ...base, beats, natural, score: Math.round((landed * 0.6 + time * 0.25 + natural * 0.15) * 100) / 100, feedback: typeof j.feedback === 'string' && j.feedback.trim() ? j.feedback.trim() : base.feedback, by: 'claude' }
  } catch {
    return null
  }
}

/** Where each beat sits in the script, to mark the missed ones when the script is shown again */
export function beatSpans(script: string, beats: string[]): ({ at: number; length: number } | null)[] {
  const sentences = [...script.matchAll(/[^.!?\n]+[.!?]?/g)].map((m) => ({ at: (m.index ?? 0) + (m[0].length - m[0].trimStart().length), text: m[0].trim() })).filter((s) => s.text)
  return beats.map((b) => {
    const want = contentWords(b.replace(/…$/, ''))
    let best: { at: number; length: number } | null = null
    let bestHit = 0
    for (const s of sentences) {
      const have = new Set(contentWords(s.text))
      const hit = want.filter((w) => have.has(w)).length
      if (hit > bestHit) {
        bestHit = hit
        best = { at: s.at, length: s.text.length }
      }
    }
    return bestHit >= Math.min(2, want.length) ? best : null
  })
}

// ---------- Claude's reply to feedback ----------

export interface ScriptReply {
  draft?: string
  note: string
  options?: { kind: 'opening' | 'ending'; text: string; draft: string }[]
  facts?: string[]
  voiceRule?: string
}

/** Claude's JSON reply to a draft or a revision; null if it can't be read */
export function parseScriptReply(raw: string): ScriptReply | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '')
  } catch {
    return null
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const draft = str(j.draft)
  const note = str(j.note)
  const options = Array.isArray(j.options)
    ? (j.options as Record<string, unknown>[])
        .map((o) => ({ kind: (str(o?.kind) === 'ending' ? 'ending' : 'opening') as 'opening' | 'ending', text: str(o?.text), draft: str(o?.draft) }))
        .filter((o) => o.text && o.draft)
        .slice(0, 2)
    : []
  const facts = Array.isArray(j.facts) ? (j.facts as unknown[]).map(str).filter(Boolean).slice(0, 5) : []
  const voiceRule = str(j.voiceRule)
  if (!draft && !options.length && !note) return null
  return { ...(draft ? { draft } : {}), note: note || (draft ? 'Revised.' : ''), ...(options.length ? { options } : {}), ...(facts.length ? { facts } : {}), ...(voiceRule && voiceRule.toLowerCase() !== 'null' ? { voiceRule } : {}) }
}

/** Does the feedback ask for alternatives rather than a rewrite */
export const asksForOptions = (feedback: string) => /\b(alternatives?|options?|other ways?|two (other |different |new )?(ways|openings?|endings?|starts?|intros?)|2 (openings?|endings?)|different (opening|ending|start))\b/i.test(feedback)

// ---------- What the script workspace and the API carry ----------

export interface ScriptBundle {
  questionId: string
  question: string
  kind: QuestionKind
  route: string[]
  script: Script | null
  target: [number, number]
  voice: Voice
  /** Numbers and names in the learner's material (claims outside these get flagged) */
  known: string[]
  /** Where a first version would come from */
  start: 'yours' | 'model' | 'outline' | 'claude' | 'blank'
  claude: boolean
  path: string
  voicePath: string
}

export interface ScriptRevision {
  bundle: ScriptBundle
  reply: { note: string; options?: ScriptReply['options']; voiceRule?: string; by: 'claude' | 'code' }
}

export interface ScriptApi {
  script(slug: string, questionId: string): Promise<ScriptBundle>
  /** The first version: the learner's own draft, the model answer, or one drafted from their material */
  scriptStart(slug: string, questionId: string): Promise<ScriptBundle>
  /** A hand edit, kept as a version (nothing happens if it matches the newest) */
  scriptSave(slug: string, questionId: string, text: string): Promise<ScriptBundle>
  scriptRevise(slug: string, questionId: string, feedback: string, current: string): Promise<ScriptRevision>
  /** Picks one of the alternatives Tide offered, as a new version */
  scriptPick(slug: string, questionId: string, draft: string, note: string): Promise<ScriptBundle>
  /** Back to an older version, as a new version */
  scriptRestore(slug: string, questionId: string, n: number): Promise<ScriptBundle>
  scriptLock(slug: string, questionId: string, n: number | null): Promise<ScriptBundle>
  voiceAdd(slug: string, kind: 'rules' | 'samples', line: string): Promise<ScriptBundle['voice']>
  sayIt(slug: string, questionId: string, answer: string, seconds: number | null): Promise<SayItResult>
}

// ---------- Comparing two versions ----------

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * Word-level difference from `a` to `b` (longest common subsequence; scripts are short). Each
 * changed stretch comes out as one removed run then one added run, so it reads as a phrase
 * swapped for another rather than words interleaved. Whitespace stays with the word before it.
 */
export function wordDiff(a: string, b: string): DiffPart[] {
  const toks = (t: string) => t.match(/\S+\s*/g) ?? []
  const x = toks(a)
  const y = toks(b)
  const key = (t: string) => t.trim()
  const n = x.length
  const m = y.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = key(x[i]) === key(y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffPart[] = []
  let removed = ''
  let added = ''
  const flush = () => {
    if (removed) out.push({ kind: 'removed', text: removed })
    if (added) out.push({ kind: 'added', text: added })
    removed = ''
    added = ''
  }
  const same = (t: string) => {
    flush()
    const last = out[out.length - 1]
    if (last?.kind === 'same') last.text += t
    else out.push({ kind: 'same', text: t })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(x[i]) === key(y[j])) {
      same(y[j])
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) removed += x[i++]
    else added += y[j++]
  }
  while (i < n) removed += x[i++]
  while (j < m) added += y[j++]
  flush()
  return out
}
