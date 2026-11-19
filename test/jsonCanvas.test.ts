import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { applyCanvasOps, describeCanvas, flowOrder, groupsOf, liveEdges, nodeLabel, parseCanvas, serializeCanvas, type Canvas } from '../src/shared/canvas'
import { flowToCanvas, guessKind, tidyCanvas } from '../src/shared/flowLayout'
import { cleanLabel, parseMermaidFlow } from '../src/shared/mermaidFlow'

const fixture = readFileSync(join(__dirname, 'fixtures/obsidian.canvas'), 'utf8')

describe('JSON Canvas round trip', () => {
  it('saves an Obsidian canvas back exactly as it read it, field for field', () => {
    const c = parseCanvas(fixture)
    expect(JSON.parse(serializeCanvas(c))).toEqual(JSON.parse(fixture))
  })

  it('keeps every node type, unknown fields, dangling edges and top-level extras', () => {
    const c = parseCanvas(fixture)
    expect(c.nodes.map((n) => n.type)).toEqual(['group', 'text', 'file', 'link', 'widget'])
    expect(c.nodes[2]).toMatchObject({ file: 'Notes/Kafka.md', subpath: '#Partitions' })
    expect(c.nodes[4].pluginData).toEqual({ a: [1, 2, { b: null }] })
    expect(c.edges.find((e) => e.id === 'e2')).toEqual({ id: 'e2', fromNode: 'f1', toNode: 'gone' })
    expect(c.edges.find((e) => e.id === 'e3')?.customFlag).toBe(true)
    expect(c.extra).toEqual({ metadata: { version: '1.0', frontmatter: {} } })
    expect(liveEdges(c).map((e) => e.id)).toEqual(['e1', 'e3'])
  })

  it('is stable: serialising twice gives the same text, tab-indented like Obsidian', () => {
    const once = serializeCanvas(parseCanvas(fixture))
    expect(serializeCanvas(parseCanvas(once))).toBe(once)
    expect(once.split('\n')[1].startsWith('\t"nodes"')).toBe(true)
  })

  it('round-trips a canvas after the tutor edits it, keeping what it did not touch', () => {
    const c = parseCanvas(fixture)
    const { canvas } = applyCanvasOps(c, [
      { op: 'add', label: 'Ledger', kind: 'database', near: 'API' },
      { op: 'connect', from: 'API', to: 'Ledger', label: 'write' }
    ])
    const back = parseCanvas(serializeCanvas(canvas))
    expect(back).toEqual(canvas)
    expect(back.nodes.find((n) => n.id === 'w1')?.pluginData).toEqual({ a: [1, 2, { b: null }] })
    expect(back.extra).toEqual(c.extra)
  })

  it('mends only what would break drawing', () => {
    const c = parseCanvas('{"nodes":[{"id":"a","x":"10","y":null,"text":"x"},{"type":"text"}],"edges":[{"id":"e"}]}')
    expect(c.nodes).toEqual([{ id: 'a', type: 'text', x: 10, y: 0, width: 180, height: 72, text: 'x' }])
    expect(c.edges).toEqual([])
  })

  it('names nodes of every type', () => {
    const c = parseCanvas(fixture)
    expect(c.nodes.map(nodeLabel)).toEqual(['Payments', 'API', 'Kafka#Partitions', 'https://jsoncanvas.org/spec/1.0/', 'Untitled'])
  })
})

