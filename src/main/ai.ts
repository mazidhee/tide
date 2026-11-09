import { inBackground, streamInteractive } from './modelQueue'
import { STRATEGY_LABEL, type Strategy } from '@shared/strategy'
import { canTake, CloudUnavailable, cloudError, coolingDown, coolTarget, deadlineFor, estimateTokens, headersFor, noteLimits, noteSent, recordUsage, routeFor, secondsUntilReset, type CloudTarget } from './cloud'
import type { CloudTask, RequestKind } from '@shared/providers'
import { memoryIntent } from '@shared/memoryIntent'
import { addMemory, forgetMatching } from './memory'
import type { AgentStep, Chat, StoredMessage } from '@shared/types'
import type { TurnRequest } from './agent'
import { filedUnder } from './learn'
import { compactChat, fallbackTitle, historyBudget, historyFor, needsCompaction, newChat, renameChat, updateChat } from './chats'
import { fitHistory } from '@shared/context'
import { cleanModelText } from '@shared/modelText'
import type { ChatEvent, ChatMessage, ChatRequest, ChatScope, ContextSource, ReadAlongNote } from '@shared/types'
import { getSettings } from './settings'
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
  // Prefer what the server already has in memory, then chat/instruct tuned models
  const rank = (m: { id: string; loaded?: boolean }) =>
    (m.loaded ? 0 : 2) + (/(-it\b|instruct|chat)/i.test(m.id) ? 0 : 1)
  // Speculative-decoding draft models are listed too, but can't hold a conversation
  return [...models].filter((m) => !/assistant|drafter|dflash|dspark|eagle/i.test(m.id)).sort((a, b) => rank(a) - rank(b)).map((m) => m.id).filter(Boolean)
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
function retrievePages(scope: Extract<ChatScope, { kind: 'pages' }>, query: string): Chunk[] {
  const inRange = getChunks(scope.path).filter((c) => {
    const p = chunkPage(c)
    return p >= scope.from && p <= scope.to
  })
  const size = inRange.reduce((n, c) => n + c.text.length, 0)
  if (size <= CONTEXT_BUDGET) return inRange
  const ids = new Set(inRange.map((c) => c.id))
  // The passages that match best, then the rest of the chapter sampled evenly, so a quiz or a
  // summary covers the whole range instead of only its first pages
  const hits = search(query, 40, (p) => p === scope.path)
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
export async function lessonPassage(topic: string): Promise<{ label: string; path: string; from: number; to: number; text: string } | null> {
  const { pagesToRead } = await import('./books')
  const { readingLabel } = await import('@shared/books')
  const s = (await pagesToRead(topic, 1).catch(() => []))[0]
  if (!s) return null
  await indexReady()
  const to = Math.min(s.to, s.from + 8)
  const chunks = retrievePages({ kind: 'pages', path: s.path, from: s.from, to }, topic).sort((a, b) => chunkPage(a) - chunkPage(b))
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
    const picked = takeWithinBudget(retrievePages(scope, query), CONTEXT_BUDGET).sort((a, b) => a.order - b.order)
    return picked.map((c, i) => ({ index: i + 1, path: c.path, title: c.title, heading: c.heading || undefined, text: c.text }))
  }
  if (scope.kind === 'note') await reindexPath(scope.path)
  // Sources filed under this notebook's or note's name in the Library come with it: a project's
  // design docs, the articles filed under a company you're preparing for
  const filed = new Set(await filedUnder(scopeName(scope)).catch(() => [] as string[]))
  const within = (p: string) => inScope(scope)(p) || filed.has(p)

  let chunks: Chunk[]
  const whole = scope.kind === 'note' ? getChunks(scope.path) : []
  const wholeSize = whole.reduce((n, c) => n + c.text.length, 0)

  if (scope.kind === 'note' && wholeSize <= CONTEXT_BUDGET * (filed.size ? 0.65 : 1)) {
    // Small enough to give the model the full note, with the best of what's filed under it
    chunks = [...whole, ...(filed.size ? search(query, 8, (p) => filed.has(p)).slice(0, 4) : [])]
  } else {
    const hits = search(query, 24, scope.kind === 'note' ? (p) => p === scope.path || filed.has(p) : within)
    chunks = hits
    if (chunks.length < 3) {
      // Generic questions ("summarize this") match few terms, fall back to reading order
      const paths = scope.kind === 'note' ? [scope.path, ...filed] : allChunkPaths().filter(within)
      const extra = paths.flatMap((p) => getChunks(p).slice(0, scope.kind === 'note' ? 50 : 2))
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
  target?: CloudTarget | null
): AsyncGenerator<string> {
  // A cloud model doesn't occupy the Mac, so it skips the local model's queue
  if (target) {
    yield* streamCloud(target, messages, signal, maxTokens, temperatureOverride, task)
    return
  }
  if (!background) {
    yield* streamInteractive(() => streamCompletion(messages, signal, maxTokens, true, temperatureOverride, task))
    return
  }
  const temperature = temperatureOverride ?? getSettings().ai.temperature
  const model = await resolveModel()
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
      yield delta
    }
  } finally {
    recordUsage({ kind: 'local', provider: 'local', model, task, input: estimateTokens(JSON.stringify(messages).length), output: estimateTokens(out), estimated: true })
  }
}

/** The text deltas of an OpenAI-style stream; `usage` gets the token counts if the server sends them */
async function* readStream(body: ReadableStream<Uint8Array>, filter: (t: string) => string, usage?: (u: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }) => void): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const u = json.usage ?? json.x_groq?.usage
        if (u && usage) usage(u)
        const delta = filter(json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '')
        if (delta) yield delta
      } catch {
        // Ignore keep-alive or partial lines
      }
    }
  }
}

/** A cloud model's answer, streamed; its real token counts go to the usage log */
async function* streamCloud(target: CloudTarget, messages: ChatMessage[], signal: AbortSignal, maxTokens: number, temperatureOverride: number | undefined, task: RequestKind): AsyncGenerator<string> {
  if (!canTake(estimateTokens(JSON.stringify(messages).length) + maxTokens, target.provider)) throw new CloudUnavailable(`The cloud model’s per-minute limit can’t take this for about ${secondsUntilReset(target.provider)}s`)
  let res: Response
  // A deadline per job: a model that's too slow today hands over to the next one in line
  const slow = AbortSignal.timeout(deadlineFor(task))
  const both = AbortSignal.any([signal, slow])
  noteSent(target.provider)
  try {
    res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify({ model: target.model, messages, temperature: temperatureOverride ?? getSettings().ai.temperature, stream: true, max_tokens: maxTokens, stream_options: { include_usage: true }, ...target.extra }),
      signal: both
    })
  } catch (e) {
    if (signal.aborted) throw e
    coolTarget(target, slow.aborted ? 120 : 60)
    throw new CloudUnavailable(slow.aborted ? `${target.model} took too long` : `Couldn't reach the cloud model: ${(e as Error).message}`)
  }
  if (!res.ok || !res.body) throw await cloudError(res, target)
  noteLimits(res.headers, target.provider)
  let reported: { input: number; output: number; cached?: number } | null = null
  let out = 0
  try {
    for await (const delta of readStream(res.body, createStreamFilter(), (u) => (reported = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens }))) {
      out += delta.length
      yield delta
    }
  } finally {
    const r = reported as { input: number; output: number; cached?: number } | null
    recordUsage({ kind: 'cloud', provider: target.provider, model: target.model, task, ...(r ?? { input: estimateTokens(JSON.stringify(messages).length), output: estimateTokens(out) }), estimated: !r })
  }
}

/**
 * Streams from the cloud model when this job escalates, and from Gemma otherwise. If a cloud
 * model can't take it (rate limited, down, key refused) before writing anything, the next
 * provider you have a key for tries, then Gemma.
 */
export async function* streamRouted(messages: ChatMessage[], signal: AbortSignal, maxTokens: number, task: RequestKind, temperatureOverride?: number): AsyncGenerator<string> {
  for (let tries = 0; tries < 3; tries++) {
    // A provider that just refused is cooling down, so this picks the next one in line
    const target = routeFor(isCloudTask(task) ? task : null)
    if (!target) break
    let wrote = false
    try {
      for await (const t of streamCompletion(messages, signal, maxTokens, false, temperatureOverride, task, target)) {
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

  // Titles and compaction happen after the answer, in the background
  void (async () => {
    if (!saved.title && saved.messages.length >= 2) {
      const title = await complete(
        `Conversation start:\nStudent: ${question.slice(0, 600)}\nTutor: ${reply.content.slice(0, 600)}\n\nGive this conversation a short title, 2 to 6 words, like a note title. Reply with the title only.`,
        'You name conversations. Reply with a short title only, no quotes or punctuation at the end.',
        undefined,
        'background'
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
          return complete(prompt, system, controller.signal, 'background')
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

async function answer(req: TurnRequest, emit: (e: ChatEvent) => void) {
  const controller = new AbortController()
  running.set(req.id, controller)
  // Everything goes through the tool harness when it's on, so threads can run code and check maths too
  if (getSettings().ai.agent !== false) {
    try {
      const { agentChat } = await import('./agent')
      // In a lesson, a reply is checked before the student works on it (a repeated or missing
      // question, a check that fails, a flawed problem, a mark that's too generous) and written
      // again once if anything's wrong: see lessonGuard
      let reply = ''
      await agentChat(req, (e) => (e.type === 'delta' && (reply += e.text), emit(e)), controller.signal)
      if (req.session && !controller.signal.aborted) {
        const { checkLessonReply, fixNudge } = await import('./lessonGuard')
        const ask = (prompt: string, system: string, task: RequestKind, signal: AbortSignal) => complete(prompt, system, signal, 'interactive', task)
        const problems = await checkLessonReply(req, reply, emit, controller.signal, ask).catch(() => [] as string[])
        if (problems.length && !controller.signal.aborted) {
          emit({ id: req.id, type: 'reset' })
          const messages = [...req.messages]
          const last = messages[messages.length - 1]
          if (last?.role === 'user' && typeof last.content === 'string') messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${fixNudge(problems)}` }
          let again = ''
          await agentChat({ ...req, messages }, (e) => (e.type === 'delta' && (again += e.text), emit(e)), controller.signal)
          // The rewrite isn't sent back again, but it still gets its solution for marking
          if (!controller.signal.aborted) await checkLessonReply(req, again, emit, controller.signal, ask, true).catch(() => [])
        }
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
export async function complete(prompt: string, system?: string, signal?: AbortSignal, priority: 'interactive' | 'background' = 'interactive', task: RequestKind = priority === 'background' ? 'background' : 'other'): Promise<string> {
  if (priority === 'background') return inBackground((s) => completeNow(prompt, system, s, true, task), signal)
  return completeNow(prompt, system, signal, false, task)
}

async function completeNow(prompt: string, system: string | undefined, signal: AbortSignal | undefined, background: boolean, task: RequestKind = 'other'): Promise<string> {
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
      const stream = background ? streamCompletion(messages, pass.signal, 3000, true, temperature, task) : streamRouted(messages, pass.signal, 3000, task, temperature)
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

const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '')

/**
 * Models often write LaTeX inside JSON strings without escaping it ("\\frac" as "\frac"), which
 * is either invalid JSON or, worse, silently turns \theta into a tab. Double any lone backslash
 * that starts a command name (two or more letters) so it survives JSON.parse.
 */
export const escapeLatexInJson = (json: string) => json.replace(/(?<!\\)((?:\\\\)*)\\(?=[a-zA-Z]{2,})/g, '$1\\\\')

/** Pulls the first JSON array out of a model reply that may include prose or code fences. */
export function extractJsonArray<T>(text: string): T[] {
  const cleaned = text.replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('The AI did not return a list. Try again.')
  const raw = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(escapeLatexInJson(raw)) as T[]
  } catch {
    // Fall back to the text as written, in case the repair itself was wrong
    try {
      return JSON.parse(raw) as T[]
    } catch {
      throw new Error('The AI answer was not in the expected format. Try again.')
    }
  }
}

/** Pulls the first JSON object out of a model reply, repairing unescaped LaTeX like extractJsonArray */
export function extractJsonObject<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI answer was not in the expected format. Try again.')
  const raw = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(escapeLatexInJson(raw)) as T
  } catch {
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error('The AI answer was not in the expected format. Try again.')
    }
  }
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
  const cards = extractJsonArray<{ front: string; back: string }>(await complete(prompt))
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
  if (style === 'coach' && !force) return coachNote(passage, context, mode)
  if (force) {
    // The student asked to be tested: always ask something, never explain
    const out = await complete(`A student is writing notes to learn something deeply and asked you to test their thinking on the passage below.
${mode ? `${mode}\n` : ''}
Ask ONE short, pointed question (max 2 sentences) that tests whether they really understand it: why it works, what happens in an edge case, how it connects to something else, or to apply it to a new example. If the passage contains a mistake, ask a question that leads them to find it. Don't explain, don't answer it yourself.
Return ONLY the question.

<note>
${context}
</note>

<passage>
${passage}
</passage>`)
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
  const out = await complete(prompt, undefined, undefined, 'background')
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
async function coachNote(passage: string, context: string, mode: string): Promise<ReadAlongNote | null> {
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
  // Feedback while writing waits for the model to be free: your chat and lessons come first
  const out = await complete(prompt, undefined, undefined, 'background')
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
  const ask = complete(
    `A learner is starting a lesson on: ${topic}${context ? ` (${context})` : ''}.\nWhich way of teaching fits it best?\n${letters}\nReply with the letter only.`,
    'You choose how to teach a topic. Reply with one letter.'
  ).then((out) => options[(out.trim().toUpperCase().charCodeAt(0) || 65) - 65] ?? options[0])
  const timeout = new Promise<Strategy>((resolve) => setTimeout(() => resolve(options[0]), 5000))
  return Promise.race([ask, timeout]).catch(() => options[0])
}
