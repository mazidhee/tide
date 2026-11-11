import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Goal, Mastery, NoteMeta } from '@shared/types'
import { GoalForm, GoalPanel } from './GoalPanel'
import { planGoal } from '../lib/goals'
import { LEVEL_LABEL } from './LearnView'
import { roadmapTopics, type CurriculumView, type Proposal, type RoadmapTopic, type SectionClass } from '@shared/curriculum'
import { headingTag, itemLink, lineRole, linkItemText, retitleItem, splitSource, topicTitle, normalizeTitle, parseOutline, sectionProgress, serializeOutline, type Outline, type OutlineLine } from '@shared/outline'
import { renderMarkdown } from '../lib/markdown'
import { isProjectItem } from '@shared/workshop'
import { readPlan } from '@shared/plan'
import { fileTitle, useApp } from '../state'
import { Icon } from './Icon'
import { ContextMenu, type MenuState } from './Menu'
import { OutlineToc } from './OutlineToc'
import { STATUS_LABEL } from './NotebookView'

const SAVE_DELAY = 500

interface Props {
  notebook: string
  outlinePath: string | undefined
  notes: Map<string, NoteMeta>
  mastery: Record<string, Mastery>
  onSetOutline(path: string | null): void
}

/** How each place in the plan reads on the roadmap */
const PLACE: Record<SectionClass, { label: string; menu: string; hint: string }> = {
  core: { label: 'Weekdays', menu: 'weekdays', hint: 'Your aims need this: planned on weekdays, in roadmap order' },
  supporting: { label: 'When needed', menu: 'when something needs it', hint: 'Planned on weekdays, because something your aims need builds on it' },
  enrichment: { label: 'Weekend', menu: 'weekend primer', hint: 'History or background: a short weekend read, not a weekday lesson' },
  elective: { label: 'Later', menu: 'later', hint: 'Not needed for your aims yet: kept for later' },
  skip: { label: 'Skip', menu: 'skip', hint: 'Not needed for any of your aims: never planned' }
}

/** Turns "Chapter 1: Numbers" into the folder it most likely belongs to */
function folderForHeading(app: ReturnType<typeof useApp>, notebook: string, heading: string | undefined): string {
  if (!heading) return notebook
  const target = normalizeTitle(heading.replace(/^chapter\s+\d+\s*[:.]\s*/i, ''))
  const folders: string[] = []
  const walk = (n: NonNullable<typeof app.tree>) => {
    if (n.type === 'folder' && n.path.startsWith(notebook)) folders.push(n.path)
    n.children?.forEach(walk)
  }
  if (app.tree) walk(app.tree)
  return (
    folders.find((f) => {
      const name = normalizeTitle(f.split('/').pop()!.replace(/^chapter\s+\d+\s*[—–:-]\s*/i, ''))
      return name && (name === target || name.startsWith(target) || target.startsWith(name))
    }) ?? notebook
  )
}

