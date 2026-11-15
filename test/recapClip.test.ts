import { describe, expect, it } from 'vitest'
import { bestSection, coversTopic, RECAP, type Line } from '../src/shared/video'

const at = (texts: string[]): Line[] => texts.map((text, i) => ({ start: i * 6, end: i * 6 + 6, text }))

// What MIT's "1: Introduction to Neural Networks and Deep Learning" says around 24:52: logistic
// regression, with "binary" and "representations" in it, and nothing on number bases
const nnTitle = '1: Introduction to Neural Networks and Deep Learning; Training Deep NNs'
const nnLines = at([
  'so the simplest case is a binary classification problem',
  'the output is a number between zero and one, a probability',
  'that is logistic regression, the sigmoid of a linear function',
  'and the network learns representations of the input',
  'each layer builds more abstract representations',
  'we have a binary label, zero or one, for every example',
  'so the loss is the binary cross entropy',
  'and we take the number of examples to average it',
  'the representations in the hidden layers are learned',
  'binary outputs again for the logistic unit'
])

const topic = 'Binary, hexadecimal, number representations'

describe('the recap clip at the end of a lesson', () => {
  it('never offers a neural-network lecture for a lesson on binary and hex', () => {
    const s = bestSection(nnLines, topic, RECAP)
    // The old rule let this through: a high enough score from "binary", "number" and "representations"
    expect(s && s.score).toBeGreaterThan(0.45)
    expect(coversTopic(topic, { title: nnTitle, text: s!.text })).toBe(false)
  })

  it('rejects the very clip the user was shown (24:55-25:31 of that lecture)', () => {
    const said =
      'So what is logistic regression? You send in a bunch of numbers-- a vector of numbers-- and you usually get a probability out-- between 0 and 1, what is the probability of something or the other? And so this logistic regression model is also represented in this form, if you will recall. So basically, what we do is we take all these numbers, we run it through a linear function, you get a number, and'
    expect(coversTopic(topic, { title: nnTitle, text: said })).toBe(false)
  })

  it('offers a clip that really is about binary and hexadecimal', () => {
    const lines = at([
      'in binary each position is worth a power of two',
      'hexadecimal groups four binary digits into one hex digit',
      'so F in hex is 1111 in binary, fifteen',
      'and a byte is two hex digits'
    ])
    const s = bestSection(lines, topic, RECAP)!
    expect(coversTopic(topic, { title: 'Number systems', text: s.text })).toBe(true)
    // Named in the title and said in the clip
    expect(coversTopic(topic, { title: 'Binary and hexadecimal explained', text: 'and the hex digit F is fifteen' })).toBe(true)
  })

  it('needs the topic, not a shared word: one key word of two is not enough', () => {
    expect(coversTopic('Logistic regression', { title: 'Linear models', text: 'linear regression fits a line by least squares' })).toBe(false)
    expect(coversTopic('Logistic regression', { title: 'Lecture 3', text: 'logistic regression puts a sigmoid on a linear regression' })).toBe(true)
    expect(coversTopic('', { title: 'Anything', text: 'anything' })).toBe(false)
  })
})
