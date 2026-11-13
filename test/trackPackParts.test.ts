import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { compareRuns, curve, experimentFor, parseRun, runNumber, safeExperiment } from '../src/shared/runs'
import { capabilityGaps, packGaps } from '../src/shared/capability'
import { packMissingText } from '../src/shared/trackPacks'

// No packs installed: an empty tools folder, so every fallback is what a learner without them sees
const dir = mkdtempSync(join(tmpdir(), 'tide-packparts-'))
process.env.TIDE_TOOLS_DIR = join(dir, 'tools')
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } }))
const { scramClientFinal, cellOf } = await import('../src/main/packs/pgwire')
const { labResultOf, pgColumnType, sessionOf, pgQuery } = await import('../src/main/packs/postgres')
const { snippetMode, testFile, parseForgeText, parseForgeJson, scriptContract, forgeSummary } = await import('../src/main/packs/foundry')
const { quietSpark, runCode, packEnv } = await import('../src/main/runner')
const { packNamedIn, stepPercent } = await import('../src/renderer/src/components/TrackPacks')

const line = (o: unknown) => JSON.stringify(o)

describe('training runs', () => {
  const run = (name: string, lr: number, losses: (number | string)[], extra: Record<string, unknown> = {}) =>
    parseRun([line({ type: 'start', id: name, name, time: 1 }), line({ type: 'params', params: { lr, epochs: 3, ...extra } }), ...losses.map((l, i) => line({ type: 'metric', step: i, values: { loss: l, acc: 0.5 + i / 10 } })), line({ type: 'end', status: 'finished', time: 2 })].join('\n'), name, 'demo')

  it('reads a run, keeping a loss that blew up as NaN or infinity', () => {
    const r = run('lr 10', 10, [1, 50, 'Infinity'])
    expect(r.status).toBe('finished')
    expect(r.params).toEqual({ lr: 10, epochs: 3 })
    expect(r.metrics.loss.map((p) => p.value)).toEqual([1, 50, Infinity])
    expect(curve(r.metrics.loss)).toEqual([[0, 1], [1, 50]])
    expect(runNumber('NaN')).toBeNaN()
  })

  it('skips a line half-written while the run goes on', () => {
    const r = parseRun(`${line({ type: 'start', name: 'x', time: 1 })}\n{"type": "metric", "st`, 'x', 'demo')
    expect(r.status).toBe('running')
    expect(r.metrics).toEqual({})
  })

  it('puts what changed first, sets aside what stayed the same, and says what the change did', () => {
    const c = compareRuns([run('lr 0.1', 0.1, [1, 0.6, 0.4]), run('lr 0.5', 0.5, [1, 0.3, 0.1]), run('lr 10', 10, [1, 50, 'NaN'])])
    expect(c.changed).toEqual([{ key: 'lr', values: ['0.1', '0.5', '10'] }])
    expect(c.same).toEqual([{ key: 'epochs', value: '3' }])
    const loss = c.metrics.find((m) => m.key === 'loss')!
    expect(loss.lowerBetter).toBe(true)
    expect(loss.winner).toBe(1)
    expect(loss.diverged).toEqual([false, false, true])
    expect(c.findings).toContain('lr 0.1 → 0.5: loss ended at 0.1 instead of 0.4 (better).')
    expect(c.findings).toContain('lr 0.1 → 10: loss blew up (NaN).')
    expect(c.metrics.find((m) => m.key === 'acc')!.lowerBetter).toBe(false)
  })

  it('makes no finding where two runs differ in more than one setting', () => {
    const c = compareRuns([run('a', 0.1, [1, 0.5]), run('b', 0.5, [1, 0.2], { epochs: 9 })])
    expect(c.findings).toEqual([])
  })

  it('names a notebook’s experiment as tide_runs does', () => {
    expect(experimentFor('Courses/ML/Learning rates.ipynb')).toBe('Learning rates')
    expect(safeExperiment('Learning rates')).toBe('Learning-rates')
  })
})

