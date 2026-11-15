/**
 * The learner's main path (their goal note's "## The main path" and the Interests groups under it):
 * which tracks are the spine, which serve it and where it is applied, as hard rules on North Star's
 * stages rather than prose the planner may weigh against its own habits.
 *
 * - parseMainPath reads the note: the spine's bold line, "Serving it" and "Where I apply it", in
 *   both the main-path section and the Interests groups, mapped to tracks of the catalogue.
 * - checkMainPath says what a plan breaks: the spine in stage 1 or 2 and the largest share of the
 *   first five stages; deep learning reached within about a year at the learner's hours; the side
 *   tracks one continuous applied thread (one track a stage, 15–25% of each stage from stage 2, a
 *   little in stage 1), never leading a stage.
 * - repairMainPath fixes what the model wouldn't, deterministically, and says what it changed.
 *
 * Pure: main/northStar feeds it the goal note and the catalogue and acts on the result.
 */
import { bare, durationWords, MAX_TRACKS, orderStages, resolveTrack, type CatalogueTrack, type NorthStar, type Stage, type StageTrack } from './northStar'

export interface MainPath {
  /** Track names (as the catalogue has them) */
  spine: string[]
  serving: string[]
  applied: string[]
}

/** Words that name a track (by its id); the first match wins within a phrase */
const TRACK_WORDS: [RegExp, string][] = [
  [/machine learning|\bml\b|deep learning/i, 'machine-learning'],
  [/\bai research\b|\bai\b|\bagents?\b/i, 'ai-research'],
  [/data engineering/i, 'data-engineering'],
  [/software engineering|c\+\+|backend|infrastructure|\bsystems\b|\brust\b/i, 'software-engineering'],
  [/mathematic|\bmaths?\b/i, 'mathematics'],
  [/blockchain|stablecoin/i, 'blockchain'],
  [/payment|banking/i, 'payments-banking'],
  [/quant|finance|computational economics/i, 'quant-finance']
]

const idsIn = (text: string): string[] => {
  const out: string[] = []
  for (const [re, id] of TRACK_WORDS) if (re.test(text) && !out.includes(id)) out.push(id)
  return out
}

