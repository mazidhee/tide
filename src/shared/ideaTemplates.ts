/**
 * Starting maps for projects from an idea: a payment rail, a blockchain from scratch, a stablecoin
 * simulator, a core-banking simulation, an ML project and a data pipeline. Each is a whole plan
 * (components, links, milestones, readings) with real starting files: stubs and failing tests for
 * the first milestone. With a model they are adapted to the idea; without one they are used as
 * they are, so a project can be started with no model at all.
 */
import type { ProjectPlan, ScaffoldFile } from './ideaProject'

export interface IdeaTemplate {
  id: string
  name: string
  about: string
  /** Words in an idea that point to it */
  match: RegExp
  plan: Omit<ProjectPlan, 'createdAt' | 'private' | 'by' | 'idea' | 'answers'>
}

const PY_GITIGNORE = '__pycache__/\n.pytest_cache/\n.venv/\n*.pyc\n'
const pyproject = (name: string, deps: string[] = []) => `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = [${deps.map((d) => `"${d}"`).join(', ')}]\n\n[tool.pytest.ini_options]\npythonpath = ["."]\ntestpaths = ["tests"]\n`
const pyFiles = (name: string, pkg: string, files: Record<string, string>, deps: string[] = []): ScaffoldFile[] => [
  { path: 'pyproject.toml', content: pyproject(name, deps) },
  { path: 'requirements.txt', content: ['pytest>=8', ...deps].join('\n') + '\n' },
  { path: '.gitignore', content: PY_GITIGNORE },
  { path: `${pkg}/__init__.py`, content: '' },
  ...Object.entries(files).map(([path, content]) => ({ path, content }))
]

const m = (id: string, title: string, build: string, components: string[], lessons: [string, string][], doneWhen: string[], hours: number, recall: string[], readings: ProjectPlan['milestones'][number]['readings'] = []): ProjectPlan['milestones'][number] => ({
  id,
  title,
  build,
  components,
  lessons: lessons.map(([concept, why]) => ({ concept, why })),
  doneWhen,
  readings,
  hours,
  recall,
  status: id === 'm1' ? 'active' : 'todo'
})
const c = (id: string, name: string, about: string, prerequisites: string[]) => ({ id, name, about, prerequisites: prerequisites.map((p) => ({ name: p, status: 'new' as const })) })

// ---------- Payment rail ----------

const RAIL_LEDGER = `"""A double-entry ledger. Amounts are whole numbers in minor units (pence, cents): never floats.

Every entry is a set of postings that sum to zero: money moves, it is never made or lost.
A positive amount debits an account, a negative one credits it.
"""
from dataclasses import dataclass


class UnbalancedEntry(ValueError):
    """The postings of an entry don't sum to zero."""


@dataclass(frozen=True)
class Posting:
    account: str
    amount: int


@dataclass(frozen=True)
class Entry:
    id: str
    postings: tuple[Posting, ...]
    memo: str = ""


class Ledger:
    def __init__(self) -> None:
        self.entries: list[Entry] = []

    def open_account(self, name: str) -> None:
        """Opens an account with a zero balance."""
        raise NotImplementedError

    def post(self, entry_id: str, postings: list[tuple[str, int]], memo: str = "") -> Entry:
        """Records an entry, all or nothing.

        Raises UnbalancedEntry when the amounts don't sum to zero, TypeError when an amount isn't an
        int, KeyError for an account that isn't open, and ValueError for an entry id already used.
        """
        raise NotImplementedError

    def balance(self, account: str) -> int:
        """The sum of every posting to the account."""
        raise NotImplementedError
`

const RAIL_TESTS = `import pytest

from rail.ledger import Ledger, UnbalancedEntry


def ledger() -> Ledger:
    led = Ledger()
    for name in ("customer:alice", "customer:bob", "bank:settlement"):
        led.open_account(name)
    return led


def test_balanced_entry_moves_money():
    led = ledger()
    led.post("e1", [("customer:alice", -500), ("customer:bob", 500)], memo="alice pays bob")
    assert led.balance("customer:alice") == -500
    assert led.balance("customer:bob") == 500


def test_unbalanced_entry_is_rejected_and_changes_nothing():
    led = ledger()
    with pytest.raises(UnbalancedEntry):
        led.post("e1", [("customer:alice", -500), ("customer:bob", 400)])
    assert led.balance("customer:bob") == 0


def test_amounts_are_whole_minor_units():
    led = ledger()
    with pytest.raises(TypeError):
        led.post("e1", [("customer:alice", -1.5), ("customer:bob", 1.5)])


def test_unknown_account_is_rejected():
    led = ledger()
    with pytest.raises(KeyError):
        led.post("e1", [("customer:carol", -100), ("customer:bob", 100)])


def test_entry_ids_are_used_once():
    led = ledger()
    led.post("e1", [("customer:alice", -100), ("customer:bob", 100)])
    with pytest.raises(ValueError):
        led.post("e1", [("customer:alice", -100), ("customer:bob", 100)])
    assert led.balance("customer:bob") == 100
`

const paymentRail: IdeaTemplate = {
  id: 'payment-rail',
  name: 'Payment rail',
  about: 'A ledger with double entry, ISO 20022 messages, idempotent payments, settlement and reconciliation',
  match: /\bpayment (rail|system|network|switch|processor|gateway)s?\b|\biso ?20022\b|\bpacs\.\d|\bsettlement\b|\bfaster payments\b|\bfednow\b|\bsepa\b|\bach\b|\bswift\b|\breal[- ]time payments?\b|\bpsp\b/i,
  plan: {
    version: 1,
    name: 'Payment rail',
    slug: 'payment-rail',
    summary: 'A small payment rail: payments arrive as ISO 20022 messages through an idempotent API, are checked for fraud, posted to a double-entry ledger, settled in batches between banks and reconciled against statements. Building it teaches how money actually moves and why each safeguard exists.',
    language: 'python',
    depth: 'solid',
    components: [
      c('api', 'Payment API', 'Accepts payment instructions over HTTP and answers with their status', ['HTTP and REST APIs', 'JSON schemas']),
      c('idempotency', 'Idempotency store', 'Remembers each request key so a retried payment is never made twice', ['idempotency keys', 'atomic operations']),
      c('iso', 'ISO 20022 messages', 'Parses and writes pacs.008 credit transfers and camt.053 statements', ['XML parsing', 'ISO 20022 message structure']),
      c('fraud', 'Fraud checks', 'Velocity and limit rules run before a payment is accepted', ['rule engines', 'sliding windows']),
      c('ledger', 'Ledger', 'Double-entry accounts: every movement balances to zero', ['double-entry bookkeeping', 'integer money in minor units']),
      c('settlement', 'Settlement', 'Nets the day’s payments between banks into settlement batches', ['net settlement', 'batch processing']),
      c('recon', 'Reconciliation', 'Matches the ledger against the bank’s statement and reports breaks', ['reconciliation', 'matching algorithms'])
    ],
    links: [
      { from: 'api', to: 'idempotency', label: 'request key' },
      { from: 'api', to: 'iso', label: 'pacs.008' },
      { from: 'api', to: 'fraud', label: 'payment' },
      { from: 'fraud', to: 'ledger', label: 'accepted payment' },
      { from: 'ledger', to: 'settlement', label: 'day’s postings' },
      { from: 'settlement', to: 'recon', label: 'settled batches' },
      { from: 'iso', to: 'recon', label: 'camt.053 statement' }
    ],
    milestones: [
      m('m1', 'A double-entry ledger', 'Accounts and entries in integer minor units, where every entry balances to zero and is recorded all or nothing.', ['ledger'], [['double-entry bookkeeping', 'every movement is two sides of one entry'], ['integer money in minor units', 'floats lose pennies']], ['a balanced entry moves money between accounts', 'an unbalanced entry is rejected and changes nothing', 'amounts must be whole minor units', 'posting to an unknown account is rejected', 'an entry id can be used only once'], 4, ['Why must the postings of a ledger entry sum to zero?', 'Why are amounts kept as integers in minor units rather than floats?'], [{ title: 'Modern Treasury: Accounting for developers', kind: 'web', url: 'https://www.moderntreasury.com/journal/accounting-for-developers-part-i', why: 'Double entry explained for engineers' }]),
      m('m2', 'Idempotent payments API', 'An API that takes a payment with an idempotency key and returns the same result for a retry, never paying twice.', ['api', 'idempotency', 'ledger'], [['idempotency keys', 'networks retry; payments must not double'], ['HTTP status codes and retries', 'clients decide what to do from them']], ['the same key twice returns the first result', 'the same key with a different body is refused', 'a failed payment can be retried with its key', 'concurrent requests with one key post once'], 6, ['What does an idempotency key protect against?'], [{ title: 'Stripe: Designing robust and predictable APIs with idempotency', kind: 'web', url: 'https://stripe.com/blog/idempotency', why: 'The pattern as a payments company runs it' }]),
      m('m3', 'ISO 20022 credit transfers', 'Parse a pacs.008 message into a payment and write one back out, checking the fields a bank would reject.', ['iso'], [['ISO 20022 message structure', 'it is how banks now talk'], ['XML parsing', 'the messages are XML with namespaces']], ['a valid pacs.008 parses into a payment', 'a missing debtor account is rejected', 'amounts keep their currency and precision', 'a payment written out parses back the same'], 6, ['What is a pacs.008 used for, and what is a camt.053?'], [{ title: 'ISO 20022 message definitions', kind: 'spec', url: 'https://www.iso20022.org/iso-20022-message-definitions', why: 'The catalogue of messages' }]),
      m('m4', 'Fraud checks', 'Velocity and amount rules that run before a payment is accepted, with the reason recorded when one is stopped.', ['fraud', 'api'], [['sliding windows', 'velocity is counted over time'], ['rule engines', 'rules change more often than code']], ['a payment over the single limit is held', 'too many payments in a window are held', 'a held payment never reaches the ledger', 'each hold records which rule fired'], 5, ['Why count velocity in a sliding window rather than per calendar day?']),
      m('m5', 'Settlement batches', 'Net the day’s payments between participating banks and post the settlement entries.', ['settlement', 'ledger'], [['net settlement', 'banks settle the difference, not every payment'], ['gross versus net settlement', 'the trade-off between risk and liquidity']], ['multilateral net positions sum to zero', 'each bank’s position matches its payments', 'settlement posts balanced entries', 'a batch is closed once and never changes'], 6, ['What is the difference between gross and net settlement?']),
      m('m6', 'Reconciliation', 'Match the ledger against a camt.053 statement and report every break: missing, extra or different.', ['recon', 'iso', 'ledger'], [['reconciliation', 'how operations teams find lost money'], ['matching algorithms', 'one-to-one and many-to-one matches']], ['matching entries reconcile', 'a payment missing from the statement is a break', 'an amount difference is a break with both amounts', 'the report totals agree with the ledger'], 6, ['What kinds of break does reconciliation find?'])
    ],
    scaffold: pyFiles('payment-rail', 'rail', { 'rail/ledger.py': RAIL_LEDGER, 'tests/test_ledger.py': RAIL_TESTS })
  }
}