describe('Postgres pieces', () => {
  it('signs in with SCRAM-SHA-256 as RFC 7677 says', () => {
    const { final, serverSignature } = scramClientFinal('pencil', 'n=user,r=rOprNGfwEbeRWgbNEkqO', 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096')
    expect(final).toBe('c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=')
    expect(serverSignature).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=')
  })

  it('turns text values into numbers only where nothing is lost', () => {
    expect(cellOf('42', 23)).toBe(42)
    expect(cellOf('12.50', 1700)).toBe(12.5)
    expect(cellOf('9007199254740993', 20)).toBe('9007199254740993')
    expect(cellOf('0.1000000000000000000001', 1700)).toBe('0.1000000000000000000001')
    expect(cellOf('t', 16)).toBe('true')
    expect(cellOf('2025-01-06', 1082)).toBe('2025-01-06')
    expect(cellOf(null, 23)).toBeNull()
  })

  it('shows the last result that has rows, and explains a lock timeout and a failed transaction', () => {
    const r = labResultOf({ sets: [{ fields: [{ name: 'n', typeOid: 20 }], rows: [['3']], command: 'SELECT 1' }, { fields: [], rows: [], command: 'COMMIT' }], notices: [], status: 'I', ms: 1 })
    expect(r.columns).toEqual(['n'])
    expect(r.types).toEqual(['bigint'])
    expect(r.rows).toEqual([[3]])
    const write = labResultOf({ sets: [{ fields: [], rows: [], command: 'UPDATE 4' }], notices: [], status: 'T', ms: 1 })
    expect(write.changes).toBe(4)
    const lock = labResultOf({ sets: [], notices: [], status: 'E', ms: 5000, error: { message: 'canceling statement due to lock timeout', code: '55P03', severity: 'ERROR' } })
    expect(lock.error).toMatch(/the other session holds[\s\S]*run ROLLBACK/)
    const typo = labResultOf({ sets: [], notices: [], status: 'I', ms: 1, error: { message: 'column "totl" does not exist', code: '42703', severity: 'ERROR', position: 8, hint: 'Perhaps you meant to reference the column "orders.total".' } })
    expect(typo.error).toBe('column "totl" does not exist (at character 8)\nHint: Perhaps you meant to reference the column "orders.total".')
  })

  it('gives the sample data real Postgres types', () => {
    expect(pgColumnType('INTEGER', [1, 2])).toBe('integer')
    expect(pgColumnType('REAL', [12.5, 3])).toBe('numeric(12,2)')
    expect(pgColumnType('REAL', [0.123456])).toBe('double precision')
    expect(pgColumnType('DATE', ['2025-01-06'])).toBe('date')
    expect(pgColumnType('TIMESTAMP', ['2025-01-06 10:00:00'])).toBe('timestamp')
    expect(pgColumnType('TEXT', ['GBP'])).toBe('text')
  })

  it('reads which session a block is for', () => {
    expect(sessionOf('-- session: B\nSELECT 1')).toBe('B')
    expect(sessionOf('SELECT 1')).toBe('A')
  })

  it('says how to add Postgres when it isn’t installed', async () => {
    const r = await pgQuery('lesson', 'SELECT 1')
    expect(r.error).toBe(packMissingText('postgres', 'Postgres SQL'))
    expect(packNamedIn(r.error!)).toBe('postgres')
  })
})

describe('Solidity pieces', () => {
  it('tells a test contract, a script and plain code apart', () => {
    expect(snippetMode('contract T is Test { function test_A() public {} }', '')).toBe('test')
    expect(snippetMode('contract C {}', 'contract CTest is Test {}')).toBe('test')
    expect(snippetMode('contract S is Script { function run() public {} }', '')).toBe('script')
    expect(snippetMode('contract C { uint x; }', '')).toBe('build')
    expect(scriptContract('contract A {}\ncontract Deploy is Script {\n function run() public {}\n}')).toBe('Deploy')
  })

  it('adds what hidden tests leave out: the licence, the pragma and the imports', () => {
    const t = testFile('contract CounterTest is Test { function test_A() public {} }')
    expect(t.split('\n').slice(0, 4)).toEqual(['// SPDX-License-Identifier: UNLICENSED', 'pragma solidity ^0.8.20;', 'import "forge-std/Test.sol";', 'import "../src/Main.sol";'])
    const full = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\nimport "forge-std/Test.sol";\nimport "../src/Main.sol";\ncontract X is Test {}'
    expect(testFile(full)).toBe(`${full}\n`)
  })

  it('reads forge test’s results, as text and as JSON', () => {
    expect(parseForgeText('[PASS] test_A() (gas: 1)\n[FAIL: assertion failed: 0 != 2] test_B() (gas: 2)\n[PASS] testFuzz_C(uint8) (runs: 256, μ: 1, ~: 1)\n')).toEqual({ passed: ['test_A()', 'testFuzz_C(uint8)'], failed: [{ name: 'test_B()', message: 'assertion failed: 0 != 2' }] })
    const outcomes = parseForgeJson('{"test/A.t.sol:ATest":{"test_results":{"test_A()":{"status":"Success","reason":null},"testFuzz_B(uint8)":{"status":"Failure","reason":"overflow","counterexample":{"calldata":"0x"}}}}}')!
    expect(outcomes).toEqual([{ id: 'ATest::test_A()', status: 'pass' }, { id: 'ATest::testFuzz_B(uint8)', status: 'fail', message: 'overflow (counterexample: {"calldata":"0x"})' }])
    expect(forgeSummary(outcomes)).toBe('1 of 2 tests passed\n  passed  ATest::test_A()\n  FAILED  ATest::testFuzz_B(uint8): overflow (counterexample: {"calldata":"0x"})')
    expect(parseForgeJson('Error: compiler failed')).toBeNull()
  })
})

describe('without the packs', () => {
  it('Solidity says which pack it needs and where to add it', async () => {
    const r = await runCode('solidity', 'contract C {}')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe(packMissingText('foundry', 'Solidity'))
    expect(r.stderr).toMatch(/Settings › Tools › Foundry pack: about 153 MB to download/)
  })

  it('Spark and Kafka say so too, instead of failing on the network', async () => {
    const spark = await packEnv('from pyspark.sql import SparkSession', 'python', dir, true)
    // A Mac with its own Java runs Spark with that; without one, the pack is named
    if (spark.missing) expect(spark.missing).toMatch(/needs the Big data pack/)
    const kafka = await packEnv('from kafka import KafkaProducer', 'python', dir, false)
    expect(kafka.missing).toMatch(/^Kafka \(a broker to produce to and consume from\) needs the Big data pack/)
    const chain = await packEnv('cast block-number --rpc-url $ETH_RPC_URL', 'bash', dir, false)
    expect(chain.missing).toMatch(/needs the Foundry pack/)
  })

  it('a lesson on a pack’s topic is told to offer the install once, and what to do meanwhile', () => {
    const profile = { kinds: ['code'], needs: [] } as never
    const s = { languages: [], maths: true, labPack: true, web: false, packs: { foundry: false, bigdata: false, postgres: true, cpp: true } }
    expect(capabilityGaps('Writing ERC-20 tokens in Solidity', profile, s).map((g) => g.need)).toEqual(['pack:foundry'])
    expect(packGaps('Kafka consumer groups', s)[0].line).toMatch(/^The Big data pack isn't installed, so Spark jobs and Kafka topics can't run here yet\. Offer it once: it installs in Settings › Tools › Big data pack \(about 566 MB to download/)
    expect(packGaps('Postgres isolation levels', s)).toEqual([])
    expect(packGaps('Postgres isolation levels', { packs: undefined })).toEqual([])
  })

  it('takes Spark’s start-up chatter out of what the learner reads', () => {
    expect(quietSpark("WARNING: Using incubator modules: jdk.incubator.vector\nUsing Spark's default log4j profile: org/apache/spark/log4j2-defaults.properties\n26/11/13 WARN NativeCodeLoader: Unable to load native-hadoop library\nTraceback (most recent call last):")).toBe('Traceback (most recent call last):')
  })

  it('reads a download’s progress for the bar', () => {
    expect(stepPercent('Downloading Foundry 1.9.0: 45% of 122 MB…')).toBe(45)
    expect(stepPercent('Unpacking Foundry…')).toBeNull()
    expect(packNamedIn('PySpark needs the Big data pack (…)')).toBe('bigdata')
    expect(packNamedIn('Ran fine')).toBeNull()
  })
})
