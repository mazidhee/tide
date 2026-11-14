import { useEffect, useMemo, useState } from 'react'
import type { ExamPaper, Mastery } from '@shared/types'
import { fromLine } from '@shared/explore'
import { ago } from '@shared/workshop'
import { looseRoadmaps } from '@shared/sidebarTree'
import { fileTitle, useApp } from '../../state'
import { useOngoing, type Ongoing } from '../../lib/sessions'
import { startSideLesson, useExplore } from '../../lib/explore'
import { outlinesChanged, useOutlines } from '../../lib/outlines'

export const LEVEL_LABEL: Record<Mastery['level'], string> = {
  new: 'Not tested',
  weak: 'Weak',
  shaky: 'Shaky',
  solid: 'Solid',
  mastered: 'Mastered'
}

type Act = { label: string; run(): void; primary?: boolean }
interface Tile {
  key: string
  kind: string
  title: string
  line: string
  /** 0-100, for a lesson part done */
  progress?: number
  pill?: { level: Mastery['level']; label: string }
  acts: Act[]
}

const PREFIX = /^(Teach me|Quiz me|Quiz|Exam|Interview|Review|Mixed|Session|Comprehension|Explore): /

/** How far through a lesson left open is, when it can be told: an exam's answered questions, a quiz's questions */
export function ongoingProgress(o: Pick<Ongoing, 'view' | 'state'>): number | undefined {
  const st = o.state as { paper?: ExamPaper; answers?: Record<string, unknown>; turns?: { role: string }[] } | null
  if (o.view.kind === 'exam' && st?.paper?.questions?.length) {
    const done = Object.keys(st.answers ?? {}).length
    return Math.min(100, Math.round((done / st.paper.questions.length) * 100))
  }
  if (o.view.kind === 'session' && o.view.mode === 'quiz' && o.view.options?.length && st?.turns) {
    const answered = st.turns.filter((t) => t.role === 'user').length
    return Math.min(100, Math.round((answered / o.view.options.length) * 100))
  }
  return undefined
}

/**
 * "Pick up where you left off": lessons left open, topics worth revisiting, what you kept to
 * explore and roadmaps no notebook draws yet, as one grid of small tiles with one action each.
 * Hidden while there is nothing.
 */
export function LearnShelf({ weak, titleOf, onStart }: { weak: Mastery[]; titleOf(path: string): string; onStart(mode: 'teach' | 'quiz', path: string): void }) {
  const app = useApp()
  const ongoing = useOngoing()
  const explore = useExplore()
  const roadmaps = useLooseRoadmaps()
  const now = Date.now()

  const tiles: Tile[] = [
    ...ongoing.map((o) => {
      const how = PREFIX.exec(o.title)?.[1]
      return {
        key: `o:${o.key}`,
        kind: 'Carry on',
        title: o.title.replace(PREFIX, ''),
        line: [how, o.busy ? 'a reply is arriving' : ago(o.at, now)].filter(Boolean).join(' · '),
        progress: ongoingProgress(o),
        acts: [{ label: 'Resume', run: () => app.setView(o.view), primary: true }]
      }
    }),
    ...weak.map((m) => ({
      key: `w:${m.path}`,
      kind: 'Worth revisiting',
      title: titleOf(m.path),
      line: m.misconceptions > 0 ? `${m.misconceptions} confident miss${m.misconceptions === 1 ? '' : 'es'}` : '',
      pill: { level: m.level, label: LEVEL_LABEL[m.level] },
      acts: [
        { label: 'Teach me', run: () => onStart('teach', m.path) },
        { label: 'Quiz me', run: () => onStart('quiz', m.path), primary: true }
      ]
    })),
    ...(explore ?? [])
      .filter((x) => !x.explored)
      .slice(0, 6)
      .map((x) => ({
        key: `x:${x.id}`,
        kind: 'Saved to explore',
        title: x.title,
        line: fromLine(x),
        acts: [{ label: 'Explore', run: () => startSideLesson(app, x), primary: true }]
      })),
    ...roadmaps.map((r) => ({
      key: `r:${r.path}`,
      kind: 'Roadmap',
      title: fileTitle(r.name),
      line: r.total ? `${r.done} of ${r.total} topics` : 'Not started',
      acts: [
        { label: 'Make it a notebook', run: () => void r.adopt() },
        { label: 'Open', run: () => app.openPath(r.path), primary: true }
      ]
    }))
  ]

  if (!tiles.length) return null
  return (
    <section className="lrn-shelf" aria-labelledby="lrn-shelf-h">
      <h2 id="lrn-shelf-h" className="lrn-sechead">
        Pick up where you left off
      </h2>
      <ul className="lrn-tiles">
        {tiles.map((t) => (
          <li key={t.key} className="lrn-tile">
            <span className="lrn-tile-kind">
              <i className={t.kind === 'Carry on' ? 'on' : ''} aria-hidden="true" />
              {t.kind}
              {t.progress !== undefined && <span className="lrn-ring" style={{ ['--p' as string]: t.progress }} role="img" aria-label={`${t.progress}% done`} title={`${t.progress}% done`} />}
            </span>
            <b className="lrn-tile-title" title={t.title}>
              {t.title}
            </b>
            {(t.line || t.pill) && (
              <span className="lrn-tile-line">
                {t.pill && <span className={`level-pill level-${t.pill.level}`}>{t.pill.label}</span>}
                {t.line}
              </span>
            )}
            <div className="lrn-tile-foot">
              {t.acts.map((a) => (
                <button key={a.label} className={`lrn-btn small${a.primary ? '' : ' ghost'}`} onClick={a.run}>
                  {a.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Roadmaps in the Roadmaps folder that no notebook has as its outline, with their progress, and a way to give one a notebook */
function useLooseRoadmaps() {
  const app = useApp()
  const outlines = useOutlines(app.tree)
  // After the switch to modules the old roadmaps stay on disk for Switch back; they aren't offered here
  const [replaced, setReplaced] = useState<Set<string>>(new Set())
  useEffect(() => {
    window.tide.modules
      .status()
      .then((s) => setReplaced(new Set(s.replaced)))
      .catch(() => {})
  }, [app.tree])
  const loose = useMemo(() => looseRoadmaps(app.tree, outlines).filter((f) => !replaced.has(f.path)), [app.tree, outlines, replaced])
  const [counts, setCounts] = useState<Record<string, { done: number; total: number }>>({})
  useEffect(() => {
    let live = true
    for (const f of loose)
      window.tide.vault
        .read(f.path)
        .then((md: string) => {
          const done = (md.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length
          const total = done + (md.match(/^\s*[-*] \[ \]/gm) ?? []).length
          if (live) setCounts((c) => ({ ...c, [f.path]: { done, total } }))
        })
        .catch(() => {})
    return () => {
      live = false
    }
  }, [loose])
  // A roadmap becomes a notebook's outline: the notebook draws it with its progress and topics
  const adopt = async (path: string) => {
    try {
      const folder = await window.tide.vault.createFolder('', fileTitle(path.split('/').pop()!))
      await window.tide.learn.updateNotebook(folder, { outline: path })
      await app.refreshTree()
      outlinesChanged()
      app.setView({ kind: 'notebook', path: folder, tab: 'outline' })
    } catch (e) {
      app.toast((e as Error).message, { tone: 'error' })
    }
  }
  return loose.map((f) => ({ path: f.path, name: f.name, done: counts[f.path]?.done ?? 0, total: counts[f.path]?.total ?? 0, adopt: () => adopt(f.path) }))
}
