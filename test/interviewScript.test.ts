/**
 * Scripts (shared/interviewScript): the script file round-trips as readable Markdown, voice.md
 * gains rules without losing what the learner wrote, feedback that is a voice rule is spotted,
 * claims the material doesn't back are flagged, and a run is marked on beats, not word for word.
 * Also the new AI tells and the spoken-script guide (shared/humanWriting).
 */
import { describe, expect, it } from 'vitest'
import { aiTells, naturalness, SPOKEN_SCRIPT, HUMAN_WRITING, HUMAN_FEEDBACK } from '@shared/humanWriting'
import {
  addVersion,
  asksForOptions,
  beatLanded,
  beatSpans,
  beatsInCode,
  claimTokens,
  emptyScript,
  knownTokens,
  latest,
  lengthAsked,
  lockedText,
  parseBeats,
  parseScript,
  parseScriptReply,
  parseVoice,
  readSayIt,
  sampleSentences,
  sayItInCode,
  scriptFile,
  scriptMarkdown,
  scriptTarget,
  unsupportedClaims,
  voiceMarkdown,
  voiceRuleFrom,
  withVoiceLine,
  yourDraftOf,
  yourDrafts,
  type Script
} from '@shared/interviewScript'

const q = { id: 'B2', text: 'Tell me about a time you fixed a broken process.' }

function sample(): Script {
  let s = emptyScript(q)
  s = addVersion(s, { at: '2026-11-19 10:00', by: 'start', note: 'Your own draft from questions.md.', text: 'At the society I kept the books.\n\nI wrote a script to check 400 payments.' })
  s = addVersion(s, { at: '2026-11-19 10:05', by: 'tide', note: 'Shorter.\nStarts with the script.', text: 'I wrote a script to check 400 payments.\n\nIt found 12 duplicates, and we refunded them.' })
  s = { ...s, log: [{ at: '2026-11-19 10:04', who: 'you', text: 'start with the script, less formal' }, { at: '2026-11-19 10:05', who: 'tide', text: 'Shorter. Starts with the script.', version: 2 }], facts: ['We refunded every member (stated 2026-11-19)'], target: [60, 80] }
  return s
}

describe('the script file', () => {
  it('round-trips through readable Markdown', () => {
    const s = { ...sample(), status: 'locked' as const, lockedVersion: 2, beats: ['A script checked 400 payments', 'Found 12 duplicates, refunded'] }
    const md = scriptMarkdown(s)
    expect(md).toMatch(/^---\nquestion: "Tell me about a time you fixed a broken process."\nquestionId: "B2"\nstatus: locked\nlockedVersion: 2\ntarget: 60-80\nbeats:\n {2}- "A script checked 400 payments"/)
    expect(md).toContain('## Version 2 (locked)')
    expect(md).toContain('*Tide · 2026-11-19 10:05*')
    expect(md).toContain('> Shorter.\n> Starts with the script.')
    expect(md).toContain('- **You** (2026-11-19 10:04): start with the script, less formal')
    expect(md).toContain('## Facts you stated')
    // Newest first
    expect(md.indexOf('## Version 2')).toBeLessThan(md.indexOf('## Version 1'))
    const back = parseScript(md)
    expect(back).toEqual({ ...s, versions: s.versions })
    expect(lockedText(back)).toBe('I wrote a script to check 400 payments.\n\nIt found 12 duplicates, and we refunded them.')
  })
  it('reads a draft with no front matter list and no conversation', () => {
    const s = parseScript('---\nquestion: Why risk?\nstatus: draft\nbeats: []\n---\n\n# Why risk?\n\n## Version 1\n\n*You · 2026-11-19 09:00*\n\nBecause I like it.\n', { id: 'M1', text: 'Why risk?' })
    expect(s).toMatchObject({ questionId: 'M1', question: 'Why risk?', status: 'draft', beats: [], log: [], facts: [] })
    expect(s.versions).toEqual([{ n: 1, at: '2026-11-19 09:00', by: 'you', text: 'Because I like it.' }])
    expect(lockedText(s)).toBeNull()
  })
  it('keeps versions, skipping a save that changed nothing', () => {
    const s = sample()
    expect(addVersion(s, { at: 'x', by: 'you', text: latest(s)!.text + '  ' })).toBe(s)
    expect(latest(addVersion(s, { at: 'x', by: 'you', text: 'New.' }))!.n).toBe(3)
  })
  it('names the file after the question id', () => {
    expect(scriptFile('mot-01')).toBe('mot-01.md')
    expect(scriptFile('a/b c')).toBe('a-b-c.md')
  })
})

