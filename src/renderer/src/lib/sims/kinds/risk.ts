/**
 * Quant finance on Tide's synthetic prices (made by Tide, not real market data): Value at Risk
 * three ways on a histogram of daily returns, a European option priced by Monte Carlo converging
 * on Black-Scholes inside its ±2 standard-error band, and a moving-average crossover backtested
 * against buy and hold. Every number comes from shared/finance/quant.
 */
import { syntheticPrices } from '@shared/finance/marketData'
import { blackScholes, historicalVar, maxDrawdown, mean, normals, parametricVar, quantile, returns, smaCrossover, stdev, type RiskNumbers } from '@shared/finance/quant'
import { fitCanvas, h, rangeField, ring, segmented, selectField, stat } from '../dom'
import { TICKERS, type RiskMode, type RiskSpec, type VarMethod } from '../finance'
import type { PartInfo } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../specUtil'

let PRICES: Map<string, number[]> | null = null
/** The synthetic closes by ticker, made once */
function pricesOf(ticker: string): number[] {
  if (!PRICES) {
    PRICES = new Map()
    for (const p of syntheticPrices()) (PRICES.get(p.ticker) ?? PRICES.set(p.ticker, []).get(p.ticker)!).push(p.close)
  }
  return PRICES.get(ticker) ?? []
}

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`
const METHOD_LABEL: Record<VarMethod, string> = { historical: 'Historical', parametric: 'Parametric', 'monte-carlo': 'Monte Carlo' }
const MC_STEP = 2000
const MC_MAX = 400_000
const VAR_STEP = 500
const VAR_MAX = 50_000

function create(spec: RiskSpec, host: SimHost): SimView {
  let mode: RiskMode = spec.mode
  let method: VarMethod = spec.method
  let level = spec.level
  let ticker = spec.ticker
  const opt = { spot: spec.spot, strike: spec.strike, years: spec.years, rate: spec.rate, vol: spec.vol }
  let type = spec.type
  const bt = { fast: spec.fast, slow: spec.slow, cost: spec.cost }
  let cursor = 0

  // ---------- Monte Carlo VaR sample, grown step by step ----------
  let varZ = normals(spec.seed)
  let varSample: number[] = []
  // ---------- Monte Carlo option estimate ----------
  let optZ = normals(spec.seed)
  let n = 0
  let sum = 0
  let sum2 = 0
  let history: { n: number; price: number; se: number }[] = []

  const rets = () => returns(pricesOf(ticker))
  const muSigma = () => {
    const r = rets()
    return { mu: mean(r), sigma: stdev(r) }
  }
  const risk = (m: VarMethod): RiskNumbers => {
    const { mu, sigma } = muSigma()
    if (m === 'historical') return historicalVar(rets(), level)
    if (m === 'parametric') return parametricVar(mu, sigma, level)
    return varSample.length ? historicalVar(varSample, level) : { var: NaN, es: NaN }
  }
  const exact = () => blackScholes({ s: opt.spot, k: opt.strike, t: opt.years, r: opt.rate, sigma: opt.vol, type })
  const mcNow = () => {
    const disc = Math.exp(-opt.rate * opt.years)
    const m = n ? sum / n : NaN
    const v = n > 1 ? (sum2 - n * m * m) / (n - 1) : NaN
    return { price: disc * m, se: disc * Math.sqrt(Math.max(v, 0) / Math.max(n, 1)) }
  }
  const backtest = () => smaCrossover(pricesOf(ticker), bt.fast, bt.slow, bt.cost)

  function addPaths(k: number): void {
    const drift = (opt.rate - (opt.vol * opt.vol) / 2) * opt.years
    const vol = opt.vol * Math.sqrt(opt.years)
    const pay = (st: number) => (type === 'call' ? Math.max(st - opt.strike, 0) : Math.max(opt.strike - st, 0))
    for (let i = 0; i < k && n < MC_MAX; i++) {
      const e = optZ()
      let x = pay(opt.spot * Math.exp(drift + vol * e))
      if (antiOn) x = (x + pay(opt.spot * Math.exp(drift - vol * e))) / 2
      sum += x
      sum2 += x * x
      n++
    }
    history.push({ n, ...mcNow() })
  }
  function addVarDraws(k: number): void {
    const { mu, sigma } = muSigma()
    for (let i = 0; i < k && varSample.length < VAR_MAX; i++) varSample.push(mu + sigma * varZ())
  }
  function restartMc(): void {
    optZ = normals(spec.seed)
    n = sum = sum2 = 0
    history = []
  }
  function restartVar(): void {
    varZ = normals(spec.seed)
    varSample = []
  }
  let antiOn = spec.antithetic

  // ---------- Controls ----------
  const modeField = segmented('Lab', [['var', 'Value at Risk'], ['option', 'Option pricing'], ['backtest', 'Backtest']] as const, mode, (v) => {
    mode = v
    host.invalidate()
  })
  const tickerField = selectField('Prices (synthetic)', TICKERS.map((t) => [t, t] as const), ticker, (v) => {
    ticker = v
    restartVar()
    cursor = 0
    host.invalidate()
  })
  const methodField = segmented('Method', (['historical', 'parametric', 'monte-carlo'] as const).map((m) => [m, METHOD_LABEL[m]] as const), method, (v) => {
    method = v
    host.invalidate()
  })
  const levelField = selectField('Confidence', [['0.95', '95%'], ['0.975', '97.5%'], ['0.99', '99%']] as const, String(level) as '0.99', (v) => {
    level = Number(v)
    host.invalidate()
  })
  const optFields = [
    rangeField('Spot', { min: 50, max: 150, step: 1, value: opt.spot, format: (v) => v.toFixed(0) }, (v) => setOpt('spot', v)),
    rangeField('Strike', { min: 50, max: 150, step: 1, value: opt.strike, format: (v) => v.toFixed(0) }, (v) => setOpt('strike', v)),
    rangeField('Volatility', { min: 0.05, max: 0.8, step: 0.01, value: opt.vol, format: (v) => pct(v, 0) }, (v) => setOpt('vol', v)),
    rangeField('Years', { min: 0.1, max: 3, step: 0.1, value: opt.years, format: (v) => v.toFixed(1) }, (v) => setOpt('years', v))
  ]
  const typeField = segmented('Option', [['call', 'Call'], ['put', 'Put']] as const, type, (v) => {
    type = v
    restartMc()
    host.invalidate()
  })
  const antiField = segmented('Draws', [['plain', 'Plain'], ['anti', 'Antithetic']] as const, antiOn ? 'anti' : 'plain', (v) => {
    antiOn = v === 'anti'
    restartMc()
    host.invalidate()
  })
  function setOpt(k: keyof typeof opt, v: number): void {
    opt[k] = v
    restartMc()
    host.invalidate()
  }
  const btFields = [
    rangeField('Fast average', { min: 2, max: 100, step: 1, value: bt.fast, format: (v) => `${v} days` }, (v) => setBt('fast', v)),
    rangeField('Slow average', { min: 10, max: 250, step: 1, value: bt.slow, format: (v) => `${v} days` }, (v) => setBt('slow', v)),
    rangeField('Cost per trade', { min: 0, max: 0.01, step: 0.0005, value: bt.cost, format: (v) => pct(v, 2) }, (v) => setBt('cost', v))
  ]
  function setBt(k: keyof typeof bt, v: number): void {
    bt[k] = v
    if (bt.slow <= bt.fast) bt.slow = bt.fast + 1
    host.invalidate()
  }
  const varControls = h('div', { class: 'sim-params' }, tickerField.el, methodField.el, levelField.el)
  const optControls = h('div', { class: 'sim-params' }, typeField.el, antiField.el, ...optFields.map((f) => f.el))
  const btControls = h('div', { class: 'sim-params' }, ...btFields.map((f) => f.el))

  // ---------- Picture ----------
  const canvas = h('canvas', { class: 'sim-canvas sim-risk-canvas', tabindex: 0, role: 'button', 'aria-label': 'Chart' })
  canvas.addEventListener('click', () => host.select(mode === 'var' ? 'histogram' : mode === 'option' ? 'estimate' : 'equity'))
  const legend = h('div', { class: 'sim-legend' })
  const caption = h('span', { class: 'sim-cap' })
  const stats = [stat(''), stat(''), stat(''), stat(''), stat('')]
  const statParts = ['', '', '', '', '']
  stats.forEach((s, i) => {
    s.el.classList.add('sim-part')
    s.el.tabIndex = 0
    s.el.addEventListener('click', () => statParts[i] && host.select(statParts[i]))
  })
  const note = h('p', { class: 'sim-note', 'aria-live': 'polite' })
  const el = h('div', { class: 'sim-risk' }, h('div', { class: 'sim-params' }, modeField.el), varControls, optControls, btControls, h('div', { class: 'sim-plot' }, canvas, h('div', { class: 'sim-plot-foot' }, legend, caption)), h('div', { class: 'sim-stats' }, ...stats.map((s) => s.el)), note)

  const key = (cls: string, text: string) => h('span', { class: 'sim-key' }, h('i', { class: `sim-swatch ${cls}` }), text)
  const setStat = (i: number, label: string, value: string, part: string) => {
    stats[i].el.querySelector('.sim-stat-label')!.textContent = label
    stats[i].set(value)
    stats[i].el.hidden = !label
    statParts[i] = part
  }

  function drawVar(): void {
    const fit = fitCanvas(canvas)
    const r = rets()
    const nums = { historical: risk('historical'), parametric: risk('parametric'), 'monte-carlo': risk('monte-carlo') }
    if (fit) {
      const { ctx, w, h: ht } = fit
      const pal = host.palette()
      ctx.clearRect(0, 0, w, ht)
      // Wide enough for the worst days, no wider: the tail is the point
      const bound = Math.max(0.02, Math.abs(quantile(r, 0.0005)), Math.abs(quantile(r, 0.9995))) * 1.1
      const lo = -bound
      const hi = bound
      const bins = 60
      const counts = new Array(bins).fill(0)
      for (const v of r) counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++
      const top = Math.max(...counts, 1)
      const pad = { l: 8, r: 8, t: 10, b: 20 }
      const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (w - pad.l - pad.r)
      const bw = (w - pad.l - pad.r) / bins
      const cut = -nums[method].var
      counts.forEach((c, i) => {
        const left = lo + (i / bins) * (hi - lo)
        ctx.fillStyle = left + (hi - lo) / bins <= cut ? pal.css.neg : pal.css.line
        const hh = (c / top) * (ht - pad.t - pad.b)
        ctx.fillRect(pad.l + i * bw + 0.5, ht - pad.b - hh, bw - 1, hh)
      })
      ctx.font = `11px ${pal.font}`
      for (const m of ['historical', 'parametric', 'monte-carlo'] as VarMethod[]) {
        const v = nums[m].var
        if (!Number.isFinite(v)) continue
        ctx.beginPath()
        ctx.moveTo(x(-v), pad.t)
        ctx.lineTo(x(-v), ht - pad.b)
        ctx.strokeStyle = m === method ? pal.css.accent : pal.css.muted
        ctx.lineWidth = m === method ? 2 : 1
        ctx.setLineDash(m === method ? [] : [3, 3])
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.fillStyle = pal.css.muted
      for (const v of [-bound * 0.8, -bound * 0.4, 0, bound * 0.4, bound * 0.8]) ctx.fillText(pct(v, 1), x(v) - 14, ht - 5)
    }
    legend.replaceChildren(key('square neg', 'Days beyond the VaR'), key('line sim-risk-accent', `${METHOD_LABEL[method]} VaR`), key('line ink', 'The other two'))
    caption.textContent = `${r.length.toLocaleString('en-GB')} daily returns of ${ticker} (synthetic)`
    const s = nums[method]
    setStat(0, `${METHOD_LABEL[method]} VaR`, Number.isFinite(s.var) ? pct(s.var) : 'Step to draw', 'var')
    setStat(1, 'Expected shortfall', Number.isFinite(s.es) ? pct(s.es) : '–', 'es')
    setStat(2, 'On $1m', Number.isFinite(s.var) ? `$${Math.round(s.var * 1e6).toLocaleString('en-GB')}` : '–', 'var')
    setStat(3, 'Monte Carlo draws', varSample.length.toLocaleString('en-GB'), 'path')
    setStat(4, '', '', '')
    note.textContent =
      method === 'parametric'
        ? 'Parametric VaR assumes normal returns: with clustered volatility and fat tails it sits inside the historical one at 99%.'
        : method === 'monte-carlo'
          ? 'Monte Carlo draws normal returns with the sample’s mean and volatility: it converges on the parametric number, not the historical one. Step to add draws.'
          : `Historical VaR is the ${pct(1 - level, 1)} quantile of the returns themselves, fat tails and all.`
  }

  function drawOption(): void {
    if (!history.length) addPaths(MC_STEP)
    const fit = fitCanvas(canvas)
    const ex = exact().price
    if (fit) {
      const { ctx, w, h: ht } = fit
      const pal = host.palette()
      ctx.clearRect(0, 0, w, ht)
      const pad = { l: 44, r: 10, t: 10, b: 20 }
      const spread = Math.max(...history.map((p) => Math.abs(p.price - ex) + 2 * p.se), ex * 0.05, 0.01)
      const lo = ex - spread
      const hi = ex + spread
      const ln = (v: number) => Math.log10(v)
      const x0 = ln(MC_STEP)
      const x1 = ln(Math.max(MC_MAX, n))
      const x = (k: number) => pad.l + ((ln(k) - x0) / (x1 - x0)) * (w - pad.l - pad.r)
      const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (ht - pad.t - pad.b)
      ctx.beginPath()
      history.forEach((p, i) => (i ? ctx.lineTo(x(p.n), y(p.price + 2 * p.se)) : ctx.moveTo(x(p.n), y(p.price + 2 * p.se))))
      for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(x(history[i].n), y(history[i].price - 2 * history[i].se))
      ctx.closePath()
      ctx.fillStyle = `rgba(${pal.accent.join(',')}, 0.14)`
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(pad.l, y(ex))
      ctx.lineTo(w - pad.r, y(ex))
      ctx.strokeStyle = pal.css.ink
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      history.forEach((p, i) => (i ? ctx.lineTo(x(p.n), y(p.price)) : ctx.moveTo(x(p.n), y(p.price))))
      ctx.strokeStyle = pal.css.accent
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.font = `11px ${pal.font}`
      ctx.fillStyle = pal.css.muted
      for (const v of [lo, ex, hi]) ctx.fillText(v.toFixed(2), 4, y(v) + 4)
      for (const k of [1e4, 1e5]) if (k <= Math.max(MC_MAX, n)) ctx.fillText(k === 1e4 ? '10k paths' : '100k', x(k) - 14, ht - 5)
    }
    const mc = mcNow()
    legend.replaceChildren(key('line sim-risk-accent', 'Monte Carlo estimate'), key('square sim-risk-band', '±2 standard errors'), key('line ink', 'Black-Scholes'))
    caption.textContent = `${type === 'call' ? 'Call' : 'Put'}, spot ${opt.spot}, strike ${opt.strike}, ${opt.years} y, r ${pct(opt.rate, 1)}, σ ${pct(opt.vol, 0)}`
    setStat(0, 'Black-Scholes', ex.toFixed(4), 'exact')
    setStat(1, 'Monte Carlo', mc.price.toFixed(4), 'estimate')
    setStat(2, 'Standard error', mc.se.toFixed(4), 'band')
    setStat(3, 'Paths', n.toLocaleString('en-GB'), 'path')
    setStat(4, 'Delta', exact().delta.toFixed(3), 'exact')
    note.textContent = `Four times the paths halves the standard error (it falls as 1/√n).${antiOn ? ' Antithetic draws pair each path with its mirror image, cutting the error for the same work.' : ''} Step to add ${MC_STEP.toLocaleString('en-GB')} paths.`
  }

  function drawBacktest(): void {
    const b = backtest()
    const len = b.equity.length
    const upto = Math.max(bt.slow + 2, Math.min(len, cursor || len))
    const fit = fitCanvas(canvas)
    if (fit) {
      const { ctx, w, h: ht } = fit
      const pal = host.palette()
      ctx.clearRect(0, 0, w, ht)
      const pad = { l: 40, r: 10, t: 10, b: 20 }
      const vals = [...b.equity, ...b.hold]
      const lo = Math.min(...vals)
      const hi = Math.max(...vals)
      const x = (i: number) => pad.l + (i / (len - 1)) * (w - pad.l - pad.r)
      const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (ht - pad.t - pad.b)
      // Days in the market, shaded
      ctx.fillStyle = `rgba(${pal.accent.join(',')}, 0.07)`
      for (let i = 1; i < upto; i++) if (b.position[i]) ctx.fillRect(x(i - 1), pad.t, x(i) - x(i - 1) + 0.5, ht - pad.t - pad.b)
      const line = (s: number[], colour: string, dash: number[], width: number) => {
        ctx.beginPath()
        for (let i = 0; i < upto; i++) (i ? ctx.lineTo(x(i), y(s[i])) : ctx.moveTo(x(i), y(s[i])))
        ctx.strokeStyle = colour
        ctx.setLineDash(dash)
        ctx.lineWidth = width
        ctx.stroke()
        ctx.setLineDash([])
      }
      line(b.hold, pal.css.soft, [4, 3], 1.25)
      line(b.equity, pal.css.accent, [], 2)
      ctx.font = `11px ${pal.font}`
      ctx.fillStyle = pal.css.muted
      for (const v of [lo, 1, hi]) ctx.fillText(v.toFixed(2), 4, y(v) + 4)
    }
    const part = smaCrossover(pricesOf(ticker).slice(0, upto), bt.fast, bt.slow, bt.cost)
    legend.replaceChildren(key('line sim-risk-accent', `${bt.fast}/${bt.slow} crossover`), key('line ink', 'Buy and hold'), key('square sim-risk-band', 'In the market'))
    caption.textContent = `${ticker} (synthetic), day ${upto} of ${len}`
    setStat(0, 'Strategy', pct(part.totalReturn, 1), 'equity')
    setStat(1, 'Buy and hold', pct(part.holdReturn, 1), 'hold')
    setStat(2, 'Sharpe', part.sharpe.toFixed(2), 'equity')
    setStat(3, 'Max drawdown', pct(part.maxDrawdown, 1), 'drawdown')
    setStat(4, 'Trades', String(part.trades), 'equity')
    note.textContent = 'Each day’s position is decided at the close before it, so the rule never sees the return it earns. Try a fast average of 5: more trades, and the cost eats the edge.'
  }

  function describe(part: string): PartInfo | null {
    const nums = risk(method)
    const r = rets()
    switch (part) {
      case 'histogram':
        return { label: `daily returns of ${ticker} (synthetic)`, values: { days: r.length, mean: pct(mean(r), 3), 'daily volatility': pct(stdev(r)), worst: pct(Math.min(...r)) } }
      case 'var':
        return { label: `${METHOD_LABEL[method]} VaR at ${pct(level, 1)}`, values: { 'one day': pct(nums.var), 'on $1m': Number.isFinite(nums.var) ? `$${Math.round(nums.var * 1e6)}` : '–', '10 days by √10': pct(nums.var * Math.sqrt(10)) } }
      case 'es':
        return { label: 'expected shortfall', values: { es: pct(nums.es), var: pct(nums.var), 'es ÷ var': (nums.es / nums.var).toFixed(2) } }
      case 'method': {
        const all = (['historical', 'parametric', 'monte-carlo'] as VarMethod[]).map((m) => [METHOD_LABEL[m], pct(risk(m).var)] as const)
        return { label: 'the three methods', values: Object.fromEntries(all) }
      }
      case 'path':
        return { label: 'Monte Carlo draws', values: { 'option paths': n, 'VaR draws': varSample.length } }
      case 'estimate': {
        const mc = mcNow()
        return { label: 'the Monte Carlo price', values: { price: Number.isFinite(mc.price) ? mc.price.toFixed(4) : 'none yet', se: Number.isFinite(mc.se) ? mc.se.toFixed(4) : '–', paths: n } }
      }
      case 'exact': {
        const e = exact()
        return { label: 'the Black-Scholes price', values: { price: e.price.toFixed(4), delta: e.delta.toFixed(3), gamma: e.gamma.toFixed(4), vega: e.vega.toFixed(3) } }
      }
      case 'band': {
        const mc = mcNow()
        return { label: '±2 standard errors', values: { low: (mc.price - 2 * mc.se).toFixed(4), high: (mc.price + 2 * mc.se).toFixed(4), 'contains Black-Scholes': Math.abs(mc.price - exact().price) <= 2 * mc.se ? 'yes' : 'no' } }
      }
      case 'equity': {
        const b = backtest()
        return { label: `the ${bt.fast}/${bt.slow} crossover`, values: { return: pct(b.totalReturn, 1), sharpe: b.sharpe.toFixed(2), trades: b.trades, 'max drawdown': pct(b.maxDrawdown, 1) } }
      }
      case 'hold': {
        const b = backtest()
        return { label: 'buy and hold', values: { return: pct(b.holdReturn, 1), 'max drawdown': pct(maxDrawdown(b.hold), 1) } }
      }
      case 'drawdown': {
        const b = backtest()
        return { label: 'maximum drawdown', values: { strategy: pct(b.maxDrawdown, 1), 'buy and hold': pct(maxDrawdown(b.hold), 1) } }
      }
    }
    return null
  }

  return {
    el,
    stepsPerSecond: () => 6,
    step() {
      if (mode === 'option') addPaths(MC_STEP)
      else if (mode === 'var') addVarDraws(VAR_STEP)
      else cursor = Math.min(pricesOf(ticker).length, (cursor || bt.slow + 2) + 20)
    },
    done: () => (mode === 'option' && n >= MC_MAX ? `${MC_MAX.toLocaleString('en-GB')} paths` : mode === 'var' && varSample.length >= VAR_MAX ? `${VAR_MAX.toLocaleString('en-GB')} draws` : mode === 'backtest' && cursor >= pricesOf(ticker).length ? 'The end of the data' : null),
    reset() {
      restartMc()
      restartVar()
      cursor = 0
    },
    draw() {
      modeField.set(mode)
      methodField.set(method)
      varControls.hidden = mode !== 'var'
      optControls.hidden = mode !== 'option'
      btControls.hidden = mode !== 'backtest'
      if (mode === 'var' && method === 'monte-carlo' && !varSample.length) addVarDraws(VAR_STEP)
      if (mode === 'var') drawVar()
      else if (mode === 'option') drawOption()
      else drawBacktest()
    },
    describe,
    highlight(part) {
      ring(canvas, part === 'histogram' || part === 'estimate' || part === 'band' || part === 'equity' || part === 'hold')
      stats.forEach((s, i) => ring(s.el, !!part && statParts[i] === part))
      ring(methodField.el, part === 'method')
    },
    act(a: TourAction) {
      if (typeof a.mode === 'string' && ['var', 'option', 'backtest'].includes(a.mode)) mode = a.mode as RiskMode
      if (typeof a.method === 'string' && ['historical', 'parametric', 'monte-carlo'].includes(a.method)) method = a.method as VarMethod
      if (typeof a.level === 'number' && a.level > 0.5 && a.level < 1) {
        level = a.level
        levelField.set(String(level) as '0.99')
      }
      if (typeof a.paths === 'number') addPaths(Math.min(MC_MAX, Math.max(0, a.paths)))
      if (a.set && typeof a.set === 'object' && !Array.isArray(a.set)) {
        for (const [k, v] of Object.entries(a.set)) {
          if (k in opt) opt[k as keyof typeof opt] = v
          if (k in bt) bt[k as keyof typeof bt] = v
        }
        restartMc()
      }
    },
    relayout: () => host.invalidate()
  }
}

export const riskKind: SimKindDef<RiskSpec> = {
  label: 'Risk and pricing',
  transport: true,
  autoplay: () => false,
  create
}
