import { describe, expect, it } from 'vitest'
import {
  BPE_LIMITS,
  Bpe,
  DEFAULT_SENTENCE,
  DEFAULT_TEXT,
  END,
  applyMerges,
  describeTokeniserPart,
  explainMerge,
  mergePair,
  parseTokeniserPart,
  show,
  symbolsOf,
  tidy,
  type TokeniserSpec
} from '../src/renderer/src/lib/sims/bpe'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const spec = (o: object) => parseSim(JSON.stringify({ kind: 'tokeniser', ...o })) as TokeniserSpec
const CLASSIC = 'low low low low low lower lower newest newest newest newest newest newest widest widest widest'
const shown = (tokens: string[]) => tokens.map(show)
const pairsOf = (bpe: Bpe) => bpe.pairs().map((p) => `${show(p.left)}+${show(p.right)}=${p.count}`)

/** Random text over a small alphabet, so pairs repeat */
function randomText(rand: () => number, letters: string, words: number): string {
  const out: string[] = []
  for (let w = 0; w < words; w++) {
    let word = ''
    const len = 1 + Math.floor(rand() * 5)
    for (let i = 0; i < len; i++) word += letters[Math.floor(rand() * letters.length)]
    out.push(word)
  }
  return out.join(' ')
}

describe('tokeniser: the classic worked example', () => {
  /*
    low ×5, lower ×2, newest ×6, widest ×3, each word ending in _ :
      l o w _   l o w e r _   n e w e s t _   w i d e s t _         95 symbols
    Pair counts at the start (in order of first appearance in the text):
      l+o 7  o+w 7  w+_ 5  w+e 8 (2 in lower, 6 in newest)  e+r 2  r+_ 2
      n+e 6  e+w 6  e+s 9 (6 + 3)  s+t 9  t+_ 9  w+i 3  i+d 3  d+e 3
    1  e+s, s+t and t+_ tie at 9; e+s appears first            → es      95 − 9 = 86
    2  es+t 9 ties with t+_ 9; es+t appears first              → est     77
    3  est+_ 9                                                 → est_    68
    4  l+o 7 ties with o+w 7                                   → lo      61
    5  lo+w 7                                                  → low     54
    6  n+e, e+w and w+est_ tie at 6 (low+_ is 5)               → ne      48
    7  ne+w 6 ties with w+est_ 6                               → new     42
    8  new+est_ 6                                              → newest_ 36
    9  low+_ 5                                                 → low_    31
    10 w+i, i+d and d+est_ tie at 3                            → wi      28
    11 wi+d 3 ties with d+est_                                 → wid     25
    12 wid+est_ 3                                              → widest_ 22
    13 low+e, e+r and r+_ tie at 2                             → lowe    20
    14 lowe+r 2 ties with r+_                                  → lower   18
    15 lower+_ 2                                               → lower_  16
    Now every word is one token (16 words, 16 tokens) and no pairs are left.
    These are the merges the usual walk-through of this example gives (es, est, est</w>, lo, low, …).
  */
  it('starts from characters with an end-of-word mark', () => {
    const bpe = new Bpe(CLASSIC)
    expect(bpe.words).toBe(16)
    expect(bpe.startLength).toBe(95)
    expect(bpe.length).toBe(95)
    expect(shown(bpe.segmented()[0])).toEqual(['l', 'o', 'w', '_'])
    expect(shown(bpe.vocab)).toEqual(['<unk>', 'l', 'o', 'w', '_', 'e', 'r', 'n', 's', 't', 'i', 'd'])
    expect(bpe.alphabet).toBe(11)
    expect(bpe.compression).toBe(1)
  })

  it('counts the pairs, ordered by count and then by first appearance', () => {
    expect(pairsOf(new Bpe(CLASSIC))).toEqual(['e+s=9', 's+t=9', 't+_=9', 'w+e=8', 'l+o=7', 'o+w=7', 'n+e=6', 'e+w=6', 'w+_=5', 'w+i=3', 'i+d=3', 'd+e=3', 'e+r=2', 'r+_=2'])
  })

  it('learns the published merges in order, with their counts and the text length after each', () => {
    const bpe = new Bpe(CLASSIC)
    expect(bpe.run()).toBe(15)
    expect(bpe.merges.map((m) => `${show(m.left)}+${show(m.right)}→${show(m.token)} ×${m.count} =${m.length}`)).toEqual([
      'e+s→es ×9 =86',
      'es+t→est ×9 =77',
      'est+_→est_ ×9 =68',
      'l+o→lo ×7 =61',
      'lo+w→low ×7 =54',
      'n+e→ne ×6 =48',
      'ne+w→new ×6 =42',
      'new+est_→newest_ ×6 =36',
      'low+_→low_ ×5 =31',
      'w+i→wi ×3 =28',
      'wi+d→wid ×3 =25',
      'wid+est_→widest_ ×3 =22',
      'low+e→lowe ×2 =20',
      'lowe+r→lower ×2 =18',
      'lower+_→lower_ ×2 =16'
    ])
    expect(bpe.merges.map((m) => m.id)).toEqual(Array.from({ length: 15 }, (_, i) => 12 + i))
    expect(bpe.vocab).toHaveLength(27)
    expect(bpe.finished).toBe('Finished after 15 merges: every word is one token, so there are no pairs left')
    expect(bpe.step()).toBeNull()
    expect(bpe.pairs()).toEqual([])
    expect(bpe.compression).toBeCloseTo(95 / 16)
    expect(bpe.segmented().map((w) => shown(w).join(' ')).slice(4, 8)).toEqual(['low_', 'lower_', 'lower_', 'newest_'])
  })

  it('records the ties each merge won', () => {
    const bpe = new Bpe(CLASSIC)
    bpe.run()
    const tied = bpe.merges.map((m) => m.tied.map(([l, r]) => `${show(l)}+${show(r)}`))
    expect(tied[0]).toEqual(['s+t', 't+_'])
    expect(tied[1]).toEqual(['t+_'])
    expect(tied[2]).toEqual([])
    expect(tied[3]).toEqual(['o+w'])
    expect(tied[5]).toEqual(['e+w', 'w+est_'])
    expect(tied[9]).toEqual(['i+d', 'd+est_'])
    expect(tied[12]).toEqual(['e+r', 'r+_'])
    expect(explainMerge(bpe.merges[0])).toBe(
      'Merge 1: the most frequent pair is e + s (9 times), so it becomes one new token, es, with id 12. It tied with s + t and t + _; the pair that appears first in the text wins. The text is now 86 tokens.'
    )
    expect(explainMerge(bpe.merges[2])).toBe('Merge 3: the most frequent pair is est + _ (9 times), so it becomes one new token, est_, with id 14. The text is now 68 tokens.')
    expect(explainMerge(bpe.merges[14])).toContain('lower + _ (twice)')
  })

  it('splits a new sentence with the merges learnt so far', () => {
    const bpe = new Bpe(CLASSIC)
    const split = () => bpe.encode('newer lowest wider').map((p) => show(p.text)).join(' ')
    expect(split()).toBe('n e w e r _ l o w e s t _ w i d e r _')
    bpe.run(7)
    expect(split()).toBe('new e r _ low est_ w i d e r _')
    expect(bpe.encode('newer lowest wider').map((p) => p.id)).toEqual([18, 5, 6, 4, 16, 14, 3, 10, 11, 5, 6, 4])
    bpe.run()
    expect(split()).toBe('new e r _ low est_ wid e r _')
    expect(bpe.encode('lower newest').map((p) => show(p.text))).toEqual(['lower_', 'newest_'])
    expect(bpe.encode('newer lowest wider').map((p) => p.word)).toEqual([0, 0, 0, 0, 1, 1, 2, 2, 2, 2])
  })
})