// ---------- Blockchain from scratch ----------

const CHAIN = `"""Blocks and a chain, linked by SHA-256 hashes.

A block's hash covers its header: index, the previous block's hash, the timestamp, the data and the
nonce, in a canonical form (the same block always gives the same bytes).
"""
import hashlib  # noqa: F401  (you'll need it)
import json  # noqa: F401
from dataclasses import dataclass, field


@dataclass
class Block:
    index: int
    prev_hash: str
    timestamp: int
    data: list[str] = field(default_factory=list)
    nonce: int = 0

    def header(self) -> bytes:
        """The block's header as canonical bytes."""
        raise NotImplementedError

    def hash(self) -> str:
        """SHA-256 of the header, as 64 hex characters."""
        raise NotImplementedError


def genesis() -> Block:
    return Block(0, "0" * 64, 0, ["genesis"])


class Chain:
    def __init__(self) -> None:
        self.blocks: list[Block] = [genesis()]

    def add(self, data: list[str], timestamp: int) -> Block:
        """Appends a block linked to the last one."""
        raise NotImplementedError

    def valid(self) -> bool:
        """Every block links to the hash of the one before it, and the indexes run in order."""
        raise NotImplementedError
`

const CHAIN_TESTS = `import hashlib

from chain.blocks import Block, Chain


def test_hash_is_sha256_of_the_header():
    b = Block(1, "0" * 64, 1700000000, ["alice pays bob 5"])
    assert b.header() == b.header()
    assert b.hash() == hashlib.sha256(b.header()).hexdigest()
    assert len(b.hash()) == 64


def test_any_change_changes_the_hash():
    a = Block(1, "0" * 64, 1700000000, ["alice pays bob 5"])
    b = Block(1, "0" * 64, 1700000000, ["alice pays bob 6"])
    c = Block(1, "0" * 64, 1700000000, ["alice pays bob 5"], nonce=1)
    assert len({a.hash(), b.hash(), c.hash()}) == 3


def test_blocks_link_to_the_one_before():
    ch = Chain()
    first = ch.add(["tx1"], 1)
    second = ch.add(["tx2"], 2)
    assert first.prev_hash == ch.blocks[0].hash()
    assert second.prev_hash == first.hash()
    assert [b.index for b in ch.blocks] == [0, 1, 2]


def test_tampering_breaks_the_chain():
    ch = Chain()
    ch.add(["alice pays bob 5"], 1)
    ch.add(["bob pays carol 2"], 2)
    assert ch.valid()
    ch.blocks[1].data[0] = "alice pays bob 500"
    assert not ch.valid()
`

const blockchain: IdeaTemplate = {
  id: 'blockchain',
  name: 'Blockchain from scratch',
  about: 'Hashing, Merkle trees, signatures, transactions, proof of work and a peer-to-peer network',
  match: /\bblock ?chain\b|\bbitcoin\b|\bproof of work\b|\bmerkle\b|\bconsensus\b|\butxo\b|\bcrypto(currency)?\b|\bdistributed ledger\b|\bethereum\b/i,
  plan: {
    version: 1,
    name: 'Blockchain from scratch',
    slug: 'blockchain-from-scratch',
    summary: 'A small blockchain built from the bottom: hashed blocks, Merkle trees of transactions, signed transfers with UTXOs, proof of work and nodes that gossip over a peer-to-peer network and agree on the heaviest chain. Building it shows why each piece of Bitcoin’s design is there.',
    language: 'python',
    depth: 'solid',
    components: [
      c('hashing', 'Blocks and hashing', 'Blocks linked by SHA-256 hashes of their headers', ['cryptographic hash functions', 'SHA-256']),
      c('merkle', 'Merkle tree', 'A single root that commits to every transaction, with inclusion proofs', ['Merkle trees', 'binary trees']),
      c('keys', 'Keys and signatures', 'Key pairs, addresses and signed transactions', ['public-key cryptography', 'digital signatures']),
      c('tx', 'Transactions and UTXOs', 'Inputs spend earlier outputs; the set of unspent outputs is the state', ['UTXO model', 'double spending']),
      c('pow', 'Proof of work', 'Mining: finding a nonce under a difficulty target', ['proof of work', 'difficulty adjustment']),
      c('p2p', 'Peer-to-peer network', 'Nodes that gossip blocks and transactions over TCP', ['TCP sockets', 'gossip protocols']),
      c('consensus', 'Consensus', 'Choosing the chain with the most work, and reorganising when it changes', ['Nakamoto consensus', 'chain reorganisation'])
    ],
    links: [
      { from: 'keys', to: 'tx', label: 'signatures' },
      { from: 'tx', to: 'merkle', label: 'transactions' },
      { from: 'merkle', to: 'hashing', label: 'Merkle root' },
      { from: 'hashing', to: 'pow', label: 'block header' },
      { from: 'pow', to: 'p2p', label: 'mined blocks' },
      { from: 'p2p', to: 'consensus', label: 'competing chains' }
    ],
    milestones: [
      m('m1', 'Blocks linked by hashes', 'Blocks with canonical headers, hashed with SHA-256 and linked into a chain that notices tampering.', ['hashing'], [['cryptographic hash functions', 'the chain’s integrity rests on them'], ['canonical serialisation', 'the same block must always hash the same']], ['a block’s hash is SHA-256 of its header', 'any change to a block changes its hash', 'each block links to the hash of the one before', 'tampering with a block breaks the chain'], 3, ['What properties of a hash function make a chain tamper-evident?'], [{ title: 'Bitcoin: A Peer-to-Peer Electronic Cash System', kind: 'web', url: 'https://bitcoin.org/bitcoin.pdf', why: 'Sections 3 and 4: timestamps and proof of work' }]),
      m('m2', 'Merkle trees', 'A Merkle root over a block’s transactions and proofs that one is included.', ['merkle', 'hashing'], [['Merkle trees', 'one hash commits to many'], ['inclusion proofs', 'light clients rely on them']], ['the root changes when any transaction changes', 'an odd number of leaves is handled', 'a proof verifies for an included transaction', 'a proof fails for one that isn’t'], 4, ['How large is a Merkle proof for n transactions, and why?']),
      m('m3', 'Keys and signed transactions', 'Key pairs, addresses and transactions signed by the owner of the coins.', ['keys', 'tx'], [['public-key cryptography', 'ownership is a private key'], ['digital signatures', 'proving you may spend']], ['a signed transaction verifies', 'a changed transaction no longer verifies', 'a signature from the wrong key fails', 'addresses are derived from public keys'], 6, ['What exactly does a signature on a transaction commit to?']),
      m('m4', 'UTXOs and double spends', 'Track unspent outputs; reject spends of missing or spent outputs and inputs that don’t cover outputs.', ['tx'], [['UTXO model', 'state as unspent outputs'], ['double spending', 'the problem a blockchain solves']], ['spending an output removes it from the set', 'a double spend is rejected', 'outputs may not exceed inputs', 'the fee is inputs minus outputs'], 6, ['How does the UTXO model prevent double spending?']),
      m('m5', 'Proof of work', 'Mine blocks under a difficulty target and adjust the difficulty to the block rate.', ['pow', 'hashing'], [['proof of work', 'making history expensive to rewrite'], ['difficulty adjustment', 'keeping block times steady']], ['a mined block’s hash is under the target', 'a block with too little work is rejected', 'difficulty rises when blocks come too fast'], 5, ['Why does proof of work make rewriting history expensive?']),
      m('m6', 'Nodes and consensus', 'Nodes that gossip blocks over TCP and switch to the chain with the most work.', ['p2p', 'consensus'], [['gossip protocols', 'how news spreads without a centre'], ['Nakamoto consensus', 'agreeing without a leader']], ['a block mined on one node reaches the others', 'a node switches to a heavier chain', 'transactions from an abandoned branch return to the pool'], 8, ['What happens to transactions in a block that is orphaned?'])
    ],
    scaffold: pyFiles('blockchain-from-scratch', 'chain', { 'chain/blocks.py': CHAIN, 'tests/test_blocks.py': CHAIN_TESTS })
  }
}

