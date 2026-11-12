/**
 * Tide's tutor as pixel art: round spectacles, white tufts and moustache, a tweed jacket and a red
 * bow tie. Shared by the app (drawn as SVG) and the menu bar (drawn as a bitmap), so he looks the
 * same everywhere.
 *
 * Moods are 16 x 16 and act out what the tutor is doing (thinking, reading, writing, happy).
 * Scenes are 24 x 16, with something beside him, for the quieter moments:
 * - tea: sipping, steam rising (while it's your turn)
 * - board: writing on a chalkboard (teaching)
 * - fishing: a float bobbing on the water (breaks, nothing due)
 * - chess: moving a piece (quizzes and exams)
 * - party: a party hat on, dancing, an arm up (the morning workout's celebrations)
 */
import type { CharacterId } from './characters'

export type ProfessorState = 'idle' | 'thinking' | 'reading' | 'writing' | 'happy'
export type ProfessorScene = 'tea' | 'board' | 'fishing' | 'chess' | 'book' | 'laptop' | 'cards' | 'stopwatch' | 'telescope' | 'eureka' | 'sleep' | 'wave' | 'party'
export type ProfessorPose = ProfessorState | ProfessorScene

export const SCENES: ProfessorScene[] = ['tea', 'board', 'fishing', 'chess', 'book', 'laptop', 'cards', 'stopwatch', 'telescope', 'eureka', 'sleep', 'wave', 'party']
export const isScene = (p: ProfessorPose): p is ProfessorScene => (SCENES as string[]).includes(p)

export const PALETTE: Record<string, string> = {
  s: '#e3b48f', // skin
  S: '#c9946d', // skin shade (hand, ears)
  h: '#ece8e1', // white hair
  m: '#ece8e1', // moustache
  k: '#2a2622', // spectacle rims
  w: '#d6e7ef', // lens
  p: '#1b1815', // pupil
  c: '#f3efe7', // collar
  j: '#7a5b3d', // tweed
  J: '#5f4630', // tweed shade
  t: '#b8433a', // bow tie
  o: '#8b8681', // thought bubble, steam
  u: '#f4f1ea', // teacup
  e: '#8a5a2b', // tea
  f: '#7a5638', // wood (board frame, rod, table)
  g: '#2f4a3a', // chalkboard
  x: '#e9e6dc', // chalk
  b: '#3f6f9e', // water
  B: '#5b8fbf', // ripple
  r: '#d2453c', // float
  q: '#e8dcc0', // light square
  Q: '#8c6a48', // dark square
  K: '#1d1a17', // black piece
  W: '#fbf8f1', // white piece
  Y: '#f2c94c' // lamp light, stars, the bulb
}

/**
 * Each character's face: the left half (the right mirrors it), colours that differ from the
 * shared palette, and the colour an eye takes when closed (a lens for the Professor, skin for
 * the others). Every pose and scene works for every face: eyes sit at rows 6-7, columns 4-5 and
 * 10-11, the mouth on row 11.
 */
interface Face {
  half: string[]
  palette?: Record<string, string>
  lid: string
  /** Skin around the mouth, for talking */
  cheek: string
}

