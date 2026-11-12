/**
 * Round 4, patterns and logic (part two): puzzles that need several steps held in your head before
 * you answer, the way chess calculation does. Mate in one and mate in two (made and checked by the
 * small rules engine in shared/chessMini), boxes after a run of swaps, Towers of Hanoi, river
 * crossings, water jugs and the sliding 8-puzzle (minimum moves found by breadth-first search).
 */
import { attacked, inCheck, isMate, kingOf, legalMoves, matesInOne, matesInTwo, NAMES, play, san, sq, type Board, type Move } from './chessMini'
import { fmt, placeRight, shuffle, type Piece, type Rng, type WorkoutItem } from './workoutItems'
import type { Tier } from './workoutSpeed'

// ---------- Mate puzzles ----------

const empty = (): Board => Array(64).fill(null)

/** A random position with Black's king hemmed in near an edge and White's attackers about */
function randomPosition(r: Rng, attackers: Piece[], defenders: number): Board | null {
  const b = empty()
  // Black's king on the back rank or an edge file
  const edge = r.next()
  const k = edge < 0.6 ? r.int(0, 7) : edge < 0.8 ? r.int(0, 7) * 8 : r.int(0, 7) * 8 + 7
  b[k] = 'k'
  // Its own pawns in front, making a cage
  const kr = Math.floor(k / 8)
  const kc = k % 8
  for (const dc of shuffle([-1, 0, 1], r).slice(0, r.int(1, 3))) {
    const rr = kr === 0 ? 1 : kr === 7 ? 6 : kr
    const cc = kr === 0 || kr === 7 ? kc + dc : kc === 0 ? 1 : 6
    const rowC = kr === 0 || kr === 7 ? rr : kr + dc
    const s = rowC * 8 + cc
    if (rowC >= 1 && rowC <= 6 && cc >= 0 && cc < 8 && !b[s]) b[s] = 'p'
  }
  const free = () => {
    for (let t = 0; t < 40; t++) {
      const s = r.int(0, 63)
      if (!b[s]) return s
    }
    return -1
  }
  for (let i = 0; i < defenders; i++) {
    const s = free()
    const piece = r.pick(['r', 'b', 'n', 'p'] as Piece[])
    if (s < 0 || (piece === 'p' && (s < 8 || s >= 56))) continue
    b[s] = piece
  }
  const wk = free()
  if (wk < 0) return null
  b[wk] = 'K'
  for (const a of attackers) {
    const s = free()
    if (s < 0) return null
    b[s] = a
  }
  // Legal: kings apart, Black not in check (White is to move), White not in check either
  const [wr, wc] = [Math.floor(wk / 8), wk % 8]
  if (Math.abs(wr - kr) <= 1 && Math.abs(wc - kc) <= 1) return null
  if (inCheck(b, 'b') || inCheck(b, 'w')) return null
  return b
}

const ATTACK_SETS: Piece[][] = [['Q'], ['R', 'R'], ['Q', 'N'], ['R', 'B'], ['Q', 'B'], ['R', 'N'], ['Q', 'R'], ['R', 'N', 'B']]

/** Distinct from-to pairs (a promotion's four pieces count once) */
const keys = (ms: Move[]) => [...new Set(ms.map((m) => `${m.from}-${m.to}`))]

export function makeMateInOne(r: Rng): { board: Board; move: Move } {
  for (;;) {
    const b = randomPosition(r, r.pick(ATTACK_SETS), r.int(0, 2))
    if (!b) continue
    const mates = matesInOne(b)
    if (keys(mates).length !== 1) continue
    // Not a position where nearly every check mates: Black must have some room
    if (legalMoves(b, 'b').length < 2) continue
    return { board: b, move: mates[0] }
  }
}

/** A mate in two with one key move and no mate in one; null if none turned up in the budget */
export function makeMateInTwo(r: Rng, tries = 4000): { board: Board; move: Move } | null {
  for (let t = 0; t < tries; t++) {
    const b = randomPosition(r, r.pick(ATTACK_SETS.slice(1)), r.int(0, 2))
    if (!b) continue
    // Cheap filters first: Black's king must be short of squares
    const k = kingOf(b, 'b')
    const flights = legalMoves(b, 'b').filter((m) => m.from === k).length
    if (flights > 2) continue
    if (matesInOne(b).length) continue
    const keysTwo = keys(matesInTwo(b))
    if (keysTwo.length !== 1) continue
    const [from, to] = keysTwo[0].split('-').map(Number)
    return { board: b, move: { from, to } }
  }
  return null
}

