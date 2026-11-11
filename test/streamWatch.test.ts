import { describe, expect, it } from 'vitest'
import { isLooping, streamWatch } from '../src/shared/modelText'

// What the token loop used to work out from the whole stream on every token
const naive = (raw: string, text: string) => ({
  channels: raw.match(/<\|channel>/g)?.length ?? 0,
  inCall: raw.lastIndexOf('<|tool_call') > raw.lastIndexOf('<tool_call|>'),
  bareCall: /(^|\n)\s*call:[A-Za-z_]\w*\{/.test(text)
})

const streams = [
  'Hello <|channel>thought<channel|> answer <|tool_call>call:search{q:1}<tool_call|> more <|channel>again',
  'Plain text\nwith lines\n  call:read_webpage{url:"x"} and on',
  'call:x{ at the very start',
  '<|tool_call><|tool_call>open twice<tool_call|> then <|tool_call>left open',
  'no markers at all, just a long line '.repeat(80)
]

describe('following a stream token by token', () => {
  it('agrees with reading the whole stream every time, however the tokens are split', () => {
    for (const stream of streams) {
      for (const size of [1, 2, 3, 5, 11]) {
        const w = streamWatch()
        let raw = ''
        for (let i = 0; i < stream.length; i += size) {
          raw += stream.slice(i, i + size)
          const text = raw.replace(/<\|?[a-z_]+\|?>/g, '')
          w.raw(raw)
          w.text(text)
          expect({ channels: w.channels, inCall: w.inCall, bareCall: w.bareCall }).toEqual(naive(raw, text))
        }
      }
    }
  })

  it('still spots a loop at the end of a long reply, and only there', () => {
    const long = 'A sentence that moves the explanation along. '.repeat(400)
    expect(isLooping(long)).toBe(false)
    expect(isLooping(long + 'the the the the the the the the the the the the')).toBe(true)
    expect(isLooping(long + 'same line\n'.repeat(10))).toBe(true)
  })
})
