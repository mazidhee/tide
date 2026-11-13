import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Lessons and projects running on the track packs, in Tide's sandbox. TIDE_PACK_PROFILE is a
 * scratch profile folder whose tools/ holds the installed packs and whose python/ is a Python
 * environment with PySpark and kafka-python (test/trackPacks.test.ts installs them); without it,
 * only the C++ part runs (clang comes with Apple's command-line tools).
 *   TIDE_PACK_PROFILE=/path/profile npx vitest run test/trackPackRuns.test.ts
 */
const profile = process.env.TIDE_PACK_PROFILE ?? ''
const dir = profile && existsSync(profile) ? profile : mkdtempSync(join(tmpdir(), 'tide-packruns-'))
process.env.TIDE_TOOLS_DIR = join(dir, 'tools')
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } }))
const { runCode, runProject } = await import('../src/main/runner')
const has = (p: string) => existsSync(join(dir, 'tools', p))
const clang = existsSync('/usr/bin/clang++')

describe.skipIf(!clang)('C++ in lessons and projects', () => {
  it('runs a lesson’s C++ against hidden input and output cases', async () => {
    const code = '#include <iostream>\n#include <vector>\n#include <numeric>\nint main() { int n; std::cin >> n; std::vector<long> v(n); for (auto& x : v) std::cin >> x; std::cout << std::accumulate(v.begin(), v.end(), 0L) << "\\n"; }'
    const r = await runCode('cpp', code, '', 60_000, { tests: JSON.stringify([{ name: 'three', stdin: '3 1 2 3', expect: '6' }, { name: 'wrong on purpose', stdin: '1 5', expect: '4' }]) })
    expect(r.tests?.passed).toEqual(['three'])
    expect(r.tests?.failed[0].message).toMatch(/expected "4", got "5"/)
  }, 90_000)

  it('builds a project from all its sources, with its compile_flags.txt include folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tide-cppproj-'))
    mkdirSync(join(root, 'include'))
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'compile_flags.txt'), '-std=c++20\n-Iinclude\n-Wall\n')
    writeFileSync(join(root, 'include', 'ledger.hpp'), '#pragma once\nlong total(long a, long b);\n')
    writeFileSync(join(root, 'ledger.cpp'), '#include "ledger.hpp"\nlong total(long a, long b) { return a + b; }\n')
    writeFileSync(join(root, 'main.cpp'), '#include <iostream>\n#include "ledger.hpp"\nint main() { std::cout << total(40, 2) << "\\n"; }\n')
    writeFileSync(join(root, 'tests', 'test_ledger.cpp'), 'int main() { return 1; }\n')
    const r = await runProject(join(root, 'main.cpp'))
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('42\n')
  }, 90_000)
})

describe.skipIf(!clang)('the IDE’s C++ project template', () => {
  it('runs, and its tests pass in the test explorer with the sanitizers on', async () => {
    const { TEMPLATES } = await import('../src/shared/ideTemplates')
    const root = mkdtempSync(join(tmpdir(), 'tide-cpptpl-'))
    for (const [rel, text] of Object.entries(TEMPLATES.find((t) => t.id === 'cpp')!.files('Ledger 2'))) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), text)
    }
    expect(readFileSync(join(root, 'CMakeLists.txt'), 'utf8')).toMatch(/add_library\(ledger_2_core STATIC \$\{CORE_SOURCES\}\)/)
    const run = await runProject(join(root, 'src', 'main.cpp'))
    expect(run.stdout).toBe('12.50 + 3.99 = 16.49\n')
    const { cppTests } = await import('../src/main/ide/tests')
    const r = await cppTests(root)
    expect(r.outcomes).toEqual([{ id: 'adds_minor_units', status: 'pass' }, { id: 'prints_pounds_and_pence', status: 'pass' }])
    // A failing check names its line and both values
    writeFileSync(join(root, 'tests', 'test_money.cpp'), '#include "check.hpp"\n#include "money.hpp"\nTEST(off_by_one) { CHECK_EQ(Money(5).minor(), 6); }\nint main() { return check::run_all(); }\n')
    const bad = await cppTests(root)
    expect(bad.outcomes[0].status).toBe('fail')
    expect(bad.outcomes[0].message).toMatch(/test_money\.cpp:3: CHECK_EQ\(Money\(5\)\.minor\(\), 6\) failed: 5 != 6/)
  }, 120_000)
})

