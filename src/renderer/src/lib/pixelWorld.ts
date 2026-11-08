import { paletteFor, professorFrame, type ProfessorScene } from '@shared/professorArt'
import type { CharacterId } from '@shared/characters'

/**
 * Tide's little pixel world: the places your tutor spends time, with the people and animals who
 * share them. Drawn at a low resolution (one logical pixel per screen block) and scaled up crisply.
 *
 * Places:
 * - home: changes with the time of day (garden, study, pond, fireside)
 * - classroom (Learn), reading-room (Library), exam-hall (exams), workshop (Practice),
 *   porch (the evening wrap-up), observatory (the weekly review)
 */
export type Place = 'home' | 'classroom' | 'reading-room' | 'exam-hall' | 'workshop' | 'porch' | 'observatory' | 'math' | 'terminal' | 'mars' | 'planner' | 'library' | 'drafting' | 'flashcards'
export type HomeSetting = 'garden' | 'study' | 'pond' | 'night'

export const homeSettingFor = (h: number): HomeSetting => (h >= 5 && h < 11 ? 'garden' : h >= 11 && h < 17 ? 'study' : h >= 17 && h < 21 ? 'pond' : 'night')

export const PLACE_LABEL: Record<Exclude<Place, 'home'> | HomeSetting, string> = {
  garden: 'Morning tea in the garden',
  study: 'Afternoon in the study',
  pond: 'Evening at the pond',
  night: 'Late, by the fire',
  classroom: 'In the classroom',
  'reading-room': 'The reading room',
  'exam-hall': 'The exam hall',
  workshop: 'The workshop',
  porch: 'Sunset on the porch',
  observatory: 'At the observatory',
  math: 'Working it out at the board',
  terminal: 'Late night at the terminal',
  mars: 'Field trip to Mars',
  planner: 'Planning the week',
  drafting: 'Writing your outline',
  flashcards: 'Going through the cards',
  library: 'Reading out the storm'
}

/** Seeded noise, so trees, stars and people stay put between frames */
export const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const SKIES = {
  morning: ['#8ec6ea', '#bfe0f2', '#f8e4bf'],
  day: ['#86c2ec', '#b4dcf5', '#e2f1fa'],
  sunset: ['#3c3f74', '#c4677a', '#f3b071'],
  night: ['#0d1430', '#1a2450', '#2c3a6a']
} as const
type Sky = keyof typeof SKIES

/** The people around: skin, hair, clothes, and how their hair is cut */
const LOOKS = [
  { skin: '#e3b48f', hair: '#3a2a1e', top: '#4f7bd1', legs: '#33363d', style: 0 },
  { skin: '#8e5a39', hair: '#2a2224', top: '#f2c94c', legs: '#4f7bd1', style: 1 },
  { skin: '#c98e6b', hair: '#b8433a', top: '#5f9a4f', legs: '#3a3d44', style: 2 },
  { skin: '#f0c9a6', hair: '#e8d08a', top: '#b58ce0', legs: '#33363d', style: 3 },
  { skin: '#6d4430', hair: '#1d1a17', top: '#e86a7a', legs: '#2a3550', style: 1 },
  { skin: '#d9a57f', hair: '#6b4a33', top: '#2f8f8a', legs: '#4a3527', style: 0 }
]

export interface World {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  tick: number
  character: CharacterId
  hour: number
  /** Facts a place draws from, e.g. the week's days for the planner */
  data?: Record<string, unknown>
}

export function drawPlace(w: World, place: Place): string {
  w.ctx.imageSmoothingEnabled = false
  if (place === 'home') {
    // Weekend afternoons are a field trip
    const day = new Date().getDay()
    if ((day === 0 || day === 6) && w.hour >= 13 && w.hour < 17) {
      mars(w)
      return PLACE_LABEL.mars
    }
    const s = homeSettingFor(Math.floor(w.hour))
    ;({ garden, study, pond, night })[s](w)
    return PLACE_LABEL[s]
  }
  // The library: a storm in the morning and evening, a flight in the afternoon
  if (place === 'library') {
    if (w.hour >= 12 && w.hour < 17) {
      biplane(w)
      return 'Flying over the fields'
    }
    rainyLibrary(w)
    return PLACE_LABEL.library
  }
  if (place === 'flashcards') {
    flashcards(w)
    return w.data?.live ? PLACE_LABEL.flashcards : 'Sorting the card box'
  }
  if (place === 'drafting') {
    drafting(w)
    return w.data?.live === false ? 'The outline is ready' : PLACE_LABEL.drafting
  }
  ;({ classroom, 'reading-room': readingRoom, 'exam-hall': examHall, workshop, porch, observatory, math: mathStudy, terminal: terminalDen, mars, planner })[place](w)
  return PLACE_LABEL[place]
}

// ---------- Drawing helpers ----------

const px = (w: World, x: number, y: number, c: string) => {
  w.ctx.fillStyle = c
  w.ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
}
const rect = (w: World, x: number, y: number, ww: number, h: number, c: string) => {
  w.ctx.fillStyle = c
  w.ctx.fillRect(Math.round(x), Math.round(y), Math.round(ww), Math.round(h))
}

/** The tutor, doing something */
function tutor(w: World, scene: ProfessorScene, x: number, y: number) {
  const colours = paletteFor(w.character)
  const g = professorFrame(scene, w.tick >> 1, w.tick % 37 === 0, w.character)
  g.forEach((row, r) => row.forEach((v, c) => v !== '.' && px(w, x + c, y + r, colours[v])))
}

/** Someone standing or walking, 5 wide and 10 tall; frame moves the legs */
function person(w: World, x: number, y: number, look: number, frame: number, facing: 1 | -1 = 1) {
  const l = LOOKS[look % LOOKS.length]
  const X = (dx: number) => x + (facing === 1 ? dx : 4 - dx)
  // Hair and head
  for (let dx = 1; dx <= 3; dx++) px(w, X(dx), y, l.hair)
  if (l.style === 1) (px(w, X(0), y + 1, l.hair), px(w, X(4), y + 1, l.hair))
  if (l.style === 3) for (let dy = 1; dy <= 4; dy++) px(w, X(0), y + dy, l.hair)
  for (let dx = 1; dx <= 3; dx++) for (let dy = 1; dy <= 2; dy++) px(w, X(dx), y + dy, l.skin)
  if (l.style === 2) px(w, X(1), y + 1, l.hair)
  px(w, X(3), y + 1, '#1d1a17')
  // Body and arms swinging
  for (let dx = 1; dx <= 3; dx++) for (let dy = 3; dy <= 6; dy++) px(w, X(dx), y + dy, l.top)
  px(w, X(frame % 2 ? 0 : 4), y + 4, l.skin)
  px(w, X(frame % 2 ? 4 : 0), y + 5, l.skin)
  // Legs
  const stride = frame % 2
  px(w, X(1 + stride), y + 7, l.legs)
  px(w, X(3 - stride), y + 7, l.legs)
  px(w, X(1), y + 8, l.legs)
  px(w, X(3), y + 8, l.legs)
  px(w, X(stride ? 0 : 1), y + 9, '#2a2622')
  px(w, X(stride ? 4 : 3), y + 9, '#2a2622')
}

