/**
 * Courses from beyond GitHub: MIT OpenCourseWare, Open Yale Courses, QuantEcon's lectures, free
 * online books, university lecture series on YouTube and official guides, chosen for payments,
 * banking, blockchain, quantitative finance, economics, data and ML. Each was checked on 12 Nov 2026
 * to exist, to be free without a login, and for its licence, which is recorded as its source states
 * it. Like the GitHub courses, a course's text is fetched onto this Mac when you import it and read
 * there; only these lines ship with Tide.
 *
 *   open      the source's licence allows copying with attribution (CC BY, CC BY-SA, MIT, Apache, BSD)
 *   personal  non-commercial, no-derivatives, all rights reserved or unstated: read here for your
 *             own study, never passed on (OCW and Open Yale are CC BY-NC-SA: personal study only)
 */
import type { CatalogueCourse } from './courseCatalogue'

const OCW = { source: 'ocw' as const, by: 'MIT OpenCourseWare', licence: 'CC BY-NC-SA 4.0', tier: 'personal' as const, licenceNote: 'MIT OpenCourseWare is CC BY-NC-SA 4.0: read on this Mac for your own study, never passed on', kind: 'course' as const }
const YALE = { source: 'yale' as const, licence: 'CC BY-NC-SA 3.0', tier: 'personal' as const, licenceNote: 'Open Yale Courses are CC BY-NC-SA 3.0: read on this Mac for your own study, never passed on', kind: 'course' as const, media: 'mixed' as const }
const YT = { source: 'youtube' as const, licence: 'Standard YouTube licence', tier: 'personal' as const, licenceNote: 'Watched in YouTube’s player; transcripts kept on this Mac for your own study', kind: 'course' as const, media: 'video' as const }
const QE = {
  source: 'jupyterbook' as const,
  branch: 'main',
  by: 'Thomas J. Sargent and John Stachurski (QuantEcon)',
  licence: 'CC-BY-SA-4.0',
  tier: 'open' as const,
  licenceNote: 'CC BY-SA 4.0, as every QuantEcon lecture site states; the notebooks are read from QuantEcon’s .notebooks repository',
  kind: 'course' as const
}
const PERSONAL_SITE = 'All rights reserved or no licence stated: read on this Mac for your own study, never passed on'

