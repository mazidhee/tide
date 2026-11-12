import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BREAK_TIPS, canReprieve, onBreak, restedLine, type BreakSettings } from '@shared/breaks'
import { breakActions, recallNow, rhythmNow, useBreakStore, whereNow } from '../lib/breaks'
import { useStudying } from '../lib/studying'
import { chime } from '../lib/focus'
import { Professor } from './Professor'

/**
 * The tutor's tea break (shared/breaks, shared/breakPlanner): a heads-up a little before, then at
 * the moment the planner picks, the whole window rests behind a veil with the Professor sipping
 * tea, a countdown, one honest line on why now, and a tip. Tide can't be used until it ends;
 * nothing underneath is touched, so the lesson is exactly where it was. "I need Tide right now"
 * gives ten minutes for a typed reason, once. After it, a welcome back with one question from the lesson.
 */
export function BreakScreen({ settings }: { settings: BreakSettings }) {
  const { state, ui } = useBreakStore()
  const [now, setNow] = useState(Date.now())
  const resting = onBreak(state, now)
  const welcome = !resting && !!state.welcome && now - state.welcome.at < 30 * 60_000
  const showing = resting || welcome

  useEffect(() => {
    if (!resting) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [resting])
  // Re-read the clock whenever the state changes (a break starting, or one ending in another window)
  useEffect(() => setNow(Date.now()), [state])

  // The chime when the break ends
  const was = useRef(resting)
  useEffect(() => {
    if (was.current && !resting && state.welcome) chime()
    was.current = resting
  }, [resting, state.welcome])

  useStudying('break', resting ? { pose: 'tea', label: 'Tea break', until: state.breakUntil } : null)

  // Nothing behind the veil can be reached: the app is inert, and no shortcut gets through
  useEffect(() => {
    if (!showing) return
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const stop = (e: KeyboardEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.tea-veil')) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', stop, true)
    return () => {
      root?.removeAttribute('inert')
      window.removeEventListener('keydown', stop, true)
    }
  }, [showing])

  return (
    <>
      {!showing && ui.headsUp && <HeadsUp line={ui.headsUp} />}
      {!showing && ui.offer && <Offer {...ui.offer} />}
      {showing && createPortal(resting ? <Resting settings={settings} now={now} /> : <Welcome minutes={state.welcome!.minutes} />, document.body)}
    </>
  )
}

/** "Tea in about 10 minutes. I'll stop at the end…": the first sentence as its title */
const split = (line: string) => {
  const m = line.match(/^(.+?[.!?])\s+(.+)$/)
  return m ? { title: m[1].replace(/\.$/, ''), body: m[2] } : { title: line, body: '' }
}

function HeadsUp({ line }: { line: string }) {
  useEffect(() => {
    const t = setTimeout(breakActions.dismissHeadsUp, 20_000)
    return () => clearTimeout(t)
  }, [line])
  const { title, body } = split(line)
  return (
    <div className="tea-toast" role="status">
      <Professor state="tea" size={34} />
      <div>
        <strong>{title}</strong>
        <span>{/mid-answer|answered/.test(body) ? body : `${body} Nothing will be cut off mid-answer.`.trim()}</span>
      </div>
      <button className="tea-toast-x" onClick={breakActions.dismissHeadsUp} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

function Offer({ minutes, line }: { studied: number; minutes: number; line: string }) {
  return (
    <div className="tea-toast offer" role="status">
      <Professor state="tea" size={34} />
      <div>
        <strong>A {minutes}-minute tea break?</strong>
        <span>{line}</span>
        <div className="tea-toast-row">
          <button className="btn small primary" onClick={breakActions.takeOffer}>
            Take it now
          </button>
          <button className="btn small ghost" onClick={breakActions.keepGoing}>
            Keep going
          </button>
        </div>
      </div>
    </div>
  )
}

const RING = 2 * Math.PI * 60

function Resting({ settings, now }: { settings: BreakSettings; now: number }) {
  const { state } = useBreakStore()
  const total = (state.breakUntil ?? now) - (state.breakStart ?? now)
  const left = Math.max(0, (state.breakUntil ?? now) - now)
  const tip = BREAK_TIPS[Math.floor((now - (state.breakStart ?? now)) / 15_000) % BREAK_TIPS.length]
  // Where the lesson stopped, read once when the break begins
  const where = useMemo(() => whereNow(), [state.breakStart])
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState('')
  const can = canReprieve(state, now, settings)
  const mm = Math.floor(left / 60_000)
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')
  const minutesWord = settings.strictness === 'strict' ? 'once today' : 'once this hour'

  return (
    <div className="tea-veil" role="dialog" aria-modal="true" aria-labelledby="tea-title">
      <div className="tea-card">
        <div className="tea-scene">
          <Professor state="tea" size={150} title="The Professor, sipping tea" />
        </div>
        <h1 id="tea-title">Tea break</h1>
        <p className="tea-why">{state.line || `You've studied for ${state.studied ?? 60} minutes straight. Your brain stores what you learned while you rest, so this is part of the lesson.`}</p>
        <div className="tea-ring" role="timer" aria-label={`${mm} minutes ${ss} seconds left`}>
          <svg viewBox="0 0 132 132" aria-hidden="true">
            <circle className="track" cx="66" cy="66" r="60" />
            <circle className="fill" cx="66" cy="66" r="60" strokeDasharray={RING} strokeDashoffset={total ? RING * (1 - left / total) : 0} />
          </svg>
          <span>
            {mm}:{ss}
          </span>
        </div>
        <p className="tea-tip" key={tip}>
          {tip}
        </p>
        <p className="tea-kept">{where ? `Your lesson is saved exactly where you left it: ${where}${/[”….]$/.test(where) ? '' : '.'}` : 'Everything is saved exactly where you left it.'}</p>
        {state.skippable ? (
          <button className="tea-hatch" onClick={breakActions.skip}>
            Skip this break
          </button>
        ) : can && !asking ? (
          <button className="tea-hatch" onClick={() => setAsking(true)}>
            I need Tide right now
          </button>
        ) : null}
        {asking && can && (
          <form
            className="tea-ask"
            onSubmit={(e) => {
              e.preventDefault()
              if (why.trim()) breakActions.reprieve(why, settings)
            }}
          >
            <label htmlFor="tea-why">What can't wait? You get 10 minutes, {minutesWord}.</label>
            <textarea id="tea-why" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} rows={2} />
            <div className="tea-ask-row">
              <button type="button" className="btn" onClick={() => (setAsking(false), setWhy(''))}>
                Keep resting
              </button>
              <button type="submit" className="btn primary" disabled={!why.trim()} aria-disabled={!why.trim()}>
                Give me 10 minutes
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Welcome({ minutes }: { minutes: number }) {
  const question = useMemo(() => recallNow(), [])
  const inLesson = useMemo(() => !!whereNow(), [])
  const next = rhythmNow().high
  return (
    <div className="tea-veil welcome" role="dialog" aria-modal="true" aria-labelledby="tea-title">
      <div className="tea-card">
        <div className="tea-scene">
          <Professor state="tea" size={150} />
        </div>
        <h1 id="tea-title">Welcome back</h1>
        <p className="tea-why">
          {restedLine(minutes)} Next break in about {next >= 55 ? 'an hour' : `${next} minutes`}, sooner if you tire.
        </p>
        {question && <p className="tea-tip">Quick warm-up: {question}</p>}
        <button className="btn primary tea-back" autoFocus onClick={breakActions.welcomed}>
          {inLesson ? 'Back to the lesson' : 'Back to Tide'}
        </button>
      </div>
    </div>
  )
}