describe.skipIf(!has('foundry/bin/forge'))('Solidity with the Foundry pack', () => {
  it('the IDE’s Foundry template passes its own tests', async () => {
    const { TEMPLATES } = await import('../src/shared/ideTemplates')
    const root = mkdtempSync(join(tmpdir(), 'tide-soltpl-'))
    for (const [rel, text] of Object.entries(TEMPLATES.find((t) => t.id === 'foundry')!.files('Vault'))) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), text)
    }
    const { forgeTest } = await import('../src/main/packs/foundry')
    const r = await forgeTest(root)
    expect(r.error).toBeUndefined()
    expect(r.outcomes.every((o) => o.status === 'pass')).toBe(true)
    expect(r.outcomes).toHaveLength(3)
  }, 200_000)

  const counter = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Counter {\n    uint256 public number;\n    function increment() public { number++; }\n}\n'

  it('runs a lesson’s hidden Solidity tests with forge test, offline, in the sandbox', async () => {
    const tests = 'contract CounterTest is Test {\n    Counter c;\n    function setUp() public { c = new Counter(); }\n    function test_Increment() public { c.increment(); assertEq(c.number(), 1); }\n    function test_StartsAtTwo() public view { assertEq(c.number(), 2); }\n}\n'
    const r = await runCode('solidity', counter, '', 120_000, { tests })
    expect(r.tests?.passed).toEqual(['test_Increment()'])
    expect(r.tests?.failed).toEqual([{ name: 'test_StartsAtTwo()', message: 'assertion failed: 0 != 2' }])
    expect(r.stdout + r.stderr).not.toMatch(/claude-501|tide-run-/)
  }, 150_000)

  it('runs a script’s run(), printing its console.log', async () => {
    const code = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\nimport "forge-std/Script.sol";\ncontract Hello is Script {\n    function run() public pure { console.log("gas is cheap here: %s", uint256(21000)); }\n}\n'
    const r = await runCode('solidity', code, '', 120_000)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/gas is cheap here: 21000/)
  }, 150_000)

  it('deploys a contract to a fresh anvil chain when the script broadcasts', async () => {
    const code = `${counter}import "forge-std/Script.sol";\ncontract Deploy is Script {\n    function run() public { vm.startBroadcast(); Counter c = new Counter(); c.increment(); vm.stopBroadcast(); console.log("deployed at", address(c)); }\n}\n`
    const r = await runCode('solidity', code, '', 120_000)
    expect(r.stdout).toMatch(/deployed at 0x5FbDB2315678afecb367f032d93F642f64180aa3/)
    expect(r.stdout).toMatch(/ONCHAIN EXECUTION COMPLETE & SUCCESSFUL/)
  }, 150_000)

  it('gives a bash lesson a chain at ETH_RPC_URL, with cast on the path', async () => {
    const r = await runCode('bash', 'cast chain-id --rpc-url "$ETH_RPC_URL"\ncast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --ether --rpc-url "$ETH_RPC_URL"', '', 60_000)
    expect(r.stdout.trim().split('\n')).toEqual(['31337', '10000.000000000000000000'])
  }, 90_000)

  it('runs a project’s tests for the test explorer, as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tide-forgeproj-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'test'))
    writeFileSync(join(root, 'foundry.toml'), '[profile.default]\nsrc = "src"\ntest = "test"\n')
    writeFileSync(join(root, 'src', 'Counter.sol'), counter)
    writeFileSync(join(root, 'test', 'Counter.t.sol'), '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\nimport "forge-std/Test.sol";\nimport "../src/Counter.sol";\ncontract CounterTest is Test {\n    function test_One() public { Counter c = new Counter(); c.increment(); assertEq(c.number(), 1); }\n    function testFuzz_Many(uint8 n) public { Counter c = new Counter(); for (uint i; i < n; i++) c.increment(); assertEq(c.number(), n); }\n}\n')
    const { forgeTest } = await import('../src/main/packs/foundry')
    const r = await forgeTest(root)
    expect(r.outcomes.map((o) => [o.id, o.status]).sort()).toEqual([['CounterTest::testFuzz_Many(uint8)', 'pass'], ['CounterTest::test_One()', 'pass']])
    expect(r.output).toMatch(/^2 of 2 tests passed/)
    const one = await forgeTest(root, ['CounterTest::test_One()'])
    expect(one.outcomes.map((o) => o.id)).toEqual(['CounterTest::test_One()'])
  }, 200_000)
})

