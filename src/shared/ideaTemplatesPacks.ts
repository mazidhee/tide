/**
 * Starting maps for projects in C++ and Solidity, the languages the track packs make hands-on: a
 * ledger and a fast order book in C++ (the C++ roadmap's capstones), and a collateralised vault
 * and an audit with proofs of concept in Solidity (the blockchain engineering capstones). Each
 * has real starting files: stubs that compile, and tests for the first milestone that fail until
 * the learner builds it. C++ tests use Tide's check.hpp and run with the sanitizers on; Solidity
 * tests run with forge test, both in Tide's sandbox.
 */
import type { ProjectPlan, ScaffoldFile } from './ideaProject'
import type { IdeaTemplate } from './ideaTemplates'
import { CHECK_HPP, cppBuildFiles, FOUNDRY_FILES } from './ideTemplates'

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
const files = (o: Record<string, string>): ScaffoldFile[] => Object.entries(o).map(([path, content]) => ({ path, content }))

// ---------- C++: a ledger ----------

const LEDGER_HPP = `#pragma once
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Amounts are whole minor units (pence, cents): never floating point.
using Minor = std::int64_t;

struct Posting {
    std::string account;
    Minor amount;  // positive debits the account, negative credits it
};

struct Entry {
    std::string id;
    std::vector<Posting> postings;
    std::string memo;
};

class UnbalancedEntry : public std::invalid_argument {
public:
    using std::invalid_argument::invalid_argument;
};

class Ledger {
public:
    // Opens an account with a zero balance; opening one twice is an error.
    void open(const std::string& account);

    // Records an entry, all or nothing. Throws UnbalancedEntry when the postings don't sum to
    // zero, std::out_of_range for an account that isn't open, std::invalid_argument for an id
    // already used. A failed post changes nothing.
    void post(const Entry& entry);

    // The sum of every posting to the account; std::out_of_range when it isn't open.
    Minor balance(const std::string& account) const;

    const std::vector<Entry>& entries() const { return entries_; }

private:
    std::map<std::string, Minor> balances_;
    std::vector<Entry> entries_;
};
`

const LEDGER_CPP = `#include "ledger.hpp"

void Ledger::open(const std::string& account) {
    (void)account;
    throw std::logic_error("not implemented: Ledger::open");
}

void Ledger::post(const Entry& entry) {
    (void)entry;
    throw std::logic_error("not implemented: Ledger::post");
}

Minor Ledger::balance(const std::string& account) const {
    (void)account;
    throw std::logic_error("not implemented: Ledger::balance");
}
`

const LEDGER_MAIN = `#include <iostream>

#include "ledger.hpp"

int main() {
    Ledger ledger;
    ledger.open("customer:alice");
    ledger.open("customer:bob");
    ledger.post({"e1", {{"customer:alice", -500}, {"customer:bob", 500}}, "alice pays bob"});
    std::cout << "bob has " << ledger.balance("customer:bob") << " pence\\n";
}
`

const LEDGER_TESTS = `#include "check.hpp"
#include "ledger.hpp"

static Ledger ledger() {
    Ledger l;
    for (const char* name : {"customer:alice", "customer:bob", "bank:settlement"}) l.open(name);
    return l;
}

TEST(balanced_entry_moves_money) {
    auto l = ledger();
    l.post({"e1", {{"customer:alice", -500}, {"customer:bob", 500}}, "alice pays bob"});
    CHECK_EQ(l.balance("customer:alice"), -500);
    CHECK_EQ(l.balance("customer:bob"), 500);
}

TEST(unbalanced_entry_is_rejected_and_changes_nothing) {
    auto l = ledger();
    CHECK_THROWS(l.post({"e1", {{"customer:alice", -500}, {"customer:bob", 400}}, ""}));
    CHECK_EQ(l.balance("customer:bob"), 0);
    CHECK(l.entries().empty());
}

TEST(unknown_account_is_rejected) {
    auto l = ledger();
    CHECK_THROWS(l.post({"e1", {{"customer:carol", -100}, {"customer:bob", 100}}, ""}));
}

TEST(entry_ids_are_used_once) {
    auto l = ledger();
    l.post({"e1", {{"customer:alice", -100}, {"customer:bob", 100}}, ""});
    CHECK_THROWS(l.post({"e1", {{"customer:alice", -100}, {"customer:bob", 100}}, ""}));
    CHECK_EQ(l.balance("customer:bob"), 100);
}

int main() { return check::run_all(); }
`

