import { lessonCanvasPath, openingMessage, sessionInstructions, withStrategy, type SessionSetup } from '@shared/session'
import type { ChatRequest, ChatScope } from '@shared/types'

/**
 * The first request a lesson sends, exactly. Learn sends the same one ahead of time so the model
 * has already read it (cached) when you press start; any difference would make that wasted work.
 */
export function openingRequest(given: SessionSetup, scope: ChatScope, character: string): Omit<ChatRequest, 'id'> {
  const setup = withStrategy(given, scope)
  let talk = false
  let web = true
  try {
    talk = localStorage.getItem('tide.talk') === 'on'
    web = localStorage.getItem('tide.chat.web') !== 'off'
  } catch {
    // defaults
  }
  return {
    messages: [{ role: 'user', content: openingMessage(setup) }],
    scope,
    instructions: sessionInstructions(setup),
    // Every lesson has its canvas beside it: the tutor can read and draw on it from the first message
    ...(setup.mode === 'teach' ? { canvasPath: lessonCanvasPath(scope, setup.topic) } : {}),
    session: true,
    web,
    voice: talk ? (character as ChatRequest['voice']) : undefined,
    engine: 'auto'
  }
}
