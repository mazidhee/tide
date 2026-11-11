// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { MATE, START, alphabeta, analyse, evaluate, hasInternals, looksLikeFen, minimax, parseChessPart, scoreText, type ChessSpec } from '../src/renderer/src/lib/sims/chess'
import { load, mount } from '../src/renderer/src/lib/sims/runtime'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

describe('chess: the spec', () => {
  it('reads a position and moves; a malformed FEN falls back to the start', () => {
    const spec = parseSim('{"kind":"minimax","fen":"not a fen","moves":"1.e4 e5 2.Nf3","depth":9,"search":"alpha-beta"}') as ChessSpec
    expect(spec).toMatchObject({ kind: 'chess', fen: START, moves: ['e4', 'e5', 'Nf3'], depth: 4, search: 'alphabeta' })
    expect(looksLikeFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')).toBe(true)
    expect(parseChessPart('square:e4', 0)).toEqual({ type: 'square', sq: 'e4' })
    expect(parseChessPart('move:1', 0)).toBeNull()
  })
})

describe('chess: the search', () => {
  it('this chess.js still has the internals the search walks with', () => {
    expect(hasInternals(new Chess())).toBe(true)
  })

  it('counts the tree as perft does, and alpha-beta agrees with minimax while visiting fewer positions', () => {
    const g = new Chess()
    // perft(1) + perft(2) + 1: every position to depth 2 once
    expect(minimax(g, 2).nodes).toBe(1 + 20 + 400)
    const mid = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
    for (const d of [1, 2, 3]) {
      const mm = minimax(mid, d)
      const ab = alphabeta(mid, d)
      expect(ab.score, `depth ${d}`).toBe(mm.score)
      if (d > 1) expect(ab.nodes).toBeLessThan(mm.nodes / 2)
    }
    // The game is left as it was found
    expect(mid.fen()).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
  }, 30000)

  it('finds a mate in one, takes a free queen, and scores material', () => {
    const backRank = analyse(new Chess('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'), 2)
    expect(backRank.best?.san).toBe('Rd8#')
    expect(backRank.best?.score).toBeGreaterThan(MATE - 10)
    expect(scoreText(backRank.best!.score)).toBe('mates in 1')
    const freeQueen = analyse(new Chess('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1'), 1)
    expect(freeQueen.best?.san).toBe('exd5')
    expect(evaluate(new Chess())).toBe(0)
    expect(scoreText(-150)).toBe('−1.50')
  })
})

describe('chess: mounted', () => {
  it('draws the board, moves by clicking, and the search plays a move per step', async () => {
    await load('chess')
    const spec = parseSim('{"kind":"chess","moves":["e4","e5"],"depth":2,"tour":[{"at":"nodes","say":"x","do":{"depth":1}}]}') as ChessSpec
    const sim = mount(spec, (root) => document.body.append(root))
    expect(sim.root.querySelectorAll('.sim-ch-sq')).toHaveLength(64)
    expect(sim.root.querySelectorAll('.sim-ch-piece')).toHaveLength(32)
    expect(sim.root.querySelector('.sim-ch-arrow')).not.toBeNull()
    expect(sim.root.querySelector('.sim-ch-history')?.textContent).toBe('1. e4 e5')
    sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(sim.root.querySelector('.sim-ch-history')?.textContent).toMatch(/^1\. e4 e5 2\. \S+$/)
    sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    expect(sim.root.querySelector('.sim-ch-history')?.textContent).toBe('1. e4 e5')
    sim.destroy()
    sim.root.remove()
  })
})
