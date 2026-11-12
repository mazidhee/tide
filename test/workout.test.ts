/**
 * The morning workout: every generator's answers worked out again independently (hundreds per
 * kind, Python snippets run through Python itself), matrix puzzles with exactly one option that
 * keeps every rule, the chess engine and its mates, ratings, titles, streaks across days and time
 * zones, the championship, and the move over from the old mental maths files.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { addDays, dayKey, LEVELS, type MathsSession } from '../src/shared/mentalMaths'
import { markItem, parseLoose, rng, type WorkoutItem } from '../src/shared/workoutItems'
import { SPEED_TIERS } from '../src/shared/workoutSpeed'
import { BITS_TIERS, SNIPPETS, pyDiv, pyMod } from '../src/shared/workoutBits'
import { FERMI, ODDS_TIERS } from '../src/shared/workoutOdds'
import { bruteSolutions, consistent, gridItem, holds, keepsRule, knightsItem, makeGrid, makeMatrix, looksSame, matrixItem, sequenceItem, solveGrid, type Attr } from '../src/shared/workoutLogic'
import { boxesItem, crossings, hanoiItem, jugs, jugsItem, makeMateInOne, makeMateInTwo, mateItem, riverItem, slideItem } from '../src/shared/workoutDepth'
import { inCheck, isMate, legalMoves, matesInOne, play, type Board } from '../src/shared/chessMini'
import {
  ROUNDS,
  TITLES,
  applyRound,
  averageRating,
  bestThisMonth,
  championshipBar,
  currentTitle,
  expected,
  freshPrefs,
  isSunday,
  kFactor,
  migrateFromMaths,
  nextItem,
  nextTitleLine,
  performance,
  targetDifficulty,
  updateRating,
  workoutStreak,
  type ItemResult,
  type RoundId,
  type RoundRecord,
  type WorkoutState
} from '../src/shared/workout'

// A scratch vault for main/workout's files
const root = mkdtempSync(join(tmpdir(), 'tide-workout-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, '.tide'), { recursive: true })
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false }, app: { getPath: () => root, isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault }) }))

const N = 300
const each = (tiers: { id: string; make(r: ReturnType<typeof rng>): WorkoutItem }[], n: number, f: (it: WorkoutItem, tier: string) => void) => {
  for (const t of tiers) for (let s = 1; s <= n; s++) f(t.make(rng(s * 7919 + t.id.length)), t.id)
}
const num = (s: string) => Number(s.replace(/,/g, ''))
const value = (it: WorkoutItem) => (it.answer as { value: number }).value
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

// ---------- Speed ----------

/** Works a hard speed question out again from its prompt alone */
function solveSpeed(p: string): number {
  let m: RegExpMatchArray | null
  if ((m = p.match(/^\((\d+) \+ (\d+)\) × (\d+)$/))) return (+m[1] + +m[2]) * +m[3]
  if ((m = p.match(/^(\d+) ÷ (\d+) × (\d+)$/))) return (+m[1] / +m[2]) * +m[3]
  if ((m = p.match(/^(\d+) × (\d+) − (\d+)$/))) return +m[1] * +m[2] - +m[3]
  if ((m = p.match(/^(\d+) × (\d+)$/))) return +m[1] * +m[2]
  if ((m = p.match(/^(\d+) ÷ (\d+)$/))) return +m[1] / +m[2]
  if ((m = p.match(/^(\d+)²$/))) return +m[1] * +m[1]
  if ((m = p.match(/^([\d,]+) at (\d+)% a year for (\d) years$/))) return num(m[1]) * (1 + +m[2] / 100) ** +m[3]
  if ((m = p.match(/^(\d+)% off, then (\d+)% off that: total % off$/))) return 100 * (1 - (1 - +m[1] / 100) * (1 - +m[2] / 100))
  if ((m = p.match(/^([\d.]+)% of (\d+)$/))) return (+m[1] * +m[2]) / 100
  if ((m = p.match(/^Interest on ([\d,]+) at ([\d.]+)% for (\d+) months$/))) return (num(m[1]) * (+m[2] / 100) * +m[3]) / 12
  if ((m = p.match(/^EUR\/USD from ([\d.]+) to ([\d.]+): change in pips$/))) return Math.round((+m[2] - +m[1]) * 10000)
  if ((m = p.match(/^A (\d+) bp fee on ([\d,]+)$/))) return (num(m[2]) * +m[1]) / 10000
  if ((m = p.match(/^\w+\/\w+ at ([\d.]+): ([\d,]+) \w+ in \w+$/))) return num(m[2]) * +m[1]
  throw new Error(`Unknown prompt: ${p}`)
}

describe('speed round', () => {
  it('has the fourteen mental maths levels and a harder ceiling, rising in difficulty', () => {
    expect(SPEED_TIERS.slice(0, LEVELS.length).map((t) => t.id)).toEqual(LEVELS.map((l) => l.id))
    const ds = SPEED_TIERS.map((t) => t.difficulty)
    expect([...ds].sort((a, b) => a - b)).toEqual(ds)
    expect(Math.max(...ds)).toBeGreaterThanOrEqual(1700)
  })
  it('works every hard question out again from its prompt', () => {
    each(SPEED_TIERS.slice(LEVELS.length), N, (it) => {
      const tol = (it.answer as { tolerance?: number }).tolerance ?? 1e-9
      close(solveSpeed(it.prompt), value(it), Math.max(tol, 1e-6))
      expect(it.steps.length).toBeGreaterThan(0)
      expect(markItem(it, String(value(it))).right).toBe(true)
      expect(markItem(it, String(value(it) + 1)).right).toBe(false)
    })
  })
  it('wraps the ladder levels with their answers intact', () => {
    each(SPEED_TIERS.slice(0, LEVELS.length), 40, (it) => {
      const a = it.answer
      const shown = a.type === 'number' ? String(a.value) : a.type === 'binary' || a.type === 'hex' ? a.value : ''
      expect(markItem(it, shown).right).toBe(true)
    })
  })
})