/** A student seen from behind or the front at a desk, 7 wide and 7 tall; one may raise a hand */
function student(w: World, x: number, y: number, look: number, opts: { back?: boolean; hand?: boolean; writing?: boolean } = {}) {
  const l = LOOKS[look % LOOKS.length]
  for (let dx = 2; dx <= 4; dx++) px(w, x + dx, y, l.hair)
  for (let dx = 1; dx <= 5; dx++) px(w, x + dx, y + 1, opts.back ? l.hair : dx === 1 || dx === 5 ? l.hair : l.skin)
  for (let dx = 1; dx <= 5; dx++) px(w, x + dx, y + 2, opts.back ? (l.style === 3 ? l.hair : l.skin) : l.skin)
  if (!opts.back) (px(w, x + 2, y + 1, '#1d1a17'), px(w, x + 4, y + 1, '#1d1a17'))
  for (let dx = 0; dx <= 6; dx++) for (let dy = 3; dy <= 5; dy++) px(w, x + dx, y + dy, l.top)
  if (opts.hand) for (let dy = -3; dy <= 2; dy++) px(w, x + 6, y + dy, dy < -1 ? l.skin : l.top)
  if (opts.writing && w.tick % 2) px(w, x + 5, y + 5, '#2a2622')
}

function dog(w: World, x: number, y: number, frame: number, facing: 1 | -1 = 1, colour = '#b07f55') {
  const X = (dx: number) => x + (facing === 1 ? dx : 7 - dx)
  for (let dx = 1; dx <= 5; dx++) (px(w, X(dx), y + 1, colour), px(w, X(dx), y + 2, colour))
  px(w, X(6), y, colour)
  px(w, X(7), y, colour)
  px(w, X(6), y + 1, colour)
  px(w, X(7), y + 1, '#2a2622')
  px(w, X(0), y + (frame % 2 ? 0 : 1), colour)
  const legs = frame % 2 ? [1, 5] : [2, 4]
  for (const l of legs) px(w, X(l), y + 3, colour)
}

function cat(w: World, x: number, y: number, asleep: boolean, colour = '#d9a066') {
  rect(w, x, y + 1, 7, 2, colour)
  rect(w, x + 5, y, 3, 2, colour)
  px(w, x + 5, y - 1, colour)
  px(w, x + 7, y - 1, colour)
  if (!asleep) px(w, x + 6, y, '#2a2622')
  px(w, x - 1, y + (w.tick % 8 < 4 ? 1 : 2), colour)
  if (asleep && (w.tick >> 3) % 2) px(w, x + 9, y - 3, '#c9d3f2')
}

function duck(w: World, x: number, y: number) {
  rect(w, x, y + 1, 4, 2, '#f4efe4')
  px(w, x + 3, y, '#3f7a4a')
  px(w, x + 4, y, '#3f7a4a')
  px(w, x + 5, y + 1, '#e8a33c')
}

function sky(w: World, kind: Sky, top: number, bottom: number, left = 0, right = w.width) {
  const [a, b, c] = SKIES[kind]
  for (let y = top; y < bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top)
    for (let x = left; x < right; x++) {
      const d = (x + y) % 2 ? 0.06 : -0.06
      px(w, x, y, t + d < 0.5 ? a : t + d < 0.82 ? b : c)
    }
  }
  if (kind === 'night') {
    for (let i = 0; i < (right - left) / 5; i++) {
      const x = left + Math.floor(rand(i) * (right - left))
      const y = top + Math.floor(rand(i + 99) * (bottom - top) * 0.85)
      if ((w.tick + i * 7) % 40 > 3) px(w, x, y, rand(i + 7) > 0.8 ? '#fff6d8' : '#c9d3f2')
    }
    const mx = left + (right - left) * 0.72
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) if ((dx - 2) ** 2 + (dy - 2) ** 2 <= 5) px(w, mx + dx, top + 3 + dy, '#f2ecd2')
    rect(w, mx + 3, top + 4, 2, 3, SKIES.night[0])
    return
  }
  const p = Math.min(1, Math.max(0, (w.hour - 6) / 14))
  const sx = left + (right - left) * (0.1 + p * 0.8)
  const sy = top + 3 + Math.round(Math.abs(p - 0.5) * 2 * Math.max(4, bottom - top - 10))
  const sun = kind === 'sunset' ? '#ffcf6e' : '#ffe9a3'
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9 && sy + dy >= top && sy + dy < bottom) px(w, sx + dx, sy + dy, sun)
  for (let i = 0; i < 3; i++) {
    const span = right - left + 30
    const cx = left + ((rand(i + 3) * span + w.tick * (0.08 + i * 0.03)) % span) - 15
    const cy = top + 3 + i * 4
    if (cy + 2 >= bottom) continue
    const cloud = kind === 'sunset' ? '#e9a7a0' : '#ffffff'
    for (const [dx, dy, len] of [[2, 0, 6], [0, 1, 11], [1, 2, 9]] as const) for (let k = 0; k < len; k++) if (cx + dx + k >= left && cx + dx + k < right) px(w, cx + dx + k, cy + dy, cloud)
  }
}

function hills(w: World, y: number, colour: string, seed: number, amp: number) {
  for (let x = 0; x < w.width; x++) {
    const h = Math.round(Math.sin(x / 9 + seed) * amp + Math.sin(x / 23 + seed * 2) * amp)
    rect(w, x, y + h, 1, w.height - y - h, colour)
  }
}

function tree(w: World, x: number, base: number, size: number, leaf: string, dark: string) {
  rect(w, x + size - 1, base - size, 2, size, '#5b3d27')
  for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) if (dx * dx + dy * dy <= size * size) px(w, x + size + dx, base - size * 2 + dy, dy > size / 3 || dx > size / 2 ? dark : leaf)
}

function grass(w: World, top: number, light: string, dark: string, flowers: boolean) {
  for (let y = top; y < w.height; y++) for (let x = 0; x < w.width; x++) px(w, x, y, (x * 3 + y * 7) % 11 === 0 ? dark : light)
  if (!flowers) return
  for (let i = 0; i < w.width / 6; i++) {
    const x = Math.floor(rand(i + 40) * w.width)
    const y = top + 2 + Math.floor(rand(i + 80) * (w.height - top - 3))
    px(w, x, y + 1, dark)
    px(w, x + ((w.tick + i) % 16 < 8 ? 0 : 1), y, ['#f2c94c', '#e86a7a', '#f4efe4', '#b58ce0'][i % 4])
  }
}

function room(w: World, floorY: number, wall: string, stripe: string, floor: string, board: string) {
  for (let y = 0; y < floorY; y++) for (let x = 0; x < w.width; x++) px(w, x, y, x % 6 === 0 && y % 4 < 2 ? stripe : wall)
  for (let y = floorY; y < w.height; y++) for (let x = 0; x < w.width; x++) px(w, x, y, (x + Math.floor(y / 3) * 5) % 12 === 0 ? board : floor)
  rect(w, 0, floorY - 1, w.width, 1, board)
}

function windowFrame(w: World, kind: Sky, x: number, y = 4, ww = 22, h = 16) {
  rect(w, x - 1, y - 1, ww + 2, h + 2, '#f0e6d2')
  sky(w, kind, y, y + h, x, x + ww)
  rect(w, x + ww / 2 - 1, y, 2, h, '#f0e6d2')
  rect(w, x, y + h / 2, ww, 1, '#f0e6d2')
  rect(w, x - 2, y + h, ww + 4, 2, '#e6dac2')
}

