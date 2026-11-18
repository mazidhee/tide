import { describe, expect, it } from 'vitest'
import { autoLabel } from '../src/shared/claude'

const base = { teaching: true, teachModel: 'sonnet', cloudAuto: true, cloudName: 'GPT-OSS 120B' }

describe('the model picker names the model in use', () => {
  it('names the model that answered the last reply, Haiku included', () => {
    expect(autoLabel({ ...base, answeredBy: 'Claude Haiku' })).toBe('Auto (Claude Haiku)')
    expect(autoLabel({ ...base, answeredBy: 'Gemma' })).toBe('Auto (Gemma)')
  })
  it('before any reply, names the model Auto asks first', () => {
    expect(autoLabel(base)).toBe('Auto (Claude Sonnet)')
    expect(autoLabel({ ...base, teachModel: 'haiku' })).toBe('Auto (Claude Haiku)')
    expect(autoLabel({ ...base, teaching: false })).toBe('Auto (Gemma or GPT-OSS 120B)')
    expect(autoLabel({ ...base, teaching: false, cloudAuto: false })).toBe('Gemma')
  })
  it('never says a bare "Auto"', () => {
    for (const teaching of [true, false]) for (const cloudAuto of [true, false]) expect(autoLabel({ ...base, teaching, cloudAuto })).not.toBe('Auto')
  })
})
