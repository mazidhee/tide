import { useEffect, useMemo, useState } from 'react'
import type { ChatScope, ExamOptions, Mastery, NoteMeta, SessionMode } from '@shared/types'
import type { SessionSetup } from '@shared/session'
import { fileTitle, useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { PillSegment, PromptBox } from './PromptBox'
import { openingRequest } from '../lib/openingRequest'
import { PixelScene } from './PixelScene'
import { WorkshopShelf } from './WorkshopView'
import { CourseShelf } from './CoursesView'

type LearnMode = SessionMode | 'exam' | 'mixed'

const MODES: { id: LearnMode; label: string; icon: IconName; description: string }[] = [
  { id: 'teach', label: 'Teach', icon: 'tutor', description: 'Probes what you know, plans a path, teaches step by step' },
  { id: 'quiz', label: 'Quiz', icon: 'quiz', description: 'Adaptive questions; misses become flashcards' },
  { id: 'mixed', label: 'Mixed', icon: 'refresh', description: 'Questions mixed across topics and notebooks, the strongest way to practise' },
  { id: 'interview', label: 'Interview', icon: 'terminal', description: 'Approach, code, follow-ups and a scorecard' },
  { id: 'review', label: 'Review', icon: 'edit', description: 'Grades your note and challenges its claims' },
  { id: 'exam', label: 'Exam', icon: 'timer', description: 'A timed paper; type or photograph answers' }
]

const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'c++', 'go', 'rust']

export const LEVEL_LABEL: Record<Mastery['level'], string> = {
  new: 'Not tested',
  weak: 'Weak',
  shaky: 'Shaky',
  solid: 'Solid',
  mastered: 'Mastered'
}