describe('length', () => {
  it('has a target per kind, the intro shorter, the question’s own limit first', () => {
    expect(scriptTarget({ kind: 'motivation', text: 'Tell me about yourself.' })).toEqual([60, 90])
    expect(scriptTarget({ kind: 'behavioural', text: 'A time you failed' })).toEqual([90, 120])
    expect(scriptTarget({ kind: 'behavioural', text: 'x', limit: 60 })).toEqual([36, 60])
    expect(scriptTarget({ kind: 'behavioural', text: 'x' }, [50, 70])).toEqual([50, 70])
  })
  it('reads a length out of feedback', () => {
    expect(lengthAsked('make it 60 seconds')).toEqual([50, 70])
    expect(lengthAsked('under 2 minutes please')).toEqual([90, 120])
    expect(lengthAsked('less formal')).toBeNull()
    expect(lengthAsked('I was there 3 s')).toBeNull()
  })
})

describe('voice.md', () => {
  it('adds a rule without losing what the learner wrote', () => {
    const raw = '# My voice\n\nMy note.\n\n## Rules\n\n- Short sentences.\n\n## Sample sentences\n\n- So I went and asked the team.\n\n## Other\n\nKeep this.\n'
    const next = withVoiceLine(raw, 'rules', 'Never say “furthermore”.')
    expect(next).toContain('- Short sentences.\n- Never say “furthermore”.')
    expect(next).toContain('My note.')
    expect(next).toContain('## Other\n\nKeep this.')
    expect(withVoiceLine(next, 'rules', 'never say furthermore')).toBe(next)
    expect(parseVoice(next)).toEqual({ rules: ['Short sentences.', 'Never say “furthermore”.'], samples: ['So I went and asked the team.'] })
  })
  it('starts a file, and replaces the placeholder', () => {
    const empty = voiceMarkdown({ rules: [], samples: [] })
    expect(parseVoice(empty)).toEqual({ rules: [], samples: [] })
    const one = withVoiceLine(empty, 'samples', 'I like plain sentences.')
    expect(one).not.toContain('(none yet)\n- I like')
    expect(parseVoice(one).samples).toEqual(['I like plain sentences.'])
    expect(parseVoice(withVoiceLine('', 'rules', 'Short.')).rules).toEqual(['Short.'])
  })
  it('picks sample sentences in the learner’s own words', () => {
    const text = '## Draft\n\nI kept the books for the society. It was a pivotal moment for me and I learned a lot. Hi. See https://x.y for more about my work here today.'
    expect(sampleSentences(text, (s) => aiTells(s).length)).toEqual(['I kept the books for the society.'])
  })
  it('finds the learner’s drafts in questions.md', () => {
    const md = '## B2. Tell me about a time you fixed a broken process.\n- Kind: behavioural\n\n### Your draft (in my words)\n\nI wrote a script.\n\n(About 4 words, roughly 2 seconds spoken.)\n\n### Model answer\n\nModel.\n\n## Tell me about yourself\n\n### Your draft\n\nMe.\n'
    expect(yourDrafts(md).map((d) => d.under)).toEqual(['B2. Tell me about a time you fixed a broken process.', 'Tell me about yourself'])
    expect(yourDraftOf(md, q)).toBe('I wrote a script.')
    expect(yourDraftOf(md, { id: 'M1', text: 'Tell me about yourself.' })).toBe('Me.')
    expect(yourDraftOf(md, { id: 'X', text: 'Why us?' })).toBeUndefined()
  })
})

describe('feedback that is a voice rule', () => {
  it('spots general rules', () => {
    expect(voiceRuleFrom('I’d never say "first-hand"')).toBe('Never say “first-hand”.')
    expect(voiceRuleFrom("I don't use furthermore")).toBe('Never say “furthermore”.')
    expect(voiceRuleFrom('I say "so" to start a point')).toBe('I say “so” to start a point.')
    expect(voiceRuleFrom('short sentences')).toBe('Short sentences.')
    expect(voiceRuleFrom('I always lead with the number')).toBe('I always lead with the number.')
  })
  it('leaves feedback about this answer alone', () => {
    expect(voiceRuleFrom('start with the Contoso work')).toBeNull()
    expect(voiceRuleFrom('make it 60 seconds')).toBeNull()
    expect(voiceRuleFrom('cut the second paragraph')).toBeNull()
    expect(voiceRuleFrom('this sentence is too formal')).toBeNull()
  })
  it('knows when alternatives are wanted', () => {
    expect(asksForOptions('give me two other openings')).toBe(true)
    expect(asksForOptions('2 endings please')).toBe(true)
    expect(asksForOptions('less formal')).toBe(false)
  })
})

