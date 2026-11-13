# Quantitative Finance Roadmap

Pricing, hedging and trading with models: returns and their statistics, the time value of money, derivatives from binomial trees to Black-Scholes and Monte Carlo, and systematic strategies. Practise in Tide's risk lab and the Python helper (NumPy and pandas; SciPy only when the lab pack is installed).

## 1. Returns and data — CORE

### Returns

- [ ] Simple and log returns, and compounding
- [ ] Mean, volatility and annualising
- [ ] Fat tails and volatility clustering
- [ ] Correlation and covariance matrices
    - _Heavy-tailed distributions — QuantEcon_
    - _Introduction to Computational Finance and Financial Econometrics — Eric Zivot_

### Market data

- [ ] Prices, adjustments and survivorship bias
- [ ] Yield curves from Treasury data
- [ ] Exchange rates and cross rates
- [ ] Returns in SQL with window functions and in pandas
    - _Python for Data Analysis — Wes McKinney_

### Practice

- [ ] Practice: Problem set, compute returns, volatility and correlations from the lab's prices in SQL and in pandas and reconcile the two

## 2. Fixed income and the time value of money — CORE

### Discounting

- [ ] Present value and annuities
- [ ] Yield to maturity and the price-yield relationship
- [ ] Duration and convexity
- [ ] Zero, par and forward curves; bootstrapping
    - _Present values — QuantEcon_
    - _Fixed Income Securities — Bruce Tuckman and Angel Serrat_

### Practice

- [ ] Practice: Problem set, price a bond off the Treasury curve in the lab and estimate its duration by bumping the curve

## 3. Derivatives — CORE

### Foundations

- [ ] Forwards, futures and no-arbitrage pricing
- [ ] Options: payoffs, put-call parity
- [ ] The binomial model and risk-neutral pricing
    - _Options, Futures, and Other Derivatives — John C. Hull_

### Continuous time

- [ ] Brownian motion and geometric Brownian motion
- [ ] Itô's lemma, informally
- [ ] The Black-Scholes formula and its assumptions
- [ ] The Greeks and delta hedging
- [ ] Implied volatility and the smile
    - _Options, Futures, and Other Derivatives — John C. Hull_
    - _Stochastic Calculus for Finance II — Steven Shreve_

### Monte Carlo

- [ ] Monte Carlo pricing and its standard error
- [ ] Antithetic variates and control variates
- [ ] Path-dependent options
    - _Monte Carlo and option pricing — QuantEcon_
    - _Monte Carlo Methods in Financial Engineering — Paul Glasserman_

### Practice

- [ ] Practice: Problem set, price a call by Black-Scholes and by Monte Carlo in the risk lab and show the error falls as 1/√n

## 4. Portfolios and strategies — CORE

### Portfolio theory

- [ ] Mean-variance optimisation and the efficient frontier
- [ ] CAPM and beta
- [ ] Factor models
    - _Investments — Bodie, Kane and Marcus_

### Systematic trading

- [ ] Backtesting without look-ahead
- [ ] Transaction costs and turnover
- [ ] Sharpe ratio, drawdown and their pitfalls
- [ ] Overfitting and the deflated Sharpe ratio
    - _Advances in Financial Machine Learning — Marcos López de Prado_

### Practice

- [ ] Practice: Problem set, backtest a moving-average crossover with costs in the risk lab and argue whether its edge is real

**Capstone Projects**

- [ ] Project: A small pricing library (Black-Scholes, binomial tree, Monte Carlo) with tests against each other and put-call parity, and a backtest of one strategy on the lab's data