/** Why a mating move mates: the check, the king's squares and who covers each, no capture or block */
export function explainMate(b: Board, m: Move): string[] {
  const after = play(b, m)
  const piece = b[m.from]!.toUpperCase()
  const k = kingOf(after, 'b')
  const steps = [`${san(b, m)}: the ${NAMES[piece]} gives check.`]
  const kr = Math.floor(k / 8)
  const kc = k % 8
  const squares: string[] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const rr = kr + dr
      const cc = kc + dc
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue
      const s = rr * 8 + cc
      const own = after[s]
      if (own && own === own.toLowerCase()) {
        squares.push(`${sq(s)} has Black’s own ${NAMES[own.toUpperCase()]}`)
        continue
      }
      const without = [...after]
      without[k] = null
      const cover = coveredBy(without, s)
      if (cover) squares.push(`${sq(s)} is covered by the ${cover}`)
    }
  if (squares.length) steps.push(`The king can’t step out: ${squares.join('; ')}.`)
  steps.push('No black piece can take the checking piece or step in between.')
  return steps
}

function coveredBy(b: Board, s: number): string {
  for (let i = 0; i < 64; i++) {
    const p = b[i]
    if (!p || p !== p.toUpperCase()) continue
    // This piece alone attacks; the others stay on the board as blockers
    const trial = b.map((x, j) => (j !== i && x && x === x.toUpperCase() ? 'p' : x)) as Board
    if (attacked(trial, s, 'w')) return `${NAMES[p.toUpperCase()]} on ${sq(i)}`
  }
  return ''
}

export function mateItem(r: Rng, two: boolean): WorkoutItem {
  const made = two ? makeMateInTwo(r) : null
  const { board, move } = made ?? makeMateInOne(r)
  const deep = !!made
  const steps: string[] = []
  if (!deep) steps.push(...explainMate(board, move))
  else {
    const first = legalMoves(board, 'w').find((m) => m.from === move.from && m.to === move.to)!
    const after = play(board, first)
    steps.push(`There is no mate at once, so look for a first move after which every Black reply can be mated.`)
    steps.push(`1. ${san(board, first)}${inCheck(after, 'b') ? ': check, which limits Black to the replies below' : ': a quiet move that threatens mate; no reply stops it'}.`)
    const replies = legalMoves(after, 'b')
    const lines = replies.map((rep) => {
      const next = play(after, rep)
      const mate = matesInOne(next)[0]
      return `If 1…${san(after, rep)}, then 2. ${san(next, mate)}`
    })
    const shown = [...new Set(lines)]
    steps.push(...shown.slice(0, 6))
    if (shown.length > 6) steps.push(`…and ${shown.length - 6} more replies, each mated the same way.`)
    steps.push('Any other first move lets Black escape for at least one more move.')
  }
  return {
    round: 'logic',
    kind: deep ? 'logic.mate2' : 'logic.mate1',
    difficulty: deep ? 1700 : 1350,
    prompt: deep ? 'White to move: mate in two. Find the first move.' : 'White to move: mate in one.',
    visual: { type: 'chess', board, toMove: 'w' },
    answer: { type: 'move', from: move.from, to: move.to },
    steps,
    rule: deep ? 'Calculate every reply' : 'Checks first: cover every flight square'
  }
}

/** A move's text for the answer box after the fact */
export const moveText = (b: Board, m: Move) => san(b, m)
export { isMate }

// ---------- Boxes after swaps ----------

const ITEMS = ['coin', 'key', 'ring', 'shell', 'stamp']
type Op = { t: 'swap'; a: number; b: number } | { t: 'rotate' } | { t: 'reverse' }

