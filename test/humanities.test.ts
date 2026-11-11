import { describe, expect, it } from 'vitest'
import { END, managedBlock, mergeNotesPage, notesPageFor, START, type ReadingItem } from '../src/shared/bookNotes'
import { checkDiscussReply, makesClaim, openingQuestion } from '../src/shared/closeReading'
import { APPRAISE_NOTE, CLOSE_READING_RULES, HUMANITIES_RULES, humanitiesArea, markingNote, markingStyle, parseAppraise, questionKind, settles, THEOLOGY_RULES, weakest, wordCount } from '../src/shared/humanities'
import { citations, locAnchor, parseAnchor, passageLink, quotesWithLocation } from '../src/shared/passage'
import { locate, noteUnits, termIndex } from '../src/shared/readTogether'
import { closeGrade, parseBlocks, sessionInstructions } from '../src/shared/session'

const APPRAISAL = `<appraise>
- Claim: strong — you say plainly that the "inner citadel" is a choice, not a mood
- Evidence: developing — you paraphrase Book IV but quote nothing
- Reasoning: strong — the steps follow
- Objection: missing — what of grief that is not chosen?
- Accuracy: n/a
</appraise>

Your strongest move is reading "take away your opinion" (ch. 4 ¶7) as a practice rather than a doctrine.

<ask type="explain">If grief is not chosen, what is left of the claim that harm is only opinion?</ask>`

describe('which kind of question it is', () => {
  it('tells facts from interpretation and contested questions', () => {
    expect(questionKind('In what year did Luther post the Ninety-five Theses?')).toBe('fact')
    expect(questionKind('Who was Marcus Aurelius’ adoptive father?')).toBe('fact')
    expect(questionKind('What does Ivan’s rebellion reveal about his view of suffering?')).toBe('interpretation')
    expect(questionKind('To what extent was the Reformation a political event?')).toBe('interpretation')
    expect(questionKind('Was Brutus right to kill Caesar?')).toBe('contested')
    expect(questionKind('Does God exist, on Aquinas’s arguments?')).toBe('contested')
    expect(markingStyle('When was the Peace of Augsburg?')).toBe('verdict')
    expect(markingStyle('Why does Alyosha kiss Ivan?')).toBe('appraise')
  })

  it('finds the humanities area of a topic, and leaves technical topics alone', () => {
    expect(humanitiesArea('Stoic ethics in Marcus Aurelius')).toBe('philosophy')
    expect(humanitiesArea('The history of the Reformation')).toBe('history')
    expect(humanitiesArea('Augustine on grace and the Psalms')).toBe('theology')
    expect(humanitiesArea('The causes of the First World War')).toBe('history')
    expect(humanitiesArea('Dostoevsky’s The Brothers Karamazov')).toBe('literature')
    for (const t of ['Proof of History in Solana', 'Git history and rebase', 'The sine function', 'Chapter 3 of DDIA: storage and retrieval', 'Character encodings']) expect(humanitiesArea(t), t).toBeNull()
  })
})

describe('the appraise block', () => {
  it('is parsed by parseBlocks into rows, beside the ask', () => {
    const blocks = parseBlocks(APPRAISAL)
    const a = blocks.find((b) => b.kind === 'appraise')
    expect(a && a.kind === 'appraise' && a.rows.map((r) => `${r.criterion}:${r.level}`)).toEqual(['Claim:strong', 'Evidence:developing', 'Reasoning:strong', 'Objection:missing', 'Accuracy:n/a'])
    expect(blocks.map((b) => b.kind)).toEqual(['appraise', 'text', 'ask'])
    expect(blocks.some((b) => b.kind === 'grade')).toBe(false)
  })

  it('stays hidden while it is being written, and an unclosed grade before it is closed', () => {
    expect(parseBlocks('Good.\n<appraise>\n- Claim: str').map((b) => b.kind)).toEqual(['text'])
    expect(closeGrade('<grade verdict="correct" score="1">1517 is right<appraise>- Claim: strong — x</appraise>')).toContain('1517 is right</grade>')
  })

  it('picks the weakest point to press on', () => {
    expect(weakest(parseAppraise(APPRAISAL.split('</appraise>')[0]))?.criterion).toBe('Objection')
    expect(parseAppraise('- Evidence: weak — none')[0].level).toBe('developing')
  })
})

