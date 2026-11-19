import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mmss, type TargetBundle } from '@shared/interviewTarget'
import { aiTells } from '@shared/humanWriting'
import { beatSpans, latest, lockedText, unsupportedClaims, wordCount, wordDiff, WORDS_PER_MINUTE, type SayItResult, type ScriptBundle, type ScriptRevision, type ScriptVersion } from '@shared/interviewScript'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { TimeBar, useRecorder } from './Drill'

/**
 * Scripts (shared/interviewScript): the learner and Tide co-write the spoken answer to one
 * question. The draft is the page: edited in place, with its length against the target and the
 * phrases to look at marked in it. Beside it, a short back-and-forth with Tide, every version
 * kept, and "This is the one" to lock it. A locked script is practised with Say it: read once,
 * hidden, said, then marked on its beats.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const secsOf = (text: string) => Math.round((wordCount(text) / WORDS_PER_MINUTE) * 60)
const BY: Record<ScriptVersion['by'], string> = { tide: 'Tide', you: 'You', start: 'Start' }
const QUICK = ['Less formal', 'Shorter', 'Two other openings', 'Two other endings']

type Range = { at: number; length: number; kind: 'tell' | 'long' | 'claim' | 'gap' | 'missed'; title: string }

/** Text split into marked and unmarked runs, first range wins where they overlap */
function segments(text: string, ranges: Range[]): { text: string; r?: Range }[] {
  const sorted = [...ranges].filter((r) => r.length > 0).sort((a, b) => a.at - b.at)
  const out: { text: string; r?: Range }[] = []
  let pos = 0
  for (const r of sorted) {
    if (r.at < pos) continue
    if (r.at > pos) out.push({ text: text.slice(pos, r.at) })
    out.push({ text: text.slice(r.at, r.at + r.length), r })
    pos = r.at + r.length
  }
  out.push({ text: text.slice(pos) })
  return out
}

