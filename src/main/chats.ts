import { existsSync, promises as fs } from 'fs'
import type { Chat, ChatMessage, ChatScope, ChatSummary, StoredMessage } from '@shared/types'
import { compactionCut, estimateTokens, fitHistory } from '@shared/context'
import { absPath, joinRel, writeText } from './vault'
import { getSettings } from './settings'

/**
 * Stored conversations, one JSON file each in .tide/chats. The main process writes them as the
 * tutor answers, so a reload or crash never loses a conversation. Long conversations are compacted:
 * older turns are folded into a running summary, and only the summary plus recent turns go to the
 * model, which keeps every request small and fast on a local model.
 */

const DIR = joinRel('.tide', 'chats')
const fileOf = (id: string) => joinRel(DIR, `${id.replace(/[^\w-]/g, '')}.json`)

/** Messages kept word for word after a compaction */
const KEEP_RECENT = 4

const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn)
  queues.set(
    key,
    run.catch(() => {}).finally(() => {
      if (queues.get(key) === run) queues.delete(key)
    })
  )
  return run
}

/** Context size the user's model runs with, and the share of it a conversation's history may use */
export function historyBudget(): number {
  const context = getSettings().ai.contextTokens ?? 16_384
  return Math.max(1500, Math.floor(context * 0.35))
}

export async function getChat(id: string): Promise<Chat | null> {
  try {
    const raw = JSON.parse(await fs.readFile(absPath(fileOf(id)), 'utf8')) as Chat
    return { ...raw, messages: raw.messages ?? [], summarizedUpTo: raw.summarizedUpTo ?? 0 }
  } catch {
    return null
  }
}

const write = (chat: Chat) => writeText(fileOf(chat.id), JSON.stringify(chat))

/** Reads, changes and writes a conversation, one change at a time per conversation */
export function updateChat(id: string, fn: (chat: Chat | null) => Chat | null): Promise<Chat | null> {
  return serial(id, async () => {
    const next = fn(await getChat(id))
    if (next) await write(next)
    return next
  })
}

export function newChat(id: string, scope: ChatScope): Chat {
  const now = Date.now()
  return { id, title: '', createdAt: now, updatedAt: now, scope, messages: [], summarizedUpTo: 0 }
}

const listCache = new Map<string, { mtime: number; summary: ChatSummary }>()

export async function listChats(): Promise<ChatSummary[]> {
  const dir = absPath(DIR)
  if (!existsSync(dir)) return []
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'))
  const out: ChatSummary[] = []
  for (const name of names) {
    const full = `${dir}/${name}`
    try {
      const { mtimeMs } = await fs.stat(full)
      const hit = listCache.get(name)
      if (hit && hit.mtime === mtimeMs) {
        out.push(hit.summary)
        continue
      }
      const c = JSON.parse(await fs.readFile(full, 'utf8')) as Chat
      if (!c.messages?.length) continue
      const firstUser = c.messages.find((m) => m.role === 'user')?.content ?? ''
      const lastAnswer = [...c.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? ''
      const summary: ChatSummary = {
        id: c.id,
        title: c.title || fallbackTitle(firstUser),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        scope: c.scope,
        pinned: c.pinned,
        count: c.messages.length,
        preview: lastAnswer.replace(/[#*_`>[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
      }
      listCache.set(name, { mtime: mtimeMs, summary })
      out.push(summary)
    } catch {
      // a half-written or foreign file: skip it
    }
  }
  return out.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
}

export const renameChat = (id: string, title: string) => updateChat(id, (c) => (c ? { ...c, title: title.replace(/\s+/g, ' ').trim().slice(0, 80) } : c))
export const pinChat = (id: string, pinned: boolean) => updateChat(id, (c) => (c ? { ...c, pinned } : c))

export function deleteChat(id: string) {
  return serial(id, async () => {
    await fs.rm(absPath(fileOf(id)), { force: true })
  })
}

export const fallbackTitle = (text: string) => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ')
  return words.length > 60 ? words.slice(0, 57) + '…' : words || 'New conversation'
}

const asApi = (m: StoredMessage): ChatMessage => ({ role: m.role, content: m.attachment ? `${m.content}\n\n"""${m.attachment}"""` : m.content })

/** What the model sees of a conversation: its summary, then recent turns within the budget */
export function historyFor(chat: Chat): { summary?: string; messages: ChatMessage[] } {
  const recent = chat.messages
    .slice(chat.summarizedUpTo)
    .filter((m) => !m.error && (m.role === 'user' || m.content.trim()))
    .map(asApi)
  return { summary: chat.summary, messages: fitHistory(recent, historyBudget()) }
}

/** True when the unsummarized part of a conversation is close to its budget */
export function needsCompaction(chat: Chat): boolean {
  const tokens = chat.messages.slice(chat.summarizedUpTo).reduce((n, m) => n + estimateTokens(m.content + (m.attachment ?? '')), 0)
  return tokens > historyBudget() * 0.7 && compactionCut(chat.messages.length, chat.summarizedUpTo, KEEP_RECENT) !== null
}

const COMPACT_SYSTEM = `You keep notes on a tutoring conversation so it can continue later without the full transcript. Write a compact summary in plain sentences (at most 250 words), no greeting, no headings:
- what the student asked about and was taught, with the key facts, formulas or code that matter later
- what they understood, and what they got wrong or still find hard
- anything they asked to do next, and decisions made
Fold the earlier summary in; don't lose facts from it.`

/**
 * Folds older turns into the running summary, keeping the last few word for word. Runs after a
 * reply has finished, so it never delays an answer. `summarize` is the model call.
 */
/**
 * A message as the summary needs it: code, diagrams and the app's tags shrunk to a word, so the
 * model reads what was said rather than every line of it
 */
export const forSummary = (text: string) =>
  text
    .replace(/```mermaid[\s\S]*?```/g, '[a diagram]')
    .replace(/```sim[\s\S]*?```/g, '[a live simulation]')
    .replace(/```(\w*)[\s\S]*?```/g, (_, lang: string) => `[${lang || 'code'} block]`)
    .replace(/<(say|note|card|plan|summary)>[\s\S]*?<\/\1>/g, '')
    .replace(/<ask[^>]*>([\s\S]*?)<\/ask>/g, 'Question: $1')
    .replace(/<grade[^>]*>([\s\S]*?)<\/grade>/g, 'Feedback: $1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[an image]')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2500)

export async function compactChat(id: string, summarize: (system: string, prompt: string) => Promise<string>): Promise<boolean> {
  const chat = await getChat(id)
  if (!chat || !needsCompaction(chat)) return false
  const cut = compactionCut(chat.messages.length, chat.summarizedUpTo, KEEP_RECENT)
  if (cut === null) return false
  const span = chat.messages.slice(chat.summarizedUpTo, cut).filter((m) => !m.error)
  const transcript = span
    .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${forSummary(m.content)}${m.attachment ? `\n(about this passage: ${m.attachment.slice(0, 400)})` : ''}`)
    .join('\n\n')
  const prompt = `${chat.summary ? `Earlier summary:\n${chat.summary}\n\n` : ''}Conversation since then:\n\n${transcript}\n\nWrite the updated summary.`
  const summary = (await summarize(COMPACT_SYSTEM, prompt)).trim()
  if (summary.length < 40) return false
  await updateChat(id, (c) => (c && c.summarizedUpTo === chat.summarizedUpTo ? { ...c, summary: summary.slice(0, 4000), summarizedUpTo: cut } : c))
  return true
}
