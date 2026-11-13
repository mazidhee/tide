import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  advanceSession,
  canFinish,
  catalogueReadings,
  currentMilestone,
  emptyMemory,
  fallbackQuestions,
  finishMilestone,
  fromAnswers,
  isTestFile,
  mapMermaid,
  markPrereqs,
  matchPrereq,
  memoryMarkdown,
  milestonePrereqs,
  nextStep,
  parseMemory,
  parseQuestions,
  planMarkdown,
  prereqCounts,
  progressOf,
  reopenMilestone,
  roadmapMarkdown,
  safeRelPath,
  startSession,
  updateMemory,
  validatePlan,
  type KnownConcept,
  type ProjectPlan,
  type ScaffoldFile
} from '../src/shared/ideaProject'
import { IDEA_TEMPLATES, matchTemplate, planFromTemplate } from '../src/shared/ideaTemplates'
import { placeholderTests, scaffoldFiles, testFilesOf, toolchainFiles } from '../src/shared/ideaScaffold'
import { briefMilestones } from '../src/shared/project'
import { roadmapTopics } from '../src/shared/curriculum'
import { nextTopics } from '../src/shared/coach'

const NOW = Date.UTC(2026, 10, 13)
const rail = () => planFromTemplate(IDEA_TEMPLATES[0], 'I want to build a payment rail', NOW, false)

