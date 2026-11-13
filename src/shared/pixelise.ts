/**
 * A pixel sprite of you, made from your photo on this Mac: no model, no network. The same input
 * always gives the same sprite.
 *
 * 1. Downscale the framed photo to size × size by averaging each cell.
 * 2. Find the backdrop: grow a region in from the top and the upper sides (the bottom is your
 *    shoulders) through colours close to the border's own.
 * 3. Quantise you to a small palette with k-means in OKLab, started from a median cut, after a
 *    gentle lift in contrast and colour so it reads as a sprite rather than a blurry photo.
 * 4. Clean up: drop lone pixels and specks, then draw a soft outline around the silhouette in a
 *    darker shade of your own darkest colour, as the Professor's sprites have.
 * 5. Eyes: found in the photo (two dark, compact patches ringed by skin, side by side in the
 *    band where eyes are) and drawn as solid dark pixels with a light catchlight, so they don't
 *    melt into the face at 32 px. They are also the sprite's blinking pixels.
 * 6. The backdrop is either a flat colour from the photo or nothing (transparent).
 *
 * The palette counts every colour drawn, outline and backdrop included, sorted dark to light.
 */

export interface PixelSprite {
  size: number
  /** '#rrggbb', dark to light */
  palette: string[]
  /** Row-major palette indices; -1 is transparent */
  pixels: number[]
  /** How many colours were asked for */
  colours: number
  /** Whether it has a flat backdrop */
  background: boolean
  /** Pixels you marked as eyes, closed for a blink */
  eyes: number[]
}

export interface RGBAImage {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface PixelOptions {
  size: number
  colours: number
  background: boolean
  /** A soft outline around you (on unless turned off) */
  outline?: boolean
}

export const MIN_SIZE = 16
export const MAX_SIZE = 48
export const SIZES = [24, 32, 40] as const
export const MIN_COLOURS = 4
export const MAX_COLOURS = 16

type Lab = [number, number, number]

// ---------- Colour ----------

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export function labToRgb([L, a, b]: Lab): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}

const hex = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
export const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
const mean = (ps: Lab[]): Lab => {
  const s: Lab = [0, 0, 0]
  for (const p of ps) for (let i = 0; i < 3; i++) s[i] += p[i]
  return ps.length ? [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length] : [0.5, 0, 0]
}

// ---------- 1. Downscale ----------

/**
 * Each output cell is the mean of the source pixels whose centres fall in it, in linear light. A
 * cell that holds a small dark detail (an eye, a brow, the line of the hair) leans towards it, so
 * the features survive the shrink instead of melting into skin.
 */
export function downscale(img: RGBAImage, size: number): { lab: Lab[]; alpha: number[] } {
  const { width: w, height: h, data } = img
  const lin = new Float32Array(w * h * 3)
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) lin[p * 3 + c] = toLinear(data[p * 4 + c])
  const edge = (n: number, total: number) => Array.from({ length: size + 1 }, (_, k) => Math.round((k * total) / size)).map((v) => Math.min(total, v))[n]
  const lab: Lab[] = []
  const alpha: number[] = []
  for (let cy = 0; cy < size; cy++) {
    const y0 = edge(cy, h)
    const y1 = Math.max(y0 + 1, edge(cy + 1, h))
    for (let cx = 0; cx < size; cx++) {
      const x0 = edge(cx, w)
      const x1 = Math.max(x0 + 1, edge(cx + 1, w))
      let r = 0, g = 0, b = 0, a = 0, n = 0, Y = 0
      for (let y = y0; y < Math.min(h, y1); y++)
        for (let x = x0; x < Math.min(w, x1); x++) {
          const p = y * w + x
          const al = data[p * 4 + 3] / 255
          r += lin[p * 3] * al
          g += lin[p * 3 + 1] * al
          b += lin[p * 3 + 2] * al
          Y += (0.2126 * lin[p * 3] + 0.7152 * lin[p * 3 + 1] + 0.0722 * lin[p * 3 + 2]) * al
          a += al
          n++
        }
      const d = a || 1e-9
      let out = [r / d, g / d, b / d]
      const meanY = Y / d
      // The dark detail in the cell, if there is a little of it
      let dr = 0, dg = 0, db = 0, dn = 0
      for (let y = y0; y < Math.min(h, y1); y++)
        for (let x = x0; x < Math.min(w, x1); x++) {
          const p = y * w + x
          if (data[p * 4 + 3] < 128) continue
          const py = 0.2126 * lin[p * 3] + 0.7152 * lin[p * 3 + 1] + 0.0722 * lin[p * 3 + 2]
          if (py < meanY * 0.5) {
            dr += lin[p * 3]
            dg += lin[p * 3 + 1]
            db += lin[p * 3 + 2]
            dn++
          }
        }
      const share = n ? dn / n : 0
      if (share >= 0.12 && share < 0.6) out = [dr / dn, dg / dn, db / dn].map((v, i) => v * 0.6 + out[i] * 0.4)
      lab.push(rgbToLab(fromLinear(out[0]), fromLinear(out[1]), fromLinear(out[2])))
      alpha.push(n ? a / n : 0)
    }
  }
  return { lab, alpha }
}

