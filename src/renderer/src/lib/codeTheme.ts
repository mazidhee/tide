/**
 * Which of VS Code's colour themes gives the code editor its syntax colours under each of Tide's
 * themes, and how those colours are kept readable on Tide's own code background (which is never
 * quite VS Code's). No Monaco here, so it is tested in Node.
 */

/** VS Code's built-in themes, as shiki ships them */
export type TokenThemeName = 'dark-plus' | 'light-plus' | 'solarized-light' | 'monokai'

/** Tide's theme → the VS Code theme closest to it in temperature and lightness */
export const TOKEN_THEME: Record<string, TokenThemeName> = {
  light: 'light-plus',
  sepia: 'solarized-light',
  graphite: 'dark-plus',
  dark: 'dark-plus',
  midnight: 'dark-plus',
  ember: 'monokai'
}

export function tokenThemeFor(dataTheme: string | null | undefined, darkBackground: boolean): TokenThemeName {
  const named = dataTheme ? TOKEN_THEME[dataTheme] : undefined
  // A theme that turned out the other way round from its name's pick (a custom background) falls back
  if (named && (named === 'light-plus' || named === 'solarized-light') !== darkBackground) return named
  return darkBackground ? 'dark-plus' : 'light-plus'
}

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colours, 1 to 21 */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

export const isDark = (bg: string) => luminance(bg) < 0.2

/**
 * The colour itself when it reads well enough on bg; otherwise the same hue moved toward white
 * (on a dark background) or black (on a light one) just far enough. Syntax colours are AA (4.5);
 * comments may sit a little quieter, at 3.
 */
export function readable(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return toHex(parseHex(fg))
  const target = isDark(bg) ? [255, 255, 255] : [0, 0, 0]
  const from = parseHex(fg)
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = toHex(from.map((v, i) => v + (target[i] - v) * t))
    if (contrast(c, bg) >= min) return c
  }
  return toHex(target)
}