function shelf(w: World, x: number, top: number, ww: number, rows: number) {
  rect(w, x, top, ww, rows * 8, '#6b4a33')
  for (let row = 0; row < rows; row++) {
    const base = top + 7 + row * 8
    rect(w, x + 1, base, ww - 2, 1, '#4d3423')
    for (let b = 0; b < Math.floor((ww - 4) / 2); b++) {
      const h = 5 + Math.floor(rand(b + row * 11 + x) * 2)
      rect(w, x + 2 + b * 2, base - h, 2, h, ['#b8433a', '#3f6f9e', '#d6a84a', '#5f9a4f', '#7a5b9e', '#e8dcc0'][(b + row + x) % 6])
    }
  }
}

function plant(w: World, x: number, y: number) {
  rect(w, x, y, 6, 5, '#b86a45')
  for (const [dx, dy] of [[1, -1], [2, -3], [3, -2], [4, -4], [2, -5], [0, -2], [5, -1], [3, -6]]) px(w, x + dx + ((w.tick >> 3) % 2 && dy < -3 ? 1 : 0), y + dy, '#4f8a43')
}

function wallClock(w: World, x: number, y: number, fast = false) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 10) px(w, x + dx, y + dy, dx * dx + dy * dy >= 7 ? '#5b3d27' : '#f4efe4')
  px(w, x, y - 1, '#2a2622')
  const hands: [number, number][] = [[0, -2], [1, -1], [2, 0], [1, 1], [0, 2], [-1, 1], [-2, 0], [-1, -1]]
  const [hx, hy] = hands[Math.floor(w.tick / (fast ? 2 : 8)) % 8]
  px(w, x + hx, y + hy, '#b8433a')
}

function steam(w: World, x: number, y: number) {
  for (let i = 0; i < 3; i++) px(w, x + ((w.tick >> 1) + i) % 2, y - i, '#c9c4bb')
}

function glow(w: World, x: number, y: number, r: number, colour: string, alpha: number) {
  const g = w.ctx.createRadialGradient(x, y, 1, x, y, r)
  g.addColorStop(0, colour.replace('A', String(alpha)))
  g.addColorStop(1, colour.replace('A', '0'))
  w.ctx.fillStyle = g
  w.ctx.fillRect(0, 0, w.width, w.height)
}

/** Someone strolling across, on a path at y, looping */
function walker(w: World, y: number, look: number, speed: number, offset: number, withDog = false) {
  const span = w.width + 40
  const x = ((w.tick * speed + offset) % span) - 20
  person(w, x, y, look, Math.floor(w.tick / 2), 1)
  if (withDog) dog(w, x + 8, y + 6, Math.floor(w.tick / 2), 1)
}

// ---------- Home, through the day ----------

function garden(w: World) {
  sky(w, 'morning', 0, 26)
  hills(w, 22, '#9cc59a', 1, 2)
  hills(w, 25, '#7fb07c', 4, 2)
  for (let i = 0; i < 5; i++) tree(w, Math.floor(rand(i + 11) * w.width), 30, 3 + (i % 2), '#5f9a4f', '#4a7f3e')
  grass(w, 28, '#86bf6c', '#6fa45a', true)
  // A path, and a neighbour walking the dog
  rect(w, 0, 36, w.width, 2, '#d9c49a')
  walker(w, 27, 1, 0.35, 30, true)
  // Birds cross, a butterfly flutters
  const bx = ((w.tick * 0.6) % (w.width + 40)) - 20
  for (const [dx, dy] of [[0, 0], [1, 1], [2, 0], [6, 2], [7, 3], [8, 2]]) if ((w.tick >> 2) % 2 || dy) px(w, bx + dx, 9 + dy, '#3b3a46')
  px(w, w.width * 0.7 + Math.sin(w.tick / 5) * 6, 26 + Math.cos(w.tick / 3) * 2, w.tick % 2 ? '#f2c94c' : '#e86a7a')
  const tx = Math.floor(w.width * 0.18)
  tutor(w, 'tea', tx, 17)
  rect(w, tx + 10, 32, 14, 2, '#8a5a36')
  rect(w, tx + 12, 34, 2, 6, '#6f4628')
  rect(w, tx + 20, 34, 2, 6, '#6f4628')
}

function study(w: World) {
  room(w, 31, '#d9c6a2', '#c9b48f', '#b07f55', '#9a6d47')
  windowFrame(w, 'day', Math.floor(w.width * 0.08))
  shelf(w, Math.floor(w.width * 0.78), 6, 22, 3)
  plant(w, Math.floor(w.width * 0.72), 25)
  const p = Math.min(1, Math.max(0, (w.hour - 11) / 6))
  const bx = Math.floor(w.width * 0.08 + p * w.width * 0.3)
  w.ctx.globalAlpha = 0.28
  for (let y = 31; y < w.height; y++) rect(w, bx + (y - 31) * 2, y, 20, 1, '#fff2c4')
  w.ctx.globalAlpha = 1
  const dx = Math.floor(w.width * 0.36)
  tutor(w, 'board', dx, 13)
  // A student has come by with a question
  student(w, dx + 30, 20, 2, { hand: w.tick % 24 < 6 })
  rect(w, dx - 3, 26, 46, 2, '#8a5a36')
  rect(w, dx - 3, 28, 46, 1, '#6f4628')
  rect(w, dx - 2, 29, 2, 9, '#6f4628')
  rect(w, dx + 39, 29, 2, 9, '#6f4628')
  rect(w, dx + 1, 24, 5, 2, '#3f6f9e')
  rect(w, dx + 22, 24, 3, 2, '#f4efe4')
  steam(w, dx + 23, 23)
}

function pond(w: World) {
  sky(w, 'sunset', 0, 26)
  hills(w, 21, '#5d4a6e', 2, 2)
  hills(w, 24, '#4b5a52', 5, 2)
  for (let i = 0; i < 4; i++) tree(w, Math.floor(rand(i + 21) * w.width * 0.5), 29, 3, '#3f5f3e', '#324b31')
  grass(w, 27, '#5e8a4e', '#4e7642', false)
  // A couple strolling on the far bank
  walker(w, 18, 4, 0.18, 10)
  walker(w, 18, 3, 0.18, 17)
  const p0 = Math.floor(w.width * 0.45)
  for (let y = 30; y < w.height; y++)
    for (let x = p0; x < w.width - 6; x++) {
      const edge = Math.abs(x - (p0 + w.width - 6) / 2) / ((w.width - 6 - p0) / 2)
      if (edge < 1 - (y - 30) * 0.02) px(w, x, y, (x * 7 + y * 13 + (w.tick >> 1)) % 29 === 0 ? '#f3b071' : (x * 5 + y * 3 + (w.tick >> 2)) % 37 === 0 ? '#8e86b8' : y < 33 ? '#6c5e8a' : '#4d4f7f')
    }
  // Ducks paddle across
  for (let i = 0; i < 3; i++) duck(w, p0 + 10 + ((w.tick * 0.15 + i * 9) % Math.max(10, w.width - p0 - 24)), 32 + (i % 2) * 2)
  tutor(w, 'fishing', p0 - 14, 18)
  for (let i = 0; i < 8; i++) {
    const fx = (rand(i + 50) * w.width + Math.sin((w.tick + i * 9) / 12) * 4) % w.width
    const fy = 18 + rand(i + 60) * 14 + Math.cos((w.tick + i * 5) / 10) * 2
    if ((w.tick + i * 13) % 24 < 14) px(w, fx, fy, '#f6f0a0')
  }
}

