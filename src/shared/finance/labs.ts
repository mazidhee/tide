/**
 * The finance labs: which one fits a lesson's topic, and what the tutor is told about it. Each lab
 * has a live simulation (src/renderer/src/lib/sims/kinds), runnable Python (the tide_finance helper
 * module in Tide's sandbox, NumPy and pandas only: SciPy is never needed), and where data helps,
 * tables in the SQL lab. The labs work the same for Claude and for Gemma: the simulations and the
 * helper compute every number, the model only explains and asks.
 *
 * Self-contained so the maths ladder (and anything else) can link straight to one by id.
 */

export type FinanceLabId = 'ledger' | 'payments' | 'iso20022' | 'stablecoin' | 'var' | 'options' | 'backtest' | 'market-data'

export interface FinanceLab {
  id: FinanceLabId
  title: string
  /** One line: what you do in it */
  what: string
  /** What a lesson's topic says for this lab to fit */
  topics: RegExp
  /** The simulation kind that shows it, if any */
  sim?: 'ledger' | 'payments' | 'stablecoin' | 'risk'
  /** A ready simulation block (JSON), to open from the lab list or the maths ladder */
  example?: string
  /** Python that runs as is in Tide's sandbox */
  python: string
  /** Tables in the SQL lab this lab uses */
  tables?: string[]
}

export const FINANCE_LABS: FinanceLab[] = [
  {
    id: 'ledger',
    title: 'Double-entry ledger and a core bank',
    what: 'Post deposits, transfers, loans and fees as balanced entries, run end of day, and watch the trial balance and the accounting equation hold.',
    topics: /\b(double[- ]entry|ledgers?|general ledger|journal entr\w*|debits? and credits?|trial balance|core banking|core bank\w*|posting|accounting equation|interest accrual|end[- ]of[- ]day|bookkeeping|money creation)\b/i,
    sim: 'ledger',
    example: '{"kind":"ledger","title":"A bank\'s books","capital":500000,"customers":["Ada","Bo"],"ops":[{"deposit":["Ada",200000]},{"transfer":["Ada","Bo",50000]},{"loan":["Bo",300000,0.08]}]}',
    python: `import tide_finance as tf
bank = tf.CoreBank(capital=5_000_00)
ada = bank.open_deposit("Ada")
bo = bank.open_deposit("Bo", rate=0.02)
bank.deposit_cash(ada, 2_000_00)
bank.transfer(ada, bo, 500_00)
bank.disburse_loan(bo, 3_000_00, rate=0.08)
bank.end_of_day()
print(bank.gl.trial_balance())
print("balanced:", bank.gl.balanced())`,
    tables: ['bank_customers', 'gl_accounts', 'postings']
  },
  {
    id: 'payments',
    title: 'Payment settlement: RTGS, netting, instant and cards',
    what: 'Send payments between banks and settle them gross in real time, net at the end of the day, instantly from prefunded positions, or through a card scheme with its fees.',
    topics: /\b(settlement|clearing|rtgs|real[- ]time gross|deferred net|netting|net settlement|payment rails?|payment systems?|payment infrastructure|instant payments?|faster payments|fednow|tips|sct inst|ach|chaps|fedwire|target2|\bt2\b|card (payments?|schemes?)|interchange|acquir\w+|issuer|merchant service charge|liquidity saving|gridlock|correspondent banking|nostro|vostro)\b/i,
    sim: 'payments',
    example: '{"kind":"payments","mode":"rtgs","banks":{"A":100,"B":50,"C":20},"payments":[["A","B",80],["B","C",120],["C","A",60]]}',
    python: `import tide_finance as tf
pays = [("A", "B", 80), ("B", "C", 120), ("C", "A", 60), ("A", "C", 30)]
print(tf.rtgs({"A": 100, "B": 50, "C": 20}, pays))
print(tf.multilateral_net(pays))
print(tf.netting_summary(pays))
print(tf.card_purchase(10_000))`
  },
  {
    id: 'iso20022',
    title: 'ISO 20022 messages: pain.001, pacs.008, camt.053',
    what: 'Build a customer payment order, the bank-to-bank transfer and the statement that reports it; break a field and see what a gateway rejects; reconcile the statement.',
    topics: /\b(iso ?20022|pain\.001|pacs\.00[2489]|camt\.0(5[234]|56|29)|swift mx|cbpr\+?|mx messages?|mt ?103|payment messag\w*|ibans?|bics?|swift codes?|remittance information|reconcil\w+)\b/i,
    sim: 'payments',
    example: '{"kind":"payments","mode":"iso20022","payments":[["A","B",125.5]]}',
    python: `import tide_finance as tf
ada, bo = tf.EXAMPLE_PARTIES["ada"], tf.EXAMPLE_PARTIES["bo"]
xml = tf.pacs008("MSG-001", "2026-03-02T09:30:00", "2026-03-02",
                 [tf.Transfer("E2E-1", 12550, "EUR", ada, bo, "Invoice 77")])
print(xml)
print(tf.read_message(xml)["problems"])
print(tf.valid_iban("DE89370400440532013000"))`
  },
  {
    id: 'stablecoin',
    title: 'Stablecoin mechanics: mint, redeem, reserves and depegs',
    what: 'Mint and redeem against reserves, watch arbitrage hold the peg, then fail a reserve bank, start a run with fire sales, or let an algorithmic coin spiral.',
    topics: /\b(stablecoins?|usdc|usdt|tether|dai|peg|depeg\w*|de-peg\w*|mint and redeem|redemptions?|reserves? backing|algorithmic stablecoins?|terra|ust|luna|tokeni[sz]ed deposits?|e-money)\b/i,
    sim: 'stablecoin',
    example: '{"kind":"stablecoin","scenario":"bank-failure"}',
    python: `import tide_finance as tf
for scenario in ["calm", "bank-failure", "run", "algorithmic"]:
    days = tf.stablecoin(scenario)
    print(scenario, tf.depeg_stats(days))`
  },
  {
    id: 'var',
    title: 'Value at Risk and stress tests',
    what: 'Historical, parametric and Monte Carlo VaR and expected shortfall on one portfolio, a VaR backtest with Kupiec’s test, and stress scenarios.',
    topics: /\b(value[- ]at[- ]risk|expected shortfall|cvar|conditional value at risk|market risk|risk management|stress tests?|stress testing|scenario analysis|backtesting var|kupiec|basel|frtb|tail risk|volatility clustering|garch)\b/i,
    sim: 'risk',
    example: '{"kind":"risk","mode":"var","method":"historical","level":0.99}',
    python: `import tide_finance as tf
prices = tf.sample_prices("TIDX")
r = prices.pct_change().dropna()
print("historical:", tf.historical_var(r, 0.99))
print("parametric:", tf.parametric_var(r.mean(), r.std(), 0.99))
print("monte carlo:", tf.monte_carlo_var(r.mean(), r.std(), 0.99, n=20_000))
print(tf.var_backtest(r, window=250, level=0.99))`,
    tables: ['prices']
  },
  {
    id: 'options',
    title: 'Monte Carlo and option pricing',
    what: 'Price a European option with Black-Scholes and by Monte Carlo, watch the estimate converge as 1/√n, and see what antithetic draws save.',
    topics: /\b(options? pricing|black[- ]?scholes|monte carlo|european options?|call options?|put options?|greeks|delta hedg\w*|implied volatility|geometric brownian motion|gbm|risk[- ]neutral|put[- ]call parity|derivatives pricing)\b/i,
    sim: 'risk',
    example: '{"kind":"risk","mode":"option","spot":100,"strike":105,"years":1,"rate":0.03,"vol":0.2,"type":"call"}',
    python: `import tide_finance as tf
print(tf.black_scholes(100, 105, 1, 0.03, 0.2, "call"))
for n in [1_000, 10_000, 100_000]:
    print(n, tf.mc_european(100, 105, 1, 0.03, 0.2, "call", n=n))`
  },
  {
    id: 'backtest',
    title: 'Backtesting a trading rule',
    what: 'Backtest a moving-average crossover on the sample prices without look-ahead, with costs, and compare it with buy and hold by return, Sharpe ratio and drawdown.',
    topics: /\b(backtest\w*|trading strateg\w*|moving average crossover|momentum strateg\w*|sharpe ratio|drawdowns?|look[- ]ahead bias|overfitting|transaction costs|alpha research|systematic trading|quant(itative)? trading)\b/i,
    sim: 'risk',
    example: '{"kind":"risk","mode":"backtest","ticker":"TIDX","fast":20,"slow":100,"cost":0.001}',
    python: `import tide_finance as tf
prices = tf.sample_prices("PAYX")
result = tf.sma_crossover(prices, fast=20, slow=100, cost=0.001)
print({k: v for k, v in result.items() if k != "equity"})`,
    tables: ['prices']
  },
  {
    id: 'market-data',
    title: 'Market data in SQL and Python',
    what: 'Yield curves, exchange rates and sample prices in the SQL lab and in pandas: returns with window functions, curve shapes, correlations.',
    topics: /\b(market data|yield curves?|treasury yields?|exchange rates?|fx rates?|returns|time series|financial data|asset prices?|correlations?|volatility|financial econometrics|computational finance)\b/i,
    python: `import tide_finance as tf
curve = tf.treasury_yields()
print(curve[["y_3m", "y_2y", "y_10y"]].tail())
print((curve["y_10y"] - curve["y_3m"]).describe())
fx = tf.fx_rates()
print(fx["usd_per_eur"].pct_change().std() * 252 ** 0.5)`,
    tables: ['prices', 'treasury_yields', 'fx_rates']
  }
]

