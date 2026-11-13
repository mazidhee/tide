/**
 * The finance lab's Python helper in Tide's sandbox: `import tide_finance as tf` in any Python a
 * lesson or the learner runs. Written beside the sandbox's other helpers (sitecustomize, tide_http)
 * only when the code names it, with the market data it reads: the bundled US Treasury and ECB
 * series and the synthetic sample prices, the same rows the SQL lab holds.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { SYNTHETIC_ASSETS, syntheticPrices } from '@shared/finance/marketData'
import HELPER from './tide_finance.py?raw'
import TREASURY_CSV from '../../../resources/marketdata/us_treasury_yields.csv?raw'
import ECB_FX_CSV from '../../../resources/marketdata/ecb_fx_rates.csv?raw'

export const FINANCE_HELPER = HELPER

let wide: string | null = null
/** The synthetic closes as one wide table: date, then a column per ticker */
export function samplePricesCsv(): string {
  if (wide) return wide
  const tickers = SYNTHETIC_ASSETS.map((a) => a.ticker)
  const by = new Map<string, Record<string, number>>()
  for (const p of syntheticPrices()) (by.get(p.date) ?? by.set(p.date, {}).get(p.date)!)[p.ticker] = p.close
  wide = [['date', ...tickers].join(','), ...[...by].map(([d, row]) => [d, ...tickers.map((t) => row[t])].join(','))].join('\n') + '\n'
  return wide
}

export const usesFinanceHelper = (code: string) => /\btide_finance\b/.test(code)

/** Writes the helper and its data into the sandbox's site folder */
export async function writeFinanceHelper(site: string): Promise<void> {
  const data = join(site, 'tide_market')
  await fs.mkdir(data, { recursive: true })
  await Promise.all([
    fs.writeFile(join(site, 'tide_finance.py'), HELPER),
    fs.writeFile(join(data, 'us_treasury_yields.csv'), TREASURY_CSV),
    fs.writeFile(join(data, 'ecb_fx_rates.csv'), ECB_FX_CSV),
    fs.writeFile(join(data, 'sample_prices.csv'), samplePricesCsv())
  ])
}