// ---------- 2. The backdrop ----------

/** k-means with fixed starting points: deterministic */
function kmeans(points: Lab[], seeds: Lab[], rounds = 10): { centres: Lab[]; labels: number[] } {
  let centres = seeds.map((c) => [...c] as Lab)
  let labels = new Array(points.length).fill(0)
  for (let r = 0; r < rounds; r++) {
    let moved = false
    labels = points.map((p, i) => {
      let best = 0
      let bd = Infinity
      centres.forEach((c, k) => {
        const d = dist2(p, c)
        if (d < bd) {
          bd = d
          best = k
        }
      })
      if (best !== labels[i]) moved = true
      return best
    })
    centres = centres.map((c, k) => {
      const members = points.filter((_, i) => labels[i] === k)
      return members.length ? mean(members) : c
    })
    if (!moved && r > 0) break
  }
  return { centres, labels }
}

/** Median cut: split the widest box at its median until there are k; the boxes' means seed k-means */
function medianCut(points: Lab[], k: number): Lab[] {
  let boxes: Lab[][] = [points.slice()]
  while (boxes.length < k) {
    let pick = -1
    let widest = 0
    let axis = 0
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      for (let ax = 0; ax < 3; ax++) {
        let lo = Infinity
        let hi = -Infinity
        for (const p of b) {
          lo = Math.min(lo, p[ax])
          hi = Math.max(hi, p[ax])
        }
        // Lightness counts for more: it's what shapes a face at this size
        const span = (hi - lo) * (ax === 0 ? 1.4 : 1) * Math.sqrt(b.length)
        if (span > widest) {
          widest = span
          pick = i
          axis = ax
        }
      }
    })
    if (pick < 0) break
    const box = boxes[pick].slice().sort((p, q) => p[axis] - q[axis])
    const half = Math.floor(box.length / 2)
    boxes = [...boxes.slice(0, pick), box.slice(0, half), box.slice(half), ...boxes.slice(pick + 1)]
  }
  return boxes.filter((b) => b.length).map(mean)
}

const neighbours4 = (i: number, size: number): number[] => {
  const x = i % size
  const y = (i - x) / size
  const out: number[] = []
  if (x > 0) out.push(i - 1)
  if (x < size - 1) out.push(i + 1)
  if (y > 0) out.push(i - size)
  if (y < size - 1) out.push(i + size)
  return out
}
const neighbours8 = (i: number, size: number): number[] => {
  const x = i % size
  const y = (i - x) / size
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx)
    }
  return out
}

/**
 * Which cells are backdrop: grown from the top row and the upper two thirds of the sides, through
 * cells close to a neighbour already in it and to one of the border's own colours.
 */
