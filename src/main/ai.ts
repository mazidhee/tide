import { recentSpeed } from './speed'
import { inBackground, streamInteractive } from './modelQueue'
import { STRATEGY_LABEL, type Strategy } from '@shared/strategy'
import { noteFallback, withUsage, withUsageGen } from './usageLog'
import { CloudUnavailable, coolingDown, coolTarget, estimateTokens, recordUsage, routeFor, type CloudTarget } from './cloud'
import { jsonrepair } from 'jsonrepair'
import { readStream, streamCloud, type ReplySchema } from './cloudStream'
import type { CloudTask, RequestKind } from '@shared/providers'
import { memoryIntent } from '@shared/memoryIntent'
import { addMemory, forgetMatching } from './memory'
import type { AgentStep, Chat, StoredMessage } from '@shared/types'
import type { TurnRequest } from './agent'
import { filedUnder } from './learn'
import { compactChat, fallbackTitle, historyBudget, historyFor, needsCompaction, newChat, renameChat, updateChat } from './chats'
import { fitHistory } from '@shared/context'
import { createHash } from 'crypto'
import { cleanModelText } from '@shared/modelText'
import { PACE_MARK } from '@shared/pace'
import { correctionText } from '@shared/lessonCheck'
import { bankDirection, plannedMove } from '@shared/difficulty'
import { BANK_NUDGE, levelAfter, nextDirection, pickProblem, problemsSoFar, renderProblem, type BankProblem, type Direction, type Level } from '@shared/bank'
import type { ChatEvent, ChatMessage, ChatRequest, ChatScope, ContextSource, ReadAlongNote } from '@shared/types'
import { getSettings } from './settings'
import { claudeState, ensureGemmaServer, markGemmaUsed, prewarmGemma, refreshClaude, useGemma } from './modelIdle'
import { routeJob, type GemmaReason, type JobName, type Route } from '@shared/gemmaPolicy'
import { localSampling } from './sampling'
import { createLineGuard, createStreamFilter, isLooping } from '@shared/modelText'
import { getChunks, indexReady, reindexPath, search, type Chunk } from './search'
import { allChunkPaths } from './search'

/** Rough character budget for retrieved context, sized for local models with small windows */
const CONTEXT_BUDGET = 12000

const SYSTEM_PROMPT = `You are Tide, a study assistant that helps the user learn from their own notes and saved sources.
- Answer from the numbered sources when they are relevant and cite them inline like [1] or [2][3].
- If the sources don't contain the answer, say so briefly, then answer from general knowledge and make clear which parts are not from their notes.
- Explain clearly, like a good tutor. Prefer short paragraphs, lists and worked examples.
- Keep it plain and on topic: no analogies, metaphors, jokes, asides or small talk unless one genuinely makes this exact point clearer; most answers need none.
- Use Markdown. Write math with LaTeX: $inline$ and $$display$$.`

function endpoint(path: string) {
  const base = getSettings().ai.baseUrl.replace(/\/+$/, '')
  return `${base}${path}`
}

function headers(): Record<string, string> {
  const { apiKey } = getSettings().ai
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }
}

export async function listModels(): Promise<string[]> {
  const res = await fetch(endpoint('/models'), { headers: headers(), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText}`)
  const json = (await res.json()) as { data?: { id: string; loaded?: boolean }[]; models?: { name: string }[] }
  const models = json.data ?? json.models?.map((m) => ({ id: m.name })) ?? []
  // Prefer what the server already has in memory, then chat/instruct tuned models ("chat" as a
  // word: Chatterbox is a voice model)
  const rank = (m: { id: string; loaded?: boolean }) =>
    (m.loaded ? 0 : 2) + (/(-it\b|-it-|instruct|\bchat\b)/i.test(m.id) ? 0 : 1)
  // Speculative-decoding draft models are listed too, and so is everything else on disk (voices,
  // speech recognition, embeddings): none of them can hold a conversation
  return [...models]
    .filter((m) => !/assistant|drafter|dflash|dspark|eagle|tts|chatterbox|kokoro|whisper|parakeet|canary|voice|embed|rerank/i.test(m.id))
    .sort((a, b) => rank(a) - rank(b))
    .map((m) => m.id)
    .filter(Boolean)
}

async function resolveModel(): Promise<string> {
  const { model } = getSettings().ai
  if (model) return model
  // Many local servers (mlx_lm, llama.cpp) serve a single model, use it when none is configured
  const models = await listModels().catch(() => [])
  return models[0] ?? 'default'
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await listModels()
    return {
      ok: true,
      message: models.length ? `Connected. Models: ${models.slice(0, 6).join(', ')}` : 'Connected.'
    }
  } catch (e) {
    return { ok: false, message: `Could not reach ${getSettings().ai.baseUrl}: ${(e as Error).message}` }
  }
}

// ---------- Retrieval ----------

const inScope = (scope: ChatScope) => (path: string) => {
  if (scope.kind === 'note' || scope.kind === 'pages') return path === scope.path
  if (scope.kind === 'folder') return scope.path === '' || path.startsWith(scope.path + '/')
  return true
}

function takeWithinBudget(chunks: Chunk[], budget: number): Chunk[] {
  const out: Chunk[] = []
  let used = 0
  for (const c of chunks) {
    if (used + c.text.length > budget && out.length) break
    out.push(c)
    used += c.text.length
  }
  return out
}

/** PDF chunk ids look like "<path>#p<page>-<offset>" */
const chunkPage = (c: Chunk) => Number(c.id.match(/#p(\d+)-\d+$/)?.[1] ?? 0)

/** Passages from a page range: all of it when it fits, else the best matches plus reading order */
async function retrievePages(scope: Extract<ChatScope, { kind: 'pages' }>, query: string): Promise<Chunk[]> {
  const inRange = (await getChunks(scope.path)).filter((c) => {
    const p = chunkPage(c)
    return p >= scope.from && p <= scope.to
  })
  const size = inRange.reduce((n, c) => n + c.text.length, 0)
  if (size <= CONTEXT_BUDGET) return inRange
  const ids = new Set(inRange.map((c) => c.id))
  // The passages that match best, then the rest of the chapter sampled evenly, so a quiz or a
  // summary covers the whole range instead of only its first pages
  const hits = (await search(query, 40, (p) => p === scope.path))
    .filter((c) => ids.has(c.id))
    .slice(0, 6)
  const used = hits.reduce((n, c) => n + c.text.length, 0)
  const rest = inRange.filter((c) => !hits.some((h) => h.id === c.id))
  const average = rest.reduce((n, c) => n + c.text.length, 0) / Math.max(1, rest.length)
  const room = Math.max(1, Math.floor((CONTEXT_BUDGET - used) / Math.max(1, average)))
  const step = rest.length / room
  const sampled = step <= 1 ? rest : Array.from({ length: room }, (_, i) => rest[Math.floor(i * step)])
  return [...hits, ...sampled]
}

/**
 * The section of a book you own that covers a lesson's topic, as text to teach from: the best
 * passages from its pages, up to about 5,000 characters. Null when no book covers it.
 */
export async function lessonPassage(topic: string, context = ''): Promise<{ label: string; path: string; from: number; to: number; text: string } | null> {
  const { pagesToRead } = await import('./books')
  const { readingLabel } = await import('@shared/books')
  // Only a section clearly about the topic: a lesson taught from the wrong pages is worse than none
  const s = (await pagesToRead(topic, 3, context).catch(() => [])).find((x) => x.onTopic)
  if (!s) return null
  await indexReady()
  const to = Math.min(s.to, s.from + 8)
  const chunks = (await retrievePages({ kind: 'pages', path: s.path, from: s.from, to }, topic)).sort((a, b) => chunkPage(a) - chunkPage(b))
  let text = ''
  for (const c of chunks) {
    if (text.length + c.text.length > 5000) break
    text += `${text ? '\n\n' : ''}${c.text.trim()}`
  }
  return text.length > 400 ? { label: readingLabel(s), path: s.path, from: s.from, to, text } : null
}

export async function retrieve(scope: ChatScope, query: string): Promise<ContextSource[]> {
  if (scope.kind === 'none') return []
  await indexReady()
  if (scope.kind === 'pages') {
    await reindexPath(scope.path)
    const picked = takeWithinBudget(await retrievePages(scope, query), CONTEXT_BUDGET).sort((a, b) => a.order - b.order)
    return picked.map((c, i) => ({ index: i + 1, path: c.path, title: c.title, heading: c.heading || undefined, text: c.text }))
  }
  if (scope.kind === 'note') await reindexPath(scope.path)
  // Sources filed under this notebook's or note's name in the Library come with it: a project's
  // design docs, the articles filed under a company you're preparing for
  const filed = new Set(await filedUnder(scopeName(scope)).catch(() => [] as string[]))
  const within = (p: string) => inScope(scope)(p) || filed.has(p)

  let chunks: Chunk[]
  const whole = scope.kind === 'note' ? await getChunks(scope.path) : []
  const wholeSize = whole.reduce((n, c) => n + c.text.length, 0)

  if (scope.kind === 'note' && wholeSize <= CONTEXT_BUDGET * (filed.size ? 0.65 : 1)) {
    // Small enough to give the model the full note, with the best of what's filed under it
    chunks = [...whole, ...(filed.size ? (await search(query, 8, (p) => filed.has(p))).slice(0, 4) : [])]
  } else {
    const hits = await search(query, 24, scope.kind === 'note' ? (p) => p === scope.path || filed.has(p) : within)
    chunks = hits
    if (chunks.length < 3) {
      // Generic questions ("summarize this") match few terms, fall back to reading order
      const paths = scope.kind === 'note' ? [scope.path, ...filed] : allChunkPaths().filter(within)
      const extra = (await Promise.all(paths.map((p) => getChunks(p, scope.kind === 'note' ? 50 : 2)))).flat()
      chunks = [...chunks, ...extra.filter((c) => !chunks.some((h) => h.id === c.id))]
    }
  }

  const picked = takeWithinBudget(chunks, CONTEXT_BUDGET)
  // Keep reading order inside a file so the model sees coherent text (the note first)
  if (scope.kind === 'note') picked.sort((a, b) => (a.path === scope.path ? 0 : 1) - (b.path === scope.path ? 0 : 1) || a.path.localeCompare(b.path) || a.order - b.order)

  return picked.map((c, i) => ({
    index: i + 1,
    path: c.path,
    title: c.title,
    heading: c.heading || undefined,
    text: c.text
  }))
}

/** The name things are filed under for a scope: a notebook's folder name, or a note's title */
const scopeName = (scope: ChatScope) => (scope.kind === 'folder' ? scope.path.split('/').pop() ?? '' : scope.kind === 'note' ? scope.path.split('/').pop()!.replace(/\.md$/i, '') : '')

function formatSources(sources: ContextSource[]): string {
  return sources
    .map((s) => `[${s.index}] ${s.title}${s.heading ? ` > ${s.heading}` : ''}\n${s.text}`)
    .join('\n\n---\n\n')
}

// ---------- Chat ----------

const running = new Map<string, AbortController>()

export function cancelChat(id: string) {
  running.get(id)?.abort()
  running.delete(id)
}

/** Streams a completion. Counts as interactive unless `background` (the caller holds a background slot) */
export async function* streamCompletion(
  messages: ChatMessage[],
  signal: AbortSignal,
  maxTokens = 3000,
  background = false,
  temperatureOverride?: number,
  task: RequestKind = 'other',
  target?: CloudTarget | null,
  /** The JSON shape the reply must have: sent to cloud providers that support it, never to the local server */
  schema?: ReplySchema
): AsyncGenerator<string> {
  // A cloud model doesn't occupy the Mac, so it skips the local model's queue
  if (target) {
    yield* streamCloud(target, messages, signal, maxTokens, temperatureOverride, task, schema)
    return
  }
  if (!background) {
    yield* streamInteractive(() => streamCompletion(messages, signal, maxTokens, true, temperatureOverride, task))
    return
  }
  const temperature = temperatureOverride ?? getSettings().ai.temperature
  // Gemma on demand: its server is started if it isn't running (main/modelIdle), and this use noted
  await ensureGemmaServer().catch(() => {})
  markGemmaUsed()
  const model = await resolveModel()
  const t0 = Date.now()
  let first = 0
  const res = await fetch(endpoint('/chat/completions'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model, messages, temperature, stream: true, max_tokens: maxTokens, ...localSampling(model) }),
    signal
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI server answered ${res.status}: ${detail.slice(0, 300) || res.statusText}`)
  }
  let out = 0
  try {
    for await (const delta of readStream(res.body, createStreamFilter())) {
      out += delta.length
      first ||= Date.now()
      yield delta
    }
  } finally {
    recordUsage({ kind: 'local', provider: 'local', model, task, input: estimateTokens(JSON.stringify(messages).length), output: estimateTokens(out), estimated: true, ms: Date.now() - t0, ...(first ? { ttftMs: first - t0 } : {}) })
  }
}

