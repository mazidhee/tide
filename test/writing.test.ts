import { describe, expect, it } from 'vitest'
import {
  detectKind,
  draftFileName,
  draftFrontMatter,
  drillTopic,
  findAnchor,
  frontMatter,
  habits,
  habitsLine,
  improvements,
  makeAnchor,
  parseTopics,
  pieceTitle,
  reanchor,
  stackMargin,
  tickTopic,
  wordCount,
  type PieceRecord,
  type WritingComment
} from '../src/shared/writing'
import { checkMechanics, countHits, maskProse, proseBlocks, recheckLocal } from '../src/shared/writingCheck'
import { combineReview, mergeTopics, overlap, parseRecheck, parseReview, reviewPrompt, topicsFromThings } from '../src/shared/writingPrompt'

// A draft shaped like the learner's: Quartz front matter, a highlighted opening, comma splices,
// lowercase "i", a space before a comma, a question left without its mark, a long paragraph.
// The sentences are written for this test.
const DRAFT = `---
id: on boredom
tags:
  - thoughts
  - philosophy
date: "2026-10-02"
title: on boredom
draft: true
---
==*"A note to myself about sitting still."*==

Most mornings i reach for my phone before i reach for a thought , it happens without asking. Boredom is not the enemy, it is the doorway.

why do we run from it the answer is simple, we are afraid of what we find there.

> Quoted text , kept as it is: i won't be checked here.

The  room was quiet. the clock said nothing new.

And so the morning goes on

- a list item without a stop
- another one

\`\`\`python
for i in range(3): print(i , i)
\`\`\`

See ![[boredom chart.png]] and [the post](https://example.com/a ,b).
`

describe('front matter and titles', () => {
  it('reads Quartz front matter with lists and quotes', () => {
    const fm = frontMatter(DRAFT)
    expect(fm.data.tags).toEqual(['thoughts', 'philosophy'])
    expect(fm.data.draft).toBe(true)
    expect(fm.data.date).toBe('2026-10-02')
    expect(fm.keys).toEqual(['id', 'tags', 'date', 'title', 'draft'])
    expect(DRAFT.slice(fm.end).startsWith('==')).toBe(true)
  })
  it('takes the file name when the title is "Untitled"', () => {
    expect(pieceTitle('---\ntitle: Untitled\n---\nText', 'thoughts/north star.md')).toBe('north star')
    expect(pieceTitle(DRAFT, 'x.md')).toBe('on boredom')
  })
  it('counts words in the prose only', () => {
    expect(wordCount('---\ntitle: a b c\n---\nOne two three.\n```\ncode code\n```\n![[pic.png]]')).toBe(3)
  })
})

describe('kind of piece', () => {
  it('reads a personal essay from its tags and first person', () => {
    expect(detectKind(DRAFT, 'thoughts/on boredom.md').kind).toBe('essay')
  })
  it('spots a technical essay', () => {
    const md = 'Attention lets a transformer weigh every token against every other. The GPU memory grows with the square of the sequence, so inference latency rises; a KV cache trades memory for speed in training and inference.'
    expect(detectKind(md).kind).toBe('technical')
  })
  it('spots a paper and a journal', () => {
    expect(detectKind('## Abstract\n\nWe propose a method.').kind).toBe('paper')
    expect(detectKind('Felt tired today.', 'journal/2026-11-02.md').kind).toBe('journal')
    expect(detectKind('---\nkind: explainer\n---\nHi').kind).toBe('explainer')
  })
})