export function boxesItem(r: Rng, ops: number): WorkoutItem {
  const n = ops > 5 ? 5 : 4
  const boxes = 'ABCDE'.slice(0, n).split('')
  let state = shuffle(ITEMS.slice(0, n), r)
  const start = [...state]
  const steps: string[] = [`Start: ${state.map((x, i) => `${boxes[i]} ${x}`).join(', ')}`]
  const said: string[] = []
  for (let i = 0; i < ops; i++) {
    const pick = r.next()
    const op: Op = pick < 0.7 ? (() => {
      const [a, b] = shuffle(boxes.map((_, j) => j), r)
      return { t: 'swap', a: Math.min(a, b), b: Math.max(a, b) } as Op
    })() : pick < 0.88 ? { t: 'rotate' } : { t: 'reverse' }
    if (op.t === 'swap') {
      ;[state[op.a], state[op.b]] = [state[op.b], state[op.a]]
      said.push(`Swap ${boxes[op.a]} and ${boxes[op.b]}.`)
    } else if (op.t === 'rotate') {
      state = [state[n - 1], ...state.slice(0, n - 1)]
      said.push(`Every item moves one box to the right; the last goes to ${boxes[0]}.`)
    } else {
      state = [...state].reverse()
      said.push('Reverse the order of the boxes’ contents.')
    }
    steps.push(`${said[said.length - 1]} → ${state.map((x, j) => `${boxes[j]} ${x}`).join(', ')}`)
  }
  const ask = r.int(0, n - 1)
  const right = state[ask]
  const placed = placeRight(right, ITEMS.slice(0, n).filter((x) => x !== right), r)
  return {
    round: 'logic',
    kind: 'logic.boxes',
    difficulty: 1050 + ops * 70,
    prompt: `The boxes start as shown. Track the moves in your head, no notes.\n\n${said.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nWhat is in box ${boxes[ask]}?`,
    visual: { type: 'boxes', boxes, items: start },
    answer: { type: 'choice', options: placed.options, correct: placed.correct },
    steps,
    rule: 'Hold the state step by step'
  }
}

// ---------- Towers of Hanoi ----------

export function hanoiMoves(n: number, from = 0, to = 2, via = 1, out: [number, number, number][] = []): [number, number, number][] {
  if (n === 0) return out
  hanoiMoves(n - 1, from, via, to, out)
  out.push([n, from, to])
  hanoiMoves(n - 1, via, to, from, out)
  return out
}

export function hanoiItem(r: Rng): WorkoutItem {
  const n = r.int(4, 7)
  const moves = hanoiMoves(n)
  const PEG = 'ABC'
  if (r.next() < 0.5) {
    const m = r.int(5, moves.length - 1)
    const disc = moves[m - 1][0]
    const tz = Math.log2(m & -m)
    return {
      round: 'logic',
      kind: 'logic.hanoi',
      difficulty: 1400,
      prompt: `Towers of Hanoi with ${n} discs (1 is the smallest), all moved from A to C in the fewest moves (${moves.length}). Which disc moves on move ${m}?`,
      answer: { type: 'number', value: disc },
      steps: [`Disc 1 moves on every odd move; disc 2 on moves 2, 6, 10…; disc k every 2^k moves, starting at 2^(k−1).`, `So the disc is one more than the number of times 2 divides the move number.`, `${m} = ${m / (m & -m)} × 2^${tz}: disc ${tz + 1}.`],
      rule: 'The ruler pattern'
    }
  }
  const m = r.int(6, Math.min(moves.length - 1, 40))
  const pegs: number[][] = [Array.from({ length: n }, (_, i) => n - i), [], []]
  const shown: string[] = []
  const show = () => pegs.map((p, i) => `${PEG[i]}: ${p.join(' ') || '–'}`).join('  |  ')
  for (let i = 0; i < m; i++) {
    const [disc, f, t] = moves[i]
    pegs[f].pop()
    pegs[t].push(disc)
    const half = 2 ** (n - 1)
    if (i + 1 === m || (i + 1) % 4 === 0 || i + 1 === half) shown.push(`After move ${i + 1} (disc ${disc} ${PEG[f]}→${PEG[t]}): ${show()}`)
  }
  return {
    round: 'logic',
    kind: 'logic.hanoi',
    difficulty: 1550,
    prompt: `Towers of Hanoi with ${n} discs, moved from A to C in the fewest moves. After move ${m}, how many discs are on peg C?`,
    answer: { type: 'number', value: pegs[2].length },
    steps: [`With ${n} discs the smallest disc cycles ${n % 2 ? 'A → C → B → A' : 'A → B → C → A'}, and every even move is the only other legal move.`, ...shown],
    rule: 'Simulate, using the smallest disc’s cycle'
  }
}

// ---------- River crossing ----------

