/**
 * Maths animations: short Manim scenes (Manim Community Edition) that play in a lesson as a video
 * with captions, a transcript and, when Tide's voice is set up, narration. The tutor fills in a
 * tested template (shared/manimTemplates) for the idea at hand, or Claude writes a scene of its
 * own; main/manim renders it in the sandbox and keeps it by content hash. Everything here is pure:
 * the lesson block, the colours, the cache key, the captions, narration timing, the checks on
 * Claude's code and the tutor's instructions.
 *
 * In a lesson an animation is a fenced block whose language is animation, holding one JSON object:
 *   {"template":"place-value","params":{"number":205},"title":"…"}   a template (Claude or Gemma)
 *   {"scene":"m1x2y3…","title":"…"}                                    Claude's own scene, rendered by render_animation
 */
import { visualKey } from './visuals'
import { templateById, templateGuide, TEMPLATES } from './manimTemplates'

// ---------- What gets installed ----------

/**
 * Measured on this Mac (Apple silicon, macOS 27, Python 3.12) installing into an empty folder:
 * Manim 0.22.1 and its wheels are 95 MB to download; pycairo has no macOS wheel, so it is built
 * against its own copy of cairo (sources 37 MB, about 15 s with Apple's command-line tools). Video
 * is written by PyAV, whose wheel carries FFmpeg's libraries: no separate ffmpeg. 347 MB on disk.
 * TinyTeX-1 is 67 MB to download plus about 10 MB of packages (standalone, preview, dvisvgm…), 271
 * MB on disk.
 */
export const MANIM_PACK = {
  version: '0.22.1',
  download: 'about 135 MB',
  size: 'about 350 MB',
  needsBytes: 900_000_000,
  where: 'Settings › Tools › Maths animations'
}

export const TEX_PACK = {
  url: 'https://github.com/rstudio/tinytex-releases/releases/download/v2026.11/TinyTeX-1-darwin-v2026.11.tar.xz',
  download: 'about 75 MB',
  size: 'about 270 MB',
  needsBytes: 700_000_000,
  /** What Manim's MathTex needs beyond TinyTeX-1 */
  packages: ['standalone', 'preview', 'dvisvgm', 'babel-english', 'amsfonts', 'doublestroke']
}

/** pycairo's source, and the wraps that let it build cairo, pixman, libpng and zlib itself (Meson's WrapDB) */
export const PYCAIRO = {
  version: '1.29.2',
  url: 'https://files.pythonhosted.org/packages/bb/5e/19ab2572981a996ce96b853a189d2dcced40506b67d9555a7568457abcf2/pycairo-1.29.2.tar.gz',
  sha256: '3e69fff74fe64f5ba2dfa31f67c6bdf26413342574047437d2ac520d35e9a489',
  /** Meson options: cairo built static with only what Manim draws with (image surfaces, Quartz) */
  setupArgs: [
    '--force-fallback-for=cairo,pixman-1,libpng,zlib',
    '-Ddefault_library=static',
    ...['pixman:gtk', 'pixman:demos', 'pixman:tests', 'pixman:libpng', 'pixman:openmp', 'cairo:fontconfig', 'cairo:freetype', 'cairo:tests', 'cairo:glib', 'cairo:lzo', 'cairo:xcb', 'cairo:xlib', 'cairo:spectre', 'cairo:symbol-lookup', 'cairo:dwrite'].map((o) => `-D${o}=disabled`)
  ]
}

const wrap = (dir: string, src: string, file: string, hash: string, fallback: string, provide: string, patch?: { file: string; url: string; fallback: string; hash: string }) =>
  `[wrap-file]\ndirectory = ${dir}\nsource_url = ${src}\nsource_filename = ${file}\nsource_hash = ${hash}\nsource_fallback_url = ${fallback}\n${patch ? `patch_filename = ${patch.file}\npatch_url = ${patch.url}\npatch_fallback_url = ${patch.fallback}\npatch_hash = ${patch.hash}\n` : ''}\n[provide]\n${provide}\n`

