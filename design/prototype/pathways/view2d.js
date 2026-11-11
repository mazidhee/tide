/* The flat form: a 2D canvas. It draws only when something changes (render on demand): no loop runs
 * while the map is still, so it costs nothing while the local model has the GPU. */
(function () {
  'use strict'
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const FONT = '500 12.5px "Hanken Grotesk", -apple-system, sans-serif'
  const FONT_SEL = '600 13px "Hanken Grotesk", -apple-system, sans-serif'
  const AREA_FONT = '600 13.5px "Hanken Grotesk", -apple-system, sans-serif'
  const META_FONT = '400 12px "Hanken Grotesk", -apple-system, sans-serif'

  function rgba(hex, a) {
    if (hex.startsWith('rgb')) return hex.replace(/rgba?\(([^)]+)\)/, (m, v) => `rgba(${v.split(',').slice(0, 3).join(',')},${a})`)
    const h = hex.replace('#', '')
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  class View2D {
    constructor(canvas, S) {
      this.cv = canvas
      this.S = S
      this.ctx = canvas.getContext('2d')
      this.k = 1; this.tx = 0; this.ty = 0
      this.queued = false
      this.anim = null
      this.widths = new Map()
      this.region = document.createElement('canvas')
      this.bind()
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement)
      this.setData()
    }

    setData() {
      const d = this.S.data
      this.d = d
      // A grid over the world for hit tests
      this.cell = 80
      this.grid = new Map()
      for (const c of d.concepts) {
        const key = Math.floor(c.x / this.cell) + ',' + Math.floor(c.y / this.cell)
        if (!this.grid.has(key)) this.grid.set(key, [])
        this.grid.get(key).push(c)
      }
      const areaBox = new Map()
      for (const c of d.concepts) {
        const b = areaBox.get(c.area) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, solid: 0, fading: 0, ready: 0 }
        b.x0 = Math.min(b.x0, c.x); b.x1 = Math.max(b.x1, c.x); b.y0 = Math.min(b.y0, c.y); b.y1 = Math.max(b.y1, c.y)
        if (c.status === 'solid') b.solid++
        if (c.status === 'fading') b.fading++
        if (c.ready) b.ready++
        areaBox.set(c.area, b)
      }
      this.areaBox = areaBox
      this.fitted = false
      if (this.w) this.fit(false)
    }

    // ---------- Sizing ----------
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect()
      if (!r.width) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      this.w = r.width; this.h = r.height; this.dpr = dpr
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr)
      this.region.width = Math.round(r.width / 2); this.region.height = Math.round(r.height / 2)
      if (!this.fitted) this.fit(false)
      this.renderNow()
    }
    show() { this.visible = true; this.resize(); this.fitted || this.fit(false); this.request() }
    hide() { this.visible = false }
    focusCanvas() { this.cv.focus({ preventScroll: true }) }
    theme() { this.request() }
    restyle() { this.request() }

    // ---------- Camera ----------
    fit(animate) {
      const b = this.d.bounds
      if (!this.w) return
      const pad = 32, gutter = 170
      const k = Math.min((this.w - pad - gutter) / (b.x1 - b.x0), (this.h - pad * 2) / (b.y1 - b.y0))
      const tx = gutter + (this.w - gutter - pad - (b.x1 - b.x0) * k) / 2 - b.x0 * k
      const ty = (this.h - (b.y1 - b.y0) * k) / 2 - b.y0 * k
      this.fitted = true
      this.go(k, tx, ty, animate)
    }
    zoom(f, sx = this.w / 2, sy = this.h / 2, animate = true) {
      const k = Math.max(0.08, Math.min(4, this.k * f))
      const wx = (sx - this.tx) / this.k, wy = (sy - this.ty) / this.k
      this.go(k, sx - wx * k, sy - wy * k, animate)
    }
    flyTo(c, instant, chain) {
      if (!this.w) return
      let k = Math.max(this.k, 1.15), cx = c.x, cy = c.y
      if (chain && this.S.emph) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const n of this.S.emph) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y) }
        x1 += 160
        k = Math.min(1.3, Math.max(0.12, Math.min((this.w - 120) / (x1 - x0 + 1), (this.h - 120) / (y1 - y0 + 1))))
        cx = (x0 + x1) / 2; cy = (y0 + y1) / 2
      }
      this.go(k, this.w / 2 - cx * k, this.h / 2 - cy * k, !instant)
    }
    reveal(c) {
      const sx = c.x * this.k + this.tx, sy = c.y * this.k + this.ty, m = 80
      if (this.k < 0.6) return this.flyTo(c)
      if (sx < m || sy < m || sx > this.w - m - 200 || sy > this.h - m) this.go(this.k, this.w / 2 - c.x * this.k, this.h / 2 - c.y * this.k, true)
      else this.request()
    }
    go(k, tx, ty, animate) {
      if (!animate || this.S.reduced()) { this.anim = null; this.k = k; this.tx = tx; this.ty = ty; this.request(); return }
      this.anim = { t0: performance.now(), dur: 380, from: [this.k, this.tx, this.ty], to: [k, tx, ty] }
      this.request()
    }
    step(now) {
      const a = this.anim
      if (!a) return false
      const t = Math.min(1, (now - a.t0) / a.dur), e = ease(t)
      // Interpolate the zoom in log space and keep the world point under the centre moving straight
      const k = Math.exp(Math.log(a.from[0]) + (Math.log(a.to[0]) - Math.log(a.from[0])) * e)
      const cx0 = (this.w / 2 - a.from[1]) / a.from[0], cy0 = (this.h / 2 - a.from[2]) / a.from[0]
      const cx1 = (this.w / 2 - a.to[1]) / a.to[0], cy1 = (this.h / 2 - a.to[2]) / a.to[0]
      const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e
      this.k = k; this.tx = this.w / 2 - cx * k; this.ty = this.h / 2 - cy * k
      if (t >= 1) this.anim = null
      return !!this.anim
    }

    // ---------- Input ----------
    bind() {
      const cv = this.cv
      let down = null
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId)
        down = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false }
        this.anim = null
      })
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top
        if (down) {
          const dx = e.clientX - down.x, dy = e.clientY - down.y
          if (Math.abs(dx) + Math.abs(dy) > 3) { down.moved = true; cv.classList.add('dragging') }
          if (down.moved) { this.tx = down.tx + dx; this.ty = down.ty + dy; this.S.setHover(null); this.request() }
          return
        }
        const c = this.hit(sx, sy)
        cv.classList.toggle('on-node', !!c)
        this.S.setHover(c, e.clientX, e.clientY)
      })
      cv.addEventListener('pointerup', (e) => {
        cv.classList.remove('dragging')
        if (down && !down.moved) {
          const r = cv.getBoundingClientRect()
          const c = this.hit(e.clientX - r.left, e.clientY - r.top)
          this.S.select(c)
        }
        down = null
      })
      cv.addEventListener('pointerleave', () => this.S.setHover(null))
      cv.addEventListener('wheel', (e) => {
        e.preventDefault()
        const r = cv.getBoundingClientRect()
        if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.012), e.clientX - r.left, e.clientY - r.top, false)
        else if (e.deltaMode === 1) this.zoom(Math.exp(-e.deltaY * 0.08), e.clientX - r.left, e.clientY - r.top, false)
        else { this.tx -= e.deltaX; this.ty -= e.deltaY; this.anim = null; this.request() }
      }, { passive: false })
      cv.addEventListener('dblclick', (e) => { const r = cv.getBoundingClientRect(); this.zoom(2, e.clientX - r.left, e.clientY - r.top) })
      document.getElementById('zoomIn').addEventListener('click', () => this.S.view === this && this.zoom(1.5))
      document.getElementById('zoomOut').addEventListener('click', () => this.S.view === this && this.zoom(1 / 1.5))
      document.getElementById('zoomFit').addEventListener('click', () => this.S.view === this && this.fit(true))
    }
    rs(c) { return Math.max(c.r * this.k, c.r * 0.32 + 1.6) }
    hit(sx, sy) {
      const wx = (sx - this.tx) / this.k, wy = (sy - this.ty) / this.k
      const gx = Math.floor(wx / this.cell), gy = Math.floor(wy / this.cell)
      let best = null, bd = Infinity
      const reach = Math.ceil(24 / this.k / this.cell)
      for (let i = gx - reach; i <= gx + reach; i++) for (let j = gy - reach; j <= gy + reach; j++) {
        const list = this.grid.get(i + ',' + j)
        if (list) for (const c of list) {
          const d = Math.hypot(c.x * this.k + this.tx - sx, c.y * this.k + this.ty - sy)
          if (d < Math.max(this.rs(c) + 3, 8) && d < bd && !this.S.dim(c)) { bd = d; best = c }
        }
      }
      return best
    }
    neighbour(from, [dx, dy]) {
      const S = this.S
      const cands = this.d.concepts.filter((c) => !S.dim(c))
      if (!from) {
        let best = null, bd = Infinity
        for (const c of cands) { const d = Math.hypot(c.x * this.k + this.tx - this.w / 2, c.y * this.k + this.ty - this.h / 2); if (d < bd) { bd = d; best = c } }
        return best
      }
      let best = null, bs = Infinity
      for (const c of cands) {
        if (c === from) continue
        const vx = (c.x - from.x) * this.k, vy = (c.y - from.y) * this.k
        const along = vx * dx + vy * dy
        if (along <= 2) continue
        const perp = Math.abs(vx * dy - vy * dx)
        if (perp > along * 2.2) continue
        // Prefer what it is linked to, then what is near and straight ahead
        const linked = from.prereq.includes(c) || from.next.includes(c) ? 0.6 : 1
        const s = (along + perp * 2.5) * linked
        if (s < bs) { bs = s; best = c }
      }
      return best
    }

    // ---------- Drawing ----------
    request() {
      if (this.queued || !this.visible) return
      this.queued = true
      requestAnimationFrame((now) => {
        this.queued = false
        const more = this.step(now)
        this.renderNow()
        if (more) this.request()
      })
    }
    benchStep(t) {
      // A steady pan in a circle with a slow zoom in and out: the kind of motion a person makes
      if (!this.bench0) this.bench0 = [this.k, this.tx, this.ty]
      const [k0, tx0, ty0] = this.bench0
      this.k = k0 * (1.6 + 1.2 * Math.sin(t * 1.3))
      const cx = (this.w / 2 - tx0) / k0 + Math.cos(t) * 600, cy = (this.h / 2 - ty0) / k0 + Math.sin(t) * 300
      this.tx = this.w / 2 - cx * this.k; this.ty = this.h / 2 - cy * this.k
    }

    sync() { this.ctx.getImageData(0, 0, 1, 1) }
    renderNow() {
      if (!this.w || !this.visible) return
      const t0 = performance.now()
      const { ctx, S, d, k, tx, ty, dpr } = this
      const P = S.palette
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = P.paper
      ctx.fillRect(0, 0, this.w, this.h)

      const vx0 = -tx / k - 40, vy0 = -ty / k - 40, vx1 = (this.w - tx) / k + 40, vy1 = (this.h - ty) / k + 40
      const inView = (c, m = 0) => c.x > vx0 - m && c.x < vx1 + m && c.y > vy0 - m && c.y < vy1 + m
      const sx = (x) => x * k + tx, sy = (y) => y * k + ty
      const emph = S.emph
      const sel = S.sel, hov = S.hover

      // Areas as soft regions: the union of a wide ellipse around each concept, drawn flat at low alpha
      const rg = this.region, rc = rg.getContext('2d')
      rc.setTransform(0.5, 0, 0, 0.5, 0, 0)
      rc.clearRect(0, 0, this.w, this.h)
      const rx = Math.max(84 * k, 7), ry = Math.max(30 * k, 7)
      for (const a of d.areas) {
        rc.fillStyle = P.area[a.id]
        rc.beginPath()
        for (const c of d.concepts) if (c.area === a.id && inView(c, 120)) { const x = sx(c.x), y = sy(c.y); rc.moveTo(x + rx, y); rc.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2) }
        rc.fill()
      }
      ctx.globalAlpha = (P.dark ? 0.085 : 0.06) * Math.max(0.45, Math.min(1, 1.25 - k * 0.5))
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(rg, 0, 0, this.w, this.h)
      ctx.globalAlpha = 1

      // Pathways, bucketed by style so each bucket is one path
      const buckets = new Map()
      const add = (key, stroke, width, alpha) => { let b = buckets.get(key); if (!b) { b = { stroke, width, alpha, path: new Path2D(), z: 0 }; buckets.set(key, b) } return b }
      const thin = Math.max(0.6, Math.min(1, k * 1.5))
      const scale = Math.max(0.55, Math.min(1.5, k * 1.3))
      for (const l of d.links) {
        const a = l.from, b = l.to
        if ((a.x < vx0 && b.x < vx0) || (a.x > vx1 && b.x > vx1) || (a.y < vy0 && b.y < vy0) || (a.y > vy1 && b.y > vy1)) continue
        const dimmed = S.dim(a) || S.dim(b)
        let bucket
        if (emph && !dimmed) {
          const direct = a === sel || b === sel
          const w = l.travelled ? (1.2 + 3 * l.w) * scale : 1.1
          bucket = direct ? add('emph-direct', P.accent, Math.max(1.6, w), 0.9) : add('emph' + Math.round(w * 2), P['ink-2'], w, 0.75)
          bucket.z = 2
        } else if (dimmed) {
          if (emph || k < 0.2) continue
          bucket = add('dim', P['line'], thin * 0.8, 0.6)
        } else if (sel && (a === sel || b === sel)) {
          bucket = add('sel', P.accent, Math.max(1.5, (1 + 3 * l.w) * scale), 0.85); bucket.z = 1
        } else if (!l.travelled) {
          bucket = add('cold', P['line-2'], thin, P.dark ? 0.8 : 0.9)
        } else {
          const q = Math.round(l.w * 4) / 4
          const w = (0.8 + 2.8 * q) * Math.max(0.5, Math.min(1.1, k * 1.2))
          bucket = l.cross ? add('x' + q, P['ink-3'], Math.max(0.8, w * 0.6), 0.4) : add(a.area + q, P.area[a.area], w, P.dark ? 0.48 : 0.38)
        }
        const x1 = a.x + a.r * 0.9, y1 = a.y, x2 = b.x - b.r * 0.9, y2 = b.y
        const mx = (x2 - x1) * 0.5
        bucket.path.moveTo(sx(x1), sy(y1))
        bucket.path.bezierCurveTo(sx(x1 + mx), sy(y1), sx(x2 - mx), sy(y2), sx(x2), sy(y2))
      }
      ctx.lineCap = 'round'
      for (const b of [...buckets.values()].sort((p, q) => p.z - q.z)) {
        ctx.strokeStyle = b.stroke; ctx.lineWidth = b.width; ctx.globalAlpha = b.alpha
        ctx.stroke(b.path)
      }
      ctx.globalAlpha = 1

      // Concepts
      const order = []
      for (const c of d.concepts) if (inView(c, c.r + 20)) order.push(c)
      const lit = (c) => (emph ? emph.has(c) : true) && S.passes(c)
      order.sort((a, b) => (lit(a) - lit(b)) || (a === sel) - (b === sel))
      for (const c of order) this.node(c, !lit(c))

      // Labels, by priority, never overlapping
      this.labels(order, this.areaLabels())
      S.drew(performance.now() - t0)
    }

    node(c, dimmed) {
      const { ctx, S } = this
      const P = S.palette
      const x = c.x * this.k + this.tx, y = c.y * this.k + this.ty
      const r = this.rs(c)
      const col = P.area[c.area]
      ctx.globalAlpha = dimmed ? (P.dark ? 0.22 : 0.2) : 1
      const seen = c.seen > 0
      const fill = c.status === 'solid' ? 0.92 : c.status === 'fading' ? 0.5 : 0.7
      if (r >= 4.5) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = P.paper; ctx.fill()
        if (seen) {
          ctx.save(); ctx.clip()
          const top = y + r - 2 * r * c.estimate
          ctx.globalAlpha *= fill
          ctx.fillStyle = col; ctx.fillRect(x - r, top, 2 * r, y + r - top)
          ctx.globalAlpha = dimmed ? 0.2 : 1
          // The high-water line: the highest it has stood
          const hw = y + r - 2 * r * c.level
          ctx.strokeStyle = P.ink; ctx.lineWidth = r > 9 ? 1.6 : 1.2
          ctx.beginPath(); ctx.moveTo(x - r, hw); ctx.lineTo(x + r, hw); ctx.stroke()
          ctx.restore()
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.strokeStyle = seen ? col : P['line-2']; ctx.lineWidth = seen ? 1.3 : 1.2
        ctx.stroke()
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        if (seen) { ctx.globalAlpha *= fill; ctx.fillStyle = col; ctx.fill() }
        else if (r >= 3.2) { ctx.strokeStyle = P['line-2']; ctx.lineWidth = 1; ctx.stroke() }
        else { ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.fillStyle = P['line-2']; ctx.fill() }
        ctx.globalAlpha = dimmed ? 0.2 : 1
      }
      if (c.status === 'fading' && r >= 2) {
        // Attention: the design's amber diamond, at the shoulder
        const s = Math.max(2.4, Math.min(4.2, r * 0.42)), dx = x + r * 0.78, dy = y - r * 0.78
        ctx.fillStyle = P['warn-mark']
        ctx.beginPath(); ctx.moveTo(dx, dy - s); ctx.lineTo(dx + s, dy); ctx.lineTo(dx, dy + s); ctx.lineTo(dx - s, dy); ctx.closePath(); ctx.fill()
      }
      if (c.ready) {
        ctx.beginPath(); ctx.arc(x, y, r + (r < 4 ? 2.2 : 3), 0, Math.PI * 2)
        ctx.strokeStyle = P.accent; ctx.lineWidth = c.readyRank != null && c.readyRank < 6 ? 2 : 1.4
        ctx.stroke()
      }
      if (c === S.sel || c === S.hover) {
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.arc(x, y, r + 5.5, 0, Math.PI * 2)
        ctx.strokeStyle = c === S.sel ? P.accent : P['ink-3']; ctx.lineWidth = c === S.sel ? 2.5 : 1.5
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    textWidth(s, font) {
      const key = font + s
      let w = this.widths.get(key)
      if (w == null) { this.ctx.font = font; w = this.ctx.measureText(s).width; this.widths.set(key, w) }
      return w
    }

    labels(order, reserved) {
      const { ctx, S, k } = this
      const P = S.palette
      const emph = S.emph
      const pri = (c) => {
        if (c === S.sel) return 1e9
        if (c === S.hover) return 9e8
        if (S.dim(c)) return -1
        let p = c.importance + (c.parent ? 0 : 6)
        if (emph) p += 1e6
        if (c.ready && c.readyRank != null) p += 2e5 - c.readyRank * 100
        else if (c.ready) p += 1e3
        if (c.status === 'fading') p += 5e3
        if (S.sel && (S.sel.prereq.includes(c) || S.sel.next.includes(c))) p += 5e5
        return p
      }
      const cands = []
      for (const c of order) {
        const p = pri(c)
        if (p < 0) continue
        const r = this.rs(c)
        // Level of detail: below this size only what matters most is named
        if (p < 1e3 && r < 3.4 && k < 0.5) continue
        if (p < 1e3 && k < 0.12) continue
        if (c.parent && p < 1e5 && k < 1.4) continue // the parts of a topic are named only close up
        cands.push([p, c, r])
      }
      cands.sort((a, b) => b[0] - a[0])
      const placed = []
      const CELL = 64, grid = new Map()
      const free = (x0, y0, x1, y1) => {
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const l = grid.get(i * 9973 + j)
          if (l) for (const b of l) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false
        }
        return true
      }
      const take = (b) => {
        for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) {
          const key = i * 9973 + j; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(b)
        }
      }
      for (const b of reserved) take(b)
      // Concepts themselves are obstacles for labels, so a name never sits on a node
      for (const c of order) {
        const r = this.rs(c)
        if (r < 3) continue
        const x = c.x * k + this.tx, y = c.y * k + this.ty
        take([x - r, y - r, x + r, y + r])
      }
      const max = 420
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      const named = new Set()
      for (const [p, c, r] of cands) {
        if (placed.length >= max) break
        const font = c === S.sel ? FONT_SEL : FONT
        // A part beside its named topic is named by its aspect alone
        const name = c.parent && named.has(c.parent) && c !== S.sel ? c.name.slice(c.parent.name.length + 2) : c.name
        const w = this.textWidth(name, font)
        const cx = c.x * k + this.tx, cy = c.y * k + this.ty, gap = r + (c.ready ? 7 : 5)
        // Right of the concept first, then above, below, left
        const spots = [[cx + gap, cy], [cx - w / 2, cy - gap - 8], [cx - w / 2, cy + gap + 8], [cx - gap - w, cy]]
        let at = null
        for (const [x, y] of spots) {
          const box = [x - 2, y - 8, x + w + 2, y + 8]
          if (box[0] < 0 || box[2] > this.w || box[1] < 0 || box[3] > this.h) continue
          if (free(...box)) { at = [x, y, box]; break }
        }
        // The selected and hovered concepts are always named; everything else only where there is room
        if (!at && p >= 9e8) { const x = cx + gap > this.w - w - 8 ? cx - gap - w : cx + gap; at = [x, cy, [x - 2, cy - 8, x + w + 2, cy + 8]] }
        if (!at) continue
        take(at[2])
        named.add(c)
        placed.push([name, at[0], at[1], font, c])
      }
      for (const [name, x, y, font, c] of placed) {
        ctx.font = font
        ctx.strokeStyle = P.paper; ctx.lineWidth = 3.5
        ctx.strokeText(name, x, y)
        ctx.fillStyle = c === S.sel ? P.accent : c.seen || c.ready ? P.ink : P['ink-2']
        ctx.fillText(name, x, y)
      }
    }

    areaLabels() {
      const { ctx, S, k } = this
      const P = S.palette
      const boxes = []
      ctx.textBaseline = 'alphabetic'
      ctx.lineJoin = 'round'
      for (const a of this.d.areas) {
        const b = this.areaBox.get(a.id), band = this.d.bands.get(a.id)
        const top = band.top * k + this.ty, bottom = band.bottom * k + this.ty
        if (bottom < 10 || top > this.h - 10) continue
        // To the left of the band's first column; pinned to the left edge while the band is on screen
        const nw = this.textWidth(a.name, AREA_FONT)
        const meta = `${b.solid} solid, ${b.fading} fading`
        const mw = this.textWidth(meta, META_FONT)
        const w = Math.max(nw + 15, mw + 15)
        const x = Math.max(12, b.x0 * k + this.tx - 18 - w)
        if (x > this.w - 100) continue
        const y = Math.max(22, Math.min((top + bottom) / 2 - 2, bottom - 4))
        ctx.globalAlpha = S.areasOff.has(a.id) ? 0.45 : 1
        ctx.fillStyle = P.area[a.id]
        ctx.beginPath(); ctx.roundRect(x, y - 9.5, 9, 9, 2); ctx.fill()
        ctx.font = AREA_FONT
        ctx.strokeStyle = P.paper; ctx.lineWidth = 4
        ctx.strokeText(a.name, x + 15, y); ctx.fillStyle = P.ink; ctx.fillText(a.name, x + 15, y)
        ctx.font = META_FONT
        ctx.strokeText(meta, x + 15, y + 16); ctx.fillStyle = P['ink-3']; ctx.fillText(meta, x + 15, y + 16)
        ctx.globalAlpha = 1
        boxes.push([x - 2, y - 14, x + w + 4, y + 21])
      }
      return boxes
    }
  }
  window.PathwaysView2D = View2D
})()
