/** Fetching newer market data: the polite fetcher's rules, the files written, nothing else asked for */
import { describe, expect, it } from 'vitest'
import { fetchMarketData } from '../src/main/finance/marketFetch'
import { politeFetcher } from '../src/main/courseSources/fetcher'

const TREASURY = (y: number) => `Date,"1 Mo","3 Mo","10 Yr"\n01/03/${y},4.1,4.2,4.5\n01/02/${y},4.0,4.1,4.4\n`
const ECB = (c: string) => `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.${c}.EUR.SP00.A,D,${c},EUR,SP00,A,2026-01-02,1.5\n`

describe('fetching market data', () => {
  it('reads robots.txt first, asks only the two official services, and writes two CSVs', async () => {
    const asked: string[] = []
    const fetchImpl = async (url: string) => {
      asked.push(url)
      const u = new URL(url)
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } })
      if (u.hostname === 'home.treasury.gov') return new Response(TREASURY(Number(/csv\/(\d{4})/.exec(url)![1])), { status: 200, headers: { 'content-type': 'text/csv' } })
      return new Response(ECB(/EXR\/D\.(\w{3})/.exec(url)![1]), { status: 200, headers: { 'content-type': 'text/csv' } })
    }
    const written = new Map<string, string>()
    const r = await fetchMarketData({ fromYear: 2025, toYear: 2026, write: async (p, t) => void written.set(p, t), fetcher: politeFetcher({ fetchImpl: fetchImpl as never, sleep: async () => {} }) })
    expect([...written.keys()]).toEqual(['Market data/us_treasury_yields_2025-2026.csv', 'Market data/ecb_fx_rates_2025-2026.csv'])
    expect(written.get('Market data/us_treasury_yields_2025-2026.csv')!.split('\n')[1]).toBe('2025-01-02,4.0,4.1,,,,,4.4,')
    expect(written.get('Market data/ecb_fx_rates_2025-2026.csv')!.split('\n')[0]).toBe('date,usd_per_eur,gbp_per_eur,jpy_per_eur,chf_per_eur')
    expect(r.files.map((f) => f.rows)).toEqual([4, 1])
    expect(new Set(asked.map((u) => new URL(u).hostname))).toEqual(new Set(['home.treasury.gov', 'data-api.ecb.europa.eu']))
    expect(asked.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(2)
    expect(asked[0]).toBe('https://home.treasury.gov/robots.txt')
  })

  it('stops when robots.txt says no', async () => {
    const fetchImpl = async (url: string) => (url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /', { status: 200 }) : new Response('x'))
    await expect(fetchMarketData({ fromYear: 2026, toYear: 2026, write: async () => {}, fetcher: politeFetcher({ fetchImpl: fetchImpl as never, sleep: async () => {} }) })).rejects.toThrow(/robots/)
  })
})
