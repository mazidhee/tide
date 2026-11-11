import { testNames } from '@shared/codeTests'
import { showMeOffered } from '@shared/showMe'
import { TimeThis } from './TimeThis'
import { drawSteps, stepsReached } from '@shared/project'
import { parseCanvas, serializeCanvas } from '@shared/canvas'
import { readingLabel, type ReadingSuggestion } from '@shared/books'
import { notesReviewRequest, wantsNotesReview } from '@shared/lessonNotes'
import { reveal } from '../lib/scroll'
import { Thinking } from './Thinking'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStep, ChatMessage, ChatScope, RunResult, SessionMode, Verdict } from '@shared/types'
import { markNote, paceNote } from '@shared/pace'
import { markingNote } from '@shared/humanities'
import { teachesAsHumanities } from '@shared/subjects'
import { AppraiseCard } from './AppraiseCard'
import { useDifficulty } from '../lib/difficulty'
import { nothingToMark, unmarked } from '@shared/lessonRepair'
import { withSources, type SourcePack } from '@shared/sources'
import { ledPrefKey } from '@shared/sourceLed'
import { openReading } from '../lib/reading'
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
import { EnginePill } from './EnginePill'
import { DictateButton, SpeakButton, useTalk } from './Voice'
import { InterviewClock, useInterviewClock } from './InterviewClock'
import { LessonNotes } from './LessonNotes'
import { finishAgendaItem } from '../lib/agenda'
import { useStudying } from '../lib/studying'
import { endOngoing, followInBackground, getOngoing, keepLesson, keepLive, saveOngoing, sessionKey, stopFollowing } from '../lib/sessions'
import type { View } from '../state'
import { Professor, type ProfessorPose } from './Professor'
import { useTideDesign } from '../lib/design'
import { characterById } from '@shared/characters'
import { conceptFor, useKnowledge } from '../lib/knowledge'
import { useAreaClass } from '../lib/areas'
import { since } from '@shared/knowledge'
import { Level } from './tide/Level'
import { AreaMark } from './tide/AreaMark'

