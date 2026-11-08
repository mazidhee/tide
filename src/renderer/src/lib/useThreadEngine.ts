import { useCallback, useEffect, useRef, useState } from 'react'
import type { TutorThread } from '@shared/types'
import { PERSONAS, type PersonaId } from '@shared/personas'

const INLINE_INSTRUCTIONS = `You are answering inline, directly inside the student's note, right under the passage they asked about.
Keep it short (under 150 words) unless they ask for more. Teach, don't lecture: use a concrete example where it helps.
When it fits, end with one quick question that checks their understanding.
If a picture would help (a recursion tree, the state of an array step by step, a graph, a flow), draw it: use a mermaid code block for trees, graphs and flows, or a small Markdown table for step-by-step traces.`

const QUIZ_INSTRUCTIONS = `Quiz the student on this passage, one question at a time. Ask a single question and wait.
When they answer, say if it's right, explain briefly, then ask the next, slightly harder question.`

export interface AskOptions {
  quiz?: boolean
  persona?: PersonaId
  /** Several reviewers answer at once, each under its own heading */
  panel?: PersonaId[]
}

/**
 * Streams tutor answers into margin and inline threads. Shared by reading mode (threads under
 * paragraphs) and edit mode (threads in the margin), so a conversation can move between them.
 */
export function useThreadEngine(path: string, instructions: string, defaultPersona: PersonaId, setThreads: (u: (t: TutorThread[]) => TutorThread[]) => void) {
  const [streaming, setStreaming] = useState<Set<string>>(new Set())
  const quizThreads = useRef(new Set<string>())

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (!e.id.includes(':inline')) return
        const threadId = e.id.split(':')[0]
        if (e.type === 'reset') {
          const threadId0 = e.id.split(':')[0]
          setThreads((list) => list.map((t) => (t.id !== threadId0 ? t : { ...t, messages: t.messages.map((m, i) => (i === t.messages.length - 1 ? { ...m, content: '' } : m)) })))
          return
        }
        if (e.type === 'delta' || e.type === 'error') {
          setThreads((list) =>
            list.map((t) => {
              if (t.id !== threadId) return t
              const msgs = [...t.messages]
              const last = msgs[msgs.length - 1]
              msgs[msgs.length - 1] = e.type === 'delta' ? { ...last, content: last.content + e.text } : { role: 'assistant', content: `_${e.message}_` }
              return { ...t, messages: msgs }
            })
          )
        }
        if (e.type === 'done' || e.type === 'error') {
          setStreaming((s) => {
            const n = new Set(s)
            n.delete(threadId)
            return n
          })
        }
      }),
    [setThreads]
  )

  const ask = useCallback(
    async (thread: TutorThread, text: string, opts: AskOptions = {}) => {
      if (opts.quiz) quizThreads.current.add(thread.id)
      const messages = [...thread.messages, { role: 'user' as const, content: text }]
      setThreads((list) => list.map((t) => (t.id === thread.id ? { ...t, messages: [...messages, { role: 'assistant', content: '' }] } : t)))
      setStreaming((s) => new Set(s).add(thread.id))
      const persona = PERSONAS[opts.persona ?? defaultPersona]
      const panel = opts.panel?.length
        ? `Answer as a panel of reviewers. For each, write a short heading with their name in bold, then 2 or 3 sharp bullet points from their point of view:\n${opts.panel.map((p) => `- ${PERSONAS[p].name}: ${PERSONAS[p].voice}`).join('\n')}`
        : `Your voice: ${persona.voice}`
      await window.tide.ai.chat({
        id: `${thread.id}:inline:${Date.now()}`,
        messages,
        scope: { kind: 'note', path },
        attachment: thread.quote,
        web: false,
        instructions: [INLINE_INSTRUCTIONS, panel, quizThreads.current.has(thread.id) ? QUIZ_INSTRUCTIONS : '', instructions].filter(Boolean).join('\n\n')
      })
    },
    [path, instructions, defaultPersona, setThreads]
  )

  return { ask, streaming }
}
