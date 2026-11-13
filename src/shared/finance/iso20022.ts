/**
 * ISO 20022 payment messages, small enough to read: pain.001 (a customer asks its bank to pay),
 * pacs.008 (bank to bank, the credit transfer itself) and camt.053 (the account statement that
 * reports it), built from plain data, read back, and checked the way a bank's gateway checks them:
 * IBANs by their mod-97 check digits, BICs by their shape, amounts against their currency's
 * decimals, NbOfTxs and CtrlSum against the transactions, a statement's balances against its
 * entries. The element names and nesting follow the published message definitions (pain.001.001.09,
 * pacs.008.001.08, camt.053.001.08), trimmed to the fields that matter for learning them: these are
 * teaching examples, not schema-complete messages.
 */

export interface Party {
  name: string
  iban: string
  /** The party's bank */
  bic: string
}

export interface Transfer {
  /** End-to-end id: set by the payer, carried unchanged to the payee */
  endToEndId: string
  /** Minor units */
  amount: number
  currency: string
  debtor: Party
  creditor: Party
  /** Remittance information: what the payment is for */
  remittance?: string
}

/** Decimal places per currency (ISO 4217) for the ones the lab uses */
export const DECIMALS: Record<string, number> = { EUR: 2, USD: 2, GBP: 2, CHF: 2, JPY: 0, NGN: 2, INR: 2, BHD: 3 }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Minor units as an ISO 20022 decimal amount: 123456 EUR → "1234.56" */
export function amountText(minor: number, currency: string): string {
  const d = DECIMALS[currency] ?? 2
  return d ? (minor / 10 ** d).toFixed(d) : String(minor)
}

export function parseAmount(text: string, currency: string): number {
  const d = DECIMALS[currency] ?? 2
  return Math.round(Number(text) * 10 ** d)
}

// ---------- Identifiers ----------

/** ISO 13616: move the first four characters to the end, letters to numbers (A=10…), the whole mod 97 must be 1 */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97
  }
  return rem === 1
}

/** The two check digits an IBAN needs, for a country and BBAN */
export function ibanCheckDigits(country: string, bban: string): string {
  const moved = `${bban}${country}00`.toUpperCase()
  let rem = 0
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97
  }
  return String(98 - rem).padStart(2, '0')
}

export const makeIban = (country: string, bban: string) => `${country.toUpperCase()}${ibanCheckDigits(country, bban)}${bban.toUpperCase()}`

/** ISO 9362: 4 letters (bank), 2 letters (country), 2 letters or digits (location), optionally 3 more (branch) */
export const validBic = (bic: string) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)

// ---------- Building ----------

const party = (role: string, p: Party, agent: string) =>
  `<${role}><Nm>${esc(p.name)}</Nm></${role}>\n<${role}Acct><Id><IBAN>${p.iban}</IBAN></Id></${role}Acct>\n<${agent}><FinInstnId><BICFI>${p.bic}</BICFI></FinInstnId></${agent}>`

const indent = (xml: string, n: number) =>
  xml
    .split('\n')
    .map((l) => ' '.repeat(n) + l)
    .join('\n')

