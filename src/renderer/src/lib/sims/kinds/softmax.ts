/**
 * Softmax by hand: drag the logits and watch the probabilities, with temperature. The numbers
 * shown are the numbers computed: z / T, then exp, then each one's share of the total.
 */
import { h, num, rangeField, ring, stat } from '../dom'
import { describeSoftmaxPart, parseSoftmaxPart } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import { entropyBits, softmax } from '../softmax'
import { LIMITS, type SoftmaxSpec } from '../spec'

function create(spec: SoftmaxSpec, host: SimHost): SimView {
  const labels = spec.labels
  const n = labels.length
  const logits = Float64Array.from(spec.logits)
  const p = new Float64Array(n)
  let temperature = spec.temperature

  const tempField = rangeField('Temperature T', { min: 0.1, max: 5, step: 0.1, value: temperature, format: (v) => v.toFixed(1) }, (v) => {
    temperature = v
    host.invalidate()
  })
  tempField.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && host.select('temperature'))
  tempField.el.querySelector('.sim-label')?.addEventListener('click', () => host.select('temperature'))

  const rows = labels.map((label, i) => {
    const name = h('button', { type: 'button', class: 'sim-sm-name', title: label }, label)
    name.addEventListener('click', () => host.select(`logit:${i + 1}`))
    const fill = h('i', { class: 'sim-sm-fill' })
    const knob = h('i', { class: 'sim-sm-knob' })
    const input = h('input', { type: 'range', class: 'sim-sm-input', min: -LIMITS.logit, max: LIMITS.logit, step: 0.1, 'aria-label': `Logit for ${label}` })
    input.value = String(logits[i])
    input.addEventListener('input', () => {
      logits[i] = Number(input.value)
      host.invalidate()
    })
    input.addEventListener('keydown', (e) => e.key === 'Enter' && host.select(`logit:${i + 1}`))
    const track = h('span', { class: 'sim-sm-track' }, h('i', { class: 'sim-sm-zero' }), fill, knob, input)
    const z = h('span', { class: 'sim-sm-num' })
    const scaled = h('span', { class: 'sim-sm-num wide' })
    const exp = h('span', { class: 'sim-sm-num wide' })
    const pfill = h('i', { class: 'sim-sm-pfill' })
    const ptrack = h('span', { class: 'sim-sm-ptrack' }, pfill)
    ptrack.addEventListener('click', () => host.select('probabilities'))
    const pv = h('span', { class: 'sim-sm-num' })
    return { name, track, fill, knob, input, z, scaled, exp, ptrack, pfill, pv, cells: [name, track, z, scaled, exp, ptrack, pv] }
  })
  const head = ['', 'Logit z (drag)', 'z', 'z / T', 'exp(z / T)', 'Probability p', 'p'].map((t, i) => h('span', { class: `sim-sm-head${i === 3 || i === 4 ? ' wide' : ''}${i >= 2 && i !== 5 ? ' n' : ''}` }, t))
  const table = h('div', { class: 'sim-sm-grid' }, ...head, ...rows.flatMap((r) => r.cells))
  const stats = { entropy: stat('Entropy'), top: stat('Most likely'), sum: stat('Σ exp(z / T)') }
  const el = h(
    'div',
    { class: 'sim-sm' },
    h('div', { class: 'sim-params' }, tempField.el),
    table,
    h('div', { class: 'sim-sm-foot' }, h('div', { class: 'sim-stats' }, ...Object.values(stats).map((x) => x.el)), h('p', { class: 'sim-note' }, 'pᵢ = exp(zᵢ / T) ÷ Σⱼ exp(zⱼ / T). A low temperature sharpens the distribution; a high one flattens it.'))
  )

  return {
    el,
    step() {},
    reset() {
      logits.set(spec.logits)
      temperature = spec.temperature
      tempField.set(temperature)
      rows.forEach((r, i) => (r.input.value = String(logits[i])))
    },
    draw() {
      softmax(logits, temperature, p)
      let total = 0
      let best = 0
      for (let i = 0; i < n; i++) {
        const e = Math.exp(logits[i] / temperature)
        total += e
        if (p[i] > p[best]) best = i
        const r = rows[i]
        const half = (Math.abs(logits[i]) / LIMITS.logit) * 50
        r.fill.style.left = `${logits[i] < 0 ? 50 - half : 50}%`
        r.fill.style.width = `${half}%`
        r.fill.classList.toggle('neg', logits[i] < 0)
        r.knob.style.left = `${50 + (logits[i] / LIMITS.logit) * 50}%`
        r.z.textContent = num(logits[i], 1)
        r.scaled.textContent = num(logits[i] / temperature, 2)
        r.exp.textContent = num(e, e >= 1000 ? 0 : 2)
        r.pfill.style.width = `${(p[i] * 100).toFixed(2)}%`
        r.pv.textContent = p[i].toFixed(3)
      }
      stats.entropy.set(`${entropyBits(p).toFixed(2)} bits`)
      stats.top.set(`${labels[best]} ${(p[best] * 100).toFixed(0)}%`)
      stats.sum.set(num(total, total >= 1000 ? 0 : 2))
    },
    describe(part) {
      const parsed = parseSoftmaxPart(part, n)
      return parsed ? describeSoftmaxPart(parsed, { logits, labels, p: softmax(logits, temperature), temperature }) : null
    },
    highlight(part) {
      const parsed = part ? parseSoftmaxPart(part, n) : null
      rows.forEach((r, i) => {
        ring(r.track, parsed?.type === 'logit' && parsed.i === i + 1)
        ring(r.ptrack, parsed?.type === 'probabilities')
      })
      ring(tempField.el, parsed?.type === 'temperature')
    }
  }
}

export const softmaxKind: SimKindDef<SoftmaxSpec> = {
  label: 'Softmax',
  transport: false,
  autoplay: () => false,
  create
}
