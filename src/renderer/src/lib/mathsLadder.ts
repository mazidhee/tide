/**
 * "Teach me maths from the ground up", said anywhere you can type to Tide: What you know opens on
 * the maths ladder, which starts the lesson on the next topic of the lowest rung not yet strong
 * (components/know/KnowLadder). Done here once so Home and both chats agree.
 */
import { groundUpIntent } from '@shared/mathsLadder'
import type { View } from '../state'

export function climbLadder(text: string, setView: (v: View) => void): boolean {
  if (!groundUpIntent(text)) return false
  try {
    localStorage.setItem('tide.know.view', 'ladder')
    localStorage.setItem('tide.ladder.go', 'true')
  } catch {
    // The ladder still opens; the lesson is one click from it
  }
  setView({ kind: 'graph', tab: 'know' })
  return true
}
