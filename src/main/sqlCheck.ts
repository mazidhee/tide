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
import { isMetabaseLesson } from '@shared/metabaseData'

const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')

/** The lab a lesson's SQL runs in (as agent.ts picks it for run_sql) */
export const labOf = (req: Pick<ChatRequest, 'labId' | 'chatId'>) => req.labId ?? req.chatId ?? 'scratch'

/** A lesson whose problems are SQL: the data lab is its workbench */
export const sqlLesson = (req: ChatRequest) => !!req.session && aboutSql(req.topic ?? '') && !isMetabaseLesson(req.topic, 'path' in req.scope ? req.scope.path : undefined)

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
 * Holds back a SQL lesson's question while the reply streams, so a problem the data can't answer is
 * never on screen: text goes out a paragraph at a time, and from the paragraph where "**Problem n"
 * or "<ask" starts (the problem's statement often comes just before its ask) everything is held.
 * `finish` gives what was shown and what is held.
 */
export function holdAsks(emit: (e: ChatEvent) => void) {
  const START = /<ask\b|\*\*\s*Problem\s+\d+/i
  const STATES = /\b(write|give|fix|complete)\b[^.?\n]{0,60}\bquer(y|ies)\b/i
  let sent = ''
  let pending = ''
  let holding = false
  return {
    tap(e: ChatEvent) {
      if (e.type === 'reset') {
        sent = pending = ''
        holding = false
        return emit(e)
      }
      if (e.type !== 'delta') return emit(e)
      pending += e.text
      if (holding) return
      const m = START.exec(pending)
      // Up to the last paragraph break before the question (or before the text still arriving)
      let upTo = m ? pending.lastIndexOf('\n\n', m.index) : pending.lastIndexOf('\n\n')
      if (m) holding = true
      // A finished paragraph that asks for a query is the problem's statement: held from there
      const paragraphs = upTo > 0 ? pending.slice(0, upTo).split(/\n\n/) : []
      const at = paragraphs.findIndex((p) => STATES.test(p))
      if (at >= 0) {
        holding = true
        upTo = paragraphs.slice(0, at).join('\n\n').length
      }
      if (upTo > 0) {
        const out = pending.slice(0, upTo + 2)
        emit({ ...e, text: out })
        sent += out
        pending = pending.slice(upTo + 2)
      }
    },
    finish(): { sent: string; held: string } {
      const r = { sent, held: pending }
      sent = pending = ''
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
  /** A question found broken is never brought back by recall */
  retire?: (question: string) => void
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
  if (process.env.TIDE_DEBUG_SQL) console.log('[sql-gate] first', JSON.stringify(first))
  if (!first) return { text: held }
  if ('ok' in first) return { text: first.ok }
  const asked = sqlProblem(full, solutionOf(full))?.question
  if (asked) io.retire?.(asked)
  io.step('The lab’s data can’t answer that problem: setting another', 'running')
  let why = first.why
  if (!io.signal.aborted) {
    const again = await io.rewrite(why).catch(() => '')
    const second = again ? await vet(again, again) : null
    if (process.env.TIDE_DEBUG_SQL) console.log('[sql-gate] rewrite', JSON.stringify({ again, second }))
    if (second && 'ok' in second) {
      io.step('Set a problem the lab’s data answers', 'done')
      return { text: `\n\n${second.ok.trim()}`, replaced: first.why }
    }
    // A question that isn't a query to write (the tutor asked something else instead) needs no lab
    const asked = !second ? askedIn(again) : ''
    if (asked) {
      io.step('Set a different question', 'done')
      return { text: `\n\n${asked}`, replaced: first.why }
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

/** A reply that asks something: as written when it has its <ask>, or with its closing question put in one */
export function askedIn(reply: string): string {
  const t = reply.trim()
  if (/<ask\b[\s\S]*<\/ask>/i.test(t)) return t
  const paras = t.split(/\n\s*\n/)
  const last = paras[paras.length - 1]?.trim() ?? ''
  if (!last.endsWith('?')) return ''
  return [...paras.slice(0, -1), `<ask type="short">${last}</ask>`].join('\n\n')
}
