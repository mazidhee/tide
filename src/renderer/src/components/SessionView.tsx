import { testNames } from '@shared/codeTests'
import { showMeOffered } from '@shared/showMe'
import { ASK_VISUAL_EVENT, takeVisualNotes } from '../lib/visuals'
import { TimeThis } from './TimeThis'
import { drawSteps, stepsReached } from '@shared/project'
import { parseCanvas, serializeCanvas } from '@shared/canvas'
import { readingLabel, type ReadingSuggestion } from '@shared/books'
import { notesReviewRequest, wantsNotesReview } from '@shared/lessonNotes'
import { reveal } from '../lib/scroll'
import { Thinking } from './Thinking'
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStep, ChatMessage, ChatScope, RunResult, SessionMode } from '@shared/types'
import { markNote, paceNote } from '@shared/pace'
import { markingNote } from '@shared/humanities'
import { teachesAsHumanities } from '@shared/subjects'
import { AppraiseCard } from './AppraiseCard'
import { useDifficulty } from '../lib/difficulty'
import { nothingToMark, unmarked } from '@shared/lessonRepair'
import { citeSources, withSources, type SourcePack } from '@shared/sources'
import { ledPrefKey, withoutEcho } from '@shared/sourceLed'
import { formatRange, offeredClip, recapMessage, watchFirstNote, type ClipCandidate } from '@shared/video'
import { ClipCard } from './ClipCard'
import { relatedForPrompt } from '@shared/related'
import { openReading } from '../lib/reading'
import { codeBlockClick } from '../lib/runBlocks'
import { parsePlacement, placementNote } from '@shared/placement'
import { correctionText } from '@shared/lessonCheck'
import type { Reading } from '@shared/readings'
import { whyByDefault } from '../lib/agenda'
import { ASKED, END_NOW, GO_ON, SHOW_ME, askIdentity, askStarter, shouldSumUp, MODE_LABEL, notesNudge, whyNote, ownWords, openingMessage, withPassage, parseBlocks, sessionInstructions, strategyChoice, lessonCanvasPath, type Block, type SessionSetup } from '@shared/session'
import { STRATEGIES, STRATEGY_LABEL, STRATEGY_RULES, switchFrom, type Strategy } from '@shared/strategy'
import { cardsToMarkdown } from '@shared/cards'
import { fileTitle, useApp, pagesLabel } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'
import { formatEditor } from '../lib/ruff/editor'
import type * as Monaco from 'monaco-editor'
import { EnginePill, engineFields, type Engine } from './EnginePill'
import { DictateButton, SpeakButton, useTalk } from './Voice'
import { AttachedStrip, AttachImageButton, useAttachedImages } from './AttachImages'
import { InterviewClock, useInterviewClock } from './InterviewClock'
import { LessonNotes } from './LessonNotes'
import { finishAgendaItem } from '../lib/agenda'
import { useStudying } from '../lib/studying'
import { lessonId } from '@shared/lessonLog'
import { endOngoing, followInBackground, getOngoing, keepLesson, keepLive, saveOngoing, sessionKey, stopFollowing } from '../lib/sessions'
import type { View } from '../state'
import { Professor, type ProfessorPose } from './Professor'
import { YouBeside } from './Avatar'
import { useTideDesign } from '../lib/design'
import { characterById } from '@shared/characters'
import { conceptFor, useKnowledge } from '../lib/knowledge'
import { useAreaClass } from '../lib/areas'
import { Level } from './tide/Level'
import { AreaMark } from './tide/AreaMark'
import { AnswerHint, AskPill, BackPill, FOLD_MS, SelectionAsk, ThreadSlot, highlightQuote, reducedMotion, type SelectionAt } from './LessonThreads'
import { CameUpIn } from './ExploreLater'
import { WarmUp } from './WarmUp'
import { warmupNote, type WarmupSet } from '@shared/warmup'
import { prepNote } from '@shared/lessonPrep'
import { breakSignals, lessonForBreaks } from '../lib/breaks'
import { saysDontKnow } from '@shared/lessonRepair'
import { exploreLater, lessonSubject } from '../lib/explore'
import { THREAD_RULES, asked, newThread, outputText, readsAsQuestion, replyParts, restoreThreads, saveFallback, threadMessages, threadNotes, threadsNote, wantsSave, withNote, type LessonThread } from '@shared/lessonThreads'
import { lessonMap, type Divider } from '@shared/lessonMap'
import { isMoveOn, moveOnRequest } from '@shared/lessonPlan'
import { localDate, todayItems } from '@shared/coach'
import type { AgendaItem } from '@shared/coach'
import { loadDaily } from '../lib/daily'
import { startAgendaLesson } from '../lib/agenda'
import { AskPurpose, LessonEnd, LessonTrack, MoveOnChip, StepDivider } from './LessonTrack'

// Loaded when a lesson needs them: the code editor (Monaco) and the walkthrough canvas
const answered = (said: string) => !said.startsWith(GO_ON) && !said.startsWith(ASKED) && !isMoveOn(said)

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))
const LessonProposal = lazy(() => import('./LessonProposal'))
import { exerciseFile, exerciseNumber, isCodingLesson } from '@shared/lessonCode'
import { useLessonCode } from '../lib/lessonCode'
const LessonCanvas = lazy(() => import('./LessonCanvas').then((m) => ({ default: m.LessonCanvas })))
import { parseVerdict, scorecardScore } from '@shared/interviews'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  steps?: AgentStep[]
  /** When it was sent: kept with a lesson in progress, for the lesson map's minutes */
  at?: number
}

/** The tutor's lesson_progress reports (Claude), as the tags its reply would carry */
const progressOf = (t: Turn) => (t.steps ?? []).filter((x) => x.kind === 'progress' && x.detail).map((x) => x.detail!)
/** Kept in the reply once it's written, so the map comes back when the lesson is reopened */
const foldProgress = (t: Turn): Turn => {
  const tags = progressOf(t).filter((tag) => !t.content.includes(tag))
  const steps = t.steps?.filter((x) => x.kind !== 'progress')
  return tags.length || steps?.length !== t.steps?.length ? { ...t, content: tags.length ? `${t.content.trimEnd()}\n\n${tags.join('\n')}` : t.content, steps } : t
}

const CONFIDENCE = [
  { value: 1, label: 'Guessing' },
  { value: 2, label: 'Unsure' },
  { value: 3, label: 'Sure' }
] as const

const HINT_LEVELS = ['Nudge', 'Hint', 'Show a step', 'Show the answer']

