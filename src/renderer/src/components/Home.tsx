import { countsFor, forecastGoal, hoursPerTopic, type Forecast } from '@shared/forecast'
import { TodayPanel } from './TodayPanel'
import { HomeBanner } from './HomeBanner'
import { Professor, type ProfessorScene } from './Professor'
import { useEffect, useMemo, useState } from 'react'
import type { Goal, Mastery, NotebookMeta, NoteMeta } from '@shared/types'
import { GoalCard } from './GoalPanel'
import { readPlan } from '@shared/plan'
import { parseOutline } from '@shared/outline'
import { ContextMenu, type MenuState } from './Menu'
import { planGoal, type GoalPlan } from '../lib/goals'
import { DailyBrief } from './DailyBrief'
import { EditableCover } from './NotebookCover'
import { fileTitle, useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { vaultUrl } from '../lib/markdown'
import { isCompanion } from '../lib/companion'

/** The professor's afternoon, as the day goes: tea, the chalkboard, chess, then the late fishing */
function timeOfDayScene(): ProfessorScene {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'tea' : h < 17 && h >= 11 ? 'board' : h >= 17 && h < 22 ? 'chess' : 'fishing'
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function sourceIcon(meta: Pick<NoteMeta, 'sourceType' | 'path'>): IconName {
  if (/\.pdf$/i.test(meta.path)) return 'pdf'
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(meta.path)) return 'image'
  if (meta.sourceType === 'youtube') return 'video'
  if (meta.sourceType === 'article' || meta.sourceType === 'link') return 'article'
  if (meta.sourceType === 'doc') return 'note'
  return 'note'
}

const timeAgo = (ms: number) => {
  const d = (Date.now() - ms) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`
  return new Date(ms).toLocaleDateString()
}

export function Home({ dueCount, cardCount }: { dueCount: number; cardCount: number }) {
  const app = useApp()
  const [banner, setBanner] = useState(() => {
    try {
      return localStorage.getItem('tide.home.banner') !== 'off'
    } catch {
      return true
    }
  })
  // The banner hides itself by setting this; follow it so the small professor comes back
  useEffect(() => {
    const t = setInterval(() => {
      try {
        if (localStorage.getItem('tide.home.banner') === 'off') setBanner(false)
      } catch {
        // ignore
      }
    }, 800)
    return () => clearInterval(t)
  }, [])
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [notebooks, setNotebooks] = useState<NotebookMeta[]>([])
  const [plans, setPlans] = useState<GoalPlan[]>([])
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({})
  const [goalMenu, setGoalMenu] = useState<MenuState | null>(null)
  const [thingsNotebooks, setThingsNotebooks] = useState<Set<string>>(new Set())
  const reloadNotebooks = () =>
    window.tide.learn
      .notebooks()
      .then((nbs) => setNotebooks(nbs.filter((n) => n.path !== app.settings.libraryFolder && n.path !== 'Coach')))
      .catch(() => {})

  useEffect(() => {
    window.tide.vault.notes().then(setNotes)
    window.tide.learn.notebooks().then(async (nbs) => {
      setNotebooks(nbs.filter((n) => n.path !== app.settings.libraryFolder && n.path !== 'Coach'))
      // Today's plan for every goal whose notebook has an outline
      const [goals, mastery, allNotes] = await Promise.all([window.tide.goals.list(), window.tide.learn.mastery(), window.tide.vault.notes()])
      const byPath = new Map(allNotes.map((n) => [n.path, n]))
      const out: GoalPlan[] = []
      const inThings = new Set<string>()
      const ahead: Record<string, Forecast> = {}
      // Your real pace: study logged on each goal over the last three weeks (less for a new goal)
      const now = Date.now()
      const log = await window.tide.learn.focusLog(now - 21 * 86_400_000).catch(() => [])
      for (const g of goals as Goal[]) {
        const outline = nbs.find((n) => n.path === g.notebook)?.outline
        if (!outline) continue
        const md = await window.tide.vault.read(outline).catch(() => '')
        if (md) {
          const plan = planGoal(g, md, byPath, mastery as Record<string, Mastery>)
          out.push(plan)
          const stored = readPlan(parseOutline(md).preamble ?? '')
          if (stored?.thingsProject) inThings.add(g.notebook)
          const windowDays = Math.max(7, Math.min(21, (now - (g.createdAt ?? now)) / 86_400_000))
          const topics = plan.topics.map((t) => t.text)
          const recentMinutes = log.filter((e) => e.start >= now - windowDays * 86_400_000 && countsFor(e, g.notebook, topics)).reduce((n, e) => n + e.minutes, 0)
          ahead[g.id] = forecastGoal({ remainingTopics: plan.total - plan.done, hoursPerTopic: hoursPerTopic(stored, plan.total), recentMinutes, windowDays, deadline: g.deadline, now })
        }
      }
      setPlans(out)
      setForecasts(ahead)
      setThingsNotebooks(inThings)
    })
  }, [app.files, app.settings.libraryFolder])

  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes])
  const recent = app.recent.slice(0, 6)
  const libPrefix = app.settings.libraryFolder + '/'
  const saved = useMemo(
    () =>
      app.files
        .filter((f) => f.path.startsWith(libPrefix) && !isCompanion(f.path))
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .slice(0, 6),
    [app.files, libPrefix]
  )
  // One "Continue" list: what you opened last, then what you changed, never outlines you ticked
  const outlines = useMemo(() => new Set(notebooks.flatMap((n) => (n.outline ? [n.outline] : []))), [notebooks])
  const continueList = useMemo(() => {
    const exists = new Set(app.files.map((f) => f.path))
    const edited = notes
      .filter((n) => !n.path.startsWith(libPrefix) && !outlines.has(n.path))
      .sort((a, b) => b.mtime - a.mtime)
      .map((n) => n.path)
    return [...new Set([...recent, ...edited])].filter((p) => exists.has(p) && !outlines.has(p)).slice(0, 6)
  }, [notes, recent, libPrefix, outlines, app.files])

  // The two columns show the same number of rows (at most 5), so neither runs longer than the other
  const HOME_ROWS = 5
  const rows = continueList.length && saved.length ? Math.min(HOME_ROWS, Math.max(3, Math.min(continueList.length, saved.length))) : HOME_ROWS

  const row = (path: string, sub?: string, thumb = false) => {
    const meta = byPath.get(path)
    return (
      <li key={path}>
        <button className="list-row" onClick={() => app.openPath(path)}>
          {thumb ? <MiniCover path={path} meta={meta} /> : <Icon name={sourceIcon({ path, sourceType: meta?.sourceType })} size={16} />}
          <span className="list-title" title={meta?.title ?? fileTitle(path)}>
            {meta?.title ?? fileTitle(path).replace(/\.pdf$/i, '')}
          </span>
          {sub && <span className="muted list-sub">{sub}</span>}
        </button>
      </li>
    )
  }

  return (
    <div className="page">
      {banner && <HomeBanner />}
      <div className={`page-inner home${banner ? ' with-banner' : ''}`}>
        <header className="home-head">
          <div>
            <h1 className="page-title">{greeting()}.</h1>
            <p className="home-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          {!banner && (
            <button
              className="home-prof"
              title="Show the professor's day"
              onClick={() => {
                try {
                  localStorage.removeItem('tide.home.banner')
                } catch {
                  // Shown for now
                }
                setBanner(true)
              }}
            >
              <Professor state={timeOfDayScene()} size={44} />
            </button>
          )}
        </header>
        <DailyBrief dueCards={cardCount > 0 ? dueCount : 0} />

        <TodayPanel />

        <section className="home-goals">
          <div className="today-head">
            <h2 className="section-title">Goals</h2>
            <span className="today-links">
              <button
                className="link-btn"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const withOutline = notebooks.filter((n) => n.outline)
                  setGoalMenu({
                    x: r.left,
                    y: r.bottom + 4,
                    items: withOutline.length
                      ? withOutline.map((n) => ({
                          label: n.name,
                          run: () => {
                            try {
                              localStorage.setItem('tide.goal.open', n.path)
                            } catch {
                              // The form just won't open by itself
                            }
                            app.setView({ kind: 'notebook', path: n.path })
                          }
                        }))
                      : [{ label: 'Start a topic with a roadmap first', run: () => app.setView({ kind: 'new-topic' }) }]
                  })
                }}
              >
                Set a goal
              </button>
            </span>
          </div>
          {plans.length ? (
            <div className="goal-cards">
              {plans.map((p) => (
                <GoalCard key={p.goal.id} plan={p} forecast={forecasts[p.goal.id]} inThings={thingsNotebooks.has(p.goal.notebook)} />
              ))}
            </div>
          ) : (
            <p className="today-empty muted small">A goal is a deadline on a roadmap: Tide paces the topics to it and shows if you're ahead or behind.</p>
          )}
          <ContextMenu menu={goalMenu} onClose={() => setGoalMenu(null)} />
        </section>

        <div className="home-columns">
          <section>
            <h2 className="section-title">Continue</h2>
            {continueList.length ? (
              <ul className="list">{continueList.slice(0, rows).map((p) => row(p, p.startsWith(libPrefix) ? 'Library' : p.includes('/') ? p.split('/')[0] : undefined))}</ul>
            ) : (
              <p className="muted small">Notes and books you open will show up here.</p>
            )}
          </section>
          <section>
            <h2 className="section-title">Recently saved</h2>
            {saved.length ? (
              <ul className="list">{saved.slice(0, rows).map((f) => row(f.path, f.mtime ? timeAgo(f.mtime) : undefined, true))}</ul>
            ) : (
              <p className="muted small">Links, videos, PDFs and docs you save land in your Library.</p>
            )}
          </section>
        </div>

        {notebooks.length > 0 && (
          <section className="shelf-section">
            <h2 className="section-title">Notebooks</h2>
            <div className="shelf">
              {notebooks.map((nb) => (
                <EditableCover key={nb.path} notebook={nb} onClick={() => app.setView({ kind: 'notebook', path: nb.path })} onChanged={reloadNotebooks} />
              ))}
              <button className="nb-new" onClick={() => app.setView({ kind: 'new-topic' })}>
                <Icon name="plus" size={18} />
                <span>New topic</span>
              </button>
            </div>
          </section>
        )}



      </div>
    </div>
  )
}

/** A small cover for library items: the cached thumbnail when there is one, otherwise the kind's icon */
function MiniCover({ path, meta }: { path: string; meta?: NoteMeta }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.tide.library
      .thumb(path, meta?.image, meta?.sourceUrl)
      .then((t) => live && t && setSrc(vaultUrl(t)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path, meta?.image, meta?.sourceUrl])
  return src ? (
    <img className="mini-cover" src={src} alt="" draggable={false} onError={() => setSrc(null)} />
  ) : (
    <span className="mini-cover empty">
      <Icon name={sourceIcon({ path, sourceType: meta?.sourceType })} size={14} />
    </span>
  )
}