function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  return (
    <>
      {segments(text, ranges).map((s, i) =>
        s.r ? (
          <mark key={i} className={`sc-m is-${s.r.kind}`} title={s.r.title}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
      {'\n'}
    </>
  )
}

/** The draft: a textarea over a copy of its text with the marks, so the marks sit under the words */
function DraftEditor({ value, onChange, onBlur, ranges, readOnly, taRef }: { value: string; onChange(v: string): void; onBlur(): void; ranges: Range[]; readOnly?: boolean; taRef: React.RefObject<HTMLTextAreaElement | null> }) {
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${ta.scrollHeight}px`
  }, [value, taRef])
  return (
    <div className={`sc-editor${readOnly ? ' is-readonly' : ''}`}>
      <div className="sc-backdrop" aria-hidden="true">
        <Marked text={value} ranges={ranges} />
      </div>
      <textarea ref={taRef} className="sc-text" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} readOnly={readOnly} spellCheck placeholder="Write it the way you’d say it. Or ask Tide for a first draft." aria-label="Your script" />
    </div>
  )
}

/** Words, spoken time and the window it should land in */
function Meter({ text, target }: { text: string; target: [number, number] }) {
  const secs = secsOf(text)
  const [lo, hi] = target
  const max = hi * 1.4
  const tone = !text.trim() ? 'empty' : secs < lo ? 'short' : secs > hi ? 'long' : 'ok'
  return (
    <div className={`sc-meter is-${tone}`}>
      <span className="sc-meter-words tabular">{wordCount(text)} words</span>
      <span className="sc-meter-time tabular">
        {mmss(secs)} <span className="muted">spoken · aim {mmss(lo)}–{mmss(hi)}</span>
      </span>
      <span className="sc-meter-track" aria-hidden="true">
        <span className="sc-meter-window" style={{ left: `${(lo / max) * 100}%`, width: `${((hi - lo) / max) * 100}%` }} />
        <span className="sc-meter-fill" style={{ width: `${Math.min(100, (secs / max) * 100)}%` }} />
      </span>
    </div>
  )
}

export function ScriptWorkspace({ slug, target, questionId, onClose }: { slug: string; target: TargetBundle; questionId: string; onClose(): void }) {
  const app = useApp()
  const [b, setB] = useState<ScriptBundle | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'start' | 'revise' | 'lock' | 'save'>('')
  const [feedback, setFeedback] = useState('')
  const [reply, setReply] = useState<ScriptRevision['reply'] | null>(null)
  const [ruleAdded, setRuleAdded] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [compare, setCompare] = useState(false)
  const [mode, setMode] = useState<'write' | 'say'>('write')
  const [showVoice, setShowVoice] = useState(false)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const log = useRef<HTMLOListElement | null>(null)
  const started = useRef(false)

  const take = useCallback((nb: ScriptBundle) => {
    setB(nb)
    setText(nb.script ? latest(nb.script)?.text ?? '' : '')
  }, [])

  useEffect(() => {
    window.tide.interview
      .script(slug, questionId)
      .then((nb) => {
        take(nb)
        // The learner's own draft or the model answer is a free first version: start from it straight away
        if (!nb.script?.versions.length && (nb.start === 'yours' || nb.start === 'model') && !started.current) {
          started.current = true
          setBusy('start')
          window.tide.interview
            .scriptStart(slug, questionId)
            .then(take)
            .catch((e) => setError(clean(e)))
            .finally(() => setBusy(''))
        }
      })
      .catch((e) => setError(clean(e)))
  }, [slug, questionId, take])

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [b?.script?.log.length, reply])

  const s = b?.script ?? null
  const newest = s ? latest(s) : undefined
  const locked = s?.status === 'locked'
  const dirty = !locked && text.trim() !== (newest?.text ?? '').trim() && !!text.trim()
  const shown = viewing !== null ? s?.versions.find((v) => v.n === viewing) : undefined
  const known = useMemo(() => new Set(b?.known ?? []), [b?.known])

  const ranges = useMemo<Range[]>(() => {
    const t = shown ? shown.text : text
    const out: Range[] = []
    for (const g of t.matchAll(/\[[^\]\n]{1,80}\]/g)) out.push({ at: g.index ?? 0, length: g[0].length, kind: 'gap', title: 'A gap: fill it in with the real detail' })
    for (const c of unsupportedClaims(t, known)) out.push({ at: c.at, length: c.length, kind: 'claim', title: `Confirm this is true: ${c.missing.join(', ')} isn’t in your material` })
    for (const x of aiTells(t)) out.push({ at: x.at, length: x.length, kind: /^Over \d+ words/.test(x.why) ? 'long' : 'tell', title: x.why })
    // Tells first where they overlap a claim: they are shorter and more specific
    const rank = { tell: 0, gap: 1, claim: 2, long: 3, missed: 4 }
    return out.sort((a, z) => rank[a.kind] - rank[z.kind])
  }, [text, shown, known])
  const tells = ranges.filter((r) => r.kind === 'tell' || r.kind === 'long')
  const claims = ranges.filter((r) => r.kind === 'claim')
  const gaps = ranges.filter((r) => r.kind === 'gap')

  const run = async <T,>(what: typeof busy, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(what)
    setError('')
    try {
      return await fn()
    } catch (e) {
      setError(clean(e))
      return null
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    if (!dirty || busy) return
    const nb = await run('save', () => window.tide.interview.scriptSave(slug, questionId, text))
    if (nb) setB(nb)
  }
  const start = async () => {
    const nb = await run('start', () => window.tide.interview.scriptStart(slug, questionId))
    if (nb) take(nb)
  }
  const send = async (fb = feedback) => {
    const f = fb.trim()
    if (!f || busy) return
    setFeedback('')
    setReply(null)
    setRuleAdded(false)
    setViewing(null)
    const r = await run('revise', () => window.tide.interview.scriptRevise(slug, questionId, f, text))
    if (r) {
      take(r.bundle)
      setReply(r.reply)
    } else setFeedback(f)
  }
  const pick = async (draft: string, label: string) => {
    const nb = await run('revise', () => window.tide.interview.scriptPick(slug, questionId, draft, `The ${label} you picked.`))
    if (nb) {
      take(nb)
      setReply(null)
    }
  }
  const restore = async (n: number) => {
    const nb = await run('save', () => window.tide.interview.scriptRestore(slug, questionId, n))
    if (nb) {
      take(nb)
      setViewing(null)
      setCompare(false)
    }
  }
  const lock = async (n: number | null) => {
    if (n !== null && dirty) {
      const saved = await run('save', () => window.tide.interview.scriptSave(slug, questionId, text))
      if (!saved) return
      n = saved.script ? latest(saved.script)!.n : n
    }
    const nb = await run('lock', () => window.tide.interview.scriptLock(slug, questionId, n))
    if (nb) {
      take(nb)
      setViewing(null)
      if (n !== null) app.toast('Locked as your script')
    }
  }
  const addRule = async (rule: string) => {
    try {
      const voice = await window.tide.interview.voiceAdd(slug, 'rules', rule)
      setB((cur) => (cur ? { ...cur, voice } : cur))
      setRuleAdded(true)
    } catch (e) {
      setError(clean(e))
    }
  }
  const select = (r: Range) => {
    const t = ta.current
    if (!t || shown) return
    t.focus()
    t.setSelectionRange(r.at, r.at + r.length)
  }

  if (!b)
    return (
      <section className="sc-page">
        <button className="link-btn it-back" onClick={onClose}>
          <Icon name="back" size={13} />
          {target.files.meta.company}
        </button>
        {error ? <p className="error-text">{error}</p> : <div className="sc-loading" />}
      </section>
    )

  const q = target.files.questions.find((x) => x.id === questionId)
  const round = target.files.meta.rounds.find((r) => r.id === q?.round)?.name
  const lastTide = [...(s?.log ?? [])].reverse().find((t) => t.who === 'tide')

  if (mode === 'say' && s && lockedText(s))
    return (
      <section className="sc-page">
        <button className="link-btn it-back" onClick={() => setMode('write')}>
          <Icon name="back" size={13} />
          The script
        </button>
        <SayIt slug={slug} bundle={b} onDone={() => setMode('write')} />
      </section>
    )

  return (
    <section className="sc-page" aria-label={`Script: ${b.question}`}>
      <button className="link-btn it-back" onClick={onClose}>
        <Icon name="back" size={13} />
        {target.files.meta.company}
      </button>
      <header className="sc-head">
        <div className="sc-head-text">
          <span className="it-eyebrow">{['Script', b.kind.replace('-', ' '), round].filter(Boolean).join(' · ')}</span>
          <h1 className="it-drill-q">{b.question}</h1>
          {b.route.length > 0 && (
            <ol className="it-route" aria-label="Route">
              {b.route.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          )}
        </div>
        {s && <span className={`sc-status${locked ? ' is-locked' : ''}`}>{locked ? <><Icon name="lock" size={11} /> Locked · v{s.lockedVersion}</> : `Draft · v${newest?.n ?? 0}`}</span>}
      </header>

      <div className="sc-grid">
        {/* ---------- The draft ---------- */}
        <div className="sc-main">
          {s && s.versions.length > 1 && (
            <div className="sc-versions" role="tablist" aria-label="Versions">
              {s.versions.map((v) => {
                const isNewest = v.n === newest?.n
                const active = viewing === null ? isNewest : viewing === v.n
                return (
                  <button key={v.n} role="tab" aria-selected={active} className={`sc-ver${active ? ' is-active' : ''}${locked && s.lockedVersion === v.n ? ' is-locked' : ''}`} title={`${BY[v.by]} · ${v.at}${v.note ? `\n${v.note}` : ''}`} onClick={() => { setViewing(isNewest ? null : v.n); setCompare(false) }}>
                    v{v.n}
                    <span className="sc-ver-by">{BY[v.by]}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="sc-card">
            {(text.trim() || shown) && !(shown && compare) && <Meter text={shown ? shown.text : text} target={b.target} />}
            {shown && (
              <div className="sc-banner">
                <span>
                  Version {shown.n} · {BY[shown.by]} · {shown.at}
                </span>
                <span className="it-grow" />
                <button className={`btn small ghost${compare ? ' is-on' : ''}`} onClick={() => setCompare((c) => !c)}>
                  <Icon name="diff" size={12} />
                  {compare ? 'Hide changes' : `Compare with v${newest?.n}`}
                </button>
                {!locked && (
                  <button className="btn small" onClick={() => restore(shown.n)} disabled={!!busy}>
                    Go back to this one
                  </button>
                )}
              </div>
            )}

            {!s?.versions.length && !text && busy !== 'start' ? (
              <div className="sc-empty">
                <p className="sc-empty-title">No draft yet</p>
                <div className="it-actions">
                  {b.claude && (
                    <button className="btn primary" onClick={start}>
                      <Icon name="sparkle" size={13} />
                      Draft it from my material
                    </button>
                  )}
                  {b.start === 'outline' && (
                    <button className="btn" onClick={start}>
                      Start from my outline
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => { setText(' '); setTimeout(() => ta.current?.focus(), 0) }}>
                    Write it myself
                  </button>
                </div>
              </div>
            ) : busy === 'start' ? (
              <div className="sc-drafting">
                <span className="spinner" /> Drafting from your material…
              </div>
            ) : shown && compare ? (
              <div className="sc-diff">
                {wordDiff(shown.text, newest?.text ?? '').map((p, i) => (p.kind === 'same' ? <span key={i}>{p.text}</span> : p.kind === 'added' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
              </div>
            ) : (
              <DraftEditor value={shown ? shown.text : text} onChange={setText} onBlur={save} ranges={ranges} readOnly={!!shown || locked || busy === 'revise'} taRef={ta} />
            )}

          </div>

          {(tells.length > 0 || claims.length > 0 || gaps.length > 0) && !compare && (
            <ul className="sc-checks" aria-label="To look at">
              {claims.map((r, i) => (
                <li key={`c${i}`}>
                  <button className="sc-check is-claim" onClick={() => select(r)}>
                    <span className="sc-check-kind">Confirm</span>
                    <span className="sc-check-text">{r.title.replace(/^Confirm this is true: /, '')}</span>
                  </button>
                </li>
              ))}
              {gaps.map((r, i) => (
                <li key={`g${i}`}>
                  <button className="sc-check is-gap" onClick={() => select(r)}>
                    <span className="sc-check-kind">Fill in</span>
                    <span className="sc-check-text">{(shown ? shown.text : text).slice(r.at + 1, r.at + r.length - 1)}</span>
                  </button>
                </li>
              ))}
              {tells.slice(0, 6).map((r, i) => (
                <li key={`t${i}`}>
                  <button className="sc-check is-tell" onClick={() => select(r)}>
                    <span className="sc-check-kind">Sounds written</span>
                    <span className="sc-check-text">
                      <q>{(shown ? shown.text : text).slice(r.at, r.at + Math.min(r.length, 50))}</q> {r.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {locked && s.beats.length > 0 && (
            <div className="sc-beats">
              <span className="it-eyebrow">Beats to land</span>
              <ol>
                {s.beats.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          {s && s.versions.length > 0 && (
            <div className="it-actions sc-actions">
              {dirty && (
                <button className="btn small ghost" onClick={save} disabled={!!busy}>
                  {busy === 'save' ? <span className="spinner" /> : null}
                  Keep this edit
                </button>
              )}
              <span className="it-grow" />
              {locked ? (
                <>
                  <button className="btn" onClick={() => lock(null)} disabled={!!busy}>
                    Unlock
                  </button>
                  <button className="btn primary" onClick={() => setMode('say')}>
                    <Icon name="mic" size={13} />
                    Say it
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={() => lock(viewing ?? newest?.n ?? null)} disabled={!!busy || !text.trim()}>
                  {busy === 'lock' ? <span className="spinner" /> : <Icon name="check" size={13} />}
                  {viewing !== null ? `Lock version ${viewing}` : 'This is the one'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ---------- With Tide ---------- */}
        <aside className="sc-side" aria-label="With Tide">
          <div className="sc-side-head">
            <span className="it-eyebrow">With Tide</span>
            {!b.claude && <span className="sc-offline" title="Claude isn’t set up or available: edit, keep versions, lock and practise all still work">Editing only</span>}
          </div>
          <ol className="sc-log" ref={log}>
            {!s?.log.length && <li className="sc-log-empty">Tell Tide what to change, in your words. “Less formal.” “Start with the project.” “I’d never say that.”</li>}
            {s?.log.map((t, i) => (
              <li key={i} className={`sc-turn is-${t.who}`}>
                <p>{t.text}</p>
                {t.who === 'tide' && t.version && (
                  <button className="sc-turn-ver" onClick={() => setViewing(t.version === newest?.n ? null : t.version!)}>
                    v{t.version}
                  </button>
                )}
              </li>
            ))}
            {busy === 'revise' && (
              <li className="sc-turn is-tide is-busy">
                <span className="spinner" /> Rewriting…
              </li>
            )}
          </ol>

          {reply?.options && reply.options.length > 0 && lastTide && (
            <div className="sc-options">
              {reply.options.map((o, i) => (
                <div key={i} className="sc-option">
                  <span className="it-eyebrow">
                    {o.kind === 'ending' ? 'Ending' : 'Opening'} {String.fromCharCode(65 + i)}
                  </span>
                  <p>{o.text}</p>
                  <button className="btn small" onClick={() => pick(o.draft, `${o.kind} ${String.fromCharCode(65 + i)}`)} disabled={!!busy}>
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}

          {reply?.voiceRule && !b.voice.rules.includes(reply.voiceRule) && !ruleAdded && (
            <div className="sc-rule">
              <span className="sc-rule-label">Add to your voice?</span>
              <span className="sc-rule-text">{reply.voiceRule}</span>
              <div className="sc-rule-actions">
                <button className="btn small primary" onClick={() => addRule(reply.voiceRule!)}>
                  Add rule
                </button>
                <button className="btn small ghost" onClick={() => setReply({ ...reply, voiceRule: undefined })}>
                  Just this once
                </button>
              </div>
            </div>
          )}
          {ruleAdded && <p className="sc-rule-done"><Icon name="check" size={12} /> Added to voice.md</p>}

          {!locked && (
            <div className="sc-compose">
              <div className="sc-quick">
                {QUICK.map((x) => (
                  <button key={x} className="sc-chip" onClick={() => send(x.toLowerCase())} disabled={!!busy || !b.claude || !text.trim()}>
                    {x}
                  </button>
                ))}
              </div>
              <div className="sc-input">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  rows={2}
                  placeholder={b.claude ? 'What should change?' : 'Notes for later (Claude isn’t available to rewrite)'}
                  aria-label="Feedback for Tide"
                  disabled={busy === 'revise'}
                />
                <button className="sc-send" onClick={() => send()} disabled={!feedback.trim() || !!busy} aria-label="Send">
                  <Icon name="send" size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="sc-voice">
            <button className="sc-voice-toggle" onClick={() => setShowVoice((v) => !v)} aria-expanded={showVoice}>
              <Icon name="chevron" size={10} className={showVoice ? 'rot-90' : ''} />
              Your voice
              <span className="it-count">
                {b.voice.rules.length} rule{b.voice.rules.length === 1 ? '' : 's'} · {b.voice.samples.length} sample{b.voice.samples.length === 1 ? '' : 's'}
              </span>
            </button>
            {showVoice && (
              <div className="sc-voice-body">
                {b.voice.rules.length ? (
                  <ul>
                    {b.voice.rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No rules yet. When your feedback is about how you talk, Tide offers to keep it here.</p>
                )}
                <button className="link-btn small" onClick={() => app.openPath(b.voicePath)}>
                  Open voice.md
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

/** Say it: read the locked script once, hide it, say it, see which beats landed */
function SayIt({ slug, bundle, onDone }: { slug: string; bundle: ScriptBundle; onDone(): void }) {
  const s = bundle.script!
  const script = lockedText(s) ?? ''
  const [phase, setPhase] = useState<'read' | 'say' | 'result'>('read')
  const [answer, setAnswer] = useState('')
  const [seconds, setSeconds] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [r, setR] = useState<SayItResult | null>(null)
  const rec = useRecorder()

  const mark = async () => {
    setBusy(true)
    setError('')
    try {
      setR(await window.tide.interview.sayIt(slug, bundle.questionId, answer, seconds))
      setPhase('result')
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  const again = () => {
    setAnswer('')
    setSeconds(null)
    setR(null)
    setPhase('read')
  }

  const missedRanges = useMemo<Range[]>(() => {
    if (!r) return []
    const spans = beatSpans(script, r.beats.map((x) => x.text))
    return r.beats.flatMap((x, i) => (!x.hit && spans[i] ? [{ ...spans[i]!, kind: 'missed' as const, title: `Missed: ${x.text}` }] : []))
  }, [r, script])

  const shownSecs = rec.state === 'listening' ? rec.elapsed : seconds ?? secsOf(answer)

  return (
    <div className="sc-say">
      <header className="it-drill-head">
        <span className="it-eyebrow">Say it · {phase === 'read' ? 'read it once' : phase === 'say' ? 'from memory' : 'how it went'}</span>
        <h1 className="it-drill-q">{bundle.question}</h1>
      </header>

      {phase === 'read' && (
        <>
          <div className="sc-card sc-read">
            <p className="sc-script">{script}</p>
          </div>
          <div className="it-actions">
            <span className="muted small">
              {s.beats.length} beats · aim {mmss(bundle.target[0])}–{mmss(bundle.target[1])}
            </span>
            <span className="it-grow" />
            <button className="btn primary" onClick={() => setPhase('say')}>
              <Icon name="eye" size={13} />
              Hide it and say it
            </button>
          </div>
        </>
      )}

      {phase === 'say' && (
        <>
          <div className="sc-hidden" aria-hidden="true">
            {s.beats.map((_, i) => (
              <span key={i} className="sc-hidden-beat" />
            ))}
          </div>
          <div className="it-answer">
            <textarea className="it-answer-text" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={7} placeholder="Say it aloud with the mic, or dictate with Flow" disabled={busy || rec.state !== 'idle'} autoFocus />
            <div className="it-answer-tools">
              <button
                type="button"
                className={`tool-btn it-speak is-${rec.state}`}
                disabled={busy || rec.state === 'writing'}
                onClick={async () => {
                  if (rec.state === 'listening') {
                    const x = await rec.stop()
                    if (x) {
                      setAnswer((a) => (a.trim() ? a.trimEnd() + ' ' : '') + x.text)
                      setSeconds((v) => (v ?? 0) + x.seconds)
                    }
                  } else await rec.start()
                }}
              >
                <Icon name={rec.state === 'listening' ? 'stop' : 'mic'} size={14} />
                <span>{rec.state === 'listening' ? `Stop · ${mmss(rec.elapsed)}` : rec.state === 'writing' ? 'Writing it down…' : 'Say it aloud'}</span>
              </button>
              {(shownSecs > 0 || rec.state === 'listening') && <TimeBar seconds={shownSecs} window={bundle.target} spoken={rec.state === 'listening' || seconds !== null} />}
            </div>
            {rec.hint && <p className="it-hint">{rec.hint}</p>}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="it-actions">
            <button className="btn ghost" onClick={() => setPhase('read')} disabled={busy}>
              Peek
            </button>
            <span className="it-grow" />
            {busy && (
              <span className="it-busy">
                <span className="spinner" /> Checking the beats…
              </span>
            )}
            <button className="btn primary" onClick={mark} disabled={!answer.trim() || busy}>
              Mark it
            </button>
          </div>
        </>
      )}

      {phase === 'result' && r && (
        <section className="it-result" aria-label="How it went">
          <div className="sc-result-top">
            <div className="it-score">
              <strong className="tabular">
                {r.beats.filter((x) => x.hit).length}/{r.beats.length}
              </strong>
              <span className="muted">beats landed · {r.by === 'claude' ? 'checked by Claude' : 'checked in code'}</span>
            </div>
            <div className="sc-result-stats">
              <TimeBar seconds={r.seconds} window={r.target} spoken={seconds !== null} />
              <div className="sc-natural">
                <span className="it-bar-label">Sounds like you talking</span>
                <span className="it-bar-track" aria-hidden="true">
                  <span className="it-bar-fill" style={{ width: `${Math.max(2, r.natural * 100)}%` }} />
                </span>
                <span className="it-bar-value tabular">{Math.round(r.natural * 100)}%</span>
              </div>
            </div>
          </div>
          {r.feedback && <p className="it-feedback">{r.feedback}</p>}
          <ol className="sc-beat-marks">
            {r.beats.map((x, i) => (
              <li key={i} className={x.hit ? 'is-hit' : 'is-missed'}>
                <Icon name={x.hit ? 'check' : 'minus'} size={12} />
                {x.text}
              </li>
            ))}
          </ol>
          <div className="sc-card sc-read">
            <span className="it-eyebrow">The script{missedRanges.length ? ', missed beats marked' : ''}</span>
            <p className="sc-script">
              <Marked text={script} ranges={missedRanges} />
            </p>
          </div>
          <div className="it-actions">
            <button className="btn" onClick={onDone}>
              Back to the script
            </button>
            <span className="it-grow" />
            <button className="btn primary" onClick={again}>
              Say it again
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
