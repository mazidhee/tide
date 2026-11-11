/**
 * Asking the model server for one completion, streamed and read as the app reads it
 * (shared/modelText's turnReader), so a reply stuck in a thought channel or repeating itself is cut
 * off where the app would cut it instead of running on to the token limit. (In the first baseline
 * a quarter of the replies ran to the limit that way: most of that run's 38 minutes.)
 */
import { turnReader } from '../../../src/shared/modelText'
import type { Message } from './request'

export interface ModelCall {
  base: string
  key: string
  model: string
  messages: Message[]
  /** Sampling and server fields: temperature, seed, max_tokens, adapter_path, repetition_penalty */
  extra: Record<string, unknown>
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The raw text of one completion, up to where the app would stop reading it */
export async function complete(c: ModelCall, fetcher: Fetch = fetch): Promise<string> {
  const local = /localhost|127\.0\.0\.1/.test(c.base)
  const controller = new AbortController()
  const res = await fetcher(`${c.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
    // Gemma 4 on a local server: block its empty "thinking" token, as Tide does (src/main/sampling.ts)
    body: JSON.stringify({ model: c.model, messages: c.messages, stream: true, ...c.extra, ...(/gemma[-_ ]?4/i.test(c.model) && local ? { logit_bias: { '100': -100 } } : {}) }),
    signal: controller.signal
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
  // A server that answers in one piece anyway
  if (!res.body || /application\/json/i.test(res.headers.get('content-type') ?? '')) {
    const j = (await res.json()) as { choices: { message: { content: string } }[] }
    return j.choices[0]?.message?.content ?? ''
  }
  const read = turnReader()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '')
      if (!data || data === '[DONE]' || !line.trim().startsWith('data:')) continue
      let content = ''
      try {
        content = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? ''
      } catch {
        continue
      }
      if (content && read.push(content).stop) {
        controller.abort()
        await reader.cancel().catch(() => undefined)
        return read.raw
      }
    }
  }
  return read.raw
}

/** The model to ask when none is named: the server's Gemma, else its first */
export async function firstModel(base: string, key: string): Promise<string> {
  const j = (await (await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} })).json()) as { data: { id: string }[] }
  return j.data.find((m) => /gemma/i.test(m.id))?.id ?? j.data[0].id
}
