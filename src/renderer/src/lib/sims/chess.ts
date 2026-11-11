/**
 * The "chess" simulation: a position (legal moves by chess.js, BSD-2), and a small game-tree
 * search over it, so a lesson on minimax, alpha-beta pruning or evaluation functions can show the
 * tree's size and the move it picks. The spec is plain data; the search needs a chess.js game.
 *
 * The search walks the tree with chess.js's own move generator through its internal move list
 * (_moves, _makeMove, _undoMove, _board): the public moves() writes every move out in algebraic
 * notation, fifty times slower. chess.js is pinned to the version this was written against, and
 * test/sims-chess.test.ts fails if those internals change.
 *   parts: board, square:e4, best, eval, nodes, search, turn, move:N (moves played, from 1)
 */
import type { Chess } from 'chess.js'
import type { PartInfo } from './parts'
import { int, onlyVerbs, pick, text, type Raw, type SimBase } from './specUtil'

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const CHESS_LIMITS = { depth: 4, moves: 40, countMinimax: 3 }

export interface ChessSpec extends SimBase {
  kind: 'chess'
  fen: string
  /** Moves played from the position before it is shown, in algebraic notation */
  moves: string[]
  depth: number
  search: 'minimax' | 'alphabeta'
  /** Which side is at the bottom */
  orientation: 'white' | 'black'
  autoplay: boolean
}

const VERBS = ['move', 'depth', 'undo', 'search']

/** Six space-separated fields, the board as eight ranks of pieces and digits; legality is checked when it is loaded */
export const looksLikeFen = (f: string) => /^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])( \d+ \d+)?$/.test(f.trim())

export function parseChessSpec(raw: Raw, base: SimBase): ChessSpec {
  const fen = typeof raw.fen === 'string' && looksLikeFen(raw.fen) ? raw.fen.trim() : START
  const moves = (Array.isArray(raw.moves) ? raw.moves : typeof raw.moves === 'string' ? raw.moves.split(/\s+/) : [])
    .map((m) => text(m, 10).replace(/^\d+\.+/, ''))
    .filter(Boolean)
    .slice(0, CHESS_LIMITS.moves)
  const spec: ChessSpec = {
    ...base,
    kind: 'chess',
    fen,
    moves,
    depth: int(raw.depth, 2, 1, CHESS_LIMITS.depth),
    search: pick(raw.search ?? raw.algorithm, ['minimax', 'alphabeta'] as const, 'alphabeta', { 'alpha-beta': 'alphabeta', pruning: 'alphabeta', negamax: 'minimax' }),
    orientation: pick(raw.orientation ?? raw.side, ['white', 'black'] as const, 'white'),
    autoplay: raw.autoplay === true
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- Evaluation and search ----------

interface IMove {
  color: 'w' | 'b'
  from: number
  to: number
  piece: string
  captured?: string
  promotion?: string
  flags: number
}

interface Internals {
  _moves(o: { legal: boolean }): IMove[]
  _makeMove(m: IMove): void
  _undoMove(): unknown
  _board: ({ type: string; color: 'w' | 'b' } | undefined)[]
  _turn: 'w' | 'b'
}

const inner = (g: Chess) => g as unknown as Internals

/** Whether this chess.js still has the internals the search walks with */
export function hasInternals(g: Chess): boolean {
  const i = inner(g)
  return typeof i._moves === 'function' && typeof i._makeMove === 'function' && typeof i._undoMove === 'function' && Array.isArray(i._board) && i._board.length === 128
}

export const VALUE: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 }
export const MATE = 100000

/** Material, plus a little for pawns, knights and bishops near the centre: centipawns for the side to move */
export function evaluate(g: Chess): number {
  const i = inner(g)
  let score = 0
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7
      continue
    }
    const p = i._board[sq]
    if (!p) continue
    let v = VALUE[p.type]
    if (p.type === 'p' || p.type === 'n' || p.type === 'b') {
      const file = sq & 15
      const rank = 7 - (sq >> 4)
      v += Math.round((3.5 - Math.max(Math.abs(file - 3.5), Math.abs(rank - 3.5))) * 5)
    }
    score += p.color === i._turn ? v : -v
  }
  return score
}

export const algebraic = (sq: number) => `${'abcdefgh'[sq & 15]}${8 - (sq >> 4)}`

