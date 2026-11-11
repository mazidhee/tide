import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { basename, dirname, extname } from 'path'
import type { CardSchedule, ChatScope, Flashcard, ReviewGrade, StudyCard } from '@shared/types'
import { appendRevlog, elapsedDays, RATING as REVLOG_RATING } from './revlog'
import { absPath, allNotes, joinRel, readText, uniquePath, writeText } from './vault'
import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard } from 'ts-fsrs'

const SRS_FILE = joinRel('.tide', 'srs.json')
const FLASHCARD_TAG = 'flashcards'
const SR_COMMENT = /<!--SR:[^>]*-->/g

const cardId = (path: string, front: string) =>
  createHash('sha1').update(`${path}\u0000${front.trim()}`).digest('hex').slice(0, 16)

const ANKI_CLOZE = /\{\{c(\d+)::([^}]*?)(?:::([^}]*))?\}\}/g
const HIGHLIGHT_CLOZE = /==([^=\n]+)==/g

/** One card per cloze group on the line: the gap shows as [...] (or its hint), the back shows the full line. */
function clozeCards(path: string, line: string, i: number, highlights: boolean): Flashcard[] {
  const clean = line.replace(/^\s*[-*]\s+/, '').replace(SR_COMMENT, '').trim()
  const full = clean.replace(ANKI_CLOZE, '$2').replace(HIGHLIGHT_CLOZE, '$1')
  const cards: Flashcard[] = []
  const groups = new Set([...clean.matchAll(ANKI_CLOZE)].map((m) => m[1]))
  for (const g of groups) {
    const front = clean
      .replace(ANKI_CLOZE, (_m, n, text, hint) => (n === g ? `**[${hint || '…'}]**` : text))
      .replace(HIGHLIGHT_CLOZE, '$1')
    cards.push({ id: cardId(path, `${clean}#c${g}`), path, front, back: full, cloze: true, line: i })
  }
  if (highlights) {
    ;[...clean.matchAll(HIGHLIGHT_CLOZE)].forEach((m, k) => {
      const front = clean.replace(ANKI_CLOZE, '$2').replace(HIGHLIGHT_CLOZE, (mm, text, offset) => (offset === m.index ? '**[…]**' : text))
      cards.push({ id: cardId(path, `${clean}#h${k}`), path, front, back: full, cloze: true, line: i })
    })
  }
  return cards
}

/**
 * Parses cards in the Obsidian Spaced Repetition plugin format, plus clozes:
 * Anki style {{c1::answer::hint}} anywhere, and ==highlights== in notes tagged #flashcards.
 */