describe.skipIf(!has('bigdata/jre') || !existsSync(join(dir, 'python', 'bin', 'python')))('Spark and Kafka with the big data pack', () => {
  it('runs a small Spark job in the sandbox', async () => {
    const code = 'from pyspark.sql import SparkSession, functions as F\nspark = SparkSession.builder.master("local[2]").appName("lesson").getOrCreate()\ndf = spark.createDataFrame([("GBP", 120), ("USD", 80), ("GBP", 30)], ["ccy", "amount"])\nfor row in df.groupBy("ccy").agg(F.sum("amount").alias("total")).orderBy("ccy").collect():\n    print(row.ccy, row.total)\nprint(spark.sparkContext.parallelize(range(5)).map(lambda x: x * x).sum())\nspark.stop()\n'
    const r = await runCode('python', code)
    expect(r.stdout).toBe('GBP 150\nUSD 80\n30\n')
    // Spark's start-up chatter is taken out
    expect(r.stderr).not.toMatch(/log4j|NativeCodeLoader/)
  }, 180_000)

  it('gives a run that names Kafka a broker of its own to produce to and consume from', async () => {
    const code = 'import os\nfrom kafka import KafkaProducer, KafkaConsumer\nb = os.environ["TIDE_KAFKA"]\np = KafkaProducer(bootstrap_servers=b)\nfor i in range(3):\n    p.send("payments", f"payment {i}".encode())\np.flush()\nc = KafkaConsumer("payments", bootstrap_servers=b, auto_offset_reset="earliest", consumer_timeout_ms=3000)\nprint([m.value.decode() for m in c])\n'
    const r = await runCode('python', code, '', 60_000)
    expect(r.stdout.trim()).toBe("['payment 0', 'payment 1', 'payment 2']")
  }, 90_000)
})

