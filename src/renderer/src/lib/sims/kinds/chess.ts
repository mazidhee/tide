/**
 * A chess position and a small search over it: the learner moves pieces (only legal moves, from
 * chess.js), and beside the board the search shows the move it would pick at the chosen depth,
 * every move's score, and how many positions minimax and alpha-beta each had to visit. Play and
 * Step let the search play the moves itself.
 */
import { Chess, type Square } from 'chess.js'
import { h, num, ring, s, segmented, stat } from '../dom'
import { CHESS_LIMITS, analyse, describeChessPart, hasInternals, parseChessPart, scoreText, type Analysis, type ChessSpec } from '../chess'
import type { SimHost, SimKindDef, SimView } from '../shell'

// Text presentation, never emoji
const GLYPH: Record<string, string> = { k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎' }
const FILES = 'abcdefgh'

function load(spec: ChessSpec): { game: Chess; skipped: string[] } {
  let game: Chess
  try {
    game = new Chess(spec.fen)
  } catch {
    game = new Chess()
  }
  const skipped: string[] = []
  for (const m of spec.moves) {
    try {
      game.move(m)
    } catch {
      skipped.push(m)
    }
  }
  return { game, skipped }
}

function create(spec: ChessSpec, host: SimHost): SimView {
  let { game, skipped } = load(spec)
  let depth = spec.depth
  let search = spec.search
  let picked: Square | null = null
  let marked: string | null = null
  let cache: { key: string; a: Analysis } | null = null
  const usable = hasInternals(game)

  const analysis = (): Analysis | null => {
    if (!usable || game.isGameOver()) return null
    const key = `${game.fen()}|${depth}`
    if (cache?.key !== key) cache = { key, a: analyse(game, depth) }
    return cache.a
  }

  // ---------- Board ----------
  const board = s('svg', { class: 'sim-ch-board', viewBox: '0 0 8 8', role: 'grid', 'aria-label': 'Chess board' })
  const boardBox = h('div', { class: 'sim-ch-boardbox', tabindex: 0 }, board)
  const flip = () => spec.orientation === 'black'
  const at = (file: number, rank: number) => (flip() ? [7 - file, rank - 1] : [file, 8 - rank]) as [number, number]

  board.addEventListener('click', (e) => {
    const r = board.getBoundingClientRect()
    if (!r.width) return
    let file = Math.floor(((e.clientX - r.left) / r.width) * 8)
    let row = Math.floor(((e.clientY - r.top) / r.height) * 8)
    if (flip()) {
      file = 7 - file
      row = 7 - row
    }
    const sq = `${FILES[file]}${8 - row}` as Square
    clickSquare(sq)
  })

  function clickSquare(sq: Square): void {
    const piece = game.get(sq)
    if (picked && picked !== sq) {
      const legal = game.moves({ square: picked, verbose: true }).find((m) => m.to === sq)
      if (legal) {
        game.move({ from: picked, to: sq, promotion: legal.promotion ? 'q' : undefined })
        picked = null
        host.select('best')
        host.invalidate()
        return
      }
    }
    picked = piece && piece.color === game.turn() && picked !== sq ? sq : null
    host.select(`square:${sq}`)
    host.invalidate()
  }

  function paintBoard(a: Analysis | null): void {
    const parts: SVGElement[] = []
    const last = game.history({ verbose: true }).at(-1)
    const targets = picked ? new Set(game.moves({ square: picked, verbose: true }).map((m) => m.to)) : new Set<string>()
    const ringSq = marked?.startsWith('square:') ? marked.slice(7) : null
    for (let rank = 8; rank >= 1; rank--)
      for (let f = 0; f < 8; f++) {
        const sq = `${FILES[f]}${rank}`
        const [x, y] = at(f, rank)
        const light = (f + rank) % 2 === 1
        parts.push(s('rect', { x, y, width: 1, height: 1, class: `sim-ch-sq ${light ? 'light' : 'dark'}${last && (last.from === sq || last.to === sq) ? ' last' : ''}${picked === sq ? ' picked' : ''}` }))
        if (ringSq === sq) parts.push(s('rect', { x: x + 0.04, y: y + 0.04, width: 0.92, height: 0.92, class: 'sim-ch-ring' }))
        // Coordinates on the edge squares
        if (x === 0) parts.push(s('text', { x: 0.06, y: y + 0.2, class: `sim-ch-coord ${light ? 'on-light' : 'on-dark'}` }, String(rank)))
        if (y === 7) parts.push(s('text', { x: x + 0.94, y: 7.94, 'text-anchor': 'end', class: `sim-ch-coord ${light ? 'on-light' : 'on-dark'}` }, FILES[f]))
        const p = game.get(sq as Square)
        if (p) parts.push(s('text', { x: x + 0.5, y: y + 0.8, 'text-anchor': 'middle', class: `sim-ch-piece ${p.color === 'w' ? 'white' : 'black'}` }, GLYPH[p.type]))
        if (targets.has(sq as Square)) parts.push(s('circle', { cx: x + 0.5, cy: y + 0.5, r: p ? 0.44 : 0.14, class: p ? 'sim-ch-take' : 'sim-ch-dot' }))
      }
    // The search's move, as an arrow
    if (a?.best) {
      const [fx, fy] = at(FILES.indexOf(a.best.from[0]), Number(a.best.from[1]))
      const [tx, ty] = at(FILES.indexOf(a.best.to[0]), Number(a.best.to[1]))
      const x1 = fx + 0.5
      const y1 = fy + 0.5
      const x2 = tx + 0.5
      const y2 = ty + 0.5
      const len = Math.hypot(x2 - x1, y2 - y1)
      const ux = (x2 - x1) / len
      const uy = (y2 - y1) / len
      const on = marked === 'best'
      const g = s('g', { class: `sim-ch-arrow${on ? ' on' : ''}` })
      g.append(
        s('line', { x1, y1, x2: x2 - ux * 0.3, y2: y2 - uy * 0.3 }),
        s('path', { d: `M${x2} ${y2}L${x2 - ux * 0.38 - uy * 0.2} ${y2 - uy * 0.38 + ux * 0.2}L${x2 - ux * 0.38 + uy * 0.2} ${y2 - uy * 0.38 - ux * 0.2}Z` })
      )
      parts.push(g)
    }
    board.replaceChildren(...parts)
  }

  // ---------- The search, written out ----------
  const depthField = segmented('Depth (moves ahead)', Array.from({ length: CHESS_LIMITS.depth }, (_, k) => [String(k + 1), String(k + 1)] as const), String(depth), (v) => {
    depth = Number(v)
    host.select('nodes')
    host.invalidate()
  })
  const searchField = segmented('Search', [['minimax', 'Minimax'], ['alphabeta', 'Alpha-beta']] as const, search, (v) => {
    search = v
    host.select('search')
    host.invalidate()
  })
  const stats = { turn: stat('To move'), best: stat('Search picks'), score: stat('Score') }
  const bestBox = h('button', { type: 'button', class: 'sim-part sim-stats sim-ch-stats' }, ...Object.values(stats).map((x) => x.el))
  bestBox.addEventListener('click', () => host.select('best'))

  const bars = { minimax: h('i', { class: 'sim-ch-fill mm' }), alphabeta: h('i', { class: 'sim-ch-fill ab' }) }
  const counts = { minimax: h('span', { class: 'sim-ch-count' }), alphabeta: h('span', { class: 'sim-ch-count' }) }
  const nodesBox = h(
    'button',
    { type: 'button', class: 'sim-part sim-panel sim-ch-nodes' },
    h('div', { class: 'sim-panel-title' }, h('span', null, 'Positions visited')),
    h('div', { class: 'sim-ch-bar' }, h('span', { class: 'sim-ch-name' }, 'Minimax'), h('span', { class: 'sim-ch-track' }, bars.minimax), counts.minimax),
    h('div', { class: 'sim-ch-bar' }, h('span', { class: 'sim-ch-name' }, 'Alpha-beta'), h('span', { class: 'sim-ch-track' }, bars.alphabeta), counts.alphabeta)
  )
  nodesBox.addEventListener('click', () => host.select('nodes'))

  const moveList = h('ol', { class: 'sim-ch-moves' })
  const movesBox = h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Every move, scored')), moveList)
  const says = h('p', { class: 'sim-pl-says' })
  const history = h('p', { class: 'sim-note sim-mono sim-ch-history' })
  const note = h('p', { class: 'sim-note' }, 'Scores are in pawns for the side to move, from material plus a little for central pawns, knights and bishops, looked at the chosen number of moves ahead. Click a piece, then a square, to move.')
  const side = h('div', { class: 'sim-stack' }, h('div', { class: 'sim-params sim-ch-params' }, depthField.el, searchField.el), bestBox, nodesBox, movesBox, says)
  const el = h('div', { class: 'sim-ch' }, h('div', { class: 'sim-two sim-ch-two' }, h('div', { class: 'sim-stack' }, boardBox, history, note), side))

  function draw(): void {
    const a = analysis()
    paintBoard(a)
    depthField.set(String(depth))
    searchField.set(search)
    stats.turn.set(game.turn() === 'w' ? 'White' : 'Black')
    stats.best.set(a?.best?.san ?? '–')
    stats.score.set(a?.best ? scoreText(a.best.score) : '–')
    const mm = a?.minimaxNodes ?? null
    const ab = a?.alphabetaNodes ?? 0
    const top = Math.max(mm ?? ab * 3, ab, 1)
    bars.minimax.style.width = `${((mm ?? top) / top) * 100}%`
    bars.minimax.classList.toggle('unknown', mm === null)
    bars.alphabeta.style.width = `${(ab / top) * 100}%`
    counts.minimax.textContent = mm === null ? 'too many to count here' : num(mm, 0)
    counts.alphabeta.textContent = a ? num(ab, 0) : '–'
    nodesBox.classList.toggle('using-ab', search === 'alphabeta')
    moveList.replaceChildren(
      ...(a?.moves.slice(0, 6).map((m, k) => h('li', { class: k === 0 ? 'top' : '' }, h('span', { class: 'sim-mono' }, m.san), h('span', { class: 'sim-ch-score' }, scoreText(m.score)))) ?? [h('li', null, 'No legal moves.')])
    )
    const over = game.isCheckmate() ? `Checkmate: ${game.turn() === 'w' ? 'Black' : 'White'} wins.` : game.isStalemate() ? 'Stalemate: no legal move, and not in check. A draw.' : game.isDraw() ? 'A draw.' : ''
    says.textContent = !usable
      ? 'The search is unavailable with this version of chess.js.'
      : over ||
        (a && mm
          ? `Looking ${depth} move${depth > 1 ? 's' : ''} ahead, alpha-beta finds the same best score as minimax after visiting ${num(ab, 0)} positions instead of ${num(mm, 0)}: it skips replies that cannot change the choice.`
          : a
            ? `At depth ${depth} plain minimax would visit too many positions to count here; alpha-beta needed ${num(ab, 0)}.`
            : '')
    history.textContent = game.history().length ? game.history().map((m, k) => (k % 2 ? m : `${Math.floor(k / 2) + 1}. ${m}`)).join(' ') : skipped.length ? `Could not play: ${skipped.join(' ')}` : ''
    history.hidden = !history.textContent
    ring(depthField.el, marked === 'nodes' || marked === 'search')
    ring(bestBox, marked === 'best' || marked === 'eval' || marked === 'turn')
    ring(nodesBox, marked === 'nodes' || marked === 'search')
    ring(boardBox, marked === 'board')
  }

  return {
    el,
    step() {
      if (game.isGameOver() || game.history().length >= 200) return
      const a = analysis()
      if (a?.best) game.move(a.best.san)
      picked = null
    },
    stepsPerSecond: () => 1.25,
    done: () => (game.isGameOver() ? (game.isCheckmate() ? 'Checkmate' : 'Game drawn') : game.history().length >= 200 ? 'Stopped after 200 moves' : !usable ? 'No search' : null),
    reset() {
      ;({ game, skipped } = load(spec))
      depth = spec.depth
      search = spec.search
      picked = null
    },
    draw,
    describe(name) {
      const part = parseChessPart(name, game.history().length)
      return part ? describeChessPart(part, game, analysis(), game.history(), search) : null
    },
    highlight(name) {
      marked = name ? name.trim().toLowerCase() : null
      host.invalidate()
    },
    act(action) {
      if (typeof action.move === 'string') {
        try {
          game.move(action.move)
        } catch {
          // An illegal move in a tour is skipped
        }
      }
      if (typeof action.depth === 'number') depth = Math.max(1, Math.min(CHESS_LIMITS.depth, Math.round(action.depth)))
      if (action.search === 'minimax' || action.search === 'alphabeta') search = action.search
      if (action.undo === true) game.undo()
      picked = null
    }
  }
}

export const chessKind: SimKindDef<ChessSpec> = {
  label: 'Chess and game-tree search',
  transport: true,
  autoplay: (spec) => spec.autoplay,
  create
}