describe('tokeniser: the rules', () => {
  it('breaks ties by first appearance in the text, whatever the letters are', () => {
    // z+y and b+a both occur twice (so do y+_ and a+_); z+y comes first in the text
    expect(new Bpe('zy ba zy ba').step()).toMatchObject({ left: 'z', right: 'y', count: 2 })
    expect(new Bpe('ba zy zy ba').step()).toMatchObject({ left: 'b', right: 'a', count: 2 })
    // A more frequent pair beats an earlier one
    expect(new Bpe('zy ba ba ba zy').step()).toMatchObject({ left: 'b', right: 'a', count: 3 })
  })

  it('counts a pair at every position, and merges left to right', () => {
    const bpe = new Bpe('aaa aaa')
    expect(pairsOf(bpe)).toEqual(['a+a=4', 'a+_=2'])
    bpe.step()
    expect(shown(bpe.segmented()[0])).toEqual(['aa', 'a', '_'])
    expect(mergePair(['a', 'a', 'a', 'a', 'a'], 'a', 'a')).toEqual(['aa', 'aa', 'a'])
    expect(mergePair(['a', 'b', 'a', 'b'], 'b', 'a')).toEqual(['a', 'ba', 'b'])
    expect(mergePair(['a'], 'a', 'a')).toEqual(['a'])
  })

  it('never merges across a word boundary', () => {
    // Read without boundaries, "ab ab ab" would hold b+a twice; inside words it never occurs
    const bpe = new Bpe('ab ab ab')
    expect(pairsOf(bpe)).toEqual(['a+b=3', 'b+_=3'])
    const rand = mulberry32(5)
    for (let k = 0; k < 40; k++) {
      const model = new Bpe(randomText(rand, 'abc', 30), { merges: 60 })
      model.run()
      // The end-of-word mark is only ever the last character of a token, and never the left of a pair
      for (const token of model.vocab.slice(1)) expect(token.indexOf(END) === -1 || token.indexOf(END) === token.length - 1).toBe(true)
      for (const m of model.merges) expect(m.left.includes(END)).toBe(false)
      // Each word of the text still spells itself
      const text = model.text.split(' ')
      model.segmented().forEach((symbols, i) => expect(symbols.join('')).toBe(text[i] + END))
    }
  })

  it('applies merges in the order learnt, which matters', () => {
    const ab = { left: 'a', right: 'b' }
    const bc = { left: 'b', right: 'c' }
    expect(applyMerges(['a', 'b', 'c'], [ab, bc])).toEqual(['ab', 'c'])
    expect(applyMerges(['a', 'b', 'c'], [bc, ab])).toEqual(['a', 'bc'])
    // Learnt from a text: a+b (5) first, then ab+_ (3), then ab+c (2, ahead of c+_), then abc+_
    const bpe = new Bpe('abc abc ab ab ab')
    bpe.run()
    expect(bpe.merges.map((m) => show(m.token))).toEqual(['ab', 'ab_', 'abc', 'abc_'])
    // "bc" could only become one token if b+c had been merged before a+b took the b
    expect(bpe.encode('abc bc').map((p) => show(p.text))).toEqual(['abc_', 'b', 'c', '_'])
    // A later merge applies only to what the earlier ones left: ab_ wins over abc for "ab"
    expect(bpe.encode('ab').map((p) => show(p.text))).toEqual(['ab_'])
  })

  it('decodes what it encodes, for text over the training alphabet', () => {
    const rand = mulberry32(21)
    for (let k = 0; k < 60; k++) {
      const model = new Bpe(randomText(rand, 'abcde', 40), { merges: 40 })
      model.run(Math.floor(rand() * 41))
      const sentence = randomText(rand, 'abcde', 1 + Math.floor(rand() * 8))
      const pieces = model.encode(sentence)
      expect(pieces.every((p) => !p.unknown && p.id > 0)).toBe(true)
      expect(model.decode(pieces.map((p) => p.id))).toBe(sentence)
    }
    const bpe = new Bpe(CLASSIC)
    bpe.run()
    expect(bpe.decode(bpe.encode('  Newer   LOWEST wider ').map((p) => p.id))).toBe('newer lowest wider')
    expect(bpe.decode(bpe.encode(CLASSIC).map((p) => p.id))).toBe(CLASSIC)
    expect(bpe.encode(CLASSIC)).toHaveLength(16)
  })

  it('shows a character never seen in training as unknown, id 0', () => {
    const bpe = new Bpe('ab ab')
    bpe.run()
    const pieces = bpe.encode('abz')
    expect(pieces.map((p) => [show(p.text), p.id, p.unknown])).toEqual([
      ['ab', 4, false],
      ['z', 0, true],
      ['_', 3, false]
    ])
    expect(bpe.decode(pieces.map((p) => p.id))).toBe('ab�')
    expect(bpe.decode([99, -1])).toBe('��')
    expect(bpe.encode('')).toEqual([])
  })

  it('never makes the text, or a sentence, longer', () => {
    const rand = mulberry32(8)
    for (let k = 0; k < 30; k++) {
      const model = new Bpe(randomText(rand, 'abcd', 50), { merges: 60 })
      const sentence = randomText(rand, 'abcdx', 6)
      let text = model.length
      let own = model.encode(sentence).length
      for (let m = model.step(); m; m = model.step()) {
        expect(m.count).toBeGreaterThanOrEqual(2)
        expect(m.length).toBeLessThan(text)
        expect(m.length).toBe(model.length)
        text = m.length
        const now = model.encode(sentence).length
        expect(now).toBeLessThanOrEqual(own)
        own = now
        expect(model.vocab).toHaveLength(1 + model.alphabet + model.merges.length)
      }
      expect(model.finished).not.toBeNull()
    }
  })

  it('stops when no pair occurs twice, when words are whole, or at the number asked for', () => {
    const once = new Bpe('abc def')
    expect(once.finished).toBe('Finished after 0 merges: no pair occurs more than once')
    expect(once.step()).toBeNull()
    const few = new Bpe(CLASSIC, { merges: 3 })
    expect(few.run()).toBe(3)
    expect(few.finished).toBe('Stopped after 3 merges, the number asked for')
    expect(few.step()).toBeNull()
    const one = new Bpe('ab ab x', { merges: 1 })
    one.run()
    expect(one.finished).toBe('Stopped after 1 merge, the number asked for')
    const whole = new Bpe('ab ab')
    whole.run()
    expect(whole.finished).toBe('Finished after 2 merges: every word is one token, so there are no pairs left')
    expect(new Bpe('').finished).toBe('There is no text to learn from')
    expect(new Bpe('   ').step()).toBeNull()
  })

  it('is deterministic', () => {
    const run = () => {
      const bpe = new Bpe('the cat sat on the mat. the cat ate the rat.')
      bpe.run()
      return [bpe.merges, bpe.vocab, bpe.encode('that cat')]
    }
    expect(run()).toEqual(run())
  })

  it('handles accents and emoji as whole characters', () => {
    const bpe = new Bpe('Café café café 🙂 🙂 naïve 👩‍🚀 👩‍🚀', { merges: 60 })
    // The decomposed e + combining accent is the same word as the composed one
    expect(bpe.forms.find((f) => f.symbols.join('') === `café${END}`)!.count).toBe(3)
    expect(bpe.vocab).toContain('🙂')
    expect(bpe.vocab).toContain('é')
    expect(bpe.vocab.every((t) => !/^[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]$/.test(t))).toBe(true)
    expect(shown(symbolsOf('🙂é'))).toEqual(['🙂', 'é', '_'])
    bpe.run()
    expect(bpe.finished).toMatch(/^Finished/)
    expect(bpe.decode(bpe.encode('café 🙂 👩‍🚀').map((p) => p.id))).toBe('café 🙂 👩‍🚀')
    expect(bpe.encode('🙃 señor').filter((p) => p.unknown).map((p) => p.text)).toEqual(['🙃', 's', 'ñ', 'o', 'r'])
    const kept = new Bpe('Aa Aa', { lowercase: false })
    expect(shown(kept.vocab)).toEqual(['<unk>', 'A', 'a', '_'])
    expect(shown(new Bpe('Aa Aa').vocab)).toEqual(['<unk>', 'a', '_'])
  })

  it('tidies text without cutting a character in half', () => {
    expect(tidy('  A\tb\n\nC  ', 100, true)).toBe('a b c')
    expect(tidy('  A\tb\n\nC  ', 100, false)).toBe('A b C')
    const cut = tidy('🙂'.repeat(700), 600, true)
    expect(Array.from(cut)).toHaveLength(600)
    expect(Array.from(cut).every((c) => c === '🙂')).toBe(true)
    // The model's own end-of-word symbol cannot be smuggled in
    expect(tidy(`a${END}b`, 100, true)).toBe('a b')
    expect(new Bpe('x'.repeat(2000)).text).toHaveLength(BPE_LIMITS.text)
  })
})

