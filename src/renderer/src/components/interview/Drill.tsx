import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CRITERIA,
  areaOfQuestion,
  attemptOf,
  mmss,
  spokenSeconds,
  targetWindow,
  type Area,
  type DrillKind,
  type MarkInput,
  type MarkResult,
  type Progress,
  type TargetBundle
} from '@shared/interviewTarget'
import { aiTells } from '@shared/humanWriting'
import { record } from '../../lib/voice'
import { renderMarkdown } from '../../lib/markdown'
import { Icon } from '../Icon'

/**
 * One drill on one item of a target, answered typed or spoken: the question (and in CV defence,
 * one or two deeper probes; in a scenario, its parts one at a time), then marks per criterion,
 * what was missed, and the model answer. Each attempt is saved and moves readiness.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Answer by voice: records, times, writes it out on this Mac */
function useRecorder() {
  const [state, setState] = useState<'idle' | 'listening' | 'writing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [hint, setHint] = useState('')
  const rec = useRef<Awaited<ReturnType<typeof record>> | null>(null)
  const started = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(
    () => () => {
      rec.current?.cancel()
      clearInterval(timer.current)
    },
    []
  )
  const start = async () => {
    setHint('')
    const ready = await window.tide.voice
      .status()
      .then((s) => s.ready)
      .catch(() => false)
    const deepgram = await window.tide.voice.hasDeepgram().catch(() => false)
    if (!ready && !deepgram) {
      setHint('Set up the natural voice in Settings › Voice to answer aloud. You can type for now.')
      return false
    }
    try {
      rec.current = await record()
    } catch {
      setHint('Tide can’t use the microphone. Allow it in System Settings › Privacy & Security › Microphone.')
      return false
    }
    started.current = Date.now()
    setElapsed(0)
    timer.current = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250)
    setState('listening')
    return true
  }
  /** The words and how long they took to say */
  const stop = async (): Promise<{ text: string; seconds: number } | null> => {
    clearInterval(timer.current)
    const r = rec.current
    rec.current = null
    if (!r) return null
    const seconds = (Date.now() - started.current) / 1000
    setState('writing')
    try {
      const text = (await window.tide.voice.transcribe(await r.stop(), {})).trim()
      if (!text) setHint('I didn’t catch that. Try again a little closer to the microphone.')
      return text ? { text, seconds } : null
    } catch (e) {
      setHint(clean(e))
      return null
    } finally {
      setState('idle')
    }
  }
  return { state, elapsed, hint, start, stop }
}

/** How long it ran against the window it should land in */
function TimeBar({ seconds, window: [lo, hi], spoken }: { seconds: number; window: [number, number]; spoken: boolean }) {
  const max = hi * 1.4
  const tone = seconds < lo ? 'short' : seconds > hi ? 'long' : 'ok'
  return (
    <div className={`it-time is-${tone}`} title={`Aim for ${mmss(lo)} to ${mmss(hi)}`}>
      <span className="it-time-label tabular">
        {spoken ? 'Spoken' : 'About'} {mmss(seconds)}
        <span className="muted"> · aim {mmss(lo)}–{mmss(hi)}</span>
      </span>
      <span className="it-time-track" aria-hidden="true">
        <span className="it-time-window" style={{ left: `${(lo / max) * 100}%`, width: `${((hi - lo) / max) * 100}%` }} />
        <span className="it-time-fill" style={{ width: `${Math.min(100, (seconds / max) * 100)}%` }} />
      </span>
    </div>
  )
}

