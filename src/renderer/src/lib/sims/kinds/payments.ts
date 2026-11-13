/**
 * Money between banks, five ways: RTGS (gross, in real time, queued when reserves run short), end-
 * of-day multilateral netting, prefunded instant payments, a card purchase from authorisation to
 * the merchant's payout, and the same payment as ISO 20022 messages (pain.001, pacs.008, camt.053)
 * with a field to break and a gateway's checks. Every number comes from shared/finance.
 */
import { EXAMPLE_PARTIES, camt053, pacs008, pain001, readMessage, type Transfer } from '@shared/finance/iso20022'
import { cardPurchase, dnsWithFailure, instant, multilateralNet, nettingSummary, rtgs, type Payment } from '@shared/finance/settlement'
import { button, h, ring, segmented, selectField, stat } from '../dom'
import { BREAKS, MODES, type IsoBreak, type PaymentsMode, type PaymentsSpec } from '../finance'
import type { PartInfo } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { TourAction } from '../specUtil'

const MODE_LABEL: Record<PaymentsMode, string> = { rtgs: 'RTGS', net: 'Net', instant: 'Instant', card: 'Card', iso20022: 'ISO 20022' }
const BREAK_LABEL: Record<IsoBreak, string> = { none: 'Nothing broken', iban: 'A wrong IBAN check digit', bic: 'A malformed BIC', sum: 'A control sum that doesn’t add up', decimals: 'Three decimals on euros', count: 'NbOfTxs off by one' }
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const eur = (minor: number) => `€${(minor / 100).toFixed(2)}`

/** The ISO 20022 journey of the first payment: Ada pays Bo, Ada's bank to Bo's, Bo's statement */
function isoMessages(amountMinor: number, broken: IsoBreak): { name: string; from: string; to: string; xml: string }[] {
  const tx: Transfer = { endToEndId: 'E2E-2026-0001', amount: amountMinor, currency: 'EUR', debtor: EXAMPLE_PARTIES.ada, creditor: EXAMPLE_PARTIES.bo, remittance: 'Invoice 77' }
  let pain = pain001('ADA-20260302-1', '2026-03-02T09:30:00', [tx])
  let pacs = pacs008('COBA-20260302-0042', '2026-03-02T09:31:10', '2026-03-02', [tx])
  const camt = camt053('BNPA-STMT-0302', '2026-03-02T23:59:00', { iban: tx.creditor.iban, currency: 'EUR', owner: tx.creditor.name }, 125_000, [{ amount: amountMinor, side: 'CRDT', bookingDate: '2026-03-02', endToEndId: tx.endToEndId, info: 'Invoice 77' }])
  const breakIt = (xml: string) => {
    switch (broken) {
      case 'iban':
        return xml.replace(tx.creditor.iban, tx.creditor.iban.slice(0, 2) + String((Number(tx.creditor.iban.slice(2, 4)) + 1) % 100).padStart(2, '0') + tx.creditor.iban.slice(4))
      case 'bic':
        return xml.replace(`<BICFI>${tx.creditor.bic}</BICFI>`, '<BICFI>BNP-FR-PP</BICFI>')
      case 'sum':
        return xml.replace(/<(CtrlSum|TtlIntrBkSttlmAmt)([^>]*)>([\d.]+)</, (_, tag, attrs, v) => `<${tag}${attrs}>${(Number(v) + 10).toFixed(2)}<`)
      case 'decimals':
        return xml.replace(/(<(?:InstdAmt|IntrBkSttlmAmt) Ccy="EUR">)([\d.]+)</, (_, open, v) => `${open}${Number(v).toFixed(3)}<`)
      case 'count':
        return xml.replace(/<NbOfTxs>(\d+)</, (_, n) => `<NbOfTxs>${Number(n) + 1}<`)
      default:
        return xml
    }
  }
  pain = breakIt(pain)
  pacs = breakIt(pacs)
  return [
    { name: 'pain.001', from: 'Ada', to: 'Ada’s bank (COBADEFF)', xml: pain },
    { name: 'pacs.008', from: 'Ada’s bank', to: 'Bo’s bank (BNPAFRPP)', xml: pacs },
    { name: 'camt.053', from: 'Bo’s bank', to: 'Bo', xml: camt }
  ]
}

