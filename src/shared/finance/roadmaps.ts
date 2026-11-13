/**
 * Ready roadmaps Tide ships for the learner's focus subjects (resources/roadmaps/RM_*.md, in the
 * vault's roadmap format: ## phases tagged CORE or SUPPORTING, ### sections, checkbox topics, the
 * books and primary texts under each section, Practice lines and a capstone). Starting one makes a
 * notebook with the roadmap as its outline, like a roadmap drafted in New topic, and from then on it
 * is the learner's own file to change.
 */

export interface ReadyRoadmap {
  id: string
  /** The notebook's name, and the roadmap's file name after RM_ */
  title: string
  file: string
  /** One line: what it covers */
  about: string
  /** What someone typing in New topic says for it to be offered */
  topics: RegExp
}

export const READY_ROADMAPS: ReadyRoadmap[] = [
  { id: 'payments', title: 'Payments and Payment Rails', file: 'RM_PAYMENTS.md', about: 'Clearing and settlement, RTGS and netting, ACH, instant payments, cards, correspondent banking and ISO 20022', topics: /\b(payments?|payment rails?|settlement|clearing|rtgs|ach|sepa|instant payments?|card payments?|cross[- ]border payments?|iso ?20022|swift)\b/i },
  { id: 'payment-infrastructure', title: 'Payment Infrastructure', file: 'RM_PAYMENT_INFRASTRUCTURE.md', about: 'Building payment systems: switches, ledgers, idempotency, ISO 8583 and 20022 gateways, reconciliation and security', topics: /\b(payment infrastructure|payment systems? engineering|payment platforms?|payment switch\w*|payments engineering|payment gateways?)\b/i },
  { id: 'core-banking', title: 'Core Banking', file: 'RM_CORE_BANKING.md', about: 'A bank’s balance sheet, double-entry ledgers, accounts and products, interest, lending and the end-of-day run', topics: /\b(core banking|banking systems?|double[- ]entry|ledgers?|bank accounting|how banks work)\b/i },
  { id: 'open-banking', title: 'Open Banking', file: 'RM_OPEN_BANKING.md', about: 'PSD2 and the UK standard, account information and payment initiation APIs, OAuth and FAPI security', topics: /\b(open banking|open finance|psd2|payment initiation|account information)\b/i },
  { id: 'stablecoins', title: 'Stablecoins', file: 'RM_STABLECOINS.md', about: 'Mint and redeem, reserves, arbitrage and the peg, depegs (SVB, Terra), crypto-collateralised designs and regulation', topics: /\b(stablecoins?|usdc|usdt|tether|depeg\w*|digital dollars?)\b/i },
  { id: 'blockchain', title: 'Blockchain', file: 'RM_BLOCKCHAIN.md', about: 'Hashes, signatures and Merkle trees, Bitcoin, Ethereum and smart contracts, scaling and DeFi', topics: /\b(blockchains?|bitcoin|ethereum|smart contracts?|crypto(currency|currencies)?|web3|defi)\b/i },
  { id: 'quant-finance', title: 'Quantitative Finance', file: 'RM_QUANT_FINANCE.md', about: 'Returns, fixed income, derivatives from binomial trees to Black-Scholes and Monte Carlo, portfolios and backtests', topics: /\b(quant(itative)? finance|quant|derivatives pricing|option pricing|financial engineering|algorithmic trading|black[- ]?scholes)\b/i },
  { id: 'risk', title: 'Risk', file: 'RM_RISK.md', about: 'VaR and expected shortfall three ways, backtesting, stress tests, credit and liquidity risk, and Basel capital', topics: /\b(risk management|financial risk|market risk|credit risk|value[- ]at[- ]risk|risk)\b/i },
  { id: 'machine-learning', title: 'Machine Learning', file: 'RM_MACHINE_LEARNING.md', about: 'Linear models to transformers, honest evaluation, and ML for fraud and credit', topics: /\b(machine learning|\bml\b|deep learning|neural networks?)\b/i },
  { id: 'data-engineering', title: 'Data Engineering', file: 'RM_DATA_ENGINEERING.md', about: 'SQL in depth, modelling a ledger, batch and streaming pipelines, warehouses and governance', topics: /\b(data engineering|data pipelines?|etl|data warehous\w*|kafka|streaming data)\b/i },
  { id: 'data-science', title: 'Data Science', file: 'RM_DATA_SCIENCE.md', about: 'Probability and inference, pandas and regression, experiments and causal inference', topics: /\b(data science|statistics|data analysis|analytics)\b/i },
  { id: 'economics', title: 'Economics', file: 'RM_ECONOMICS.md', about: 'Markets and incentives, money and central banks, interest and exchange rates, with real data', topics: /\b(economics|macro(economics)?|micro(economics)?|monetary policy|central banks?)\b/i }
]

/** Ready roadmaps a typed topic names, best first (the longest match wins, so "payment infrastructure" beats "payments") */
export function readyRoadmapsFor(topic: string, limit = 2): ReadyRoadmap[] {
  const t = topic.trim()
  if (!t) return []
  return READY_ROADMAPS.map((r) => ({ r, m: r.topics.exec(t)?.[0].length ?? 0 }))
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, limit)
    .map((x) => x.r)
}

export const readyRoadmap = (id: string) => READY_ROADMAPS.find((r) => r.id === id)
