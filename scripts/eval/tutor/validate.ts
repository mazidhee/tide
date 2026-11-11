/**
 * Checks the benchmark itself, with no model: every scenario is well formed, its request builds
 * from the app's prompt code, its "good" reply passes every deterministic check (so the scenario
 * can be passed), and each "bad" reply trips the checks it names (so the scorer notices). Run by
 * `run.ts --dry-run` and by the tests.
 */
import { buildMessages } from './request'
import { scoreReply } from './score'
import { ALL_SITUATIONS, ALL_SUBJECTS, HUMANITIES_SITUATIONS, HUMANITIES_SUBJECTS, SITUATIONS, SUBJECTS, type Scenario } from './types'

export const MIN_SCENARIOS = 60
const STRATEGIES = [undefined, 'problems', 'dialogue', 'maths', 'code']

export function validateScenario(s: Scenario): string[] {
  const problems: string[] = []
  const say = (m: string) => problems.push(`${s.id}: ${m}`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s.id)) say('id must be lower-case words joined by hyphens')
  if (!ALL_SUBJECTS.includes(s.subject)) say(`unknown subject ${s.subject}`)
  if (!ALL_SITUATIONS.includes(s.situation)) say(`unknown situation ${s.situation}`)
  // The humanities are measured in their own situations, and those are theirs alone
  const human = (HUMANITIES_SUBJECTS as readonly string[]).includes(s.subject)
  const humanSituation = (HUMANITIES_SITUATIONS as readonly string[]).includes(s.situation)
  if (humanSituation && !human) say(`${s.situation} is a humanities situation`)
  if (s.discuss && s.situation !== 'close-reading' && s.situation !== 'spoiler-trap') say('a discussion is a close reading or a spoiler trap')
  if (s.situation === 'close-reading' && !s.discuss) say('a close reading is a Discuss this turn: give `discuss`')
  if ((s.situation === 'close-reading' || s.situation === 'appraise-reading' || s.situation === 'contested') && s.expect.verdict) say('a reading or a contested question is never given a verdict')
  if (s.situation === 'contested' && !s.expect.contested) say('a contested question needs `contested: true`')
  if (s.situation === 'appraise-reading' && !s.expect.appraise) say('an appraisal needs `appraise: true`')
  if (s.situation === 'spoiler-trap' && !s.expect.spoilers?.length) say('a spoiler trap needs `spoilers`: the names it must not use')
  if (s.situation === 'cited-reply' && !s.expect.quote) say('a cited reply needs `quote: true`')
  if (s.situation === 'fact-date' && !s.expect.verdict) say('a fact or a date is marked: give its true verdict')
  if (!s.setup?.topic) say('no topic')
  // Ways of teaching that need the canvas, the terminal or a book can't be measured without the app
  if (!STRATEGIES.includes(s.setup.options?.strategy)) say(`strategy ${s.setup.options?.strategy} needs tools the benchmark doesn't have`)

  const opening = s.situation === 'open' || s.situation === 'recall-open'
  if (opening !== (s.history.length === 0)) say(opening ? 'an opening has no history' : 'needs the conversation so far')
  s.history.forEach((t, i) => {
    if (('tutor' in t) !== (i % 2 === 0)) say(`turn ${i + 1} is out of order: the tutor speaks first, then they alternate`)
    if ('tutor' in t && !t.tutor.trim()) say(`turn ${i + 1} is empty`)
  })
  const last = s.history[s.history.length - 1]
  if (s.history.length && !('learner' in last)) say('the conversation must end with the learner')
  const said = last && 'learner' in last ? last.learner : null
  const marks = s.situation === 'after-correct' || s.situation === 'after-wrong' || s.situation === 'mark-planted-error' || s.situation === 'mark-unusual-correct' || s.situation === 'fact-date'
  if (marks && !(said && 'answer' in said)) say('ends with something other than an answer to mark')
  if (marks && !s.expect.verdict) say('no true verdict given')
  if (s.situation === 'after-correct' && s.expect.verdict !== 'correct') say('after-correct needs verdict correct')
  if (s.situation === 'mark-unusual-correct' && s.expect.verdict !== 'correct') say('an unusual but correct answer is correct')
  if ((s.situation === 'after-wrong' || s.situation === 'mark-planted-error') && s.expect.verdict === 'correct') say('the answer here is not right')
  if ((s.situation === 'after-wrong' || s.situation === 'mark-planted-error') && !s.expect.names?.length) say('needs `names`: what the feedback must point at')
  if (s.situation === 'code-bug' && !s.expect.names?.length) say('needs `names`: the bug the reply must point at')
  if (s.expect.verdict && s.expect.verdict !== 'correct' && s.expect.accept?.includes('correct')) say('"correct" can never be accepted for an answer that is not right')
  if (s.situation === 'idk' && !(said && 'idk' in said)) say('ends with something other than "I don\'t know"')
  // Show me is the button; a chart or a simulation is asked for in the learner's own words
  if (s.situation === 'show-me' && !(said && ('showMe' in said || 'question' in said))) say('ends with something other than Show me or a request to see it')
  if (s.situation === 'show-me' && !s.expect.visual) say('a request to see something expects a visual')
  if (said && 'showMe' in said && s.expect.ends !== 'nothing') say('the Show me button expects no question')
  if (s.situation === 'tangent' && !(said && 'question' in said)) say('a tangent ends with the learner\'s own question')
  if (s.situation === 'recall-open' && s.setup.mode !== 'recall') say('a recall opening uses mode recall')
  if (s.situation === 'code-bug' && !s.history.some((t) => ('tutor' in t ? t.tutor : 'answer' in t.learner ? t.learner.answer : '').includes('```'))) say('a code question needs code in the conversation')
  if (!marks && s.situation !== 'code-bug' && s.situation !== 'idk' && s.expect.verdict) say('a verdict where nothing is being marked')
  if (s.situation === 'fact-date' && s.expect.verdict !== 'correct' && !s.expect.names?.length) say('needs `names`: the right fact the feedback must give')

  for (const p of [...(s.expect.names ?? []), ...(s.expect.must ?? []), ...(s.expect.mustNot ?? []), ...(s.expect.askMustNot ?? [])]) {
    try {
      new RegExp(p, 'i')
    } catch {
      say(`not a regular expression: ${p}`)
    }
  }
  if (problems.length) return problems

  try {
    const messages = buildMessages(s)
    if (messages[messages.length - 1].role !== 'user') say('the request does not end with the learner')
    if (!s.discuss && !messages[1].content.startsWith('How to tutor me here:')) say('the lesson instructions are missing from the first message')
    // The app's hidden notes for this turn bind the reply too: the expectations must agree with them
    const note = messages[messages.length - 1].content
    if (/End your reply with a <note>|add it in a <note>/.test(note) && s.situation !== 'show-me' && !s.expect.need?.includes('note')) say('Tide asks for a <note> on this turn: add need: [\'note\']')
    if (/ask nothing, and end with <continue\/>/.test(note) && s.expect.ends !== 'continue') say('Tide asks for <continue/> on this turn')
  } catch (e) {
    say(`request could not be built: ${(e as Error).message}`)
  }

  if (!s.good?.trim()) say('no good reply')
  else {
    const g = scoreReply(s, s.good)
    if (!g.pass) say(`its good reply fails: ${g.failed.join(', ')}${g.pace.score < 1 ? ` (${g.pace.words} words, allowed ${g.pace.min} to ${g.pace.max})` : ''}${g.visual?.why ? ` (${g.visual.why})` : ''}`)
  }
  for (const [i, b] of (s.bad ?? []).entries()) {
    const { failed, repaired } = scoreReply(s, b.reply)
    const missed = b.fails.filter((f) => !failed.some((id) => id === f || id.startsWith(`${f}:`)))
    if (missed.length) say(`bad reply ${i + 1} should fail ${missed.join(', ')} but failed only: ${failed.join(', ') || 'nothing'}`)
    const unrepaired = (b.repaired ?? []).filter((r) => !repaired.includes(r))
    if (unrepaired.length) say(`bad reply ${i + 1} should need the app's repair of ${unrepaired.join(', ')} but needed only: ${repaired.join(', ') || 'none'}`)
  }
  return problems
}

export function validateSet(all: Scenario[]): { problems: string[]; grid: Record<string, Record<string, number>> } {
  const problems = all.flatMap(validateScenario)
  const ids = new Set<string>()
  for (const s of all) {
    if (ids.has(s.id)) problems.push(`${s.id}: id used twice`)
    ids.add(s.id)
  }
  if (all.length < MIN_SCENARIOS) problems.push(`only ${all.length} scenarios; at least ${MIN_SCENARIOS} wanted`)
  const grid = Object.fromEntries(SUBJECTS.map((sub) => [sub, Object.fromEntries(SITUATIONS.map((sit) => [sit, all.filter((s) => s.subject === sub && s.situation === sit).length]))]))
  for (const sub of SUBJECTS) for (const sit of SITUATIONS) if (!grid[sub][sit]) problems.push(`no ${sit} scenario for ${sub}`)
  return { problems, grid }
}
