/**
 * A small network learning in front of you: the network itself (edges are weights, nodes are
 * activations for one sample), what it outputs across the input plane, and its loss. Forward and
 * backward modes hold the weights still and walk one sample through, layer by layer.
 */
import { diverging, rgb, type Palette } from '../colour'
import { button, fitCanvas, h, num, ring, s, segmented, selectField, stat } from '../dom'
import { MLP, Trainer, activatePrime, bce, makeDataset, type Activation, type DatasetName, type Dataset } from '../mlp'
import { describeNetPart, neuronName, parseNetPart, type NetPart } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import { LIMITS, RATES, type NeuralNetSpec } from '../spec'

type Mode = NeuralNetSpec['mode']

const GRID = 40
const EXTENT = 1.25
const HISTORY = 360

const ACT_NAME: Record<Activation, string> = { tanh: 'tanh', relu: 'ReLU', sigmoid: 'σ' }

function create(spec: NeuralNetSpec, host: SimHost): SimView {
  let sizes = spec.layers.slice()
  let act = spec.activation
  let rate = spec.rate
  let seed = spec.seed
  let mode: Mode = spec.mode
  let data: Dataset = makeDataset(spec.data, spec.points, spec.seed, spec.noise)
  let net!: MLP
  let trainer!: Trainer
  let metrics = { loss: 0, accuracy: 0 }
  let history: number[] = []
  let stride = 1
  let sample = 0
  let stage = 0
  /** The neuron whose response fills the heat map (hovered or reached by keyboard); null = the output */
  let probe: { l: number; j: number } | null = null
  let cursor: { l: number; j: number } | null = null
  let surfaceStale = true
  let marked: string | null = null

  function build(): void {
    net = new MLP(sizes, act, seed)
    trainer = new Trainer(net, data, rate, spec.batch, seed)
    history = [net.evaluate(data).loss]
    stride = spec.pretrain ? 10 : 1
    for (let i = 1; i <= spec.pretrain; i++) {
      trainer.step()
      if (i % stride === 0) record(net.evaluate(data).loss)
    }
    metrics = net.evaluate(data)
    stage = 0
    probe = cursor = null
    surfaceStale = true
  }
  function record(loss: number): void {
    history.push(loss)
    if (history.length > HISTORY) {
      history = history.filter((_, i) => i % 2 === 0)
      stride *= 2
    }
  }
  build()

  const top = () => sizes.length - 1
  const lastStage = () => (mode === 'forward' ? top() : top() - 1)

  // ---------- Controls ----------
  const modeField = segmented<Mode>(
    'Mode',
    [
      ['train', 'Train'],
      ['forward', 'Forward pass'],
      ['backward', 'Backward pass']
    ],
    mode,
    (v) => {
      mode = v
      stage = 0
      surfaceStale = true
      layout()
      host.invalidate()
    }
  )
  const dataField = selectField<DatasetName>(
    'Data',
    [
      ['xor', 'XOR'],
      ['circle', 'Circle'],
      ['two-moons', 'Two moons'],
      ['spiral', 'Spiral'],
      ['linear', 'Linear']
    ],
    data.name,
    (v) => {
      data = makeDataset(v, spec.points, spec.seed, spec.noise)
      sample = 0
      build()
      host.invalidate()
    }
  )
  const actField = selectField<Activation>(
    'Activation',
    [
      ['tanh', 'tanh'],
      ['relu', 'ReLU'],
      ['sigmoid', 'Sigmoid']
    ],
    act,
    (v) => {
      act = v
      build()
      host.invalidate()
    }
  )
  const rates = RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b)
  const rateField = selectField(
    'Learning rate',
    rates.map((r) => [String(r), String(r)] as const),
    String(rate),
    (v) => {
      rate = Number(v)
      trainer.rate = rate
    }
  )
  const layersBox = h('div', { class: 'sim-layers' })
  const layersField = h('div', { class: 'sim-field' }, h('span', { class: 'sim-label' }, 'Hidden layers'), layersBox)
  function setHidden(hidden: number[]): void {
    sizes = [2, ...hidden, 1]
    build()
    buildLayerControls()
    layout()
    host.select(null)
    host.invalidate()
  }
  function buildLayerControls(): void {
    const hidden = sizes.slice(1, -1)
    layersBox.replaceChildren()
    hidden.forEach((n, i) => {
      const input = h('input', { type: 'number', class: 'sim-number', min: 1, max: LIMITS.neurons, value: n, 'aria-label': `Neurons in hidden layer ${i + 1}` })
      input.addEventListener('change', () => {
        const v = Math.min(LIMITS.neurons, Math.max(1, Math.round(Number(input.value) || 1)))
        const nextHidden = sizes.slice(1, -1)
        nextHidden[i] = v
        setHidden(nextHidden)
      })
      layersBox.append(input)
    })
    const fewer = button('−', () => setHidden(sizes.slice(1, -2)), 'quiet square')
    fewer.setAttribute('aria-label', 'Remove a hidden layer')
    fewer.disabled = hidden.length <= 1
    const more = button('+', () => setHidden([...sizes.slice(1, -1), 4]), 'quiet square')
    more.setAttribute('aria-label', 'Add a hidden layer')
    more.disabled = hidden.length >= LIMITS.hiddenLayers
    layersBox.append(fewer, more)
  }
  buildLayerControls()
  const params = h('div', { class: 'sim-params' }, modeField.el, dataField.el, actField.el, rateField.el, layersField)

  // ---------- Picture ----------
  const svg = s('svg', { class: 'sim-nn-svg', tabindex: 0, role: 'img', 'data-arrows': true, 'aria-label': 'The network. Arrow keys move between neurons, Enter selects one.' })
  const netBox = h('div', { class: 'sim-nn-net' }, svg as unknown as Node)
  const surface = h('canvas', { class: 'sim-canvas sim-nn-surface', tabindex: 0, role: 'button', 'aria-label': 'Decision surface. Click a point to follow that sample.' })
  const surfaceCap = h('span', { class: 'sim-cap' })
  const legend = h(
    'div',
    { class: 'sim-legend' },
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch square neg' }), 'Class 0'),
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch dot pos' }), 'Class 1')
  )
  const surfaceBox = h('div', { class: 'sim-plot sim-nn-side' }, surface, h('div', { class: 'sim-plot-foot' }, surfaceCap, legend))
  const lossCanvas = h('canvas', { class: 'sim-canvas sim-nn-loss', tabindex: 0, role: 'button', 'aria-label': 'Loss curve' })
  const lossCap = h('span', { class: 'sim-cap' }, 'Loss on all points, by batch')
  const lossBox = h('div', { class: 'sim-plot' }, lossCanvas, h('div', { class: 'sim-plot-foot' }, lossCap))
  const stats = { epoch: stat('Epoch'), batches: stat('Batches'), loss: stat('Loss'), accuracy: stat('Accuracy'), seed: stat('Seed') }
  const statsRow = h('div', { class: 'sim-stats' }, ...Object.values(stats).map((x) => x.el))
  const pass = h('div', { class: 'sim-pass' })
  const el = h('div', { class: 'sim-nn' }, params, h('div', { class: 'sim-nn-grid' }, netBox, surfaceBox, h('div', { class: 'sim-nn-under' }, lossBox, statsRow)), pass)

  // ---------- Network diagram ----------
  interface EdgeEl {
    l: number
    i: number
    j: number
    line: SVGLineElement
  }
  interface NodeEl {
    l: number
    j: number
    x: number
    y: number
    circle: SVGCircleElement
    text: SVGTextElement
  }
  let edges: EdgeEl[] = []
  let nodes: NodeEl[] = []
  let radius = 10
  let layoutWidth = 0
  const hlLayer = s('g', { class: 'sim-nn-hl' })

  const partOfNode = (l: number, j: number) => (l === top() ? 'output' : `neuron:${l}:${j + 1}`)

  function layout(): void {
    const w = netBox.clientWidth
    if (!w) return
    layoutWidth = w
    const tall = Math.max(...sizes)
    const hgt = Math.max(170, Math.min(250, 60 + tall * 30))
    const labels = mode !== 'train'
    const padL = 30
    const padR = labels ? 50 : 34
    const foot = 24
    const gap = Math.min(34, (hgt - foot - 12) / tall)
    radius = Math.max(5.5, Math.min(11, gap * 0.36))
    svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`)
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(hgt))
    const x = (l: number) => padL + (l * (w - padL - padR)) / top()
    const y = (l: number, j: number) => (hgt - foot) / 2 + (j - (sizes[l] - 1) / 2) * gap
    const edgeG = s('g')
    const hitG = s('g')
    const nodeG = s('g')
    const textG = s('g', { class: 'sim-nn-text' })
    edges = []
    nodes = []
    for (let l = 0; l < top(); l++)
      for (let j = 0; j < sizes[l + 1]; j++)
        for (let i = 0; i < sizes[l]; i++) {
          const at = { x1: x(l), y1: y(l, i), x2: x(l + 1), y2: y(l + 1, j) }
          const line = s('line', { ...at, class: 'sim-nn-edge' })
          const hit = s('line', { ...at, class: 'sim-nn-hit' })
          const part = `edge:${l}:${i + 1}:${j + 1}`
          hit.addEventListener('pointerenter', () => host.peek(part))
          hit.addEventListener('pointerleave', () => host.peek(null))
          hit.addEventListener('click', () => host.select(part))
          edgeG.append(line)
          hitG.append(hit)
          edges.push({ l, i, j, line })
        }
    for (let l = 0; l <= top(); l++) {
      for (let j = 0; j < sizes[l]; j++) {
        const circle = s('circle', { cx: x(l), cy: y(l, j), r: radius, class: 'sim-nn-node' })
        const text = s('text', { x: x(l) + radius + 5, y: y(l, j) + 3.5, class: 'sim-nn-val' })
        circle.addEventListener('pointerenter', () => {
          setProbe({ l, j })
          host.peek(partOfNode(l, j))
        })
        circle.addEventListener('pointerleave', () => {
          setProbe(null)
          host.peek(null)
        })
        circle.addEventListener('click', () => host.select(partOfNode(l, j)))
        nodeG.append(circle)
        textG.append(text)
        nodes.push({ l, j, x: x(l), y: y(l, j), circle, text })
        if (l === 0) textG.append(s('text', { x: x(0) - radius - 5, y: y(0, j) + 3.5, class: 'sim-nn-name', 'text-anchor': 'end' }, `x${j === 0 ? '₁' : '₂'}`))
      }
      const name = l === 0 ? 'Input' : l === top() ? 'Output' : sizes.length === 3 ? 'Hidden' : `Hidden ${l}`
      textG.append(s('text', { x: x(l), y: hgt - 6, class: 'sim-nn-col', 'text-anchor': l === 0 ? 'start' : l === top() ? 'end' : 'middle', dx: l === 0 ? -radius : l === top() ? radius : 0 }, name))
    }
    svg.replaceChildren(edgeG, hlLayer, hitG, nodeG, textG)
    mark(marked)
  }

  function setProbe(p: { l: number; j: number } | null): void {
    // The input neurons have no response to show; the output is the default picture
    const want = p && p.l > 0 && p.l < top() ? p : null
    if (want?.l !== probe?.l || want?.j !== probe?.j) {
      probe = want
      surfaceStale = true
      host.invalidate()
    }
  }

  svg.addEventListener('keydown', (e) => {
    const c = cursor ?? { l: 1, j: 0 }
    let next: { l: number; j: number } | null = null
    if (e.key === 'ArrowRight') next = { l: Math.min(top(), c.l + (cursor ? 1 : 0)), j: c.j }
    else if (e.key === 'ArrowLeft') next = { l: Math.max(0, c.l - 1), j: c.j }
    else if (e.key === 'ArrowDown') next = { l: c.l, j: c.j + (cursor ? 1 : 0) }
    else if (e.key === 'ArrowUp') next = { l: c.l, j: c.j - 1 }
    else if ((e.key === 'Enter' || e.key === ' ') && cursor) {
      host.select(partOfNode(cursor.l, cursor.j))
      e.preventDefault()
      return
    } else if (e.key === 'Escape') {
      cursor = null
      setProbe(null)
      host.peek(null)
      host.invalidate()
      return
    } else return
    next.j = Math.max(0, Math.min(sizes[next.l] - 1, next.j))
    cursor = next
    setProbe(next)
    host.peek(partOfNode(next.l, next.j))
    host.invalidate()
    e.preventDefault()
    e.stopPropagation()
  })
  svg.addEventListener('blur', () => {
    if (!cursor) return
    cursor = null
    setProbe(null)
    host.peek(null)
    host.invalidate()
  })

  function mark(part: string | null): void {
    marked = part
    hlLayer.replaceChildren()
    ring(surfaceBox, false)
    ring(lossBox, false)
    const p = part ? parseNetPart(part, sizes) : null
    if (!p) return
    if (p.type === 'surface') return ring(surfaceBox, true)
    if (p.type === 'loss') return ring(lossBox, true)
    const column = (l: number) => {
      const col = nodes.filter((n) => n.l === l)
      const y0 = col[0].y - radius - 8
      const y1 = col[col.length - 1].y + radius + 8
      hlLayer.append(s('rect', { x: col[0].x - radius - 8, y: y0, width: 2 * radius + 16, height: y1 - y0, rx: radius + 8, class: 'sim-nn-hl-col' }))
    }
    if (p.type === 'input') column(0)
    else if (p.type === 'output') column(top())
    else if (p.type === 'layer') column(p.l)
    else if (p.type === 'neuron') {
      const n = nodes.find((k) => k.l === p.l && k.j === p.j - 1)
      if (n) hlLayer.append(s('circle', { cx: n.x, cy: n.y, r: radius + 5, class: 'sim-nn-hl-ring' }))
    } else if (p.type === 'edge') {
      const a = nodes.find((k) => k.l === p.l && k.j === p.i - 1)
      const b = nodes.find((k) => k.l === p.l + 1 && k.j === p.j - 1)
      if (a && b) hlLayer.append(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sim-nn-hl-edge' }))
    }
  }

  /** Runs the selected sample forward and back, so a, z and delta describe it */
  function loadSample(): void {
    net.forward(data.x[sample * 2], data.x[sample * 2 + 1])
    net.backward(data.y[sample])
  }

  /** −1..1 for the diverging scale */
  function tone(l: number, a: number, scale: number): number {
    if (l === 0) return a
    if (l === top() || act === 'sigmoid') return 2 * a - 1
    if (act === 'relu') return a / scale
    return a
  }

  function drawNetwork(p: Palette): void {
    const revealed = (l: number) => (mode === 'train' ? true : mode === 'forward' ? l <= stage : l >= top() - stage)
    let maxGrad = 1e-9
    let maxDelta = 1e-9
    let maxRelu = 1
    if (mode === 'backward') {
      for (const e of edges) maxGrad = Math.max(maxGrad, Math.abs(net.weightGrad(e.l, e.i, e.j)))
      for (let l = 1; l <= top(); l++) for (const d of net.delta[l]) maxDelta = Math.max(maxDelta, Math.abs(d))
    }
    if (act === 'relu') for (let l = 1; l < top(); l++) for (const a of net.a[l]) maxRelu = Math.max(maxRelu, a)
    for (const e of edges) {
      const w = net.w[e.l][e.j * sizes[e.l] + e.i]
      const shown = revealed(e.l + 1)
      const v = mode === 'backward' ? net.weightGrad(e.l, e.i, e.j) / maxGrad : Math.max(-1, Math.min(1, w / 2.5))
      const size = Math.abs(v)
      const line = e.line
      line.setAttribute('stroke', v < 0 ? p.css.neg : p.css.pos)
      line.setAttribute('stroke-width', (shown ? 0.75 + 3.25 * size : 0.75).toFixed(2))
      line.setAttribute('stroke-opacity', (shown ? 0.28 + 0.67 * size : 0.12).toFixed(2))
    }
    for (const n of nodes) {
      const shown = revealed(n.l) && !(mode === 'backward' && n.l === 0)
      const value = mode === 'backward' ? net.delta[n.l][n.j] : net.a[n.l][n.j]
      const t = mode === 'backward' ? value / maxDelta : tone(n.l, value, maxRelu)
      n.circle.setAttribute('fill', shown ? rgb(diverging(p, t)) : p.css.bg)
      n.circle.classList.toggle('on', (cursor?.l === n.l && cursor.j === n.j) || (probe?.l === n.l && probe.j === n.j))
      n.circle.classList.toggle('pending', !shown)
      const label = mode === 'train' ? '' : shown ? num(value, 2) : ''
      if (n.text.textContent !== label) n.text.textContent = label
    }
  }

  // ---------- Decision surface ----------
  const grid = document.createElement('canvas')
  grid.width = grid.height = GRID
  const gridCtx = grid.getContext('2d')
  const image = gridCtx?.createImageData(GRID, GRID)
  const field = new Float64Array(GRID * GRID)

  function computeSurface(p: Palette): void {
    if (!gridCtx || !image) return
    let scale = 1
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        const x = -EXTENT + ((c + 0.5) / GRID) * 2 * EXTENT
        const y = EXTENT - ((r + 0.5) / GRID) * 2 * EXTENT
        const out = net.forward(x, y)
        const v = probe ? net.a[probe.l][probe.j] : out
        field[r * GRID + c] = v
        if (probe && act === 'relu') scale = Math.max(scale, v)
      }
    for (let k = 0; k < field.length; k++) {
      const t = probe ? tone(probe.l, field[k], scale) : 2 * field[k] - 1
      const colour = diverging(p, t, 0.5)
      image.data[k * 4] = colour[0]
      image.data[k * 4 + 1] = colour[1]
      image.data[k * 4 + 2] = colour[2]
      image.data[k * 4 + 3] = 255
    }
    gridCtx.putImageData(image, 0, 0)
    surfaceStale = false
  }

  const toPx = (v: number, size: number) => ((v + EXTENT) / (2 * EXTENT)) * size

  function drawSurface(p: Palette): void {
    if (surfaceStale) computeSurface(p)
    const fit = fitCanvas(surface)
    if (!fit) return
    const { ctx, w, h: hgt } = fit
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(grid, 0, 0, w, hgt)
    ctx.lineWidth = 1
    ctx.strokeStyle = rgb(p.bg)
    for (let i = 0; i < data.n; i++) {
      const x = toPx(data.x[i * 2], w)
      const y = hgt - toPx(data.x[i * 2 + 1], hgt)
      ctx.fillStyle = data.y[i] ? p.css.pos : p.css.neg
      ctx.beginPath()
      // Shape as well as colour tells the classes apart
      if (data.y[i]) ctx.arc(x, y, 3, 0, 2 * Math.PI)
      else ctx.rect(x - 2.6, y - 2.6, 5.2, 5.2)
      ctx.fill()
      ctx.stroke()
    }
    const sx = toPx(data.x[sample * 2], w)
    const sy = hgt - toPx(data.x[sample * 2 + 1], hgt)
    ctx.strokeStyle = rgb(p.bg)
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(sx, sy, 7.5, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.strokeStyle = p.css.ink
    ctx.lineWidth = 1.5
    ctx.stroke()
    const text = probe ? `Response of ${neuronName(sizes, probe.l, probe.j + 1)}` : 'Output across the input plane'
    if (surfaceCap.textContent !== text) surfaceCap.textContent = text
  }

  surface.addEventListener('click', (e) => {
    const box = surface.getBoundingClientRect()
    let best = -1
    let bestD = 12
    for (let i = 0; i < data.n; i++) {
      const d = Math.hypot(toPx(data.x[i * 2], box.width) - (e.clientX - box.left), box.height - toPx(data.x[i * 2 + 1], box.height) - (e.clientY - box.top))
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      sample = best
      stage = 0
    } else host.select('surface')
    host.invalidate()
  })
  surface.addEventListener('keydown', (e) => e.key === 'Enter' && host.select('surface'))
  lossCanvas.addEventListener('click', () => host.select('loss'))
  lossCanvas.addEventListener('keydown', (e) => e.key === 'Enter' && host.select('loss'))

  // ---------- Loss curve ----------
  function drawLoss(p: Palette): void {
    const fit = fitCanvas(lossCanvas)
    if (!fit) return
    const { ctx, w, h: hgt } = fit
    ctx.clearRect(0, 0, w, hgt)
    const padL = 30
    const padB = 16
    const padT = 8
    const padR = 8
    const max = Math.max(0.7, ...history) * 1.05
    const y = (v: number) => padT + (1 - Math.min(v, max) / max) * (hgt - padT - padB)
    const x = (i: number) => padL + (history.length > 1 ? i / (history.length - 1) : 0) * (w - padL - padR)
    ctx.strokeStyle = p.css.line
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const v of [0, max / 2, max]) {
      ctx.moveTo(padL, Math.round(y(v)) + 0.5)
      ctx.lineTo(w - padR, Math.round(y(v)) + 0.5)
    }
    ctx.stroke()
    ctx.fillStyle = p.css.muted
    ctx.font = `10px ${p.font}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText('0', padL - 6, y(0))
    ctx.fillText((max / 2).toFixed(2), padL - 6, y(max / 2))
    ctx.fillText(max.toFixed(2), padL - 6, y(max))
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(`${trainer.steps} batches`, w - padR, hgt - 2)
    ctx.textAlign = 'left'
    ctx.fillText('0', padL, hgt - 2)
    ctx.strokeStyle = p.css.accent
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    history.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))))
    ctx.stroke()
    const lx = x(history.length - 1)
    const ly = y(history[history.length - 1])
    ctx.fillStyle = p.css.accent
    ctx.strokeStyle = rgb(p.bg)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(lx, ly, 4, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
  }

  // ---------- Forward and backward passes, written out ----------
  function table(head: string[], rows: string[][]): HTMLElement {
    return h(
      'table',
      { class: 'sim-table' },
      h('thead', null, h('tr', null, ...head.map((t, i) => h('th', { scope: 'col', class: i ? 'n' : '' }, t)))),
      h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((t, i) => h(i ? 'td' : 'th', i ? { class: 'n' } : { scope: 'row' }, t)))))
    )
  }

  let passKey = ''
  function drawPass(): void {
    pass.hidden = mode === 'train'
    if (mode === 'train') return
    const key = `${mode}|${sample}|${stage}|${sizes.join()}|${act}|${trainer.steps}|${seed}|${data.name}`
    if (key === passKey) return
    passKey = key
    const x1 = data.x[sample * 2]
    const x2 = data.x[sample * 2 + 1]
    const target = data.y[sample]
    const out = net.a[top()][0]
    const parts: (Node | string)[] = []
    const layerName = (l: number) => (l === 0 ? 'the input' : l === top() ? 'the output' : sizes.length === 3 ? 'the hidden layer' : `hidden layer ${l}`)
    const fn = ACT_NAME[act]
    let lead: string
    if (mode === 'forward') {
      if (stage === 0) lead = `The inputs are x₁ = ${num(x1)} and x₂ = ${num(x2)}; the target is ${target}. Step to compute ${layerName(1)}.`
      else {
        const l = stage
        const outLayer = l === top()
        lead = outLayer ? `Output: z = Σ w·a + b, then ŷ = σ(z). Loss = −ln(${target ? 'ŷ' : '1 − ŷ'}) = ${num(bce(out, target))}.` : `${layerName(l).replace(/^./, (c) => c.toUpperCase())}: z = Σ w·a + b, then a = ${fn}(z).`
        const rows = Array.from({ length: sizes[l] }, (_, j) => {
          const z = net.z[l][j]
          const b = net.b[l - 1][j]
          return [outLayer ? 'ŷ' : `${j + 1}`, num(z - b), num(b), num(z), num(net.a[l][j])]
        })
        parts.push(table(['Neuron', 'Σ w·a', 'b', 'z', outLayer ? 'σ(z)' : `${fn}(z)`], rows))
      }
    } else {
      const l = top() - stage
      if (l === top()) {
        lead = `Start at the output. With a sigmoid output and cross-entropy loss, δ = ∂L/∂z = ŷ − y.`
        parts.push(table(['Neuron', 'ŷ', 'y', 'δ = ŷ − y'], [['ŷ', num(out), String(target), num(net.delta[l][0])]]))
      } else {
        lead = `${layerName(l).replace(/^./, (c) => c.toUpperCase())}: δ = (Σ w·δ from the layer above) × ${fn}′(z).`
        const rows = Array.from({ length: sizes[l] }, (_, j) => [`${j + 1}`, num(net.backSum(l, j)), num(activatePrime(act, net.z[l][j], net.a[l][j])), num(net.delta[l][j])])
        parts.push(table(['Neuron', 'Σ w·δ', `${fn}′(z)`, 'δ'], rows))
      }
      parts.push(h('p', { class: 'sim-note' }, `Each weight's gradient is its input activation × the δ it feeds: ∂L/∂w = a·δ, and ∂L/∂b = δ. Select an edge to read its gradient. A step of training would change it by −${rate} × gradient.`))
    }
    const nextSample = button('Next sample', () => {
      sample = (sample + 1) % data.n
      stage = 0
      host.invalidate()
    }, 'quiet')
    pass.replaceChildren(
      h(
        'div',
        { class: 'sim-pass-head' },
        h('span', { class: 'sim-pass-title' }, `${mode === 'forward' ? 'Forward' : 'Backward'} pass, sample ${sample + 1} of ${data.n}`),
        h('span', { class: 'sim-pass-step' }, `Step ${stage + 1} of ${lastStage() + 1}`),
        nextSample
      ),
      h('p', { class: 'sim-pass-lead' }, lead),
      ...parts,
      h('p', { class: 'sim-note' }, 'The weights are held still in this mode.')
    )
  }

  function context() {
    return { sample: sample + 1, target: data.y[sample], loss: metrics.loss, accuracy: metrics.accuracy, steps: trainer.steps }
  }

  return {
    el,
    stepsPerSecond: () => (mode === 'train' ? 120 : 1.25),
    step() {
      if (mode !== 'train') {
        if (stage < lastStage()) stage++
        else {
          stage = 0
          sample = (sample + 1) % data.n
        }
        return
      }
      trainer.step()
      metrics = net.evaluate(data)
      if (trainer.steps % stride === 0) record(metrics.loss)
      surfaceStale = true
    },
    reset() {
      seed += 1
      build()
    },
    draw() {
      const p = host.palette()
      if (!layoutWidth) layout()
      // The surface runs the net over the whole plane, so it goes first; the sample is loaded after
      drawSurface(p)
      loadSample()
      drawNetwork(p)
      drawLoss(p)
      stats.epoch.set(String(trainer.epoch))
      stats.batches.set(String(trainer.steps))
      stats.loss.set(metrics.loss.toFixed(3))
      stats.accuracy.set(`${Math.round(metrics.accuracy * 100)}%`)
      stats.seed.set(String(seed))
      drawPass()
    },
    relayout() {
      surfaceStale = true
      layout()
    },
    describe(part) {
      const p: NetPart | null = parseNetPart(part, sizes)
      if (!p) return null
      loadSample()
      return describeNetPart(net, p, context())
    },
    highlight: mark,
    sample(n) {
      sample = Math.max(0, Math.min(data.n - 1, n - 1))
      stage = 0
    }
  }
}

export const neuralNet: SimKindDef<NeuralNetSpec> = {
  label: 'Neural network',
  transport: true,
  autoplay: (spec) => spec.autoplay && spec.mode === 'train',
  create
}
