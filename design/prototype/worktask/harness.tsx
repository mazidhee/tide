/**
 * Harness for "Work through a new task": mounts the app's own WorkShelf (with its NewTask paste box)
 * and FlightPlan with a project Claude drafted from request.txt through shared/workTask (sample.md),
 * read and revealed by the same pure functions the app uses. Not part of the app.
 */
import { createRoot } from 'react-dom/client'
import { commitDecision, newState, parseWorkProject, publicView, revealDecision, setStep, type WorkCard, type WorkView } from '@shared/workProject'
import { WorkShelf } from '../../../src/renderer/src/components/WorkProjects'
import { FlightPlan } from '../../../src/renderer/src/components/FlightPlan'
import SAMPLE from './sample.md'
import REQUEST from './request.txt'

const query = new URLSearchParams(location.search)
document.documentElement.dataset.theme = query.get('theme') ?? 'light'
const view = query.get('view') ?? 'shelf'

const p = parseWorkProject(SAMPLE).project!
let s = newState(p.slug, 1)
if (view === 'checkpoint') {
  s = setStep(p, s, 2, 2)
  s = commitDecision(p, s, 'D1', 3, 'First successful transaction. Signing up isn’t trading; I’ll check with Ada whether there’s already an activation flag we report on.').state
  s = revealDecision(p, s, 'D1', 4).state
}
const revealed: WorkView['revealed'] = {}
for (const id of s.revealed) {
  const r = revealDecision(p, s, id).reveal!
  revealed[id] = { decided: r.decided, why: r.why, wrong: r.wrong }
}
const workView: WorkView = { project: publicView(p), state: s, revealed, path: `Projects/Work/${p.slug}.md`, problems: [] }

const older: WorkCard[] = [
  { slug: 'shop-orders', title: 'Monthly orders and a typical order value', order: 1, steps: 4, decisions: 2, answered: 2, done: true },
  { slug: 'card-failures', title: 'Why card payments fail at checkout', order: 2, steps: 5, decisions: 3, answered: 1, done: false }
]
const made: WorkCard = { slug: p.slug, title: p.title, order: 99, steps: p.steps.length, decisions: p.decisions.length, answered: 0, done: false, fresh: true }

;(window as unknown as { tide: unknown }).tide = {
  work: {
    list: async () => (view === 'made' ? [...older, made] : older),
    view: async () => workView,
    fromRequest: () => new Promise(() => {}),
    refs: async () => ({ cards: [], source: 'none' }),
    answer: async () => workView
  },
  practiceData: { status: async () => ({ running: true, metabase: 'ready', setUp: true }) }
}

const root = createRoot(document.getElementById('root')!)
if (view === 'overview' || view === 'checkpoint') root.render(<FlightPlan slug={p.slug} />)
else
  root.render(
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px' }}>
        <h1 className="page-title">Projects</h1>
        <WorkShelf />
      </div>
    </div>
  )

/** Types into a React text box the way the browser would */
function type(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
  set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const later = (ms: number, f: () => void) => setTimeout(f, ms)
if (view === 'paste' || view === 'busy')
  later(150, () => {
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Work through a new task'))?.click()
    later(120, () => {
      type(document.querySelector<HTMLTextAreaElement>('.wk-nt-text')!, REQUEST.trim())
      type(document.querySelector<HTMLInputElement>('.wk-nt-from')!, 'Ada, Head of Growth')
      if (view === 'busy') later(120, () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Make it a guided project'))?.click())
    })
  })
if (view === 'checkpoint') later(200, () => document.querySelector<HTMLButtonElement>('[aria-label^="Checkpoint D1"], .fp-cp[data-id="D1"] button, button[title^="What counts"]')?.click())
