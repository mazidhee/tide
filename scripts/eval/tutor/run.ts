/**
 * The tutor benchmark: a fixed set of teaching situations (scenarios/), each put to the tutor as
 * the app would put it, and each reply scored automatically (score.ts). Run it before and after
 * any change to the prompts, the model or its settings, and compare the two (compare.ts).
 *
 *   npx vite-node scripts/eval/tutor/run.ts -- --dry-run            # no model: checks scenarios and scorer
 *   npx vite-node scripts/eval/tutor/run.ts -- [--base-url http://localhost:8080/v1] [--model id]
 *     [--label base] [--out scripts/eval/tutor/results] [--repeats 3] [--temperature 0.4] [--seed 1]
 *     [--max-tokens 1500] [--only systems,show-me,some-id] [--limit n] [--adapter-path dir]
 *     [--judge-base-url url --judge-key key --judge-model id]
 *     [--show scenario-id]                                           # print one request, send nothing
 *
 * Each repeat r uses seed + r, so a run can be repeated exactly where the server honours seeds,
 * and the spread across repeats says how much a difference between two runs has to exceed.
 * The temperature defaults to the app's own (0.4, src/main/settings.ts): the tutor is measured as
 * it is used. It talks to the model server directly, without Tide's tools, memory, profile,
 * sources, problem bank or cloud checks. What it scores is the reply the learner would be shown:
 * carried past a stall and started over from a loop as the app does (turn.ts), then with the
 * app's own repairs applied (score.ts). A request that fails is tried once more, and one that
 * fails twice is left out of every number rather than scored as an empty reply.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JUDGE_SYSTEM, judgePrompt, parseJudge } from './judge'
import { complete, firstModel } from './model'
import { buildMessages, fingerprint, type Message } from './request'
import { SCENARIOS } from './scenarios'
import { scoreReply } from './score'
import { printable, summarise, type Row } from './summary'
import { SCENARIO_SET_VERSION, SITUATIONS, SUBJECTS, type Scenario } from './types'
import { tutorTurn } from './turn'
import { validateSet } from './validate'

const args = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const flag = (k: string) => args.includes(`--${k}`)
const HERE = new URL('.', import.meta.url).pathname
const BASE = opt('base-url', 'http://localhost:8080/v1').replace(/\/+$/, '')
const KEY = opt('key') || process.env.TIDE_BENCH_KEY || ''
const REPEATS = Math.max(1, Number(opt('repeats', '3')))
const TEMPERATURE = Number(opt('temperature', '0.4'))
const SEED = Number(opt('seed', '1'))
const MAX_TOKENS = Number(opt('max-tokens', '1500'))
const JUDGE = { base: opt('judge-base-url').replace(/\/+$/, ''), key: opt('judge-key') || process.env.TIDE_JUDGE_KEY || '', model: opt('judge-model') }

function chosen(): Scenario[] {
  const only = opt('only').split(',').map((s) => s.trim()).filter(Boolean)
  const picked = only.length ? SCENARIOS.filter((s) => only.some((o) => s.id === o || s.subject === o || s.situation === o)) : SCENARIOS
  const limit = Number(opt('limit', '0'))
  return limit > 0 ? picked.slice(0, limit) : picked
}

/** A judge is asked plainly, in one piece */
async function call(base: string, key: string, model: string, messages: Message[], extra: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages, stream: false, ...extra })
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { choices: { message: { content: string } }[] }
  return j.choices[0]?.message?.content ?? ''
}

function dryRun(): number {
  const { problems, grid } = validateSet(SCENARIOS)
  const sent = SCENARIOS.map((s) => buildMessages(s))
  console.log(`Scenario set ${SCENARIO_SET_VERSION}: ${SCENARIOS.length} scenarios\n`)
  console.log(`${''.padEnd(13)}${SITUATIONS.map((s) => s.slice(0, 9).padStart(10)).join('')}     total`)
  for (const sub of SUBJECTS) console.log(`${sub.padEnd(13)}${SITUATIONS.map((sit) => String(grid[sub][sit]).padStart(10)).join('')}${String(Object.values(grid[sub]).reduce((a, b) => a + b, 0)).padStart(10)}`)
  console.log(`${'total'.padEnd(13)}${SITUATIONS.map((sit) => String(SUBJECTS.reduce((a, sub) => a + grid[sub][sit], 0)).padStart(10)).join('')}${String(SCENARIOS.length).padStart(10)}`)
  const chars = sent.map((m) => m.reduce((a, x) => a + x.content.length, 0))
  console.log(`\nRequests built from the app's prompt code: ${sent.length}; ${Math.round(chars.reduce((a, b) => a + b, 0) / Math.max(1, chars.length))} characters each on average (system prompt ${sent[0]?.[0].content.length ?? 0})`)
  console.log(`Prompt fingerprint: ${fingerprint(JSON.stringify(sent))}`)
  console.log(`Good replies scored: ${SCENARIOS.length}; bad replies scored: ${SCENARIOS.reduce((a, s) => a + (s.bad?.length ?? 0), 0)}`)
  if (problems.length) console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  else console.log('\nEvery scenario is well formed, every good reply passes, every bad reply fails as it should.\nNo model was asked anything.')
  return problems.length ? 1 : 0
}

