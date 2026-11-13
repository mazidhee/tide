/**
 * A synthetic test portrait, drawn in code: a soft backdrop, shoulders in a jumper, a face with
 * hair, eyes, brows and a mouth, and a little seeded grain so it isn't flat. Never a real photo.
 */
export interface RGBA {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function portrait(size = 256, opts: { skin?: [number, number, number]; hair?: [number, number, number]; backdrop?: [number, number, number] } = {}): RGBA {
  const skin = opts.skin ?? [214, 168, 132]
  const hair = opts.hair ?? [48, 34, 28]
  const back = opts.backdrop ?? [168, 190, 206]
  const jumper: [number, number, number] = [62, 92, 120]
  const data = new Uint8ClampedArray(size * size * 4)
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const u = (v: number) => v / 256
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = u((x * 256) / size)
      const ny = u((y * 256) / size)
      // Backdrop: a gentle vertical gradient
      let c: [number, number, number] = [back[0] - ny * 18, back[1] - ny * 14, back[2] - ny * 10]
      // Shoulders
      const sh = (nx - 0.5) ** 2 / 0.16 + (ny - 1.05) ** 2 / 0.09
      if (sh < 1) c = [jumper[0] * (1 - 0.15 * nx), jumper[1] * (1 - 0.15 * nx), jumper[2] * (1 - 0.15 * nx)]
      // Neck
      if (Math.abs(nx - 0.5) < 0.07 && ny > 0.6 && ny < 0.82) c = [skin[0] * 0.82, skin[1] * 0.82, skin[2] * 0.82]
      // Hair behind the head
      const hb = (nx - 0.5) ** 2 / 0.052 + (ny - 0.4) ** 2 / 0.075
      if (hb < 1) c = [...hair]
      // Face
      const f = (nx - 0.5) ** 2 / 0.034 + (ny - 0.46) ** 2 / 0.05
      if (f < 1) {
        const shade = 1 - 0.18 * Math.max(0, nx - 0.5) * 3
        c = [skin[0] * shade, skin[1] * shade, skin[2] * shade]
        // Fringe
        if (ny < 0.33 + 0.04 * Math.sin(nx * 18)) c = [...hair]
        // Brows
        if (Math.abs(ny - 0.4) < 0.012 && (Math.abs(nx - 0.42) < 0.045 || Math.abs(nx - 0.58) < 0.045)) c = [...hair]
        // Eyes: white, then the iris
        for (const ex of [0.42, 0.58]) {
          const e = (nx - ex) ** 2 / 0.0011 + (ny - 0.45) ** 2 / 0.0003
          if (e < 1) c = [236, 232, 226]
          if ((nx - ex) ** 2 + (ny - 0.45) ** 2 < 0.00022) c = [40, 30, 26]
        }
        // Nose shadow
        if (Math.abs(nx - 0.51) < 0.012 && ny > 0.47 && ny < 0.54) c = [skin[0] * 0.8, skin[1] * 0.78, skin[2] * 0.76]
        // Mouth
        if ((nx - 0.5) ** 2 / 0.003 + (ny - 0.585) ** 2 / 0.00012 < 1) c = [168, 82, 78]
      }
      const g = (rand() - 0.5) * 10
      const i = (y * size + x) * 4
      data[i] = c[0] + g
      data[i + 1] = c[1] + g
      data[i + 2] = c[2] + g
      data[i + 3] = 255
    }
  return { width: size, height: size, data }
}