/** The answer box: type, or speak (the words land in the box, the time is kept) */
function AnswerBox({ drill, minutes, value, onChange, seconds, onSeconds, placeholder, busy }: { drill: DrillKind; minutes?: number; value: string; onChange(v: string): void; seconds: number | null; onSeconds(s: number | null): void; placeholder: string; busy?: boolean }) {
  const rec = useRecorder()
  const win = targetWindow({ drill, minutes })
  const shown = rec.state === 'listening' ? rec.elapsed : seconds ?? spokenSeconds(value)
  return (
    <div className="it-answer">
      <textarea
        className="it-answer-text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (!e.target.value.trim()) onSeconds(null)
        }}
        placeholder={placeholder}
        rows={drill === 'talk' ? 10 : 6}
        disabled={busy || rec.state !== 'idle'}
      />
      <div className="it-answer-tools">
        <button
          type="button"
          className={`tool-btn it-speak is-${rec.state}`}
          disabled={busy || rec.state === 'writing'}
          onClick={async () => {
            if (rec.state === 'listening') {
              const r = await rec.stop()
              if (r) {
                onChange((value.trim() ? value.trimEnd() + ' ' : '') + r.text)
                onSeconds((seconds ?? 0) + r.seconds)
              }
            } else await rec.start()
          }}
        >
          <Icon name={rec.state === 'listening' ? 'stop' : 'mic'} size={14} />
          <span>{rec.state === 'listening' ? `Stop · ${mmss(rec.elapsed)}` : rec.state === 'writing' ? 'Writing it down…' : 'Answer aloud'}</span>
        </button>
        {(shown > 0 || rec.state === 'listening') && <TimeBar seconds={shown} window={win} spoken={rec.state === 'listening' || seconds !== null} />}
      </div>
      {rec.hint && <p className="it-hint">{rec.hint}</p>}
    </div>
  )
}

/** Marks per criterion, as thin bars with their values */
export function MarkBars({ drill, mark }: { drill: DrillKind; mark: MarkResult }) {
  return (
    <ul className="it-bars compact">
      {CRITERIA[drill].map((c) => {
        const v = mark.marks[c.id]
        if (v === undefined) return null
        return (
          <li key={c.id} className="it-bar-row">
            <span className="it-bar-label">{c.label}</span>
            <span className="it-bar-track" aria-hidden="true">
              <span className="it-bar-fill" style={{ width: `${Math.max(2, v * 100)}%` }} />
            </span>
            <span className="it-bar-value tabular">{Math.round(v * 100)}%</span>
          </li>
        )
      })}
    </ul>
  )
}

interface Spec {
  drill: DrillKind
  area: Area
  item: string
  /** What the interviewer asks */
  question: string
  eyebrow: string
  input: Omit<MarkInput, 'answer' | 'seconds' | 'question' | 'drill'>
  model?: string
  /** CV defence: what the learner's real facts say */
  facts?: string[]
  gaps?: string[]
}

/** What a drill item is, from the bundle */
function specOf(b: TargetBundle, drill: DrillKind, item: string): Spec | null {
  const f = b.files
  const [kind, id] = [item.split(':')[0], item.slice(item.indexOf(':') + 1)]
  const story = (sid: string) => f.stories.find((s) => s.id === sid)
  if (kind === 'q') {
    const q = f.questions.find((x) => x.id === id)
    if (!q) return null
    const stories = q.stories.map(story).filter((s) => !!s)
    const round = f.meta.rounds.find((r) => r.id === q.round)
    return {
      drill: q.kind === 'cv' ? 'cv' : 'behavioural',
      area: areaOfQuestion(q),
      item,
      question: q.text,
      eyebrow: [q.kind.replace('-', ' '), round?.name, q.source].filter(Boolean).join(' · '),
      input: { route: q.route, outline: q.outline, anchors: stories.flatMap((s) => s!.anchors), evidence: stories.flatMap((s) => s!.evidence) },
      model: q.model,
      facts: stories.flatMap((s) => s!.evidence),
      gaps: stories.flatMap((s) => s!.gaps)
    }
  }
  if (kind === 'story') {
    const s = story(id)
    if (!s) return null
    return {
      drill: 'cv',
      area: 'cv',
      item,
      question: `Talk me through this on your CV: ${s.title.charAt(0).toLowerCase() + s.title.slice(1)}.`,
      eyebrow: `CV defence · story ${s.id}`,
      input: { anchors: s.anchors, evidence: s.evidence },
      facts: s.evidence,
      gaps: s.gaps
    }
  }
  if (kind === 'scenario') {
    const c = f.scenarios.find((x) => x.id === id)
    return c ? { drill: 'scenario', area: 'scenarios', item, question: c.title, eyebrow: `Scenario ${c.id} · ${c.parts.length} parts`, input: { rubric: c.rubric } } : null
  }
  if (kind === 'assessor') {
    const a = f.presentation?.assessor.find((x) => x.id === id)
    return a ? { drill: 'assessor', area: 'presentation', item, question: a.question, eyebrow: 'Assessor question', input: { point: a.point }, model: a.point ? `**The point to make:** ${a.point}` : undefined } : null
  }
  if (item === 'talk' && f.presentation) return { drill: 'talk', area: 'presentation', item, question: f.presentation.topic || 'Your presentation', eyebrow: `Timed run · ${f.presentation.minutes} minutes`, input: { checklist: f.presentation.checklist.map((c) => c.text), minutes: f.presentation.minutes } }
  if (kind === 'ask') {
    const g = f.ask.groups.find((x) => x.who === id)
    return g ? { drill: 'ask', area: 'ask', item, question: `Questions for the ${g.who.toLowerCase()}`, eyebrow: 'Questions to ask', input: {} } : null
  }
  if (kind === 'firm') return { drill: 'firm', area: 'firm', item, question: 'Firm facts', eyebrow: 'Recall check', input: {} }
  return null
}

