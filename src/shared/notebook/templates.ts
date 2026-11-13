/**
 * The quant lab: guided notebooks for the learner's focus areas, built on Tide's finance labs
 * (tide_finance) and its bundled market data (US Treasury par yields and ECB rates, public data;
 * synthetic prices made by Tide). Each opens as an ordinary .ipynb in the vault: reading in
 * Markdown, code to run, and checked exercises whose hidden tests live here, not in the file.
 * Every template is run top to bottom, with each exercise's solution, by test/notebookTemplates.
 */
import { codeCell, markdownCell, newNotebook, type Cell, type Notebook } from './ipynb'

export interface ExerciseTest {
  name: string
  /** Python run in a copy of the notebook's namespace; an AssertionError's message is shown */
  code: string
}

export interface ExerciseSpec {
  id: string
  title: string
  /** Markdown */
  prompt: string
  starter: string
  /** Not shown; used to check the tests pass on a right answer */
  solution: string
  tests: ExerciseTest[]
  hint?: string
}

export type TemplateCell = { md: string } | { code: string } | { exercise: ExerciseSpec }

export interface QuantTemplate {
  id: string
  title: string
  summary: string
  /** Import names the template needs beyond NumPy, pandas and Matplotlib */
  needs: string[]
  cells: TemplateCell[]
}

/** Metadata Tide keeps on a notebook cell (cell.metadata.tide) */
export interface TideCellMeta {
  exercise?: { id: string; title: string; passed?: boolean; hint?: string }
  /** The notebook's template */
  template?: string
}

const SETUP = `import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tide_finance as tf
import tide_nb as tn`

