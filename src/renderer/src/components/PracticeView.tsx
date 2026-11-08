import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatScope, PracticeProblem, PracticeStatus } from '@shared/types'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PillSegment, PillSelect, PromptBox } from './PromptBox'
import { ContextMenu, type MenuState } from './Menu'
import { CompanyPrep } from './CompanyPrep'
import { QuantPanel } from './QuantPanel'
import { DesignPanel } from './DesignPanel'
import { PixelScene } from './PixelScene'

const STATUS_LABEL: Record<PracticeStatus, string> = { todo: 'To do', solved: 'Solved', struggled: 'Struggled', redo: 'Try again' }
const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'c++', 'go', 'rust']
type Filter = 'all' | PracticeStatus

type Tab = 'coding' | 'problems' | 'quant' | 'design' | 'companies'
const TABS: { id: Tab; label: string; icon: 'sparkle' | 'quiz' | 'summary' | 'canvas' | 'globe' }[] = [
  { id: 'coding', label: 'Coding', icon: 'sparkle' },
  { id: 'problems', label: 'Problems', icon: 'quiz' },
  { id: 'quant', label: 'Quant', icon: 'summary' },
  { id: 'design', label: 'System design', icon: 'canvas' },
  { id: 'companies', label: 'Companies', icon: 'globe' }
]