function night(w: World) {
  room(w, 31, '#38334a', '#2e2a3a', '#4a3527', '#3a2a20')
  windowFrame(w, 'night', Math.floor(w.width * 0.62))
  const fx = Math.floor(w.width * 0.08)
  rect(w, fx, 14, 22, 17, '#5a4a48')
  rect(w, fx + 4, 20, 14, 11, '#1d1414')
  for (let i = 0; i < 10; i++) {
    const h = 2 + ((w.tick + i * 3) % 5)
    rect(w, fx + 5 + i, 30 - h, 1, h, i % 3 ? '#f08a3c' : '#ffd36b')
  }
  rect(w, fx - 1, 13, 24, 2, '#6b5654')
  glow(w, fx + 11, 26, 46 + ((w.tick >> 1) % 3), 'rgba(255,170,80,A)', 0.32)
  const lx = Math.floor(w.width * 0.5)
  glow(w, lx, 22, 22, 'rgba(255,220,140,A)', 0.28)
  rect(w, lx, 24, 1, 7, '#c8a46b')
  rect(w, lx - 3, 20, 7, 4, '#f3d08a')
  tutor(w, 'chess', Math.floor(w.width * 0.3), 15)
  const cx = Math.floor(w.width * 0.84)
  rect(w, cx - 4, 37, 16, 2, '#7a3e3e')
  cat(w, cx, 34, true)
  // An owl at the window
  const ox = Math.floor(w.width * 0.62) + 16
  rect(w, ox, 15, 3, 3, '#7b5a3a')
  px(w, ox, 15, '#e8b84a')
  px(w, ox + 2, 15, (w.tick >> 4) % 2 ? '#e8b84a' : '#7b5a3a')
}

// ---------- Other places ----------

function classroom(w: World) {
  room(w, 30, '#e3d6bd', '#d6c7aa', '#9a6d47', '#86603e')
  // The long board, filling with notes, then wiped
  const bx = Math.floor(w.width * 0.12)
  const bw = Math.floor(w.width * 0.5)
  rect(w, bx - 1, 3, bw + 2, 18, '#7a5638')
  rect(w, bx, 4, bw, 16, '#2f4a3a')
  const strokes = (w.tick >> 1) % 60
  let n = 0
  for (let line = 0; line < 4; line++)
    for (let c = 0; c < bw - 8 - (line * 7) % 13; c += 1) {
      if (n++ > strokes * 4) break
      if ((c + line) % 7 !== 6) px(w, bx + 3 + c, 6 + line * 4, '#e9e6dc')
    }
  rect(w, bx, 20, bw, 1, '#b9a68a')
  windowFrame(w, 'day', Math.floor(w.width * 0.72), 4, 18, 14)
  wallClock(w, Math.floor(w.width * 0.67), 7)
  tutor(w, 'board', bx + bw + 2, 14)
  // The class, from behind; a hand goes up now and then
  for (let i = 0; i < Math.floor(w.width / 16); i++) {
    const sx = 4 + i * 16
    student(w, sx, 31, i, { back: true, hand: (Math.floor(w.tick / 20) + i * 3) % 7 === 0 })
    rect(w, sx - 2, 37, 11, 2, '#6f4628')
  }
}

function readingRoom(w: World) {
  room(w, 31, '#4a3a2e', '#433426', '#5a4030', '#4a3426')
  for (let x = 2; x < w.width - 20; x += Math.floor(w.width / 4)) shelf(w, x, 2, 20, 3)
  // A long table with lamps and readers
  const ty = 30
  rect(w, 6, ty, w.width - 12, 2, '#8a5a36')
  for (let i = 0; i < Math.floor((w.width - 30) / 22); i++) {
    const rx = 14 + i * 22
    student(w, rx, ty - 7, i + 2, { writing: i % 2 === 1 })
    rect(w, rx + 1, ty - 1, 5, 1, '#f4efe4')
    if (i % 2 === 0) {
      rect(w, rx + 10, ty - 6, 1, 6, '#c8a46b')
      rect(w, rx + 8, ty - 8, 5, 2, '#5f9a4f')
      glow(w, rx + 10, ty - 6, 12, 'rgba(255,220,140,A)', 0.22)
    }
  }
  // Someone browsing the shelves, the tutor in an armchair, a cat on the table
  const bx = ((w.tick * 0.25) % (w.width * 0.5)) + w.width * 0.25
  person(w, bx, 19, 5, Math.floor(w.tick / 3), (Math.floor(w.tick / 80) % 2 ? -1 : 1) as 1 | -1)
  const ax = w.width - 28
  rect(w, ax - 2, 24, 26, 12, '#7a3e3e')
  tutor(w, 'book', ax, 16)
  cat(w, 24, ty - 3, true, '#8b8681')
}

function examHall(w: World) {
  room(w, 26, '#dcd3c3', '#cfc4b0', '#a88a66', '#957555')
  wallClock(w, Math.floor(w.width / 2), 8, true)
  rect(w, Math.floor(w.width / 2) - 12, 14, 24, 1, '#8a7a66')
  tutor(w, 'stopwatch', 4, 10)
  // Rows of desks, heads down, pencils going
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < Math.floor((w.width - 34) / 18); i++) {
      const sx = 32 + i * 18 + (row % 2) * 6
      const sy = 18 + row * 11
      student(w, sx, sy, i + row * 3, { back: row === 1, writing: true })
      rect(w, sx - 1, sy + 6, 9, 2, '#6f4628')
      rect(w, sx + 1, sy + 5, 4, 1, '#f4efe4')
    }
}

function workshop(w: World) {
  room(w, 30, '#cfd8d6', '#c2ccca', '#8f8f8f', '#7c7c7c')
  // A whiteboard with boxes and arrows (a design taking shape)
  const wx = Math.floor(w.width * 0.5)
  rect(w, wx - 1, 3, 46, 20, '#a9b1b0')
  rect(w, wx, 4, 44, 18, '#f7f8f6')
  const boxes: [number, number][] = [[3, 3], [17, 3], [31, 3], [10, 12], [24, 12]]
  boxes.forEach(([bx, by], i) => {
    if ((w.tick >> 4) % 6 < i) return
    for (let dx = 0; dx < 9; dx++) (px(w, wx + bx + dx, 4 + by, '#3f6f9e'), px(w, wx + bx + dx, 4 + by + 4, '#3f6f9e'))
    for (let dy = 0; dy < 5; dy++) (px(w, wx + bx, 4 + by + dy, '#3f6f9e'), px(w, wx + bx + 8, 4 + by + dy, '#3f6f9e'))
  })
  plant(w, w.width - 10, 25)
  // Pair programming: the tutor and a student side by side
  const dx = Math.floor(w.width * 0.08)
  tutor(w, 'laptop', dx, 14)
  student(w, dx + 26, 21, 4)
  rect(w, dx - 2, 28, 46, 2, '#5b5f66')
  rect(w, dx, 30, 2, 8, '#45484e')
  rect(w, dx + 40, 30, 2, 8, '#45484e')
  rect(w, dx + 34, 25, 3, 3, '#b8433a')
  steam(w, dx + 35, 24)
}

