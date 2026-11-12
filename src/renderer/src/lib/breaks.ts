import { useEffect, useRef, useState } from 'react'
import type { BreakSettings } from '@shared/breaks'
import {
  active,
  addAnswer,
  addBoundary,
  decide,
  dismissWelcome,
  emptyProfile,
  freshState,
  headsUpGiven,
  markAnswer,
  noteAfter,
  noteFatigue,
  onBreak,
  reprieve,
  settle,
  skipBreak,
  snooze,
  startBreak,
  IDLE_GAP_MS,
  type BlockState,
  type Profile
} from '@shared/breaks'
import { learnRhythm, type Boundary, type Mark } from '@shared/breakPlanner'

/**
 * The window's side of breaks (shared/breaks, shared/breakPlanner): the block's state and the
 * learner's rhythm, kept in this Mac's storage so a break survives Tide being hidden or quit, and
 * shared by every Tide window (a focus window is locked too). Lessons feed it their signals
 * (answers, marks, steps passed); the hook in App watches activity and acts on the plan.
 */

const KEY = 'tide.breaks.v1'
const PROFILE_KEY = 'tide.breaks.profile.v1'

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // Storage full or blocked: the break still works this session
  }
}

let state: BlockState = read(KEY, freshState(Date.now()))
let profile: Profile = { ...emptyProfile(), ...read<Partial<Profile>>(PROFILE_KEY, {}) }
/** What only this window shows: the heads-up and the gentle offer */
export type Ui = { headsUp?: string; offer?: { studied: number; minutes: number; line: string } }
let ui: Ui = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function set(next: BlockState, p: Profile = profile) {
  const changedP = p !== profile
  state = next
  profile = p
  write(KEY, state)
  if (changedP) {
    write(PROFILE_KEY, profile)
    shareRhythm()
  }
  emit()
}

/** The learner profile's pace line reads the rhythm (main/learnerProfile): sent when it changes, at most once a minute */
let sharedAt = 0
function shareRhythm() {
  if (Date.now() - sharedAt < 60_000 || typeof window === 'undefined' || !window.tide?.learner) return
  sharedAt = Date.now()
  const r = learnRhythm(profile.logs)
  window.tide.learner.rhythm({ fadesAt: r.fadesAt, goodHours: r.goodHours, learnedFrom: r.learnedFrom }).catch(() => {})
}
const setUi = (u: Ui) => ((ui = u), emit())

// Another window changed it
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) state = read(KEY, state)
    else if (e.key === PROFILE_KEY) profile = { ...emptyProfile(), ...read<Partial<Profile>>(PROFILE_KEY, {}) }
    else return
    emit()
  })

export function useBreakStore(): { state: BlockState; ui: Ui; profile: Profile } {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { state, ui, profile }
}

export const rhythmNow = () => learnRhythm(profile.logs)

// ---------- What a lesson tells it ----------

let askedAt = 0
let keys = 0
let backspaces = 0

/** What the lesson on screen says, for the break screen: where it stopped, and a question to come back with */
type LessonHooks = { where?: () => string; recall?: () => string | null }
let lesson: LessonHooks = {}
export function lessonForBreaks(h: LessonHooks | null) {
  lesson = h ?? {}
}
export const whereNow = () => lesson.where?.() ?? ''
export const recallNow = () => lesson.recall?.() ?? null

export const breakSignals = {
  /** A question is on screen, waiting for an answer: latency counts from here */
  asked() {
    askedAt = Date.now()
    keys = 0
    backspaces = 0
  },
  /** An answer was sent */
  answered(a: { words: number; dontKnow?: boolean; skip?: boolean; topic?: string }) {
    const now = Date.now()
    set(addAnswer(state, { at: now, topic: a.topic, words: a.words, dontKnow: a.dontKnow, skip: a.skip, ...(askedAt ? { latencyMs: now - askedAt } : {}), ...(keys >= 10 ? { corrections: Math.round((backspaces / keys) * 100) / 100 } : {}) }))
    askedAt = 0
  },
  hint() {
    set(addAnswer(state, { at: Date.now(), hint: true }))
  },
  marked(mark: Mark, topic?: string) {
    const r = markAnswer(state, profile, mark, topic)
    set(r.state, r.profile)
  },
  boundary(kind: Boundary['kind'], label?: string) {
    set(addBoundary(state, { at: Date.now(), kind, ...(label ? { label } : {}) }))
  }
}

// ---------- The break screen's actions ----------

export const breakActions = {
  reprieve: (why: string, s: BreakSettings) => set(reprieve(settle(state, Date.now()), Date.now(), why, s)),
  skip: () => set(skipBreak(state, Date.now())),
  welcomed: () => set(dismissWelcome(state)),
  takeOffer: () => {
    if (!ui.offer) return
    const r = startBreak(state, profile, Date.now(), { minutes: ui.offer.minutes, studied: ui.offer.studied, line: ui.offer.line, why: 'window' })
    setUi({})
    set(r.state, r.profile)
  },
  keepGoing: () => {
    setUi({})
    set(snooze(state, Date.now()))
  },
  dismissHeadsUp: () => setUi({ ...ui, headsUp: undefined })
}