// ---------- Bits ----------

function solveBits(p: string): number | string {
  let m: RegExpMatchArray | null
  if ((m = p.match(/^0x([0-9A-F]+) in decimal$/))) return parseInt(m[1], 16)
  if ((m = p.match(/^0b([01 ]+) in hex$/))) return parseInt(m[1].replace(/ /g, ''), 2)
  if ((m = p.match(/^([\d,]+) in binary$/))) return num(m[1])
  if ((m = p.match(/^([\d,]+) in hex$/))) return num(m[1])
  if ((m = p.match(/^0x([0-9A-F]+) ([&|^]) 0x([0-9A-F]+) \(in hex\)$/))) {
    const [a, b] = [parseInt(m[1], 16), parseInt(m[3], 16)]
    return m[2] === '&' ? a & b : m[2] === '|' ? a | b : a ^ b
  }
  if ((m = p.match(/^(\d+) << (\d+)$/))) return +m[1] * 2 ** +m[2]
  if ((m = p.match(/^(\d+) >> (\d+)$/))) return Math.floor(+m[1] / 2 ** +m[2])
  if ((m = p.match(/^0x([0-9A-F]+) as a signed 8-bit number$/))) {
    const v = parseInt(m[1], 16)
    return v >= 128 ? v - 256 : v
  }
  if ((m = p.match(/^−(\d+) in 8-bit two’s complement \(hex\)$/))) return (256 - +m[1]) & 255
  if ((m = p.match(/^x & \(x − 1\) for x = (\d+)$/))) return +m[1] & (+m[1] - 1)
  if ((m = p.match(/^x & −x for x = (\d+)$/))) return +m[1] & -+m[1]
  if ((m = p.match(/^How many bits are set in 0x([0-9A-F]+)\?$/))) return [...parseInt(m[1], 16).toString(2)].filter((c) => c === '1').length
  if ((m = p.match(/^(\d+) \^ \(1 << (\d+)\)$/))) return +m[1] ^ (1 << +m[2])
  throw new Error(`Unknown prompt: ${p}`)
}

describe('bits round', () => {
  it('works every conversion, mask, shift and trick out again', () => {
    each(
      BITS_TIERS.filter((t) => !t.id.startsWith('py')),
      N,
      (it) => {
        const want = solveBits(it.prompt) as number
        const a = it.answer
        if (a.type === 'number') expect(a.value).toBe(want)
        else if (a.type === 'hex') expect(parseInt(a.value, 16)).toBe(want)
        else if (a.type === 'binary') expect(parseInt(a.value, 2)).toBe(want)
        else throw new Error('unexpected answer type')
      }
    )
  })
  it('matches Python on floor division and modulo', () => {
    expect([pyDiv(-7, 2), pyMod(-7, 2), pyDiv(-47, 5), pyMod(-47, 5)]).toEqual([-4, 1, -10, 3])
  })
  const python = ['/opt/homebrew/bin/python3', '/usr/bin/python3'].find((p) => existsSync(p))
  it.skipIf(!python)('prints exactly what Python prints, for hundreds of snippets', () => {
    const made: { code: string; out: string }[] = []
    for (let s = 1; s <= 60; s++) for (const mk of SNIPPETS) made.push(mk(rng(s * 104729 + made.length)))
    const dir = mkdtempSync(join(tmpdir(), 'tide-py-'))
    writeFileSync(join(dir, 'cases.json'), JSON.stringify(made.map((m) => m.code)))
    writeFileSync(
      join(dir, 'run.py'),
      'import io, json, sys, contextlib\nout = []\nfor code in json.load(open(sys.argv[1])):\n    buf = io.StringIO()\n    with contextlib.redirect_stdout(buf):\n        exec(code, {})\n    out.append(buf.getvalue().rstrip("\\n"))\nprint(json.dumps(out))\n'
    )
    const got = JSON.parse(execFileSync(python!, ['-I', join(dir, 'run.py'), join(dir, 'cases.json')], { encoding: 'utf8' })) as string[]
    expect(got).toHaveLength(made.length)
    made.forEach((m, i) => expect(got[i], m.code).toBe(m.out))
  })
  it('marks printed output with spaces where they matter', () => {
    const it0 = { answer: { type: 'text' as const, accept: ['4 5'] } }
    expect(markItem(it0, '4 5').right).toBe(true)
    expect(markItem(it0, '45').right).toBe(false)
    expect(markItem({ answer: { type: 'text', accept: ['[1, 9, 25]'] } }, '[1,9,25]').right).toBe(true)
  })
})

// ---------- Odds ----------