// ---------- Stablecoin simulator ----------

const VAULT = `"""A collateralised vault, as in a crypto-backed stablecoin: lock collateral, mint stablecoins
against it, and keep the collateral's value at or above a minimum ratio of the debt.

Values are Decimals. The collateral's price is given in stablecoins per unit of collateral.
"""
from decimal import Decimal


class Undercollateralised(ValueError):
    """The vault would fall below its minimum collateral ratio."""


class Vault:
    def __init__(self, min_ratio: Decimal) -> None:
        self.min_ratio = min_ratio
        self.collateral = Decimal(0)
        self.debt = Decimal(0)

    def deposit(self, amount: Decimal) -> None:
        raise NotImplementedError

    def ratio(self, price: Decimal) -> Decimal:
        """Collateral value over debt; Decimal('Infinity') with no debt."""
        raise NotImplementedError

    def mint(self, amount: Decimal, price: Decimal) -> None:
        """Adds debt, unless that would leave the vault under its minimum ratio."""
        raise NotImplementedError

    def repay(self, amount: Decimal) -> None:
        raise NotImplementedError

    def withdraw(self, amount: Decimal, price: Decimal) -> None:
        """Takes collateral out, unless that would leave the vault under its minimum ratio."""
        raise NotImplementedError
`

const VAULT_TESTS = `from decimal import Decimal as D

import pytest

from stable.vault import Undercollateralised, Vault


def vault() -> Vault:
    v = Vault(min_ratio=D("1.5"))
    v.deposit(D("10"))
    return v


def test_ratio_is_collateral_value_over_debt():
    v = vault()
    v.mint(D("100"), price=D("20"))
    assert v.ratio(price=D("20")) == D("2")
    assert v.ratio(price=D("15")) == D("1.5")


def test_no_debt_means_an_infinite_ratio():
    assert vault().ratio(price=D("20")) == D("Infinity")


def test_cannot_mint_below_the_minimum_ratio():
    v = vault()
    with pytest.raises(Undercollateralised):
        v.mint(D("150"), price=D("20"))
    assert v.debt == D("0")


def test_repaying_reduces_the_debt():
    v = vault()
    v.mint(D("100"), price=D("20"))
    v.repay(D("40"))
    assert v.debt == D("60")


def test_withdrawals_keep_the_ratio():
    v = vault()
    v.mint(D("100"), price=D("20"))
    with pytest.raises(Undercollateralised):
        v.withdraw(D("4"), price=D("20"))
    v.withdraw(D("2"), price=D("20"))
    assert v.collateral == D("8")
`

const stablecoin: IdeaTemplate = {
  id: 'stablecoin',
  name: 'Stablecoin mechanics simulator',
  about: 'Collateralised vaults, an oracle, liquidations and a peg under price shocks',
  match: /\bstable ?coins?\b|\bpeg\b|\bcollateral(ised|ized)?\b|\bliquidation\b|\bdai\b|\busdc\b|\busdt\b|\bmakerdao\b|\bdepeg\b/i,
  plan: {
    version: 1,
    name: 'Stablecoin simulator',
    slug: 'stablecoin-simulator',
    summary: 'A simulator of a crypto-collateralised stablecoin: vaults that mint against collateral, a price oracle, liquidation auctions, a peg stability module and Monte Carlo price shocks to see when the peg holds and when it breaks. Building it teaches the mechanics behind stablecoins and their failures.',
    language: 'python',
    depth: 'solid',
    components: [
      c('vault', 'Vaults', 'Lock collateral, mint stablecoins, keep a minimum collateral ratio', ['collateralisation ratios', 'Decimal arithmetic']),
      c('oracle', 'Price oracle', 'Feeds prices to the system, with delays and medianised sources', ['price oracles', 'medians and outliers']),
      c('liquidation', 'Liquidations', 'Auctions undercollateralised vaults’ collateral to repay their debt', ['liquidation mechanisms', 'auctions']),
      c('psm', 'Peg stability', 'Swaps and fees that pull the market price back to the peg', ['arbitrage', 'stablecoin pegs']),
      c('sim', 'Simulation', 'Runs the system through random price paths, many times', ['Monte Carlo simulation', 'geometric Brownian motion']),
      c('report', 'Reporting', 'Peg deviation, bad debt and liquidations across runs', ['summary statistics', 'tail risk'])
    ],
    links: [
      { from: 'oracle', to: 'vault', label: 'prices' },
      { from: 'vault', to: 'liquidation', label: 'unsafe vaults' },
      { from: 'liquidation', to: 'psm', label: 'sold collateral' },
      { from: 'sim', to: 'oracle', label: 'price paths' },
      { from: 'sim', to: 'report', label: 'run results' }
    ],
    milestones: [
      m('m1', 'Collateralised vaults', 'A vault that takes collateral, mints and repays debt, and refuses anything that would leave it under its minimum ratio.', ['vault'], [['collateralisation ratios', 'the safety margin of a vault'], ['Decimal arithmetic', 'money can’t be binary floats']], ['the ratio is collateral value over debt', 'no debt means an infinite ratio', 'minting below the minimum ratio is refused', 'repaying reduces the debt', 'withdrawals keep the ratio'], 3, ['What does a collateral ratio of 150% protect against?'], [{ title: 'The Maker Protocol white paper', kind: 'web', url: 'https://makerdao.com/en/whitepaper/', why: 'Vaults, liquidations and the peg' }]),
      m('m2', 'A price oracle', 'An oracle that medianises several feeds, ignores stale prices and updates with a delay.', ['oracle'], [['price oracles', 'the system only sees what the oracle says'], ['medians and outliers', 'one bad feed must not move the price']], ['the price is the median of fresh feeds', 'stale feeds are ignored', 'updates take effect after the delay'], 4, ['Why do oracles delay price updates?']),
      m('m3', 'Liquidations', 'Find unsafe vaults and auction their collateral to cover the debt, recording any bad debt.', ['liquidation', 'vault'], [['liquidation mechanisms', 'how the system protects itself'], ['auctions', 'price discovery under pressure']], ['an unsafe vault is liquidated', 'a safe vault is left alone', 'the penalty is charged', 'a shortfall is recorded as bad debt'], 6, ['What is bad debt in a stablecoin system, and how does it arise?']),
      m('m4', 'Peg stability', 'A peg stability module that swaps at a fee, and arbitrageurs who trade when the price leaves the peg.', ['psm'], [['arbitrage', 'what pulls the price back'], ['stablecoin pegs', 'the promise and what backs it']], ['a swap moves the price towards the peg', 'arbitrage is unprofitable within the fee band', 'reserves never go negative'], 5, ['How does arbitrage keep a stablecoin near its peg?']),
      m('m5', 'Shocks and Monte Carlo', 'Run thousands of price paths, with crashes, and report peg deviation, liquidations and bad debt.', ['sim', 'report'], [['Monte Carlo simulation', 'many futures, not one'], ['tail risk', 'the runs that matter most']], ['runs are reproducible from a seed', 'a crash path liquidates vaults', 'the report gives the worst percentile'], 6, ['Why look at tail percentiles rather than the average run?'])
    ],
    scaffold: pyFiles('stablecoin-simulator', 'stable', { 'stable/vault.py': VAULT, 'tests/test_vault.py': VAULT_TESTS })
  }
}

// ---------- Core banking ----------

const BANK = `"""Accounts at a bank: open them, pay money in and out, keep each one's history.

Amounts are whole numbers in minor units. An account may go overdrawn only down to its overdraft limit.
"""
from dataclasses import dataclass


class InsufficientFunds(ValueError):
    """The withdrawal would take the account past its overdraft limit."""


@dataclass(frozen=True)
class Movement:
    kind: str  # "deposit" or "withdrawal"
    amount: int
    balance_after: int


class Bank:
    def open_account(self, customer: str, currency: str = "GBP", overdraft: int = 0) -> str:
        """Opens an account and returns its id (unique)."""
        raise NotImplementedError

    def deposit(self, account_id: str, amount: int) -> None:
        raise NotImplementedError

    def withdraw(self, account_id: str, amount: int) -> None:
        raise NotImplementedError

    def balance(self, account_id: str) -> int:
        raise NotImplementedError

    def history(self, account_id: str) -> list[Movement]:
        raise NotImplementedError
`

const BANK_TESTS = `import pytest

from bank.accounts import Bank, InsufficientFunds


def test_accounts_have_their_own_ids_and_start_at_zero():
    b = Bank()
    a1 = b.open_account("alice")
    a2 = b.open_account("alice")
    assert a1 != a2
    assert b.balance(a1) == 0


def test_deposits_and_withdrawals_change_the_balance():
    b = Bank()
    a = b.open_account("alice")
    b.deposit(a, 10_000)
    b.withdraw(a, 2_500)
    assert b.balance(a) == 7_500


def test_amounts_must_be_positive():
    b = Bank()
    a = b.open_account("alice")
    with pytest.raises(ValueError):
        b.deposit(a, -5)
    with pytest.raises(ValueError):
        b.withdraw(a, 0)


def test_overdraft_limit_is_kept():
    b = Bank()
    a = b.open_account("bob", overdraft=1_000)
    b.withdraw(a, 1_000)
    assert b.balance(a) == -1_000
    with pytest.raises(InsufficientFunds):
        b.withdraw(a, 1)
    assert b.balance(a) == -1_000


def test_history_records_each_movement():
    b = Bank()
    a = b.open_account("alice")
    b.deposit(a, 500)
    b.withdraw(a, 200)
    assert [(m.kind, m.amount, m.balance_after) for m in b.history(a)] == [("deposit", 500, 500), ("withdrawal", 200, 300)]
`

