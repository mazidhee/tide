import { useCallback, useEffect, useRef, useState } from 'react'
import { advance, completeSentences, itemIdOf, nextAfter, planRound, START, type Cursor, type Line, type MockLoaded, type MockTurnRequest, type Move, type Next, type Persona, type TurnMark } from '@shared/interviewMock'
import { InterviewClock, useInterviewClock } from '../InterviewClock'
import { Icon } from '../Icon'
import { getFlow, useFlow } from '../Voice'
import { InterviewerVoice, LevelMeter, openMic, type Mic, type MicMode, type MicPiece } from './LiveMockAudio'

/** What the learner's side is doing */
type You = 'waiting' | 'listening' | 'speaking' | 'writing' | 'typing'

export interface CallResult {
  lines: Line[]
  totalMs: number
  /** Learner's turn end → first interviewer audio, ms, per reply */
  waits: number[]
  /** Request → first text from the interviewer, ms, per reply */
  firstText: number[]
  ended: 'done' | 'left'
}

const PRESENT_MS = 15 * 60_000
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** Room for one spoken answer; at the limit the interviewer moves on, as a real one would */
const ANSWER_MS = 3 * 60_000
/** A pause this long ends the turn on its own; shorter ones are thinking time */
const END_PAUSE_MS = 7000

const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
/** "No, that's everything" at the end: nothing to ask */
const nothingToAsk = (s: string) => s.split(/\s+/).length < 14 && /\b(no( questions)?|nope|not really|i think that'?s (all|everything|it)|that'?s (all|everything|it)|nothing (else|more))\b/i.test(s) && !/\?/.test(s)

/**
 * The call: the interviewer card with captions, the clock, the learner's mic and live transcript,
 * and (presenting) a talk timer and their slides. The round's flow is decided in code
 * (shared/interviewMock nextAfter/advance); each interviewer line is streamed from main and
 * spoken sentence by sentence as it arrives.
 */