export function Drill({ slug, bundle, kind, item, onSaved, onClose, onNext }: { slug: string; bundle: TargetBundle; kind: DrillKind; item: string; onSaved(p: Progress): void; onClose(): void; onNext?: () => void }) {
  const spec = useMemo(() => specOf(bundle, kind, item), [bundle, kind, item])
  if (!spec) return <p className="muted">That item isn’t in the target’s files any more.</p>
  return (
    <section className="it-drill" aria-label={spec.question}>
      <button className="link-btn it-back" onClick={onClose}>
        <Icon name="back" size={13} />
        {bundle.files.meta.company}
      </button>
      {spec.drill === 'ask' ? (
        <AskDrill slug={slug} bundle={bundle} spec={spec} onSaved={onSaved} onClose={onClose} />
      ) : spec.drill === 'firm' ? (
        <FirmDrill slug={slug} bundle={bundle} spec={spec} onSaved={onSaved} onClose={onClose} />
      ) : (
        <AnswerDrill slug={slug} bundle={bundle} spec={spec} onSaved={onSaved} onClose={onClose} onNext={onNext} />
      )}
    </section>
  )
}

function AnswerDrill({ slug, bundle, spec, onSaved, onClose, onNext }: { slug: string; bundle: TargetBundle; spec: Spec; onSaved(p: Progress): void; onClose(): void; onNext?: () => void }) {
  const scenario = spec.drill === 'scenario' ? bundle.files.scenarios.find((c) => `scenario:${c.id}` === spec.item) : undefined
  const [turns, setTurns] = useState<{ q: string; a: string; seconds: number | null; by?: string }[]>([])
  const [current, setCurrent] = useState(spec.drill === 'scenario' ? scenario?.parts[0] ?? spec.question : spec.question)
  const [answer, setAnswer] = useState('')
  const [seconds, setSeconds] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  const [mark, setMark] = useState<MarkResult | null>(null)
  const [showModel, setShowModel] = useState(false)
  const [error, setError] = useState('')
  const [ask, setAsk] = useState('')
  const [asked, setAsked] = useState<{ q: string; a: string }[]>([])
  const probes = spec.drill === 'cv' ? 2 : 0
  const parts = scenario?.parts.length ?? 1
  const step = turns.length
  const lastStep = spec.drill === 'cv' ? step >= probes : spec.drill === 'scenario' ? step >= parts - 1 : true

  const finish = async (all: typeof turns) => {
    setBusy('Marking…')
    const text = all.map((t, i) => (all.length > 1 ? `${spec.drill === 'scenario' ? `Part ${i + 1}` : i ? `Follow-up: ${t.q}` : 'Answer'}:\n${t.a}` : t.a)).join('\n\n')
    const secs = all.reduce((n, t) => n + (t.seconds ?? spokenSeconds(t.a)), 0)
    const spoken = all.some((t) => t.seconds !== null)
    try {
      const m = await window.tide.interview.mark(slug, { drill: spec.drill, question: spec.question, answer: text, seconds: spec.drill === 'behavioural' || spec.drill === 'assessor' ? secs : spec.drill === 'talk' ? secs : secs / Math.max(1, all.length), ...spec.input })
      setMark(m)
      const p = await window.tide.interview.attempt(slug, attemptOf({ item: spec.item, area: spec.area, drill: spec.drill, mark: m, seconds: secs, spoken, answer: text, at: Date.now() }))
      onSaved(p)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }

  const submit = async () => {
    if (!answer.trim()) return
    setError('')
    const all = [...turns, { q: current, a: answer.trim(), seconds }]
    setTurns(all)
    setAnswer('')
    setSeconds(null)
    if (lastStep) return finish(all)
    if (spec.drill === 'cv') {
      setBusy('The interviewer is thinking…')
      try {
        const r = await window.tide.interview.probe(slug, { item: spec.question, question: current, answer: all.at(-1)!.a, asked: all.slice(1).map((t) => t.q) })
        setCurrent(r.probe)
      } catch (e) {
        setError(clean(e))
      } finally {
        setBusy('')
      }
    } else if (scenario) setCurrent(scenario.parts[all.length])
  }

  const clarify = async () => {
    const q = ask.trim()
    if (!q || !scenario) return
    setAsk('')
    setBusy('The interviewer is answering…')
    try {
      const r = await window.tide.interview.clarify(slug, { scenario: scenario.id, shown: step + 1, question: q })
      setAsked((a) => [...a, { q, a: r.reply }])
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }

  const tells = useMemo(() => (mark ? aiTells(turns.map((t) => t.a).join('\n')) : []), [mark, turns])
  const modelHtml = useMemo(() => (spec.model ? renderMarkdown(spec.model.replace(/PRACTICE VERSION:?/g, '**PRACTICE VERSION:**'), { notePath: `${bundle.files.meta.folder}/questions.md`, filesByName: new Map() }) : ''), [spec.model, bundle.files.meta.folder])
  const route = spec.input.route ?? []

  return (
    <>
      <header className="it-drill-head">
        <span className="it-eyebrow">{spec.eyebrow}</span>
        <h1 className="it-drill-q">{spec.drill === 'scenario' ? scenario?.title : spec.question}</h1>
        {route.length > 0 && (
          <ol className="it-route" aria-label="Route">
            {route.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        )}
      </header>

      {spec.drill === 'talk' && bundle.files.presentation && (
        <ul className="it-checklist">
          {bundle.files.presentation.checklist.map((c, i) => (
            <li key={i} className={c.done ? 'is-done' : ''}>
              <Icon name={c.done ? 'check' : 'dot'} size={12} />
              {c.text}
            </li>
          ))}
        </ul>
      )}

      {turns.length > 0 && (
        <ol className="it-turns">
          {turns.map((t, i) => (
            <li key={i}>
              {(spec.drill !== 'behavioural' || i > 0) && <p className="it-turn-q">{spec.drill === 'scenario' ? `Part ${i + 1}. ${t.q}` : t.q}</p>}
              <p className="it-turn-a">{t.a}</p>
            </li>
          ))}
        </ol>
      )}

      {!mark && (
        <div className="it-live">
          {(spec.drill !== 'behavioural' && spec.drill !== 'assessor' && spec.drill !== 'talk') || turns.length > 0 ? (
            <p className="it-interviewer">
              <span className="it-who">{spec.drill === 'scenario' ? `Part ${step + 1} of ${parts}` : step ? 'Follow-up' : 'Interviewer'}</span>
              {current}
            </p>
          ) : null}
          {asked.length > 0 && (
            <ul className="it-clarify">
              {asked.map((x, i) => (
                <li key={i}>
                  <span className="muted">You asked: {x.q}</span>
                  <span>{x.a}</span>
                </li>
              ))}
            </ul>
          )}
          <AnswerBox
            drill={spec.drill}
            minutes={spec.input.minutes}
            value={answer}
            onChange={setAnswer}
            seconds={seconds}
            onSeconds={setSeconds}
            busy={!!busy}
            placeholder={spec.drill === 'talk' ? 'Give the talk aloud, or paste its script' : 'Answer as you would in the room'}
          />
          <div className="it-actions">
            {scenario && (
              <div className="it-ask">
                <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && clarify()} placeholder="Ask a clarifying question" disabled={!!busy} />
                <button className="btn small" onClick={clarify} disabled={!ask.trim() || !!busy}>
                  Ask
                </button>
              </div>
            )}
            <span className="it-grow" />
            {busy && (
              <span className="it-busy">
                <span className="spinner" />
                {busy}
              </span>
            )}
            <button className="btn primary" onClick={submit} disabled={!answer.trim() || !!busy}>
              {lastStep ? 'Mark my answer' : spec.drill === 'scenario' ? 'Next part' : 'Answer'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {mark && (
        <section className="it-result" aria-label="How it went">
          <div className="it-score">
            <strong className="tabular">{Math.round(mark.score * 100)}%</strong>
            <span className="muted">{mark.by === 'claude' ? 'Marked by Claude' : 'Marked in code, roughly'}</span>
          </div>
          <MarkBars drill={spec.drill} mark={mark} />
          {mark.feedback && <p className="it-feedback">{mark.feedback}</p>}
          <div className="it-points">
            {mark.covered.length > 0 && (
              <div>
                <h3>You made</h3>
                <ul>
                  {mark.covered.map((c, i) => (
                    <li key={i}>
                      <Icon name="check" size={12} />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {mark.missed.length > 0 && (
              <div>
                <h3>You missed</h3>
                <ul>
                  {mark.missed.map((c, i) => (
                    <li key={i} className="is-missed">
                      <Icon name="minus" size={12} />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {(spec.input.anchors?.length ?? 0) > 0 && (
            <div className="it-anchors">
              <h3>Anchors</h3>
              <div className="it-chips">
                {spec.input.anchors!.map((a, i) => (
                  <span key={i} className="it-chip">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tells.length > 0 && (
            <div className="it-tells">
              <h3>Sounds scripted</h3>
              <ul>
                {tells.slice(0, 5).map((t, i) => (
                  <li key={i}>
                    <q>{t.phrase}</q> <span className="muted">{t.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {spec.drill === 'cv' && (spec.gaps?.length ?? 0) > 0 && (
            <div className="it-tells">
              <h3>Gaps to fill in your stories</h3>
              <ul>
                {spec.gaps!.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {modelHtml && (
            <div className="it-model">
              <button className="link-btn" onClick={() => setShowModel((s) => !s)}>
                <Icon name="chevron" size={11} className={showModel ? 'rot-90' : ''} />
                {showModel ? 'Hide the model answer' : 'Show the model answer'}
              </button>
              {showModel && <div className="prose compact it-model-text" dangerouslySetInnerHTML={{ __html: modelHtml }} />}
            </div>
          )}
          {spec.drill === 'scenario' && scenario && (
            <details className="it-rubric">
              <summary>What a strong answer covers</summary>
              <ul>
                {scenario.rubric.map((r, i) => (
                  <li key={i}>
                    <span className="it-group">{r.group}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="it-actions">
            <button
              className="btn"
              onClick={() => {
                setMark(null)
                setTurns([])
                setAsked([])
                setShowModel(false)
                setCurrent(spec.drill === 'scenario' ? scenario?.parts[0] ?? spec.question : spec.question)
              }}
            >
              Try again
            </button>
            <span className="it-grow" />
            <button className="btn" onClick={onClose}>
              Done
            </button>
            {onNext && (
              <button className="btn primary" onClick={onNext}>
                Next in today’s plan
              </button>
            )}
          </div>
        </section>
      )}
    </>
  )
}

/** Questions to ask: pick the two or three you'd ask this interviewer, with the rule in view */
function AskDrill({ slug, bundle, spec, onSaved, onClose }: { slug: string; bundle: TargetBundle; spec: Spec; onSaved(p: Progress): void; onClose(): void }) {
  const g = bundle.files.ask.groups.find((x) => `ask:${x.who}` === spec.item)!
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [own, setOwn] = useState('')
  const [saved, setSaved] = useState(false)
  const n = picked.size + (own.trim() ? 1 : 0)
  const save = async () => {
    const score = Math.min(1, n / 2)
    const p = await window.tide.interview.attempt(slug, { item: spec.item, area: 'ask', drill: 'ask', at: Date.now(), score, marks: { ready: score }, by: 'self', answer: [...[...picked].map((i) => g.questions[i]), own.trim()].filter(Boolean).join('\n') })
    onSaved(p)
    setSaved(true)
  }
  return (
    <>
      <header className="it-drill-head">
        <span className="it-eyebrow">{spec.eyebrow}</span>
        <h1 className="it-drill-q">{spec.question}</h1>
        {bundle.files.ask.rules.map((r, i) => (
          <p key={i} className="it-rule">
            {r}
          </p>
        ))}
      </header>
      <p className="muted small">Pick two or three you’d ask, in your own words. Drop any they’ve already answered.</p>
      <ul className="it-picks">
        {g.questions.map((q, i) => (
          <li key={i}>
            <label className="check">
              <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(i) : new Set([...s].filter((x) => x !== i))))} />
              {q}
            </label>
          </li>
        ))}
      </ul>
      <input className="it-own" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Or one of your own" />
      <div className="it-actions">
        <span className="it-grow" />
        {saved ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button className="btn primary" disabled={!n} onClick={save}>
            I’m ready to ask these
          </button>
        )}
      </div>
    </>
  )
}

/** Firm facts: each with its figure or key word hidden, say it, then check */
function FirmDrill({ slug, bundle, spec, onSaved, onClose }: { slug: string; bundle: TargetBundle; spec: Spec; onSaved(p: Progress): void; onClose(): void }) {
  const facts = useMemo(() => [...bundle.files.firm].sort(() => Math.random() - 0.5).slice(0, 8), [bundle.files.firm])
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const [right, setRight] = useState(0)
  const [done, setDone] = useState(false)
  const f = facts[i]
  const blank = (t: string) => {
    const fig = t.match(/(?:[$£€]\s?)?\d[\d,.]*\s?(?:%|bn|billion|m|million|k|years?)?/i)
    if (fig && fig[0].trim().length > 1) return t.replace(fig[0], '_____')
    const words = t.split(' ')
    const k = words.reduce((best, w, j) => (w.length > words[best].length ? j : best), 0)
    return words.map((w, j) => (j === k ? '_____' : w)).join(' ')
  }
  const answer = async (knew: boolean) => {
    const r = right + (knew ? 1 : 0)
    setRight(r)
    setShown(false)
    if (i + 1 < facts.length) return setI(i + 1)
    setDone(true)
    const score = r / facts.length
    onSaved(await window.tide.interview.attempt(slug, { item: spec.item, area: 'firm', drill: 'firm', at: Date.now(), score, marks: { recall: score }, by: 'self' }))
  }
  if (!f) return <p className="muted">firm.md has no facts yet.</p>
  return (
    <>
      <header className="it-drill-head">
        <span className="it-eyebrow">{done ? 'Recall check' : `Fact ${i + 1} of ${facts.length} · ${f.section}`}</span>
        <h1 className="it-drill-q">{done ? `${right} of ${facts.length} from memory` : blank(f.text)}</h1>
      </header>
      {!done && shown && (
        <p className="it-reveal">
          {f.text}
          {f.source && <span className="muted"> · {[f.source, f.date].filter(Boolean).join(', ')}</span>}
        </p>
      )}
      <div className="it-actions">
        <span className="it-grow" />
        {done ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : !shown ? (
          <button className="btn primary" onClick={() => setShown(true)}>
            Show it
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => answer(false)}>
              Didn’t know it
            </button>
            <button className="btn primary" onClick={() => answer(true)}>
              Knew it
            </button>
          </>
        )}
      </div>
    </>
  )
}
