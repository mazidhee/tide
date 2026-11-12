/**
 * A small chess rules engine for the workout's mate puzzles: legal moves (no castling or en
 * passant: the puzzles never need them), check, mate, and a mate-in-one and mate-in-two search.
 * Squares are 0 (a8) to 63 (h1); upper case is White.
 */
import type { Piece } from './workoutItems'

export type Board = (Piece | null)[]
export type Side = 'w' | 'b'
export interface Move {
  from: number
  to: number
  promo?: Piece
}

const isWhite = (p: Piece) => p === p.toUpperCase()
const sideOf = (p: Piece): Side => (isWhite(p) ? 'w' : 'b')
const rc = (i: number) => [Math.floor(i / 8), i % 8] as const
const idx = (r: number, c: number) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1)

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]]

/** Whether `by` attacks square sq */
export function attacked(b: Board, sq: number, by: Side): boolean {
  const [r, c] = rc(sq)
  const own = (p: Piece | null, kinds: string) => !!p && sideOf(p) === by && kinds.includes(p.toUpperCase())
  for (const [dr, dc] of KNIGHT) if (own(b[idx(r + dr, c + dc)] ?? null, 'N')) return true
  for (const [dr, dc] of KING) if (own(b[idx(r + dr, c + dc)] ?? null, 'K')) return true
  // Pawns attack diagonally forward: a white pawn sits below the square it attacks
  const pr = by === 'w' ? r + 1 : r - 1
  for (const dc of [-1, 1]) if (own(b[idx(pr, c + dc)] ?? null, 'P')) return true
  for (const [dirs, kinds] of [[ROOK, 'RQ'], [BISHOP, 'BQ']] as const)
    for (const [dr, dc] of dirs) {
      let rr = r + dr
      let cc = c + dc
      while (idx(rr, cc) >= 0) {
        const p = b[idx(rr, cc)]
        if (p) {
          if (own(p, kinds)) return true
          break
        }
        rr += dr
        cc += dc
      }
    }
  return false
}

export const kingOf = (b: Board, side: Side) => b.indexOf(side === 'w' ? 'K' : 'k')
export const inCheck = (b: Board, side: Side) => attacked(b, kingOf(b, side), side === 'w' ? 'b' : 'w')

export function play(b: Board, m: Move): Board {
  const next = [...b]
  next[m.to] = m.promo ?? next[m.from]
  next[m.from] = null
  return next
}

function pseudo(b: Board, side: Side): Move[] {
  const out: Move[] = []
  for (let i = 0; i < 64; i++) {
    const p = b[i]
    if (!p || sideOf(p) !== side) continue
    const [r, c] = rc(i)
    const add = (to: number) => {
      if (to < 0) return false
      const q = b[to]
      if (q && sideOf(q) === side) return false
      out.push({ from: i, to })
      return !q
    }
    const kind = p.toUpperCase()
    if (kind === 'N') for (const [dr, dc] of KNIGHT) add(idx(r + dr, c + dc))
    else if (kind === 'K') for (const [dr, dc] of KING) add(idx(r + dr, c + dc))
    else if (kind === 'P') {
      const dir = side === 'w' ? -1 : 1
      const last = side === 'w' ? 0 : 7
      const home = side === 'w' ? 6 : 1
      const push = (to: number) => {
        if (Math.floor(to / 8) === last) for (const k of 'QRBN') out.push({ from: i, to, promo: (side === 'w' ? k : k.toLowerCase()) as Piece })
        else out.push({ from: i, to })
      }
      const one = idx(r + dir, c)
      if (one >= 0 && !b[one]) {
        push(one)
        const two = idx(r + 2 * dir, c)
        if (r === home && two >= 0 && !b[two]) out.push({ from: i, to: two })
      }
      for (const dc of [-1, 1]) {
        const t = idx(r + dir, c + dc)
        const q = t >= 0 ? b[t] : null
        if (q && sideOf(q) !== side) push(t)
      }
    } else {
      const dirs = kind === 'R' ? ROOK : kind === 'B' ? BISHOP : [...ROOK, ...BISHOP]
      for (const [dr, dc] of dirs) {
        let rr = r + dr
        let cc = c + dc
        while (idx(rr, cc) >= 0 && add(idx(rr, cc))) {
          rr += dr
          cc += dc
        }
      }
    }
  }
  return out
}

export const legalMoves = (b: Board, side: Side): Move[] => pseudo(b, side).filter((m) => !inCheck(play(b, m), side))

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')
export const isMate = (b: Board, side: Side) => inCheck(b, side) && legalMoves(b, side).length === 0

/** White's moves that mate at once */
export const matesInOne = (b: Board): Move[] => legalMoves(b, 'w').filter((m) => isMate(play(b, m), 'b'))

/**
 * White's first moves that force mate next move: every Black reply leaves a mate in one (and
 * Black has a reply: stalemate isn't mate). Moves that mate at once are left out.
 */
export function matesInTwo(b: Board): Move[] {
  const out: Move[] = []
  for (const m of legalMoves(b, 'w')) {
    const after = play(b, m)
    const replies = legalMoves(after, 'b')
    if (!replies.length) continue
    if (replies.every((rep) => matesInOne(play(after, rep)).length > 0)) out.push(m)
  }
  return out
}

const FILES = 'abcdefgh'
export const sq = (i: number) => FILES[i % 8] + String(8 - Math.floor(i / 8))

/** Standard notation for a move in this position, with + or # */
export function san(b: Board, m: Move): string {
  const p = b[m.from]!
  const side = sideOf(p)
  const kind = p.toUpperCase()
  const capture = !!b[m.to]
  let s = ''
  if (kind === 'P') s = (capture ? `${FILES[m.from % 8]}x` : '') + sq(m.to) + (m.promo ? `=${m.promo.toUpperCase()}` : '')
  else {
    const rivals = legalMoves(b, side).filter((o) => o.to === m.to && o.from !== m.from && b[o.from] === p)
    const dis = rivals.length ? (rivals.some((o) => o.from % 8 === m.from % 8) ? sq(m.from)[1] : FILES[m.from % 8]) : ''
    s = kind + dis + (capture ? 'x' : '') + sq(m.to)
  }
  const after = play(b, m)
  const them = other(side)
  return s + (isMate(after, them) ? '#' : inCheck(after, them) ? '+' : '')
}

export const NAMES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }
