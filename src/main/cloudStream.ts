import { createStreamFilter } from '@shared/modelText'
import { PROVIDERS, type RequestKind } from '@shared/providers'
import type { ChatMessage } from '@shared/types'
import { canTake, CloudUnavailable, cloudError, coolTarget, deadlineFor, estimateTokens, headersFor, noteLimits, noteOutcome, noteSent, noteWhy, recordUsage, secondsUntilReset, stopCode, type CloudTarget, type FailCode } from './cloud'
import { getSettings } from './settings'

type StreamUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }

/** The text deltas of an OpenAI-style stream; `usage` gets the token counts if the server sends them, `finish` why it stopped */
export async function* readStream(body: ReadableStream<Uint8Array>, filter: (t: string) => string, usage?: (u: StreamUsage) => void, finish?: (reason: string) => void): AsyncGenerator<string> {
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
        const why = json.choices?.[0]?.finish_reason
        if (why && finish) finish(why)
        const delta = filter(json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '')
        if (delta) yield delta
      } catch {
        // Ignore keep-alive or partial lines
      }
    }
  }
}

/** The shape a reply must have: a name and a JSON Schema, as OpenAI-style structured outputs take them */
export interface ReplySchema {
  name: string
  schema: Record<string, unknown>
}

// Models that turned a schema down once (a 400): asked without one from then on
const refusedSchema = new Set<string>()

/**
 * The request field that constrains a reply to `schema`, for a provider that documents it (its
 * `jsonSchema` flag); nothing for any other, custom providers included. Never used for the local
 * server: mlx-vlm refuses response_format while the draft model is on.
 */
export function responseFormat(target: Pick<CloudTarget, 'provider' | 'model'>, schema?: ReplySchema): { response_format?: unknown } {
  if (!schema || refusedSchema.has(`${target.provider}/${target.model}`)) return {}
  if (!PROVIDERS.find((p) => p.id === target.provider)?.jsonSchema) return {}
  return { response_format: { type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema } } }
}

/** How long a cloud model has to show any sign of life (its response headers) before the next is tried */
export const FIRST_SIGN_MS = 25_000

/**
 * A cloud model's answer, streamed; its real token counts go to the usage log, and how the request
 * ended goes to the model's record (cloud.ts noteOutcome), with the reason when it gave no answer:
 *
 * - Answered means it wrote something you can read. A stream that ends with nothing in it (a
 *   reasoning model that spent all of max_tokens thinking, most often) used to count as answered,
 *   and the caller got an empty string; now it counts against the model and the next one is asked.
 * - A deadline that passes while the answer is arriving counts against the model too (it used to
 *   leave no trace), and the next one is asked.
 * - Being stopped by you, or by a caller that only waits so long, is written down but is not a
 *   request the model failed.
 */
export async function* streamCloud(target: CloudTarget, messages: ChatMessage[], signal: AbortSignal, maxTokens: number, temperatureOverride: number | undefined, task: RequestKind, schema?: ReplySchema): AsyncGenerator<string> {
  if (!canTake(estimateTokens(JSON.stringify(messages).length) + maxTokens, target)) {
    noteWhy(target, task, 'minute')
    throw new CloudUnavailable(`The cloud model’s per-minute limit can’t take this for about ${secondsUntilReset(target)}s`, 'minute')
  }
  let res: Response
  // A deadline per job: a model that's too slow today hands over to the next one in line
  const started = Date.now()
  const took = () => Date.now() - started
  const slow = AbortSignal.timeout(deadlineFor(task))
  // And a much shorter one for any sign of life. Some free endpoints accept a request and then
  // send nothing at all for minutes: without this, each one cost the whole deadline before the
  // next model was tried. A model that is thinking has still answered with its headers by now.
  const silent = new AbortController()
  const noSign = setTimeout(() => silent.abort(), FIRST_SIGN_MS)
  const both = AbortSignal.any([signal, slow, silent.signal])
  const format = responseFormat(target, schema)
  noteSent(target.provider)
  try {
    res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify({ model: target.model, messages, temperature: temperatureOverride ?? getSettings().ai.temperature, stream: true, max_tokens: maxTokens, stream_options: { include_usage: true }, ...target.extra, ...format }),
      signal: both
    })
  } catch (e) {
    if (signal.aborted) {
      noteWhy(target, task, stopCode(signal), took())
      throw e
    }
    const why: FailCode = silent.signal.aborted ? 'silent' : slow.aborted ? 'slow' : 'network'
    // An endpoint that said nothing is left alone for ten minutes: it is down, not busy
    coolTarget(target, why === 'silent' ? 600 : why === 'slow' ? 120 : 60)
    noteOutcome(target, task, false, took(), why)
    throw new CloudUnavailable(why === 'silent' ? `${target.model} didn’t start answering` : why === 'slow' ? `${target.model} took too long` : `Couldn't reach the cloud model: ${(e as Error).message}`, why)
  } finally {
    clearTimeout(noSign)
  }
  // A model behind a provider that supports schemas may still not take one: ask again without
  if (res.status === 400 && format.response_format) {
    await res.body?.cancel().catch(() => {})
    refusedSchema.add(`${target.provider}/${target.model}`)
    yield* streamCloud(target, messages, signal, maxTokens, temperatureOverride, task)
    return
  }
  if (!res.ok || !res.body) {
    const refused = await cloudError(res, target)
    noteOutcome(target, task, false, took(), refused.why)
    throw refused
  }
  noteLimits(res.headers, target)
  let reported: { input: number; output: number; cached?: number; reasoning?: number } | null = null
  let out = 0
  let said = false
  let stopped = ''
  let firstAt = 0
  try {
    const usage = (u: StreamUsage) => (reported = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens })
    for await (const delta of readStream(res.body, createStreamFilter(), usage, (why) => (stopped = why))) {
      out += delta.length
      firstAt ||= Date.now()
      said ||= !!delta.trim()
      yield delta
    }
  } catch (e) {
    if (signal.aborted) {
      noteWhy(target, task, stopCode(signal), took())
      throw e
    }
    const why: FailCode = slow.aborted ? 'midstream' : 'broken'
    coolTarget(target, slow.aborted ? 120 : 60)
    noteOutcome(target, task, false, took(), why)
    throw new CloudUnavailable(slow.aborted ? `${target.model} took too long` : `The cloud model’s answer broke off: ${(e as Error).message}`, why)
  } finally {
    const r = reported as { input: number; output: number; cached?: number; reasoning?: number } | null
    recordUsage({ kind: 'cloud', provider: target.provider, model: target.model, task, ...(r ?? { input: estimateTokens(JSON.stringify(messages).length), output: estimateTokens(out) }), estimated: !r, ...(stopped === 'length' ? { cut: true } : {}), ms: took(), ...(firstAt ? { ttftMs: firstAt - started } : {}) })
  }
  const cut = stopped === 'length'
  if (!said) {
    // Nothing to read: all thinking and no answer, or nothing at all
    const why: FailCode = cut ? 'spent' : 'empty'
    noteOutcome(target, task, false, took(), why)
    throw new CloudUnavailable(cut ? `${target.model} used all ${maxTokens} tokens before it answered` : `${target.model} sent back nothing`, why)
  }
  noteOutcome(target, task, true, took(), cut ? 'cut' : undefined)
}
