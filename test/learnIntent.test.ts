import { describe, expect, it } from 'vitest'
import { learnIntent } from '../src/shared/learnIntent'

describe('asking to learn a subject', () => {
  it('turns "I want to learn X" into a plan topic', () => {
    expect(learnIntent('i want to learn how to build a local llm from scratch, teach me')?.topic).toBe('How to build a local llm from scratch')
    expect(learnIntent('I want to learn stablecoins and payment rails.')?.topic).toBe('Stablecoins and payment rails')
    expect(learnIntent('Teach me Metabase')?.topic).toBe('Metabase')
    expect(learnIntent('Make me a roadmap for distributed systems')?.topic).toBe('Distributed systems')
    expect(learnIntent('how do I learn MongoDB?')?.topic).toBe('MongoDB')
    expect(learnIntent("I'd like to master options pricing")?.topic).toBe('Options pricing')
  })
  it('leaves ordinary questions alone', () => {
    expect(learnIntent('What is a hash map?')).toBeNull()
    expect(learnIntent('Explain the CAP theorem')).toBeNull()
    expect(learnIntent('teach me')).toBeNull()
    expect(learnIntent('I want to know why my test fails')).toBeNull()
  })
})

import { thingsIntent } from '../src/shared/learnIntent'

describe('Things 4 intent', () => {
  it('spots work to set or mark in Things', () => {
    expect(thingsIntent('Set me a take-home on hash maps, due Friday')).toBe('assign')
    expect(thingsIntent('put a task in Things 4 to read chapter 3')).toBe('assign')
    expect(thingsIntent('add it to my Things please')).toBe('assign')
    expect(thingsIntent('Mark my take-home in Things')).toBe('mark')
    expect(thingsIntent('give me an assignment on recursion')).toBe('assign')
  })
  it("doesn't mistake the everyday word for the app", () => {
    expect(thingsIntent('Retest me on the 2 things I got wrong before.')).toBeNull()
    expect(thingsIntent('a few things confuse me about pointers')).toBeNull()
    expect(thingsIntent('teach me things about logarithms')).toBeNull()
    expect(thingsIntent('what are the things to know about TCP?')).toBeNull()
  })

  it('leaves Metabase to the tutor, which can look inside it', () => {
    expect(learnIntent('Teach me our Metabase: what does the collections dashboard show?')).toBeNull()
    expect(learnIntent("teach me rank's metabase")).toBeNull()
    expect(learnIntent('Teach me Metabase')?.topic).toBe('Metabase')
  })
})
