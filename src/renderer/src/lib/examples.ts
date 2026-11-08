import { connect, makeNode, serializeCanvas, type Canvas, type ComponentKind } from '@shared/canvas'
import type { FileNode } from '@shared/types'
import { DESIGN_FOLDER } from './designs'

/**
 * Worked examples, created only when you ask for them: a finished system design to study (and
 * redraw from memory), and a small multi-file data project for the Playground.
 */

const free = (files: FileNode[], path: string, ext: string) => {
  const taken = new Set(files.map((f) => f.path.toLowerCase()))
  let p = `${path}${ext}`
  for (let i = 2; taken.has(p.toLowerCase()); i++) p = `${path} ${i}${ext}`
  return p
}

/** A real-time market data feed: exchange feeds in, normalised ticks out to terminals, history kept */
export function marketDataDesign(): Canvas {
  let c: Canvas = { nodes: [], edges: [] }
  const add = (id: string, label: string, kind: ComponentKind, x: number, y: number, details?: string) => {
    c = { ...c, nodes: [...c.nodes, makeNode(c, { id, label, kind, x, y, details })] }
  }
  add('exchanges', 'Exchange feeds', 'external', 0, 0, 'NYSE, LSE, CME: multicast UDP, ITCH/FIX')
  add('handlers', 'Feed handlers', 'worker', 270, 0, 'One per venue, gap detection and recovery')
  add('normalizer', 'Normalizer', 'service', 540, 0, 'One tick format, symbol mapping')
  add('bus', 'Tick bus', 'queue', 810, 0, 'Kafka, partitioned by symbol')
  add('plant', 'Ticker plant', 'cache', 540, 230, 'Latest quote per symbol, in memory')
  add('store', 'Tick store', 'database', 810, 230, 'Columnar time series (kdb+)')
  add('gateway', 'Distribution gateway', 'gateway', 270, 230, 'WebSocket fan-out, conflation per client')
  add('history', 'History API', 'service', 540, 450, 'Bars and ticks for a time range')
  add('terminals', 'Terminals', 'client', 0, 230, 'Traders, charts, alerts')
  add('targets', 'Targets', 'note', 0, 450, '5M msgs/s at the open; p99 under 5 ms exchange to screen; no lost ticks')
  const link = (a: string, b: string, label?: string) => (c = connect(c, a, b, label))
  link('exchanges', 'handlers', 'multicast')
  link('handlers', 'normalizer')
  link('normalizer', 'bus', 'ticks')
  link('bus', 'plant')
  link('bus', 'store', 'append')
  link('plant', 'gateway', 'snapshots')
  link('gateway', 'terminals', 'WebSocket')
  link('history', 'store', 'range query')
  link('terminals', 'history', 'HTTPS')
  return c
}

export async function createExampleDesign(files: FileNode[]): Promise<string> {
  const path = free(files, `${DESIGN_FOLDER}/Example, real-time market data feed`, '.canvas')
  await window.tide.vault.write(path, serializeCanvas(marketDataDesign()))
  return path
}

/** Deterministic prices so the example gives the same numbers every time */
function pricesCsv(): string {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const tickers = { AAPL: 190, MSFT: 410, JPM: 195 } as Record<string, number>
  const drift = { AAPL: 0.0006, MSFT: 0.0004, JPM: 0.0002 } as Record<string, number>
  const vol = { AAPL: 0.016, MSFT: 0.013, JPM: 0.012 } as Record<string, number>
  const rows = ['date,AAPL,MSFT,JPM']
  const day = new Date(Date.UTC(2026, 0, 2))
  for (let i = 0; i < 120; i++) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1)
    for (const t of Object.keys(tickers)) tickers[t] *= 1 + drift[t] + vol[t] * rand()
    rows.push([day.toISOString().slice(0, 10), ...Object.values(tickers).map((p) => p.toFixed(2))].join(','))
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return rows.join('\n') + '\n'
}

const STATS_PY = `"""Portfolio statistics, kept apart from main.py so they can be tested and reused."""
import numpy as np
import pandas as pd

TRADING_DAYS = 252


def daily_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """Percentage change from one close to the next."""
    return prices.pct_change().dropna()


def annualised_sharpe(returns: pd.Series, risk_free: float = 0.04) -> float:
    """Excess return per unit of volatility, scaled to a year."""
    excess = returns - risk_free / TRADING_DAYS
    return float(np.sqrt(TRADING_DAYS) * excess.mean() / excess.std())


def max_drawdown(returns: pd.Series) -> float:
    """The worst fall from a peak, as a fraction (-0.12 is a 12% drawdown)."""
    wealth = (1 + returns).cumprod()
    return float((wealth / wealth.cummax() - 1).min())
`

const MAIN_PY = `# Example data project: an equal-weight portfolio of three stocks.
# main.py reads prices.csv from this folder and uses functions from stats.py.
# Try: change the weights, add a ticker to the CSV, or plot a rolling 20-day volatility.
import matplotlib.pyplot as plt
import pandas as pd

from stats import annualised_sharpe, daily_returns, max_drawdown

prices = pd.read_csv("prices.csv", parse_dates=["date"], index_col="date")
returns = daily_returns(prices)

weights = pd.Series({"AAPL": 1 / 3, "MSFT": 1 / 3, "JPM": 1 / 3})
portfolio = returns @ weights

summary = pd.DataFrame(
    {
        "total return": (1 + returns).prod() - 1,
        "sharpe": returns.apply(annualised_sharpe),
        "max drawdown": returns.apply(max_drawdown),
    }
)
summary.loc["portfolio"] = [(1 + portfolio).prod() - 1, annualised_sharpe(portfolio), max_drawdown(portfolio)]
print(summary.round(3))

ax = (1 + returns).cumprod().plot(title="Growth of $1", figsize=(8, 4))
(1 + portfolio).cumprod().plot(ax=ax, linewidth=2.5, label="portfolio", color="black")
ax.legend()
plt.show()
`

/** A small multi-file pandas project in the Code folder; returns the path of main.py */
export async function createExampleProject(files: FileNode[]): Promise<string> {
  const taken = new Set(files.map((f) => f.path.split('/').slice(0, -1).join('/').toLowerCase()))
  let folder = 'Code/examples/portfolio'
  for (let i = 2; taken.has(folder.toLowerCase()); i++) folder = `Code/examples/portfolio-${i}`
  await window.tide.vault.write(`${folder}/prices.csv`, pricesCsv())
  await window.tide.vault.write(`${folder}/stats.py`, STATS_PY)
  await window.tide.vault.write(`${folder}/main.py`, MAIN_PY)
  return `${folder}/main.py`
}