export function backdropMask(lab: Lab[], alpha: number[], size: number): boolean[] {
  const mask = alpha.map((a) => a < 0.5)
  const seeds: number[] = []
  for (let x = 0; x < size; x++) seeds.push(x)
  for (let y = 1; y < Math.ceil(size * 0.66); y++) seeds.push(y * size, y * size + size - 1)
  const border = seeds.filter((i) => !mask[i]).map((i) => lab[i])
  if (!border.length) return mask
  const { centres } = kmeans(border, medianCut(border, Math.min(3, border.length)), 8)
  const nearBorder = (p: Lab) => Math.min(...centres.map((c) => dist2(p, c))) < 0.0065
  const queue = seeds.filter((i) => !mask[i] && nearBorder(lab[i]))
  queue.forEach((i) => (mask[i] = true))
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    for (const n of neighbours4(i, size)) {
      if (mask[n]) continue
      if (dist2(lab[n], lab[i]) < 0.0022 && nearBorder(lab[n])) {
        mask[n] = true
        queue.push(n)
      }
    }
  }
  // A backdrop that swallowed most of the picture was a mistake: keep the photo whole
  const share = mask.filter(Boolean).length / mask.length
  if (share > 0.8) return alpha.map((a) => a < 0.5)
  // The soft edge between you and the backdrop: cells still close to it join it, or they'd ring you
  const halo = mask.map((m, i) => !m && neighbours4(i, size).some((n) => mask[n]) && Math.min(...centres.map((c) => dist2(lab[i], c))) < 0.012)
  halo.forEach((h, i) => h && (mask[i] = true))
  // Specks of you left in the backdrop, and holes of backdrop inside you, are tidied away
  for (let i = 0; i < mask.length; i++) {
    const ns = neighbours8(i, size)
    const same = ns.filter((n) => mask[n] === mask[i]).length
    if (same <= 1 && ns.length >= 5) mask[i] = !mask[i]
  }
  return mask
}

// ---------- 3. Quantise ----------

/** A sprite reads better with a little more contrast and colour than the photo had */
function lift(ps: Lab[]): Lab[] {
  if (!ps.length) return ps
  const mL = ps.reduce((s, p) => s + p[0], 0) / ps.length
  return ps.map(([L, a, b]) => [Math.min(1, Math.max(0, mL + (L - mL) * 1.12)), a * 1.15, b * 1.15] as Lab)
}

// ---------- 4. Clean-up ----------

/** A pixel unlike all four of its neighbours, with most of its eight agreeing on one colour, takes that colour */
function despeckle(px: number[], size: number): number[] {
  const out = px.slice()
  for (let i = 0; i < px.length; i++) {
    if (px[i] < 0) continue
    const n4 = neighbours4(i, size)
    if (n4.some((n) => px[n] === px[i])) continue
    const counts = new Map<number, number>()
    for (const n of neighbours8(i, size)) if (px[n] >= 0) counts.set(px[n], (counts.get(px[n]) ?? 0) + 1)
    let best = -1
    let bc = 0
    for (const [k, c] of [...counts].sort((p, q) => p[0] - q[0]))
      if (c > bc) {
        best = k
        bc = c
      }
    if (best >= 0 && bc >= 4) out[i] = best
  }
  return out
}

// ---------- 5. Eyes ----------

/** The resolution eyes are looked for at: fine enough for an eye to be a patch of cells */
const EYE_RES = 96

export interface FoundEyes {
  /** Each eye's darkest point, as fractions of the picture (x, y) */
  centres: [number, number][]
  /** The eye's width, as a fraction of the picture */
  width: number
}

/**
 * Two eyes in a framed photo, or none. Skin is told apart by colour (warm, any lightness); an eye
 * is a patch much darker than the face around it, small and wider than tall, mostly ringed by skin
 * (hair and the backdrop aren't), with something light beside it (the white of the eye) and a twin
 * at about its height on the other side of the face. Of a brow and an eye, the eye: lower, darker
 * and with the white beside it.
 */
