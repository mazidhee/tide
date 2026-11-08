#!/usr/bin/env node
/**
 * npm run check: drives a real, hidden copy of Tide against your model server and reports what
 * works. It builds the app, starts it with a throwaway profile and the sample vault in
 * scripts/check/vault (your notes, settings and Things are never touched), then runs every kind of
 * session, the tutor's tools, the lesson pre-load timing and, with a key, the cloud helper.
 *
 *   npm run check                 everything
 *   npm run check -- --quick      skip the slow session round-trips
 *   npm run check -- --no-build   reuse the last build
 *   npm run check -- --keep       keep the temporary profile for a look afterwards
 *
 *   TIDE_CHECK_SERVER=http://127.0.0.1:8080/v1   the model server (default shown)
 *   TIDE_CHECK_GROQ_KEY=gsk_...                  also check the cloud helper (stored encrypted in the temp profile only)
 */
import { execSync, spawn } from 'child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = new Set(process.argv.slice(2))
const server = (process.env.TIDE_CHECK_SERVER || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '')
const port = 9345
const results = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()

function record(area, name, ok, detail = '', warnOnly = false) {
  results.push({ area, name, status: ok ? 'pass' : warnOnly ? 'warn' : 'FAIL', detail })
  const mark = ok ? '✓' : warnOnly ? '!' : '✗'
  console.log(`  ${mark} ${area}: ${name}${detail ? `  (${detail})` : ''}`)
}

// ---------- A tiny DevTools client ----------

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && !t.url.includes('focus='))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
        let id = 0
        const pending = new Map()
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data)
          if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id)
        }
        const send = (method, params = {}) => new Promise((res) => (pending.set(++id, res), ws.send(JSON.stringify({ id, method, params }))))
        await send('Runtime.enable')
        const run = async (fn, arg) => {
          const expr = `(${fn.toString()})(${JSON.stringify(arg ?? null)})`
          const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
          return r.result?.result?.value
        }
        return { run, close: () => ws.close() }
      }
    } catch {
      // not up yet
    }
    await wait(1000)
  }
  throw new Error('Tide did not start (no DevTools page)')
}

// ---------- In-page checks (these run inside Tide's window) ----------

/** Starts a session and answers its first question; reports the times and whether it graded */
async function sessionRound({ mode, topic, options, reply }) {
  const w = (m) => new Promise((r) => setTimeout(r, m))
  const ready = async (limit) => {
    const t0 = Date.now()
    await w(1200)
    while (Date.now() - t0 < limit) {
      if (document.querySelector('.s-answer') || document.querySelector('.s-error, .error-text')) return Date.now() - t0
      await w(500)
    }
    return -1
  }
  window.__tide.setView({ kind: 'session', mode, scope: { kind: 'vault' }, topic, options, nonce: Date.now() })
  const first = await ready(150000)
  const error = document.querySelector('.s-error, .error-text')?.textContent
  if (first < 0 || error) return { ok: false, first, error: error || 'no question' }
  const ta = document.querySelector('.s-answer textarea.s-input')
  const opt = document.querySelector('.s-answer .quiz-option')
  if (ta) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, reply)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  } else if (opt) opt.click()
  await w(300)
  document.querySelector('.s-answer .btn.primary')?.click()
  await w(2000)
  const second = await ready(150000)
  return { ok: second >= 0 && !document.querySelector('.s-error, .error-text'), first, second, graded: !!document.querySelector('[class*="grade"]') }
}

/** Sends one chat message and reports which tools the tutor reached for */
async function toolRound(prompt) {
  const id = 'check:' + Math.random().toString(36).slice(2)
  const tools = []
  let text = ''
  const t0 = Date.now()
  await new Promise((resolve) => {
    const off = window.tide.ai.onEvent((e) => {
      if (e.id !== id) return
      if (e.type === 'step' && e.step.kind && e.step.label) tools.push(e.step.kind === 'search_notes' && /Following links/.test(e.step.label) ? 'related_notes' : e.step.kind === 'remember' ? (/^Forgetting/.test(e.step.label) ? 'forget' : 'remember') : e.step.kind)
      if (e.type === 'delta') text += e.text
      if (e.type === 'done' || e.type === 'error') (off(), resolve())
    })
    window.tide.ai.chat({ id, messages: [{ role: 'user', content: prompt }], scope: { kind: 'vault' }, web: true })
    setTimeout(resolve, 150000)
  })
  return { tools, chars: text.length, secs: Math.round((Date.now() - t0) / 1000) }
}