function solveOdds(p: string): number {
  let m: RegExpMatchArray | null
  if ((m = p.match(/^From ([\d,.]+) to ([\d,.]+): % change$/))) return ((num(m[2]) - num(m[1])) / num(m[1])) * 100
  if ((m = p.match(/^A price falls (\d+)%\. What % rise takes it back\?$/))) return (1 / (1 - +m[1] / 100) - 1) * 100
  if ((m = p.match(/^Two fair dice: P\(total = (\d+)\)\?/))) {
    let w = 0
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === +m[1]) w++
    return w / 36
  }
  if ((m = p.match(/^P\(at least one six in (\d) rolls\)/))) {
    // Count every outcome
    const n = +m[1]
    let hit = 0
    for (let k = 0; k < 6 ** n; k++) {
      let x = k
      let six = false
      for (let i = 0; i < n; i++) {
        if (x % 6 === 5) six = true
        x = Math.floor(x / 6)
      }
      if (six) hit++
    }
    return Math.round((hit / 6 ** n) * 1000) / 1000
  }
  if ((m = p.match(/^Expected total of (\d) fair dice$/))) return +m[1] * 3.5
  if ((m = p.match(/^Roll a die: even pays £(\d+), odd costs £(\d+)/))) return (3 * +m[1] - 3 * +m[2]) / 6
  if ((m = p.match(/^Pay £1 to roll a die\. Rolling (a 6|a 5 or 6|4, 5 or 6) pays £(\d+)/))) return ({ 'a 6': 1, 'a 5 or 6': 2, '4, 5 or 6': 3 }[m[1]]! / 6) * +m[2] - 1
  if (p.startsWith('Two cards from a shuffled deck: P(both hearts)')) {
    let hit = 0
    let all = 0
    for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) if (a !== b) (all++, a % 4 === 0 && b % 4 === 0 && hit++)
    return hit / all
  }
  if (p.startsWith('Two cards: P(an ace, then a king)')) return (4 * 4) / (52 * 51)
  if (p.startsWith('Two cards: P(they make a pair)')) {
    let hit = 0
    let all = 0
    for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) if (a !== b) (all++, a >> 2 === b >> 2 && hit++)
    return hit / all
  }
  if ((m = p.match(/^(\d+)% have a condition\. A test catches (\d+)% of them and flags (\d+)% of healthy people/))) {
    const [prev, sens, fp] = [+m[1] / 100, +m[2] / 100, +m[3] / 100]
    return Math.round(((prev * sens) / (prev * sens + (1 - prev) * fp)) * 1000) / 10
  }
  if ((m = p.match(/^A family has (\d) children, at least one a boy\. P\(all boys\)/))) {
    const n = +m[1]
    let some = 0
    for (let k = 0; k < 2 ** n; k++) if (k) some++
    return 1 / some
  }
  if (p.startsWith('Expected number of rolls of a fair die')) return 6
  throw new Error(`Unknown prompt: ${p}`)
}

describe('odds round', () => {
  it('works every calculation out again by counting', () => {
    each(
      ODDS_TIERS.filter((t) => !t.id.startsWith('fermi')),
      N,
      (it) => {
        const a = it.answer as { value: number; tolerance?: number }
        close(solveOdds(it.prompt), a.value, Math.max(a.tolerance ?? 1e-9, 1e-9) + 1e-9)
      }
    )
  })
  it('has a sourced reference for every Fermi question', () => {
    expect(FERMI.length).toBeGreaterThanOrEqual(25)
    for (const f of FERMI) {
      expect(f.value).toBeGreaterThan(0)
      expect(f.source.length).toBeGreaterThan(10)
      expect(f.how.length).toBeGreaterThan(0)
    }
    // Values worked out from definitions agree with the arithmetic
    expect(FERMI.find((f) => f.q.startsWith('How many seconds are there in a year'))!.value).toBeCloseTo(365.25 * 86400, -5)
    expect(FERMI.find((f) => f.q.includes('4K'))!.value).toBeCloseTo(3840 * 2160 * 3, -5)
  })
  it('marks estimates by orders of magnitude off', () => {
    const it0 = { answer: { type: 'magnitude' as const, value: 3.84e5 } }
    expect(markItem(it0, '400k').right).toBe(true)
    expect(markItem(it0, '1e6').right).toBe(true)
    expect(markItem(it0, '4e6')).toMatchObject({ right: false })
    expect(markItem(it0, '4e6').score).toBeGreaterThan(0)
    expect(markItem(it0, '4e9').score).toBe(0)
    expect([parseLoose('3e8'), parseLoose('2.5bn'), parseLoose('3×10^8'), parseLoose('40k'), parseLoose('1,200')]).toEqual([3e8, 2.5e9, 3e8, 40000, 1200])
  })
})

// ---------- Patterns and logic ----------

describe('matrix puzzles', () => {
  for (const active of [1, 2, 3])
    it(`with ${active} changing rule${active > 1 ? 's' : ''}: exactly one option keeps every rule`, () => {
      for (let s = 1; s <= N; s++) {
        const m = makeMatrix(rng(s * 31 + active), active)
        expect(m.rules.filter((x) => x.kind !== 'const')).toHaveLength(active)
        const keeps = m.options.map((o) => {
          const g = [...m.grid.slice(0, 8), o]
          return m.rules.filter((rule) => !keepsRule(g, rule)).map((rule) => rule.attr)
        })
        expect(keeps.filter((broken) => broken.length === 0)).toHaveLength(1)
        expect(keeps[m.correct]).toEqual([])
        // Each wrong option breaks exactly one rule, the one it is labelled with
        keeps.forEach((broken, i) => {
          if (i === m.correct) return
          expect(broken).toEqual([m.breaks[i] as Attr])
        })
        // No two options look the same, and there are at least four
        expect(m.options.length).toBeGreaterThanOrEqual(4)
        for (let i = 0; i < m.options.length; i++) for (let j = i + 1; j < m.options.length; j++) expect(looksSame(m.options[i], m.options[j])).toBe(false)
        // Counts stay drawable
        for (const c of [...m.grid, ...m.options]) expect(c.count >= 1 && c.count <= 5).toBe(true)
      }
    })
  it('the harder ones lean on changing rules: every changing rule has a wrong option against it', () => {
    for (let s = 1; s <= 100; s++) {
      const m = makeMatrix(rng(s), 3)
      const changing = m.rules.filter((r) => r.kind !== 'const').map((r) => r.attr)
      const broken = new Set(Object.values(m.breaks))
      for (const a of changing) if (!(a === 'rot' && !['triangle', 'arrow', 'semi'].includes(m.grid[8].shape))) expect(broken.has(a)).toBe(true)
    }
  })
  it('explains the rules and why each wrong option fails', () => {
    const it0 = matrixItem(rng(42), 3)
    expect(it0.steps.some((s) => s.startsWith('So the gap is'))).toBe(true)
    expect(it0.steps.filter((s) => s.startsWith('Option '))).toHaveLength((it0.answer as { options: string[] }).options.length - 1)
  })
})