export function findEyes(img: RGBAImage): FoundEyes | null {
  const R = Math.min(EYE_RES, img.width, img.height)
  if (R < 32) return null
  const { lab, alpha } = downscale(img, R)
  const mask = backdropMask(lab, alpha, R)
  // Skin of any shade is warm (a hue from pink through red to yellow) with a little colour to it
  const isSkin = (p: Lab) => {
    const hue = (Math.atan2(p[2], p[1]) * 180) / Math.PI
    return Math.hypot(p[1], p[2]) > 0.012 && hue > -60 && hue < 100 && p[0] > 0.22 && p[0] < 0.98
  }
  // The face: skin in the middle half of the picture's width, above the shoulders
  const skin = lab.map((p, i) => !mask[i] && isSkin(p))
  const face: number[] = []
  for (let y = Math.floor(R * 0.15); y < Math.floor(R * 0.8); y++) for (let x = Math.floor(R * 0.2); x < Math.ceil(R * 0.8); x++) if (skin[y * R + x]) face.push(y * R + x)
  if (face.length < R * R * 0.04) return null
  const Ls = face.map((i) => lab[i][0]).sort((p, q) => p - q)
  const skinL = Ls[Math.floor(Ls.length / 2)]
  const xs = face.map((i) => i % R).sort((p, q) => p - q)
  const left = xs[Math.floor(xs.length * 0.03)]
  const right = xs[Math.floor(xs.length * 0.97)]
  const fw = Math.max(8, right - left)
  const cx = (left + right) / 2
  // Dark cells inside the face's columns, in the band a framed face has its eyes in (hairlines,
  // bald heads and fringes make the face's own top no guide): darker than the skin, and than the
  // cells around them (a shadowed cheek is dark, but evenly)
  const y0 = Math.floor(R * 0.22)
  const y1 = Math.ceil(R * 0.68)
  const around = (i: number, r: number) => {
    const x = i % R
    const y = (i - x) / R
    let s = 0
    let n = 0
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= R || ny >= R || mask[ny * R + nx]) continue
        s += lab[ny * R + nx][0]
        n++
      }
    return n ? s / n : lab[i][0]
  }
  const r = Math.max(2, Math.round(fw * 0.1))
  const inBand = (i: number) => {
    const x = i % R
    const y = (i - x) / R
    return !mask[i] && y >= y0 && y <= y1 && x > left && x < right
  }
  const dark = (i: number) => inBand(i) && lab[i][0] < skinL - 0.06 && lab[i][0] < around(i, r) - 0.045
  const seen = new Set<number>()
  type Blob = { cells: number[]; x: number; y: number; w: number; h: number; minL: number; core: number; ring: number; white: number }
  const blobs: Blob[] = []
  for (let i = 0; i < lab.length; i++) {
    if (seen.has(i) || !dark(i)) continue
    const cells = [i]
    seen.add(i)
    for (let q = 0; q < cells.length; q++)
      for (const n of neighbours8(cells[q], R))
        if (!seen.has(n) && dark(n)) {
          seen.add(n)
          cells.push(n)
        }
    if (cells.length > fw * fw * 0.05) continue
    const cxs = cells.map((c) => c % R)
    const cys = cells.map((c) => Math.floor(c / R))
    const w = Math.max(...cxs) - Math.min(...cxs) + 1
    const h = Math.max(...cys) - Math.min(...cys) + 1
    if (w > fw * 0.38 || h > fw * 0.22 || w < h * 0.7) continue
    const core = cells.reduce((b, c) => (lab[c][0] < lab[b][0] ? c : b), cells[0])
    const inBlob = new Set(cells)
    const edge = [...new Set(cells.flatMap((c) => neighbours8(c, R)).filter((n) => !inBlob.has(n)))]
    const ring = edge.filter((n) => skin[n] || (!mask[n] && lab[n][0] >= skinL - 0.12)).length / (edge.length || 1)
    const white = edge.filter((n) => !mask[n] && lab[n][0] > skinL + 0.02 && Math.hypot(lab[n][1], lab[n][2]) < 0.05).length
    blobs.push({ cells, x: cxs.reduce((s, v) => s + v, 0) / cells.length, y: cys.reduce((s, v) => s + v, 0) / cells.length, w, h, minL: lab[core][0], core, ring, white })
  }
  // An eye is a patch of a few cells, ringed by skin
  const eyeLike = blobs.filter((b) => b.ring >= 0.5 && b.cells.length >= 2)
  // An eye: dark, ringed by skin, with the white of the eye beside it (a brow has none), a little off the middle, near where framed eyes sit
  const single = (b: Blob) => (skinL - b.minL) * 4 + b.ring + Math.min(3, b.white) * 0.3 - Math.abs(Math.abs(b.x - cx) - fw * 0.22) / fw - Math.abs(b.y / R - 0.43) * 3
  let best: { a: Blob; b: Blob; score: number } | null = null
  for (const a of eyeLike)
    for (const b of eyeLike) {
      if (a.x >= b.x) continue
      const dx = b.x - a.x
      const dy = Math.abs(a.y - b.y)
      // Side by side, about an eye's width apart or more, either side of the face's middle
      if (dx < fw * 0.3 || dx > fw * 0.72 || dy > fw * 0.1 || a.x > cx + fw * 0.06 || b.x < cx - fw * 0.06) continue
      const score = single(a) + single(b) - (dy / fw) * 2 - (Math.abs((a.x + b.x) / 2 - cx) / fw) * 1.5
      if (!best || score > best.score) best = { a, b, score }
    }
  const at = (c: number): [number, number] => [((c % R) + 0.5) / R, (Math.floor(c / R) + 0.5) / R]
  if (best) return { centres: [at(best.a.core), at(best.b.core)], width: Math.max(best.a.w, best.b.w) / R }
  // One clear eye (the other behind a glint on glasses, or in shadow): its twin is the darkest
  // spot near its mirror image across the face, if that is darker than the skin around it
  const one = eyeLike.filter((b) => Math.abs(b.x - cx) > fw * 0.1 && Math.abs(b.x - cx) < fw * 0.4).sort((p, q) => single(q) - single(p))[0]
  if (!one) return null
  const mx = Math.round(2 * cx - one.x)
  const my = Math.round(one.y)
  let twin = -1
  for (let y = my - Math.ceil(fw * 0.06); y <= my + Math.ceil(fw * 0.06); y++)
    for (let x = mx - Math.ceil(fw * 0.12); x <= mx + Math.ceil(fw * 0.12); x++) {
      if (x < 0 || y < 0 || x >= R || y >= R) continue
      const i = y * R + x
      if (inBand(i) && (twin < 0 || lab[i][0] < lab[twin][0])) twin = i
    }
  if (twin < 0 || lab[twin][0] > Math.min(skinL - 0.04, around(twin, r) - 0.02)) return null
  return { centres: [at(one.core), at(twin)].sort((p, q) => p[0] - q[0]), width: one.w / R }
}

