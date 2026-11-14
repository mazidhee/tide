import { describe, expect, it } from 'vitest'
import { chooseTeacher, type TeacherInput } from '../src/main/teacher'
import { claudeModel, CLAUDE_DEFAULTS } from '../src/shared/claude'

const base: TeacherInput = { installed: true, ready: true }

describe('who teaches', () => {
  it('is Claude by default once it is set up', () => {
    expect(chooseTeacher(base)).toEqual({ who: 'claude' })
  })
  it('is Gemma, quietly, when Claude Code was never installed or chosen', () => {
    expect(chooseTeacher({ ...base, installed: false, ready: false })).toEqual({ who: 'gemma', why: undefined })
  })
  it('sends everything to Claude when it can teach, with no privacy gate', () => {
    for (const engine of ['auto', 'claude', undefined] as const)
      for (const notebook of ['claude', 'auto', undefined] as const)
        for (const setting of ['claude', undefined] as const) expect(chooseTeacher({ ...base, engine, notebook, setting }).who).toBe('claude')
    // An old caller's private flag changes nothing
    expect(chooseTeacher({ ...base, private: true } as TeacherInput)).toEqual({ who: 'claude' })
  })
  it('falls back to Gemma and says why when Claude can’t', () => {
    expect(chooseTeacher({ ...base, ready: false, notReady: 'not logged in' })).toMatchObject({ who: 'gemma', why: expect.stringMatching(/not logged in/) })
    expect(chooseTeacher({ ...base, engine: 'claude', installed: false, ready: false })).toMatchObject({ who: 'gemma', why: expect.stringMatching(/isn’t installed/) })
  })
  it('follows the lesson, then the notebook, then the setting', () => {
    expect(chooseTeacher({ ...base, engine: 'local' })).toEqual({ who: 'gemma' })
    expect(chooseTeacher({ ...base, engine: 'cloud' })).toEqual({ who: 'cloud' })
    expect(chooseTeacher({ ...base, notebook: 'gemma' })).toEqual({ who: 'gemma' })
    expect(chooseTeacher({ ...base, notebook: 'claude', setting: 'gemma' })).toEqual({ who: 'claude' })
    expect(chooseTeacher({ ...base, setting: 'gemma' })).toEqual({ who: 'gemma' })
    expect(chooseTeacher({ ...base, engine: 'claude', notebook: 'gemma' })).toEqual({ who: 'claude' })
  })
})

describe('which Claude model', () => {
  it('teaches on Sonnet, marks and plans on Opus, background on Haiku', () => {
    expect(CLAUDE_DEFAULTS).toEqual({ teach: 'sonnet', mark: 'opus', hard: 'opus', background: 'haiku', visual: 'claude-fable-5-1' })
    expect(claudeModel('teach', { models: { teach: 'opus' } })).toBe('opus')
    expect(claudeModel('teach', { models: { teach: 'opus' } }, 'claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(claudeModel('mark', undefined, 'haiku')).toBe('opus')
  })
})