/** pain.001: a customer's credit transfer initiation, one payment information block from one debtor */
export function pain001(msgId: string, created: string, txs: Transfer[]): string {
  const sum = txs.reduce((s, t) => s + t.amount, 0)
  const ccy = txs[0]?.currency ?? 'EUR'
  const d = txs[0]?.debtor
  const body = txs
    .map((t) =>
      indent(
        `<CdtTrfTxInf>\n  <PmtId><EndToEndId>${esc(t.endToEndId)}</EndToEndId></PmtId>\n  <Amt><InstdAmt Ccy="${t.currency}">${amountText(t.amount, t.currency)}</InstdAmt></Amt>\n${indent(`<CdtrAgt><FinInstnId><BICFI>${t.creditor.bic}</BICFI></FinInstnId></CdtrAgt>\n<Cdtr><Nm>${esc(t.creditor.name)}</Nm></Cdtr>\n<CdtrAcct><Id><IBAN>${t.creditor.iban}</IBAN></Id></CdtrAcct>`, 2)}${t.remittance ? `\n  <RmtInf><Ustrd>${esc(t.remittance)}</Ustrd></RmtInf>` : ''}\n</CdtTrfTxInf>`,
        6
      )
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${created}</CreDtTm>
      <NbOfTxs>${txs.length}</NbOfTxs>
      <CtrlSum>${amountText(sum, ccy)}</CtrlSum>
      <InitgPty><Nm>${esc(d?.name ?? '')}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(msgId)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt><Dt>${created.slice(0, 10)}</Dt></ReqdExctnDt>
${d ? indent(party('Dbtr', d, 'DbtrAgt'), 6) : ''}
${body}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`
}

/** pacs.008: the FI-to-FI customer credit transfer the debtor's bank sends, settling on `settlementDate` */
export function pacs008(msgId: string, created: string, settlementDate: string, txs: Transfer[], method: 'CLRG' | 'INDA' | 'INGA' = 'CLRG'): string {
  const ccy = txs[0]?.currency ?? 'EUR'
  const sum = txs.reduce((s, t) => s + t.amount, 0)
  const body = txs
    .map((t, i) =>
      indent(
        `<CdtTrfTxInf>\n  <PmtId><InstrId>${esc(msgId)}-${i + 1}</InstrId><EndToEndId>${esc(t.endToEndId)}</EndToEndId></PmtId>\n  <IntrBkSttlmAmt Ccy="${t.currency}">${amountText(t.amount, t.currency)}</IntrBkSttlmAmt>\n  <ChrgBr>SLEV</ChrgBr>\n${indent(party('Dbtr', t.debtor, 'DbtrAgt'), 2)}\n${indent(party('Cdtr', t.creditor, 'CdtrAgt'), 2)}${t.remittance ? `\n  <RmtInf><Ustrd>${esc(t.remittance)}</Ustrd></RmtInf>` : ''}\n</CdtTrfTxInf>`,
        4
      )
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${created}</CreDtTm>
      <NbOfTxs>${txs.length}</NbOfTxs>
      <TtlIntrBkSttlmAmt Ccy="${ccy}">${amountText(sum, ccy)}</TtlIntrBkSttlmAmt>
      <IntrBkSttlmDt>${settlementDate}</IntrBkSttlmDt>
      <SttlmInf><SttlmMtd>${method}</SttlmMtd></SttlmInf>
    </GrpHdr>
${body}
  </FIToFICstmrCdtTrf>
</Document>
`
}

export interface StatementEntry {
  /** Minor units, positive */
  amount: number
  side: 'CRDT' | 'DBIT'
  bookingDate: string
  /** The end-to-end id it reports, for reconciliation */
  endToEndId?: string
  info?: string
}

/** camt.053: an end-of-day statement with opening (OPBD) and closing (CLBD) booked balances */
export function camt053(msgId: string, created: string, account: { iban: string; currency: string; owner: string }, opening: number, entries: StatementEntry[]): string {
  const closing = opening + entries.reduce((s, e) => s + (e.side === 'CRDT' ? e.amount : -e.amount), 0)
  const bal = (code: string, v: number, date: string) =>
    `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="${account.currency}">${amountText(Math.abs(v), account.currency)}</Amt><CdtDbtInd>${v < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`
  const day = created.slice(0, 10)
  const ntrys = entries
    .map(
      (e) =>
        `      <Ntry>\n        <Amt Ccy="${account.currency}">${amountText(e.amount, account.currency)}</Amt>\n        <CdtDbtInd>${e.side}</CdtDbtInd>\n        <Sts><Cd>BOOK</Cd></Sts>\n        <BookgDt><Dt>${e.bookingDate}</Dt></BookgDt>${e.endToEndId || e.info ? `\n        <NtryDtls><TxDtls>${e.endToEndId ? `<Refs><EndToEndId>${esc(e.endToEndId)}</EndToEndId></Refs>` : ''}${e.info ? `<RmtInf><Ustrd>${esc(e.info)}</Ustrd></RmtInf>` : ''}</TxDtls></NtryDtls>` : ''}\n      </Ntry>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>${esc(msgId)}</MsgId><CreDtTm>${created}</CreDtTm></GrpHdr>
    <Stmt>
      <Id>${esc(msgId)}-STMT</Id>
      <Acct><Id><IBAN>${account.iban}</IBAN></Id><Ccy>${account.currency}</Ccy><Ownr><Nm>${esc(account.owner)}</Nm></Ownr></Acct>
      ${bal('OPBD', opening, day)}
      ${bal('CLBD', closing, day)}
      <TxsSummry><TtlNtries><NbOfNtries>${entries.length}</NbOfNtries></TtlNtries></TxsSummry>
${ntrys}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`
}

// ---------- Reading ----------

/** Every element with this name: its attributes and inner text (enough for these flat messages) */
function all(xml: string, tag: string): { attrs: Record<string, string>; inner: string }[] {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  return [...xml.matchAll(re)].map((m) => ({ attrs: Object.fromEntries([...(m[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])), inner: m[2] }))
}
const first = (xml: string, tag: string) => all(xml, tag)[0]
const text = (xml: string, tag: string) => {
  const f = first(xml, tag)
  return f ? unesc(f.inner.trim()) : ''
}

export type MessageType = 'pain.001' | 'pacs.008' | 'camt.053'

export function messageType(xml: string): MessageType | null {
  const ns = /xmlns="urn:iso:std:iso:20022:tech:xsd:(\w+\.\d{3})/.exec(xml)?.[1]
  return ns === 'pain.001' || ns === 'pacs.008' || ns === 'camt.053' ? ns : null
}

export interface Problem {
  /** The element or rule it concerns */
  at: string
  message: string
}

export interface ReadMessage {
  type: MessageType
  msgId: string
  transfers: Transfer[]
  /** camt.053 only */
  statement?: { iban: string; opening: number; closing: number; entries: StatementEntry[] }
  problems: Problem[]
}

function readParty(block: string, role: 'Dbtr' | 'Cdtr'): Party {
  const name = text(first(block, role)?.inner ?? '', 'Nm')
  const iban = text(first(block, `${role}Acct`)?.inner ?? '', 'IBAN')
  const bic = text(first(block, `${role}Agt`)?.inner ?? '', 'BICFI')
  return { name, iban, bic }
}

/**
 * Reads a message and checks it. Problems are what a gateway would reject or query: a bad IBAN or
 * BIC, an amount with the wrong decimals, NbOfTxs or a control sum that doesn't match, a message
 * id over 35 characters, a statement whose closing balance isn't opening plus entries.
 */
export function readMessage(xml: string): ReadMessage | { error: string } {
  const type = messageType(xml)
  if (!type) return { error: 'Not a pain.001, pacs.008 or camt.053 document (its namespace says which)' }
  const problems: Problem[] = []
  const msgId = text(xml, 'MsgId')
  if (!msgId) problems.push({ at: 'GrpHdr/MsgId', message: 'The message id is missing' })
  else if (msgId.length > 35) problems.push({ at: 'GrpHdr/MsgId', message: 'Max35Text: the message id is longer than 35 characters' })
  const checkAmount = (at: string, raw: string, ccy: string) => {
    const d = DECIMALS[ccy]
    if (d === undefined) problems.push({ at, message: `Unknown currency ${ccy || '(none)'}` })
    const dec = raw.split('.')[1]?.length ?? 0
    if (d !== undefined && dec > d) problems.push({ at, message: `${ccy} has ${d} decimal places; ${raw} has ${dec}` })
    if (!(Number(raw) > 0)) problems.push({ at, message: `The amount must be above zero (got ${raw})` })
  }
  const checkParty = (at: string, p: Party) => {
    if (p.iban && !validIban(p.iban)) problems.push({ at: `${at}Acct/IBAN`, message: `${p.iban} fails the IBAN check digits (mod 97)` })
    if (p.bic && !validBic(p.bic)) problems.push({ at: `${at}Agt/BICFI`, message: `${p.bic} is not a BIC (4 letters, 2-letter country, 2 for the place, optional 3 for the branch)` })
  }

  if (type === 'camt.053') {
    const iban = text(first(xml, 'Acct')?.inner ?? '', 'IBAN')
    const ccy = text(first(xml, 'Acct')?.inner ?? '', 'Ccy')
    if (iban && !validIban(iban)) problems.push({ at: 'Acct/IBAN', message: `${iban} fails the IBAN check digits (mod 97)` })
    const bal = (code: string) => {
      const b = all(xml, 'Bal').find((x) => text(x.inner, 'Cd') === code)
      if (!b) return NaN
      const v = parseAmount(text(b.inner, 'Amt'), ccy)
      return text(b.inner, 'CdtDbtInd') === 'DBIT' ? -v : v
    }
    const entries: StatementEntry[] = all(xml, 'Ntry').map((n) => {
      const amt = first(n.inner, 'Amt')
      checkAmount('Ntry/Amt', amt?.inner.trim() ?? '', amt?.attrs.Ccy ?? '')
      return { amount: parseAmount(amt?.inner ?? '0', ccy), side: text(n.inner, 'CdtDbtInd') === 'DBIT' ? 'DBIT' : 'CRDT', bookingDate: text(first(n.inner, 'BookgDt')?.inner ?? '', 'Dt'), ...(text(n.inner, 'EndToEndId') ? { endToEndId: text(n.inner, 'EndToEndId') } : {}), ...(text(n.inner, 'Ustrd') ? { info: text(n.inner, 'Ustrd') } : {}) }
    })
    const opening = bal('OPBD')
    const closing = bal('CLBD')
    const moved = entries.reduce((s, e) => s + (e.side === 'CRDT' ? e.amount : -e.amount), 0)
    if (Number.isNaN(opening) || Number.isNaN(closing)) problems.push({ at: 'Stmt/Bal', message: 'A statement needs an opening (OPBD) and a closing (CLBD) booked balance' })
    else if (opening + moved !== closing) problems.push({ at: 'Stmt/Bal', message: `Opening ${amountText(opening, ccy)} plus the entries (${amountText(moved, ccy)}) is ${amountText(opening + moved, ccy)}, not the closing ${amountText(closing, ccy)}` })
    const said = Number(text(xml, 'NbOfNtries'))
    if (text(xml, 'NbOfNtries') && said !== entries.length) problems.push({ at: 'TxsSummry/NbOfNtries', message: `Says ${said} entries; there are ${entries.length}` })
    return { type, msgId, transfers: [], statement: { iban, opening, closing, entries }, problems }
  }

  const txs = all(xml, 'CdtTrfTxInf')
  const debtor = type === 'pain.001' ? readParty(first(xml, 'PmtInf')?.inner.replace(/<CdtTrfTxInf>[\s\S]*<\/CdtTrfTxInf>/g, '') ?? '', 'Dbtr') : null
  const transfers: Transfer[] = txs.map((tx, i) => {
    const amtEl = first(tx.inner, type === 'pain.001' ? 'InstdAmt' : 'IntrBkSttlmAmt')
    const ccy = amtEl?.attrs.Ccy ?? ''
    checkAmount(`CdtTrfTxInf[${i + 1}]/Amt`, amtEl?.inner.trim() ?? '', ccy)
    const t: Transfer = {
      endToEndId: text(tx.inner, 'EndToEndId'),
      amount: parseAmount(amtEl?.inner ?? '0', ccy),
      currency: ccy,
      debtor: debtor ?? readParty(tx.inner, 'Dbtr'),
      creditor: readParty(tx.inner, 'Cdtr'),
      ...(text(tx.inner, 'Ustrd') ? { remittance: text(tx.inner, 'Ustrd') } : {})
    }
    if (!t.endToEndId) problems.push({ at: `CdtTrfTxInf[${i + 1}]/PmtId/EndToEndId`, message: 'Every transaction needs an end-to-end id' })
    checkParty(`CdtTrfTxInf[${i + 1}]/Cdtr`, t.creditor)
    if (!debtor) checkParty(`CdtTrfTxInf[${i + 1}]/Dbtr`, t.debtor)
    return t
  })
  if (debtor) checkParty('PmtInf/Dbtr', debtor)
  const nb = Number(text(xml, 'NbOfTxs'))
  if (nb !== transfers.length) problems.push({ at: 'GrpHdr/NbOfTxs', message: `Says ${nb} transactions; there are ${transfers.length}` })
  const ccy = transfers[0]?.currency ?? 'EUR'
  const total = transfers.reduce((s, t) => s + t.amount, 0)
  const sumTag = type === 'pain.001' ? 'CtrlSum' : 'TtlIntrBkSttlmAmt'
  const said = text(first(xml, 'GrpHdr')?.inner ?? '', sumTag)
  if (said && parseAmount(said, ccy) !== total) problems.push({ at: `GrpHdr/${sumTag}`, message: `Says ${said}; the transactions add up to ${amountText(total, ccy)}` })
  if (type === 'pacs.008' && !/^\d{4}-\d{2}-\d{2}$/.test(text(xml, 'IntrBkSttlmDt'))) problems.push({ at: 'GrpHdr/IntrBkSttlmDt', message: 'The interbank settlement date must be a date (YYYY-MM-DD)' })
  return { type, msgId, transfers, problems }
}

/**
 * Reconciles a statement against the payments that were expected: by end-to-end id first, then
 * by amount for entries without one. What is left on either side is a break to investigate.
 */
export function reconcile(expected: { endToEndId: string; amount: number }[], entries: StatementEntry[]): { matched: string[]; missing: string[]; unexpected: StatementEntry[] } {
  const left = [...entries]
  const matched: string[] = []
  const missing: string[] = []
  for (const x of expected) {
    let i = left.findIndex((e) => e.endToEndId === x.endToEndId && e.amount === x.amount)
    if (i < 0) i = left.findIndex((e) => !e.endToEndId && e.amount === x.amount)
    if (i < 0) missing.push(x.endToEndId)
    else {
      matched.push(x.endToEndId)
      left.splice(i, 1)
    }
  }
  return { matched, missing, unexpected: left }
}

/** Two example parties with valid IBANs and BICs, for lessons and the simulation */
export const EXAMPLE_PARTIES: Record<string, Party> = {
  ada: { name: 'Ada Okafor', iban: makeIban('DE', '370400440532013000'), bic: 'COBADEFFXXX' },
  bo: { name: 'Bo Lindqvist', iban: makeIban('FR', '20041010050500013M02606'), bic: 'BNPAFRPPXXX' },
  shop: { name: 'Corner Shop Ltd', iban: makeIban('GB', 'NWBK60161331926819'), bic: 'NWBKGB2LXXX' }
}