// ---------- Watching ----------

/** A question is mid-way: the tutor is replying (or speaking), or an answer is being typed */
let aiAt = 0
let typedAt = 0
function midQuestion(now: number): boolean {
  if (now - aiAt < 4000 || now - typedAt < 15_000) return true
  // An answer started and not sent
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null
  if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test((el as HTMLInputElement).type))) && el.closest('main') && el.value.trim()) return true
  return [...document.querySelectorAll<HTMLTextAreaElement>('main textarea')].some((t) => t.value.trim().length > 0 && t.offsetParent !== null)
}

export interface Studying {
  label: string
  noBreaks?: boolean
}

/** Watches activity while you study and acts on the plan: a heads-up, the offer, or the break */
export function useBreaks(ctx: Studying | null, settings: BreakSettings) {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const setRef = useRef(settings)
  setRef.current = settings

  useEffect(() => {
    let lastInput = Date.now()
    let quietNoted = 0
    const onInput = () => (lastInput = Date.now())
    const onKey = (e: KeyboardEvent) => {
      onInput()
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) {
        typedAt = Date.now()
        keys++
        if (e.key === 'Backspace' || e.key === 'Delete') backspaces++
      }
    }
    let moveAt = 0
    const onMove = () => {
      const now = Date.now()
      if (now - moveAt > 5000) (moveAt = now), onInput()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onInput, true)
    window.addEventListener('wheel', onMove, { capture: true, passive: true })
    window.addEventListener('mousemove', onMove, true)
    // The tutor replying or speaking counts as studying, and as a question mid-way
    const offAi = window.tide.ai.onEvent(() => {
      aiAt = Date.now()
      onInput()
    })

    let wasOnBreak = onBreak(state, Date.now())
    const tick = () => {
      const now = Date.now()
      const c = ctxRef.current
      const conf = setRef.current
      let s = settle(state, now)
      let p = profile
      if (!onBreak(s, now) && c) {
        const quiet = now - lastInput
        if (quiet < 20_000) s = active(s, now)
        // Here, in front of Tide, reading without touching anything: still studying
        else if (document.hasFocus() && s.blockStart && quiet < 10 * 60_000) {
          if (quiet >= IDLE_GAP_MS && quietNoted !== lastInput) {
            quietNoted = lastInput
            s = { ...s, idleGaps: [...(s.idleGaps ?? []), lastInput].slice(-20) }
          }
          s = { ...s, lastActive: now }
        }
        s = noteFatigue(s, now, p)
      }
      p = noteAfter(p, s, now)
      const d = decide(s, now, conf, { midQuestion: midQuestion(now), noBreaks: c?.noBreaks || !c }, p)
      if (d.kind === 'heads-up') {
        s = headsUpGiven(s)
        setUi({ ...ui, headsUp: d.line })
      } else if (d.kind === 'offer' && !ui.offer) setUi({ ...ui, offer: { studied: Math.round(d.studied), minutes: d.minutes, line: d.line }, headsUp: undefined })
      else if (d.kind === 'take') {
        const r = startBreak(s, p, now, { minutes: d.minutes, studied: d.studied, line: d.line, fatigue: d.fatigue, why: d.why, skippable: d.skippable })
        s = r.state
        p = r.profile
        setUi({})
      }
      const nowOn = onBreak(s, now)
      if (wasOnBreak && !nowOn && s.welcome && document.hidden) {
        try {
          new Notification('Tide', { body: 'Break’s over. Come back when you’re ready.', silent: true })
        } catch {
          // Notifications off
        }
      }
      wasOnBreak = nowOn
      if (s !== state || p !== profile) set(s, p)
    }
    tick()
    const timer = setInterval(tick, 5000)
    // Dev only: lets test tooling see and drive it
    if (import.meta.env.DEV)
      (window as unknown as { __breaks: unknown }).__breaks = {
        get: () => ({ state, profile, ui }),
        set: (s: Partial<BlockState>) => set({ ...state, ...s }),
        take: (minutes = 5, studied = 62, line = "You've studied for 62 minutes straight. A short rest now will help it stick.") => {
          const r = startBreak({ ...state, blockStart: state.blockStart || Date.now() - studied * 60_000 }, profile, Date.now(), { minutes, studied, line, why: 'window' })
          set(r.state, r.profile)
        },
        headsUp: (line = "Tea in about 10 minutes. I'll stop at the end of the question you're on.") => setUi({ headsUp: line }),
        tick
      }
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onInput, true)
      window.removeEventListener('wheel', onMove, true)
      window.removeEventListener('mousemove', onMove, true)
      offAi()
    }
  }, [])
}
