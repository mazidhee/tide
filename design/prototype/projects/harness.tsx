/**
 * Harness for the guided-project screens: mounts the app's own ProjectScreen, ProjectList and
 * ProjectPreview with a real library project and a record built by the same pure functions the
 * app uses (shared/workshop.ts), since the screens can't be looked at without the app otherwise.
 * Not part of the app.
 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { afterHint, afterReview, afterRun, cardOf, newRecord, stateOf, type StageRun, type WorkshopProject } from '@shared/workshop'
import { kvWal } from '../../../src/main/workshopLibrary/kvWal'
import { raft } from '../../../src/main/workshopLibrary/raft'
import { ledger } from '../../../src/main/workshopLibrary/ledger'
import { bpeTokeniser } from '../../../src/main/workshopLibrary/bpeTokeniser'
import { lruCache } from '../../../src/main/workshopLibrary/lruCache'
import { salesReport } from '../../../src/main/workshopLibrary/salesReport'
import { ProjectList, ProjectPreview, ProjectScreen } from '../../../src/renderer/src/components/workshop/ProjectScreen'

const query = new URLSearchParams(location.search)
document.documentElement.dataset.theme = query.get('theme') ?? 'light'
const view = query.get('view') ?? 'failing'
const MIN = 60_000
const DAY = 86_400_000
const NOW = new Date(2026, 10, 11, 14, 20).getTime()

const p = kvWal
const FOLDER = 'Code/A key-value store with a write-ahead log'
const pass = (stage: string, names: string[]) => names.map((name) => ({ stage, name, status: 'pass' as const }))
const run = (o: Partial<StageRun> & Pick<StageRun, 'stage' | 'tests' | 'at'>): StageRun => ({ passed: o.tests.every((t) => t.status === 'pass'), durationMs: 412, ...o })

// Stage 1 passed three days ago, on the second run, after one hint
let r = newRecord(p, FOLDER, NOW - 3 * DAY)
r = afterHint(p, r, NOW - 3 * DAY + 20 * MIN)
const s1 = p.stages[0].tests.map((t) => t.name)
r = afterRun(p, r, run({ stage: 'memtable', at: NOW - 3 * DAY + 25 * MIN, tests: [...pass('memtable', s1.slice(0, 4)), { stage: 'memtable', name: s1[4], status: 'fail', message: "set(1, 'x') should raise TypeError; it was accepted" }] }))
r = afterRun(p, r, run({ stage: 'memtable', at: NOW - 3 * DAY + 41 * MIN, tests: pass('memtable', s1) }))
r = afterReview(r, 'memtable', {
  at: NOW - 3 * DAY + 42 * MIN,
  by: 'cloud',
  passed: 5,
  total: 5,
  question: 'keys() sorts every time it is called: if the store held a million keys and keys() were called in a loop, where would you keep the order instead, and what would set() then cost?',
  praise: 'Checking both types in set() before touching the dict means a refused write leaves the store exactly as it was, which the later stages depend on.'
})

// Stage 2 in hand: the last run, yesterday, fails the flush test
const s2 = p.stages[1].tests.map((t) => t.name)
const failing = run({
  stage: 'wal',
  at: NOW - 22 * 60 * MIN,
  durationMs: 388,
  tests: [
    ...pass('memtable', s1),
    ...pass('wal', s2.slice(0, 5)),
    { stage: 'wal', name: s2[5], status: 'pass' },
    { stage: 'wal', name: s2[6], status: 'fail', message: 'another reader opening the file straight after set() sees 0 records, expected 1 (is the write still sitting in a buffer?)' }
  ]
})
r = afterRun(p, r, failing)
r = afterHint(p, r, NOW - 22 * 60 * MIN + 2 * MIN)
r = afterReview(r, 'wal', {
  at: NOW - 22 * 60 * MIN + 3 * MIN,
  by: 'cloud',
  passed: 11,
  total: 12,
  failure:
    'The test opens the log with a second file object the moment `set` returns and counts the records it can read. Your `_append` in kv.py calls `self._log.write(...)` and returns: the bytes are in the Python file object’s buffer, not yet in the file, so a separate reader sees nothing. The order in `set` is right (log first, then the dict); what is missing is the step that pushes the buffer out to the operating system before you return.',
  question: 'Once the record has been handed to the operating system, it can still sit in the page cache: which kind of crash would that survive, and which would it not?',
  praise: 'decode_record turns every malformed line into None inside one try block rather than letting an exception escape, which is exactly what recovery in stage 4 will lean on.'
})

const files = [`${FOLDER}/README.md`, `${FOLDER}/STAGE-1.md`, `${FOLDER}/STAGE-2.md`, `${FOLDER}/kv.py`, `${FOLDER}/notes.md`]
const state = stateOf(p, r, files, NOW)

const others: WorkshopProject[] = [raft, ledger, bpeTokeniser, lruCache, salesReport]
const cards = [cardOf(p, r), ...others.map((o) => cardOf(o))]

function Screen() {
  const [selected, setSelected] = useState(view === 'passed' ? 0 : state.current)
  const noop = () => {}
  if (view === 'list')
    return (
      <div className="doc-view ws-page">
        <div className="ws-scroll">
          <div className="ws-wrap">
            <ProjectList
              cards={cards}
              onOpen={noop}
              intro={
                <header className="ws-list-head">
                  <h1 className="ws-title">Projects</h1>
                  <p className="ws-lede">Build something real, a stage at a time. Each stage has a brief and tests; Tide runs them here and the tutor reviews your code without writing it for you.</p>
                </header>
              }
            />
          </div>
        </div>
      </div>
    )
  if (view === 'preview')
    return (
      <div className="doc-view ws-page">
        <div className="ws-scroll">
          <div className="ws-wrap">
            <ProjectPreview card={cardOf(raft)} busy={null} onStart={noop} from="Build a replicated log" />
          </div>
        </div>
      </div>
    )
  return (
    <div className="doc-view ws-page">
      <div className="ws-scroll">
        <div className="ws-wrap">
          <ProjectScreen state={state} selected={selected} onSelect={setSelected} busy={null} now={NOW} onRun={noop} onHint={noop} onReview={noop} onAsk={noop} onOpenFile={noop} onLearn={noop} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Screen />)
