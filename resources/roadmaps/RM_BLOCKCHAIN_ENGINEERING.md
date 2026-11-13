# Blockchain Engineering Roadmap

Building on blockchains: applied cryptography, consensus as it really runs, the EVM in depth, Solidity with Foundry, security and auditing, and layer 2s. Builds on the Blockchain roadmap (hashes, Bitcoin and Ethereum basics); practise in Tide's blockchain lab.

## 1. Applied cryptography — CORE

Courses: Cryptocurrency Engineering and Design (ocw-mas-s62-crypto-engineering)

### Primitives in practice

- [ ] Elliptic curves: secp256k1 and point arithmetic
- [ ] ECDSA signatures, nonces and public key recovery
- [ ] Keccak-256, and why Ethereum's hash isn't quite SHA-3
- [ ] Hierarchical deterministic wallets (BIP-32 and BIP-39)
- [ ] Signing typed structured data (EIP-712)
- [ ] BLS signatures and aggregation
- [ ] Merkle-Patricia tries
    - _A Graduate Course in Applied Cryptography — Dan Boneh and Victor Shoup_
    - _Programming Bitcoin — Jimmy Song_

### Practice

- [ ] Practice: Problem set, sign a transaction by hand, recover the address from the signature, and show what a reused nonce leaks

**Capstone**

- [ ] Project: Signed transactions and UTXOs over a hash chain (project: utxo-ledger)

## 2. Consensus engineering — CORE

### Protocols

- [ ] Byzantine fault tolerance and the FLP result
- [ ] PBFT and Tendermint
- [ ] Nakamoto consensus: forks, reorgs and confirmations
- [ ] Gasper: LMD-GHOST and Casper FFG
- [ ] Validators, committees and attestations
- [ ] Finality, slashing and the inactivity leak
- [ ] Peer-to-peer networking: gossip, devp2p and libp2p
    - _Ethereum consensus specifications — Ethereum Foundation_
    - _Upgrading Ethereum — Ben Edgington_

### Practice

- [ ] Practice: Case study, walk through a reorg in the blockchain lab and say which block each node finalises

**Capstone**

- [ ] Project: A blockchain from scratch with a P2P network and fork choice (project: blockchain)

## 3. The EVM in depth — CORE

Courses: Ethereum’s developer docs (ethereum-docs)

### Execution

- [ ] The EVM's stack, memory and storage
- [ ] Opcodes and gas costs
- [ ] CALL, DELEGATECALL, STATICCALL and the call context
- [ ] Contract creation: CREATE and CREATE2
- [ ] The ABI: encoding calls and events
- [ ] Transaction types and EIP-1559 fees
- [ ] Storage layout and proxies
    - _Ethereum Yellow Paper — Gavin Wood_
    - _evm.codes — evm.codes contributors_

### Practice

- [ ] Practice: Problem set, trace a transaction opcode by opcode and account for every unit of gas

**Capstone**

- [ ] Project: An EVM interpreter in Python that runs real contract bytecode for a core set of opcodes, checked against known results

## 4. Solidity engineering — CORE

### The language

- [ ] Solidity types, storage and memory
- [ ] Functions, modifiers and visibility
- [ ] Events and custom errors
- [ ] Inheritance and libraries
- [ ] Token standards: ERC-20, ERC-721, ERC-1155 and ERC-4626
- [ ] Upgradeable contracts and proxy patterns
    - _Solidity documentation — Solidity team_
    - _OpenZeppelin Contracts documentation — OpenZeppelin_

### Tooling

- [ ] Foundry: forge, cast and anvil
- [ ] Unit, fuzz and invariant tests
- [ ] Forking mainnet in tests
- [ ] Gas optimisation
    - _The Foundry Book — Foundry contributors_

### Practice

- [ ] Practice: Problem set, an ERC-4626 vault with fuzz and invariant tests in Foundry

**Capstone**

- [ ] Project: A collateralised vault in Solidity with an oracle and liquidations, invariant-tested in Foundry

## 5. Security and auditing — CORE

### Attacks

- [ ] Reentrancy, including read-only reentrancy
- [ ] Access control and initialisation bugs
- [ ] Oracle manipulation and flash loans
- [ ] Front-running and MEV
- [ ] Signature replay and malleability
- [ ] Rounding and precision errors
- [ ] Denial of service and griefing
    - _Smart Contract Security Best Practices — Consensys Diligence_
    - _Damn Vulnerable DeFi — The Red Guild_

### Auditing

- [ ] Reading a codebase as an auditor
- [ ] Static analysis with Slither
- [ ] Invariants, formal checks and symbolic execution
- [ ] Writing an audit report
    - _Slither documentation — Trail of Bits_

### Practice

- [ ] Practice: Case study, solve three Damn Vulnerable DeFi challenges and write each finding up

**Capstone**

- [ ] Project: Audit an open-source protocol's contracts and write a report with proofs of concept in Foundry

## 6. Layer 2s and scaling — CORE

Courses: Ethereum’s developer docs (ethereum-docs)

### Rollups

- [ ] Optimistic rollups and fraud proofs
- [ ] Zero-knowledge rollups and validity proofs
- [ ] Data availability and EIP-4844 blobs
- [ ] Sequencers and forced inclusion
- [ ] Bridges and cross-chain messaging
- [ ] Account abstraction (ERC-4337)
    - _Ethereum scaling — ethereum.org_
    - _L2BEAT — L2BEAT_

### Practice

- [ ] Practice: Problem set, withdraw from an optimistic rollup by hand and explain each wait

**Capstone**

- [ ] Project: A blockchain node with a mempool, then a rollup with fraud proofs (project: node-l2)