export const WEB_COURSES: CatalogueCourse[] = [
  // ---------- Payments and banking ----------
  {
    id: 'stripe-payments',
    source: 'docs',
    url: 'https://docs.stripe.com/payments/online-payments',
    title: 'How online payments work, from Stripe’s docs',
    by: 'Stripe',
    area: 'payments',
    licence: 'Stripe documentation (all rights reserved)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'Payment intents and their lifecycle, payment methods, card authentication (3DS), bank debits (ACH, SEPA), refunds, disputes, payouts, fraud (Radar) and platforms (Connect)',
    kind: 'guide',
    level: 'beginner',
    topics: ['payments', 'online payments', 'card payments', 'payment methods', 'payment intents', '3d secure', 'ach', 'sepa', 'disputes', 'chargebacks', 'payouts', 'payment fraud', 'stripe'],
    pages: [
      { title: 'Online payments', url: 'https://docs.stripe.com/payments/online-payments', module: 'Taking a payment' },
      { title: 'Payment intents', url: 'https://docs.stripe.com/payments/payment-intents' },
      { title: 'How a payment intent moves through its states', url: 'https://docs.stripe.com/payments/paymentintents/lifecycle' },
      { title: 'Payment methods', url: 'https://docs.stripe.com/payments/payment-methods/overview', module: 'Ways to pay' },
      { title: '3D Secure authentication', url: 'https://docs.stripe.com/payments/3d-secure' },
      { title: 'ACH Direct Debit', url: 'https://docs.stripe.com/payments/ach-direct-debit' },
      { title: 'SEPA Direct Debit', url: 'https://docs.stripe.com/payments/sepa-debit' },
      { title: 'Refunds', url: 'https://docs.stripe.com/refunds', module: 'After the payment' },
      { title: 'How disputes work', url: 'https://docs.stripe.com/disputes/how-disputes-work' },
      { title: 'Payouts', url: 'https://docs.stripe.com/payouts' },
      { title: 'Fraud: Radar', url: 'https://docs.stripe.com/radar' },
      { title: 'How Connect works', url: 'https://docs.stripe.com/connect/how-connect-works', module: 'Platforms and marketplaces' }
    ]
  },
  {
    id: 'bny-iso20022',
    source: 'docs',
    url: 'https://www.bny.com/corporate/global/en/iso-20022/iso-20022-learning-curriculum.html',
    title: 'ISO 20022 payment messages: a learning curriculum',
    by: 'BNY',
    area: 'payments',
    licence: 'BNY learning material (all rights reserved)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'The ISO 20022 messages that replace SWIFT MT in cross-border payments: pacs.008 and pacs.009, pacs.004 returns, pacs.002 status, camt.056 and camt.029 investigations, camt.054 notifications, with usage guidelines',
    kind: 'guide',
    level: 'intermediate',
    topics: ['iso 20022', 'swift', 'swift mx', 'cbpr+', 'pacs.008', 'pacs.009', 'camt.054', 'payment messaging', 'cross-border payments', 'payment messages'],
    pages: [
      { title: 'pacs.008: the customer credit transfer (MT 103)', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/learning-guide-module4.pdf', module: 'Moving money' },
      { title: 'pacs.009: financial institution credit transfers (MT 202, 205)', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/learning-guide-module5.pdf' },
      { title: 'pacs.004 and pacs.002: returns and status reports', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/learning-guide-module6.pdf', module: 'When things go wrong' },
      { title: 'camt.056 and camt.029: cancellations and investigations', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/learning-guide-module7.pdf' },
      { title: 'camt.054: debit and credit notifications (MT 900, 910)', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/learning-guide-module9.pdf', module: 'Reporting' },
      { title: 'A quick guide to the messages', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/iso-20022-module-11-quick-guide.pdf', module: 'Reference' },
      { title: 'Usage guidelines for customer and FI credit transfers', url: 'https://www.bny.com/content/dam/bnymellon/documents/pdf/iso-20022/iso-20022-usage-guidelines-customers-and-financial-credit-transfers.pdf' }
    ]
  },
  {
    id: 'central-bank-rails',
    source: 'docs',
    url: 'https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm',
    title: 'Payment rails, from the central banks that run them',
    by: 'The Federal Reserve and the European Central Bank',
    area: 'payments',
    licence: 'Federal Reserve: US public domain; ECB: reproduction allowed with the source',
    tier: 'personal',
    licenceNote: 'The Fed’s pages are US government works; the ECB’s allow reproduction with the source named. Kept for your own study.',
    covers: 'Wholesale and retail rails as their operators describe them: Fedwire Funds (RTGS), FedACH, FedNow instant payments, and the Eurosystem’s TARGET services (T2, TIPS, T2S)',
    kind: 'guide',
    level: 'beginner',
    topics: ['payment rails', 'rtgs', 'fedwire', 'ach', 'fednow', 'instant payments', 'target2', 't2', 'tips', 't2s', 'settlement', 'central bank', 'payment infrastructure'],
    pages: [
      { title: 'Fedwire Funds Service', url: 'https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm', module: 'The United States' },
      { title: 'FedACH', url: 'https://www.federalreserve.gov/paymentsystems/fedach_about.htm' },
      { title: 'FedNow: questions and answers', url: 'https://www.federalreserve.gov/paymentsystems/fednow_faq.htm' },
      { title: 'T2: the Eurosystem’s RTGS', url: 'https://www.ecb.europa.eu/paym/target/t2/html/index.en.html', module: 'The euro area' },
      { title: 'TIPS: instant payment settlement', url: 'https://www.ecb.europa.eu/paym/target/tips/html/index.en.html' },
      { title: 'T2S: securities settlement', url: 'https://www.ecb.europa.eu/paym/target/t2s/html/index.en.html' }
    ]
  },
  {
    id: 'cpmi-infrastructure',
    source: 'docs',
    url: 'https://www.bis.org/cpmi/',
    title: 'Payment infrastructure: the CPMI’s principles and fast payments',
    by: 'Committee on Payments and Market Infrastructures (BIS)',
    area: 'payments',
    licence: '© BIS, brief excerpts with the source stated',
    tier: 'personal',
    licenceNote: 'BIS publications may be quoted in part with the source: read on this Mac for your own study',
    covers: 'The global standard for payment and settlement systems (the PFMI: credit and liquidity risk, settlement finality, default management) and how fast (instant) retail payment systems are built',
    kind: 'guide',
    level: 'advanced',
    topics: ['payment infrastructure', 'financial market infrastructure', 'pfmi', 'settlement finality', 'fast payments', 'instant payments', 'clearing', 'settlement', 'cpmi', 'payment systems'],
    pages: [
      { title: 'Fast payments: enhancing the speed and availability of retail payments', url: 'https://www.bis.org/cpmi/publ/d190.pdf', module: 'Retail payments' },
      { title: 'Principles for financial market infrastructures', url: 'https://www.bis.org/cpmi/publ/d101a.pdf', module: 'The principles' }
    ]
  },
  {
    id: 'tigerbeetle-docs',
    repo: 'tigerbeetle/tigerbeetle',
    branch: 'main',
    title: 'TigerBeetle: double-entry accounting for payments',
    by: 'TigerBeetle',
    area: 'payments',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'Ledgers built on debits and credits: accounts, transfers, two-phase transfers, balance limits, currency exchange, and how a financial transactions database is designed and run',
    kind: 'guide',
    level: 'intermediate',
    topics: ['double-entry accounting', 'double entry', 'ledger', 'ledgers', 'core banking', 'debits and credits', 'two-phase commit', 'financial transactions', 'payment infrastructure'],
    root: 'docs',
    skip: ['internals', 'TIGER_STYLE.md', 'ARCHITECTURE.md']
  },
  {
    id: 'apache-fineract',
    source: 'site',
    url: 'https://fineract.apache.org/docs/current/',
    title: 'Apache Fineract: an open core-banking platform',
    by: 'The Apache Software Foundation',
    area: 'payments',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'How a core-banking system is built: clients, savings and loan products, accounting and the general ledger, interest, batch jobs, and the platform’s architecture and APIs',
    kind: 'guide',
    level: 'intermediate',
    topics: ['core banking', 'core banking system', 'loans', 'savings accounts', 'general ledger', 'microfinance', 'banking software', 'fineract'],
    toc: '#toc',
    maxPages: 1
  },
  {
    ...OCW,
    id: 'ocw-15-s08-fintech',
    url: 'https://ocw.mit.edu/courses/15-s08-fintech-shaping-the-financial-world-spring-2020/',
    title: 'FinTech: Shaping the Financial World (MIT 15.S08)',
    by: 'Gary Gensler and Sean Willems, MIT OpenCourseWare',
    area: 'payments',
    covers: 'How technology is changing finance: payments, credit, open banking and data, AI in finance, crypto and central bank digital currencies, and the policy questions each raises',
    level: 'intermediate',
    topics: ['fintech', 'payments', 'open banking', 'digital banking', 'cbdc', 'central bank digital currency', 'ai in finance', 'financial regulation']
  },
  {
    ...OCW,
    id: 'ocw-15-483-consumer-finance',
    url: 'https://ocw.mit.edu/courses/15-483-consumer-finance-markets-product-design-and-fintech-spring-2018/',
    title: 'Consumer Finance: Markets, Product Design and FinTech (MIT 15.483)',
    area: 'payments',
    covers: 'Retail financial products and the markets for them: credit cards, mortgages, payday lending, savings, and how fintech firms design them',
    level: 'intermediate',
    topics: ['consumer finance', 'credit cards', 'retail banking', 'lending', 'fintech', 'mortgages']
  },

  // ---------- Blockchain and stablecoins ----------
  {
    ...OCW,
    id: 'ocw-15-s12-blockchain-money',
    url: 'https://ocw.mit.edu/courses/15-s12-blockchain-and-money-fall-2018/',
    title: 'Blockchain and Money (MIT 15.S12)',
    by: 'Gary Gensler, MIT OpenCourseWare',
    area: 'blockchain',
    covers: 'Blockchain and money from the ground up: the history of money and ledgers, Bitcoin’s design, smart contracts, stablecoins and digital currencies, and their use in payments, trade finance and capital markets',
    level: 'beginner',
    topics: ['blockchain', 'bitcoin', 'cryptocurrency', 'stablecoins', 'digital currency', 'money', 'smart contracts', 'payments', 'cbdc']
  },
  {
    ...OCW,
    id: 'ocw-mas-s62-crypto-engineering',
    url: 'https://ocw.mit.edu/courses/mas-s62-cryptocurrency-engineering-and-design-spring-2018/',
    title: 'Cryptocurrency Engineering and Design (MIT MAS.S62)',
    by: 'Neha Narula and Tadge Dryja, MIT OpenCourseWare',
    area: 'blockchain',
    covers: 'How Bitcoin works underneath: signatures, hashing and proof of work, transactions and UTXOs, scripts, wallets, the network, payment channels and Lightning, with problem sets in code',
    level: 'advanced',
    topics: ['bitcoin', 'cryptocurrency', 'proof of work', 'utxo', 'digital signatures', 'hash functions', 'lightning network', 'payment channels', 'blockchain']
  },
  {
    ...OCW,
    id: 'ocw-14-129-blockchain-finance',
    url: 'https://ocw.mit.edu/courses/14-129-blockchain-and-the-design-of-financial-systems-spring-2025/',
    title: 'Blockchain and the Design of Financial Systems (MIT 14.129)',
    area: 'blockchain',
    covers: 'The economics of blockchains as financial infrastructure: consensus and incentives, tokens, stablecoins, decentralised finance, and how they compare with banks and payment systems',
    level: 'advanced',
    topics: ['blockchain', 'stablecoins', 'decentralized finance', 'defi', 'tokens', 'consensus', 'financial systems', 'payment systems']
  },
  {
    id: 'mastering-bitcoin',
    repo: 'bitcoinbook/bitcoinbook',
    branch: 'develop',
    title: 'Mastering Bitcoin (3rd edition)',
    by: 'Andreas M. Antonopoulos and David A. Harding',
    area: 'blockchain',
    licence: 'CC-BY-SA-4.0',
    tier: 'open',
    licenceNote: 'The third edition is CC BY-SA 4.0, as its README states (the repository’s LICENSE covers each edition)',
    covers: 'Bitcoin end to end: keys and addresses, wallets, transactions and scripts, signatures (Schnorr, taproot), fees, the peer-to-peer network, the blockchain, mining and consensus, security',
    kind: 'book',
    level: 'intermediate',
    topics: ['bitcoin', 'blockchain', 'cryptocurrency', 'bitcoin script', 'utxo', 'mining', 'proof of work', 'schnorr signatures', 'taproot', 'wallets', 'digital signatures'],
    order: ['preface.adoc', 'ch01_intro.adoc', 'ch02_overview.adoc', 'ch03_bitcoin-core.adoc', 'ch04_keys.adoc', 'ch05_wallets.adoc', 'ch06_transactions.adoc', 'ch07_authorization-authentication.adoc', 'ch08_signatures.adoc', 'ch09_fees.adoc', 'ch10_network.adoc', 'ch11_blockchain.adoc', 'ch12_mining.adoc', 'ch13_security.adoc', 'ch14_applications.adoc', 'appa_whitepaper.adoc', 'appc_bips.adoc'],
    skip: ['README.md', 'BOOK.md', 'CONTRIBUTING.md', 'appb_errata.adoc', 'glossary.asciidoc', 'tapscript.asciidoc', 'book.adoc', 'code', 'contrib', 'meta', 'tools', 'snippets', 'theme']
  },
  {
    id: 'learning-bitcoin-cli',
    repo: 'BlockchainCommons/Learning-Bitcoin-from-the-Command-Line',
    branch: 'master',
    title: 'Learning Bitcoin from the Command Line',
    by: 'Blockchain Commons',
    area: 'blockchain',
    licence: 'CC-BY-4.0',
    tier: 'open',
    licenceNote: 'CC BY 4.0, as its README states',
    covers: 'Bitcoin hands on with bitcoin-cli: setting up a node, sending and receiving transactions, raw transactions, multisig, Bitcoin Script, timelocks, programming with RPC, and Lightning',
    kind: 'course',
    level: 'intermediate',
    topics: ['bitcoin', 'bitcoin core', 'bitcoin-cli', 'raw transactions', 'multisig', 'bitcoin script', 'timelocks', 'lightning network', 'bitcoin rpc'],
    skip: ['/^[a-z][a-z]\\//', 'CLA.md', 'CONTRIBUTING.md', 'TRANSLATING.md', 'signed-cla', 'src', 'public']
  },
  {
    id: 'bitcoin-devguide',
    source: 'site',
    url: 'https://developer.bitcoin.org/devguide/index.html',
    title: 'The Bitcoin Developer Guide',
    by: 'The Bitcoin.org developers',
    area: 'blockchain',
    licence: 'MIT',
    tier: 'open',
    licenceNote: 'MIT, as its repository’s LICENSE states (github.com/bitcoin-dot-org/developer.bitcoin.org)',
    covers: 'How Bitcoin works for developers: the block chain, transactions and scripts, contracts, wallets, payment processing, operating modes, the P2P network and mining',
    kind: 'guide',
    level: 'intermediate',
    topics: ['bitcoin', 'blockchain', 'transactions', 'payment processing', 'bitcoin wallets', 'p2p network', 'mining', 'bitcoin script'],
    toc: '.sphinxsidebarwrapper'
  },
  {
    id: 'ethereum-docs',
    repo: 'ethereum/ethereum-org-website',
    branch: 'dev',
    title: 'Ethereum’s developer docs',
    by: 'ethereum.org',
    area: 'blockchain',
    licence: 'MIT',
    tier: 'open',
    covers: 'Ethereum from the inside: accounts, transactions, blocks, the EVM, gas, smart contracts, nodes and clients, consensus (proof of stake), standards (ERC-20, ERC-721), oracles, bridges and scaling',
    kind: 'guide',
    level: 'intermediate',
    topics: ['ethereum', 'smart contracts', 'evm', 'solidity', 'proof of stake', 'erc-20', 'tokens', 'layer 2', 'rollups', 'gas', 'blockchain'],
    root: 'public/content/developers/docs'
  },
  {
    id: 'bis-future-money',
    source: 'docs',
    url: 'https://www.bis.org/publ/arpdf/ar2025e3.htm',
    title: 'Stablecoins, tokenisation and the future monetary system',
    by: 'Bank for International Settlements',
    area: 'blockchain',
    licence: '© BIS, brief excerpts with the source stated',
    tier: 'personal',
    licenceNote: 'BIS publications may be quoted in part with the source: read on this Mac for your own study',
    covers: 'The BIS’s view of money’s next system across three Annual Economic Report chapters (crypto’s structural flaws, a unified ledger, stablecoins and why they fail the tests of money) and how the PFMI apply to stablecoin arrangements',
    kind: 'guide',
    level: 'advanced',
    topics: ['stablecoins', 'tokenisation', 'tokenization', 'cbdc', 'central bank digital currency', 'unified ledger', 'monetary system', 'crypto', 'defi', 'money'],
    pages: [
      { title: 'The future monetary system (2022)', url: 'https://www.bis.org/publ/arpdf/ar2022e3.pdf', module: 'The BIS’s Annual Economic Reports' },
      { title: 'Blueprint for the future monetary system (2023)', url: 'https://www.bis.org/publ/arpdf/ar2023e3.pdf' },
      { title: 'The next-generation monetary and financial system (2025)', url: 'https://www.bis.org/publ/arpdf/ar2025e3.pdf' },
      { title: 'Applying the PFMI to stablecoin arrangements', url: 'https://www.bis.org/cpmi/publ/d206.pdf', module: 'Stablecoins as payment systems' }
    ]
  },

  // Added in the finance build (13 Nov 2026): open banking, ISO 20022 from the operators, banks and
  // money, stablecoin research and Basel market risk. Each page answered 200 and its site's
  // robots.txt allows it; none needs a login.
  {
    id: 'open-banking-standards',
    source: 'docs',
    url: 'https://www.openbanking.org.uk/what-is-open-banking/',
    title: 'Open banking: the law and the UK standard',
    by: 'Open Banking Limited, the European Central Bank and the European Banking Authority',
    area: 'payments',
    licence: 'Open Banking Limited, ECB and EBA pages (all rights reserved; the ECB allows reproduction with the source)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'Why open banking exists, PSD2’s access-to-account rules and strong customer authentication, and the UK Open Banking Standard’s account information and payment initiation APIs and security profile',
    kind: 'guide',
    level: 'intermediate',
    topics: ['open banking', 'open finance', 'psd2', 'payment initiation', 'account information', 'strong customer authentication', 'open banking apis', 'fapi', 'aisp', 'pisp'],
    pages: [
      { title: 'What is open banking', url: 'https://www.openbanking.org.uk/what-is-open-banking/', module: 'The idea' },
      { title: 'The revised Payment Services Directive (PSD2)', url: 'https://www.ecb.europa.eu/paym/intro/mip-online/2018/html/1803_revisedpsd.en.html', module: 'The law' },
      { title: 'Payment services and electronic money', url: 'https://www.eba.europa.eu/regulation-and-policy/payment-services-and-electronic-money' },
      { title: 'Open Banking API specifications', url: 'https://standards.openbanking.org.uk/api-specifications/', module: 'The standard' }
    ]
  },
  {
    id: 'iso20022-operators',
    source: 'docs',
    url: 'https://www.bis.org/cpmi/publ/d218.htm',
    title: 'ISO 20022 from the people who run the rails',
    by: 'CPMI (BIS) and Federal Reserve Financial Services',
    area: 'payments',
    licence: '© BIS, brief excerpts with the source stated; Federal Reserve Financial Services pages',
    tier: 'personal',
    licenceNote: 'BIS publications may be quoted in part with the source; the Fed’s service pages are kept for your own study',
    covers: 'The harmonised ISO 20022 data requirements the G20 set for cross-border payments, and how Fedwire Funds moved to ISO 20022 messages',
    kind: 'guide',
    level: 'intermediate',
    topics: ['iso 20022', 'pacs.008', 'cross-border payments', 'payment messages', 'fedwire', 'cbpr+', 'swift mx'],
    pages: [
      { title: 'Harmonised ISO 20022 data requirements for enhancing cross-border payments', url: 'https://www.bis.org/cpmi/publ/d218.htm', module: 'The data' },
      { title: 'ISO 20022 implementation for Fedwire Funds', url: 'https://www.frbservices.org/resources/financial-services/wires/iso-20022-implementation-center', module: 'A real migration' }
    ]
  },
  {
    id: 'banks-and-money',
    source: 'docs',
    url: 'https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy',
    title: 'How banks create money',
    by: 'Bank of England',
    area: 'payments',
    licence: '© Bank of England (all rights reserved)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'The Bank of England’s account of commercial banks creating deposits by lending, the limits on it, and what central bank reserves are for: the balance-sheet view behind core banking',
    kind: 'guide',
    level: 'beginner',
    topics: ['money creation', 'core banking', 'bank balance sheet', 'deposits', 'reserves', 'central bank', 'how banks work', 'fractional reserve'],
    pages: [{ title: 'Money creation in the modern economy', url: 'https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy', module: 'Banks and money' }]
  },
  {
    id: 'stablecoin-research',
    source: 'docs',
    url: 'https://www.federalreserve.gov/econres/notes/feds-notes/primary-and-secondary-markets-for-stablecoins-20240223.html',
    title: 'Stablecoins: how they hold the peg and how they break it',
    by: 'Federal Reserve Board, Federal Reserve Bank of New York, BIS, Circle and ethereum.org',
    area: 'blockchain',
    licence: 'Federal Reserve: US public domain; BIS: brief excerpts with the source; Circle: all rights reserved; ethereum.org: MIT',
    tier: 'personal',
    licenceNote: 'Mixed sources: the Fed’s are US government works, the others are read on this Mac for your own study',
    covers: 'How fiat-backed stablecoins are minted, redeemed and arbitraged, why they run like money market funds, the policy questions their growth raises, and how crypto-collateralised designs differ',
    kind: 'guide',
    level: 'intermediate',
    topics: ['stablecoins', 'usdc', 'depeg', 'stablecoin runs', 'mint and redeem', 'reserves', 'dai', 'algorithmic stablecoins'],
    pages: [
      { title: 'Stablecoins', url: 'https://ethereum.org/en/stablecoins/', module: 'What they are' },
      { title: 'What is USDC', url: 'https://developers.circle.com/stablecoins/what-is-usdc' },
      { title: 'Primary and secondary markets for stablecoins', url: 'https://www.federalreserve.gov/econres/notes/feds-notes/primary-and-secondary-markets-for-stablecoins-20240223.html', module: 'Holding the peg' },
      { title: 'Runs and flights to safety: are stablecoins the new money market funds?', url: 'https://www.newyorkfed.org/research/staff_reports/sr1073', module: 'Breaking it' },
      { title: 'Stablecoin growth: policy challenges and approaches', url: 'https://www.bis.org/publ/bisbull108.htm', module: 'Policy' }
    ]
  },
  {
    id: 'basel-market-risk',
    source: 'docs',
    url: 'https://www.bis.org/bcbs/publ/d457.htm',
    title: 'Market risk under Basel: VaR, expected shortfall and backtesting',
    by: 'Basel Committee on Banking Supervision (BIS)',
    area: 'quant',
    licence: '© BIS, brief excerpts with the source stated',
    tier: 'personal',
    licenceNote: 'BIS publications may be quoted in part with the source: read on this Mac for your own study',
    covers: 'The rules banks measure market risk by: the FRTB standard, the internal models approach’s 97.5% expected shortfall and stressed periods, and VaR backtesting with its traffic-light zones',
    kind: 'guide',
    level: 'advanced',
    topics: ['market risk', 'value at risk', 'expected shortfall', 'frtb', 'basel', 'backtesting var', 'risk management', 'capital requirements', 'stress testing'],
    pages: [
      { title: 'Minimum capital requirements for market risk', url: 'https://www.bis.org/bcbs/publ/d457.htm', module: 'The standard' },
      { title: 'MAR30: Internal models approach, general provisions', url: 'https://www.bis.org/basel_framework/chapter/MAR/30.htm', module: 'Internal models' },
      { title: 'MAR32: Backtesting and P&L attribution', url: 'https://www.bis.org/basel_framework/chapter/MAR/32.htm' },
      { title: 'MAR33: Capital requirements calculation (expected shortfall)', url: 'https://www.bis.org/basel_framework/chapter/MAR/33.htm' }
    ]
  },

  // ---------- Quantitative finance and risk ----------
  {
    ...OCW,
    id: 'ocw-18-s096-math-finance',
    url: 'https://ocw.mit.edu/courses/18-s096-topics-in-mathematics-with-applications-in-finance-fall-2013/',
    title: 'Topics in Mathematics with Applications in Finance (MIT 18.S096, 2013)',
    by: 'Peter Kempthorne, Choongbum Lee, Vasily Strela and Jake Xia, MIT OpenCourseWare',
    area: 'quant',
    covers: 'The maths of quant finance, taught by practitioners: linear algebra, probability, stochastic processes, regression, Value at Risk, time series, volatility, portfolio theory, Itô calculus, Black–Scholes and credit risk',
    level: 'advanced',
    topics: ['quantitative finance', 'value at risk', 'var', 'stochastic processes', 'time series', 'volatility', 'portfolio theory', 'ito calculus', 'black-scholes', 'option pricing', 'risk', 'credit risk', 'regression']
  },
  {
    ...OCW,
    id: 'ocw-18-642-math-finance',
    url: 'https://ocw.mit.edu/courses/18-642-topics-in-mathematics-with-applications-in-finance-fall-2024/',
    title: 'Topics in Mathematics with Applications in Finance (MIT 18.642, 2024)',
    area: 'quant',
    covers: 'The 2024 version of MIT’s quant finance maths course: probability, stochastic processes, statistics and optimisation as they are used in trading, risk and pricing',
    level: 'advanced',
    topics: ['quantitative finance', 'stochastic processes', 'risk', 'option pricing', 'portfolio optimization', 'statistics', 'trading']
  },
  {
    ...OCW,
    id: 'ocw-15-401-finance-theory',
    url: 'https://ocw.mit.edu/courses/15-401-finance-theory-i-fall-2008/',
    title: 'Finance Theory I (MIT 15.401)',
    by: 'Andrew W. Lo, MIT OpenCourseWare',
    area: 'quant',
    covers: 'The core of finance: present value, fixed income, equities, forwards and futures, options, risk and return, portfolio theory, the CAPM and capital budgeting',
    level: 'beginner',
    topics: ['finance', 'present value', 'fixed income', 'bonds', 'equities', 'options', 'futures', 'risk and return', 'portfolio theory', 'capm', 'capital budgeting']
  },
  {
    ...OCW,
    id: 'ocw-15-450-analytics-finance',
    url: 'https://ocw.mit.edu/courses/15-450-analytics-of-finance-fall-2010/',
    title: 'Analytics of Finance (MIT 15.450)',
    by: 'Leonid Kogan, MIT OpenCourseWare',
    area: 'quant',
    covers: 'Quantitative methods for finance: stochastic calculus, arbitrage pricing, Monte Carlo simulation, dynamic programming, and statistical estimation of asset pricing models',
    level: 'advanced',
    topics: ['quantitative finance', 'stochastic calculus', 'arbitrage pricing', 'monte carlo', 'monte carlo simulation', 'dynamic programming', 'asset pricing', 'derivatives pricing']
  },
  {
    ...YALE,
    id: 'yale-econ-252-financial-markets',
    url: 'https://oyc.yale.edu/economics/econ-252',
    title: 'Financial Markets (Yale ECON 252)',
    by: 'Robert J. Shiller, Open Yale Courses',
    area: 'quant',
    covers: 'Financial markets and institutions with a Nobel laureate: risk and diversification, efficient markets and behavioural finance, insurance, banks and central banks, stocks, bonds, forwards, options and exchanges',
    level: 'beginner',
    topics: ['financial markets', 'risk', 'efficient markets', 'behavioral finance', 'banking', 'central banks', 'bonds', 'options', 'insurance', 'portfolio diversification']
  },
  {
    ...YALE,
    id: 'yale-econ-251-financial-theory',
    url: 'https://oyc.yale.edu/economics/econ-251',
    title: 'Financial Theory (Yale ECON 251)',
    by: 'John Geanakoplos, Open Yale Courses',
    area: 'quant',
    covers: 'Finance from general equilibrium: interest rates, present value, bonds and the yield curve, mortgages and prepayment, risk aversion, the CAPM, leverage cycles and the financial crisis',
    level: 'intermediate',
    topics: ['financial theory', 'general equilibrium', 'interest rates', 'yield curve', 'bonds', 'mortgages', 'capm', 'leverage cycle', 'asset pricing']
  },
  {
    id: 'zivot-compfin',
    source: 'site',
    url: 'https://bookdown.org/compfinezbook/introcompfinr/index.html',
    title: 'Introduction to Computational Finance and Financial Econometrics with R',
    by: 'Eric Zivot',
    area: 'quant',
    licence: 'No licence stated',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'Returns, probability and time series for finance, the constant expected return model, bootstrapping, hypothesis testing, portfolio theory with matrix algebra, and estimating risk (VaR), in R',
    kind: 'book',
    level: 'intermediate',
    topics: ['financial econometrics', 'computational finance', 'asset returns', 'time series', 'portfolio theory', 'value at risk', 'bootstrap', 'r programming']
  },
  {
    ...QE,
    id: 'quantecon-programming',
    repo: 'QuantEcon/lecture-python-programming.notebooks',
    jbToc: 'https://raw.githubusercontent.com/QuantEcon/lecture-python-programming.myst/main/lectures/_toc.yml',
    url: 'https://python-programming.quantecon.org',
    title: 'Python Programming for Economics and Finance',
    area: 'quant',
    covers: 'Python for quantitative work, as runnable notebooks: NumPy, Matplotlib, SciPy, pandas, Numba, JAX, writing good code, debugging and parallelisation, with exercises',
    level: 'beginner',
    topics: ['python', 'numpy', 'pandas', 'scipy', 'numba', 'jax', 'scientific computing', 'quantitative economics', 'computational finance']
  },
  {
    ...QE,
    id: 'quantecon-advanced',
    repo: 'QuantEcon/lecture-python-advanced.notebooks',
    jbToc: 'https://raw.githubusercontent.com/QuantEcon/lecture-python-advanced.myst/main/lectures/_toc.yml',
    url: 'https://python-advanced.quantecon.org',
    title: 'Advanced Quantitative Economics with Python',
    area: 'quant',
    covers: 'Advanced lectures as runnable notebooks: asset pricing, the Kalman filter, recursive models, optimal taxation, competitive equilibria and dynamic programming',
    level: 'advanced',
    topics: ['asset pricing', 'kalman filter', 'dynamic programming', 'recursive economics', 'quantitative economics', 'python', 'stochastic discount factor']
  },

  // ---------- Economics ----------
  {
    ...QE,
    id: 'quantecon-intro',
    repo: 'QuantEcon/lecture-python-intro.notebooks',
    jbToc: 'https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/_toc.yml',
    url: 'https://intro.quantecon.org',
    title: 'A First Course in Quantitative Economics with Python',
    area: 'econ',
    covers: 'Economics with code you run: economic data, distributions and estimation, supply and demand, linear dynamics, present values, inflation and money, inequality, Markov chains and networks, with exercises',
    level: 'beginner',
    topics: ['economics', 'quantitative economics', 'inflation', 'supply and demand', 'inequality', 'markov chains', 'present value', 'python', 'economic data']
  },
  {
    ...QE,
    id: 'quantecon-intermediate',
    repo: 'QuantEcon/lecture-python.notebooks',
    jbToc: 'https://raw.githubusercontent.com/QuantEcon/lecture-python.myst/main/lectures/_toc.yml',
    url: 'https://python.quantecon.org',
    title: 'Intermediate Quantitative Economics with Python',
    area: 'econ',
    covers: 'The core QuantEcon series as runnable notebooks: probability and statistics, linear state space models, dynamic programming, search and savings problems, LQ control, information and asset pricing',
    level: 'intermediate',
    topics: ['quantitative economics', 'dynamic programming', 'markov chains', 'job search', 'savings', 'linear state space', 'bayesian learning', 'asset pricing', 'python']
  },
  {
    ...OCW,
    id: 'ocw-14-01-microeconomics',
    url: 'https://ocw.mit.edu/courses/14-01-principles-of-microeconomics-fall-2023/',
    title: 'Principles of Microeconomics (MIT 14.01)',
    by: 'Jonathan Gruber, MIT OpenCourseWare',
    area: 'econ',
    covers: 'How consumers and firms decide: supply and demand, consumer theory, costs and production, competition and monopoly, factor markets, uncertainty, welfare and market failures',
    level: 'beginner',
    topics: ['microeconomics', 'supply and demand', 'consumer theory', 'market structure', 'monopoly', 'welfare economics', 'market failure']
  },
  {
    ...OCW,
    id: 'ocw-14-02-macroeconomics',
    url: 'https://ocw.mit.edu/courses/14-02-principles-of-macroeconomics-spring-2023/',
    title: 'Principles of Macroeconomics (MIT 14.02)',
    by: 'Ricardo J. Caballero, MIT OpenCourseWare',
    area: 'econ',
    covers: 'The whole economy: output, unemployment and inflation, monetary and fiscal policy, interest rates and financial markets, open economies and exchange rates, growth and crises',
    level: 'beginner',
    topics: ['macroeconomics', 'monetary policy', 'fiscal policy', 'inflation', 'interest rates', 'exchange rates', 'economic growth', 'central banks']
  },
  {
    ...YALE,
    id: 'yale-econ-159-game-theory',
    url: 'https://oyc.yale.edu/economics/econ-159',
    title: 'Game Theory (Yale ECON 159)',
    by: 'Ben Polak, Open Yale Courses',
    area: 'econ',
    covers: 'Strategic thinking: dominance, Nash equilibrium, mixed strategies, evolutionary stability, sequential games and backward induction, repeated games, bargaining, auctions and signalling',
    level: 'beginner',
    topics: ['game theory', 'nash equilibrium', 'strategic thinking', 'auctions', 'bargaining', 'repeated games', 'signalling', 'mechanism design']
  },
  {
    ...YT,
    id: 'yt-mit-14-12-game-theory',
    playlist: 'PLUl4u3cNGP63quuKvMHCt3cmTmt0O2qpv',
    title: 'Economic Applications of Game Theory (MIT 14.12, 2025)',
    by: 'MIT OpenCourseWare on YouTube',
    area: 'econ',
    licence: 'CC BY-NC-SA 4.0 (MIT OpenCourseWare)',
    licenceNote: 'MIT OpenCourseWare’s videos are CC BY-NC-SA 4.0: watched in YouTube’s player, transcripts kept for your own study',
    covers: 'Twenty-five 2025 lectures on game theory applied to economics: equilibrium, information, auctions, bargaining and contracts',
    level: 'intermediate',
    topics: ['game theory', 'economics', 'auctions', 'bargaining', 'contracts', 'information economics']
  },
  {
    id: 'core-the-economy',
    source: 'site',
    url: 'https://www.core-econ.org/the-economy/microeconomics/0-3-contents.html',
    title: 'The Economy 2.0: Microeconomics',
    by: 'The CORE Team',
    area: 'econ',
    licence: 'CC BY-NC-ND 4.0',
    tier: 'personal',
    licenceNote: 'CC BY-NC-ND 4.0: read on this Mac for your own study, never passed on',
    covers: 'Economics as it is now taught, starting from data: prosperity and inequality, technology and incentives, firms and markets, supply and demand, lenders and borrowers, and the climate',
    kind: 'book',
    level: 'beginner',
    topics: ['economics', 'microeconomics', 'inequality', 'money and banking', 'markets', 'firms', 'supply and demand', 'lending and borrowing'],
    toc: 'ol.toc-list',
    maxPages: 160
  },
  {
    id: 'causal-mixtape',
    source: 'site',
    url: 'https://mixtape.scunning.com/',
    title: 'Causal Inference: The Mixtape',
    by: 'Scott Cunningham',
    area: 'econ',
    licence: 'All rights reserved (free to read online)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'Causal inference for economics and data science: DAGs, potential outcomes, matching, regression discontinuity, instrumental variables, panel data, difference-in-differences and synthetic control, with code',
    kind: 'book',
    level: 'intermediate',
    topics: ['causal inference', 'econometrics', 'difference in differences', 'instrumental variables', 'regression discontinuity', 'synthetic control', 'potential outcomes', 'dags']
  },

  // ---------- Machine learning and data science ----------
  {
    id: 'python-data-analysis-3e',
    source: 'site',
    url: 'https://wesmckinney.com/book/',
    title: 'Python for Data Analysis (3rd edition, open edition)',
    by: 'Wes McKinney',
    area: 'ml',
    licence: 'All rights reserved (open access to read); code MIT',
    tier: 'personal',
    licenceNote: 'The site’s text “may not be copied or reproduced”: read on this Mac for your own study only',
    covers: 'Data wrangling with pandas from its author: NumPy, pandas data structures, loading and cleaning data, joining and reshaping, plotting, group operations, time series and modelling libraries',
    kind: 'book',
    level: 'beginner',
    topics: ['pandas', 'numpy', 'data analysis', 'data wrangling', 'data cleaning', 'time series', 'python', 'data science']
  },
  {
    id: 'islp-labs',
    repo: 'intro-stat-learning/ISLP_labs',
    branch: 'main',
    title: 'An Introduction to Statistical Learning: the Python labs (ISLP)',
    by: 'Gareth James, Daniela Witten, Trevor Hastie, Robert Tibshirani and Jonathan Taylor',
    area: 'ml',
    licence: 'BSD-2-Clause',
    tier: 'open',
    covers: 'The labs of ISLP as runnable notebooks: linear regression, classification, resampling, model selection and regularisation, trees, SVMs, deep learning, survival analysis, unsupervised learning and multiple testing',
    kind: 'projects',
    level: 'intermediate',
    topics: ['statistical learning', 'machine learning', 'linear regression', 'classification', 'cross-validation', 'regularization', 'lasso', 'decision trees', 'svm', 'unsupervised learning', 'islp'],
    skip: ['README.md', 'Makefile']
  },
  {
    id: 'fpp3-forecasting',
    source: 'site',
    url: 'https://otexts.com/fpp3/index.html',
    title: 'Forecasting: Principles and Practice (3rd edition)',
    by: 'Rob J Hyndman and George Athanasopoulos',
    area: 'ml',
    licence: '© OTexts (free to read online)',
    tier: 'personal',
    licenceNote: PERSONAL_SITE,
    covers: 'Time-series forecasting: graphics, decomposition, benchmarks, exponential smoothing, ARIMA, dynamic regression, hierarchical forecasts and judging accuracy',
    kind: 'book',
    level: 'intermediate',
    topics: ['forecasting', 'time series', 'arima', 'exponential smoothing', 'time series decomposition', 'forecast accuracy']
  },
  {
    ...OCW,
    id: 'ocw-6-0002-data-science',
    url: 'https://ocw.mit.edu/courses/6-0002-introduction-to-computational-thinking-and-data-science-fall-2016/',
    title: 'Introduction to Computational Thinking and Data Science (MIT 6.0002)',
    by: 'John Guttag, Eric Grimson and Ana Bell, MIT OpenCourseWare',
    area: 'ml',
    covers: 'Computation for data: optimisation and graph problems, stochastic thinking, random walks, Monte Carlo simulation, sampling and confidence, experimental data, machine learning and statistical sins, in Python',
    level: 'beginner',
    topics: ['data science', 'monte carlo', 'simulation', 'statistics', 'machine learning', 'optimization', 'python', 'random walks']
  },
  {
    ...OCW,
    id: 'ocw-18-650-statistics',
    url: 'https://ocw.mit.edu/courses/18-650-statistics-for-applications-fall-2016/',
    title: 'Statistics for Applications (MIT 18.650)',
    by: 'Philippe Rigollet, MIT OpenCourseWare',
    area: 'ml',
    covers: 'The mathematics of statistics: estimation, maximum likelihood, hypothesis testing, Bayesian statistics, linear regression, generalised linear models and principal component analysis',
    level: 'intermediate',
    topics: ['statistics', 'maximum likelihood', 'hypothesis testing', 'bayesian statistics', 'linear regression', 'glm', 'pca', 'statistical inference']
  },
  {
    ...OCW,
    id: 'ocw-18-05-probability-statistics',
    url: 'https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/',
    title: 'Introduction to Probability and Statistics (MIT 18.05)',
    area: 'ml',
    covers: 'Probability and statistics from the ground up: counting, random variables, distributions, Bayesian updating, frequentist inference, confidence intervals and the bootstrap, with reading notes and problem sets',
    level: 'beginner',
    topics: ['probability', 'statistics', 'bayesian inference', 'confidence intervals', 'bootstrap', 'random variables', 'hypothesis testing']
  },
  {
    ...YT,
    id: 'yt-stanford-cs229',
    playlist: 'PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU',
    title: 'Machine Learning (Stanford CS229, 2018)',
    by: 'Andrew Ng, Stanford Online',
    area: 'ml',
    covers: 'The full CS229 lecture series: supervised learning, generalised linear models, generative models, kernels and SVMs, learning theory, neural networks, unsupervised learning and reinforcement learning',
    level: 'intermediate',
    topics: ['machine learning', 'supervised learning', 'logistic regression', 'svm', 'kernels', 'neural networks', 'em algorithm', 'reinforcement learning', 'learning theory']
  },

  // ---------- Deep learning and LLMs ----------
  {
    ...OCW,
    id: 'ocw-6-7960-deep-learning',
    url: 'https://ocw.mit.edu/courses/6-7960-deep-learning-fall-2024/',
    title: 'Deep Learning (MIT 6.7960, 2024)',
    by: 'Phillip Isola and others, MIT OpenCourseWare',
    area: 'dl',
    covers: 'A graduate course in deep learning: networks and backpropagation, architectures, generalisation, generative models, representation learning, transformers and scaling',
    level: 'advanced',
    topics: ['deep learning', 'neural networks', 'backpropagation', 'transformers', 'generative models', 'representation learning']
  },
  {
    ...YT,
    id: 'yt-stanford-cs224n',
    playlist: 'PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ',
    title: 'NLP with Deep Learning (Stanford CS224N, 2021)',
    by: 'Christopher Manning, Stanford Online',
    area: 'dl',
    covers: 'Word vectors, neural networks and backpropagation, dependency parsing, recurrent networks, machine translation and attention, transformers, pretraining, question answering and generation',
    level: 'intermediate',
    topics: ['natural language processing', 'nlp', 'word vectors', 'word2vec', 'rnn', 'attention', 'transformers', 'pretraining', 'language models']
  },
  {
    ...YT,
    id: 'yt-stanford-cs336',
    playlist: 'PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_',
    title: 'Language Modeling from Scratch (Stanford CS336, 2025)',
    by: 'Percy Liang and Tatsunori Hashimoto, Stanford Online',
    area: 'dl',
    covers: 'Building a language model end to end: tokenisation, the transformer, training on GPUs, kernels and parallelism, scaling laws, data, evaluation and alignment',
    level: 'advanced',
    topics: ['language models', 'llm', 'transformers', 'tokenization', 'gpu', 'scaling laws', 'pretraining', 'alignment']
  },

  // ---------- Systems and databases ----------
  {
    ...YT,
    id: 'yt-cmu-15-445',
    playlist: 'PLSE8ODhjZXjYMAgsGH-GtY5rJYZ6zjsd5',
    title: 'Intro to Database Systems (CMU 15-445/645, 2025)',
    by: 'Andy Pavlo, CMU Database Group',
    area: 'systems',
    covers: 'How a database works inside: storage and buffer pools, indexes and B+trees, query execution and optimisation, concurrency control, logging and recovery, distributed databases',
    level: 'intermediate',
    topics: ['databases', 'database internals', 'b+ tree', 'query optimization', 'concurrency control', 'transactions', 'recovery', 'buffer pool', 'storage engines']
  },
  {
    ...YT,
    id: 'yt-cmu-15-721',
    playlist: 'PLSE8ODhjZXjYa_zX-KeMJui7pcN1rIaIJ',
    title: 'Advanced Database Systems (CMU 15-721, 2024)',
    by: 'Andy Pavlo, CMU Database Group',
    area: 'data',
    covers: 'Analytical (OLAP) database systems as data warehouses build them: columnar storage, compression, vectorised execution, query compilation, joins, scheduling and optimisers',
    level: 'advanced',
    topics: ['data warehouse', 'olap', 'columnar storage', 'vectorized execution', 'query compilation', 'query optimization', 'analytical databases']
  },

  // ---------- Software engineering ----------
  {
    id: 'mit-6031-software-construction',
    source: 'site',
    url: 'https://web.mit.edu/6.031/www/sp22/',
    title: 'Software Construction (MIT 6.031)',
    by: 'MIT EECS 6.031 staff',
    area: 'swe',
    licence: 'CC BY-SA 4.0',
    tier: 'open',
    licenceNote: 'The readings are CC BY-SA 4.0, as the course site’s footer states',
    covers: 'Writing code that is safe from bugs, easy to understand and ready for change: static checking, testing, specifications, abstract data types, interfaces, recursion, concurrency and grammars, in TypeScript',
    kind: 'course',
    level: 'intermediate',
    topics: ['software engineering', 'software construction', 'testing', 'specifications', 'abstract data types', 'concurrency', 'typescript', 'code review'],
    toc: '[data-outline="readings"]'
  },

  // ---------- Maths ----------
  {
    ...OCW,
    id: 'ocw-18-06-linear-algebra',
    url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/',
    title: 'Linear Algebra (MIT 18.06)',
    by: 'Gilbert Strang, MIT OpenCourseWare',
    area: 'maths',
    covers: 'Strang’s famous course: systems of equations, vector spaces, orthogonality and least squares, determinants, eigenvalues, positive definite matrices and the SVD',
    level: 'beginner',
    topics: ['linear algebra', 'matrices', 'eigenvalues', 'eigenvectors', 'least squares', 'svd', 'vector spaces', 'determinants']
  }
]