// Loaded when a lesson needs them: the code editor (Monaco) and the walkthrough canvas
const answered = (said: string) => !said.startsWith(GO_ON) && !said.startsWith(ASKED)

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))
const LessonCanvas = lazy(() => import('./LessonCanvas').then((m) => ({ default: m.LessonCanvas })))
import { parseVerdict, scorecardScore } from '@shared/interviews'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  steps?: AgentStep[]
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
  // The lesson's data lab: the tutor's run_sql and the queries you run in the lesson share it
  const labId = useRef(`lesson:${ongoingKey ?? uid()}`)
  const app = useApp()
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [code, setCode] = useState('')
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
  const [led, setLed] = useState(() => localStorage.getItem(ledPrefKey(scope)) !== 'off')
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
  const [engine, setEngine] = useState<'auto' | 'local' | 'cloud'>('auto')
  // A notebook set to be taught by the cloud model starts its lessons that way (you can still switch)
  useEffect(() => {
    const where = 'path' in scope ? scope.path : ''
    if (!where) return
    window.tide.learn
      .notebooks()
      .then((nbs) => {
        const nb = nbs.find((n) => where === n.path || where.startsWith(`${n.path}/`))
        if (nb?.tutor === 'cloud') setEngine((e) => (e === 'auto' ? 'cloud' : e))
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
        mode === 'teach' && history.length > 2 ? notesNudge(history.filter((t) => t.role === 'assistant').map((t) => t.content), content) : null
      ].filter((n): n is string => !!n)
      if (notes.includes(whyNoteRef.current ?? '')) whyNoteRef.current = null
      const stored = notes.length ? `${content}\n\n${notes.join('\n')}` : content
      const next = [...history, { role: 'user' as const, content: stored }, { role: 'assistant' as const, content: '' }]
      setTurns(next)
      const messages: ChatMessage[] = next.slice(0, -1).map((t) => ({ role: t.role, content: t.content }))
      // In a timed round the interviewer sees the time left with each answer, to pace the round
      if (timed) {
        clock.start()
        const last = messages[messages.length - 1]
        messages[messages.length - 1] = { ...last, content: `(Time left: ${clock.left() || timed} of ${timed} minutes)\n${last.content}` }
      }
      await window.tide.ai.chat({ id, messages, scope, instructions: sessionInstructions(setupRef.current), labId: labId.current, canvasPath: approachRef.current === 'walkthrough' ? canvasPath : undefined, session: true, topic: setupRef.current.topic, web, voice: talkRef.current ? (app.settings.character ?? 'professor') : undefined, askType: askTypeRef.current, engine: engineRef.current, sourceLed: ledRef.current })
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
  const [pack, setPack] = useState<SourcePack | null>(null)
  const begin = async () => {
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
    openingRef.current = opening
    // Written ahead for this exact lesson (main/bank.ts): it opens at once
    const ready = await window.tide.bank.opening(sessionInstructions(setupRef.current), opening).catch(() => null)
    if (ready) {
      setTurns([
        { role: 'user', content: opening },
        { role: 'assistant', content: ready }
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
      const st = saved.state as { turns: Turn[]; activeId: string | null }
      // Tide closed while the tutor was replying: drop the cut-off reply and ask for it again
      if (saved.interrupted) {
        const turns = st.turns.map((t) => ({ ...t }))
        while (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop()
        const answer = turns.pop()
        if (answer?.role === 'user') send(answer.content, turns)
        else setTurns(st.turns.map((t) => ({ ...t })))
        return
      }
      setTurns(st.turns.map((t) => ({ ...t })))
      if (saved.busy && st.activeId) {
        activeId.current = st.activeId
        setBusy(true)
      }
      return
    }
    // Carried over from another window: pick up where it was
    if (initialTurns?.length) {
      setTurns(initialTurns)
      return
    }
    setTurns([])
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
        const blocks = parseBlocks(i > 1 && nothingToMark(turns[i - 1]?.content ?? '') ? unmarked(t.content) : t.content)
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
  // A new code question starts from its own starter, not from your answer to the last one
  const askedCode = useRef<string | null>(null)
  const codeAsk = askIdentity(currentAsk)
  useEffect(() => {
    if (!codeAsk || codeAsk === askedCode.current) return
    const first = askedCode.current === null && !!code.trim()
    askedCode.current = codeAsk
    // A lesson picked up again keeps what was being typed for the question it reopens on
    if (first) return
    setCode(askStarter(currentAsk?.prompt ?? ''))
    setRunOut(null)
    ranFor.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeAsk])
  const plan = parsed.flatMap((b) => b ?? []).filter((b): b is Extract<Block, { kind: 'plan' }> => b.kind === 'plan').pop()
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
      ...pinned.map((p) => p.text)
    ],
    [parsed, busy, pinned]
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
  // Leaving mid-way keeps the session for later; finishing it lets it go
  const keepRef = useRef({ turns, busy, finished })
  keepRef.current = { turns, busy, finished }
  // Saved to disk as it goes (when you answer, and when each reply is done), so quitting Tide or
  // the Mac shutting down mid-lesson doesn't lose it
  useEffect(() => {
    const k = keepRef.current
    if (!ongoingKey || !view || k.finished || k.turns.length < 2) return
    keepLive({ key: ongoingKey, view, title: `${MODE_LABEL[mode] ?? 'Session'}: ${topic}`, state: { turns: k.turns, activeId: null }, busy: k.busy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, busy, finished, ongoingKey, edited])
  useEffect(() => {
    if (!finished || !ongoingKey) return
    // Finished lessons stay in Past lessons, to read again
    if (view) keepLesson(ongoingKey, view, keepRef.current.turns, true)
    endOngoing(ongoingKey)
  }, [finished, ongoingKey])
  useEffect(
    () => () => {
      const k = keepRef.current
      if (!ongoingKey || !view || k.finished || k.turns.length < 2) return
      saveOngoing({ key: ongoingKey, view, title: `${MODE_LABEL[mode] ?? 'Session'}: ${topic}`, state: { turns: k.turns, activeId: activeId.current }, busy: k.busy })
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
          question: prevAsk?.prompt.slice(0, 300)
        })
        if (b.verdict === 'correct') setCheer(Date.now() + 4500)
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
  }, [parsed, busy, checking, turns, sourcePath, topic, mode, options, scope])

  const changeApproach = (to: Strategy, said?: string) => {
    setApproach(to)
    approachRef.current = to
    if (to === 'walkthrough') setNotesOpen(true)
    send(`${said ? `${said}\n\n` : ''}(From here on, teach this way: ${STRATEGY_RULES[to] || 'problem sets, one problem at a time, stepping difficulty up and down as before.'})`, turns)
  }

  const submit = (text?: string, ranNow?: RunResult) => {
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
    const pick = choice && picked !== null && currentAsk.options[picked] ? `(${String.fromCharCode(65 + picked)}) ${currentAsk.options[picked]}` : ''
    const body =
      text ??
      (asking
        ? answer.trim()
        : currentAsk?.type === 'code'
        ? `${answer.trim() ? answer.trim() + '\n\n' : ''}\`\`\`${currentAsk.lang ?? 'python'}\n${code}\n\`\`\`${ran}`
        : pick
          ? `${pick}${answer.trim() ? `\nReasoning: ${answer.trim()}` : ''}`
          : answer.trim())
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
    const conf = confidence ? `\n(Confidence: ${CONFIDENCE.find((c) => c.value === confidence)!.label.toLowerCase()})` : ''
    send(text ? body : asking || carryOn ? `${ASKED}${body}` : `Answer: ${body}${conf}`, turns)
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


  // Ask about this, pressed on a part of a live simulation: in a lesson it goes straight to the
  // tutor as your question, saying which part and what it showed
  const askAboutRef = useRef<(label: string) => void>(() => {})
  askAboutRef.current = (label) => submit(`${ASKED}In the simulation, explain ${label}: what it is doing here, and why it has that value.`)
  useEffect(() => {
    const onAsk = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label
      if (!label) return
      e.preventDefault()
      e.stopImmediatePropagation()
      askAboutRef.current(label)
    }
    document.addEventListener('tide:ask-about', onAsk, true)
    return () => document.removeEventListener('tide:ask-about', onAsk, true)
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

  const renderBlock = (b: Block, key: string, live: boolean) => {
    switch (b.kind) {
      case 'text':
        return <div key={key} className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
      case 'ask':
        // The new design: a question about something you already hold shows its level beside it
        if (tide && concept && concept.seen > 0)
          return (
            <div key={key} className="s-ask td-recall">
              <Level now={concept.estimate} high={concept.level} area={areaOf(concept.area)} large />
              <div>
                <p className={`td-recall-lab${concept.status === 'fading' ? ' fading' : ''}`}>
                  {options?.retest?.length
                    ? 'You missed this before'
                    : concept.status === 'fading'
                      ? `Fading: last right ${since(concept.lastRight ?? concept.lastSeen, Date.now())}`
                      : concept.status === 'solid'
                        ? `Holding: last right ${since(concept.lastRight ?? concept.lastSeen, Date.now())}`
                        : `In progress: ${concept.right} of ${concept.right + concept.partly + concept.wrong} right so far`}
                </p>
                <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.prompt, env) }} />
              </div>
            </div>
          )
        return (
          <div key={key} className="s-ask">
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.prompt, env) }} />
          </div>
        )
      case 'grade':
        return (
          <div key={key} className={`s-grade v-${b.verdict}`}>
            <span className="s-grade-badge">
              <Icon name={b.verdict === 'correct' ? 'check' : b.verdict === 'wrong' ? 'x' : 'minus'} size={13} />
              {b.verdict === 'correct' ? 'Correct' : b.verdict === 'wrong' ? 'Not quite' : 'Partly right'}
            </span>
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
          </div>
        )
      case 'card':
        return (
          <div key={key} className="s-card">
            <div className="s-card-text">
              <span className="muted small">Flashcard from this miss</span>
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
        return null
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

  const planDone = (() => {
    if (!plan) return 0
    // A step is done after two right in a row, as the tutor is told to move on
    const planTurn = parsed.findIndex((b) => b?.some((x) => x.kind === 'plan'))
    const verdicts = parsed.slice(planTurn + 1).flatMap((b) => b ?? []).filter((b) => b.kind === 'grade').map((b) => (b as { verdict: Verdict }).verdict)
    let steps = 0
    let streak = 0
    for (const v of verdicts) {
      streak = v === 'correct' ? streak + 1 : 0
      if (streak === 2) (steps++, (streak = 0))
    }
    return Math.min(plan.steps.length, steps)
  })()

  const scopeLabel = scope.kind === 'note' ? fileTitle(scope.path) : scope.kind === 'pages' ? pagesLabel(scope) : scope.kind === 'folder' ? scope.path.split('/').pop() : null

  const difficultyLine = difficulty.line(turns, plan && planDone < plan.steps.length ? plan.steps[planDone] : undefined)
  // The rail of the new design: only when there is something to put in it
  const checks = Object.values(challenged)
  const hasSources = toRead.length > 0 || found.length > 0 || !!pack?.sources.length || checks.length > 0
  const rail = tide && !withNotes && railOpen && (!!plan || hasSources)
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
                window.tide.windows.openFocus({ kind: 'session', mode, scope, topic, options, turns: turns.map((t) => ({ role: t.role, content: t.content })), nonce: Date.now() })
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
              title={railOpen ? 'Hide the plan and sources' : 'Show the plan and what this is checked against'}
              aria-label="The plan and sources"
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
      <div className="doc-scroll session-scroll">
        <div
          className="session-column"
          data-lab={labId.current}
          // [source-led] a reading's "Open in your library at page N"
          onClick={(e) => {
            const open = openReading(e.target)
            if (open) (e.preventDefault(), app.openPath(open.path, open.anchor))
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
          {plan && !rail && (
            <ol className="s-plan" aria-label="Lesson plan">
              {plan.steps.map((s, i) => (
                <li key={i} className={i < planDone ? 'done' : i === planDone ? 'current' : ''}>
                  <span className="s-plan-dot">{i < planDone ? <Icon name="check" size={11} /> : i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}

          {turns.map((t, i) => {
            if (i === 0 && t.role === 'user') return null
            if (t.role === 'user') {
              const isHint = t.content.startsWith('[hint]')
              const own = ownWords(t.content)
              const text = own.replace(/^Answer: /, '').replace(/^My question: /, '').replace(/\n\(Confidence: \w+\)$/, '')
              const conf = own.match(/\(Confidence: (\w+)\)$/)?.[1]
              return (
                <div key={i} className={`s-you${isHint ? ' hint' : ''}`}>
                  {isHint ? (
                    <span className="muted small">You asked for a {t.content.match(/\((.+) please\)/)?.[1] ?? 'hint'}</span>
                  ) : (
                    <>
                      <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, env) }} />
                      {conf && <span className="s-conf-tag">{conf}</span>}
                    </>
                  )}
                </div>
              )
            }
            const blocks = parsed[i] ?? []
            const live = busy && i === turns.length - 1
            return (
              <div key={i} className="s-tutor">
                {tide && (
                  <div className="td-who">
                    <Professor state={live ? 'writing' : 'idle'} size={24} />
                    <b>{characterById(app.settings.character ?? 'professor').name}</b>
                    {plan && i === turns.length - 1 && planDone < plan.steps.length && <span className="td-meta">Step {planDone + 1}: {plan.steps[planDone].replace(/[.:]$/, '')}</span>}
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
                {!!t.steps?.length && (
                  <ul className="work-log">
                    {t.steps.map((s) => (
                      <li key={s.id} className={`step ${s.status}${s.depth ? ' nested' : ''}`}>
                        {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.kind === 'web_search' ? 'globe' : s.kind === 'read_webpage' ? 'external' : s.kind === 'delegate' ? 'agents' : s.kind === 'run_code' || s.kind === 'run_sql' ? 'terminal' : 'search'} size={13} />}
                        <span className="step-label">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {blocks.map((b, j) => renderBlock(b, `${i}-${j}`, live))}
                {live && !t.content && !t.steps?.length && (
                  <Thinking />
                )}
              </div>
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

          {currentAsk && (
            <div className="s-answer">
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
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                    }}
                    placeholder={picked === null ? 'Pick one, or write your own answer' : 'Your reasoning (optional)'}
                    aria-label="Your reasoning"
                  />
                </>
              ) : currentAsk.type === 'code' ? (
                <>
                  <Suspense fallback={<div className="view-loading small" aria-busy="true" />}>
                    <CodeEditor value={code} onChange={setCode} language={currentAsk.lang ?? options?.language ?? 'python'} onSubmit={() => submit()} editorRef={codeEditorRef} />
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
                  <textarea className="s-input small" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={asking ? 'What would you like to ask? Your code can wait.' : 'Explain your code or approach (optional)'} />
                </>
              ) : (
                <textarea
                  ref={answerRef}
                  className="s-input"
                  rows={currentAsk.type === 'explain' || currentAsk.type === 'problem' ? 5 : 3}
                  autoFocus
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
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
                            ? 'Work it through step by step'
                            : 'Your answer'
                  }
                />
              )}
              <div className="s-answer-bar">
                <div className="segmented text" role="radiogroup" aria-label="How sure are you?">
                  {CONFIDENCE.map((c) => (
                    <button key={c.value} role="radio" aria-checked={confidence === c.value} className={confidence === c.value ? 'on' : ''} onClick={() => setConfidence(c.value)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="row-gap">
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
                  <button className="btn primary" onClick={() => submit()} disabled={asking ? !answer.trim() : currentAsk.type === 'code' ? !code.trim() : currentAsk.type === 'choice' && currentAsk.options.length > 0 ? picked === null && !answer.trim() : !answer.trim()}>
                    {asking ? 'Ask' : 'Submit'} <kbd>⌘↵</kbd>
                  </button>
                </div>
              </div>
            </div>
          )}

          {carryOn && (
            <div className="s-goon">
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
                  />
                  <div className="row-gap s-goon-bar">
                    <DictateButton target={answerRef} onStart={stopTalking} where={heardIn} />
                    <button className="tool-btn" onClick={() => (setAsking(false), setAnswer(''))}>
                      Cancel
                    </button>
                    <button className="btn primary" onClick={() => submit()} disabled={!answer.trim()}>
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

          {finished && (
            <div className="row-gap s-finish">
              <button className="btn primary" onClick={() => send(openingRef.current, [])}>
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
        </div>
      </div>
      {rail && (
        <aside className="td-lesson-rail" aria-label="The plan and sources">
          {plan && (
            <section>
              <h2 className="td-rail-h">
                Plan
                <span className="td-meta">
                  {Math.min(planDone + 1, plan.steps.length)} of {plan.steps.length}
                </span>
              </h2>
              <ol className="td-plan">
                {plan.steps.map((st, i) => (
                  <li key={i} className={i < planDone ? 'done' : i === planDone ? 'current' : ''} aria-current={i === planDone ? 'step' : undefined}>
                    <span className="td-plan-n">{i < planDone ? <Icon name="check" size={11} /> : i + 1}</span>
                    <span>{st}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
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
