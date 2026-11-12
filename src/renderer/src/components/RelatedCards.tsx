/**
 * What a lesson brings in from the learner's other courses (shared/related): a reading from
 * another course, shown in place with where it's from, and a course from the catalogue the tutor
 * suggests importing (one click, never on its own).
 */
import { useEffect, useMemo, useState } from 'react'
import { catalogueCourse } from '@shared/courseCatalogue'
import { sectionOf } from '@shared/related'
import { renderMarkdown } from '../lib/markdown'
import { openTarget } from '../lib/linkNav'
import { Icon } from './Icon'

const EXCERPT = 1600

export function ReadingCard({ course, path, heading, why }: { course: string; path: string; heading?: string; why?: string }) {
  const c = catalogueCourse(course)
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    window.tide.links
      .courseFile(course, path)
      .then((v) => live && setText(v?.text ? sectionOf(v.text, heading) : null))
      .catch(() => live && setText(null))
    return () => {
      live = false
    }
  }, [course, path, heading])
  const body = text ? (open || text.length <= EXCERPT ? text : `${text.slice(0, text.lastIndexOf('\n\n', EXCERPT) > 400 ? text.lastIndexOf('\n\n', EXCERPT) : EXCERPT)}\n\n…`) : ''
  // The heading is in the card's own header
  const html = useMemo(() => (body ? renderMarkdown(body.replace(/^#{1,6}\s+.*\n+/, ''), { notePath: '', filesByName: new Map() }) : ''), [body])
  const title = heading || path.split('/').pop()?.replace(/\.(md|ipynb|markdown)$/i, '') || path
  return (
    <section className="rel-card" aria-label={`Reading from ${c?.title ?? course}`}>
      <header className="rel-head">
        <span className="rel-kicker">
          <Icon name="article" size={12} /> Reading · {c?.title ?? course}
        </span>
        <span className="rel-title">{title}</span>
        {c && <span className="rel-by">{c.by}{c.tier === 'open' ? ` · ${c.licence.replace(/\s*\(.*$/, '')}` : ' · for your own study'}</span>}
      </header>
      {why && <p className="rel-why">{why}</p>}
      {text === undefined ? (
        <div className="rel-skeleton" aria-busy="true">
          <span />
          <span />
        </div>
      ) : text === null ? (
        <p className="rel-quiet">This reading couldn’t be opened. The course may need importing again.</p>
      ) : (
        <div className={`prose compact rel-body${open ? ' open' : ''}`} data-link-course={course} data-link-path={path} dangerouslySetInnerHTML={{ __html: html }} />
      )}
      <footer className="rel-foot">
        {text && text.length > EXCERPT && (
          <button className="link-btn small" onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : 'Read the whole section'}
          </button>
        )}
        <span className="rel-gap" />
        <button className="tool-btn" onClick={() => openTarget({ kind: 'course-file', course, path, ...(heading ? { anchor: heading } : {}) })}>
          <Icon name="course" size={13} /> Open in the course
        </button>
      </footer>
    </section>
  )
}

export function SuggestCourseCard({ id, why }: { id: string; why?: string }) {
  const c = catalogueCourse(id)
  const [state, setState] = useState<'unknown' | 'no' | 'busy' | 'yes' | 'error'>('unknown')
  const [phase, setPhase] = useState('')
  useEffect(() => {
    let live = true
    window.tide.courses
      .get(id)
      .then((d) => live && setState(d?.imported ? 'yes' : 'no'))
      .catch(() => live && setState('no'))
    const off = window.tide.courses.onProgress((e) => {
      if (e.id !== id) return
      setPhase(e.phase === 'fetching' ? 'Downloading' : e.phase === 'reading' ? 'Reading the lessons' : e.phase === 'indexing' ? 'Indexing' : '')
      if (e.phase === 'done') setState('yes')
      if (e.phase === 'error') setState('error')
    })
    return () => {
      live = false
      off()
    }
  }, [id])
  if (!c) return null
  return (
    <section className="rel-card rel-suggest" aria-label={`Suggested course: ${c.title}`}>
      <header className="rel-head">
        <span className="rel-kicker">
          <Icon name="course" size={12} /> A course that teaches this
        </span>
        <span className="rel-title">{c.title}</span>
        <span className="rel-by">
          {c.by} · {c.covers}
        </span>
      </header>
      {why && <p className="rel-why">{why}</p>}
      <footer className="rel-foot">
        <span className="rel-note">{state === 'yes' ? 'Imported: lessons can draw on it now.' : 'Fetched from GitHub into Tide’s own data, not your notes. Nothing is imported unless you choose to.'}</span>
        <span className="rel-gap" />
        {state === 'yes' ? (
          <button className="tool-btn" onClick={() => openTarget({ kind: 'course-file', course: id, path: '' })}>
            Open it
          </button>
        ) : state === 'busy' ? (
          <span className="rel-note">
            <span className="spinner" /> {phase || 'Starting'}…
          </span>
        ) : (
          <button
            className="btn small"
            disabled={state === 'unknown'}
            onClick={() => {
              setState('busy')
              window.tide.courses.import(id).then(
                () => setState('yes'),
                () => setState('error')
              )
            }}
          >
            {state === 'error' ? 'Try importing again' : 'Import course'}
          </button>
        )}
      </footer>
    </section>
  )
}