/**
 * Streams from the cloud model when this job escalates, and from Gemma otherwise. If a cloud
 * model can't take it (rate limited, down, key refused) before writing anything, the next
 * provider you have a key for tries, then Gemma.
 */
export async function* streamRouted(messages: ChatMessage[], signal: AbortSignal, maxTokens: number, task: RequestKind, temperatureOverride?: number, routine = false, schema?: ReplySchema): AsyncGenerator<string> {
  for (let tries = 0; tries < 3; tries++) {
    // A provider that just refused is cooling down, so this picks the next one in line
    // Open endpoints only for the short checks (a problem and an answer), never planning from your notes
    const target = routeFor(isCloudTask(task) ? task : null, 'auto', task === 'marking' || task === 'maths', routine)
    if (!target) break
    let wrote = false
    try {
      for await (const t of streamCompletion(messages, signal, maxTokens, false, temperatureOverride, task, target, schema)) {
        wrote = true
        yield t
      }
      return
    } catch (e) {
      if (wrote || signal.aborted || !(e instanceof CloudUnavailable)) throw e
      // Not a refusal it remembers (the per-minute check): don't ask the same one again now
      if (!coolingDown(target)) coolTarget(target, 30)
      console.warn(`[cloud] ${target.provider}: ${(e as Error).message}; trying the next`)
    }
  }
  yield* streamCompletion(messages, signal, maxTokens, false, temperatureOverride, task)
}

/** No cloud model can take this right now (none set up, all busy, or the day's allowance used) */
export class NoCloud extends Error {}

/**
 * A cloud model's whole answer, never Gemma's: for work that should only happen when a cloud model
 * can do it (writing the problem bank), so it never takes the Mac. Works down the line like
 * streamRouted; throws NoCloud when nothing can take it.
 */
export async function askCloud(prompt: string, system: string, task: CloudTask, signal: AbortSignal, routine = false, maxTokens = 4000, onTarget?: (t: CloudTarget) => void, schema?: ReplySchema): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ]
  for (let tries = 0; tries < 3; tries++) {
    const target = routeFor(task, 'auto', true, routine)
    if (!target) break
    let out = ''
    try {
      for await (const t of streamCompletion(messages, signal, maxTokens, false, 0.4, task, target, schema)) out += t
      onTarget?.(target)
      return cleanModelText(out)
    } catch (e) {
      if (signal.aborted || !(e instanceof CloudUnavailable)) throw e
      if (!coolingDown(target)) coolTarget(target, 30)
    }
  }
  throw new NoCloud('No cloud model can take this now')
}

export const isCloudTask = (t: RequestKind): t is CloudTask => t === 'maths' || t === 'errors' || t === 'marking' || t === 'planning'

const uid = () => Math.random().toString(36).slice(2, 10)

/** Called after a stored conversation changes (new turn, title, summary) so windows can refresh */
let onChatsChanged: (id: string) => void = () => {}
export const setChatsChangedListener = (fn: (id: string) => void) => (onChatsChanged = fn)

/** Background compaction per conversation; a new turn cancels it so answers never wait on it */
const compacting = new Map<string, AbortController>()

/**
 * Answers a message. With a chatId the exchange is a stored conversation: the user's message is
 * saved first, the model gets the running summary plus recent turns, and the answer (with its
 * sources and steps) is saved when it finishes, followed by a title and compaction when due.
 */
