/**
 * A study plan: how big the subject really is, the phases to get there, and the dates. The model
 * decides the size and phases (with calibration, so a tool takes weeks and a field takes years);
 * the dates are worked out here, in code, from the start date and the weeks per phase.
 */

import type { SubjectKind } from './subjectMap'

export type PlanScope = 'tool' | 'skill' | 'discipline' | 'career'

export interface PlanPhase {
  title: string
  weeks: number
  /** What you can do at the end of it */
  outcome: string
  /** A project that proves it */
  project?: string
  /** Two or three exercises to practise along the way */
  practice?: string[]
}

export interface StudyPlan {
  scope: PlanScope
  weeks: number
  hoursPerWeek: number
  /** Why this long, in a sentence or two */
  why: string
  phases: PlanPhase[]
  /** Whether the practice is programming (then exercises also become coding challenges) */
  coding?: boolean
  /** What kind of knowledge the subject is (src/shared/subjects.ts), kept in the roadmap as subject_kinds */
  subject?: SubjectKind[]
}

export interface DatedPhase extends PlanPhase {
  start: string
  end: string
}

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Realistic total weeks for each kind of subject, at 6 hours a week */
export const SCOPE_WEEKS: Record<PlanScope, [number, number]> = {
  tool: [1, 4],
  skill: [4, 17],
  discipline: [26, 78],
  career: [104, 208]
}

/** Cleans a model's plan: sane numbers, at least one phase, phase weeks that add up to the total */
export function normalizePlan(raw: Partial<StudyPlan> | null, hoursPerWeek: number, maxWeeks?: number, exactWeeks?: number): StudyPlan | null {
  if (!raw || !Array.isArray(raw.phases)) return null
  const phases = raw.phases
    .filter((p) => p && typeof p.title === 'string' && p.title.trim())
    .slice(0, 12)
    .map((p) => ({
      title: p.title.trim().replace(/^phase\s*\d+\s*[:.-]\s*/i, '').slice(0, 80),
      weeks: Math.max(0.5, Math.min(104, Number(p.weeks) || 1)),
      outcome: String(p.outcome ?? '').trim().slice(0, 300),
      ...(p.project && String(p.project).trim() ? { project: String(p.project).trim().slice(0, 300) } : {}),
      ...(Array.isArray(p.practice) && p.practice.length
        ? { practice: p.practice.map((x) => String(x).trim().replace(/^practice:\s*/i, '').slice(0, 240)).filter(Boolean).slice(0, 4) }
        : {})
    }))
  if (!phases.length) return null
  const proposed = phases.reduce((n, p) => n + p.weeks, 0)
  const scope = (['tool', 'skill', 'discipline', 'career'] as const).find((s) => s === raw.scope) ?? (proposed <= 6 ? 'tool' : proposed <= 16 ? 'skill' : proposed <= 78 ? 'discipline' : 'career')
  // Keep the total inside what this kind of subject really takes at these hours (models pad a lot),
  // and inside the learner's deadline; phases keep their proportions
  const pace = 6 / Math.max(1, hoursPerWeek)
  // Models mostly pad, so the ceiling is firm; the floor is looser (a learner with a head start can be
  // quicker), except for a whole career from scratch
  const [lo, hi] = SCOPE_WEEKS[scope].map((w, i) => w * pace * (i === 0 && scope !== 'career' ? 0.6 : 1))
  let target = Math.min(Math.max(proposed, lo), hi)
  if (maxWeeks && maxWeeks > 0) target = Math.min(target, maxWeeks)
  // A length the learner asked for outright wins over the typical range for the subject
  if (exactWeeks && exactWeeks > 0) target = exactWeeks
  const k = target / proposed
  const scaled = phases.map((p) => ({ ...p, weeks: Math.max(0.5, Math.round(p.weeks * k * 2) / 2) }))
  const weeks = Math.round(scaled.reduce((n, p) => n + p.weeks, 0) * 2) / 2
  const why = String(raw.why ?? '').trim().slice(0, 600)
  const resized = !exactWeeks && Math.abs(weeks - proposed) / proposed > 0.3 ? ` Sized to ${planLength(weeks)} for this kind of subject at ${hoursPerWeek} hours a week.` : ''
  return { scope, weeks, hoursPerWeek, why: (why + resized).trim(), phases: scaled, ...(raw.coding === true || String(raw.coding) === 'true' ? { coding: true } : {}) }
}