const cppLedger: IdeaTemplate = {
  id: 'cpp-ledger',
  name: 'A ledger in C++',
  about: 'Double entry in C++: classes, RAII file handling, a command line and unit tests',
  match: /\b(c\+\+|cpp)\b.*\bledger\b|\bledger\b.*\b(c\+\+|cpp)\b/i,
  plan: {
    version: 1,
    name: 'C++ ledger',
    slug: 'cpp-ledger',
    summary: 'A double-entry ledger in modern C++: amounts as whole minor units, entries that must balance and post all or nothing, a journal file kept with RAII and replayed on start, and a small command line. Built with CMake and checked with the address and undefined-behaviour sanitizers on, it is the C++ roadmap’s first capstone.',
    language: 'cpp',
    depth: 'solid',
    components: [
      c('money', 'Money and postings', 'Whole minor units, never floats; postings that debit and credit', ['integer arithmetic', 'value types']),
      c('ledger', 'The ledger', 'Accounts and balanced entries, posted all or nothing', ['double-entry bookkeeping', 'class invariants', 'exceptions']),
      c('journal', 'Journal file', 'Every entry appended to a file through an RAII handle, replayed on start', ['RAII', 'file streams', 'exception safety']),
      c('cli', 'Command line', 'open, post, balance and trial-balance commands', ['argument parsing', 'std::string_view'])
    ],
    links: [
      { from: 'money', to: 'ledger', label: 'postings' },
      { from: 'ledger', to: 'journal', label: 'entries' },
      { from: 'cli', to: 'ledger', label: 'commands' }
    ],
    milestones: [
      m('m1', 'Balanced entries', 'Accounts and entries whose postings must sum to zero, posted all or nothing.', ['money', 'ledger'], [['double-entry bookkeeping', 'money moves, it is never made'], ['class invariants', 'the ledger is always balanced'], ['exceptions', 'a failed post changes nothing']], ['a balanced entry moves money', 'an unbalanced entry is rejected and changes nothing', 'an unknown account is rejected', 'entry ids are used once'], 4, ['Why must a failed post leave the ledger exactly as it was?']),
      m('m2', 'The journal, with RAII', 'Append each entry to a journal file through a class that owns the file, and replay it on start.', ['journal'], [['RAII', 'the file closes however the scope ends'], ['exception safety', 'the strong guarantee']], ['a posted entry is in the journal', 'replaying the journal gives the same balances', 'a half-written last line is ignored on replay'], 5, ['What does RAII guarantee that a close() call at the end of a function doesn’t?']),
      m('m3', 'A command line', 'open, post, balance and trial-balance commands over the ledger and its journal.', ['cli'], [['argument parsing', 'turning text into commands'], ['std::string_view', 'reading without copying']], ['each command works from the terminal', 'a bad command prints usage and exits non-zero', 'the trial balance sums to zero'], 4, ['When is a std::string_view unsafe to keep?']),
      m('m4', 'Sanitizer-clean and fuzzed', 'Random entries thrown at the ledger with the sanitizers on: no leak, no overflow, no imbalance.', ['ledger', 'journal'], [['sanitizers', 'finding undefined behaviour'], ['property testing', 'the invariant under random input']], ['a thousand random entries keep the books balanced', 'AddressSanitizer and UBSan report nothing', 'overflowing amounts are refused, not wrapped'], 4, ['Why is signed integer overflow undefined behaviour in C++?'])
    ],
    scaffold: files({
      ...cppBuildFiles('cpp-ledger'),
      'include/ledger.hpp': LEDGER_HPP,
      'src/ledger.cpp': LEDGER_CPP,
      'src/main.cpp': LEDGER_MAIN,
      'tests/check.hpp': CHECK_HPP,
      'tests/test_ledger.cpp': LEDGER_TESTS
    })
  }
}

