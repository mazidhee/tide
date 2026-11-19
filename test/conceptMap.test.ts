import { describe, expect, it } from 'vitest'
import { applyCanvasOps, describeCanvas, isConceptMap, parseCanvas, serializeCanvas } from '../src/shared/canvas'
import { openingRequest } from '../src/renderer/src/lib/openingRequest'

describe('concept maps on the canvas', () => {
  const map = () =>
    applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'Photosynthesis', kind: 'concept' },
      { op: 'add', label: 'Chlorophyll', kind: 'idea', near: 'Photosynthesis', side: 'below' },
      { op: 'add', label: 'Leaves in sunlight', kind: 'example', near: 'Photosynthesis' },
      { op: 'add', label: 'Why green, not black?', kind: 'question', near: 'Chlorophyll' },
      { op: 'connect', from: 'Photosynthesis', to: 'Chlorophyll', label: 'needs' },
      { op: 'connect', from: 'Leaves in sunlight', to: 'Photosynthesis', label: 'is an example of' }
    ]).canvas

  it('the tutor draws concepts, examples and questions, linked by how they relate', () => {
    const c = map()
    expect(c.nodes.map((n) => n.kind)).toEqual(['concept', 'concept', 'example', 'question'])
    // Each keeps a JSON Canvas colour, so the map still reads in Obsidian
    expect(c.nodes.map((n) => n.color)).toEqual(['6', '6', '4', '3'])
    const text = describeCanvas(c)
    expect(text).toContain('Photosynthesis (concept)')
    expect(text).toContain('Why green, not black? (question)')
    expect(text).toContain('Photosynthesis [photosynthesis] -> Chlorophyll [chlorophyll]: needs')
  })

  it('saves as a plain .canvas file and reads back the same', () => {
    const c = map()
    const raw = serializeCanvas(c)
    expect(JSON.parse(raw).nodes[0]).toMatchObject({ type: 'text', text: 'Photosynthesis', kind: 'concept' })
    expect(parseCanvas(raw)).toEqual(c)
  })

  it('tells a concept map from a system design', () => {
    expect(isConceptMap({ nodes: [], edges: [] })).toBe(true)
    expect(isConceptMap(map())).toBe(true)
    const design = applyCanvasOps({ nodes: [], edges: [] }, [{ op: 'add', label: 'Postgres', kind: 'database' }, { op: 'add', label: 'Why?', kind: 'note' }]).canvas
    expect(isConceptMap(design)).toBe(false)
  })
})

describe('the canvas beside every lesson', () => {
  it('a lesson gives the tutor its canvas from the first message, whatever the approach', () => {
    const scope = { kind: 'folder', path: 'Biology' } as const
    const req = openingRequest({ mode: 'teach', topic: 'Photosynthesis', options: { strategy: 'dialogue' } }, scope, 'professor')
    expect(req.canvasPath).toBe('Biology/Photosynthesis (map).canvas')
  })

  it('a quiz has no canvas', () => {
    const req = openingRequest({ mode: 'quiz', topic: 'Photosynthesis' }, { kind: 'folder', path: 'Biology' }, 'professor')
    expect(req.canvasPath).toBeUndefined()
  })
})

describe('the canvas tools reach Claude', () => {
  it('a lesson with a canvas lists canvas_read and canvas_edit over MCP; one without, or a chat, does not', async () => {
    const { packTools, toolPacks, toolReference } = await import('../src/shared/tutorGuide')
    const withCanvas = toolPacks({ kind: 'lesson', canvas: true })
    expect([...packTools(withCanvas)]).toEqual(expect.arrayContaining(['canvas_read', 'canvas_edit']))
    expect(toolReference(withCanvas)).toContain('canvas_edit')
    expect(packTools(toolPacks({ kind: 'lesson' })).has('canvas_edit')).toBe(false)
    expect(packTools(toolPacks({ kind: 'chat', canvas: true })).has('canvas_edit')).toBe(false)
  })
})

describe('asking for a drawing mid-lesson', () => {
  it('keeps the lesson as it is: the tutor draws on the canvas it already has', async () => {
    const { switchFrom } = await import('../src/shared/strategy')
    expect(switchFrom('Could you draw a concept map of this on the canvas?', 'dialogue')).toBeNull()
    expect(switchFrom('walk me through it', 'dialogue')).toBe('walkthrough')
  })
})
