/**
 * "Teach me maths from the ground up", said anywhere you can type to Tide: the maths ladder opens and starts the lesson on the next topic of the lowest rung not yet strong
 * (components/know/KnowLadder). Done here once so Home and both chats agree.
 */
import { groundUpIntent } from '@shared/mathsLadder'
import type { View } from '../state'

export function climbLadder(text: string, setView: (v: View) => void): boolean {
  if (!groundUpIntent(text)) return false
  setView({ kind: 'ladder', go: Date.now() })
  return true
}
