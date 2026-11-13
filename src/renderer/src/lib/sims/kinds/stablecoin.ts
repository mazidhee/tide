/**
 * A stablecoin day by day: its market price and its backing per coin over time, the reserves
 * behind it, and what was redeemed. Pick a scenario (calm, a reserve bank failing, a run with fire
 * sales, an algorithmic coin's spiral), change how panicky holders are or how much the issuer can
 * pay out in a day, and mint or redeem yourself. The model is shared/finance/stablecoin.
 */
import { DEFAULT_PARAMS, depegStats, startDay, stepDay, type Day, type Scenario, type StablecoinParams } from '@shared/finance/stablecoin'
import { button, fitCanvas, h, rangeField, ring, selectField, stat } from '../dom'
import { SCENARIOS, type StablecoinSpec } from '../finance'
import type { PartInfo } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../specUtil'

const LABEL: Record<Scenario, string> = { calm: 'Calm', 'bank-failure': 'A reserve bank fails', run: 'A run with fire sales', algorithmic: 'Algorithmic coin' }
const m = (v: number) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(1)}m`
const usd = (v: number) => `$${v.toFixed(3)}`
const coins = (v: number) => `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}m`

function create(spec: StablecoinSpec, host: SimHost): SimView {
  let scenario: Scenario = spec.scenario
  const tuned = { panic: spec.panic, capacity: spec.capacity, cashShare: spec.cashShare, fee: spec.fee }
  const params = (): StablecoinParams => ({ ...DEFAULT_PARAMS[scenario], ...tuned, days: spec.days, scenario })
  let days: Day[] = [startDay(params())]
  let message = ''
  const now = () => days[days.length - 1]

  const restart = () => {
    days = [startDay(params())]
    message = ''
  }

  // ---------- Controls ----------
  const scenarioField = selectField('Scenario', SCENARIOS.map((s) => [s, LABEL[s]] as const), scenario, (v) => {
    scenario = v
    const d = DEFAULT_PARAMS[v]
    Object.assign(tuned, { panic: d.panic, capacity: d.capacity, cashShare: d.cashShare, fee: d.fee })
    panicField.set(tuned.panic)
    capField.set(tuned.capacity)
    restart()
    host.invalidate()
  })
  const panicField = rangeField('Holders’ panic', { min: 0, max: 3, step: 0.1, value: tuned.panic, format: (v) => v.toFixed(1) }, (v) => {
    tuned.panic = v
    restart()
    host.invalidate()
  })
  const capField = rangeField('Redeemable a day', { min: 0.02, max: 0.5, step: 0.01, value: tuned.capacity, format: (v) => `${Math.round(v * 100)}% of supply` }, (v) => {
    tuned.capacity = v
    restart()
    host.invalidate()
  })
  const mintBtn = button('Mint $50m', () => {
    act({ mint: 50 })
    host.invalidate()
  })
  const redeemBtn = button('Redeem 50m', () => {
    act({ redeem: 50 })
    host.invalidate()
  })
  const controls = h('div', { class: 'sim-params' }, scenarioField.el, panicField.el, capField.el, mintBtn, redeemBtn)

  // ---------- Picture ----------
  const canvas = h('canvas', { class: 'sim-canvas sim-sc-canvas', tabindex: 0, role: 'button', 'aria-label': 'Price and backing per coin, day by day' })
  canvas.addEventListener('click', () => host.select('price'))
  const legend = h('div', { class: 'sim-legend' }, h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line sim-sc-accent' }), 'Market price'), h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line ink' }), 'Backing per coin'), h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch square sim-sc-red' }), 'Redemptions shut'))
  const plot = h('div', { class: 'sim-plot' }, canvas, h('div', { class: 'sim-plot-foot' }, legend))
  const bars = h('button', { type: 'button', class: 'sim-part sim-panel sim-sc-sheet' })
  bars.addEventListener('click', () => host.select('reserves'))
  const stats = { price: stat('Price'), backing: stat('Backing'), supply: stat('Coins'), redeemed: stat('Redeemed today'), low: stat('Lowest so far') }
  const statEls: Record<string, HTMLElement> = { price: stats.price.el, backing: stats.backing.el, supply: stats.supply.el, redemptions: stats.redeemed.el }
  for (const [k, e] of Object.entries(statEls)) {
    e.classList.add('sim-part')
    e.tabIndex = 0
    e.addEventListener('click', () => host.select(k))
  }
  const note = h('p', { class: 'sim-note', 'aria-live': 'polite' })
  const el = h('div', { class: 'sim-sc' }, controls, h('div', { class: 'sim-two' }, plot, h('div', { class: 'sim-stack' }, bars, h('div', { class: 'sim-stats' }, ...Object.values(statEls), stats.low.el))), note)

  function drawChart(): void {
    const fit = fitCanvas(canvas)
    if (!fit) return
    const { ctx, w, h: ht } = fit
    const pal = host.palette()
    ctx.clearRect(0, 0, w, ht)
    const pad = { l: 40, r: 10, t: 10, b: 22 }
    const n = Math.max(spec.days, days.length - 1)
    const x = (d: number) => pad.l + (d / Math.max(1, n)) * (w - pad.l - pad.r)
    const lo = Math.min(0.8, ...days.map((d) => Math.min(d.price, d.backing)))
    const y = (v: number) => pad.t + (1 - (Math.min(1.02, v) - lo) / (1.02 - lo)) * (ht - pad.t - pad.b)
    ctx.font = `11px ${pal.font}`
    ctx.fillStyle = pal.css.muted
    ctx.strokeStyle = pal.css.line
    ctx.lineWidth = 1
    // Days with redemptions shut
    for (const d of days)
      if (!d.open) {
        ctx.fillStyle = `rgba(${pal.neg.join(',')}, 0.12)`
        ctx.fillRect(x(d.day - 0.5), pad.t, x(1) - x(0), ht - pad.t - pad.b)
      }
    for (const v of [lo, (lo + 1) / 2, 1]) {
      ctx.beginPath()
      ctx.moveTo(pad.l, y(v))
      ctx.lineTo(w - pad.r, y(v))
      ctx.strokeStyle = v === 1 ? pal.css.lineStrong : pal.css.line
      ctx.stroke()
      ctx.fillStyle = pal.css.muted
      ctx.fillText(`$${v.toFixed(2)}`, 4, y(v) + 4)
    }
    ctx.fillText('day', w - pad.r - 22, ht - 6)
    const line = (key: 'price' | 'backing', colour: string, dash: number[]) => {
      ctx.beginPath()
      days.forEach((d, i) => (i ? ctx.lineTo(x(d.day), y(d[key])) : ctx.moveTo(x(d.day), y(d[key]))))
      ctx.strokeStyle = colour
      ctx.setLineDash(dash)
      ctx.lineWidth = key === 'price' ? 2 : 1.5
      ctx.stroke()
      ctx.setLineDash([])
    }
    line('backing', pal.css.soft, [4, 3])
    line('price', pal.css.accent, [])
    const last = now()
    ctx.beginPath()
    ctx.arc(x(last.day), y(last.price), 3.5, 0, Math.PI * 2)
    ctx.fillStyle = pal.css.accent
    ctx.fill()
  }

  function drawSheet(): void {
    const d = now()
    const algo = scenario === 'algorithmic'
    const assets = algo ? (d.tokenPrice ?? 0) * (d.tokenSupply ?? 0) : d.cash + d.bills + d.frozen
    const top = Math.max(d.supply, assets, 1)
    const bar = (label: string, v: number, cls: string, show: (v: number) => string = m) => h('div', { class: 'sim-sc-bar' }, h('span', { class: 'sim-sc-bar-label' }, label), h('span', { class: 'sim-sc-track' }, h('i', { class: `sim-sc-fill ${cls}`, style: `width:${Math.max(0, (v / top) * 100).toFixed(1)}%` })), h('span', { class: 'sim-sc-bar-value' }, show(v)))
    bars.replaceChildren(
      h('div', { class: 'sim-panel-title' }, h('span', null, 'Reserves against coins'), h('span', null, `day ${d.day}`)),
      ...(algo
        ? [bar('Governance token’s market value', assets, 'accent'), bar('Coins outstanding', d.supply, 'ink', coins)]
        : [bar('Bank deposits', d.cash, 'accent'), bar('Treasury bills', d.bills, 'accent soft'), ...(d.frozen ? [bar('Frozen at the failed bank', d.frozen, 'bad')] : []), bar('Coins outstanding', d.supply, 'ink', coins)])
    )
  }

  function act(a: TourAction): void {
    if (typeof a.scenario === 'string' && (SCENARIOS as string[]).includes(a.scenario)) {
      scenario = a.scenario as Scenario
      scenarioField.set(scenario)
      restart()
    }
    if (a.set && typeof a.set === 'object' && !Array.isArray(a.set)) {
      for (const [k, v] of Object.entries(a.set)) if (k in tuned && typeof v === 'number') (tuned as Record<string, number>)[k] = v
      panicField.set(tuned.panic)
      capField.set(tuned.capacity)
      restart()
    }
    const d = { ...now() }
    if (typeof a.mint === 'number' && a.mint > 0) {
      if (scenario === 'algorithmic') message = 'An algorithmic coin is minted by burning the governance token, not by paying in dollars: nothing new backs it.'
      d.supply += a.mint * (1 - tuned.fee)
      if (scenario !== 'algorithmic') d.cash += a.mint
      d.backing = scenario === 'algorithmic' ? Math.min(1, ((d.tokenPrice ?? 0) * (d.tokenSupply ?? 0)) / d.supply) : (d.cash + d.bills + d.frozen * 0.5) / d.supply
      if (scenario !== 'algorithmic') message = `Minted ${(a.mint * (1 - tuned.fee)).toFixed(1)}m coins for $${a.mint}m: supply and reserves grow together.`
      days[days.length - 1] = d
    }
    if (typeof a.redeem === 'number' && a.redeem > 0) {
      if (!d.open) message = 'Redemptions are shut today: the issuer can’t pay out.'
      else if (scenario === 'algorithmic') message = 'Redeeming pays out in newly minted governance tokens: press Step to see what that does to their price.'
      else {
        const coins = Math.min(a.redeem, d.supply)
        const pay = coins * (1 - tuned.fee)
        const fromCash = Math.min(d.cash, pay)
        d.cash -= fromCash
        const rest = pay - fromCash
        if (rest > 0) d.bills -= Math.min(d.bills, rest / (1 - DEFAULT_PARAMS[scenario].fireSale))
        d.supply -= coins
        d.backing = d.supply > 0 ? (d.cash + d.bills + d.frozen * 0.5) / d.supply : 1
        message = rest > 0 ? `Redeemed ${coins}m: the cash ran out, so bills were sold at a discount, and the backing per coin fell.` : `Redeemed ${coins}m from cash: coins and reserves shrink together, the backing holds.`
        days[days.length - 1] = d
      }
    }
  }

  function describe(part: string): PartInfo | null {
    const d = now()
    const [head, arg] = part.split(':')
    if (part === 'price') return { label: 'the market price', values: { price: usd(d.price), 'arbitrage per coin': usd(1 - tuned.fee - d.price), 'redemptions open': d.open ? 'yes' : 'no' } }
    if (part === 'backing') return { label: 'reserves per coin', values: { backing: usd(d.backing), reserves: m(d.cash + d.bills + d.frozen), coins: coins(d.supply) } }
    if (part === 'reserves') return { label: 'the reserves', values: { 'bank deposits': m(d.cash), 'Treasury bills': m(d.bills), frozen: m(d.frozen) } }
    if (part === 'supply') return { label: 'coins outstanding', values: { coins: coins(d.supply), 'redeemed so far': coins(days.reduce((s, x) => s + x.redeemed, 0)) } }
    if (part === 'redemptions') return { label: 'redemptions', values: { today: m(d.redeemed), 'holders selling': m(d.selling), 'issuer can pay a day': m(d.supply * tuned.capacity) } }
    if (head === 'day' && arg) {
      const x = days[Number(arg)]
      return x ? { label: `day ${x.day}`, values: { price: usd(x.price), backing: usd(x.backing), redeemed: m(x.redeemed), note: x.note } } : null
    }
    if (part === 'token') return scenario === 'algorithmic' ? { label: 'the governance token', values: { price: `$${(d.tokenPrice ?? 0).toPrecision(3)}`, supply: `${(d.tokenSupply ?? 0).toPrecision(4)}m`, 'market value': m((d.tokenPrice ?? 0) * (d.tokenSupply ?? 0)) } } : { label: 'the governance token', values: { note: 'Only the algorithmic scenario has one: this coin is backed by dollars and bills' } }
    return null
  }

  return {
    el,
    stepsPerSecond: () => 2,
    step() {
      if (days.length - 1 >= spec.days) return
      days.push(stepDay(params(), now()))
      message = ''
    },
    done: () => (days.length - 1 >= spec.days ? `Day ${spec.days}: ${depegLine(days)}` : null),
    reset: restart,
    draw() {
      drawChart()
      drawSheet()
      const d = now()
      const s = depegStats(days)
      stats.price.set(usd(d.price))
      stats.backing.set(usd(d.backing))
      stats.supply.set(coins(d.supply))
      stats.redeemed.set(m(d.redeemed))
      stats.low.set(`${usd(s.low)} (day ${s.lowDay})`)
      note.textContent = message || d.note
    },
    describe,
    highlight(part) {
      ring(canvas, part === 'price' || part === 'backing' || !!part?.startsWith('day:'))
      ring(bars, part === 'reserves' || part === 'token')
      for (const [k, e] of Object.entries(statEls)) ring(e, part === k)
    },
    act,
    relayout: () => host.invalidate()
  }
}

const depegLine = (days: Day[]) => {
  const s = depegStats(days)
  return s.low >= 0.995 ? 'the peg held' : `the low was $${s.low.toFixed(3)} on day ${s.lowDay}${s.recovered ? `, back by day ${s.recovered}` : ', not recovered'}`
}

export const stablecoinKind: SimKindDef<StablecoinSpec> = {
  label: 'Stablecoin',
  transport: true,
  autoplay: () => false,
  create
}