export async function chat(req: ChatRequest, emit: (e: ChatEvent) => void) {
  if (!req.chatId) return answer(req, emit)
  const chatId = req.chatId
  compacting.get(chatId)?.abort()
  const question = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const startedAt = Date.now()
  let stored: Chat | null
  try {
    stored = await updateChat(chatId, (c) => {
      const base = c ?? newChat(chatId, req.scope)
      return {
        ...base,
        scope: req.scope,
        updatedAt: startedAt,
        messages: [...base.messages, { id: uid(), role: 'user', content: question, attachment: req.attachment, at: startedAt }]
      }
    })
  } catch (e) {
    emit({ id: req.id, type: 'error', message: `Couldn't save the conversation: ${(e as Error).message}` })
    return
  }
  if (!stored) return
  onChatsChanged(chatId)

  // "Remember that…" / "Forget that…" are carried out here, so they work even when the model
  // doesn't call its memory tool; the model is told so it can just confirm
  const intent = memoryIntent(question)
  const done: string[] = []
  for (const fact of intent.remember) {
    const r = await addMemory(fact, chatId).catch(() => null)
    if (r) done.push(r.duplicate ? `Already remembered: "${r.memory.text}"` : `Saved to memory: "${r.memory.text}"`)
  }
  for (const about of intent.forget) {
    const r = await forgetMatching(about).catch(() => null)
    done.push(r ? `Forgotten: "${r.text}"` : `Nothing in memory matched "${about}"`)
  }
  if (done.length) emit({ id: req.id, type: 'step', step: { id: 'memory', kind: 'remember', label: done.join('; '), status: 'done', depth: 0 } })

  const { summary, messages } = historyFor(stored)
  if (done.length) {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Tide has already done this, so don't call remember or forget for it, just confirm briefly: ${done.join('; ')})` }
  }
  let text = ''
  let sources: ContextSource[] | undefined
  const steps = new Map<string, AgentStep>()
  if (done.length) steps.set('memory', { id: 'memory', kind: 'remember', label: done.join('; '), status: 'done', depth: 0 })
  let error: string | undefined
  await answer({ ...req, messages, attachment: undefined, summary } as TurnRequest, (e) => {
    if (e.type === 'delta') text += e.text
    else if (e.type === 'reset') text = ''
    else if (e.type === 'sources') sources = e.sources
    else if (e.type === 'step') steps.set(e.step.id, { ...steps.get(e.step.id), ...e.step } as AgentStep)
    else if (e.type === 'error') error = e.message
    emit(e)
  })

  const reply: StoredMessage = {
    id: req.id,
    role: 'assistant',
    content: cleanModelText(text),
    at: Date.now(),
    ...(sources?.length ? { sources } : {}),
    ...(steps.size ? { steps: [...steps.values()].map((s) => ({ ...s, status: s.status === 'running' ? 'done' : s.status })) } : {}),
    ...(error ? { error } : {})
  }
  const saved = await updateChat(chatId, (c) => (c ? { ...c, updatedAt: Date.now(), messages: [...c.messages, reply] } : c)).catch(() => null)
  onChatsChanged(chatId)
  if (!saved || error) return

  // Titles and compaction happen after the answer, in the background: on Claude's background
  // model (Haiku) when Claude teaches this conversation, else on Gemma
  void (async () => {
    const { teacherFor } = await import('./teacher')
    const { backgroundOnClaude } = await import('./claudeEngine')
    const viaClaude = (await teacherFor(req).catch(() => null))?.who === 'claude'
    const later = async (prompt: string, system: string, signal?: AbortSignal) => (viaClaude ? await backgroundOnClaude(prompt, system, signal).catch(() => null) : null) ?? complete(prompt, system, signal, 'background')
    if (!saved.title && saved.messages.length >= 2) {
      const title = await later(
        `Conversation start:\nStudent: ${question.slice(0, 600)}\nTutor: ${reply.content.slice(0, 600)}\n\nGive this conversation a short title, 2 to 6 words, like a note title. Reply with the title only.`,
        'You name conversations. Reply with a short title only, no quotes or punctuation at the end.'
      ).catch(() => '')
      const clean = title.split('\n')[0].replace(/^["'#*\s]+|["'.*\s]+$/g, '').slice(0, 60)
      // No title from the model (it was needed elsewhere): the first words, once, rather than asking again every turn
      await renameChat(chatId, clean || fallbackTitle(question))
      onChatsChanged(chatId)
    }
    if (needsCompaction(saved)) {
      const controller = new AbortController()
      compacting.set(chatId, controller)
      try {
        const done = await compactChat(chatId, async (system, prompt) => {
          if (controller.signal.aborted) throw new Error('cancelled')
          return later(prompt, system, controller.signal)
        })
        if (done) onChatsChanged(chatId)
      } catch {
        // cancelled by a new message or the model was busy: the next turn tries again
      } finally {
        if (compacting.get(chatId) === controller) compacting.delete(chatId)
      }
    }
  })()
}

/** Where each lesson is: the level of its last problem, so "harder" and "easier" mean something */
const lessonLevels = new Map<string, Level>()

/**
 * A lesson turn with the problem bank: when checked problems are ready for the topic, the tutor is
 * told it may ask for one by level instead of writing it, and `supply` adds it; `prepare` tops the
 * bank up around the new level while the student answers.
 */
async function lessonTurn(req: TurnRequest) {
  const topic = req.topic && /problem set|first problem/i.test(req.instructions ?? '') ? req.topic : ''
  if (!topic) return null
  const { readBank, markUsed, prepareAround, aimAt } = await import('./bank')
  const { readable } = await import('@shared/lessonCheck')
  const { mayLeaveMac } = await import('./lessonGuard')
  const key = createHash('sha1').update(`${topic}\n${String(req.messages.find((m) => m.role === 'user')?.content ?? '')}`).digest('hex')
  const replies = req.messages.filter((m) => m.role === 'assistant').map((m) => String(m.content))
  const transcript = replies.join('\n')
  const seen = (p: BankProblem) => transcript.includes(p.text.slice(0, 80))
  const bank = await readBank(topic).catch(() => [] as BankProblem[])
  // The bank takes over once the problem set has begun (the tutor sets the first problem itself, after
  // its diagnostic and first teaching), never during the diagnostic
  const started = replies.some((r) => /\*\*\s*Problem\s+\d+/i.test(r))
  const messages = [...req.messages]
  const last = messages[messages.length - 1]
  // A turn with a pace note (you asked to be taught, or you've missed twice) is the tutor's, not the bank's
  const paced = typeof last?.content === 'string' && last.content.includes(PACE_MARK)
  const ready = started && !paced && ([1, 2, 3] as Level[]).some((l) => pickProblem(bank, l, seen))
  if (ready && last?.role === 'user' && typeof last.content === 'string') messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${BANK_NUDGE}` }
  const local = !(await mayLeaveMac(req))
  // While the reply streams: when the tutor starts a new problem right after short feedback, it's
  // stopped there and a checked problem from the bank takes its place (small models don't reliably
  // use the <next> tag). Text that might be the start of "**Problem" is held back a moment.
  const START = /\*\*\s*Problem\s+\d+/i
  let sent = ''
  let held = ''
  let cut = false
  const stop = new AbortController()
  const quickFeedback = (before: string) => {
    const after = before.split(/<\/grade>/i).pop() ?? ''
    return /<\/grade>/i.test(before) && after.length < 900 && !/^#{1,3}\s/m.test(after) && !/<plan>/i.test(after)
  }
  return {
    request: { ...req, messages },
    /** Ends the model's turn early when Tide takes over setting the problem */
    signal: stop.signal,
    tap(emit: (e: ChatEvent) => void): (e: ChatEvent) => void {
      return (e) => {
        if (e.type !== 'delta') return emit(e)
        if (cut) return
        held += e.text
        const m = ready ? START.exec(held) : null
        if (m && quickFeedback(sent + held.slice(0, m.index))) {
          const before = held.slice(0, m.index).replace(/\s+$/, '')
          if (before) emit({ ...e, text: before })
          sent += before
          held = ''
          cut = true
          stop.abort()
          return
        }
        // All but the tail, which could be the start of "**Problem 12"
        if (held.length > 16) {
          const out = held.slice(0, -16)
          emit({ ...e, text: out })
          sent += out
          held = held.slice(-16)
        }
      }
    },
    /** What the model wrote and the student saw; sends anything still held back */
    finish(emit: (e: ChatEvent) => void): string {
      if (held && !cut) {
        emit({ id: req.id, type: 'delta', text: held })
        sent += held
      }
      held = ''
      return sent
    },
    /** The problem the tutor asked for (by tag) or was about to write, as text to add to its reply */
    async supply(reply: string, emit: (e: ChatEvent) => void): Promise<string> {
      const verdict = /<grade\s+verdict\s*=\s*["']?(correct|partial|wrong)/i.exec(reply)?.[1]?.toLowerCase()
      // The mark decides how hard: right → harder, partly right → the same level, wrong → easier
      const byMark: Direction | undefined = verdict === 'correct' ? 'harder' : verdict === 'wrong' ? 'easier' : verdict === 'partial' ? 'same' : undefined
      // Hook (shared/difficulty.ts): when the answer carried the difficulty policy's note, the level follows it
      const planned = verdict ? plannedMove(typeof last?.content === 'string' ? last.content : '', verdict as 'correct' | 'partial' | 'wrong') : null
      const policy = planned ? (bankDirection(planned) ?? { dir: 'easier' as Direction, worked: false }) : null
      const dir = nextDirection(reply) || cut ? (policy?.dir ?? byMark ?? nextDirection(reply) ?? 'same') : undefined
      if (!dir) return ''
      const level = levelAfter(lessonLevels.get(key) ?? 2, dir)
      const p = pickProblem(bank, level, seen, Date.now(), key)
      if (!p) return ''
      // Just missed: worked for them up to the last step
      const text = renderProblem(p, problemsSoFar([...replies, reply]) + 1, dir, policy ? policy.worked : verdict === 'wrong')
      emit({ id: req.id, type: 'delta', text })
      lessonLevels.set(key, p.level)
      void markUsed(topic, p.id)
      return text
    },
    /** A checked problem at the lesson's level, in place of one that turned out flawed */
    async replacement(): Promise<string> {
      const level = lessonLevels.get(key) ?? 2
      const p = pickProblem(bank, level, seen, Date.now(), key)
      if (!p) return ''
      lessonLevels.set(key, p.level)
      void markUsed(topic, p.id)
      return renderProblem(p, Math.max(1, problemsSoFar(replies)), 'same')
    },
    prepare(reply: string) {
      // Missed: a problem aimed at exactly what was missed comes next (the tutor's own feedback says what)
      const g = /<grade\s+verdict\s*=\s*["']?(partial|wrong)["']?[^>]*>([\s\S]*?)<\/grade>/i.exec(reply)
      const previous = replies[replies.length - 1]
      if (g && previous) void aimAt(topic, readable(previous), g[2].trim(), key, lessonLevels.get(key) ?? 2, local)
      void prepareAround(topic, lessonLevels.get(key) ?? 2, local)
    }
  }
}

/** Each call a turn makes is logged under its lesson or conversation (main/usageLog) */
const answer = (req: TurnRequest, send: (e: ChatEvent) => void) =>
  withUsage({ lesson: req.chatId ?? req.labId, title: req.topic, thread: req.thread, ...(req.thread ? { job: 'thread' } : req.session ? {} : { job: 'chat' }) }, () => answerTurn(req, send))

async function answerTurn(req: TurnRequest, send: (e: ChatEvent) => void) {
  const controller = new AbortController()
  running.set(req.id, controller)
  // What the window was shown is what the next turn will send back as this answer. Once it's done,
  // the model on this Mac reads it in the background, so your next message doesn't wait for that
  const asked = req
  let shown = ''
  // Show me pressed while a question waits: the picture is held until it's checked against that
  // question's hidden solution (shared/showMe), so the answer is never drawn for them
  const { waitingQuestion, givesAway, setupOnlyNote, WITHHELD } = await import('@shared/showMe')
  const { SHOW_ME } = await import('@shared/session')
  const lastSaid = String([...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '')
  const { asksToSee } = await import('@shared/showMe')
  const waiting = req.session && (lastSaid.startsWith(SHOW_ME.slice(0, 60)) || asksToSee(lastSaid)) ? waitingQuestion(req.messages.slice(0, -1)) : null
  let holdShow = !!waiting
  let heldShow = ''
  const emit = (e: ChatEvent) => {
    if (holdShow && (e.type === 'delta' || e.type === 'reset')) {
      heldShow = e.type === 'delta' ? heldShow + e.text : ''
      return
    }
    if (e.type === 'delta') shown += e.text
    else if (e.type === 'reset') shown = ''
    // A side thread isn't read back: the lesson it sits in stays the conversation kept warm
    else if (e.type === 'done' && !controller.signal.aborted && !req.thread && answeredHere(req.id)) {
      const reply = asked.chatId ? cleanModelText(shown) : shown
      void import('./agent').then((a) => a.readBack(asked, reply))
    }
    send(e)
  }
  // Claude teaches when it's chosen and allowed (main/teacher): a private project or Metabase never
  // leaves the Mac. When it can't (not installed, logged out, at the plan's limit), Gemma does, and
  // a step says why. Gemma's lesson checks (lessonGuard, the problem bank, hidden tests written by
  // Gemma) are workarounds for a small model and don't run on Claude's turns: Claude runs its checks itself.
  const { teacherFor } = await import('./teacher')
  const teacher = await teacherFor(req).catch(() => ({ who: 'gemma' as const, why: undefined }))
  if (teacher.who === 'claude') {
    try {
      const { claudeTurn } = await import('./claudeEngine')
      // [source-led] A step taught from a source: the reading and its rules ride with the turn, Tide
      // puts the reading into the reply as it streams, and the turn is cut at a new plan whose first
      // step has a reading (Claude is interrupted, not stopped, so the lesson's process carries on)
      const led = req.session ? await import('./sourceLed').then((m) => m.sourceLedTurn(req)).catch(() => null) : null
      // Claude's exercises reach the lesson only once proven (main/exercises): its <exercise id> tags become the verified problem
      const exercises = req.session ? await (await import('./exercises')).exerciseStream(req, led ? led.tap(emit) : emit) : null
      await claudeTurn(led ? led.request : req, exercises ? exercises.tap : led ? led.tap(emit) : emit, controller.signal, led?.signal)
      exercises?.flush()
      // A picture asked for while a question waits was held: shown once it's checked against that
      // question's hidden solution, or drawn again as the setup only (the same check as Gemma's)
      if (waiting && holdShow && !controller.signal.aborted) {
        holdShow = false
        const what = givesAway(heldShow, waiting)
        let picture = heldShow
        if (what) {
          const step = (label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id: 'show-setup', kind: 'helper', label, status, depth: 0 } })
          step('That picture showed the answer you are working on: drawing the setup only', 'running')
          let again = ''
          await claudeTurn({ ...req, messages: [...req.messages, { role: 'assistant', content: heldShow }, { role: 'user', content: setupOnlyNote(what) }] }, (e) => {
            if (e.type === 'delta') again += e.text
            else if (e.type === 'reset') again = ''
            else if (e.type !== 'done' && e.type !== 'error') emit(e)
          }, controller.signal).catch(() => {})
          picture = again.trim() && !givesAway(again, waiting) ? again : WITHHELD
          step(picture === WITHHELD ? 'Held the picture back: it gave the answer away' : 'Drew the setup only', 'done')
        }
        emit({ id: req.id, type: 'delta', text: picture })
      }
      if (led && !controller.signal.aborted) led.settle(shown, emit)
      if (req.session && !controller.signal.aborted) emit({ id: req.id, type: 'replied' })
      emit({ id: req.id, type: 'done' })
      running.delete(req.id)
      return
    } catch (e) {
      const { ClaudeUnavailable } = await import('./claudeEngine')
      if (controller.signal.aborted) {
        emit({ id: req.id, type: 'done' })
        running.delete(req.id)
        return
      }
      // Claude failed with nothing shown yet (its limit, logged out, the network, any error): Gemma
      // takes the turn, loading first if it isn't loaded. Once Claude has written something, an
      // error stays an error: the turn can't be started again under it
      if (!(e instanceof ClaudeUnavailable) && shown.trim()) {
        emit({ id: req.id, type: 'error', message: `Claude: ${(e as Error).message}` })
        running.delete(req.id)
        return
      }
      const why = e instanceof ClaudeUnavailable ? e.message : `Claude stopped: ${(e as Error).message.slice(0, 120)}`
      const { reasonFromWhy, takeoverNote } = await import('@shared/gemmaPolicy')
      const { useGemma, refreshClaude } = await import('./modelIdle')
      void refreshClaude().catch(() => {})
      const g = await useGemma(e instanceof ClaudeUnavailable ? reasonFromWhy(why) : 'claude-failed')
      noteFallback(e instanceof ClaudeUnavailable ? reasonFromWhy(why) : 'claude-failed')
      emit({ id: req.id, type: 'step', step: { id: 'teacher', kind: 'helper', label: takeoverNote({ why: /private/i.test(why) ? `${why}: Gemma is teaching` : `Claude is unavailable (${why}): Gemma is teaching`, loaded: g.loaded }), status: 'done', depth: 0 } })
    }
  } else if (teacher.who === 'gemma') {
    // Gemma on demand (main/modelIdle): loaded now if it isn't, and the reason kept for Settings
    const { reasonFromWhy, takeoverNote } = await import('@shared/gemmaPolicy')
    const { useGemma } = await import('./modelIdle')
    const g = await useGemma(teacher.why ? reasonFromWhy(teacher.why) : req.engine === 'local' ? 'picked' : 'gemma-only')
    if (teacher.why) noteFallback(reasonFromWhy(teacher.why))
    if (teacher.why || !g.loaded) emit({ id: req.id, type: 'step', step: { id: 'teacher', kind: 'helper', label: takeoverNote({ why: teacher.why ?? 'Gemma is teaching', loaded: g.loaded }), status: 'done', depth: 0 } })
  }
  if (req.engine === 'claude') req = { ...req, engine: 'auto' }
  // Everything goes through the tool harness when it's on, so threads can run code and check maths too
  if (getSettings().ai.agent !== false) {
    try {
      const { agentChat } = await import('./agent')
      // In a lesson, a reply is checked before the student works on it (a repeated or missing
      // question, a check that fails, a flawed problem, a mark that's too generous) and written
      // again once if anything's wrong: see lessonGuard. In a problem set, the next problem comes
      // ready from the problem bank (see bank.ts): the tutor says how hard, Tide adds a checked one.
      // A worked answer is checked exactly first (SymPy), and the tutor is told before it marks it
      const exact = req.session ? await (await import('./lessonGuard')).exactCheck(req).catch(() => null) : null
      if (exact) {
        const { exactNote } = await import('@shared/answerCheck')
        const last = req.messages[req.messages.length - 1]
        req = { ...req, messages: [...req.messages.slice(0, -1), { ...last, content: `${String(last.content)}\n\n${exactNote(exact)}` }] }
        const label = exact.kind === 'sql' ? (exact.result === 'match' ? 'Ran your query beside the reference: the same rows' : 'Ran your query beside the reference: the rows differ') : exact.result === 'match' ? 'Checked your final answer: it’s right' : 'Checked your final answer: it isn’t right yet'
        emit({ id: req.id, type: 'step', step: { id: 'exact', kind: 'helper', label, status: 'done', depth: 0 } })
      }
      // [source-led] A step taught from a source (main/sourceLed.ts): the reading and the tutor's rules
      // for it ride with this turn, Tide puts the reading into the reply as it streams (`out`), and the
      // turn ends at a new plan whose first step has a reading (`led.signal`). Null: nothing changes.
      const led = req.session ? await import('./sourceLed').then((m) => m.sourceLedTurn(req)).catch(() => null) : null
      if (led) req = led.request
      // A SQL lesson's question is held back while it's written, and shown only once its reference
      // query has given a real answer on the lesson's lab (main/sqlCheck)
      const sqlMod = req.session ? await import('./sqlCheck') : null
      const downstream = led ? led.tap(emit) : emit
      const gate = sqlMod?.sqlLesson(req) ? sqlMod.holdAsks(downstream) : null
      const out = gate ? gate.tap : downstream
      const upTo = led ? AbortSignal.any([controller.signal, led.signal]) : controller.signal
      const lesson = req.session && !led?.teaching ? await lessonTurn(req) : null
      let reply = ''
      if (lesson) {
        // The model's turn ends early when Tide takes over setting the problem: that's not an error
        try {
          await agentChat(lesson.request, lesson.tap(out), AbortSignal.any([upTo, lesson.signal]))
        } catch (e) {
          if (!(lesson.signal.aborted || led?.signal.aborted) || controller.signal.aborted) throw e
        }
        reply = lesson.finish(out)
      } else {
        try {
          await agentChat(req, (e) => (e.type === 'delta' && (reply += e.text), out(e)), upTo)
        } catch (e) {
          if (!led?.signal.aborted || controller.signal.aborted) throw e
        }
      }
      if (gate && sqlMod) {
        const { sent, held } = gate.finish()
        let settled = held
        if (held && !controller.signal.aborted) {
          const rewrite = async (why: string) => {
            let again = ''
            const messages: ChatMessage[] = [...req.messages, { role: 'assistant', content: reply }, { role: 'user', content: `(Tide: the problem you just set can't be used: ${why}. Don't ask it again in any form (not even as the recall question): pick columns that are filled on the same rows. Write only a new, well-posed problem on the same idea that the lab's tables answer with real, non-NULL values: first run your reference query with run_sql and check its rows, then write the problem, put that exact query in a <solution> as a \`\`\`sql block, and end with the question in an <ask type="code" lang="sql"> tag. No feedback, no preamble.)` }]
            await agentChat({ ...req, messages }, (e) => {
              if (e.type === 'delta') again += e.text
              else if (e.type === 'reset') again = ''
              else if (e.type !== 'done' && e.type !== 'error') emit(e)
            }, controller.signal).catch(() => {})
            return again
          }
          const banked = async () => {
            const { readBank } = await import('./bank')
            const all = await readBank(req.topic ?? '').catch(() => [])
            return all.filter((p) => !reply.includes(p.text.slice(0, 80))).slice(0, 6).map((p) => renderProblem(p, 1, 'same'))
          }
          const step = (label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id: 'sql-problem', kind: 'run_sql', label, status, depth: 0 } })
          const { retireRecall } = await import('./recall')
          const r = await sqlMod.settleSqlProblem(reply, held, { lab: sqlMod.labOf(req), signal: controller.signal, ask: (prompt, system) => complete(prompt, system, controller.signal, 'interactive', 'other'), rewrite, banked, step, retire: (q) => void retireRecall(q) })
          settled = r.text
        }
        if (settled) downstream({ id: req.id, type: 'delta', text: settled })
        reply = sent + settled
      }
      if (waiting && holdShow) {
        holdShow = false
        const what = givesAway(heldShow, waiting)
        let picture = heldShow
        if (what && !controller.signal.aborted) {
          const step = (label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id: 'show-setup', kind: 'helper', label, status, depth: 0 } })
          step('That picture showed the answer you are working on: drawing the setup only', 'running')
          let again = ''
          await agentChat({ ...req, messages: [...req.messages, { role: 'assistant', content: heldShow }, { role: 'user', content: setupOnlyNote(what) }] }, (e) => {
            if (e.type === 'delta') again += e.text
            else if (e.type === 'reset') again = ''
            else if (e.type !== 'done' && e.type !== 'error') emit(e)
          }, controller.signal).catch(() => {})
          picture = again.trim() && !givesAway(again, waiting) ? again : WITHHELD
          step(picture === WITHHELD ? 'Held the picture back: it gave the answer away' : 'Drew the setup only', 'done')
        }
        emit({ id: req.id, type: 'delta', text: picture })
        reply = picture
      }
      // [source-led] What the checks read is the tutor's own words, without the source's
      if (led && !controller.signal.aborted) reply = led.settle(shown, emit)
      // Faults a rule can see are put right before anything reads the reply (the checks, the problem
      // bank, the lesson's record, the model's own next turn): a mark on something that wasn't an
      // answer, a grade left unclosed, a numbered question with only Go on to press
      if (req.session && shown && !controller.signal.aborted) {
        const { repairReply } = await import('@shared/lessonRepair')
        const said = [...req.messages].reverse().find((m) => m.role === 'user')
        // What the window is showing (it follows a retry's reset, which the tally in `reply` does not)
        const fixed = repairReply(shown, typeof said?.content === 'string' ? said.content : '')
        if (fixed.repaired.length && fixed.text !== shown) {
          emit({ id: req.id, type: 'reset' })
          emit({ id: req.id, type: 'delta', text: fixed.text })
          reply = fixed.text
        }
      }
      let fromBank = false
      if (lesson && !controller.signal.aborted) {
        const added = await lesson.supply(reply, emit)
        reply += added
        fromBank = !!added
      }
      if (req.session && !controller.signal.aborted) {
        // You can start answering now; the checks go on behind it
        emit({ id: req.id, type: 'replied' })
        const { checkLessonReply } = await import('./lessonGuard')
        const ask = (prompt: string, system: string, task: RequestKind, signal: AbortSignal, routine?: boolean) => complete(prompt, system, signal, 'interactive', task, routine)
        const found: import("./lessonGuard").LessonFindings = await checkLessonReply(req, reply, emit, controller.signal, ask, false, { fromBank, exact }).catch(() => ({ problem: [] as string[] }))
        // What you can see is never wiped: a correction is added below it
        if (found.mark && !controller.signal.aborted) {
          const add = `\n\n<grade verdict="${found.mark.verdict}" score="${found.mark.verdict === 'correct' ? 1 : found.mark.verdict === 'partial' ? 0.5 : 0}">**Second look:** ${found.mark.why}</grade>`
          emit({ id: req.id, type: 'delta', text: add })
          reply += add
        }
        // A mistake in a worked example: the correction goes under the explanation, and into the notes
        if (found.errata && !controller.signal.aborted) {
          const add = correctionText(found.errata)
          emit({ id: req.id, type: 'delta', text: add })
          reply += add
        }
        if (found.problem.length && !controller.signal.aborted) {
          const why = found.problem[0].replace(/\.$/, '')
          // A checked one from the bank when there is one; otherwise the tutor writes just a new problem
          const banked = lesson ? await lesson.replacement() : ''
          const lead = `\n\n**That problem had a flaw (${why.charAt(0).toLowerCase()}${why.slice(1)}), so here's another.**`
          if (banked) {
            emit({ id: req.id, type: 'delta', text: lead + banked })
            reply += lead + banked
          } else {
            // Written in full before it is shown: a reset inside it (a stall picked up again) must not
            // wipe the mark above it, and if no new problem comes the one on screen stands, rather
            // than a promise of "another" with nothing after it (as happened live)
            let again = ''
            const messages: ChatMessage[] = [...req.messages, { role: 'assistant', content: reply }, { role: 'user', content: `(Tide: the problem you just set can't be used: ${why}. Write only a new, well-posed problem on the same idea, numbered the same, with its <solution> and ending with the question in an <ask> tag. No feedback, no preamble.)` }]
            await agentChat({ ...req, messages }, (e) => {
              if (e.type === 'delta') again += e.text
              else if (e.type === 'reset') again = ''
              else if (e.type !== 'done' && e.type !== 'error') emit(e)
            }, controller.signal).catch(() => {})
            if (!controller.signal.aborted && /<ask\b/i.test(again)) {
              emit({ id: req.id, type: 'delta', text: lead + again })
              reply += lead + again
              // The replacement still gets its solution for marking
              await checkLessonReply(req, again, emit, controller.signal, ask, true).catch(() => null)
            }
          }
        }
        // A code question set without hidden tests gets them, from its reference solution (main/codeTests)
        const { untestedCodeAsk, testNames } = await import('@shared/codeTests')
        if (!controller.signal.aborted && untestedCodeAsk(shown)) {
          const { testsFor } = await import('./codeTests')
          const { runCode } = await import('./runner')
          const step = (label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id: 'code-tests', kind: 'run_code', label, status, depth: 0 } })
          step('Writing hidden tests from the reference solution', 'running')
          const made = await testsFor(shown, { ask: (prompt, system) => complete(prompt, system, controller.signal, 'interactive', 'other'), run: (lang, code, stdin, o) => runCode(lang, code, stdin, 20_000, o) }).catch(() => null)
          const tests = made?.tests
          if (made && tests && !controller.signal.aborted) {
            // With the reference it was made from, when the tutor wrote none: the answer is marked against it
            const add = `${made.solution ? `\n\n<solution>\n${made.solution}\n</solution>` : ''}\n\n<tests>\n${tests}\n</tests>`
            emit({ id: req.id, type: 'delta', text: add })
            reply += add
          }
          const n = tests ? testNames(tests).length : 0
          step(n ? `Wrote ${n} hidden test${n === 1 ? '' : 's'} the reference solution passes` : 'No hidden tests: the reference solution gave none to keep', 'done')
        }
        lesson?.prepare(reply)
      }
      emit({ id: req.id, type: 'done' })
      running.delete(req.id)
      return
    } catch (e) {
      if (controller.signal.aborted) {
        emit({ id: req.id, type: 'done' })
        running.delete(req.id)
        return
      }
      // Servers without tool support reject the request; answer without tools instead
      if (!/\b(400|422)\b|tool/i.test((e as Error).message)) {
        emit({ id: req.id, type: 'error', message: friendlyError(e) })
        running.delete(req.id)
        return
      }
    }
  }
  try {
    const question = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const sources = await retrieve(req.scope, question)
    emit({ id: req.id, type: 'sources', sources })

    const context = [
      sources.length ? `Sources from the user's notes:\n\n${formatSources(sources)}` : '',
      req.attachment ? `The user selected this passage:\n"""\n${req.attachment}\n"""` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const { stablePrompt, withStableContext } = await import('./agent')
    const history = req.chatId ? req.messages : fitHistory(req.messages, historyBudget(), !!req.instructions)
    const messages: ChatMessage[] = [{ role: 'system', content: await stablePrompt(SYSTEM_PROMPT, req, false) }, ...withStableContext(history, context)]

    for await (const text of streamCompletion(messages, controller.signal)) {
      emit({ id: req.id, type: 'delta', text })
    }
    emit({ id: req.id, type: 'done' })
  } catch (e) {
    if (controller.signal.aborted) emit({ id: req.id, type: 'done' })
    else emit({ id: req.id, type: 'error', message: friendlyError(e) })
  } finally {
    running.delete(req.id)
  }
}