describe('tokeniser: spec', () => {
  it('gives a good simulation from the kind alone', () => {
    expect(spec({})).toMatchObject({ kind: 'tokeniser', text: DEFAULT_TEXT, sentence: DEFAULT_SENTENCE, merges: 24, start: 0, lowercase: true, tour: [] })
    expect(DEFAULT_TEXT).toBe(CLASSIC)
    expect(parseSim('{"kind":"tokenizer"}')!.kind).toBe('tokeniser')
    expect(parseSim('{"kind":"bpe"}')!.kind).toBe('tokeniser')
  })

  it('reads text, sentence, merges and case, with aliases', () => {
    const s = spec({ corpus: '  The cat\nsat.  The CAT ', input: 'A Cat', maxMerges: 5, start: 2 })
    expect(s).toMatchObject({ text: 'the cat sat. the cat', sentence: 'a cat', merges: 5, start: 2, lowercase: true })
    expect(spec({ text: 'The Cat', lowercase: false })).toMatchObject({ text: 'The Cat', lowercase: false })
    expect(spec({ text: ['low', 'lower'], sentence: ['lo', 'w'] })).toMatchObject({ text: 'low lower', sentence: 'lo w' })
    // With a text but no sentence, the sentence is the first words of the text
    expect(spec({ text: 'one two three four five six' }).sentence).toBe('one two three four')
  })

  it('clamps and caps, and survives junk', () => {
    expect(spec({ merges: 0 }).merges).toBe(1)
    expect(spec({ merges: 5000 }).merges).toBe(60)
    expect(spec({ merges: 'lots' }).merges).toBe(24)
    expect(spec({ merges: 4, start: 99 }).start).toBe(4)
    expect(spec({ start: -3 }).start).toBe(0)
    expect(spec({ text: 'ab '.repeat(1000) }).text.length).toBeLessThanOrEqual(BPE_LIMITS.text)
    expect(spec({ sentence: 'x'.repeat(1000) }).sentence).toHaveLength(BPE_LIMITS.sentence)
    expect(spec({ text: 42, sentence: { a: 1 }, lowercase: 'maybe' })).toMatchObject({ text: '42', sentence: '42', lowercase: true })
    expect(spec({ text: null, sentence: null })).toMatchObject({ text: DEFAULT_TEXT, sentence: DEFAULT_SENTENCE })
    expect(spec({ text: '   ' }).text).toBe(DEFAULT_TEXT)
  })

  it('keeps its own tour verbs and drops the rest', () => {
    const s = spec({ tour: [{ at: 'Pair:1', say: 'Count.', do: { run: 2, sentence: 'the cat', text: 'a b', explode: true } }, { say: 'Nothing.', do: { insert: 1 } }] })
    expect(s.tour[0]).toEqual({ at: 'pair:1', say: 'Count.', do: { run: 2, sentence: 'the cat', text: 'a b' } })
    expect(s.tour[1].do).toBeUndefined()
  })
})