const coreBanking: IdeaTemplate = {
  id: 'core-banking',
  name: 'Core-banking simulation',
  about: 'Accounts, a ledger, transfers, interest, limits and the end-of-day batch',
  match: /\bcore[- ]?bank(ing)?\b|\bbank(ing)? (system|platform|simulation)\b|\bdeposit accounts?\b|\binterest accrual\b|\bend[- ]of[- ]day\b|\bopen banking\b|\bneo ?bank\b/i,
  plan: {
    version: 1,
    name: 'Core banking',
    slug: 'core-banking',
    summary: 'A simulation of a bank’s core: customer accounts on a double-entry ledger, transfers, daily interest accrual, limits and overdrafts, statements and the end-of-day batch that closes the books. Building it teaches what a core-banking system does and why banks are careful about every step.',
    language: 'python',
    depth: 'solid',
    components: [
      c('accounts', 'Accounts', 'Customers, accounts, balances and their history', ['bank account types', 'integer money in minor units']),
      c('ledger', 'General ledger', 'Double-entry postings behind every movement', ['double-entry bookkeeping', 'chart of accounts']),
      c('transfers', 'Transfers', 'Internal transfers, all or nothing', ['transactions and atomicity', 'idempotency keys']),
      c('limits', 'Limits and overdrafts', 'Overdraft limits, daily limits and holds', ['overdrafts', 'authorisation holds']),
      c('interest', 'Interest', 'Daily accrual and monthly capitalisation', ['simple and compound interest', 'day-count conventions']),
      c('eod', 'End of day', 'The batch that accrues, closes the day and produces statements', ['batch processing', 'cut-off times']),
      c('statements', 'Statements', 'Statements per account and period', ['statement generation', 'reconciliation'])
    ],
    links: [
      { from: 'accounts', to: 'ledger', label: 'postings' },
      { from: 'transfers', to: 'limits', label: 'authorisation' },
      { from: 'transfers', to: 'ledger', label: 'balanced entries' },
      { from: 'eod', to: 'interest', label: 'accrue' },
      { from: 'interest', to: 'ledger', label: 'interest postings' },
      { from: 'eod', to: 'statements', label: 'closed day' }
    ],
    milestones: [
      m('m1', 'Accounts and balances', 'Open accounts, pay in and out, keep each account’s history and its overdraft limit.', ['accounts', 'limits'], [['bank account types', 'current and savings accounts behave differently'], ['overdrafts', 'how far below zero an account may go']], ['accounts have their own ids and start at zero', 'deposits and withdrawals change the balance', 'amounts must be positive', 'the overdraft limit is kept', 'history records each movement'], 3, ['What does an overdraft limit change about a withdrawal?']),
      m('m2', 'A general ledger underneath', 'Move every balance change onto double-entry postings against a chart of accounts.', ['ledger', 'accounts'], [['double-entry bookkeeping', 'every movement has two sides'], ['chart of accounts', 'where the other side goes']], ['every movement posts a balanced entry', 'customer balances equal ledger balances', 'the bank’s cash account matches deposits less withdrawals'], 5, ['Why does a deposit increase a liability on the bank’s books?']),
      m('m3', 'Transfers', 'Internal transfers that are atomic and idempotent, with authorisation against limits.', ['transfers', 'limits'], [['transactions and atomicity', 'all or nothing'], ['idempotency keys', 'retries must not double']], ['a transfer moves money atomically', 'a failed transfer changes nothing', 'a retried transfer is applied once', 'daily limits are enforced'], 5, ['What makes a transfer atomic?']),
      m('m4', 'Interest', 'Accrue interest daily with a day-count convention and capitalise it monthly.', ['interest'], [['day-count conventions', 'Actual/365 and friends'], ['simple and compound interest', 'when interest earns interest']], ['daily accrual follows Actual/365', 'accrued interest is capitalised at month end', 'rounding is to the minor unit and recorded'], 5, ['What is a day-count convention for?']),
      m('m5', 'End of day and statements', 'An end-of-day batch that accrues interest, closes the day and writes statements.', ['eod', 'statements'], [['batch processing', 'banks still run on batches'], ['cut-off times', 'which day a payment belongs to']], ['a closed day accepts no more postings', 'statements open and close with the right balances', 'running the batch twice does nothing the second time'], 6, ['Why must an end-of-day batch be safe to run twice?'])
    ],
    scaffold: pyFiles('core-banking', 'bank', { 'bank/accounts.py': BANK, 'tests/test_accounts.py': BANK_TESTS })
  }
}

// ---------- ML project ----------

const DATA = `"""Loading data and splitting it, with nothing from the test set leaking into training.

Standard library only: the point is to see what the libraries do.
"""
import csv  # noqa: F401
import random  # noqa: F401


def load_csv(path: str) -> list[dict[str, float]]:
    """Each row as a dict of column name to float."""
    raise NotImplementedError


def train_test_split(rows: list, test_size: float, seed: int) -> tuple[list, list]:
    """Shuffled with the seed, then split; the same seed always gives the same split."""
    raise NotImplementedError


def standardise(train: list[float], test: list[float]) -> tuple[list[float], list[float]]:
    """Scales both to the train set's mean and standard deviation (population), never the test set's."""
    raise NotImplementedError
`

const DATA_TESTS = `import math

from ml.data import load_csv, standardise, train_test_split


def test_load_csv_reads_numbers(tmp_path):
    p = tmp_path / "d.csv"
    p.write_text("x,y\\n1,2.5\\n3,4\\n")
    assert load_csv(str(p)) == [{"x": 1.0, "y": 2.5}, {"x": 3.0, "y": 4.0}]


def test_split_sizes_and_no_overlap():
    rows = list(range(100))
    train, test = train_test_split(rows, test_size=0.2, seed=1)
    assert len(train) == 80 and len(test) == 20
    assert sorted(train + test) == rows


def test_split_is_reproducible():
    rows = list(range(50))
    assert train_test_split(rows, 0.2, seed=7) == train_test_split(rows, 0.2, seed=7)
    assert train_test_split(rows, 0.2, seed=7) != train_test_split(rows, 0.2, seed=8)


def test_standardise_uses_the_train_statistics():
    train, test = standardise([1.0, 2.0, 3.0], [10.0])
    assert math.isclose(sum(train) / 3, 0.0, abs_tol=1e-9)
    std = math.sqrt(2 / 3)
    assert math.isclose(test[0], (10.0 - 2.0) / std)
`

const mlProject: IdeaTemplate = {
  id: 'ml-project',
  name: 'ML project',
  about: 'Data, features, a model from scratch, training and honest evaluation',
  match: /\bmachine learning\b|\bml\b|\bmodel\b.*\b(train|predict)|\bclassifier\b|\bregression\b|\bneural (net|network)\b|\bpredict(ion|ing)?\b|\bdeep learning\b|\bcredit scor/i,
  plan: {
    version: 1,
    name: 'ML project',
    slug: 'ml-project',
    summary: 'An end-to-end machine-learning project built mostly from scratch: loading and splitting data without leakage, features, a logistic-regression model trained by gradient descent, honest evaluation with cross-validation, and experiment tracking. Building it teaches what the libraries do for you and where results go wrong.',
    language: 'python',
    depth: 'solid',
    components: [
      c('data', 'Data loading and split', 'Reads the data and splits it without leakage', ['train/test splits', 'data leakage']),
      c('features', 'Features', 'Cleaning, scaling and encoding', ['feature scaling', 'one-hot encoding']),
      c('model', 'Model', 'Logistic regression written from scratch', ['logistic regression', 'the sigmoid function']),
      c('train', 'Training', 'Gradient descent on the log loss', ['gradient descent', 'log loss']),
      c('eval', 'Evaluation', 'Metrics and cross-validation', ['precision and recall', 'cross-validation']),
      c('track', 'Experiment tracking', 'Every run’s settings and results, kept', ['experiment tracking', 'reproducibility'])
    ],
    links: [
      { from: 'data', to: 'features', label: 'train and test rows' },
      { from: 'features', to: 'model', label: 'feature matrix' },
      { from: 'model', to: 'train', label: 'parameters' },
      { from: 'train', to: 'eval', label: 'fitted model' },
      { from: 'eval', to: 'track', label: 'metrics' }
    ],
    milestones: [
      m('m1', 'Data and an honest split', 'Load a CSV, split it reproducibly, and scale features with the training set’s statistics only.', ['data', 'features'], [['train/test splits', 'evaluation needs unseen data'], ['data leakage', 'the commonest way results lie']], ['a CSV loads as numbers', 'the split has the right sizes and no overlap', 'the split is reproducible from a seed', 'scaling uses the training set’s statistics'], 3, ['Why must scaling use only the training set’s statistics?']),
      m('m2', 'Logistic regression from scratch', 'The sigmoid, predictions and the log loss, with its gradient checked numerically.', ['model'], [['logistic regression', 'the model you’ll build'], ['log loss', 'what training minimises']], ['the sigmoid is bounded and symmetric', 'the loss falls as predictions improve', 'the analytic gradient matches a numerical one'], 5, ['Why check a gradient numerically?']),
      m('m3', 'Training by gradient descent', 'Batch and mini-batch gradient descent with a learning rate and early stopping.', ['train', 'model'], [['gradient descent', 'how the parameters move'], ['learning rates', 'too big diverges, too small crawls']], ['training lowers the loss', 'a separable toy set reaches full accuracy', 'early stopping stops on a rising validation loss'], 5, ['What happens when the learning rate is too large?']),
      m('m4', 'Evaluation', 'Precision, recall, ROC AUC and k-fold cross-validation, compared with a baseline.', ['eval'], [['precision and recall', 'accuracy hides imbalance'], ['cross-validation', 'a steadier estimate']], ['metrics match hand-worked examples', 'folds partition the data', 'the model beats the majority-class baseline'], 5, ['When is accuracy a misleading metric?']),
      m('m5', 'Experiments you can repeat', 'Track each run’s seed, settings and metrics, and reproduce any run exactly.', ['track'], [['reproducibility', 'a result you can’t repeat isn’t one'], ['experiment tracking', 'comparing runs fairly']], ['each run is saved with its settings', 'rerunning a saved run gives the same metrics', 'runs can be compared side by side'], 4, ['What has to be recorded to reproduce a training run?'])
    ],
    scaffold: pyFiles('ml-project', 'ml', { 'ml/data.py': DATA, 'tests/test_data.py': DATA_TESTS })
  }
}