/** The answer's last request went to the model on this Mac (a cloud answer leaves nothing for it to read back) */
function answeredHere(id: string): boolean {
  return recentSpeed().find((t) => t.id === id)?.calls.at(-1)?.engine === 'local'
}

export function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/fetch failed|ECONNREFUSED/i.test(msg)) {
    return `Can't reach the AI server at ${getSettings().ai.baseUrl}. Is it running? You can change the address in Settings.`
  }
  return msg
}

// ---------- One-shot generations ----------

/**
 * Streams a long Markdown draft (an outline, a prep plan, a review) that must not repeat itself.
 * The draft model ignores the repetition penalty, so a 12B model can get stuck writing the same
 * line forever: repeated lines are dropped, and if it sticks, that pass stops and the model picks
 * up after the last good line, a little warmer, which breaks the loop (twice at most).
 */
export async function* streamDraft(messages: ChatMessage[], signal: AbortSignal, maxTokens: number, task: RequestKind = 'other'): AsyncGenerator<string> {
  let written = ''
  const base = getSettings().ai.temperature
  for (let pass = 0; pass < 3; pass++) {
    const guard = createLineGuard()
    const local = new AbortController()
    const stop = () => local.abort()
    signal.addEventListener('abort', stop, { once: true })
    const turn: ChatMessage[] = pass
      ? [
          ...messages,
          { role: 'assistant', content: written.trim() },
          { role: 'user', content: `Continue from exactly after this line, writing only what comes next and nothing already written above: "${guard.lastGood || written.trim().split('\n').pop()}". If it was already complete, reply with nothing.` }
        ]
      : messages
    // Lines from earlier passes count as written, so a continuation can't repeat them either
    for (const l of written.split('\n')) guard.push(l + '\n')
    try {
      for await (const t of streamRouted(turn, local.signal, maxTokens, task, pass ? base + 0.3 * pass : undefined)) {
        const out = guard.push(t)
        if (out) {
          written += out
          yield out
        }
        if (guard.stuck) {
          local.abort()
          break
        }
      }
    } catch (e) {
      if (!local.signal.aborted || signal.aborted) throw e
    } finally {
      signal.removeEventListener('abort', stop)
    }
    if (signal.aborted) return
    if (!guard.stuck) {
      const tail = guard.end()
      if (tail) {
        written += tail
        yield tail
      }
      return
    }
    if (!written.endsWith('\n')) {
      written += '\n'
      yield '\n'
    }
  }
}

