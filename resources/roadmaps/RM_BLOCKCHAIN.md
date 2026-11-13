# Blockchain Roadmap

How blockchains work from the bottom up: hashes, signatures, consensus, Bitcoin's UTXOs, Ethereum's accounts and contracts, and how they scale. Practise with Tide's blockchain simulation.

## 1. Cryptographic building blocks — CORE

### Primitives

- [ ] Hash functions: SHA-256, collision and preimage resistance
- [ ] Merkle trees and inclusion proofs
- [ ] Public-key cryptography and digital signatures (ECDSA, Schnorr)
- [ ] Addresses and how they are derived
    - _Mastering Bitcoin — Andreas M. Antonopoulos and David A. Harding_

### Practice

- [ ] Practice: Problem set, build a Merkle tree and verify an inclusion proof by hand and in Python

## 2. Bitcoin — CORE

### The design

- [ ] The double-spending problem
- [ ] Proof of work and the longest chain
- [ ] Blocks, headers and difficulty adjustment
- [ ] Transactions and UTXOs
- [ ] Script: P2PKH, P2SH, SegWit and Taproot
- [ ] Mining incentives: subsidy, fees and halving
    - _Bitcoin: A Peer-to-Peer Electronic Cash System — Satoshi Nakamoto_
    - _Bitcoin developer guide — Bitcoin developer documentation_

### Practice

- [ ] Practice: Case study, mine, tamper with and fork a chain in the blockchain lab and explain which chain honest nodes follow

## 3. Ethereum and smart contracts — CORE

### The machine

- [ ] Accounts, nonces and state
- [ ] Transactions and gas
- [ ] The Ethereum Virtual Machine
- [ ] Proof of stake: validators, finality and slashing
    - _The Ethereum Virtual Machine — ethereum.org_
    - _Ethereum transactions — ethereum.org_

### Contracts

- [ ] Solidity basics: storage, functions, events
- [ ] Token standards: ERC-20 and ERC-721
- [ ] Common vulnerabilities: reentrancy, overflow, access control
- [ ] Oracles
    - _Solidity documentation — Solidity_

### Practice

- [ ] Practice: Problem set, write and test an ERC-20 token and show a reentrancy bug and its fix

## 4. Scaling and finance — SUPPORTING

### Scaling

- [ ] Payment channels and the Lightning Network
- [ ] Rollups: optimistic and zero-knowledge
- [ ] Bridges and their risks
    - _Ethereum scaling — ethereum.org_

### Decentralised finance

- [ ] Automated market makers and impermanent loss
- [ ] Lending protocols and liquidations
- [ ] Stablecoins (see the Stablecoins roadmap)
- [ ] MEV
    - _DeFi and the Future of Finance — Campbell Harvey, Ashwin Ramachandran and Joey Santoro_

**Capstone Projects**

- [ ] Project: A small blockchain from scratch with signed transactions, a Merkle root per block, proof of work and fork choice, with tests