// ---------- C++: a fast order book ----------

const BOOK_HPP = `#pragma once
#include <cstdint>
#include <optional>
#include <vector>

using OrderId = std::uint64_t;
using Price = std::int64_t;  // in ticks
using Qty = std::int64_t;

enum class Side { Buy, Sell };

struct Trade {
    OrderId buy;
    OrderId sell;
    Price price;
    Qty qty;
};

// A limit order book with price-time priority: the best price trades first, and at one price
// the order that came first.
class OrderBook {
public:
    // Adds a limit order; whatever crosses the other side trades at the resting order's price.
    // Returns the trades it made, in order. A quantity or price of zero or less is refused
    // (std::invalid_argument), as is an id already in the book.
    std::vector<Trade> add(OrderId id, Side side, Price price, Qty qty);

    // Removes a resting order; false when there is none with that id.
    bool cancel(OrderId id);

    std::optional<Price> best_bid() const;
    std::optional<Price> best_ask() const;
    // The quantity resting at a price on one side
    Qty depth(Side side, Price price) const;
};
`

const BOOK_CPP = `#include "order_book.hpp"

#include <stdexcept>

std::vector<Trade> OrderBook::add(OrderId, Side, Price, Qty) { throw std::logic_error("not implemented: OrderBook::add"); }
bool OrderBook::cancel(OrderId) { throw std::logic_error("not implemented: OrderBook::cancel"); }
std::optional<Price> OrderBook::best_bid() const { throw std::logic_error("not implemented: OrderBook::best_bid"); }
std::optional<Price> OrderBook::best_ask() const { throw std::logic_error("not implemented: OrderBook::best_ask"); }
Qty OrderBook::depth(Side, Price) const { throw std::logic_error("not implemented: OrderBook::depth"); }
`

const BOOK_MAIN = `#include <chrono>
#include <iostream>
#include <random>

#include "order_book.hpp"

// A rough benchmark: a million random orders around a price, and how long they take
int main() {
    OrderBook book;
    std::mt19937_64 rng(42);
    std::normal_distribution<double> price(10'000, 20);
    auto t0 = std::chrono::steady_clock::now();
    std::size_t trades = 0;
    for (OrderId id = 1; id <= 1'000'000; ++id) {
        Side side = (rng() & 1) ? Side::Buy : Side::Sell;
        trades += book.add(id, side, static_cast<Price>(price(rng)), 1 + static_cast<Qty>(rng() % 100)).size();
    }
    double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::cout << trades << " trades, " << static_cast<long>(1'000'000 / secs) << " orders a second\\n";
}
`

const BOOK_TESTS = `#include "check.hpp"
#include "order_book.hpp"

TEST(best_prices_come_from_resting_orders) {
    OrderBook b;
    b.add(1, Side::Buy, 99, 10);
    b.add(2, Side::Buy, 100, 5);
    b.add(3, Side::Sell, 102, 7);
    CHECK_EQ(*b.best_bid(), 100);
    CHECK_EQ(*b.best_ask(), 102);
}

TEST(a_crossing_order_trades_at_the_resting_price) {
    OrderBook b;
    b.add(1, Side::Sell, 101, 10);
    auto trades = b.add(2, Side::Buy, 103, 4);
    CHECK_EQ(trades.size(), 1u);
    CHECK_EQ(trades[0].price, 101);
    CHECK_EQ(trades[0].qty, 4);
    CHECK_EQ(b.depth(Side::Sell, 101), 6);
}

TEST(time_priority_at_one_price) {
    OrderBook b;
    b.add(1, Side::Sell, 101, 5);
    b.add(2, Side::Sell, 101, 5);
    auto trades = b.add(3, Side::Buy, 101, 7);
    CHECK_EQ(trades.size(), 2u);
    CHECK_EQ(trades[0].sell, 1u);
    CHECK_EQ(trades[0].qty, 5);
    CHECK_EQ(trades[1].sell, 2u);
    CHECK_EQ(trades[1].qty, 2);
}

TEST(cancel_removes_a_resting_order) {
    OrderBook b;
    b.add(1, Side::Buy, 100, 5);
    CHECK(b.cancel(1));
    CHECK(!b.best_bid().has_value());
    CHECK(!b.cancel(1));
}

int main() { return check::run_all(); }
`