/**
 * One-shot generation. Background work (titles, compaction, margin notes) waits for an idle model
 * and gives way when the user needs it; everything else runs at once.
 */
/** `routine`: work that can be left to Gemma when a cloud model's free allowance for the day is running low */
/** `schema`: the JSON shape the reply must have, for cloud providers that can be held to one; the local model's reply is repaired instead (extractJson*) */
export async function complete(prompt: string, system?: string, signal?: AbortSignal, priority: 'interactive' | 'background' = 'interactive', task: RequestKind = priority === 'background' ? 'background' : 'other', routine = false, schema?: ReplySchema): Promise<string> {
  if (priority === 'background') return inBackground((s) => completeNow(prompt, system, s, true, task), signal)
  return completeNow(prompt, system, signal, false, task, routine, schema)
}

async function completeNow(prompt: string, system: string | undefined, signal: AbortSignal | undefined, background: boolean, task: RequestKind = 'other', routine = false, schema?: ReplySchema): Promise<string> {
  const controller = new AbortController()
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  let out = ''
  const messages: ChatMessage[] = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user', content: prompt }
  ]
  // Planning, marking, JSON: greedy decoding, which is also when the draft model's guesses match
  // most often (the server's fastest path), and the answers are the most consistent. Greedy can
  // also lock into a loop; then it's stopped and tried once more, warmer.
  for (const temperature of [0, 0.6]) {
    const pass = new AbortController()
    const stop = () => pass.abort()
    controller.signal.addEventListener('abort', stop, { once: true })
    out = ''
    let looped = false
    try {
      // Planning and marking go to the cloud model when they're set to escalate; background work never does
      const stream = background ? streamCompletion(messages, pass.signal, 3000, true, temperature, task) : streamRouted(messages, pass.signal, 3000, task, temperature, routine, schema)
      for await (const t of stream) {
        out += t
        if (isLooping(out)) {
          looped = true
          pass.abort()
          break
        }
      }
    } catch (e) {
      if (!looped || controller.signal.aborted) throw new Error(friendlyError(e))
    } finally {
      controller.signal.removeEventListener('abort', stop)
    }
    if (!looped) break
    if (temperature) throw new Error('The model got stuck repeating itself. Try again.')
  }
  return stripThinking(out).trim()
}