function porch(w: World) {
  sky(w, 'sunset', 0, 28)
  hills(w, 22, '#5d4a6e', 3, 2)
  grass(w, 27, '#5e8a4e', '#4e7642', false)
  // The road, and someone waving on their way home
  rect(w, 0, 27, w.width, 2, '#8a7a66')
  walker(w, 17, 0, 0.25, 40)
  // The porch
  rect(w, 0, 32, Math.floor(w.width * 0.6), 8, '#7a5638')
  for (let x = 0; x < w.width * 0.6; x += 4) rect(w, x, 25, 1, 7, '#9a7350')
  rect(w, 0, 25, Math.floor(w.width * 0.6), 1, '#9a7350')
  tutor(w, 'tea', 10, 17)
  dog(w, 40, 29, 0, 1, '#c8a46b')
  if ((w.tick >> 3) % 2) px(w, 50, 26, '#c9d3f2')
  // A lantern, and fireflies
  rect(w, Math.floor(w.width * 0.58), 14, 3, 4, '#f3d08a')
  glow(w, Math.floor(w.width * 0.58) + 1, 16, 16, 'rgba(255,210,120,A)', 0.3)
  for (let i = 0; i < 6; i++) if ((w.tick + i * 13) % 24 < 14) px(w, (rand(i + 50) * w.width + Math.sin((w.tick + i * 9) / 12) * 4) % w.width, 14 + rand(i + 60) * 12, '#f6f0a0')
}

function observatory(w: World) {
  sky(w, 'night', 0, 32)
  // Constellations: the brightest stars joined up
  const stars: [number, number][] = Array.from({ length: 7 }, (_, i) => [Math.floor(w.width * (0.35 + i * 0.08)), 6 + Math.floor(rand(i + 200) * 14)])
  w.ctx.globalAlpha = 0.35
  for (let i = 1; i < stars.length; i++) {
    const [x0, y0] = stars[i - 1]
    const [x1, y1] = stars[i]
    for (let t = 0; t <= 1; t += 0.05) px(w, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, '#c9d3f2')
  }
  w.ctx.globalAlpha = 1
  stars.forEach(([x, y], i) => {
    px(w, x, y, '#fff6d8')
    if ((w.tick + i * 5) % 18 < 9) (px(w, x - 1, y, '#9fb0e0'), px(w, x + 1, y, '#9fb0e0'))
  })
  hills(w, 30, '#1c2238', 2, 1)
  // The observatory dome, the tutor at the telescope, a student pointing
  rect(w, w.width - 30, 18, 24, 14, '#4a5068')
  for (let dx = 0; dx < 24; dx++) for (let dy = 0; dy < 8; dy++) if ((dx - 12) ** 2 / 144 + (dy - 8) ** 2 / 64 <= 1) px(w, w.width - 30 + dx, 10 + dy, '#5b6380')
  rect(w, w.width - 20, 10, 3, 8, '#2a2f42')
  tutor(w, 'telescope', 6, 18)
  person(w, 34, 24, 2, 0, -1)
  px(w, 33, 22, LOOKS[2].skin)
  px(w, 32, 21, LOOKS[2].skin)
}

// ---------- A tiny pixel font, so maths and code on screens and boards are real ----------

/** 3 x 5 glyphs: each string is five rows of three columns, '#' for ink */
const GLYPHS: Record<string, string> = {
  '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.', '4': '#.#|#.#|###|..#|..#',
  '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.', '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.', E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..',
  G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#', I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#.#|###|###|#.#|#.#', N: '##.|#.#|#.#|#.#|#.#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..', Q: '.#.|#.#|#.#|.#.|..#', R: '##.|#.#|##.|#.#|#.#',
  S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.', U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#.#|#.#|###|###|#.#', X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  '+': '...|.#.|###|.#.|...', '-': '...|...|###|...|...', '=': '...|###|...|###|...', '*': '...|#.#|.#.|#.#|...', '/': '..#|..#|.#.|#..|#..',
  '^': '.#.|#.#|...|...|...', '(': '.#.|#..|#..|#..|.#.', ')': '.#.|..#|..#|..#|.#.', '.': '...|...|...|...|.#.', ',': '...|...|...|.#.|#..',
  ':': '...|.#.|...|.#.|...', '!': '.#.|.#.|.#.|...|.#.', '?': '##.|..#|.#.|...|.#.', '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..',
  '[': '##.|#..|#..|#..|##.', ']': '.##|..#|..#|..#|.##', '_': '...|...|...|...|###', '"': '#.#|#.#|...|...|...', "'": '.#.|.#.|...|...|...',
  '#': '#.#|###|#.#|###|#.#', '%': '#.#|..#|.#.|#..|#.#', ';': '...|.#.|...|.#.|#..', '{': '.##|.#.|##.|.#.|.##', '}': '##.|.#.|.##|.#.|##.',
  π: '...|###|#.#|#.#|#.#', '√': '..#|..#|#.#|.##|..#', Σ: '###|#..|.#.|#..|###', '∫': '.##|.#.|.#.|.#.|##.', '²': '##.|.#.|##.|...|...',
  '→': '...|..#|###|..#|...', θ: '.#.|#.#|###|#.#|.#.', λ: '#..|.#.|.#.|#.#|#.#', '∞': '...|...|###|#.#|###', ' ': '...|...|...|...|...'
}

/** Writes text in the pixel font; returns how wide it was. Lower case is drawn as capitals. */
export function text(w: World, x: number, y: number, s: string, colour: string, limit = Infinity): number {
  let cx = x
  for (const ch of s.slice(0, limit)) {
    const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?']
    g.split('|').forEach((row, dy) => [...row].forEach((v, dx) => v === '#' && px(w, cx + dx, y + dy, colour)))
    cx += 4
  }
  return cx - x
}

/** Lines written out a character at a time, then wiped and begun again */
function typeOut(w: World, x: number, y: number, lines: string[], colour: string, speed = 1, lineGap = 7, colours?: string[]) {
  const total = lines.reduce((n, l) => n + l.length, 0)
  const at = Math.floor((w.tick * speed) / 2) % (total + 30)
  let left = at
  lines.forEach((l, i) => {
    if (left <= 0) return
    text(w, x, y + i * lineGap, l, colours?.[i] ?? colour, left)
    left -= l.length
  })
  // The cursor
  if (w.tick % 4 < 2 && at <= total) {
    let n = at
    let row = 0
    while (row < lines.length && n > lines[row].length) (n -= lines[row].length), row++
    if (row < lines.length) rect(w, x + n * 4, y + row * lineGap, 3, 5, colour)
  }
}

// ---------- More places ----------

