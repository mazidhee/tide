/**
 * Working with the gold set (see lib.ts for its form):
 *
 *   npx vite-node scripts/finetune/gold/cli.ts -- check [subject…] [--write] [--no-verify] [--only id-part]
 *       reads src/<subject>.gold, validates each example (the benchmark's scorer, the rules in
 *       lib.ts, the held-out rule) and runs what it states (goldverify.py, mermaidcheck.mjs).
 *       --write keeps the ones that pass in <subject>.jsonl, which is what the builder reads.
 *   … -- stats        how many examples are kept, by subject and situation
 *   … -- calibrate    how much the benchmark's scenarios share with each other (the held-out thresholds)
 *   … -- avoid        the benchmark's topics, questions and numbers, for whoever writes examples
 *   … -- show <id>    the request an example becomes, as the builder writes it
 *   … -- sample <n> [seed]   n kept examples picked at random, for review
 *
 * Environment: GOLD_PYTHON (the interpreter for goldverify.py; python3 otherwise), GOLD_LAB_DB (a
 * file copy of the lab's sample database, for SQL and charts).
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fences } from '../../eval/tutor/score'
import { SCENARIOS } from '../../eval/tutor/scenarios'
import { calibrate, distinctiveNumbers, heldOutCheck, prepareBenchmark, textsOf, THRESHOLDS } from './heldout'
import { GOLD_SITUATIONS, GOLD_SUBJECTS, goldLine, goldMessages, nearCopies, parseSource, readGoldLines, validateGold, type GoldExample, type GoldSubject } from './lib'

const HERE = new URL('.', import.meta.url).pathname
const args = process.argv.slice(2).filter((a) => a !== '--')
const flag = (k: string) => args.includes(`--${k}`)
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : undefined
}
const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only')

/** A subject's source: src/<subject>.gold and any parts src/<subject>.<part>.gold, in name order */
function readSource(subject: string): string | null {
  const dir = join(HERE, 'src')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f === `${subject}.gold` || (f.startsWith(`${subject}.`) && f.endsWith('.gold') && f.split('.').length === 3)).sort() : []
  return files.length ? files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') : null
}

export function readKept(): GoldExample[] {
  return readdirSync(HERE)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) => readGoldLines(readFileSync(join(HERE, f), 'utf8')))
}

/** Runs what the examples state; returns the problems found for each id */
function verify(examples: GoldExample[]): Record<string, string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'gold-verify-'))
  const input = join(dir, 'examples.json')
  const output = join(dir, 'results.json')
  writeFileSync(input, JSON.stringify(examples))
  const py = spawnSync(process.env.GOLD_PYTHON || 'python3', [join(HERE, 'goldverify.py'), input, output], { encoding: 'utf8', timeout: 1_800_000, maxBuffer: 1 << 26 })
  if (py.status !== 0) throw new Error(`goldverify.py failed: ${py.stderr || py.error}`)
  const results = JSON.parse(readFileSync(output, 'utf8')) as Record<string, string[]>
  const diagrams = examples.flatMap((g) =>
    [g.reply, ...g.history.flatMap((t) => ('tutor' in t ? [t.tutor] : []))].flatMap((text, i) =>
      fences(text)
        .filter((f) => f.lang === 'mermaid')
        .map((f, k) => ({ id: `${g.id}\u0000${i}\u0000${k}`, body: f.body }))
    )
  )
  if (diagrams.length) {
    const mm = spawnSync('node', [join(HERE, 'mermaidcheck.mjs')], { input: JSON.stringify(diagrams), encoding: 'utf8', timeout: 600_000, maxBuffer: 1 << 26 })
    if (mm.status !== 0) throw new Error(`mermaidcheck.mjs failed: ${mm.stderr}`)
    for (const [key, error] of Object.entries(JSON.parse(mm.stdout) as Record<string, string>)) {
      const [id, where] = key.split('\u0000')
      ;(results[id] ??= []).push(`${where === '0' ? 'reply' : 'a tutor turn'}: a mermaid diagram does not parse: ${error}`)
    }
  }
  return results
}

