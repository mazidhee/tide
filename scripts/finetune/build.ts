/**
 * Builds the training set for a tutor LoRA from saved lessons: chat-format JSONL that mlx-lm's and
 * mlx-vlm's LoRA trainers read ({"messages": [...]}, the last message the tutor's reply), a
 * held-out split made by lesson, and a manifest of what was counted and what was left out and why.
 *
 *   npx vite-node scripts/finetune/build.ts -- --vault "<notes folder>" --count-only
 *   npx vite-node scripts/finetune/build.ts -- --vault "<notes folder>" [--out scripts/finetune/data]
 *     [--gold gold.jsonl[,more.jsonl]] [--valid-percent 15] [--max-tokens 7500]
 *     [--names "First,Last,Employer"] [--metabase-host metabase.example.com]
 *
 * It only reads the vault (.tide/lessons/*.json, and .tide/notebooks.json and .tide/library.json
 * to know what is private) and writes only under --out, which is git-ignored: the examples are
 * the learner's own lessons and never belong in the repository. --count-only writes nothing.
 * The filters are in filters.ts; the README says what each is for.
 *
 * Gold replies (--gold): examples written later by a stronger model, one JSON object a line:
 *   {"group": "raft-1", "setup": {"mode": "teach", "topic": "Raft"}, "history": [{"tutor": "…"},
 *    {"learner": {"answer": "…"}}], "reply": "the reply to learn", "by": "model name"}
 * with setup and history in the benchmark's own form (scripts/eval/tutor/types.ts), so they are
 * turned into requests by the same code. A gold reply must pass the scorer's protocol checks, and
 * one that matches a benchmark scenario is refused: training on the test would spoil the test.
 * --gold may name a folder: scripts/finetune/gold holds the set kept here (see gold/lib.ts), whose
 * examples also say what their first message was told about earlier lessons ("before").
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { userInfo } from 'os'
import { join } from 'path'
import type { LessonRecord } from '../../src/shared/lessonLog'
import { learnerText } from '../eval/tutor/request'
import { SCENARIOS } from '../eval/tutor/scenarios'
import { scoreReply } from '../eval/tutor/score'
import { SCENARIO_SET_VERSION, type Expect, type Scenario } from '../eval/tutor/types'
import { estimateTokens, examplesFrom, heldOut, lessonExcluded, matchesBenchmark, privacyMap, scrub, type Example, type PrivacyMap } from './filters'
import { goldMessages, type Before } from './gold/lib'

export const BUILDER_VERSION = '1.0.0'

const args = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const HERE = new URL('.', import.meta.url).pathname

interface Gold {
  group: string
  setup: Scenario['setup']
  history: Scenario['history']
  /** What the lesson's first message was told about earlier lessons and questions due for recall (gold/lib.ts) */
  before?: Before
  reply: string
  by?: string
  expect?: Expect
}

const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n)

