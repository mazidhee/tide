/**
 * Checking what you already know before a section is taught: a short placement quiz (hardest
 * first, a few questions), after which each topic is known (ticked off, no lesson), shaky (a short
 * refresher instead of a lesson) or new (taught as usual). Tutors test out what you know and teach
 * the edge; a 450-topic test up front would be a slog, so it's one section at a time, as each
 * comes up in your week.
 */

export type Known = 'known' | 'shaky' | 'new'

export interface PlacementTopic {
  id: string
  title: string
}

/** What a Check item carries: the section and its topics still to learn */
export interface PlacementSetup {
  notebook: string
  section: string
  sectionId: string
  topics: PlacementTopic[]
}

/** Kept in .tide/placement.json */
export interface PlacementStore {
  topics: Record<string, { state: Known; at: number }>
  /** Sections already checked, so each is checked once */
  sections: Record<string, number>
}

/** At most this many topics go into one check; a bigger section is checked in parts */
export const PLACEMENT_TOPICS = 16

/** Questions in a check; after the last answer the tutor is told to write the result, so a check always ends */
export const PLACEMENT_QUESTIONS = 6

export function placementInstructions(p: PlacementSetup): string {
  const list = p.topics.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
  return `You are running a PLACEMENT CHECK on "${p.section}" (${p.notebook}): find out which of these topics the student already knows, so their plan can skip what they know and refresh what's rusty. They may have learned some of it years ago.
Topics:
${list}

- Ask at most ${PLACEMENT_QUESTIONS} questions, one at a time. Each tests using an idea, not reciting a definition, and may cover more than one topic.
- Start with the most advanced topics: a confident right answer there shows the basics before it are known too. After a miss, step down to the topic it rests on.
- Keep questions quick: choice when picking tests the idea well, short otherwise. Don't teach during the check: after each answer, a one-line grade and the next question.
- Stop as soon as it's clear. If the student says they don't know, or that they're new to this or learning it from scratch, that is not a wrong answer: don't grade it, don't explain the answer or make a flashcard from it, and don't ask more questions on topics that build on it. When they say they're starting from scratch, end the check there: every topic not already shown is new.
- At the end, write the result for every topic number, one per line, inside a placement tag:
<placement>
1: known
2: shaky
3: new
</placement>
known = answered right and sure, or clearly implied by a harder answer; shaky = partly right, unsure, or rusty; new = wrong, or nothing shows they know it.
Then <summary>what they can skip, what needs a refresher, and what they'll learn</summary> and no ask tag. When nothing is known or shaky, the summary says plainly that they'll start at the beginning and names the first topic: no "you can skip nothing".`
}

/** The result of a check, by topic id; topics the tutor left out count as new */
export function parsePlacement(reply: string, topics: PlacementTopic[]): Record<string, Known> | null {
  const block = reply.match(/<placement>([\s\S]*?)<\/placement>/i)?.[1]
  if (!block) return null
  const out: Record<string, Known> = {}
  for (const m of block.matchAll(/(\d+)\s*[:.)-]\s*(known|shaky|new)\b/gi)) {
    const t = topics[Number(m[1]) - 1]
    if (t && !out[t.id]) out[t.id] = m[2].toLowerCase() as Known
  }
  if (!Object.keys(out).length) return null
  for (const t of topics) out[t.id] ??= 'new'
  return out
}

export const REFRESH_RULES = `This is a REFRESHER: the student learned this before and is rusty. Don't teach from scratch.
- Start straight away with one quick problem on the core of it.
- Explain only what they get wrong or can't recall, briefly, then another problem like it.
- Two or three problems in all, the last a little harder. Then <summary>what came back and anything still shaky</summary> and no ask tag.`

/** The hidden note for a check's turn: from the last allowed answer on, write the result now */
export function placementNote(answersSoFar: number): string | null {
  return answersSoFar + 1 >= PLACEMENT_QUESTIONS ? '(Tide: that was the last question of the check. Mark this answer in one line, then write the <placement> result for every topic and the <summary>, and ask nothing more.)' : null
}