// ---------- Data pipeline ----------

const VALIDATE = `"""Validating rows against a schema before they are loaded: good rows typed, bad rows set aside
with the reason, so one bad row never stops the pipeline and never reaches the warehouse.
"""
from dataclasses import dataclass, field


@dataclass
class Schema:
    columns: dict[str, type]
    required: set[str] = field(default_factory=set)


@dataclass
class Rejected:
    row: dict
    reason: str


def validate_rows(rows: list[dict[str, str]], schema: Schema) -> tuple[list[dict], list[Rejected]]:
    """Typed good rows (only the schema's columns), and the rejected ones with why."""
    raise NotImplementedError
`

const VALIDATE_TESTS = `from pipeline.validate import Schema, validate_rows

SCHEMA = Schema({"id": int, "symbol": str, "price": float, "qty": int}, required={"id", "symbol", "price", "qty"})


def test_good_rows_are_typed():
    good, bad = validate_rows([{"id": "1", "symbol": "AAPL", "price": "10.5", "qty": "3"}], SCHEMA)
    assert good == [{"id": 1, "symbol": "AAPL", "price": 10.5, "qty": 3}]
    assert bad == []


def test_a_wrong_type_is_rejected_with_the_column():
    good, bad = validate_rows([{"id": "x", "symbol": "AAPL", "price": "1", "qty": "1"}], SCHEMA)
    assert good == []
    assert len(bad) == 1 and "id" in bad[0].reason


def test_a_missing_required_value_is_rejected():
    good, bad = validate_rows([{"id": "2", "symbol": "", "price": "1", "qty": "1"}, {"id": "3", "price": "1", "qty": "1"}], SCHEMA)
    assert good == []
    assert [("symbol" in r.reason) for r in bad] == [True, True]


def test_extra_columns_are_dropped_and_good_rows_survive_bad_ones():
    rows = [{"id": "1", "symbol": "A", "price": "1", "qty": "1", "note": "x"}, {"id": "y", "symbol": "B", "price": "1", "qty": "1"}]
    good, bad = validate_rows(rows, SCHEMA)
    assert good == [{"id": 1, "symbol": "A", "price": 1.0, "qty": 1}]
    assert len(bad) == 1
`

const dataPipeline: IdeaTemplate = {
  id: 'data-pipeline',
  name: 'Data pipeline',
  about: 'Extract, validate, transform and load into a warehouse, with a DAG and quality checks',
  match: /\bdata pipelines?\b|\betl\b|\belt\b|\bdata engineering\b|\bwarehouse\b|\bingest(ion)?\b|\borchestrat|\bairflow\b|\bdag\b|\bdbt\b|\bmarket data\b/i,
  plan: {
    version: 1,
    name: 'Data pipeline',
    slug: 'data-pipeline',
    summary: 'A batch data pipeline: extract trades from CSV and an API, validate them against a schema, transform them into daily positions, load them into a SQLite warehouse idempotently, and run it all as a small DAG with data-quality checks and backfills. Building it teaches the ideas behind Airflow and dbt without the frameworks.',
    language: 'python',
    depth: 'solid',
    components: [
      c('extract', 'Extract', 'Reads source files and an API page by page', ['CSV parsing', 'API pagination']),
      c('validate', 'Validate', 'Checks rows against a schema; quarantines bad ones', ['schemas and types', 'data validation']),
      c('transform', 'Transform', 'Turns trades into daily positions', ['aggregation', 'window functions']),
      c('load', 'Load', 'Writes to a SQLite warehouse, idempotently', ['SQL', 'idempotent loads', 'upserts']),
      c('dag', 'Orchestrator', 'Runs the tasks in dependency order, with retries', ['directed acyclic graphs', 'topological sort']),
      c('quality', 'Quality checks', 'Row counts, freshness and reconciliation checks', ['data quality checks', 'freshness'])
    ],
    links: [
      { from: 'extract', to: 'validate', label: 'raw rows' },
      { from: 'validate', to: 'transform', label: 'typed rows' },
      { from: 'transform', to: 'load', label: 'positions' },
      { from: 'dag', to: 'extract', label: 'schedules' },
      { from: 'load', to: 'quality', label: 'loaded tables' }
    ],
    milestones: [
      m('m1', 'Extract and validate', 'Validate raw rows against a schema: type the good ones, set the bad ones aside with a reason.', ['validate', 'extract'], [['schemas and types', 'the contract a pipeline keeps'], ['data validation', 'bad data in, bad decisions out']], ['good rows are typed', 'a wrong type is rejected with the column named', 'a missing required value is rejected', 'extra columns are dropped and good rows survive bad ones'], 3, ['Why quarantine bad rows rather than stop the pipeline?']),
      m('m2', 'Transform into positions', 'Aggregate trades into each day’s positions per symbol, with running totals.', ['transform'], [['aggregation', 'group, then reduce'], ['window functions', 'running totals in SQL']], ['positions sum each symbol’s trades per day', 'running positions carry over days', 'the transform is pure: same input, same output'], 4, ['What makes a transform step safe to rerun?']),
      m('m3', 'Idempotent loads', 'Load into SQLite with upserts so a rerun or backfill never duplicates rows.', ['load'], [['idempotent loads', 'reruns are normal'], ['upserts', 'insert or update in one step']], ['loading twice leaves one copy', 'a backfill replaces only its own day', 'a failed load leaves the table unchanged'], 4, ['How does an upsert make a load idempotent?']),
      m('m4', 'A small orchestrator', 'Tasks with dependencies, run in topological order, with retries and a record of each run.', ['dag'], [['directed acyclic graphs', 'how tasks depend on each other'], ['topological sort', 'the order to run them']], ['tasks run after their dependencies', 'a cycle is refused', 'a failed task is retried, then stops its dependants'], 5, ['Why must a pipeline’s task graph be acyclic?']),
      m('m5', 'Quality checks', 'Row-count, freshness and reconciliation checks that fail the run loudly.', ['quality', 'load'], [['data quality checks', 'catch problems before people do'], ['freshness', 'stale data looks fine until it isn’t']], ['a missing day fails the freshness check', 'counts reconcile between stages', 'a failed check marks the run failed'], 4, ['Which data-quality checks catch silent failures?'])
    ],
    scaffold: pyFiles('data-pipeline', 'pipeline', { 'pipeline/validate.py': VALIDATE, 'tests/test_validate.py': VALIDATE_TESTS })
  }
}


// ---------- Market terminal ----------

const QUOTES = `"""A quote book: the latest state of each symbol from a stream of ticks.

A tick is a dict: a quote {"seq", "symbol", "bid", "ask"} or a trade {"seq", "symbol", "last", "size"}.
Sequence numbers rise per symbol; anything out of order is refused and changes nothing.
"""


class OutOfOrder(ValueError):
    """A tick arrived with a sequence number not above the symbol's last one."""


class QuoteBook:
    def apply(self, tick: dict) -> None:
        """Applies a quote or a trade. A crossed quote (bid above ask) is a ValueError."""
        raise NotImplementedError

    def best(self, symbol: str) -> tuple[float, float]:
        """(bid, ask); KeyError for a symbol never quoted."""
        raise NotImplementedError

    def last(self, symbol: str) -> float | None:
        raise NotImplementedError

    def spread(self, symbol: str) -> float:
        raise NotImplementedError
`

const QUOTES_TESTS = `import pytest

from terminal.quotes import OutOfOrder, QuoteBook


def test_a_quote_sets_the_best_bid_and_ask():
    q = QuoteBook()
    q.apply({"seq": 1, "symbol": "ACME", "bid": 99.5, "ask": 100.0})
    assert q.best("ACME") == (99.5, 100.0)
    assert round(q.spread("ACME"), 6) == 0.5


def test_a_trade_sets_the_last_price():
    q = QuoteBook()
    assert q.last("ACME") is None
    q.apply({"seq": 1, "symbol": "ACME", "last": 99.8, "size": 100})
    assert q.last("ACME") == 99.8


def test_out_of_order_ticks_are_refused_and_change_nothing():
    q = QuoteBook()
    q.apply({"seq": 5, "symbol": "ACME", "bid": 99.0, "ask": 99.5})
    with pytest.raises(OutOfOrder):
        q.apply({"seq": 5, "symbol": "ACME", "bid": 1.0, "ask": 2.0})
    assert q.best("ACME") == (99.0, 99.5)


def test_a_crossed_quote_is_refused():
    q = QuoteBook()
    with pytest.raises(ValueError):
        q.apply({"seq": 1, "symbol": "ACME", "bid": 101.0, "ask": 100.0})


def test_an_unknown_symbol_has_no_quote():
    with pytest.raises(KeyError):
        QuoteBook().best("NONE")
`

