/**
 * Sharpness: the problem-solving methods, taught by name (Pólya's "How to Solve It", plus the
 * ones engineers lean on: draw it, check the edges, estimate first). Pure rules here.
 *
 * The hint policy: on a first attempt there are no hints at all. After a miss, "I'm stuck" gives a
 * method hint ("try a smaller case"), never a solution hint, until at least two method hints have
 * been given and the learner has tried again. Which methods the learner reaches for (they tick them
 * when they submit), which ones unlocked a retry, and which they never use are counted, and the
 * missing ones are trained: the stream leans on problems that need them.
 */

export type MethodId = 'understand' | 'simplify' | 'small-cases' | 'invariant' | 'backwards' | 'generalise' | 'analogy' | 'draw' | 'edges' | 'estimate'

export interface Method {
  id: MethodId
  name: string
  /** One line: what the method is */
  what: string
  /** The general nudge, as said when stuck (no problem-specific content) */
  nudge: string
  /** A question the learner asks themselves */
  ask: string
}

export const METHODS: Method[] = [
  { id: 'understand', name: 'Understand the problem', what: 'Restate it; name the unknown, the data and the condition.', nudge: 'Before solving, restate the problem in your own words. What exactly is unknown, what is given, and what must hold?', ask: 'What is the unknown? What is the condition?' },
  { id: 'simplify', name: 'Simplify', what: 'Drop a constraint or a dimension and solve the easier problem first.', nudge: 'Solve an easier version first: drop one constraint (or one dimension) and see what the simpler problem teaches you.', ask: 'What if one constraint weren’t there?' },
  { id: 'small-cases', name: 'Try small cases', what: 'Work n = 0, 1, 2, 3 by hand and look for the pattern.', nudge: 'Try a smaller case. Work it by hand for the tiniest inputs you can, then the next size up, and look for what repeats.', ask: 'What happens for n = 1, 2, 3?' },
  { id: 'invariant', name: 'Find the invariant', what: 'Something that never changes as the process runs.', nudge: 'Look for something that stays the same while everything else changes: a sum, a parity, an order, a balance.', ask: 'What stays true at every step?' },
  { id: 'backwards', name: 'Work backwards', what: 'Start from the goal and ask what must be true just before it.', nudge: 'Start from the end. Suppose you had the answer: what must have been true one step before?', ask: 'What would the last step look like?' },
  { id: 'generalise', name: 'Generalise', what: 'Solve a broader problem; the general case is sometimes easier.', nudge: 'Make it more general. A version with a parameter, or for all n, can be easier to attack than this one instance.', ask: 'Is this one case of something bigger?' },
  { id: 'analogy', name: 'Use a known problem', what: 'Find a problem you have solved with the same unknown or shape.', nudge: 'Do you know a related problem? Look at the unknown and think of a problem you have solved that had the same kind of unknown.', ask: 'Have I seen this shape before?' },
  { id: 'draw', name: 'Draw it', what: 'A picture, a table, a timeline or a graph of the state.', nudge: 'Draw it: a diagram, a table of states, a timeline, a graph. Put the structure where you can see it.', ask: 'What does the picture look like?' },
  { id: 'edges', name: 'Check the edge cases', what: 'Empty, one element, all equal, the extremes, failure paths.', nudge: 'Check the edges: empty, one element, all the same, the largest value, the failure path. Which one breaks your idea?', ask: 'Where does this break?' },
  { id: 'estimate', name: 'Estimate first', what: 'A rough number or bound before any exact work.', nudge: 'Estimate first. A rough number, a bound or an order of magnitude tells you what an answer has to look like.', ask: 'Roughly how big must the answer be?' }
]

export const method = (id: MethodId) => METHODS.find((m) => m.id === id)!
export const isMethod = (x: unknown): x is MethodId => typeof x === 'string' && METHODS.some((m) => m.id === x)

// ---------- The hint policy ----------

export type HintKind = 'method' | 'solution'

export interface HintState {
  /** The first, rated attempt has been submitted (or given up) */
  submitted: boolean
  /** Its outcome: hints only open after a miss */
  missed: boolean
  methodHints: number
  solutionHints: number
  /** Answers sent since the last hint (a retry) */
  retriesSinceHint: number
  /** Retries after the miss, in all */
  retries: number
}

export const freshHints = (): HintState => ({ submitted: false, missed: false, methodHints: 0, solutionHints: 0, retriesSinceHint: 0, retries: 0 })

/** Method hints a learner gets before any solution hint */
export const METHOD_HINTS_FIRST = 2

/**
 * The next hint "I'm stuck" may give, or why none: nothing on the first attempt, a method hint
 * first, and a solution hint only after METHOD_HINTS_FIRST method hints and at least one retry.
 */