describe('claims the material doesn’t back', () => {
  const known = knownTokens(['I checked 400 payments at Northwind Society in 2024 and found 12 duplicates.'])
  it('flags numbers and names the material doesn’t have', () => {
    const text = 'I checked 400 payments at Northwind. That saved 30% of the time at Contoso. I liked it.'
    const flags = unsupportedClaims(text, known)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ sentence: 'That saved 30% of the time at Contoso.', missing: ['30%', 'contoso'] })
    expect(text.slice(flags[0].at, flags[0].at + flags[0].length)).toBe(flags[0].sentence)
  })
  it('ignores sentence starts, small numbers and ordinary capitals', () => {
    expect(claimTokens('Then I met 2 people on Monday.')).toEqual([])
    expect(claimTokens('So I joined Fabrikam in 2023.')).toEqual(['2023', 'fabrikam'])
    expect(unsupportedClaims('So I checked the payments.', known)).toEqual([])
  })
})

describe('beats and Say it', () => {
  const script = 'I kept the books for the investing society.\n\nI wrote a script that checked 400 payments against the bank statement.\n\nIt found 12 duplicates, and we refunded every member.\n\nNow I check the process before the numbers.'
  const beats = ['Kept the society’s books', 'A script checked 400 payments', '12 duplicates found and refunded', 'Check the process first']
  it('makes beats in code, one per paragraph', () => {
    const b = beatsInCode(script)
    expect(b).toHaveLength(4)
    expect(b[1]).toBe('I wrote a script that checked 400 payments against the bank statement')
    expect(beatsInCode('One. Two words here. Three more words here. Four words in here. Five words in this.', 2)).toHaveLength(2)
  })
  it('marks a run on its beats, not word for word', () => {
    const run = 'So I was treasurer, I kept the books. I built a little script to check all 400 payments, and it caught 12 duplicates which we refunded.'
    const r = sayItInCode({ beats, answer: run, seconds: 40, target: [60, 90], natural: naturalness })
    expect(r.beats.map((b) => b.hit)).toEqual([true, true, true, false])
    expect(r.feedback).toMatch(/3 of 4 beats landed\. It ran short\./)
    expect(r.by).toBe('code')
    expect(r.score).toBeGreaterThan(0.4)
    expect(r.score).toBeLessThan(0.9)
    const empty = sayItInCode({ beats, answer: '', seconds: null, target: [60, 90], natural: naturalness })
    expect(empty.beats.every((b) => !b.hit)).toBe(true)
    expect(beatLanded('we refunded the duplicates', '12 duplicates found and refunded')).toBe(true)
  })
  it('folds Claude’s beat marks over the code’s', () => {
    const base = sayItInCode({ beats, answer: 'x', seconds: 70, target: [60, 90], natural: naturalness })
    const r = readSayIt('{"hit": [true, true, false, true], "natural": 0.8, "feedback": "You dropped the refund."}', base)!
    expect(r.beats.map((b) => b.hit)).toEqual([true, true, false, true])
    expect(r).toMatchObject({ by: 'claude', feedback: 'You dropped the refund.', natural: 0.8 })
    expect(readSayIt('{"hit": [true]}', base)).toBeNull()
    expect(readSayIt('nonsense', base)).toBeNull()
  })
  it('finds each beat in the script, to mark the missed ones', () => {
    const spans = beatSpans(script, beats)
    expect(script.slice(spans[1]!.at, spans[1]!.at + spans[1]!.length)).toBe('I wrote a script that checked 400 payments against the bank statement.')
    expect(beatSpans(script, ['Something about weather patterns'])).toEqual([null])
  })
  it('reads Claude’s beats', () => {
    expect(parseBeats('Here: ["one beat", "two beat", {"beat": "three"}]')).toEqual(['one beat', 'two beat', 'three'])
    expect(parseBeats('["only one"]')).toBeNull()
    expect(parseBeats('none')).toBeNull()
  })
})

describe('Claude’s reply', () => {
  it('reads a revision, alternatives, stated facts and a voice rule', () => {
    expect(parseScriptReply('```json\n{"draft": "New.", "note": "Cut the opener.", "facts": ["We reached the final"], "voiceRule": null, "options": []}\n```')).toEqual({ draft: 'New.', note: 'Cut the opener.', facts: ['We reached the final'] })
    const r = parseScriptReply('{"note": "Two openings.", "options": [{"kind": "opening", "text": "A.", "draft": "A. Rest."}, {"kind": "opening", "text": "B.", "draft": "B. Rest."}, {"kind": "ending", "text": "C.", "draft": "C."}], "voiceRule": "Short sentences."}')!
    expect(r.options).toHaveLength(2)
    expect(r.draft).toBeUndefined()
    expect(r.voiceRule).toBe('Short sentences.')
    expect(parseScriptReply('not json')).toBeNull()
    expect(parseScriptReply('{}')).toBeNull()
  })
})