/** Working through maths at the board: real equations, written out stroke by stroke */
function mathStudy(w: World) {
  room(w, 31, '#d9c6a2', '#c9b48f', '#9a6d47', '#86603e')
  const bx = Math.floor(w.width * 0.2)
  const bw = Math.min(150, Math.floor(w.width * 0.6))
  rect(w, bx - 1, 2, bw + 2, 26, '#7a5638')
  rect(w, bx, 3, bw, 24, '#2f4a3a')
  const sets = [
    ['A²+B²=C²', 'E^(Iπ)+1=0', 'Σ 1/N² = π²/6'],
    ['D/DX X² = 2X', '∫ X DX = X²/2', 'LIM 1/N = 0'],
    ['P(A|B) = P(B|A)P(A)/P(B)', 'E[X] = Σ X P(X)', 'VAR = E[X²]-E[X]²']
  ].map((s) => s.map((l) => l.replace('|', '/')))
  const set = sets[Math.floor(w.tick / 260) % sets.length]
  typeOut(w, bx + 4, 6, set, '#e9e6dc', 1, 7)
  tutor(w, 'board', bx + bw + 2, 15)
  shelf(w, w.width - 26, 6, 22, 3)
  plant(w, 6, 25)
}

/** A den with a glowing terminal: code typed out in green, line by line */
function terminalDen(w: World) {
  room(w, 31, '#262833', '#22242e', '#33323a', '#2b2a31')
  const sx = Math.floor(w.width * 0.42)
  const sw = Math.min(150, Math.floor(w.width * 0.5))
  rect(w, sx - 2, 2, sw + 4, 27, '#3a3d44')
  rect(w, sx, 4, sw, 23, '#0d1410')
  glow(w, sx + sw / 2, 15, sw * 0.7, 'rgba(80,220,120,A)', 0.1)
  const programs = [
    ['DEF FIB(N):', '  A, B = 0, 1', '  FOR _ IN RANGE(N):', '    A, B = B, A+B', '  RETURN A'],
    ['$ GIT COMMIT -M "FIX"', '$ PYTEST -Q', '12 PASSED IN 0.4S', '$ _'],
    ['SELECT NAME, SUM(X)', '  FROM SALES', '  GROUP BY NAME', '  ORDER BY 2 DESC;']
  ]
  const prog = programs[Math.floor(w.tick / 300) % programs.length]
  typeOut(w, sx + 3, 6, prog, '#7ef29a', 1.2, 4.4)
  // Scanlines
  w.ctx.globalAlpha = 0.12
  for (let y = 4; y < 27; y += 2) rect(w, sx, y, sw, 1, '#000')
  w.ctx.globalAlpha = 1
  rect(w, sx + sw / 2 - 6, 29, 12, 2, '#3a3d44')
  tutor(w, 'laptop', Math.floor(w.width * 0.1), 15)
  rect(w, Math.floor(w.width * 0.1) - 2, 29, 30, 2, '#4a4a52')
  // A mug, and the cat asleep on the warm monitor
  rect(w, sx - 8, 26, 3, 3, '#b8433a')
  steam(w, sx - 7, 25)
  cat(w, sx + sw - 12, 0, true, '#8b8681')
}

/** On Mars: red dust, two moons, a little rover, the tutor in a helmet */
function mars(w: World) {
  // A dusty pink sky, darker at the top
  for (let y = 0; y < 26; y++) for (let x = 0; x < w.width; x++) px(w, x, y, y < 8 ? '#3a1f2a' : y < 16 ? ((x + y) % 2 ? '#7a3b33' : '#6a3330') : '#b36a4a')
  for (let i = 0; i < w.width / 8; i++) if ((w.tick + i * 9) % 50 > 2) px(w, Math.floor(rand(i + 300) * w.width), Math.floor(rand(i + 330) * 7), '#f1d9c7')
  // Phobos and Deimos
  for (const [mx, my, r] of [[w.width * 0.2, 5, 2], [w.width * 0.8, 3, 1]] as const) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) px(w, mx + dx, my + dy, '#d8c3b0')
  hills(w, 22, '#8a4632', 3, 2)
  hills(w, 27, '#a3553a', 6, 2)
  for (let y = 30; y < w.height; y++) for (let x = 0; x < w.width; x++) px(w, x, y, (x * 5 + y * 3) % 13 === 0 ? '#8a4632' : '#c06a45')
  // Rocks and drifting dust
  for (let i = 0; i < 8; i++) rect(w, Math.floor(rand(i + 360) * w.width), 31 + Math.floor(rand(i + 370) * 6), 3, 2, '#7a3b2a')
  for (let i = 0; i < 12; i++) px(w, (rand(i + 400) * w.width + w.tick * 0.5) % w.width, 24 + rand(i + 410) * 12, '#e2a07a')
  // The rover trundles back and forth
  const rx = Math.floor(w.width * 0.55 + Math.sin(w.tick / 40) * w.width * 0.15)
  rect(w, rx, 30, 12, 4, '#d8d4cc')
  rect(w, rx + 2, 27, 3, 3, '#8b8681')
  px(w, rx + 3, 26, w.tick % 6 < 3 ? '#e8463b' : '#8b8681')
  for (const wx of [0, 4, 8]) (rect(w, rx + wx, 34, 3, 2, '#2a2622'), px(w, rx + wx + ((w.tick >> 1) % 2), 34, '#5b5f66'))
  // The tutor, helmeted (a glass bubble round the face), with a flag
  const tx = Math.floor(w.width * 0.18)
  tutor(w, 'wave', tx, 17)
  w.ctx.globalAlpha = 0.28
  for (let dy = -1; dy <= 13; dy++) for (let dx = -1; dx <= 16; dx++) if ((dx - 7.5) ** 2 / 81 + (dy - 6) ** 2 / 64 <= 1 && (dx - 7.5) ** 2 / 64 + (dy - 6) ** 2 / 49 > 1) px(w, tx + dx, 17 + dy, '#e8f4ff')
  w.ctx.globalAlpha = 1
  rect(w, tx + 30, 18, 1, 14, '#d8d4cc')
  rect(w, tx + 31, 18, 7, 4, '#3f6f9e')
  text(w, tx + 32, 18, w.tick % 20 < 10 ? 'T' : 'T', '#f4efe4')
}

/** The week on a corkboard: a card a day, filled with what's planned and ticked when done */
function planner(w: World) {
  room(w, 31, '#e3d6bd', '#d6c7aa', '#9a6d47', '#86603e')
  const days = (w.data?.days as { label: string; planned: number; done: number; today?: boolean }[] | undefined) ?? 'MTWTFSS'.split('').map((label, i) => ({ label, planned: (i * 3) % 4, done: i < 2 ? (i * 3) % 4 : 0, today: i === 2 }))
  const bw = Math.min(w.width - 60, 7 * 18 + 10)
  const bx = Math.floor((w.width - bw) / 2) + 14
  rect(w, bx - 2, 2, bw + 4, 27, '#7a5638')
  rect(w, bx, 4, bw, 23, '#c49a6c')
  for (let i = 0; i < 40; i++) px(w, bx + Math.floor(rand(i + 500) * bw), 4 + Math.floor(rand(i + 520) * 23), '#b38a5e')
  days.forEach((d, i) => {
    const cx = bx + 5 + i * 18
    const cy = 7 + (i % 2)
    rect(w, cx, cy, 14, 17, d.today ? '#fff6d8' : '#f4efe4')
    px(w, cx + 7, cy, '#b8433a')
    text(w, cx + 5, cy + 2, d.label, d.today ? '#b8433a' : '#5b5f66')
    for (let k = 0; k < Math.min(4, d.planned); k++) {
      rect(w, cx + 2, cy + 9 + k * 2, 10, 1, k < d.done ? '#5f9a4f' : '#a9a49a')
      if (k < d.done) px(w, cx + 12, cy + 9 + k * 2, '#3f7a4a')
    }
  })
  tutor(w, 'wave', bx - 26, 15)
  plant(w, w.width - 10, 25)
}

