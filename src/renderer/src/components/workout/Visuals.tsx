/**
 * The pictures some workout items come with: a matrix cell drawn as SVG, a chess board you move on
 * by clicking, the sliding puzzle, the boxes and a code listing. Theme tokens only.
 */
import { useId, useMemo, useState } from 'react'
import type { MatrixCell, Piece } from '@shared/workoutItems'
import { legalMoves, type Board } from '@shared/chessMini'

const LAYOUT: [number, number][][] = [
  [],
  [[50, 50]],
  [[31, 50], [69, 50]],
  [[50, 30], [30, 68], [70, 68]],
  [[32, 32], [68, 32], [32, 68], [68, 68]],
  [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]]
]
const SIZE = [0, 17, 13, 12, 11, 9]
const LINES: [number, number, number, number][] = [
  [10, 10, 90, 10],
  [90, 10, 90, 90],
  [10, 90, 90, 90],
  [10, 10, 10, 90],
  [10, 10, 90, 90],
  [10, 90, 90, 10]
]

function shapePath(shape: MatrixCell["shape"], s: number): string {
  switch (shape) {
    case 'circle':
      return `M ${-s} 0 a ${s} ${s} 0 1 0 ${2 * s} 0 a ${s} ${s} 0 1 0 ${-2 * s} 0 Z`
    case 'square':
      return `M ${-s * 0.88} ${-s * 0.88} H ${s * 0.88} V ${s * 0.88} H ${-s * 0.88} Z`
    case 'triangle':
      return `M 0 ${-s} L ${s} ${s * 0.8} L ${-s} ${s * 0.8} Z`
    case 'arrow':
      return `M 0 ${-s} L ${s} ${-s * 0.05} L ${s * 0.38} ${-s * 0.05} L ${s * 0.38} ${s} L ${-s * 0.38} ${s} L ${-s * 0.38} ${-s * 0.05} L ${-s} ${-s * 0.05} Z`
    case 'semi':
      return `M ${-s} ${s * 0.45} A ${s} ${s} 0 0 1 ${s} ${s * 0.45} Z`
  }
}

/** One matrix cell; `size` in screen pixels */
export function MatrixCellSvg({ cell, size = 92 }: { cell: MatrixCell; size?: number }) {
  const id = useId().replace(/:/g, '')
  const s = SIZE[cell.count] ?? 9
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="wo-cell-svg" aria-hidden="true">
      <defs>
        <pattern id={`h${id}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <rect width="2.2" height="5" fill="var(--ink)" />
        </pattern>
      </defs>
      {LINES.map(([x1, y1, x2, y2], i) => (cell.lines & (1 << i) ? <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-muted)" strokeWidth={2.4} strokeLinecap="round" /> : null))}
      {(LAYOUT[cell.count] ?? []).map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${cell.rot})`}>
          {cell.fill !== 'solid' && <path d={shapePath(cell.shape, s)} fill="var(--bg-raised)" />}
          <path d={shapePath(cell.shape, s)} fill={cell.fill === 'solid' ? 'var(--ink)' : cell.fill === 'striped' ? `url(#h${id})` : 'none'} stroke="var(--ink)" strokeWidth={cell.fill === 'solid' ? 0 : 2.6} strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  )
}