/** Which sprite cells draw each eye: the dark ones, and the catchlight beside them */
export function eyeCells(found: FoundEyes, size: number): { dark: number[]; light: number[] } {
  const dark: number[] = []
  const light: number[] = []
  const wide = found.width * size >= 1.6 && size >= 28
  for (const [fx, fy] of found.centres) {
    const x = Math.min(size - 1, Math.floor(fx * size))
    const y = Math.min(size - 1, Math.floor(fy * size))
    const d = [y * size + x]
    // A bigger sprite has room for an eye two pixels wide: the second on the side the eye's middle leans to
    if (wide) {
      const nx = fx * size - x < 0.5 ? x - 1 : x + 1
      if (nx >= 0 && nx < size) d.push(y * size + nx)
    }
    dark.push(...d)
    // The catchlight: on the same side of both eyes, as one light would make it
    if (size >= 24) {
      const lx = Math.min(...d.map((i) => i % size)) - 1
      if (lx >= 0) light.push(y * size + lx)
    }
  }
  return { dark, light: light.filter((i) => !dark.includes(i)) }
}

// ---------- The whole thing ----------

export function pixelise(img: RGBAImage, opts: PixelOptions): PixelSprite {
  const size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, opts.size)))
  const colours = Math.round(Math.min(MAX_COLOURS, Math.max(MIN_COLOURS, opts.colours)))
  const outline = opts.outline !== false
  const { lab: raw, alpha } = downscale(img, size)
  const mask = backdropMask(raw, alpha, size)
  const hasBackdrop = mask.some(Boolean)
  // Cells on your edge are part backdrop: they take the colour of the closest cell inside you,
  // so no ring of in-between colour is left around the silhouette
  const backMean = mean(raw.filter((_, i) => mask[i]))
  // How deep each cell is inside you: 1 on the edge
  const depth = mask.map((m) => (m ? 0 : Infinity))
  const ring = depth.map((_, i) => i).filter((i) => mask[i])
  for (let q = 0; q < ring.length; q++)
    for (const n of neighbours4(ring[q], size))
      if (depth[n] === Infinity) {
        depth[n] = depth[ring[q]] + 1
        ring.push(n)
      }
  // A colour that sits between a deeper neighbour's and the backdrop's is a blend of the two
  const blendOf = (p: Lab, c: Lab) => {
    const bc = [backMean[0] - c[0], backMean[1] - c[1], backMean[2] - c[2]]
    const len = bc[0] ** 2 + bc[1] ** 2 + bc[2] ** 2 || 1e-9
    const t = Math.min(1, Math.max(0, ((p[0] - c[0]) * bc[0] + (p[1] - c[1]) * bc[1] + (p[2] - c[2]) * bc[2]) / len))
    return { t, off: dist2(p, [c[0] + t * bc[0], c[1] + t * bc[1], c[2] + t * bc[2]]) }
  }
  const snapped = raw.slice()
  for (const r of [2, 1]) {
    for (let i = 0; i < raw.length; i++) {
      if (depth[i] !== r) continue
      let best = -1
      let bo = 0.0016
      for (const n of neighbours8(i, size)) {
        if (depth[n] <= r || depth[n] === Infinity) continue
        const { t, off } = blendOf(raw[i], snapped[n])
        if (t > 0.12 && off < bo) {
          bo = off
          best = n
        }
      }
      if (best >= 0) snapped[i] = snapped[best]
    }
  }
  for (let i = 0; i < raw.length; i++) {
    if (depth[i] !== 1 || snapped[i] !== raw[i]) continue
    let best = -1
    let bd = Infinity
    for (const n of neighbours8(i, size)) {
      if (depth[n] < 2) continue
      const d = dist2(raw[i], snapped[n])
      if (d < bd) {
        bd = d
        best = n
      }
    }
    if (best < 0) {
      // Nothing inside to copy: the neighbour least like the backdrop
      let far = -1
      for (const n of [i, ...neighbours8(i, size)]) {
        if (mask[n]) continue
        const d = dist2(raw[n], backMean)
        if (d > far) {
          far = d
          best = n
        }
      }
    }
    if (best >= 0) snapped[i] = snapped[best]
  }
  // A little unsharp mask on lightness inside you, so eyes, brows and the mouth stay legible
  const sharp = snapped.map((p, i) => {
    if (mask[i]) return p
    const ns = neighbours8(i, size).filter((n) => !mask[n])
    if (!ns.length) return p
    const blur = ns.reduce((s, n) => s + snapped[n][0], 0) / ns.length
    return [Math.min(1, Math.max(0, p[0] + (p[0] - blur) * 0.6)), p[1], p[2]] as Lab
  })
  const lab = lift(sharp)

  // Colours for you: what's left after the outline and the backdrop take theirs
  const reserved = (outline && hasBackdrop ? 1 : 0) + (opts.background && hasBackdrop ? 1 : 0)
  const fg = lab.map((_, i) => i).filter((i) => !mask[i])
  const k = Math.max(2, Math.min(colours - reserved, fg.length))
  const fgPts = fg.map((i) => lab[i])
  const { centres, labels } = fgPts.length ? kmeans(fgPts, medianCut(fgPts, k), 12) : { centres: [] as Lab[], labels: [] as number[] }

  const palette: Lab[] = centres.slice()
  const pixels = new Array<number>(size * size).fill(-1)
  fg.forEach((i, j) => (pixels[i] = labels[j]))

  let cleaned = despeckle(pixels, size)

  if (hasBackdrop && opts.background) {
    // A flat backdrop: the photo's own, a touch quieter so you stand out
    const m = mean(raw.filter((_, i) => mask[i]))
    palette.push([m[0], m[1] * 0.7, m[2] * 0.7])
    const bi = palette.length - 1
    cleaned = cleaned.map((v) => (v < 0 ? bi : v))
  }
  if (hasBackdrop && outline && fgPts.length) {
    // The outline: your darkest colour, darker still, drawn just outside you
    const darkest = centres.reduce((d, c) => (c[0] < d[0] ? c : d), centres[0])
    palette.push([Math.max(0.08, darkest[0] * 0.55), darkest[1] * 0.6, darkest[2] * 0.6])
    const oi = palette.length - 1
    const isYou = (i: number) => !mask[i]
    const next = cleaned.slice()
    for (let i = 0; i < cleaned.length; i++) if (mask[i] && neighbours4(i, size).some(isYou)) next[i] = oi
    cleaned = next
  }

  // The eyes: solid dark pixels and a catchlight, in your own darkest and lightest colours
  let eyes: number[] = []
  const found = fgPts.length ? findEyes(img) : null
  if (found && centres.length >= 2) {
    const { dark, light } = eyeCells(found, size)
    const byL = centres.map((c, k) => ({ k, L: c[0] })).sort((p, q) => p.L - q.L)
    const darkest = byL[0].k
    const lightest = byL[byL.length - 1].k
    const own = (i: number) => !mask[i] && cleaned[i] >= 0
    for (const i of dark) if (own(i)) cleaned[i] = darkest
    for (const i of light) if (own(i)) cleaned[i] = lightest
    eyes = [...dark, ...light].filter(own)
  }

  // Unused colours go; the rest sorted dark to light, the same every time
  const used = [...new Set(cleaned.filter((v) => v >= 0))]
  const order = used.map((i) => ({ i, rgb: labToRgb(palette[i]), L: palette[i][0] })).sort((p, q) => p.L - q.L || hex(p.rgb).localeCompare(hex(q.rgb)))
  // Two centres can land on one hex: merge them
  const hexes: string[] = []
  const remap = new Map<number, number>()
  for (const o of order) {
    const h = hex(o.rgb)
    let at = hexes.indexOf(h)
    if (at < 0) {
      hexes.push(h)
      at = hexes.length - 1
    }
    remap.set(o.i, at)
  }
  return { size, palette: hexes, pixels: cleaned.map((v) => (v < 0 ? -1 : remap.get(v)!)), colours, background: opts.background && hasBackdrop, eyes }
}