describe('lesson rules for the humanities', () => {
  it('ride with a humanities lesson only, with theology’s rules for theology', () => {
    expect(sessionInstructions({ mode: 'teach', topic: 'Kant’s categorical imperative' })).toContain(HUMANITIES_RULES)
    expect(sessionInstructions({ mode: 'teach', topic: 'Kant’s categorical imperative' })).not.toContain(THEOLOGY_RULES)
    expect(sessionInstructions({ mode: 'teach', topic: 'The doctrine of grace in Augustine' })).toContain(THEOLOGY_RULES)
    expect(sessionInstructions({ mode: 'teach', topic: 'B-tree indexes' })).not.toContain('<appraise>')
  })

  it('are short (word counts reported)', () => {
    const counts = { humanities: wordCount(HUMANITIES_RULES), theology: wordCount(THEOLOGY_RULES), closeReading: wordCount(CLOSE_READING_RULES) }
    console.log('rule word counts', counts)
    expect(counts.humanities).toBeLessThan(200)
    expect(counts.theology).toBeLessThan(80)
    expect(counts.closeReading).toBeLessThan(140)
  })

  it('send the appraisal note with an answer to a question of interpretation, and the usual note otherwise', () => {
    const tutorAsks = (q: string) => `Right.\n<ask type="explain">${q}</ask>`
    expect(markingNote('(Tide: mark this first.)', tutorAsks('Why does Marcus begin with his debts to others?'), 'Marcus Aurelius, Meditations')).toBe(APPRAISE_NOTE)
    expect(markingNote('(Tide: mark this first.)', tutorAsks('In what year did Marcus become emperor?'), 'Marcus Aurelius, Meditations')).toBe('(Tide: mark this first.)')
    expect(markingNote('(Tide: mark this first.)', tutorAsks('Why is a B-tree shallow?'), 'B-trees')).toBe('(Tide: mark this first.)')
    expect(markingNote(null, tutorAsks('Why?'), 'Stoicism')).toBeNull()
  })

  it('notices a contested question presented as settled', () => {
    expect(settles('The correct interpretation is that Ivan is simply wrong.')).toBe(true)
    expect(settles('Readers divide here: some take Ivan as Dostoevsky’s voice, others as his target.')).toBe(false)
  })
})

describe('passages and places', () => {
  it('reads anchors and citations for every format', () => {
    expect(parseAnchor('loc=3.12')).toEqual({ kind: 'para', chapter: 3, para: 12 })
    expect(parseAnchor('page=41')).toEqual({ kind: 'page', page: 41 })
    expect(parseAnchor('para=7')).toEqual({ kind: 'text', para: 7 })
    expect(locAnchor({ kind: 'para', chapter: 2, para: 4 })).toBe('loc=2.4')
    expect(citations('as he says (ch. 2 ¶4), and on (p. 41)')).toEqual([{ kind: 'para', chapter: 2, para: 4 }, { kind: 'page', page: 41 }])
    expect(passageLink('Library/Books/Meditations.epub', { kind: 'para', chapter: 2, para: 4 })).toBe('[[Meditations.epub#loc=2.4|ch. 2 ¶4]]')
    expect(quotesWithLocation('He writes “begin the morning by saying to thyself” (ch. 2 ¶1).')).toEqual([{ quote: 'begin the morning by saying to thyself', loc: { kind: 'para', chapter: 2, para: 1 } }])
    expect(quotesWithLocation('He writes “begin the morning” somewhere.')).toEqual([])
  })

  it('places a selection in an article by paragraph, under its heading', () => {
    const units = noteUnits('---\ntitle: x\n---\n# On Love\n\nWhen love beckons to you, follow him.\n\n## On Marriage\n\nYou were born together, and together you shall be for evermore.')
    expect(units.map((u) => u.loc)).toEqual([{ kind: 'text', para: 1, heading: 'On Love' }, { kind: 'text', para: 2, heading: 'On Marriage' }])
    expect(locate(units, 'together you shall be')).toEqual({ kind: 'text', para: 2, heading: 'On Marriage' })
    expect(passageLink('Library/Books/The Prophet.md', units[1].loc)).toBe('[[The Prophet#On Marriage|¶2]]')
  })
})

describe('Discuss this', () => {
  it('opens by asking what they think, before saying anything', () => {
    expect(openingQuestion({ kind: 'page', page: 12 })).toMatch(/^<ask type="explain">Before I say anything: what do you think this passage \(p\. 12\) says/)
  })

  it('passes a reply that quotes with a place, challenges and asks one question', () => {
    const good = 'You take "the universe is change" (ch. 4 ¶3) as resignation. A Stoic might say it is the opposite: a reason to act now. <ask type="explain">What in the passage tells against reading it as resignation?</ask>'
    expect(checkDiscussReply(good, { loc: { kind: 'para', chapter: 4, para: 3 }, learnerClaimed: true }).problems).toEqual([])
  })

  it('sends back a lecture with a verdict and no quotation, and a settled contested question', () => {
    const bad = '<grade verdict="wrong" score="0">No.</grade> The correct interpretation is that Marcus means acceptance. <ask type="explain">See?</ask><ask type="short">And?</ask>'
    const problems = checkDiscussReply(bad, { loc: { kind: 'page', page: 3 }, learnerClaimed: true }).problems.join(' ')
    expect(problems).toMatch(/exactly one question/)
    expect(problems).toMatch(/settled/)
    expect(problems).toMatch(/never a verdict/)
    expect(problems).toMatch(/Quote the text/)
  })

  it('takes out what lies beyond their place in a story', () => {
    const index = termIndex([
      { loc: { kind: 'para', chapter: 1, para: 1 }, text: 'Almustafa waited for the ship. The people loved Almustafa.' },
      { loc: { kind: 'para', chapter: 2, para: 1 }, text: 'Then Almitra spoke. And Almitra asked of love.' }
    ])
    const reply = 'You read "waited for the ship" (ch. 1 ¶1) as longing. Almitra will test that. <ask type="explain">Longing for what?</ask>'
    const c = checkDiscussReply(reply, { loc: { kind: 'para', chapter: 1, para: 1 }, index, position: { kind: 'para', chapter: 1, para: 1 }, learnerClaimed: true })
    expect(c.text).not.toMatch(/Almitra/)
    expect(c.withheld).toBe(false)
  })

  it('knows a claim from a shrug', () => {
    expect(makesClaim('I think he means that the self is a fortress against fortune')).toBe(true)
    expect(makesClaim('I don’t know what this means at all')).toBe(false)
    expect(makesClaim('What does "ruling faculty" mean here?')).toBe(false)
  })
})