/** Everything the benchmark says, to keep out of the training set */
function benchmarkTexts(): string[] {
  return SCENARIOS.flatMap((s) => [s.good, ...s.history.map((t) => ('tutor' in t ? t.tutor : learnerText(t.learner)))]).filter((t) => t.length > 40)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function main() {
  const vault = opt('vault')
  if (!vault) throw new Error('Give the notes folder with --vault (it is only read).')
  const out = opt('out') || join(HERE, 'data')
  const countOnly = args.includes('--count-only')
  const percent = Number(opt('valid-percent', '15'))
  const maxTokens = Number(opt('max-tokens', '7500'))
  // The account name on this Mac is almost always part of the owner's name: removed along with any names given
  const names = [...opt('names').split(','), userInfo().username].map((n) => n.trim()).filter(Boolean)
  const bench = benchmarkTexts()

  const notebooks = readJson<Parameters<typeof privacyMap>[0]>(join(vault, '.tide', 'notebooks.json'))
  const library = readJson<Parameters<typeof privacyMap>[1]>(join(vault, '.tide', 'library.json'))
  // Unreadable privacy records: nothing with a path is trusted (as the app does)
  const privacy: PrivacyMap | null = notebooks ? privacyMap(notebooks, library ?? {}) : null

  const dir = join(vault, '.tide', 'lessons')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []
  const lessons = { seen: files.length, used: 0, excluded: {} as Record<string, number> }
  const turns = { seen: 0, used: 0, excluded: {} as Record<string, number>, detailsRemoved: 0 }
  const examples: Example[] = []
  for (const f of files) {
    const r = readJson<LessonRecord>(join(dir, f))
    if (!r?.id || !Array.isArray(r.turns)) {
      bump(lessons.excluded, 'unreadable')
      continue
    }
    const why = lessonExcluded(r, privacy, opt('metabase-host') || undefined)
    if (why) {
      bump(lessons.excluded, why)
      continue
    }
    const built = examplesFrom(r, { names, maxTokens })
    turns.seen += built.turns
    turns.detailsRemoved += built.scrubbed
    for (const [k, n] of Object.entries(built.excluded)) bump(turns.excluded, k, n)
    const kept = built.examples.filter((e) => {
      const hit = matchesBenchmark(e.messages[e.messages.length - 1].content, bench)
      if (hit) bump(turns.excluded, 'matches-benchmark')
      return !hit
    })
    if (kept.length) lessons.used++
    else bump(lessons.excluded, 'no-usable-turn')
    turns.used += kept.length
    examples.push(...kept)
  }

  const gold = { seen: 0, used: 0, excluded: {} as Record<string, number>, by: {} as Record<string, number> }
  // A folder stands for every .jsonl in it (scripts/finetune/gold holds the set kept in the repository)
  const goldFiles = opt('gold').split(',').map((s) => s.trim()).filter(Boolean).flatMap((f) => (statSync(f).isDirectory() ? readdirSync(f).filter((n) => n.endsWith('.jsonl')).sort().map((n) => join(f, n)) : [f]))
  for (const file of goldFiles) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())) {
      gold.seen++
      let g: Gold
      try {
        g = JSON.parse(line) as Gold
      } catch {
        bump(gold.excluded, 'unreadable')
        continue
      }
      if (!g.group || !g.setup?.topic || !Array.isArray(g.history) || !g.reply?.trim()) {
        bump(gold.excluded, 'incomplete')
        continue
      }
      const last = g.history[g.history.length - 1]
      if (g.history.length && !(last && 'learner' in last)) {
        bump(gold.excluded, 'does-not-end-with-learner')
        continue
      }
      // Their own words only: Show me, Go on and "I don't know" are the app's messages, the same in the benchmark as everywhere
      const said = last && 'learner' in last && ('answer' in last.learner || 'question' in last.learner) ? learnerText(last.learner) : ''
      if (matchesBenchmark(g.reply, bench) || matchesBenchmark(said, bench) || SCENARIOS.some((s) => s.setup.topic.toLowerCase() === g.setup.topic.toLowerCase())) {
        bump(gold.excluded, 'matches-benchmark')
        continue
      }
      const score = scoreReply({ expect: g.expect ?? { ends: 'either' }, situation: 'after-correct', setup: g.setup }, g.reply)
      const failed = g.expect ? score.failed : score.protocol.checks.filter((c) => !c.ok).map((c) => c.id)
      if (failed.length) {
        bump(gold.excluded, `fails:${failed[0].split(':')[0]}`)
        continue
      }
      const clean = (t: string) => scrub(t, { names }).text
      const messages = [...goldMessages(g).map((m, i) => (i === 0 ? m : { role: m.role, content: clean(m.content) })), { role: 'assistant' as const, content: clean(g.reply) }]
      if (estimateTokens(messages) > maxTokens) {
        bump(gold.excluded, 'too-long')
        continue
      }
      gold.used++
      bump(gold.by, g.by || 'unnamed')
      examples.push({ lesson: `gold:${g.group}`, source: 'gold', messages })
    }
  }

  const valid = examples.filter((e) => heldOut(e.lesson, percent))
  const train = examples.filter((e) => !heldOut(e.lesson, percent))
  const groups = (xs: Example[]) => new Set(xs.map((e) => e.lesson)).size
  const tokens = examples.map((e) => estimateTokens(e.messages)).sort((a, b) => a - b)
  const warnings = [
    !privacy && 'The vault\'s privacy records could not be read: every lesson tied to a folder or note was left out.',
    !valid.length && examples.length > 0 && 'Nothing is held out (too few lessons for the split): validation loss cannot be measured, so overfitting would go unseen.',
    train.length < 300 && `Only ${train.length} training examples: far below what a LoRA needs to help (see the README). Do not train on this.`
  ].filter(Boolean) as string[]
  const manifest = {
    builder: BUILDER_VERSION,
    builtAt: new Date().toISOString(),
    benchmarkKeptOut: SCENARIO_SET_VERSION,
    settings: { validPercent: percent, maxTokens, namesRemoved: names.length },
    lessons,
    turns,
    gold,
    examples: { train: train.length, valid: valid.length, trainLessons: groups(train), validLessons: groups(valid), fromLessons: examples.filter((e) => e.source === 'lesson').length, fromGold: gold.used },
    tokensEstimated: tokens.length ? { median: tokens[Math.floor(tokens.length / 2)], max: tokens[tokens.length - 1], total: tokens.reduce((a, b) => a + b, 0) } : null,
    warnings
  }
  console.log(JSON.stringify(manifest, null, 2))
  if (countOnly) {
    console.log('\nCounted only: nothing was written.')
    return
  }
  mkdirSync(out, { recursive: true })
  const lines = (xs: Example[]) => xs.map((e) => JSON.stringify({ messages: e.messages })).join('\n') + (xs.length ? '\n' : '')
  writeFileSync(join(out, 'train.jsonl'), lines(train))
  writeFileSync(join(out, 'valid.jsonl'), lines(valid))
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nWrote ${train.length} training and ${valid.length} held-out examples to ${out}`)
}

main()