// ---------- Using a sprite ----------

/** The sprite with its eyes shut: each eye pixel takes the colour above it (skin, a lid) */
export function blinkPixels(s: PixelSprite): number[] {
  if (!s.eyes.length) return s.pixels
  const eyes = new Set(s.eyes)
  const out = s.pixels.slice()
  for (const i of s.eyes) {
    let j = i - s.size
    while (j >= 0 && eyes.has(j)) j -= s.size
    out[i] = j >= 0 && s.pixels[j] >= 0 ? s.pixels[j] : s.pixels[i]
  }
  return out
}

/** The sprite at n × n, each cell the colour most of it covers (for a scene drawn at another scale) */
export function resampleSprite(s: PixelSprite, n: number): PixelSprite {
  if (n === s.size) return s
  // Each target cell samples a 4 × 4 grid of points across the source pixels it covers
  const k = s.size / n
  const pixels: number[] = []
  for (let ty = 0; ty < n; ty++)
    for (let tx = 0; tx < n; tx++) {
      const votes = new Map<number, number>()
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = Math.min(s.size - 1, Math.floor((tx + (sx + 0.5) / 4) * k))
          const y = Math.min(s.size - 1, Math.floor((ty + (sy + 0.5) / 4) * k))
          const v = s.pixels[y * s.size + x]
          votes.set(v, (votes.get(v) ?? 0) + 1)
        }
      pixels.push([...votes].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0])
    }
  const eyes = [...new Set(s.eyes.map((i) => Math.floor(((Math.floor(i / s.size) + 0.5) * n) / s.size) * n + Math.floor((((i % s.size) + 0.5) * n) / s.size)))]
  return { ...s, size: n, pixels, eyes }
}