export function OutlineView({ notebook, outlinePath, notes, mastery, onSetOutline }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Where each topic sits in your plan (weekdays, weekend, later), from your aims; yours to change
  const [place, setPlace] = useState<CurriculumView | null>(null)
  const loadPlace = () => window.tide.curriculum.view(notebook).then(setPlace).catch(() => setPlace(null))
  useEffect(() => {
    loadPlace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook, outlinePath])
  const app = useApp()
  const [outline, setOutline] = useState<Outline | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [linking, setLinking] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])
  // Opened from Home's "Set a goal": the form is waiting
  const [goalForm, setGoalForm] = useState(() => {
    try {
      if (localStorage.getItem('tide.goal.open') !== notebook) return false
      localStorage.removeItem('tide.goal.open')
      return true
    } catch {
      return false
    }
  })
  // The roadmap first: commentary and book lists stay in the file, shown when you want them
  const [showNotes, setShowNotes] = useState(() => localStorage.getItem('tide.outline.notes') === 'on')
  const [showSources, setShowSources] = useState(() => localStorage.getItem('tide.outline.sources') === 'on')
  // Audit: a frank review of this roadmap, streamed in
  const [audit, setAudit] = useState<{ id: string; text: string; done: boolean } | null>(null)
  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        setAudit((a) => {
          if (!a || e.id !== a.id) return a
          if (e.type === 'delta') return { ...a, text: a.text + e.text }
          if (e.type === 'done') return { ...a, done: true }
          if (e.type === 'error') return { ...a, text: a.text || e.message, done: true }
          return a
        })
      }),
    []
  )
  // Alongside the written review: concrete changes from your aims, each yours to apply or dismiss
  const [proposals, setProposals] = useState<{ list: Proposal[]; busy: boolean; error?: string } | null>(null)
  const auditRun = useRef(0)
  const runAudit = () => {
    if (!outlinePath) return
    const id = `audit-${Date.now()}`
    setAudit({ id, text: '', done: false })
    window.tide.learn.auditRoadmap(id, outlinePath, Number(localStorage.getItem('tide.plan.hours')) || 6)
    setProposals({ list: [], busy: true })
    // Only the latest run's suggestions are shown
    const run = (auditRun.current += 1)
    window.tide.curriculum
      .propose(notebook)
      .then((list) => run === auditRun.current && setProposals({ list, busy: false }))
      .catch((e) => run === auditRun.current && setProposals({ list: [], busy: false, error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  }
  const settle = (p: Proposal) => setProposals((cur) => (cur ? { ...cur, list: cur.list.filter((x) => x !== p) } : cur))
  const apply = async (p: Proposal) => {
    try {
      if (p.kind === 'place') for (const id of p.ids) await window.tide.curriculum.setOverride(id, p.to)
      else {
        // Save any edit still waiting first, so the added line isn't written over; then read it back
        if (dirty.current && latest.current && outlinePath) {
          clearTimeout(saveTimer.current)
          await window.tide.vault.write(outlinePath, serializeOutline(latest.current))
          dirty.current = false
        }
        if (!(await window.tide.curriculum.addTopic(notebook, p.after, p.title))) throw new Error('The roadmap changed, or it already has that topic.')
        if (outlinePath) setOutline(parseOutline(await window.tide.vault.read(outlinePath)))
      }
      settle(p)
      loadPlace()
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  // A dated plan can live in Things 4; its progress comes back when you open the roadmap
  const [thingsReady, setThingsReady] = useState(false)
  useEffect(() => {
    window.tide.learn.thingsStatus().then((s) => setThingsReady(s.ready)).catch(() => {})
  }, [])
  const stored = outline ? readPlan(outline.preamble ?? '') : null
  useEffect(() => {
    if (!outlinePath || !stored?.thingsProject || !thingsReady) return
    window.tide.learn
      .syncFromThings(outlinePath)
      .then((n) => n && app.toast(`Ticked ${n} topic${n === 1 ? '' : 's'} you finished in Things 4`))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlinePath, stored?.thingsProject, thingsReady])
  const sendToThings = async () => {
    if (!outlinePath) return
    try {
      const r = await window.tide.learn.planToThings(outlinePath, notebook.split('/').pop() ?? notebook, notebook)
      app.toast(`Added to Things 4: ${r.todos} tasks with dates`)
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  const flip = (key: string, value: boolean, set: (v: boolean) => void) => {
    set(value)
    try {
      localStorage.setItem(key, value ? 'on' : 'off')
    } catch {
      // remembered for this session only
    }
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const focusNext = useRef<number | null>(null)
  const dirty = useRef(false)
  const latest = useRef<Outline | null>(null)
  latest.current = outline

  const collapseKey = `tide.outline.collapsed.${outlinePath}`

  useEffect(() => {
    window.tide.goals.list().then(setGoals)
  }, [])
  const saveGoals = (next: Goal[]) => {
    setGoals(next)
    window.tide.goals.save(next)
  }

  useEffect(() => {
    if (!outlinePath) return setOutline(null)
    window.tide.vault.read(outlinePath).then((md) => setOutline(parseOutline(md))).catch(() => setOutline(null))
    try {
      setCollapsed(new Set(JSON.parse(localStorage.getItem(collapseKey) ?? '[]')))
    } catch {
      setCollapsed(new Set())
    }
  }, [outlinePath, collapseKey])

  // Reload if the file changes elsewhere, unless we're mid-edit
  useEffect(
    () =>
      window.tide.vault.onChange((paths) => {
        if (outlinePath && paths.includes(outlinePath) && !dirty.current) {
          window.tide.vault.read(outlinePath).then((md) => setOutline(parseOutline(md)))
        }
      }),
    [outlinePath]
  )

  useEffect(() => {
    if (focusNext.current === null) return
    const el = inputs.current.get(focusNext.current)
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
    focusNext.current = null
  })

  const commit = useCallback(
    (lines: OutlineLine[]) => {
      if (!latest.current) return
      const next = { ...latest.current, lines }
      latest.current = next
      setOutline(next)
      dirty.current = true
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        if (latest.current && outlinePath) await window.tide.vault.write(outlinePath, serializeOutline(latest.current))
        dirty.current = false
      }, SAVE_DELAY)
    },
    [outlinePath]
  )

  // Flush a pending save when leaving the notebook
  useEffect(
    () => () => {
      if (dirty.current && latest.current && outlinePath) {
        clearTimeout(saveTimer.current)
        window.tide.vault.write(outlinePath, serializeOutline(latest.current))
      }
    },
    [outlinePath]
  )

  // Note lookup by normalized title, for links and suggestions
  const notebookNotes = useMemo(() => [...notes.values()].filter((n) => n.path.startsWith(notebook + '/') && n.path !== outlinePath), [notes, notebook, outlinePath])
  const byName = useMemo(() => {
    const m = new Map<string, NoteMeta>()
    for (const n of notes.values()) m.set(fileTitle(n.path).toLowerCase(), n)
    return m
  }, [notes])
  const byNormal = useMemo(() => {
    const m = new Map<string, NoteMeta>()
    for (const n of notebookNotes) {
      m.set(normalizeTitle(fileTitle(n.path)), n)
      m.set(normalizeTitle(n.title), n)
    }
    return m
  }, [notebookNotes])

  const suggestionFor = (text: string): NoteMeta | undefined => (itemLink(text).target ? undefined : byNormal.get(normalizeTitle(topicTitle(text))))

  // Each roadmap line's topic (its id), for where it sits in the plan; a hook, so above the early return
  const topicAt = useMemo(() => new Map(outline ? roadmapTopics(notebook.split('/').pop() ?? notebook, serializeOutline(outline)).map((t) => [t.line, t]) : []), [outline, notebook])

  if (!outlinePath || !outline) {
    return <OutlineEmpty notebook={notebook} notes={notes} onSetOutline={onSetOutline} />
  }

  const lines = outline.lines
  const set = (i: number, patch: Partial<OutlineLine>) => commit(lines.map((l, j) => (j === i ? ({ ...l, ...patch } as OutlineLine) : l)))
  const insertAfter = (i: number, line: OutlineLine) => {
    const next = [...lines]
    next.splice(i + 1, 0, line)
    focusNext.current = i + 1
    commit(next)
  }
  const remove = (i: number) => {
    const next = lines.filter((_, j) => j !== i)
    let prev = i - 1
    while (prev >= 0 && next[prev]?.kind !== 'item') prev--
    focusNext.current = prev >= 0 ? prev : null
    commit(next)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= lines.length) return
    const next = [...lines]
    ;[next[i], next[j]] = [next[j], next[i]]
    focusNext.current = j
    commit(next)
  }

  // Which heading each line sits under, for collapsing and for choosing a note's folder
  const headingOf: number[] = []
  const hiddenBy: (number | null)[] = []
  {
    const stack: number[] = []
    lines.forEach((l, i) => {
      if (l.kind === 'heading' && lineRole(lines, i) === 'title') {
        hiddenBy[i] = null
        headingOf[i] = -1
        return
      }
      if (l.kind === 'heading') {
        while (stack.length && (lines[stack[stack.length - 1]] as { level: number }).level >= l.level) stack.pop()
        hiddenBy[i] = stack.find((h) => collapsed.has(h)) ?? null
        stack.push(i)
      } else hiddenBy[i] = stack.find((h) => collapsed.has(h)) ?? null
      headingOf[i] = stack[stack.length - 1] ?? -1
    })
  }

  const replaceCollapsed = (next: Set<number>) => {
    setCollapsed(next)
    try {
      localStorage.setItem(collapseKey, JSON.stringify([...next]))
    } catch {
      // folds are remembered for this session only
    }
  }

  const toggleCollapse = (i: number) => {
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      localStorage.setItem(collapseKey, JSON.stringify([...n]))
      return n
    })
  }

  const items = lines.filter((l): l is Extract<OutlineLine, { kind: 'item' }> => l.kind === 'item' && l.checked !== null)
  const done = items.filter((l) => l.checked).length
  // The first topic not yet done: where you are in the roadmap
  const choosePlace = (e: React.MouseEvent, t: RoadmapTopic, own: boolean) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const put = (id: string, cls: SectionClass | null) => () => window.tide.curriculum.setOverride(id, cls).then(loadPlace).catch(() => {})
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        ...(Object.keys(PLACE) as SectionClass[]).map((c) => ({ label: `This topic: ${PLACE[c].menu}`, run: put(t.id, c) })),
        { label: `Whole section: weekdays`, run: put(t.sectionId, 'core'), separatorBefore: true },
        { label: `Whole section: later`, run: put(t.sectionId, 'elective') },
        ...(own ? [{ label: 'Back to Tide’s choice', run: () => window.tide.curriculum.setOverride(t.id, null).then(() => window.tide.curriculum.setOverride(t.sectionId, null)).then(loadPlace).catch(() => {}), separatorBefore: true }] : [])
      ]
    })
  }
  // Where you are: the first topic left that the plan teaches on weekdays (not one it skips, defers or keeps for weekends)
  const weekdayTopic = (i: number) => {
    const t = topicAt.get(i)
    const cls = t && place?.topics[t.id]?.class
    return !t?.project && (!cls || cls === 'core' || cls === 'supporting')
  }
  const nextIndex = lines.findIndex((l, i) => l.kind === 'item' && l.checked === false && !/^(Exam|Project|Practice):/i.test(l.text) && weekdayTopic(i))
  const suggestions = lines.map((l, i) => (l.kind === 'item' && suggestionFor(l.text) ? i : -1)).filter((i) => i >= 0)

  const linkTo = (i: number, note: NoteMeta) => {
    const l = lines[i]
    if (l.kind !== 'item') return
    set(i, { text: linkItemText(l.text, fileTitle(note.path)) })
    setLinking(null)
    setQuery('')
  }

  const linkAll = () => {
    commit(
      lines.map((l) => {
        if (l.kind !== 'item') return l
        const s = suggestionFor(l.text)
        return s ? { ...l, text: linkItemText(l.text, fileTitle(s.path)) } : l
      })
    )
    app.toast(`Linked ${suggestions.length} topic${suggestions.length === 1 ? '' : 's'} to your notes`)
  }

  const createNote = async (i: number) => {
    const l = lines[i]
    if (l.kind !== 'item') return
    const heading = headingOf[i] >= 0 ? (lines[headingOf[i]] as { text: string }).text : undefined
    const folder = folderForHeading(app, notebook, heading)
    const label = topicTitle(l.text).split(/\s[—–]\s/)[0].trim()
    const path = await window.tide.vault.createNote(folder, label)
    await window.tide.vault.write(path, `# ${label}\n\n`)
    await app.refreshTree()
    set(i, { text: linkItemText(l.text, fileTitle(path)) })
    app.toast(`Created “${label}”`, { action: { label: 'Open', run: () => app.openPath(path) } })
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const l = lines[i] as Extract<OutlineLine, { kind: 'item' }>
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (l.checked !== null) set(i, { checked: !l.checked })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      insertAfter(i, { kind: 'item', depth: l.depth, checked: l.checked === null ? null : false, text: '' })
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const prev = lines.slice(0, i).reverse().find((x) => x.kind === 'item') as typeof l | undefined
      const depth = e.shiftKey ? Math.max(0, l.depth - 1) : Math.min((prev?.depth ?? -1) + 1, l.depth + 1)
      focusNext.current = i
      set(i, { depth })
    } else if (e.key === 'Backspace' && !e.currentTarget.value) {
      e.preventDefault()
      remove(i)
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(i, e.key === 'ArrowUp' ? -1 : 1)
    } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const step = e.key === 'ArrowUp' ? -1 : 1
      for (let j = i + step; j >= 0 && j < lines.length; j += step) {
        if (lines[j].kind === 'item' && !hiddenBy[j]) {
          e.preventDefault()
          inputs.current.get(j)?.focus()
          break
        }
      }
    }
  }

  const candidates = notebookNotes
    .filter((n) => !query || n.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)

  const hasToc = lines.filter((l) => l.kind === 'heading').length >= 2

  // Collapse all folds every section (the title doesn't count), so only the outermost titles show
  const tops = lines.map((l, i) => (l.kind === 'heading' && lineRole(lines, i) !== 'title' ? i : -1)).filter((i) => i >= 0)
  const allCollapsed = tops.length > 0 && tops.every((i) => collapsed.has(i))
  const toggleAll = () => replaceCollapsed(allCollapsed ? new Set() : new Set(tops))

  return (
    <div className={`outline${hasToc ? ' has-toc' : ''}`}>
      {hasToc && <OutlineToc lines={lines} collapsed={collapsed} setCollapsed={replaceCollapsed} bodyRef={bodyRef} />}
      <div className="outline-main">
      <div className="outline-bar">
        <div className="outline-summary">
          <ProgressRing value={items.length ? done / items.length : 0} />
          <div className="outline-summary-text">
            <span>
              <strong>{done}</strong> of {items.length} topics
            </span>
            {nextIndex >= 0 && (
              <button
                className="outline-next"
                onClick={() => {
                  const l = lines[nextIndex] as Extract<OutlineLine, { kind: 'item' }>
                  app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'folder', path: notebook }, topic: topicTitle(l.text), nonce: Date.now() })
                }}
                title="Start a lesson on the next topic"
              >
                <span className="muted">Next:</span> <span className="outline-next-title">{topicTitle((lines[nextIndex] as Extract<OutlineLine, { kind: 'item' }>).text)}</span>
                <span className="outline-next-go">
                  <Icon name="tutor" size={12} /> Learn
                </span>
              </button>
            )}
          </div>
        </div>
        <div className="outline-tools">
          <button className="tool-btn" onClick={runAudit} disabled={!!audit && !audit.done} title="A frank review: realistic time, order, gaps, what to cut">
            <Icon name="sparkle" />
            <span>Audit</span>
          </button>
          {!goalForm && (
            <button className="tool-btn" onClick={() => setGoalForm(true)} title="Plan backwards from a deadline">
              <Icon name="timer" />
              <span>Set a goal</span>
            </button>
          )}
          <button className="icon-btn" onClick={toggleAll} title={allCollapsed ? 'Open every section' : 'Fold every section to its title'} aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}>
            <Icon name={allCollapsed ? 'arrowDown' : 'minus'} />
          </button>
          <button
            className="icon-btn"
            title="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({
                x: r.right - 220,
                y: r.bottom + 4,
                items: [
                  { label: `${showNotes ? '✓ ' : ''}Show notes between topics`, run: () => flip('tide.outline.notes', !showNotes, setShowNotes) },
                  { label: `${showSources ? '✓ ' : ''}Show books and courses`, run: () => flip('tide.outline.sources', !showSources, setShowSources) },
                  ...(suggestions.length ? [{ label: `Link ${suggestions.length} matching note${suggestions.length === 1 ? '' : 's'}`, run: linkAll, separatorBefore: true }] : []),
                  ...(stored && !stored.thingsProject && thingsReady ? [{ label: 'Send to Things 4', run: sendToThings, separatorBefore: !suggestions.length }] : []),
                  { label: 'Open as a note', run: () => app.openPath(outlinePath), separatorBefore: true }
                ]
              })
            }}
          >
            <Icon name="more" />
          </button>
        </div>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      {goalForm && (
        <GoalForm
          notebook={notebook}
          sections={lines.filter((l): l is Extract<OutlineLine, { kind: 'heading' }> => l.kind === 'heading' && l.level <= 2).map((l) => l.text)}
          onCancel={() => setGoalForm(false)}
          onSave={(g) => {
            saveGoals([...goals, g])
            setGoalForm(false)
          }}
        />
      )}
      {goals
        .filter((g) => g.notebook === notebook)
        .map((g) => (
          <GoalPanel key={g.id} plan={planGoal(g, serializeOutline(outline), notes, mastery)} onRemove={() => saveGoals(goals.filter((x) => x.id !== g.id))} />
        ))}

      {audit && (
        <section className="outline-audit" aria-live="polite">
          <div className="outline-audit-head">
            <span>Roadmap audit</span>
            <button className="icon-btn small" onClick={() => setAudit(null)} aria-label="Close the audit">
              <Icon name="x" size={12} />
            </button>
          </div>
          {audit.text ? (
            <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(audit.text, { notePath: outlinePath ?? '', filesByName: app.filesByName }) }} />
          ) : (
            <p className="muted small">
              <span className="spinner" /> Reading your roadmap…
            </p>
          )}
          {proposals && (
            <div className="audit-changes">
              <h3>Suggested changes</h3>
              {proposals.busy ? (
                <p className="muted small">
                  <span className="spinner" /> Working out changes from your aims…
                </p>
              ) : proposals.error ? (
                <p className="muted small">Couldn’t suggest changes: {proposals.error}</p>
              ) : !proposals.list.length ? (
                <p className="muted small">Nothing to change for your aims.</p>
              ) : (
                <ul>
                  {proposals.list.map((p, i) => (
                    <li key={i}>
                      <div className="audit-change-text">
                        <strong>{p.kind === 'place' ? `${p.label}: ${PLACE[p.to].menu}` : `Add “${p.title}” after ${p.afterTitle}`}</strong>
                        {p.why && <span className="muted small">{p.why}</span>}
                      </div>
                      <button className="btn small" onClick={() => apply(p)}>
                        {p.kind === 'add' ? 'Add it' : 'Apply'}
                      </button>
                      <button className="btn small ghost" onClick={() => settle(p)}>
                        Dismiss
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}


      <div className="outline-body" role="tree" ref={bodyRef}>
        {lines.map((l, i) => {
          if (hiddenBy[i] !== null && hiddenBy[i] !== undefined) return null
          const role = lineRole(lines, i)
          if (role === 'title' || role === 'rule' || role === 'blank') return null
          if (role === 'subhead') {
            return (
              <p key={i} className="outline-subhead" data-ol={i}>
                {(l as { text: string }).text.trim().replace(/^\*\*|\*\*:?$/g, '')}
              </p>
            )
          }
          if (role === 'note') {
            if (!showNotes) return null
            const text = (l as { text: string }).text.trim().replace(/^>\s?/, '')
            return <div key={i} className="outline-note-text prose compact" data-ol={i} dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { notePath: outlinePath ?? '', filesByName: app.filesByName }) }} />
          }
          if (l.kind === 'heading') {
            const p = sectionProgress(lines, i)
            const isOpen = !collapsed.has(i)
            const { title, tag, suffix } = headingTag(l.text)
            return (
              <div key={i} className={`outline-heading h${Math.min(l.level, 4)}`} data-ol={i} data-ol-h="">
                <button className="outline-fold" onClick={() => toggleCollapse(i)} aria-expanded={isOpen} title={isOpen ? 'Collapse' : 'Expand'}>
                  <Icon name="chevron" size={13} className={isOpen ? 'open' : ''} />
                </button>
                <input
                  className="outline-heading-input"
                  value={title}
                  onChange={(e) => set(i, { text: e.target.value + suffix })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      insertAfter(i, { kind: 'item', depth: 0, checked: false, text: '' })
                    }
                  }}
                  aria-label="Section title"
                />
                {tag && <span className={`outline-tag t-${tag.toLowerCase().split(',')[0].replace(/[^a-z]/g, '')}`}>{tag}</span>}
                {p.total > 0 && (
                  <span className={`outline-count${p.done === p.total ? ' complete' : ''}`}>
                    {p.done === p.total ? <Icon name="check" size={13} /> : null}
                    {p.done}/{p.total}
                  </span>
                )}
              </div>
            )
          }
          if (l.kind === 'raw') return null
          const { source } = splitSource(l.text)
          const { target, label } = itemLink(splitSource(l.text).main)
          // A bullet that's only "_Book — Author_" is a reading suggestion, shown as one
          const reading = l.checked === null ? l.text.match(/^_(.+)_$/)?.[1] : undefined
          if (reading !== undefined && !showSources) return null
          const linked = target ? byName.get(target.toLowerCase()) : undefined
          const suggestion = suggestionFor(l.text)
          return (
            <div key={i} className={`outline-item${l.checked ? ' done' : ''}${reading !== undefined ? ' is-reading' : ''}${i === nextIndex ? ' is-next' : ''}`} style={{ paddingLeft: 28 + l.depth * 26 }} role="treeitem" data-ol={i}>
              {l.checked !== null ? (
                <button className={`outline-check${l.checked ? ' on' : ''}`} role="checkbox" aria-checked={l.checked} onClick={() => set(i, { checked: !l.checked })} title={l.checked ? 'Mark as not done' : 'Mark as done'}>
                  {l.checked && <Icon name="check" size={12} />}
                </button>
              ) : (
                <span className="outline-bullet" />
              )}
              <input
                ref={(el) => {
                  if (el) inputs.current.set(i, el)
                  else inputs.current.delete(i)
                }}
                className="outline-input"
                value={reading ?? label}
                placeholder="Topic"
                onChange={(e) => set(i, { text: reading !== undefined ? (e.target.value.trim() ? `_${e.target.value}_` : '') : retitleItem(l.text, e.target.value) })}
                onKeyDown={(e) => onKey(e, i)}
                aria-label="Topic"
              />
              {source &&
                (showSources ? (
                  <span className="outline-source" title={source}>
                    {source}
                  </span>
                ) : (
                  <span className="outline-source-hint" title={source} aria-label={`Sources: ${source}`}>
                    <Icon name="book" size={12} />
                  </span>
                ))}
              <div className="outline-actions">
                {/* Hook: a roadmap's "Project:" item opens a guided project (components/WorkshopView.tsx) */}
                {isProjectItem(label) && (
                  <button className="tool-btn ws-build" onClick={() => app.setView({ kind: 'workshop', from: { notebook, topic: label } })} title="Build it as a guided project, with tests Tide runs">
                    <Icon name="play" size={12} />
                    <span>Build</span>
                  </button>
                )}
                {(() => {
                  const t = topicAt.get(i)
                  const v = t && place?.topics[t.id]
                  if (!t || !v?.class) return null
                  return (
                    <button className={`ol-place p-${v.class}${v.own ? ' own' : ''}`} onClick={(e) => choosePlace(e, t, v.own)} title={`${PLACE[v.class].hint}${v.own ? ' (your choice)' : ''}. Click to change.`}>
                      {PLACE[v.class].label}
                    </button>
                  )
                })()}
                {linked && mastery[linked.path] && mastery[linked.path].level !== 'new' && (
                  <button
                    className={`level-pill level-${mastery[linked.path].level}`}
                    title={`${LEVEL_LABEL[mastery[linked.path].level]}. Quiz me on this`}
                    onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'note', path: linked.path }, topic: linked.title, options: { length: 5 }, nonce: Date.now() })}
                  >
                    {LEVEL_LABEL[mastery[linked.path].level]}
                  </button>
                )}
                {linked ? (
                  <button className={`outline-note status-${linked.status ?? 'untested'}`} onClick={() => app.openPath(linked.path)} title={`${STATUS_LABEL[linked.status ?? 'untested']}. Open ${linked.title}`}>
                    <span className="status-dot" />
                    Open
                  </button>
                ) : target ? (
                  <span className="outline-missing" title={`No note named “${target}”`}>
                    Missing note
                  </span>
                ) : suggestion ? (
                  <button className="outline-suggest" onClick={() => linkTo(i, suggestion)} title={`Link to ${suggestion.title}`}>
                    <Icon name="link" size={12} />
                    <span className="outline-suggest-label">{suggestion.title}</span>
                  </button>
                ) : (
                  <span className="outline-hover-actions">
                    <button className="tool-btn" onClick={() => createNote(i)} title="Create a note for this topic">
                      <Icon name="plus" />
                      <span>Note</span>
                    </button>
                    <button className="tool-btn" onClick={() => setLinking(linking === i ? null : i)} title="Link an existing note">
                      <Icon name="link" />
                    </button>
                  </span>
                )}
              </div>
              {linking === i && (
                <div className="popover outline-link-pop">
                  <input autoFocus placeholder="Find a note" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLinking(null)} />
                  {candidates.map((n) => (
                    <button key={n.path} className="highlight-item" onClick={() => linkTo(i, n)}>
                      <Icon name="note" size={14} />
                      <span className="highlight-text">{n.title}</span>
                    </button>
                  ))}
                  {!candidates.length && <p className="muted small">No notes match.</p>}
                </div>
              )}
            </div>
          )
        })}
        <div className="outline-add">
          <button
            className="tool-btn"
            onClick={() => {
              focusNext.current = lines.length
              commit([...lines, { kind: 'item', depth: 0, checked: false, text: '' }])
            }}
          >
            <Icon name="plus" />
            <span>Add topic</span>
          </button>
          <button className="tool-btn" onClick={() => commit([...lines, { kind: 'raw', text: '' }, { kind: 'heading', level: 3, text: 'New section' }])}>
            <Icon name="plus" />
            <span>Add section</span>
          </button>
        </div>
      </div>
      <p className="key-hint left">
        <kbd>Enter</kbd> new topic, <kbd>Tab</kbd> indent, <kbd>⌥↑</kbd> <kbd>⌥↓</kbd> move, <kbd>⌘Enter</kbd> mark done
      </p>
      </div>
    </div>
  )
}