const marketTerminal: IdeaTemplate = {
  id: 'market-terminal',
  name: 'Market terminal',
  about: 'Streaming quotes, charts, news, a query language, a portfolio and a risk view',
  match: /\b(market|trading|financial) (terminal|data terminal)\b|\bterminal\b.*\b(quotes|market)\b|\bmarket data\b.*\b(terminal|dashboard)\b|\bquote (feed|stream)\b/i,
  plan: {
    version: 1,
    name: 'Market terminal',
    slug: 'market-terminal',
    summary: 'A market terminal built from the feed up: a quote book from streaming ticks, bars and charts, a news store tagged by symbol, a small query language, a portfolio with live P&L and a risk view with VaR and stress tests, in a keyboard-driven terminal UI. A long build over weeks that touches market data, systems and quant.',
    language: 'python',
    depth: 'deep',
    components: [
      c('feed', 'Feed handler', 'Reads the tick stream, in order, and recovers from gaps', ['streaming data', 'sequence numbers']),
      c('quotes', 'Quote book', 'Best bid and ask, last trade and spread per symbol', ['bid and ask', 'order of events']),
      c('bars', 'Bars and charts', 'OHLCV bars at any interval, drawn as charts', ['OHLC bars', 'time bucketing']),
      c('news', 'News', 'Headlines tagged by symbol, searchable', ['inverted indexes', 'entity tagging']),
      c('query', 'Query language', 'Commands like "ACME bars 5m" parsed and run', ['parsing', 'grammars']),
      c('portfolio', 'Portfolio', 'Positions and live profit and loss', ['mark-to-market', 'position keeping']),
      c('risk', 'Risk', 'Value at risk, exposures and stress tests', ['value at risk', 'stress testing']),
      c('ui', 'Terminal UI', 'Panels that update live, driven from the keyboard', ['terminal user interfaces', 'event loops'])
    ],
    links: [
      { from: 'feed', to: 'quotes', label: 'ticks' },
      { from: 'quotes', to: 'bars', label: 'trades' },
      { from: 'quotes', to: 'portfolio', label: 'prices' },
      { from: 'portfolio', to: 'risk', label: 'positions' },
      { from: 'query', to: 'ui', label: 'results' },
      { from: 'news', to: 'ui', label: 'headlines' },
      { from: 'bars', to: 'ui', label: 'charts' }
    ],
    milestones: [
      m('m1', 'A quote book', 'Apply quotes and trades from a tick stream in order, keeping each symbol’s best bid and ask, last price and spread.', ['quotes'], [['bid and ask', 'every price on the screen is one of them'], ['order of events', 'a stale tick must never win']], ['a quote sets the best bid and ask', 'a trade sets the last price', 'out-of-order ticks are refused and change nothing', 'a crossed quote is refused', 'an unknown symbol has no quote'], 4, ['Why must ticks be applied in sequence order per symbol?']),
      m('m2', 'Bars and charts', 'Build OHLCV bars at any interval from trades and draw them as charts in the terminal.', ['bars'], [['OHLC bars', 'how prices are summarised'], ['time bucketing', 'which bar a trade belongs to']], ['bars hold the right open, high, low, close and volume', 'a trade on a boundary lands in the right bar', 'empty intervals are handled'], 6, ['How do you decide which bar a trade on an interval boundary belongs to?']),
      m('m3', 'A query language', 'A small command language ("ACME last", "ACME bars 5m", "news ACME") parsed into commands and run.', ['query'], [['parsing', 'turning text into structure'], ['grammars', 'what commands are allowed']], ['each command parses into its structure', 'a bad command says where it went wrong', 'commands run against the quote book and bars'], 8, ['What is the difference between lexing and parsing?']),
      m('m4', 'News', 'Store headlines, tag them with the symbols they mention, and search them.', ['news'], [['inverted indexes', 'how search is fast'], ['entity tagging', 'which company a headline is about']], ['a headline is found by a word in it', 'headlines are tagged with their symbols', 'results come newest first'], 6, ['How does an inverted index make search fast?']),
      m('m5', 'Portfolio and P&L', 'Positions from fills, marked to market live, with realised and unrealised P&L.', ['portfolio'], [['mark-to-market', 'what a position is worth now'], ['position keeping', 'average cost and realised P&L']], ['fills update positions and average cost', 'unrealised P&L follows the last price', 'closing a position realises its P&L'], 8, ['What is the difference between realised and unrealised P&L?']),
      m('m6', 'Risk', 'Historical VaR, exposures by sector and stress tests on the portfolio.', ['risk'], [['value at risk', 'how much can be lost on a bad day'], ['stress testing', 'what a crash does']], ['historical VaR matches a hand-worked example', 'a stress scenario revalues every position', 'exposures sum to the portfolio'], 10, ['What does a one-day 99% VaR of £10,000 mean, and what doesn’t it say?']),
      m('m7', 'The terminal', 'A keyboard-driven terminal UI whose panels update live from the feed.', ['ui', 'feed'], [['event loops', 'many things updating at once'], ['terminal user interfaces', 'drawing without a browser']], ['panels update as ticks arrive', 'commands run from the keyboard', 'a dropped feed shows as stale'], 14, ['How does an event loop keep the screen live while waiting for input?'])
    ],
    scaffold: pyFiles('market-terminal', 'terminal', { 'terminal/quotes.py': QUOTES, 'tests/test_quotes.py': QUOTES_TESTS })
  }
}

// ---------- Exchange for tokenised assets ----------

const BOOK = `"""An order book with price-time priority: limit orders rest, incoming orders match against the
best opposite price first, and at one price the earlier order fills first.

Prices and quantities are integers (ticks and units).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Fill:
    taker: str
    maker: str
    price: int
    qty: int


class OrderBook:
    def submit(self, order_id: str, side: str, price: int, qty: int) -> list[Fill]:
        """side is "buy" or "sell". Matches what it can, rests the rest; returns the fills in order."""
        raise NotImplementedError

    def cancel(self, order_id: str) -> bool:
        """True when it was resting and is now gone."""
        raise NotImplementedError

    def best_bid(self) -> int | None:
        raise NotImplementedError

    def best_ask(self) -> int | None:
        raise NotImplementedError
`

const BOOK_TESTS = `from exchange.book import Fill, OrderBook


def test_orders_rest_when_nothing_crosses():
    b = OrderBook()
    assert b.submit("b1", "buy", 99, 10) == []
    assert b.submit("s1", "sell", 101, 5) == []
    assert (b.best_bid(), b.best_ask()) == (99, 101)


def test_a_crossing_order_fills_at_the_resting_price():
    b = OrderBook()
    b.submit("s1", "sell", 100, 5)
    assert b.submit("b1", "buy", 102, 5) == [Fill("b1", "s1", 100, 5)]
    assert b.best_ask() is None and b.best_bid() is None


def test_earlier_orders_fill_first_at_one_price():
    b = OrderBook()
    b.submit("s1", "sell", 100, 3)
    b.submit("s2", "sell", 100, 3)
    assert b.submit("b1", "buy", 100, 4) == [Fill("b1", "s1", 100, 3), Fill("b1", "s2", 100, 1)]


def test_the_unfilled_rest_of_an_order_rests():
    b = OrderBook()
    b.submit("s1", "sell", 100, 2)
    b.submit("b1", "buy", 100, 5)
    assert b.best_bid() == 100


def test_cancel_removes_a_resting_order():
    b = OrderBook()
    b.submit("b1", "buy", 99, 1)
    assert b.cancel("b1") is True
    assert b.cancel("b1") is False
    assert b.best_bid() is None
`