describe.skipIf(!has('postgres/pg/bin/postgres'))('Postgres in the SQL lab', async () => {
  const pg = await import('../src/main/packs/postgres')
  afterAll(() => pg.stopPostgres())
  const lab = `test-${Date.now()}`

  it('has the sample data with real types, and shows a query plan', async () => {
    const r = await pg.pgQuery(lab, 'SELECT count(*) AS n FROM orders')
    expect(r.error).toBeUndefined()
    expect(r.rows[0][0]).toBeGreaterThan(100)
    const types = await pg.pgQuery(lab, "SELECT column_name, data_type FROM information_schema.columns WHERE (table_name, column_name) IN (('orders', 'order_date'), ('events', 'ts'), ('products', 'price')) ORDER BY column_name")
    expect(types.rows).toEqual([['order_date', 'date'], ['price', 'numeric'], ['ts', 'timestamp without time zone']])
    const plan = await pg.pgQuery(lab, 'EXPLAIN SELECT * FROM orders WHERE customer_id = 7')
    expect(plan.columns).toEqual(['QUERY PLAN'])
    expect(String(plan.rows[0][0])).toMatch(/Seq Scan on orders/)
    const indexed = await pg.pgQuery(lab, 'CREATE INDEX orders_customer ON orders (customer_id); ANALYZE orders; EXPLAIN SELECT * FROM orders WHERE customer_id = 7')
    expect(indexed.rows.map((r) => r[0]).join('\n')).toMatch(/Index Scan|Bitmap Heap Scan/)
  }, 120_000)

  it('keeps two sessions apart, so isolation and locks can be seen', async () => {
    await pg.pgQuery(lab, 'CREATE TABLE accounts (id int PRIMARY KEY, balance int); INSERT INTO accounts VALUES (1, 100)')
    const a = await pg.pgQuery(lab, 'BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT balance FROM accounts WHERE id = 1', { session: 'A' })
    expect(a.transaction).toBe('open')
    expect(a.rows).toEqual([[100]])
    const b = await pg.pgQuery(lab, 'UPDATE accounts SET balance = 50 WHERE id = 1', { session: 'B' })
    expect(b.changes).toBe(1)
    // A still sees its snapshot
    expect((await pg.pgQuery(lab, 'SELECT balance FROM accounts WHERE id = 1', { session: 'A' })).rows).toEqual([[100]])
    const conflict = await pg.pgQuery(lab, 'UPDATE accounts SET balance = balance - 10 WHERE id = 1', { session: 'A' })
    expect(conflict.error).toMatch(/could not serialize access due to concurrent update/)
    expect(conflict.error).toMatch(/ROLLBACK/)
    await pg.pgQuery(lab, 'ROLLBACK', { session: 'A' })
    // A lock held by B makes A wait, then give up with a plain reason
    await pg.pgQuery(lab, 'BEGIN; UPDATE accounts SET balance = 1 WHERE id = 1', { session: 'B' })
    const blocked = await pg.pgQuery(lab, 'UPDATE accounts SET balance = 2 WHERE id = 1', { session: 'A' })
    expect(blocked.error).toMatch(/lock timeout[\s\S]*the other session holds/)
    await pg.pgQuery(lab, 'ROLLBACK', { session: 'B' })
  }, 120_000)

  it('signs lessons in as a learner who is not a superuser', async () => {
    const r = await pg.pgQuery(lab, "COPY (SELECT 1) TO PROGRAM 'touch /tmp/nope'")
    expect(r.error).toMatch(/permission denied|must be superuser|privileges/i)
  }, 60_000)

  it('puts a lesson’s database back as it started', async () => {
    await pg.pgQuery(lab, 'DROP TABLE order_items')
    await pg.pgReset(lab)
    const r = await pg.pgQuery(lab, 'SELECT count(*) FROM order_items')
    expect(r.error).toBeUndefined()
  }, 120_000)

  it('answers the tutor in text, with the tables the first time', async () => {
    const r = await pg.runPgTool(`${lab}-tutor`, 'EXPLAIN ANALYZE SELECT count(*) FROM events')
    expect(r.ok).toBe(true)
    expect(r.text).toMatch(/^\[Postgres, session A\]/)
    expect(r.text).toMatch(/Execution Time/)
    expect(r.text).toMatch(/The Postgres lab's tables/)
  }, 60_000)
})

describe('training runs tracked from a lesson', () => {
  it('keeps each run’s parameters and curves, for the notebook to compare', async () => {
    const code = `import tide_runs, math
for lr in (0.1, 0.5):
    with tide_runs.run(f"lr {lr}", params={"lr": lr, "epochs": 5, "seed": 1}) as r:
        w = 0.0
        for epoch in range(5):
            w += lr * (3 - w)
            r.log(epoch, loss=(3 - w) ** 2)
tide_runs.compare()
`
    const r = await runCode('python', code, '', 60_000)
    expect(r.stderr).toBe('')
    expect(r.stdout).toMatch(/run\s+lr\s+final loss/)
    expect(r.stdout).toMatch(/Same in every run: epochs=5, seed=1/)
    const { listRuns } = await import('../src/main/packs/runs')
    const { compareRuns } = await import('../src/shared/runs')
    const runs = (await listRuns('lessons')).slice(-2)
    expect(runs.map((x) => x.name)).toEqual(['lr 0.1', 'lr 0.5'])
    const c = compareRuns(runs)
    expect(c.changed).toEqual([{ key: 'lr', values: ['0.1', '0.5'] }])
    expect(c.metrics[0].winner).toBe(1)
    expect(c.findings[0]).toMatch(/^lr 0\.1 → 0\.5: loss ended at .* \(better\)\.$/)
  }, 90_000)
})

/** What a learner might write for each C++ and Solidity template's first milestone: its tests must be passable */
const PACK_SOLUTIONS: Record<string, Record<string, string>> = {
  'cpp-ledger': {
    'src/ledger.cpp': `#include "ledger.hpp"
void Ledger::open(const std::string& a) {
    if (!balances_.emplace(a, 0).second) throw std::invalid_argument("already open: " + a);
}
void Ledger::post(const Entry& e) {
    Minor sum = 0;
    for (const auto& p : e.postings) {
        if (!balances_.count(p.account)) throw std::out_of_range("no account " + p.account);
        sum += p.amount;
    }
    if (sum != 0) throw UnbalancedEntry("the postings don't sum to zero");
    for (const auto& x : entries_)
        if (x.id == e.id) throw std::invalid_argument("entry id used: " + e.id);
    for (const auto& p : e.postings) balances_[p.account] += p.amount;
    entries_.push_back(e);
}
Minor Ledger::balance(const std::string& a) const { return balances_.at(a); }
`
  },
  'cpp-order-book': {
    'include/order_book.hpp': `#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <optional>
#include <unordered_map>
#include <vector>
using OrderId = std::uint64_t;
using Price = std::int64_t;
using Qty = std::int64_t;
enum class Side { Buy, Sell };
struct Trade { OrderId buy; OrderId sell; Price price; Qty qty; };
class OrderBook {
public:
    std::vector<Trade> add(OrderId id, Side side, Price price, Qty qty);
    bool cancel(OrderId id);
    std::optional<Price> best_bid() const;
    std::optional<Price> best_ask() const;
    Qty depth(Side side, Price price) const;
private:
    struct Resting { OrderId id; Qty qty; };
    std::map<Price, std::deque<Resting>, std::greater<Price>> bids_;
    std::map<Price, std::deque<Resting>> asks_;
    std::unordered_map<OrderId, std::pair<Side, Price>> where_;
};
`,
    'src/order_book.cpp': `#include "order_book.hpp"
#include <stdexcept>
template <class Book, class Crosses>
static void match(Book& book, OrderId id, Side side, Qty& qty, Crosses crosses, std::vector<Trade>& out, std::unordered_map<OrderId, std::pair<Side, Price>>& where) {
    while (qty > 0 && !book.empty() && crosses(book.begin()->first)) {
        auto& level = book.begin()->second;
        auto& front = level.front();
        Qty q = std::min(qty, front.qty);
        out.push_back(side == Side::Buy ? Trade{id, front.id, book.begin()->first, q} : Trade{front.id, id, book.begin()->first, q});
        qty -= q;
        front.qty -= q;
        if (front.qty == 0) { where.erase(front.id); level.pop_front(); }
        if (level.empty()) book.erase(book.begin());
    }
}
std::vector<Trade> OrderBook::add(OrderId id, Side side, Price price, Qty qty) {
    if (qty <= 0 || price <= 0 || where_.count(id)) throw std::invalid_argument("bad order");
    std::vector<Trade> out;
    if (side == Side::Buy) match(asks_, id, side, qty, [&](Price p) { return p <= price; }, out, where_);
    else match(bids_, id, side, qty, [&](Price p) { return p >= price; }, out, where_);
    if (qty > 0) {
        if (side == Side::Buy) bids_[price].push_back({id, qty});
        else asks_[price].push_back({id, qty});
        where_[id] = {side, price};
    }
    return out;
}
bool OrderBook::cancel(OrderId id) {
    auto it = where_.find(id);
    if (it == where_.end()) return false;
    auto [side, price] = it->second;
    auto erase = [&](auto& book) {
        auto& level = book[price];
        for (auto o = level.begin(); o != level.end(); ++o) if (o->id == id) { level.erase(o); break; }
        if (level.empty()) book.erase(price);
    };
    if (side == Side::Buy) erase(bids_); else erase(asks_);
    where_.erase(it);
    return true;
}
std::optional<Price> OrderBook::best_bid() const { return bids_.empty() ? std::nullopt : std::optional<Price>(bids_.begin()->first); }
std::optional<Price> OrderBook::best_ask() const { return asks_.empty() ? std::nullopt : std::optional<Price>(asks_.begin()->first); }
Qty OrderBook::depth(Side side, Price price) const {
    Qty n = 0;
    auto sum = [&](const auto& book) { auto l = book.find(price); if (l != book.end()) for (auto& o : l->second) n += o.qty; };
    if (side == Side::Buy) sum(bids_); else sum(asks_);
    return n;
}
`
  },
  'sol-vault': {
    'src/Vault.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Stable} from "./Stable.sol";
import {Oracle} from "./Oracle.sol";
contract Vault {
    uint256 public constant MIN_RATIO = 150;
    Stable public immutable stable;
    Oracle public immutable oracle;
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;
    error Undercollateralised(uint256 ratio);
    error NothingToWithdraw();
    constructor(Oracle _oracle) { oracle = _oracle; stable = new Stable(); }
    function deposit() external payable { collateral[msg.sender] += msg.value; }
    function _ratio(uint256 c, uint256 d) internal view returns (uint256) {
        if (d == 0) return type(uint256).max;
        return c * oracle.price() / 1e18 * 100 / d;
    }
    function ratio(address who) public view returns (uint256) { return _ratio(collateral[who], debt[who]); }
    function mint(uint256 amount) external {
        uint256 d = debt[msg.sender] + amount;
        uint256 r = _ratio(collateral[msg.sender], d);
        if (r < MIN_RATIO) revert Undercollateralised(r);
        debt[msg.sender] = d;
        stable.mint(msg.sender, amount);
    }
    function withdraw(uint256 amount) external {
        uint256 c = collateral[msg.sender];
        if (amount > c) revert NothingToWithdraw();
        uint256 r = _ratio(c - amount, debt[msg.sender]);
        if (r < MIN_RATIO) revert Undercollateralised(r);
        collateral[msg.sender] = c - amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }
}
`
  },
  'sol-audit': {
    'test/Attacker.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Bank} from "../src/Bank.sol";
contract Attacker {
    Bank public immutable bank;
    constructor(Bank _bank) { bank = _bank; }
    function attack() external payable { bank.deposit{value: msg.value}(); bank.withdraw(); }
    receive() external payable { if (address(bank).balance >= 1 ether) bank.withdraw(); }
}
`,
    'test/BankExploit.t.sol': '@@AUDIT@@'
  }
}

describe.skipIf(!clang || !has('foundry/bin/forge'))('the C++ and Solidity project templates', () => {
  it('fail their first milestone’s tests on the stubs, and pass them on a working solution', async () => {
    const { PACK_TEMPLATES } = await import('../src/shared/ideaTemplatesPacks')
    const { planFromTemplate } = await import('../src/shared/ideaTemplates')
    const { scaffoldFiles } = await import('../src/shared/ideaScaffold')
    const { cppTests } = await import('../src/main/ide/tests')
    const { forgeTest } = await import('../src/main/packs/foundry')
    for (const t of PACK_TEMPLATES) {
      const write = (root: string, files: { path: string; content: string }[]) => {
        for (const f of files) {
          mkdirSync(join(root, f.path, '..'), { recursive: true })
          writeFileSync(join(root, f.path), f.content)
        }
      }
      const files = scaffoldFiles(planFromTemplate(t, t.about, 0))
      const run = (root: string) => (t.plan.language === 'cpp' ? cppTests(root) : forgeTest(root))
      const stubs = mkdtempSync(join(tmpdir(), `tide-${t.id}-`))
      write(stubs, files)
      const before = await run(stubs)
      expect(before.outcomes.length, `${t.id}: ${before.output}`).toBe(t.plan.milestones[0].doneWhen.length)
      expect(before.outcomes.every((o) => o.status !== 'pass'), t.id).toBe(true)
      const solved = mkdtempSync(join(tmpdir(), `tide-${t.id}-done-`))
      const answers = PACK_SOLUTIONS[t.id]
      const audit = files.find((f) => f.path === 'test/BankExploit.t.sol')?.content ?? ''
      if (answers['test/BankExploit.t.sol']) answers['test/BankExploit.t.sol'] = audit.replace(/function _proofOfOwnershipTakeover\(address thief\) internal \{[\s\S]*?\n    \}/, 'function _proofOfOwnershipTakeover(address thief) internal {\n        vm.prank(thief);\n        bank.setOwner(thief);\n        vm.prank(thief);\n        bank.sweep(thief);\n    }').replace(/function _proofOfUnderflow\(address thief\) internal \{[\s\S]*?\n    \}/, 'function _proofOfUnderflow(address thief) internal {\n        vm.prank(thief);\n        bank.transfer(address(0xBEEF), 1);\n    }')
      write(solved, files.map((f) => (answers[f.path] ? { ...f, content: answers[f.path] } : f)))
      const after = await run(solved)
      expect(after.outcomes.map((o) => [o.id, o.status, o.message ?? '']), `${t.id}: ${after.output}`).toEqual(before.outcomes.map((o) => [o.id, 'pass', '']))
    }
  }, 300_000)
})