// ---------- Jobs: Claude first, Gemma on demand ----------

/**
 * How a job knows whether it must stay on this Mac (shared/gemmaPolicy JOB_ROUTES says which
 * applies): the note paths it reads, the text to look through for Metabase or a private
 * project's name, or the caller's own answer. Anything about Metabase always stays.
 */
export interface JobOpts {
  signal?: AbortSignal
  priority?: 'interactive' | 'background'
  task?: RequestKind
  routine?: boolean
  schema?: ReplySchema
  path?: string | string[]
  /** Looked through for a private project's name (the prompt itself is always looked through for Metabase) */
  text?: string
  private?: boolean
  /** How long Claude has before Gemma takes the job instead */
  timeoutMs?: number
  /** A Claude failure throws instead of loading Gemma (for a job with its own answer when the model can't give one) */
  noFallback?: boolean
}

/** Claude's time for a one-shot job, by its model's role, before Gemma takes it */
const CLAUDE_JOB_MS: Record<string, number> = { background: 60_000, teach: 120_000, mark: 120_000, hard: 180_000 }

/** Where this job goes now (shared/gemmaPolicy routeJob, with privacy looked up) */
export async function jobRoute(job: JobName, prompt: string, o: JobOpts = {}): Promise<Route> {
  let priv = !!o.private
  let metabase = /\bmetabase\b/i.test(prompt)
  if (!priv && !metabase && o.path) {
    const { privatePath } = await import('./projects')
    for (const p of [o.path].flat()) {
      // Unsure counts as private
      if (p && (await privatePath(p).catch(() => true))) {
        priv = true
        break
      }
    }
  }
  if (!priv && !metabase && o.text !== undefined) {
    const { privateText } = await import('./teacher')
    const t = await privateText(o.text)
    metabase = t === 'metabase'
    priv = t === 'private'
  }
  return routeJob(job, { private: priv, metabase, claude: claudeState() })
}