/** Fewest crossings to ferry n missionaries and n cannibals across with a boat of `boat`; null if impossible */
export function crossings(n: number, boat: number): { count: number; path: string[] } | null {
  type S = [number, number, number] // missionaries and cannibals on the start bank, boat side (0 start)
  const key = (s: S) => s.join(',')
  const safe = (m: number, c: number) => (m === 0 || m >= c) && (n - m === 0 || n - m >= n - c)
  const start: S = [n, n, 0]
  const prev = new Map<string, { from: string; m: number; c: number } | null>([[key(start), null]])
  const queue: S[] = [start]
  while (queue.length) {
    const s = queue.shift()!
    if (s[0] === 0 && s[1] === 0 && s[2] === 1) {
      const path: string[] = []
      let k = key(s)
      while (prev.get(k)) {
        const p = prev.get(k)!
        const [m, c, side] = k.split(',').map(Number)
        path.unshift(`${p.m ? `${p.m} missionar${p.m === 1 ? 'y' : 'ies'}` : ''}${p.m && p.c ? ' and ' : ''}${p.c ? `${p.c} cannibal${p.c === 1 ? '' : 's'}` : ''} cross ${side ? '→' : '←'}   (start bank: ${m}M ${c}C)`)
        k = p.from
      }
      return { count: path.length, path }
    }
    for (let m = 0; m <= boat; m++)
      for (let c = 0; c + m <= boat; c++) {
        if (m + c === 0 || (m > 0 && m < c)) continue
        const dir = s[2] === 0 ? -1 : 1
        const nm = s[0] + dir * m
        const nc = s[1] + dir * c
        if (nm < 0 || nc < 0 || nm > n || nc > n || !safe(nm, nc)) continue
        const next: S = [nm, nc, 1 - s[2]]
        if (prev.has(key(next))) continue
        prev.set(key(next), { from: key(s), m, c })
        queue.push(next)
      }
  }
  return null
}

export function riverItem(r: Rng): WorkoutItem {
  const [n, boat] = r.pick([[2, 2], [3, 2], [4, 3], [5, 3], [3, 3]] as [number, number][])
  const sol = crossings(n, boat)!
  return {
    round: 'logic',
    kind: 'logic.river',
    difficulty: 1550,
    prompt: `${n} missionaries and ${n} cannibals must cross a river. The boat holds at most ${boat} and needs at least one person to row. Cannibals may never outnumber missionaries on either bank, or in the boat, wherever missionaries are present. What is the fewest crossings (each way counts as one)?`,
    answer: { type: 'number', value: sol.count },
    steps: [`Search every safe state, nearest first; the first time everyone is across is the minimum.`, ...sol.path.map((p, i) => `${i + 1}. ${p}`)],
    rule: 'Search the states, nearest first'
  }
}

// ---------- Water jugs ----------

export function jugs(a: number, b: number, target: number): { count: number; path: string[] } | null {
  const key = (x: number, y: number) => `${x},${y}`
  const prev = new Map<string, { from: string; what: string } | null>([[key(0, 0), null]])
  const queue: [number, number][] = [[0, 0]]
  while (queue.length) {
    const [x, y] = queue.shift()!
    if (x === target || y === target) {
      const path: string[] = []
      let k = key(x, y)
      while (prev.get(k)) {
        const p = prev.get(k)!
        path.unshift(`${p.what} → (${k.replace(',', ', ')})`)
        k = p.from
      }
      return { count: path.length, path }
    }
    const pourAB = Math.min(x, b - y)
    const pourBA = Math.min(y, a - x)
    const next: [number, number, string][] = [
      [a, y, `Fill the ${a} L jug`],
      [x, b, `Fill the ${b} L jug`],
      [0, y, `Empty the ${a} L jug`],
      [x, 0, `Empty the ${b} L jug`],
      [x - pourAB, y + pourAB, `Pour ${a} L into ${b} L`],
      [x + pourBA, y - pourBA, `Pour ${b} L into ${a} L`]
    ]
    for (const [nx, ny, what] of next) {
      if (prev.has(key(nx, ny))) continue
      prev.set(key(nx, ny), { from: key(x, y), what })
      queue.push([nx, ny])
    }
  }
  return null
}

