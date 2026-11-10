/**
 * How often the tutor's facts are right on technical subjects (distributed systems, blockchain,
 * cryptography, payments): 40 questions with known answers (scripts/eval/claims.json), each marked
 * by the facts an answer must contain and the wrong ones it mustn't, not by another model.
 * Three ways: Gemma alone, Gemma with a source (the Wikipedia article's relevant paragraphs, the
 * way a lesson gets its sources), and a cloud model when given one.
 *
 *   npx vite-node scripts/eval/claims.ts -- [--base http://localhost:8080/v1] [--model id]
 *     [--cloud-base url --cloud-key key --cloud-model id] [--limit 40] [--only plain,sources,cloud]
 *
 * Results go to scripts/eval/results/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { excerpt } from '../../src/shared/sources'

const args = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const BASE = opt('base', 'http://localhost:8080/v1').replace(/\/+$/, '')
const CLOUD = { base: opt('cloud-base').replace(/\/+$/, ''), key: opt('cloud-key') || process.env.TIDE_CLOUD_KEY || '', model: opt('cloud-model') }
const ONLY = new Set((opt('only', 'plain,sources,cloud') || '').split(','))
const HERE = new URL('.', import.meta.url).pathname

interface Item {
  id: string
  area: string
  source: string
  question: string
  must: string[]
  mustNot: string[]
}

async function call(base: string, key: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, max_tokens: 400, ...(/gemma[-_ ]?4/i.test(model) && /localhost|127\.0\.0\.1/.test(base) ? { logit_bias: { '100': -100 } } : {}) })
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const j = (await res.json()) as { choices: { message: { content: string } }[] }
  return j.choices[0]?.message?.content ?? ''
}

async function firstModel(base: string): Promise<string> {
  const j = (await (await fetch(`${base}/models`)).json()) as { data: { id: string }[] }
  return j.data.find((m) => /gemma/i.test(m.id))?.id ?? j.data[0].id
}

const wiki = new Map<string, string>()
async function source(title: string, question: string): Promise<string> {
  if (!wiki.has(title)) {
    const q = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title, format: 'json', origin: '*' })
    const j = (await (await fetch(`https://en.wikipedia.org/w/api.php?${q}`, { headers: { 'User-Agent': 'Tide eval (local study app)' } })).json()) as { query?: { pages?: Record<string, { extract?: string }> } }
    wiki.set(title, Object.values(j.query?.pages ?? {})[0]?.extract ?? '')
  }
  return excerpt(wiki.get(title)!, question, 1500)
}

const SYSTEM = 'You are a tutor. Answer the student’s question correctly in two to four sentences.'
const grade = (it: Item, answer: string) => it.must.every((p) => new RegExp(p, 'i').test(answer)) && !it.mustNot.some((p) => new RegExp(p, 'i').test(answer))

async function main() {
  const model = opt('model') || (await firstModel(BASE))
  const items = (JSON.parse(readFileSync(join(HERE, 'claims.json'), 'utf8')) as Item[]).slice(0, Number(opt('limit', '40')))
  const modes = [
    ONLY.has('plain') && { name: 'plain', ask: (it: Item) => call(BASE, '', model, SYSTEM, it.question) },
    ONLY.has('sources') && {
      name: 'sources',
      ask: async (it: Item) => call(BASE, '', model, `${SYSTEM} Teach from the source below where it covers the question.`, `Source [S1]:\n"""\n${await source(it.source, it.question)}\n"""\n\n${it.question}`)
    },
    ONLY.has('cloud') && CLOUD.base && CLOUD.model && { name: 'cloud', ask: (it: Item) => call(CLOUD.base, CLOUD.key, CLOUD.model, SYSTEM, it.question) }
  ].filter(Boolean) as { name: string; ask: (it: Item) => Promise<string> }[]
  console.log(`Gemma: ${model}${CLOUD.model ? `\nCloud: ${CLOUD.model}` : ''}\n${items.length} questions, ${modes.map((m) => m.name).join(', ')}\n`)

  const rows: Record<string, unknown>[] = []
  for (const it of items) {
    const row: Record<string, unknown> = { id: it.id, area: it.area }
    for (const m of modes) {
      const answer = await m.ask(it).catch((e) => `ERROR ${(e as Error).message}`)
      row[m.name] = grade(it, answer)
      row[`${m.name}Answer`] = answer.slice(0, 600)
    }
    rows.push(row)
    console.log(`${it.id.padEnd(16)} ${modes.map((m) => `${m.name} ${row[m.name] ? 'right' : 'WRONG'}`).join('  ')}`)
  }

  const summary: Record<string, Record<string, string>> = {}
  for (const m of modes) {
    summary[m.name] = {}
    for (const area of ['all', ...new Set(items.map((i) => i.area))]) {
      const of = rows.filter((r) => area === 'all' || r.area === area)
      const right = of.filter((r) => r[m.name]).length
      summary[m.name][area] = `${right}/${of.length} (${Math.round((100 * right) / Math.max(1, of.length))}%)`
    }
  }
  console.log('\n', JSON.stringify(summary, null, 2))
  mkdirSync(join(HERE, 'results'), { recursive: true })
  const file = join(HERE, 'results', `claims-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ model, cloud: CLOUD.model || null, summary, rows }, null, 2))
  console.log(`\nSaved ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
