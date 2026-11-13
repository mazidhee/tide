/**
 * Stablecoin mechanics, as a small model you can step day by day.
 *
 * A fiat-backed coin (USDC, USDT style): the issuer mints a coin for every dollar paid in and burns
 * it on redemption, holding reserves as bank deposits (cash) and short Treasury bills. The market
 * price stays near $1 because arbitrageurs buy below $1 and redeem at $1, and mint at $1 to sell
 * above it. The peg holds only as well as that arbitrage works: it needs redemptions open and the
 * reserves to be worth what they say.
 *
 * Depeg scenarios:
 * - bank-failure: part of the cash sits at a bank that fails over a weekend (USDC had $3.3bn of
 *   about $40bn at Silicon Valley Bank in March 2023); redemptions shut until Monday.
 * - run: holders rush to redeem; bills must be sold at a fire-sale discount, which itself lowers
 *   the backing.
 * - algorithmic: the coin is redeemed for a governance token the protocol mints (Terra's UST and
 *   LUNA, May 2022): redemptions dilute the token, its price falls, each redemption needs more
 *   tokens, and the loop feeds itself.
 *
 * Units: millions of dollars and millions of coins. Every step is a day. The numbers are a model,
 * set to show the mechanism, not a forecast.
 */

export type Scenario = 'calm' | 'bank-failure' | 'run' | 'algorithmic'

export interface StablecoinParams {
  scenario: Scenario
  /** Coins in issue at the start (millions) */
  supply: number
  /** Share of reserves held as bank deposits; the rest is Treasury bills */
  cashShare: number
  /** Fee to mint or redeem with the issuer, a fraction (0.001 is 10 bp) */
  fee: number
  /** Most the issuer can pay out in a day, as a fraction of supply */
  capacity: number
  /** Discount on bills sold in a hurry, a fraction (0.02 is 2%) */
  fireSale: number
  /** Share of cash stuck at the failed bank (bank-failure) */
  stuck: number
  /** How strongly holders sell when the backing or price slips (0 to 3) */
  panic: number
  /** Days the model runs for */
  days: number
}

export const DEFAULT_PARAMS: Record<Scenario, StablecoinParams> = {
  calm: { scenario: 'calm', supply: 1000, cashShare: 0.2, fee: 0.001, capacity: 0.1, fireSale: 0.01, stuck: 0, panic: 0.5, days: 20 },
  'bank-failure': { scenario: 'bank-failure', supply: 1000, cashShare: 0.25, fee: 0.001, capacity: 0.1, fireSale: 0.01, stuck: 0.33, panic: 1.5, days: 20 },
  run: { scenario: 'run', supply: 1000, cashShare: 0.1, fee: 0.001, capacity: 0.08, fireSale: 0.05, stuck: 0, panic: 2, days: 20 },
  algorithmic: { scenario: 'algorithmic', supply: 1000, cashShare: 0, fee: 0.001, capacity: 0.25, fireSale: 0, stuck: 0, panic: 2, days: 20 }
}

export interface Day {
  day: number
  supply: number
  /** Reserves at what they would fetch (cash available, plus bills at market value) */
  cash: number
  bills: number
  /** Cash frozen at a failed bank (counted at what it is expected to recover) */
  frozen: number
  /** Reserves per coin */
  backing: number
  /** The coin's market price in dollars */
  price: number
  /** Redeemed with the issuer today (millions) */
  redeemed: number
  /** Minted today */
  minted: number
  /** Coins holders wanted to sell today */
  selling: number
  /** Redemptions open today */
  open: boolean
  /** algorithmic: the governance token's price and supply */
  tokenPrice?: number
  tokenSupply?: number
  note: string
}