const ago = (t: number) => {
  const d = Math.round((Date.now() - t) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}
const until = (t: number) => {
  const d = Math.ceil((t - Date.now()) / 86_400_000)
  return d <= 0 ? 'due now' : d === 1 ? 'due tomorrow' : `due in ${d} days`
}

export function PracticeView() {
  const app = useApp()
  const [problems, setProblems] = useState<PracticeProblem[] | null>(null)
  const [patterns, setPatterns] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [input, setInput] = useState('')
  const [difficulty, setDifficulty] = useState<PracticeProblem['difficulty']>('medium')
  const [pattern, setPattern] = useState('Arrays & hashing')
  const [language, setLanguage] = useState(() => localStorage.getItem('tide.interview.lang') ?? 'python')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('tide.practice.tab') as Tab | null
    return saved && TABS.some((t) => t.id === saved) ? saved : 'coding'
  })
  const pickTab = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem('tide.practice.tab', t)
    } catch {
      // remembered for this session only
    }
  }
  useEffect(() => localStorage.setItem('tide.interview.lang', language), [language])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [list, pats] = await Promise.all([window.tide.practice.list(), window.tide.practice.patterns()])
    setProblems(list)
    setPatterns(pats)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    const text = input.trim()
    if (!text) return
    setError('')
    try {
      const isUrl = /^https?:\/\//.test(text)
      await window.tide.practice.add({ title: isUrl ? undefined : text, url: isUrl ? text : undefined, difficulty, patterns: [pattern] })
      setInput('')
      load()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const interview = (p: PracticeProblem) => {
    localStorage.setItem('tide.interview.lang', language)
    app.setView({
      kind: 'session',
      mode: 'interview',
      scope: p.kind === 'challenge' ? p.source ?? { kind: 'vault' } : { kind: 'none' },
      topic: p.kind === 'challenge' ? `a coding challenge on ${p.title}` : `${p.title} (${p.url})`,
      options: { language, difficulty: p.difficulty === 'easy' ? 'gentle' : p.difficulty === 'hard' ? 'hard' : 'normal', problemId: p.id },
      nonce: Date.now()
    })
  }

  const counts = useMemo(() => {
    const c: Record<PracticeStatus, number> = { todo: 0, solved: 0, struggled: 0, redo: 0 }
    problems?.forEach((p) => c[p.status]++)
    return c
  }, [problems])

  const visible = (problems ?? []).filter((p) => filter === 'all' || p.status === filter)
  const due = (problems ?? []).filter((p) => p.status === 'redo').sort((a, b) => (a.due ?? 0) - (b.due ?? 0))
  const groups = patterns.map((pat) => ({ pat, items: visible.filter((p) => p.patterns[0] === pat) })).filter((g) => g.items.length)

  const openMenu = (e: React.MouseEvent, p: PracticeProblem) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(p.url ? [{ label: 'Open on LeetCode', run: () => window.tide.app.openExternal(p.url) }] : []),
        { label: 'Mark as solved', run: async () => (await window.tide.practice.update(p.id, { status: 'solved' }), load()), separatorBefore: !!p.url },
        { label: 'Mark as struggled', run: async () => (await window.tide.practice.update(p.id, { status: 'struggled' }), load()) },
        { label: 'Mark as to do', run: async () => (await window.tide.practice.update(p.id, { status: 'todo' }), load()) },
        ...(['easy', 'medium', 'hard'] as const).map((d, i) => ({
          label: `Difficulty: ${d[0].toUpperCase() + d.slice(1)}`,
          run: async () => (await window.tide.practice.update(p.id, { difficulty: d }), load()),
          separatorBefore: i === 0
        })),
        { label: 'Remove', danger: true, separatorBefore: true, run: async () => (await window.tide.practice.remove(p.id), load()) }
      ]
    })

  const row = (p: PracticeProblem) => {
    const last = p.attempts.at(-1)
    return (
      <li key={p.id} className="pr-row" onContextMenu={(e) => (e.preventDefault(), openMenu(e, p))}>
        <span className={`pr-status s-${p.status}`} title={STATUS_LABEL[p.status]} />
        <div className="pr-main">
          <span className="pr-title">{p.title}</span>
          <span className="pr-meta">
            {last ? `${ago(last.at)}, ${Math.round(last.score * 100)}%` : 'Not tried yet'}
            {p.due && p.status !== 'todo' ? `, ${until(p.due)}` : ''}
          </span>
        </div>
        <span className={`pr-diff d-${p.difficulty}`}>{p.difficulty[0].toUpperCase() + p.difficulty.slice(1)}</span>
        {p.url ? (
          <button className="icon-btn" title="Open on LeetCode" onClick={() => window.tide.app.openExternal(p.url)}>
            <Icon name="external" size={14} />
          </button>
        ) : (
          <span className="pr-source" title="Tide writes a new challenge on this each time">
            {p.source?.kind === 'folder' ? p.source.path : p.source?.kind === 'pages' ? 'Book chapter' : p.source?.kind === 'note' ? 'Note' : 'Topic'}
          </span>
        )}
        <button className="btn small" onClick={() => interview(p)}>
          {p.kind === 'challenge' ? 'Challenge me' : 'Interview me'}
        </button>
        <button className="icon-btn" title="More" onClick={(e) => openMenu(e, p)}>
          <Icon name="more" />
        </button>
      </li>
    )
  }

  const solvedCount = counts.solved
  const challenges = (problems ?? []).filter((p) => p.kind === 'challenge')
  const lastChallenge = [...challenges].sort((a, b) => (b.attempts.at(-1)?.at ?? 0) - (a.attempts.at(-1)?.at ?? 0))[0]

  return (
    <div className="page practice">
      <PixelScene key={tab} place={tab === 'coding' || tab === 'problems' ? 'terminal' : tab === 'quant' ? 'math' : 'workshop'} rows={40} scale={3} className="page-scene" />
      <div className="page-inner">
        <header className="pv-head">
          <div>
            <h1 className="page-title">Practice</h1>
            <p className="practice-summary">
              {problems && problems.some((p) => p.attempts.length) ? (
                <>
                  <strong>{counts.solved}</strong> solved, <strong>{counts.struggled}</strong> struggled, <strong>{counts.redo}</strong> ready to try again.
                </>
              ) : (
                'Learn by doing.'
              )}
            </p>
          </div>
          <div className="pv-tools">
            <button className="tool-btn" onClick={() => app.setView({ kind: 'code' })} title="Editor, Run and a terminal">
              <Icon name="edit" />
              <span>Playground</span>
            </button>
            <button className="tool-btn" onClick={() => app.setView({ kind: 'lab', terminal: 'lab', nonce: Date.now() })} title="The command line in a safe sandbox">
              <Icon name="terminal" />
              <span>Linux lab</span>
            </button>
          </div>
        </header>

        <nav className="pv-tabs" role="tablist" aria-label="Kinds of practice">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`pv-tab${tab === t.id ? ' on' : ''}`} onClick={() => pickTab(t.id)}>
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {tab === 'coding' && (
          <section className="pv-prompt">
            <h2 className="pv-title">A coding challenge on what you're learning</h2>
            <p className="pv-sub">An original problem, a mock interview on it, your code run on real tests.</p>
            <ChallengeForm
              language={language}
              onLanguage={setLanguage}
              onStart={async (title, source, diff) => {
                try {
                  const p = await window.tide.practice.addChallenge({ title, source, difficulty: diff })
                  await load()
                  interview(p)
                } catch (e) {
                  setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
                }
              }}
            />
            <p className="pv-meta">
              <span>
                <strong>{challenges.length}</strong> challenge{challenges.length === 1 ? '' : 's'} so far
              </span>
              {lastChallenge && (
                <button className="link-btn quiet" onClick={() => interview(lastChallenge)} title="Another challenge on this">
                  <Icon name="refresh" size={12} />
                  Again: {lastChallenge.title}
                </button>
              )}
            </p>
          </section>
        )}

        {tab === 'problems' && (
          <section className="pv-prompt">
            <h2 className="pv-title">Interview problems, tracked by pattern</h2>
            <p className="pv-sub">Struggled ones come back in two days; clean solves in a week, then longer.</p>
            <PromptBox
              value={input}
              onChange={setInput}
              onSubmit={add}
              placeholder="Paste a LeetCode link or type a problem name"
              action="Add"
              tools={
                <>
                  <PillSegment
                    label="Difficulty"
                    value={difficulty}
                    onChange={(v) => setDifficulty(v as PracticeProblem['difficulty'])}
                    options={[
                      { value: 'easy', label: 'Easy' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'hard', label: 'Hard' }
                    ]}
                  />
                  <PillSelect label="Pattern" icon="tag" value={pattern} onChange={setPattern} options={patterns.filter((p) => p !== 'Topic challenges').map((p) => ({ value: p, label: p }))} />
                </>
              }
            />
            <p className="pv-meta">
              <span>
                <strong>{solvedCount}</strong> solved
              </span>
              <span>
                <strong>{counts.struggled}</strong> struggled
              </span>
              <span>
                <strong>{counts.redo}</strong> to retry
              </span>
              {problems && !problems.some((p) => p.kind !== 'challenge') && (
                <button className="link-btn quiet" onClick={async () => (await window.tide.practice.addStarter(), load())}>
                  Add 49 classic problems covering every pattern
                </button>
              )}
            </p>
          </section>
        )}

        {tab === 'quant' && <QuantPanel />}
        {tab === 'design' && <DesignPanel />}
        {tab === 'companies' && (
          <section className="pv-prompt wide">
            <h2 className="pv-title">Prepare for a company</h2>
            <p className="pv-sub">Tide researches their interview loop, then runs mock rounds in their style.</p>
            <CompanyPrep language={language} />
          </section>
        )}

        {error && <p className="error-text">{error}</p>}


        {(tab === 'coding' || tab === 'problems') && (
          <>
        {due.length > 0 && filter === 'all' && (
          <section className="pr-group due">
            <h2 className="pr-group-head">
              <span>Ready to try again</span>
              <span className="muted small">{due.length}</span>
            </h2>
            <ul className="pr-list">{due.map(row)}</ul>
          </section>
        )}

        {problems && problems.length > 0 && <h2 className="section-title spaced">Your practice</h2>}
        {problems && problems.length > 0 && (
          <div className="chips pr-filters" role="tablist">
            {(['all', 'todo', 'struggled', 'redo', 'solved'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : STATUS_LABEL[f as PracticeStatus]}
                <span className="chip-count">{f === 'all' ? problems.length : counts[f as PracticeStatus]}</span>
              </button>
            ))}
          </div>
        )}

        {groups.map(({ pat, items }) => {
          const all = (problems ?? []).filter((p) => p.patterns[0] === pat)
          const solved = all.filter((p) => p.status === 'solved').length
          return (
            <section key={pat} className="pr-group">
              <h2 className="pr-group-head">
                <span>{pat}</span>
                <span className="pr-group-bar" aria-hidden="true">
                  <span style={{ width: `${(solved / all.length) * 100}%` }} />
                </span>
                <span className="muted small tabular">
                  {solved} of {all.length} solved
                </span>
              </h2>
              <ul className="pr-list">{items.map(row)}</ul>
            </section>
          )
        })}
          </>
        )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

