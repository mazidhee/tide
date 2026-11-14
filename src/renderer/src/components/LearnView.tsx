import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChatScope, ExamOptions, Mastery, NoteMeta, SessionMode } from '@shared/types'
import type { SessionSetup } from '@shared/session'
import type { ProfessorPose } from '@shared/professorArt'
import { fileTitle, useApp } from '../state'
import { Icon } from './Icon'
import { openingRequest } from '../lib/openingRequest'
import { readyCounts } from './ReadyCard'
import { startPrepared, useReadyLesson } from '../lib/prep'
import { PixelProf } from './learn/PixelProf'
import { WAY_ART, type WayId } from './learn/WayArt'
import { LearnShelf, LEVEL_LABEL } from './learn/LearnShelf'
import '../styles/comprehension.css'
import '../styles/learn.css'

export { LEVEL_LABEL }

type LearnMode = SessionMode | 'exam' | 'mixed' | 'comprehension'

/** The seven ways in, each with what the tutor is doing in it and what he says */
const WAYS: { id: WayId & LearnMode; name: string; start: string; pose: ProfessorPose; say: string; desc: string }[] = [
  { id: 'teach', name: 'Teach me', start: 'Start the lesson', pose: 'board', say: 'What does a switch do?', desc: 'Asks what you already know, then teaches step by step, with visuals.' },
  { id: 'quiz', name: 'Quiz', start: 'Start the quiz', pose: 'cards', say: 'Pick a card. Any card.', desc: 'Questions on one topic. Anything you miss becomes a flashcard.' },
  { id: 'mixed', name: 'Mixed', start: 'Start mixed practice', pose: 'chess', say: 'Binary, then gates, then back again.', desc: 'Questions that switch topic every time. Harder, and the strongest way to practise.' },
  { id: 'exam', name: 'Exam', start: 'Start the exam', pose: 'stopwatch', say: '45 minutes. Begin.', desc: 'A timed paper, marked at the end. Type your answers or photograph your working.' },
  { id: 'comprehension', name: 'Comprehension', start: 'Start reading', pose: 'book', say: 'Read it once, then tell me.', desc: 'Read a passage, put it away, then say what it says. Checked against its exact words.' },
  { id: 'review', name: 'Review my writing', start: 'Start the review', pose: 'writing', say: 'Nice line. One comma, though.', desc: 'Comments on something you wrote, pinned to your words. It never rewrites it.' },
  { id: 'interview', name: 'Interview', start: 'Start the interview', pose: 'laptop', say: 'Walk me through your approach.', desc: 'A coding problem, your code run against tests, follow-up questions and a scorecard.' }
]

const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'c++', 'go', 'rust']
const DIFFICULTY = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' }
] as const

/** A small segmented control: a few options side by side, one chosen */
function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="lrn-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A select for when the options are many */
function Choose<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <label className="lrn-select">
      <select value={String(value)} aria-label={label} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={11} className="lrn-select-caret" />
    </label>
  )
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="lrn-row">
    <span className="lrn-row-label">{label}</span>
    <div className="lrn-row-control">{children}</div>
  </div>
)