const cppOrderBook: IdeaTemplate = {
  id: 'cpp-order-book',
  name: 'A fast order book in C++',
  about: 'Price-time matching in C++, then made fast and measured: a million orders a second',
  match: /\b(c\+\+|cpp)\b.*\b(order book|matching engine)\b|\b(order book|matching engine)\b.*\b(c\+\+|cpp)\b/i,
  plan: {
    version: 1,
    name: 'C++ order book',
    slug: 'cpp-order-book',
    summary: 'A limit order book in C++ that matches by price-time priority, then made fast: flat containers instead of node-based maps, no allocation on the hot path, and every gain backed by a benchmark and a profile. The C++ roadmap’s performance capstone.',
    language: 'cpp',
    depth: 'deep',
    components: [
      c('book', 'Price levels', 'Resting orders by price, oldest first at each price', ['limit order books', 'std::map and std::deque']),
      c('match', 'Matching', 'Crossing orders trade at the resting price, in time order', ['price-time priority', 'partial fills']),
      c('fast', 'The fast path', 'Flat arrays by tick, an id index, no allocation per order', ['cache locality', 'memory pools']),
      c('bench', 'Benchmarks and profiles', 'Throughput and latency measured, hot spots found', ['benchmarking', 'profiling'])
    ],
    links: [
      { from: 'book', to: 'match', label: 'resting orders' },
      { from: 'fast', to: 'book', label: 'replaces' },
      { from: 'bench', to: 'fast', label: 'measures' }
    ],
    milestones: [
      m('m1', 'A correct book', 'Add, cancel and match limit orders with price-time priority, with std::map and std::deque.', ['book', 'match'], [['price-time priority', 'who trades first'], ['partial fills', 'one order against several']], ['best prices come from resting orders', 'a crossing order trades at the resting price', 'time priority holds at one price', 'cancel removes a resting order'], 6, ['Why does a crossing order trade at the resting order’s price, not its own?']),
      m('m2', 'Measured', 'A benchmark of a million orders and a latency histogram, before any optimisation.', ['bench'], [['benchmarking', 'numbers before opinions'], ['latency percentiles', 'the tail is what hurts']], ['the benchmark prints orders a second and p50, p99 latency', 'results are stable within 5% between runs', 'a profile names the hottest functions'], 4, ['Why report p99 latency and not only the mean?']),
      m('m3', 'Fast', 'Flat price levels indexed by tick, an id index for cancels, and no allocation per order.', ['fast'], [['cache locality', 'why a vector beats a map'], ['memory pools', 'allocation off the hot path']], ['the tests still pass', 'throughput is at least five times the first version', 'no allocation happens per order after warm-up'], 10, ['Why is a contiguous array faster to walk than a tree of nodes?']),
      m('m4', 'A million a second', 'Replay a day of ticks and reach a million orders a second, each gain backed by a measurement.', ['fast', 'bench'], [['profiling', 'measure, change one thing, measure'], ['branch prediction', 'predictable code is fast code']], ['a million orders a second on this Mac', 'the replay matches the slow book trade for trade', 'a write-up lists each change and what it gained'], 8, ['What is the danger of optimising without a profile?'])
    ],
    scaffold: files({
      ...cppBuildFiles('cpp-order-book'),
      'include/order_book.hpp': BOOK_HPP,
      'src/order_book.cpp': BOOK_CPP,
      'src/main.cpp': BOOK_MAIN,
      'tests/check.hpp': CHECK_HPP,
      'tests/test_order_book.cpp': BOOK_TESTS
    })
  }
}