/** One step of the model, from the day before. Pure: same inputs, same day. */
export function stepDay(p: StablecoinParams, prev: Day): Day {
  const day = prev.day + 1
  let { supply, cash, bills, frozen } = prev
  let tokenPrice = prev.tokenPrice
  let tokenSupply = prev.tokenSupply
  let note = ''
  // The shock
  if (p.scenario === 'bank-failure' && day === 2) {
    frozen = cash * p.stuck
    cash -= frozen
    note = `The bank holding ${Math.round(p.stuck * 100)}% of the cash fails on a Friday: ${frozen.toFixed(0)}m is frozen, redemptions shut for the weekend`
  }
  if (p.scenario === 'bank-failure' && day === 5) {
    // The deposit insurer guarantees all deposits on Sunday night: the frozen cash comes back on Monday
    cash += frozen
    frozen = 0
    note = 'Deposits are guaranteed: the frozen cash is back, and redemptions reopen'
  }
  const open = !(p.scenario === 'bank-failure' && day >= 2 && day <= 4)
  // Expected recovery per coin: frozen cash counted at half while its fate is unknown
  const reserves = cash + bills + frozen * 0.5
  const backing = supply > 0 ? (p.scenario === 'algorithmic' ? Math.min(1, ((tokenPrice ?? 0) * (tokenSupply ?? 0)) / supply) : reserves / supply) : 1
  // Holders sell more as the backing and yesterday's price slip below $1
  const worry = Math.max(0, 1 - backing) + 0.5 * Math.max(0, 1 - prev.price)
  const shock = p.scenario === 'run' && day >= 2 && day <= 6 ? 0.12 : p.scenario === 'algorithmic' && day >= 2 && day <= 4 ? 0.2 : 0
  const selling = supply * Math.min(0.6, 0.005 + shock + p.panic * worry)
  // Arbitrageurs buy what's sold and redeem it, as far as the issuer can pay today
  const cap = open ? supply * p.capacity : 0
  let redeemed = Math.min(selling, cap)
  let paid = 0
  if (p.scenario === 'algorithmic') {
    // Each coin is redeemed for $1 of newly minted token; the new tokens are sold, pushing the token's price down
    const tp = tokenPrice ?? 1
    const ts = tokenSupply ?? 1
    // At a price of nothing, no amount of new tokens pays a dollar: the supply is left as it is
    const minted = tp > 1e-9 ? redeemed / tp : 0
    tokenSupply = ts + minted
    // Minting new tokens creates no value: the token's market value only falls, with the selling and with confidence in the coin
    const value = tp * ts * Math.exp(-3 * p.panic * (redeemed / Math.max(1e-9, ts * tp)) - p.panic * Math.max(0, 1 - prev.price))
    tokenPrice = value / tokenSupply < 1e-9 ? 0 : value / tokenSupply
    paid = redeemed
    supply -= redeemed
  } else {
    // Cash first, then bills sold (at a fire-sale discount when the day's redemptions run past the cash)
    const fromCash = Math.min(cash, redeemed * (1 - p.fee))
    cash -= fromCash
    paid = fromCash
    let need = redeemed * (1 - p.fee) - fromCash
    if (need > 0) {
      const billsSold = Math.min(bills, need / (1 - p.fireSale))
      bills -= billsSold
      const raised = billsSold * (1 - p.fireSale)
      paid += raised
      need -= raised
      if (need > 1e-9) redeemed = paid / (1 - p.fee)
    }
    supply -= redeemed
  }
  // What the market pays: about $1 less the fee when arbitrage clears the selling, below it by how much selling is left over
  const left = Math.max(0, selling - redeemed)
  const after = supply > 0 ? (p.scenario === 'algorithmic' ? Math.min(1, ((tokenPrice ?? 0) * (tokenSupply ?? 0)) / supply) : (cash + bills + frozen * 0.5) / supply) : 1
  let price = Math.min(1 + p.fee, Math.max(0, Math.min(1, after) - p.fee - 0.25 * (left / Math.max(1, supply))))
  if (left < 1e-9 && after >= 1) price = 1 - p.fee * 0.5
  // Above $1 (it never is here, but the rule is the mirror image): mint and sell
  let minted = 0
  if (price > 1 + p.fee) {
    minted = supply * 0.01
    supply += minted
    cash += minted
    price = 1 + p.fee
  }
  if (!note) note = !open ? 'Redemptions are shut: nothing anchors the price but what holders expect' : left > 0 ? `More selling (${selling.toFixed(0)}m) than the issuer can redeem today (${redeemed.toFixed(0)}m): the price falls` : 'Arbitrage clears the selling: the price holds'
  return { day, supply, cash, bills, frozen, backing: after, price, redeemed, minted, selling, open, ...(p.scenario === 'algorithmic' ? { tokenPrice, tokenSupply } : {}), note }
}

export function startDay(p: StablecoinParams): Day {
  const cash = p.scenario === 'algorithmic' ? 0 : p.supply * p.cashShare
  const bills = p.scenario === 'algorithmic' ? 0 : p.supply - cash
  return {
    day: 0,
    supply: p.supply,
    cash,
    bills,
    frozen: 0,
    backing: 1,
    price: 1,
    redeemed: 0,
    minted: 0,
    selling: 0,
    open: true,
    ...(p.scenario === 'algorithmic' ? { tokenPrice: 3, tokenSupply: p.supply * 0.4 } : {}),
    note: 'Fully backed: every coin has a dollar behind it'
  }
}

export function simulate(p: StablecoinParams): Day[] {
  const out = [startDay(p)]
  for (let i = 0; i < p.days; i++) out.push(stepDay(p, out[out.length - 1]))
  return out
}

/** Minting and redeeming with the issuer, as entries on its balance sheet (millions) */
export function mint(state: { supply: number; cash: number }, dollars: number, fee = 0) {
  const coins = dollars * (1 - fee)
  return { supply: state.supply + coins, cash: state.cash + dollars, coins }
}

export function redeem(state: { supply: number; cash: number }, coins: number, fee = 0) {
  if (coins > state.supply) throw new Error('Cannot redeem more coins than exist')
  const dollars = coins * (1 - fee)
  if (dollars > state.cash) throw new Error('Not enough cash to pay out today')
  return { supply: state.supply - coins, cash: state.cash - dollars, dollars }
}

/** The arbitrage profit per coin of buying at the market price and redeeming at $1 less the fee (negative: no trade) */
export const redeemArbitrage = (price: number, fee: number) => 1 - fee - price

/** The lowest the price falls, the day it gets there, and the first day back within 0.5% of $1 */
export function depegStats(days: Day[]): { low: number; lowDay: number; recovered: number | null } {
  let low = Infinity
  let lowDay = 0
  for (const d of days) if (d.price < low) [low, lowDay] = [d.price, d.day]
  const back = days.find((d) => d.day > lowDay && d.price >= 0.995)
  return { low, lowDay, recovered: back ? back.day : null }
}
