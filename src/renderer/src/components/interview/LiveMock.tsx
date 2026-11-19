import { useCallback, useEffect, useState } from 'react'
import { deltas, type MockAttempt, type MockLoaded, type MockTargetSummary, type Persona } from '@shared/interviewMock'
import { useApp } from '../../state'
import { setMockPhase } from '../../lib/mockPhase'
import { Icon } from '../Icon'
import { LiveMockBrief, type BriefChoice } from './LiveMockBrief'
import { LiveMockCall, type CallResult } from './LiveMockCall'
import { LiveMockDebrief } from './LiveMockDebrief'
import { LiveMockHistory } from './LiveMockHistory'
import '../../styles/liveMock.css'

type Phase =
  | { at: 'loading' }
  | { at: 'error'; message: string }
  | { at: 'history' }
  | { at: 'brief' }
  | { at: 'call'; persona: Persona; seed: number; choice: BriefChoice }
  | { at: 'marking'; persona: Persona; result: CallResult }
  | {
      at: 'debrief'
      attempt: MockAttempt
      delta?: ReturnType<typeof deltas>
      waits?: number[]
    }

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * A live mock round for an interview target: the pre-brief, the call, marking, the debrief, and
 * the target's history of mocks. `round` empty opens the history, where a round is picked.
 */
export function LiveMock({ slug, round }: { slug: string; round: string }) {
  const app = useApp()
  const [target, setTarget] = useState<MockTargetSummary | null>(null)
  const [loaded, setLoaded] = useState<MockLoaded | null>(null)
  const [phase, setPhase] = useState<Phase>({ at: 'loading' })

  const load = useCallback(async () => {
    try {
      const targets = await window.tide.interviewMock.targets()
      const t = targets.find((x) => x.slug === slug) ?? null
      setTarget(t)
      if (!t)
        return setPhase({
          at: 'error',
          message: 'That interview target isn’t in your notes. It lives in “Interview prep/<name>/target.md”.'
        })
      const l = await window.tide.interviewMock.load(slug, round || t.rounds[0]?.id || '')
      setLoaded(l)
      setPhase(round && t.rounds.some((r) => r.id === round) ? { at: 'brief' } : { at: 'history' })
    } catch (e) {
      setPhase({ at: 'error', message: clean(e) })
    }
  }, [slug, round])

  useEffect(() => void load(), [load])

  // A call in progress is focus mode: the sidebar steps away and no break interrupts it
  useEffect(() => {
    const title = loaded?.input.round.name ?? 'Live mock'
    setMockPhase(phase.at === 'call' ? { phase: 'live', title } : phase.at === 'marking' ? { phase: 'marking', title } : null)
  }, [phase.at, loaded])
  useEffect(() => () => setMockPhase(null), [])

  const start = async (choice: BriefChoice) => {
    if (!loaded) return
    const seed = Date.now() % 1_000_000_007
    const persona = await window.tide.interviewMock.persona(slug, loaded.input.round.id, seed, loaded.tutorVoice)
    setPhase({ at: 'call', persona, seed, choice })
  }

  const done = async (r: CallResult, persona: Persona, seed: number, scripted: boolean) => {
    if (!loaded) return
    if (!r.lines.some((l) => l.who === 'you')) return setPhase({ at: 'brief' })
    setPhase({ at: 'marking', persona, result: r })
    // For the test copy's checks: how quickly the interviewer answered
    if (window.tide.app.testCopy) (window as unknown as { __liveMock: unknown }).__liveMock = { waits: r.waits, firstText: r.firstText, lines: r.lines.length }
    try {
      const { attempt, delta } = await window.tide.interviewMock.mark({
        slug,
        round: loaded.input.round.id,
        seed,
        persona,
        lines: r.lines,
        totalMs: r.totalMs,
        scripted
      })
      setLoaded((l) => (l ? { ...l, history: [...l.history, attempt] } : l))
      setPhase({ at: 'debrief', attempt, delta, waits: r.waits })
    } catch (e) {
      setPhase({
        at: 'error',
        message: `Couldn’t mark the round: ${clean(e)}`
      })
    }
  }

  const back = () => app.setView({ kind: 'interview-mock', slug, round: '' })

  return (
    <div className={`lm-view lm-at-${phase.at}`}>
      {phase.at !== 'call' && (
        <div className="lm-topbar">
          {round && phase.at !== 'history' ? (
            <button className="link-btn small" onClick={back}>
              <Icon name="back" size={13} /> {target?.name ?? 'Live mocks'}
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
      {phase.at === 'loading' && <div className="view-loading" aria-busy="true" />}
      {phase.at === 'error' && (
        <div className="lm-brief">
          <p className="lm-warn">{phase.message}</p>
          <button className="btn small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {phase.at === 'history' && target && loaded && (
        <LiveMockHistory
          title={target.name}
          rounds={target.rounds}
          attempts={loaded.history}
          onRound={(id) => app.setView({ kind: 'interview-mock', slug, round: id })}
          onOpen={(a) =>
            setPhase({
              at: 'debrief',
              attempt: a,
              delta: deltas(loaded.history, a)
            })
          }
        />
      )}
      {phase.at === 'brief' && loaded && <LiveMockBrief loaded={loaded} onStart={(c) => void start(c)} />}
      {phase.at === 'call' && loaded && (
        <LiveMockCall loaded={loaded} persona={phase.persona} seed={phase.seed} micMode={phase.choice.micMode} scripted={phase.choice.scripted} slides={phase.choice.slides} onDone={(r) => void done(r, phase.persona, phase.seed, phase.choice.scripted)} />
      )}
      {phase.at === 'marking' && (
        <div className="lm-brief lm-marking" aria-busy="true">
          <p className="lm-eyebrow">Call ended · {Math.round(phase.result.totalMs / 60_000)} minutes</p>
          <h1 className="page-title">Marking your round</h1>
          <p className="lm-muted">{loaded?.claude ? 'Claude is reading the transcript the way a recruiter would. This takes under a minute.' : 'Tide is marking the transcript.'}</p>
          <div className="lm-marking-bar" aria-hidden="true">
            <span />
          </div>
        </div>
      )}
      {phase.at === 'debrief' && (
        <LiveMockDebrief
          attempt={phase.attempt}
          delta={phase.delta}
          waits={phase.waits}
          onAgain={() =>
            round && phase.attempt.round === loaded?.input.round.id
              ? setPhase({ at: 'brief' })
              : app.setView({
                  kind: 'interview-mock',
                  slug,
                  round: phase.attempt.round
                })
          }
          onHistory={() => (round ? back() : setPhase({ at: 'history' }))}
        />
      )}
    </div>
  )
}
