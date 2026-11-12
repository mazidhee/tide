/**
 * Gemma's workarounds, switched by who teaches the turn. Tide was built around a 12B model on this
 * Mac and grew guards for its failure modes: a short context, a prefix cache that only matches a
 * prompt word for word, rules it drops when they sit far back in the prompt. Claude (the user's own
 * `claude -p`, main/claudeEngine) has none of those limits, and on its turns some of the guards only
 * add latency, tokens or odd behaviour. Each one is a switch here, keyed on the engine, so it is easy
 * to see what Claude skips and to turn one back on.
 *
 * Already off on Claude before this table, because Claude's turns return before they run (main/ai
 * answer): the stall pick-ups and loop retries (main/agent streamTurnContinuing, streamTurnRetrying),
 * the lesson checks and re-asks (main/lessonGuard), reply repair (shared/lessonRepair repairReply),
 * the problem bank, hidden tests written after the fact, the SQL problem rewrite, the forced first
 * tool call, the read-back and warm-ups that keep Gemma's cache, and transient context.
 *
 * Kept on both on purpose: privacy routing, "a request is not an answer" (shared/lessonRepair
 * notAnAttempt, nothingToMark), the reading's quote check (main/sourceLed), the Show me give-away
 * check (shared/showMe), the exact answer check (SymPy, SQL) and the pace notes, which are teaching
 * policy rather than model repair.
 */
import { MARK_NOTE } from './pace'

export type Engine = 'claude' | 'gemma'

export const WORKAROUNDS = {
  /**
   * A lesson's history cut to 35% of Gemma's 16K context, in steps (shared/context fitHistory).
   * On Claude the cut also made its process start again from a shortened transcript each time the
   * cut moved: the prompt cache was lost, and Claude said it couldn't see the earlier steps.
   */
  trimHistory: { gemma: true, claude: false },
  /** A stored conversation folded into a running summary after a reply: one more model call, and a new start to the conversation each time */
  compactChats: { gemma: true, claude: false },
  /** The marking rule said again with every answer, because a 12B model drops it when it sits only in the format rules (shared/pace MARK_NOTE) */
  markNoteEachAnswer: { gemma: true, claude: false },
  /** A lesson's prompt without the simulation guide (some 400 words), only the kinds its topic can use, to keep Gemma's prompt short */
  lessonSimSubset: { gemma: true, claude: false },
  /** A lesson's opening passages: four, at 1,000 characters each */
  clipPassages: { gemma: true, claude: false }
} as const satisfies Record<string, Record<Engine, boolean>>

export type Workaround = keyof typeof WORKAROUNDS

/** Whether this engine's turns use this workaround */
export const uses = (w: Workaround, engine: Engine): boolean => WORKAROUNDS[w][engine]

/** What Claude keeps of a lesson or conversation instead (tokens): the whole of it, short of its context */
export const CLAUDE_HISTORY_TOKENS = 120_000

/** A lesson's opening passages on Claude, when they aren't clipped: how many and how long */
export const CLAUDE_PASSAGES = { count: 6, chars: 2400 }

/**
 * New on Claude: a turn with no sign of life (no words, no thinking, no tool call) this long after
 * it was sent is taken as hung; the process is stopped and Gemma takes the turn, as it does when
 * Claude fails.
 */
export const FIRST_WORDS_MS = 45_000

/** A message without the marking note, for an engine that doesn't need it said again */
export const withoutMarkNote = (content: string) => (content.includes(MARK_NOTE) ? content.replace(`\n${MARK_NOTE}`, '').replace(MARK_NOTE, '').trimEnd() : content)
