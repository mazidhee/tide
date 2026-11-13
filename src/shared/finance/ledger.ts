/**
 * A double-entry ledger and a small core-banking system on top of it. Every change is a journal
 * entry whose debits equal its credits, so the books always balance: the sum of debit-normal
 * balances equals the sum of credit-normal ones, and the trial balance is zero. Amounts are whole
 * minor units (cents), never floating point, as real ledgers keep them.
 *
 * The bank's own books, as a bank sees them: a customer's deposit is the bank's liability (it owes
 * the money back), a loan is its asset, cash at the central bank (reserves) is its asset.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface Account {
  id: string
  name: string
  type: AccountType
  /** Whose it is, for customer accounts */
  owner?: string
  /** Annual interest rate on the balance (deposits and loans), as a fraction */
  rate?: number
  /** The balance may not go below zero (customer deposits without an overdraft) */
  noOverdraft?: boolean
}

export interface Leg {
  account: string
  /** Minor units; positive */
  amount: number
  side: 'debit' | 'credit'
}

export interface Entry {
  id: number
  /** Business date, YYYY-MM-DD */
  date: string
  memo: string
  legs: Leg[]
}

/** Debit-normal accounts grow with debits; the others with credits */
export const debitNormal = (t: AccountType) => t === 'asset' || t === 'expense'

export class LedgerError extends Error {}

export class Ledger {
  readonly accounts = new Map<string, Account>()
  readonly entries: Entry[] = []
  private balances = new Map<string, number>()

  open(a: Account): Account {
    if (this.accounts.has(a.id)) throw new LedgerError(`Account ${a.id} already exists`)
    this.accounts.set(a.id, a)
    this.balances.set(a.id, 0)
    return a
  }

  /** The balance in the account's normal direction (a deposit of 100 shows +100 on the liability) */
  balance(id: string): number {
    const b = this.balances.get(id)
    if (b === undefined) throw new LedgerError(`No account ${id}`)
    return b
  }

  /**
   * Posts an entry. Refused, with nothing changed, when it doesn't balance, names an unknown
   * account, has a non-whole or non-positive amount, or would overdraw a no-overdraft account.
   */
  post(date: string, memo: string, legs: Leg[]): Entry {
    if (legs.length < 2) throw new LedgerError('An entry needs at least two legs')
    let dr = 0
    let cr = 0
    for (const l of legs) {
      if (!this.accounts.has(l.account)) throw new LedgerError(`No account ${l.account}`)
      if (!Number.isInteger(l.amount) || l.amount <= 0) throw new LedgerError(`Amounts are whole minor units above zero (got ${l.amount})`)
      if (l.side === 'debit') dr += l.amount
      else cr += l.amount
    }
    if (dr !== cr) throw new LedgerError(`Debits (${dr}) don't equal credits (${cr})`)
    const next = new Map<string, number>()
    for (const l of legs) {
      const a = this.accounts.get(l.account)!
      const sign = (l.side === 'debit') === debitNormal(a.type) ? 1 : -1
      next.set(l.account, (next.get(l.account) ?? this.balance(l.account)) + sign * l.amount)
    }
    for (const [id, b] of next) if (b < 0 && this.accounts.get(id)!.noOverdraft) throw new LedgerError(`Insufficient funds in ${this.accounts.get(id)!.name}`)
    for (const [id, b] of next) this.balances.set(id, b)
    const e: Entry = { id: this.entries.length + 1, date, memo, legs: legs.map((l) => ({ ...l })) }
    this.entries.push(e)
    return e
  }

  /** Debits and credits by account, and their totals (equal when the books balance) */
  trialBalance(): { rows: { account: string; name: string; debit: number; credit: number }[]; debits: number; credits: number } {
    const rows = [...this.accounts.values()].map((a) => {
      const b = this.balance(a.id)
      const dr = debitNormal(a.type) ? b : -b
      return { account: a.id, name: a.name, debit: dr > 0 ? dr : 0, credit: dr < 0 ? -dr : 0 }
    })
    return { rows, debits: rows.reduce((s, r) => s + r.debit, 0), credits: rows.reduce((s, r) => s + r.credit, 0) }
  }

  /** Assets = liabilities + equity + (income − expenses), the accounting equation before closing */
  equation(): { assets: number; liabilities: number; equity: number; income: number; expenses: number; holds: boolean } {
    const sum = (t: AccountType) => [...this.accounts.values()].filter((a) => a.type === t).reduce((s, a) => s + this.balance(a.id), 0)
    const [assets, liabilities, equity, income, expenses] = (['asset', 'liability', 'equity', 'income', 'expense'] as const).map(sum)
    return { assets, liabilities, equity, income, expenses, holds: assets === liabilities + equity + income - expenses }
  }

  /** Replays the journal from zero: the balances it gives must be the ones held */
  replayMatches(): boolean {
    const again = new Map<string, number>([...this.accounts.keys()].map((k) => [k, 0]))
    for (const e of this.entries)
      for (const l of e.legs) {
        const a = this.accounts.get(l.account)!
        again.set(l.account, again.get(l.account)! + ((l.side === 'debit') === debitNormal(a.type) ? 1 : -1) * l.amount)
      }
    return [...again].every(([k, v]) => v === this.balances.get(k))
  }
}

// ---------- A core-banking system ----------

/** Rounds half to even, as banks do for interest (banker's rounding) */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1
  return Math.round(x)
}

/** Interest for one day on a balance (minor units) at an annual rate, actual/365 */
export const dailyInterest = (balance: number, rate: number, basis = 365) => roundHalfEven((balance * rate) / basis)