/**
 * The same plan at different hours, or squeezed into a deadline: the study hours stay the same and
 * the phases keep their proportions. Instant, so the pills on the plan can answer as you change them.
 */
export function rescalePlan(plan: StudyPlan, change: { hoursPerWeek?: number; weeks?: number }): StudyPlan {
  const total = plan.weeks * plan.hoursPerWeek
  const hoursPerWeek = Math.max(1, Math.min(60, Math.round(change.weeks ? total / Math.max(1, change.weeks) : (change.hoursPerWeek ?? plan.hoursPerWeek))))
  const weeks = change.weeks ?? total / hoursPerWeek
  const k = weeks / plan.weeks
  const phases = plan.phases.map((p) => ({ ...p, weeks: Math.max(0.5, Math.round(p.weeks * k * 2) / 2) }))
  return { ...plan, hoursPerWeek, phases, weeks: Math.round(phases.reduce((n, p) => n + p.weeks, 0) * 2) / 2 }
}

/** Gives each phase its dates, back to back from the start (inclusive start and end days) */
export function datePhases(plan: StudyPlan, start: string): DatedPhase[] {
  let t = new Date(start + 'T12:00:00Z').getTime()
  return plan.phases.map((p) => {
    const days = Math.max(1, Math.round(p.weeks * 7))
    const phase = { ...p, start: iso(t), end: iso(t + (days - 1) * DAY) }
    t += days * DAY
    return phase
  })
}