/** Start a coding challenge on something you're learning: a topic, or what one of your notebooks covers */
function ChallengeForm({ language, onLanguage, onStart }: { language: string; onLanguage(l: string): void; onStart(title: string, source: ChatScope, difficulty: PracticeProblem['difficulty']): void }) {
  const [topic, setTopic] = useState('')
  const [from, setFrom] = useState('vault')
  const [difficulty, setDifficulty] = useState<PracticeProblem['difficulty']>('medium')
  const [notebooks, setNotebooks] = useState<string[]>([])
  useEffect(() => {
    window.tide.learn
      .notebooks()
      .then((n) => setNotebooks(n.map((x) => x.path)))
      .catch(() => {})
  }, [])
  const source: ChatScope = from === 'vault' ? { kind: 'vault' } : from === 'none' ? { kind: 'none' } : { kind: 'folder', path: from }
  return (
    <PromptBox
      value={topic}
      onChange={setTopic}
      onSubmit={() => onStart(topic.trim(), source, difficulty)}
      placeholder="What do you want to practise? Async Python, generators, B-tree indexes…"
      action="Start"
      tools={
        <>
          <PillSelect
            label="Draw on"
            icon="book"
            value={from}
            onChange={setFrom}
            options={[{ value: 'vault', label: 'All my notes' }, ...notebooks.map((n) => ({ value: n, label: n })), { value: 'none', label: 'General knowledge' }]}
          />
          <PillSegment
            label="Difficulty"
            value={difficulty}
            onChange={(v) => setDifficulty(v as PracticeProblem['difficulty'])}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' }
            ]}
          />
          <PillSelect label="Language" icon="terminal" value={language} onChange={onLanguage} options={LANGUAGES.map((l) => ({ value: l, label: l }))} />
        </>
      }
    />
  )
}