describe('groups', () => {
  it('finds the innermost group a node sits in', () => {
    const c: Canvas = {
      nodes: [
        { id: 'outer', type: 'group', label: 'Region', x: 0, y: 0, width: 1000, height: 600 },
        { id: 'inner', type: 'group', label: 'Cluster', x: 50, y: 50, width: 400, height: 300 },
        { id: 'a', type: 'text', text: 'A', x: 100, y: 100, width: 100, height: 60 },
        { id: 'b', type: 'text', text: 'B', x: 600, y: 100, width: 100, height: 60 }
      ],
      edges: []
    }
    expect(groupsOf(c, c.nodes[2]).map((g) => g.id)).toEqual(['inner', 'outer'])
    expect(groupsOf(c, c.nodes[3]).map((g) => g.id)).toEqual(['outer'])
    expect(groupsOf(c, c.nodes[1]).map((g) => g.id)).toEqual(['outer'])
    expect(describeCanvas(c)).toContain('[inner] Cluster: A')
  })

  it('lets the tutor draw a group around components', () => {
    const { canvas, log } = applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'API', kind: 'service' },
      { op: 'add', label: 'Worker', kind: 'worker', near: 'API' },
      { op: 'add', label: 'Stripe', kind: 'external', near: 'Worker' },
      { op: 'group', label: 'Payments', members: ['API', 'Worker'] }
    ])
    const g = canvas.nodes.find((n) => n.type === 'group')!
    expect(g.label).toBe('Payments')
    expect(canvas.nodes[0]).toBe(g)
    const inside = canvas.nodes.filter((n) => groupsOf(canvas, n)[0]?.id === g.id).map(nodeLabel)
    expect(inside).toEqual(['API', 'Worker'])
    expect(log.at(-1)).toContain('grouped API, Worker as Payments')
    // A later add never lands on top of a component just because a group is there
    const more = applyCanvasOps(canvas, [{ op: 'add', label: 'Cache', kind: 'cache' }]).canvas
    const cache = more.nodes.at(-1)!
    expect(more.nodes.filter((n) => n.type !== 'group' && n !== cache).some((n) => cache.x < n.x + n.width && cache.x + cache.width > n.x && cache.y < n.y + n.height && cache.y + cache.height > n.y)).toBe(false)
  })
})

describe('flow order', () => {
  it('plays numbered steps by number, then the rest in the order they were drawn', () => {
    const c = parseCanvas(
      JSON.stringify({
        nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'text', text: id, x: i * 200, y: 0, width: 100, height: 50 })),
        edges: [
          { id: 'x', fromNode: 'c', toNode: 'd', label: 'later' },
          { id: 's2', fromNode: 'b', toNode: 'c', label: '2. lookup' },
          { id: 's1', fromNode: 'a', toNode: 'b', label: '1) HTTPS' },
          { id: 'y', fromNode: 'a', toNode: 'gone' }
        ]
      })
    )
    expect(flowOrder(c).map((e) => e.id)).toEqual(['s1', 's2', 'x'])
  })
})

describe('mermaid flowcharts', () => {
  it('reads shapes, labels, chains, fan-out and every link form', () => {
    const f = parseMermaidFlow(`flowchart LR
      %% a comment
      C([Browser]) -->|HTTPS| LB{{"Load balancer"}}
      LB --> A1[API 1] & A2[API 2]
      A1 -- read --> R[(Redis)]
      A2 -.-> Q>Queue]:::hot
      Q ==> W(Worker) --- DB[("Postgres<br/>primary")]
      W ~~~ R
      W <--> X((Stripe))
      classDef hot fill:#f00
      style W stroke:#333`)!
    expect(f.direction).toBe('LR')
    expect(f.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ['C', 'Browser', 'stadium'],
      ['LB', 'Load balancer', 'hexagon'],
      ['A1', 'API 1', 'rect'],
      ['A2', 'API 2', 'rect'],
      ['R', 'Redis', 'cylinder'],
      ['Q', 'Queue', 'flag'],
      ['W', 'Worker', 'round'],
      ['DB', 'Postgres\nprimary', 'cylinder'],
      ['X', 'Stripe', 'circle']
    ])
    expect(f.links.map((l) => `${l.from}>${l.to}${l.label ? `:${l.label}` : ''}${l.dashed ? ' dashed' : ''}${l.toArrow ? '' : ' plain'}${l.fromArrow ? ' both' : ''}`)).toEqual([
      'C>LB:HTTPS',
      'LB>A1',
      'LB>A2',
      'A1>R:read',
      'A2>Q dashed',
      'Q>W',
      'W>DB plain',
      'W>X both'
    ])
  })

  it('reads subgraphs, nested, as groups', () => {
    const f = parseMermaidFlow(`graph TD
      subgraph cloud [AWS]
        subgraph vpc["VPC"]
          A --> B
        end
        C
      end
      A --> D`)!
    expect(f.direction).toBe('TB')
    expect(f.groups).toEqual([
      { id: 'cloud', label: 'AWS', members: ['vpc', 'C'] },
      { id: 'vpc', label: 'VPC', members: ['A', 'B'], parent: 'cloud' }
    ])
  })

  it('leaves to mermaid what it does not fully understand', () => {
    expect(parseMermaidFlow('sequenceDiagram\n A->>B: hi')).toBeNull()
    expect(parseMermaidFlow('flowchart TD\n A@{ shape: rect, label: "x" } --> B')).toBeNull()
    expect(parseMermaidFlow('flowchart TD\n A e1@--> B')).toBeNull()
    expect(parseMermaidFlow('flowchart TD\n subgraph S\n A --> B')).toBeNull()
    expect(parseMermaidFlow('flowchart TD\n A --> B[unclosed')).toBeNull()
    expect(parseMermaidFlow('flowchart TD\n subgraph S\n A\n end\n S --> A')).toBeNull()
  })

  it('accepts semicolons, front matter and quoted labels with brackets', () => {
    const f = parseMermaidFlow('---\ntitle: x\n---\ngraph LR;\n A["f(x) [1]"] --> B;B --> C')!
    expect(f.nodes.map((n) => n.label)).toEqual(['f(x) [1]', 'B', 'C'])
    expect(f.links).toHaveLength(2)
  })

  it('cleans labels', () => {
    expect(cleanLabel('"a #quot;b#quot; &amp; **c**"')).toBe('a "b" & c')
  })
})

