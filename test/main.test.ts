import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-test' } }))

const { chunkMarkdown } = await import('../src/main/search')
const { parseFlashcards, scheduleAfter, previewFor } = await import('../src/main/study')
const { extractJsonArray } = await import('../src/main/ai')
const { youtubeId } = await import('../src/main/library')
const { parseNote } = await import('../src/main/vault')
const { titleFromUrl, leetcodeUrl } = await import('../src/main/practice')
const { cardsToMarkdown } = await import('../src/shared/cards')

describe('chunkMarkdown', () => {
  it('splits by headings and drops frontmatter', () => {
    const md = `---\ntitle: Logs\n---\nIntro text\n\n## Part 1\nAlpha\n\n## Part 2\nBeta`
    const chunks = chunkMarkdown('a.md', 'Logs', md)
    expect(chunks.map((c) => c.heading)).toEqual(['', 'Part 1', 'Part 2'])
    expect(chunks[0].text).toBe('Intro text')
    expect(chunks.some((c) => c.text.includes('title:'))).toBe(false)
  })

  it('ignores headings inside code fences', () => {
    const chunks = chunkMarkdown('a.md', 'T', '## Real\n```py\n# comment\n```\nafter')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain('# comment')
  })

  it('splits long sections into several chunks', () => {
    const para = 'word '.repeat(200)
    const chunks = chunkMarkdown('a.md', 'T', `## Long\n${para}\n\n${para}\n\n${para}`)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.heading === 'Long')).toBe(true)
  })
})

describe('parseFlashcards', () => {
  it('reads single line, reversed and multi-line cards', () => {
    const md = [
      '#flashcards',
      'What is a log?::The inverse of an exponent',
      '- Big O of binary search:::O(log n)',
      '',
      'Define a hash map',
      '?',
      'A structure mapping keys to values',
      'using a hash function',
      '',
      'Unrelated paragraph'
    ].join('\n')
    const cards = parseFlashcards('n.md', md)
    expect(cards.map((c) => [c.front, c.back])).toEqual([
      ['What is a log?', 'The inverse of an exponent'],
      ['Big O of binary search', 'O(log n)'],
      ['O(log n)', 'Big O of binary search'],
      ['Define a hash map', 'A structure mapping keys to values\nusing a hash function']
    ])
  })

  it('skips code and strips plugin schedule comments', () => {
    const md = 'Use `std::vector` here\n```\na::b\n```\nQ::A <!--SR:!2026-01-01,3,250-->'
    const cards = parseFlashcards('n.md', md)
    expect(cards).toHaveLength(1)
    expect(cards[0].back).toBe('A')
  })

  it('gives stable ids', () => {
    expect(parseFlashcards('n.md', 'Q::A')[0].id).toBe(parseFlashcards('n.md', 'Q::B')[0].id)
  })

  it('round trips generated cards', () => {
    const cards = [
      { front: 'One', back: 'Two' },
      { front: 'Multi', back: 'line\nanswer' }
    ]
    const parsed = parseFlashcards('n.md', cardsToMarkdown(cards))
    expect(parsed.map((c) => ({ front: c.front, back: c.back }))).toEqual(cards)
  })
})

describe('FSRS scheduling', () => {
  const now = new Date('2026-11-01T10:00:00Z')
  const day = 86_400_000
  it('grows intervals with successful reviews', () => {
    let r = scheduleAfter(undefined, 'good', now)
    const intervals: number[] = []
    let t = now.getTime()
    for (let k = 0; k < 4; k++) {
      t = r.schedule.due
      r = scheduleAfter(r.stored, 'good', new Date(t))
      intervals.push(r.schedule.interval)
    }
    expect(intervals[3]).toBeGreaterThan(intervals[1])
    expect(intervals[3]).toBeGreaterThan(5)
  })
  it('counts lapses and shortens the interval on again', () => {
    let r = scheduleAfter(undefined, 'easy', now)
    r = scheduleAfter(r.stored, 'good', new Date(r.schedule.due))
    const before = r.schedule.interval
    r = scheduleAfter(r.stored, 'again', new Date(r.schedule.due))
    expect(r.schedule.lapses).toBe(1)
    expect(r.schedule.interval).toBeLessThan(before)
  })
  it('migrates SM-2 schedules and previews every grade', () => {
    const old = { due: now.getTime() + 2 * day, interval: 6, ease: 2.5, reps: 3, lapses: 0 }
    const p = previewFor(old, new Date(now.getTime() + 2 * day))
    expect(p.again).toBeLessThan(p.hard)
    expect(p.hard).toBeLessThanOrEqual(p.good)
    expect(p.good).toBeLessThan(p.easy)
  })
})