/**
 * Reviewing cards: the tutor at a desk by the window with the card box, flipping the top card over
 * (it turns edge-on, then shows its other side), sorting it onto "again" or "got it". The pile to
 * go shrinks with `data.left`; outside a session he just sorts the box.
 */
function flashcards(w: World) {
  room(w, 31, '#d9e4dc', '#ccd9cf', '#9a6d47', '#86603e')
  // A window with the afternoon outside
  const wx = Math.floor(w.width * 0.08)
  rect(w, wx - 1, 3, 30, 20, '#7a5638')
  rect(w, wx, 4, 28, 18, '#a8d4ee')
  for (let i = 0; i < 3; i++) rect(w, wx + ((i * 11 + (w.tick >> 3)) % 26), 7 + i * 4, 4, 1, '#ffffff')
  rect(w, wx, 16, 28, 6, '#8cc07a')
  rect(w, wx + 13, 4, 1, 18, '#7a5638')
  // The desk
  const dw = Math.min(104, Math.floor(w.width * 0.42))
  const dx = Math.floor((w.width - dw) / 2) + 10
  // The tutor sits behind the desk, so he goes in first
  tutor(w, 'cards', dx + dw - 30, 9)
  rect(w, dx, 22, dw, 2, '#7a5638')
  rect(w, dx + 2, 24, 2, 7, '#6b4a30')
  rect(w, dx + dw - 4, 24, 2, 7, '#6b4a30')
  // The card box, tabs sticking up
  rect(w, dx + 4, 16, 18, 6, '#b8433a')
  for (let i = 0; i < 6; i++) rect(w, dx + 6 + i * 3, 14 + (i % 2), 2, 2, ['#f4c95d', '#8fc1e3', '#b7e07a'][i % 3])
  // The pile still to go, shrinking as you work through it
  const left = Math.max(0, Math.min(12, Number(w.data?.left ?? 6)))
  for (let i = 0; i < Math.ceil(left / 2); i++) rect(w, dx + 28, 20 - i, 12, 1, i % 2 ? '#efe9dc' : '#f7f3ea')
  // The card being flipped: full width, edge-on, then its back
  const cycle = w.tick % 48
  const fx = dx + 42
  const widths = [12, 12, 12, 12, 9, 5, 1, 5, 9, 12]
  const fw = cycle < 30 ? 12 : widths[Math.min(widths.length - 1, Math.floor((cycle - 30) / 2))]
  const back = cycle >= 36
  rect(w, fx + (12 - fw) / 2, 13, fw, 8, back ? '#fff6d8' : '#f7f3ea')
  if (fw > 6) {
    rect(w, fx + 2 + (12 - fw) / 2, 15, fw - 4, 1, back ? '#5f9a4f' : '#5b5f66')
    rect(w, fx + 2 + (12 - fw) / 2, 17, fw - 6, 1, back ? '#5f9a4f' : '#a9a49a')
  }
  // Sorted piles: again (red tab) and got it (green tab)
  rect(w, dx + 56, 20, 10, 2, '#f7f3ea')
  px(w, dx + 56, 19, '#b8433a')
  const done = 1 + ((w.tick >> 5) % 4)
  for (let i = 0; i < done; i++) rect(w, dx + dw - 14, 21 - i, 10, 1, i % 2 ? '#efe9dc' : '#f7f3ea')
  px(w, dx + dw - 5, 21 - done, '#5f9a4f')
  // Tea, and the tutor behind the desk
  rect(w, dx + dw + 2, 18, 5, 4, '#e8e2d6')
  if ((w.tick >> 2) % 3) px(w, dx + dw + 4, 16 - ((w.tick >> 2) % 2), '#cfd6dc')
  plant(w, w.width - 10, 26)
}

/**
 * Writing an outline: the tutor reads from an open book and the topics arc out of it like a
 * fountain, landing line by line on a long scroll. `data.count` is how many are written so far,
 * `data.live` whether it's still going; when it's done the scroll is full and the fountain rests.
 */
function drafting(w: World) {
  room(w, 32, '#2f3a4a', '#2b3544', '#5b4a3a', '#4c3d30')
  const live = w.data?.live !== false
  const count = Math.max(0, Number(w.data?.count ?? 0))
  // A lamp for the evening
  const lx = Math.floor(w.width * 0.12)
  rect(w, lx, 6, 1, 20, '#3d3328')
  rect(w, lx - 4, 4, 9, 3, '#e0b25c')
  glow(w, lx, 8, 34, 'rgba(255,205,120,A)', 0.2)
  // The scroll: two wooden rollers, the paper between
  const sw = Math.min(120, Math.floor(w.width * 0.36))
  const sx = Math.floor(w.width * 0.52)
  rect(w, sx - 2, 2, sw + 4, 2, '#8a5a36')
  rect(w, sx - 2, 29, sw + 4, 2, '#8a5a36')
  rect(w, sx, 4, sw, 25, '#f1e6cc')
  for (let i = 0; i < 24; i++) px(w, sx + Math.floor(rand(i + 900) * sw), 4 + Math.floor(rand(i + 930) * 25), '#e6d8b8')
  const rows = 11
  const colW = Math.floor((sw - 8) / 2)
  const cap = rows * 2
  // Once it overflows the newest lines keep scrolling in at the bottom
  const shown = Math.min(cap, count)
  const offset = Math.max(0, count - cap)
  const slot = (i: number) => ({ x: sx + 3 + Math.floor(i / rows) * (colW + 2), y: 6 + (i % rows) * 2 })
  for (let i = 0; i < shown; i++) {
    const { x, y } = slot(i)
    px(w, x, y, '#9a8a70')
    const len = 5 + Math.floor(rand(i + offset + 960) * (colW - 8))
    rect(w, x + 2, y, len, 1, live && i === shown - 1 ? '#b8433a' : '#5b5f66')
  }
  // The tutor with the book, and the fountain of topics from it to the next free line
  const tx = sx - 34
  tutor(w, live ? 'book' : 'wave', tx, 15)
  if (live) {
    const from = { x: tx + 14, y: 21 }
    const to = slot(Math.min(shown, cap - 1))
    const colours = ['#f4c95d', '#8fc1e3', '#f08a5d', '#b7e07a']
    for (let i = 0; i < 12; i++) {
      const t = ((w.tick * 1.3 + i * 3.4) % 40) / 40
      const x = from.x + (to.x - from.x) * t
      // A low arc that stays inside the strip
      const y = Math.max(1, from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * Math.min(12, Math.min(from.y, to.y) - 1))
      px(w, x, y, colours[i % colours.length])
      if (t > 0.08) px(w, x - (to.x - from.x) / 40, y + 1, 'rgba(255,255,255,0.25)')
    }
    glow(w, from.x, from.y, 12, 'rgba(255,230,160,A)', 0.25)
  } else if (w.tick % 24 < 12) {
    // Done: a little sparkle on the finished scroll
    const k = Math.floor(w.tick / 24)
    px(w, sx + 4 + Math.floor(rand(k + 990) * (sw - 8)), 5 + Math.floor(rand(k + 991) * 22), '#ffffff')
  }
  plant(w, w.width - 10, 27)
}