export function LearnView() {
  const app = useApp()
  const [topic, setTopic] = useState('')
  const [source, setSource] = useState<ChatScope>({ kind: 'none' })
  const [mode, setMode] = useState<LearnMode>('teach')
  const [exam, setExam] = useState<ExamOptions>({ questions: 4, minutes: 45, difficulty: 'normal', style: 'university' })
  const [length, setLength] = useState(8)
  const [difficulty, setDifficulty] = useState<'gentle' | 'normal' | 'hard'>('normal')
  const [language, setLanguage] = useState(() => localStorage.getItem('tide.interview.lang') ?? 'python')
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [mastery, setMastery] = useState<Record<string, Mastery>>({})
  const [focused, setFocused] = useState(false)

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
    const nb = notebooks.filter((n) => n.name.toLowerCase().includes(q)).map((n) => ({ scope: { kind: 'folder', path: n.path } as ChatScope, label: n.name, kind: 'Notebook' }))
    const ns = notes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((n) => ({ scope: { kind: 'note', path: n.path } as ChatScope, label: n.title, kind: n.path.endsWith('.pdf') ? 'PDF' : 'Note' }))
    return [...nb, ...ns].slice(0, 7)
  }, [topic, focused, notes, notebooks])

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

  const start = (m: LearnMode = mode, scope: ChatScope = source, t: string = topic) => {
    if (m === 'mixed') {
      const topics = t.trim() ? t.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : mixTopics
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
    if (m === 'exam') {
      app.setView({ kind: 'exam', scope, topic: t.trim() || 'what I have been studying', options: { ...exam, difficulty }, nonce: Date.now() })
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
  const warmKey = mode === 'exam' || mode === 'mixed' || (mode === 'review' && source.kind !== 'note') || (!topic.trim() && source.kind === 'none') ? '' : JSON.stringify([mode, source, topic.trim(), length, difficulty, language])
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

  const selected = MODES.find((m) => m.id === mode)!
  const canStart = mode === 'mixed' ? !!topic.trim() || mixTopics.length > 0 : !needsNote && (!!topic.trim() || source.kind !== 'none')

  return (
    <div className="page learn">
      <PixelScene place="classroom" rows={40} scale={3} className="page-scene" />
      <div className="page-inner narrow">
        <h1 className="page-title">Learn</h1>

        <div className="lrn-modes" role="radiogroup" aria-label="How">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={`lrn-mode${mode === m.id ? ' on' : ''}`} onClick={() => setMode(m.id)} title={m.description}>
              <Icon name={m.icon} size={17} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="learn-topic">
          <PromptBox
            value={topic}
            onChange={(v: string) => {
              setTopic(v)
              setSource({ kind: 'none' })
            }}
            onSubmit={() => start()}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            ready={canStart}
            label="Topic"
            placeholder={mode === 'mixed'
                ? mixTopics.length
                  ? mixTopics.slice(0, 3).join(', ') + (mixTopics.length > 3 ? '…' : '')
                  : 'Topics to mix, separated by commas'
                : mode === 'interview'
                  ? 'A topic, or a LeetCode problem'
                  : mode === 'review'
                    ? 'Pick a note to review'
                    : 'What do you want to learn?'}
            tools={
              <>
                {source.kind !== 'none' && (
                  <span className="learn-source">
                    <Icon name={source.kind === 'folder' ? 'folder' : source.kind === 'note' && /\.pdf$/i.test(source.path) ? 'pdf' : 'note'} size={13} />
                    {source.kind === 'folder' ? 'Notebook' : 'Note'}
                  </span>
                )}
                {(mode === 'quiz' || mode === 'mixed') && (
                  <label className="pill select">
                    <select value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="Questions">
                      {[5, 8, 12, 20].map((n) => (
                        <option key={n} value={n}>
                          {n} questions
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron" size={11} className="pill-caret" />
                  </label>
                )}
                {mode === 'interview' && (
                  <label className="pill select">
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
                      {LANGUAGES.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                    <Icon name="chevron" size={11} className="pill-caret" />
                  </label>
                )}
                {mode === 'exam' && (
                  <>
                    <label className="pill select">
                      <select value={exam.questions} onChange={(e) => setExam({ ...exam, questions: Number(e.target.value) })} aria-label="Questions">
                        {[2, 3, 4, 6, 8].map((n) => (
                          <option key={n} value={n}>
                            {n} questions
                          </option>
                        ))}
                      </select>
                      <Icon name="chevron" size={11} className="pill-caret" />
                    </label>
                    <label className="pill select">
                      <select value={exam.minutes} onChange={(e) => setExam({ ...exam, minutes: Number(e.target.value) })} aria-label="Time">
                        <option value={0}>No limit</option>
                        {[20, 30, 45, 60, 90, 120, 180].map((n) => (
                          <option key={n} value={n}>
                            {n} min
                          </option>
                        ))}
                      </select>
                      <Icon name="chevron" size={11} className="pill-caret" />
                    </label>
                    <label className="pill select">
                      <select value={exam.style} onChange={(e) => setExam({ ...exam, style: e.target.value as ExamOptions['style'] })} aria-label="Style">
                        <option value="university">University paper</option>
                        <option value="problems">Problem sheet</option>
                        <option value="short">Short answers</option>
                      </select>
                      <Icon name="chevron" size={11} className="pill-caret" />
                    </label>
                  </>
                )}
                {(mode === 'quiz' || mode === 'mixed' || mode === 'interview' || mode === 'exam') && (
                  <PillSegment
                    label="Difficulty"
                    value={difficulty}
                    onChange={(v) => setDifficulty(v as typeof difficulty)}
                    options={[
                      { value: 'gentle', label: 'Gentle' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'hard', label: 'Hard' }
                    ]}
                  />
                )}
              </>
            }
          />
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
        <p className="lrn-desc">{selected.description}</p>

        {/* Hook: guided projects (components/WorkshopView.tsx) */}
        <WorkshopShelf />
        {/* Hook: open courses from GitHub (components/CoursesView.tsx) */}
        <CourseShelf />

        {weak.length > 0 && (
          <section className="lrn-weak">
            <h2 className="section-title">Worth revisiting</h2>
            <div className="lrn-weak-grid">
              {weak.map((m) => (
                <div key={m.path} className="lrn-weak-card">
                  <button className="lrn-weak-title" onClick={() => app.openPath(m.path)} title={titleOf(m.path)}>
                    {titleOf(m.path)}
                  </button>
                  <div className="lrn-weak-foot">
                    <span className={`level-pill level-${m.level}`}>{LEVEL_LABEL[m.level]}</span>
                    {m.misconceptions > 0 && <span className="muted small">{m.misconceptions} confident miss{m.misconceptions === 1 ? '' : 'es'}</span>}
                    <span className="lrn-weak-actions">
                      <button className="icon-btn small" title="Quiz me" onClick={() => start('quiz', { kind: 'note', path: m.path }, titleOf(m.path))}>
                        <Icon name="quiz" size={14} />
                      </button>
                      <button className="icon-btn small" title="Teach me" onClick={() => start('teach', { kind: 'note', path: m.path }, titleOf(m.path))}>
                        <Icon name="tutor" size={14} />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
