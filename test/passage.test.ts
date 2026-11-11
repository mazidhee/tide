// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { lessonMarkdown } from '../src/shared/lessonLog'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { passageSaying } from '../src/renderer/src/lib/passage'

describe('opening a lesson’s page at a question', () => {
  const page = lessonMarkdown({
    id: 'l',
    mode: 'teach',
    topic: 'Hash tables',
    scope: { kind: 'folder', path: 'Algorithms' },
    started: Date.UTC(2026, 10, 1),
    updated: Date.UTC(2026, 10, 1),
    turns: [
      { role: 'user', content: 'Teach me.' },
      { role: 'assistant', content: 'A hash function maps a key to a slot.\n\n<ask type="short">What does a hash function return for a key?</ask>' },
      { role: 'user', content: 'Answer: a slot' },
      { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<ask type="short">Two keys land in one slot: how does `chaining` handle the collisions, and what does it cost when the lists grow long?</ask>' }
    ]
  })
  const root = document.createElement('article')
  root.innerHTML = renderMarkdown(page.replace(/^---[\s\S]*?---\n/, ''), { notePath: 'Lessons/x.md', filesByName: new Map() })

  it('finds the innermost passage asking it, from the question as kept (cut short, without Markdown)', () => {
    const el = passageSaying(root, 'Two keys land in one slot: how does chaining handle the collisions, and what does it cost when…')!
    expect(el).not.toBeNull()
    expect(el.tagName).toBe('P')
    expect(el.textContent).toContain('how does chaining handle the collisions')
    expect(passageSaying(root, 'What does a hash function return for a key?')!.textContent).toContain('What does a hash function return')
  })

  it('finds nothing for a question that isn’t there, or too short to tell', () => {
    expect(passageSaying(root, 'Why is the sky blue on a clear afternoon?')).toBeNull()
    expect(passageSaying(root, 'Two')).toBeNull()
  })
})
