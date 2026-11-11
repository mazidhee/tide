/**
 * Self-attention on one sentence: pick a token and see its scores against every other token,
 * the softmax weights (as arcs, and as a row of the full matrix), and the output it gets by
 * mixing the value vectors with those weights. A seeded toy model: the mechanism, not a trained one.
 */
import { attend, buildAttention, type AttentionModel, type AttentionResult } from '../attention'
import { diverging, rgb } from '../colour'
import { h, num, rangeField, ring, s, segmented, selectField, type Field } from '../dom'
import { describeAttentionPart, parseAttentionPart } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { AttentionSpec } from '../spec'

const ARC_H = 58

/** ".46" style: two decimals without the leading zero, for small cells */
const short = (w: number) => (w >= 0.995 ? '1.0' : w.toFixed(2).slice(1))

function create(spec: AttentionSpec, host: SimHost): SimView {
  const tokens = spec.tokens
  const n = tokens.length
  let heads = spec.heads
  let head = 0
  let temperature = spec.temperature
  let causal = spec.causal
  let selected = spec.select
  let seed = spec.seed
  let model: AttentionModel
  let result: AttentionResult
  let marked: string | null = null

  function compute(): void {
    result = attend(model, head, temperature, causal)
  }
  function rebuild(): void {
    model = buildAttention(tokens, heads, seed)
    head = Math.min(head, heads - 1)
    compute()
  }
  model = buildAttention(tokens, heads, seed)
  result = attend(model, head, temperature, causal)

  // ---------- Controls ----------
  const headSlot = h('div', { class: 'sim-slot' })
  let headField: Field<string>
  function buildHeadField(): void {
    headField = segmented(
      'Showing head',
      Array.from({ length: heads }, (_, i) => [String(i), String(i + 1)] as const),
      String(head),
      (v) => {
        head = Number(v)
        compute()
        host.invalidate()
      }
    )
    headSlot.replaceChildren(headField.el)
  }
  buildHeadField()
  const headsField = selectField(
    'Heads',
    [1, 2, 3, 4].map((k) => [String(k), String(k)] as const),
    String(heads),
    (v) => {
      heads = Number(v)
      rebuild()
      buildHeadField()
      buildMix()
      host.invalidate()
    }
  )
  const tempField = rangeField('Temperature', { min: 0.1, max: 5, step: 0.1, value: temperature, format: (v) => v.toFixed(1) }, (v) => {
    temperature = v
    compute()
    host.invalidate()
  })
  tempField.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && host.select('weights'))
  const causalBox = h('input', { type: 'checkbox', class: 'sim-check' })
  causalBox.checked = causal
  causalBox.addEventListener('change', () => {
    causal = causalBox.checked
    compute()
    host.invalidate()
  })
  const params = h('div', { class: 'sim-params' }, headSlot, headsField.el, tempField.el, h('label', { class: 'sim-field sim-field-check' }, causalBox, h('span', { class: 'sim-label' }, 'Causal mask')))

  const choose = (i: number, part: string) => {
    selected = i
    host.select(part)
    host.invalidate()
  }

  // ---------- Sentence with arcs ----------
  const arcs = s('svg', { class: 'sim-att-arcs', height: ARC_H, 'aria-hidden': 'true' })
  const arcPaths = tokens.map(() => arcs.appendChild(s('path', { class: 'sim-att-arc' })))
  const chips = tokens.map((t, i) => {
    const weight = h('span', { class: 'sim-att-w' })
    const b = h('button', { type: 'button', class: 'sim-att-token', title: t }, h('span', { class: 'sim-att-word' }, t), weight)
    b.addEventListener('click', () => choose(i, `token:${i + 1}`))
    return { b, weight }
  })
  const tokenRow = h('div', { class: 'sim-att-tokens' }, ...chips.map((c) => c.b))
  const seqCap = h('span', { class: 'sim-cap' })
  const seq = h('div', { class: 'sim-att-seq' }, arcs as unknown as Node, tokenRow, seqCap)

  // ---------- Weight matrix ----------
  const cols = `--n: ${n}`
  const matrixHead = h('div', { class: 'sim-att-row head', style: cols }, h('span', { class: 'sim-att-corner' }, 'query ↓\nkey →'), ...tokens.map((t) => h('span', { class: 'sim-att-colname', title: t }, t)))
  const rows = tokens.map((t, i) => {
    const cells = tokens.map(() => h('span', { class: 'sim-att-cell' }))
    const name = h('button', { type: 'button', class: 'sim-att-rowname', title: t }, t)
    const row = h('div', { class: 'sim-att-row', style: cols }, name, ...cells)
    row.addEventListener('click', () => choose(i, `row:${i + 1}`))
    return { row, cells }
  })
  const matrix = h('div', { class: `sim-att-matrix${n > 8 ? ' dense' : ''}` }, matrixHead, ...rows.map((r) => r.row))
  const matrixBox = h('div', { class: 'sim-plot' }, matrix, h('div', { class: 'sim-plot-foot' }, h('span', { class: 'sim-cap' }, 'Attention weights: each row sums to 1')))

  // ---------- The selected token, written out ----------
  const detailTitle = h('div', { class: 'sim-pass-title' })
  const scoreBody = h('tbody')
  const scoreRows = tokens.map((t) => {
    const cellsOf = [h('td', { class: 'n' }), h('td', { class: 'n' }), h('td', { class: 'n' })]
    const bar = h('i', { class: 'sim-att-bar' })
    scoreBody.append(h('tr', null, h('th', { scope: 'row' }, t), ...cellsOf, h('td', { class: 'sim-att-barcell' }, bar)))
    return { cellsOf, bar }
  })
  const scoreHead = h('tr')
  const scoreTable = h('table', { class: 'sim-table sim-att-scores' }, h('thead', null, scoreHead), scoreBody)
  scoreTable.addEventListener('click', () => host.select('scores'))
  const mixBox = h('div', { class: 'sim-att-mix', tabindex: 0, role: 'button', 'aria-label': 'The output mix' })
  mixBox.addEventListener('click', () => host.select('mix'))
  mixBox.addEventListener('keydown', (e) => e.key === 'Enter' && host.select('mix'))
  let mixRows: { label: HTMLElement; cells: HTMLElement[] }[] = []
  function buildMix(): void {
    const strip = () => {
      const label = h('span', { class: 'sim-att-mixlabel' })
      const cells = Array.from({ length: model.dk }, () => h('i', { class: 'sim-att-vcell' }))
      return { label, cells, el: h('div', { class: 'sim-att-mixrow' }, label, h('span', { class: 'sim-att-strip' }, ...cells)) }
    }
    const built = [strip(), strip(), strip(), strip()]
    built[3].el.classList.add('total')
    mixRows = built
    mixBox.replaceChildren(
      h('div', { class: 'sim-pass-title' }, 'Output = Σ weight × value vector'),
      ...built.map((b) => b.el),
      h(
        'div',
        { class: 'sim-legend' },
        h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch square neg' }), 'Negative'),
        h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch square pos' }), 'Positive'),
        h('span', { class: 'sim-cap' }, `Each strip is a vector of ${model.dk} numbers`)
      )
    )
  }
  buildMix()
  const detail = h('div', { class: 'sim-att-detail' }, detailTitle, scoreTable, mixBox)
  const note = h('p', { class: 'sim-note sim-att-toy' }, 'A toy model. The embeddings and the query, key and value matrices are seeded random numbers, not a trained language model, so which words attend to which means nothing. The arithmetic is exactly what a transformer does.')
  const el = h('div', { class: 'sim-att' }, params, seq, h('div', { class: 'sim-att-grid' }, matrixBox, detail), note)

  function mark(part: string | null): void {
    marked = part
    const p = part ? parseAttentionPart(part, n) : null
    chips.forEach((c, i) => ring(c.b, p?.type === 'token' && p.i === i + 1))
    rows.forEach((r, i) => ring(r.row, p?.type === 'row' && p.i === i + 1))
    ring(matrixBox, p?.type === 'weights')
    ring(scoreTable, p?.type === 'scores')
    ring(mixBox, p?.type === 'mix')
  }

  function drawArcs(): void {
    const width = tokenRow.clientWidth
    if (!width) return
    arcs.setAttribute('width', String(width))
    arcs.setAttribute('viewBox', `0 0 ${width} ${ARC_H}`)
    const centre = (i: number) => chips[i].b.offsetLeft + chips[i].b.offsetWidth / 2
    const from = centre(selected)
    for (let j = 0; j < n; j++) {
      const w = result.weights[selected * n + j]
      const to = centre(j)
      const path = arcPaths[j]
      if (j === selected) path.setAttribute('d', `M ${from - 7} ${ARC_H} C ${from - 14} ${ARC_H - 24}, ${from + 14} ${ARC_H - 24}, ${from + 7} ${ARC_H}`)
      else {
        // Both ends leave the tokens upright, so it is clear which token an arc lands on
        const lift = (14 + (ARC_H - 20) * (Math.abs(to - from) / width)) * (4 / 3)
        path.setAttribute('d', `M ${from} ${ARC_H} C ${from} ${ARC_H - lift}, ${to} ${ARC_H - lift}, ${to} ${ARC_H}`)
      }
      path.setAttribute('stroke-width', (0.75 + 5 * w).toFixed(2))
      path.setAttribute('stroke-opacity', w === 0 ? '0' : (0.18 + 0.8 * w).toFixed(2))
    }
  }

  return {
    el,
    stepsPerSecond: () => 0.7,
    step() {
      selected = (selected + 1) % n
    },
    reset() {
      seed += 1
      rebuild()
    },
    draw() {
      const p = host.palette()
      const word = tokens[selected]
      chips.forEach((c, i) => {
        c.b.setAttribute('aria-pressed', i === selected ? 'true' : 'false')
        c.weight.textContent = short(result.weights[selected * n + i])
      })
      seqCap.textContent = `How much "${word}" attends to each token (head ${head + 1} of ${heads}). Select a token to change the query.`
      drawArcs()
      rows.forEach((r, i) => {
        r.row.classList.toggle('on', i === selected)
        r.cells.forEach((cell, j) => {
          const w = result.weights[i * n + j]
          cell.style.backgroundColor = rgb(p.pos, 0.06 + 0.66 * w)
          cell.classList.toggle('masked', causal && j > i)
          cell.textContent = causal && j > i ? '' : short(w)
          cell.title = `"${tokens[i]}" attends to "${tokens[j]}": ${w.toFixed(3)}`
        })
      })
      detailTitle.textContent = `"${word}" as the query`
      scoreHead.replaceChildren(
        h('th', { scope: 'col' }, 'Key'),
        h('th', { scope: 'col', class: 'n' }, 'q·k'),
        h('th', { scope: 'col', class: 'n' }, `÷ √${model.dk}`),
        h('th', { scope: 'col', class: 'n' }, 'Weight'),
        h('th', { scope: 'col', class: 'sim-att-barcell' }, '')
      )
      scoreRows.forEach((r, j) => {
        const w = result.weights[selected * n + j]
        r.cellsOf[0].textContent = num(result.raw[selected * n + j], 2)
        r.cellsOf[1].textContent = num(result.scores[selected * n + j], 2)
        r.cellsOf[2].textContent = w.toFixed(3)
        r.bar.style.width = `${(w * 100).toFixed(1)}%`
      })
      // The three largest contributors, then the mixed output
      const order = Array.from({ length: n }, (_, j) => j).sort((a, b) => result.weights[selected * n + b] - result.weights[selected * n + a])
      const v = model.v[head]
      let scale = 1e-9
      for (const x of v) scale = Math.max(scale, Math.abs(x))
      mixRows.forEach((row, k) => {
        const total = k === 3
        const j = order[Math.min(k, n - 1)]
        const hidden = !total && k >= n
        row.label.parentElement!.hidden = hidden
        if (hidden) return
        row.label.textContent = total ? `= output for "${word}"` : `${result.weights[selected * n + j].toFixed(2)} × v("${tokens[j]}")${k === 2 && n > 3 ? ' + …' : ' +'}`
        row.cells.forEach((cell, c) => {
          const value = total ? result.out[selected * model.dk + c] : v[j * model.dk + c]
          cell.style.backgroundColor = rgb(diverging(p, value / scale))
          cell.title = num(value, 3)
        })
      })
    },
    relayout() {
      mark(marked)
    },
    describe(part) {
      const p = parseAttentionPart(part, n)
      return p ? describeAttentionPart(model, result, p, { selected, head, temperature }) : null
    },
    highlight: mark,
    sample(k) {
      selected = Math.max(0, Math.min(n - 1, k - 1))
    }
  }
}

export const attention: SimKindDef<AttentionSpec> = {
  label: 'Self-attention',
  transport: true,
  autoplay: () => false,
  create
}
