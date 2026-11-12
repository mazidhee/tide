import { describe, expect, it } from 'vitest'
import { applyHunks, gutterMarks, hunks, unified } from '../src/shared/hunks'
import { TEMPLATES } from '../src/shared/ideTemplates'
import { buildTree, fuzzyFilter, gitBadge, parentsOf, shiftBreakpoints, symbolPath, toggleBreakpoint } from '../src/renderer/src/lib/ide/tree'

describe('hunks between two texts', () => {
  const before = 'a\nb\nc\nd\ne\n'
  const after = 'a\nB\nc\nd\ne\nf\n'
  it('finds each change and applies any choice of them', () => {
    const hs = hunks(before, after)
    expect(hs).toHaveLength(2)
    expect(applyHunks(before, hs, () => true)).toBe(after)
    expect(applyHunks(before, hs, () => false)).toBe(before)
    expect(applyHunks(before, hs, (i) => i === 0)).toBe('a\nB\nc\nd\ne\n')
    expect(applyHunks(before, hs, (i) => i === 1)).toBe('a\nb\nc\nd\ne\nf\n')
  })

  it('handles a new file and a file emptied', () => {
    expect(applyHunks('', hunks('', 'x\ny\n'), () => true)).toBe('x\ny\n')
    expect(applyHunks('x\n', hunks('x\n', ''), () => true)).toBe('')
  })

  it('marks the gutter as VS Code does: added, changed, removed', () => {
    expect(gutterMarks('a\nb\nc\n', 'a\nb\nc\nd\n')).toEqual([{ kind: 'added', start: 4, end: 4 }])
    expect(gutterMarks('a\nb\nc\n', 'a\nX\nc\n')).toEqual([{ kind: 'modified', start: 2, end: 2 }])
    expect(gutterMarks('a\nb\nc\n', 'a\nc\n')).toEqual([{ kind: 'deleted', start: 1, end: 1 }])
  })

  it('writes a unified diff, merging changes that are close', () => {
    const d = unified('f.py', 'a\nb\nc\nd\n', 'a\nB\nc\nD\n', 1)
    expect(d.split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(1)
    expect(d).toContain('-b\n+B')
    expect(d).toContain('-d\n+D')
    expect(unified('f', 'same', 'same')).toBe('')
  })
})

describe('the explorer tree', () => {
  it('nests folders before files in natural order, empty folders too', () => {
    const t = buildTree(['b.py', 'src/x10.py', 'src/x9.py', 'a.py'], ['src', 'docs'])
    expect(t.map((n) => n.name)).toEqual(['docs', 'src', 'a.py', 'b.py'])
    expect(t[1].children!.map((n) => n.name)).toEqual(['x9.py', 'x10.py'])
    expect(t[0].children).toEqual([])
    expect(parentsOf('a/b/c.py')).toEqual(['a', 'a/b'])
  })

  it('reads git status letters', () => {
    expect(gitBadge('.', '?')).toEqual({ letter: 'U', tone: 'untracked' })
    expect(gitBadge('A', '.')).toEqual({ letter: 'A', tone: 'added' })
    expect(gitBadge('.', 'M')).toEqual({ letter: 'M', tone: 'modified' })
    expect(gitBadge('U', 'U')?.tone).toBe('conflict')
    expect(gitBadge('.', '.')).toBeNull()
  })
})

describe('breakpoints', () => {
  it('toggle on and off, sorted', () => {
    let b = toggleBreakpoint({}, 'a.py', 5)
    b = toggleBreakpoint(b, 'a.py', 2)
    expect(b['a.py'].map((x) => x.line)).toEqual([2, 5])
    b = toggleBreakpoint(toggleBreakpoint(b, 'a.py', 2), 'a.py', 5)
    expect(b['a.py']).toBeUndefined()
  })

  it('move with their lines when lines above change', () => {
    expect(shiftBreakpoints([{ line: 3 }, { line: 10 }], 5, 2).map((b) => b.line)).toEqual([3, 12])
    expect(shiftBreakpoints([{ line: 10 }], 5, -3).map((b) => b.line)).toEqual([7])
    // Lines removed under a breakpoint: it lands where they were, not above it
    expect(shiftBreakpoints([{ line: 6 }], 5, -3).map((b) => b.line)).toEqual([5])
  })
})

describe('symbols and the palette', () => {
  const r = (a: number, b: number) => ({ startLineNumber: a, startColumn: 1, endLineNumber: b, endColumn: 1 })
  it('finds the symbols around the cursor for the breadcrumbs', () => {
    const syms = [{ name: 'Ledger', kind: 4, range: r(1, 20), children: [{ name: 'post', kind: 5, range: r(3, 8) }, { name: 'balance', kind: 5, range: r(10, 15) }] }]
    expect(symbolPath(syms, 12, 4).map((s) => s.name)).toEqual(['Ledger', 'balance'])
    expect(symbolPath(syms, 30, 1)).toEqual([])
  })

  it('filters fuzzily, best first', () => {
    expect(fuzzyFilter(['main.py', 'ledger/book.py', 'tests/test_book.py'], 'book', (x) => x)[0]).toBe('ledger/book.py')
    expect(fuzzyFilter(['a', 'b'], '', (x) => x)).toEqual(['a', 'b'])
  })
})

describe('project templates', () => {
  it('each has its first file, and names that suit the language', () => {
    for (const t of TEMPLATES) {
      const files = t.files('My Project 2')
      expect(Object.keys(files)).toContain(t.open)
      for (const p of Object.keys(files)) expect(p.startsWith('/') || p.includes('..')).toBe(false)
    }
    expect(TEMPLATES.find((t) => t.id === 'rust')!.files('2fast')['Cargo.toml']).toContain('name = "_2fast"')
    expect(JSON.parse(TEMPLATES.find((t) => t.id === 'node')!.files('My App')['package.json']).name).toBe('my-app')
  })
})