/** Captures first, the most valuable victim first: the order alpha-beta prunes best with */
function ordered(ms: IMove[]): IMove[] {
  return ms
    .map((m, k) => ({ m, k: (m.captured ? 10000 + VALUE[m.captured] * 10 - VALUE[m.piece] : 0) + (m.promotion ? 9000 : 0) - k / 1000 }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m)
}

export interface Searched {
  /** Score for the side to move, in centipawns */
  score: number
  nodes: number
}

/** Plain minimax (as negamax): every node to the given depth */
export function minimax(g: Chess, depth: number, ply = 0, count = { n: 0 }): Searched {
  const i = inner(g)
  count.n++
  const ms = i._moves({ legal: true })
  if (!ms.length) return { score: g.inCheck() ? -MATE + ply : 0, nodes: count.n }
  if (depth === 0) return { score: evaluate(g), nodes: count.n }
  let best = -Infinity
  for (const m of ms) {
    i._makeMove(m)
    const v = -minimax(g, depth - 1, ply + 1, count).score
    i._undoMove()
    if (v > best) best = v
  }
  return { score: best, nodes: count.n }
}

/** Alpha-beta: the same answer as minimax, skipping branches that cannot change it */
export function alphabeta(g: Chess, depth: number, alpha = -Infinity, beta = Infinity, ply = 0, count = { n: 0 }): Searched {
  const i = inner(g)
  count.n++
  const ms = i._moves({ legal: true })
  if (!ms.length) return { score: g.inCheck() ? -MATE + ply : 0, nodes: count.n }
  if (depth === 0) return { score: evaluate(g), nodes: count.n }
  let best = -Infinity
  for (const m of ordered(ms)) {
    i._makeMove(m)
    const v = -alphabeta(g, depth - 1, -beta, -alpha, ply + 1, count).score
    i._undoMove()
    if (v > best) best = v
    if (v > alpha) alpha = v
    if (alpha >= beta) break
  }
  return { score: best, nodes: count.n }
}

export interface RootMove {
  san: string
  from: string
  to: string
  score: number
}

export interface Analysis {
  depth: number
  /** Best first; equal scores keep the order the moves were generated in */
  moves: RootMove[]
  best: RootMove | null
  minimaxNodes: number | null
  alphabetaNodes: number
}

/** Every legal move scored to the depth, and the size of the tree each search walked */
export function analyse(g: Chess, depth: number): Analysis {
  const i = inner(g)
  const verbose = g.moves({ verbose: true })
  const sanOf = (m: IMove) => verbose.find((v) => v.from === algebraic(m.from) && v.to === algebraic(m.to) && (v.promotion ?? '') === (m.promotion ?? ''))?.san ?? `${algebraic(m.from)}${algebraic(m.to)}`
  const moves: RootMove[] = []
  for (const m of i._moves({ legal: true })) {
    i._makeMove(m)
    const v = -alphabeta(g, depth - 1, -Infinity, Infinity, 1).score
    i._undoMove()
    moves.push({ san: sanOf(m), from: algebraic(m.from), to: algebraic(m.to), score: v })
  }
  moves.sort((a, b) => b.score - a.score)
  return {
    depth,
    moves,
    best: moves[0] ?? null,
    minimaxNodes: depth <= CHESS_LIMITS.countMinimax ? minimax(g, depth).nodes : null,
    alphabetaNodes: alphabeta(g, depth).nodes
  }
}

/** A score in words: pawns for the side to move, or a mate in n */
export function scoreText(score: number): string {
  if (Math.abs(score) > MATE - 100) {
    const plies = MATE - Math.abs(score)
    return `${score > 0 ? 'mates' : 'is mated'} in ${Math.ceil(plies / 2)}`
  }
  const pawns = score / 100
  return `${pawns > 0 ? '+' : pawns < 0 ? '−' : ''}${Math.abs(pawns).toFixed(2)}`
}

// ---------- Parts ----------

export type ChessPart = { type: 'board' | 'best' | 'eval' | 'nodes' | 'search' | 'turn' } | { type: 'square'; sq: string } | { type: 'move'; i: number }

export function parseChessPart(name: string, played: number): ChessPart | null {
  const [head, arg] = name.trim().toLowerCase().split(':')
  if (['board', 'best', 'eval', 'nodes', 'search', 'turn'].includes(head) && arg === undefined) return { type: head as 'board' }
  if (head === 'square' && arg && /^[a-h][1-8]$/.test(arg)) return { type: 'square', sq: arg }
  if (head === 'move' && Number.isInteger(Number(arg)) && Number(arg) >= 1 && Number(arg) <= played) return { type: 'move', i: Number(arg) }
  return null
}

const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

export function describeChessPart(part: ChessPart, g: Chess, a: Analysis | null, history: string[], search: 'minimax' | 'alphabeta'): PartInfo {
  const side = g.turn() === 'w' ? 'White' : 'Black'
  switch (part.type) {
    case 'board':
      return { label: 'the position', values: { fen: g.fen(), 'to move': side, 'legal moves': g.moves().length } }
    case 'turn':
      return { label: 'whose move it is', values: { 'to move': side, check: g.inCheck() ? 'yes' : 'no', over: g.isGameOver() ? 'yes' : 'no' } }
    case 'square': {
      const p = g.get(part.sq as Parameters<Chess['get']>[0])
      return { label: `square ${part.sq}`, values: { piece: p ? `${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}` : 'empty', 'moves from here': g.moves({ square: part.sq as Parameters<Chess['get']>[0] }).length } }
    }
    case 'best':
      return { label: `the move the search picks for ${side} at depth ${a?.depth ?? '–'}`, values: a?.best ? { move: a.best.san, score: scoreText(a.best.score), next: a.moves[1] ? `${a.moves[1].san} ${scoreText(a.moves[1].score)}` : 'none' } : { move: 'none: the game is over' } }
    case 'eval':
      return { label: `the evaluation for ${side} (material and centre, in pawns)`, values: { 'static now': scoreText(evaluate(g)), [`after searching ${a?.depth ?? 0} moves`]: a?.best ? scoreText(a.best.score) : '–' } }
    case 'nodes':
    case 'search':
      return {
        label: `positions visited at depth ${a?.depth ?? '–'} (${search === 'alphabeta' ? 'alpha-beta' : 'minimax'} in use)`,
        values: { minimax: a?.minimaxNodes ?? 'too many to count here', 'alpha-beta': a?.alphabetaNodes ?? '–', saved: a?.minimaxNodes ? `${Math.round((1 - a.alphabetaNodes / a.minimaxNodes) * 100)}%` : '–' }
      }
    case 'move':
      return { label: `move ${part.i}: ${history[part.i - 1]}`, values: { by: part.i % 2 ? 'the side that moved first' : 'the other side', move: history[part.i - 1] } }
  }
}
