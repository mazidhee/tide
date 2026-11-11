/**
 * SQL problems held to the lab's data (shared/sqlCheck): a problem is shown only once its
 * reference query has been run in the lesson's lab and gives a real answer, and an answer is
 * marked by running it beside the reference and comparing the rows.
 */
import type { Exact } from '@shared/answerCheck'
import { schemaText } from '@shared/lab'
import { solutionOf } from '@shared/lessonCheck'
import { ownWords } from '@shared/session'
import { compareResults, isQuery, needsOrder, sqlIn, sqlProblem, sqlWhy, unanswerable } from '@shared/sqlCheck'
import type { ChatEvent, ChatMessage, ChatRequest } from '@shared/types'
import { aboutSql, labQuery, labSchema } from './lab'

const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')

/** The lab a lesson's SQL runs in (as agent.ts picks it for run_sql) */
export const labOf = (req: Pick<ChatRequest, 'labId' | 'chatId'>) => req.labId ?? req.chatId ?? 'scratch'

/** A lesson whose problems are SQL: the data lab is its workbench */
export const sqlLesson = (req: ChatRequest) => !!req.session && aboutSql(req.topic ?? '')

/**
 * Their query against the reference query of the problem they were set, both run on the lesson's
 * lab: before the tutor marks it, so a result that differs can't be marked right (and the same
 * rows can't be marked wrong). Null when the problem had no reference query or theirs isn't one.
 */
export function sqlExact(req: ChatRequest): Exact | null {
  const prev = [...req.messages].reverse().find((m) => m.role === 'assistant')
  const said = [...req.messages].reverse().find((m) => m.role === 'user')
  const mine = ownWords(text(said))
  if (!/^Answer:/i.test(mine)) return null
  const problem = sqlProblem(text(prev), solutionOf(text(prev)))
  if (!problem?.sql) return null
  // Theirs: the query they handed in, not the output they pasted under "When I ran it"
  const answer = mine.replace(/^Answer:\s*/i, '').split(/\n\s*When I ran it:/i)[0]
  const theirs = sqlIn(answer) ?? (isQuery(answer.trim()) ? answer.trim().replace(/;\s*$/, '') : null)
  if (!theirs || !isQuery(theirs)) return null
  const lab = labOf(req)
  const expected = labQuery(lab, problem.sql, 1000)
  if (unanswerable(expected)) return null
  const got = labQuery(lab, theirs, 1000)
  const c = compareResults(got, expected, needsOrder(problem.question, problem.sql))
  return { result: c.match ? 'match' : 'mismatch', theirs, expected: problem.sql, kind: 'sql', why: sqlWhy(c) }
}

/**
 * Holds back a SQL lesson's question while the reply streams (from "**Problem n" or "<ask"), so a
 * problem the data can't answer is never on screen. `finish` gives what was shown and what is held.
 */
export function holdAsks(emit: (e: ChatEvent) => void) {
  const START = /<ask\b|\*\*\s*Problem\s+\d+/i
  let sent = ''
  let carry = ''
  let held = ''
  let holding = false
  return {
    tap(e: ChatEvent) {
      if (e.type === 'reset') {
        sent = carry = held = ''
        holding = false
        return emit(e)
      }
      if (e.type !== 'delta') return emit(e)
      if (holding) {
        held += e.text
        return
      }
      const buf = carry + e.text
      const m = START.exec(buf)
      if (m) {
        const before = buf.slice(0, m.index)
        if (before) emit({ ...e, text: before })
        sent += before
        held = buf.slice(m.index)
        carry = ''
        holding = true
        return
      }
      // A tail that could be the start of "<ask" or "**Problem 1" waits for the next piece
      const tail = /(<a?s?k?|\*\*?\s*(P(r(o(b(l(e(m\s*)?)?)?)?)?)?)?)$/i.exec(buf)
      const keep = tail && tail[0] ? tail[0].length : 0
      const out = buf.slice(0, buf.length - keep)
      if (out) emit({ ...e, text: out })
      sent += out
      carry = buf.slice(buf.length - keep)
    },
    finish(): { sent: string; held: string } {
      const h = held + (holding ? '' : carry)
      const r = { sent, held: h }
      sent = carry = held = ''
      holding = false
      return r
    }
  }
}

/** Asked of the model: the one query that answers a question on the lab, when the tutor's solution has none */
export const referencePrompt = (question: string, schema: string) =>
  `${schema}\n\nQuestion set to a student:\n${question}\n\nWrite the one SQLite query that answers it on exactly these tables and columns. Reply with only the query in a \`\`\`sql block.`
export const REFERENCE_SYSTEM = 'You write correct SQLite queries. Reply with one ```sql block and nothing else.'

export interface SqlGateIO {
  lab: string
  signal: AbortSignal
  /** A short separate request to the model, for a reference query */
  ask: (prompt: string, system: string) => Promise<string>
  /** The tutor writes a new problem (not shown), told why the last one can't be used */
  rewrite: (why: string) => Promise<string>
  /** Checked SQL problems from the topic's problem bank, as they would be set, in order of preference */
  banked: () => Promise<string[]>
  step: (label: string, status: 'running' | 'done') => void
}

/**
 * The checked form of a held question: as written when its reference query answers on the lab
 * (with the reference added, hidden, when the tutor wrote none); otherwise a new problem from the
 * tutor, once, then the bank, each checked the same way; otherwise nothing is asked, with one line
 * saying why. `full` is the whole reply (the solution may come before the question).
 */
export async function settleSqlProblem(full: string, held: string, io: SqlGateIO): Promise<{ text: string; replaced?: string }> {
  const vet = async (reply: string, part: string): Promise<{ ok: string } | { why: string } | null> => {
    const problem = sqlProblem(reply, solutionOf(reply))
    if (!problem) return null
    let sql = problem.sql
    let add = ''
    if (!sql) {
      const out = await io.ask(referencePrompt(problem.question, schemaText(labSchema(io.lab))), REFERENCE_SYSTEM).catch(() => '')
      sql = sqlIn(out)
      if (!sql || !isQuery(sql)) return { why: 'it came with no reference query to check it against the lab' }
      add = `\n\n<solution>\n\`\`\`sql\n${sql}\n\`\`\`\n</solution>`
    }
    const why = unanswerable(labQuery(io.lab, sql, 1000))
    return why ? { why } : { ok: part + add }
  }
  const first = await vet(full, held)
  if (!first) return { text: held }
  if ('ok' in first) return { text: first.ok }
  io.step('The lab’s data can’t answer that problem: setting another', 'running')
  let why = first.why
  if (!io.signal.aborted) {
    const again = await io.rewrite(why).catch(() => '')
    const second = again ? await vet(again, again) : null
    if (second && 'ok' in second) {
      io.step('Set a problem the lab’s data answers', 'done')
      return { text: `\n\n${second.ok.trim()}`, replaced: first.why }
    }
    if (second) why = second.why
  }
  for (const p of await io.banked().catch(() => [])) {
    if (io.signal.aborted) break
    const ok = await vet(p, p)
    if (ok && 'ok' in ok) {
      io.step('Set a checked problem from the bank', 'done')
      return { text: ok.ok, replaced: first.why }
    }
  }
  io.step('Held back a problem the lab’s data can’t answer', 'done')
  return { text: `\n\n_Tide held back the problem written here: ${first.why}. Press Go on for the next step._\n\n<continue/>`, replaced: why }
}