const uid = () => Math.random().toString(36).slice(2, 10)
/** "arxiv.org" from a link, or the link itself when it isn't one */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const inFocusWindow = /[#&]focus=/.test(window.location.hash)

export function SessionView({ mode, scope, topic, options, initialTurns, view }: { mode: SessionMode; scope: ChatScope; topic: string; options?: SessionSetup['options']; initialTurns?: { role: 'user' | 'assistant'; content: string }[]; view?: View }) {
  const ongoingKey = view ? sessionKey(view as { kind: string; mode?: string; topic?: string; nonce?: number }) : null
  // The record a lesson or quiz is kept under (lib/sessions.ts keepLesson): its answers are read from there
  // The lesson's column: Claude's visuals in it report to the tutor
  const columnRef = useRef<HTMLDivElement>(null)
  const recordId = view?.kind === 'session' && ongoingKey && (mode === 'teach' || mode === 'quiz') ? (view.lesson ?? lessonId(ongoingKey)) : undefined
  // The lesson's data lab: the tutor's run_sql and the queries you run in the lesson share it
  const labId = useRef(`lesson:${ongoingKey ?? uid()}`)
  const app = useApp()
  const [turns, setTurns] = useState<Turn[]>([])
  // Side threads under the tutor's outputs (shared/lessonThreads): kept apart from the turns
  const [threads, setThreads] = useState<LessonThread[]>([])
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const [openThread, setOpenThread] = useState<string | null>(null)
  const openThreadRef = useRef(openThread)
  openThreadRef.current = openThread
  // The thread a reply is being written in, its tool steps and a failed reply's error
  const [threadBusy, setThreadBusy] = useState<string | null>(null)
  const [threadSteps, setThreadSteps] = useState<Record<string, AgentStep[]>>({})
  const [threadError, setThreadError] = useState<Record<string, string>>({})
  const threadReqs = useRef(new Map<string, string>())
  // Bumped when a thread changes in a way worth saving (a reply done, folded, noted)
  const [threadsRev, setThreadsRev] = useState(0)
  // Typed in the answer box but it reads like a question about the explanation
  const [hint, setHint] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  // Photos of working or screenshots added to the answer or a question (AttachImages)
  const pictures = useAttachedImages()
  const [code, setCode] = useState('')
  const codeRef = useRef<import('../lib/lessonCode').LessonCode | null>(null)
  const codeEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null)
  // The last reply is written but its checks are still running: its mark isn't final yet
  const [checking, setChecking] = useState(false)
  const [hintLevel, setHintLevel] = useState(0)
  const [runOut, setRunOut] = useState<RunResult | null>(null)
  /** The code that runOut came from */
  const ranFor = useRef('')
  const [running, setRunning] = useState(false)
  const [savedCards, setSavedCards] = useState<Set<string>>(new Set())
  const [web, setWeb] = useState(() => localStorage.getItem('tide.chat.web') !== 'off')
  // [source-led] Teach from sources (a step opens with a reading when a good source is found) or let the tutor explain: remembered per notebook
  const [led, setLed] = useState(() => !!options?.course || localStorage.getItem(ledPrefKey(scope)) !== 'off')
  const ledRef = useRef(led)
  ledRef.current = led
  const activeId = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const recorded = useRef(new Set<string>())
  const talkRef = useRef(localStorage.getItem('tide.talk') === 'on')
  const answerRef2 = useRef<(said: string) => void>(() => {})
  const submitRef = useRef<() => void>(() => {})
  const carryOnRef = useRef(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const gradeIndex = useRef(0)
  // A right answer gets a lightbulb moment
  const [cheer, setCheer] = useState(0)
  useEffect(() => {
    if (!cheer) return
    const t = setTimeout(() => setCheer(0), Math.max(0, cheer - Date.now()))
    return () => clearTimeout(t)
  }, [cheer])
  // How to teach it: what was asked for, else the router's choice, settled before the first message
  const choice = useMemo(() => strategyChoice({ mode, topic, options }, scope), [mode, topic, options, JSON.stringify(scope)])
  const [taught, setTaught] = useState<Strategy | undefined>(() => options?.strategy ?? choice?.strategy)
  // Why mode: decided once when the lesson starts (it's part of the cached instructions); the
  // toggle changes it from the next message on, by a hidden note
  const whyAtStart = useMemo(() => mode === 'teach' && (options?.why ?? whyByDefault(app.settings.whyMode, topic)), [])
  const [why, setWhy] = useState(whyAtStart)
  const whyNoteRef = useRef<string | null>(null)
  const toggleWhy = () =>
    setWhy((on) => {
      whyNoteRef.current = whyNote(!on)
      return !on
    })
  const setup: SessionSetup = useMemo(() => ({ mode, topic, options: { ...options, ...(taught ? { strategy: taught } : {}), ...(whyAtStart ? { why: true } : {}) } }), [mode, topic, options, taught, whyAtStart])
  const setupRef = useRef(setup)
  setupRef.current = setup
  // The approach right now: changes when you ask for another mid-lesson
  const [approach, setApproach] = useState<Strategy | undefined>(taught)
  const approachRef = useRef(approach)
  approachRef.current = approach
  // A walkthrough draws on a canvas kept with the topic
  const canvasPath = useMemo(() => lessonCanvasPath(scope, topic), [scope, topic])
  // A walkthrough with known steps: draw each as soon as the tutor reaches it (code, not the model)
  const [canvasRev, setCanvasRev] = useState(0)
  const drawn = useRef(0)
  const timed = mode === 'interview' ? options?.timed : undefined
  const sendRef = useRef<(content: string, history: Turn[]) => void>(() => {})
  const turnsRef = useRef<Turn[]>([])
  // At zero the interviewer is told to stop and score, as in a real round
  const clock = useInterviewClock(timed, () => sendRef.current("[time] Time's up. Stop here and give me the scorecard and verdict.", turnsRef.current))
  const sourcePath = scope.kind === 'note' || scope.kind === 'pages' ? scope.path : undefined
  // Dictation: a private project's answers stay on this Mac; the topic helps it spell the jargon
  const heardIn = useMemo(() => ({ path: 'path' in scope ? scope.path : undefined, topic }), [JSON.stringify(scope), topic])
  const env = { notePath: sourcePath ?? '', filesByName: app.filesByName }

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (e.id !== activeId.current) return
        setTurns((list) => {
          const last = list[list.length - 1]
          if (!last || last.role !== 'assistant') return list
          const next = [...list]
          if (e.type === 'delta') next[next.length - 1] = { ...last, content: last.content + e.text }
          if (e.type === 'reset') next[next.length - 1] = { ...last, content: '' }
          if (e.type === 'step') {
            const steps = [...(last.steps ?? [])]
            const at = steps.findIndex((s) => s.id === e.step.id)
            if (at >= 0) steps[at] = { ...steps[at], ...e.step }
            else steps.push(e.step)
            next[next.length - 1] = { ...last, steps }
          }
          if (e.type === 'replied' || e.type === 'done') next[next.length - 1] = foldProgress(next[next.length - 1])
          return next
        })
        if (e.type === 'error') setError(e.message)
        // Written: you can answer while its checks finish (corrections are added below, never in place)
        if (e.type === 'replied') {
          setBusy(false)
          setChecking(true)
        }
        if (e.type === 'reset') setBusy(true)
        if (e.type === 'done' || e.type === 'error') {
          activeId.current = null
          setBusy(false)
          setChecking(false)
        }
      }),
    []
  )

  // What the tutor last asked, and which model you chose: a worked answer to a problem can go to the cloud model
  const askTypeRef = useRef<string | undefined>(undefined)
  const [engine, setEngine] = useState<Engine>('auto')
  // A notebook set to be taught by the cloud model starts its lessons that way (you can still switch)
  useEffect(() => {
    const where = 'path' in scope ? scope.path : ''
    if (!where) return
    window.tide.learn
      .notebooks()
      .then((nbs) => {
        const nb = nbs.find((n) => where === n.path || where.startsWith(`${n.path}/`))
        if (nb?.tutor === 'cloud') setEngine((e) => (e === 'auto' ? 'cloud' : e))
        // Gemma or Claude by the notebook: main decides that from the notebook itself (main/teacher), so Auto shows it
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const engineRef = useRef(engine)
  engineRef.current = engine
  // Hook (lib/difficulty.ts): how hard the next problem is follows how the answers are going
  const difficulty = useDifficulty(topic, scope, mode === 'teach' || (mode === 'quiz' && !setup.options?.placement), busy)
  const send = useCallback(
    async (content: string, history: Turn[]) => {
      const id = `session:${uid()}`
      // For the break planner: how answers are going (lib/breaks)
      if (/^Answer:/.test(content)) {
        const said = ownWords(content).replace(/^Answer:\s*/, '').replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
        breakSignals.answered({ words: said.split(/\s+/).filter(Boolean).length, dontKnow: saysDontKnow(said), skip: isMoveOn(content) || /^Answer:\s*skip\b/i.test(content), topic: setupRef.current.topic })
        answeredHere.current = true
      } else if (/^\[hint\]/.test(content)) breakSignals.hint()
      // Answered while the last reply's checks were still running: stop them, your answer comes first
      if (activeId.current) window.tide.ai.cancel(activeId.current).catch(() => {})
      setChecking(false)
      activeId.current = id
      setBusy(true)
      setError(null)
      // Hidden notes for the tutor (pace, notes), kept with your message so every later request
      // sends exactly the same text and the model server's cache still matches. Shown without them.
      const notes = content.includes('(Tide: ') || history.length < 2 ? [] : [
        // A placement check ends after its last question, whether or not the tutor counts
        setupRef.current.options?.placement ? placementNote(history.filter((t) => t.role === 'user').length - 1) : null,
        mode === 'teach' || (mode === 'quiz' && !setupRef.current.options?.placement) ? paceNote(history, content) : null,
        // Hook (shared/difficulty.ts): stands aside on a turn the pace note already speaks for
        paceNote(history, content) ? null : difficulty.noteFor(history, content),
        // humanities: an answer to a question of interpretation is appraised, not marked (when the subject's profile says it is taught as the humanities)
        mode === 'teach' || (mode === 'quiz' && !setupRef.current.options?.placement)
          ? markingNote(markNote(content), [...history].reverse().find((t) => t.role === 'assistant')?.content ?? '', setupRef.current.topic, teachesAsHumanities(setupRef.current.topic, setupRef.current.options?.subject))
          : null,
        whyNoteRef.current,
        // What the learner did in Claude's visuals since the tutor last heard
        ...takeVisualNotes(columnRef.current),
        mode === 'teach' && history.length > 2 ? notesNudge(history.filter((t) => t.role === 'assistant').map((t) => t.content), content) : null,
        // Threads understood since the tutor last heard: one line each, never the thread itself
        threadsNote(threadsRef.current)
      ].filter((n): n is string => !!n)
      if (notes.includes(whyNoteRef.current ?? '')) whyNoteRef.current = null
      if (notes.some((n) => n === threadsNote(threadsRef.current))) {
        setThreads((list) => list.map((t) => (t.understood && !t.told && asked(t) ? { ...t, told: true } : t)))
        setThreadsRev((r) => r + 1)
      }
      // Starting again from the top: the threads hung off the outputs that are gone
      if (!history.length) {
        setThreads([])
        setOpenThread(null)
      }
      const stored = notes.length ? `${content}\n\n${notes.join('\n')}` : content
      const now = Date.now()
      const next: Turn[] = [...history, { role: 'user', content: stored, at: now }, { role: 'assistant', content: '', at: now }]
      setTurns(next)
      const messages: ChatMessage[] = next.slice(0, -1).map((t) => ({ role: t.role, content: t.content }))
      // In a timed round the interviewer sees the time left with each answer, to pace the round
      if (timed) {
        clock.start()
        const last = messages[messages.length - 1]
        messages[messages.length - 1] = { ...last, content: `(Time left: ${clock.left() || timed} of ${timed} minutes)\n${last.content}` }
      }
      // A coding lesson: what's in the editor is on disk before the tutor's tools read it
      const coding = codeRef.current
      if (coding) await coding.flush()
      await window.tide.ai.chat({ id, messages, scope, instructions: sessionInstructions(setupRef.current), labId: labId.current, ...(coding ? { codeLesson: { file: coding.file ?? undefined, root: setupRef.current.options?.codeRoot } } : {}), canvasPath: approachRef.current === 'walkthrough' ? canvasPath : undefined, session: true, topic: setupRef.current.topic, web, voice: talkRef.current ? (app.settings.character ?? 'professor') : undefined, askType: askTypeRef.current, ...engineFields(engineRef.current), sourceLed: ledRef.current, ...(setupRef.current.options?.course ? { course: { id: setupRef.current.options.course.id, lesson: setupRef.current.options.course.lesson } } : {}) })
    },
    [scope, setup, web, timed, clock, mode, difficulty.noteFor]
  )
  sendRef.current = send
  answerRef2.current = (said) => {
    if (busy) return
    // Mid-explanation, "go on" (said alone) carries on; anything else is a question
    if (carryOnRef.current) send(/^((yes|yeah|yep|ok|okay|sure|right),?\s+)?(go on|continue|next|carry on|keep going)( please)?[.!]?$/i.test(said.trim()) ? GO_ON : `${ASKED}${said}`, turnsRef.current)
    else send(`Answer: ${said}`, turnsRef.current)
  }
  turnsRef.current = turns

  // A lesson on a topic a book you own covers is taught from that section: its text rides in the
  // opening message (hidden, and cached with the start of the lesson, so it costs time once)
  const openingRef = useRef(openingMessage(setup))
  // The warm-up before a lesson (shared/warmup): the lesson's opening waits for it; its sources load meanwhile
  const [warm, setWarm] = useState<WarmupSet | null>(null)
  const warmGate = useRef<Promise<string>>(Promise.resolve(''))
  const warmDone = useRef<((note: string) => void) | null>(null)
  const answeredHere = useRef(false)
  const startWarmup = (): Promise<string> =>
    new Promise<string>((resolve) => {
      if (mode !== 'teach' || options?.placement || options?.review || options?.check || options?.retest?.length) return resolve('')
      let settled = false
      // Never hold a lesson up for long waiting for the cards
      const wait = setTimeout(() => ((settled = true), resolve('')), 3000)
      // A prepared lesson brings its warm-up with it (main/lessonPrep)
      const prepared = options?.prep ? window.tide.prep.get(options.prep.id).then((p) => p?.warmup ?? null).catch(() => null) : Promise.resolve(null)
      prepared
        .then((set) => set ?? window.tide.warmup.for(topic, 'path' in scope ? scope.path : undefined))
        .then((set) => {
          if (settled) return
          clearTimeout(wait)
          settled = true
          if (!set.cards.length) return resolve('')
          warmDone.current = resolve
          setWarm(set)
        })
        .catch(() => (clearTimeout(wait), resolve('')))
    })
  const [pack, setPack] = useState<SourcePack | null>(null)
  const begin = async () => {
    // Prepared ahead (main/lessonPrep): the first exchange is ready, so the lesson opens at once
    if (options?.prep) {
      const id = options.prep.id
      const [prep, ready] = await Promise.all([window.tide.prep.get(id).catch(() => null), window.tide.prep.opening(id).catch(() => null)])
      const warmed = await warmGate.current
      if (ready) {
        const message = warmed ? `${ready.message}\n\n${warmed}` : ready.message
        openingRef.current = message
        setTurns([
          { role: 'user', content: message, at: Date.now() },
          { role: 'assistant', content: ready.reply, at: Date.now() }
        ])
        return
      }
      // Prepared without Claude: start as usual, with what was prepared in the opening
      if (prep) {
        let opening = `${openingMessage(setup)}\n\n${prepNote(prep)}`
        if (warmed) opening = `${opening}\n\n${warmed}`
        openingRef.current = opening
        return send(opening, [])
      }
    }
    let opening = openingMessage(setup)
    if ((mode === 'teach' || mode === 'quiz') && (scope.kind === 'vault' || scope.kind === 'folder')) {
      const found = await Promise.race([window.tide.books.passage(topic, 'path' in scope ? scope.path : '').catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2000))])
      if (found) opening = withPassage(opening, found)
    }
    // The passages it's taught from (specs, papers, docs found for the topic), when they're ready
    if (mode === 'teach') {
      const where = 'path' in scope ? scope.path : undefined
      const found = await Promise.race([window.tide.sources.lesson(topic, where).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
      if (found) {
        setPack(found)
        opening = withSources(opening, found)
      }
    }
    // [videos] A saved video or a course's video covers the topic: a section of it is offered
    // before the first reply ("Watch 4:10–9:30 first"), and the tutor is told what's said in it
    if (mode === 'teach') {
      const clips = await Promise.race([window.tide.videos.clips(topic, { limit: 1 }).catch(() => []), new Promise<ClipCandidate[]>((r) => setTimeout(() => r([]), 1500))])
      if (clips[0]) opening = `${opening}\n\n${watchFirstNote(clips[0])}`
      // [immersive] What the learner's other courses and lectures add on this topic, for the tutor to
      // bring in as it teaches (shared/related). Never for a private notebook's lesson
      if (scope.kind === 'none' || scope.kind === 'vault' || options?.course) {
        const r = await Promise.race([window.tide.links.related(topic, { exclude: options?.course?.id, limit: 3 }).catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), 2500))])
        const items = r?.items.filter((i) => !(i.kind === 'clip' && clips[0] && i.video === clips[0].video)) ?? []
        if (r && (items.length || r.notImported.length))
          opening = `${opening}\n\n(Tide: ${relatedForPrompt({ ...r, items })} Bring each in when the lesson reaches the idea it covers, not all at once; the first may fit your first explanation.)`
      }
    }
    // The warm-up on what this builds on, when there is one: the tutor hears what held and what faded
    const warmed = await warmGate.current
    if (warmed) opening = `${opening}\n\n${warmed}`
    openingRef.current = opening
    // Written ahead for this exact lesson (main/bank.ts): it opens at once
    const ready = await window.tide.bank.opening(sessionInstructions(setupRef.current), opening).catch(() => null)
    if (ready) {
      setTurns([
        { role: 'user', content: opening, at: Date.now() },
        { role: 'assistant', content: ready, at: Date.now() }
      ])
      return
    }
    send(opening, [])
  }

  // Typing an answer: the model's background work holds off, so it is free when you send
  useEffect(() => {
    let last = 0
    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (!t?.closest?.('main') || Date.now() - last < 2000) return
      last = Date.now()
      window.tide.ai.typing?.().catch(() => {})
    }
    document.addEventListener('input', onInput, true)
    return () => document.removeEventListener('input', onInput, true)
  }, [])

  // Start the session
  useEffect(() => {
    // Left earlier and come back to: carry on where it was (a reply may have arrived meanwhile)
    const saved = ongoingKey ? getOngoing(ongoingKey) : undefined
    if (saved) {
      stopFollowing(ongoingKey!)
      const st = saved.state as { turns: Turn[]; activeId: string | null; threads?: unknown }
      // Tide closed while the tutor was replying: drop the cut-off reply and ask for it again
      if (saved.interrupted) {
        const turns = st.turns.map((t) => ({ ...t }))
        while (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop()
        const answer = turns.pop()
        setThreads(restoreThreads(st.threads, answer?.role === 'user' ? turns : st.turns))
        if (answer?.role === 'user') send(answer.content, turns)
        else setTurns(st.turns.map((t) => ({ ...t })))
        return
      }
      setTurns(st.turns.map((t) => ({ ...t })))
      setThreads(restoreThreads(st.threads, st.turns))
      if (saved.busy && st.activeId) {
        activeId.current = st.activeId
        setBusy(true)
      }
      return
    }
    // Carried over from another window: pick up where it was
    if (initialTurns?.length) {
      setTurns(initialTurns)
      setThreads(restoreThreads(view?.kind === 'session' ? view.threads : undefined, initialTurns))
      return
    }
    setTurns([])
    warmGate.current = startWarmup()
    // A close call between two ways of teaching: the model breaks the tie, in a second or two
    if (choice && !choice.clear && !options?.strategy) {
      window.tide.ai
        .tieBreak(topic, [choice.strategy, choice.runnerUp], options?.project ? `part of the project ${options.project.name}` : undefined)
        .catch(() => choice.strategy)
        .then((s) => {
          setTaught(s)
          setApproach(s)
          approachRef.current = s
          setupRef.current = { ...setupRef.current, options: { ...setupRef.current.options, strategy: s } }
          begin()
        })
      return
    }
    begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, topic, JSON.stringify(scope)])

  useEffect(() => {
    reveal(bottomRef.current, { block: 'end' })
  }, [turns.length, busy])

  // A reply to the opening message has nothing to grade yet: small models sometimes grade the
  // question they're about to ask, and make a flashcard from that "miss"
  const parsed = useMemo(
    () =>
      turns.map((t, i) => {
        if (t.role !== 'assistant') return null
        // Nor has a question of yours, Go on or "I don't know": a mark on one is shown as the plain
        // feedback it is, while it streams as well as after main has put the reply right (lessonRepair)
        // [source-led] the tutor's own copy of a reading Tide already shows is left out (shared/sourceLed)
        // (with the map's reports from Claude that aren't in the reply yet)
        const content = withoutEcho(progressOf(t).length ? `${t.content}\n${progressOf(t).join('\n')}` : t.content)
        const blocks = parseBlocks(i > 1 && nothingToMark(turns[i - 1]?.content ?? '') ? unmarked(content) : content)
        return i <= 1 ? blocks.filter((b) => b.kind !== 'grade' && b.kind !== 'card') : blocks
      }),
    [turns]
  )
  const lastBlocks = parsed[parsed.length - 1] ?? []
  // Never leave the student without a box to answer in while the session is still going
  const lastIsTutor = turns[turns.length - 1]?.role === 'assistant'
  // The tutor is carrying on explaining: Go on, or ask something (the box opens for a question)
  const carryOn = !busy && lastIsTutor && lastBlocks.some((b) => b.kind === 'continue')
  carryOnRef.current = carryOn
  const currentAsk = !busy
    ? ((lastBlocks.filter((b) => b.kind === 'ask').pop() as Extract<Block, { kind: 'ask' }> | undefined) ??
      (lastIsTutor && lastBlocks.length && !carryOn && !lastBlocks.some((b) => b.kind === 'summary' || b.kind === 'scores') ? { kind: 'ask' as const, type: 'short' as const, prompt: '', options: [] } : undefined))
    : undefined
  askTypeRef.current = currentAsk?.type
  const currentAskRef = useRef(currentAsk)
  currentAskRef.current = currentAsk
  // For the break planner: a question is on screen, waiting; how long the answer takes counts from here
  useEffect(() => {
    if (currentAsk?.prompt) breakSignals.asked()
  }, [currentAsk?.prompt])
  // A coding lesson (shared/lessonCode): each code question is answered in a file of the lesson's
  // folder, which the tutor reads, runs and reviews on Claude, and the IDE can open
  const coding = useMemo(() => isCodingLesson({ mode, topic, options }), [])
  const codeAsks = useMemo(() => {
    const seen: string[] = []
    let lang = options?.language ?? 'python'
    for (const blocks of parsed)
      for (const b of blocks ?? []) {
        const id = b.kind === 'ask' ? askIdentity(b) : null
        if (!id) continue
        if (!seen.includes(id)) seen.push(id)
        lang = (b.kind === 'ask' && b.lang) || lang
      }
    return { seen, lang }
  }, [parsed])
  const lastCodeAsk = codeAsks.seen[codeAsks.seen.length - 1]
  const lessonCode = useLessonCode({
    on: coding,
    labId: labId.current,
    topic,
    linkedRoot: options?.codeRoot,
    exercise: lastCodeAsk ? exerciseFile(exerciseNumber(codeAsks.seen, lastCodeAsk), codeAsks.lang) : null,
    code,
    setCode,
    busy
  })
  codeRef.current = coding ? lessonCode : null
  const openInIde = async () => {
    try {
      await lessonCode.flush()
      const w = await window.tide.ide.lesson.openInIde(labId.current, topic, options?.codeRoot)
      localStorage.setItem('tide.ide.root', JSON.stringify(w.root))
      localStorage.setItem('tide.ide.right', JSON.stringify('claude'))
      if (lessonCode.file) localStorage.setItem('tide.ide.openFile', JSON.stringify({ root: w.root, path: lessonCode.file }))
      app.setView({ kind: 'code' })
    } catch (e) {
      app.toast((e as Error).message, { tone: 'error' })
    }
  }
  // A new code question starts from its own starter, not from your answer to the last one
  const askedCode = useRef<string | null>(null)
  const codeAsk = askIdentity(currentAsk)
  useEffect(() => {
    if (!codeAsk || codeAsk === askedCode.current) return
    const first = askedCode.current === null && !!code.trim()
    askedCode.current = codeAsk
    // A lesson picked up again keeps what was being typed for the question it reopens on
    if (first) return
    // A coding lesson whose tutor opened a file for this question (a planted bug): the editor keeps it
    if (!coding || lessonCode.newExercise()) setCode(askStarter(currentAsk?.prompt ?? ''))
    setRunOut(null)
    ranFor.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeAsk])
  const plan = parsed.flatMap((b) => b ?? []).filter((b): b is Extract<Block, { kind: 'plan' }> => b.kind === 'plan').pop()
  const planSteps = useRef<string[] | undefined>(undefined)
  planSteps.current = plan?.steps
  // You doubted a reply: the stronger model checks it against the sources; a correction is added to it
  const [challenged, setChallenged] = useState<Record<number, 'checking' | 'ok' | 'flagged'>>({})
  const [edited, setEdited] = useState(0)
  const challenge = async (at: number) => {
    const reply = turns[at]?.content
    if (!reply) return
    setChallenged((c) => ({ ...c, [at]: 'checking' }))
    try {
      const r = await window.tide.lessons.challenge(topic, 'path' in scope ? scope.path : undefined, reply)
      if (r.offline) {
        app.toast(r.offline)
        setChallenged(({ [at]: _, ...c }) => c)
        return
      }
      if (r.ok) {
        setChallenged((c) => ({ ...c, [at]: 'ok' }))
        app.toast(pack?.sources.length ? 'Checked against the lesson’s sources: nothing wrong found.' : 'Checked: nothing wrong found.')
        return
      }
      const add = correctionText(r)
      setTurns((ts) => ts.map((t, k) => (k === at ? { ...t, content: t.content + add } : t)))
      setEdited((n) => n + 1)
      setChallenged((c) => ({ ...c, [at]: 'flagged' }))
      app.toast(r.errors.length ? 'Something in it was wrong: the correction is under it, and in your notes.' : 'Some details are worth checking: see under it.')
    } catch {
      setChallenged(({ [at]: _, ...c }) => c)
      app.toast('Couldn’t check it just now.', { tone: 'error' })
    }
  }

  // Explanations you added to your notes yourself, word for word
  const [pinned, setPinned] = useState<{ at: number; text: string }[]>([])
  const pinnedAt = useMemo(() => new Set(pinned.map((p) => p.at)), [pinned])
  const pinToNotes = (at: number, blocks: Block[]) => {
    const text = blocks
      .map((b) => (b.kind === 'text' ? b.text : b.kind === 'note' ? b.text : b.kind === 'summary' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (!text) return
    // Kept as the tutor said it: a quoted block in the lesson's part of your note
    setPinned((p) => [...p, { at, text: text.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n') }])
    if (!notesOpen) setNotesOpen(true)
    app.toast('Added to your notes for this lesson')
  }
  // Takeaways the tutor wrote for the lesson's note (from finished replies only), and what you added
  const takeaways = useMemo(
    () => [
      ...parsed.flatMap((blocks, i) => (blocks && !(busy && i === parsed.length - 1) ? blocks.filter((b): b is Extract<Block, { kind: 'note' }> => b.kind === 'note').map((b) => b.text) : [])),
      ...pinned.map((p) => p.text),
      // Saved by Claude's save_to_notes in the lesson itself
      ...turns.flatMap((t) => (t.steps ?? []).filter((x) => x.kind === 'save_note' && x.detail).map((x) => x.detail!)),
      // What the tutor saved in a side thread, and replies you saved there
      ...threads.flatMap((t) => threadNotes(t, threadBusy === t.id))
    ],
    [parsed, busy, pinned, turns, threads, threadBusy]
  )
  const [notesOpen, setNotesOpen] = useState(() => localStorage.getItem('tide.lesson.notes') !== 'closed')
  const withNotes = mode === 'teach' && notesOpen
  // The new design: the plan and what the lesson is checked against sit in a rail on the right
  // (when your notes are not open there), and a question shows how well you hold what it asks about
  const tide = useTideDesign()
  const areaOf = useAreaClass()
  const known = useKnowledge(tide)
  const concept = useMemo(() => (tide ? conceptFor(known, topic, 'path' in scope ? scope.path : undefined) : null), [tide, known, topic, JSON.stringify(scope)])
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('tide.lesson.rail') !== 'closed')
  // Where this is covered in books you own, to read alongside the lesson
  const [toRead, setToRead] = useState<ReadingSuggestion[]>([])
  // Free readings found for the topic (papers, specs, docs), saved PDFs open in Tide
  const [found, setFound] = useState<Reading[]>([])
  useEffect(() => {
    if (mode !== 'teach') return
    window.tide.readings.for(topic, 'path' in scope ? scope.path : undefined).then(setFound).catch(() => {})
  }, [mode, topic, JSON.stringify(scope)])
  useEffect(() => {
    if (mode !== 'teach' || scope.kind === 'pages') return
    window.tide.books.suggest(topic, 2, 'path' in scope ? scope.path : '').then(setToRead).catch(() => {})
  }, [mode, topic, JSON.stringify(scope)])
  const notesMine = useRef('')
  const [sideTab, setSideTab] = useState<'canvas' | 'notes'>('canvas')
  useEffect(() => {
    const flow = options?.flow
    if (!flow?.length || busy) return
    const said = turns.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n')
    const n = stepsReached(flow, said)
    if (n <= drawn.current) return
    drawn.current = n
    window.tide.vault
      .read(canvasPath)
      .then((raw) => window.tide.vault.write(canvasPath, serializeCanvas(drawSteps(parseCanvas(raw), flow, n))))
      .then(() => setCanvasRev((r) => r + 1))
      .catch(() => {})
  }, [turns, busy, options?.flow, canvasPath])

  // Talk: the tutor speaks each reply as it writes it, and you answer by voice (or hands-free)
  const lastTurn = turns[turns.length - 1]
  const voice = useTalk(lastTurn?.role === 'assistant' && turns.length > 1 ? { key: String(turns.length - 1), content: lastTurn.content, streaming: busy } : null, (said) => answerRef2.current(said), heardIn, { box: answerRef, submit: () => submitRef.current() })
  const talk = voice.talk
  talkRef.current = talk
  const stopTalking = voice.stop
  const finished = !busy && turns.length > 1 && !currentAsk && !carryOn && lastBlocks.some((b) => b.kind === 'summary' || b.kind === 'scores')

  // ---------- The lesson map (shared/lessonMap): where the lesson is on its plan ----------
  const map = useMemo(() => lessonMap(turns, parsed, { finished }), [turns, parsed, finished])
  // A lesson taught in problem sets probes first, then plans: the track says so until the plan comes
  const showMap = mode === 'teach' && (map.steps.length > 0 || (!options?.refresh && !options?.course && (!approach || approach === 'problems') && turns.length > 1 && !finished))
  const mapRef = useRef(map)
  mapRef.current = map
  // The next lesson on your roadmap: today's first lesson still to do, other than this one
  const [nextUp, setNextUp] = useState<{ item: AgendaItem; date: string; index: number } | null>(null)
  const planned = map.steps.length > 0
  useEffect(() => {
    if (mode !== 'teach' || !planned) return
    let live = true
    const date = localDate()
    window.tide.coach
      .week(date)
      .then((w) => {
        if (!live) return
        const items = todayItems(w, date)
        const index = items.findIndex((it) => it.kind === 'learn' && !it.done && (it.topic ?? it.title).toLowerCase() !== topic.toLowerCase())
        setNextUp(index >= 0 ? { item: items[index], date, index } : null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [mode, planned, topic, finished])
  // Today's flashcards, counted when the lesson ends
  const [cardsToday, setCardsToday] = useState<number | null>(null)
  useEffect(() => {
    if (!finished || mode !== 'teach') return
    let live = true
    loadDaily()
      .then((items) => live && setCardsToday(items.filter((i) => i.kind === 'card').length))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [finished, mode])
  /**
   * "I've got this, move on", the one way to move on from a question: a request, never an answer
   * (notAnAttempt), and lessonMemory keeps the question for recall when the lesson is saved
   */
  const moveOn = () => {
    if (busy) return
    const m = mapRef.current
    const at = m.phase === 'steps' && m.current < m.steps.length ? m.current : null
    send(moveOnRequest(at === null ? null : at + 1, m.steps.length), turns)
    setAnswer('')
    setPicked(null)
    setAsking(false)
    setConfidence(null)
    setHintLevel(0)
    setHint(false)
  }
  const tutorName = characterById(app.settings.character ?? 'professor').name
  /** The step boundaries drawn before block `j` of turn `i` (`after`: those after its last block) */
  const dividersAt = (i: number, j: number, after = false) =>
    (map.dividers.get(i) ?? [])
      .filter((d: Divider) => (after ? d.block >= (parsed[i]?.length ?? 0) : d.block === j))
      .map((d, k) => <StepDivider key={`d${i}-${j}-${k}`} d={d} total={map.steps.length} fresh={i === turns.length - 1} />)
  // [videos] At the end of a lesson: a short clip on its topic to rewatch, with questions from it, once
  const [recapClip, setRecapClip] = useState<ClipCandidate | null>(null)
  const recapped = turns.some((t) => t.role === 'user' && t.content.startsWith('Recap from the video'))
  useEffect(() => {
    if (!finished || recapped || mode !== 'teach') return setRecapClip(null)
    let live = true
    window.tide.videos
      .clips(topic, { limit: 1, recap: true })
      .then((c) => live && setRecapClip(c[0] ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [finished, recapped, mode, topic])
  // Leaving mid-way keeps the session for later; finishing it lets it go
  const keepRef = useRef({ turns, busy, finished, threads })
  keepRef.current = { turns, busy, finished, threads }
  // Saved to disk as it goes (when you answer, and when each reply is done), so quitting Tide or
  // the Mac shutting down mid-lesson doesn't lose it
  useEffect(() => {
    const k = keepRef.current
    if (!ongoingKey || !view || k.finished || k.turns.length < 2) return
    keepLive({ key: ongoingKey, view, title: `${MODE_LABEL[mode] ?? 'Session'}: ${topic}`, state: { turns: k.turns, activeId: null, threads: k.threads }, busy: k.busy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, busy, finished, ongoingKey, edited, threadsRev])
  // A thread on a finished lesson is kept with it too
  useEffect(() => {
    const k = keepRef.current
    if (threadsRev && k.finished && ongoingKey && view) keepLesson(ongoingKey, view, k.turns, true, k.threads)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsRev])
  useEffect(() => {
    if (!finished || !ongoingKey) return
    // Finished lessons stay in Past lessons, to read again
    if (view) keepLesson(ongoingKey, view, keepRef.current.turns, true, keepRef.current.threads)
    endOngoing(ongoingKey)
  }, [finished, ongoingKey])
  useEffect(
    () => () => {
      const k = keepRef.current
      if (!ongoingKey || !view || k.finished || k.turns.length < 2) return
      saveOngoing({ key: ongoingKey, view, title: `${MODE_LABEL[mode] ?? 'Session'}: ${topic}`, state: { turns: k.turns, activeId: activeId.current, threads: k.threads }, busy: k.busy })
      if (k.busy && activeId.current) followInBackground(ongoingKey, activeId.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ongoingKey]
  )
  // The professor's scene: at the board while he teaches, tea (or chess, in a quiz) on your turn
  const yourTurnScene: ProfessorPose = mode === 'teach' || mode === 'review' ? 'tea' : 'chess'
  const pose: ProfessorPose = busy ? 'board' : cheer ? 'eureka' : finished ? 'happy' : currentAsk ? yourTurnScene : 'idle'
  useStudying('view', finished ? null : { pose: busy ? 'board' : currentAsk ? yourTurnScene : 'board', label: `${MODE_LABEL[mode] ?? 'Session'}: ${topic}` })
  useEffect(() => {
    // A check is ticked off once what it found is saved (below), not just because it ended
    if (finished && !options?.placement) finishAgendaItem(topic)
  }, [finished, topic, options?.placement])

  // A placement check that's finished: what you know is ticked off, what's rusty becomes a refresher
  const placed = useRef(false)
  useEffect(() => {
    const setup = options?.placement
    if (busy || placed.current || !setup) return
    // The result can come in any reply (even one followed by more questions): the latest wins
    const results = [...turns].reverse().filter((t) => t.role === 'assistant').map((t) => parsePlacement(t.content, setup.topics)).find(Boolean)
    if (!results) {
      if (finished) {
        placed.current = true
        app.toast('The check ended without a result, so nothing changed. Run it again from Your week.', { tone: 'error' })
      }
      return
    }
    placed.current = true
    window.tide.curriculum
      .placed(setup, results)
      .then((r) => {
        finishAgendaItem(topic)
        app.toast(`${r.known} known and ticked off, ${r.shaky} to refresh, ${r.fresh} to learn. Your week is updated.`)
      })
      .catch(() => app.toast('Couldn’t save what the check found. Try it again from Your week.', { tone: 'error' }))
  }, [finished, busy, options?.placement, turns, app, topic])

  // When a session on a note ends: schedule the next explain-from-memory, and write session notes
  const wrapped = useRef(false)
  useEffect(() => {
    if (!finished || wrapped.current || !sourcePath) return
    const summary = (lastBlocks.find((b) => b.kind === 'summary') as Extract<Block, { kind: 'summary' }> | undefined)?.text
    if (!summary) return
    wrapped.current = true
    const grades = parsed.flatMap((b) => b ?? []).filter((b): b is Extract<Block, { kind: 'grade' }> => b.kind === 'grade')
    if (mode === 'recall' && grades[0]) {
      const s = grades[0].score
      window.tide.recall.review(sourcePath, s >= 0.9 ? 'easy' : s >= 0.7 ? 'good' : s >= 0.4 ? 'hard' : 'again')
    }
    if (mode === 'teach' || mode === 'quiz' || mode === 'recall') {
      const right = grades.filter((g) => g.verdict === 'correct').length
      const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      const lines = [
        `> [!summary] ${MODE_LABEL[mode]}, ${date}${grades.length ? `: ${right} of ${grades.length} right` : ''}`,
        ...summary.trim().split('\n').map((l) => `> ${l}`),
        ...(savedCards.size ? [`>`, `> Flashcards made: ${savedCards.size}`] : [])
      ]
      window.tide.vault
        .read(sourcePath)
        .then((raw) => window.tide.vault.write(sourcePath, `${raw.trimEnd()}\n\n${lines.join('\n')}\n`))
        .then(() => app.toast(`Session notes saved to ${fileTitle(sourcePath)}`, { action: { label: 'Open', run: () => app.openPath(sourcePath) } }))
        .catch(() => {})
    }
  }, [finished, sourcePath, lastBlocks, parsed, mode, savedCards, app])

  // A company round goes into that company's history: score, verdict, timed or not
  const loggedRound = useRef(false)
  useEffect(() => {
    if (!finished || loggedRound.current || mode !== 'interview' || !options?.company) return
    const scores = lastBlocks.find((b) => b.kind === 'scores') as Extract<Block, { kind: 'scores' }> | undefined
    const last = turns[turns.length - 1]?.content ?? ''
    const score = scores?.rows.length ? scores.rows.reduce((n, r) => n + r.score / r.max, 0) / scores.rows.length : scorecardScore(last)
    if (score === null) return
    loggedRound.current = true
    clock.stop()
    const summary = (lastBlocks.find((b) => b.kind === 'summary') as Extract<Block, { kind: 'summary' }> | undefined)?.text ?? last
    window.tide.practice
      .logInterview({ company: options.company, round: options.round ?? 'coding', score, verdict: parseVerdict(summary), timed: !!timed, minutes: clock.elapsedMinutes(), topic })
      .then(() => app.toast(`Saved to your ${options.company} history: ${Math.round(score * 100)}%`, { action: { label: 'Practice', run: () => app.setView({ kind: 'practice' }) } }))
      .catch(() => {})
  }, [finished, mode, options, lastBlocks, turns, timed, clock, topic, app])

  // An interview on a tracked problem logs its scorecard and schedules the next attempt
  const logged = useRef(false)
  useEffect(() => {
    if (!finished || logged.current || mode !== 'interview' || !options?.problemId) return
    const scores = lastBlocks.find((b) => b.kind === 'scores') as Extract<Block, { kind: 'scores' }> | undefined
    if (!scores) return
    logged.current = true
    const ratio = scores.rows.reduce((n, r) => n + r.score / r.max, 0) / scores.rows.length
    const summary = (lastBlocks.find((b) => b.kind === 'summary') as Extract<Block, { kind: 'summary' }> | undefined)?.text ?? ''
    window.tide.practice.record(options.problemId, ratio, summary).then((p) => {
      if (!p) return
      app.toast(p.status === 'solved' ? `Logged as solved (${Math.round(ratio * 100)}%). It comes back in a while to keep it fresh.` : `Logged as struggled (${Math.round(ratio * 100)}%). It comes back in 2 days.`, {
        action: { label: 'Practice', run: () => app.setView({ kind: 'practice' }) }
      })
    })
  }, [finished, mode, options, lastBlocks, app])

  // Record each graded answer once, for mastery: when its reply is finished, checks and all, and
  // its last mark (a second look's correction, when there is one)
  useEffect(() => {
    parsed.forEach((blocks, i) => {
      const grades = (blocks ?? []).filter((b): b is Extract<Block, { kind: 'grade' }> => b.kind === 'grade')
      grades.slice(-1).forEach((b) => {
        const key = `${i}`
        if (recorded.current.has(key) || ((busy || checking) && i === parsed.length - 1)) return
        recorded.current.add(key)
        // A mark after "Go on" or a question of yours isn't an answer to record
        if (!answered(turns[i - 1]?.content ?? '')) return
        const prevAsk = (parsed[i - 2] ?? []).filter((x) => x.kind === 'ask').pop() as Extract<Block, { kind: 'ask' }> | undefined
        const conf = turns[i - 1]?.content.match(/\(Confidence: (guessing|unsure|sure)\)/i)?.[1]?.toLowerCase()
        window.tide.learn.recordAttempt({
          path: sourcePath,
          topic,
          mode,
          verdict: b.verdict,
          score: b.score,
          confidence: conf === 'sure' ? 3 : conf === 'unsure' ? 2 : conf === 'guessing' ? 1 : undefined,
          question: prevAsk?.prompt.slice(0, 300),
          ...(recordId ? { lesson: recordId } : {})
        })
        if (b.verdict === 'correct') setCheer(Date.now() + 4500)
        // For the break planner: a mark on an answer given here
        if (answeredHere.current && i === parsed.length - 1) breakSignals.marked(b.verdict, topic)
        // Review now: the k-th grade is the k-th kept question, scheduled where it is kept
        const review = options?.review
        if (review?.items.length) {
          const k = gradeIndex.current++
          if (review.items[k]) window.tide.knowledge.reviewAnswer(review.concept, review.items[k], b.verdict).catch(() => {})
          return
        }
        // A retest: the k-th grade is the k-th mistake asked about
        const retest = options?.retest
        if (retest?.length) {
          const k = gradeIndex.current++
          if (retest[k]) window.tide.mistakes.retest(retest[k].id, b.verdict === 'correct').catch(() => {})
          return
        }
        // Anything not right goes in the mistake journal, to come back until it is
        if (b.verdict !== 'correct' && prevAsk?.prompt && (mode === 'teach' || mode === 'quiz')) {
          const said = ownWords(turns[i - 1]?.content ?? '').replace(/^Answer:\s*/, '').replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
          window.tide.mistakes
            .add([{ topic, path: sourcePath ?? (scope.kind === 'folder' ? scope.path : undefined), source: mode === 'teach' ? 'lesson' : 'quiz', question: prevAsk.prompt, answer: said, fix: b.text }])
            .catch(() => {})
        }
      })
    })
  }, [parsed, busy, checking, turns, sourcePath, topic, mode, options, scope, recordId])

  const changeApproach = (to: Strategy, said?: string) => {
    setApproach(to)
    approachRef.current = to
    if (to === 'walkthrough') setNotesOpen(true)
    send(`${said ? `${said}\n\n` : ''}(From here on, teach this way: ${STRATEGY_RULES[to] || 'problem sets, one problem at a time, stepping difficulty up and down as before.'})`, turns)
  }

  const submit = (text?: string, ranNow?: RunResult, mine?: boolean) => {
    if (busy) return
    // A code question with hidden tests is marked on their results: what is handed in is run first
    if (!text && !ranNow && !asking && currentAsk?.type === 'code' && currentAsk.tests && code.trim() && (!runOut || ranFor.current !== code)) {
      if (running) return
      void runMine().then((r) => r && submit(undefined, r))
      return
    }
    const out = asking ? null : (ranNow ?? runOut)
    const ran = out ? `\n\nWhen I ran it:\n\`\`\`\n${(out.stdout + out.stderr).slice(0, 1500) || '(no output)'}\n\`\`\`` : ''
    const choice = currentAsk?.type === 'choice' && currentAsk.options.length > 0
    const pick = choice && picked !== null && currentAsk.options[picked] ? currentAsk.options[picked] : ''
    const typed =
      text ??
      (asking
        ? answer.trim()
        : currentAsk?.type === 'code'
        ? `${answer.trim() ? answer.trim() + '\n\n' : ''}\`\`\`${currentAsk.lang ?? 'python'}\n${code}\n\`\`\`${ran}`
        : pick
          ? `${pick}${answer.trim() ? `\nReasoning: ${answer.trim()}` : ''}`
          : answer.trim())
    // Pictures added to the answer (a photo of their working): they go after the words, and the tutor sees them
    const body = text ? typed : pictures.withPictures(typed.trim() || (pictures.paths.length && !asking && !carryOn ? 'My working is in the picture.' : typed))
    if (!body.trim()) return
    // Asking to be taught another way ("let's just talk it through") changes the approach from here
    const to = !text && approach ? switchFrom(body, approach) : null
    if (to) {
      changeApproach(to, body)
      setAnswer('')
      return
    }
    // "Review my notes" typed during the lesson sends what you wrote in the notes beside it
    if (!text && withNotes && notesMine.current.length >= 20 && wantsNotesReview(body)) {
      send(notesReviewRequest(notesMine.current), turns)
      setAnswer('')
      return
    }
    // A question about the explanation typed as the answer: offer a thread first (mine: "It's my answer")
    if (!text && !mine && !asking && !carryOn && currentAsk && currentAsk.type !== 'code' && !pick && readsAsQuestion(body)) {
      setHint(true)
      return
    }
    setHint(false)
    const conf = confidence ? `\n(Confidence: ${CONFIDENCE.find((c) => c.value === confidence)!.label.toLowerCase()})` : ''
    send(text ? body : asking || carryOn ? `${ASKED}${body}` : `Answer: ${body}${conf}`, turns)
    if (!text) pictures.clear()
    setAnswer('')
    setPicked(null)
    setAsking(false)
    setConfidence(null)
    setHintLevel(0)
    setRunOut(null)
  }

  // Keys: ⌘↵ carries on; 1 to 4 pick an option (when you're not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')
      if (carryOn && !asking && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        send(GO_ON, turns)
      } else if (!typing && currentAsk?.type === 'choice' && /^[1-9]$/.test(e.key) && Number(e.key) <= currentAsk.options.length) {
        setPicked(Number(e.key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [carryOn, asking, currentAsk, turns, send])

  submitRef.current = () => submit()

  // ---------- Threads ----------

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        const tid = threadReqs.current.get(e.id)
        if (!tid) return
        if (e.type === 'delta' || e.type === 'reset')
          setThreads((list) =>
            list.map((t) => {
              const last = t.messages[t.messages.length - 1]
              if (t.id !== tid || last?.role !== 'assistant') return t
              return { ...t, messages: [...t.messages.slice(0, -1), { ...last, content: e.type === 'delta' ? last.content + e.text : '' }] }
            })
          )
        // Claude saved a point with save_to_notes: it goes into the reply, shown as added to your notes
        if (e.type === 'step' && e.step.kind === 'save_note') {
          if (e.step.detail) {
            const note = e.step.detail
            setThreads((list) =>
              list.map((t) => {
                const last = t.messages[t.messages.length - 1]
                if (t.id !== tid || last?.role !== 'assistant') return t
                return { ...t, messages: [...t.messages.slice(0, -1), { ...last, content: withNote(last.content, note) }] }
              })
            )
            threadSaved()
          }
        } else if (e.type === 'step')
          setThreadSteps((all) => {
            const steps = [...(all[tid] ?? [])]
            const at = steps.findIndex((x) => x.id === e.step.id)
            if (at >= 0) steps[at] = { ...steps[at], ...e.step }
            else steps.push(e.step)
            return { ...all, [tid]: steps }
          })
        if (e.type === 'error') setThreadError((all) => ({ ...all, [tid]: e.message }))
        if (e.type === 'done' || e.type === 'error') {
          threadReqs.current.delete(e.id)
          setThreadBusy((b) => (b === tid ? null : b))
          setThreads((list) =>
            list.map((t) => {
              if (t.id !== tid) return t
              // Asked to save and the reply saved nothing: what they meant is saved for them
              const msgs = t.messages
              const last = msgs[msgs.length - 1]
              const q = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? ''
              const noted = last?.role === 'assistant' && replyParts(last.content).notes.length > 0
              if (noted) setTimeout(threadSaved)
              if (e.type === 'done' && last?.role === 'assistant' && last.content.trim() && wantsSave(q) && !noted) {
                const point = saveFallback(t, turnsRef.current[t.at]?.content)
                if (point) {
                  setTimeout(threadSaved)
                  return { ...t, messages: [...msgs.slice(0, -1), { ...last, content: withNote(last.content, point) }], updated: Date.now() }
                }
              }
              return { ...t, updated: Date.now() }
            })
          )
          setThreadsRev((r) => r + 1)
          // Folded while it was answering: its process can go now
          if (openThreadRef.current !== tid) window.tide.ai.threadDone(labId.current).catch(() => {})
        }
      }),
    []
  )

  /** Sends a thread whose last message is your question */
  const requestThread = (thread: LessonThread) => {
    const id = `thread:${uid()}`
    threadReqs.current.set(id, thread.id)
    setThreadBusy(thread.id)
    setThreadError(({ [thread.id]: _e, ...rest }) => rest)
    setThreadSteps(({ [thread.id]: _s, ...rest }) => rest)
    // The lesson's context, the exact output and the thread so far; never the lesson's own conversation.
    // Not a session turn: nothing in it is marked, and on Claude it runs in the thread's own process
    window.tide.ai
      .chat({
        id,
        messages: threadMessages({ topic: setupRef.current.topic, plan: planSteps.current, turns: turnsRef.current }, thread),
        scope,
        instructions: THREAD_RULES,
        labId: labId.current,
        topic: setupRef.current.topic,
        web,
        ...engineFields(engineRef.current),
        thread: thread.id
      })
      .catch((err: Error) => {
        threadReqs.current.delete(id)
        setThreadBusy(null)
        setThreadError((all) => ({ ...all, [thread.id]: err.message }))
      })
  }

  const askInThread = (tid: string, q: string, base?: LessonThread) => {
    const t = base ?? threadsRef.current.find((x) => x.id === tid)
    if (!t || threadBusy === tid) return
    // A reply that failed is dropped before asking again
    const kept = t.messages.filter((m, i) => !(m.role === 'assistant' && !m.content.trim() && i === t.messages.length - 1))
    const next: LessonThread = { ...t, messages: [...kept, { role: 'user', content: q }], updated: Date.now() }
    setThreads((list) => {
      const shown = { ...next, messages: [...next.messages, { role: 'assistant' as const, content: '' }] }
      return list.some((x) => x.id === tid) ? list.map((x) => (x.id === tid ? shown : x)) : [...list, shown]
    })
    requestThread(next)
  }

  const retryThread = (tid: string) => {
    const t = threadsRef.current.find((x) => x.id === tid)
    if (!t) return
    const kept = t.messages[t.messages.length - 1]?.role === 'assistant' ? t.messages.slice(0, -1) : t.messages
    if (kept[kept.length - 1]?.role !== 'user') return
    setThreads((list) => list.map((x) => (x.id === tid ? { ...x, messages: [...kept, { role: 'assistant', content: '' }] } : x)))
    requestThread({ ...t, messages: kept })
  }

  const foldThread = (understood: boolean, quiet = false) => {
    const id = openThreadRef.current
    if (!id) return
    setOpenThread(null)
    openThreadRef.current = null
    // A thread opened and left without a question isn't kept
    setThreads((list) => list.flatMap((t) => (t.id !== id ? [t] : asked(t) ? [{ ...t, understood: t.understood || understood, updated: Date.now() }] : [])))
    setThreadsRev((r) => r + 1)
    if (threadBusy !== id) window.tide.ai.threadDone(labId.current).catch(() => {})
    if (quiet) return
    // Back to where the lesson is: its question, flashed, and the answer box ready
    setTimeout(() => {
      const col = columnRef.current
      if (!col) return
      const asks = col.querySelectorAll<HTMLElement>('.s-ask')
      const target = (currentAskRef.current ? asks[asks.length - 1] : null) ?? col.querySelector<HTMLElement>('.s-answer, .s-goon')
      if (!target) return
      reveal(target, { block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      target.classList.add('lt-flash')
      setTimeout(() => target.classList.remove('lt-flash'), 900)
      answerRef.current?.focus({ preventScroll: true })
    }, reducedMotion() ? 0 : 260)
  }

  /** Opens a thread under the output at turn `at`: the one already there, or a new one */
  const openThreadAt = (at: number, quote?: string, first?: string, id?: string) => {
    const mine = threadsRef.current.filter((t) => t.at === at)
    const had = id ? mine.find((t) => t.id === id) : quote ? mine.filter((t) => t.quote === quote).pop() : mine.pop()
    if (openThreadRef.current && openThreadRef.current !== had?.id) foldThread(false, true)
    const t = had ?? newThread(turnsRef.current, at, quote, currentAskRef.current?.prompt)
    if (!had) setThreads((list) => [...list, t])
    setOpenThread(t.id)
    openThreadRef.current = t.id
    if (first) askInThread(t.id, first, t)
    setTimeout(() => revealThread(t.id), 120)
  }

  /** Brings the open thread into view above the answer box, which stays at the bottom of the lesson over it */
  const revealThread = (id: string, behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth') => {
    const slot = columnRef.current?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)
    const box = slot?.closest<HTMLElement>('.session-scroll')
    if (!slot || !box) return
    const view = box.getBoundingClientRect()
    // Where its bottom will be once it has unfolded, and where it must end: above the floating Back pill
    const top = slot.getBoundingClientRect().top
    const bottom = top + (slot.querySelector<HTMLElement>('.lt-thread')?.scrollHeight ?? slot.scrollHeight)
    const limit = view.bottom - 72
    // Above the view (reopened from further down): its top comes into view; below: its bottom does, without losing its top
    const by = top < view.top + 24 ? top - view.top - 24 : Math.min(bottom - limit, top - view.top - 24)
    if (Math.abs(by) > 4) box.scrollBy({ top: by, behavior })
  }
  // A reply growing in the open thread keeps it in view
  const openGrowth = threads.find((t) => t.id === openThread)
  const openSize = openGrowth ? openGrowth.messages.length * 100000 + (openGrowth.messages.at(-1)?.content.length ?? 0) : 0
  useEffect(() => {
    if (openGrowth) revealThread(openGrowth.id, 'auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(openSize / 400)])

  // ---------- Explore later (shared/explore) ----------

  /** Keeps a selection, a tutor's message or a thread reply to explore later, linked to where it came up */
  const keepToExplore = (at: SelectionAt) => {
    const th = at.thread ? threadsRef.current.find((t) => t.id === at.thread) : undefined
    void exploreLater(app, {
      text: at.quote,
      subject: lessonSubject(topic, scope, options?.subject),
      from: { ...(recordId ? { lesson: recordId } : {}), topic, mode, turn: th ? th.at : at.turn, ...(at.thread ? { thread: at.thread, reply: at.reply } : {}) },
      scope
    })
  }

  // Opened at a message ("Open where it came up"): brought into view and flashed, its thread reopened
  const focused = useRef(false)
  const focus = view?.kind === 'session' ? view.focus : undefined
  useEffect(() => {
    if (!focus || focused.current || turns.length <= focus.turn) return
    focused.current = true
    const t = setTimeout(() => {
      const flash = (el: HTMLElement | null | undefined) => {
        if (!el) return
        el.classList.add('xp-flash')
        setTimeout(() => el.classList.remove('xp-flash'), 2400)
      }
      // In a thread: the thread opens under its message, and the reply it came up in glows
      if (focus.thread && threadsRef.current.some((x) => x.id === focus.thread)) {
        openThreadAt(focus.turn, undefined, undefined, focus.thread)
        setTimeout(() => {
          const reply = columnRef.current?.querySelector<HTMLElement>(`[data-thread-id="${focus.thread}"] [data-thread-reply="${focus.reply ?? -1}"]`)
          reply?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
          flash(reply?.closest<HTMLElement>('.lt-msg'))
        }, reducedMotion() ? 50 : 600)
        return
      }
      const el = columnRef.current?.querySelector<HTMLElement>(`[data-turn="${focus.turn}"]`)
      if (el) reveal(el, { block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      flash(el)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length])

  /** Something from a thread went into the notes: the notes pane opens, so it's written there now */
  const threadSaved = () => {
    if (mode === 'teach') setNotesOpen(true)
  }

  /** "Save to notes" on one thread reply */
  const saveReply = (tid: string, at: number) => {
    setThreads((list) => list.map((x) => (x.id === tid && !x.saved?.includes(at) ? { ...x, saved: [...(x.saved ?? []), at] } : x)))
    setThreadsRev((r) => r + 1)
    threadSaved()
    app.toast('Added to your notes for this lesson')
  }


  // Esc folds the open thread, from anywhere but another box you're typing in
  useEffect(() => {
    if (!openThread) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') && !t.closest('.lt-thread')) return
      e.preventDefault()
      foldThread(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // The phrase a thread is about stays highlighted in its output while it's open
  const openQuote = threads.find((t) => t.id === openThread)
  useEffect(() => {
    if (!openQuote?.quote) return
    return highlightQuote(columnRef.current?.querySelector(`[data-thread-out="${openQuote.at}"]`) ?? null, openQuote.quote)
  }, [openQuote?.id, openQuote?.quote, openQuote?.at, turns.length])


  // Ask about this, pressed on a part of a live simulation: in a lesson it goes straight to the
  // tutor as your question, saying which part and what it showed
  const askAboutRef = useRef<(label: string) => void>(() => {})
  askAboutRef.current = (label) => submit(`${ASKED}In the simulation, explain ${label}: what it is doing here, and why it has that value.`)
  const askVisualRef = useRef<(question: string) => void>(() => {})
  askVisualRef.current = (question) => submit(`${ASKED}${question}`)
  useEffect(() => {
    const onAsk = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label
      if (!label) return
      e.preventDefault()
      e.stopImmediatePropagation()
      askAboutRef.current(label)
    }
    // Claude's visuals: "What's happening here?" and "Ask about this" go straight to the tutor, with what the visual shows
    const onAskVisual = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question
      if (!question || !columnRef.current?.contains(e.target as Node)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      askVisualRef.current(question)
    }
    document.addEventListener('tide:ask-about', onAsk, true)
    document.addEventListener(ASK_VISUAL_EVENT, onAskVisual, true)
    return () => {
      document.removeEventListener('tide:ask-about', onAsk, true)
      document.removeEventListener(ASK_VISUAL_EVENT, onAskVisual, true)
    }
  }, [])
  const runMine = async (): Promise<RunResult | null> => {
    if (!currentAsk || running) return null
    setRunning(true)
    try {
      // Its hidden tests run with it; SQL runs in this lesson's data lab
      const r = await window.tide.runner.run(currentAsk.lang ?? options?.language ?? 'python', code, '', { tests: currentAsk.tests, labId: labId.current })
      ranFor.current = code
      setRunOut(r)
      return r
    } finally {
      setRunning(false)
    }
  }

  const askHint = () => {
    send(`[hint] (${HINT_LEVELS[Math.min(hintLevel, 3)].toLowerCase()} please)`, turns)
    setHintLevel((h) => Math.min(h + 1, 3))
  }

  const saveCard = async (front: string, back: string) => {
    const target = sourcePath ?? `Flashcards/${topic.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)}.md`
    await window.tide.study.saveCards(target, cardsToMarkdown([{ front, back }]))
    setSavedCards((s) => new Set(s).add(front))
    await app.refreshTree()
  }

  // [S2] in what the tutor wrote: the source's name, a button that opens it (shared/sources)
  const cited = (md: string) => citeSources(md, pack?.sources ?? [])
  /** `at`: the turn it's in, for the lesson map. `fromMiss`: the reply's mark was not "correct", so a flashcard in it is from a miss */
  const renderBlock = (b: Block, key: string, live: boolean, at = -1, fromMiss = true) => {
    switch (b.kind) {
      case 'text':
        return <div key={key} className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(cited(b.text), env) }} />
      case 'ask': {
        // The lesson map: what this question checks and what getting it right does, and on the
        // question waiting for you, the one way to move on (a request: never marked, kept for recall)
        const purpose = showMap ? map.purposes.get(at) : undefined
        const head = purpose ? <AskPurpose p={purpose} title={map.steps[purpose.step]?.title} /> : null
        const skip = mode === 'teach' && !timed && !live && !busy && at === turns.length - 1 && !!currentAsk && map.phase !== 'recap' && map.phase !== 'finished' ? <MoveOnChip onMove={moveOn} /> : null
        // A question you missed before says so (a retest); nothing on every other question, where
        // "Holding: last right today" was only noise
        if (tide && concept && concept.seen > 0 && options?.retest?.length)
          return (
            <div key={key} className="s-ask td-recall">
              <Level now={concept.estimate} high={concept.level} area={areaOf(concept.area)} large />
              <div>
                <p className="td-recall-lab fading">You missed this before</p>
                <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(cited(b.prompt), env) }} />
                {skip}
              </div>
            </div>
          )
        return (
          <div key={key} className={`s-ask${head ? ' lm-has-purpose' : ''}`}>
            {head}
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(cited(b.prompt), env) }} />
            {skip}
          </div>
        )
      }
      case 'grade':
        return (
          <div key={key} className={`s-grade v-${b.verdict}`}>
            <span className="s-grade-badge">
              <Icon name={b.verdict === 'correct' ? 'check' : b.verdict === 'wrong' ? 'x' : 'minus'} size={13} />
              {b.verdict === 'correct' ? 'Correct' : b.verdict === 'wrong' ? 'Not quite' : 'Partly right'}
            </span>
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(cited(b.text), env) }} />
          </div>
        )
      case 'card':
        return (
          <div key={key} className="s-card">
            <div className="s-card-text">
              <span className="muted small">{fromMiss ? 'Flashcard from this miss' : 'Flashcard'}</span>
              <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(`**${b.front}**\n\n${b.back}`, env) }} />
            </div>
            <button className="btn small" disabled={savedCards.has(b.front)} onClick={() => saveCard(b.front, b.back)}>
              {savedCards.has(b.front) ? (
                <>
                  <Icon name="check" size={13} /> Saved
                </>
              ) : (
                'Add to flashcards'
              )}
            </button>
          </div>
        )
      case 'plan':
      case 'progress':
        return null
      case 'clip':
        return live ? null : <ClipCard key={key} clip={b} />
      case 'scores':
        return (
          <div key={key} className="s-scores">
            <h3>{b.title === 'scorecard' ? 'Scorecard' : 'Rubric'}</h3>
            {b.rows.map((r) => (
              <div key={r.label} className="s-score-row">
                <span className="s-score-label">{r.label}</span>
                <span className="s-score-bar">
                  <span style={{ width: `${(r.score / r.max) * 100}%` }} className={r.score / r.max >= 0.75 ? 'hi' : r.score / r.max >= 0.5 ? 'mid' : 'lo'} />
                </span>
                <span className="s-score-num">
                  {r.score}/{r.max}
                </span>
                {r.note && <span className="s-score-note">{r.note}</span>}
              </div>
            ))}
          </div>
        )
      case 'challenge':
        return (
          <div key={key} className="s-challenge">
            {b.quote && <blockquote>{b.quote}</blockquote>}
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
            {!live && (
              <button className="link-btn small" onClick={() => setAnswer(`About “${b.quote}”: `)}>
                Answer this
              </button>
            )}
          </div>
        )
      // humanities: a reading appraised against the rubric
      case 'appraise':
        return <AppraiseCard key={key} rows={b.rows} text={b.text} render={(t) => renderMarkdown(t, env)} />
      case 'summary':
        return (
          <div key={key} className="s-summary">
            <h3>Summary</h3>
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
          </div>
        )
      case 'note':
        // Shown where it was taught, and written into the lesson's note
        return (
          <div key={key} className="s-takeaway">
            <span className="s-takeaway-label">
              <Icon name="note" size={12} />
              {mode === 'teach' ? 'Added to your notes' : 'Key idea'}
            </span>
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
          </div>
        )
    }
  }

  // The step the lesson is on, from the lesson map
  const planDone = map.phase === 'steps' ? map.current : map.steps.length
  // For the break planner: a step passed, or the lesson done, is a natural moment to rest
  const stepsSeen = useRef<number | null>(null)
  useEffect(() => {
    if (stepsSeen.current !== null && planDone > stepsSeen.current && plan) breakSignals.boundary('step', `step ${planDone}`)
    stepsSeen.current = planDone
  }, [planDone, plan])
  useEffect(() => {
    if (finished && answeredHere.current) breakSignals.boundary('lesson-end', 'the lesson')
  }, [finished])
  // ...and the break screen says where the lesson stopped, and asks one question from it on the way back
  const breakLive = useRef({ plan, planDone, currentAsk, parsed })
  breakLive.current = { plan, planDone, currentAsk, parsed }
  useEffect(() => {
    const short = (s: string) => {
      const flat = s.replace(/[*_`$#>]/g, '').replace(/\s+/g, ' ').trim()
      return flat.length > 64 ? `${flat.slice(0, 63).replace(/\s+\S*$/, '')}…` : flat
    }
    lessonForBreaks({
      where: () => {
        const l = breakLive.current
        const step = l.plan && l.planDone < l.plan.steps.length ? `step ${l.planDone + 1}` : ''
        const ask = l.currentAsk?.prompt ? `“${short(l.currentAsk.prompt)}”` : ''
        return [step, ask].filter(Boolean).join(', ') || topic
      },
      recall: () => {
        const l = breakLive.current
        const asks = l.parsed.flatMap((b) => b ?? []).filter((b): b is Extract<Block, { kind: 'ask' }> => b.kind === 'ask' && !!b.prompt && b.prompt !== l.currentAsk?.prompt && b.prompt.length < 220)
        const fit = asks.filter((a) => a.prompt.length <= 160)
        // An earlier question from this lesson; with none yet, the one it stopped on
        const pick = fit[Math.max(0, fit.length - 3)] ?? (l.currentAsk?.prompt && l.currentAsk.prompt.length <= 220 ? l.currentAsk : undefined)
        return pick ? pick.prompt.replace(/[*_`$#>]/g, '').replace(/\s+/g, ' ').trim() : null
      }
    })
    return () => lessonForBreaks(null)
  }, [topic])

  const scopeLabel = scope.kind === 'note' ? fileTitle(scope.path) : scope.kind === 'pages' ? pagesLabel(scope) : scope.kind === 'folder' ? scope.path.split('/').pop() : null

  const difficultyLine = difficulty.line(turns, planDone < map.steps.length ? map.steps[planDone].title : undefined)
  // The rail of the new design: only when there is something to put in it
  const checks = Object.values(challenged)
  const hasSources = toRead.length > 0 || found.length > 0 || !!pack?.sources.length || checks.length > 0
  // (the plan itself is on the lesson map's track; the rail keeps the level and the sources)
  const rail = tide && !withNotes && railOpen && (!!difficultyLine || hasSources)
  const moreFound = found.filter((r) => !pack?.sources.some((x) => x.url === r.url)).slice(0, 4)

  return (
    <div className="doc-view session">
      <header className="doc-toolbar drag session-toolbar">
        <div className="crumbs no-drag">
          <span className="session-prof" title={busy ? 'Teaching' : currentAsk ? 'Your turn' : ''}>
            <Professor state={pose} size={20} />
          </span>
          <span className="crumb">{MODE_LABEL[mode]}</span>
          <Icon name="chevron" size={11} />
          <span className="crumb current">{topic}</span>
          {scopeLabel && scopeLabel !== topic && (
            <span className="muted page-count">
              {tide && 'path' in scope && <AreaMark area={scope.path} size={14} />}
              from {scopeLabel}
            </span>
          )}
        </div>
        <div className="toolbar-actions no-drag">
          {timed && <InterviewClock remaining={clock.remaining} total={timed} />}
          <EnginePill value={engine} onChange={setEngine} />
          <TimeThis
            context={
              options?.problemId
                ? { label: topic.replace(/\s*\(https?:[^)]*\)\s*$/, ''), path: `practice:${options.problemId}`, kind: 'problem' }
                : sourcePath
                  ? { label: fileTitle(sourcePath).replace(/\.pdf$/i, ''), path: sourcePath, kind: 'session' }
                  : { label: topic, path: `session:${topic.toLowerCase()}`, kind: 'session' }
            }
          />
          <button
            className={`chip-toggle${web ? ' on' : ''}`}
            aria-pressed={web}
            onClick={() =>
              setWeb((v) => {
                localStorage.setItem('tide.chat.web', v ? 'off' : 'on')
                return !v
              })
            }
            title={web ? 'The tutor may look things up online. Click to turn off.' : 'The tutor only uses your notes. Click to let it look things up online.'}
          >
            <Icon name="globe" size={13} />
            <span>{web ? 'Web on' : 'Web off'}</span>
          </button>
          {!inFocusWindow && (
            <button
              className="tool-btn"
              disabled={busy}
              onClick={() => {
                window.tide.windows.openFocus({ kind: 'session', mode, scope, topic, options, turns: turns.map((t) => ({ role: t.role, content: t.content })), threads, nonce: Date.now() })
                app.back()
              }}
              title="Carry on in a window of its own, with nothing else on screen"
            >
              <Icon name="width" />
              <span>Own window</span>
            </button>
          )}
          <button
            className={`tool-btn keep-label${talk ? ' on' : ''}`}
            aria-pressed={talk}
            onClick={voice.toggle}
            title={talk ? 'Talking: the tutor speaks and you answer by voice. Click to stop.' : 'Talk it through: the tutor speaks its replies and you answer by speaking'}
          >
            <Icon name="speaker" />
            <span>Talk</span>
          </button>
          {talk && (
            <button className={`tool-btn keep-label hands-free is-${voice.hearing}${voice.handsFree ? ' on' : ''}`} aria-pressed={voice.handsFree} onClick={voice.toggleHandsFree} title={voice.flow ? 'Hands-free with Wispr Flow: speak with Flow; what it types is sent when it finishes. Space or Esc interrupts the tutor.' : 'Hands-free: just talk; Tide hears when you stop. Space or Esc interrupts the tutor.'}>
              <span className="hear-dot" aria-hidden="true" />
              <span>{voice.handsFree ? (voice.speaking ? 'Speaking… (Esc)' : voice.flow ? 'Flow: sends when done' : voice.hearing === 'speech' ? 'Hearing you…' : voice.hearing === 'writing' ? 'Writing it down…' : 'Listening') : 'Hands-free'}</span>
            </button>
          )}
          {mode === 'teach' && (
            <button
              className={`tool-btn${notesOpen ? ' on' : ''}`}
              onClick={() =>
                setNotesOpen((o) => {
                  localStorage.setItem('tide.lesson.notes', o ? 'closed' : 'open')
                  return !o
                })
              }
              title="Your notes for this lesson"
            >
              <Icon name="note" />
              <span>Notes</span>
            </button>
          )}
          {/* [source-led] */}
          {mode === 'teach' && (
            <button
              className={`tool-btn led-toggle${led ? ' on' : ''}`}
              aria-pressed={led}
              onClick={() =>
                setLed((on) => {
                  localStorage.setItem(ledPrefKey(scope), on ? 'off' : 'on')
                  return !on
                })
              }
              title={led ? 'Teaching from sources: each step opens with a reading from your books, official documentation or a free text, when a good one is found. Click to let the tutor explain instead.' : 'The tutor is explaining from its own knowledge. Click to teach from sources.'}
            >
              <Icon name="book" />
              <span>{led ? 'Teach from sources' : 'Let the tutor explain'}</span>
            </button>
          )}
          {coding && (
            <button className="tool-btn" onClick={() => void openInIde()} title="Open this lesson’s files in the Code view, with Claude beside them">
              <Icon name="files" />
              <span>Open in the IDE</span>
            </button>
          )}
          {mode === 'teach' && (
            <button className={`tool-btn${why ? ' on' : ''}`} aria-pressed={why} onClick={toggleWhy} title={why ? 'Why mode: teaching the reasons behind each idea, Socratically. Click for plain explanations.' : 'Why mode: have the tutor lead you to why each idea is so, from first principles'}>
              <Icon name="sparkle" />
              <span>Why</span>
            </button>
          )}
          {mode === 'teach' && approach && (
            <label className="tool-btn approach-pick" title="How the tutor is teaching this; change it any time">
              <select value={approach} onChange={(e) => changeApproach(e.target.value as Strategy)} disabled={busy} aria-label="How to teach this">
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tide && (
            <button
              className="icon-btn td-aa"
              aria-pressed={app.settings.tideReadingFont === 'sans'}
              onClick={() => app.updateSettings({ tideReadingFont: app.settings.tideReadingFont === 'sans' ? 'serif' : 'sans' })}
              title={app.settings.tideReadingFont === 'sans' ? 'Reading in the sans. Click for the serif.' : 'Reading in the serif. Click for the sans.'}
              aria-label="Switch the reading face"
            >
              Aa
            </button>
          )}
          {tide && !withNotes && (
            <button
              className="icon-btn"
              aria-pressed={railOpen}
              onClick={() =>
                setRailOpen((o) => {
                  localStorage.setItem('tide.lesson.rail', o ? 'closed' : 'open')
                  return !o
                })
              }
              title={railOpen ? 'Hide the level and sources' : 'Show the level and what this is checked against'}
              aria-label="The level and sources"
            >
              <Icon name="panel" />
            </button>
          )}
          <button
            className="tool-btn keep-label"
            disabled={busy && shouldSumUp(turns, finished)}
            // Ending a session that has answers in it closes it properly: the summary, kept in Past
            // lessons, what was missed due for recall. Pressed again (or with nothing answered), it leaves
            onClick={() => (!busy && shouldSumUp(turns, finished) ? send(END_NOW, turns) : app.back())}
            title={shouldSumUp(turns, finished) ? 'End: the tutor sums up what you learned and what to review. To pause instead, just go elsewhere: it waits under Carry on.' : 'Leave this session'}
          >
            <Icon name="x" />
            <span>End</span>
          </button>
        </div>
      </header>

      <div className={`${withNotes ? 'session-split' : 'session-solo'}${rail ? ' td-with-rail' : ''}`}>
      <div className="lm-col">
      {showMap && <LessonTrack map={map} tutor={tutorName} nextLesson={nextUp ? (nextUp.item.topic ?? nextUp.item.title) : null} />}
      <div className="doc-scroll session-scroll">
        <div
          className="session-column"
          ref={columnRef}
          data-lab={labId.current}
          // Claude's visuals (lib/visuals): where they may run, and the lesson that keeps them
          data-visual-scope={JSON.stringify(scope)}
          data-visual-lesson={recordId ?? ''}
          // [source-led] a reading's "Open in your library at page N"
          onClick={(e) => {
            const cite = (e.target as HTMLElement).closest?.<HTMLElement>('.s-cite')
            const src = cite ? pack?.sources.find((s) => s.n === Number(cite.dataset.source)) : undefined
            if (src) {
              e.preventDefault()
              if (src.path) app.openPath(src.path)
              else if (src.url) void window.tide.app.openExternal(src.url)
              return
            }
            const open = openReading(e.target)
            if (open) (e.preventDefault(), app.openPath(open.path, open.anchor))
            // Run and Copy on the code in a reading or a reply (lib/runBlocks)
            else void codeBlockClick(e.target)
          }}
        >
          {tide && (
            <header className="td-lesson-head">
              <h1>{topic}</h1>
              <p>
                <span>{MODE_LABEL[mode]}</span>
                {scopeLabel && scopeLabel !== topic && (
                  <span className="td-area">
                    {'path' in scope && <AreaMark area={scope.path} size={14} />}
                    From {scopeLabel}
                  </span>
                )}
                {concept && concept.seen > 0 && (
                  <span className="td-lesson-held">
                    <Level now={concept.estimate} high={concept.level} area={areaOf(concept.area)} />
                    {concept.status === 'fading' ? `Fading: ${Math.round(concept.estimate * 100)}% now, it stood at ${Math.round(concept.level * 100)}%` : `You hold this at ${Math.round(concept.estimate * 100)}%`}
                  </span>
                )}
              </p>
            </header>
          )}
          {options?.curiosity && <CameUpIn curiosity={options.curiosity} />}
          {!rail && (toRead.length > 0 || found.length > 0 || !!pack?.sources.length) && (
            <div className="s-read" aria-label="Read alongside">
              <Icon name="book" size={13} />
              <span className="muted">Read</span>
              {toRead.map((r) => (
                <button key={`${r.path}:${r.from}`} className="s-read-link" onClick={() => app.openPath(r.path, `page=${r.from}`)} title={r.about ?? readingLabel(r)}>
                  {readingLabel(r)}
                </button>
              ))}
              {pack?.sources.map((s) => (
                <button key={`s${s.n}`} className="s-read-link" onClick={() => (s.path ? app.openPath(s.path) : s.url && window.tide.app.openExternal(s.url))} title={`What this lesson is taught from: ${s.title}`}>
                  <strong>S{s.n}</strong> {s.title}
                  {!s.path && s.url && <Icon name="external" size={11} />}
                </button>
              ))}
              {found.filter((r) => !pack?.sources.some((s) => s.url === r.url)).slice(0, 4).map((r) => (
                <button key={`${r.url}#${r.title}`} className="s-read-link" onClick={() => (r.path ? app.openPath(r.path) : window.tide.app.openExternal(r.url))} title={[r.by, r.why].filter(Boolean).join(': ') || r.title}>
                  {r.title}
                  {!r.path && <Icon name="external" size={11} />}
                </button>
              ))}
            </div>
          )}
          {warm && (
            <WarmUp
              set={warm}
              onDone={(results, skipped) => {
                warmDone.current?.(warmupNote(warm, results, skipped))
                warmDone.current = null
              }}
            />
          )}

          {turns.map((t, i) => {
            if (i === 0 && t.role === 'user') {
              // [videos] the section offered before the first reply
              const first = /Tide offers the student a section/.test(t.content) ? offeredClip(t.content) : null
              return first ? <ClipCard key={i} clip={first} kicker="Watch first" /> : null
            }
            if (t.role === 'user') {
              if (isMoveOn(t.content))
                return (
                  <div key={i} className="s-you hint">
                    <span className="muted small">You said you've got this and moved on</span>
                  </div>
                )
              const isHint = t.content.startsWith('[hint]')
              const own = ownWords(t.content)
              const text = own.replace(/^Answer: /, '').replace(/^My question: /, '').replace(/\n\(Confidence: \w+\)$/, '')
              const conf = own.match(/\(Confidence: (\w+)\)$/)?.[1]
              const bubble = (
                <div key={isHint ? i : undefined} className={`s-you${isHint ? ' hint' : ''}`}>
                  {isHint ? (
                    <span className="muted small">You asked for a {t.content.match(/\((.+) please\)/)?.[1] ?? 'hint'}</span>
                  ) : (
                    <>
                      <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, env) }} />
                      {conf && <span className="s-conf-tag">{conf}</span>}
                      {(() => {
                        const recap = text.startsWith('Recap from the video') ? offeredClip(t.content) : null
                        return recap ? <ClipCard clip={recap} kicker="Recap" /> : null
                      })()}
                    </>
                  )}
                </div>
              )
              return isHint ? bubble : <YouBeside key={i}>{bubble}</YouBeside>
            }
            const blocks = parsed[i] ?? []
            const live = busy && i === turns.length - 1
            const hung = threads.filter((th) => th.at === i)
            const threaded = hung.some((th) => th.id === openThread)
            // Ask about any finished output, in a thread under it (not in an interview)
            const askable = !live && !!t.content.trim() && mode !== 'interview'
            return (
              <Fragment key={i}>
              {showMap && dividersAt(i, 0)}
              <div className="s-tutor" data-turn={i}>
                {tide && (
                  <div className="td-who">
                    <Professor state={live ? 'writing' : 'idle'} size={24} />
                    <b>{characterById(app.settings.character ?? 'professor').name}</b>
                  </div>
                )}
                {!live && t.content && (
                  <div className="s-tutor-tools">
                    <SpeakButton text={blocks.filter((b) => b.kind === 'text' || b.kind === 'ask' || b.kind === 'grade').map((b) => ('text' in b ? b.text : 'prompt' in b ? b.prompt : '')).join('. ')} />
                    {(mode === 'teach' || mode === 'quiz') && (
                      <button className={`icon-btn small${challenged[i] === 'ok' ? ' on' : ''}`} title={challenged[i] === 'checking' ? 'Checking…' : challenged[i] === 'ok' ? 'Checked: nothing wrong found' : 'Doubt this? Have the stronger model check it against the sources'} aria-label="Check this" disabled={!!challenged[i] || busy || (checking && i === turns.length - 1)} onClick={() => challenge(i)}>
                        {challenged[i] === 'checking' ? <span className="spinner" /> : <Icon name={challenged[i] === 'ok' ? 'check' : 'search'} size={13} />}
                      </button>
                    )}
                    {mode === 'teach' && i === turns.length - 1 && showMeOffered(turns) && (
                      <button className="icon-btn small" title="Show me: see this as a diagram, a trace or a plot" aria-label="Show me this as a picture" disabled={busy} onClick={() => submit(SHOW_ME)}>
                        <Icon name="image" size={13} />
                      </button>
                    )}
                    {mode !== 'interview' && (
                      <button className="icon-btn small" title="Explore later: keep this for a short side lesson" aria-label="Explore later" onClick={() => keepToExplore({ turn: i, quote: outputText(t.content) })}>
                        <Icon name="compass" size={13} />
                      </button>
                    )}
                    {mode === 'teach' && (
                      <button
                        className={`icon-btn small${pinnedAt.has(i) ? ' on' : ''}`}
                        title={pinnedAt.has(i) ? 'In your notes' : 'Add this explanation to your notes, as it is'}
                        aria-label="Add to notes"
                        disabled={pinnedAt.has(i)}
                        onClick={() => pinToNotes(i, blocks)}
                      >
                        <Icon name={pinnedAt.has(i) ? 'check' : 'note'} size={13} />
                      </button>
                    )}
                  </div>
                )}
                {!!t.steps?.some((s) => s.kind !== 'progress') && (
                  <ul className="work-log">
                    {t.steps!.filter((s) => s.kind !== 'progress').map((s) => (
                      <li key={s.id} className={`step ${s.status}${s.depth ? ' nested' : ''}`}>
                        {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.kind === 'web_search' ? 'globe' : s.kind === 'read_webpage' ? 'external' : s.kind === 'delegate' ? 'agents' : s.kind === 'run_code' || s.kind === 'run_sql' ? 'terminal' : 'search'} size={13} />}
                        <span className="step-label">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={`lt-out${askable ? ' askable' : ''}${threaded ? ' threaded' : ''}`} data-thread-out={askable ? i : undefined}>
                  {blocks.map((b, j) => (
                    <Fragment key={`${i}-${j}`}>
                      {showMap && j > 0 && dividersAt(i, j)}
                      {renderBlock(b, `${i}-${j}`, live, i, !blocks.some((x) => x.kind === 'grade' && x.verdict === 'correct'))}
                    </Fragment>
                  ))}
                  {showMap && blocks.length > 0 && dividersAt(i, -1, true)}
                  {askable && !threaded && <AskPill onAsk={() => openThreadAt(i)} />}
                </div>
                {live && !t.content && !t.steps?.length && (
                  <Thinking />
                )}
              </div>
              {hung.map((th) => (
                <div key={th.id} className="lt-slot" data-thread-id={th.id} data-thread-at={th.at}>
                  <ThreadSlot
                    thread={th}
                    open={th.id === openThread}
                    streaming={threadBusy === th.id}
                    steps={threadSteps[th.id]}
                    error={threadError[th.id]}
                    notes={mode === 'teach'}
                    render={(md) => renderMarkdown(md, env)}
                    onSend={(q) => askInThread(th.id, q)}
                    onRetry={() => retryThread(th.id)}
                    onFold={(understood) => foldThread(understood)}
                    onReopen={() => openThreadAt(th.at, th.quote, undefined, th.id)}
                    onSaveReply={(at) => saveReply(th.id, at)}
                    onExplore={mode !== 'interview' ? (at) => keepToExplore({ turn: th.at, quote: replyParts(th.messages[at]?.content ?? '').text, thread: th.id, reply: at }) : undefined}
                  />
                </div>
              ))}
              </Fragment>
            )
          })}

          {error && (
            <div className="chat-error">
              <p>{error}</p>
              <button className="link-btn" onClick={() => send(turns.filter((t) => t.role === 'user').pop()?.content ?? openingRef.current, turns.slice(0, -2))}>
                Try again
              </button>
            </div>
          )}

          {coding && lessonCode.proposals.length > 0 && (
            <div className="lc-proposals" aria-label="The tutor’s proposed changes">
              <Suspense fallback={<div className="view-loading small" aria-busy="true" />}>
                {lessonCode.proposals.map((p) => (
                  <LessonProposal
                    key={p.id}
                    proposal={p}
                    current={lessonCode.currentOf(p)}
                    onResolve={(text) => void lessonCode.resolve(p, text).catch((e: Error) => app.toast(e.message, { tone: 'error' }))}
                    onOpenFile={() => void openInIde()}
                  />
                ))}
              </Suspense>
            </div>
          )}

          {(currentAsk || carryOn) && (
            <div className={`lt-back-dock${openThread ? ' open' : ''}`}>
              <BackPill show={!!openThread} onBack={() => foldThread(false)} />
            </div>
          )}
          {currentAsk && (
            <div className={`s-answer${openThread ? ' lt-resting' : ''}`}>
              <AnswerHint
                show={hint}
                question={currentAsk.prompt.replace(/[*_`$#>]/g, '').replace(/\s+/g, ' ').trim()}
                onThread={() => {
                  const q = answer.trim()
                  // On the output that asked the question: the latest of the tutor's
                  const at = turns.map((x, k) => (x.role === 'assistant' ? k : -1)).filter((k) => k > 0).pop()
                  setHint(false)
                  if (!q || at === undefined) return
                  setAnswer('')
                  openThreadAt(at, undefined, q)
                }}
                onAnswer={() => submit(undefined, undefined, true)}
              />
              {currentAsk.type === 'choice' && currentAsk.options.length > 0 ? (
                <>
                  <div className="s-options" role="radiogroup" aria-label="Options">
                    {currentAsk.options.map((o, k) => (
                      <button key={k} role="radio" aria-checked={picked === k} className={`quiz-option${picked === k ? ' picked' : ''}`} onClick={() => setPicked(picked === k ? null : k)} title={`Pick ${String.fromCharCode(65 + k)} (key ${k + 1})`}>
                        <span className="option-key">{String.fromCharCode(65 + k)}</span>
                        <span className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(o, env).trim().replace(/^<p[^>]*>|<\/p>$/g, '') }} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={answerRef}
                    className="s-input small"
                    rows={2}
                    value={answer}
                    onChange={(e) => (setAnswer(e.target.value), setHint(false))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                    }}
                    placeholder={picked === null ? 'Pick one, or write your own answer' : 'Your reasoning (optional)'}
                    aria-label="Your reasoning"
                    {...pictures.handlers}
                  />
                </>
              ) : currentAsk.type === 'code' ? (
                <>
                  {coding && lessonCode.file && (
                    <div className="lc-bar">
                      <span className="lc-file" title={lessonCode.ws ? `${lessonCode.ws.root}/${lessonCode.file}` : lessonCode.file}>
                        <Icon name="files" size={12} />
                        <span>{lessonCode.file}</span>
                      </span>
                      {lessonCode.comments.length > 0 && <span className="lc-tag">{lessonCode.comments.length === 1 ? '1 comment' : `${lessonCode.comments.length} comments`}</span>}
                      {lessonCode.file !== (lastCodeAsk ? exerciseFile(exerciseNumber(codeAsks.seen, lastCodeAsk), codeAsks.lang) : null) && (
                        <button className="link-btn" onClick={lessonCode.backToExercise}>
                          Back to this question’s file
                        </button>
                      )}
                      <span className="lc-gap" />
                      <button className="link-btn" onClick={() => void openInIde()} title="Open this lesson’s files in the Code view, with Claude beside them">
                        Open in the IDE
                      </button>
                    </div>
                  )}
                  <Suspense fallback={<div className="view-loading small" aria-busy="true" />}>
                    <CodeEditor
                      value={code}
                      onChange={setCode}
                      language={currentAsk.lang ?? options?.language ?? 'python'}
                      onSubmit={() => submit()}
                      editorRef={codeEditorRef}
                      {...(coding ? { comments: lessonCode.comments, onDismissComment: lessonCode.dismissComment, onProblems: lessonCode.problems, reveal: lessonCode.reveal } : {})}
                    />
                  </Suspense>
                  <div className="s-run-row">
                    <button className="btn small" onClick={() => void runMine()} disabled={running || !code.trim()} title="Run your code in a sandbox">
                      <Icon name="play" size={12} />
                      {running ? 'Running…' : 'Run'}
                    </button>
                    {/^(python|py)$/i.test((currentAsk.lang ?? options?.language ?? 'python').trim()) && (
                      <button className="btn small" onClick={() => formatEditor(codeEditorRef.current)} disabled={!code.trim()} title="Format with Ruff (⇧⌥F)">
                        <Icon name="format" size={12} />
                        Format
                      </button>
                    )}
                    <span className="muted small">{currentAsk.tests ? 'Run checks it against hidden tests.' : 'Try your solution here.'}</span>
                  </div>
                  {currentAsk.tests && testNames(currentAsk.tests).length > 0 && (
                    <p className="muted small s-test-names" aria-label="Hidden tests">
                      Hidden tests: {testNames(currentAsk.tests).join(' · ')}
                    </p>
                  )}
                  {runOut && (
                    <pre className={`run-output s-run-output${runOut.exitCode !== 0 || runOut.timedOut ? ' failed' : ''}`} data-meta={runOut.timedOut ? 'timed out' : `exit ${runOut.exitCode}, ${runOut.durationMs} ms`}>
                      {(runOut.stdout + (runOut.stderr ? (runOut.stdout ? '\n' : '') + runOut.stderr : '')) || 'Ran with no output.'}
                    </pre>
                  )}
                  <textarea className="s-input small" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={asking ? 'What would you like to ask? Your code can wait.' : 'Explain your code or approach (optional)'} {...pictures.handlers} />
                </>
              ) : (
                <textarea
                  ref={answerRef}
                  className="s-input"
                  rows={currentAsk.type === 'explain' || currentAsk.type === 'problem' ? 5 : 3}
                  autoFocus
                  value={answer}
                  onChange={(e) => (setAnswer(e.target.value), setHint(false))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                  }}
                  placeholder={
                    asking
                      ? 'What would you like to ask? Your answer can wait.'
                      : currentAsk.type === 'predict'
                      ? 'Make your best guess before the explanation'
                      : currentAsk.type === 'explain'
                        ? 'Explain it in your own words, as if teaching someone'
                        : currentAsk.type === 'error'
                          ? 'What is wrong, and why?'
                          : currentAsk.type === 'problem'
                            ? 'Work it through step by step, or add a photo of your working'
                            : 'Your answer'
                  }
                  {...pictures.handlers}
                />
              )}
              <AttachedStrip images={pictures} />
              <div className="s-answer-bar">
                <div className="segmented text" role="radiogroup" aria-label="How sure are you?">
                  {CONFIDENCE.map((c) => (
                    <button key={c.value} role="radio" aria-checked={confidence === c.value} className={confidence === c.value ? 'on' : ''} onClick={() => setConfidence(c.value)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="row-gap">
                  <AttachImageButton images={pictures} />
                  {currentAsk.type !== 'code' && (
                    <DictateButton
                      target={answerRef}
                      onStart={stopTalking}
                      where={heardIn}
                      onText={talk ? (said) => send(`Answer: ${said}`, turns) : undefined}
                    />
                  )}
                  {!timed && (
                    <button className="tool-btn" onClick={askHint} title="Get the smallest hint that helps">
                      <Icon name="sparkle" />
                      <span>{HINT_LEVELS[Math.min(hintLevel, 3)]}</span>
                    </button>
                  )}
                  {/* A question of your own before answering: sent as a question, never marked as an answer */}
                  <button className="tool-btn" aria-pressed={asking} onClick={() => setAsking((a) => !a)} title={asking ? 'Back to answering' : 'Ask the tutor something first; the question stays open'}>
                    <span>{asking ? 'Answer instead' : 'Ask first'}</span>
                  </button>
                  {!asking && (
                    <button className="tool-btn" onClick={() => submit("I don't know.")}>
                      <span>I don't know</span>
                    </button>
                  )}
                  <button className="btn primary" onClick={() => submit()} disabled={pictures.adding || (asking ? !answer.trim() && !pictures.paths.length : currentAsk.type === 'code' ? !code.trim() : currentAsk.type === 'choice' && currentAsk.options.length > 0 ? picked === null && !answer.trim() && !pictures.paths.length : !answer.trim() && !pictures.paths.length)}>
                    {asking ? 'Ask' : 'Submit'} <kbd>⌘↵</kbd>
                  </button>
                </div>
              </div>
            </div>
          )}

          {carryOn && (
            <div className={`s-goon${openThread ? ' lt-resting' : ''}`}>
              {asking ? (
                <>
                  <textarea
                    ref={answerRef}
                    className="s-input"
                    rows={3}
                    autoFocus
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                      if (e.key === 'Escape') setAsking(false)
                    }}
                    placeholder="What would you like to ask?"
                    aria-label="Your question"
                    {...pictures.handlers}
                  />
                  <AttachedStrip images={pictures} />
                  <div className="row-gap s-goon-bar">
                    <AttachImageButton images={pictures} />
                    <DictateButton target={answerRef} onStart={stopTalking} where={heardIn} />
                    <button className="tool-btn" onClick={() => (setAsking(false), setAnswer(''), pictures.clear())}>
                      Cancel
                    </button>
                    <button className="btn primary" onClick={() => submit()} disabled={pictures.adding || (!answer.trim() && !pictures.paths.length)}>
                      Ask <kbd>⌘↵</kbd>
                    </button>
                  </div>
                </>
              ) : (
                <div className="row-gap s-goon-bar">
                  <button className="tool-btn" onClick={() => setAsking(true)}>
                    I have a question
                  </button>
                  <button className="btn primary" autoFocus onClick={() => send(GO_ON, turns)}>
                    Go on <kbd>⌘↵</kbd>
                  </button>
                </div>
              )}
            </div>
          )}

          {finished && recapClip && (
            <div className="vclip-offer">
              <p>
                <b>Recap from the video.</b> Rewatch {formatRange(recapClip.start, recapClip.end)} of “{recapClip.title}” and answer {mode === 'teach' ? '2 or 3' : 'a few'} questions on it. They count towards What you know.
              </p>
              <button className="btn" onClick={() => send(recapMessage(recapClip), turns)}>
                <Icon name="video" size={14} /> Watch the recap
              </button>
            </div>
          )}
          {finished && showMap && map.steps.length > 0 && (
            <LessonEnd
              map={map}
              topic={topic}
              reviewDays={{}}
              flashcards={cardsToday}
              nextLesson={nextUp ? (nextUp.item.topic ?? nextUp.item.title) : null}
              onFlashcards={() => app.setView({ kind: 'daily', nonce: Date.now() })}
              onNext={() => nextUp && startAgendaLesson(app, nextUp.item, nextUp)}
              onDone={() => app.setView({ kind: 'home' })}
            />
          )}
          {finished && (
            <div className={`row-gap s-finish${showMap && map.steps.length > 0 ? ' lm-after-end' : ''}`}>
              {/* Under the lesson map's end card, which has the primary action, these are secondary */}
              <button className={`btn${showMap && map.steps.length > 0 ? '' : ' primary'}`} onClick={() => send(openingRef.current, [])}>
                <Icon name="refresh" size={14} />
                Go again
              </button>
              {mode !== 'quiz' && (
                <button className="btn" onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope, topic })}>
                  Quiz me on this
                </button>
              )}
              {sourcePath && (
                <button className="btn" onClick={() => app.openPath(sourcePath)}>
                  Back to {fileTitle(sourcePath)}
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
          {mode !== 'interview' && <SelectionAsk column={columnRef} onAsk={(at, quote) => openThreadAt(at, quote)} onExplore={keepToExplore} />}
        </div>
      </div>
      </div>
      {rail && (
        <aside className="td-lesson-rail" aria-label="The level and sources">
          {/* Hook (shared/difficulty.ts): one line on what Tide is doing with the level, and why */}
          {difficultyLine && (
            <section className="td-rail-level" aria-live="polite">
              <h2 className="td-rail-h">Level</h2>
              <p>{difficultyLine}</p>
            </section>
          )}
          {hasSources && (
            <section>
              <h2 className="td-rail-h">Checked against</h2>
              {pack?.sources.map((src) => (
                <button key={`s${src.n}`} className="td-src" onClick={() => (src.path ? app.openPath(src.path) : src.url && window.tide.app.openExternal(src.url))} title={`What this lesson is taught from: ${src.title}`}>
                  <span className="td-src-k">{src.n}</span>
                  <span>
                    <b>{src.title}</b>
                    <span>{src.path ? 'In your library' : src.url ? hostOf(src.url) : 'A source for this lesson'}</span>
                  </span>
                </button>
              ))}
              {toRead.map((r) => (
                <button key={`${r.path}:${r.from}`} className="td-src" onClick={() => app.openPath(r.path, `page=${r.from}`)} title={r.about ?? readingLabel(r)}>
                  <span className="td-src-k">
                    <Icon name="book" size={12} />
                  </span>
                  <span>
                    <b>{readingLabel(r)}</b>
                    <span>In your library, to read alongside</span>
                  </span>
                </button>
              ))}
              {moreFound.map((r) => (
                <button key={`${r.url}#${r.title}`} className="td-src" onClick={() => (r.path ? app.openPath(r.path) : window.tide.app.openExternal(r.url))} title={[r.by, r.why].filter(Boolean).join(': ') || r.title}>
                  <span className="td-src-k">
                    <Icon name={r.path ? 'pdf' : 'external'} size={12} />
                  </span>
                  <span>
                    <b>{r.title}</b>
                    <span>{[r.by, r.path ? 'saved in your library' : 'on the web'].filter(Boolean).join(', ')}</span>
                  </span>
                </button>
              ))}
              {checks.length > 0 && (
                <div className="td-src still">
                  <span className="td-src-k">
                    <Icon name={checks.includes('checking') ? 'search' : 'check'} size={12} />
                  </span>
                  <span>
                    <b>Second look</b>
                    <span>
                      {checks.includes('checking')
                        ? 'The stronger model is reading a reply now.'
                        : `${checks.length} ${checks.length === 1 ? 'reply' : 'replies'} checked by the stronger model. `}
                      {!checks.includes('checking') && <span className={checks.includes('flagged') ? 'td-warn' : 'td-ok'}>{checks.includes('flagged') ? `${checks.filter((c) => c === 'flagged').length} corrected.` : 'Nothing wrong found.'}</span>}
                    </span>
                  </span>
                </div>
              )}
            </section>
          )}
        </aside>
      )}
      {withNotes && approach === 'walkthrough' && sideTab === 'canvas' ? (
        <div className="lesson-side">
          <SideTabs tab={sideTab} onTab={setSideTab} />
          <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
            <LessonCanvas path={canvasPath} lessonId="session:" revision={canvasRev} />
          </Suspense>
        </div>
      ) : withNotes && (
        <div className="lesson-side">
        {approach === 'walkthrough' && <SideTabs tab={sideTab} onTab={setSideTab} />}
        <LessonNotes
          topic={topic}
          scope={scope}
          takeaways={takeaways}
          busy={busy}
          mineRef={notesMine}
          onCheck={(mine) => send(notesReviewRequest(mine), turns)}
        />
        </div>
      )}
      </div>
    </div>
  )
}

/** Beside a walkthrough: the canvas the tutor draws on, or your notes */
function SideTabs({ tab, onTab }: { tab: 'canvas' | 'notes'; onTab(t: 'canvas' | 'notes'): void }) {
  return (
    <div className="segmented text lesson-side-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'canvas'} className={tab === 'canvas' ? 'on' : ''} onClick={() => onTab('canvas')}>
        Canvas
      </button>
      <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => onTab('notes')}>
        Notes
      </button>
    </div>
  )
}