const FACES: Record<CharacterId, Face> = {
  professor: {
    half: [
      '........',
      '.....sss',
      '....ssss',
      '..hhssss',
      '.hhhssss',
      '.hhkkkks',
      '.Shkwwks',
      '..skwwks',
      '...kkkkk',
      '....ssss',
      '....smmm',
      '.....smm',
      '....cccc',
      '...jjjct',
      '..Jjjjjt',
      '..JJjjjj'
    ],
    lid: 'w',
    cheek: 's'
  },
  ada: {
    half: [
      '...HHHHH',
      '..HHHHHH',
      '.HHHHHHH',
      '.HHHHHss',
      '.HHHssss',
      '.HHskkss',
      '.HHswwss',
      '.HHswwss',
      '.HHsssss',
      '.HHSssss',
      '..Hsssss',
      '...ssssm',
      '....ssss',
      '..dnnnnn',
      '.dNnnnnn',
      '.NNnnnnn'
    ],
    palette: { s: '#c98e6b', S: '#a8714f', H: '#2b2320', m: '#a5524a', n: '#2f8f8a', N: '#23706c', d: '#3a3d44', j: '#2f8f8a', J: '#23706c', w: '#f4f1ea' },
    lid: 's',
    cheek: 's'
  },
  coach: {
    half: [
      '........',
      '...RRRRR',
      '..RRRRRR',
      '.RRRRRRR',
      'RRRRRRRR',
      '..sskkss',
      '..sswwss',
      '..sswwss',
      '..ssssss',
      '..Sssss',
      '..sBBBBB',
      '...BBBBm',
      '....BBss',
      '..nnnnny',
      '.Nnnnnny',
      '.NNnnnnn'
    ].map((r) => r.padEnd(8, 's')),
    palette: { s: '#8d5a3b', S: '#734630', R: '#c8463b', B: '#3b2a20', m: '#5a2c22', n: '#283a6b', N: '#1e2c52', y: '#e8e2d0', j: '#283a6b', J: '#1e2c52', w: '#f4f1ea' },
    lid: 's',
    cheek: 'B'
  },
  owl: {
    half: [
      '.F......',
      '.FF.....',
      '.FFFFFFF',
      '.FFFFFFF',
      'FFFFFFFF',
      'FFFYYYYF',
      'FFFwwwYF',
      'FFFwwwYF',
      'FFFYYYYO',
      'FFFFFFFO',
      'FFLLLLLL',
      'FLLLLLLL',
      'FLLLLLLL',
      'FFLLLLLL',
      'FFFLLLLL',
      '.FFFLLLL'
    ],
    palette: { F: '#7b5a3a', L: '#d9c19a', Y: '#e8b84a', O: '#e08a2e', w: '#fbf6e9', S: '#6a4c30', j: '#7b5a3a', J: '#5e4329' },
    lid: 'Y',
    cheek: 'L'
  }
}

const mirror = (row: string) => row + [...row].reverse().join('')
const faceRows = (id: CharacterId) => FACES[id].half.map(mirror)

/** The colours for a character: the shared palette with their own on top */
export const paletteFor = (id: CharacterId = 'professor'): Record<string, string> => ({ ...PALETTE, ...(FACES[id].palette ?? {}) })

export type Grid = string[][]
let face: CharacterId = 'professor'
const grid = (width: number): Grid => faceRows(face).map((r) => (r + '.'.repeat(width - 16)).split(''))
const set = (g: Grid, r: number, c: number, v: string) => {
  if (g[r] && c >= 0 && c < g[r].length) g[r][c] = v
}

/** Left lens is columns 4-5, right lens 10-11, rows 6-7 */
function eyes(g: Grid, look: 'center' | 'up' | 'down' | 'left' | 'right' | 'closed' | 'squint') {
  if (look === 'closed' || look === 'squint') {
    for (const c of [4, 5, 10, 11]) {
      set(g, 6, c, look === 'squint' ? 'k' : FACES[face].lid)
      set(g, 7, c, look === 'squint' ? FACES[face].lid : 'k')
    }
    return
  }
  const row = look === 'up' ? 6 : 7
  const [l, r] = look === 'left' ? [4, 10] : look === 'right' ? [5, 11] : [5, 10]
  set(g, row, l, 'p')
  set(g, row, r, 'p')
}

function mood(state: ProfessorState, tick: number, blink: boolean): Grid {
  const g = grid(16)
  if (state === 'idle') {
    const glance = tick % 14 === 7 ? 'left' : tick % 14 === 9 ? 'right' : 'center'
    eyes(g, blink ? 'closed' : glance)
  } else if (state === 'thinking') {
    eyes(g, blink ? 'closed' : 'up')
    // A hand to the chin
    for (const [r, c] of [[11, 9], [11, 10], [12, 9], [12, 10], [12, 11]] as const) set(g, r, c, 'S')
    // The thought bubble fills with dots, one at a time
    const dots = tick % 4
    if (dots >= 1) set(g, 3, 14, 'o')
    if (dots >= 2) set(g, 1, 14, 'o')
    if (dots >= 3) set(g, 0, 15, 'o')
  } else if (state === 'reading') {
    eyes(g, blink ? 'closed' : tick % 4 < 2 ? 'left' : 'right')
  } else if (state === 'writing') {
    eyes(g, blink ? 'closed' : 'center')
    // Talking: the moustache lifts and settles
    if (tick % 2) {
      const cheek = FACES[face].cheek
      set(g, 11, 6, cheek)
      set(g, 11, 9, cheek)
      set(g, 11, 7, 'k')
      set(g, 11, 8, 'k')
    }
  } else {
    eyes(g, 'squint')
  }
  return g
}