function OutlineEmpty({ notebook, notes, onSetOutline }: { notebook: string; notes: Map<string, NoteMeta>; onSetOutline(p: string | null): void }) {
  const app = useApp()
  const candidates = useMemo(() => [...notes.values()], [notes])
  // Notes that look like syllabi: lots of checkbox topics
  const [checklists, setChecklists] = useState<NoteMeta[]>([])
  const [pick, setPick] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      const found: { n: NoteMeta; score: number }[] = []
      for (const n of candidates) {
        const md = await window.tide.vault.read(n.path).catch(() => '')
        const boxes = (md.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? []).length
        if (boxes >= 5) {
          const name = normalizeTitle(notebook)
          const score = boxes + (normalizeTitle(n.title).includes(name.slice(0, 4)) ? 1000 : 0) + (n.path.toLowerCase().includes(name.slice(0, 4)) ? 500 : 0)
          found.push({ n, score })
        }
      }
      if (!alive) return
      const sorted = found.sort((a, b) => b.score - a.score).map((f) => f.n)
      setChecklists(sorted)
      setPick(sorted[0]?.path ?? '')
    })()
    return () => {
      alive = false
    }
  }, [candidates, notebook])

  return (
    <div className="empty-block outline-empty">
      <p>Plan {notebook} as an outline.</p>
      <p className="muted">
        Parts, chapters and topics, linked to your notes.
      </p>
      <div className="row-gap">
        <button
          className="btn primary"
          onClick={async () => {
            const path = `${notebook}/Outline.md`
            await window.tide.vault.write(path, `# ${notebook} outline\n\n## Part 1\n\n- [ ] First topic\n`)
            await app.refreshTree()
            onSetOutline(path)
          }}
        >
          Start an outline
        </button>
        {checklists.length > 0 && (
          <>
            <span className="muted">or use</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Existing note to use as the outline">
              {checklists.map((n) => (
                <option key={n.path} value={n.path}>
                  {n.title}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => pick && onSetOutline(pick)}>
              Use this note
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Progress as a small ring */
function ProgressRing({ value }: { value: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <svg className="progress-ring" width="38" height="38" viewBox="0 0 38 38" aria-label={`${Math.round(value * 100)}% done`}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--bg-active)" strokeWidth="4" />
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--primary, var(--accent))" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 19 19)" />
      <text x="19" y="22.5" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--ink-soft)">
        {Math.round(value * 100)}%
      </text>
    </svg>
  )
}