const WRAPDB = 'https://wrapdb.mesonbuild.com/v2'
const MIRROR = 'https://github.com/mesonbuild/wrapdb/releases/download'
export const CAIRO_WRAPS: Record<string, string> = {
  'cairo.wrap': wrap('cairo-1.18.4', 'https://www.cairographics.org/releases/cairo-1.18.4.tar.xz', 'cairo-1.18.4.tar.xz', '445ed8208a6e4823de1226a74ca319d3600e83f6369f99b14265006599c32ccb', `${MIRROR}/cairo_1.18.4-2/cairo-1.18.4.tar.xz`, 'dependency_names = cairo, cairo-gobject, cairo-script-interpreter'),
  'pixman.wrap': wrap('pixman-0.46.4', 'https://www.cairographics.org/releases/pixman-0.46.4.tar.gz', 'pixman-0.46.4.tar.gz', 'd09c44ebc3bd5bee7021c79f922fe8fb2fb57f7320f55e97ff9914d2346a591c', `${MIRROR}/pixman_0.46.4-1/pixman-0.46.4.tar.gz`, 'pixman-1 = idep_pixman'),
  'libpng.wrap': wrap('libpng-1.6.59', 'https://github.com/pnggroup/libpng/archive/v1.6.59.tar.gz', 'libpng-1.6.59.tar.gz', '2540302a1844ad2b2b501977abecfa850f265f97b78f065a712ab4074a89f5b5', `${WRAPDB}/libpng_1.6.59-1/get_source/libpng-1.6.59.tar.gz`, 'dependency_names = libpng', {
    file: 'libpng_1.6.59-1_patch.zip',
    url: `${WRAPDB}/libpng_1.6.59-1/get_patch`,
    fallback: `${MIRROR}/libpng_1.6.59-1/libpng_1.6.59-1_patch.zip`,
    hash: 'd20d5e20516a550817026b0074c4051ff4342da43f0600827316ea85f89d1d38'
  }),
  // zlib.net drops old releases, so WrapDB's copy comes first
  'zlib.wrap': wrap('zlib-1.3.2', `${WRAPDB}/zlib_1.3.2-1/get_source/zlib-1.3.2.tar.xz`, 'zlib-1.3.2.tar.xz', 'd7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3', 'https://zlib.net/zlib-1.3.2.tar.xz', 'dependency_names = zlib', {
    file: 'zlib_1.3.2-1_patch.zip',
    url: `${WRAPDB}/zlib_1.3.2-1/get_patch`,
    fallback: `${MIRROR}/zlib_1.3.2-1/zlib_1.3.2-1_patch.zip`,
    hash: '5ae7a2e92f823df118cfb8c1b23d94e3117864392b3446581d669049b2fba6dd'
  })
}

/** Pythons Manim has wheels for, newest first (3.15 lacks PyGLM's) */
export const MANIM_PYTHONS = ['3.14', '3.13', '3.12', '3.11']

// ---------- The lesson block ----------

export interface AnimationBlock {
  template?: string
  params?: Record<string, unknown>
  /** Claude's own scene, by the key render_animation gave it */
  scene?: string
  title?: string
  /** Lines replacing the template's narration, one per beat */
  narration?: string[]
}

export const isAnimationSource = (lang: string) => /^(animation|manim)$/i.test(lang.trim())

export function parseAnimationBlock(source: string): { ok: true; block: AnimationBlock } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return { ok: false, error: 'not JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not an object' }
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.slice(0, 120) : undefined
  const narration = Array.isArray(o.narration) && o.narration.every((s) => typeof s === 'string') ? (o.narration as string[]).slice(0, 12) : undefined
  if (typeof o.scene === 'string') {
    if (!/^m[a-z0-9]{6,32}$/.test(o.scene)) return { ok: false, error: 'unknown scene' }
    return { ok: true, block: { scene: o.scene, ...(title ? { title } : {}) } }
  }
  if (typeof o.template !== 'string' || !templateById(o.template)) return { ok: false, error: `template must be one of ${TEMPLATES.map((t) => t.id).join(', ')}` }
  const params = o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : {}
  return { ok: true, block: { template: o.template, params, ...(title ? { title } : {}), ...(narration ? { narration } : {}) } }
}

export const animationBlock = (b: AnimationBlock) => '```animation\n' + JSON.stringify(b) + '\n```'

// ---------- Colours ----------

/** The theme an animation is drawn in: the lesson's own colours, as hex for Manim */
export interface AnimPalette {
  scheme: 'light' | 'dark'
  bg: string
  ink: string
  muted: string
  line: string
  accent: string
  c1: string
  c2: string
  c3: string
  pos: string
  neg: string
}

export const DEFAULT_PALETTE: AnimPalette = { scheme: 'light', bg: '#fbfaf7', ink: '#1f1e1c', muted: '#77736b', line: '#dedad2', accent: '#d4622a', c1: '#3d7dd8', c2: '#2f9e74', c3: '#b5651d', pos: '#2f9e74', neg: '#c84a4a' }

const HEX = /^#[0-9a-f]{6}$/i

