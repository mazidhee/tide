import { existsSync, promises as fs } from 'fs'
import type { Memory } from '@shared/types'
import { absPath, joinRel, writeText } from './vault'

/**
 * What the tutor remembers about the learner across conversations: goals, background, what they
 * find hard, how they like to learn. Short sentences, saved by the tutor's `remember` tool or by
 * hand, and given to every conversation. Kept small on purpose so it never crowds the context.
 */

const FILE = joinRel('.tide', 'memory.json')
const MAX_ITEMS = 80
const MAX_PROMPT_CHARS = 1800
const MAX_TEXT = 240

let queue: Promise<unknown> = Promise.resolve()

async function load(): Promise<Memory[]> {
  try {
    return existsSync(absPath(FILE)) ? JSON.parse(await fs.readFile(absPath(FILE), 'utf8')) : []
  } catch {
    return []
  }
}

function change(fn: (list: Memory[]) => Memory[]): Promise<Memory[]> {
  const run = queue.then(async () => {
    const next = fn(await load()).slice(-MAX_ITEMS)
    await writeText(FILE, JSON.stringify(next, null, 1))
    return next
  })
  queue = run.catch(() => {})
  return run
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
const id = () => Math.random().toString(36).slice(2, 10)

export const listMemories = () => load()

/** Adds a memory unless the same thing is already there; returns what was stored */
export async function addMemory(text: string, chatId?: string): Promise<{ memory: Memory; duplicate: boolean }> {
  const clean = tidy(text)
  if (!clean) throw new Error('Nothing to remember.')
  let result: { memory: Memory; duplicate: boolean } | null = null
  await change((list) => {
    const same = list.find((m) => norm(m.text) === norm(clean) || norm(m.text).includes(norm(clean)))
    if (same) {
      result = { memory: same, duplicate: true }
      return list
    }
    const memory: Memory = { id: id(), text: clean, createdAt: Date.now(), updatedAt: Date.now(), chatId }
    result = { memory, duplicate: false }
    return [...list, memory]
  })
  return result!
}

export async function updateMemory(memoryId: string, text: string) {
  const clean = tidy(text)
  await change((list) => (clean ? list.map((m) => (m.id === memoryId ? { ...m, text: clean, updatedAt: Date.now() } : m)) : list.filter((m) => m.id !== memoryId)))
}

export async function removeMemory(memoryId: string) {
  await change((list) => list.filter((m) => m.id !== memoryId))
}

/** Forgets the memory that best matches a description; returns what was removed */
export async function forgetMatching(description: string): Promise<Memory | null> {
  const words = norm(description).split(' ').filter((w) => w.length > 2)
  if (!words.length) return null
  let removed: Memory | null = null
  await change((list) => {
    const scored = list
      .map((m) => ({ m, score: words.filter((w) => norm(m.text).includes(w)).length / words.length }))
      .sort((a, b) => b.score - a.score)
    if (!scored.length || scored[0].score < 0.5) return list
    removed = scored[0].m
    return list.filter((m) => m.id !== removed!.id)
  })
  return removed
}

/** The memory block for a prompt, newest first, within a fixed size */
export async function memoryPrompt(): Promise<string> {
  const list = (await load()).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!list.length) return ''
  const lines: string[] = []
  let size = 0
  for (const m of list) {
    if (size + m.text.length > MAX_PROMPT_CHARS) break
    lines.push(`- ${m.text}`)
    size += m.text.length + 3
  }
  return `What you remember about the student from earlier conversations (use it quietly; don't recite it back):\n${lines.join('\n')}`
}