describe('the plan: validation', () => {
  it('accepts every template as it is', () => {
    for (const t of IDEA_TEMPLATES) {
      const { plan, problems } = validatePlan(planFromTemplate(t, t.about, NOW, false), { by: 'template' })
      expect(problems, t.id).toEqual([])
      expect(plan!.milestones.filter((m) => m.status === 'active')).toHaveLength(1)
      expect(plan!.milestones[0].status).toBe('active')
      // Every milestone builds known components and says when it's done
      for (const m of plan!.milestones) {
        expect(m.doneWhen.length, `${t.id} ${m.title}`).toBeGreaterThanOrEqual(3)
        for (const c of m.components) expect(plan!.components.some((x) => x.id === c)).toBe(true)
      }
    }
  })

  it('refuses what has no shape, and says why', () => {
    expect(validatePlan(null).plan).toBeNull()
    expect(validatePlan({ name: 'x' }).problems.join(' ')).toMatch(/components.*milestones|milestones/)
    expect(validatePlan('not json').plan).toBeNull()
  })

  it('makes a model’s plan safe: links only between parts, paths kept in the folder, numbers clamped', () => {
    const { plan, problems } = validatePlan(
      {
        name: 'Rail',
        components: [{ name: 'Ledger', about: 'x', prerequisites: ['double-entry bookkeeping', { name: 'idempotency keys' }] }, { name: 'API' }, { name: '' }],
        links: [{ from: 'API', to: 'Ledger', label: 'postings' }, { from: 'API', to: 'Nowhere' }, { from: 'ledger', to: 'ledger' }],
        milestones: [
          { title: 'Ledger', components: ['ledger', 'ghost'], doneWhen: ['balances'], hours: 900, status: 'done' },
          { title: 'API', doneWhen: [], lessons: ['HTTP', { concept: 'REST', why: 'it is the API' }], status: 'active' },
          { title: 'Settle', doneWhen: ['nets'], status: 'active' }
        ],
        scaffold: [
          { path: '../../etc/passwd', content: 'x' },
          { path: '/abs/ok.py', content: 'x' },
          { path: '.git/hooks/pre-commit', content: 'x' },
          { path: 'tests/test_ledger.py', content: 'def test_x(): assert False' },
          { path: 'tests/test_ledger.py', content: 'twice' }
        ]
      },
      { by: 'claude' }
    )
    expect(plan).not.toBeNull()
    expect(plan!.components.map((c) => c.id)).toEqual(['ledger', 'api'])
    expect(plan!.components[0].prerequisites.map((p) => [p.name, p.status])).toEqual([['double-entry bookkeeping', 'new'], ['idempotency keys', 'new']])
    expect(plan!.links).toEqual([{ from: 'api', to: 'ledger', label: 'postings' }])
    expect(plan!.milestones[0]).toMatchObject({ status: 'done', hours: 60, components: ['ledger'] })
    // One active: the first not done
    expect(plan!.milestones.map((m) => m.status)).toEqual(['done', 'active', 'todo'])
    expect(plan!.milestones[1].lessons).toEqual([{ concept: 'HTTP', why: '' }, { concept: 'REST', why: 'it is the API' }])
    expect(plan!.scaffold.map((f) => f.path)).toEqual(['abs/ok.py', 'tests/test_ledger.py'])
    expect(problems.join(' ')).toMatch(/Milestone 2 \("API"\) says nothing about when it's done/)
  })

  it('wants tests from Claude, and not from Gemma or a hand-written plan', () => {
    const raw = { name: 'X', components: [{ name: 'A' }, { name: 'B' }], milestones: [{ title: 'one', doneWhen: ['a'] }, { title: 'two', doneWhen: ['b'] }], scaffold: [{ path: 'src/a.py', content: '' }] }
    expect(validatePlan(raw, { by: 'claude' }).problems).toContain('The scaffold has no test file for the first milestone.')
    expect(validatePlan(raw, { by: 'gemma' }).problems).toEqual([])
  })

  it('keeps paths inside the project and knows test files by their runner’s rules', () => {
    expect(safeRelPath('a/../b')).toBe('')
    expect(safeRelPath('./src//x.py')).toBe('src/x.py')
    expect(isTestFile('tests/test_ledger.py')).toBe(true)
    expect(isTestFile('ledger_test.go')).toBe(true)
    expect(isTestFile('test/a.test.ts')).toBe(true)
    expect(isTestFile('tests/chain.rs')).toBe(true)
    expect(isTestFile('src/lib.rs', '#[cfg(test)] mod t { #[test] fn a() {} }')).toBe(true)
    expect(isTestFile('src/ledger.py')).toBe(false)
  })
})

describe('prerequisites against What you know', () => {
  const map: KnownConcept[] = [
    { id: 'k1', name: 'Double-entry bookkeeping', status: 'solid', seen: 4 },
    { id: 'k2', name: 'Hash functions', status: 'fading', seen: 3 },
    { id: 'k3', name: 'Idempotency', status: 'learning', seen: 1 },
    { id: 'k4', name: 'XML parsing', status: 'new', seen: 0 },
    { id: 'k5', name: 'Consistent hashing rings for distributed caches', status: 'solid', seen: 5 }
  ]
  it('marks known, fading and new', () => {
    expect(matchPrereq('double-entry bookkeeping', map)).toMatchObject({ status: 'known', conceptId: 'k1' })
    expect(matchPrereq('hash function', map)).toMatchObject({ status: 'fading', conceptId: 'k2' })
    // Started, not yet solid: fading, not known
    expect(matchPrereq('idempotency', map).status).toBe('fading')
    expect(matchPrereq('XML parsing', map)).toMatchObject({ status: 'new', conceptId: 'k4' })
    expect(matchPrereq('ISO 20022 message structure', map)).toEqual({ status: 'new' })
  })
  it('doesn’t match on one shared word of a longer name', () => {
    expect(matchPrereq('hashing', map).conceptId).not.toBe('k5')
    expect(matchPrereq('distributed systems', map).status).toBe('new')
  })
  it('marks a whole plan and counts by status, once per prerequisite', () => {
    const plan = markPrereqs(rail(), map)
    const ledger = plan.components.find((c) => c.id === 'ledger')!
    expect(ledger.prerequisites.find((p) => p.name === 'double-entry bookkeeping')?.status).toBe('known')
    const counts = prereqCounts(plan)
    expect(counts.known).toBe(1)
    expect(counts.known + counts.fading + counts.new).toBe(new Set(plan.components.flatMap((c) => c.prerequisites.map((p) => p.name.toLowerCase()))).size)
    expect(milestonePrereqs(plan, plan.milestones[0]).map((p) => p.name)).toEqual(['double-entry bookkeeping', 'integer money in minor units'])
  })
})

describe('readings from the catalogue', () => {
  const courses = [
    { id: 'ml-zoomcamp', title: 'Machine Learning Zoomcamp', covers: 'Practical machine learning: regression, classification, deployment', topics: ['machine learning', 'logistic regression', 'deployment'] },
    { id: 'de-zoomcamp', title: 'Data Engineering Zoomcamp', covers: 'Pipelines, warehouses and orchestration', topics: ['data pipelines', 'orchestration', 'data warehouse'] }
  ]
  it('finds courses that teach a milestone’s concepts, and nothing for unrelated ones', () => {
    expect(catalogueReadings(['logistic regression'], courses).map((r) => r.courseId)).toEqual(['ml-zoomcamp'])
    expect(catalogueReadings(['ISO 20022 message structure'], courses)).toEqual([])
    // One shared word isn't a match
    expect(catalogueReadings(['integer money in minor units'], [{ id: 'bm', title: 'Blockchain and Money', covers: 'money, ledgers and Bitcoin', topics: ['blockchain', 'money'] }])).toEqual([])
  })
})

describe('milestones and sessions', () => {
  it('runs a session in order: the ready check gates building, the tests must pass, the debrief ends it', () => {
    let s = startSession(NOW)
    expect(s.step).toBe('warmup')
    s = advanceSession(s, 'warmup', 'done')
    s = advanceSession(s, 'lesson', 'skipped')
    expect(s.step).toBe('ready')
    expect(() => advanceSession(s, 'build', 'done')).toThrow(/ready check comes first/)
    expect(() => advanceSession(s, 'ready', 'skipped')).toThrow(/unlocks the tests/)
    expect(() => advanceSession(s, 'ready', 'done', undefined, { ready: false })).toThrow(/Pass the ready check/)
    s = advanceSession(s, 'ready', 'done', undefined, { ready: true })
    s = advanceSession(s, 'build', 'done')
    expect(() => advanceSession(s, 'tests', 'skipped')).toThrow(/have to pass/)
    expect(() => advanceSession(s, 'tests', 'done', { passed: 3, total: 5, at: NOW })).toThrow(/Not all/)
    expect(() => advanceSession(s, 'tests', 'done', { passed: 0, total: 0, at: NOW })).toThrow(/Not all/)
    s = advanceSession(s, 'tests', 'done', { passed: 5, total: 5, at: NOW })
    expect(s.step).toBe('review')
    s = advanceSession(s, 'review', 'done')
    s = advanceSession(s, 'bughunt', 'skipped')
    expect(canFinish(s)).toBe(false)
    expect(() => advanceSession(s, 'debrief', 'skipped')).toThrow(/debrief/)
    s = advanceSession(s, 'debrief', 'done')
    expect(s.step).toBe('finished')
    expect(canFinish(s)).toBe(true)
    s = advanceSession(s, 'lesson', 'done')
    expect(s.skipped).not.toContain('lesson')
    expect(nextStep({ done: [], skipped: [] })).toBe('warmup')
  })

  it('finishing a milestone makes the next active; reopening goes back', () => {
    let plan = rail()
    expect(currentMilestone(plan)?.id).toBe('m1')
    plan = finishMilestone(plan, 'm1', NOW)
    expect(plan.milestones.map((m) => m.status).slice(0, 3)).toEqual(['done', 'active', 'todo'])
    expect(plan.milestones[0].doneAt).toBe(NOW)
    expect(progressOf(plan)).toMatchObject({ done: 1, total: 6, index: 1 })
    plan = finishMilestone(plan, 'm2', NOW)
    plan = reopenMilestone(plan, 'm1')
    expect(plan.milestones.map((m) => m.status).slice(0, 3)).toEqual(['active', 'done', 'todo'])
    expect(() => finishMilestone(plan, 'nope', NOW)).toThrow()
  })
})

describe('the notes written from the plan', () => {
  it('draws the map as a Mermaid flowchart, with the current components marked', () => {
    const mm = mapMermaid(rail(), ['ledger'])
    expect(mm.split('\n')[0]).toBe('flowchart TB')
    expect(mm).toContain('n_ledger["Ledger"]')
    expect(mm).toContain('n_api -->|request key| n_idempotency')
    expect(mm).toContain('class n_ledger now')
    expect(mapMermaid({ components: [{ id: 'a', name: 'A "quoted" [x]', about: '', prerequisites: [] }], links: [] })).toContain('n_a["A quoted x"]')
  })

  it('writes a plan note whose Milestones checklist projects read', () => {
    const plan = finishMilestone(rail(), 'm1', NOW)
    const md = planMarkdown(plan)
    expect(md).toContain('```mermaid')
    expect(briefMilestones(md).map((m) => m.done)).toEqual([true, false, false, false, false, false])
    expect(briefMilestones(md)[0].text).toBe('A double-entry ledger')
  })

  it('writes a roadmap the coach and the knowledge map read, with no section mistaken for a project', () => {
    const plan = finishMilestone({ ...rail(), milestones: rail().milestones.map((m, i) => (i === 1 ? { ...m, title: 'The project API' } : m)) }, 'm1', NOW)
    const md = roadmapMarkdown(plan)
    const topics = roadmapTopics('Payment rail', md)
    expect(topics.every((t) => !t.project)).toBe(true)
    expect(topics.filter((t) => t.checked).map((t) => t.title)).toEqual(['double-entry bookkeeping', 'integer money in minor units'])
    expect(nextTopics('Payment rail', md, 2).map((t) => t.topic)).toEqual(['idempotency keys', 'HTTP status codes and retries'])
  })
})

describe('the mentor’s memory', () => {
  it('reads back what it wrote, adds without repeats, resolves and caps', () => {
    let m = updateMemory(emptyMemory(), { add: { Decisions: ['Python, solid.'], 'Open issues': ['Floats in fees'], 'What’s next': ['Milestone 1: A double-entry ledger.'] } })
    const md = memoryMarkdown('Payment rail', m)
    expect(md).toContain('## Open issues')
    expect(parseMemory(md)).toEqual(m)
    m = updateMemory(m, { add: { Decisions: ['python, solid.', 'Postings are immutable.'] }, resolve: ['floats in fees', 'A double-entry ledger'] })
    expect(m.Decisions).toEqual(['Python, solid.', 'Postings are immutable.'])
    expect(m['Open issues']).toEqual([])
    expect(m['What’s next']).toEqual([])
    const many = updateMemory(emptyMemory(), { add: { Reviews: Array.from({ length: 20 }, (_, i) => `review ${i}`) } })
    expect(many.Reviews).toHaveLength(14)
    expect(many.Reviews[13]).toBe('review 19')
    // An empty note reads as empty, and the placeholder line isn't an item
    expect(parseMemory(memoryMarkdown('X', emptyMemory()))).toEqual(emptyMemory())
    // Typed with a straight apostrophe in the editor, still read
    expect(parseMemory("## What's next\n- ship it\n")['What’s next']).toEqual(['ship it'])
  })
})

describe('questions and templates', () => {
  it('asks at most three, and reads the language and depth from the answers', () => {
    expect(fallbackQuestions('a toy blockchain in Rust')[1].options[0]).toBe('Rust')
    expect(parseQuestions({ questions: [{ question: 'Scope?', options: ['a', 'b'] }, { question: '' }, { question: 'Q2' }, { question: 'Q3' }, { question: 'Q4' }] }).map((q) => q.question)).toEqual(['Scope?', 'Q2', 'Q3'])
    expect(fromAnswers([{ question: 'Which language?', answer: 'Rust' }, { question: 'How deep?', answer: 'In depth' }])).toEqual({ language: 'rust', depth: 'deep' })
    expect(fromAnswers([{ question: 'x', answer: 'whatever' }])).toEqual({})
  })
  it('matches ideas to their template', () => {
    expect(matchTemplate('I want to build a payment rail')?.id).toBe('payment-rail')
    expect(matchTemplate('work on a blockchain stack')?.id).toBe('blockchain')
    expect(matchTemplate('simulate a stablecoin depeg')?.id).toBe('stablecoin')
    expect(matchTemplate('a core banking system')?.id).toBe('core-banking')
    expect(matchTemplate('build something in ML')?.id).toBe('ml-project')
    expect(matchTemplate('an ETL data pipeline for market data')?.id).toBe('data-pipeline')
    expect(matchTemplate('a text editor')).toBeNull()
  })
})

// ---------- The starting files, run ----------

const PYTEST_SHIM = `class _Raises:
    def __init__(self, exc):
        self.exc = exc
    def __enter__(self):
        return self
    def __exit__(self, t, v, tb):
        if t is None:
            raise AssertionError("DID NOT RAISE")
        return issubclass(t, self.exc)

def raises(exc):
    return _Raises(exc)

def fail(msg=""):
    raise AssertionError(msg)
`
const HARNESS = `import importlib.util, inspect, json, pathlib, sys, tempfile
root = sys.argv[1]
sys.path[:0] = [root, sys.argv[2]]
out = {}
for f in sorted(pathlib.Path(root, "tests").glob("test_*.py")):
    spec = importlib.util.spec_from_file_location(f.stem, f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if not name.startswith("test_"):
            continue
        args = [pathlib.Path(tempfile.mkdtemp()) for p in inspect.signature(fn).parameters if p == "tmp_path"]
        try:
            fn(*args)
            out[name] = "pass"
        except BaseException as e:
            out[name] = type(e).__name__
print(json.dumps(out))
`
const hasPython = spawnSync('python3', ['--version']).status === 0

function writeAll(root: string, files: ScaffoldFile[]) {
  for (const f of files) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true })
    writeFileSync(join(root, f.path), f.content)
  }
}
function runPy(files: ScaffoldFile[]): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'tide-idea-py-'))
  const root = join(dir, 'p')
  writeAll(root, files)
  mkdirSync(join(dir, 'shim'))
  writeFileSync(join(dir, 'shim', 'pytest.py'), PYTEST_SHIM)
  writeFileSync(join(dir, 'harness.py'), HARNESS)
  return JSON.parse(execFileSync('python3', [join(dir, 'harness.py'), root, join(dir, 'shim')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }))
}