export function nextHint(s: HintState, asked: HintKind = 'method'): { kind: HintKind } | { kind: null; why: string } {
  if (!s.submitted) return { kind: null, why: 'First attempt: no hints. Submit what you have, or give up, and the method hints open.' }
  if (!s.missed) return { kind: null, why: 'You got this one.' }
  if (asked === 'method' || s.methodHints < METHOD_HINTS_FIRST) return { kind: 'method' }
  if (s.retries < 1) return { kind: 'method' }
  return { kind: 'solution' }
}

export function afterHint(s: HintState, kind: HintKind): HintState {
  return { ...s, methodHints: s.methodHints + (kind === 'method' ? 1 : 0), solutionHints: s.solutionHints + (kind === 'solution' ? 1 : 0), retriesSinceHint: 0 }
}

export const afterRetry = (s: HintState): HintState => ({ ...s, retries: s.retries + 1, retriesSinceHint: s.retriesSinceHint + 1 })

/**
 * The method a hint should point to: the problem's own unlocks first (in the order given), skipping
 * ones already hinted; then the learner's least-used methods; then the general order.
 */
export function pickHintMethod(problemMethods: MethodId[], hinted: MethodId[], neverUsed: MethodId[] = []): MethodId {
  const order = [...problemMethods, ...neverUsed, ...METHODS.map((m) => m.id)]
  return order.find((m) => !hinted.includes(m)) ?? problemMethods[0] ?? 'small-cases'
}

/**
 * A method hint must stay a method hint: no code, no worked numbers from the solution, no naming
 * of the answer. A model-written hint that fails this is replaced by the method's plain nudge.
 */
export function methodHintLeaks(hint: string, secrets: { answer?: string | number; solution?: string; code?: string }): boolean {
  if (/```/.test(hint) || /^\s*(def|class|return|for|while|import)\b/m.test(hint)) return true
  const h = hint.toLowerCase()
  if (secrets.answer !== undefined && String(secrets.answer).trim()) {
    const a = String(secrets.answer).trim().toLowerCase()
    if (a.length >= 2 && new RegExp(`(^|[^\\w.])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.])`).test(h)) return true
  }
  // Distinctive lines of the reference code or the worked solution, copied in
  for (const src of [secrets.code, secrets.solution]) {
    if (!src) continue
    for (const line of src.split('\n')) {
      const l = line.trim().toLowerCase()
      if (l.length >= 24 && h.includes(l)) return true
    }
  }
  return false
}

// ---------- What the learner reaches for ----------

export interface MethodStats {
  /** Times ticked as tried, on submitting */
  reached: Partial<Record<MethodId, number>>
  /** Times hinted after a miss */
  hinted: Partial<Record<MethodId, number>>
  /** Times a hint of this method was followed by a solve on the retry */
  unlocked: Partial<Record<MethodId, number>>
  /** Times it was the problem's key method, in problems attempted */
  needed: Partial<Record<MethodId, number>>
}

export const freshMethodStats = (): MethodStats => ({ reached: {}, hinted: {}, unlocked: {}, needed: {} })

const bump = (r: Partial<Record<MethodId, number>>, ids: MethodId[]) => {
  const out = { ...r }
  for (const id of new Set(ids)) out[id] = (out[id] ?? 0) + 1
  return out
}

export function noteMethods(s: MethodStats, e: { reached?: MethodId[]; hinted?: MethodId[]; unlocked?: MethodId[]; needed?: MethodId[] }): MethodStats {
  return {
    reached: bump(s.reached, e.reached ?? []),
    hinted: bump(s.hinted, e.hinted ?? []),
    unlocked: bump(s.unlocked, e.unlocked ?? []),
    needed: bump(s.needed, e.needed ?? [])
  }
}

export interface MethodReport {
  id: MethodId
  name: string
  reached: number
  unlocked: number
  needed: number
  /** Needed in problems you tried, never reached for */
  neverReached: boolean
}

/** Each method's counts, and the ones to train: needed at least twice and never (or rarely) reached for */
export function methodReport(s: MethodStats): { methods: MethodReport[]; train: MethodId[]; unlocks: MethodId[] } {
  const methods = METHODS.map((m) => {
    const reached = s.reached[m.id] ?? 0
    const needed = s.needed[m.id] ?? 0
    return { id: m.id, name: m.name, reached, unlocked: s.unlocked[m.id] ?? 0, needed, neverReached: reached === 0 && needed >= 3 }
  })
  const train = methods
    .filter((m) => m.needed >= 3 && m.reached / m.needed < 0.25)
    .sort((a, b) => b.needed - b.reached - (a.needed - a.reached))
    .map((m) => m.id)
  const unlocks = methods.filter((m) => m.unlocked > 0).sort((a, b) => b.unlocked - a.unlocked).map((m) => m.id)
  return { methods, train, unlocks }
}