describe('cloze cards', () => {
  it('makes one card per Anki cloze group, with hints', () => {
    const cards = parseFlashcards('n.md', 'The {{c1::Pythagoreans}} proved {{c2::sqrt 2::a number}} is irrational')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ cloze: true, front: 'The **[…]** proved sqrt 2 is irrational', back: 'The Pythagoreans proved sqrt 2 is irrational' })
    expect(cards[1].front).toBe('The Pythagoreans proved **[a number]** is irrational')
  })
  it('turns ==highlights== into clozes only when asked', () => {
    expect(parseFlashcards('n.md', 'A ==hash map== maps keys to ==values==')).toHaveLength(0)
    const cards = parseFlashcards('n.md', 'A ==hash map== maps keys to ==values==', { highlightClozes: true })
    expect(cards.map((c) => c.front)).toEqual(['A **[…]** maps keys to values', 'A hash map maps keys to **[…]**'])
  })
})

describe('extractJsonArray', () => {
  it('finds JSON inside prose and fences', () => {
    expect(extractJsonArray<{ a: number }>('Sure!\n```json\n[{"a":1}]\n```\nDone')).toEqual([{ a: 1 }])
  })
  it('repairs unescaped LaTeX without breaking escaped LaTeX or JSON escapes', () => {
    const reply = String.raw`[{"front": "What is $\log_2 8$?", "back": "$3$, since $\frac{8}{2^3}=1$ and \theta is unrelated\nnext"}, {"front": "ok", "back": "$\\sqrt{x}$ \"quoted\""}]`
    const cards = extractJsonArray<{ front: string; back: string }>(reply)
    expect(cards[0].front).toBe('What is $\\log_2 8$?')
    expect(cards[0].back).toContain('$\\frac{8}{2^3}=1$')
    expect(cards[0].back).toContain('\\theta')
    expect(cards[1].back).toBe('$\\sqrt{x}$ "quoted"')
  })

  it('throws a readable error when there is no list', () => {
    expect(() => extractJsonArray('no json')).toThrow(/did not return a list/)
  })
})

describe('youtubeId', () => {
  it('handles the common URL shapes', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://youtu.be/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://m.youtube.com/shorts/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://example.com/watch?v=x')).toBeNull()
  })
})

describe('parseNote', () => {
  it('reads title, tags and source info', () => {
    const meta = parseNote(
      'Library/Videos/x.md',
      '---\ntitle: "Logs"\nsource: "https://youtu.be/x"\nsource_type: "youtube"\ntags:\n  - video\n---\n# Heading\nText #math/algebra',
      1
    )
    expect(meta.title).toBe('Logs')
    expect(meta.sourceType).toBe('youtube')
    expect(meta.sourceUrl).toBe('https://youtu.be/x')
    expect(meta.tags.sort()).toEqual(['math/algebra', 'video'])
  })
  it('falls back to the first heading, then file name', () => {
    expect(parseNote('a/My Note.md', '# Real title\nbody', 1).title).toBe('Real title')
    expect(parseNote('a/My Note.md', 'body', 1).title).toBe('My Note')
  })
})

describe('practice', () => {
  it('turns LeetCode links into titles and back', () => {
    expect(titleFromUrl('https://leetcode.com/problems/search-in-rotated-sorted-array/description/')).toBe('Search in Rotated Sorted Array')
    expect(titleFromUrl('https://example.com')).toBeNull()
    expect(leetcodeUrl('Implement Trie (Prefix Tree)')).toBe('https://leetcode.com/problems/implement-trie-prefix-tree/')
  })
})