/** Setting one pixel (an index into the palette, or -1 to clear it) */
export function paintPixel(s: PixelSprite, i: number, colour: number): PixelSprite {
  if (i < 0 || i >= s.pixels.length || colour < -1 || colour >= s.palette.length || s.pixels[i] === colour) return s
  const pixels = s.pixels.slice()
  pixels[i] = colour
  return { ...s, pixels }
}

/** Marking or unmarking a pixel as an eye */
export function toggleEye(s: PixelSprite, i: number): PixelSprite {
  if (i < 0 || i >= s.pixels.length) return s
  return { ...s, eyes: s.eyes.includes(i) ? s.eyes.filter((e) => e !== i) : [...s.eyes, i].slice(-8) }
}

/** A colour added to the palette for touch-ups, or the one already there */
export function withColour(s: PixelSprite, colour: string): { sprite: PixelSprite; index: number } {
  const c = colour.toLowerCase()
  const at = s.palette.indexOf(c)
  if (at >= 0) return { sprite: s, index: at }
  if (s.palette.length >= 32) return { sprite: s, index: s.palette.length - 1 }
  return { sprite: { ...s, palette: [...s.palette, c] }, index: s.palette.length }
}

/** The sprite as SVG rects, a run of one colour in a row as one rect */
export function spriteRects(s: PixelSprite, pixels: number[] = s.pixels): string {
  let out = ''
  for (let y = 0; y < s.size; y++) {
    for (let x = 0; x < s.size; ) {
      const v = pixels[y * s.size + x]
      let end = x + 1
      while (end < s.size && pixels[y * s.size + end] === v) end++
      if (v >= 0) out += `<rect x="${x}" y="${y}" width="${end - x + 0.02}" height="1.02" fill="${s.palette[v]}"/>`
      x = end
    }
  }
  return out
}