/** A section of the note by its ## heading (loosely), or '' */
function section(note: string, re: RegExp): string {
  const lines = note.replace(/\r\n/g, '\n').split('\n')
  const i = lines.findIndex((l) => /^##\s/.test(l) && re.test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^##\s/.test(l))
  return lines.slice(i + 1, j < 0 ? undefined : j).join('\n')
}

/**
 * The main path from the goal note, as track names of the catalogue; null when the note has none.
 * A track named in more than one role keeps the first: spine, then serving, then applied.
 */
export function parseMainPath(note: string, catalogue: CatalogueTrack[]): MainPath | null {
  const main = section(note, /main path/i)
  const interests = section(note, /interests/i)
  if (!main && !/\*\*the spine\*\*/i.test(interests)) return null
  const spine: string[] = []
  const serving: string[] = []
  const applied: string[] = []
  // The main path: the spine's bold line, else the sentence that names the spine
  const bold = main.match(/\*\*([^*]*\bspine\b[^*]*)\*\*/i)?.[1] ?? main.match(/[^.\n]*\bspine\b[^.\n]*/i)?.[0] ?? ''
  spine.push(...idsIn(bold))
  const bullet = (label: RegExp) =>
    main
      .split('\n')
      .filter((l) => label.test(l))
      // Up to the first full stop: what follows explains ("so I can build and run ML systems")
      .map((l) => l.replace(/^\s*[-*+]\s*\*\*[^*]*\*\*\s*/, '').replace(/,?\s*so (that )?I can[^.]*\./i, '.'))
      .join(' ')
  serving.push(...idsIn(bullet(/\*\*serving it/i)))
  applied.push(...idsIn(bullet(/\*\*where i apply it/i).split(/\.\s/)[0]))
  // The Interests groups: **The spine**, **Serving it**, **Where I apply it**, each a list
  const groups = interests.split(/\n(?=\*\*)/)
  for (const g of groups) {
    const head = g.match(/^\*\*([^*]+)\*\*/)?.[1] ?? ''
    const body = g.replace(/^\*\*[^*]+\*\*/, '')
    if (/spine/i.test(head)) spine.push(...idsIn(body))
    else if (/serving/i.test(head)) serving.push(...idsIn(body))
    else if (/apply/i.test(head)) applied.push(...idsIn(body))
  }
  const names = (ids: string[], taken: Set<string>) => {
    const out: string[] = []
    for (const id of ids) {
      const t = catalogue.find((c) => c.id === id) ?? resolveTrack(id.replace(/-/g, ' '), catalogue)
      if (t && !taken.has(t.name) && !out.includes(t.name)) out.push(t.name)
    }
    out.forEach((n) => taken.add(n))
    return out
  }
  const taken = new Set<string>()
  const path = { spine: names(spine, taken), serving: names(serving, taken), applied: names(applied, taken) }
  return path.spine.length ? path : null
}

// ---------- The rules ----------

/** The spine starts in stage 1 or 2 */
export const SPINE_BY = 2
/** The spine's share is the largest over this many first stages */
export const SHARE_STAGES = 5
/**
 * Deep learning starts by this stage (the approved shape's fourth), and within about DL_MONTHS
 * months of work when the spine's prerequisites allow it. The months are information, not a limit:
 * the learner put the structure before the dates, and nothing is cut to make them.
 */
export const DL_BY_STAGE = 4
export const DL_MONTHS = 13
/** The modules that are deep learning */
export const DL_MODULES = ['neural-networks', 'deep-learning-architectures']
/** The applied thread's share of each stage from stage 2: at least, at most; at most in stage 1 */
export const APPLIED_MIN = 15
export const APPLIED_MAX = 25
export const APPLIED_FIRST = 15
const WEEKS_A_MONTH = 52 / 12

interface ModInfo {
  id: string
  title: string
  hours: number
  passed: boolean
  tracks: string[]
  requires: string[]
}

/** The modules of the catalogue by bare title, and parts by bare heading (a share of their module's hours) */
function moduleIndex(cat: CatalogueTrack[]) {
  const mods = new Map<string, ModInfo>()
  const byId = new Map<string, ModInfo>()
  const parts = new Map<string, { id: string; hours: number }>()
  for (const t of cat)
    t.modules?.forEach((m, i) => {
      const have = byId.get(m.id)
      if (have) {
        if (!have.tracks.includes(t.name)) have.tracks.push(t.name)
        return
      }
      const info: ModInfo = { id: m.id, title: m.title, hours: m.hours || m.topics * 2.5, passed: !!m.passed, tracks: [t.name], requires: m.requires }
      byId.set(m.id, info)
      mods.set(bare(m.title), info)
      const ph = t.phases[i]
      for (const s of ph?.sections ?? []) if (ph.topics) parts.set(bare(s.title), { id: m.id, hours: (info.hours * s.topics) / ph.topics })
    })
  return { mods, byId, parts }
}

/** Each stage's hours of work, a module counted once (where it first appears), passed ones none */
export function stageHoursOf(stages: Stage[], cat: CatalogueTrack[]): number[] {
  const { mods, parts } = moduleIndex(cat)
  const seen = new Set<string>()
  return stages.map((s) => {
    let h = 0
    for (const t of s.tracks)
      for (const x of t.scope) {
        const b = bare(x)
        const m = mods.get(b)
        if (m) {
          if (!seen.has(m.id) && !m.passed) h += m.hours
          seen.add(m.id)
          continue
        }
        const p = parts.get(b)
        if (p && !seen.has(p.id) && !seen.has(`${p.id}#${b}`)) h += p.hours
        if (p) seen.add(`${p.id}#${b}`)
      }
    return h
  })
}

const scopeIds = (s: Stage, cat: CatalogueTrack[]) => {
  const { mods, parts } = moduleIndex(cat)
  return s.tracks.flatMap((t) => t.scope.map((x) => mods.get(bare(x))?.id ?? parts.get(bare(x))?.id).filter((x): x is string => !!x))
}

export interface MainPathCheck {
  violations: string[]
  /** Index of the first stage with deep learning, -1 when none has it */
  dl: number
  /** Months of work before deep learning starts */
  dlMonths: number | null
  /** The spine's share of the first stages, and the largest other track's */
  spineShare: number
  topOther: { track: string; share: number } | null
}

const sideShare = (s: Stage, path: MainPath) => s.tracks.filter((t) => path.applied.includes(t.track)).reduce((n, t) => n + t.weight, 0)
const lead = (s: Stage) => [...s.tracks].sort((a, b) => b.weight - a.weight)[0]

/** What a plan breaks of the main path, in words the model (and the learner) can act on */
export function checkMainPath(ns: Pick<NorthStar, 'stages'>, path: MainPath, cat: CatalogueTrack[], hoursPerWeek: number): MainPathCheck {
  const v: string[] = []
  const stages = ns.stages
  const spine = path.spine.join(' and ')
  // 1. Every spine track is in the plan, and one starts in stage 1 or 2
  for (const t of path.spine) if (!stages.some((s) => s.tracks.some((x) => x.track === t))) v.push(`${t} is in no stage, but it is the spine.`)
  const first = stages.findIndex((s) => s.tracks.some((t) => path.spine.includes(t.track)))
  if (first < 0 || first >= SPINE_BY) v.push(`The spine (${spine}) first appears in ${first < 0 ? 'no stage' : `stage ${first + 1}`}; it must be in stage 1 or 2.`)
  // 2. The spine holds the largest share of the first stages, by hours
  const hours = stageHoursOf(stages, cat)
  const head = stages.slice(0, SHARE_STAGES)
  const w = head.map((_, i) => hours[i] || 1)
  const total = w.reduce((a, b) => a + b, 0)
  const share = new Map<string, number>()
  head.forEach((s, i) => s.tracks.forEach((t) => share.set(t.track, (share.get(t.track) ?? 0) + (t.weight * w[i]) / total)))
  const spineShare = Math.round(path.spine.reduce((n, t) => n + (share.get(t) ?? 0), 0))
  const others = [...share].filter(([t]) => !path.spine.includes(t)).sort((a, b) => b[1] - a[1])
  const topOther = others[0] ? { track: others[0][0], share: Math.round(others[0][1]) } : null
  if (topOther && spineShare <= topOther.share) v.push(`Across the first ${head.length} stages the spine has ${spineShare}% of the time and ${topOther.track} ${topOther.share}%; the spine must have the largest share.`)
  // 3. Deep learning within about a year at their hours
  const dl = stages.findIndex((s) => scopeIds(s, cat).some((id) => DL_MODULES.includes(id)))
  const hasModules = cat.some((t) => t.modules?.some((m) => DL_MODULES.includes(m.id)))
  let dlMonths: number | null = null
  if (hasModules) {
    if (dl < 0) v.push('No stage takes deep learning (Neural Networks from Scratch, then PyTorch, CNNs and Sequence Models).')
    else {
      dlMonths = Math.round((hours.slice(0, dl).reduce((a, b) => a + b, 0) / Math.max(1, hoursPerWeek) / WEEKS_A_MONTH) * 10) / 10
      if (dl + 1 > DL_BY_STAGE) v.push(`Deep learning starts in stage ${dl + 1}, after about ${Math.round(dlMonths)} months of work at ${hoursPerWeek} hours a week; it must start by stage ${DL_BY_STAGE}, with only what leads to it before.`)
    }
  }
  // 4. The applied thread: one side track a stage, a little in stage 1, 15–25% from stage 2, never leading
  if (path.applied.length) {
    // Once the thread is whole (its last stage passed), later stages are the spine's alone
    const lastSide = stages.reduce((k, s, i) => (s.tracks.some((t) => path.applied.includes(t.track)) ? i : k), -1)
    stages.forEach((s, i) => {
      const side = s.tracks.filter((t) => path.applied.includes(t.track))
      const sum = sideShare(s, path)
      const n = `Stage ${i + 1} (${s.title})`
      if (side.length > 1) v.push(`${n} has ${side.length} side tracks (${side.map((t) => t.track).join(', ')}); the applied thread takes one at a time.`)
      if (i === 0 && sum > APPLIED_FIRST) v.push(`${n} gives the side tracks ${sum}%; stage 1 has at most ${APPLIED_FIRST}%.`)
      if (i > 0 && i <= lastSide && (sum < APPLIED_MIN || sum > APPLIED_MAX)) v.push(`${n} gives the side tracks ${sum}%; from stage 2 the applied thread is ${APPLIED_MIN}–${APPLIED_MAX}% of every stage.`)
      if ((dl < 0 || i < dl) && side.length && path.applied.includes(lead(s).track)) v.push(`${n} is led by ${lead(s).track}, a side track, before deep learning.`)
    })
    // …and it goes through each side track's whole outline, not a sample
    const planned = new Set(stages.flatMap((s) => scopeIds(s, cat)))
    const missing = new Map<string, string[]>()
    for (const m of appliedThread(path, cat)) if (!planned.has(m.id)) missing.set(m.track, [...(missing.get(m.track) ?? []), m.title])
    for (const [t, ms] of missing) v.push(`The applied thread leaves out ${ms.length} module${ms.length === 1 ? '' : 's'} of ${t} (${ms.slice(0, 6).join('; ')}${ms.length > 6 ? '; …' : ''}); it takes each side track's whole outline.`)
  }
  return { violations: v, dl, dlMonths, spineShare, topOther }
}

/** The text that sends the plan back to the model once */
export function retryText(violations: string[]): string {
  return `\n\n## Your previous answer broke the main path\nThe plan you returned broke these hard rules:\n${violations.map((x) => `- ${x}`).join('\n')}\n\nAnswer again with the whole plan, fixed so that none of these is broken. Return ONLY JSON in the same shape.`
}

// ---------- The applied thread ----------

/** The side tracks in the order the thread takes them, each in full: payments and banking, then blockchain and stablecoins, then quant */
export const THREAD_ORDER = ['payments-banking', 'blockchain', 'quant-finance']
/** A module taken in a later leg of the thread than its own track's (stablecoins after the blockchain foundations) */
const LEG_OF: Record<string, string> = { stablecoins: 'blockchain' }
/** The thread's share of each stage from stage 2 */
export const THREAD_SHARE = 20

/**
 * The applied thread, module by module: each side track's whole outline in turn, a module a spine or
 * serving track also has left out (it is learned there, and counts as covered), passed ones too.
 */
export function appliedThread(path: MainPath, cat: CatalogueTrack[]): { track: string; id: string; title: string; hours: number }[] {
  const { byId } = moduleIndex(cat)
  const rank = (name: string) => {
    const id = cat.find((t) => t.name === name)?.id ?? ''
    const i = THREAD_ORDER.indexOf(id)
    return i < 0 ? THREAD_ORDER.length + path.applied.indexOf(name) : i
  }
  const order = [...path.applied].sort((a, b) => rank(a) - rank(b))
  const core = new Set([...path.spine, ...path.serving])
  const seen = new Set<string>()
  const legs = new Map<string, { track: string; id: string; title: string; hours: number }[]>(order.map((t) => [t, []]))
  const late = new Map<string, { track: string; id: string; title: string; hours: number }[]>(order.map((t) => [t, []]))
  for (const track of order)
    for (const m of cat.find((t) => t.name === track)?.modules ?? []) {
      const info = byId.get(m.id)
      if (!info || seen.has(m.id) || info.passed || info.tracks.some((t) => core.has(t))) continue
      seen.add(m.id)
      const leg = order.find((t) => cat.find((x) => x.name === t)?.id === LEG_OF[m.id])
      ;(leg && leg !== track ? late : legs).get(leg ?? track)!.push({ track, id: m.id, title: m.title, hours: info.hours })
    }
  // A module taken in another track's leg comes at that leg's end (stablecoins after the blockchain foundations)
  return order.flatMap((t) => [...legs.get(t)!, ...late.get(t)!])
}

/** The thread's line for a stage: which side track, its hours here, and how long that takes at its share */
export function threadLine(s: Stage, path: MainPath, cat: CatalogueTrack[], hoursPerWeek: number): string | null {
  const t = s.tracks.find((x) => path.applied.includes(x.track))
  if (!t) return null
  const { mods } = moduleIndex(cat)
  const h = Math.round(t.scope.reduce((n, x) => n + (mods.get(bare(x))?.hours ?? 0), 0))
  if (!h) return null
  const weeks = h / Math.max(0.5, (hoursPerWeek * t.weight) / 100)
  return `Applied thread: ${t.track}, about ${h} h of it here, which takes ${durationWords(weeks)} at ${t.weight}% of ${hoursPerWeek} h a week.`
}

/** Every stage says what its applied thread is and how long it honestly takes (replacing an older line) */
export function withThreadLines(ns: NorthStar, path: MainPath, cat: CatalogueTrack[]): NorthStar {
  return {
    ...ns,
    stages: ns.stages.map((s) => {
      const line = threadLine(s, path, cat, ns.hoursPerWeek)
      const rest = s.synergies.filter((x) => !/^Applied thread:/.test(x))
      return { ...s, synergies: line ? [line, ...rest] : rest }
    })
  }
}

// ---------- The repair ----------

/** Weights set so the track at `i` has `w` and the others share the rest in proportion, summing to 100 */
function setShare(tracks: StageTrack[], i: number, w: number): StageTrack[] {
  const rest = tracks.reduce((n, t, j) => n + (j === i ? 0 : t.weight), 0)
  const out = tracks.map((t, j) => ({ ...t, weight: j === i ? w : rest > 0 ? (t.weight / rest) * (100 - w) : (100 - w) / Math.max(1, tracks.length - 1) }))
  const r = out.map((t) => Math.round(t.weight))
  const diff = 100 - r.reduce((a, b) => a + b, 0)
  const others = r.filter((_, j) => j !== i)
  const k = others.length ? r.findIndex((x, j) => j !== i && x === Math.max(...others)) : i
  r[k] += diff
  return out.map((t, j) => ({ ...t, weight: r[j] }))
}

const words = (n: number) => `stage ${n + 1}`

/**
 * The plan made to follow the main path, by code: the applied thread rebuilt (one side track at a
 * time through its whole outline, 20% of every stage from stage 2, more stages beside the frontier
 * when it runs past the last); a spine track the plan left out added as the frontier; deep learning
 * pulled forward as far as its prerequisites allow; the spine put into stage 1 or 2 and given the
 * largest share of the first stages. Nothing of the spine is cut to fit a date. Returns what it
 * changed, for the proposal to say.
 */
export function repairMainPath(ns: NorthStar, path: MainPath, cat: CatalogueTrack[], hoursPerWeek: number): { ns: NorthStar; fixes: string[] } {
  const fixes: string[] = []
  const { mods, byId } = moduleIndex(cat)
  const clone = (s: Stage): Stage => ({ ...s, after: [...s.after], tracks: s.tracks.map((t) => ({ ...t, scope: [...t.scope] })), synergies: [...s.synergies] })
  let stages = ns.stages.map(clone)
  const isSide = (t: string) => path.applied.includes(t)
  const isSpine = (t: string) => path.spine.includes(t)
  const check = () => checkMainPath({ stages }, path, cat, hoursPerWeek)
  let c = check()
  const threadBroken = c.violations.some((x) => /side track|applied thread/.test(x))

  // 1. The side tracks taken out of every stage, to be laid back as one thread; stages they led go with them
  if (threadBroken && path.applied.length) {
    const gone: string[] = []
    stages = stages.flatMap((s) => {
      const kept = s.tracks.filter((t) => !isSide(t.track))
      if (kept.length === s.tracks.length) return [s]
      if (!kept.length || sideShare(s, path) > 50) gone.push(s.title)
      if (!kept.length) return []
      const sum = kept.reduce((n, t) => n + t.weight, 0)
      // A stage the side tracks led is named for what is left of it
      const top = [...kept].sort((a, b) => b.weight - a.weight)[0]
      const title = sideShare(s, path) > 50 ? `${top.track}: ${top.scope.slice(0, 2).join(' and ')}` : s.title
      return [{ ...s, title, tracks: kept.map((t) => ({ ...t, weight: (t.weight / sum) * 100 })) }]
    })
    const left = new Set(stages.map((s) => s.n))
    stages = orderStages(stages.map((s) => ({ ...s, after: s.after.filter((a) => left.has(a)) })))
    fixes.push(`rebuilt the applied thread: one side track at a time through its whole outline, ${THREAD_SHARE}% of every stage from stage 2${gone.length ? ` (the side-track stages ${gone.join('; ')} folded into it)` : ''}`)
  }

  // 2. A spine track the plan left out: the frontier, as the last stage
  for (const t of path.spine) {
    if (stages.some((s) => s.tracks.some((x) => x.track === t))) continue
    const track = cat.find((x) => x.name === t)
    const all = new Set(stages.flatMap((s) => scopeIds(s, cat)))
    const scope = (track?.modules ?? []).filter((m) => !m.passed && !all.has(m.id)).map((m) => m.title)
    if (!scope.length) continue
    const last = stages[stages.length - 1]
    stages.push({ n: Math.max(0, ...stages.map((s) => s.n)) + 1, title: `The frontier: ${t}`, after: last ? [last.n] : [], depth: 6, tracks: [{ track: t, weight: 100, scope }], deep: [], synergies: [], capstone: { title: `A reproduction from ${t}`, brief: 'Reproduce a recent paper’s result in this track, then extend it and write it up.', joins: [t] }, gate: 'You have reproduced a current result and written up an extension of your own.' })
    fixes.push(`added ${t} as the last stage, the frontier`)
  }

  // 3. Deep learning pulled forward to stage 4: what leads to it that sits later comes with it, into its stage
  c = check()
  if (c.dl + 1 > DL_BY_STAGE) {
    const before = c.dl + 1
    const dlStage = stages[c.dl]
    const at = DL_BY_STAGE - 1
    const own = new Set(scopeIds(dlStage, cat))
    const need = new Set<string>()
    const walk = (id: string) => {
      for (const r of byId.get(id)?.requires ?? []) if (!need.has(r)) need.add(r), walk(r)
    }
    own.forEach(walk)
    const early = new Set(stages.slice(0, at).flatMap((s) => scopeIds(s, cat)))
    // Needed, and only in the stages it would jump: moved into its stage, under a track that has it
    for (const s of stages.slice(at, c.dl))
      for (const t of s.tracks) {
        const move = t.scope.filter((x) => {
          const id = mods.get(bare(x))?.id
          return !!id && need.has(id) && !early.has(id) && !own.has(id) && !byId.get(id)!.passed
        })
        if (!move.length) continue
        t.scope = t.scope.filter((x) => !move.includes(x))
        for (const x of move) {
          const home = dlStage.tracks.find((d) => mods.get(bare(x))!.tracks.includes(d.track))
          if (home) home.scope.unshift(x)
          else if (dlStage.tracks.length < MAX_TRACKS) dlStage.tracks.push({ track: t.track, weight: 15, scope: [x] })
          else continue
          own.add(mods.get(bare(x))!.id)
        }
      }
    stages = stages.filter((s) => s.tracks.some((t) => t.scope.length) || s === dlStage).map((s) => ({ ...s, tracks: s.tracks.filter((t) => t.scope.length) }))
    const moved = stages.find((s) => s.n === dlStage.n)!
    const rest = stages.filter((s) => s !== moved)
    stages = [...rest.slice(0, at), moved, ...rest.slice(at)]
    const pos = new Map(stages.map((s, k) => [s.n, k]))
    stages = stages.map((s, k) => ({ ...s, after: s.after.filter((a) => (pos.get(a) ?? k) < k) }))
    c = check()
    if (c.dl + 1 !== before) fixes.push(`moved deep learning from stage ${before} to stage ${c.dl + 1}, with what leads to it`)
  }

  // 4. The spine in stage 1 or 2: a spine module already there moves under its spine track
  if (!stages.slice(0, SPINE_BY).some((s) => s.tracks.some((t) => isSpine(t.track)))) {
    const i = Math.min(SPINE_BY, stages.length) - 1
    const s = stages[i]
    const spineTrack = path.spine[0]
    const moved: string[] = []
    for (const t of s.tracks) {
      const mine = t.scope.filter((x) => mods.get(bare(x))?.tracks.includes(spineTrack))
      if (mine.length && mine.length < t.scope.length) {
        moved.push(...mine)
        t.scope = t.scope.filter((x) => !mine.includes(x))
      }
    }
    // None there: the spine track's first module whose prerequisites come by then, brought forward from later
    if (!moved.length) {
      const by = new Set(stages.slice(0, i + 1).flatMap((x) => scopeIds(x, cat)))
      const m = cat.find((t) => t.name === spineTrack)?.modules?.find((x) => !x.passed && !by.has(x.id) && x.requires.every((r) => by.has(r) || byId.get(r)?.passed || !byId.has(r)))
      if (m) {
        moved.push(m.title)
        for (const later of stages.slice(i + 1)) for (const t of later.tracks) t.scope = t.scope.filter((x) => bare(x) !== bare(m.title))
        stages = stages.map((x) => ({ ...x, tracks: x.tracks.filter((t) => t.scope.length) })).filter((x) => x.tracks.length)
      }
    }
    const here = stages[i]
    if (moved.length && here.tracks.length < MAX_TRACKS) {
      here.tracks.push({ track: spineTrack, weight: 0, scope: moved })
      here.tracks = setShare(here.tracks, here.tracks.length - 1, 30)
      fixes.push(`started ${spineTrack} in ${words(i)} (${moved.join('; ')})`)
    }
  }

  // 5. The thread laid back: from stage 2, the next modules of one side track, about a quarter of the stage's other work
  if (threadBroken && path.applied.length) {
    const planned = new Set(stages.flatMap((s) => scopeIds(s, cat)))
    const queue = appliedThread(path, cat).filter((m) => !planned.has(m.id))
    const hours = stageHoursOf(stages, cat)
    const take = (budget: number) => {
      const out: typeof queue = []
      let h = 0
      while (queue.length && queue[0].track === (out[0]?.track ?? queue[0].track) && (!out.length || h < budget)) {
        h += queue[0].hours
        out.push(queue.shift()!)
      }
      return out
    }
    stages = stages.map((s, i) => {
      if (i === 0 || !queue.length) return s
      const chunk = take((hours[i] * THREAD_SHARE) / (100 - THREAD_SHARE))
      let tracks = [...s.tracks]
      if (tracks.length >= MAX_TRACKS) {
        // Room for the thread: the smallest track that isn't the spine moves to the next stage
        const k = tracks.map((t, j) => [t, j] as const).filter(([t]) => !isSpine(t.track)).sort((a, b) => a[0].weight - b[0].weight)[0]?.[1]
        const later = stages[i + 1]
        if (k === undefined || !later) return (queue.unshift(...chunk), s)
        const gone = tracks[k]
        tracks = tracks.filter((_, j) => j !== k)
        const same = later.tracks.find((t) => t.track === gone.track)
        if (same) same.scope.unshift(...gone.scope.filter((x) => !same.scope.includes(x)))
        else later.tracks.push({ ...gone, weight: 15 })
      }
      tracks.push({ track: chunk[0].track, weight: 0, scope: chunk.map((m) => m.title) })
      return { ...s, tracks: setShare(tracks, tracks.length - 1, THREAD_SHARE) }
    })
    // Past the last stage: more stages beside the frontier, one side track each, until the thread is whole
    const last = stages[stages.length - 1]
    const spineLast = last?.tracks.find((t) => isSpine(t.track))
    while (queue.length && last) {
      const track = queue[0].track
      const chunk: typeof queue = []
      while (queue.length && queue[0].track === track) chunk.push(queue.shift()!)
      const prev = stages[stages.length - 1]
      stages.push({
        n: Math.max(...stages.map((s) => s.n)) + 1,
        title: `${track} in full, beside the frontier`,
        after: [prev.n],
        depth: 4,
        tracks: [...(spineLast ? [{ track: spineLast.track, weight: 100 - THREAD_SHARE, scope: [...spineLast.scope] }] : []), { track, weight: spineLast ? THREAD_SHARE : 100, scope: chunk.map((m) => m.title) }],
        deep: [],
        synergies: [],
        capstone: { title: `${track} applied with ML`, brief: `A project that joins ${track} with the frontier work beside it.`, joins: spineLast ? [spineLast.track, track] : [track] },
        gate: `Every ${track} module here has passed its gate.`
      })
    }
  }

  // 6. The spine's share of the first stages: raised stage by stage where it is
  for (let round = 0; round < 6 && (c = check()).topOther && c.spineShare <= c.topOther!.share; round++) {
    let changed = false
    stages = stages.map((s, i) => {
      if (i >= SHARE_STAGES) return s
      const sp = s.tracks.findIndex((t) => isSpine(t.track))
      if (sp < 0 || s.tracks[sp].weight >= 70) return s
      changed = true
      return { ...s, tracks: setShare(s.tracks, sp, Math.min(70, s.tracks[sp].weight + 10)) }
    })
    if (!changed) break
    if (round === 0) fixes.push(`gave the spine more of the first ${SHARE_STAGES} stages`)
  }
  // The thread's share where step 5 put it
  stages = stages.map((s, i) => {
    const at = s.tracks.findIndex((t) => isSide(t.track))
    if (at < 0) return s
    const w = s.tracks[at].weight
    if (i === 0 && w > APPLIED_FIRST) return { ...s, tracks: setShare(s.tracks, at, APPLIED_FIRST) }
    return i > 0 && (w < APPLIED_MIN || w > APPLIED_MAX) ? { ...s, tracks: setShare(s.tracks, at, THREAD_SHARE) } : s
  })

  const renum = new Map(stages.map((s, i) => [s.n, i + 1]))
  stages = stages.map((s, i) => ({ ...s, n: i + 1, after: s.after.map((a) => renum.get(a)).filter((a): a is number => !!a && a <= i) }))
  const curTitle = ns.stages.find((s) => s.n === ns.current)?.title
  return { ns: withThreadLines({ ...ns, stages, current: stages.find((s) => s.title === curTitle)?.n ?? 1 }, path, cat), fixes: [...new Set(fixes)] }
}

// ---------- The prompt ----------

/** The main path as hard rules for the prompt, with the shape the learner approved when the spine is ML */
export function mainPathPrompt(path: MainPath, hoursPerWeek: number, cat: CatalogueTrack[] = []): string {
  const ml = path.spine.some((t) => /machine learning/i.test(t))
  const thread = appliedThread(path, cat)
  const legs = [...new Set(thread.map((m) => m.track))].map((t) => `${t}: ${thread.filter((m) => m.track === t).map((m) => m.title).join('; ')}`)
  return `## The main path: hard ordering rules (from their note; a plan that breaks them is sent back)
- The spine: ${path.spine.join(', ')}. Most of their time goes here, from the first stages to the last.
- Serving it: ${path.serving.join(', ') || 'none named'}. These come beside the spine when it needs them, never as a long block before it.
- Where they apply it (side tracks): ${path.applied.join(', ') || 'none named'}. Never the bulk of a stage.
- Time is not the constraint: the structure is. Never shorten or drop modules (spine or applied) to fit a date; state each stage's honest duration as information.

Rules:
1. A spine track is in stage 1 or 2, and across the first ${SHARE_STAGES} stages the spine has a larger share of the time than any other single track.
2. Deep learning (Neural Networks from Scratch, then PyTorch, CNNs and Sequence Models) starts by stage ${DL_BY_STAGE}, with only what leads to it before: aim for about a year at ${hoursPerWeek} hours a week (about ${Math.round(hoursPerWeek * WEEKS_A_MONTH * (DL_MONTHS - 1))} hours of work), but never by cutting what the spine needs.
3. The side tracks are ONE continuous applied thread running beside the spine, about ${THREAD_SHARE}% of every stage from stage 2 (${APPLIED_MIN}–${APPLIED_MAX}%), at most ${APPLIED_FIRST}% in stage 1 (5–10% is fine). One side track per stage, never two or three at once. They never lead a stage and never get a stage of their own.
4. The thread takes ONE side track at a time through its WHOLE module outline, every module and its gate, as if they took that course, in this order: Payments and Banking first, then Blockchain with stablecoins, then Quant and Finance (its maths, statistics, time series and ML in finance are covered by the spine). Its modules, in order, are:
${legs.map((l) => `   - ${l}`).join('\n') || '   (none)'}
   In each stage, say in a synergy line beginning "Applied thread:" which side track it is, its hours there, and how long that honestly takes at its share of their week.
5. Every spine track appears in the plan; ${path.spine.find((t) => /research/i.test(t)) ?? path.spine[path.spine.length - 1]} carries the frontier in the last stages.
6. Serving tracks arrive when the spine needs them: data science and data engineering beside the ML that uses them.
${
  ml
    ? `
The shape the learner approved (follow it; change it only where the module DAG makes a step impossible):
1. Foundations: Python, computation, data structures and algorithms (about 3 months); at most a small first taste of the thread.
2. Maths for ML, computed in NumPy: linear algebra, calculus, probability. Thread: Payments and Banking begins (payments, ledgers and double entry in core banking), beside SQL and databases.
3. Classical ML and statistics, with SQL and databases (data science). Thread: Payments and Banking goes on (payment infrastructure, open banking).
4. Neural networks and deep learning, beside OS, C++ and system design (for the interviews in September 2027). Thread: Blockchain foundations (hashing, signatures, Ethereum and the EVM).
5. Transformers and ML systems, with data engineering. Thread: smart contracts, DeFi, stablecoins and on-chain data (with the data engineering).
6. Scale: distributed training, GPUs, MLOps. Thread: Quant and Finance (markets, derivatives, microstructure).
7. The frontier: the AI Research and Agents track. Thread: the rest of Quant and Finance, in full.
Stage capstones converge the thread with ML (use these where they fit; never a fraud model behind a payments API, which is too common):
- Liquidity and intraday cash-position forecasting for a payment network's settlement (a transformer on time series, over real payment rails).
- An LLM agent that reads and reconciles ISO 20022 messages across ledgers, with evals.
- A stablecoin depeg early-warning system: an on-chain data pipeline and a sequence model, backtested on USDC in the SVB weekend and on Terra.
- An RL market-making agent on their own matching engine (a tokenised exchange).
`
    : ''
}`
}