/** Why Gemma takes a job Claude couldn't */
async function failedReason(e: unknown): Promise<GemmaReason> {
  const { ClaudeUnavailable } = await import('./claudeEngine')
  void refreshClaude().catch(() => {})
  if (!(e instanceof ClaudeUnavailable)) return 'claude-failed'
  const { reasonFromWhy } = await import('@shared/gemmaPolicy')
  return reasonFromWhy(e.message)
}

/**
 * One job's whole answer: on Claude (its role's model) when the job may leave this Mac and Claude
 * can take it, else on Gemma, loaded for it if it isn't. A Claude call that fails or takes too long
 * is handed to Gemma (it loads, and the job goes on).
 */
export async function completeFor(job: JobName, prompt: string, system: string | undefined, o: JobOpts = {}): Promise<string> {
  return claudeOr(job, prompt, system, o, () => complete(prompt, system, o.signal, o.priority ?? 'interactive', o.task, o.routine, o.schema))
}

/** As completeFor, with the job's own way of asking Gemma (a tool loop, say) */
export function claudeOr(job: JobName, prompt: string, system: string | undefined, o: JobOpts, gemma: () => Promise<string>): Promise<string> {
  return withUsage({ job }, () => claudeOrGemma(job, prompt, system, o, gemma))
}

async function claudeOrGemma(job: JobName, prompt: string, system: string | undefined, o: JobOpts, gemma: () => Promise<string>): Promise<string> {
  const route = await jobRoute(job, `${system ?? ''}\n${prompt}`, o)
  let reason: GemmaReason
  if (route.who === 'claude') {
    try {
      const { claudeOnce } = await import('./claudeEngine')
      const limit = AbortSignal.timeout(o.timeoutMs ?? CLAUDE_JOB_MS[route.role] ?? 120_000)
      const r = await claudeOnce(prompt, system ?? 'You are a careful assistant.', route.role, o.signal ? AbortSignal.any([o.signal, limit]) : limit)
      return stripThinking(r.text).trim()
    } catch (e) {
      if (o.signal?.aborted || o.noFallback) throw e
      reason = await failedReason(e)
    }
  } else reason = route.reason
  await useGemma(reason)
  noteFallback(reason)
  return gemma()
}

/**
 * A long draft streamed as it's written: Claude when the job may leave the Mac and Claude can,
 * else Gemma's streamDraft. If Claude can't before writing anything, Gemma takes it.
 */
export function draftFor(job: JobName, messages: ChatMessage[], signal: AbortSignal, maxTokens: number, task: RequestKind, o: JobOpts = {}): AsyncGenerator<string> {
  return withUsageGen({ job }, () => draftOn(job, messages, signal, maxTokens, task, o))
}

async function* draftOn(job: JobName, messages: ChatMessage[], signal: AbortSignal, maxTokens: number, task: RequestKind, o: JobOpts = {}): AsyncGenerator<string> {
  const system = String(messages.find((m) => m.role === 'system')?.content ?? '')
  const user = messages.filter((m) => m.role !== 'system').map((m) => String(m.content)).join('\n\n')
  const route = await jobRoute(job, `${system}\n${user}`, o)
  let reason: GemmaReason
  if (route.who === 'claude') {
    let any = false
    try {
      const { claudeStream } = await import('./claudeEngine')
      for await (const t of claudeStream(user, system || 'You are a careful expert.', route.role, signal)) {
        any = true
        yield t
      }
      return
    } catch (e) {
      if (any || signal.aborted) throw e
      reason = await failedReason(e)
    }
  } else reason = route.reason
  await useGemma(reason)
  noteFallback(reason)
  yield* streamDraft(messages, signal, maxTokens, task)
}

const prewarmedPaths = new Map<string, number>()
/**
 * A note is opening: when it is in a private project and Claude is the main tutor, Gemma loads
 * now, so its margin tutor or lesson isn't the reply that waits for the load. At most once a
 * minute per note.
 */
export async function prewarmForPath(path: string): Promise<boolean> {
  if (!path || !claudeState().main) return false
  const at = prewarmedPaths.get(path)
  if (at && Date.now() - at < 60_000) return false
  prewarmedPaths.set(path, Date.now())
  if (prewarmedPaths.size > 50) prewarmedPaths.delete(prewarmedPaths.keys().next().value!)
  const { privatePath } = await import('./projects')
  if (!(await privatePath(path).catch(() => false))) return false
  void prewarmGemma('private').catch(() => {})
  return true
}

const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '')

/**
 * Models often write LaTeX inside JSON strings without escaping it ("\\frac" as "\frac"), which
 * is either invalid JSON or, worse, silently turns \theta into a tab. Double any lone backslash
 * that starts a command name (two or more letters) so it survives JSON.parse.
 */
export const escapeLatexInJson = (json: string) => json.replace(/(?<!\\)((?:\\\\)*)\\(?=[a-zA-Z]{2,})/g, '$1\\\\')

/** JSON.parse, or undefined */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** jsonrepair, or undefined when even it can't make JSON of the text */
function repaired(text: string): unknown {
  try {
    return JSON.parse(jsonrepair(text))
  } catch {
    return undefined
  }
}

/**
 * A reply cut off inside a list (max_tokens ran out): the list up to its last whole item, closed.
 * Repairing the cut item as well would invent the rest of it, so it is left out.
 */
export function wholeItems(tail: string): string | null {
  let depth = 0
  let inString: string | null = null
  let lastWhole = -1
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === inString) {
        inString = null
        if (depth === 1) lastWhole = i + 1
      }
      continue
    }
    if (c === '"' || c === "'") inString = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) return null // not cut off: the list closes
      if (depth === 1) lastWhole = i + 1
    } else if (depth === 1 && /[\w.]/.test(c) && !/[\w.]/.test(tail[i + 1] ?? '')) lastWhole = i + 1
  }
  return lastWhole > 0 ? tail.slice(0, lastWhole) + ']' : '[]'
}

/**
 * Whether a span has words outside strings that JSON can't hold (prose such as "see [1] and [2]
 * below"): jsonrepair would quote them and return a list of nonsense, so such a span isn't repaired.
 * Bare object keys ({front: "x"}) and literals are fine.
 */
