import { describe, expect, it } from 'vitest'
import { recoverToolCalls } from '../src/shared/modelText'

describe('recovering Gemma tool calls from text', () => {
  it('reads a stuttered call the server returned as text', () => {
    const raw = '<|tool_call><|tool_call>call:run_code{code:<|"|>from sympy import *\nprint(6*sum(Rational(1,k) for k in range(1,7)))<|"|>,language:<|"|>python<|"|>}<tool_call|>'
    expect(recoverToolCalls(raw)).toEqual([{ name: 'run_code', arguments: JSON.stringify({ code: 'from sympy import *\nprint(6*sum(Rational(1,k) for k in range(1,7)))', language: 'python' }) }])
  })
  it('handles nested values, numbers and several calls', () => {
    const raw = 'ok <|tool_call>call:things_feedback{task:<|"|>Take-home: Dice<|"|>,complete:true,score:3.5,tags:[<|"|>a<|"|>,<|"|>b<|"|>],open:{type:<|"|>exam<|"|>}}<tool_call|> <|tool_call>call:things_tasks{}<tool_call|>'
    const calls = recoverToolCalls(raw)
    expect(calls.map((c) => c.name)).toEqual(['things_feedback', 'things_tasks'])
    expect(JSON.parse(calls[0].arguments)).toEqual({ task: 'Take-home: Dice', complete: true, score: 3.5, tags: ['a', 'b'], open: { type: 'exam' } })
  })
  it('ignores a call that was cut off', () => {
    expect(recoverToolCalls('<|tool_call>call:run_code{code:<|"|>print(1')).toEqual([])
    expect(recoverToolCalls('no calls here')).toEqual([])
  })
})
