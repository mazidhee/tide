/**
 * Harness for source-led lessons: a lesson step drawn outside Electron with the app's own pieces
 * (the reading chosen from a recorded page by shared/sourceLed, put into the reply by the same tap
 * the app uses, split into blocks by parseBlocks and drawn by renderMarkdown with the app's
 * styles). Not part of the app. The tutor's and the student's words here are written by hand; the
 * readings are whatever the code chose from the recorded source.
 */
import { parseBlocks, type Block } from '@shared/session'
import { ledTap } from '@shared/sourceGather'
import { chooseReading, ledState, planTurn, readingBlock, type Candidate, type StepReading } from '@shared/sourceLed'
import { renderMarkdown } from '../../../src/renderer/src/lib/markdown'
import python from '../../../test/fixtures/sourceLed/python-classes.json'
import mvcc from '../../../test/fixtures/sourceLed/postgres-mvcc.json'

const query = new URLSearchParams(location.search)
const root = document.documentElement
root.dataset.theme = query.get('theme') ?? 'light'
if (query.get('design') !== 'classic') root.dataset.design = 'tide'
if (query.get('face') === 'sans') root.dataset.reading = 'sans'
const env = { notePath: 'Lessons/x.md', filesByName: new Map<string, string>() }
const AT = Date.UTC(2026, 10, 11)

const docs: Candidate = { kind: 'web', title: 'The Python Tutorial: 9. Classes', url: python.url, by: 'Python documentation', licence: 'PSF License', fetchedAt: AT, text: python.text }
const pg: Candidate = { kind: 'web', title: 'PostgreSQL 18 Documentation: 13.1. Introduction', url: mvcc.url, by: 'PostgreSQL documentation', licence: 'PostgreSQL Licence', fetchedAt: AT, text: mvcc.text }
const BOOK =
  'Leader election and terms\n\nTime in Raft is divided into terms, numbered with consecutive integers. Each term begins with an election, in which one or more candidates try to become leader. A server starts an election when it has heard nothing from a leader for the length of its election timeout: it increments its current term, votes for itself and asks every other server for its vote.\n\nA candidate wins the election if it receives votes from a majority of the servers for the same term. Each server votes for at most one candidate in a given term, first come first served, and that rule is what makes two leaders in one term impossible: two majorities of the same group always share a server, and that server voted once.\n\nIf no candidate wins a majority, the term ends without a leader and a new term begins with a new election. Election timeouts are chosen at random from a fixed range so that, most of the time, one server times out first, wins, and sends heartbeats before any other server times out.'
const book: Candidate = { kind: 'book', title: 'Distributed Systems (sample text written for this page)', path: 'Library/Distributed Systems.pdf', pages: [{ page: 142, at: 0 }], fetchedAt: AT, text: BOOK }

/** A tutor reply as the app would show it: the model's words through the tap, with the reading placed by Tide */
function reply(written: string, plan: Parameters<typeof ledTap>[0]['plan'], reading: StepReading | null): string {
  let out = ''
  const tap = ledTap({ plan, reading, emit: (t) => (out += t) })
  // In pieces, as it streams
  for (let i = 0; i < written.length; i += 37) tap.delta(written.slice(i, i + 37))
  return out
}

interface Turn {
  who: 'tutor' | 'you'
  text: string
  conf?: string
  step?: string
}

