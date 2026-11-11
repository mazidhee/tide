import { describe, expect, it } from 'vitest'
import { fallbackQuestion, findSpoilers, guessKind, mergeRecord, newRecord, parseRecord, parseRecordUpdate, recap, recordToMarkdown, repairSpoilers, spoils, termIndex, withoutRecord, type TextUnit } from '../src/shared/readTogether'

const p = (chapter: number, para: number, text: string): TextUnit => ({ loc: { kind: 'para', chapter, para }, text })
const BOOK: TextUnit[] = [
  p(1, 1, 'Fyodor Pavlovitch was the father of three sons. Then he married again.'),
  p(1, 2, 'The town knew Fyodor Pavlovitch as a buffoon. Alyosha, the youngest, loved him anyway.'),
  p(2, 1, 'At the monastery the elder received them. It was said that Alyosha had come to stay with the elder.'),
  p(2, 2, 'The elder was called Zosima, and many came to see Zosima for his blessing.'),
  p(3, 1, 'Smerdyakov served at table. Some thought Smerdyakov listened too closely.'),
  p(3, 2, 'Then there was the matter of the money, which then became a quarrel.')
]
const INDEX = termIndex(BOOK)
const AFTER_CH1 = { kind: 'para', chapter: 1, para: 2 } as const

describe('first appearances', () => {
  it('finds names with where they first appear, and leaves out capitalised ordinary words', () => {
    expect(Object.keys(INDEX.first)).toEqual(expect.arrayContaining(['Fyodor', 'Pavlovitch', 'Fyodor Pavlovitch', 'Alyosha', 'Zosima', 'Smerdyakov']))
    expect(INDEX.first).not.toHaveProperty('Then')
    expect(INDEX.first).not.toHaveProperty('The')
    expect(INDEX.first.Zosima).toBeGreaterThan(INDEX.first.Alyosha)
  })
})

describe('spoilers', () => {
  it('finds names from later chapters and phrases that look ahead', () => {
    const f = findSpoilers('Alyosha is gentle. Zosima will later guide him, and by the end of the novel everything changes.', INDEX, AFTER_CH1)
    expect(f.terms).toEqual(['Zosima'])
    expect(f.future).toEqual(expect.arrayContaining(['will later', 'by the end of the novel']))
  })

  it('passes a reply that keeps to what has been read', () => {
    expect(spoils(findSpoilers('Fyodor Pavlovitch is called a buffoon (ch. 1 ¶2). What does Alyosha see in him?', INDEX, AFTER_CH1))).toBe(false)
  })

  it('counts a citation past their place as a spoiler', () => {
    expect(findSpoilers('As we read, "the elder received them" (ch. 2 ¶1).', INDEX, AFTER_CH1).future).toEqual(['ch. 2 ¶1'])
  })

  it('lets the next chapter’s title through for an orientation', () => {
    expect(findSpoilers('Next comes a chapter called Zosima.', INDEX, AFTER_CH1, 'Chapter 2: Zosima').terms).toEqual([])
  })

  it('takes out the sentences that spoil and keeps the rest', () => {
    const reply = 'You noticed the word "buffoon" (ch. 1 ¶2). That matters. Smerdyakov will matter more. <ask type="explain">Why does the narrator call him that?</ask>'
    const r = repairSpoilers(reply, findSpoilers(reply, INDEX, AFTER_CH1))
    expect(r.withheld).toBe(false)
    expect(r.text).not.toMatch(/Smerdyakov/)
    expect(r.text).toMatch(/buffoon[\s\S]*<ask/)
  })

  it('withholds a reply whose question spoils, or most of which does', () => {
    const q = 'Good. <ask type="explain">Why does Zosima bless him?</ask>'
    expect(repairSpoilers(q, findSpoilers(q, INDEX, AFTER_CH1)).withheld).toBe(true)
    const most = 'Zosima is wise. Smerdyakov is sly. Alyosha is kind. <ask type="explain">What next?</ask>'
    expect(repairSpoilers(most, findSpoilers(most, INDEX, AFTER_CH1)).withheld).toBe(true)
  })
})

describe('the record', () => {
  const update = `Good point.
<record>
- Characters: Alyosha — the youngest son, who loves his father (ch. 1 ¶2)
- Characters: Zosima — an elder (ch. 2 ¶2)
- Open questions: Why a buffoon? — the town's word, not the narrator's (ch. 1 ¶2)
</record>`

  it('reads the tutor’s additions and keeps only those within what has been read', () => {
    const ups = parseRecordUpdate(update)
    expect(ups.map((u) => `${u.section}/${u.entry.name}`)).toEqual(['Characters/Alyosha', 'Characters/Zosima', 'Open questions/Why a buffoon?'])
    const { record, refused } = mergeRecord(newRecord('Books/K.epub', 'K', 'story'), ups, INDEX, AFTER_CH1)
    expect(refused).toEqual(['Zosima'])
    expect(record.sections.Characters.map((e) => e.name)).toEqual(['Alyosha'])
    expect(withoutRecord(update)).toBe('Good point.')
  })

  it('round-trips through Markdown, keeping locations and sessions', () => {
    const { record } = mergeRecord(newRecord('Books/K.epub', 'The Brothers', 'story'), parseRecordUpdate(update), INDEX, AFTER_CH1)
    const r = { ...record, position: AFTER_CH1, reached: 'Chapter 1: The Father', updated: '2026-11-04', sessions: [{ date: '2026-11-04', text: 'Chapter 1 discussed: the father as buffoon.' }] }
    const md = recordToMarkdown(r)
    expect(md).toMatch(/^---\nbook: "\[\[K\.epub\]\]"/)
    expect(md).toContain('- **Alyosha** — the youngest son, who loves his father (ch. 1 ¶2)')
    const back = parseRecord(md, 'Books/K.epub')
    expect(back.position).toEqual(AFTER_CH1)
    expect(back.sections.Characters[0]).toEqual({ name: 'Alyosha', note: 'the youngest son, who loves his father', loc: AFTER_CH1 })
    expect(back.sessions).toEqual(r.sessions)
  })

  it('recaps from the record alone', () => {
    const { record } = mergeRecord(newRecord('Books/K.epub', 'The Brothers', 'story'), parseRecordUpdate(update), INDEX, AFTER_CH1)
    const text = recap({ ...record, position: AFTER_CH1, reached: 'Chapter 1: The Father', updated: '2026-11-04', sessions: [{ date: '2026-11-04', text: 'the father as buffoon.' }] }, '2026-11-11')
    expect(text).toMatch(/^You stopped at Chapter 1: The Father \(ch\. 1 ¶2\) on 2026-11-04\. Characters: Alyosha\. Still open: Why a buffoon\?/)
    expect(text).not.toMatch(/Zosima/)
  })

  it('uses arguments and objections for a treatise', () => {
    expect(guessKind('Meditations', ['Stoics'])).toBe('argument')
    expect(guessKind('The Gospel of Mark')).toBe('scripture')
    expect(guessKind('The Brothers Karamazov', ['Fiction'])).toBe('story')
    expect(Object.keys(newRecord('a', 'b', 'argument').sections)).toEqual(['Arguments', 'Objections', 'Key terms', 'Open questions'])
    expect(fallbackQuestion('Book II', 'argument')).toMatch(/main claim/)
  })
})