describe('sequences', () => {
  const checks: Record<string, (xs: number[], next: number) => boolean> = {
    'Constant difference': (xs, n) => new Set(xs.slice(1).map((x, i) => x - xs[i])).size === 1 && n - xs[5] === xs[1] - xs[0],
    'Constant ratio': (xs, n) => xs.every((x, i) => !i || x === xs[i - 1] * (xs[1] / xs[0])) && n === xs[5] * (xs[1] / xs[0]),
    'Differences in arithmetic progression': (xs, n) => {
      const d = [...xs, n].slice(1).map((x, i) => x - [...xs, n][i])
      return new Set(d.slice(1).map((x, i) => x - d[i])).size === 1
    },
    'Fibonacci-style': (xs, n) => xs.every((x, i) => i < 2 || x === xs[i - 1] + xs[i - 2]) && n === xs[4] + xs[5],
    'Interleaved sequences': (xs, n) => xs[2] - xs[0] === xs[4] - xs[2] && xs[3] - xs[1] === xs[5] - xs[3] && n - xs[4] === xs[2] - xs[0],
    'Multiply, then add': (xs, n) => {
      const m = (xs[2] - xs[1]) / (xs[1] - xs[0])
      const c = xs[1] - m * xs[0]
      return [...xs, n].every((x, i, all) => !i || x === all[i - 1] * m + c)
    },
    'Differences are the primes': (xs, n) => {
      const d = [...xs, n].slice(1).map((x, i) => x - [...xs, n][i])
      const P = [2, 3, 5, 7, 11, 13, 17, 19]
      const off = P.indexOf(d[0])
      return off >= 0 && d.every((x, i) => x === P[i + off])
    },
    Cubes: (xs, n) => {
      const all = [...xs, n]
      const d3 = (a: number[]) => a.slice(1).map((x, i) => x - a[i])
      return new Set(d3(d3(d3(all)))).size === 1 && d3(d3(d3(all)))[0] === 6
    }
  }
  it('every next term follows the stated rule', () => {
    for (let s = 1; s <= N; s++)
      for (const [lo, hi] of [[800, 1150], [1200, 1600]]) {
        const it0 = sequenceItem(rng(s * 13 + lo), lo, hi)
        const terms = it0.prompt.replace(/^What comes next\?\s+/, '').replace(/,\s+…$/, '').split(/,\s+/)
        if (it0.answer.type === 'text') {
          const idx = [...terms, it0.answer.accept[0]].map((l) => l.charCodeAt(0) - 65)
          const gaps = idx.slice(1).map((x, i) => x - idx[i])
          expect(gaps.slice(1).every((g, i) => g === gaps[i] + 1)).toBe(true)
          continue
        }
        const xs = terms.map(Number)
        expect(checks[it0.rule!](xs, value(it0)), `${it0.rule}: ${xs} → ${value(it0)}`).toBe(true)
      }
  })
})

describe('who owns what', () => {
  it('has exactly one solution, found by inference alone, and asks about it', () => {
    for (const n of [3, 4])
      for (let s = 1; s <= 120; s++) {
        const g = makeGrid(rng(s * 17 + n), n)
        const all = bruteSolutions(g.n, g.cats, g.clues)
        expect(all).toHaveLength(1)
        expect(all[0]).toEqual(g.solution)
        expect(solveGrid(g.n, g.cats, g.clues)!.solution).toEqual(g.solution)
        // Every clue is needed by the inference
        for (const cl of g.clues) expect(solveGrid(g.n, g.cats, g.clues.filter((x) => x !== cl))).toBeNull()
      }
  })
  it('the question’s right option is the one person who fits', () => {
    for (let s = 1; s <= 60; s++) {
      const it0 = gridItem(rng(s), 4)
      expect(it0.answer.type).toBe('choice')
      expect(it0.steps.length).toBeGreaterThan(3)
    }
  })
})

describe('knights and knaves', () => {
  it('has one consistent world, and the right option names its knights', () => {
    for (const hard of [false, true])
      for (let s = 1; s <= N; s++) {
        const it0 = knightsItem(rng(s * 3 + (hard ? 1 : 0)), hard)
        const lines = it0.prompt.split('\n').filter((l) => /^[ABC] says/.test(l))
        expect(lines).toHaveLength(3)
        const a = it0.answer as { options: string[]; correct: number }
        expect(new Set(a.options).size).toBe(a.options.length)
        const ticks = it0.steps.filter((x) => x.startsWith('✓'))
        expect(ticks).toHaveLength(1)
        const world = ['A', 'B', 'C'].map((n) => ticks[0].includes(`${n} knight`))
        const who = ['A', 'B', 'C'].filter((_, i) => world[i])
        const text = who.length === 0 ? 'None of them' : who.length === 3 ? 'All three' : who.length === 1 ? `Only ${who[0]}` : `${who[0]} and ${who[1]}`
        expect(a.options[a.correct]).toBe(text)
      }
  })
  it('works out a classic by hand', () => {
    // A: "B is a knave." B: "A and C are the same kind." C silent → two worlds; adding C: "A is a knight." pins it
    const says = [
      { kind: 'is' as const, who: 1, knight: false },
      { kind: 'same' as const, a: 0, b: 2 },
      { kind: 'is' as const, who: 0, knight: true }
    ]
    const sols = consistent(says)
    for (const s of sols) says.forEach((st, i) => expect(holds(st, s)).toBe(s[i]))
    expect(sols.length).toBeGreaterThan(0)
  })
})

// ---------- Calculation depth ----------

