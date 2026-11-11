/**
 * Scores a saved result again with the scorer as it is now, with no model: for a first look at what
 * a change to the scorer, a scenario or one of the app's repairs does to numbers already measured.
 *
 *   npx vite-node -c vitest.config.ts scripts/eval/tutor/rescore.ts -- results/<run>.json [--out file.json] [--rows]
 *
 * Each saved reply is read as the app reads a stream (turn.ts): a reply that stalled in a thought
 * channel and then went on is joined up as the app's carry-on would have joined it; one that
 * stalled with nothing after it is unfinished, and only its mark is read (the app would have asked
 * the model to carry on, which this can't). A failed request is left out. So a re-score is a
 * correction of the arithmetic, not a substitute for running again.
 */
import { readFileSync, writeFileSync } from 'fs'
import { SCENARIOS } from './scenarios'
import { scoreReply } from './score'
import { printable, summarise, type Row } from './summary'
import { savedTurn } from './turn'
import { SCENARIO_SET_VERSION } from './types'

type Saved = Row & { reply: string; raw?: string }

/** The saved rows scored again; a row whose scenario no longer exists is dropped */
export function rescoreRows(saved: Saved[]): Saved[] {
  return saved.flatMap((r) => {
    const s = SCENARIOS.find((x) => x.id === r.id)
    if (!s) return []
    // A result made by this script keeps the first completion in `raw`, so it can be scored again
    const raw = r.raw ?? r.reply
    const t = savedTurn(raw)
    const { stalls: _s, looped: _l, unfinished: _u, ...rest } = r
    return [{ ...rest, raw, reply: t.reply, score: scoreReply(s, t.reply), ...(t.stalls ? { stalls: t.stalls } : {}), ...(t.looped ? { looped: true } : {}), ...(t.unfinished ? { unfinished: true } : {}) }]
  })
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : ''
  const file = args.find((a) => !a.startsWith('--') && a !== out)
  if (!file) throw new Error('give a saved result: rescore.ts -- results/<run>.json')
  const run = JSON.parse(readFileSync(file, 'utf8')) as { version: string; rows: Saved[]; summary: unknown } & Record<string, unknown>
  const rows = rescoreRows(run.rows)
  const summary = summarise(rows)
  console.log(`${file}\nScored as set ${run.version}, now as ${SCENARIO_SET_VERSION}; ${rows.length} of ${run.rows.length} rows\n\n${printable(summary)}`)
  if (args.includes('--rows')) for (const r of rows) console.log(`${r.id.padEnd(52)} ${r.error ? 'ERROR' : r.unfinished ? `unfinished (mark: ${r.score.marking?.got ?? '-'})` : r.score.pass ? 'pass' : `fail(${r.score.failed.join(',')})`}${r.score.repaired.length && !r.unfinished ? `  repaired(${r.score.repaired.join(',')})` : ''}`)
  if (out) writeFileSync(out, JSON.stringify({ ...run, version: SCENARIO_SET_VERSION, rescored: { from: run.version, file: file.split('/').pop() }, summary, rows }, null, 2))
}

// Only when run, not when its functions are used by a test
if (!process.env.VITEST) main()