function scene(name: ProfessorScene, tick: number, blink: boolean): Grid {
  const g = grid(24)
  if (name === 'tea') {
    // The cup comes up for a sip every few seconds, then rests on the saucer
    const sipping = tick % 10 >= 6
    eyes(g, sipping || blink ? 'closed' : 'right')
    const top = sipping ? 10 : 12
    for (let c = 15; c <= 18; c++) set(g, top, c, 'u')
    set(g, top + 1, 15, 'u')
    for (let c = 16; c <= 17; c++) set(g, top + 1, c, 'e')
    set(g, top + 1, 18, 'u')
    set(g, top + 1, 19, 'u') // handle
    set(g, top + 2, 15, 'u')
    set(g, top + 2, 16, 'u')
    set(g, top + 2, 17, 'u')
    set(g, top + 2, 18, 'u')
    if (!sipping) for (let c = 14; c <= 19; c++) set(g, 15, c, 'u') // saucer
    // A hand holds it
    set(g, top + 2, 14, 'S')
    set(g, top + 3, 14, 'S')
    // Steam drifts up and sways
    const sway = tick % 2
    for (const [i, r] of [top - 2, top - 3, top - 4].entries()) set(g, r, 16 + ((i + sway) % 2), 'o')
  } else if (name === 'board') {
    eyes(g, blink ? 'closed' : tick % 6 < 4 ? 'right' : 'center')
    // The board
    for (let r = 1; r <= 10; r++) for (let c = 16; c <= 23; c++) set(g, r, c, r === 1 || r === 10 || c === 16 || c === 23 ? 'f' : 'g')
    // Lines of chalk appear one stroke at a time, then the board is wiped
    const strokes = tick % 14
    const lines: [number, number, number][] = [[3, 18, 21], [5, 18, 20], [7, 18, 22], [8, 18, 19]]
    let n = 0
    for (const [r, a, b] of lines)
      for (let c = a; c <= b; c++) {
        if (n++ < strokes) set(g, r, c, 'x')
      }
    // An arm reaches to the board, chalk in hand
    for (const c of [15, 16]) set(g, 9, c, 'j')
    set(g, 8, 17, 'S')
    if (strokes < 12) set(g, 7, 17 + (strokes % 4), 'x')
  } else if (name === 'fishing') {
    // Dozing by the water
    eyes(g, tick % 12 < 7 ? 'closed' : blink ? 'closed' : 'right')
    // Rod from his hand up and out
    const rod: [number, number][] = [[12, 15], [11, 16], [10, 17], [9, 18], [8, 19], [7, 20], [6, 21], [5, 22]]
    for (const [r, c] of rod) set(g, r, c, 'f')
    set(g, 13, 14, 'S')
    // Line down to a float that bobs; now and then a bite pulls it under
    const bite = tick % 16 === 15
    const float = bite ? 14 : 12 + (tick % 2)
    for (let r = 6; r < float; r++) set(g, r, 23, 'o')
    for (let c = 17; c <= 23; c++) set(g, 14, c, 'b')
    for (let c = 16; c <= 23; c++) set(g, 15, c, 'b')
    set(g, 14, 21 - (tick % 3), 'B')
    if (!bite) set(g, float, 23, 'r')
    // Zzz while dozing
    if (tick % 12 < 7) set(g, 2 - (tick % 2), 14 + (tick % 3), 'o')
  } else if (name === 'book') {
    // Reading, a page turning now and then; a stack of books beside him
    eyes(g, blink ? 'closed' : tick % 6 < 3 ? 'left' : 'center')
    set(g, 7, 5, 'p')
    set(g, 7, 10, 'p')
    for (let r = 11; r <= 14; r++) for (let c = 3; c <= 12; c++) set(g, r, c, c === 7 || c === 8 ? 'J' : 'u')
    for (const r of [12, 13]) for (const c of [4, 5, 10, 11]) set(g, r, c, 'o')
    const turning = tick % 12 >= 10
    if (turning) for (let r = 10; r <= 13; r++) set(g, r, 9 + (r - 10), 'u')
    set(g, 14, 2, 'S')
    set(g, 14, 13, 'S')
    const spines = ['r', 'b', 'e', 'f', 'B']
    spines.forEach((v, i) => {
      for (let c = 16; c <= 22 - (i % 2); c++) set(g, 15 - i, c, v)
    })
  } else if (name === 'laptop') {
    // Typing: the screen fills with lines of code
    eyes(g, blink ? 'closed' : 'right')
    for (let r = 8; r <= 12; r++) for (let c = 15; c <= 22; c++) set(g, r, c, r === 8 || r === 12 || c === 15 || c === 22 ? 'K' : 'g')
    const lines = tick % 10
    const colours = ['x', 'Y', 'B', 'x', 'r']
    for (let i = 0; i < Math.min(3, lines); i++) for (let c = 16; c <= 16 + ((i * 3 + 4) % 6); c++) set(g, 9 + i, c, colours[(i + (tick >> 3)) % colours.length])
    for (let c = 14; c <= 23; c++) set(g, 13, c, 'o')
    set(g, 12, 14 + (tick % 2), 'S')
    set(g, 12, 13, 'S')
  } else if (name === 'cards') {
    // Shuffling flashcards: one flips to show its back
    eyes(g, blink ? 'closed' : 'right')
    const flip = tick % 8
    const face = flip < 4 ? 'u' : 'q'
    for (let r = 8; r <= 13; r++) for (let c = 16; c <= 21; c++) set(g, r, c, face)
    if (flip < 4) for (const c of [17, 18, 19]) set(g, 10, c, 'o')
    else for (const c of [17, 18, 19, 20]) set(g, 11, c, 'K')
    for (let c = 17; c <= 22; c++) set(g, 14, c, 'u')
    for (let c = 18; c <= 23; c++) set(g, 15, c, 'u')
    set(g, 12, 15, 'S')
  } else if (name === 'stopwatch') {
    // Invigilating a timed paper: the watch held up, its hand going round
    eyes(g, blink ? 'closed' : 'right')
    const cx = 19
    const cy = 8
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) if (r * r + c * c <= 10) set(g, cy + r, cx + c, r * r + c * c >= 7 ? 'f' : 'u')
    set(g, cy - 4, cx, 'f')
    set(g, cy, cx, 'K')
    const hands: [number, number][] = [[-2, 0], [-1, 1], [0, 2], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1]]
    const [hr, hc] = hands[tick % hands.length]
    set(g, cy + hr, cx + hc, 'r')
    for (let r = cy + 4; r <= 13; r++) set(g, r, 17, 'S')
    set(g, 12, 16, 'j')
  } else if (name === 'telescope') {
    // Stargazing: one eye to the glass, a star twinkling above
    eyes(g, 'right')
    set(g, 6, 10, 'k')
    set(g, 7, 10, 'k')
    const tube: [number, number][] = [[7, 13], [6, 14], [6, 15], [5, 16], [4, 17], [4, 18], [3, 19], [2, 20]]
    for (const [r, c] of tube) (set(g, r, c, 'f'), set(g, r + 1, c, 'J'))
    for (let r = 9; r <= 15; r++) set(g, r, 15 + ((r - 9) >> 2), 'f')
    const star: [number, number] = [[1, 22], [0, 18], [2, 23]][(tick >> 2) % 3] as [number, number]
    set(g, star[0], star[1], 'Y')
    if (tick % 2) set(g, 0, 21, 'x')
  } else if (name === 'eureka') {
    // A good idea: a lightbulb that switches on, and a pleased squint
    eyes(g, tick % 4 < 3 ? 'squint' : 'center')
    const on = tick % 4 !== 3
    const bulb = on ? 'Y' : 'o'
    for (const [r, c] of [[1, 18], [1, 19], [1, 20], [2, 17], [2, 18], [2, 19], [2, 20], [2, 21], [3, 17], [3, 18], [3, 19], [3, 20], [3, 21], [4, 18], [4, 19], [4, 20]] as const) set(g, r, c, bulb)
    set(g, 5, 18, 'f')
    set(g, 5, 19, 'f')
    set(g, 5, 20, 'f')
    if (on) for (const [r, c] of [[0, 16], [0, 22], [2, 15], [2, 23], [4, 16], [4, 22]] as const) set(g, r, c, 'x')
  } else if (name === 'sleep') {
    // Dozing: eyes shut, a gentle nod, Zzz drifting up
    eyes(g, 'closed')
    if (tick % 6 < 3) {
      for (let r = 15; r > 0; r--) g[r] = [...g[r - 1]]
      g[0] = g[0].map(() => '.')
    }
    const z = tick % 6
    set(g, 6 - z, 17 + (z >> 1), 'o')
    if (z > 1) set(g, 8 - z, 19 + (z >> 1), 'x')
  } else if (name === 'party') {
    // A party hat on, a little hop and sway, an arm punching the air
    eyes(g, 'squint')
    const hop = tick % 4 === 1 || tick % 4 === 3
    if (hop) {
      for (let r = 0; r < 15; r++) g[r] = [...g[r + 1]]
      g[15] = g[15].map(() => '.')
    }
    const top = hop ? -1 : 0
    // The hat: a cone of lamp-light yellow with a red stripe and a pom-pom
    const hat: [number, number, string][] = [[0, 7, 'r'], [0, 8, 'r'], [1, 7, 'Y'], [1, 8, 'Y'], [2, 6, 'Y'], [2, 7, 't'], [2, 8, 't'], [2, 9, 'Y'], [3, 5, 'Y'], [3, 6, 'Y'], [3, 7, 'Y'], [3, 8, 'Y'], [3, 9, 'Y'], [3, 10, 'Y']]
    for (const [r, c, v] of hat) set(g, r + top, c, v)
    // An arm up on the right, switching height with the beat
    const high = tick % 2 === 0
    for (let r = 9; r <= 12; r++) (set(g, r + top, 15, 'j'), set(g, r + top, 16, 'j'))
    for (let r = high ? 4 : 6; r <= 8; r++) set(g, r + top, 17, 'j')
    for (const [dr, dc] of [[0, 0], [0, 1], [-1, 0], [-1, 1]] as const) set(g, (high ? 3 : 5) + dr + top, 17 + dc, 'S')
    // A mouth open in a grin on the beat
    if (high) (set(g, 11 + top, 7, 'k'), set(g, 11 + top, 8, 'k'))
  } else if (name === 'wave') {
    // Hello! An arm up, the hand waving side to side
    eyes(g, blink ? 'closed' : 'squint')
    const lean = tick % 2
    for (let r = 9; r <= 12; r++) (set(g, r, 15, 'j'), set(g, r, 16, 'j'))
    for (let r = 5; r <= 8; r++) set(g, r, 16 + lean, 'j')
    for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1], [-1, 0], [-1, 1], [-2, 0]] as const) set(g, 3 + dr, 16 + lean * 2 + dc, 'S')
  } else {
    eyes(g, blink ? 'closed' : tick % 8 < 5 ? 'down' : 'center')
    if (tick % 8 < 5) {
      set(g, 7, 5, 'p')
      set(g, 7, 10, 'p')
    }
    // A table and a corner of the board, in 2 x 2 squares
    for (let c = 15; c <= 23; c++) set(g, 11, c, 'f')
    for (let r = 12; r <= 15; r++) for (let c = 16; c <= 23; c++) set(g, r, c, ((r >> 1) + (c >> 1)) % 2 ? 'Q' : 'q')
    // Pieces, two pixels tall: black at the back, white in front
    const piece = (r: number, c: number, v: string) => (set(g, r, c, v), set(g, r - 1, c, v))
    piece(13, 21, 'K')
    piece(13, 23, 'K')
    piece(15, 17, 'W')
    piece(15, 22, 'W')
    // His knight hops forward, hand on it, then he sits back to think
    const step = tick % 8
    const path: [number, number][] = [[15, 19], [14, 19], [13, 18], [13, 18]]
    const [pr, pc] = path[Math.min(path.length - 1, step >> 1)]
    piece(pr, pc, 'W')
    if (step < 6) {
      set(g, pr - 2, pc, 'S')
      set(g, pr - 3, pc - 1, 'j')
      set(g, pr - 3, pc - 2, 'j')
    }
  }
  return g
}

