/**
 * Where a source-led lesson on finance, payments or blockchains reads from first: the primary
 * texts, by topic. The Bank for International Settlements and its committees (CPMI for payments,
 * BCBS for bank risk), the central banks that run the rails (the Fed, the ECB, the Bank of
 * England), ISO 20022 as the Fed's and BIS's own pages set it out, the UK Open Banking standard,
 * the Bitcoin and Ethereum developer documentation, and QuantEcon's lectures (read from QuantEcon's
 * own GitHub sources, since its lecture sites are hosted where some networks can't reach).
 *
 * These go to the lesson as pages already known for the topic (main/sourceLed's `known`), ranked
 * like any other candidate: each still has to cover the step to be shown. Every address answered
 * 200 to `curl -sIL` on 13 November 2026, and each site's robots.txt allows reading it; none needs a
 * login. Tide's reader reads them like any page you open.
 */

export interface PrimaryPage {
  title: string
  by: string
  url: string
  /** What the topic says for this page to fit */
  topics: RegExp
}

const p = (title: string, by: string, url: string, topics: RegExp): PrimaryPage => ({ title, by, url, topics })

export const PRIMARY_PAGES: PrimaryPage[] = [
  // ---------- Payment systems and settlement ----------
  p('Principles for financial market infrastructures', 'CPMI and IOSCO (BIS)', 'https://www.bis.org/cpmi/publ/d101a.pdf', /\b(pfmi|financial market infrastructures?|settlement finality|payment infrastructure|systemic(ally)? important payment|clearing houses?|ccps?|default management)\b/i),
  p('Fedwire Funds Service', 'Federal Reserve Board', 'https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm', /\b(rtgs|real[- ]time gross|fedwire|wholesale payments?|large[- ]value payments?|settlement)\b/i),
  p('T2: the Eurosystem’s real-time gross settlement system', 'European Central Bank', 'https://www.ecb.europa.eu/paym/target/t2/html/index.en.html', /\b(rtgs|real[- ]time gross|target ?2|\bt2\b|eurosystem|central bank money|settlement)\b/i),
  p('FedNow Service', 'Federal Reserve Board', 'https://www.federalreserve.gov/paymentsystems/fednow_about.htm', /\b(instant payments?|fednow|real[- ]time payments?|faster payments)\b/i),
  p('TIPS: TARGET Instant Payment Settlement', 'European Central Bank', 'https://www.ecb.europa.eu/paym/target/tips/html/index.en.html', /\b(instant payments?|tips|sct inst|real[- ]time payments?)\b/i),
  p('Instant payments in the euro area', 'European Central Bank', 'https://www.ecb.europa.eu/paym/integration/retail/instant_payments/html/index.en.html', /\b(instant payments?|sct inst|sepa)\b/i),
  // ---------- Messaging ----------
  p('Harmonised ISO 20022 data requirements for enhancing cross-border payments', 'CPMI (BIS)', 'https://www.bis.org/cpmi/publ/d218.htm', /\b(iso ?20022|pacs\.008|pain\.001|camt\.05\d|cbpr\+?|swift mx|cross[- ]border payments?|payment messag\w*)\b/i),
  p('ISO 20022 implementation for Fedwire Funds', 'Federal Reserve Financial Services', 'https://www.frbservices.org/resources/financial-services/wires/iso-20022-implementation-center', /\b(iso ?20022|pacs\.008|fedwire|payment messag\w*|mx messages?)\b/i),
  // ---------- Banks, money and open banking ----------
  p('Money creation in the modern economy', 'Bank of England, Quarterly Bulletin 2014 Q1', 'https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy', /\b(money creation|how banks create money|bank lending|deposits?|reserves?|core banking|fractional reserve|money multiplier)\b/i),
  p('Open Banking API specifications', 'Open Banking Limited (UK)', 'https://standards.openbanking.org.uk/api-specifications/', /\b(open banking|psd2|account information|payment initiation|aisps?|pisps?|open banking apis?)\b/i),
  p('What is open banking', 'Open Banking Limited (UK)', 'https://www.openbanking.org.uk/what-is-open-banking/', /\b(open banking|open finance)\b/i),
  p('The revised Payment Services Directive (PSD2)', 'European Central Bank', 'https://www.ecb.europa.eu/paym/intro/mip-online/2018/html/1803_revisedpsd.en.html', /\b(psd2|payment services directive|strong customer authentication|open banking)\b/i),
  p('Payment services and electronic money', 'European Banking Authority', 'https://www.eba.europa.eu/regulation-and-policy/payment-services-and-electronic-money', /\b(psd2|e-money|electronic money|payment institutions?|strong customer authentication)\b/i),
  p('Payment tokenisation', 'EMVCo', 'https://www.emvco.com/emv-technologies/payment-tokenisation/', /\b(card (payments?|schemes?|tokeni[sz]ation)|emv|payment tokens?|tokeni[sz]ation)\b/i),
  // ---------- Stablecoins ----------
  p('The next-generation monetary and financial system', 'BIS Annual Economic Report 2025', 'https://www.bis.org/publ/arpdf/ar2025e3.htm', /\b(stablecoins?|tokeni[sz]\w*|unified ledger|cbdcs?|singleness of money)\b/i),
  p('Stablecoin growth: policy challenges and approaches', 'BIS Bulletin 108', 'https://www.bis.org/publ/bisbull108.htm', /\b(stablecoins?|depeg\w*|reserves?)\b/i),
  p('Primary and secondary markets for stablecoins', 'Federal Reserve Board, FEDS Notes', 'https://www.federalreserve.gov/econres/notes/feds-notes/primary-and-secondary-markets-for-stablecoins-20240223.html', /\b(stablecoins?|mint|redeem\w*|redemptions?|arbitrage|peg|depeg\w*)\b/i),
  p('Runs and flights to safety: are stablecoins the new money market funds?', 'Federal Reserve Bank of New York, Staff Report 1073', 'https://www.newyorkfed.org/research/staff_reports/sr1073', /\b(stablecoins?|runs?|bank runs?|depeg\w*|flight to safety)\b/i),
  p('What is USDC', 'Circle', 'https://developers.circle.com/stablecoins/what-is-usdc', /\b(usdc|stablecoins?|fiat[- ]backed)\b/i),
  p('Stablecoins', 'ethereum.org', 'https://ethereum.org/en/stablecoins/', /\b(stablecoins?|dai|crypto[- ]collateral\w*)\b/i),
  p('The Maker Protocol (Dai) documentation', 'MakerDAO', 'https://docs.makerdao.com/', /\b(dai|makerdao|crypto[- ]collateral\w*|collateralised debt|cdps?|vaults?)\b/i),
  // ---------- Blockchains ----------
  p('Bitcoin: A Peer-to-Peer Electronic Cash System', 'Satoshi Nakamoto', 'https://bitcoin.org/bitcoin.pdf', /\b(bitcoin|proof of work|double spend\w*|blockchains?)\b/i),
  p('Bitcoin developer guide: transactions', 'Bitcoin developer documentation', 'https://developer.bitcoin.org/devguide/transactions.html', /\b(bitcoin transactions?|utxos?|scripts?|p2pkh|signatures?)\b/i),
  p('Bitcoin developer guide: the block chain', 'Bitcoin developer documentation', 'https://developer.bitcoin.org/devguide/block_chain.html', /\b(bitcoin|block ?chain|proof of work|mining|forks?)\b/i),
  p('The Ethereum Virtual Machine', 'ethereum.org', 'https://ethereum.org/en/developers/docs/evm/', /\b(evm|ethereum virtual machine|smart contracts?|ethereum)\b/i),
  p('Ethereum transactions', 'ethereum.org', 'https://ethereum.org/en/developers/docs/transactions/', /\b(ethereum|gas|transactions? on ethereum|nonces?)\b/i),
  // ---------- Risk ----------
  p('Minimum capital requirements for market risk (FRTB)', 'Basel Committee on Banking Supervision (BIS)', 'https://www.bis.org/bcbs/publ/d457.htm', /\b(market risk|frtb|expected shortfall|value[- ]at[- ]risk|capital requirements?|basel)\b/i),
  p('MAR33: Internal models approach, capital requirements calculation', 'Basel Framework (BIS)', 'https://www.bis.org/basel_framework/chapter/MAR/33.htm', /\b(expected shortfall|value[- ]at[- ]risk|internal models?|stress(ed)? period)\b/i),
  p('MAR32: Internal models approach, backtesting and P&L attribution', 'Basel Framework (BIS)', 'https://www.bis.org/basel_framework/chapter/MAR/32.htm', /\b(backtesting var|var backtest\w*|backtesting|traffic light|exceptions)\b/i),
  // ---------- QuantEcon (CC BY-SA 4.0), from its GitHub sources ----------
  p('Monte Carlo and option pricing', 'Thomas J. Sargent and John Stachurski, QuantEcon', 'https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/monte_carlo.md', /\b(monte carlo|option pricing|options? pricing|risk[- ]neutral|european options?)\b/i),
  p('Heavy-tailed distributions', 'Thomas J. Sargent and John Stachurski, QuantEcon', 'https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/heavy_tails.md', /\b(heavy[- ]tail\w*|fat[- ]tail\w*|tail risk|value[- ]at[- ]risk|kurtosis|returns? distributions?)\b/i),
  p('Present values', 'Thomas J. Sargent and John Stachurski, QuantEcon', 'https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/pv.md', /\b(present values?|discounting|asset pricing|dividends?)\b/i),
  p('Money financed government deficits and price levels', 'Thomas J. Sargent and John Stachurski, QuantEcon', 'https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/money_inflation.md', /\b(inflation|money supply|seigniorage|price levels?|monetary economics)\b/i)
]

/** The primary pages for a topic, at most `limit`, in list order (most authoritative first within each subject) */
export function primaryPagesFor(topic: string, limit = 4): PrimaryPage[] {
  return PRIMARY_PAGES.filter((x) => x.topics.test(topic)).slice(0, limit)
}