describe('flowchart on the canvas', () => {
  it('lays a system flow out with kinds, groups around their members and no overlaps', () => {
    const f = parseMermaidFlow(`flowchart LR
      U[User] -->|1. GET /feed| G[API gateway]
      subgraph core [Feed]
        G --> S[Feed service]
        S --> R[(Redis)]
        S --> P[(Posts DB)]
      end
      S -.-> K[Kafka]`)!
    const c = flowToCanvas(f)
    const kinds = Object.fromEntries(c.nodes.filter((n) => n.type === 'text').map((n) => [n.id, n.kind]))
    expect(kinds).toEqual({ U: 'client', G: 'gateway', S: 'service', R: 'cache', P: 'database', K: 'queue' })
    const g = c.nodes.find((n) => n.type === 'group')!
    expect(g.label).toBe('Feed')
    for (const id of ['G', 'S', 'R', 'P']) expect(groupsOf(c, c.nodes.find((n) => n.id === id)!)[0]?.id).toBe(g.id)
    expect(groupsOf(c, c.nodes.find((n) => n.id === 'U')!)).toEqual([])
    const boxes = c.nodes.filter((n) => n.type === 'text')
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false)
    expect(c.edges.find((e) => e.fromNode === 'S' && e.toNode === 'K')?.dashed).toBe(true)
    expect(flowOrder(c)[0].label).toBe('1. GET /feed')
    // Left to right: the user is left of the gateway
    expect(c.nodes.find((n) => n.id === 'U')!.x).toBeLessThan(c.nodes.find((n) => n.id === 'G')!.x)
  })

  it('keeps an argument map plain', () => {
    const c = flowToCanvas(parseMermaidFlow('flowchart TD\n P1["Premise: all men are mortal"] --> C{Conclusion}\n P2[Socrates is a man] --> C')!)
    expect(c.nodes.every((n) => n.kind === undefined)).toBe(true)
    expect(c.nodes.find((n) => n.id === 'C')?.shape).toBe('diamond')
  })

  it('guesses kinds from names', () => {
    expect(guessKind('Postgres replica')).toBe('database')
    expect(guessKind('Order service')).toBe('service')
    expect(guessKind('Kafka topic')).toBe('queue')
    expect(guessKind('x', 'cylinder')).toBe('database')
    expect(guessKind('Hamlet')).toBeUndefined()
  })
})

describe('tidy', () => {
  it('lays a messy canvas out, keeping each node in its group and every other field', () => {
    const start = parseCanvas(fixture)
    const c = tidyCanvas(start)
    expect(c.nodes.map((n) => n.id)).toEqual(start.nodes.map((n) => n.id))
    expect(c.extra).toEqual(start.extra)
    const g = c.nodes.find((n) => n.id === 'g1')!
    for (const id of ['t1', 'f1']) expect(groupsOf(c, c.nodes.find((n) => n.id === id)!)[0]?.id).toBe('g1')
    expect(groupsOf(c, c.nodes.find((n) => n.id === 'l1')!)).toEqual([])
    expect(g.background).toBe('Assets/bg.png')
  })
})
