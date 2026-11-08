import { useEffect, useState } from 'react'
import { DRILLS, type DrillKind, type DrillResult } from '@shared/drills'
import type { InterviewRecord } from '@shared/interviews'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PillSegment, PillSelect, PromptBox } from './PromptBox'

const AREAS = ['Probability', 'Expected value', 'Statistics', 'Brainteasers', 'Market making', 'Options and finance', 'Mixed']
const FIRMS = ['', 'Jane Street', 'Optiver', 'SIG', 'Citadel', 'Hudson River Trading', 'Two Sigma']
const QUANT_MINUTES = 30
const LEVELS: { id: 'gentle' | 'normal' | 'hard' | 'olympiad'; label: string }[] = [
  { id: 'gentle', label: 'Warm-up' },
  { id: 'normal', label: 'Interview' },
  { id: 'hard', label: 'Hard' },
  { id: 'olympiad', label: 'Olympiad' }
]

/** Quant practice: mental maths speed drills, and timed interview drills like a trading firm's */
export function QuantPanel() {
  const app = useApp()
  const [area, setArea] = useState(() => localStorage.getItem('tide.quant.area') ?? 'Probability')
  const [firm, setFirm] = useState(() => localStorage.getItem('tide.quant.firm') ?? 'Jane Street')
  const [timed, setTimed] = useState(() => localStorage.getItem('tide.quant.timed') !== 'off')
  const [level, setLevel] = useState<(typeof LEVELS)[number]['id']>(() => (localStorage.getItem('tide.quant.level') as 'normal' | null) ?? 'hard')
  const [focus, setFocus] = useState('')
  const [paperFocus, setPaperFocus] = useState('')
  const [drills, setDrills] = useState<DrillResult[]>([])
  const [rounds, setRounds] = useState<InterviewRecord[]>([])
  useEffect(() => {
    window.tide.practice.drills().then(setDrills).catch(() => {})
    window.tide.practice.interviews().then((r) => setRounds(r.filter((x) => x.round === 'quant'))).catch(() => {})
  }, [])

  const best = (k: DrillKind) => drills.filter((d) => d.kind === k).reduce((m, d) => Math.max(m, d.correct), 0)
  const last = rounds[rounds.length - 1]

  /** A paper of problems to sit down and work through, written answers or photos, marked part by part */
  const problemSet = () => {
    localStorage.setItem('tide.quant.area', area)
    localStorage.setItem('tide.quant.level', level)
    const olympiad = level === 'olympiad'
    app.setView({
      kind: 'exam',
      scope: { kind: 'none' },
      topic: paperFocus.trim() ? `${paperFocus.trim()} (quant and maths problems)` : area === 'Mixed' ? 'quant and maths problems: probability, expected value, combinatorics, statistics, number theory and algebra' : `${area.toLowerCase()} problems (quant and maths)`,
      options: { questions: olympiad ? 4 : 6, minutes: olympiad ? 90 : 60, difficulty: level, style: 'problems' },
      nonce: Date.now()
    })
  }

  const start = () => {
    localStorage.setItem('tide.quant.area', area)
    localStorage.setItem('tide.quant.firm', firm)
    app.setView({
      kind: 'session',
      mode: 'interview',
      scope: { kind: 'none' },
      topic: focus.trim() ? focus.trim() : area === 'Mixed' ? 'mixed quant questions: probability, expected value, statistics and mental maths' : area.toLowerCase(),
      options: { round: 'quant', ...(firm ? { company: firm } : {}), difficulty: 'hard', ...(timed ? { timed: QUANT_MINUTES } : {}) },
      nonce: Date.now()
    })
  }

  return (
    <>
      <section className="pv-prompt">
        <h2 className="pv-title">Quant interview drill</h2>
        <p className="pv-sub">One question at a time, answers checked with real maths, a scorecard at the end.</p>
        <PromptBox
          value={focus}
          onChange={setFocus}
          onSubmit={start}
          allowEmpty
          placeholder={`What should it cover? Leave empty for ${area.toLowerCase()}, or say e.g. conditional probability, Kelly betting`}
          action="Start"
          tools={
            <>
              <PillSelect label="Area" icon="quiz" value={area} onChange={setArea} options={AREAS.map((a) => ({ value: a, label: a }))} />
              <PillSelect label="Interview style" icon="globe" value={firm} onChange={setFirm} options={FIRMS.map((f) => ({ value: f, label: f ? `${f} style` : 'Any firm' }))} />
              <PillSegment
                label="Timing"
                value={timed ? 'timed' : 'open'}
                onChange={(v) => {
                  setTimed(v === 'timed')
                  localStorage.setItem('tide.quant.timed', v === 'timed' ? 'on' : 'off')
                }}
                options={[
                  { value: 'timed', label: `Timed, ${QUANT_MINUTES} min` },
                  { value: 'open', label: 'Untimed' }
                ]}
              />
            </>
          }
        />
        <div className="drill-row" aria-label="Speed drills">
          {(Object.keys(DRILLS) as DrillKind[]).map((k) => (
            <button key={k} className="drill-chip" onClick={() => app.setView({ kind: 'drill', drill: k, nonce: Date.now() })} title={DRILLS[k].short}>
              <Icon name="timer" size={14} />
              <span>{DRILLS[k].label}</span>
              <span className="muted">best</span>
              <strong>{best(k) || '–'}</strong>
            </button>
          ))}
          {last && <span className="muted small pv-meta-note">Last drill: {Math.round(last.score * 100)}%{last.verdict ? `, ${last.verdict}` : ''}</span>}
        </div>
      </section>

      <section className="pv-prompt">
        <h2 className="pv-title">Problem set</h2>
        <p className="pv-sub">Harder problems to sit down with. Write full answers or photograph your working; each part is marked.</p>
        <PromptBox
          value={paperFocus}
          onChange={setPaperFocus}
          onSubmit={problemSet}
          allowEmpty
          placeholder="What kind of problems? e.g. combinatorics, inequalities, Markov chains"
          action="Write the paper"
          hint={level === 'olympiad' ? '4 problems, 90 min' : '6 problems, 60 min'}
          tools={<PillSegment label="Difficulty" value={level} onChange={(v) => setLevel(v as typeof level)} options={LEVELS.map((l) => ({ value: l.id, label: l.label }))} />}
        />
      </section>
    </>
  )
}