/** Chess pieces as pixel sprites (fonts draw the chess symbols unreliably): '#' is the body; the outline is worked out */
const PIECES: Record<string, string[]> = {
  k: ['.....##.....', '....####....', '.....##.....', '..##.##.##..', '.##########.', '.##########.', '..########..', '...######...', '....####....', '...######...', '..########..', '............'],
  q: ['.#...##...#.', '.##..##..##.', '..##.##.##..', '..########..', '...######...', '....####....', '....####....', '....####....', '...######...', '..########..', '..########..', '............'],
  r: ['............', '..##.##.##..', '..########..', '...######...', '....####....', '....####....', '....####....', '....####....', '...######...', '..########..', '..########..', '............'],
  b: ['............', '.....##.....', '....####....', '...##.###...', '...#.####...', '...######...', '....####....', '.....##.....', '....####....', '..########..', '..########..', '............'],
  n: ['............', '....##......', '...#####....', '..#######...', '.####.###...', '.##..####...', '.....####...', '....#####...', '...######...', '..########..', '..########..', '............'],
  p: ['............', '............', '.....##.....', '....####....', '....####....', '.....##.....', '....####....', '.....##.....', '....####....', '...######...', '..########..', '............']
}
const pieceSvg = new Map<string, string>()
function pieceRects(kind: string, white: boolean): string {
  const key = kind + white
  const had = pieceSvg.get(key)
  if (had) return had
  const rows = PIECES[kind]
  const body = (x: number, y: number) => rows[y]?.[x] === '#'
  const fill = white ? '#f4f1ea' : '#1d1a17'
  const edge = white ? '#1d1a17' : 'rgba(244, 241, 234, 0.7)'
  let out = ''
  for (let y = -1; y <= rows.length; y++)
    for (let x = -1; x <= rows[0].length; x++) {
      if (body(x, y)) out += `<rect x="${x + 1}" y="${y + 1}" width="1.02" height="1.02" fill="${fill}"/>`
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => body(x + dx, y + dy))) out += `<rect x="${x + 1}" y="${y + 1}" width="1.02" height="1.02" fill="${edge}"/>`
    }
  pieceSvg.set(key, out)
  return out
}
function PieceSprite({ piece }: { piece: Piece }) {
  const white = piece === piece.toUpperCase()
  return (
    <svg className="wo-pc" width="38" height="38" viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
      <g dangerouslySetInnerHTML={{ __html: pieceRects(piece.toLowerCase(), white) }} />
    </svg>
  )
}

/** A board you answer on: click a white piece, then where it goes */
export function ChessBoard({ board, onMove, done, answer, picked }: { board: (Piece | null)[]; onMove?(from: number, to: number): void; done?: boolean; answer?: { from: number; to: number }; picked?: { from: number; to: number } }) {
  const [sel, setSel] = useState<number | null>(null)
  const legal = useMemo(() => legalMoves(board as Board, 'w'), [board])
  const targets = new Set(sel === null ? [] : legal.filter((m) => m.from === sel).map((m) => m.to))
  const click = (i: number) => {
    if (done) return
    const p = board[i]
    if (p && p === p.toUpperCase()) return setSel(sel === i ? null : i)
    if (sel !== null && targets.has(i)) {
      onMove?.(sel, i)
      setSel(null)
    }
  }
  return (
    <div className="wo-board" role="grid" aria-label="Chess board, White to move">
      {board.map((p, i) => {
        const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1
        const mark = answer && (i === answer.from || i === answer.to) ? ' answer' : picked && (i === picked.from || i === picked.to) ? ' picked' : ''
        return (
          <button key={i} type="button" className={`wo-sq${dark ? ' dark' : ''}${sel === i ? ' sel' : ''}${mark}`} onClick={() => click(i)} aria-label={`${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}${p ? ` ${p === p.toUpperCase() ? 'white' : 'black'} ${({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' } as Record<string, string>)[p.toLowerCase()]}` : ''}`}>
            {p && <PieceSprite piece={p} />}
            {targets.has(i) && <i className="wo-dot" />}
            {i % 8 === 0 && <small className="wo-rank">{8 - Math.floor(i / 8)}</small>}
            {i >= 56 && <small className="wo-file">{'abcdefgh'[i % 8]}</small>}
          </button>
        )
      })}
    </div>
  )
}

export function SlideGrid({ tiles }: { tiles: number[] }) {
  return (
    <div className="wo-slide" aria-label={`Tiles: ${tiles.map((t) => t || 'gap').join(', ')}`}>
      {tiles.map((t, i) => (
        <span key={i} className={t ? '' : 'gap'}>
          {t || ''}
        </span>
      ))}
    </div>
  )
}

export function Boxes({ boxes, items }: { boxes: string[]; items: string[] }) {
  return (
    <div className="wo-boxes">
      {boxes.map((b, i) => (
        <div key={b} className="wo-box">
          <b>{b}</b>
          <span>{items[i]}</span>
        </div>
      ))}
    </div>
  )
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="wo-code">
      <code>{code}</code>
    </pre>
  )
}