export function parseFlashcards(path: string, raw: string, opts: { highlightClozes?: boolean } = {}): Flashcard[] {
  const cards: Flashcard[] = []
  const lines = raw.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue

    // Clozes first: "{{c1::x}}" contains "::" and would otherwise read as a question/answer card
    if (ANKI_CLOZE.test(line) || (opts.highlightClozes && HIGHLIGHT_CLOZE.test(line) && !/::/.test(line))) {
      ANKI_CLOZE.lastIndex = 0
      HIGHLIGHT_CLOZE.lastIndex = 0
      cards.push(...clozeCards(path, line, i, !!opts.highlightClozes))
      continue
    }
    ANKI_CLOZE.lastIndex = 0
    HIGHLIGHT_CLOZE.lastIndex = 0

    const reversed = line.indexOf(':::')
    const single = line.indexOf('::')
    // An odd number of backticks before the separator means it is inside inline code (std::vector)
    const insideCode = (at: number) => (line.slice(0, at).match(/`/g)?.length ?? 0) % 2 === 1
    if ((reversed > 0 || single > 0) && !insideCode(reversed > 0 ? reversed : single)) {
      const sep = reversed > 0 ? ':::' : '::'
      const at = reversed > 0 ? reversed : single
      const front = line.slice(0, at).replace(/^\s*[-*]\s+/, '').trim()
      const back = line.slice(at + sep.length).replace(SR_COMMENT, '').trim()
      if (front && back) {
        cards.push({ id: cardId(path, front), path, front, back, line: i })
        if (sep === ':::') cards.push({ id: cardId(path, back), path, front: back, back: front, reversed: true, line: i })
      }
      continue
    }

    // Multi-line card: question lines, a line with just "?", answer lines, ended by a blank line
    if (line.trim() === '?' && i > 0) {
      const front: string[] = []
      for (let j = i - 1; j >= 0 && lines[j].trim() !== '' && !/^#{1,6}\s/.test(lines[j]); j--) front.unshift(lines[j])
      const back: string[] = []
      let j = i + 1
      for (; j < lines.length && lines[j].trim() !== ''; j++) back.push(lines[j])
      const f = front.join('\n').trim()
      const b = back.join('\n').replace(SR_COMMENT, '').trim()
      if (f && b) cards.push({ id: cardId(path, f), path, front: f, back: b, line: i })
      i = j
    }
  }
  return cards
}


const scheduler = fsrs({ enable_fuzz: true })
const LEECH_LAPSES = 6
const DAY = 24 * 60 * 60 * 1000

export type StoredCard = Partial<CardSchedule> & { fsrs?: Record<string, unknown>; ease?: number }
type Store = Record<string, StoredCard>

async function loadStore(): Promise<Store> {
  try {
    return existsSync(absPath(SRS_FILE)) ? JSON.parse(await fs.readFile(absPath(SRS_FILE), 'utf8')) : {}
  } catch {
    return {}
  }
}

const saveStore = (store: Store) => writeText(SRS_FILE, JSON.stringify(store))

/** Rebuilds an FSRS card from storage, migrating schedules saved by the earlier SM-2 scheduler. */
function toFsrs(stored: StoredCard | undefined, now: Date): FsrsCard {
  if (!stored) return createEmptyCard(now)
  if (stored.fsrs) {
    const f = stored.fsrs as unknown as FsrsCard & { due: string; last_review?: string }
    return { ...f, due: new Date(f.due), last_review: f.last_review ? new Date(f.last_review) : undefined }
  }
  const card = createEmptyCard(now)
  return {
    ...card,
    due: new Date(stored.due ?? now.getTime()),
    stability: Math.max(stored.interval ?? 1, 0.5),
    difficulty: 5,
    reps: stored.reps ?? 0,
    lapses: stored.lapses ?? 0,
    state: (stored.reps ?? 0) > 0 ? State.Review : State.New,
    last_review: new Date((stored.due ?? now.getTime()) - (stored.interval ?? 1) * DAY)
  }
}

function toSchedule(card: FsrsCard): CardSchedule {
  const last = card.last_review ? new Date(card.last_review).getTime() : undefined
  const due = new Date(card.due).getTime()
  return {
    due,
    interval: last ? (due - last) / DAY : 0,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: last
  }
}

const RATING: Record<ReviewGrade, Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
}

/** Schedules a stored card for a grade without touching disk, used by reviews and tests */
export function scheduleAfter(stored: StoredCard | undefined, grade: ReviewGrade, now = new Date()) {
  const card = scheduler.next(toFsrs(stored, now), now, RATING[grade]).card
  return { stored: { fsrs: card as unknown as Record<string, unknown> } as StoredCard, schedule: toSchedule(card) }
}

export function previewFor(stored: StoredCard | undefined, now = new Date()): Record<ReviewGrade, number> {
  const options = scheduler.repeat(toFsrs(stored, now), now)
  const days = (g: ReviewGrade) => (new Date(options[RATING[g]].card.due).getTime() - now.getTime()) / DAY
  return { again: days('again'), hard: days('hard'), good: days('good'), easy: days('easy') }
}

const inScope = (scope: ChatScope, path: string) =>
  scope.kind === 'note' || scope.kind === 'pages'
    ? scope.path === path
    : scope.kind === 'folder'
      ? scope.path === '' || path.startsWith(scope.path + '/')
      : true

export async function getCards(scope: ChatScope): Promise<StudyCard[]> {
  const notes = (await allNotes()).filter(
    (n) => inScope(scope, n.path) && (scope.kind === 'note' || n.tags.some((t) => t === FLASHCARD_TAG || t.startsWith(FLASHCARD_TAG + '/')))
  )
  const store = await loadStore()
  const cards: StudyCard[] = []
  for (const note of notes) {
    const raw = await readText(note.path)
    const tagged = note.tags.some((t) => t === FLASHCARD_TAG || t.startsWith(FLASHCARD_TAG + '/'))
    for (const card of parseFlashcards(note.path, raw, { highlightClozes: tagged })) {
      const stored = store[card.id]
      const schedule = stored?.fsrs || stored?.due !== undefined ? toSchedule(toFsrs(stored, new Date())) : null
      cards.push({ ...card, schedule, preview: previewFor(stored), leech: (schedule?.lapses ?? 0) >= LEECH_LAPSES })
    }
  }
  return cards
}

export async function reviewCard(id: string, grade: ReviewGrade, path: string): Promise<CardSchedule> {
  const store = await loadStore()
  const now = new Date()
  const before = store[id] ? toFsrs(store[id], now).last_review : undefined
  const { stored, schedule } = scheduleAfter(store[id], grade, now)
  store[id] = stored
  await saveStore(store)
  const { logReview } = await import('./learn')
  await logReview(id, path, grade, schedule.interval, now.getTime())
  await appendRevlog([{ rating: REVLOG_RATING[grade], elapsedDays: elapsedDays(before ? new Date(before).getTime() : undefined, now.getTime()), id, kind: 'flashcard', at: now.getTime() }])
  // And on the topic it is about, in the knowledge map (never a reason for a review to fail)
  await import('./knowledge').then((k) => k.noteCardReview({ id, path, grade, at: now.getTime(), first: !before })).catch(() => {})
  return schedule
}

/** Saves AI generated cards next to the source note as "<Note> (Flashcards).md". */
export async function saveCards(sourcePath: string, cardsMarkdown: string): Promise<string> {
  const name = basename(sourcePath, extname(sourcePath))
  const dir = dirname(sourcePath) === '.' ? '' : dirname(sourcePath)
  const target = joinRel(dir, `${name} (Flashcards).md`)
  const header = `#${FLASHCARD_TAG}\n\nCards for [[${name}]]\n\n`
  if (existsSync(absPath(target))) {
    const existing = await readText(target)
    await writeText(target, existing.trimEnd() + '\n\n' + cardsMarkdown.trim() + '\n')
    return target
  }
  const path = uniquePath(target)
  await writeText(path, header + cardsMarkdown.trim() + '\n')
  return path
}
