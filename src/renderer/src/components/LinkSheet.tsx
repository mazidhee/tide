/**
 * The reading sheet: where a link opens when no course reader is on screen (a link in a lesson, a
 * note, the tutor's answer). It slides over the right of the page, so the lesson or note stays
 * where it was underneath and the tutor stays beside it; back and forward move through what was
 * opened in it, Esc closes it, and it can widen to the whole page.
 */
import { useEffect, useState } from 'react'
import { canGoForward, currentPage, emptyHistory, goBack, goForward, pushPage, sameTarget, targetUrl, type History, type LinkTarget } from '@shared/links'
import { courseRepos, registerLinkHost } from '../lib/linkNav'
import { useApp } from '../state'
import { Icon } from './Icon'
import { LinkPage, ViewerBar, targetTitle } from './LinkViewer'

export function LinkSheet() {
  const app = useApp()
  const [hist, setHist] = useState<History<LinkTarget>>(emptyHistory)
  const [wide, setWide] = useState(false)
  const page = currentPage(hist)

  useEffect(
    () =>
      registerLinkHost({
        open: (t) => {
          // A whole course opens as the course
          if (t.kind === 'course-file' && !t.path) return app.setView({ kind: 'courses', id: t.course })
          setHist((h) => pushPage(h, t, sameTarget))
        }
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Going to another view closes it
  useEffect(() => setHist(emptyHistory), [app.view])
  useEffect(() => {
    if (!page) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable="true"],.vt')) setHist(emptyHistory)
      if (e.metaKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setHist((h) => (e.key === '[' ? (h.at > 0 ? goBack(h) : emptyHistory<LinkTarget>()) : goForward(h)))
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [page])
  if (!page) return null
  return (
    <aside className={`lv-sheet${wide ? ' wide' : ''}`} aria-label="Opened link">
      <ViewerBar
        back={hist.at > 0}
        forward={canGoForward(hist)}
        onBack={() => setHist((h) => (h.at > 0 ? goBack(h) : h))}
        onForward={() => setHist((h) => goForward(h))}
        url={targetUrl(page, courseRepos())}
        label={targetTitle(page)}
        onClose={() => setHist(emptyHistory)}
      >
        <button className={`icon-btn small${wide ? ' on' : ''}`} onClick={() => setWide((w) => !w)} title={wide ? 'Beside the page' : 'Across the page (focus)'} aria-pressed={wide}>
          <Icon name="width" size={13} />
        </button>
      </ViewerBar>
      <div className="lv-sheet-scroll">
        <LinkPage target={page} />
      </div>
    </aside>
  )
}
