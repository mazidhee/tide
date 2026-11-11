// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { addTakeaways, newLessonNote } from '@shared/lessonNotes'

describe('the lesson notes panel, read', () => {
  it('draws a takeaway’s bold and maths rather than showing ** and $', () => {
    const note = addTakeaways(newLessonNote('Floats'), ['**0.1 + 0.2** is not exactly $0.3$ in binary floating point'])
    const html = renderMarkdown(note, { notePath: 'Lessons/Floats.md', filesByName: new Map() })
    expect(html).toContain('<strong>0.1 + 0.2</strong>')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('**')
  })
})