function check() {
  const subjects = (words.slice(1).length ? words.slice(1) : GOLD_SUBJECTS.filter((s) => readSource(s) !== null)) as GoldSubject[]
  const bench = prepareBenchmark(SCENARIOS)
  const only = opt('only')
  let total = 0
  let kept = 0
  const reasons: Record<string, number> = {}
  for (const subject of subjects) {
    const source = GOLD_SUBJECTS.includes(subject) ? readSource(subject) : null
    if (source === null) {
      console.log(`${subject}: no source file`)
      continue
    }
    const parsed = parseSource(source, subject)
    const examples = parsed.examples.filter((g) => !only || g.id.includes(only))
    const problems: Record<string, string[]> = Object.fromEntries(examples.map((g) => [g.id, [] as string[]]))
    for (const p of parsed.problems) console.log(`  FORMAT ${p}`)
    const seen = new Set<string>()
    for (const g of examples) {
      if (seen.has(g.id)) problems[g.id].push('id used twice')
      seen.add(g.id)
      problems[g.id].push(...validateGold(g))
      for (const c of heldOutCheck(g, bench).clashes) problems[g.id].push(`held-out: ${c.kind} against ${c.scenario}: ${c.detail}`)
    }
    for (const c of nearCopies(examples)) problems[c.id].push(`its reply shares ${Math.round(c.share * 100)}% of its wording with ${c.of}: write a different one`)
    if (!flag('no-verify')) for (const [id, found] of Object.entries(verify(examples))) problems[id]?.push(...found)
    const good = examples.filter((g) => !problems[g.id].length)
    for (const g of examples) {
      if (!problems[g.id].length) continue
      console.log(`\n✗ ${g.id} [${g.situation}]`)
      for (const p of problems[g.id]) {
        console.log(`    - ${p}`)
        const key = p.split(/[:(]/)[0].trim().slice(0, 40) + (p.startsWith('scorer:') ? `:${p.split(/[: (]+/)[1]}` : '')
        reasons[key] = (reasons[key] ?? 0) + 1
      }
    }
    const bySituation = Object.fromEntries(GOLD_SITUATIONS.map((s) => [s, good.filter((g) => g.situation === s).length]).filter(([, n]) => n))
    console.log(`\n${subject}: ${examples.length} written, ${good.length} pass, ${examples.length - good.length} fail${parsed.problems.length ? `, ${parsed.problems.length} format problems` : ''}`)
    console.log(`  passing by situation: ${JSON.stringify(bySituation)}`)
    total += examples.length
    kept += good.length
    if (flag('write') && !only) {
      writeFileSync(join(HERE, `${subject}.jsonl`), good.map(goldLine).join('\n') + (good.length ? '\n' : ''))
      console.log(`  wrote ${good.length} to ${subject}.jsonl`)
    }
  }
  console.log(`\nTOTAL ${total} written, ${kept} pass, ${total - kept} fail`)
  if (Object.keys(reasons).length) console.log(`Failures by reason: ${JSON.stringify(Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])), null, 1)}`)
  if (flag('report')) writeFileSync(opt('report')!, JSON.stringify({ total, kept, reasons }, null, 2))
}

function stats() {
  const all = readKept()
  const grid: Record<string, Record<string, number>> = {}
  for (const g of all) ((grid[g.subject] ??= {})[g.situation] = (grid[g.subject][g.situation] ?? 0) + 1)
  const short = GOLD_SITUATIONS.map((s) => s.replace('after-', '').replace('mark-', 'm-').replace('open-', 'o-'))
  console.log(['subject'.padEnd(15), ...short.map((s) => s.padStart(8)), '   total'].join(''))
  for (const sub of GOLD_SUBJECTS) console.log([sub.padEnd(15), ...GOLD_SITUATIONS.map((s) => String(grid[sub]?.[s] ?? 0).padStart(8)), String(all.filter((g) => g.subject === sub).length).padStart(8)].join(''))
  console.log(['all'.padEnd(15), ...GOLD_SITUATIONS.map((s) => String(all.filter((g) => g.situation === s).length).padStart(8)), String(all.length).padStart(8)].join(''))
  const verdicts: Record<string, number> = {}
  for (const g of all) if (g.expect.verdict) verdicts[g.expect.verdict] = (verdicts[g.expect.verdict] ?? 0) + 1
  const voices: Record<string, number> = {}
  for (const g of all) voices[g.voice ?? 'plain'] = (voices[g.voice ?? 'plain'] ?? 0) + 1
  const modes: Record<string, number> = {}
  for (const g of all) {
    const k = [g.setup.mode, g.setup.options?.strategy, g.setup.options?.why && 'why', g.setup.options?.refresh && 'refresh', g.setup.options?.difficulty].filter(Boolean).join('+')
    modes[k] = (modes[k] ?? 0) + 1
  }
  console.log(`verdicts: ${JSON.stringify(verdicts)}\nvoices: ${JSON.stringify(voices)}\nlesson kinds: ${JSON.stringify(modes)}`)
  console.log(`with a verify script: ${all.filter((g) => g.verify).length}; without (nothing computed): ${all.filter((g) => !g.verify).length}; groups: ${new Set(all.map((g) => g.group)).size}`)
}

function avoid() {
  console.log('Benchmark scenarios (held out). Do not use these topics, do not ask these questions, do not reuse these numbers.\n')
  for (const s of SCENARIOS) {
    const t = textsOf(s)
    console.log(`- [${s.subject}] topic "${s.setup.topic}"`)
    for (const q of t.questions.slice(0, 2)) console.log(`    asks: ${q.replace(/\s+/g, ' ').slice(0, 260)}`)
    const nums = [...distinctiveNumbers(t.texts.join(' '))]
    if (nums.length) console.log(`    numbers: ${nums.slice(0, 40).join(' ')}`)
  }
}

function show() {
  const id = words[1]
  const all = [...GOLD_SUBJECTS.flatMap((s) => parseSource(readSource(s) ?? '', s).examples), ...readKept()]
  const g = all.find((x) => x.id === id)
  if (!g) throw new Error(`no example ${id}`)
  const m = goldMessages(g)
  for (const x of m.slice(1)) console.log(`\n===== ${x.role} =====\n${flag('full') || x !== m[1] ? x.content : x.content.replace(/How to tutor me here:[\s\S]*?\n\n---\n\n/, 'How to tutor me here: […instructions…]\n\n---\n\n')}`)
  console.log(`\n===== reply =====\n${g.reply}\n\n===== expect =====\n${JSON.stringify(g.expect)}`)
}

function sample() {
  const n = Number(words[1] ?? 60)
  let seed = Number(words[2] ?? 1)
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 2 ** 32)
  const all = readKept()
  const pool = [...all]
  const picked: GoldExample[] = []
  while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  if (flag('ids')) return console.log(picked.map((g) => g.id).join('\n'))
  for (const g of picked) {
    console.log(`\n\n################ ${g.id} [${g.situation}] topic: ${g.setup.topic} ${JSON.stringify(g.setup.options ?? {})}`)
    if (g.before) console.log(`BEFORE: ${JSON.stringify(g.before)}`)
    for (const t of g.history) console.log('tutor' in t ? `--- TUTOR\n${t.tutor}` : `--- LEARNER\n${JSON.stringify(t.learner)}`)
    console.log(`--- REPLY\n${g.reply}`)
  }
}