export function jugsItem(r: Rng): WorkoutItem {
  for (;;) {
    const a = r.int(3, 9)
    const b = r.int(a + 2, 13)
    const t = r.int(1, b - 1)
    if (t === a) continue
    const sol = jugs(a, b, t)
    if (!sol || sol.count < 4) continue
    return {
      round: 'logic',
      kind: 'logic.jugs',
      difficulty: 1250 + sol.count * 30,
      prompt: `You have a ${a}-litre jug and a ${b}-litre jug, both empty, and a tap. Each fill, empty or pour (until one jug is empty or the other full) is one step. What is the fewest steps to have exactly ${t} litres in one jug?`,
      answer: { type: 'number', value: sol.count },
      steps: ['(Contents of the two jugs after each step)', ...sol.path.map((p, i) => `${i + 1}. ${p}`)],
      rule: 'Search the states, nearest first'
    }
  }
}

// ---------- Sliding 8-puzzle ----------

const GOAL = [1, 2, 3, 4, 5, 6, 7, 8, 0]

/** Fewest slides from tiles to the goal (0 is the gap), with each tile moved */
export function slideSolve(tiles: number[]): { count: number; path: number[] } {
  const key = (t: number[]) => t.join('')
  const goal = key(GOAL)
  const prev = new Map<string, { from: string; tile: number } | null>([[key(tiles), null]])
  const queue: number[][] = [tiles]
  for (let qi = 0; qi < queue.length; qi++) {
    const t = queue[qi]
    const k = key(t)
    if (k === goal) {
      const path: number[] = []
      let c = k
      while (prev.get(c)) {
        path.unshift(prev.get(c)!.tile)
        c = prev.get(c)!.from
      }
      return { count: path.length, path }
    }
    const z = t.indexOf(0)
    const [zr, zc] = [Math.floor(z / 3), z % 3]
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = zr + dr
      const cc = zc + dc
      if (rr < 0 || rr > 2 || cc < 0 || cc > 2) continue
      const s = rr * 3 + cc
      const n = [...t]
      n[z] = n[s]
      n[s] = 0
      const nk = key(n)
      if (prev.has(nk)) continue
      prev.set(nk, { from: k, tile: t[s] })
      queue.push(n)
    }
  }
  return { count: -1, path: [] }
}

export function slideItem(r: Rng, depth: number): WorkoutItem {
  for (;;) {
    const t = [...GOAL]
    let last = -1
    for (let i = 0; i < depth; i++) {
      const z = t.indexOf(0)
      const opts = [z - 3, z + 3, z % 3 ? z - 1 : -1, z % 3 < 2 ? z + 1 : -1].filter((s) => s >= 0 && s < 9 && s !== last)
      const s = r.pick(opts)
      t[z] = t[s]
      t[s] = 0
      last = z
    }
    const sol = slideSolve(t)
    if (sol.count < Math.max(3, depth - 4)) continue
    return {
      round: 'logic',
      kind: 'logic.slide',
      difficulty: 1150 + sol.count * 45,
      prompt: 'Slide tiles into the gap to reach 1 2 3 / 4 5 6 / 7 8 with the gap last. What is the fewest slides?',
      visual: { type: 'slide', tiles: t },
      answer: { type: 'number', value: sol.count },
      steps: [`Slide the tiles in this order: ${sol.path.join(', ')}`, `That is ${sol.count} slides; a breadth-first search of every position confirms nothing shorter works.`],
      rule: 'Plan the whole path before moving'
    }
  }
}

export const DEPTH_TIERS: Tier[] = [
  { id: 'boxes4', title: 'Boxes after swaps', difficulty: 1330, make: (r) => boxesItem(r, 4) },
  { id: 'mate1', title: 'Mate in one', difficulty: 1350, make: (r) => mateItem(r, false) },
  { id: 'slide', title: 'Sliding puzzle', difficulty: 1450, make: (r) => slideItem(r, r.int(6, 10)) },
  { id: 'hanoi', title: 'Towers of Hanoi', difficulty: 1480, make: (r) => hanoiItem(r) },
  { id: 'jugs', title: 'Water jugs', difficulty: 1450, make: (r) => jugsItem(r) },
  { id: 'boxes7', title: 'Boxes after swaps', difficulty: 1540, make: (r) => boxesItem(r, 7) },
  { id: 'river', title: 'River crossing', difficulty: 1550, make: (r) => riverItem(r) },
  { id: 'mate2', title: 'Mate in two', difficulty: 1700, make: (r) => mateItem(r, true) }
]

export { fmt }