// ---------- Solidity: a collateralised vault ----------

const STABLE_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice A minimal stablecoin: only the vault that deploys it may mint and burn
contract Stable {
    string public constant name = "Tide Dollar";
    string public constant symbol = "TUSD";
    uint8 public constant decimals = 18;
    address public immutable vault;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    error OnlyVault();

    constructor() {
        vault = msg.sender;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function mint(address to, uint256 amount) external onlyVault {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function burn(address from, uint256 amount) external onlyVault {
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`

const ORACLE_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The price of one ether in dollars, with 18 decimals, set by its owner (a stand-in for a real feed)
contract Oracle {
    address public immutable owner = msg.sender;
    uint256 public price;
    uint256 public updatedAt;

    function set(uint256 newPrice) external {
        require(msg.sender == owner, "not owner");
        price = newPrice;
        updatedAt = block.timestamp;
    }
}
`

const VAULT_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Stable} from "./Stable.sol";
import {Oracle} from "./Oracle.sol";

/// @notice Lock ether, borrow dollars against it. A position must stay over-collateralised:
/// collateral value * 100 >= debt * MIN_RATIO (150%), priced by the oracle.
contract Vault {
    uint256 public constant MIN_RATIO = 150;
    Stable public immutable stable;
    Oracle public immutable oracle;

    mapping(address => uint256) public collateral; // wei
    mapping(address => uint256) public debt; // stable, 18 decimals

    error Undercollateralised(uint256 ratio);
    error NothingToWithdraw();

    constructor(Oracle _oracle) {
        oracle = _oracle;
        stable = new Stable();
    }

    /// @notice Adds the ether sent to the caller's collateral
    function deposit() external payable {
        revert("not implemented: deposit");
    }

    /// @notice Borrows stable against collateral; reverts Undercollateralised when the position would fall below MIN_RATIO
    function mint(uint256 amount) external {
        amount;
        revert("not implemented: mint");
    }

    /// @notice The position's collateral ratio in percent (type(uint256).max with no debt)
    function ratio(address who) public view returns (uint256) {
        who;
        revert("not implemented: ratio");
    }

    /// @notice Returns collateral; reverts Undercollateralised when what is left would be below MIN_RATIO
    function withdraw(uint256 amount) external {
        amount;
        revert("not implemented: withdraw");
    }
}
`

const VAULT_TESTS = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {Oracle} from "../src/Oracle.sol";

contract VaultTest is Test {
    Oracle oracle;
    Vault vault;
    address alice = makeAddr("alice");

    function setUp() public {
        oracle = new Oracle();
        oracle.set(2000e18); // one ether is $2,000
        vault = new Vault(oracle);
        vm.deal(alice, 10 ether);
    }

    function test_DepositAddsCollateral() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();
        assertEq(vault.collateral(alice), 1 ether);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_MintUpToTheMinimumRatio() public {
        vm.startPrank(alice);
        vault.deposit{value: 1.5 ether}(); // $3,000 of collateral
        vault.mint(2000e18); // exactly 150%
        vm.stopPrank();
        assertEq(vault.stable().balanceOf(alice), 2000e18);
        assertEq(vault.ratio(alice), 150);
    }

    function test_MintPastTheRatioReverts() public {
        vm.startPrank(alice);
        vault.deposit{value: 1 ether}();
        vm.expectRevert(abi.encodeWithSelector(Vault.Undercollateralised.selector, 133));
        vault.mint(1500e18);
        vm.stopPrank();
    }

    function test_WithdrawKeepsThePositionSafe() public {
        vm.startPrank(alice);
        vault.deposit{value: 2 ether}();
        vault.mint(1000e18);
        vault.withdraw(1 ether); // $2,000 against $1,000: 200%
        vm.expectRevert(abi.encodeWithSelector(Vault.Undercollateralised.selector, 100));
        vault.withdraw(0.5 ether);
        vm.stopPrank();
        assertEq(alice.balance, 9 ether);
    }
}
`

const solVault: IdeaTemplate = {
  id: 'sol-vault',
  name: 'A collateralised vault in Solidity',
  about: 'Lock ether, borrow a stablecoin, an oracle and liquidations, invariant-tested in Foundry',
  match: /\b(solidity|foundry)\b.*\b(vault|collateral|stablecoin|lending)\b|\b(vault|collateral|lending)\b.*\b(solidity|smart contracts?)\b|\bcdp\b/i,
  plan: {
    version: 1,
    name: 'Solidity vault',
    slug: 'solidity-vault',
    summary: 'A collateralised debt position in Solidity: ether locked as collateral, a stablecoin borrowed against it at 150%, priced by an oracle that can go stale, positions liquidated with a bonus when they fall short, and invariants checked by Foundry’s fuzzer across thousands of random calls. The blockchain engineering roadmap’s smart contract capstone.',
    language: 'solidity',
    depth: 'solid',
    components: [
      c('vault', 'Vault', 'Collateral in, debt out, ratios kept', ['collateralisation ratio', 'checks-effects-interactions']),
      c('stable', 'Stablecoin', 'Minted and burned only by the vault', ['ERC-20 tokens', 'access control']),
      c('oracle', 'Oracle', 'The price of ether, and when it is too old to trust', ['price oracles', 'stale data']),
      c('liquidate', 'Liquidations', 'Anyone repays an unsafe position and takes its collateral at a bonus', ['liquidation incentives', 'bad debt']),
      c('invariants', 'Invariant tests', 'Properties that hold across random sequences of calls', ['invariant testing', 'fuzzing'])
    ],
    links: [
      { from: 'oracle', to: 'vault', label: 'price' },
      { from: 'vault', to: 'stable', label: 'mint and burn' },
      { from: 'liquidate', to: 'vault', label: 'unsafe positions' },
      { from: 'invariants', to: 'vault', label: 'checks' }
    ],
    milestones: [
      m('m1', 'Deposit, mint and withdraw', 'Collateral in, a stablecoin borrowed at no less than 150%, and withdrawals that keep the position safe.', ['vault', 'stable'], [['collateralisation ratio', 'why over-collateralised'], ['checks-effects-interactions', 'state before ether moves']], ['deposit adds collateral', 'mint works up to the minimum ratio', 'minting past the ratio reverts with the ratio', 'withdrawing keeps the position safe'], 5, ['Why must a vault update state before sending ether?'], [{ title: 'MakerDAO: The Maker Protocol white paper', kind: 'web', url: 'https://makerdao.com/whitepaper/', why: 'Vaults, the stability fee and liquidations as they run for real' }]),
      m('m2', 'A careful oracle', 'Refuse prices that are stale or zero, and repay debt to free collateral.', ['oracle', 'vault'], [['price oracles', 'the vault is only as safe as its price'], ['stale data', 'an old price is a wrong price']], ['a stale price stops minting and withdrawing', 'a zero price is refused', 'repaying debt burns stable and frees collateral'], 4, ['What can go wrong when a protocol trusts a spot price?']),
      m('m3', 'Liquidations', 'Anyone may repay an unsafe position and take its collateral at a 10% bonus.', ['liquidate'], [['liquidation incentives', 'why strangers keep the system safe'], ['bad debt', 'when collateral no longer covers it']], ['a safe position can’t be liquidated', 'an unsafe one is, with the bonus paid', 'a partial liquidation leaves the position safer'], 6, ['Why does a liquidator need a bonus at all?']),
      m('m4', 'Invariants', 'Foundry invariant tests: random deposits, mints, price moves and liquidations, and the properties that must survive them.', ['invariants'], [['invariant testing', 'properties, not examples'], ['handlers', 'steering the fuzzer to useful calls']], ['total stable supply equals total debt', 'the vault’s ether equals total collateral', 'no safe position is ever liquidated'], 6, ['What is the difference between a fuzz test and an invariant test?'])
    ],
    scaffold: files({ ...FOUNDRY_FILES, 'src/Vault.sol': VAULT_SOL, 'src/Stable.sol': STABLE_SOL, 'src/Oracle.sol': ORACLE_SOL, 'test/Vault.t.sol': VAULT_TESTS })
  }
}

// ---------- Solidity: an audit with proofs of concept ----------

const BANK_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice A small ether bank under audit. It has bugs on purpose: find them, prove each with a
/// test that exploits it, then fix it and show the proof no longer works.
contract Bank {
    mapping(address => uint256) public balances;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
    }

    /// Moves balance inside the bank
    function transfer(address to, uint256 amount) external {
        unchecked {
            balances[msg.sender] -= amount;
            balances[to] += amount;
        }
    }

    /// Meant for the owner only
    function setOwner(address next) external {
        owner = next;
    }

    function sweep(address to) external {
        require(msg.sender == owner, "not owner");
        payable(to).transfer(address(this).balance);
    }
}
`

const ATTACKER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Bank} from "../src/Bank.sol";

/// @notice Your proof of concept for the first finding: drain the bank by re-entering withdraw()
contract Attacker {
    Bank public immutable bank;

    constructor(Bank _bank) {
        bank = _bank;
    }

    /// Deposit what was sent, then withdraw in a way that takes everything
    function attack() external payable {
        revert("not implemented: write the exploit");
    }

    receive() external payable {}
}
`

const AUDIT_TESTS = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Bank} from "../src/Bank.sol";
import {Attacker} from "./Attacker.sol";

/// Each test is a proof of concept: it passes when the exploit works against Bank as written
contract BankExploitTest is Test {
    Bank bank;

    function setUp() public {
        bank = new Bank();
        for (uint256 i = 1; i <= 5; i++) {
            address victim = address(uint160(1000 + i));
            vm.deal(victim, 2 ether);
            vm.prank(victim);
            bank.deposit{value: 2 ether}();
        }
    }

    function test_ReentrancyDrainsTheBank() public {
        Attacker attacker = new Attacker(bank);
        attacker.attack{value: 1 ether}();
        assertEq(address(bank).balance, 0, "the bank still holds ether");
        assertEq(address(attacker).balance, 11 ether);
    }

    function test_AnyoneCanTakeOwnershipAndSweep() public {
        address thief = makeAddr("thief");
        // Write the calls that let a stranger take the bank's ether (vm.prank(thief) makes the next call come from them)
        _proofOfOwnershipTakeover(thief);
        assertEq(thief.balance, 10 ether);
    }

    function test_TransferUnderflowCreatesABalance() public {
        address thief = makeAddr("thief");
        // A thief with nothing in the bank ends up with a balance larger than all the ether there is
        _proofOfUnderflow(thief);
        assertGt(bank.balances(thief), 1e30);
    }

    function _proofOfOwnershipTakeover(address thief) internal {
        thief;
        revert("not implemented: write the proof of concept");
    }

    function _proofOfUnderflow(address thief) internal {
        thief;
        revert("not implemented: write the proof of concept");
    }
}
`

const solAudit: IdeaTemplate = {
  id: 'sol-audit',
  name: 'A smart contract audit with proofs of concept',
  about: 'Find the bugs in a small protocol, prove each with a Foundry exploit, fix it, write the report',
  match: /\baudit\w*\b.*\b(contracts?|solidity|protocol|defi)\b|\bsmart contract security\b|\bproofs? of concept\b|\bexploit\b.*\bsolidity\b/i,
  plan: {
    version: 1,
    name: 'Solidity audit',
    slug: 'solidity-audit',
    summary: 'An audit of a small ether bank with bugs planted on purpose, done as auditors work: read it, write each finding as an exploit test that passes against the code as written, fix it, show the same test now fails, and write the report with severities. The blockchain engineering roadmap’s security capstone, before auditing a real open-source protocol.',
    language: 'solidity',
    depth: 'solid',
    components: [
      c('bank', 'The protocol under audit', 'A small bank with deposit, withdraw and an owner', ['Solidity storage and calls', 'ether transfers']),
      c('poc', 'Proofs of concept', 'Each finding as a Foundry test that exploits it', ['reentrancy', 'access control', 'Foundry cheatcodes']),
      c('fixes', 'Fixes', 'Each bug fixed, and its proof shown to fail', ['checks-effects-interactions', 'reentrancy guards']),
      c('report', 'Audit report', 'Findings with severity, impact, proof and fix', ['severity ratings', 'audit reports'])
    ],
    links: [
      { from: 'poc', to: 'bank', label: 'exploits' },
      { from: 'fixes', to: 'bank', label: 'patches' },
      { from: 'report', to: 'poc', label: 'evidence' }
    ],
    milestones: [
      m('m1', 'Exploits', 'Prove the first three findings: drain the bank by reentrancy, take its ether by seizing ownership, and make a balance from nothing by underflow.', ['poc'], [['reentrancy', 'the call that comes back'], ['access control', 'who may call what'], ['unchecked arithmetic', 'what Solidity 0.8 stops checking inside unchecked']], ['the reentrancy proof drains the bank', 'the ownership proof sweeps the bank', 'the underflow proof creates a balance from nothing'], 5, ['Why does setting the balance to zero after the call allow reentrancy?'], [{ title: 'SWC-107: Reentrancy', kind: 'web', url: 'https://swcregistry.io/docs/SWC-107/', why: 'The classic description, with examples' }]),
      m('m2', 'Fixes that the proofs confirm', 'Fix each bug and run the proofs against the fixed bank: each must now fail.', ['fixes'], [['checks-effects-interactions', 'the pattern that prevents it'], ['reentrancy guards', 'a lock as a second line']], ['the reentrancy proof fails against the fix', 'only the owner can change the owner', 'a transfer of more than the balance reverts', 'honest deposits and withdrawals still work'], 4, ['When is a reentrancy guard needed even with checks-effects-interactions?']),
      m('m3', 'More findings', 'Read for the quieter issues: transfer’s gas stipend, missing events, unchecked assumptions; prove what is provable.', ['bank', 'poc'], [['gas stipends', 'why transfer can fail for contracts'], ['events', 'what off-chain watchers rely on']], ['each finding has a severity and a proof or a reason it has none', 'a contract owner who can’t receive by transfer is shown', 'every state change the owner makes emits an event'], 4, ['Why is transfer() discouraged for sending ether now?']),
      m('m4', 'The report', 'An audit report: scope, method, findings by severity with impact, proof and fix, as a real one is laid out.', ['report'], [['severity ratings', 'impact times likelihood'], ['audit reports', 'what a client needs to read']], ['every finding links its proof test', 'severities follow a stated scale', 'the fixed code passes the honest tests and fails every proof'], 3, ['How do impact and likelihood combine into a severity?'])
    ],
    scaffold: files({ ...FOUNDRY_FILES, 'src/Bank.sol': BANK_SOL, 'test/Attacker.sol': ATTACKER_SOL, 'test/BankExploit.t.sol': AUDIT_TESTS })
  }
}

export const PACK_TEMPLATES: IdeaTemplate[] = [cppLedger, cppOrderBook, solVault, solAudit]
