# Payments and Payment Rails Roadmap

How money moves: who is in a payment, the rails it travels on, how it clears and settles, and what can go wrong. Practise in Tide's payments lab (RTGS, netting, instant, cards) and ISO 20022 lab.

## 1. Foundations — CORE

### What a payment is

- [ ] Payer, payee, their banks, and the settlement agent
- [ ] Money as claims: central bank money, commercial bank money, e-money
- [ ] Push and pull payments: credit transfers and direct debits
- [ ] Authorisation, clearing and settlement as three separate steps
- [ ] Settlement finality and why it matters
    - _Fast payments: enhancing the speed and availability of retail payments — CPMI (BIS)_
    - _Money creation in the modern economy — Bank of England Quarterly Bulletin 2014 Q1_

### Settlement models

- [ ] Real-time gross settlement (RTGS): Fedwire, CHAPS, T2
- [ ] Deferred net settlement: ACH, Bacs, card schemes
- [ ] Bilateral and multilateral netting, and the liquidity they save
- [ ] Queues, gridlock and liquidity-saving mechanisms
- [ ] Intraday credit and collateral at the central bank
- [ ] Settlement risk when a participant fails before settlement
    - _Principles for financial market infrastructures — CPMI and IOSCO_
    - _Fedwire Funds Service — Federal Reserve Board_
    - _T2 — European Central Bank_

### Practice

- [ ] Practice: Case study, settle a day of payments gross and net in the payments lab and explain the difference in liquidity

## 2. The rails — CORE

### Retail credit transfers and direct debits

- [ ] ACH in the US: NACHA rules, same-day ACH, returns
- [ ] SEPA Credit Transfer and SEPA Direct Debit
- [ ] UK Faster Payments and Bacs
- [ ] Mandates, returns and R-transactions
    - _FedACH — Federal Reserve Board_
    - _SEPA rulebooks — European Payments Council_

### Instant payments

- [ ] What makes a payment instant: 24/7, seconds, final
- [ ] FedNow and RTP in the US
- [ ] SCT Inst and TIPS in the euro area
- [ ] UPI and Pix: overlay schemes and national switches
- [ ] Prefunding, limits and rejection instead of queuing
- [ ] Confirmation of payee and authorised push-payment fraud
    - _FedNow Service — Federal Reserve Board_
    - _TIPS — European Central Bank_
    - _Fast payments — CPMI (BIS)_

### Card payments

- [ ] The four-party model: cardholder, issuer, scheme, acquirer, merchant
- [ ] Authorisation (ISO 8583) and capture
- [ ] Clearing, settlement and the merchant's payout
- [ ] Interchange, scheme fees and the merchant service charge
- [ ] EMV chip, contactless and tokenisation
- [ ] Chargebacks and disputes
    - _Payment tokenisation — EMVCo_
    - _How disputes work — Stripe documentation_

### Practice

- [ ] Practice: Case study, follow an €80 debit card purchase from tap to payout and account for every cent of fees

## 3. Cross-border and messaging — CORE

### Correspondent banking

- [ ] Nostro and vostro accounts
- [ ] Serial and cover payments (MT 103 and MT 202 COV)
- [ ] Why cross-border payments are slow and expensive: the G20 targets
- [ ] FX in payments: conversion, spreads, pre-funding
    - _Enhancing cross-border payments — CPMI (BIS)_

### ISO 20022

- [ ] The ISO 20022 methodology: business model, message model, XML
- [ ] pain.001: a customer's credit transfer initiation
- [ ] pacs.008: the FI-to-FI customer credit transfer
- [ ] pacs.002 and pacs.004: status and returns
- [ ] camt.053 and camt.054: statements and notifications
- [ ] IBAN and BIC: structure and check digits
- [ ] Structured remittance information and end-to-end ids
- [ ] Reconciling a statement against expected payments
    - _Harmonised ISO 20022 data requirements for enhancing cross-border payments — CPMI (BIS)_
    - _ISO 20022 implementation for Fedwire Funds — Federal Reserve Financial Services_

### Practice

- [ ] Practice: Case study, build a pain.001, its pacs.008 and the camt.053 that reports it, then break each field and say what the gateway rejects

## 4. Risk, regulation and the future — SUPPORTING

### Payment risk and compliance

- [ ] Credit, liquidity and operational risk in payment systems
- [ ] Sanctions screening and AML in payments
- [ ] Strong customer authentication (PSD2)
- [ ] Fraud: card-not-present, APP scams, mule accounts
    - _Payment services and electronic money — European Banking Authority_

### New rails

- [ ] Stablecoins as a payment rail
- [ ] Tokenised deposits and the unified ledger
- [ ] Central bank digital currencies, retail and wholesale
    - _The next-generation monetary and financial system — BIS Annual Economic Report 2025_

**Capstone Projects**

- [ ] Project: A payment switch that accepts pain.001, validates it, settles it gross or net against a ledger, and produces camt.053 statements, with tests
