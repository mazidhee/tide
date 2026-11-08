import { describe, expect, it } from 'vitest'
import { applyCanvasOps, describeCanvas, parseCanvas, serializeCanvas } from '../src/shared/canvas'

describe('system design canvas', () => {
  it('builds a design from operations, referring to components by name', () => {
    const { canvas, log } = applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'Web client', kind: 'client' },
      { op: 'add', label: 'Load balancer', kind: 'loadbalancer', near: 'Web client' },
      { op: 'add', label: 'Quote service', kind: 'api', near: 'load balancer' },
      { op: 'add', label: 'Redis', kind: 'redis', near: 'quote-service', side: 'below', details: 'latest quotes, 1 s TTL' },
      { op: 'connect', from: 'web-client', to: 'Load balancer', label: 'HTTPS' },
      { op: 'connect', from: 'load-balancer', to: 'Quote service' },
      { op: 'connect', from: 'Quote service', to: 'Redis', label: 'read' },
      { op: 'connect', from: 'Quote service', to: 'Nowhere' }
    ])
    expect(canvas.nodes.map((n) => n.kind)).toEqual(['client', 'lb', 'service', 'cache'])
    expect(canvas.edges).toHaveLength(3)
    expect(log.at(-1)).toContain('no such component')
    // Nothing overlaps
    for (const a of canvas.nodes)
      for (const b of canvas.nodes)
        if (a !== b) expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false)
    const text = describeCanvas(canvas)
    expect(text).toContain('Redis (cache): latest quotes, 1 s TTL')
    expect(text).toContain('Quote service [quote-service] -> Redis [redis]: read')
  })

  it('round-trips through JSON Canvas and tolerates other apps’ nodes', () => {
    const raw = JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Notes/Kafka.md', x: 0, y: 0, width: 200, height: 100 }, { id: 'b', type: 'text', text: 'DB', x: 300, y: 0, width: 180, height: 72, kind: 'database' }], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }, { id: 'x', fromNode: 'a', toNode: 'missing' }] })
    const c = parseCanvas(raw)
    expect(c.nodes[0].text).toBe('Notes/Kafka.md')
    expect(c.edges).toHaveLength(1)
    expect(parseCanvas(serializeCanvas(c))).toEqual(c)
    expect(parseCanvas('not json')).toEqual({ nodes: [], edges: [] })
  })

  it('removing a component removes its connections', () => {
    const start = applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'API' },
      { op: 'add', label: 'DB', kind: 'database', near: 'API' },
      { op: 'connect', from: 'API', to: 'DB' }
    ]).canvas
    const { canvas } = applyCanvasOps(start, [{ op: 'remove', id: 'DB' }])
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.edges).toHaveLength(0)
  })
})

describe('tolerant canvas operations', () => {
  it('accepts the field names small models use', () => {
    const { canvas } = applyCanvasOps({ nodes: [], edges: [] }, [
      { action: 'add_node', name: 'Client', kind: 'client' },
      { type: 'add', name: 'Web Server', kind: 'server' },
      { name: 'SQL Database', kind: 'db' },
      { action: 'connect_nodes', source: 'Client', target: 'Web Server', label: 'HTTPS' },
      { source: 'Web Server', target: 'SQL Database' }
    ])
    expect(canvas.nodes.map((n) => [n.text, n.kind])).toEqual([
      ['Client', 'client'],
      ['Web Server', 'service'],
      ['SQL Database', 'database']
    ])
    expect(canvas.edges).toHaveLength(2)
  })
})

describe('redraw from memory', () => {
  it('pairs components by kind and name and checks the connections', async () => {
    const { compareDesigns } = await import('../src/shared/canvas')
    const original = applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'Web client', kind: 'client' },
      { op: 'add', label: 'Load balancer', kind: 'lb' },
      { op: 'add', label: 'Shortener service', kind: 'service' },
      { op: 'add', label: 'Redis cache', kind: 'cache' },
      { op: 'add', label: 'URL database', kind: 'database' },
      { op: 'connect', from: 'Web client', to: 'Load balancer' },
      { op: 'connect', from: 'Load balancer', to: 'Shortener service' },
      { op: 'connect', from: 'Shortener service', to: 'Redis cache' },
      { op: 'connect', from: 'Shortener service', to: 'URL database' }
    ]).canvas
    const redrawn = applyCanvasOps({ nodes: [], edges: [] }, [
      { op: 'add', label: 'Browser', kind: 'client' },
      { op: 'add', label: 'Shortener', kind: 'service' },
      { op: 'add', label: 'Postgres URLs', kind: 'database' },
      { op: 'add', label: 'CDN', kind: 'cdn' },
      { op: 'connect', from: 'Shortener', to: 'Browser' },
      { op: 'connect', from: 'Shortener', to: 'Postgres URLs' }
    ]).canvas
    const c = compareDesigns(original, redrawn)
    expect(c.missing.sort()).toEqual(['Load balancer', 'Redis cache'])
    expect(c.extra).toEqual(['CDN'])
    expect(c.connectionsFound).toBe(1)
    expect(c.score).toBeCloseTo(4 / 9)
  })
})
