import { describe, expect, it } from 'vitest'
import { normalizeOutlineDraft, parseOutline } from '../src/shared/outline'

describe('normalizeOutlineDraft', () => {
  it('keeps headings, topics and resources and drops the chatter around them', () => {
    const raw = `Sure! Here is a study outline for data engineering.

\`\`\`markdown
# Data Engineering

## Part 1: Foundations

### 1. Storage

1. **Row vs column** storage
- [x] Data lakes and warehouses
  - _Designing Data-Intensive Applications — Martin Kleppmann_
  - [ ] Lakehouse formats

### Streaming
* Kafka basics
\`\`\`

Let me know if you want more detail!`
    const out = normalizeOutlineDraft(raw)
    expect(out).toBe(`## Part 1: Foundations

### Storage

- [ ] Row vs column storage
- [ ] Data lakes and warehouses
    - _Designing Data-Intensive Applications — Martin Kleppmann_
    - [ ] Lakehouse formats

### Streaming

- [ ] Kafka basics
`)
    const items = parseOutline(out).lines.filter((l) => l.kind === 'item')
    expect(items.every((l) => l.kind === 'item' && (l.checked === false || l.checked === null))).toBe(true)
  })

  it('keeps several top-level headings as sections', () => {
    expect(normalizeOutlineDraft('# A\n- one\n# B\n- two')).toBe('## A\n\n- [ ] one\n\n## B\n\n- [ ] two\n')
  })

  it('gives stray topics a section and removes thinking', () => {
    expect(normalizeOutlineDraft('<think>plan</think>\n- alpha\n- beta')).toBe('## Topics\n\n- [ ] alpha\n- [ ] beta\n')
  })

  it('returns an empty outline for pure prose', () => {
    expect(normalizeOutlineDraft('I cannot help with that.').trim()).toBe('')
  })
})

import { joinSource, linkItemText, retitleItem, splitSource, topicTitle } from '../src/shared/outline'

describe('topic sources', () => {
  it('splits and rejoins a trailing source', () => {
    expect(splitSource('Test coverage — _Python Testing with pytest_')).toEqual({ main: 'Test coverage', source: 'Python Testing with pytest' })
    expect(splitSource('Git basics: commits, branches')).toEqual({ main: 'Git basics: commits, branches', source: null })
    expect(joinSource('A', 'B')).toBe('A — _B_')
    expect(splitSource('cProfile and line_profiler — _High Performance Python; cProfile + snakeviz; line_profiler_')).toEqual({
      main: 'cProfile and line_profiler',
      source: 'High Performance Python; cProfile + snakeviz; line_profiler'
    })
  })

  it('keeps the source and link when retitling or linking', () => {
    const t = 'Pandas — _Python for Data Analysis (McKinney, 3rd ed.)_'
    expect(topicTitle(t)).toBe('Pandas')
    const linked = linkItemText(t, 'Pandas basics')
    expect(linked).toBe('[[Pandas basics|Pandas]] — _Python for Data Analysis (McKinney, 3rd ed.)_')
    expect(retitleItem(linked, 'Pandas DataFrames')).toBe('[[Pandas basics|Pandas DataFrames]] — _Python for Data Analysis (McKinney, 3rd ed.)_')
    expect(topicTitle(linked)).toBe('Pandas')
    expect(retitleItem('Plain topic', 'Renamed')).toBe('Renamed')
  })
})
