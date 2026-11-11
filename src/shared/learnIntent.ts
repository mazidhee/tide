import { readIntent } from './readingPlan'

/**
 * Spots "I want to learn X" in what the learner types, so a request to be taught a whole subject
 * starts a study plan instead of a one-off chat answer. Done in code: it must be reliable.
 * Questions about a thing ("what is X", "explain X") are not plans and are left alone.
 */

const PATTERNS = [
  /^(?:i(?:\s+(?:want|would like|need|wanna)|['’]d like)\s+to\s+(?:learn|master|study|understand|get good at|become (?:an? )?expert (?:in|at)))\s+(?:about\s+|how\s+to\s+)?(.+?)(?:[,.;!]\s*(?:please\s+)?(?:teach me|help me|make me a plan|plan it)?.*)?$/i,
  /^(?:teach me|help me learn|help me master|make me (?:a )?(?:study )?(?:plan|roadmap) (?:for|to learn)|plan (?:how|for) me to learn|create a (?:learning )?roadmap (?:for|to learn))\s+(?:about\s+|how\s+to\s+)?(.+?)(?:[.!]\s*.*)?$/i,
  /^(?:how (?:do|can|should) i (?:learn|master|get good at))\s+(.+?)\??$/i
]

export function learnIntent(text: string): { topic: string; goal: string } | null {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length > 400 || t.split(' ').length < 3) return null
  // humanities: "I want to read X" is a plan too: the book's chapters are its topics (shared/readingPlan)
  const read = readIntent(t)
  if (read) return { topic: read.title.charAt(0).toUpperCase() + read.title.slice(1), goal: t }
  // Your own Metabase is taught by the tutor, which can look inside it, not as a new roadmap
  if (/\b(our|my|rank'?s|company'?s|work'?s)\b.{0,24}\bmetabase\b/i.test(t) || (/\bmetabase\b/i.test(t) && /\b(dashboards?|questions?|tables?|quer(y|ies)|collections?|charts?)\b/i.test(t))) return null
  for (const re of PATTERNS) {
    const m = t.match(re)
    if (!m) continue
    let topic = m[1]
      .replace(/[,;]\s*(?:teach me|and teach me|please).*$/i, '')
      .replace(/\s+(?:please|teach me)$/i, '')
      .replace(/[.!?]+$/, '')
      .trim()
    // "how to build a local LLM from scratch" keeps its verb; "about stablecoins" doesn't need "about"
    if (/^(build|make|write|design|run|trade|deploy|create)\b/i.test(topic)) topic = `How to ${topic}`
    if (topic.length < 2 || topic.length > 120) continue
    return { topic: topic.charAt(0).toUpperCase() + topic.slice(1), goal: t }
  }
  return null
}

/**
 * Whether a message asks for work set in (or marked from) Things 4. The app's name is also an
 * everyday word ("a few things", "the things I got wrong"), so it only counts when it's clearly
 * the app: "Things 4", "in Things", "to my Things".
 */
export function thingsIntent(text: string): 'assign' | 'mark' | null {
  const app = /\bthings\s*(?:4|app)\b|\b(?:in|into|to|on|via|through|from|my)\s+(?:my\s+)?things\b(?!\s+(?:i|you|we|that|like|about|to)\b)/i.test(text)
  const work = /\b(to-?do|assign(?:ment)?|homework|take-?home|problem set)\b|\bset me (?:a|an|some)\b|\bgive me (?:a|an|some) (?:task|assignment|test|homework|take-?home|problem set)\b/i.test(text)
  if (!app && !work) return null
  return /\b(mark|grade|check|review|feedback|look at)\b/i.test(text) ? 'mark' : 'assign'
}

/**
 * "I want to build X": a project to build yourself, not a subject to study. Starts a build project
 * (a notebook with a brief) rather than a study plan. "I want to learn how to build X" stays a plan.
 */
export function projectIntent(text: string): { name: string; idea: string } | null {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length > 400) return null
  const m = t.match(/^(?:i(?:\s+(?:want|would like|need|wanna|plan|['’]m going)|['’]d like)\s+to\s+build|let['’]?s build|help me build|i['’]m building)\s+(.+?)$/i)
  if (!m) return null
  const idea = m[1].replace(/[.!]+$/, '').trim()
  // A short name for the notebook: the thing itself, before "for/that/which/with/so/to"
  const thing = idea
    .replace(/^(an?|the|my|our|some)\s+/i, '')
    .split(/\s+(?:for me|that|which|so that|so|to (?:learn|understand|practi[cs]e)|because)\b/i)[0]
    .split(/[,:;(]/)[0]
    .split(' ')
    .slice(0, 6)
    .join(' ')
    .replace(/[^\p{L}\p{N}+#\- ]/gu, '')
    .trim()
  if (thing.length < 2) return null
  return { name: thing.charAt(0).toUpperCase() + thing.slice(1), idea: t }
}
