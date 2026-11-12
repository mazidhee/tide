/**
 * Small pixel-art pieces for the morning workout: a 3 × 5 pixel font for banners, sprites drawn
 * from rows of letters, the trophy and the badges. Colours come from the theme's accent (and its
 * lighter and darker shades) plus the Professor's own palette, never a rainbow.
 */
import { useMemo } from 'react'
import { PALETTE } from '@shared/professorArt'

const FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'], G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'], N: ['1001', '1101', '1011', '1001', '1001'], O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'], W: ['10001', '10001', '10101', '11011', '10001'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['110', '001', '010', '100', '111'], '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '110', '001', '110'], '6': ['011', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '110'],
  ' ': ['00', '00', '00', '00', '00'], '-': ['000', '000', '111', '000', '000'], '!': ['1', '1', '1', '0', '1'], '·': ['0', '0', '1', '0', '0'], '%': ['101', '001', '010', '100', '101'], '+': ['000', '010', '111', '010', '000'], "'": ['1', '1', '0', '0', '0']
}

/** Text in the pixel font, `px` screen pixels to a font pixel */
export function PixelText({ text, px = 4, className, title }: { text: string; px?: number; className?: string; title?: string }) {
  const { rects, width } = useMemo(() => {
    let x = 0
    let out = ''
    for (const ch of text.toUpperCase()) {
      const g = FONT[ch] ?? FONT[' ']
      g.forEach((row, y) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '1') out += `<rect x="${x + i}" y="${y}" width="1.02" height="1.02"/>`
      })
      x += g[0].length + 1
    }
    return { rects: out, width: Math.max(1, x - 1) }
  }, [text])
  return (
    <svg className={`px-text${className ? ` ${className}` : ''}`} width={width * px} height={5 * px} viewBox={`0 0 ${width} 5`} shapeRendering="crispEdges" role="img" aria-label={title ?? text}>
      <g fill="currentColor" dangerouslySetInnerHTML={{ __html: rects }} />
    </svg>
  )
}

/**
 * A sprite from rows of letters: A accent, a light accent, D dark accent, and any key of the
 * Professor's palette ('.' is empty). Accent shades are CSS, so every theme tints it.
 */
export function Sprite({ rows, px = 4, className, label }: { rows: string[]; px?: number; className?: string; label?: string }) {
  const html = useMemo(() => {
    let out = ''
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        const v = row[x]
        let end = x + 1
        while (end < row.length && row[end] === v) end++
        if (v !== '.') {
          const fill = v === 'A' ? 'var(--accent)' : v === 'a' ? 'var(--wo-accent-light)' : v === 'D' ? 'var(--wo-accent-dark)' : v === 'i' ? 'var(--ink-muted)' : v === 'l' ? 'var(--line-strong)' : (PALETTE[v] ?? 'var(--ink)')
          out += `<rect x="${x}" y="${y}" width="${end - x + 0.02}" height="1.02" fill="${fill}"/>`
        }
        x = end
      }
    })
    return out
  }, [rows])
  return (
    <svg className={`px-sprite${className ? ` ${className}` : ''}`} width={rows[0].length * px} height={rows.length * px} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  )
}

/** A cup in lamp-light yellow (the Professor's own) on a tweed base */
export const TROPHY = ['.YYYYYYYY.', 'YY.YYYYY.Y', 'Y.YYYYYY.Y', 'Y.YYYYYY.Y', '.YYYYYYYY.', '..YYYYYY..', '...YYYY...', '....YY....', '....YY....', '..jjjjjj..', '..JJJJJJ..']
/** The same cup, not yet won */
export const TROPHY_EMPTY = TROPHY.map((r) => r.replace(/[YjJ]/g, 'l'))

export const BADGE_ART: Record<string, string[]> = {
  // A sunrise
  'first-morning': ['.........', '....a....', '.a.....a.', '...AAA...', '..AAAAA..', '.AAAAAAA.', 'DDDDDDDDD', '.........'],
  // Flames, growing with the streak
  'streak-7': ['....a....', '...aA....', '...AA.a..', '..AAAAA..', '..AADAA..', '..ADDDA..', '...DDD...', '.........'],
  'streak-30': ['...a..a..', '..aA.aA..', '..AAAAA..', '.AAADAAA.', '.AADDDAA.', '.ADDDDDA.', '..DDDDD..', '.........'],
  'streak-100': ['.a..a..a.', '.AaaAaaA.', 'AAAAAAAAA', 'AAADDDAAA', 'AADDDDDAA', 'ADDDDDDDA', '.DDDDDDD.', '.........'],
  // A star
  'perfect-round': ['....A....', '....A....', '...AAA...', 'AAAAaAAAA', '.AAaaaAA.', '..AAAAA..', '.AA...AA.', 'A.......A'],
  // A small cup
  champion: ['.YYYYYYY.', 'Y.YYYYY.Y', '.YYYYYYY.', '..YYYYY..', '...YYY...', '....Y....', '..jjjjj..', '.........']
}
export const lockedArt = (rows: string[]) => rows.map((r) => r.replace(/[^.]/g, 'l'))