async function main() {
  if (opt('show')) {
    const s = SCENARIOS.find((x) => x.id === opt('show'))
    if (!s) throw new Error(`no scenario ${opt('show')}`)
    for (const m of buildMessages(s).slice(flag('system') ? 0 : 1)) console.log(`--- ${m.role} ---\n${m.content}\n`)
    return
  }
  if (flag('dry-run')) process.exit(dryRun())

  const { problems } = validateSet(SCENARIOS)
  if (problems.length) throw new Error(`The scenario set has problems (run with --dry-run):\n${problems.slice(0, 5).join('\n')}`)
  const scenarios = chosen()
  const model = opt('model') || (await firstModel(BASE, KEY))
  // A LoRA adapter the model server applies for these requests (mlx-vlm's per-request adapter_path)
  const adapter = opt('adapter-path')
  const label = opt('label') || model.split('/').pop()!
  console.log(`Tutor: ${model} at ${BASE}${adapter ? ` with adapter ${adapter}` : ''}\nScenario set ${SCENARIO_SET_VERSION}: ${scenarios.length} scenarios × ${REPEATS} repeats, temperature ${TEMPERATURE}, seeds ${SEED} to ${SEED + REPEATS - 1}${JUDGE.model ? `\nJudge: ${JUDGE.model} at ${JUDGE.base}` : ''}\n`)

  const rows: (Row & { reply: string; why?: string })[] = []
  const started = Date.now()
  for (const s of scenarios) {
    const messages = buildMessages(s)
    const line: string[] = []
    for (let r = 0; r < REPEATS; r++) {
      let reply = ''
      let error: string | undefined
      let turned = { stalls: 0, looped: false }
      // The app's own numbers: a pick-up or a fresh start is a little warmer, and a turn that looped gets a repetition penalty (main/agent, main/sampling)
      const ask = (turn: Message[], o: { extra: number; retry: boolean }) =>
        complete({ base: BASE, key: KEY, model, messages: turn, extra: { temperature: Math.min(1.2, TEMPERATURE + o.extra), seed: SEED + r, max_tokens: MAX_TOKENS, ...(o.retry ? { repetition_penalty: 1.15 } : {}), ...(adapter ? { adapter_path: adapter } : {}) } })
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const t = await tutorTurn(messages, ask)
          reply = t.reply
          turned = { stalls: t.stalls, looped: t.looped }
          error = undefined
          break
        } catch (e) {
          error = (e as Error).message
        }
      }
      const score = scoreReply(s, reply)
      let judge: Row['judge'] = null
      let why: string | undefined
      if (JUDGE.base && JUDGE.model && reply) {
        const out = await call(JUDGE.base, JUDGE.key, JUDGE.model, [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: judgePrompt(s, reply) }], { temperature: 0, max_tokens: 300 }).catch(() => '')
        const parsed = parseJudge(out)
        if (parsed) {
          const { why: w, ...ratings } = parsed
          judge = ratings as Record<string, number>
          why = w
        }
      }
      rows.push({ id: s.id, subject: s.subject, situation: s.situation, repeat: r, reply, score, judge, ...(turned.stalls ? { stalls: turned.stalls } : {}), ...(turned.looped ? { looped: true } : {}), ...(error ? { error } : {}), ...(why ? { why } : {}) })
      line.push(error ? 'ERROR' : score.pass ? 'pass' : `fail(${score.failed.slice(0, 3).join(',')})`)
    }
    console.log(`${s.id.padEnd(44)} ${line.join('  ')}`)
  }

  const summary = summarise(rows)
  console.log(`\n${printable(summary)}`)
  const errors = rows.filter((r) => r.error).length
  if (errors) console.log(`\n${errors} request${errors === 1 ? '' : 's'} failed twice and ${errors === 1 ? 'is' : 'are'} left out of the numbers above.`)
  const out = opt('out') || join(HERE, 'results')
  mkdirSync(out, { recursive: true })
  const file = join(out, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${label.replace(/[^\w.-]+/g, '-')}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: SCENARIO_SET_VERSION,
        label,
        model,
        baseUrl: BASE,
        ...(adapter ? { adapter } : {}),
        settings: { temperature: TEMPERATURE, seed: SEED, repeats: REPEATS, maxTokens: MAX_TOKENS },
        prompts: fingerprint(JSON.stringify(scenarios.map((s) => buildMessages(s)))),
        judge: JUDGE.model || null,
        minutes: Math.round((Date.now() - started) / 6000) / 10,
        errors,
        summary,
        rows
      },
      null,
      2
    )
  )
  console.log(`\nSaved ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
