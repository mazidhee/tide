/**
 * Teaching and marking in the humanities: philosophy, theology and religious studies, history and
 * literature. Most questions there have no single right answer, so a reading or an argument is
 * appraised against a short rubric (<appraise>) instead of being marked right or wrong; questions
 * that do have answers (a date, a name, what the text literally says) are still marked with
 * <grade>. Which is which is decided here, in code, from the question.
 */

export type HumanitiesArea = 'philosophy' | 'theology' | 'history' | 'literature'

const AREAS: [HumanitiesArea, RegExp][] = [
  ['theology', /\b(theolog\w*|religions?|religious|scriptures?|bible|biblical|gospels?|torah|talmud|qur['’]?an|koran|hadith|christian\w*|islam\w*|judaism|jewish|buddhis\w*|hindu\w*|upanishads?|bhagavad gita|patristic|church fathers|augustine|aquinas|luther|calvin|eucharist|trinity|sacraments?|monastic\w*|mysticism|salvation|atonement|prophets?|apostles?|psalms?|genesis|exodus|epistles?)\b/i],
  ['philosophy', /\b(philosoph\w*|ethics|metaphysic\w*|epistemolog\w*|ontolog\w*|stoic\w*|epicure\w*|plato|platonic|aristotle|socrat\w*|kant\w*|hume|descartes|spinoza|leibniz|nietzsche|hegel|kierkegaard|wittgenstein|utilitarian\w*|deontolog\w*|virtue ethics|existentialis\w*|phenomenolog\w*|free will|meditations|marcus aurelius|seneca|epictetus)\b/i],
  ['history', /\b(history of|historians?|historiograph\w*|historical (?:sources?|event|period|context)|medieval|middle ages|antiquity|renaissance|reformation|enlightenment|french revolution|russian revolution|industrial revolution|world war|cold war|civil war|colonialism|imperialism|dynasty|empire of|roman empire|byzantine|ottoman|victorian|tudors?|crusades?|primary sources?)\b/i],
  ['literature', /\b(literature|literary|novels?|novelists?|poems?|poetry|poets?|sonnets?|stanzas?|shakespeare|dostoevsky|tolstoy|chekhov|gogol|turgenev|pushkin|austen|dickens|george eliot|joyce|woolf|homer|iliad|odyssey|dante|milton|narrator|gibran|the prophet|karamazov|war and peace|anna karenina|crime and punishment|tragedy|the novel)\b/i]
]

/** Which humanities area a topic belongs to, if any (the first that matches: theology before philosophy before history) */
export function humanitiesArea(topic: string): HumanitiesArea | null {
  for (const [area, re] of AREAS) if (re.test(topic)) return area
  return null
}

export type QuestionKind = 'fact' | 'interpretation' | 'contested'

const FACT = /^\s*(?:\*\*[^*]*\*\*\s*)?(who\b|when\b|where\b|in (?:what|which) (?:year|century|city|country)|what (?:year|date|century)|which\b|name\b|how many\b|how long\b|what did .{1,60} (?:say|write|call)|what does the text (?:literally )?say|quote\b|list\b|put .{1,40} in order|date\b)/i
const CONTESTED = /\b(does god exist|existence of god|free will|problem of evil|is (?:it|this|that|he|she|they) (?:right|wrong|just|moral|immoral|justified|good)|was .{1,60} (?:justified|right|wrong|inevitable|necessary|to blame)|ought\b|should (?:we|one|he|she|they|i)\b|meaning of life|true religion|is .{1,40} true\b|who was to blame|the (?:real|main|chief|true) cause)/i
const OPEN = /\b(why\b|how does|how do|how far|what does .{1,80} (?:mean|reveal|suggest|show|imply|say about)|what do you (?:make|think)|do you (?:think|agree)|interpret\w*|significance|to what extent|assess|evaluate|argue|argument|compare|contrast|what would .{1,60} say|reading of|weigh|account for|in what sense|is .{1,60} convincing|explain why)\b/i

/**
 * What kind of question it is: one with an answer (a fact, a date, what the text says), one of
 * interpretation or argument, or a contested one (where thoughtful people and traditions disagree).
 * A question that is neither clearly is treated as interpretation: appraising a factual answer
 * costs little, marking a reading "wrong" costs a lot.
 */
export function questionKind(question: string): QuestionKind {
  const q = question.replace(/<[^>]+>/g, ' ').trim()
  if (CONTESTED.test(q)) return 'contested'
  if (OPEN.test(q)) return 'interpretation'
  if (FACT.test(q)) return 'fact'
  return 'interpretation'
}

/** Marked right or wrong, or appraised */
export const markingStyle = (question: string): 'verdict' | 'appraise' => (questionKind(question) === 'fact' ? 'verdict' : 'appraise')

export type AppraiseLevel = 'strong' | 'developing' | 'missing' | 'n/a'
export const CRITERIA = ['Claim', 'Evidence', 'Reasoning', 'Objection', 'Accuracy'] as const

export interface AppraiseRow {
  criterion: string
  level: AppraiseLevel
  note: string
}

/** The rows of an <appraise> block: "- Claim: strong — a clear position on…" */
export function parseAppraise(body: string): AppraiseRow[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .map((l) => l.match(/^\**([A-Za-z ]+?)\**\s*:\s*\**(strong|developing|missing|weak|n\/a|na|not applicable)\**\s*(?:[—–:-]\s*)?(.*)$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => {
      const raw = m[2].toLowerCase()
      const level: AppraiseLevel = raw === 'weak' ? 'developing' : raw === 'na' || raw === 'not applicable' ? 'n/a' : (raw as AppraiseLevel)
      return { criterion: m[1].trim(), level, note: m[3].trim() }
    })
}

/** The weakest row worth pressing on (missing before developing, in rubric order) */
export function weakest(rows: AppraiseRow[]): AppraiseRow | null {
  return rows.find((r) => r.level === 'missing') ?? rows.find((r) => r.level === 'developing') ?? null
}

/**
 * Words that present an open question as closed. Said of a reading or an argument, "the correct
 * interpretation is" is a verdict in disguise.
 */
export const SETTLES = /\b(the (?:correct|right|true|only) (?:interpretation|reading|answer|view|meaning)|the answer is (?:clearly|simply|obviously)|this (?:question )?is settled|definitively (?:shows|proves)|objectively (?:right|wrong|true|false)|there is no (?:real )?debate|everyone agrees|beyond (?:any )?dispute|is simply wrong)\b/i

export const settles = (text: string) => SETTLES.test(text)

// ---------- Lesson rules ----------

export const HUMANITIES_RULES = `This is a humanities subject. Mark by the kind of question:
- One with an answer (a date, a name, who did what, what the text literally says): mark it with <grade> as usual. Check facts and dates against the sources; say when a date is uncertain.
- One of interpretation or argument (what a passage means, why a character acts, whether an argument works): there is no single right answer, so never use <grade>. Use <appraise>, one line per criterion, each strong, developing, missing or n/a, with a short reason:
<appraise>
- Claim: … — a clear position
- Evidence: … — the text or a source, quoted with its location
- Reasoning: … — the steps follow
- Objection: … — meets a strong objection or another reading
- Accuracy: … — facts and dates right where they matter
</appraise>
  Then say what is strongest, and press on the weakest point with one question.
- Where scholars or traditions disagree, set out the main positions; never present a contested question as settled.
- Quote the text with its location: "…" (ch. 3 ¶12) or (p. 41).`

export const THEOLOGY_RULES = `On religion: describe each tradition's views accurately and in its own terms, citing its primary texts (book, chapter and verse, or the document and section). Keep description apart from opinion: give no view of your own on matters of faith unless asked, and then label it as your opinion. Prefer primary texts and scholarly references to devotional or polemical ones.`

/** How the tutor reads a passage with the learner: the "Discuss this" dialogue and the read-together discussion */
export const CLOSE_READING_RULES = `You are reading a passage closely with the learner, Socratically.
- First ask what they think it says and means; don't explain it first.
- Then, one question at a time: its underlying meaning, what the author assumes, how it connects to the rest of the work.
- Challenge their reading: ask why they think it and what in the text supports it. Offer a strong alternative reading or counter-argument and ask them to answer it.
- When you make a point, quote the text with its location.
- Say plainly when a question is contested; never settle it for them.
- Mark plain facts (who, when, what the text literally says) right or wrong; appraise readings and arguments with <appraise>, never with a verdict.
- Short turns: under 120 words, ending with one question in <ask type="explain">.`

/** The rules a lesson on this topic adds, if it is in the humanities */
export function humanitiesRules(topic: string): string {
  const area = humanitiesArea(topic)
  if (!area) return ''
  return area === 'theology' ? `${HUMANITIES_RULES}\n\n${THEOLOGY_RULES}` : HUMANITIES_RULES
}

/** Said to the tutor (hidden) with an answer to a question of interpretation: appraise it, don't mark it */
export const APPRAISE_NOTE = '(Tide: this answers a question of interpretation or argument. Respond with <appraise>, not <grade>: what is strongest, then one question pressing on the weakest point. If it is contested, say so.)'

/** The marking note for an answer, by the question it answers: null when the usual note stands */
export const appraiseNote = (question: string, topic: string): string | null => (humanitiesArea(topic) && markingStyle(question) === 'appraise' ? APPRAISE_NOTE : null)

/** A word count, for reporting the length of the rules */
export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length

/** The question a tutor's message ends on: the last ask tag's text */
export const lastAsk = (tutor: string) => [...tutor.matchAll(/<ask\b[^>]*>([\s\S]*?)<\/ask>/gi)].pop()?.[1]?.trim() ?? ''

/** The note to send with an answer in a lesson: the appraisal note when the question was one of interpretation in a humanities topic, else the usual one */
export const markingNote = (usual: string | null, lastTutor: string, topic: string): string | null => (usual ? (appraiseNote(lastAsk(lastTutor), topic) ?? usual) : null)

/**
 * What a lesson reply in the humanities must put right before the learner sees it (main/lessonGuard):
 * a reading or an argument marked right or wrong instead of appraised, or a contested question
 * presented as settled. Facts and dates are still marked, and checked against sources there.
 */
export function humanitiesProblems(topic: string, previousTutor: string, reply: string): string[] {
  if (!humanitiesArea(topic)) return []
  const out: string[] = []
  const asked = lastAsk(previousTutor)
  if (asked && markingStyle(asked) === 'appraise' && /<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/i.test(reply)) out.push('It marks an answer to a question of interpretation right or wrong: appraise it with <appraise> instead (what is strongest, then one question on the weakest point).')
  const prose = reply.replace(/<(ask|solution|check|note|card)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  if (settles(prose)) out.push('It presents a contested question as settled: set out the main positions instead.')
  return out
}

/** Dates and periods stated as fact: worth checking against the sources */
export const statesDates = (text: string) => /\b(1[0-9]{3}|20[0-2][0-9])\b|\b\d{1,2}(?:st|nd|rd|th) century\b|\b\d+\s?(?:BC|BCE|AD|CE)\b/.test(text)