/** Reading out a storm: rain on a tall window, lightning now and then, the fire going */
function rainyLibrary(w: World) {
  room(w, 32, '#3c3029', '#352a24', '#4a3527', '#3a2a20')
  // Floor-to-ceiling shelves, with a ladder
  shelf(w, 2, 2, Math.floor(w.width * 0.18), 4)
  shelf(w, w.width - Math.floor(w.width * 0.18) - 2, 2, Math.floor(w.width * 0.18), 4)
  const lx = Math.floor(w.width * 0.16)
  for (let y = 4; y < 32; y++) (px(w, lx, y, '#8a5a36'), px(w, lx + 5, y, '#8a5a36'), y % 4 === 0 && rect(w, lx, y, 6, 1, '#8a5a36'))
  // The window: an arch onto a stormy sky, rain streaking down, drops on the glass
  const wx = Math.floor(w.width * 0.42)
  const ww = Math.min(60, Math.floor(w.width * 0.2))
  const flash = w.tick % 160 < 3 || (w.tick % 160 > 5 && w.tick % 160 < 7)
  for (let y = 2; y < 30; y++)
    for (let x = wx; x < wx + ww; x++) {
      const arch = y > 2 + ww / 2 - Math.sqrt(Math.max(0, (ww / 2) ** 2 - (x - wx - ww / 2) ** 2))
      if (!arch) continue
      px(w, x, y, flash ? '#c9d6e8' : y < 12 ? '#3a4558' : '#4a566b')
    }
  for (let i = 0; i < ww * 1.5; i++) {
    const rx = wx + ((rand(i + 600) * ww + w.tick * 0.3) % ww)
    const ry = 2 + ((rand(i + 640) * 28 + w.tick * 2.2) % 28)
    if (ry + 2 < 30) (px(w, rx, ry, '#9fb4cf'), px(w, rx - 0.5, ry + 1, '#7f93ad'))
  }
  for (let i = 0; i < 6; i++) {
    const dx = wx + 3 + Math.floor(rand(i + 700) * (ww - 6))
    const dy = 8 + ((rand(i + 720) * 20 + w.tick * 0.15 * (1 + (i % 3))) % 20)
    px(w, dx, dy, '#d6e3f2')
  }
  // Mullions and sill, the cat on it watching
  rect(w, wx + ww / 2 - 1, 2 + ww / 2 - 4, 2, 28 - ww / 2 + 2, '#5a4636')
  rect(w, wx, 18, ww, 1, '#5a4636')
  rect(w, wx - 3, 30, ww + 6, 2, '#6b5242')
  cat(w, wx + 4, 27, false, '#8b8681')
  // The fire, and its light
  const fx = Math.floor(w.width * 0.25)
  rect(w, fx, 17, 20, 15, '#5a4a48')
  rect(w, fx + 3, 22, 14, 10, '#1d1414')
  for (let i = 0; i < 10; i++) {
    const h = 2 + ((w.tick + i * 3) % 5)
    rect(w, fx + 5 + i, 31 - h, 1, h, i % 3 ? '#f08a3c' : '#ffd36b')
  }
  glow(w, fx + 10, 28, 40, 'rgba(255,170,80,A)', 0.26)
  if (flash) {
    w.ctx.globalAlpha = 0.12
    rect(w, 0, 0, w.width, w.height, '#dfe8f6')
    w.ctx.globalAlpha = 1
  }
  // The tutor in an armchair with a book, tea on a little table
  const ax = Math.floor(w.width * 0.66)
  rect(w, ax - 2, 24, 26, 12, '#7a3e3e')
  rect(w, ax - 4, 20, 4, 16, '#6a3434')
  tutor(w, 'book', ax, 16)
  rect(w, ax + 26, 29, 8, 2, '#6f4628')
  rect(w, ax + 28, 26, 3, 3, '#f4efe4')
  steam(w, ax + 29, 25)
}

/** Flying over the fields in a little biplane, towing a banner */
function biplane(w: World) {
  sky(w, 'day', 0, 30)
  // Patchwork fields far below
  for (let y = 30; y < w.height; y++) for (let x = 0; x < w.width; x++) px(w, x, y, ['#86bf6c', '#a6cf7a', '#d9c49a', '#7fb07c'][(Math.floor((x + w.tick * 0.4) / 14) + Math.floor(y / 3)) % 4])
  // Clouds rushing past, some in front
  for (let i = 0; i < 5; i++) {
    const span = w.width + 40
    const cx = span - ((rand(i + 800) * span + w.tick * (0.8 + i * 0.25)) % span) - 20
    const cy = 4 + Math.floor(rand(i + 820) * 20)
    for (const [dx, dy, len] of [[3, 0, 7], [0, 1, 14], [1, 2, 12]] as const) for (let k = 0; k < len; k++) px(w, cx + dx + k, cy + dy, '#ffffff')
  }
  // The plane bobs; propeller spins; the scarf flaps
  const bob = Math.round(Math.sin(w.tick / 6))
  const px0 = Math.floor(w.width * 0.55)
  const py = 10 + bob
  rect(w, px0, py + 6, 22, 4, '#c8463b') // fuselage
  rect(w, px0 + 3, py + 2, 16, 1, '#e8a33c') // top wing
  rect(w, px0 + 3, py + 10, 16, 1, '#e8a33c') // bottom wing
  for (const sx of [px0 + 5, px0 + 16]) rect(w, sx, py + 3, 1, 7, '#6b4a33')
  rect(w, px0 - 2, py + 4, 2, 7, '#c8463b') // tail
  rect(w, px0 + 22, py + 5, 1, 6, w.tick % 2 ? '#f4efe4' : '#8b8681') // propeller
  // The tutor in the cockpit: just the top of the head and the goggles
  const g = professorFrame('happy', 0, false, w.character)
  const colours = paletteFor(w.character)
  for (let r = 1; r <= 8; r++) g[r].forEach((v, c) => v !== '.' && c >= 3 && c <= 12 && px(w, px0 + 6 + (c - 3), py - 3 + r, colours[v]))
  rect(w, px0 + 6, py + 6, 10, 1, '#5f4630')
  for (let k = 0; k < 4; k++) px(w, px0 + 6 - k, py + 6 + (((w.tick >> 1) + k) % 2), '#e86a7a')
  // The banner
  const bx = px0 - 66
  for (let k = 0; k < 6; k++) px(w, bx + 60 + k, py + 8 + (k % 2), '#8b8681')
  rect(w, bx, py + 5, 60, 9, '#f4efe4')
  for (let k = 0; k < 9; k++) px(w, bx - 1 - ((w.tick + k) % 2), py + 5 + k, '#f4efe4')
  text(w, bx + 2, py + 7, 'READ MORE BOOKS', '#b8433a')
}
