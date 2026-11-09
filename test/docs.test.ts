import { describe, expect, it } from 'vitest'
import { pageId, parsePage, searchDocs, sections, segments } from '../src/shared/docs'

const raw = `---
title: A study day
group: Walkthroughs
summary: From morning to evening.
---
Intro text.

\`\`\`walkthrough
Your day
home | 27,20,62,9 | Open Tide | **Open Tide.** Home greets you. | home
home | 1,2,3 | Broken | skipped
learn | 36,20,44,19 | Learn | Pick a mode.
\`\`\`

![Home with your day](img/home.jpg)

## Morning: what's due
Daily practice mixes flashcards and retests.

\`\`\`animation
ladder: P1, P2, Mixed
\`\`\`
`

describe('the guide in Help', () => {
  it('reads a page and its front matter', () => {
    const p = parsePage('docs/guide/10-flow-day.md', raw)
    expect(pageId('10-flow-day.md')).toBe('flow-day')
    expect([p.id, p.title, p.group, p.summary]).toEqual(['flow-day', 'A study day', 'Walkthroughs', 'From morning to evening.'])
    expect(sections(p.body)).toEqual(["Morning: what's due"])
  })

  it('turns walkthroughs, animations and screenshots into parts of the page', () => {
    const s = segments(parsePage('x.md', raw).body)
    expect(s.map((x) => x.kind)).toEqual(['md', 'walk', 'figure', 'md', 'anim'])
    const walk = s[1] as Extract<(typeof s)[number], { kind: 'walk' }>
    expect(walk.title).toBe('Your day')
    expect(walk.steps.map((x) => x.label)).toEqual(['Open Tide', 'Learn'])
    expect(walk.steps[0]).toMatchObject({ image: 'home', hot: [27, 20, 62, 9], open: 'home' })
    expect(walk.steps[1].open).toBeUndefined()
    expect(s[2]).toEqual({ kind: 'figure', image: 'home', caption: 'Home with your day' })
    expect(s[4]).toEqual({ kind: 'anim', anim: 'ladder', labels: ['P1', 'P2', 'Mixed'] })
  })

  it('finds pages and sections, best match first', () => {
    const pages = [parsePage('10-flow-day.md', raw), parsePage('26-library.md', '---\ntitle: The Library\n---\n## The bookcase\nShelves by subject with real covers.')]
    expect(searchDocs(pages, 'bookcase')[0]).toMatchObject({ page: 'library', section: 'The bookcase' })
    expect(searchDocs(pages, 'retests flashcards')[0]).toMatchObject({ page: 'flow-day', section: "Morning: what's due" })
    expect(searchDocs(pages, 'greets')[0].page).toBe('flow-day')
    expect(searchDocs(pages, '')).toEqual([])
  })
})