describe('anchors survive edits', () => {
  const text = 'The model learns fast, it forgets fast. The model learns fast, it forgets slowly.'
  const second = text.lastIndexOf('it forgets')
  const a = makeAnchor(text, second, second + 'it forgets slowly'.length)

  it('stays put when nothing changed', () => {
    expect(findAnchor(text, a)).toEqual({ start: a.start, end: a.end })
  })
  it('follows its words when text is inserted before it', () => {
    const edited = 'In short: ' + text
    const at = findAnchor(edited, a)!
    expect(edited.slice(at.start, at.end)).toBe('it forgets slowly')
  })
  it('picks the right one of two identical quotes by its context', () => {
    const b = makeAnchor(text, second, second + 'it forgets'.length)
    const edited = text.replace('The model learns fast, it forgets fast.', 'The model learns quickly, it forgets fast.')
    const at = findAnchor(edited, b)!
    expect(at.start).toBe(edited.lastIndexOf('it forgets'))
  })
  it('finds a quote whose spacing was fixed', () => {
    const t = 'We live in the day  and age of easy answers.'
    const an = makeAnchor(t, t.indexOf('day'), t.indexOf('age') + 3)
    const fixed = t.replace('day  and', 'day and')
    const at = findAnchor(fixed, an)!
    expect(fixed.slice(at.start, at.end)).toBe('day and age')
  })
  it('finds a lightly edited quote between its unchanged neighbours', () => {
    const t = 'First a long and winding sentence, then the part we comment on here, and then more words follow.'
    const s = t.indexOf('the part we comment on')
    const an = makeAnchor(t, s, s + 'the part we comment on'.length)
    const edited = t.replace('the part we comment on', 'the bit we comment upon')
    const at = findAnchor(edited, an)!
    expect(edited.slice(at.start, at.end)).toBe('the bit we comment upon')
  })
  it('gives up when the words are gone', () => {
    expect(findAnchor('Something else entirely, nothing in common with before at all.', a)).toBeNull()
  })
  it('re-anchors open comments and reports the lost', () => {
    const c = (id: string, start: number, end: number): WritingComment => ({ id, category: 'clarity', severity: 'minor', anchor: makeAnchor(text, start, end), what: '', principle: '', ask: '', by: 'claude', status: 'open', at: 0 })
    const { comments, lost } = reanchor('Prefix. ' + text.replace('slowly', 'gently'), [c('a', 0, 9), c('b', second + 11, second + 17)])
    expect(comments[0].anchor.start).toBe(8)
    expect(lost).toEqual(['b'])
  })
})

describe('the local checker', () => {
  const cs = checkMechanics(DRAFT, { at: 1 })
  const rules = cs.map((c) => c.rule)
  const quote = (rule: string) => cs.find((c) => c.rule === rule)?.anchor.quote

  it('only reads prose: front matter, quotes, code, embeds and link targets are left alone', () => {
    const masked = maskProse(DRAFT)
    expect(masked).not.toContain('boredom chart')
    expect(masked).not.toContain('example.com')
    const kinds = proseBlocks(DRAFT).map((b) => b.kind)
    expect(kinds).toContain('list')
    for (const c of cs) {
      expect(c.anchor.start).toBeGreaterThan(frontMatter(DRAFT).end)
      expect(DRAFT.slice(c.anchor.start, c.anchor.end)).toBe(c.anchor.quote)
      expect(c.anchor.quote).not.toMatch(/Quoted|range|example/)
    }
  })
  it('finds a comma splice after a main clause, not after an "if" clause', () => {
    expect(rules).toContain('comma-splice')
    const places = cs.filter((c) => c.rule === 'comma-splice').flatMap((c) => [c.anchor, ...(c.more ?? [])].map((a) => a.quote))
    expect(places.join('|')).toMatch(/enemy, it is/)
    expect(checkMechanics('If you train it longer, it is likely to overfit.').some((c) => c.rule === 'comma-splice')).toBe(false)
  })
  it('gathers lowercase "i" across the piece into one comment with every place marked', () => {
    const i = cs.filter((c) => c.rule === 'lowercase-i')
    expect(i).toHaveLength(1)
    expect(1 + (i[0].more?.length ?? 0)).toBe(2)
    expect(i[0].what).toMatch(/2 in this piece/)
  })
  it('flags a space before punctuation, a double space, a lowercase sentence start and a question without "?"', () => {
    expect(quote('space-before-punct')).toBe('thought ,')
    expect(quote('double-space')).toBe('The  room')
    expect(cs.filter((c) => c.rule === 'sentence-capital').map((c) => c.anchor.quote)).toEqual(expect.arrayContaining(['why', 'the']))
    expect(rules).toContain('missing-end')
  })
  it('does not hold list items to paragraph rules', () => {
    expect(cs.some((c) => c.anchor.quote.includes('stop'))).toBe(false)
  })
  it('finds questions without a question mark', () => {
    const q = checkMechanics('Is not your life yours to live. I think it is.')
    expect(q.map((c) => c.rule)).toContain('question-mark')
  })
  it('flags repeated words and very long sentences and paragraphs', () => {
    const long = Array.from({ length: 60 }, (_, k) => `word${k}`).join(' ') + '.'
    const para = Array.from({ length: 30 }, () => 'This short sentence has seven words here.').join(' ')
    const r = checkMechanics(`It was the the best idea.\n\n${long}\n\n${para}`).map((c) => c.rule)
    expect(r).toEqual(expect.arrayContaining(['repeated-word', 'long-sentence', 'long-paragraph']))
  })
  it('leaves index variables in technical prose alone', () => {
    expect(checkMechanics('For each index i the sum runs over j. The gradient at step i is small.').some((c) => c.rule === 'lowercase-i')).toBe(false)
  })
  it('says what is wrong, the principle and an ask; examples are never the learner’s sentence', () => {
    for (const c of cs.filter((x) => x.principle)) {
      expect(c.what.length).toBeGreaterThan(5)
      expect(c.ask.length).toBeGreaterThan(5)
      if (c.example) expect(overlap(DRAFT.slice(c.anchor.start - 40, c.anchor.end + 40), c.example)).toBeLessThan(0.5)
    }
  })
  it('a journal gets the light check', () => {
    const light = checkMechanics(DRAFT, { light: true }).map((c) => c.rule)
    expect(light).not.toContain('lowercase-i')
    expect(light).toContain('comma-splice')
  })
  it('counts every place for the habits', () => {
    expect(countHits(cs)['mechanics:lowercase-i']).toBe(2)
  })
  it('re-checks its own comment on the text as it is now', () => {
    const i = cs.find((c) => c.rule === 'lowercase-i')!
    const half = DRAFT.replace('Most mornings i reach', 'Most mornings I reach')
    expect(recheckLocal(half, i)).toHaveLength(1)
    const fixed = half.replace('before i reach', 'before I reach')
    expect(recheckLocal(fixed, i)).toHaveLength(0)
  })
})