function create(spec: PaymentsSpec, host: SimHost): SimView {
  let mode = spec.mode
  let opening = { ...spec.banks }
  let sent: Payment[] = []
  let cursor = 0
  let settledNet = false
  let cardAt = 0
  let isoAt = 0
  let broken = spec.break
  const banks = () => Object.keys(opening)

  const start = () => {
    opening = { ...spec.banks }
    sent = []
    cursor = 0
    settledNet = false
    cardAt = 0
    isoAt = 0
    broken = spec.break
  }
  const toPayment = (p: [string, string, number], i: number): Payment => ({ id: `p${i + 1}`, from: p[0], to: p[1], amount: p[2] })
  const submitNext = () => {
    if (cursor < spec.payments.length) sent.push(toPayment(spec.payments[cursor], cursor++))
  }

  const gross = () => rtgs(opening, sent)
  const inst = () => instant(opening, sent, spec.limit)
  const card = () => cardPurchase(spec.amount)
  const iso = () => isoMessages(Math.round((spec.payments[0]?.[2] ?? 125.5) * 100), broken)

  // ---------- Controls ----------
  const modeField = segmented('Settlement', MODES.map((m) => [m, MODE_LABEL[m]] as const), mode, (v) => {
    mode = v
    host.invalidate()
  })
  const fromField = selectField('From', banks().map((b) => [b, b] as const), banks()[0], () => {})
  const toField = selectField('To', banks().map((b) => [b, b] as const), banks()[1], () => {})
  const amt = h('input', { class: 'sim-input sim-pay-amount', type: 'number', min: 1, step: 'any', value: 20, 'aria-label': 'Amount' })
  const sendBtn = button('Send', () => {
    const [f, t, a] = [(fromField.input as HTMLSelectElement).value, (toField.input as HTMLSelectElement).value, Number(amt.value)]
    if (f !== t && a > 0) sent.push({ id: `p${sent.length + 1}`, from: f, to: t, amount: a })
    settledNet = false
    host.invalidate()
  }, 'primary')
  const fundBtn = button('Add reserves', () => {
    const f = (fromField.input as HTMLSelectElement).value
    opening[f] = (opening[f] ?? 0) + Math.max(0, Number(amt.value) || 0)
    host.invalidate()
  })
  fundBtn.title = 'Give the sending bank this much more central-bank money (intraday credit)'
  const settleBtn = button('Settle the batch', () => {
    settledNet = true
    host.invalidate()
  })
  const breakField = selectField('Break', BREAKS.map((b) => [b, BREAK_LABEL[b]] as const), broken, (v) => {
    broken = v
    host.invalidate()
  })
  const sendRow = h('div', { class: 'sim-inline sim-pay-send' }, fromField.el, toField.el, h('label', { class: 'sim-field' }, h('span', { class: 'sim-label' }, 'Amount'), amt), sendBtn, fundBtn, settleBtn)
  const params = h('div', { class: 'sim-params sim-pay-params' }, modeField.el, sendRow, breakField.el)

  // ---------- Picture ----------
  const bankRow = h('div', { class: 'sim-pay-banks' })
  const list = h('ol', { class: 'sim-pay-list' })
  const stats = { gross: stat('Gross'), net: stat('Multilateral net'), saving: stat('Liquidity saved'), queue: stat('Queued') }
  const statEls = { gross: stats.gross.el, net: stats.net.el, saving: stats.saving.el, queue: stats.queue.el }
  for (const [k, e] of Object.entries(statEls)) {
    e.classList.add('sim-part')
    e.tabIndex = 0
    e.addEventListener('click', () => host.select(k))
  }
  const statRow = h('div', { class: 'sim-stats' }, ...Object.values(statEls))
  const flow = h('ol', { class: 'sim-pay-flow' })
  const note = h('p', { class: 'sim-note', 'aria-live': 'polite' })
  const body = h('div', { class: 'sim-pay-body' })
  const el = h('div', { class: 'sim-pay' }, params, body, note)

  const bankCards = new Map<string, HTMLElement>()
  function bankCard(b: string, value: string, sub: string, tone: '' | 'pos' | 'neg'): HTMLElement {
    let c = bankCards.get(b)
    if (!c) {
      c = h('button', { type: 'button', class: 'sim-part sim-pay-bank', 'data-part': `bank:${b}` }, h('span', { class: 'sim-pay-bank-name' }, `Bank ${b}`), h('span', { class: 'sim-pay-bank-value' }), h('span', { class: 'sim-pay-bank-sub' }))
      c.addEventListener('click', () => host.select(`bank:${b}`))
      bankCards.set(b, c)
    }
    c.querySelector('.sim-pay-bank-value')!.textContent = value
    const s = c.querySelector('.sim-pay-bank-sub')!
    s.textContent = sub
    s.className = `sim-pay-bank-sub ${tone}`
    return c
  }

  function paymentStatus(i: number): { text: string; tone: string } {
    const p = sent[i]
    if (!p) return { text: 'not sent', tone: '' }
    if (mode === 'rtgs') {
      const r = gross()
      const at = r.settled.findIndex((s) => s.id === p.id)
      return at >= 0 ? { text: `settled (${at + 1})`, tone: 'pos' } : { text: 'queued', tone: 'neg' }
    }
    if (mode === 'instant') {
      const r = inst()
      if (r.accepted.includes(p.id)) return { text: 'settled at once', tone: 'pos' }
      return { text: `rejected: ${r.rejected.find((x) => x.id === p.id)?.why ?? ''}`, tone: 'bad' }
    }
    if (mode === 'net') {
      if (!settledNet) return { text: 'in the batch', tone: '' }
      const r = dnsWithFailure(opening, sent)
      return r.unwound.includes(p.id) ? { text: 'unwound', tone: 'bad' } : { text: 'settled net', tone: 'pos' }
    }
    return { text: '', tone: '' }
  }

  function describe(part: string): PartInfo | null {
    const [head, arg] = part.split(':')
    const net = multilateralNet(sent)
    const ns = nettingSummary(sent)
    if (head === 'bank' && arg && arg in opening) {
      const r = gross()
      return { label: `bank ${arg}`, values: { 'opening reserves': fmt(opening[arg]), 'after RTGS': fmt(r.balances[arg] ?? opening[arg]), 'net position': fmt(net[arg] ?? 0), 'after instant': fmt(inst().positions[arg] ?? opening[arg]) } }
    }
    if (head === 'payment' && arg) {
      const i = Number(arg) - 1
      const p = sent[i] ?? (spec.payments[i] ? toPayment(spec.payments[i], i) : null)
      if (!p) return null
      return { label: `payment ${arg}: ${p.from} pays ${p.to}`, values: { amount: fmt(p.amount), status: paymentStatus(i).text || 'not sent', mode: MODE_LABEL[mode] } }
    }
    if (part === 'queue') {
      const r = gross()
      return { label: 'the RTGS queue', values: { queued: r.queued.length, 'waiting value': fmt(sent.filter((p) => r.queued.includes(p.id)).reduce((s, p) => s + p.amount, 0)), gridlock: r.queued.length && r.queued.length === sent.length ? 'yes' : 'no' } }
    }
    if (part === 'net') return { label: 'multilateral net positions (received − sent)', values: Object.fromEntries(banks().map((b) => [b, fmt(net[b] ?? 0)])) }
    if (part === 'gross') return { label: 'gross settlement', values: { 'total sent': fmt(ns.gross), payments: sent.length } }
    if (part === 'saving') return { label: 'liquidity saved by netting', values: { gross: fmt(ns.gross), bilateral: fmt(ns.bilateral), multilateral: fmt(ns.multilateral), saved: `${(ns.saving * 100).toFixed(0)}%` } }
    if (head === 'step' && arg) {
      const s = card().steps[Number(arg) - 1]
      return s ? { label: `${s.at}: ${s.from} → ${s.to}`, values: { what: s.what, ...(s.amount !== undefined ? { amount: eur(s.amount) } : {}) } } : null
    }
    if (part === 'field') return { label: 'the broken field', values: { broken: BREAK_LABEL[broken] } }
    if (part === 'problems') {
      const found = iso().map((m) => readMessage(m.xml)).flatMap((r) => ('problems' in r ? r.problems : []))
      return { label: 'what the gateway finds', values: { problems: found.length, first: found[0] ? `${found[0].at}: ${found[0].message}` : 'none' } }
    }
    return null
  }

  return {
    el,
    stepsPerSecond: () => 1.5,
    step() {
      if (mode === 'card') cardAt = Math.min(card().steps.length, cardAt + 1)
      else if (mode === 'iso20022') isoAt = (isoAt + 1) % 3
      else submitNext()
    },
    done: () => (mode === 'card' ? (cardAt >= card().steps.length ? 'The merchant is paid' : null) : mode === 'iso20022' ? null : cursor >= spec.payments.length ? 'Every payment is sent' : null),
    reset() {
      start()
      breakField.set(broken)
    },
    draw() {
      modeField.set(mode)
      sendRow.hidden = mode === 'card' || mode === 'iso20022'
      settleBtn.hidden = mode !== 'net'
      breakField.el.hidden = mode !== 'iso20022'
      statRow.hidden = mode === 'card' || mode === 'iso20022'
      statEls.queue.hidden = mode !== 'rtgs'
      const net = multilateralNet(sent)
      const ns = nettingSummary(sent)
      const r = gross()
      stats.gross.set(fmt(ns.gross))
      stats.net.set(fmt(ns.multilateral))
      stats.saving.set(`${(ns.saving * 100).toFixed(0)}%`)
      stats.queue.set(String(r.queued.length))
      if (mode === 'card') {
        const c = card()
        flow.replaceChildren(
          ...c.steps.map((s, i) => {
            const li = h('li', { class: `sim-part sim-pay-step${i < cardAt ? ' on' : ''}`, tabindex: 0, 'data-part': `step:${i + 1}` }, h('span', { class: 'sim-pay-when' }, s.at), h('span', { class: 'sim-pay-who' }, `${s.from} → ${s.to}`), h('span', null, s.what), h('span', { class: 'sim-pay-money' }, s.amount !== undefined ? eur(s.amount) : ''))
            li.addEventListener('click', () => host.select(`step:${i + 1}`))
            return li
          })
        )
        const shares = h('div', { class: 'sim-stats' }, ...[['Merchant gets', c.merchantGets], ['Issuer (interchange)', c.issuerGets], ['Scheme', c.schemeGets], ['Acquirer', c.acquirerGets]].map(([l, v]) => {
          const s = stat(String(l))
          s.set(eur(Number(v)))
          return s.el
        }))
        body.replaceChildren(flow, shares)
        note.textContent = cardAt === 0 ? `A ${eur(spec.amount)} card purchase. Step through it: approval takes seconds, the money moves a day or two later.` : c.steps[cardAt - 1].what
        return
      }
      if (mode === 'iso20022') {
        const msgs = iso()
        const read = msgs.map((m) => readMessage(m.xml))
        const chain = h('ol', { class: 'sim-pay-chain' }, ...msgs.map((m, i) => {
          const problems = 'problems' in read[i] ? (read[i] as { problems: unknown[] }).problems.length : 1
          const b = h('button', { type: 'button', class: `sim-part sim-pay-msg${i === isoAt ? ' on' : ''}${problems ? ' bad' : ''}` }, h('b', null, m.name), h('span', null, `${m.from} → ${m.to}`), h('span', { class: 'sim-pay-msg-check' }, problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'passes'))
          b.addEventListener('click', () => {
            isoAt = i
            host.select('problems')
            host.invalidate()
          })
          return h('li', null, b)
        }))
        const cur = read[isoAt]
        const probs = 'problems' in cur ? cur.problems : [{ at: '', message: cur.error }]
        const pre = h('pre', { class: 'sim-pay-xml sim-mono', tabindex: 0 }, msgs[isoAt].xml)
        const plist = h('ul', { class: 'sim-log sim-pay-problems' }, ...(probs.length ? probs.map((p) => h('li', { class: 'bad' }, p.at ? `${p.at}: ${p.message}` : p.message)) : [h('li', null, 'The gateway’s checks pass: IBANs (mod 97), BICs, decimals, counts and sums.')]))
        plist.addEventListener('click', () => host.select('problems'))
        body.replaceChildren(chain, h('div', { class: 'sim-two' }, pre, h('div', { class: 'sim-stack' }, h('div', { class: 'sim-panel-title' }, 'Gateway checks'), plist)))
        note.textContent = `The same payment as three messages. EndToEndId E2E-2026-0001 travels unchanged from Ada’s order to Bo’s statement: that is what reconciliation matches on.`
        return
      }
      const after = mode === 'instant' ? inst().positions : r.balances
      const dns = settledNet ? dnsWithFailure(opening, sent) : null
      bankRow.replaceChildren(
        ...banks().map((b) => {
          const v = mode === 'net' ? (dns ? (dns.failed.includes(b) ? 'failed' : fmt((opening[b] ?? 0) + (dns.net[b] ?? 0))) : fmt(opening[b] ?? 0)) : fmt(after[b] ?? 0)
          const n = net[b] ?? 0
          return bankCard(b, v, mode === 'net' ? `net ${n > 0 ? '+' : ''}${fmt(n)}` : `opened with ${fmt(opening[b] ?? 0)}`, mode === 'net' ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '')
        })
      )
      list.replaceChildren(
        ...spec.payments.map((p, i) => i).concat(sent.slice(spec.payments.length).map((_, j) => spec.payments.length + j)).map((i) => {
          const p = sent[i] ?? toPayment(spec.payments[i], i)
          const st = paymentStatus(i)
          const li = h('li', { class: `sim-part sim-pay-item${sent[i] ? '' : ' dim'}`, tabindex: 0, 'data-part': `payment:${i + 1}` }, h('span', { class: 'sim-mono' }, `${p.from} → ${p.to}`), h('span', { class: 'sim-pay-money' }, fmt(p.amount)), h('span', { class: `sim-chip ${st.tone}` }, st.text))
          li.addEventListener('click', () => host.select(`payment:${i + 1}`))
          return li
        })
      )
      body.replaceChildren(bankRow, list, statRow)
      const gridlocked = mode === 'rtgs' && r.queued.length > 0 && r.settled.length === 0
      note.textContent =
        mode === 'rtgs'
          ? gridlocked
            ? 'Gridlock: every payment waits for one that waits for it. Add reserves to a bank, or switch to Net to see how little would settle it all.'
            : 'Each payment settles alone, at once and finally, if its bank has the reserves; otherwise it queues.'
          : mode === 'net'
            ? dns
              ? dns.failed.length
                ? `Bank ${dns.failed.join(', ')} couldn't cover its net debit: its payments were unwound and the rest netted again, changing everyone's position.`
                : 'Settled: only the net positions moved.'
              : `Gross ${fmt(ns.gross)}, but only ${fmt(ns.multilateral)} has to move once the batch is netted.`
            : 'Instant: each payment settles in seconds from a prefunded position, or is rejected at once. Nothing waits.'
    },
    describe,
    highlight(part) {
      for (const [b, c] of bankCards) ring(c, part === `bank:${b}`)
      el.querySelectorAll<HTMLElement>('[data-part]').forEach((x) => ring(x, x.dataset.part === part))
      for (const [k, e] of Object.entries(statEls)) ring(e, part === k)
      ring(breakField.el, part === 'field')
      ring(el.querySelector('.sim-pay-problems'), part === 'problems')
    },
    act(action: TourAction) {
      if (typeof action.mode === 'string' && (MODES as string[]).includes(action.mode)) mode = action.mode as PaymentsMode
      if (Array.isArray(action.pay) && action.pay.length >= 3) {
        const [f, t, a] = action.pay as (string | number)[]
        if (String(f) in opening && String(t) in opening && Number(a) > 0) sent.push({ id: `p${sent.length + 1}`, from: String(f), to: String(t), amount: Number(a) })
      }
      if (Array.isArray(action.fund) && action.fund.length >= 2) {
        const [b, a] = action.fund as (string | number)[]
        if (String(b) in opening) opening[String(b)] += Math.max(0, Number(a) || 0)
      }
      if (action.settle === true) {
        while (cursor < spec.payments.length) submitNext()
        settledNet = true
      }
      if (typeof action.break === 'string' && (BREAKS as string[]).includes(action.break)) {
        broken = action.break as IsoBreak
        breakField.set(broken)
      }
    }
  }
}

export const paymentsKind: SimKindDef<PaymentsSpec> = {
  label: 'Payments and settlement',
  transport: true,
  autoplay: () => false,
  create
}