describe('tokeniser: parts', () => {
  const sentence = 'newer lowest xyz'

  it('parses the names', () => {
    const bpe = new Bpe(CLASSIC)
    bpe.run(3)
    const parse = (name: string) => parseTokeniserPart(name, bpe, sentence)
    expect(parse('text')).toEqual({ type: 'text' })
    expect(parse(' Pairs ')).toEqual({ type: 'pairs' })
    expect(parse('merges')).toEqual({ type: 'merges' })
    expect(parse('vocabulary')).toEqual({ type: 'vocabulary' })
    expect(parse('vocab')).toEqual({ type: 'vocabulary' })
    expect(parse('sentence')).toEqual({ type: 'sentence' })
    expect(parse('length')).toEqual({ type: 'length' })
    expect(parse('pair:1')).toEqual({ type: 'pair', n: 1 })
    expect(parse(`pair:${bpe.pairs().length}`)).not.toBeNull()
    expect(parse(`pair:${bpe.pairs().length + 1}`)).toBeNull()
    expect(parse('pair:0')).toBeNull()
    expect(parse('merge:3')).toEqual({ type: 'merge', n: 3 })
    expect(parse('merge:4')).toBeNull()
    expect(parse('token:1')).toEqual({ type: 'token', n: 1 })
    expect(parse(`token:${bpe.encode(sentence).length + 1}`)).toBeNull()
    expect(parse('token:x')).toBeNull()
    expect(parse('token:1:2')).toBeNull()
    expect(parse('nonsense')).toBeNull()
  })

  it('describes each part with its current numbers', () => {
    const bpe = new Bpe(CLASSIC)
    const say = (name: string) => describeTokeniserPart(parseTokeniserPart(name, bpe, sentence)!, bpe, sentence)
    expect(say('pair:1').label).toBe('the pair e + s, rank 1 in the counts (it occurs 9 times and is merged next; it ties with 2 others and wins by appearing first in the text)')
    expect(say('pair:4').label).toBe('the pair w + e, rank 4 in the counts (it occurs 8 times)')
    expect(say('merges').label).toBe('the merges learnt so far (0 of at most 24, applied in this order when encoding)')
    bpe.run(3)
    expect(say('text').label).toBe('the training text (16 words, now 68 tokens, down from 95 single characters and end-of-word marks)')
    expect(say('length')).toEqual({ label: 'the length of the training text in tokens (68 now, 95 at the start: 1.40 times shorter)', values: { tokens: 68, start: 95, ratio: 1.4, merges: 3 } })
    expect(say('pairs').label).toBe('the pair counts (12 different adjacent pairs; the most frequent is l + o, 7 times)')
    expect(say('pairs').values).toMatchObject({ 'l + o': 7, 'o + w': 7 })
    expect(say('merge:3')).toEqual({ label: 'merge 3, est + _ → est_ (the pair occurred 9 times; the new token has id 14)', values: { merge: 3, token: 'est_', id: 14, count: 9, textTokens: 68 } })
    expect(say('vocabulary').label).toBe('the vocabulary (15 tokens: <unk>, 11 single characters including the end-of-word mark, and 3 merged)')
    // newer lowest xyz → n e w e r _ | l o w est_ | x y z _
    expect(say('sentence').label).toBe('the sentence "newer lowest xyz" split into 14 tokens with the 3 merges learnt so far (3 unknown)')
    expect(say('token:1').label).toBe('token 1 of the sentence, "n" (id 7, a single character)')
    expect(say('token:6').label).toBe('token 6 of the sentence, "_" (id 4, the end-of-word mark)')
    expect(say('token:10')).toEqual({ label: 'token 10 of the sentence, "est_" (id 14, made by merge 3: est + _)', values: { token: 'est_', id: 14, word: 2, merge: 3 } })
    expect(say('token:11').label).toBe('token 11 of the sentence, "x" (a character never seen in training, so it has no token and is encoded as <unk>, id 0)')
    bpe.run()
    expect(say('pairs').label).toBe('the pair counts (there are no adjacent pairs left)')
    expect(parseTokeniserPart('pair:1', bpe, sentence)).toBeNull()
  })
})