describe('the margin', () => {
  it('stacks cards without overlap, in anchor order', () => {
    const t = stackMargin([
      { id: 'a', top: 100, height: 50 },
      { id: 'b', top: 110, height: 40 },
      { id: 'c', top: 400, height: 30 }
    ])
    expect(t).toEqual({ a: 100, b: 158, c: 400 })
  })
  it('keeps the active card level with its text and moves those above up', () => {
    const t = stackMargin(
      [
        { id: 'a', top: 100, height: 50 },
        { id: 'b', top: 110, height: 40 }
      ],
      8,
      'b'
    )
    expect(t.b).toBe(110)
    expect(t.a + 50 + 8).toBeLessThanOrEqual(110)
  })
})

describe('habits across pieces', () => {
  const rec = (path: string, runs: [number, number, Record<string, number>][]): PieceRecord => ({ path, comments: [], runs: runs.map(([at, words, counts]) => ({ at, words, counts, by: 'tide' as const, kind: 'essay' as const })) })
  const records = [rec('a.md', [[1, 1000, { 'mechanics:comma-splice': 8, clarity: 1 }], [3, 1000, { 'mechanics:comma-splice': 2 }]]), rec('b.md', [[2, 500, { 'mechanics:comma-splice': 3, 'mechanics:lowercase-i': 5 }]])]
  const hs = habits(records)
  it('rates each issue per 1,000 words from each piece’s latest review', () => {
    const cs = hs.find((h) => h.key === 'mechanics:comma-splice')!
    expect(cs.count).toBe(5)
    expect(cs.rate).toBeCloseTo(3.3, 1)
    expect(cs.pieces).toBe(2)
    expect(cs.trend).toEqual([8, 6, 2])
    expect(cs.direction).toBe('better')
    expect(cs.drill).toMatch(/comma splices/)
  })
  it('writes the profile line from the recurring ones', () => {
    const line = habitsLine(hs)
    expect(line).toBe('comma splices (3.3 per 1,000 words, falling); lowercase “i” (3.3 per 1,000 words, falling).')
  })
  it('says what improved between two reviews', () => {
    expect(improvements(records[0].runs[0], records[0].runs[1])).toEqual(['Comma splices: 8 → 2', 'Unclear sentences: 1 → 0'])
  })
  it('drills on new sentences, never the learner’s', () => {
    expect(drillTopic(hs[0])).toMatch(/NEW sentences/)
  })
})

