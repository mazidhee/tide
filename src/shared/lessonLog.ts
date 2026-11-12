/**
 * A lesson kept for later: every turn, as it happened, so a lesson from weeks ago can be read
 * again or carried on. Kept twice: the turns as data (to carry on) and a page to read, in the
 * Lessons folder of your vault, with the tutor's hidden notes and working left out.
 */
import { MODE_LABEL, ownWords, parseBlocks, type Block, type SessionSetup } from './session'
import type { ChatScope, SessionMode } from './types'

export interface LessonTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface LessonRecord {
  /** Stays the same across sittings, so carrying a lesson on keeps one record */
  id: string
  mode: SessionMode
  topic: string
  scope: ChatScope
  options?: SessionSetup['options']
  turns: LessonTurn[]
  started: number
  updated: number
  finished?: boolean
  /** The page in your vault, fixed when the lesson is first kept */
  page?: string
  /** Claude's visuals as checked (shared/visuals), by the key of their source: shown again at once when the lesson is reopened */
  visuals?: Record<string, import('./visuals').VisualRecord>
}

export type LessonSummary = Pick<LessonRecord, 'id' | 'mode' | 'topic' | 'scope' | 'started' | 'updated' | 'finished' | 'page'> & { answers: number; preview: string }

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/** A record id from the key the lesson is kept under while it's going */
export const lessonId = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  const name = (key.split(':').slice(2, -1).join(' ') || 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${name || 'lesson'}-${(h >>> 0).toString(36)}`
}

const day = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Where the page goes: Lessons/2026-11-10 Binary, hexadecimal.md */
export const lessonPage = (r: Pick<LessonRecord, 'topic' | 'started' | 'mode'>) => `Lessons/${day(r.started)} ${fileSafe(r.topic.replace(/^What I already know: /, 'Check: ')) || MODE_LABEL[r.mode] || 'Lesson'}.md`

const quote = (t: string) => t.trim().split('\n').map((l) => `> ${l}`).join('\n')

function block(b: Block): string {
  switch (b.kind) {
    case 'text':
      return b.text
    case 'ask':
      return quote(`**${b.type === 'choice' ? 'Pick one' : 'Question'}:** ${b.prompt}${b.options.length ? `\n${b.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}` : ''}`)
    case 'grade':
      return quote(`**${b.verdict === 'correct' ? 'Right' : b.verdict === 'partial' ? 'Partly right' : 'Not right'}.** ${b.text}`)
    case 'plan':
      return `**Plan**\n${b.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    case 'card':
      return `_Flashcard:_ ${b.front} :: ${b.back}`
    case 'note':
      return quote(`**For your notes:**\n${b.text}`)
    case 'summary':
      return `### Summary\n\n${b.text}`
    case 'scores':
      return b.rows.map((r) => `- ${r.label}: ${r.score}/${r.max}${r.note ? `, ${r.note}` : ''}`).join('\n')
    case 'challenge':
      return quote(b.text)
    default:
      return ''
  }
}

/** What you said, without Tide's hidden notes or the answer-box framing */
export function yourWords(content: string): string {
  return ownWords(content)
    .replace(/^Answer:\s*/, '')
    .replace(/^My question:\s*/, '**Question:** ')
    .replace(/\n\(Confidence: (\w+)\)\s*$/, ' _($1)_')
    .trim()
}

/** The lesson as a page to read: the conversation in order, without the tutor's working or Tide's notes */
export function lessonMarkdown(r: LessonRecord): string {
  const when = new Date(r.started).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const where = r.scope.kind === 'folder' || r.scope.kind === 'note' || r.scope.kind === 'pages' ? r.scope.path : ''
  const front = ['---', `tide_lesson: ${r.id}`, `topic: ${JSON.stringify(r.topic)}`, `mode: ${r.mode}`, `started: ${new Date(r.started).toISOString()}`, `status: ${r.finished ? 'finished' : 'in progress'}`, ...(where ? [`from: ${JSON.stringify(where)}`] : []), 'tags: [lesson]', '---']
  const body: string[] = []
  // The first message is the lesson's setup (instructions and opening), not something you said
  r.turns.forEach((t, i) => {
    if (i === 0 && t.role === 'user') return
    if (t.role === 'user') {
      const said = yourWords(t.content)
      if (said === 'Go on.') body.push('_Go on._')
      else if (/^\[hint\]/.test(said)) body.push('_You asked for a hint._')
      else if (said) body.push(`**You:** ${said}`)
    } else if (t.content.trim()) {
      body.push(parseBlocks(t.content).map(block).filter(Boolean).join('\n\n'))
    }
  })
  return `${front.join('\n')}\n# ${r.topic}\n\n_${MODE_LABEL[r.mode] ?? 'Lesson'}, ${when}${where ? `, from ${where}` : ''}${r.finished ? '' : '. In progress: carry it on from Past lessons'}._\n\n${body.join('\n\n---\n\n')}\n`
}

/** For the list of past lessons */
export function summarise(r: LessonRecord): LessonSummary {
  const answers = r.turns.filter((t, i) => i > 0 && t.role === 'user' && /^Answer:/.test(t.content)).length
  const lastTutor = [...r.turns].reverse().find((t) => t.role === 'assistant')?.content ?? ''
  const preview = parseBlocks(lastTutor).map((b) => (b.kind === 'text' || b.kind === 'summary' ? b.text : b.kind === 'ask' ? b.prompt : '')).filter(Boolean).join(' ').replace(/[#*_`$>]/g, '').replace(/\s+/g, ' ').slice(0, 160)
  return { id: r.id, mode: r.mode, topic: r.topic, scope: r.scope, started: r.started, updated: r.updated, finished: r.finished, page: r.page, answers, preview }
}
