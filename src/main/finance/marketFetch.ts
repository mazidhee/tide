/**
 * Newer market data, only when you ask (Settings › Tools › Market data): the US Treasury's daily
 * par yield curve and the ECB's euro reference rates, from their own free services, through the
 * polite fetcher (robots.txt read first, a gap between requests, no logins). Both allow reuse: the
 * Treasury's is a US government work, the ECB's statistics may be reused with the source named.
 * Written into the notes folder as CSV files (Market data/), where the SQL lab's load_table and the
 * learner's own Python can read them; the bundled 2020 to 2025 series stay as they are.
 */
import { promises as fs } from 'fs'
import { ecbCsv, fetchPlan, treasuryCsv } from '@shared/finance/marketData'
import { politeFetcher, type Fetcher } from '../courseSources/fetcher'

export const MARKET_FOLDER = 'Market data'

export interface FetchedMarketData {
  files: { path: string; rows: number; source: string }[]
}

/** Fetches both series for the years asked and writes them; `write` is given the vault-relative path */
export async function fetchMarketData(o: { fromYear: number; toYear: number; write(path: string, text: string): Promise<void>; fetcher?: Fetcher }): Promise<FetchedMarketData> {
  const f = o.fetcher ?? politeFetcher({ gapMs: 1500 })
  const [treasury, ecb] = fetchPlan(o.fromYear, o.toYear)
  const years: string[] = []
  for (const url of treasury.urls) years.push((await f.page(url)).text)
  const fx: { currency: string; text: string }[] = []
  for (const url of ecb.urls) fx.push({ currency: /EXR\/D\.(\w{3})\./.exec(url)![1], text: (await f.page(url)).text })
  const tCsv = treasuryCsv(years)
  const eCsv = ecbCsv(fx)
  const span = o.fromYear === o.toYear ? `${o.fromYear}` : `${o.fromYear}-${o.toYear}`
  const out = [
    { path: `${MARKET_FOLDER}/us_treasury_yields_${span}.csv`, text: tCsv, source: `${treasury.title} (${treasury.terms})` },
    { path: `${MARKET_FOLDER}/ecb_fx_rates_${span}.csv`, text: eCsv, source: `${ecb.title} (${ecb.terms})` }
  ]
  for (const x of out) await o.write(x.path, x.text)
  return { files: out.map((x) => ({ path: x.path, rows: x.text.trim().split('\n').length - 1, source: x.source })) }
}

/** What Settings shows: when it was last fetched (by the newest file's date), and what is bundled */
export async function marketDataStatus(abs: (rel: string) => string): Promise<{ ready: boolean; detail: string }> {
  const files = await fs.readdir(abs(MARKET_FOLDER)).catch(() => [] as string[])
  const stats = await Promise.all(files.filter((n) => n.endsWith('.csv')).map((n) => fs.stat(abs(`${MARKET_FOLDER}/${n}`)).catch(() => null)))
  const newest = Math.max(0, ...stats.map((s) => s?.mtimeMs ?? 0))
  const bundled = 'Bundled: US Treasury yields and ECB euro rates, 2020 to 2025, and synthetic sample prices.'
  if (newest && Date.now() - newest < 86_400_000) return { ready: true, detail: `${bundled} Newer series fetched today into ${MARKET_FOLDER}/.` }
  return { ready: false, detail: `${bundled} Fetch this year's from the US Treasury and the ECB Data Portal (free, no account) into ${MARKET_FOLDER}/.` }
}