export function LiveMockCall({
  loaded,
  persona,
  seed,
  micMode,
  scripted,
  slides,
  onDone
}: {
  loaded: MockLoaded
  persona: Persona
  seed: number
  micMode: MicMode
  scripted: boolean
  slides: { name: string; pages: string[]; image?: string } | null
  onDone(r: CallResult): void
}) {
  const { input } = loaded
  const plan = useRef(planRound(input, seed)).current
  const [lines, setLines] = useState<Line[]>([])
  const linesRef = useRef<Line[]>([])
  const cursor = useRef<Cursor>(START)
  const [stage, setStage] = useState<Cursor['stage']>('intro')
  const [caption, setCaption] = useState<{ now: string; before: string }>({
    now: '',
    before: ''
  })
  const [speaking, setSpeaking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [you, setYou] = useState<You>('waiting')
  const [live, setLive] = useState('')
  const [level, setLevel] = useState(0)
  const [typed, setTyped] = useState('')
  // Wispr Flow chosen for dictation: Flow listens and types into the answer box, and you send it
  const flow = useFlow()
  const [flowKey, setFlowKey] = useState('')
  const [typing, setTypingState] = useState(!loaded.voice || flow)
  const typingRef = useRef(typing)
  const setTyping = (v: boolean | ((t: boolean) => boolean)) =>
    setTypingState((t) => {
      const on = typeof v === 'function' ? v(t) : v
      typingRef.current = on
      // Switching mid-turn: the mic follows, and the badge says which
      if (yourTurn.current) {
        mic.current?.setActive(!on)
        setYou(on ? 'typing' : micMode === 'ptt' ? 'waiting' : 'listening')
      }
      return on
    })
  const [error, setError] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [slide, setSlide] = useState(0)
  const [presentStart, setPresentStart] = useState<number | null>(null)
  const [, tick] = useState(0)
  const t0 = useRef(0)
  const voice = useRef<InterviewerVoice | null>(null)
  const mic = useRef<Mic | null>(null)
  const pieces = useRef<{ text: Promise<string>; wav: Uint8Array; start: number; end: number }[]>([])
  const yourTurn = useRef(false)
  const closing = useRef(false)
  const finished = useRef(false)
  const turnEndAt = useRef(0)
  const turnStart = useRef(0)
  const waits = useRef<number[]>([])
  const firstText = useRef<number[]>([])
  const streamId = useRef('')
  const canHear = loaded.voice

  const elapsed = () => (t0.current ? performance.now() - t0.current : 0)
  const push = (l: Line) => {
    linesRef.current = [...linesRef.current, l]
    setLines(linesRef.current)
  }

  const finish = useCallback(
    (ended: 'done' | 'left') => {
      if (finished.current) return
      finished.current = true
      voice.current?.stop()
      mic.current?.stop()
      if (streamId.current) void window.tide.interviewMock.cancel(streamId.current)
      onDone({
        lines: linesRef.current,
        totalMs: elapsed(),
        waits: waits.current,
        firstText: firstText.current,
        ended
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDone]
  )

  const clock = useInterviewClock(input.round.minutes, () => {
    // At time: the interviewer closes as soon as they're not mid-sentence
    if (!closing.current && !finished.current) {
      closing.current = true
      if (yourTurn.current) void endTurn(true)
    }
  })

  /** Learner's turn starts: the mic listens */
  const listen = () => {
    yourTurn.current = true
    turnStart.current = performance.now()
    pieces.current = []
    setLive('')
    setYou(typingRef.current || !canHear ? 'typing' : micMode === 'ptt' ? 'waiting' : 'listening')
    mic.current?.setAutoEnd(cursor.current.stage !== 'presenting')
    // Typing: the mic stays off, so nothing it hears mixes into the answer
    mic.current?.setActive(!typingRef.current)
  }

  /** One interviewer line, streamed and spoken */
  const say = async (next: Next) => {
    yourTurn.current = false
    mic.current?.setActive(false)
    setYou('waiting')
    setThinking(true)
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    streamId.current = id
    const v = voice.current!
    v.begin()
    const asked = performance.now()
    let text = ''
    let upTo = 0
    let gotFirst = false
    const at = elapsed()
    const done = new Promise<{ mark: TurnMark; text: string }>((resolve) => {
      const off = window.tide.interviewMock.onDelta((d) => {
        if (d.id !== id) return
        if ('done' in d) {
          off()
          if (d.error) setError(d.error)
          // Speak whatever is left
          const rest = d.text.slice(upTo).trim()
          if (rest) v.say(rest)
          resolve({ mark: d.mark, text: d.text })
          return
        }
        if (!gotFirst) ((gotFirst = true), firstText.current.push(performance.now() - asked))
        text += d.text
        const s = completeSentences(text, upTo)
        upTo = s.upTo
        for (const x of s.sentences) v.say(x)
      })
    })
    const req: MockTurnRequest = {
      id,
      slug: input.slug,
      round: input.round.id,
      next,
      lines: linesRef.current,
      persona,
      elapsedMs: at,
      seed,
      scripted
    }
    window.tide.interviewMock.turn(req).catch((e) => setError(clean(e)))
    const r = await done
    setThinking(false)
    if (finished.current) return
    const move: Move = r.mark === 'follow-up' || r.mark === 'probe' ? 'follow-up' : r.mark === 'clarify' ? 'clarify' : next.move === 'part' ? 'part' : next.move === 'present' ? 'ask' : next.move
    cursor.current = advance(plan, cursor.current, next, r.mark, at)
    setStage(cursor.current.stage)
    push({
      who: 'them',
      text: r.text,
      at,
      stage: cursor.current.stage,
      item: itemIdOf(plan, cursor.current),
      move
    })
    await v.idle()
    if (v.firstAudioAt && turnEndAt.current) waits.current.push(Math.round(v.firstAudioAt - turnEndAt.current))
    const last = linesRef.current[linesRef.current.length - 1]
    if (last) last.end = elapsed()
    if (finished.current) return
    if (r.mark === 'close' || next.move === 'close') return finish('done')
    // The clock ran out while they were speaking: close now
    if (closing.current) return say({ move: 'close', reason: 'time' })
    if (cursor.current.stage === 'presenting') setPresentStart(performance.now())
    listen()
  }

  /** The learner's turn ends: what they said becomes a line, then the interviewer goes on */
  const endTurn = async (forced = false) => {
    if (!yourTurn.current && !forced) return
    if (finished.current) return
    yourTurn.current = false
    mic.current?.flush()
    mic.current?.setActive(false)
    turnEndAt.current = performance.now()
    const typedText = typed.trim()
    let text = typedText
    let start = 0
    let end = 0
    if (!typedText && pieces.current.length) {
      setYou('writing')
      // The whole answer read again in one go is more accurate than the live pieces; they stand in if it fails
      const quick = async () => (await Promise.all(pieces.current.map((p) => p.text))).join(' ')
      const full = window.tide.voice.transcribeAnswer(
        pieces.current.map((p) => p.wav),
        { topic: input.company || undefined }
      )
      const late = new Promise<string>((_, no) => setTimeout(() => no(new Error('slow')), 30_000))
      const got = await Promise.race([full, late]).then((t) => t.trim() || quick()).catch(quick)
      text = got.replace(/\s+/g, ' ').trim()
      start = pieces.current[0].start - t0.current
      end = pieces.current[pieces.current.length - 1].end - t0.current
    }
    turnEndAt.current = performance.now()
    if (!text && !forced) {
      // Nothing heard: keep listening
      listen()
      return
    }
    if (text) {
      // Typed: timed as if said at 150 words a minute, but never before the interviewer stopped
      const prev = linesRef.current[linesRef.current.length - 1]
      const floor = prev ? (prev.end ?? prev.at) : 0
      const at = typedText ? Math.max(floor, elapsed() - Math.round((typedText.split(/\s+/).length / 150) * 60_000)) : Math.max(floor, start)
      push({
        who: 'you',
        text,
        at,
        end: typedText ? elapsed() : end,
        stage: cursor.current.stage,
        item: itemIdOf(plan, cursor.current),
        typed: !!typedText || undefined
      })
    }
    setTyped('')
    setLive('')
    pieces.current = []
    if (cursor.current.stage === 'presenting') setPresentStart(null)
    if (closing.current) return say({ move: 'close', reason: 'time' })
    const next = cursor.current.stage === 'ask-them' && text && nothingToAsk(text) ? ({ move: 'close', reason: 'done' } as const) : nextAfter(plan, cursor.current, elapsed())
    void say(next)
  }
  const endRef = useRef(endTurn)
  endRef.current = endTurn

  // Start: voice and mic, the clock, the opening line
  useEffect(() => {
    let dead = false
    voice.current = new InterviewerVoice(persona.voice, loaded.voice)
    voice.current.onSentence = (s) => {
      setSpeaking(true)
      setCaption((c) => ({ before: c.now, now: s }))
    }
    voice.current.onIdle = () => setSpeaking(false)
    const start = () => {
      // The mic opens alongside the opening line, so a permission prompt never holds the call up
      if (canHear)
        openMic({
          mode: micMode,
          endSilenceMs: END_PAUSE_MS,
          onPiece: (p: MicPiece) => {
            if (!yourTurn.current) return
            const text = window.tide.voice
              .transcribe(p.wav, { topic: input.company || undefined })
              .then((t) => t.trim())
              .catch((e) => (setError(clean(e)), ''))
            pieces.current.push({ text, wav: p.wav, start: p.start, end: p.end })
            void text.then((t) => t && setLive((cur) => (cur ? `${cur} ${t}` : t)))
          },
          onEnd: () => void endRef.current(),
          onSpeech: (on) => yourTurn.current && !typingRef.current && setYou(on ? 'speaking' : 'listening')
        })
          .then((m) => {
            if (dead) return m.stop()
            mic.current = m
            if (yourTurn.current) (m.setAutoEnd(cursor.current.stage !== 'presenting'), m.setActive(!typingRef.current))
          })
          .catch(() => {
            setTyping(true)
            if (yourTurn.current) setYou('typing')
            setError('Tide can’t use the microphone, so type your answers. Allow it in System Settings › Privacy & Security › Microphone.')
          })
      t0.current = performance.now()
      clock.start()
      void say({ move: 'open' })
    }
    void start()
    let raf = 0
    const meter = () => {
      if (mic.current) setLevel((l) => l * 0.55 + mic.current!.level() * 0.45)
      raf = requestAnimationFrame(meter)
    }
    meter()
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      dead = true
      cancelAnimationFrame(raf)
      clearInterval(timer)
      voice.current?.stop()
      mic.current?.stop()
      if (streamId.current) void window.tide.interviewMock.cancel(streamId.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The talk's own limit: at fifteen minutes (less in a short round) the assessor stops them
  const presentItem = plan.items.find((i) => i.type === 'present')
  const presentLimit = presentItem?.type === 'present' ? presentItem.limitMs : PRESENT_MS
  useEffect(() => {
    if (stage === 'presenting' && presentStart && performance.now() - presentStart > presentLimit && yourTurn.current) void endTurn(true)
  })

  // With Flow the box has the cursor on every turn, so holding the Flow key just works
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (flow) void getFlow().then((f) => setFlowKey(f.pushToTalk))
  }, [flow])
  useEffect(() => {
    if (typing && yourTurn.current) box.current?.focus()
  }, [you, typing])

  // An answer's own limit: three minutes, then the interviewer moves on
  useEffect(() => {
    if (yourTurn.current && stage !== 'presenting' && !typingRef.current && turnStart.current && performance.now() - turnStart.current > ANSWER_MS) void endTurn(true)
  })

  // Push-to-talk: hold Space. Enter (not typing) ends the turn.
  useEffect(() => {
    const typingInBox = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('textarea, input')
    const down = (e: KeyboardEvent) => {
      if (typingInBox(e)) return
      if (e.code === 'Space' && micMode === 'ptt' && yourTurn.current && !e.repeat) {
        e.preventDefault()
        mic.current?.setHeld(true)
        setYou('speaking')
      } else if (e.key === 'Enter' && yourTurn.current) {
        e.preventDefault()
        void endRef.current()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && micMode === 'ptt' && yourTurn.current) {
        e.preventDefault()
        mic.current?.setHeld(false)
        // A short wait for the last piece, then the turn ends
        setTimeout(() => void endRef.current(), 250)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [micMode])

  const presenting = stage === 'presenting'
  const presentMs = presenting && presentStart ? performance.now() - presentStart : 0
  const answerMs = yourTurn.current && !presenting && turnStart.current ? performance.now() - turnStart.current : 0
  const yourLine = yourTurn.current
  const stageLabel = presenting ? 'Your presentation' : stage === 'qa' ? 'Questions on your talk' : stage === 'scenario' ? 'Scenario' : stage === 'ask-them' ? 'Your questions' : stage === 'close' ? 'Closing' : stage === 'intro' ? 'Introductions' : 'Questions'
  const youLabel: Record<You, string> = {
    waiting: micMode === 'ptt' && yourLine ? 'Hold Space to talk' : 'Waiting for your turn',
    listening: presenting ? 'Listening to your talk' : 'Listening',
    speaking: 'Hearing you',
    writing: 'Writing it down…',
    typing: flow ? 'Answer with Flow' : 'Type your answer'
  }

  return (
    <div className={`lm-call${showTranscript ? ' with-transcript' : ''}`}>
      <header className="lm-call-head">
        <div className="lm-call-title">
          <span className="lm-live-dot" aria-hidden="true" />
          <span>{input.round.name}</span>
          <span className="lm-muted">· {stageLabel}</span>
        </div>
        <div className="lm-call-tools">
          <InterviewClock remaining={clock.remaining} total={input.round.minutes} />
          <button className={`btn small ghost${showTranscript ? ' on' : ''}`} onClick={() => setShowTranscript((s) => !s)} aria-pressed={showTranscript}>
            <Icon name="list" size={14} />
            Transcript
          </button>
          <button className="btn small lm-leave" onClick={() => finish('left')}>
            End call
          </button>
        </div>
      </header>

      <div className="lm-call-body">
        <section className={`lm-stage${presenting && slides ? ' has-slides' : ''}`} aria-live="off">
          {presenting && slides ? (
            <div className="lm-slides" aria-label={`Your slides: ${slides.name}`}>
              {slides.image ? (
                <img src={slides.image} alt={slides.name} />
              ) : (
                <>
                  <div className="lm-slide">
                    <pre>{slides.pages[slide] || ' '}</pre>
                  </div>
                  <div className="lm-slide-nav">
                    <button className="icon-btn" onClick={() => setSlide((s) => Math.max(0, s - 1))} disabled={slide === 0} aria-label="Previous slide">
                      <Icon name="back" size={14} />
                    </button>
                    <span>
                      {slide + 1} / {slides.pages.length}
                    </span>
                    <button className="icon-btn" onClick={() => setSlide((s) => Math.min(slides.pages.length - 1, s + 1))} disabled={slide >= slides.pages.length - 1} aria-label="Next slide">
                      <Icon name="chevron" size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          <div className={`lm-person${speaking ? ' speaking' : ''}${thinking && !speaking ? ' thinking' : ''}`}>
            <div className="lm-avatar" aria-hidden="true">
              <span>{initials(persona.name)}</span>
            </div>
            <div className="lm-person-name">{persona.name}</div>
            <div className="lm-person-role">
              {persona.title}, {persona.area}
            </div>
          </div>
          <div className="lm-captions" aria-live="polite">
            {caption.before && <p className="lm-cap-before">{caption.before}</p>}
            <p className="lm-cap-now">{caption.now || (thinking ? ' ' : '')}</p>
          </div>
          {presenting && (
            <div className="lm-present-timer" role="timer" aria-label="Time presenting">
              <span className={presentMs > 13 * 60_000 ? 'low' : ''}>{fmt(presentMs)}</span>
              <span className="lm-muted"> / 15:00</span>
            </div>
          )}
        </section>

        {showTranscript && (
          <aside className="lm-transcript" aria-label="Transcript so far">
            {lines.length === 0 && <p className="lm-muted">Nothing said yet.</p>}
            {lines.map((l, i) => (
              <p key={i} className={`lm-tline ${l.who}`}>
                <span className="lm-tline-who">{l.who === 'them' ? persona.name.split(' ')[0] : 'You'}</span>
                <span className="lm-tline-at">{fmt(l.at)}</span>
                <span className="lm-tline-text">{l.text}</span>
              </p>
            ))}
          </aside>
        )}
      </div>

      <footer className={`lm-you is-${you}`}>
        <div className="lm-you-state">
          <span className="lm-you-badge">
            <Icon name={typing ? 'keyboard' : 'mic'} size={14} />
            {youLabel[you]}
          </span>
          {!typing && canHear && <LevelMeter level={yourLine ? level : 0} />}
          {yourLine && !presenting && (
            <span className="lm-answer-timer" role="timer" aria-label="Time on this answer">
              <span className={answerMs > ANSWER_MS - 30_000 ? 'low' : ''}>{fmt(answerMs)}</span>
              <span className="lm-muted"> / {fmt(ANSWER_MS)}</span>
            </span>
          )}
        </div>
        <div className="lm-you-main">
          {typing ? (
            <textarea
              className="lm-type"
              ref={box}
              placeholder={
                !yourLine
                  ? 'Wait for the question…'
                  : flow
                    ? `Hold ${flowKey || 'your Flow key'} and answer; Flow types it here. Take your time, then press Enter.`
                    : presenting
                      ? 'Type your talk, or paste your notes'
                      : 'Type your answer. Enter sends, Shift+Enter for a new line.'
              }
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (typed.trim()) void endTurn()
                }
              }}
              rows={2}
              disabled={!yourLine}
              autoFocus
            />
          ) : (
            <p className={`lm-live${live ? '' : ' empty'}`}>
              {live || (yourLine ? (micMode === 'ptt' ? 'Hold Space and answer. Let go when you’re done.' : presenting ? 'Present when you’re ready. Press “I’ve finished” at the end.' : 'Answer out loud and take your time. Press Done or Enter when you’ve finished; a long pause also ends your turn.') : ' ')}
            </p>
          )}
        </div>
        <div className="lm-you-actions">
          {canHear && (
            <button className="link-btn small" onClick={() => setTyping((t) => !t)}>
              {typing ? 'Speak instead' : 'Type instead'}
            </button>
          )}
          <button className="btn primary small" onClick={() => void endTurn()} disabled={!yourLine || you === 'writing'}>
            {presenting ? 'I’ve finished' : 'Done'}
          </button>
        </div>
      </footer>
      {error && (
        <div className="lm-error" role="status">
          {error}
          <button className="link-btn small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