/** The picture for a pose at a moment: rows of palette keys, '.' for empty */
export function professorFrame(pose: ProfessorPose, tick: number, blink: boolean, character: CharacterId = 'professor'): Grid {
  face = FACES[character] ? character : 'professor'
  return isScene(pose) ? scene(pose, tick, blink) : mood(pose, tick, blink)
}

/** How fast each pose moves, in ms per frame */
export const SPEED: Record<ProfessorPose, number> = { idle: 700, thinking: 520, reading: 380, writing: 260, happy: 1000, tea: 450, board: 320, fishing: 600, chess: 500, book: 500, laptop: 260, cards: 420, stopwatch: 500, telescope: 600, eureka: 380, sleep: 650, wave: 300, party: 240 }

/** An RGBA bitmap of a frame (for the menu bar), each pixel scale x scale */
export function professorBitmap(pose: ProfessorPose, tick: number, scale: number, character: CharacterId = 'professor'): { width: number; height: number; data: Uint8Array } {
  const g = professorFrame(pose, tick, false, character)
  const colours = paletteFor(character)
  const width = g[0].length * scale
  const height = g.length * scale
  const data = new Uint8Array(width * height * 4)
  g.forEach((row, y) =>
    row.forEach((v, x) => {
      const hex = colours[v]
      if (!hex) return
      const [r, gg, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * width + (x * scale + dx)) * 4
          // BGRA, as macOS bitmaps expect
          data[i] = b
          data[i + 1] = gg
          data[i + 2] = r
          data[i + 3] = 255
        }
    })
  )
  return { width, height, data }
}