/** rgb(), rgba() (on the background) or #hex as #rrggbb; null for anything else */
export function toHex(c: string, over = '#ffffff'): string | null {
  const t = c.trim().toLowerCase()
  if (HEX.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${[...t.slice(1)].map((x) => x + x).join('')}`
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t)
  if (!m) return null
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  if (!Number.isFinite(a)) a = 1
  const base = HEX.test(over) ? [1, 3, 5].map((i) => parseInt(over.slice(i, i + 2), 16)) : [255, 255, 255]
  const ch = [m[1], m[2], m[3]].map((v, i) => Math.round(Math.min(255, Number(v)) * a + base[i] * (1 - a)))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** A palette from the lesson's theme tokens (shared/visuals readTheme), anything missing from the default */
export function paletteFrom(theme: { scheme: 'light' | 'dark'; tokens: Record<string, string> }): AnimPalette {
  const t = theme.tokens
  const base = theme.scheme === 'dark' ? { ...DEFAULT_PALETTE, scheme: 'dark' as const, bg: '#17181c', ink: '#e9e7e2', muted: '#9a978f', line: '#3a3b40' } : DEFAULT_PALETTE
  const bg = toHex(t.bg ?? t.surface ?? '') ?? base.bg
  const pick = (k: string, fallback: string) => toHex(t[k] ?? '', bg) ?? fallback
  return { scheme: theme.scheme, bg, ink: pick('ink', base.ink), muted: pick('muted', base.muted), line: pick('line', base.line), accent: pick('accent', base.accent), c1: pick('c1', base.c1), c2: pick('c2', base.c2), c3: pick('c3', base.c3), pos: pick('pos', base.pos), neg: pick('bad', base.neg) }
}

export function cleanPalette(p: unknown): AnimPalette {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const out = { ...DEFAULT_PALETTE, scheme: o.scheme === 'dark' ? 'dark' : 'light' } as AnimPalette
  for (const k of ['bg', 'ink', 'muted', 'line', 'accent', 'c1', 'c2', 'c3', 'pos', 'neg'] as const) if (typeof o[k] === 'string' && HEX.test(o[k] as string)) out[k] = (o[k] as string).toLowerCase()
  return out
}

// ---------- Rendering ----------

export type AnimQuality = 'low' | 'medium'
export const QUALITY_FLAG: Record<AnimQuality, string> = { low: '-ql', medium: '-qm' }
/** Limits for one render: wall time, and the size of everything it writes */
export const RENDER_LIMITS = { low: { ms: 120_000 }, medium: { ms: 240_000 }, bytes: 200_000_000, videoBytes: 60_000_000 }

/** What a render is made from: anything that changes the video changes the key */
export interface RenderInput {
  code: string
  beats: string[]
  palette: AnimPalette
  quality: AnimQuality
  tex: boolean
  /** The voice it is narrated in, or '' for silent (captions only) */
  voice: string
}

/** The cache key: the same scene, words, colours, quality, equations and voice give the same video */
export const renderKey = (r: RenderInput) => `m${visualKey(JSON.stringify([r.code, r.beats, r.palette, r.quality, r.tex, r.voice])).slice(1)}`

/** A key for Claude's own scene (by its code alone), as the block refers to it */
export const sceneKey = (code: string) => `m${visualKey(code.trim()).slice(1)}`

export type AnimState = 'queued' | 'rendering' | 'repairing' | 'ready' | 'failed' | 'unavailable'

export interface AnimStatus {
  key: string
  state: AnimState
  /** 0 to 1 while rendering */
  progress: number
  label: string
  title?: string
  error?: string
  /** When ready */
  video?: string
  captions?: Caption[]
  narrated?: boolean
  seconds?: number
}

export interface Caption {
  start: number
  end: number
  text: string
}

/** Manim's beat progress line (tide_manim prints "TIDE_BEAT 3/5") */
export function beatProgress(line: string): { done: number; total: number } | null {
  const m = /TIDE_BEAT (\d+)\/(\d+)/.exec(line)
  return m ? { done: Number(m[1]), total: Math.max(1, Number(m[2])) } : null
}

/** The part of a failed render worth showing the tutor: the Python error and the lines around it */
export function renderError(out: string): string {
  // Manim prints tracebacks inside a box drawn with │ and ╭ ─ ╮: strip the frame
  const lines = out
    .split('\n')
    .map((l) => l.replace(/^[│╭╰─╮╯\s]+|[│╮╯\s]+$/g, '').trimEnd())
    .filter((l) => l.trim() && !/^─+$/.test(l))
  const lastWhere = (to: number, ok: (l: string) => boolean) => {
    for (let i = to - 1; i >= 0; i--) if (ok(lines[i])) return i
    return -1
  }
  const last = lastWhere(lines.length, (l) => /^[A-Za-z_.]*(Error|Exception|Interrupt)\b.*:|^[A-Za-z_.]*Error$/.test(l.trim()))
  if (last < 0) return lines.slice(-8).join('\n').slice(-1200)
  const where = lastWhere(last, (l) => /scene\.py", line \d+|scene\.py:\d+/.test(l))
  const context = where >= 0 ? lines.slice(where, Math.min(where + 4, last)) : []
  return [...context, lines[last]].join('\n').slice(-1200)
}

// ---------- Narration ----------

/** A WAV's length in seconds, from its header; null when it isn't PCM WAV */
export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 44) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let o = 12
  let byteRate = 0
  while (o + 8 <= b.length) {
    const id = tag(o)
    const size = dv.getUint32(o + 4, true)
    if (id === 'fmt ') byteRate = dv.getUint32(o + 16, true)
    if (id === 'data') return byteRate ? Math.min(size, b.length - o - 8) / byteRate : null
    o += 8 + size + (size % 2)
  }
  return null
}

/** How long a line takes to read or say without audio: about 2.7 words a second, never under 2 s */
export const readingSeconds = (text: string) => Math.max(2, Math.round((text.trim().split(/\s+/).filter(Boolean).length / 2.7) * 10) / 10)

export interface BeatPlan {
  text: string
  dur: number
  wav?: string
}

/** Each beat's length: its narration when there is audio, else its reading time */
export const planBeats = (beats: string[], audio: (number | null)[] = []): BeatPlan[] => beats.map((text, i) => ({ text, dur: audio[i] ?? readingSeconds(text) }))

/** Captions from the beat log the scene wrote (when each beat started and ended) */
export function captionsFrom(log: unknown, beats: string[]): Caption[] {
  if (!Array.isArray(log)) return []
  return log
    .filter((e): e is { i: number; start: number; end: number } => !!e && typeof e === 'object' && Number.isInteger((e as { i: unknown }).i) && typeof (e as { start: unknown }).start === 'number' && typeof (e as { end: unknown }).end === 'number')
    .filter((e) => e.i >= 0 && e.i < beats.length)
    .map((e) => ({ start: e.start, end: e.end, text: beats[e.i] }))
    .sort((a, b) => a.start - b.start)
}

/** The caption showing at a moment of the video, or null */
export const captionAt = (captions: Caption[], t: number) => captions.find((c) => t >= c.start && t < c.end) ?? null

// ---------- Claude's own scenes ----------

const ALLOWED_IMPORTS = new Set(['manim', 'numpy', 'math', 'random', 'itertools', 'functools', 'tide_manim', 'json'])

/** Why Claude's scene can't be run as it is, or null: it must be a TideAnim built on TideScene, use beats, and import only maths */
export function checkScene(code: string): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'There is no code.'
  if (code.length > 14_000) return 'Too long: keep a scene under about 250 lines.'
  if (!/^\s*from tide_manim import \*/m.test(code)) return 'Start with `from tide_manim import *` (it brings Manim, the colours, Eq, Words and beats).'
  if (!/^class TideAnim\(TideScene\):/m.test(code)) return 'The scene must be `class TideAnim(TideScene):` with a construct method.'
  if (!/self\.(beat|during)\(/.test(code)) return 'Use self.beat(i, …) or `with self.during(i):` for each narration line, so the video follows the narration.'
  for (const m of code.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/gm)) {
    const mods = (m[1] ?? m[2]).split(',').map((s) => s.trim().split(/\s+/)[0].split('.')[0])
    const bad = mods.find((x) => x && !ALLOWED_IMPORTS.has(x))
    if (bad) return `It may import only manim, numpy, math, random, itertools, functools and tide_manim, not ${bad}.`
  }
  if (/\b(open|exec|eval|compile|__import__|globals|getattr|setattr|input|breakpoint)\s*\(|__\w+__|\bos\.|\bsys\.|\bsubprocess\b|\bsocket\b/.test(code.replace(/self\.beat|self\.during/g, ''))) return 'It may not read or write files, run programs or reach into Python internals: draw with Manim only.'
  return null
}

/** How many beats Claude's scene uses (the largest beat index plus one) */
export function beatsUsed(code: string): number {
  let n = 0
  for (const m of code.matchAll(/self\.(?:beat|during)\(\s*(\d+)/g)) n = Math.max(n, Number(m[1]) + 1)
  return n
}

export const SCENE_SYSTEM = `You write short Manim Community Edition scenes for Tide, a tutoring app, to explain one maths idea to one learner. Reply with only the scene in one \`\`\`python block.
Rules:
- Start with \`from tide_manim import *\` and define \`class TideAnim(TideScene):\` with \`def construct(self):\`. tide_manim imports all of Manim and gives: the theme's colours BG, INK, MUTED, LINE, ACCENT (highlights), C1, C2, C3, POS, NEG; Words(text, size=30, color=None) for text; Eq(latex, color=None, size=44) for equations (typeset when LaTeX is installed, else plain text, so it always works); Num(value, places=2) for a number that can change (.animate.set_value); HAS_TEX.
- Narration: the scene is cut into beats, one per narration line, numbered from 0. Play beat i with self.beat(i, *animations) (they play together, then it holds until the line has been said), or \`with self.during(i):\` around several self.play calls. Every line gets exactly one beat, in order.
- Colours only from the names above: never WHITE, BLUE, YELLOW or a hex code. Never set the background. Use ACCENT for the one thing to look at.
- Never MathTex, Tex, DecimalNumber, Integer or axis number labels directly (they need LaTeX): Eq, Words and Num instead.
- Keep it to 20 to 45 seconds and 2D. No files, no network, no imports beyond manim, numpy and math. No ThreeDScene, no external images or sounds.
- Leave margins: nothing within 0.3 of the frame's edges (the frame is about 14.2 by 8 units, centred on the origin).`

export function sceneRequest(idea: string, beats: string[], topic: string): string {
  return `Lesson topic: ${topic}\nThe idea to animate: ${idea}\nNarration, one line per beat (beat 0 first):\n${beats.map((b, i) => `${i}. ${b}`).join('\n')}`
}

export function sceneRepairPrompt(code: string, error: string, beats: number): string {
  return `This Tide scene failed to render. Fix it and reply with the whole corrected scene in one \`\`\`python block, keeping its ${beats} beats.\n\nThe error:\n${error}\n\nThe scene:\n\`\`\`python\n${code}\n\`\`\``
}

/** The Python in a reply: the first ```python block, else the whole reply when it looks like the scene */
export function extractScene(reply: string): string | null {
  const m = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(reply)
  const code = (m ? m[1] : reply).trim()
  return /class TideAnim\(TideScene\)/.test(code) ? `${code}\n` : null
}

// ---------- The tutor's instructions ----------

/** When to use an animation, and how; for Claude (with its tools) or Gemma (templates by block) */
export function animationGuide(engine: 'claude' | 'gemma', topic = ''): string {
  const fitting = TEMPLATES.filter((t) => t.fits.test(topic))
  if (engine === 'gemma') {
    // A small model reads only the templates that fit; none fit, nothing to read
    if (!fitting.length) return ''
    const list = fitting.map((t) => `  - ${t.id}: ${t.title}. Settings: ${Object.entries(t.params).map(([k, s]) => `${k} (default ${JSON.stringify(s.default)})`).join(', ')}`).join('\n')
    return `Animations: when an idea unfolds over time (a process, a limit, a story), show it as an animation, then ask them to try the explorable. Write a fenced block whose language is animation with one JSON object: {"template":"<id>","params":{…},"title":"…"}. Use only these templates:\n${list}\nThe lesson keeps going while it renders. At most one animation per message.`
  }
  return `ANIMATIONS (Manim). When the idea is a process or a story that unfolds (where zero came from, secants closing in on a tangent, a matrix moving the plane, rectangles filling an area, gradient descent stepping down, the chain rule flowing backwards, means piling into a bell), show it as a short narrated animation, then hand over to an explorable so they can break it themselves: "watch, then break it". Not for static facts, and at most one or two a lesson.
- Call render_animation with a template and settings filled in from THIS learner's example (their number, their matrix, their function), and optional narration (one line per beat, the template's count). It returns the \`\`\`animation block: paste it where it belongs and keep teaching; the lesson shows your text first and slots the video in when it is ready (a few seconds).
- When no template fits the idea, call render_animation with your own scene (code and narration); look in animation_library first for one already made and proven. A scene that renders and is watched is kept there.
- After it, ask them a question about what they saw, and offer the matching explorable.
Templates${fitting.length ? ' (the ones that fit this topic first)' : ''}:
${templateGuide([...fitting, ...TEMPLATES.filter((t) => !fitting.includes(t))])}`
}
