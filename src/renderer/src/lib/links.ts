import { parseLink, scopeFromLink } from '@shared/deeplink'
import type { useApp } from '../state'
import { openAgendaItem } from './agenda'

/** Opens a tide:// link (from a Things 4 task, a browser, the Home timeline) where it points */
export function openTideLink(app: ReturnType<typeof useApp>, url: string) {
  const l = parseLink(url)
  if (!l) return app.toast('That Tide link isn’t one Tide understands.', { tone: 'error' })
  if (l.to === 'open') app.openPath(l.path)
  else if (l.to === 'notebook') app.setView({ kind: 'notebook', path: l.path })
  else if (l.to === 'practice') {
    if (l.tab) localStorage.setItem('tide.practice.tab', l.tab)
    app.setView({ kind: 'practice' })
  } else if (l.to === 'drill') app.setView({ kind: 'drill', drill: l.kind, nonce: Date.now() })
  else if (l.to === 'exam')
    app.setView({ kind: 'exam', scope: scopeFromLink(l.scope), topic: l.topic, options: { questions: l.questions ?? 5, minutes: l.minutes ?? 45, difficulty: l.difficulty ?? 'normal', style: l.style ?? 'university' }, nonce: Date.now() })
  else if (l.to === 'session') app.setView({ kind: 'session', mode: l.mode, scope: scopeFromLink(l.scope), topic: l.topic, ...(l.mode === 'interview' ? { options: { round: l.round, company: l.company } } : {}), nonce: Date.now() })
  else if (l.to === 'agenda')
    window.tide.coach
      .week(l.date)
      .then((w) => {
        const it = w?.days.find((d) => d.date === l.date)?.items[l.index]
        if (it) openAgendaItem(app, it, { date: l.date, index: l.index })
        else app.setView({ kind: 'coach' })
      })
      .catch(() => app.setView({ kind: 'coach' }))
  else if (l.to === 'design') {
    if (l.path) app.openPath(l.path)
    else app.setView({ kind: 'practice' })
  }
}