const empty = (): Board => Array(64).fill(null)
const at = (b: Board, s: string, p: string) => {
  b['abcdefgh'.indexOf(s[0]) + (8 - Number(s[1])) * 8] = p as never
}
const sqi = (s: string) => 'abcdefgh'.indexOf(s[0]) + (8 - Number(s[1])) * 8

describe('chess engine', () => {
  it('finds a back-rank mate and nothing else', () => {
    const b = empty()
    at(b, 'g8', 'k'), at(b, 'f7', 'p'), at(b, 'g7', 'p'), at(b, 'h7', 'p'), at(b, 'a1', 'R'), at(b, 'g1', 'K')
    const mates = matesInOne(b)
    expect(mates.map((m) => [m.from, m.to])).toEqual([[sqi('a1'), sqi('a8')]])
  })
  it('knows stalemate is not mate, and that a pinned piece cannot move', () => {
    const b = empty()
    at(b, 'h8', 'k'), at(b, 'f7', 'Q'), at(b, 'a1', 'K')
    expect(inCheck(b, 'b')).toBe(false)
    expect(legalMoves(b, 'b')).toHaveLength(0)
    expect(isMate(b, 'b')).toBe(false)
    const p = empty()
    at(p, 'e1', 'K'), at(p, 'e2', 'N'), at(p, 'e8', 'r'), at(p, 'a8', 'k')
    expect(legalMoves(p, 'w').filter((m) => m.from === sqi('e2'))).toHaveLength(0)
  })
  it('a smothered mate by the knight', () => {
    const b = empty()
    at(b, 'h8', 'k'), at(b, 'g8', 'r'), at(b, 'g7', 'p'), at(b, 'h7', 'p'), at(b, 'g5', 'N'), at(b, 'a1', 'K')
    const m = matesInOne(b)
    expect(m.map((x) => [x.from, x.to])).toEqual([[sqi('g5'), sqi('f7')]])
  })
  it('every mate in one made has one answer that mates, and no other move does', () => {
    for (let s = 1; s <= 150; s++) {
      const { board, move } = makeMateInOne(rng(s * 11))
      expect(isMate(play(board, move), 'b')).toBe(true)
      expect(inCheck(board, 'b')).toBe(false)
      expect(new Set(matesInOne(board).map((m) => `${m.from}-${m.to}`))).toEqual(new Set([`${move.from}-${move.to}`]))
    }
  })
  it('every mate in two made has one key move, and no mate in one', () => {
    let made = 0
    for (let s = 1; s <= 12; s++) {
      const r = makeMateInTwo(rng(s * 101))
      if (!r) continue
      made++
      const { board, move } = r
      expect(matesInOne(board)).toHaveLength(0)
      // Re-check the key by brute force: every reply is mated next move
      const keys = new Set<string>()
      for (const m of legalMoves(board, 'w')) {
        const after = play(board, m)
        const replies = legalMoves(after, 'b')
        if (replies.length && replies.every((rep) => legalMoves(play(after, rep), 'w').some((w) => isMate(play(play(after, rep), w), 'b')))) keys.add(`${m.from}-${m.to}`)
      }
      expect(keys).toEqual(new Set([`${move.from}-${move.to}`]))
    }
    expect(made).toBeGreaterThan(8)
  })
  it('a mate item marks the key move right', () => {
    const it0 = mateItem(rng(7), false)
    const a = it0.answer as { from: number; to: number }
    expect(markItem(it0, `${a.from}-${a.to}`).right).toBe(true)
    expect(markItem(it0, `${a.to}-${a.from}`).right).toBe(false)
  })
})