describe('Claude’s review', () => {
  const text = 'Attention is cheap, it scales linearly with the sequence. I find this beautiful.'
  const reply = `Here you go:
{"works": ["A clear opening claim"], "voice": ["The short closing line"], "top": ["Check the scaling claim", "Join clauses properly", "Say why it matters"],
 "question": "What would change your mind?",
 "rubric": [{"name": "Accuracy", "score": 2, "note": "The cost claim is wrong"}],
 "comments": [
  {"quote": "it scales linearly with the sequence", "category": "accuracy", "severity": "major", "what": "Self-attention is quadratic in sequence length.", "principle": "Check complexity claims.", "ask": "What is the cost of comparing every token with every other?"},
  {"quote": "not in the text at all", "category": "clarity", "what": "x", "principle": "y", "ask": "z"},
  {"quote": "Attention is cheap, it", "category": "mechanics", "rule": "comma splice", "what": "Two clauses, one comma.", "principle": "p", "ask": "Fix it.", "example": "Attention is cheap, so it scales linearly with the sequence."}
 ]}`
  const r = parseReview(reply, text, 5)!
  it('anchors comments to exact quotes and drops ones it can’t find', () => {
    expect(r.comments).toHaveLength(2)
    expect(text.slice(r.comments[0].anchor.start, r.comments[0].anchor.end)).toBe('it scales linearly with the sequence')
    expect(r.overall.top).toHaveLength(3)
    expect(r.overall.voice).toEqual(['The short closing line'])
  })
  it('drops an "example" that rewrites the learner’s own sentence', () => {
    expect(r.comments[1].rule).toBe('comma-splice')
    expect(r.comments[1].example).toBeUndefined()
  })
  it('puts a review together: the checker’s first, Claude’s duplicates of them left out, counts kept', () => {
    const local = checkMechanics(text, { at: 5 })
    expect(local.some((c) => c.rule === 'comma-splice')).toBe(true)
    const rec = combineReview({ path: 'p', comments: [], runs: [] }, { text, words: 14, kind: 'technical', local, claude: r, at: 5 })
    expect(rec.comments.filter((c) => c.rule === 'comma-splice')).toHaveLength(1)
    expect(rec.runs[0].counts.accuracy).toBe(1)
    expect(rec.overall?.question).toBe('What would change your mind?')
  })
  it('asks for the kind’s rubric and protects the voice', () => {
    const p = reviewPrompt({ text, kind: 'technical', title: 't', found: [] })
    expect(p).toMatch(/Accuracy, Clarity/)
    expect(p).toMatch(/DIFFERENT sentence/)
  })
  it('reads a re-check', () => {
    expect(parseRecheck('{"fixed": false, "note": "Still two clauses."}')).toEqual({ fixed: false, note: 'Still two clauses.' })
    expect(parseRecheck('no')).toBeNull()
  })
})

describe('topics and drafts', () => {
  const NOTE = `---\ntitle: Writing topics\n---\n\n# Writing topics\n\n## Personal and philosophical\n\n- [ ] On patience\n- [x] Why I walk\n\n## Technical\n\n- [ ] Caches, plainly\n`
  it('reads the topics note by section', () => {
    const g = parseTopics(NOTE)
    expect(g.map((x) => x.heading)).toEqual(['Personal and philosophical', 'Technical'])
    expect(g[0].items[1]).toMatchObject({ text: 'Why I walk', done: true })
  })
  it('ticks one topic and nothing else', () => {
    const t = tickTopic(NOTE, 'On patience')
    expect(t).toContain('- [x] On patience')
    expect(t).toContain('- [ ] Caches, plainly')
    expect(tickTopic(NOTE, 'Missing')).toBe(NOTE)
  })
  it('merges Things to-dos with the note, without repeats', () => {
    const things = topicsFromThings(
      [
        { id: 't1', type: 'to-do', title: 'On patience', notes: 'Why waiting is a skill\nmore', status: 'open', heading: { title: 'Personal' } },
        { id: 't2', type: 'to-do', title: 'Done one', status: 'completed' },
        { id: 'h', type: 'heading', title: 'Personal', status: 'open' }
      ],
      'Writing'
    )
    expect(things).toEqual([{ title: 'On patience', note: 'Why waiting is a skill', group: 'Personal', from: 'things', thingsId: 't1' }])
    const merged = mergeTopics(things, [{ title: 'on patience', group: 'x', from: 'note' }, { title: 'Caches', group: 'Technical', from: 'note' }])
    expect(merged.map((t) => t.title)).toEqual(['On patience', 'Caches'])
  })
  it('names the file after the topic, safely', () => {
    expect(draftFileName('RSI: code, systems / AI')).toBe('RSI code, systems AI.md')
  })
  it('shapes front matter like the folder’s other notes', () => {
    const samples = [frontMatter(DRAFT), frontMatter('---\nid: x\ntags:\n  - thoughts\ndate: "2026-01-01"\ndescription: ""\ntitle: x\ndraft: true\n---\n')]
    const fm = draftFrontMatter(samples, 'On patience', '2026-11-14')
    expect(fm).toBe('---\nid: On patience\ntags:\n  - thoughts\ndate: "2026-11-14"\ndescription: ""\ntitle: On patience\ndraft: true\n---\n')
    expect(draftFrontMatter([], 'Caches: plainly', '2026-11-14')).toBe('---\ntitle: "Caches: plainly"\ndate: "2026-11-14"\ndraft: true\n---\n')
  })
})