/** What a learner might write for milestone 1 of each template: the tests must be passable */
const SOLUTIONS: Record<string, Record<string, string>> = {
  'payment-rail': {
    'rail/ledger.py': `from dataclasses import dataclass

class UnbalancedEntry(ValueError):
    pass

@dataclass(frozen=True)
class Posting:
    account: str
    amount: int

@dataclass(frozen=True)
class Entry:
    id: str
    postings: tuple
    memo: str = ""

class Ledger:
    def __init__(self):
        self.entries, self.accounts, self.ids = [], {}, set()
    def open_account(self, name):
        self.accounts.setdefault(name, 0)
    def post(self, entry_id, postings, memo=""):
        if entry_id in self.ids:
            raise ValueError("used")
        for account, amount in postings:
            if type(amount) is not int:
                raise TypeError("minor units")
            if account not in self.accounts:
                raise KeyError(account)
        if sum(a for _, a in postings) != 0:
            raise UnbalancedEntry()
        for account, amount in postings:
            self.accounts[account] += amount
        self.ids.add(entry_id)
        e = Entry(entry_id, tuple(Posting(a, x) for a, x in postings), memo)
        self.entries.append(e)
        return e
    def balance(self, account):
        return self.accounts[account]
`
  },
  blockchain: {
    'chain/blocks.py': `import hashlib, json
from dataclasses import dataclass, field

@dataclass
class Block:
    index: int
    prev_hash: str
    timestamp: int
    data: list = field(default_factory=list)
    nonce: int = 0
    def header(self):
        return json.dumps([self.index, self.prev_hash, self.timestamp, self.data, self.nonce], separators=(",", ":")).encode()
    def hash(self):
        return hashlib.sha256(self.header()).hexdigest()

def genesis():
    return Block(0, "0" * 64, 0, ["genesis"])

class Chain:
    def __init__(self):
        self.blocks = [genesis()]
    def add(self, data, timestamp):
        last = self.blocks[-1]
        b = Block(last.index + 1, last.hash(), timestamp, list(data))
        self.blocks.append(b)
        return b
    def valid(self):
        return all(b.prev_hash == a.hash() and b.index == a.index + 1 for a, b in zip(self.blocks, self.blocks[1:]))
`
  },
  stablecoin: {
    'stable/vault.py': `from decimal import Decimal

class Undercollateralised(ValueError):
    pass

class Vault:
    def __init__(self, min_ratio):
        self.min_ratio, self.collateral, self.debt = min_ratio, Decimal(0), Decimal(0)
    def deposit(self, amount):
        self.collateral += amount
    def _r(self, c, d, price):
        return Decimal("Infinity") if d == 0 else c * price / d
    def ratio(self, price):
        return self._r(self.collateral, self.debt, price)
    def mint(self, amount, price):
        if self._r(self.collateral, self.debt + amount, price) < self.min_ratio:
            raise Undercollateralised()
        self.debt += amount
    def repay(self, amount):
        self.debt -= amount
    def withdraw(self, amount, price):
        if self._r(self.collateral - amount, self.debt, price) < self.min_ratio:
            raise Undercollateralised()
        self.collateral -= amount
`
  },
  'core-banking': {
    'bank/accounts.py': `import itertools
from dataclasses import dataclass

class InsufficientFunds(ValueError):
    pass

@dataclass(frozen=True)
class Movement:
    kind: str
    amount: int
    balance_after: int

class Bank:
    def __init__(self):
        self.acc, self.n = {}, itertools.count(1)
    def open_account(self, customer, currency="GBP", overdraft=0):
        i = f"acc-{next(self.n)}"
        self.acc[i] = {"bal": 0, "od": overdraft, "h": []}
        return i
    def _check(self, amount):
        if not isinstance(amount, int) or amount <= 0:
            raise ValueError("amounts are positive")
    def deposit(self, i, amount):
        self._check(amount)
        a = self.acc[i]
        a["bal"] += amount
        a["h"].append(Movement("deposit", amount, a["bal"]))
    def withdraw(self, i, amount):
        self._check(amount)
        a = self.acc[i]
        if a["bal"] - amount < -a["od"]:
            raise InsufficientFunds()
        a["bal"] -= amount
        a["h"].append(Movement("withdrawal", amount, a["bal"]))
    def balance(self, i):
        return self.acc[i]["bal"]
    def history(self, i):
        return list(self.acc[i]["h"])
`
  },
  'ml-project': {
    'ml/data.py': `import csv, math, random

def load_csv(path):
    with open(path) as f:
        return [{k: float(v) for k, v in r.items()} for r in csv.DictReader(f)]

def train_test_split(rows, test_size, seed):
    r = list(rows)
    random.Random(seed).shuffle(r)
    n = round(len(r) * test_size)
    return r[n:], r[:n]

def standardise(train, test):
    m = sum(train) / len(train)
    s = math.sqrt(sum((x - m) ** 2 for x in train) / len(train))
    return [(x - m) / s for x in train], [(x - m) / s for x in test]
`
  },
  'data-pipeline': {
    'pipeline/validate.py': `from dataclasses import dataclass, field

@dataclass
class Schema:
    columns: dict
    required: set = field(default_factory=set)

@dataclass
class Rejected:
    row: dict
    reason: str

def validate_rows(rows, schema):
    good, bad = [], []
    for row in rows:
        out, reason = {}, None
        for col, typ in schema.columns.items():
            v = row.get(col)
            if v is None or v == "":
                if col in schema.required:
                    reason = f"{col} is missing"
                    break
                continue
            try:
                out[col] = typ(v)
            except (TypeError, ValueError):
                reason = f"{col} is not {typ.__name__}"
                break
        (bad.append(Rejected(row, reason)) if reason else good.append(out))
    return good, bad
`
  },
  'market-terminal': {
    'terminal/quotes.py': `class OutOfOrder(ValueError):
    pass

class QuoteBook:
    def __init__(self):
        self.q, self.t, self.seq = {}, {}, {}
    def apply(self, tick):
        sym, seq = tick["symbol"], tick["seq"]
        if seq <= self.seq.get(sym, 0):
            raise OutOfOrder()
        if "bid" in tick:
            if tick["bid"] > tick["ask"]:
                raise ValueError("crossed")
            self.q[sym] = (tick["bid"], tick["ask"])
        else:
            self.t[sym] = tick["last"]
        self.seq[sym] = seq
    def best(self, symbol):
        return self.q[symbol]
    def last(self, symbol):
        return self.t.get(symbol)
    def spread(self, symbol):
        b, a = self.q[symbol]
        return a - b
`
  },
  exchange: {
    'exchange/book.py': `from dataclasses import dataclass

@dataclass(frozen=True)
class Fill:
    taker: str
    maker: str
    price: int
    qty: int

class OrderBook:
    def __init__(self):
        self.orders = []  # [id, side, price, qty, seq]
        self.n = 0
    def submit(self, oid, side, price, qty):
        fills = []
        opp = "sell" if side == "buy" else "buy"
        while qty:
            book = [o for o in self.orders if o[1] == opp and (o[2] <= price if side == "buy" else o[2] >= price)]
            if not book:
                break
            best = min(book, key=lambda o: (o[2] if side == "buy" else -o[2], o[4]))
            q = min(qty, best[3])
            fills.append(Fill(oid, best[0], best[2], q))
            best[3] -= q
            qty -= q
            if not best[3]:
                self.orders.remove(best)
        if qty:
            self.n += 1
            self.orders.append([oid, side, price, qty, self.n])
        return fills
    def cancel(self, oid):
        for o in self.orders:
            if o[0] == oid:
                self.orders.remove(o)
                return True
        return False
    def best_bid(self):
        return max((o[2] for o in self.orders if o[1] == "buy"), default=None)
    def best_ask(self):
        return min((o[2] for o in self.orders if o[1] == "sell"), default=None)
`
  },
  'options-pricer': {
    'pricer/bs.py': `import math

def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def _d(s, k, t, r, sigma):
    d1 = (math.log(s / k) + (r + sigma * sigma / 2) * t) / (sigma * math.sqrt(t))
    return d1, d1 - sigma * math.sqrt(t)

def call_price(s, k, t, r, sigma):
    d1, d2 = _d(s, k, t, r, sigma)
    return s * norm_cdf(d1) - k * math.exp(-r * t) * norm_cdf(d2)

def put_price(s, k, t, r, sigma):
    d1, d2 = _d(s, k, t, r, sigma)
    return k * math.exp(-r * t) * norm_cdf(-d2) - s * norm_cdf(-d1)
`
  },
  numerics: {
    'numerics/roots.py': `class NoBracket(ValueError):
    pass

def bisect(f, a, b, tol=1e-10):
    fa = f(a)
    if fa * f(b) > 0:
        raise NoBracket()
    while b - a > tol:
        m = (a + b) / 2
        if fa * f(m) <= 0:
            b = m
        else:
            a, fa = m, f(m)
    return (a + b) / 2

def newton(f, df, x0, tol=1e-12, max_iter=50):
    x = x0
    for _ in range(max_iter):
        d = df(x)
        if d == 0:
            raise ArithmeticError("zero derivative")
        nx = x - f(x) / d
        if abs(nx - x) < tol:
            return nx
        x = nx
    raise ArithmeticError("no convergence")
`
  },
  'proof-checker': {
    'prover/logic.py': `import itertools, re

def parse(text):
    toks = re.findall(r"->|[a-z]+|[~&|()]|\\S", text)
    pos = [0]
    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None
    def take(t=None):
        tok = peek()
        if tok is None or (t and tok != t):
            raise ValueError(f"expected {t or 'more'} at token {pos[0]}")
        pos[0] += 1
        return tok
    def imp():
        a = disj()
        if peek() == "->":
            take()
            return ("->", a, imp())
        return a
    def disj():
        a = conj()
        while peek() == "|":
            take()
            a = ("|", a, conj())
        return a
    def conj():
        a = neg()
        while peek() == "&":
            take()
            a = ("&", a, neg())
        return a
    def neg():
        if peek() == "~":
            take()
            return ("~", neg())
        if peek() == "(":
            take()
            e = imp()
            take(")")
            return e
        tok = take()
        if not re.fullmatch(r"[a-z]+", tok):
            raise ValueError(f"unexpected {tok}")
        return tok
    e = imp()
    if peek() is not None:
        raise ValueError("trailing input")
    return e

def evaluate(f, env):
    if isinstance(f, str):
        return env[f]
    op = f[0]
    if op == "~":
        return not evaluate(f[1], env)
    a, b = evaluate(f[1], env), evaluate(f[2], env)
    return a and b if op == "&" else a or b if op == "|" else (not a) or b

def _vars(f):
    return {f} if isinstance(f, str) else set().union(*(_vars(x) for x in f[1:]))

def is_tautology(text):
    f = parse(text)
    vs = sorted(_vars(f))
    return all(evaluate(f, dict(zip(vs, bits))) for bits in itertools.product([False, True], repeat=len(vs)))
`
  }
}
describe('the starting files', () => {
  it('include the toolchain, a README with the plan, and the first milestone’s tests', () => {
    const files = scaffoldFiles(rail())
    const paths = files.map((f) => f.path)
    expect(paths).toEqual(expect.arrayContaining(['pyproject.toml', 'requirements.txt', '.gitignore', 'rail/__init__.py', 'rail/ledger.py', 'tests/test_ledger.py', 'README.md']))
    expect(files.find((f) => f.path === 'README.md')!.content).toContain('## Milestones')
    expect(testFilesOf(files)).toEqual(['tests/test_ledger.py'])
    // A README the plan wrote itself is replaced by the plan's
    expect(scaffoldFiles({ ...rail(), scaffold: [...rail().scaffold, { path: 'README.md', content: 'mine' }] }).filter((f) => f.path === 'README.md')).toHaveLength(1)
    // The plan's own package stands; no second one named after the project
    expect(paths.filter((p) => p.endsWith('__init__.py'))).toEqual(['rail/__init__.py'])
    expect(scaffoldFiles({ ...rail(), scaffold: [{ path: 'tests/test_x.py', content: '' }] }).map((f) => f.path)).toContain('payment_rail/__init__.py')
  })

  it('give a plan without tests one failing test per “done when”, in each language', () => {
    for (const language of ['python', 'rust', 'go', 'javascript', 'typescript'] as const) {
      const plan: ProjectPlan = { ...rail(), language, scaffold: [], by: 'gemma' }
      const files = scaffoldFiles(plan)
      const tests = testFilesOf(files)
      expect(tests.length, language).toBe(1)
      const body = files.find((f) => f.path === tests[0])!.content
      expect(body.match(/Write this test:/g)?.length, language).toBe(plan.milestones[0].doneWhen.length)
      expect(toolchainFiles(plan).every((t) => files.some((f) => f.path === t.path))).toBe(true)
    }
    expect(placeholderTests({ ...rail(), milestones: [] })).toEqual([])
  })

  it.skipIf(!hasPython)('every template’s tests fail on its stubs and pass on a working solution', () => {
    // The C++ and Solidity templates are run with their own toolchains in test/trackPackRuns.test.ts
    for (const t of IDEA_TEMPLATES.filter((x) => x.plan.language === 'python')) {
      const files = scaffoldFiles(planFromTemplate(t, t.about, NOW, false))
      const before = runPy(files)
      const names = Object.keys(before)
      expect(names.length, t.id).toBe(t.plan.milestones[0].doneWhen.length)
      expect(Object.values(before).every((v) => v !== 'pass'), `${t.id}: ${JSON.stringify(before)}`).toBe(true)
      const solved = files.map((f) => (SOLUTIONS[t.id][f.path] ? { ...f, content: SOLUTIONS[t.id][f.path] } : f))
      const after = runPy(solved)
      expect(after, t.id).toEqual(Object.fromEntries(names.map((n) => [n, 'pass'])))
    }
  })

  it.skipIf(!hasPython)('a Python plan without tests fails until the tests are written', () => {
    const files = scaffoldFiles({ ...rail(), scaffold: [], by: 'gemma' })
    const r = runPy(files)
    expect(Object.keys(r)).toHaveLength(5)
    expect(Object.values(r).every((v) => v === 'AssertionError')).toBe(true)
  })

  it('a JavaScript plan without tests fails under node --test', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tide-idea-js-'))
    writeAll(dir, scaffoldFiles({ ...rail(), language: 'javascript', scaffold: [], by: 'gemma' }))
    const r = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stdout).toMatch(/# fail 5/)
  })
})