describe('state puzzles', () => {
  it('boxes after swaps: re-simulated from the prompt', () => {
    for (let s = 1; s <= N; s++) {
      const it0 = boxesItem(rng(s), s % 2 ? 4 : 7)
      const v = it0.visual as { boxes: string[]; items: string[] }
      let state = [...v.items]
      const n = state.length
      for (const line of it0.prompt.split('\n').filter((l) => /^\d+\. /.test(l))) {
        const sw = line.match(/Swap ([A-E]) and ([A-E])/)
        if (sw) {
          const [a, b] = [v.boxes.indexOf(sw[1]), v.boxes.indexOf(sw[2])]
          ;[state[a], state[b]] = [state[b], state[a]]
        } else if (line.includes('one box to the right')) state = [state[n - 1], ...state.slice(0, n - 1)]
        else if (line.includes('Reverse')) state.reverse()
        else throw new Error(line)
      }
      const ask = v.boxes.indexOf(it0.prompt.match(/What is in box ([A-E])\?/)![1])
      const a = it0.answer as { options: string[]; correct: number }
      expect(a.options[a.correct]).toBe(state[ask])
    }
  })
  it('Towers of Hanoi: the disc on move m, and the discs on C, by an independent method', () => {
    for (let s = 1; s <= N; s++) {
      const it0 = hanoiItem(rng(s))
      const n = Number(it0.prompt.match(/with (\d) discs/)![1])
      const m = Number(it0.prompt.match(/move (\d+)/)![1])
      if (it0.prompt.includes('Which disc')) {
        let k = 1
        while (m % 2 ** k === 0) k++
        expect(value(it0)).toBe(k)
      } else {
        // The iterative solution: smallest disc cycles one way, every other move is forced
        const pegs: number[][] = [Array.from({ length: n }, (_, i) => n - i), [], []]
        const dir = n % 2 ? 2 : 1
        let small = 0
        for (let i = 1; i <= m; i++) {
          if (i % 2) {
            const to = (small + dir) % 3
            pegs[to].push(pegs[small].pop()!)
            small = to
          } else {
            const [x, y] = [0, 1, 2].filter((p) => p !== small)
            const top = (p: number) => pegs[p][pegs[p].length - 1] ?? Infinity
            if (top(x) < top(y)) pegs[y].push(pegs[x].pop()!)
            else pegs[x].push(pegs[y].pop()!)
          }
        }
        expect(value(it0)).toBe(pegs[2].length)
      }
    }
  })
  it('river crossings match the known minimums', () => {
    expect(crossings(3, 2)!.count).toBe(11)
    expect(crossings(2, 2)!.count).toBe(5)
    expect(crossings(4, 2)).toBeNull()
    expect(crossings(4, 3)!.count).toBe(9)
    expect(crossings(5, 3)!.count).toBe(11)
    for (let s = 1; s <= 40; s++) expect(value(riverItem(rng(s)))).toBeGreaterThan(2)
  })
  it('water jugs: the path works and nothing shorter does', () => {
    const bfs = (a: number, b: number, t: number) => {
      const seen = new Map<string, number>([['0,0', 0]])
      const q: [number, number][] = [[0, 0]]
      while (q.length) {
        const [x, y] = q.shift()!
        const d = seen.get(`${x},${y}`)!
        if (x === t || y === t) return d
        const p1 = Math.min(x, b - y)
        const p2 = Math.min(y, a - x)
        for (const [nx, ny] of [[a, y], [x, b], [0, y], [x, 0], [x - p1, y + p1], [x + p2, y - p2]])
          if (!seen.has(`${nx},${ny}`)) (seen.set(`${nx},${ny}`, d + 1), q.push([nx, ny]))
      }
      return -1
    }
    for (let s = 1; s <= N; s++) {
      const it0 = jugsItem(rng(s))
      const [a, b, t] = it0.prompt.match(/\d+/g)!.map(Number)
      expect(value(it0)).toBe(bfs(a, b, t))
      expect(jugs(a, b, t)!.path).toHaveLength(value(it0))
    }
  })
  it('sliding puzzle: replaying the slides solves it, in the fewest moves', () => {
    for (let s = 1; s <= 120; s++) {
      const it0 = slideItem(rng(s), 6 + (s % 5))
      const tiles = [...(it0.visual as { tiles: number[] }).tiles]
      const order = it0.steps[0].replace(/^Slide the tiles in this order: /, '').split(', ').map(Number)
      for (const t of order) {
        const [z, i] = [tiles.indexOf(0), tiles.indexOf(t)]
        expect(Math.abs((z % 3) - (i % 3)) + Math.abs(Math.floor(z / 3) - Math.floor(i / 3))).toBe(1)
        ;[tiles[z], tiles[i]] = [t, 0]
      }
      expect(tiles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0])
      expect(order).toHaveLength(value(it0))
      // Nothing shorter: an independent depth-limited search from the start fails one move short
      const start = (it0.visual as { tiles: number[] }).tiles
      const solvable = (t: number[], depth: number, prev: number): boolean => {
        if (t.join() === '1,2,3,4,5,6,7,8,0') return true
        if (!depth) return false
        const z = t.indexOf(0)
        for (const n of [z - 3, z + 3, z % 3 ? z - 1 : -1, z % 3 < 2 ? z + 1 : -1])
          if (n >= 0 && n < 9 && n !== prev) {
            const u = [...t]
            ;[u[z], u[n]] = [u[n], 0]
            if (solvable(u, depth - 1, z)) return true
          }
        return false
      }
      if (value(it0) <= 12) expect(solvable(start, value(it0) - 1, -1)).toBe(false)
    }
  })
})

// ---------- Ratings ----------

describe('ratings', () => {
  it('moves up on a right answer and down on a wrong one, by less as it settles', () => {
    const r = { r: 1200, n: 0 }
    expect(expected(1200, 1200)).toBeCloseTo(0.5)
    expect(updateRating(r, 1200, 1).r).toBeGreaterThan(1200)
    expect(updateRating(r, 1200, 0).r).toBeLessThan(1200)
    expect(updateRating(r, 1200, 1).r - 1200).toBeCloseTo(1200 - updateRating(r, 1200, 0).r)
    expect(kFactor(0)).toBeGreaterThan(kFactor(200))
    expect(kFactor(10_000)).toBe(16)
    // A big upset moves it more than an expected result
    expect(updateRating(r, 1600, 1).r - 1200).toBeGreaterThan(updateRating(r, 800, 1).r - 1200)
  })
  it('targets about three in four right', () => {
    expect(expected(1400, targetDifficulty(1400))).toBeCloseTo(0.75, 2)
  })
  it('settles near a simulated learner’s true level, at about 75% right', () => {
    for (const round of ['speed', 'bits', 'odds', 'logic'] as const) {
      const truth = 1450
      let rating = { r: 1000, n: 0 }
      const r = rng(99)
      let right = 0
      let total = 0
      for (let i = 0; i < 400; i++) {
        const it0 = nextItem(round, rating.r, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, i)
        const ok = r.next() < expected(truth, it0.difficulty)
        rating = updateRating(rating, it0.difficulty, ok ? 1 : 0)
        if (i >= 200) (total++, ok && right++)
      }
      expect(Math.abs(rating.r - truth), round).toBeLessThan(160)
      expect(right / total, round).toBeGreaterThan(0.6)
      expect(right / total, round).toBeLessThan(0.9)
    }
  })
  it('gives each answer set a performance rating', () => {
    expect(performance([{ difficulty: 1200, score: 1 }, { difficulty: 1200, score: 0 }])).toBe(1200)
    expect(performance([{ difficulty: 1000, score: 1 }])).toBe(1400)
    expect(performance([])).toBeNull()
  })
  it('makes the same question from the same seed', () => {
    expect(nextItem('logic', 1300, '2026-11-12', 1).prompt).toBe(nextItem('logic', 1300, '2026-11-12', 1).prompt)
    expect(nextItem('speed', 1300, '2026-11-12', 1).prompt).not.toBe(nextItem('speed', 1300, '2026-11-13', 1).prompt)
  })
})