const command = words[0]
if (command === 'check') check()
else if (command === 'stats') stats()
else if (command === 'calibrate') {
  // The explain-from-memory openings all repeat one sentence the lesson's instructions dictate; the gold set has no such lessons
  const c = calibrate(SCENARIOS.filter((s) => s.situation !== 'recall-open'))
  console.log(`Between the benchmark's own scenarios, explain-from-memory openings aside (${c.pairs.length} pairs): largest wording overlap ${c.wording.toFixed(3)} (text to text), ${c.wordingWhole.toFixed(3)} (whole to whole); most distinctive numbers shared ${c.numbers}. Thresholds: ${JSON.stringify(THRESHOLDS)}`)
  for (const p of [...c.pairs].sort((a, b) => b.m.wording - a.m.wording).slice(0, 5)) console.log(`  wording ${p.m.wording.toFixed(3)} whole ${p.m.wordingWhole.toFixed(3)}  ${p.a} / ${p.b}`)
  for (const p of [...c.pairs].sort((a, b) => b.m.numbers.length - a.m.numbers.length).slice(0, 5)) console.log(`  numbers ${p.m.numbers.length} [${p.m.numbers.join(' ')}]  ${p.a} / ${p.b}`)
  for (const p of [...c.pairs].filter((x) => x.m.topic >= 0.5).sort((a, b) => b.m.question - a.m.question).slice(0, 5)) console.log(`  topic ${p.m.topic.toFixed(2)} question ${p.m.question.toFixed(2)}  ${p.a} / ${p.b}`)
} else if (command === 'avoid') avoid()
else if (command === 'show') show()
else if (command === 'sample') sample()
else console.log('Commands: check [subject…] [--write] [--no-verify] [--only part], stats, calibrate, avoid, show <id>, sample <n> [seed]')