export const QUANT_TEMPLATES: QuantTemplate[] = [
  {
    id: 'yield-curve',
    title: 'Yield curve bootstrapping',
    summary: 'From the US Treasury par curve to zero rates and discount factors, then scrub through six years of curves.',
    needs: [],
    cells: [
      { md: `# Yield curve bootstrapping

The US Treasury publishes **par yields**: the coupon at which a bond of each maturity would price at exactly 100. Pricing anything else needs **zero rates** (or discount factors): what one dollar at time $t$ is worth today,

$$P(0,t) = e^{-z(t)\\,t}.$$

Bootstrapping turns par yields into discount factors one maturity at a time. The data is Tide's bundled copy of the Treasury's daily par curve, 2020 to 2025 (public domain).` },
      { code: `${SETUP}

curves = tf.treasury_yields()
curves.tail()` },
      { md: `## Six years of curves

Drag the slider through the dates: watch the curve flatten and then invert in 2022 as the Fed raised rates.` },
      { code: `tn.yield_curve(curves, title="US Treasury par curve")` },
      { md: `## One bootstrap step

For a par bond paying a semi-annual coupon $c$ (as a fraction) that matures at payment $n$, its price is 100:

$$1 = \\frac{c}{2}\\sum_{i=1}^{n} P_i + P_n \\quad\\Rightarrow\\quad P_n = \\frac{1 - \\frac{c}{2}\\sum_{i<n} P_i}{1 + \\frac{c}{2}}.$$

Knowing the earlier discount factors, each new par yield gives the next one.` },
      {
        exercise: {
          id: 'tpl:yield-curve:next-df',
          title: 'The next discount factor',
          prompt: 'Write `next_df(c, earlier)`: the discount factor at the next coupon date of a par bond with annual coupon rate `c` (a fraction, paid twice a year), given the list `earlier` of discount factors at the previous coupon dates.',
          starter: `def next_df(c, earlier):
    # your code here
    ...`,
          solution: `def next_df(c, earlier):
    return (1 - c / 2 * sum(earlier)) / (1 + c / 2)`,
          hint: 'Solve the par condition for the last discount factor: the coupons on the earlier dates are worth c/2 times their discount factors.',
          tests: [
            { name: 'a one-period bond', code: 'assert abs(next_df(0.04, []) - 1 / 1.02) < 1e-12, "With no earlier dates, P = 1 / (1 + c/2)"' },
            { name: 'prices the par bond at 100', code: `dfs = []
for _ in range(10):
    dfs.append(next_df(0.05, dfs))
price = 0.05 / 2 * sum(dfs) + dfs[-1]
assert abs(price - 1) < 1e-12, f"A par bond should price at 1, got {price:.6f}"` },
            { name: 'a flat par curve gives a flat zero curve', code: `dfs = []
for _ in range(6):
    dfs.append(next_df(0.06, dfs))
z = [-2 * np.log(d) / (i + 1) for i, d in enumerate(dfs)]
assert max(z) - min(z) < 1e-9, "With every par yield equal, the semi-annual zero rates should all match it"` }
          ]
        }
      },
      { md: `## The whole curve

Interpolate the par yields onto every half year out to 30 years, then bootstrap. Below a year the Treasury's bills pay no coupon, so their discount factor comes straight from the yield.` },
      { code: `def bootstrap(par_row):
    tenors = np.array([1/12, 3/12, 6/12, 1, 2, 5, 10, 30])
    par = par_row.to_numpy(dtype=float) / 100
    ok = np.isfinite(par)
    grid = np.arange(0.5, 30.01, 0.5)
    c = np.interp(grid, tenors[ok], par[ok])
    dfs = []
    for i, t in enumerate(grid):
        dfs.append(1 / (1 + c[i] * t) if t <= 0.5 else next_df(c[i], dfs))
    dfs = np.array(dfs)
    zero = -np.log(dfs) / grid
    return pd.DataFrame({"tenor": grid, "par": c, "discount": dfs, "zero": zero})

day = curves.index[-1]
boot = bootstrap(curves.loc[day])
boot.iloc[[0, 1, 3, 9, 19, 59]]` },
      { code: `fig, ax = plt.subplots()
ax.plot(boot.tenor, boot.par * 100, label="par yield")
ax.plot(boot.tenor, boot.zero * 100, label="zero rate (continuous)")
ax.set_xlabel("years")
ax.set_ylabel("percent")
ax.set_title(f"Treasury curve on {day:%d %b %Y}")
ax.legend()
plt.show()` },
      { md: `**To think about:** when the par curve slopes up, zero rates sit above par yields at the long end. Why? (A par bond's early coupons are discounted at the lower short rates.)` }
    ]
  },
  {
    id: 'options-quantlib',
    title: 'Options pricing and Greeks with QuantLib',
    summary: 'Black–Scholes by hand against QuantLib, the Greeks with sliders, and an American put on a binomial tree.',
    needs: ['QuantLib'],
    cells: [
      { md: `# Options pricing and Greeks

Under Black–Scholes a European call on a non-dividend stock is worth

$$C = S\\,N(d_1) - K e^{-rT} N(d_2),\\qquad d_{1,2} = \\frac{\\ln(S/K) + (r \\pm \\tfrac{1}{2}\\sigma^2)T}{\\sigma\\sqrt{T}}.$$

Tide's \`tide_finance.black_scholes\` is that formula in a few lines. QuantLib is the open-source library banks use (BSD licence); here they should agree to many decimal places.` },
      { code: `${SETUP}
import QuantLib as ql

spot, strike, r, sigma, T = 100.0, 105.0, 0.03, 0.20, 1.0
mine = tf.black_scholes(spot, strike, T, r, sigma, "call")
mine` },
      { code: `today = ql.Date(13, 11, 2026)
ql.Settings.instance().evaluationDate = today
dc = ql.Actual365Fixed()
maturity = today + 365  # one year on Actual/365

u = ql.SimpleQuote(spot)
process = ql.BlackScholesProcess(
    ql.QuoteHandle(u),
    ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc)),
    ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), sigma, dc)),
)
call = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call, strike), ql.EuropeanExercise(maturity))
call.setPricingEngine(ql.AnalyticEuropeanEngine(process))

pd.DataFrame({
    "tide_finance": [mine["price"], mine["delta"], mine["gamma"], mine["vega"]],
    "QuantLib": [call.NPV(), call.delta(), call.gamma(), call.vega()],
}, index=["price", "delta", "gamma", "vega"])` },
      { md: `## Move the inputs

Drag spot, volatility, time and rate. The dashed line is the payoff at expiry; the solid one is the option's value today. Pick a Greek to see it across spot.` },
      { code: `tn.option(spot=spot, strike=strike, t=T, r=r, sigma=sigma, kind="call")` },
      {
        exercise: {
          id: 'tpl:options:parity',
          title: 'Put–call parity',
          prompt: 'Price the put with the same inputs using `tf.black_scholes(..., "put")`, store it in `put_price`, and write `parity_gap(c, p, s, k, r, t)` returning $C - P - (S - Ke^{-rT})$, which should be zero.',
          starter: `put_price = ...

def parity_gap(c, p, s, k, r, t):
    ...`,
          solution: `put_price = tf.black_scholes(spot, strike, T, r, sigma, "put")["price"]

def parity_gap(c, p, s, k, r, t):
    return c - p - (s - k * np.exp(-r * t))`,
          hint: 'A call minus a put with the same strike is a forward: worth the spot minus the discounted strike.',
          tests: [
            { name: 'the put price', code: 'assert abs(put_price - 9.0248) < 1e-3, f"put_price should be about 9.02, got {put_price}"' },
            { name: 'parity holds', code: 'assert abs(parity_gap(mine["price"], put_price, spot, strike, r, T)) < 1e-10' },
            { name: 'parity_gap is a formula, not a constant', code: 'assert abs(parity_gap(10, 5, 100, 100, 0.0, 1.0) - 5) < 1e-12' }
          ]
        }
      },
      { md: `## Early exercise

An American put can be exercised any time, so it is worth at least as much as the European one. QuantLib prices it on a binomial tree.` },
      { code: `put_eu = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Put, strike), ql.EuropeanExercise(maturity))
put_eu.setPricingEngine(ql.AnalyticEuropeanEngine(process))
put_am = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Put, strike), ql.AmericanExercise(today, maturity))
put_am.setPricingEngine(ql.BinomialVanillaEngine(process, "crr", 800))
print(f"European put {put_eu.NPV():.4f}, American put {put_am.NPV():.4f}, early-exercise premium {put_am.NPV() - put_eu.NPV():.4f}")` }
    ]
  },
  {
    id: 'monte-carlo',
    title: 'Monte Carlo pricing',
    summary: 'Price by simulation, watch the error shrink like 1/√n, cut it with antithetic variates, then price an Asian option.',
    needs: [],
    cells: [
      { md: `# Monte Carlo pricing

Under the risk-neutral measure the stock at expiry is

$$S_T = S_0 \\exp\\big((r - \\tfrac12\\sigma^2)T + \\sigma\\sqrt{T}\\,Z\\big),\\quad Z\\sim N(0,1),$$

and an option's price is the discounted average payoff. The error of an average of $n$ draws falls like $\\sigma/\\sqrt n$.` },
      { code: `${SETUP}

s0, k, r, sigma, T = 100.0, 100.0, 0.03, 0.25, 1.0
exact = tf.black_scholes(s0, k, T, r, sigma, "call")["price"]
exact` },
      {
        exercise: {
          id: 'tpl:mc:call',
          title: 'A Monte Carlo call',
          prompt: 'Write `mc_call(s0, k, r, sigma, T, n, seed)` that draws `n` standard normals with `np.random.default_rng(seed)`, simulates $S_T$, and returns `(price, standard_error)` of a European call.',
          starter: `def mc_call(s0, k, r, sigma, T, n, seed=1):
    rng = np.random.default_rng(seed)
    ...`,
          solution: `def mc_call(s0, k, r, sigma, T, n, seed=1):
    rng = np.random.default_rng(seed)
    z = rng.standard_normal(n)
    st = s0 * np.exp((r - sigma**2 / 2) * T + sigma * np.sqrt(T) * z)
    pay = np.exp(-r * T) * np.maximum(st - k, 0)
    return pay.mean(), pay.std(ddof=1) / np.sqrt(n)`,
          hint: 'Simulate S_T for every z at once with NumPy, take the payoff max(S_T − K, 0), discount it, then the mean and the standard deviation over √n.',
          tests: [
            { name: 'returns a price and an error', code: 'p, se = mc_call(100, 100, 0.03, 0.25, 1.0, 1000, 1)\nassert se > 0 and p > 0' },
            { name: 'close to Black–Scholes', code: 'p, se = mc_call(s0, k, r, sigma, T, 200_000, 7)\nassert abs(p - exact) < 4 * se, f"{p:.4f} is more than 4 standard errors from {exact:.4f}"' },
            { name: 'the error shrinks like 1/sqrt(n)', code: 'a = mc_call(s0, k, r, sigma, T, 10_000, 3)[1]\nb = mc_call(s0, k, r, sigma, T, 160_000, 3)[1]\nassert 3 < a / b < 5, f"16 times the paths should cut the error about 4 times, got {a/b:.2f}"' }
          ]
        }
      },
      { code: `ns = [500, 2_000, 8_000, 32_000, 128_000]
rows = [(n, *mc_call(s0, k, r, sigma, T, n, 11)) for n in ns]
conv = pd.DataFrame(rows, columns=["paths", "price", "std_error"])
fig, ax = plt.subplots()
ax.errorbar(conv.paths, conv.price, yerr=2 * conv.std_error, fmt="o-", capsize=3, label="Monte Carlo ± 2 s.e.")
ax.axhline(exact, ls="--", lw=1, label="Black–Scholes")
ax.set_xscale("log")
ax.set_xlabel("paths")
ax.set_ylabel("price")
ax.legend()
plt.show()
conv` },
      { md: `## Antithetic variates

Use each draw twice, as $Z$ and $-Z$: the two payoffs are negatively correlated, so their average varies less. \`tf.mc_european\` has it built in.` },
      { code: `plain = tf.mc_european(s0, k, T, r, sigma, "call", n=50_000, seed=5)
anti = tf.mc_european(s0, k, T, r, sigma, "call", n=50_000, seed=5, antithetic=True)
print(f"plain {plain['price']:.4f} ± {plain['se']:.4f}; antithetic {anti['price']:.4f} ± {anti['se']:.4f}")` },
      { md: `## A path-dependent option

An Asian call pays on the *average* price over its life, so there is no simple closed form: simulation earns its keep here.` },
      { code: `paths = tf.gbm_paths(s0, r, sigma, T, 252, 20_000, seed=2)
avg = paths[:, 1:].mean(axis=1)
asian = np.exp(-r * T) * np.maximum(avg - k, 0)
print(f"Asian call {asian.mean():.4f} ± {asian.std(ddof=1) / np.sqrt(len(asian)):.4f} (the European call is {exact:.4f})")
plt.plot(paths[:40].T, lw=0.6, alpha=0.7)
plt.xlabel("trading day")
plt.ylabel("price")
plt.show()` }
    ]
  },
  {
    id: 'var-backtest',
    title: 'VaR, expected shortfall and backtesting',
    summary: 'Historical and normal VaR on six years of prices, expected shortfall, a rolling VaR backtest with Kupiec’s test, and a trading-rule backtest.',
    needs: [],
    cells: [
      { md: `# Value at Risk and backtesting

**VaR** at 99% is the loss exceeded on only 1% of days; **expected shortfall** (ES) is the average loss on those days. Banks report both (Basel's FRTB moved capital to ES at 97.5%). The prices are Tide's synthetic index, whose volatility clusters like real markets (it follows a GARCH process, with a crash in March 2020).` },
      { code: `${SETUP}

prices = tf.sample_prices("TIDX")
rets = prices.pct_change().dropna()
print(f"{len(rets)} days, daily volatility {rets.std():.4f}")
rets.plot(lw=0.6, title="TIDX daily returns")
plt.show()` },
      { code: `hist = tf.historical_var(rets, 0.99)
norm = tf.parametric_var(rets.mean(), rets.std(), 0.99)
pd.DataFrame([hist, norm], index=["historical", "normal"])` },
      {
        exercise: {
          id: 'tpl:var:es',
          title: 'Expected shortfall',
          prompt: 'Write `expected_shortfall(returns, level)`: the average loss on the days at or beyond the historical VaR, as a positive number. Use `np.quantile` for the cut-off.',
          starter: `def expected_shortfall(returns, level=0.99):
    r = np.asarray(returns)
    ...`,
          solution: `def expected_shortfall(returns, level=0.99):
    r = np.asarray(returns)
    cut = np.quantile(r, 1 - level)
    return -r[r <= cut].mean()`,
          hint: 'Find the return at the (1 − level) quantile, keep the returns at or below it, and average them; flip the sign so a loss is positive.',
          tests: [
            { name: 'matches tide_finance', code: 'assert abs(expected_shortfall(rets, 0.99) - hist["es"]) < 1e-12' },
            { name: 'ES is beyond VaR', code: 'assert expected_shortfall(rets, 0.975) >= tf.historical_var(rets, 0.975)["var"]' },
            { name: 'a simple case', code: 'assert abs(expected_shortfall(np.arange(-50, 50) / 100, 0.95) - 0.48) < 1e-9, "the worst 5 of 100 evenly spaced returns average a 48% loss"' }
          ]
        }
      },
      { md: `## Does the VaR hold up?

Each day, compute VaR from the previous 250 days, then count the days the loss exceeded it. At 99% we expect about 2.5 a year. Kupiec's test asks whether the count is too far from that to be chance.` },
      { code: `bt = tf.var_backtest(rets.to_numpy(), window=250, level=0.99)
bt` },
      { code: `window = 250
roll_var = -rets.rolling(window).quantile(0.01).shift(1)
hits = rets < -roll_var
ax = rets.plot(lw=0.5, label="return")
(-roll_var).plot(ax=ax, lw=1.2, label="−VaR 99%")
ax.scatter(rets.index[hits], rets[hits], s=10, color="C1", zorder=3, label="exceptions")
ax.legend()
plt.show()` },
      { md: `## Backtesting a trading rule

Long the index when its 20-day average is above its 100-day average at yesterday's close (no look-ahead), with a 5 bp cost per trade.` },
      { code: `rule = tf.sma_crossover(prices.to_numpy(), fast=20, slow=100, cost=0.0005)
print({k: round(v, 4) for k, v in rule.items() if k != "equity"})
plt.plot(prices.index, rule["equity"], label="crossover")
plt.plot(prices.index, prices / prices.iloc[0], label="buy and hold")
plt.legend()
plt.show()` },
      { md: `## Liquidity: what selling costs

VaR assumes you can sell at the last price. A real sale walks down the **order book**: each price level holds only so much size. Slide the order size to see the average price fall away from the mid, which is the idea behind liquidity-adjusted VaR. (The book is made up for the lesson.)` },
      { code: `book_rng = np.random.default_rng(3)
mid = float(prices.iloc[-1])
tick = round(mid * 0.0005, 2)
bids = [(round(mid - tick * (i + 0.5), 2), int(book_rng.integers(20, 120) * (1 + i / 4))) for i in range(25)]
asks = [(round(mid + tick * (i + 0.5), 2), int(book_rng.integers(20, 120) * (1 + i / 4))) for i in range(25)]
tn.order_book(bids, asks, title="TIDX order book (illustrative)")` }
    ]
  },
  {
    id: 'frontier-cvxpy',
    title: 'Mean–variance and the efficient frontier',
    summary: 'Markowitz with cvxpy on five assets: the minimum-variance portfolio, the frontier, and the tangency portfolio.',
    needs: ['cvxpy'],
    cells: [
      { md: `# The efficient frontier

Markowitz: among portfolios with weights $w$ summing to one, the efficient ones have the least variance $w^\\top \\Sigma w$ for their expected return $\\mu^\\top w$. With no short sales ($w \\ge 0$) there is no closed form, but it is a small convex problem, which **cvxpy** solves (Apache-2.0).` },
      { code: `${SETUP}
import cvxpy as cp

px = tf.sample_prices()
daily = px.pct_change().dropna()
mu = daily.mean().to_numpy() * 252
cov = daily.cov().to_numpy() * 252
names = list(px.columns)
pd.DataFrame({"return": mu, "volatility": np.sqrt(np.diag(cov))}, index=names).round(3)` },
      {
        exercise: {
          id: 'tpl:frontier:minvar',
          title: 'The minimum-variance portfolio',
          prompt: 'Write `min_variance(cov)` with cvxpy: long-only weights that sum to one and minimise $w^\\top\\Sigma w$. Return the weights as a NumPy array.',
          starter: `def min_variance(cov):
    n = cov.shape[0]
    w = cp.Variable(n)
    ...`,
          solution: `def min_variance(cov):
    n = cov.shape[0]
    w = cp.Variable(n)
    cp.Problem(cp.Minimize(cp.quad_form(w, cp.psd_wrap(cov))), [cp.sum(w) == 1, w >= 0]).solve()
    return np.asarray(w.value)`,
          hint: 'cp.quad_form(w, cov) is the variance; the constraints are cp.sum(w) == 1 and w >= 0. Solve the problem, then read w.value.',
          tests: [
            { name: 'weights sum to one and are long-only', code: 'w = min_variance(cov)\nassert abs(w.sum() - 1) < 1e-4 and (w > -1e-5).all()' },
            { name: 'beats equal weights', code: 'w = min_variance(cov)\neq = np.ones(len(mu)) / len(mu)\nassert w @ cov @ w <= eq @ cov @ eq + 1e-9' },
            { name: 'beats every single asset', code: 'w = min_variance(cov)\nassert w @ cov @ w <= np.diag(cov).min() + 1e-9' }
          ]
        }
      },
      { code: `w_mv = min_variance(cov)
pd.Series(w_mv, index=names).round(3)` },
      { md: `## The whole frontier

Hover along the curve to see each portfolio's weights. The marked point with a risk-free rate of 3% is the **tangency** portfolio, with the highest Sharpe ratio.` },
      { code: `tn.frontier(mu, cov, names, rf=0.03)` }
    ]
  },
  {
    id: 'garch',
    title: 'GARCH volatility',
    summary: 'Fit a GARCH(1,1) with arch, recover the parameters the prices were made with, and forecast volatility.',
    needs: ['arch'],
    cells: [
      { md: `# Volatility clustering and GARCH

Big moves follow big moves. GARCH(1,1) models tomorrow's variance from today's shock and today's variance:

$$\\sigma^2_t = \\omega + \\alpha\\,\\varepsilon^2_{t-1} + \\beta\\,\\sigma^2_{t-1}.$$

Tide's synthetic index was *made* with $\\alpha = 0.09$, $\\beta = 0.89$, so a good fit should find numbers near those. The **arch** library (NCSA licence) fits it by maximum likelihood.` },
      { code: `${SETUP}
from arch import arch_model

r = 100 * np.log(tf.sample_prices("TIDX")).diff().dropna()  # percent log returns
res = arch_model(r, mean="Constant", vol="GARCH", p=1, q=1, dist="normal").fit(disp="off")
res.params` },
      { code: `ax = (res.conditional_volatility * np.sqrt(252)).plot(lw=1, title="Annualised conditional volatility (%)")
plt.show()` },
      {
        exercise: {
          id: 'tpl:garch:persistence',
          title: 'Persistence and half-life',
          prompt: 'From the fit, set `persistence` to $\\alpha + \\beta$ and `half_life` to the number of days a volatility shock takes to halve, $\\ln(0.5)/\\ln(\\alpha+\\beta)$. Also set `long_run_vol`, the annualised long-run volatility in percent: $\\sqrt{252\\,\\omega/(1-\\alpha-\\beta)}$.',
          starter: `alpha, beta, omega = res.params["alpha[1]"], res.params["beta[1]"], res.params["omega"]
persistence = ...
half_life = ...
long_run_vol = ...`,
          solution: `alpha, beta, omega = res.params["alpha[1]"], res.params["beta[1]"], res.params["omega"]
persistence = alpha + beta
half_life = np.log(0.5) / np.log(persistence)
long_run_vol = np.sqrt(252 * omega / (1 - persistence))`,
          hint: 'Read alpha[1], beta[1] and omega from res.params; the half-life comes from persistence ** h = 0.5.',
          tests: [
            { name: 'persistence', code: 'assert abs(persistence - (res.params["alpha[1]"] + res.params["beta[1]"])) < 1e-12' },
            { name: 'half-life', code: 'assert abs(persistence ** half_life - 0.5) < 1e-9, "persistence to the power half_life should be 0.5"' },
            { name: 'long-run volatility', code: 'assert 8 < long_run_vol < 40, f"{long_run_vol:.1f}% a year is not a plausible index volatility"' }
          ]
        }
      },
      { code: `print(f"alpha {alpha:.3f}, beta {beta:.3f} (made with 0.09 and 0.89); half-life {half_life:.1f} days; long-run volatility {long_run_vol:.1f}%")
fc = res.forecast(horizon=60)
(np.sqrt(fc.variance.iloc[-1] * 252)).plot(title="Volatility forecast, next 60 days (%)")
plt.show()` }
    ]
  },
  {
    id: 'duckdb-polars',
    title: 'DuckDB and Polars over market data',
    summary: 'SQL with DuckDB straight over the bundled CSVs, the same questions in Polars, and when the curve was inverted.',
    needs: ['duckdb', 'polars'],
    cells: [
      { md: `# DuckDB and Polars

Two fast, modern tools for tables: **DuckDB** (MIT) runs SQL straight over files; **Polars** (MIT) is a DataFrame library with lazy queries. Both read Tide's bundled market data in place.` },
      { code: `${SETUP}
import os
import duckdb
import polars as pl

treasury = os.path.join(tf.DATA, "us_treasury_yields.csv")
fx = os.path.join(tf.DATA, "ecb_fx_rates.csv")
duckdb.sql(f"SELECT * FROM read_csv_auto('{treasury}') ORDER BY date DESC LIMIT 5").df()` },
      { md: `## The 10-year minus 2-year spread

When it is negative the curve is **inverted**, historically a recession warning.` },
      { code: `spread = duckdb.sql(f"""
    SELECT date, y_10y - y_2y AS spread
    FROM read_csv_auto('{treasury}')
    WHERE y_10y IS NOT NULL AND y_2y IS NOT NULL
    ORDER BY date
""").df()
ax = spread.plot(x="date", y="spread", lw=1, legend=False, title="10y − 2y (percentage points)")
ax.axhline(0, lw=0.8, color="gray")
plt.show()` },
      {
        exercise: {
          id: 'tpl:duckdb:inverted',
          title: 'Inverted days per year',
          prompt: 'Write a DuckDB query, stored as a DataFrame `inverted`, with one row per year (`year`, `days`) counting the days the 10-year yield was below the 2-year. Order by year.',
          starter: `inverted = duckdb.sql(f"""
    SELECT ...
    FROM read_csv_auto('{treasury}')
""").df()
inverted`,
          solution: `inverted = duckdb.sql(f"""
    SELECT year(date) AS year, count(*) AS days
    FROM read_csv_auto('{treasury}')
    WHERE y_10y < y_2y
    GROUP BY year
    ORDER BY year
""").df()
inverted`,
          hint: 'year(date) gives the year; filter with WHERE y_10y < y_2y, then GROUP BY the year.',
          tests: [
            { name: 'one row per year with days', code: 'assert list(inverted.columns) == ["year", "days"], f"columns should be year, days; got {list(inverted.columns)}"' },
            { name: 'the counts are right', code: `t = tf.treasury_yields()
want = (t.y_10y < t.y_2y).groupby(t.index.year).sum()
want = want[want > 0]
got = dict(zip(inverted.year.astype(int), inverted.days.astype(int)))
assert got == {int(k): int(v) for k, v in want.items()}, f"expected {dict(want)}"` }
          ]
        }
      },
      { md: `## The same in Polars

A lazy query: nothing runs until \`collect()\`, and Polars plans the whole thing at once.` },
      { code: `monthly = (
    pl.scan_csv(fx, try_parse_dates=True)
    .with_columns(pl.col("date").dt.truncate("1mo").alias("month"))
    .group_by("month")
    .agg(pl.col("usd_per_eur").mean().alias("usd_per_eur"), pl.col("gbp_per_eur").mean().alias("gbp_per_eur"))
    .sort("month")
    .collect()
)
monthly.tail(6)` },
      { code: `duckdb.sql("SELECT year(month) AS year, round(avg(usd_per_eur), 4) AS usd_per_eur FROM monthly GROUP BY year ORDER BY year").df()` }
    ]
  },
  {
    id: 'reconciliation',
    title: 'Payments reconciliation in pandas',
    summary: 'Match a ledger against a bank statement: missing, duplicated, mismatched and late payments, in integer cents.',
    needs: [],
    cells: [
      { md: `# Reconciling a ledger with the bank

Every payments team does this daily: the company's **ledger** says what should have moved, the bank **statement** says what did. Matching them by reference finds the breaks:

- **matched**: same reference, same amount
- **amount mismatch**: same reference, different amount (fees, FX, typos)
- **missing at bank**: in the ledger, not at the bank (not yet settled, or failed)
- **unexpected at bank**: at the bank, not in the ledger (a direct debit nobody booked)
- **duplicate**: the bank has the same reference twice

Money is in **integer minor units** (cents): floats can't hold 0.10 exactly.` },
      { code: `${SETUP}

rng = np.random.default_rng(42)
n = 40
ledger = pd.DataFrame({
    "ref": [f"INV-{1000 + i}" for i in range(n)],
    "amount_cents": rng.integers(1_000, 500_000, n),
    "booked": pd.Timestamp("2026-10-01") + pd.to_timedelta(rng.integers(0, 20, n), unit="D"),
})
bank = ledger.rename(columns={"booked": "value_date"}).copy()
bank["value_date"] = bank["value_date"] + pd.to_timedelta(rng.integers(0, 3, n), unit="D")
bank.loc[[3, 17], "amount_cents"] -= 150          # a 1.50 fee taken twice
bank = bank.drop(index=[8, 25, 31])              # three not settled yet
bank = pd.concat([bank, bank.loc[[12]]])          # one paid twice
bank = pd.concat([bank, pd.DataFrame({"ref": ["DD-ACME-77"], "amount_cents": [9_900], "value_date": [pd.Timestamp("2026-10-15")]})])
bank = bank.sample(frac=1, random_state=1).reset_index(drop=True)
print(len(ledger), "ledger lines,", len(bank), "bank lines")` },
      {
        exercise: {
          id: 'tpl:recon:reconcile',
          title: 'Reconcile',
          prompt: 'Write `reconcile(ledger, bank)` returning one row per reference with a `status` column: `"matched"`, `"amount mismatch"`, `"missing at bank"`, `"unexpected at bank"` or `"duplicate"` (a reference the bank has more than once), and `diff_cents` (bank minus ledger, 0 when not comparable).',
          starter: `def reconcile(ledger, bank):
    counts = bank.groupby("ref").size()
    ...`,
          solution: `def reconcile(ledger, bank):
    counts = bank.groupby("ref").size().rename("bank_count")
    b = bank.groupby("ref", as_index=False)["amount_cents"].first().rename(columns={"amount_cents": "bank_cents"})
    m = ledger[["ref", "amount_cents"]].merge(b, on="ref", how="outer").merge(counts, left_on="ref", right_index=True, how="left")
    def status(row):
        if pd.isna(row.amount_cents):
            return "unexpected at bank"
        if pd.isna(row.bank_cents):
            return "missing at bank"
        if row.bank_count > 1:
            return "duplicate"
        return "matched" if row.bank_cents == row.amount_cents else "amount mismatch"
    m["status"] = m.apply(status, axis=1)
    both = m.amount_cents.notna() & m.bank_cents.notna()
    m["diff_cents"] = np.where(both, m.bank_cents.fillna(0) - m.amount_cents.fillna(0), 0).astype(int)
    return m`,
          hint: 'Count the bank lines per reference, merge the ledger and the bank on "ref" with how="outer", then decide each row from which side is missing, the count and the amounts.',
          tests: [
            { name: 'one row per reference', code: 'r = reconcile(ledger, bank)\nassert r.ref.is_unique and len(r) == 41, f"expected 41 references, got {len(r)}"' },
            { name: 'the breaks are found', code: `r = reconcile(ledger, bank)
got = r.status.value_counts().to_dict()
want = {"matched": 34, "amount mismatch": 2, "missing at bank": 3, "duplicate": 1, "unexpected at bank": 1}
assert got == want, f"expected {want}, got {got}"` },
            { name: 'the fee shows as minus 150 cents', code: 'r = reconcile(ledger, bank)\nassert set(r.loc[r.status == "amount mismatch", "diff_cents"]) == {-150}' }
          ]
        }
      },
      { code: `recon = reconcile(ledger, bank)
recon[recon.status != "matched"].sort_values("status")` },
      { code: `summary = recon.groupby("status").agg(lines=("ref", "count"), ledger_cents=("amount_cents", "sum"))
summary["ledger"] = summary.ledger_cents.map(lambda c: f"{c / 100:,.2f}")
summary.drop(columns="ledger_cents")` }
    ]
  }
]