export const financeLab = (id: string) => FINANCE_LABS.find((l) => l.id === id)

/** The labs a topic names, best first (by where in the list it sits) */
export const financeLabsFor = (topic: string): FinanceLab[] => FINANCE_LABS.filter((l) => l.topics.test(topic) || (l.id === 'var' && VAR_ABBREVIATION.test(topic)))

/** "VaR" as finance writes it, case and all: "var" alone is as likely a JavaScript keyword */
const VAR_ABBREVIATION = /\bVaR\b/

/** Whether the lesson's lab should hold the finance tables */
export const wantsFinanceTables = (topic: string) => financeLabsFor(topic).some((l) => l.tables?.length)

/**
 * What a lesson on this topic is told about its finance labs: the Python helper (with the one
 * example that fits best) and the tables. '' when no lab fits. Short: it rides in every turn.
 */
export function financeLabNote(topic: string): string {
  const labs = financeLabsFor(topic)
  if (!labs.length) return ''
  const best = labs[0]
  const tables = [...new Set(labs.flatMap((l) => l.tables ?? []))]
  return [
    `Finance lab for this topic (${labs.map((l) => l.title).join('; ')}). In run_code and the student's Python, \`import tide_finance as tf\` gives tested helpers built on NumPy and pandas (no SciPy needed): ledgers and a core bank, RTGS and netting, card fees, ISO 20022 messages and IBAN checks, stablecoin scenarios, Black-Scholes and Monte Carlo pricing, VaR and expected shortfall, backtests, and the market data. Let the student write the core of the calculation themselves first; use the helper to check it. For example:`,
    '```python',
    best.python,
    '```',
    tables.length ? `The SQL lab holds ${tables.join(', ')} for this lesson.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