/** The sprite without its flat backdrop (the colour in from the corners), to stand in a scene */
export function withoutBackdrop(s: PixelSprite): PixelSprite {
  if (!s.background) return s
  const back = s.pixels[0]
  if (back < 0) return s
  const pixels = s.pixels.slice()
  const queue: number[] = []
  for (let k = 0; k < s.size; k++) for (const i of [k, (s.size - 1) * s.size + k, k * s.size, k * s.size + s.size - 1]) if (pixels[i] === back) {
    pixels[i] = -1
    queue.push(i)
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const x = i % s.size
    for (const n of [x > 0 ? i - 1 : -1, x < s.size - 1 ? i + 1 : -1, i - s.size, i + s.size])
      if (n >= 0 && n < pixels.length && pixels[n] === back) {
        pixels[n] = -1
        queue.push(n)
      }
  }
  return { ...s, pixels, background: false }
}

/** How a sprite stands in a 16-pixel-tall scene beside the Professor: no backdrop, 16 × 16 */
export function sceneSprite(s: PixelSprite): PixelSprite {
  const small = resampleSprite(withoutBackdrop(s), 16)
  // Shrinking leaves stray specks on the edge (bits of the outline): a pixel with at most one drawn neighbour goes
  const pixels = small.pixels.map((v, i) => (v >= 0 && neighbours4(i, 16).filter((n) => small.pixels[n] >= 0).length <= 1 ? -1 : v))
  return { ...small, pixels }
}