export interface CoreBankOptions {
  /** Shareholders' capital paid in at the start, minor units */
  capital?: number
  date?: string
}

/**
 * A bank's core: customer deposit accounts and loans over its general ledger. Each operation is
 * one balanced entry. End of day accrues interest on every deposit (an expense to the bank,
 * credited to an accrual it pays out at month end) and every loan (income, debited to an interest
 * receivable), as a real core does in its batch run.
 */
export class CoreBank {
  readonly gl = new Ledger()
  date: string
  private n = 0

  constructor(o: CoreBankOptions = {}) {
    this.date = o.date ?? '2026-01-01'
    const open = (id: string, name: string, type: AccountType) => this.gl.open({ id, name, type })
    open('reserves', 'Reserves at the central bank', 'asset')
    open('cash', 'Cash in the vault', 'asset')
    open('loans', 'Loans to customers', 'asset')
    open('interest-receivable', 'Interest receivable', 'asset')
    open('interest-payable', 'Interest payable', 'liability')
    open('suspense', 'Suspense (unreconciled)', 'liability')
    open('capital', 'Share capital', 'equity')
    open('interest-income', 'Interest income', 'income')
    open('fee-income', 'Fee income', 'income')
    open('interest-expense', 'Interest expense', 'expense')
    if (o.capital) this.gl.post(this.date, 'Capital paid in', [debit('reserves', o.capital), credit('capital', o.capital)])
  }

  /** Opens a customer's deposit account (a liability of the bank) */
  openDeposit(owner: string, rate = 0): string {
    const id = `dep-${++this.n}`
    this.gl.open({ id, name: `${owner}'s current account`, type: 'liability', owner, rate, noOverdraft: true })
    return id
  }

  /** Cash paid in over the counter: the vault's cash up, the customer's balance (what the bank owes) up */
  depositCash(account: string, amount: number) {
    return this.gl.post(this.date, 'Cash deposit', [debit('cash', amount), credit(account, amount)])
  }

  withdrawCash(account: string, amount: number) {
    return this.gl.post(this.date, 'Cash withdrawal', [debit(account, amount), credit('cash', amount)])
  }

  /** A transfer between two customers of this bank: only the bank's own liabilities move ("on us") */
  transfer(from: string, to: string, amount: number, fee = 0) {
    const legs: Leg[] = [debit(from, amount + fee), credit(to, amount)]
    if (fee) legs.push(credit('fee-income', fee))
    return this.gl.post(this.date, 'Transfer', legs)
  }

  /** A payment leaving for another bank: the customer's balance down, and reserves leave in settlement */
  payOut(from: string, amount: number) {
    return this.gl.post(this.date, 'Outgoing payment (settled in reserves)', [debit(from, amount), credit('reserves', amount)])
  }

  /** A payment arriving from another bank */
  payIn(to: string, amount: number) {
    return this.gl.post(this.date, 'Incoming payment (settled in reserves)', [debit('reserves', amount), credit(to, amount)])
  }

  /**
   * A loan paid out into the borrower's account: the bank's asset (the loan) and its liability
   * (the new deposit) grow together. That is how lending creates deposits.
   */
  disburseLoan(account: string, amount: number, rate: number): string {
    const id = `loan-${++this.n}`
    const owner = this.gl.accounts.get(account)?.owner ?? 'customer'
    this.gl.open({ id, name: `${owner}'s loan`, type: 'asset', owner, rate })
    this.gl.post(this.date, 'Loan disbursed', [debit(id, amount), credit(account, amount)])
    return id
  }

  repayLoan(account: string, loan: string, amount: number) {
    return this.gl.post(this.date, 'Loan repayment', [debit(account, amount), credit(loan, amount)])
  }

  chargeFee(account: string, amount: number, memo = 'Monthly fee') {
    return this.gl.post(this.date, memo, [debit(account, amount), credit('fee-income', amount)])
  }

  /** End of day: accrue a day's interest on every deposit and loan with a rate, then move to the next date */
  endOfDay(): { accruedPayable: number; accruedReceivable: number } {
    let payable = 0
    let receivable = 0
    for (const a of this.gl.accounts.values()) {
      if (!a.rate || !a.owner) continue
      const amt = dailyInterest(this.gl.balance(a.id), a.rate)
      if (amt <= 0) continue
      if (a.type === 'liability') {
        this.gl.post(this.date, `Interest accrued on ${a.name}`, [debit('interest-expense', amt), credit('interest-payable', amt)])
        payable += amt
      } else if (a.type === 'asset') {
        this.gl.post(this.date, `Interest accrued on ${a.name}`, [debit('interest-receivable', amt), credit('interest-income', amt)])
        receivable += amt
      }
    }
    const d = new Date(`${this.date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    this.date = d.toISOString().slice(0, 10)
    return { accruedPayable: payable, accruedReceivable: receivable }
  }

  /** Customers' deposits: what the bank owes them in total */
  deposits(): number {
    return [...this.gl.accounts.values()].filter((a) => a.type === 'liability' && a.owner).reduce((s, a) => s + this.gl.balance(a.id), 0)
  }

  /** Reserves and cash as a share of deposits */
  liquidityRatio(): number {
    const d = this.deposits()
    return d ? (this.gl.balance('reserves') + this.gl.balance('cash')) / d : Infinity
  }
}

export const debit = (account: string, amount: number): Leg => ({ account, amount, side: 'debit' })
export const credit = (account: string, amount: number): Leg => ({ account, amount, side: 'credit' })

/** Minor units as money: 123456 → "1,234.56" */
export const money = (minor: number, currency = '') => `${minor < 0 ? '−' : ''}${currency}${(Math.abs(minor) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