describe('the notes page', () => {
  const items: ReadingItem[] = [
    { kind: 'discussion', loc: { kind: 'para', chapter: 2, para: 1 }, text: 'Begin the morning by saying to thyself…', at: Date.UTC(2026, 10, 11), turns: [{ role: 'learner', text: 'He is preparing, not complaining.', kept: true }, { role: 'tutor', text: 'Why preparing?' }], conclusion: 'A rehearsal, not a resentment.' },
    { kind: 'highlight', loc: { kind: 'para', chapter: 1, para: 1 }, text: 'good morals and the government of my temper', color: 'green', note: 'Temper as something governed.', at: Date.UTC(2026, 10, 10) },
    { kind: 'bookmark', loc: { kind: 'para', chapter: 1, para: 3 }, text: 'From my mother, piety', at: Date.UTC(2026, 10, 10) }
  ]

  it('puts highlights, bookmarks, notes and discussions in reading order, each linked to its place', () => {
    const block = managedBlock('Library/Books/Meditations.epub', items)
    const order = ['loc=1.1', 'loc=1.3', 'loc=2.1'].map((a) => block.indexOf(a))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(block).toContain('### [[Meditations.epub#loc=1.1|ch. 1 ¶1]]')
    expect(block).toContain('_Highlighted in green, 2026-11-10_')
    expect(block).toContain('My note: Temper as something governed.')
    expect(block).toContain('Bookmark: From my mother, piety')
    expect(block).toContain('- **Me:** He is preparing, not complaining.')
    expect(block).toContain('_1 more turn in the discussion._')
    expect(block).toContain('**My conclusion:** A rehearsal, not a resentment.')
  })

  it('keeps the learner’s own writing and replaces only its own block', () => {
    expect(notesPageFor('Library/Books/Meditations.epub')).toBe('Library/Books/Meditations (Notes).md')
    expect(notesPageFor('Library/PDFs/Ethics.pdf')).toBe('Library/PDFs/Ethics (Notes).md')
    const first = mergeNotesPage(null, 'Library/Books/Meditations.epub', managedBlock('Library/Books/Meditations.epub', items.slice(1)))
    expect(first).toMatch(/^---\nsource: "\[\[Meditations\.epub\]\]"\n---\n\n# Notes on Meditations/)
    const mine = first.replace('# Notes on Meditations\n', '# Notes on Meditations\n\nMy own thoughts on Book I.\n') + '\nA line I wrote at the end.\n'
    const second = mergeNotesPage(mine, 'Library/Books/Meditations.epub', managedBlock('Library/Books/Meditations.epub', items))
    expect(second).toContain('My own thoughts on Book I.')
    expect(second).toContain('A line I wrote at the end.')
    expect(second.split(START).length).toBe(2)
    expect(second.split(END).length).toBe(2)
    expect(second).toContain('A rehearsal, not a resentment.')
  })
})

describe('the lesson check in the humanities', () => {
  it('sends back a verdict on a reading, and a contested question settled; leaves a fact’s verdict alone', async () => {
    const { humanitiesProblems, statesDates } = await import('../src/shared/humanities')
    const { makesClaims } = await import('../src/shared/lessonCheck')
    const asked = (q: string) => `<ask type="explain">${q}</ask>`
    expect(humanitiesProblems('The Brothers Karamazov', asked('Why does Ivan return his ticket?'), '<grade verdict="wrong" score="0">No.</grade> <ask type="explain">Try again?</ask>')[0]).toMatch(/appraise/)
    expect(humanitiesProblems('The Reformation', asked('In what year were the Theses posted?'), '<grade verdict="correct" score="1">1517, yes.</grade>')).toEqual([])
    expect(humanitiesProblems('Free will in Augustine', asked('Is it fair?'), 'The correct interpretation is plain.')[0]).toMatch(/settled/)
    expect(humanitiesProblems('Hash maps', asked('Why?'), '<grade verdict="wrong">x</grade>')).toEqual([])
    expect(statesDates('Luther posted them in 1517.')).toBe(true)
    expect(makesClaims('<grade verdict="correct" score="1">Yes: the Diet of Worms met in 1521.</grade>')).toBe(true)
  })
})
