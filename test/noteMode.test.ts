import { describe, expect, it } from 'vitest'
import { isReadingMaterial, noteOpenMode } from '../src/shared/noteMode'

describe('notes open in write mode', () => {
  it('opens your own notes to write in by default', () => {
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {} })).toBe('write')
    expect(noteOpenMode({ path: 'Lessons/Number bases.md', props: {} })).toBe('write')
  })

  it('follows Settings when it says read', () => {
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {}, setting: 'read' })).toBe('read')
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {}, setting: 'write' })).toBe('write')
  })

  it('keeps what you chose for a note over the default and over reading material', () => {
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {}, chosen: 'read' })).toBe('read')
    expect(noteOpenMode({ path: 'Library/Articles/Some article.md', props: { source: 'https://example.com' }, chosen: 'write' })).toBe('write')
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {}, chosen: 'write', setting: 'read' })).toBe('write')
  })

  it('opens course material, saved sources, readings and lesson pages to read', () => {
    expect(noteOpenMode({ path: 'Courses/MIT 6.006/01 Intro/01 Peak finding.md', props: {} })).toBe('read')
    expect(noteOpenMode({ path: 'Library/Videos/A talk.md', props: {} })).toBe('read')
    expect(noteOpenMode({ path: 'Reading/A paper.md', props: { source: 'https://arxiv.org/abs/1', source_type: 'doc' } })).toBe('read')
    expect(noteOpenMode({ path: 'Lessons/2026-11-12 Binary.md', props: { tide_lesson: 'abc', tags: '[lesson]' } })).toBe('read')
    expect(noteOpenMode({ path: 'Notes/x.md', props: { tags: 'reading, maths' } })).toBe('read')
  })

  it('honours a library folder set in Settings', () => {
    expect(isReadingMaterial('Saved/Clip.md', {}, 'Saved')).toBe(true)
    expect(isReadingMaterial('Library/Clip.md', {}, 'Saved')).toBe(false)
  })

  it('opens to read when sent to a passage, so it can be found and shown', () => {
    expect(noteOpenMode({ path: 'Maths/Binary.md', props: {}, anchor: 'Two’s complement', chosen: 'write' })).toBe('read')
  })

  it('treats ordinary tags and empty fields as your own note', () => {
    expect(isReadingMaterial('Maths/Binary.md', { tags: 'maths, book', source: '' })).toBe(false)
  })
})
