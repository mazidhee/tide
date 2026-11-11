import { describe, expect, it } from 'vitest'
import { applyResourceChecks, outlineResources } from '../src/shared/outline'

const md = `## Phase 1: Foundations

### Python Basics

- [ ] Variables and Data Types
- [ ] Loops
    - *Python Programming_Book_Series_by_John_Zelle_and_Spiro_Sideras*

### NumPy

- [ ] Arrays
    - _NumPy Documentation — NumPy Project_
    - a plain detail line
`

describe('roadmap resource lines', () => {
  it('reads the title and author of each italic line under a topic', () => {
    expect(outlineResources(md)).toEqual([
      { line: 6, title: 'Python Programming Book Series', by: 'John Zelle and Spiro Sideras' },
      { line: 11, title: 'NumPy Documentation', by: 'NumPy Project' }
    ])
  })
  it('drops what could not be found and rewrites what was', () => {
    const out = applyResourceChecks(md, [
      { line: 6, title: 'Python Programming Book Series', by: 'John Zelle and Spiro Sideras', ok: false },
      { line: 11, title: 'NumPy Documentation', by: 'NumPy', ok: true }
    ])
    expect(out).not.toMatch(/Sideras/)
    expect(out).toMatch(/^    - _NumPy Documentation — NumPy_$/m)
    expect(out).toMatch(/a plain detail line/)
    expect(out).toMatch(/- \[ \] Loops/)
  })
})
