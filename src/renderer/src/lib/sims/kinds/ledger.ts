/**
 * A bank's books, live: post deposits, transfers, loans and fees as balanced journal entries, run
 * end of day, and watch the balance sheet, the journal and the trial balance. An unbalanced entry
 * is refused whole. The model is shared/finance/ledger (CoreBank over a double-entry Ledger).
 */
import { CoreBank, LedgerError, debit, money, type Entry } from '@shared/finance/ledger'
import { button, h, ring, selectField, stat } from '../dom'
import { ledgerOp, type LedgerOp, type LedgerSpec } from '../finance'
import type { PartInfo } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../specUtil'

const OPS = [
  ['deposit', 'Deposit cash'],
  ['withdraw', 'Withdraw cash'],
  ['transfer', 'Transfer'],
  ['loan', 'Lend'],
  ['repay', 'Repay loan'],
  ['fee', 'Charge a fee'],
  ['payout', 'Pay another bank'],
  ['payin', 'Receive from another bank']
] as const

const usd = (minor: number) => money(minor, '$')

function create(spec: LedgerSpec, host: SimHost): SimView {
  let bank = new CoreBank({ capital: spec.capital })
  let deposits = new Map<string, string>()
  let loans = new Map<string, string>()
  let queue: LedgerOp[] = []
  let message = ''
  let refused = false

  const start = () => {
    bank = new CoreBank({ capital: spec.capital })
    deposits = new Map(spec.customers.map((c) => [c, bank.openDeposit(c, 0.02)]))
    loans = new Map()
    queue = [...spec.ops]
    message = spec.ops.length ? 'Press Step to post the next operation, or post your own above.' : 'Post an operation above.'
    refused = false
  }
  start()

  const dep = (who: string) => {
    let id = deposits.get(who)
    if (!id) {
      id = bank.openDeposit(who || 'Customer', 0.02)
      deposits.set(who, id)
    }
    return id
  }

  /** Applies one operation; a refusal is reported, never thrown */
  function apply(op: LedgerOp): void {
    try {
      refused = false
      switch (op.op) {
        case 'deposit':
          bank.depositCash(dep(op.who), op.amount)
          message = `${op.who} pays in ${usd(op.amount)}: cash (an asset) and ${op.who}'s deposit (what the bank owes) both grow.`
          break
        case 'withdraw':
          bank.withdrawCash(dep(op.who), op.amount)
          message = `${op.who} takes out ${usd(op.amount)}: both sides shrink.`
          break
        case 'transfer':
          bank.transfer(dep(op.from), dep(op.to), op.amount)
          message = `${op.from} pays ${op.to} ${usd(op.amount)} on us: only the bank's own liabilities move; no cash or reserves do.`
          break
        case 'loan': {
          const id = bank.disburseLoan(dep(op.who), op.amount, op.rate)
          loans.set(op.who, id)
          message = `A ${usd(op.amount)} loan to ${op.who}: a new asset and a new deposit, created together. Lending creates deposits.`
          break
        }
        case 'repay': {
          const loan = loans.get(op.who)
          if (!loan) throw new LedgerError(`${op.who} has no loan to repay`)
          bank.repayLoan(dep(op.who), loan, Math.min(op.amount, bank.gl.balance(loan)))
          message = `${op.who} repays: the loan and the deposit shrink together, and that money is gone from the system.`
          break
        }
        case 'fee':
          bank.chargeFee(dep(op.who), op.amount)
          message = `A ${usd(op.amount)} fee: ${op.who}'s deposit falls and the bank's income rises (equity, before the books close).`
          break
        case 'payout':
          bank.payOut(dep(op.who), op.amount)
          message = `${op.who} pays ${usd(op.amount)} to another bank: the deposit falls and reserves leave in settlement.`
          break
        case 'payin':
          bank.payIn(dep(op.who), op.amount)
          message = `${usd(op.amount)} arrives for ${op.who} from another bank: reserves and the deposit both grow.`
          break
        case 'eod':
          for (let i = 0; i < op.days; i++) bank.endOfDay()
          message = `End of day: interest accrued on every deposit (an expense) and loan (income). Now ${bank.date}.`
          break
        case 'broken':
          bank.gl.post(bank.date, 'A broken entry', [debit('cash', 1000), { account: dep(spec.customers[0]), amount: 900, side: 'credit' }])
          break
      }
    } catch (e) {
      refused = true
      message = `Refused: ${(e as Error).message}. Nothing was posted: an entry goes in whole or not at all.`
    }
  }

  // ---------- Controls ----------
  let opName: (typeof OPS)[number][0] = 'deposit'
  const whoOptions = () => spec.customers.map((c) => [c, c] as const)
  const opField = selectField('Operation', OPS, opName, (v) => {
    opName = v
    toField.el.hidden = v !== 'transfer'
  })
  const whoField = selectField('Customer', whoOptions(), spec.customers[0], () => {})
  const toField = selectField('To', whoOptions(), spec.customers[1] ?? spec.customers[0], () => {})
  toField.el.hidden = true
  const amountInput = h('input', { class: 'sim-input sim-led-amount', type: 'number', min: 1, step: 'any', value: 100, 'aria-label': 'Amount in dollars' })
  const post = button('Post', () => {
    const amount = Number(amountInput.value)
    if (!(amount > 0)) {
      amountInput.classList.add('bad')
      return
    }
    amountInput.classList.remove('bad')
    const who = (whoField.input as HTMLSelectElement).value
    const to = (toField.input as HTMLSelectElement).value
    const raw = opName === 'transfer' ? { transfer: [who, to, amount] } : opName === 'loan' ? { loan: [who, amount, 0.06] } : { [opName]: [who, amount] }
    const op = ledgerOp(raw)
    if (op) apply(op)
    host.invalidate()
  }, 'primary')
  const eod = button('End of day', () => {
    apply({ op: 'eod', days: 1 })
    host.invalidate()
  })
  const broken = button('Try an unbalanced entry', () => {
    apply({ op: 'broken' })
    host.invalidate()
  }, 'quiet')
  const params = h('div', { class: 'sim-params sim-led-params' }, opField.el, whoField.el, toField.el, h('label', { class: 'sim-field' }, h('span', { class: 'sim-label' }, 'Amount ($)'), amountInput), post, eod, broken)

  // ---------- The books ----------
  const assets = h('div', { class: 'sim-led-side' })
  const claims = h('div', { class: 'sim-led-side' })
  const sheet = h('div', { class: 'sim-panel sim-led-sheet sim-part', tabindex: 0, role: 'button' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Balance sheet'), h('span', null, 'what the bank owns · what it owes and its equity')), h('div', { class: 'sim-led-cols' }, assets, claims))
  sheet.addEventListener('click', (e) => (e.target as HTMLElement).closest('[data-part]') || host.select('balance-sheet'))
  const journalList = h('ol', { class: 'sim-led-journal' })
  const journal = h('div', { class: 'sim-panel sim-led-journal-panel' }, h('div', { class: 'sim-panel-title' }, h('button', { type: 'button', class: 'sim-part sim-led-link' }, 'Journal'), h('span', null, 'newest first')), journalList)
  journal.querySelector('.sim-led-link')!.addEventListener('click', () => host.select('journal'))
  const stats = { debits: stat('Total debits'), credits: stat('Total credits'), equation: stat('Assets = liabilities + equity'), liquidity: stat('Cash and reserves ÷ deposits') }
  const tb = h('button', { type: 'button', class: 'sim-part sim-stats sim-led-tb' }, stats.debits.el, stats.credits.el)
  tb.addEventListener('click', () => host.select('trial-balance'))
  const eq = h('button', { type: 'button', class: 'sim-part sim-stats sim-led-eq' }, stats.equation.el, stats.liquidity.el)
  eq.addEventListener('click', () => host.select('equation'))
  const note = h('p', { class: 'sim-note sim-led-msg', 'aria-live': 'polite' })
  const el = h('div', { class: 'sim-led' }, params, h('div', { class: 'sim-two' }, h('div', { class: 'sim-stack' }, sheet, h('div', { class: 'sim-led-foot' }, tb, eq)), journal), note)

  const rows = new Map<string, HTMLElement>()
  function accountRow(id: string): HTMLElement {
    const a = bank.gl.accounts.get(id)!
    let row = rows.get(id)
    if (!row) {
      row = h('button', { type: 'button', class: 'sim-part sim-led-row', 'data-part': `account:${id}` }, h('span', { class: 'sim-led-name' }), h('span', { class: 'sim-led-amt' }))
      row.addEventListener('click', () => host.select(`account:${id}`))
      rows.set(id, row)
    }
    row.querySelector('.sim-led-name')!.textContent = a.name
    row.querySelector('.sim-led-amt')!.textContent = usd(bank.gl.balance(id))
    return row
  }

  function entryText(e: Entry): HTMLElement {
    const legs = e.legs.map((l) => h('div', { class: `sim-led-leg ${l.side}` }, h('span', null, l.side === 'debit' ? 'Dr' : 'Cr'), h('span', null, bank.gl.accounts.get(l.account)?.name ?? l.account), h('span', { class: 'sim-led-amt' }, usd(l.amount))))
    const li = h('li', { class: 'sim-part', tabindex: 0, 'data-part': `entry:${e.id}` }, h('div', { class: 'sim-led-memo' }, h('b', null, `#${e.id}`), ` ${e.memo}`), ...legs)
    li.addEventListener('click', () => host.select(`entry:${e.id}`))
    return li
  }

  const accountId = (name: string): string | null => {
    const n = name.toLowerCase()
    if (bank.gl.accounts.has(n)) return n
    const d = [...deposits].find(([c]) => c.toLowerCase() === n)?.[1]
    return d ?? null
  }

  const total = (type: string) => [...bank.gl.accounts.values()].filter((a) => a.type === type).reduce((s, a) => s + bank.gl.balance(a.id), 0)

  function describe(part: string): PartInfo | null {
    const [head, arg] = part.split(':')
    const eqn = bank.gl.equation()
    if (head === 'account' && arg) {
      const id = accountId(arg)
      const a = id ? bank.gl.accounts.get(id) : undefined
      if (!a) return null
      return { label: a.name, values: { balance: usd(bank.gl.balance(a.id)), type: a.type, 'grows with': a.type === 'asset' || a.type === 'expense' ? 'debits' : 'credits', ...(a.rate ? { rate: `${(a.rate * 100).toFixed(2)}%` } : {}) } }
    }
    if (head === 'entry' && arg) {
      const e = bank.gl.entries[Number(arg) - 1]
      if (!e) return null
      const dr = e.legs.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
      return { label: `entry ${e.id}: ${e.memo}`, values: { debits: usd(dr), credits: usd(e.legs.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0)), legs: e.legs.length, date: e.date } }
    }
    if (part === 'balance-sheet') return { label: 'the balance sheet', values: { assets: usd(eqn.assets), liabilities: usd(eqn.liabilities), equity: usd(eqn.equity + eqn.income - eqn.expenses) } }
    if (part === 'journal') return { label: 'the journal', values: { entries: bank.gl.entries.length, 'replays to the same balances': bank.gl.replayMatches() ? 'yes' : 'no' } }
    if (part === 'trial-balance') {
      const t = bank.gl.trialBalance()
      return { label: 'the trial balance', values: { debits: usd(t.debits), credits: usd(t.credits), difference: usd(t.debits - t.credits) } }
    }
    if (part === 'equation') return { label: 'the accounting equation', values: { assets: usd(eqn.assets), 'liabilities + equity': usd(eqn.liabilities + eqn.equity + eqn.income - eqn.expenses), holds: eqn.holds ? 'yes' : 'no' } }
    return null
  }

  return {
    el,
    step() {
      const op = queue.shift()
      if (op) apply(op)
    },
    reset() {
      rows.clear()
      start()
    },
    stepsPerSecond: () => 1,
    done: () => (queue.length ? null : spec.ops.length ? 'Every operation is posted' : null),
    draw() {
      const a = [...bank.gl.accounts.values()].filter((x) => x.type === 'asset')
      const l = [...bank.gl.accounts.values()].filter((x) => x.type === 'liability' || x.type === 'equity')
      const keep = (x: { id: string }) => bank.gl.balance(x.id) !== 0 || x.id === 'reserves' || x.id === 'cash' || x.id === 'capital' || x.id.startsWith('dep-')
      const eqn = bank.gl.equation()
      assets.replaceChildren(h('div', { class: 'sim-led-head' }, 'Assets'), ...a.filter(keep).map((x) => accountRow(x.id)), h('div', { class: 'sim-led-total' }, h('span', null, 'Total'), h('span', { class: 'sim-led-amt' }, usd(eqn.assets))))
      const retained = eqn.income - eqn.expenses
      claims.replaceChildren(
        h('div', { class: 'sim-led-head' }, 'Liabilities and equity'),
        ...l.filter(keep).map((x) => accountRow(x.id)),
        retained ? h('div', { class: 'sim-led-row static' }, h('span', { class: 'sim-led-name' }, 'Profit this period (income − expenses)'), h('span', { class: 'sim-led-amt' }, usd(retained))) : '',
        h('div', { class: 'sim-led-total' }, h('span', null, 'Total'), h('span', { class: 'sim-led-amt' }, usd(eqn.liabilities + eqn.equity + retained)))
      )
      journalList.replaceChildren(...bank.gl.entries.slice(-6).reverse().map(entryText))
      const t = bank.gl.trialBalance()
      stats.debits.set(usd(t.debits))
      stats.credits.set(usd(t.credits))
      stats.equation.set(eqn.holds ? 'Holds' : 'Broken')
      const lr = bank.liquidityRatio()
      stats.liquidity.set(Number.isFinite(lr) ? `${(lr * 100).toFixed(0)}%` : '–')
      note.textContent = message
      note.classList.toggle('bad', refused)
    },
    describe,
    highlight(part) {
      for (const [id, row] of rows) ring(row, part === `account:${id}` || (!!part && accountId(part.split(':')[1] ?? '') === id && part.startsWith('account:')))
      ring(sheet, part === 'balance-sheet')
      ring(journal, part === 'journal')
      ring(tb, part === 'trial-balance')
      ring(eq, part === 'equation')
      journalList.querySelectorAll<HTMLElement>('li').forEach((li) => ring(li, li.dataset.part === part))
    },
    act(action: TourAction) {
      const op = ledgerOp(action as Record<string, unknown>)
      if (op) apply(op)
    }
  }
}

export const ledgerKind: SimKindDef<LedgerSpec> = {
  label: 'Double-entry ledger',
  transport: true,
  autoplay: () => false,
  create
}
