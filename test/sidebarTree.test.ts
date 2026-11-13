import { describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import { isRoadmapFile, looseRoadmaps, tidyTree } from '@shared/sidebarTree'

const file = (path: string, kind: FileNode['kind'] = 'note'): FileNode => ({ name: path.split('/').pop()!, path, type: 'file', kind }) as FileNode
const folder = (path: string, children: FileNode[]): FileNode => ({ name: path.split('/').pop()!, path, type: 'folder', children }) as FileNode

const vault = folder('', [
  folder('Mathematics', [file('Mathematics/Limits.md')]),
  folder('Roadmaps', [file('Roadmaps/RM_MATH.md'), file('Roadmaps/RM_SWE.md'), file('Roadmaps/Linear algebra.md')]),
  folder('Tide', [file('Tide/Tide bugs.md'), file('Tide/Tide roadmap.md'), folder('Tide/Bug shots', [file('Tide/Bug shots/a.png', 'image')])]),
  folder('Software Engineering', [file('Software Engineering/Outline.md'), file('Software Engineering/Git.md')]),
  folder('New topic', [])
])
const outlines = new Set(['Roadmaps/RM_MATH.md', 'Roadmaps/RM_SWE.md', 'Software Engineering/Outline.md'])

describe('sidebar tree', () => {
  it('leaves out roadmaps, the folder they empty, and screenshot folders', () => {
    const tidy = tidyTree(vault.children!, outlines)
    expect(tidy.map((n) => n.path)).toEqual(['Mathematics', 'Tide', 'Software Engineering', 'New topic'])
    expect(tidy.find((n) => n.path === 'Tide')!.children!.map((n) => n.path)).toEqual(['Tide/Tide bugs.md', 'Tide/Tide roadmap.md'])
    expect(tidy.find((n) => n.path === 'Software Engineering')!.children!.map((n) => n.path)).toEqual(['Software Engineering/Git.md'])
  })

  it('keeps an empty notebook and an unchanged folder as it was', () => {
    const tidy = tidyTree(vault.children!, outlines)
    expect(tidy.find((n) => n.path === 'Mathematics')).toBe(vault.children![0])
    expect(tidy.find((n) => n.path === 'New topic')!.children).toEqual([])
  })

  it('knows a roadmap by being an outline or sitting in Roadmaps', () => {
    expect(isRoadmapFile('Roadmaps/Linear algebra.md', new Set())).toBe(true)
    expect(isRoadmapFile('Roadmaps/sub/x.md', new Set())).toBe(false)
    expect(isRoadmapFile('Tide/Tide roadmap.md', outlines)).toBe(false)
  })

  it('lists roadmaps no notebook uses, for Learn', () => {
    expect(looseRoadmaps(vault, outlines).map((f) => f.path)).toEqual(['Roadmaps/Linear algebra.md'])
  })
})