function scene(name: string): { title: string; area: string; plan: string[]; done: number; turns: Turn[] } {
  if (name === 'book') {
    const steps = ['Why a group needs one leader', 'Leader election and terms', 'Log replication']
    const r = chooseReading([book], 1, steps[1], 'Raft consensus')!
    return {
      title: 'Raft consensus',
      area: 'Distributed systems',
      plan: steps,
      done: 1,
      turns: [
        { who: 'you', text: 'Because two leaders could each accept a different command for the same slot, and the logs would disagree.', conf: 'Sure' },
        {
          who: 'tutor',
          step: `Step 2: ${steps[1]}`,
          text: reply(
            '<grade verdict="correct" score="1">Yes: “two leaders could each accept a different command for the same slot” is exactly the failure one leader rules out.</grade>\n\nRead for the rule that makes two leaders in one term impossible.\n\n<ask type="predict">Five servers. A and B time out at the same moment in term 7 and each votes for itself. C votes for A; D and E vote for B. Who is leader, in which term, and what does A do next?</ask>',
            { onCorrect: 1 },
            r
          )
        }
      ]
    }
  }
  if (name === 'fallback') {
    // A reading the tutor wrote itself, in the block's shape: shown as the tutor's, never as a source's
    return {
      title: 'PostgreSQL concurrency control',
      area: 'Databases',
      plan: ['How MVCC avoids locking readers', 'Isolation levels'],
      done: 0,
      turns: [
        {
          who: 'tutor',
          step: 'Step 1: How MVCC avoids locking readers',
          text: `${readingBlock(chooseReading([pg], 0, 'How MVCC avoids locking readers', 'PostgreSQL concurrency control')!)}\n\n<ask type="explain">A report query runs for ten minutes while orders are being written. In your own words, what does the report see, and why is nobody kept waiting?</ask>`
        },
        { who: 'you', text: 'It sees the data as it was when it started. Writers make new row versions instead of changing the ones it is reading.', conf: 'Unsure' },
        {
          who: 'tutor',
          step: 'Step 1: How MVCC avoids locking readers',
          text: '<grade verdict="correct" score="1">Right, and the reading settles it: “reading never blocks writing and writing never blocks reading”. One correction to “when it started”: the reading says each SQL statement sees a snapshot, so it is the statement, not the session.</grade>\n\nThe reading doesn’t cover this: how old row versions are removed. That is VACUUM, and it is mine, not the source’s.\n\n```reading\n{"step":1,"title":"PostgreSQL documentation","url":"https://www.postgresql.org/docs/current/transaction-iso.html","fetched":"2026-11-11","seal":"k3k3k3"}\nRead Committed is the default isolation level in PostgreSQL and it takes a table lock for every query.\n```\n\n<ask type="short">Nothing vouches for the sentence in that box. Is it right? Say where in the documentation you would check.</ask>'
        }
      ]
    }
  }
  const steps = ['Iterators: __iter__ and __next__', 'How generators keep their state between calls', 'Generator expressions']
  const r = chooseReading([docs], 1, steps[1], 'Python iterators and generators')!
  const first = `<plan>\n${steps.map((s) => `- ${s}`).join('\n')}\n</plan>`
  const shown = reply('Read for what is kept between one call and the next.\n\n<ask type="predict">`g = reverse(\'tide\')`, then `next(g)` twice. A colleague says the third `next(g)` runs the `for` loop again from `len(data)-1`. Using the reading, say what it returns and what the function did between the second and third call.</ask>', { top: 1 }, r)
  // The same decision the app makes for the next turn: an answer here is marked against this reading
  const state = ledState([first, shown])
  const next = planTurn(state, 'answer', () => false)
  return {
    title: 'Python iterators and generators',
    area: 'Programming',
    plan: steps,
    done: 1,
    turns: [
      { who: 'tutor', step: `Step 2: ${steps[1]}`, text: shown },
      { who: 'you', text: "It returns `'d'`. The loop doesn't restart: the function was paused at the `yield` with `index` still 1, so the third call carries on from there. I think the frame is copied each time though, that is why it is slower than a list.", conf: 'Unsure' },
      {
        who: 'tutor',
        step: `Step 2: ${steps[1]}`,
        text:
          next.marking === 1
            ? '<grade verdict="partial" score="0.6">`\'d\'` is right, and so is why. The line that settles it: “Each time next() is called on it, the generator resumes where it left off (it remembers all the data values and which statement was last executed)”. Not right: “the frame is copied each time”. The reading says the “local variables and execution state are automatically saved between calls”: saved, not copied.</grade>\n\nThe reading doesn’t cover this: whether a generator is slower than a list. That depends on the case and is worth measuring, not something to take from me.\n\n<ask type="error">Read the last paragraph of the reading again, then find the mistake: “After `\'e\'`, `\'d\'`, `\'i\'`, `\'t\'`, a fifth `next(g)` returns `None`, because the function has no return statement.”</ask>'
            : 'The harness and the app disagree about this turn.'
      }
    ]
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const md = (t: string) => renderMarkdown(t, env)
const ICON = { check: 'M5 12.5l4.5 4.5L19 7.5', minus: 'M6 12h12', x: 'M7 7l10 10M17 7L7 17' }
const icon = (d: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`

function block(b: Block): string {
  if (b.kind === 'text') return `<div class="prose compact">${md(b.text)}</div>`
  if (b.kind === 'ask') return `<div class="s-ask"><div class="prose">${md(b.prompt)}</div></div>`
  if (b.kind === 'grade') {
    const label = b.verdict === 'correct' ? 'Correct' : b.verdict === 'wrong' ? 'Not quite' : 'Partly right'
    return `<div class="s-grade v-${b.verdict}"><span class="s-grade-badge">${icon(b.verdict === 'correct' ? ICON.check : b.verdict === 'wrong' ? ICON.x : ICON.minus)}${label}</span><div class="prose compact">${md(b.text)}</div></div>`
  }
  return ''
}

const s = scene(query.get('scene') ?? 'docs')
const tide = root.dataset.design === 'tide'
const turns = s.turns
  .map((t) =>
    t.who === 'you'
      ? `<div class="s-you"><div class="prose compact">${md(t.text)}</div>${t.conf ? `<span class="s-conf-tag">${t.conf}</span>` : ''}</div>`
      : `<div class="s-tutor">${tide ? `<div class="td-who"><span class="hx-prof" aria-hidden="true"></span><b>Professor</b><span class="td-meta">${esc(t.step ?? '')}</span></div>` : ''}${parseBlocks(t.text).map(block).join('')}</div>`
  )
  .join('')
const plan = `<ol class="s-plan" aria-label="Lesson plan">${s.plan.map((p, i) => `<li class="${i < s.done ? 'done' : i === s.done ? 'current' : ''}"><span class="s-plan-dot">${i < s.done ? icon(ICON.check) : i + 1}</span><span>${esc(p)}</span></li>`).join('')}</ol>`
const tools = `<div class="row-gap hx-tools"><button class="chip-toggle on" aria-pressed="true"><span>Web on</span></button><button class="tool-btn led-toggle on" aria-pressed="true"><span>Teach from sources</span></button><button class="tool-btn"><span>Notes</span></button><button class="tool-btn keep-label"><span>End</span></button></div>`
document.getElementById('root')!.innerHTML = `<div class="doc-view session"><header class="doc-toolbar session-toolbar"><div class="hx-crumb"><span>${esc(s.area)}</span><b>${esc(s.title)}</b></div>${tools}</header><div class="session-solo"><div class="session-column">${tide ? '' : plan}${turns}<div class="s-answer"><textarea placeholder="Your answer" rows="2"></textarea><div class="s-answer-bar"><div class="segmented text"><button>Guessing</button><button class="on">Unsure</button><button>Sure</button></div><div class="row-gap"><button class="btn primary">Answer</button></div></div></div></div></div></div>`