export const templateById = (id: string) => QUANT_TEMPLATES.find((t) => t.id === id)

/** Every exercise in the templates, by id: where the hidden tests of a template's exercise come from */
export function templateExercise(id: string): ExerciseSpec | undefined {
  for (const t of QUANT_TEMPLATES) for (const c of t.cells) if ('exercise' in c && c.exercise.id === id) return c.exercise
  return undefined
}

/** An exercise as notebook cells: its prompt, and a code cell with the starter that carries the exercise's id */
export function exerciseCells(e: ExerciseSpec): Cell[] {
  const meta: TideCellMeta = { exercise: { id: e.id, title: e.title, ...(e.hint ? { hint: e.hint } : {}) } }
  return [markdownCell(`### Exercise: ${e.title}\n\n${e.prompt}`), codeCell(e.starter, { tide: meta })]
}

/** A template as a fresh notebook */
export function templateNotebook(t: QuantTemplate): Notebook {
  const cells = t.cells.flatMap((c) => ('md' in c ? [markdownCell(c.md)] : 'code' in c ? [codeCell(c.code)] : exerciseCells(c.exercise)))
  const nb = newNotebook(cells)
  nb.metadata = { ...nb.metadata, tide: { template: t.id } }
  return nb
}

/** The template's code as it runs with every exercise solved: for the tests */
export function solvedCode(t: QuantTemplate): string[] {
  return t.cells.flatMap((c) => ('code' in c ? [c.code] : 'exercise' in c ? [c.exercise.solution] : []))
}

export const exerciseOf = (cell: Cell): TideCellMeta['exercise'] | undefined => (cell.metadata?.tide as TideCellMeta | undefined)?.exercise