// ---------- Mornings, titles, streaks, the championship ----------

const at9 = (day: string) => Date.parse(day + 'T09:00:00Z')
const items = (n: number, difficulty: number, rightShare: number): ItemResult[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'k', difficulty, prompt: 'q', given: '', shown: '', right: i < Math.round(n * rightShare), score: i < Math.round(n * rightShare) ? 1 : 0, ms: 3000 }))

function morning(state: WorkoutState, day: string, opts: { difficulty?: number; right?: number; championship?: boolean; id?: string } = {}) {
  let s = state
  const events = []
  for (const r of ROUNDS) {
    const rec: RoundRecord = { id: `${day}-${r.id}`, morning: opts.id ?? `${day}:m`, at: at9(day) + ROUNDS.indexOf(r) * 60_000, day, round: r.id as RoundId, championship: !!opts.championship, items: r.id === 'recall' ? items(3, 1000, 1) : items(r.count, opts.difficulty ?? 1200, opts.right ?? 0.8) }
    const out = applyRound(s, rec)
    s = out.state
    events.push(out.events)
  }
  return { state: s, events }
}

describe('mornings and titles', () => {
  it('a morning is done when all five rounds are, and the first earns a badge', () => {
    const { events } = morning({ prefs: freshPrefs(), rounds: [] }, '2026-03-02')
    expect(events.slice(0, 4).every((e) => !e.morningDone)).toBe(true)
    expect(events[4].morningDone).toBe(true)
    expect(events[4].badges).toContain('first-morning')
  })
  it('titles need both the average rating and the days in a row, and are kept', () => {
    let state: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    // Strong mornings: the rating climbs, but Calculator waits for three days in a row
    const got: string[] = []
    for (let i = 0; i < 6; i++) {
      const out = morning(state, addDays('2026-03-02', i), { difficulty: 1500, right: 0.9 })
      state = out.state
      got.push(...out.events.flatMap((e) => e.titles))
      const days = workoutStreak(state, addDays('2026-03-02', i)).current
      for (const id of got) {
        const t = TITLES.find((x) => x.id === id)!
        expect(days).toBeGreaterThanOrEqual(t.days)
      }
    }
    expect(got).toContain('apprentice')
    expect(currentTitle(state.prefs).index).toBeGreaterThanOrEqual(2)
    // A gap breaks the streak but keeps the titles
    const later = morning(state, '2026-03-20', { difficulty: 900, right: 0.3 })
    expect(currentTitle(later.state.prefs).index).toBe(currentTitle(state.prefs).index)
    expect(nextTitleLine(later.state.prefs, 1)).toMatch(/needs/)
  })
  it('says exactly what the next title needs', () => {
    const p = freshPrefs()
    expect(nextTitleLine(p, 0)).toBe(`Apprentice needs an average rating of 1050 (you’re at ${averageRating(p)}) and full mornings 2 days in a row (you’re on 0).`)
  })
  it('a perfect round earns its badge once', () => {
    const s = { prefs: freshPrefs(), rounds: [] }
    const rec: RoundRecord = { id: 'a', morning: 'm', at: at9('2026-03-02'), day: '2026-03-02', round: 'bits', championship: false, items: items(8, 1000, 1) }
    const one = applyRound(s, rec)
    expect(one.events.badges).toEqual(['perfect-round'])
    expect(applyRound(one.state, { ...rec, id: 'b', morning: 'n' }).events.badges).toEqual([])
  })
  it('streak milestones at 7 days', () => {
    let state: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    let milestone: number | undefined
    for (let i = 0; i < 7; i++) {
      const out = morning(state, addDays('2026-04-01', i))
      state = out.state
      milestone = out.events[4].streakMilestone
    }
    expect(milestone).toBe(7)
    expect(state.prefs.badges['streak-7']).toBeDefined()
  })
})

describe('streaks across days and time zones', () => {
  it('uses the local day each round was saved on', () => {
    // 23:30 in New York on 1 March is 04:30 UTC on 2 March: it counts for 1 March there
    const nyLate = Date.parse('2026-03-02T04:30:00Z')
    expect(dayKey(nyLate, 300)).toBe('2026-03-01')
    expect(dayKey(nyLate, 0)).toBe('2026-03-02')
    // 07:00 in Tokyo on 3 March is 22:00 UTC on 2 March
    const tokyo = Date.parse('2026-03-02T22:00:00Z')
    expect(dayKey(tokyo, -540)).toBe('2026-03-03')
  })
  it('keeps a streak through flying east: days are fixed when saved', () => {
    let state: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    state = morning(state, dayKey(Date.parse('2026-03-02T04:30:00Z'), 300)).state // 1 March in New York
    state = morning(state, dayKey(Date.parse('2026-03-02T22:00:00Z'), -540)).state // 3 March in Tokyo
    expect(workoutStreak(state, '2026-03-03').current).toBe(1)
    state = morning(state, '2026-03-02').state
    expect(workoutStreak(state, '2026-03-03').current).toBe(3)
  })
  it('is still alive until today ends, and broken by a missed day', () => {
    let state: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    for (const d of ['2026-05-01', '2026-05-02', '2026-05-03']) state = morning(state, d).state
    expect(workoutStreak(state, '2026-05-04')).toMatchObject({ current: 3, doneToday: false })
    expect(workoutStreak(state, '2026-05-05').current).toBe(0)
    expect(workoutStreak(state, '2026-05-05').best).toBe(3)
  })
  it('half a morning does not count', () => {
    const s = { prefs: freshPrefs(), rounds: [] }
    const out = applyRound(s, { id: 'x', morning: 'm', at: at9('2026-05-01'), day: '2026-05-01', round: 'speed', championship: false, items: items(5, 1000, 1) })
    expect(workoutStreak(out.state, '2026-05-01').doneToday).toBe(false)
  })
})

