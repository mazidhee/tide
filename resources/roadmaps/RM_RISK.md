# Risk Roadmap

Measuring and managing financial risk: market risk with VaR and expected shortfall, stress tests, credit and liquidity risk, and the Basel rules that set capital. Practise in Tide's risk lab.

## 1. Measuring market risk — CORE

### Value at Risk

- [ ] What VaR is, and what it is not
- [ ] Historical simulation
- [ ] Parametric (variance-covariance) VaR
- [ ] Monte Carlo VaR
- [ ] Portfolio VaR and diversification
- [ ] Scaling over time: the square-root-of-time rule and its limits
    - _Value at Risk — Philippe Jorion_
    - _Heavy-tailed distributions — QuantEcon_

### Expected shortfall

- [ ] Expected shortfall and coherent risk measures
- [ ] Why Basel moved from 99% VaR to 97.5% ES
    - _MAR33: Internal models approach, capital requirements calculation — Basel Framework (BIS)_

### Backtesting

- [ ] Exceptions and the Kupiec proportion-of-failures test
- [ ] Basel's traffic-light zones
- [ ] Christoffersen's independence test
    - _MAR32: Internal models approach, backtesting and P&L attribution — Basel Framework (BIS)_

### Practice

- [ ] Practice: Problem set, compute historical, parametric and Monte Carlo VaR and ES on the lab's prices and backtest them with Kupiec's test

## 2. Beyond VaR — CORE

### Stress testing

- [ ] Historical and hypothetical scenarios
- [ ] Reverse stress tests
- [ ] Supervisory stress tests (CCAR, EBA)
    - _Minimum capital requirements for market risk (FRTB) — Basel Committee on Banking Supervision_

### Credit risk

- [ ] Probability of default, loss given default, exposure at default
- [ ] Expected and unexpected loss
- [ ] Counterparty credit risk
    - _Basel Framework — Basel Committee on Banking Supervision_

### Liquidity risk

- [ ] Funding and market liquidity
- [ ] The LCR and NSFR
- [ ] Runs: banks and stablecoins
    - _Runs and flights to safety — Federal Reserve Bank of New York, Staff Report 1073_

### Practice

- [ ] Practice: Case study, stress a multi-asset portfolio under four scenarios in the risk lab and write a one-page risk report

## 3. Capital and governance — SUPPORTING

### Basel

- [ ] The three pillars
- [ ] FRTB: standardised and internal models approaches
- [ ] Operational risk
    - _Minimum capital requirements for market risk (FRTB) — Basel Committee on Banking Supervision_

### Model risk

- [ ] Model validation
- [ ] Limits, risk appetite and governance
    - _Risk Management and Financial Institutions — John C. Hull_

**Capstone Projects**

- [ ] Project: A risk engine that computes daily VaR and ES three ways for a portfolio, backtests them, runs stress scenarios and writes a report
