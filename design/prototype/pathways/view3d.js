/* The depth form: three.js (r170, vendored). Same encodings as the flat form: every concept is a point
 * sprite whose fragment shader draws the level (fill to how well it is held now, a line at the highest
 * it stood), the amber diamond for fading, the blue ring for ready next. Labels are HTML, so they are
 * always upright and crisp (billboards), and are shown by size on screen and by priority.
 * It draws only when something changes: no animation loop runs while the map is still. */
(function () {
  'use strict'
  const T = window.THREE
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const NODE = 0.62 // world radius per unit of the flat form's radius

  const VERT = `
    attribute vec3 aColor; attribute float aEst; attribute float aLevel; attribute float aSize; attribute vec4 aFlags; attribute float aSel; attribute float aBoost;
    uniform float uScale; uniform float uDpr; uniform float uMax;
    varying vec3 vColor; varying float vEst; varying float vLevel; varying vec4 vFlags; varying float vSel; varying float vPx; varying float vR;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float px = max(aSize * 2.0 * uScale / -mv.z, aSize * 0.4 + 3.5) * aBoost;
      float extra = (aFlags.y > 0.5 ? 9.0 : 0.0);
      extra = max(extra, aSel > 0.5 ? 14.0 : 0.0);
      float total = min(px + extra, uMax / uDpr);
      vR = min(px, total) / total;
      vPx = total * uDpr;
      gl_PointSize = vPx;
      vColor = aColor; vEst = aEst; vLevel = aLevel; vFlags = aFlags; vSel = aSel;
    }`
  const FRAG = `
    uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uLine; uniform vec3 uAccent; uniform vec3 uWarn; uniform vec3 uHover; uniform float uDim;
    varying vec3 vColor; varying float vEst; varying float vLevel; varying vec4 vFlags; varying float vSel; varying float vPx; varying float vR;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0; p.y = -p.y;
      float d = length(p);
      if (d > 1.0) discard;
      float px = 2.0 / vPx; // one device pixel, in point coordinates
      float rn = vR;
      bool seen = vFlags.z > 0.5;
      vec3 c;
      bool on = false;
      if (d <= rn) {
        on = true;
        float fillA = vFlags.x > 0.5 ? 0.5 : (vEst >= 0.6 ? 0.92 : 0.7);
        if (rn * vPx < 9.0) {
          c = seen ? mix(uPaper, vColor, fillA) : (d > rn - 2.2 * px ? uLine : uPaper);
        } else {
          c = uPaper;
          if (seen) {
            if (p.y < -rn + 2.0 * rn * vEst) c = mix(uPaper, vColor, fillA);
            if (abs(p.y - (-rn + 2.0 * rn * vLevel)) < 1.4 * px) c = uInk;
          }
          if (d > rn - 2.4 * px) c = seen ? vColor : uLine;
        }
      }
      // Fading: the amber diamond at the shoulder
      vec2 q = p - vec2(rn * 0.74, rn * 0.74);
      if (vFlags.x > 0.5 && abs(q.x) + abs(q.y) < max(rn * 0.3, 5.0 * px)) { c = uWarn; on = true; }
      // Ready next: a ring just outside
      if (vFlags.y > 0.5) {
        float g = rn + 4.0 * px * (vFlags.y > 1.5 ? 1.0 : 0.8);
        float w = (vFlags.y > 1.5 ? 2.2 : 1.6) * px;
        if (d > g && d < g + w * 1.5) { c = uAccent; on = true; }
      }
      if (vSel > 0.5) {
        float g = rn + 7.0 * px, w = (vSel > 1.5 ? 2.6 : 1.6) * px;
        if (d > g && d < g + w * 1.5) { c = vSel > 1.5 ? uAccent : uHover; on = true; }
      }
      if (!on) discard;
      if (vFlags.w > 0.5) c = mix(c, uPaper, uDim);
      gl_FragColor = vec4(c, 1.0);
    }`

  class View3D {
    constructor(canvas, S, opts) {
      this.cv = canvas
      this.S = S
      this.labelsEl = opts.labels
      // Colours are the design's sRGB tokens, passed through as they are
      T.ColorManagement.enabled = false
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })
      this.renderer.outputColorSpace = T.LinearSRGBColorSpace
      this.maxPoint = this.renderer.getContext().getParameter(this.renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1]
      this.scene = new T.Scene()
      this.camera = new T.PerspectiveCamera(40, 1, 2, 30000)
      this.orbit = { target: new T.Vector3(), r: 2000, theta: 0.9, phi: 1.2 }
      this.queued = false
      this.anim = null
      this.pool = []
      this.v = new T.Vector3()
      this.bind()
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement)
      this.setData()
    }

    setData() {
      const d = this.S.data
      this.d = d
      if (!d.centers3d) PathwaysLayout.layout3d(d)
      for (const o of [this.points, this.lines, this.discs]) if (o) { this.scene.remove(o); o.geometry && o.geometry.dispose() }
      const n = d.concepts.length
      const boost = new Float32Array(n).fill(1), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), est = new Float32Array(n), lev = new Float32Array(n), size = new Float32Array(n), flags = new Float32Array(n * 4), sel = new Float32Array(n)
      d.concepts.forEach((c, i) => {
        pos.set([c.px, c.py, c.pz], i * 3)
        est[i] = c.estimate; lev[i] = c.level; size[i] = c.r * NODE
      })
      const g = new T.BufferGeometry()
      g.setAttribute('position', new T.BufferAttribute(pos, 3))
      g.setAttribute('aColor', new T.BufferAttribute(col, 3))
      g.setAttribute('aEst', new T.BufferAttribute(est, 1))
      g.setAttribute('aLevel', new T.BufferAttribute(lev, 1))
      g.setAttribute('aSize', new T.BufferAttribute(size, 1))
      g.setAttribute('aFlags', new T.BufferAttribute(flags, 4))
      g.setAttribute('aSel', new T.BufferAttribute(sel, 1))
      g.setAttribute('aBoost', new T.BufferAttribute(boost, 1))
      const u = (v) => ({ value: v })
      this.mat = new T.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uScale: u(1), uDpr: u(1), uMax: u(this.maxPoint), uPaper: u(new T.Color()), uInk: u(new T.Color()), uLine: u(new T.Color()), uAccent: u(new T.Color()), uWarn: u(new T.Color()), uHover: u(new T.Color()), uDim: u(0.8) },
      })
      this.points = new T.Points(g, this.mat)
      this.points.frustumCulled = false
      this.scene.add(this.points)

      // Pathways: straight within an area, a shallow arc between towers. One draw call.
      const segs = []
      d.links.forEach((l, li) => {
        const a = l.from, b = l.to
        if (!l.cross) { segs.push([li, a.px, a.py, a.pz, b.px, b.py, b.pz]); return }
        const mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2 + 40, mz = (a.pz + b.pz) / 2
        // pull the middle towards the ring's centre so arcs pass inside, not through towers
        const k = 0.72
        const cx = mx * k, cz = mz * k
        let px = a.px, py = a.py, pz = a.pz
        for (let s = 1; s <= 8; s++) {
          const t = s / 8, it = 1 - t
          const x = it * it * a.px + 2 * it * t * cx + t * t * b.px
          const y = it * it * a.py + 2 * it * t * my + t * t * b.py
          const z = it * it * a.pz + 2 * it * t * cz + t * t * b.pz
          segs.push([li, px, py, pz, x, y, z]); px = x; py = y; pz = z
        }
      })
      this.segLink = new Int32Array(segs.length)
      const lp = new Float32Array(segs.length * 6), lc = new Float32Array(segs.length * 6)
      segs.forEach((s, i) => { this.segLink[i] = s[0]; lp.set(s.slice(1), i * 6) })
      const lg = new T.BufferGeometry()
      lg.setAttribute('position', new T.BufferAttribute(lp, 3))
      lg.setAttribute('color', new T.BufferAttribute(lc, 3))
      this.lines = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true }))
      this.lines.frustumCulled = false
      this.scene.add(this.lines)

      // A faint floor disc under each area's tower: the soft region
      this.discs = new T.Group()
      for (const a of d.areas) {
        const c = d.centers3d.get(a.id)
        const m = new T.Mesh(new T.CircleGeometry(130 + Math.sqrt(d.concepts.length) * 2.5, 64), new T.MeshBasicMaterial({ color: 0xffffff }))
        m.rotation.x = -Math.PI / 2
        m.position.set(c.x, -30, c.z)
        m.userData.area = a.id
        this.discs.add(m)
      }
      this.scene.add(this.discs)

      // Labels: a pool of divs, plus one per area
      this.labelsEl.innerHTML = ''
      this.pool = []
      this.areaEls = d.areas.map((a) => {
        const el = document.createElement('div'); el.className = 'ar'
        el.style.setProperty('--c', `var(${a.token})`)
        const cs = d.concepts.filter((c) => c.area === a.id)
        el.innerHTML = `${a.name} <span>${cs.filter((c) => c.status === 'solid').length} solid, ${cs.filter((c) => c.status === 'fading').length} fading, ${cs.filter((c) => c.ready).length} ready</span>`
        this.labelsEl.appendChild(el)
        return el
      })
      this.screen = new Float32Array(n * 4)
      this.fitted = false
      this.theme()
      if (this.w) this.fit(false)
    }

    // ---------- Style ----------
    theme() {
      const P = this.S.palette
      const C = (x) => new T.Color(x.startsWith('rgba') ? x.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : x)
      this.colors = { paper: C(P.paper), ink: C(P.ink), ink2: C(P['ink-2']), ink3: C(P['ink-3']), line: C(P.line), line2: C(P['line-2']), accent: C(P.accent), warn: C(P['warn-mark']), area: {} }
      for (const a of this.d.areas) this.colors.area[a.id] = C(P.area[a.id])
      this.renderer.setClearColor(this.colors.paper, 1)
      const U = this.mat.uniforms
      U.uPaper.value.copy(this.colors.paper); U.uInk.value.copy(this.colors.ink); U.uLine.value.copy(this.colors.line2)
      U.uAccent.value.copy(this.colors.accent); U.uWarn.value.copy(this.colors.warn); U.uHover.value.copy(this.colors.ink3)
      U.uDim.value = P.dark ? 0.82 : 0.86
      for (const m of this.discs.children) m.material.color.copy(this.colors.paper).lerp(this.colors.area[m.userData.area], P.dark ? 0.07 : 0.055)
      this.restyle()
    }
    restyle(light) {
      const S = this.S, d = this.d, C = this.colors
      const g = this.points.geometry
      const flags = g.attributes.aFlags.array, sel = g.attributes.aSel.array, col = g.attributes.aColor.array
      d.concepts.forEach((c, i) => {
        sel[i] = c === S.sel ? 2 : c === S.hover ? 1 : 0
        if (light) return
        const k = C.area[c.area]
        col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b
        flags[i * 4] = c.status === 'fading' ? 1 : 0
        flags[i * 4 + 1] = c.ready ? (c.readyRank != null && c.readyRank < 6 ? 2 : 1) : 0
        flags[i * 4 + 2] = c.seen > 0 ? 1 : 0
        flags[i * 4 + 3] = S.dim(c) ? 1 : 0
        // In focus mode the lit chain is drawn larger, since every line is one pixel wide
        g.attributes.aBoost.array[i] = S.emph && S.emph.has(c) ? 1.6 : 1
      })
      g.attributes.aSel.needsUpdate = true
      if (!light) {
        g.attributes.aFlags.needsUpdate = true
        g.attributes.aColor.needsUpdate = true
        g.attributes.aBoost.needsUpdate = true
        // Pathways: WebGL draws every line one pixel wide, so travel is shown by strength of colour
        const lc = this.lines.geometry.attributes.color.array
        const tmp = new T.Color()
        const emph = S.emph, P = S.palette
        const style = d.links.map((l) => {
          const a = l.from, b = l.to
          const dimmed = S.dim(a) || S.dim(b)
          if (emph && !dimmed) return a === S.sel || b === S.sel ? tmp.copy(C.accent).clone() : tmp.copy(C.paper).lerp(C.ink2, 0.8).clone()
          if (dimmed) return tmp.copy(C.paper).lerp(C.line2, emph ? 0.25 : 0.45).clone()
          if (S.sel && (a === S.sel || b === S.sel)) return C.accent.clone()
          if (!l.travelled) return tmp.copy(C.paper).lerp(C.line2, 0.9).clone()
          const base = l.cross ? C.ink3 : C.area[a.area]
          return tmp.copy(C.paper).lerp(base, (P.dark ? 0.4 : 0.32) + 0.55 * l.w).clone()
        })
        for (let i = 0; i < this.segLink.length; i++) { const c = style[this.segLink[i]]; lc.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6) }
        this.lines.geometry.attributes.color.needsUpdate = true
      }
      this.request()
    }

    // ---------- Sizing and camera ----------
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect()
      if (!r.width) return
      this.w = r.width; this.h = r.height
      const dpr = this.S.busy ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
      this.dpr = dpr
      this.renderer.setPixelRatio(dpr)
      this.renderer.setSize(r.width, r.height, false)
      this.camera.aspect = r.width / r.height
      this.camera.updateProjectionMatrix()
      this.mat.uniforms.uScale.value = r.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
      this.mat.uniforms.uDpr.value = dpr
      if (!this.fitted) this.fit(false)
      this.renderNow()
    }
    show() { this.visible = true; this.resize(); this.request() }
    hide() { this.visible = false; this.labelsEl.innerHTML = ''; this.pool = []; this.areaEls.forEach((e) => this.labelsEl.appendChild(e)) }
    focusCanvas() { this.cv.focus({ preventScroll: true }) }
    place() {
      const o = this.orbit
      o.phi = Math.max(0.12, Math.min(Math.PI - 0.12, o.phi))
      const sp = Math.sin(o.phi)
      this.camera.position.set(o.target.x + o.r * sp * Math.cos(o.theta), o.target.y + o.r * Math.cos(o.phi), o.target.z + o.r * sp * Math.sin(o.theta))
      this.camera.lookAt(o.target)
      this.camera.updateMatrixWorld()
    }
    fit(animate) {
      const d = this.d
      const rad = Math.hypot(d.ring3d + 200, d.height3d / 2 + 80)
      const r = rad / Math.sin((this.camera.fov * Math.PI) / 360) * 0.7
      this.fitted = true
      this.go(new T.Vector3(0, d.height3d * 0.42, 0), r, animate, { theta: this.orbit.theta, phi: 1.18 })
    }
    zoom(f) { this.go(this.orbit.target.clone(), Math.max(60, Math.min(12000, this.orbit.r / f)), true) }
    flyTo(c, instant, chain) {
      let target = new T.Vector3(c.px, c.py, c.pz), r = 420
      if (chain && this.S.emph) {
        const box = new T.Box3()
        for (const n of this.S.emph) box.expandByPoint(new T.Vector3(n.px, n.py, n.pz))
        const sphere = box.getBoundingSphere(new T.Sphere())
        target = sphere.center
        r = Math.max(380, (sphere.radius + 80) / Math.sin((this.camera.fov * Math.PI) / 360))
      }
      this.go(target, r, !instant)
    }
    reveal(c) {
      const s = this.project(c)
      if (!s || s.x < 60 || s.y < 60 || s.x > this.w - 60 || s.y > this.h - 60) this.go(new T.Vector3(c.px, c.py, c.pz), Math.min(this.orbit.r, 900), true)
      else this.request()
    }
    go(target, r, animate, angles) {
      const o = this.orbit
      if (!animate || this.S.reduced()) {
        this.anim = null; o.target.copy(target); o.r = r
        if (angles) { o.theta = angles.theta; o.phi = angles.phi }
        this.request(); return
      }
      this.anim = { t0: performance.now(), dur: 700, from: { t: o.target.clone(), r: o.r, theta: o.theta, phi: o.phi }, to: { t: target.clone(), r, theta: angles ? angles.theta : o.theta, phi: angles ? angles.phi : o.phi } }
      this.request()
    }
    step(now) {
      const a = this.anim
      if (!a) return false
      const t = Math.min(1, (now - a.t0) / a.dur), e = ease(t), o = this.orbit
      o.target.lerpVectors(a.from.t, a.to.t, e)
      o.r = Math.exp(Math.log(a.from.r) + (Math.log(a.to.r) - Math.log(a.from.r)) * e)
      o.theta = a.from.theta + (a.to.theta - a.from.theta) * e
      o.phi = a.from.phi + (a.to.phi - a.from.phi) * e
      if (t >= 1) this.anim = null
      return !!this.anim
    }

    // ---------- Input ----------
    bind() {
      const cv = this.cv
      let down = null
      cv.addEventListener('contextmenu', (e) => e.preventDefault())
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId)
        down = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button !== 0 }
        this.anim = null
      })
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect()
        if (down) {
          const dx = e.clientX - down.x, dy = e.clientY - down.y
          if (!down.moved && Math.abs(dx) + Math.abs(dy) > 3) { down.moved = true; cv.classList.add('dragging'); this.S.setHover(null) }
          if (!down.moved) return
          down.x = e.clientX; down.y = e.clientY
          const o = this.orbit
          if (down.pan) {
            const s = o.r * 0.0011
            const right = new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
            const up = new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
            o.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s)
          } else { o.theta += dx * 0.006; o.phi -= dy * 0.006 }
          this.request()
          return
        }
        const c = this.pick(e.clientX - r.left, e.clientY - r.top)
        cv.classList.toggle('on-node', !!c)
        this.S.setHover(c, e.clientX, e.clientY)
      })
      cv.addEventListener('pointerup', (e) => {
        cv.classList.remove('dragging')
        if (down && !down.moved) {
          const r = cv.getBoundingClientRect()
          const c = this.pick(e.clientX - r.left, e.clientY - r.top)
          this.S.select(c)
          if (c) this.flyTo(c)
        }
        down = null
      })
      cv.addEventListener('pointerleave', () => this.S.setHover(null))
      cv.addEventListener('wheel', (e) => {
        e.preventDefault()
        this.anim = null
        const o = this.orbit
        if (e.ctrlKey || e.metaKey || e.deltaMode === 1) o.r = Math.max(60, Math.min(12000, o.r * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.01))))
        else { o.r = Math.max(60, Math.min(12000, o.r * Math.exp(e.deltaY * 0.0025))); o.theta += e.deltaX * 0.003 }
        this.request()
      }, { passive: false })
      document.getElementById('zoomIn').addEventListener('click', () => this.S.view === this && this.zoom(1.5))
      document.getElementById('zoomOut').addEventListener('click', () => this.S.view === this && this.zoom(1 / 1.5))
      document.getElementById('zoomFit').addEventListener('click', () => this.S.view === this && this.fit(true))
    }
    project(c) {
      const v = this.v.set(c.px, c.py, c.pz).project(this.camera)
      if (v.z > 1 || v.z < -1) return null
      return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h, z: v.z }
    }
    // Screen positions of every concept, refreshed on each frame drawn
    projectAll() {
      const s = this.screen, m = new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse), e = m.elements
      const scale = this.mat.uniforms.uScale.value
      this.d.concepts.forEach((c, i) => {
        const x = c.px, y = c.py, z = c.pz
        const w = e[3] * x + e[7] * y + e[11] * z + e[15]
        if (w <= 0) { s[i * 4 + 3] = -1; return }
        s[i * 4] = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2 * this.w
        s[i * 4 + 1] = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2 * this.h
        s[i * 4 + 2] = w // distance along the view
        s[i * 4 + 3] = Math.max(c.r * NODE * 2 * scale / w, c.r * NODE * 0.4 + 3.5) / 2 // radius on screen
      })
    }
    pick(sx, sy) {
      const s = this.screen
      let best = null, bz = Infinity
      this.d.concepts.forEach((c, i) => {
        const r = s[i * 4 + 3]
        if (r < 0 || this.S.dim(c)) return
        const d = Math.hypot(s[i * 4] - sx, s[i * 4 + 1] - sy)
        if (d < Math.max(r + 2, 6) && s[i * 4 + 2] < bz) { bz = s[i * 4 + 2]; best = c }
      })
      return best
    }
    neighbour(from, [dx, dy]) {
      const s = this.screen
      const cands = this.d.concepts.filter((c) => !this.S.dim(c) && s[c.i * 4 + 3] > 0)
      if (!from) {
        let best = null, bd = Infinity
        for (const c of cands) { const d = Math.hypot(s[c.i * 4] - this.w / 2, s[c.i * 4 + 1] - this.h / 2); if (d < bd) { bd = d; best = c } }
        return best
      }
      const fx = s[from.i * 4], fy = s[from.i * 4 + 1]
      let best = null, bs = Infinity
      for (const c of cands) {
        if (c === from) continue
        const vx = s[c.i * 4] - fx, vy = s[c.i * 4 + 1] - fy
        const along = vx * dx + vy * dy
        if (along <= 2) continue
        const perp = Math.abs(vx * dy - vy * dx)
        if (perp > along * 2.2) continue
        const linked = from.prereq.includes(c) || from.next.includes(c) ? 0.6 : 1
        const sc = (along + perp * 2.5) * linked
        if (sc < bs) { bs = sc; best = c }
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
      if (!this.bench0) this.bench0 = { theta: this.orbit.theta, r: this.orbit.r }
      this.orbit.theta = this.bench0.theta + t * 0.9
      this.orbit.r = this.bench0.r * (0.55 + 0.3 * Math.sin(t * 1.3))
    }
    sync() { const gl = this.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)) }
    renderNow() {
      if (!this.w || !this.visible) return
      const t0 = performance.now()
      this.place()
      this.renderer.render(this.scene, this.camera)
      this.projectAll()
      this.labels()
      this.S.drew(performance.now() - t0)
    }

    labels() {
      const S = this.S, s = this.screen, emph = S.emph
      const cands = []
      this.d.concepts.forEach((c, i) => {
        const r = s[i * 4 + 3]
        if (r < 0) return
        const x = s[i * 4], y = s[i * 4 + 1]
        if (x < -50 || x > this.w + 10 || y < -10 || y > this.h + 10) return
        let p
        if (c === S.sel) p = 1e9
        else if (c === S.hover) p = 9e8
        else if (S.dim(c)) return
        else {
          p = r * 40 + (c.parent ? 0 : 30)
          if (emph) p += 1e6
          if (c.ready && c.readyRank != null) p += 2e5 - c.readyRank * 100
          if (S.sel && (S.sel.prereq.includes(c) || S.sel.next.includes(c))) p += 5e5
          // Shown by distance: small (far) concepts are named only when they matter most
          if (p < 1e5 && r < 5.5) return
        }
        cands.push([p, c, x, y, r])
      })
      cands.sort((a, b) => b[0] - a[0])
      // Area names at the foot of each tower, placed first so concept names keep clear of them
      const boxes = []
      this.d.areas.forEach((a, i) => {
        const c = this.d.centers3d.get(a.id)
        const v = this.v.set(c.x, c.y - 24, c.z).project(this.camera)
        const el = this.areaEls[i]
        if (v.z > 1) { el.style.display = 'none'; return }
        const x = Math.max(8, Math.min(this.w - 260, (v.x + 1) / 2 * this.w - 60)), y = Math.max(8, Math.min(this.h - 28, (1 - v.y) / 2 * this.h + 10))
        el.style.display = ''
        el.style.opacity = S.areasOff.has(a.id) || S.emph ? 0.45 : 1
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
        boxes.push([x, y, x + 150 + a.name.length * 7, y + 18])
      })
      const out = []
      const fits = (b) => { for (const o of boxes) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; return true }
      for (const [p, c, x, y, r] of cands) {
        if (out.length >= 90) break
        const w = c.name.length * 6.6 + 4
        const lx = x + r + (c.ready ? 9 : 6), ly = y - 8
        const b = [lx, ly, lx + w, ly + 16]
        if (p < 9e8 && !fits(b)) continue
        boxes.push(b)
        out.push([c, lx, ly])
      }
      while (this.pool.length < out.length) { const el = document.createElement('div'); el.className = 'l'; this.labelsEl.appendChild(el); this.pool.push(el) }
      this.pool.forEach((el, i) => {
        const o = out[i]
        if (!o) { if (el.style.display !== 'none') el.style.display = 'none'; return }
        const [c, x, y] = o
        if (el._c !== c) { el.textContent = c.name; el._c = c; el.className = 'l' + (c === S.sel ? ' sel' : c.seen || c.ready ? '' : ' m') }
        else el.className = 'l' + (c === S.sel ? ' sel' : c.seen || c.ready ? '' : ' m')
        el.style.display = ''
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      })
    }
  }
  window.PathwaysView3D = View3D
})()