describe('the Sunday championship', () => {
  it('knows Sundays', () => {
    expect(isSunday('2026-11-15')).toBe(true)
    expect(isSunday('2026-11-12')).toBe(false)
  })
  it('wins a trophy by beating the best morning this month, and loses otherwise', () => {
    let state: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    state = morning(state, '2026-11-09', { difficulty: 1200, right: 0.75 }).state
    state = morning(state, '2026-11-10', { difficulty: 1250, right: 0.8 }).state
    // October's mornings don't count towards November's bar
    state = morning(state, '2026-10-30', { difficulty: 1900, right: 1, id: 'oct' }).state
    const bar = bestThisMonth(state, '2026-11-15')!
    expect(bar).toBeLessThan(1700)
    const win = morning(state, '2026-11-15', { difficulty: 1400, right: 0.85, championship: true, id: 'champ' })
    const last = win.events[4]
    expect(last.trophy).toMatchObject({ day: '2026-11-15', beat: bar })
    expect(last.badges).toContain('champion')
    expect(win.state.prefs.trophies).toHaveLength(1)
    const lose = morning(state, '2026-11-15', { difficulty: 1000, right: 0.4, championship: true, id: 'champ2' })
    expect(lose.events[4].trophy).toBeUndefined()
    expect(lose.events[4].championshipLost).toMatchObject({ beat: bar })
  })
  it('with no mornings this month, the bar is your average rating', () => {
    const s: WorkoutState = { prefs: freshPrefs(), rounds: [] }
    expect(championshipBar(s, '2026-11-01')).toBe(averageRating(s.prefs))
  })
  it('championship questions sit a step harder', () => {
    let plain = 0
    let champ = 0
    for (let i = 0; i < 200; i++) {
      plain += nextItem('speed', 1300, '2026-11-15', i).difficulty
      champ += nextItem('speed', 1300, '2026-11-15', i, { championship: true }).difficulty
    }
    expect(champ / 200).toBeGreaterThan(plain / 200 + 50)
  })
})

// ---------- Migration from the old mental maths ----------

const session = (day: string, focus: string, right = 20): MathsSession => ({
  id: day + focus,
  at: Date.parse(day + 'T08:00:00Z'),
  day,
  focus,
  answers: Array.from({ length: 20 }, (_, i) => ({ level: focus, prompt: `q${i}`, answer: '1', given: '1', right: i < right, ms: 2000, how: '' }))
})

describe('moving over from mental maths', () => {
  it('starts the speed rating at the ladder’s level, and keeps the days and reminder', () => {
    // Five good sessions on level 1 unlock level 2
    const sessions = Array.from({ length: 6 }, (_, i) => session(addDays('2026-06-01', i), i < 5 ? LEVELS[0].id : LEVELS[1].id))
    const p = migrateFromMaths(sessions, 'morning', 123)
    expect(p.ratings.speed.r).toBe(700 + 50 * 1 + 190)
    expect(p.ratings.bits.r).toBe(1000)
    expect(p.importedDays).toEqual(sessions.map((s) => s.day))
    expect(p.reminder).toBe('morning')
    const state = { prefs: p, rounds: [] }
    expect(workoutStreak(state, '2026-06-07').current).toBe(6)
    // The first workout morning carries the streak on
    expect(workoutStreak(morning(state, '2026-06-07').state, '2026-06-07').current).toBe(7)
  })
  it('with nothing to move, starts fresh', () => {
    const p = migrateFromMaths([], 'off', 1)
    expect(p.ratings.speed.r).toBe(1000)
    expect(p.importedDays).toEqual([])
  })
})

describe('the files in the vault', () => {

  it('moves the old files over on first read, writes new ones, and leaves the old ones alone', async () => {
    const old = [session('2026-06-01', LEVELS[0].id), session('2026-06-02', LEVELS[0].id)]
    const logText = old.map((s) => JSON.stringify(s)).join('\n') + '\n'
    writeFileSync(join(vault, '.tide', 'mental-maths.jsonl'), logText)
    writeFileSync(join(vault, '.tide', 'mental-maths.json'), JSON.stringify({ reminder: 'evening' }))
    const { workoutState, logWorkoutRound } = await import('../src/main/workout')
    const st = await workoutState()
    expect(st.prefs.importedDays).toEqual(['2026-06-01', '2026-06-02'])
    expect(st.prefs.reminder).toBe('evening')
    expect(existsSync(join(vault, '.tide', 'workout.json'))).toBe(true)
    const out = await logWorkoutRound({ morning: 'm1', round: 'speed', championship: false, items: items(5, 1000, 0.8), combo: 4 })
    expect(out.events.ratingAfter).not.toBe(out.events.ratingBefore)
    const again = await workoutState()
    expect(again.rounds).toHaveLength(1)
    expect(again.prefs.ratings.speed.r).toBe(out.state.prefs.ratings.speed.r)
    // The old files are untouched
    expect(readFileSync(join(vault, '.tide', 'mental-maths.jsonl'), 'utf8')).toBe(logText)
    expect(JSON.parse(readFileSync(join(vault, '.tide', 'mental-maths.json'), 'utf8'))).toEqual({ reminder: 'evening' })
    // A second read doesn't migrate again or lose the new rating
    expect((await workoutState()).prefs.ratings.speed.r).toBe(out.state.prefs.ratings.speed.r)
  })
  it('refuses a round that isn’t one', async () => {
    const { logWorkoutRound } = await import('../src/main/workout')
    await expect(logWorkoutRound({ morning: 'x', round: 'nope' as RoundId, championship: false, items: [] })).rejects.toThrow()
  })
})
