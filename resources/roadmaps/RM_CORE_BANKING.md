# Core Banking Roadmap

What a bank's core system does: accounts, postings, interest, loans and the end-of-day run, and how money is created on its balance sheet. Practise in Tide's ledger lab and the SQL lab's journal tables.

## 1. The bank's balance sheet — CORE

### Banks and money

- [ ] A bank's balance sheet: assets, liabilities, equity
- [ ] Deposits as the bank's liabilities
- [ ] How lending creates deposits
- [ ] Reserves, central bank money and settlement between banks
- [ ] Capital and why it absorbs losses
    - _Money creation in the modern economy — Bank of England Quarterly Bulletin 2014 Q1_

### Double-entry bookkeeping

- [ ] Debits, credits and normal balances
- [ ] Journal entries that balance
- [ ] The general ledger and the chart of accounts
- [ ] The trial balance and the accounting equation
- [ ] Accruals versus cash
    - _Financial Accounting — Libby, Libby and Short_

### Practice

- [ ] Practice: Case study, post a customer's deposit, a transfer, a loan and a fee in the ledger lab and explain every line of the balance sheet

## 2. The core system — CORE

### Accounts and products

- [ ] Customers, accounts and products
- [ ] Current accounts, savings and term deposits
- [ ] Overdrafts and balance checks
- [ ] Holds, available versus ledger balance
    - _Apache Fineract documentation — Apache Software Foundation_

### Interest and fees

- [ ] Day-count conventions: actual/365, actual/360, 30/360
- [ ] Daily accrual and monthly capitalisation
- [ ] Rounding rules and banker's rounding
- [ ] Fee schedules and their postings
    - _Apache Fineract documentation — Apache Software Foundation_

### Lending

- [ ] Loan disbursement and its postings
- [ ] Amortisation schedules: annuity and straight-line
- [ ] Arrears, provisioning and write-offs (IFRS 9 stages)
    - _IFRS 9 Financial Instruments — IFRS Foundation_

### End of day

- [ ] Batch jobs: accrual, capitalisation, statements
- [ ] Cut-offs and value dates
- [ ] Reconciliation of the general ledger with sub-ledgers
    - _TigerBeetle documentation — TigerBeetle_

### Practice

- [ ] Practice: Case study, accrue 30 days of interest on a savings book with daily rounding and reconcile it to the general ledger

## 3. Regulation and architecture — SUPPORTING

### Prudential rules

- [ ] Basel III capital ratios
- [ ] The liquidity coverage ratio and net stable funding ratio
- [ ] Deposit insurance
    - _Basel Framework — Basel Committee on Banking Supervision_

### Modern cores

- [ ] Mainframe cores and why banks keep them
- [ ] Event-sourced and API-first cores
- [ ] Real-time posting versus batch
- [ ] Migrating a core: parallel runs and reconciliation
    - _Designing Data-Intensive Applications — Martin Kleppmann_

**Capstone Projects**

- [ ] Project: A small core bank: customers, accounts, a double-entry ledger, interest accrual, loans and an end-of-day run, with SQL reports and tests that the books always balance