export function LearnView() {
  const app = useApp()
  // A lesson prepared while you were away (main/lessonPrep)
  const { prep: ready } = useReadyLesson()
  const [topic, setTopic] = useState('')
  const [source, setSource] = useState<ChatScope>({ kind: 'none' })
  const [mode, setMode] = useState<LearnMode>('teach')
  const [exam, setExam] = useState<ExamOptions>({ questions: 4, minutes: 45, difficulty: 'normal', style: 'university' })
  const [length, setLength] = useState(8)
  const [difficulty, setDifficulty] = useState<'gentle' | 'normal' | 'hard'>('normal')
  const [language, setLanguage] = useState(() => localStorage.getItem('tide.interview.lang') ?? 'python')
  // Mixed practice: your recent and weak topics, unless you type a list
  const [mixList, setMixList] = useState<string | null>(null)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [mastery, setMastery] = useState<Record<string, Mastery>>({})
  const [focused, setFocused] = useState(false)
  // The card the pointer or keyboard is on: only its tutor moves
  const [live, setLive] = useState<string | null>(null)

  useEffect(() => {
    window.tide.vault.notes().then(setNotes)
    window.tide.learn.mastery().then(setMastery)
  }, [app.files])

  // Default to what the student was just reading
  useEffect(() => {
    const last = app.recent.find((p) => /\.(md|pdf)$/i.test(p))
    if (last && !topic) {
      setSource({ kind: 'note', path: last })
      setTopic(fileTitle(last))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const notebooks = useMemo(() => app.tree?.children?.filter((c) => c.type === 'folder' && c.path !== app.settings.libraryFolder) ?? [], [app.tree, app.settings.libraryFolder])
  const suggestions = useMemo(() => {
    const q = topic.trim().toLowerCase()
    if (!q || !focused) return []
    const nb = mode === 'review' ? [] : notebooks.filter((n) => n.name.toLowerCase().includes(q)).map((n) => ({ scope: { kind: 'folder', path: n.path } as ChatScope, label: n.name, kind: 'Notebook' }))
    const ns = notes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((n) => ({ scope: { kind: 'note', path: n.path } as ChatScope, label: n.title, kind: n.path.endsWith('.pdf') ? 'PDF' : 'Note' }))
    return [...nb, ...ns].slice(0, 7)
  }, [topic, focused, notes, notebooks, mode])

  const weak = useMemo(
    () =>
      Object.values(mastery)
        .filter((m) => m.level === 'weak' || m.level === 'shaky' || m.misconceptions > 0)
        .sort((a, b) => b.misconceptions - a.misconceptions || a.score - b.score)
        .slice(0, 8),
    [mastery]
  )
  const titleOf = (path: string) => notes.find((n) => n.path === path)?.title ?? fileTitle(path)

  // Interleaving: a mix of weak and recently studied topics, from as many notebooks as possible
  const mixTopics = useMemo(() => {
    const picked: string[] = []
    const seenFolders = new Set<string>()
    const pool = [...weak.map((m) => m.path), ...app.recent.filter((p) => /\.(md|pdf)$/i.test(p))]
    for (const p of pool) {
      const folder = p.split('/')[0]
      const title = titleOf(p)
      if (picked.includes(title)) continue
      if (seenFolders.has(folder) && picked.length < 3) continue
      seenFolders.add(folder)
      picked.push(title)
      if (picked.length >= 6) break
    }
    return picked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weak, app.recent, notes])
  const typedMix = (mixList ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)

  const start = (m: LearnMode = mode, scope: ChatScope = source, t: string = topic) => {
    if (m === 'mixed') {
      const topics = typedMix.length ? typedMix : mixTopics
      app.setView({
        kind: 'session',
        mode: 'quiz',
        scope: { kind: 'vault' },
        topic: `mixed practice, interleaving questions across: ${topics.join('; ')}. Switch topic every question and never ask two in a row on the same one`,
        options: { length, difficulty },
        nonce: Date.now()
      })
      return
    }
    if (m === 'comprehension') {
      app.setView({ kind: 'comprehension' })
      return
    }
    if (m === 'exam') {
      app.setView({ kind: 'exam', scope, topic: t.trim() || 'what I have been studying', options: { ...exam, difficulty }, nonce: Date.now() })
      return
    }
    // Reviewing writing opens the piece in Writing: comments beside the text, the challenge conversation a click away
    if (m === 'review' && scope.kind === 'note' && /\.md$/i.test(scope.path)) {
      app.setView({ kind: 'writing', path: scope.path, review: true, nonce: Date.now() })
      return
    }
    if (m === 'interview') localStorage.setItem('tide.interview.lang', language)
    app.setView({ kind: 'session', ...sessionPlan(m, scope, t), nonce: Date.now() })
  }

  // The lesson Start would open (not exams or mixed practice, which begin differently)
  function sessionPlan(m: LearnMode, scope: ChatScope, t: string) {
    const options: SessionSetup['options'] = m === 'quiz' ? { length, difficulty } : m === 'interview' ? { language, difficulty } : undefined
    return { mode: m as SessionSetup['mode'], scope, topic: t.trim() || 'what I have been studying', options }
  }

  // While you settle on a topic, the model reads that lesson's opening in the background, so it
  // starts writing the moment you press start instead of reading for ten seconds first
  const warmKey = mode === 'exam' || mode === 'mixed' || mode === 'comprehension' || (mode === 'review' && source.kind !== 'note') || (!topic.trim() && source.kind === 'none') ? '' : JSON.stringify([mode, source, topic.trim(), length, difficulty, language])
  useEffect(() => {
    if (!warmKey) return
    const t = setTimeout(() => {
      const plan = sessionPlan(mode, source, topic)
      window.tide.ai.prewarm(openingRequest({ mode: plan.mode, topic: plan.topic, options: plan.options }, plan.scope, app.settings.character ?? 'professor')).catch(() => {})
      // Only once you've stopped typing: each warm-up reads the whole opening into the model
    }, 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmKey])

  const needsNote = mode === 'review' && source.kind !== 'note'
  const way = WAYS.find((w) => w.id === mode)!
  const canStart = mode === 'comprehension' ? true : mode === 'mixed' ? typedMix.length > 0 || mixTopics.length > 0 : !needsNote && (!!topic.trim() || source.kind !== 'none')

  const counts = ready ? readyCounts(ready) : []
  const countLine = counts.map((c) => (c.n !== undefined ? `${c.n} ${c.label}` : `a ${c.label.toLowerCase()}`)).join(' · ')

  const topicField = (
    <div className="lrn-topic">
      <label className="lrn-field">
        <Icon name="search" size={15} />
        <input
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value)
            setSource({ kind: 'none' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && canStart) start()
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={mode === 'interview' ? 'A topic, or a LeetCode problem' : mode === 'review' ? 'Choose a note or essay' : 'A topic, note, notebook or PDF'}
          aria-label={mode === 'review' ? 'Piece' : 'Topic'}
        />
        {source.kind !== 'none' && (
          <span className="lrn-source">
            <Icon name={source.kind === 'folder' ? 'folder' : source.kind === 'note' && /\.pdf$/i.test(source.path) ? 'pdf' : 'note'} size={12} />
            {source.kind === 'folder' ? 'Notebook' : source.kind === 'note' && /\.pdf$/i.test(source.path) ? 'PDF' : 'Note'}
          </span>
        )}
      </label>
      {suggestions.length > 0 && (
        <div className="popover learn-suggest">
          {suggestions.map((s) => (
            <button
              key={s.label + s.kind}
              className="highlight-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSource(s.scope)
                setTopic(s.label)
                setFocused(false)
              }}
            >
              <Icon name={s.kind === 'Notebook' ? 'folder' : s.kind === 'PDF' ? 'pdf' : 'note'} size={14} />
              <span className="highlight-text">{s.label}</span>
              <span className="muted small">{s.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const difficultyRow = (
    <Row label="Difficulty">
      <Seg<typeof difficulty> label="Difficulty" value={difficulty} options={DIFFICULTY} onChange={setDifficulty} />
    </Row>
  )
  const questionsRow = (
    <Row label="Questions">
      <Seg<number> label="Questions" value={length} options={[5, 8, 12, 20].map((n) => ({ value: n, label: String(n) }))} onChange={setLength} />
    </Row>
  )

  return (
    <div className="page learn lrn">
      <div className="page-inner lrn-inner">
        <h1 className="lrn-title">Learn</h1>
        <p className="lrn-sub">Start where the plan says, or choose a way.</p>

        {ready && (
          <section className="lrn-banner" aria-label="Up next">
            <PixelProf pose="eureka" scale={2} className="lrn-banner-prof" />
            <div className="lrn-banner-text">
              <span className="lrn-label">{ready.notebook ? `Up next · ${ready.notebook}` : 'Up next'}</span>
              <b title={ready.why}>{ready.topic}</b>
              {countLine && <span className="lrn-label">{countLine}</span>}
            </div>
            <button className="lrn-btn primary large" onClick={() => startPrepared(app, ready)}>
              Start
            </button>
          </section>
        )}

        <div className="lrn-ways" role="radiogroup" aria-label="Ways to learn">
          {WAYS.map((w) => (
            <button
              key={w.id}
              role="radio"
              aria-checked={mode === w.id}
              className={`lrn-card${w.id === 'teach' ? ' wide' : ''}`}
              onClick={() => setMode(w.id)}
              onMouseEnter={() => setLive(w.id)}
              onMouseLeave={() => setLive((l) => (l === w.id ? null : l))}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && setLive(w.id)}
              onBlur={() => setLive((l) => (l === w.id ? null : l))}
            >
              <span className={`lrn-stage${live === w.id ? ' live' : ''}`} aria-hidden="true">
                <span className="lrn-art">{WAY_ART[w.id]}</span>
                <span className="lrn-prof">
                  {live === w.id && <PixelProf pose={w.pose} scale={4} playing />}
                  <span className="lrn-say">{w.say}</span>
                </span>
              </span>
              <span className="lrn-card-text">
                <b>{w.name}</b>
                <span>{w.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="lrn-sheet" aria-label={`${way.name}: settings`}>
          {mode === 'comprehension' ? (
            <Row label="From">
              <span className="lrn-plain">The next passage of the book you’re reading, or one you select in the reader</span>
            </Row>
          ) : mode === 'mixed' ? (
            <Row label="Topics">
              {mixList === null ? (
                <span className="lrn-plain">
                  {mixTopics.length ? mixTopics.slice(0, 4).join(', ') + (mixTopics.length > 4 ? '…' : '') : 'Your recent and weak topics'}
                  <button className="lrn-btn small ghost" onClick={() => setMixList('')}>
                    Change
                  </button>
                </span>
              ) : (
                <label className="lrn-field">
                  <input
                    autoFocus
                    value={mixList}
                    onChange={(e) => setMixList(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && canStart) start()
                      if (e.key === 'Escape') setMixList(null)
                    }}
                    placeholder="Topics to mix, separated by commas"
                    aria-label="Topics to mix"
                  />
                  <button className="lrn-btn small ghost" onClick={() => setMixList(null)}>
                    Use my recent topics
                  </button>
                </label>
              )}
            </Row>
          ) : (
            <Row label={mode === 'review' ? 'Piece' : 'Topic'}>{topicField}</Row>
          )}

          {mode === 'quiz' && (
            <>
              {questionsRow}
              {difficultyRow}
            </>
          )}
          {mode === 'mixed' && (
            <>
              {questionsRow}
              {difficultyRow}
            </>
          )}
          {mode === 'exam' && (
            <>
              <Row label="Questions">
                <Seg label="Questions" value={exam.questions} options={[2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => setExam({ ...exam, questions: v })} />
              </Row>
              <Row label="Time">
                <Choose<number> label="Time" value={exam.minutes} options={[{ value: 0, label: 'No limit' }, ...[20, 30, 45, 60, 90, 120, 180].map((n) => ({ value: n, label: `${n} minutes` }))]} onChange={(v) => setExam({ ...exam, minutes: v })} />
              </Row>
              <Row label="Style">
                <Seg
                  label="Style"
                  value={exam.style}
                  options={[
                    { value: 'university', label: 'University paper' },
                    { value: 'problems', label: 'Problem sheet' },
                    { value: 'short', label: 'Short answers' }
                  ]}
                  onChange={(v) => setExam({ ...exam, style: v as ExamOptions['style'] })}
                />
              </Row>
              {difficultyRow}
            </>
          )}
          {mode === 'interview' && (
            <>
              <Row label="Language">
                <Choose<string> label="Language" value={language} options={LANGUAGES.map((l) => ({ value: l, label: l }))} onChange={setLanguage} />
              </Row>
              {difficultyRow}
            </>
          )}

          <div className="lrn-go">
            {needsNote && <span className="lrn-label">Choose a note to review</span>}
            <button className="lrn-btn primary" disabled={!canStart} onClick={() => start()}>
              {way.start}
            </button>
          </div>
        </section>

        <LearnShelf weak={weak} titleOf={titleOf} onStart={(m, path) => start(m, { kind: 'note', path }, titleOf(path))} />
      </div>
    </div>
  )
}