describe('more AI tells, each caught', () => {
  const cases: [string, RegExp][] = [
    ["Here's the thing: I like reliable systems.", /Throat-clearing/],
    ['At the end of the day, the numbers matched.', /Throat-clearing/],
    ["It's worth noting that latency dropped.", /Filler/],
    ["In today's fast-paced world, data moves quickly.", /Scene-setter|Puffery/],
    ['We did a deep dive on the logs.', /Cliché/],
    ['This underscores the importance of testing.', /Inflated|Significance/],
    ["Great question! Let's dive in.", /Chatbot/],
    ['I fixed it. Moreover, I wrote tests.', /Written connector/],
    ['Despite these setbacks, we persevered and shipped.', /Despite/],
    ['Everyone, from interns to directors alike, used it.', /False range/],
    ['Let me walk you through my approach.', /Narrating/],
    ['Reliability matters. Full stop.', /Dramatic/],
    ['The stakes were high for the bank.', /Vague declarative/],
    ["I'm passionate about risk.", /Interview cliché/],
    ['I work well in a fast-paced environment.', /Interview cliché/],
    ['The role aligns with my values.', /Aligns/],
    ["I'm not saying it was easy, but we did it.", /Staged/],
    ['I **owned** the release.', /Bold/],
    ['We shipped -- finally -- on time.', /Em dash/]
  ]
  for (const [text, why] of cases)
    it(`flags: ${text}`, () => {
      expect(aiTells(text).some((t) => why.test(t.why))).toBe(true)
    })
  it('gives each tell its exact place in the text', () => {
    const text = 'I fixed it. Moreover, I wrote tests.'
    const t = aiTells(text).find((x) => /connector/.test(x.why))!
    expect(text.slice(t.at, t.at + t.length)).toBe('Moreover,')
  })
  it('counts intensifiers and hedges only when they pile up', () => {
    expect(aiTells('I really liked the work.')).toEqual([])
    expect(aiTells('I really, truly, genuinely liked it.').filter((t) => /Intensifiers/.test(t.why))).toHaveLength(3)
    expect(aiTells('Perhaps it was arguably, potentially, the wrong call.').some((t) => /Hedges/.test(t.why))).toBe(true)
  })
  it('still leaves plain speech alone', () => {
    const plain = "So I was treasurer of the investing society. I wrote a script to check the payments, and it found 12 duplicates. We refunded them, and now I check the process first. From January to March it ran every week."
    expect(aiTells(plain)).toEqual([])
  })
  it('has a guide for spoken scripts, small enough for a prompt', () => {
    expect(SPOKEN_SCRIPT).toMatch(/Answer first/)
    expect(SPOKEN_SCRIPT).toMatch(/Read-aloud test/)
    expect(SPOKEN_SCRIPT).toMatch(/voice rules beat these/)
    expect(SPOKEN_SCRIPT.length).toBeLessThan(2400)
    expect(HUMAN_WRITING.length).toBeLessThan(3000)
    expect(HUMAN_FEEDBACK.length).toBeLessThan(400)
  })
})

describe('comparing versions', () => {
  it('shows words added and removed', async () => {
    const { wordDiff } = await import('@shared/interviewScript')
    const d = wordDiff('I wrote a script to check payments.', 'So I wrote a small script to check payments.')
    expect(d.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['So', 'small'])
    expect(d.filter((p) => p.kind === 'removed')).toEqual([])
    expect(d.map((p) => (p.kind === 'removed' ? '' : p.text)).join('')).toBe('So I wrote a small script to check payments.')
  })
  it('shows a swapped phrase as one run out and one run in', async () => {
    const { wordDiff } = await import('@shared/interviewScript')
    const d = wordDiff('At my current internship I build pipelines.\n\nThen more.', 'At Fabrikam I build pipelines.\n\nThen more.')
    expect(d).toEqual([
      { kind: 'same', text: 'At ' },
      { kind: 'removed', text: 'my current internship ' },
      { kind: 'added', text: 'Fabrikam ' },
      { kind: 'same', text: 'I build pipelines.\n\nThen more.' }
    ])
  })
})

describe('a locked script in drill marking', () => {
  it('counts the script’s beats among the points to cover, in code', async () => {
    const { markInCode } = await import('@shared/interviewTarget')
    const base = { drill: 'behavioural' as const, question: 'q', answer: 'I wrote a script to check 400 payments and refunded the duplicates.', seconds: 100 }
    const m = markInCode({ ...base, script: 'x', beats: ['Script checked 400 payments', 'Weather in Oslo'] }, naturalness)
    expect(m.covered).toContain('Script checked 400 payments')
    expect(m.missed).toContain('Weather in Oslo')
  })
})
