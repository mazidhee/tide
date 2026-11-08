import { TimeThis } from './TimeThis'
import { reveal } from '../lib/scroll'
import { Thinking } from './Thinking'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStep, ChatMessage, ChatScope, RunResult, SessionMode, Verdict } from '@shared/types'
import { MODE_LABEL, openingMessage, parseBlocks, sessionInstructions, type Block, type SessionSetup } from '@shared/session'
import { cardsToMarkdown } from '@shared/cards'
import { fileTitle, useApp, pagesLabel } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'
import { CodeEditor } from './CodeEditor'
import { DictateButton, SpeakButton, useTalk } from './Voice'
import { InterviewClock, useInterviewClock } from './InterviewClock'
import { LessonNotes } from './LessonNotes'
import { finishAgendaItem } from '../lib/agenda'
import { useStudying } from '../lib/studying'
import { endOngoing, followInBackground, getOngoing, saveOngoing, sessionKey, stopFollowing } from '../lib/sessions'
import type { View } from '../state'
import { Professor, type ProfessorPose } from './Professor'
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
const inFocusWindow = /[#&]focus=/.test(window.location.hash)

export function SessionView({ mode, scope, topic, options, initialTurns, view }: { mode: SessionMode; scope: ChatScope; topic: string; options?: SessionSetup['options']; initialTurns?: { role: 'user' | 'assistant'; content: string }[]; view?: View }) {
  const ongoingKey = view ? sessionKey(view as { kind: string; mode?: string; topic?: string; nonce?: number }) : null
  const app = useApp()
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [code, setCode] = useState('')
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null)
  const [hintLevel, setHintLevel] = useState(0)
  const [runOut, setRunOut] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [savedCards, setSavedCards] = useState<Set<string>>(new Set())
  const [web, setWeb] = useState(() => localStorage.getItem('tide.chat.web') !== 'off')
  const activeId = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const recorded = useRef(new Set<string>())
  const talkRef = useRef(localStorage.getItem('tide.talk') === 'on')
  const answerRef2 = useRef<(said: string) => void>(() => {})
  const gradeIndex = useRef(0)
  // A right answer gets a lightbulb moment
  const [cheer, setCheer] = useState(0)
  useEffect(() => {
    if (!cheer) return
    const t = setTimeout(() => setCheer(0), Math.max(0, cheer - Date.now()))
    return () => clearTimeout(t)
  }, [cheer])
  const setup: SessionSetup = useMemo(() => ({ mode, topic, options }), [mode, topic, options])
  const timed = mode === 'interview' ? options?.timed : undefined
  const sendRef = useRef<(content: string, history: Turn[]) => void>(() => {})
  const turnsRef = useRef<Turn[]>([])
  // At zero the interviewer is told to stop and score, as in a real round
  const clock = useInterviewClock(timed, () => sendRef.current("[time] Time's up. Stop here and give me the scorecard and verdict.", turnsRef.current))
  const sourcePath = scope.kind === 'note' || scope.kind === 'pages' ? scope.path : undefined
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
        if (e.type === 'done' || e.type === 'error') {
          activeId.current = null
          setBusy(false)
        }
      }),
    []
  )

  // What the tutor last asked, and which model you chose: a worked answer to a problem can go to the cloud model
  const askTypeRef = useRef<string | undefined>(undefined)
  const [engine, setEngine] = useState<'auto' | 'local' | 'cloud'>('auto')
  const engineRef = useRef(engine)
  engineRef.current = engine
  const send = useCallback(
    async (content: string, history: Turn[]) => {
      const id = `session:${uid()}`
      activeId.current = id
      setBusy(true)
      setError(null)
      const next = [...history, { role: 'user' as const, content }, { role: 'assistant' as const, content: '' }]
      setTurns(next)
      const messages: ChatMessage[] = next.slice(0, -1).map((t) => ({ role: t.role, content: t.content }))
      // In a timed round the interviewer sees the time left with each answer, to pace the round
      if (timed) {
        clock.start()
        const last = messages[messages.length - 1]
        messages[messages.length - 1] = { ...last, content: `(Time left: ${clock.left() || timed} of ${timed} minutes)\n${last.content}` }
      }
      await window.tide.ai.chat({ id, messages, scope, instructions: sessionInstructions(setup), web, voice: talkRef.current ? (app.settings.character ?? 'professor') : undefined, askType: askTypeRef.current, engine: engineRef.current })
    },
    [scope, setup, web, timed, clock]
  )
  sendRef.current = send
  answerRef2.current = (said) => {
    if (!busy) send(`Answer: ${said}`, turnsRef.current)
  }
  turnsRef.current = turns

  // Start the session
  useEffect(() => {
    // Left earlier and come back to: carry on where it was (a reply may have arrived meanwhile)
    const saved = ongoingKey ? getOngoing(ongoingKey) : undefined
    if (saved) {
      stopFollowing(ongoingKey!)
      const st = saved.state as { turns: Turn[]; activeId: string | null }
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
    send(openingMessage(setup), [])
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
        const blocks = parseBlocks(t.content)
        return i <= 1 ? blocks.filter((b) => b.kind !== 'grade' && b.kind !== 'card') : blocks
      }),
    [turns]
  )
  const lastBlocks = parsed[parsed.length - 1] ?? []
  // Never leave the student without a box to answer in while the session is still going
  const lastIsTutor = turns[turns.length - 1]?.role === 'assistant'
  const currentAsk = !busy
    ? ((lastBlocks.filter((b) => b.kind === 'ask').pop() as Extract<Block, { kind: 'ask' }> | undefined) ??
      (lastIsTutor && lastBlocks.length && !lastBlocks.some((b) => b.kind === 'summary' || b.kind === 'scores') ? { kind: 'ask' as const, type: 'short' as const, prompt: '', options: [] } : undefined))
    : undefined
  askTypeRef.current = currentAsk?.type
  const plan = parsed.flatMap((b) => b ?? []).filter((b): b is Extract<Block, { kind: 'plan' }> => b.kind === 'plan').pop()
  // Takeaways the tutor wrote for the lesson's note (from finished replies only)
  const takeaways = useMemo(
    () => parsed.flatMap((blocks, i) => (blocks && !(busy && i === parsed.length - 1) ? blocks.filter((b): b is Extract<Block, { kind: 'note' }> => b.kind === 'note').map((b) => b.text) : [])),
    [parsed, busy]
  )
  const [notesOpen, setNotesOpen] = useState(() => localStorage.getItem('tide.lesson.notes') !== 'closed')
  const withNotes = mode === 'teach' && notesOpen

  // Talk: the tutor speaks each reply as it writes it, and you answer by voice (or hands-free)
  const lastTurn = turns[turns.length - 1]
  const voice = useTalk(lastTurn?.role === 'assistant' && turns.length > 1 ? { key: String(turns.length - 1), content: lastTurn.content, streaming: busy } : null, (said) => answerRef2.current(said))
  const talk = voice.talk
  talkRef.current = talk
  const stopTalking = voice.stop
  const finished = !busy && turns.length > 1 && !currentAsk && lastBlocks.some((b) => b.kind === 'summary' || b.kind === 'scores')
  // Leaving mid-way keeps the session for later; finishing it lets it go
  const keepRef = useRef({ turns, busy, finished })
  keepRef.current = { turns, busy, finished }
  useEffect(() => {
    if (finished && ongoingKey) endOngoing(ongoingKey)
  }, [finished, ongoingKey])
  useEffect(
    () => () => {
      const k = keepRef.current
      if (!ongoingKey || !view || k.finished || k.turns.length < 2) return
      saveOngoing({ key: ongoingKey, view, title: `${MODE_LABEL[mode]}: ${topic}`, state: { turns: k.turns, activeId: activeId.current }, busy: k.busy })
      if (k.busy && activeId.current) followInBackground(ongoingKey, activeId.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ongoingKey]
  )
  // The professor's scene: at the board while he teaches, tea (or chess, in a quiz) on your turn
  const yourTurnScene: ProfessorPose = mode === 'teach' || mode === 'review' ? 'tea' : 'chess'
  const pose: ProfessorPose = busy ? 'board' : cheer ? 'eureka' : finished ? 'happy' : currentAsk ? yourTurnScene : 'idle'
  useStudying('view', finished ? null : { pose: busy ? 'board' : currentAsk ? yourTurnScene : 'board', label: `${MODE_LABEL[mode]}: ${topic}` })
  useEffect(() => {
    if (finished) finishAgendaItem(topic)
  }, [finished, topic])

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

  // Record each graded answer once, for mastery
  useEffect(() => {
    parsed.forEach((blocks, i) => {
      blocks?.forEach((b, j) => {
        if (b.kind !== 'grade') return
        const key = `${i}:${j}`
        if (recorded.current.has(key) || (busy && i === parsed.length - 1)) return
        recorded.current.add(key)
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
          const said = turns[i - 1]?.content.replace(/^Answer:\s*/, '').replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
          window.tide.mistakes
            .add([{ topic, path: sourcePath ?? (scope.kind === 'folder' ? scope.path : undefined), source: mode === 'teach' ? 'lesson' : 'quiz', question: prevAsk.prompt, answer: said, fix: b.text }])
            .catch(() => {})
        }
      })
    })
  }, [parsed, busy, turns, sourcePath, topic, mode, options, scope])

  const submit = (text?: string) => {
    if (busy) return
    const ran = runOut ? `\n\nWhen I ran it:\n\`\`\`\n${(runOut.stdout + runOut.stderr).slice(0, 1500) || '(no output)'}\n\`\`\`` : ''
    const body = text ?? (currentAsk?.type === 'code' ? `${answer.trim() ? answer.trim() + '\n\n' : ''}\`\`\`${currentAsk.lang ?? 'python'}\n${code}\n\`\`\`${ran}` : answer.trim())
    if (!body.trim()) return
    const conf = confidence ? `\n(Confidence: ${CONFIDENCE.find((c) => c.value === confidence)!.label.toLowerCase()})` : ''
    send(text ? body : `Answer: ${body}${conf}`, turns)
    setAnswer('')
    setConfidence(null)
    setHintLevel(0)
    setRunOut(null)
  }

  const runMine = async () => {
    if (!currentAsk || running) return
    setRunning(true)
    setRunOut(await window.tide.runner.run(currentAsk.lang ?? options?.language ?? 'python', code))
    setRunning(false)
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
    // Steps count as done as the tutor moves through them; approximate by graded answers after the plan
    const planTurn = parsed.findIndex((b) => b?.some((x) => x.kind === 'plan'))
    const grades = parsed.slice(planTurn + 1).flatMap((b) => b ?? []).filter((b) => b.kind === 'grade' && (b as { verdict: Verdict }).verdict === 'correct').length
    return Math.min(plan.steps.length, grades)
  })()

  const scopeLabel = scope.kind === 'note' ? fileTitle(scope.path) : scope.kind === 'pages' ? pagesLabel(scope) : scope.kind === 'folder' ? scope.path.split('/').pop() : null

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
          {scopeLabel && scopeLabel !== topic && <span className="muted page-count">from {scopeLabel}</span>}
        </div>
        <div className="toolbar-actions no-drag">
          {timed && <InterviewClock remaining={clock.remaining} total={timed} />}
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
            <button className={`tool-btn keep-label hands-free is-${voice.hearing}${voice.handsFree ? ' on' : ''}`} aria-pressed={voice.handsFree} onClick={voice.toggleHandsFree} title="Hands-free: just talk; Tide hears when you stop. Space or Esc interrupts the tutor.">
              <span className="hear-dot" aria-hidden="true" />
              <span>{voice.handsFree ? (voice.hearing === 'speech' ? 'Hearing you…' : voice.hearing === 'writing' ? 'Writing it down…' : voice.speaking ? 'Speaking… (Esc)' : 'Listening') : 'Hands-free'}</span>
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
          <button className="tool-btn keep-label" onClick={() => app.back()} title="End this session">
            <Icon name="x" />
            <span>End</span>
          </button>
        </div>
      </header>

      <div className={withNotes ? 'session-split' : 'session-solo'}>
      <div className="doc-scroll session-scroll">
        <div className="session-column">
          {plan && (
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
              const text = t.content.replace(/^Answer: /, '').replace(/\n\(Confidence: \w+\)$/, '')
              const conf = t.content.match(/\(Confidence: (\w+)\)$/)?.[1]
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
                {!live && t.content && (
                  <div className="s-tutor-tools">
                    <SpeakButton text={blocks.filter((b) => b.kind === 'text' || b.kind === 'ask' || b.kind === 'grade').map((b) => ('text' in b ? b.text : 'prompt' in b ? b.prompt : '')).join('. ')} />
                  </div>
                )}
                {!!t.steps?.length && (
                  <ul className="work-log">
                    {t.steps.map((s) => (
                      <li key={s.id} className={`step ${s.status}${s.depth ? ' nested' : ''}`}>
                        {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.kind === 'web_search' ? 'globe' : s.kind === 'read_webpage' ? 'external' : s.kind === 'delegate' ? 'agents' : s.kind === 'run_code' ? 'terminal' : 'search'} size={13} />}
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
              <button className="link-btn" onClick={() => send(turns.filter((t) => t.role === 'user').pop()?.content ?? openingMessage(setup), turns.slice(0, -2))}>
                Try again
              </button>
            </div>
          )}

          {currentAsk && (
            <div className="s-answer">
              {currentAsk.type === 'choice' && currentAsk.options.length > 0 ? (
                <div className="s-options">
                  {currentAsk.options.map((o, k) => (
                    <button key={k} className={`quiz-option${answer === o ? ' picked' : ''}`} onClick={() => setAnswer(o)}>
                      <span className="option-key">{String.fromCharCode(65 + k)}</span>
                      <span className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(o, env).trim().replace(/^<p[^>]*>|<\/p>$/g, '') }} />
                    </button>
                  ))}
                </div>
              ) : currentAsk.type === 'code' ? (
                <>
                  <CodeEditor value={code} onChange={setCode} language={currentAsk.lang ?? options?.language ?? 'python'} onSubmit={() => submit()} />
                  <div className="s-run-row">
                    <button className="btn small" onClick={runMine} disabled={running || !code.trim()} title="Run your code in a sandbox">
                      <Icon name="play" size={12} />
                      {running ? 'Running…' : 'Run'}
                    </button>
                    <span className="muted small">Try your solution here.</span>
                  </div>
                  {runOut && (
                    <pre className={`run-output s-run-output${runOut.exitCode !== 0 || runOut.timedOut ? ' failed' : ''}`} data-meta={runOut.timedOut ? 'timed out' : `exit ${runOut.exitCode}, ${runOut.durationMs} ms`}>
                      {(runOut.stdout + (runOut.stderr ? (runOut.stdout ? '\n' : '') + runOut.stderr : '')) || 'Ran with no output.'}
                    </pre>
                  )}
                  <textarea className="s-input small" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Explain your code or approach (optional)" />
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
                    currentAsk.type === 'predict'
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
                  {currentAsk.type !== 'choice' && currentAsk.type !== 'code' && (
                    <DictateButton
                      target={answerRef}
                      onStart={stopTalking}
                      onText={talk ? (said) => send(`Answer: ${said}`, turns) : undefined}
                    />
                  )}
                  {!timed && (
                    <button className="tool-btn" onClick={askHint} title="Get the smallest hint that helps">
                      <Icon name="sparkle" />
                      <span>{HINT_LEVELS[Math.min(hintLevel, 3)]}</span>
                    </button>
                  )}
                  <button className="tool-btn" onClick={() => submit("I don't know.")}>
                    <span>I don't know</span>
                  </button>
                  <button className="btn primary" onClick={() => submit()} disabled={currentAsk.type === 'code' ? !code.trim() : !answer.trim()}>
                    Submit <kbd>⌘↵</kbd>
                  </button>
                </div>
              </div>
            </div>
          )}

          {finished && (
            <div className="row-gap s-finish">
              <button className="btn primary" onClick={() => send(openingMessage(setup), [])}>
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
      {withNotes && (
        <LessonNotes
          topic={topic}
          scope={scope}
          takeaways={takeaways}
          busy={busy}
          onCheck={(words) => send(`Here is my explanation in my own words:\n\n${words}\n\nCheck it against what we covered: what is right, what is missing or wrong, and one question to push me further.`, turns)}
        />
      )}
      </div>
    </div>
  )
}