const exchange: IdeaTemplate = {
  id: 'exchange',
  name: 'Exchange for tokenised assets',
  about: 'A matching engine and order book, custody, and settlement on chain',
  match: /\bexchange\b|\bmatching engine\b|\border book\b|\btokeni[sz]ed (assets?|securities)\b|\bsecurities\b.*\bchain\b/i,
  plan: {
    version: 1,
    name: 'Exchange for tokenised assets',
    slug: 'tokenised-exchange',
    summary: 'A securities exchange for tokenised assets: an order book with price-time priority, a matching engine behind a gateway, pre-trade risk checks, custody of the tokens, and settlement of trades on a chain, delivery versus payment. A flagship that joins market structure, payments and blockchain.',
    language: 'python',
    depth: 'deep',
    components: [
      c('gateway', 'Order gateway', 'Accepts, validates and acknowledges orders', ['order types', 'message validation']),
      c('risk', 'Pre-trade risk', 'Limits and balance checks before an order reaches the book', ['pre-trade risk checks']),
      c('book', 'Order book', 'Price-time priority matching', ['order books', 'price-time priority']),
      c('feed', 'Market data', 'Publishes the book and trades', ['market data feeds']),
      c('custody', 'Custody', 'Holds clients’ tokens and cash', ['custody', 'segregation of client assets']),
      c('settle', 'Settlement on chain', 'Delivery versus payment as atomic token swaps', ['delivery versus payment', 'atomic swaps'])
    ],
    links: [
      { from: 'gateway', to: 'risk', label: 'orders' },
      { from: 'risk', to: 'book', label: 'accepted orders' },
      { from: 'book', to: 'feed', label: 'trades and quotes' },
      { from: 'book', to: 'settle', label: 'trades' },
      { from: 'custody', to: 'risk', label: 'balances' },
      { from: 'settle', to: 'custody', label: 'settled positions' }
    ],
    milestones: [
      m('m1', 'An order book', 'Limit orders that rest or match by price-time priority, with cancels.', ['book'], [['order books', 'the heart of an exchange'], ['price-time priority', 'who gets filled first, and why it is fair']], ['orders rest when nothing crosses', 'a crossing order fills at the resting price', 'earlier orders fill first at one price', 'the unfilled rest of an order rests', 'cancel removes a resting order'], 4, ['Why does a crossing order fill at the resting order’s price?']),
      m('m2', 'A matching engine behind a gateway', 'Orders arrive through a gateway that validates and acknowledges them; the engine is single-threaded and deterministic.', ['gateway', 'book'], [['order types', 'limit, market, immediate-or-cancel'], ['deterministic replay', 'an engine must give the same result twice']], ['a replayed order log gives the same trades', 'invalid orders are rejected with a reason', 'market and IOC orders never rest'], 8, ['Why are matching engines usually single-threaded?']),
      m('m3', 'Pre-trade risk', 'Check limits and available balances before an order is accepted, and reserve what it could spend.', ['risk', 'custody'], [['pre-trade risk checks', 'stopping a bad order before it trades']], ['an order over its limit is refused', 'an order needing more than the balance is refused', 'reserved balances are released on cancel'], 6, ['Why reserve a balance when an order is accepted, not when it fills?']),
      m('m4', 'Market data', 'Publish the top of book, depth and trades as an ordered feed with snapshots.', ['feed'], [['market data feeds', 'how everyone sees the market']], ['a snapshot plus updates rebuilds the book', 'trades are published in order', 'a gap is detected from the sequence'], 6, ['Why do feeds send snapshots as well as updates?']),
      m('m5', 'Custody of tokens', 'Client accounts holding tokens and cash, segregated, with deposits and withdrawals on chain.', ['custody'], [['custody', 'whose assets are whose'], ['segregation of client assets', 'what protects clients if the venue fails']], ['client balances reconcile to the chain', 'a withdrawal above balance is refused', 'deposits credit after confirmations'], 10, ['What does segregation of client assets protect against?']),
      m('m6', 'Settlement on chain', 'Settle each trade as an atomic swap of token for cash token: delivery versus payment, or nothing.', ['settle', 'custody'], [['delivery versus payment', 'the rule that removes principal risk'], ['atomic swaps', 'both legs or neither']], ['a trade settles both legs or neither', 'settlement updates custody', 'a failed settlement is retried, then reported'], 12, ['What risk does delivery versus payment remove?'])
    ],
    scaffold: pyFiles('tokenised-exchange', 'exchange', { 'exchange/book.py': BOOK, 'tests/test_book.py': BOOK_TESTS })
  }
}

// ---------- Maths: an options pricer, a numerical library, a proof checker ----------

const BS = `"""Black-Scholes from first principles: the normal distribution, then prices for European options.

No libraries: math.erf is the only help.
"""
import math  # noqa: F401


def norm_cdf(x: float) -> float:
    """The standard normal cumulative distribution function."""
    raise NotImplementedError


def call_price(s: float, k: float, t: float, r: float, sigma: float) -> float:
    """A European call: spot s, strike k, t years, risk-free rate r (continuous), volatility sigma."""
    raise NotImplementedError


def put_price(s: float, k: float, t: float, r: float, sigma: float) -> float:
    raise NotImplementedError
`

const BS_TESTS = `import math

from pricer.bs import call_price, norm_cdf, put_price


def test_the_normal_cdf_has_its_known_values():
    assert abs(norm_cdf(0.0) - 0.5) < 1e-12
    assert abs(norm_cdf(1.96) - 0.9750021) < 1e-6
    assert abs(norm_cdf(-1.0) + norm_cdf(1.0) - 1.0) < 1e-12


def test_a_call_matches_a_textbook_price():
    # Hull's example: S=42, K=40, r=10%, sigma=20%, six months: about 4.76
    assert abs(call_price(42, 40, 0.5, 0.1, 0.2) - 4.759) < 1e-3


def test_put_call_parity_holds():
    s, k, t, r, sigma = 100, 95, 0.75, 0.03, 0.25
    assert abs(call_price(s, k, t, r, sigma) - put_price(s, k, t, r, sigma) - (s - k * math.exp(-r * t))) < 1e-9


def test_a_deep_in_the_money_call_is_worth_its_forward_intrinsic_value():
    assert abs(call_price(400, 100, 1.0, 0.05, 0.2) - (400 - 100 * math.exp(-0.05))) < 1e-6
`

const optionsPricer: IdeaTemplate = {
  id: 'options-pricer',
  name: 'Options pricer from first principles',
  about: 'The normal distribution, Black-Scholes, Greeks, binomial trees and Monte Carlo',
  match: /\boption(s)? (pricer|pricing)\b|\bblack[- ]scholes\b|\bgreeks\b|\bderivatives pricing\b/i,
  plan: {
    version: 1,
    name: 'Options pricer',
    slug: 'options-pricer',
    summary: 'An options pricer built from first principles: the normal distribution, Black-Scholes prices and Greeks, a binomial tree for American options, Monte Carlo for exotics, and implied volatility by root finding. Every result is checked against a known value or an identity.',
    language: 'python',
    depth: 'solid',
    components: [
      c('dist', 'Distributions', 'The normal CDF and PDF from the error function', ['the normal distribution', 'cumulative distribution functions']),
      c('bs', 'Black-Scholes', 'Closed-form European prices and Greeks', ['Black-Scholes model', 'risk-neutral pricing']),
      c('tree', 'Binomial tree', 'American options by backward induction', ['binomial option pricing', 'backward induction']),
      c('mc', 'Monte Carlo', 'Path simulation for exotic payoffs', ['Monte Carlo simulation', 'geometric Brownian motion']),
      c('iv', 'Implied volatility', 'Volatility from a price, by root finding', ['root finding', "Newton's method"])
    ],
    links: [
      { from: 'dist', to: 'bs', label: 'N(d1), N(d2)' },
      { from: 'bs', to: 'iv', label: 'price and vega' },
      { from: 'bs', to: 'tree', label: 'benchmark prices' },
      { from: 'bs', to: 'mc', label: 'benchmark prices' }
    ],
    milestones: [
      m('m1', 'Black-Scholes from the normal CDF', 'The normal CDF from math.erf, then European call and put prices.', ['dist', 'bs'], [['the normal distribution', 'Black-Scholes is built on it'], ['risk-neutral pricing', 'why the drift disappears']], ['the normal CDF has its known values', 'a call matches a textbook price', 'put-call parity holds', 'a deep in-the-money call is worth its forward intrinsic value'], 4, ['What does N(d2) mean in Black-Scholes?', 'State put-call parity and why it must hold.']),
      m('m2', 'The Greeks', 'Delta, gamma, vega, theta and rho, closed form and checked by finite differences.', ['bs'], [['option Greeks', 'how a price moves'], ['finite differences', 'checking a derivative numerically']], ['each Greek matches its finite difference', 'call and put deltas differ by one', 'gamma is the same for a call and a put'], 5, ['Why is gamma the same for a call and a put?']),
      m('m3', 'A binomial tree', 'Price American and European options on a recombining tree and watch it converge.', ['tree'], [['binomial option pricing', 'pricing step by step'], ['backward induction', 'early exercise']], ['the European tree price converges to Black-Scholes', 'an American put is worth at least the European', 'an American call on a non-dividend stock equals the European'], 6, ['Why is it never optimal to exercise an American call early on a stock without dividends?']),
      m('m4', 'Monte Carlo', 'Simulate paths for European and Asian options, with standard errors and antithetic variates.', ['mc'], [['Monte Carlo simulation', 'when there is no formula'], ['variance reduction', 'fewer paths for the same accuracy']], ['the European price is within three standard errors of Black-Scholes', 'antithetic variates reduce the standard error', 'results are reproducible from a seed'], 6, ['How does the standard error of a Monte Carlo price fall with the number of paths?']),
      m('m5', 'Implied volatility', 'Recover volatility from a price with Newton’s method, falling back to bisection.', ['iv'], [["Newton's method", 'fast when it works'], ['root finding', 'safe when Newton fails']], ['a price round-trips to its volatility', 'prices outside the no-arbitrage bounds are refused', 'deep out-of-the-money options still converge'], 5, ['Why can Newton’s method fail for implied volatility, and what saves it?'])
    ],
    scaffold: pyFiles('options-pricer', 'pricer', { 'pricer/bs.py': BS, 'tests/test_bs.py': BS_TESTS })
  }
}

const ROOTS = `"""Root finding: bisection, which always works on a bracket, and Newton's method, which is fast."""
from typing import Callable


class NoBracket(ValueError):
    """f(a) and f(b) have the same sign, so the interval may hold no root."""


def bisect(f: Callable[[float], float], a: float, b: float, tol: float = 1e-10) -> float:
    raise NotImplementedError


def newton(f: Callable[[float], float], df: Callable[[float], float], x0: float, tol: float = 1e-12, max_iter: int = 50) -> float:
    """Raises ArithmeticError when the derivative is zero or it doesn't converge in max_iter steps."""
    raise NotImplementedError
`

const ROOTS_TESTS = `import math

import pytest

from numerics.roots import NoBracket, bisect, newton


def test_bisection_finds_the_square_root_of_two():
    assert abs(bisect(lambda x: x * x - 2, 0, 2) - math.sqrt(2)) < 1e-9


def test_bisection_needs_a_bracket():
    with pytest.raises(NoBracket):
        bisect(lambda x: x * x + 1, -1, 1)


def test_newton_finds_a_root_of_cosine():
    assert abs(newton(math.cos, lambda x: -math.sin(x), 1.0) - math.pi / 2) < 1e-12


def test_newton_refuses_a_zero_derivative():
    with pytest.raises(ArithmeticError):
        newton(lambda x: x * x + 1, lambda x: 2 * x, 0.0)
`