/** Opens Learn, types a topic, lets it pre-load, starts; times the first words and the question */
async function openingRound(topic) {
  const w = (m) => new Promise((r) => setTimeout(r, m))
  window.__tide.setView({ kind: 'learn' })
  await w(800)
  const ta = document.querySelector('.learn-topic textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, topic)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await w(15000)
  let first = 0
  const off = window.tide.ai.onEvent((e) => e.type === 'delta' && !first && (first = Date.now()))
  const t0 = Date.now()
  document.querySelector('.learn-topic .prompt-send').click()
  let box = 0
  for (let k = 0; k < 900 && !box; k++) {
    await w(100)
    if (document.querySelector('.s-answer')) box = Date.now()
  }
  off()
  return { firstWords: first ? (first - t0) / 1000 : -1, question: box ? (box - t0) / 1000 : -1 }
}

// ---------- The run ----------

async function main() {
  console.log(`Tide check against ${server}\n`)
  try {
    const models = await (await fetch(`${server}/models`, { signal: AbortSignal.timeout(5000) })).json()
    record('server', 'model server answers', true, models.data?.[0]?.id ?? '')
  } catch (e) {
    record('server', 'model server answers', false, `${server}: ${e.message}. Start mlx_vlm.server first`)
    return finish(null, null)
  }

  if (!args.has('--no-build')) {
    console.log('  … building')
    execSync('npx electron-vite build', { cwd: root, stdio: 'ignore' })
  }

  const temp = mkdtempSync(join(tmpdir(), 'tide-check-'))
  const vault = join(temp, 'vault')
  cpSync(join(root, 'scripts/check/vault'), vault, { recursive: true })
  writeFileSync(
    join(temp, 'settings.json'),
    JSON.stringify({ vaultPath: vault, libraryFolder: 'Library', theme: 'system', sidebarCollapsed: false, chatOpen: false, readingWidth: 'normal', fontSize: 17, ai: { baseUrl: server, apiKey: '', model: '', embeddingModel: '', temperature: 0.4, agent: true, contextTokens: 16384, webSearch: { provider: 'wikipedia' } } })
  )
  const app = spawn('npx', ['electron', '.'], {
    cwd: root,
    stdio: 'ignore',
    // Things is pointed at a closed port, so its tools are off and your real tasks can't be reached
    env: { ...process.env, TIDE_USER_DATA: temp, TIDE_REMOTE_DEBUGGING_PORT: String(port), TIDE_THINGS_API: 'http://127.0.0.1:9/v1' }
  })
  let page = null
  try {
    page = await connect()
    for (let i = 0; i < 30 && !(await page.run(() => !!window.__tide && window.__tide.files?.length > 0)); i++) await wait(1000)
    const files = await page.run(() => window.__tide?.files?.length ?? 0)
    record('app', 'starts and reads the sample vault', files >= 4, `${files} files`)
    // Let the background warm-ups finish, as they would after a real launch
    await wait(20000)

    const stats = await page.run(() => window.tide.learn.stats())
    const deck = Object.entries(stats?.decks ?? {}).find(([n]) => /Data structures/.test(n))
    record('review', 'flashcards are found and scheduled', !!deck && deck[1].new >= 3, deck ? `${deck[1].new} new` : 'no deck')

    const open = await page.run(openingRound, 'binary search trees')
    record('speed', 'lesson from Learn: first words', open.firstWords >= 0 && open.firstWords < 3, `${open.firstWords.toFixed(1)}s (target under 3s)`)
    record('speed', 'lesson from Learn: first question', open.question >= 0 && open.question < 15, `${open.question.toFixed(1)}s`, true)

    if (!args.has('--quick')) {
      const rounds = [
        ['teach', 'binary search', undefined, 'I know it halves the search range each step.'],
        ['quiz', 'hash maps', { length: 5, difficulty: 'normal' }, 'Average O(1) lookup, because the hash picks the bucket directly.'],
        ['interview', 'two sum', { language: 'python', difficulty: 'normal' }, 'I would use a hash map from value to index in one pass, O(n).'],
        ['interview', 'ownership and conflict', { round: 'behavioural' }, 'Our API spec was vague, so I wrote a one-page proposal, got sign-off in a day and shipped in two weeks; errors fell 30%.'],
        ['interview', 'a URL shortener', { round: 'design', difficulty: 'normal' }, 'Is it read heavy? I assume 100M URLs and 10k reads a second.'],
        ['interview', 'probability', { round: 'quant', difficulty: 'normal' }, 'P(sum is 7) with two dice is 6/36 = 1/6.']
      ]
      for (const [mode, topic, options, reply] of rounds) {
        const r = await page.run(sessionRound, { mode, topic, options, reply })
        const name = `${mode}${options?.round ? ` (${options.round})` : ''}`
        record('sessions', name, r.ok, r.ok ? `question ${Math.round(r.first / 1000)}s, reply ${Math.round(r.second / 1000)}s${r.graded ? ', graded' : ''}` : r.error ?? `stalled (${r.first}, ${r.second})`)
      }
    }

    const toolCases = [
      ['What do my notes say about the load factor?', ['search_notes', 'read_note']],
      ['How does my Logarithms note connect to the rest of what I have studied?', ['related_notes']],
      ['What is the 30th Fibonacci number? Work it out exactly.', ['run_code']],
      ['Remember that I prefer short, example-first explanations', ['remember']],
      ['Forget what you remembered about my explanation style', ['forget']],
      ['Read https://en.wikipedia.org/wiki/Bloom_filter and give me the key idea', ['read_webpage'], true]
    ]
    for (const [prompt, want, network] of toolCases) {
      const r = await page.run(toolRound, prompt)
      const ok = want.some((t) => r.tools.includes(t)) && r.chars > 0
      record('tools', want[0], ok, `${r.tools.join(', ') || 'no tools'}, ${r.secs}s`, !!network)
    }

    if (process.env.TIDE_CHECK_GROQ_KEY) {
      const cloud = await page.run(async (key) => {
        await window.tide.cloud.setKey('groq', key)
        await window.__tide.updateSettings({ cloud: { mode: 'auto', provider: 'groq', model: 'openai/gpt-oss-120b', tasks: { maths: true, errors: true, marking: true, planning: true }, reasoning: 'medium', monthlyBudget: 0, providers: { groq: { plan: 'free' } } } })
        return window.tide.cloud.test('groq', 'openai/gpt-oss-120b')
      }, process.env.TIDE_CHECK_GROQ_KEY)
      record('cloud', 'Groq connects', cloud.ok, cloud.message)
      const esc = await page.run(async () => {
        const id = 'check:cloud'
        const labels = []
        await new Promise((resolve) => {
          const off = window.tide.ai.onEvent((e) => {
            if (e.id !== id) return
            if (e.type === 'step' && e.step.label) labels.push(e.step.label)
            if (e.type === 'done' || e.type === 'error') (off(), resolve())
          })
          window.tide.ai.chat({ id, messages: [{ role: 'user', content: 'Check my working, where did I go wrong?\nd/dx [x^2 sin x] = 2x cos x because I multiply the derivatives.' }], scope: { kind: 'none' }, web: false })
          setTimeout(resolve, 90000)
        })
        const u = await window.tide.cloud.usage()
        return { labels, cloudRequests: u.cloud.requests }
      })
      record('cloud', 'a mistake-finding turn escalates', esc.labels.some((l) => /finding the mistake/.test(l)) && esc.cloudRequests >= 2, esc.labels[0] ?? 'no cloud step')
    } else record('cloud', 'skipped (set TIDE_CHECK_GROQ_KEY to include it)', true)
  } catch (e) {
    record('run', 'check stopped early', false, e.message)
  }
  return finish(app, page, temp)
}

function finish(app, page, temp) {
  page?.close()
  app?.kill()
  if (temp && !args.has('--keep')) rmSync(temp, { recursive: true, force: true })
  else if (temp) console.log(`\nProfile kept at ${temp}`)
  const failed = results.filter((r) => r.status === 'FAIL')
  const warned = results.filter((r) => r.status === 'warn')
  console.log(`\n${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

main()