export function hasProse(span: string): boolean {
  let quote: string | null = null
  for (let i = 0; i < span.length; i++) {
    const c = span[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (!/[A-Za-z_]/.test(c)) continue
    WORD.lastIndex = i
    const word = WORD.exec(span)![0]
    COLON.lastIndex = i + word.length
    if (!COLON.test(span) && !LITERALS.has(word)) return true
    i += word.length - 1
  }
  return false
}
const WORD = /[A-Za-z_][\w$]*/y
const COLON = /\s*:/y
const LITERALS = new Set(['true', 'false', 'null', 'True', 'False', 'None', 'NaN', 'Infinity', 'undefined'])

/**
 * Reads JSON of one kind ('[' for a list, '{' for an object) out of a model reply, in order of
 * trust: the reply as it is; then, from the first opening bracket, the span to the last closing
 * one with unescaped LaTeX repaired; for a list cut off part-way, the items that were whole; then
 * jsonrepair, which mends trailing commas, single quotes, comments and unquoted keys. An opening
 * in prose ("see [1]") is passed over for the next.
 */
function extractJson(text: string, open: '[' | '{'): unknown {
  const close = open === '[' ? ']' : '}'
  const fits = (v: unknown) => (open === '[' ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v))
  const strict = parsed(text.trim())
  if (fits(strict)) return strict
  const cleaned = text.replace(/```(?:json)?/g, '')
  const end = cleaned.lastIndexOf(close)
  const openings: number[] = []
  for (let at = cleaned.indexOf(open); at >= 0 && openings.length < 8; at = cleaned.indexOf(open, at + 1)) openings.push(at)
  // From each opening in turn: brackets in prose before the JSON ("see [1]") are passed over
  for (const at of openings) {
    if (end > at) {
      const raw = cleaned.slice(at, end + 1)
      for (const v of [parsed(escapeLatexInJson(raw)), parsed(raw)]) if (fits(v)) return v
    }
    const tail = escapeLatexInJson(cleaned.slice(at))
    // A list that never closes was cut off: its whole items come first, before any repair of the rest
    const cut = open === '[' ? wholeItems(tail) : null
    const spans = [cut, end > at ? escapeLatexInJson(cleaned.slice(at, end + 1)) : null, tail]
    for (const span of spans) {
      if (span === null || hasProse(span)) continue
      const v = repaired(span)
      if (fits(v)) return v
    }
  }
  return undefined
}

/** Pulls the first JSON array out of a model reply that may include prose, code fences or broken JSON. */
export function extractJsonArray<T>(text: string): T[] {
  if (!text.includes('[')) throw new Error('The AI did not return a list. Try again.')
  const v = extractJson(text, '[')
  if (v === undefined) throw new Error('The AI answer was not in the expected format. Try again.')
  return v as T[]
}

/** Pulls the first JSON object out of a model reply, repaired like extractJsonArray */
export function extractJsonObject<T>(text: string): T {
  const v = extractJson(text, '{')
  if (v === undefined) throw new Error('The AI answer was not in the expected format. Try again.')
  return v as T
}

export async function generateFlashcards(
  path: string,
  count: number,
  focusText?: string,
  /** A book's chapter: cards from passages across those pages */
  pages?: { from: number; to: number }
): Promise<{ front: string; back: string }[]> {
  const material = focusText
    ? focusText
    : formatSources(await retrieve(pages ? { kind: 'pages', path, from: pages.from, to: pages.to } : { kind: 'note', path }, 'key concepts definitions formulas'))
  const prompt = `Create ${count} high quality flashcards for studying the material below.
Rules:
- One fact or idea per card. Ask about understanding, not trivia.
- Fronts are questions. Backs are short, precise answers (1-3 sentences, LaTeX for math).
- Return ONLY a JSON array like [{"front": "...", "back": "..."}].

Material:
${material}`
  const cards = extractJsonArray<{ front: string; back: string }>(await completeFor('flashcards', prompt, undefined, { path }))
  return cards.filter((c) => c?.front && c?.back).slice(0, count)
}

/**
 * Reads the passage the student just wrote, like a tutor looking over their shoulder.
 * Returns null when there is nothing worth saying, so the margin stays quiet.
 */
export async function readAlong(path: string, passage: string, mode: string, force = false, style?: 'coach'): Promise<ReadAlongNote | null> {
  const sources = await retrieve({ kind: 'note', path }, passage)
  // Enough of the note to judge the paragraph in context; more only slows the model's reading
  const context = formatSources(sources).slice(0, force ? 6000 : 2500)
  if (style === 'coach' && !force) return coachNote(passage, context, mode, path)
  if (force) {
    // The student asked to be tested: always ask something, never explain
    const out = await completeFor('marginQuestion', `A student is writing notes to learn something deeply and asked you to test their thinking on the passage below.
${mode ? `${mode}\n` : ''}
Ask ONE short, pointed question (max 2 sentences) that tests whether they really understand it: why it works, what happens in an edge case, how it connects to something else, or to apply it to a new example. If the passage contains a mistake, ask a question that leads them to find it. Don't explain, don't answer it yourself.
Return ONLY the question.

<note>
${context}
</note>

<passage>
${passage}
</passage>`, undefined, { path })
    const text = out.replace(/^["'\s]+|["'\s]+$/g, '')
    return text ? { kind: 'question', text } : null
  }
  const prompt = `A student is writing study notes. Look at the passage they just wrote, in the context of the rest of the note.
${mode ? `${mode}\n` : ''}
Reply with ONE short margin note (max 2 sentences) only if it genuinely helps them learn:
- "correction": the passage states something wrong or misleading
- "gap": an important idea, condition or edge case is missing
- "question": a Socratic question that makes them think deeper (don't give the answer)
- "praise": only for a really sharp insight
If nothing is worth saying, reply exactly NONE.
Return ONLY JSON like {"kind": "question", "text": "..."} or NONE.

<note>
${context}
</note>

<passage>
${passage}
</passage>`
  const out = await completeFor('marginNote', prompt, undefined, { path, priority: 'background' })
  if (/^\s*NONE\b/i.test(out)) return null
  const json = out.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const note = JSON.parse(escapeLatexInJson(json)) as ReadAlongNote
    return ['question', 'gap', 'correction', 'praise'].includes(note.kind) && note.text ? note : null
  } catch {
    return null
  }
}

/**
 * The writing coach: one margin note on the paragraph just written, aimed at understanding first
 * (a probing question, a correction, a missing piece) and clearer writing second, with a rewrite
 * the student can apply. Rewrites that don't look like the same paragraph are dropped.
 */
async function coachNote(passage: string, context: string, mode: string, path: string): Promise<ReadAlongNote | null> {
  const prompt = `A student is writing notes in their own words to understand a topic deeply. You sit beside them as a coach for their thinking and their writing. Look at the paragraph they just wrote, in the context of the rest of the note.
${mode ? `${mode}\n` : ''}
Reply with ONE margin note, and only if it genuinely helps:
- "correction": something is wrong or misleading. Say what, and why, in one or two sentences. Add "rewrite": the paragraph corrected, keeping their voice.
- "question": a probing question that tests whether they understand it (why it works, an edge case, applying it to a new example). Don't answer it.
- "gap": an important idea, condition or edge case is missing. Name it or ask about it.
- "improve": the idea is right but the writing is vague, wordy or unclear. Say what to change in one sentence. Add "rewrite": a clearer version in their voice, about the same length, same Markdown.
Prefer correction and question over improve. Never praise. Keep maths in LaTeX ($...$) as they wrote it.
If nothing is worth saying, reply exactly NONE.
Return ONLY JSON like {"kind": "improve", "text": "...", "rewrite": "..."} or NONE.

<note>
${context}
</note>

<paragraph>
${passage}
</paragraph>`
  // Feedback while writing: Haiku when the note may leave this Mac; on Gemma it waits for the model to be free, your chat and lessons first
  const out = await completeFor('marginNote', prompt, undefined, { path, priority: 'background' })
  return parseCoachNote(out, passage)
}

export function parseCoachNote(out: string, passage: string): ReadAlongNote | null {
  if (/^\s*NONE\b/i.test(out)) return null
  const json = out.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const note = JSON.parse(escapeLatexInJson(json)) as ReadAlongNote
    if (!['question', 'gap', 'correction', 'improve'].includes(note.kind) || typeof note.text !== 'string' || !note.text.trim()) return null
    let rewrite = typeof note.rewrite === 'string' ? note.rewrite.trim() : ''
    const ratio = rewrite.length / Math.max(1, passage.trim().length)
    // A rewrite must read as the same paragraph: similar length, and actually different
    if (!rewrite || ratio < 0.4 || ratio > 2.5 || rewrite === passage.trim() || (note.kind !== 'improve' && note.kind !== 'correction')) rewrite = ''
    if (note.kind === 'improve' && !rewrite) return null
    return { kind: note.kind, text: note.text.trim(), ...(rewrite ? { rewrite } : {}) }
  } catch {
    return null
  }
}

/**
 * When the teaching router's top two choices are close: the model picks, from a short prompt and
 * a one-letter answer. Gives up after a few seconds and keeps the router's first choice.
 */
export async function tieBreak(topic: string, options: Strategy[], context = ''): Promise<Strategy> {
  const letters = options.map((o, i) => `${String.fromCharCode(65 + i)}) ${STRATEGY_LABEL[o]}`).join('\n')
  const ask = completeFor(
    'tieBreak',
    `A learner is starting a lesson on: ${topic}${context ? ` (${context})` : ''}.\nWhich way of teaching fits it best?\n${letters}\nReply with the letter only.`,
    'You choose how to teach a topic. Reply with one letter.',
    // Claude gets the same few seconds; past them the router's first choice stands, without loading Gemma for it
    { text: `${topic} ${context}`, timeoutMs: 5000, noFallback: true }
  ).then((out) => options[(out.trim().toUpperCase().charCodeAt(0) || 65) - 65] ?? options[0])
  const timeout = new Promise<Strategy>((resolve) => setTimeout(() => resolve(options[0]), 5000))
  return Promise.race([ask, timeout]).catch(() => options[0])
}
