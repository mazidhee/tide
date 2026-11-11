/* Layouts for the pathways prototype.
 *
 * 2D is layered, not force-directed. x is a concept's depth: the longest chain of prerequisites back to a
 * fundamental, so the map reads left to right in the order things can be learnt, and the frontier is
 * literally the edge of the lit region. y is the area's band. Within a column the order is relaxed
 * towards the concepts each one is linked to (a barycentre sweep), which keeps pathways short and
 * uncrossed. It is deterministic: the same concepts always land in the same place, so the learner's
 * spatial memory of the map survives new evidence. A force layout reshuffles itself every time.
 *
 * 3D stands the same idea up: each area is a tower on a ring, fundamentals at the foot, depth upwards,
 * each column a disc of concepts (phyllotaxis) turned towards what it is linked to. */
(function () {
  'use strict'
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 10000) / 10000 }
  const radius = (c) => (c.parent ? 2.4 + 0.5 * Math.sqrt(c.importance) : 3.2 + 2.1 * Math.sqrt(Math.min(c.importance, 140)))

  function columns(data) {
    const cols = new Map()
    for (const c of data.concepts) {
      if (c.parent) continue // a topic's parts sit beside it, not in a column of their own
      const k = c.area + ':' + c.depth
      if (!cols.has(k)) cols.set(k, [])
      cols.get(k).push(c)
    }
    for (const col of cols.values()) col.sort((a, b) => (a.parent ? a.parent.order : a.order) - (b.parent ? b.parent.order : b.order) || a.order - b.order)
    return cols
  }

  function layout2d(data) {
    const topics = data.concepts.filter((c) => !c.parent)
    const parts = data.concepts.filter((c) => c.parent)
    const DX = parts.length ? 230 : 124, SY = parts.length ? 44 : 24, GAP = parts.length ? 90 : 64
    const cols = columns(data)
    const band = new Map()
    let y0 = 0
    for (const a of data.areas) {
      let max = 3
      for (const [k, col] of cols) if (k.startsWith(a.id + ':')) max = Math.max(max, col.length)
      const h = max * SY + 40
      band.set(a.id, { top: y0, bottom: y0 + h, mid: y0 + h / 2 })
      y0 += h + GAP
    }
    for (const c of data.concepts) c.r = radius(c)
    for (const [k, col] of cols) {
      const b = band.get(col[0].area)
      col.forEach((c, i) => { c.y = b.mid + (i - (col.length - 1) / 2) * SY; c.x = c.depth * DX })
    }
    const settle = (col, b) => {
      col.sort((a, z) => a.y - z.y)
      for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + SY)
      const lo = b.top + 20, hi = b.bottom - 20
      const over = col[col.length - 1].y - hi
      if (over > 0) for (const c of col) c.y -= over
      for (let i = 0; i < col.length; i++) col[i].y = Math.max(col[i].y, i ? col[i - 1].y + SY : lo)
    }
    for (let it = 0; it < 24; it++) {
      for (const c of topics) {
        let s = 0, w = 0
        for (const n of c.prereq) { const k = n.area === c.area ? 1 : 0.12; s += n.y * k; w += k }
        for (const n of c.next) { if (n.parent) continue; const k = n.area === c.area ? 0.6 : 0.08; s += n.y * k; w += k }
        c.ty = w ? s / w : c.y
      }
      for (const c of topics) c.y = c.y * 0.45 + c.ty * 0.55
      for (const col of cols.values()) settle(col, band.get(col[0].area))
    }
    for (const c of topics) {
      c.x += (hash(c.id) - 0.5) * DX * 0.22
      c.y += (hash(c.id + 'y') - 0.5) * 6
    }
    // A topic's parts trail to its right, between it and the next column, like a dendrite
    for (const c of parts) {
      const b = c.parent, t = (c.part + 1) / (c.of + 1)
      c.x = b.x + b.r + t * (DX * 0.82 - b.r)
      c.y = b.y + Math.sin((c.part + 1) * 1.9 + hash(b.id) * 6) * SY * 0.22
    }
    // Close the bands up to what they actually hold, a fixed gap apart
    let top = 0
    for (const a of data.areas) {
      const cs = data.concepts.filter((c) => c.area === a.id)
      const lo = Math.min(...cs.map((c) => c.y - c.r)), hi = Math.max(...cs.map((c) => c.y + c.r))
      for (const c of cs) c.y += top - lo
      band.set(a.id, { top, bottom: top + hi - lo, mid: top + (hi - lo) / 2 })
      top += hi - lo + GAP
    }
    const bounds = { x0: -DX * 0.5, y0: -10, x1: Math.max(...data.concepts.map((c) => c.x)) + DX * 1.3, y1: top - GAP + 10 }
    data.bands = band
    data.bounds = bounds
    return bounds
  }

  function layout3d(data) {
    const DY = 40, R = 480 + Math.sqrt(data.concepts.length) * 10, S = 40
    const cols = columns(data)
    const center = new Map()
    data.areas.forEach((a, i) => { const t = (i / data.areas.length) * Math.PI * 2; center.set(a.id, { x: Math.cos(t) * R, z: Math.sin(t) * R, t }) })
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (const col of cols.values()) {
      const c0 = center.get(col[0].area)
      // Sort so the column's first members (and its most important) sit at the middle of the disc
      const sorted = col.slice().sort((a, b) => b.importance - a.importance)
      const turn = hash(col[0].area + col[0].depth) * Math.PI * 2
      sorted.forEach((c, i) => {
        const rr = S * Math.sqrt(i + 0.5) * 1.15, th = i * golden + turn
        c.px = c0.x + Math.cos(th) * rr
        c.pz = c0.z + Math.sin(th) * rr
        c.py = c.depth * DY + (hash(c.id) - 0.5) * DY * 0.5
      })
    }
    // Lean each concept a little towards what it is linked to, keeping a minimum distance in its column
    for (let it = 0; it < 6; it++) {
      for (const c of data.concepts) {
        if (c.parent) continue
        let sx = 0, sz = 0, w = 0
        for (const n of [...c.prereq, ...c.next]) { if (n.area !== c.area || n.parent) continue; sx += n.px; sz += n.pz; w++ }
        if (w) { c.qx = c.px * 0.95 + (sx / w) * 0.05; c.qz = c.pz * 0.95 + (sz / w) * 0.05 } else { c.qx = c.px; c.qz = c.pz }
      }
      for (const c of data.concepts) if (!c.parent) { c.px = c.qx; c.pz = c.qz }
      for (const col of cols.values()) {
        for (let i = 0; i < col.length; i++) for (let j = i + 1; j < col.length; j++) {
          const a = col[i], b = col[j]
          let dx = b.px - a.px, dz = b.pz - a.pz
          const d = Math.hypot(dx, dz) || 0.01, min = S * 1.05
          if (d < min) { const p = (min - d) / 2 / d; dx *= p; dz *= p; a.px -= dx; a.pz -= dz; b.px += dx; b.pz += dz }
        }
      }
    }
    // Parts spiral up and out from their topic
    for (const c of data.concepts) {
      if (!c.parent) continue
      const b = c.parent, t = (c.part + 1) / (c.of + 1)
      const out = Math.atan2(b.pz - center.get(b.area).z, b.px - center.get(b.area).x)
      const a = out + (c.part - c.of / 2) * 0.5
      c.px = b.px + Math.cos(a) * (10 + 22 * t)
      c.pz = b.pz + Math.sin(a) * (10 + 22 * t)
      c.py = b.py + t * DY * 0.85
    }
    for (const a of data.areas) center.get(a.id).y = Math.min(...data.concepts.filter((c) => c.area === a.id).map((c) => c.py))
    data.centers3d = center
    data.height3d = Math.max(...data.concepts.map((c) => c.depth)) * DY
    data.ring3d = R
  }

  window.PathwaysLayout = { layout2d, layout3d, radius }
})()