const numerics: IdeaTemplate = {
  id: 'numerics',
  name: 'A numerical library',
  about: 'Root finding, linear algebra, integration and ODEs, with their errors measured',
  match: /\bnumerical (library|methods|analysis)\b|\blinear algebra library\b|\broot finding\b|\bode solver\b/i,
  plan: {
    version: 1,
    name: 'Numerical library',
    slug: 'numerical-library',
    summary: 'A small numerical library written from scratch: root finding, vectors and matrices with LU decomposition, numerical integration, and ODE solvers, each with its error measured against known answers. It teaches what NumPy and SciPy do and when they go wrong.',
    language: 'python',
    depth: 'solid',
    components: [
      c('roots', 'Root finding', 'Bisection, Newton and secant methods', ['root finding', "Newton's method"]),
      c('linalg', 'Linear algebra', 'Matrices, LU decomposition and solving systems', ['matrix multiplication', 'LU decomposition']),
      c('integrate', 'Integration', 'Trapezoid, Simpson and adaptive quadrature', ['numerical integration']),
      c('ode', 'ODE solvers', 'Euler and Runge-Kutta, with step control', ['ordinary differential equations', 'Runge-Kutta methods']),
      c('errors', 'Error analysis', 'Convergence orders and floating-point limits', ['floating-point arithmetic', 'order of convergence'])
    ],
    links: [
      { from: 'linalg', to: 'ode', label: 'implicit steps' },
      { from: 'roots', to: 'ode', label: 'implicit equations' },
      { from: 'errors', to: 'integrate', label: 'convergence checks' }
    ],
    milestones: [
      m('m1', 'Root finding', 'Bisection on a bracket and Newton’s method, with their failure cases.', ['roots', 'errors'], [['root finding', 'solving f(x) = 0'], ["Newton's method", 'quadratic convergence and its limits']], ['bisection finds the square root of two', 'bisection needs a bracket', 'Newton finds a root of cosine', 'Newton refuses a zero derivative'], 3, ['Why does bisection always converge, and how fast?']),
      m('m2', 'Matrices and LU', 'Matrix arithmetic and LU decomposition with partial pivoting to solve linear systems.', ['linalg'], [['LU decomposition', 'how linear systems are solved'], ['partial pivoting', 'why it keeps errors small']], ['A equals L times U (with pivoting)', 'a solved system satisfies Ax = b', 'a singular matrix is reported'], 6, ['What goes wrong in LU without pivoting?']),
      m('m3', 'Integration', 'Trapezoid and Simpson rules, and adaptive quadrature that meets a tolerance.', ['integrate', 'errors'], [['numerical integration', 'areas from samples'], ['order of convergence', 'how fast the error falls']], ['Simpson is exact for cubics', 'the trapezoid error falls as h squared', 'adaptive quadrature meets its tolerance'], 5, ['Why is Simpson’s rule exact for cubics?']),
      m('m4', 'ODE solvers', 'Euler and fourth-order Runge-Kutta, with an adaptive step size.', ['ode'], [['ordinary differential equations', 'change over time'], ['Runge-Kutta methods', 'accuracy per step']], ['RK4 error falls as h to the fourth', 'exponential decay is matched', 'the adaptive step meets its tolerance'], 6, ['What is the global error order of Euler’s method?'])
    ],
    scaffold: pyFiles('numerical-library', 'numerics', { 'numerics/roots.py': ROOTS, 'tests/test_roots.py': ROOTS_TESTS })
  }
}

const LOGIC = `"""Propositional logic: formulas parsed from text, evaluated, and checked for being tautologies.

Syntax: variables are lower-case words; ~ is not, & is and, | is or, -> is implies; brackets group.
-> binds weakest and is right-associative; then |, then &, then ~.
"""


def parse(text: str):
    """A tree for the formula; ValueError (with where) for anything that isn't one."""
    raise NotImplementedError


def evaluate(formula, env: dict[str, bool]) -> bool:
    raise NotImplementedError


def is_tautology(text: str) -> bool:
    """True under every assignment of its variables."""
    raise NotImplementedError
`

const LOGIC_TESTS = `import pytest

from prover.logic import evaluate, is_tautology, parse


def test_formulas_evaluate_under_an_assignment():
    assert evaluate(parse("p & ~q"), {"p": True, "q": False}) is True
    assert evaluate(parse("p -> q"), {"p": True, "q": False}) is False


def test_implication_is_right_associative_and_binds_weakest():
    assert evaluate(parse("p -> q -> p"), {"p": False, "q": True}) is True
    assert evaluate(parse("p | q -> r"), {"p": True, "q": False, "r": False}) is False


def test_tautologies_are_recognised():
    assert is_tautology("p | ~p")
    assert is_tautology("(p -> q) -> (~q -> ~p)")
    assert not is_tautology("p -> q")


def test_bad_formulas_are_refused():
    with pytest.raises(ValueError):
        parse("p & ")
    with pytest.raises(ValueError):
        parse("(p | q")
`

const proofChecker: IdeaTemplate = {
  id: 'proof-checker',
  name: 'A proof checker',
  about: 'Propositional logic, natural deduction and a checker for proofs written in it',
  match: /\bproof (checker|assistant)\b|\bnatural deduction\b|\btheorem prov(er|ing)\b|\bpropositional logic\b/i,
  plan: {
    version: 1,
    name: 'Proof checker',
    slug: 'proof-checker',
    summary: 'A checker for proofs in propositional and then first-order logic: a parser, truth tables, natural-deduction rules, and a checker that accepts a proof only when every line follows by a rule. It teaches logic, parsing and what it means for a proof to be correct.',
    language: 'python',
    depth: 'solid',
    components: [
      c('parser', 'Parser', 'Formulas from text into trees', ['parsing', 'operator precedence']),
      c('semantics', 'Semantics', 'Evaluation and truth tables', ['propositional logic', 'truth tables']),
      c('rules', 'Inference rules', 'Natural-deduction rules as functions', ['natural deduction']),
      c('checker', 'Proof checker', 'Each line checked against its rule and its references', ['proof checking', 'assumptions and scope']),
      c('fol', 'First-order logic', 'Quantifiers, terms and substitution', ['first-order logic', 'substitution'])
    ],
    links: [
      { from: 'parser', to: 'semantics', label: 'formulas' },
      { from: 'parser', to: 'checker', label: 'proof lines' },
      { from: 'rules', to: 'checker', label: 'rules' },
      { from: 'fol', to: 'rules', label: 'quantifier rules' }
    ],
    milestones: [
      m('m1', 'Formulas and truth', 'Parse propositional formulas with the right precedence, evaluate them, and recognise tautologies.', ['parser', 'semantics'], [['operator precedence', 'p | q -> r has one meaning'], ['truth tables', 'what a tautology is']], ['formulas evaluate under an assignment', 'implication is right-associative and binds weakest', 'tautologies are recognised', 'bad formulas are refused'], 4, ['Why is a formula with n variables checked against 2^n assignments?']),
      m('m2', 'Natural deduction', 'Introduction and elimination rules for each connective, as functions that check one step.', ['rules'], [['natural deduction', 'proofs as rules applied']], ['each rule accepts its valid uses', 'each rule rejects a misuse', 'modus ponens and its relatives are covered'], 6, ['What does the introduction rule for implication require?']),
      m('m3', 'A proof checker', 'Check a whole proof: numbered lines, rules, references and assumption boxes.', ['checker'], [['proof checking', 'every line must follow'], ['assumptions and scope', 'what a closed box lets you use']], ['a correct proof is accepted', 'a line citing a closed assumption is rejected', 'the error names the line and rule'], 8, ['Why can’t a line cite a formula inside a closed assumption box?']),
      m('m4', 'First-order logic', 'Quantifiers, substitution that avoids capture, and their rules in the checker.', ['fol'], [['first-order logic', 'for all and there exists'], ['substitution', 'why variable capture is a bug']], ['substitution avoids capture', 'universal elimination works', 'existential introduction works'], 10, ['What is variable capture, and how is it avoided?'])
    ],
    scaffold: pyFiles('proof-checker', 'prover', { 'prover/logic.py': LOGIC, 'tests/test_logic.py': LOGIC_TESTS })
  }
}

export const IDEA_TEMPLATES: IdeaTemplate[] = [paymentRail, blockchain, stablecoin, coreBanking, mlProject, dataPipeline, marketTerminal, exchange, optionsPricer, numerics, proofChecker]

export const ideaTemplate = (id: string | null | undefined) => IDEA_TEMPLATES.find((t) => t.id === id) ?? null

/** The template an idea is closest to: the first whose words it uses */
export function matchTemplate(idea: string): IdeaTemplate | null {
  return IDEA_TEMPLATES.find((t) => t.match.test(idea)) ?? null
}

/** A template as a whole plan, ready to check and show */
export function planFromTemplate(t: IdeaTemplate, idea: string, now: number, isPrivate: boolean): ProjectPlan {
  // A template whole is a system, or a flagship for the long ones
  const tier = t.plan.tier ?? (['market-terminal', 'exchange'].includes(t.id) ? 4 : 3)
  return JSON.parse(JSON.stringify({ ...t.plan, tier, idea: idea.trim() || t.about, template: t.id, by: 'template', private: isPrivate, createdAt: now })) as ProjectPlan
}