/** "9 Nov", or "29 Jan 2028" when it isn't this year */
export const shortDate = (d: string, now = new Date()) => {
  const date = new Date(d + 'T12:00:00Z')
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

/** "3 weeks", "4 months", "1.5 years" */
export function planLength(weeks: number): string {
  if (weeks < 10) return `${weeks} week${weeks === 1 ? '' : 's'}`
  if (weeks < 78) return `${Math.round(weeks / 4.35)} months`
  const years = Math.round((weeks / 52) * 2) / 2
  return `${years} year${years === 1 ? '' : 's'}`
}

/**
 * Puts the dates into a drafted roadmap: each "## Phase n: …" heading gets its date range, and
 * each phase ends with its exam on the phase's last day. Phases are matched in order.
 */
export function addPlanDates(outline: string, phases: DatedPhase[]): string {
  let n = -1
  const lines = outline.split('\n')
  const out: string[] = []
  const closePhase = () => {
    if (n < 0 || !phases[n]) return
    const p = phases[n]
    // Drop trailing blank lines so the exam sits with the phase
    while (out.length && !out[out.length - 1].trim()) out.pop()
    // The phase's exercises go before its project and exam (or at the end if those are missing)
    const practice = (p.practice ?? []).filter((x) => !out.some((l) => l.includes(x))).map((x) => `- [ ] Practice: ${x}`)
    if (practice.length) {
      const at = (() => {
        for (let i = out.length - 1; i >= Math.max(0, out.length - 6); i--) if (!/^- \[ \] (Project|Exam):/.test(out[i])) return i + 1
        return out.length
      })()
      out.splice(at, 0, ...practice)
    }
    if (!out.slice(-12).some((l) => /^- \[ \] Exam:/.test(l))) out.push(`- [ ] Exam: ${p.title} (by ${shortDate(p.end)})`)
    out.push('')
  }
  for (const line of lines) {
    if (/^##\s(?!#)/.test(line)) {
      closePhase()
      n++
      const p = phases[n]
      const title = line.replace(/^##\s+/, '').replace(/\s*\((weeks?|by)\b[^)]*\)\s*$/i, '').replace(/\s+[—–-]\s+\d{1,2} \w{3}.*$/, '')
      out.push(p ? `## ${title} — ${shortDate(p.start)} to ${shortDate(p.end)}` : line)
      continue
    }
    // An exam line the model wrote gets the phase's date
    if (n >= 0 && phases[n] && /^- \[ \] Exam:/.test(line) && !/\(by /.test(line)) {
      out.push(`${line.trimEnd()} (by ${shortDate(phases[n].end)})`)
      continue
    }
    out.push(line)
  }
  closePhase()
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ---------- The plan in the roadmap file ----------

/** Front matter that keeps a plan's dates with its roadmap: start, hours, weeks per phase */
export function planFrontmatter(plan: StudyPlan, start: string, extra: Record<string, string> = {}): string {
  const lines = [
    `plan_start: ${start}`,
    `plan_hours: ${plan.hoursPerWeek}`,
    `plan_weeks: [${plan.phases.map((p) => p.weeks).join(', ')}]`,
    // Subject hook (any-subject): the subject's kinds, decided once and kept with the roadmap
    ...(plan.subject?.length ? [`subject_kinds: ${plan.subject.join(', ')}`] : []),
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`)
  ]
  return `---\n${lines.join('\n')}\n---\n\n`
}

export interface StoredPlan {
  start: string
  hours: number
  weeks: number[]
  thingsProject?: string
}

export function readPlan(md: string): StoredPlan | null {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (!fm) return null
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim()
  const start = get('plan_start')
  const weeks = get('plan_weeks')
    ?.replace(/[[\]]/g, '')
    .split(',')
    .map(Number)
    .filter((n) => n > 0)
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !weeks?.length) return null
  return { start, hours: Number(get('plan_hours')) || 6, weeks, ...(get('things_project') ? { thingsProject: get('things_project') } : {}) }
}

export function setFrontmatterValue(md: string, key: string, value: string): string {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return `---\n${key}: ${value}\n---\n\n${md}`
  const body = new RegExp(`^${key}:.*$`, 'm').test(fm[1]) ? fm[1].replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`) : `${fm[1]}\n${key}: ${value}`
  return md.replace(fm[0], `---\n${body}\n---`)
}

export interface PlanPhaseTasks {
  heading: string
  start: string
  end: string
  chapters: { title: string; topics: string[] }[]
  practice: string[]
  project?: string
  exam?: string
}

/**
 * The roadmap's phases as task material: each ## phase (with its dates from the stored plan), its
 * ### chapters with their topics, and its project and exam lines.
 */
export function phasesForTasks(md: string, stored: StoredPlan, label: (text: string) => string): PlanPhaseTasks[] {
  const dated = datePhases({ scope: 'skill', weeks: 0, hoursPerWeek: stored.hours, why: '', phases: stored.weeks.map((w) => ({ title: '', weeks: w, outcome: '' })) }, stored.start)
  const out: PlanPhaseTasks[] = []
  let chapter: { title: string; topics: string[] } | null = null
  for (const line of md.replace(/^---[\s\S]*?\n---\n?/, '').split('\n')) {
    const h2 = line.match(/^##\s+(?!#)(.+)$/)
    if (h2) {
      const d = dated[out.length]
      if (!d) break
      out.push({ heading: h2[1].trim(), start: d.start, end: d.end, chapters: [], practice: [] })
      chapter = null
      continue
    }
    const phase = out[out.length - 1]
    if (!phase) continue
    const h3 = line.match(/^###\s+(.+)$/)
    if (h3) {
      chapter = { title: h3[1].trim(), topics: [] }
      phase.chapters.push(chapter)
      continue
    }
    const item = line.match(/^- \[[ xX]\] (.+)$/)
    if (!item) continue
    const text = item[1].trim()
    if (/^Practice:/i.test(text)) phase.practice.push(text.replace(/^Practice:\s*/i, ''))
    else if (/^Project:/i.test(text)) phase.project = text.replace(/^Project:\s*/i, '')
    else if (/^Exam:/i.test(text)) phase.exam = text
    else if (chapter) chapter.topics.push(label(text))
  }
  return out
}

/**
 * A reading list for a plan: the books, courses and docs from the roadmap, phase by phase, then
 * the pages Tide read while planning, with their links.
 */
export function readingList(topic: string, roadmap: string, sources: { title: string; url: string }[], suggested: { phase: string; items: { title: string; by?: string; why?: string; url?: string; unverified?: boolean }[] }[] = []): string {
  const out = [`# Reading list: ${topic}`, '', 'What to read for each phase, from your roadmap. Tick them off as you go.', '']
  let phase = ''
  const seen = new Set<string>()
  for (const line of roadmap.replace(/^---[\s\S]*?\n---\n?/, '').split('\n')) {
    const h = line.match(/^##\s+(?!#)(.+)$/)
    if (h) {
      phase = h[1].trim()
      continue
    }
    const r = line.match(/^\s+[-*]\s+_(.+)_\s*$/)
    if (!r || !phase) continue
    const item = r[1].trim()
    if (seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    if (!out.includes(`## ${phase}`)) out.push(`## ${phase}`, '')
    out.push(`- [ ] ${item}`)
  }
  // The dedicated readings step, phase by phase (matched to the roadmap's phase headings by order)
  const headings = [...roadmap.matchAll(/^##\s+(?!#)(.+)$/gm)].map((m) => m[1].trim())
  suggested.forEach((s, i) => {
    const fresh = s.items.filter((x) => !seen.has(x.title.toLowerCase()))
    if (!fresh.length) return
    const heading = `## ${headings[i] ?? s.phase}`
    const at = out.indexOf(heading)
    const lines = fresh.map((x) => {
      seen.add(x.title.toLowerCase())
      const title = x.url ? `[${x.title.replace(/[[\]]/g, '')}](${x.url})` : x.title
      return `- [ ] ${title}${x.by ? ` — ${x.by}` : ''}${x.why ? `: ${x.why}` : ''}${x.unverified ? ' _(not found online, check it)_' : ''}`
    })
    if (at < 0) out.push(heading, '', ...lines, '')
    else {
      let end = at + 2
      while (end < out.length && out[end].startsWith('- ')) end++
      out.splice(end, 0, ...lines)
    }
  })
  if (sources.length) out.push('', '## Pages used to plan this', '', ...sources.map((s) => `- [${s.title.replace(/[[\]]/g, '')}](${s.url})`))
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/**
 * What a request to change a plan says outright: "finish in 8 weeks", "in 3 months", "10 hours a
 * week". Those numbers are the learner's, so they're applied exactly rather than left to the model.
 */
export function planRequestNumbers(request: string): { weeks?: number; hoursPerWeek?: number } {
  const q = request.toLowerCase()
  const span = q.match(/\b(?:in|within|over|for|by|take|to)\s+(?:about\s+|around\s+|just\s+)?(\d+(?:\.\d+)?)\s*(weeks?|wks?|months?|mos?)\b/) ?? q.match(/\b(\d+(?:\.\d+)?)[- ](weeks?|months?)\s+(?:plan|course|instead)\b/)
  const hours = q.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s*(?:a|per|each|\/)\s*(?:week|wk)\b/)
  const n = span ? Number(span[1]) : 0
  return {
    ...(n > 0 ? { weeks: /^m/.test(span![2]) ? Math.round(n * 4.35 * 2) / 2 : n } : {}),
    ...(hours && Number(hours[1]) > 0 ? { hoursPerWeek: Math.min(60, Number(hours[1])) } : {})
  }
}
